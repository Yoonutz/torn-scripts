# Torn - project notes

Monorepo of Torn userscripts, apps and tools. Each app folder is self-contained; `Torn OC Bestfit/CLAUDE.md` carries that app's own notes.

## Project skills

Invoke via the Skill tool when the task matches. Scripts run from the repo root; secrets come from the repo-root `.env.local`.

| Skill         | Invoke when                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `torn-ledger` | Kami asks for the Torn Ledger, a weekly Torn income report, or where his Torn money is leaking. |

## Command Center buttons

Any skill becomes a button in the Operational Command Center userscript by exposing
`scripts/runner.mjs` that exports `skill = { id, label, description, icon?, run(ctx) }`. The logic
must be browser-grade JavaScript (fetch only, no `fs`, no Node modules). Pushing to `main` deploys
the runner through GitHub Actions and the button appears on the next open; no other change is
needed. Contract and history: `docs/superpowers/specs/2026-08-23-operational-command-center-design.md`.
