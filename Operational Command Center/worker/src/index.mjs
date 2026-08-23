// occ-runner: executes repo skills for the Operational Command Center userscript.
// Routes:
//   GET /skills                 public list of skills (id, label, description, icon, md URL)
//   GET /run/<id>[?force=1]     Authorization: ApiKey <Torn API key>
// The caller's Torn key is the credential: used for the Torn calls, never stored.
// Snapshots live in KV under <skill>:<hash of key>:<name>, so every key has its own history.
// Skills come from src/registry.mjs, generated at build time from .claude/skills/*/scripts/runner.mjs.
import { SKILLS, SOURCES } from "./registry.mjs";

const TORN = "https://api.torn.com/v2/";
const RAW = "https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/";

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

function tornClient(key) {
  return async (path) => {
    const res = await fetch(TORN + path, { headers: { Authorization: "ApiKey " + key } });
    const body = await res.json().catch(() => ({}));
    if (body.error) throw new TornError(path, body.error.code, body.error.error);
    if (!res.ok) throw new TornError(path, 0, "HTTP " + res.status);
    return body;
  };
}

function store(env, prefix) {
  const k = (name) => prefix + ":" + name;
  return {
    async index() {
      return (await env.SNAPSHOTS.get(k("index"), "json")) || [];
    },
    async get(name) {
      return env.SNAPSHOTS.get(k(name), "json");
    },
    async put(name, value) {
      await env.SNAPSHOTS.put(k(name), JSON.stringify(value));
      const idx = await this.index();
      if (!idx.includes(name)) {
        idx.push(name);
        idx.sort();
        await env.SNAPSHOTS.put(k("index"), JSON.stringify(idx));
      }
    },
  };
}

function skillList() {
  const folders = Object.keys(SOURCES);
  return SKILLS.map((s, i) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    icon: s.icon || null,
    md: RAW + SOURCES[folders[i]],
  }));
}

async function runSkill(req, env, key, skill) {
  const url = new URL(req.url);
  const ctx = {
    key,
    force: url.searchParams.get("force") === "1",
    tornGet: tornClient(key),
    db: store(env, skill.id + ":" + (await keyHash(key))),
  };
  const out = await skill.run(ctx);
  return json({ skill: skill.id, ...out });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true, skills: SKILLS.length });
    if (url.pathname === "/skills") return json({ skills: skillList() });
    const m = url.pathname.match(/^\/run\/([a-z0-9_-]+)$/);
    if (!m || req.method !== "GET") return json({ error: "unknown route" }, 404);
    const skill = SKILLS.find((s) => s.id === m[1]);
    if (!skill) return json({ error: "unknown skill " + m[1] }, 404);
    const key = tornKey(req);
    if (!key) return json({ error: "No Torn API key sent" }, 401);
    try {
      return await runSkill(req, env, key, skill);
    } catch (e) {
      if (e instanceof TornError && e.code === 2) return json({ error: "Torn rejected the API key" }, 401);
      if (e instanceof TornError) return json({ error: "Torn API: " + e.message }, 502);
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};
