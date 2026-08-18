import type { NodeId } from "./ids";
import type { SpatialDocument, SpatialNode } from "./schema";

/**
 * =============================================================================
 * THE MOBILE BASE RESOLVER — §18 step 1, deterministic and generated
 * =============================================================================
 *
 * §4's whole architecture rests on this being GENERATED rather than authored:
 *
 *   ResolvedMobile = GeneratedBase(document) + AuthorOverrides → validation
 *
 * This is `GeneratedBase`, and nothing else. There are no overrides yet, no
 * provenance and no conflict states — but the shape below is the one they
 * layer onto, which is why this is a pure function of the document rather than
 * something the preview component works out for itself. A resolver that lives
 * in a component cannot be tested without a browser and cannot be reused by
 * the publisher.
 *
 * ── HOW THE ORDER IS SEEDED ─────────────────────────────────────────────────
 *
 * From GEOMETRY, which §7 ranks as the fourth-strongest evidence — below
 * author-confirmed semantics, node roles, and container relationships. All
 * three of those outrank it and none of them exists yet, so geometry is
 * currently the only evidence there is. When `semantics.orderKey` arrives it
 * takes precedence and this becomes the fallback, exactly as §7 describes.
 *
 * NOT A NAÏVE SORT BY Y. Two things sitting side by side have different `y`
 * values by a few pixels, and sorting on `y` alone interleaves the columns of
 * a two-column composition into nonsense. So nodes are swept into BANDS —
 * runs whose tops are within a tolerance of each other — and ordered left to
 * right within a band, top to bottom between them. That is what "reading
 * order" means for a page that was laid out spatially.
 *
 * A BAND ALSO REQUIRES ITS MEMBERS NOT TO OVERLAP HORIZONTALLY, and that
 * second condition is doing more work than it looks. Without it, two nodes
 * STACKED a few pixels apart — a heading directly above its paragraph, say —
 * satisfy the tolerance, land in one band, and get ordered left to right: the
 * lower one reads first because it happens to start a few pixels further
 * left. Nothing about that is a row. Items sharing horizontal space are
 * arranged vertically by definition, so overlap forces a new band and the
 * higher one reads first.
 *
 * Widths are authored and always present, so this costs nothing — unlike
 * heights, which are intrinsic and unavailable here.
 *
 * ── WHAT THIS DELIBERATELY GETS WRONG, AND WHY THAT IS USEFUL ───────────────
 *
 * On the current fixture it separates the photograph from the caption written
 * beneath it, because 216px of vertical distance is more than the tolerance
 * and a text node sits between them in reading order.
 *
 * That is not a bug to be tuned away with a bigger tolerance. It is precisely
 * the failure §16.1 uses as its worked example — "the caption associated with
 * this image is separated from it after reflow" — and it is the argument for
 * semantic grouping existing at all. Geometry cannot know that those two
 * things are one thing. Only a `keepWith` constraint or a confirmed semantic
 * group can, and the resolver should demonstrate the need rather than fake the
 * result.
 *
 * ── HEIGHTS ARE NOT AVAILABLE HERE, ON PURPOSE ──────────────────────────────
 *
 * A text node's height is intrinsic — the renderer is the only thing that
 * knows how tall the words came out. So the banding uses TOP EDGES only, and
 * never asks how tall anything is. Reaching for measured heights would drag a
 * DOM into `core` and break the property that makes this testable in Node.
 * ========================================================================== */

/**
 * How far apart two tops may be and still count as the same row, in world
 * units.
 *
 * 32 is one grid square. Small enough that a heading and the paragraph under
 * it stay in reading order rather than collapsing into one row; large enough
 * that two things a person clearly placed side by side are not split by a few
 * pixels of eyeballed misalignment. It is a heuristic, it is the only tuned
 * number in this file, and when semantic order exists it stops mattering.
 */
export const BAND_TOLERANCE = 32;

/** One node's place in the generated mobile flow. */
export interface MobileBlock {
  readonly nodeId: NodeId;
  /** Zero-based position in the flow. */
  readonly order: number;
  /**
   * Where this value came from. Always `"auto"` today — §4.1's provenance,
   * present from the first implementation as that section requires, so the
   * day an override lands there is a field for it to disagree with rather
   * than a schema change.
   */
  readonly source: "auto";
}

export interface ResolvedMobile {
  readonly blocks: readonly MobileBlock[];
}

/**
 * Reading order seeded from geometry: top-to-bottom by band, left-to-right
 * within a band.
 *
 * Deterministic for a given document — equal tops and equal lefts fall back to
 * paint order, so two nodes stacked exactly on top of each other still produce
 * a stable answer rather than one that depends on object key iteration.
 */
export function seedReadingOrder(doc: SpatialDocument): readonly NodeId[] {
  const placed = doc.paintOrder
    .map((id, paintIndex) => {
      const node = doc.nodes[id];
      return node === undefined ? null : { node, paintIndex };
    })
    .filter((entry): entry is { node: SpatialNode; paintIndex: number } => entry !== null);

  /* Sorted by top edge first, so the sweep below sees them in the order it
     needs. Paint order breaks exact ties. */
  const byTop = [...placed].sort((a, b) => {
    const dy = a.node.presentations.desktop.y - b.node.presentations.desktop.y;
    return dy !== 0 ? dy : a.paintIndex - b.paintIndex;
  });

  const bands: (typeof byTop)[] = [];
  let current: typeof byTop = [];
  let bandTop = Number.NaN;

  for (const entry of byTop) {
    const top = entry.node.presentations.desktop.y;

    /* Two conditions to join the current band, and both must hold.

       1. Within the tolerance of the band's FIRST top. Comparing against the
          band's first rather than its previous member is what stops a
          staircase of near-misses from chaining into one enormous band.
       2. Clear of every member already in it, horizontally. See the note
          above — this is what keeps stacked items from being read as a row. */
    const near = current.length > 0 && Math.abs(top - bandTop) <= BAND_TOLERANCE;
    const clear = current.every((member) => !overlapsHorizontally(member.node, entry.node));

    if (current.length === 0 || (near && clear)) {
      if (current.length === 0) bandTop = top;
      current.push(entry);
      continue;
    }
    bands.push(current);
    current = [entry];
    bandTop = top;
  }
  if (current.length > 0) bands.push(current);

  return bands.flatMap((band) =>
    [...band]
      .sort((a, b) => {
        const dx = a.node.presentations.desktop.x - b.node.presentations.desktop.x;
        return dx !== 0 ? dx : a.paintIndex - b.paintIndex;
      })
      .map((entry) => entry.node.id),
  );
}

/** Whether two nodes share any horizontal space. Touching edges do not count:
 *  items placed exactly adjacent are a row, not a stack. */
function overlapsHorizontally(a: SpatialNode, b: SpatialNode): boolean {
  const left = a.presentations.desktop;
  const right = b.presentations.desktop;
  return left.x < right.x + right.width && right.x < left.x + left.width;
}

/** The generated mobile presentation. Overrides layer on top of this later. */
export function resolveMobile(doc: SpatialDocument): ResolvedMobile {
  return {
    blocks: seedReadingOrder(doc).map((nodeId, order) => ({ nodeId, order, source: "auto" })),
  };
}
