export type Point = Readonly<{ x: number; y: number }>;

export type Size = Readonly<{ width: number; height: number }>;

const VIEWPORT_MARGIN = 8;

/** Keeps a fixed-position menu on screen by clamping it inside the viewport. */
export function clampMenuPosition(
  cursor: Point,
  menuSize: Size,
  viewport: Size,
): Point {
  const maxX = Math.max(VIEWPORT_MARGIN, viewport.width - menuSize.width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, viewport.height - menuSize.height - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(cursor.x, VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(cursor.y, VIEWPORT_MARGIN), maxY),
  };
}
