import { describe, expect, it } from "vitest";

import { authenticatedSpaceBlobUrl, pdslsSpaceRecordUrl, sniffImageMime } from "./private-image";

describe("sniffImageMime", () => {
  it.each([
    [[0xff, 0xd8, 0xff], "image/jpeg"],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
    [Array.from(new TextEncoder().encode("GIF89a")), "image/gif"],
    [Array.from(new TextEncoder().encode("RIFF0000WEBP")), "image/webp"],
    [Array.from(new TextEncoder().encode("0000ftypavif0000")), "image/avif"],
  ] as const)("recognizes supported image bytes", (bytes, mime) => {
    expect(sniffImageMime(Uint8Array.from(bytes))).toBe(mime);
  });

  it("rejects unknown bytes", () => {
    expect(sniffImageMime(Uint8Array.from([1, 2, 3]))).toBeUndefined();
  });
});

it("builds the authenticated PDSls route for a private Space record", () => {
  expect(
    pdslsSpaceRecordUrl(
      "at://did:plc:alice/space/com.example.library/library/did:plc:alice/com.example.media/3abc",
    ),
  ).toBe(
    "https://pdsls.dev/spaces/did%3Aplc%3Aalice/com.example.library/library/com.example.media/3abc",
  );
});

it("builds a Space-authorized blob XRPC URL", () => {
  const url = authenticatedSpaceBlobUrl(
    "https://pds.example",
    "at://did:plc:alice/space/com.example.library/library",
    "did:plc:alice",
    "bafycid",
  );
  const parsed = new URL(url);
  expect(parsed.pathname).toBe("/xrpc/com.atproto.space.getBlob");
  expect(parsed.searchParams.get("cid")).toBe("bafycid");
});
