// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../core/fixture";
import { Workspace } from "./Workspace";

/**
 * The shell's layout.
 *
 * ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
 *
 * The workspace was `grid-template-rows: auto auto 1fr` — toolbar, create bar,
 * stage. That only held while all three existed. With the create bar closed
 * there are TWO children, so the stage was auto-placed into row 2 (`auto`)
 * while the `1fr` row sat empty beneath it, and a canvas asking for
 * `block-size: 100%` of a content-sized row collapsed to nothing. Measured at
 * 700px tall: rows resolved to 39px / 0px / 661px and the canvas was 0 high.
 * The page looked fine with the Add bar open and was empty without it.
 *
 * ── AND WHY THE GUARD IS SHAPED LIKE THIS ───────────────────────────────────
 *
 * jsdom does no layout: every element here measures zero whether the CSS is
 * right or wrong, so the failure is invisible to a DOM assertion. Unlike the
 * preview's collapse — which was made testable by changing the design so
 * "closed" means "not rendered" — there is no restructuring that turns "the
 * canvas has height" into something jsdom can answer.
 *
 * So this reads the stylesheet as text, and it is narrow on purpose: it
 * asserts the ONE property whose interaction with a varying child count caused
 * the bug. The real assertion is a browser measurement, recorded in the commit
 * that fixed it: stage 661px of a 700px window with the bar closed, 613px with
 * it open.
 */

afterEach(cleanup);

const mount = () =>
  render(<Workspace doc={makeFixture()} onChange={() => undefined} saveState="saved" undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false} />);

describe("the toolbar", () => {
  it("offers both panels, and both start closed", () => {
    mount();
    for (const name of [/add/i, /mobile/i]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("stays put when everything is closed, so there is a way back in", () => {
    /* The whole point of moving the toggles here: a closed panel costs
       nothing, but closing the last one must not leave the app with no
       controls at all. */
    mount();
    expect(screen.getByRole("button", { name: /mobile/i }).isConnected).toBe(true);
    expect(screen.queryByRole("complementary", { name: /mobile preview/i })).toBeNull();
  });
});

describe("the stage's height does not depend on how many panels are open", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/editor/Workspace.module.css"),
    "utf8",
  );

  const ruleFor = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };

  it("does not lay the workspace out in a fixed number of rows", () => {
    /* A row count is a rule about how many children there are, and that number
       changes every time a panel opens. Whatever replaces flex here must not
       reintroduce one. */
    expect(ruleFor(".workspace")).not.toMatch(/grid-template-rows/);
  });

  it("lets the stage take the space the bars did not", () => {
    expect(ruleFor(".stage")).toMatch(/flex:\s*1/);
    /* Without this a flex item refuses to shrink below its content, and the
       canvas pushes past the bottom of the window instead of scrolling. */
    expect(ruleFor(".stage")).toMatch(/min-block-size:\s*0/);
  });
});
