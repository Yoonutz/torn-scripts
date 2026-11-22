// ==UserScript==
// @name         Torn Colored Chats
// @namespace    kamiren.torn-colored-chats
// @version      1.0.2
// @description  Gives each Torn group chat (faction, company, global, trade and more) its own color. Private chats stay as they are. A palette icon in the chat header changes the color.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'tcc.colors';
  const PAL = ['#b33a3a', '#c0602a', '#b08a1a', '#1f8a8a', '#2a6fb3', '#4a4ab3', '#7a3fb3', '#b33a7a'];
  const NAMES = ['Red', 'Orange', 'Amber', 'Teal', 'Blue', 'Indigo', 'Purple', 'Pink'];
  const DEF = { faction: PAL[0], company: PAL[4], global: PAL[3], trade: PAL[2] };
  const OTHER = PAL[6];
  const SKIP = /^\d+$|panel/i;
  const HEAD = 'button[class*="header___"]';
  const ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 22 9.8C22 5.9 17.5 3 12 3zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';
  const seen = new Set(Object.keys(DEF));
  let sheet = null;
  let pop = null;
  let timer = 0;

  const store = {
    get(k, d) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(k, d);
      } catch (e) {}
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        if (typeof GM_setValue === 'function') return GM_setValue(k, v);
      } catch (e) {}
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
  };

  const saved = () => store.get(KEY, {}) || {};
  const colorOf = (id) => {
    const v = saved()[id];
    return v === 'none' ? null : v || DEF[id] || OTHER;
  };
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));
  const hex = (a) => '#' + a.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  const mix = (c, base, f) => hex(rgb(c).map((n, i) => n * f + rgb(base)[i] * (1 - f)));
  const esc = (id) => id.replace(/["\\]/g, '\\$&');

  function rules() {
    let css = '';
    for (const id of seen) {
      const c = colorOf(id);
      if (!c) continue;
      const w = '#chatRoot [id="' + esc(id) + '"]';
      const h = w + ' ' + HEAD + ':not([class*="message___"])';
      css +=
        h + '{background:linear-gradient(' + mix(c, '#ffffff', 0.78) + ',' + c + ' 45%,' + mix(c, '#000000', 0.45) + ')!important}' +
        h + ' [class*="actionButton___"]:hover{background:rgba(255,255,255,.12)!important}' +
        'body.dark-mode ' + w + '{--chat-color-background:' + mix(c, '#333333', 0.1) + '}' +
        'body:not(.dark-mode) ' + w + '{--chat-color-background:' + mix(c, '#f2f2f2', 0.06) + '}' +
        'body.dark-mode ' + w + ' [class*="content___"]{background:linear-gradient(' + mix(c, '#333333', 0.38) + ',' + mix(c, '#333333', 0.06) + ')!important}' +
        'body:not(.dark-mode) ' + w + ' [class*="content___"]{background:linear-gradient(' + mix(c, '#f2f2f2', 0.22) + ',' + mix(c, '#f2f2f2', 0.03) + ')!important}' +
        'body.dark-mode ' + w + ' a[class*="sender___"]{color:' + mix(c, '#ffffff', 0.55) + '!important}' +
        'body:not(.dark-mode) ' + w + ' a[class*="sender___"]{color:' + mix(c, '#000000', 0.75) + '!important}';
    }
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = 'tcc-colors';
      document.head.appendChild(sheet);
    }
    sheet.textContent = css;
  }

  function stop(e) {
    e.stopPropagation();
  }

  function closePop() {
    if (!pop) return;
    pop.remove();
    pop = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closePop);
  }

  function outside(e) {
    if (pop && !pop.contains(e.target) && !e.target.closest('.tcc-pal')) closePop();
  }

  function onKey(e) {
    if (e.key === 'Escape') closePop();
  }

  function choose(id, v) {
    const all = saved();
    if (v === 'default') delete all[id];
    else all[id] = v;
    store.set(KEY, all);
    rules();
    closePop();
  }

  function openPop(btn, id) {
    if (pop && pop.dataset.id === id) return closePop();
    closePop();
    const cur = saved()[id] || 'default';
    pop = document.createElement('div');
    pop.id = 'tcc-pop';
    pop.dataset.id = id;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Chat color');
    const items = PAL.map((c, i) => [c, NAMES[i], '']).concat([
      ['default', 'Default color', '\u21ba'],
      ['none', 'No color', '\u2298'],
    ]);
    for (const [v, name, txt] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tcc-sw' + (v === cur ? ' tcc-on' : '');
      b.dataset.c = v;
      b.title = name;
      b.setAttribute('aria-label', name);
      if (txt) b.textContent = txt;
      else b.style.background = v;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        choose(id, v);
      });
      pop.appendChild(b);
    }
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(4, Math.min(r.right - pw, innerWidth - pw - 4));
    const top = r.bottom + 4 + ph <= innerHeight ? r.bottom + 4 : Math.max(4, r.top - ph - 4);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closePop);
    const first = pop.querySelector('.tcc-on') || pop.firstChild;
    first.focus({ preventScroll: true });
  }

  function addIcon(head, id) {
    const b = document.createElement('span');
    b.className = 'tcc-pal';
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    b.setAttribute('title', 'Chat color');
    b.setAttribute('aria-label', 'Chat color');
    b.setAttribute('data-prevent-flyout-swipe', 'true');
    b.innerHTML = ICON;
    for (const t of ['pointerdown', 'mousedown', 'touchstart', 'mouseup', 'pointerup']) b.addEventListener(t, stop);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPop(b, id);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      openPop(b, id);
    });
    const min = head.querySelector(':scope > svg[class*="minimizeIcon___"]');
    head.insertBefore(b, min || null);
  }

  function scan() {
    timer = 0;
    if (document.hidden) return;
    const root = document.getElementById('chatRoot');
    if (!root) return;
    let fresh = false;
    for (const head of root.querySelectorAll(HEAD)) {
      const win = head.parentElement && head.parentElement.closest('[id]');
      if (!win || !root.contains(win) || SKIP.test(win.id)) continue;
      if (!seen.has(win.id)) {
        seen.add(win.id);
        fresh = true;
      }
      if (!head.querySelector(':scope > .tcc-pal')) addIcon(head, win.id);
    }
    if (fresh) rules();
  }

  function later() {
    if (!timer) timer = setTimeout(scan, 200);
  }

  const base = document.createElement('style');
  base.textContent =
    '.tcc-pal{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:0 6px 4px auto;padding:0;cursor:pointer;border-radius:3px}' +
    '.tcc-pal svg{width:16px;height:16px;fill:#b3b3b3;filter:drop-shadow(0 0 2px rgba(0,0,0,.55))}' +
    '.tcc-pal:hover svg,.tcc-pal:focus-visible svg{fill:#fff}' +
    '.tcc-pal:focus-visible{outline:1px solid #ccc}' +
    '.tcc-pal+svg[class*="minimizeIcon___"]{margin-left:0!important}' +
    '#tcc-pop{position:fixed;z-index:999999;display:grid;grid-template-columns:repeat(5,22px);gap:5px;padding:7px;box-sizing:border-box;background:linear-gradient(#555,#333);border:1px solid #222;border-radius:5px;box-shadow:0 2px 8px rgba(0,0,0,.6)}' +
    '#tcc-pop .tcc-sw{width:22px;height:22px;margin:0;padding:0;border:1px solid rgba(0,0,0,.6);border-radius:3px;background:#444;color:#ddd;font:14px/20px Arial,sans-serif;text-align:center;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.2)}' +
    '#tcc-pop .tcc-sw:hover,#tcc-pop .tcc-sw:focus-visible{outline:2px solid #ddd;outline-offset:0}' +
    '#tcc-pop .tcc-on{outline:2px solid #fff;outline-offset:1px}';
  document.head.appendChild(base);

  rules();
  scan();
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => !document.hidden && later());
})();
