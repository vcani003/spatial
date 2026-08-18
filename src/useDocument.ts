import { useCallback, useEffect, useRef, useState } from "react";
import { makeFixture } from "./core/fixture";
import type { DocumentRepository } from "./core/repository";
import type { SpatialDocument } from "./core/schema";

/**
 * THE DOCUMENT, AND ITS TRIP TO AND FROM STORAGE.
 *
 * The only React that knows a repository exists. Everything below it takes a
 * plain `SpatialDocument` value, which is what keeps §19's trap — "persisting
 * React state" — closed: what is written is the domain document `core`
 * produced, never a component's state shape.
 *
 * ── SAVES ARE DEBOUNCED, AND THAT IS NOT AN OPTIMISATION ────────────────────
 *
 * A drag emits a document per pointer frame. Writing each one would put an
 * IndexedDB transaction on every frame of a gesture — the storage layer
 * fighting the interaction layer for the main thread, which is exactly the
 * stutter people blame on canvases.
 *
 * So the newest document is held in a ref and written once the gesture stops.
 * §15 makes this temporary and says why: continuous drag frames should coalesce
 * into ONE undoable transaction, and when the command boundary lands it will
 * know where a gesture ends. Until then, a quiet interval is the best available
 * guess at the same boundary.
 *
 * THE LAST WRITE IS THE ONE THAT MATTERS, so the timer is also flushed when the
 * page is hidden — closing a tab mid-debounce must not discard the last second
 * of work, and `visibilitychange` is the only lifecycle event mobile browsers
 * reliably deliver before tearing a page down.
 */

const SAVE_DEBOUNCE_MS = 400;

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useDocument(repository: DocumentRepository) {
  const [document, setDocument] = useState<SpatialDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const pending = useRef<SpatialDocument | null>(null);
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    setSaveState("saving");
    repository.save(next).then(
      () => {
        setSaveState("saved");
      },
      (error: unknown) => {
        /* Reported, never swallowed. A canvas that has silently stopped saving
           looks identical to one that is saving fine. */
        console.error("Could not save the document.", error);
        setSaveState("error");
      },
    );
  }, [repository]);

  /* Open whatever is stored, or seed a fixture on a first visit.
     `list()` then `load()` rather than a remembered id, because there is no
     "last opened document" concept yet and inventing one before there are
     multiple documents would be guessing at a UI that does not exist. With a
     single document the first summary IS the document. */
  useEffect(() => {
    let cancelled = false;

    const open = async (): Promise<void> => {
      const summaries = await repository.list();
      const first = summaries[0];
      const stored = first === undefined ? null : await repository.load(first.id);
      if (cancelled) return;

      if (stored !== null) {
        setDocument(stored);
        return;
      }

      /* Nothing stored: seed, and write it immediately so the next load has
         something to find. Seeding without saving would hand a fresh fixture
         to every visit and quietly discard the previous one. */
      const seed = makeFixture();
      setDocument(seed);
      pending.current = seed;
      flush();
    };

    open().catch((error: unknown) => {
      /* Storage refused — private browsing, a blocked database, a corrupt
         row. The canvas still works; it just will not persist, which is far
         better than a blank screen. */
      console.error("Could not open a stored document; starting fresh.", error);
      if (!cancelled) setDocument(makeFixture());
    });

    return () => {
      cancelled = true;
    };
  }, [repository, flush]);

  /* Flush on the way out, whichever way that is. */
  useEffect(() => {
    const onHidden = () => {
      if (window.document.visibilityState === "hidden") flush();
    };
    window.document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, [flush]);

  const change = useCallback(
    (next: SpatialDocument) => {
      setDocument(next);
      pending.current = next;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  return { document, saveState, change };
}
