---
name: torn-ledger
description: Use when Kami asks for the Torn Ledger, a weekly Torn income report, "is my income going down", "where is my money leaking", or a fresh money snapshot of his Torn account.
allowed-tools: Bash, Read, Glob
---

# Torn Ledger

## Goal

Produce the weekly Torn income report in the agreed fixed shape: income per day (networth, company, bank, bazaar, stock payouts), inventory block, leak list, two actions, trend since baseline. Success: the report comes out of `report.mjs` unchanged, compared against a snapshot at least 6 days old, and every leak line carries a number. The agent never computes or restyles numbers by hand.

## Inputs

- `--dry-run` (either script): print, write nothing.
- `--date YYYY-MM-DD` (report): report for that snapshot instead of the latest.
- `--since YYYY-MM-DD` (report): force that snapshot as the baseline.

## Scripts

- `scripts/collect.mjs` - pulls nine Torn API v2 endpoints and saves `data/snapshots/<date>.json`.
- `scripts/report.mjs` - renders `data/reports/<date>.md` from latest snapshot vs baseline.
- `scripts/lib.mjs` - pure logic (derive, compare, leaks, render). Tested by `tests/lib.test.mjs`.

## Process

All commands run from the repo root.

1. Check the logic still passes before touching live data:

   ```
   node --test .claude/skills/torn-ledger/tests/lib.test.mjs
   ```

2. Dry-run the collector; confirm the one-line summary on stderr looks sane (networth in the billions, staff count filled):

   ```
   node .claude/skills/torn-ledger/scripts/collect.mjs --dry-run
   ```

3. Save today's snapshot:

   ```
   node .claude/skills/torn-ledger/scripts/collect.mjs
   ```

4. Render and save the report:

   ```
   node .claude/skills/torn-ledger/scripts/report.mjs
   ```

5. Deliver the markdown exactly as printed. Add at most one sentence of judgement above it if something in the leaks changes a decision. Do not reorder, restyle, or recompute anything.

## Outputs

The ONLY deliverable is the markdown report printed by `report.mjs` (also saved under `data/reports/`). Snapshots under `data/snapshots/` are the history; never delete them.

## Edge Cases

- First run ever: report says "First snapshot, nothing to compare yet". Expected; deltas start on the second snapshot.
- Same-day rerun: collector overwrites today's snapshot (stderr warns). Fine; the day's last collection wins.
- Baseline younger than 6 days: `pickBaseline` falls back to the oldest snapshot and the header shows the real gap in days. Say so when delivering.
- `collect failed: <endpoint> -> <code> <message>`: Torn API refused one call. Code 2 = bad key, 5 = rate limit (wait 60 s, rerun), 8 = IP block. Nothing is written on failure.
- `TORN_API_KEY_FULL is not set`: the key lives in the repo-root `.env.local`; the script loads it itself, no need for `--env-file`.
- Torn API v2 does not expose item-by-item inventory. Inventory is value-only; bazaar income comes from the lifetime `bazaar.profit` counter, so a weekly delta is exact.
- `company/news` only returns recent fund moves. Company net per day is `(funds delta + withdrawals - deposits) / days` inside the snapshot window, so gaps longer than the news retention undercount withdrawals. Keep runs weekly.
- Leak list shows at most 7 bullets; the rest are folded into one "Plus N smaller" line. Leak order is fixed by payoff in `lib.mjs`, not by amount.

## Environment

- `TORN_API_KEY_FULL` - full-access Torn API key, read from repo-root `.env.local`.
- Node 22+ (uses global `fetch`, `node --test`). No dependencies.
