import type { DocumentId, NodeId, RevisionId } from "./ids";

/**
 * =============================================================================
 * SCHEMA — deliberately only what the canvas proof-of-concept needs
 * =============================================================================
 *
 * This is NOT §14's canonical model. It is the subset that a canvas which
 * renders, pans, zooms, selects and drags actually exercises, and it stops
 * there on purpose: a schema written ahead of the thing that uses it is a
 * schema whose assumptions have never been tested.
 *
 * What is deferred, and where it will slot in when it arrives:
 *
 *   semantics {role, semanticParentId, orderKey, altText, …}   on SpatialNode
 *   intent {priority, constraints[]}                            on SpatialNode
 *   presentations.mobileOverrides                               on SpatialNode
 *   visualGroups, assets, presentationIntent, semanticRootOrder on Document
 *
 * Every one of those is additive. None of them changes the meaning of a field
 * defined here, which is the property that makes deferring them safe.
 *
 * TWO THINGS ARE KEPT THAT THE POC DOES NOT STRICTLY NEED, because §19 lists
 * both as expensive-to-retrofit traps and both cost nothing today:
 *
 *   1. GEOMETRY LIVES UNDER `presentations.desktop`, not as bare x/y on the
 *      node. "Treating desktop x/y as document meaning" is trap #1, and the
 *      nesting is what makes the eventual mobile presentation a sibling
 *      rather than a retrofit. Flattening it now and un-flattening it later
 *      would touch every reader of every node.
 *
 *   2. `schemaVersion` AND `revisionId` EXIST FROM THE FIRST WRITE. A
 *      document saved without a version is a document no migration can ever
 *      safely interpret, and the first one will be saved long before the
 *      first migration is written.
 * ========================================================================== */

/** Bump when a change to the shapes below is not backward-compatible. */
export const SCHEMA_VERSION = 1;

export type NodeType = "text" | "image";

/**
 * Content is a discriminated union rather than a bag of optional fields, so
 * "an image with no src" is not a representable document.
 *
 * `alt` is required on images and may be the empty string — which is the
 * HTML convention for "decorative, skip me". §7 will later promote this to
 * `semantics.altText` alongside an explicit `decorative` flag; requiring it
 * here means no image can be authored without the question being answered.
 */
export type NodeContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly src: string; readonly alt: string };

/** Where a node sits on the desktop canvas, in world units. */
export interface DesktopPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Named `SpatialNode` rather than `Node`, and only because `Node` is a DOM
 * global. A domain type that shadows a lib type is a type whose errors read
 * as nonsense at the one moment you need them to be clear.
 */
export interface SpatialNode {
  readonly id: NodeId;
  readonly type: NodeType;
  readonly content: NodeContent;
  readonly presentations: {
    readonly desktop: DesktopPlacement;
  };
}

export interface SpatialDocument {
  readonly id: DocumentId;
  readonly schemaVersion: number;
  readonly revisionId: RevisionId;

  /** Keyed by id, never an array — see §14.1. Position is not identity. */
  readonly nodes: Readonly<Record<NodeId, SpatialNode>>;

  /**
   * PAINT ORDER, AND THAT IS ALL IT IS. Last entry paints on top.
   *
   * The name is defensive. §21 locks "Z-order is not authoritative
   * semantic/reading order", and the fastest way to break that lock is to
   * have one array called `order` that the renderer reads for stacking and
   * something later reads for reading sequence. Reading order arrives as its
   * own field (`semanticRootOrder`) and the two are free to disagree,
   * because on a canvas they routinely will.
   */
  readonly paintOrder: readonly NodeId[];
}

/** Every node, in paint order, skipping ids with no node behind them. */
export function nodesInPaintOrder(doc: SpatialDocument): readonly SpatialNode[] {
  const out: SpatialNode[] = [];
  for (const id of doc.paintOrder) {
    const node = doc.nodes[id];
    /* A dangling id is exactly the invalid reference §17.2 wants a
       diagnostic for. Rendering skips it rather than throwing, so a broken
       reference cannot take the whole canvas down before the diagnostics
       engine exists to report it. */
    if (node !== undefined) out.push(node);
  }
  return out;
}
