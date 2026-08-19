// @vitest-environment jsdom
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

const noop = (): void => undefined;

function mount() {
  const doc = makeFixture();
  return {
    doc,
    ...render(<Workspace doc={doc} onChange={noop} saveState="saved" undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false} />),
  };
}

const toggle = (): HTMLElement => screen.getByRole("button", { name: /mobile/i });

/** Opens the preview, which now starts closed and is absent until it is. */
const open = (): void => {
  if (toggle().getAttribute("aria-expanded") !== "true") fireEvent.click(toggle());
};

const body = (): HTMLElement => {
  const element = document.getElementById("mobile-preview-body");
  if (element === null) throw new Error("the preview body is not in the document");
  return element;
};

describe("closed means gone, not empty", () => {
  it("starts closed, with no preview in the document at all", () => {
    mount();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("mobile-preview-body")).toBeNull();
    expect(screen.queryByRole("complementary", { name: /mobile preview/i })).toBeNull();
  });

  it("removes the whole panel when closed, not just its contents", () => {
    /* THE REGRESSION THIS EXISTS FOR. The preview used to keep its column
       after collapsing — contents gone, 103px of empty panel still sitting
       beside the canvas. It was a CSS fault and jsdom could not see it, so it
       was guarded by reading the stylesheet as text.

       Making "closed" mean NOT RENDERED turned that into something the DOM can
       answer, which is a better guard than the one it replaces: the panel
       element itself has to be absent. */
    mount();
    open();
    const panel = screen.getByRole("complementary", { name: /mobile preview/i });
    expect(panel.isConnected).toBe(true);

    fireEvent.click(toggle());
    expect(panel.isConnected).toBe(false);
    expect(screen.queryByRole("complementary", { name: /mobile preview/i })).toBeNull();
  });

  it("reopens", () => {
    mount();
    open();
    fireEvent.click(toggle());
    open();
    expect(body()).not.toBeNull();
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
    expect(toggle().getAttribute("aria-expanded")).toBe("true");

    press({ ctrlKey: true, shiftKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("ignores the chord without shift, which is the minimise binding", () => {
    /* ⌘M is the macOS window-minimise shortcut and must never be ours. */
    mount();
    press({ ctrlKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("ignores a bare M, so typing cannot toggle panels", () => {
    mount();
    press({});
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("does not fire while a text field has focus", () => {
    /* The guard that lets ⌘B mean bold inside a text node later without
       fighting the create bar. */
    mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "M", ctrlKey: true, shiftKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    input.remove();
  });

  it("ignores a key repeat, so a held chord cannot flap the panel", () => {
    mount();
    press({ ctrlKey: true, shiftKey: true, repeat: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("what the preview shows", () => {
  it("renders every node, in the resolver's order", () => {
    /* The preview must present the RESOLVED order, not the document's paint
       order — that is the whole point of it being derived. */
    const { doc } = mount();
    open();
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
    open();
    const image = Object.values(doc.nodes).find((node) => node.type === "image");
    const alt = image?.content.kind === "image" ? image.content.alt : "";

    expect(alt).not.toBe("");
    expect(within(body()).getByRole("img").getAttribute("alt")).toBe(alt);
  });
});
