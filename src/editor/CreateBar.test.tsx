// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../core/fixture";
import type { SpatialDocument } from "../core/schema";
import { Workspace } from "./Workspace";

/**
 * Adding elements, through the shell rather than the bar in isolation — the
 * interesting parts are the wiring: that the bar opens on its shortcut, that
 * what it makes reaches the document, and that a refused URL says so instead
 * of doing nothing.
 */

afterEach(cleanup);

function mount() {
  const initial = makeFixture();
  let doc: SpatialDocument = initial;
  const onChange = vi.fn((next: SpatialDocument) => {
    doc = next;
    view.rerender(<Workspace doc={doc} onChange={onChange} saveState="saved" />);
  });
  const view = render(<Workspace doc={initial} onChange={onChange} saveState="saved" />);

  return { initial, onChange, current: () => doc };
}

const addButton = (): HTMLElement => screen.getByRole("button", { name: /^add$/i });
const openBar = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
};
const textField = (): HTMLElement => screen.getByLabelText(/^text$/i);
const urlField = (): HTMLElement => screen.getByLabelText(/^image$/i);
const altField = (): HTMLElement => screen.getByLabelText(/image description/i);
const addFor = (field: HTMLElement): HTMLElement => {
  const form = field.closest("form");
  if (form === null) throw new Error("field is not in a form");
  const button = form.querySelector("button");
  if (button === null) throw new Error("form has no button");
  return button;
};

describe("the create bar", () => {
  it("is closed until asked for", () => {
    mount();
    expect(screen.queryByLabelText(/^text$/i)).toBeNull();
  });

  it("opens on ⌘B", () => {
    mount();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(textField()).not.toBeNull();
  });

  it("opens from the toolbar", () => {
    mount();
    openBar();
    expect(textField()).not.toBeNull();
  });
});

describe("adding text", () => {
  it("puts a node carrying the typed words into the document", () => {
    const app = mount();
    openBar();

    fireEvent.change(textField(), { target: { value: "a new thought" } });
    fireEvent.click(addFor(textField()));

    const added = Object.values(app.current().nodes).find(
      (node) => node.content.kind === "text" && node.content.text === "a new thought",
    );
    expect(added).toBeDefined();
    expect(app.current().paintOrder).toHaveLength(app.initial.paintOrder.length + 1);
  });

  it("adds nothing for empty or whitespace-only input", () => {
    const app = mount();
    openBar();

    expect((addFor(textField()) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textField(), { target: { value: "   " } });
    fireEvent.click(addFor(textField()));
    expect(app.onChange).not.toHaveBeenCalled();
  });

  it("clears the field so the next one can be typed straight away", () => {
    mount();
    openBar();
    fireEvent.change(textField(), { target: { value: "one" } });
    fireEvent.click(addFor(textField()));
    expect((textField() as HTMLInputElement).value).toBe("");
  });

  it("leaves the new node's height intrinsic", () => {
    const app = mount();
    openBar();
    fireEvent.change(textField(), { target: { value: "reflows" } });
    fireEvent.click(addFor(textField()));

    const added = Object.values(app.current().nodes).find(
      (node) => node.content.kind === "text" && node.content.text === "reflows",
    );
    expect(added?.presentations.desktop.height).toBeUndefined();
  });
});

describe("adding an image", () => {
  it("adds a node with its description", () => {
    const app = mount();
    openBar();

    fireEvent.change(urlField(), { target: { value: "https://example.com/a.jpg" } });
    fireEvent.change(altField(), { target: { value: "a described thing" } });
    fireEvent.click(addFor(urlField()));

    const added = Object.values(app.current().nodes).find(
      (node) => node.content.kind === "image" && node.content.src === "https://example.com/a.jpg",
    );
    expect(added?.content.kind === "image" && added.content.alt).toBe("a described thing");
  });

  it("refuses an unsafe scheme, and says why", () => {
    /* §11's allowlist is enforced in core; what matters here is that the
       refusal is VISIBLE. A validator that silently does nothing is
       indistinguishable from a broken button. */
    const app = mount();
    openBar();

    fireEvent.change(urlField(), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(addFor(urlField()));

    expect(app.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/https?:\/\//i);
    expect(urlField().getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the refusal once the field is edited again", () => {
    mount();
    openBar();

    fireEvent.change(urlField(), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(addFor(urlField()));
    expect(screen.queryByRole("alert")).not.toBeNull();

    fireEvent.change(urlField(), { target: { value: "https://example.com/a.jpg" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("allows an empty description, since decorative is a real answer", () => {
    const app = mount();
    openBar();

    fireEvent.change(urlField(), { target: { value: "https://example.com/b.jpg" } });
    fireEvent.click(addFor(urlField()));

    const added = Object.values(app.current().nodes).find(
      (node) => node.content.kind === "image" && node.content.src === "https://example.com/b.jpg",
    );
    expect(added).toBeDefined();
    expect(added?.content.kind === "image" && added.content.alt).toBe("");
  });
});

describe("where new nodes land", () => {
  it("puts them on top of the paint order", () => {
    /* A thing you just made and cannot find is indistinguishable from a thing
       that was never made. */
    const app = mount();
    openBar();
    fireEvent.change(textField(), { target: { value: "on top" } });
    fireEvent.click(addFor(textField()));

    const order = app.current().paintOrder;
    const last = order[order.length - 1];
    const node = last === undefined ? undefined : app.current().nodes[last];
    expect(node?.content.kind === "text" && node.content.text).toBe("on top");
  });

  it("disturbs nothing that was already there", () => {
    const app = mount();
    openBar();
    fireEvent.change(textField(), { target: { value: "harmless" } });
    fireEvent.click(addFor(textField()));

    for (const id of app.initial.paintOrder) {
      expect(app.current().nodes[id]).toEqual(app.initial.nodes[id]);
    }
  });
});
