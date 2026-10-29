// Keys tab: how hard the Torn key and the free AI quota are used, as a 14-day trend.
// Torn: GET key/log (public, newest 100 calls of this key, with who called), merged into a day by
// day history in Tampermonkey storage. Sampled when the tab opens and every 30 min while a Torn
// tab is visible, so the trend has few gaps. AI: the private runner's /usage (its own model calls
// plus OpenRouter's count of today's free requests, snapshotted hourly by the runner's cron).
// Limits are per player / per account, so more keys never raise them (torn.com/api.html,
// openrouter.ai/docs/api-reference/limits): the verdict says headroom, not "add a key".
import { RUNNER } from '../../occ-kit/core/ai.js';

const KEY_HIST = 'occ.keys.hist';
const KEY_LOCK = 'occ.keys.lock';
const KEY_TRY = 'occ.keys.try';
const TORN_CAP = 100; // calls per minute, per player, all keys together
const AI_CAP = 1000; // free model requests per UTC day (account bought credits once)
const SAMPLE_MS = 30 * 60000;
const LOCK_MS = 60000;
const RETRY_MS = 5 * 60000; // after a failed read
const FORCE_MS = 20000; // Refresh never reads the log more often than this
const DAYS = 14;
const MIN_KEEP = 3 * 3600; // seconds of per-minute counts kept to merge peaks across samples

let kit = null;
let timer = 0;

const dayOf = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const sig = (x) => [x.timestamp, x.type, x.selections, x.id, x.ip, x.comment].join('|');

function emptyHist() {
  return { edge: { ts: 0, sigs: [] }, days: {}, mins: {}, last: 0 };
}

// Merge one key/log reply into the history. Entries already seen are skipped by the newest
// timestamp seen and the calls made in that same second. A full log whose oldest entry is newer
// than the last one seen means calls were missed in between: that day is marked as a lower bound.
export function mergeLog(hist, log, now) {
  const h = hist || emptyHist();
  const list = (log || []).filter((x) => x && typeof x.timestamp === 'number');
  if (!list.length) return h;
  const self = (list.find((x) => x.type === 'key' && x.selections === 'log') || {}).ip;
  const oldest = Math.min(...list.map((x) => x.timestamp));
  if (h.edge.ts && oldest > h.edge.ts && list.length >= 100) {
    // Every day from the last call seen to the oldest one now, both ends included.
    for (let t = Math.floor(h.edge.ts / 86400) * 86400; t <= oldest; t += 86400) (h.days[dayOf(t)] = h.days[dayOf(t)] || { n: 0, peak: 0, src: {} }).gap = true;
  }
  const fresh = list.filter((x) => x.timestamp > h.edge.ts || (x.timestamp === h.edge.ts && h.edge.sigs.indexOf(sig(x)) === -1));
  fresh.forEach((x) => {
    const d = (h.days[dayOf(x.timestamp)] = h.days[dayOf(x.timestamp)] || { n: 0, peak: 0, src: {} });
    d.n++;
    const from = self && x.ip === self ? 'you' : 'elsewhere';
    const what = x.comment ? String(x.comment) : x.type + ' ' + String(x.selections || '');
    const k = from + '\u0001' + what;
    d.src[k] = (d.src[k] || 0) + 1;
    const m = Math.floor(x.timestamp / 60) * 60;
    h.mins[m] = (h.mins[m] || 0) + 1;
  });
  Object.keys(h.mins).forEach((m) => {
    const d = h.days[dayOf(+m)];
    if (d) d.peak = Math.max(d.peak, h.mins[m]);
    if (+m < now / 1000 - MIN_KEEP) delete h.mins[m];
  });
  const top = Math.max(h.edge.ts, ...list.map((x) => x.timestamp));
  const sigs = list.filter((x) => x.timestamp === top).map(sig);
  h.edge = { ts: top, sigs: top === h.edge.ts ? h.edge.sigs.concat(sigs.filter((s) => h.edge.sigs.indexOf(s) === -1)) : sigs };
  const cut = dayOf(now / 1000 - 40 * 86400);
  Object.keys(h.days).forEach((d) => {
    if (d < cut) delete h.days[d];
  });
  h.last = now;
  return h;
}

// Every read is logged with its time, success or not, so a failing read can never turn into a
// read on every Torn page load: next try after SAMPLE_MS, RETRY_MS after a failure.
async function sample(force) {
  const now = Date.now();
  const hist = kit.vault.get(KEY_HIST, null);
  const tried = kit.store.get(KEY_TRY, { at: 0, ok: true });
  const wait = force ? FORCE_MS : tried.ok ? SAMPLE_MS : RETRY_MS;
  if (now - tried.at < wait || (!force && hist && now - hist.last < SAMPLE_MS)) return hist;
  if (now - kit.store.get(KEY_LOCK, 0) < LOCK_MS) return hist;
  kit.store.set(KEY_LOCK, now);
  kit.store.set(KEY_TRY, { at: now, ok: false });
  try {
    const j = await kit.torn('key/log?limit=100&comment=OCC');
    const merged = mergeLog(kit.vault.get(KEY_HIST, null), j.log, Date.now());
    kit.vault.set(KEY_HIST, merged);
    kit.store.set(KEY_TRY, { at: now, ok: true });
    return merged;
  } finally {
    kit.store.del(KEY_LOCK);
  }
}

function schedule() {
  clearTimeout(timer);
  if (!kit.tornKey()) return;
  timer = setTimeout(() => {
    if (!document.hidden) sample(false).catch(() => {});
    schedule();
  }, SAMPLE_MS);
}

async function runnerUsage() {
  const h = { Authorization: 'ApiKey ' + kit.tornKey() };
  const or = kit.keys.get(kit.KEY_OR);
  if (or) h['X-OpenRouter-Key'] = or;
  const r = await kit.http({ url: RUNNER + '/usage', headers: h, timeout: 20000 });
  const j = kit.parseJson(r.text);
  if (r.status !== 200) throw new Error(j.error || 'Runner HTTP ' + r.status);
  return j;
}

function lastDays(now) {
  return Array.from({ length: DAYS }, (_, i) => new Date(now - (DAYS - 1 - i) * 86400000).toISOString().slice(0, 10));
}

// A row of day bars, today on the right. vals: [{ v, tip, warn }], scaled to max(cap line, top).
function bars(vals, cap) {
  const top = Math.max(cap || 0, ...vals.map((x) => x.v || 0), 1);
  const w = kit.el('div', 'occ-kb');
  vals.forEach((x) => {
    const b = kit.el('i', x.v === null ? 'none' : x.warn ? 'warn' : '');
    b.style.height = x.v ? Math.max(2, Math.round((x.v / top) * 100)) + '%' : '0';
    b.addEventListener('mouseenter', () => kit.tip.show(b, x.tip));
    b.addEventListener('mouseleave', () => kit.tip.hide());
    b.addEventListener('click', () => kit.tip.show(b, x.tip));
    w.appendChild(b);
  });
  return w;
}

function level(ratio) {
  return ratio >= 0.8 ? 'bad' : ratio >= 0.5 ? 'warn' : 'good';
}

function tornCard(hist, days) {
  const c = kit.ui.card('Torn API key');
  const today = (hist && hist.days[days[DAYS - 1]]) || { n: 0, peak: 0, src: {} };
  c.appendChild(
    bars(
      days.map((d) => {
        const x = hist && hist.days[d];
        return x ? { v: x.n, warn: x.peak >= TORN_CAP * 0.5, tip: d + ': ' + (x.gap ? 'at least ' : '') + fmt(x.n) + ' calls, peak ' + x.peak + ' / ' + TORN_CAP + ' per min' } : { v: null, tip: d + ': not sampled' };
      })
    )
  );
  const rows = Object.keys(today.src)
    .map((k) => ({ from: k.split('\u0001')[0], what: k.split('\u0001')[1], n: today.src[k] }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  if (rows.length) {
    const t = kit.el('div', 'occ-tbl');
    t.innerHTML =
      '<table><tr><th>Today, by caller</th><th>From</th><th>Calls</th></tr>' +
      rows.map((r) => '<tr><td>' + kit.esc(r.what) + '</td><td>' + r.from + '</td><td>' + fmt(r.n) + '</td></tr>').join('') +
      '</table>';
    c.appendChild(t);
  }
  c.appendChild(kit.el('div', 'occ-muted', 'Cap is ' + TORN_CAP + ' calls/min per player, shared by all your keys, so a new key adds no room. "Elsewhere" = sites or bots you gave this key.'));
  return c;
}

function aiCard(u, days) {
  const c = kit.ui.card('AI, free models (OpenRouter)');
  if (!u) {
    c.appendChild(kit.el('div', 'occ-muted', 'Runner did not answer. Try Refresh.'));
    return c;
  }
  const by = {};
  (u.days || []).forEach((d) => (by[d.day] = d));
  c.appendChild(
    bars(
      days.map((d) => {
        const x = by[d] || {};
        const ai = x.ai || { ok: 0, rl: 0, fail: 0 };
        const used = x.or && typeof x.or.used === 'number' ? x.or.used : x.ai ? ai.ok + ai.rl + ai.fail : null;
        const cap = (x.or && x.or.limit) || AI_CAP;
        return { v: used, warn: used !== null && used >= cap * 0.5, tip: d + ': ' + (used === null ? 'no data' : fmt(used) + ' / ' + fmt(cap) + ' free requests') + (x.ai ? ' · runner ' + ai.ok + ' ok, ' + ai.rl + ' busy, ' + ai.fail + ' failed' : '') };
      })
    )
  );
  const t = (by[days[DAYS - 1]] || {}).ai;
  const models = t ? Object.keys(t.models).sort((a, b) => t.models[b][0] - t.models[a][0]) : [];
  const line = t ? 'Runner today: ' + t.ok + ' ok · ' + t.rl + ' busy (429) · ' + t.fail + ' failed' + (models.length ? ' · mostly ' + models[0].replace(/:free$/, '') : '') : 'Runner made no AI calls today.';
  c.appendChild(kit.el('div', 'occ-muted', kit.esc(line) + '<br>Cap is per account (20/min, ' + fmt(AI_CAP) + '/day); extra keys or accounts do not raise it.' + (u.live ? '' : ' OpenRouter count unavailable: add the OPENROUTER_KEY runner secret or an OpenRouter key in Setup.')));
  return c;
}

async function mount(view, k, opt) {
  kit = k;
  view.busy(true);
  const [hist, use] = await Promise.all([sample(!!(opt && opt.force)).catch((e) => ({ err: e.message })), runnerUsage().catch((e) => ({ err: e.message }))]);
  view.busy(false);
  const now = Date.now();
  const days = lastDays(now);
  const h = hist && !hist.err ? hist : kit.vault.get(KEY_HIST, null);
  const u = use && !use.err ? use : null;
  const today = (h && h.days[days[DAYS - 1]]) || { n: 0, peak: 0 };
  const orToday = u && u.live && typeof u.live.used === 'number' ? u.live : null;
  const aiUsed = orToday ? orToday.used : null;
  const aiCap = (orToday && orToday.limit) || AI_CAP;
  const peakDay = h ? days.reduce((a, d) => (h.days[d] && h.days[d].peak > ((h.days[a] || {}).peak || 0) ? d : a), days[DAYS - 1]) : days[DAYS - 1];
  const peak14 = h && h.days[peakDay] ? h.days[peakDay].peak : 0;
  const aiTop = u ? Math.max(0, ...(u.days || []).map((d) => (d.or && d.or.used) || 0)) : 0;
  const tl = level(peak14 / TORN_CAP);
  const al = level(Math.max(aiTop, aiUsed || 0) / aiCap);
  view.stats([
    { k: 'Torn peak / min', v: String(today.peak), unit: ' / ' + TORN_CAP, hot: tl !== 'good' },
    { k: 'Torn calls today', v: fmt(today.n) },
    { k: 'AI free today', v: aiUsed === null ? '?' : fmt(aiUsed), unit: ' / ' + fmt(aiCap), hot: al !== 'good' },
  ]);
  const say = { good: 'plenty of room', warn: 'getting busy', bad: 'near the cap' };
  // Say which minute set the Torn verdict, so a busy day earlier in the 14 never reads as today.
  const tornWhy = tl === 'good' ? '' : ', busiest minute ' + peak14 + '/' + TORN_CAP + (peakDay === days[DAYS - 1] ? ' today' : ' on ' + new Date(peakDay).toUTCString().slice(5, 11));
  view.meta('<span class="occ-kv-' + tl + '">Torn: ' + say[tl] + tornWhy + '</span> · <span class="occ-kv-' + al + '">AI: ' + say[al] + '</span>');
  const wrap = kit.el('div');
  if (hist && hist.err) wrap.appendChild(kit.ui.errCard('Torn key log failed', hist.err));
  wrap.appendChild(tornCard(h, days));
  if (use && use.err) wrap.appendChild(kit.ui.errCard('Runner usage failed', use.err));
  wrap.appendChild(aiCard(u, days));
  view.body(wrap);
}

export default {
  id: 'keys',
  label: 'Keys',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>',
  access: 'public',
  start(k) {
    kit = k;
    if (!document.hidden && kit.tornKey()) sample(false).catch(() => {});
    schedule();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && kit.tornKey()) sample(false).catch(() => {});
    });
  },
  mount,
  css: `
    .occ-kb{display:flex;align-items:flex-end;gap:2px;height:42px;margin:0 0 8px;padding:4px;border-radius:5px;background:var(--occ-sunk)}
    .occ-kb i{flex:1;min-width:0;background:var(--occ-accent);border-radius:2px 2px 0 0;cursor:pointer}
    .occ-kb i.warn{background:var(--occ-warn)}
    .occ-kb i.none{height:2px!important;background:var(--occ-line2)}
    .occ-kv-good{color:var(--occ-good)}
    .occ-kv-warn{color:var(--occ-warn)}
    .occ-kv-bad{color:var(--occ-bad)}
  `,
};
