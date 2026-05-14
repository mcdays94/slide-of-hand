# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues at
[github.com/mcdays94/slide-of-hand](https://github.com/mcdays94/slide-of-hand).
Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside the clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Existing label vocabulary (read-only)

The repo already uses these GitHub labels (visible via `gh label list`):

| Label | Purpose |
|---|---|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `documentation` | Documentation improvements |
| `duplicate` | Duplicate of another issue/PR |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |
| `invalid` | Doesn't seem right |
| `question` | Further information requested |
| `wontfix` | Will not be worked on |

Engineering skills should prefer the canonical Pocock vocabulary
(see `triage-labels.md`) but co-exist with the existing GitHub
defaults — never delete or rename existing labels in service of
canonicalization.
