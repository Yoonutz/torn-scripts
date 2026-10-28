// ==UserScript==
// @name         Operational Command Center
// @namespace    Torn.Operational-Command-Center
// @version      0.8.17
// @description  One floating dashboard inside Torn. Buttons come from the repo's skills: each runs its skill on a private Cloudflare runner with your Torn key, free OpenRouter models write the answer, and it lands in the content pane. Mobile first, works in Torn PDA.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      occ-runner.yoonutz.workers.dev
// @connect      api.torn.com
// @connect      live.chain-race.workers.dev
// @connect      openrouter.ai
// @run-at       document-idle
// ==/UserScript==

// Built by occ-kit/build.mjs from the sources named below. Edit those, then rebuild.
(function () {
  'use strict';

const VERSION = '0.8.17';

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
const MODELS_FREE = [
  'thinkingmachines/inkling:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-31b-it:free',
  'cohere/north-mini-code:free',
  'openrouter/free',
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
// Phone: fills the screen with a 10px margin. Desktop: 420x640, bottom right.
function frameCss(R) {
  return `
  ${R} .occ-win{position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99991;display:none;grid-template-rows:34px auto auto 1fr 50px;grid-template-areas:"head" "tool" "stats" "main" "tabs";background:var(--occ-bg);color:var(--occ-fg);font:var(--occ-font);overflow:hidden;text-align:left;color-scheme:light;border:1px solid var(--occ-div-dark);border-radius:5px;box-shadow:0 0 12px rgba(0,0,0,.7)}
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
function keyField(c, opts) {
  c.appendChild(el('h3', '', opts.title));
  const has = !!keys.get(opts.key);
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
        input.placeholder = opts.placeholder;
        if (opts.onChange) opts.onChange('');
      },
      true
    )
  );
  c.appendChild(row);
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

// ---- plug-in: Operational Command Center/plugins/trains.js
const PLUGIN_0 = (function () {
// Company trains pill: the count of trains in the company bank, next to the OCC icon.
// GET company/profile, field profile.trains (director key, Limited or higher). Max 20 is fixed.
// Torn adds the daily trains with the company update at ~18:05 TCT (UTC, no DST), so one call just
// after that, a 12h safety net, a call after training on the company page, or on click.
// No timed call while the tab is hidden; it catches up when the tab is back.

const KEY_TRAINS = 'occ.trains';
const KEY_TRAINS_LOCK = 'occ.trains.lock';
const TRAINS_MAX = 20;
const TRAINS_GRANT = (18 * 60 + 7) * 60000; // 18:07 TCT, as ms after UTC midnight
const TRAINS_SAFETY = 12 * 3600 * 1000;
const TRAINS_RETRY = 10 * 60000;
const TRAINS_AFTER_TRAIN = 4000;
const TRAINS_COOLDOWN = 30000;
const TRAINS_LOCK_MS = 30000;
const TRAINS_STOP = [1, 2, 16, 18];

let kit = null;
let trains = null;
let trainsBusy = false;
let trainsTimer = 0;

// Torn City Time (UTC), so the shown times never move with local daylight saving.
function hhmm(ts) {
  const d = new Date(ts);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' TCT';
}

function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago';
}

function keyTail(k) {
  return String(k).slice(-4);
}

// Latest 18:07 TCT at or before now.
function lastGrant(now) {
  const day = 86400000;
  const g = Math.floor(now / day) * day + TRAINS_GRANT;
  return g <= now ? g : g - day;
}

// A key that ever got a count is a director's key, so a later "not a director" reply was a hiccup.
function hadCount(c) {
  return !!c && typeof c.n === 'number';
}

// When the next automatic refresh is due (ms timestamp), or Infinity when it never is.
function nextAt(c, key) {
  if (!c || typeof c.tried !== 'number' || c.kh !== keyTail(key)) return 0;
  if (c.bad) return Infinity;
  if (c.none) return hadCount(c) ? 0 : c.tried + 86400000;
  const now = Date.now();
  if (c.tried < lastGrant(now)) return 0;
  let at = Math.min(lastGrant(now) + 86400000, c.tried + TRAINS_SAFETY);
  if (c.retry) at = Math.min(at, c.tried + TRAINS_RETRY);
  return at;
}

function schedule() {
  clearTimeout(trainsTimer);
  const key = kit.tornKey();
  if (!key) return;
  const at = nextAt(kit.store.get(KEY_TRAINS, null), key);
  if (at === Infinity) return;
  // Cap the wait so a sleeping laptop or throttled tab re-checks reasonably soon.
  const wait = Math.min(Math.max(5000, at - Date.now()), 3600000);
  trainsTimer = setTimeout(() => {
    // Hidden tab: no call now; the visibility handler catches up when the tab is back.
    if (document.hidden) return;
    refresh(false).then(schedule);
  }, wait);
}

function tipText() {
  const t = trains || {};
  if (t.nokey) return 'Company trains · ' + t.err;
  const parts = ['Company trains' + (typeof t.n === 'number' ? ' ' + t.n + ' / ' + TRAINS_MAX : '')];
  parts.push(typeof t.ts === 'number' ? 'refreshed ' + hhmm(t.ts) + ' (' + ago(t.ts) + ')' : 'not refreshed yet');
  if (t.err) parts.push(t.err);
  if (typeof t.n === 'number' && t.n >= TRAINS_MAX) parts.push('FULL: daily trains are being lost');
  const key = kit.tornKey();
  const at = key ? nextAt(t, key) : Infinity;
  if (at !== Infinity) parts.push('next ' + hhmm(Math.max(Date.now(), at)));
  parts.push('click to refresh');
  return parts.join(' · ');
}

// extra: a pill not in the page yet (the shell appends it after badge() returns), which
// querySelectorAll cannot see. Without it a rebuilt pill stayed empty until the next refresh.
function paint(extra) {
  const has = !!trains && typeof trains.n === 'number';
  const n = has ? trains.n : -1;
  const html = '<span class="n">' + (has ? n : '?') + '</span><span class="s">/</span><span class="m">' + TRAINS_MAX + '</span>';
  const tip = tipText();
  const pills = Array.from(document.querySelectorAll('.occ-trains'));
  if (extra && pills.indexOf(extra) === -1) pills.push(extra);
  pills.forEach((p) => {
    p.classList.toggle('full', n >= TRAINS_MAX);
    p.classList.toggle('hot', n > 0 && n < TRAINS_MAX);
    p.classList.toggle('stale', !has || !!(trains && trains.err));
    p.classList.toggle('busy', trainsBusy);
    p.classList.toggle('occ-none', !!(trains && trains.none) && !has);
    if (p.innerHTML !== html) p.innerHTML = html;
    if (p.getAttribute('data-tip') !== tip) p.setAttribute('data-tip', tip);
  });
  kit.tip.update(tip);
}

// Torn sometimes answers a director's key without the trains count (or with error 6/7), e.g. around
// the company update. Hiding the pill on that kept it empty for a whole day, so once a key has had a
// count, keep showing it and retry in 10 minutes instead.
function notDirector(rec) {
  if (hadCount(rec)) {
    rec.err = 'Torn sent no trains count, showing the last one';
    rec.retry = true;
  } else {
    rec.none = true;
  }
}

async function refresh(manual, pill, force) {
  const say = (t, bad) => {
    if (manual) kit.toast.show(pill || document.querySelector('.occ-trains'), t, bad);
  };
  if (trainsBusy) {
    say('Still refreshing. Give it a few seconds.');
    return;
  }
  const key = kit.tornKey();
  const cur = kit.store.get(KEY_TRAINS, null);
  if (!key) {
    trains = Object.assign({}, cur || {}, { nokey: true, err: 'Set your Torn key in Setup' });
    paint();
    say('No Torn key yet. Open the Command Center, tap Setup and paste your key.', true);
    return;
  }
  const kh = keyTail(key);
  const now = Date.now();
  const same = !!cur && cur.kh === kh;
  if (manual) {
    if (same && now - cur.tried < TRAINS_COOLDOWN) {
      const last = typeof cur.n === 'number' && !cur.err ? cur.n + ' / ' + TRAINS_MAX : cur.err || 'no value yet';
      say('Refreshed ' + Math.round((now - cur.tried) / 1000) + 's ago (' + last + '). You can refresh again in ' + Math.ceil((TRAINS_COOLDOWN - (now - cur.tried)) / 1000) + 's.', !!cur.err);
      return;
    }
  } else {
    if (!force && Date.now() < nextAt(cur, key)) {
      trains = cur;
      paint();
      return;
    }
    // Another Torn tab is already fetching: skip, the storage event will bring its result.
    if (now - kit.store.get(KEY_TRAINS_LOCK, 0) < TRAINS_LOCK_MS) return;
  }
  kit.store.set(KEY_TRAINS_LOCK, now);
  trainsBusy = true;
  paint();
  say('Refreshing…');
  const rec = { n: same ? cur.n : undefined, ts: same ? cur.ts : undefined, tried: now, kh: kh };
  let net = false;
  try {
    const j = await kit.torn('company/profile');
    if (j.profile && typeof j.profile.trains === 'number') {
      rec.n = j.profile.trains;
      rec.ts = Date.now();
    } else if (j.profile) {
      // Not a company director: hide the pill and only look again once a day.
      notDirector(rec);
    } else {
      rec.err = 'Unexpected reply from Torn';
    }
  } catch (e) {
    if (e instanceof kit.TornApiError) {
      if (e.code === 6 || e.code === 7) {
        // Not in a company (wrong ID / ID-entity relation): same as not a director.
        notDirector(rec);
      } else {
        rec.err = e.code === 16 ? 'Key access level too low (needs Limited or higher)' : e.message;
        if (TRAINS_STOP.indexOf(e.code) !== -1) rec.bad = true;
        if (e.code === 5) rec.retry = true;
      }
    } else if (/^Unexpected reply/.test(e.message)) {
      rec.err = e.message;
    } else {
      net = true;
      rec.retry = true;
      rec.err = 'Refresh failed: ' + (e && e.message ? e.message : 'error');
    }
  } finally {
    trainsBusy = false;
    kit.store.set(KEY_TRAINS, rec);
    kit.store.del(KEY_TRAINS_LOCK);
    trains = rec;
    paint();
    schedule();
  }
  if (rec.err) {
    say(rec.err + (net ? '. If Tampermonkey asked about api.torn.com, choose Always allow, then click again.' : ''), true);
  } else if (rec.none) {
    say('No company trains: this key is not a company director.');
  } else {
    say('Company trains: ' + rec.n + ' / ' + TRAINS_MAX + (rec.n >= TRAINS_MAX ? '. Full: daily trains are being lost.' : '.'));
  }
}

function makePill(k) {
  const p = k.el('span', 'occ-trains');
  p.setAttribute('role', 'button');
  p.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    kit.tip.hide();
    refresh(true, p);
  });
  p.addEventListener('mouseenter', () => kit.tip.show(p, tipText()));
  p.addEventListener('mouseleave', () => kit.tip.hide());
  return p;
}

function start(k) {
  kit = k;
  trains = kit.store.get(KEY_TRAINS, null);
  paint();
  if (!document.hidden) refresh(false).then(schedule);
  // Background tabs get their timers throttled: check again when the tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh(false).then(schedule);
  });
  addEventListener('storage', (e) => {
    if (e.key !== KEY_TRAINS) return;
    trains = kit.store.get(KEY_TRAINS, null);
    paint();
    schedule();
  });
  // Training an employee spends trains: refresh a few seconds after the last Train click on the
  // company page (the wait also covers the confirm step). Only listens, never clicks.
  let trainedTimer = 0;
  document.addEventListener(
    'click',
    (e) => {
      if (!/companies\.php/.test(location.pathname)) return;
      const b = e.target && e.target.closest ? e.target.closest('button,a,input[type="button"],input[type="submit"]') : null;
      if (!b || !/\btrain/i.test(b.textContent || b.value || '')) return;
      clearTimeout(trainedTimer);
      trainedTimer = setTimeout(() => {
        refresh(false, null, true).then(schedule);
      }, TRAINS_AFTER_TRAIN);
    },
    true
  );
}

return {
  id: 'trains',
  label: 'Trains',
  access: 'limited',
  start,
  // Shell asks for a fresh pill whenever it (re)builds a badge slot (page load, Torn redrawing the
  // name row, phone dock), so it is filled here before it goes in the page.
  badge(k) {
    const p = makePill(k);
    if (kit) paint(p);
    return p;
  },
  css: `
    .occ-trains{all:unset;box-sizing:border-box;position:relative;display:inline-flex!important;align-items:center;flex:none;height:13px;margin:0 0 0 3px;padding:0 3px;background:#1f1f1f;border:1px solid #3a3a3a;border-radius:3px;font:700 9px/1 Verdana,Arial,sans-serif;color:#8a8a8a;white-space:nowrap;vertical-align:middle;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}
    .occ-trains .n{color:#d6d6d6}
    .occ-trains .s{margin:0 2px;font-weight:400;color:#8a8a8a}
    .occ-trains .m{font-weight:400;color:#8a8a8a}
    .occ-trains .s,.occ-trains .m{display:none}
    .occ-dock .occ-trains .s,.occ-dock .occ-trains .m,.occ-badges.occ-float .occ-trains .s,.occ-badges.occ-float .occ-trains .m{display:inline}
    .occ-dock .occ-trains{margin:0 0 0 6px;height:16px;padding:0 6px;font-size:11px}
    .occ-badges.occ-float .occ-trains{margin:0}
    .occ-trains.hot{border-color:#6b5a26}
    .occ-trains.hot .n{color:#f2c14e}
    .occ-trains.full{border-color:#7a2f2b}
    .occ-trains.full .n{color:#e5534b}
    .occ-trains.stale{opacity:.55}
    .occ-trains.occ-none{display:none!important}
    .occ-trains.busy{animation:occ-tpulse 1s ease-in-out infinite}
    @keyframes occ-tpulse{50%{opacity:.35}}
  `,
};
})();

// ---- plug-in: Operational Command Center/plugins/paid.js
const PLUGIN_1 = (function () {
// Paid trains: how many paid trains each employee has left. Replaces the Company Training Companion
// and its Google Sheet. Everything Torn knows comes from the Torn API:
//   company/news cat=training  trains given (the news links carry the XID, so renames don't matter)
//   user/events                "You were sent $X from <employee>": payments
//   company/employees          names and ids
// The only state Torn does not keep is the ledger: confirmed payments, price per train, start
// balances and who is trained for free (pro bono). It lives on the private runner (/data/paid), one document per
// player, so phone and PC show the same numbers; Tampermonkey storage keeps a copy.
// No timed calls: it syncs when the company page or the tab opens, when a Torn tab comes back, and
// a few seconds after a Train click on the company page (it only listens to that click).

const KEY_LEDGER = 'occ.paid.ledger';
const KEY_NEWS = 'occ.paid.news';
const KEY_EV = 'occ.paid.ev';
const KEY_EMPS = 'occ.paid.emps';
const KEY_LOCK = 'occ.paid.lock';
const KEY_LAST = 'occ.paid.last';
const OLD_SNAPSHOT = 'tcw_paid_trains_snapshot_v1'; // the old Companion's cached sheet numbers
const PRICE = 500000;
const SYNC_GAP = 60000;
const EV_GAP = 5 * 60000;
const EMP_GAP = 6 * 3600000;
const LOCK_MS = 30000;
const PAGES = 40;
const AFTER_TRAIN = [4000, 15000];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let kit = null;
let doc = null; // { rev, value } as the runner last sent it
let news = null;
let ev = null;
let emps = null;
let errs = {};
let busy = false;
let tabView = null;
let open = {}; // employee rows expanded in the tab
let steps = {}; // trains picked for item payments in the inbox
let pricing = false; // price editor open in the tab

// ---------- pure parts (tested in occ-kit/tests) ----------

const nowSec = () => Math.floor(Date.now() / 1000);

function newLedger(now) {
  return { v: 1, price: PRICE, since: now, auto: true, emp: {}, pays: [], skip: [], hold: [] };
}

// "Consultant <a href = http://www.torn.com/profiles.php?XID=2239897>Hookah12</a> has been trained by the director"
function parseTraining(n) {
  const m = /XID=(\d+)[^>]*>\s*([^<]+?)\s*<\/a>\s*has been trained by the director/i.exec(String((n && n.text) || ''));
  return m ? [String(n.id), n.timestamp, m[1], m[2]] : null;
}

// 'You were sent $100,000,000 from <a href="...XID=2239897">Hookah12</a> with the message: Train me boss'
function parsePayment(e) {
  const m = /^You were sent (.+?) from <a [^>]*?XID=(\d+)[^>]*>\s*([^<]+?)\s*<\/a>(?:\s+with the message:\s*([\s\S]*?))?\.?\s*$/.exec(String((e && e.event) || ''));
  if (!m) return null;
  const p = { id: String(e.id), ts: e.timestamp, emp: m[2], name: m[3], msg: (m[4] || '').trim() };
  if (/^\$[\d,]+$/.test(m[1])) p.money = Number(m[1].replace(/\D/g, ''));
  else p.items = m[1].replace(/<[^>]*>/g, '');
  return p;
}

// Adds a page of feed entries (each with id at [0] or .id, timestamp at [1] or .ts). Returns how many were new.
function addPage(cache, entries) {
  const seen = new Set(cache.list.map(idOf));
  let fresh = 0;
  entries.forEach((x) => {
    if (!x || seen.has(idOf(x))) return;
    seen.add(idOf(x));
    cache.list.push(x);
    fresh++;
  });
  cache.list.sort((a, b) => tsOf(a) - tsOf(b));
  return fresh;
}

function idOf(x) {
  return Array.isArray(x) ? x[0] : x.id;
}

function tsOf(x) {
  return Array.isArray(x) ? x[1] : x.ts;
}

// Oldest moment any balance counts from: trains and payments before it are not needed.
function needFrom(ledger) {
  let m = ledger.since;
  Object.keys(ledger.emp).forEach((id) => {
    const s = ledger.emp[id].start;
    if (typeof s === 'number' && s < m) m = s;
  });
  return m;
}

// left = start balance + paid trains since start - trains given since start. Someone trained for
// free (pro bono, ledger flag `daily` from the old sheet's -1 marker) has no balance at all: left 0,
// never owing, never counted in the totals.
function balances(ledger, trainings, staff) {
  const out = {};
  const ids = new Set(Object.keys(ledger.emp).concat((staff || []).map((s) => s.id)));
  const names = {};
  (staff || []).forEach((s) => (names[s.id] = s.name));
  ids.forEach((id) => {
    const e = ledger.emp[id] || {};
    const start = typeof e.start === 'number' ? e.start : ledger.since;
    const pays = ledger.pays.filter((p) => p.emp === id && p.ts >= start);
    const paid = pays.reduce((a, p) => a + (p.trains || 0), 0);
    const used = trainings.filter((t) => t[2] === id && t[1] >= start).length;
    out[id] = {
      id,
      name: names[id] || e.name || '#' + id,
      staff: id in names,
      daily: !!e.daily,
      carry: e.carry || 0,
      start,
      paid,
      used,
      left: e.daily ? 0 : (e.carry || 0) + paid - used,
      last: pays.length ? pays[pays.length - 1] : null,
    };
  });
  return out;
}

// Payments from staff (or anyone in the ledger) since tracking began that are not decided yet.
function inbox(ledger, payments, staff) {
  const who = new Set(Object.keys(ledger.emp).concat((staff || []).map((s) => s.id)));
  const done = new Set(ledger.pays.map((p) => p.id).concat(ledger.skip));
  return payments.filter((p) => p.ts >= ledger.since && who.has(p.emp) && !done.has(p.id));
}

// hold: payments you took back with Undo, never added on their own again.
// "600k", "$600,000", "0.6m" -> 600000. 0 when it is not a usable price.
function parsePrice(text) {
  const m = /^\$?\s*([\d.,]+)\s*([km]?)$/i.exec(String(text || '').trim());
  if (!m) return 0;
  const unit = { k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1;
  const n = Math.round(Number(unit === 1 ? m[1].replace(/[.,]/g, '') : m[1].replace(/,/g, '')) * unit);
  return Number.isFinite(n) && n >= 1000 && n <= 1e9 ? n : 0;
}

function autoTrains(ledger, p) {
  return ledger.auto !== false && (ledger.hold || []).indexOf(p.id) === -1 && typeof p.money === 'number' && /train/i.test(p.msg || '') ? Math.floor(p.money / (ledger.price || PRICE)) : 0;
}

// Old Companion snapshot { paidTrainsLeftByEmployee: { name: value }, updatedAtIso } -> start balances.
// -1 was its "trained for free" marker.
function fromSnapshot(snap, staff) {
  const map = (snap && snap.paidTrainsLeftByEmployee) || {};
  const at = Math.floor(Date.parse((snap && snap.updatedAtIso) || '') / 1000);
  if (!at) return null;
  const rows = [];
  (staff || []).forEach((s) => {
    if (!Object.prototype.hasOwnProperty.call(map, s.name)) return;
    const n = parseInt(String(map[s.name]), 10);
    rows.push({ id: s.id, name: s.name, carry: n === -1 || !Number.isFinite(n) ? 0 : n, daily: n === -1 });
  });
  return { at, rows };
}

// ---------- runner + Torn ----------

async function runner(method, body) {
  const r = await kit.http({
    url: RUNNER + '/data/paid',
    method,
    headers: { Authorization: 'ApiKey ' + kit.tornKey(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    timeout: 20000,
  });
  return { status: r.status, json: kit.parseJson(r.text) };
}

function keepDoc(d) {
  doc = { rev: d.rev, value: d.value };
  kit.vault.set(KEY_LEDGER, doc);
}

async function loadLedger() {
  const r = await runner('GET');
  if (r.status !== 200) throw new Error(r.status === 403 ? 'The runner is private to its owner' : r.json.error || 'Runner HTTP ' + r.status);
  keepDoc(r.json);
}

// fn gets a copy of the ledger and returns the new one. A change made on another device in the
// meantime is fetched and fn runs again on top of it.
async function save(fn) {
  let base = doc || { rev: 0, value: null };
  for (let i = 0; i < 3; i++) {
    const value = fn(JSON.parse(JSON.stringify(base.value || newLedger(nowSec()))));
    const r = await runner('POST', { rev: base.rev, value });
    if (r.status === 200) {
      keepDoc(r.json);
      return;
    }
    if (r.status !== 409) throw new Error(r.json.error || 'Runner HTTP ' + r.status);
    base = { rev: r.json.rev, value: r.json.value };
  }
  throw new Error('Changed on another device at the same time, try again');
}

async function syncEmps(force) {
  if (!force && emps && Date.now() - emps.ts < EMP_GAP) return;
  const j = await kit.torn('company/employees');
  const raw = Array.isArray(j.employees) ? j.employees : Object.keys(j.employees || {}).map((id) => Object.assign({ id }, j.employees[id]));
  emps = { ts: Date.now(), list: raw.map((e) => ({ id: String(e.id), name: String(e.name || '') })) };
  kit.vault.set(KEY_EMPS, emps);
}

// Pages forward from the newest entry kept. Torn's from= is inclusive, so the same second comes back
// and addPage drops what it already has.
async function feed(cache, path, parse) {
  for (let i = 0; i < PAGES; i++) {
    const j = await kit.torn(path + '&sort=ASC&limit=100&from=' + cache.top);
    const raw = (j.news || j.events || []).filter((x) => x && typeof x.timestamp === 'number');
    if (!raw.length) break;
    const fresh = addPage(cache, raw.map(parse).filter(Boolean));
    const top = Math.max.apply(null, raw.map((x) => x.timestamp));
    if (top <= cache.top && !fresh) break;
    cache.top = Math.max(cache.top, top);
    if (raw.length < 100) break;
  }
}

async function syncNews() {
  const need = needFrom(doc.value);
  if (!news || news.from > need) news = { from: need, top: need, list: [] };
  await feed(news, 'company/news?cat=training&striptags=false', parseTraining);
  news.list = news.list.filter((t) => t[1] >= need);
  news.from = need;
  kit.vault.set(KEY_NEWS, news);
}

async function syncEvents() {
  const need = doc.value.since;
  if (!ev || ev.from > need) ev = { from: need, top: need, list: [] };
  await feed(ev, 'user/events?striptags=false', parsePayment);
  ev.list = ev.list.filter((p) => p.ts >= need);
  ev.from = need;
  ev.ts = Date.now();
  kit.vault.set(KEY_EV, ev);
  const auto = inbox(doc.value, ev.list, emps && emps.list).filter((p) => autoTrains(doc.value, p) > 0);
  if (auto.length)
    await save((l) => {
      const have = new Set(l.pays.map((p) => p.id));
      auto.forEach((p) => {
        if (!have.has(p.id)) l.pays.push({ id: p.id, emp: p.emp, ts: p.ts, money: p.money, trains: autoTrains(l, p), auto: true });
      });
      l.pays.sort((a, b) => a.ts - b.ts);
      return l;
    });
}

function tornErr(e, what) {
  if (e instanceof kit.TornApiError && (e.code === 6 || e.code === 7)) return what + ': needs a company director key';
  if (e instanceof kit.TornApiError && e.code === 16) return what + ': key access too low (needs Limited)';
  return what + ': ' + ((e && e.message) || e);
}

// One round: ledger, staff, trains, then payments when asked. Each part's error is kept for the UI.
async function sync(force, withEvents) {
  if (busy || !kit.tornKey()) return;
  const now = Date.now();
  if (!force && now - kit.store.get(KEY_LAST, 0) < SYNC_GAP && !(withEvents && (!ev || now - ev.ts > EV_GAP))) return;
  if (!force && now - kit.store.get(KEY_LOCK, 0) < LOCK_MS) return;
  kit.store.set(KEY_LOCK, now);
  busy = true;
  paintAll();
  errs = {};
  try {
    try {
      await loadLedger();
      if (!doc.value) await save((l) => l);
    } catch (e) {
      errs.ledger = 'Ledger: ' + e.message;
    }
    try {
      await syncEmps(force);
    } catch (e) {
      errs.emps = tornErr(e, 'Employees');
    }
    if (doc && doc.value) {
      try {
        await syncNews();
      } catch (e) {
        errs.news = tornErr(e, 'Training news');
      }
      if (withEvents && !errs.ledger) {
        try {
          await syncEvents();
        } catch (e) {
          errs.ev = tornErr(e, 'Payments');
        }
      }
    }
    kit.store.set(KEY_LAST, Date.now());
  } finally {
    busy = false;
    kit.store.del(KEY_LOCK);
    paintAll();
  }
}

// Balance taps (+1, -10...) show at once and are saved together a moment after the last tap, so a
// burst of taps is one write to the runner, not one each. No Torn API call either way.
let pending = {};
let pendTimer = 0;
const PEND_MS = 1200;

function withPending(l) {
  Object.keys(pending).forEach((id) => {
    const e = (l.emp[id] = l.emp[id] || { carry: 0, start: l.since });
    e.carry = (e.carry || 0) + pending[id];
  });
  return l;
}

function bump(id, name, start, d, btn) {
  pending[id] = (pending[id] || 0) + d;
  paintAll();
  clearTimeout(pendTimer);
  pendTimer = setTimeout(() => {
    const p = pending;
    pending = {};
    save((l) => {
      Object.keys(p).forEach((k) => {
        const e = (l.emp[k] = l.emp[k] || { carry: 0, start });
        if (k === id) e.name = name;
        e.carry = (e.carry || 0) + p[k];
      });
      return l;
    })
      .catch((e) => kit.toast.show(btn && btn.isConnected ? btn : document.querySelector('#occ-root .occ-pd-price'), 'Not saved: ' + e.message, true))
      .then(paintAll);
  }, PEND_MS);
}

function view() {
  if (!doc || !doc.value) return null;
  const l = Object.keys(pending).length ? withPending(JSON.parse(JSON.stringify(doc.value))) : doc.value;
  return balances(l, (news && news.list) || [], emps && emps.list);
}

// ---------- company page column ----------

function onCompany() {
  return /companies\.php/.test(location.pathname);
}

function cellText(b) {
  if (!b) return '-';
  if (b.daily) return 'Free';
  return String(b.left);
}

function cellTip(b) {
  if (!b) return 'Paid trains: not synced yet';
  if (b.daily) return b.name + ': trained for free (pro bono)';
  return b.name + ': ' + b.left + ' paid trains left (' + (b.carry ? 'start ' + b.carry + ', ' : '') + b.paid + ' paid, ' + b.used + ' given since ' + day(b.start) + ')';
}

function paintPage() {
  if (!onCompany() || !document.querySelector('.d .manage-company')) return;
  const header = document.querySelector('ul.employee-list-title.bold');
  const rows = document.querySelectorAll('ul.employee-list li[data-user]');
  if (!header || !rows.length) return;
  // The old Companion's own column (.paid-trains) is hidden by the CSS below while this one is on.
  document.documentElement.classList.add('occ-paid-on');
  if (!header.querySelector('li.occ-paid')) {
    const train = header.querySelector('li.train');
    if (train) {
      const li = kit.el('li', 'occ-paid', 'Paid<div class="t-delimiter"></div>');
      header.insertBefore(li, train);
    }
  }
  const b = view();
  rows.forEach((row) => {
    const body = row.querySelector('.acc-body');
    if (!body) return;
    let cell = body.querySelector('.occ-paid');
    if (!cell) {
      const train = body.querySelector('.train');
      if (!train) return;
      cell = kit.el('div', 'occ-paid', '<div class="r-delimiter white t-show"></div><div class="occ-paid-v"></div>');
      body.insertBefore(cell, train);
    }
    const x = b && b[row.getAttribute('data-user')];
    const v = cell.querySelector('.occ-paid-v');
    const t = cellText(x);
    if (v.textContent !== t) v.textContent = t;
    v.classList.toggle('neg', !!x && x.left < 0);
    v.classList.toggle('daily', !!x && x.daily);
    v.classList.toggle('stale', busy || !!errs.news);
    v.title = cellTip(x);
  });
  // Torn's content column is 784px; the column adds 42px. Same widths the old Companion used.
  const main = document.querySelector('#mainContainer');
  if (main && main.style.width !== '1018px') main.style.width = '1018px';
}

function watchPage() {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const h = document.querySelector('ul.employee-list-title.bold');
      if (!h) return;
      const missing = !h.querySelector('li.occ-paid') || Array.from(document.querySelectorAll('ul.employee-list li[data-user] .acc-body')).some((b) => !b.querySelector('.occ-paid'));
      if (missing) paintPage();
    });
  }).observe(document.body, { childList: true, subtree: true });
  let timers = [];
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest('.employee-list .train a, button, a') : null;
      if (!a || a.closest('#occ-root') || !/\btrain/i.test(a.textContent || '')) return;
      timers.forEach(clearTimeout);
      timers = AFTER_TRAIN.map((ms) => setTimeout(() => sync(true, false), ms));
    },
    true
  );
}

// ---------- tab ----------

function day(sec) {
  const d = new Date(sec * 1000);
  return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
}

function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Fits a stat tile: $202.8M, $14.0B.
function short(n) {
  return n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : money(n);
}

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago';
}

function small(label, fn, cls) {
  const b = kit.el('button', 'occ-pd-b' + (cls ? ' ' + cls : ''), label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn(b);
  });
  return b;
}

// Runs a ledger change from a button, shows a toast on failure, redraws everything.
async function act(btn, fn) {
  btn.disabled = true;
  try {
    await save(fn);
  } catch (e) {
    kit.toast.show(btn, e.message, true);
  }
  btn.disabled = false;
  paintAll();
}

function importCard(snap) {
  const imp = fromSnapshot(snap, emps && emps.list);
  if (!imp || !imp.rows.length) return null;
  const c = kit.ui.card('Import from the old Companion');
  const list = imp.rows
    .filter((r) => r.carry || r.daily)
    .map((r) => kit.esc(r.name) + ' ' + (r.daily ? 'free' : r.carry))
    .join(', ');
  c.appendChild(kit.el('div', 'occ-muted', 'Sheet numbers saved by the old script, from ' + day(imp.at) + '. ' + (list ? 'Non-zero: ' + list + '.' : 'All zero.') + ' Trains and payments after that time count on top.'));
  const bar = kit.el('div', 'occ-bar');
  // Tracking now starts at the sheet's time, so trains and payments since then are fetched again.
  const go = kit.ui.button('Import ' + imp.rows.length + ' balances', () =>
    act(go, (l) => {
      imp.rows.forEach((r) => {
        l.emp[r.id] = Object.assign(l.emp[r.id] || {}, { name: r.name, carry: r.carry, daily: r.daily, start: imp.at });
      });
      l.since = Math.min(l.since, imp.at);
      l.imported = nowSec();
      return l;
    }).then(() => sync(true, true))
  );
  bar.appendChild(go);
  bar.appendChild(kit.ui.button('Start from zero', () => act(go, (l) => Object.assign(l, { imported: nowSec() })), true));
  c.appendChild(bar);
  return c;
}

function inboxCard(list, l) {
  const c = kit.ui.card('New payments');
  c.appendChild(kit.el('div', 'occ-muted', 'Money or items your staff sent since tracking began. Count it as trains or skip it.'));
  list
    .slice()
    .reverse()
    .forEach((p) => {
      const r = kit.el('div', 'occ-pd-row');
      const what = p.money ? money(p.money) : kit.esc(p.items);
      r.appendChild(kit.el('div', 'occ-pd-txt', '<b>' + kit.esc(p.name) + '</b> ' + what + ' <span class="occ-muted">' + day(p.ts) + (p.msg ? ' · "' + kit.esc(p.msg) + '"' : '') + '</span>'));
      const ctl = kit.el('div', 'occ-pd-ctl');
      const fixed = p.money ? Math.floor(p.money / (l.price || PRICE)) : 0;
      if (!p.money) {
        if (!(p.id in steps)) steps[p.id] = 0;
        const n = kit.el('span', 'occ-pd-n', String(steps[p.id]));
        ctl.appendChild(small('−', () => ((steps[p.id] = Math.max(0, steps[p.id] - 1)), (n.textContent = steps[p.id]))));
        ctl.appendChild(n);
        ctl.appendChild(small('+', () => ((steps[p.id] = steps[p.id] + 1), (n.textContent = steps[p.id]))));
      }
      const add = small(p.money ? '+' + fixed + ' trains' : 'Add', () => {
        const t = p.money ? fixed : steps[p.id];
        if (!t) return kit.toast.show(add, 'Pick how many trains first', true);
        act(add, (x) => {
          if (!x.pays.some((y) => y.id === p.id)) x.pays.push({ id: p.id, emp: p.emp, ts: p.ts, money: p.money, items: p.items, trains: t });
          x.pays.sort((a, b) => a.ts - b.ts);
          return x;
        });
      }, 'go');
      ctl.appendChild(add);
      const skip = small('Not trains', () =>
        act(skip, (x) => {
          if (x.skip.indexOf(p.id) === -1) x.skip.push(p.id);
          return x;
        })
      );
      ctl.appendChild(skip);
      r.appendChild(ctl);
      c.appendChild(r);
    });
  return c;
}

function staffCard(b, snap) {
  const c = kit.ui.card('Employees');
  const old = snap && snap.paidTrainsLeftByEmployee;
  const t = kit.el('div', 'occ-tbl');
  const table = kit.el('table');
  table.innerHTML = '<tr><th>Name</th><th>Left</th><th>Last paid</th>' + (old ? '<th>Sheet</th>' : '') + '</tr>';
  const list = Object.values(b)
    .filter((x) => x.staff || x.left || x.daily)
    .sort((a, z) => Number(z.staff) - Number(a.staff) || a.left - z.left || a.name.localeCompare(z.name));
  list.forEach((x) => {
    const tr = kit.el('tr', 'occ-pd-emp' + (x.staff ? '' : ' gone'));
    const num = '<span class="' + (x.left < 0 ? 'occ-pd-neg' : x.left > 0 ? 'occ-pd-pos' : '') + '">' + x.left + '</span>';
    const left = x.daily ? '<span class="occ-pd-d" title="Trained for free (pro bono)">Free</span>' : num;
    const sheet = old && Object.prototype.hasOwnProperty.call(old, x.name) ? kit.esc(String(old[x.name] === '' ? 0 : old[x.name])) : '';
    tr.innerHTML = '<td><span class="occ-car">' + (open[x.id] ? '▼' : '▶') + '</span>' + kit.esc(x.name) + (x.staff ? '' : ' <span class="occ-muted">(left)</span>') + '</td><td>' + left + '</td><td>' + (x.last ? day(x.last.ts) : '-') + '</td>' + (old ? '<td class="occ-muted">' + sheet + '</td>' : '');
    tr.addEventListener('click', () => {
      open[x.id] = !open[x.id];
      paintAll();
    });
    table.appendChild(tr);
    if (open[x.id]) table.appendChild(detail(x, old ? 4 : 3));
  });
  t.appendChild(table);
  c.appendChild(t);
  c.appendChild(kit.el('div', 'occ-muted', 'Tap a name to open or close it: adjust the balance, mark it free (pro bono), undo a payment.'));
  return c;
}

function detail(x, cols) {
  const tr = kit.el('tr', 'occ-pd-more');
  const td = kit.el('td');
  td.colSpan = cols;
  td.appendChild(kit.el('div', 'occ-muted', x.daily ? 'Trained for free: ' + x.used + ' trains since ' + day(x.start) + ', nothing owed.' : 'Since ' + day(x.start) + ': start ' + x.carry + ' + ' + x.paid + ' paid - ' + x.used + ' given = ' + x.left));
  const bar = kit.el('div', 'occ-pd-ctl');
  const edit = (fn) => (btn) =>
    act(btn, (l) => {
      const e = (l.emp[x.id] = l.emp[x.id] || { name: x.name, carry: 0, start: x.start });
      e.name = x.name;
      fn(e);
      return l;
    });
  bar.appendChild(small(x.daily ? 'Free: yes' : 'Free: no', edit((e) => (e.daily = !e.daily)), x.daily ? 'go' : ''));
  if (!x.daily) [-10, -1, 1, 10].forEach((d) => bar.appendChild(small((d > 0 ? '+' : '−') + Math.abs(d), (btn) => bump(x.id, x.name, x.start, d, btn))));
  bar.appendChild(
    small('✕ Close', () => {
      open[x.id] = false;
      paintAll();
    }, 'shut')
  );
  td.appendChild(bar);
  const pays = doc.value.pays.filter((p) => p.emp === x.id).slice(-3).reverse();
  pays.forEach((p) => {
    const r = kit.el('div', 'occ-pd-row');
    r.appendChild(kit.el('div', 'occ-pd-txt', day(p.ts) + ' · ' + (p.money ? money(p.money) : kit.esc(p.items || '')) + ' = ' + p.trains + ' trains' + (p.auto ? ' <span class="occ-muted">(auto)</span>' : '')));
    const u = small('Undo', () =>
      act(u, (l) => {
        l.pays = l.pays.filter((y) => y.id !== p.id);
        l.hold = l.hold || [];
        if (l.hold.indexOf(p.id) === -1) l.hold.push(p.id);
        return l;
      })
    );
    r.appendChild(u);
    td.appendChild(r);
  });
  tr.appendChild(td);
  return tr;
}

// Price per train: a themed text field (no native number spinner). Saved on the runner.
function priceField(box, l, done) {
  const row = kit.el('div', 'occ-pd-ctl');
  row.appendChild(kit.el('span', 'occ-muted', 'Price per train'));
  const input = kit.el('input', 'occ-field occ-pd-in');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = String(l.price || PRICE);
  row.appendChild(input);
  const go = small('Save', () => {
    const n = parsePrice(input.value);
    if (!n) return kit.toast.show(go, 'Type a price like 600000, 600k or $600,000', true);
    act(go, (x) => {
      x.price = n;
      return x;
    }).then(() => {
      input.value = String(doc.value.price);
      kit.toast.show(go, 'Saved: ' + money(doc.value.price) + ' a train');
      if (done) done();
    });
  }, 'go');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go.click();
  });
  row.appendChild(go);
  if (done) row.appendChild(small('✕', done, 'shut'));
  box.appendChild(row);
  box.appendChild(kit.el('div', 'occ-muted', 'Payments already counted keep the trains they got. New payments use this price.'));
  return input;
}

function priceCard(l, done) {
  const c = kit.ui.card('Price per train');
  const input = priceField(c, l, done);
  setTimeout(() => input.focus(), 0);
  return c;
}

function render(v) {
  if (!v || !v.active) return;
  const wrap = kit.el('div');
  Object.keys(errs).forEach((k) => wrap.appendChild(kit.ui.errCard('Sync problem', errs[k])));
  if (!kit.tornKey()) {
    v.body(kit.ui.errCard('No Torn key', 'Paste your key in Setup.'));
    return;
  }
  const l = doc && doc.value;
  const b = view();
  if (!l || !b) {
    wrap.appendChild(kit.ui.card('', busy ? '<span class="occ-spin"></span>Loading...' : 'Nothing synced yet. Tap refresh.'));
    v.body(wrap);
    return;
  }
  const snap = kit.store.get(OLD_SNAPSHOT, null);
  const list = inbox(l, (ev && ev.list) || [], emps && emps.list);
  const vals = Object.values(b);
  const left = vals.reduce((a, x) => a + Math.max(0, x.left), 0);
  const owed = vals.reduce((a, x) => a + Math.max(0, -x.left), 0);
  v.stats([
    { k: 'Paid left', v: String(left), unit: ' trains' },
    { k: 'Owed', v: owed ? short(owed * (l.price || PRICE)) : '$0', unit: owed ? ' · ' + owed + ' trains' : '' },
    { k: 'To check', v: String(list.length), hot: list.length > 0 },
  ]);
  const at = kit.store.get(KEY_LAST, 0);
  v.meta((busy ? 'Syncing… · ' : at ? 'Synced ' + ago(at) + ' · ' : '') + '<button type="button" class="occ-pd-price" title="Change the price per train">' + money(l.price || PRICE) + ' a train ✎</button>');
  const pb = document.querySelector('#occ-root .occ-pd-price');
  if (pb)
    pb.addEventListener('click', () => {
      pricing = !pricing;
      render(v);
    });
  if (pricing) wrap.appendChild(priceCard(l, () => ((pricing = false), render(v))));
  if (snap && !l.imported) {
    const c = importCard(snap);
    if (c) wrap.appendChild(c);
  }
  if (list.length) wrap.appendChild(inboxCard(list, l));
  wrap.appendChild(staffCard(b, snap));
  v.body(wrap);
}

function paintAll() {
  paintPage();
  if (tabView) render(tabView);
}

async function mount(v, k, opt) {
  kit = k;
  tabView = v;
  render(v);
  v.busy(true);
  await sync(!!(opt && opt.force), true);
  v.busy(false);
  render(v);
}

function settings(c, k) {
  kit = k;
  c.appendChild(kit.el('h3', '', 'Paid trains'));
  const l = doc && doc.value;
  if (!l) {
    c.appendChild(kit.el('div', 'occ-muted', 'Open the Trains tab once to start tracking.'));
    return;
  }
  priceField(c, l);
  const row2 = kit.el('div', 'occ-pd-ctl');
  row2.appendChild(kit.el('span', 'occ-muted', 'Payments that mention "train"'));
  const auto = small(l.auto !== false ? 'Add on their own' : 'Ask me', (btn) =>
    act(btn, (x) => {
      x.auto = x.auto === false;
      return x;
    }).then(() => (auto.textContent = doc.value.auto !== false ? 'Add on their own' : 'Ask me'))
  );
  row2.appendChild(auto);
  c.appendChild(row2);
  c.appendChild(kit.el('div', 'occ-muted', 'Ledger saved on your private runner, so phone and PC match. Tracking since ' + day(l.since) + '.'));
}

function start(k) {
  kit = k;
  doc = kit.vault.get(KEY_LEDGER, null);
  news = kit.vault.get(KEY_NEWS, null);
  ev = kit.vault.get(KEY_EV, null);
  emps = kit.vault.get(KEY_EMPS, null);
  if (!onCompany()) return;
  watchPage();
  paintPage();
  if (!document.hidden) sync(false, false);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync(false, false);
  });
}

return {
  id: 'paid',
  label: 'Trains',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M6 20V9l6-5 6 5v11"/><path d="M10 20v-5h4v5"/></svg>',
  access: 'limited',
  start,
  mount,
  settings,
  css: `
    .d .manage-company .employees .employee-list-title>li.occ-paid{width:30px}
    .d .manage-company .employees .employee-list .occ-paid{width:30px;padding:0 5px;margin-top:-1px;position:relative;float:left;height:30px;line-height:33px;border-left:1px solid var(--default-panel-divider-inner-side-color);border-right:1px solid var(--default-panel-divider-outer-side-color)}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v{width:100%;height:24px;display:flex;align-items:center;justify-content:center;margin-top:4px;padding:0;line-height:1;text-align:center;cursor:default;box-sizing:border-box;font-variant-numeric:tabular-nums}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v.daily{color:var(--default-green-color,#82c91e);font-weight:bold}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v.neg{color:var(--default-red-color,#E54C19);font-weight:bold}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v.stale{opacity:.55}
    .occ-paid-on .d .manage-company .paid-trains{display:none!important}
    .occ-paid-on .d .manage-company .company-tabs>li a{width:194.5px!important}
    .occ-paid-on .d .company-wrap .company-stats-list>li{width:273.33px!important}
    #occ-root .occ-pd-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--occ-div-dark);box-shadow:inset 0 1px 0 var(--occ-div-light);min-width:0;flex-wrap:wrap}
    #occ-root .occ-pd-txt{flex:1 1 160px;min-width:0;overflow-wrap:anywhere}
    #occ-root .occ-pd-ctl{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px}
    #occ-root .occ-pd-row .occ-pd-ctl{margin-top:0}
    #occ-root .occ-pd-ctl>.occ-muted{margin-right:auto}
    #occ-root .occ-pd-b{height:22px;padding:0 8px;border-radius:4px;border:var(--occ-btn-border);background:var(--occ-btn-bg);color:var(--occ-btn-fg);text-shadow:var(--occ-btn-shadow);font:bold 11px/1 Arial,Helvetica,sans-serif;white-space:nowrap}
    #occ-root .occ-pd-b:hover{background:var(--occ-btn-hover-bg);color:var(--occ-btn-hover-fg)}
    #occ-root .occ-pd-b:active{background:var(--occ-btn-active-bg)}
    #occ-root .occ-pd-b:disabled{opacity:.5;cursor:default}
    #occ-root .occ-pd-b.go{color:var(--occ-good)}
    #occ-root .occ-pd-in{display:inline-block;width:110px;height:24px;margin:0}
    #occ-root .occ-pd-b.shut{margin-left:auto}
    #occ-root .occ-pd-price{color:var(--occ-accent);font:inherit;text-decoration:underline dotted}
    #occ-root .occ-pd-price:hover{color:var(--occ-accent-hi)}
    #occ-root .occ-pd-emp .occ-car{display:inline-block;width:12px;font-size:8px;color:var(--occ-muted)}
    #occ-root .occ-pd-n{min-width:22px;text-align:center;font:bold 12px/1 Arial,Helvetica,sans-serif;font-variant-numeric:tabular-nums;color:var(--occ-hi)}
    #occ-root .occ-pd-emp{cursor:pointer}
    #occ-root .occ-pd-emp:hover td:first-child{text-decoration:underline}
    #occ-root .occ-pd-emp.gone td{opacity:.6}
    #occ-root .occ-pd-more td{white-space:normal}
    #occ-root .occ-pd-neg{color:var(--occ-bad);font-weight:bold}
    #occ-root .occ-pd-pos{color:var(--occ-hi)}
    #occ-root .occ-pd-d{color:var(--occ-good);font-weight:bold}
  `,
};
})();

// ---- plug-in: Torn Maol Tracker/plugin.js
const PLUGIN_2 = (function () {
// M'aol tracker as an occ-kit plug-in. Builds into the standalone Greasy Fork script
// (torn-maol-tracker.user.js, see occ.build.json) and is bundled into the Command Center, where it
// also gets a tab, a badge, Setup fields and AI tips (Command Center only: the standalone has no AI).
// The kit supplies key storage (Tampermonkey storage instead of torn.com localStorage).

const POLL_S = 15;               // you + live NPCs: at most 7 calls, 28 of Torn's 100 calls/min per key
const IDLE_POLL_S = 600;          // dead NPCs, or M'aol alone while everything sleeps: every 10 min
const PERKS_S = 6 * 3600;
const RATE_WINDOW_S = 15 * 60;   // HP samples kept
const ETA_WINDOW_S = 5 * 60;     // kill rate from the last 5 min: damage speeds up as guards fall
const SHIELD_PCT = 0.05;         // below 5% HP M'aol's shield slows the kill too much to extrapolate
const HOP_S = 15 * 60;           // M'aol moves on every quarter hour (:00 :15 :30 :45 TCT)
const RESUMMON_S = 48 * 3600;    // next summon about 48h after M'aol's kill (chain-race's estimate)
const FEED = 'https://live.chain-race.workers.dev/npc.json';   // public M'aol feed by LDP: defeat times, next summon
const FEED_LIVE_S = 120;         // feed check while deaths are missing during the event

const K = { key: 'tmt.apikey', state: 'tmt.state', ui: 'tmt.ui' };
const PDA_KEY_PLACEHOLDER = '###' + 'PDA-APIKEY' + '###';
const PDA_KEY = '###PDA-APIKEY###';
const IS_PDA = PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER;

const MAOL = { id: 23, name: "M'aol" };
const GUARDS = [
  { id: 100, name: "Dyno'salam" },
  { id: 101, name: "Nol'dasaym" },
  { id: 102, name: "Asmol'yand" },
  { id: 103, name: "Sylo'nadam" },
  { id: 104, name: "Ladso'myna" },
];

// Standard one-way minutes, wiki.torn.com/wiki/Travel. Airstrip x0.7, WLT x0.5,
// Business Class x0.3, travel book a further x0.75. Flights vary about 3%.
const FLIGHT = {
  'Mexico': 24, 'Cayman Islands': 33, 'Canada': 39, 'Hawaii': 127, 'United Kingdom': 151,
  'Argentina': 158, 'Switzerland': 166, 'Japan': 213, 'China': 229, 'UAE': 257, 'South Africa': 281,
};
const ALIAS = { 'United Arab Emirates': 'UAE', 'Cayman': 'Cayman Islands', 'UK': 'United Kingdom' };
// Hospital and jail abroad read "In a Mexican hospital for ..."
const DEMONYM = {
  Mexican: 'Mexico', Caymanian: 'Cayman Islands', Canadian: 'Canada', Hawaiian: 'Hawaii', British: 'United Kingdom',
  Argentinian: 'Argentina', Swiss: 'Switzerland', Japanese: 'Japan', Chinese: 'China', Emirati: 'UAE', 'South African': 'South Africa',
};
const SHORT = { 'Cayman Islands': 'Cayman', 'United Kingdom': 'UK', 'South Africa': 'S. Africa' };
const METHOD = { standard: 1, airstrip: 0.7, wlt: 0.5, business: 0.3 };
const METHOD_NAME = { standard: 'Standard', airstrip: 'Airstrip', wlt: 'WLT jet', business: 'Business ticket' };

// ------------------------------------------------------------- storage
function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
}

// samples: { id: [[t, hp], ...] }, deaths: { id: { t, country } }, hops: [[t, country], ...] (M'aol's moves),
// polled: { id: t }, perks: {...}, snap: last snapshot, nextSummon: feed's estimate, summonAt: when we saw the summon
let ST = Object.assign({ samples: {}, deaths: {}, hops: [], polled: {}, perks: null, perksAt: 0, feedAt: 0, nextSummon: 0, summonAt: 0 }, load(K.state, {}));
let UI = Object.assign({ open: true, biz: false, ai: true, keys: false }, load(K.ui, {}));
const saveState = () => store(K.state, ST);
const saveUi = () => store(K.ui, UI);
let kit = null;
// Inside the Command Center its Torn key is used when no own key was saved, so it is entered once.
const apiKey = () => (IS_PDA ? PDA_KEY : (kit.keys.get(K.key) || (kit.host === 'occ' ? kit.tornKey() : '')));

const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMin = (m) => {
  if (!isFinite(m)) return '–';
  m = Math.max(0, Math.round(m));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
const fmtHp = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n));
// Times show in the viewer's own clock; TCT is UTC.
const hm = (t) => { const d = new Date(t * 1000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const tzLabel = () => { const o = -new Date().getTimezoneOffset() / 60; return o ? `TCT${o > 0 ? '+' : ''}${o}` : 'TCT'; };

// ------------------------------------------------------------- Torn API
async function tornApi(path) {
  const key = apiKey();
  if (!key) throw new Error('No API key');
  // timestamp makes Torn skip its response cache, so HP is fresh on every poll
  const url = `https://api.torn.com/v2/${path}${path.includes('?') ? '&' : '?'}timestamp=${now()}&comment=MaolTracker`;
  const headers = { Authorization: `ApiKey ${key}` };
  let text;
  if (typeof window.PDA_httpGet === 'function') {
    const r = await window.PDA_httpGet(url, headers);
    text = (r && (r.responseText || r.text || r.body)) || (typeof r === 'string' ? r : '');
  } else {
    text = await (await fetch(url, { headers })).text();
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Bad API response'); }
  if (data.error) throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
  return data;
}

// Public feed, not Torn: it has no CORS headers, so it goes through the userscript manager (or PDA).
async function feedGet() {
  const url = `${FEED}?ts=${now()}`;
  let text;
  if (typeof GM_xmlhttpRequest === 'function') {
    text = await new Promise((ok, fail) => GM_xmlhttpRequest({ method: 'GET', url, timeout: 15000,
      onload: (r) => (r.status === 200 ? ok(r.responseText) : fail(new Error(r.status))), onerror: fail, ontimeout: fail }));
  } else if (typeof window.PDA_httpGet === 'function') {
    const r = await window.PDA_httpGet(url, {});
    text = (r && (r.responseText || r.text || r.body)) || (typeof r === 'string' ? r : '');
  } else {
    text = await (await fetch(url)).text();
  }
  return JSON.parse(text);
}

function countryOf(desc) {
  const m = /(?:[Ii]n|[Tt]o|[Ff]rom)\s+([A-Z][A-Za-z ]+?)\s*$/.exec(String(desc || '').trim());
  if (!m) return null;
  const c = ALIAS[m[1]] || m[1];
  return FLIGHT[c] ? c : null;
}

// ------------------------------------------------------------- travel perks
function perkMethods(perks) {
  const all = (k) => (perks?.[k] || []).join(' | ');
  return {
    airstrip: /airstrip/i.test(all('property')),
    wlt: /WLT|private jet/i.test(all('stock')),
    book: /travel time|flight time/i.test(all('book')),
  };
}
function bestMethod() {
  if (UI.biz) return 'business';
  const p = perkMethods(ST.perks);
  return p.wlt ? 'wlt' : p.airstrip ? 'airstrip' : 'standard';
}
function flightMin(country, method) {
  const base = FLIGHT[country];
  if (!base) return Infinity;
  const book = perkMethods(ST.perks).book ? 0.75 : 1;
  return base * METHOD[method] * book;
}
// You can only fly Torn <-> abroad, so going from one country to another means flying home first.
function tripMin(me, country, method) {
  const wait = me.busyUntil ? Math.max(0, (me.busyUntil - now()) / 60) : 0;
  if (me.where === country) return wait;
  let t = flightMin(country, method);
  if (me.where && me.where !== 'Torn') t += flightMin(me.where, method);
  return t + wait;
}

// ------------------------------------------------------------- data
let D = ST.snap || null;   // last snapshot: shown straight away, kept on screen when a refresh fails
let err = '';

// Minutes until the NPC falls, from the HP lost over the last 5 min.
// Infinity: no drop yet, or M'aol under 5% where his shield makes the pace meaningless.
function killEta(id, hp, max) {
  if (hp <= 0) return Infinity;
  if (id === MAOL.id && max && hp / max < SHIELD_PCT) return Infinity;
  const s = (ST.samples[id] || []).filter(([t]) => now() - t <= ETA_WINDOW_S);
  if (s.length < 2) return Infinity;
  const [t0, h0] = s[0];
  const [t1, h1] = s[s.length - 1];
  const perMin = (h0 - h1) / Math.max(1, (t1 - t0) / 60);
  return perMin > 0 ? hp / perMin : Infinity;
}
const shielded = (n) => n.id === MAOL.id && n.hp > 0 && n.max && n.hp / n.max < SHIELD_PCT;

// Dead NPCs don't change while the event runs, so they're only re-checked every 10 min. While everything
// sleeps in Halloween week, only M'aol is checked (1 call per 10 min) to catch a new summon.
function due(n, t) {
  if (!D) return true;
  if (!anyAwake(D)) return n.id === MAOL.id && t - (ST.polled[n.id] || 0) >= IDLE_POLL_S;
  const prev = [D.maol, ...D.guards].find((x) => x.id === n.id);
  if (!prev || prev.hp > 0 || prev.state !== 'Dormant') return true;
  return t - (ST.polled[n.id] || 0) >= IDLE_POLL_S;
}

function parseNpc(base, r) {
  const p = r.profile || {};
  return {
    ...base,
    state: /^dormant/i.test(p.status?.description || '') ? 'Dormant' : 'Awoken',
    desc: p.status?.description || '',
    country: countryOf(p.status?.description),
    hp: p.life?.current ?? 0,
    max: p.life?.maximum ?? 0,
  };
}

// Summons are only possible in Halloween week (26 Oct 10:00 – 31 Oct 23:59 TCT). Outside it, and with
// nothing awake in the last snapshot, the script sleeps: no API calls at all.
function inSummonWindow(t) {
  const d = new Date(t * 1000);
  const y = d.getUTCFullYear();
  return t >= Date.UTC(y, 9, 26, 10) / 1000 && t < Date.UTC(y, 10, 1) / 1000;
}
const anyAwake = (snap) => !!snap && [snap.maol, ...snap.guards].some((n) => n.state === 'Awoken');
const sleeping = () => !inSummonWindow(now()) && !anyAwake(D);

let inFlight = false;   // a slow API must not stack refreshes (the timer ticks every 5 s)
async function refresh(force) {
  if (inFlight) return;
  inFlight = true;
  try { await poll(force); } finally { inFlight = false; }
  aiTick();
}
async function poll(force) {
  if (!apiKey() || sleeping()) { render(); return; }
  // Several Torn tabs share one snapshot: only the first tab due polls the API.
  const fresh = load(K.state, {});
  const dormant = fresh.snap && fresh.snap.maol.state === 'Dormant' && fresh.snap.guards.every((g) => g.state === 'Dormant');
  if (!force && fresh.snap && now() - fresh.snap.t < (dormant ? IDLE_POLL_S : POLL_S) - 2) {
    ST = Object.assign(ST, fresh);
    D = fresh.snap;
    render();
    return;
  }
  const t = now();
  const all = [MAOL, ...GUARDS];
  const ask = all.filter((n) => due(n, t));
  if (!ask.length) { render(); return; }
  const quiet = D && !anyAwake(D);
  // allSettled: one failed call keeps the last known value instead of failing the whole refresh.
  const res = await Promise.allSettled([
    quiet ? Promise.resolve(null) : tornApi('user/basic'),
    ...ask.map((n) => tornApi(`user/${n.id}/profile`)),
    !quiet && (!ST.perks || t - ST.perksAt > PERKS_S) ? tornApi('user/perks') : Promise.resolve(null),
  ]);
  const failed = res.filter((r) => r.status === 'rejected');
  if (failed.length === res.length) {
    const msg = failed[0].reason?.message || String(failed[0].reason);
    err = /^Torn API error|^No API key/.test(msg) ? msg : "Can't reach the Torn API, retrying";
    render();
    return;
  }
  const perksRes = res[res.length - 1];
  if (perksRes.status === 'fulfilled' && perksRes.value) { ST.perks = perksRes.value.perks || null; ST.perksAt = t; }

  const list = all.map((base) => {
    const i = ask.indexOf(base);
    const r = i >= 0 ? res[i + 1] : null;
    if (r && r.status === 'fulfilled') { ST.polled[base.id] = t; return parseNpc(base, r.value); }
    return D && [D.maol, ...D.guards].find((x) => x.id === base.id);
  });
  if (list.some((n) => !n)) {   // nothing to fall back on yet
    err = failed[0]?.reason?.message || 'Incomplete API response';
    render();
    return;
  }
  list.forEach((n) => {
    const asked = ask.some((a) => a.id === n.id);
    const arr = (ST.samples[n.id] || []).filter(([ts]) => t - ts <= RATE_WINDOW_S);
    const prev = arr[arr.length - 1];
    if (prev && prev[1] > 0 && n.hp <= 0 && !ST.deaths[n.id]) ST.deaths[n.id] = { t, country: n.country };
    if (n.hp > 0 && ST.deaths[n.id] && n.state === 'Awoken') delete ST.deaths[n.id]; // new summon
    if (asked) { arr.push([t, n.hp]); ST.samples[n.id] = arr; }
  });
  // M'aol's moves: every country change is one hop. They teach the loop order when deaths were missed.
  const m = list[0];
  if (quiet && m.state === 'Awoken' && ask.some((a) => a.id === MAOL.id)) { ST.polled = {}; ST.summonAt = t; ST.nextSummon = 0; }   // new summon: check everyone on the next refresh
  if (m.state === 'Awoken' && !m.country) ST.hops = [];   // summoned, not moving yet
  const last = ST.hops[ST.hops.length - 1];
  if (m.state === 'Awoken' && m.country && (!last || last[1] !== m.country)) ST.hops = [...ST.hops, [t, m.country]].slice(-40);

  let me = D?.me || { state: 'Okay', desc: '', where: 'Torn', busyUntil: 0, landing: 0 };
  if (res[0].status === 'fulfilled' && res[0].value) {
    const st = res[0].value.profile?.status || {};
    const tr = st.state === 'Traveling' ? await tornApi('user/travel').then((x) => x.travel || {}, () => ({})) : {};
    me = { state: st.state, desc: st.description || '', where: 'Torn', busyUntil: 0, landing: 0 };
    if (st.state === 'Abroad') me.where = countryOf(st.description);
    if (st.state === 'Traveling') {
      me.where = tr.destination === 'Torn' ? 'Torn' : tr.destination;
      me.busyUntil = tr.arrival_at || 0;
      me.landing = tr.arrival_at || 0;
    }
    if ((st.state === 'Hospital' || st.state === 'Jail') && st.until) {
      me.busyUntil = st.until;
      const adj = /^In an? (\w+(?: \w+)?) (?:hospital|jail)/i.exec(st.description || '');
      if (adj && DEMONYM[adj[1]]) me.where = DEMONYM[adj[1]];
    }
  }
  D = { t, maol: m, guards: list.slice(1), me };
  ST.snap = D;
  err = failed.length ? 'Some API calls failed, retrying' : '';
  await syncFeed(t);
  saveState();
  render();
}

// The chain-race feed fills what this tab didn't see: guard deaths before you opened Torn (so M'aol's
// loop is exact straight away) and M'aol's kill time (for the next-summon countdown).
// Only asked when something is missing: every 2 min while deaths are missing, every 10 min while dormant.
async function syncFeed(t) {
  const missing = D.guards.some((g) => g.hp <= 0 && !ST.deaths[g.id]) && anyAwake(D);
  const noSummonTime = !anyAwake(D) && !nextSummonAt();
  if (!missing && !noSummonTime) return;
  if (t - ST.feedAt < (missing ? FEED_LIVE_S : IDLE_POLL_S)) return;
  ST.feedAt = t;
  let f;
  try { f = await feedGet(); } catch (e) { return; }   // the feed is optional: no data, no change
  if (!anyAwake(D) && f?.next_summon?.t > t - RESUMMON_S) ST.nextSummon = f.next_summon.t;
  const ids = Object.fromEntries(GUARDS.map((g) => [g.name, g.id]));
  for (const s of f?.route?.stops || []) {
    const id = ids[s.npc];
    const g = D.guards.find((x) => x.id === id);
    // Only this summon's deaths: the guard is dead now, in the same country, and fell after the summon.
    if (!g || g.hp > 0 || ST.deaths[id] || s.where !== g.country || !(s.defeated > 0)) continue;
    if (s.defeated < (ST.summonAt || t - 7 * 86400) - 60 || s.defeated > t + 60) continue;
    ST.deaths[id] = { t: s.defeated, country: s.where };
  }
}

// Next summon: ~48h after M'aol's kill, from our own sighting or else the feed. 0 when unknown,
// or once it's 6h overdue (a summon needs a player to start it, so it can come late).
function nextSummonAt() {
  const own = ST.deaths[MAOL.id] ? ST.deaths[MAOL.id].t + RESUMMON_S : 0;
  const ns = own || ST.nextSummon || 0;
  return ns > now() - 6 * 3600 ? ns : 0;
}

// ------------------------------------------------------------- M'aol's route
// He loops through the dead guards' countries in the order they died, one stop per quarter hour,
// with no flight in between. A guard that dies later joins the end of the loop. He starts looping
// while the bond still holds (seen 2026: moving with 2 guards alive).

// Loop order learnt from his own moves: two moves ~15 min apart are neighbours on the loop.
function hopNext() {
  const next = {};
  for (let i = 1; i < ST.hops.length; i++) {
    const [ta, a] = ST.hops[i - 1];
    const [tb, b] = ST.hops[i];
    if (tb - ta >= 10 * 60 && tb - ta <= 20 * 60) next[a] = b;
  }
  return next;
}

// Dead guards' countries in death order. exact: every death was seen, or his moves filled the gaps.
function deathOrder(guards) {
  const dead = guards.filter((g) => g.hp <= 0 && g.country);
  const seen = dead.filter((g) => ST.deaths[g.id]).sort((a, b) => ST.deaths[a.id].t - ST.deaths[b.id].t);
  if (seen.length === dead.length) return { loop: seen.map((g) => ST.deaths[g.id].country || g.country), exact: true };
  const want = new Set(dead.map((g) => g.country));
  const next = hopNext();
  const start = dead[0].country;
  const cycle = [start];
  for (let c = next[start]; c && c !== start && cycle.length <= want.size; c = next[c]) cycle.push(c);
  if (next[cycle[cycle.length - 1]] === start && cycle.length === want.size && cycle.every((c) => want.has(c))) {
    // Rotate so the latest death he was seen dying is last: new deaths go after it.
    const lastSeen = seen.length ? seen[seen.length - 1].country : null;
    const k = lastSeen ? cycle.indexOf(lastSeen) : cycle.length - 1;
    return { loop: [...cycle.slice(k + 1), ...cycle.slice(0, k + 1)], exact: !!lastSeen };
  }
  const unseen = dead.filter((g) => !ST.deaths[g.id]).map((g) => g.country);
  return { loop: [...unseen, ...seen.map((g) => g.country)], exact: false, unknown: unseen };
}

// Where M'aol is now and his next stops, each with its arrival time.
function plan(D) {
  const { maol, guards } = D;
  const t = now();
  const order = deathOrder(guards);
  const alive = guards.filter((g) => g.hp > 0 && g.state === 'Awoken');
  const pend = alive.map((g) => { const e = killEta(g.id, g.hp, g.max); return { g, at: isFinite(e) ? t + e * 60 : Infinity }; })
    .sort((a, b) => (a.at - b.at) || (a.g.hp / a.g.max - b.g.hp / b.g.max));
  const bondAt = !alive.length ? 0 : Math.max(...pend.map((p) => p.at));
  const loopAt = (T) => [...order.loop, ...pend.filter((p) => p.at <= T).map((p) => p.g.country)];
  const meta = { order, pend, bondAt, stops: [] };
  if (maol.state !== 'Awoken' || !maol.country) return meta;
  const seen = order.exact ? {} : hopNext();   // order partly guessed: his own moves win
  let c = maol.country;
  let T = Math.floor(t / HOP_S) * HOP_S + HOP_S;
  meta.leaves = T;
  // Enough stops to cover the bond break plus one more loop, so stay-or-fly can look past it.
  const until = (isFinite(bondAt) ? Math.max(bondAt, t) : t) + 6 * HOP_S;
  for (let k = 0; k < 40 && T <= until; k++, T += HOP_S) {
    const L = loopAt(T);
    const i = L.indexOf(c);
    if (i < 0 || L.length < 2) break;
    c = seen[c] && L.includes(seen[c]) ? seen[c] : L[(i + 1) % L.length];
    meta.stops.push({ c, at: T });
  }
  return meta;
}

// ------------------------------------------------------------- what to do next
function advice() {
  if (!D) return [];
  const { maol, guards, me } = D;
  const method = bestMethod();
  const tips = [];
  const t = now();
  const alive = guards.filter((g) => g.state === 'Awoken' && g.hp > 0);
  const busy = me.busyUntil > t;

  if (busy) {
    const what = me.state === 'Traveling' ? `Landing in ${me.where} at ${hm(me.busyUntil)}` : `${me.state} until ${hm(me.busyUntil)}`;
    tips.push({ c: 'info', t: `${what}. Times below already count that wait.` });
  }

  if (maol.state === 'Dormant' && !alive.length) {
    const ns = nextSummonAt();
    const left = ns ? (ns - t) / 60 : 0;
    tips.push({ c: 'info', t: !ns || !inSummonWindow(ns) ? "M'aol and his Praetorians are dormant. Nothing to fight right now."
      : left > 0 ? `All dormant. Next summon ~${hm(ns)} (in ${fmtMin(left)}).` : 'All dormant. Next summon any time now.' });
    return tips;
  }

  if (alive.length) {
    const here = alive.find((g) => g.country === me.where);
    if (here && !busy) {
      tips.push({ c: 'go', t: `${here.name} is in ${here.country} with you. Hit now.`, href: `https://www.torn.com/loader.php?sid=attack&user2ID=${here.id}` });
    }
    const scored = alive.map((g) => {
      const trip = tripMin(me, g.country, method);
      const eta = killEta(g.id, g.hp, g.max);
      return { g, trip, eta, ok: trip + 3 < eta };
    }).sort((a, b) => a.trip - b.trip);
    const pick = scored.find((s) => s.ok && s.g !== here);
    if (pick) {
      tips.push({ c: 'go', t: `Fly to ${pick.g.country} (${METHOD_NAME[method]}, ${fmtMin(pick.trip)}). ${pick.g.name} has ${fmtHp(pick.g.hp)} HP` + (isFinite(pick.eta) ? `, ~${fmtMin(pick.eta)} left at current pace.` : ', barely touched.'), href: 'https://www.torn.com/page.php?sid=travel' });
    }
    scored.filter((s) => !s.ok).forEach((s) => {
      tips.push({ c: 'warn', t: `Skip ${s.g.name} in ${s.g.country}: dies in ~${fmtMin(s.eta)}, you need ${fmtMin(s.trip)}.` });
    });
  }

  const P = plan(D);
  if (P.order.unknown && P.order.unknown.length > 1) {
    tips.push({ c: 'warn', t: `Missed ${P.order.unknown.length} guard deaths, so his order is partly a guess until he's been watched for one loop. tornstats.com/maol has it now.`, href: 'https://www.tornstats.com/maol' });
  }

  if (maol.state === 'Awoken' && maol.hp > 0) {
    const bonded = alive.length > 0;
    if (!bonded && maol.country === me.where && !busy) {
      tips.push({ c: 'go', t: `Hit M'aol now. He's here in ${me.where} until ${hm(P.leaves)}.`, href: `https://www.torn.com/loader.php?sid=attack&user2ID=${MAOL.id}` });
    } else if (maol.country && isFinite(P.bondAt)) {
      tips.push(stayOrFly(P, maol, me, method, bonded));
    }
    if (bonded) {
      tips.push({ c: 'info', t: `Bond: M'aol can't be attacked until all 5 guards are dead (${5 - alive.length}/5 down` + (isFinite(P.bondAt) ? `, last one ~${hm(P.bondAt)}).` : ').') });
    }
    if (maol.country) {
      const you = (c) => (c === me.where ? '<i>you</i>' : '');
      const rows = [`<span>now</span><b>${esc(maol.country)}</b><em>until ${hm(P.leaves)}</em>${you(maol.country)}`,
        ...P.stops.slice(0, 5).map((s) => `<span>${hm(s.at)}</span><b>${esc(s.c)}</b><em></em>${you(s.c)}`)];
      tips.push({ c: 'route', h: `<div class="tmt-rt">M'aol's route <small>one stop every 15 min, no flight time</small></div>` +
        rows.map((r, i) => `<div class="tmt-stop${i ? '' : ' now'}">${r}</div>`).join('') });
    } else if (P.order.loop.length) {
      tips.push({ c: 'info', t: `M'aol hasn't started moving yet. He'll loop through ${P.order.loop.join(' → ')}${alive.length ? ', plus each guard\'s country as it dies' : ''}.` });
    }
  }

  tips.push({ c: 'note', t: "Loot: every turn you land damage is 1 lottery ticket, however small the hit. Tickets count until the kill, so keep hitting. Every guard drops the same 1,101 items, so a less crowded fight means better odds." });
  tips.push({ c: 'note', t: 'Healing: bring medical items (first aid kits, blood bags, morphine) so a loss doesn\'t keep you in hospital and you can keep hitting.' });
  return tips;
}

// Stay where you are or fly: the first stop you can reach while he's still there (and alive).
// Only a stop that leaves at least MIN_HIT_S of hitting counts. While bonded the break time is an
// estimate, so it gets a margin (a quarter of the time left, at least 3 min), a break more than
// an hour out gets no flight plan at all, and "fly now" only shows when leaving later would miss
// the window: otherwise the tip says when to leave, so nobody lands early to a boss that can't be hit.
const MIN_HIT_S = 3 * 60;
function stayOrFly(P, maol, me, method, bonded) {
  const t = now();
  const eta = killEta(MAOL.id, maol.hp, maol.max);
  const deathAt = bonded || !isFinite(eta) ? Infinity : t + eta * 60;
  const left = Math.max(0, P.bondAt - t);
  if (bonded && left > 60 * 60) {
    return { c: 'info', t: `Bond holds until ~${hm(P.bondAt)}. Too early to fly to M'aol, he can't be hit before then.` };
  }
  const opens = bonded ? P.bondAt + Math.max(3 * 60, left / 4) : t;
  const windows = [{ c: maol.country, from: t, to: P.leaves }, ...P.stops.map((s) => ({ c: s.c, from: s.at, to: s.at + HOP_S }))];
  const fits = windows.map((w) => {
    const arrive = t + tripMin(me, w.c, method) * 60 + 60;
    const start = Math.max(w.from, arrive, opens);
    return { ...w, arrive, start, ok: start <= Math.min(w.to, deathAt) - MIN_HIT_S };
  }).filter((w) => w.ok);
  const lowHp = shielded(maol) ? ' He is under 5% and his shield slows the kill, so the end time is uncertain.' : '';
  if (!fits.length) {
    return { c: 'warn', t: (isFinite(deathAt) ? `At this pace he dies ~${hm(deathAt)}, before you can reach any stop. ` : "You can't reach any of his next stops in time. ") + 'Stay put.' + lowHp };
  }
  // Earliest hit wins, but a stop only 15 min later with a shorter trip (or no trip) is the better deal.
  const first = Math.min(...fits.map((w) => w.start));
  const best = fits.filter((w) => w.start <= first + HOP_S)
    .sort((a, b) => ((b.c === me.where) - (a.c === me.where)) || (a.arrive - b.arrive) || (a.start - b.start))[0];
  const win = `${hm(best.from)}–${hm(best.to)}`;
  if (best.c === me.where && me.where !== 'Torn') {
    return { c: 'go', t: (best.from > t ? `Stay in ${best.c}. M'aol arrives ${hm(best.from)} (in ${fmtMin((best.from - t) / 60)}) and leaves ${hm(best.to)}.` : `Stay in ${best.c}. M'aol is here until ${hm(best.to)}.`) + (bonded ? ' Only once the bond breaks.' : '') + lowHp };
  }
  const home = me.where && me.where !== 'Torn' && fits.some((w) => w.c === me.where) ? ` Or stay: he's back in ${me.where} ${hm(fits.find((w) => w.c === me.where).from)}.` : '';
  const trip = tripMin(me, best.c, method);
  const flyAt = best.start - trip * 60 - 60;
  if (bonded && flyAt - t > 2 * 60) {
    return { c: 'info', t: `Don't fly yet: M'aol can't be hit until the bond breaks (~${hm(P.bondAt)}). Leave for ${best.c} at ${hm(flyAt)} (${METHOD_NAME[method]}, ${fmtMin(trip)}), he's there ${win}.` + home + lowHp };
  }
  return { c: 'go', t: `Fly to ${best.c} now (${METHOD_NAME[method]}, ${fmtMin(tripMin(me, best.c, method))}). M'aol is there ${win}.` + (bonded ? ' First stop after the bond breaks.' : '') + home + lowHp, href: 'https://www.torn.com/page.php?sid=travel' };
}

// ------------------------------------------------------------- AI tips
// The numbers stay the script's own maths. A free model only picks and words the "Next" tips from
// them. Built-in tips show while it thinks or when no AI is set up, and stay when a reply looks
// wrong (bad JSON, a clock time that isn't in the facts). Asked only while the event runs, again
// only when the situation changes, at most once per 2 min across all Torn tabs.
const AI_GAP_S = 120;
const AI_STALE_S = 10 * 60;   // times drift: ask again after 10 min even when nothing changed
const AI_WAIT_S = 90;         // another tab's ask older than this is treated as lost
const AI_SYSTEM = [
  "You advise a Torn City player during the M'aol Halloween event, inside a small userscript panel.",
  'The user message is JSON facts the script computed from the Torn API. They are exact; you must not change them.',
  'Reply with ONLY a JSON array of 1 to 4 tips, most urgent first:',
  '[{"kind":"go","text":"...","link":"none"}]',
  'kind: "go" = do this now, "warn" = skip or avoid something, "info" = useful context.',
  'link: "attack:<id>" (only an NPC with attackable true), "travel" (when the tip says to fly), or "none".',
  'Rules: use only the facts given, never invent numbers, names, countries or times. Copy clock times exactly as',
  'written (HH:MM). Durations only as given in minutes. Plain English, no markdown, each text under 160 characters.',
  'The "calculated" list is the script\'s own advice: keep its decisions, you may merge, reorder or reword them and add',
  'one tactical point the facts support. Never suggest scripts, automation, or anything against Torn rules.',
  'While maol.bonded is true M\'aol cannot be hit: never tell the player to fly to him now. Repeat only a leave time',
  'the calculated list gives, and never suggest a flight the calculated list does not.',
].join('\n');

let aiBusy = false;
const aiOn = () => !!kit && kit.host === 'occ' && UI.ai !== false && kit.ai.ready() && anyAwake(D);

// What changes the advice: where everyone is, who is alive, the bond, and the script's own decisions.
function aiSig() {
  const alive = D.guards.filter((g) => g.state === 'Awoken' && g.hp > 0).map((g) => g.id);
  const calc = advice().filter((x) => x.c === 'go' || x.c === 'warn').map((x) => x.c + x.t.split(' ').slice(0, 3).join(' '));
  return JSON.stringify([D.maol.state, D.maol.country, D.maol.hp > 0, alive, D.me.where, D.me.state, bestMethod(), calc]);
}

function aiFacts() {
  const { maol, guards, me } = D;
  const method = bestMethod();
  const P = plan(D);
  const t = now();
  const alive = guards.filter((g) => g.state === 'Awoken' && g.hp > 0);
  const min = (m) => (isFinite(m) ? Math.round(m) : null);
  const pct = (n) => (n.max ? Math.round((n.hp / n.max) * 100) : null);
  return {
    now: hm(t),
    times_in: tzLabel(),
    you: { where: me.where || me.desc, state: me.state, busy_until: me.busyUntil > t ? hm(me.busyUntil) : null, travel: METHOD_NAME[method], travel_book: perkMethods(ST.perks).book },
    guards: guards.map((g) => {
      const dead = g.hp <= 0;
      const eta = killEta(g.id, g.hp, g.max);
      const trip = dead ? Infinity : tripMin(me, g.country, method);
      return { id: g.id, name: g.name, country: g.country, dead, down_at: dead && ST.deaths[g.id] ? hm(ST.deaths[g.id].t) : null,
        hp_pct: dead ? 0 : pct(g), dies_in_min: dead ? null : min(eta), trip_min: min(trip), attackable: !dead && g.state === 'Awoken',
        reach_before_death: !dead && trip + 3 < eta };
    }),
    maol: { id: MAOL.id, name: MAOL.name, state: maol.state, country: maol.country, hp_pct: pct(maol), bonded: alive.length > 0,
      attackable: maol.state === 'Awoken' && maol.hp > 0 && !alive.length, leaves_at: P.leaves ? hm(P.leaves) : null,
      dies_in_min: alive.length ? null : min(killEta(MAOL.id, maol.hp, maol.max)), shield_under_5pct: shielded(maol),
      next_stops: P.stops.slice(0, 6).map((s) => ({ at: hm(s.at), country: s.c, trip_min: min(tripMin(me, s.c, method)) })) },
    bond_breaks_at: alive.length && isFinite(P.bondAt) ? hm(P.bondAt) : null,
    calculated: advice().filter((x) => x.t && x.c !== 'note').map((x) => ({ kind: x.c, text: x.t })),
  };
}

// The model's reply, checked. null: not usable, the built-in tips stay.
function aiParse(text, facts) {
  const m = /\[[\s\S]*\]/.exec(String(text || ''));
  if (!m) return null;
  let arr;
  try { arr = JSON.parse(m[0]); } catch (e) { return null; }
  if (!Array.isArray(arr) || !arr.length) return null;
  const times = new Set(JSON.stringify(facts).match(/\d{2}:\d{2}/g) || []);
  const ids = new Set(facts.guards.filter((g) => g.attackable).map((g) => g.id));
  if (facts.maol.attackable) ids.add(MAOL.id);
  const out = [];
  for (const x of arr.slice(0, 4)) {
    const kind = ['go', 'warn', 'info'].includes(x && x.kind) ? x.kind : '';
    const t = String((x && x.text) || '').replace(/\s+/g, ' ').trim();
    if (!kind || !t || t.length > 240) return null;
    if ((t.match(/\b\d{1,2}:\d{2}\b/g) || []).some((h) => !times.has(h.padStart(5, '0')))) return null;
    const a = /^attack:(\d+)$/.exec(String(x.link || ''));
    const href = a && ids.has(+a[1]) ? `https://www.torn.com/loader.php?sid=attack&user2ID=${a[1]}`
      : x.link === 'travel' ? 'https://www.torn.com/page.php?sid=travel' : '';
    out.push(href ? { c: kind, t, href } : { c: kind, t });
  }
  return out;
}

// Current AI tips, or null when there are none for the situation on screen.
function aiTips() {
  const a = ST.ai;
  if (!aiOn() || !a || !a.tips || now() - a.at > AI_STALE_S + AI_GAP_S) return null;
  return a.sig === aiSig() ? a.tips : null;
}

async function aiTick() {
  if (aiBusy || !D || !aiOn()) return;
  const fresh = load(K.state, {});
  if (fresh.ai) ST.ai = fresh.ai;
  ST.aiAsk = fresh.aiAsk || 0;
  const t = now();
  const sig = aiSig();
  const cur = ST.ai;
  if (cur && cur.tips && cur.sig === sig && t - cur.at < AI_STALE_S) return;
  if (cur && t - cur.at < AI_GAP_S) return;
  if (t - ST.aiAsk < AI_WAIT_S) return;
  aiBusy = true;
  ST.aiAsk = t;
  saveState();
  const facts = aiFacts();
  try {
    const r = await kit.ai.write({ system: AI_SYSTEM, user: JSON.stringify(facts) });
    ST.ai = { sig, at: now(), tips: aiParse(r.text, facts), model: String(r.model || '').split('/').pop().replace(/:free$/, '') };
  } catch (e) {
    ST.ai = { sig, at: now(), tips: null, model: '', err: String((e && e.message) || e) };
  } finally {
    aiBusy = false;
    ST.aiAsk = 0;
    saveState();
    render();
  }
}

// ------------------------------------------------------------- UI
let root;
function bar(n) {
  const pct = n.max ? Math.max(0, Math.min(100, (n.hp / n.max) * 100)) : 0;
  const dead = n.hp <= 0;
  const eta = killEta(n.id, n.hp, n.max);
  const where = n.country || (n.id === MAOL.id ? (n.state === 'Awoken' ? 'Awoken' : 'Dormant') : '?');
  const sub = dead ? (ST.deaths[n.id] ? `down ${hm(ST.deaths[n.id].t)}` : 'down')
    : shielded(n) ? 'shield, slowing' : isFinite(eta) ? `~${fmtMin(eta)} left` : '';
  const tm = D && n.country && !dead ? tripMin(D.me, n.country, bestMethod()) : null;
  const trip = tm == null ? '' : tm < 1 && D.me.where === n.country ? 'here' : fmtMin(tm);
  return `<a class="tmt-row${dead ? ' tmt-dead' : ''}" href="https://www.torn.com/profiles.php?XID=${n.id}">
    <span class="tmt-name">${esc(n.name)}</span>
    <span class="tmt-where" title="${esc(where)}">${esc(SHORT[where] || where)}${trip ? ` · ${trip === 'here' ? 'here' : `✈ ${trip}`}` : ''}</span>
    <span class="tmt-hp"><i style="width:${pct.toFixed(1)}%"></i><b>${dead ? '0' : fmtHp(n.hp)} / ${fmtHp(n.max)}</b></span>
    <span class="tmt-sub">${esc(sub)}</span>
  </a>`;
}

// Key form (standalone, or the Command Center before its own key is set).
function keyForm() {
  return `<div class="tmt-key">Minimal access API key${apiKey() ? ' (saved, paste to replace)' : ' needed (NPCs, your status, perks, travel)'}.<br>
    <input id="tmt-key" type="password" maxlength="16" placeholder="16-character key" autocomplete="off">
    <a href="#" class="tmt-btn" data-act="save-key">Save</a>${apiKey() ? ' <a href="#" data-act="keys">cancel</a>' : ''}</div>`;
}

// The panel body, shared by the header dropdown and the Command Center tab (pane: no footer clock,
// the tab's own tool row shows it).
function bodyHtml(pane) {
  const method = bestMethod();
  const p = perkMethods(ST.perks);
  if (!apiKey() || UI.keys) return keyForm();
  if (!D) return `<div class="tmt-tip info">${sleeping() ? "M'aol sleeps until Halloween week (26 Oct). No API calls until then." : err ? esc(err) : 'Loading…'}</div>`;
  const tip = (x) => x.href
    ? `<a class="tmt-tip ${x.c}" href="${x.href}"${/tornstats/.test(x.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(x.t)}</a>`
    : `<div class="tmt-tip ${x.c}">${x.h || esc(x.t)}</div>`;
  const all = advice();
  const notes = all.filter((x) => x.c === 'note');
  const ai = aiTips();
  const next = ai ? [...ai, ...all.filter((x) => x.c === 'route')] : all.filter((x) => x.c !== 'note');
  return `
    <div class="tmt-sec">Next${ai ? ' <small title="Worded by a free AI model from the numbers below">· AI</small>' : ''}</div>${next.map(tip).join('')}
    <div class="tmt-sec">Praetorians</div>${D.guards.map(bar).join('')}
    <div class="tmt-sec">Boss</div>${bar(D.maol)}
    ${notes.length ? `<div class="tmt-sec">Tips</div>${notes.map(tip).join('')}` : ''}
    <div class="tmt-foot">
      <span>You: ${esc(D.me.where || D.me.desc)} · ${METHOD_NAME[method]}${p.book ? ' + book' : ''}</span>
      <a href="#" data-act="biz" class="${UI.biz ? 'on' : ''}">${UI.biz ? 'Using business ticket' : 'Have business ticket?'}</a>
    </div>
    ${pane ? '' : `<div class="tmt-foot"><span>${err ? `⚠ ${esc(err)} · data from ${hm(D.t)}` : `Updated ${hm(D.t)} · times in ${tzLabel()}`}</span>
      ${kit.host === 'occ' || IS_PDA ? '' : '<a href="#" data-act="keys">change key</a>'}</div>`}`;
}

// ------------------------------------------------------------- Command Center tab and badge
let pane = null;
let paneView = null;
const badgeEls = new Set();

function renderPane() {
  if (!pane || !paneView || !paneView.active) return;
  pane.innerHTML = bodyHtml(true);
  // Same look as the header dropdown: no stats tiles; its title-bar pill and footer clock go in the meta line.
  paneView.stats(null);
  paneView.meta(D ? `${esc(pill())} · ` + (err ? `⚠ ${esc(err)} · data from ${hm(D.t)}` : `Updated ${hm(D.t)} · ${tzLabel()}`) : '');
}

function renderBadges() {
  const live = !!D && anyAwake(D);
  // A fresh badge is not on the page yet when first painted; the shell drops old ones on re-mount.
  if (badgeEls.size > 8) badgeEls.forEach((b) => { if (!b.isConnected) badgeEls.delete(b); });
  badgeEls.forEach((b) => {
    b.style.display = live ? '' : 'none';
    const down = live ? D.guards.filter((g) => g.hp <= 0).length : 0;
    b.textContent = !live ? '' : down < 5 ? `M'aol ${down}/5` : `M'aol ${D.maol.max ? Math.round((D.maol.hp / D.maol.max) * 100) : 0}%`;
    b.title = live ? `M'aol: ${pill()}` : '';
  });
}

function render() {
  renderPane();
  renderBadges();
  if (!root) return;
  const body = bodyHtml(false);
  const docked = !!btnHost && btnHost.isConnected;
  root.classList.toggle('tmt-docked', docked);
  // The body is rebuilt on every 5 s refresh (and on phones on every resize, which scrolling the
  // page fires when the address bar slides): keep where the reader had scrolled to.
  const prev = root.querySelector('.tmt-body');
  const top = prev ? prev.scrollTop : 0;
  root.innerHTML = `
    <div class="tmt-head" data-act="toggle"><span>M'aol</span><span class="tmt-pill">${D ? pill() : ''}</span><span class="tmt-caret">${docked ? '✕' : UI.open ? '▾' : '▸'}</span></div>
    ${UI.open ? `<div class="tmt-body">${body}</div>` : ''}`;
  const next = root.querySelector('.tmt-body');
  if (next && top) next.scrollTop = top;
  root.style.display = docked && !UI.open ? 'none' : '';
  if (docked) {
    const b = btnHost.getBoundingClientRect();
    root.style.top = `${Math.round(b.bottom + 4)}px`;
    // Phones: full width under the header, so rows don't wrap.
    const narrow = window.innerWidth < 500;
    root.style.width = narrow ? `${window.innerWidth - 20}px` : '';
    root.style.left = narrow ? '10px' : `${Math.round(Math.max(10, Math.min(b.right - 300, window.innerWidth - 310)))}px`;
    const dot = btnHost.querySelector('.tmt-dot');
    const lvl = !D ? '' : advice().some((x) => x.c === 'go') ? 'go' : pill() === 'dormant' ? '' : 'warn';
    dot.className = `tmt-dot ${lvl}`;
    btnHost.querySelector('button').title = D ? `M'aol: ${pill()}` : "M'aol tracker";
    // Red while M'aol is summoned (awake or his guards up), Torn's own grey when dormant.
    btnHost.classList.toggle('tmt-live', !!D && (D.maol.state === 'Awoken' || D.guards.some((g) => g.state === 'Awoken')));
  }
}

// Torn styles each header item by its own class, so copy the box of a real sibling
// (the binoculars, else any other header button) instead of guessing sizes.
const BOX = ['display', 'float', 'width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'lineHeight', 'verticalAlign', 'alignItems', 'justifyContent', 'boxSizing'];
function matchNeighbour(inRow) {
  const ref = document.querySelector('ul.toolbar > li.find-extend') ||
    [...document.querySelectorAll('ul.toolbar > li')].find((li) => li !== btnHost && li.querySelector(':scope > button.top_header_button'));
  const refBtn = ref?.querySelector(':scope > button.top_header_button');
  if (!ref || !refBtn) return;
  const copy = (from, to, keys) => { const cs = getComputedStyle(from); keys.forEach((k) => { to.style[k] = cs[k]; }); };
  const btn = btnHost.querySelector('button');
  if (!inRow) {
    copy(ref, btnHost, BOX);
    btnHost.style.position = 'relative';
    copy(refBtn, btn, [...BOX, 'background', 'border', 'cursor', 'color', 'fill', 'opacity']);
  }
  const refSvg = refBtn.querySelector('svg');
  const svg = btn.querySelector('svg');
  if (refSvg && svg) {
    const r = refSvg.getBoundingClientRect();
    if (r.width && !inRow) { svg.setAttribute('width', Math.round(r.width)); svg.setAttribute('height', Math.round(r.height)); }
    const cs = getComputedStyle(refSvg);
    svg.style.fill = cs.fill;
    svg.style.filter = cs.filter;
    svg.style.verticalAlign = cs.verticalAlign;
    svg.style.display = cs.display;
  }
}

// Desktop: Torn's search row (form#searchForm, two floated boxes) is its own box, positioned
// independently of the toolbar items, so the button goes INSIDE that row, after the "User"
// box, and both boxes give up half its width. The row keeps Torn's exact size and spot.
// Phone: the row is a single magnifier button, so the button is a toolbar item left of it.
const ROW_W = 34;
function searchRow(find) {
  const form = find.querySelector('form#searchForm');
  if (!form || form.getBoundingClientRect().width < 80) return null;
  const boxes = [form.querySelector(':scope > [class*="searchWrapper"]'), form.querySelector(':scope > #search-type-wrapper')];
  return boxes.every(Boolean) ? { form, boxes } : null;
}
function place() {
  const find = document.querySelector('ul.toolbar > li.find-wrapper');
  if (!find || !btnHost) return;
  restoreRoom();
  const row = searchRow(find);
  if (row) {
    if (btnHost.parentNode !== row.form) {
      btnHost.removeAttribute('style');
      btnHost.querySelector('button').removeAttribute('style');
      row.form.appendChild(btnHost);
    }
    btnHost.classList.add('tmt-inrow');
    makeRoom(row);
    matchNeighbour(true);
  } else {
    btnHost.classList.remove('tmt-inrow');
    if (btnHost.nextElementSibling !== find) find.parentNode.insertBefore(btnHost, find);
    matchNeighbour(false);
  }
}

let shrunk = [];
function setImp(el, prop, val) {
  shrunk.push({ el, prop, val: el.style.getPropertyValue(prop), pri: el.style.getPropertyPriority(prop) });
  el.style.setProperty(prop, val, 'important');
}
function restoreRoom() {
  shrunk.reverse().forEach(({ el, prop, val, pri }) => { if (val) el.style.setProperty(prop, val, pri); else el.style.removeProperty(prop); });
  shrunk = [];
}
function makeRoom({ boxes }) {
  const h = Math.round(boxes[1].getBoundingClientRect().height) || 24;
  btnHost.style.height = `${h}px`;
  const each = ROW_W / boxes.length;
  boxes.forEach((el) => {
    const w = Math.round(el.getBoundingClientRect().width - each);
    setImp(el, 'box-sizing', 'border-box');
    setImp(el, 'width', `${w}px`);
    setImp(el, 'max-width', `${w}px`);
    setImp(el, 'min-width', '0');
    // Inner parts with their own fixed width (the input, the "User" toggler) follow the box.
    el.querySelectorAll('*').forEach((d) => {
      if (d.getBoundingClientRect().width > w) { setImp(d, 'max-width', '100%'); setImp(d, 'box-sizing', 'border-box'); }
    });
  });
}

// ------------------------------------------------------------- header button
// Torn's header toolbar: <ul class="toolbar"><li class="find-wrapper">(search)</li>...
// The button sits just left of the search magnifier and opens the panel as a dropdown.
const ICON = '<svg width="24" height="25" viewBox="3 1 18 22" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c-3.9 0-7 2.9-7 6.6 0 2 1 3.8 2.5 5-.3 1.5-1.2 2.8-2.5 3.6.9.5 2.4.4 3.6-.6.3 1.4.1 2.7-.6 3.9 1.4-.2 2.6-1.3 3.1-2.8.4.9.4 2-.1 2.9 1.2-.4 2-1.5 2.1-2.8.5.9 1.4 1.6 2.5 1.8-.6-1.1-.8-2.4-.5-3.6 1 .9 2.3 1.3 3.5 1-1.2-.8-2-2.1-2.3-3.5C19 13.4 19 11.6 19 9.6 19 5.9 15.9 3 12 3Zm-3 5.2a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Zm6 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"/></svg>';
let btnHost = null;
function mountButton() {
  if (btnHost && btnHost.isConnected) return;
  const find = document.querySelector('ul.toolbar > li.find-wrapper');
  if (!find) return;
  btnHost = document.createElement('li');
  btnHost.className = 'tmt-host';
  btnHost.innerHTML = `<button type="button" class="top_header_button button" aria-label="Open M'aol tracker">${ICON}</button><span class="tmt-dot"></span>`;
  btnHost.querySelector('button').addEventListener('click', (e) => {
    e.stopPropagation();
    UI.open = !UI.open; saveUi(); render();
  });
  place();
  render();
}

function pill() {
  const down = D.guards.filter((g) => g.hp <= 0).length;
  if (D.maol.state === 'Dormant' && down === 5) return 'dormant';
  return down < 5 ? `${down}/5 guards` : `boss ${fmtHp(D.maol.hp)}`;
}

function onClick(e) {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  e.preventDefault();
  const act = a.dataset.act;
  if (act === 'toggle') { UI.open = !UI.open; saveUi(); render(); }
  if (act === 'biz') { UI.biz = !UI.biz; saveUi(); render(); }
  if (act === 'keys') { UI.keys = !UI.keys; saveUi(); render(); }
  const box = a.closest('.tmt-ui');
  if (act === 'save-key') {
    const v = (box.querySelector('#tmt-key')?.value || '').trim();
    if (/^[A-Za-z0-9]{16}$/.test(v)) { kit.keys.set(K.key, v); UI.keys = false; saveUi(); D = null; render(); refresh(true); }
  }
}

// Command Center Setup: the switches that live in the footer of the standalone panel.
function settings(card) {
  card.appendChild(kit.el('h3', '', "M'aol tracker"));
  card.appendChild(kit.el('div', 'occ-muted', 'Uses this Command Center\'s Torn key. AI tips: a free model words the "Next" tips from the tracker\'s own numbers while the event runs, at most once per 2 min. Built-in tips show when it is off or busy.'));
  const row = kit.el('div', 'occ-bar');
  const label = () => (UI.ai !== false ? 'AI tips: on' : 'AI tips: off');
  const b = kit.ui.button(label(), () => { UI.ai = UI.ai === false; saveUi(); b.textContent = label(); render(); aiTick(); }, true);
  row.appendChild(b);
  card.appendChild(row);
}

function css() {
  if (document.getElementById('tmt-css')) return;
  const s = document.createElement('style');
  s.id = 'tmt-css';
  s.textContent = `
    .tmt-host { position: relative; }
    .tmt-host.tmt-inrow { float: left; display: flex; align-items: center; justify-content: center; width: 34px; margin: 0; padding: 0; list-style: none; }
    .tmt-host.tmt-inrow button { display: flex; align-items: center; justify-content: center; width: 34px; height: 100%; margin: 0; padding: 0; border: 0; background: none; cursor: pointer; }
    .tmt-host.tmt-inrow svg { width: 22px; height: 22px; }
    .tmt-host.tmt-inrow .tmt-dot { top: 0; right: 3px; }
    .tmt-host button:hover svg { filter: brightness(1.6) !important; }
    .tmt-host.tmt-live svg, .tmt-host.tmt-live svg path { fill: #e53935 !important; }
    .tmt-host .tmt-dot { position: absolute; top: 9px; right: 4px; width: 6px; height: 6px; border-radius: 50%; pointer-events: none; display: none;
      box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
    .tmt-host .tmt-dot.go { display: block; background: var(--default-green-color, #82c91e); }
    .tmt-host .tmt-dot.warn { display: block; background: var(--default-orange-color, #f08c00); }
    .tmt-ui { font: 12px Arial, sans-serif; color: var(--default-color, #ddd); }
    body.dark-mode #tmt { color-scheme: dark; }
    .tmt-ui :where(p, li, label, small, b, em) { color: inherit; }
    .tmt-ui .tmt-sec small { font-weight: normal; letter-spacing: 0; color: var(--default-blue-color, #74c0fc); }
    .tmt-ui .tmt-key > div + div { margin-top: 8px; }
    .tmt-pane { padding: 4px 0 6px; border-radius: 5px; background: var(--default-bg-panel-color, #333); box-shadow: 0 1px 2px rgba(0,0,0,.35); }
    #tmt.tmt-docked { bottom: auto; }
    #tmt { position: fixed; left: 10px; bottom: 10px; z-index: 99999; width: 300px; max-width: calc(100vw - 20px);
      font: 12px Arial, sans-serif; color: var(--default-color, #ddd); color-scheme: light;
      background: var(--default-bg-panel-color, #333); border-radius: 5px; box-shadow: 0 2px 12px rgba(0,0,0,.6); }
    .tmt-ui .tmt-head { display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 30px; cursor: pointer; user-select: none;
      border-radius: 5px; font-weight: bold; color: #fff; text-shadow: 0 0 2px #000;
      background: var(--title-black-gradient, linear-gradient(180deg, #555 0%, #333 100%)); }
    .tmt-ui .tmt-pill { margin-left: auto; font-weight: normal; color: var(--default-content-title-color, #bbb); }
    .tmt-ui .tmt-body { max-height: 70vh; overflow-y: auto; padding: 4px 0 6px;
      scrollbar-width: thin; scrollbar-color: var(--appheader-dropdown-list-scrollbar-thumb-color, #666) var(--appheader-dropdown-list-scrollbar-track-color, #222); }
    .tmt-ui .tmt-body::-webkit-scrollbar { width: 6px; }
    .tmt-ui .tmt-body::-webkit-scrollbar-track { background: var(--appheader-dropdown-list-scrollbar-track-color, #222); }
    .tmt-ui .tmt-body::-webkit-scrollbar-thumb { background: var(--appheader-dropdown-list-scrollbar-thumb-color, #666); border-radius: 3px; }
    .tmt-ui .tmt-sec { padding: 6px 10px 3px; font-weight: bold; color: var(--default-content-title-color, #999); text-transform: uppercase; font-size: 10px; letter-spacing: .5px; }
    .tmt-ui a { color: var(--default-blue-color, #74c0fc); text-decoration: none; }
    .tmt-ui .tmt-tip { display: block; margin: 3px 10px; padding: 5px 8px; border-radius: 4px; line-height: 1.35;
      background: var(--default-bg-panel-active-color, #444); border-left: 3px solid #888; color: var(--default-color, #ddd); }
    .tmt-ui .tmt-tip.go { border-left-color: var(--default-green-color, #82c91e); }
    .tmt-ui .tmt-tip.warn { border-left-color: var(--default-orange-color, #f08c00); }
    .tmt-ui .tmt-tip.note { background: none; border-left-color: var(--panel-border-bottom-color, #555); color: var(--default-content-title-color, #aaa); padding: 3px 8px; }
    .tmt-ui .tmt-tip.route { padding: 6px 8px 4px; }
    .tmt-ui .tmt-rt { font-weight: bold; margin-bottom: 4px; }
    .tmt-ui .tmt-rt small { font-weight: normal; color: var(--default-content-title-color, #999); font-size: 10px; margin-left: 4px; }
    .tmt-ui .tmt-stop { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto 30px; gap: 6px; align-items: baseline; padding: 1px 0; }
    .tmt-ui .tmt-stop span { color: var(--default-content-title-color, #999); font-variant-numeric: tabular-nums; }
    .tmt-ui .tmt-stop b { font-weight: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tmt-ui .tmt-stop em { font-style: normal; color: var(--default-content-title-color, #999); font-size: 11px; }
    .tmt-ui .tmt-stop i { font-style: normal; font-size: 10px; text-align: right; color: var(--default-green-color, #82c91e); }
    .tmt-ui .tmt-stop.now b { font-weight: bold; }
    .tmt-ui a.tmt-tip:hover { background: var(--default-bg-panel-hover-color, #555); }
    .tmt-ui .tmt-row { display: grid; grid-template-columns: minmax(0, 1fr) 112px; align-items: center; gap: 2px 8px; padding: 5px 10px; color: inherit;
      border-bottom: 1px solid var(--panel-border-bottom-color, #3b3b3b); }
    .tmt-ui .tmt-row:hover { background: var(--default-bg-panel-active-color, #444); }
    .tmt-ui .tmt-name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tmt-ui .tmt-where, .tmt-ui .tmt-sub { color: var(--default-content-title-color, #999); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
    .tmt-ui .tmt-hp { position: relative; height: 14px; background: #1a1a1a; border-radius: 3px; overflow: hidden; }
    .tmt-ui .tmt-hp i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(180deg, #8bc34a, #5a8a1e); }
    .tmt-ui .tmt-hp b { position: relative; display: block; text-align: center; font-size: 10px; line-height: 14px; color: #fff; text-shadow: 0 0 2px #000; }
    .tmt-ui .tmt-dead { opacity: .5; }
    .tmt-ui .tmt-foot { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; padding: 6px 10px 0; font-size: 11px; color: var(--default-content-title-color, #999); }
    .tmt-ui .tmt-foot > :last-child { white-space: nowrap; }
    .tmt-ui .tmt-foot a.on { color: var(--default-green-color, #82c91e); }
    .tmt-ui .tmt-key { padding: 8px 10px; line-height: 1.6; }
    .tmt-ui input { width: 150px; color: var(--input-color, #fff); background: var(--input-background-color, linear-gradient(0deg, #111 0%, #000 100%));
      border: 1px solid var(--input-border-color, #444); border-radius: 5px; padding: 3px 6px; outline: none; font: inherit; }
    .tmt-ui input:focus { border-color: var(--input-focus-border-color, #1864ab80); }
    .tmt-ui input::placeholder { color: var(--input-disabled-color, #666); }
    .tmt-ui .tmt-btn { display: inline-block; margin-left: 4px; padding: 3px 10px; border-radius: 5px; font-weight: bold;
      color: var(--btn-color, #eee); text-shadow: 0 0 5px #000; background: var(--btn-background, linear-gradient(180deg, #555 0%, #333 100%));
      border: 1px solid var(--btn-border-color, #222); }
  `;
  document.head.appendChild(s);
}

function init() {
  css();
  // Another copy already owns the header dropdown (an older standalone that doesn't step aside for
  // the Command Center): keep only the tab and badge live. Both copies share one snapshot in
  // localStorage, so the API is still polled once.
  if (document.getElementById('tmt')) {
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 5 * 1000);
    return;
  }
  root = document.createElement('div');
  root.id = 'tmt';
  root.className = 'tmt-ui';
  root.addEventListener('click', onClick);
  document.body.appendChild(root);
  // Close the dropdown like Torn's own: click outside or Escape.
  document.addEventListener('click', (e) => {
    if (UI.open && btnHost?.isConnected && !root.contains(e.target) && !btnHost.contains(e.target)) { UI.open = false; saveUi(); render(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.open && btnHost?.isConnected) { UI.open = false; saveUi(); render(); } });
  window.addEventListener('resize', () => { place(); if (UI.open) render(); });
  // Torn re-renders its header on some pages: put the button back when it goes missing.
  new MutationObserver(() => { if (!btnHost || !btnHost.isConnected) mountButton(); }).observe(document.body, { childList: true, subtree: true });
  mountButton();
  render();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 5 * 1000);
}

return {
  id: 'maol',
  label: "M'aol",
  icon: ICON.replace('width="24" height="25" ', ''),
  access: 'minimal',
  solo: false,   // standalone: its own header button and dropdown, no kit window
  start(k) {
    kit = k;
    init();
  },
  // Command Center tab: the same view as the dropdown, kept live by the same poll.
  async mount(view, k, { force }) {
    paneView = view;
    css();
    pane = k.el('div', 'tmt-ui tmt-pane');
    pane.addEventListener('click', onClick);
    view.body(pane);
    renderPane();
    if (force) {
      view.busy(true);
      try { await refresh(true); } finally { view.busy(false); }
    }
  },
  badge(k) {
    const b = k.el('span', 'tmt-badge');
    b.setAttribute('role', 'button');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); UI.open = true; saveUi(); render(); });
    badgeEls.add(b);
    renderBadges();
    return b;
  },
  settings,
  css: `.tmt-badge{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;flex:none;height:13px;margin:0 0 0 3px;padding:0 3px;background:#3a1414;border:1px solid #7a2020;border-radius:3px;font:700 9px/1 Verdana,Arial,sans-serif;color:#ff8a80;white-space:nowrap;vertical-align:middle;cursor:pointer;user-select:none}
    .occ-dock .tmt-badge{margin:0 0 0 6px;height:16px;padding:0 6px;font-size:11px}`,
};
})();

// ---- plug-in: Operational Command Center/plugins/keys.js
const PLUGIN_3 = (function () {
// Keys tab: how hard the Torn key and the free AI quota are used, as a 14-day trend.
// Torn: GET key/log (public, newest 100 calls of this key, with who called), merged into a day by
// day history in Tampermonkey storage. Sampled when the tab opens and every 30 min while a Torn
// tab is visible, so the trend has few gaps. AI: the private runner's /usage (its own model calls
// plus OpenRouter's count of today's free requests, snapshotted hourly by the runner's cron).
// Limits are per player / per account, so more keys never raise them (torn.com/api.html,
// openrouter.ai/docs/api-reference/limits): the verdict says headroom, not "add a key".

const KEY_HIST = 'occ.keys.hist';
const KEY_LOCK = 'occ.keys.lock';
const TORN_CAP = 100; // calls per minute, per player, all keys together
const AI_CAP = 1000; // free model requests per UTC day (account bought credits once)
const SAMPLE_MS = 30 * 60000;
const LOCK_MS = 60000;
const DAYS = 14;
const MIN_KEEP = 3 * 3600; // seconds of per-minute counts kept to merge peaks across samples

let kit = null;
let timer = 0;

const dayOf = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const sig = (x) => [x.timestamp, x.type, x.selections, x.id, x.ip, x.comment].join('|');

function emptyHist() {
  return { edge: { ts: 0, sigs: [] }, days: {}, mins: {}, last: 0 };
}

// Merge one key/log reply into the history. Entries already seen are skipped by the newest
// timestamp seen and the calls made in that same second. A full log whose oldest entry is newer
// than the last one seen means calls were missed in between: that day is marked as a lower bound.
function mergeLog(hist, log, now) {
  const h = hist || emptyHist();
  const list = (log || []).filter((x) => x && typeof x.timestamp === 'number');
  if (!list.length) return h;
  const self = (list.find((x) => x.type === 'key' && x.selections === 'log') || {}).ip;
  const oldest = Math.min(...list.map((x) => x.timestamp));
  if (h.edge.ts && oldest > h.edge.ts && list.length >= 100) {
    for (let t = h.edge.ts; t <= oldest; t += 86400) (h.days[dayOf(t)] = h.days[dayOf(t)] || { n: 0, peak: 0, src: {} }).gap = true;
    h.days[dayOf(oldest)].gap = true;
  }
  const fresh = list.filter((x) => x.timestamp > h.edge.ts || (x.timestamp === h.edge.ts && h.edge.sigs.indexOf(sig(x)) === -1));
  fresh.forEach((x) => {
    const d = (h.days[dayOf(x.timestamp)] = h.days[dayOf(x.timestamp)] || { n: 0, peak: 0, src: {} });
    d.n++;
    const from = self && x.ip === self ? 'you' : 'elsewhere';
    const what = x.comment ? String(x.comment) : x.type + ' ' + String(x.selections || '');
    const k = from + '\u0001' + what;
    d.src[k] = (d.src[k] || 0) + 1;
    const m = Math.floor(x.timestamp / 60) * 60;
    h.mins[m] = (h.mins[m] || 0) + 1;
  });
  Object.keys(h.mins).forEach((m) => {
    const d = h.days[dayOf(+m)];
    if (d) d.peak = Math.max(d.peak, h.mins[m]);
    if (+m < now / 1000 - MIN_KEEP) delete h.mins[m];
  });
  const top = Math.max(h.edge.ts, ...list.map((x) => x.timestamp));
  const sigs = list.filter((x) => x.timestamp === top).map(sig);
  h.edge = { ts: top, sigs: top === h.edge.ts ? h.edge.sigs.concat(sigs.filter((s) => h.edge.sigs.indexOf(s) === -1)) : sigs };
  const cut = dayOf(now / 1000 - 40 * 86400);
  Object.keys(h.days).forEach((d) => {
    if (d < cut) delete h.days[d];
  });
  h.last = now;
  return h;
}

async function sample(force) {
  const now = Date.now();
  const hist = kit.vault.get(KEY_HIST, null);
  if (!force && hist && now - hist.last < SAMPLE_MS) return hist;
  if (!force && now - kit.store.get(KEY_LOCK, 0) < LOCK_MS) return hist;
  kit.store.set(KEY_LOCK, now);
  try {
    const j = await kit.torn('key/log?limit=100&comment=OCC');
    const merged = mergeLog(kit.vault.get(KEY_HIST, null), j.log, Date.now());
    kit.vault.set(KEY_HIST, merged);
    return merged;
  } finally {
    kit.store.del(KEY_LOCK);
  }
}

function schedule() {
  clearTimeout(timer);
  if (!kit.tornKey()) return;
  timer = setTimeout(() => {
    if (!document.hidden) sample(false).catch(() => {});
    schedule();
  }, SAMPLE_MS);
}

async function runnerUsage() {
  const h = { Authorization: 'ApiKey ' + kit.tornKey() };
  const or = kit.keys.get(kit.KEY_OR);
  if (or) h['X-OpenRouter-Key'] = or;
  const r = await kit.http({ url: RUNNER + '/usage', headers: h, timeout: 20000 });
  const j = kit.parseJson(r.text);
  if (r.status !== 200) throw new Error(j.error || 'Runner HTTP ' + r.status);
  return j;
}

function lastDays(now) {
  return Array.from({ length: DAYS }, (_, i) => new Date(now - (DAYS - 1 - i) * 86400000).toISOString().slice(0, 10));
}

// A row of day bars, today on the right. vals: [{ v, tip, warn }], scaled to max(cap line, top).
function bars(vals, cap) {
  const top = Math.max(cap || 0, ...vals.map((x) => x.v || 0), 1);
  const w = kit.el('div', 'occ-kb');
  vals.forEach((x) => {
    const b = kit.el('i', x.v === null ? 'none' : x.warn ? 'warn' : '');
    b.style.height = x.v ? Math.max(2, Math.round((x.v / top) * 100)) + '%' : '0';
    b.addEventListener('mouseenter', () => kit.tip.show(b, x.tip));
    b.addEventListener('mouseleave', () => kit.tip.hide());
    b.addEventListener('click', () => kit.tip.show(b, x.tip));
    w.appendChild(b);
  });
  return w;
}

function level(ratio) {
  return ratio >= 0.8 ? 'bad' : ratio >= 0.5 ? 'warn' : 'good';
}

function tornCard(hist, days) {
  const c = kit.ui.card('Torn API key');
  const today = (hist && hist.days[days[DAYS - 1]]) || { n: 0, peak: 0, src: {} };
  c.appendChild(
    bars(
      days.map((d) => {
        const x = hist && hist.days[d];
        return x ? { v: x.n, warn: x.peak >= TORN_CAP * 0.5, tip: d + ': ' + (x.gap ? 'at least ' : '') + fmt(x.n) + ' calls, peak ' + x.peak + ' / ' + TORN_CAP + ' per min' } : { v: null, tip: d + ': not sampled' };
      })
    )
  );
  const rows = Object.keys(today.src)
    .map((k) => ({ from: k.split('\u0001')[0], what: k.split('\u0001')[1], n: today.src[k] }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  if (rows.length) {
    const t = kit.el('div', 'occ-tbl');
    t.innerHTML =
      '<table><tr><th>Today, by caller</th><th>From</th><th>Calls</th></tr>' +
      rows.map((r) => '<tr><td>' + kit.esc(r.what) + '</td><td>' + r.from + '</td><td>' + fmt(r.n) + '</td></tr>').join('') +
      '</table>';
    c.appendChild(t);
  }
  c.appendChild(kit.el('div', 'occ-muted', 'Cap is ' + TORN_CAP + ' calls/min per player, shared by all your keys, so a new key adds no room. "Elsewhere" = sites or bots you gave this key.'));
  return c;
}

function aiCard(u, days) {
  const c = kit.ui.card('AI, free models (OpenRouter)');
  if (!u) {
    c.appendChild(kit.el('div', 'occ-muted', 'Runner did not answer. Try Refresh.'));
    return c;
  }
  const by = {};
  (u.days || []).forEach((d) => (by[d.day] = d));
  c.appendChild(
    bars(
      days.map((d) => {
        const x = by[d] || {};
        const ai = x.ai || { ok: 0, rl: 0, fail: 0 };
        const used = x.or && typeof x.or.used === 'number' ? x.or.used : x.ai ? ai.ok + ai.rl + ai.fail : null;
        const cap = (x.or && x.or.limit) || AI_CAP;
        return { v: used, warn: used !== null && used >= cap * 0.5, tip: d + ': ' + (used === null ? 'no data' : fmt(used) + ' / ' + fmt(cap) + ' free requests') + (x.ai ? ' · runner ' + ai.ok + ' ok, ' + ai.rl + ' busy, ' + ai.fail + ' failed' : '') };
      })
    )
  );
  const t = (by[days[DAYS - 1]] || {}).ai;
  const models = t ? Object.keys(t.models).sort((a, b) => t.models[b][0] - t.models[a][0]) : [];
  const line = t ? 'Runner today: ' + t.ok + ' ok · ' + t.rl + ' busy (429) · ' + t.fail + ' failed' + (models.length ? ' · mostly ' + models[0].replace(/:free$/, '') : '') : 'Runner made no AI calls today.';
  c.appendChild(kit.el('div', 'occ-muted', kit.esc(line) + '<br>Cap is per account (20/min, ' + fmt(AI_CAP) + '/day); extra keys or accounts do not raise it.' + (u.live ? '' : ' OpenRouter count unavailable: add the OPENROUTER_KEY runner secret or an OpenRouter key in Setup.')));
  return c;
}

async function mount(view, k, opt) {
  kit = k;
  view.busy(true);
  const [hist, use] = await Promise.all([sample(!!(opt && opt.force)).catch((e) => ({ err: e.message })), runnerUsage().catch((e) => ({ err: e.message }))]);
  view.busy(false);
  const now = Date.now();
  const days = lastDays(now);
  const h = hist && !hist.err ? hist : kit.vault.get(KEY_HIST, null);
  const u = use && !use.err ? use : null;
  const today = (h && h.days[days[DAYS - 1]]) || { n: 0, peak: 0 };
  const orToday = u && u.live && typeof u.live.used === 'number' ? u.live : null;
  const aiUsed = orToday ? orToday.used : null;
  const aiCap = (orToday && orToday.limit) || AI_CAP;
  const peak14 = h ? Math.max(0, ...days.map((d) => (h.days[d] ? h.days[d].peak : 0))) : 0;
  const aiTop = u ? Math.max(0, ...(u.days || []).map((d) => (d.or && d.or.used) || 0)) : 0;
  const tl = level(peak14 / TORN_CAP);
  const al = level(Math.max(aiTop, aiUsed || 0) / aiCap);
  view.stats([
    { k: 'Torn peak / min', v: String(today.peak), unit: ' / ' + TORN_CAP, hot: tl !== 'good' },
    { k: 'Torn calls today', v: fmt(today.n) },
    { k: 'AI free today', v: aiUsed === null ? '?' : fmt(aiUsed), unit: ' / ' + fmt(aiCap), hot: al !== 'good' },
  ]);
  const say = { good: 'plenty of room', warn: 'getting busy', bad: 'near the cap: poll less or spread calls out' };
  view.meta('<span class="occ-kv-' + tl + '">Torn: ' + say[tl] + '</span> · <span class="occ-kv-' + al + '">AI: ' + say[al] + '</span>');
  const wrap = kit.el('div');
  if (hist && hist.err) wrap.appendChild(kit.ui.errCard('Torn key log failed', hist.err));
  wrap.appendChild(tornCard(h, days));
  if (use && use.err) wrap.appendChild(kit.ui.errCard('Runner usage failed', use.err));
  wrap.appendChild(aiCard(u, days));
  view.body(wrap);
}

return {
  id: 'keys',
  label: 'Keys',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>',
  access: 'public',
  start(k) {
    kit = k;
    if (!document.hidden && kit.tornKey()) sample(false).catch(() => {});
    schedule();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && kit.tornKey()) sample(false).catch(() => {});
    });
  },
  mount,
  css: `
    .occ-kb{display:flex;align-items:flex-end;gap:2px;height:42px;margin:0 0 8px;padding:4px;border-radius:5px;background:var(--occ-sunk)}
    .occ-kb i{flex:1;min-width:0;background:var(--occ-accent);border-radius:2px 2px 0 0;cursor:pointer}
    .occ-kb i.warn{background:var(--occ-warn)}
    .occ-kb i.none{height:2px!important;background:var(--occ-line2)}
    .occ-kv-good{color:var(--occ-good)}
    .occ-kv-warn{color:var(--occ-warn)}
    .occ-kv-bad{color:var(--occ-bad)}
  `,
};
})();

// ---- occ-kit/shell/occ.js
// Operational Command Center shell: the icon next to the player's name, the floating window and its
// tabs. Tabs come from two places: plug-ins bundled into this build (mount) and the runner's skill
// list (an AI answer view). Badges (small pills like company trains) sit right of the icon.










const KEY_OPEN = 'occ.open';
const KEY_TAB = 'occ.skill';
const KEY_ANS = 'occ.ans.';
const KEY_SKILLS = 'occ.skills';
const OWNER_ID = '2805199';
const STALE_MS = 12 * 3600 * 1000;
const CANCELLED = 'Cancelled.';
const SETUP = 'settings';

const OCC_ICON = {
  dash: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12v.01"/><path d="M19.071 4.929c-1.562-1.562-6 .337-9.9 4.243c-3.905 3.905-5.804 8.337-4.242 9.9c1.562 1.561 6-.338 9.9-4.244c3.905-3.905 5.804-8.337 4.242-9.9"/><path d="M4.929 4.929c-1.562 1.562.337 6 4.243 9.9c3.905 3.905 8.337 5.804 9.9 4.242c1.561-1.562-.338-6-4.244-9.9c-3.905-3.905-8.337-5.804-9.9-4.242"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
};

const OCC_CSS = `
  #occ-root .occ-ver{flex:none;font:11px/1 Arial,Helvetica,sans-serif;color:var(--occ-title-fg);opacity:.6;text-shadow:none}
  button.occ-inline{all:unset;box-sizing:border-box;position:relative;z-index:5;display:inline-flex!important;align-items:center;justify-content:center;width:18px;height:18px;min-width:18px;min-height:18px;margin:0 0 0 6px;padding:0;border:0;border-radius:4px;background:transparent;color:#f2c14e;vertical-align:middle;cursor:pointer;flex:none;overflow:visible;text-indent:0;font-size:0;line-height:0;-webkit-tap-highlight-color:transparent}
  button.occ-inline>svg{display:block;width:16px!important;height:16px!important;fill:none!important;stroke:#f2c14e!important;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:1;visibility:visible}
  button.occ-inline:active{transform:scale(.9)}
  button.occ-inline:focus-visible{box-shadow:0 0 0 2px rgba(242,193,78,.5)}
  .occ-badges{all:unset;box-sizing:border-box;display:inline-flex!important;align-items:center;flex:none;vertical-align:middle;white-space:nowrap}
  .occ-badges:empty{display:none!important}
  .occ-badges.occ-float{position:fixed;right:16px;bottom:142px;margin:0;z-index:99990}
  .occ-dock{display:flex;align-items:center;justify-content:flex-start;box-sizing:border-box;width:100%;margin:0;padding:3px 12px 0;background:transparent;pointer-events:none;position:relative;z-index:1}
  .occ-dock .occ-inline,.occ-dock .occ-badges{pointer-events:auto}
  .occ-dock .occ-inline{margin:0 0 0 2px}
  .occ-dock.occ-side{padding:2px 0 3px;gap:2px}
  .occ-dock.occ-side .occ-inline{margin:0}
  @media (min-width:768px){
    .occ-badges.occ-float{bottom:80px;right:24px}
  }

`;

// Anchors we are willing to sit next to, best first. The first two are the desktop sidebar, which
// Torn PDA does not render at all. Torn's sidebar moved to camelCase hashed classes in 2026-10:
// <p class="menuInfoRow___x"><span>Name:</span><a class="menuValue___x" href="/profiles.php?XID=...">.
// The kebab-case ones are kept for the old layout.
const NAME_ANCHORS = [
  'a[class*="menuValue"][href*="profiles.php"]',
  '[class*="menuInfoRow"] a[href*="profiles.php"]',
  '[class*="userInformation"] a[href*="profiles.php"]',
  '[class*="user-information"] a[href*="profiles.php"]',
  '[class*="menu-value"] a[href*="profiles.php"]',
];
const MOBILE_INFO = '[class*="user-information-mobile"],[class*="userInformationMobile"]';

function boot(plugins) {
  const kit = makeKit('occ', () => document.getElementById('occ-root'));
  const panels = plugins.filter((p) => typeof p.mount === 'function');
  const badges = plugins.filter((p) => typeof p.badge === 'function');
  let remote = (store.get(KEY_SKILLS, []) || []).map(fromRunner);
  let tabs = [];
  let win, main, title, sub, launch, tabBar, statsRow, tool, rerun, gear;
  const btns = {};
  const inflight = {};
  let current = null;

  // A standalone build of a bundled plug-in steps aside when it sees its id here.
  document.documentElement.setAttribute('data-occ-plugins', plugins.map((p) => p.id).join(' '));

  function fromRunner(r) {
    return { id: r.id, label: r.label, icon: safeIcon(r.icon) || letterIcon(r.label), access: r.access || 'full', skill: r.id };
  }

  function plugTab(p) {
    return { id: p.id, label: p.label, icon: safeIcon(p.icon) || letterIcon(p.label), access: p.access || 'minimal', plugin: p };
  }

  // Bundled plug-ins first; a runner skill that a plug-in already owns (plugin.skill) is not listed twice.
  function allTabs() {
    const owned = panels.map((p) => p.skill).filter(Boolean);
    return panels.map(plugTab).concat(remote.filter((s) => owned.indexOf(s.id) === -1));
  }

  async function loadSkills() {
    try {
      const r = await http({ url: RUNNER + '/skills' });
      const json = parseJson(r.text);
      if (r.status !== 200 || !Array.isArray(json.skills)) return false;
      store.set(KEY_SKILLS, json.skills);
      remote = json.skills.map(fromRunner);
      renderTabs();
      return true;
    } catch (e) {
      return false;
    }
  }

  function setActive(id) {
    current = id;
    Object.keys(btns).forEach((k) => btns[k].classList.toggle('occ-act', k === id));
    gear.classList.toggle('occ-act', id === SETUP);
    tool.hidden = !id || id === SETUP;
  }

  function setHead(label, meta) {
    title.textContent = label || 'Command Center';
    sub.innerHTML = meta || '';
  }

  function show(node) {
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
  }

  function metaHtml(a) {
    const when = new Date(a.at);
    const shortModel = String(a.model || '').split('/').pop().replace(/:free$/, '');
    const today = new Date().toDateString() === when.toDateString();
    const stamp = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (today ? '' : ', ' + when.toLocaleDateString());
    const age = Date.now() - a.at;
    const old = age > STALE_MS ? ' · <span class="occ-old">' + Math.floor(age / 3600000) + 'h old</span>' : '';
    return '<span class="occ-dot">●</span> ' + esc(shortModel) + ' · ' + esc(stamp) + old;
  }

  function answerView(t, a) {
    const wrap = el('div');
    setHead(t.label, metaHtml(a));
    sub.title = a.model + ' - ' + new Date(a.at).toLocaleString();
    fillStats(statsRow, a.stats);
    // Skill-made sections stay fixed run to run; the model then only writes the summary.
    const fixed = Array.isArray(a.sections) && a.sections.length;
    const sections = fixed ? [{ title: 'Summary', body: a.text }].concat(a.sections) : mdSections(a.text);
    if (!sections.length) sections.push({ title: null, body: a.text });
    sections.forEach((sec, i) => {
      const node = el('div', 'occ-md', mdToHtml(sec.body));
      const bullets = node.querySelectorAll('li').length;
      wrap.appendChild(accordion(sec.title || (i === 0 ? 'Summary' : 'More'), node, { badge: bullets > 2 ? String(bullets) : null }));
    });
    return wrap;
  }

  function progress(run, label) {
    const status = el('div', 'occ-card');
    const line = el('div', 'occ-bar');
    line.style.marginTop = '0';
    const text = el('span', '', '');
    const started = Date.now();
    const paint = () => {
      const s = Math.round((Date.now() - started) / 1000);
      text.innerHTML = '<span class="occ-spin"></span>' + esc(label) + (s >= 3 ? ' · ' + s + ' s' : '');
    };
    paint();
    run.tick = setInterval(paint, 1000);
    const stop = button(
      'Cancel',
      () => {
        run.stopped = true;
        if (run.reject) run.reject(new Error(CANCELLED));
      },
      true
    );
    stop.classList.add('occ-cancel');
    line.appendChild(text);
    line.appendChild(stop);
    status.appendChild(line);
    return status;
  }

  async function openSkill(t, force) {
    const cached = vault.get(KEY_ANS + t.id, null);
    if (cached && !force) {
      show(answerView(t, cached));
      return;
    }
    setHead(t.label, '');
    if (!tornKey()) {
      showSettings('Paste your Torn API token first, then press ' + t.label + ' again.');
      return;
    }
    if (inflight[t.id]) {
      if (inflight[t.id].status) show(inflight[t.id].status);
      return;
    }
    const run = { stopped: false };
    inflight[t.id] = run;
    rerun.classList.add('occ-busy');
    fillStats(statsRow, null);
    run.status = progress(run, 'Running the skill and asking a free model');
    show(run.status);
    // Cancel answers at once; the request already on the wire finishes in the background and is ignored.
    const cancelled = new Promise((_, reject) => (run.reject = reject));
    try {
      const a = await Promise.race([ai.ask(t.skill, { force: !!force }), cancelled]);
      const rec = { text: a.answer || a.report || '', model: a.model || 'runner', at: Date.now(), stats: a.stats || null, sections: a.sections || null };
      vault.set(KEY_ANS + t.id, rec);
      if (current === t.id) show(answerView(t, rec));
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (current !== t.id) {
        // Another tab is on screen now; nothing to repaint.
      } else if (msg === CANCELLED) {
        const prev = vault.get(KEY_ANS + t.id, null);
        if (prev) show(answerView(t, prev));
        else show(el('div', 'occ-card occ-muted', 'Cancelled.'));
      } else show(errCard(t.label + ' failed', msg));
    } finally {
      clearInterval(run.tick);
      inflight[t.id] = null;
      rerun.classList.remove('occ-busy');
    }
  }

  // What a plug-in draws with: its tab body, the stats row and the header meta line.
  function viewFor(t) {
    const live = () => current === t.id;
    return {
      body(node) {
        if (live()) show(typeof node === 'string' ? el('div', 'occ-md', node) : node);
      },
      stats(list) {
        if (live()) fillStats(statsRow, list);
      },
      meta(html) {
        if (live()) sub.innerHTML = html || '';
      },
      busy(on) {
        rerun.classList.toggle('occ-busy', !!on);
      },
      get active() {
        return live();
      },
    };
  }

  async function openPlugin(t, force) {
    setHead(t.label, '');
    fillStats(statsRow, null);
    show(el('div', 'occ-card', '<span class="occ-spin"></span>Loading...'));
    try {
      await t.plugin.mount(viewFor(t), kit, { force: !!force });
    } catch (e) {
      if (current === t.id) show(errCard(t.label + ' failed', String((e && e.message) || e)));
    }
  }

  function openTab(id, force) {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    store.set(KEY_TAB, id);
    main.dataset.ran = '1';
    setActive(id);
    sub.title = '';
    if (t.plugin) openPlugin(t, force);
    else openSkill(t, force);
  }

  function showSettings(note) {
    store.set(KEY_TAB, SETUP);
    main.dataset.ran = '1';
    setActive(SETUP);
    setHead('Setup', 'v' + esc(kit.version));
    fillStats(statsRow, null);
    const wrap = el('div');
    if (note) wrap.appendChild(el('div', 'occ-card occ-err', esc(note)));
    const c1 = el('div', 'occ-card');
    keyField(c1, { key: KEY_OR, title: 'OpenRouter key', placeholder: 'sk-or-v1-...', saved: 'Key saved in Tampermonkey storage. The runner sends skill reports (your money, networth, company numbers) to free OpenRouter models only, which may log them.', empty: 'Optional. Without it you get the raw report. With it, free OpenRouter models (never paid ones) write the answer; they may log the report.' });
    wrap.appendChild(c1);
    const c2 = el('div', 'occ-card');
    keyField(c2, { key: KEY_TORN, title: 'Torn API token', placeholder: 'Torn API key (full access)', saved: 'Token saved in Tampermonkey storage; sent to the runner per run, never stored there.', empty: tornKey() ? 'Using the key Torn PDA filled in.' : 'No token yet. The runner pulls your live numbers with it; it is never stored server side.' });
    wrap.appendChild(c2);
    plugins.forEach((p) => {
      if (typeof p.settings !== 'function') return;
      const c = el('div', 'occ-card');
      try {
        p.settings(c, kit);
        wrap.appendChild(c);
      } catch (e) {}
    });
    const c3 = el('div', 'occ-card');
    c3.appendChild(el('h3', '', 'Answers'));
    const row = el('div', 'occ-bar');
    const wipe = button(
      'Clear cached answers',
      () => {
        tabs.forEach((t) => vault.del(KEY_ANS + t.id));
        wipe.textContent = 'Cleared';
      },
      true
    );
    row.appendChild(wipe);
    c3.appendChild(row);
    wrap.appendChild(c3);
    const info = el('div', 'occ-card');
    info.appendChild(el('h3', '', 'How it works'));
    info.appendChild(el('div', 'occ-muted', 'Tabs are the scripts bundled into this build plus the skills the runner lists. A skill tab asks the runner, which runs the skill with your Torn API token, then has a free OpenRouter model write the answer. The runner rotates free models, skips ones that failed lately and never calls a paid one. Version ' + esc(kit.version) + '.'));
    wrap.appendChild(info);
    show(wrap);
  }

  function renderTabs() {
    if (!tabBar) return;
    tabs = allTabs();
    tabBar.innerHTML = '';
    Object.keys(btns).forEach((k) => delete btns[k]);
    tabs.forEach((t) => {
      const b = el('button', 'occ-tab', t.icon + '<span>' + esc(t.label) + '</span>');
      b.type = 'button';
      b.title = t.label + ' (needs a ' + t.access + ' key)';
      b.addEventListener('click', () => openTab(t.id));
      btns[t.id] = b;
      tabBar.appendChild(b);
    });
    if (current && btns[current]) btns[current].classList.add('occ-act');
  }

  function setOpen(on) {
    win.classList.toggle('occ-on', on);
    store.set(KEY_OPEN, on);
    if (on && !main.dataset.ran) {
      const cur = store.get(KEY_TAB, null);
      if (cur === SETUP) showSettings();
      else if (cur && tabs.some((t) => t.id === cur)) openTab(cur);
    }
  }

  // ---- icon next to the player's name, badges right of it ---------------------------------
  // Home page fallback: the player's OWN name row in "General Information", found structurally.
  // Torn's class names there are generated, so instead: a profiles.php link whose row label starts
  // with "Name". Written without regex escapes on purpose - a \b escape in this spot once got
  // corrupted into literal backspace bytes, which silently disabled the row check and mounted the
  // icon next to any player link.
  function homeNameAnchor() {
    const links = document.querySelectorAll('a[href*="profiles.php"]');
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      if (!a.parentNode || a.closest('.occ-win')) continue;
      const text = (a.textContent || '').trim();
      // Their own row reads "Name  KamiRen [2805199]"; the [id] is the giveaway.
      if (text.indexOf('[') === -1 || text.indexOf(']') === -1) continue;
      const row = a.closest('tr,li,div');
      if (!row) continue;
      const label = (row.textContent || '').trim().slice(0, 4).toLowerCase();
      if (label === 'name') return a;
    }
    return null;
  }

  function nameAnchor() {
    for (let i = 0; i < NAME_ANCHORS.length; i++) {
      const a = document.querySelector(NAME_ANCHORS[i]);
      if (a && a.parentNode) return a;
    }
    return homeNameAnchor();
  }

  function inlineButton() {
    const b = el('button', 'occ-inline', OCC_ICON.dash);
    b.type = 'button';
    b.title = 'Operational Command Center';
    return b;
  }

  function badgeSlot(floating) {
    const s = el('span', 'occ-badges' + (floating ? ' occ-float' : ''));
    badges.forEach((p) => {
      try {
        s.appendChild(p.badge(kit));
      } catch (e) {}
    });
    return s;
  }

  // Phone-sized Torn layout (PDA or mobile browser): icons row is crowded, so use the fixed slot.
  function useDock(btn) {
    return isPda() || window.innerWidth <= 768 || !!(btn && btn.closest(MOBILE_INFO));
  }

  // The mobile money + icons block. 2026-10 markup: swiperWrapper___ > [div.points-mobile___,
  // ul.statusIcons___.mobile___], so when the block's own class is unknown, take the swiper's
  // parent (one more step up if that is a swiper too).
  function mobileInfo(btn) {
    const um = btn.closest(MOBILE_INFO) || document.querySelector(MOBILE_INFO);
    if (um) return um;
    const icons = document.querySelector('ul[class*="statusIcons"][class*="mobile"],[class*="points-mobile"],[class*="pointsMobile"]');
    if (!icons) return null;
    let block = icons.closest('[class*="swiperWrapper"],[class*="swiper-wrapper"]') || icons;
    block = block.parentNode;
    if (block && /swiper/i.test(block.className || '') && block.parentNode) block = block.parentNode;
    return block && block !== document.body ? block : null;
  }

  // Desktop sidebar: the last info row (Merits) under the name, so icon and badges get a row of
  // their own there. Next to the name the badges ran past the sidebar's edge and were cut off.
  function sidebarLastRow(a) {
    const ROW = '[class*="menuInfoRow"],[class*="menu-info-row"]';
    const row = a.closest(ROW);
    if (!row || !row.parentNode) return null;
    const rows = Array.prototype.filter.call(row.parentNode.children, (c) => c.matches(ROW));
    return rows[rows.length - 1] || row;
  }

  // Phone layout: no room beside the name, so icon and badges get their own fixed slot on every
  // page, right under the status icons line and above the page title. Desktop passes `fixed`: the
  // row under the sidebar's Merits line.
  function placeDock(btn, fixed) {
    // Real Torn mobile markup: div.content > [div.areas (nav), div.user-information-mobile (money +
    // icons swiper)], then the page. The icons <ul> sits in a horizontal swiper, so the dock must
    // go AFTER the whole block.
    const um = fixed ? null : mobileInfo(btn);
    let anchor = fixed || (um && um.parentNode ? { node: um, where: 'afterend' } : null);
    if (!anchor) {
      const t = document.querySelector('.content-wrapper > .content-title') || document.querySelector('.content-title');
      if (t) anchor = { node: t, where: 'beforebegin' };
    }
    if (!anchor) {
      const row = btn.closest('[class*="status-icons"],[class*="statusIcons"]') || btn.closest('ul,ol') || btn.parentNode;
      if (!row || !row.parentNode || row === document.body) return false;
      anchor = { node: row, where: 'afterend' };
    }
    const sib = anchor.where === 'beforebegin' ? anchor.node.previousElementSibling : anchor.node.nextElementSibling;
    let dock = sib && sib.classList.contains('occ-dock') ? sib : null;
    let slot = dock ? dock.querySelector('.occ-badges') : null;
    if (!slot) {
      if (dock) dock.remove();
      dock = el('div', 'occ-dock' + (fixed ? ' occ-side' : ''));
      // Line up with the sidebar rows' own text indent.
      if (fixed) dock.style.paddingLeft = getComputedStyle(fixed.node).paddingLeft;
      slot = badgeSlot(false);
      dock.appendChild(slot);
      anchor.node.insertAdjacentElement(anchor.where, dock);
    }
    // Icon and badges live together in the dock, left-aligned (the icons row has no room for them).
    if (btn.parentNode !== dock) dock.insertBefore(btn, slot);
    document.querySelectorAll('.occ-inline').forEach((x) => {
      if (x !== btn) x.remove();
    });
    document.querySelectorAll('.occ-badges').forEach((x) => {
      if (x !== slot) x.remove();
    });
    document.querySelectorAll('.occ-dock').forEach((d) => {
      if (d !== dock) d.remove();
    });
    return true;
  }

  function placeBadges(btn) {
    if (useDock(btn) && placeDock(btn)) return;
    let s = btn.nextElementSibling;
    if (!s || !s.classList.contains('occ-badges') || s.classList.contains('occ-float')) {
      s = badgeSlot(false);
      btn.insertAdjacentElement('afterend', s);
    }
    const par = btn.parentNode;
    if (par && par.style && par.style.whiteSpace !== 'nowrap') par.style.whiteSpace = 'nowrap';
    document.querySelectorAll('.occ-badges').forEach((x) => {
      if (x !== s) x.remove();
    });
  }

  // No name row on this page (PDA etc.): badges float above the launcher.
  function placeFloatBadges() {
    if (!badges.length || document.querySelector('.occ-badges')) return;
    document.getElementById('occ-root').appendChild(badgeSlot(true));
  }

  function mountInline() {
    const docked = document.querySelector('.occ-dock .occ-inline');
    if (docked && useDock(docked) && placeDock(docked)) {
      launch.classList.add('occ-hide');
      return true;
    }
    const a = nameAnchor();
    if (!a || !a.parentNode) {
      // Phone layout: the dock hangs off the icons block or the page title, not the name link, so
      // it still mounts when Torn drops or moves the name link.
      if (useDock(null) && placeDock(inlineButton())) {
        launch.classList.add('occ-hide');
        return true;
      }
      // Nothing to hang on: keep the floating launcher visible so the panel is always reachable.
      // Never hide it without a mount.
      launch.classList.remove('occ-hide');
      placeFloatBadges();
      return false;
    }
    const side = !useDock(null) && sidebarLastRow(a);
    if (side) {
      const sb = docked || a.parentNode.querySelector('.occ-inline') || inlineButton();
      if (placeDock(sb, { node: side, where: 'afterend' })) {
        launch.classList.add('occ-hide');
        return true;
      }
    }
    const have = docked || a.parentNode.querySelector('.occ-inline');
    if (have) {
      launch.classList.add('occ-hide');
      placeBadges(have);
      return true;
    }
    const b = inlineButton();
    // Torn appends badges (donator star, awards) right after the name link. Ionuț wants only his
    // icon there, so on his own name those badges are hidden and the button takes their spot.
    // Everyone else keeps their badges.
    let ref = a;
    const mine = new URLSearchParams(a.search || '').get('XID') === OWNER_ID;
    while (mine && ref.nextElementSibling && !ref.nextElementSibling.matches('button,.occ-inline,a') && ref.nextElementSibling.getBoundingClientRect().width <= 24) {
      ref = ref.nextElementSibling;
      ref.style.display = 'none';
    }
    a.insertAdjacentElement('afterend', b);
    launch.classList.add('occ-hide');
    placeBadges(b);
    return true;
  }

  function watchName() {
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target && e.target.closest ? e.target.closest('.occ-inline') : null;
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(!win.classList.contains('occ-on'));
      },
      true
    );
    let tries = 0;
    const tick = () => {
      if (mountInline() || ++tries > 40) return;
      setTimeout(tick, 500);
    };
    tick();
    // Torn's chat and timers change the page all the time: check at most once a second, otherwise
    // pages where the icon cannot mount rescan every profile link on each change.
    let moTimer = 0;
    const mo = new MutationObserver(() => {
      if (moTimer) return;
      moTimer = setTimeout(() => {
        moTimer = 0;
        if (!document.querySelector('.occ-inline') || (badges.length && !document.querySelector('.occ-badges'))) mountInline();
      }, 1000);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Torn swaps pages client-side; re-check after each navigation.
    addEventListener('hashchange', mountInline);
    addEventListener('popstate', mountInline);
    // Rotating a tablet across the phone breakpoint: move icon and badges to the other layout.
    let phone = useDock(null);
    let rsTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(rsTimer);
      rsTimer = setTimeout(() => {
        if (useDock(null) === phone) return;
        phone = useDock(null);
        document.querySelectorAll('.occ-dock,.occ-inline,.occ-badges').forEach((x) => x.remove());
        mountInline();
      }, 300);
    });
  }

  function headButton(cls, html, tip, onClick) {
    const b = el('button', 'occ-hb' + (cls ? ' ' + cls : ''), html);
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', onClick);
    return b;
  }

  function build() {
    if (document.getElementById('occ-root')) return;
    const root = el('div');
    root.id = 'occ-root';
    injectTheme(root, '#occ-root', frameCss('#occ-root') + OCC_CSS + plugins.map((p) => p.css || '').join('\n'));

    launch = el('button', 'occ-launch', OCC_ICON.dash);
    launch.type = 'button';
    launch.title = 'Operational Command Center';
    launch.addEventListener('click', () => setOpen(!win.classList.contains('occ-on')));
    root.appendChild(launch);

    win = el('div', 'occ-win');
    const head = el('div', 'occ-head');
    title = el('span', 'occ-title', 'Command Center');
    head.appendChild(title);
    // Installed version, always in sight (title bar, no extra row).
    const ver = el('span', 'occ-ver', 'v' + esc(kit.version));
    ver.title = 'Operational Command Center version';
    head.appendChild(ver);
    head.appendChild(el('span', 'occ-gap'));
    gear = headButton('', OCC_ICON.gear, 'Setup', () => showSettings());
    head.appendChild(gear);
    head.appendChild(headButton('', '&times;', 'Close', () => setOpen(false)));
    win.appendChild(head);

    // The open tab's own line: when its data is from, and its refresh button.
    tool = el('div', 'occ-tool');
    tool.hidden = true;
    sub = el('span', 'occ-sub', '');
    tool.appendChild(sub);
    rerun = button(OCC_ICON.refresh + 'Refresh', () => {
      if (current && current !== SETUP) openTab(current, true);
    });
    rerun.title = 'Run this tab again with fresh data';
    tool.appendChild(rerun);
    win.appendChild(tool);

    statsRow = el('div', 'occ-stats');
    win.appendChild(statsRow);

    main = el('div', 'occ-main occ-scroll');
    win.appendChild(main);

    tabBar = el('div', 'occ-tabs');
    win.appendChild(tabBar);
    root.appendChild(win);
    trapScroll(win);

    renderTabs();
    main.appendChild(el('div', 'occ-empty', '<div>Pick a tab below.</div><div class="occ-muted">' + (tabs.length ? tabs.length + ' available' : 'loading skills...') + '</div>'));
    document.body.appendChild(root);
    plugins.forEach((p) => {
      if (typeof p.start === 'function') {
        try {
          p.start(kit);
        } catch (e) {}
      }
    });
    if (store.get(KEY_OPEN, false)) setOpen(true);
    watchName();
    loadSkills().then((ok) => {
      const empty = main.querySelector('.occ-empty .occ-muted');
      if (empty) empty.textContent = ok ? tabs.length + ' available' : tabs.length ? tabs.length + ' available (offline list)' : 'runner unreachable';
    });
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
}

boot([PLUGIN_0, PLUGIN_1, PLUGIN_2, PLUGIN_3]);
})();
