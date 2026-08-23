// Runner entry for the Operational Command Center. Picked up automatically by the occ-runner
// Worker build: every `.claude/skills/<skill>/scripts/runner.mjs` becomes a button.
// Contract: export `skill` = { id, label, description, icon?, run(ctx) }.
//   ctx.key      caller's Torn API key (never stored)
//   ctx.tornGet  (path) => JSON from Torn API v2 with that key
//   ctx.db       { index(), get(name), put(name, value) } scoped to this skill and key
//   ctx.force    true when the caller asked to re-collect
// Must stay pure browser-grade JavaScript: no fs, no Node modules, only fetch.
//
// This runner is deliberately STATELESS (Kami's call, 2026-08-24): live financial data is
// collected, analyzed, returned, and discarded in the same request. Nothing is written to
// ctx.db, so no snapshot ever persists outside his own machine. The cost is accepted: the
// Command Center report has no baseline, so it never shows deltas. Weekly trend reporting
// stays on the desktop ledger, whose history lives only in the local repo.
import { deriveSnapshot, compare, render, fmtMoney } from "./lib.mjs";

export const ENDPOINTS = {
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

export async function collect(tornGet) {
  const raw = { taken_at: Math.floor(Date.now() / 1000) };
  const names = Object.keys(ENDPOINTS);
  const results = await Promise.all(names.map((n) => tornGet(ENDPOINTS[n])));
  names.forEach((n, i) => (raw[n] = results[i]));
  return raw;
}

export const skill = {
  id: "ledger",
  label: "Ledger",
  description: "Collects live Torn data, runs this skill's report script on it and returns the printed markdown report. Stateless: every run is a fresh collection, nothing is stored.",
  icon: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  async run(ctx) {
    const raw = await collect(ctx.tornGet);
    const cur = deriveSnapshot(raw);
    const report = render(compare(null, cur), [cur]);
    const stats = [
      { k: "Networth", v: fmtMoney(cur.networth.total) },
      { k: "Bank /day", v: fmtMoney(cur.bank.per_day), hot: true },
      { k: "Company /day", v: fmtMoney(Math.round(cur.company.weekly_income / 7)) },
    ];
    return { date: cur.date, baseline: null, snapshots: 0, reused: false, report, stats };
  },
};

// CLI mode, same E-script contract as the siblings: node runner.mjs
// Uses the repo-root key, writes nothing, prints the report.
const isCli = typeof process !== "undefined" && Array.isArray(process.argv) && /runner\.mjs$/.test(process.argv[1] || "");
if (isCli) {
  const envModule = "./env" + ".mjs";
  const { requireKey } = await import(envModule);
  const key = requireKey();
  const tornGet = async (path) => {
    const res = await fetch("https://api.torn.com/v2/" + path, { headers: { Authorization: "ApiKey " + key } });
    const body = await res.json().catch(() => ({}));
    if (body.error) throw new Error(path + " -> " + body.error.code + " " + body.error.error);
    if (!res.ok) throw new Error(path + " -> HTTP " + res.status);
    return body;
  };
  try {
    const out = await skill.run({ key, tornGet, db: null, force: true });
    process.stdout.write(out.report);
    console.error("runner: " + out.date + " | stateless, nothing written");
  } catch (e) {
    console.error("runner failed: " + e.message);
    process.exit(1);
  }
}
