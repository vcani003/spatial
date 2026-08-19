/**
 * =============================================================================
 * UNDO / REDO — §15's history, and the coalescing that makes it usable
 * =============================================================================
 *
 * §15 requires every mutation to pass through one boundary so that history,
 * persistence and derived state can all react to the same event. `mutate.ts`
 * is that boundary; this is the history that hangs off it.
 *
 * ── SNAPSHOTS, NOT INVERSE COMMANDS ─────────────────────────────────────────
 *
 * The textbook approach is a command object per action with an `undo()` that
 * reverses it. That earns its complexity when documents are large or mutable.
 * Here a document is already an immutable VALUE — every function in `mutate.ts`
 * returns a new one and shares the untouched parts structurally — so keeping
 * the previous value IS the undo, and it cannot drift from the forward
 * operation the way a hand-written inverse can.
 *
 * The cost is memory, which is why there is a cap. When a document gets big
 * enough for that to bite, this file changes and nothing above it does.
 *
 * ── COALESCING IS THE POINT ─────────────────────────────────────────────────
 *
 * §15: "Continuous drag/resize frames coalesce into one undoable transaction."
 * A drag emits a document per pointer frame — sixty an undo step would be
 * sixty presses of ⌘Z to move one node back, which is not undo, it is
 * punishment.
 *
 * So a commit may carry a KEY. Consecutive commits with the same key replace
 * the present instead of pushing a new entry, which makes one gesture one
 * step. The key is the gesture's identity — `move:<nodeId>` — so dragging A,
 * then B, then A again is three steps rather than one, because the keys
 * differ in between.
 *
 * Generic in `T` on purpose: nothing here knows what a document is, so the
 * tests exercise the machine with plain numbers and cannot accidentally pass
 * because of something true about documents.
 */

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /**
   * The key of the most recent commit, or null if the last thing that happened
   * was an undo, a redo, or a keyless commit.
   *
   * Cleared by undo and redo so that a gesture, an undo, and then the SAME
   * gesture again cannot coalesce across the undo — which would silently
   * rewrite the step the visitor just travelled back to.
   */
  readonly lastKey: string | null;
}

/**
 * How many steps back you can go.
 *
 * 100 is far past what anyone reaches for and keeps the memory bounded. The
 * oldest entry is dropped rather than refusing the commit: losing the ability
 * to undo something from an hour ago is a smaller failure than refusing to
 * record what just happened.
 */
export const MAX_ENTRIES = 100;

export const initHistory = <T,>(present: T): History<T> => ({
  past: [],
  present,
  future: [],
  lastKey: null,
});

export const canUndo = <T,>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T,>(history: History<T>): boolean => history.future.length > 0;

/**
 * Records a new state.
 *
 * @param key optional gesture identity. Consecutive commits sharing a key
 *            collapse into one undoable step.
 */
export function commit<T>(history: History<T>, next: T, key?: string): History<T> {
  /* Nothing changed. Recording it would put an undo step in front of the
     visitor that appears to do nothing when they press it. */
  if (next === history.present) return history;

  const coalescing = key !== undefined && key === history.lastKey;

  const past = coalescing
    ? history.past
    : [...history.past, history.present].slice(-MAX_ENTRIES);

  return {
    past,
    present: next,
    /* Any new edit abandons the redo branch. Keeping it would let a visitor
       redo their way into a state that never followed from what they are
       looking at. */
    future: [],
    lastKey: key ?? null,
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastKey: null,
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;

  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
    lastKey: null,
  };
}
