// Pull today's money picture from the Torn API v2 and save it as a dated snapshot.
// Usage: node .claude/skills/torn-ledger/scripts/collect.mjs [--dry-run]
//   --dry-run  print the derived snapshot, write nothing
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { requireKey, SNAPSHOT_DIR } from "./env.mjs";
import { deriveSnapshot, fmtMoney } from "./lib.mjs";

const dryRun = process.argv.includes("--dry-run");
const key = requireKey();
const BASE = "https://api.torn.com/v2/";

async function get(path) {
  const res = await fetch(BASE + path, { headers: { Authorization: "ApiKey " + key } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error ? json.error.code + " " + json.error.error : "HTTP " + res.status;
    throw new Error(path + " -> " + msg);
  }
  return json;
}

const ENDPOINTS = {
  money: "user/money",
  networth: "user?selections=networth",
  stocks: "user/stocks",
  torn_stocks: "torn/stocks",
  investments: "user/personalstats?cat=investments",
  trading: "user/personalstats?cat=trading",
  company_profile: "company/profile",
  company_news: "company/news?cat=funds&sort=DESC",
  company_employees: "company/employees",
};

const raw = { taken_at: Math.floor(Date.now() / 1000) };
for (const [name, path] of Object.entries(ENDPOINTS)) {
  try {
    raw[name] = await get(path);
  } catch (e) {
    console.error("collect failed: " + e.message);
    process.exit(1);
  }
}

const snapshot = deriveSnapshot(raw);
console.error(
  [
    "snapshot " + snapshot.date,
    "networth " + fmtMoney(snapshot.networth.total),
    "company weekly " + fmtMoney(snapshot.company.weekly_income) + " (" + snapshot.company.hired + "/" + snapshot.company.capacity + " staff)",
    "bank " + fmtMoney(snapshot.bank.amount) + " at " + fmtMoney(snapshot.bank.per_day) + "/day",
    "stocks ready " + snapshot.stocks.ready.length + ", below threshold " + fmtMoney(snapshot.stocks.below_threshold_value),
  ].join(" | ")
);

if (dryRun) {
  console.log(JSON.stringify(snapshot, null, 2));
  console.error("dry run: nothing written");
  process.exit(0);
}

mkdirSync(SNAPSHOT_DIR, { recursive: true });
const file = resolve(SNAPSHOT_DIR, snapshot.date + ".json");
if (existsSync(file)) console.error("overwriting today's snapshot " + file);
writeFileSync(file, JSON.stringify({ snapshot, raw }, null, 2));
console.log(file);
