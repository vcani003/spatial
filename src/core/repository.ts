import type { DocumentId } from "./ids";
import type { SpatialDocument } from "./schema";

/**
 * §13's repository abstraction.
 *
 * THE POINT IS THE DEPENDENCY DIRECTION. Nothing above this interface knows
 * whether a document came from memory, from IndexedDB, or one day from an API
 * over a network. Storage is the detail; the domain is not. Get that backwards
 * — let the editor call IndexedDB directly — and adding a backend later means
 * touching every component that ever saved anything.
 *
 * IT LIVES IN `core` AND ITS IMPLEMENTATIONS MOSTLY DO NOT. The interface is
 * a domain concept and stays framework-free; the IndexedDB adapter touches a
 * browser global and therefore belongs in `src/adapters`. `InMemoryRepository`
 * below is the exception — it is pure, it needs nothing, and it is what the
 * tests run against.
 */
export interface DocumentRepository {
  load(id: DocumentId): Promise<SpatialDocument | null>;
  save(document: SpatialDocument): Promise<void>;
  list(): Promise<readonly DocumentSummary[]>;
  delete(id: DocumentId): Promise<void>;
}

export interface DocumentSummary {
  readonly id: DocumentId;
  readonly revisionId: string;
  readonly nodeCount: number;
}

export const summarize = (document: SpatialDocument): DocumentSummary => ({
  id: document.id,
  revisionId: document.revisionId,
  nodeCount: Object.keys(document.nodes).length,
});

/**
 * A repository that forgets everything when the tab closes.
 *
 * NOT A MOCK — it implements the real contract, including the part that
 * matters most: IT STORES SERIALIZED TEXT, not the object it was handed. A
 * naive in-memory store that keeps the reference would pass every round-trip
 * test while proving nothing, because nothing would ever have been through
 * `serialize`/`deserialize`. Storing the string is what makes this a genuine
 * stand-in for a disk.
 */
export class InMemoryRepository implements DocumentRepository {
  private readonly store = new Map<string, string>();

  constructor(private readonly codec: {
    serialize: (d: SpatialDocument) => string;
    deserialize: (raw: string) => { ok: true; document: SpatialDocument } | { ok: false; reason: string };
  }) {}

  load(id: DocumentId): Promise<SpatialDocument | null> {
    const raw = this.store.get(id);
    if (raw === undefined) return Promise.resolve(null);

    const result = this.codec.deserialize(raw);
    /* A stored document that will not parse is a real failure and is thrown
       rather than returned as `null`. "Not found" and "found, and corrupt"
       are different problems with different answers, and collapsing them
       loses the only chance to say which one happened. */
    if (!result.ok) throw new Error(`Stored document ${id} is invalid: ${result.reason}`);
    return Promise.resolve(result.document);
  }

  save(document: SpatialDocument): Promise<void> {
    this.store.set(document.id, this.codec.serialize(document));
    return Promise.resolve();
  }

  list(): Promise<readonly DocumentSummary[]> {
    const out: DocumentSummary[] = [];
    for (const raw of this.store.values()) {
      const result = this.codec.deserialize(raw);
      if (result.ok) out.push(summarize(result.document));
    }
    return Promise.resolve(out);
  }

  delete(id: DocumentId): Promise<void> {
    this.store.delete(id);
    return Promise.resolve();
  }
}
