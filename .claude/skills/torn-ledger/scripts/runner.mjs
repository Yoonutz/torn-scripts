// Runner entry for the Operational Command Center. Picked up automatically by the occ-runner
// Worker build: every `.claude/skills/<skill>/scripts/runner.mjs` becomes a button.
// Contract: export `skill` = { id, label, description, icon?, run(ctx) }.
//   ctx.key      caller's Torn API key (never stored)
//   ctx.tornGet  (path) => JSON from Torn API v2 with that key
//   ctx.db       { index(), get(name), put(name, value) } scoped to this skill and key
//   ctx.force    true when the caller asked to re-collect
// Must stay pure browser-grade JavaScript: no fs, no Node modules, only fetch.
import { deriveSnapshot, compare, render, pickBaseline, fmtMoney } from "./lib.mjs";

const REUSE_MS = 10 * 60 * 1000;

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

async function listSnapshots(db) {
  const idx = await db.index();
  const rows = await Promise.all(idx.map((d) => db.get(d)));
  return rows
    .filter(Boolean)
    .map((j) => deriveSnapshot(j.raw))
    .sort((a, b) => a.taken_at - b.taken_at);
}

async function todayFresh(db) {
  const idx = await db.index();
  if (!idx.length) return null;
  const last = await db.get(idx[idx.length - 1]);
  if (!last || !last.stored_at || Date.now() - last.stored_at > REUSE_MS) return null;
  return last;
}

export const skill = {
  id: "ledger",
  label: "Ledger",
  description: "Runs this skill's scripts (collect, then report) with live Torn data and returns the printed markdown report plus date, baseline date and snapshot count.",
  icon: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  async run(ctx) {
    let reused = false;
    const fresh = ctx.force ? null : await todayFresh(ctx.db);
    let current;
    if (fresh) {
      current = deriveSnapshot(fresh.raw);
      reused = true;
    } else {
      const raw = await collect(ctx.tornGet);
      current = deriveSnapshot(raw);
      await ctx.db.put(current.date, { raw, stored_at: Date.now() });
    }
    const snapshots = await listSnapshots(ctx.db);
    const cur = snapshots.find((s) => s.date === current.date) || current;
    const baseline = pickBaseline(snapshots, cur);
    const history = snapshots.filter((s) => s.taken_at <= cur.taken_at && (!baseline || s.taken_at >= baseline.taken_at));
    const report = render(compare(baseline, cur), history);
    const stats = [
      { k: "Networth", v: fmtMoney(cur.networth.total) },
      { k: "Bank /day", v: fmtMoney(cur.bank.per_day), hot: true },
      { k: "Company /day", v: fmtMoney(Math.round(cur.company.weekly_income / 7)) },
    ];
    return { date: cur.date, baseline: baseline ? baseline.date : null, snapshots: snapshots.length, reused, report, stats };
  },
};

// CLI mode, same E-script contract as the siblings: node runner.mjs [--dry-run]
// Uses the repo-root key, keeps snapshots in memory, writes nothing, prints the report.
const isCli = typeof process !== "undefined" && Array.isArray(process.argv) && /runner\.mjs$/.test(process.argv[1] || "");
if (isCli) {
  const envModule = "./env" + ".mjs";
  const { requireKey } = await import(envModule);
  const key = requireKey();
  const mem = {};
  const db = {
    async index() {
      return Object.keys(mem).sort();
    },
    async get(name) {
      return mem[name] || null;
    },
    async put(name, value) {
      mem[name] = value;
    },
  };
  const tornGet = async (path) => {
    const res = await fetch("https://api.torn.com/v2/" + path, { headers: { Authorization: "ApiKey " + key } });
    const body = await res.json().catch(() => ({}));
    if (body.error) throw new Error(path + " -> " + body.error.code + " " + body.error.error);
    if (!res.ok) throw new Error(path + " -> HTTP " + res.status);
    return body;
  };
  try {
    const out = await skill.run({ key, tornGet, db, force: true });
    process.stdout.write(out.report);
    console.error("runner: " + out.date + " | snapshots " + out.snapshots + " | nothing written (dry by design)");
  } catch (e) {
    console.error("runner failed: " + e.message);
    process.exit(1);
  }
}
