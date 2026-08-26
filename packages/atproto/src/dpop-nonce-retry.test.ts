import { describe, expect, it, vi } from "vitest";

import { retryDpopNonceChallenge } from "./dpop-nonce-retry";

describe("retryDpopNonceChallenge", () => {
  it("retries once after the authorization server requests a DPoP nonce", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Error('OAuth "use_dpop_nonce" error: Authorization server requires nonce in DPoP proof'),
      )
      .mockResolvedValueOnce("authenticated");

    await expect(retryDpopNonceChallenge(operation)).resolves.toBe("authenticated");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated OAuth failures", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("access_denied"));

    await expect(retryDpopNonceChallenge(operation)).rejects.toThrow("access_denied");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
