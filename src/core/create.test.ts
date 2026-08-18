import { describe, expect, it } from "vitest";
import { createImageNode, createTextNode, isSafeImageUrl } from "./create";
import { makeFixture } from "./fixture";
import { addNode } from "./mutate";

describe("isSafeImageUrl", () => {
  it("allows http and https", () => {
    expect(isSafeImageUrl("https://example.com/a.jpg")).toBe(true);
    expect(isSafeImageUrl("http://example.com/a.jpg")).toBe(true);
    expect(isSafeImageUrl("  https://example.com/a.jpg  ")).toBe(true);
  });

  it("refuses schemes that execute, smuggle or read the disk", () => {
    /* §11's allowlist, one case each for why the list is a list.
       javascript: executes. data: smuggles arbitrary bytes past every check
       downstream — it is how an "image" becomes an HTML document. file: reads
       the visitor's disk. blob: points at memory no reload can restore. */
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:image/png;base64,iVBORw0KGgo=",
      "file:///etc/passwd",
      "blob:https://example.com/1234",
      "vbscript:msgbox",
    ]) {
      expect(isSafeImageUrl(url), url).toBe(false);
    }
  });

  it("refuses relative paths and nonsense", () => {
    /* Relative would resolve against whatever page hosts the canvas, so the
       same document would mean different things in two deployments. */
    for (const url of ["", "   ", "/assets/a.jpg", "./a.jpg", "example.com/a.jpg", "not a url"]) {
      expect(isSafeImageUrl(url), JSON.stringify(url)).toBe(false);
    }
  });

  it("is not fooled by a scheme buried in the path", () => {
    /* The URL parser decides, not a substring search — the thing a hand-rolled
       check gets wrong. */
    expect(isSafeImageUrl("https://example.com/javascript:alert(1)")).toBe(true);
    expect(isSafeImageUrl("  javascript:https://example.com/a.jpg")).toBe(false);
  });
});

describe("createTextNode", () => {
  it("centres the box on the given point", () => {
    const node = createTextNode("hello", { x: 500, y: 300 });
    const { x, width } = node.presentations.desktop;
    expect(x + width / 2).toBeCloseTo(500, 6);
  });

  it("leaves the height intrinsic", () => {
    /* Authoring a height here would be wrong the first time the words change. */
    expect(createTextNode("hello", { x: 0, y: 0 }).presentations.desktop.height).toBeUndefined();
  });

  it("gives every node its own id", () => {
    const a = createTextNode("a", { x: 0, y: 0 });
    const b = createTextNode("a", { x: 0, y: 0 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("createImageNode", () => {
  it("centres the box on the given point", () => {
    const node = createImageNode("https://example.com/a.jpg", "a thing", { x: 100, y: 80 });
    const { x, y, width, height } = node.presentations.desktop;
    expect(x + width / 2).toBeCloseTo(100, 6);
    expect(y + (height ?? 0) / 2).toBeCloseTo(80, 6);
  });

  it("keeps an authored height, unlike text", () => {
    const node = createImageNode("https://example.com/a.jpg", "", { x: 0, y: 0 });
    expect(node.presentations.desktop.height).toBeGreaterThan(0);
  });

  it("accepts an empty alt as decorative, but always carries the field", () => {
    const node = createImageNode("https://example.com/a.jpg", "   ", { x: 0, y: 0 });
    expect(node.content.kind === "image" && node.content.alt).toBe("");
  });

  it("refuses an unsafe URL rather than making a node from it", () => {
    /* The backstop. Callers check first and explain themselves to the person;
       this is what stops an unchecked path producing a node silently. */
    expect(() => createImageNode("javascript:alert(1)", "", { x: 0, y: 0 })).toThrow(/Refused/);
  });
});

describe("addNode", () => {
  it("adds the node on top of the paint order", () => {
    /* A thing you just made and cannot find is indistinguishable from a thing
       that was never made. */
    const doc = makeFixture();
    const node = createTextNode("new", { x: 0, y: 0 });
    const added = addNode(doc, node);

    expect(added.paintOrder[added.paintOrder.length - 1]).toBe(node.id);
    expect(added.nodes[node.id]).toEqual(node);
  });

  it("does not disturb what was already there", () => {
    const doc = makeFixture();
    const added = addNode(doc, createTextNode("new", { x: 0, y: 0 }));

    for (const id of doc.paintOrder) {
      expect(added.nodes[id]).toEqual(doc.nodes[id]);
    }
    expect(added.paintOrder.slice(0, -1)).toEqual(doc.paintOrder);
  });

  it("does not mutate the document it was given, and stamps a revision", () => {
    const doc = makeFixture();
    const snapshot = structuredClone(doc);
    const added = addNode(doc, createTextNode("new", { x: 0, y: 0 }));

    expect(doc).toEqual(snapshot);
    expect(added.revisionId).not.toBe(doc.revisionId);
  });
});
