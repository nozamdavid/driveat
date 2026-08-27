import { describe, expect, it } from "vitest";

import { createIndexedDbBlobCache } from "./idb-blob-cache";
import {
  cachePreviewBlob,
  clearPreviewCache,
  prunePreviewCache,
  purgeLegacyPreviewDataUrls,
  readCachedPreview,
} from "./preview-cache";
import type { LegacyPreviewStorage, PreviewCacheStore } from "./preview-cache";

function memoryStore(): PreviewCacheStore & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async clear() {
      entries.clear();
    },
    async get(key) {
      return entries.get(key);
    },
    async keys() {
      return [...entries.keys()];
    },
    async put(key, blob) {
      entries.set(key, blob);
    },
    async remove(key) {
      entries.delete(key);
    },
  };
}

function failingStore(): PreviewCacheStore {
  return {
    async clear() {
      throw new Error("storage unavailable");
    },
    async get() {
      throw new Error("storage unavailable");
    },
    async keys() {
      throw new Error("storage unavailable");
    },
    async put() {
      throw new Error("storage unavailable");
    },
    async remove() {
      throw new Error("storage unavailable");
    },
  };
}

function legacyStorage(): LegacyPreviewStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get length() {
      return entries.size;
    },
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => void entries.delete(key),
  };
}

const webp = (bytes: number): Blob =>
  new Blob([new Uint8Array(bytes).fill(9)], { type: "image/webp" });

describe("preview cache", () => {
  it("round-trips a stored preview blob", async () => {
    const store = memoryStore();
    await cachePreviewBlob("cid-a", webp(10), store);
    const cached = await readCachedPreview("cid-a", store);
    expect(cached).toBeInstanceOf(Blob);
    expect(cached?.size).toBe(10);
  });

  it("returns undefined for unknown cids", async () => {
    await expect(readCachedPreview("cid-missing", memoryStore())).resolves.toBeUndefined();
  });

  it("treats corrupt entries as misses instead of throwing", async () => {
    const store = memoryStore();
    store.entries.set("cid-corrupt", "not a blob");
    await expect(readCachedPreview("cid-corrupt", store)).resolves.toBeUndefined();
  });

  it("degrades to a miss when reads fail", async () => {
    await expect(readCachedPreview("cid-a", failingStore())).resolves.toBeUndefined();
  });

  it("swallows write failures so viewing keeps working", async () => {
    await expect(cachePreviewBlob("cid-a", webp(4), failingStore())).resolves.toBeUndefined();
  });

  it("clears every cached value", async () => {
    const store = memoryStore();
    await cachePreviewBlob("cid-a", webp(8), store);
    await cachePreviewBlob("cid-b", webp(9), store);
    await clearPreviewCache(store);
    await expect(readCachedPreview("cid-a", store)).resolves.toBeUndefined();
    await expect(readCachedPreview("cid-b", store)).resolves.toBeUndefined();
  });

  it("removes cached previews whose media records were deleted", async () => {
    const store = memoryStore();
    await cachePreviewBlob("keep", webp(8), store);
    await cachePreviewBlob("deleted", webp(9), store);
    await prunePreviewCache(new Set(["keep"]), store);
    await expect(readCachedPreview("keep", store)).resolves.toBeInstanceOf(Blob);
    await expect(readCachedPreview("deleted", store)).resolves.toBeUndefined();
  });

  it("degrades to a no-op without any backing storage", async () => {
    await expect(readCachedPreview("cid-a", undefined)).resolves.toBeUndefined();
    await expect(cachePreviewBlob("cid-a", webp(4), undefined)).resolves.toBeUndefined();
    await expect(clearPreviewCache(undefined)).resolves.toBeUndefined();
  });

  it("purges only superseded localStorage entries", () => {
    const storage = legacyStorage();
    storage.entries.set("atgallery.preview.index.v1", '["cid"]');
    storage.entries.set("atgallery.preview.value.v1.cid", "data:image/webp;base64,AA");
    storage.entries.set("unrelated.key", "keep me");
    purgeLegacyPreviewDataUrls(storage);
    expect(storage.entries.has("atgallery.preview.index.v1")).toBe(false);
    expect(storage.entries.has("atgallery.preview.value.v1.cid")).toBe(false);
    expect(storage.entries.get("unrelated.key")).toBe("keep me");
  });
});

describe("indexeddb blob cache adapter", () => {
  it("degrades gracefully when IndexedDB is unavailable", async () => {
    const store = createIndexedDbBlobCache({ database: "test.db", store: "blobs" });
    await expect(readCachedPreview("cid-a", store)).resolves.toBeUndefined();
    await expect(cachePreviewBlob("cid-a", webp(4), store)).resolves.toBeUndefined();
  });
});
