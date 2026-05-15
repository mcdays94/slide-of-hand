# Slide of Hand

The deck platform's domain language. Created lazily during the grilling of
issue #196 (ToC sidebar). Extend it inline whenever a new term gets resolved
through grill-with-docs sessions.

## Language

### Slides and visibility

**Slide**:
A single React-rendered screen in a deck. Each slide exposes a typed
`SlideDef` with `id`, optional `title`, `layout`, `phases`, `notes`, etc.
_Avoid_: "page", "frame".

**Phase reveal**:
An additional in-slide reveal triggered by `→` before the next slide
advances. A slide with `phases: N` requires N+1 `→` presses to leave.
_Avoid_: "step", "fragment".

**Hidden slide**:
A slide flagged `hidden: true` either in source (`SlideDef.hidden`) or via a
runtime manifest override. Skipped by **sequential nav** for ALL users.
Completely invisible to **audience** (filtered from ToC sidebar AND from the
rendered viewport). Visible to **admin** in the ToC sidebar with a muted /
strike-through styling, and navigable via **ToC nav**. Useful for drafts,
parking-lot content, or supporting slides held in reserve for audience Q&A.
_Avoid_: "removed", "deleted", "draft slide" (a draft has its own meaning
on the Studio side via `meta.draft?: boolean` — see #191 / #194).

**Section slide**:
A slide that declares `sectionLabel` / `sectionNumber` — visually serves as
a chapter divider in the deck. Not architecturally distinct from a regular
slide; the markers just drive presentation.

### Deck lifecycle

**Draft deck**:
A deck-level work-in-progress state represented by `meta.draft?: true`. Draft
decks are visible to **admin** on `/admin` and hidden from the public homepage.
When published through the GitHub flow, `runPublishDraft` flips the deck back
to `draft: false` so it can appear publicly once merged and deployed.
_Avoid_: "hidden deck" (Hidden is slide-level), "archived deck" (Archived is
a retired deck lifecycle state).

**Archived deck**:
A retired deck that should not appear on the public homepage and should return
404 on the **public route**. Source-backed archived decks live under
`src/decks/archive/<slug>/`; active source-backed decks live under
`src/decks/public/<slug>/`. KV-backed archived decks use
`meta.archived: true` on the deck record and index summary. Archived decks
appear in a separate archived section on `/admin`, can be previewed read-only,
and can be restored or deleted from the app. Restoring a source-backed archived
deck opens a draft PR that moves it back to `src/decks/public/<slug>/`;
restoring a KV-backed archived deck flips `meta.archived` back off.
Archived wins over Draft for placement: a deck that is both `draft: true` and
archived belongs in the Archived section and is public-404.
Archive preserves runtime side data such as manifest overrides, notes, and
analytics so Restore can bring the deck back intact. Delete is destructive and
clears deck side data such as manifest overrides and deck KV records; analytics
may remain only where it is already stored as aggregate history. For
source-backed Delete, side data is cleared only after the delete PR is merged
and deployed, not while the source action is merely pending.
_Avoid_: "draft" (a draft is still being built), "hidden" (Hidden is
slide-level), "deleted" (Archived is reversible).

**Pending source action**:
A source-backed Archive / Restore / Delete action that has opened a GitHub
draft PR but has not yet been merged and redeployed. The admin UI may
optimistically move or remove the deck, but must show a **Pending merge/deploy**
pill until the deployed source registry matches the requested action. Pending
source actions are persisted in KV so the state survives reloads. A pending
source Delete appears in the Archived section with a **Pending delete** pill so
the action remains visible until the GitHub PR is merged and production catches
up. Clearing a pending source action in v1 removes only the KV pending marker;
it does not close the GitHub PR.
_Avoid_: "synced" unless the deployed source tree has actually caught up.

### Navigation

**Sequential nav**:
Navigation driven by `→` / `←` / `Space` / `Enter` / `PageDown` / `PageUp` /
`Home` / `End` and by click-to-advance on the slide surface. Skips hidden
slides for all users.
_Avoid_: "linear nav", "keyboard nav" (overloaded with the broader keyboard
shortcut surface).

**ToC nav**:
Navigation driven by clicking a row in the **ToC sidebar**. Does NOT skip
hidden slides for **admin** — admin can land on a hidden slide via ToC
click. Does not even surface hidden slides to **audience**, so audience ToC
nav still respects the hidden-slide invisibility.
_Avoid_: "jump nav".

**Deep link**:
A `?slide=N&phase=K` URL that targets a specific cursor position. After the
useDeckState refactor (ADR upcoming), `N` is the index in
**effective slides** — i.e. stable across hide/unhide flips.

### Viewer roles + routes

**Public route**:
`/decks/<slug>`. The audience-facing viewer. Not Access-protected. Hosts
the **audience** role by default.

**Admin route**:
`/admin/decks/<slug>`. The author-facing viewer + Studio. Cloudflare
Access-protected at the edge. Hosts the **admin** role.

**Audience**:
A viewer of a deck on the **public route**. Sees only non-hidden slides
everywhere (rendered viewport, ToC sidebar, Overview). Sees no admin
affordances in the ToC sidebar — only "click row to navigate".
_Avoid_: "viewer" (overloaded with the `<Deck>` viewer component);
"public user" (ambiguous re: auth vs route).

**Admin**:
A viewer of a deck on the **admin route**. Sees ALL slides in the ToC
sidebar (hidden ones muted/strike-through). Can drag-reorder, toggle
hide, rename, edit notes inline. Can ToC-nav to a hidden slide while it
remains hidden. Implies Access-authenticated (admin route is
Access-protected), but the operational signal in code is the route, not
the auth check. The codebase calls the React context for this
`usePresenterMode()` — historical name; see "Flagged ambiguities".

### Surfaces

**ToC sidebar**:
The left/right-edge-deployable slide list. Audience-mode = read-only TOC
(row click navigates). Admin-mode = TOC + inline editor (drag-reorder /
hide / rename / notes). Implemented by `src/framework/viewer/SlideManager.tsx`
(historical filename — keeps the same component, evolves its scope).
_Avoid_: "slide manager" (the user-facing name is ToC sidebar, even if
the code retains the older identifier); "drawer".

**Overview**:
The modal slide-thumbnail grid triggered by `O`. Distinct from the ToC
sidebar — covers the whole viewport instead of slotting against one edge.
Sibling discovery surface; not being replaced by the ToC sidebar.

### Persistence

**Manifest override**:
A per-deck `manifest:<slug>` KV entry under the `MANIFESTS` namespace.
Layered on top of the source slide list at runtime (`mergeSlides`) to
apply reorder + hide + rename + notes overrides without source edits.
Authored via the **ToC sidebar** (admin mode), persisted via
`POST /api/admin/manifests/<slug>`.

**Effective slides**:
The result of `mergeSlides(sourceSlides, manifestOverrides)` — the
ordered slide list as the deck currently behaves at runtime. Includes
hidden slides. Authoritative input for `useDeckState` (post-refactor).
_Avoid_: "merged slides".

**Visible slides** (deprecated post-refactor):
Today: `effectiveSlides.filter(s => !s.hidden)`. After the
useDeckState refactor described under ADR #0003 (forthcoming), this
filtered array stops being the input to navigation state, becoming
purely a presentation-layer filter for the audience render path.

## Relationships

- A **Deck** has many **Slides**, ordered.
- A **Slide** belongs to exactly one **Deck**.
- A **Slide** may be flagged **Hidden** (source or manifest override).
- A **Manifest override** belongs to exactly one **Deck**.
- An **Audience** sees only non-hidden **Slides** of a **Deck**.
- An **Admin** sees all **Slides** of a **Deck** in the **ToC sidebar**, with
  hidden ones visually muted.
- **Sequential nav** skips **Hidden Slides** for everyone.
- **ToC nav** skips **Hidden Slides** for **Audience** only.

## Example dialogue

> **Author:** "I want to demo the new pricing slide tomorrow but keep it out
> of today's deck. Can I just hide it?"
> **Dev:** "Yep — flip its **hidden** flag in the **ToC sidebar**. **Audience**
> won't see it in the ToC or via `→`. You'll still see it muted in your ToC
> sidebar on the admin route, and you can click the row to navigate to it
> directly if anyone in today's audience asks about pricing."

## Flagged ambiguities

- **"Presenter mode"** in the code (`usePresenterMode`,
  `<PresenterModeProvider>`) actually means **"on the admin route"**, not
  literally "logged in via Cloudflare Access". The two are tightly
  correlated (admin route is Access-protected), but an Access-authenticated
  user on the public route is still `presenterMode = false`. New code
  should keep using `usePresenterMode()` (rename is out of scope) but
  describe it as the **admin-route signal**, not as auth.
- **"Hidden"** has two meaning levels: at the **`SlideDef.hidden`** source
  level (author intent baked into deck source) and at the **manifest
  override** level (runtime flip persisted in KV). The runtime layer wins
  when present. Both produce the same visibility semantics defined above.
- **"Draft"** is not the same as **Hidden**. `meta.draft?: boolean`
  (introduced in #194) is a deck-level flag for Studio drafts; **Hidden**
  is a per-slide visibility flag. Don't conflate.
