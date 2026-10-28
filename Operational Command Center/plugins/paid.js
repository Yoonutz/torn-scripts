// Paid trains: how many paid trains each employee has left. Replaces the Company Training Companion
// and its Google Sheet. Everything Torn knows comes from the Torn API:
//   company/news cat=training  trains given (the news links carry the XID, so renames don't matter)
//   user/events                "You were sent $X from <employee>": payments
//   company/employees          names and ids
// The only state Torn does not keep is the ledger: confirmed payments, price per train, start
// balances and who is trained for free (pro bono). It lives on the private runner (/data/paid), one document per
// player, so phone and PC show the same numbers; Tampermonkey storage keeps a copy.
// No timed calls: it syncs when the company page or the tab opens, when a Torn tab comes back, and
// a few seconds after a Train click on the company page (it only listens to that click).
import { RUNNER } from '../../occ-kit/core/ai.js';

const KEY_LEDGER = 'occ.paid.ledger';
const KEY_NEWS = 'occ.paid.news';
const KEY_EV = 'occ.paid.ev';
const KEY_EMPS = 'occ.paid.emps';
const KEY_LOCK = 'occ.paid.lock';
const KEY_LAST = 'occ.paid.last';
const OLD_SNAPSHOT = 'tcw_paid_trains_snapshot_v1'; // the old Companion's cached sheet numbers
const PRICE = 500000;
const SYNC_GAP = 60000;
const EV_GAP = 5 * 60000;
const EMP_GAP = 6 * 3600000;
const LOCK_MS = 30000;
const PAGES = 40;
const AFTER_TRAIN = [4000, 15000];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let kit = null;
let doc = null; // { rev, value } as the runner last sent it
let news = null;
let ev = null;
let emps = null;
let errs = {};
let busy = false;
let tabView = null;
let open = {}; // employee rows expanded in the tab
let steps = {}; // trains picked for item payments in the inbox
let pricing = false; // price editor open in the tab

// ---------- pure parts (tested in occ-kit/tests) ----------

const nowSec = () => Math.floor(Date.now() / 1000);

export function newLedger(now) {
  return { v: 1, price: PRICE, since: now, auto: true, emp: {}, pays: [], skip: [], hold: [] };
}

// "Consultant <a href = http://www.torn.com/profiles.php?XID=2239897>Hookah12</a> has been trained by the director"
export function parseTraining(n) {
  const m = /XID=(\d+)[^>]*>\s*([^<]+?)\s*<\/a>\s*has been trained by the director/i.exec(String((n && n.text) || ''));
  return m ? [String(n.id), n.timestamp, m[1], m[2]] : null;
}

// 'You were sent $100,000,000 from <a href="...XID=2239897">Hookah12</a> with the message: Train me boss'
export function parsePayment(e) {
  const m = /^You were sent (.+?) from <a [^>]*?XID=(\d+)[^>]*>\s*([^<]+?)\s*<\/a>(?:\s+with the message:\s*([\s\S]*?))?\.?\s*$/.exec(String((e && e.event) || ''));
  if (!m) return null;
  const p = { id: String(e.id), ts: e.timestamp, emp: m[2], name: m[3], msg: (m[4] || '').trim() };
  if (/^\$[\d,]+$/.test(m[1])) p.money = Number(m[1].replace(/\D/g, ''));
  else p.items = m[1].replace(/<[^>]*>/g, '');
  return p;
}

// Adds a page of feed entries (each with id at [0] or .id, timestamp at [1] or .ts). Returns how many were new.
export function addPage(cache, entries) {
  const seen = new Set(cache.list.map(idOf));
  let fresh = 0;
  entries.forEach((x) => {
    if (!x || seen.has(idOf(x))) return;
    seen.add(idOf(x));
    cache.list.push(x);
    fresh++;
  });
  cache.list.sort((a, b) => tsOf(a) - tsOf(b));
  return fresh;
}

function idOf(x) {
  return Array.isArray(x) ? x[0] : x.id;
}

function tsOf(x) {
  return Array.isArray(x) ? x[1] : x.ts;
}

// Oldest moment any balance counts from: trains and payments before it are not needed.
export function needFrom(ledger) {
  let m = ledger.since;
  Object.keys(ledger.emp).forEach((id) => {
    const s = ledger.emp[id].start;
    if (typeof s === 'number' && s < m) m = s;
  });
  return m;
}

// left = start balance + paid trains since start - trains given since start. Someone trained for
// free (pro bono, ledger flag `daily` from the old sheet's -1 marker) has no balance at all: left 0,
// never owing, never counted in the totals.
export function balances(ledger, trainings, staff) {
  const out = {};
  const ids = new Set(Object.keys(ledger.emp).concat((staff || []).map((s) => s.id)));
  const names = {};
  (staff || []).forEach((s) => (names[s.id] = s.name));
  ids.forEach((id) => {
    const e = ledger.emp[id] || {};
    const start = typeof e.start === 'number' ? e.start : ledger.since;
    const pays = ledger.pays.filter((p) => p.emp === id && p.ts >= start);
    const paid = pays.reduce((a, p) => a + (p.trains || 0), 0);
    const used = trainings.filter((t) => t[2] === id && t[1] >= start).length;
    out[id] = {
      id,
      name: names[id] || e.name || '#' + id,
      staff: id in names,
      daily: !!e.daily,
      carry: e.carry || 0,
      start,
      paid,
      used,
      left: e.daily ? 0 : (e.carry || 0) + paid - used,
      last: pays.length ? pays[pays.length - 1] : null,
    };
  });
  return out;
}

// Payments from staff (or anyone in the ledger) since tracking began that are not decided yet.
export function inbox(ledger, payments, staff) {
  const who = new Set(Object.keys(ledger.emp).concat((staff || []).map((s) => s.id)));
  const done = new Set(ledger.pays.map((p) => p.id).concat(ledger.skip));
  return payments.filter((p) => p.ts >= ledger.since && who.has(p.emp) && !done.has(p.id));
}

// hold: payments you took back with Undo, never added on their own again.
// "600k", "$600,000", "0.6m" -> 600000. 0 when it is not a usable price.
export function parsePrice(text) {
  const m = /^\$?\s*([\d.,]+)\s*([km]?)$/i.exec(String(text || '').trim());
  if (!m) return 0;
  const unit = { k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1;
  const n = Math.round(Number(unit === 1 ? m[1].replace(/[.,]/g, '') : m[1].replace(/,/g, '')) * unit);
  return Number.isFinite(n) && n >= 1000 && n <= 1e9 ? n : 0;
}

export function autoTrains(ledger, p) {
  return ledger.auto !== false && (ledger.hold || []).indexOf(p.id) === -1 && typeof p.money === 'number' && /train/i.test(p.msg || '') ? Math.floor(p.money / (ledger.price || PRICE)) : 0;
}

// Old Companion snapshot { paidTrainsLeftByEmployee: { name: value }, updatedAtIso } -> start balances.
// -1 was its "trained for free" marker.
export function fromSnapshot(snap, staff) {
  const map = (snap && snap.paidTrainsLeftByEmployee) || {};
  const at = Math.floor(Date.parse((snap && snap.updatedAtIso) || '') / 1000);
  if (!at) return null;
  const rows = [];
  (staff || []).forEach((s) => {
    if (!Object.prototype.hasOwnProperty.call(map, s.name)) return;
    const n = parseInt(String(map[s.name]), 10);
    rows.push({ id: s.id, name: s.name, carry: n === -1 || !Number.isFinite(n) ? 0 : n, daily: n === -1 });
  });
  return { at, rows };
}

// ---------- runner + Torn ----------

async function runner(method, body) {
  const r = await kit.http({
    url: RUNNER + '/data/paid',
    method,
    headers: { Authorization: 'ApiKey ' + kit.tornKey(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    timeout: 20000,
  });
  return { status: r.status, json: kit.parseJson(r.text) };
}

function keepDoc(d) {
  doc = { rev: d.rev, value: d.value };
  kit.vault.set(KEY_LEDGER, doc);
}

async function loadLedger() {
  const r = await runner('GET');
  if (r.status !== 200) throw new Error(r.status === 403 ? 'The runner is private to its owner' : r.json.error || 'Runner HTTP ' + r.status);
  keepDoc(r.json);
}

// fn gets a copy of the ledger and returns the new one. A change made on another device in the
// meantime is fetched and fn runs again on top of it.
async function save(fn) {
  let base = doc || { rev: 0, value: null };
  for (let i = 0; i < 3; i++) {
    const value = fn(JSON.parse(JSON.stringify(base.value || newLedger(nowSec()))));
    const r = await runner('POST', { rev: base.rev, value });
    if (r.status === 200) {
      keepDoc(r.json);
      return;
    }
    if (r.status !== 409) throw new Error(r.json.error || 'Runner HTTP ' + r.status);
    base = { rev: r.json.rev, value: r.json.value };
  }
  throw new Error('Changed on another device at the same time, try again');
}

async function syncEmps(force) {
  if (!force && emps && Date.now() - emps.ts < EMP_GAP) return;
  const j = await kit.torn('company/employees');
  const raw = Array.isArray(j.employees) ? j.employees : Object.keys(j.employees || {}).map((id) => Object.assign({ id }, j.employees[id]));
  emps = { ts: Date.now(), list: raw.map((e) => ({ id: String(e.id), name: String(e.name || '') })) };
  kit.vault.set(KEY_EMPS, emps);
}

// Pages forward from the newest entry kept. Torn's from= is inclusive, so the same second comes back
// and addPage drops what it already has.
async function feed(cache, path, parse) {
  for (let i = 0; i < PAGES; i++) {
    const j = await kit.torn(path + '&sort=ASC&limit=100&from=' + cache.top);
    const raw = (j.news || j.events || []).filter((x) => x && typeof x.timestamp === 'number');
    if (!raw.length) break;
    const fresh = addPage(cache, raw.map(parse).filter(Boolean));
    const top = Math.max.apply(null, raw.map((x) => x.timestamp));
    if (top <= cache.top && !fresh) break;
    cache.top = Math.max(cache.top, top);
    if (raw.length < 100) break;
  }
}

async function syncNews() {
  const need = needFrom(doc.value);
  if (!news || news.from > need) news = { from: need, top: need, list: [] };
  await feed(news, 'company/news?cat=training&striptags=false', parseTraining);
  news.list = news.list.filter((t) => t[1] >= need);
  news.from = need;
  kit.vault.set(KEY_NEWS, news);
}

async function syncEvents() {
  const need = doc.value.since;
  if (!ev || ev.from > need) ev = { from: need, top: need, list: [] };
  await feed(ev, 'user/events?striptags=false', parsePayment);
  ev.list = ev.list.filter((p) => p.ts >= need);
  ev.from = need;
  ev.ts = Date.now();
  kit.vault.set(KEY_EV, ev);
  const auto = inbox(doc.value, ev.list, emps && emps.list).filter((p) => autoTrains(doc.value, p) > 0);
  if (auto.length)
    await save((l) => {
      const have = new Set(l.pays.map((p) => p.id));
      auto.forEach((p) => {
        if (!have.has(p.id)) l.pays.push({ id: p.id, emp: p.emp, ts: p.ts, money: p.money, trains: autoTrains(l, p), auto: true });
      });
      l.pays.sort((a, b) => a.ts - b.ts);
      return l;
    });
}

function tornErr(e, what) {
  if (e instanceof kit.TornApiError && (e.code === 6 || e.code === 7)) return what + ': needs a company director key';
  if (e instanceof kit.TornApiError && e.code === 16) return what + ': key access too low (needs Limited)';
  return what + ': ' + ((e && e.message) || e);
}

// One round: ledger, staff, trains, then payments when asked. Each part's error is kept for the UI.
async function sync(force, withEvents) {
  if (busy || !kit.tornKey()) return;
  const now = Date.now();
  if (!force && now - kit.store.get(KEY_LAST, 0) < SYNC_GAP && !(withEvents && (!ev || now - ev.ts > EV_GAP))) return;
  if (!force && now - kit.store.get(KEY_LOCK, 0) < LOCK_MS) return;
  kit.store.set(KEY_LOCK, now);
  busy = true;
  paintAll();
  errs = {};
  try {
    try {
      await loadLedger();
      if (!doc.value) await save((l) => l);
    } catch (e) {
      errs.ledger = 'Ledger: ' + e.message;
    }
    try {
      await syncEmps(force);
    } catch (e) {
      errs.emps = tornErr(e, 'Employees');
    }
    if (doc && doc.value) {
      try {
        await syncNews();
      } catch (e) {
        errs.news = tornErr(e, 'Training news');
      }
      if (withEvents && !errs.ledger) {
        try {
          await syncEvents();
        } catch (e) {
          errs.ev = tornErr(e, 'Payments');
        }
      }
    }
    kit.store.set(KEY_LAST, Date.now());
  } finally {
    busy = false;
    kit.store.del(KEY_LOCK);
    paintAll();
  }
}

// Balance taps (+1, -10...) show at once and are saved together a moment after the last tap, so a
// burst of taps is one write to the runner, not one each. No Torn API call either way.
let pending = {};
let pendTimer = 0;
const PEND_MS = 1200;

function withPending(l) {
  Object.keys(pending).forEach((id) => {
    const e = (l.emp[id] = l.emp[id] || { carry: 0, start: l.since });
    e.carry = (e.carry || 0) + pending[id];
  });
  return l;
}

function bump(id, name, start, d, btn) {
  pending[id] = (pending[id] || 0) + d;
  paintAll();
  clearTimeout(pendTimer);
  pendTimer = setTimeout(() => {
    const p = pending;
    pending = {};
    save((l) => {
      Object.keys(p).forEach((k) => {
        const e = (l.emp[k] = l.emp[k] || { carry: 0, start });
        if (k === id) e.name = name;
        e.carry = (e.carry || 0) + p[k];
      });
      return l;
    })
      .catch((e) => kit.toast.show(btn && btn.isConnected ? btn : document.querySelector('#occ-root .occ-pd-price'), 'Not saved: ' + e.message, true))
      .then(paintAll);
  }, PEND_MS);
}

function view() {
  if (!doc || !doc.value) return null;
  const l = Object.keys(pending).length ? withPending(JSON.parse(JSON.stringify(doc.value))) : doc.value;
  return balances(l, (news && news.list) || [], emps && emps.list);
}

// ---------- company page column ----------

function onCompany() {
  return /companies\.php/.test(location.pathname);
}

function cellText(b) {
  if (!b) return '-';
  if (b.daily) return 'Free';
  return String(b.left);
}

function cellTip(b) {
  if (!b) return 'Paid trains: not synced yet';
  if (b.daily) return b.name + ': trained for free (pro bono)';
  return b.name + ': ' + b.left + ' paid trains left (' + (b.carry ? 'start ' + b.carry + ', ' : '') + b.paid + ' paid, ' + b.used + ' given since ' + day(b.start) + ')';
}

function paintPage() {
  if (!onCompany() || !document.querySelector('.d .manage-company')) return;
  const header = document.querySelector('ul.employee-list-title.bold');
  const rows = document.querySelectorAll('ul.employee-list li[data-user]');
  if (!header || !rows.length) return;
  // The old Companion's own column (.paid-trains) is hidden by the CSS below while this one is on.
  document.documentElement.classList.add('occ-paid-on');
  if (!header.querySelector('li.occ-paid')) {
    const train = header.querySelector('li.train');
    if (train) {
      const li = kit.el('li', 'occ-paid', 'Paid<div class="t-delimiter"></div>');
      header.insertBefore(li, train);
    }
  }
  const b = view();
  rows.forEach((row) => {
    const body = row.querySelector('.acc-body');
    if (!body) return;
    let cell = body.querySelector('.occ-paid');
    if (!cell) {
      const train = body.querySelector('.train');
      if (!train) return;
      cell = kit.el('div', 'occ-paid', '<div class="r-delimiter white t-show"></div><div class="occ-paid-v"></div>');
      body.insertBefore(cell, train);
    }
    const x = b && b[row.getAttribute('data-user')];
    const v = cell.querySelector('.occ-paid-v');
    const t = cellText(x);
    if (v.textContent !== t) v.textContent = t;
    v.classList.toggle('neg', !!x && x.left < 0);
    v.classList.toggle('daily', !!x && x.daily);
    v.classList.toggle('stale', busy || !!errs.news);
    v.title = cellTip(x);
  });
  // Torn's content column is 784px; the column adds 42px. Same widths the old Companion used.
  const main = document.querySelector('#mainContainer');
  if (main && main.style.width !== '1018px') main.style.width = '1018px';
}

function watchPage() {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const h = document.querySelector('ul.employee-list-title.bold');
      if (!h) return;
      const missing = !h.querySelector('li.occ-paid') || Array.from(document.querySelectorAll('ul.employee-list li[data-user] .acc-body')).some((b) => !b.querySelector('.occ-paid'));
      if (missing) paintPage();
    });
  }).observe(document.body, { childList: true, subtree: true });
  let timers = [];
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest('.employee-list .train a, button, a') : null;
      if (!a || a.closest('#occ-root') || !/\btrain/i.test(a.textContent || '')) return;
      timers.forEach(clearTimeout);
      timers = AFTER_TRAIN.map((ms) => setTimeout(() => sync(true, false), ms));
    },
    true
  );
}

// ---------- tab ----------

function day(sec) {
  const d = new Date(sec * 1000);
  return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
}

function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Fits a stat tile: $202.8M, $14.0B.
function short(n) {
  return n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : money(n);
}

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago';
}

function small(label, fn, cls) {
  const b = kit.el('button', 'occ-pd-b' + (cls ? ' ' + cls : ''), label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn(b);
  });
  return b;
}

// Runs a ledger change from a button, shows a toast on failure, redraws everything.
async function act(btn, fn) {
  btn.disabled = true;
  try {
    await save(fn);
  } catch (e) {
    kit.toast.show(btn, e.message, true);
  }
  btn.disabled = false;
  paintAll();
}

function importCard(snap) {
  const imp = fromSnapshot(snap, emps && emps.list);
  if (!imp || !imp.rows.length) return null;
  const c = kit.ui.card('Import from the old Companion');
  const list = imp.rows
    .filter((r) => r.carry || r.daily)
    .map((r) => kit.esc(r.name) + ' ' + (r.daily ? 'free' : r.carry))
    .join(', ');
  c.appendChild(kit.el('div', 'occ-muted', 'Sheet numbers saved by the old script, from ' + day(imp.at) + '. ' + (list ? 'Non-zero: ' + list + '.' : 'All zero.') + ' Trains and payments after that time count on top.'));
  const bar = kit.el('div', 'occ-bar');
  // Tracking now starts at the sheet's time, so trains and payments since then are fetched again.
  const go = kit.ui.button('Import ' + imp.rows.length + ' balances', () =>
    act(go, (l) => {
      imp.rows.forEach((r) => {
        l.emp[r.id] = Object.assign(l.emp[r.id] || {}, { name: r.name, carry: r.carry, daily: r.daily, start: imp.at });
      });
      l.since = Math.min(l.since, imp.at);
      l.imported = nowSec();
      return l;
    }).then(() => sync(true, true))
  );
  bar.appendChild(go);
  bar.appendChild(kit.ui.button('Start from zero', () => act(go, (l) => Object.assign(l, { imported: nowSec() })), true));
  c.appendChild(bar);
  return c;
}

function inboxCard(list, l) {
  const c = kit.ui.card('New payments');
  c.appendChild(kit.el('div', 'occ-muted', 'Money or items your staff sent since tracking began. Count it as trains or skip it.'));
  list
    .slice()
    .reverse()
    .forEach((p) => {
      const r = kit.el('div', 'occ-pd-row');
      const what = p.money ? money(p.money) : kit.esc(p.items);
      r.appendChild(kit.el('div', 'occ-pd-txt', '<b>' + kit.esc(p.name) + '</b> ' + what + ' <span class="occ-muted">' + day(p.ts) + (p.msg ? ' · "' + kit.esc(p.msg) + '"' : '') + '</span>'));
      const ctl = kit.el('div', 'occ-pd-ctl');
      const fixed = p.money ? Math.floor(p.money / (l.price || PRICE)) : 0;
      if (!p.money) {
        if (!(p.id in steps)) steps[p.id] = 0;
        const n = kit.el('span', 'occ-pd-n', String(steps[p.id]));
        ctl.appendChild(small('−', () => ((steps[p.id] = Math.max(0, steps[p.id] - 1)), (n.textContent = steps[p.id]))));
        ctl.appendChild(n);
        ctl.appendChild(small('+', () => ((steps[p.id] = steps[p.id] + 1), (n.textContent = steps[p.id]))));
      }
      const add = small(p.money ? '+' + fixed + ' trains' : 'Add', () => {
        const t = p.money ? fixed : steps[p.id];
        if (!t) return kit.toast.show(add, 'Pick how many trains first', true);
        act(add, (x) => {
          if (!x.pays.some((y) => y.id === p.id)) x.pays.push({ id: p.id, emp: p.emp, ts: p.ts, money: p.money, items: p.items, trains: t });
          x.pays.sort((a, b) => a.ts - b.ts);
          return x;
        });
      }, 'go');
      ctl.appendChild(add);
      const skip = small('Not trains', () =>
        act(skip, (x) => {
          if (x.skip.indexOf(p.id) === -1) x.skip.push(p.id);
          return x;
        })
      );
      ctl.appendChild(skip);
      r.appendChild(ctl);
      c.appendChild(r);
    });
  return c;
}

function staffCard(b, snap) {
  const c = kit.ui.card('Employees');
  const old = snap && snap.paidTrainsLeftByEmployee;
  const t = kit.el('div', 'occ-tbl');
  const table = kit.el('table');
  table.innerHTML = '<tr><th>Name</th><th>Left</th><th>Last paid</th>' + (old ? '<th>Sheet</th>' : '') + '</tr>';
  const list = Object.values(b)
    .filter((x) => x.staff || x.left || x.daily)
    .sort((a, z) => Number(z.staff) - Number(a.staff) || a.left - z.left || a.name.localeCompare(z.name));
  list.forEach((x) => {
    const tr = kit.el('tr', 'occ-pd-emp' + (x.staff ? '' : ' gone'));
    const num = '<span class="' + (x.left < 0 ? 'occ-pd-neg' : x.left > 0 ? 'occ-pd-pos' : '') + '">' + x.left + '</span>';
    const left = x.daily ? '<span class="occ-pd-d" title="Trained for free (pro bono)">Free</span>' : num;
    const sheet = old && Object.prototype.hasOwnProperty.call(old, x.name) ? kit.esc(String(old[x.name] === '' ? 0 : old[x.name])) : '';
    tr.innerHTML = '<td><span class="occ-car">' + (open[x.id] ? '▼' : '▶') + '</span>' + kit.esc(x.name) + (x.staff ? '' : ' <span class="occ-muted">(left)</span>') + '</td><td>' + left + '</td><td>' + (x.last ? day(x.last.ts) : '-') + '</td>' + (old ? '<td class="occ-muted">' + sheet + '</td>' : '');
    tr.addEventListener('click', () => {
      open[x.id] = !open[x.id];
      paintAll();
    });
    table.appendChild(tr);
    if (open[x.id]) table.appendChild(detail(x, old ? 4 : 3));
  });
  t.appendChild(table);
  c.appendChild(t);
  c.appendChild(kit.el('div', 'occ-muted', 'Tap a name to open or close it: adjust the balance, mark it free (pro bono), undo a payment.'));
  return c;
}

function detail(x, cols) {
  const tr = kit.el('tr', 'occ-pd-more');
  const td = kit.el('td');
  td.colSpan = cols;
  td.appendChild(kit.el('div', 'occ-muted', x.daily ? 'Trained for free: ' + x.used + ' trains since ' + day(x.start) + ', nothing owed.' : 'Since ' + day(x.start) + ': start ' + x.carry + ' + ' + x.paid + ' paid - ' + x.used + ' given = ' + x.left));
  const bar = kit.el('div', 'occ-pd-ctl');
  const edit = (fn) => (btn) =>
    act(btn, (l) => {
      const e = (l.emp[x.id] = l.emp[x.id] || { name: x.name, carry: 0, start: x.start });
      e.name = x.name;
      fn(e);
      return l;
    });
  bar.appendChild(small(x.daily ? 'Free: yes' : 'Free: no', edit((e) => (e.daily = !e.daily)), x.daily ? 'go' : ''));
  if (!x.daily) [-10, -1, 1, 10].forEach((d) => bar.appendChild(small((d > 0 ? '+' : '−') + Math.abs(d), (btn) => bump(x.id, x.name, x.start, d, btn))));
  bar.appendChild(
    small('✕ Close', () => {
      open[x.id] = false;
      paintAll();
    }, 'shut')
  );
  td.appendChild(bar);
  const pays = doc.value.pays.filter((p) => p.emp === x.id).slice(-3).reverse();
  pays.forEach((p) => {
    const r = kit.el('div', 'occ-pd-row');
    r.appendChild(kit.el('div', 'occ-pd-txt', day(p.ts) + ' · ' + (p.money ? money(p.money) : kit.esc(p.items || '')) + ' = ' + p.trains + ' trains' + (p.auto ? ' <span class="occ-muted">(auto)</span>' : '')));
    const u = small('Undo', () =>
      act(u, (l) => {
        l.pays = l.pays.filter((y) => y.id !== p.id);
        l.hold = l.hold || [];
        if (l.hold.indexOf(p.id) === -1) l.hold.push(p.id);
        return l;
      })
    );
    r.appendChild(u);
    td.appendChild(r);
  });
  tr.appendChild(td);
  return tr;
}

// Price per train: a themed text field (no native number spinner). Saved on the runner.
function priceField(box, l, done) {
  const row = kit.el('div', 'occ-pd-ctl');
  row.appendChild(kit.el('span', 'occ-muted', 'Price per train'));
  const input = kit.el('input', 'occ-field occ-pd-in');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = String(l.price || PRICE);
  row.appendChild(input);
  const go = small('Save', () => {
    const n = parsePrice(input.value);
    if (!n) return kit.toast.show(go, 'Type a price like 600000, 600k or $600,000', true);
    act(go, (x) => {
      x.price = n;
      return x;
    }).then(() => {
      input.value = String(doc.value.price);
      kit.toast.show(go, 'Saved: ' + money(doc.value.price) + ' a train');
      if (done) done();
    });
  }, 'go');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go.click();
  });
  row.appendChild(go);
  if (done) row.appendChild(small('✕', done, 'shut'));
  box.appendChild(row);
  box.appendChild(kit.el('div', 'occ-muted', 'Payments already counted keep the trains they got. New payments use this price.'));
  return input;
}

function priceCard(l, done) {
  const c = kit.ui.card('Price per train');
  const input = priceField(c, l, done);
  setTimeout(() => input.focus(), 0);
  return c;
}

function render(v) {
  if (!v || !v.active) return;
  const wrap = kit.el('div');
  Object.keys(errs).forEach((k) => wrap.appendChild(kit.ui.errCard('Sync problem', errs[k])));
  if (!kit.tornKey()) {
    v.body(kit.ui.errCard('No Torn key', 'Paste your key in Setup.'));
    return;
  }
  const l = doc && doc.value;
  const b = view();
  if (!l || !b) {
    wrap.appendChild(kit.ui.card('', busy ? '<span class="occ-spin"></span>Loading...' : 'Nothing synced yet. Tap refresh.'));
    v.body(wrap);
    return;
  }
  const snap = kit.store.get(OLD_SNAPSHOT, null);
  const list = inbox(l, (ev && ev.list) || [], emps && emps.list);
  const vals = Object.values(b);
  const left = vals.reduce((a, x) => a + Math.max(0, x.left), 0);
  const owed = vals.reduce((a, x) => a + Math.max(0, -x.left), 0);
  v.stats([
    { k: 'Paid left', v: String(left), unit: ' trains' },
    { k: 'Owed', v: owed ? short(owed * (l.price || PRICE)) : '$0', unit: owed ? ' · ' + owed + ' trains' : '' },
    { k: 'To check', v: String(list.length), hot: list.length > 0 },
  ]);
  const at = kit.store.get(KEY_LAST, 0);
  v.meta((busy ? 'Syncing… · ' : at ? 'Synced ' + ago(at) + ' · ' : '') + '<button type="button" class="occ-pd-price" title="Change the price per train">' + money(l.price || PRICE) + ' a train ✎</button>');
  const pb = document.querySelector('#occ-root .occ-pd-price');
  if (pb)
    pb.addEventListener('click', () => {
      pricing = !pricing;
      render(v);
    });
  if (pricing) wrap.appendChild(priceCard(l, () => ((pricing = false), render(v))));
  if (snap && !l.imported) {
    const c = importCard(snap);
    if (c) wrap.appendChild(c);
  }
  if (list.length) wrap.appendChild(inboxCard(list, l));
  wrap.appendChild(staffCard(b, snap));
  v.body(wrap);
}

function paintAll() {
  paintPage();
  if (tabView) render(tabView);
}

async function mount(v, k, opt) {
  kit = k;
  tabView = v;
  render(v);
  v.busy(true);
  await sync(!!(opt && opt.force), true);
  v.busy(false);
  render(v);
}

function settings(c, k) {
  kit = k;
  c.appendChild(kit.el('h3', '', 'Paid trains'));
  const l = doc && doc.value;
  if (!l) {
    c.appendChild(kit.el('div', 'occ-muted', 'Open the Trains tab once to start tracking.'));
    return;
  }
  priceField(c, l);
  const row2 = kit.el('div', 'occ-pd-ctl');
  row2.appendChild(kit.el('span', 'occ-muted', 'Payments that mention "train"'));
  const auto = small(l.auto !== false ? 'Add on their own' : 'Ask me', (btn) =>
    act(btn, (x) => {
      x.auto = x.auto === false;
      return x;
    }).then(() => (auto.textContent = doc.value.auto !== false ? 'Add on their own' : 'Ask me'))
  );
  row2.appendChild(auto);
  c.appendChild(row2);
  c.appendChild(kit.el('div', 'occ-muted', 'Ledger saved on your private runner, so phone and PC match. Tracking since ' + day(l.since) + '.'));
}

function start(k) {
  kit = k;
  doc = kit.vault.get(KEY_LEDGER, null);
  news = kit.vault.get(KEY_NEWS, null);
  ev = kit.vault.get(KEY_EV, null);
  emps = kit.vault.get(KEY_EMPS, null);
  if (!onCompany()) return;
  watchPage();
  paintPage();
  if (!document.hidden) sync(false, false);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync(false, false);
  });
}

export default {
  id: 'paid',
  label: 'Trains',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M6 20V9l6-5 6 5v11"/><path d="M10 20v-5h4v5"/></svg>',
  access: 'limited',
  start,
  mount,
  settings,
  css: `
    .d .manage-company .employees .employee-list-title>li.occ-paid{width:30px}
    .d .manage-company .employees .employee-list .occ-paid{width:30px;padding:0 5px;margin-top:-1px;position:relative;float:left;height:30px;line-height:33px;border-left:1px solid var(--default-panel-divider-inner-side-color);border-right:1px solid var(--default-panel-divider-outer-side-color)}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v{width:100%;height:24px;display:flex;align-items:center;justify-content:center;margin-top:4px;padding:0;line-height:1;text-align:center;cursor:default;box-sizing:border-box;font-variant-numeric:tabular-nums}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v.daily{color:var(--default-green-color,#82c91e);font-weight:bold}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v.neg{color:var(--default-red-color,#E54C19);font-weight:bold}
    .d .manage-company .employees .employee-list .occ-paid .occ-paid-v.stale{opacity:.55}
    .occ-paid-on .d .manage-company .paid-trains{display:none!important}
    .occ-paid-on .d .manage-company .company-tabs>li a{width:194.5px!important}
    .occ-paid-on .d .company-wrap .company-stats-list>li{width:273.33px!important}
    #occ-root .occ-pd-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--occ-div-dark);box-shadow:inset 0 1px 0 var(--occ-div-light);min-width:0;flex-wrap:wrap}
    #occ-root .occ-pd-txt{flex:1 1 160px;min-width:0;overflow-wrap:anywhere}
    #occ-root .occ-pd-ctl{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px}
    #occ-root .occ-pd-row .occ-pd-ctl{margin-top:0}
    #occ-root .occ-pd-ctl>.occ-muted{margin-right:auto}
    #occ-root .occ-pd-b{height:22px;padding:0 8px;border-radius:4px;border:var(--occ-btn-border);background:var(--occ-btn-bg);color:var(--occ-btn-fg);text-shadow:var(--occ-btn-shadow);font:bold 11px/1 Arial,Helvetica,sans-serif;white-space:nowrap}
    #occ-root .occ-pd-b:hover{background:var(--occ-btn-hover-bg);color:var(--occ-btn-hover-fg)}
    #occ-root .occ-pd-b:active{background:var(--occ-btn-active-bg)}
    #occ-root .occ-pd-b:disabled{opacity:.5;cursor:default}
    #occ-root .occ-pd-b.go{color:var(--occ-good)}
    #occ-root .occ-pd-in{display:inline-block;width:110px;height:24px;margin:0}
    #occ-root .occ-pd-b.shut{margin-left:auto}
    #occ-root .occ-pd-price{color:var(--occ-accent);font:inherit;text-decoration:underline dotted}
    #occ-root .occ-pd-price:hover{color:var(--occ-accent-hi)}
    #occ-root .occ-pd-emp .occ-car{display:inline-block;width:12px;font-size:8px;color:var(--occ-muted)}
    #occ-root .occ-pd-n{min-width:22px;text-align:center;font:bold 12px/1 Arial,Helvetica,sans-serif;font-variant-numeric:tabular-nums;color:var(--occ-hi)}
    #occ-root .occ-pd-emp{cursor:pointer}
    #occ-root .occ-pd-emp:hover td:first-child{text-decoration:underline}
    #occ-root .occ-pd-emp.gone td{opacity:.6}
    #occ-root .occ-pd-more td{white-space:normal}
    #occ-root .occ-pd-neg{color:var(--occ-bad);font-weight:bold}
    #occ-root .occ-pd-pos{color:var(--occ-hi)}
    #occ-root .occ-pd-d{color:var(--occ-good);font-weight:bold}
  `,
};
