import { useEffect, useMemo, useRef, useState } from "react";
import { resolveMobile } from "../core/mobile";
import type { SpatialDocument } from "../core/schema";
import { modLabel } from "./useHotkey";
import styles from "./MobilePreview.module.css";

/**
 * =============================================================================
 * THE MOBILE PREVIEW — §8, a previewer and not a second editor
 * =============================================================================
 *
 * "The initial mobile surface is a previewer, not a second full editor. It
 *  should be visible beside or near the desktop canvas when space permits and
 *  update as desktop content changes."
 *
 * Both halves are load-bearing and this component is deliberately built to
 * make the second one free:
 *
 * IT DERIVES, IT DOES NOT COPY. There is no mobile document, no mirrored
 * state, and nothing to synchronise — `resolveMobile` is a pure function of
 * the same `SpatialDocument` the canvas renders, so a desktop edit updates
 * this on the very same render. §4 spends a whole section on why a copied
 * mobile canvas becomes a merge problem; the way to never have that problem is
 * to never have a second copy, and this is what that looks like in practice.
 *
 * IT IS READ-ONLY, and that is the honest state of it today. Nothing here can
 * be dragged, selected or reordered, because an author override that could be
 * expressed but not PERSISTED — with provenance, staleness and conflict
 * states, per §4.1 — would be a promise the data model cannot keep yet. The
 * responsive inspector of §8.1 is the next piece, and it lands on top of this
 * rather than replacing it.
 *
 * WHAT IT ALREADY DEMONSTRATES, which is the reason to build it now rather
 * than after the overrides: the fixture's photograph and its caption come out
 * separated, because geometry alone cannot know they are one thing. That is
 * §16.1's worked example, visible on screen, arguing for semantic grouping
 * before a line of it is written.
 */

/**
 * The width being previewed, in CSS pixels. Roughly a phone.
 *
 * THIS IS A LOGICAL SIZE AND IT NEVER CHANGES. The preview is only worth
 * having if it reflows at a real phone width — the moment the device box
 * shrinks to fit its panel, the text rewraps and you are previewing a 280px
 * viewport nobody has. So the box stays 390 and is SCALED to fit instead.
 */
const VIEWPORT_WIDTH = 390;

/**
 * How much the device may be scaled visually.
 *
 * Never above 1. Magnifying the preview past 1:1 makes it the loudest thing on
 * screen and tells you nothing a phone would actually show — and under browser
 * zoom, where the viewport shrinks in CSS pixels, an uncapped scale is exactly
 * how the panel ends up dominating the workspace.
 *
 * The floor stops it collapsing into an unreadable thumbnail on a narrow
 * window; below that the panel is better collapsed with the shortcut.
 */
const MAX_SCALE = 1;
const MIN_SCALE = 0.5;

export function MobilePreview({
  doc,
  open,
  onToggle,
}: {
  doc: SpatialDocument;
  open: boolean;
  onToggle: () => void;
}) {
  /* Recomputed only when the document actually changes — panning and zooming
     the canvas must not re-run the resolver, and they change `Canvas` state
     rather than `doc`. */
  const resolved = useMemo(() => resolveMobile(doc), [doc]);

  /* Fit the device to whatever width the panel actually got.
     A ResizeObserver rather than a media query, because what matters is the
     PANEL's width — which changes with the window, with browser zoom, and one
     day with a drag handle. A breakpoint would have to guess at all three. */
  const fitRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(MAX_SCALE);

  useEffect(() => {
    const element = fitRef.current;
    if (element === null) return;

    const observer = new ResizeObserver(([entry]) => {
      const available = entry?.contentRect.width ?? 0;
      if (available <= 0) return;
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / VIEWPORT_WIDTH)));
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [open]);

  return (
    <aside className={styles.panel} data-open={open ? "" : undefined}>
      <header className={styles.bar}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls="mobile-preview-body"
          onClick={onToggle}
        >
          Mobile
          {/* The shortcut, shown rather than hidden in a menu that does not
              exist yet. `aria-hidden` because a screen reader user is told
              about the control by the button itself, and "⌘ ⇧ M" read aloud
              as characters is noise. */}
          <span className={styles.chord} aria-hidden="true">
            {modLabel()}⇧M
          </span>
        </button>
      </header>

      <div id="mobile-preview-body" className={styles.body} hidden={!open}>
        {/* The measured box, and the device inside it.

            `zoom` RATHER THAN `transform: scale()`, and the difference is the
            whole reason this is simple: a transform is a paint-time effect
            that does not change layout, so a scaled-down device would still
            reserve its full unscaled height and leave a tall column of empty
            space beneath itself. `zoom` scales the layout, so the box occupies
            exactly what it appears to occupy — no measured height to correct,
            and no second observer to keep in sync. */}
        <div className={styles.fit} ref={fitRef}>
          <div
            className={styles.device}
            style={{ inlineSize: VIEWPORT_WIDTH, zoom: scale }}
          >
          {resolved.blocks.map((block) => {
            const node = doc.nodes[block.nodeId];
            if (node === undefined) return null;

            return (
              <div className={styles.block} key={block.nodeId}>
                {node.content.kind === "text" ? (
                  <p className={styles.text}>{node.content.text}</p>
                ) : (
                  /* Full column width, intrinsic height. The desktop's
                     authored box does not survive the trip — that IS the
                     reflow, and pretending otherwise would make this a
                     scaled screenshot rather than a responsive preview. */
                  <img className={styles.image} src={node.content.src} alt={node.content.alt} />
                )}
              </div>
            );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
