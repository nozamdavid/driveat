import { afterEach, describe, expect, it, vi } from "vitest";

import { connectMediaGateway, fetchGatewayBlob, mediaGatewayId, resolveMediaGatewayUrl } from "./media-gateway";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("media gateway configuration", () => {
  it("normalizes deployed and loopback gateway origins", () => {
    expect(resolveMediaGatewayUrl("https://media.example/path")).toBe("https://media.example");
    expect(resolveMediaGatewayUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(resolveMediaGatewayUrl(undefined)).toBeUndefined();
  });

  it("rejects plaintext non-loopback gateways", () => {
    expect(() => resolveMediaGatewayUrl("http://media.example")).toThrow("must use HTTPS");
  });

  it("creates stable opaque IDs without exposing coordinates", async () => {
    const first = await mediaGatewayId("at://did:web:space/space/type/key", "did:plc:alice", "bafyblob");
    const second = await mediaGatewayId("at://did:web:space/space/type/key", "did:plc:alice", "bafyblob");
    expect(first).toBe(second);
    expect(first).toMatch(/^media_[a-f0-9]{64}$/u);
    expect(first).not.toContain("alice");
  });

  it("exchanges only the delegation token for a gateway session", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ token: "gateway-session", expiresAt: "2099-01-01T00:00:00.000Z" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const access = await connectMediaGateway({
      baseUrl: "https://media.example",
      delegationClient: { async getDelegationToken() { return { data: { token: "single-use-delegation" } }; } },
      repo: "did:plc:alice",
      space: "at://did:web:space.example/space/type/key",
    });
    expect(access.token).toBe("gateway-session");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(String(init?.body)).toContain("single-use-delegation");
    expect(String(init?.body)).not.toContain("oauth");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("obtains delegation token via authenticated fetch handler", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ token: "gateway-session", expiresAt: "2099-01-01T00:00:00.000Z" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pdsFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ token: "pds-delegation-token" }, { status: 200 }),
    );
    const access = await connectMediaGateway({
      baseUrl: "https://media.example",
      delegationClient: pdsFetch,
      repo: "did:plc:alice",
      space: "at://did:web:space.example/space/type/key",
    });
    expect(access.token).toBe("gateway-session");
    expect(pdsFetch).toHaveBeenCalledWith(
      "/xrpc/com.atproto.space.getDelegationToken?space=at%3A%2F%2Fdid%3Aweb%3Aspace.example%2Fspace%2Ftype%2Fkey",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fetches WebP previews directly via /v1/media/batch without prior /v1/media calls", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const items = (JSON.parse(String(init?.body)) as { items: Array<{ mediaId: string }> }).items;
      const mediaIds = items.map((i) => i.mediaId);
      return new Response(Uint8Array.from(batchResponse(mediaIds)).buffer, { headers: { "content-type": "application/x-atgallery-media-batch" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const access = { baseUrl: "https://media.example", token: "gateway-session", expiresAt: "2099-01-01T00:00:00.000Z", repo: "did:plc:alice", space: "at://did:web:space.example/space/type/key" };
    const responses = await Promise.all([
      fetchGatewayBlob(access, "bafyblob-a", "image/webp"),
      fetchGatewayBlob(access, "bafyblob-b", "image/webp"),
    ]);
    expect(responses.every((response) => response.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://media.example/v1/media/batch");
    expect((JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { items: unknown[] }).items).toHaveLength(2);
  });

  it("requests WebP previews in batches of ten", async () => {
    const batchSizes: number[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const items = (JSON.parse(String(init?.body)) as { items: Array<{ mediaId: string }> }).items;
      batchSizes.push(items.length);
      return new Response(Uint8Array.from(batchResponse(items.map((item) => item.mediaId))).buffer, {
        headers: { "content-type": "application/x-atgallery-media-batch" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const access = { baseUrl: "https://media.example", token: "gateway-session", expiresAt: "2099-01-01T00:00:00.000Z", repo: "did:plc:alice", space: "at://did:web:space.example/space/type/key" };

    const responses = await Promise.all(
      Array.from({ length: 11 }, (_, index) => fetchGatewayBlob(access, `bafyblob-${index}`, "image/webp")),
    );

    expect(responses.every((response) => response.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(batchSizes).toEqual([10, 1]);
  });

  it("collects staggered preview cache misses into a full batch", async () => {
    const batchSizes: number[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const items = (JSON.parse(String(init?.body)) as { items: Array<{ mediaId: string }> }).items;
      batchSizes.push(items.length);
      return new Response(Uint8Array.from(batchResponse(items.map((item) => item.mediaId))).buffer, {
        headers: { "content-type": "application/x-atgallery-media-batch" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const access = { baseUrl: "https://media.example", token: "gateway-session", expiresAt: "2099-01-01T00:00:00.000Z", repo: "did:plc:alice", space: "at://did:web:space.example/space/type/key" };
    const pending: Array<Promise<Response>> = [];

    for (let index = 0; index < 3; index += 1) pending.push(fetchGatewayBlob(access, `bafy-staggered-${index}`, "image/webp"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (let index = 3; index < 6; index += 1) pending.push(fetchGatewayBlob(access, `bafy-staggered-${index}`, "image/webp"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (let index = 6; index < 10; index += 1) pending.push(fetchGatewayBlob(access, `bafy-staggered-${index}`, "image/webp"));

    expect((await Promise.all(pending)).every((response) => response.ok)).toBe(true);
    expect(batchSizes).toEqual([10]);
  });

  it("fetches single original media directly through /media/:id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith("/v1/media")) return Response.json({ stored: 1 }, { status: 201 });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const access = {
      baseUrl: "https://media.example",
      token: "gateway-session",
      expiresAt: "2099-01-01T00:00:00.000Z",
      repo: "did:plc:alice",
      space: "at://did:web:space.example/space/type/key",
    };
    const response = await fetchGatewayBlob(access, "bafyblob-orig", "image/jpeg");
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/^https:\/\/media\.example\/media\/media_[a-f0-9]{64}$/u);
  });

  it("rejects connection when gateway returns non-200", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      connectMediaGateway({
        baseUrl: "https://media.example",
        delegationClient: {
          async getDelegationToken() {
            return { data: { token: "single-use-delegation" } };
          },
        },
        repo: "did:plc:alice",
        space: "at://did:web:space.example/space/type/key",
      }),
    ).rejects.toThrow("Media gateway connection failed: unauthorized.");
  });
});

function batchResponse(mediaIds: string[]): Uint8Array {
  const bodies = mediaIds.map((mediaId) => new TextEncoder().encode(`image:${mediaId}`));
  let offset = 0;
  const items = mediaIds.map((mediaId, index) => {
    const bytes = bodies[index]!;
    const item = { mediaId, status: 200, mime: "image/webp", offset, length: bytes.length };
    offset += bytes.length;
    return item;
  });
  const manifest = new TextEncoder().encode(JSON.stringify({ version: 1, items }));
  const output = new Uint8Array(4 + manifest.length + offset);
  new DataView(output.buffer).setUint32(0, manifest.length, false);
  output.set(manifest, 4);
  let cursor = 4 + manifest.length;
  for (const body of bodies) { output.set(body, cursor); cursor += body.length; }
  return output;
}
