// Company trains pill: the count of trains in the company bank, next to the OCC icon.
// GET company/profile, field profile.trains (director key, Limited or higher). Max 20 is fixed.
// Torn adds the daily trains with the company update at ~18:05 TCT (UTC, no DST), so one call just
// after that, a 12h safety net, a call after training on the company page, or on click.
// No timed call while the tab is hidden; it catches up when the tab is back.

const KEY_TRAINS = 'occ.trains';
const KEY_TRAINS_LOCK = 'occ.trains.lock';
const TRAINS_MAX = 20;
const TRAINS_GRANT = (18 * 60 + 7) * 60000; // 18:07 TCT, as ms after UTC midnight
const TRAINS_SAFETY = 12 * 3600 * 1000;
const TRAINS_RETRY = 10 * 60000;
const TRAINS_AFTER_TRAIN = 4000;
const TRAINS_COOLDOWN = 30000;
const TRAINS_LOCK_MS = 30000;
const TRAINS_STOP = [1, 2, 16, 18];

let kit = null;
let trains = null;
let trainsBusy = false;
let trainsTimer = 0;

// Torn City Time (UTC), so the shown times never move with local daylight saving.
function hhmm(ts) {
  const d = new Date(ts);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' TCT';
}

function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago';
}

function keyTail(k) {
  return String(k).slice(-4);
}

// Latest 18:07 TCT at or before now.
function lastGrant(now) {
  const day = 86400000;
  const g = Math.floor(now / day) * day + TRAINS_GRANT;
  return g <= now ? g : g - day;
}

// A key that ever got a count is a director's key, so a later "not a director" reply was a hiccup.
function hadCount(c) {
  return !!c && typeof c.n === 'number';
}

// When the next automatic refresh is due (ms timestamp), or Infinity when it never is.
function nextAt(c, key) {
  if (!c || typeof c.tried !== 'number' || c.kh !== keyTail(key)) return 0;
  if (c.bad) return Infinity;
  if (c.none) return hadCount(c) ? 0 : c.tried + 86400000;
  const now = Date.now();
  if (c.tried < lastGrant(now)) return 0;
  let at = Math.min(lastGrant(now) + 86400000, c.tried + TRAINS_SAFETY);
  if (c.retry) at = Math.min(at, c.tried + TRAINS_RETRY);
  return at;
}

function schedule() {
  clearTimeout(trainsTimer);
  const key = kit.tornKey();
  if (!key) return;
  const at = nextAt(kit.store.get(KEY_TRAINS, null), key);
  if (at === Infinity) return;
  // Cap the wait so a sleeping laptop or throttled tab re-checks reasonably soon.
  const wait = Math.min(Math.max(5000, at - Date.now()), 3600000);
  trainsTimer = setTimeout(() => {
    // Hidden tab: no call now; the visibility handler catches up when the tab is back.
    if (document.hidden) return;
    refresh(false).then(schedule);
  }, wait);
}

function tipText() {
  const t = trains || {};
  if (t.nokey) return 'Company trains · ' + t.err;
  const parts = ['Company trains' + (typeof t.n === 'number' ? ' ' + t.n + ' / ' + TRAINS_MAX : '')];
  parts.push(typeof t.ts === 'number' ? 'refreshed ' + hhmm(t.ts) + ' (' + ago(t.ts) + ')' : 'not refreshed yet');
  if (t.err) parts.push(t.err);
  if (typeof t.n === 'number' && t.n >= TRAINS_MAX) parts.push('FULL: daily trains are being lost');
  const key = kit.tornKey();
  const at = key ? nextAt(t, key) : Infinity;
  if (at !== Infinity) parts.push('next ' + hhmm(Math.max(Date.now(), at)));
  parts.push('click to refresh');
  return parts.join(' · ');
}

// extra: a pill not in the page yet (the shell appends it after badge() returns), which
// querySelectorAll cannot see. Without it a rebuilt pill stayed empty until the next refresh.
function paint(extra) {
  const has = !!trains && typeof trains.n === 'number';
  const n = has ? trains.n : -1;
  const html = '<span class="n">' + (has ? n : '?') + '</span><span class="s">/</span><span class="m">' + TRAINS_MAX + '</span>';
  const tip = tipText();
  const pills = Array.from(document.querySelectorAll('.occ-trains'));
  if (extra && pills.indexOf(extra) === -1) pills.push(extra);
  pills.forEach((p) => {
    p.classList.toggle('full', n >= TRAINS_MAX);
    p.classList.toggle('hot', n > 0 && n < TRAINS_MAX);
    p.classList.toggle('stale', !has || !!(trains && trains.err));
    p.classList.toggle('busy', trainsBusy);
    p.classList.toggle('occ-none', !!(trains && trains.none) && !has);
    if (p.innerHTML !== html) p.innerHTML = html;
    if (p.getAttribute('data-tip') !== tip) p.setAttribute('data-tip', tip);
  });
  kit.tip.update(tip);
}

// Torn sometimes answers a director's key without the trains count (or with error 6/7), e.g. around
// the company update. Hiding the pill on that kept it empty for a whole day, so once a key has had a
// count, keep showing it and retry in 10 minutes instead.
function notDirector(rec) {
  if (hadCount(rec)) {
    rec.err = 'Torn sent no trains count, showing the last one';
    rec.retry = true;
  } else {
    rec.none = true;
  }
}

async function refresh(manual, pill, force) {
  const say = (t, bad) => {
    if (manual) kit.toast.show(pill || document.querySelector('.occ-trains'), t, bad);
  };
  if (trainsBusy) {
    say('Still refreshing. Give it a few seconds.');
    return;
  }
  const key = kit.tornKey();
  const cur = kit.store.get(KEY_TRAINS, null);
  if (!key) {
    trains = Object.assign({}, cur || {}, { nokey: true, err: 'Set your Torn key in Setup' });
    paint();
    say('No Torn key yet. Open the Command Center, tap Setup and paste your key.', true);
    return;
  }
  const kh = keyTail(key);
  const now = Date.now();
  const same = !!cur && cur.kh === kh;
  if (manual) {
    if (same && now - cur.tried < TRAINS_COOLDOWN) {
      const last = typeof cur.n === 'number' && !cur.err ? cur.n + ' / ' + TRAINS_MAX : cur.err || 'no value yet';
      say('Refreshed ' + Math.round((now - cur.tried) / 1000) + 's ago (' + last + '). You can refresh again in ' + Math.ceil((TRAINS_COOLDOWN - (now - cur.tried)) / 1000) + 's.', !!cur.err);
      return;
    }
  } else {
    if (!force && Date.now() < nextAt(cur, key)) {
      trains = cur;
      paint();
      return;
    }
    // Another Torn tab is already fetching: skip, the storage event will bring its result.
    if (now - kit.store.get(KEY_TRAINS_LOCK, 0) < TRAINS_LOCK_MS) return;
  }
  kit.store.set(KEY_TRAINS_LOCK, now);
  trainsBusy = true;
  paint();
  say('Refreshing…');
  const rec = { n: same ? cur.n : undefined, ts: same ? cur.ts : undefined, tried: now, kh: kh };
  let net = false;
  try {
    const j = await kit.torn('company/profile');
    if (j.profile && typeof j.profile.trains === 'number') {
      rec.n = j.profile.trains;
      rec.ts = Date.now();
    } else if (j.profile) {
      // Not a company director: hide the pill and only look again once a day.
      notDirector(rec);
    } else {
      rec.err = 'Unexpected reply from Torn';
    }
  } catch (e) {
    if (e instanceof kit.TornApiError) {
      if (e.code === 6 || e.code === 7) {
        // Not in a company (wrong ID / ID-entity relation): same as not a director.
        notDirector(rec);
      } else {
        rec.err = e.code === 16 ? 'Key access level too low (needs Limited or higher)' : e.message;
        if (TRAINS_STOP.indexOf(e.code) !== -1) rec.bad = true;
        if (e.code === 5) rec.retry = true;
      }
    } else if (/^Unexpected reply/.test(e.message)) {
      rec.err = e.message;
    } else {
      net = true;
      rec.retry = true;
      rec.err = 'Refresh failed: ' + (e && e.message ? e.message : 'error');
    }
  } finally {
    trainsBusy = false;
    kit.store.set(KEY_TRAINS, rec);
    kit.store.del(KEY_TRAINS_LOCK);
    trains = rec;
    paint();
    schedule();
  }
  if (rec.err) {
    say(rec.err + (net ? '. If Tampermonkey asked about api.torn.com, choose Always allow, then click again.' : ''), true);
  } else if (rec.none) {
    say('No company trains: this key is not a company director.');
  } else {
    say('Company trains: ' + rec.n + ' / ' + TRAINS_MAX + (rec.n >= TRAINS_MAX ? '. Full: daily trains are being lost.' : '.'));
  }
}

function makePill(k) {
  const p = k.el('span', 'occ-trains');
  p.setAttribute('role', 'button');
  p.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    kit.tip.hide();
    refresh(true, p);
  });
  p.addEventListener('mouseenter', () => kit.tip.show(p, tipText()));
  p.addEventListener('mouseleave', () => kit.tip.hide());
  return p;
}

function start(k) {
  kit = k;
  trains = kit.store.get(KEY_TRAINS, null);
  paint();
  if (!document.hidden) refresh(false).then(schedule);
  // Background tabs get their timers throttled: check again when the tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh(false).then(schedule);
  });
  addEventListener('storage', (e) => {
    if (e.key !== KEY_TRAINS) return;
    trains = kit.store.get(KEY_TRAINS, null);
    paint();
    schedule();
  });
  // Training an employee spends trains: refresh a few seconds after the last Train click on the
  // company page (the wait also covers the confirm step). Only listens, never clicks.
  let trainedTimer = 0;
  document.addEventListener(
    'click',
    (e) => {
      if (!/companies\.php/.test(location.pathname)) return;
      const b = e.target && e.target.closest ? e.target.closest('button,a,input[type="button"],input[type="submit"]') : null;
      if (!b || !/\btrain/i.test(b.textContent || b.value || '')) return;
      clearTimeout(trainedTimer);
      trainedTimer = setTimeout(() => {
        refresh(false, null, true).then(schedule);
      }, TRAINS_AFTER_TRAIN);
    },
    true
  );
}

export default {
  id: 'trains',
  label: 'Trains',
  access: 'limited',
  start,
  // Shell asks for a fresh pill whenever it (re)builds a badge slot (page load, Torn redrawing the
  // name row, phone dock), so it is filled here before it goes in the page.
  badge(k) {
    const p = makePill(k);
    if (kit) paint(p);
    return p;
  },
  css: `
    .occ-trains{all:unset;box-sizing:border-box;position:relative;display:inline-flex!important;align-items:center;flex:none;height:13px;margin:0 0 0 3px;padding:0 3px;background:#1f1f1f;border:1px solid #3a3a3a;border-radius:3px;font:700 9px/1 Verdana,Arial,sans-serif;color:#8a8a8a;white-space:nowrap;vertical-align:middle;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}
    .occ-trains .n{color:#d6d6d6}
    .occ-trains .s{margin:0 2px;font-weight:400;color:#8a8a8a}
    .occ-trains .m{font-weight:400;color:#8a8a8a}
    .occ-trains .s,.occ-trains .m{display:none}
    .occ-dock .occ-trains .s,.occ-dock .occ-trains .m,.occ-badges.occ-float .occ-trains .s,.occ-badges.occ-float .occ-trains .m{display:inline}
    .occ-dock .occ-trains{margin:0 0 0 6px;height:16px;padding:0 6px;font-size:11px}
    .occ-badges.occ-float .occ-trains{margin:0}
    .occ-trains.hot{border-color:#6b5a26}
    .occ-trains.hot .n{color:#f2c14e}
    .occ-trains.full{border-color:#7a2f2b}
    .occ-trains.full .n{color:#e5534b}
    .occ-trains.stale{opacity:.55}
    .occ-trains.occ-none{display:none!important}
    .occ-trains.busy{animation:occ-tpulse 1s ease-in-out infinite}
    @keyframes occ-tpulse{50%{opacity:.35}}
  `,
};
