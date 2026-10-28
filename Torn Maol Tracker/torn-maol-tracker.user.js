// ==UserScript==
// @name         Torn M'aol tracker
// @namespace    kamiren.torn-maol-tracker
// @version      1.0.20
// @description  Live M'aol and Praetorian status with flight times for your own travel perks and what to do next
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      live.chain-race.workers.dev
// ==/UserScript==

// Built by occ-kit/build.mjs from the sources named below. Edit those, then rebuild.
(function () {
  'use strict';

const VERSION = '1.0.20';

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
  ${R} .occ-win{position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99991;display:none;grid-template-rows:34px auto 1fr 50px;grid-template-areas:"head" "stats" "main" "tabs";background:var(--occ-bg);color:var(--occ-fg);font:var(--occ-font);overflow:hidden;text-align:left;color-scheme:dark;border:1px solid var(--occ-div-dark);border-radius:5px;box-shadow:0 0 12px rgba(0,0,0,.7)}
  ${R} .occ-win.occ-on{display:grid}
  ${R} .occ-head{grid-area:head;display:flex;align-items:center;gap:4px;padding:0 4px 0 10px;min-width:0;background:var(--occ-title-bg);color:var(--occ-title-fg);text-shadow:var(--occ-title-shadow);border-bottom:1px solid var(--occ-div-dark)}
  ${R} .occ-title{font:bold 13px/1 Arial,Helvetica,sans-serif;white-space:nowrap;flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis}
  ${R} .occ-sub{flex:1;min-width:0;font:11px/1 Arial,Helvetica,sans-serif;color:var(--occ-fg);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;padding-right:4px}
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
  ${R} .occ-main{grid-area:main;overflow-x:hidden;overflow-y:auto;padding:8px 8px 12px;min-width:0;position:relative;-webkit-overflow-scrolling:touch;overflow-wrap:anywhere}
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
  ${R} .occ-win.occ-solo{grid-template-rows:34px auto 1fr;grid-template-areas:"head" "stats" "main"}
  @media (min-width:768px){
    ${R} .occ-launch{bottom:24px;right:24px}
    ${R} .occ-win{top:auto;left:auto;right:24px;bottom:84px;width:420px;height:640px;max-height:calc(100vh - 108px)}
  }
`;
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

// ---- plug-in: Torn Maol Tracker/plugin.js
const PLUGIN_0 = (function () {
// M'aol tracker as an occ-kit plug-in. Builds into the standalone Greasy Fork script
// (torn-maol-tracker.user.js, see occ.build.json) and can be bundled into the Command Center.
// Everything below is the tracker's own code; the kit supplies only the API key storage
// (Tampermonkey storage instead of torn.com localStorage).

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
let UI = Object.assign({ open: true, biz: false }, load(K.ui, {}));
const saveState = () => store(K.state, ST);
const saveUi = () => store(K.ui, UI);
let kit = null;
const apiKey = () => (IS_PDA ? PDA_KEY : (kit.keys.get(K.key) || ''));

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
async function refresh() {
  if (inFlight) return;
  inFlight = true;
  try { await poll(); } finally { inFlight = false; }
}
async function poll() {
  if (!apiKey() || sleeping()) { render(); return; }
  // Several Torn tabs share one snapshot: only the first tab due polls the API.
  const fresh = load(K.state, {});
  const dormant = fresh.snap && fresh.snap.maol.state === 'Dormant' && fresh.snap.guards.every((g) => g.state === 'Dormant');
  if (fresh.snap && now() - fresh.snap.t < (dormant ? IDLE_POLL_S : POLL_S) - 2) {
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
function stayOrFly(P, maol, me, method, bonded) {
  const t = now();
  const eta = killEta(MAOL.id, maol.hp, maol.max);
  const deathAt = bonded || !isFinite(eta) ? Infinity : t + eta * 60;
  const opens = bonded ? P.bondAt : t;
  const windows = [{ c: maol.country, from: t, to: P.leaves }, ...P.stops.map((s) => ({ c: s.c, from: s.at, to: s.at + HOP_S }))];
  const fits = windows.map((w) => {
    const arrive = t + tripMin(me, w.c, method) * 60 + 60;
    const start = Math.max(w.from, arrive, opens);
    return { ...w, arrive, start, ok: start < Math.min(w.to, deathAt) - 60 };
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
  return { c: 'go', t: `Fly to ${best.c} now (${METHOD_NAME[method]}, ${fmtMin(tripMin(me, best.c, method))}). M'aol is there ${win}.` + (bonded ? ' First stop after the bond breaks.' : '') + home + lowHp, href: 'https://www.torn.com/page.php?sid=travel' };
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

function render() {
  if (!root) return;
  const method = bestMethod();
  const p = perkMethods(ST.perks);
  let body;
  if (!apiKey()) {
    body = `<div class="tmt-key">Minimal access API key needed (NPCs, your status, perks, travel).<br>
      <input id="tmt-key" maxlength="16" placeholder="16-character key" autocomplete="off">
      <a href="#" class="tmt-btn" data-act="save-key">Save</a></div>`;
  } else if (!D) {
    body = `<div class="tmt-tip info">${sleeping() ? "M'aol sleeps until Halloween week (26 Oct). No API calls until then." : err ? esc(err) : 'Loading…'}</div>`;
  } else {
    const tip = (x) => x.href
      ? `<a class="tmt-tip ${x.c}" href="${x.href}"${/tornstats/.test(x.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(x.t)}</a>`
      : `<div class="tmt-tip ${x.c}">${x.h || esc(x.t)}</div>`;
    const all = advice();
    const notes = all.filter((x) => x.c === 'note');
    body = `
      <div class="tmt-sec">Next</div>${all.filter((x) => x.c !== 'note').map(tip).join('')}
      <div class="tmt-sec">Praetorians</div>${D.guards.map(bar).join('')}
      <div class="tmt-sec">Boss</div>${bar(D.maol)}
      ${notes.length ? `<div class="tmt-sec">Tips</div>${notes.map(tip).join('')}` : ''}
      <div class="tmt-foot">
        <span>You: ${esc(D.me.where || D.me.desc)} · ${METHOD_NAME[method]}${p.book ? ' + book' : ''}</span>
        <a href="#" data-act="biz" class="${UI.biz ? 'on' : ''}">${UI.biz ? 'Using business ticket' : 'Have business ticket?'}</a>
      </div>
      <div class="tmt-foot"><span>${err ? `⚠ ${esc(err)} · data from ${hm(D.t)}` : `Updated ${hm(D.t)} · times in ${tzLabel()}`}</span>
        ${IS_PDA ? '' : '<a href="#" data-act="forget-key">change key</a>'}</div>`;
  }
  const docked = !!btnHost && btnHost.isConnected;
  root.classList.toggle('tmt-docked', docked);
  root.innerHTML = `
    <div class="tmt-head" data-act="toggle"><span>M'aol</span><span class="tmt-pill">${D ? pill() : ''}</span><span class="tmt-caret">${docked ? '✕' : UI.open ? '▾' : '▸'}</span></div>
    ${UI.open ? `<div class="tmt-body">${body}</div>` : ''}`;
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
  if (act === 'forget-key') { kit.keys.del(K.key); D = null; render(); }
  if (act === 'save-key') {
    const v = (root.querySelector('#tmt-key')?.value || '').trim();
    if (/^[A-Za-z0-9]{16}$/.test(v)) { kit.keys.set(K.key, v); render(); refresh(); }
  }
}

function css() {
  const s = document.createElement('style');
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
    #tmt.tmt-docked { bottom: auto; }
    #tmt { position: fixed; left: 10px; bottom: 10px; z-index: 99999; width: 300px; max-width: calc(100vw - 20px);
      font: 12px Arial, sans-serif; color: var(--default-color, #ddd); color-scheme: dark;
      background: var(--default-bg-panel-color, #333); border-radius: 5px; box-shadow: 0 2px 12px rgba(0,0,0,.6); }
    #tmt .tmt-head { display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 30px; cursor: pointer; user-select: none;
      border-radius: 5px; font-weight: bold; color: #fff; text-shadow: 0 0 2px #000;
      background: var(--title-black-gradient, linear-gradient(180deg, #555 0%, #333 100%)); }
    #tmt .tmt-pill { margin-left: auto; font-weight: normal; color: var(--default-content-title-color, #bbb); }
    #tmt .tmt-body { max-height: 70vh; overflow-y: auto; padding: 4px 0 6px;
      scrollbar-width: thin; scrollbar-color: var(--appheader-dropdown-list-scrollbar-thumb-color, #666) var(--appheader-dropdown-list-scrollbar-track-color, #222); }
    #tmt .tmt-body::-webkit-scrollbar { width: 6px; }
    #tmt .tmt-body::-webkit-scrollbar-track { background: var(--appheader-dropdown-list-scrollbar-track-color, #222); }
    #tmt .tmt-body::-webkit-scrollbar-thumb { background: var(--appheader-dropdown-list-scrollbar-thumb-color, #666); border-radius: 3px; }
    #tmt .tmt-sec { padding: 6px 10px 3px; font-weight: bold; color: var(--default-content-title-color, #999); text-transform: uppercase; font-size: 10px; letter-spacing: .5px; }
    #tmt a { color: var(--default-blue-color, #74c0fc); text-decoration: none; }
    #tmt .tmt-tip { display: block; margin: 3px 10px; padding: 5px 8px; border-radius: 4px; line-height: 1.35;
      background: var(--default-bg-panel-active-color, #444); border-left: 3px solid #888; color: var(--default-color, #ddd); }
    #tmt .tmt-tip.go { border-left-color: var(--default-green-color, #82c91e); }
    #tmt .tmt-tip.warn { border-left-color: var(--default-orange-color, #f08c00); }
    #tmt .tmt-tip.note { background: none; border-left-color: var(--panel-border-bottom-color, #555); color: var(--default-content-title-color, #aaa); padding: 3px 8px; }
    #tmt .tmt-tip.route { padding: 6px 8px 4px; }
    #tmt .tmt-rt { font-weight: bold; margin-bottom: 4px; }
    #tmt .tmt-rt small { font-weight: normal; color: var(--default-content-title-color, #999); font-size: 10px; margin-left: 4px; }
    #tmt .tmt-stop { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto 30px; gap: 6px; align-items: baseline; padding: 1px 0; }
    #tmt .tmt-stop span { color: var(--default-content-title-color, #999); font-variant-numeric: tabular-nums; }
    #tmt .tmt-stop b { font-weight: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #tmt .tmt-stop em { font-style: normal; color: var(--default-content-title-color, #999); font-size: 11px; }
    #tmt .tmt-stop i { font-style: normal; font-size: 10px; text-align: right; color: var(--default-green-color, #82c91e); }
    #tmt .tmt-stop.now b { font-weight: bold; }
    #tmt a.tmt-tip:hover { background: var(--default-bg-panel-hover-color, #555); }
    #tmt .tmt-row { display: grid; grid-template-columns: minmax(0, 1fr) 112px; align-items: center; gap: 2px 8px; padding: 5px 10px; color: inherit;
      border-bottom: 1px solid var(--panel-border-bottom-color, #3b3b3b); }
    #tmt .tmt-row:hover { background: var(--default-bg-panel-active-color, #444); }
    #tmt .tmt-name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #tmt .tmt-where, #tmt .tmt-sub { color: var(--default-content-title-color, #999); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
    #tmt .tmt-hp { position: relative; height: 14px; background: #1a1a1a; border-radius: 3px; overflow: hidden; }
    #tmt .tmt-hp i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(180deg, #8bc34a, #5a8a1e); }
    #tmt .tmt-hp b { position: relative; display: block; text-align: center; font-size: 10px; line-height: 14px; color: #fff; text-shadow: 0 0 2px #000; }
    #tmt .tmt-dead { opacity: .5; }
    #tmt .tmt-foot { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; padding: 6px 10px 0; font-size: 11px; color: var(--default-content-title-color, #999); }
    #tmt .tmt-foot > :last-child { white-space: nowrap; }
    #tmt .tmt-foot a.on { color: var(--default-green-color, #82c91e); }
    #tmt .tmt-key { padding: 8px 10px; line-height: 1.6; }
    #tmt input { width: 150px; color: var(--input-color, #fff); background: var(--input-background-color, linear-gradient(0deg, #111 0%, #000 100%));
      border: 1px solid var(--input-border-color, #444); border-radius: 5px; padding: 3px 6px; outline: none; font: inherit; }
    #tmt input:focus { border-color: var(--input-focus-border-color, #1864ab80); }
    #tmt input::placeholder { color: var(--input-disabled-color, #666); }
    #tmt .tmt-btn { display: inline-block; margin-left: 4px; padding: 3px 10px; border-radius: 5px; font-weight: bold;
      color: var(--btn-color, #eee); text-shadow: 0 0 5px #000; background: var(--btn-background, linear-gradient(180deg, #555 0%, #333 100%));
      border: 1px solid var(--btn-border-color, #222); }
  `;
  document.head.appendChild(s);
}

function init() {
  if (document.getElementById('tmt')) return;
  css();
  root = document.createElement('div');
  root.id = 'tmt';
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
  access: 'minimal',
  start(k) {
    kit = k;
    init();
  },
};
})();

// ---- occ-kit/shell/standalone.js
// Standalone shell: one plug-in as its own userscript, outside the Command Center.
// start(kit) runs as soon as the page is ready. A plug-in with mount() also gets a small window
// (same look as the Command Center, no tab bar) opened by a floating button, or by its own page
// button when it defines launcher(kit, toggle). When the Command Center on this page already
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
  let win, title, sub, statsRow, main, rerun, gear;
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
    rerun.hidden = false;
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
    rerun.hidden = true;
    gear.classList.add('occ-act');
    fillStats(statsRow, null);
    const wrap = el('div');
    const c1 = el('div', 'occ-card');
    keyField(c1, { key: KEY_TORN, title: 'Torn API key', placeholder: 'Torn API key (' + (p.access || 'minimal') + ' access)', saved: 'Key saved in Tampermonkey storage, used only for Torn API calls from your browser.', empty: tornKey() ? 'Using the key Torn PDA filled in.' : 'No key yet. Needs ' + (p.access || 'minimal') + ' access.' });
    wrap.appendChild(c1);
    if (p.ai) {
      const c2 = el('div', 'occ-card');
      keyField(c2, { key: KEY_OR, title: 'OpenRouter key (AI)', placeholder: 'sk-or-v1-...', saved: 'Key saved in Tampermonkey storage. Only free models are called; they may log what is sent.', empty: 'Optional, for AI answers. Only free OpenRouter models are ever called with it.' });
      wrap.appendChild(c2);
    }
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
      if (!tornKey()) showSetup();
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
    sub = el('span', 'occ-sub', '');
    head.appendChild(sub);
    rerun = headButton(SOLO_ICON.refresh, 'Refresh', () => openPlugin(true));
    head.appendChild(rerun);
    gear = headButton(SOLO_ICON.gear, 'Setup', () => (view === 'setup' ? openPlugin(false) : showSetup()));
    head.appendChild(gear);
    head.appendChild(headButton('&times;', 'Close', () => setOpen(false)));
    win.appendChild(head);
    statsRow = el('div', 'occ-stats');
    win.appendChild(statsRow);
    main = el('div', 'occ-main occ-scroll');
    win.appendChild(main);
    root.appendChild(win);
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
    injectTheme(root, '#' + rootId, (p.mount ? frameCss('#' + rootId) : '') + (p.css || ''));
    document.body.appendChild(root);
    if (typeof p.start === 'function') p.start(kit);
    if (typeof p.mount === 'function') buildWindow(root);
  }

  const go = () => setTimeout(build, SOLO_WAIT);
  if (document.body) go();
  else document.addEventListener('DOMContentLoaded', go);
}

boot([PLUGIN_0]);
})();
