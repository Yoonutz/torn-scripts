# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file, dependency-free web app that visualizes Torn (the MMO) ranked-war performance. Everything — HTML, CSS, JavaScript — lives in `torn_war_tracker.html`. There is no build system, no package manager, no test suite, no framework. Open the file in a browser to run it.

## Running and iterating

- "Run": open `torn_war_tracker.html` directly in a browser (file:// is fine; the only network calls are to `api.torn.com`).
- No build, no lint, no tests. Verification = manually exercising the UI: paste an API key in the login modal, click **Load wars**, pick a past war or the active-war banner, then **Analyse** and **Auto-detect**.
- DevTools console is the debug surface. `fetchWarAttacks` and `fetchReviveSettings` log diagnostics there (window count, v1/v2 attempts/hits, sample shapes). When investigating "no data" bugs, check those logs before touching code.

## Architecture

### File layout in `torn_war_tracker.html`

1. `<style>` (lines ~7–195): CSS variables for `data-theme="dark|light"`, all component styles. Theme toggle flips the `data-theme` attribute on `<html>`; everything else is CSS variables.
2. `<body>` markup (lines ~200–340): header, About modal, war banner, war-selector card, dashboard container (`#dash`), and a full member table.
3. Main IIFE (lines ~346–1428): app logic. Wrapped in `(function(){ 'use strict'; ... })()`, exposes only `window.fetchWars` and `window.sortTable`.
4. Auth module (lines ~1430–1562): `KeyStore`, `TwtState`, `TwtApp` — pulled out of the IIFE because the login modal needs to run before the rest of the app.

### State

All runtime state lives on a single object `S` defined near the top of the IIFE. The important fields:
- `S.myFid` / `S.oppFid`: faction IDs for "us" and "them".
- `S.warData`: the canonical report object (shape described below). Both past wars and live wars normalize to this shape.
- `S.cachedAttacks`, `S.cachedRevives`, `S.cachedDefends`, `S.cachedReviveSettings`: caches populated by Auto-detect (or by live-mode fetches) and reused by phase filtering and the table.
- `S.warMeta = { wStart, wEnd }`: the war's time window, used by phase math.
- `S.diag`: per-fetch diagnostics — reset at the start of every `fetchWarAttacks()` run.

### The "single report shape" abstraction

The renderer (`renderDash`, `renderMyList`, `renderOppList`, `renderTable`, `renderMiniChart`) does NOT branch on live vs past. Both paths produce the same shape:

```
{ war: { start, end, target, winner },
  factions: { [fid]: { name, score, attacks, rank_before, rank_after,
                       members: { [mid]: { name, level, attacks, score } } } } }
```

- **Past war** path (`loadSelectedWar` → `fetchAndRender`): `apiCall('/torn/{wid}?selections=rankedwarreport')` returns this shape directly.
- **Live war** path (`loadCurrentWar` → `fetchAndRender` with `'__live__'`): three-phase parallel fetch assembles the same shape — (A) `v2 /faction/wars` for war metadata + both `v1 /faction/{fid}?selections=basic` rosters, (B) full attack log via `fetchWarAttacks`, (C) per-member tally. See `fetchAndRender` lines ~580–710.

If you're tempted to add a "live vs past" branch inside a renderer, normalize at the data layer instead.

### API client

`apiCall(path, useV2)` is the only HTTP entry point. Auth differs by version and **must not be confused**:

- **v1** (`useV2=false`): `https://api.torn.com{path}` with `?key={apiKey}` query param.
- **v2** (`useV2=true`): `https://api.torn.com/v2{path}` with `Authorization: ApiKey {apiKey}` HEADER. The official torn-client source strips `key` from query params in v2 — do not pass it as a query param.

Torn API error codes are mapped to friendly messages in `apiCall` (2 = invalid key, 7 = lacks permission, 16 = access level too low, 22 / 23 = wrong API version for selection).

### Attack-log fetching (`fetchWarAttacks`)

A single `/faction/attacksfull` call returns only the most recent ~1000 attacks. For a multi-hour war that's not enough. The fix:

1. Split the war window into parallel 1-hour slices.
2. For each slice, call `_fetchAttackWindow(from, to)` — tries **v1 first** (`/faction/?selections=attacksfull&from=X&to=Y`, documented since 2018) then falls back to v2. v1 is preferred because v2's shape is still in flux.
3. Each response is normalized through `_normAtks` → `_normAtk`, which flattens v1 (flat `attacker_id`, `respect_gain`) and v2 (nested `attacker.id`, `attacker.faction.id`) into a single canonical record.
4. Flatten, dedupe by `code`, sort ASC by `timestamp_started`.

If you add a new code path that needs attacks, call `fetchWarAttacks` — do **not** call `/faction/attacksfull` directly. The diagnostic counters and v1/v2 fallback live there.

### The "three phases" (domain concept)

Torn ranked wars have non-uniform mechanics that the dashboard splits into:
- **Phase 1**: H+0 → H+24. Target score is fixed.
- **Phase 2**: H+24 → moment the **net score** (mine − opponent) first met the decayed target (target × 0.99^hours_past_H+24).
- **Phase 3**: that moment → war end.

`autoPopulateScoreTime` finds the Phase-2/3 boundary by walking the sorted attack log and recomputing the decayed target at each timestamp. It also handles the **loss case**: if the opponent's net crossed first, that timestamp is used and the field is labeled accordingly. `getMembersForTab` then uses `S.cachedAttacks` + `S.warMeta` + the score-time input to compute per-phase tallies. If `S.cachedAttacks` is empty (user hasn't run Auto-detect yet), it falls back to an analytic estimate using a power-curve shaped by `Math.pow(t, 0.82)`.

### Authentication / persistence

API key is stored in `localStorage` under `twt_api_key`, base64-encoded with prefix `twt1_` via `KeyStore`. The display name is in `twt_user_name`. The login modal calls `v2 /user/basic` + `v2 /faction/basic` to validate the key and get the display name, then auto-loads wars. There is no server.

## Conventions

- All times are Torn time, which equals UTC. `fmtUTC` and `tsToInput` both work in UTC; do not introduce local-time conversions.
- All faction and member IDs are stringified at the boundary (`String(...)`), because keys from API objects and `dataset` attributes are always strings. Compare with `===` against stringified IDs.
- `respect_gain` (NOT `respect`) is the canonical field for both v1 and v2; `_normAtk` checks `respect_gain` first and falls back to `respect`. Attacks with `respect <= 0` are skipped (stalemates, defeats, etc.) — they should not count toward score.
- New rendering code should accept a faction object and read `S.cachedAttacks` / `S.warMeta` rather than re-fetching. Re-fetching causes the live auto-refresh tick to multiply.

## Things to avoid

- Don't introduce a build step, framework, or external library. The "open the file in a browser" deployment model is intentional — it's why the About modal advertises "100% locally, no servers."
- Don't add a separate live-vs-past branch inside a renderer. Normalize earlier.
- Don't make `/faction/attacksfull` calls outside `fetchWarAttacks` — you'll lose the v1/v2 fallback and the windowing.
- Don't store the API key plain-text. Route through `KeyStore.encode` / `KeyStore.decode`.
