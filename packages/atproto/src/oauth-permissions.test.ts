import { ACCEPTED_IMAGE_MIME_TYPES, ACCEPTED_VIDEO_MIME_TYPES } from "@atgallery/domain";
import { describe, expect, it } from "vitest";

import {
  GALLERY_BLOB_MIME_TYPES,
  buildGalleryOAuthPermissions,
  findMissingOAuthScopes,
  type GalleryPermissionNsids,
} from "./oauth-permissions.js";

const nsids: GalleryPermissionNsids = {
  account: "com.example.atgallery.alpha.account",
  albumSnapshot: "com.example.atgallery.alpha.albumSnapshot",
  libraryAlbum: "com.example.atgallery.alpha.libraryAlbum",
  libraryMedia: "com.example.atgallery.alpha.libraryMedia",
  libraryMembership: "com.example.atgallery.alpha.libraryMembership",
  personalLibrarySpace: "com.example.atgallery.alpha.personalLibrary",
  publicationJob: "com.example.atgallery.alpha.publicationJob",
  publishedAlbum: "com.example.atgallery.alpha.publishedAlbum",
  publishedMedia: "com.example.atgallery.alpha.publishedMedia",
  publishedMembership: "com.example.atgallery.alpha.publishedMembership",
  transferEvent: "com.example.atgallery.alpha.transferEvent",
};

describe("buildGalleryOAuthPermissions", () => {
  it("requests only explicit public collections and media MIME types", () => {
    const permissions = buildGalleryOAuthPermissions(nsids);

    expect(permissions.scopes).toContain("repo:com.example.atgallery.alpha.account");
    expect(permissions.scopes).toContain("repo:com.example.atgallery.alpha.publishedAlbum");
    expect(permissions.scopes).not.toContain("repo:*");
    expect(permissions.scope).not.toContain("transition:generic");
    for (const mimeType of GALLERY_BLOB_MIME_TYPES) {
      expect(permissions.scope).toContain(`accept=${encodeURIComponent(mimeType)}`);
    }
    expect(permissions.scope).not.toContain("maxSize");
  });

  it("limits the personal Space to self-read, explicit collections, and lifecycle operations", () => {
    const { spaceScope } = buildGalleryOAuthPermissions(nsids);

    expect(spaceScope).toMatch(/^space:com\.example\.atgallery\.alpha\.personalLibrary\?/);
    expect(spaceScope).toContain("action=read");
    expect(spaceScope).toContain("action=read_self");
    expect(spaceScope).toContain(
      "collection=com.example.atgallery.alpha.libraryMedia",
    );
    expect(spaceScope).not.toContain("collection=*");
    expect(spaceScope).toContain("manage=create");
    expect(spaceScope).toContain("manage=delete");
  });

  it("rejects malformed NSIDs", () => {
    expect(() =>
      buildGalleryOAuthPermissions({ ...nsids, libraryMedia: "not-an-nsid" }),
    ).toThrow("Invalid NSID");
  });
});

describe("GALLERY_BLOB_MIME_TYPES", () => {
  it("stays equal to the domain policy's accepted image and video MIME sets", () => {
    expect([...GALLERY_BLOB_MIME_TYPES].sort()).toEqual(
      [...ACCEPTED_IMAGE_MIME_TYPES, ...ACCEPTED_VIDEO_MIME_TYPES].sort(),
    );
  });
});

describe("findMissingOAuthScopes", () => {
  it("identifies sessions that must be reauthorized", () => {
    expect(findMissingOAuthScopes("atproto repo:com.example.one", ["atproto", "blob"])).toEqual([
      "blob",
    ]);
  });
});
