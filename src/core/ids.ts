/**
 * Stable identity.
 *
 * WHY BRANDED STRINGS. Every id in this system is a string at runtime, and
 * nothing stops a `NodeId` being passed where an `AssetId` belongs — except
 * the type. §14.1 makes identity load-bearing: reordering, grouping, undo,
 * versioning, migrations and eventual collaboration all depend on ids being
 * stable and never being array positions. Branding is the cheapest way to
 * stop the compiler quietly agreeing to a mix-up.
 *
 * The brand exists only at compile time; `JSON.stringify` sees a plain
 * string, so persisted documents carry no trace of it.
 */

declare const brand: unique symbol;

type Branded<T extends string> = string & { readonly [brand]: T };

export type DocumentId = Branded<"DocumentId">;
export type NodeId = Branded<"NodeId">;
export type RevisionId = Branded<"RevisionId">;

/**
 * `crypto.randomUUID` where it exists, and a plain random fallback where it
 * does not.
 *
 * The fallback is NOT a security measure and does not need to be one — these
 * ids identify shapes on a canvas, they do not authenticate anything. It
 * exists so `core` keeps its promise of running under a bare Node process or
 * a test runner that has not polyfilled `crypto`.
 */
function uuid(): string {
  const c: unknown = globalThis.crypto;
  if (typeof c === "object" && c !== null && "randomUUID" in c) {
    return (c as Crypto).randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const newDocumentId = (): DocumentId => uuid() as DocumentId;
export const newNodeId = (): NodeId => uuid() as NodeId;
export const newRevisionId = (): RevisionId => uuid() as RevisionId;
