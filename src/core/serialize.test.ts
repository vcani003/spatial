import { describe, expect, it } from "vitest";
import { makeFixture } from "./fixture";
import { newDocumentId, type NodeId } from "./ids";
import { InMemoryRepository } from "./repository";
import { deserialize, serialize } from "./serialize";
import { moveNodeBy } from "./mutate";
import { SCHEMA_VERSION } from "./schema";

/**
 * §20's first invariant: "Round-trip serialization: save → load → equivalent
 * canonical document." Plus the validation that makes loading trustworthy.
 *
 * No browser, no React, no IndexedDB — the repository under test stores
 * serialized text in a Map, which exercises the real codec while running
 * anywhere.
 */

const codec = { serialize, deserialize };
const firstNodeId = (doc: ReturnType<typeof makeFixture>): NodeId => {
  const id = doc.paintOrder[0];
  if (id === undefined) throw new Error("fixture has no nodes");
  return id;
};

describe("round trip", () => {
  it("returns an equivalent document", () => {
    const original = makeFixture();
    const result = deserialize(serialize(original));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(original);
  });

  it("survives a repository save and load", async () => {
    const repo = new InMemoryRepository(codec);
    const original = makeFixture();

    await repo.save(original);
    expect(await repo.load(original.id)).toEqual(original);
  });

  it("is stable across repeated trips", () => {
    /* Once is luck if a field is being dropped and re-defaulted to the same
       value. Twice through, compared as text, is the check that nothing is
       quietly regenerated. */
    const once = serialize(makeFixture());
    const parsed = deserialize(once);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serialize(parsed.document)).toBe(once);
  });

  it("preserves an intrinsic height as ABSENT, not as a number", () => {
    /* The distinction the schema was just changed to express: a text node has
       no authored height, and a round trip must not invent one. */
    const doc = makeFixture();
    const parsed = deserialize(serialize(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const text = Object.values(parsed.document.nodes).find((n) => n.type === "text");
    expect(text?.presentations.desktop.height).toBeUndefined();

    const image = Object.values(parsed.document.nodes).find((n) => n.type === "image");
    expect(image?.presentations.desktop.height).toBe(200);
  });

  it("carries an edit through storage", async () => {
    const repo = new InMemoryRepository(codec);
    const doc = makeFixture();
    const id = firstNodeId(doc);

    await repo.save(moveNodeBy(doc, id, 25, -10));
    const loaded = await repo.load(doc.id);

    const before = doc.nodes[id]?.presentations.desktop;
    const after = loaded?.nodes[id]?.presentations.desktop;
    expect(after?.x).toBe((before?.x ?? 0) + 25);
    expect(after?.y).toBe((before?.y ?? 0) - 10);
  });

  it("reports a missing document as null rather than throwing", async () => {
    const repo = new InMemoryRepository(codec);
    expect(await repo.load(newDocumentId())).toBeNull();
  });
});

describe("validation refuses documents it cannot trust", () => {
  const mangle = (edit: (envelope: Record<string, unknown>) => void): string => {
    const envelope = JSON.parse(serialize(makeFixture())) as Record<string, unknown>;
    edit(envelope);
    return JSON.stringify(envelope);
  };
  const doc = (envelope: Record<string, unknown>): Record<string, unknown> =>
    envelope.document as Record<string, unknown>;

  it("rejects non-JSON", () => {
    expect(deserialize("{not json").ok).toBe(false);
  });

  it("rejects a document from a newer schema", () => {
    const result = deserialize(mangle((e) => { e.schemaVersion = SCHEMA_VERSION + 1; }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    /* Refusing, rather than opening it and saving over meaning this build
       cannot see. */
    expect(result.reason).toContain("this build understands");
  });

  it("rejects a paintOrder entry with no node behind it", () => {
    const result = deserialize(mangle((e) => {
      (doc(e).paintOrder as string[]).push("ghost-node");
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing node");
  });

  it("rejects a node that no paintOrder entry mentions", () => {
    const result = deserialize(mangle((e) => {
      (doc(e).paintOrder as string[]).pop();
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing from paintOrder");
  });

  it("rejects a duplicated paintOrder entry", () => {
    const result = deserialize(mangle((e) => {
      const order = doc(e).paintOrder as string[];
      const first = order[0];
      if (first !== undefined) order.push(first);
    }));
    expect(result.ok).toBe(false);
  });

  it("rejects a node whose key and id disagree", () => {
    const result = deserialize(mangle((e) => {
      const nodes = doc(e).nodes as Record<string, Record<string, unknown>>;
      const key = Object.keys(nodes)[0];
      if (key !== undefined) nodes[key]!.id = "somethingelse";
    }));
    expect(result.ok).toBe(false);
  });

  it("rejects an image with no alt", () => {
    const result = deserialize(mangle((e) => {
      const nodes = doc(e).nodes as Record<string, Record<string, unknown>>;
      for (const node of Object.values(nodes)) {
        const content = node.content as Record<string, unknown>;
        if (content.kind === "image") delete content.alt;
      }
    }));
    expect(result.ok).toBe(false);
  });

  it("rejects a null height rather than reading it as intrinsic", () => {
    const result = deserialize(mangle((e) => {
      const nodes = doc(e).nodes as Record<string, Record<string, unknown>>;
      const key = Object.keys(nodes)[0];
      if (key === undefined) return;
      const p = nodes[key]!.presentations as Record<string, Record<string, unknown>>;
      p.desktop!.height = null;
    }));
    expect(result.ok).toBe(false);
  });
});
