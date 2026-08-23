// Render the Torn Ledger report from saved snapshots: latest vs the newest one at least 6 days older.
// Usage: node .claude/skills/torn-ledger/scripts/report.mjs [--dry-run] [--date YYYY-MM-DD] [--since YYYY-MM-DD]
//   --dry-run   print the report, write nothing
//   --date      report for this snapshot instead of the latest
//   --since     force this snapshot as the comparison baseline
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { SNAPSHOT_DIR, REPORT_DIR } from "./env.mjs";
import { compare, render, pickBaseline, deriveSnapshot } from "./lib.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

if (!existsSync(SNAPSHOT_DIR)) {
  console.error("no snapshots yet; run collect.mjs first");
  process.exit(1);
}
const snapshots = readdirSync(SNAPSHOT_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(resolve(SNAPSHOT_DIR, f), "utf8")))
  .map((j) => (j.raw ? deriveSnapshot(j.raw) : j.snapshot))
  .sort((a, b) => a.taken_at - b.taken_at);
if (!snapshots.length) {
  console.error("no snapshots yet; run collect.mjs first");
  process.exit(1);
}

const wantDate = flag("--date");
const current = wantDate ? snapshots.find((s) => s.date === wantDate) : snapshots[snapshots.length - 1];
if (!current) {
  console.error("no snapshot for " + wantDate);
  process.exit(1);
}
const since = flag("--since");
let baseline;
if (since) {
  baseline = snapshots.find((s) => s.date === since);
  if (!baseline) {
    console.error("no snapshot for " + since);
    process.exit(1);
  }
} else {
  baseline = pickBaseline(snapshots, current);
}

const history = snapshots.filter((s) => s.taken_at <= current.taken_at && (!baseline || s.taken_at >= baseline.taken_at));
const md = render(compare(baseline, current), history);
process.stdout.write(md);

if (dryRun) {
  console.error("dry run: nothing written");
  process.exit(0);
}
mkdirSync(REPORT_DIR, { recursive: true });
const file = resolve(REPORT_DIR, current.date + ".md");
writeFileSync(file, md);
console.error("saved " + file);
