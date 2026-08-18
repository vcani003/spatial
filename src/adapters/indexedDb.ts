import type { DocumentId } from "../core/ids";
import type { DocumentRepository, DocumentSummary } from "../core/repository";
import { summarize } from "../core/repository";
import type { SpatialDocument } from "../core/schema";
import { deserialize, serialize } from "../core/serialize";

/**
 * =============================================================================
 * INDEXEDDB — the first real implementation of §13's repository
 * =============================================================================
 *
 * IT LIVES OUTSIDE `core` BECAUSE IT TOUCHES A BROWSER GLOBAL, which is the
 * test `core/README.md` sets: could it run in Node with no browser? This
 * could not. The interface it satisfies is domain; this file is plumbing.
 *
 * WHY INDEXEDDB AND NOT localStorage: localStorage is synchronous — it blocks
 * the main thread, which on a canvas means it blocks a drag — and it caps out
 * around 5MB of STRING. §13 also anticipates binary assets stored alongside
 * structured state, and IndexedDB holds blobs natively. Choosing the easy one
 * now would be choosing a rewrite later.
 *
 * WHAT IS STORED IS THE SERIALIZED TEXT, not a structured clone of the live
 * object. IndexedDB could store the object directly, and that would be a trap:
 * structured clone would happily persist whatever shape the app currently has,
 * INCLUDING fields a future version removed or renamed, and nothing would ever
 * pass through the validator. Writing text means every load is parsed and
 * checked by exactly the code the tests exercise.
 *
 * §13's warning about quotas is real and not yet answered: browser storage is
 * evictable and its limits vary. Structured state and binary assets are
 * already destined for separate stores; surfacing storage pressure is a later
 * task and is not pretended at here.
 */

const DB_NAME = "spatial";
const DB_VERSION = 1;
const STORE = "documents";

/**
 * IndexedDB's API is events, and everything here is promises. This is the one
 * adapter between them, so no call site below has to write `onsuccess`.
 */
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    /* The ONLY place the object store is created. Migrations of the store's
       shape — new stores, new indexes — happen here, keyed off the version,
       and are a different thing from the document schema migrations in
       `serialize.ts`. Conflating those two is how a data layer becomes
       impossible to reason about: one is the shape of the filing cabinet, the
       other is the shape of the papers. */
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Could not open the database."));
    };

    /* Another tab is holding an old version open. Rare, and silent failure
       here would look like "saving stopped working" with no explanation. */
    request.onblocked = () => {
      reject(new Error("The database is blocked by another tab."));
    };
  });
}

export class IndexedDbRepository implements DocumentRepository {
  private db: Promise<IDBDatabase> | null = null;

  /** Opened once, lazily, and reused. Opening per call would serialise every
   *  save behind a fresh connection handshake. */
  private connection(): Promise<IDBDatabase> {
    this.db ??= openDatabase();
    return this.db;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.connection();
    const transaction = db.transaction(STORE, mode);
    return promisify(body(transaction.objectStore(STORE)));
  }

  async load(id: DocumentId): Promise<SpatialDocument | null> {
    const raw = await this.run<unknown>("readonly", (store) => store.get(id));
    if (typeof raw !== "string") return null;

    const result = deserialize(raw);
    /* Same distinction the in-memory repository draws: "absent" and "present
       but unreadable" are different answers and must not collapse into one. */
    if (!result.ok) throw new Error(`Stored document ${id} is invalid: ${result.reason}`);
    return result.document;
  }

  async save(document: SpatialDocument): Promise<void> {
    await this.run("readwrite", (store) => store.put(serialize(document), document.id));
  }

  async list(): Promise<readonly DocumentSummary[]> {
    const values = await this.run<unknown[]>("readonly", (store) => store.getAll());
    const out: DocumentSummary[] = [];
    for (const raw of values) {
      if (typeof raw !== "string") continue;
      const result = deserialize(raw);
      /* A corrupt row must not make the whole list unreadable — that would
         hide every healthy document behind one bad one. Listing skips it;
         `load` is where it is reported. */
      if (result.ok) out.push(summarize(result.document));
    }
    return out;
  }

  async delete(id: DocumentId): Promise<void> {
    await this.run("readwrite", (store) => store.delete(id));
  }
}

/** Whether this browser can persist at all. */
export const hasIndexedDb = (): boolean =>
  typeof indexedDB !== "undefined" && indexedDB !== null;
