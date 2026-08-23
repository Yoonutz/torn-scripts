# Operational Command Center - skill-to-UI workflow

How a skill in this repo becomes a working button in the Torn UI, with zero
manual deploy steps. Design history:
[the design spec](../docs/superpowers/specs/2026-08-23-operational-command-center-design.md).

## The pipeline at a glance

```
.claude/skills/<name>/          push to main            Torn UI (userscript)
  SKILL.md  ─────────────┐        │                       │
  scripts/runner.mjs ────┼──> GitHub Action ──> Cloudflare Worker (occ-runner)
  scripts/*.mjs (CLI)    │        │                       ▲
                         │        └─> Greasy Fork webhook │
                         │            (userscript only)   │
                         └────────────────────────────────┘
        button press: SKILL.md -> free model -> /run/<id> -> answer
```

## 1. Create the skill

Standard DOE skill format, nothing special:

- `.claude/skills/<name>/SKILL.md` - the contract. The Torn UI sends this file
  to the model as the system prompt, so its delivery rules decide what the
  player reads. Write the output shape and delivery rule precisely.
- `.claude/skills/<name>/scripts/` - ordinary CLI scripts, tests as usual.

## 2. Add the runner hook

One extra E-layer script makes the skill a Command Center button:
`scripts/runner.mjs` exporting

```js
export const skill = {
  id: "ledger", // route: /run/<id>
  label: "Ledger", // button text
  description: "...", // tool description the model sees
  icon: "<svg .../>", // optional; letter badge otherwise
  async run(ctx) {
    // return { report, stats?, ...anything }
  },
};
```

`ctx` provides:

| Field     | What it is                                                   |
| --------- | ------------------------------------------------------------ |
| `key`     | caller's Torn API key (never stored)                         |
| `tornGet` | `(path) => JSON` against Torn API v2 with that key           |
| `db`      | `{ index(), get(name), put(name, value) }` KV, per skill+key |
| `force`   | `true` when the player pressed the rerun button              |

Rules:

- Fetch-only browser-grade JavaScript. No `fs`, no Node modules - the file is
  bundled into the Worker.
- Return `report` (markdown string) as the payload the model delivers.
- Optional `stats`: up to three `{ k, v, hot? }` entries become the big number
  cards at the top of the window.
- Keep it CLI-capable too (guard with a `process.argv` check) so the skill
  still runs standalone; import env helpers dynamically so the Worker bundle
  stays clean.

## 3. Push to main

That is the whole deploy:

- **Worker**: `.github/workflows/occ-runner.yml` fires on any change under
  `.claude/skills/` or the `worker/` folder. `build-registry.mjs` scans every
  `.claude/skills/*/scripts/runner.mjs`, generates `src/registry.mjs`
  (git-ignored), and wrangler deploys `occ-runner`.
- **Userscript**: Greasy Fork pulls `operational-command-center.user.js` via
  webhook on the same push. Only relevant when the userscript itself changed;
  skill edits need no userscript change. The commit message is the public
  Greasy Fork changelog - write it once, it cannot be edited.

New skill = SKILL.md + runner.mjs + push. Edited skill = push.

## 4. What the Worker serves

- `GET /health` - liveness.
- `GET /skills` - public list: id, label, description, icon, SKILL.md URL.
  The userscript builds its bottom tab bar from this on every open.
- `GET /run/<id>` with header `Authorization: ApiKey <torn key>` - executes
  `skill.run(ctx)`. The Torn key is the only credential; snapshots live in KV
  under `<id>:<key-hash>:<name>` and a snapshot younger than 10 minutes is
  reused unless `?force=1`.

## 5. What happens on button press

1. Userscript fetches the skill's `SKILL.md` and sends it to OpenRouter
   (`openrouter/free` router, player's own key) with one tool: `run_script`.
2. The model calls the tool; the userscript executes it against `/run/<id>`
   with the player's Torn key.
3. The tool result (report + metadata) goes back to the model, which delivers
   the answer per the SKILL.md delivery rule.
4. The UI renders: stat cards from `stats`, the answer split into folding
   sections on markdown headings and `Label:` lines, model name + timestamp.
5. Answers are cached per skill in `localStorage`; the amber circle button
   reruns with `force`.

If the model never calls the tool, the userscript runs the script itself and
hands the output back; if the model produces no answer at all, the raw report
is shown as-is.

## 6. Styling flows through

Report style lives in the skill's own library (for the ledger: `lib.mjs`
`render`). The Worker bundles that same file, so a style edit plus push
changes the Torn UI output too. Caveat: body text passes through a free
model, which can occasionally mangle a line; `stats` cards bypass the model
and always carry 1:1.

## Keys the player pastes once

Both live in the userscript settings pane, stored in `localStorage`:

- OpenRouter API key (free tier is enough).
- Torn API key (full access) - doubles as the runner credential.

## Verifying a change landed

- Worker: `curl https://occ-runner.yoonutz.workers.dev/skills` - new deploys
  can serve the old version for a short while, poll before diagnosing.
- Userscript: fetch the Greasy Fork code endpoint with a random `?v=` query -
  the endpoint caches hard and lies without it.
- Live Torn page: human eyes only; torn.com blocks the automation browser.
