import { describe, expect, it } from "vitest";

import { verifySha256Cid } from "./cid.js";
import { createDpopProof, createSessionToken, sha256, verifySessionToken } from "./jose.js";
import { encodeMediaBatch } from "./media-batch.js";
import { parseSpace, resolveService } from "./resolver.js";

const space = "at://did:web:spaces.example/space/am.noz.atgallery.library/library";

describe("gateway security primitives", () => {
  it("signs and verifies bounded Space sessions", async () => {
    const claims = { sub: "did:plc:viewer", spaces: [space], exp: Math.floor(Date.now() / 1000) + 60, iss: "test" };
    const token = await createSessionToken(claims, "a sufficiently long test secret");
    await expect(verifySessionToken(token, "a sufficiently long test secret", "test")).resolves.toEqual(claims);
    await expect(verifySessionToken(`${token}x`, "a sufficiently long test secret", "test")).resolves.toBeUndefined();
  });

  it("includes nonce and access-token hash in each DPoP proof", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const token = "space-credential";
    const proof = await createDpopProof({ method: "GET", url: "https://pds.example/xrpc/getBlob?x=1", publicJwk, privateKey: pair.privateKey, accessToken: token, nonce: "server-nonce" });
    const payload = decodePart(proof.split(".")[1]!);
    expect(payload).toMatchObject({ htm: "GET", htu: "https://pds.example/xrpc/getBlob", nonce: "server-nonce" });
    expect(payload.ath).toBe(base64url(await sha256(token)));
    expect(typeof payload.jti).toBe("string");
  });

  it("resolves only the requested HTTPS DID service", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://alice.example/.well-known/did.json");
      expect(init?.redirect).toBe("manual");
      return Response.json({ service: [{ id: "did:web:alice.example#atproto_pds", serviceEndpoint: "https://pds.example/path" }] });
    };
    await expect(resolveService("did:web:alice.example", ["#atproto_pds"], fetcher)).resolves.toBe("https://pds.example");
  });

  it("rejects DID-document redirects instead of following them", async () => {
    const fetcher: typeof fetch = async () => new Response(null, { status: 302, headers: { location: "https://attacker.example/did.json" } });
    await expect(resolveService("did:web:alice.example", ["#atproto_pds"], fetcher)).rejects.toThrow("did-resolution-failed");
  });

  it("rejects malformed Space references", () => {
    expect(parseSpace(space)).toEqual({ authorityDid: "did:web:spaces.example" });
    expect(() => parseSpace("at://did:web:spaces.example/not-space/x/y")).toThrow("invalid-space");
  });

  it("verifies CIDv1 sha2-256 bytes", async () => {
    const bytes = new TextEncoder().encode("private photo bytes");
    const digest = await sha256(bytes);
    const cid = `b${encodeBase32(Uint8Array.from([1, 0x55, 0x12, 0x20, ...digest]))}`;
    await expect(verifySha256Cid(cid, bytes)).resolves.toBe(true);
    await expect(verifySha256Cid(cid, new TextEncoder().encode("tampered"))).resolves.toBe(false);
  });

  it("encodes successful and failed preview results in one bounded bundle", () => {
    const encoded = encodeMediaBatch([
      { mediaId: "media_success", status: 200, mime: "image/webp", bytes: Uint8Array.from([1, 2, 3]) },
      { mediaId: "media_failure", status: 404, error: "media-not-found" },
    ]);
    const manifestLength = new DataView(encoded.buffer).getUint32(0, false);
    const manifest = JSON.parse(new TextDecoder().decode(encoded.slice(4, 4 + manifestLength))) as { items: Array<Record<string, unknown>> };
    expect(manifest.items).toEqual([
      { mediaId: "media_success", status: 200, mime: "image/webp", offset: 0, length: 3 },
      { mediaId: "media_failure", status: 404, error: "media-not-found" },
    ]);
    expect([...encoded.slice(4 + manifestLength)]).toEqual([1, 2, 3]);
  });
});

function decodePart(value: string): Record<string, unknown> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as Record<string, unknown>;
}

function base64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function encodeBase32(value: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, buffer = 0, output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(buffer >>> bits) & 31]; }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}
