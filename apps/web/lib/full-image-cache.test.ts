import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOriginalCache,
  getCachedOriginal,
  isOriginalCached,
  setCachedOriginal,
} from "./full-image-cache";

describe("full-image-cache", () => {
  beforeEach(() => {
    clearOriginalCache();
  });

  it("stores and retrieves cached original blobs", () => {
    const blob = new Blob(["test"], { type: "image/jpeg" });
    setCachedOriginal("cid-1", blob);

    expect(isOriginalCached("cid-1")).toBe(true);
    expect(getCachedOriginal("cid-1")).toBe(blob);
    expect(getCachedOriginal("cid-unknown")).toBeUndefined();
  });

  it("evicts the least recently used entry when capacity is exceeded", () => {
    for (let i = 1; i <= 10; i++) {
      setCachedOriginal(`cid-${i}`, new Blob([`blob-${i}`]));
    }

    // Access cid-1 to bump its LRU position
    getCachedOriginal("cid-1");

    // Add 11th entry -> should evict cid-2 (oldest unaccessed)
    setCachedOriginal("cid-11", new Blob(["blob-11"]));

    expect(isOriginalCached("cid-1")).toBe(true);
    expect(isOriginalCached("cid-2")).toBe(false);
    expect(isOriginalCached("cid-11")).toBe(true);
  });
});
