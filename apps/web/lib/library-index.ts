import type { Agent } from "@atproto/api";

import { fetchGatewayBlob, type MediaGatewayAccess } from "./media-gateway";
import type { LibraryWatermarks } from "./library-snapshot";
import {
  type LibraryAlbum,
  type LibraryMedia,
  type LibraryMembership,
} from "./private-library";

export type LibraryIndexBlobPayload = Readonly<{
  albums: readonly LibraryAlbum[];
  formatVersion: 1;
  generatedAt: string;
  media: readonly LibraryMedia[];
  memberships: readonly LibraryMembership[];
  watermark?: string | undefined;
  watermarks?: LibraryWatermarks | undefined;
}>;

export type LibraryIndexRecordValue = Readonly<{
  $type?: string;
  blob?: unknown;
  formatVersion: number;
  itemCount: number;
  updatedAt: string;
  watermark: string;
}>;

export type LibraryIndexTarget = Readonly<{
  albumCollection: string;
  indexCollection: string;
  libraryMediaCollection: string;
  membershipCollection: string;
  repo: string;
  space: string;
}>;

export function serializeLibraryIndexBlob(payload: LibraryIndexBlobPayload): Uint8Array {
  const json = JSON.stringify(payload);
  return new TextEncoder().encode(json);
}

export function parseLibraryIndexBlob(bytes: unknown): LibraryIndexBlobPayload | undefined {
  try {
    let parsed: Record<string, unknown>;
    if (bytes instanceof Uint8Array) {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    } else if (bytes instanceof ArrayBuffer) {
      parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as Record<string, unknown>;
    } else if (typeof bytes === "string") {
      parsed = JSON.parse(bytes) as Record<string, unknown>;
    } else if (bytes && typeof bytes === "object") {
      parsed = bytes as Record<string, unknown>;
    } else {
      return undefined;
    }

    if (!Array.isArray(parsed.media)) {
      return undefined;
    }

    const watermarks = parsed.watermarks && typeof parsed.watermarks === "object"
      ? {
          albums: typeof (parsed.watermarks as Record<string, unknown>).albums === "string" ? (parsed.watermarks as Record<string, unknown>).albums as string : undefined,
          media: typeof (parsed.watermarks as Record<string, unknown>).media === "string" ? (parsed.watermarks as Record<string, unknown>).media as string : undefined,
          memberships: typeof (parsed.watermarks as Record<string, unknown>).memberships === "string" ? (parsed.watermarks as Record<string, unknown>).memberships as string : undefined,
        }
      : undefined;

    return {
      formatVersion: 1,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : new Date().toISOString(),
      watermark: typeof parsed.watermark === "string" ? parsed.watermark : undefined,
      ...(watermarks ? { watermarks } : {}),
      media: Array.isArray(parsed.media) ? (parsed.media as readonly LibraryMedia[]) : [],
      albums: Array.isArray(parsed.albums) ? (parsed.albums as readonly LibraryAlbum[]) : [],
      memberships: Array.isArray(parsed.memberships) ? (parsed.memberships as readonly LibraryMembership[]) : [],
    };
  } catch {
    return undefined;
  }
}

export function extractBlobCid(blob: unknown): string | undefined {
  if (!blob || typeof blob !== "object") return undefined;
  const b = blob as Record<string, unknown>;
  if (typeof b.$link === "string") return b.$link;
  if (typeof b.cid === "string") return b.cid;
  if (b.ref) {
    if (typeof b.ref === "string") return b.ref;
    if (typeof b.ref === "object" && typeof (b.ref as Record<string, unknown>).$link === "string") {
      return (b.ref as Record<string, unknown>).$link as string;
    }
    if (typeof (b.ref as { toString?: () => string }).toString === "function") {
      const str = (b.ref as { toString: () => string }).toString();
      if (str && str !== "[object Object]") return str;
    }
  }
  return undefined;
}

export async function fetchRemoteLibraryIndex(
  agent: Agent,
  target: Readonly<{ indexCollection: string; repo: string; space: string }>,
  gatewayAccess: MediaGatewayAccess,
): Promise<LibraryIndexBlobPayload | undefined> {
  try {
    const response = await agent.com.atproto.space.getRecord({
      space: target.space,
      repo: target.repo,
      collection: target.indexCollection,
      rkey: "current",
    });

    const value = response.data.value as LibraryIndexRecordValue | undefined;
    const blobRef = extractBlobCid(value?.blob);
    if (!blobRef) {
      console.warn("No blob reference found in libraryIndex record:", value);
      return undefined;
    }

    const blobResp = await fetchGatewayBlob(gatewayAccess, blobRef, "application/json").catch(
      () => undefined,
    );

    if (!blobResp || !blobResp.ok) {
      console.warn("Failed to fetch blob bytes for libraryIndex:", blobResp?.status);
      return undefined;
    }

    const text = await blobResp.text();
    const json = JSON.parse(text) as unknown;

    const parsed = parseLibraryIndexBlob(json);
    if (!parsed) {
      console.warn("Failed to parse libraryIndex payload from blob JSON");
      return undefined;
    }
    return {
      ...parsed,
      watermark: (typeof value?.watermark === "string" && value.watermark.length > 0) ? value.watermark : parsed.watermark,
    };
  } catch (err) {
    console.warn("fetchRemoteLibraryIndex failed:", err);
    return undefined;
  }
}

export async function publishRemoteLibraryIndex(
  agent: Agent,
  target: Readonly<{ indexCollection: string; repo: string; space: string }>,
  payload: LibraryIndexBlobPayload,
): Promise<void> {
  const queueKey = `${target.space}\u0000${target.repo}\u0000${target.indexCollection}`;
  const previous = indexPublicationQueues.get(queueKey) ?? Promise.resolve();
  const publication = previous.catch(() => undefined).then(() => publishRemoteLibraryIndexNow(agent, target, payload));
  indexPublicationQueues.set(queueKey, publication);
  try {
    await publication;
  } finally {
    if (indexPublicationQueues.get(queueKey) === publication) indexPublicationQueues.delete(queueKey);
  }
}

const indexPublicationQueues = new Map<string, Promise<void>>();

async function publishRemoteLibraryIndexNow(
  agent: Agent,
  target: Readonly<{ indexCollection: string; repo: string; space: string }>,
  payload: LibraryIndexBlobPayload,
): Promise<void> {
  const bytes = serializeLibraryIndexBlob(payload);
  const blobUpload = await agent.uploadBlob(bytes, { encoding: "application/json" });

  const recordValue: LibraryIndexRecordValue = {
      $type: target.indexCollection,
      formatVersion: 1,
      itemCount: payload.media.length,
      updatedAt: new Date().toISOString(),
      watermark: payload.watermark ?? "",
      blob: blobUpload.data.blob,
    };

  await agent.com.atproto.space.applyWrites({
      space: target.space,
      repo: target.repo,
      writes: [
        {
          $type: "com.atproto.space.applyWrites#create",
          collection: target.indexCollection,
          rkey: "current",
          value: recordValue,
        },
      ],
  }).catch(async () => {
      // Fall back to update if record already exists
      await agent.com.atproto.space.applyWrites({
        space: target.space,
        repo: target.repo,
        writes: [
          {
            $type: "com.atproto.space.applyWrites#update",
            collection: target.indexCollection,
            rkey: "current",
            value: recordValue,
          },
        ],
      });
  });
}
