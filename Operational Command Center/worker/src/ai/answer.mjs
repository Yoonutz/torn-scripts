// Turns text into an answer with free OpenRouter models: up to 4 tries per call, 40 s each, model
// health shared in KV. OpenRouter key: env.OPENROUTER_KEY, else the caller's X-OpenRouter-Key.
import { OPENROUTER_URL } from "../../../../occ-kit/core/models.js";
import { modelList, health, ranked, COOL_MS } from "./models.mjs";
import { record } from "../usage.mjs";

const MAX_TRIES = 4;
const MODEL_TIMEOUT = 40000;
export const BUDGET = 60000; // characters of rules + data sent to the model

// The model only needs the skill's rules for reading and delivering the report, not the CLI
// sections, and the report itself. Both are kept inside a fixed budget.
export function skillPrompt(md, report) {
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

// fallback: what to return when no model answers (the raw report, or "" for /write).
export async function answer(env, prompt, orKey, fallback) {
  const key = env.OPENROUTER_KEY || orKey;
  if (!key) return { text: fallback, model: "runner (no OpenRouter key)" };
  const h = await health(env);
  const before = JSON.stringify(h);
  const tries = [];
  const save = () => Promise.all([JSON.stringify(h) !== before ? env.SNAPSHOTS.put("ai:health", JSON.stringify(h)) : null, record(env, tries)]);
  const errors = [];
  for (const model of ranked(modelList(env), h).slice(0, MAX_TRIES)) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "Operational Command Center" },
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 2500, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] }),
        signal: AbortSignal.timeout(MODEL_TIMEOUT),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        tries.push([model, "fail"]);
        errors.push("OpenRouter rejected the key");
        break;
      }
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      const text = msg && msg.content ? String(msg.content).trim() : "";
      if (res.ok && text) {
        tries.push([model, "ok"]);
        h.last = model;
        delete h.cool[model];
        await save();
        return { text, model: j.model || model };
      }
      tries.push([model, res.status === 429 ? "rl" : "fail"]);
      h.cool[model] = Date.now() + COOL_MS;
      errors.push(model + ": " + res.status + " " + ((j.error && j.error.message) || "empty reply"));
    } catch (e) {
      tries.push([model, "fail"]);
      h.cool[model] = Date.now() + COOL_MS;
      errors.push(model + ": " + (e && e.name === "TimeoutError" ? "timeout" : String((e && e.message) || e)));
    }
  }
  await save();
  return { text: fallback, model: "runner (free models busy)", errors };
}
