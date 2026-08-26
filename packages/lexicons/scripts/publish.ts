import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createLexiconPublicationRecords, LEXICON_SCHEMA_COLLECTION } from "../src/publication.js";
import { loginPublisher } from "../src/publisher-auth.js";
import { createAlphaLexiconSchemas } from "../src/schemas.js";

const NAMESPACE = "am.noz.atgallery.alpha";
const PUBLISHER_DID = "did:plc:lmkzmvv6sdxntwtyxpg7fqqq";
const PUBLISHER_IDENTIFIER = "noz.am";
const DIRECTORY_URL = "https://plc.directory";
const PUBLIC_API_URL = "https://public.api.bsky.app";

type DidDocument = Readonly<{
  id: string;
  service?: readonly Readonly<{ id: string; type: string; serviceEndpoint: string }>[];
}>;
type RepoRecord = Readonly<{ cid: string; uri: string; value: unknown }>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function responseJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`${action} failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}

async function resolvePublisherPds(): Promise<string> {
  const handleUrl = new URL("/xrpc/com.atproto.identity.resolveHandle", PUBLIC_API_URL);
  handleUrl.searchParams.set("handle", PUBLISHER_IDENTIFIER);
  const resolved = await responseJson<{ did: string }>(await fetch(handleUrl), "Handle resolution");
  if (resolved.did !== PUBLISHER_DID) {
    throw new Error(`@${PUBLISHER_IDENTIFIER} resolved to ${resolved.did}, expected ${PUBLISHER_DID}.`);
  }

  const document = await responseJson<DidDocument>(
    await fetch(`${DIRECTORY_URL}/${encodeURIComponent(PUBLISHER_DID)}`),
    "DID resolution",
  );
  const pds = document.service?.find(
    (service) => service.id === "#atproto_pds" && service.type === "AtprotoPersonalDataServer",
  );
  if (!pds) throw new Error(`No AT Protocol PDS service is declared by ${PUBLISHER_DID}.`);
  return pds.serviceEndpoint.replace(/\/$/, "");
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Set ATGALLERY_PUBLISHER_APP_PASSWORD when running without an interactive terminal.");
  }

  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return await new Promise<string>((resolvePrompt, reject) => {
    let secret = "";
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Publishing cancelled."));
          return;
        } else if (character === "\r" || character === "\n") {
          finish();
          resolvePrompt(secret);
          return;
        } else if (character === "\u007f" || character === "\b") {
          secret = secret.slice(0, -1);
        } else if (character >= " ") {
          secret += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function getRecord(pds: string, rkey: string): Promise<RepoRecord | undefined> {
  const url = new URL("/xrpc/com.atproto.repo.getRecord", pds);
  url.searchParams.set("repo", PUBLISHER_DID);
  url.searchParams.set("collection", LEXICON_SCHEMA_COLLECTION);
  url.searchParams.set("rkey", rkey);
  const response = await fetch(url);
  if (response.status === 400) {
    const body = (await response.clone().json().catch(() => undefined)) as
      | { error?: string }
      | undefined;
    if (body?.error === "RecordNotFound") return undefined;
  }
  return responseJson<RepoRecord>(response, `Reading ${rkey}`);
}

async function putRecord(
  pds: string,
  accessJwt: string,
  rkey: string,
  record: unknown,
  existingCid?: string,
): Promise<RepoRecord> {
  return responseJson<RepoRecord>(
    await fetch(`${pds}/xrpc/com.atproto.repo.putRecord`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessJwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repo: PUBLISHER_DID,
        collection: LEXICON_SCHEMA_COLLECTION,
        rkey,
        record,
        ...(existingCid ? { swapRecord: existingCid } : {}),
      }),
    }),
    `Publishing ${rkey}`,
  );
}

async function assertMaterializedSchemas(records: ReturnType<typeof createLexiconPublicationRecords>) {
  for (const { rkey, record } of records) {
    const path = resolve("lexicons", ...rkey.split(".")) + ".json";
    const materialized = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const { $type: _type, ...schema } = record;
    if (canonicalJson(materialized) !== canonicalJson(schema)) {
      throw new Error(`${path} is stale; run pnpm lexicons:materialize first.`);
    }
  }
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const allowUpdate = process.argv.includes("--update");
  const records = createLexiconPublicationRecords(createAlphaLexiconSchemas(NAMESPACE));
  await assertMaterializedSchemas(records);

  console.log(`Validated ${records.length} alpha Lexicons for ${PUBLISHER_DID}.`);
  if (!write) {
    console.log("Dry run only. Re-run with --write to authenticate, publish, and verify them.");
    return;
  }

  const pds = await resolvePublisherPds();
  const password =
    process.env.ATGALLERY_PUBLISHER_APP_PASSWORD ??
    (await promptSecret(`App password for @${PUBLISHER_IDENTIFIER}: `));
  if (!password) throw new Error("An app password is required.");
  const session = await loginPublisher({
    pds,
    identifier: PUBLISHER_IDENTIFIER,
    password,
    expectedDid: PUBLISHER_DID,
    getAuthFactorToken: async () =>
      process.env.ATGALLERY_PUBLISHER_AUTH_FACTOR_TOKEN ??
      (await promptSecret("Sign-in code from email: ")),
  });

  for (const { rkey, record } of records) {
    const existing = await getRecord(pds, rkey);
    if (existing && canonicalJson(existing.value) === canonicalJson(record)) {
      console.log(`✓ ${rkey} already matches`);
      continue;
    }
    if (existing && !allowUpdate) {
      throw new Error(`${rkey} already exists with different content; review and re-run with --update.`);
    }

    const published = await putRecord(pds, session.accessJwt, rkey, record, existing?.cid);
    console.log(`✓ ${existing ? "updated" : "created"} ${published.uri}`);
  }

  for (const { rkey, record } of records) {
    const published = await getRecord(pds, rkey);
    if (!published || canonicalJson(published.value) !== canonicalJson(record)) {
      throw new Error(`Read-back verification failed for ${rkey}.`);
    }
  }
  console.log(`Verified all ${records.length} published Lexicons.`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lexicon publication failed: ${message}`);
  process.exitCode = 1;
});
