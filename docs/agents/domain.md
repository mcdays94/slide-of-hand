# Domain Docs

How the Pocock engineering skills should consume this repo's domain
documentation when exploring the codebase.

## Layout: single-context

This repo has a single bounded context — the deck platform. So:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-tool-call-streaming-for-deck-creation-progress.md
│   ├── 0002-lean-tool-return-verbose-stream-yields.md
│   └── 0003-deck-state-cursor-keyed-to-effective-slides.md
└── src/
```

No `CONTEXT-MAP.md`. No per-context ADR directories.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — any ADRs that touch the area you're about to work in.
- **`AGENTS.md`** at the repo root — repo-specific developer conventions
  (deck contract, framework primitives, anti-patterns) authoritative
  alongside `CONTEXT.md`.

If any of these files don't yet contain the term / decision you need,
**proceed silently**. Don't flag absences upfront. The producer skill
(`grill-with-docs`) creates them lazily when terms or decisions actually
get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in
`CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids
(see each term's `_Avoid_` list).

If the concept you need isn't in the glossary yet, that's a signal —
either you're inventing language the project doesn't use (reconsider)
or there's a real gap (note it for `grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly
rather than silently overriding:

> _Contradicts ADR-0003 (effective-slides cursor) — but worth reopening
> because the new use case requires X._

## Related authoritative documents

- `AGENTS.md` — repo conventions consumed by every agent session
- `~/.config/opencode/AGENTS.md` — cross-repo personal rules (git
  identity, Pocock orchestration, dev server discipline, etc.). The
  Pocock orchestration rules at the bottom of that file describe the
  parallel-worker dispatch and merge protocols this repo uses.
- `README.md` — public-facing overview (no em-dashes — see global rules).
