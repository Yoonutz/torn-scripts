// ==UserScript==
// @name         OCC Loader Probe
// @namespace    Torn.OCC-Loader-Probe
// @version      1.0.0
// @description  One-off test: can this browser fetch script code from GitHub, keep it and run it? Tap the probe pill, screenshot the result, then uninstall. Makes no Torn requests.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_info
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

// Tests what a "thin loader" Command Center would need: fetch code from GitHub, store it, compile
// and run it. Only GitHub is contacted, and only when the pill is tapped. Nothing on Torn is
// requested, read or clicked.
(function () {
  'use strict';

  const RAW = 'https://raw.githubusercontent.com/Yoonutz/torn-scripts/main/';
  const BIG = RAW + 'Operational%20Command%20Center/operational-command-center.user.js';
  const SMALL = RAW + 'occ-kit/package.json';
  const csp = [];
  document.addEventListener('securitypolicyviolation', (e) => csp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));

  const isPda = typeof window.PDA_httpGet === 'function' || /TornPDA/i.test(navigator.userAgent || '');
  const hasGmXhr = typeof GM_xmlhttpRequest === 'function';
  const hasGmStore = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 30000,
        onload: (r) => resolve({ status: r.status, text: r.responseText || '' }),
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }
  function pdaGet(url) {
    return Promise.resolve(window.PDA_httpGet(url, {})).then((r) => ({
      status: (r && (r.status || r.statusCode)) || 200,
      text: (r && (r.responseText || r.body || r.text)) || (typeof r === 'string' ? r : ''),
    }));
  }
  function plainGet(url) {
    return fetch(url, { cache: 'no-cache' }).then(async (r) => ({ status: r.status, text: await r.text() }));
  }

  async function step(name, fn) {
    const t0 = performance.now();
    try {
      const v = await fn();
      return { name, ok: v !== false, note: (v === true || v === false ? '' : String(v)) + ' ' + Math.round(performance.now() - t0) + ' ms' };
    } catch (e) {
      return { name, ok: false, note: String((e && e.message) || e).slice(0, 120) };
    }
  }

  async function run() {
    const out = [];
    const env = (typeof GM_info === 'object' && GM_info && GM_info.scriptHandler ? GM_info.scriptHandler + ' ' + (GM_info.version || '') : 'unknown manager') + (isPda ? ' / Torn PDA' : '');
    out.push({ name: 'Manager', ok: true, note: env });

    out.push(await step('eval', () => eval('6*7') === 42));
    out.push(await step('new Function', () => new Function('a', 'return a*7')(6) === 42));

    let fetcher = null;
    if (hasGmXhr) {
      out.push(await step('GM fetch (small)', async () => { const r = await gmGet(SMALL); if (r.status !== 200) throw new Error('HTTP ' + r.status); fetcher = fetcher || gmGet; return r.text.length + ' B'; }));
    }
    if (typeof window.PDA_httpGet === 'function') {
      out.push(await step('PDA fetch (small)', async () => { const r = await pdaGet(SMALL); if (r.status !== 200 || !r.text) throw new Error('HTTP ' + r.status); fetcher = fetcher || pdaGet; return r.text.length + ' B'; }));
    }
    out.push(await step('Plain fetch (small)', async () => { const r = await plainGet(SMALL); if (r.status !== 200) throw new Error('HTTP ' + r.status); fetcher = fetcher || plainGet; return r.text.length + ' B'; }));

    let small = '';
    let big = '';
    if (fetcher) {
      out.push(await step('Run fetched code', async () => { small = (await fetcher(SMALL)).text; const o = new Function('return (' + small + ')')(); return !!(o && o.name); }));
      out.push(await step('Fetch OCC build', async () => { big = (await fetcher(BIG)).text; if (big.length < 50000) throw new Error('only ' + big.length + ' B'); return Math.round(big.length / 1024) + ' KB'; }));
      // Compile only: proves the real 180 KB bundle parses and is allowed, without running a second OCC.
      out.push(await step('Compile OCC build', () => { new Function('GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'if (false) {\n' + big + '\n}'); return true; }));
    } else {
      out.push({ name: 'Fetch', ok: false, note: 'no way to reach GitHub' });
    }

    const blob = big || 'x'.repeat(190000);
    if (hasGmStore && !isPda) {
      out.push(await step('Keep in TM storage', () => { GM_setValue('probe_blob', blob); const ok = GM_getValue('probe_blob', '') === blob; GM_deleteValue('probe_blob'); return ok && Math.round(blob.length / 1024) + ' KB'; }));
    }
    out.push(await step('Keep in localStorage', () => { localStorage.setItem('occ_probe_blob', blob); const ok = localStorage.getItem('occ_probe_blob') === blob; localStorage.removeItem('occ_probe_blob'); return ok && Math.round(blob.length / 1024) + ' KB'; }));

    // Page-world injection: the fallback if the manager itself refuses eval.
    out.push(await step('Page inline script', () => new Promise((res) => {
      const s = document.createElement('script');
      s.textContent = 'document.documentElement.dataset.occProbe="1";';
      document.documentElement.appendChild(s); s.remove();
      setTimeout(() => res(document.documentElement.dataset.occProbe === '1'), 50);
    })));

    await new Promise((r) => setTimeout(r, 100));
    out.push({ name: 'Page CSP blocks', ok: csp.length === 0, note: csp.length ? csp.join('; ').slice(0, 160) : 'none seen' });
    delete document.documentElement.dataset.occProbe;
    return out;
  }

  // ---- UI: Torn colors, no native controls.
  const css = document.createElement('style');
  css.textContent = [
    '#occ-probe{position:fixed;left:8px;bottom:8px;z-index:999999;font:12px Arial,sans-serif;color:var(--default-color,#ddd)}',
    '#occ-probe .pill{all:unset;cursor:pointer;padding:5px 10px;border-radius:12px;background:var(--default-bg-panel-color,#333);border:1px solid var(--default-gray-e4-color,#444)}',
    '#occ-probe .box{width:min(340px,calc(100vw - 16px));background:var(--default-bg-panel-color,#333);border:1px solid var(--default-gray-e4-color,#444);border-radius:5px;overflow:hidden}',
    '#occ-probe .hd{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:linear-gradient(180deg,#555,#333);font-weight:bold;color:var(--default-white-color,#fff)}',
    '#occ-probe .hd button{all:unset;cursor:pointer;padding:0 4px}',
    '#occ-probe .row{display:flex;gap:6px;padding:4px 10px;border-top:1px solid var(--panel-border-bottom-color,#3b3b3b)}',
    '#occ-probe .row b{width:14px}#occ-probe .k{width:120px;flex:none}#occ-probe .v{color:var(--default-content-title-color,#999);word-break:break-word}',
    '#occ-probe .g{color:var(--default-green-color,#82c91e)}#occ-probe .r{color:var(--default-red-color,#E54C19)}',
  ].join('');
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.id = 'occ-probe';
  const pill = document.createElement('button');
  pill.className = 'pill';
  pill.textContent = 'OCC probe';
  root.appendChild(pill);
  document.body.appendChild(root);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  pill.addEventListener('click', async () => {
    pill.textContent = 'Testing...';
    const res = await run();
    root.innerHTML = '<div class="box"><div class="hd"><span>OCC loader probe</span><button type="button">×</button></div>' +
      res.map((r) => '<div class="row"><b class="' + (r.ok ? 'g">✓' : 'r">✗') + '</b><span class="k">' + esc(r.name) + '</span><span class="v">' + esc(r.note) + '</span></div>').join('') +
      '<div class="row"><span class="v">Screenshot this, then uninstall the probe.</span></div></div>';
    root.querySelector('.hd button').addEventListener('click', () => root.remove());
    console.log('[OCC probe]', res);
  });
})();
