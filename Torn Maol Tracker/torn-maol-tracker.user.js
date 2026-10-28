// ==UserScript==
// @name         Torn M'aol tracker
// @namespace    kamiren.torn-maol-tracker
// @version      1.0.19
// @description  Live M'aol and Praetorian status with flight times for your own travel perks and what to do next
// @author       KamiRen [2805199]
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      live.chain-race.workers.dev
// ==/UserScript==

(function () {
  'use strict';

  const POLL_S = 15;               // you + live NPCs: at most 7 calls, 28 of Torn's 100 calls/min per key
  const IDLE_POLL_S = 600;          // dead NPCs, or M'aol alone while everything sleeps: every 10 min
  const PERKS_S = 6 * 3600;
  const RATE_WINDOW_S = 15 * 60;   // HP samples kept
  const ETA_WINDOW_S = 5 * 60;     // kill rate from the last 5 min: damage speeds up as guards fall
  const SHIELD_PCT = 0.05;         // below 5% HP M'aol's shield slows the kill too much to extrapolate
  const HOP_S = 15 * 60;           // M'aol moves on every quarter hour (:00 :15 :30 :45 TCT)
  const RESUMMON_S = 48 * 3600;    // next summon about 48h after M'aol's kill (chain-race's estimate)
  const FEED = 'https://live.chain-race.workers.dev/npc.json';   // public M'aol feed by LDP: defeat times, next summon
  const FEED_LIVE_S = 120;         // feed check while deaths are missing during the event

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
  const SHORT = { 'Cayman Islands': 'Cayman', 'United Kingdom': 'UK', 'South Africa': 'S. Africa' };
  const METHOD = { standard: 1, airstrip: 0.7, wlt: 0.5, business: 0.3 };
  const METHOD_NAME = { standard: 'Standard', airstrip: 'Airstrip', wlt: 'WLT jet', business: 'Business ticket' };

  // ------------------------------------------------------------- storage
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  // samples: { id: [[t, hp], ...] }, deaths: { id: { t, country } }, hops: [[t, country], ...] (M'aol's moves),
  // polled: { id: t }, perks: {...}, snap: last snapshot, nextSummon: feed's estimate, summonAt: when we saw the summon
  let ST = Object.assign({ samples: {}, deaths: {}, hops: [], polled: {}, perks: null, perksAt: 0, feedAt: 0, nextSummon: 0, summonAt: 0 }, load(K.state, {}));
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
  // Times show in the viewer's own clock; TCT is UTC.
  const hm = (t) => { const d = new Date(t * 1000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const tzLabel = () => { const o = -new Date().getTimezoneOffset() / 60; return o ? `TCT${o > 0 ? '+' : ''}${o}` : 'TCT'; };

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

  // Public feed, not Torn: it has no CORS headers, so it goes through the userscript manager (or PDA).
  async function feedGet() {
    const url = `${FEED}?ts=${now()}`;
    let text;
    if (typeof GM_xmlhttpRequest === 'function') {
      text = await new Promise((ok, fail) => GM_xmlhttpRequest({ method: 'GET', url, timeout: 15000,
        onload: (r) => (r.status === 200 ? ok(r.responseText) : fail(new Error(r.status))), onerror: fail, ontimeout: fail }));
    } else if (typeof window.PDA_httpGet === 'function') {
      const r = await window.PDA_httpGet(url, {});
      text = (r && (r.responseText || r.text || r.body)) || (typeof r === 'string' ? r : '');
    } else {
      text = await (await fetch(url)).text();
    }
    return JSON.parse(text);
  }

  function countryOf(desc) {
    const m = /(?:[Ii]n|[Tt]o|[Ff]rom)\s+([A-Z][A-Za-z ]+?)\s*$/.exec(String(desc || '').trim());
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
    const wait = me.busyUntil ? Math.max(0, (me.busyUntil - now()) / 60) : 0;
    if (me.where === country) return wait;
    let t = flightMin(country, method);
    if (me.where && me.where !== 'Torn') t += flightMin(me.where, method);
    return t + wait;
  }

  // ------------------------------------------------------------- data
  let D = ST.snap || null;   // last snapshot: shown straight away, kept on screen when a refresh fails
  let err = '';

  // Minutes until the NPC falls, from the HP lost over the last 5 min.
  // Infinity: no drop yet, or M'aol under 5% where his shield makes the pace meaningless.
  function killEta(id, hp, max) {
    if (hp <= 0) return Infinity;
    if (id === MAOL.id && max && hp / max < SHIELD_PCT) return Infinity;
    const s = (ST.samples[id] || []).filter(([t]) => now() - t <= ETA_WINDOW_S);
    if (s.length < 2) return Infinity;
    const [t0, h0] = s[0];
    const [t1, h1] = s[s.length - 1];
    const perMin = (h0 - h1) / Math.max(1, (t1 - t0) / 60);
    return perMin > 0 ? hp / perMin : Infinity;
  }
  const shielded = (n) => n.id === MAOL.id && n.hp > 0 && n.max && n.hp / n.max < SHIELD_PCT;

  // Dead NPCs don't change while the event runs, so they're only re-checked every 10 min. While everything
  // sleeps in Halloween week, only M'aol is checked (1 call per 10 min) to catch a new summon.
  function due(n, t) {
    if (!D) return true;
    if (!anyAwake(D)) return n.id === MAOL.id && t - (ST.polled[n.id] || 0) >= IDLE_POLL_S;
    const prev = [D.maol, ...D.guards].find((x) => x.id === n.id);
    if (!prev || prev.hp > 0 || prev.state !== 'Dormant') return true;
    return t - (ST.polled[n.id] || 0) >= IDLE_POLL_S;
  }

  function parseNpc(base, r) {
    const p = r.profile || {};
    return {
      ...base,
      state: /^dormant/i.test(p.status?.description || '') ? 'Dormant' : 'Awoken',
      desc: p.status?.description || '',
      country: countryOf(p.status?.description),
      hp: p.life?.current ?? 0,
      max: p.life?.maximum ?? 0,
    };
  }

  // Summons are only possible in Halloween week (26 Oct 10:00 – 31 Oct 23:59 TCT). Outside it, and with
  // nothing awake in the last snapshot, the script sleeps: no API calls at all.
  function inSummonWindow(t) {
    const d = new Date(t * 1000);
    const y = d.getUTCFullYear();
    return t >= Date.UTC(y, 9, 26, 10) / 1000 && t < Date.UTC(y, 10, 1) / 1000;
  }
  const anyAwake = (snap) => !!snap && [snap.maol, ...snap.guards].some((n) => n.state === 'Awoken');
  const sleeping = () => !inSummonWindow(now()) && !anyAwake(D);

  let inFlight = false;   // a slow API must not stack refreshes (the timer ticks every 5 s)
  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    try { await poll(); } finally { inFlight = false; }
  }
  async function poll() {
    if (!apiKey() || sleeping()) { render(); return; }
    // Several Torn tabs share one snapshot: only the first tab due polls the API.
    const fresh = load(K.state, {});
    const dormant = fresh.snap && fresh.snap.maol.state === 'Dormant' && fresh.snap.guards.every((g) => g.state === 'Dormant');
    if (fresh.snap && now() - fresh.snap.t < (dormant ? IDLE_POLL_S : POLL_S) - 2) {
      ST = Object.assign(ST, fresh);
      D = fresh.snap;
      render();
      return;
    }
    const t = now();
    const all = [MAOL, ...GUARDS];
    const ask = all.filter((n) => due(n, t));
    if (!ask.length) { render(); return; }
    const quiet = D && !anyAwake(D);
    // allSettled: one failed call keeps the last known value instead of failing the whole refresh.
    const res = await Promise.allSettled([
      quiet ? Promise.resolve(null) : tornApi('user/basic'),
      ...ask.map((n) => tornApi(`user/${n.id}/profile`)),
      !quiet && (!ST.perks || t - ST.perksAt > PERKS_S) ? tornApi('user/perks') : Promise.resolve(null),
    ]);
    const failed = res.filter((r) => r.status === 'rejected');
    if (failed.length === res.length) {
      const msg = failed[0].reason?.message || String(failed[0].reason);
      err = /^Torn API error|^No API key/.test(msg) ? msg : "Can't reach the Torn API, retrying";
      render();
      return;
    }
    const perksRes = res[res.length - 1];
    if (perksRes.status === 'fulfilled' && perksRes.value) { ST.perks = perksRes.value.perks || null; ST.perksAt = t; }

    const list = all.map((base) => {
      const i = ask.indexOf(base);
      const r = i >= 0 ? res[i + 1] : null;
      if (r && r.status === 'fulfilled') { ST.polled[base.id] = t; return parseNpc(base, r.value); }
      return D && [D.maol, ...D.guards].find((x) => x.id === base.id);
    });
    if (list.some((n) => !n)) {   // nothing to fall back on yet
      err = failed[0]?.reason?.message || 'Incomplete API response';
      render();
      return;
    }
    list.forEach((n) => {
      const asked = ask.some((a) => a.id === n.id);
      const arr = (ST.samples[n.id] || []).filter(([ts]) => t - ts <= RATE_WINDOW_S);
      const prev = arr[arr.length - 1];
      if (prev && prev[1] > 0 && n.hp <= 0 && !ST.deaths[n.id]) ST.deaths[n.id] = { t, country: n.country };
      if (n.hp > 0 && ST.deaths[n.id] && n.state === 'Awoken') delete ST.deaths[n.id]; // new summon
      if (asked) { arr.push([t, n.hp]); ST.samples[n.id] = arr; }
    });
    // M'aol's moves: every country change is one hop. They teach the loop order when deaths were missed.
    const m = list[0];
    if (quiet && m.state === 'Awoken' && ask.some((a) => a.id === MAOL.id)) { ST.polled = {}; ST.summonAt = t; ST.nextSummon = 0; }   // new summon: check everyone on the next refresh
    if (m.state === 'Awoken' && !m.country) ST.hops = [];   // summoned, not moving yet
    const last = ST.hops[ST.hops.length - 1];
    if (m.state === 'Awoken' && m.country && (!last || last[1] !== m.country)) ST.hops = [...ST.hops, [t, m.country]].slice(-40);

    let me = D?.me || { state: 'Okay', desc: '', where: 'Torn', busyUntil: 0, landing: 0 };
    if (res[0].status === 'fulfilled' && res[0].value) {
      const st = res[0].value.profile?.status || {};
      const tr = st.state === 'Traveling' ? await tornApi('user/travel').then((x) => x.travel || {}, () => ({})) : {};
      me = { state: st.state, desc: st.description || '', where: 'Torn', busyUntil: 0, landing: 0 };
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
    }
    D = { t, maol: m, guards: list.slice(1), me };
    ST.snap = D;
    err = failed.length ? 'Some API calls failed, retrying' : '';
    await syncFeed(t);
    saveState();
    render();
  }

  // The chain-race feed fills what this tab didn't see: guard deaths before you opened Torn (so M'aol's
  // loop is exact straight away) and M'aol's kill time (for the next-summon countdown).
  // Only asked when something is missing: every 2 min while deaths are missing, every 10 min while dormant.
  async function syncFeed(t) {
    const missing = D.guards.some((g) => g.hp <= 0 && !ST.deaths[g.id]) && anyAwake(D);
    const noSummonTime = !anyAwake(D) && !nextSummonAt();
    if (!missing && !noSummonTime) return;
    if (t - ST.feedAt < (missing ? FEED_LIVE_S : IDLE_POLL_S)) return;
    ST.feedAt = t;
    let f;
    try { f = await feedGet(); } catch (e) { return; }   // the feed is optional: no data, no change
    if (!anyAwake(D) && f?.next_summon?.t > t - RESUMMON_S) ST.nextSummon = f.next_summon.t;
    const ids = Object.fromEntries(GUARDS.map((g) => [g.name, g.id]));
    for (const s of f?.route?.stops || []) {
      const id = ids[s.npc];
      const g = D.guards.find((x) => x.id === id);
      // Only this summon's deaths: the guard is dead now, in the same country, and fell after the summon.
      if (!g || g.hp > 0 || ST.deaths[id] || s.where !== g.country || !(s.defeated > 0)) continue;
      if (s.defeated < (ST.summonAt || t - 7 * 86400) - 60 || s.defeated > t + 60) continue;
      ST.deaths[id] = { t: s.defeated, country: s.where };
    }
  }

  // Next summon: ~48h after M'aol's kill, from our own sighting or else the feed. 0 when unknown,
  // or once it's 6h overdue (a summon needs a player to start it, so it can come late).
  function nextSummonAt() {
    const own = ST.deaths[MAOL.id] ? ST.deaths[MAOL.id].t + RESUMMON_S : 0;
    const ns = own || ST.nextSummon || 0;
    return ns > now() - 6 * 3600 ? ns : 0;
  }

  // ------------------------------------------------------------- M'aol's route
  // He loops through the dead guards' countries in the order they died, one stop per quarter hour,
  // with no flight in between. A guard that dies later joins the end of the loop. He starts looping
  // while the bond still holds (seen 2026: moving with 2 guards alive).

  // Loop order learnt from his own moves: two moves ~15 min apart are neighbours on the loop.
  function hopNext() {
    const next = {};
    for (let i = 1; i < ST.hops.length; i++) {
      const [ta, a] = ST.hops[i - 1];
      const [tb, b] = ST.hops[i];
      if (tb - ta >= 10 * 60 && tb - ta <= 20 * 60) next[a] = b;
    }
    return next;
  }

  // Dead guards' countries in death order. exact: every death was seen, or his moves filled the gaps.
  function deathOrder(guards) {
    const dead = guards.filter((g) => g.hp <= 0 && g.country);
    const seen = dead.filter((g) => ST.deaths[g.id]).sort((a, b) => ST.deaths[a.id].t - ST.deaths[b.id].t);
    if (seen.length === dead.length) return { loop: seen.map((g) => ST.deaths[g.id].country || g.country), exact: true };
    const want = new Set(dead.map((g) => g.country));
    const next = hopNext();
    const start = dead[0].country;
    const cycle = [start];
    for (let c = next[start]; c && c !== start && cycle.length <= want.size; c = next[c]) cycle.push(c);
    if (next[cycle[cycle.length - 1]] === start && cycle.length === want.size && cycle.every((c) => want.has(c))) {
      // Rotate so the latest death he was seen dying is last: new deaths go after it.
      const lastSeen = seen.length ? seen[seen.length - 1].country : null;
      const k = lastSeen ? cycle.indexOf(lastSeen) : cycle.length - 1;
      return { loop: [...cycle.slice(k + 1), ...cycle.slice(0, k + 1)], exact: !!lastSeen };
    }
    const unseen = dead.filter((g) => !ST.deaths[g.id]).map((g) => g.country);
    return { loop: [...unseen, ...seen.map((g) => g.country)], exact: false, unknown: unseen };
  }

  // Where M'aol is now and his next stops, each with its arrival time.
  function plan(D) {
    const { maol, guards } = D;
    const t = now();
    const order = deathOrder(guards);
    const alive = guards.filter((g) => g.hp > 0 && g.state === 'Awoken');
    const pend = alive.map((g) => { const e = killEta(g.id, g.hp, g.max); return { g, at: isFinite(e) ? t + e * 60 : Infinity }; })
      .sort((a, b) => (a.at - b.at) || (a.g.hp / a.g.max - b.g.hp / b.g.max));
    const bondAt = !alive.length ? 0 : Math.max(...pend.map((p) => p.at));
    const loopAt = (T) => [...order.loop, ...pend.filter((p) => p.at <= T).map((p) => p.g.country)];
    const meta = { order, pend, bondAt, stops: [] };
    if (maol.state !== 'Awoken' || !maol.country) return meta;
    const seen = order.exact ? {} : hopNext();   // order partly guessed: his own moves win
    let c = maol.country;
    let T = Math.floor(t / HOP_S) * HOP_S + HOP_S;
    meta.leaves = T;
    // Enough stops to cover the bond break plus one more loop, so stay-or-fly can look past it.
    const until = (isFinite(bondAt) ? Math.max(bondAt, t) : t) + 6 * HOP_S;
    for (let k = 0; k < 40 && T <= until; k++, T += HOP_S) {
      const L = loopAt(T);
      const i = L.indexOf(c);
      if (i < 0 || L.length < 2) break;
      c = seen[c] && L.includes(seen[c]) ? seen[c] : L[(i + 1) % L.length];
      meta.stops.push({ c, at: T });
    }
    return meta;
  }

  // ------------------------------------------------------------- what to do next
  function advice() {
    if (!D) return [];
    const { maol, guards, me } = D;
    const method = bestMethod();
    const tips = [];
    const t = now();
    const alive = guards.filter((g) => g.state === 'Awoken' && g.hp > 0);
    const busy = me.busyUntil > t;

    if (busy) {
      const what = me.state === 'Traveling' ? `Landing in ${me.where} at ${hm(me.busyUntil)}` : `${me.state} until ${hm(me.busyUntil)}`;
      tips.push({ c: 'info', t: `${what}. Times below already count that wait.` });
    }

    if (maol.state === 'Dormant' && !alive.length) {
      const ns = nextSummonAt();
      const left = ns ? (ns - t) / 60 : 0;
      tips.push({ c: 'info', t: !ns || !inSummonWindow(ns) ? "M'aol and his Praetorians are dormant. Nothing to fight right now."
        : left > 0 ? `All dormant. Next summon ~${hm(ns)} (in ${fmtMin(left)}).` : 'All dormant. Next summon any time now.' });
      return tips;
    }

    if (alive.length) {
      const here = alive.find((g) => g.country === me.where);
      if (here && !busy) {
        tips.push({ c: 'go', t: `${here.name} is in ${here.country} with you. Hit now.`, href: `https://www.torn.com/loader.php?sid=attack&user2ID=${here.id}` });
      }
      const scored = alive.map((g) => {
        const trip = tripMin(me, g.country, method);
        const eta = killEta(g.id, g.hp, g.max);
        return { g, trip, eta, ok: trip + 3 < eta };
      }).sort((a, b) => a.trip - b.trip);
      const pick = scored.find((s) => s.ok && s.g !== here);
      if (pick) {
        tips.push({ c: 'go', t: `Fly to ${pick.g.country} (${METHOD_NAME[method]}, ${fmtMin(pick.trip)}). ${pick.g.name} has ${fmtHp(pick.g.hp)} HP` + (isFinite(pick.eta) ? `, ~${fmtMin(pick.eta)} left at current pace.` : ', barely touched.'), href: 'https://www.torn.com/page.php?sid=travel' });
      }
      scored.filter((s) => !s.ok).forEach((s) => {
        tips.push({ c: 'warn', t: `Skip ${s.g.name} in ${s.g.country}: dies in ~${fmtMin(s.eta)}, you need ${fmtMin(s.trip)}.` });
      });
    }

    const P = plan(D);
    if (P.order.unknown && P.order.unknown.length > 1) {
      tips.push({ c: 'warn', t: `Missed ${P.order.unknown.length} guard deaths, so his order is partly a guess until he's been watched for one loop. tornstats.com/maol has it now.`, href: 'https://www.tornstats.com/maol' });
    }

    if (maol.state === 'Awoken' && maol.hp > 0) {
      const bonded = alive.length > 0;
      if (!bonded && maol.country === me.where && !busy) {
        tips.push({ c: 'go', t: `Hit M'aol now. He's here in ${me.where} until ${hm(P.leaves)}.`, href: `https://www.torn.com/loader.php?sid=attack&user2ID=${MAOL.id}` });
      } else if (maol.country && isFinite(P.bondAt)) {
        tips.push(stayOrFly(P, maol, me, method, bonded));
      }
      if (bonded) {
        tips.push({ c: 'info', t: `Bond: M'aol can't be attacked until all 5 guards are dead (${5 - alive.length}/5 down` + (isFinite(P.bondAt) ? `, last one ~${hm(P.bondAt)}).` : ').') });
      }
      if (maol.country) {
        const you = (c) => (c === me.where ? '<i>you</i>' : '');
        const rows = [`<span>now</span><b>${esc(maol.country)}</b><em>until ${hm(P.leaves)}</em>${you(maol.country)}`,
          ...P.stops.slice(0, 5).map((s) => `<span>${hm(s.at)}</span><b>${esc(s.c)}</b><em></em>${you(s.c)}`)];
        tips.push({ c: 'route', h: `<div class="tmt-rt">M'aol's route <small>one stop every 15 min, no flight time</small></div>` +
          rows.map((r, i) => `<div class="tmt-stop${i ? '' : ' now'}">${r}</div>`).join('') });
      } else if (P.order.loop.length) {
        tips.push({ c: 'info', t: `M'aol hasn't started moving yet. He'll loop through ${P.order.loop.join(' → ')}${alive.length ? ', plus each guard\'s country as it dies' : ''}.` });
      }
    }

    tips.push({ c: 'note', t: "Loot: every turn you land damage is 1 lottery ticket, however small the hit. Tickets count until the kill, so keep hitting. Every guard drops the same 1,101 items, so a less crowded fight means better odds." });
    tips.push({ c: 'note', t: 'Healing: bring medical items (first aid kits, blood bags, morphine) so a loss doesn\'t keep you in hospital and you can keep hitting.' });
    return tips;
  }

  // Stay where you are or fly: the first stop you can reach while he's still there (and alive).
  function stayOrFly(P, maol, me, method, bonded) {
    const t = now();
    const eta = killEta(MAOL.id, maol.hp, maol.max);
    const deathAt = bonded || !isFinite(eta) ? Infinity : t + eta * 60;
    const opens = bonded ? P.bondAt : t;
    const windows = [{ c: maol.country, from: t, to: P.leaves }, ...P.stops.map((s) => ({ c: s.c, from: s.at, to: s.at + HOP_S }))];
    const fits = windows.map((w) => {
      const arrive = t + tripMin(me, w.c, method) * 60 + 60;
      const start = Math.max(w.from, arrive, opens);
      return { ...w, arrive, start, ok: start < Math.min(w.to, deathAt) - 60 };
    }).filter((w) => w.ok);
    const lowHp = shielded(maol) ? ' He is under 5% and his shield slows the kill, so the end time is uncertain.' : '';
    if (!fits.length) {
      return { c: 'warn', t: (isFinite(deathAt) ? `At this pace he dies ~${hm(deathAt)}, before you can reach any stop. ` : "You can't reach any of his next stops in time. ") + 'Stay put.' + lowHp };
    }
    // Earliest hit wins, but a stop only 15 min later with a shorter trip (or no trip) is the better deal.
    const first = Math.min(...fits.map((w) => w.start));
    const best = fits.filter((w) => w.start <= first + HOP_S)
      .sort((a, b) => ((b.c === me.where) - (a.c === me.where)) || (a.arrive - b.arrive) || (a.start - b.start))[0];
    const win = `${hm(best.from)}–${hm(best.to)}`;
    if (best.c === me.where && me.where !== 'Torn') {
      return { c: 'go', t: (best.from > t ? `Stay in ${best.c}. M'aol arrives ${hm(best.from)} (in ${fmtMin((best.from - t) / 60)}) and leaves ${hm(best.to)}.` : `Stay in ${best.c}. M'aol is here until ${hm(best.to)}.`) + (bonded ? ' Only once the bond breaks.' : '') + lowHp };
    }
    const home = me.where && me.where !== 'Torn' && fits.some((w) => w.c === me.where) ? ` Or stay: he's back in ${me.where} ${hm(fits.find((w) => w.c === me.where).from)}.` : '';
    return { c: 'go', t: `Fly to ${best.c} now (${METHOD_NAME[method]}, ${fmtMin(tripMin(me, best.c, method))}). M'aol is there ${win}.` + (bonded ? ' First stop after the bond breaks.' : '') + home + lowHp, href: 'https://www.torn.com/page.php?sid=travel' };
  }

  // ------------------------------------------------------------- UI
  let root;
  function bar(n) {
    const pct = n.max ? Math.max(0, Math.min(100, (n.hp / n.max) * 100)) : 0;
    const dead = n.hp <= 0;
    const eta = killEta(n.id, n.hp, n.max);
    const where = n.country || (n.id === MAOL.id ? (n.state === 'Awoken' ? 'Awoken' : 'Dormant') : '?');
    const sub = dead ? (ST.deaths[n.id] ? `down ${hm(ST.deaths[n.id].t)}` : 'down')
      : shielded(n) ? 'shield, slowing' : isFinite(eta) ? `~${fmtMin(eta)} left` : '';
    const tm = D && n.country && !dead ? tripMin(D.me, n.country, bestMethod()) : null;
    const trip = tm == null ? '' : tm < 1 && D.me.where === n.country ? 'here' : fmtMin(tm);
    return `<a class="tmt-row${dead ? ' tmt-dead' : ''}" href="https://www.torn.com/profiles.php?XID=${n.id}">
      <span class="tmt-name">${esc(n.name)}</span>
      <span class="tmt-where" title="${esc(where)}">${esc(SHORT[where] || where)}${trip ? ` · ${trip === 'here' ? 'here' : `✈ ${trip}`}` : ''}</span>
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
      body = `<div class="tmt-tip info">${sleeping() ? "M'aol sleeps until Halloween week (26 Oct). No API calls until then." : err ? esc(err) : 'Loading…'}</div>`;
    } else {
      const tip = (x) => x.href
        ? `<a class="tmt-tip ${x.c}" href="${x.href}"${/tornstats/.test(x.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(x.t)}</a>`
        : `<div class="tmt-tip ${x.c}">${x.h || esc(x.t)}</div>`;
      const all = advice();
      const notes = all.filter((x) => x.c === 'note');
      body = `
        <div class="tmt-sec">Next</div>${all.filter((x) => x.c !== 'note').map(tip).join('')}
        <div class="tmt-sec">Praetorians</div>${D.guards.map(bar).join('')}
        <div class="tmt-sec">Boss</div>${bar(D.maol)}
        ${notes.length ? `<div class="tmt-sec">Tips</div>${notes.map(tip).join('')}` : ''}
        <div class="tmt-foot">
          <span>You: ${esc(D.me.where || D.me.desc)} · ${METHOD_NAME[method]}${p.book ? ' + book' : ''}</span>
          <a href="#" data-act="biz" class="${UI.biz ? 'on' : ''}">${UI.biz ? 'Using business ticket' : 'Have business ticket?'}</a>
        </div>
        <div class="tmt-foot"><span>${err ? `⚠ ${esc(err)} · data from ${hm(D.t)}` : `Updated ${hm(D.t)} · times in ${tzLabel()}`}</span>
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
      // Phones: full width under the header, so rows don't wrap.
      const narrow = window.innerWidth < 500;
      root.style.width = narrow ? `${window.innerWidth - 20}px` : '';
      root.style.left = narrow ? '10px' : `${Math.round(Math.max(10, Math.min(b.right - 300, window.innerWidth - 310)))}px`;
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
  function matchNeighbour(inRow) {
    const ref = document.querySelector('ul.toolbar > li.find-extend') ||
      [...document.querySelectorAll('ul.toolbar > li')].find((li) => li !== btnHost && li.querySelector(':scope > button.top_header_button'));
    const refBtn = ref?.querySelector(':scope > button.top_header_button');
    if (!ref || !refBtn) return;
    const copy = (from, to, keys) => { const cs = getComputedStyle(from); keys.forEach((k) => { to.style[k] = cs[k]; }); };
    const btn = btnHost.querySelector('button');
    if (!inRow) {
      copy(ref, btnHost, BOX);
      btnHost.style.position = 'relative';
      copy(refBtn, btn, [...BOX, 'background', 'border', 'cursor', 'color', 'fill', 'opacity']);
    }
    const refSvg = refBtn.querySelector('svg');
    const svg = btn.querySelector('svg');
    if (refSvg && svg) {
      const r = refSvg.getBoundingClientRect();
      if (r.width && !inRow) { svg.setAttribute('width', Math.round(r.width)); svg.setAttribute('height', Math.round(r.height)); }
      const cs = getComputedStyle(refSvg);
      svg.style.fill = cs.fill;
      svg.style.filter = cs.filter;
      svg.style.verticalAlign = cs.verticalAlign;
      svg.style.display = cs.display;
    }
  }

  // Desktop: Torn's search row (form#searchForm, two floated boxes) is its own box, positioned
  // independently of the toolbar items, so the button goes INSIDE that row, after the "User"
  // box, and both boxes give up half its width. The row keeps Torn's exact size and spot.
  // Phone: the row is a single magnifier button, so the button is a toolbar item left of it.
  const ROW_W = 34;
  function searchRow(find) {
    const form = find.querySelector('form#searchForm');
    if (!form || form.getBoundingClientRect().width < 80) return null;
    const boxes = [form.querySelector(':scope > [class*="searchWrapper"]'), form.querySelector(':scope > #search-type-wrapper')];
    return boxes.every(Boolean) ? { form, boxes } : null;
  }
  function place() {
    const find = document.querySelector('ul.toolbar > li.find-wrapper');
    if (!find || !btnHost) return;
    restoreRoom();
    const row = searchRow(find);
    if (row) {
      if (btnHost.parentNode !== row.form) {
        btnHost.removeAttribute('style');
        btnHost.querySelector('button').removeAttribute('style');
        row.form.appendChild(btnHost);
      }
      btnHost.classList.add('tmt-inrow');
      makeRoom(row);
      matchNeighbour(true);
    } else {
      btnHost.classList.remove('tmt-inrow');
      if (btnHost.nextElementSibling !== find) find.parentNode.insertBefore(btnHost, find);
      matchNeighbour(false);
    }
  }

  let shrunk = [];
  function setImp(el, prop, val) {
    shrunk.push({ el, prop, val: el.style.getPropertyValue(prop), pri: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, val, 'important');
  }
  function restoreRoom() {
    shrunk.reverse().forEach(({ el, prop, val, pri }) => { if (val) el.style.setProperty(prop, val, pri); else el.style.removeProperty(prop); });
    shrunk = [];
  }
  function makeRoom({ boxes }) {
    const h = Math.round(boxes[1].getBoundingClientRect().height) || 24;
    btnHost.style.height = `${h}px`;
    const each = ROW_W / boxes.length;
    boxes.forEach((el) => {
      const w = Math.round(el.getBoundingClientRect().width - each);
      setImp(el, 'box-sizing', 'border-box');
      setImp(el, 'width', `${w}px`);
      setImp(el, 'max-width', `${w}px`);
      setImp(el, 'min-width', '0');
      // Inner parts with their own fixed width (the input, the "User" toggler) follow the box.
      el.querySelectorAll('*').forEach((d) => {
        if (d.getBoundingClientRect().width > w) { setImp(d, 'max-width', '100%'); setImp(d, 'box-sizing', 'border-box'); }
      });
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
      .tmt-host.tmt-inrow { float: left; display: flex; align-items: center; justify-content: center; width: 34px; margin: 0; padding: 0; list-style: none; }
      .tmt-host.tmt-inrow button { display: flex; align-items: center; justify-content: center; width: 34px; height: 100%; margin: 0; padding: 0; border: 0; background: none; cursor: pointer; }
      .tmt-host.tmt-inrow svg { width: 22px; height: 22px; }
      .tmt-host.tmt-inrow .tmt-dot { top: 0; right: 3px; }
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
      #tmt .tmt-tip { display: block; margin: 3px 10px; padding: 5px 8px; border-radius: 4px; line-height: 1.35;
        background: var(--default-bg-panel-active-color, #444); border-left: 3px solid #888; color: var(--default-color, #ddd); }
      #tmt .tmt-tip.go { border-left-color: var(--default-green-color, #82c91e); }
      #tmt .tmt-tip.warn { border-left-color: var(--default-orange-color, #f08c00); }
      #tmt .tmt-tip.note { background: none; border-left-color: var(--panel-border-bottom-color, #555); color: var(--default-content-title-color, #aaa); padding: 3px 8px; }
      #tmt .tmt-tip.route { padding: 6px 8px 4px; }
      #tmt .tmt-rt { font-weight: bold; margin-bottom: 4px; }
      #tmt .tmt-rt small { font-weight: normal; color: var(--default-content-title-color, #999); font-size: 10px; margin-left: 4px; }
      #tmt .tmt-stop { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto 30px; gap: 6px; align-items: baseline; padding: 1px 0; }
      #tmt .tmt-stop span { color: var(--default-content-title-color, #999); font-variant-numeric: tabular-nums; }
      #tmt .tmt-stop b { font-weight: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #tmt .tmt-stop em { font-style: normal; color: var(--default-content-title-color, #999); font-size: 11px; }
      #tmt .tmt-stop i { font-style: normal; font-size: 10px; text-align: right; color: var(--default-green-color, #82c91e); }
      #tmt .tmt-stop.now b { font-weight: bold; }
      #tmt a.tmt-tip:hover { background: var(--default-bg-panel-hover-color, #555); }
      #tmt .tmt-row { display: grid; grid-template-columns: minmax(0, 1fr) 112px; align-items: center; gap: 2px 8px; padding: 5px 10px; color: inherit;
        border-bottom: 1px solid var(--panel-border-bottom-color, #3b3b3b); }
      #tmt .tmt-row:hover { background: var(--default-bg-panel-active-color, #444); }
      #tmt .tmt-name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #tmt .tmt-where, #tmt .tmt-sub { color: var(--default-content-title-color, #999); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
      #tmt .tmt-hp { position: relative; height: 14px; background: #1a1a1a; border-radius: 3px; overflow: hidden; }
      #tmt .tmt-hp i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(180deg, #8bc34a, #5a8a1e); }
      #tmt .tmt-hp b { position: relative; display: block; text-align: center; font-size: 10px; line-height: 14px; color: #fff; text-shadow: 0 0 2px #000; }
      #tmt .tmt-dead { opacity: .5; }
      #tmt .tmt-foot { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; padding: 6px 10px 0; font-size: 11px; color: var(--default-content-title-color, #999); }
      #tmt .tmt-foot > :last-child { white-space: nowrap; }
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
    window.addEventListener('resize', () => { place(); if (UI.open) render(); });
    // Torn re-renders its header on some pages: put the button back when it goes missing.
    new MutationObserver(() => { if (!btnHost || !btnHost.isConnected) mountButton(); }).observe(document.body, { childList: true, subtree: true });
    mountButton();
    render();
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 5 * 1000);
  }

  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
