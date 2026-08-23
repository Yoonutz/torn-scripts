import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveSnapshot, parseFundsNews, compare, render, pickBaseline, fmtMoney } from "../scripts/lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rawA = JSON.parse(readFileSync(join(here, "fixtures/raw-a.json"), "utf8"));
const rawB = JSON.parse(readFileSync(join(here, "fixtures/raw-b.json"), "utf8"));

test("parseFundsNews reads withdrawals and deposits with timestamps", () => {
  const rows = parseFundsNews([
    { text: "<a>KamiRen</a> has withdrawn $46,974,627 from the company funds", timestamp: 10 },
    { text: "<a>KamiRen</a> has made a deposit of $50,000,000 to the company funds", timestamp: 20 },
    { text: "<a>Someone</a> has been hired", timestamp: 30 },
  ]);
  assert.deepEqual(rows, [
    { ts: 10, amount: 46974627, kind: "withdraw" },
    { ts: 20, amount: 50000000, kind: "deposit" },
  ]);
});

test("deriveSnapshot flattens raw payloads into ledger metrics", () => {
  const s = deriveSnapshot(rawA);
  assert.equal(s.taken_at, 1786866000);
  assert.equal(s.networth.total, 14900000000);
  assert.equal(s.networth.inventory, 360815759);
  assert.equal(s.networth.faction, 345961670);
  assert.equal(s.bank.per_day, Math.round(115400000 / 30));
  assert.equal(s.bank.until, 1787663249);
  assert.deepEqual(s.stocks.ready, [{ id: 2, acronym: "TCI", payout: "$75,000,000" }]);
  assert.deepEqual(s.stocks.below_threshold, [
    { id: 3, acronym: "SYS", shares: 229119, requirement: 3000000, value: 151218540 },
  ]);
  assert.equal(s.stocks.below_threshold_value, 151218540);
  assert.equal(s.company.hired, 12);
  assert.equal(s.company.capacity, 12);
  assert.equal(s.company.wages_per_day, 300000);
  assert.equal(s.company.inactive_employees, 1);
  assert.equal(s.company.weak_employees, 0);
  assert.equal(s.company.funds, 20000000);
  assert.equal(s.company.fund_moves.length, 2);
  assert.equal(s.lifetime.bazaar_profit, 729422705);
  assert.equal(s.lifetime.bazaar_sales, 21757);
  assert.equal(s.lifetime.stock_payouts, 416);
});

test("deriveSnapshot sums several below-threshold positions", () => {
  const s = deriveSnapshot(rawB);
  assert.equal(s.stocks.below_threshold.length, 2);
  assert.equal(s.stocks.below_threshold_value, 151218540 + 252435810);
  assert.equal(s.company.weak_employees, 1);
  assert.equal(s.company.hired, 11);
});

test("compare computes per-day rates over the real gap and counts only in-window fund moves", () => {
  const c = compare(deriveSnapshot(rawA), deriveSnapshot(rawB));
  assert.equal(c.baseline, false);
  assert.equal(c.days, 7);
  assert.equal(c.networth.per_day, Math.round(86586771 / 7));
  assert.equal(c.company.net_per_day, Math.round(21758873 / 7));
  assert.equal(c.company.income_per_day, Math.round(20085325 / 7));
  assert.equal(c.company.income_per_day_prev, Math.round(18000000 / 7));
  assert.equal(c.inventory.delta, 322000000 - 360815759);
  assert.equal(c.bank.days_to_maturity, 2);
});

test("compare flags every known leak with an amount", () => {
  const c = compare(deriveSnapshot(rawA), deriveSnapshot(rawB));
  const kinds = c.leaks.map((l) => l.kind);
  for (const k of ["stock_payouts_ready", "company_slot_empty", "employee_inactive", "stocks_below_threshold", "unpaid_fees", "faction_idle", "vault_idle", "bank_maturing"]) {
    assert.ok(kinds.includes(k), "missing leak " + k);
  }
  assert.ok(!kinds.includes("bazaar_empty"), "bazaar leak excluded");
  const below = c.leaks.find((l) => l.kind === "stocks_below_threshold");
  assert.equal(below.amount, 403654350);
});

test("compare with no previous snapshot is a baseline report", () => {
  const c = compare(null, deriveSnapshot(rawB));
  assert.equal(c.baseline, true);
  assert.equal(c.days, null);
  assert.ok(c.leaks.length > 0);
});

test("pickBaseline prefers the newest snapshot at least 6 days older", () => {
  const snaps = [{ taken_at: 100 }, { taken_at: 100 + 5 * 86400 }, { taken_at: 100 + 8 * 86400 }, { taken_at: 100 + 14 * 86400 }];
  assert.equal(pickBaseline(snaps, snaps[3]), snaps[2]);
  assert.equal(pickBaseline([snaps[0], snaps[1]], snaps[1]), snaps[0]);
  assert.equal(pickBaseline([snaps[3]], snaps[3]), null);
});

test("render produces the agreed report shape", () => {
  const c = compare(deriveSnapshot(rawA), deriveSnapshot(rawB));
  const md = render(c, [deriveSnapshot(rawA), deriveSnapshot(rawB)]);
  assert.match(md, /^\*\*Torn Ledger - 2026-08-23\*\*/m);
  assert.match(md, /networth\s+.*M\/day/);
  assert.match(md, /company net/);
  assert.match(md, /bank interest/);
  assert.doesNotMatch(md, /bazaar/i, "bazaar excluded from report");
  assert.match(md, /Inventory:/);
  assert.match(md, /Leaks:/);
  assert.match(md, /Do this week:/);
  assert.match(md, /Trend since baseline:/);
  assert.ok(md.includes("█"), "bars present");
  assert.ok(!md.includes("░"), "no ░ in bars");
  assert.ok(!md.includes("—"), "no em dash");
});

test("render caps the leak list at 7 bullets and says how many more", () => {
  const c = compare(deriveSnapshot(rawA), deriveSnapshot(rawB));
  assert.ok(c.leaks.length > 7, "fixture must produce more than 7 leaks");
  const md = render(c, []);
  const section = md.split("Leaks:")[1].split("Do this week:")[0];
  const bullets = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, 7);
  assert.match(section, new RegExp("Plus " + (c.leaks.length - 7) + " smaller"));
});

test("render in baseline mode says there is nothing to compare yet", () => {
  const c = compare(null, deriveSnapshot(rawB));
  const md = render(c, [deriveSnapshot(rawB)]);
  assert.match(md, /first snapshot/i);
  assert.match(md, /Leaks:/);
});

test("fmtMoney rounds to M or B", () => {
  assert.equal(fmtMoney(3846667), "3.85M");
  assert.equal(fmtMoney(2115400000), "2.12B");
  assert.equal(fmtMoney(-38815759), "-38.82M");
  assert.equal(fmtMoney(721556), "0.72M");
});

test("passive benefits are never listed as payouts to collect", () => {
  const s = deriveSnapshot(rawA);
  assert.deepEqual(s.stocks.ready.map((r) => r.acronym), ["TCI"]);
});

test("deriveSnapshot locks shares needed for the kept increments and frees the rest", () => {
  const s = deriveSnapshot(rawA);
  const tct = s.stocks.positions_detail.find((p) => p.acronym === "TCT");
  assert.equal(tct.increment, 2);
  assert.equal(tct.protected_shares, 300000);
  assert.equal(tct.free_shares, 100000);
  assert.equal(tct.free_value, 30000000);
  const tci = s.stocks.positions_detail.find((p) => p.acronym === "TCI");
  assert.equal(tci.protected_shares, 1500000);
  assert.equal(tci.free_shares, 0);
  const sys = s.stocks.positions_detail.find((p) => p.acronym === "SYS");
  assert.equal(sys.protected_shares, 0);
  assert.equal(sys.free_shares, 229119);
  assert.deepEqual(s.stocks.protected.map((p) => p.acronym + " " + p.increment + "x"), ["TCI 1x", "IOU 1x", "TCT 2x", "WSU 1x"]);
  assert.equal(s.stocks.free_value, 30000000);
});

test("no leak ever asks to sell protected shares", () => {
  const c = compare(deriveSnapshot(rawA), deriveSnapshot(rawB));
  for (const l of c.leaks) {
    if (/sell/i.test(l.action)) assert.ok(!/TCT|TCI|WSU/.test(l.text), "protected stock named in sell leak: " + l.text);
  }
  const md = render(c, []);
  assert.match(md, /stock floors\s+4 locked \(TCT 2x, 3 at 1x\)/);
  assert.match(md, /30\.00M free above floor/);
});

test("the floor follows the active increment reported by the API, not a fixed number", () => {
  const raw = JSON.parse(JSON.stringify(rawA));
  const tct = raw.stocks.stocks.find((p) => p.id === 9);
  tct.shares = 800000;
  tct.bonus.increment = 3;
  let d = deriveSnapshot(raw).stocks.positions_detail.find((p) => p.acronym === "TCT");
  assert.equal(d.protected_shares, 700000);
  assert.equal(d.free_shares, 100000);
  tct.shares = 250000;
  tct.bonus.increment = 1;
  d = deriveSnapshot(raw).stocks.positions_detail.find((p) => p.acronym === "TCT");
  assert.equal(d.protected_shares, 100000);
  assert.equal(d.free_shares, 150000);
});
