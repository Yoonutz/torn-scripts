# OC Best-Fit userscript — agent instructions

You operate using Claude Code Skills + subagents on the Torn OC Best-Fit tooling. Skills bundle
instructions with deterministic scripts so probabilistic decision-making stays separate from
deterministic execution. Your job is intelligent routing: read the skill, run its scripts in order,
handle errors, apply fixes.

## Canonical script — working rules

**`torn-oc-bestfit.user.js` is the ONE canonical script.** All latest/real changes go here and
nowhere else. It is the file that gets published (to GreasyFork / installed in TornPDA). Edit it
directly.

- **No other long-lived copies.** Any minified build, beautified copy, `pda-probe`, build script
  (`build-*.cjs`), or scratch test file is a TEST/THROWAWAY artifact. Delete it the moment the task
  that needed it is done. Do not leave junk sitting in the folder.
- **Keep it comment-free and lean.** TornPDA silently refuses to load the script once it exceeds
  roughly **120 KB**, and comment lines are what pushed it over before. Do not add comment lines to
  this file; keep it under ~120 KB. (Explain reasoning to the user, not in the script.)
- **`@match` must always be exactly `https://www.torn.com/*`.** Never
  `https://www.torn.com/factions.php?step=your#/tab=crimes*` — `@match` ignores everything after
  `#`, so that pattern never matches and the script never injects. This one line caused most of the
  "doesn't work on PDA" incidents.
- On every release, bump both `// @version` in the header and the `VERSION` fallback constant.

Pre-existing, NOT throwaway (leave alone unless asked): `oc-score.js`, `oc-score.test.html`,
`trend-mockups.html`.

## The architecture

**Layer 1: Skills (intent + execution bundled)** — live in `.claude/skills/`. Each skill =
`SKILL.md` instructions + `scripts/` folder. Self-contained; auto-discovered and invoked by task
context.

**Layer 2: Orchestration (you)** — read `SKILL.md`, run bundled scripts in the right order, handle
errors, ask for clarification, update skills with learnings. You are the glue between intent and
execution.

**Layer 3: Shared backend** — the Supabase project in `supabase/` (edge fn + SQL) and the
canonical userscript. Used across skills.

**Why this works:** if you do everything yourself, errors compound. 90% accuracy per step = 59%
success over 5 steps. Push complexity into deterministic code; you focus on decision-making.

## Available skills

- `oc-score-diagnose` — diagnose why a faction member's OC Best-Fit success score is what it is
  (e.g. stuck at 1000). Dumps a player's completed-OC participation from the shared Supabase
  backend. Script: `.claude/skills/oc-score-diagnose/scripts/diagnose-score.ts`.

Don't create new skills without asking first.

## Subagents

Subagents (Sonnet) have self-contained contexts defined in `.claude/agents/`. Cheaper, unbiased (no
parent-context leakage), keep parent context clean. **Read-only reporters — all code changes happen
in you, the parent.**

- `code-reviewer` — unbiased code review with zero context: correctness, readability, performance,
  security. Reports issues; fixes nothing.
- `qa` — generates tests for a snippet, runs them, reports pass/fail. Fixes nothing.
- `research` — deep research via web + file + codebase exploration. Returns sourced findings.

### Design & build loop

For any non-trivial change (features, refactors of the userscript or backend):

1. **Write/edit** the code.
2. **Code review** — spawn `code-reviewer` on the changed file(s).
3. **QA** — spawn `qa` on the code.
4. **Fix** — read both reports, apply all fixes yourself.
5. **Ship** — only after review passes and tests pass.

Research-heavy tasks: spawn `research` first to gather context without polluting the conversation.
Reviewing independent files: spawn `code-reviewer` + `qa` in parallel with `run_in_background: true`.

## File organization

- `.claude/skills/` — skills (`SKILL.md` + `scripts/`)
- `.claude/agents/` — subagent definitions
- `.tmp/` — intermediate/throwaway files (never commit)
- `supabase/` — backend (see below)
- `docs/` — reference material (Torn ToS, superpowers)
- `.env` — secrets and IDs (never commit; `.env.example` is the template)

**Deliverable vs intermediate:** the deliverable is the canonical userscript (published to
GreasyFork) and the live Supabase backend. Everything local-and-temporary is an intermediate —
process with it, then delete.

## Publishing

Publish target is **GreasyFork** (script `583330`), not a webhook. Bump `@version` + `VERSION`,
then update via GreasyFork's manual Update page. The GreasyFork webhook payload (`GREASYFORK_*` in
`.env`) is a dead end — do not rely on it. GreasyFork is the source of truth; the local copy can be
stale, so pull live before editing if in doubt.

## Backend (`supabase/`)

- Edge fn `functions/oc-gateway/index.ts` — actions: pull, community, snapshots, weights, recs,
  scoringcfg + pushes. `verify(key)` resolves `{user_id, faction_id}` server-side.
- Schema/DDL in `sql/` (dated migrations). `oc_crime_stats` is a live view (no repo DDL).
- Static config in `static/oc-static.json`.
- Secrets/IDs in `.env`: schema `torn_oc_cpr`, project `mmoaqgkhfxmbgvirsgxw`, plus `SUPABASE_*`,
  `TORN_API_KEY`, `TORN_OPENAPI_URL`, `GREASYFORK_*`.

## Reference material (read before API / ToS work)

- **Torn ToS screenshots:** `docs/Torn ToS/` (`www.torn.com_rules.php (2-6).png`). Governing rule
  is **Scripting Abuse** (screenshot 2): scripts may only use API data or a page the user manually
  loaded and is actively viewing; no extra non-API Torn requests; no scraping unfocused pages; no
  undisclosed functionality; API-tool devs must disclose data/key handling. Re-read before changing
  data flow, sharing, or disclosure copy.
- **Torn API v2 OpenAPI schema:** URL in `.env` as `TORN_OPENAPI_URL`
  (`https://www.torn.com/swagger/openapi.json`). Pull and grep it before guessing endpoint params —
  it is authoritative. Confirmed facts: `GET /faction/crimes` supports `cat`, `filters`
  (created_at/executed_at/ready_at/expired_at), `from`, `to`, `limit` (max 100), `offset`, `sort`
  (DESC/ASC), `comment` (tool id for Torn's logs), `key` (Minimal access tier). `GET /key/info`
  returns `info.access.faction` (boolean = key has faction API access) and
  `info.selections.faction[]` — use it to detect faction-permission before attempting a faction
  data pull.

## Self-anneal

Errors are learning opportunities. When something breaks: read the error + trace → fix the script →
test → update the relevant `SKILL.md` with the new flow. System gets stronger. But don't create new
skills without asking.
