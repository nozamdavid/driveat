import { describe, expect, it } from "vitest";

import { formatBytes, privateLibraryStorageBytes } from "./storage-total";

describe("privateLibraryStorageBytes", () => {
  it("counts each media item once as a private-original entry", () => {
    expect(
      privateLibraryStorageBytes([
        { size: 100 },
        { size: 250 },
      ]),
    ).toBe(350);
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
