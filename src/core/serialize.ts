import { SCHEMA_VERSION, type SpatialDocument } from "./schema";
import type { DocumentId, NodeId, RevisionId } from "./ids";

/**
 * =============================================================================
 * SERIALIZATION — and the envelope that makes migration possible later
 * =============================================================================
 *
 * §20 asks for a round trip: save → load → an equivalent canonical document.
 * §13 asks for a repository abstraction. This module is the part underneath
 * both — turning a document into something storable and, more importantly,
 * turning something stored back into a document THAT CAN BE TRUSTED.
 *
 * ── THE ENVELOPE ────────────────────────────────────────────────────────────
 *
 * What is written is not the document; it is `{ schemaVersion, document }`.
 * The version is on the OUTSIDE, where a loader can read it before it has
 * committed to an interpretation of anything inside. A version nested within
 * data you must already understand in order to reach is a version that arrives
 * too late to be useful.
 *
 * ── PARSING IS VALIDATION, AND IT IS NOT OPTIONAL ───────────────────────────
 *
 * Anything read back is `unknown`. It came off a disk that another version of
 * this app wrote, that a user may have exported and edited, or that a failed
 * write left half-finished. `JSON.parse` returning without throwing says only
 * that the bytes were JSON — it says nothing about whether the shape is a
 * document. So every field is checked on the way in, and a failure produces a
 * reason rather than a crash three screens later when something reads
 * `node.presentations.desktop.x` and gets `undefined`.
 *
 * §19's "no dangling references" is enforced here too: a `paintOrder` entry
 * with no node behind it is a broken document, and it is caught at the door
 * rather than becoming the invisible state §17.2 wants diagnostics to hunt.
 * ========================================================================== */

export interface DocumentEnvelope {
  readonly schemaVersion: number;
  readonly document: SpatialDocument;
}

export type ParseResult =
  | { readonly ok: true; readonly document: SpatialDocument }
  | { readonly ok: false; readonly reason: string };

export function serialize(document: SpatialDocument): string {
  const envelope: DocumentEnvelope = { schemaVersion: SCHEMA_VERSION, document };
  return JSON.stringify(envelope);
}

/* — small readers, so the checks below read as prose rather than as casts — */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): v is string => typeof v === "string" && v !== "";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parsePlacement(raw: unknown): SpatialDocument["nodes"][NodeId]["presentations"]["desktop"] | null {
  if (!isObject(raw)) return null;
  if (!num(raw.x) || !num(raw.y) || !num(raw.width)) return null;

  /* Absent height is INTRINSIC and legal; a present one must be a real
     number. `null` is rejected rather than coerced — it is what a careless
     serializer writes for "no value", and silently reading it as intrinsic
     would hide the bug that produced it. */
  if (raw.height === undefined) return { x: raw.x, y: raw.y, width: raw.width };
  if (!num(raw.height)) return null;
  return { x: raw.x, y: raw.y, width: raw.width, height: raw.height };
}

function parseContent(raw: unknown): SpatialDocument["nodes"][NodeId]["content"] | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "text" && typeof raw.text === "string") {
    return { kind: "text", text: raw.text };
  }
  if (raw.kind === "image" && str(raw.src) && typeof raw.alt === "string") {
    /* `alt` may be "" — that is the HTML convention for decorative — but it
       must be PRESENT. An image whose description was never considered is
       exactly what §7 exists to prevent. */
    return { kind: "image", src: raw.src, alt: raw.alt };
  }
  return null;
}

export function deserialize(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: "Not valid JSON." };
  }

  if (!isObject(parsed)) return { ok: false, reason: "Top level is not an object." };
  if (!num(parsed.schemaVersion)) return { ok: false, reason: "Missing schemaVersion." };

  /* A document from the FUTURE cannot be opened, and guessing is worse than
     refusing: a newer writer may have added meaning this build cannot see, and
     saving over it would silently discard whatever that was. Older versions
     will pass through a migration here — there are none yet, because there has
     only ever been one version. */
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Document is schema v${String(parsed.schemaVersion)}; this build understands v${String(SCHEMA_VERSION)}.`,
    };
  }

  const doc = parsed.document;
  if (!isObject(doc)) return { ok: false, reason: "Envelope has no document." };
  if (!str(doc.id) || !str(doc.revisionId)) {
    return { ok: false, reason: "Document is missing an id or revisionId." };
  }
  if (!isObject(doc.nodes)) return { ok: false, reason: "Document has no nodes map." };
  if (!Array.isArray(doc.paintOrder)) return { ok: false, reason: "Document has no paintOrder." };

  const nodes: Record<string, SpatialDocument["nodes"][NodeId]> = {};
  for (const [id, rawNode] of Object.entries(doc.nodes)) {
    if (!isObject(rawNode)) return { ok: false, reason: `Node ${id} is not an object.` };
    if (rawNode.id !== id) {
      /* The key and the node's own id are two copies of one fact. If they
         disagree, every lookup after this point depends on which one the
         reader happened to use. */
      return { ok: false, reason: `Node ${id} disagrees with its own id.` };
    }
    if (rawNode.type !== "text" && rawNode.type !== "image") {
      return { ok: false, reason: `Node ${id} has an unknown type.` };
    }

    const content = parseContent(rawNode.content);
    if (content === null) return { ok: false, reason: `Node ${id} has invalid content.` };
    if (content.kind !== rawNode.type) {
      return { ok: false, reason: `Node ${id} is a ${rawNode.type} holding ${content.kind} content.` };
    }

    const presentations = isObject(rawNode.presentations) ? rawNode.presentations : null;
    const desktop = presentations === null ? null : parsePlacement(presentations.desktop);
    if (desktop === null) return { ok: false, reason: `Node ${id} has invalid desktop placement.` };

    nodes[id] = { id: id as NodeId, type: rawNode.type, content, presentations: { desktop } };
  }

  const paintOrder: NodeId[] = [];
  const seen = new Set<string>();
  for (const entry of doc.paintOrder) {
    if (!str(entry)) return { ok: false, reason: "paintOrder holds a non-id." };
    if (nodes[entry] === undefined) {
      return { ok: false, reason: `paintOrder references missing node ${entry}.` };
    }
    if (seen.has(entry)) return { ok: false, reason: `paintOrder lists ${entry} twice.` };
    seen.add(entry);
    paintOrder.push(entry as NodeId);
  }

  /* Every node must be paintable. A node absent from paintOrder exists in the
     document and appears nowhere on screen — invisible state, which is the
     precise thing §19 says must never be able to accumulate silently. */
  for (const id of Object.keys(nodes)) {
    if (!seen.has(id)) return { ok: false, reason: `Node ${id} is missing from paintOrder.` };
  }

  return {
    ok: true,
    document: {
      id: doc.id as DocumentId,
      schemaVersion: SCHEMA_VERSION,
      revisionId: doc.revisionId as RevisionId,
      nodes,
      paintOrder,
    },
  };
}
