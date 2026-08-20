// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../core/fixture";
import { type History, commit, initHistory, undo } from "../core/history";
import type { NodeId } from "../core/ids";
import type { SpatialDocument } from "../core/schema";
import { Workspace } from "./Workspace";

/**
 * Editing text in place, through the real component.
 *
 * The mutations are proved in `mutate.test.ts`. These prove the parts only the
 * editor decides: that a double-click opens an editor, that the pointer stops
 * moving the node while typing, that a whole editing session is one undo step,
 * and that emptying a node removes it rather than leaving something invisible
 * on the canvas.
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

  const nodeEl = (startsWith: string): HTMLElement => {
    const found = [...view.container.querySelectorAll("div")].find(
      (el) =>
        el.dataset.nodeId !== undefined &&
        (el.textContent ?? "").startsWith(startsWith),
    );
    if (found === undefined) throw new Error(`no node starting "${startsWith}"`);
    return found;
  };

  return {
    initial,
    surface,
    nodeEl,
    steps: () => history.past.length,
    doc: () => history.present,
    editor: (): HTMLElement | null =>
      view.container.querySelector('[contenteditable="plaintext-only"]'),
    textOf: (id: NodeId): string => {
      const content = history.present.nodes[id]?.content;
      return content?.kind === "text" ? content.text : "";
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

/** Types into the contenteditable the way a browser does: DOM first, then input. */
const type = (editor: HTMLElement, text: string): void => {
  editor.textContent = text;
  fireEvent.input(editor);
};

describe("opening an editor", () => {
  it("does not exist until a text node is double-clicked", () => {
    const app = mount();
    expect(app.editor()).toBeNull();

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    expect(app.editor()).not.toBeNull();
  });

  it("starts with the existing words, selected", () => {
    const app = mount();
    fireEvent.doubleClick(app.nodeEl("Spatial"));
    expect(app.editor()?.textContent).toBe("Spatial");
  });

  it("does not open on an image", () => {
    const app = mount();
    const image = app.surface.querySelector("img");
    const box = image?.closest("[data-node-id]");
    if (box === null || box === undefined) throw new Error("no image node");

    fireEvent.doubleClick(box);
    expect(app.editor()).toBeNull();
  });
});

describe("typing", () => {
  it("writes through to the document", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    type(app.editor() as HTMLElement, "renamed");
    expect(app.textOf(id)).toBe("renamed");
  });

  it("is one undo step for the whole session", () => {
    /* Same rule as a drag: a hundred keystrokes are one action. Without the
       shared key this would be one step per character. */
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const before = app.steps();

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    const editor = app.editor() as HTMLElement;
    for (const word of ["r", "re", "ren", "rena", "renam", "rename", "renamed"]) {
      type(editor, word);
    }

    expect(app.steps()).toBe(before + 1);
    expect(app.textOf(id)).toBe("renamed");
  });

  it("does not move the node when the pointer goes down on it", () => {
    /* Selecting a word must not drag the node out from under the caret. */
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const before = app.doc().nodes[id]?.presentations.desktop;

    const box = app.nodeEl("Spatial");
    fireEvent.doubleClick(box);
    /* The same box, now in edit mode. A pointer press here is someone reaching
       for a word, not for the node. */
    fireEvent.pointerDown(box, { ...POINTER, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(app.surface, { ...POINTER, movementX: 50, movementY: 50 });
    fireEvent.pointerUp(app.surface, { ...POINTER, buttons: 0 });

    expect(app.doc().nodes[id]?.presentations.desktop).toEqual(before);
  });
});

describe("leaving the editor", () => {
  it("closes on Escape, keeping what was typed", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    type(app.editor() as HTMLElement, "kept");
    fireEvent.keyDown(app.editor() as HTMLElement, { key: "Escape" });
    fireEvent.blur(app.editor() ?? document.body);

    expect(app.editor()).toBeNull();
    expect(app.textOf(id)).toBe("kept");
  });

  it("closes on Enter, and Shift+Enter does not", () => {
    const app = mount();
    fireEvent.doubleClick(app.nodeEl("Spatial"));

    fireEvent.keyDown(app.editor() as HTMLElement, { key: "Enter", shiftKey: true });
    expect(app.editor()).not.toBeNull();

    fireEvent.keyDown(app.editor() as HTMLElement, { key: "Enter" });
    fireEvent.blur(app.editor() ?? document.body);
    expect(app.editor()).toBeNull();
  });
});

describe("the screen never disagrees with the document", () => {
  it("updates the OPEN editor when the document changes underneath it", () => {
    /* THE REGRESSION THIS EXISTS FOR, and my first attempt at a guard did not
       catch it — the first version of this test blurred before undoing, which
       is the path that already worked. The failure needs the editor still
       open: it is uncontrolled, so an undo changed the document while the DOM
       kept showing what had been typed, and only a reload revealed the
       disagreement. Verified by removing the sync effect and watching this
       fail. */
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    type(app.editor() as HTMLElement, "typed but not committed");
    expect(app.textOf(id)).toBe("typed but not committed");

    /* Undo WITHOUT closing the editor first. */
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(app.textOf(id)).toBe("Spatial");
    expect(app.editor()?.textContent).toBe("Spatial");
  });

  it("shows the document's text after an undo, not what the editor left behind", () => {
    /* THE REGRESSION THIS EXISTS FOR, and it was invisible until a reload.
       Both branches render a `<p>` in the same position, so React reused the
       editor's element as the read-only one. The editor is uncontrolled by
       design — it mutates `textContent` so the caret survives — so React's
       virtual DOM no longer matched the real DOM and its diff skipped the
       update. On screen: "hello". In the document: "Spatial". Distinct keys
       force a fresh element, so the text below is always rendered from the
       document. */
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    type(app.editor() as HTMLElement, "hello");
    fireEvent.blur(app.editor() as HTMLElement);
    expect(app.textOf(id)).toBe("hello");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(app.textOf(id)).toBe("Spatial");
    /* The assertion that failed before: what is actually on screen. */
    expect(app.nodeEl("Spatial").textContent).toBe("Spatial");
  });

  it("shows edited text after the editor closes", () => {
    const app = mount();
    fireEvent.doubleClick(app.nodeEl("Spatial"));
    type(app.editor() as HTMLElement, "renamed in place");
    fireEvent.blur(app.editor() as HTMLElement);

    expect(app.editor()).toBeNull();
    expect(app.nodeEl("renamed").textContent).toBe("renamed in place");
  });
});

describe("emptying a node removes it", () => {
  it("deletes a node whose text is erased", () => {
    /* An empty text node renders as nothing: it cannot be seen, selected or
       double-clicked. Leaving it is invisible state, which §19 says must not
       be able to accumulate. */
    const app = mount();
    const id = idOf(app.initial, "Spatial");

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    type(app.editor() as HTMLElement, "   ");
    fireEvent.blur(app.editor() as HTMLElement);

    expect(app.doc().nodes[id]).toBeUndefined();
    expect(app.doc().paintOrder).not.toContain(id);
  });

  it("brings it back in one undo", () => {
    const app = mount();
    const id = idOf(app.initial, "Spatial");
    const nodesBefore = Object.keys(app.doc().nodes).length;

    fireEvent.doubleClick(app.nodeEl("Spatial"));
    type(app.editor() as HTMLElement, "");
    fireEvent.blur(app.editor() as HTMLElement);
    expect(app.doc().nodes[id]).toBeUndefined();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(Object.keys(app.doc().nodes)).toHaveLength(nodesBefore);
    expect(app.textOf(id)).toBe("Spatial");
  });
});
