import type { LexBlob, LexiconDoc, LexInteger, LexObject } from "@atproto/lexicon";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  ACCEPTED_VIDEO_MIME_TYPES,
  MEDIA_LIMITS,
  OPERATIONAL_LIMITS,
} from "@atgallery/domain";
import { Lexicons } from "@atproto/lexicon";
import { describe, expect, it } from "vitest";

import { createExperimentalNsids } from "./nsids.js";
import { ALPHA_MEDIA_SCHEMA_LIMITS, createAlphaLexiconSchemas } from "./schemas.js";

function schemaEndingWith(schemas: readonly LexiconDoc[], suffix: string): LexiconDoc {
  const schema = schemas.find((candidate) => candidate.id.endsWith(suffix));
  if (!schema) throw new Error(`Expected a schema ending with ${suffix}.`);
  return schema;
}

function recordProperties(schema: LexiconDoc): NonNullable<LexObject["properties"]> {
  const main = schema.defs.main;
  if (!main || main.type !== "record") {
    throw new Error(`Expected a record definition in ${schema.id}.`);
  }
  if (!main.record.properties) {
    throw new Error(`Expected properties in ${schema.id}.`);
  }
  return main.record.properties;
}

function blobProperty(properties: ReturnType<typeof recordProperties>, name: string): LexBlob {
  const property = properties[name];
  if (!property || property.type !== "blob") {
    throw new Error(`Expected a blob property ${name}.`);
  }
  return property;
}

function integerProperty(properties: ReturnType<typeof recordProperties>, name: string): LexInteger {
  const property = properties[name];
  if (!property || property.type !== "integer") {
    throw new Error(`Expected an integer property ${name}.`);
  }
  return property;
}

describe("createAlphaLexiconSchemas", () => {
  it("builds one valid schema for every declared alpha NSID", () => {
    const nsids = createExperimentalNsids("com.example.atgallery.alpha");
    const schemas = createAlphaLexiconSchemas("com.example.atgallery.alpha");
    const lexicons = new Lexicons(schemas);

    expect(schemas.map((schema) => schema.id).sort()).toEqual(Object.values(nsids).sort());
    expect(Array.from(lexicons)).toHaveLength(12);
  });

  it("declares the private Space consent name and exact private collections", () => {
    const nsids = createExperimentalNsids("com.example.atgallery.alpha");
    const schemas = createAlphaLexiconSchemas("com.example.atgallery.alpha");
    const space = schemaEndingWith(schemas, ".personalLibrary");
    const main = space.defs.main;

    if (!main) throw new Error("Expected a main definition.");
    expect(main.type).toBe("space");
    if (main.type !== "space") throw new Error("Expected a Space declaration.");
    expect(main.name).toBe("ATGallery private Library");
    expect(main.key).toBe("literal:library");
    expect(main.collections).toEqual([
      nsids.libraryMedia,
      nsids.libraryAlbum,
      nsids.libraryMembership,
      nsids.libraryIndex,
      nsids.publicationJob,
      nsids.transferEvent,
    ]);
  });

  it("keeps schema blob ceilings aligned with the product contract", () => {
    expect(ALPHA_MEDIA_SCHEMA_LIMITS).toEqual({
      imageBytes: MEDIA_LIMITS.imageOriginalBytes,
      previewBytes: MEDIA_LIMITS.previewBytes,
      videoBytes: MEDIA_LIMITS.videoOriginalBytes,
    });
  });

  it("keeps schema MIME accept lists and ceilings aligned with the domain policy", () => {
    const schemas = createAlphaLexiconSchemas("com.example.atgallery.alpha");
    const libraryMedia = recordProperties(schemaEndingWith(schemas, ".libraryMedia"));
    const albumSnapshot = recordProperties(schemaEndingWith(schemas, ".albumSnapshot"));

    expect(blobProperty(libraryMedia, "original").accept?.slice().sort()).toEqual(
      [...ACCEPTED_IMAGE_MIME_TYPES, ...ACCEPTED_VIDEO_MIME_TYPES].sort(),
    );
    expect(blobProperty(libraryMedia, "original").maxSize).toBe(MEDIA_LIMITS.videoOriginalBytes);
    expect(blobProperty(libraryMedia, "preview").accept).toEqual(["image/webp"]);
    expect(blobProperty(libraryMedia, "preview").maxSize).toBe(MEDIA_LIMITS.previewBytes);
    expect(integerProperty(libraryMedia, "durationMilliseconds").maximum).toBe(
      MEDIA_LIMITS.videoDurationSeconds * 1_000,
    );
    expect(integerProperty(albumSnapshot, "itemCount").maximum).toBe(OPERATIONAL_LIMITS.albumItems);
  });
});
