/**
 * Instant-hydration snapshot of the private Library view state.
 *
 * The media records, albums, memberships, and the PDS URL discovered on the
 * last successful refresh are kept in localStorage so a reload renders the
 * gallery immediately and revalidates against the Space in the background.
 * Records are small text; preview bytes stay in the IndexedDB blob cache.
 */
import type { LibraryAlbum, LibraryMedia, LibraryMembership } from "./private-library";

export type LibrarySnapshotStorage = Pick<
  Storage,
  "getItem" | "key" | "length" | "removeItem" | "setItem"
>;

export type LibraryWatermarks = Readonly<{
  albums?: string | undefined;
  media?: string | undefined;
  memberships?: string | undefined;
}>;

export type LibrarySnapshot = Readonly<{
  albums: readonly LibraryAlbum[];
  media: readonly LibraryMedia[];
  memberships: readonly LibraryMembership[];
  pdsUrl?: string | undefined;
  refreshedAt?: string | undefined;
  watermark?: string | undefined;
  watermarks?: LibraryWatermarks | undefined;
}>;

const SNAPSHOT_KEY = "atgallery.library.snapshot.v1";
export const LIBRARY_SNAPSHOT_FRESHNESS_MS = 5 * 60 * 1000;

function storageKey(did: string, spaceUri: string): string {
  return `${SNAPSHOT_KEY}.${did}.${spaceUri}`;
}

function defaultStore(): LibrarySnapshotStorage | undefined {
  return (globalThis as { localStorage?: LibrarySnapshotStorage }).localStorage;
}

function validWatermarks(value: unknown): LibraryWatermarks | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  return {
    albums: typeof v.albums === "string" ? v.albums : undefined,
    media: typeof v.media === "string" ? v.media : undefined,
    memberships: typeof v.memberships === "string" ? v.memberships : undefined,
  };
}

function validSnapshot(value: unknown): LibrarySnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const arraysValid = ["albums", "media", "memberships"].every((field) =>
    Array.isArray(record[field]),
  );
  const pdsUrlValid = record.pdsUrl === undefined || typeof record.pdsUrl === "string";
  const refreshedAtValid = record.refreshedAt === undefined || typeof record.refreshedAt === "string";
  const watermarkValid = record.watermark === undefined || typeof record.watermark === "string";
  if (!arraysValid || !pdsUrlValid || !refreshedAtValid || !watermarkValid) return undefined;
  const parsedWatermarks = validWatermarks(record.watermarks);
  return {
    albums: record.albums as readonly LibraryAlbum[],
    media: record.media as readonly LibraryMedia[],
    memberships: record.memberships as readonly LibraryMembership[],
    ...(typeof record.pdsUrl === "string" ? { pdsUrl: record.pdsUrl } : {}),
    ...(typeof record.refreshedAt === "string" ? { refreshedAt: record.refreshedAt } : {}),
    ...(typeof record.watermark === "string" ? { watermark: record.watermark } : {}),
    ...(parsedWatermarks ? { watermarks: parsedWatermarks } : {}),
  };
}

export function isFreshLibrarySnapshot(
  snapshot: LibrarySnapshot | undefined,
  now = new Date(),
): boolean {
  if (!snapshot?.refreshedAt) return false;
  const refreshedAt = Date.parse(snapshot.refreshedAt);
  return Number.isFinite(refreshedAt) && now.getTime() - refreshedAt <= LIBRARY_SNAPSHOT_FRESHNESS_MS;
}

export function readLibrarySnapshot(
  did: string,
  spaceUri: string,
  store?: LibrarySnapshotStorage,
): LibrarySnapshot | undefined {
  try {
    const resolved = store ?? defaultStore();
    const raw = resolved?.getItem(storageKey(did, spaceUri));
    if (!raw) return undefined;
    return validSnapshot(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function writeLibrarySnapshot(
  did: string,
  spaceUri: string,
  snapshot: LibrarySnapshot,
  store?: LibrarySnapshotStorage,
): void {
  try {
    (store ?? defaultStore())?.setItem(
      storageKey(did, spaceUri),
      JSON.stringify({ ...snapshot, did, spaceUri }),
    );
  } catch {
    // Quota pressure or unavailable storage: the next load simply refetches.
  }
}

export function clearLibrarySnapshots(store?: LibrarySnapshotStorage): void {
  try {
    const resolved = store ?? defaultStore();
    if (!resolved) return;
    for (let index = resolved.length - 1; index >= 0; index -= 1) {
      const key = resolved.key(index);
      if (key?.startsWith(`${SNAPSHOT_KEY}.`)) resolved.removeItem(key);
    }
  } catch {
    // Clearing is advisory; ignore storage failures.
  }
}
