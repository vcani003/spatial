// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../core/fixture";
import {
  type History,
  canRedo,
  canUndo,
  commit,
  initHistory,
  redo,
  undo,
} from "../core/history";
import type { NodeId } from "../core/ids";
import type { SpatialDocument } from "../core/schema";
import { Workspace } from "./Workspace";

/**
 * Undo through the real component, not the model.
 *
 * `history.test.ts` proves the machine. This proves the WIRING: that a drag
 * actually labels its frames, that the label reaches the history, and that one
 * gesture is therefore one press of ⌘Z. Those are separate failures — the
 * model was correct the whole time the canvas could still have committed sixty
 * unlabelled steps.
 */

afterEach(cleanup);

const POINTER = {
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
  button: 0,
  buttons: 1,
} as const;

/** A miniature of what `useDocument` does, so the test drives real history. */
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
        redo={() => {
          history = redo(history);
          paint();
        }}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
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
      redo={() => {
        history = redo(history);
        paint();
      }}
      canUndo={false}
      canRedo={false}
    />,
  );

  const surface = view.container.querySelector("[class*=surface]");
  if (surface === null) throw new Error("no canvas surface");

  return {
    initial,
    surface: surface as HTMLElement,
    steps: () => history.past.length,
    placement: (id: NodeId) => history.present.nodes[id]?.presentations.desktop,
    nodeEl: (startsWith: string): HTMLElement => {
      const found = [...view.container.querySelectorAll("div")].find(
        (el) =>
          el.querySelector("p")?.textContent?.startsWith(startsWith) === true &&
          el.style.transform.startsWith("translate("),
      );
      if (found === undefined) throw new Error(`no node starting "${startsWith}"`);
      return found;
    },
  };
}

const idOf = (doc: SpatialDocument, startsWith: string): NodeId => {
  const node = Object.values(doc.nodes).find(
    (n) => n.content.kind === "text" && n.content.text.startsWith(startsWith),
  );
  if (node === undefined) throw new Error("no such node");
  return node.id;
};

const drag = (app: ReturnType<typeof mount>, label: string, frames: number): void => {
  fireEvent.pointerDown(app.nodeEl(label), { ...POINTER, clientX: 0, clientY: 0 });
  for (let i = 0; i < frames; i++) {
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 5, movementY: 3 });
  }
  fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });
};

const pressUndo = (): void => {
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
};
const pressRedo = (): void => {
  fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
};

describe("a drag is one undo step", () => {
  it("collapses twenty pointer frames into a single step", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const before = app.placement(id);

    drag(app, "Spatial", 20);
    expect(app.placement(id)?.x).toBeCloseTo((before?.x ?? 0) + 100, 6);

    /* One step for the whole gesture. Without the gesture key this would be
       twenty, and moving a node back would take twenty presses. */
    expect(app.steps()).toBe(1);

    pressUndo();
    expect(app.placement(id)).toEqual(before);
  });

  it("keeps two drags of the same node as two steps", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const start = app.placement(id);

    drag(app, "Spatial", 5);
    const afterFirst = app.placement(id);
    drag(app, "Spatial", 5);

    pressUndo();
    expect(app.placement(id)).toEqual(afterFirst);
    pressUndo();
    expect(app.placement(id)).toEqual(start);
  });

  it("redoes what it undid", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    drag(app, "Spatial", 6);
    const moved = app.placement(id);

    pressUndo();
    expect(app.placement(id)).not.toEqual(moved);
    pressRedo();
    expect(app.placement(id)).toEqual(moved);
  });
});

describe("the toolbar", () => {
  it("disables undo until there is something to undo", () => {
    const app = mount();
    const button = screen.getByRole("button", { name: /undo/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    drag(app, "Spatial", 3);
    expect((screen.getByRole("button", { name: /undo/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables redo until something has been undone", () => {
    const app = mount();
    drag(app, "Spatial", 3);
    expect((screen.getByRole("button", { name: /redo/i }) as HTMLButtonElement).disabled).toBe(true);

    pressUndo();
    expect((screen.getByRole("button", { name: /redo/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("undoes from the button as well as the shortcut", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const before = app.placement(id);

    drag(app, "Spatial", 4);
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(app.placement(id)).toEqual(before);
  });
});

describe("what undo must not swallow", () => {
  it("does not fire while a text field has focus", () => {
    /* ⌘Z in the create bar means undo the TEXT, not the canvas. */
    const app = mount();
    drag(app, "Spatial", 3);
    const moved = app.placement(idOf(app.initial, "Spatial"));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });

    expect(app.placement(idOf(app.initial, "Spatial"))).toEqual(moved);
    input.remove();
  });

  it("records nothing for a click that moves a node nowhere", () => {
    /* Pressing a node raises it to the front, which IS a document change — but
       a press with no movement should not leave an undo step that appears to
       do nothing. It is one step for the raise, not one per frame. */
    const app = mount();
    fireEvent.pointerDown(app.nodeEl("Spatial"), { ...POINTER, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });
    expect(app.steps()).toBeLessThanOrEqual(1);
  });
});
