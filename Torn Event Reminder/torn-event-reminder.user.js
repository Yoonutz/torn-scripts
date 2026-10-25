// ==UserScript==
// @name         Torn Event reminder
// @namespace    kamiren.torn-event-reminder
// @version      1.0.1
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
  const K_APIKEY = 'ter.apikey';

  const DEFAULTS = {
    redHours: 24,        // red from this many hours before the start
    orangeHours: 3,      // orange from this many hours before the start
    greenHours: 0,       // green for this many hours after the start, 0 = the whole event
    showDot: true,       // small colored dot on the clock, visible even if the icon cannot be tinted
    newEventsOn: true,   // events seen for the first time start checked
    startTime: null,     // your personal event start time, 'HH:MM' TCT
    startSource: '',     // 'api' | 'calendar' | 'manual'
    selector: '',        // optional CSS selector for the clock, if Torn moves it
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
  const COLOR = { red: '#e53935', orange: '#fb8c00', green: '#43a047' };

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

  // ------------------------------------------------------------- Torn API
  function apiKey() {
    if (PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER) return PDA_KEY;
    return (localStorage.getItem(K_APIKEY) || '').trim();
  }

  async function tornApi(path) {
    const key = apiKey();
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
    if (S.selector) {
      try {
        const el = document.querySelector(S.selector);
        if (el) return el;
      } catch (e) { /* bad selector, fall through */ }
    }
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
  let hostTitle = null;
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
    if (hostTitle !== null) host.setAttribute('title', hostTitle);
    else host.removeAttribute('title');
    host = null;
    hostTitle = null;
  }

  function paint(color, tip) {
    const el = findClock();
    if (el !== host) {
      clearHost();
      if (el) {
        host = el;
        hostTitle = el.getAttribute('title');
      }
    }
    const float = document.getElementById('ter-float');
    if (!host) {
      // No clock found: a small floating dot instead, which also opens the settings.
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
      d.style.background = color ? COLOR[color] : '#666';
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
    if (color) host.setAttribute('title', tip);
    else if (hostTitle !== null) host.setAttribute('title', hostTitle);
    else host.removeAttribute('title');
  }

  // ------------------------------------------------------------- main loop
  function update() {
    const t = now();
    let best = null;
    const lines = [];
    Object.values(EV)
      .filter((ev) => ev.enabled && ev.kind !== 'custom')
      .map((ev) => ({ ev, st: stateOf(ev, t), ...times(ev) }))
      .filter((x) => x.st)
      .sort((a, b) => RANK[b.st] - RANK[a.st] || a.start - b.start)
      .forEach((x) => {
        if (!best || RANK[x.st] > RANK[best]) best = x.st;
        lines.push(x.st === 'green'
          ? `${x.ev.title}: live, ends in ${fmtLeft(x.end - t)}`
          : `${x.ev.title}: starts in ${fmtLeft(x.start - t)} (${fmtTct(x.start)} TCT)`);
      });
    paint(best, lines.join('\n'));
    mountUI();
  }

  // ------------------------------------------------------------- clock dropdown row
  // A new row under the time in Torn's clock dropdown: this month's events,
  // a checkbox each. Event times are Torn's, only the reminder windows are editable.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ui = { tab: 'month', gear: false };

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

  function listRows() {
    const t = now();
    const d = new Date(t * 1000);
    const mStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    const mEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
    return Object.values(EV)
      .filter((ev) => ev.kind !== 'custom')
      .map((ev) => ({ ev, ...times(ev) }))
      .filter((x) => x.start)
      .map((x) => Object.assign(x, { carried: x.start < mStart && x.end > t }))
      .filter((x) => ui.tab === 'all' || (x.start >= mStart && x.start < mEnd) || x.carried)
      .sort((a, b) => a.start - b.start);
  }

  function rowHtml({ ev, start, end, carried }) {
    const t = now();
    const st = ev.enabled ? stateOf(ev, t) : null;
    const past = end <= t;
    const when = t >= start && t < end ? `live, ${fmtLeft(end - t)} left`
      : t < start ? `in ${fmtLeft(start - t)}` : 'ended';
    const from = carried ? `<span class="ter-tag">from ${MONTHS[new Date(start * 1000).getUTCMonth()]}</span>` : '';
    return `
      <label class="ter-ev${ev.enabled ? '' : ' ter-off'}${past ? ' ter-past' : ''}" data-id="${esc(ev.id)}" title="${esc(ev.desc || '')}">
        <span class="ter-line">
          <input type="checkbox" data-f="enabled" ${ev.enabled ? 'checked' : ''}>
          <span class="ter-sw${st ? ' ter-' + st + '-bg' : ''}"></span>
          <span class="ter-name">${esc(ev.title)}</span>${from}
        </span>
        <span class="ter-when">${fmtDay(start)} → ${fmtDay(end)} · ${when}</span>
      </label>`;
  }

  function gearHtml() {
    const isPda = PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER;
    const src = { api: 'auto, API', calendar: 'auto, calendar page', manual: 'yours' }[S.startSource] || 'unknown';
    const status = S.lastError ? `<span class="ter-err">${esc(S.lastError)}</span>`
      : S.lastFetch ? `updated ${fmtDay(S.lastFetch)}` : 'not fetched';
    return `
      <div class="ter-gear">
        ${isPda ? '' : `<label>API key <input type="password" data-k="apikey" value="${esc(localStorage.getItem(K_APIKEY) || '')}" placeholder="Public key" autocomplete="off" spellcheck="false"></label>`}
        <div class="ter-muted">${status} · <a href="#" data-act="refresh">refresh</a>${isPda ? ' · PDA key' : ''}</div>
        <label>Your start <input type="time" data-k="startTime" value="${esc(S.startTime || '')}"><span class="ter-muted">${esc(src)}${S.startSource === 'manual' ? ' · <a href="#" data-act="autostart">auto</a>' : ''}</span></label>
        <label><span class="ter-sw ter-red-bg"></span>Red <input type="number" min="0" step="0.5" data-k="redHours" value="${S.redHours}"> h before</label>
        <label><span class="ter-sw ter-orange-bg"></span>Orange <input type="number" min="0" step="0.25" data-k="orangeHours" value="${S.orangeHours}"> h before</label>
        <label><span class="ter-sw ter-green-bg"></span>Green <input type="number" min="0" step="0.5" data-k="greenHours" value="${S.greenHours}"> h, 0 = all event</label>
        <label><input type="checkbox" data-k="showDot" ${S.showDot ? 'checked' : ''}> Dot on clock</label>
        <label>Clock selector <input type="text" data-k="selector" value="${esc(S.selector)}" placeholder="auto" spellcheck="false"></label>
      </div>`;
  }

  function uiHtml() {
    const rows = listRows();
    return `
      <div class="ter-top">
        <span class="ter-tabs">
          <a href="#" data-act="tab-month" class="${ui.tab === 'month' ? 'on' : ''}">This month's events</a>
          <a href="#" data-act="tab-all" class="${ui.tab === 'all' ? 'on' : ''}">All</a>
        </span>
        <a href="#" data-act="gear" class="ter-cog${ui.gear ? ' on' : ''}" title="Settings">⚙</a>
      </div>
      ${ui.gear ? gearHtml() : ''}
      <div class="ter-list">
        ${rows.length ? rows.map(rowHtml).join('') : `<div class="ter-muted">${Object.keys(EV).length ? 'Nothing this month.' : 'No events yet. Add an API key (⚙) or open the <a href="/calendar.php">calendar</a> once.'}</div>`}
      </div>
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
        if (type === 'keydown' && e.key === 'Enter' && e.target.matches('input')) e.target.blur();
        e.stopPropagation();
      }));
    box.addEventListener('change', (e) => { onUiChange(e); e.stopPropagation(); });
    return box;
  }

  function mountUI() {
    document.querySelectorAll(TOOLTIP).forEach((tip) => {
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
      if (k === 'apikey') {
        const v = el.value.trim();
        if (v) localStorage.setItem(K_APIKEY, v); else localStorage.removeItem(K_APIKEY);
        refreshFromApi(true);
        return;
      }
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
    if (act === 'tab-month' || act === 'tab-all') ui.tab = act.slice(4);
    else if (act === 'gear') ui.gear = !ui.gear;
    else if (act === 'refresh') refreshFromApi(true);
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
      #ter-float .ter-ui { background: #222; border-radius: 6px; padding: 6px 8px; box-shadow: 0 2px 12px rgba(0,0,0,.6); }

      .ter-ui {
        margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.15);
        width: 250px; max-width: 80vw; text-align: left; color: #ddd; cursor: default;
        font: 11px/1.35 Arial, sans-serif; white-space: normal; filter: none !important;
      }
      .ter-ui a { color: #8ab4f8; text-decoration: none; cursor: pointer; }
      .ter-ui .ter-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .ter-ui .ter-tabs a { color: #999; margin-right: 8px; }
      .ter-ui .ter-tabs a.on { color: #eee; font-weight: bold; }
      .ter-ui .ter-cog { color: #999; font-size: 13px; }
      .ter-ui .ter-cog.on { color: #eee; }
      .ter-ui .ter-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
      .ter-ui .ter-ev { display: block; cursor: pointer; padding: 3px 4px; border-radius: 4px; background: rgba(255,255,255,.05); }
      .ter-ui .ter-off { opacity: .5; }
      .ter-ui .ter-past .ter-name { text-decoration: line-through; }
      .ter-ui .ter-line { display: flex; align-items: center; gap: 4px; }
      .ter-ui .ter-line input { margin: 0; width: 12px; height: 12px; }
      .ter-ui .ter-name { font-weight: bold; color: #eee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ter-ui .ter-when { display: block; color: #aaa; padding-left: 16px; }
      .ter-ui input[type=text], .ter-ui input[type=password], .ter-ui input[type=number], .ter-ui input[type=time] {
        background: #1a1a1a; color: #eee; border: 1px solid #555; border-radius: 3px; padding: 2px 4px;
        font-size: 11px; box-sizing: border-box; min-width: 0; color-scheme: dark; height: auto;
      }
      .ter-ui input[type=number] { width: 48px; }
      .ter-ui button { background: #3a3a3a; color: #ddd; border: 1px solid #555; border-radius: 3px; padding: 2px 8px; cursor: pointer; font-size: 11px; }
      .ter-ui .ter-gear { display: flex; flex-direction: column; gap: 4px; padding: 4px; margin-bottom: 4px; border-radius: 4px; background: rgba(255,255,255,.05); }
      .ter-ui .ter-gear label { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .ter-ui .ter-gear input[type=password], .ter-ui .ter-gear input[type=text] { flex: 1; }
      .ter-ui .ter-tag { font-size: 10px; color: #bbb; background: #444; border-radius: 3px; padding: 0 4px; white-space: nowrap; }
      .ter-ui .ter-sw { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: #555; }
      .ter-ui .ter-red-bg { background: ${COLOR.red}; }
      .ter-ui .ter-orange-bg { background: ${COLOR.orange}; }
      .ter-ui .ter-green-bg { background: ${COLOR.green}; }
      .ter-ui .ter-muted { color: #888; }
      .ter-ui .ter-err { color: #ff7b72; }
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
    refreshFromApi(false);
    setInterval(() => refreshFromApi(false), 30 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
