import { useCallback, useRef, useState } from "react";
import { addNode } from "../core/mutate";
import type { SpatialDocument, SpatialNode } from "../core/schema";
import type { SaveState } from "../useDocument";
import { Canvas, type CanvasHandle } from "./Canvas";
import { Palette, type PaletteDrop } from "./Palette";
import { MobilePreview } from "./MobilePreview";
import { useHotkey, modLabel } from "./useHotkey";
import styles from "./Workspace.module.css";

/**
 * THE EDITOR SHELL — a toolbar, and what it opens.
 *
 * It owns which panels are open and nothing else. That state is emphatically
 * NOT in the document: §15 draws the line at "viewport pan/zoom, hover, and
 * transient selection remain editor state rather than canonical document
 * history", and a panel being open is on the same side of it. Undo must never
 * close a panel.
 *
 * ── CLOSED MEANS GONE ───────────────────────────────────────────────────────
 *
 * The mobile preview used to keep a column when collapsed — its own bar, 103px
 * of it, permanently beside the canvas. Now the toggle lives in the toolbar
 * along the top, so collapsing the preview removes the entire right-hand side
 * and the canvas gets all of it. A panel that is closed should cost nothing,
 * and the only thing that has to remain is the way back in.
 *
 * That is also what makes room for the create bar: one toolbar, one place
 * every panel is opened from, rather than each panel carrying its own strip.
 *
 * ── THE SHORTCUTS ───────────────────────────────────────────────────────────
 *
 *   ⌘⇧M   the mobile preview. NOT ⌘M, which is the macOS window-minimise
 *         binding — Chrome and Safari consume it before a page sees it, so a
 *         canvas bound to it would look dead or minimise the window.
 *   ⌘B    the create bar. VS Code's binding for the same idea. Its one
 *         conflict is bold, and `useHotkey` refuses to fire while text is
 *         being edited, so that resolves itself when text editing lands.
 */

const TOGGLE_MOBILE = { key: "m", mod: true, shift: true } as const;
const TOGGLE_CREATE = { key: "b", mod: true } as const;

/* ⌘Z and ⌘⇧Z — the platform's own bindings, and `useHotkey` already refuses to
   fire while a text field has focus, so undo inside an input still means undo
   the TEXT rather than the canvas. */
const UNDO = { key: "z", mod: true } as const;
const REDO = { key: "z", mod: true, shift: true } as const;

/* Shift+1 — Figma's zoom-to-fit, matched by physical key because shift turns
   "1" into "!" on a US layout and something else elsewhere. */
const FIT = { key: "Digit1", byCode: true, shift: true } as const;

export function Workspace({
  doc,
  onChange,
  saveState,
  undo,
  redo,
  canUndo,
  canRedo,
}: {
  doc: SpatialDocument;
  onChange: (next: SpatialDocument, key?: string) => void;
  saveState: SaveState;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  /* How many nodes the canvas has selected. The shell keeps it only so the
     toolbar can offer a visible way to delete them — selection itself belongs
     to the canvas. */
  const [selectedCount, setSelectedCount] = useState(0);
  const canvas = useRef<CanvasHandle>(null);

  const toggleMobile = useCallback(() => {
    setMobileOpen((open) => !open);
  }, []);

  const toggleCreate = useCallback(() => {
    setCreateOpen((open) => !open);
  }, []);

  /* An infinite canvas is very easy to get lost on: pan far enough and there is
     nothing on screen and no edge to tell you which way back. This is the way
     back. */
  const fit = useCallback(() => {
    canvas.current?.fit();
  }, []);

  useHotkey(TOGGLE_MOBILE, toggleMobile);
  useHotkey(TOGGLE_CREATE, toggleCreate);
  useHotkey(UNDO, undo);
  useHotkey(REDO, redo);
  useHotkey(FIT, fit);

  /* Everything a palette drop needs: a place, and a node built around it.
     `core` builds nodes around a centre; only the canvas knows where a screen
     point lands in the world, and only it can open an editor. */
  const add = useCallback(
    (
      make: (centre: { x: number; y: number }) => SpatialNode,
      centre: { x: number; y: number },
      thenEdit: boolean,
    ) => {
      const node = make(centre);
      onChange(addNode(doc, node));
      /* After the commit, so the node exists by the time the editor opens for
         it. An empty text node that is never typed into removes itself when
         the editor closes — see `onEditDone` — which is what makes dropping
         one and changing your mind cost nothing. */
      if (thenEdit) canvas.current?.beginEdit(node.id);
    },
    [doc, onChange],
  );

  const onDrop = useCallback(
    (drop: PaletteDrop) => {
      const centre = canvas.current?.worldAt(drop.client);
      /* Dropped outside the canvas — on the toolbar, the preview, or off the
         window. Creating nothing is the honest answer; placing it somewhere
         the person did not point is worse than not placing it. */
      if (centre === undefined || centre === null) return;
      add(drop.make, centre, drop.thenEdit);
    },
    [add],
  );

  const onPlaceAtCentre = useCallback(
    (drop: Omit<PaletteDrop, "client">) => {
      add(drop.make, canvas.current?.centre() ?? { x: 0, y: 0 }, drop.thenEdit);
    },
    [add],
  );

  return (
    <div className={styles.workspace}>
      <header className={styles.toolbar}>
        <button
          type="button"
          className={styles.action}
          disabled={!canUndo}
          onClick={undo}
        >
          Undo
          <span className={styles.chord} aria-hidden="true">{`${modLabel()}Z`}</span>
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={!canRedo}
          onClick={redo}
        >
          Redo
          <span className={styles.chord} aria-hidden="true">{`${modLabel()}⇧Z`}</span>
        </button>

        {/* DELETE IS A BUTTON, not only a key. It was a key alone, which meant
            the feature existed and nothing on screen said so — the reasonable
            conclusion from looking at the toolbar was that you could not
            delete anything. Disabled rather than hidden, so it is visible
            before there is a selection and teaches that selecting enables it. */}
        <button
          type="button"
          className={styles.action}
          disabled={selectedCount === 0}
          onClick={() => {
            canvas.current?.deleteSelected();
          }}
        >
          {selectedCount > 1 ? `Delete ${String(selectedCount)}` : "Delete"}
          <span className={styles.chord} aria-hidden="true">⌫</span>
        </button>

        <span className={styles.divider} aria-hidden="true" />

        <button type="button" className={styles.action} onClick={fit}>
          Fit
          <span className={styles.chord} aria-hidden="true">⇧1</span>
        </button>

        <span className={styles.divider} aria-hidden="true" />

        <ToolbarToggle
          label="Add"
          chord={`${modLabel()}B`}
          open={createOpen}
          controls="create-bar"
          onClick={toggleCreate}
        />
        <ToolbarToggle
          label="Mobile"
          chord={`${modLabel()}⇧M`}
          open={mobileOpen}
          controls="mobile-preview-body"
          onClick={toggleMobile}
        />
      </header>

      {createOpen && <Palette onDrop={onDrop} onPlaceAtCentre={onPlaceAtCentre} />}

      <div className={styles.stage} data-mobile-open={mobileOpen ? "" : undefined}>
        <Canvas
          ref={canvas}
          doc={doc}
          onChange={onChange}
          saveState={saveState}
          onSelectionChange={setSelectedCount}
        />
        {/* Not rendered at all when closed. `hidden` would have left an empty
            column; this leaves nothing. */}
        {mobileOpen && <MobilePreview doc={doc} />}
      </div>
    </div>
  );
}

function ToolbarToggle({
  label,
  chord,
  open,
  controls,
  onClick,
}: {
  label: string;
  chord: string;
  open: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      data-open={open ? "" : undefined}
      aria-expanded={open}
      /* Only points at the panel while it exists. `aria-controls` naming an
         element that is not in the document is a broken reference, not a
         hint. */
      aria-controls={open ? controls : undefined}
      onClick={onClick}
    >
      {label}
      <span className={styles.chord} aria-hidden="true">
        {chord}
      </span>
    </button>
  );
}
