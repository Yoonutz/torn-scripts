// occ-runner: executes repo skills for the Operational Command Center userscript.
// Route: GET /run/ledger[?force=1]  Authorization: ApiKey <Torn API key>
// The caller's Torn key is the credential: it is used for the Torn calls and never stored.
// Snapshots live in KV under a hash of the key, so every key has its own history.
import { deriveSnapshot, compare, render, pickBaseline } from "../../../.claude/skills/torn-ledger/scripts/lib.mjs";

const TORN = "https://api.torn.com/v2/";
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

function tornKey(req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^(?:ApiKey|Bearer)\s+(\S+)$/i);
  return m ? m[1] : "";
}

async function keyHash(key) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

class TornError extends Error {
  constructor(path, code, msg) {
    super(path + " -> " + code + " " + msg);
    this.code = code;
  }
}

async function tornGet(path, key) {
  const res = await fetch(TORN + path, { headers: { Authorization: "ApiKey " + key } });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new TornError(path, body.error.code, body.error.error);
  if (!res.ok) throw new TornError(path, 0, "HTTP " + res.status);
  return body;
}

async function collect(key) {
  const raw = { taken_at: Math.floor(Date.now() / 1000) };
  const names = Object.keys(ENDPOINTS);
  const results = await Promise.all(names.map((n) => tornGet(ENDPOINTS[n], key)));
  names.forEach((n, i) => (raw[n] = results[i]));
  return raw;
}

function store(env, prefix) {
  const k = (name) => prefix + ":" + name;
  return {
    async index() {
      return (await env.SNAPSHOTS.get(k("index"), "json")) || [];
    },
    async get(date) {
      return env.SNAPSHOTS.get(k(date), "json");
    },
    async put(date, value) {
      await env.SNAPSHOTS.put(k(date), JSON.stringify(value));
      const idx = await this.index();
      if (!idx.includes(date)) {
        idx.push(date);
        idx.sort();
        await env.SNAPSHOTS.put(k("index"), JSON.stringify(idx));
      }
    },
  };
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

async function runLedger(req, env, key) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const db = store(env, "ledger:" + (await keyHash(key)));

  let reused = false;
  const fresh = force ? null : await todayFresh(db);
  let current;
  if (fresh) {
    current = deriveSnapshot(fresh.raw);
    reused = true;
  } else {
    const raw = await collect(key);
    current = deriveSnapshot(raw);
    await db.put(current.date, { raw, stored_at: Date.now() });
  }

  const snapshots = await listSnapshots(db);
  const cur = snapshots.find((s) => s.date === current.date) || current;
  const baseline = pickBaseline(snapshots, cur);
  const history = snapshots.filter((s) => s.taken_at <= cur.taken_at && (!baseline || s.taken_at >= baseline.taken_at));
  const report = render(compare(baseline, cur), history);

  return json({
    skill: "ledger",
    date: cur.date,
    baseline: baseline ? baseline.date : null,
    snapshots: snapshots.length,
    reused,
    report,
  });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true });
    const key = tornKey(req);
    if (!key) return json({ error: "No Torn API key sent" }, 401);
    try {
      if (url.pathname === "/run/ledger" && req.method === "GET") return await runLedger(req, env, key);
      return json({ error: "unknown route" }, 404);
    } catch (e) {
      if (e instanceof TornError && e.code === 2) return json({ error: "Torn rejected the API key" }, 401);
      if (e instanceof TornError) return json({ error: "Torn API: " + e.message }, 502);
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};
