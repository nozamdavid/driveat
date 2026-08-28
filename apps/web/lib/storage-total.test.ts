import { describe, expect, it } from "vitest";

import { LIBRARY_LIMITS } from "@atgallery/domain";

import { formatBytes, libraryUploadFits, privateLibraryStorageBytes } from "./storage-total";

describe("privateLibraryStorageBytes", () => {
  it("counts original and preview bytes in total Library storage", () => {
    expect(
      privateLibraryStorageBytes([
        { size: 100, previewSize: 10 },
        { size: 250, previewSize: 20 },
      ]),
    ).toBe(380);
  });

  it("returns zero for an empty Library", () => {
    expect(privateLibraryStorageBytes([])).toBe(0);
  });
});

describe("formatBytes", () => {
  it("renders whole mebibytes below the gibibyte boundary", () => {
    expect(formatBytes(0)).toBe("0 MiB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1 MiB");
  });

  it("switches to gibibytes at 1024 MiB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GiB");
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.50 GiB");
  });
});

describe("libraryUploadFits", () => {
  it("allows exactly 2 GiB and rejects one byte beyond it", () => {
    expect(libraryUploadFits(LIBRARY_LIMITS.storedBytes - 20, [10, 10])).toBe(true);
    expect(libraryUploadFits(LIBRARY_LIMITS.storedBytes - 20, [10, 11])).toBe(false);
  });
});
