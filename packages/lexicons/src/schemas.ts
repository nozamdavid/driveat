import type { LexiconDoc, LexObject } from "@atproto/lexicon";

import { createExperimentalNsids } from "./nsids.js";

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MEDIA_MIMES = [...IMAGE_MIMES, "video/mp4"];
const IMAGE_LIMIT = 25 * 1024 * 1024;
const VIDEO_LIMIT = 50 * 1024 * 1024;
const PREVIEW_LIMIT = 1024 * 1024;

type Properties = LexObject["properties"];

function formatVersion() {
  return { type: "integer" as const, const: 1 };
}

function datetime() {
  return { type: "string" as const, format: "datetime" as const };
}

function atUri(description: string) {
  return { type: "string" as const, format: "at-uri" as const, description };
}

function record(
  id: string,
  description: string,
  required: readonly string[],
  properties: Properties,
  key = "tid",
  additionalDefs: Record<string, LexObject> = {},
): LexiconDoc {
  return {
    lexicon: 1,
    id: id as LexiconDoc["id"],
    defs: {
      main: {
        type: "record",
        description,
        key,
        record: { type: "object", required: [...required], properties },
      },
      ...additionalDefs,
    },
  };
}

/** Builds the complete alpha publication bundle for a selected DNS-backed NSID base. */
export function createAlphaLexiconSchemas(namespaceAuthority: string): readonly LexiconDoc[] {
  const nsids = createExperimentalNsids(namespaceAuthority);

  const personalLibrary: LexiconDoc = {
    lexicon: 1,
    id: nsids.personalLibrarySpace as LexiconDoc["id"],
    defs: {
      main: {
        type: "space",
        description: "An owner's private ATGallery media Library and album organization.",
        key: "literal:library",
        name: "ATGallery private Library",
        collections: [
          nsids.libraryMedia,
          nsids.libraryAlbum,
          nsids.libraryMembership,
          nsids.publicationJob,
          nsids.transferEvent,
        ],
      },
    },
  };

  const libraryMedia = record(
    nsids.libraryMedia,
    "A private media original and its safe local preview.",
    [
      "formatVersion",
      "mediaKind",
      "original",
      "originalFilename",
      "originalMime",
      "originalSize",
      "preview",
      "createdAt",
    ],
    {
      formatVersion: formatVersion(),
      mediaKind: { type: "string", maxLength: 16, knownValues: ["image", "video"] },
      original: { type: "blob", accept: MEDIA_MIMES, maxSize: VIDEO_LIMIT },
      originalFilename: { type: "string", maxLength: 1024 },
      originalMime: { type: "string", maxLength: 100, knownValues: MEDIA_MIMES },
      originalSize: { type: "integer", minimum: 1, maximum: VIDEO_LIMIT },
      preview: { type: "blob", accept: ["image/webp"], maxSize: PREVIEW_LIMIT },
      sha256: { type: "string", minLength: 64, maxLength: 64 },
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
      durationMilliseconds: { type: "integer", minimum: 1, maximum: 60_000 },
      extractedMetadata: { type: "unknown" },
      notes: { type: "string", maxLength: 20_000 },
      createdAt: datetime(),
    },
  );

  const libraryAlbum = record(
    nsids.libraryAlbum,
    "A private flat album in the owner's Library.",
    ["formatVersion", "title", "sort", "createdAt", "updatedAt"],
    {
      formatVersion: formatVersion(),
      title: { type: "string", minGraphemes: 1, maxGraphemes: 200 },
      description: { type: "string", maxGraphemes: 5_000 },
      sort: {
        type: "string",
        maxLength: 32,
        knownValues: ["manual", "capture-time", "filename", "added-time"],
      },
      coverMembership: atUri("Private membership record used as this album's cover."),
      createdAt: datetime(),
      updatedAt: datetime(),
    },
  );

  const libraryMembership = record(
    nsids.libraryMembership,
    "A private many-to-many placement of one media item in one album.",
    ["formatVersion", "album", "media", "position", "addedAt"],
    {
      formatVersion: formatVersion(),
      album: atUri("Private Library album record."),
      media: atUri("Private Library media record."),
      position: { type: "integer", minimum: 0 },
      captionOverride: { type: "string", maxGraphemes: 5_000 },
      altTextOverride: { type: "string", maxGraphemes: 2_000 },
      decorativeOverride: { type: "boolean" },
      addedAt: datetime(),
    },
  );

  const publicationJob = record(
    nsids.publicationJob,
    "A resumable private state machine for publishing an immutable album snapshot.",
    ["formatVersion", "album", "status", "createdAt", "updatedAt"],
    {
      formatVersion: formatVersion(),
      album: atUri("Private Library album being published."),
      status: {
        type: "string",
        maxLength: 32,
        knownValues: ["planned", "uploading", "writing", "activating", "verifying", "complete", "failed"],
      },
      intendedSnapshot: { type: "unknown" },
      publishedAlbum: atUri("Stable public published-album record, when allocated."),
      publishedSnapshot: atUri("Public immutable snapshot record, when allocated."),
      failureCode: { type: "string", maxLength: 200 },
      createdAt: datetime(),
      updatedAt: datetime(),
      completedAt: datetime(),
    },
  );

  const transferEvent = record(
    nsids.transferEvent,
    "An advisory immutable transfer event used for rolling client-side quotas.",
    ["formatVersion", "operation", "logicalBytes", "blobOperations", "itemCount", "createdAt"],
    {
      formatVersion: formatVersion(),
      operation: { type: "string", maxLength: 16, knownValues: ["ingest", "publish"] },
      logicalBytes: { type: "integer", minimum: 0 },
      blobOperations: { type: "integer", minimum: 0 },
      itemCount: { type: "integer", minimum: 0 },
      createdAt: datetime(),
    },
  );

  const publishedMedia = record(
    nsids.publishedMedia,
    "An immutable, public, metadata-allowlisted media rendition.",
    ["formatVersion", "mediaKind", "rendition", "mime", "size", "createdAt"],
    {
      formatVersion: formatVersion(),
      mediaKind: { type: "string", maxLength: 16, knownValues: ["image", "video"] },
      rendition: { type: "blob", accept: MEDIA_MIMES, maxSize: VIDEO_LIMIT },
      preview: { type: "blob", accept: ["image/webp"], maxSize: PREVIEW_LIMIT },
      mime: { type: "string", maxLength: 100, knownValues: MEDIA_MIMES },
      size: { type: "integer", minimum: 1, maximum: VIDEO_LIMIT },
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
      durationMilliseconds: { type: "integer", minimum: 1, maximum: 60_000 },
      defaultCaption: { type: "string", maxGraphemes: 5_000 },
      defaultAltText: { type: "string", maxGraphemes: 2_000 },
      decorative: { type: "boolean" },
      contentWarnings: {
        type: "array",
        maxLength: 20,
        items: { type: "string", maxLength: 200 },
      },
      createdAt: datetime(),
    },
  );

  const albumSnapshot = record(
    nsids.albumSnapshot,
    "An immutable public publication boundary for one album version.",
    ["formatVersion", "album", "itemCount", "createdAt"],
    {
      formatVersion: formatVersion(),
      album: atUri("Stable public published-album record."),
      itemCount: { type: "integer", minimum: 0, maximum: 1_000 },
      createdAt: datetime(),
    },
  );

  const publishedAlbum = record(
    nsids.publishedAlbum,
    "The stable public identity and active snapshot pointer for a published album.",
    ["formatVersion", "title", "currentSnapshot", "createdAt", "updatedAt"],
    {
      formatVersion: formatVersion(),
      title: { type: "string", minGraphemes: 1, maxGraphemes: 200 },
      description: { type: "string", maxGraphemes: 5_000 },
      currentSnapshot: atUri("The active immutable album snapshot."),
      coverMembership: atUri("Published membership used as the cover."),
      createdAt: datetime(),
      updatedAt: datetime(),
    },
    "any",
  );

  const publishedMembership = record(
    nsids.publishedMembership,
    "An immutable public ordered placement of one published media version in a snapshot.",
    ["formatVersion", "snapshot", "media", "position", "createdAt"],
    {
      formatVersion: formatVersion(),
      snapshot: atUri("Immutable public album snapshot."),
      media: atUri("Immutable public published-media record."),
      position: { type: "integer", minimum: 0, maximum: 999 },
      caption: { type: "string", maxGraphemes: 5_000 },
      altText: { type: "string", maxGraphemes: 2_000 },
      decorative: { type: "boolean" },
      contentWarnings: {
        type: "array",
        maxLength: 20,
        items: { type: "string", maxLength: 200 },
      },
      createdAt: datetime(),
    },
  );

  const account = record(
    nsids.account,
    "A public self-declaration record for an account using ATGallery.",
    ["formatVersion", "createdAt"],
    {
      formatVersion: formatVersion(),
      createdAt: datetime(),
      client: { type: "string", maxLength: 100 },
    },
    "literal:self",
  );

  // Keep deterministic dependency order for review and publication tooling.
  return [
    account,
    personalLibrary,
    libraryMedia,
    libraryAlbum,
    libraryMembership,
    publicationJob,
    transferEvent,
    publishedMedia,
    albumSnapshot,
    publishedAlbum,
    publishedMembership,
  ];
}

export const ALPHA_MEDIA_SCHEMA_LIMITS = Object.freeze({
  imageBytes: IMAGE_LIMIT,
  previewBytes: PREVIEW_LIMIT,
  videoBytes: VIDEO_LIMIT,
});
