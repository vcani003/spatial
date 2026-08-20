import { describe, expect, it } from "vitest";
import { makeFixture } from "./fixture";
import { newNodeId, type NodeId } from "./ids";
import { bringToFront, moveNodeBy, moveNodesBy, removeNode, removeNodes, setNodeText } from "./mutate";

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

describe("setNodeText", () => {
  const textId = (doc: ReturnType<typeof makeFixture>): NodeId => {
    const found = Object.values(doc.nodes).find((n) => n.type === "text");
    if (found === undefined) throw new Error("fixture has no text node");
    return found.id;
  };

  it("replaces the words", () => {
    const doc = makeFixture();
    const id = textId(doc);
    const content = setNodeText(doc, id, "something else").nodes[id]?.content;
    expect(content?.kind === "text" && content.text).toBe("something else");
  });

  it("leaves authored geometry alone", () => {
    /* Editing words is not moving a box. The RENDERED box will change, because
       a text node's height is intrinsic — but nothing authored about it may. */
    const doc = makeFixture();
    const id = textId(doc);
    const before = doc.nodes[id]?.presentations.desktop;
    expect(
      setNodeText(doc, id, "much much longer text than there was before").nodes[id]
        ?.presentations.desktop,
    ).toEqual(before);
  });

  it("accepts empty text without objecting", () => {
    /* Mid-edit everything is deleted before anything is typed. What an empty
       node MEANS is the editor's decision, not this function's. */
    const doc = makeFixture();
    const id = textId(doc);
    const content = setNodeText(doc, id, "").nodes[id]?.content;
    expect(content?.kind === "text" && content.text).toBe("");
  });

  it("is a no-op for unchanged text, for an image, and for an unknown id", () => {
    const doc = makeFixture();
    const id = textId(doc);
    const current = doc.nodes[id]?.content;
    const same = current?.kind === "text" ? current.text : "";

    expect(setNodeText(doc, id, same)).toBe(doc);
    expect(setNodeText(doc, newNodeId(), "x")).toBe(doc);

    const image = Object.values(doc.nodes).find((n) => n.type === "image");
    if (image !== undefined) expect(setNodeText(doc, image.id, "x")).toBe(doc);
  });

  it("does not mutate the document, and stamps a revision", () => {
    const doc = makeFixture();
    const snapshot = structuredClone(doc);
    const next = setNodeText(doc, textId(doc), "new words");
    expect(doc).toEqual(snapshot);
    expect(next.revisionId).not.toBe(doc.revisionId);
  });
});

describe("removeNode", () => {
  it("removes the node AND its paint order entry", () => {
    /* Both halves. A node dropped from `nodes` but left in `paintOrder` is the
       dangling reference §19 calls a trap. */
    const doc = makeFixture();
    const id = firstId(doc);
    const next = removeNode(doc, id);

    expect(next.nodes[id]).toBeUndefined();
    expect(next.paintOrder).not.toContain(id);
    expect(next.paintOrder).toHaveLength(doc.paintOrder.length - 1);
  });

  it("leaves every other node exactly as it was", () => {
    const doc = makeFixture();
    const id = firstId(doc);
    const next = removeNode(doc, id);

    for (const other of doc.paintOrder) {
      if (other === id) continue;
      expect(next.nodes[other]).toEqual(doc.nodes[other]);
    }
    expect(next.paintOrder).toEqual(doc.paintOrder.filter((o) => o !== id));
  });

  it("ignores an unknown id", () => {
    const doc = makeFixture();
    expect(removeNode(doc, newNodeId())).toBe(doc);
  });

  it("does not mutate the document, and stamps a revision", () => {
    const doc = makeFixture();
    const snapshot = structuredClone(doc);
    const next = removeNode(doc, firstId(doc));
    expect(doc).toEqual(snapshot);
    expect(next.revisionId).not.toBe(doc.revisionId);
  });
});

describe("removeNodes", () => {
  it("removes several as one change", () => {
    /* Deleting a selection of three is ONE action from the person's side, so
       it stamps one revision — otherwise, with history watching, it would
       take three presses of undo to put them back. */
    const doc = makeFixture();
    const [a, b] = doc.paintOrder;
    if (a === undefined || b === undefined) throw new Error("fixture too small");

    const next = removeNodes(doc, [a, b]);
    expect(next.nodes[a]).toBeUndefined();
    expect(next.nodes[b]).toBeUndefined();
    expect(next.paintOrder).toHaveLength(doc.paintOrder.length - 2);
    expect(next.revisionId).not.toBe(doc.revisionId);
  });

  it("ignores ids that are not there, and does nothing for none", () => {
    const doc = makeFixture();
    const real = doc.paintOrder[0];
    if (real === undefined) throw new Error("empty fixture");

    expect(removeNodes(doc, [])).toBe(doc);
    expect(removeNodes(doc, [newNodeId()])).toBe(doc);
    expect(removeNodes(doc, [real, newNodeId()]).paintOrder).toHaveLength(
      doc.paintOrder.length - 1,
    );
  });

  it("leaves the survivors in their existing order", () => {
    const doc = makeFixture();
    const gone = doc.paintOrder[1];
    if (gone === undefined) throw new Error("fixture too small");

    expect(removeNodes(doc, [gone]).paintOrder).toEqual(
      doc.paintOrder.filter((id) => id !== gone),
    );
  });
});

describe("moveNodesBy", () => {
  it("moves every id given, by the same delta", () => {
    const doc = makeFixture();
    const [a, b] = doc.paintOrder;
    if (a === undefined || b === undefined) throw new Error("fixture too small");

    const before = { a: doc.nodes[a]?.presentations.desktop, b: doc.nodes[b]?.presentations.desktop };
    const next = moveNodesBy(doc, [a, b], 30, -12);

    expect(next.nodes[a]?.presentations.desktop.x).toBe((before.a?.x ?? 0) + 30);
    expect(next.nodes[b]?.presentations.desktop.y).toBe((before.b?.y ?? 0) - 12);
  });

  it("leaves nodes outside the selection alone", () => {
    const doc = makeFixture();
    const moved = doc.paintOrder[0];
    if (moved === undefined) throw new Error("empty fixture");

    const next = moveNodesBy(doc, [moved], 50, 50);
    for (const id of doc.paintOrder.slice(1)) {
      expect(next.nodes[id]).toEqual(doc.nodes[id]);
    }
  });

  it("is one change for the whole selection", () => {
    const doc = makeFixture();
    const next = moveNodesBy(doc, doc.paintOrder, 5, 5);
    expect(next.revisionId).not.toBe(doc.revisionId);
  });

  it("does nothing for a zero delta or an empty selection", () => {
    /* A press with no movement must not mark the document dirty. */
    const doc = makeFixture();
    expect(moveNodesBy(doc, doc.paintOrder, 0, 0)).toBe(doc);
    expect(moveNodesBy(doc, [], 10, 10)).toBe(doc);
  });
});
