# Agents in Slide of Hand

Orientation for AI agents (Claude / OpenCode / Cursor / Aider / …) starting a session in this repo. Read once at session start; return only when stuck.

Slide of Hand is built on the principle that **agents are first-class deck authors**. The whole platform is shaped to make `prompt → JSX → animated deck` a fluent loop — no markdown vocabulary, no directive registry, no descriptor schema. A slide is a React component. A deck is a folder of TypeScript files. The framework is small, opinionated, and stays out of your way.

---

## What Slide of Hand is, in one paragraph

A self-hosted deck platform that runs on Cloudflare Workers + Static Assets. Each deck is `src/decks/<visibility>/<slug>/index.tsx` and exports a typed `DeckMeta` plus an array of `SlideDef`s. The deployed app exposes a public landing page at `/` (lists `decks/public/*`), a viewer at `/decks/<slug>`, and an Access-protected `/admin` for editing and presenter ergonomics. Customer-specific or under-NDA decks live in `decks/private/*` (gitignored, local-only). The framework primitives — `<Slide>`, `<Reveal>`, `usePhase()`, layouts, keyboard navigation, overview mode — are small, opinionated, and stay out of your way.

**Production:** <https://slideofhand.lusostreams.com> · `/admin/*` gated by Cloudflare Access · deploy + Access runbook lives at [`docs/deploy.md`](docs/deploy.md).

---

## Status

**v1.** Wave 1–3 are merged (scaffold, framework + hello deck, public index, admin viewer, presenter window + speaker notes, presentation tools). Wave 4 / Slice 7 wires up the production custom domain + Cloudflare Access (issue #8). The PRD lives at GitHub issue #1.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | React 19 |
| Build tool | Vite 6 |
| Language | TypeScript 5.7 (`"strict": true`) |
| Styling | Tailwind 4 + CSS custom properties for design tokens |
| Animation | Framer Motion 12 — easings + presets in `src/lib/motion.ts`, never inline |
| Routing | React Router v6 — **path**-based URLs (no hash router) |
| Tests | Vitest 3 (vitest@2 collides with vite@6 type-wise; pin `^3.x`) |
| Backend | Cloudflare Workers + Static Assets binding |
| Deploy | Wrangler 4 (`wrangler.jsonc`, JSON-with-comments) |

No state stores in v1: no R2, no Durable Objects, no Hyperdrive, no D1. Add only when a specific deck demonstrably needs it. Default deck = pure static, served from the Static Assets binding.

---

## Repository layout

```
.
├── AGENTS.md                       ← you are here
├── README.md                       ← public-facing
├── LICENSE                         ← MIT
├── package.json
├── wrangler.jsonc                  ← Worker config + Static Assets binding
├── vite.config.ts
├── vitest.config.ts                ← (or vitest in vite.config.ts)
├── tailwind.config.ts              ← Tailwind v4 config (root, not under framework/)
├── tsconfig.json (+ app, node)
├── index.html
├── public/                         ← static assets (favicon, fonts, images)
├── worker/                         ← Cloudflare Worker
│   └── index.ts                    ← serves Static Assets + API endpoints
├── src/
│   ├── main.tsx                    ← entry: <RouterProvider>
│   ├── routes/
│   │   ├── _layout.tsx             ← shared shell
│   │   ├── index.tsx               ← `/` — public deck index
│   │   ├── deck.$slug.tsx          ← `/decks/<slug>` — viewer
│   │   └── admin/                  ← `/admin/*` — Access-gated
│   ├── framework/
│   │   ├── viewer/                 ← <Deck>, <Slide>, navigation, overlays
│   │   │   ├── Deck.tsx
│   │   │   ├── Slide.tsx
│   │   │   ├── Overview.tsx
│   │   │   ├── KeyboardHelp.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── PhaseContext.tsx    (`usePhase()`)
│   │   │   ├── Reveal.tsx          (`<Reveal at={N}>`, `<RevealInline>`)
│   │   │   ├── useDeckState.ts
│   │   │   └── types.ts            (`SlideDef`, `DeckMeta`, `Layout`)
│   │   ├── presenter/              ← presenter window
│   │   │   ├── PresenterWindow.tsx
│   │   │   ├── SpeakerNotes.tsx
│   │   │   └── broadcast.ts        (BroadcastChannel sync)
│   │   └── tools/                  ← presentation overlays
│   │       ├── Magnifier.tsx
│   │       ├── Laser.tsx
│   │       ├── Marker.tsx
│   │       └── AutoHideChrome.tsx
│   ├── lib/
│   │   ├── motion.ts               ← easings, presets
│   │   ├── decks-registry.ts       ← `import.meta.glob` auto-discovery
│   │   └── routes.ts               ← path constants
│   ├── components/                 ← cross-deck shared components (sparingly)
│   ├── styles/
│   │   └── index.css               ← Tailwind v4 entry + design-token `@theme` block (canonical token home)
│   └── decks/
│       ├── public/
│       │   ├── hello/index.tsx     ← demo deck (always present)
│       │   └── <slug>/index.tsx    ← additional public decks (one folder each)
│       └── private/                ← gitignored
│           ├── .gitkeep
│           └── <slug>/index.tsx    ← author-only decks (run via `npm run dev`)
└── tests/                          ← Vitest unit tests
```

---

## The deck contract

Every deck exports a default object of type `Deck`:

```ts
// src/framework/viewer/types.ts
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
  /** Stable kebab-case slug. Matches the folder name; used in URL path. */
  slug: string;
  /** Public-facing title — shown on the index page + page <title>. */
  title: string;
  /** One-sentence description. Shown on the index card. */
  description: string;
  /** ISO date string (YYYY-MM-DD). Used for sort + display on index. */
  date: string;
  /** Author name(s). */
  author?: string;
  /** Optional venue / event tag (e.g. "DTX Manchester 2026"). */
  event?: string;
  /** Cover image path (relative to /public). */
  cover?: string;
  /** Categorization hook for future filtering on the index. */
  tags?: string[];
  /** Total expected talk runtime, in minutes. Shown on index card + drives presenter timer. */
  runtimeMinutes?: number;
}

export interface Deck {
  meta: DeckMeta;
  slides: SlideDef[];
}
```

A deck file:

```tsx
// src/decks/public/hello/index.tsx
import type { Deck } from "@/framework/viewer/types";
import { titleSlide } from "./01-title";
import { secondSlide } from "./02-second";

const deck: Deck = {
  meta: {
    slug: "hello",
    title: "Hello, Slide of Hand",
    description: "A two-slide demo to prove the framework works.",
    date: "2026-05-01",
    author: "Miguel Caetano Dias",
  },
  slides: [titleSlide, secondSlide],
};

export default deck;
```

Slide files use the `NN-name.tsx` numbering convention for ordering inside the folder:

```tsx
// src/decks/public/hello/01-title.tsx
import type { SlideDef } from "@/framework/viewer/types";
import { Reveal } from "@/framework/viewer/Reveal";

export const titleSlide: SlideDef = {
  id: "title",
  title: "Hello, Slide of Hand",
  layout: "cover",
  phases: 1,
  notes: (
    <>
      <p>Welcome the audience.</p>
      <p>Mention the talk runtime: ~20 min.</p>
    </>
  ),
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <h1 className="text-7xl tracking-[-0.04em]">Hello, Slide of Hand</h1>
      <Reveal at={1}>
        <p className="text-xl text-cf-text-muted">JSX-first slides.</p>
      </Reveal>
    </div>
  ),
};
```

---

## Visibility model

| Folder | Committed? | Listed at `/`? | Served at `/decks/<slug>`? | Bundled in `npm run build`? |
|---|---|---|---|---|
| `src/decks/public/<slug>/` | ✅ | ✅ | ✅ | ✅ |
| `src/decks/private/<slug>/` | ❌ (gitignored) | ❌ | ❌ (not in deployment bundle) | ❌ |

Private decks **only run via `npm run dev`** on the author's machine. They are not part of the deployed app under any circumstance. Customer-specific or under-NDA content goes here.

The viewer always uses the same routes and chrome whether a deck is public or private — only the build pipeline differs (Vite bundles `src/decks/public/*` always; `private/*` only in dev mode).

The `/admin` route is a Cloudflare Access app — set up via the Cloudflare dashboard before first deploy. The Worker does not need to validate JWTs itself; Access enforces at the edge.

---

## Adding content

### Add a slide to an existing deck

1. Create `src/decks/<visibility>/<slug>/NN-name.tsx`. Pick `NN` to slot the slide where you want it in the order.
2. Export a named `SlideDef`.
3. Import + insert it into `src/decks/<visibility>/<slug>/index.tsx` at the right array index.
4. Reload the dev server. The keyboard `O` key shows the overview.

### Add a new deck

1. Create `src/decks/public/<slug>/index.tsx` (or `private/`).
2. Export a default `Deck` object with `meta` + `slides`.
3. The deck registry auto-discovers via `import.meta.glob('./decks/{public,private}/*/index.tsx')`. No manual registration anywhere.
4. The slug in `meta.slug` MUST match the folder name; build asserts this.

---

## Phase reveals

Slides advance with `→` / `Space` / `Enter`. If the slide declares `phases: N`, the keypress advances `phase` from 0 → N before moving to the next slide. Inside the slide, react to phase via either:

```tsx
// Component — mounts/unmounts (causes layout shift; OK for distinct blocks):
<Reveal at={1}>
  <Card>This appears at phase 1</Card>
</Reveal>

// Hook — for inline / layout-stable / animation-driven reveals:
const phase = usePhase();
<motion.div animate={{ opacity: phase >= 2 ? 1 : 0 }}>...</motion.div>
```

Layout-stable reveals (opacity-only, no mount/unmount) are preferred when content above/below would shift.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `→` / `Space` / `Enter` / `PageDown` | Next phase / slide |
| `←` / `Backspace` / `PageUp` | Previous phase / slide |
| `Home` / `End` | First / last slide |
| `O` | Overview (slide grid) |
| `?` / `H` | Keyboard help |
| `F` | Fullscreen |
| `D` | Dark mode toggle |
| `P` | Open presenter window |
| `Q` | Laser pointer (hold) |
| `W` | Magnifier (hold) |
| `E` | Marker / draw mode (toggle) |
| `Esc` | Close overlays / exit tool mode |

`data-no-advance` on a passive container suppresses click-to-advance. `data-interactive` on an active control (button, select, link) ALSO suppresses keyboard nav (so a focused control can receive its own keys).

---

## The Pocock workflow

This repo is built using the [Pocock orchestrator](https://github.com/mcdays94/pocock-agents) — a skill-driven pipeline that turns ideas into shipped code via:

1. **Grill** the idea (interrogate via `grill-me` skill).
2. **Design** + write a **PRD** (`write-a-prd` skill, files PRD as a GitHub issue).
3. **Plan**: break PRD into vertical-slice issues (`prd-to-issues`).
4. **Build**: dispatch `pocock-worker` subagents in parallel waves, one issue per worker, each on its own git worktree.

For Wave 1, the worker must:
- Operate strictly within the assigned worktree (`/tmp/pocock-workers/slide-of-hand/<branch-slug>/`).
- Start its own dev server on the assigned port (`--host=127.0.0.1 --port=N`).
- Use the snap → read → fix → snap visual TDD loop for any UI work.
- Commit specific files (NEVER `git add -A`).
- Push the sub-branch.
- Hand back a structured summary; the orchestrator integrates via cherry-pick.

See [`mcdays94/pocock-agents`](https://github.com/mcdays94/pocock-agents) for full orchestrator + worker conventions.

---

## Branch / PR discipline

1. **Never commit to `main` directly.** Always branch off `main` for any unit of work.
2. **Never run `git add -A` or `git add .`.** Stage specific paths. The few extra keystrokes prevent unrelated work from being bundled into your commit.
3. **Never merge a PR yourself.** That's the user's call after review.
4. **Push your branch and open a draft PR.** CI runs the build + test gate; the user has a single URL to review.
5. **Conventional commit messages.** Examples:
   - `feat(framework): add Reveal primitive`
   - `feat(deck/<slug>): port slides 1–5`
   - `fix(presenter): broadcast channel race when window opens late`
   - `chore(scaffold): bootstrap Vite + Wrangler`

---

## Verification

The honest minimum after any non-trivial change:

```bash
npm test              # vitest run
npm run build         # tsc -b && vite build
npm run typecheck     # tsc --noEmit (alias)
```

For UI changes, also visually verify with a Playwright snap (write to `scripts/tmp-*.mjs`, delete before commit). At a minimum, snap at 1920×1080 and read the screenshot via the agent's image tool. Don't trust code reasoning over pixels.

For deck-walking verification (catches duplicate-key warnings, animation runtime errors, asset 404s, ErrorBoundary fallbacks):

```bash
node scripts/agent-verify-deck.mjs <deck-slug>     # 0 errors expected
```

---

## Anti-patterns

These have specific failure modes; avoid them.

- **Markdown deck files.** No `.md` slides. Slides are JSX. The audience for Slide of Hand's authoring layer is "people who write React" — the author + agents. If you want non-developers to edit decks, that's a different product.
- **A directive vocabulary.** No `defineDirective`, no descriptor schema, no palette catalog. If you find yourself wanting to register a "directive" — that's a normal React component. Just import it.
- **A bidirectional markdown ⇄ visual editor.** Editing happens in code in v1. The `/admin` Studio is preview + presenter mode only. Element inspection / drag-drop editing are out of scope unless explicitly added to a future PRD.
- **`git add -A` / `git add .`.** Stage specific paths only.
- **Inline animation timings.** Use easings from `@/lib/motion`. Never write `transition={{ ease: [0.25, 0.46, 0.45, 0.94] }}` directly in a slide.
- **Hard-coded brand colours.** Use Tailwind tokens (`text-cf-orange`) or CSS custom properties (`var(--color-cf-orange)`). Never literal hex.
- **Pure white backgrounds (`#FFFFFF`)** or **pure black text (`#000000`)**. Use the design system: `var(--color-cf-bg-100)` (`#FFFBF5` warm cream) and `var(--color-cf-text)` (`#521000` warm brown).
- **Bold weight on headings.** Medium weight only. Tight tracking (`tracking-[-0.025em]` to `tracking-[-0.04em]`).
- **Glassmorphism, glow borders, magnetic hover, jelly springs.** Subtle is the brand. Hover effect is `border-style: dashed`.

---

## Common pitfalls

- **Slide doesn't appear in the overview / index** — likely the `meta.slug` doesn't match the folder name, or the `import.meta.glob` pattern hasn't picked up your new file (touch the registry / restart dev server).
- **Phase reveals don't advance** — confirm the slide declares `phases: N` (the count of additional reveals; the slide always starts at phase 0).
- **Click-to-advance fires when the user clicks a button inside a slide** — wrap the button (or its parent) in `data-no-advance`, or add `data-interactive` to the button itself.
- **Unicode literal `\u00b7` shows as text instead of `·`** — JSX attribute strings and SVG `<text>` content are NOT JS strings. Wrap in `{}`: `<text>{"foo · bar"}</text>` (or just paste the literal char).
- **HMR Fast Refresh fails for a deck file** — likely a default export of a non-component (e.g. the `Deck` object). Touch the source to force a full reload, or restart the dev server.
- **`fitView` on React Flow falls back to 500px** — parent must have explicit `height: 100%` or pixel value.

---

## Going deeper

| When you need… | Read |
|---|---|
| The PRD + Wave 1 plan | GitHub issue #1 |
| The framework primitives' source | `src/framework/viewer/` (Wave 1 lands these) |
| Per-deck source | `src/decks/public/<slug>/` |
| Pocock orchestrator conventions | [`mcdays94/pocock-agents`](https://github.com/mcdays94/pocock-agents) |
| Cloudflare Workers Design System | <https://cf-workers-design.nireka-96.workers.dev/#design-system> |

---

## Conventions checklist

- [ ] Slide IDs are kebab-case and match the file name (`01-title.tsx` → `id: "title"`).
- [ ] Deck slugs are kebab-case and match the folder name.
- [ ] All animations use easings from `@/lib/motion`.
- [ ] All brand colours via Tailwind class or CSS variable, never hex.
- [ ] All slides export a typed `SlideDef`. All decks export a typed `Deck`.
- [ ] Public decks live in `src/decks/public/`. Private decks are gitignored under `src/decks/private/`.
- [ ] Speaker notes (when present) are React nodes (`ReactNode`), not plain strings — they may contain styled markup.
- [ ] Worker code lives in `worker/`. Frontend code lives in `src/`. They share types via `worker/types.ts` re-exported.
- [ ] Tests live in `tests/` next to the framework code; per-deck tests next to the deck.
