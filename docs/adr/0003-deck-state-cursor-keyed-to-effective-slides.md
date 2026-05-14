# ADR 0003: Deck-state cursor keyed to `effectiveSlides`, not `visibleSlides`

**Status:** Accepted (2026-05-14, issue #196)

## Context

Today `Deck.tsx` derives two slide arrays:

```ts
const effectiveSlides = mergeSlides(sourceSlides, manifestOverrides);
const visibleSlides = effectiveSlides.filter((s) => !s.hidden);
```

`useDeckState` is keyed to `visibleSlides`: its `cursor.slide` is an index
into the filtered array, `next`/`prev`/`goto` operate on that array, and
the `?slide=N` URL parameter is that array's index.

The new **ToC sidebar** (issue #196) introduces a navigation surface
where an **admin** must be able to click a hidden slide's row and
**navigate to that slide without un-hiding it**. With the current model
this is impossible — a hidden slide isn't in `visibleSlides`, so it has
no cursor index to `goto`.

Four options were considered:

1. **(Chosen) Re-key the cursor to `effectiveSlides`.** `next`/`prev`
   skip hidden, `goto` does not. URL `?slide=N` is the
   `effectiveSlides` index.
2. **Keep the cursor on `visibleSlides`; add a separate `gotoById`** method
   that bypasses the filter and represents hidden-slide cursors via a
   sentinel value.
3. **Two parallel cursor models keyed on role** — admin uses
   `effectiveSlides`, audience uses `visibleSlides`.
4. **Toggle un-hide on row click + restore on close** — auto-flip the
   hidden flag during admin nav.

## Decision

Re-key the cursor to `effectiveSlides`. `next`/`prev` walk the array
skipping any slide with `hidden: true`. `goto(N)` and the URL `?slide=N`
target the raw index in `effectiveSlides`. The audience render path
keeps a derived `visibleSlides` filter for the rendered viewport and the
audience ToC sidebar, but it is no longer the input to `useDeckState`.

## Consequences

### Pros

- **One cursor model for everyone.** Admin and audience both see the
  same `cursor.slide` semantics. No branching in `useDeckState`, the URL
  parser, the sessionStorage layer, or the analytics beacons.
- **Deep links survive hide/unhide flips.** `?slide=12` keeps pointing to
  "the 13th effective slide" regardless of which slides happen to be
  hidden at link-resolution time. Previously, hiding a slide would shift
  every subsequent slide's URL index by one.
- **Admin row click "just works."** `goto(effectiveIndex)` from a ToC
  row click lands on the right slide, hidden or not.
- **Reverting is straightforward.** `next` and `prev` get a small
  filter; everything else stays a thin reducer.

### Cons / things that change

- **URL meaning shifts.** Any existing bookmark / shared link pointing
  at `?slide=N` against the old visibleSlides index will resolve to a
  different slide if there are hidden slides earlier in the deck. Since
  v1 has no hidden slides in production decks, the practical breakage is
  zero, but the semantic change is permanent.
- **Audience deep-link to a hidden slide.** A handcrafted URL
  (`?slide=<hidden-index>`) sent to an audience viewer must be handled
  intentionally — clamp to the nearest non-hidden slide with a quiet
  console warning. Spec'd in the #196 PRD.
- **`useDeckState` reducer becomes slightly less pure.** `next` and
  `prev` need access to the `hidden` flags, not just `phases.length`.
  The cleanest expression is to pass the full `effectiveSlides` shape
  (id + phases + hidden) into `useDeckState` instead of just `phases[]`.

### Rejected alternatives

- **Option 2** (sentinel cursor for hidden slides) introduces a special
  case at every consumer of `cursor.slide` — analytics, presenter
  broadcast, URL serialization, persistent-storage round-tripping. The
  cursor stops being a clean integer.
- **Option 3** (role-branched cursors) doubles the test surface and
  makes the URL parameter mean different things on admin vs public
  routes, which would surprise authors who copy admin URLs into a chat
  thread.
- **Option 4** (auto-toggle hidden) is magical: the deck's manifest
  silently mutates as a side effect of navigation. Audit becomes
  impossible — was the slide hidden at the time the audience screenshot
  was taken? Who knows.

## Related

- Issue #196 — ToC sidebar (PRD pending).
- `CONTEXT.md` glossary for **Effective slides**, **Visible slides**,
  **Hidden slide**, **Sequential nav**, **ToC nav**.
- `src/framework/viewer/useDeckState.ts`, `Deck.tsx` line 199-218
  (the slide list derivation), `src/framework/viewer/Overview.tsx`
  (consumes the same arrays).
