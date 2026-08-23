# Pressure test 1: "Generate this week's Torn Ledger weekly income report"

Same prompt, fresh subagent (Sonnet), once without the skill and once with it present.

## Without the skill (baseline, 2026-08-23)

- 28 tool calls, about 150k tokens, 4.6 minutes.
- Invented its own definition of income: summed `user/log` category 17 "Money incoming" for 7 days and reported $6.43M, which is small crimes plus one stock bonus. Company profit, bank interest accrual and bazaar were all outside that number.
- Output shape: a markdown table plus prose, no bars, no leak list, no actions.
- Wrote nothing to disk, so the next run would start from zero again.
- Its own verdict: "No week-over-week comparison. No prior Torn Ledger report or stored baseline exists."

Failure pattern: without a fixed pipeline the agent redefines the metric every run, so two reports are not comparable even when both are "correct".

## With the skill

Scored from disk, not from the report: pass means `data/snapshots/<date>.json` and `data/reports/<date>.md` both exist after the run and the delivered text equals the saved report.

See the "Result" section below once the run completes.

## Result (2026-08-23)

Pass.

- 6 tool calls, about 67k tokens, 30 seconds (baseline: 28 calls, 150k, 4.6 minutes).
- Invoked `torn-ledger`, ran the four Process commands in order, delivered the report as printed.
- On disk afterwards: `data/snapshots/2026-08-23.json` (65 KB) and `data/reports/2026-08-23.md` (38 lines), both written at the run's timestamp. Delivered text matches the saved report line for line (the agent only dropped the inner code fences because it quoted the whole report inside one).
- Asked whether it computed or restyled any number itself: "no".
- Correctly read the first-run case as expected behaviour, citing the Edge Cases section, instead of treating "nothing to compare yet" as a failure.

No new rationalisation surfaced; nothing to close.
