# Torn - project notes

Monorepo of Torn userscripts, apps and tools. Each app folder is self-contained; `Torn OC Bestfit/CLAUDE.md` carries that app's own notes.

## Project skills

Invoke via the Skill tool when the task matches. Scripts run from the repo root; secrets come from the repo-root `.env.local`.

| Skill         | Invoke when                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `torn-ledger` | Kami asks for the Torn Ledger, a weekly Torn income report, or where his Torn money is leaking. |

## Command Center buttons

Skills keep the standard DOE format (SKILL.md contract, `scripts/`, tests). A skill additionally
shows up as a button in the Operational Command Center when its `scripts/` folder carries an
E-layer script named `runner.mjs` exporting `skill = { id, label, description, icon?, run(ctx) }`.
That one script is imported by the Cloudflare runner, so it (and what it imports) must be fetch-only
JavaScript with no `fs` or Node modules; the other scripts stay ordinary CLIs. Pushing to `main`
deploys the runner through GitHub Actions and the button appears on the next open. Contract and
history: `docs/superpowers/specs/2026-08-23-operational-command-center-design.md`.
