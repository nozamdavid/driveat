import { describe, expect, it } from "vitest";

import { createLexiconAuthorityPlan, nsidBaseForDomain } from "./authority.js";

describe("nsidBaseForDomain", () => {
  it("reverses a controlled domain into an NSID base", () => {
    expect(nsidBaseForDomain("gallery.example.com.")).toBe("com.example.gallery");
  });

  it.each(["localhost", "https://example.com", "-bad.example"])(
    "rejects invalid authority domain %s",
    (domain) => {
      expect(() => nsidBaseForDomain(domain)).toThrow("normalized multi-label DNS name");
    },
  );
});

describe("createLexiconAuthorityPlan", () => {
  it("derives one namespace DNS record and all publication record keys", () => {
    const plan = createLexiconAuthorityPlan("example.com", "did:plc:abc123");

    expect(plan.baseAuthority).toBe("com.example");
    expect(plan.namespaceAuthority).toBe("com.example.alpha");
    expect(plan.namespaceDomain).toBe("alpha.example.com");
    expect(plan.dnsRecordName).toBe("_lexicon.alpha.example.com");
    expect(plan.dnsTxtValue).toBe("did=did:plc:abc123");
    expect(plan.recordKeys).toHaveLength(10);
    expect(plan.recordKeys).toContain("com.example.alpha.personalLibrary");
  });

  it("derives ATGallery's selected alpha authority without duplicating its name", () => {
    const plan = createLexiconAuthorityPlan("atgallery.noz.am", "did:plc:abc123");

    expect(plan.baseAuthority).toBe("am.noz.atgallery");
    expect(plan.namespaceAuthority).toBe("am.noz.atgallery.alpha");
    expect(plan.namespaceDomain).toBe("alpha.atgallery.noz.am");
    expect(plan.dnsRecordName).toBe("_lexicon.alpha.atgallery.noz.am");
    expect(plan.nsids.personalLibrarySpace).toBe("am.noz.atgallery.alpha.personalLibrary");
  });

  it("rejects a handle in place of the publisher DID", () => {
    expect(() => createLexiconAuthorityPlan("example.com", "alice.example.com")).toThrow(
      "valid DID",
    );
  });
});
