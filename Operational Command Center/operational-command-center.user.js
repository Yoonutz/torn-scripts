// ==UserScript==
// @name         Operational Command Center
// @namespace    Torn.Operational-Command-Center
// @version      0.4.1
// @description  One floating dashboard inside Torn. Each sidebar button hands its skill file to a free OpenRouter model; the model runs the skill's script on a private Cloudflare runner and delivers the result in the content pane. Mobile first, works in Torn PDA.
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

  const VERSION = '0.4.1';
  const KEY_OPEN = 'occ.open';
  const KEY_SKILL = 'occ.skill';
  const KEY_OR = 'occ.or_key';
  const KEY_ANS = 'occ.ans.';
  const KEY_TORN = 'occ.torn_key';
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
    .occ-launch{position:fixed;right:16px;bottom:88px;z-index:99990;width:52px;height:52px;border-radius:50%;border:1px solid #3c3c3c;background:#1f1f1f;color:#e6e6e6;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.55);font:600 11px/1 Arial,sans-serif;letter-spacing:.5px;-webkit-tap-highlight-color:transparent;user-select:none}
    .occ-launch.occ-hide{display:none}
    .occ-launch:active{transform:scale(.95)}
    .occ-inline{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:6px;padding:0;border:0;border-radius:4px;background:transparent;color:#7cb342;cursor:pointer;vertical-align:middle;-webkit-tap-highlight-color:transparent}
    .occ-inline svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
    .occ-inline:active{transform:scale(.9)}
    .occ-launch svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-win{position:fixed;inset:0;z-index:99991;display:none;grid-template-rows:48px 1fr;grid-template-columns:56px 1fr;grid-template-areas:"head head" "side main";background:#181818;color:#e6e6e6;font:14px/1.4 Arial,sans-serif;overflow:hidden;text-align:left}
    .occ-win.occ-on{display:grid}
    .occ-head{grid-area:head;display:flex;align-items:center;gap:10px;padding:0 8px 0 14px;background:#222;border-bottom:1px solid #333}
    .occ-title{font-weight:700;font-size:15px;white-space:nowrap}
    .occ-ver{font-size:11px;color:#8a8a8a}
    .occ-sub{flex:1;font-size:12px;color:#9fd37c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
    .occ-x{width:36px;height:36px;border-radius:8px;border:1px solid #3c3c3c;background:#2a2a2a;color:#e6e6e6;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;line-height:1;-webkit-tap-highlight-color:transparent}
    .occ-x:active{background:#383838}
    .occ-side{grid-area:side;display:flex;flex-direction:column;gap:6px;padding:8px 5px;background:#202020;border-right:1px solid #333;overflow:hidden auto;box-sizing:border-box}
    .occ-btn{width:44px;height:44px;flex:none;border-radius:10px;border:1px solid #3c3c3c;background:#2a2a2a;color:#bdbdbd;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;font-size:9px;letter-spacing:.3px;text-transform:uppercase;-webkit-tap-highlight-color:transparent;user-select:none}
    .occ-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-btn.occ-act{background:#2f4a1f;border-color:#5f9a3a;color:#d6f2c2}
    .occ-btn.occ-gear{margin-top:auto}
    .occ-btn:active{transform:scale(.95)}
    .occ-main{grid-area:main;overflow-y:auto;padding:12px;-webkit-overflow-scrolling:touch}
    .occ-main::-webkit-scrollbar,.occ-side::-webkit-scrollbar{width:6px}
    .occ-main::-webkit-scrollbar-thumb,.occ-side::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
    .occ-card{background:#222;border:1px solid #333;border-radius:10px;padding:12px;margin-bottom:10px}
    .occ-card h3{margin:0 0 8px;font-size:13px;color:#9fd37c;text-transform:uppercase;letter-spacing:.5px}
    .occ-muted{color:#8a8a8a;font-size:12px}
    .occ-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#8a8a8a;text-align:center;gap:6px}
    .occ-err{background:#3a1f1f;border-color:#7a3a3a;color:#f2c2c2}
    .occ-spin{display:inline-block;width:14px;height:14px;border:2px solid #555;border-top-color:#9fd37c;border-radius:50%;animation:occspin .8s linear infinite;vertical-align:-2px;margin-right:8px}
    @keyframes occspin{to{transform:rotate(360deg)}}
    .occ-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
    .occ-bar .occ-muted{flex:1;min-width:120px}
    .occ-act-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid #5f9a3a;background:#2f4a1f;color:#d6f2c2;font:600 12px Arial,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent}
    .occ-act-btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .occ-act-btn.occ-alt{border-color:#3c3c3c;background:#2a2a2a;color:#bdbdbd}
    .occ-act-btn:active{transform:scale(.97)}
    .occ-field{display:block;width:100%;box-sizing:border-box;height:38px;padding:0 10px;margin:6px 0 10px;border:1px solid #3c3c3c;border-radius:8px;background:#151515;color:#e6e6e6;font:13px/1 monospace;outline:none;appearance:none;-webkit-appearance:none;color-scheme:dark}
    .occ-field:focus{border-color:#5f9a3a;box-shadow:0 0 0 2px rgba(95,154,58,.25)}
    .occ-md{font-size:13px;line-height:1.5;word-break:break-word}
    .occ-md h1,.occ-md h2,.occ-md h3,.occ-md h4{margin:12px 0 6px;color:#9fd37c;font-size:13px;text-transform:uppercase;letter-spacing:.5px}
    .occ-md h1{font-size:15px}
    .occ-md p{margin:6px 0}
    .occ-md ul,.occ-md ol{margin:6px 0;padding-left:20px}
    .occ-md li{margin:2px 0}
    .occ-md code{background:#151515;border:1px solid #333;border-radius:4px;padding:1px 4px;font:12px monospace}
    .occ-md pre{background:#151515;border:1px solid #333;border-radius:8px;padding:8px;overflow-x:auto;font:12px/1.4 monospace;white-space:pre}
    .occ-md pre code{border:0;padding:0;background:transparent}
    .occ-md strong{color:#fff}
    .occ-md hr{border:0;border-top:1px solid #333;margin:10px 0}
    @media (min-width:768px){
      .occ-launch{bottom:24px;right:24px}
      .occ-win{inset:auto 24px 88px auto;width:420px;height:640px;max-height:calc(100vh - 112px);border:1px solid #3c3c3c;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
    }
  `;

  const ICON = {
    dash: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    ledger: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
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
    if (!key) throw new Error('No OpenRouter key. Open Setup (gear) and paste one.');
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
    if (!token) throw new Error('No Torn API token. Open Setup (gear) and paste it.');
    const url = RUNNER + s.tool.path + (args && args.force ? '&force=1' : '');
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

  const skills = [
    {
      id: 'ledger',
      label: 'Ledger',
      icon: ICON.ledger,
      md: RAW + '.claude/skills/torn-ledger/SKILL.md',
      tool: {
        name: 'run_script',
        path: '/run/ledger?ai=0',
        description: "Runs this skill's scripts (collect, then report) on the private runner with live Torn data and returns the printed markdown report plus date, baseline date and snapshot count.",
      },
    },
  ];

  let win, main, sub, launch;
  const btns = {};
  const inflight = {};

  function setActive(id) {
    Object.keys(btns).forEach((k) => btns[k].classList.toggle('occ-act', k === id));
  }

  function show(node) {
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
  }

  function errCard(title, msg) {
    const c = el('div', 'occ-card occ-err');
    c.appendChild(el('h3', '', esc(title)));
    c.appendChild(el('div', '', esc(msg).replace(/\n/g, '<br>')));
    return c;
  }

  function answerView(s, a) {
    const wrap = el('div');
    const bar = el('div', 'occ-bar');
    const when = new Date(a.at);
    bar.appendChild(el('span', 'occ-muted', esc(a.model) + ' - ' + when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    const again = el('button', 'occ-act-btn', ICON.refresh + 'Run again');
    again.type = 'button';
    again.addEventListener('click', () => runSkill(s.id, true));
    bar.appendChild(again);
    wrap.appendChild(bar);
    const card = el('div', 'occ-card');
    card.appendChild(el('div', 'occ-md', mdToHtml(a.text)));
    wrap.appendChild(card);
    if (a.report && a.report.trim() !== a.text.trim()) {
      const rawCard = el('div', 'occ-card');
      const tog = el('button', 'occ-act-btn occ-alt', 'Show exact script output');
      tog.type = 'button';
      const body = el('div', 'occ-md');
      body.style.display = 'none';
      body.style.marginTop = '10px';
      body.appendChild(el('div', '', mdToHtml(a.report)));
      tog.addEventListener('click', () => {
        const on = body.style.display === 'none';
        body.style.display = on ? '' : 'none';
        tog.textContent = on ? 'Hide exact script output' : 'Show exact script output';
      });
      rawCard.appendChild(tog);
      rawCard.appendChild(body);
      wrap.appendChild(rawCard);
    }
    return wrap;
  }

  async function runSkill(id, force) {
    const s = skills.find((x) => x.id === id);
    if (!s) return;
    store.set(KEY_SKILL, id);
    main.dataset.ran = '1';
    setActive(id);
    sub.textContent = s.label;
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
    const status = el('div', 'occ-card', '<span class="occ-spin"></span>Fetching the skill file...');
    show(status);
    const onStatus = (t) => {
      status.innerHTML = '<span class="occ-spin"></span>' + esc(t);
    };
    try {
      const md = await fetchText(s.md);
      const a = await agent(s, md, onStatus);
      const rec = { text: a.text, model: a.model, at: Date.now(), report: a.raw ? a.raw.report : null, date: a.raw ? a.raw.date : null };
      store.set(KEY_ANS + id, rec);
      if (store.get(KEY_SKILL, null) === id) show(answerView(s, rec));
    } catch (e) {
      if (store.get(KEY_SKILL, null) === id) show(errCard(s.label + ' failed', String((e && e.message) || e)));
    } finally {
      inflight[id] = false;
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
    sub.textContent = 'Setup';
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
    const wipe = el('button', 'occ-act-btn occ-alt', 'Clear cached answers');
    wipe.type = 'button';
    wipe.addEventListener('click', () => {
      skills.forEach((s) => store.del(KEY_ANS + s.id));
      wipe.textContent = 'Cleared';
    });
    c3.appendChild(wipe);
    wrap.appendChild(c3);
    const info = el('div', 'occ-card');
    info.appendChild(el('h3', '', 'How it works'));
    info.appendChild(el('div', 'occ-muted', 'A button fetches its skill file from GitHub and hands it to the free model router. The model calls the runner, which executes the skill scripts with your Torn API token, then the model delivers the result here. Router: ' + MODEL + ', fallbacks: ' + FALLBACK.join(', ') + '.'));
    wrap.appendChild(info);
    show(wrap);
  }

  function setOpen(on) {
    win.classList.toggle('occ-on', on);
    store.set(KEY_OPEN, on);
    if (on && !main.dataset.ran) {
      const last = store.get(KEY_SKILL, null);
      if (last === 'settings') showSettings();
      else if (last && skills.some((s) => s.id === last)) runSkill(last);
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

    const side = el('div', 'occ-side');
    skills.forEach((s) => {
      const b = el('button', 'occ-btn', s.icon + '<span>' + esc(s.label) + '</span>');
      b.type = 'button';
      b.addEventListener('click', () => runSkill(s.id));
      btns[s.id] = b;
      side.appendChild(b);
    });
    const gear = el('button', 'occ-btn occ-gear', ICON.gear + '<span>Setup</span>');
    gear.type = 'button';
    gear.addEventListener('click', () => showSettings());
    btns.settings = gear;
    side.appendChild(gear);
    win.appendChild(side);

    main = el('div', 'occ-main');
    main.appendChild(el('div', 'occ-empty', '<div>Pick a skill on the left.</div><div class="occ-muted">' + skills.length + ' available</div>'));
    win.appendChild(main);
    root.appendChild(win);

    document.body.appendChild(root);
    if (store.get(KEY_OPEN, false)) setOpen(true);
    watchName();
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
