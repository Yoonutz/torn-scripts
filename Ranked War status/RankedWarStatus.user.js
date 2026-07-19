// ==UserScript==
// @name         Torn — Ranked War Status
// @namespace    torn.thecovenant.rws
// @version      3.3.1
// @author       KamiRen [2805199]
// @description  YATA-style ranked war target list on the war/rank tab: live hospital timers, auto-refresh, attack links
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
       COLOR THEME - EDIT THESE TO CHANGE COLORS
    ========================================================== */

    const COLORS = Object.freeze({
        // Status colors
        OK: '#2b8a3e',           // Green - Okay status
        HOSPITAL: '#e03131',     // Red - Hospital/Dead
        JAIL: '#e67700',         // Orange - Jail/Federal
        TRAVEL: '#1971c2',       // Blue - Traveling/Abroad
        UNKNOWN: '#868e96',      // Gray - Unknown/other

        // Online indicator colors
        ONLINE: '#2b8a3e',       // Green dot
        IDLE: '#e67700',         // Orange dot
        OFFLINE: '#868e96',      // Gray dot

        // UI colors
        TEXT: '#919191',         // Dark gray text for stats
        UPDATE: '#919191',       // Update column text color
        SCORE_MINE: '#2b8a3e',   // Green for our faction score
        SCORE_ENEMY: '#c92a2a',  // Red for enemy score
        ERROR: '#c92a2a',        // Error messages
    });

    /* =========================================================
       CONFIG
    ========================================================== */

    const CONFIG = Object.freeze({
        API_KEY: 'rws_api_key_v1',
        MINIMIZED: 'rws_minimized_v1',
        CACHE_DATA: 'rws_cache_data_v1',
        CACHE_TIME: 'rws_cache_time_v1',
        SHOW_LIMIT: 'rws_show_limit_v1',  // Storage key for show limit
        REFRESH_MS: 30 * 1000,   // Auto-refresh every 30 seconds
        POLL_MS: 500,            // Check for page elements every 500ms
    });

    // DOM IDs and CSS classes
    const PANEL_ID = 'ranked-war-panel';
    const STYLE_ID = 'ranked-war-styles';
    const API_BASE = 'https://api.torn.com/v2/';
    const TORN_BASE = 'https://www.torn.com';

    /* =========================================================
       SVG ICONS
    ========================================================== */

    const SVG_REFRESH = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    const SVG_EXPAND = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="16" viewBox="0 0 11 16" class="icon-fill"><path d="M1302,21l-5,5V16Z" transform="translate(-1294 -13)"/></svg>`;
    const SVG_COLLAPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" class="icon-fill"><path d="M1302,21l-5,5V16Z" transform="translate(29 -1294) rotate(90)"/></svg>`;

    /* =========================================================
       STYLES
    ========================================================== */

    const STYLES = `
    /* Main panel container */
    #${PANEL_ID} { margin-top: 14px; }
    #${PANEL_ID} .panel-container { background: var(--default-bg-panel-color); border-radius: 5px; }
    #${PANEL_ID} .panel-content { padding: 6px; background: var(--default-bg-panel-color); border: 1px solid var(--default-panel-divider-outer-side-color); border-top: none; border-radius: 0 0 6px 6px; }

    /* Panel header */
    #${PANEL_ID} .panel-header { background: linear-gradient(180deg,#555,#333) no-repeat; border-bottom: 2px solid transparent; border-radius: 5px 5px 0 0; display: flex; height: 34px; position: relative; align-items: center; padding: 0 8px; }
    #${PANEL_ID} .panel-title { align-self: center; color: #fff; font: 700 12px/14px Arial,sans-serif; margin-left: 10px; text-shadow: 0 0 2px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${PANEL_ID} .header-icons { margin-left: auto; display: flex; align-items: center; gap: 6px; }
    #${PANEL_ID} .header-icons .header-button { background: transparent; border: 0; padding: 6px; line-height: 0; cursor: pointer; }
    #${PANEL_ID} .header-icons .icon-fill { fill: #cfd6de; }
    #${PANEL_ID} .header-icons .header-button:hover .icon-fill { fill: #fff; }

    /* Info pills row */
    #${PANEL_ID} .pills-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; align-items: center; }
    #${PANEL_ID} .pills-right { margin-left: auto; display: flex; gap: 6px; }
    #${PANEL_ID} .pill { display: inline-block; border: 1px solid var(--default-panel-divider-outer-side-color); border-radius: 999px; padding: 2px 9px; font-size: 11px; background: var(--default-bg-panel-active-color); color: var(--default-color); white-space: nowrap; }
    #${PANEL_ID} .pill a { color: var(--default-blue-color); text-decoration: underline; cursor: pointer; }
    #${PANEL_ID} .score-mine { color: ${COLORS.SCORE_MINE}; font-weight: 700; }
    #${PANEL_ID} .score-enemy { color: ${COLORS.SCORE_ENEMY}; font-weight: 700; }

    /* Icon buttons (refresh, update) */
    #${PANEL_ID} .icon-button { width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--default-panel-divider-outer-side-color); border-radius: 4px; background: var(--default-bg-panel-active-color); cursor: pointer; color: var(--default-color); }
    #${PANEL_ID} .icon-button:hover { background: var(--default-bg-panel-color); transform: scale(1.05); }
    #${PANEL_ID} .icon-button:active { transform: scale(0.95); }
    #${PANEL_ID} .icon-button svg { width: 14px; height: 14px; stroke: currentColor; fill: none; }
    #${PANEL_ID} .icon-button[disabled] { opacity: .5; pointer-events: none; }

    /* Table container and table */
    #${PANEL_ID} .table-card { border: 1px solid var(--default-panel-divider-outer-side-color); border-radius: 6px; overflow: hidden; }
    #${PANEL_ID} .table-scroll { overflow-x: auto; }
    #${PANEL_ID} .target-table { width: 100%; border-collapse: collapse; color: #fff; min-width: 700px; }
    #${PANEL_ID} .target-table th { background: var(--default-bg-panel-active-color); color: var(--default-color); opacity: .7; font: 700 10px/12px Arial; text-transform: uppercase; letter-spacing: .04em; padding: 6px 8px; text-align: center; white-space: nowrap; cursor: pointer; border-bottom: 1px solid var(--default-panel-divider-outer-side-color); user-select: none; position: sticky; top: 0; z-index: 1; }
    #${PANEL_ID} .target-table th:hover { opacity: 1; }
    #${PANEL_ID} .target-table th.sort-asc::after  { content: ' ▲'; font-size: 8px; }
    #${PANEL_ID} .target-table th.sort-desc::after { content: ' ▼'; font-size: 8px; }
    #${PANEL_ID} .target-table td { padding: 5px 8px; font-size: 11px; border-bottom: 1px solid var(--default-panel-divider-outer-side-color); text-align: center; vertical-align: middle; white-space: nowrap; }
    #${PANEL_ID} .target-table td.stat-cell { color: ${COLORS.TEXT}; }
    #${PANEL_ID} .target-table td.update-cell { color: ${COLORS.UPDATE}; }
    #${PANEL_ID} .target-table tr:last-child td { border-bottom: none; }
    #${PANEL_ID} .target-table tr:hover td { background: rgba(128,128,128,.07); }

    /* Name cell and attack link */
    #${PANEL_ID} .name-cell { display: flex; align-items: center; gap: 4px; justify-content: flex-start; }
    #${PANEL_ID} .attack-link { color: var(--default-blue-color, #5c9af5); text-decoration: none; max-width: 130px; overflow: hidden; text-overflow: ellipsis; display: inline-block; }
    #${PANEL_ID} .attack-link:hover { text-decoration: underline; }

    /* Online status dot */
    #${PANEL_ID} .online-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    #${PANEL_ID} .online-status-online  { background: ${COLORS.ONLINE}; }
    #${PANEL_ID} .online-status-idle    { background: ${COLORS.IDLE}; }
    #${PANEL_ID} .online-status-offline { background: ${COLORS.OFFLINE}; }

    /* Status text colors (Hospital/Jail/etc) - USING COLORS CONSTANT */
    #${PANEL_ID} .status-okay    { color: ${COLORS.OK}; }
    #${PANEL_ID} .status-hospital { color: ${COLORS.HOSPITAL}; }
    #${PANEL_ID} .status-jail   { color: ${COLORS.JAIL}; }
    #${PANEL_ID} .status-travel { color: ${COLORS.TRAVEL}; }
    #${PANEL_ID} .status-unknown { color: ${COLORS.UNKNOWN}; opacity: .6; }

    /* Low time pulse animation */
    #${PANEL_ID} .low-time-pulse { animation: low-time-pulse 1s infinite; }
    @keyframes low-time-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Empty state and status messages */
    #${PANEL_ID} .empty-message { text-align: center; padding: 20px 12px; color: #868e96; font-size: 11px; }
    #${PANEL_ID} .status-message { display: none; }
    #${PANEL_ID} .status-message.visible { display: inline-block; }
    #${PANEL_ID} .status-error { color: ${COLORS.ERROR}; }
    #${PANEL_ID} .status-info { color: var(--default-color); opacity: .7; }
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
        try { const k = String(GM_getValue(CONFIG.API_KEY, '')).trim(); if (k) return k; } catch { }
        try { return String(localStorage.getItem(CONFIG.API_KEY) || '').trim(); } catch { }
        return '';
    }

    function setApiKey(k) {
        const v = k.trim();
        try { GM_setValue(CONFIG.API_KEY, v); } catch { }
        try { localStorage.setItem(CONFIG.API_KEY, v); } catch { }
        updateKeyPill();
    }

    function saveCache(war, members) {
        try {
            GM_setValue(CONFIG.CACHE_DATA, JSON.stringify({ war, members }));
            GM_setValue(CONFIG.CACHE_TIME, Date.now());
        } catch { }
    }

    function loadCache() {
        try {
            const raw = GM_getValue(CONFIG.CACHE_DATA, null);
            const time = Number(GM_getValue(CONFIG.CACHE_TIME, 0));
            if (!raw) return null;
            return { ...JSON.parse(raw), time };
        } catch { return null; }
    }

    function loadShowLimit() {
        try {
            const saved = GM_getValue(CONFIG.SHOW_LIMIT, undefined);
            if (saved === undefined) return undefined;
            if (saved === 'all' || saved === null) return 'all';
            const limit = parseInt(saved, 10);
            return isNaN(limit) || limit < 1 ? undefined : limit;
        } catch { }
        return undefined;
    }

    function saveShowLimit(limit) {
        try {
            if (limit === null || limit === 'all') {
                GM_setValue(CONFIG.SHOW_LIMIT, 'all');
            } else {
                GM_setValue(CONFIG.SHOW_LIMIT, String(limit));
            }
        } catch { }
    }

    /* =========================================================
       MENU COMMANDS
    ========================================================== */

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand('Set API Key', promptForKey);
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
                method: 'GET',
                url: url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now(),
                timeout: 20000,
                onload: r => resolve(r),
                onerror: () => reject(new Error('Network error.')),
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
        const d = await apiGet('faction/wars');
        const rw = d.wars?.ranked;
        if (!rw) return null;
        const war = Array.isArray(rw) ? rw[0] : rw;
        if (!war) return null;

        // API v2 returns factions as an array [{id, name, score, chain}, ...]
        const factionsArr = Array.isArray(war.factions)
            ? war.factions
            : Object.values(war.factions || {});
        const myFaction = factionsArr.find(f => (f.id ?? f.faction_id) === myFid);
        const enemyFaction = factionsArr.find(f => (f.id ?? f.faction_id) !== myFid);
        if (!enemyFaction) return null;

        return {
            warId: war.war_id,
            start: war.start,
            target: war.target,
            mine: myFaction || {},
            enemy: enemyFaction || {},
            enemyId: enemyFaction.id ?? enemyFaction.faction_id,
        };
    }

    async function getEnemyMembers(fid) {
        const d = await apiGet(`faction/${fid}/members`);
        const raw = d.members;
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        return Object.entries(raw).map(([id, m]) => ({ ...m, id: Number(id) }));
    }

    /* =========================================================
       FORMAT HELPERS
    ========================================================== */

    function hms(s) {
        if (s <= 0) return '0:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        const p = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
    }

    function ago(ts) {
        if (!ts) return '—';
        const s = Math.floor(Date.now() / 1000) - ts;
        if (s < 60) return s + 's ago';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
    }

    function getStatusDisplay(status, now) {
        if (!status) return { text: '—', cssClass: 'status-unknown', until: 0 };
        const remaining = (status.until || 0) - now;
        switch (status.state) {
            case 'Hospital': return remaining > 0
                ? { text: 'H for ' + hms(remaining), cssClass: 'status-hospital', until: status.until }
                : { text: 'Okay', cssClass: 'status-okay', until: 0 };
            case 'Jail': return remaining > 0
                ? { text: 'J for ' + hms(remaining), cssClass: 'status-jail', until: status.until }
                : { text: 'Okay', cssClass: 'status-okay', until: 0 };
            case 'Federal': return { text: 'Federal', cssClass: 'status-jail', until: status.until || 0 };
            case 'Dead': return { text: 'Dead', cssClass: 'status-hospital', until: 0 };
            case 'Abroad':
            case 'Traveling': return { text: 'Traveling', cssClass: 'status-travel', until: 0 };
            default: return { text: 'Okay', cssClass: 'status-okay', until: 0 };
        }
    }

    /* =========================================================
       APP STATE
    ========================================================== */

    const S = {
        war: null,
        members: [],
        loading: false,
        sortCol: 'status',
        sortAsc: true,
        showLimit: 5,  // Default number of targets to show
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
            const war = await getActiveRankedWar(myFid);
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
                id: m.id ?? m.user_id,
                name: m.name || null,
                level: m.level || null,
                status: m.status || null,
                last_action: m.last_action || null,
                travel: m.travel || null,
                profileTs: Date.now(),
            })).filter(m => m.id);

            renderTable();
            saveCache(war, S.members);
            updateLastRefreshed(Date.now());
            setStatus('ok');

        } catch (e) {
            const cache = loadCache();
            if (cache && cache.war && cache.members) {
                S.war = cache.war;
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
        try { minimized = !!GM_getValue(CONFIG.MINIMIZED, false); } catch { }

        const hasKey = !!getApiKey();

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'equipped-items-wrap';

        panel.innerHTML = `
<div class="panel-container">
  <header class="panel-header">
    <p class="panel-title" role="heading" aria-level="2">&#9876; Ranked War Status</p>
    <nav class="header-icons">
      <button type="button" class="header-button" id="minimize-button"
              aria-label="${minimized ? 'Open' : 'Collapse'}" aria-expanded="${!minimized}">
        ${minimized ? SVG_EXPAND : SVG_COLLAPSE}
      </button>
    </nav>
  </header>
  <div class="panel-content" id="panel-content" ${minimized ? 'hidden' : ''}>
    <div class="pills-row" id="info-pills">
      <span class="pill" id="api-key-pill">API key: <strong>${hasKey ? 'set' : 'not set'}</strong> &middot; <a id="api-key-edit">${hasKey ? 'edit' : 'set'}</a></span>
      <span class="pill status-message" id="status-pill"></span>
      <span class="pill status-message" id="refresh-time-pill"></span>
      <span class="pills-right">
        <button type="button" class="icon-button" id="update-button" title="Update targets" disabled>${SVG_REFRESH}</button>
      </span>
    </div>
    <div id="war-info-pills" class="pills-row" style="display:none"></div>
    <div class="table-card">
      <div class="table-scroll">
        <table class="target-table" id="target-table">
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
            <th data-col="status"      style="width:110px">Status</th>
            <th data-col="update"      style="width:70px">Update</th>
          </tr></thead>
          <tbody id="target-table-body">
            <tr><td colspan="11" class="empty-message">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;

        tabs.after(panel);

        // Wire events
        document.getElementById('api-key-edit').addEventListener('click', promptForKey);

        document.getElementById('minimize-button').addEventListener('click', () => {
            const content = document.getElementById('panel-content');
            const btn = document.getElementById('minimize-button');
            const isMin = !content.hasAttribute('hidden');
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
            try { GM_setValue(CONFIG.MINIMIZED, isMin); } catch { }
        });

        document.getElementById('update-button').addEventListener('click', () => load(true));

        // Column sort
        document.querySelectorAll('#target-table th[data-col]').forEach(th => {
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
        const statusPill = document.getElementById('status-pill');
        const updateButton = document.getElementById('update-button');
        if (!statusPill) return;

        statusPill.className = 'pill status-message';
        if (state === 'ok') {
            statusPill.classList.remove('visible');
            if (updateButton) updateButton.disabled = false;
        } else if (state === 'loading') {
            statusPill.classList.add('visible', 'status-info');
            statusPill.textContent = msg || 'Loading…';
            if (updateButton) updateButton.disabled = true;
        } else if (state === 'info') {
            statusPill.classList.add('visible', 'status-info');
            statusPill.textContent = msg;
        } else if (state === 'error') {
            statusPill.classList.add('visible', 'status-error');
            statusPill.textContent = msg;
            if (updateButton) updateButton.disabled = false;
        }
    }

    function updateKeyPill() {
        const keyPill = document.getElementById('api-key-pill');
        if (!keyPill) return;
        const hasKey = !!getApiKey();
        keyPill.innerHTML = `API key: <strong>${hasKey ? 'set' : 'not set'}</strong> &middot; <a id="api-key-edit">${hasKey ? 'edit' : 'set'}</a>`;
        document.getElementById('api-key-edit')?.addEventListener('click', promptForKey);
    }

    function updateLastRefreshed(timestamp) {
        const refreshPill = document.getElementById('refresh-time-pill');
        if (!refreshPill || !timestamp) return;
        const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        refreshPill.textContent = `Updated ${timeStr}`;
        refreshPill.classList.add('visible', 'status-info');
    }

    function updateSortHeaders() {
        document.querySelectorAll('#target-table th[data-col]').forEach(th => {
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
        const warInfoPills = document.getElementById('war-info-pills');
        if (!warInfoPills) return;
        if (!S.war) { warInfoPills.style.display = 'none'; return; }
        const war = S.war;
        const startDate = new Date((war.start || 0) * 1000);
        const startStr = startDate.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

        const totalTargets = S.members.length;
        const showingCount = S.showLimit === 'all' ? totalTargets : Math.min(S.showLimit, totalTargets);
        const showLimitText = S.showLimit === 'all' ? `Show All (${totalTargets})` : `Show ${showingCount}/${totalTargets}`;

        warInfoPills.innerHTML =
            `<span class="pill">Faction: <a href="${TORN_BASE}/factions.php?step=profile&ID=${war.enemyId}" target="_blank">${war.enemy.name || '?'} [${war.enemyId}]</a></span>` +
            `<span class="pill">Start: <strong>${startStr}</strong></span>` +
            `<span class="pill">Target: <strong>${Number(war.target || 0).toLocaleString()}</strong></span>` +
            `<span class="pill">Score: <span class="score-mine">${Number(war.mine.score || 0).toLocaleString()}</span> &nbsp;vs&nbsp; <span class="score-enemy">${Number(war.enemy.score || 0).toLocaleString()}</span></span>` +
            `<span class="pill clickable-pill" id="targets-limit-pill" style="cursor:pointer; user-select:none;">${showLimitText}</span>`;
        warInfoPills.style.display = 'flex';

        // Wire up the targets limit pill click
        document.getElementById('targets-limit-pill')?.addEventListener('click', showLimitMenu);
    }

    /* =========================================================
       TABLE RENDER
    ========================================================== */

    function getSortValue(member, column) {
        const now = Math.floor(Date.now() / 1000);
        switch (column) {
            case 'name': return (member.name || '').toLowerCase();
            case 'level': return member.level || 0;
            case 'last_action': return member.last_action?.timestamp || 0;
            case 'status': {
                // Traveling always goes to the bottom when sorting by status
                const state = member.status?.state || '';
                if (state === 'Abroad' || state === 'Traveling') return Infinity;
                return (member.status?.until || 0) - now;
            }
            case 'update': return member.profileTs || 0;
            case 'online': {
                const status = (member.last_action?.status || '').toLowerCase();
                return status === 'online' ? 0 : status === 'idle' ? 1 : 2;
            }
            default: return 0;
        }
    }

    /* Context menu for show limit - with custom JavaScript scrollbar */
    function showLimitMenu(event) {
        // Remove existing menu if any
        const existingMenu = document.getElementById('limit-context-menu');
        if (existingMenu) existingMenu.remove();

        const total = S.members.length;
        const currentValue = S.showLimit === 'all' ? '' : S.showLimit;

        // Create outer container with custom scrollbar
        const menu = document.createElement('div');
        menu.id = 'limit-context-menu';
        menu.style.cssText = `
            position: fixed;
            z-index: 10000;
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 6px;
            padding: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-size: 12px;
            min-width: 140px;
            overflow: visible;
        `;

        // Simple content - no scrollbar needed for this small menu
        menu.innerHTML = `
            <div style="margin-bottom: 8px; color: #ccc; font-weight: bold;">Show targets:</div>
            <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                <input type="text" id="limit-input" value="${currentValue}" inputmode="numeric" placeholder="#"
                    style="width: 60px; padding: 4px 6px; border: 1px solid #555; border-radius: 3px; background: #1a1a1a; color: #fff; font-size: 12px;">
                <button id="limit-apply" style="padding: 4px 10px; background: #444; color: #fff; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px;">Set</button>
            </div>
            <div style="border-top: 1px solid #444; padding-top: 6px;">
                <button id="limit-all" style="width: 100%; padding: 6px; background: transparent; color: #5c9af5; border: none; cursor: pointer; text-align: left; font-size: 12px;">
                    Show all (${total})
                </button>
            </div>
        `;

        // Position menu near the click
        menu.style.left = event.clientX + 'px';
        menu.style.top = event.clientY + 'px';
        document.body.appendChild(menu);

        // Focus the input
        const input = document.getElementById('limit-input');
        input?.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        input?.focus();
        input?.select();

        // Apply button handler
        document.getElementById('limit-apply')?.addEventListener('click', () => {
            const val = parseInt(input?.value, 10);
            if (!isNaN(val) && val >= 1) {
                S.showLimit = Math.min(val, total);
                saveShowLimit(S.showLimit);
                renderMeta();
                renderTable();
            }
            menu.remove();
        });

        // Enter key handler
        input?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('limit-apply')?.click();
            }
        });

        // Show all handler
        document.getElementById('limit-all')?.addEventListener('click', () => {
            S.showLimit = 'all';
            saveShowLimit(null);
            renderMeta();
            renderTable();
            menu.remove();
        });

        // Close menu when clicking outside
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    function renderTable() {
        const tableBody = document.getElementById('target-table-body');
        if (!tableBody) return;

        if (!S.war) {
            tableBody.innerHTML = `<tr><td colspan="11" class="empty-message">No active ranked war found for your faction.</td></tr>`;
            return;
        }

        if (!S.members.length) {
            tableBody.innerHTML = `<tr><td colspan="11" class="empty-message">Loading targets…</td></tr>`;
            return;
        }

        const now = Math.floor(Date.now() / 1000);

        const sortedMembers = [...S.members].sort((a, b) => {
            const valA = getSortValue(a, S.sortCol), valB = getSortValue(b, S.sortCol);
            const comparison = typeof valA === 'string' ? valA.localeCompare(valB) : valA - valB;
            return S.sortAsc ? comparison : -comparison;
        });

        // Apply show limit
        const membersToShow = S.showLimit === 'all'
            ? sortedMembers
            : sortedMembers.slice(0, S.showLimit);

        tableBody.innerHTML = membersToShow.map(member => {
            const memberId = member.id;
            const statusInfo = getStatusDisplay(member.status, now);

            // Online status dot
            const onlineStatus = (member.last_action?.status || '').toLowerCase();
            const onlineDot = onlineStatus
                ? `<span class="online-dot online-status-${onlineStatus}" title="${member.last_action.status}"></span>`
                : '';

            const lastActionStr = member.last_action?.timestamp ? ago(member.last_action.timestamp) : '—';
            const updateAgeStr = member.profileTs ? hms(Math.floor((Date.now() - member.profileTs) / 1000)) : '—';

            return `<tr data-id="${memberId}" data-until="${statusInfo.until || 0}" data-pts="${member.profileTs || 0}">` +
                `<td style="text-align:left"><div class="name-cell">` +
                `<a class="attack-link" href="${TORN_BASE}/page.php?sid=attack&user2ID=${memberId}" target="_blank" title="${member.name || ''} [${memberId}]">${member.name || '?'} [${memberId}]</a>` +
                `</div></td>` +
                `<td class="stat-cell">${member.level || '—'}</td>` +
                `<td class="stat-cell">—</td><td class="stat-cell">—</td><td class="stat-cell">—</td><td class="stat-cell">—</td><td class="stat-cell">—</td>` +
                `<td class="stat-cell">${lastActionStr}</td>` +
                `<td>${onlineDot}</td>` +
                `<td class="${statusInfo.cssClass} status-cell" data-id="${memberId}">${statusInfo.text}</td>` +
                `<td class="update-cell">${updateAgeStr}</td>` +
                `</tr>`;
        }).join('');

        updateSortHeaders();
    }

    /* =========================================================
       1-SECOND TICKER  (countdown + update-age, no full re-render)
    ========================================================== */

    function tick() {
        const now = Math.floor(Date.now() / 1000);

        document.querySelectorAll('#target-table-body tr[data-until]').forEach(row => {
            const until = +row.dataset.until;
            const statusCell = row.querySelector('.status-cell');
            if (!statusCell || !until) return;
            const remaining = until - now;
            if (remaining > 0) {
                const prefix = statusCell.textContent.charAt(0);
                statusCell.textContent = prefix + ' for ' + hms(remaining);
                // Add pulse animation when 15s or less
                if (remaining <= 15 && !statusCell.classList.contains('low-time-pulse')) {
                    statusCell.classList.add('low-time-pulse');
                } else if (remaining > 15 && statusCell.classList.contains('low-time-pulse')) {
                    statusCell.classList.remove('low-time-pulse');
                }
            } else if (statusCell.textContent !== 'Okay') {
                statusCell.textContent = 'Okay';
                statusCell.className = 'status-okay status-cell';
                row.dataset.until = '0';
            }
        });

        document.querySelectorAll('#target-table-body tr[data-pts]').forEach(row => {
            const timestamp = +row.dataset.pts;
            const updateCell = row.querySelector('.update-cell');
            if (!timestamp || !updateCell) return;
            updateCell.textContent = hms(Math.floor((Date.now() - timestamp) / 1000));
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
                const cached = loadCache();
                if (cached && cached.war && cached.members) {
                    S.war = cached.war;
                    S.members = cached.members;
                    renderMeta();
                    renderTable();
                    updateLastRefreshed(cached.time);
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

        // Load saved show limit preference
        const savedLimit = loadShowLimit();
        if (savedLimit !== undefined) {
            S.showLimit = savedLimit;
        }

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
