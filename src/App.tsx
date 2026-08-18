import { useMemo } from "react";
import { InMemoryRepository } from "./core/repository";
import { deserialize, serialize } from "./core/serialize";
import { IndexedDbRepository, hasIndexedDb } from "./adapters/indexedDb";
import { Workspace } from "./editor/Workspace";
import { useDocument } from "./useDocument";

/**
 * The shell.
 *
 * IT CHOOSES A REPOSITORY AND THEN FORGETS WHICH ONE. Everything below takes
 * the `DocumentRepository` interface, so IndexedDB, the in-memory fallback,
 * and a future API adapter are interchangeable here and invisible everywhere
 * else — which is the whole return on §13's abstraction.
 *
 * The fallback matters: private browsing and some embedded webviews have no
 * IndexedDB at all. The honest response is a canvas that works and does not
 * persist, not a canvas that fails to start.
 */
export function App() {
  const repository = useMemo(
    () => (hasIndexedDb() ? new IndexedDbRepository() : new InMemoryRepository({ serialize, deserialize })),
    [],
  );

  const { document, saveState, change } = useDocument(repository);

  /* Nothing is rendered until there is a document. It is one IndexedDB read,
     so this is a frame or two — a spinner would flash and say nothing. */
  if (document === null) return null;

  return <Workspace doc={document} onChange={change} saveState={saveState} />;
}
