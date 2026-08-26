import { Lexicons, type LexiconDoc } from "@atproto/lexicon";

export const LEXICON_SCHEMA_COLLECTION = "com.atproto.lexicon.schema";

export type LexiconPublicationRecord = Readonly<{
  collection: typeof LEXICON_SCHEMA_COLLECTION;
  rkey: string;
  record: LexiconDoc & { $type: typeof LEXICON_SCHEMA_COLLECTION };
}>;

/** Validates alpha schemas and converts them into public repository records. */
export function createLexiconPublicationRecords(
  schemas: readonly LexiconDoc[],
): readonly LexiconPublicationRecord[] {
  const seen = new Set<string>();
  for (const schema of schemas) {
    if (seen.has(schema.id)) throw new TypeError(`Duplicate Lexicon schema ID: ${schema.id}`);
    seen.add(schema.id);
  }

  new Lexicons(schemas);

  return schemas.map((schema) => {
    return {
      collection: LEXICON_SCHEMA_COLLECTION,
      rkey: schema.id,
      record: { $type: LEXICON_SCHEMA_COLLECTION, ...schema },
    };
  });
}
