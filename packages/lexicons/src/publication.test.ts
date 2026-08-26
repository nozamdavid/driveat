import { describe, expect, it } from "vitest";

import { createAlphaLexiconSchemas } from "./schemas.js";
import { createLexiconPublicationRecords } from "./publication.js";

describe("createLexiconPublicationRecords", () => {
  it("wraps the alpha Space declaration as an ordinary schema record", () => {
    const schemas = createAlphaLexiconSchemas("am.noz.atgallery.alpha");
    const records = createLexiconPublicationRecords(schemas);
    const space = records.find(
      ({ rkey }) => rkey === "am.noz.atgallery.alpha.personalLibrary",
    );

    expect(records).toHaveLength(11);
    expect(space?.collection).toBe("com.atproto.lexicon.schema");
    expect(space?.record.$type).toBe("com.atproto.lexicon.schema");
    expect(space?.record.defs.main?.type).toBe("space");
  });

  it("rejects duplicate schema IDs before any network write", () => {
    const schema = createAlphaLexiconSchemas("am.noz.atgallery.alpha")[0]!;

    expect(() => createLexiconPublicationRecords([schema, schema])).toThrow("Duplicate");
  });
});
