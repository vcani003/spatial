import { useState } from "react";
import { makeFixture } from "./core/fixture";
import type { SpatialDocument } from "./core/schema";
import { Canvas } from "./editor/Canvas";

/**
 * The proof-of-concept shell.
 *
 * The document is React state HERE ONLY, and only because there is no
 * repository yet. §19 lists "persisting React state" as a trap precisely
 * because it turns renderer refactors into data migrations — so what is held
 * here is a plain `SpatialDocument` value that `core` produced and that a
 * `DocumentRepository` will hand over unchanged once it exists. Nothing about
 * the document's shape is React's.
 */
export function App() {
  const [doc, setDoc] = useState<SpatialDocument>(makeFixture);

  return <Canvas doc={doc} onChange={setDoc} />;
}
