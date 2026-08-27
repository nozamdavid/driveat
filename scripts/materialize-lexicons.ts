import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createAlphaLexiconSchemas } from "../packages/lexicons/src/schemas.js";

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function main(): Promise<void> {
  const namespaceAuthority = process.argv[2] ?? "am.noz.atgallery.alpha";
  const outputRoot = resolve(process.argv[3] ?? "lexicons");
  const schemas = createAlphaLexiconSchemas(namespaceAuthority);

  for (const schema of schemas) {
    const outputPath = resolve(outputRoot, `${schema.id.replaceAll(".", "/")}.json`);
    const contents = `${JSON.stringify(schema, null, 2)}\n`;

    await mkdir(dirname(outputPath), { recursive: true });

    try {
      const existing = await readFile(outputPath, "utf8");
      // Skipping unchanged files preserves their mtimes so watchers and build tools do not rebuild spuriously.
      if (existing === contents) continue;
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }

    await writeFile(outputPath, contents, "utf8");
  }

  console.log(`Materialized ${schemas.length} Lexicons for ${namespaceAuthority} in ${outputRoot}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
