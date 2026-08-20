import { useEffect, useRef } from "react";
import type { NodeId } from "../core/ids";
import type { SpatialNode } from "../core/schema";
import styles from "./Canvas.module.css";

/**
 * One node, positioned in WORLD units.
 *
 * It knows nothing about the viewport — the wrapper above it carries the
 * whole transform — which is what keeps pan and zoom O(1) instead of O(nodes)
 * and keeps this component about content rather than geometry.
 *
 * `alt` goes straight onto the `<img>`. That is not thoroughness for its own
 * sake: §7 makes accessible structure architectural rather than a later pass,
 * and the cheapest way to keep that true is for the first renderer ever
 * written to have nowhere to put an image without also carrying its
 * description.
 *
 * ── EDITING HAPPENS IN PLACE ────────────────────────────────────────────────
 *
 * A text node becomes editable where it sits rather than in a panel or a
 * modal, because the whole point of a canvas is that position is meaningful —
 * editing somewhere else asks you to hold the layout in your head while you
 * type.
 *
 * `contentEditable="plaintext-only"` rather than plain `contentEditable`: the
 * latter accepts pasted HTML, and a document model whose text content can
 * arrive carrying markup is one where "text" quietly means something else.
 * The schema stores a string; this is what keeps it one.
 */
export function NodeView({
  node,
  selected,
  editing,
  onPointerDown,
  onEditStart,
  onEditText,
  onEditDone,
}: {
  node: SpatialNode;
  selected: boolean;
  editing: boolean;
  onPointerDown: (event: React.PointerEvent, id: NodeId) => void;
  onEditStart: (id: NodeId) => void;
  onEditText: (text: string) => void;
  onEditDone: () => void;
}) {
  const { x, y, width, height } = node.presentations.desktop;

  return (
    <div
      className={styles.node}
      /* Measurable by id. A text node's height is intrinsic, so the only place
         that knows how tall it actually came out is the DOM. */
      data-node-id={node.id}
      data-selected={selected ? "" : undefined}
      data-editing={editing ? "" : undefined}
      /* An absent height is intrinsic, so it must not reach the DOM as
         `height: undefined` — it simply is not set, and the box takes the
         height of the words inside it. */
      style={{ transform: `translate(${x}px, ${y}px)`, width, ...(height === undefined ? {} : { height }) }}
      onPointerDown={(event) => {
        /* WHILE EDITING, THE POINTER BELONGS TO THE TEXT. Letting this through
           would start a drag on the first click of a selection, so choosing a
           word would move the node instead of selecting inside it. */
        if (editing) return;
        onPointerDown(event, node.id);
      }}
      onDoubleClick={(event) => {
        if (node.content.kind !== "text") return;
        /* Otherwise the surface beneath reads it as two ordinary clicks. */
        event.stopPropagation();
        onEditStart(node.id);
      }}
    >
      {node.content.kind === "text" ? (
        editing ? (
          /* KEYED, AND THE KEYS MUST DIFFER FROM THE ONE BELOW.
             Both branches render a `<p>` in the same position, so without
             distinct keys React reuses one DOM element as the other. The
             editor is deliberately uncontrolled — it mutates `textContent`
             directly so the caret survives typing — which means React's
             virtual DOM stops matching the real one. Reused, the read-only
             `<p>` can then keep the text the EDITOR left behind while the
             document says something else: after an undo the screen showed
             "hello" while the stored document said "Spatial", and only a
             reload revealed the disagreement.

             Distinct keys force a fresh element in both directions, so the
             text below is always rendered from the document. */
          <TextEditor
            key="editing"
            text={node.content.text}
            onInput={onEditText}
            onDone={onEditDone}
          />
        ) : (
          <p key="text" className={styles.text}>
            {node.content.text}
          </p>
        )
      ) : (
        <img
          className={styles.image}
          src={node.content.src}
          alt={node.content.alt}
          draggable={false}
        />
      )}
    </div>
  );
}

/**
 * The editable text itself.
 *
 * UNCONTROLLED, AND IT HAS TO BE. Writing `textContent` back on every render —
 * the controlled-input reflex — destroys and rebuilds the text node under the
 * caret, so the caret jumps to the start after every keystroke. The DOM owns
 * the text while editing; the document is told what it says.
 *
 * That is why the initial text is written once, on mount, rather than from a
 * prop on each render.
 */
function TextEditor({
  text,
  onInput,
  onDone,
}: {
  text: string;
  onInput: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLParagraphElement>(null);

  /* RECONCILE WHEN THE VALUE CHANGES FROM OUTSIDE.
     The editor is uncontrolled so that the caret survives typing — the DOM
     owns the text and the document is told what it says. That is right until
     the document changes for a reason the editor did not cause: an undo, or
     one day another person editing the same canvas. Then the DOM holds text
     that no longer exists anywhere, ignores every further update, and only a
     reload reveals it. Observed exactly that: the screen said "EDITED HERE"
     while storage said "Spatial".

     The equality check is what keeps this from being a controlled input: the
     document's text and the DOM's already agree after every keystroke, so this
     writes nothing and the caret is never touched. It fires only when they
     genuinely diverge, which the editor cannot have caused. */
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (element.textContent === text) return;
    element.textContent = text;
  }, [text]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    element.textContent = text;
    element.focus();

    /* Select everything, so typing replaces — the same thing double-clicking a
       label does everywhere else. Deleting first is one keystroke; retyping a
       sentence you only wanted to replace is not. */
    const range = window.document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    /* Mount only. `text` changing later is this component's own doing. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <p
      ref={ref}
      className={styles.text}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Edit text"
      onInput={(event) => {
        onInput(event.currentTarget.textContent ?? "");
      }}
      onBlur={onDone}
      onKeyDown={(event) => {
        /* Escape leaves, keeping what was typed. There is no "cancel": undo is
           the way back, and it is one step for the whole edit. */
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        /* Enter commits; Shift+Enter makes a new line. A canvas label is
           usually one line, and a bare Enter inserting one is the more
           annoying default. */
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        /* Everything else belongs to the text — including ⌘Z, which must undo
           TYPING here rather than the canvas. `useHotkey` already declines to
           fire while a contenteditable has focus; this stops the keystroke
           reaching the canvas's own handlers too. */
        event.stopPropagation();
      }}
    />
  );
}
