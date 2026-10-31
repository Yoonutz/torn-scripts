// Turns text into an answer with free OpenRouter models: up to 5 tries per call, 30 s each and 95 s
// in all (the userscript gives up at 120 s), model health shared in KV. OpenRouter key:
// env.OPENROUTER_KEY, else the caller's X-OpenRouter-Key.
import { OPENROUTER_URL } from "../../../../occ-kit/core/models.js";
import { modelList, health, ranked, COOL_MS, LONG_COOL_MS } from "./models.mjs";
import { record } from "../usage.mjs";

const MAX_TRIES = 5;
const MODEL_TIMEOUT = 30000;
const TOTAL_TIMEOUT = 95000;
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

// Some free models (or their providers) mask names and places with a privacy placeholder such as
// [ADDRESS] or [NAME]. A reply with an all-caps bracket token the prompt didn't have is treated as
// a failed try, so the next model answers instead.
export function placeholder(text, prompt) {
  const sent = prompt.system + "\n" + prompt.user;
  return (String(text).match(/\[[A-Z][A-Z_ ]{2,}\]/g) || []).find((t) => !sent.includes(t)) || "";
}

// A reply that opens a JSON array or object must parse: a cut-off "[{"kind":"go","text":"Fly to Hawaii (1h"
// is a failed try, not an answer. Code fences around it are allowed. Plain text replies pass.
export function brokenJson(text) {
  const t = String(text).trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
  if (!/^(\[\s*[[{"\]]|\{\s*["}])/.test(t)) return false; // "[Report](...)" markdown is not JSON
  try {
    JSON.parse(t);
    return false;
  } catch (e) {
    return true;
  }
}

// What went wrong with a 200 reply, or "" when it is usable.
export function badReply(text, finish, prompt) {
  if (!text) return finish === "length" ? "cut off before any text" : "empty reply";
  const masked = placeholder(text, prompt);
  if (masked) return "masked text with " + masked;
  if (finish === "length") return "cut off (length)";
  if (brokenJson(text)) return "broken JSON";
  return "";
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
  const t0 = Date.now();
  for (const model of ranked(modelList(env), h).slice(0, MAX_TRIES)) {
    const left = TOTAL_TIMEOUT - (Date.now() - t0);
    if (left < 5000) break;
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "Operational Command Center" },
        // Low reasoning: thinking models otherwise spend the whole budget thinking and return no text.
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 2500, reasoning: { effort: "low", exclude: true }, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] }),
        signal: AbortSignal.timeout(Math.min(MODEL_TIMEOUT, left)),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        tries.push([model, "fail"]);
        errors.push("OpenRouter rejected the key");
        break;
      }
      const choice = (j.choices && j.choices[0]) || {};
      const text = choice.message && choice.message.content ? String(choice.message.content).trim() : "";
      const bad = res.ok ? badReply(text, choice.finish_reason, prompt) : "";
      if (res.ok && !bad) {
        tries.push([model, "ok"]);
        h.last = model;
        delete h.cool[model];
        await save();
        return { text, model: j.model || model, errors };
      }
      tries.push([model, res.status === 429 ? "rl" : "fail"]);
      // Refused for good (403 not offered to this app, 404 no endpoint under the account's privacy
      // rules) or masking places: hours, not minutes, so it stops eating tries. openrouter/free picks a
      // different model each time, so it only gets the short pause.
      const long = res.status === 403 || res.status === 404 || (/^masked/.test(bad) && model !== "openrouter/free");
      h.cool[model] = Date.now() + (long ? LONG_COOL_MS : COOL_MS);
      errors.push(model + ": " + (bad || res.status + " " + ((j.error && j.error.message) || "empty reply")));
    } catch (e) {
      tries.push([model, "fail"]);
      h.cool[model] = Date.now() + COOL_MS;
      errors.push(model + ": " + (e && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : String((e && e.message) || e)));
    }
  }
  await save();
  return { text: fallback, model: "runner (free models busy)", errors };
}
