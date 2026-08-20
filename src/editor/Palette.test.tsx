// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../core/fixture";
import type { SpatialDocument } from "../core/schema";
import { Workspace } from "./Workspace";

/**
 * Adding elements, through the shell rather than the palette in isolation —
 * the interesting parts are the wiring: that it opens on its shortcut, that
 * what it makes reaches the document, that a dropped node lands where the
 * pointer let go, and that a refused URL says so instead of doing nothing.
 *
 * WHAT JSDOM CANNOT ANSWER, named rather than faked: it does no layout, so
 * `getBoundingClientRect()` is all zeroes and `worldAt` cannot map a drop to a
 * real world point. These tests prove a drop reaches the canvas with the right
 * coordinates and that an out-of-bounds drop creates nothing; that the point
 * is the RIGHT one at a given pan and zoom is `viewport.test.ts` plus a
 * browser measurement, recorded in the commit.
 */

afterEach(cleanup);

function mount() {
  const initial = makeFixture();
  let doc: SpatialDocument = initial;
  const onChange = vi.fn((next: SpatialDocument) => {
    doc = next;
    view.rerender(<Workspace doc={doc} onChange={onChange} saveState="saved" undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false} />);
  });
  const view = render(<Workspace doc={initial} onChange={onChange} saveState="saved" undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false} />);

  /* GIVE THE CANVAS A SIZE. jsdom does no layout, so every element reports a
     zero-sized rect — which makes `worldAt` treat EVERY point as outside the
     canvas and every drop a no-op. Without this the drop tests would pass by
     doing nothing, which is worse than not having them.

     Stubbing the rect is honest here because what these tests check is the
     WIRING: that a drop reaches the canvas carrying the pointer's coordinates,
     and that a point outside is refused. Whether the resulting world point is
     correct at a given pan and zoom is `viewport.test.ts`, plus a browser
     measurement recorded in the commit. */
  const surface = view.container.querySelector("[class*=surface]");
  if (surface !== null) {
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  return { initial, onChange, current: () => doc };
}

const openPalette = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
};
const textTile = (): HTMLElement => screen.getByRole("button", { name: /^text$/i });
const imageTile = (): HTMLElement => screen.getByRole("button", { name: /^image$/i });
const urlField = (): HTMLElement => screen.getByLabelText(/image address/i);

const POINTER = { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 } as const;

/** Picks a tile up and lets go at a point in the viewport. */
const dragTo = (tile: HTMLElement, x: number, y: number): void => {
  fireEvent.pointerDown(tile, { ...POINTER, buttons: 1 });
  fireEvent.pointerMove(window, { ...POINTER, clientX: x, clientY: y });
  fireEvent.pointerUp(window, { ...POINTER, clientX: x, clientY: y, buttons: 0 });
};

describe("the palette", () => {
  it("is closed until asked for", () => {
    mount();
    expect(screen.queryByRole("button", { name: /^text$/i })).toBeNull();
  });

  it("opens on ⌘B", () => {
    mount();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(textTile()).not.toBeNull();
  });

  it("opens from the toolbar", () => {
    mount();
    openPalette();
    expect(textTile()).not.toBeNull();
  });

  it("offers a ghost only while a tile is held", () => {
    mount();
    openPalette();
    expect(textTile().hasAttribute("data-dragging")).toBe(false);

    fireEvent.pointerDown(textTile(), { ...POINTER, buttons: 1 });
    expect(textTile().hasAttribute("data-dragging")).toBe(true);

    fireEvent.pointerUp(window, { ...POINTER, clientX: 5, clientY: 5, buttons: 0 });
    expect(textTile().hasAttribute("data-dragging")).toBe(false);
  });
});

describe("dropping text", () => {
  it("adds a node and opens its editor", () => {
    /* Dropped text arrives EMPTY and immediately editable — there is nothing
       to say yet, and inventing placeholder words would only have to be
       deleted. */
    const app = mount();
    openPalette();
    dragTo(textTile(), 200, 160);

    expect(app.current().paintOrder).toHaveLength(app.initial.paintOrder.length + 1);
    expect(document.querySelector('[contenteditable="plaintext-only"]')).not.toBeNull();
  });

  it("leaves nothing behind if it is never typed into", () => {
    /* The editor's own rule doing the work: an empty text node is removed when
       its editor closes, so dropping one and changing your mind costs
       nothing. */
    const app = mount();
    openPalette();
    dragTo(textTile(), 200, 160);

    const editor = document.querySelector('[contenteditable="plaintext-only"]');
    if (editor === null) throw new Error("no editor opened");
    fireEvent.blur(editor);

    expect(app.current().paintOrder).toHaveLength(app.initial.paintOrder.length);
  });

  it("removes an abandoned empty node when the canvas is pressed", () => {
    /* THE REGRESSION THIS EXISTS FOR. Blur was the only path that cleaned up
       an untouched text node, and pressing the background cleared the editing
       state directly — so dropping a node and clicking away left an empty box
       in the document: unselectable, invisible, and impossible to find again.
       Worse, a dropped node's editor can end up open with focus already
       elsewhere, in which case no blur is ever fired at all. */
    const app = mount();
    openPalette();
    dragTo(textTile(), 240, 180);
    expect(app.current().paintOrder).toHaveLength(app.initial.paintOrder.length + 1);

    const surface = document.querySelector("[class*=surface]");
    if (surface === null) throw new Error("no surface");
    fireEvent.pointerDown(surface, { ...POINTER, buttons: 1, clientX: 40, clientY: 40 });

    expect(app.current().paintOrder).toHaveLength(app.initial.paintOrder.length);
  });

  it("keeps it once there are words", () => {
    const app = mount();
    openPalette();
    dragTo(textTile(), 200, 160);

    const editor = document.querySelector('[contenteditable="plaintext-only"]');
    if (editor === null) throw new Error("no editor opened");
    editor.textContent = "dropped and typed";
    fireEvent.input(editor);
    fireEvent.blur(editor);

    const added = Object.values(app.current().nodes).find(
      (n) => n.content.kind === "text" && n.content.text === "dropped and typed",
    );
    expect(added).toBeDefined();
  });

  it("creates nothing when dropped outside the canvas", () => {
    /* Past the right edge of the stubbed 800x600 surface — a drop on the
       toolbar, the preview, or off the window. Placing a node somewhere the
       person did not point is worse than not placing it. */
    const app = mount();
    openPalette();
    dragTo(textTile(), 900, 700);
    expect(app.current().paintOrder).toHaveLength(app.initial.paintOrder.length);
  });

  it("lands where the pointer let go", () => {
    const app = mount();
    openPalette();
    dragTo(textTile(), 240, 180);

    const order = app.current().paintOrder;
    const id = order[order.length - 1];
    const placement = id === undefined ? undefined : app.current().nodes[id]?.presentations.desktop;
    if (placement === undefined) throw new Error("nothing was added");

    /* The identity viewport maps screen to world one-to-one, and the node is
       centred on the drop, so its box straddles the point. */
    expect(placement.x + placement.width / 2).toBeCloseTo(240, 6);
    expect(placement.y).toBeCloseTo(180, 6);
  });
});

describe("placing without dragging", () => {
  it("puts a text node in view when the tile is pressed", () => {
    /* A tool reachable only by dragging is a tool nobody on a keyboard can
       reach. */
    const app = mount();
    openPalette();
    fireEvent.click(textTile());

    expect(app.current().paintOrder).toHaveLength(app.initial.paintOrder.length + 1);
    expect(document.querySelector('[contenteditable="plaintext-only"]')).not.toBeNull();
  });
});

describe("adding an image", () => {
  it("will not offer the tile without an address", () => {
    mount();
    openPalette();
    expect((imageTile() as HTMLButtonElement).disabled).toBe(true);
  });

  it("places one once there is a valid address", () => {
    const app = mount();
    openPalette();
    fireEvent.change(urlField(), { target: { value: "https://example.com/a.jpg" } });
    fireEvent.click(imageTile());

    const added = Object.values(app.current().nodes).find(
      (n) => n.content.kind === "image" && n.content.src === "https://example.com/a.jpg",
    );
    expect(added).toBeDefined();
  });

  it("refuses an unsafe scheme, and says why", () => {
    /* §11's allowlist is enforced in core; what matters here is that the
       refusal is VISIBLE. A validator that silently does nothing is
       indistinguishable from a broken button. */
    const app = mount();
    openPalette();
    fireEvent.change(urlField(), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(imageTile());

    expect(app.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/https?:\/\//i);
    expect(urlField().getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the refusal once the address is edited again", () => {
    mount();
    openPalette();
    fireEvent.change(urlField(), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(imageTile());
    expect(screen.queryByRole("alert")).not.toBeNull();

    fireEvent.change(urlField(), { target: { value: "https://example.com/a.jpg" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not open an editor for an image", () => {
    mount();
    openPalette();
    fireEvent.change(urlField(), { target: { value: "https://example.com/a.jpg" } });
    fireEvent.click(imageTile());
    expect(document.querySelector('[contenteditable="plaintext-only"]')).toBeNull();
  });
});

describe("what a new node must not disturb", () => {
  it("goes on top of the paint order", () => {
    const app = mount();
    openPalette();
    fireEvent.change(urlField(), { target: { value: "https://example.com/top.jpg" } });
    fireEvent.click(imageTile());

    const order = app.current().paintOrder;
    const last = order[order.length - 1];
    const node = last === undefined ? undefined : app.current().nodes[last];
    expect(node?.content.kind === "image" && node.content.src).toBe("https://example.com/top.jpg");
  });

  it("leaves everything that was already there alone", () => {
    const app = mount();
    openPalette();
    fireEvent.change(urlField(), { target: { value: "https://example.com/b.jpg" } });
    fireEvent.click(imageTile());

    for (const id of app.initial.paintOrder) {
      expect(app.current().nodes[id]).toEqual(app.initial.nodes[id]);
    }
  });
});
