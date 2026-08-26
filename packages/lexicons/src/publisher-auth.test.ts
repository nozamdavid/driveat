import { describe, expect, it, vi } from "vitest";

import { loginPublisher } from "./publisher-auth.js";

describe("loginPublisher", () => {
  it("retries with the emailed auth factor token when the PDS requires it", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "AuthFactorTokenRequired", message: "Code sent" }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessJwt: "jwt", did: "did:plc:publisher", handle: "noz.am" }),
          { status: 200 },
        ),
      );
    const getAuthFactorToken = vi.fn().mockResolvedValue("123456");

    const session = await loginPublisher({
      fetcher,
      pds: "https://pds.example",
      identifier: "noz.am",
      password: "app-password",
      expectedDid: "did:plc:publisher",
      getAuthFactorToken,
    });

    expect(session.accessJwt).toBe("jwt");
    expect(getAuthFactorToken).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      identifier: "noz.am",
      password: "app-password",
      authFactorToken: "123456",
    });
  });

  it("reports a plain-text rate limit response without a JSON parsing error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Too Many Requests", {
        status: 429,
        headers: { "retry-after": "60" },
      }),
    );

    await expect(
      loginPublisher({
        fetcher,
        pds: "https://pds.example",
        identifier: "noz.am",
        password: "app-password",
        expectedDid: "did:plc:publisher",
        getAuthFactorToken: vi.fn(),
      }),
    ).rejects.toThrow("Publisher login failed (429) RateLimited: Too Many Requests; retry after 60s");
  });
});
