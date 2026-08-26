import { describe, expect, it, vi } from "vitest";

import { createOAuthInitializer } from "./oauth-initializer";

describe("createOAuthInitializer", () => {
  it("shares one in-flight initialization between concurrent callback effects", async () => {
    let resolveInitialization: ((value: { session: { did: string } }) => void) | undefined;
    const underlyingInitialization = vi.fn(
      () =>
        new Promise<{ session: { did: string } }>((resolve) => {
          resolveInitialization = resolve;
        }),
    );
    const initialize = createOAuthInitializer(underlyingInitialization);

    const first = initialize();
    const second = initialize();

    expect(underlyingInitialization).toHaveBeenCalledTimes(1);

    resolveInitialization?.({ session: { did: "did:example:alice" } });

    await expect(first).resolves.toEqual({ session: { did: "did:example:alice" } });
    await expect(second).resolves.toEqual({ session: { did: "did:example:alice" } });
  });

  it("allows a retry after initialization rejects", async () => {
    const underlyingInitialization = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("restored");
    const initialize = createOAuthInitializer(underlyingInitialization);

    await expect(initialize()).rejects.toThrow("temporary failure");
    await expect(initialize()).resolves.toBe("restored");
    expect(underlyingInitialization).toHaveBeenCalledTimes(2);
  });
});
