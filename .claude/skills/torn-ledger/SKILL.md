---
name: torn-ledger
description: Use when Kami asks for the Torn Ledger, a weekly Torn income report, "is my income going down", "where is my money leaking", or a fresh money snapshot of his Torn account.
allowed-tools: Bash, Read, Glob
---

# Torn Ledger

## Goal

Produce the weekly Torn income report in the agreed fixed shape: income per day (networth, company, bank, stock payouts), inventory block, leak list, two actions, trend since baseline. Success: the report comes out of `report.mjs` unchanged, compared against a snapshot at least 6 days old, and every leak line carries a number. The agent never computes or restyles numbers by hand.

## Inputs

- `--dry-run` (either script): print, write nothing.
- `--date YYYY-MM-DD` (report): report for that snapshot instead of the latest.
- `--since YYYY-MM-DD` (report): force that snapshot as the baseline.

## Scripts

- `scripts/collect.mjs` - pulls nine Torn API v2 endpoints and saves `data/snapshots/<date>.json`.
- `scripts/report.mjs` - renders `data/reports/<date>.md` from latest snapshot vs baseline.
- `scripts/lib.mjs` - pure logic (derive, compare, leaks, render). Tested by `tests/lib.test.mjs`.
- `scripts/runner.mjs` - same collect-then-report flow for the Command Center runner (imported by the Worker, snapshots in KV). As a CLI it prints the report from live data and writes nothing.

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

## Stock rules (fixed in `lib.mjs`)

- Increment n of a dividend stock needs (2^n - 1) benefit blocks: 1 block = 1x, 3 blocks = 2x, 7 blocks = 3x. Selling below that floor drops the increment; collecting a payout never does.
- The floor is dynamic: each run reads the active increment per stock from the API and locks exactly the shares that increment needs. Buy a third increment and the floor rises; sell down to one and it falls. No leak may suggest selling locked shares. Shares above the floor show as "free above floor".
- Passive benefits (TCI bank bonus, WSU, TGP, TCP, IIL, TCM, IST, YAZ) have nothing to collect. The API marks them `available` once active after 7 days; the ledger never lists them as payouts ready.
- Stocks held below one benefit block have no increment to protect; they stay in the "below payout threshold" leak.

## Edge Cases

- First run ever: report says "First snapshot, nothing to compare yet". Expected; deltas start on the second snapshot.
- Same-day rerun: collector overwrites today's snapshot (stderr warns). Fine; the day's last collection wins.
- Baseline younger than 6 days: `pickBaseline` falls back to the oldest snapshot and the header shows the real gap in days. Say so when delivering.
- `collect failed: <endpoint> -> <code> <message>`: Torn API refused one call. Code 2 = bad key, 5 = rate limit (wait 60 s, rerun), 8 = IP block. Nothing is written on failure.
- `TORN_API_KEY_FULL is not set`: the key lives in the repo-root `.env.local`; the script loads it itself, no need for `--env-file`.
- Torn API v2 does not expose item-by-item inventory. Inventory is value-only. Bazaar is deliberately excluded from the report and leaks; Kami does not use it.
- `company/news` only returns recent fund moves. Company net per day is `(funds delta + withdrawals - deposits) / days` inside the snapshot window, so gaps longer than the news retention undercount withdrawals. Keep runs weekly.
- `report.mjs` re-derives every snapshot from its stored `raw` payload, so a rule change in `lib.mjs` applies to history too.
- Leak list shows at most 7 bullets; the rest are folded into one "Plus N smaller" line. Leak order is fixed by payoff in `lib.mjs`, not by amount.

## Environment

- `TORN_API_KEY_FULL` - full-access Torn API key, read from repo-root `.env.local`.
- Node 22+ (uses global `fetch`, `node --test`). No dependencies.
