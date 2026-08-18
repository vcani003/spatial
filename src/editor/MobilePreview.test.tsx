// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../core/fixture";
import { resolveMobile } from "../core/mobile";
import { Workspace } from "./Workspace";

/**
 * =============================================================================
 * THE MOUNTED MOBILE PREVIEW
 * =============================================================================
 *
 * ONLY THIS DIRECTORY GETS A DOM. `core` runs under Node with no browser at
 * all, and that is the standing proof it stays framework-free — see
 * `core/README.md`. The docblock at the top of this file opts THIS file into
 * jsdom without weakening that anywhere else.
 *
 * ── WHAT JSDOM CAN AND CANNOT ANSWER, STATED SO IT IS NOT ASSUMED ───────────
 *
 * jsdom implements the DOM but NOT layout: every element measures zero, and
 * `getComputedStyle` cannot resolve a `clamp()` or a stylesheet from a CSS
 * module. So "collapsing gives the canvas its width back" — the regression
 * these tests exist for — is genuinely NOT assertable here, and pretending
 * otherwise with a mocked width would be a test that passes while the bug
 * ships.
 *
 * It is covered from two directions instead:
 *
 *   the BEHAVIOUR contract (below) — state, ARIA, and the fact that a
 *   collapsed panel is truly absent rather than merely invisible
 *
 *   the STYLESHEET contract (bottom) — a source-level guard that the width is
 *   declared only for the open state, which is exactly the mistake that was
 *   made and exactly what jsdom cannot see
 *
 * A real layout assertion needs a real browser. That is a Playwright test and
 * it is worth adding when there is more than one panel to check.
 */

afterEach(cleanup);

/**
 * jsdom implements no `ResizeObserver`, and the preview uses one to fit the
 * device to its panel. A stub rather than a polyfill: jsdom does no layout, so
 * a real observer would only ever report zero and the scale it produced would
 * be meaningless. The fitting behaviour needs a browser to test; what these
 * tests cover is everything around it, which should not be blocked by a
 * missing global.
 */
class StubResizeObserver implements ResizeObserver {
  observe(): void {
    /* Never fires. The component keeps its initial scale, which is correct
       for an environment with nothing to measure. */
  }
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = StubResizeObserver;

const noop = (): void => undefined;

function mount() {
  const doc = makeFixture();
  return {
    doc,
    ...render(<Workspace doc={doc} onChange={noop} saveState="saved" />),
  };
}

const toggle = (): HTMLElement => screen.getByRole("button", { name: /mobile/i });
const body = (): HTMLElement => {
  const element = document.getElementById("mobile-preview-body");
  if (element === null) throw new Error("the preview body is not in the document");
  return element;
};

describe("the preview's open/closed contract", () => {
  it("starts open", () => {
    mount();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(body().hidden).toBe(false);
  });

  it("closes and reopens on click", () => {
    mount();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(body().hidden).toBe(true);

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(body().hidden).toBe(false);
  });

  it("marks the panel closed so the stylesheet can release its width", () => {
    /* `data-open` is the hook the width rule keys on. jsdom cannot measure the
       result, but it CAN prove the attribute the rule depends on actually
       flips — half of the regression, and the half that lives in TSX. */
    mount();
    const panel = body().closest("aside");
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("data-open")).toBe(true);

    fireEvent.click(toggle());
    expect(panel?.hasAttribute("data-open")).toBe(false);
  });

  it("removes a collapsed preview from the accessibility tree entirely", () => {
    /* `hidden` rather than a class that merely paints it away: a collapsed
       panel a screen reader still walks into, or the keyboard still tabs
       through, is not collapsed. */
    /* Scoped to the preview. The CANVAS renders the same image node, so an
       unscoped query finds it there and the assertion passes or fails for
       entirely the wrong reason — which is what it did the first time. */
    mount();
    expect(within(body()).queryByRole("img")).not.toBeNull();

    fireEvent.click(toggle());
    expect(within(body()).queryByRole("img")).toBeNull();
    expect(body().hidden).toBe(true);
  });
});

describe("the ⌘⇧M shortcut", () => {
  const press = (init: KeyboardEventInit): void => {
    fireEvent.keyDown(window, { key: "M", ...init });
  };

  it("toggles the preview", () => {
    mount();
    /* jsdom reports a non-Mac user agent, so Ctrl is the modifier here — the
       same branch a Windows or Linux visitor takes. */
    press({ ctrlKey: true, shiftKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");

    press({ ctrlKey: true, shiftKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores the chord without shift, which is the minimise binding", () => {
    /* ⌘M is the macOS window-minimise shortcut and must never be ours. */
    mount();
    press({ ctrlKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores a bare M, so typing cannot toggle panels", () => {
    mount();
    press({});
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("does not fire while a text field has focus", () => {
    /* The guard that lets ⌘B mean bold inside a text node later without
       fighting the create bar. */
    mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "M", ctrlKey: true, shiftKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    input.remove();
  });

  it("ignores a key repeat, so a held chord cannot flap the panel", () => {
    mount();
    press({ ctrlKey: true, shiftKey: true, repeat: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("what the preview shows", () => {
  it("renders every node, in the resolver's order", () => {
    /* The preview must present the RESOLVED order, not the document's paint
       order — that is the whole point of it being derived. */
    const { doc } = mount();
    const expected = resolveMobile(doc).blocks.map((block) => {
      const node = doc.nodes[block.nodeId];
      return node?.content.kind === "text" ? node.content.text : "[image]";
    });

    const rendered = [...body().querySelectorAll("p, img")].map((element) =>
      element.tagName === "IMG" ? "[image]" : (element.textContent ?? ""),
    );

    expect(rendered).toEqual(expected);
  });

  it("carries the image's alt text through to the preview", () => {
    /* §7 is architectural, not a later pass: a derived presentation that drops
       the description is an inaccessible presentation. */
    const { doc } = mount();
    const image = Object.values(doc.nodes).find((node) => node.type === "image");
    const alt = image?.content.kind === "image" ? image.content.alt : "";

    expect(alt).not.toBe("");
    expect(within(body()).getByRole("img").getAttribute("alt")).toBe(alt);
  });
});

describe("the stylesheet's collapse contract", () => {
  /* THE REGRESSION GUARD, and it reads the CSS as text on purpose.
     The bug was `inline-size` declared on `.panel` unconditionally, so
     collapsing emptied the column without releasing it. jsdom resolves no
     stylesheets and measures nothing, so the only place this is checkable
     without a browser is the source. Narrow, and aimed at exactly one
     mistake. */
  /* Resolved from the project root rather than `import.meta.url`: under jsdom
     `import.meta.url` is not a file: URL, so `fileURLToPath` refuses it. */
  const css = readFileSync(
    resolve(process.cwd(), "src/editor/MobilePreview.module.css"),
    "utf8",
  );

  /** The body of a rule, given its selector. */
  const ruleFor = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };

  it("does not give the closed panel a width", () => {
    expect(ruleFor(".panel")).not.toMatch(/^\s*inline-size:/m);
  });

  it("gives the open panel its width", () => {
    expect(ruleFor(".panel[data-open]")).toMatch(/inline-size:/);
  });
});
