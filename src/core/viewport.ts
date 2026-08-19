/**
 * =============================================================================
 * VIEWPORT — the one coordinate system, and how to get in and out of it
 * =============================================================================
 *
 * There are two spaces and confusing them is the most common source of
 * canvas bugs:
 *
 *   WORLD   where nodes live. Infinite, never changes when the view moves.
 *           Everything persisted is in world units.
 *   SCREEN  pixels in the canvas element. What a pointer event reports.
 *
 * The transform is:
 *
 *   screen = (world - pan) * zoom
 *   world  = screen / zoom + pan
 *
 * `pan` is THE WORLD POINT SITTING AT THE SCREEN'S ORIGIN. Stating that
 * plainly matters, because the other plausible reading — "how far the content
 * has been pushed" — is the same numbers with the opposite sign, and the two
 * are indistinguishable until something is off-screen in the wrong direction.
 *
 * §23 step 3 asks for this module and its tests before the renderer exists,
 * and it is in `core` because it is arithmetic: no element, no pointer, no
 * React. See ./README.md.
 * ========================================================================== */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  /** World coordinate currently at the screen's top-left. */
  readonly pan: Point;
  /** Screen pixels per world unit. Always > 0. */
  readonly zoom: number;
}

/**
 * Zoom bounds.
 *
 * Not taste — both ends are correctness. Below the floor, world coordinates
 * divided by zoom grow fast enough to lose meaningful precision; above the
 * ceiling a one-pixel pointer movement becomes a large world jump and drags
 * feel like they are fighting the user. Clamping in one place means no
 * caller has to remember either.
 */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 12;

export const IDENTITY: Viewport = { pan: { x: 0, y: 0 }, zoom: 1 };

export const clampZoom = (zoom: number): number =>
  Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);

export function worldToScreen(world: Point, view: Viewport): Point {
  return {
    x: (world.x - view.pan.x) * view.zoom,
    y: (world.y - view.pan.y) * view.zoom,
  };
}

export function screenToWorld(screen: Point, view: Viewport): Point {
  return {
    x: screen.x / view.zoom + view.pan.x,
    y: screen.y / view.zoom + view.pan.y,
  };
}

/**
 * Pan by a distance measured in SCREEN pixels.
 *
 * The division is the whole point: dragging the canvas 10px must move the
 * world by 10px-worth at the current zoom, not by 10 world units. Getting
 * this wrong produces a canvas that feels correct at 100% and slides at
 * every other zoom level — which is exactly the bug that hides in a demo.
 */
export function panByScreenDelta(view: Viewport, dx: number, dy: number): Viewport {
  return {
    zoom: view.zoom,
    pan: { x: view.pan.x - dx / view.zoom, y: view.pan.y - dy / view.zoom },
  };
}

/**
 * Zoom about a fixed screen point — the cursor, usually.
 *
 * THE INVARIANT: the world point under that screen point before the zoom is
 * the world point under it after. Anything else is the "zoom to the middle
 * and then hunt for what you were looking at" behaviour that makes a canvas
 * feel broken. Derived rather than approximated:
 *
 *   world stays fixed  ⇒  (w - pan') * z' = anchor  ⇒  pan' = w - anchor / z'
 *
 * Returns the viewport unchanged when the clamp bites, so callers can hold a
 * zoom key at the limit without accumulating drift.
 */
export function zoomAtScreenPoint(
  view: Viewport,
  anchor: Point,
  factor: number,
): Viewport {
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;

  const world = screenToWorld(anchor, view);
  return {
    zoom,
    pan: { x: world.x - anchor.x / zoom, y: world.y - anchor.y / zoom },
  };
}


/* =============================================================================
   FINDING YOUR WAY BACK
   ============================================================================= */

/** A rectangle in world space. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Air left around the content when framing it, in SCREEN pixels.
 *
 * Screen rather than world on purpose: it is breathing room in the window, so
 * it should look the same however far out the result ends up zoomed.
 */
export const FIT_PADDING = 64;

/**
 * The viewport that frames `bounds` inside a viewport of `size`.
 *
 * ── IT NEVER MAGNIFIES ──────────────────────────────────────────────────────
 *
 * Zoom is capped at 1 even when the content would fit at 4×. "Fit" means see
 * everything, not fill the screen with one word — a canvas holding a single
 * short line should not answer with that line at 400%. Zooming further in is
 * what the wheel is for.
 *
 * Empty or degenerate bounds return the viewport unchanged rather than an
 * invented one: there is nothing to frame, and snapping someone to the origin
 * when they pressed a button expecting to see their work is worse than doing
 * nothing.
 */
export function fitTo(
  bounds: Bounds,
  size: { readonly width: number; readonly height: number },
  current: Viewport,
): Viewport {
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  if (contentWidth <= 0 || contentHeight <= 0) return current;
  if (size.width <= 0 || size.height <= 0) return current;

  /* At least one pixel of room, so a viewport smaller than the padding cannot
     produce a negative scale. */
  const availableWidth = Math.max(1, size.width - FIT_PADDING * 2);
  const availableHeight = Math.max(1, size.height - FIT_PADDING * 2);

  const zoom = clampZoom(
    Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight),
  );

  /* Centre the content: the world point at the middle of the bounds should land
     at the middle of the screen. Rearranged from `screen = (world - pan) * zoom`
     with screen fixed at size/2. */
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;

  return {
    zoom,
    pan: {
      x: centreX - size.width / (2 * zoom),
      y: centreY - size.height / (2 * zoom),
    },
  };
}

/** The rectangle containing every box given, or null if there are none. */
export function boundsOf(
  boxes: readonly { x: number; y: number; width: number; height: number }[],
): Bounds | null {
  if (boxes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return { minX, minY, maxX, maxY };
}
