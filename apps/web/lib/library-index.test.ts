import { describe, expect, it, vi } from "vitest";

import {
  parseLibraryIndexBlob,
  serializeLibraryIndexBlob,
  type LibraryIndexBlobPayload,
} from "./library-index";

describe("library-index", () => {
  it("serializes and parses index blob payloads correctly", () => {
    const payload: LibraryIndexBlobPayload = {
      formatVersion: 1,
      generatedAt: "2026-08-27T00:00:00.000Z",
      watermark: "3lb27...",
      media: [
        {
          uri: "at://space/did/collection/3m",
          cid: "bafy-media",
          filename: "IMG_0001.JPG",
          mime: "image/jpeg",
          size: 1024,
          previewCid: "bafy-preview",
          createdAt: "2026-08-27T00:00:00.000Z",
        },
      ],
      albums: [],
      memberships: [],
    };

    const bytes = serializeLibraryIndexBlob(payload);
    const parsed = parseLibraryIndexBlob(bytes);

    expect(parsed).toEqual(payload);
  });

  it("handles corrupted or invalid index blobs gracefully", () => {
    expect(parseLibraryIndexBlob(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(
      parseLibraryIndexBlob(new TextEncoder().encode(JSON.stringify({ formatVersion: 2 }))),
    ).toBeUndefined();
  });

  it("retrieves the private index blob through the authenticated media gateway", async () => {
    const payload: LibraryIndexBlobPayload = {
      formatVersion: 1,
      generatedAt: "2026-08-27T00:00:00.000Z",
      media: [],
      albums: [],
      memberships: [],
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v1/media")) return Response.json({}, { status: 201 });
      if (url.includes("/media/")) return Response.json(payload);
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const fetchHandler = vi.fn();
    const fakeAgent = {
      fetchHandler,
      com: { atproto: { space: { getRecord: vi.fn().mockResolvedValue({ data: { value: { blob: { ref: { $link: "bafy-index" } } } } }) } } },
    } as any;

    try {
      const result = await import("./library-index").then(({ fetchRemoteLibraryIndex }) =>
        fetchRemoteLibraryIndex(
          fakeAgent,
          { space: "space:1", repo: "did:alice", indexCollection: "index" },
          { baseUrl: "https://media.example", token: "token", expiresAt: "2099-01-01T00:00:00Z", repo: "did:alice", space: "space:1" },
        ),
      );
      expect(result).toEqual(payload);
      expect(fetchHandler).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("https://media.example/media/"),
        expect.objectContaining({ headers: { authorization: "Bearer token" } }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports index publication failures so refresh can retry them", async () => {
    const fakeAgent = {
      uploadBlob: vi.fn().mockRejectedValue(new Error("index upload failed")),
    } as any;
    const { publishRemoteLibraryIndex } = await import("./library-index");

    await expect(publishRemoteLibraryIndex(
      fakeAgent,
      { space: "space:1", repo: "did:alice", indexCollection: "index" },
      { formatVersion: 1, generatedAt: "2026-08-27T00:00:00.000Z", media: [], albums: [], memberships: [] },
    )).rejects.toThrow("index upload failed");
  });
});
