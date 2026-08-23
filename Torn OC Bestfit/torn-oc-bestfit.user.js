// ==UserScript==
// @name         Torn OC Best-Fit Role Recommender
// @namespace    Torn.OC-Best-Fit
// @version      1.1.0
// @description  Recommends the best Organized Crime role to join, ranking all available faction OCs by a blended success score (your exact API CPR discounted by your faction's real historical success rate). Color-coded green/yellow/red.
// @author       KamiRen [2805199]
// @match        https://www.torn.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      mmoaqgkhfxmbgvirsgxw.supabase.co
// @connect      tornprobability.com
// @license      MIT
// @run-at       document-idle
// @downloadURL none
// ==/UserScript==
(function() {
  "use strict";
  const GM_PFX = "ocbf_gm_";
  (function shimGM() {
    const G = typeof window !== "undefined" ? window : globalThis;
    const PFX = GM_PFX;
    if (typeof GM_getValue === "undefined") {
      G.GM_getValue = (key, def) => {
        try {
          const v = localStorage.getItem(PFX + key);
          return v === null ? def : JSON.parse(v)
        } catch (e) {
          return def
        }
      }
    }
    if (typeof GM_setValue === "undefined") {
      G.GM_setValue = (key, val) => {
        try {
          localStorage.setItem(PFX + key, JSON.stringify(val))
        } catch (e) {}
      }
    }
    if (typeof GM_deleteValue === "undefined") {
      G.GM_deleteValue = key => {
        try {
          localStorage.removeItem(PFX + key)
        } catch (e) {}
      }
    }
  })();
  const API = "https://api.torn.com/v2";
  const IS_PDA = typeof window.PDA_httpGet === "function" || /TornPDA/i.test(navigator.userAgent || "");
  const SUPA_URL = "https://mmoaqgkhfxmbgvirsgxw.supabase.co";
  const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tb2FxZ2toZnhtYmd2aXJzZ3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTkzODQsImV4cCI6MjA5NjQzNTM4NH0.axLRQuuDx3uHHR6kK4hZugPPllBz2gawxINOA7yPPJM";
  const supaOn = () => !!SUPA_ANON;
  const KEY_STORE = "oc_bestfit_apikey";
  const SHARE_STORE = "oc_bestfit_share";
  const shareOn = () => GM_getValue(SHARE_STORE, true);
  const REPLACE_CPR_STORE = "oc_bestfit_replacecpr";
  const replaceCprOn = () => GM_getValue(REPLACE_CPR_STORE, false);
  const ID_STORE = "oc_bestfit_identity";
  const SELF_STORE = "oc_bestfit_selfid";
  const FACACC_STORE = "oc_bestfit_facaccess";
  const factionAccess = () => GM_getValue(FACACC_STORE, true);
  const SCORE_CACHE = "oc_bestfit_scorecache";
  const POS_STORE = "oc_bestfit_panelpos";
  const VERSION = typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version || "1.1.0";
  const META_STORE = "oc_bestfit_meta";
  const DATAVER_STORE = "oc_bestfit_dataver";
  const DATA_VERSION = 4;
  const IDB_DB = "oc_bestfit";
  const IDB_STORE = "crimes";
  const IDB_LOG = "cprlog";
  const LOG_META = "oc_bestfit_logmeta";
  const STATKEY_STORE = "oc_bestfit_statkey";
  const LOG_INTERVAL_MS = 3 * 60 * 60 * 1e3;
  const HIST_TTL_MS = 2 * 60 * 60 * 1e3;
  const HIST_RETRY_MS = 5 * 60 * 1e3;
  const HIST_PAGE_CAP = 60;
  const GREEN = 70;
  const YELLOW = 50;
  const DIRECTIONS = {
    higher: "Higher OC first",
    success: "Highest success",
    evmoney: "Expected money",
    evrespect: "Expected respect",
    impact: "Most impact",
    raw: "Raw CPR"
  };
  const OCScore = function() {
    const CFG = {
      BASE: 1e3,
      MIN: 0,
      MAX: 2e3,
      W_WIN: 10,
      W_FAIL: -15,
      W_OFFENCE: -25,
      W_GOODCRIT: 15,
      W_FOLLOW: 20,
      W_ALIGN: 15,
      HALF_LIFE_DAYS: 30,
      HIGH_WEIGHT: 20,
      TILT: 15,
      SCALE_HI: 1.5,
      SCALE_LO: .5,
      REQ: {
        1: 70,
        2: 70,
        3: 70,
        4: 75,
        5: 75,
        6: 75,
        7: 70,
        8: 60,
        9: 50,
        10: 0
      },
      FLAG_BELOW: 900,
      SCORE_PER_DIFF: 20
    };
    const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const mc = c => Object.assign({}, CFG, c || {});
    const decay = (ageDays, hl) => Math.pow(.5, Math.max(0, ageDays) / hl);
    const PRESET_LEAN = {
      evmoney: -1,
      evrespect: 1,
      impact: 1,
      success: 0,
      higher: 0,
      raw: 0
    };

    function compute(records, weights, recs, nowSec, cfg) {
      cfg = mc(cfg);
      const W = weights || {},
        R = recs || {},
        by = {};

      function ev(uid, field, weight, ts, meta) {
        const u = by[uid] || (by[uid] = {
          user_id: +uid,
          wins: 0,
          fails: 0,
          offences: 0,
          good: 0,
          follows: 0,
          align: 0,
          raw: 0,
          contrib: {
            wins: 0,
            fails: 0,
            offences: 0,
            good: 0,
            follows: 0,
            align: 0
          },
          events: []
        });
        u[field]++;
        const d = weight * decay((nowSec - ts) / 86400, cfg.HALF_LIFE_DAYS);
        u.raw += d;
        u.contrib[field] += d;
        u.events.push({
          type: field,
          ts: ts,
          weight: weight,
          value: d,
          name: meta && meta.name,
          position: meta && meta.position
        })
      }
      for (const c of records || []) {
        const ow = W[norm(c.name)] || null;
        const maxW = ow ? Math.max.apply(null, Object.values(ow)) : null;
        const ts = c.executed_at || nowSec;
        const ds = diffScale(c.difficulty, cfg);
        for (const s of c.slots || []) {
          if (!s.user_id) continue;
          const meta = {
            name: c.name,
            position: s.position
          };
          if (c.status === "Successful") ev(s.user_id, "wins", cfg.W_WIN * ds, ts, meta);
          else if (c.status === "Failure") ev(s.user_id, "fails", cfg.W_FAIL * ds, ts, meta);
          const w = ow ? ow[norm(s.position)] : null;
          if (w != null && w >= cfg.HIGH_WEIGHT && s.cpr != null) {
            const req = roleMin(c.difficulty, w, maxW, cfg);
            ev(s.user_id, s.cpr < req ? "offences" : "good", (s.cpr < req ? cfg.W_OFFENCE : cfg.W_GOODCRIT) * ds, ts, meta)
          }
          const rm = R[s.user_id];
          const key = norm(c.name) + "|" + norm(s.position);
          let followed = false,
            dir = null;
          if (rm) {
            if (typeof rm.has === "function") followed = rm.has(key);
            else if (key in rm) {
              followed = true;
              dir = rm[key]
            }
          }
          if (followed) {
            ev(s.user_id, "follows", cfg.W_FOLLOW * ds, ts, meta);
            const lean = PRESET_LEAN[dir] || 0;
            if (lean) ev(s.user_id, "align", lean * cfg.W_ALIGN * ds, ts, meta)
          }
        }
      }
      const byUser = {};
      for (const uid in by) {
        const u = by[uid];
        const score = Math.max(cfg.MIN, Math.min(cfg.MAX, Math.round(cfg.BASE + u.raw)));
        byUser[uid] = {
          user_id: u.user_id,
          wins: u.wins,
          fails: u.fails,
          offences: u.offences,
          good: u.good,
          follows: u.follows,
          align: u.align,
          contrib: u.contrib,
          events: u.events.slice().sort((a, b) => b.ts - a.ts).slice(0, 12),
          score: score,
          flagged: score < cfg.FLAG_BELOW,
          hasData: true
        }
      }
      return {
        byUser: byUser,
        cfg: cfg
      }
    }
    const playerScore = (byUser, id, cfg) => byUser[id] || {
      user_id: +id,
      wins: 0,
      fails: 0,
      offences: 0,
      good: 0,
      follows: 0,
      score: (cfg || CFG).BASE,
      flagged: false,
      hasData: false
    };

    function recAdjust(metric, slot, viewerScore, cfg) {
      cfg = mc(cfg);
      const f = (viewerScore || cfg.BASE) / cfg.BASE,
        diff = slot && slot.difficulty || 5;
      const mult = f >= 1 ? 1 + (f - 1) * (.2 + .5 * diff / 10) : Math.max(.4, 1 - (1 - f) * (diff / 10));
      return (metric || 0) * mult
    }

    function roleMinFromBase(base, weight, maxWeight, cfg) {
      cfg = mc(cfg);
      if (weight == null || !maxWeight) return base;
      const rNorm = Math.max(0, Math.min(1, weight / maxWeight));
      return Math.max(0, Math.min(90, Math.round(base + cfg.TILT * (rNorm - .5) * 2)))
    }

    function roleMin(difficulty, weight, maxWeight, cfg) {
      cfg = mc(cfg);
      const base = cfg.REQ[difficulty] != null ? cfg.REQ[difficulty] : 60;
      return roleMinFromBase(base, weight, maxWeight, cfg)
    }

    function diffScale(difficulty, cfg) {
      cfg = mc(cfg);
      const d = Math.max(1, Math.min(10, difficulty || 5));
      return cfg.SCALE_LO + (cfg.SCALE_HI - cfg.SCALE_LO) * (10 - d) / 9
    }

    function scoreReq(difficulty, cfg) {
      cfg = mc(cfg);
      const d = Math.max(1, Math.min(10, difficulty || 5));
      return Math.round(cfg.BASE - (10 - d) * cfg.SCORE_PER_DIFF)
    }

    function scoreDelta(difficulty, isCritical, qualified, recommended, cfg, presetLean) {
      cfg = mc(cfg);
      const ds = diffScale(difficulty, cfg);
      const crit = isCritical ? qualified ? cfg.W_GOODCRIT : cfg.W_OFFENCE : 0;
      const followAlign = recommended ? cfg.W_FOLLOW + (presetLean || 0) * cfg.W_ALIGN : 0;
      return {
        success: Math.round((cfg.W_WIN + crit + followAlign) * ds),
        fail: Math.round((cfg.W_FAIL + crit + followAlign) * ds)
      }
    }

    function scoreSeries(records, weights, recs, cfg, points, userId) {
      cfg = mc(cfg);
      const all = records || [];
      return (points || []).map(t => {
        const upto = all.filter(c => (c.executed_at || 0) <= t);
        const p = compute(upto, weights, recs, t, cfg).byUser[userId];
        return {
          t: t,
          score: p ? p.score : cfg.BASE
        }
      })
    }
    return {
      CFG: CFG,
      PRESET_LEAN: PRESET_LEAN,
      norm: norm,
      decay: decay,
      compute: compute,
      playerScore: playerScore,
      recAdjust: recAdjust,
      roleMin: roleMin,
      roleMinFromBase: roleMinFromBase,
      scoreReq: scoreReq,
      diffScale: diffScale,
      scoreDelta: scoreDelta,
      scoreSeries: scoreSeries
    }
  }();
  window.__ocbfRoleMin = OCScore.roleMinFromBase;
  window.__ocbfScoreReq = OCScore.scoreReq;
  window.__ocbfSelfScore = null;
  window.__ocbfHasKey = () => !!getKey();
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) n.append(k);
    return n
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n
  };
  const fmtMoney = v => v == null || v === 0 ? "-" : "$" + Intl.NumberFormat("en").format(v);
  const median = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
  };
  const blendedColor = score => score >= GREEN ? "green" : score >= YELLOW ? "yellow" : "red";
  const COLORS = {
    green: "#3fb950",
    yellow: "#d4a017",
    red: "#e5534b"
  };
  const onPhone = () => IS_PDA || (window.innerWidth || 9999) <= 768;

  function closeDetail() {
    const p = document.getElementById("ocbf-pop");
    if (p) p.remove()
  }

  function openDetail(content, ev) {
    closeDetail();
    const pop = el("div", {
      id: "ocbf-pop"
    });
    if (content instanceof Node) pop.append(content);
    else {
      pop.textContent = content;
      pop.style.whiteSpace = "pre-line"
    }
    pop.style.cssText += `position:fixed;z-index:100001;background:${T.bg};color:${T.text};border:1px solid ${T.border};border-radius:8px;padding:12px;font-size:13px;line-height:1.55;box-shadow:0 10px 34px rgba(0,0,0,.6)`;
    pop.addEventListener("click", e => e.stopPropagation());
    document.body.append(pop);
    if (onPhone()) {
      pop.style.left = "8px";
      pop.style.right = "8px";
      pop.style.bottom = "8px"
    } else {
      pop.style.maxWidth = "320px";
      const x = ev ? ev.clientX : 120,
        y = ev ? ev.clientY : 120;
      pop.style.left = Math.max(8, Math.min(x, window.innerWidth - 332)) + "px";
      pop.style.top = Math.max(8, Math.min(y + 12, window.innerHeight - pop.offsetHeight - 12)) + "px"
    }
    setTimeout(() => document.addEventListener("click", closeDetail, {
      once: true
    }), 0)
  }

  function scoreSparkline(series, flagBelow) {
    const W = 260,
      H = 70,
      pad = 6;
    const ys = series.map(p => p.score);
    const lo = Math.min(flagBelow, ...ys) - 20,
      hi = Math.max(flagBelow, ...ys) + 20;
    const sx = i => pad + (series.length < 2 ? 0 : i * (W - 2 * pad) / (series.length - 1));
    const sy = v => H - pad - (v - lo) * (H - 2 * pad) / (hi - lo);
    const pts = series.map((p, i) => `${sx(i).toFixed(1)},${sy(p.score).toFixed(1)}`).join(" ");
    const fy = sy(flagBelow).toFixed(1);
    const ns = SVGNS;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.display = "block";
    svg.innerHTML = `<line x1="${pad}" y1="${fy}" x2="${W-pad}" y2="${fy}" stroke="${COLORS.red}" stroke-dasharray="3 3" stroke-width="1" opacity=".7"/>` + `<polyline fill="none" stroke="#58a6ff" stroke-width="2" points="${pts}"/>` + (series.length ? `<circle cx="${sx(series.length-1)}" cy="${sy(ys[ys.length-1])}" r="2.5" fill="#58a6ff"/>` : "");
    return svg
  }

  function buildScoreContent(userId, name) {
    const cfg = effCfg();
    const p = OCScore.playerScore(state.scores || {}, userId, cfg);
    const node = el("div", {});
    node.append(el("div", {
      style: "font-weight:700;margin-bottom:6px",
      textContent: `${name||userId} - score ${p.score}${p.flagged?" (low)":""}`
    }));
    const nowS = Math.floor(Date.now() / 1e3);
    const ago = ts => {
      const d = Math.max(0, Math.round((nowS - ts) / 86400));
      return d === 0 ? "today" : d + "d ago"
    };
    const byType = {};
    for (const e of p.events || [])(byType[e.type] || (byType[e.type] = [])).push(e);
    const c = p.contrib || {
      wins: 0,
      fails: 0,
      offences: 0,
      good: 0,
      follows: 0,
      align: 0
    };
    const rows = [
      ["base", cfg.BASE, null],
      ["wins", c.wins, "wins"],
      ["fails", c.fails, "fails"],
      ["critical pass", c.good, "good"],
      ["critical miss", c.offences, "offences"],
      ["followed rec", c.follows, "follows"],
      ["faction align", c.align, "align"]
    ];
    const tbl = el("div", {
      style: "font-size:12px;line-height:1.6;margin-bottom:8px"
    });
    for (const [lab, val, field] of rows) {
      const v = Math.round(val);
      const col = lab === "base" ? T.text : v > 0 ? COLORS.green : v < 0 ? COLORS.red : T.sub;
      const chev = el("span", {
        className: "ocbf-chev",
        textContent: ">",
        style: `display:inline-block;width:9px;font-size:9px;color:${T.sub}`
      });
      const head = el("div", {
        style: "display:flex;justify-content:space-between;gap:16px;cursor:pointer;align-items:center;padding:1px 0"
      }, el("span", {
        style: `display:flex;align-items:center;gap:6px;color:${T.sub}`
      }, chev, el("span", {
        textContent: lab
      })), el("span", {
        style: `color:${col};font-variant-numeric:tabular-nums`,
        textContent: (v > 0 && lab !== "base" ? "+" : "") + v
      }));
      const bodyEl = el("div", {
        className: "ocbf-sc-body",
        style: "display:none;margin:1px 0 5px 15px;font-size:11px;line-height:1.5"
      });
      if (field) {
        const list = byType[field] || [];
        if (!list.length) bodyEl.append(el("div", {
          style: `color:${T.sub}`,
          textContent: "No events of this type yet."
        }));
        else
          for (const e of list) {
            const ev = Math.round(e.value);
            bodyEl.append(el("div", {
              style: "display:flex;justify-content:space-between;gap:12px"
            }, el("span", {
              style: `color:${T.sub}`,
              textContent: `${e.name||"?"} - ${e.position||"?"}`
            }), el("span", {
              style: `color:${ev>0?COLORS.green:ev<0?COLORS.red:T.sub};font-variant-numeric:tabular-nums;white-space:nowrap`,
              textContent: `${ev>0?"+":""}${ev} - ${ago(e.ts)}`
            })))
          }
      } else bodyEl.append(el("div", {
        style: `color:${T.sub}`,
        textContent: `Everyone starts at ${cfg.BASE}.`
      }));
      head.addEventListener("click", () => {
        const willOpen = bodyEl.style.display === "none";
        tbl.querySelectorAll(".ocbf-sc-body").forEach(b => b.style.display = "none");
        tbl.querySelectorAll(".ocbf-chev").forEach(ch => ch.textContent = ">");
        if (willOpen) {
          bodyEl.style.display = "block";
          chev.textContent = "v"
        }
      });
      tbl.append(head, bodyEl)
    }
    node.append(tbl);
    const inp = state.scoreInputs;
    if (inp && (p.events || []).length) {
      const now = Math.floor(Date.now() / 1e3);
      const first = Math.min(...p.events.map(e => e.ts));
      const span = Math.max(1, now - first);
      const N = 10,
        points = [];
      for (let i = 0; i < N; i++) points.push(Math.round(first + span * i / (N - 1)));
      const series = OCScore.scoreSeries(inp.records, inp.weights, inp.recs, cfg, points, userId);
      node.append(el("div", {
        style: `font-size:11px;color:${T.sub};margin-bottom:2px`,
        textContent: "Score over time"
      }));
      node.append(scoreSparkline(series, cfg.FLAG_BELOW))
    } else {
      node.append(el("div", {
        style: `font-size:11px;color:${T.sub}`,
        textContent: "No history yet."
      }))
    }
    return node
  }

  function httpRequest({
    method: method = "GET",
    url: url,
    headers: headers = {},
    data: data = null,
    timeout: timeout = 3e4
  }) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: method,
          url: url,
          headers: headers,
          data: data,
          timeout: timeout,
          onload: r => resolve({
            status: r.status,
            text: r.responseText
          }),
          onerror: () => reject(new Error("Network error")),
          ontimeout: () => reject(new Error("Request timed out"))
        });
        return
      }
      const fn = method === "POST" ? window.PDA_httpPost : window.PDA_httpGet;
      if (typeof fn !== "function") {
        reject(new Error("No HTTP transport available"));
        return
      }
      const args = method === "POST" ? [url, headers, data] : [url, headers];
      Promise.resolve(fn.apply(window, args)).then(r => {
        const text = r && (r.responseText || r.body || r.text) || (typeof r === "string" ? r : "");
        const status = r && (r.status || r.statusCode) || 200;
        resolve({
          status: status,
          text: text
        })
      }).catch(e => reject(new Error("PDA HTTP failed: " + (e && e.message || e))))
    })
  }
  async function gmGet(url) {
    const r = await httpRequest({
      method: "GET",
      url: url,
      headers: {
        Accept: "application/json"
      }
    });
    if (r.status && (r.status < 200 || r.status >= 300)) throw new Error(`HTTP ${r.status}`);
    let j;
    try {
      j = JSON.parse(r.text)
    } catch (e) {
      throw new Error("Bad JSON from Torn API")
    }
    if (j && j.error) throw new Error(`Torn API ${j.error.code||"?"}: ${j.error.error||j.error}`);
    return j
  }
  async function supaFn(payload) {
    const r = await httpRequest({
      method: "POST",
      url: `${SUPA_URL}/functions/v1/oc-gateway`,
      headers: {
        apikey: SUPA_ANON,
        Authorization: `Bearer ${SUPA_ANON}`,
        "Content-Type": "application/json"
      },
      data: JSON.stringify(payload)
    });
    let j = null;
    try {
      j = r.text ? JSON.parse(r.text) : null
    } catch (e) {}
    if (r.status >= 200 && r.status < 300) return j || {};
    throw new Error(j && j.error || `Gateway ${r.status}: ${(r.text||"").slice(0,160)}`)
  }

  const STATIC_URL = SUPA_URL + "/storage/v1/object/public/static/oc-static.json";
  const STATIC_STORE = "oc_bestfit_static";
  const KNOWN_KEYS = [KEY_STORE, SHARE_STORE, REPLACE_CPR_STORE, ID_STORE, SELF_STORE, FACACC_STORE, SCORE_CACHE, POS_STORE, META_STORE, DATAVER_STORE, LOG_META, STATKEY_STORE, STATIC_STORE];

  function healState() {
    const now = Date.now();
    let fixed = 0;
    try {
      const m = GM_getValue(META_STORE, null);
      if (m && typeof m === "object") {
        const ls = +m.lastSync || 0,
          lf = +m.lastFail || 0;
        const skewed = t => t > now + 6e4 || t < 0;
        if (skewed(ls) || skewed(lf)) {
          GM_setValue(META_STORE, {
            lastSync: skewed(ls) ? 0 : ls,
            lastFail: 0
          });
          fixed++
        }
      }
    } catch (e) {}
    try {
      const keep = new Set((KNOWN_KEYS || []).map(k => GM_PFX + k));
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(GM_PFX) !== 0) continue;
        if (!keep.has(k)) {
          drop.push(k);
          continue
        }
        try {
          JSON.parse(localStorage.getItem(k))
        } catch (e) {
          drop.push(k)
        }
      }
      for (const k of drop) {
        try {
          localStorage.removeItem(k);
          fixed++
        } catch (e) {}
      }
    } catch (e) {}
    return fixed
  }
  let ocStatic = null;
  let staticP = null;
  let staticDone = false;
  function loadStatic(force) {
    if (staticP && !force) return staticP;
    staticP = (async () => {
      if (!ocStatic) {
        try {
          const cached = GM_getValue(STATIC_STORE, null);
          if (cached && cached.data) {
            ocStatic = cached.data;
            window.__ocbfStatic = cached.data
          }
        } catch (e) {}
      }
      try {
        const r = await httpRequest({
          method: "GET",
          url: STATIC_URL + "?t=" + Date.now(),
          headers: {
            Accept: "application/json"
          }
        });
        const j = JSON.parse(r.text);
        if (j && j.ocItems) {
          ocStatic = j;
          window.__ocbfStatic = j;
          try {
            GM_setValue(STATIC_STORE, {
              ts: Date.now(),
              data: j
            })
          } catch (e) {}
        }
      } catch (e) {}
      staticDone = true;
      return ocStatic
    })();
    return staticP
  }
  function getKey() {
    return GM_getValue(KEY_STORE, "")
  }

  function storeKey(v) {
    GM_setValue(KEY_STORE, String(v || "").trim());
    GM_deleteValue(META_STORE);
    GM_deleteValue(ID_STORE);
    GM_deleteValue(SELF_STORE);
    GM_deleteValue(FACACC_STORE);
    idbWipe()
  }

  function clearKey() {
    GM_deleteValue(KEY_STORE);
    GM_deleteValue(META_STORE);
    GM_deleteValue(ID_STORE);
    GM_deleteValue(SELF_STORE);
    GM_deleteValue(FACACC_STORE);
    idbWipe();
    state.hist = null;
    state.scores = null;
    state.community = null;
    state.weights = null;
    teardownInjections()
  }

  function teardownInjections() {
    document.querySelectorAll(".ocbf-left,.ocbf-stake,.ocbf-cprhdr,.ocbf-badge,.ocbf-crime-success,.oc-weight-box").forEach(n => n.remove());
    document.querySelectorAll('[class*="successChance___"]').forEach(e => {
      e.style.display = ""
    });
    document.querySelectorAll('[class*="wrapper___"]').forEach(w => {
      if (w.dataset.ocbfTagged) {
        w.style.paddingTop = "";
        delete w.dataset.ocbfTagged
      }
    });
    document.querySelectorAll('button[class*="torn-btn"].torn-btn--disabled').forEach(b => {
      b.disabled = false;
      b.classList.remove("torn-btn--disabled")
    })
  }

  function renderKeyPrompt() {
    const b = $("#ocbf-body");
    if (!b) return;
    b.textContent = "";
    const wrap = el("div", {
      style: "padding:4px 2px"
    });
    wrap.append(el("div", {
      style: "font-size:14px;font-weight:700;margin-bottom:6px",
      textContent: getKey() ? "Change your Torn API key" : "Set your Torn API key"
    }));
    wrap.append(el("div", {
      style: `font-size:12px;color:${T.sub};line-height:1.5;margin-bottom:10px`,
      textContent: "Needs a Limited access Torn API key. Stored only in your browser - it transits the gateway once to verify you, then is discarded. Nothing works until this is set."
    }));
    const input = el("input", {
      type: "text",
      value: getKey(),
      placeholder: "paste API key",
      spellcheck: false,
      autocomplete: "off",
      style: "width:100%;box-sizing:border-box;background:var(--ocbf-ctl-bg);color:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.5);border-radius:6px;padding:9px;font-size:14px;font-family:monospace"
    });
    const msg = el("div", {
      style: "font-size:11px;min-height:14px;margin-top:4px"
    });
    const row = el("div", {
      style: "display:flex;gap:8px;align-items:center;margin-top:8px"
    });
    const save = el("button", {
      className: "ocbf-ctl",
      textContent: "Save key",
      style: "font-weight:700"
    });
    const link = el("a", {
      href: "https://www.torn.com/preferences.php#tab=api",
      target: "_blank",
      textContent: "get a key",
      style: "color:#58a6ff;font-size:12px;margin-left:auto"
    });
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        msg.textContent = "Paste your key first.";
        msg.style.color = COLORS.red;
        return
      }
      storeKey(v);
      msg.textContent = "Saved - loading...";
      msg.style.color = COLORS.green;
      load(true)
    };
    save.addEventListener("click", submit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") submit()
    });
    row.append(save, link);
    wrap.append(input, row, msg);
    b.append(wrap);
    updateTabLabel();
    setTimeout(() => input.focus(), 0)
  }
  async function fetchOpenSlots(key) {
    const j = await gmGet(`${API}/user/organizedcrimes?key=${encodeURIComponent(key)}`);
    const out = [];
    for (const oc of j.organizedcrimes || []) {
      for (const s of oc.slots || []) {
        if (s.user) continue;
        out.push({
          crimeId: oc.id,
          name: oc.name,
          difficulty: oc.difficulty,
          position: s.position_info?.label || s.position,
          cpr: s.checkpoint_pass_rate || 0,
          itemRequired: !!s.item_requirement,
          itemAvailable: s.item_requirement ? !!s.item_requirement.is_available : true
        })
      }
    }
    return out
  }
  let _statKeyP = null;

  function statKey() {
    if (_statKeyP) return _statKeyP;
    _statKeyP = (async () => {
      const b64 = GM_getValue(STATKEY_STORE, "");
      if (b64) {
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])
      }
      const k = await crypto.subtle.generateKey({
        name: "AES-GCM",
        length: 256
      }, true, ["encrypt", "decrypt"]);
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", k));
      GM_setValue(STATKEY_STORE, btoa(String.fromCharCode.apply(null, raw)));
      return k
    })();
    return _statKeyP
  }
  async function encStats(obj) {
    try {
      const k = await statKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = (new TextEncoder).encode(JSON.stringify(obj));
      const ct = new Uint8Array(await crypto.subtle.encrypt({
        name: "AES-GCM",
        iv: iv
      }, k, data));
      return {
        iv: btoa(String.fromCharCode.apply(null, iv)),
        ct: btoa(String.fromCharCode.apply(null, ct))
      }
    } catch (e) {
      console.warn("ocbfstat encrypt failed (stats omitted):", e.message);
      return null
    }
  }
  async function decStats(enc) {
    try {
      if (!enc || !enc.iv || !enc.ct) return null;
      const k = await statKey();
      const iv = Uint8Array.from(atob(enc.iv), c => c.charCodeAt(0));
      const ct = Uint8Array.from(atob(enc.ct), c => c.charCodeAt(0));
      const pt = await crypto.subtle.decrypt({
        name: "AES-GCM",
        iv: iv
      }, k, ct);
      return JSON.parse((new TextDecoder).decode(pt))
    } catch (e) {
      console.warn("ocbfstat decrypt failed:", e.message);
      return null
    }
  }
  async function logSnapshot(key, slots, force) {
    const meta = GM_getValue(LOG_META, {
      last: 0,
      sig: ""
    });
    if (!force && Date.now() - (meta.last || 0) < LOG_INTERVAL_MS) return;
    const cprs = (slots || []).map(s => ({
      name: s.name,
      difficulty: s.difficulty,
      position: s.position,
      cpr: s.cpr
    }));
    if (!cprs.length) return;
    const sig = JSON.stringify(cprs.map(c => `${normKey(c.name)}|${normKey(c.position)}|${c.cpr}`).sort());
    if (sig === meta.sig) {
      GM_setValue(LOG_META, {
        last: Date.now(),
        sig: sig
      });
      return
    }
    let stats = {};
    try {
      const bs = await gmGet(`${API}/user/battlestats?key=${encodeURIComponent(key)}`);
      stats = bs.battlestats || {}
    } catch (e) {
      console.warn("ocbfbattlestats unavailable (snapshot continues):", e.message)
    }
    const statsEnc = await encStats({
      strength: stats.strength || 0,
      defense: stats.defense || 0,
      speed: stats.speed || 0,
      dexterity: stats.dexterity || 0,
      total: stats.total || 0
    });
    const snap = {
      ts: Date.now(),
      statsEnc: statsEnc,
      cprs: cprs
    };
    try {
      const db = await idbOpen();
      await idbLogAdd(db, snap);
      GM_setValue(LOG_META, {
        last: snap.ts,
        sig: sig
      })
    } catch (e) {
      console.warn("ocbfsnapshot store failed:", e.message)
    }
    if (supaOn() && shareOn()) {
      try {
        await supaFn({
          action: "push",
          key: key,
          snapshot: {
            ts: snap.ts,
            cprs: snap.cprs
          }
        })
      } catch (e) {
        console.warn("ocbfgateway snapshot push:", e.message)
      }
    }
  }

  function idbOpen(rebuilt) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(IDB_DB, 2)
      } catch (e) {
        reject(new Error("IndexedDB unavailable"));
        return
      }
      let settled = false;
      const timer = setTimeout(() => recover(), 8e3);
      const done = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(v)
      };

      function recover() {
        if (settled) return;
        if (rebuilt) {
          done(reject, new Error("IndexedDB open failed"));
          return
        }
        settled = true;
        clearTimeout(timer);
        let del;
        try {
          del = indexedDB.deleteDatabase(IDB_DB)
        } catch (e) {
          reject(new Error("IndexedDB open failed"));
          return
        }
        del.onsuccess = del.onerror = del.onblocked = () => idbOpen(true).then(resolve, reject)
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, {
          keyPath: "id"
        });
        if (!db.objectStoreNames.contains(IDB_LOG)) db.createObjectStore(IDB_LOG, {
          keyPath: "ts"
        })
      };
      req.onsuccess = () => done(resolve, req.result);
      req.onerror = req.onblocked = recover
    })
  }

  function idbLogAdd(db, rec) {
    return new Promise(resolve => {
      const r = db.transaction(IDB_LOG, "readwrite").objectStore(IDB_LOG).put(rec);
      r.onsuccess = () => resolve(true);
      r.onerror = () => resolve(false)
    })
  }

  function idbLogAll(db) {
    return new Promise(res => {
      const r = db.transaction(IDB_LOG, "readonly").objectStore(IDB_LOG).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([])
    })
  }
  const idbStore = (db, mode) => db.transaction(IDB_STORE, mode).objectStore(IDB_STORE);

  function idbCount(db) {
    return new Promise(res => {
      const r = idbStore(db, "readonly").count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(0)
    })
  }

  function idbPutAll(db, recs) {
    return new Promise((resolve, reject) => {
      if (!recs.length) return resolve(0);
      const tx = db.transaction(IDB_STORE, "readwrite");
      const st = tx.objectStore(IDB_STORE);
      for (const r of recs) st.put(r);
      tx.oncomplete = () => resolve(recs.length);
      tx.onerror = () => reject(new Error("IndexedDB write failed"))
    })
  }

  function idbGetAll(db) {
    return new Promise(res => {
      const r = idbStore(db, "readonly").getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([])
    })
  }

  function idbWipe() {
    return new Promise(res => {
      const r = indexedDB.deleteDatabase(IDB_DB);
      r.onsuccess = r.onerror = r.onblocked = () => res()
    })
  }

  function compactCrime(c) {
    const r = c.rewards || {};
    return {
      id: c.id,
      name: c.name,
      difficulty: c.difficulty,
      status: c.status,
      executed_at: c.executed_at || 0,
      money: r.money || 0,
      respect: r.respect || 0,
      scope: r.scope || 0,
      payout_pct: r.payout && r.payout.percentage || null,
      participants: (c.slots || []).length,
      slots: (c.slots || []).map(s => ({
        position: s.position_info?.label || s.position,
        user_id: s.user?.id || null,
        cpr: s.checkpoint_pass_rate || 0
      }))
    }
  }

  function pushCrimes(fresh, key) {
    if (!supaOn() || !key || !fresh.length) return;
    const shareable = fresh.map(c => ({
      ...c,
      slots: (c.slots || []).map(s => ({
        position: s.position,
        user_id: s.user_id
      }))
    }));
    supaFn({
      action: "push",
      key: key,
      crimes: shareable
    }).catch(e => console.warn("ocbfgateway push crimes:", e.message))
  }
  async function syncHistory(db, key, onProgress) {
    const firstRun = await idbCount(db) === 0;
    const meta = GM_getValue(META_STORE, {
      lastSync: 0
    });
    const stored = firstRun ? [] : await idbGetAll(db);
    const existing = firstRun ? null : new Set(stored.map(r => r.id));
    let newestStored = 0;
    for (const r of stored) if ((r.executed_at || 0) > newestStored) newestStored = r.executed_at;
    const cutoff = firstRun || !newestStored ? 0 : newestStored - 7 * 86400;
    const base = `${API}/faction/crimes?cat=completed&filters=executed_at&sort=DESC&limit=100&comment=OCBestFit`;
    let pages = 0,
      added = 0,
      offset = 0,
      pageError = null,
      done = false;
    while (!done && pages < HIST_PAGE_CAP) {
      let j;
      try {
        j = await gmGet(`${base}&offset=${offset}&key=${encodeURIComponent(key)}`)
      } catch (e) {
        pageError = e.message;
        break
      }
      const batch = j.crimes || [];
      if (!batch.length) break;
      const fresh = [];
      let known = 0,
        oldest = Infinity;
      for (const c of batch) {
        const ts = c.executed_at || 0;
        if (ts && ts < oldest) oldest = ts;
        if (existing && existing.has(c.id)) {
          known++;
          continue
        }
        fresh.push(compactCrime(c));
        if (existing) existing.add(c.id)
      }
      await idbPutAll(db, fresh);
      pushCrimes(fresh, key);
      added += fresh.length;
      pages++;
      offset += batch.length;
      if (onProgress) onProgress(pages, added);
      if (batch.length < 100) done = true;
      else if (known === batch.length && cutoff && oldest !== Infinity && oldest <= cutoff) done = true
    }
    return {
      pages: pages,
      added: added,
      pageError: pageError
    }
  }

  function aggregate(records) {
    const acc = {};
    for (const c of records) {
      const k = `${c.difficulty}|${c.name}`;
      const a = acc[k] || (acc[k] = {
        ok: 0,
        fail: 0,
        money: [],
        respect: [],
        pct: [],
        part: []
      });
      if (c.status === "Successful") {
        a.ok++;
        a.money.push(c.money || 0);
        a.respect.push(c.respect || 0)
      } else if (c.status === "Failure") a.fail++;
      if (c.payout_pct != null) a.pct.push(c.payout_pct);
      if (c.participants) a.part.push(c.participants)
    }
    const table = {};
    for (const [k, a] of Object.entries(acc)) {
      const n = a.ok + a.fail;
      const medMoney = median(a.money);
      const pct = a.pct.length ? median(a.pct) : null;
      const part = a.part.length ? median(a.part) : 0;
      const perPlayer = pct != null && part > 0 ? Math.round(medMoney * pct / 100 / part) : null;
      table[k] = {
        successRate: n ? a.ok / n : null,
        medMoney: medMoney,
        medRespect: median(a.respect),
        samples: n,
        payoutPct: pct,
        participants: part,
        perPlayerMoney: perPlayer
      }
    }
    return table
  }
  async function supaAggregate(key) {
    const res = await supaFn({
      action: "pull",
      key: key
    });
    const rows = res && res.rows || [];
    const table = {};
    for (const r of rows || []) {
      const ok = +r.ok || 0,
        fail = +r.fail || 0,
        n = ok + fail;
      const medMoney = +r.med_money || 0;
      const pct = r.payout_pct != null ? +r.payout_pct : null;
      const part = +r.participants || 0;
      const perPlayer = pct != null && part > 0 ? Math.round(medMoney * pct / 100 / part) : null;
      table[`${r.difficulty}|${r.name}`] = {
        successRate: n ? ok / n : null,
        medMoney: medMoney,
        medRespect: +r.med_respect || 0,
        samples: n,
        payoutPct: pct,
        participants: part,
        perPlayerMoney: perPlayer
      }
    }
    return table
  }
  const COMMUNITY_K = 10;
  async function getCommunity(key) {
    if (!supaOn()) return null;
    try {
      const res = await supaFn({
        action: "community",
        key: key
      });
      const rows = res && res.rows || [];
      const m = {};
      for (const r of rows) {
        const ok = +r.ok || 0,
          fail = +r.fail || 0,
          n = ok + fail;
        m[`${r.difficulty}|${r.name}`] = {
          pGlobal: n ? ok / n : null,
          medMoney: +r.med_money || 0,
          medRespect: +r.med_respect || 0
        }
      }
      return m
    } catch (e) {
      console.warn("ocbfcommunity:", e.message);
      return null
    }
  }

  function effSuccess(key, h) {
    const g = state.community && state.community[key];
    const pg = g ? g.pGlobal : null;
    const n = h ? h.samples || 0 : 0;
    const sr = h && h.successRate != null ? h.successRate : null;
    if (pg == null) return {
      p: sr,
      community: false
    };
    const wins = sr != null ? sr * n : 0;
    const p = (wins + COMMUNITY_K * pg) / (n + COMMUNITY_K);
    return {
      p: p,
      community: n < COMMUNITY_K
    }
  }
  async function getHistory(key, onProgress) {
    const db = await idbOpen();
    if (GM_getValue(DATAVER_STORE, 1) < DATA_VERSION) {
      GM_setValue(META_STORE, {
        lastSync: 0
      });
      GM_setValue(DATAVER_STORE, DATA_VERSION)
    }
    const meta = GM_getValue(META_STORE, {
      lastSync: 0
    });
    const stale = Date.now() - (meta.lastSync || 0) >= HIST_TTL_MS;
    const retryReady = Date.now() - (meta.lastFail || 0) >= HIST_RETRY_MS;
    let sync = null;
    if ((stale || await idbCount(db) === 0) && retryReady) {
      sync = await syncHistory(db, key, onProgress);
      GM_setValue(META_STORE, sync.pageError ? {
        lastSync: meta.lastSync || 0,
        lastFail: Date.now()
      } : {
        lastSync: Date.now(),
        lastFail: 0
      })
    }
    let table = null,
      source = "local";
    if (supaOn()) {
      try {
        table = await supaAggregate(key);
        source = "supabase"
      } catch (e) {
        console.warn("ocbfgateway read, using local:", e.message)
      }
    }
    const records = await idbGetAll(db);
    if (!table || !Object.keys(table).length) {
      if (!records.length) throw new Error(sync && sync.pageError || "No crimes (check key faction access)");
      table = aggregate(records);
      source = "local"
    }
    return {
      table: table,
      source: source,
      builtAt: GM_getValue(META_STORE, {}).lastSync || Date.now(),
      stored: records.length,
      synced: sync ? sync.added : 0,
      pages: sync ? sync.pages : 0,
      pageError: sync ? sync.pageError : null
    }
  }

  function score(slots, hist) {
    const W = weightsLookup();
    const myScore = selfScore();
    const cfgS = effCfg();
    return slots.map(s => {
      const key = `${s.difficulty}|${s.name}`;
      const h = hist?.table?.[key] || null;
      const eff = effSuccess(key, h);
      const sr = eff.p;
      const cg = state.community && state.community[key] || null;
      const blended = sr != null ? Math.round(s.cpr * sr) : s.cpr;
      const ow = W && W[normKey(s.name)];
      const weight = ow ? ow[normKey(s.position.replace(/\s*#\d+$/, ""))] : null;
      const maxW = ow ? Math.max.apply(null, Object.values(ow)) : null;
      const req = OCScore.roleMin(s.difficulty, weight, maxW, cfgS);
      const scoreReq = OCScore.scoreReq(s.difficulty, cfgS);
      return {
        ...s,
        successRate: sr,
        blended: blended,
        lowConfidence: sr == null,
        community: eff.community,
        moneyYou: h ? h.perPlayerMoney : null,
        respectCrime: h && h.medRespect || (cg ? cg.medRespect : null),
        communityMoney: cg ? cg.medMoney : null,
        weight: weight,
        impact: weight != null ? Math.round(s.cpr * weight / 10) / 10 : null,
        req: req,
        scoreReq: scoreReq,
        qualified: blended >= req && myScore >= scoreReq,
        samples: h ? h.samples : 0
      }
    })
  }

  function rankMetric(s, direction) {
    switch (direction) {
      case "success":
        return s.blended;
      case "impact":
        return s.impact || 0;
      case "evmoney":
        return s.moneyYou || 0;
      case "evrespect":
        return s.respectCrime || 0;
      case "raw":
        return s.cpr;
      case "higher":
      default:
        return s.difficulty * 1e3 + s.blended
    }
  }

  function rank(scored, direction, viewerScore) {
    return [...scored].sort((x, y) => OCScore.recAdjust(rankMetric(y, direction), y, viewerScore) - OCScore.recAdjust(rankMetric(x, direction), x, viewerScore))
  }

  function recommend(ranked, direction) {
    if (!ranked.length) return null;
    const joinable = ranked.filter(r => r.qualified);
    if (!joinable.length) return null;
    const cfgB = effCfg();
    const myScore = selfScore();
    let maxD = 0;
    for (let d = 1; d <= 10; d++)
      if (myScore >= OCScore.scoreReq(d, cfgB)) maxD = d;
    const floorD = maxD - (maxD >= 7 ? 1 : 2);
    const banded = joinable.filter(r => r.difficulty >= floorD);
    const pool = banded.length ? banded : joinable;
    if (direction === "higher") return pool[0];
    const notRed = pool.filter(r => blendedColor(r.blended) !== "red");
    return notRed[0] || pool[0]
  }
  let state = {
    slots: [],
    hist: null,
    histNote: "",
    direction: "higher",
    floor: 0,
    hideNoItem: false,
    view: "recommend",
    snaps: null,
    trendOc: null,
    trendRole: null,
    weights: null,
    scores: null,
    selfId: null,
    scoreDelta: 0,
    factionCfg: null,
    scoreInputs: null,
    community: null
  };
  const effCfg = () => Object.assign({}, OCScore.CFG, state.factionCfg || {});
  async function fetchSelfId(key) {
    const c = GM_getValue(SELF_STORE, null);
    if (c) return c;
    try {
      const j = await gmGet(`${API}/key/info?key=${encodeURIComponent(key)}`);
      const id = j.info?.user?.id || j.user?.id || null;
      if (id) GM_setValue(SELF_STORE, id);
      GM_setValue(FACACC_STORE, !!(j.info?.access?.faction));
      return id
    } catch {
      return null
    }
  }
  async function getRecs(key) {
    if (!supaOn()) return {};
    try {
      const r = await supaFn({
        action: "recs",
        key: key
      });
      const R = {};
      for (const x of r && r.rows || [])(R[x.user_id] || (R[x.user_id] = {}))[OCScore.norm(x.name) + "|" + OCScore.norm(x.position)] = x.direction || null;
      return R
    } catch (e) {
      console.warn("ocbfrecs:", e.message);
      return {}
    }
  }

  function pushRec(key, rec) {
    if (!supaOn() || !shareOn() || !rec) return;
    supaFn({
      action: "pushrec",
      key: key,
      rec: {
        name: rec.name,
        position: rec.position,
        direction: state.direction
      }
    }).catch(e => console.warn("ocbfpushrec:", e.message))
  }
  async function cloudEvents(key, cfg) {
    if (!supaOn()) return [];
    try {
      const r = await supaFn({
        action: "player_events",
        key: key,
        half_life_days: cfg.HALF_LIFE_DAYS
      });
      return r && r.rows || []
    } catch (e) {
      console.warn("ocbfplayer_events:", e.message);
      return []
    }
  }

  function mergeRecords(local, cloud) {
    const byId = new Map();
    for (const c of cloud) byId.set(c.crime_id, c);
    for (const c of local) byId.set(c.id, c);
    return [...byId.values()]
  }
  async function computeScores(key) {
    const db = await idbOpen();
    const local = await idbGetAll(db);
    const R = await getRecs(key);
    const cfg = effCfg();
    const weights = weightsLookup() || {};
    const records = mergeRecords(local, await cloudEvents(key, cfg));
    state.scores = OCScore.compute(records, weights, R, Math.floor(Date.now() / 1e3), cfg).byUser;
    state.scoreInputs = {
      records: records,
      weights: weights,
      recs: R
    };
    state.selfId = await fetchSelfId(key);
    const my = OCScore.playerScore(state.scores, state.selfId, cfg);
    window.__ocbfSelfScore = my.score;
    window.__ocbfScoreCfg = cfg;
    const prev = GM_getValue(SCORE_CACHE, null);
    state.scoreDelta = prev != null ? my.score - prev : 0;
    GM_setValue(SCORE_CACHE, my.score)
  }
  const selfScore = () => OCScore.playerScore(state.scores || {}, state.selfId, effCfg()).score;
  const normKey = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  function buildWeightMap(rows) {
    const m = {};
    for (const r of rows || []) {
      const ok = normKey(r.name),
        rk = normKey(r.position);
      (m[ok] || (m[ok] = {}))[rk] = +r.weight || 0
    }
    return m
  }
  async function getWeights(key) {
    if (supaOn()) {
      try {
        const r = await supaFn({
          action: "weights",
          key: key
        });
        if (r && r.rows && r.rows.length) return buildWeightMap(r.rows)
      } catch (e) {
        console.warn("ocbfgateway weights, using live:", e.message)
      }
    }
    return window.__ocbfWeights || null
  }

  function pushWeights(key) {
    const live = window.__ocbfWeights;
    if (!supaOn() || !shareOn() || !key || !live || !Object.keys(live).length) return;
    const rows = [];
    for (const [ocKey, roles] of Object.entries(live))
      for (const [roleKey, w] of Object.entries(roles)) rows.push({
        name: ocKey,
        position: roleKey,
        weight: w,
        updated_at: Date.now()
      });
    if (rows.length) supaFn({
      action: "pushweights",
      key: key,
      weights: rows
    }).catch(e => console.warn("ocbfgateway pushweights:", e.message))
  }
  const weightsLookup = () => state.weights || window.__ocbfWeights || null;

  function paintCrimeSuccess() {
    if (!getKey()) return;
    const W = weightsLookup();
    if (!W) return;
    document.querySelectorAll("[data-oc-id]").forEach(card => {
      const titleEl = card.querySelector('[class*="panelTitle___"]');
      if (!titleEl) return;
      const ocW = W[normKey(titleEl.textContent.trim())];
      if (!ocW) return;
      let sumW = 0,
        sumWC = 0,
        filled = 0;
      card.querySelectorAll('[class*="slotHeader___"]').forEach(hdr => {
        const cprEl = hdr.querySelector('[class*="successChance___"]');
        const roleEl = hdr.querySelector('[class*="title___"]');
        if (!cprEl || !roleEl) return;
        const wrap = hdr.closest('[class*="wrapper"]');
        if (wrap && !wrap.querySelector('button[class*="torn-btn"]')) filled++;
        const cpr = parseInt(cprEl.textContent || "0", 10);
        const w = ocW[normKey(roleEl.textContent.trim())];
        if (!cpr || w == null) return;
        sumW += w;
        sumWC += w * cpr
      });
      if (sumW <= 0) return;
      const score = filled === 0 ? 0 : Math.round(sumWC / sumW);
      const c = COLORS[blendedColor(score)];
      const cont = titleEl.parentElement;
      if (!cont) return;
      let badge = cont.querySelector(".ocbf-crime-success");
      if (!badge) {
        badge = el("span", {
          className: "ocbf-crime-success"
        });
        badge.style.cssText = "display:block;margin:4px 10px 4px auto;width:fit-content;padding:2px 8px;border:1px solid;border-radius:7px;font-size:12px;font-weight:700;background:transparent";
        titleEl.insertAdjacentElement("afterend", badge)
      }
      const txt = `Crime success: ${score}%`;
      if (badge.textContent !== txt) badge.textContent = txt;
      if (badge.dataset.c !== c) {
        badge.dataset.c = c;
        badge.style.color = c;
        badge.style.borderColor = c
      }
      badge.title = "Weighted average of every role's CPR by role importance (sum weight x CPR)."
    })
  }

  function applyFilters(scored) {
    return scored.filter(s => {
      if (state.hideNoItem && s.itemRequired && !s.itemAvailable) return false;
      if (s.blended < state.floor) return false;
      return true
    })
  }
  async function fetchSnapshots(key) {
    if (supaOn()) {
      try {
        const r = await supaFn({
          action: "snapshots",
          key: key
        });
        if (r && r.rows) return r.rows
      } catch (e) {
        console.warn("ocbfgateway snapshots, using local:", e.message)
      }
    }
    try {
      const db = await idbOpen();
      return await idbLogAll(db)
    } catch {
      return []
    }
  }

  function trendSeries(snaps, oc, role) {
    const out = [];
    for (const s of snaps || []) {
      const m = (s.cprs || []).find(c => c.name === oc && c.position === role);
      if (m) out.push({
        ts: s.ts,
        cpr: m.cpr
      })
    }
    return out.sort((a, b) => a.ts - b.ts)
  }
  const fmtD = ts => {
    const d = new Date(ts);
    return d.getMonth() + 1 + "/" + d.getDate()
  };
  let gradN = 0;

  function buildTrendChart(host, data) {
    const W = 320,
      H = 180,
      M = {
        l: 34,
        r: 12,
        t: 12,
        b: 42
      };
    const vals = data.map(d => d.cpr);
    let lo = Math.max(0, Math.min(...vals) - 6),
      hi = Math.min(100, Math.max(...vals) + 6);
    if (hi - lo < 20) {
      const mid = (hi + lo) / 2;
      lo = Math.max(0, mid - 10);
      hi = Math.min(100, mid + 10)
    }
    const iW = W - M.l - M.r,
      iH = H - M.t - M.b;
    const X = i => M.l + iW * (data.length === 1 ? .5 : i / (data.length - 1));
    const Y = v => H - M.b - iH * ((v - lo) / (hi - lo));
    const last = data[data.length - 1].cpr,
      c = COLORS[blendedColor(last)];
    const gid = "ocbfg" + ++gradN;
    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`
    });
    svg.style.cssText = "width:100%;overflow:visible";
    const defs = svgEl("defs");
    const lg = svgEl("linearGradient", {
      id: gid,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1
    });
    lg.append(svgEl("stop", {
      offset: 0,
      "stop-color": c,
      "stop-opacity": .5
    }));
    lg.append(svgEl("stop", {
      offset: 1,
      "stop-color": c,
      "stop-opacity": 0
    }));
    const cp = svgEl("clipPath", {
      id: gid + "c"
    });
    const rect = svgEl("rect", {
      x: 0,
      y: 0,
      width: 0,
      height: H
    });
    cp.append(rect);
    defs.append(lg, cp);
    svg.append(defs);
    const cy = M.t + iH / 2,
      cx = M.l + iW / 2;
    for (let k = 0; k <= 3; k++) {
      const v = Math.round(lo + (hi - lo) * k / 3);
      const yy = Y(v);
      svg.append(svgEl("line", {
        x1: M.l,
        y1: yy,
        x2: W - M.r,
        y2: yy,
        stroke: "var(--default-panel-divider-color, rgba(255,255,255,.08))",
        "stroke-width": 1
      }));
      const tl = svgEl("text", {
        x: M.l - 5,
        y: yy + 3,
        fill: "#9aa0a6",
        "font-size": 9,
        "text-anchor": "end"
      });
      tl.textContent = v;
      svg.append(tl)
    } [0, data.length - 1 >> 1, data.length - 1].forEach((i, k) => {
      const x = X(i);
      const tx = svgEl("text", {
        x: x,
        y: H - M.b + 13,
        fill: "#9aa0a6",
        "font-size": 9,
        "text-anchor": k === 0 ? "start" : k === 2 ? "end" : "middle"
      });
      tx.textContent = fmtD(data[i].ts);
      svg.append(tx)
    });
    const xt = svgEl("text", {
      x: cx,
      y: H - 4,
      fill: "#9aa0a6",
      "font-size": 10,
      "font-weight": 700,
      "text-anchor": "middle"
    });
    xt.textContent = "Snapshot date";
    svg.append(xt);
    const yt = svgEl("text", {
      x: 9,
      y: cy,
      fill: "#9aa0a6",
      "font-size": 10,
      "font-weight": 700,
      "text-anchor": "middle",
      transform: `rotate(-90 9 ${cy.toFixed(1)})`
    });
    yt.textContent = "CPR %";
    svg.append(yt);
    const P = data.map((d, i) => [X(i), Y(d.cpr)]);
    const line = "M" + P.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L");
    const area = line + ` L${P[P.length-1][0]} ${H-M.b} L${P[0][0]} ${H-M.b} Z`;
    const grp = svgEl("g", {
      "clip-path": `url(#${gid}c)`
    });
    grp.append(svgEl("path", {
      d: area,
      fill: `url(#${gid})`
    }));
    grp.append(svgEl("path", {
      d: line,
      fill: "none",
      stroke: c,
      "stroke-width": 2.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    }));
    grp.append(svgEl("circle", {
      cx: P[P.length - 1][0],
      cy: P[P.length - 1][1],
      r: 3.5,
      fill: c
    }));
    grp.style.transformBox = "fill-box";
    grp.style.transformOrigin = "bottom";
    grp.style.transition = "transform 1s cubic-bezier(.2,.8,.2,1)";
    svg.append(grp);
    host.append(svg);
    rect.style.transition = "width 1s cubic-bezier(.4,0,.2,1)";
    grp.style.transform = "scaleY(0)";
    rect.setAttribute("width", 0);
    requestAnimationFrame(() => {
      grp.style.transform = "scaleY(1)";
      rect.setAttribute("width", W)
    })
  }

  function renderTrend(body) {
    if (state.snaps === null) {
      body.append(el("div", {
        style: `color:${T.sub};padding:10px`,
        textContent: "Loading trend..."
      }));
      fetchSnapshots(getKey()).then(rows => {
        state.snaps = rows || [];
        render()
      });
      return
    }
    const snaps = state.snaps;
    const ocs = [...new Set(snaps.flatMap(s => (s.cprs || []).map(c => c.name)))].sort();
    if (!ocs.length) {
      body.append(el("div", {
        style: `color:${T.sub};padding:10px`,
        textContent: "No snapshots yet. A point is recorded only when your CPR for a role changes (after you train, or OCs rotate) - so this fills in over time, not every visit."
      }));
      return
    }
    if (!ocs.includes(state.trendOc)) state.trendOc = ocs[0];
    const roles = [...new Set(snaps.flatMap(s => (s.cprs || []).filter(c => c.name === state.trendOc).map(c => c.position)))].sort();
    if (!roles.includes(state.trendRole)) state.trendRole = roles[0];
    const bar = el("div", {
      style: "display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"
    });
    const ocSel = el("select", {
      className: "ocbf-ctl",
      id: "ocbf-dir",
      style: "flex:1;min-width:120px"
    });
    ocs.forEach(n => ocSel.append(el("option", {
      value: n,
      textContent: n
    })));
    ocSel.value = state.trendOc;
    ocSel.addEventListener("change", () => {
      state.trendOc = ocSel.value;
      state.trendRole = null;
      render()
    });
    const roleSel = el("select", {
      className: "ocbf-ctl",
      id: "ocbf-dir",
      style: "flex:0 0 auto"
    });
    roles.forEach(r => roleSel.append(el("option", {
      value: r,
      textContent: r
    })));
    roleSel.value = state.trendRole;
    roleSel.addEventListener("change", () => {
      state.trendRole = roleSel.value;
      render()
    });
    bar.append(ocSel, roleSel);
    body.append(bar);
    const data = trendSeries(snaps, state.trendOc, state.trendRole);
    if (data.length < 2) {
      body.append(el("div", {
        style: `color:${T.sub};padding:10px;line-height:1.5`,
        textContent: `Only ${data.length} snapshot${data.length===1?"":"s"} for ${state.trendRole} in ${state.trendOc}. Need >=2 to draw a trend. A new point is recorded only when your CPR for this role changes - i.e. after you train stats (CPR is fixed by your stats, so it won't move day-to-day otherwise).`
      }));
      return
    }
    const first = data[0].cpr,
      last = data[data.length - 1].cpr,
      delta = last - first,
      c = COLORS[blendedColor(last)];
    body.append(el("div", {
      style: "display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;gap:8px"
    }, el("span", {
      style: "font-size:13px;font-weight:700",
      textContent: `${state.trendOc} - ${state.trendRole}`
    }), el("span", {
      style: `font-size:20px;font-weight:800;color:${c}`,
      textContent: last + "%"
    })));
    const viz = el("div", {
      style: "background:var(--ocbf-card);border-radius:6px;padding:8px"
    });
    body.append(viz);
    buildTrendChart(viz, data);
    body.append(el("div", {
      style: `color:${T.sub};font-size:11px;margin-top:8px;line-height:1.5`,
      textContent: `Your CPR for ${state.trendRole} over ${data.length} snapshots (${fmtD(data[0].ts)} to ${fmtD(data[data.length-1].ts)}). Started ${first}%, latest ${last}%, ${delta>=0?"+":""}${delta}.`
    }))
  }

  function renderTabs(body) {
    const TABS = [
      ["recommend", "Recommend"],
      ["score", "Score"],
      ["trend", "Trend"],
      ["help", "Help"]
    ];
    const bar = el("div", {
      style: `position:sticky;top:0;z-index:3;background:${T.bg};display:flex;border-bottom:1px solid ${T.divider};margin:-10px -10px 10px`
    });
    for (const [v, label] of TABS) {
      const active = state.view === v;
      const tab = el("div", {
        textContent: label,
        style: `flex:1;text-align:center;padding:10px 0;font-size:12px;cursor:pointer;user-select:none;` + (active ? `color:var(--ocbf-ctl-text);font-weight:700;border-bottom:2px solid ${COLORS.yellow}` : `color:${T.sub}`)
      });
      tab.addEventListener("click", () => {
        if (state.view !== v) {
          state.view = v;
          render()
        }
      });
      bar.append(tab)
    }
    body.append(bar)
  }

  function renderHelp(body) {
    const wrap = el("div", {
      style: "font-size:12px;line-height:1.5"
    });
    if (ocStatic && ocStatic.helpHtml) {
      wrap.innerHTML = ocStatic.helpHtml
    } else if (!staticDone) {
      wrap.append(el("div", {
        style: `color:${T.sub}`,
        textContent: "Loading help..."
      }));
      loadStatic().then(() => {
        if (state.view === "help") render()
      })
    } else {
      wrap.append(el("div", {
        style: `color:${T.sub}`,
        textContent: "Help content could not load - check your connection."
      }))
    }
    body.append(wrap)
  }

  function render() {
    const panel = $("#ocbf-panel");
    if (!panel) return;
    const body = $("#ocbf-body", panel);
    body.textContent = "";
    const scored = applyFilters(score(state.slots, state.hist));
    const ranked = rank(scored, state.direction, selfScore());
    const rec = recommend(ranked, state.direction);
    state.currentRec = rec ? {
      name: rec.name,
      position: rec.position
    } : null;
    markRecommended();
    renderTabs(body);
    if (state.view === "trend") {
      renderTrend(body);
      return
    }
    if (state.view === "score") {
      body.append(buildScoreContent(state.selfId, "You"));
      return
    }
    if (state.view === "help") {
      renderHelp(body);
      return
    } {
      const my = OCScore.playerScore(state.scores || {}, state.selfId, effCfg());
      const cfgA = effCfg();
      let maxD = 0,
        nextD = null;
      for (let dd = 1; dd <= 10; dd++) {
        if (my.score >= OCScore.scoreReq(dd, cfgA)) maxD = dd;
        else if (nextD == null) nextD = dd
      }
      const noData = my.hasData === false;
      const sCol = noData ? T.sub : my.flagged ? COLORS.red : my.score >= cfgA.BASE ? COLORS.green : T.text;
      const accTxt = noData ? (factionAccess() ? "No completed-OC history synced yet" : "Needs faction OC API access - regenerate key or ask your faction leader") : nextD ? `OC access: up to D${maxD} - next D${nextD} at ${OCScore.scoreReq(nextD,cfgA)} (+${OCScore.scoreReq(nextD,cfgA)-my.score})` : "OC access: all OCs (D1-D10)";
      const line = el("div", {
        style: "display:flex;align-items:baseline;gap:8px;padding:4px 2px;cursor:pointer",
        title: noData ? "Score appears once your completed OCs are available" : "Open the Score tab for the full breakdown + history"
      }, el("span", {
        style: `font-size:11px;color:${T.sub};text-transform:uppercase;letter-spacing:.5px`,
        textContent: "Your score"
      }), el("b", {
        style: `font-size:16px;color:${sCol}`,
        textContent: noData ? "-" : my.score
      }), el("span", {
        style: `margin-left:auto;font-size:11px;color:${T.sub}`,
        textContent: accTxt
      }));
      line.addEventListener("click", () => {
        state.view = "score";
        render()
      });
      body.append(line)
    }
    const details = r => `Success score ${r.blended}%  (chance the crime actually succeeds with you in it)\n` + `- in-game CPR ${r.cpr}%  (your single-checkpoint pass rate)\n` + `- ${r.community?"community estimate - little history here yet":"faction finishes this "+(r.successRate!=null?Math.round(r.successRate*100)+"%":"n/a")+" of the time"}\n` + `- expected money ${fmtMoney(r.moneyYou)} (your cut)  -  expected respect ${r.respectCrime!=null?r.respectCrime:"-"} (faction)\n` + `- role weight ${r.weight!=null?r.weight+"%":"n/a"}  -  impact ${r.impact!=null?r.impact:"-"}`;
    if (rec) {
      const c = COLORS[blendedColor(rec.blended)];
      const card = el("div", {
        title: details(rec),
        style: `display:flex;align-items:center;gap:12px;border-left:4px solid ${c};background:var(--ocbf-card);padding:12px;border-radius:4px;cursor:pointer`
      }, el("div", {
        style: `flex:0 0 auto;min-width:48px;text-align:center;border:2px solid ${c};color:${c};border-radius:6px;padding:7px 4px;font-size:20px;font-weight:800;line-height:1`,
        textContent: `${rec.blended}`
      }), el("div", {
        style: "min-width:0"
      }, el("div", {
        style: `font-size:10px;color:${T.sub};text-transform:uppercase;letter-spacing:.5px`,
        textContent: "Recommended"
      }), el("div", {
        style: "font-size:15px;font-weight:700;margin-top:2px",
        textContent: `${rec.name}`
      }), el("div", {
        style: `font-size:12px;color:${T.sub};margin-top:1px`,
        textContent: `D${rec.difficulty} - as ${rec.position}`
      })), el("div", {
        style: `flex:0 0 auto;margin-left:auto;color:${T.sub};font-size:11px`,
        textContent: "tap"
      }));
      card.addEventListener("click", e => openDetail(details(rec), e));
      body.append(card);
      const sub = state.direction === "higher" ? `Reach for it - the hardest OC you can take on (D${rec.difficulty}). Win it and your standing climbs faster.` : "Best joinable role for the current preset. Joining recommended roles raises your standing faster.";
      body.append(el("div", {
        style: `color:${T.sub};font-size:11px;margin-top:4px`,
        textContent: sub
      }))
    } else {
      const msg = ranked.length ? "No role you can join right now - you need a higher success score or a higher standing (see Help)." : "No open slots match the current filters.";
      body.append(el("div", {
        style: `color:${T.sub};padding:10px`,
        textContent: msg
      }))
    }
    body.append(el("div", {
      style: `color:${T.sub};font-size:11px;margin-top:10px;line-height:1.5`
    }, "Colors: ", el("span", {
      style: `color:${COLORS.green};font-weight:700`,
      textContent: ">=70"
    }), " - ", el("span", {
      style: `color:${COLORS.yellow};font-weight:700`,
      textContent: "50-69"
    }), " - ", el("span", {
      style: `color:${COLORS.red};font-weight:700`,
      textContent: "<50"
    }), ". The Help tab explains every number."));
    if (state.histNote) {
      const ok = state.hist != null;
      const stale = ok && state.hist.pageError;
      body.append(el("div", {
        style: `font-size:10px;margin-top:6px;color:${ok?stale?COLORS.yellow:"#3fb950":"#e5534b"}`,
        textContent: state.histNote
      }))
    }
  }
  const SEL = {
    card: "[data-oc-id]",
    name: '[class*="panelTitle___"]',
    diff: '[class*="levelValue___"]',
    slotHeader: '[class*="slotHeader___"]',
    role: '[class*="title___"]',
    cpr: '[class*="successChance___"]'
  };

  function paintNative() {
    if (!getKey()) return;
    if (state.hist || state.community) {
      document.querySelectorAll(SEL.card).forEach(card => {
        const name = card.querySelector(SEL.name)?.textContent?.trim();
        const diff = parseInt(card.querySelector(SEL.diff)?.textContent || "0", 10);
        if (!name || !diff) return;
        const key = `${diff}|${name}`;
        const h = state.hist ? state.hist.table[key] : null;
        const eff = effSuccess(key, h);
        const sr = eff.p;
        card.querySelectorAll(SEL.slotHeader).forEach(hdr => {
          const padRoot = hdr.closest('[class*="wrapper"]') || hdr.parentElement;
          if (padRoot && padRoot.dataset.ocbfTagged !== "1") {
            if (getComputedStyle(padRoot).position === "static") padRoot.style.position = "relative";
            padRoot.style.paddingTop = "15px";
            padRoot.dataset.ocbfTagged = "1"
          }
          const cprEl = hdr.querySelector(SEL.cpr);
          if (!cprEl) return;
          const rawCPR = parseInt(cprEl.textContent || "0", 10);
          if (!rawCPR) return;
          const blended = sr != null ? Math.round(rawCPR * sr) : rawCPR;
          const replaceCpr = replaceCprOn();
          const slotRoot = hdr.closest('[class*="wrapper"]') || hdr.parentElement;
          const txt = sr != null ? `${blended}${eff.community?"~":""}` : `${blended}*`;
          const colName = blendedColor(blended);
          const title = `${name} (D${diff}) - ${hdr.querySelector(SEL.role)?.textContent?.trim()||""}\n` + `Success score ${blended}% - chance the crime actually succeeds with you in it.\n` + `- in-game CPR ${rawCPR}% (your single-checkpoint pass rate)\n` + `- ${eff.community?"community estimate (you have little history here yet)":"faction finishes this "+(sr!=null?Math.round(sr*100)+"%":"n/a")+" of the time"}`;
          const shortTitle = `Success ${blended}%${eff.community?"~":""} - CPR ${rawCPR}% (tap for detail - Help tab explains)`;
          let hdrNum = hdr.querySelector(".ocbf-cprhdr");
          if (replaceCpr) {
            if (cprEl.style.display !== "none") cprEl.style.display = "none";
            if (!hdrNum) {
              hdrNum = el("span", {
                className: "ocbf-cprhdr"
              });
              hdrNum.style.cssText = "font-weight:700;cursor:pointer";
              hdrNum.addEventListener("click", e => {
                e.stopPropagation();
                e.preventDefault();
                openDetail(hdrNum.dataset.detail || "", e)
              });
              cprEl.insertAdjacentElement("afterend", hdrNum)
            }
            if (hdrNum.textContent !== txt) hdrNum.textContent = txt;
            if (hdrNum.dataset.c !== colName) {
              hdrNum.dataset.c = colName;
              hdrNum.style.color = COLORS[colName]
            }
            if (hdrNum.title !== shortTitle) hdrNum.title = shortTitle;
            if (hdrNum.dataset.detail !== title) hdrNum.dataset.detail = title
          } else {
            if (cprEl.style.display === "none") cprEl.style.display = "";
            hdrNum?.remove()
          }
          let leftTag = slotRoot ? slotRoot.querySelector(".ocbf-left") : null;
          if (!leftTag && slotRoot) {
            leftTag = el("span", {
              className: "ocbf-left"
            });
            leftTag.style.cssText = "position:absolute;top:2px;left:4px;z-index:6;font-size:10px;font-weight:700;line-height:1;cursor:pointer";
            leftTag.append(el("span", {
              className: "ocbf-cpr"
            }), el("span", {
              className: "ocbf-reqpart"
            }));
            leftTag.addEventListener("click", e => {
              e.stopPropagation();
              e.preventDefault();
              openDetail(leftTag.dataset.detail || "", e)
            });
            slotRoot.appendChild(leftTag)
          }
          const cprSpan = leftTag ? leftTag.querySelector(".ocbf-cpr") : null;
          const reqPart = leftTag ? leftTag.querySelector(".ocbf-reqpart") : null;
          const cprText = replaceCpr ? "" : txt;
          if (cprSpan && cprSpan.textContent !== cprText) cprSpan.textContent = cprText;
          if (cprSpan && cprSpan.dataset.c !== colName) {
            cprSpan.dataset.c = colName;
            cprSpan.style.color = COLORS[colName]
          }
          if (leftTag && leftTag.title !== shortTitle) leftTag.title = shortTitle;
          if (leftTag && leftTag.dataset.detail !== title) leftTag.dataset.detail = title;
          const joinBtn = slotRoot ? slotRoot.querySelector('button[class*="torn-btn"]') : null;
          let stake = slotRoot ? slotRoot.querySelector(".ocbf-stake") : null;
          if (!joinBtn) {
            if (reqPart) {
              reqPart.textContent = "";
              reqPart.dataset.sig = ""
            }
            stake?.remove();
            return
          }
          const role = hdr.querySelector(SEL.role)?.textContent?.trim() || "";
          const cfg = effCfg();
          const ow = (weightsLookup() || {})[normKey(name)] || null;
          const weight = ow ? ow[normKey(role.replace(/\s*#\d+$/, ""))] : null;
          const maxW = ow ? Math.max.apply(null, Object.values(ow)) : null;
          const req = OCScore.roleMin(diff, weight, maxW, cfg);
          const cprOk = blended >= req;
          const sReq = OCScore.scoreReq(diff, cfg);
          const myScore = window.__ocbfSelfScore != null ? window.__ocbfSelfScore : selfScore();
          const scoreOk = myScore >= sReq;
          const canJoin = cprOk && scoreOk;
          const isCritical = weight != null && weight >= cfg.HIGH_WEIGHT;
          const recd = !!(state.currentRec && normKey(state.currentRec.name) === normKey(name) && normKey(state.currentRec.position) === normKey(role));
          if (reqPart) {
            const reqSig = `${req}${cprOk?"q":"u"}${replaceCpr?"R":""}`;
            if (reqPart.dataset.sig !== reqSig) {
              reqPart.dataset.sig = reqSig;
              reqPart.textContent = replaceCpr ? `Req ${req}` : ` (Req ${req})`;
              reqPart.style.color = cprOk ? T.sub : COLORS.red
            }
          }
          const ensureStake = () => {
            if (!stake) {
              stake = el("span", {
                className: "ocbf-stake"
              });
              stake.style.cssText = "position:absolute;top:2px;right:4px;z-index:6;font-size:10px;font-weight:700;line-height:1;pointer-events:none";
              slotRoot.appendChild(stake)
            }
            return stake
          };
          if (canJoin) {
            const lean = recd ? OCScore.PRESET_LEAN[state.direction] || 0 : 0;
            const d = OCScore.scoreDelta(diff, isCritical, true, recd, cfg, lean);
            ensureStake();
            const sig = `q${d.success}/${d.fail}${recd?"r":""}`;
            if (stake.dataset.sig !== sig) {
              stake.dataset.sig = sig;
              stake.style.color = "";
              stake.textContent = "";
              stake.append(el("span", {
                style: `color:${COLORS.green}`,
                textContent: `+${d.success}`
              }), document.createTextNode("/"), el("span", {
                style: `color:${COLORS.red}`,
                textContent: `${d.fail}`
              }));
              stake.title = `Joining this role: if the OC succeeds your score ${d.success>=0?"+":""}${d.success}, if it fails ${d.fail}. Difficulty-scaled - lower OCs move your score more.${isCritical?" Critical role.":""}${recd?" Recommended to you (includes follow bonus).":""}`
            }
          } else if (cprOk && !scoreOk) {
            ensureStake();
            const sig = `s${sReq}`;
            if (stake.dataset.sig !== sig) {
              stake.dataset.sig = sig;
              stake.textContent = `Score ${sReq}`;
              stake.style.color = COLORS.red;
              stake.title = `Your OC standing (${myScore}) is below the ${sReq} needed to join a D${diff} role. Raise it by winning OCs and following recommended roles; join is disabled until then.`
            }
          } else {
            stake?.remove()
          }
          if (!canJoin) {
            joinBtn.disabled = true;
            joinBtn.classList.add("torn-btn--disabled");
            joinBtn.dataset.ocbfBlocked = "1"
          } else if (joinBtn.dataset.ocbfBlocked === "1") {
            joinBtn.disabled = false;
            joinBtn.classList.remove("torn-btn--disabled");
            delete joinBtn.dataset.ocbfBlocked
          }
        })
      })
    }
    markRecommended()
  }
  let lastRecSig = "";

  function markRecommended() {
    if (!state.slots.length) return;
    const ranked = rank(applyFilters(score(state.slots, state.hist)), state.direction, selfScore());
    const rec = recommend(ranked, state.direction);
    const sig = rec ? `${rec.crimeId}|${rec.position}|${rec.cpr}|${rec.blended}|${state.direction}` : "";
    if (sig === lastRecSig && document.querySelector("[data-ocbf-rec]")) return;
    document.querySelectorAll(".ocbf-rec-square").forEach(n => n.remove());
    document.querySelectorAll("[data-ocbf-rec]").forEach(n => {
      n.style.outline = "";
      n.removeAttribute("data-ocbf-rec")
    });
    lastRecSig = sig;
    if (!rec) return;
    const card = document.querySelector(`[data-oc-id="${rec.crimeId}"]`);
    if (!card) return;
    const base = String(rec.position).replace(/\s*#\d+$/, "");
    const color = COLORS[blendedColor(rec.blended)];
    for (const hdr of card.querySelectorAll(SEL.slotHeader)) {
      const cprEl = hdr.querySelector(SEL.cpr);
      const titleEl = hdr.querySelector(SEL.role);
      if (!cprEl || !titleEl) continue;
      const cpr = parseInt(cprEl.textContent || "0", 10);
      const title = titleEl.textContent.trim();
      const roleOk = title === rec.position || title === base || title.startsWith(base);
      if (cpr === rec.cpr && roleOk) {
        const box = hdr.parentElement;
        box.style.outline = `3px solid ${color}`;
        box.style.outlineOffset = "-1px";
        box.setAttribute("data-ocbf-rec", "1");
        break
      }
    }
  }
  async function buildExportData() {
    const sid = state.selfId || GM_getValue(SELF_STORE, null);
    const out = {
      exportedAt: (new Date).toISOString(),
      scriptVersion: VERSION,
      note: "All data this script holds about you. Your Torn API key and personal stats are intentionally excluded.",
      identity: GM_getValue(ID_STORE, null) || (sid ? {
        user_id: sid
      } : null),
      settings: {
        shareCpr: shareOn(),
        replaceRawCpr: replaceCprOn()
      },
      score: sid && state.scores ? state.scores[sid] || null : null,
      localCprSnapshots: [],
      sharedCprSnapshots: [],
      recommendationsLogged: []
    };
    try {
      const db = await idbOpen();
      const logs = await idbLogAll(db);
      for (const l of logs) out.localCprSnapshots.push({
        ts: l.ts,
        when: new Date(l.ts).toISOString(),
        stats: await decStats(l.statsEnc),
        cprs: l.cprs
      })
    } catch (e) {
      out.localCprSnapshots = `unavailable: ${e.message}`
    }
    const key = getKey();
    if (key && supaOn()) {
      try {
        const r = await supaFn({
          action: "snapshots",
          key: key
        });
        out.sharedCprSnapshots = r && r.rows || []
      } catch (e) {
        out.sharedCprSnapshots = `unavailable: ${e.message}`
      }
      try {
        const r = await supaFn({
          action: "recs",
          key: key
        });
        out.recommendationsLogged = (r && r.rows || []).filter(x => String(x.user_id) === String(sid))
      } catch (e) {
        out.recommendationsLogged = `unavailable: ${e.message}`
      }
    }
    return out
  }
  async function exportDataModal() {
    const overlay = el("div", {
      style: "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100001;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:24px 12px;box-sizing:border-box"
    });
    const box = el("div", {
      className: "ocbf-scroll",
      style: `background:${T.bg};color:${T.text};width:92%;max-width:620px;box-sizing:border-box;border:1px solid ${T.border};border-radius:6px;padding:18px;font-size:13px`
    });
    box.append(el("h2", {
      textContent: "Export your data",
      style: "margin:0 0 6px;font-size:15px"
    }));
    box.append(el("div", {
      style: `color:${T.sub};font-size:12px;margin-bottom:10px;line-height:1.5`,
      textContent: "Everything stored about you - and only you. Your API key is not included. Save it as a .json file if you want a copy."
    }));
    const ta = el("textarea", {
      readOnly: true,
      value: "Gathering...",
      className: "ocbf-scroll",
      style: "width:100%;box-sizing:border-box;height:300px;background:var(--ocbf-ctl-bg);color:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.5);border-radius:6px;padding:8px;font-family:monospace;font-size:11px;white-space:pre"
    });
    box.append(ta);
    const foot = el("div", {
      style: "display:flex;gap:8px;justify-content:flex-end;margin-top:12px"
    });
    const copy = el("button", {
      className: "ocbf-ctl",
      textContent: "Copy"
    });
    const dl = el("button", {
      className: "ocbf-ctl",
      textContent: "Download .json",
      disabled: true
    });
    const close = el("button", {
      className: "ocbf-ctl",
      textContent: "Close"
    });
    close.addEventListener("click", () => overlay.remove());
    foot.append(copy, dl, close);
    box.append(foot);
    overlay.append(box);
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.remove()
    });
    document.body.append(overlay);
    let json = "";
    try {
      json = JSON.stringify(await buildExportData(), null, 2)
    } catch (e) {
      json = JSON.stringify({
        error: e.message
      })
    }
    ta.value = json;
    dl.disabled = false;
    copy.addEventListener("click", () => {
      try {
        navigator.clipboard && navigator.clipboard.writeText(json) || (ta.select(), document.execCommand("copy"));
        copy.textContent = "Copied"
      } catch {
        ta.select()
      }
    });
    dl.addEventListener("click", () => {
      const sid = state.selfId || "data";
      const url = URL.createObjectURL(new Blob([json], {
        type: "application/json"
      }));
      const a = el("a", {
        href: url,
        download: `oc-bestfit-${sid}.json`
      });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e3)
    })
  }

  function openSettings() {
    const wrap = el("div", {
      style: "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:24px 12px;box-sizing:border-box"
    });
    const box = el("div", {
      className: "ocbf-scroll",
      style: `background:${T.bg};color:${T.text};max-width:420px;width:90%;box-sizing:border-box;border:1px solid ${T.border};border-radius:6px;padding:18px;font-size:13px;line-height:1.5`
    });
    box.append(el("h2", {
      textContent: "Settings",
      style: "margin:0 0 12px;font-size:15px"
    }));
    const keyRow = el("div", {
      style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"
    });
    const keyBtn = el("button", {
      className: "ocbf-ctl",
      textContent: getKey() ? "Change API key" : "Set API key"
    });
    keyBtn.addEventListener("click", () => {
      wrap.remove();
      renderKeyPrompt()
    });
    keyRow.append(keyBtn);
    if (getKey()) {
      const rmBtn = el("button", {
        className: "ocbf-ctl",
        textContent: "Remove my API key",
        style: `color:${COLORS.red}`
      });
      let armed = false;
      rmBtn.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          rmBtn.textContent = "Click again to confirm";
          return
        }
        clearKey();
        wrap.remove();
        renderKeyPrompt()
      });
      keyRow.append(rmBtn)
    }
    box.append(keyRow);
    const lab = el("label", {
      style: "display:flex;gap:8px;align-items:flex-start;cursor:pointer"
    });
    const chk = el("input", {
      type: "checkbox"
    });
    chk.checked = shareOn();
    chk.addEventListener("change", () => GM_setValue(SHARE_STORE, chk.checked));
    lab.append(chk, el("span", {}, el("b", {
      textContent: "Share my CPR to the faction database"
    }), el("div", {
      style: `color:${T.sub};margin-top:2px`,
      textContent: "Uploads your CPR snapshots so faction trends/leaderboards work. Off = your CPRs stay local only (your own trend still works); nothing personal leaves your browser. Faction crime history is shared regardless - it carries no personal CPR."
    })));
    box.append(lab);
    const rlab = el("label", {
      style: "display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin-top:14px"
    });
    const rchk = el("input", {
      type: "checkbox"
    });
    rchk.checked = replaceCprOn();
    rchk.addEventListener("change", () => {
      GM_setValue(REPLACE_CPR_STORE, rchk.checked);
      paintNative()
    });
    rlab.append(rchk, el("span", {}, el("b", {
      textContent: "Show computed CPR in place of raw CPR"
    }), el("div", {
      style: `color:${T.sub};margin-top:2px`,
      textContent: "Replaces Torn's raw single-checkpoint number in each slot header with our computed success score (raw CPR x faction success rate). Off = raw stays in the header and our computed value shows in the top-left tag."
    })));
    box.append(rlab);
    const exportBtn = el("button", {
      className: "ocbf-ctl",
      textContent: "Export my data",
      style: "margin-top:14px"
    });
    exportBtn.addEventListener("click", exportDataModal);
    box.append(exportBtn);
    const foot = el("div", {
      style: "display:flex;justify-content:space-between;align-items:center;margin-top:16px"
    });
    foot.append(el("span", {
      style: `color:${T.sub};font-size:11px`
    }, `OC Best-Fit v${VERSION} - by `, el("a", {
      href: "https://www.torn.com/profiles.php?XID=2805199",
      target: "_blank",
      rel: "noopener",
      textContent: "KamiRen [2805199]",
      style: "color:#58a6ff"
    })));
    const close = el("button", {
      className: "ocbf-ctl",
      textContent: "Close"
    });
    close.addEventListener("click", () => wrap.remove());
    foot.append(close);
    box.append(foot);
    wrap.append(box);
    wrap.addEventListener("click", e => {
      if (e.target === wrap) wrap.remove()
    });
    document.body.append(wrap)
  }

  function aboutModal() {
    const wrap = el("div", {
      id: "ocbf-about",
      style: "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:24px 12px;box-sizing:border-box"
    });
    const box = el("div", {
      className: "ocbf-scroll",
      style: `background:${T.bg};color:${T.text};width:92%;max-width:620px;box-sizing:border-box;border:1px solid ${T.border};border-radius:5px;padding:18px;font-size:13px;line-height:1.5`
    });
    box.innerHTML = (ocStatic && ocStatic.aboutHtml) || `<p style="color:${T.sub};margin:0 0 10px">About info could not load - check your connection. <a href="https://greasyfork.org/scripts/583330" target="_blank" rel="noopener" style="color:#58a6ff">Script page</a></p><div style="text-align:right;margin-top:14px"><button id="ocbf-about-close" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 14px;cursor:pointer">Close</button></div>`;
    wrap.append(box);
    wrap.addEventListener("click", e => {
      if (e.target === wrap) wrap.remove()
    });
    box.querySelector("#ocbf-about-close").addEventListener("click", () => wrap.remove());
    document.body.append(wrap);
    if (!(ocStatic && ocStatic.aboutHtml)) loadStatic().then(() => {
      if (ocStatic && ocStatic.aboutHtml && wrap.isConnected) {
        box.innerHTML = ocStatic.aboutHtml;
        const cb = box.querySelector("#ocbf-about-close");
        if (cb) cb.addEventListener("click", () => wrap.remove())
      }
    })
  }
  const DARK_TOKENS = {
    "--ocbf-sub": "#9aa0a6",
    "--ocbf-ctl-text": "#eaeaea",
    "--ocbf-hi1": "rgba(255,255,255,.05)",
    "--ocbf-hi2": "rgba(255,255,255,.11)",
    "--ocbf-hi3": "rgba(255,255,255,.28)",
    "--ocbf-card": "rgba(0,0,0,.22)",
    "--ocbf-ctl-bg": "rgba(0,0,0,.32)",
    "--ocbf-border": "rgba(255,255,255,.08)",
    "--ocbf-titlebg": "linear-gradient(180deg,#5b5b5b 0%,#383838 55%,#262626 100%)",
    "--ocbf-titletext": "#fff"
  };
  const LIGHT_TOKENS = {
    "--ocbf-sub": "#5a6066",
    "--ocbf-ctl-text": "#2b2d31",
    "--ocbf-hi1": "rgba(0,0,0,.05)",
    "--ocbf-hi2": "rgba(0,0,0,.08)",
    "--ocbf-hi3": "rgba(0,0,0,.28)",
    "--ocbf-card": "rgba(0,0,0,.05)",
    "--ocbf-ctl-bg": "rgba(0,0,0,.06)",
    "--ocbf-border": "rgba(0,0,0,.12)",
    "--ocbf-titlebg": "linear-gradient(180deg,#f7f7f7 0%,#ececec 55%,#e0e0e0 100%)",
    "--ocbf-titletext": "#1c1c1c"
  };
  function ocbfIsLight() {
    try {
      const host = document.body || document.documentElement;
      const p = document.createElement("div");
      p.style.cssText = "background:var(--default-bg-panel-color,#2e2f33);display:none";
      host.appendChild(p);
      const c = getComputedStyle(p).backgroundColor;
      p.remove();
      const m = c && c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?/i);
      if (!m) return false;
      if (m[4] !== undefined && +m[4] < .5) return false;
      return (.299 * +m[1] + .587 * +m[2] + .114 * +m[3]) > 140
    } catch (e) {
      return false
    }
  }
  let ocbfThemeLight = null;
  function applyTheme() {
    const light = ocbfIsLight();
    if (light === ocbfThemeLight) return;
    ocbfThemeLight = light;
    const map = light ? LIGHT_TOKENS : DARK_TOKENS;
    const root = document.documentElement;
    for (const k in map) root.style.setProperty(k, map[k])
  }
  let ocbfThemeObs = null;
  function watchTheme() {
    applyTheme();
    if (ocbfThemeObs) return;
    let t = 0;
    ocbfThemeObs = new MutationObserver(() => {
      if (t) return;
      t = setTimeout(() => {
        t = 0;
        applyTheme()
      }, 150)
    });
    const opt = {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"]
    };
    try {
      ocbfThemeObs.observe(document.documentElement, opt);
      if (document.body) ocbfThemeObs.observe(document.body, opt)
    } catch (e) {}
  }
  const T = {
    bg: "var(--default-bg-panel-color, #2e2f33)",
    text: "var(--default-color, #d4d4d4)",
    sub: "var(--ocbf-sub, #9aa0a6)",
    border: "var(--ocbf-border, rgba(0,0,0,.4))",
    divider: "var(--ocbf-border, var(--default-panel-divider-color, rgba(255,255,255,.08)))"
  };

  function injectPanelStyle() {
    if (document.getElementById("ocbf-style")) return;
    const st = document.createElement("style");
    st.id = "ocbf-style";
    st.textContent = `#ocbf-panel{font:13px/1.45 Arial,Helvetica,sans-serif;user-select:none;scrollbar-width:thin;scrollbar-color:var(--ocbf-hi3) var(--ocbf-hi1)}#ocbf-panel ::-webkit-scrollbar,#ocbf-panel::-webkit-scrollbar,.ocbf-scroll ::-webkit-scrollbar,.ocbf-scroll::-webkit-scrollbar{width:9px;height:9px}#ocbf-panel ::-webkit-scrollbar-track,#ocbf-panel::-webkit-scrollbar-track,.ocbf-scroll ::-webkit-scrollbar-track,.ocbf-scroll::-webkit-scrollbar-track{background:var(--ocbf-hi1);border-radius:5px}#ocbf-panel ::-webkit-scrollbar-thumb,#ocbf-panel::-webkit-scrollbar-thumb,.ocbf-scroll ::-webkit-scrollbar-thumb,.ocbf-scroll::-webkit-scrollbar-thumb{background:var(--ocbf-hi3);border-radius:5px}#ocbf-panel ::-webkit-scrollbar-thumb:hover,#ocbf-panel::-webkit-scrollbar-thumb:hover,.ocbf-scroll ::-webkit-scrollbar-thumb:hover,.ocbf-scroll::-webkit-scrollbar-thumb:hover{background:var(--ocbf-hi3)}.ocbf-scroll{scrollbar-width:thin;scrollbar-color:var(--ocbf-hi3) var(--ocbf-hi1);touch-action:pan-y;-webkit-overflow-scrolling:touch}#ocbf-panel input[type=range]{-webkit-appearance:none;appearance:none;width:92px;height:16px;background:transparent;cursor:pointer;touch-action:none;margin:0;vertical-align:middle}#ocbf-panel input[type=range]:focus{outline:none}#ocbf-panel input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:3px;background:var(--ocbf-hi3)}#ocbf-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.6);box-shadow:0 1px 2px rgba(0,0,0,.5)}#ocbf-panel input[type=range]::-moz-range-track{height:4px;border-radius:3px;background:var(--ocbf-hi3)}#ocbf-panel input[type=range]::-moz-range-thumb{width:14px;height:14px;border:1px solid rgba(0,0,0,.6);border-radius:50%;background:var(--ocbf-ctl-text)}#ocbf-panel table{width:100%;border-collapse:collapse;font-size:12px}#ocbf-panel th{position:sticky;top:34px;background:var(--ocbf-ctl-bg);text-align:left;padding:5px 6px;font-weight:700;color:${T.sub};white-space:nowrap;z-index:1}#ocbf-panel td{padding:4px 6px;border-top:1px solid ${T.divider}}#ocbf-panel table tr:nth-child(even){background:var(--ocbf-hi1)}#ocbf-panel table tbody:hover,#ocbf-panel table tr:hover{background:var(--ocbf-hi2)}.ocbf-ctl{background:var(--ocbf-ctl-bg);color:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.5);border-radius:4px;padding:0 8px;height:28px;cursor:pointer;font-size:12px}.ocbf-ctl:hover{background:var(--ocbf-hi2)}.ocbf-icon{width:30px;padding:0;display:inline-flex;align-items:center;justify-content:center}.ocbf-seg{display:inline-flex;border:0.5px solid var(--ocbf-border);border-radius:8px;overflow:hidden;background:var(--ocbf-hi1)}.ocbf-segbtn{width:34px;height:30px;padding:0;border:none;border-right:0.5px solid var(--ocbf-border);background:transparent;color:var(--ocbf-ctl-text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.ocbf-segbtn:last-child{border-right:none}.ocbf-segbtn:hover{background:var(--ocbf-hi2);color:var(--ocbf-ctl-text)}.ocbf-segbtn:active{background:var(--ocbf-hi3)}#ocbf-dir{-webkit-appearance:none;appearance:none;background-color:var(--ocbf-ctl-bg);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0l5 6 5-6z' fill='%23999999'/></svg>");background-repeat:no-repeat;background-position:right 8px center;padding-right:24px}#ocbf-dir option{background:#2e2f33;color:#eaeaea}#ocbf-dir option:checked{background:#1f6feb;color:#fff}#ocbf-panel .ocbf-lab{font-size:11px;color:var(--ocbf-ctl-text);display:flex;align-items:center;gap:4px}input.ocbf-num{min-height:28px;box-sizing:border-box} #ocbf-panel .ocbf-head{cursor:grab} #ocbf-panel.ocbf-dragging .ocbf-head{cursor:grabbing} .ocbf-x{width:24px;height:24px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;background:transparent;color:var(--ocbf-titletext);opacity:.85;cursor:pointer;font-size:18px;line-height:1;border-radius:5px} .ocbf-x:hover{opacity:1;background:var(--ocbf-hi2)}@media (max-width:640px){.ocbf-ctl{height:38px;font-size:14px;padding:0 12px}.ocbf-icon{width:42px}.ocbf-segbtn{width:44px;height:38px}#ocbf-panel .ocbf-lab{font-size:13px}#ocbf-panel input[type=range]{height:38px}#ocbf-panel input[type=checkbox]{width:22px;height:22px}input.ocbf-num{min-height:40px;font-size:16px;width:100%!important}}`;
    (document.head || document.documentElement).append(st)
  }

  function buildPanel() {
    if ($("#ocbf-panel")) return;
    injectPanelStyle();
    const panel = el("div", {
      id: "ocbf-panel",
      style: `position:fixed;right:18px;bottom:64px;width:360px;max-width:94vw;overflow:hidden;z-index:99998;background:${T.bg};color:${T.text};border:1px solid ${T.border};border-radius:5px;box-shadow:0 6px 24px rgba(0,0,0,.55);display:none`
    });
    const header = el("div", {
      className: "ocbf-head",
      style: `position:sticky;top:0;z-index:2;background:var(--ocbf-titlebg);color:var(--ocbf-titletext);border-radius:5px 5px 0 0;border-bottom:1px solid rgba(0,0,0,.5);touch-action:none`
    });
    const row1 = el("div", {
      style: "display:flex;align-items:center;gap:8px;padding:6px 10px"
    });
    row1.append(el("span", {
      style: "flex:0 0 auto;display:inline-flex;align-items:baseline;gap:5px"
    }, el("b", {
      textContent: "OC Best-Fit",
      style: "font-size:13px;text-shadow:0 1px 1px rgba(0,0,0,.6)"
    }), el("span", {
      textContent: "v" + VERSION,
      style: "font-size:10px;opacity:.65",
      title: "Script version"
    })));
    const dir = el("select", {
      id: "ocbf-dir",
      className: "ocbf-ctl",
      style: "flex:1"
    });
    for (const [k, v] of Object.entries(DIRECTIONS)) dir.append(el("option", {
      value: k,
      textContent: v
    }));
    dir.value = state.direction;
    dir.addEventListener("change", () => {
      state.direction = dir.value;
      render();
      paintNative();
      paintCrimeSuccess();
      updateTabLabel()
    });
    row1.append(dir);
    const closeBtn = el("button", {
      className: "ocbf-x",
      title: "Close",
      innerHTML: "&times;"
    });
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      closePanel()
    });
    row1.append(closeBtn);
    const row2 = el("div", {
      style: "display:flex;align-items:center;gap:12px;padding:0 10px 8px;flex-wrap:wrap"
    });
    const floorWrap = el("label", {
      className: "ocbf-lab",
      title: "Hide any role scoring below this success %"
    });
    const floor = el("input", {
      type: "range",
      min: "0",
      max: "100",
      value: "0"
    });
    const floorVal = el("span", {
      textContent: "0",
      style: "display:inline-block;min-width:26px;text-align:right"
    });
    floor.addEventListener("input", () => {
      state.floor = +floor.value;
      floorVal.textContent = floor.value;
      render()
    });
    floorWrap.append("min score", floor, floorVal);
    row2.append(floorWrap);
    const itemWrap = el("label", {
      className: "ocbf-lab",
      title: "Some roles need an item you may not have. Tick to hide roles you can't fill."
    });
    const itemChk = el("input", {
      type: "checkbox"
    });
    itemChk.addEventListener("change", () => {
      state.hideNoItem = itemChk.checked;
      render()
    });
    itemWrap.append(itemChk, "only roles I can fill");
    row2.append(itemWrap);
    row2.append(el("span", {
      style: "flex:1"
    }));
    const IC_INFO = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.7" fill="currentColor" stroke="none"/></svg>';
    const IC_REFRESH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
    const IC_GEAR = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    const info = el("button", {
      title: "About / sources",
      className: "ocbf-segbtn"
    });
    info.innerHTML = IC_INFO;
    info.addEventListener("click", aboutModal);
    const refresh = el("button", {
      title: "Reload data",
      className: "ocbf-segbtn"
    });
    refresh.innerHTML = IC_REFRESH;
    refresh.addEventListener("click", () => load(true));
    const cog = el("button", {
      title: "Settings",
      className: "ocbf-segbtn"
    });
    cog.innerHTML = IC_GEAR;
    cog.addEventListener("click", openSettings);
    row2.append(el("div", {
      className: "ocbf-seg"
    }, info, refresh, cog));
    header.append(row1, row2);
    panel.append(header);
    panel.append(el("div", {
      id: "ocbf-body",
      className: "ocbf-scroll",
      style: "padding:10px;max-height:50vh;overflow-y:auto;overflow-x:hidden"
    }, el("div", {
      textContent: "Loading...",
      style: `color:${T.sub}`
    })));
    (document.body || document.documentElement).append(panel);
    makeDraggable(panel, header);
    window.addEventListener("resize", () => {
      if (panel.style.display !== "none") {
        if (!onPhone()) clampPanel(panel);
        sizePanel(panel)
      }
    })
  }
  const GEAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="#a5d8ff"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.34 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.46 14.5a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96a7 7 0 0 0 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64ZM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z"/></svg>';
  let nativeActiveClass = "";
  let panelOnToggle = null,
    docClickHandler = null,
    scrollBlocker = null;

  function lockBg(on) {
    if (on) {
      if (scrollBlocker) return;
      scrollBlocker = e => {
        if (e.target.closest && e.target.closest("#ocbf-panel,.ocbf-scroll")) return;
        e.preventDefault()
      };
      document.addEventListener("touchmove", scrollBlocker, {
        passive: false
      })
    } else if (scrollBlocker) {
      document.removeEventListener("touchmove", scrollBlocker, {
        passive: false
      });
      scrollBlocker = null
    }
  }

  function savePanelPos(panel) {
    GM_setValue(POS_STORE, {
      left: parseInt(panel.style.left) || 0,
      top: parseInt(panel.style.top) || 0
    })
  }

  function sizePanel(panel) {
    const phone = onPhone();
    if (!phone) {
      panel.style.width = Math.min(360, window.innerWidth - 16) + "px";
      panel.style.maxWidth = "none"
    }
    const top = parseInt(panel.style.top) || 8;
    const avail = phone ? Math.round(window.innerHeight * 0.8) : Math.min(Math.max(160, window.innerHeight - top - 8), Math.round(window.innerHeight * 0.7));
    panel.style.maxHeight = avail + "px";
    const header = panel.firstChild,
      body = $("#ocbf-body", panel);
    const hH = header && header.offsetHeight || 0;
    if (body) body.style.maxHeight = Math.max(120, avail - hH - 4) + "px"
  }

  function clampPanel(panel) {
    const maxX = Math.max(0, window.innerWidth - panel.offsetWidth),
      maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
    let left = parseInt(panel.style.left),
      top = parseInt(panel.style.top);
    if (isNaN(left)) left = maxX;
    if (isNaN(top)) top = maxY;
    panel.style.left = Math.max(0, Math.min(left, maxX)) + "px";
    panel.style.top = Math.max(0, Math.min(top, maxY)) + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto"
  }

  function makeDraggable(panel, handle) {
    let sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      dragging = false;
    const move = e => {
      if (!dragging) return;
      const maxX = Math.max(0, window.innerWidth - panel.offsetWidth),
        maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = Math.max(0, Math.min(ox + (e.clientX - sx), maxX)) + "px";
      panel.style.top = Math.max(0, Math.min(oy + (e.clientY - sy), maxY)) + "px"
    };
    let pid = null;
    const up = () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("ocbf-dragging");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      if (pid != null) {
        try {
          handle.releasePointerCapture(pid)
        } catch (e) {}
        pid = null
      }
      savePanelPos(panel)
    };
    handle.addEventListener("pointerdown", e => {
      if (e.target.closest("button,select,input,a,.ocbf-x")) return;
      const r = panel.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      sx = e.clientX;
      sy = e.clientY;
      dragging = true;
      pid = e.pointerId;
      try {
        handle.setPointerCapture(pid)
      } catch (e) {}
      panel.classList.add("ocbf-dragging");
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
      e.preventDefault()
    })
  }

  function closePanel() {
    const panel = $("#ocbf-panel");
    if (!panel || panel.style.display === "none") return;
    panel.style.display = "none";
    closeDetail();
    lockBg(false);
    if (docClickHandler) {
      document.removeEventListener("click", docClickHandler, true);
      docClickHandler = null
    }
    if (panelOnToggle) panelOnToggle(false)
  }
  const tabLabel = () => getKey() ? `CPR Preset: ${DIRECTIONS[state.direction]||state.direction}` : "Set your API key";
  const crimeTabLabel = () => getKey() ? DIRECTIONS[state.direction] || state.direction : "Set key";

  function updateTabLabel() {
    const sp = document.querySelector('#ocbf-tab [class*="tabName___"]');
    if (sp && sp.textContent !== tabLabel()) sp.textContent = tabLabel();
    const ct = document.querySelector("#ocbf-crimetab .ocbf-tab-label");
    if (ct && ct.textContent !== crimeTabLabel()) ct.textContent = crimeTabLabel()
  }

  function injectTabButton() {
    const container = document.querySelector('[class*="buttonsContainer___"]');
    if (!container || container.querySelector("#ocbf-tab")) return;
    const sample = container.querySelector("button");
    if (!sample) return;
    const act = container.querySelector('[class*="active___"]');
    if (act) nativeActiveClass = (act.className.match(/active___\w+/) || [""])[0];
    const iconCont = sample.querySelector('[class*="iconContainer___"]')?.className || "";
    const iconWrap = sample.querySelector('[class*="iconWrapper___"]')?.className || "";
    const nameCls = sample.querySelector('[class*="tabName___"]')?.className || "";
    const baseClass = sample.className.replace(/\s*active___\w+/g, "").trim();
    const btn = document.createElement("button");
    btn.id = "ocbf-tab";
    btn.type = "button";
    btn.className = baseClass;
    btn.innerHTML = `<span class="${iconCont}"><span class="${iconWrap}">${GEAR_SVG}</span></span><span class="${nameCls}">${tabLabel()}</span>`;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      openPanelFrom(btn, open => {
        if (nativeActiveClass) btn.classList.toggle(nativeActiveClass, open)
      })
    });
    container.appendChild(btn)
  }

  function openPanelFrom(anchor, onToggle) {
    const panel = $("#ocbf-panel");
    if (!panel) return;
    panelOnToggle = onToggle;
    if (panel.style.display !== "none") {
      closePanel();
      return
    }
    panel.style.display = "block";
    if (onToggle) onToggle(true);
    lockBg(true);
    if (onPhone()) {
      panel.style.left = "8px";
      panel.style.right = "8px";
      panel.style.top = "auto";
      panel.style.bottom = "8px";
      panel.style.width = "auto";
      panel.style.maxWidth = "none"
    } else {
      const w = Math.min(360, window.innerWidth - 16);
      panel.style.width = w + "px";
      panel.style.maxWidth = "none";
      const saved = GM_getValue(POS_STORE, null);
      let left, top;
      if (saved && typeof saved.left === "number") {
        left = saved.left;
        top = saved.top
      } else {
        left = window.innerWidth - w - 18;
        top = 64
      }
      left = Math.max(0, Math.min(left, window.innerWidth - w));
      top = Math.max(0, Math.min(top, Math.max(0, window.innerHeight - 80)));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto"
    }
    sizePanel(panel);
    if (!state.slots.length) load(false);
    docClickHandler = ev => {
      const pop = document.getElementById("ocbf-pop");
      if (panel.contains(ev.target) || anchor.contains(ev.target) || pop && pop.contains(ev.target)) return;
      closePanel()
    };
    setTimeout(() => document.addEventListener("click", docClickHandler, true), 0)
  }

  function findCrimeTab() {
    const nodes = document.querySelectorAll('button, a, [role="tab"], div, li, span');
    for (const n of nodes) {
      if ((n.textContent || "").trim() !== "Completed") continue;
      const btn = n.closest && n.closest('button, [role="tab"], a') || n;
      const bar = btn.parentElement;
      if (!bar) continue;
      const txt = bar.textContent || "";
      if (/Recruiting/.test(txt) && /Planning/.test(txt) && /Completed/.test(txt)) return {
        btn: btn,
        bar: bar
      }
    }
    return null
  }

  function setCloneLabel(node, label) {
    let target = null;
    (function walk(x) {
      for (const c of x.children) walk(c);
      if (!target && x.children.length === 0 && (x.textContent || "").trim() === "Completed") target = x
    })(node);
    const el2 = target || node;
    el2.classList.add("ocbf-tab-label");
    el2.textContent = label
  }

  function injectCrimeTab() {
    if (document.getElementById("ocbf-crimetab")) return true;
    const found = findCrimeTab();
    if (!found) return false;
    const clone = found.btn.cloneNode(true);
    clone.id = "ocbf-crimetab";
    clone.removeAttribute("aria-selected");
    clone.removeAttribute("aria-controls");
    clone.removeAttribute("data-name");
    clone.className = (found.btn.className || "").replace(/\s*(active|selected)[^\s]*/gi, "").trim();
    setCloneLabel(clone, crimeTabLabel());
    clone.style.cursor = "pointer";
    clone.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      openPanelFrom(clone)
    }, true);
    found.bar.appendChild(clone);
    return true
  }

  function routeActive() {
    return /\/(factions|organizedcrimes)\.php/.test(location.pathname)
  }
  let armedLoad = true;

  function syncEntryButton() {
    if (!routeActive()) {
      document.getElementById("ocbf-tab")?.remove();
      document.getElementById("ocbf-crimetab")?.remove();
      armedLoad = true;
      return
    }
    const narrow = onPhone();
    if (narrow) {
      document.getElementById("ocbf-tab")?.remove();
      injectCrimeTab()
    } else {
      document.getElementById("ocbf-crimetab")?.remove();
      try {
        injectTabButton()
      } catch (e) {}
    }
    if (armedLoad && getKey()) {
      armedLoad = false;
      load(false)
    }
  }

  function setBody(msg) {
    const b = $("#ocbf-body");
    if (b) {
      b.textContent = "";
      b.append(el("div", {
        textContent: msg,
        style: "color:#8b949e"
      }))
    }
  }
  async function load(force) {
    const key = getKey();
    if (!key) {
      renderKeyPrompt();
      return
    }
    updateTabLabel();
    if (force) {
      try {
        healState()
      } catch (e) {}
      GM_setValue(META_STORE, {
        lastSync: 0
      })
    }
    setBody("Fetching your CPR...");
    try {
      state.slots = await fetchOpenSlots(key)
    } catch (e) {
      setBody("Error: " + e.message);
      return
    }
    logSnapshot(key, state.slots);
    if (force) state.snaps = null;
    try {
      setBody("Building faction success-rate table (first run can take a moment)...");
      state.hist = await getHistory(key, (p, a) => setBody(`Syncing history... page ${p} (+${a} new)`));
      const t = state.hist;
      state.histNote = t.pageError ? `History STALE - sync failed (${t.pageError}). Showing ${t.stored} crimes last synced ${new Date(t.builtAt).toLocaleString()}.` : `History OK (${t.source}): ${t.stored} local crimes - ${t.synced} new this sync - ${Object.keys(t.table).length} crime types - ${new Date(t.builtAt).toLocaleString()}.`
    } catch (e) {
      state.hist = null;
      state.histNote = "Success% / expected money unavailable - " + e.message;
      console.warn("ocbfhistory unavailable:", e.message)
    }
    try {
      state.weights = await getWeights(key)
    } catch (e) {
      console.warn("ocbfweights:", e.message)
    }
    try {
      state.community = await getCommunity(key)
    } catch (e) {
      console.warn("ocbfcommunity:", e.message)
    }
    pushWeights(key);
    try {
      await computeScores(key)
    } catch (e) {
      console.warn("ocbfscores:", e.message)
    }
    try {
      const rk = rank(applyFilters(score(state.slots, state.hist)), state.direction, selfScore());
      pushRec(key, recommend(rk, state.direction))
    } catch (e) {}
    render();
    paintNative();
    paintCrimeSuccess();
    if (window.__ocbfActivate) window.__ocbfActivate()
  }
  let booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    try {
      healState()
    } catch (e) {}
    try {
      watchTheme()
    } catch (e) {}
    try {
      loadStatic()
    } catch (e) {}
    setInterval(() => {
      try {
        syncEntryButton()
      } catch (e) {}
      if (IS_PDA) {
        try {
          paintNative()
        } catch (e) {}
        try {
          paintCrimeSuccess()
        } catch (e) {}
      }
    }, IS_PDA ? 1200 : 1500);
    try {
      buildPanel()
    } catch (e) {
      console.warn("ocbfbuildPanel:", e.message)
    }
    try {
      syncEntryButton()
    } catch (e) {
      console.warn("ocbfsyncEntryButton:", e.message)
    }
    try {
      let raf = 0;
      const obs = new MutationObserver(() => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          try {
            syncEntryButton()
          } catch (e) {}
          try {
            paintNative()
          } catch (e) {}
          try {
            paintCrimeSuccess()
          } catch (e) {}
        })
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true
      })
    } catch (e) {
      console.warn("ocbfobserver:", e.message)
    }
  }

  function bootWhenReady() {
    if (document.body && document.head) {
      boot();
      return
    }
    let tries = 0;
    const poll = setInterval(() => {
      if (document.body && document.head || ++tries > 200) {
        clearInterval(poll);
        boot()
      }
    }, 50);
    document.addEventListener("DOMContentLoaded", () => {
      clearInterval(poll);
      boot()
    }, {
      once: true
    })
  }
  bootWhenReady()
})();
(function ocbfRequirements() {
  "use strict";
  const WEIGHTS_API_URL = "https://tornprobability.com:3000/api/GetRoleWeights";
  window.__ocbfWeights = window.__ocbfWeights || {};
  let weightData = {};

  function injectNativeStyle() {
    if (document.getElementById("ocbf-native-style")) return;
    const style = document.createElement("style");
    style.id = "ocbf-native-style";
    style.textContent = `.oc-weight-box{margin-top:6px;padding:6px;text-align:center;border:1px solid var(--ocbf-border);border-radius:6px;background:var(--ocbf-hi1)}.oc-weight-box .oc-weight-label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.8;padding-bottom:3px;margin-bottom:4px;border-bottom:1px solid var(--ocbf-border)}.oc-weight-box .oc-weight-value{display:block;font-size:16px;font-weight:700;margin-top:2px}`;
    (document.head || document.documentElement).appendChild(style)
  }

  function init() {
    injectNativeStyle();
    injectStopSignPulse();
    installItemQuickLink();
    installPanelRequirements();
    fetchWeights()
  }

  function marketUrl(id) {
    return `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${id}`
  }

  function lookupItemId(crime, role) {
    const items = window.__ocbfStatic && window.__ocbfStatic.ocItems;
    if (!items) return null;
    const byCrime = items[crime];
    if (!byCrime) return null;
    return byCrime[role] != null ? byCrime[role] : null
  }

  function installItemQuickLink() {
    const wire = () => {
      if (!hasKey()) return;
      try {
        document.querySelectorAll('div[class*="slotIcon"] div[class*="inactive"]').forEach(iconBox => {
          if (iconBox.dataset.ocbfLinked) return;
          const btn = iconBox.closest("button");
          const card = iconBox.closest('[class*="contentLayer"]') || iconBox.closest("[data-oc-id]");
          const crime = card && card.querySelector('p[class*="panelTitle"]') ? card.querySelector('p[class*="panelTitle"]').textContent.trim() : null;
          const role = btn && btn.querySelector('span[class*="title"]') ? btn.querySelector('span[class*="title"]').textContent.trim() : null;
          if (!crime || !role) return;
          const id = lookupItemId(crime, role);
          if (id == null) return;
          iconBox.dataset.ocbfLinked = "1";
          iconBox.style.cursor = "pointer";
          iconBox.title = `Buy required item - ${crime} / ${role}`;
          iconBox.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            window.open(marketUrl(id), "_blank")
          }, true)
        })
      } catch (e) {}
    };
    wire();
    try {
      new MutationObserver(() => wire()).observe(document.body, {
        childList: true,
        subtree: true
      })
    } catch (e) {}
    setInterval(wire, 1500)
  }

  function injectStopSignPulse() {
    const ID = "ocbf-stopsign-pulse-style";
    if (document.getElementById(ID)) return;
    const style = document.createElement("style");
    style.id = ID;
    style.textContent = `\n      div[class*="slotIcon"] div[class*="inactive"] { animation:ocbf-stopsign-pulse 1s ease-in-out infinite; transform-origin:center; }\n      div[class*="slotIcon"] div[class*="inactive"] svg path { fill:#ff1f1f !important; stroke:#ff1f1f !important; }\n      @keyframes ocbf-stopsign-pulse { 0%{transform:scale(1);opacity:1;} 50%{transform:scale(1.35);opacity:.45;} 100%{transform:scale(1);opacity:1;} }\n    `;
    (document.head || document.documentElement).appendChild(style)
  }


  function normalizeKey(str) {
    return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  }

  function addWeightBoxes(ocRoot) {
    const ocNameEl = ocRoot.querySelector('p[class*="panelTitle"]');
    if (!ocNameEl) return;
    const ocKey = normalizeKey(ocNameEl.textContent.trim());
    const ocWeights = weightData[ocKey];
    if (!ocWeights) return;
    const roles = Array.from(ocRoot.querySelectorAll('div[class*="wrapper"]:not([data-oc-id])'));
    roles.forEach(role => {
      if (role.querySelector(".oc-weight-box")) return;
      const titleEl = role.querySelector('[class*="title"]:not([class*="panelTitle"])');
      if (!titleEl || titleEl.closest('div[class*="wrapper"]') !== role) return;
      const roleKey = normalizeKey(titleEl.textContent.trim());
      const weight = ocWeights[roleKey];
      if (weight == null) return;
      const box = document.createElement("div");
      box.className = "oc-weight-box";
      box.innerHTML = `<span class="oc-weight-label">Weight</span><span class="oc-weight-value">${weight.toFixed(1)}%</span>`;
      role.appendChild(box)
    })
  }

  function scanWeights() {
    document.querySelectorAll('div[class*="wrapper"][data-oc-id]').forEach(addWeightBoxes)
  }
  async function fetchWeights() {
    if (!hasKey()) return;
    try {
      const data = await gmGet(WEIGHTS_API_URL);
      weightData = {};
      for (const [ocName, roles] of Object.entries(data)) {
        const ocKey = normalizeKey(ocName);
        weightData[ocKey] = {};
        for (const [roleName, value] of Object.entries(roles)) weightData[ocKey][normalizeKey(roleName)] = value
      }
      window.__ocbfWeights = weightData;
      scanWeights()
    } catch (err) {
      console.error("ocbf weights:", err)
    }
  }

  function nodeTouchesPanelTitle(node) {
    if (!(node instanceof Element)) return false;
    const selectors = ['p[class*="panelTitle"]', 'span[class*="levelValue"]', 'div[class*="successChance"]', 'div[class*="wrapper"]'];
    return selectors.some(s => node.matches(s) || node.querySelector(s) !== null)
  }

  const hasKey = () => typeof window.__ocbfHasKey === "function" && window.__ocbfHasKey();
  let reqRender = null;

  function installPanelRequirements() {
    const render = () => {
      if (!hasKey()) return;
      scanWeights()
    };
    reqRender = render;
    render();
    let scheduleId = 0;
    const observer = new MutationObserver(mutations => {
      const shouldRender = mutations.some(m => [...m.addedNodes, ...m.removedNodes].some(n => nodeTouchesPanelTitle(n)));
      if (!shouldRender) return;
      if (scheduleId) return;
      scheduleId = window.setTimeout(() => {
        scheduleId = 0;
        render()
      }, 120)
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
  }
  window.__ocbfActivate = () => {
    fetchWeights();
    if (reqRender) reqRender()
  };
  let reqInited = false;

  function initWhenReady() {
    if (reqInited) return;
    if (!(document.body && document.head)) {
      let tries = 0;
      const poll = setInterval(() => {
        if (document.body && document.head || ++tries > 200) {
          clearInterval(poll);
          initWhenReady()
        }
      }, 50);
      document.addEventListener("DOMContentLoaded", () => {
        clearInterval(poll);
        initWhenReady()
      }, {
        once: true
      });
      return
    }
    reqInited = true;
    try {
      init()
    } catch (e) {
      console.warn("ocbfrequirements init:", e.message)
    }
  }
  initWhenReady()
})();
