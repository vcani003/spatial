import { useCallback, useEffect, useRef, useState } from "react";
import { createImageNode, createTextNode, isSafeImageUrl } from "../core/create";
import type { SpatialNode } from "../core/schema";
import styles from "./Palette.module.css";

/**
 * =============================================================================
 * THE PALETTE — drag a thing onto the canvas
 * =============================================================================
 *
 * It replaces the create bar, which was a row of text fields: you typed the
 * words first and the node appeared in the middle of the screen whether or not
 * that is where you wanted it. On a canvas, WHERE is half the decision, and a
 * form cannot express it.
 *
 * Now you pick a kind up and put it down where it goes. That is the gesture
 * every canvas tool uses, and it is worth matching rather than inventing.
 *
 * ── POINTER EVENTS, NOT HTML5 DRAG AND DROP ─────────────────────────────────
 *
 * The native API would give a drag image and `dragover`/`drop` for free, and
 * cost more than it gives here: its drag image cannot be styled to match the
 * canvas, `dragover` fires at a rate the browser chooses rather than per
 * frame, and the whole thing behaves differently across browsers in ways that
 * are tedious to reconcile. The canvas is already a pointer-driven surface —
 * the drag is one more gesture on the same model, with pointer capture keeping
 * it alive if the cursor outruns it.
 *
 * ── IT ALSO WORKS WITHOUT A DRAG ────────────────────────────────────────────
 *
 * Every tile is a real `<button>`. Pressing it — by click or by keyboard —
 * places the thing at the middle of the view. A tool reachable only by
 * dragging is a tool nobody using a keyboard can reach, and "drag onto the
 * canvas" is not an instruction a screen reader can act on.
 */

export type PaletteKind = "text" | "image";

export interface PaletteDrop {
  /** Where the pointer let go, in viewport coordinates. */
  readonly client: { readonly x: number; readonly y: number };
  readonly make: (centre: { x: number; y: number }) => SpatialNode;
  /** Text nodes arrive empty and open their editor; images do not. */
  readonly thenEdit: boolean;
}

export function Palette({
  onDrop,
  onPlaceAtCentre,
}: {
  onDrop: (drop: PaletteDrop) => void;
  onPlaceAtCentre: (drop: Omit<PaletteDrop, "client">) => void;
}) {
  const [src, setSrc] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState<PaletteKind | null>(null);
  const ghost = useRef<HTMLDivElement>(null);

  /** What a tile builds, and whether it wants the editor afterwards. */
  const recipe = useCallback(
    (kind: PaletteKind): Omit<PaletteDrop, "client"> | null => {
      if (kind === "text") {
        /* EMPTY, AND THAT IS SAFE BECAUSE OF THE EDITOR'S OWN RULE: a text
           node whose content is erased is removed when the editor closes. So
           dropping one and walking away leaves nothing behind, and there is no
           need to invent placeholder words nobody asked for. */
        return { make: (centre) => createTextNode("", centre), thenEdit: true };
      }

      if (!isSafeImageUrl(src)) {
        setProblem("Needs a full http:// or https:// address.");
        return null;
      }
      setProblem(null);
      return { make: (centre) => createImageNode(src, "", centre), thenEdit: false };
    },
    [src],
  );

  /* The ghost follows the pointer directly rather than through React state:
     this runs on every pointer move, and a re-render per move would put the
     whole editor's render on the drag path. */
  useEffect(() => {
    if (dragging === null) return;

    const move = (event: PointerEvent): void => {
      const node = ghost.current;
      if (node === null) return;
      node.style.transform = `translate(${String(event.clientX)}px, ${String(event.clientY)}px)`;
    };

    window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointermove", move);
    };
  }, [dragging]);

  const startDrag = (kind: PaletteKind) => (event: React.PointerEvent) => {
    const built = recipe(kind);
    if (built === null) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(kind);

    const end = (up: PointerEvent): void => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      setDragging(null);
      onDrop({ ...built, client: { x: up.clientX, y: up.clientY } });
    };
    const cancel = (): void => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      setDragging(null);
    };

    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  };

  const place = (kind: PaletteKind) => () => {
    const built = recipe(kind);
    if (built !== null) onPlaceAtCentre(built);
  };

  return (
    <div className={styles.palette}>
      <button
        type="button"
        className={styles.tile}
        data-dragging={dragging === "text" ? "" : undefined}
        onPointerDown={startDrag("text")}
        onClick={place("text")}
      >
        <span className={styles.glyph} aria-hidden="true">
          T
        </span>
        Text
      </button>

      <div className={styles.imageTool}>
        <button
          type="button"
          className={styles.tile}
          data-dragging={dragging === "image" ? "" : undefined}
          disabled={src.trim() === ""}
          onPointerDown={startDrag("image")}
          onClick={place("image")}
        >
          <span className={styles.glyph} aria-hidden="true">
            ▢
          </span>
          Image
        </button>

        <input
          className={styles.url}
          type="url"
          value={src}
          placeholder="https://…"
          aria-label="Image address"
          aria-invalid={problem === null ? undefined : true}
          onChange={(event) => {
            setSrc(event.target.value);
            setProblem(null);
          }}
        />
      </div>

      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      <p className={styles.hint}>Drag onto the canvas, or press to place it in view.</p>

      {/* Follows the cursor while dragging. `pointer-events: none` so it never
          becomes the drop target, and `aria-hidden` because it is the cursor's
          shadow rather than content. */}
      {dragging !== null && (
        <div className={styles.ghost} ref={ghost} aria-hidden="true">
          {dragging === "text" ? "T" : "▢"}
        </div>
      )}
    </div>
  );
}
