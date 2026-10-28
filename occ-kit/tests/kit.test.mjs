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
