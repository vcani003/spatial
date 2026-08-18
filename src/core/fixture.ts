import { newDocumentId, newNodeId, newRevisionId, type NodeId } from "./ids";
import { SCHEMA_VERSION, type SpatialDocument, type SpatialNode } from "./schema";

/**
 * A hand-built document, so the canvas has something to render before there
 * is any authoring UI or persistence.
 *
 * It is a fixture and not a default: the moment `DocumentRepository` exists
 * this is what the round-trip test (§20, "save → load → equivalent canonical
 * document") loads and compares against.
 *
 * The image is a remote URL purely so the PoC needs no asset pipeline. §14's
 * `assets` registry and `AssetReference` are where this properly belongs, and
 * it is deliberately the ugliest thing in this file so it does not get
 * mistaken for a decision.
 */
export function makeFixture(): SpatialDocument {
  const entries: readonly SpatialNode[] = [
    node("text", { kind: "text", text: "Spatial" }, { x: 80, y: 60, width: 320, height: 72 }),
    node(
      "text",
      {
        kind: "text",
        text:
          "An infinite canvas where position is presentation, not meaning. " +
          "Drag a node: its geometry moves and nothing else does.",
      },
      { x: 80, y: 160, width: 380, height: 120 },
    ),
    node(
      "image",
      {
        kind: "image",
        src: "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=600&q=70",
        alt: "A dense field of stars.",
      },
      { x: 520, y: 90, width: 300, height: 200 },
    ),
    node(
      "text",
      { kind: "text", text: "figure 1 — a caption that is not yet semantically attached to anything" },
      { x: 520, y: 306, width: 300, height: 48 },
    ),
  ];

  const nodes: Record<NodeId, SpatialNode> = {};
  for (const entry of entries) nodes[entry.id] = entry;

  return {
    id: newDocumentId(),
    schemaVersion: SCHEMA_VERSION,
    revisionId: newRevisionId(),
    nodes,
    paintOrder: entries.map((entry) => entry.id),
  };
}

function node(
  type: SpatialNode["type"],
  content: SpatialNode["content"],
  desktop: SpatialNode["presentations"]["desktop"],
): SpatialNode {
  return { id: newNodeId(), type, content, presentations: { desktop } };
}
