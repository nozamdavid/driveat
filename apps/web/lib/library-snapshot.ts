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

export type LibrarySnapshot = Readonly<{
  albums: readonly LibraryAlbum[];
  media: readonly LibraryMedia[];
  memberships: readonly LibraryMembership[];
  pdsUrl?: string;
}>;

const SNAPSHOT_KEY = "atgallery.library.snapshot.v1";

function storageKey(did: string, spaceUri: string): string {
  return `${SNAPSHOT_KEY}.${did}.${spaceUri}`;
}

function defaultStore(): LibrarySnapshotStorage | undefined {
  return (globalThis as { localStorage?: LibrarySnapshotStorage }).localStorage;
}

function validSnapshot(value: unknown): LibrarySnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const arraysValid = ["albums", "media", "memberships"].every((field) =>
    Array.isArray(record[field]),
  );
  const pdsUrlValid = record.pdsUrl === undefined || typeof record.pdsUrl === "string";
  if (!arraysValid || !pdsUrlValid) return undefined;
  return {
    albums: record.albums as readonly LibraryAlbum[],
    media: record.media as readonly LibraryMedia[],
    memberships: record.memberships as readonly LibraryMembership[],
    ...(typeof record.pdsUrl === "string" ? { pdsUrl: record.pdsUrl } : {}),
  };
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
