import { describe, expect, it } from "vitest";
import { intersects, rectFromCorners } from "./geometry";

describe("rectFromCorners", () => {
  it("builds the same rectangle whichever corner you start from", () => {
    /* A marquee dragged up and to the left is the case that breaks naive
       code: it produces a negative width, and every overlap test after that
       silently returns false because the box is inside-out. */
    const downRight = rectFromCorners({ x: 10, y: 20 }, { x: 60, y: 80 });
    const upLeft = rectFromCorners({ x: 60, y: 80 }, { x: 10, y: 20 });

    expect(downRight).toEqual({ x: 10, y: 20, width: 50, height: 60 });
    expect(upLeft).toEqual(downRight);
  });

  it("handles a drag that crosses the origin", () => {
    expect(rectFromCorners({ x: 20, y: 20 }, { x: -30, y: -40 })).toEqual({
      x: -30,
      y: -40,
      width: 50,
      height: 60,
    });
  });

  it("gives a zero-area rectangle for a single point", () => {
    expect(rectFromCorners({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("intersects", () => {
  const box = { x: 100, y: 100, width: 100, height: 100 };

  it("finds a box fully inside another", () => {
    expect(intersects(box, { x: 120, y: 120, width: 20, height: 20 })).toBe(true);
  });

  it("finds partial overlap from every side", () => {
    for (const other of [
      { x: 50, y: 120, width: 100, height: 20 },  // from the left
      { x: 150, y: 120, width: 100, height: 20 }, // from the right
      { x: 120, y: 50, width: 20, height: 100 },  // from above
      { x: 120, y: 150, width: 20, height: 100 }, // from below
    ]) {
      expect(intersects(box, other), JSON.stringify(other)).toBe(true);
    }
  });

  it("is symmetric", () => {
    const other = { x: 150, y: 150, width: 100, height: 100 };
    expect(intersects(box, other)).toBe(intersects(other, box));
  });

  it("does not count boxes that merely touch", () => {
    /* A marquee whose edge lands exactly on a node's edge has covered none of
       it. Counting that would mean a drag which appears to stop short still
       catches something. */
    expect(intersects(box, { x: 200, y: 100, width: 50, height: 50 })).toBe(false);
    expect(intersects(box, { x: 50, y: 100, width: 50, height: 50 })).toBe(false);
    expect(intersects(box, { x: 100, y: 200, width: 50, height: 50 })).toBe(false);
  });

  it("does not count a separated box", () => {
    expect(intersects(box, { x: 300, y: 300, width: 10, height: 10 })).toBe(false);
  });

  it("selects nothing for a zero-area marquee", () => {
    /* A click is a marquee with no area, and a click on empty canvas should
       clear the selection rather than catch whatever is under the cursor. */
    expect(intersects({ x: 150, y: 150, width: 0, height: 0 }, box)).toBe(false);
  });
});
