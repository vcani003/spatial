// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../core/fixture";
import { type History, commit, initHistory, undo } from "../core/history";
import type { NodeId } from "../core/ids";
import type { SpatialDocument } from "../core/schema";
import { Workspace } from "./Workspace";

/**
 * Selecting things and deleting them.
 *
 * The marquee's arithmetic is proved in `geometry.test.ts`. These prove the
 * wiring: that a press selects, that shift extends, that a drag moves
 * everything selected rather than only what is under the cursor, and that
 * Delete removes the selection in one undoable step.
 *
 * WHAT NEEDS A BROWSER: which nodes a marquee actually catches. jsdom reports
 * every element as zero-sized, so `offsetWidth`/`offsetHeight` are 0 and no
 * node has area to intersect. The marquee's *lifecycle* is testable here; what
 * it caught is verified in a browser and recorded in the commit.
 */

afterEach(cleanup);

const POINTER = {
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
  button: 0,
  buttons: 1,
} as const;

function mount() {
  const initial = makeFixture();
  let history: History<SpatialDocument> = initHistory(initial);

  const paint = (): void => {
    view.rerender(
      <Workspace
        doc={history.present}
        onChange={(next, key) => {
          history = commit(history, next, key);
          paint();
        }}
        saveState="saved"
        undo={() => {
          history = undo(history);
          paint();
        }}
        redo={() => undefined}
        canUndo
        canRedo={false}
      />,
    );
  };

  const view = render(
    <Workspace
      doc={initial}
      onChange={(next, key) => {
        history = commit(history, next, key);
        paint();
      }}
      saveState="saved"
      undo={() => {
        history = undo(history);
        paint();
      }}
      redo={() => undefined}
      canUndo
      canRedo={false}
    />,
  );

  const surface = view.container.querySelector("[class*=surface]") as HTMLElement;

  return {
    initial,
    surface,
    steps: () => history.past.length,
    doc: () => history.present,
    box: (startsWith: string): HTMLElement => {
      const found = [...view.container.querySelectorAll<HTMLElement>("[data-node-id]")].find(
        (el) => (el.textContent ?? "").startsWith(startsWith),
      );
      if (found === undefined) throw new Error(`no node starting "${startsWith}"`);
      return found;
    },
    selectedIds: (): string[] =>
      [...view.container.querySelectorAll<HTMLElement>("[data-node-id][data-selected]")].map(
        (el) => el.dataset.nodeId ?? "",
      ),
    placement: (id: NodeId) => history.present.nodes[id]?.presentations.desktop,
  };
}

const idOf = (doc: SpatialDocument, startsWith: string): NodeId => {
  const node = Object.values(doc.nodes).find(
    (n) => n.content.kind === "text" && n.content.text.startsWith(startsWith),
  );
  if (node === undefined) throw new Error("no such node");
  return node.id;
};

const press = (el: HTMLElement, init: object = {}): void => {
  fireEvent.pointerDown(el, { ...POINTER, clientX: 10, clientY: 10, ...init });
};
const release = (surface: HTMLElement): void => {
  fireEvent.pointerUp(surface, { ...POINTER, buttons: 0 });
};

describe("selecting", () => {
  it("selects one node on a plain press", () => {
    const app = mount();
    press(app.box("Spatial"));
    expect(app.selectedIds()).toHaveLength(1);
  });

  it("replaces the selection on the next plain press", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"));
    expect(app.selectedIds()).toHaveLength(1);
  });

  it("adds with shift, and removes with shift", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);

    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);
    expect(app.selectedIds()).toHaveLength(2);

    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);
    expect(app.selectedIds()).toHaveLength(1);
  });

  it("clears when the background is pressed", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);

    press(app.surface);
    expect(app.selectedIds()).toHaveLength(0);
  });

  it("clears on Escape", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(app.selectedIds()).toHaveLength(0);
  });
});

describe("dragging a selection", () => {
  it("moves every selected node, not just the one under the cursor", () => {
    /* Dragging one of several selected things and having the others stay put
       is the surprise that makes people stop trusting a selection. */
    const app = mount();
    const a = idOf(app.initial, "Spatial");
    const b = idOf(app.initial, "An infinite");
    const before = { a: app.placement(a), b: app.placement(b) };

    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);

    press(app.box("Spatial"));
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 40, movementY: 25 });
    release(app.surface);

    expect(app.placement(a)?.x).toBeCloseTo((before.a?.x ?? 0) + 40, 6);
    expect(app.placement(b)?.x).toBeCloseTo((before.b?.x ?? 0) + 40, 6);
    expect(app.placement(b)?.y).toBeCloseTo((before.b?.y ?? 0) + 25, 6);
  });

  it("keeps a group drag to one undo step", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);

    const before = app.steps();
    press(app.box("Spatial"));
    for (let i = 0; i < 8; i++) {
      fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 5, movementY: 0 });
    }
    release(app.surface);

    expect(app.steps()).toBe(before + 1);
  });

  it("does not drag a node that the same press just deselected", () => {
    const app = mount();
    const a = idOf(app.initial, "Spatial");
    press(app.box("Spatial"));
    release(app.surface);
    const settled = app.placement(a);

    press(app.box("Spatial"), { shiftKey: true });
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 60, movementY: 60 });
    release(app.surface);

    expect(app.placement(a)).toEqual(settled);
  });
});

describe("deleting", () => {
  it("removes the whole selection with Delete", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);

    fireEvent.keyDown(window, { key: "Delete" });
    expect(app.doc().paintOrder).toHaveLength(app.initial.paintOrder.length - 2);
  });

  it("works with Backspace too", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);

    fireEvent.keyDown(window, { key: "Backspace" });
    expect(app.doc().paintOrder).toHaveLength(app.initial.paintOrder.length - 1);
  });

  it("brings the whole selection back in ONE undo", () => {
    /* Deleting three things is one action from the person's side. Three
       presses of undo to reverse it would be the same punishment a drag
       without coalescing gives. */
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);

    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(app.doc().paintOrder).toHaveLength(app.initial.paintOrder.length);
  });

  it("does nothing with an empty selection", () => {
    const app = mount();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(app.doc()).toBe(app.initial);
  });

  it("leaves the document alone while typing", () => {
    /* Backspace inside the editor deletes a character, not the node. */
    const app = mount();
    fireEvent.doubleClick(app.box("Spatial"));
    const editor = document.querySelector('[contenteditable="plaintext-only"]');
    if (editor === null) throw new Error("no editor");

    const before = app.doc().paintOrder.length;
    fireEvent.keyDown(editor, { key: "Backspace" });
    expect(app.doc().paintOrder).toHaveLength(before);
  });
});

describe("the delete control", () => {
  const deleteButton = (): HTMLButtonElement =>
    screen.getByRole("button", { name: /delete/i }) as HTMLButtonElement;

  it("is visible but disabled with nothing selected", () => {
    /* Visible rather than hidden, so the toolbar teaches that selecting
       something enables it. It was a keyboard shortcut alone, which meant the
       feature existed and nothing on screen said so — the reasonable
       conclusion from looking at the toolbar was that you could not delete. */
    mount();
    expect(deleteButton().disabled).toBe(true);
  });

  it("enables once something is selected", () => {
    const app = mount();
    press(app.box("Spatial"));
    expect(deleteButton().disabled).toBe(false);
  });

  it("says how many when it is more than one", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);

    expect(deleteButton().textContent).toContain("2");
  });

  it("deletes the same things the key would", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);

    fireEvent.click(deleteButton());
    expect(app.doc().paintOrder).toHaveLength(app.initial.paintOrder.length - 2);
    expect(deleteButton().disabled).toBe(true);
  });

  it("is one undo, like the key", () => {
    const app = mount();
    press(app.box("Spatial"));
    release(app.surface);
    press(app.box("An infinite"), { shiftKey: true });
    release(app.surface);

    fireEvent.click(deleteButton());
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(app.doc().paintOrder).toHaveLength(app.initial.paintOrder.length);
  });
});

describe("the marquee", () => {
  it("appears on a shift-drag and goes away on release", () => {
    const app = mount();
    const marquee = () => app.surface.querySelector("[class*=marquee]");

    expect(marquee()).toBeNull();
    press(app.surface, { shiftKey: true, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(app.surface, { ...POINTER, clientX: 200, clientY: 160 });
    expect(marquee()).not.toBeNull();

    release(app.surface);
    expect(marquee()).toBeNull();
  });

  it("does not pan the view while it is being drawn", () => {
    /* Shift-drag is the marquee; a plain drag still pans. Getting these
       crossed would take panning away from a canvas that has always had it. */
    const app = mount();
    const world = app.surface.querySelector("div");
    const before = world?.getAttribute("style");

    press(app.surface, { shiftKey: true, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(app.surface, { ...POINTER, clientX: 300, clientY: 300, movementX: 280, movementY: 280 });

    expect(world?.getAttribute("style")).toBe(before);
    release(app.surface);
  });

  it("moves no node", () => {
    const app = mount();
    press(app.surface, { shiftKey: true, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(app.surface, { ...POINTER, clientX: 400, clientY: 400, movementX: 380, movementY: 380 });
    release(app.surface);

    for (const id of app.initial.paintOrder) {
      expect(app.placement(id)).toEqual(app.initial.nodes[id]?.presentations.desktop);
    }
  });
});
