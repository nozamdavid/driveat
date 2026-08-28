import { describe, expect, it } from "vitest";

import {
  canUseLibrarySnapshot,
  clearLibrarySnapshots,
  readLibrarySnapshot,
  writeLibrarySnapshot,
  type LibrarySnapshot,
  type LibrarySnapshotStorage,
} from "./library-snapshot";

function memoryStorage(): LibrarySnapshotStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get length() {
      return entries.size;
    },
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, String(value)),
  };
}

const snapshot: LibrarySnapshot = {
  albums: [
    { uri: "at://space/did/am.noz.atgallery.alpha.libraryAlbum/3a", cid: "cid-album", title: "Trip", createdAt: "2026-08-01T00:00:00Z" },
  ],
  media: [
    {
      uri: "at://space/did/am.noz.atgallery.alpha.libraryMedia/3m",
      cid: "cid-media",
      filename: "beach.webp",
      mime: "image/webp",
      size: 12,
      previewCid: "preview-cid",
      createdAt: "2026-08-02T00:00:00Z",
    },
  ],
  memberships: [],
  pdsUrl: "https://pds.example",
};

describe("library snapshot", () => {
  it("keeps using a cached snapshot until an explicit server refresh", () => {
    expect(canUseLibrarySnapshot({ ...snapshot, refreshedAt: "2020-01-01T00:00:00.000Z" })).toBe(true);
    expect(canUseLibrarySnapshot(undefined)).toBe(false);
  });

  it("round-trips a snapshot per did and space", () => {
    const storage = memoryStorage();
    writeLibrarySnapshot("did:plc:a", "at://space/x", snapshot, storage);
    expect(readLibrarySnapshot("did:plc:a", "at://space/x", storage)).toEqual(snapshot);
  });

  it("does not leak snapshots across accounts or spaces", () => {
    const storage = memoryStorage();
    writeLibrarySnapshot("did:plc:a", "at://space/x", snapshot, storage);
    expect(readLibrarySnapshot("did:plc:b", "at://space/x", storage)).toBeUndefined();
    expect(readLibrarySnapshot("did:plc:a", "at://space/y", storage)).toBeUndefined();
  });

  it("treats corrupt JSON as a miss", () => {
    const storage = memoryStorage();
    writeLibrarySnapshot("did:plc:a", "at://space/x", snapshot, storage);
    storage.setItem(
      "atgallery.library.snapshot.v1.did:plc:a.at://space/x",
      "{{not json",
    );
    expect(readLibrarySnapshot("did:plc:a", "at://space/x", storage)).toBeUndefined();
  });

  it("rejects snapshots with missing collections or bad pdsUrl", () => {
    const storage = memoryStorage();
    const key = "atgallery.library.snapshot.v1.did:plc:a.at://space/x";
    storage.setItem(key, JSON.stringify({ albums: null, media: [], memberships: [] }));
    expect(readLibrarySnapshot("did:plc:a", "at://space/x", storage)).toBeUndefined();
    storage.setItem(key, JSON.stringify({ ...snapshot, pdsUrl: 42 }));
    expect(readLibrarySnapshot("did:plc:a", "at://space/x", storage)).toBeUndefined();
  });

  it("swallows write failures so refresh keeps working", () => {
    const hostile: LibrarySnapshotStorage = {
      getItem: () => null,
      key: () => null,
      length: 0,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() =>
      writeLibrarySnapshot("did:plc:a", "at://space/x", snapshot, hostile),
    ).not.toThrow();
  });

  it("clears every stored snapshot", () => {
    const storage = memoryStorage();
    writeLibrarySnapshot("did:plc:a", "at://space/x", snapshot, storage);
    writeLibrarySnapshot("did:plc:b", "at://space/y", snapshot, storage);
    storage.entries.set("unrelated.key", "keep me");
    clearLibrarySnapshots(storage);
    expect(storage.entries.get("unrelated.key")).toBe("keep me");
    expect(storage.entries.size).toBe(1);
  });
});
