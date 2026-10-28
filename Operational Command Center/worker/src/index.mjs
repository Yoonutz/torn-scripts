// occ-runner: executes repo skills for the Operational Command Center and writes AI answers.
// Routes:
//   GET  /health, /skills          public: liveness, skill list (id, label, description, icon, access, md URL)
//   GET  /run/<id>[?force=1&...]   Authorization: ApiKey <Torn API key>; runs the skill, raw result
//   GET  /ask/<id>[?force=1&...]   same, then a free model turns the report into the answer
//   POST /write                    { system, user } from a userscript plug-in; a free model answers
//   GET  /usage                    Keys tab: the runner's model calls and OpenRouter's free count, 14 days
//   GET  /data/<name>              a plug-in's private document for the key's owner: { rev, value, at }
//   POST /data/<name>              { rev, value } replaces it; 409 + current document when rev is stale
// Cron (wrangler.toml): hourly OpenRouter snapshot, so the daily trend fills even with OCC closed.
// Private: only keys owned by a player in ALLOWED_PLAYERS (wrangler.toml) get past auth.mjs.
// Parts: auth.mjs (owner, allowlist, rate limits), torn.mjs, store.mjs (KV), data.mjs (per-player documents),
// ai/ (models, answers), usage.mjs,
// registry.mjs (generated at build from .claude/skills/*/scripts/runner.mjs, SKILL.md bundled).
import { REGISTRY } from "./registry.mjs";
import { gate } from "./auth.mjs";
import { tornClient, TornError } from "./torn.mjs";
import { store } from "./store.mjs";
import { answer, skillPrompt, BUDGET } from "./ai/answer.mjs";
import { usage, orSnapshot } from "./usage.mjs";
import { readData, writeData, validName } from "./data.mjs";

const RAW = "https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-OpenRouter-Key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
}

function skillList() {
  return REGISTRY.map(({ skill, md }) => ({
    id: skill.id,
    label: skill.label,
    description: skill.description,
    icon: skill.icon || null,
    access: skill.access || "full",
    md: RAW + md,
  }));
}

// Declared inputs only, with the declared default's type: ?days=14 -> ctx.inputs.days === 14.
function inputs(skill, url) {
  const out = {};
  Object.entries(skill.inputs || {}).forEach(([name, def]) => {
    const raw = url.searchParams.get(name);
    if (raw === null) out[name] = def;
    else if (typeof def === "number") out[name] = Number.isFinite(Number(raw)) ? Number(raw) : def;
    else if (typeof def === "boolean") out[name] = raw === "1" || raw === "true";
    else out[name] = raw;
  });
  return out;
}

async function runSkill(req, env, auth, entry, ask) {
  const { skill } = entry;
  const url = new URL(req.url);
  const ctx = {
    key: auth.key,
    force: url.searchParams.get("force") === "1",
    inputs: inputs(skill, url),
    tornGet: tornClient(auth.key),
    db: store(env, skill.id + ":" + auth.hash),
  };
  const out = await skill.run(ctx);
  if (!ask || skill.ai === "raw") return json({ skill: skill.id, ...out, answer: ask ? out.report : undefined, model: ask ? "runner (raw)" : undefined });
  const prompt = typeof skill.prompt === "function" ? await skill.prompt(out, ctx) : skillPrompt(entry.text, out.report);
  const a = await answer(env, prompt, req.headers.get("X-OpenRouter-Key") || "", out.report);
  return json({ skill: skill.id, ...out, answer: a.text, model: a.model, errors: a.errors });
}

async function write(req, env) {
  const body = await req.json().catch(() => null);
  const system = body && typeof body.system === "string" ? body.system : "";
  const user = body && typeof body.user === "string" ? body.user : "";
  if (!user) return json({ error: "Nothing to write: send { system, user }" }, 400);
  if (system.length + user.length > BUDGET) return json({ error: "Too long: keep system + user under " + BUDGET + " characters" }, 413);
  const a = await answer(env, { system, user }, req.headers.get("X-OpenRouter-Key") || "", "");
  if (!a.text) return json({ error: a.model, errors: a.errors }, 503);
  return json({ answer: a.text, model: a.model });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true, skills: REGISTRY.length });
    if (url.pathname === "/skills") return json({ skills: skillList() });
    const isWrite = url.pathname === "/write" && req.method === "POST";
    const isUsage = url.pathname === "/usage" && req.method === "GET";
    const m = url.pathname.match(/^\/(run|ask)\/([a-z0-9_-]+)$/);
    const d = url.pathname.match(/^\/data\/([^/]+)$/);
    if (d && (req.method === "GET" || req.method === "POST")) {
      if (!validName(d[1])) return json({ error: "bad name" }, 400);
      try {
        const auth = await gate(req, env, env.DATA_PER_KEY);
        if (auth.error) return json({ error: auth.error }, auth.status);
        if (req.method === "GET") return json(await readData(env, auth.owner, d[1]));
        const [status, body] = await writeData(env, auth.owner, d[1], await req.json().catch(() => null));
        return json(body, status);
      } catch (e) {
        if (e instanceof TornError && e.code === 2) return json({ error: "Torn rejected the API key" }, 401);
        return json({ error: String((e && e.message) || e) }, 502);
      }
    }
    if (!isWrite && !isUsage && (!m || req.method !== "GET")) return json({ error: "unknown route" }, 404);
    const entry = m ? REGISTRY.find((e) => e.skill.id === m[2]) : null;
    if (m && !entry) return json({ error: "unknown skill " + m[2] }, 404);
    try {
      const auth = await gate(req, env);
      if (auth.error) return json({ error: auth.error }, auth.status);
      if (isWrite) return await write(req, env);
      if (isUsage) return json(await usage(env, req.headers.get("X-OpenRouter-Key") || ""));
      return await runSkill(req, env, auth, entry, m[1] === "ask");
    } catch (e) {
      if (e instanceof TornError && e.code === 2) return json({ error: "Torn rejected the API key" }, 401);
      if (e instanceof TornError) return json({ error: "Torn API: " + e.message }, 502);
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(orSnapshot(env, env.OPENROUTER_KEY));
  },
};
