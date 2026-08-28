import { describe, expect, it } from "vitest";

import {
  effectiveLibraryBlobLimit,
  formatBlobLimit,
  parsePdsBlobUploadLimit,
} from "./pds-blob-limit";

describe("PDS blob upload limit", () => {
  it("accepts a positive integer describeServer blobUploadLimit", () => {
    expect(parsePdsBlobUploadLimit(50 * 1024 * 1024)).toBe(50 * 1024 * 1024);
    expect(parsePdsBlobUploadLimit(undefined)).toBeUndefined();
    expect(parsePdsBlobUploadLimit(-1)).toBeUndefined();
  });

  it("caps uploads at the Library record schema limit", () => {
    expect(effectiveLibraryBlobLimit(10 * 1024 * 1024)).toBe(10 * 1024 * 1024);
    expect(effectiveLibraryBlobLimit(100 * 1024 * 1024)).toBe(50 * 1024 * 1024);
  });

  it("formats the advertised byte limit for people", () => {
    expect(formatBlobLimit(50 * 1024 * 1024)).toBe("50 MiB");
  });
});
