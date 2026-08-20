import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { NodeId } from "../core/ids";
import { type Rect, intersects, rectFromCorners } from "../core/geometry";
import {
  IDENTITY,
  type Viewport,
  boundsOf,
  fitTo,
  panByScreenDelta,
  screenToWorld,
  zoomAtScreenPoint,
} from "../core/viewport";
import { bringToFront, moveNodesBy, removeNode, removeNodes, setNodeText } from "../core/mutate";
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

/** A pointer event's position inside the surface, in screen pixels. */
function pointInSurface(
  event: { clientX: number; clientY: number },
  surface: HTMLElement | null,
): { x: number; y: number } {
  if (surface === null) return { x: event.clientX, y: event.clientY };
  const rect = surface.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

type Gesture =
  | { readonly kind: "idle" }
  /** Dragging the background: the world moves under the pointer. */
  | { readonly kind: "pan" }
  /* Rubber-band selecting. `origin` is where the press landed, in world
     coordinates, and stays fixed while the other corner follows the pointer. */
  | { readonly kind: "marquee"; readonly origin: { x: number; y: number }; readonly additive: boolean }
  /** Dragging a node: only that node's geometry changes. */
  | { readonly kind: "move"; readonly ids: readonly NodeId[]; readonly key: string };

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
  /* A SET, NOT ONE ID. Everything below — dragging, deleting, the outline —
     treats one selected node as a selection of size one, so there is no
     "single" path to keep in step with a "multiple" path. */
  const [selected, setSelected] = useState<ReadonlySet<NodeId>>(() => new Set());

  /* The marquee, in WORLD coordinates. World rather than screen so that
     zooming or panning mid-drag cannot smear it: the rectangle is anchored to
     the canvas, not to the window. */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const marqueeRef = useRef<Rect | null>(null);
  marqueeRef.current = marquee;

  /* Read by the key handler, which is bound once and must not re-bind on every
     selection change. */
  const selectedRef = useRef<ReadonlySet<NodeId>>(selected);
  selectedRef.current = selected;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

    const node = docRef.current.nodes[id];
    if (node?.content.kind === "text" && node.content.text.trim() === "") {
      onChange(removeNode(docRef.current, id), editKey.current);
      setSelected((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [editing, onChange]);

  /* Both are read through refs by handlers that are memoised with no
     dependencies — a drag must not re-bind mid-gesture, and the imperative
     handle's identity must not change on every edit. */
  const onEditStartRef = useRef(onEditStart);
  onEditStartRef.current = onEditStart;

  const onEditDoneRef = useRef<() => void>(() => undefined);
  onEditDoneRef.current = onEditDone;

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const active = gesture.current;
      if (active.kind === "idle") return;

      if (active.kind === "pan") {
        setView((current) => panByScreenDelta(current, event.movementX, event.movementY));
        return;
      }

      if (active.kind === "marquee") {
        const corner = screenToWorld(
          pointInSurface(event, surface.current),
          viewRef.current,
        );
        setMarquee(rectFromCorners(active.origin, corner));
        return;
      }

      const { zoom } = viewRef.current;
      /* THE WHOLE SELECTION MOVES, not just the node under the cursor.
         Dragging one of several selected things and having the others stay
         behind is the kind of surprise that makes people stop trusting a
         selection. Keyed by the gesture, so every frame of the drag is one
         undo step. */
      onChange(
        moveNodesBy(
          doc,
          active.ids,
          event.movementX / zoom,
          event.movementY / zoom,
        ),
        active.key,
      );
    },
    [doc, onChange],
  );

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    /* Capture on the surface so a fast drag that outruns the cursor keeps
       delivering moves instead of dropping the gesture on the first frame
       the pointer leaves the element. */
    event.currentTarget.setPointerCapture(event.pointerId);

    /* SHIFT DRAGS A MARQUEE; a plain drag still pans.
       The other way round is what design tools do, and it would take panning
       away from a canvas that has had it since the first commit. Shift is
       already "add to what is selected" on a click, so it means the same thing
       on a drag. */
    if (event.shiftKey) {
      const origin = screenToWorld(
        pointInSurface(event, surface.current),
        viewRef.current,
      );
      gesture.current = { kind: "marquee", origin, additive: event.metaKey || event.ctrlKey };
      setMarquee({ x: origin.x, y: origin.y, width: 0, height: 0 });
      return;
    }

    gesture.current = { kind: "pan" };
    setSelected(new Set());
    /* Ends any edit properly, including removing a node that was never typed
       into. Clearing the state directly is what left empty nodes behind. */
    onEditDoneRef.current();
  }, []);

  const endGesture = useCallback((event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const active = gesture.current;
    gesture.current = { kind: "idle" };
    if (active.kind !== "marquee") return;

    const box = marqueeRef.current;
    setMarquee(null);
    if (box === null) return;

    /* MEASURED, NOT COMPUTED — the same reason `fit` measures. A text node's
       height is intrinsic and `core` never knows it, so what the marquee
       caught can only be decided against what was actually laid out.
       `offsetWidth/offsetHeight` are layout values, unaffected by the
       ancestor's scale, so they are already in world units. */
    const surfaceEl = surface.current;
    if (surfaceEl === null) return;

    const caught = new Set<NodeId>();
    for (const element of surfaceEl.querySelectorAll<HTMLElement>("[data-node-id]")) {
      const id = element.dataset.nodeId as NodeId | undefined;
      if (id === undefined) continue;
      const placement = docRef.current.nodes[id]?.presentations.desktop;
      if (placement === undefined) continue;

      if (
        intersects(box, {
          x: placement.x,
          y: placement.y,
          width: element.offsetWidth,
          height: element.offsetHeight,
        })
      ) {
        caught.add(id);
      }
    }

    setSelected((current) => (active.additive ? new Set([...current, ...caught]) : caught));
  }, []);

  const onNodePointerDown = useCallback(
    (event: React.PointerEvent, id: NodeId) => {
      /* The background handler would otherwise start a pan underneath this. */
      event.stopPropagation();
      surface.current?.setPointerCapture(event.pointerId);
      onEditDoneRef.current();

      const extend = event.shiftKey || event.metaKey || event.ctrlKey;

      /* WHAT THE PRESS SELECTS, decided before the drag begins so the gesture
         moves the right things:

           shift/⌘ on an unselected node   adds it
           shift/⌘ on a selected node      removes it, and drags nothing
           a plain press on a selected node keeps the whole selection, so
             dragging a group by one of its members moves the group
           a plain press on anything else  selects just that one */
      let next: Set<NodeId>;
      if (extend) {
        next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next = selected.has(id) ? new Set(selected) : new Set([id]);
      }
      setSelected(next);

      const ids = [...next];
      if (!next.has(id) || ids.length === 0) {
        /* Deselected by that press — there is nothing to drag. */
        gesture.current = { kind: "idle" };
        return;
      }

      gestureSeq.current += 1;
      gesture.current = {
        kind: "move",
        ids,
        key: `move:${String(gestureSeq.current)}`,
      };

      /* Raising only makes sense for one node; doing it for a group would
         reorder the group against itself for no reason anyone asked for. */
      if (ids.length === 1) onChange(bringToFront(doc, id), gesture.current.key);
    },
    [doc, onChange, selected],
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

  /* DELETE AND ESCAPE.
     On the window rather than the surface: the canvas is not focusable, so a
     key pressed after clicking a node would otherwise reach nothing. It
     declines while a text field or the editor has focus — Backspace there is
     deleting characters, and Escape is leaving the editor. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      if (event.key === "Escape") {
        setSelected(new Set());
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const ids = [...selectedRef.current];
      if (ids.length === 0) return;

      /* Backspace still scrolls back a page in some setups. */
      event.preventDefault();
      gestureSeq.current += 1;
      onChangeRef.current(
        removeNodes(docRef.current, ids),
        `delete:${String(gestureSeq.current)}`,
      );
      setSelected(new Set());
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
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
        style={
          {
            transform: `scale(${view.zoom}) translate(${-view.pan.x}px, ${-view.pan.y}px)`,
            /* Read by `.marquee`, whose border would otherwise thicken with
               the zoom like everything else inside this transform. */
            "--zoom": view.zoom,
          } as React.CSSProperties
        }
      >
        {/* Drawn INSIDE the world transform, so it stays anchored to the
            canvas if the view moves mid-drag rather than smearing across it. */}
        {marquee !== null && (
          <div
            className={styles.marquee}
            style={{
              transform: `translate(${String(marquee.x)}px, ${String(marquee.y)}px)`,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}

        {nodesInPaintOrder(doc).map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={selected.has(node.id)}
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
