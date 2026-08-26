import { describe, expect, it } from "vitest";

import { clampMenuPosition } from "./menu-position";

const menuSize = { width: 176, height: 140 };

describe("clampMenuPosition", () => {
  it("keeps a cursor position that already fits inside the viewport", () => {
    expect(clampMenuPosition({ x: 200, y: 150 }, menuSize, { width: 1200, height: 800 })).toEqual({
      x: 200,
      y: 150,
    });
  });

  it("shifts the menu left and up near the right and bottom edges", () => {
    expect(clampMenuPosition({ x: 1180, y: 760 }, menuSize, { width: 1200, height: 800 })).toEqual({
      x: 1016,
      y: 652,
    });
  });

  it("clamps to the viewport margin on tiny viewports", () => {
    expect(clampMenuPosition({ x: 4, y: 2 }, menuSize, { width: 100, height: 100 })).toEqual({
      x: 8,
      y: 8,
    });
  });
});
