import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  type Viewport,
  clampZoom,
  panByScreenDelta,
  screenToWorld,
  worldToScreen,
  zoomAtScreenPoint,
} from "./viewport";

/**
 * §20: "Coordinate transform tests for pan/zoom and screen/world
 * reversibility." These are the tests the spec asks for before the renderer
 * exists — and they import no React, which is the standing proof that `core`
 * is still framework-free.
 */

/** Awkward on purpose: fractional zoom and negative pan are where sign and
 *  rounding errors actually surface. A viewport of {0,0,1} passes everything. */
const AWKWARD: Viewport = { pan: { x: -137.5, y: 42.25 }, zoom: 0.37 };

const VIEWS: readonly Viewport[] = [
  IDENTITY,
  AWKWARD,
  { pan: { x: 1e4, y: -1e4 }, zoom: 8 },
  { pan: { x: 0.1, y: 0.2 }, zoom: MIN_ZOOM },
];

const POINTS = [
  { x: 0, y: 0 },
  { x: 1, y: -1 },
  { x: 960.5, y: -540.25 },
  { x: -12345.75, y: 6789.125 },
];

describe("screen ↔ world", () => {
  it("round-trips a world point through screen space", () => {
    for (const view of VIEWS) {
      for (const world of POINTS) {
        const back = screenToWorld(worldToScreen(world, view), view);
        expect(back.x).toBeCloseTo(world.x, 6);
        expect(back.y).toBeCloseTo(world.y, 6);
      }
    }
  });

  it("round-trips a screen point through world space", () => {
    for (const view of VIEWS) {
      for (const screen of POINTS) {
        const back = worldToScreen(screenToWorld(screen, view), view);
        expect(back.x).toBeCloseTo(screen.x, 6);
        expect(back.y).toBeCloseTo(screen.y, 6);
      }
    }
  });

  it("puts the pan point at the screen origin, which is what pan MEANS", () => {
    const at = worldToScreen(AWKWARD.pan, AWKWARD);
    expect(at.x).toBeCloseTo(0, 10);
    expect(at.y).toBeCloseTo(0, 10);
  });

  it("scales distance by zoom and nothing else", () => {
    const a = worldToScreen({ x: 0, y: 0 }, AWKWARD);
    const b = worldToScreen({ x: 100, y: 0 }, AWKWARD);
    expect(b.x - a.x).toBeCloseTo(100 * AWKWARD.zoom, 6);
  });
});

describe("panByScreenDelta", () => {
  it("moves the world under the cursor by exactly the screen delta", () => {
    /* The regression this exists for: dividing by zoom is easy to forget, and
       the result is a canvas that tracks the pointer at 100% and drifts at
       every other zoom — invisible in a demo, maddening in use. */
    for (const view of VIEWS) {
      const before = screenToWorld({ x: 0, y: 0 }, view);
      const panned = panByScreenDelta(view, 40, -25);
      const after = screenToWorld({ x: 40, y: -25 }, panned);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it("never changes zoom", () => {
    expect(panByScreenDelta(AWKWARD, 10, 10).zoom).toBe(AWKWARD.zoom);
  });
});

describe("zoomAtScreenPoint", () => {
  it("holds the world point under the anchor completely still", () => {
    const anchor = { x: 631, y: 218 };
    for (const view of VIEWS) {
      for (const factor of [1.1, 0.9, 2, 0.5]) {
        const before = screenToWorld(anchor, view);
        const after = screenToWorld(anchor, zoomAtScreenPoint(view, anchor, factor));
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
      }
    }
  });

  it("holds it still across a long run of zooms, without drift", () => {
    /* One zoom step hiding a small error still looks right. Sixty of them,
       the way a trackpad actually arrives, is where it shows. */
    const anchor = { x: 400, y: 300 };
    let view = AWKWARD;
    const before = screenToWorld(anchor, view);
    for (let i = 0; i < 60; i++) {
      view = zoomAtScreenPoint(view, anchor, i % 2 === 0 ? 1.07 : 0.94);
    }
    const after = screenToWorld(anchor, view);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("clamps at both ends and returns the same viewport once clamped", () => {
    const hot = zoomAtScreenPoint({ pan: { x: 0, y: 0 }, zoom: MAX_ZOOM }, { x: 5, y: 5 }, 2);
    expect(hot.zoom).toBe(MAX_ZOOM);

    const cold = zoomAtScreenPoint({ pan: { x: 0, y: 0 }, zoom: MIN_ZOOM }, { x: 5, y: 5 }, 0.5);
    expect(cold.zoom).toBe(MIN_ZOOM);
  });

  it("clamps zoom into range", () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(1);
  });
});
