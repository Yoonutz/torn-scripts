// Stat gaps on the company employee list (director view).
// Each employee's Stats (M/I/E) show the gap to the requirements of the position picked in the row:
// green "+12k" above, red "-40k" short, grey dash where the position needs none of that stat.
// The Position dropdown shows the same gaps next to every position.
// Stats: the exact numbers Torn already prints in the row. Requirements: GET torn/companies
// (all company types, matched by position id), kept for 7 days. No other API call, nothing on a hidden tab.

const KEY_REQ = 'occ.gaps.req';
const REQ_TTL = 7 * 86400000;
const REQ_RETRY = 10 * 60000;

let kit = null;
let req = null; // { [positionId]: [M, I, E] }
let loading = false;
let failedAt = 0;

function fmt(v) {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '+';
  if (a < 1000) return s + a;
  if (a < 1e5) return s + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  if (a < 1e6) return s + Math.round(a / 1e3) + 'k';
  return s + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm';
}

// One stat vs one requirement: [text, class].
function gap(have, need) {
  if (!need) return ['–', 'n'];
  const d = have - need;
  return [fmt(d), d >= 0 ? 'g' : 'r'];
}

function onPage() {
  return /companies\.php/.test(location.pathname);
}

async function loadReq() {
  const c = kit.store.get(KEY_REQ, null);
  if (c && c.at && Date.now() - c.at < REQ_TTL && c.req) {
    req = c.req;
    return;
  }
  if (loading || document.hidden || !kit.tornKey() || Date.now() - failedAt < REQ_RETRY) {
    if (c && c.req) req = c.req;
    return;
  }
  loading = true;
  try {
    const j = await kit.torn('torn/companies');
    const out = {};
    (j.companies || []).forEach((t) =>
      (t.positions || []).forEach((p) => {
        const r = p.working_stats && p.working_stats.required;
        if (r) out[p.id] = [r.manual_labor || 0, r.intelligence || 0, r.endurance || 0];
      })
    );
    if (Object.keys(out).length) {
      req = out;
      kit.store.set(KEY_REQ, { at: Date.now(), req: out });
    }
  } catch (e) {
    failedAt = Date.now();
    if (c && c.req) req = c.req;
  }
  loading = false;
  paint();
}

// Exact stats from the row: the visible-on-phone number span of each of the three stat blocks.
function rowStats(stats) {
  const conts = stats.querySelectorAll(':scope > .span-cont');
  if (conts.length !== 3) return null;
  const v = Array.from(conts).map((c) => {
    const n = c.querySelector(':scope > span.t-show:not(.bold)');
    return n ? parseInt(n.textContent.replace(/[^0-9]/g, ''), 10) : NaN;
  });
  return v.some(isNaN) ? null : { conts, v };
}

function setSpan(host, cls, [t, c]) {
  let s = host.querySelector(':scope > .' + cls);
  if (!s) {
    s = document.createElement('span');
    host.appendChild(s);
  }
  const want = cls + ' ' + c;
  if (s.className !== want) s.className = want;
  if (s.textContent !== t) s.textContent = t;
  return s;
}

function paintRow(row) {
  const stats = row.querySelector('.acc-body .stats');
  const sel = row.querySelector('select.employee-rank');
  if (!stats || !sel) return;
  const st = rowStats(stats);
  if (!st) return;
  const r = req[sel.value];
  if (r) {
    stats.classList.add('occ-sg-on');
    st.conts.forEach((c, i) => setSpan(c, 'occ-sg', gap(st.v[i], r[i])));
  } else if (stats.classList.contains('occ-sg-on')) {
    stats.classList.remove('occ-sg-on');
  }
  // Dropdown: jQuery UI menu, items in the same order as the select's options.
  const menu = sel.id && document.getElementById(sel.id + '-menu');
  if (!menu) return;
  const items = menu.querySelectorAll(':scope > li > a');
  const opts = sel.options;
  if (items.length !== opts.length) return;
  menu.classList.add('occ-sg-menu');
  items.forEach((a, i) => {
    const pr = req[opts[i].value];
    const old = a.querySelector(':scope > .occ-sg-dd');
    if (!pr) {
      if (old) old.remove();
      return;
    }
    let s = old;
    if (!s) {
      s = document.createElement('span');
      s.className = 'occ-sg-dd';
      a.appendChild(s);
    }
    const html = pr.map((need, k) => {
      const [t, c] = gap(st.v[k], need);
      return '<i class="' + c + '">' + t + '</i>';
    }).join(' / ');
    if (s.innerHTML !== html) s.innerHTML = html;
  });
}

function paint() {
  if (!req) return;
  document.querySelectorAll('ul.employee-list li[data-user]').forEach(paintRow);
}

function watch() {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!document.querySelector('ul.employee-list li[data-user] select.employee-rank')) return;
      if (!req) return void loadReq();
      paint();
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('change', (e) => {
    if (e.target && e.target.matches && e.target.matches('select.employee-rank')) paint();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !req && document.querySelector('ul.employee-list select.employee-rank')) loadReq();
  });
}

function start(k) {
  kit = k;
  if (!onPage()) return;
  const c = kit.store.get(KEY_REQ, null);
  if (c && c.req) req = c.req;
  watch();
  if (document.querySelector('ul.employee-list select.employee-rank')) loadReq().then(paint);
}

export default {
  id: 'gaps',
  label: 'Stat gaps',
  access: 'public',
  start,
  css: `
    .occ-sg-on>.span-cont>span.t-hide,.occ-sg-on>.span-cont>span.t-show:not(.bold){display:none!important}
    .occ-sg,.occ-sg-dd i{font-weight:bold;font-style:normal;font-variant-numeric:tabular-nums}
    .occ-sg.g,.occ-sg-dd .g{color:var(--default-green-color,#82c91e)}
    .occ-sg.r,.occ-sg-dd .r{color:var(--default-red-color,#E54C19)}
    .occ-sg.n,.occ-sg-dd .n{color:var(--default-gray-9-color,#999);font-weight:normal}
    ul.occ-sg-menu{width:auto!important;min-width:250px}
    ul.occ-sg-menu>li>a{display:flex!important;justify-content:space-between;gap:8px;white-space:nowrap}
    .occ-sg-dd{font-size:11px}
  `,
};
