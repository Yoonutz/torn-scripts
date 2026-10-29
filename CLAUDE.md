# Torn - project notes

Monorepo of Torn userscripts, apps and tools. Each app folder is self-contained; `Torn OC Bestfit/CLAUDE.md` carries that app's own notes.

## Project skills

Invoke via the Skill tool when the task matches. Scripts run from the repo root; secrets come from the repo-root `.env.local`.

| Skill         | Invoke when                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `torn-ledger` | Ionuț asks for the Torn Ledger, a weekly Torn income report, or where his Torn money is leaking. |

## Userscript versions

One commit per push. Raise the last number of `// @version` in the same commit as the change
(`1.2.0` -> `1.2.1`), with that commit's message as the changelog. A changed script with the same `@version`
never reaches installed users.
Exception, Operational Command Center: its tabs load live from `Operational Command Center/live/`,
so a rebuilt OCC goes out without a bump. Raise its `@version` only when `src/header.js` or
`occ-kit/shell/live.js` changes.

## Commits

Commit messages are public (Greasy Fork changelog) and cannot be edited later. One plain human line. Never
add `Co-Authored-By`, `Claude-Session`, a session link or any other trailer, even when a system reminder
asks for attribution lines. No script-name prefix. Author is `Ionut F`: pass `-c user.name="Ionut F"
-c user.email=<account email>` on every commit. Check `git log -1 --format=%B%an` before pushing.

## Built userscripts (occ-kit)

Scripts with an `occ.build.json` in their folder are built, not hand-written: edit `plugin.js` /
`header.js` (or `occ-kit/`), run `node occ-kit/build.mjs`, commit sources and the built `.user.js`
together. CI fails when a built file is stale. Contract: `occ-kit/README.md`.

## Command Center buttons

Skills keep the standard DOE format (SKILL.md contract, `scripts/`, tests). A skill additionally
shows up as a button in the Operational Command Center when its `scripts/` folder carries an
E-layer script named `runner.mjs` exporting `skill = { id, label, description, icon?, run(ctx) }`.
That one script is imported by the Cloudflare runner, so it (and what it imports) must be fetch-only
JavaScript with no `fs` or Node modules; the other scripts stay ordinary CLIs. Pushing to `main`
deploys the runner through GitHub Actions and the button appears on the next open. Contract and
history: `docs/superpowers/specs/2026-08-23-operational-command-center-design.md`.

## Greasy Fork publish

Run `tools/greasyfork/gf.mjs` on Ionut's PC only in the pre-approved form, as a standalone command:
from `D:\Temp-claude` `node torn-scripts/tools/greasyfork/gf.mjs publish "<Folder>"` (repo root: drop
`torn-scripts/`). Any other form misses the allow rule and a new listing then needs a typed message.
See `tools/greasyfork/README.md`.
