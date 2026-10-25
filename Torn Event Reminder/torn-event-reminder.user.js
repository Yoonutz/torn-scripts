// ==UserScript==
// @name         Torn Event reminder
// @namespace    kamiren.torn-event-reminder
// @version      1.0.10
// @description  Colors Torn's header clock as calendar events approach: red 1 day before, orange when soon, green while live. Reads your personal event start time from the API or the calendar page. Settings sit in a new row under the time in the clock dropdown.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const DAY = 86400;
  const HOUR = 3600;
  const TICK_MS = 5000;
  const API_REFRESH_S = 6 * HOUR;

  const K_SETTINGS = 'ter.settings';
  const K_EVENTS = 'ter.events';
  const K_APIKEY = 'ter.apikey';      // v1.0.0 kept it in plain text, migrated on load
  const K_APIKEY_ENC = 'ter.apikey.enc';
  const KEY_PAGE = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=Event%20Reminder&user=calendar&torn=calendar';

  const DEFAULTS = {
    redHours: 24,        // red from this many hours before the start
    orangeHours: 3,      // orange from this many hours before the start
    greenHours: 0,       // green for this many hours after the start, 0 = the whole event
    showDot: true,       // small colored dot on the clock, visible even if the icon cannot be tinted
    newEventsOn: true,   // events seen for the first time start checked
    startTime: null,     // your personal event start time, 'HH:MM' TCT
    startSource: '',     // 'api' | 'calendar' | 'manual'
    lastFetch: 0,
    lastError: '',
  };

  // Torn PDA rewrites this literal at install time. Untouched, it stays the
  // placeholder, which is how we know we are not running inside PDA.
  const PDA_KEY_PLACEHOLDER = '###' + 'PDA-APIKEY' + '###';
  const PDA_KEY = '###PDA-APIKEY###';

  // ------------------------------------------------------------- storage
  function load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  let S = Object.assign({}, DEFAULTS, load(K_SETTINGS, {}));
  let EV = load(K_EVENTS, {});
  const saveSettings = () => store(K_SETTINGS, S);
  const saveEvents = () => store(K_EVENTS, EV);

  // ------------------------------------------------------------- time helpers
  // TCT is UTC, so every time in this script is plain UTC epoch seconds.
  const now = () => Math.floor(Date.now() / 1000);

  function startOffset() {
    const m = /^(\d{1,2}):(\d{2})/.exec(S.startTime || '');
    return m ? (+m[1] * HOUR + +m[2] * 60) % DAY : 0;
  }

  function fmtTct(sec) {
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} - ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}`;
  }
  function fmtLeft(sec) {
    sec = Math.max(0, sec);
    const d = Math.floor(sec / DAY);
    const h = Math.floor((sec % DAY) / HOUR);
    const m = Math.floor((sec % HOUR) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ------------------------------------------------------------- event times
  // The API gives events with a personal start time at 00:00 TCT, and their
  // end as the last second of the final day. The calendar page shows them
  // shifted by your start time and ending at your start time on the final
  // day (Trick or Treat: 25/10 00:00 -> 01/11 23:59:59 in the API,
  // 11:00 25/10 -> 11:00 01/11 on the page for an 11:00 start).
  function apiTimes(ev) {
    const off = ev.fixed ? 0 : startOffset();
    const start = ev.rawStart + off;
    // A finished yearly event gets its next start while its end stays at the
    // last run, so the length is unknown: assume one day.
    let len = ev.rawEnd > ev.rawStart ? ev.rawEnd + 1 - ev.rawStart : DAY;
    if (!ev.fixed && len > DAY) len -= DAY;
    return { start, end: start + len };
  }

  // What the calendar page showed wins over the API estimate.
  function times(ev) {
    if (ev.pageStart) return { start: ev.pageStart, end: ev.pageEnd || ev.pageStart + DAY };
    if (ev.rawStart) return apiTimes(ev);
    return { start: 0, end: 0 };
  }

  const RANK = { red: 1, orange: 2, green: 3 };
  // Torn's own palette, with its dark-mode values as fallbacks.
  const COLOR = {
    red: 'var(--default-red-color, #e54c19)',
    orange: 'var(--default-orange-color, #f08c00)',
    green: 'var(--default-green-color, #82c91e)',
  };

  function stateOf(ev, t) {
    const { start, end } = times(ev);
    if (!start) return null;
    if (t >= start && t < end) {
      if (S.greenHours > 0 && t >= start + S.greenHours * HOUR) return null;
      return 'green';
    }
    if (t < start) {
      const left = start - t;
      if (left <= S.orangeHours * HOUR) return 'orange';
      if (left <= S.redHours * HOUR) return 'red';
    }
    return null;
  }

  // ------------------------------------------------------------- API key
  // Stored AES-GCM encrypted. The AES key itself is a non-extractable
  // CryptoKey kept in IndexedDB, so the key never sits in localStorage as
  // plain text where any script or extension scanning it could read it.
  const IS_PDA = PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER;
  const KEY_RX = /^[A-Za-z0-9]{16}$/;
  let keyCache = '';

  function apiKey() {
    return IS_PDA ? PDA_KEY : keyCache;
  }

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ter-vault', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('k');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function vaultKey() {
    const db = await idb();
    const get = (k) => new Promise((res, rej) => {
      const r = db.transaction('k').objectStore('k').get(k);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    let key = await get('aes');
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await new Promise((res, rej) => {
        const tx = db.transaction('k', 'readwrite');
        tx.objectStore('k').put(key, 'aes');
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    }
    return key;
  }

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function saveKey(plain) {
    keyCache = plain || '';
    localStorage.removeItem(K_APIKEY);
    if (!plain) { localStorage.removeItem(K_APIKEY_ENC); return; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(), new TextEncoder().encode(plain));
    localStorage.setItem(K_APIKEY_ENC, b64(iv) + '.' + b64(ct));
  }

  async function loadKey() {
    if (IS_PDA) return;
    try {
      const old = (localStorage.getItem(K_APIKEY) || '').trim();
      if (old) { await saveKey(old); return; }
      const enc = localStorage.getItem(K_APIKEY_ENC);
      if (!enc) return;
      const [iv, ct] = enc.split('.');
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await vaultKey(), unb64(ct));
      keyCache = new TextDecoder().decode(pt);
    } catch (e) {
      keyCache = ''; // vault cleared or blocked: ask for the key again
    }
  }

  // Keys other scripts left in localStorage: plain 16-character values, or
  // 16-character strings inside JSON values.
  function scanForKeys() {
    const found = new Map();
    const walk = (v, where) => {
      if (typeof v === 'string') { if (KEY_RX.test(v.trim()) && !found.has(v.trim())) found.set(v.trim(), where); }
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, where));
    };
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name || name.startsWith('ter.')) continue;
      const raw = localStorage.getItem(name) || '';
      if (raw.length > 20000) continue;
      walk(raw, name);
      if (/^[[{]/.test(raw.trim())) { try { walk(JSON.parse(raw), name); } catch (e) { /* not JSON */ } }
    }
    return [...found].map(([key, where]) => ({ key, where }));
  }

  // ------------------------------------------------------------- Torn API
  async function tornApi(path, withKey) {
    const key = withKey || apiKey();
    if (!key) throw new Error('No API key');
    const url = `https://api.torn.com/v2/${path}`;
    const headers = { Authorization: `ApiKey ${key}` };
    let text;
    if (typeof window.PDA_httpGet === 'function') {
      const r = await window.PDA_httpGet(url, headers);
      text = (r && (r.responseText || r.text || r.body)) || (typeof r === 'string' ? r : '');
    } else {
      const res = await fetch(url, { headers });
      text = await res.text();
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Bad API response'); }
    if (data.error) throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
    return data;
  }

  function mergeApiEvent(kind, e) {
    const id = (kind === 'competition' ? 'c:' : 'e:') + e.title;
    const ev = EV[id] || { id, title: e.title, kind, enabled: S.newEventsOn };
    const moved = ev.rawStart && ev.rawStart !== e.start;
    Object.assign(ev, { title: e.title, kind, desc: e.description || '', fixed: !!e.fixed_start_time, rawStart: e.start, rawEnd: e.end, api: true });
    // A new run of the event makes last run's page times and edits stale.
    if (moved) {
      const t = now();
      if (ev.pageEnd && ev.pageEnd < t) { delete ev.pageStart; delete ev.pageEnd; }
    }
    EV[id] = ev;
  }

  let fetching = null;
  function refreshFromApi(force) {
    if (fetching) return fetching;
    if (!apiKey()) return Promise.resolve(false);
    if (!force && now() - S.lastFetch < API_REFRESH_S) return Promise.resolve(false);
    fetching = (async () => {
      try {
        const cal = await tornApi('torn/calendar');
        (cal?.calendar?.events || []).forEach((e) => mergeApiEvent('event', e));
        (cal?.calendar?.competitions || []).forEach((e) => mergeApiEvent('competition', e));
        if (S.startSource !== 'manual') {
          const mine = await tornApi('user/calendar');
          const m = /(\d{1,2}):(\d{2})/.exec(mine?.calendar?.start_time || '');
          if (m) { S.startTime = `${m[1].padStart(2, '0')}:${m[2]}`; S.startSource = 'api'; }
        }
        S.lastFetch = now();
        S.lastError = '';
        return true;
      } catch (err) {
        S.lastError = String(err.message || err);
        return false;
      } finally {
        saveSettings();
        saveEvents();
        fetching = null;
        update();
        renderUI();
      }
    })();
    return fetching;
  }

  // ------------------------------------------------------------- calendar page
  // "11:00:00 - 25/10/26 until 11:00:00 - 01/11/26"
  const RANGE_RX = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*until\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;

  function rxTime(m, i) {
    const y = +m[i + 5] < 100 ? 2000 + +m[i + 5] : +m[i + 5];
    return Math.floor(Date.UTC(y, +m[i + 4] - 1, +m[i + 3], +m[i], +m[i + 1], +(m[i + 2] || 0)) / 1000);
  }

  function titleFor(el) {
    const known = Object.values(EV).map((e) => e.title).sort((a, b) => b.length - a.length);
    let node = el;
    for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      const text = node.textContent || '';
      if ((text.match(new RegExp(RANGE_RX.source, 'gi')) || []).length > 1) break; // reached the list
      const hit = known.find((t) => text.toLowerCase().includes(t.toLowerCase()));
      if (hit) return hit;
    }
    const prev = el.previousElementSibling;
    const t = prev && (prev.textContent || '').trim().split('\n')[0].trim();
    return t && t.length <= 60 ? t : null;
  }

  function scrapeCalendar() {
    let changed = false;
    document.querySelectorAll('body *').forEach((el) => {
      if (el.closest('.ter-ui')) return;
      const text = el.textContent || '';
      if (text.length > 200 || !RANGE_RX.test(text)) return;
      if ([...el.children].some((c) => RANGE_RX.test(c.textContent || ''))) return; // only the deepest match
      const m = RANGE_RX.exec(text);
      const start = rxTime(m, 1);
      const end = rxTime(m, 7);
      const title = titleFor(el);
      if (!title || !start) return;
      let ev = Object.values(EV).find((e) => e.title.toLowerCase() === title.toLowerCase());
      if (!ev) {
        const id = 'e:' + title;
        ev = EV[id] = { id, title, kind: 'event', enabled: S.newEventsOn };
      }
      if (ev.pageStart !== start || ev.pageEnd !== end) {
        ev.pageStart = start;
        ev.pageEnd = end;
        changed = true;
      }
      // The page shows your own start time, so learn it from any event
      // that follows it.
      if (S.startSource !== 'manual' && ev.rawStart && !ev.fixed) {
        const off = start - ev.rawStart;
        if (off >= 0 && off < DAY) {
          const p = (n) => String(n).padStart(2, '0');
          const st = `${p(Math.floor(off / HOUR))}:${p(Math.floor((off % HOUR) / 60))}`;
          if (st !== S.startTime) { S.startTime = st; S.startSource = 'calendar'; changed = true; }
        }
      }
    });
    if (changed) {
      saveEvents();
      saveSettings();
      update();
      renderUI();
    }
  }

  function watchCalendar() {
    if (!/\/calendar\.php/i.test(location.pathname)) return;
    let timer = null;
    const run = () => { clearTimeout(timer); timer = setTimeout(scrapeCalendar, 400); };
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    run();
  }

  // ------------------------------------------------------------- clock icon
  // Torn's header: a clock icon whose dropdown is
  // <div class="tc-clock-tooltip"><p><span class="server-date-time">...</span></p></div>.
  const TOOLTIP = '.tc-clock-tooltip';
  const CANDIDATES = [
    '[class*="clock" i]',
    '[id*="clock" i]',
    '#server-time',
    '[aria-label*="clock" i]',
    '[title*="clock" i]',
  ];

  function shown(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top + window.scrollY < 260;
  }

  function hasIcon(el) {
    if (el.tagName.toLowerCase() === 'svg' || el.tagName === 'I') return true;
    return [...el.querySelectorAll('svg, i')].some((s) => !s.closest(TOOLTIP));
  }

  function findClock() {
    for (const sel of CANDIDATES) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest(TOOLTIP) || el.closest('.ter-ui, #ter-float') || el.classList.contains('ter-dot')) continue;
        if (el.querySelector(TOOLTIP) && !hasIcon(el)) continue;
        if (shown(el) && hasIcon(el)) return el;
      }
    }
    return null;
  }

  let host = null;
  let icon = null;

  // The element that gets tinted: the clock's own svg or icon, never the dropdown.
  function iconOf(el) {
    if (el.tagName.toLowerCase() === 'svg' || el.tagName === 'I') return el;
    return [...el.querySelectorAll('svg, i')].find((s) => !s.closest(TOOLTIP)) || el;
  }

  function clearHost() {
    if (icon) icon.classList.remove('ter-tint', 'ter-red', 'ter-orange', 'ter-green');
    icon = null;
    if (!host) return;
    host.classList.remove('ter-host', 'ter-red', 'ter-orange', 'ter-green');
    host.querySelectorAll(':scope > .ter-dot').forEach((d) => d.remove());
    host = null;
  }

  function paint(color, tip) {
    const el = findClock();
    if (el !== host) {
      clearHost();
      if (el) {
        host = el;
      }
    }
    const float = document.getElementById('ter-float');
    if (!host) {
      // No clock found: a small floating dot instead while something is due,
      // which also opens the list.
      if (!color) { if (float) float.remove(); return; }
      let f = float;
      if (!f) {
        f = document.createElement('div');
        f.id = 'ter-float';
        f.innerHTML = '<div class="ter-float-dot"></div>';
        f.querySelector('.ter-float-dot').addEventListener('click', () => {
          const box = f.querySelector('.ter-ui');
          if (box) box.remove(); else f.append(makeUI());
        });
        document.body.append(f);
      }
      const d = f.querySelector('.ter-float-dot');
      d.style.background = COLOR[color];
      d.title = tip || 'Torn Event reminder';
      return;
    }
    if (float) float.remove();
    const ic = iconOf(host);
    if (ic !== icon) {
      if (icon) icon.classList.remove('ter-tint', 'ter-red', 'ter-orange', 'ter-green');
      icon = ic;
    }
    host.classList.add('ter-host');
    icon.classList.add('ter-tint');
    ['red', 'orange', 'green'].forEach((c) => {
      host.classList.toggle('ter-' + c, c === color);
      icon.classList.toggle('ter-' + c, c === color);
    });
    let dot = host.querySelector(':scope > .ter-dot');
    if (color && S.showDot) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'ter-dot';
        host.append(dot);
      }
    } else if (dot) dot.remove();
  }

  // ------------------------------------------------------------- main loop
  function update() {
    const t = now();
    let best = null;
    const lines = [];
    status = [];
    Object.values(EV)
      .filter((ev) => ev.enabled && ev.kind !== 'custom')
      .map((ev) => ({ ev, st: stateOf(ev, t), ...times(ev) }))
      .filter((x) => x.st)
      .sort((a, b) => RANK[b.st] - RANK[a.st] || a.start - b.start)
      .forEach((x) => {
        if (!best || RANK[x.st] > RANK[best]) best = x.st;
        const text = x.st === 'green'
          ? `${x.ev.title} live, ${fmtLeft(x.end - t)} left`
          : `${x.ev.title} in ${fmtLeft(x.start - t)}`;
        lines.push(text);
        status.push({ st: x.st, text });
      });
    paint(best, lines.join('\n'));
    mountUI();
  }

  // ------------------------------------------------------------- clock dropdown row
  // A new row under the time in Torn's clock dropdown: this month's events,
  // a checkbox each. Event times are Torn's, only the reminder windows are editable.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ui = { tab: 'month', gear: false, key: null }; // key: null | { step: 'found', list } | { step: 'new' }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtDay(sec) {
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  function fmtLen(sec) {
    const d = Math.round(sec / HOUR) / 24;
    return d >= 1 ? `${Math.round(d * 10) / 10}d` : `${Math.round(sec / HOUR)}h`;
  }

  // The view button cycles through these.
  const VIEWS = { next: 'Next event', month: "This month's events", year: "This year's events" };
  const VIEW_ORDER = ['next', 'month', 'year'];

  function listRows() {
    const t = now();
    const d = new Date(t * 1000);
    const from = ui.tab === 'year' ? Date.UTC(d.getUTCFullYear(), 0, 1) / 1000 : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    const to = ui.tab === 'year' ? Date.UTC(d.getUTCFullYear() + 1, 0, 1) / 1000 : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
    const rows = Object.values(EV)
      .filter((ev) => ev.kind !== 'custom')
      .map((ev) => ({ ev, ...times(ev) }))
      .filter((x) => x.start)
      .sort((a, b) => a.start - b.start);
    if (ui.tab === 'next') {
      // Whatever is live now, plus the next event to start.
      const live = rows.filter((x) => x.start <= t && x.end > t);
      const next = rows.find((x) => x.start > t);
      return live.concat(next ? [next] : []).map((x) => Object.assign(x, { carried: false }));
    }
    return rows
      .map((x) => Object.assign(x, { carried: x.start < from && x.end > t }))
      .filter((x) => (x.start >= from && x.start < to) || x.carried);
  }

  function shortDate(sec) {
    const d = new Date(sec * 1000);
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  }

  function rowHtml({ ev, start, end, carried }) {
    const t = now();
    const st = ev.enabled ? stateOf(ev, t) : null;
    const past = end <= t;
    const when = t >= start && t < end ? `live, ${fmtLeft(end - t)} left`
      : t < start ? `starts in ${fmtLeft(start - t)}` : 'ended';
    const from = carried ? `<span class="ter-tag">from ${MONTHS[new Date(start * 1000).getUTCMonth()]}</span>` : '';
    const days = shortDate(start) === shortDate(end - 1) ? shortDate(start) : `${shortDate(start)}-${shortDate(end)}`;
    const tip = `${ev.desc ? ev.desc + '\n' : ''}${fmtTct(start)} until ${fmtTct(end)} TCT\n${when}`;
    return `
      <label class="ter-ev${ev.enabled && !past ? '' : ' ter-off'}${past ? ' ter-past' : ''}" data-id="${esc(ev.id)}" title="${esc(tip)}">
        <input type="checkbox" data-f="enabled" ${ev.enabled && !past ? 'checked' : ''}${past ? ' disabled' : ''}>
        <span class="ter-sw${st ? ' ter-' + st + '-bg' : ''}"></span>
        <span class="ter-name">${esc(ev.title)}</span>${from}
        <span class="ter-when">${days}</span>
      </label>`;
  }

  function keyHtml() {
    const msg = ui.keyMsg ? `<div class="${ui.keyErr ? 'ter-err' : 'ter-muted'}">${esc(ui.keyMsg)}</div>` : '';
    if (ui.key && ui.key.step === 'found') {
      return `<div class="ter-key">
        <div>Found ${ui.key.list.length > 1 ? 'these API keys' : 'an API key'} saved by another script. Use it?</div>
        ${ui.key.list.map((k, i) => `<div class="ter-row"><code>••••${esc(k.key.slice(-4))}</code><span class="ter-muted">${esc(k.where)}</span><button data-act="key-use" data-i="${i}">Use</button></div>`).join('')}
        <div class="ter-row"><button data-act="key-new">Use another</button><button data-act="key-cancel">Cancel</button></div>
        ${msg}</div>`;
    }
    if (ui.key && ui.key.step === 'new') {
      return `<div class="ter-key">
        <div>1. <a href="${KEY_PAGE}" target="_blank" rel="noopener">Open Torn's key page</a>, it is filled in for you, press <b>Create</b>.</div>
        <div>2. Copy the new key and paste it here:</div>
        <div class="ter-row"><input type="password" data-k="newkey" placeholder="16-character key" autocomplete="off" spellcheck="false"><button data-act="key-save">Save</button><button data-act="key-cancel">Cancel</button></div>
        ${msg}</div>`;
    }
    return apiKey()
      ? `<div class="ter-row">API key <code>••••${esc(apiKey().slice(-4))}</code><a href="#" data-act="key-change">change</a><a href="#" data-act="key-remove">remove</a></div>${msg}`
      : `<div class="ter-row"><button data-act="key-set">Set API key</button></div>${msg}`;
  }

  async function tryKey(key) {
    ui.keyMsg = 'Checking…';
    ui.keyErr = false;
    renderUI();
    try {
      await tornApi('user/calendar', key);
      await saveKey(key);
      ui.key = null;
      ui.keyMsg = 'Saved, encrypted.';
      S.lastFetch = 0;
      refreshFromApi(true);
    } catch (e) {
      ui.keyMsg = `That key did not work: ${e.message || e}`;
      ui.keyErr = true;
    }
    renderUI();
  }

  function gearHtml() {
    const isPda = PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER;
    const src = { api: 'auto, API', calendar: 'auto, calendar page', manual: 'yours' }[S.startSource] || 'unknown';
    const status = S.lastError ? `<span class="ter-err">${esc(S.lastError)}</span>`
      : S.lastFetch ? `updated ${fmtDay(S.lastFetch)}` : 'not fetched';
    // While a key is being set, the key steps replace the whole settings box.
    if (ui.key) return `<div class="ter-gear">${keyHtml()}</div>`;
    return `
      <div class="ter-gear">
        ${isPda ? '' : keyHtml()}
        <div class="ter-muted">${status} · <a href="#" data-act="refresh">refresh</a>${isPda ? ' · PDA key' : ''}</div>
        <hr class="ter-hr">
        <label>Your start <input type="time" data-k="startTime" value="${esc(S.startTime || '')}"><span class="ter-muted">${esc(src)}${S.startSource === 'manual' ? ' · <a href="#" data-act="autostart">auto</a>' : ''}</span></label>
        <label><span class="ter-sw ter-red-bg"></span>Red <input type="number" min="0" step="0.5" data-k="redHours" value="${S.redHours}"> h before</label>
        <label><span class="ter-sw ter-orange-bg"></span>Orange <input type="number" min="0" step="0.25" data-k="orangeHours" value="${S.orangeHours}"> h before</label>
        <label><span class="ter-sw ter-green-bg"></span>Green <input type="number" min="0" step="0.5" data-k="greenHours" value="${S.greenHours}"> h, 0 = all event</label>
        <label><input type="checkbox" data-k="showDot" ${S.showDot ? 'checked' : ''}> Dot on clock</label>
      </div>`;
  }

  function uiHtml() {
    const rows = listRows();
    return `
      <div class="ter-top">
        <span class="ter-tabs">
          <a href="#" data-act="view" class="on" title="Switch view">${VIEWS[ui.tab]} ▾</a>
        </span>
        <a href="#" data-act="gear" class="ter-cog${ui.gear ? ' on' : ''}" title="Settings">⚙</a>
      </div>
      ${ui.gear ? gearHtml() : ''}
      ${ui.gear && ui.key ? '' : `<div class="ter-list">
        ${rows.length ? rows.map(rowHtml).join('') : `<div class="ter-muted">${Object.keys(EV).length ? 'Nothing to show.' : 'No events yet. Add an API key (⚙) or open the <a href="/calendar.php">calendar</a> once.'}</div>`}
      </div>`}
`;
  }

  function makeUI() {
    const box = document.createElement('div');
    box.className = 'ter-ui';
    box.innerHTML = uiHtml();
    // Keep Torn from closing the dropdown while the row is used.
    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'keydown'].forEach((type) =>
      box.addEventListener(type, (e) => {
        if (type === 'click') onUiClick(e);
        if (type === 'keydown' && e.key === 'Enter' && e.target.matches('[data-k="newkey"]')) box.querySelector('[data-act="key-save"]')?.click();
        else if (type === 'keydown' && e.key === 'Enter' && e.target.matches('input')) e.target.blur();
        e.stopPropagation();
      }));
    box.addEventListener('change', (e) => { onUiChange(e); e.stopPropagation(); });
    return box;
  }

  // Torn's time stays the first row; due events go in the row under it.
  let status = [];
  function mountUI() {
    const html = status.map((x) => `<div><span class="ter-sw ter-${x.st}-bg"></span>${esc(x.text)}</div>`).join('');
    document.querySelectorAll(TOOLTIP).forEach((tip) => {
      let row = tip.querySelector(':scope > .ter-status');
      if (!row) {
        row = document.createElement('div');
        row.className = 'ter-status';
        const time = tip.querySelector(':scope > p') || tip.firstElementChild;
        if (time) time.after(row); else tip.prepend(row);
      }
      if (row.innerHTML !== html) row.innerHTML = html;
      row.style.display = html ? '' : 'none';
      if (!tip.querySelector(':scope > .ter-ui')) tip.append(makeUI());
    });
  }

  function renderUI() {
    document.querySelectorAll('.ter-ui').forEach((box) => {
      // Never redraw under the user's fingers while a field is focused.
      if (box.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox])')) return;
      const scroll = box.querySelector('.ter-list')?.scrollTop || 0;
      box.innerHTML = uiHtml();
      const list = box.querySelector('.ter-list');
      if (list) list.scrollTop = scroll;
    });
  }

  function onUiChange(e) {
    const el = e.target;
    const k = el.dataset.k;
    if (k) {
      if (k === 'newkey') return; // saved by the Save button
      if (el.type === 'checkbox') S[k] = el.checked;
      else if (el.type === 'number') S[k] = Math.max(0, parseFloat(el.value) || 0);
      else S[k] = el.value.trim();
      if (k === 'startTime') S.startSource = S.startTime ? 'manual' : '';
      saveSettings();
      el.blur();
      update();
      renderUI();
      return;
    }
    const row = el.closest('.ter-ev');
    const ev = row && EV[row.dataset.id];
    if (!ev) return;
    const f = el.dataset.f;
    if (f === 'enabled') ev.enabled = el.checked;
    saveEvents();
    el.blur();
    update();
    renderUI();
  }

  function onUiClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.matches('input')) return;
    e.preventDefault();
    const act = el.dataset.act;
    if (act === 'view') ui.tab = VIEW_ORDER[(VIEW_ORDER.indexOf(ui.tab) + 1) % VIEW_ORDER.length];
    else if (act === 'gear') ui.gear = !ui.gear;
    else if (act === 'refresh') refreshFromApi(true);
    else if (act === 'key-set' || act === 'key-change') {
      ui.keyMsg = '';
      const list = scanForKeys().filter((k) => k.key !== apiKey());
      ui.key = list.length ? { step: 'found', list } : { step: 'new' };
    } else if (act === 'key-use') { tryKey(ui.key.list[+el.dataset.i].key); return; }
    else if (act === 'key-new') { ui.key = { step: 'new' }; ui.keyMsg = ''; }
    else if (act === 'key-cancel') { ui.key = null; ui.keyMsg = ''; }
    else if (act === 'key-save') {
      const input = el.closest('.ter-key').querySelector('[data-k="newkey"]');
      const v = (input && input.value || '').trim();
      if (!KEY_RX.test(v)) { ui.keyMsg = 'A Torn key is 16 letters and numbers.'; ui.keyErr = true; }
      else { tryKey(v); return; }
    } else if (act === 'key-remove') { saveKey(''); ui.keyMsg = 'Key removed.'; ui.keyErr = false; }
    else if (act === 'autostart') { S.startSource = ''; saveSettings(); refreshFromApi(true); }
    else return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    renderUI();
  }

  // ------------------------------------------------------------- styles
  function addStyles() {
    const css = `
      .ter-host { position: relative; }
      .ter-red { --ter: ${COLOR.red}; }
      .ter-orange { --ter: ${COLOR.orange}; }
      .ter-green { --ter: ${COLOR.green}; }
      .ter-tint.ter-red, .ter-tint.ter-orange, .ter-tint.ter-green {
        color: var(--ter) !important;
        filter: drop-shadow(0 0 3px var(--ter));
      }
      .ter-tint.ter-red *:not([fill="none"]), .ter-tint.ter-orange *:not([fill="none"]), .ter-tint.ter-green *:not([fill="none"]),
      svg.ter-tint.ter-red:not([fill="none"]), svg.ter-tint.ter-orange:not([fill="none"]), svg.ter-tint.ter-green:not([fill="none"]) { fill: var(--ter) !important; }
      .ter-tint.ter-red [stroke]:not([stroke="none"]), .ter-tint.ter-orange [stroke]:not([stroke="none"]), .ter-tint.ter-green [stroke]:not([stroke="none"]) { stroke: var(--ter) !important; }
      .ter-tint.ter-red stop, .ter-tint.ter-orange stop, .ter-tint.ter-green stop { stop-color: var(--ter) !important; }
      .ter-dot {
        position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%;
        background: var(--ter); box-shadow: 0 0 0 1px rgba(0,0,0,.6); pointer-events: none; z-index: 5;
      }
      #ter-float { position: fixed; right: 10px; bottom: 10px; z-index: 2147483646; display: flex; flex-direction: column-reverse; align-items: flex-end; gap: 6px; }
      #ter-float .ter-float-dot { width: 14px; height: 14px; border-radius: 50%; cursor: pointer; box-shadow: 0 0 6px rgba(0,0,0,.7); }
      #ter-float .ter-ui { background: var(--default-bg-panel-color, #333); border-radius: 6px; padding: 6px 8px; box-shadow: 0 2px 12px rgba(0,0,0,.6); }

      /* Torn sizes the clock tooltip for one line of text: let it grow around the new rows and sit on top. */
      ${TOOLTIP}:has(.ter-ui) {
        height: auto !important; max-height: none !important; min-height: 0 !important;
        width: auto !important; max-width: none !important; overflow: visible !important;
        z-index: 2147483000 !important;
      }
      ${TOOLTIP} .ter-ui, ${TOOLTIP} .ter-status { position: relative; z-index: 1; }
      .ter-status { white-space: nowrap; margin-top: 3px; font-size: 11px; line-height: 1.4; text-align: left; color: var(--default-color, #ddd); }
      .ter-status .ter-sw { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
      .ter-status .ter-red-bg { background: ${COLOR.red}; }
      .ter-status .ter-orange-bg { background: ${COLOR.orange}; }
      .ter-status .ter-green-bg { background: ${COLOR.green}; }
      .ter-ui {
        margin-top: 6px; padding-top: 6px;
        border-top: 1px solid var(--divider-dark-color, #222); box-shadow: inset 0 1px 0 var(--divider-light-color, #474747);
        width: 250px; max-width: 80vw; text-align: left; color: var(--default-color, #ddd); cursor: default;
        font-size: 11px; line-height: 1.4; white-space: normal; filter: none !important;
      }
      .ter-ui a { color: var(--default-blue-color, #74c0fc); text-decoration: none; cursor: pointer; }
      .ter-ui a:hover { color: var(--default-blue-hover-color, #a5d8ff); }
      .ter-ui .ter-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .ter-ui .ter-tabs a { color: var(--default-content-title-color, #999); margin-right: 8px; }
      .ter-ui .ter-tabs a.on { color: var(--tabs-color, #fff); text-shadow: var(--tabs-text-shadow, 0 0 2px #000); font-weight: bold; }
      .ter-ui .ter-cog { color: var(--default-content-title-color, #999); font-size: 13px; }
      .ter-ui .ter-cog.on, .ter-ui .ter-cog:hover { color: var(--default-white-color, #fff); }
      .ter-ui .ter-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
      /* Torn's header dropdown scrollbar colors */
      .ter-ui .ter-list {
        scrollbar-width: thin;
        scrollbar-color: var(--appheader-dropdown-list-scrollbar-thumb-color, #666) var(--appheader-dropdown-list-scrollbar-track-color, #222);
      }
      .ter-ui .ter-list::-webkit-scrollbar { width: 6px; }
      .ter-ui .ter-list::-webkit-scrollbar-track { background: var(--appheader-dropdown-list-scrollbar-track-color, #222); border-radius: 3px; }
      .ter-ui .ter-list::-webkit-scrollbar-thumb { background: var(--appheader-dropdown-list-scrollbar-thumb-color, #666); border-radius: 3px; }
      .ter-ui .ter-ev {
        display: flex; align-items: center; gap: 5px; cursor: pointer; padding: 3px 5px;
        background: var(--default-bg-panel-color, #333); border-bottom: 1px solid var(--panel-border-bottom-color, #3b3b3b);
      }
      .ter-ui .ter-ev:hover { background: var(--default-bg-panel-active-color, #444); }
      .ter-ui .ter-off { opacity: .5; }
      .ter-ui .ter-past { cursor: default; }
      .ter-ui .ter-past input[type=checkbox] { cursor: default; }
      .ter-ui .ter-past .ter-name, .ter-ui .ter-past .ter-when { text-decoration: line-through; }
      .ter-ui input[type=checkbox] { margin: 0; width: 12px; height: 12px; flex: none; accent-color: var(--checkbox-bg-color, #aaa); cursor: pointer; }
      .ter-ui .ter-name { font-weight: bold; color: var(--default-color, #ddd); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ter-ui .ter-when { margin-left: auto; padding-left: 6px; color: var(--default-content-title-color, #999); white-space: nowrap; }
      .ter-ui input[type=text], .ter-ui input[type=password], .ter-ui input[type=number], .ter-ui input[type=time] {
        color: var(--input-color, #fff); background: var(--input-background-color, linear-gradient(0deg, #111 0%, #000 100%));
        border: 1px solid var(--input-border-color, #444); border-radius: 5px; padding: 2px 5px;
        font-size: 11px; box-sizing: border-box; min-width: 0; color-scheme: dark; height: 22px; outline: none;
      }
      .ter-ui input[type=text]:hover, .ter-ui input[type=password]:hover, .ter-ui input[type=number]:hover, .ter-ui input[type=time]:hover {
        border-color: var(--input-hover-border-color, #666); box-shadow: var(--input-hover-box-shadow, 0 0 2px #ffffff40);
      }
      .ter-ui input[type=text]:focus, .ter-ui input[type=password]:focus, .ter-ui input[type=number]:focus, .ter-ui input[type=time]:focus {
        border-color: var(--input-focus-border-color, #1864ab80); box-shadow: var(--input-focus-box-shadow, 0 0 2px #1c7ed6a6);
      }
      .ter-ui input[type=number] { width: 48px; }
      .ter-ui button {
        color: var(--btn-color, #eee); text-shadow: var(--btn-text-shadow, 0 0 5px #000);
        background: var(--btn-background, linear-gradient(180deg, #111 0%, #555 25%, #333 60%, #333 78%, #111 100%));
        border: var(--btn-border, 1px solid #111); border-radius: 5px; padding: 0 10px; height: 22px;
        font-size: 11px; font-weight: bold; text-transform: uppercase; cursor: pointer;
      }
      .ter-ui button:hover {
        color: var(--btn-hover-color, #fff); text-shadow: var(--btn-hover-text-shadow, 0 0 5px #ffffff40);
        background: var(--btn-hover-background, linear-gradient(180deg, #333 0%, #777 25%, #333 59%, #666 78%, #333 100%));
      }
      .ter-ui button:active {
        color: var(--btn-active-color, #ddd); background: var(--btn-active-background, linear-gradient(180deg, #000 0%, #333 100%));
        box-shadow: var(--btn-active-box-shadow, inset 0 -1px 0 #ffffff12);
      }
      .ter-ui .ter-gear { display: flex; flex-direction: column; gap: 5px; padding: 6px; margin-bottom: 4px; background: var(--default-bg-panel-color, #333); }
      .ter-ui .ter-gear label { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .ter-ui .ter-gear input[type=password], .ter-ui .ter-gear input[type=text] { flex: 1; }
      .ter-ui .ter-tag { font-size: 10px; color: var(--default-full-text-color, #ccc); background: var(--default-bg-gray-color, rgba(221,221,221,.15)); border-radius: 3px; padding: 0 4px; white-space: nowrap; }
      .ter-ui .ter-sw { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--default-gray-e4-color, #444); }
      .ter-ui .ter-red-bg { background: ${COLOR.red}; }
      .ter-ui .ter-orange-bg { background: ${COLOR.orange}; }
      .ter-ui .ter-green-bg { background: ${COLOR.green}; }
      .ter-ui .ter-muted { color: var(--default-content-title-color, #999); }
      .ter-ui .ter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .ter-ui .ter-key { display: flex; flex-direction: column; gap: 5px; }
      .ter-ui .ter-key input[type=password] { flex: 1; }
      .ter-ui code { color: var(--default-color, #ddd); }
      .ter-ui .ter-hr { border: 0; height: 0; width: 100%; margin: 2px 0; border-top: 1px solid var(--divider-dark-color, #222); border-bottom: 1px solid var(--divider-light-color, #474747); }
      .ter-ui .ter-err { color: var(--default-red-color, #e54c19); }
    `;
    const style = document.createElement('style');
    style.id = 'ter-style';
    style.textContent = css;
    document.head.append(style);
  }

  // ------------------------------------------------------------- start
  function init() {
    addStyles();
    // Keep tabs in sync when settings change elsewhere.
    window.addEventListener('storage', (e) => {
      if (e.key === K_SETTINGS) S = Object.assign({}, DEFAULTS, load(K_SETTINGS, {}));
      if (e.key === K_EVENTS) EV = load(K_EVENTS, {});
      if (e.key === K_SETTINGS || e.key === K_EVENTS) { update(); renderUI(); }
    });
    // The dropdown is drawn by Torn when the clock opens, so add the row as soon as it appears.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; mountUI(); });
    }).observe(document.body, { childList: true, subtree: true });
    watchCalendar();
    update();
    setInterval(update, TICK_MS);
    setInterval(renderUI, 60 * 1000);
    loadKey().then(() => refreshFromApi(false));
    setInterval(() => refreshFromApi(false), 30 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
