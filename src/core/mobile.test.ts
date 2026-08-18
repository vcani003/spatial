import { describe, expect, it } from "vitest";
import { makeFixture } from "./fixture";
import { newDocumentId, newNodeId, newRevisionId, type NodeId } from "./ids";
import { BAND_TOLERANCE, resolveMobile, seedReadingOrder } from "./mobile";
import { moveNodeBy } from "./mutate";
import { SCHEMA_VERSION, type SpatialDocument, type SpatialNode } from "./schema";

/** Builds a document from bare coordinates, so a test reads as a layout. */
function docOf(...positions: readonly { x: number; y: number; label: string }[]): {
  doc: SpatialDocument;
  idOf: (label: string) => NodeId;
  labelsInOrder: () => string[];
} {
  const labels = new Map<NodeId, string>();
  const nodes: Record<NodeId, SpatialNode> = {};
  const order: NodeId[] = [];

  for (const { x, y, label } of positions) {
    const id = newNodeId();
    labels.set(id, label);
    nodes[id] = {
      id,
      type: "text",
      content: { kind: "text", text: label },
      presentations: { desktop: { x, y, width: 100 } },
    };
    order.push(id);
  }

  const doc: SpatialDocument = {
    id: newDocumentId(),
    schemaVersion: SCHEMA_VERSION,
    revisionId: newRevisionId(),
    nodes,
    paintOrder: order,
  };

  return {
    doc,
    idOf: (label) => {
      const found = [...labels.entries()].find(([, l]) => l === label);
      if (found === undefined) throw new Error(`no node labelled ${label}`);
      return found[0];
    },
    labelsInOrder: () => seedReadingOrder(doc).map((id) => labels.get(id) ?? "?"),
  };
}

describe("reading order seeded from geometry", () => {
  it("reads top to bottom when items are stacked", () => {
    const { labelsInOrder } = docOf(
      { label: "third", x: 0, y: 400 },
      { label: "first", x: 0, y: 0 },
      { label: "second", x: 0, y: 200 },
    );
    expect(labelsInOrder()).toEqual(["first", "second", "third"]);
  });

  it("reads left to right within a row", () => {
    /* The case a naive sort by y gets wrong: three items placed side by side,
       eyeballed, so their tops differ by a few pixels. Sorting on y alone
       would order them by that noise. */
    const { labelsInOrder } = docOf(
      { label: "right", x: 800, y: 4 },
      { label: "left", x: 0, y: 0 },
      { label: "middle", x: 400, y: 9 },
    );
    expect(labelsInOrder()).toEqual(["left", "middle", "right"]);
  });

  it("reads rows in order, and items within each row", () => {
    const { labelsInOrder } = docOf(
      { label: "b2", x: 400, y: 500 },
      { label: "a1", x: 0, y: 0 },
      { label: "b1", x: 0, y: 500 },
      { label: "a2", x: 400, y: 6 },
    );
    expect(labelsInOrder()).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("splits a row when the gap exceeds the tolerance", () => {
    const { labelsInOrder } = docOf(
      { label: "lower-left", x: 0, y: BAND_TOLERANCE + 1 },
      { label: "upper-right", x: 900, y: 0 },
    );
    /* Beyond the tolerance these are two rows, so the upper one reads first
       even though it is further right. */
    expect(labelsInOrder()).toEqual(["upper-right", "lower-left"]);
  });

  it("does not chain a staircase of near-misses into one row", () => {
    /* Each item is within the tolerance of the PREVIOUS one, but the run spans
       far more than a row. Banding against the first member of the band is
       what stops this collapsing into a single left-to-right sweep. */
    const step = BAND_TOLERANCE - 2;
    const { labelsInOrder } = docOf(
      { label: "d", x: 0, y: step * 3 },
      { label: "c", x: 10, y: step * 2 },
      { label: "b", x: 20, y: step },
      { label: "a", x: 30, y: 0 },
    );
    expect(labelsInOrder()).toEqual(["a", "b", "c", "d"]);
  });

  it("is stable for items at identical positions", () => {
    const { doc, labelsInOrder } = docOf(
      { label: "under", x: 5, y: 5 },
      { label: "over", x: 5, y: 5 },
    );
    /* Paint order breaks the tie, so the answer cannot depend on object key
       iteration. Asserted twice because a nondeterministic sort can agree
       with itself once by luck. */
    expect(labelsInOrder()).toEqual(["under", "over"]);
    expect(seedReadingOrder(doc).length).toBe(2);
  });

  it("ignores a paintOrder entry with no node behind it", () => {
    const { doc } = docOf({ label: "only", x: 0, y: 0 });
    const broken: SpatialDocument = {
      ...doc,
      paintOrder: [...doc.paintOrder, "ghost" as NodeId],
    };
    expect(seedReadingOrder(broken)).toHaveLength(1);
  });
});

describe("resolveMobile", () => {
  it("numbers the blocks from zero and marks them generated", () => {
    const resolved = resolveMobile(makeFixture());
    expect(resolved.blocks.map((b) => b.order)).toEqual([0, 1, 2, 3]);
    expect(resolved.blocks.every((b) => b.source === "auto")).toBe(true);
  });

  it("re-derives when the desktop geometry changes", () => {
    /* §4.2: moving something on desktop regenerates the inferred order. With
       no overrides in existence yet, the generated result is free to change
       completely — which is the property that stops being true the moment
       author overrides land, and is why they get their own provenance. */
    const doc = makeFixture();
    const before = resolveMobile(doc).blocks.map((b) => b.nodeId);

    const last = before[before.length - 1];
    if (last === undefined) throw new Error("empty fixture");

    /* Drag the last-read node far above everything else. */
    const moved = moveNodeBy(doc, last, 0, -5000);
    const after = resolveMobile(moved).blocks.map((b) => b.nodeId);

    expect(after[0]).toBe(last);
    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("separates the fixture's photograph from its caption", () => {
    /* NOT AN ASSERTION THAT THIS IS RIGHT — it is a record that geometry
       alone cannot keep an image and its caption together, which is §16.1's
       worked example and the reason semantic grouping exists. When keepWith
       or a semantic group lands, this test should be updated to expect them
       adjacent, and its failure will be the proof the feature works. */
    const doc = makeFixture();
    const order = resolveMobile(doc).blocks.map((b) => doc.nodes[b.nodeId]);

    const imageAt = order.findIndex((n) => n?.type === "image");
    const captionAt = order.findIndex((n) => n?.content.kind === "text" && n.content.text.startsWith("figure 1"));

    expect(imageAt).toBeGreaterThanOrEqual(0);
    expect(captionAt).toBeGreaterThanOrEqual(0);
    expect(captionAt - imageAt).toBeGreaterThan(1);
  });
});
