import { describe, expect, it } from "vitest";

import {
  REQUIRED_WRITE_CAPABILITIES,
  evaluatePdsCompatibility,
  type CapabilityCheck,
} from "./index.js";

function checks(value: boolean): CapabilityCheck {
  return Object.fromEntries(
    REQUIRED_WRITE_CAPABILITIES.map((capability) => [capability, value]),
  ) as unknown as CapabilityCheck;
}

describe("evaluatePdsCompatibility", () => {
  it("enables writes only when every mandatory capability passes", () => {
    expect(evaluatePdsCompatibility(checks(true))).toEqual({
      missingReadCapabilities: [],
      missingWriteCapabilities: [],
      mode: "read-write",
    });
  });

  it("falls back to read-only when public read capabilities remain", () => {
    const capabilityChecks = { ...checks(true), "permissioned-space-write": false };

    expect(evaluatePdsCompatibility(capabilityChecks).mode).toBe("read-only");
  });

  it("marks the PDS unsupported when a mandatory read capability is absent", () => {
    const capabilityChecks = { ...checks(true), "public-blob-read": false };

    expect(evaluatePdsCompatibility(capabilityChecks).mode).toBe("unsupported");
  });
});
