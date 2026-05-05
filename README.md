# ReAction

JSX-first deck platform — Miguel Caetano Dias' personal portfolio of presentations.

A Cloudflare Workers + Static Assets app where each deck is a folder of TypeScript React files. No markdown, no directive vocabulary, no authoring ceremony. Public visitors browse curated decks at the root URL; the author edits and presents from `/admin` behind Cloudflare Access.

**Production: <https://reaction.lusostreams.com>** · `/admin` is gated by Cloudflare Access.

## Status

**v1.** Wave 1–3 (scaffold, framework, hello deck, public index, admin viewer, presenter mode, presentation tools) all merged. Wave 4 (production go-live: custom domain + Access) tracked in [issue #8](https://github.com/mcdays94/ReAction/issues/8). PRD: [issue #1](https://github.com/mcdays94/ReAction/issues/1).

## Stack

React 19 · Vite 6 · TypeScript 5.7 · Tailwind 4 · Framer Motion 12 · Cloudflare Workers + Static Assets · Vitest

## Repository layout

```
src/
├── framework/       # Viewer, Slide, Reveal, presenter window, drawing tools, magnifier, laser
├── decks/
│   ├── public/      # Committed decks. Listed at /, served at /decks/<slug>.
│   └── private/     # Gitignored. Author-only, accessible via `npm run dev`.
├── routes/          # /, /decks/<slug>, /admin/*
└── styles/          # Design tokens (Cloudflare Workers Design System)
worker/              # Cloudflare Worker — static asset serving
docs/
└── deploy.md        # Deploy + Access setup runbook
```

## Develop

```bash
npm install
npm run dev       # https://reaction.localhost (via portless) or http://localhost:5173
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run build     # tsc -b && vite build
```

## Deploy

See [`docs/deploy.md`](docs/deploy.md) for the full runbook (custom domain, Cloudflare Access, rollback, troubleshooting). Routine redeploy:

```bash
npm run deploy    # = npm run build && wrangler deploy
```

## License

[MIT](LICENSE) — Miguel Caetano Dias, 2026.
