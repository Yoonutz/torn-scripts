// ==UserScript==
// @name         Torn Chat Image Upload
// @namespace    kamiren.torn-chat-image-upload
// @version      1.0.0
// @description  Image button next to Send in Torn chat: uploads your picture to Catbox and puts the link in the chat box. You click Send.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      catbox.moe
// ==/UserScript==

// Built by occ-kit/build.mjs from the sources named below. Edit those, then rebuild.
(function () {
  'use strict';

const VERSION = '1.0.0';

// ---- occ-kit/core/dom.js
// DOM helpers shared by shells and plug-ins.

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Icons from outside the script land on torn.com as markup: accept only a plain inline <svg>.
function safeIcon(svg) {
  const s = String(svg || '').trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return '';
  if (/<(script|foreignObject|iframe|image|use|a)[\s>]|\son\w+\s*=|javascript:|href\s*=/i.test(s)) return '';
  return s;
}

function letterIcon(label) {
  return '<span style="font:bold 15px Arial,Helvetica,sans-serif">' + esc(String(label || '?').charAt(0)) + '</span>';
}

// ---- occ-kit/core/storage.js
// Browser storage for every kit script.
// store: JSON in torn.com localStorage, for per-browser UI state only (open panel, last tab).
// keys:  secrets and private data in Tampermonkey's own storage (GM_*), so clearing torn.com site
//        data, logging out or Torn wiping localStorage never loses them and page scripts cannot
//        read them. Torn PDA keeps localStorage (it fills the Torn key itself). Values saved by
//        older versions in localStorage move over on first read, once the copy is confirmed.

function isPda() {
  return typeof window.PDA_httpGet === 'function' || /TornPDA/i.test(navigator.userAgent || '');
}

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  },
};

function hasGM() {
  return typeof GM_getValue === 'function' && typeof GM_setValue === 'function' && !isPda();
}

function gmSet(k, v) {
  try {
    GM_setValue(k, v);
    return GM_getValue(k, '') === v;
  } catch (e) {
    return false;
  }
}

// Strings only (API keys).
const keys = {
  get(k) {
    if (hasGM()) {
      try {
        const v = GM_getValue(k, '');
        if (typeof v === 'string' && v) return v;
      } catch (e) {}
    }
    const old = store.get(k, '');
    if (old && hasGM() && gmSet(k, old)) store.del(k);
    return old;
  },
  set(k, v) {
    if (hasGM() && gmSet(k, v)) store.del(k);
    else store.set(k, v);
  },
  del(k) {
    if (hasGM()) {
      try {
        GM_deleteValue(k);
      } catch (e) {}
    }
    store.del(k);
  },
};

// Any JSON value that should stay out of torn.com localStorage (cached answers with money numbers).
const vault = {
  get(k, d) {
    if (hasGM()) {
      try {
        const v = GM_getValue(k, undefined);
        if (v !== undefined) return JSON.parse(v);
      } catch (e) {}
      const old = store.get(k, undefined);
      if (old !== undefined) {
        vault.set(k, old);
        return old;
      }
      return d;
    }
    return store.get(k, d);
  },
  set(k, v) {
    if (hasGM()) {
      try {
        GM_setValue(k, JSON.stringify(v));
        store.del(k);
        return;
      } catch (e) {}
    }
    store.set(k, v);
  },
  del(k) {
    if (hasGM()) {
      try {
        GM_deleteValue(k);
      } catch (e) {}
    }
    store.del(k);
  },
};

// ---- occ-kit/core/http.js
// One request helper for Tampermonkey (GM_xmlhttpRequest), Torn PDA (PDA_httpGet/Post) and plain fetch.
const HTTP_TIMEOUT = 45000;

function host(url) {
  return String(url).replace(/^https?:\/\//, '').split('/')[0];
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

function http(opt) {
  const method = opt.method || 'GET';
  const headers = opt.headers || {};
  const timeout = opt.timeout || HTTP_TIMEOUT;
  if (typeof GM_xmlhttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: opt.url,
        headers,
        data: opt.body,
        timeout,
        onload: (r) => resolve({ status: r.status, text: r.responseText || '' }),
        onerror: () => reject(new Error('Network error (' + host(opt.url) + ')')),
        ontimeout: () => reject(new Error('Timeout (' + host(opt.url) + ')')),
      });
    });
  }
  const pda = method === 'POST' ? window.PDA_httpPost : window.PDA_httpGet;
  if (typeof pda === 'function') {
    const args = method === 'POST' ? [opt.url, headers, opt.body] : [opt.url, headers];
    return Promise.resolve(pda.apply(window, args)).then((r) => ({
      status: (r && (r.status || r.statusCode)) || 200,
      text: (r && (r.responseText || r.body || r.text)) || (typeof r === 'string' ? r : ''),
    }));
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  return fetch(opt.url, { method, headers, body: opt.body, signal: ctl.signal, cache: 'no-cache' })
    .then(async (r) => ({ status: r.status, text: await r.text() }))
    .catch((e) => {
      throw new Error((e.name === 'AbortError' ? 'Timeout' : 'Blocked by the page (' + e.message + ')') + ' (' + host(opt.url) + ')');
    })
    .finally(() => clearTimeout(timer));
}

// ---- occ-kit/core/torn.js
// Torn API v2 with the player's own key. Only api.torn.com, never page scraping.


const KEY_TORN = 'occ.torn_key';
const PDA_KEY = '###PDA-APIKEY###';
const TORN_API = 'https://api.torn.com/v2/';

const TORN_ERRORS = {
  1: 'Torn key is empty',
  2: 'Torn key is invalid',
  5: 'Rate limited, try again later',
  8: 'IP temporarily blocked by Torn',
  13: 'Key paused: owner inactive',
  16: 'Key access level too low',
  18: 'Key paused by its owner',
};

function tornKey() {
  const k = keys.get(KEY_TORN);
  if (k) return k;
  return PDA_KEY.indexOf('PDA-APIKEY') === -1 ? PDA_KEY : '';
}

class TornApiError extends Error {
  constructor(code, msg) {
    super(TORN_ERRORS[code] || 'Torn error ' + code + (msg ? ': ' + msg : ''));
    this.code = code;
  }
}

// GET a v2 path ('user/basic', 'company/profile'). Throws TornApiError on a Torn error code.
async function torn(path, opt) {
  const key = tornKey();
  if (!key) throw new TornApiError(1);
  const r = await http({ url: TORN_API + path, headers: { Authorization: 'ApiKey ' + key, Accept: 'application/json' }, timeout: (opt && opt.timeout) || 20000 });
  let j = null;
  try {
    j = JSON.parse(r.text);
  } catch (e) {}
  if (j && j.error) throw new TornApiError(j.error.code, j.error.error);
  if (!j) throw new Error('Unexpected reply from Torn (HTTP ' + r.status + ')');
  return j;
}

// ---- occ-kit/core/models.js
// Free OpenRouter models, best first. Shared by the runner (Worker) and the userscripts, so the
// list lives in one place. isFree() guards every call: a paid model can never be billed.
// Pure module: no DOM, no Node, safe to import from the Worker.
// Picked from the runner's answer log (GET /ailog, 28-30 Oct 2026): inkling (403, agentic apps only)
// and nemotron-3.5-super-vl (404 under the account's free-training guardrail) never answered and
// are gone; Cohere masks countries and names as [ADDRESS]/[PERSON_NAME], so it goes last.
// xing4.0 left OpenRouter's model list (checked 13 Nov 2026), so every call to it was a 404.
const MODELS_FREE = [
  'dots-studio/dots-3-note-preview:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'openrouter/free',
  'cohere/north-mini-code:free',
];

function isFree(id) {
  return id === 'openrouter/free' || /:free$/.test(id);
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ---- occ-kit/core/ai.js
// AI for plug-ins, free models only.
// ask(id):     a runner skill runs on the private runner, a free model writes the answer.
// write(...):  the plug-in brings its own data. The private runner writes it for the owner; anyone
//              else uses their own OpenRouter key straight from the browser, same free-only guard.




const KEY_OR = 'occ.or_key';
const RUNNER = 'https://occ-runner.yoonutz.workers.dev';
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

const ai = {
  ask,
  write,
  // True when write() has a way to reach a model.
  ready: () => !!keys.get(KEY_OR) || (!runnerPrivate && !!tornKey()),
};

// Standalone builds are public (Greasy Fork): their players' Torn keys must never go to the private
// runner, so they only ever use their own OpenRouter key.
const aiDirect = {
  ask,
  write: (req) => write(req, { direct: true }),
  ready: () => !!keys.get(KEY_OR),
};

// ---- occ-kit/core/theme.js
// Torn's own look for every kit script. Colors, gradients and shadows come from the CSS variables
// Torn itself defines on the page (title bars, tabs, buttons, inputs, panels), so the scripts follow
// Torn's dark and light mode. The value after each comma is Torn's dark mode value, used only where
// a page lacks the variable (taken from torn.com computed styles, 2026-10-28). Plug-ins draw with
// var(--occ-*) and never hardcode colors. No native controls: buttons, inputs and scrollbars are
// all restyled here. Torn's page CSS colors bare elements (td, li, p, label, h3...) for its own
// layout, so every such element here inherits the script's text color instead, in both modes.
// color-scheme follows Torn's mode (body.dark-mode) for anything native that is left.

const THEME_VARS = [
  '--occ-font:12px/1.4 Arial,Helvetica,sans-serif',
  '--occ-bg:var(--main-bg,#191919)',
  '--occ-panel:var(--default-bg-panel-color,#333)',
  '--occ-panel-hi:var(--default-bg-panel-active-color,#444)',
  '--occ-sunk:var(--items-cont-bg-color,#242424)',
  '--occ-raise:var(--default-gray-e4-color,#444)',
  '--occ-line:var(--panel-border-bottom-color,#3b3b3b)',
  '--occ-line2:var(--default-gray-e4-color,#444)',
  '--occ-div-dark:var(--divider-dark-color,#222)',
  '--occ-div-light:var(--divider-light-color,#474747)',
  '--occ-fg:var(--default-color,#ddd)',
  '--occ-hi:var(--default-white-color,#fff)',
  '--occ-muted:var(--default-content-title-color,#999)',
  '--occ-dim:var(--default-gray-9-hover-color,#999)',
  '--occ-accent:var(--default-blue-color,#74c0fc)',
  '--occ-accent-hi:var(--default-blue-hover-color,#a5d8ff)',
  '--occ-good:var(--default-green-color,#82c91e)',
  '--occ-ok:var(--default-green-color,#82c91e)',
  '--occ-warn:var(--default-orange-color,#F08C00)',
  '--occ-bad:var(--default-red-color,#E54C19)',
  '--occ-bad-bg:var(--default-bg-red-color,rgba(228,74,27,.15))',
  '--occ-good-bg:var(--default-bg-green-color,rgba(110,160,55,.15))',
  '--occ-code:var(--default-full-text-color,#ccc)',
  '--occ-title-bg:var(--title-black-gradient,linear-gradient(180deg,#555 0%,#333 100%))',
  '--occ-title-fg:var(--title-color,#fff)',
  '--occ-title-shadow:var(--title-text-shadow,0 0 2px #000)',
  '--occ-tabs-bg:var(--tabs-bg-gradient,linear-gradient(180deg,#666 0%,#333 100%))',
  '--occ-tabs-hover-bg:var(--tabs-hover-bg-gradient,linear-gradient(180deg,#555 0%,#444 100%))',
  '--occ-tabs-active-bg:var(--tabs-active-bg-gradient,linear-gradient(180deg,#333 0%,#666 100%))',
  '--occ-tabs-fg:var(--default-tabs-color,#999)',
  '--occ-tabs-active-fg:var(--default-tabs-active-color,#ddd)',
  '--occ-tabs-shadow:var(--tabs-text-shadow,0 0 2px #000)',
  '--occ-btn-fg:var(--btn-color,#eee)',
  '--occ-btn-shadow:var(--btn-text-shadow,0 0 5px #000)',
  '--occ-btn-bg:var(--btn-background,linear-gradient(180deg,#111 0%,#555 25%,#333 60%,#333 78%,#111 100%))',
  '--occ-btn-border:var(--btn-border,1px solid #111)',
  '--occ-btn-hover-fg:var(--btn-hover-color,#fff)',
  '--occ-btn-hover-bg:var(--btn-hover-background,linear-gradient(180deg,#333 0%,#777 25%,#333 59%,#666 78%,#333 100%))',
  '--occ-btn-active-bg:var(--btn-active-background,linear-gradient(180deg,#000 0%,#333 100%))',
  '--occ-input-fg:var(--input-color,#fff)',
  '--occ-input-bg:var(--input-background-color,linear-gradient(0deg,#111 0%,#000 100%))',
  '--occ-input-border:var(--input-border-color,#444)',
  '--occ-input-hover-border:var(--input-hover-border-color,#666)',
  '--occ-input-focus-border:var(--input-focus-border-color,#1864AB80)',
  '--occ-input-focus-shadow:var(--input-focus-box-shadow,0 0 2px #1C7ED6A6)',
  '--occ-tip-bg:var(--tooltip-bg-color,#444)',
  '--occ-tip-border:var(--tooltip-border-color,#333)',
  '--occ-tip-shadow:var(--tooltip-shadow,0 0 2px rgba(0,0,0,.65))',
].join(';');

// R = the script's root selector, e.g. '#occ-root'. Everything is scoped under it, so two kit
// scripts of different versions on one page cannot restyle each other.
function themeCss(R) {
  return `
    ${R}{${THEME_VARS}}
    ${R},${R} *{box-sizing:border-box}
    ${R} :where(table,thead,tbody,tr,td,th,ul,ol,li,p,dt,dd,label,caption,h1,h2,h3,h4,h5,h6,pre,blockquote){color:inherit}
    :where(${R}) button{font:var(--occ-font);margin:0;padding:0;border:0;background:none;color:inherit;text-shadow:none;text-transform:none;letter-spacing:normal;appearance:none;-webkit-appearance:none;outline:none;cursor:pointer;-webkit-tap-highlight-color:transparent;height:auto;min-height:0;width:auto;min-width:0;max-width:none;box-shadow:none;text-indent:0;border-radius:0;float:none}
    :where(${R}) button:focus-visible{box-shadow:var(--occ-input-focus-shadow);outline:1px solid var(--occ-input-focus-border)}
    :where(${R}) p,:where(${R}) ul,:where(${R}) ol,:where(${R}) h3,:where(${R}) pre,:where(${R}) table{margin:0;padding:0;font-family:inherit}
    ${R} .occ-scroll{scrollbar-width:thin;scrollbar-color:var(--occ-line2) transparent}
    ${R} .occ-scroll::-webkit-scrollbar{width:8px;height:0}
    ${R} .occ-scroll::-webkit-scrollbar-track{background:transparent}
    ${R} .occ-scroll::-webkit-scrollbar-thumb{background:var(--occ-line2);border-radius:4px;border:2px solid var(--occ-bg)}
    ${R} .occ-title-bar{background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif}
    ${R} .occ-acc{margin-bottom:8px;border-radius:5px;overflow:hidden;background:var(--occ-panel);box-shadow:0 1px 2px rgba(0,0,0,.35)}
    ${R} .occ-acc-bar{width:100%;display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif;text-align:left;border-bottom:1px solid var(--occ-div-dark)}
    ${R} .occ-acc-bar .occ-n{margin-left:auto;flex:none;background:var(--occ-div-dark);color:var(--occ-fg);border-radius:8px;font:bold 10px/1 Arial,sans-serif;padding:3px 7px;text-shadow:none}
    ${R} .occ-acc-bar .occ-car{flex:none;color:var(--occ-title-fg);opacity:.7;font-size:9px;transition:transform .15s}
    ${R} .occ-acc.occ-shut .occ-acc-bar{border-bottom:0}
    ${R} .occ-acc.occ-shut .occ-acc-bar .occ-car{transform:rotate(-90deg)}
    ${R} .occ-acc-body{padding:8px 10px;border-top:1px solid var(--occ-div-light)}
    ${R} .occ-acc.occ-shut .occ-acc-body{display:none}
    ${R} .occ-card{background:var(--occ-panel);border-radius:5px;padding:10px;margin-bottom:8px;min-width:0;max-width:100%;box-shadow:0 1px 2px rgba(0,0,0,.35)}
    ${R} .occ-card h3{margin:-10px -10px 9px;padding:0 10px;height:30px;display:flex;align-items:center;border-radius:5px 5px 0 0;background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif;border-bottom:1px solid var(--occ-div-dark)}
    ${R} .occ-muted{color:var(--occ-muted);font-size:11.5px;line-height:1.45}
    ${R} .occ-err{background:var(--occ-panel);box-shadow:inset 3px 0 0 var(--occ-bad),0 1px 2px rgba(0,0,0,.35);color:var(--occ-fg)}
    ${R} .occ-err h3{background:var(--title-red-gradient,linear-gradient(180deg,#904B2D 0%,#512A15 100%))}
    ${R} .occ-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--occ-line2);border-top-color:var(--occ-fg);border-radius:50%;animation:occspin .8s linear infinite;vertical-align:-2px;margin-right:8px}
    @keyframes occspin{to{transform:rotate(360deg)}}
    ${R} .occ-bar{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap;min-width:0}
    ${R} .occ-act-btn{height:28px;padding:0 12px;border-radius:5px;flex:none;white-space:nowrap;border:var(--occ-btn-border);background:var(--occ-btn-bg);color:var(--occ-btn-fg);text-shadow:var(--occ-btn-shadow);font:bold 12px/1 Arial,Helvetica,sans-serif;text-transform:uppercase;display:inline-flex;align-items:center;gap:6px}
    ${R} .occ-act-btn:hover{background:var(--occ-btn-hover-bg);color:var(--occ-btn-hover-fg)}
    ${R} .occ-act-btn:active{background:var(--occ-btn-active-bg)}
    ${R} .occ-act-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    ${R} .occ-cancel{margin-left:auto}
    ${R} .occ-field{display:block;width:100%;height:30px;padding:0 9px;margin:7px 0 2px;border:1px solid var(--occ-input-border);border-radius:5px;background:var(--occ-input-bg);color:var(--occ-input-fg);font:12px/1 Arial,Helvetica,sans-serif;outline:none;appearance:none;-webkit-appearance:none;color-scheme:light}
    body.dark-mode ${R} .occ-field{color-scheme:dark}
    ${R} .occ-keystat{display:inline-block;margin:2px 0 4px;padding:2px 8px;border-radius:4px;font:bold 12px/1.4 Arial,Helvetica,sans-serif}
    ${R} .occ-keystat.ok{color:var(--occ-good);background:var(--occ-good-bg)}
    ${R} .occ-keystat.no{color:var(--occ-bad);background:var(--occ-bad-bg)}
    ${R} .occ-hval{min-width:44px;text-align:center;font-weight:bold;font-variant-numeric:tabular-nums}
    ${R} .occ-field:hover{border-color:var(--occ-input-hover-border)}
    ${R} .occ-field:focus{border-color:var(--occ-input-focus-border);box-shadow:var(--occ-input-focus-shadow)}
    ${R} .occ-field::placeholder{color:var(--occ-muted)}
    ${R} .occ-field::-ms-reveal,${R} .occ-field::-ms-clear{display:none}
    ${R} .occ-field:-webkit-autofill,${R} .occ-field:-webkit-autofill:hover,${R} .occ-field:-webkit-autofill:focus{-webkit-box-shadow:0 0 0 40px #000 inset;-webkit-text-fill-color:var(--occ-input-fg);caret-color:var(--occ-input-fg);transition:background-color 9999s}
    ${R} .occ-md{font:12px/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;word-break:break-word;min-width:0}
    ${R} .occ-md>:first-child{margin-top:0}
    ${R} .occ-md>:last-child{margin-bottom:0}
    ${R} .occ-md h1,${R} .occ-md h2,${R} .occ-md h3,${R} .occ-md h4{margin:10px 0 5px;color:var(--occ-hi);font:bold 12px/1.3 Arial,Helvetica,sans-serif}
    ${R} .occ-md p{margin:6px 0}
    ${R} .occ-md ul{margin:6px 0;padding-left:16px;list-style:disc outside}
    ${R} .occ-md ol{margin:6px 0;padding-left:18px;list-style:decimal outside}
    ${R} .occ-md li{display:list-item;margin:3px 0;padding-left:2px}
    ${R} .occ-md li::marker{color:var(--occ-muted)}
    ${R} .occ-md code{background:var(--occ-sunk);border-radius:3px;padding:1px 4px;font:11px/1.4 Consolas,Menlo,monospace;color:var(--occ-code);overflow-wrap:anywhere}
    ${R} .occ-md pre{background:var(--occ-sunk);border-radius:5px;padding:8px 10px;margin:6px 0;max-width:100%;overflow:hidden;font:11px/1.5 Consolas,Menlo,monospace;color:var(--occ-code);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
    @media (max-width:420px){${R} .occ-md pre{font-size:10.5px}}
    ${R} .occ-md pre code{padding:0;background:transparent;color:inherit}
    ${R} .occ-md strong{color:var(--occ-hi);font-weight:bold}
    ${R} .occ-md em{color:var(--occ-code)}
    ${R} .occ-md a{color:var(--occ-accent);text-decoration:none}
    ${R} .occ-md a:hover{color:var(--occ-accent-hi);text-decoration:underline}
    ${R} .occ-md hr{border:0;height:2px;margin:10px 0;border-top:1px solid var(--occ-div-dark);border-bottom:1px solid var(--occ-div-light)}
    ${R} .occ-tbl{margin:6px 0;overflow-x:auto;border-radius:5px;background:var(--occ-sunk);scrollbar-width:none}
    ${R} .occ-tbl::-webkit-scrollbar{display:none}
    ${R} .occ-tbl table{border-collapse:collapse;width:100%;font:12px/1.3 Arial,Helvetica,sans-serif}
    ${R} .occ-tbl th,${R} .occ-tbl td{padding:5px 8px;text-align:left;vertical-align:top;white-space:nowrap;font-variant-numeric:tabular-nums}
    ${R} .occ-tbl td{border-top:1px solid var(--occ-div-dark);box-shadow:inset 0 1px 0 var(--occ-div-light)}
    ${R} .occ-tbl th{background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);font-weight:bold}
    ${R} .occ-stat{background:var(--occ-panel);border-radius:5px;padding:6px 9px;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,.35)}
    ${R} .occ-stat .k{font:11px/1.3 Arial,Helvetica,sans-serif;color:var(--occ-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${R} .occ-stat .v{font:bold 15px/1.3 Arial,Helvetica,sans-serif;color:var(--occ-hi);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${R} .occ-stat .v small{font-size:10px;color:var(--occ-muted);font-weight:normal}
    ${R} .occ-stat.occ-hot{background:var(--occ-panel) linear-gradient(var(--occ-good-bg),var(--occ-good-bg))}
    ${R} .occ-stat.occ-hot .v{color:var(--occ-good)}
    ${R} .occ-tip{position:fixed;z-index:2147483600;display:none;pointer-events:none;max-width:260px;padding:6px 9px;background:var(--occ-tip-bg);border:1px solid var(--occ-tip-border);border-radius:5px;font:12px/1.4 Arial,Helvetica,sans-serif;color:var(--occ-fg);box-shadow:var(--occ-tip-shadow);text-align:left}
    ${R} .occ-toast{position:fixed;z-index:2147483600;display:none;max-width:260px;padding:7px 10px;background:var(--occ-tip-bg);border:1px solid var(--occ-tip-border);border-left:3px solid var(--occ-good);border-radius:5px;font:12px/1.4 Arial,Helvetica,sans-serif;color:var(--occ-fg);box-shadow:var(--occ-tip-shadow);cursor:pointer;text-align:left}
    ${R} .occ-toast.bad{border-left-color:var(--occ-bad)}
  `;
}

function injectTheme(root, R, extra) {
  root.appendChild(el('style', '', themeCss(R) + (extra || '')));
}

// ---- occ-kit/core/frame.js
// The floating window both shells draw: title-bar header, stats row, scrolling body, tab bar.
// Phone: a compact sheet at the bottom, at most 60% of the screen tall so Torn stays visible above it,
// drawn above Torn's sticky header and footer bars (they covered the close button in Torn PDA).
// Desktop: 420x640, bottom right.
function frameCss(R) {
  return `
  ${R} .occ-win{position:fixed;top:auto;left:6px;right:6px;bottom:calc(6px + env(safe-area-inset-bottom,0px));height:min(460px,60vh);height:min(460px,60dvh);z-index:2147483000;display:none;grid-template-rows:34px auto auto 1fr 50px;grid-template-areas:"head" "tool" "stats" "main" "tabs";background:var(--occ-bg);color:var(--occ-fg);font:var(--occ-font);overflow:hidden;text-align:left;color-scheme:light;border:1px solid var(--occ-div-dark);border-radius:5px;box-shadow:0 0 12px rgba(0,0,0,.7)}
  ${R} .occ-win.occ-on{display:grid}
  body.dark-mode ${R} .occ-win{color-scheme:dark}
  ${R} .occ-head{grid-area:head;display:flex;align-items:center;gap:4px;padding:0 4px 0 10px;min-width:0;background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);border-bottom:1px solid var(--occ-div-dark)}
  ${R} .occ-title{font:bold 13px/1 Arial,Helvetica,sans-serif;white-space:nowrap;flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis}
  ${R} .occ-tool{grid-area:tool;display:flex;align-items:center;gap:8px;padding:8px 8px 0;min-width:0}
  ${R} .occ-tool[hidden]{display:none}
  ${R} .occ-sub{flex:1;min-width:0;font:11px/1.2 Arial,Helvetica,sans-serif;color:var(--occ-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  ${R} .occ-tool .occ-act-btn{height:24px;padding:0 9px;font-size:11px}
  ${R} .occ-tool .occ-act-btn.occ-busy{opacity:.45;pointer-events:none}
  ${R} .occ-head .occ-gap{flex:1}
  ${R} .occ-sub .occ-dot{color:var(--occ-ok)}
  ${R} .occ-sub .occ-old{color:var(--occ-warn)}
  ${R} .occ-hb{width:26px;height:26px;flex:none;border:var(--occ-btn-border);border-radius:5px;background:var(--occ-btn-bg);color:var(--occ-btn-fg);display:flex;align-items:center;justify-content:center;font:bold 15px/1 Arial,sans-serif;text-shadow:var(--occ-btn-shadow)}
  ${R} .occ-hb svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 1px #000)}
  ${R} .occ-hb:hover{background:var(--occ-btn-hover-bg);color:var(--occ-btn-hover-fg)}
  ${R} .occ-hb:active,${R} .occ-hb.occ-act{background:var(--occ-btn-active-bg)}
  ${R} .occ-hb.occ-busy{opacity:.45;pointer-events:none}
  ${R} .occ-hb[hidden]{display:none}
  ${R} .occ-stats{grid-area:stats;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 8px 0;min-width:0}
  ${R} .occ-stats:empty{display:none;padding:0}
  ${R} .occ-main{grid-area:main;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding:8px 8px 12px;min-width:0;position:relative;-webkit-overflow-scrolling:touch;overflow-wrap:anywhere}
  ${R} .occ-main>*{max-width:100%}
  ${R} .occ-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--occ-muted);text-align:center;gap:6px}
  ${R} .occ-tabs{grid-area:tabs;display:flex;background:var(--occ-tabs-bg);border-top:1px solid var(--tabs-border-top-color,#555);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch}
  ${R} .occ-tabs::-webkit-scrollbar{display:none}
  ${R} .occ-tab{flex:1 0 64px;min-width:64px;align-self:stretch;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px 4px;font:bold 10px/1 Arial,Helvetica,sans-serif;color:var(--occ-tabs-fg);text-shadow:var(--occ-tabs-shadow);user-select:none;border-left:1px solid var(--tabs-divider-border-left-color,#000);box-shadow:inset 1px 0 0 rgba(255,255,255,.08)}
  ${R} .occ-tab:first-child{border-left:0;box-shadow:none}
  ${R} .occ-tab:hover{background:var(--occ-tabs-hover-bg);color:var(--occ-tabs-active-fg)}
  ${R} .occ-tab svg{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 2px #00000073)}
  ${R} .occ-tab span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  ${R} .occ-tab.occ-act{background:var(--occ-tabs-active-bg);color:var(--occ-tabs-active-fg)}
  ${R} .occ-tabs:empty::before{content:"No tabs yet";margin:auto;color:var(--occ-muted);font-size:11px}
  ${R} .occ-launch{position:fixed;right:16px;bottom:88px;z-index:99990;width:48px;height:48px;border-radius:50%;border:var(--occ-btn-border);background:var(--occ-btn-bg);color:var(--occ-btn-fg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.6);user-select:none}
  ${R} .occ-launch.occ-hide{display:none}
  ${R} .occ-launch:hover{background:var(--occ-btn-hover-bg)}
  ${R} .occ-launch:active{background:var(--occ-btn-active-bg)}
  ${R} .occ-launch svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 1px #000)}
  ${R} .occ-win.occ-solo{grid-template-rows:34px auto auto 1fr;grid-template-areas:"head" "tool" "stats" "main"}
  @media (max-width:767px){
    ${R} .occ-win{grid-template-rows:30px auto auto 1fr 40px}
    ${R} .occ-win.occ-solo{grid-template-rows:30px auto auto 1fr}
    ${R} .occ-tab{gap:2px;padding:3px 4px}
    ${R} .occ-tab svg{width:15px;height:15px}
  }
  @media (min-width:768px){
    ${R} .occ-launch{bottom:24px;right:24px}
    ${R} .occ-win{top:auto;left:auto;right:24px;bottom:84px;width:420px;height:640px;max-height:calc(100vh - 108px)}
  }
`;
}

// Wheel over the window never scrolls the Torn page behind it: the body scrolls until its end and
// stops there, the tab bar turns the wheel sideways, everything else (header, stats) swallows it.
function trapScroll(win) {
  win.addEventListener(
    'wheel',
    (e) => {
      const tabs = e.target.closest && e.target.closest('.occ-tabs');
      if (tabs) {
        if (tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft += e.deltaY || e.deltaX;
        e.preventDefault();
        return;
      }
      const box = e.target.closest && e.target.closest('.occ-main');
      if (box) {
        const up = e.deltaY < 0;
        const atTop = box.scrollTop <= 0;
        const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
        if ((up && !atTop) || (!up && !atEnd)) return;
        // Inner scrollers (a wide table) keep their own sideways scroll.
        if (e.deltaX && !e.deltaY) return;
      }
      e.preventDefault();
    },
    { passive: false }
  );
}

// ---- occ-kit/core/ui.js
// Building blocks every plug-in draws with. All styled by theme.js under the script's root.


function card(title, body) {
  const c = el('div', 'occ-card');
  if (title) c.appendChild(el('h3', '', esc(title)));
  if (body !== undefined) c.appendChild(typeof body === 'string' ? el('div', '', body) : body);
  return c;
}

function errCard(title, msg) {
  const c = el('div', 'occ-card occ-err');
  c.appendChild(el('h3', '', esc(title)));
  c.appendChild(el('div', '', esc(msg).replace(/\n/g, '<br>')));
  return c;
}

function button(label, onClick, alt) {
  const b = el('button', 'occ-act-btn' + (alt ? ' occ-alt' : ''), label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function accordion(title, node, opts) {
  const acc = el('div', 'occ-acc' + (opts && opts.shut ? ' occ-shut' : ''));
  const bar = el('button', 'occ-acc-bar');
  bar.type = 'button';
  bar.setAttribute('aria-expanded', String(!(opts && opts.shut)));
  bar.innerHTML = esc(title) + (opts && opts.badge ? '<span class="occ-n">' + esc(opts.badge) + '</span>' : '<span class="occ-n" style="display:none"></span>') + '<span class="occ-car">▼</span>';
  bar.addEventListener('click', () => {
    acc.classList.toggle('occ-shut');
    bar.setAttribute('aria-expanded', String(!acc.classList.contains('occ-shut')));
  });
  const body = el('div', 'occ-acc-body');
  body.appendChild(node);
  acc.appendChild(bar);
  acc.appendChild(body);
  return acc;
}

// Up to three big number cards: [{ k, v, unit?, hot? }].
function fillStats(row, list) {
  row.innerHTML = '';
  if (!Array.isArray(list) || !list.length) return;
  row.style.gridTemplateColumns = 'repeat(' + Math.min(list.length, 3) + ',1fr)';
  list.slice(0, 3).forEach((x) => {
    const c = el('div', 'occ-stat' + (x.hot ? ' occ-hot' : ''));
    c.appendChild(el('div', 'k', esc(x.k)));
    c.appendChild(el('div', 'v', esc(x.v) + (x.unit ? '<small>' + esc(x.unit) + '</small>' : '')));
    row.appendChild(c);
  });
}

// Paste-once secret field (Torn key, OpenRouter key), kept in Tampermonkey storage.
// A key field always shows in one line whether a key is saved: green with its last 4 characters, or
// red when there is none. opts.fallback() can name a key that works without saving one (Torn PDA).
function keyField(c, opts) {
  c.appendChild(el('h3', '', opts.title));
  const has = !!keys.get(opts.key);
  const badge = el('div', 'occ-keystat');
  const paint = () => {
    const own = keys.get(opts.key);
    const other = !own && opts.fallback ? opts.fallback() : '';
    const k = own || other;
    badge.className = 'occ-keystat ' + (k ? 'ok' : 'no');
    badge.textContent = k ? (own ? '✓ Key saved' : '✓ Using Torn PDA key') + ' · ends in ' + String(k).slice(-4) : '✗ No key saved';
  };
  paint();
  c.appendChild(badge);
  const st = el('div', 'occ-muted', has ? opts.saved : opts.empty);
  c.appendChild(st);
  const input = el('input', 'occ-field');
  input.type = 'password';
  input.placeholder = has ? 'Paste a new value to replace' : opts.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  c.appendChild(input);
  const row = el('div', 'occ-bar');
  row.appendChild(
    button('Save', () => {
      const v = input.value.trim();
      if (!v) return;
      keys.set(opts.key, v);
      input.value = '';
      st.textContent = opts.saved;
      paint();
      input.placeholder = 'Paste a new value to replace';
      if (opts.onChange) opts.onChange(v);
    })
  );
  row.appendChild(
    button(
      'Forget',
      () => {
        keys.del(opts.key);
        st.textContent = opts.empty;
        paint();
        input.placeholder = opts.placeholder;
        if (opts.onChange) opts.onChange('');
      },
      true
    )
  );
  c.appendChild(row);
}

// Panel height, the standard setting every kit window has: a share of the screen height, saved per
// device (a phone and a PC want different sizes). 0 = the built-in size.
const KEY_PANEL_H = 'occ.panel.h';

function applyHeight(win) {
  const n = store.get(KEY_PANEL_H, 0);
  win.style.height = n ? n + 'vh' : '';
  if (!n) return (win.style.maxHeight = '');
  const bottom = parseFloat(getComputedStyle(win).bottom) || 0;
  win.style.maxHeight = 'calc(100vh - ' + Math.round(bottom + 8) + 'px)';
}

function panelField(c, win) {
  c.appendChild(el('h3', '', 'Panel'));
  const row = el('div', 'occ-bar');
  row.appendChild(el('span', 'occ-muted', 'Height'));
  const val = el('span', 'occ-hval');
  const now = () => store.get(KEY_PANEL_H, 0) || Math.max(30, Math.min(100, Math.round((win.offsetHeight / innerHeight) * 10) * 10));
  const paint = () => (val.textContent = store.get(KEY_PANEL_H, 0) ? store.get(KEY_PANEL_H, 0) + '%' : 'Auto');
  const set = (n) => {
    store.set(KEY_PANEL_H, n);
    applyHeight(win);
    paint();
  };
  row.appendChild(button('−', () => set(Math.max(30, now() - 10)), true));
  row.appendChild(val);
  row.appendChild(button('+', () => set(Math.min(100, now() + 10)), true));
  row.appendChild(button('Auto', () => set(0), true));
  paint();
  c.appendChild(row);
  c.appendChild(el('div', 'occ-muted', 'Share of the screen height, saved on this device.'));
}

// Tooltip and toast boxes live in the script root (fixed, top z-index) so Torn's own panels and
// its sidebar stacking context can never cover them.
function placeBox(box, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = Math.min(260, window.innerWidth - 16);
  box.style.maxWidth = w + 'px';
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  box.style.top = '';
  box.style.bottom = '';
  if (r.bottom + 90 < window.innerHeight) box.style.top = r.bottom + 8 + 'px';
  else box.style.bottom = window.innerHeight - r.top + 8 + 'px';
}

function tipper(root) {
  let box = null;
  return {
    show(anchor, text) {
      if (!box || !box.isConnected) {
        box = el('div', 'occ-tip');
        root().appendChild(box);
      }
      box.textContent = text;
      box.style.display = 'block';
      placeBox(box, anchor);
    },
    update(text) {
      if (box && box.style.display === 'block') box.textContent = text;
    },
    hide() {
      if (box) box.style.display = 'none';
    },
  };
}

// Small message next to an anchor. Disappears on its own: a timer, plus a watchdog that re-checks
// the deadline, plus any tap or click outside the message (except on `keep` elements).
function toaster(root, keep) {
  let box = null;
  let timer = 0;
  let watch = 0;
  let until = 0;
  let bound = false;
  const hide = () => {
    clearTimeout(timer);
    clearInterval(watch);
    if (box) box.style.setProperty('display', 'none', 'important');
  };
  const show = (anchor, text, bad) => {
    if (!anchor) return;
    if (!box || !box.isConnected) {
      box = el('div', 'occ-toast');
      box.addEventListener('click', hide);
      root().appendChild(box);
    }
    box.textContent = text;
    box.classList.toggle('bad', !!bad);
    box.style.setProperty('display', 'block', 'important');
    placeBox(box, anchor);
    const ms = bad ? 8000 : 3500;
    until = Date.now() + ms;
    clearTimeout(timer);
    clearInterval(watch);
    timer = setTimeout(hide, ms);
    watch = setInterval(() => {
      if (Date.now() >= until) hide();
    }, 400);
    if (!bound) {
      bound = true;
      document.addEventListener(
        'pointerdown',
        (e) => {
          if (box && box.style.display !== 'none' && !(keep && e.target && e.target.closest && e.target.closest(keep))) hide();
        },
        true
      );
    }
  };
  return { show, hide };
}

// ---- occ-kit/core/md.js
// Small markdown renderer for skill and model output: headings, lists, code, rules, tables, links.

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function table(rows) {
  const sep = rows.length > 1 && /^\s*\|?\s*:?-{2,}/.test(rows[1]);
  const head = sep ? cells(rows[0]) : null;
  const body = rows.slice(sep ? 2 : 0).map(cells);
  let h = '<div class="occ-tbl"><table>';
  if (head) h += '<thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>';
  h += '<tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  return h + '</table></div>';
}

function mdToHtml(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  let para = [];
  let fence = null;
  let rows = null;
  const flushPara = () => {
    if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  };
  const closeList = () => {
    if (list) out.push('</' + list + '>');
    list = null;
  };
  const flushTable = () => {
    if (rows) out.push(table(rows));
    rows = null;
  };
  for (const raw of lines) {
    if (fence !== null) {
      if (/^```/.test(raw)) {
        out.push('<pre><code>' + esc(fence.join('\n')) + '</code></pre>');
        fence = null;
      } else fence.push(raw);
      continue;
    }
    const line = raw.replace(/\s+$/, '');
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara();
      closeList();
      (rows = rows || []).push(line);
      continue;
    }
    flushTable();
    if (/^```/.test(line)) {
      flushPara();
      closeList();
      fence = [];
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara();
      closeList();
      out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>');
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      closeList();
      out.push('<hr>');
      continue;
    }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        list = 'ul';
        out.push('<ul>');
      }
      out.push('<li>' + inline(m[1]) + '</li>');
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        list = 'ol';
        out.push('<ol>');
      }
      out.push('<li>' + inline(m[1]) + '</li>');
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>');
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  if (fence !== null) out.push('<pre><code>' + esc(fence.join('\n')) + '</code></pre>');
  flushTable();
  flushPara();
  closeList();
  return out.join('');
}

// Splits an answer into folding sections on markdown headings and "Label:" lines.
function mdSections(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const sections = [];
  let title = null;
  let buf = [];
  let fence = false;
  const push = () => {
    const body = buf.join('\n').trim();
    if (body || title) sections.push({ title, body });
    buf = [];
  };
  for (const line of lines) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && line.match(/^#{1,4}\s+(.*)$/);
    const b = !fence && line.match(/^(\*\*[^*].*\*\*|[A-Z][A-Za-z0-9 ./-]{2,40}):?\s*$/) && /:$/.test(line.trim());
    if (m || b) {
      push();
      title = m ? m[1] : line.trim().replace(/^\*\*|\*\*$/g, '').replace(/:$/, '');
      continue;
    }
    buf.push(line);
  }
  push();
  return sections;
}

// ---- occ-kit/core/kit.js
// The one object every plug-in gets. Plug-ins use only this (or import core modules directly),
// never their own copies of storage, HTTP or theme code.







// host: 'occ' inside the Command Center, 'standalone' in a plug-in's own build.
// root: () => the script's root element (tooltips and toasts are appended there).
function makeKit(host, root) {
  return {
    host,
    version: typeof VERSION !== 'undefined' ? VERSION : 'dev',
    el,
    esc,
    safeIcon,
    store,
    keys,
    vault,
    isPda,
    http,
    parseJson,
    torn,
    tornKey,
    TornApiError,
    TORN_ERRORS,
    KEY_TORN,
    KEY_OR,
    ai: host === 'occ' ? ai : aiDirect,
    ui: { card, errCard, button, accordion, keyField, md: mdToHtml, sections: mdSections },
    tip: tipper(root),
    toast: toaster(root, '.occ-badges'),
  };
}

// ---- plug-in: Torn Chat Image Upload/plugin.js
const PLUGIN_0 = (function () {
// Torn Chat Image Upload: an image button left of Send in every Torn chat window. It uploads the
// picked or pasted image to Catbox (catbox.moe, anonymous unless the user adds a Catbox user hash)
// and puts the link in that chat's text box. The user clicks Send; this script never sends and
// never calls Torn.

const CATBOX = 'https://catbox.moe/user/api.php';
const LINK_RE = /^https:\/\/files\.catbox\.moe\/([A-Za-z0-9]+\.[A-Za-z0-9]+)$/;
const MAX_RECENT = 20;

// Put link at pos, with a space before it when the text there does not end in whitespace, and one
// after it unless the text after already starts with whitespace. Caret lands right after the link.
function insertAt(text, pos, link) {
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const pre = pos > 0 && !/\s$/.test(before) ? ' ' : '';
  const post = /^\s/.test(after) ? '' : ' ';
  return { value: before + pre + link + post + after, caret: before.length + pre.length + link.length + post.length };
}

// Catbox takes multipart form data (GM_xmlhttpRequest and fetch both send FormData as is).
function uploadRequest(file, userhash) {
  const body = new FormData();
  body.append('reqtype', 'fileupload');
  if (userhash) body.append('userhash', userhash);
  body.append('fileToUpload', file, file.name || 'image.png');
  return { method: 'POST', url: CATBOX, body };
}

function deleteRequest(name, userhash) {
  const body = new FormData();
  body.append('reqtype', 'deletefiles');
  body.append('userhash', userhash);
  body.append('files', name);
  return { method: 'POST', url: CATBOX, body };
}

function errorText(status) {
  if (!status) return 'Network error, try again';
  if (status === 413) return 'Image too big for Catbox.';
  if (status === 429) return 'Catbox is busy. Try again in a few minutes.';
  return 'Upload failed (' + status + ')';
}

// Catbox answers with the file's link as plain text, or with an error sentence.
function parseUpload(status, text) {
  const body = String(text || '').trim();
  const m = body.match(LINK_RE);
  if (status >= 200 && status < 300 && m) return { ok: true, id: m[1], link: body };
  if (status >= 200 && status < 300) return { ok: false, error: 'Upload failed: ' + (body.slice(0, 80) || 'empty reply') };
  return { ok: false, error: errorText(status) };
}

function addRecent(list, item) {
  return [item].concat((list || []).filter((x) => x.id !== item.id)).slice(0, MAX_RECENT);
}


// ---- Chat rows -------------------------------------------------------------------------------
// Torn's class names are hashed CSS modules, so a row is found by its shape: the parent of a chat
// textarea that also holds a button with an svg (the Send paper plane).
const IMG_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8.6l4.3-4.3 3.2 3.2 2.3-2.3L19 16.4V7H5zm10.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>';
const SCAN_GAP = 1000;

function findRows(root) {
  const out = [];
  root.querySelectorAll('textarea').forEach((ta) => {
    const row = ta.parentElement;
    if (!row) return;
    const send = [...row.children].find((c) => c.tagName === 'BUTTON' && !c.classList.contains('cimg-btn') && c.querySelector('svg'));
    if (send) out.push({ row, textarea: ta, send });
  });
  return out;
}

// Same colour as the Send icon: Torn paints it with a gradient whose stops carry the theme colour.
function iconColour(send) {
  try {
    const stop = send.querySelector('stop');
    const c = stop && getComputedStyle(stop).stopColor;
    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(0, 0, 0)') return c;
  } catch (e) {}
  return '';
}

function addButton(r, onPick) {
  if (r.row.dataset.cimg === '1' && r.row.querySelector(':scope > .cimg-btn')) return r.row.querySelector(':scope > .cimg-btn');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cimg-btn';
  b.title = 'Upload image (Catbox). Right-click: last uploads';
  b.setAttribute('aria-label', 'Upload image');
  b.innerHTML = IMG_ICON;
  const c = iconColour(r.send);
  if (c) b.style.color = c;
  r.win = (r.row.closest('[id]') || {}).id || '';
  // The click moves focus to the button: remember where the cursor was just before that.
  b.addEventListener('mousedown', () => {
    const ta = liveRow(r).textarea;
    r.caret = ta && document.activeElement === ta ? ta.selectionStart : null;
  });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPick(r);
  });
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openPanel();
  });
  r.row.insertBefore(b, r.send);
  r.row.dataset.cimg = '1';
  return b;
}

function scan(root, onPick, onRow) {
  findRows(root).forEach((r) => {
    if (!(r.row.dataset.cimg === '1' && r.row.querySelector(':scope > .cimg-btn'))) addButton(r, onPick);
    if (onRow) onRow(r); // every scan: React may swap the textarea inside a row that keeps its button
  });
}

// React can replace the textarea, or the whole window, while a row object is held (for example
// during an upload): look the row up again, by its window id when the old row is gone.
function liveRow(r) {
  let row = r.row;
  if (!row.isConnected) {
    const win = r.win && document.getElementById(r.win);
    const found = win ? findRows(win)[0] : null;
    if (!found) return { row, textarea: null, send: r.send, win: r.win };
    row = found.row;
  }
  return { row, textarea: row.querySelector(':scope > textarea'), send: r.send, win: r.win, caret: r.caret };
}

// React keeps its own copy of the value: set it through the native setter, then fire input so
// Torn sees the text and turns Send on. Never clicks Send.
function setValue(textarea, value, caret) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  try {
    textarea.setSelectionRange(caret, caret);
  } catch (e) {}
}

function watch(onPick, onRow) {
  let timer = 0;
  let last = 0;
  const run = () => {
    timer = 0;
    if (document.hidden) return;
    last = Date.now();
    scan(document, onPick, onRow);
  };
  const later = () => {
    if (timer) return;
    timer = setTimeout(run, Math.max(0, SCAN_GAP - (Date.now() - last)));
  };
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => !document.hidden && later());
  run();
}

const CSS = `
.cimg-btn{flex:0 0 auto;width:24px;height:24px;padding:0;margin:0 2px;border:0;background:none;cursor:pointer;color:#999;display:inline-flex;align-items:center;justify-content:center;opacity:.85}
.cimg-btn:hover{opacity:1}
.cimg-btn svg{fill:currentColor;display:block}
.cimg-btn:disabled{cursor:default}
.cimg-busy svg{animation:cimg-spin 1s linear infinite;opacity:.5}
@keyframes cimg-spin{to{transform:rotate(360deg)}}
.cimg-status{font:11px/1.4 Arial,sans-serif;padding:2px 8px;overflow-wrap:anywhere}
.cimg-ok{color:#8bc34a}.cimg-err{color:#e57373}
.cimg-status a{color:inherit;text-decoration:underline}
.cimg-recent{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 0;border-top:1px solid var(--occ-line,#444)}
.cimg-recent a{overflow-wrap:anywhere;min-width:0}
`;

// ---- Upload --------------------------------------------------------------------------------
const KEY_HASH = 'cimg.userhash';
const KEY_RECENT = 'cimg.recent';
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const STATUS_MS = 5000;
let openPanel = () => {};
let panel = null; // the standalone window's view, once drawn

function status(r, text, kind, manage) {
  if (document.hidden) return;
  let line = r.row.nextElementSibling;
  if (!line || !line.classList.contains('cimg-status')) {
    line = document.createElement('div');
    r.row.after(line);
  }
  line.className = 'cimg-status cimg-' + kind;
  line.textContent = text;
  if (manage) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Manage';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openPanel();
    });
    line.append(' · ', a);
  }
  clearTimeout(line._t);
  line._t = setTimeout(() => line.remove(), STATUS_MS);
}

function busy(r, on) {
  const b = liveRow(r).row.querySelector(':scope > .cimg-btn');
  if (!b) return;
  b.disabled = on;
  b.classList.toggle('cimg-busy', on);
}

async function upload(kit, r, file, caret) {
  if (!file || TYPES.indexOf(file.type) === -1) return status(r, 'Use PNG, JPEG, GIF or WebP.', 'err');
  const hash = kit.keys.get(KEY_HASH);
  busy(r, true);
  try {
    const res = await kit.http(uploadRequest(file, hash));
    const up = parseUpload(res.status, res.text);
    if (!up.ok) return status(r, up.error, 'err');
    kit.vault.set(KEY_RECENT, addRecent(kit.vault.get(KEY_RECENT, []), { id: up.id, link: up.link, owned: !!hash, at: Date.now() }));
    const live = liveRow(r);
    const ta = live.textarea;
    if (!ta) return; // chat closed during the upload: the link is kept in the panel's list
    const pos = typeof caret === 'number' && caret <= ta.value.length ? caret : ta.value.length;
    const next = insertAt(ta.value, pos, up.link);
    setValue(ta, next.value, next.caret);
    status(live, 'Link added. Click Send to post it.', 'ok', true);
  } catch (e) {
    status(r, errorText(0), 'err');
  } finally {
    busy(r, false);
  }
}

function picker(kit) {
  return (r) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TYPES.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) upload(kit, r, f, r.caret);
    });
    document.body.appendChild(input);
    input.click();
  };
}

// Paste an image into a chat box = upload it. Text pastes are left alone, including Excel/Word
// copies, which carry plain text and a picture of it.
function pasteHook(kit) {
  const hooked = new WeakSet();
  return (r) => {
    const ta = r.textarea;
    if (hooked.has(ta)) return; // a WeakSet, not a data attribute: a cloned textarea has no listener
    hooked.add(ta);
    ta.addEventListener('paste', (e) => {
      const items = [...((e.clipboardData && e.clipboardData.items) || [])];
      if (items.some((x) => x.kind === 'string' && x.type === 'text/plain')) return;
      const item = items.find((x) => x.kind === 'file' && /^image\//.test(x.type));
      if (!item) return;
      e.preventDefault();
      upload(kit, r, item.getAsFile(), ta.selectionStart);
    });
  };
}

// ---- Panel: last uploads, with Delete (anyone with a link can see the image) ----------------
function when(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function recentList(kit) {
  const wrap = kit.el('div', 'occ-card');
  const list = kit.vault.get(KEY_RECENT, []);
  if (!list.length) {
    wrap.appendChild(kit.el('div', 'occ-muted', 'No uploads yet. Use the image button next to Send in any chat.'));
    return wrap;
  }
  wrap.appendChild(kit.el('h3', '', 'Last uploads'));
  wrap.appendChild(kit.el('div', 'occ-muted', 'Anyone with the link can see the image. Anonymous uploads cannot be deleted; add a Catbox user hash in Setup to get Delete.'));
  list.forEach((it) => {
    const row = kit.el('div', 'cimg-recent');
    const a = kit.el('a', '', kit.esc(it.link.replace(/^https:\/\//, '')));
    a.href = it.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    row.appendChild(a);
    row.appendChild(kit.el('span', 'occ-muted', kit.esc(when(it.at))));
    const msg = kit.el('span', 'cimg-err', '');
    const hash = kit.keys.get(KEY_HASH);
    if (it.owned && hash) {
      const del = kit.ui.button('Delete', async () => {
        del.disabled = true;
        try {
          const res = await kit.http(deleteRequest(it.id, hash));
          // Count it as deleted only when Catbox says so (Torn PDA can answer 200 with no body).
          if (res.status >= 200 && res.status < 300 && /deleted/i.test(res.text || '')) {
            kit.vault.set(KEY_RECENT, kit.vault.get(KEY_RECENT, []).filter((x) => x.id !== it.id));
            row.remove();
            return;
          }
          msg.textContent = res.status >= 200 && res.status < 300 ? 'Not deleted. Try again, or delete it on catbox.moe.' : errorText(res.status);
        } catch (e) {
          msg.textContent = errorText(0);
        }
        del.disabled = false;
      }, true);
      row.appendChild(del);
    }
    row.appendChild(msg);
    wrap.appendChild(row);
  });
  return wrap;
}

return {
  id: 'cimg',
  label: 'Chat images',
  access: 'none',
  css: CSS,
  start(kit) {
    watch(picker(kit), pasteHook(kit));
  },
  launcher(kit, toggle) {
    // Open the panel and always redraw the list, so a new upload shows even when the panel was
    // already open or had been drawn before it was closed.
    openPanel = () => {
      if (!document.querySelector('#occk-cimg .occ-win.occ-on')) toggle();
      if (panel) panel.view.body(recentList(panel.kit));
    };
  },
  mount(view, kit) {
    panel = { view, kit };
    view.body(recentList(kit));
  },
  settings(card, kit) {
    kit.ui.keyField(card, {
      key: KEY_HASH,
      title: 'Catbox user hash (optional)',
      placeholder: 'Catbox user hash',
      saved: 'Saved in Tampermonkey storage. Sent only to catbox.moe. New uploads go to your Catbox account and get Delete.',
      empty: 'Not needed to upload. Without it, uploads are anonymous and cannot be deleted. With a free Catbox account, copy your user hash here.',
    });
  },
};
})();

// ---- occ-kit/shell/standalone.js
// Standalone shell: one plug-in as its own userscript, outside the Command Center.
// start(kit) runs as soon as the page is ready. A plug-in with mount() also gets a small window
// (same look as the Command Center, no tab bar) opened by a floating button, or by its own page
// button when it defines launcher(kit, toggle). access: 'none' = no Torn key field in Setup. solo: false skips that window (the plug-in draws its own). When the Command Center on this page already
// bundles the same plug-in, this copy steps aside so nothing runs or calls the API twice.








const SOLO_WAIT = 1500; // the Command Center runs at document-idle too: give it time to claim its plug-ins
const SOLO_ICON = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
};

function boot(plugins) {
  const p = plugins[0];
  const rootId = 'occk-' + p.id;
  const kit = makeKit('standalone', () => document.getElementById(rootId));
  const KEY_OPEN = 'occk.' + p.id + '.open';
  let win, title, sub, tool, statsRow, main, rerun, gear;
  let view = 'plugin';

  function claimedByOcc() {
    return (' ' + (document.documentElement.getAttribute('data-occ-plugins') || '') + ' ').indexOf(' ' + p.id + ' ') !== -1;
  }

  function show(node) {
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
  }

  const pluginView = {
    body(node) {
      if (view === 'plugin') show(typeof node === 'string' ? el('div', 'occ-md', node) : node);
    },
    stats(list) {
      if (view === 'plugin') fillStats(statsRow, list);
    },
    meta(html) {
      if (view === 'plugin') sub.innerHTML = html || '';
    },
    busy(on) {
      rerun.classList.toggle('occ-busy', !!on);
    },
    get active() {
      return view === 'plugin' && win.classList.contains('occ-on');
    },
  };

  async function openPlugin(force) {
    view = 'plugin';
    title.textContent = p.label;
    sub.innerHTML = '';
    tool.hidden = false;
    gear.classList.remove('occ-act');
    fillStats(statsRow, null);
    show(el('div', 'occ-card', '<span class="occ-spin"></span>Loading...'));
    try {
      await p.mount(pluginView, kit, { force: !!force });
    } catch (e) {
      if (view === 'plugin') show(errCard(p.label + ' failed', String((e && e.message) || e)));
    }
  }

  function showSetup() {
    view = 'setup';
    title.textContent = p.label + ' setup';
    sub.innerHTML = 'v' + esc(kit.version);
    tool.hidden = true;
    gear.classList.add('occ-act');
    fillStats(statsRow, null);
    const wrap = el('div');
    const c1 = el('div', 'occ-card');
    if (p.access !== 'none') keyField(c1, { key: KEY_TORN, fallback: tornKey, title: 'Torn API key', placeholder: 'Torn API key (' + (p.access || 'minimal') + ' access)', saved: 'Key saved in Tampermonkey storage, used only for Torn API calls from your browser.', empty: tornKey() ? 'Using the key Torn PDA filled in.' : 'No key yet. Needs ' + (p.access || 'minimal') + ' access.' });
    if (c1.firstChild) wrap.appendChild(c1);
    if (p.ai) {
      const c2 = el('div', 'occ-card');
      keyField(c2, { key: KEY_OR, title: 'OpenRouter key (AI)', placeholder: 'sk-or-v1-...', saved: 'Key saved in Tampermonkey storage. Only free models are called; they may log what is sent.', empty: 'Optional, for AI answers. Only free OpenRouter models are ever called with it.' });
      wrap.appendChild(c2);
    }
    const cp = el('div', 'occ-card');
    panelField(cp, win);
    wrap.appendChild(cp);
    if (typeof p.settings === 'function') {
      const c3 = el('div', 'occ-card');
      p.settings(c3, kit);
      wrap.appendChild(c3);
    }
    show(wrap);
  }

  function setOpen(on) {
    win.classList.toggle('occ-on', on);
    store.set(KEY_OPEN, on);
    if (on && !main.dataset.ran) {
      main.dataset.ran = '1';
      if (p.access !== 'none' && !tornKey()) showSetup();
      else openPlugin(false);
    }
  }

  function headButton(html, tip, onClick) {
    const b = el('button', 'occ-hb', html);
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', onClick);
    return b;
  }

  function buildWindow(root) {
    win = el('div', 'occ-win occ-solo');
    const head = el('div', 'occ-head');
    title = el('span', 'occ-title', esc(p.label));
    head.appendChild(title);
    head.appendChild(el('span', 'occ-gap'));
    gear = headButton(SOLO_ICON.gear, 'Setup', () => (view === 'setup' ? openPlugin(false) : showSetup()));
    head.appendChild(gear);
    head.appendChild(headButton('&times;', 'Close', () => setOpen(false)));
    win.appendChild(head);
    tool = el('div', 'occ-tool');
    sub = el('span', 'occ-sub', '');
    tool.appendChild(sub);
    rerun = button(SOLO_ICON.refresh + 'Refresh', () => openPlugin(true));
    tool.appendChild(rerun);
    win.appendChild(tool);
    statsRow = el('div', 'occ-stats');
    win.appendChild(statsRow);
    main = el('div', 'occ-main occ-scroll');
    win.appendChild(main);
    root.appendChild(win);
    applyHeight(win);
    trapScroll(win);
    const toggle = () => setOpen(!win.classList.contains('occ-on'));
    if (typeof p.launcher === 'function') p.launcher(kit, toggle);
    else {
      const launch = el('button', 'occ-launch', kit.safeIcon(p.icon) || '<span style="font:bold 16px Arial">' + esc(p.label.charAt(0)) + '</span>');
      launch.type = 'button';
      launch.title = p.label;
      launch.addEventListener('click', toggle);
      root.appendChild(launch);
    }
    if (store.get(KEY_OPEN, false)) setOpen(true);
  }

  function build() {
    if (claimedByOcc() || document.getElementById(rootId)) return;
    const root = el('div');
    root.id = rootId;
    const solo = typeof p.mount === 'function' && p.solo !== false;
    injectTheme(root, '#' + rootId, (solo ? frameCss('#' + rootId) : '') + (p.css || ''));
    document.body.appendChild(root);
    if (typeof p.start === 'function') p.start(kit);
    if (solo) buildWindow(root);
  }

  const go = () => setTimeout(build, SOLO_WAIT);
  if (document.body) go();
  else document.addEventListener('DOMContentLoaded', go);
}

boot([PLUGIN_0]);
})();
