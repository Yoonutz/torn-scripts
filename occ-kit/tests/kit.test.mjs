// occ-kit tests: markdown output, free-only guard, build up to date. Run: node --test occ-kit/tests/kit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
