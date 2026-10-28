// ==UserScript==
// @name         Operational Command Center
// @namespace    Torn.Operational-Command-Center
// @version      0.7.16
// @description  One floating dashboard inside Torn. Buttons come from the repo's skills: each hands its skill file to a free OpenRouter model, the model runs the skill on a Cloudflare runner with your Torn key, and the result lands in the content pane. Mobile first, works in Torn PDA.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      openrouter.ai
// @connect      raw.githubusercontent.com
// @connect      occ-runner.yoonutz.workers.dev
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.7.16';
  const KEY_OPEN = 'occ.open';
  const KEY_SKILL = 'occ.skill';
  const KEY_OR = 'occ.or_key';
  const KEY_ANS = 'occ.ans.';
  const KEY_TORN = 'occ.torn_key';
  const KEY_SKILLS = 'occ.skills';
  const PDA_KEY = '###PDA-APIKEY###';
  const OWNER_ID = '2805199';
  const RUNNER = 'https://occ-runner.yoonutz.workers.dev';
  const RAW = 'https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/';
  const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL = 'openrouter/free';
  const FALLBACK = ['cohere/north-mini-code:free', 'google/gemma-4-26b-a4b-it:free'];
  const ATTEMPTS = 3;
  const MAX_STEPS = 4;
  const TIMEOUT_MS = 45000;
  const STALE_MS = 12 * 3600 * 1000;
  // Company trains pill (next to the OCC icon). Torn adds the daily trains with the company
  // update at ~18:05 TCT (UTC, no DST), so one call just after that, a 12h safety net,
  // a call after training on the company page, or on click.
  const KEY_TRAINS = 'occ.trains';
  const KEY_TRAINS_LOCK = 'occ.trains.lock';
  const TRAINS_URL = 'https://api.torn.com/v2/company/profile';
  const TRAINS_MAX = 20;
  const TRAINS_GRANT = (18 * 60 + 7) * 60000; // 18:07 TCT, as ms after UTC midnight
  const TRAINS_SAFETY = 12 * 3600 * 1000;
  const TRAINS_RETRY = 10 * 60000;
  const TRAINS_AFTER_TRAIN = 4000;
  const TRAINS_COOLDOWN = 30000;
  const TRAINS_LOCK_MS = 30000;
  const TRAINS_ERR = {
    1: 'Torn key is empty',
    2: 'Torn key is invalid',
    5: 'Rate limited, try again later',
    8: 'IP temporarily blocked by Torn',
    13: 'Key paused: owner inactive',
    16: 'Key access level too low (needs Limited or higher)',
    18: 'Key paused by its owner',
  };
  const TRAINS_STOP = [1, 2, 16, 18];
  let trains = null;
  let trainsBusy = false;
  let trainsTimer = 0;

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

  // Keys live in Tampermonkey's own storage: clearing torn.com site data, logging out or
  // Torn wiping its localStorage no longer loses them, and other scripts on the page cannot
  // read them. Torn PDA keeps localStorage (it fills the Torn key itself). Keys saved by
  // older versions in localStorage move over on first read, once the copy is confirmed.
  function hasGM() {
    return typeof GM_getValue === 'function' && typeof GM_setValue === 'function' && !isPda();
  }

  const keys = {
    get(k) {
      if (hasGM()) {
        try {
          const v = GM_getValue(k, '');
          if (typeof v === 'string' && v) return v;
        } catch (e) {}
      }
      const old = store.get(k, '');
      if (old && hasGM() && keys.gmSet(k, old)) store.del(k);
      return old;
    },
    gmSet(k, v) {
      try {
        GM_setValue(k, v);
        return GM_getValue(k, '') === v;
      } catch (e) {
        return false;
      }
    },
    set(k, v) {
      if (hasGM() && keys.gmSet(k, v)) store.del(k);
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

  const CSS = `
    #occ-root,#occ-root *{box-sizing:border-box}
    :where(#occ-root) button{font-family:Verdana,Arial,sans-serif;line-height:1.2;margin:0;padding:0;border:0;background:none;color:inherit;text-shadow:none;text-transform:none;letter-spacing:normal;appearance:none;-webkit-appearance:none;outline:none;cursor:pointer;-webkit-tap-highlight-color:transparent;height:auto;min-height:0;width:auto;min-width:0;max-width:none;box-shadow:none;text-indent:0;border-radius:0;float:none}
    :where(#occ-root) button:focus-visible{box-shadow:0 0 0 2px rgba(242,193,78,.5)}
    :where(#occ-root) p,:where(#occ-root) ul,:where(#occ-root) ol,:where(#occ-root) h3,:where(#occ-root) pre{margin:0;padding:0;font-family:inherit}
    .occ-launch{position:fixed;right:16px;bottom:88px;z-index:99990;width:52px;height:52px;border-radius:50%;border:1px solid #3a3a3a;background:#1f1f1f;color:#f2c14e;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.55);user-select:none}
    .occ-launch.occ-hide{display:none}
    .occ-launch:active{transform:scale(.95)}
    .occ-launch svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    button.occ-inline{all:unset;box-sizing:border-box;position:relative;z-index:5;display:inline-flex!important;align-items:center;justify-content:center;width:18px;height:18px;min-width:18px;min-height:18px;margin:0 0 0 6px;padding:0;border:0;border-radius:4px;background:transparent;color:#f2c14e;vertical-align:middle;cursor:pointer;flex:none;overflow:visible;text-indent:0;font-size:0;line-height:0;-webkit-tap-highlight-color:transparent}
    button.occ-inline>svg{display:block;width:16px!important;height:16px!important;fill:none!important;stroke:#f2c14e!important;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:1;visibility:visible}
    button.occ-inline:active{transform:scale(.9)}
    button.occ-inline:focus-visible{box-shadow:0 0 0 2px rgba(242,193,78,.5)}
    .occ-win{position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99991;display:none;grid-template-rows:44px auto 1fr 54px;grid-template-areas:"head" "stats" "main" "tabs";background:#191919;background-color:#191919;color:#d9d9d9;font:13px/1.5 Verdana,Arial,sans-serif;overflow:hidden;text-align:left;color-scheme:dark;border:1px solid #2f2f2f;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.65)}
    .occ-win.occ-on{display:grid}
    .occ-head{grid-area:head;display:flex;align-items:center;gap:8px;padding:0 8px 0 14px;border-bottom:1px solid #2f2f2f;min-width:0}
    .occ-title{font-weight:700;font-size:14px;color:#fff;white-space:nowrap}
    .occ-ver{font:10px Consolas,Menlo,monospace;color:#6e6e6e}
    .occ-sub{flex:1;min-width:0;font:11px Consolas,Menlo,monospace;color:#f2c14e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
    .occ-x{width:32px;height:32px;flex:none;border:1px solid #3a3a3a;border-radius:6px;background:#1f1f1f;color:#d9d9d9;display:flex;align-items:center;justify-content:center;font-size:16px}
    .occ-x:active{background:#2a2a2a}
    .occ-stats{grid-area:stats;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 12px 4px;min-width:0}
    .occ-stats:empty{display:none;padding:0}
    .occ-stat{background:#1f1f1f;border:1px solid #2f2f2f;border-radius:8px;padding:7px 9px;min-width:0}
    .occ-stat .k{font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:#8c8c8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .occ-stat .v{font:700 15px/1.3 Consolas,Menlo,monospace;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .occ-stat .v small{font-size:9px;color:#8c8c8c;font-weight:400}
    .occ-stat.occ-hot{border-color:#4c5f3a}
    .occ-stat.occ-hot .v{color:#b9e39c}
    .occ-main{grid-area:main;overflow-x:hidden;overflow-y:auto;padding:10px 12px 70px;min-width:0;position:relative;-webkit-overflow-scrolling:touch;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-color:#3a3a3a transparent}
    .occ-main::-webkit-scrollbar{width:8px}
    .occ-main::-webkit-scrollbar-track{background:transparent}
    .occ-main::-webkit-scrollbar-thumb{background:#333;border-radius:4px;border:2px solid #191919}
    .occ-main::-webkit-scrollbar-thumb:hover{background:#454545}
    .occ-main>*{max-width:100%}
    .occ-meta{display:flex;align-items:center;gap:8px;margin:2px 0 10px;font:10.5px Consolas,Menlo,monospace;color:#8c8c8c;min-width:0}
    .occ-meta .occ-m{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .occ-meta .occ-dot{color:#7fbf5f}
    .occ-fab{position:fixed;z-index:99992;right:14px;bottom:68px;width:42px;height:42px;border-radius:50%;background:#f2c14e;color:#191919;display:none;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.5)}
    .occ-win.occ-on ~ .occ-fab{display:flex}
    .occ-fab:active{transform:scale(.93)}
    .occ-fab.occ-busy{opacity:.45;pointer-events:none}
    .occ-fab svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
    .occ-acc{border:1px solid #2f2f2f;border-radius:8px;margin-bottom:9px;overflow:hidden;background:#1c1c1c}
    .occ-acc-bar{width:100%;display:flex;align-items:center;gap:8px;padding:9px 11px;background:#1f1f1f;font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#f2c14e;text-align:left}
    .occ-acc-bar .occ-n{margin-left:auto;flex:none;background:#2a2a2a;color:#d9d9d9;border-radius:999px;font:600 9.5px Consolas,monospace;padding:2px 8px;letter-spacing:0}
    .occ-acc-bar .occ-car{flex:none;color:#6e6e6e;font-size:9px;transition:transform .15s}
    .occ-acc.occ-shut .occ-acc-bar .occ-car{transform:rotate(-90deg)}
    .occ-acc-body{padding:9px 11px;border-top:1px solid #2a2a2a}
    .occ-acc.occ-shut .occ-acc-body{display:none}
    .occ-card{background:#1f1f1f;border:1px solid #2f2f2f;border-radius:8px;padding:11px;margin-bottom:9px;min-width:0;max-width:100%}
    .occ-card h3{margin:0 0 7px;font-size:11px;color:#f2c14e;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
    .occ-muted{color:#8c8c8c;font-size:11.5px}
    .occ-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#8c8c8c;text-align:center;gap:6px}
    .occ-err{background:#2a1c1c;border-color:#5a3030;color:#e8b4b4}
    .occ-err h3{color:#e05f5f}
    .occ-spin{display:inline-block;width:13px;height:13px;border:2px solid #3a3a3a;border-top-color:#f2c14e;border-radius:50%;animation:occspin .8s linear infinite;vertical-align:-2px;margin-right:8px}
    @keyframes occspin{to{transform:rotate(360deg)}}
    .occ-bar{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap;min-width:0}
    .occ-act-btn{height:30px;padding:0 12px;border-radius:6px;flex:none;white-space:nowrap;border:1px solid #f2c14e;background:transparent;color:#f2c14e;font:600 11px Verdana,Arial,sans-serif;display:inline-flex;align-items:center;gap:6px}
    .occ-act-btn.occ-alt{border-color:#3a3a3a;color:#a8a8a8}
    .occ-act-btn:active{transform:scale(.97)}
    .occ-act-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-field{display:block;width:100%;height:36px;padding:0 10px;margin:7px 0 2px;border:1px solid #3a3a3a;border-radius:6px;background:#161616;color:#d9d9d9;font:12px/1 Consolas,Menlo,monospace;outline:none;appearance:none;-webkit-appearance:none;color-scheme:dark}
    .occ-field:focus{border-color:#f2c14e;box-shadow:0 0 0 2px rgba(242,193,78,.2)}
    .occ-field::-ms-reveal,.occ-field::-ms-clear{display:none}
    .occ-field:-webkit-autofill,.occ-field:-webkit-autofill:hover,.occ-field:-webkit-autofill:focus{-webkit-box-shadow:0 0 0 40px #161616 inset;-webkit-text-fill-color:#d9d9d9;caret-color:#d9d9d9;transition:background-color 9999s}
    .occ-meta .occ-old{color:#f2c14e}
    .occ-cancel{margin-left:auto}
    .occ-tabs{grid-area:tabs;display:flex;border-top:1px solid #2f2f2f;background:#161616}
    .occ-tab{flex:1;min-width:0;align-self:stretch;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:7px 2px 9px;font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#8c8c8c;user-select:none}
    .occ-tab svg{width:19px;height:19px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-tab span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .occ-tab.occ-act{color:#f2c14e}
    .occ-tab:active{transform:scale(.96)}
    .occ-md{font-size:12.5px;line-height:1.55;overflow-wrap:anywhere;word-break:break-word;min-width:0}
    .occ-md>:first-child{margin-top:0}
    .occ-md>:last-child{margin-bottom:0}
    .occ-md h1,.occ-md h2,.occ-md h3,.occ-md h4{margin:12px 0 5px;color:#f2c14e;font-size:11px;font-weight:700;line-height:1.3;text-transform:uppercase;letter-spacing:.08em}
    .occ-md p{margin:7px 0}
    .occ-md ul{margin:7px 0;padding-left:18px;list-style:disc outside}
    .occ-md ol{margin:7px 0;padding-left:20px;list-style:decimal outside}
    .occ-md li{display:list-item;margin:4px 0;padding-left:2px}
    .occ-md li::marker{color:#f2c14e}
    .occ-md code{background:#161616;border:1px solid #2a2a2a;border-radius:4px;padding:1px 4px;font:11.5px/1.4 Consolas,Menlo,monospace;color:#e6d9b8;overflow-wrap:anywhere}
    .occ-md pre{background:#161616;border:1px solid #2a2a2a;border-radius:6px;padding:8px 10px;margin:7px 0;max-width:100%;overflow:hidden;font:11.5px/1.55 Consolas,Menlo,monospace;color:#e6d9b8;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
    @media (max-width:420px){.occ-md pre{font-size:10.5px}}
    .occ-md pre code{border:0;padding:0;background:transparent;color:inherit}
    .occ-md strong{color:#fff;font-weight:700}
    .occ-md em{color:#bdbdbd}
    .occ-md hr{border:0;border-top:1px solid #2a2a2a;margin:10px 0}
    .occ-trains{all:unset;box-sizing:border-box;position:relative;display:inline-flex!important;align-items:center;flex:none;height:13px;margin:0 0 0 3px;padding:0 3px;background:#1f1f1f;border:1px solid #3a3a3a;border-radius:3px;font:700 9px/1 Verdana,Arial,sans-serif;color:#8a8a8a;white-space:nowrap;vertical-align:middle;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}
    .occ-trains .n{color:#d6d6d6}
    .occ-trains .s{margin:0 2px;font-weight:400;color:#8a8a8a}
    .occ-trains .m{font-weight:400;color:#8a8a8a}
    .occ-trains .s,.occ-trains .m{display:none}
    .occ-dock .occ-trains .s,.occ-dock .occ-trains .m,.occ-trains.occ-float .s,.occ-trains.occ-float .m{display:inline}
    .occ-trains.hot{border-color:#6b5a26}
    .occ-trains.hot .n{color:#f2c14e}
    .occ-trains.full{border-color:#7a2f2b}
    .occ-trains.full .n{color:#e5534b}
    .occ-trains.stale{opacity:.55}
    .occ-trains.occ-none{display:none!important}
    .occ-trains.busy{animation:occ-tpulse 1s ease-in-out infinite}
    @keyframes occ-tpulse{50%{opacity:.35}}
    .occ-dock{display:flex;align-items:center;justify-content:flex-start;box-sizing:border-box;width:100%;margin:0;padding:3px 12px 0;background:transparent;pointer-events:none;position:relative;z-index:1}
    .occ-dock .occ-inline{pointer-events:auto;margin:0 0 0 2px}
    .occ-dock .occ-trains{pointer-events:auto;margin:0 0 0 6px;height:16px;padding:0 6px;font-size:11px}
    .occ-trains.occ-float{position:fixed;right:16px;bottom:146px;margin:0;z-index:99990}
    .occ-tip{position:fixed;z-index:2147483600;display:none;pointer-events:none;max-width:260px;padding:6px 9px;background:#111;border:1px solid #3a3a3a;border-radius:4px;font:400 11px/1.4 Verdana,Arial,sans-serif;color:#d6d6d6;box-shadow:0 4px 14px rgba(0,0,0,.55);text-align:left}
    .occ-toast{position:fixed;z-index:2147483600;display:none;max-width:260px;padding:7px 10px;background:#111;border:1px solid #3a3a3a;border-left:3px solid #f2c14e;border-radius:4px;font:400 11px/1.4 Verdana,Arial,sans-serif;color:#d6d6d6;box-shadow:0 4px 14px rgba(0,0,0,.55);cursor:pointer;text-align:left}
    .occ-toast.bad{border-left-color:#e5534b}
    @media (min-width:768px){
      .occ-launch{bottom:24px;right:24px}
      .occ-win{top:auto;left:auto;right:24px;bottom:88px;width:420px;height:640px;max-height:calc(100vh - 112px);border:1px solid #2f2f2f;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
      .occ-fab{right:38px;bottom:158px}
      .occ-trains.occ-float{bottom:84px;right:24px}
    }
  `;

  const ICON = {
    dash: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12v.01"/><path d="M19.071 4.929c-1.562-1.562-6 .337-9.9 4.243c-3.905 3.905-5.804 8.337-4.242 9.9c1.562 1.561 6-.338 9.9-4.244c3.905-3.905 5.804-8.337 4.242-9.9"/><path d="M4.929 4.929c-1.562 1.562.337 6 4.243 9.9c3.905 3.905 8.337 5.804 9.9 4.242c1.561-1.562-.338-6-4.244-9.9c-3.905-3.905-8.337-5.804-9.9-4.242"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  };

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  function mdToHtml(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    let list = null;
    let para = [];
    let fence = null;
    const flushPara = () => {
      if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    };
    const closeList = () => {
      if (list) out.push('</' + list + '>');
      list = null;
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
    flushPara();
    closeList();
    return out.join('');
  }

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

  function http(opt) {
    const method = opt.method || 'GET';
    const headers = opt.headers || {};
    const timeout = opt.timeout || TIMEOUT_MS;
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

  function host(url) {
    return String(url).replace(/^https?:\/\//, '').split('/')[0];
  }

  async function fetchText(url) {
    const r = await http({ url });
    if (r.status < 200 || r.status >= 300) throw new Error('GET ' + url.split('/').pop() + ' -> HTTP ' + r.status);
    return r.text;
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return {};
    }
  }

  const CANCELLED = 'Cancelled.';

  function checkStop(run) {
    if (run && run.stopped) throw new Error(CANCELLED);
  }

  function pause(ms, run) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (run) run.wake = () => (clearTimeout(t), reject(new Error(CANCELLED)));
    });
  }

  async function chat(messages, tools, run) {
    const key = keys.get(KEY_OR);
    if (!key) throw new Error('No OpenRouter key. Open Setup and paste one.');
    const errors = [];
    for (let i = 0; i < ATTEMPTS; i++) {
      checkStop(run);
      // Busy free models: wait a little longer before each new try.
      if (i) await pause(2000 * i, run);
      try {
        const body = { model: MODEL, models: FALLBACK, temperature: 0.1, messages };
        if (tools) body.tools = tools;
        const res = await http({
          method: 'POST',
          url: OR_URL,
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Operational Command Center' },
          body: JSON.stringify(body),
        });
        const json = parseJson(res.text);
        if (res.status === 401) throw new Error('OpenRouter rejected the key (401).');
        const msg = json && json.choices && json.choices[0] && json.choices[0].message;
        const hasTool = msg && msg.tool_calls && msg.tool_calls.length;
        const hasText = msg && msg.content && String(msg.content).trim();
        if (res.status >= 200 && res.status < 300 && msg && (hasTool || hasText)) return { msg, model: json.model || MODEL };
        errors.push('try ' + (i + 1) + ': ' + res.status + ' ' + ((json.error && json.error.message) || 'empty reply'));
      } catch (e) {
        if (/401/.test(String(e.message)) || e.message === CANCELLED) throw e;
        errors.push('try ' + (i + 1) + ': ' + e.message);
      }
    }
    throw new Error('Free models busy, try again in a minute.\n' + errors.join('\n'));
  }

  function tornKey() {
    const k = keys.get(KEY_TORN);
    if (k) return k;
    return PDA_KEY.indexOf('PDA-APIKEY') === -1 ? PDA_KEY : '';
  }

  async function runTool(s, args) {
    const token = tornKey();
    if (!token) throw new Error('No Torn API token. Open Setup and paste it.');
    const url = RUNNER + s.tool.path + (args && args.force ? 'force=1' : '');
    const r = await http({ url, headers: { Authorization: 'ApiKey ' + token } });
    const json = parseJson(r.text);
    if (r.status === 401) throw new Error(json.error || 'Torn rejected the API token (401).');
    if (r.status < 200 || r.status >= 300 || json.error) throw new Error('Runner: ' + (json.error || 'HTTP ' + r.status));
    return json;
  }

  // One script run per button press: the model can ask for the tool again, but it gets the
  // same result instead of a second round of Torn calls. Rerun with fresh data is the
  // amber button's job, never the model's.
  async function agent(s, md, onStatus, force, run) {
    const tools = [{ type: 'function', function: { name: s.tool.name, description: s.tool.description, parameters: { type: 'object', properties: {} } } }];
    const messages = [
      { role: 'system', content: md },
      { role: 'user', content: "Run this skill now and deliver its output exactly as the skill's delivery rule says. Use the " + s.tool.name + ' tool to execute the scripts; you cannot run anything yourself. Plain hyphens only.' },
    ];
    let raw = null;
    let model = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      onStatus(step === 0 ? 'Sending the skill to a free model...' : 'Model is writing the answer...');
      const r = await chat(messages, tools, run);
      checkStop(run);
      model = r.model;
      messages.push(r.msg);
      const calls = r.msg.tool_calls || [];
      if (calls.length) {
        onStatus('Model is running the script on the runner...');
        for (const tc of calls) {
          const out = raw || (await runTool(s, { force }));
          checkStop(run);
          raw = out;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ report: out.report, date: out.date, baseline: out.baseline, snapshots: out.snapshots, reused: out.reused }) });
        }
        continue;
      }
      if (!raw) {
        onStatus('Model skipped the tool; running the script directly...');
        raw = await runTool(s, { force });
        checkStop(run);
        messages.push({ role: 'user', content: 'Here is the output of ' + s.tool.name + ', run for you just now. Deliver it per the skill rules.\n\n' + raw.report });
        continue;
      }
      return { text: String(r.msg.content).trim(), model, raw };
    }
    if (raw) return { text: raw.report, model: 'runner (model gave no answer)', raw };
    throw new Error('The model never produced an answer.');
  }

  let skills = (store.get(KEY_SKILLS, []) || []).map(fromRunner);

  function fromRunner(r) {
    return {
      id: r.id,
      label: r.label,
      icon: safeIcon(r.icon) || '<span style="font:700 15px Verdana">' + esc(String(r.label || '?').charAt(0)) + '</span>',
      md: r.md,
      access: r.access || 'full',
      tool: { name: 'run_script', path: '/run/' + r.id + '?', description: r.description || "Runs this skill's script on the runner and returns its printed output." },
    };
  }

  // The runner's icon lands on torn.com as markup: accept only a plain inline <svg>.
  function safeIcon(svg) {
    const s = String(svg || '').trim();
    if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return '';
    if (/<(script|foreignObject|iframe|image|use|a)[\s>]|\son\w+\s*=|javascript:|href\s*=/i.test(s)) return '';
    return s;
  }

  async function loadSkills() {
    try {
      const r = await http({ url: RUNNER + '/skills' });
      const json = parseJson(r.text);
      if (r.status !== 200 || !Array.isArray(json.skills)) return false;
      store.set(KEY_SKILLS, json.skills);
      skills = json.skills.map(fromRunner);
      renderTabs();
      return true;
    } catch (e) {
      return false;
    }
  }

  let win, main, sub, launch, tabs, statsRow, fab;
  const btns = {};
  const inflight = {};

  function setActive(id) {
    Object.keys(btns).forEach((k) => btns[k].classList.toggle('occ-act', k === id));
    fab.style.display = id && id !== 'settings' && win.classList.contains('occ-on') ? 'flex' : 'none';
  }

  function show(node) {
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
  }

  function setStats(list) {
    statsRow.innerHTML = '';
    if (!Array.isArray(list) || !list.length) return;
    statsRow.style.gridTemplateColumns = 'repeat(' + Math.min(list.length, 3) + ',1fr)';
    list.slice(0, 3).forEach((x) => {
      const c = el('div', 'occ-stat' + (x.hot ? ' occ-hot' : ''));
      c.appendChild(el('div', 'k', esc(x.k)));
      c.appendChild(el('div', 'v', esc(x.v) + (x.unit ? '<small>' + esc(x.unit) + '</small>' : '')));
      statsRow.appendChild(c);
    });
  }

  function errCard(title, msg) {
    const c = el('div', 'occ-card occ-err');
    c.appendChild(el('h3', '', esc(title)));
    c.appendChild(el('div', '', esc(msg).replace(/\n/g, '<br>')));
    return c;
  }

  function accordion(title, node, opts) {
    const acc = el('div', 'occ-acc' + (opts && opts.shut ? ' occ-shut' : ''));
    const bar = el('button', 'occ-acc-bar');
    bar.type = 'button';
    bar.innerHTML = esc(title) + (opts && opts.badge ? '<span class="occ-n">' + esc(opts.badge) + '</span>' : '<span class="occ-n" style="display:none"></span>') + '<span class="occ-car">▼</span>';
    bar.addEventListener('click', () => acc.classList.toggle('occ-shut'));
    const body = el('div', 'occ-acc-body');
    body.appendChild(node);
    acc.appendChild(bar);
    acc.appendChild(body);
    return acc;
  }

  function answerView(s, a) {
    const wrap = el('div');
    const when = new Date(a.at);
    const shortModel = String(a.model || '').split('/').pop().replace(/:free$/, '');
    const today = new Date().toDateString() === when.toDateString();
    const stamp = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (today ? '' : ', ' + when.toLocaleDateString());
    const age = Date.now() - a.at;
    const old = age > STALE_MS ? ' · <span class="occ-old">' + Math.floor(age / 3600000) + 'h old</span>' : '';
    const meta = el('div', 'occ-meta', '<span class="occ-dot">●</span><span class="occ-m">' + esc(shortModel) + ' · ' + esc(stamp) + old + '</span>');
    meta.title = a.model + ' - ' + when.toLocaleString();
    wrap.appendChild(meta);
    setStats(a.stats);
    const sections = mdSections(a.text);
    if (!sections.length) sections.push({ title: null, body: a.text });
    sections.forEach((sec, i) => {
      const node = el('div', 'occ-md', mdToHtml(sec.body));
      const bullets = node.querySelectorAll('li').length;
      const title = sec.title || (i === 0 ? 'Summary' : 'More');
      wrap.appendChild(accordion(title, node, { badge: bullets > 2 ? String(bullets) : null }));
    });
    return wrap;
  }

  async function runSkill(id, force) {
    const s = skills.find((x) => x.id === id);
    if (!s) return;
    store.set(KEY_SKILL, id);
    main.dataset.ran = '1';
    setActive(id);
    sub.textContent = s.label.toLowerCase();
    const cached = store.get(KEY_ANS + id, null);
    if (cached && !force) {
      show(answerView(s, cached));
      return;
    }
    if (!keys.get(KEY_OR)) {
      showSettings('Paste an OpenRouter key first, then press ' + s.label + ' again.');
      return;
    }
    if (s.tool && !tornKey()) {
      showSettings('Paste your Torn API token first, then press ' + s.label + ' again.');
      return;
    }
    if (inflight[id]) {
      if (inflight[id].status) show(inflight[id].status);
      return;
    }
    const run = { stopped: false, wake: null };
    inflight[id] = run;
    fab.classList.add('occ-busy');
    setStats(null);
    const status = el('div', 'occ-card');
    const line = el('div', 'occ-bar');
    line.style.marginTop = '0';
    const text = el('span', '', '<span class="occ-spin"></span>Fetching the skill file...');
    const stop = el('button', 'occ-act-btn occ-alt occ-cancel', 'Cancel');
    stop.type = 'button';
    stop.addEventListener('click', () => {
      run.stopped = true;
      if (run.wake) run.wake();
      if (run.reject) run.reject(new Error(CANCELLED));
    });
    line.appendChild(text);
    line.appendChild(stop);
    status.appendChild(line);
    run.status = status;
    show(status);
    const onStatus = (t) => {
      if (!run.stopped) text.innerHTML = '<span class="occ-spin"></span>' + esc(t);
    };
    // Cancel answers at once; requests already on the wire finish in the background and are ignored.
    const cancelled = new Promise((_, reject) => (run.reject = reject));
    try {
      const md = await Promise.race([fetchText(s.md), cancelled]);
      const a = await Promise.race([agent(s, md, onStatus, !!force, run), cancelled]);
      const rec = { text: a.text, model: a.model, at: Date.now(), stats: a.raw ? a.raw.stats : null };
      store.set(KEY_ANS + id, rec);
      if (store.get(KEY_SKILL, null) === id) show(answerView(s, rec));
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (store.get(KEY_SKILL, null) !== id) {
        // Another skill is on screen now; nothing to repaint.
      } else if (msg === CANCELLED) {
        const prev = store.get(KEY_ANS + id, null);
        if (prev) show(answerView(s, prev));
        else show(el('div', 'occ-card occ-muted', 'Cancelled.'));
      } else show(errCard(s.label + ' failed', msg));
    } finally {
      inflight[id] = null;
      fab.classList.remove('occ-busy');
    }
  }

  function keyField(card, opts) {
    card.appendChild(el('h3', '', opts.title));
    const has = !!keys.get(opts.key);
    const st = el('div', 'occ-muted', has ? opts.saved : opts.empty);
    card.appendChild(st);
    const input = el('input', 'occ-field');
    input.type = 'password';
    input.placeholder = has ? 'Paste a new value to replace' : opts.placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    card.appendChild(input);
    const row = el('div', 'occ-bar');
    const save = el('button', 'occ-act-btn', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => {
      const v = input.value.trim();
      if (!v) return;
      keys.set(opts.key, v);
      input.value = '';
      st.textContent = opts.saved;
      input.placeholder = 'Paste a new value to replace';
    });
    const clear = el('button', 'occ-act-btn occ-alt', 'Forget');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      keys.del(opts.key);
      st.textContent = opts.empty;
      input.placeholder = opts.placeholder;
    });
    row.appendChild(save);
    row.appendChild(clear);
    card.appendChild(row);
  }

  function showSettings(note) {
    store.set(KEY_SKILL, 'settings');
    main.dataset.ran = '1';
    setActive('settings');
    sub.textContent = 'setup';
    setStats(null);
    const wrap = el('div');
    if (note) wrap.appendChild(el('div', 'occ-card occ-err', esc(note)));
    const c1 = el('div', 'occ-card');
    keyField(c1, { key: KEY_OR, title: 'OpenRouter key', placeholder: 'sk-or-v1-...', saved: 'Key saved in Tampermonkey storage. Skill reports (your money, networth, company numbers) go to free OpenRouter models, which may log them.', empty: 'No key yet; a free key is enough. Skill reports (your money, networth, company numbers) go to free OpenRouter models, which may log them.' });
    wrap.appendChild(c1);
    const c2 = el('div', 'occ-card');
    keyField(c2, { key: KEY_TORN, title: 'Torn API token', placeholder: 'Torn API key (full access)', saved: 'Token saved in Tampermonkey storage; sent to the runner per run, never stored there.', empty: tornKey() ? 'Using the key Torn PDA filled in.' : 'No token yet. The runner pulls your live numbers with it; it is never stored server side.' });
    wrap.appendChild(c2);
    const c3 = el('div', 'occ-card');
    c3.appendChild(el('h3', '', 'Answers'));
    const row = el('div', 'occ-bar');
    const wipe = el('button', 'occ-act-btn occ-alt', 'Clear cached answers');
    wipe.type = 'button';
    wipe.addEventListener('click', () => {
      skills.forEach((s) => store.del(KEY_ANS + s.id));
      wipe.textContent = 'Cleared';
    });
    row.appendChild(wipe);
    c3.appendChild(row);
    wrap.appendChild(c3);
    const info = el('div', 'occ-card');
    info.appendChild(el('h3', '', 'How it works'));
    info.appendChild(el('div', 'occ-muted', 'Tabs are the skills in the repo, listed by the runner. A tab fetches its skill file from GitHub and hands it to the free model router. The model calls the runner, which executes the skill script with your Torn API token, then delivers the result here. Router: ' + MODEL + '.'));
    wrap.appendChild(info);
    show(wrap);
  }

  function renderTabs() {
    if (!tabs) return;
    tabs.innerHTML = '';
    Object.keys(btns).forEach((k) => delete btns[k]);
    skills.forEach((s) => {
      const b = el('button', 'occ-tab', s.icon + '<span>' + esc(s.label) + '</span>');
      b.type = 'button';
      b.title = s.label + ' (needs a ' + s.access + ' key)';
      b.addEventListener('click', () => runSkill(s.id));
      btns[s.id] = b;
      tabs.appendChild(b);
    });
    const gear = el('button', 'occ-tab', ICON.gear + '<span>Setup</span>');
    gear.type = 'button';
    gear.addEventListener('click', () => showSettings());
    btns.settings = gear;
    tabs.appendChild(gear);
    const active = store.get(KEY_SKILL, null);
    if (active && btns[active] && main && main.dataset.ran) btns[active].classList.add('occ-act');
  }

  function setOpen(on) {
    win.classList.toggle('occ-on', on);
    store.set(KEY_OPEN, on);
    const cur = store.get(KEY_SKILL, null);
    fab.style.display = on && cur && cur !== 'settings' ? 'flex' : 'none';
    if (on && !main.dataset.ran) {
      if (cur === 'settings') showSettings();
      else if (cur && skills.some((s) => s.id === cur)) runSkill(cur);
    }
  }

  // Anchors we are willing to sit next to, best first. The first two are the desktop
  // sidebar, which Torn PDA does not render at all. The fallback below finds the Home
  // page "General Information" name row structurally, because Torn's class names there
  // are generated and cannot be relied on.
  // Torn's sidebar moved to camelCase hashed classes in 2026-10: <p class="menuInfoRow___x"><span>Name:</span>
  // <a class="menuValue___x" href="/profiles.php?XID=...">. The kebab-case ones are kept for the old layout.
  const NAME_ANCHORS = [
    'a[class*="menuValue"][href*="profiles.php"]',
    '[class*="menuInfoRow"] a[href*="profiles.php"]',
    '[class*="userInformation"] a[href*="profiles.php"]',
    '[class*="user-information"] a[href*="profiles.php"]',
    '[class*="menu-value"] a[href*="profiles.php"]',
  ];
  const MOBILE_INFO = '[class*="user-information-mobile"],[class*="userInformationMobile"]';

  // Home page fallback: the player's OWN name row in "General Information", found
  // structurally. Torn's class names there are generated, so instead: a profiles.php
  // link whose row label starts with "Name". Written without regex escapes on purpose -
  // a \b escape in this spot once got corrupted into literal backspace bytes, which
  // silently disabled the row check and mounted the icon next to any player link.
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
    const b = el('button', 'occ-inline', ICON.dash);
    b.type = 'button';
    b.title = 'Operational Command Center';
    return b;
  }

  function mountInline() {
    const docked = document.querySelector('.occ-dock .occ-inline');
    if (docked && useDock(docked) && placeDock(docked)) {
      launch.classList.add('occ-hide');
      return true;
    }
    const a = nameAnchor();
    if (!a || !a.parentNode) {
      // Phone layout: the dock hangs off the icons block or the page title, not the
      // name link, so it still mounts when Torn drops or moves the name link.
      if (useDock(null) && placeDock(inlineButton())) {
        launch.classList.add('occ-hide');
        return true;
      }
      // Nothing to hang on: keep the floating launcher visible so the panel is always
      // reachable. Never hide it without a mount.
      launch.classList.remove('occ-hide');
      placeFloatTrains();
      return false;
    }
    const have = docked || a.parentNode.querySelector('.occ-inline');
    if (have) {
      launch.classList.add('occ-hide');
      placeTrains(have);
      return true;
    }
    const b = inlineButton();
    // Torn appends badges (donator star, awards) right after the name link. Ionuț wants
    // only his icon there, so on his own name those badges are hidden and the button takes
    // their spot. Everyone else keeps their badges.
    let ref = a;
    const mine = new URLSearchParams(a.search || '').get('XID') === OWNER_ID;
    while (mine && ref.nextElementSibling && !ref.nextElementSibling.matches('button,.occ-inline,a') && ref.nextElementSibling.getBoundingClientRect().width <= 24) {
      ref = ref.nextElementSibling;
      ref.style.display = 'none';
    }
    a.insertAdjacentElement('afterend', b);
    launch.classList.add('occ-hide');
    placeTrains(b);
    return true;
  }

  // ---- Company trains pill -------------------------------------------------
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

  function trainsTail(k) {
    return String(k).slice(-4);
  }

  // Latest 18:07 TCT at or before now.
  function lastGrant(now) {
    const day = 86400000;
    const g = Math.floor(now / day) * day + TRAINS_GRANT;
    return g <= now ? g : g - day;
  }

  // When the next automatic refresh is due (ms timestamp), or Infinity when it never is.
  function trainsNext(c, key) {
    if (!c || typeof c.tried !== 'number' || c.kh !== trainsTail(key)) return 0;
    if (c.bad) return Infinity;
    if (c.none) return c.tried + 86400000;
    const now = Date.now();
    if (c.tried < lastGrant(now)) return 0;
    let at = Math.min(lastGrant(now) + 86400000, c.tried + TRAINS_SAFETY);
    if (c.retry) at = Math.min(at, c.tried + TRAINS_RETRY);
    return at;
  }

  function trainsDue(c, key) {
    return Date.now() >= trainsNext(c, key);
  }

  function scheduleTrains() {
    clearTimeout(trainsTimer);
    const key = tornKey();
    if (!key) return;
    const at = trainsNext(store.get(KEY_TRAINS, null), key);
    if (at === Infinity) return;
    // Cap the wait so a sleeping laptop or throttled tab re-checks reasonably soon.
    const wait = Math.min(Math.max(5000, at - Date.now()), 3600000);
    trainsTimer = setTimeout(() => {
      // Hidden tab: no call now; the visibility handler catches up when the tab is back.
      if (document.hidden) return;
      fetchTrains(false).then(scheduleTrains);
    }, wait);
  }

  function trainsTip() {
    const t = trains || {};
    if (t.nokey) return 'Company trains · ' + t.err;
    const parts = ['Company trains' + (typeof t.n === 'number' ? ' ' + t.n + ' / ' + TRAINS_MAX : '')];
    parts.push(typeof t.ts === 'number' ? 'refreshed ' + hhmm(t.ts) + ' (' + ago(t.ts) + ')' : 'not refreshed yet');
    if (t.err) parts.push(t.err);
    if (typeof t.n === 'number' && t.n >= TRAINS_MAX) parts.push('FULL: daily trains are being lost');
    const key = tornKey();
    const at = key ? trainsNext(t, key) : Infinity;
    if (at !== Infinity) parts.push('next ' + hhmm(Math.max(Date.now(), at)));
    parts.push('click to refresh');
    return parts.join(' · ');
  }

  function paintTrains() {
    const has = !!trains && typeof trains.n === 'number';
    const n = has ? trains.n : -1;
    const html = '<span class="n">' + (has ? n : '?') + '</span><span class="s">/</span><span class="m">' + TRAINS_MAX + '</span>';
    const tip = trainsTip();
    document.querySelectorAll('.occ-trains').forEach((p) => {
      p.classList.toggle('full', n >= TRAINS_MAX);
      p.classList.toggle('hot', n > 0 && n < TRAINS_MAX);
      p.classList.toggle('stale', !has || !!(trains && trains.err));
      p.classList.toggle('busy', trainsBusy);
      p.classList.toggle('occ-none', !!(trains && trains.none));
      if (p.innerHTML !== html) p.innerHTML = html;
      if (p.getAttribute('data-tip') !== tip) p.setAttribute('data-tip', tip);
    });
    if (tipEl && tipEl.style.display === 'block') tipEl.textContent = tip;
  }

  let toastEl = null;
  let toastTimer = 0;
  let toastWatch = 0;
  let toastUntil = 0;
  let toastBound = false;
  let tipEl = null;

  // Boxes live in #occ-root (a direct child of body, fixed, top z-index) so Torn's own
  // panels and its sidebar stacking context can never cover them.
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

  function showTrainsTip(p) {
    const root = document.getElementById('occ-root');
    if (!root) return;
    if (!tipEl || !tipEl.isConnected) {
      tipEl = el('div', 'occ-tip');
      root.appendChild(tipEl);
    }
    tipEl.textContent = trainsTip();
    tipEl.style.display = 'block';
    placeBox(tipEl, p);
  }

  function hideTrainsTip() {
    if (tipEl) tipEl.style.display = 'none';
  }

  // Small message next to the pill: what the click did, or why it did not work.
  function trainsToast(text, bad, pill) {
    const root = document.getElementById('occ-root');
    const anchor = pill || document.querySelector('.occ-trains');
    if (!root || !anchor) return;
    if (!toastEl || !toastEl.isConnected) {
      toastEl = el('div', 'occ-toast');
      toastEl.addEventListener('click', hideToast);
      root.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.toggle('bad', !!bad);
    toastEl.style.setProperty('display', 'block', 'important');
    placeBox(toastEl, anchor);
    // Disappears on its own: a timer, plus a watchdog that re-checks the deadline, plus any
    // tap or click outside the message.
    const ms = bad ? 8000 : 3500;
    toastUntil = Date.now() + ms;
    clearTimeout(toastTimer);
    clearInterval(toastWatch);
    toastTimer = setTimeout(hideToast, ms);
    toastWatch = setInterval(() => {
      if (Date.now() >= toastUntil) hideToast();
    }, 400);
    if (!toastBound) {
      toastBound = true;
      document.addEventListener(
        'pointerdown',
        (e) => {
          if (toastEl && toastEl.style.display !== 'none' && !(e.target && e.target.closest && e.target.closest('.occ-trains'))) hideToast();
        },
        true
      );
    }
  }

  function hideToast() {
    clearTimeout(toastTimer);
    clearInterval(toastWatch);
    if (toastEl) toastEl.style.setProperty('display', 'none', 'important');
  }

  async function fetchTrains(manual, pill, force) {
    const say = (t, bad) => {
      if (manual) trainsToast(t, bad, pill);
    };
    if (trainsBusy) {
      say('Still refreshing. Give it a few seconds.');
      return;
    }
    const key = tornKey();
    const cur = store.get(KEY_TRAINS, null);
    if (!key) {
      trains = Object.assign({}, cur || {}, { nokey: true, err: 'Set your Torn key in Setup' });
      paintTrains();
      say('No Torn key yet. Open the Command Center, tap Setup and paste your key.', true);
      return;
    }
    const kh = trainsTail(key);
    const now = Date.now();
    const same = !!cur && cur.kh === kh;
    if (manual) {
      if (same && now - cur.tried < TRAINS_COOLDOWN) {
        const last = typeof cur.n === 'number' && !cur.err ? cur.n + ' / ' + TRAINS_MAX : cur.err || 'no value yet';
        say('Refreshed ' + Math.round((now - cur.tried) / 1000) + 's ago (' + last + '). You can refresh again in ' + Math.ceil((TRAINS_COOLDOWN - (now - cur.tried)) / 1000) + 's.', !!cur.err);
        return;
      }
    } else {
      if (!force && !trainsDue(cur, key)) {
        trains = cur;
        paintTrains();
        return;
      }
      // Another Torn tab is already fetching: skip, the storage event will bring its result.
      if (now - store.get(KEY_TRAINS_LOCK, 0) < TRAINS_LOCK_MS) return;
    }
    store.set(KEY_TRAINS_LOCK, now);
    trainsBusy = true;
    paintTrains();
    say('Refreshing…');
    const rec = { n: same ? cur.n : undefined, ts: same ? cur.ts : undefined, tried: now, kh: kh };
    let net = false;
    try {
      const r = await http({ url: TRAINS_URL, headers: { Authorization: 'ApiKey ' + key, Accept: 'application/json' }, timeout: 20000 });
      let j = null;
      try {
        j = JSON.parse(r.text);
      } catch (e) {}
      if (j && j.error && (j.error.code === 6 || j.error.code === 7)) {
        // Not in a company (wrong ID / ID-entity relation): same as not a director.
        rec.none = true;
      } else if (j && j.error) {
        const code = j.error.code;
        rec.err = TRAINS_ERR[code] || 'Torn error ' + code + (j.error.error ? ': ' + j.error.error : '');
        if (TRAINS_STOP.indexOf(code) !== -1) rec.bad = true;
        if (code === 5) rec.retry = true;
      } else if (j && j.profile && typeof j.profile.trains === 'number') {
        rec.n = j.profile.trains;
        rec.ts = Date.now();
      } else if (j && j.profile) {
        // Not a company director: hide the pill and only look again once a day.
        rec.none = true;
      } else {
        rec.err = 'Unexpected reply from Torn (HTTP ' + r.status + '): ' + String(r.text || '').slice(0, 60);
      }
    } catch (e) {
      net = true;
      rec.retry = true;
      rec.err = 'Refresh failed: ' + (e && e.message ? e.message : 'error');
    } finally {
      trainsBusy = false;
      store.set(KEY_TRAINS, rec);
      store.del(KEY_TRAINS_LOCK);
      trains = rec;
      paintTrains();
      scheduleTrains();
    }
    if (rec.err) {
      say(rec.err + (net ? '. If Tampermonkey asked about api.torn.com, choose Always allow, then click again.' : ''), true);
    } else if (rec.none) {
      say('No company trains: this key is not a company director.');
    } else {
      say('Company trains: ' + rec.n + ' / ' + TRAINS_MAX + (rec.n >= TRAINS_MAX ? '. Full: daily trains are being lost.' : '.'));
    }
  }

  function makeTrainsPill(floating) {
    const p = el('span', 'occ-trains' + (floating ? ' occ-float' : ''));
    p.setAttribute('role', 'button');
    p.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTrainsTip();
      fetchTrains(true, p);
    });
    p.addEventListener('mouseenter', () => showTrainsTip(p));
    p.addEventListener('mouseleave', hideTrainsTip);
    return p;
  }

  function isPda() {
    return typeof window.PDA_httpGet === 'function' || /TornPDA/i.test(navigator.userAgent || '');
  }

  // Phone-sized Torn layout (PDA or mobile browser): icons row is crowded, so use the fixed slot.
  function useDock(btn) {
    return isPda() || window.innerWidth <= 768 || !!(btn && btn.closest(MOBILE_INFO));
  }

  // The mobile money + icons block. 2026-10 markup: swiperWrapper___ > [div.points-mobile___, ul.statusIcons___.mobile___],
  // so when the block's own class is unknown, take the swiper's parent (one more step up if that is a swiper too).
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

  // Torn PDA: no room beside the icon, so the pill gets its own fixed slot on every page,
  // right under the status icons line and above the page title.
  function placeDock(btn) {
    // Real Torn mobile markup: div.content > [div.areas (nav), div.user-information-mobile (money + icons swiper)],
    // then the page. The icons <ul> sits in a horizontal swiper, so the dock must go AFTER the whole block.
    const um = mobileInfo(btn);
    let anchor = um && um.parentNode ? { node: um, where: 'afterend' } : null;
    if (!anchor) {
      const title = document.querySelector('.content-wrapper > .content-title') || document.querySelector('.content-title');
      if (title) anchor = { node: title, where: 'beforebegin' };
    }
    if (!anchor) {
      const row = btn.closest('[class*="status-icons"],[class*="statusIcons"]') || btn.closest('ul,ol') || btn.parentNode;
      if (!row || !row.parentNode || row === document.body) return false;
      anchor = { node: row, where: 'afterend' };
    }
    const sib = anchor.where === 'beforebegin' ? anchor.node.previousElementSibling : anchor.node.nextElementSibling;
    let dock = sib && sib.classList.contains('occ-dock') ? sib : null;
    let p = dock ? dock.querySelector('.occ-trains') : null;
    if (!p) {
      if (dock) dock.remove();
      dock = el('div', 'occ-dock');
      p = makeTrainsPill(false);
      dock.appendChild(p);
      anchor.node.insertAdjacentElement(anchor.where, dock);
    }
    // Icon and pill live together in the dock, left-aligned (the icons row has no room for them).
    if (btn.parentNode !== dock) dock.insertBefore(btn, p);
    document.querySelectorAll('.occ-inline').forEach((x) => {
      if (x !== btn) x.remove();
    });
    document.querySelectorAll('.occ-trains').forEach((x) => {
      if (x !== p) x.remove();
    });
    document.querySelectorAll('.occ-dock').forEach((d) => {
      if (d !== dock) d.remove();
    });
    paintTrains();
    return true;
  }

  function placeTrains(btn) {
    if (useDock(btn) && placeDock(btn)) return;
    let p = btn.nextElementSibling;
    if (!p || !p.classList.contains('occ-trains') || p.classList.contains('occ-float')) {
      p = makeTrainsPill(false);
      btn.insertAdjacentElement('afterend', p);
    }
    const par = btn.parentNode;
    if (par && par.style && par.style.whiteSpace !== 'nowrap') par.style.whiteSpace = 'nowrap';
    document.querySelectorAll('.occ-trains').forEach((x) => {
      if (x !== p) x.remove();
    });
    paintTrains();
  }

  // No name row on this page (PDA etc.): small pill above the floating launcher.
  function placeFloatTrains() {
    if (document.querySelector('.occ-trains')) return;
    const root = document.getElementById('occ-root');
    if (!root) return;
    root.appendChild(makeTrainsPill(true));
    paintTrains();
  }

  function startTrains() {
    trains = store.get(KEY_TRAINS, null);
    paintTrains();
    if (!document.hidden) fetchTrains(false).then(scheduleTrains);
    // Background tabs get their timers throttled: check again when the tab comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') fetchTrains(false).then(scheduleTrains);
    });
    addEventListener('storage', (e) => {
      if (e.key !== KEY_TRAINS) return;
      trains = store.get(KEY_TRAINS, null);
      paintTrains();
      scheduleTrains();
    });
    // Training an employee spends trains: refresh a few seconds after the last Train click
    // on the company page (the wait also covers the confirm step).
    let trainedTimer = 0;
    document.addEventListener(
      'click',
      (e) => {
        if (!/companies\.php/.test(location.pathname)) return;
        const b = e.target && e.target.closest ? e.target.closest('button,a,input[type="button"],input[type="submit"]') : null;
        if (!b || !/\btrain/i.test(b.textContent || b.value || '')) return;
        clearTimeout(trainedTimer);
        trainedTimer = setTimeout(() => {
          fetchTrains(false, null, true).then(scheduleTrains);
        }, TRAINS_AFTER_TRAIN);
      },
      true
    );
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
    // Torn's chat and timers change the page all the time: check at most once a second,
    // otherwise pages where the icon cannot mount rescan every profile link on each change.
    let moTimer = 0;
    const mo = new MutationObserver(() => {
      if (moTimer) return;
      moTimer = setTimeout(() => {
        moTimer = 0;
        if (!document.querySelector('.occ-inline') || !document.querySelector('.occ-trains')) mountInline();
      }, 1000);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Torn swaps pages client-side; re-check after each navigation.
    addEventListener('hashchange', mountInline);
    addEventListener('popstate', mountInline);
    // Rotating a tablet across the phone breakpoint: move icon and pill to the other layout.
    let phone = useDock(null);
    let rsTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(rsTimer);
      rsTimer = setTimeout(() => {
        if (useDock(null) === phone) return;
        phone = useDock(null);
        document.querySelectorAll('.occ-dock,.occ-inline,.occ-trains').forEach((x) => x.remove());
        mountInline();
      }, 300);
    });
  }

  function build() {
    if (document.getElementById('occ-root')) return;
    const root = el('div');
    root.id = 'occ-root';
    root.appendChild(el('style', '', CSS));

    launch = el('button', 'occ-launch', ICON.dash);
    launch.type = 'button';
    launch.title = 'Operational Command Center';
    launch.addEventListener('click', () => setOpen(!win.classList.contains('occ-on')));
    root.appendChild(launch);

    win = el('div', 'occ-win');
    const head = el('div', 'occ-head');
    head.appendChild(el('span', 'occ-title', 'Command Center'));
    head.appendChild(el('span', 'occ-ver', 'v' + VERSION));
    sub = el('span', 'occ-sub', '');
    head.appendChild(sub);
    const x = el('button', 'occ-x', '&times;');
    x.type = 'button';
    x.addEventListener('click', () => setOpen(false));
    head.appendChild(x);
    win.appendChild(head);

    statsRow = el('div', 'occ-stats');
    win.appendChild(statsRow);

    main = el('div', 'occ-main');
    main.appendChild(el('div', 'occ-empty', '<div>Pick a skill below.</div><div class="occ-muted">' + (skills.length ? skills.length + ' available' : 'loading skills...') + '</div>'));
    win.appendChild(main);

    tabs = el('div', 'occ-tabs');
    win.appendChild(tabs);
    root.appendChild(win);

    fab = el('button', 'occ-fab', ICON.refresh);
    fab.type = 'button';
    fab.title = 'Run again with fresh data';
    fab.style.display = 'none';
    fab.addEventListener('click', () => {
      const cur = store.get(KEY_SKILL, null);
      if (cur && cur !== 'settings') runSkill(cur, true);
    });
    root.appendChild(fab);

    renderTabs();
    document.body.appendChild(root);
    if (store.get(KEY_OPEN, false)) setOpen(true);
    watchName();
    startTrains();
    loadSkills().then((ok) => {
      const empty = main.querySelector('.occ-empty .occ-muted');
      if (empty) empty.textContent = ok ? skills.length + ' available' : skills.length ? skills.length + ' available (offline list)' : 'runner unreachable';
    });
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
