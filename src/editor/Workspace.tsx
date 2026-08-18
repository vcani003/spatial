import { useCallback, useState } from "react";
import type { SpatialDocument } from "../core/schema";
import type { SaveState } from "../useDocument";
import { Canvas } from "./Canvas";
import { MobilePreview } from "./MobilePreview";
import { useHotkey } from "./useHotkey";
import styles from "./Workspace.module.css";

/**
 * THE EDITOR SHELL — canvas, and the panels beside it.
 *
 * It owns which panels are open and nothing else. That state is emphatically
 * NOT in the document: §15 draws the line at "viewport pan/zoom, hover, and
 * transient selection remain editor state rather than canonical document
 * history", and a panel being open is on the same side of it. Undo must never
 * close a panel.
 *
 * ── THE SHORTCUT, AND WHY NOT ⌘M ────────────────────────────────────────────
 *
 * ⌘M is the macOS window-minimize binding. Chrome and Safari consume it before
 * a page sees it, so a canvas bound to ⌘M would appear to do nothing on a Mac
 * — or worse, minimise the window and look like a crash.
 *
 * ⌘⇧M keeps the mnemonic and is unclaimed. ⌘B is reserved for the create bar
 * when it exists, which is VS Code's binding for the same idea; the one
 * conflict there is bold, and `useHotkey` already refuses to fire while text
 * is being edited, so that resolves itself the day text editing lands.
 */

const TOGGLE_MOBILE = { key: "m", mod: true, shift: true } as const;

export function Workspace({
  doc,
  onChange,
  saveState,
}: {
  doc: SpatialDocument;
  onChange: (next: SpatialDocument) => void;
  saveState: SaveState;
}) {
  const [mobileOpen, setMobileOpen] = useState(true);

  const toggleMobile = useCallback(() => {
    setMobileOpen((open) => !open);
  }, []);

  useHotkey(TOGGLE_MOBILE, toggleMobile);

  return (
    <div className={styles.workspace} data-mobile-open={mobileOpen ? "" : undefined}>
      <Canvas doc={doc} onChange={onChange} saveState={saveState} />
      <MobilePreview doc={doc} open={mobileOpen} onToggle={toggleMobile} />
    </div>
  );
}
