# core — the framework-free half

Nothing in this directory may import React, touch the DOM, or read
`window`. That is not a style preference; it is the spec's requirement,
stated three separate times:

- §20 — "Command/history tests independent of React."
- §13 — a `DocumentRepository` abstraction so IndexedDB can be swapped for
  an API without the domain noticing.
- §16 — the intelligence layer proposes *intent*; deterministic code owns
  schema validity, rendering and publish integrity.
- §19 — "Persisting React state → renderer refactors become data
  migrations."

The test for whether something belongs here is simple: **could it run in
Node with no browser at all?** Geometry, schema, identity, ordering,
validation, diagnostics and the mobile resolver all can. Anything that
needs a pointer, an element, or a frame belongs in `../editor`.

The boundary is currently held by convention and by the fact that
`core`'s tests import no React. If it ever starts leaking, an ESLint
`no-restricted-imports` rule on this directory is the enforcement.
