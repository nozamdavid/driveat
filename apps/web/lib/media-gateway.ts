export type DelegationClient =
  | Readonly<{
      getDelegationToken: (params: { space: string }) => Promise<{ data: { token: string } }>;
    }>
  | ((pathname: string, init?: RequestInit) => Promise<Response>);

async function obtainDelegationToken(
  client: DelegationClient,
  space: string,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof client === "function") {
    const query = new URLSearchParams({ space });
    const response = await client(
      `/xrpc/com.atproto.space.getDelegationToken?${query.toString()}`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      const details = [errorBody.error, errorBody.message].filter(Boolean).join(": ");
      throw new Error(
        `Failed to obtain space delegation token${details ? `: ${details}` : ` with HTTP ${response.status}`}.`,
      );
    }
    const data = (await response.json()) as { token?: string; delegationToken?: string };
    const token = data.token ?? data.delegationToken;
    if (!token) throw new Error("Delegation token response did not contain a token.");
    return token;
  }
  const result = await client.getDelegationToken({ space });
  return result.data.token;
}

export type MediaGatewayAccess = Readonly<{
  baseUrl: string;
  expiresAt: string;
  repo: string;
  space: string;
  token: string;
}>;

export function resolveMediaGatewayUrl(configured: string | undefined): string | undefined {
  const value = configured?.trim();
  if (!value) return undefined;
  try {
    const candidate =
      value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
    const url = new URL(candidate);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new TypeError("The media gateway must use HTTPS, except on a loopback hostname.");
    }
    return url.origin;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes("HTTPS")) throw err;
    throw new TypeError(`Invalid media gateway URL: ${value}`);
  }
}

export async function connectMediaGateway(input: Readonly<{
  baseUrl: string;
  delegationClient: DelegationClient;
  repo: string;
  space: string;
}>): Promise<MediaGatewayAccess> {
  const signal = AbortSignal.timeout(15_000);
  const delegationToken = await obtainDelegationToken(input.delegationClient, input.space, signal);
  const response = await fetch(`${input.baseUrl}/v1/spaces/connect`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ space: input.space, repo: input.repo, delegationToken }),
  });
  const result = await responseJson<{ token?: string; expiresAt?: string; error?: string }>(response);
  if (!response.ok || !result.token || !result.expiresAt) {
    throw new Error(`Media gateway connection failed${result.error ? `: ${result.error}` : ` with HTTP ${response.status}`}.`);
  }
  return { baseUrl: input.baseUrl, token: result.token, expiresAt: result.expiresAt, repo: input.repo, space: input.space };
}

export async function fetchGatewayBlob(
  access: MediaGatewayAccess,
  cid: string,
  expectedMime?: string,
): Promise<Response> {
  const mediaId = await mediaGatewayId(access.space, access.repo, cid);
  if (expectedMime === "image/webp") {
    return enqueuePreviewFetch(access, { mediaId, cid });
  }
  await ensureGatewayBlobRegistered(access, { cid, ...(expectedMime ? { expectedMime } : {}) });
  const authorization = `Bearer ${access.token}`;
  return fetch(`${access.baseUrl}/media/${mediaId}`, { headers: { authorization } });
}

export type PreviewFetchTarget = Readonly<{
  cid: string;
  mediaId: string;
}>;

type PreviewFetchWaiter = Readonly<{
  target: PreviewFetchTarget;
  resolve: (response: Response) => void;
  reject: (reason?: unknown) => void;
}>;

type PreviewFetchQueue = { waiters: PreviewFetchWaiter[]; timer?: ReturnType<typeof setTimeout> };
export const MEDIA_BATCH_SIZE = 10;
const MEDIA_BATCH_DEBOUNCE_MS = 250;
const previewQueuesByAccess = new WeakMap<MediaGatewayAccess, PreviewFetchQueue>();

function enqueuePreviewFetch(access: MediaGatewayAccess, target: PreviewFetchTarget): Promise<Response> {
  const queue: PreviewFetchQueue = previewQueuesByAccess.get(access) ?? { waiters: [] };
  previewQueuesByAccess.set(access, queue);
  const completion = new Promise<Response>((resolve, reject) => queue.waiters.push({ target, resolve, reject }));
  if (queue.timer !== undefined) clearTimeout(queue.timer);
  if (queue.waiters.length >= MEDIA_BATCH_SIZE) {
    void flushPreviewFetchQueue(access, queue);
  } else {
    queue.timer = setTimeout(() => void flushPreviewFetchQueue(access, queue), MEDIA_BATCH_DEBOUNCE_MS);
  }
  return completion;
}

async function flushPreviewFetchQueue(access: MediaGatewayAccess, queue: PreviewFetchQueue): Promise<void> {
  if (queue.timer !== undefined) clearTimeout(queue.timer);
  previewQueuesByAccess.delete(access);
  for (let offset = 0; offset < queue.waiters.length; offset += MEDIA_BATCH_SIZE) {
    const waiters = queue.waiters.slice(offset, offset + MEDIA_BATCH_SIZE);
    try {
      const response = await fetch(`${access.baseUrl}/v1/media/batch`, {
        method: "POST",
        headers: { authorization: `Bearer ${access.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          items: waiters.map((waiter) => ({
            mediaId: waiter.target.mediaId,
            cid: waiter.target.cid,
            space: access.space,
            repo: access.repo,
          })),
        }),
      });
      if (!response.ok) throw new Error(`Media batch request returned HTTP ${response.status}.`);
      const items = decodeMediaBatch(await response.arrayBuffer());
      for (const waiter of waiters) {
        const item = items.get(waiter.target.mediaId);
        if (!item) {
          waiter.reject(new Error("Media batch response omitted an image."));
        } else if (item.status !== 200 || item.bytes === undefined) {
          waiter.resolve(Response.json({ error: item.error ?? "blob-fetch-failed" }, { status: item.status }));
        } else {
          waiter.resolve(new Response(Uint8Array.from(item.bytes).buffer, { status: 200, headers: { "content-type": item.mime ?? "image/webp" } }));
        }
      }
    } catch (error) {
      waiters.forEach((waiter) => waiter.reject(error));
    }
  }
}

type DecodedBatchItem = Readonly<{ status: number; mime?: string; error?: string; bytes?: Uint8Array }>;

function decodeMediaBatch(buffer: ArrayBuffer): Map<string, DecodedBatchItem> {
  if (buffer.byteLength < 4) throw new Error("Media batch response is truncated.");
  const manifestLength = new DataView(buffer).getUint32(0, false);
  if (manifestLength <= 0 || 4 + manifestLength > buffer.byteLength) throw new Error("Media batch manifest is invalid.");
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, manifestLength))) as {
    version?: number;
    items?: Array<{ mediaId?: string; status?: number; mime?: string; error?: string; offset?: number; length?: number }>;
  };
  if (manifest.version !== 1 || !Array.isArray(manifest.items)) throw new Error("Media batch version is unsupported.");
  const bodyOffset = 4 + manifestLength;
  const output = new Map<string, DecodedBatchItem>();
  for (const item of manifest.items) {
    if (typeof item.mediaId !== "string" || typeof item.status !== "number") throw new Error("Media batch item is invalid.");
    if (item.status === 200) {
      if (!Number.isSafeInteger(item.offset) || !Number.isSafeInteger(item.length) || item.offset! < 0 || item.length! < 0 || bodyOffset + item.offset! + item.length! > buffer.byteLength) {
        throw new Error("Media batch byte range is invalid.");
      }
      output.set(item.mediaId, { status: item.status, ...(item.mime ? { mime: item.mime } : {}), bytes: new Uint8Array(buffer.slice(bodyOffset + item.offset!, bodyOffset + item.offset! + item.length!)) });
    } else {
      output.set(item.mediaId, { status: item.status, ...(item.error ? { error: item.error } : {}) });
    }
  }
  return output;
}

type RegistrationQueue = {
  blobs: Map<string, Readonly<{ cid: string; expectedMime?: string }>>;
  rejecters: Array<(reason?: unknown) => void>;
  resolvers: Array<() => void>;
  scheduled: boolean;
};

const registeredByAccess = new WeakMap<MediaGatewayAccess, Set<string>>();
const queuesByAccess = new WeakMap<MediaGatewayAccess, RegistrationQueue>();

async function ensureGatewayBlobRegistered(
  access: MediaGatewayAccess,
  blob: Readonly<{ cid: string; expectedMime?: string }>,
): Promise<void> {
  const registered = registeredByAccess.get(access) ?? new Set<string>();
  registeredByAccess.set(access, registered);
  if (registered.has(blob.cid)) return;

  const queue: RegistrationQueue = queuesByAccess.get(access) ?? {
    blobs: new Map<string, Readonly<{ cid: string; expectedMime?: string }>>(),
    rejecters: [], resolvers: [], scheduled: false,
  };
  queuesByAccess.set(access, queue);
  queue.blobs.set(blob.cid, blob);
  const completion = new Promise<void>((resolve, reject) => {
    queue.resolvers.push(resolve);
    queue.rejecters.push(reject);
  });
  if (!queue.scheduled) {
    queue.scheduled = true;
    queueMicrotask(() => void flushRegistrationQueue(access, queue, registered));
  }
  return completion;
}

async function flushRegistrationQueue(
  access: MediaGatewayAccess,
  queue: RegistrationQueue,
  registered: Set<string>,
): Promise<void> {
  queuesByAccess.delete(access);
  try {
    const blobs = [...queue.blobs.values()];
    await registerGatewayBlobs(access, blobs);
    blobs.forEach((blob) => registered.add(blob.cid));
    queue.resolvers.forEach((resolve) => resolve());
  } catch (error) {
    queue.rejecters.forEach((reject) => reject(error));
  }
}

export async function registerGatewayBlobs(
  access: MediaGatewayAccess,
  blobs: readonly Readonly<{ cid: string; expectedMime?: string }>[],
): Promise<void> {
  const authorization = `Bearer ${access.token}`;
  const unique = new Map(blobs.map((blob) => [blob.cid, blob]));
  const entries = [...unique.values()];
  for (let offset = 0; offset < entries.length; offset += 100) {
    const batch = await Promise.all(entries.slice(offset, offset + 100).map(async (blob) => ({
      mediaId: await mediaGatewayId(access.space, access.repo, blob.cid),
      space: access.space,
      repo: access.repo,
      cid: blob.cid,
      ...(blob.expectedMime ? { expectedMime: blob.expectedMime } : {}),
    })));
    const response = await fetch(`${access.baseUrl}/v1/media`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      const result = await responseJson<{ error?: string }>(response);
      throw new Error(`Media gateway registration failed${result.error ? `: ${result.error}` : ` with HTTP ${response.status}`}.`);
    }
  }
}

export async function mediaGatewayId(space: string, repo: string, cid: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${space}\u0000${repo}\u0000${cid}`));
  return `media_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; } catch { return {} as T; }
}
