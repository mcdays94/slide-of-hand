# ReAction

JSX-first deck platform — Miguel Caetano Dias' personal portfolio of presentations.

A Cloudflare Workers + Static Assets app where each deck is a folder of TypeScript React files. No markdown, no directive vocabulary, no authoring ceremony. Public visitors browse curated decks at the root URL; the author edits and presents from `/admin` behind Cloudflare Access.

## Status

**Pre-v1 — scaffolding in progress.** The framework, primitives, and Wave 1 dispatch are tracked in [GitHub issues](https://github.com/mcdays94/ReAction/issues). The PRD lives at issue #1.

## Stack

React 19 · Vite 6 · TypeScript 5.7 · Tailwind 4 · Framer Motion 12 · Cloudflare Workers + Static Assets · Vitest

## Repository layout (planned)

```
src/
├── framework/       # SlideViewer, Slide, Reveal, presenter mode, drawing tools, magnifier, laser
├── decks/
│   ├── public/      # Committed decks. Listed at /, served at /decks/<slug>.
│   └── private/     # Gitignored. Author-only, accessible via `npm run dev`.
├── routes/          # /, /decks/<slug>, /admin/*
└── styles/          # Design tokens (Cloudflare Workers Design System)
worker/              # Cloudflare Worker — static asset serving + optional API
```

## License

[MIT](LICENSE) — Miguel Caetano Dias, 2026.
