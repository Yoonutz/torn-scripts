# Operational Command Center - skill-to-UI workflow

How a skill in this repo becomes a working button in the Torn UI, with zero
manual deploy steps. Design history:
[the design spec](../docs/superpowers/specs/2026-08-23-operational-command-center-design.md).

Where the ledger skill appears below it is a worked example, never the
template. The contract is only: SKILL.md, the `skill` export shape, and the
`ctx` interface. Everything else is per-skill freedom.

## The pipeline at a glance

```
.claude/skills/<name>/          push to main            Torn UI (userscript)
  SKILL.md  ─────────────┐        │                       │
  scripts/runner.mjs ────┼──> GitHub Action ──> Cloudflare Worker (occ-runner)
  scripts/*.mjs (CLI)    │        │                       ▲
                         │        └─> Greasy Fork webhook │
                         │            (userscript only)   │
                         └────────────────────────────────┘
        button press: /ask/<id> -> runner runs skill -> free model -> answer
```

## 1. Create the skill

Standard DOE skill format, nothing special:

- `.claude/skills/<name>/SKILL.md` - the contract. The runner sends this file
  to the model as the system prompt (minus its Scripts, Environment and Inputs
  sections), so its delivery rules decide what the
  player reads. Write the output shape and delivery rule precisely.
- `.claude/skills/<name>/scripts/` - ordinary CLI scripts, tests as usual.

## 2. Add the runner hook

One extra E-layer script makes the skill a Command Center button:
`scripts/runner.mjs` exporting

```js
// Values below are placeholders - pick your own. Only the SHAPE is the contract.
export const skill = {
  id: "<skill-id>", // route: /run/<skill-id>; short, lowercase, unique
  label: "<Button text>", // shown on the tab bar
  description: "...", // tool description the model sees; say what run() returns
  icon: "<svg .../>", // optional; letter badge otherwise
  access: "limited", // optional; lowest Torn key level it needs (public|minimal|limited|full), default full
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
- What `run()` does inside is entirely the skill's business: any Torn
  endpoints, any KV layout, any report shape. Nothing about the ledger skill
  (snapshots, baselines, nine endpoints) is part of the contract - do not
  copy its internals into an unrelated skill.

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
- `GET /skills` - public list: id, label, description, icon, access, SKILL.md URL.
  The userscript builds its bottom tab bar from this on every open.
- `GET /run/<id>` with header `Authorization: ApiKey <torn key>` - executes
  `skill.run(ctx)`. **Private**: the Worker asks Torn who owns the key
  (`user/basic`, cached a day per key hash) and only runs it for player IDs in
  `ALLOWED_PLAYERS` (`wrangler.toml`); everyone else gets `403`. The check lives
  on the server, so editing the userscript cannot get around it. Rate limited to
  6 runs a minute per key and 20 per IP (`429` past that). The Torn key is the
  only credential. `ctx.db` writes land in KV under `<id>:<key-hash>:<name>`, so skills never see each other's data
  or another player's. Whether anything is stored at all is each skill's own
  choice - the ledger stores nothing and treats every run as fresh; `?force=1`
  arrives as `ctx.force` for the skill to honor. House rule for live personal
  data: analyze and discard, never persist it server-side.
- `GET /ask/<id>` - same gate, same run, then the runner has a free model write
  the answer and returns `{ ...run result, answer, model, errors }`. OpenRouter
  key: the Worker secret `OPENROUTER_KEY` if set, else the `X-OpenRouter-Key`
  header from the userscript. No key = the raw report comes back as `answer`.

## 5. What happens on button press

1. Userscript makes one call: `GET /ask/<id>` with the Torn key (and the
   OpenRouter key from Setup, if any). 180 s timeout, Cancel button in the
   progress card.
2. The runner executes the skill once, then trims `SKILL.md` to its delivery
   rules and caps the report so the prompt stays under ~60k characters.
3. Models are tried in order, up to 4 per press (40 s each):
   `thinkingmachines/inkling:free`, `nvidia/nemotron-3.5-super-vl:free`,
   `google/gemma-4-31b-it:free`, `cohere/north-mini-code:free`, `openrouter/free`.
   The last model that answered goes first; a model that failed sits out for
   10 min (shared health record in KV, `ai:health`). Override the list with a
   `MODELS` var (comma separated).
4. **Free models only**: the runner drops any model ID that is not `:free` or
   `openrouter/free`, so the account's credit balance is never spent. The $10
   lifetime top-up only lifts the free limit to 1000 requests a day (20 a
   minute). Extra OpenRouter keys or accounts do not add capacity.
5. If every model fails, the raw report is shown as-is, labelled
   "runner (free models busy)".
6. The UI renders: stat cards from `stats`, the answer split into folding
   sections on markdown headings and `Label:` lines, model name + timestamp.
   Answers are cached per skill in `localStorage`; the amber circle button
   reruns with `force`. Answers older than 12 h show their age in amber.

## 6. Styling flows through

Report style lives in whatever module the skill renders its markdown with
(the ledger keeps it in its `lib.mjs`). The Worker bundles the same files the
CLI uses, so a style edit plus push changes the Torn UI output too. Caveat: body text passes through a free
model, which can occasionally mangle a line; `stats` cards bypass the model
and always carry 1:1.

## Company trains pill

Small badge right of the OCC icon: just the count next to the player name (so
it fits the sidebar; `x / 20` in the tooltip), `x / 20` in the phone dock and
floating above the launcher on pages without a name row. Userscript only, no skill or
Worker involved.

- `GET https://api.torn.com/v2/company/profile` with
  `Authorization: ApiKey <torn key>`, field `profile.trains`. Needs a director
  key, Limited access or higher. Max `20` is hardcoded (not in the response).
- Torn adds the daily trains with the company update at ~18:05 TCT (the daily
  report lands 18:04-18:06). The pill calls once at 18:07 TCT, again when a tab
  comes back into view and has missed that, a few seconds after a Train click
  on the company page, and otherwise at most every 12 h. Network or rate-limit
  failures retry after 10 min. All times are TCT (UTC), so daylight saving
  never shifts them.
- In Torn PDA the pill has its own fixed slot on every page: right-aligned
  directly under the status icons line, above the page title.
- Click the pill to refresh now (30 s cooldown). A small message appears next
  to it saying what happened (new value, or why it failed). Hover shows the
  last refresh time, relative age and the next auto refresh, in TCT.
- Hidden for keys that are not a company director (checked again once a day).
- Colors: grey 0, amber 1-19, red 20/20 (full bank, daily trains are lost).
  Faded `?` or value = no data or last refresh failed (reason in the tooltip).
- Cached in `localStorage` (`occ.trains`); tabs share it and a short lock
  (`occ.trains.lock`) keeps several Torn tabs from calling at once. Keys that
  will not fix themselves (invalid, access too low, paused) stop auto retrying
  until the key changes or the pill is clicked.
- Needs `@connect api.torn.com`, so Tampermonkey asks to approve it once after
  the update.

## Keys the player pastes once

Both live in the userscript settings pane, stored in Tampermonkey's own storage
(`GM_setValue`), so clearing torn.com site data, logging out or Torn wiping its
`localStorage` no longer loses them, and other scripts on the page cannot read them.
Keys saved by older versions in `localStorage` move over on their own. Torn PDA keeps
`localStorage` (it fills the Torn key itself).

- OpenRouter API key - optional; only free models are ever called with it.
- Torn API key (full access) - doubles as the runner credential.

## Torn API key use (ToS)

| Item          | Answer                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Data storage  | Answers cached in your browser only. The runner keeps only key hash -> player ID for a day (access check); its request logs are off. |
| Data sharing  | The runner sends skill reports (money, networth, company numbers) to free OpenRouter models, which may log them. |
| Purpose       | Personal dashboards: the skill buttons and the company trains pill.                                      |
| Key storage   | Tampermonkey storage in your browser; sent per run to the runner over HTTPS, never stored there.          |
| Key access    | Full (the Ledger itself needs only Limited; Full is kept for upcoming skills). Trains pill: Limited.     |
| Who can use   | Private: the runner only serves the owner's player ID; any other key is refused server side.             |

## Compliance

- Only Torn API calls (`api.torn.com`) plus the runner (which talks to OpenRouter). No page
  scraping, no extra requests to torn.com.
- Never clicks or acts for you. The Train-click watcher on the company page only listens, then
  refreshes the pill through the API.
- The trains pill makes no timed call while the tab is hidden; it catches up when the tab is back.
- The donator star and award icons right after the owner's own sidebar name are hidden to make
  room for the icon; other players keep theirs.

## Verifying a change landed

- Worker: `curl https://occ-runner.yoonutz.workers.dev/skills` - new deploys
  can serve the old version for a short while, poll before diagnosing.
- Userscript: fetch the Greasy Fork code endpoint with a random `?v=` query -
  the endpoint caches hard and lies without it.
- Live Torn page: human eyes only; torn.com blocks the automation browser.
