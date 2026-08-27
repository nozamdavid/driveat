import { assertNsid } from "./internal-nsid.js";

export const REQUIRED_ATPROTO_SCOPE = "atproto";

export const GALLERY_BLOB_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "application/json",
] as const;

export type GalleryPermissionNsids = Readonly<{
  account: string;
  albumSnapshot: string;
  libraryAlbum: string;
  libraryMedia: string;
  libraryMembership: string;
  libraryIndex: string;
  personalLibrarySpace: string;
  publicationJob: string;
  publishedAlbum: string;
  publishedMedia: string;
  publishedMembership: string;
  transferEvent: string;
}>;

export type GalleryOAuthPermissions = Readonly<{
  scope: string;
  scopes: readonly string[];
  spaceScope: string;
}>;

function permission(resource: string, positional: string, parameters: URLSearchParams): string {
  const query = parameters.toString();
  return `${resource}:${positional}${query ? `?${query}` : ""}`;
}

export function buildGalleryOAuthPermissions(
  nsids: GalleryPermissionNsids,
): GalleryOAuthPermissions {
  for (const nsid of Object.values(nsids)) {
    assertNsid(nsid, "NSID in OAuth permission configuration");
  }

  const blobParameters = new URLSearchParams();
  for (const mimeType of GALLERY_BLOB_MIME_TYPES) blobParameters.append("accept", mimeType);
  const blobScope = `blob?${blobParameters.toString()}`;

  const publicCollections = [
    nsids.account,
    nsids.publishedAlbum,
    nsids.albumSnapshot,
    nsids.publishedMedia,
    nsids.publishedMembership,
  ];
  const repoScopes = publicCollections.map((collection) => `repo:${collection}`);

  const spaceParameters = new URLSearchParams();
  for (const collection of [
    nsids.libraryMedia,
    nsids.libraryAlbum,
    nsids.libraryMembership,
    nsids.libraryIndex,
    nsids.publicationJob,
    nsids.transferEvent,
  ]) {
    spaceParameters.append("collection", collection);
  }
  for (const action of ["read", "read_self", "create", "update", "delete"]) {
    spaceParameters.append("action", action);
  }
  for (const operation of ["create", "update", "delete"]) {
    spaceParameters.append("manage", operation);
  }

  const spaceScope = permission("space", nsids.personalLibrarySpace, spaceParameters);
  const scopes = [REQUIRED_ATPROTO_SCOPE, ...repoScopes, blobScope, spaceScope];

  return { scope: scopes.join(" "), scopes, spaceScope };
}

export function findMissingOAuthScopes(
  grantedScope: string,
  requiredScopes: readonly string[],
): readonly string[] {
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return requiredScopes.filter((scope) => !granted.has(scope));
}
