import { newNodeId } from "./ids";
import type { DesktopPlacement, SpatialNode } from "./schema";

/**
 * =============================================================================
 * MAKING NODES — and the one security boundary in `core`
 * =============================================================================
 *
 * §11 is explicit that unsafe content is kept out DETERMINISTICALLY and by
 * allowlist, not by pattern-matching for things that look dangerous. A
 * blocklist is a promise you have thought of every scheme; an allowlist is a
 * statement about the two you support.
 *
 * This lives in `core` rather than in the input that collects the URL, because
 * it is a property of what a valid document may contain — not of one text
 * field. The day a URL arrives by paste, by drag-and-drop, by import or from a
 * collaborator, it passes through here or it does not become a node.
 */

/**
 * Schemes an image may load over. Everything else is refused.
 *
 *   javascript:  executes
 *   data:        smuggles arbitrary bytes past every URL check downstream and
 *                is how an "image" becomes an HTML document
 *   file:        reads the visitor's disk
 *   blob:        references memory this document cannot own across a reload
 *
 * §11 also says plainly what this does NOT do: it cannot tell you whether a
 * destination is trustworthy. Syntax is not reputation, and pretending
 * otherwise is how a validator becomes security theatre.
 */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export function isSafeImageUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    /* Not absolute, or not a URL at all. Relative paths are refused on purpose:
       they would resolve against whatever page happens to host the canvas, so
       the same document would mean different things in two deployments. */
    return false;
  }

  return ALLOWED_SCHEMES.has(parsed.protocol);
}

/** Default size for a new text node, in world units. Height is intrinsic. */
const TEXT_WIDTH = 320;

/** Default box for a new image, before anything is known about its aspect. */
const IMAGE_WIDTH = 320;
const IMAGE_HEIGHT = 213;

/** Places a new node's box so its CENTRE lands on the given point. */
function centredAt(centre: { x: number; y: number }, width: number, height?: number): DesktopPlacement {
  const base = { x: centre.x - width / 2, y: centre.y - (height ?? 0) / 2, width };
  return height === undefined ? base : { ...base, height };
}

export function createTextNode(text: string, centre: { x: number; y: number }): SpatialNode {
  return {
    id: newNodeId(),
    type: "text",
    content: { kind: "text", text },
    /* No height: text is intrinsic, and authoring one here would immediately
       be wrong the first time the words change. */
    presentations: { desktop: centredAt(centre, TEXT_WIDTH) },
  };
}

/**
 * @throws if the URL is not one this document may contain. Callers are
 * expected to have checked with `isSafeImageUrl` and shown the person a
 * reason; the throw is the backstop that keeps an unchecked path from
 * silently producing a node.
 */
export function createImageNode(
  src: string,
  alt: string,
  centre: { x: number; y: number },
): SpatialNode {
  if (!isSafeImageUrl(src)) throw new Error(`Refused image URL: ${src}`);

  return {
    id: newNodeId(),
    type: "image",
    /* `alt` may be empty — that is the convention for decorative — but it is
       always present, so no image can be added without the question having
       been put. §7 makes accessibility architectural rather than a later pass. */
    content: { kind: "image", src: src.trim(), alt: alt.trim() },
    presentations: { desktop: centredAt(centre, IMAGE_WIDTH, IMAGE_HEIGHT) },
  };
}
