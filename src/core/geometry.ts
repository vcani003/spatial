/**
 * Rectangles, in world space.
 *
 * Here rather than in `viewport.ts` because none of this is about the
 * viewport: a marquee and a node's box are both just boxes, and the question
 * "do these overlap" has no camera in it.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A rectangle from two corners, in any order.
 *
 * A marquee dragged up and to the left produces a negative width and height,
 * and every overlap test after that quietly returns false — the box is
 * inside-out, so nothing is ever inside it. Normalising once at the source is
 * what stops that being rediscovered at every comparison.
 */
export function rectFromCorners(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Whether two rectangles overlap by some actual area.
 *
 * TOUCHING IS NOT OVERLAPPING. A marquee whose edge lands exactly on a node's
 * edge has covered none of it, and counting that would mean a drag which
 * appears to stop short still catches something. Hence strict comparisons.
 *
 * AND NEITHER IS A POINT. A zero-area rectangle sitting inside a box passes
 * all four strict tests — which I asserted it did not, until the test said
 * otherwise. It matters because a click is a marquee with no area: without
 * this guard, pressing empty canvas anywhere over a node would select it
 * rather than clear the selection.
 */
export function intersects(a: Rect, b: Rect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;

  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
