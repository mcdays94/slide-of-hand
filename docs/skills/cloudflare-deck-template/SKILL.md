# Skill: cloudflare-deck-template

Build typed JSX decks for [Slide of Hand](https://slideofhand.lusostreams.com), a self-hosted deck platform on Cloudflare Workers + Static Assets. Use this skill when authoring a deck — by hand, via the in-Studio AI agent, or via an external harness (Opencode / Claude Code / Codex) pointed at <https://slideofhand.lusostreams.com/api/skills/cloudflare-deck-template>.

Every deck is a TypeScript folder under `src/decks/public/<slug>/`. There is no markdown layer, no directive registry, no descriptor schema — slides are React components and decks are typed objects. The audience of this authoring layer is "people (or agents) who write React."

---

## Why a JSX-first contract

A slide is a React component. A deck is a folder of TypeScript files. The framework primitives — `<Slide>`, `<Reveal>`, `usePhase()`, layouts, keyboard navigation, overview mode — are small, opinionated, and stay out of your way. If you want richer animation, drop down to `framer-motion`. If you want a custom layout, write JSX. The contract is what the rest of this skill describes.

What you must avoid:

- No markdown deck files. Slides are JSX.
- No directive vocabulary (`defineDirective`, descriptor schemas, palette catalogs). Those are normal React components — just import them.
- No bidirectional markdown ⇄ visual editor. Editing happens in code; the `/admin` Studio is preview + presenter mode only.

---

## The Deck contract

Every deck must default-export an object of type `Deck` from `src/decks/public/<slug>/index.tsx`:

```ts
// src/framework/viewer/types.ts (canonical types — imported by every deck)
import type { ReactNode } from "react";

export type Layout = "cover" | "section" | "default" | "full";

export interface SlideDef {
  /** Stable kebab-case id. Used in URL fragments + analytics. */
  id: string;
  /** Optional title — shown in chrome header + overview thumbnail. */
  title?: string;
  /** Layout mode. */
  layout?: Layout;
  /** Uppercase mono kicker (e.g. "LIVE DEMO"). */
  sectionLabel?: string;
  /** Section number rendered next to label (e.g. "05"). */
  sectionNumber?: string;
  /** Number of additional phase reveals before advancing to next slide. */
  phases?: number;
  /** Optional speaker notes — rendered in presenter window only. */
  notes?: ReactNode;
  /** Skip this slide entirely (drafts, parking lot, removed-but-not-deleted). */
  hidden?: boolean;
  /** Expected duration on this slide. Drives presenter pacing feedback. */
  runtimeSeconds?: number;
  /** Render function. Receives current phase. */
  render: (props: { phase: number }) => ReactNode;
}

export interface DeckMeta {
  slug: string;                  // kebab-case, matches folder name
  title: string;                 // public-facing title
  description?: string;          // one-sentence
  date: string;                  // ISO YYYY-MM-DD
  author?: string;
  event?: string;                // optional venue tag
  cover?: string;                // /public-relative path
  tags?: string[];
  runtimeMinutes?: number;
}

export interface Deck {
  meta: DeckMeta;
  slides: SlideDef[];
}
```

The slug in `meta.slug` MUST match the folder name. The build asserts this.

---

## File structure

A deck is a folder. The minimum:

```
src/decks/public/<slug>/
  meta.ts         ← eagerly loaded; just `export const meta: DeckMeta = { ... }`
  index.tsx       ← default-exports the Deck { meta, slides }
  01-title.tsx    ← named-exports a SlideDef
  02-section.tsx
  ...
```

`meta.ts` is loaded eagerly on app boot so the public index page can render deck cards without bundling slide code. `index.tsx` is loaded lazily when the visitor navigates to `/decks/<slug>`. Heavy per-deck dependencies (Three.js, topojson, etc.) end up in their own chunks and don't enter the main bundle.

Slide files use the `NN-name.tsx` convention for ordering. The number is **only for filename ordering**; the slide's `id` should be kebab-case and meaningful (`title`, `intro`, `cta`).

Example `meta.ts`:

```ts
import type { DeckMeta } from "@/framework/viewer/types";

export const meta: DeckMeta = {
  slug: "crdt-collab-editing",
  title: "CRDT-based Collaborative Editing",
  description: "How real-time multi-user editors stay consistent without a central server.",
  date: "2026-06-15",
  author: "Your Name",
  event: "Web Engineering Conf 2026",
  runtimeMinutes: 25,
};
```

Example `index.tsx`:

```tsx
import type { Deck } from "@/framework/viewer/types";
import { meta } from "./meta";
import { titleSlide } from "./01-title";
import { introSlide } from "./02-intro";
import { ctaSlide } from "./03-cta";

const deck: Deck = {
  meta,
  slides: [titleSlide, introSlide, ctaSlide],
};

export default deck;
```

Example slide:

```tsx
// src/decks/public/crdt-collab-editing/01-title.tsx
import type { SlideDef } from "@/framework/viewer/types";
import { Reveal } from "@/framework/viewer/Reveal";

export const titleSlide: SlideDef = {
  id: "title",
  title: "CRDT-based Collaborative Editing",
  layout: "cover",
  phases: 1,
  notes: (
    <>
      <p>Welcome. Tell them this is a 25-min talk.</p>
      <p>Set up: "By the end, you'll know exactly why Google Docs hasn't had a merge conflict since 2010."</p>
    </>
  ),
  render: () => (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-7xl tracking-[-0.04em] text-cf-text">
        CRDT-based Collaborative Editing
      </h1>
      <Reveal at={1}>
        <p className="text-xl text-cf-text-muted">
          How real-time editors stay consistent without a central server.
        </p>
      </Reveal>
    </div>
  ),
};
```

---

## Layouts

Four layouts. Use them as `layout: "..."` on the `SlideDef`:

| Layout | Use for | Visual treatment |
|---|---|---|
| `cover` | Title slide, conclusion slide | Large centered title, optional subtitle, generous whitespace |
| `section` | Mid-deck section dividers | Bold uppercase kicker (`sectionLabel`) + section number + headline |
| `default` | The bulk of the deck | Standard padding, slide title at top |
| `full` | Visualizations, code samples, demos | Edge-to-edge content area, no slide title chrome |

If you don't specify a layout, `default` is used.

---

## Phase reveals

Slides advance with `→` / `Space` / `Enter`. If a slide declares `phases: N`, that many additional reveals fire before the slide advances. Inside the slide, react to the phase via either:

```tsx
// Component — mounts/unmounts (causes layout shift; OK for distinct blocks):
<Reveal at={1}>
  <Card>This appears at phase 1</Card>
</Reveal>

// Hook — for inline / layout-stable / animation-driven reveals:
const phase = usePhase();
<motion.div animate={{ opacity: phase >= 2 ? 1 : 0 }}>
  Always mounted; fades in at phase 2
</motion.div>
```

Layout-stable reveals (opacity-only, no mount/unmount) are preferred when content above/below would shift.

`phases: N` means `N` *additional* reveals — the slide always starts at phase 0. So `phases: 2` means: phase 0 (initial) → phase 1 → phase 2 → advance to next slide.

---

## Design tokens

The visual identity is warm, considered, and quiet. Subtle is the brand.

**Colors** — always use Tailwind classes or CSS custom properties. Never hex:

| Token | Value | Use for |
|---|---|---|
| `text-cf-text` / `var(--color-cf-text)` | warm brown `#521000` | Body text, headings |
| `text-cf-text-muted` / `var(--color-cf-text-muted)` | softer brown | Captions, subtitles, secondary copy |
| `bg-cf-bg-100` / `var(--color-cf-bg-100)` | warm cream `#FFFBF5` | Default background |
| `bg-cf-bg-50` / `var(--color-cf-bg-50)` | lighter cream | Subtle elevation |
| `text-cf-orange` / `var(--color-cf-orange)` | Cloudflare orange `#F38020` | Accent only, used sparingly |

NEVER use pure white (`#FFFFFF`) or pure black (`#000000`).

**Typography**:

- Headings: medium weight (`font-medium`), never bold. Tight tracking (`tracking-[-0.025em]` to `tracking-[-0.04em]`).
- Body: standard weight, comfortable line-height.
- Mono for code + kickers: `font-mono`, uppercase for section labels.

**Spacing & sizing**: prefer Tailwind utilities. Use a generous scale (`gap-8`, `gap-12`, `p-12`, `p-16`).

**Hover**: the hover-affordance is `border-style: dashed`. NOT glow, NOT shadow, NOT magnetic pull, NOT jelly springs.

---

## Motion conventions

All animations use easings + presets from `@/lib/motion`. NEVER write inline easing curves like `transition={{ ease: [0.25, 0.46, 0.45, 0.94] }}` in a slide.

```tsx
import { motion } from "framer-motion";
import { easeOutExpo, fadeUpVariants, stagger } from "@/lib/motion";

<motion.div
  variants={fadeUpVariants}
  initial="hidden"
  animate="visible"
  transition={{ duration: 0.6, ease: easeOutExpo }}
>
  ...
</motion.div>
```

If you need an easing or preset that doesn't exist in `@/lib/motion`, add it there first.

---

## Keyboard shortcuts

Authored slides should not steal the framework's keyboard shortcuts. If a slide has interactive controls, mark them so the framework doesn't intercept:

- `data-no-advance` on a container suppresses click-to-advance for everything inside it.
- `data-interactive` on a focusable element suppresses keyboard nav so the control can receive its own keys.

Built-in shortcuts:

| Key | Action |
|---|---|
| `→` / `Space` / `Enter` / `PageDown` | Next phase / slide |
| `←` / `Backspace` / `PageUp` | Previous phase / slide |
| `Home` / `End` | First / last slide |
| `O` | Overview (slide grid) |
| `?` / `H` | Keyboard help |
| `F` | Fullscreen |
| `D` | Dark mode toggle |
| `P` | Open presenter window (admin only) |
| `Q` | Laser pointer (hold) |
| `W` | Magnifier (hold) |
| `E` | Marker / draw mode (toggle) |
| `Esc` | Close overlays / exit tool mode |

---

## Speaker notes

`notes` on a `SlideDef` is `ReactNode`, not a plain string. It can carry styled markup. Notes only render in the presenter window (opened via `P` for authenticated admins) and are NEVER visible to the audience.

```tsx
notes: (
  <>
    <p><strong>Energy:</strong> high. This is the "wow" moment.</p>
    <p>Numbers: 3 of 4 attendees say their team uses some form of OT.</p>
    <p>If asked "what about CRDTs vs OT?" — there's a comparison slide later, defer.</p>
  </>
),
```

---

## Anti-patterns

Things that look like they should work but don't fit the brand:

- **Markdown deck files** — slides are JSX, full stop.
- **Bold weight on headings** — medium only, tight tracking.
- **Pure white / pure black** — use `var(--color-cf-bg-100)` / `var(--color-cf-text)`.
- **Glassmorphism, glow borders, magnetic hover, jelly springs** — subtle is the brand.
- **Inline animation timings** — use `@/lib/motion`.
- **Hard-coded hex colors** — use Tailwind classes or CSS custom properties.
- **`git add -A` or `git add .` during deck PRs** — stage specific paths only.
- **A canvas-style WYSIWYG editor for slides** — explicitly out of scope. Authoring is JSX.

---

## Brand voice

- Pragmatic, technical, dry. Audience is engineers and engineering-adjacent.
- Avoid hype, avoid corporate-speak, avoid em-dashes in user-facing content (em-dashes are fine in code comments).
- Prefer specifics over abstractions. "23% of requests" not "many requests". "Workers AI" not "a serverless AI platform".
- Speaker notes can be more conversational than slide content — they're for the presenter, not the screen.

---

## Conventions checklist

When you finish authoring a deck:

- [ ] Slide IDs are kebab-case and match the file name (`01-title.tsx` → `id: "title"`).
- [ ] Deck slug is kebab-case and matches the folder name.
- [ ] `meta.ts` is separate from `index.tsx`.
- [ ] All animations use easings from `@/lib/motion`.
- [ ] All brand colors use Tailwind class or CSS variable, never hex.
- [ ] All slides export typed `SlideDef`. The deck exports a default typed `Deck`.
- [ ] Speaker notes (when present) are React nodes, not plain strings.
- [ ] No `git add -A` / `git add .` — stage specific paths only.

---

## Local development

```bash
git clone git@github.com:mcdays94/slide-of-hand.git
cd slide-of-hand
npm install
npm run dev          # http://slide-of-hand.localhost (via portless) or http://localhost:5173
```

To run the full test suite (the framework's contract tests catch slide-shape violations early):

```bash
npm test
```

To build (typecheck + Vite build):

```bash
npm run build
```

To open a deck in the presenter window: navigate to `/decks/<slug>`, press `P`. Presenter window only opens for authenticated admins (Cloudflare Access).

---

## Further reference

| When you need… | Where to look |
|---|---|
| The canonical `DeckMeta` + `SlideDef` types | `src/framework/viewer/types.ts` |
| The easing + variant presets | `src/lib/motion.ts` |
| The built-in `Reveal` component | `src/framework/viewer/Reveal.tsx` |
| The `usePhase()` hook | `src/framework/viewer/PhaseContext.tsx` |
| Existing decks to imitate | `src/decks/public/*/` |
| The deck contract test | `tests/decks-registry.test.ts` |
| The full convention spec | [AGENTS.md](https://github.com/mcdays94/slide-of-hand/blob/main/AGENTS.md) |

If a convention isn't covered here and you're unsure, read `AGENTS.md` in the repo root — it's the canonical spec for both human and AI contributors.

---

## Existing decks (live scan)

The list of decks below is regenerated on every build by `scripts/build-deck-snapshot.mjs`, which scans `src/decks/public/*/meta.ts` files. New decks land in this list the next time the Worker is deployed.

<!-- DECK-LIST-MARKER: composed at request time by worker/skill-composer.ts -->
