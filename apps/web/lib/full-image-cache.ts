/**
 * In-memory LRU cache for full-resolution media Blobs in the PhotoViewer.
 *
 * Keeps recently viewed or prefetched original Blobs in memory so
 * navigating back and forth in the gallery viewer is instantaneous with 0 network calls.
 */

const MAX_CACHED_ORIGINALS = 10;
const memoryCache = new Map<string, Blob>();

export function getCachedOriginal(cid: string | undefined): Blob | undefined {
  if (!cid) return undefined;
  const blob = memoryCache.get(cid);
  if (blob) {
    // Refresh LRU position (delete & re-insert)
    memoryCache.delete(cid);
    memoryCache.set(cid, blob);
  }
  return blob;
}

export function setCachedOriginal(cid: string | undefined, blob: Blob): void {
  if (!cid) return;
  if (memoryCache.has(cid)) {
    memoryCache.delete(cid);
  } else if (memoryCache.size >= MAX_CACHED_ORIGINALS) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) {
      memoryCache.delete(oldestKey);
    }
  }
  memoryCache.set(cid, blob);
}

export function isOriginalCached(cid: string | undefined): boolean {
  if (!cid) return false;
  return memoryCache.has(cid);
}

export function clearOriginalCache(): void {
  memoryCache.clear();
}
