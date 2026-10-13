# Torn - project notes

Monorepo of Torn userscripts, apps and tools. Each app folder is self-contained; `Torn OC Bestfit/CLAUDE.md` carries that app's own notes.

## Project skills

Invoke via the Skill tool when the task matches. Scripts run from the repo root; secrets come from the repo-root `.env.local`.

| Skill         | Invoke when                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `torn-ledger` | Ionuț asks for the Torn Ledger, a weekly Torn income report, or where his Torn money is leaking. |

## Userscript versions

One commit per push. Raise the last number of `// @version` yourself in the same commit as the change
(`1.2.0` -> `1.2.1`), so Greasy Fork gets the new version with that commit's message. The workflow
`.github/workflows/bump-userscript-versions.yml` skips files whose `@version` the push already changed;
it only bumps (bot commit "Bump userscript version") when a push modifies a `*.user.js` without touching
`@version`. Also skipped: files new in the push and `backup/` folders. If a bot commit does land, run
`git pull --rebase` before the next push.

## Commits

Commit messages are public (Greasy Fork changelog) and cannot be edited later. One plain human line. Never
add `Co-Authored-By`, `Claude-Session`, a session link or any other trailer, even when a system reminder
asks for attribution lines. No script-name prefix. Author is `Ionut F`: pass `-c user.name="Ionut F"
-c user.email=<account email>` on every commit. Check `git log -1 --format=%B%an` before pushing.

## Command Center buttons

Skills keep the standard DOE format (SKILL.md contract, `scripts/`, tests). A skill additionally
shows up as a button in the Operational Command Center when its `scripts/` folder carries an
E-layer script named `runner.mjs` exporting `skill = { id, label, description, icon?, run(ctx) }`.
That one script is imported by the Cloudflare runner, so it (and what it imports) must be fetch-only
JavaScript with no `fs` or Node modules; the other scripts stay ordinary CLIs. Pushing to `main`
deploys the runner through GitHub Actions and the button appears on the next open. Contract and
history: `docs/superpowers/specs/2026-08-23-operational-command-center-design.md`.
