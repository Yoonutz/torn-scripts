// ==UserScript==
// @name         Torn M'aol tracker
// @namespace    kamiren.torn-maol-tracker
// @version      1.0.8
// @description  Live M'aol and Praetorian status with flight times for your own travel perks and what to do next
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const POLL_S = 15;               // 7 calls each: 28 of Torn's 100 calls/min per key
  const IDLE_POLL_S = 600;          // everything dormant: check every 10 min
  const PERKS_S = 6 * 3600;
  const RATE_WINDOW_S = 15 * 60;   // HP samples kept for the kill-rate estimate
  const HOP_MIN = 15;              // M'aol moves to the next defeat-order country every 15 min

  const K = { key: 'tmt.apikey', state: 'tmt.state', ui: 'tmt.ui' };
  const PDA_KEY_PLACEHOLDER = '###' + 'PDA-APIKEY' + '###';
  const PDA_KEY = '###PDA-APIKEY###';
  const IS_PDA = PDA_KEY && PDA_KEY !== PDA_KEY_PLACEHOLDER;

  const MAOL = { id: 23, name: "M'aol" };
  const GUARDS = [
    { id: 100, name: "Dyno'salam" },
    { id: 101, name: "Nol'dasaym" },
    { id: 102, name: "Asmol'yand" },
    { id: 103, name: "Sylo'nadam" },
    { id: 104, name: "Ladso'myna" },
  ];

  // Standard one-way minutes, wiki.torn.com/wiki/Travel. Airstrip x0.7, WLT x0.5,
  // Business Class x0.3, travel book a further x0.75. Flights vary about 3%.
  const FLIGHT = {
    'Mexico': 24, 'Cayman Islands': 33, 'Canada': 39, 'Hawaii': 127, 'United Kingdom': 151,
    'Argentina': 158, 'Switzerland': 166, 'Japan': 213, 'China': 229, 'UAE': 257, 'South Africa': 281,
  };
  const ALIAS = { 'United Arab Emirates': 'UAE', 'Cayman': 'Cayman Islands', 'UK': 'United Kingdom' };
  // Hospital and jail abroad read "In a Mexican hospital for ..."
  const DEMONYM = {
    Mexican: 'Mexico', Caymanian: 'Cayman Islands', Canadian: 'Canada', Hawaiian: 'Hawaii', British: 'United Kingdom',
    Argentinian: 'Argentina', Swiss: 'Switzerland', Japanese: 'Japan', Chinese: 'China', Emirati: 'UAE', 'South African': 'South Africa',
  };
  const METHOD = { standard: 1, airstrip: 0.7, wlt: 0.5, business: 0.3 };
  const METHOD_NAME = { standard: 'Standard', airstrip: 'Airstrip', wlt: 'WLT jet', business: 'Business ticket' };

  // ------------------------------------------------------------- storage
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  // samples: { id: [[t, hp], ...] }, deaths: { id: { t, country } }, perks: {...}
  let ST = Object.assign({ samples: {}, deaths: {}, perks: null, perksAt: 0 }, load(K.state, {}));
  let UI = Object.assign({ open: true, biz: false }, load(K.ui, {}));
  const saveState = () => store(K.state, ST);
  const saveUi = () => store(K.ui, UI);
  const apiKey = () => (IS_PDA ? PDA_KEY : (load(K.key, '') || ''));

  const now = () => Math.floor(Date.now() / 1000);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMin = (m) => {
    if (!isFinite(m)) return '–';
    m = Math.max(0, Math.round(m));
    return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
  };
  const fmtHp = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n));
  const tct = (t) => new Date(t * 1000).toISOString().slice(11, 16);

  // ------------------------------------------------------------- Torn API
  async function tornApi(path) {
    const key = apiKey();
    if (!key) throw new Error('No API key');
    // timestamp makes Torn skip its response cache, so HP is fresh on every poll
    const url = `https://api.torn.com/v2/${path}${path.includes('?') ? '&' : '?'}timestamp=${now()}&comment=MaolTracker`;
    const headers = { Authorization: `ApiKey ${key}` };
    let text;
    if (typeof window.PDA_httpGet === 'function') {
      const r = await window.PDA_httpGet(url, headers);
      text = (r && (r.responseText || r.text || r.body)) || (typeof r === 'string' ? r : '');
    } else {
      text = await (await fetch(url, { headers })).text();
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Bad API response'); }
    if (data.error) throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
    return data;
  }

  function countryOf(desc) {
    const m = /(?:in|to|from)\s+([A-Z][A-Za-z ]+?)\s*$/.exec(String(desc || '').trim());
    if (!m) return null;
    const c = ALIAS[m[1]] || m[1];
    return FLIGHT[c] ? c : null;
  }

  // ------------------------------------------------------------- travel perks
  function perkMethods(perks) {
    const all = (k) => (perks?.[k] || []).join(' | ');
    return {
      airstrip: /airstrip/i.test(all('property')),
      wlt: /WLT|private jet/i.test(all('stock')),
      book: /travel time|flight time/i.test(all('book')),
    };
  }
  function bestMethod() {
    if (UI.biz) return 'business';
    const p = perkMethods(ST.perks);
    return p.wlt ? 'wlt' : p.airstrip ? 'airstrip' : 'standard';
  }
  function flightMin(country, method) {
    const base = FLIGHT[country];
    if (!base) return Infinity;
    const book = perkMethods(ST.perks).book ? 0.75 : 1;
    return base * METHOD[method] * book;
  }
  // You can only fly Torn <-> abroad, so going from one country to another means flying home first.
  function tripMin(me, country, method) {
    if (me.where === country) return 0;
    let t = flightMin(country, method);
    if (me.where && me.where !== 'Torn') t += flightMin(me.where, method);
    if (me.busyUntil) t += Math.max(0, (me.busyUntil - now()) / 60);
    return t;
  }

  // ------------------------------------------------------------- data
  let D = null;        // last snapshot
  let err = '';

  function killEta(id, hp) {
    const s = (ST.samples[id] || []).filter(([t]) => now() - t <= RATE_WINDOW_S);
    if (s.length < 2 || hp <= 0) return Infinity;
    const [t0, h0] = s[0];
    const [t1, h1] = s[s.length - 1];
    const perMin = (h0 - h1) / Math.max(1, (t1 - t0) / 60);
    return perMin > 0 ? hp / perMin : Infinity;
  }

  async function refresh() {
    if (!apiKey()) { render(); return; }
    // Several Torn tabs share one snapshot: only the first tab due polls the API.
    const fresh = load(K.state, {});
    const dormant = fresh.snap && fresh.snap.maol.state === 'Dormant' && fresh.snap.guards.every((g) => g.state === 'Dormant');
    if (fresh.snap && now() - fresh.snap.t < (dormant ? IDLE_POLL_S : POLL_S) - 2) {
      ST = Object.assign(ST, fresh);
      D = fresh.snap;
      render();
      return;
    }
    try {
      const t = now();
      if (!ST.perks || t - ST.perksAt > PERKS_S) {
        ST.perks = (await tornApi('user/perks')).perks || null;
        ST.perksAt = t;
      }
      const [meB, ...npcs] = await Promise.all([
        tornApi('user/basic'),
        ...[MAOL, ...GUARDS].map((n) => tornApi(`user/${n.id}/profile`)),
      ]);
      const list = npcs.map((r, i) => {
        const p = r.profile || {};
        const base = i === 0 ? MAOL : GUARDS[i - 1];
        return {
          ...base,
          state: /^dormant/i.test(p.status?.description || '') ? 'Dormant' : 'Awoken',
          desc: p.status?.description || '',
          country: countryOf(p.status?.description),
          hp: p.life?.current ?? 0,
          max: p.life?.maximum ?? 0,
        };
      });
      list.forEach((n) => {
        const arr = (ST.samples[n.id] || []).filter(([ts]) => t - ts <= RATE_WINDOW_S);
        const prev = arr[arr.length - 1];
        if (prev && prev[1] > 0 && n.hp <= 0 && !ST.deaths[n.id]) ST.deaths[n.id] = { t, country: n.country };
        if (n.hp > 0 && ST.deaths[n.id] && n.state === 'Awoken') delete ST.deaths[n.id]; // new summon
        arr.push([t, n.hp]);
        ST.samples[n.id] = arr;
      });
      const st = meB.profile?.status || {};
      const tr = st.state === 'Traveling' ? ((await tornApi('user/travel')).travel || {}) : {};
      const me = { state: st.state, desc: st.description || '', where: 'Torn', busyUntil: 0, landing: 0 };
      if (st.state === 'Abroad') me.where = countryOf(st.description);
      if (st.state === 'Traveling') {
        me.where = tr.destination === 'Torn' ? 'Torn' : tr.destination;
        me.busyUntil = tr.arrival_at || 0;
        me.landing = tr.arrival_at || 0;
      }
      if ((st.state === 'Hospital' || st.state === 'Jail') && st.until) {
        me.busyUntil = st.until;
        const adj = /^In an? (\w+(?: \w+)?) (?:hospital|jail)/i.exec(st.description || '');
        if (adj && DEMONYM[adj[1]]) me.where = DEMONYM[adj[1]];
      }
      D = { t, maol: list[0], guards: list.slice(1), me };
      ST.snap = D;
      err = '';
      saveState();
    } catch (e) {
      err = e.message || String(e);
    }
    render();
  }

  // ------------------------------------------------------------- what to do next
  function advice() {
    if (!D) return [];
    const { maol, guards, me } = D;
    const method = bestMethod();
    const tips = [];
    const alive = guards.filter((g) => g.state === 'Awoken' && g.hp > 0);
    const order = guards
      .filter((g) => g.hp <= 0 && ST.deaths[g.id])
      .sort((a, b) => ST.deaths[a.id].t - ST.deaths[b.id].t);

    if (me.busyUntil > now()) {
      const what = me.state === 'Traveling' ? `Landing in ${me.where} at ${tct(me.busyUntil)} TCT` : `${me.state} until ${tct(me.busyUntil)} TCT`;
      tips.push({ c: 'info', t: `${what}. Times below already count that wait.` });
    }

    if (maol.state === 'Dormant' && !alive.length) {
      tips.push({ c: 'info', t: "M'aol and his Praetorians are dormant. Nothing to fight right now." });
      return tips;
    }

    if (alive.length) {
      const here = alive.find((g) => g.country === me.where);
      if (here && !(me.busyUntil > now())) {
        tips.push({ c: 'go', t: `${here.name} is in ${here.country} with you. Hit now.`, href: `https://www.torn.com/loader.php?sid=attack&user2ID=${here.id}` });
      }
      const scored = alive.map((g) => {
        const trip = tripMin(me, g.country, method);
        const eta = killEta(g.id, g.hp);
        return { g, trip, eta, ok: trip + 3 < eta };
      }).sort((a, b) => a.trip - b.trip);
      const pick = scored.find((s) => s.ok && s.g !== here);
      if (pick) {
        tips.push({ c: 'go', t: `Fly to ${pick.g.country} (${METHOD_NAME[method]}, ${fmtMin(pick.trip)}). ${pick.g.name} has ${fmtHp(pick.g.hp)} HP` + (isFinite(pick.eta) ? `, ~${fmtMin(pick.eta)} left at current pace.` : ', barely touched.'), href: 'https://www.torn.com/page.php?sid=travel' });
      }
      scored.filter((s) => !s.ok).forEach((s) => {
        tips.push({ c: 'warn', t: `Skip ${s.g.name} in ${s.g.country}: dies in ~${fmtMin(s.eta)}, you need ${fmtMin(s.trip)}.` });
      });
      tips.push({ c: 'info', t: `Bond holds: M'aol can't be hit until all 5 guards fall (${5 - alive.length}/5 down).` });
    }

    if (!alive.length && maol.state === 'Awoken' && maol.hp > 0) {
      if (maol.country === me.where && !(me.busyUntil > now())) {
        tips.push({ c: 'go', t: `M'aol is in ${me.where} with you. Hit now.`, href: `https://www.torn.com/loader.php?sid=attack&user2ID=${MAOL.id}` });
      }
      if (order.length) {
        const route = order.map((g) => ST.deaths[g.id].country || g.country).filter(Boolean);
        const best = route.map((c) => ({ c, trip: tripMin(me, c, method) })).sort((a, b) => a.trip - b.trip)[0];
        tips.push({ c: 'info', t: `He hops every ${HOP_MIN} min in defeat order: ${route.join(' → ')}.` });
        if (best && best.c !== me.where) tips.push({ c: 'go', t: `Closest stop on his route: ${best.c} (${fmtMin(best.trip)}). Wait there for him.`, href: 'https://www.torn.com/page.php?sid=travel' });
      } else {
        tips.push({ c: 'warn', t: 'Guards died before this script saw them, so their order is unknown. Check tornstats.com/maol for the route.', href: 'https://www.tornstats.com/maol' });
      }
    }
    tips.push({ c: 'info', t: 'Bring a Small First Aid Kit or First Aid Kit, not Blood Bags: they hit for ~4k, so a small heal gets you out of hospital and saves medical cooldown.' });
    return tips;
  }

  // ------------------------------------------------------------- UI
  let root;
  function bar(n) {
    const pct = n.max ? Math.max(0, Math.min(100, (n.hp / n.max) * 100)) : 0;
    const dead = n.hp <= 0;
    const eta = killEta(n.id, n.hp);
    const where = n.country || (n.id === MAOL.id ? (n.state === 'Awoken' ? 'Awoken' : 'Dormant') : '?');
    const sub = dead ? (ST.deaths[n.id] ? `down ${tct(ST.deaths[n.id].t)}` : 'down')
      : isFinite(eta) ? `~${fmtMin(eta)} left` : '';
    const trip = D && n.country && !dead ? fmtMin(tripMin(D.me, n.country, bestMethod())) : '';
    return `<a class="tmt-row${dead ? ' tmt-dead' : ''}" href="https://www.torn.com/profiles.php?XID=${n.id}">
      <span class="tmt-name">${esc(n.name)}</span>
      <span class="tmt-where">${esc(where)}${trip ? ` · ✈ ${trip}` : ''}</span>
      <span class="tmt-hp"><i style="width:${pct.toFixed(1)}%"></i><b>${dead ? '0' : fmtHp(n.hp)} / ${fmtHp(n.max)}</b></span>
      <span class="tmt-sub">${esc(sub)}</span>
    </a>`;
  }

  function render() {
    if (!root) return;
    const method = bestMethod();
    const p = perkMethods(ST.perks);
    let body;
    if (!apiKey()) {
      body = `<div class="tmt-key">Minimal access API key needed (NPCs, your status, perks, travel).<br>
        <input id="tmt-key" maxlength="16" placeholder="16-character key" autocomplete="off">
        <a href="#" class="tmt-btn" data-act="save-key">Save</a></div>`;
    } else if (!D) {
      body = `<div class="tmt-tip info">${err ? esc(err) : 'Loading…'}</div>`;
    } else {
      const tips = advice().map((x) => x.href
        ? `<a class="tmt-tip ${x.c}" href="${x.href}"${/tornstats/.test(x.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(x.t)}</a>`
        : `<div class="tmt-tip ${x.c}">${esc(x.t)}</div>`).join('');
      body = `
        <div class="tmt-sec">Next</div>${tips}
        <div class="tmt-sec">Praetorians</div>${D.guards.map(bar).join('')}
        <div class="tmt-sec">Boss</div>${bar(D.maol)}
        <div class="tmt-foot">
          <span>You: ${esc(D.me.where || D.me.desc)} · ${METHOD_NAME[method]}${p.book ? ' + book' : ''}</span>
          <a href="#" data-act="biz" class="${UI.biz ? 'on' : ''}">${UI.biz ? 'Using business ticket' : 'Have business ticket?'}</a>
        </div>
        <div class="tmt-foot"><span>${err ? '⚠ ' + esc(err) : 'Updated ' + tct(D.t) + ' TCT'}</span>
          ${IS_PDA ? '' : '<a href="#" data-act="forget-key">change key</a>'}</div>`;
    }
    const docked = !!btnHost && btnHost.isConnected;
    root.classList.toggle('tmt-docked', docked);
    root.innerHTML = `
      <div class="tmt-head" data-act="toggle"><span>M'aol</span><span class="tmt-pill">${D ? pill() : ''}</span><span class="tmt-caret">${docked ? '✕' : UI.open ? '▾' : '▸'}</span></div>
      ${UI.open ? `<div class="tmt-body">${body}</div>` : ''}`;
    root.style.display = docked && !UI.open ? 'none' : '';
    if (docked) {
      const b = btnHost.getBoundingClientRect();
      root.style.top = `${Math.round(b.bottom + 4)}px`;
      root.style.left = `${Math.round(Math.max(10, Math.min(b.right - 300, window.innerWidth - 310)))}px`;
      const dot = btnHost.querySelector('.tmt-dot');
      const lvl = !D ? '' : advice().some((x) => x.c === 'go') ? 'go' : pill() === 'dormant' ? '' : 'warn';
      dot.className = `tmt-dot ${lvl}`;
      btnHost.querySelector('button').title = D ? `M'aol: ${pill()}` : "M'aol tracker";
      // Red while M'aol is summoned (awake or his guards up), Torn's own grey when dormant.
      btnHost.classList.toggle('tmt-live', !!D && (D.maol.state === 'Awoken' || D.guards.some((g) => g.state === 'Awoken')));
    }
  }

  // Torn styles each header item by its own class, so copy the box of a real sibling
  // (the binoculars, else any other header button) instead of guessing sizes.
  const BOX = ['display', 'float', 'width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'lineHeight', 'verticalAlign', 'alignItems', 'justifyContent', 'boxSizing'];
  function matchNeighbour() {
    const ref = document.querySelector('ul.toolbar > li.find-extend') ||
      [...document.querySelectorAll('ul.toolbar > li')].find((li) => li !== btnHost && li.querySelector(':scope > button.top_header_button'));
    const refBtn = ref?.querySelector(':scope > button.top_header_button');
    if (!ref || !refBtn) return;
    const copy = (from, to, keys) => { const cs = getComputedStyle(from); keys.forEach((k) => { to.style[k] = cs[k]; }); };
    copy(ref, btnHost, BOX);
    btnHost.style.position = 'relative';
    const btn = btnHost.querySelector('button');
    copy(refBtn, btn, [...BOX, 'background', 'border', 'cursor', 'color', 'fill', 'opacity']);
    const refSvg = refBtn.querySelector('svg');
    const svg = btn.querySelector('svg');
    if (refSvg && svg) {
      const r = refSvg.getBoundingClientRect();
      if (r.width) { svg.setAttribute('width', Math.round(r.width)); svg.setAttribute('height', Math.round(r.height)); }
      const cs = getComputedStyle(refSvg);
      svg.style.fill = cs.fill;
      svg.style.filter = cs.filter;
      svg.style.verticalAlign = cs.verticalAlign;
      svg.style.display = cs.display;
    }
  }

  // Desktop shows a wide search box: sit right after it, next to the binoculars.
  // Phone shows only a magnifier button: sit left of it.
  function place() {
    const find = document.querySelector('ul.toolbar > li.find-wrapper');
    if (!find || !btnHost) return;
    const wide = find.getBoundingClientRect().width > 80;
    const ext = find.parentNode.querySelector(':scope > li.find-extend');
    const before = wide && ext ? ext : find;
    if (btnHost.nextElementSibling !== before) find.parentNode.insertBefore(btnHost, before);
    matchNeighbour();
    if (wide) makeRoom(find); else restoreRoom();
  }

  // Desktop search row holds two boxes side by side (search, "Forum posts").
  // Torn lays the toolbar out at fixed spots, so each box gives up the button's full width.
  let shrunk = [];
  function restoreRoom() {
    shrunk.forEach(({ el, w, mw, fl }) => { el.style.width = w; el.style.minWidth = mw; el.style.flex = fl; });
    shrunk = [];
  }
  function makeRoom(find) {
    restoreRoom();
    const need = Math.ceil(btnHost.getBoundingClientRect().width);
    if (!need) return;
    // The deepest element whose visible children include two boxes wider than 80px.
    let row = null;
    find.querySelectorAll('*').forEach((el) => {
      const kids = [...el.children].filter((c) => c.getBoundingClientRect().width > 80);
      if (kids.length >= 2) row = { el, kids };
    });
    if (!row) return;
    const each = need;
    row.kids.forEach((el) => {
      const w = el.getBoundingClientRect().width;
      shrunk.push({ el, w: el.style.width, mw: el.style.minWidth, fl: el.style.flex });
      el.style.minWidth = '0';
      el.style.flex = '0 0 auto';
      el.style.width = `${Math.round(w - each)}px`;
      el.querySelectorAll('input').forEach((i) => { i.style.minWidth = '0'; i.style.maxWidth = '100%'; });
    });
  }

  // ------------------------------------------------------------- header button
  // Torn's header toolbar: <ul class="toolbar"><li class="find-wrapper">(search)</li>...
  // The button sits just left of the search magnifier and opens the panel as a dropdown.
  const ICON = '<svg width="24" height="25" viewBox="3 1 18 22" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c-3.9 0-7 2.9-7 6.6 0 2 1 3.8 2.5 5-.3 1.5-1.2 2.8-2.5 3.6.9.5 2.4.4 3.6-.6.3 1.4.1 2.7-.6 3.9 1.4-.2 2.6-1.3 3.1-2.8.4.9.4 2-.1 2.9 1.2-.4 2-1.5 2.1-2.8.5.9 1.4 1.6 2.5 1.8-.6-1.1-.8-2.4-.5-3.6 1 .9 2.3 1.3 3.5 1-1.2-.8-2-2.1-2.3-3.5C19 13.4 19 11.6 19 9.6 19 5.9 15.9 3 12 3Zm-3 5.2a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Zm6 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"/></svg>';
  let btnHost = null;
  function mountButton() {
    if (btnHost && btnHost.isConnected) return;
    const find = document.querySelector('ul.toolbar > li.find-wrapper');
    if (!find) return;
    btnHost = document.createElement('li');
    btnHost.className = 'tmt-host';
    btnHost.innerHTML = `<button type="button" class="top_header_button button" aria-label="Open M'aol tracker">${ICON}</button><span class="tmt-dot"></span>`;
    btnHost.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      UI.open = !UI.open; saveUi(); render();
    });
    place();
    render();
  }

  function pill() {
    const down = D.guards.filter((g) => g.hp <= 0).length;
    if (D.maol.state === 'Dormant' && down === 5) return 'dormant';
    return down < 5 ? `${down}/5 guards` : `boss ${fmtHp(D.maol.hp)}`;
  }

  function onClick(e) {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    e.preventDefault();
    const act = a.dataset.act;
    if (act === 'toggle') { UI.open = !UI.open; saveUi(); render(); }
    if (act === 'biz') { UI.biz = !UI.biz; saveUi(); render(); }
    if (act === 'forget-key') { store(K.key, ''); D = null; render(); }
    if (act === 'save-key') {
      const v = (root.querySelector('#tmt-key')?.value || '').trim();
      if (/^[A-Za-z0-9]{16}$/.test(v)) { store(K.key, v); render(); refresh(); }
    }
  }

  function css() {
    const s = document.createElement('style');
    s.textContent = `
      .tmt-host { position: relative; }
      .tmt-host button:hover svg { filter: brightness(1.6) !important; }
      .tmt-host.tmt-live svg, .tmt-host.tmt-live svg path { fill: #e53935 !important; }
      .tmt-host .tmt-dot { position: absolute; top: 9px; right: 4px; width: 6px; height: 6px; border-radius: 50%; pointer-events: none; display: none;
        box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
      .tmt-host .tmt-dot.go { display: block; background: var(--default-green-color, #82c91e); }
      .tmt-host .tmt-dot.warn { display: block; background: var(--default-orange-color, #f08c00); }
      #tmt.tmt-docked { bottom: auto; }
      #tmt { position: fixed; left: 10px; bottom: 10px; z-index: 99999; width: 300px; max-width: calc(100vw - 20px);
        font: 12px Arial, sans-serif; color: var(--default-color, #ddd); color-scheme: dark;
        background: var(--default-bg-panel-color, #333); border-radius: 5px; box-shadow: 0 2px 12px rgba(0,0,0,.6); }
      #tmt .tmt-head { display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 30px; cursor: pointer; user-select: none;
        border-radius: 5px; font-weight: bold; color: #fff; text-shadow: 0 0 2px #000;
        background: var(--title-black-gradient, linear-gradient(180deg, #555 0%, #333 100%)); }
      #tmt .tmt-pill { margin-left: auto; font-weight: normal; color: var(--default-content-title-color, #bbb); }
      #tmt .tmt-body { max-height: 70vh; overflow-y: auto; padding: 4px 0 6px;
        scrollbar-width: thin; scrollbar-color: var(--appheader-dropdown-list-scrollbar-thumb-color, #666) var(--appheader-dropdown-list-scrollbar-track-color, #222); }
      #tmt .tmt-body::-webkit-scrollbar { width: 6px; }
      #tmt .tmt-body::-webkit-scrollbar-track { background: var(--appheader-dropdown-list-scrollbar-track-color, #222); }
      #tmt .tmt-body::-webkit-scrollbar-thumb { background: var(--appheader-dropdown-list-scrollbar-thumb-color, #666); border-radius: 3px; }
      #tmt .tmt-sec { padding: 6px 10px 3px; font-weight: bold; color: var(--default-content-title-color, #999); text-transform: uppercase; font-size: 10px; letter-spacing: .5px; }
      #tmt a { color: var(--default-blue-color, #74c0fc); text-decoration: none; }
      #tmt .tmt-tip { display: block; margin: 2px 8px; padding: 5px 7px; border-radius: 4px; line-height: 1.35;
        background: var(--default-bg-panel-active-color, #444); border-left: 3px solid #888; color: var(--default-color, #ddd); }
      #tmt .tmt-tip.go { border-left-color: var(--default-green-color, #82c91e); }
      #tmt .tmt-tip.warn { border-left-color: var(--default-orange-color, #f08c00); }
      #tmt a.tmt-tip:hover { background: var(--default-bg-panel-hover-color, #555); }
      #tmt .tmt-row { display: grid; grid-template-columns: 1fr auto; gap: 1px 6px; padding: 4px 10px; color: inherit;
        border-bottom: 1px solid var(--panel-border-bottom-color, #3b3b3b); }
      #tmt .tmt-row:hover { background: var(--default-bg-panel-active-color, #444); }
      #tmt .tmt-name { font-weight: bold; }
      #tmt .tmt-where, #tmt .tmt-sub { color: var(--default-content-title-color, #999); text-align: right; white-space: nowrap; }
      #tmt .tmt-hp { position: relative; height: 14px; background: #1a1a1a; border-radius: 3px; overflow: hidden; }
      #tmt .tmt-hp i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(180deg, #8bc34a, #5a8a1e); }
      #tmt .tmt-hp b { position: relative; display: block; text-align: center; font-size: 10px; line-height: 14px; color: #fff; text-shadow: 0 0 2px #000; }
      #tmt .tmt-dead { opacity: .5; }
      #tmt .tmt-foot { display: flex; justify-content: space-between; gap: 6px; padding: 5px 10px 0; font-size: 11px; color: var(--default-content-title-color, #999); }
      #tmt .tmt-foot a.on { color: var(--default-green-color, #82c91e); }
      #tmt .tmt-key { padding: 8px 10px; line-height: 1.6; }
      #tmt input { width: 150px; color: var(--input-color, #fff); background: var(--input-background-color, linear-gradient(0deg, #111 0%, #000 100%));
        border: 1px solid var(--input-border-color, #444); border-radius: 5px; padding: 3px 6px; outline: none; font: inherit; }
      #tmt input:focus { border-color: var(--input-focus-border-color, #1864ab80); }
      #tmt input::placeholder { color: var(--input-disabled-color, #666); }
      #tmt .tmt-btn { display: inline-block; margin-left: 4px; padding: 3px 10px; border-radius: 5px; font-weight: bold;
        color: var(--btn-color, #eee); text-shadow: 0 0 5px #000; background: var(--btn-background, linear-gradient(180deg, #555 0%, #333 100%));
        border: 1px solid var(--btn-border-color, #222); }
    `;
    document.head.appendChild(s);
  }

  function init() {
    if (document.getElementById('tmt')) return;
    css();
    root = document.createElement('div');
    root.id = 'tmt';
    root.addEventListener('click', onClick);
    document.body.appendChild(root);
    // Close the dropdown like Torn's own: click outside or Escape.
    document.addEventListener('click', (e) => {
      if (UI.open && btnHost?.isConnected && !root.contains(e.target) && !btnHost.contains(e.target)) { UI.open = false; saveUi(); render(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.open && btnHost?.isConnected) { UI.open = false; saveUi(); render(); } });
    window.addEventListener('resize', () => { restoreRoom(); place(); if (UI.open) render(); });
    // Torn re-renders its header on some pages: put the button back when it goes missing.
    new MutationObserver(() => { if (!btnHost || !btnHost.isConnected) mountButton(); }).observe(document.body, { childList: true, subtree: true });
    mountButton();
    render();
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 5 * 1000);
  }

  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
