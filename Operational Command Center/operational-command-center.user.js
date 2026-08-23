// ==UserScript==
// @name         Operational Command Center
// @namespace    Torn.Operational-Command-Center
// @version      0.6.0
// @description  One floating dashboard inside Torn. Buttons come from the repo's skills: each hands its skill file to a free OpenRouter model, the model runs the skill on a Cloudflare runner with your Torn key, and the result lands in the content pane. Mobile first, works in Torn PDA.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      openrouter.ai
// @connect      raw.githubusercontent.com
// @connect      occ-runner.yoonutz.workers.dev
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.6.0';
  const KEY_OPEN = 'occ.open';
  const KEY_SKILL = 'occ.skill';
  const KEY_OR = 'occ.or_key';
  const KEY_ANS = 'occ.ans.';
  const KEY_TORN = 'occ.torn_key';
  const KEY_SKILLS = 'occ.skills';
  const PDA_KEY = '###' + 'PDA-APIKEY' + '###';
  const RUNNER = 'https://occ-runner.yoonutz.workers.dev';
  const RAW = 'https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/';
  const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL = 'openrouter/free';
  const FALLBACK = ['z-ai/glm-5.2:free', 'cohere/north-mini-code:free', 'google/gemma-4-26b-a4b-it:free'];
  const ATTEMPTS = 3;
  const MAX_STEPS = 4;
  const TIMEOUT_MS = 90000;

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

  const CSS = `
    #occ-root,#occ-root *{box-sizing:border-box}
    :where(#occ-root) button{font-family:Verdana,Arial,sans-serif;line-height:1.2;margin:0;padding:0;border:0;background:none;color:inherit;text-shadow:none;text-transform:none;letter-spacing:normal;appearance:none;-webkit-appearance:none;outline:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
    :where(#occ-root) button:focus-visible{box-shadow:0 0 0 2px rgba(242,193,78,.5)}
    :where(#occ-root) p,:where(#occ-root) ul,:where(#occ-root) ol,:where(#occ-root) h3,:where(#occ-root) pre{margin:0;padding:0;font-family:inherit}
    .occ-launch{position:fixed;right:16px;bottom:88px;z-index:99990;width:52px;height:52px;border-radius:50%;border:1px solid #3a3a3a;background:#1f1f1f;color:#f2c14e;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.55);user-select:none}
    .occ-launch.occ-hide{display:none}
    .occ-launch:active{transform:scale(.95)}
    .occ-launch svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-inline{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:6px;border-radius:4px;background:transparent;color:#f2c14e;vertical-align:middle}
    .occ-inline svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
    .occ-inline:active{transform:scale(.9)}
    .occ-win{position:fixed;inset:0;z-index:99991;display:none;grid-template-rows:44px auto 1fr 54px;grid-template-areas:"head" "stats" "main" "tabs";background:#191919;color:#d9d9d9;font:13px/1.5 Verdana,Arial,sans-serif;overflow:hidden;text-align:left;color-scheme:dark}
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
    .occ-main{grid-area:main;overflow:hidden auto;padding:10px 12px 70px;min-width:0;position:relative;-webkit-overflow-scrolling:touch;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-color:#3a3a3a transparent}
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
    .occ-tabs{grid-area:tabs;display:flex;border-top:1px solid #2f2f2f;background:#161616}
    .occ-tab{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:7px 2px 9px;font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#8c8c8c;user-select:none}
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
    @media (min-width:768px){
      .occ-launch{bottom:24px;right:24px}
      .occ-win{inset:auto 24px 88px auto;width:420px;height:640px;max-height:calc(100vh - 112px);border:1px solid #2f2f2f;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
      .occ-fab{right:38px;bottom:158px}
    }
  `;

  const ICON = {
    dash: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
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

  async function chat(messages, tools) {
    const key = store.get(KEY_OR, '');
    if (!key) throw new Error('No OpenRouter key. Open Setup and paste one.');
    const errors = [];
    for (let i = 0; i < ATTEMPTS; i++) {
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
        if (/401/.test(String(e.message))) throw e;
        errors.push('try ' + (i + 1) + ': ' + e.message);
      }
    }
    throw new Error('Free models busy, try again in a minute.\n' + errors.join('\n'));
  }

  function tornKey() {
    const k = store.get(KEY_TORN, '');
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

  async function agent(s, md, onStatus) {
    const tools = [{ type: 'function', function: { name: s.tool.name, description: s.tool.description, parameters: { type: 'object', properties: { force: { type: 'boolean', description: 'Re-collect live data even if a fresh snapshot exists' } } } } }];
    const messages = [
      { role: 'system', content: md },
      { role: 'user', content: "Run this skill now and deliver its output exactly as the skill's delivery rule says. Use the " + s.tool.name + ' tool to execute the scripts; you cannot run anything yourself. Plain hyphens only.' },
    ];
    let raw = null;
    let model = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      onStatus(step === 0 ? 'Sending the skill to a free model...' : 'Model is writing the answer...');
      const r = await chat(messages, tools);
      model = r.model;
      messages.push(r.msg);
      const calls = r.msg.tool_calls || [];
      if (calls.length) {
        onStatus('Model is running the script on the runner...');
        for (const tc of calls) {
          const args = parseJson(tc.function && tc.function.arguments);
          const out = await runTool(s, args);
          raw = out;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ report: out.report, date: out.date, baseline: out.baseline, snapshots: out.snapshots, reused: out.reused }) });
        }
        continue;
      }
      if (!raw) {
        onStatus('Model skipped the tool; running the script directly...');
        raw = await runTool(s, {});
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
      icon: r.icon || '<span style="font:700 15px Verdana">' + esc(String(r.label || '?').charAt(0)) + '</span>',
      md: r.md,
      tool: { name: 'run_script', path: '/run/' + r.id + '?', description: r.description || "Runs this skill's script on the runner and returns its printed output." },
    };
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
    const meta = el('div', 'occ-meta', '<span class="occ-dot">●</span><span class="occ-m">' + esc(shortModel) + ' · ' + esc(stamp) + '</span>');
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
    if (a.report && a.report.trim() !== a.text.trim()) {
      wrap.appendChild(accordion('Exact script output', el('div', 'occ-md', mdToHtml(a.report)), { shut: true }));
    }
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
    if (!store.get(KEY_OR, '')) {
      showSettings('Paste an OpenRouter key first, then press ' + s.label + ' again.');
      return;
    }
    if (s.tool && !tornKey()) {
      showSettings('Paste your Torn API token first, then press ' + s.label + ' again.');
      return;
    }
    if (inflight[id]) return;
    inflight[id] = true;
    fab.classList.add('occ-busy');
    setStats(null);
    const status = el('div', 'occ-card', '<span class="occ-spin"></span>Fetching the skill file...');
    show(status);
    const onStatus = (t) => {
      status.innerHTML = '<span class="occ-spin"></span>' + esc(t);
    };
    try {
      const md = await fetchText(s.md);
      const a = await agent(s, md, onStatus);
      const rec = { text: a.text, model: a.model, at: Date.now(), report: a.raw ? a.raw.report : null, date: a.raw ? a.raw.date : null, stats: a.raw ? a.raw.stats : null };
      store.set(KEY_ANS + id, rec);
      if (store.get(KEY_SKILL, null) === id) show(answerView(s, rec));
    } catch (e) {
      if (store.get(KEY_SKILL, null) === id) show(errCard(s.label + ' failed', String((e && e.message) || e)));
    } finally {
      inflight[id] = false;
      fab.classList.remove('occ-busy');
    }
  }

  function keyField(card, opts) {
    card.appendChild(el('h3', '', opts.title));
    const has = !!store.get(opts.key, '');
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
      store.set(opts.key, v);
      input.value = '';
      st.textContent = opts.saved;
      input.placeholder = 'Paste a new value to replace';
    });
    const clear = el('button', 'occ-act-btn occ-alt', 'Forget');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      store.del(opts.key);
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
    keyField(c1, { key: KEY_OR, title: 'OpenRouter key', placeholder: 'sk-or-v1-...', saved: 'Key saved in this browser only.', empty: 'No key yet. Free models only; the key never leaves this browser.' });
    wrap.appendChild(c1);
    const c2 = el('div', 'occ-card');
    keyField(c2, { key: KEY_TORN, title: 'Torn API token', placeholder: 'Torn API key (full access)', saved: 'Token saved in this browser only; sent to the runner per run, never stored there.', empty: tornKey() ? 'Using the key Torn PDA filled in.' : 'No token yet. The runner pulls your live numbers with it; it is never stored server side.' });
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
      b.title = s.label;
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

  function nameAnchor() {
    return document.querySelector('[class*="user-information"] a[href*="profiles.php"]') || document.querySelector('[class*="menu-value"] a[href*="profiles.php"]');
  }

  function mountInline() {
    const a = nameAnchor();
    if (!a || !a.parentNode) return false;
    if (a.parentNode.querySelector('.occ-inline')) return true;
    const b = el('button', 'occ-inline', ICON.dash);
    b.type = 'button';
    b.title = 'Operational Command Center';
    a.insertAdjacentElement('afterend', b);
    launch.classList.add('occ-hide');
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
    const mo = new MutationObserver(() => {
      if (!document.querySelector('.occ-inline')) mountInline();
    });
    mo.observe(document.body, { childList: true, subtree: true });
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
    loadSkills().then((ok) => {
      const empty = main.querySelector('.occ-empty .occ-muted');
      if (empty) empty.textContent = ok ? skills.length + ' available' : skills.length ? skills.length + ' available (offline list)' : 'runner unreachable';
    });
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
