import type { LibraryAlbum, LibraryMembership } from "./private-library";

type MembershipLike = Pick<LibraryMembership, "albumUri" | "mediaUri">;

function mediaUrisByAlbum(
  memberships: readonly MembershipLike[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const byAlbum = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const known = byAlbum.get(membership.albumUri) ?? new Set<string>();
    known.add(membership.mediaUri);
    byAlbum.set(membership.albumUri, known);
  }
  return byAlbum;
}

/** Albums the picker offers: every album still missing at least one target. */
export function eligibleAlbumsForTargets(input: Readonly<{
  albums: readonly LibraryAlbum[];
  memberships: readonly MembershipLike[];
  targetMediaUris: readonly string[];
}>): readonly LibraryAlbum[] {
  const targets = new Set(input.targetMediaUris);
  if (targets.size === 0) return [];
  const byAlbum = mediaUrisByAlbum(input.memberships);
  return input.albums.filter((album) => {
    const members = byAlbum.get(album.uri);
    if (!members) return true;
    for (const uri of targets) {
      if (!members.has(uri)) return true;
    }
    return false;
  });
}

/** Target media items missing from one album, deduplicated, in target order. */
export function unmemberedTargetUris(input: Readonly<{
  albumUri: string;
  memberships: readonly MembershipLike[];
  targetMediaUris: readonly string[];
}>): readonly string[] {
  const targets = new Set(input.targetMediaUris);
  const members = mediaUrisByAlbum(input.memberships).get(input.albumUri);
  if (!members) return Array.from(targets);
  return Array.from(targets).filter((uri) => !members.has(uri));
}
