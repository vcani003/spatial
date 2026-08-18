import { useCallback, useRef, useState } from "react";
import { addNode } from "../core/mutate";
import type { SpatialDocument, SpatialNode } from "../core/schema";
import type { SaveState } from "../useDocument";
import { Canvas, type CanvasHandle } from "./Canvas";
import { CreateBar } from "./CreateBar";
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

export function Workspace({
  doc,
  onChange,
  saveState,
}: {
  doc: SpatialDocument;
  onChange: (next: SpatialDocument) => void;
  saveState: SaveState;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const canvas = useRef<CanvasHandle>(null);

  const toggleMobile = useCallback(() => {
    setMobileOpen((open) => !open);
  }, []);

  const toggleCreate = useCallback(() => {
    setCreateOpen((open) => !open);
  }, []);

  useHotkey(TOGGLE_MOBILE, toggleMobile);
  useHotkey(TOGGLE_CREATE, toggleCreate);

  /* New nodes are built by `core` around a centre point, and the only thing
     that knows where "the middle of what you are looking at" is, is the canvas.
     So the node arrives here positioned at the origin and is re-centred before
     it is added — the alternative is threading the viewport up through the
     shell and back down, to answer a question the canvas already knows. */
  const create = useCallback(
    (node: SpatialNode) => {
      const centre = canvas.current?.centre() ?? { x: 0, y: 0 };
      const { desktop } = node.presentations;
      onChange(
        addNode(doc, {
          ...node,
          presentations: {
            desktop: {
              ...desktop,
              x: centre.x - desktop.width / 2,
              y: centre.y - (desktop.height ?? 0) / 2,
            },
          },
        }),
      );
    },
    [doc, onChange],
  );

  return (
    <div className={styles.workspace}>
      <header className={styles.toolbar}>
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

      {createOpen && <CreateBar onCreate={create} />}

      <div className={styles.stage} data-mobile-open={mobileOpen ? "" : undefined}>
        <Canvas ref={canvas} doc={doc} onChange={onChange} saveState={saveState} />
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
