// occ-kit tests: markdown output, free-only guard, build up to date. Run: node --test occ-kit/tests/kit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { mdToHtml, mdSections } from "../core/md.js";
import { isFree, MODELS_FREE } from "../core/models.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("tables render with a header row", () => {
  const h = mdToHtml("| Item | Loss |\n|---|---|\n| Cash | 1.2M |");
  assert.match(h, /<thead><tr><th>Item<\/th><th>Loss<\/th><\/tr><\/thead>/);
  assert.match(h, /<td>Cash<\/td><td>1\.2M<\/td>/);
});

test("only https links become links, and they open in a new tab", () => {
  assert.match(mdToHtml("[Torn](https://www.torn.com)"), /<a href="https:\/\/www\.torn\.com" target="_blank" rel="noopener noreferrer">Torn<\/a>/);
  assert.doesNotMatch(mdToHtml("[x](javascript:alert(1))"), /<a /);
});

test("markup in model text is escaped", () => {
  assert.doesNotMatch(mdToHtml("<img src=x onerror=alert(1)>"), /<img/);
});

test("sections split on headings", () => {
  const s = mdSections("intro\n## Leaks\n- a\n## Actions\n- b");
  assert.deepEqual(s.map((x) => x.title), [null, "Leaks", "Actions"]);
});

test("model list is free only", () => {
  assert.ok(MODELS_FREE.every(isFree));
  assert.equal(isFree("anthropic/claude-x"), false);
});

test("built userscripts match their sources", () => {
  execFileSync(process.execPath, [resolve(repo, "occ-kit/build.mjs"), "--check"], { stdio: "pipe" });
});

test("Keys tab merges Torn key logs without double counting and flags missed calls", async () => {
  const { mergeLog } = await import("../../Operational Command Center/plugins/keys.js");
  const t0 = Date.UTC(2026, 9, 28, 10, 0, 0) / 1000;
  const e = (ts, sel, ip, comment) => ({ timestamp: ts, type: sel === "log" ? "key" : "user", selections: sel, id: 1, ip, comment: comment || null });
  const first = [e(t0 + 70, "log", "1.x"), e(t0 + 65, "bars", "1.x"), e(t0 + 65, "bars", "9.x"), e(t0 + 10, "bars", "1.x")];
  let h = mergeLog(null, first, (t0 + 80) * 1000);
  const day = "2026-10-28";
  assert.equal(h.days[day].n, 4);
  assert.equal(h.days[day].peak, 3);
  assert.equal(h.days[day].src["elsewhere\u0001user bars"], 1);
  // Second read overlaps the first: only the two new calls count, peak merges across both reads.
  h = mergeLog(h, [e(t0 + 100, "log", "1.x", "OCC"), e(t0 + 90, "bars", "1.x")].concat(first), (t0 + 110) * 1000);
  assert.equal(h.days[day].n, 6);
  assert.equal(h.days[day].peak, 5);
  assert.ok(!h.days[day].gap);
  // A full log that starts after the last call seen: calls were missed, the day is a lower bound.
  const full = Array.from({ length: 100 }, (_, i) => e(t0 + 3600 + i, "bars", "1.x"));
  h = mergeLog(h, full, (t0 + 3700) * 1000);
  assert.equal(h.days[day].n, 106);
  assert.equal(h.days[day].gap, true);
});

test("Keys tab: a missed stretch across midnight marks every day and never throws", async () => {
  const { mergeLog } = await import("../../Operational Command Center/plugins/keys.js");
  const last = Date.UTC(2026, 9, 28, 23, 0, 0) / 1000;
  const e = (ts) => ({ timestamp: ts, type: "user", selections: "bars", id: 1, ip: "1.x", comment: null });
  let h = mergeLog(null, [e(last)], last * 1000);
  // Next read the following morning, 100 calls all after the last one seen (the 0.8.19 crash).
  const full = Array.from({ length: 100 }, (_, i) => e(last + 9 * 3600 + i * 20));
  h = mergeLog(h, full, (last + 10 * 3600) * 1000);
  assert.equal(h.days["2026-10-28"].gap, true);
  assert.equal(h.days["2026-10-29"].gap, true);
  assert.equal(h.days["2026-10-29"].n, 100);
});

test("Trains tab: parses Torn news and events, counts paid trains left per employee", async () => {
  const P = await import("../../Operational Command Center/plugins/paid.js");
  const tr = P.parseTraining({ id: "a1", timestamp: 200, text: "Consultant <a href = http://www.torn.com/profiles.php?XID=2239897>Hookah12</a> has been trained by the director" });
  assert.deepEqual(tr, ["a1", 200, "2239897", "Hookah12"]);
  assert.equal(P.parseTraining({ id: "x", timestamp: 1, text: "Tuesday report: We had a total of 157 customers" }), null);
  const pay = P.parsePayment({ id: "e1", timestamp: 150, event: 'You were sent $100,000,000 from <a href="https://www.torn.com/profiles.php?XID=2239897">Hookah12</a> with the message: Train me boss' });
  assert.deepEqual(pay, { id: "e1", ts: 150, emp: "2239897", name: "Hookah12", msg: "Train me boss", money: 100000000 });
  const bare = P.parsePayment({ id: "e2", timestamp: 160, event: 'You were sent $10,500,000 from <a href="https://www.torn.com/profiles.php?XID=2239897">Hookah12</a>.' });
  assert.equal(bare.msg, "");
  assert.equal(bare.money, 10500000);
  const items = P.parsePayment({ id: "e3", timestamp: 170, event: 'You were sent 102x Camel Plushie from <a href="https://www.torn.com/profiles.php?XID=3783283">Keoholodeee</a> with the message: Fcking trains' });
  assert.equal(items.items, "102x Camel Plushie");
  assert.equal(items.money, undefined);
  assert.equal(P.parsePayment({ id: "e4", timestamp: 1, event: "Someone mugged you and stole $23,257 [view]" }), null);

  // Torn's from= is inclusive: the same second comes back on the next page and is dropped.
  const cache = { list: [] };
  assert.equal(P.addPage(cache, [["n1", 100, "1"], ["n2", 100, "1"]]), 2);
  assert.equal(P.addPage(cache, [["n2", 100, "1"], ["n3", 101, "2"]]), 1);
  assert.equal(cache.list.length, 3);

  const staff = [{ id: "2239897", name: "Hookah12" }, { id: "3783283", name: "Keoholodeee" }, { id: "9", name: "Alex" }];
  const l = P.newLedger(100);
  l.emp["2239897"] = { carry: -527, start: 120 };
  l.emp["9"] = { daily: true };
  const ev = [pay, bare, items, { id: "old", ts: 50, emp: "2239897", name: "Hookah12", money: 5, msg: "train" }, { id: "x", ts: 150, emp: "777", name: "Stranger", money: 5, msg: "train" }];
  // Inbox: since tracking began, staff only, not decided yet.
  assert.deepEqual(P.inbox(l, ev, staff).map((p) => p.id), ["e1", "e2", "e3"]);
  assert.equal(P.autoTrains(l, pay), 200);
  assert.equal(P.autoTrains(l, bare), 0);
  assert.equal(P.autoTrains(l, items), 0);
  l.pays.push({ id: "e1", emp: "2239897", ts: 150, money: 100000000, trains: 200 });
  l.skip.push("e2");
  assert.deepEqual(P.inbox(l, ev, staff).map((p) => p.id), ["e3"]);
  l.hold.push("e1");
  assert.equal(P.autoTrains(l, pay), 0);
  const news = [["t0", 110, "2239897"], ["t1", 130, "2239897"], ["t2", 140, "2239897"], ["t3", 145, "3783283"]];
  const b = P.balances(l, news, staff);
  assert.equal(b["2239897"].left, -527 + 200 - 2);
  assert.equal(b["3783283"].left, -1);
  assert.equal(b["9"].daily, true);
  // Free (pro bono): no balance, never owing.
  l.emp["2239897"].daily = true;
  assert.equal(P.balances(l, news, staff)["2239897"].left, 0);
  delete l.emp["2239897"].daily;
  assert.equal(P.parsePrice("600k"), 600000);
  assert.equal(P.parsePrice("$600,000"), 600000);
  assert.equal(P.parsePrice("0.6m"), 600000);
  assert.deepEqual(P.parsePay("60m", 600000), { money: 60000000, trains: 100 });
  assert.deepEqual(P.parsePay("100t", 600000), { money: 0, trains: 100 });
  assert.deepEqual(P.parsePay("7 trains", 600000), { money: 0, trains: 7 });
  assert.equal(P.parsePay("100k", 600000), null);
  assert.equal(P.parsePay("abc", 600000), null);
  const pd = P.perDay([["a", 86400 * 10 + 5, "7"], ["b", 86400 * 10 + 9, "7"], ["c", 86400 * 12, "7"], ["d", 86400 * 12, "8"]], "7", 86400 * 9, 86400 * 12 + 100, 7);
  assert.deepEqual(pd.map((d) => d.n), [0, 2, 0, 1]);
  assert.equal(P.perDay([], "7", 0, 86400 * 30, 7).length, 7);
  const qb = { 7: { used: 3, left: 5 }, 8: { used: 1, left: 0, daily: true } };
  const q = { 7: { n: 2, base: 3, at: 1000 }, 8: { n: 1, base: 1, at: 1000 }, 9: { n: 1, base: 0, at: 1000 } };
  P.addQuick(qb, q, 2000);
  assert.deepEqual([qb[7].used, qb[7].left, qb[8].used, qb[8].left], [5, 3, 2, 0]);
  assert.ok(!q[9]);
  const q2 = { 7: { n: 2, base: 3, at: 1000 } };
  P.addQuick({ 7: { used: 5, left: 3 } }, q2, 2000);
  assert.ok(!q2[7]);
  const q3 = { 7: { n: 1, base: 3, at: 0 } };
  P.addQuick({ 7: { used: 3, left: 5 } }, q3, 60000);
  assert.ok(!q3[7]);
  assert.equal(P.parsePrice("600000"), 600000);
  assert.equal(P.parsePrice("abc"), 0);
  assert.equal(P.parsePrice("5"), 0);
  assert.equal(P.needFrom(l), 100);

  const imp = P.fromSnapshot({ updatedAtIso: "2026-10-28T14:25:02.000Z", paidTrainsLeftByEmployee: { Hookah12: -527, Alex: -1, Keoholodeee: "" } }, staff);
  assert.equal(imp.at, Date.UTC(2026, 9, 28, 14, 25, 2) / 1000);
  assert.deepEqual(imp.rows, [
    { id: "2239897", name: "Hookah12", carry: -527, daily: false },
    { id: "3783283", name: "Keoholodeee", carry: 0, daily: false },
    { id: "9", name: "Alex", carry: 0, daily: true },
  ]);
});

test("live manifest names the bundle next to it, and the loader carries the same build", () => {
  const dir = resolve(repo, "Operational Command Center");
  const bundle = readFileSync(resolve(dir, "live/occ.bundle.js"), "utf8");
  const m = JSON.parse(readFileSync(resolve(dir, "live/occ.manifest.json"), "utf8"));
  assert.equal(createHash("sha256").update(bundle).digest("hex"), m.sha256);
  assert.equal(m.sha256.slice(0, m.id.length), m.id);
  assert.match(readFileSync(resolve(dir, "operational-command-center.user.js"), "utf8"), new RegExp("const OCC_BAKED = '" + m.id + "';"));
});
