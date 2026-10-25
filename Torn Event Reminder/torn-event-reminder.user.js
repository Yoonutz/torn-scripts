// ==UserScript==
// @name         Torn Event reminder
// @namespace    kamiren.torn-event-reminder
// @version      1.0.0
// @description  Colors Torn's header clock as calendar events approach: red 1 day before, orange when soon, green while live. Reads your personal event start time from the API or the calendar page. Pick which events to watch and edit every time and threshold.
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_registerMenuCommand
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

  function toInput(sec) {
    return sec ? new Date(sec * 1000).toISOString().slice(0, 16) : '';
  }
  function fromInput(v) {
    const t = Date.parse(v + ':00Z');
    return isNaN(t) ? null : Math.floor(t / 1000);
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

  // Your own edit wins, then what the calendar page showed, then the API.
  function times(ev) {
    if (ev.userStart) return { start: ev.userStart, end: ev.userEnd || ev.userStart + DAY };
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
      if (ev.userEnd && ev.userEnd < t) { delete ev.userStart; delete ev.userEnd; }
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
        if (panel) renderPanel();
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
      if (el.closest('#ter-panel')) return;
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
      if (panel) renderPanel();
    }
  }

  function watchCalendar() {
    if (!/\/calendar\.php/i.test(location.pathname)) return;
    let timer = null;
    const run = () => { clearTimeout(timer); timer = setTimeout(() => { scrapeCalendar(); addCalendarButton(); }, 400); };
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    run();
  }

  function addCalendarButton() {
    if (document.getElementById('ter-cal-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ter-cal-btn';
    btn.type = 'button';
    btn.textContent = '⏰ Event reminder';
    btn.addEventListener('click', openPanel);
    document.body.append(btn);
  }

  // ------------------------------------------------------------- clock icon
  const CANDIDATES = [
    '#server-time',
    '[id*="clock" i]',
    '[class*="clock" i]',
    '[aria-label*="clock" i]',
    '[title*="clock" i]',
    '[class*="server-time" i]',
    '.server-date-time',
  ];

  function nearTop(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top + window.scrollY < 260;
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
        if (el.closest('#ter-panel, #ter-float') || el.classList.contains('ter-dot')) continue;
        if (nearTop(el)) return el;
      }
    }
    return null;
  }

  let host = null;
  let hostTitle = null;

  function clearHost() {
    if (!host) return;
    host.classList.remove('ter-host', 'ter-red', 'ter-orange', 'ter-green');
    host.querySelectorAll(':scope > .ter-dot').forEach((d) => d.remove());
    if (hostTitle !== null) host.setAttribute('title', hostTitle);
    else host.removeAttribute('title');
    host = null;
    hostTitle = null;
  }

  function paint(color, tip) {
    let el = findClock();
    if (el !== host) {
      clearHost();
      if (el) {
        host = el;
        hostTitle = el.getAttribute('title');
        if (!el.dataset.terBound) {
          el.dataset.terBound = '1';
          el.addEventListener('dblclick', openPanel);
        }
      }
    }
    const float = document.getElementById('ter-float');
    if (!host) {
      // No clock found: show a small floating badge instead, only while something is due.
      if (!color) { if (float) float.remove(); return; }
      let f = float;
      if (!f) {
        f = document.createElement('div');
        f.id = 'ter-float';
        f.addEventListener('click', openPanel);
        document.body.append(f);
      }
      f.style.background = COLOR[color];
      f.title = tip;
      return;
    }
    if (float) float.remove();
    host.classList.add('ter-host');
    ['red', 'orange', 'green'].forEach((c) => host.classList.toggle('ter-' + c, c === color));
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
      .filter((ev) => ev.enabled)
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
  }

  // ------------------------------------------------------------- settings panel
  let panel = null;
  let showPast = false;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function openPanel(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'ter-panel';
    panel.addEventListener('click', (ev) => { if (ev.target === panel) closePanel(); });
    document.body.append(panel);
    renderPanel();
    refreshFromApi(false);
  }

  function closePanel() {
    if (panel) panel.remove();
    panel = null;
  }

  function renderPanel() {
    if (!panel) return;
    const t = now();
    const isPda = PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER;
    const rows = Object.values(EV)
      .map((ev) => ({ ev, ...times(ev) }))
      .filter((x) => showPast || !x.end || x.end > t)
      .sort((a, b) => (a.start || 9e12) - (b.start || 9e12));

    const src = { api: 'from API', calendar: 'from calendar page', manual: 'set by you' }[S.startSource] || 'unknown, assumed 00:00';
    const status = S.lastError ? `<span class="ter-err">${esc(S.lastError)}</span>`
      : S.lastFetch ? `Updated ${fmtTct(S.lastFetch)} TCT` : 'Not fetched yet';

    panel.innerHTML = `
      <div class="ter-box">
        <div class="ter-head"><b>Torn Event reminder</b><button class="ter-x" data-act="close" title="Close">✕</button></div>
        <div class="ter-sec">
          ${isPda ? '<div>API key: from Torn PDA</div>' : `
          <label>API key (Public is enough)
            <input type="password" data-k="apikey" value="${esc(localStorage.getItem(K_APIKEY) || '')}" autocomplete="off" spellcheck="false">
          </label>`}
          <div class="ter-row"><button data-act="refresh">Refresh from API</button><span class="ter-muted">${status}</span></div>
          <div class="ter-muted">No key? Open the <a href="/calendar.php">calendar</a> once and the times are read from the page.</div>
        </div>
        <div class="ter-sec ter-grid">
          <label>Your event start (TCT)
            <input type="time" data-k="startTime" value="${esc(S.startTime || '')}">
            <span class="ter-muted">${esc(src)}${S.startSource === 'manual' ? ' · <a href="#" data-act="autostart">use auto</a>' : ''}</span>
          </label>
          <label><span><span class="ter-sw ter-red-bg"></span>Red, hours before start</span>
            <input type="number" min="0" step="0.5" data-k="redHours" value="${S.redHours}"></label>
          <label><span><span class="ter-sw ter-orange-bg"></span>Orange, hours before start</span>
            <input type="number" min="0" step="0.25" data-k="orangeHours" value="${S.orangeHours}"></label>
          <label><span><span class="ter-sw ter-green-bg"></span>Green, hours after start (0 = whole event)</span>
            <input type="number" min="0" step="0.5" data-k="greenHours" value="${S.greenHours}"></label>
          <label class="ter-chk"><input type="checkbox" data-k="showDot" ${S.showDot ? 'checked' : ''}> Dot on the clock</label>
          <label class="ter-chk"><input type="checkbox" data-k="newEventsOn" ${S.newEventsOn ? 'checked' : ''}> New events start checked</label>
        </div>
        <div class="ter-sec">
          <div class="ter-row">
            <b>Events</b>
            <span class="ter-muted">times in TCT</span>
            <label class="ter-chk ter-right"><input type="checkbox" data-act="past" ${showPast ? 'checked' : ''}> Show past</label>
          </div>
          <div class="ter-list">
            ${rows.length ? rows.map(({ ev, start, end }) => {
              const st = ev.enabled ? stateOf(ev, t) : null;
              const edited = !!ev.userStart;
              return `
              <div class="ter-ev${ev.enabled ? '' : ' ter-off'}" data-id="${esc(ev.id)}">
                <label class="ter-chk ter-title" title="${esc(ev.desc || '')}">
                  <input type="checkbox" data-f="enabled" ${ev.enabled ? 'checked' : ''}>
                  ${st ? `<span class="ter-sw ter-${st}-bg"></span>` : ''}
                  ${ev.kind === 'custom' ? `<input type="text" data-f="title" value="${esc(ev.title)}">` : esc(ev.title)}
                  ${ev.kind === 'competition' ? '<span class="ter-tag">competition</span>' : ''}
                  ${ev.kind === 'custom' ? '<span class="ter-tag">custom</span>' : ''}
                  ${edited && ev.kind !== 'custom' ? '<span class="ter-tag">edited</span>' : ''}
                </label>
                <div class="ter-times">
                  <input type="datetime-local" data-f="start" value="${toInput(start)}">
                  <span>→</span>
                  <input type="datetime-local" data-f="end" value="${toInput(end)}">
                  ${edited && ev.kind !== 'custom' ? '<button data-f="reset" title="Back to Torn times">↺</button>' : ''}
                  ${ev.kind === 'custom' ? '<button data-f="delete" title="Delete">🗑</button>' : ''}
                </div>
              </div>`;
            }).join('') : '<div class="ter-muted">No events yet. Add an API key or open the calendar page.</div>'}
          </div>
          <div class="ter-row"><button data-act="add">+ Add own event</button></div>
        </div>
        <div class="ter-sec">
          <label>Clock selector (only if the clock is not found)
            <input type="text" data-k="selector" value="${esc(S.selector)}" placeholder="auto" spellcheck="false"></label>
          <div class="ter-muted">Clock ${host ? 'found' : 'not found, a floating dot is used'}. Double-click the clock to open this panel.</div>
        </div>
      </div>`;
  }

  function onPanelChange(e) {
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
      if (k === 'startTime') { S.startSource = S.startTime ? 'manual' : ''; }
      saveSettings();
      update();
      if (k === 'startTime' || k === 'selector') renderPanel();
      return;
    }
    if (el.dataset.act === 'past') { showPast = el.checked; renderPanel(); return; }
    const row = el.closest('.ter-ev');
    if (!row) return;
    const ev = EV[row.dataset.id];
    if (!ev) return;
    const f = el.dataset.f;
    if (f === 'enabled') ev.enabled = el.checked;
    if (f === 'title') ev.title = el.value.trim() || 'My event';
    if (f === 'start' || f === 'end') {
      const cur = times(ev);
      const v = fromInput(el.value);
      if (!v) return;
      let start = f === 'start' ? v : cur.start;
      let end = f === 'end' ? v : cur.end;
      if (f === 'start' && cur.end > cur.start) end = start + (cur.end - cur.start); // keep the length when moving the start
      if (end <= start) end = start + DAY;
      ev.userStart = start;
      ev.userEnd = end;
    }
    saveEvents();
    update();
    renderPanel();
  }

  function onPanelClick(e) {
    const el = e.target.closest('[data-act], [data-f]');
    if (!el || !panel || !panel.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'close') return closePanel();
    if (act === 'refresh') { e.preventDefault(); refreshFromApi(true); return; }
    if (act === 'autostart') { e.preventDefault(); S.startSource = ''; S.lastFetch = 0; saveSettings(); refreshFromApi(true); renderPanel(); return; }
    if (act === 'add') {
      const t = now();
      const id = 'u:' + t + Math.random().toString(36).slice(2, 6);
      const start = Math.ceil(t / HOUR) * HOUR + DAY;
      EV[id] = { id, title: 'My event', kind: 'custom', enabled: true, userStart: start, userEnd: start + DAY };
      saveEvents();
      renderPanel();
      const input = panel.querySelector(`[data-id="${CSS.escape(id)}"] input[data-f="title"]`);
      if (input) { input.scrollIntoView({ block: 'nearest' }); input.select(); }
      return;
    }
    const row = el.closest('.ter-ev');
    const ev = row && EV[row.dataset.id];
    if (!ev) return;
    if (el.dataset.f === 'reset') { delete ev.userStart; delete ev.userEnd; }
    else if (el.dataset.f === 'delete') { delete EV[ev.id]; }
    else return;
    saveEvents();
    update();
    renderPanel();
  }

  // ------------------------------------------------------------- styles
  function addStyles() {
    const css = `
      .ter-host { position: relative; }
      .ter-host.ter-red { --ter: ${COLOR.red}; }
      .ter-host.ter-orange { --ter: ${COLOR.orange}; }
      .ter-host.ter-green { --ter: ${COLOR.green}; }
      .ter-host.ter-red, .ter-host.ter-orange, .ter-host.ter-green {
        color: var(--ter) !important;
        filter: drop-shadow(0 0 3px var(--ter));
      }
      .ter-host.ter-red svg *:not([fill="none"]), .ter-host.ter-orange svg *:not([fill="none"]), .ter-host.ter-green svg *:not([fill="none"]) { fill: var(--ter) !important; }
      .ter-host.ter-red svg [stroke]:not([stroke="none"]), .ter-host.ter-orange svg [stroke]:not([stroke="none"]), .ter-host.ter-green svg [stroke]:not([stroke="none"]) { stroke: var(--ter) !important; }
      .ter-host.ter-red svg stop, .ter-host.ter-orange svg stop, .ter-host.ter-green svg stop { stop-color: var(--ter) !important; }
      .ter-dot {
        position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%;
        background: var(--ter); box-shadow: 0 0 0 1px rgba(0,0,0,.6); pointer-events: none; z-index: 5;
      }
      #ter-float {
        position: fixed; right: 10px; bottom: 10px; width: 14px; height: 14px; border-radius: 50%;
        z-index: 2147483646; cursor: pointer; box-shadow: 0 0 6px rgba(0,0,0,.7);
      }
      #ter-cal-btn {
        position: fixed; right: 12px; bottom: 12px; z-index: 2147483645; padding: 8px 12px;
        border-radius: 6px; border: 1px solid #555; background: #2b2b2b; color: #eee; cursor: pointer;
        font: 13px Arial, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,.5);
      }
      #ter-panel {
        position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.6);
        display: flex; align-items: flex-start; justify-content: center; padding: 16px; overflow: auto;
        font: 13px/1.4 Arial, sans-serif; color: #e8e8e8;
      }
      #ter-panel .ter-box { background: #2b2b2b; border-radius: 8px; width: 100%; max-width: 560px; box-shadow: 0 4px 24px rgba(0,0,0,.5); }
      #ter-panel .ter-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid #444; font-size: 15px; }
      #ter-panel .ter-sec { padding: 10px 14px; border-bottom: 1px solid #3a3a3a; display: flex; flex-direction: column; gap: 6px; }
      #ter-panel .ter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
      #ter-panel label { display: flex; flex-direction: column; gap: 3px; }
      #ter-panel .ter-chk { flex-direction: row; align-items: center; gap: 6px; }
      #ter-panel input[type=text], #ter-panel input[type=password], #ter-panel input[type=number], #ter-panel input[type=time], #ter-panel input[type=datetime-local] {
        background: #1e1e1e; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 5px 6px; font-size: 13px; box-sizing: border-box; min-width: 0; color-scheme: dark;
      }
      #ter-panel button { background: #3a3a3a; color: #ddd; border: 1px solid #555; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 13px; }
      #ter-panel button:hover { background: #474747; }
      #ter-panel .ter-x { padding: 2px 8px; }
      #ter-panel .ter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      #ter-panel .ter-right { margin-left: auto; }
      #ter-panel .ter-muted { color: #9a9a9a; font-size: 12px; }
      #ter-panel .ter-err { color: #ff7b72; font-size: 12px; }
      #ter-panel a { color: #8ab4f8; }
      #ter-panel .ter-list { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow: auto; }
      #ter-panel .ter-ev { background: #333; border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
      #ter-panel .ter-off { opacity: .55; }
      #ter-panel .ter-title { font-weight: bold; }
      #ter-panel .ter-times { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      #ter-panel .ter-times input { flex: 1 1 150px; }
      #ter-panel .ter-tag { font-weight: normal; font-size: 11px; color: #bbb; background: #444; border-radius: 3px; padding: 0 5px; }
      #ter-panel .ter-sw { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 2px; vertical-align: middle; }
      #ter-panel .ter-red-bg { background: ${COLOR.red}; }
      #ter-panel .ter-orange-bg { background: ${COLOR.orange}; }
      #ter-panel .ter-green-bg { background: ${COLOR.green}; }
      @media (max-width: 480px) { #ter-panel .ter-grid { grid-template-columns: 1fr; } }
    `;
    const style = document.createElement('style');
    style.id = 'ter-style';
    style.textContent = css;
    document.head.append(style);
  }

  // ------------------------------------------------------------- start
  function init() {
    addStyles();
    document.addEventListener('change', (e) => { if (panel && panel.contains(e.target)) onPanelChange(e); });
    document.addEventListener('click', (e) => { if (panel && panel.contains(e.target)) onPanelClick(e); });
    document.addEventListener('keydown', (e) => { if (panel && e.key === 'Escape') closePanel(); });
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Event reminder settings', openPanel);
    // Keep tabs in sync when settings change elsewhere.
    window.addEventListener('storage', (e) => {
      if (e.key === K_SETTINGS) S = Object.assign({}, DEFAULTS, load(K_SETTINGS, {}));
      if (e.key === K_EVENTS) EV = load(K_EVENTS, {});
      if (e.key === K_SETTINGS || e.key === K_EVENTS) { update(); if (panel) renderPanel(); }
    });
    watchCalendar();
    update();
    setInterval(update, TICK_MS);
    refreshFromApi(false);
    setInterval(() => refreshFromApi(false), 30 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
