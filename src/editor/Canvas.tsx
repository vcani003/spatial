import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import type { NodeId } from "../core/ids";
import {
  IDENTITY,
  type Viewport,
  boundsOf,
  fitTo,
  panByScreenDelta,
  screenToWorld,
  zoomAtScreenPoint,
} from "../core/viewport";
import { bringToFront, moveNodeBy, removeNode, setNodeText } from "../core/mutate";
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
  | { readonly kind: "move"; readonly id: NodeId; readonly key: string };

/**
 * What the shell above can ask the canvas for.
 *
 * ONE METHOD, AND IT IS HERE RATHER THAN LIFTED because it needs two things
 * that live together in this component and nowhere else: the viewport, and the
 * surface element's actual size. Lifting the viewport to the shell would mean
 * the shell also measuring an element it does not own, to answer a question
 * only the canvas can answer.
 */
export interface CanvasHandle {
  /** The world point at the middle of what is currently on screen. */
  centre: () => { x: number; y: number };
  /** Frame everything on the canvas. Does nothing if there is nothing. */
  fit: () => void;
  /**
   * The world point under a VIEWPORT coordinate — `clientX`/`clientY` from a
   * pointer event. `null` when that point is outside the canvas, which is how
   * a drop lands on the toolbar and correctly creates nothing.
   */
  worldAt: (client: { x: number; y: number }) => { x: number; y: number } | null;
  /** Open a node's text editor. Used when a dropped text node needs typing. */
  beginEdit: (id: NodeId) => void;
}

export const Canvas = forwardRef<CanvasHandle, {
  doc: SpatialDocument;
  /** `key` labels a gesture — see `core/history.ts`. Frames sharing one
   *  collapse into a single undo step. */
  onChange: (next: SpatialDocument, key?: string) => void;
  saveState: SaveState;
}>(function Canvas({ doc, onChange, saveState }, handle) {
  const [view, setView] = useState<Viewport>(IDENTITY);

  /* The viewport, readable from an event handler without going through a state
     updater. Kept in step during render rather than in an effect, so a handler
     that fires before effects flush still sees the zoom the user is looking
     at. */
  const viewRef = useRef<Viewport>(view);
  viewRef.current = view;

  /* The document, readable from the imperative handle without making the
     handle's identity change on every edit. */
  const docRef = useRef(doc);
  docRef.current = doc;
  const [selected, setSelected] = useState<NodeId | null>(null);

  /* Which node is being typed into, if any. Editor state, not document state —
     §15 puts transient selection on this side of the line and this is the same
     kind of thing: undo must never reopen an editor. */
  const [editing, setEditing] = useState<NodeId | null>(null);

  /* One key for one editing session, so a hundred keystrokes are one undo step
     — the same trick a drag uses, for the same reason. */
  const editKey = useRef("");
  const gesture = useRef<Gesture>({ kind: "idle" });

  /* A GESTURE'S IDENTITY IS THE POINTER INTERACTION, NOT THE NODE, and this
     counter is what says so. Keying history on `move:<nodeId>` seemed right and
     is wrong in both directions: two separate drags of the SAME node share a
     key and collapse into one undo step, while the raise-to-front that starts a
     drag has no key at all and becomes a second step. One press, one number,
     one undoable step. */
  const gestureSeq = useRef(0);
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
      /* Keyed by the gesture, so every frame of one drag is a single undo
         step — and the next drag gets a new key and its own step. */
      onChange(
        moveNodeBy(doc, active.id, event.movementX / zoom, event.movementY / zoom),
        active.key,
      );
    },
    [doc, onChange],
  );

  const onEditStart = useCallback((id: NodeId) => {
    gestureSeq.current += 1;
    editKey.current = `text:${id}:${String(gestureSeq.current)}`;
    setEditing(id);
  }, []);

  const onEditText = useCallback(
    (text: string) => {
      const id = editing;
      if (id === null) return;
      onChange(setNodeText(docRef.current, id, text), editKey.current);
    },
    [editing, onChange],
  );

  /* `beginEdit` is called from the imperative handle, whose identity must not
     change on every edit — so it reads the current callback from a ref rather
     than closing over it. */
  const onEditStartRef = useRef(onEditStart);
  onEditStartRef.current = onEditStart;

  /* Read through a ref for the same reason: `onPointerDown` is memoised with
     no dependencies so a drag never re-binds mid-gesture, and it still needs
     the current exit path. */
  const onEditDoneRef = useRef<() => void>(() => undefined);

  /**
   * THE ONE WAY OUT OF EDITING, and it has to be the only one.
   *
   * This used to be reachable solely from the editor's `blur`. Pressing the
   * canvas background called `setEditing(null)` directly instead — which
   * closed the editor and skipped the cleanup below, so a text node dropped
   * and then abandoned stayed in the document as an empty box: unselectable,
   * invisible, and exactly the state §19 says must never accumulate.
   *
   * Blur is also not guaranteed to arrive. A dropped node's editor can end up
   * open with focus already elsewhere, and then no blur is ever fired. Any
   * path that ends an edit calls this.
   */
  const onEditDone = useCallback(() => {
    const id = editing;
    setEditing(null);
    if (id === null) return;

    /* AN EMPTY TEXT NODE IS REMOVED, and that is not tidiness. It renders as
       nothing, so it cannot be seen, selected or double-clicked — invisible
       state that only a diagnostic could ever find again, which is precisely
       what §19 says must not be able to accumulate. Deleting everything and
       clicking away is how a person says "never mind"; the node going with it
       is what they meant, and undo brings it back in one step because the
       removal shares the edit's key. */
    const node = docRef.current.nodes[id];
    if (node?.content.kind === "text" && node.content.text.trim() === "") {
      onChange(removeNode(docRef.current, id), editKey.current);
      setSelected((current) => (current === id ? null : current));
    }
  }, [editing, onChange]);

  onEditDoneRef.current = onEditDone;

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    /* Capture on the surface so a fast drag that outruns the cursor keeps
       delivering moves instead of dropping the gesture on the first frame
       the pointer leaves the element. */
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind: "pan" };
    setSelected(null);
    /* Ends any edit properly, including removing a node that was never typed
       into. Clearing the state directly is what left empty nodes behind. */
    onEditDoneRef.current();
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
      gestureSeq.current += 1;
      const key = `move:${id}:${String(gestureSeq.current)}`;
      gesture.current = { kind: "move", id, key };
      setSelected(id);
      /* THE RAISE CARRIES THE GESTURE'S KEY TOO. Pressing a node and dragging
         it is one action from the visitor's side; recording the raise
         separately would make every drag take two presses of undo, the first
         of which appears to do nothing. */
      onChange(bringToFront(doc, id), key);
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

  useImperativeHandle(
    handle,
    () => ({
      centre: () => {
        const element = surface.current;
        /* No element means nothing is on screen to be in the middle of, and
           the world origin is the least surprising answer. */
        if (element === null) return screenToWorld({ x: 0, y: 0 }, viewRef.current);
        const { width, height } = element.getBoundingClientRect();
        return screenToWorld({ x: width / 2, y: height / 2 }, viewRef.current);
      },

      worldAt: (client) => {
        const element = surface.current;
        if (element === null) return null;

        const rect = element.getBoundingClientRect();
        const x = client.x - rect.left;
        const y = client.y - rect.top;
        /* Outside the surface is a real answer, not an edge case: dropping on
           the toolbar or the preview should create nothing rather than
           silently placing a node off-screen. */
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

        return screenToWorld({ x, y }, viewRef.current);
      },

      beginEdit: (id) => {
        onEditStartRef.current(id);
      },

      fit: () => {
        const element = surface.current;
        if (element === null) return;

        /* MEASURED, NOT COMPUTED, and it has to be. A text node's height is
           intrinsic — `core` deliberately never knows it — so the bounding box
           can only come from what was actually laid out.

           `offsetWidth/offsetHeight` are LAYOUT values, untouched by the
           ancestor's `scale()`, so they are already in world units at any
           zoom. Reading `getBoundingClientRect()` here would return screen
           pixels and make the fit wrong everywhere except 100%. */
        const boxes = [...element.querySelectorAll<HTMLElement>("[data-node-id]")]
          .map((node) => {
            const placement = docRef.current.nodes[node.dataset.nodeId as NodeId]
              ?.presentations.desktop;
            if (placement === undefined) return null;
            return {
              x: placement.x,
              y: placement.y,
              width: node.offsetWidth,
              height: node.offsetHeight,
            };
          })
          .filter((box): box is NonNullable<typeof box> => box !== null);

        const bounds = boundsOf(boxes);
        if (bounds === null) return;

        const { width, height } = element.getBoundingClientRect();
        setView((current) => fitTo(bounds, { width, height }, current));
      },
    }),
    [],
  );

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
            editing={node.id === editing}
            onPointerDown={onNodePointerDown}
            onEditStart={onEditStart}
            onEditText={onEditText}
            onEditDone={onEditDone}
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
});
