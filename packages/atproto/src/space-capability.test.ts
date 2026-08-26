import { describe, expect, it, vi } from "vitest";

import { probePersonalSpaceCapability } from "./space-capability.js";

describe("probePersonalSpaceCapability", () => {
  it.each([
    [200, "available"],
    [401, "permission-denied"],
    [403, "permission-denied"],
    [404, "unsupported"],
    [501, "unsupported"],
    [429, "unavailable"],
  ] as const)("maps HTTP %s to %s", async (httpStatus, status) => {
    const report = await probePersonalSpaceCapability(
      async () => new Response(null, { status: httpStatus }),
      "com.example.private",
      "did:plc:alice",
    );
    expect(report.status).toBe(status);
  });

  it("preserves safe PDS diagnostics for a denied request", async () => {
    const authenticatedFetch = vi.fn(async () =>
      Response.json(
        { error: "InsufficientScope", message: "Space permission is missing" },
        { status: 401, headers: { "www-authenticate": "DPoP error=insufficient_scope" } },
      ),
    );
    const report = await probePersonalSpaceCapability(
      authenticatedFetch,
      "com.example.private",
      "did:plc:alice",
    );

    expect(report).toEqual({
      status: "permission-denied",
      httpStatus: 401,
      error: "InsufficientScope",
      message: "Space permission is missing",
      wwwAuthenticate: "DPoP error=insufficient_scope",
    });
    expect(authenticatedFetch).toHaveBeenCalledWith(
      "/xrpc/com.atproto.space.listSpaces?type=com.example.private&did=did%3Aplc%3Aalice",
      { method: "GET" },
    );
  });
});
