// ==UserScript==
// @name         Torn — Ranked War Status
// @namespace    torn.thecovenant.rws
// @version      2.0.0
// @description  YATA-style ranked war target list on the war/rank tab: live hospital timers, life bars, dibs
// @author       The Covenant
// @match        https://www.torn.com/factions.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================
       CONFIG
    ========================================================== */

    const CONFIG = Object.freeze({
        API_KEY:     'rws_api_key_v1',
        MINIMIZED:   'rws_minimized_v1',
        CACHE_DATA:  'rws_cache_data_v1',
        CACHE_TIME:  'rws_cache_time_v1',
        DIBS:        'rws_dibs_v1',
        REFRESH_MS:  30 * 1000,
        FETCH_DELAY: 150,
        POLL_MS:     500,
    });

    const PANEL_ID  = 'rws-panel';
    const STYLE_ID  = 'rws-style';
    const API_BASE  = 'https://api.torn.com/v2/';
    const TORN_BASE = 'https://www.torn.com';

    /* =========================================================
       SVG ICONS
    ========================================================== */

    const SVG_REFRESH  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    const SVG_EXPAND   = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="16" viewBox="0 0 11 16" class="grayFill___tkuer"><path d="M1302,21l-5,5V16Z" transform="translate(-1294 -13)"/></svg>`;
    const SVG_COLLAPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" class="grayFill___tkuer"><path d="M1302,21l-5,5V16Z" transform="translate(29 -1294) rotate(90)"/></svg>`;

    /* =========================================================
       STYLES
    ========================================================== */

    const STYLES = `
    #rws-panel { margin-top: 14px; }
    #rws-panel .main___QuzF7 { background: var(--default-bg-panel-color); border-radius: 5px; }
    #rws-panel #rws-content { padding: 6px; background: var(--default-bg-panel-color); border: 1px solid var(--default-panel-divider-outer-side-color); border-top: none; border-radius: 0 0 6px 6px; }

    #rws-panel .header___f_BFs { background: linear-gradient(180deg,#555,#333) no-repeat; border-bottom: 2px solid transparent; border-radius: 5px 5px 0 0; display: flex; height: 34px; position: relative; align-items: center; padding: 0 8px; }
    #rws-panel .title___nIMRx  { align-self: center; color: #fff; font: 700 12px/14px Arial,sans-serif; margin-left: 10px; text-shadow: 0 0 2px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #rws-panel .icons___VmEI4  { margin-left: auto; display: flex; align-items: center; gap: 6px; }
    #rws-panel .icons___VmEI4 .button___MO5cW { background: transparent; border: 0; padding: 6px; line-height: 0; cursor: pointer; }
    #rws-panel .icons___VmEI4 .grayFill___tkuer { fill: #cfd6de; }
    #rws-panel .icons___VmEI4 .button___MO5cW:hover .grayFill___tkuer { fill: #fff; }

    #rws-panel .pills-row  { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; align-items: center; }
    #rws-panel .pills-right{ margin-left: auto; display: flex; gap: 6px; }
    #rws-panel .pill { display: inline-block; border: 1px solid var(--default-panel-divider-outer-side-color); border-radius: 999px; padding: 2px 9px; font-size: 11px; background: var(--default-bg-panel-active-color); color: var(--default-color); white-space: nowrap; }
    #rws-panel .pill a { color: var(--default-blue-color); text-decoration: underline; cursor: pointer; }
    #rws-panel .pill-score-mine  { color: #2b8a3e; font-weight: 700; }
    #rws-panel .pill-score-enemy { color: #c92a2a; font-weight: 700; }

    #rws-panel .btn-icon { width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--default-panel-divider-outer-side-color); border-radius: 4px; background: var(--default-bg-panel-active-color); cursor: pointer; color: var(--default-color); }
    #rws-panel .btn-icon:hover { background: var(--default-bg-panel-color); }
    #rws-panel .btn-icon svg { width: 14px; height: 14px; stroke: currentColor; fill: none; }
    #rws-panel .btn-icon[disabled] { opacity: .5; pointer-events: none; }

    #rws-panel .rws-card { border: 1px solid var(--default-panel-divider-outer-side-color); border-radius: 6px; overflow: hidden; }
    #rws-panel .rws-scroll { overflow-x: auto; }
    #rws-panel .rws-table { width: 100%; border-collapse: collapse; color: var(--default-color); min-width: 700px; }
    #rws-panel .rws-table th { background: var(--default-bg-panel-active-color); color: var(--default-color); opacity: .7; font: 700 10px/12px Arial; text-transform: uppercase; letter-spacing: .04em; padding: 6px 8px; text-align: center; white-space: nowrap; cursor: pointer; border-bottom: 1px solid var(--default-panel-divider-outer-side-color); user-select: none; position: sticky; top: 0; z-index: 1; }
    #rws-panel .rws-table th:hover { opacity: 1; }
    #rws-panel .rws-table th.sort-asc::after  { content: ' ▲'; font-size: 8px; }
    #rws-panel .rws-table th.sort-desc::after { content: ' ▼'; font-size: 8px; }
    #rws-panel .rws-table td { padding: 5px 8px; font-size: 11px; border-bottom: 1px solid var(--default-panel-divider-outer-side-color); text-align: center; vertical-align: middle; white-space: nowrap; }
    #rws-panel .rws-table tr:last-child td { border-bottom: none; }
    #rws-panel .rws-table tr:hover td { background: rgba(128,128,128,.07); }

    #rws-panel .rws-name-cell { display: flex; align-items: center; gap: 4px; justify-content: flex-start; }
    #rws-panel .rws-name-link { color: var(--default-blue-color, #5c9af5); text-decoration: none; max-width: 130px; overflow: hidden; text-overflow: ellipsis; display: inline-block; }
    #rws-panel .rws-name-link:hover { text-decoration: underline; }

    #rws-panel .rws-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    #rws-panel .dot-online  { background: #2b8a3e; }
    #rws-panel .dot-idle    { background: #e67700; }
    #rws-panel .dot-offline { background: #868e96; }

    #rws-panel .rws-bar { display: inline-block; width: 72px; height: 7px; background: rgba(128,128,128,.25); border-radius: 4px; overflow: hidden; vertical-align: middle; }
    #rws-panel .rws-fill { height: 100%; border-radius: 4px; transition: width .3s; }

    #rws-panel .st-ok     { color: #2b8a3e; }
    #rws-panel .st-hosp   { color: #e03131; }
    #rws-panel .st-jail   { color: #e67700; }
    #rws-panel .st-travel { color: #1971c2; }
    #rws-panel .st-other  { color: var(--default-color); opacity: .6; }

    #rws-panel .rws-dibs { background: none; border: 1px solid var(--default-panel-divider-outer-side-color); color: var(--default-color); opacity: .6; padding: 2px 8px; border-radius: 99px; cursor: pointer; font-size: 10px; transition: all .1s; }
    #rws-panel .rws-dibs:hover { opacity: 1; border-color: #c92a2a; color: #c92a2a; }
    #rws-panel .rws-dibs.claimed { border-color: #c92a2a; color: #c92a2a; opacity: 1; background: rgba(201,42,42,.1); font-weight: 700; }
    #rws-panel .rws-atk { display: inline-block; background: #c92a2a; color: #fff; border: none; padding: 3px 10px; border-radius: 3px; font-size: 10px; font-weight: 700; text-decoration: none; cursor: pointer; }
    #rws-panel .rws-atk:hover { background: #a61e1e; }

    #rws-panel .rws-empty { text-align: center; padding: 20px 12px; color: #868e96; font-size: 11px; }
    #rws-panel .status-pill { display: none; }
    #rws-panel .status-pill.visible { display: inline-block; }
    #rws-panel .status-err  { color: #c92a2a; }
    #rws-panel .status-info { color: var(--default-color); opacity: .7; }
    `;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = STYLES;
        document.head.appendChild(s);
    }

    /* =========================================================
       STORAGE
    ========================================================== */

    function getApiKey() {
        try { const k = String(GM_getValue(CONFIG.API_KEY, '')).trim(); if (k) return k; } catch {}
        try { return String(localStorage.getItem(CONFIG.API_KEY) || '').trim(); } catch {}
        return '';
    }

    function setApiKey(k) {
        const v = k.trim();
        try { GM_setValue(CONFIG.API_KEY, v); } catch {}
        try { localStorage.setItem(CONFIG.API_KEY, v); } catch {}
        updateKeyPill();
    }

    function getDibs() {
        try { return JSON.parse(GM_getValue(CONFIG.DIBS, '{}')); } catch { return {}; }
    }

    function setDibs(d) {
        try { GM_setValue(CONFIG.DIBS, JSON.stringify(d)); } catch {}
    }

    function saveCache(war, members) {
        try {
            GM_setValue(CONFIG.CACHE_DATA, JSON.stringify({ war, members }));
            GM_setValue(CONFIG.CACHE_TIME, Date.now());
        } catch {}
    }

    function loadCache() {
        try {
            const raw  = GM_getValue(CONFIG.CACHE_DATA, null);
            const time = Number(GM_getValue(CONFIG.CACHE_TIME, 0));
            if (!raw) return null;
            return { ...JSON.parse(raw), time };
        } catch { return null; }
    }

    /* =========================================================
       MENU COMMANDS
    ========================================================== */

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand('Set API Key',   promptForKey);
        GM_registerMenuCommand('Force Refresh', () => load(true));
    }

    function promptForKey() {
        const cur = getApiKey();
        const next = prompt('Ranked War Status\n\nPaste your Torn API key (Full Access recommended):', cur);
        if (next === null) return;
        if (!next.trim()) { alert('No key entered.'); return; }
        setApiKey(next.trim());
        load(true);
    }

    /* =========================================================
       TORN API
    ========================================================== */

    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method:    'GET',
                url:       url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now(),
                timeout:   20000,
                onload:    r  => resolve(r),
                onerror:   () => reject(new Error('Network error.')),
                ontimeout: () => reject(new Error('Request timed out.')),
            });
        });
    }

    const TORN_ERRORS = {
        1: 'Empty key — set your API key.',
        2: 'Incorrect key — invalid API key.',
        3: 'Wrong key type — needs Public or higher access.',
        5: 'Rate limited — too many requests.',
        7: 'IP blocked by Torn.',
        11: 'Access level too low — enable Faction access in your API key settings.',
    };

    function parseResponse(raw, label) {
        let json;
        try { json = JSON.parse(String(raw || '').trim()); }
        catch { throw new Error(`Could not parse ${label} response.`); }
        if (json.error) {
            const code = json.error.code ?? json.error;
            throw new Error(`${label}: ${TORN_ERRORS[code] || 'Torn API error ' + code}`);
        }
        return json;
    }

    function apiGet(path) {
        const key = getApiKey();
        if (!key) return Promise.reject(new Error('No API key set.'));
        return gmFetch(API_BASE + path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key))
            .then(r => parseResponse(r.responseText, path.split('/')[0]));
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /* =========================================================
       DATA FETCHING
    ========================================================== */

    async function getMyFactionId() {
        const d = await apiGet('user/faction');
        // API v2 returns faction.id (not faction.faction_id)
        const fid = d.faction?.id ?? d.faction?.faction_id ?? null;
        if (!fid) throw new Error('Could not read faction ID. Check API key has Faction access.');
        return fid;
    }

    async function getActiveRankedWar(myFid) {
        const d  = await apiGet('faction/wars');
        const rw = d.wars?.ranked;
        if (!rw) return null;
        const war = Array.isArray(rw) ? rw[0] : rw;
        if (!war) return null;

        // API v2 returns factions as an array [{id, name, score, chain}, ...]
        const factionsArr   = Array.isArray(war.factions)
            ? war.factions
            : Object.values(war.factions || {});
        const myFaction     = factionsArr.find(f => (f.id ?? f.faction_id) === myFid);
        const enemyFaction  = factionsArr.find(f => (f.id ?? f.faction_id) !== myFid);
        if (!enemyFaction) return null;

        return {
            warId:   war.war_id,
            start:   war.start,
            target:  war.target,
            mine:    myFaction    || {},
            enemy:   enemyFaction || {},
            enemyId: enemyFaction.id ?? enemyFaction.faction_id,
        };
    }

    async function getEnemyMembers(fid) {
        const d   = await apiGet(`faction/${fid}/members`);
        const raw = d.members;
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        return Object.entries(raw).map(([id, m]) => ({ ...m, id: Number(id) }));
    }

    async function getProfile(uid) {
        try { return await apiGet(`user/${uid}/profile`); }
        catch { return null; }
    }

    /* =========================================================
       FORMAT HELPERS
    ========================================================== */

    function hms(s) {
        if (s <= 0) return '0:00';
        const h  = Math.floor(s / 3600);
        const m  = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        const p  = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
    }

    function ago(ts) {
        if (!ts) return '—';
        const s = Math.floor(Date.now() / 1000) - ts;
        if (s < 60)    return s + 's ago';
        if (s < 3600)  return Math.floor(s / 60)   + 'm ago';
        if (s < 86400) return Math.floor(s / 3600)  + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
    }

    function statusInfo(st, now) {
        if (!st) return { text: '—', cls: 'st-other', until: 0 };
        const rem = (st.until || 0) - now;
        switch (st.state) {
            case 'Hospital': return rem > 0
                ? { text: 'H for ' + hms(rem), cls: 'st-hosp',   until: st.until }
                : { text: 'Okay',               cls: 'st-ok',     until: 0 };
            case 'Jail':     return rem > 0
                ? { text: 'J for ' + hms(rem), cls: 'st-jail',   until: st.until }
                : { text: 'Okay',               cls: 'st-ok',     until: 0 };
            case 'Federal':  return { text: 'Federal',   cls: 'st-jail',   until: st.until || 0 };
            case 'Dead':     return { text: 'Dead',       cls: 'st-hosp',   until: 0 };
            case 'Abroad':
            case 'Traveling': return { text: 'Traveling', cls: 'st-travel', until: 0 };
            default:         return { text: 'Okay',       cls: 'st-ok',     until: 0 };
        }
    }

    function lifeColor(pct) {
        if (pct < 25) return '#e03131';
        if (pct < 60) return '#e67700';
        return '#1971c2';
    }

    /* =========================================================
       APP STATE
    ========================================================== */

    const S = {
        war:      null,
        members:  [],
        loading:  false,
        sortCol:  'status',
        sortAsc:  true,
    };

    /* =========================================================
       LOAD / REFRESH
    ========================================================== */

    let _refreshTimer = null;

    async function load(force = false) {
        if (S.loading) return;
        if (!getApiKey()) { promptForKey(); return; }

        S.loading = true;
        setStatus('loading', 'Loading…');

        try {
            const myFid = await getMyFactionId();
            const war   = await getActiveRankedWar(myFid);
            S.war = war;
            renderMeta();

            if (!war) {
                S.members = [];
                renderTable();
                setStatus('info', 'No active ranked war found.');
                S.loading = false;
                return;
            }

            setStatus('info', 'Fetching members…');
            const rawMembers = await getEnemyMembers(war.enemyId);

            S.members = rawMembers.map(m => ({
                id:          m.id ?? m.user_id,
                name:        m.name        || null,
                level:       m.level       || null,
                status:      m.status      || null,
                last_action: m.last_action || null,
                life:        m.life        || null,
                travel:      m.travel      || null,
                profileTs:   null,
            })).filter(m => m.id);

            renderTable();
            updateLastRefreshed(Date.now());

            // Enrich with full profile for up-to-date status/life/travel
            for (let i = 0; i < S.members.length; i++) {
                const m = S.members[i];
                setStatus('info', `Updating profiles… ${i + 1}/${S.members.length}`);
                const p = await getProfile(m.id);
                if (p) {
                    m.level       = p.level       ?? m.level;
                    m.status      = p.status      ?? m.status;
                    m.last_action = p.last_action ?? m.last_action;
                    m.life        = p.life        ?? m.life;
                    m.travel      = p.travel      ?? m.travel;
                    m.profileTs   = Date.now();
                }
                renderTable();
                if (i < S.members.length - 1) await sleep(CONFIG.FETCH_DELAY);
            }

            saveCache(war, S.members);
            updateLastRefreshed(Date.now());
            setStatus('ok');

        } catch (e) {
            const cache = loadCache();
            if (cache && cache.war && cache.members) {
                S.war     = cache.war;
                S.members = cache.members;
                renderMeta();
                renderTable();
                updateLastRefreshed(cache.time);
            }
            setStatus('error', e.message);
            console.error('[RWS]', e);
        }

        S.loading = false;
    }

    function startAutoRefresh() {
        clearInterval(_refreshTimer);
        _refreshTimer = setInterval(() => {
            const panel = document.getElementById(PANEL_ID);
            if (panel && !panel.hidden && isWarRankPage()) load(false);
        }, CONFIG.REFRESH_MS);
    }

    /* =========================================================
       PANEL DOM
    ========================================================== */

    function createPanel() {
        if (document.getElementById(PANEL_ID)) return true;

        // Injection target: after the faction nav tabs
        const tabs = document.querySelector('#factions ul.faction-tabs, ul.faction-tabs');
        if (!tabs) return false;

        let minimized = false;
        try { minimized = !!GM_getValue(CONFIG.MINIMIZED, false); } catch {}

        const hasKey = !!getApiKey();

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'equipped-items-wrap';

        panel.innerHTML = `
<div class="main___QuzF7">
  <header class="header___f_BFs">
    <p class="title___nIMRx" role="heading" aria-level="2">&#9876; Ranked War Status</p>
    <nav class="icons___VmEI4">
      <button type="button" class="button___MO5cW btn-icon" id="rws-refresh-btn" title="Refresh" disabled>${SVG_REFRESH}</button>
      <button type="button" class="button___MO5cW iconParentButton___POutJ" id="rws-min-btn"
              aria-label="${minimized ? 'Open' : 'Collapse'}" aria-expanded="${!minimized}">
        ${minimized ? SVG_EXPAND : SVG_COLLAPSE}
      </button>
    </nav>
  </header>
  <div class="content___Gb8DR" id="rws-content" ${minimized ? 'hidden' : ''}>
    <div class="pills-row" id="rws-pills">
      <span class="pill" id="rws-key-pill">API key: <strong>${hasKey ? 'set' : 'not set'}</strong> &middot; <a id="rws-key-edit">${hasKey ? 'edit' : 'set'}</a></span>
      <span class="pill status-pill" id="rws-status-pill"></span>
      <span class="pill status-pill" id="rws-refresh-pill"></span>
      <span class="pills-right">
        <button type="button" class="btn-icon" id="rws-update-btn" title="Update targets" disabled>${SVG_REFRESH}</button>
      </span>
    </div>
    <div id="rws-meta-pills" class="pills-row" style="display:none"></div>
    <div class="rws-card">
      <div class="rws-scroll">
        <table class="rws-table" id="rws-table">
          <thead><tr>
            <th data-col="name"        style="text-align:left; min-width:150px">Name</th>
            <th data-col="level"       style="width:40px">Lvl</th>
            <th data-col="str"         style="width:36px">Str</th>
            <th data-col="def"         style="width:36px">Def</th>
            <th data-col="spe"         style="width:36px">Spe</th>
            <th data-col="dex"         style="width:36px">Dex</th>
            <th data-col="tot"         style="width:44px">Tot</th>
            <th data-col="last_action" style="width:90px">Last Action</th>
            <th data-col="online"      style="width:22px" title="Online status">&bull;</th>
            <th data-col="flag"        style="width:22px" title="Location">&#9992;</th>
            <th data-col="life"        style="width:90px">Life</th>
            <th data-col="status"      style="width:100px">Status</th>
            <th data-col="update"      style="width:64px">Update</th>
            <th data-col="dibs"        style="width:60px">Dibs</th>
            <th                        style="width:36px">A</th>
          </tr></thead>
          <tbody id="rws-tbody">
            <tr><td colspan="15" class="rws-empty">Click Refresh to load war data.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;

        tabs.after(panel);

        // Wire events
        document.getElementById('rws-key-edit').addEventListener('click', promptForKey);

        document.getElementById('rws-min-btn').addEventListener('click', () => {
            const content = document.getElementById('rws-content');
            const btn     = document.getElementById('rws-min-btn');
            const isMin   = !content.hasAttribute('hidden');
            if (isMin) {
                content.setAttribute('hidden', '');
                btn.innerHTML = SVG_EXPAND;
                btn.setAttribute('aria-label', 'Open');
                btn.setAttribute('aria-expanded', 'false');
            } else {
                content.removeAttribute('hidden');
                btn.innerHTML = SVG_COLLAPSE;
                btn.setAttribute('aria-label', 'Collapse');
                btn.setAttribute('aria-expanded', 'true');
            }
            try { GM_setValue(CONFIG.MINIMIZED, isMin); } catch {}
        });

        const onRefresh = () => load(true);
        document.getElementById('rws-refresh-btn').addEventListener('click', onRefresh);
        document.getElementById('rws-update-btn').addEventListener('click', onRefresh);

        // Column sort
        document.querySelectorAll('#rws-table th[data-col]').forEach(th => {
            th.addEventListener('click', () => {
                const c = th.dataset.col;
                if (S.sortCol === c) S.sortAsc = !S.sortAsc;
                else { S.sortCol = c; S.sortAsc = true; }
                updateSortHeaders();
                renderTable();
            });
        });

        return true;
    }

    /* =========================================================
       STATUS / PILLS
    ========================================================== */

    function setStatus(state, msg) {
        const pill    = document.getElementById('rws-status-pill');
        const refBtn  = document.getElementById('rws-refresh-btn');
        const updBtn  = document.getElementById('rws-update-btn');
        if (!pill) return;

        pill.className = 'pill status-pill';
        if (state === 'ok') {
            pill.classList.remove('visible');
            [refBtn, updBtn].forEach(b => b && (b.disabled = false));
        } else if (state === 'loading') {
            pill.classList.add('visible', 'status-info');
            pill.textContent = msg || 'Loading…';
            [refBtn, updBtn].forEach(b => b && (b.disabled = true));
        } else if (state === 'info') {
            pill.classList.add('visible', 'status-info');
            pill.textContent = msg;
        } else if (state === 'error') {
            pill.classList.add('visible', 'status-err');
            pill.textContent = msg;
            [refBtn, updBtn].forEach(b => b && (b.disabled = false));
        }
    }

    function updateKeyPill() {
        const pill = document.getElementById('rws-key-pill');
        if (!pill) return;
        const hasKey = !!getApiKey();
        pill.innerHTML = `API key: <strong>${hasKey ? 'set' : 'not set'}</strong> &middot; <a id="rws-key-edit">${hasKey ? 'edit' : 'set'}</a>`;
        document.getElementById('rws-key-edit')?.addEventListener('click', promptForKey);
    }

    function updateLastRefreshed(ts) {
        const pill = document.getElementById('rws-refresh-pill');
        if (!pill || !ts) return;
        const t = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        pill.textContent = `Updated ${t}`;
        pill.classList.add('visible', 'status-info');
    }

    function updateSortHeaders() {
        document.querySelectorAll('#rws-table th[data-col]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.col === S.sortCol) {
                th.classList.add(S.sortAsc ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    /* =========================================================
       META PILLS (war info bar)
    ========================================================== */

    function renderMeta() {
        const el = document.getElementById('rws-meta-pills');
        if (!el) return;
        if (!S.war) { el.style.display = 'none'; return; }
        const w  = S.war;
        const dt = new Date((w.start || 0) * 1000);
        const ds = dt.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

        el.innerHTML =
            `<span class="pill">Faction: <a href="${TORN_BASE}/factions.php?step=profile&ID=${w.enemyId}" target="_blank">${w.enemy.name || '?'} [${w.enemyId}]</a></span>` +
            `<span class="pill">Start: <strong>${ds}</strong></span>` +
            `<span class="pill">Target: <strong>${Number(w.target || 0).toLocaleString()}</strong></span>` +
            `<span class="pill">Score: <span class="pill-score-mine">${Number(w.mine.score || 0).toLocaleString()}</span> &nbsp;vs&nbsp; <span class="pill-score-enemy">${Number(w.enemy.score || 0).toLocaleString()}</span></span>` +
            `<span class="pill">${S.members.length} targets</span>`;
        el.style.display = 'flex';
    }

    /* =========================================================
       TABLE RENDER
    ========================================================== */

    function sortVal(m, col) {
        const now = Math.floor(Date.now() / 1000);
        switch (col) {
            case 'name':        return (m.name || '').toLowerCase();
            case 'level':       return m.level || 0;
            case 'last_action': return m.last_action?.timestamp || 0;
            case 'status':      return (m.status?.until || 0) - now;
            case 'life':        return m.life ? m.life.current / (m.life.maximum || 1) : 1;
            case 'update':      return m.profileTs || 0;
            case 'online': {
                const s = (m.last_action?.status || '').toLowerCase();
                return s === 'online' ? 0 : s === 'idle' ? 1 : 2;
            }
            default: return 0;
        }
    }

    function renderTable() {
        const tbody = document.getElementById('rws-tbody');
        if (!tbody) return;

        if (!S.war) {
            tbody.innerHTML = `<tr><td colspan="15" class="rws-empty">No active ranked war found for your faction.</td></tr>`;
            return;
        }

        if (!S.members.length) {
            tbody.innerHTML = `<tr><td colspan="15" class="rws-empty">Loading targets…</td></tr>`;
            return;
        }

        const dibs = getDibs();
        const now  = Math.floor(Date.now() / 1000);

        const sorted = [...S.members].sort((a, b) => {
            const va = sortVal(a, S.sortCol), vb = sortVal(b, S.sortCol);
            const c  = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
            return S.sortAsc ? c : -c;
        });

        tbody.innerHTML = sorted.map(m => {
            const id = m.id;
            const si = statusInfo(m.status, now);

            // Online dot
            const ls  = (m.last_action?.status || '').toLowerCase();
            const dot = ls
                ? `<span class="rws-dot ${ls === 'online' ? 'dot-online' : ls === 'idle' ? 'dot-idle' : 'dot-offline'}" title="${m.last_action.status}"></span>`
                : '';

            // Travel flag
            const dest = m.travel?.destination;
            const flag = (dest && dest !== 'Torn') || m.status?.state === 'Abroad'
                ? `<span title="${dest || 'Abroad'}">&#9992;</span>`
                : '';

            // Life bar
            let bar = '';
            if (m.life) {
                const pct = Math.max(0, Math.min(100, Math.round((m.life.current / (m.life.maximum || 1)) * 100)));
                bar = `<div class="rws-bar" title="${m.life.current}/${m.life.maximum}"><div class="rws-fill" style="width:${pct}%;background:${lifeColor(pct)}"></div></div>`;
            }

            const la  = m.last_action?.timestamp ? ago(m.last_action.timestamp) : '—';
            const upd = m.profileTs ? hms(Math.floor((Date.now() - m.profileTs) / 1000)) : '—';
            const claimed = !!dibs[id];

            return `<tr data-id="${id}" data-until="${si.until || 0}" data-pts="${m.profileTs || 0}">` +
                `<td style="text-align:left"><div class="rws-name-cell">` +
                    `<a class="rws-name-link" href="${TORN_BASE}/profiles.php?XID=${id}" target="_blank" title="${m.name || ''} [${id}]">${m.name || '?'} [${id}]</a>` +
                `</div></td>` +
                `<td>${m.level || '—'}</td>` +
                `<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>` +
                `<td>${la}</td>` +
                `<td>${dot}</td>` +
                `<td>${flag}</td>` +
                `<td>${bar}</td>` +
                `<td class="${si.cls} rws-st-cell" data-id="${id}">${si.text}</td>` +
                `<td class="rws-upd-cell">${upd}</td>` +
                `<td><button class="rws-dibs${claimed ? ' claimed' : ''}" onclick="__rwsDibs(${id})">${claimed ? 'Dibs ✓' : 'Dibs'}</button></td>` +
                `<td><a class="rws-atk" href="${TORN_BASE}/page.php?sid=attack&user2ID=${id}" target="_blank">A</a></td>` +
                `</tr>`;
        }).join('');

        updateSortHeaders();
    }

    /* =========================================================
       DIBS
    ========================================================== */

    window.__rwsDibs = function (uid) {
        const d = getDibs();
        if (d[uid]) delete d[uid]; else d[uid] = true;
        setDibs(d);
        renderTable();
    };

    /* =========================================================
       1-SECOND TICKER  (countdown + update-age, no full re-render)
    ========================================================== */

    function tick() {
        const now = Math.floor(Date.now() / 1000);

        document.querySelectorAll('#rws-tbody tr[data-until]').forEach(row => {
            const until = +row.dataset.until;
            const cell  = row.querySelector('.rws-st-cell');
            if (!cell || !until) return;
            const rem = until - now;
            if (rem > 0) {
                const prefix = cell.textContent.charAt(0);
                cell.textContent = prefix + ' for ' + hms(rem);
            } else if (cell.textContent !== 'Okay') {
                cell.textContent  = 'Okay';
                cell.className    = 'st-ok rws-st-cell';
                row.dataset.until = '0';
            }
        });

        document.querySelectorAll('#rws-tbody tr[data-pts]').forEach(row => {
            const pts  = +row.dataset.pts;
            const cell = row.querySelector('.rws-upd-cell');
            if (!pts || !cell) return;
            cell.textContent = hms(Math.floor((Date.now() - pts) / 1000));
        });
    }

    setInterval(tick, 1000);

    /* =========================================================
       HASH DETECTION
    ========================================================== */

    function isWarRankPage() {
        const h = window.location.hash;
        return h.includes('/war/rank') || h.includes('/war/ranked');
    }

    function handleNavigation() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        if (isWarRankPage()) {
            panel.hidden = false;
            if (!S.war && !S.loading) {
                if (!getApiKey()) return;
                // Load from cache first, then refresh
                const cache = loadCache();
                if (cache && cache.war && cache.members) {
                    S.war     = cache.war;
                    S.members = cache.members;
                    renderMeta();
                    renderTable();
                    updateLastRefreshed(cache.time);
                    setStatus('ok');
                }
                load(false);
            }
        } else {
            panel.hidden = true;
        }
    }

    window.addEventListener('hashchange', handleNavigation);

    /* =========================================================
       BOOT
    ========================================================== */

    function boot() {
        injectStyles();
        if (!createPanel()) return false;

        handleNavigation(); // apply initial visibility + load if needed
        startAutoRefresh();
        return true;
    }

    function waitForTabs() {
        const attempt = () => {
            const tabs = document.querySelector('#factions ul.faction-tabs, ul.faction-tabs');
            if (!tabs) { setTimeout(attempt, CONFIG.POLL_MS); return; }
            const ok = boot();
            if (!ok) setTimeout(attempt, CONFIG.POLL_MS);
        };
        attempt();
    }

    registerMenus();
    waitForTabs();

})();
