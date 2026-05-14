# Triage Labels

The Pocock engineering skills speak in terms of five canonical triage
roles. This file maps those roles to the actual label strings used in
this repo's GitHub issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  | Status                                       |
| -------------------------- | -------------------- | ---------------------------------------- | -------------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  | **Not yet created** — `triage` creates lazy. |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information | **Not yet created** — `triage` creates lazy. |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  | **Not yet created** — `to-issues` creates lazy. |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            | **Not yet created** — `triage` creates lazy. |
| `wontfix`                  | `wontfix`            | Will not be actioned                     | **Exists** (GitHub default).                 |

When a Pocock skill mentions a role (e.g. "apply the AFK-ready triage
label"), use the corresponding label string from this table.

The 4 missing labels will be created by `gh label create` on first
use. Don't pre-create them — that's the producer skill's job, and it
will pick sensible colours / descriptions.

## Domain-specific labels

The repo also uses topic labels (`bug`, `enhancement`, `documentation`,
etc.) for categorization. These coexist with the triage-state labels
above and are not part of the Pocock state machine.
