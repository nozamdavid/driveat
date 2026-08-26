import { describe, expect, it } from "vitest";

import { pruneSelectedUris, toggleSelectedUri } from "./media-selection";

describe("toggleSelectedUri", () => {
  it("adds a missing uri and removes a present one without mutating the input", () => {
    const selected = new Set(["a"]);
    expect(Array.from(toggleSelectedUri(selected, "b"))).toEqual(["a", "b"]);
    expect(Array.from(toggleSelectedUri(selected, "a"))).toEqual([]);
    expect(Array.from(selected)).toEqual(["a"]);
  });
});

describe("pruneSelectedUris", () => {
  it("drops uris that are no longer present in the Library", () => {
    const pruned = pruneSelectedUris(
      new Set(["kept", "deleted"]),
      new Set(["kept"]),
    );
    expect(Array.from(pruned)).toEqual(["kept"]);
  });

  it("returns the same reference when every uri survives, avoiding rerenders", () => {
    const selected = new Set(["a", "b"]);
    const available = new Set(["a", "b", "c"]);
    expect(pruneSelectedUris(selected, available)).toBe(selected);
  });
});
