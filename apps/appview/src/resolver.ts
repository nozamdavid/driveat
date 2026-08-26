import { HttpError } from "./http.js";

interface DidDocument { service?: Array<{ id?: string; serviceEndpoint?: unknown }> }

export function parseSpace(space: string): { authorityDid: string } {
  const match = /^at:\/\/(did:[a-z0-9]+:[A-Za-z0-9._:%-]+)\/space\/[^/]+\/[^/]+$/u.exec(space);
  if (match?.[1] === undefined) throw new HttpError(400, "invalid-space");
  return { authorityDid: match[1] };
}

export async function resolveService(did: string, serviceIds: string[], fetcher: typeof fetch = fetch): Promise<string> {
  const documentUrl = didDocumentUrl(did);
  // Workers supports follow/manual only. Manual preserves the no-redirect
  // boundary; the non-2xx check below rejects every redirect response.
  const response = await fetcher(documentUrl, { headers: { accept: "application/did+ld+json, application/json" }, redirect: "manual" });
  if (!response.ok) throw new HttpError(502, "did-resolution-failed");
  const document = await response.json() as DidDocument;
  for (const suffix of serviceIds) {
    const service = document.service?.find((item) => item.id === `${did}${suffix}` || item.id === suffix);
    const endpoint = typeof service?.serviceEndpoint === "string" ? service.serviceEndpoint : undefined;
    if (endpoint !== undefined) return safeOrigin(endpoint);
  }
  throw new HttpError(502, "did-service-not-found");
}

function didDocumentUrl(did: string): string {
  if (did.startsWith("did:plc:")) return `https://plc.directory/${encodeURIComponent(did)}`;
  if (did.startsWith("did:web:")) {
    const parts = did.slice(8).split(":").map(decodeURIComponent);
    const host = parts.shift();
    if (host === undefined || host.length === 0) throw new HttpError(400, "invalid-did");
    return `https://${host}/${parts.length === 0 ? ".well-known/did.json" : `${parts.join("/")}/did.json`}`;
  }
  throw new HttpError(400, "unsupported-did-method");
}

function safeOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new HttpError(502, "unsafe-did-service");
  return url.origin;
}
