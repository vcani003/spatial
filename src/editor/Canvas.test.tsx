// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../core/fixture";
import type { NodeId } from "../core/ids";
import type { SpatialDocument } from "../core/schema";
import { Canvas } from "./Canvas";

/**
 * =============================================================================
 * THE GESTURES — drag, pan, zoom
 * =============================================================================
 *
 * `viewport.test.ts` proves the ARITHMETIC. These prove the WIRING: that a
 * pointer event reaches the right piece of that arithmetic, with the right
 * sign, divided by the right zoom. Those are separate failures — the maths was
 * correct the entire time the canvas could still have dragged the wrong node
 * or panned backwards — and only the second kind survives a refactor of the
 * component.
 *
 * ── WHAT NEEDS A REAL BROWSER, AND IS NOT FAKED HERE ────────────────────────
 *
 * jsdom does no layout, so `getBoundingClientRect` returns zeroes. Anything
 * whose result depends on where an element physically IS cannot be asserted:
 *
 *   - zoom anchored to the cursor, which subtracts the surface's rect
 *   - the mobile preview's fit-to-panel scale
 *   - that a collapsed panel returns its width to the canvas
 *
 * Those were each verified in a real browser and the measurements recorded in
 * their commits. Mocking a rect to make them "pass" here would be a test that
 * agrees with whatever the code currently does.
 *
 * What IS assertable is everything driven by DELTAS rather than positions —
 * which, deliberately, is most of the interaction model: `movementX/Y` for
 * drags and pans, `deltaY` for zoom.
 */

afterEach(cleanup);

const POINTER = {
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
  button: 0,
  buttons: 1,
} as const;

/** Renders the canvas and keeps the document up to date the way the app does. */
function mount() {
  const initial = makeFixture();
  let doc: SpatialDocument = initial;
  const onChange = vi.fn((next: SpatialDocument) => {
    doc = next;
    view.rerender(<Canvas doc={doc} onChange={onChange} saveState="saved" />);
  });

  const view = render(<Canvas doc={doc} onChange={onChange} saveState="saved" />);

  const surface = view.container.querySelector("div");
  if (surface === null) throw new Error("no canvas surface");

  return {
    initial,
    onChange,
    surface,
    current: () => doc,
    /** The rendered element for a node, found by the text it carries. */
    nodeEl: (startsWith: string): HTMLElement => {
      const found = [...view.container.querySelectorAll("div")].find(
        (element) =>
          element.querySelector("p")?.textContent?.startsWith(startsWith) === true &&
          element.style.transform.startsWith("translate("),
      );
      if (found === undefined) throw new Error(`no node starting "${startsWith}"`);
      return found;
    },
    placement: (id: NodeId) => doc.nodes[id]?.presentations.desktop,
  };
}

const idOf = (doc: SpatialDocument, startsWith: string): NodeId => {
  const node = Object.values(doc.nodes).find(
    (candidate) => candidate.content.kind === "text" && candidate.content.text.startsWith(startsWith),
  );
  if (node === undefined) throw new Error(`no node starting "${startsWith}"`);
  return node.id;
};

describe("dragging a node", () => {
  it("moves it by the pointer delta at 100%", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const before = app.placement(id);

    fireEvent.pointerDown(app.nodeEl("Spatial"), { ...POINTER, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 30, movementY: 20 });
    fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });

    const after = app.placement(id);
    expect(after?.x).toBeCloseTo((before?.x ?? 0) + 30, 6);
    expect(after?.y).toBeCloseTo((before?.y ?? 0) + 20, 6);
  });

  it("accumulates over the frames of one gesture", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const before = app.placement(id);

    fireEvent.pointerDown(app.nodeEl("Spatial"), { ...POINTER, clientX: 0, clientY: 0 });
    for (let i = 0; i < 5; i++) {
      fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 10, movementY: -4 });
    }
    fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });

    expect(app.placement(id)?.x).toBeCloseTo((before?.x ?? 0) + 50, 6);
    expect(app.placement(id)?.y).toBeCloseTo((before?.y ?? 0) - 20, 6);
  });

  it("stops moving it once the pointer is released", () => {
    /* A drag that keeps following the mouse after mouseup is the classic
       stuck-gesture bug, and it is invisible until someone notices the canvas
       is haunted. */
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    fireEvent.pointerDown(app.nodeEl("Spatial"), { ...POINTER, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 10, movementY: 10 });
    fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });

    const settled = app.placement(id);
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 100, movementY: 100 });
    expect(app.placement(id)).toEqual(settled);
  });

  it("moves only the node that was grabbed", () => {
    const app = mount();
    const dragged = idOf(app.initial, "Spatial");

    fireEvent.pointerDown(app.nodeEl("Spatial"), { ...POINTER, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 60, movementY: 60 });
    fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });

    for (const id of app.initial.paintOrder) {
      if (id === dragged) continue;
      expect(app.placement(id)).toEqual(app.initial.nodes[id]?.presentations.desktop);
    }
  });

  it("raises the grabbed node to the front without changing its geometry", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    fireEvent.pointerDown(app.nodeEl("Spatial"), { ...POINTER, clientX: 0, clientY: 0 });

    const order = app.current().paintOrder;
    expect(order[order.length - 1]).toBe(id);
    expect(app.placement(id)).toEqual(app.initial.nodes[id]?.presentations.desktop);
  });
});

describe("panning the surface", () => {
  it("moves no node at all", () => {
    /* THE REGRESSION THIS GUARDS: a background drag that is mistaken for a
       node drag silently rewrites the document. Panning is viewport state and
       must never reach the document — §15 puts it explicitly on the editor
       side of that line. */
    const app = mount();

    fireEvent.pointerDown(app.surface, { ...POINTER, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 120, movementY: 90 });
    fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });

    expect(app.current()).toBe(app.initial);
    expect(app.onChange).not.toHaveBeenCalled();
  });

  it("translates the world", () => {
    const app = mount();
    const world = app.surface.querySelector("div");
    if (world === null) throw new Error("no world element");
    const before = world.style.transform;

    fireEvent.pointerDown(app.surface, { ...POINTER, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 50, movementY: 25 });

    expect(world.style.transform).not.toBe(before);
    /* Dragging the surface right moves the world right, so the pan origin
       moves LEFT — the sign that is easy to invert and instantly obvious. */
    expect(world.style.transform).toContain("translate(50px, 25px)");
  });
});

describe("zooming", () => {
  const scaleOf = (surface: HTMLElement): number => {
    const world = surface.querySelector("div");
    const match = /scale\(([\d.]+)\)/.exec(world?.style.transform ?? "");
    return match?.[1] === undefined ? Number.NaN : Number.parseFloat(match[1]);
  };

  it("zooms in on ctrl+wheel up and out on wheel down", () => {
    const app = mount();
    expect(scaleOf(app.surface)).toBeCloseTo(1, 6);

    fireEvent.wheel(app.surface, { ctrlKey: true, deltaY: -200, clientX: 0, clientY: 0 });
    const zoomedIn = scaleOf(app.surface);
    expect(zoomedIn).toBeGreaterThan(1);

    fireEvent.wheel(app.surface, { ctrlKey: true, deltaY: 200, clientX: 0, clientY: 0 });
    expect(scaleOf(app.surface)).toBeLessThan(zoomedIn);
  });

  it("pans on a plain wheel instead of zooming", () => {
    /* A trackpad reports a two-finger scroll as a plain wheel and a pinch as
       ctrl+wheel. Treating both as zoom is what makes a canvas feel hostile on
       a laptop. */
    const app = mount();
    fireEvent.wheel(app.surface, { deltaX: 30, deltaY: 40, clientX: 0, clientY: 0 });

    expect(scaleOf(app.surface)).toBeCloseTo(1, 6);
    const world = app.surface.querySelector("div");
    expect(world?.style.transform).toContain("translate(");
  });

  it("changes no node's stored coordinates", () => {
    /* Zoom is presentation. If it ever reaches the document, every zoom is an
       edit and the file changes when nobody edited anything. */
    const app = mount();
    for (let i = 0; i < 6; i++) {
      fireEvent.wheel(app.surface, { ctrlKey: true, deltaY: -150, clientX: 10, clientY: 10 });
    }

    expect(app.current()).toBe(app.initial);
    expect(app.onChange).not.toHaveBeenCalled();
  });

  it("clamps rather than running away", () => {
    const app = mount();
    for (let i = 0; i < 80; i++) {
      fireEvent.wheel(app.surface, { ctrlKey: true, deltaY: -400, clientX: 0, clientY: 0 });
    }
    expect(scaleOf(app.surface)).toBeLessThanOrEqual(12);

    for (let i = 0; i < 200; i++) {
      fireEvent.wheel(app.surface, { ctrlKey: true, deltaY: 400, clientX: 0, clientY: 0 });
    }
    expect(scaleOf(app.surface)).toBeGreaterThanOrEqual(0.05);
  });
});
