import { describe, expect, it } from "vitest";

import {
  ATGALLERY_ALPHA_PDS,
  buildLoopbackClientId,
  resolveOAuthClientId,
  resolveOAuthPermissionConfiguration,
} from "./oauth-config";

it("targets the designated Spaces alpha PDS by default", () => {
  expect(ATGALLERY_ALPHA_PDS).toBe("https://spaces-alpha.host.bsky.network");
});

describe("buildLoopbackClientId", () => {
  it("uses localhost for the client id and 127.0.0.1 for the callback", () => {
    expect(
      buildLoopbackClientId({ hostname: "localhost", port: "3000", protocol: "http:" }),
    ).toBe(
      "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Foauth%2Fcallback&scope=atproto",
    );
  });

  it("preserves an IP-based loopback origin", () => {
    expect(
      buildLoopbackClientId({ hostname: "127.0.0.1", port: "4173", protocol: "http:" }),
    ).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Foauth%2Fcallback");
  });

  it("rejects a non-loopback origin without hosted metadata", () => {
    expect(() =>
      buildLoopbackClientId({ hostname: "gallery.example", port: "", protocol: "https:" }),
    ).toThrow("Local OAuth requires a loopback hostname.");
  });
});

describe("resolveOAuthClientId", () => {
  it("prefers a configured hosted client id", () => {
    expect(
      resolveOAuthClientId("https://gallery.example/oauth-client-metadata.json", {
        hostname: "gallery.example",
        port: "",
        protocol: "https:",
      }),
    ).toBe("https://gallery.example/oauth-client-metadata.json");
  });

  it("derives the hosted client id metadata URL when running on a hosted domain", () => {
    expect(
      resolveOAuthClientId(undefined, {
        hostname: "atstorage.noz.am",
        port: "",
        protocol: "https:",
      }),
    ).toBe("https://atstorage.noz.am/oauth-client-metadata.json");
  });

  it("uses the loopback client id on localhost when unset or empty", () => {
    expect(
      resolveOAuthClientId("", {
        hostname: "localhost",
        port: "3000",
        protocol: "http:",
      }),
    ).toContain("http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Foauth%2Fcallback");
  });
});

describe("resolveOAuthPermissionConfiguration", () => {
  it("remains identity-only until an NSID authority is configured", () => {
    expect(resolveOAuthPermissionConfiguration(undefined)).toEqual({
      mode: "identity-only",
      scope: "atproto",
      scopes: ["atproto"],
    });
  });

  it("enables explicit gallery permissions for a configured alpha authority", () => {
    const configuration = resolveOAuthPermissionConfiguration("com.example.atgallery.alpha");

    expect(configuration.mode).toBe("gallery");
    if (configuration.mode !== "gallery") throw new Error("Expected gallery configuration.");
    expect(configuration.accountCollection).toBe("com.example.atgallery.account");
    expect(configuration.scope).toContain("repo:com.example.atgallery.account");
    expect(configuration.scope).toContain("repo:com.example.atgallery.alpha.publishedAlbum");
    expect(configuration.scope).toContain("space:com.example.atgallery.alpha.personalLibrary");
    expect(configuration.personalSpaceType).toBe(
      "com.example.atgallery.alpha.personalLibrary",
    );
    expect(configuration.libraryMediaCollection).toBe(
      "com.example.atgallery.alpha.libraryMedia",
    );
    expect(configuration.transferEventCollection).toBe(
      "com.example.atgallery.alpha.transferEvent",
    );
    expect(configuration.scope).not.toContain("transition:generic");
  });
});
