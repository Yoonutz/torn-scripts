// Worker tests with fake Torn, KV and OpenRouter. Run: node --test "Operational Command Center/worker/test/runner.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";

await import("../build-registry.mjs");
const worker = (await import("../src/index.mjs")).default;
const { ranked } = await import("../src/ai/models.mjs");
const { isFree } = await import("../../../occ-kit/core/models.js");

function env(extra) {
  const kv = new Map();
  return {
    ALLOWED_PLAYERS: "2805199",
    SNAPSHOTS: {
      async get(k, t) {
        const v = kv.get(k);
        return v === undefined ? null : t === "json" ? JSON.parse(v) : v;
      },
      async put(k, v) {
        kv.set(k, v);
      },
    },
    kv,
    ...extra,
  };
}

// owner: player id Torn reports for the key; models: OpenRouter replies in order.
function fakeFetch({ owner = 2805199, models = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opt) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.torn.com/v2/user/basic")) return Response.json({ profile: { id: owner } });
    if (String(url) === "https://openrouter.ai/api/v1/key") return Response.json({ data: { usage: 0, free_model_daily_requests: { used: 12, limit: 1000, remaining: 988 } } });
    if (String(url).startsWith("https://openrouter.ai/")) {
      const body = JSON.parse(opt.body);
      assert.ok(isFree(body.model), "paid model called: " + body.model);
      const next = models.shift() || { status: 429 };
      return Response.json(next.text ? { choices: [{ message: { content: next.text } }], model: body.model } : { error: { message: "busy" } }, { status: next.status || 200 });
    }
    return Response.json({ error: { code: 9, error: "not faked: " + url } });
  };
  return calls;
}

const req = (path, init = {}) => new Request("https://runner.test" + path, { ...init, headers: { Authorization: "ApiKey TESTKEY", "CF-Connecting-IP": "1.2.3.4", ...(init.headers || {}) } });

test("skills list is public and carries the SKILL.md link", async () => {
  fakeFetch();
  const r = await worker.fetch(new Request("https://runner.test/skills"), env());
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.skills.find((s) => s.id === "ledger" && /SKILL\.md$/.test(s.md)));
});

test("a key owned by someone else is refused", async () => {
  fakeFetch({ owner: 1 });
  const r = await worker.fetch(req("/write", { method: "POST", body: JSON.stringify({ user: "hi" }) }), env({ OPENROUTER_KEY: "k" }));
  assert.equal(r.status, 403);
});

test("no key is refused before any Torn call", async () => {
  const calls = fakeFetch();
  const r = await worker.fetch(new Request("https://runner.test/write", { method: "POST", body: "{}" }), env());
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test("rate limit answers 429", async () => {
  fakeFetch();
  const r = await worker.fetch(req("/write", { method: "POST", body: JSON.stringify({ user: "hi" }) }), env({ RUN_PER_KEY: { limit: async () => ({ success: false }) } }));
  assert.equal(r.status, 429);
});

test("/write rotates past a busy model and remembers the one that answered", async () => {
  fakeFetch({ models: [{ status: 429 }, { text: "Answer." }] });
  const e = env({ OPENROUTER_KEY: "k" });
  const r = await worker.fetch(req("/write", { method: "POST", body: JSON.stringify({ system: "s", user: "u" }) }), e);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.answer, "Answer.");
  const h = JSON.parse(e.kv.get("ai:health"));
  assert.equal(h.last, j.model);
  assert.equal(Object.keys(h.cool).length, 1);
});

test("/write without any OpenRouter key says so", async () => {
  fakeFetch();
  const r = await worker.fetch(req("/write", { method: "POST", body: JSON.stringify({ user: "u" }) }), env());
  assert.equal(r.status, 503);
});

test("/write refuses oversized bodies", async () => {
  fakeFetch();
  const r = await worker.fetch(req("/write", { method: "POST", body: JSON.stringify({ user: "x".repeat(70000) }) }), env({ OPENROUTER_KEY: "k" }));
  assert.equal(r.status, 413);
});

test("unknown skill is 404, unknown route is 404", async () => {
  fakeFetch();
  assert.equal((await worker.fetch(req("/ask/nope"), env())).status, 404);
  assert.equal((await worker.fetch(req("/delete/ledger"), env())).status, 404);
});

test("model ranking: last good first, cooling ones last", () => {
  const now = Date.now();
  const order = ranked(["a:free", "b:free", "c:free"], { last: "c:free", cool: { "a:free": now + 1000 } });
  assert.deepEqual(order, ["c:free", "b:free", "a:free"]);
});

test("free-only guard", () => {
  assert.equal(isFree("openrouter/free"), true);
  assert.equal(isFree("google/gemma-4-31b-it:free"), true);
  assert.equal(isFree("openai/gpt-5"), false);
});

test("model calls are counted per UTC day and model, /usage returns 14 days plus OpenRouter's count", async () => {
  fakeFetch({ models: [{ status: 429 }, { status: 500 }, { text: "Answer." }] });
  const e = env({ OPENROUTER_KEY: "k" });
  await worker.fetch(req("/write", { method: "POST", body: JSON.stringify({ user: "u" }) }), e);
  const r = await worker.fetch(req("/usage"), e);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.days.length, 14);
  const today = j.days[13];
  assert.equal(today.day, new Date().toISOString().slice(0, 10));
  assert.deepEqual([today.ai.ok, today.ai.rl, today.ai.fail], [1, 1, 1]);
  assert.equal(Object.keys(today.ai.models).length, 3);
  assert.equal(j.live.used, 12);
  assert.equal(today.or.limit, 1000);
});

test("/usage is private like every other route", async () => {
  fakeFetch({ owner: 1 });
  assert.equal((await worker.fetch(req("/usage"), env())).status, 403);
});

test("hourly cron stores OpenRouter's count, and does nothing without a key", async () => {
  fakeFetch();
  const run = async (e) => {
    const waits = [];
    await worker.scheduled({}, e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  const e = env({ OPENROUTER_KEY: "k" });
  await run(e);
  assert.equal(JSON.parse(e.kv.get("usage:or:" + new Date().toISOString().slice(0, 10))).used, 12);
  const none = env();
  await run(none);
  assert.equal(none.kv.size, 0);
});
