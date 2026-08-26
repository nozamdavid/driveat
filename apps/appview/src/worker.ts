import { SpaceCredentialBroker } from "./broker.js";
import { bearer, errorResponse, HttpError, json, readJson } from "./http.js";
import { createSessionToken, verifySessionToken } from "./jose.js";
import { encodeMediaBatch, type MediaBatchItem } from "./media-batch.js";
import { MediaRegistry } from "./registry.js";
import { parseSpace } from "./resolver.js";
import type { Env, MediaMapping, SessionClaims } from "./types.js";

export { MediaRegistry, SpaceCredentialBroker };

const ISSUER = "atgallery-media-gateway";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestOrigin = request.headers.get("origin") ?? undefined;
    const origin = allowedOrigin(request, env);
    if (requestOrigin !== undefined && origin === undefined) return json({ error: "origin-not-allowed" }, 403);
    if (request.method === "OPTIONS") {
      return origin === undefined ? json({ error: "origin-not-allowed" }, 403) : cors(new Response(null, { status: 204 }), origin);
    }
    try {
      const response = await route(request, env);
      return origin === undefined ? response : cors(response, origin);
    } catch (error) {
      const response = errorResponse(error);
      return origin === undefined ? response : cors(response, origin);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ service: "atgallery-media-gateway", status: "alive" });
  }
  if (request.method === "POST" && url.pathname === "/v1/test/sessions") return issueTestSession(request, env);
  if (request.method === "PUT" && url.pathname.startsWith("/v1/admin/media/")) return registerMedia(request, env, url.pathname.slice(16));
  if (request.method === "POST" && url.pathname === "/v1/spaces/connect") return connectSpace(request, env);
  if (request.method === "POST" && url.pathname === "/v1/spaces/credential") return bootstrapCredential(request, env);
  if (request.method === "POST" && url.pathname === "/v1/media") return registerAuthorizedMediaBatch(request, env);
  if (request.method === "POST" && url.pathname === "/v1/media/batch") return serveMediaBatch(request, env);
  if (request.method === "PUT" && url.pathname.startsWith("/v1/media/")) return registerAuthorizedMedia(request, env, url.pathname.slice(10));
  if (request.method === "GET" && url.pathname.startsWith("/media/")) return serveMedia(request, env, url.pathname.slice(7));
  return json({ error: "not-found" }, 404);
}

async function connectSpace(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ space?: string; repo?: string; delegationToken?: string; clientAttestation?: string }>(request);
  if (body.space === undefined || body.repo === undefined || body.delegationToken === undefined || !body.repo.startsWith("did:")) {
    throw new HttpError(400, "invalid-space-connection");
  }
  parseSpace(body.space);
  const exchange = await broker(env, body.space).fetch(new Request("https://broker/bootstrap", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  if (!exchange.ok) return exchange;
  const result = await exchange.json() as { expiresAt: string };
  const credentialExpiry = Date.parse(result.expiresAt);
  const expiresAt = Math.min(Date.now() + 60 * 60 * 1000, credentialExpiry - 30_000);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new HttpError(502, "credential-expiry-invalid");
  const claims: SessionClaims = {
    sub: body.repo, spaces: [body.space], exp: Math.floor(expiresAt / 1000), iss: env.SESSION_ISSUER ?? ISSUER,
  };
  const token = await createSessionToken(claims, required(env.ATGALLERY_SESSION_SECRET, "session-secret-missing"));
  return json({ token, expiresAt: new Date(expiresAt).toISOString() }, 201);
}

async function issueTestSession(request: Request, env: Env): Promise<Response> {
  requireAdmin(request, env);
  const body = await readJson<{ subject?: string; spaces?: string[]; ttlSeconds?: number }>(request);
  if (body.subject === undefined || !Array.isArray(body.spaces) || body.spaces.length === 0) throw new HttpError(400, "invalid-session-request");
  body.spaces.forEach(parseSpace);
  const ttl = Math.min(3600, Math.max(60, body.ttlSeconds ?? 900));
  const claims: SessionClaims = {
    sub: body.subject, spaces: body.spaces,
    exp: Math.floor(Date.now() / 1000) + ttl,
    iss: env.SESSION_ISSUER ?? ISSUER,
  };
  const token = await createSessionToken(claims, required(env.ATGALLERY_SESSION_SECRET, "session-secret-missing"));
  const response = json({ token, expiresAt: new Date(claims.exp * 1000).toISOString() }, 201);
  response.headers.append("set-cookie", `__Host-atgallery_session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${ttl}`);
  return response;
}

async function registerMedia(request: Request, env: Env, encodedId: string): Promise<Response> {
  requireAdmin(request, env);
  const mediaId = decodeURIComponent(encodedId);
  const body = await readJson<Omit<MediaMapping, "mediaId">>(request);
  parseSpace(body.space);
  if (!body.repo.startsWith("did:") || !body.cid.startsWith("b")) throw new HttpError(400, "invalid-media-mapping");
  const mapping: MediaMapping = { mediaId, space: body.space, repo: body.repo, cid: body.cid, ...(body.expectedMime === undefined ? {} : { expectedMime: body.expectedMime }) };
  return registry(env).fetch(new Request(`https://registry/${encodeURIComponent(mediaId)}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(mapping),
  }));
}

async function registerAuthorizedMedia(request: Request, env: Env, encodedId: string): Promise<Response> {
  const claims = await requireSession(request, env);
  const mediaId = decodeURIComponent(encodedId);
  const body = await readJson<Omit<MediaMapping, "mediaId">>(request);
  if (!claims.spaces.includes(body.space) || body.repo !== claims.sub) throw new HttpError(403, "media-mapping-not-authorized");
  parseSpace(body.space);
  if (!body.cid.startsWith("b")) throw new HttpError(400, "invalid-media-mapping");
  const mapping: MediaMapping = { mediaId, space: body.space, repo: body.repo, cid: body.cid, ...(body.expectedMime === undefined ? {} : { expectedMime: body.expectedMime }) };
  return registry(env).fetch(new Request(`https://registry/${encodeURIComponent(mediaId)}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(mapping),
  }));
}

async function registerAuthorizedMediaBatch(request: Request, env: Env): Promise<Response> {
  const claims = await requireSession(request, env);
  const mappings = await readJson<MediaMapping[]>(request);
  if (mappings.length === 0 || mappings.length > 100) throw new HttpError(400, "invalid-media-batch");
  for (const mapping of mappings) {
    if (!claims.spaces.includes(mapping.space) || mapping.repo !== claims.sub) throw new HttpError(403, "media-mapping-not-authorized");
    parseSpace(mapping.space);
    if (!mapping.cid.startsWith("b")) throw new HttpError(400, "invalid-media-mapping");
  }
  return registry(env).fetch(new Request("https://registry/batch", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mappings),
  }));
}

async function bootstrapCredential(request: Request, env: Env): Promise<Response> {
  const claims = await requireSession(request, env);
  const body = await readJson<{ space?: string; delegationToken?: string; clientAttestation?: string }>(request);
  if (body.space === undefined || body.delegationToken === undefined || !claims.spaces.includes(body.space)) throw new HttpError(403, "space-not-authorized");
  parseSpace(body.space);
  return broker(env, body.space).fetch(new Request("https://broker/bootstrap", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

async function serveMedia(request: Request, env: Env, encodedId: string): Promise<Response> {
  const claims = await requireSession(request, env);
  const mediaId = decodeURIComponent(encodedId);
  const mappingResponse = await registry(env).fetch(new Request(`https://registry/${encodeURIComponent(mediaId)}`));
  if (!mappingResponse.ok) return mappingResponse;
  const mapping = await mappingResponse.json() as MediaMapping;
  if (!claims.spaces.includes(mapping.space)) throw new HttpError(403, "space-not-authorized");
  const maxBytes = Number(env.MAX_BLOB_BYTES ?? "26214400");
  return broker(env, mapping.space).fetch(new Request("https://broker/blob", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapping, maxBytes }),
  }));
}

async function serveMediaBatch(request: Request, env: Env): Promise<Response> {
  const claims = await requireSession(request, env);
  const body = await readJson<{
    mediaIds?: string[];
    items?: Array<{ mediaId?: string; cid?: string; space?: string; repo?: string }>;
  }>(request);

  const rawEntries: Array<{ mediaId: string; cid?: string; space?: string; repo?: string }> =
    Array.isArray(body.items) && body.items.length > 0
      ? body.items.map((it) => ({
          mediaId: it.mediaId ?? "",
          cid: it.cid,
          space: it.space,
          repo: it.repo,
        }))
      : Array.isArray(body.mediaIds)
        ? body.mediaIds.map((id) => ({ mediaId: id }))
        : [];

  if (
    rawEntries.length === 0 ||
    rawEntries.length > 5 ||
    new Set(rawEntries.map((e) => e.mediaId)).size !== rawEntries.length
  ) {
    throw new HttpError(400, "invalid-media-batch");
  }

  const maxItemBytes = 2 * 1024 * 1024;
  const maxBatchBytes = 10 * 1024 * 1024;
  let totalBytes = 0;
  const items: MediaBatchItem[] = [];

  for (const entry of rawEntries) {
    const { mediaId, cid } = entry;
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(mediaId)) throw new HttpError(400, "invalid-media-id");

    let mapping: MediaMapping | undefined;
    const mappingResponse = await registry(env).fetch(
      new Request(`https://registry/${encodeURIComponent(mediaId)}`),
    );
    if (mappingResponse.ok) {
      mapping = (await mappingResponse.json()) as MediaMapping;
    } else if (cid && cid.startsWith("b")) {
      const space = entry.space ?? claims.spaces[0]!;
      const repo = entry.repo ?? claims.sub;
      mapping = { mediaId, space, repo, cid, expectedMime: "image/webp" };
      void registry(env).fetch(
        new Request(`https://registry/${encodeURIComponent(mediaId)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mapping),
        }),
      );
    }

    if (!mapping) {
      items.push({ mediaId, status: 404, error: "media-not-found" });
      continue;
    }
    if (!claims.spaces.includes(mapping.space) || mapping.repo !== claims.sub) {
      items.push({ mediaId, status: 403, error: "space-not-authorized" });
      continue;
    }
    if (mapping.expectedMime !== "image/webp") {
      items.push({ mediaId, status: 415, error: "batch-previews-only" });
      continue;
    }
    const blobResponse = await broker(env, mapping.space).fetch(
      new Request("https://broker/blob", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping, maxBytes: maxItemBytes }),
      }),
    );
    if (!blobResponse.ok) {
      const error = ((await blobResponse.json().catch(() => ({}))) as { error?: string });
      items.push({
        mediaId,
        status: blobResponse.status,
        error: error.error ?? "blob-fetch-failed",
      });
      continue;
    }
    const bytes = new Uint8Array(await blobResponse.arrayBuffer());
    if (totalBytes + bytes.length > maxBatchBytes) {
      items.push({ mediaId, status: 413, error: "batch-too-large" });
      continue;
    }
    totalBytes += bytes.length;
    items.push({
      mediaId,
      status: 200,
      mime: blobResponse.headers.get("content-type") ?? "image/webp",
      bytes,
    });
  }

  return new Response(Uint8Array.from(encodeMediaBatch(items)).buffer, {
    headers: {
      "content-type": "application/x-atgallery-media-batch",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function registry(env: Env): DurableObjectStub { return env.MEDIA_REGISTRY.get(env.MEDIA_REGISTRY.idFromName("global")); }
function broker(env: Env, space: string): DurableObjectStub { return env.SPACE_BROKER.get(env.SPACE_BROKER.idFromName(space)); }

function requireAdmin(request: Request, env: Env): void {
  const expected = required(env.ATGALLERY_ADMIN_TOKEN, "admin-token-missing");
  if (bearer(request) !== expected) throw new HttpError(401, "admin-auth-required");
}

async function requireSession(request: Request, env: Env): Promise<SessionClaims> {
  const token = bearer(request) ?? cookie(request, "__Host-atgallery_session");
  if (token === undefined) throw new HttpError(401, "session-required");
  const claims = await verifySessionToken(token, required(env.ATGALLERY_SESSION_SECRET, "session-secret-missing"), env.SESSION_ISSUER ?? ISSUER);
  if (claims === undefined) throw new HttpError(401, "session-invalid");
  return claims;
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function required(value: string | undefined, code: string): string {
  if (value === undefined || value.length < 16) throw new HttpError(503, code);
  return value;
}

function allowedOrigin(request: Request, env: Env): string | undefined {
  const origin = request.headers.get("origin") ?? undefined;
  if (origin === undefined) return undefined;
  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowList = new Set([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://atgallery.noz.am",
    "https://atstorage.noz.am",
    ...configured,
  ]);
  return allowList.has(origin) ? origin : undefined;
}

function cors(response: Response, origin: string): Response {
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("access-control-allow-origin", origin);
  wrapped.headers.set("access-control-allow-headers", "authorization, content-type");
  wrapped.headers.set("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
  wrapped.headers.set("access-control-max-age", "600");
  wrapped.headers.append("vary", "Origin");
  return wrapped;
}
