import { describe, expect, it } from "vitest";

import { calculateLogicalStorageUsage } from "../src/index.js";

describe("calculateLogicalStorageUsage", () => {
  it("reports private and public logical bytes separately", () => {
    expect(
      calculateLogicalStorageUsage([
        { bytes: 100, kind: "private-original" },
        { bytes: 10, kind: "private-preview" },
        { bytes: 90, kind: "public-rendition" },
        { bytes: 8, kind: "public-preview" },
      ]),
    ).toEqual({ privateBytes: 110, publicBytes: 98, totalBytes: 208 });
  });
});
