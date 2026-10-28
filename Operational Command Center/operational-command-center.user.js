// ==UserScript==
// @name         Operational Command Center
// @namespace    Torn.Operational-Command-Center
// @version      0.8.1
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
// @run-at       document-idle
// ==/UserScript==

// Built by occ-kit/build.mjs from the sources named below. Edit those, then rebuild.
(function () {
  'use strict';

const VERSION = '0.8.1';

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

async function write(req) {
  const system = String(req.system || '');
  const user = String(req.user || '');
  if (!runnerPrivate && tornKey()) {
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

// ---- occ-kit/core/theme.js
// Torn's own look for every kit script. Colors, gradients and shadows come from the CSS variables
// Torn itself defines on the page (title bars, tabs, buttons, inputs, panels), so the scripts follow
// Torn's dark and light mode. The value after each comma is Torn's dark mode value, used only where
// a page lacks the variable (taken from torn.com computed styles, 2026-10-28). Plug-ins draw with
// var(--occ-*) and never hardcode colors. No native controls: buttons, inputs and scrollbars are
// all restyled here (color-scheme: dark for anything left).

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
    ${R} .occ-field{display:block;width:100%;height:30px;padding:0 9px;margin:7px 0 2px;border:1px solid var(--occ-input-border);border-radius:5px;background:var(--occ-input-bg);color:var(--occ-input-fg);font:12px/1 Arial,Helvetica,sans-serif;outline:none;appearance:none;-webkit-appearance:none;color-scheme:dark}
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
  ${R} .occ-win{position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99991;display:none;grid-template-rows:34px auto auto 1fr 50px;grid-template-areas:"head" "tool" "stats" "main" "tabs";background:var(--occ-bg);color:var(--occ-fg);font:var(--occ-font);overflow:hidden;text-align:left;color-scheme:dark;border:1px solid var(--occ-div-dark);border-radius:5px;box-shadow:0 0 12px rgba(0,0,0,.7)}
  ${R} .occ-win.occ-on{display:grid}
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
    ai,
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

// When the next automatic refresh is due (ms timestamp), or Infinity when it never is.
function nextAt(c, key) {
  if (!c || typeof c.tried !== 'number' || c.kh !== keyTail(key)) return 0;
  if (c.bad) return Infinity;
  if (c.none) return c.tried + 86400000;
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

function paint() {
  const has = !!trains && typeof trains.n === 'number';
  const n = has ? trains.n : -1;
  const html = '<span class="n">' + (has ? n : '?') + '</span><span class="s">/</span><span class="m">' + TRAINS_MAX + '</span>';
  const tip = tipText();
  document.querySelectorAll('.occ-trains').forEach((p) => {
    p.classList.toggle('full', n >= TRAINS_MAX);
    p.classList.toggle('hot', n > 0 && n < TRAINS_MAX);
    p.classList.toggle('stale', !has || !!(trains && trains.err));
    p.classList.toggle('busy', trainsBusy);
    p.classList.toggle('occ-none', !!(trains && trains.none));
    if (p.innerHTML !== html) p.innerHTML = html;
    if (p.getAttribute('data-tip') !== tip) p.setAttribute('data-tip', tip);
  });
  kit.tip.update(tip);
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
      rec.none = true;
    } else {
      rec.err = 'Unexpected reply from Torn';
    }
  } catch (e) {
    if (e instanceof kit.TornApiError) {
      if (e.code === 6 || e.code === 7) {
        // Not in a company (wrong ID / ID-entity relation): same as not a director.
        rec.none = true;
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
  // Shell asks for a fresh pill whenever it (re)builds a badge slot; paint() updates them all.
  badge(k) {
    const p = makePill(k);
    if (kit) paint();
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

  // Phone layout: no room beside the name, so icon and badges get their own fixed slot on every
  // page, right under the status icons line and above the page title.
  function placeDock(btn) {
    // Real Torn mobile markup: div.content > [div.areas (nav), div.user-information-mobile (money +
    // icons swiper)], then the page. The icons <ul> sits in a horizontal swiper, so the dock must
    // go AFTER the whole block.
    const um = mobileInfo(btn);
    let anchor = um && um.parentNode ? { node: um, where: 'afterend' } : null;
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
      dock = el('div', 'occ-dock');
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

boot([PLUGIN_0]);
})();
