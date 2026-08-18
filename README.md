# Spatial

An infinite canvas where authors compose freely, and where **position is
presentation rather than meaning**. Built against
`spatial_product_architecture_spec_v0_2.docx`; section references below
(§4, §19, §23…) point into that document.

---

## Why this is its own repository

The obvious alternative was to build it inside `personal-space` and import
it, or ship it as an npm dependency. Both were rejected, for reasons worth
keeping written down:

**Nothing is shared, so a dependency would be pure cost.** A package
boundary exists to reuse code. The website does not need Spatial's schema,
commands or diagnostics engine — it needs to *link to* a running app. An
import would buy version bumps, build ordering and release friction in
exchange for no reuse at all.

**The two repositories want opposite characters.** `personal-space` has two
dependencies, no test runner and no linter; it is an editorial object. §20
requires round-trip serialization tests, per-version migration fixtures,
coordinate-transform tests and command/history tests *explicitly independent
of React*. Putting that apparatus in the site turns it into a tooling repo,
and drags each project's constraints across the boundary in both directions.

**One GitHub Pages deploy per repository.** Sharing one would mean every
Spatial commit republishes the personal site, and the two share a release
cycle permanently.

The website's *Project 1* route is therefore a **case study**, not an
embedded editor — which is where §24 locates the value anyway.

## The boundary that does matter

Not packages — `core` versus `editor`.

```
src/core/     framework-free. Schema, ids, geometry, and later commands,
              history, diagnostics, the repository interface, the mobile
              resolver. Runs in Node. Imports no React.
src/editor/   React, the DOM renderer, pointer gestures, and later the
              IndexedDB adapter and the panels.
```

The spec demands this split three separate times (§13, §16, §20) and warns
against collapsing it (§19, "persisting React state"). It is currently held
by convention plus the fact that `core`'s tests import no React; if it starts
to leak, an ESLint `no-restricted-imports` rule on `src/core` is the
enforcement. See `src/core/README.md`.

Workspaces were deliberately not used. Splitting into packages before
anything else consumes `core` would be the ceremony §17 warns against.

## What exists now

A thin vertical slice — the minimum schema the canvas actually exercises,
then a canvas that renders and manipulates it. Not MVP 1.

- **Minimal schema** (§14 subset): `SpatialDocument`, `SpatialNode`, text and
  image content, `presentations.desktop` geometry, `schemaVersion`,
  `revisionId`, branded ids.
- **Viewport transforms** (§23 step 3) with 10 passing tests: screen↔world
  reversibility, pan-by-screen-delta, and zoom-about-a-point including a
  60-step drift run.
- **DOM canvas** (§7): pan, trackpad zoom about the cursor, selection, drag,
  bring-to-front.
- **One mutation seam** — every change goes through `core/mutate.ts`, which is
  where the §15 command boundary lands when there is more than one kind of
  mutation to generalise from.

Deliberately deferred, all additive: semantics/reading order, visual groups,
intent and constraints, mobile overrides and provenance, assets registry,
presentation intent, diagnostics, persistence, undo/redo.

### Verified rather than assumed

- 60 screen px of drag at 1.433× zoom moves a node **41.861 world units** —
  exactly `60 / 1.43333`. The missing-division bug that makes a canvas track
  correctly at 100% and slide at every other zoom is not present.
- Zooming about (200, 150) leaves the world point under it at (199.99, 150.0).
- Zoom changes no node's stored coordinates. Presentation is not document.

## Two things the PoC already argues about the schema

1. **`paintOrder` needed its defensive name immediately.** `bringToFront` on
   click is a stacking change, and the one array was going to be read as
   reading order the moment a structure panel appeared. §21 locks these apart;
   the name is what keeps the lock honest.
2. **Text nodes carry an authored `height` that nothing enforces.** Text
   reflows and the box does not. §4.2 already anticipates this
   ("edit text content → re-measure and reflow"), so intrinsic-vs-authored
   sizing is a schema question to settle before persistence, not after.

## Next

1. Settle the text-sizing question above.
2. `DocumentRepository` + IndexedDB adapter + the §20 round-trip test.
3. Commands and history at the `mutate.ts` seam, with drag coalescing.
4. Structure panel and seeded reading order (§23 step 8).

## Testing

**Every regression gets a test, and the test must fail without the fix.** A
guard nobody has watched fail is a guard nobody knows works — the stylesheet
check in `MobilePreview.test.tsx` was verified by putting the bug back and
confirming that one test, and only that test, went red.

While the project is still being built not everything needs coverage, but the
things you touch constantly do: **viewing mobile, zoom, drag, panning.**

**Name what cannot be tested rather than faking it.** jsdom implements the DOM
but does no layout — every element measures zero, `getComputedStyle` cannot
resolve a `clamp()` from a CSS module. So the cursor-anchored zoom, the
preview's fit-to-panel scale, and "a collapsed panel gives its width back" are
all unassertable here, and each is named in the test file that would otherwise
appear to cover it. Mocking a rect to make them pass writes a test that agrees
with whatever the code currently does. Those are verified in a real browser and
the measurements recorded in the commit that changed them.

There is no separate document tracking this. The tests are the record, and each
regression's story belongs in a comment on the test that catches it.

```
src/core/*.test.ts       node, no DOM — the standing proof core is framework-free
src/editor/*.test.tsx    jsdom, opted in per file with a docblock
src/test/setup.ts        stubs for what jsdom lacks, each explaining itself
```

Two bugs were found by writing these rather than by using the app:

- **A dropped frame during drag.** `onChange` was called inside a `setView`
  updater — a side effect in React's render phase — and five pointer moves of
  +10 landed a node at +40. React may call an updater more than once or defer
  it; neither survives "and also mutate the document while you are in there".
  The zoom now comes from a ref.
- **Two assertions that passed for the wrong reason.** The canvas renders the
  same image node as the preview, so an unscoped `ByRole("img")` matched twice.

## Running it

```bash
npm install
npm run dev        # http://localhost:5174
npm test           # core tests, no browser needed
npm run typecheck
```
