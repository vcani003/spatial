import type { NodeId } from "./ids";
import { newRevisionId } from "./ids";
import type { SpatialDocument, SpatialNode } from "./schema";

/**
 * =============================================================================
 * THE MUTATION SEAM — one door, deliberately narrow
 * =============================================================================
 *
 * §15 requires every document mutation to pass through a command boundary so
 * that history, persistence, diagnostics and derived-layout invalidation can
 * all react to the same event. That boundary does not exist yet, and building
 * it before there is a second kind of mutation would be inventing an
 * abstraction from one example.
 *
 * What exists instead is this: ONE function that every change goes through.
 * It is not a command bus. It is the place a command bus goes when the PoC
 * has taught us what the commands actually are — and because nothing else in
 * the app is allowed to construct a new document, adding history later is a
 * change to this file rather than a hunt through the editor.
 *
 * IT RETURNS A NEW DOCUMENT AND MUTATES NOTHING. Undo/redo, round-trip
 * equality and eventual collaboration all assume a document is a value.
 * Starting mutable and converting later is the migration nobody finishes.
 *
 * `revisionId` is re-stamped on every change. §4.1's `basedOnRevision` and
 * the stale/conflicted machinery need a revision that actually moves, and a
 * revision that only updates on save is one that lies between saves.
 */

/**
 * Adds a node, on top of everything already there.
 *
 * On top because a thing you just made is a thing you are about to work with,
 * and finding it underneath something else is indistinguishable from it not
 * having been created. Paint order only — §21 keeps that apart from reading
 * order, and the mobile resolver will place this by geometry like everything
 * else.
 */
export function addNode(doc: SpatialDocument, node: SpatialNode): SpatialDocument {
  return {
    ...doc,
    revisionId: newRevisionId(),
    nodes: { ...doc.nodes, [node.id]: node },
    paintOrder: [...doc.paintOrder, node.id],
  };
}

/** Moves a node's desktop geometry by a delta in WORLD units. */
export function moveNodeBy(
  doc: SpatialDocument,
  id: NodeId,
  dx: number,
  dy: number,
): SpatialDocument {
  const node = doc.nodes[id];
  /* Unknown id is a no-op rather than a throw. Selection can outlive a node
     for a frame, and a canvas that crashes on a stale id is worse than one
     that ignores it — the dangling reference itself is a diagnostic's job
     (§17.2), not an exception's. */
  if (node === undefined) return doc;

  const { desktop } = node.presentations;

  return {
    ...doc,
    revisionId: newRevisionId(),
    nodes: {
      ...doc.nodes,
      [id]: {
        ...node,
        presentations: {
          ...node.presentations,
          desktop: { ...desktop, x: desktop.x + dx, y: desktop.y + dy },
        },
      },
    },
  };
}

/**
 * Raises a node to the top of the paint order.
 *
 * PAINT ORDER ONLY. §21 locks "Z-order is not authoritative semantic/reading
 * order", so bringing a node to the front on click must not, now or later,
 * quietly become a statement about what gets read first.
 */
export function bringToFront(doc: SpatialDocument, id: NodeId): SpatialDocument {
  if (doc.nodes[id] === undefined) return doc;
  if (doc.paintOrder[doc.paintOrder.length - 1] === id) return doc;

  return {
    ...doc,
    revisionId: newRevisionId(),
    paintOrder: [...doc.paintOrder.filter((other) => other !== id), id],
  };
}
