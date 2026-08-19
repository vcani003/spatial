import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  canRedo,
  canUndo,
  commit,
  initHistory,
  redo,
  undo,
} from "./history";

/**
 * Exercised with plain numbers, not documents. Nothing in `history.ts` knows
 * what a document is, and testing it with one risks passing for a reason
 * that is true about documents rather than about the machine.
 */

describe("recording and stepping back", () => {
  it("starts with nowhere to go", () => {
    const h = initHistory(0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("walks backwards and forwards through what happened", () => {
    let h = initHistory(0);
    h = commit(h, 1);
    h = commit(h, 2);
    expect(h.present).toBe(2);

    h = undo(h);
    expect(h.present).toBe(1);
    h = undo(h);
    expect(h.present).toBe(0);
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
  });

  it("does nothing at either end rather than throwing", () => {
    const empty = initHistory(0);
    expect(undo(empty)).toBe(empty);
    expect(redo(empty)).toBe(empty);
  });

  it("ignores a commit that changes nothing", () => {
    /* Otherwise a visitor gets an undo step that appears to do nothing when
       they press it. */
    const h = commit(initHistory(0), 1);
    expect(commit(h, 1)).toBe(h);
  });

  it("abandons the redo branch once a new edit happens", () => {
    /* Keeping it would let someone redo into a state that never followed from
       what they are looking at. */
    let h = initHistory(0);
    h = commit(h, 1);
    h = commit(h, 2);
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    h = commit(h, 99);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(99);
  });
});

describe("coalescing a gesture into one step", () => {
  it("collapses consecutive commits that share a key", () => {
    /* §15's requirement. A drag emits a document per pointer frame; sixty undo
       steps to move one node back is not undo, it is punishment. */
    let h = initHistory(0);
    for (let i = 1; i <= 60; i++) h = commit(h, i, "move:a");

    expect(h.present).toBe(60);
    expect(h.past).toHaveLength(1);

    h = undo(h);
    expect(h.present).toBe(0);
  });

  it("keeps separate gestures separate", () => {
    /* The key identifies a GESTURE, not a target. Two drags of the same node
       must be two steps, which is only true if the caller gives each press its
       own key — see the gesture counter in `Canvas.tsx`. This test originally
       used different targets to tell the steps apart, which was a weaker claim
       than the one that matters. */
    let h = initHistory(0);
    h = commit(h, 1, "move:a:1");
    h = commit(h, 2, "move:a:1");
    /* A second press on the SAME node — a new gesture, so a new key. */
    h = commit(h, 3, "move:a:2");
    h = commit(h, 4, "move:a:2");

    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(0);
  });

  it("never coalesces a keyless commit", () => {
    let h = initHistory(0);
    h = commit(h, 1);
    h = commit(h, 2);
    expect(h.past).toHaveLength(2);
  });

  it("cannot coalesce across an undo", () => {
    /* THE SUBTLE ONE. Drag, undo, then drag again with the same key: if the
       key survived the undo, the new gesture would merge into the step the
       visitor just travelled back to and silently rewrite it. */
    let h = initHistory(0);
    h = commit(h, 1, "move:a");
    h = undo(h);
    expect(h.present).toBe(0);

    h = commit(h, 5, "move:a");
    expect(h.past).toHaveLength(1);

    h = undo(h);
    expect(h.present).toBe(0);
  });

  it("cannot coalesce across a redo either", () => {
    let h = initHistory(0);
    h = commit(h, 1, "move:a");
    h = undo(h);
    h = redo(h);
    h = commit(h, 2, "move:a");

    expect(h.past).toHaveLength(2);
  });
});

describe("bounded memory", () => {
  it("keeps the most recent MAX_ENTRIES and drops the oldest", () => {
    /* Losing the ability to undo something from an hour ago is a smaller
       failure than refusing to record what just happened. */
    let h = initHistory(0);
    for (let i = 1; i <= MAX_ENTRIES + 25; i++) h = commit(h, i);

    expect(h.past).toHaveLength(MAX_ENTRIES);
    expect(h.past[0]).toBe(25);
    expect(h.present).toBe(MAX_ENTRIES + 25);
  });

  it("still walks all the way back through what it kept", () => {
    let h = initHistory(0);
    for (let i = 1; i <= MAX_ENTRIES + 5; i++) h = commit(h, i);
    while (canUndo(h)) h = undo(h);
    expect(h.present).toBe(5);
  });
});

describe("it does not mutate what it is given", () => {
  it("leaves the previous history untouched", () => {
    const first = commit(initHistory(0), 1);
    const snapshot = { past: [...first.past], present: first.present, future: [...first.future] };

    commit(first, 2);
    undo(first);
    redo(first);

    expect(first.past).toEqual(snapshot.past);
    expect(first.present).toBe(snapshot.present);
    expect(first.future).toEqual(snapshot.future);
  });
});
