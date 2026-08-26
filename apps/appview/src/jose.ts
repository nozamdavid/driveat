import type { SessionClaims } from "./types.js";

const encoder = new TextEncoder();

export function base64url(input: Uint8Array): string {
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodedJson(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)));
}

export async function sha256(value: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
}

export async function createDpopProof(input: {
  method: string;
  url: string;
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
  accessToken?: string;
  nonce?: string;
}): Promise<string> {
  const header = encodedJson({ typ: "dpop+jwt", alg: "ES256", jwk: input.publicJwk });
  const payload = encodedJson({
    htm: input.method.toUpperCase(), htu: normalizeHtu(input.url),
    iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(),
    ...(input.accessToken === undefined ? {} : { ath: base64url(await sha256(input.accessToken)) }),
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
  });
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, input.privateKey, encoder.encode(signingInput),
  ));
  return `${signingInput}.${base64url(derToJose(signature))}`;
}

// RFC 9449 section 4.2 excludes query and fragment from the htu claim.
// The permissioned-data alpha verifier applies this same normalization.
function normalizeHtu(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function derToJose(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) return signature;
  if (signature[0] !== 0x30) throw new Error("unsupported ECDSA signature encoding");
  let offset = signature[1] === 0x81 ? 3 : 2;
  if (signature[offset++] !== 0x02) throw new Error("invalid ECDSA signature");
  const rLength = signature[offset++];
  if (rLength === undefined) throw new Error("invalid ECDSA signature");
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;
  if (signature[offset++] !== 0x02) throw new Error("invalid ECDSA signature");
  const sLength = signature[offset++];
  if (sLength === undefined) throw new Error("invalid ECDSA signature");
  const s = signature.slice(offset, offset + sLength);
  const output = new Uint8Array(64);
  output.set(r.slice(Math.max(0, r.length - 32)), 32 - Math.min(32, r.length));
  output.set(s.slice(Math.max(0, s.length - 32)), 64 - Math.min(32, s.length));
  return output;
}

export async function createSessionToken(claims: SessionClaims, secret: string): Promise<string> {
  const header = encodedJson({ alg: "HS256", typ: "JWT" });
  const payload = encodedJson(claims);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64url(signature)}`;
}

export async function verifySessionToken(token: string, secret: string, issuer: string): Promise<SessionClaims | undefined> {
  const [header, payload, signature, extra] = token.split(".");
  if (header === undefined || payload === undefined || signature === undefined || extra !== undefined) return undefined;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", key, Uint8Array.from(decode(signature)).buffer, encoder.encode(`${header}.${payload}`)))) return undefined;
  try {
    const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as SessionClaims;
    if (claims.iss !== issuer || claims.exp <= Math.floor(Date.now() / 1000) || !Array.isArray(claims.spaces)) return undefined;
    return claims;
  } catch { return undefined; }
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
