# Torn - project notes

Monorepo of Torn userscripts, apps and tools. Each app folder is self-contained; `Torn OC Bestfit/CLAUDE.md` carries that app's own notes.

## Project skills

Invoke via the Skill tool when the task matches. Scripts run from the repo root; secrets come from the repo-root `.env.local`.

| Skill         | Invoke when                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `torn-ledger` | Ionuț asks for the Torn Ledger, a weekly Torn income report, or where his Torn money is leaking. |

## Userscript versions

Never bump `// @version` by hand for a patch. A push to `main` that modifies a `*.user.js` triggers
`.github/workflows/bump-userscript-versions.yml`, where a bot commit raises the last number
(`1.2.0` -> `1.2.1`) so Greasy Fork sees the update. Skipped: files new in the push, `backup/` folders,
and files whose `@version` the push already changed (edit it yourself for a minor/major bump).
The bot commit lands on `main` after your push, so run `git pull --rebase` before the next push.

## Command Center buttons

Skills keep the standard DOE format (SKILL.md contract, `scripts/`, tests). A skill additionally
shows up as a button in the Operational Command Center when its `scripts/` folder carries an
E-layer script named `runner.mjs` exporting `skill = { id, label, description, icon?, run(ctx) }`.
That one script is imported by the Cloudflare runner, so it (and what it imports) must be fetch-only
JavaScript with no `fs` or Node modules; the other scripts stay ordinary CLIs. Pushing to `main`
deploys the runner through GitHub Actions and the button appears on the next open. Contract and
history: `docs/superpowers/specs/2026-08-23-operational-command-center-design.md`.
