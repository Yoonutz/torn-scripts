// occ-runner: executes repo skills for the Operational Command Center userscript.
// Route: GET /run/ledger[?force=1][&ai=1]  Authorization: Bearer <OCC_TOKEN>
// Secrets: TORN_API_KEY, OPENROUTER_API_KEY, OCC_TOKEN. KV: SNAPSHOTS.
import { deriveSnapshot, compare, render, pickBaseline } from "../../../.claude/skills/torn-ledger/scripts/lib.mjs";

const TORN = "https://api.torn.com/v2/";
const RAW = "https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const OR_MODEL = "openrouter/free";
const OR_FALLBACK = ["z-ai/glm-5.2:free", "cohere/north-mini-code:free", "google/gemma-4-26b-a4b-it:free"];
const REUSE_MS = 10 * 60 * 1000;

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
}

function authorized(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  return !!env.OCC_TOKEN && token === env.OCC_TOKEN;
}

async function tornGet(path, key) {
  const res = await fetch(TORN + path, { headers: { Authorization: "ApiKey " + key } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error ? body.error.code + " " + body.error.error : "HTTP " + res.status;
    throw new Error(path + " -> " + msg);
  }
  return body;
}

async function collect(key) {
  const raw = { taken_at: Math.floor(Date.now() / 1000) };
  const names = Object.keys(ENDPOINTS);
  const results = await Promise.all(names.map((n) => tornGet(ENDPOINTS[n], key)));
  names.forEach((n, i) => (raw[n] = results[i]));
  return raw;
}

async function listSnapshots(env) {
  const idx = (await env.SNAPSHOTS.get("ledger:index", "json")) || [];
  const rows = await Promise.all(idx.map((d) => env.SNAPSHOTS.get("ledger:" + d, "json")));
  return rows
    .filter(Boolean)
    .map((j) => deriveSnapshot(j.raw))
    .sort((a, b) => a.taken_at - b.taken_at);
}

async function saveSnapshot(env, raw) {
  const snap = deriveSnapshot(raw);
  await env.SNAPSHOTS.put("ledger:" + snap.date, JSON.stringify({ raw, stored_at: Date.now() }));
  const idx = (await env.SNAPSHOTS.get("ledger:index", "json")) || [];
  if (!idx.includes(snap.date)) {
    idx.push(snap.date);
    idx.sort();
    await env.SNAPSHOTS.put("ledger:index", JSON.stringify(idx));
  }
  return snap;
}

async function todayFresh(env) {
  const idx = (await env.SNAPSHOTS.get("ledger:index", "json")) || [];
  if (!idx.length) return null;
  const last = await env.SNAPSHOTS.get("ledger:" + idx[idx.length - 1], "json");
  if (!last || !last.stored_at || Date.now() - last.stored_at > REUSE_MS) return null;
  return last;
}

async function askModel(env, system, user) {
  if (!env.OPENROUTER_API_KEY) return null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(OR_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + env.OPENROUTER_API_KEY, "Content-Type": "application/json", "X-Title": "Operational Command Center" },
        body: JSON.stringify({
          model: OR_MODEL,
          models: OR_FALLBACK,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });
      const body = await res.json().catch(() => ({}));
      const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
      if (res.ok && text && text.trim()) return { text: text.trim(), model: body.model || OR_MODEL };
    } catch (e) {}
  }
  return null;
}

async function runLedger(req, env) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const ai = url.searchParams.get("ai") === "1";
  if (!env.TORN_API_KEY) return json({ error: "TORN_API_KEY secret missing" }, 500);

  let reused = false;
  let fresh = force ? null : await todayFresh(env);
  let current;
  if (fresh) {
    current = deriveSnapshot(fresh.raw);
    reused = true;
  } else {
    const raw = await collect(env.TORN_API_KEY);
    current = await saveSnapshot(env, raw);
  }

  const snapshots = await listSnapshots(env);
  const cur = snapshots.find((s) => s.date === current.date) || current;
  const baseline = pickBaseline(snapshots, cur);
  const history = snapshots.filter((s) => s.taken_at <= cur.taken_at && (!baseline || s.taken_at >= baseline.taken_at));
  const report = render(compare(baseline, cur), history);

  let answer = null;
  let model = null;
  if (ai) {
    const md = await fetch(RAW + ".claude/skills/torn-ledger/SKILL.md").then((r) => (r.ok ? r.text() : "")).catch(() => "");
    const system = md || "You deliver a Torn income report exactly as given.";
    const user =
      "The report below was produced by report.mjs from live data just now. Follow the skill's delivery rule: " +
      "output the report exactly as printed, unchanged, and put at most ONE sentence of judgement above it, only if a leak changes a decision. " +
      "Never recompute or restyle numbers. Plain hyphens only.\n\n" + report;
    const a = await askModel(env, system, user);
    if (a) {
      answer = a.text;
      model = a.model;
    }
  }

  return json({
    skill: "ledger",
    date: cur.date,
    baseline: baseline ? baseline.date : null,
    snapshots: snapshots.length,
    reused,
    report,
    answer,
    model,
  });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
    try {
      if (url.pathname === "/run/ledger" && req.method === "GET") return await runLedger(req, env);
      return json({ error: "unknown route" }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};
