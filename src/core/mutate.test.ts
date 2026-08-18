import { describe, expect, it } from "vitest";
import { makeFixture } from "./fixture";
import { newNodeId, type NodeId } from "./ids";
import { bringToFront, moveNodeBy } from "./mutate";

/**
 * The mutation seam. Every change to a document goes through here, so these
 * are the invariants the eventual command/history layer inherits.
 */

const firstId = (doc: ReturnType<typeof makeFixture>): NodeId => {
  const id = doc.paintOrder[0];
  if (id === undefined) throw new Error("empty fixture");
  return id;
};

describe("moveNodeBy", () => {
  it("moves the node it names", () => {
    const doc = makeFixture();
    const id = firstId(doc);
    const before = doc.nodes[id]?.presentations.desktop;

    const after = moveNodeBy(doc, id, 40, -15).nodes[id]?.presentations.desktop;
    expect(after?.x).toBe((before?.x ?? 0) + 40);
    expect(after?.y).toBe((before?.y ?? 0) - 15);
  });

  it("moves nothing else", () => {
    /* The invariant the whole presentation split exists to protect: geometry
       is per-node, and a move is not allowed to disturb a neighbour. */
    const doc = makeFixture();
    const moved = moveNodeBy(doc, firstId(doc), 100, 100);

    for (const id of doc.paintOrder.slice(1)) {
      expect(moved.nodes[id]).toEqual(doc.nodes[id]);
    }
  });

  it("does not mutate the document it was given", () => {
    /* Undo/redo, round-trip equality and eventual collaboration all assume a
       document is a value. Starting mutable and converting later is the
       migration nobody finishes. */
    const doc = makeFixture();
    const id = firstId(doc);
    const snapshot = structuredClone(doc);

    moveNodeBy(doc, id, 25, 25);
    expect(doc).toEqual(snapshot);
  });

  it("stamps a new revision", () => {
    /* §4.1's basedOnRevision needs a revision that actually moves. One that
       only changes on save lies between saves. */
    const doc = makeFixture();
    const moved = moveNodeBy(doc, firstId(doc), 1, 1);
    expect(moved.revisionId).not.toBe(doc.revisionId);
  });

  it("ignores an unknown id instead of throwing", () => {
    /* Selection can outlive a node for a frame. A canvas that crashes on a
       stale id is worse than one that ignores it — the dangling reference is
       a diagnostic's job, not an exception's. */
    const doc = makeFixture();
    expect(moveNodeBy(doc, newNodeId(), 10, 10)).toBe(doc);
  });

  it("accumulates across a gesture's frames", () => {
    /* A drag is many small moves. Ten frames of +3 must land at +30, with no
       drift from rounding or from re-reading a stale origin. */
    const doc = makeFixture();
    const id = firstId(doc);
    const start = doc.nodes[id]?.presentations.desktop.x ?? 0;

    let moving = doc;
    for (let i = 0; i < 10; i++) moving = moveNodeBy(moving, id, 3, 0);

    expect(moving.nodes[id]?.presentations.desktop.x).toBeCloseTo(start + 30, 10);
  });
});

describe("bringToFront", () => {
  it("moves the node to the end of the paint order", () => {
    const doc = makeFixture();
    const id = firstId(doc);
    const raised = bringToFront(doc, id);

    expect(raised.paintOrder[raised.paintOrder.length - 1]).toBe(id);
    expect(raised.paintOrder).toHaveLength(doc.paintOrder.length);
    expect([...raised.paintOrder].sort()).toEqual([...doc.paintOrder].sort());
  });

  it("keeps everything else in its existing relative order", () => {
    const doc = makeFixture();
    const id = firstId(doc);
    const raised = bringToFront(doc, id);

    const others = doc.paintOrder.filter((other) => other !== id);
    expect(raised.paintOrder.slice(0, -1)).toEqual(others);
  });

  it("is a no-op for a node already at the front", () => {
    /* Clicking the top node repeatedly must not stamp a revision each time, or
       every click would mark the document dirty and trigger a save. */
    const doc = makeFixture();
    const top = doc.paintOrder[doc.paintOrder.length - 1];
    if (top === undefined) throw new Error("empty fixture");

    expect(bringToFront(doc, top)).toBe(doc);
  });

  it("changes no geometry", () => {
    /* Paint order is stacking and nothing else. §21 locks it apart from
       reading order; this pins it apart from position too. */
    const doc = makeFixture();
    const raised = bringToFront(doc, firstId(doc));

    for (const id of doc.paintOrder) {
      expect(raised.nodes[id]?.presentations.desktop).toEqual(
        doc.nodes[id]?.presentations.desktop,
      );
    }
  });
});
