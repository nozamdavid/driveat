import { describe, expect, it, vi } from "vitest";

import { verifyLexiconPublication } from "./lexicon-publication.js";

describe("verifyLexiconPublication", () => {
  it("reports a complete publication set", async () => {
    const publicFetch = vi.fn(async (input: string) => {
      const nsid = new URL(input).searchParams.get("nsid");
      return Response.json({ cid: `cid-${nsid}`, uri: `at://did:plc:publisher/schema/${nsid}` });
    });

    const report = await verifyLexiconPublication(
      "https://pds.example/",
      ["com.example.one", "com.example.two"],
      publicFetch,
    );

    expect(report.complete).toBe(true);
    expect(report.lexicons["com.example.one"]?.status).toBe("published");
    expect(publicFetch).toHaveBeenCalledTimes(2);
  });

  it("distinguishes a missing Lexicon from a resolver failure", async () => {
    const publicFetch = vi.fn(async (input: string) =>
      input.includes("missing")
        ? Response.json({ error: "LexiconNotFound" }, { status: 400 })
        : Response.json({ error: "UpstreamFailure" }, { status: 502 }),
    );

    const report = await verifyLexiconPublication(
      "https://pds.example",
      ["com.example.missing", "com.example.unavailable"],
      publicFetch,
    );

    expect(report.complete).toBe(false);
    expect(report.lexicons).toEqual({
      "com.example.missing": { status: "missing" },
      "com.example.unavailable": { status: "unavailable", httpStatus: 502 },
    });
  });

  it("reports a malformed success body as an invalid response, not an outage", async () => {
    const publicFetch = vi.fn(async () => Response.json({ cid: 123 }));

    const report = await verifyLexiconPublication(
      "https://pds.example",
      ["com.example.malformed"],
      publicFetch,
    );

    expect(report.complete).toBe(false);
    expect(report.lexicons).toEqual({
      "com.example.malformed": { status: "invalid-response", httpStatus: 200 },
    });
  });
});
