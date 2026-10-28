// AI for plug-ins, free models only.
// ask(id):     a runner skill runs on the private runner, a free model writes the answer.
// write(...):  the plug-in brings its own data. The private runner writes it for the owner; anyone
//              else uses their own OpenRouter key straight from the browser, same free-only guard.
import { keys, store } from './storage.js';
import { http, parseJson } from './http.js';
import { tornKey } from './torn.js';
import { MODELS_FREE, isFree, OPENROUTER_URL } from './models.js';

export const KEY_OR = 'occ.or_key';
export const RUNNER = 'https://occ-runner.yoonutz.workers.dev';
const ASK_TIMEOUT = 180000;
const WRITE_TIMEOUT = 120000;
const KEY_AI_LAST = 'occ.ai.last';
let runnerPrivate = false;

function runnerHeaders() {
  const h = { Authorization: 'ApiKey ' + tornKey() };
  const or = keys.get(KEY_OR);
  if (or) h['X-OpenRouter-Key'] = or;
  return h;
}

async function ask(id, opt) {
  if (!tornKey()) throw new Error('No Torn API token. Open Setup and paste it.');
  const r = await http({ url: RUNNER + '/ask/' + id + (opt && opt.force ? '?force=1' : ''), headers: runnerHeaders(), timeout: ASK_TIMEOUT });
  const json = parseJson(r.text);
  if (r.status === 401) throw new Error(json.error || 'Torn rejected the API token (401).');
  if (r.status < 200 || r.status >= 300 || json.error) throw new Error('Runner: ' + (json.error || 'HTTP ' + r.status));
  return json;
}

async function direct(system, user) {
  const key = keys.get(KEY_OR);
  if (!key) throw new Error('No AI key. Paste a free OpenRouter key in Setup to get AI answers.');
  const last = store.get(KEY_AI_LAST, '');
  const list = MODELS_FREE.filter(isFree).sort((a, b) => (a === last ? -1 : b === last ? 1 : 0));
  const errors = [];
  for (const model of list.slice(0, 3)) {
    try {
      const r = await http({
        url: OPENROUTER_URL,
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 2500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        timeout: 40000,
      });
      const j = parseJson(r.text);
      if (r.status === 401) throw new Error('OpenRouter rejected the key');
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      const text = msg && msg.content ? String(msg.content).trim() : '';
      if (r.status === 200 && text) {
        store.set(KEY_AI_LAST, model);
        return { text, model: j.model || model };
      }
      errors.push(model + ': ' + r.status);
    } catch (e) {
      if (/rejected the key/.test(e.message)) throw e;
      errors.push(model + ': ' + e.message);
    }
  }
  throw new Error('Free models busy, try again in a minute (' + errors.join('; ') + ')');
}

async function write(req, opt) {
  const system = String(req.system || '');
  const user = String(req.user || '');
  if (!(opt && opt.direct) && !runnerPrivate && tornKey()) {
    try {
      const r = await http({ url: RUNNER + '/write', method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, runnerHeaders()), body: JSON.stringify({ system, user }), timeout: WRITE_TIMEOUT });
      const j = parseJson(r.text);
      if (r.status === 200 && j.answer) return { text: j.answer, model: j.model || 'runner' };
      if (r.status === 403) runnerPrivate = true;
    } catch (e) {}
  }
  return direct(system, user);
}

export const ai = {
  ask,
  write,
  // True when write() has a way to reach a model.
  ready: () => !!keys.get(KEY_OR) || (!runnerPrivate && !!tornKey()),
};

// Standalone builds are public (Greasy Fork): their players' Torn keys must never go to the private
// runner, so they only ever use their own OpenRouter key.
export const aiDirect = {
  ask,
  write: (req) => write(req, { direct: true }),
  ready: () => !!keys.get(KEY_OR),
};
