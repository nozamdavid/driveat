import { verifySha256Cid } from "./cid.js";
import { HttpError, json, readJson } from "./http.js";
import { createDpopProof, importPrivateKey } from "./jose.js";
import { parseSpace, resolveService } from "./resolver.js";
import type { CredentialState, MediaMapping } from "./types.js";

interface BootstrapRequest { space: string; delegationToken: string; clientAttestation?: string }
interface BlobRequest { mapping: MediaMapping; maxBytes: number }

const CREDENTIAL_KEY = "credential";

export class SpaceCredentialBroker implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    try { return await this.route(request); } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      console.error("space broker failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "internal-error" }, 500);
    }
  }

  private async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/bootstrap") return this.bootstrap(await readJson<BootstrapRequest>(request));
    if (request.method === "POST" && path === "/blob") return this.fetchBlob(await readJson<BlobRequest>(request));
    if (request.method === "GET" && path === "/status") {
      const credential = await this.state.storage.get<CredentialState>(CREDENTIAL_KEY);
      return json({ ready: credential !== undefined && credential.expiresAt > Date.now() });
    }
    return json({ error: "not-found" }, 404);
  }

  private async bootstrap(input: BootstrapRequest): Promise<Response> {
    if (input.delegationToken.length < 20) throw new HttpError(400, "invalid-delegation-token");
    const { authorityDid } = parseSpace(input.space);
    const host = await resolveService(authorityDid, ["#atproto_space_host", "#atproto_pds"]);
    const endpoint = `${host}/xrpc/com.atproto.space.getSpaceCredential`;
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const body = JSON.stringify({ space: input.space, ...(input.clientAttestation === undefined ? {} : { clientAttestation: input.clientAttestation }) });
    const response = await dpopFetch(endpoint, "POST", input.delegationToken, pair.privateKey, publicJwk, body, "Bearer");
    if (!response.ok) throw await upstreamError(response, "credential-exchange-failed");
    const result = await response.json() as { credential?: string; token?: string; expiresIn?: number };
    const credential = result.credential ?? result.token;
    if (credential === undefined) throw new HttpError(502, "credential-response-invalid");
    const expiresAt = jwtExpiry(credential) ?? Date.now() + Math.max(60, result.expiresIn ?? 7200) * 1000;
    await this.state.storage.put<CredentialState>(CREDENTIAL_KEY, {
      space: input.space, credential, expiresAt, privateJwk, publicJwk,
    });
    return json({ ready: true, expiresAt: new Date(expiresAt).toISOString() });
  }

  private async fetchBlob(input: BlobRequest): Promise<Response> {
    const stored = await this.state.storage.get<CredentialState>(CREDENTIAL_KEY);
    if (stored === undefined || stored.space !== input.mapping.space || stored.expiresAt <= Date.now() + 30_000) {
      throw new HttpError(409, "space-credential-required");
    }
    const repoHost = await resolveService(input.mapping.repo, ["#atproto_pds"]);
    const endpoint = new URL("/xrpc/com.atproto.space.getBlob", repoHost);
    endpoint.searchParams.set("space", input.mapping.space);
    endpoint.searchParams.set("repo", input.mapping.repo);
    endpoint.searchParams.set("cid", input.mapping.cid);
    const key = await importPrivateKey(stored.privateJwk);
    const response = await dpopFetch(endpoint.toString(), "GET", stored.credential, key, stored.publicJwk, undefined, "DPoP");
    if (!response.ok) throw await upstreamError(response, "blob-fetch-failed");
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (!contentType.startsWith("image/") || contentType === "image/svg+xml") throw new HttpError(502, "unsafe-blob-type");
    if (input.mapping.expectedMime !== undefined && input.mapping.expectedMime.toLowerCase() !== contentType) throw new HttpError(502, "blob-type-mismatch");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) throw new HttpError(413, "blob-too-large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > input.maxBytes) throw new HttpError(413, "blob-too-large");
    if (!(await verifySha256Cid(input.mapping.cid, bytes))) throw new HttpError(502, "blob-cid-mismatch");
    return new Response(bytes, { headers: {
      "content-type": contentType,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
      "etag": `\"${input.mapping.cid}\"`,
      "x-content-type-options": "nosniff",
    }});
  }
}

async function dpopFetch(
  url: string, method: string, token: string, key: CryptoKey, publicJwk: JsonWebKey,
  body: string | undefined, scheme: "Bearer" | "DPoP",
): Promise<Response> {
  let nonce: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const proof = await createDpopProof({ method, url, publicJwk, privateKey: key, ...(scheme === "DPoP" ? { accessToken: token } : {}), ...(nonce === undefined ? {} : { nonce }) });
    const response = await fetch(url, { method, ...(body === undefined ? {} : { body }), headers: {
      authorization: `${scheme} ${token}`, dpop: proof,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    }});
    const challengedNonce = response.headers.get("dpop-nonce") ?? undefined;
    if (response.ok || challengedNonce === undefined || attempt === 1) return response;
    nonce = challengedNonce;
  }
  throw new Error("unreachable");
}

async function upstreamError(response: Response, fallback: string): Promise<HttpError> {
  let code = fallback;
  try {
    const body = await response.json() as { error?: string };
    if (body.error === "SpaceDeleted") code = "space-deleted";
  } catch {}
  return new HttpError(response.status === 404 ? 404 : 502, code);
}

function jwtExpiry(token: string): number | undefined {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined) return undefined;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { exp?: number };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : undefined;
  } catch { return undefined; }
}
