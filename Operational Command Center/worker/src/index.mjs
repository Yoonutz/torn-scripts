// occ-runner: executes repo skills for the Operational Command Center userscript.
// Routes:
//   GET /skills                 public list of skills (id, label, description, icon, access, md URL)
//   GET /run/<id>[?force=1]     Authorization: ApiKey <Torn API key>; rate limited per key and per IP
//   GET /ask/<id>[?force=1]     same, then one free-model call turns the report into the answer.
//                               OpenRouter key: env.OPENROUTER_KEY, else the X-OpenRouter-Key header.
// The caller's Torn key is the credential: used for the Torn calls, never stored. Only keys
// owned by a player in ALLOWED_PLAYERS (wrangler.toml) may run anything; others get 403.
// Snapshots live in KV under <skill>:<hash of key>:<name>, so every key has its own history.
// Skills come from src/registry.mjs, generated at build time from .claude/skills/*/scripts/runner.mjs.
import { SKILLS, SOURCES } from "./registry.mjs";

const TORN = "https://api.torn.com/v2/";
const RAW = "https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
// Free models only, best first (big context windows, tool-free since the runner already ran
// the script). isFree() guards every call, so a paid model can never be billed.
const MODELS_DEFAULT = [
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "google/gemma-4-31b-it:free",
  "cohere/north-mini-code:free",
  "openrouter/free",
];
const MAX_TRIES = 4;
const MODEL_TIMEOUT = 40000;
const COOL_MS = 10 * 60000; // a model that failed is tried last for 10 minutes
const BUDGET = 60000; // characters of skill rules + report sent to the model

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-OpenRouter-Key",
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
    access: s.access || "full",
    md: RAW + SOURCES[folders[i]],
  }));
}

// Who owns this key, asked from Torn itself (user/basic works with any access level).
// Cached per key hash for a day so normal runs cost no extra Torn call.
async function keyOwner(env, key, hash) {
  const cached = await env.SNAPSHOTS.get("auth:" + hash);
  if (cached) return cached;
  const body = await tornClient(key)("user/basic");
  const id = body && body.profile && body.profile.id ? String(body.profile.id) : "";
  if (id) await env.SNAPSHOTS.put("auth:" + hash, id, { expirationTtl: 86400 });
  return id;
}

function allowed(env, id) {
  return String(env.ALLOWED_PLAYERS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .includes(id);
}

function isFree(id) {
  return id === "openrouter/free" || /:free$/.test(id);
}

function modelList(env) {
  const list = env.MODELS ? String(env.MODELS).split(",") : MODELS_DEFAULT;
  return list.map((x) => x.trim()).filter(isFree);
}

// Model health, shared by every run: the last model that answered goes first, models that
// failed in the last 10 minutes go last. One small KV value, written only when it changes.
async function health(env) {
  const h = (await env.SNAPSHOTS.get("ai:health", "json")) || {};
  const now = Date.now();
  const cool = {};
  Object.keys(h.cool || {}).forEach((m) => {
    if (h.cool[m] > now) cool[m] = h.cool[m];
  });
  return { last: h.last || "", cool };
}

function ranked(models, h) {
  const now = Date.now();
  const ready = models.filter((m) => !(h.cool[m] > now));
  const cooling = models.filter((m) => h.cool[m] > now).sort((a, b) => h.cool[a] - h.cool[b]);
  ready.sort((a, b) => (a === h.last ? -1 : b === h.last ? 1 : 0));
  return ready.concat(cooling);
}

// The model only needs the skill's rules for reading and delivering the report, not the
// CLI sections, and the report itself. Both are kept inside a fixed budget.
function context(md, report) {
  const rules = String(md || "")
    .split(/(?=^## )/m)
    .filter((sec) => !/^## (Scripts|Environment|Inputs)\b/.test(sec))
    .join("")
    .trim();
  let body = String(report || "");
  const room = BUDGET - rules.length;
  if (body.length > room) body = body.slice(0, Math.max(0, room)) + "\n\n[report cut to fit]";
  return {
    system: rules,
    user: "Here is the output of this skill's script, collected just now. Deliver it exactly as the skill's delivery rule says. Plain hyphens only.\n\n" + body,
  };
}

async function answer(env, folder, report, orKey) {
  const key = env.OPENROUTER_KEY || orKey;
  if (!key) return { text: report, model: "runner (no OpenRouter key)" };
  const md = await fetch(RAW + SOURCES[folder])
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  const { system, user } = context(md, report);
  const h = await health(env);
  const before = JSON.stringify(h);
  const save = () => (JSON.stringify(h) !== before ? env.SNAPSHOTS.put("ai:health", JSON.stringify(h)) : null);
  const errors = [];
  for (const model of ranked(modelList(env), h).slice(0, MAX_TRIES)) {
    try {
      const res = await fetch(OR_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "Operational Command Center" },
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 2500, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(MODEL_TIMEOUT),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        errors.push("OpenRouter rejected the key");
        break;
      }
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      const text = msg && msg.content ? String(msg.content).trim() : "";
      if (res.ok && text) {
        h.last = model;
        delete h.cool[model];
        await save();
        return { text, model: j.model || model };
      }
      h.cool[model] = Date.now() + COOL_MS;
      errors.push(model + ": " + res.status + " " + ((j.error && j.error.message) || "empty reply"));
    } catch (e) {
      h.cool[model] = Date.now() + COOL_MS;
      errors.push(model + ": " + (e && e.name === "TimeoutError" ? "timeout" : String((e && e.message) || e)));
    }
  }
  await save();
  return { text: report, model: "runner (free models busy)", errors };
}

async function runSkill(req, env, key, skill, ask) {
  const url = new URL(req.url);
  const ctx = {
    key,
    force: url.searchParams.get("force") === "1",
    tornGet: tornClient(key),
    db: store(env, skill.id + ":" + (await keyHash(key))),
  };
  const out = await skill.run(ctx);
  if (!ask) return json({ skill: skill.id, ...out });
  const folder = Object.keys(SOURCES)[SKILLS.indexOf(skill)];
  const a = await answer(env, folder, out.report, req.headers.get("X-OpenRouter-Key") || "");
  return json({ skill: skill.id, ...out, answer: a.text, model: a.model, errors: a.errors });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true, skills: SKILLS.length });
    if (url.pathname === "/skills") return json({ skills: skillList() });
    const m = url.pathname.match(/^\/(run|ask)\/([a-z0-9_-]+)$/);
    if (!m || req.method !== "GET") return json({ error: "unknown route" }, 404);
    const skill = SKILLS.find((s) => s.id === m[2]);
    if (!skill) return json({ error: "unknown skill " + m[2] }, 404);
    const key = tornKey(req);
    if (!key) return json({ error: "No Torn API key sent" }, 401);
    const ip = req.headers.get("CF-Connecting-IP") || "";
    const hash = await keyHash(key);
    const perKey = env.RUN_PER_KEY ? await env.RUN_PER_KEY.limit({ key: hash }) : { success: true };
    const perIp = env.RUN_PER_IP && ip ? await env.RUN_PER_IP.limit({ key: ip }) : { success: true };
    if (!perKey.success || !perIp.success) return json({ error: "Too many runs, wait a minute" }, 429);
    try {
      const owner = await keyOwner(env, key, hash);
      if (!allowed(env, owner)) return json({ error: "This Command Center is private" }, 403);
      return await runSkill(req, env, key, skill, m[1] === "ask");
    } catch (e) {
      if (e instanceof TornError && e.code === 2) return json({ error: "Torn rejected the API key" }, 401);
      if (e instanceof TornError) return json({ error: "Torn API: " + e.message }, 502);
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};
