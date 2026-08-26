/**
 * Best-effort persistent cache for private Library preview blobs.
 *
 * Blobs live in IndexedDB keyed by blob CID; localStorage is far too small
 * for a whole Library and data URLs inflate 33%, so previews moved off it.
 * Every operation tolerates storage failures: a failed read or write simply
 * degrades to a plain getBlob.
 */
import { createIndexedDbBlobCache, indexedDbAvailable, type BlobCacheStore } from "./idb-blob-cache";

export type PreviewCacheStore = BlobCacheStore;

export type LegacyPreviewStorage = Pick<Storage, "getItem" | "key" | "length" | "removeItem">;

const DATABASE_NAME = "atgallery.previews.v2";
const STORE_NAME = "previews";
const LEGACY_INDEX_KEY = "atgallery.preview.index.v1";
const LEGACY_VALUE_PREFIX = "atgallery.preview.value.v1.";

function defaultStore(): PreviewCacheStore | undefined {
  return indexedDbAvailable() ? createIndexedDbBlobCache({ database: DATABASE_NAME, store: STORE_NAME }) : undefined;
}

export async function readCachedPreview(
  cid: string,
  store?: PreviewCacheStore,
): Promise<Blob | undefined> {
  try {
    const blob = await (store ?? defaultStore())?.get(cid);
    return blob instanceof Blob ? blob : undefined;
  } catch {
    return undefined;
  }
}

export async function cachePreviewBlob(
  cid: string,
  blob: Blob,
  store?: PreviewCacheStore,
): Promise<void> {
  try {
    await (store ?? defaultStore())?.put(cid, blob);
  } catch {
    // Quota pressure or unavailable storage: the next view simply re-downloads.
  }
}

export async function clearPreviewCache(store?: PreviewCacheStore): Promise<void> {
  try {
    await (store ?? defaultStore())?.clear();
  } catch {
    // Clearing is advisory; ignore storage failures.
  }
}

/**
 * Removes data-URL entries left by the superseded localStorage cache so the
 * freed quota returns to the origin.
 */
export function purgeLegacyPreviewDataUrls(storage?: LegacyPreviewStorage): void {
  try {
    const resolved = storage ?? (globalThis as { localStorage?: LegacyPreviewStorage }).localStorage;
    if (!resolved) return;
    const doomed: string[] = [];
    for (let index = resolved.length - 1; index >= 0; index -= 1) {
      const key = resolved.key(index);
      if (key === null) continue;
      if (key === LEGACY_INDEX_KEY || key.startsWith(LEGACY_VALUE_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) resolved.removeItem(key);
  } catch {
    // Purging is advisory; ignore storage failures.
  }
}
