export type ExperimentalNsids = Readonly<{
  albumSnapshot: string;
  libraryAlbum: string;
  libraryMedia: string;
  libraryMembership: string;
  personalLibrarySpace: string;
  publicationJob: string;
  publishedAlbum: string;
  publishedMedia: string;
  publishedMembership: string;
  transferEvent: string;
}>;

const authorityPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;

/**
 * Generates alpha-only NSIDs under an exact, DNS-authorized namespace.
 * Production schemas must use a distinct, reviewed namespace.
 */
export function createExperimentalNsids(authority: string): ExperimentalNsids {
  if (!authorityPattern.test(authority)) {
    throw new TypeError("Lexicon authority must be a normalized reverse-domain NSID prefix.");
  }

  const prefix = authority;
  return {
    albumSnapshot: `${prefix}.albumSnapshot`,
    libraryAlbum: `${prefix}.libraryAlbum`,
    libraryMedia: `${prefix}.libraryMedia`,
    libraryMembership: `${prefix}.libraryMembership`,
    personalLibrarySpace: `${prefix}.personalLibrary`,
    publicationJob: `${prefix}.publicationJob`,
    publishedAlbum: `${prefix}.publishedAlbum`,
    publishedMedia: `${prefix}.publishedMedia`,
    publishedMembership: `${prefix}.publishedMembership`,
    transferEvent: `${prefix}.transferEvent`,
  };
}
