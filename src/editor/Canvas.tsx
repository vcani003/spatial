import { useCallback, useRef, useState } from "react";
import type { NodeId } from "../core/ids";
import {
  IDENTITY,
  type Viewport,
  panByScreenDelta,
  screenToWorld,
  zoomAtScreenPoint,
} from "../core/viewport";
import { bringToFront, moveNodeBy } from "../core/mutate";
import { type SpatialDocument, nodesInPaintOrder } from "../core/schema";
import type { SaveState } from "../useDocument";
import { NodeView } from "./NodeView";
import styles from "./Canvas.module.css";

/**
 * =============================================================================
 * THE CANVAS — a DOM renderer, on purpose
 * =============================================================================
 *
 * DOM AND NOT `<canvas>`, AND THE SPEC MADE THIS CHOICE ALREADY. §7's
 * accessibility constraint says that if a rendering approach prevents the
 * content from being a coherent keyboard- and assistive-technology-accessible
 * structure, THE RENDERING APPROACH MUST BE RECONSIDERED — not accepted.
 * A 2D canvas draws pixels and has no accessible structure at all; every
 * project that starts there ends up maintaining a parallel invisible DOM to
 * get it back. Real elements are the cheap way to satisfy a constraint that
 * is not negotiable, and the cost — performance at very large node counts —
 * is one this project can measure later and answer with virtualization.
 *
 * ONE TRANSFORM ON A WRAPPER, NOT PER NODE. The whole world is a single
 * `translate/scale`, so pan and zoom stay one compositor operation regardless
 * of node count, and each node positions itself in world units and never
 * thinks about the viewport at all.
 *
 * WHAT THIS COMPONENT OWNS: viewport, pointer gestures, selection. All three
 * are editor state, and §15 is explicit that "viewport pan/zoom, hover, and
 * transient selection remain editor state rather than canonical document
 * history". None of them is in the document, and none of them is persisted.
 * ========================================================================== */

type Gesture =
  | { readonly kind: "idle" }
  /** Dragging the background: the world moves under the pointer. */
  | { readonly kind: "pan" }
  /** Dragging a node: only that node's geometry changes. */
  | { readonly kind: "move"; readonly id: NodeId };

export function Canvas({
  doc,
  onChange,
  saveState,
}: {
  doc: SpatialDocument;
  onChange: (next: SpatialDocument) => void;
  saveState: SaveState;
}) {
  const [view, setView] = useState<Viewport>(IDENTITY);

  /* The viewport, readable from an event handler without going through a state
     updater. Kept in step during render rather than in an effect, so a handler
     that fires before effects flush still sees the zoom the user is looking
     at. */
  const viewRef = useRef<Viewport>(view);
  viewRef.current = view;
  const [selected, setSelected] = useState<NodeId | null>(null);
  const gesture = useRef<Gesture>({ kind: "idle" });
  const surface = useRef<HTMLDivElement>(null);

  /* Pointer position is read from movementX/Y rather than tracked by hand.
     The browser already computes the delta, and it stays correct across the
     edges of the window in a way a remembered "last position" does not. */
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const active = gesture.current;
      if (active.kind === "idle") return;

      if (active.kind === "pan") {
        setView((current) => panByScreenDelta(current, event.movementX, event.movementY));
        return;
      }

      /* THE ZOOM COMES FROM A REF, NOT FROM A STATE UPDATER.
         This used to read the current zoom by calling `setView` and doing the
         work inside the updater — which put a side effect in React's render
         phase, and dropped frames: five pointer moves of +10 landed a node at
         +40. React is free to call an updater more than once, or to defer it,
         and neither is compatible with "and also mutate the document while
         you are in there".

         Divide by zoom: a node must stay under the pointer at every zoom
         level. Same arithmetic `panByScreenDelta` does, same bug if forgotten. */
      const { zoom } = viewRef.current;
      onChange(moveNodeBy(doc, active.id, event.movementX / zoom, event.movementY / zoom));
    },
    [doc, onChange],
  );

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    /* Capture on the surface so a fast drag that outruns the cursor keeps
       delivering moves instead of dropping the gesture on the first frame
       the pointer leaves the element. */
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind: "pan" };
    setSelected(null);
  }, []);

  const endGesture = useCallback((event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gesture.current = { kind: "idle" };
  }, []);

  const onNodePointerDown = useCallback(
    (event: React.PointerEvent, id: NodeId) => {
      /* The background handler would otherwise start a pan underneath this. */
      event.stopPropagation();
      surface.current?.setPointerCapture(event.pointerId);
      gesture.current = { kind: "move", id };
      setSelected(id);
      onChange(bringToFront(doc, id));
    },
    [doc, onChange],
  );

  const onWheel = useCallback((event: React.WheelEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    /* ctrl/⌘ + wheel is the pinch gesture a trackpad reports; a plain wheel
       is a two-finger scroll and should pan. Treating both as zoom is the
       thing that makes a canvas feel hostile on a laptop. */
    if (event.ctrlKey || event.metaKey) {
      setView((current) => zoomAtScreenPoint(current, anchor, Math.exp(-event.deltaY * 0.002)));
      return;
    }
    setView((current) => panByScreenDelta(current, -event.deltaX, -event.deltaY));
  }, []);

  const origin = screenToWorld({ x: 0, y: 0 }, view);

  return (
    <div
      ref={surface}
      className={styles.surface}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onWheel={onWheel}
      /* The grid is painted here, in screen space, so it does not have to be
         a node and cannot be selected, dragged or persisted. Its size tracks
         zoom and its offset tracks pan, which is what makes the world feel
         like it has a floor. */
      style={{
        backgroundSize: `${32 * view.zoom}px ${32 * view.zoom}px`,
        backgroundPosition: `${-origin.x * view.zoom}px ${-origin.y * view.zoom}px`,
      }}
    >
      <div
        className={styles.world}
        style={{ transform: `scale(${view.zoom}) translate(${-view.pan.x}px, ${-view.pan.y}px)` }}
      >
        {nodesInPaintOrder(doc).map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={node.id === selected}
            onPointerDown={onNodePointerDown}
          />
        ))}
      </div>

      {/* Zoom, and whether the work is safe. The save state is only ever
          SHOWN when it is not "saved" — a canvas that constantly reassures you
          it saved is a canvas you start reading instead of using, and the
          only genuinely useful state here is the one where something went
          wrong. */}
      <p className={styles.readout}>
        {Math.round(view.zoom * 100)}%
        {saveState === "error" && <span className={styles.trouble}> · not saving</span>}
      </p>
    </div>
  );
}
