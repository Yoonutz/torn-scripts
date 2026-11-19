// Event Reminder (the Greasy Fork script "Torn Event reminder", 602082, moved into OCC):
// colors Torn's header clock red, orange and green as calendar events and your faction's ranked war
// come close and go live, and adds a list of events to the clock dropdown.
// Data: GET torn/calendar + user/calendar (6 h), user/faction + faction/wars (30 min), and the
// calendar page when you open it. Nothing on a hidden tab. Torn key: the one in OCC Setup.
// Events and settings stay in the same ter.* localStorage as the standalone, so nothing is lost.
// Class prefix occ-er (the standalone uses ter-), so a co-installed old copy never touches this one.

import { store } from '../../occ-kit/core/storage.js';
import { esc } from '../../occ-kit/core/dom.js';

const DAY = 86400;
const HOUR = 3600;
const TICK_MS = 5000;
const API_REFRESH_S = 6 * HOUR;
const WAR_REFRESH_S = 30 * 60;
const WAR_ID = 'w:ranked';
// Torn API errors that mean the key itself is wrong, paused or blocked:
// stop calling until the key changes.
const KEY_DEAD = [2, 10, 13, 18];

const K_SETTINGS = 'ter.settings';
const K_EVENTS = 'ter.events';
const DEFAULTS = {
  redHours: 24,        // red from this many hours before the start
  orangeHours: 3,      // orange from this many hours before the start
  greenHours: 0,       // green from this many hours before the start, 0 = from the start; always green while live
  showDot: true,       // small colored dot on the clock, visible even if the icon cannot be tinted
  newEventsOn: true,   // events seen for the first time start checked
  startTime: null,     // your personal event start time, 'HH:MM' TCT
  startSource: '',     // 'api' | 'calendar' | 'manual'
  lastFetch: 0,
  lastError: '',
  lastWar: 0,          // last faction/wars check
  warError: '',        // why the war check failed, '' when fine
  occKeyBad: '',       // last 4 of an OCC key Torn rejected (KEY_DEAD); no calls until it changes. Own field: the standalone's keyBad is a boolean
};

// Same ter.* localStorage keys as the standalone, through the kit's store.
let S = Object.assign({}, DEFAULTS, store.get(K_SETTINGS, {}));
let EV = store.get(K_EVENTS, null) || {};
const saveSettings = () => store.set(K_SETTINGS, S);
const saveEvents = () => store.set(K_EVENTS, EV);

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
  if (ev.kind === 'war') {
    // A ranked war has no fixed end: it stays live until the API gives one.
    const end = ev.warEnd || Math.max(now() + HOUR, ev.warStart + HOUR);
    return { start: ev.warStart || 0, end };
  }
  if (ev.kind === 'custom') return { start: ev.userStart || 0, end: ev.userEnd || (ev.userStart || 0) + DAY };
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
  if (t >= start && t < end) return 'green';
  if (t < start) {
    const left = start - t;
    if (left <= S.greenHours * HOUR) return 'green';
    if (left <= S.orangeHours * HOUR) return 'orange';
    if (left <= S.redHours * HOUR) return 'red';
  }
  return null;
}

// ------------------------------------------------------------- API key
// The Torn key is the one in OCC Setup (Tampermonkey storage, or the key Torn PDA filled in).
let kit = null;
const apiKey = () => (kit ? kit.tornKey() : '');
const keyBad = () => !!S.occKeyBad && S.occKeyBad === apiKey().slice(-4);

// ------------------------------------------------------------- Torn API
async function tornApi(path) {
  try {
    return await kit.torn(path);
  } catch (err) {
    // A dead key stops all calls until the key in OCC Setup changes.
    if (KEY_DEAD.includes(err.code)) { S.occKeyBad = apiKey().slice(-4); saveSettings(); }
    throw err;
  }
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
  if (!apiKey() || keyBad() || document.hidden) return Promise.resolve(false);
  refreshWar(force);
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

// ------------------------------------------------------------- ranked war
// faction/wars gives the next or current ranked war as
// { war_id, start, end, target, winner, factions: [{ id, name, score }] }.
let warFetching = null;
function refreshWar(force) {
  if (warFetching || !apiKey() || keyBad() || document.hidden) return warFetching;
  if (!force && now() - S.lastWar < WAR_REFRESH_S) return null;
  warFetching = (async () => {
    try {
      // Our own faction id, to name the other side. Optional: without it both names show.
      if (!S.factionId) {
        try { const f = await tornApi('user/faction'); S.factionId = f?.faction?.id || 0; } catch (e) { /* not needed */ }
      }
      const data = await tornApi('faction/wars');
      mergeWar(data?.wars?.ranked);
      S.warError = '';
    } catch (err) {
      S.warError = err.code === 16 ? 'The OCC key cannot read faction wars.' : String(err.message || err);
    } finally {
      S.lastWar = now();
      saveSettings();
      saveEvents();
      warFetching = null;
      update();
      renderUI();
    }
  })();
  return warFetching;
}

function mergeWar(rw) {
  const war = Array.isArray(rw) ? rw[0] : rw;
  if (!war || !war.start || (war.end && war.end < now())) { delete EV[WAR_ID]; return; }
  const facs = Array.isArray(war.factions) ? war.factions : Object.values(war.factions || {});
  // Our faction is the one the user's own faction id matches; without it, name both.
  const mine = S.factionId && facs.find((f) => +f.id === +S.factionId);
  const other = mine ? facs.find((f) => f !== mine) : null;
  const title = other ? `Ranked war vs ${other.name}` : `Ranked war: ${facs.map((f) => f.name).join(' vs ')}`;
  const old = EV[WAR_ID];
  const ev = old && old.warId === war.war_id ? old : { id: WAR_ID, kind: 'war', enabled: true };
  Object.assign(ev, { title, warId: war.war_id, warStart: war.start, warEnd: war.end || 0, desc: `Target ${war.target || '?'}` });
  EV[WAR_ID] = ev;
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
    if (el.closest('.occ-er-ui')) return;
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
      if (el.closest(TOOLTIP) || el.closest('.occ-er-ui, #occ-er-float') || el.classList.contains('occ-er-dot')) continue;
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
  if (icon) icon.classList.remove('occ-er-tint', 'occ-er-red', 'occ-er-orange', 'occ-er-green');
  icon = null;
  if (!host) return;
  host.classList.remove('occ-er-host', 'occ-er-red', 'occ-er-orange', 'occ-er-green');
  host.querySelectorAll(':scope > .occ-er-dot').forEach((d) => d.remove());
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
  const float = document.getElementById('occ-er-float');
  if (!host) {
    // No clock found: a small floating dot instead while something is due,
    // which also opens the list.
    if (!color) { if (float) float.remove(); return; }
    let f = float;
    if (!f) {
      f = document.createElement('div');
      f.id = 'occ-er-float';
      f.innerHTML = '<div class="occ-er-float-dot"></div>';
      f.querySelector('.occ-er-float-dot').addEventListener('click', () => {
        const box = f.querySelector('.occ-er-ui');
        if (box) box.remove(); else f.append(makeUI());
      });
      document.body.append(f);
    }
    const d = f.querySelector('.occ-er-float-dot');
    d.style.background = COLOR[color];
    d.title = tip || 'Event Reminder';
    return;
  }
  if (float) float.remove();
  const ic = iconOf(host);
  if (ic !== icon) {
    if (icon) icon.classList.remove('occ-er-tint', 'occ-er-red', 'occ-er-orange', 'occ-er-green');
    icon = ic;
  }
  host.classList.add('occ-er-host');
  icon.classList.add('occ-er-tint');
  ['red', 'orange', 'green'].forEach((c) => {
    host.classList.toggle('occ-er-' + c, c === color);
    icon.classList.toggle('occ-er-' + c, c === color);
  });
  let dot = host.querySelector(':scope > .occ-er-dot');
  if (color && S.showDot) {
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'occ-er-dot';
      host.append(dot);
    }
  } else if (dot) dot.remove();
}

// ------------------------------------------------------------- main loop
function update() {
  if (document.hidden) return;
  const t = now();
  let best = null;
  const lines = [];
  status = [];
  Object.values(EV)
    .filter((ev) => ev.enabled)
    .map((ev) => ({ ev, st: stateOf(ev, t), ...times(ev) }))
    .filter((x) => x.st)
    .sort((a, b) => RANK[b.st] - RANK[a.st] || a.start - b.start)
    .forEach((x) => {
      if (!best || RANK[x.st] > RANK[best]) best = x.st;
      const text = t >= x.start
        ? (x.ev.kind === 'war' && !x.ev.warEnd ? `${x.ev.title} live` : `${x.ev.title} live, ${fmtLeft(x.end - t)} left`)
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
const ui = { tab: 'month', gear: false };

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
  const when = t >= start && t < end ? (ev.kind === 'war' && !ev.warEnd ? 'live' : `live, ${fmtLeft(end - t)} left`)
    : t < start ? `starts in ${fmtLeft(start - t)}` : 'ended';
  const from = carried ? `<span class="occ-er-tag">from ${MONTHS[new Date(start * 1000).getUTCMonth()]}</span>` : '';
  const days = shortDate(start) === shortDate(end - 1) ? shortDate(start) : `${shortDate(start)}-${shortDate(end)}`;
  const tip = `${ev.desc ? ev.desc + '\n' : ''}${fmtTct(start)} until ${fmtTct(end)} TCT\n${when}`;
  return `
    <label class="occ-er-ev${ev.enabled && !past ? '' : ' occ-er-off'}${past ? ' occ-er-past' : ''}" data-id="${esc(ev.id)}" title="${esc(tip)}">
      <input type="checkbox" data-f="enabled" ${ev.enabled && !past ? 'checked' : ''}${past ? ' disabled' : ''}>
      <span class="occ-er-sw${st ? ' occ-er-' + st + '-bg' : ''}"></span>
      <span class="occ-er-name">${esc(ev.title)}</span>${from}
      <span class="occ-er-when">${days}</span>
      ${ev.kind === 'custom' ? `<a href="#" class="occ-er-ico" data-act="c-edit" data-id="${esc(ev.id)}" title="Edit">✎</a><a href="#" class="occ-er-ico" data-act="c-del" data-id="${esc(ev.id)}" title="Delete">✕</a>` : ''}
    </label>`;
}

function keyHtml() {
  const k = apiKey();
  return k
    ? `<div class="occ-er-muted">Torn key <code>••••${esc(k.slice(-4))}</code> from OCC Setup</div>`
    : '<div class="occ-er-err">No Torn key. Add it in OCC Setup.</div>';
}

function gearHtml() {
  const src = { api: 'auto, API', calendar: 'auto, calendar page', manual: 'yours' }[S.startSource] || 'unknown';
  const status = keyBad() ? '<span class="occ-er-err">Key rejected by Torn, set a new one in OCC Setup.</span>'
    : S.lastError ? `<span class="occ-er-err">${esc(S.lastError)}</span>`
    : S.lastFetch ? `updated ${fmtDay(S.lastFetch)}` : 'not fetched';
  // The gear opens only the API key part (always open while no key is set);
  // the reminder settings below are always shown.
  const keyOpen = ui.gear || !apiKey();
  return `
    <div class="occ-er-gear">
      ${keyOpen ? `
      ${keyHtml()}
      <div class="occ-er-muted">${status} · <a href="#" data-act="refresh">refresh</a></div>
      ${S.warError ? `<div class="occ-er-err">${esc(S.warError)}</div>` : ''}
      <hr class="occ-er-hr">` : ''}
      <label>Your start <input type="text" class="occ-er-num occ-er-time" data-k="startTime" data-kind="time" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="${esc(S.startTime || '')}"><span class="occ-er-muted">${esc(src)}${S.startSource === 'manual' ? ' · <a href="#" data-act="autostart">auto</a>' : ''}</span></label>
      <label><span class="occ-er-sw occ-er-red-bg"></span>Red <input type="text" class="occ-er-num" data-k="redHours" data-kind="hours" inputmode="decimal" value="${S.redHours}"> h before</label>
      <label><span class="occ-er-sw occ-er-orange-bg"></span>Orange <input type="text" class="occ-er-num" data-k="orangeHours" data-kind="hours" inputmode="decimal" value="${S.orangeHours}"> h before</label>
      <label><span class="occ-er-sw occ-er-green-bg"></span>Green <input type="text" class="occ-er-num" data-k="greenHours" data-kind="hours" inputmode="decimal" value="${S.greenHours}"> h before, 0 = at start</label>
      <label><input type="checkbox" data-k="showDot" ${S.showDot ? 'checked' : ''}> Dot on clock</label>
      <hr class="occ-er-hr">
    </div>`;
}

// ------------------------------------------------------------- own reminders
// Name, then either one whole day or a start and end date with times (DD/MM/YY, TCT).
// Plain themed text fields, no browser date or time pickers.
function pad2(n) { return String(n).padStart(2, '0'); }
function dateText(sec) { const d = new Date(sec * 1000); return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}`; }
function timeText(sec) { const d = new Date(sec * 1000); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; }

function parseDate(v) {
  const m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/.exec(String(v || '').trim());
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date().getUTCFullYear();
  const t = Date.UTC(y, +m[2] - 1, +m[1]) / 1000;
  const d = new Date(t * 1000);
  return d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 ? t : null;
}
function parseTime(v) {
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?$/.exec(String(v || '').trim());
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null;
  return +m[1] * HOUR + +(m[2] || 0) * 60;
}

function newForm(ev) {
  if (ev) {
    const allDay = ev.userStart % DAY === 0 && ev.userEnd - ev.userStart === DAY;
    return { id: ev.id, name: ev.title, allDay, from: dateText(ev.userStart), to: dateText(allDay ? ev.userEnd - DAY : ev.userEnd), fromT: timeText(ev.userStart), toT: timeText(ev.userEnd), err: '' };
  }
  const today = dateText(now());
  return { id: null, name: '', allDay: true, from: today, to: today, fromT: '', toT: '', err: '' };
}

const ICON_CAL = '<svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M4 0h2v2h4V0h2v2h2.5c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-13C.7 16 0 15.3 0 14.5v-11C0 2.7.7 2 1.5 2H4V0Zm-2 6v8h12V6H2Zm2 2h2v2H4V8Zm3 0h2v2H7V8Zm3 0h2v2h-2V8Zm-6 3h2v2H4v-2Zm3 0h2v2H7v-2Z"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm-1 2h2v3.6l2.7 2.7-1.4 1.4L7 8.4V4Z"/></svg>';
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Themed pickers, drawn under the row of the field they belong to.
function datePickerHtml(c) {
  const p = ui.pick;
  const sel = parseDate(ui.form[c]);
  const today = Math.floor(now() / DAY) * DAY;
  const first = Date.UTC(p.y, p.m, 1) / 1000;
  const lead = (new Date(first * 1000).getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(p.y, p.m + 1, 0)).getUTCDate();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const t = first + (d - 1) * DAY;
    cells += `<a href="#" data-act="p-day" data-v="${t}" class="${t === sel ? 'sel' : ''}${t === today ? ' today' : ''}">${d}</a>`;
  }
  return `
    <div class="occ-er-pick">
      <div class="occ-er-pick-head"><a href="#" data-act="p-prev">‹</a><b>${MONTHS[p.m]} ${p.y}</b><a href="#" data-act="p-next">›</a></div>
      <div class="occ-er-cal">${WEEKDAYS.map((w) => `<i>${w}</i>`).join('')}${cells}</div>
    </div>`;
}

function timePickerHtml(c) {
  const cur = parseTime(ui.form[c]);
  const h = ui.pick.h != null ? ui.pick.h : cur != null ? Math.floor(cur / HOUR) : null;
  const mins = cur != null && ui.pick.h == null ? Math.floor((cur % HOUR) / 60) : null;
  let hours = '';
  for (let i = 0; i < 24; i++) hours += `<a href="#" data-act="p-hour" data-v="${i}" class="${i === h ? 'sel' : ''}">${pad2(i)}</a>`;
  let minutes = '';
  for (let i = 0; i < 60; i += 5) minutes += `<a href="#" data-act="p-min" data-v="${i}" class="${i === mins ? 'sel' : ''}">:${pad2(i)}</a>`;
  return `
    <div class="occ-er-pick">
      <div class="occ-er-muted">Hour</div><div class="occ-er-grid6">${hours}</div>
      <div class="occ-er-muted">Minute</div><div class="occ-er-grid6">${minutes}</div>
    </div>`;
}

function formHtml() {
  const f = ui.form;
  if (!f) return '<div class="occ-er-foot"><a href="#" data-act="c-add">+ Add custom event</a></div>';
  const open = (c) => ui.pick && ui.pick.c === c;
  const field = (c, ph, cls = '') => `<input type="text" class="${cls}" data-c="${c}" value="${esc(f[c])}" placeholder="${ph}" autocomplete="off" spellcheck="false">`;
  const date = (c) => `<span class="occ-er-fld">${field(c, 'DD/MM/YY', 'occ-er-date')}<a href="#" class="occ-er-fico${open(c) ? ' on' : ''}" data-act="p-open" data-c="${c}" title="Pick a date">${ICON_CAL}</a></span>`;
  const time = (c) => `<span class="occ-er-fld">${field(c, 'HH:MM', 'occ-er-tm')}<a href="#" class="occ-er-fico${open(c) ? ' on' : ''}" data-act="p-open" data-c="${c}" title="Pick a time">${ICON_CLOCK}</a></span>`;
  const picker = (cs) => {
    const c = cs.find(open);
    if (!c) return '';
    return /T$/.test(c) ? timePickerHtml(c) : datePickerHtml(c);
  };
  return `
    <div class="occ-er-form">
      <div class="occ-er-ftitle">${f.id ? 'Edit custom event' : 'Add custom event'}</div>
      ${field('name', 'Event name', 'occ-er-cname')}
      <div class="occ-er-seg">
        <button data-act="c-allday" class="${f.allDay ? 'on' : ''}">All day</button><button data-act="c-custom" class="${f.allDay ? '' : 'on'}">Custom time</button>
      </div>
      ${f.allDay
        ? `<div class="occ-er-row"><span class="occ-er-lbl">Day</span>${date('from')}</div>${picker(['from'])}`
        : `<div class="occ-er-row"><span class="occ-er-lbl">From</span>${date('from')}${time('fromT')}</div>${picker(['from', 'fromT'])}
      <div class="occ-er-row"><span class="occ-er-lbl">To</span>${date('to')}${time('toT')}</div>${picker(['to', 'toT'])}`}
      <div class="occ-er-muted">Times in TCT.</div>
      ${f.err ? `<div class="occ-er-err">${esc(f.err)}</div>` : ''}
      <div class="occ-er-row occ-er-right-row"><button data-act="c-cancel">Cancel</button><button data-act="c-save">${f.id ? 'Save' : 'Add'}</button></div>
    </div>`;
}


function saveForm() {
  const f = ui.form;
  const name = f.name.trim();
  const d1 = parseDate(f.from);
  const d2 = f.allDay ? d1 : parseDate(f.to || f.from);
  if (!name) return (f.err = 'Give it a name.');
  if (d1 == null || d2 == null) return (f.err = 'Dates as DD/MM/YY, for example 31/10/26.');
  let start;
  let end;
  if (f.allDay) {
    start = d1;
    end = d1 + DAY;
  } else {
    const t1 = parseTime(f.fromT);
    const t2 = parseTime(f.toT);
    if (t1 == null || t2 == null) return (f.err = 'Times as HH:MM, for example 18:30.');
    start = d1 + t1;
    end = d2 + t2;
  }
  if (end <= start) return (f.err = 'The end has to be after the start.');
  const id = f.id || 'u:' + now() + Math.random().toString(36).slice(2, 6);
  EV[id] = Object.assign(EV[id] || { enabled: true }, { id, title: name, kind: 'custom', userStart: start, userEnd: end });
  ui.form = null;
  saveEvents();
  update();
  return null;
}

function uiHtml() {
  const rows = listRows();
  return `
    <div class="occ-er-top">
      <span class="occ-er-tabs">
        <a href="#" data-act="view" class="on" title="Switch view">${VIEWS[ui.tab]} ▾</a>
      </span>
      <a href="#" data-act="gear" class="occ-er-cog${ui.gear ? ' on' : ''}" title="Key and refresh">⚙</a>
    </div>
    ${gearHtml()}
    <div class="occ-er-list">
      ${rows.length ? rows.map(rowHtml).join('') : `<div class="occ-er-muted">${Object.keys(EV).length ? 'Nothing to show.' : 'No events yet. Add a Torn key in OCC Setup or open the <a href="/calendar.php">calendar</a> once.'}</div>`}
    </div>
    ${formHtml()}`;
}

function makeUI() {
  const box = document.createElement('div');
  box.className = 'occ-er-ui';
  box.innerHTML = uiHtml();
  // Keep Torn from closing the dropdown while the row is used.
  ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'keydown'].forEach((type) =>
    box.addEventListener(type, (e) => {
      if (type === 'click') onUiClick(e);
      if (type === 'keydown' && e.key === 'Enter' && e.target.matches('[data-c]')) box.querySelector('[data-act="c-save"]')?.click();
        else if (type === 'keydown' && e.key === 'Enter' && e.target.matches('input')) e.target.blur();
      e.stopPropagation();
    }));
  box.addEventListener('change', (e) => { onUiChange(e); e.stopPropagation(); });
  return box;
}

// Torn's time stays the first row; due events go in the row under it.
let status = [];
function mountUI() {
  const html = status.map((x) => `<div><span class="occ-er-sw occ-er-${x.st}-bg"></span>${esc(x.text)}</div>`).join('');
  document.querySelectorAll(TOOLTIP).forEach((tip) => {
    let row = tip.querySelector(':scope > .occ-er-status');
    if (!row) {
      row = document.createElement('div');
      row.className = 'occ-er-status';
      const time = tip.querySelector(':scope > p') || tip.firstElementChild;
      if (time) time.after(row); else tip.prepend(row);
    }
    if (row.innerHTML !== html) row.innerHTML = html;
    row.style.display = html ? '' : 'none';
    if (!tip.querySelector(':scope > .occ-er-ui')) tip.append(makeUI());
  });
}

function renderUI() {
  if (document.hidden) return;
  document.querySelectorAll('.occ-er-ui').forEach((box) => {
    // Never redraw under the user's fingers while a field is focused.
    if (box.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox])')) return;
    const scroll = box.querySelector('.occ-er-list')?.scrollTop || 0;
    box.innerHTML = uiHtml();
    const list = box.querySelector('.occ-er-list');
    if (list) list.scrollTop = scroll;
  });
}

function onUiChange(e) {
  const el = e.target;
  if (el.dataset.c && ui.form) { ui.form[el.dataset.c] = el.value; return; } // kept until Add/Save
  const k = el.dataset.k;
  if (k) {
      if (el.type === 'checkbox') S[k] = el.checked;
    else if (el.dataset.kind === 'hours') S[k] = Math.max(0, parseFloat(String(el.value).replace(',', '.')) || 0);
    else if (el.dataset.kind === 'time') {
      const m = /^(\d{1,2})[:.h]?(\d{2})?$/.exec(el.value.trim());
      if (el.value.trim() && (!m || +m[1] > 23 || +(m[2] || 0) > 59)) { renderUI(); return; } // invalid: put the old value back
      S[k] = m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : '';
    }
    else S[k] = el.value.trim();
    if (k === 'startTime') S.startSource = S.startTime ? 'manual' : '';
    saveSettings();
    el.blur();
    update();
    renderUI();
    return;
  }
  const row = el.closest('.occ-er-ev');
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
  else if (act === 'autostart') { S.startSource = ''; saveSettings(); refreshFromApi(true); }
  else if (act === 'c-add') { ui.form = newForm(); ui.pick = null; }
  else if (act === 'c-edit') { ui.form = newForm(EV[el.dataset.id]); ui.pick = null; }
  else if (act === 'c-del') { delete EV[el.dataset.id]; if (ui.form && ui.form.id === el.dataset.id) ui.form = null; saveEvents(); update(); }
  else if (act === 'c-cancel') { ui.form = null; ui.pick = null; }
  else if (act === 'c-allday' || act === 'c-custom' || act === 'c-save' || act.startsWith('p-')) {
    // Typed values that have not fired a change event yet.
    el.closest('.occ-er-form').querySelectorAll('input[data-c]').forEach((i) => { ui.form[i.dataset.c] = i.value; });
    if (act === 'c-save') { ui.pick = null; saveForm(); }
    else if (act === 'c-allday' || act === 'c-custom') { ui.pick = null; ui.form.allDay = act === 'c-allday'; }
    else if (act === 'p-open') {
      const c = el.dataset.c;
      if (ui.pick && ui.pick.c === c) ui.pick = null;
      else {
        const d = new Date((parseDate(ui.form[c]) ?? now()) * 1000);
        ui.pick = { c, y: d.getUTCFullYear(), m: d.getUTCMonth(), h: null };
      }
    } else if (act === 'p-prev' || act === 'p-next') {
      const m = ui.pick.m + (act === 'p-next' ? 1 : -1);
      ui.pick.y += Math.floor(m / 12);
      ui.pick.m = (m + 12) % 12;
    } else if (act === 'p-day') {
      ui.form[ui.pick.c] = dateText(+el.dataset.v);
      // Keep the end on or after a newly picked start.
      if (ui.pick.c === 'from' && !((parseDate(ui.form.to) ?? 0) >= +el.dataset.v)) ui.form.to = ui.form.from;
      ui.pick = null;
    } else if (act === 'p-hour') {
      ui.pick.h = +el.dataset.v;
      const cur = parseTime(ui.form[ui.pick.c]);
      ui.form[ui.pick.c] = `${pad2(ui.pick.h)}:${pad2(cur != null ? Math.floor((cur % HOUR) / 60) : 0)}`;
    } else if (act === 'p-min') {
      const cur = parseTime(ui.form[ui.pick.c]);
      const h = ui.pick.h != null ? ui.pick.h : cur != null ? Math.floor(cur / HOUR) : 0;
      ui.form[ui.pick.c] = `${pad2(h)}:${pad2(+el.dataset.v)}`;
      ui.pick = null;
    }
  }
  else return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  renderUI();
}

// ------------------------------------------------------------- styles
const CSS = `
    .occ-er-host { position: relative; }
    .occ-er-red { --occ-er: ${COLOR.red}; }
    .occ-er-orange { --occ-er: ${COLOR.orange}; }
    .occ-er-green { --occ-er: ${COLOR.green}; }
    .occ-er-tint.occ-er-red, .occ-er-tint.occ-er-orange, .occ-er-tint.occ-er-green {
      color: var(--occ-er) !important;
      filter: drop-shadow(0 0 3px var(--occ-er));
    }
    .occ-er-tint.occ-er-red *:not([fill="none"]), .occ-er-tint.occ-er-orange *:not([fill="none"]), .occ-er-tint.occ-er-green *:not([fill="none"]),
    svg.occ-er-tint.occ-er-red:not([fill="none"]), svg.occ-er-tint.occ-er-orange:not([fill="none"]), svg.occ-er-tint.occ-er-green:not([fill="none"]) { fill: var(--occ-er) !important; }
    .occ-er-tint.occ-er-red [stroke]:not([stroke="none"]), .occ-er-tint.occ-er-orange [stroke]:not([stroke="none"]), .occ-er-tint.occ-er-green [stroke]:not([stroke="none"]) { stroke: var(--occ-er) !important; }
    .occ-er-tint.occ-er-red stop, .occ-er-tint.occ-er-orange stop, .occ-er-tint.occ-er-green stop { stop-color: var(--occ-er) !important; }
    .occ-er-dot {
      position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%;
      background: var(--occ-er); box-shadow: 0 0 0 1px rgba(0,0,0,.6); pointer-events: none; z-index: 5;
    }
    #occ-er-float { position: fixed; right: 10px; bottom: 10px; z-index: 2147483646; display: flex; flex-direction: column-reverse; align-items: flex-end; gap: 6px; }
    #occ-er-float .occ-er-float-dot { width: 14px; height: 14px; border-radius: 50%; cursor: pointer; box-shadow: 0 0 6px rgba(0,0,0,.7); }
    #occ-er-float .occ-er-ui { background: var(--default-bg-panel-color, #333); border-radius: 6px; padding: 6px 8px; box-shadow: 0 2px 12px rgba(0,0,0,.6); }

    /* Torn sizes the clock tooltip for one line of text: let it grow around the new rows and sit on top. */
    ${TOOLTIP}:has(.occ-er-ui) {
      height: auto !important; max-height: none !important; min-height: 0 !important;
      width: auto !important; max-width: none !important; overflow: visible !important;
      z-index: 2147483000 !important;
    }
    ${TOOLTIP} .occ-er-ui, ${TOOLTIP} .occ-er-status { position: relative; z-index: 1; }
    .occ-er-status { white-space: nowrap; margin-top: 3px; font-size: 11px; line-height: 1.4; text-align: left; color: var(--default-color, #ddd); }
    .occ-er-status .occ-er-sw { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
    .occ-er-status .occ-er-red-bg { background: ${COLOR.red}; }
    .occ-er-status .occ-er-orange-bg { background: ${COLOR.orange}; }
    .occ-er-status .occ-er-green-bg { background: ${COLOR.green}; }
    .occ-er-ui {
      margin-top: 6px; padding-top: 6px;
      border-top: 1px solid var(--divider-dark-color, #222); box-shadow: inset 0 1px 0 var(--divider-light-color, #474747);
      width: 250px; max-width: 80vw; text-align: left; color: var(--default-color, #ddd); cursor: default;
      font-size: 11px; line-height: 1.4; white-space: normal; filter: none !important;
    }
    .occ-er-ui a { color: var(--default-blue-color, #74c0fc); text-decoration: none; cursor: pointer; }
    .occ-er-ui a:hover { color: var(--default-blue-hover-color, #a5d8ff); }
    .occ-er-ui .occ-er-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .occ-er-ui .occ-er-tabs a { color: var(--default-content-title-color, #999); margin-right: 8px; }
    .occ-er-ui .occ-er-tabs a.on { color: var(--tabs-color, #fff); text-shadow: var(--tabs-text-shadow, 0 0 2px #000); font-weight: bold; }
    .occ-er-ui .occ-er-cog { color: var(--default-content-title-color, #999); font-size: 13px; }
    .occ-er-ui .occ-er-cog.on, .occ-er-ui .occ-er-cog:hover { color: var(--default-white-color, #fff); }
    .occ-er-ui .occ-er-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
    /* Torn's header dropdown scrollbar colors */
    .occ-er-ui .occ-er-list {
      scrollbar-width: thin;
      scrollbar-color: var(--appheader-dropdown-list-scrollbar-thumb-color, #666) var(--appheader-dropdown-list-scrollbar-track-color, #222);
    }
    .occ-er-ui .occ-er-list::-webkit-scrollbar { width: 6px; }
    .occ-er-ui .occ-er-list::-webkit-scrollbar-track { background: var(--appheader-dropdown-list-scrollbar-track-color, #222); border-radius: 3px; }
    .occ-er-ui .occ-er-list::-webkit-scrollbar-thumb { background: var(--appheader-dropdown-list-scrollbar-thumb-color, #666); border-radius: 3px; }
    .occ-er-ui .occ-er-ev {
      display: flex; align-items: center; gap: 5px; cursor: pointer; padding: 3px 5px;
      background: var(--default-bg-panel-color, #333); border-bottom: 1px solid var(--panel-border-bottom-color, #3b3b3b);
    }
    .occ-er-ui .occ-er-ev:hover { background: var(--default-bg-panel-active-color, #444); }
    .occ-er-ui .occ-er-off { opacity: .5; }
    .occ-er-ui .occ-er-past { cursor: default; }
    .occ-er-ui .occ-er-past input[type=checkbox] { cursor: default; }
    .occ-er-ui .occ-er-past .occ-er-name, .occ-er-ui .occ-er-past .occ-er-when { text-decoration: line-through; }
    /* Torn-style checkbox instead of the browser's */
    .occ-er-ui input[type=checkbox] {
      -webkit-appearance: none; appearance: none; position: relative; margin: 0; flex: none;
      width: 12px; height: 12px; border-radius: 2px; cursor: pointer;
      border: 1px solid var(--checkbox-border-color, #aaa); background: var(--input-background-color, #000);
    }
    .occ-er-ui input[type=checkbox]:hover { border-color: var(--checkbox-hover-border-color, #fff); }
    .occ-er-ui input[type=checkbox]:checked::after {
      content: ''; position: absolute; left: 3px; top: 0; width: 3px; height: 7px;
      border: solid var(--checkbox-color, #ddd); border-width: 0 2px 2px 0; transform: rotate(45deg);
    }
    .occ-er-ui input[type=checkbox]:checked:hover::after { border-color: var(--checkbox-hover-color, #fff); }
    .occ-er-ui input[type=checkbox]:disabled { border-color: var(--checkbox-disabled-border-color, #555); cursor: default; }
    .occ-er-ui .occ-er-name { font-weight: bold; color: var(--default-color, #ddd); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .occ-er-ui .occ-er-when { margin-left: auto; padding-left: 6px; color: var(--default-content-title-color, #999); white-space: nowrap; }
    .occ-er-ui input[type=text] {
      color: var(--input-color, #fff); background: var(--input-background-color, linear-gradient(0deg, #111 0%, #000 100%));
      border: 1px solid var(--input-border-color, #444); border-radius: 5px; padding: 2px 5px;
      font-size: 11px; box-sizing: border-box; min-width: 0; height: 22px; outline: none;
    }
    .occ-er-ui input[type=text]:hover {
      border-color: var(--input-hover-border-color, #666); box-shadow: var(--input-hover-box-shadow, 0 0 2px #ffffff40);
    }
    .occ-er-ui input[type=text]:focus {
      border-color: var(--input-focus-border-color, #1864ab80); box-shadow: var(--input-focus-box-shadow, 0 0 2px #1c7ed6a6);
    }
    .occ-er-ui .occ-er-gear input[type=text].occ-er-num { flex: none; width: 44px; text-align: center; }
    .occ-er-ui .occ-er-gear input[type=text].occ-er-time { width: 52px; }
    .occ-er-ui input::-ms-reveal, .occ-er-ui input::-ms-clear { display: none; }
    .occ-er-ui input:-webkit-autofill { -webkit-text-fill-color: var(--input-color, #fff); box-shadow: 0 0 0 30px #000 inset; }
    .occ-er-ui input::placeholder { color: var(--input-disabled-color, #666); }
    .occ-er-ui button {
      color: var(--btn-color, #eee); text-shadow: var(--btn-text-shadow, 0 0 5px #000);
      background: var(--btn-background, linear-gradient(180deg, #111 0%, #555 25%, #333 60%, #333 78%, #111 100%));
      border: var(--btn-border, 1px solid #111); border-radius: 5px; padding: 0 10px; height: 22px;
      font-size: 11px; font-weight: bold; text-transform: uppercase; cursor: pointer;
    }
    .occ-er-ui button:hover {
      color: var(--btn-hover-color, #fff); text-shadow: var(--btn-hover-text-shadow, 0 0 5px #ffffff40);
      background: var(--btn-hover-background, linear-gradient(180deg, #333 0%, #777 25%, #333 59%, #666 78%, #333 100%));
    }
    .occ-er-ui button:active {
      color: var(--btn-active-color, #ddd); background: var(--btn-active-background, linear-gradient(180deg, #000 0%, #333 100%));
      box-shadow: var(--btn-active-box-shadow, inset 0 -1px 0 #ffffff12);
    }
    .occ-er-ui .occ-er-gear { display: flex; flex-direction: column; gap: 5px; padding: 6px; margin-bottom: 4px; background: var(--default-bg-panel-color, #333); }
    .occ-er-ui .occ-er-gear label { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .occ-er-ui .occ-er-gear input[type=text] { flex: 1; }
    .occ-er-ui .occ-er-tag { font-size: 10px; color: var(--default-full-text-color, #ccc); background: var(--default-bg-gray-color, rgba(221,221,221,.15)); border-radius: 3px; padding: 0 4px; white-space: nowrap; }
    .occ-er-ui .occ-er-sw { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--default-gray-e4-color, #444); }
    .occ-er-ui .occ-er-red-bg { background: ${COLOR.red}; }
    .occ-er-ui .occ-er-orange-bg { background: ${COLOR.orange}; }
    .occ-er-ui .occ-er-green-bg { background: ${COLOR.green}; }
    .occ-er-ui .occ-er-muted { color: var(--default-content-title-color, #999); }
    .occ-er-ui .occ-er-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .occ-er-ui code { color: var(--default-color, #ddd); }
    .occ-er-ui .occ-er-hr { border: 0; height: 0; width: 100%; margin: 2px 0; border-top: 1px solid var(--divider-dark-color, #222); border-bottom: 1px solid var(--divider-light-color, #474747); }
    .occ-er-ui .occ-er-foot { margin-top: 5px; }
    .occ-er-ui .occ-er-ico { color: var(--default-content-title-color, #999); padding: 0 1px; }
    .occ-er-ui .occ-er-ico:hover { color: var(--default-white-color, #fff); }
    .occ-er-ui .occ-er-form { display: flex; flex-direction: column; gap: 5px; margin-top: 5px; padding: 6px; background: var(--default-bg-panel-color, #333); }
    .occ-er-ui .occ-er-form input.occ-er-cname { width: 100%; }
    .occ-er-ui .occ-er-form input.occ-er-date { width: 74px; text-align: center; }
    .occ-er-ui .occ-er-form input.occ-er-tm { width: 52px; text-align: center; }
    .occ-er-ui .occ-er-lbl { width: 32px; color: var(--default-content-title-color, #999); }
    .occ-er-ui .occ-er-right-row { justify-content: flex-end; }
    .occ-er-ui .occ-er-seg { display: flex; }
    .occ-er-ui .occ-er-seg button { flex: 1; border-radius: 0; }
    .occ-er-ui .occ-er-seg button:first-child { border-radius: 5px 0 0 5px; }
    .occ-er-ui .occ-er-seg button:last-child { border-radius: 0 5px 5px 0; }
    .occ-er-ui .occ-er-seg button.on {
      color: var(--btn-active-color, #ddd); background: var(--btn-active-background, linear-gradient(180deg, #000 0%, #333 100%));
      box-shadow: var(--btn-active-box-shadow, inset 0 -1px 0 #ffffff12);
    }
    .occ-er-ui .occ-er-ftitle { font-weight: bold; color: var(--default-color, #ddd); }
    .occ-er-ui .occ-er-fld { position: relative; display: inline-flex; align-items: center; }
    .occ-er-ui .occ-er-fld input { padding-right: 20px !important; }
    .occ-er-ui .occ-er-fico { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); display: flex; color: var(--default-content-title-color, #999); }
    .occ-er-ui .occ-er-fico:hover, .occ-er-ui .occ-er-fico.on { color: var(--default-white-color, #fff); }
    .occ-er-ui .occ-er-form input.occ-er-date { width: 86px; }
    .occ-er-ui .occ-er-form input.occ-er-tm { width: 64px; }
    .occ-er-ui .occ-er-pick { background: var(--default-bg-panel-active-color, #444); border: 1px solid var(--divider-dark-color, #222); border-radius: 5px; padding: 5px; display: flex; flex-direction: column; gap: 3px; }
    .occ-er-ui .occ-er-pick-head { display: flex; justify-content: space-between; align-items: center; }
    .occ-er-ui .occ-er-pick-head a { padding: 0 6px; font-size: 14px; color: var(--default-color, #ddd); }
    .occ-er-ui .occ-er-cal, .occ-er-ui .occ-er-grid6 { display: grid; gap: 2px; text-align: center; }
    .occ-er-ui .occ-er-cal { grid-template-columns: repeat(7, 1fr); }
    .occ-er-ui .occ-er-grid6 { grid-template-columns: repeat(6, 1fr); }
    .occ-er-ui .occ-er-cal i { font-style: normal; color: var(--default-content-title-color, #999); font-size: 10px; }
    .occ-er-ui .occ-er-cal a, .occ-er-ui .occ-er-grid6 a { color: var(--default-color, #ddd); border-radius: 3px; padding: 2px 0; }
    .occ-er-ui .occ-er-cal a:hover, .occ-er-ui .occ-er-grid6 a:hover { background: var(--default-bg-panel-color, #333); color: var(--default-white-color, #fff); }
    .occ-er-ui .occ-er-cal a.today { box-shadow: inset 0 0 0 1px var(--default-content-title-color, #999); }
    .occ-er-ui .occ-er-cal a.sel, .occ-er-ui .occ-er-grid6 a.sel { background: var(--default-blue-dark-color, #00a9f9); color: #fff; }
    .occ-er-ui .occ-er-err { color: var(--default-red-color, #e54c19); }
  `;

// ------------------------------------------------------------- start
function start(k) {
  kit = k;
  // Keep tabs in sync when settings change elsewhere.
  window.addEventListener('storage', (e) => {
    if (e.key === K_SETTINGS) S = Object.assign({}, DEFAULTS, store.get(K_SETTINGS, {}));
    if (e.key === K_EVENTS) EV = store.get(K_EVENTS, null) || {};
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
  refreshWar(false);
  setInterval(() => { refreshFromApi(false); refreshWar(false); }, 5 * 60 * 1000);
  // Timers skip hidden tabs; catch up when the tab is shown again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    update();
    renderUI();
    refreshFromApi(false);
    refreshWar(false);
  });
}

export default {
  id: 'events',
  label: 'Event Reminder',
  about: 'Clock turns red, orange, green before events and ranked wars.',
  access: 'minimal',
  start,
  css: CSS,
};
