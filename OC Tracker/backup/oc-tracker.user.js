// ==UserScript==
// @name        OC Member Tracker
// @namespace   kamiren.oc-member-tracker
// @match       https://www.torn.com/factions.php*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @author      KamiRen [2805199] - https://www.torn.com/profiles.php?XID=2805199
// @version     1.9
// @grant       GM_xmlhttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_registerMenuCommand
// @connect     api.torn.com
// @description Shows which faction members are not in an OC, how long they've been out, and their current status. Draggable, resizable, minimizable panel.
// ==/UserScript==

(function () {
  "use strict";

  /* =========================================================
     CONFIG
  ========================================================== */

  const CONFIG = Object.freeze({
    API_KEY_STORAGE:   "oct_api_key_v1",
    PANEL_POS_STORAGE: "oct_panel_pos_v1",
    PANEL_SIZE_STORAGE:"oct_panel_size_v1",
    MINIMIZED_STORAGE: "oct_minimized_v1",
    CACHE_DATA_STORAGE:"oct_cache_data_v2",
    CACHE_TIME_STORAGE:"oct_cache_time_v2",
    REFRESH_MS:        60 * 60 * 1000,   // 1 hour
    POLL_MS:           500,
  });

  /* =========================================================
     API KEY 
  ========================================================== */

  function getApiKey() {
    try {
      const gmKey = String(GM_getValue(CONFIG.API_KEY_STORAGE, "")).trim();
      if (gmKey) return gmKey;
    } catch {}
    try { return String(localStorage.getItem(CONFIG.API_KEY_STORAGE) || "").trim(); } catch {}
    return "";
  }

  function setApiKey(k) {
    const v = k.trim();
    try { GM_setValue(CONFIG.API_KEY_STORAGE, v); } catch {}
    try { localStorage.setItem(CONFIG.API_KEY_STORAGE, v); } catch {}
    return true;
  }

  function promptForApiKey() {
    const current = getApiKey();
    const next = prompt(
      "OC Member Tracker\n\nPaste your Torn API key (needs 'Faction' access — read-only is fine):",
      current
    );
    if (next === null) return;
    if (!next.trim()) { alert("No key entered. Panel will show an error until a key is set."); return; }
    setApiKey(next);
    alert("API key saved. The panel will refresh now.");
    refreshData(true);
  }

  /* =========================================================
     MENU COMMANDS
  ========================================================== */

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("Set API Key",  promptForApiKey);
    GM_registerMenuCommand("Force Refresh", () => refreshData(true));
  }

  /* =========================================================
     TORN API
  ========================================================== */

  /**
   * Wraps GM_xmlhttpRequest as a Promise.
   */
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method:   "GET",
        url:      url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now(),
        timeout:  20000,
        onload:   (r) => resolve(r),
        onerror:  ()  => reject(new Error("Network error — check your internet connection.")),
        ontimeout:()  => reject(new Error("Request timed out after 20 s.")),
      });
    });
  }

  /**
   * Torn API error codes → human-readable explanation.
   */
  const TORN_API_ERRORS = {
    0:  "Unknown error.",
    1:  "Empty key — please set your API key via the ViolentMonkey menu.",
    2:  "Incorrect key — the API key is invalid.",
    3:  "Wrong type — this key does not support the required access level.",
    4:  "Wrong ID — invalid faction ID supplied.",
    5:  "Too many requests — you are being rate-limited by Torn.",
    6:  "Incorrect ID-entity relation.",
    7:  "IP block — your IP is temporarily blocked by Torn.",
    8:  "API is disabled on the Torn side.",
    9:  "API key owner is in federal jail — actions are restricted.",
    10: "Key change too soon — please wait before changing keys.",
    11: "Access level too low — your key needs 'Faction' (Limited/Full) access. Go to Torn → Settings → API Key and enable Faction access.",
    12: "Backend error on Torn's side — try again later.",
    13: "Feature not available.",
    14: "Incorrect parameters.",
    15: "Too many concurrent requests.",
    16: "Your faction does not exist or you are not in one.",
    17: "Faction has no active crimes.",
    18: "Feature in maintenance.",
    19: "No data available.",
    20: "Only the faction leader or co-leader can access this.",
    21: "Incorrect category.",
    22: "Account is disabled.",
  };

  function tornErrorMessage(code) {
    return TORN_API_ERRORS[code] || `Torn API error code ${code}.`;
  }

  /**
   * Parse a raw API response string into JSON, throwing a human-readable error
   * if the response is invalid or contains a Torn API error object.
   */
  function parseApiResponse(raw, label) {
    let json;
    try { json = JSON.parse(raw.trim()); }
    catch { throw new Error(`Could not parse ${label} response. Raw: ` + raw.slice(0, 200)); }
    if (json.error) {
      throw new Error(`${label}: ` + tornErrorMessage(json.error.code ?? json.error));
    }
    return json;
  }

  /**
   * Fetch faction members (with active-crime slot data) and completed crimes
   * history in parallel, then merge into one object for buildRows.
   *
   * Active crimes  → https://api.torn.com/v2/faction?selections=members,crimes
   *   Only contains recruiting/planning/executing crimes — no executed_at.
   *
   * Completed crimes → https://api.torn.com/v2/faction/crimes?cat=completed
   *   Has executed_at + slot user IDs — this is what drives "last OC" lookup.
   */
  async function fetchFactionReport(apiKey) {
    const [membersResp, completedResp] = await Promise.all([
      gmFetch(`https://api.torn.com/v2/faction?selections=members&key=${apiKey}`),
      gmFetch(`https://api.torn.com/v2/faction?selections=crimes&cat=completed&limit=100&key=${apiKey}`),
    ]);

    const membersJson   = parseApiResponse(String(membersResp.responseText   || ""), "Members");
    const completedJson = parseApiResponse(String(completedResp.responseText || ""), "Completed crimes");

    const crimesRaw = completedJson.crimes;
    const crimes = Array.isArray(crimesRaw)
      ? crimesRaw
      : (crimesRaw && typeof crimesRaw === "object" ? Object.values(crimesRaw) : []);

    const membersRaw = membersJson.members;
    const members = Array.isArray(membersRaw)
      ? membersRaw
      : (membersRaw && typeof membersRaw === "object" ? Object.values(membersRaw) : []);

    console.log(`[OCT] members: ${members.length}, crimes: ${crimes.length}`);
    if (members.length > 0) console.log(`[OCT] first member id: ${members[0].id}, is_in_oc: ${members[0].is_in_oc}`);
    if (crimes.length > 0) console.log(`[OCT] first crime: ${crimes[0].name}, executed_at: ${crimes[0].executed_at}`);

    return { members, crimes };
  }

  /* =========================================================
     DATA PROCESSING
  ========================================================== */

  /**
   * Returns a rich object per member ID describing the most-recent completed OC
   * they participated in.
   *
   * map[id] = {
   *   ts:      executed_at (unix seconds),
   *   name:    crime name (e.g. "Break the Bank"),
   *   outcome: the member's personal outcome (e.g. "Successful", "Jailed"),
   * }
   */
  function buildLastOcMap(crimes) {
    const map = {};

    if (!Array.isArray(crimes)) return map;

    for (const crime of crimes) {
      const executedAt = crime.executed_at ?? 0;
      if (!executedAt) continue;

      const crimeName = crime.name ?? "Unknown crime";
      const slots = crime.slots ?? [];

      for (const slot of slots) {
        const user = slot.user;
        if (!user || !user.id) continue;

        const id = user.id;
        if (!map[id] || executedAt > map[id].ts) {
          map[id] = {
            ts:      executedAt,
            name:    crimeName,
            outcome: user.outcome ?? "—",
          };
        }
      }
    }

    return map;
  }

  function secondsAgo(unixTs) {
    return Math.floor(Date.now() / 1000) - unixTs;
  }

  function formatDuration(seconds) {
    if (seconds < 0) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m ago`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h ago`;
  }
 
  /**
   * Torn member status string (e.g. "Okay", "Jail", "Hospital", "Traveling", "Abroad").
   */
  function memberStatusLabel(member) {
    const st = member.status;
    if (!st) return "—";
    const desc = st.description || st.state || "—";
    return desc;
  }

  function statusColor(member) {
    const state = (member.status?.state || "").toLowerCase();
    if (state === "okay")       return "#2b8a3e";  // green
    if (state === "jail")       return "#e03131";  // red
    if (state === "hospital")   return "#e67700";  // orange
    if (state === "traveling")  return "#1971c2";  // blue
    if (state === "abroad")     return "#1971c2";
    if (state === "federal")    return "#9c36b5";  // purple
    return "#aaa";
  }

  /**
   * Colour-code last-online timestamp:
   *   green  < 1h  (recently active)
   *   orange 1h – 24h
   *   grey   > 24h or unknown
   */
  function onlineColor(ts) {
    if (!ts) return "#666";
    const s = secondsAgo(ts);
    if (s < 3600)       return "#2b8a3e";
    if (s < 86400)      return "#e67700";
    return "#666";
  }

  /**
   * Urgency band based on how long they've been out of OC:
   *  - "ok"     : < 3h (just finished, normal cooldown)
   *  - "watch"  : 3h – 24h
   *  - "warn"   : 1d – 7d
   *  - "danger" : > 7d
   *  - "none"   : never seen in OC history
   */
  function urgencyBand(lastOcTs) {
    if (!lastOcTs) return "none";
    const s = secondsAgo(lastOcTs);
    if (s < 3 * 3600)       return "ok";
    if (s < 24 * 3600)      return "watch";
    if (s < 7 * 24 * 3600)  return "warn";
    return "danger";
  }

  const URGENCY_COLORS = {
    ok:     "#2b8a3e",
    watch:  "#e67700",
    warn:   "#c92a2a",
    danger: "#9c36b5",
    none:   "#888",
  };

  /**
   * Build the final display rows from raw API data.
   * Returns array sorted: none → danger → warn → watch → ok
   */
  function buildRows(json) {
    const members = Array.isArray(json.members) ? json.members : Object.values(json.members ?? {});
    const crimes  = json.crimes ?? [];

    const lastOcMap = buildLastOcMap(crimes);

    const rows = [];

    for (const member of members) {
      const id = member.id;
      if (!id) continue;
      if (member.is_in_oc) continue; // skip members actively in an OC

      const lastOcTs    = lastOcMap[id]?.ts ?? 0;
      const lastActionTs = member.last_action?.timestamp ?? 0;
      rows.push({
        id,
        name:              member.name ?? `#${id}`,
        lastOcTs,          // raw unix seconds — used to recompute duration on every render
        lastActionTs,      // raw unix seconds — used to recompute lastOnline on every render
        // band / duration / daysLevel / lastOnline / lastOnlineColor are
        // intentionally left out here — freshenRows() fills them at render time
        status:            memberStatusLabel(member),
        statusColor:       statusColor(member),
      });
    }

    // Sorting and time-sensitive fields are handled by freshenRows()
    // which is called at render time (so cache is always up to date).
    return rows;
  }

  /**
   * Recompute every time-sensitive display field from the raw timestamps
   * stored in each row.  Call this immediately before rendering so that
   * both live data and cached rows always show durations relative to NOW,
   * not relative to when the data was originally fetched.
   *
   * Also re-sorts the array in place so urgency bands reflect current time.
   */
  function freshenRows(rows) {
    const bandOrder = { none: 0, danger: 1, warn: 2, watch: 3, ok: 4 };

    for (const row of rows) {
      const ocTs     = row.lastOcTs    ?? 0;
      const actionTs = row.lastActionTs ?? 0;

      row.band           = urgencyBand(ocTs);
      row.daysLevel      = ocTs ? secondsAgo(ocTs) : Infinity;
      row.duration       = ocTs ? formatDuration(secondsAgo(ocTs)) : "No OC history";
      row.lastOnline     = actionTs ? formatDuration(secondsAgo(actionTs)) : "—";
      row.lastOnlineColor = onlineColor(actionTs);
    }

    rows.sort((a, b) => {
      const bo = bandOrder[a.band] - bandOrder[b.band];
      if (bo !== 0) return bo;
      return b.daysLevel - a.daysLevel;
    });
  }

  /* =========================================================
     CACHE
  ========================================================== */

  function saveCache(rows) {
    try {
      GM_setValue(CONFIG.CACHE_DATA_STORAGE, JSON.stringify(rows));
      GM_setValue(CONFIG.CACHE_TIME_STORAGE, Date.now());
    } catch {}
  }

  function loadCache() {
    try {
      const raw  = GM_getValue(CONFIG.CACHE_DATA_STORAGE, null);
      const time = GM_getValue(CONFIG.CACHE_TIME_STORAGE, 0);
      if (!raw) return null;
      return { rows: JSON.parse(raw), time: Number(time) };
    } catch { return null; }
  }

  /* =========================================================
     REFRESH LOGIC
  ========================================================== */

  let _refreshing = false;

  async function refreshData(force = false) {
    if (_refreshing) return;
    _refreshing = true;

    setStatus("loading");

    const apiKey = getApiKey();
    if (!apiKey) {
      setStatus("error", "No API key set. Use the ViolentMonkey menu → 'Set API Key'.");
      _refreshing = false;
      return;
    }

    try {
      const json = await fetchFactionReport(apiKey);
      const rows = buildRows(json);
      saveCache(rows);
      renderRows(rows);
      updateLastRefreshed(Date.now());
      setStatus("ok");
    } catch (e) {
      // Try to show cached data on error
      const cache = loadCache();
      if (cache) {
        renderRows(cache.rows);
        updateLastRefreshed(cache.time);
      }
      setStatus("error", e.message);
    } finally {
      _refreshing = false;
    }
  }

  /* =========================================================
     PANEL UI
  ========================================================== */

  const PANEL_ID    = "oct-panel";
  const STYLE_ID    = "oct-style";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      #oct-panel {
        position: fixed;
        z-index: 99999;
        background: var(--default-bg-panel-color, #1a1a2e);
        border: 1px solid var(--default-color-3, #3a3a5c);
        border-radius: 6px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.55);
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 12px;
        color: var(--default-color, #e0e0e0);
        min-width: 260px;
        min-height: 80px;
        overflow: hidden;
        resize: both;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
      }
      #oct-panel.oct-minimized {
        resize: none !important;
        overflow: hidden !important;
        height: auto !important;
        min-height: 0 !important;
      }
      #oct-header {
        background: var(--default-bg-panel-header-color, #12122a);
        padding: 6px 10px;
        cursor: grab;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--default-color-3, #3a3a5c);
        flex-shrink: 0;
      }
      #oct-header:active { cursor: grabbing; }
      #oct-header-title {
        font-weight: bold;
        font-size: 12px;
        letter-spacing: 0.3px;
        color: var(--default-color, #ccc);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #oct-header-title span.oct-icon { font-size: 14px; }
      #oct-controls { display: flex; gap: 5px; align-items: center; }
      .oct-btn {
        background: transparent;
        border: 1px solid var(--default-color-3, #3a3a5c);
        border-radius: 3px;
        color: var(--default-color, #ccc);
        cursor: pointer;
        font-size: 11px;
        padding: 1px 6px;
        line-height: 1.4;
        transition: background 0.15s;
      }
      .oct-btn:hover { background: rgba(255,255,255,0.08); }
      #oct-body {
        padding: 8px 6px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }
      #oct-panel.oct-minimized #oct-body { display: none; }
      #oct-status-bar {
        padding: 4px 10px;
        font-size: 10px;
        color: #888;
        border-top: 1px solid var(--default-color-3, #333);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
        background: var(--default-bg-panel-header-color, #12122a);
        gap: 6px;
      }
      #oct-panel.oct-minimized #oct-status-bar { display: none; }
      #oct-status-dot {
        width: 7px; height: 7px;
        border-radius: 50%;
        background: #888;
        flex-shrink: 0;
      }
      #oct-status-dot.ok      { background: #2b8a3e; }
      #oct-status-dot.loading { background: #e67700; animation: oct-pulse 0.9s infinite; }
      #oct-status-dot.error   { background: #c92a2a; }
      @keyframes oct-pulse {
        0%,100% { opacity:1; } 50% { opacity:0.35; }
      }
      #oct-error-msg {
        padding: 8px 10px;
        color: #ff6b6b;
        font-size: 11px;
        line-height: 1.5;
        word-break: break-word;
      }
      .oct-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .oct-table th {
        text-align: left;
        padding: 3px 6px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #888;
        border-bottom: 1px solid #333;
        white-space: nowrap;
        overflow: hidden;
      }
      .oct-table td {
        padding: 4px 6px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
      }
      .oct-table tr:last-child td { border-bottom: none; }
      .oct-table tr:hover td { background: rgba(255,255,255,0.04); }
      .oct-band-dot {
        display: inline-block;
        width: 8px; height: 8px;
        border-radius: 50%;
        margin-right: 4px;
        flex-shrink: 0;
        vertical-align: middle;
      }
      .oct-name-cell {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .oct-name-link {
        color: var(--default-blue-color, #5c9af5);
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
        display: inline-block;
        vertical-align: middle;
      }
      .oct-name-link:hover { text-decoration: underline; }
      .oct-empty {
        text-align: center;
        padding: 20px 10px;
        color: #666;
        font-size: 11px;
      }
      .oct-section-label {
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 6px 6px 2px;
        color: #666;
      }
      #oct-refresh-btn {
        font-size: 10px;
        padding: 1px 5px;
      }
    `;
    document.head.appendChild(s);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    // Restore saved position / size
    let pos  = { top: 80, left: 20 };
    let size = { width: 520, height: 420 };
    let minimized = false;

    try {
      const savedPos  = GM_getValue(CONFIG.PANEL_POS_STORAGE, null);
      const savedSize = GM_getValue(CONFIG.PANEL_SIZE_STORAGE, null);
      if (savedPos)  pos       = JSON.parse(savedPos);
      if (savedSize) size      = JSON.parse(savedSize);
      minimized = !!GM_getValue(CONFIG.MINIMIZED_STORAGE, false);
    } catch {}

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.top    = `${clampTop(pos.top)}px`;
    panel.style.left   = `${clampLeft(pos.left)}px`;
    panel.style.width  = `${size.width}px`;
    panel.style.height = `${size.height}px`;
    if (minimized) panel.classList.add("oct-minimized");

    panel.innerHTML = `
      <div id="oct-header">
        <div id="oct-header-title">
          <span class="oct-icon">🔫</span> OC Member Tracker
        </div>
        <div id="oct-controls">
          <button class="oct-btn" id="oct-refresh-btn" title="Refresh now">↺</button>
          <button class="oct-btn" id="oct-key-btn" title="Set API key">🔑</button>
          <button class="oct-btn" id="oct-min-btn" title="Minimize">${minimized ? "▲" : "▼"}</button>
        </div>
      </div>
      <div id="oct-body">
        <div class="oct-empty">Loading…</div>
      </div>
      <div id="oct-status-bar">
        <div style="display:flex;align-items:center;gap:5px;">
          <div id="oct-status-dot"></div>
          <span id="oct-status-text">—</span>
        </div>
        <span id="oct-last-refreshed" style="color:#555">—</span>
      </div>
    `;

    document.body.appendChild(panel);

    // Dragging
    makeDraggable(panel, document.getElementById("oct-header"));

    // Resize observer to save size
    const ro = new ResizeObserver(() => {
      try {
        GM_setValue(CONFIG.PANEL_SIZE_STORAGE, JSON.stringify({
          width:  panel.offsetWidth,
          height: panel.offsetHeight,
        }));
      } catch {}
    });
    ro.observe(panel);

    // Minimize
    document.getElementById("oct-min-btn").addEventListener("click", () => {
      const isMin = panel.classList.toggle("oct-minimized");
      document.getElementById("oct-min-btn").textContent = isMin ? "▲" : "▼";
      try { GM_setValue(CONFIG.MINIMIZED_STORAGE, isMin); } catch {}
    });

    // Refresh
    document.getElementById("oct-refresh-btn").addEventListener("click", () => refreshData(true));

    // API key
    document.getElementById("oct-key-btn").addEventListener("click", promptForApiKey);
  }

  function clampTop(v)  { return Math.max(0, Math.min(v, window.innerHeight - 40)); }
  function clampLeft(v) { return Math.max(0, Math.min(v, window.innerWidth  - 40)); }

  /* =========================================================
     DRAGGING
  ========================================================== */

  function makeDraggable(panel, handle) {
    let startX, startY, startLeft, startTop;

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();

      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = panel.offsetLeft;
      startTop  = panel.offsetTop;

      const onMove = (ev) => {
        const dx   = ev.clientX - startX;
        const dy   = ev.clientY - startY;
        const newL = clampLeft(startLeft + dx);
        const newT = clampTop(startTop  + dy);
        panel.style.left = `${newL}px`;
        panel.style.top  = `${newT}px`;
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
        try {
          GM_setValue(CONFIG.PANEL_POS_STORAGE, JSON.stringify({
            top:  panel.offsetTop,
            left: panel.offsetLeft,
          }));
        } catch {}
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  /* =========================================================
     STATUS + LAST REFRESHED
  ========================================================== */

  function setStatus(state, message) {
    const dot  = document.getElementById("oct-status-dot");
    const text = document.getElementById("oct-status-text");
    const body = document.getElementById("oct-body");

    // Remove old error message if recovering
    const oldErr = document.getElementById("oct-error-msg");
    if (oldErr) oldErr.remove();

    if (!dot || !text) return;

    dot.className = state; // "ok" | "loading" | "error"

    if (state === "loading") {
      text.textContent = "Fetching data…";
    } else if (state === "error") {
      text.textContent = "Error";
      // Inject error block above table if body exists
      if (body) {
        const errDiv = document.createElement("div");
        errDiv.id = "oct-error-msg";
        errDiv.textContent = "⚠ " + (message || "Unknown error");
        body.prepend(errDiv);
      }
    } else {
      text.textContent = "Ready";
    }
  }

  function updateLastRefreshed(ts) {
    const el = document.getElementById("oct-last-refreshed");
    if (!el) return;
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    el.textContent = `Last updated ${hh}:${mm}`;
  }

  /* =========================================================
     RENDER ROWS
  ========================================================== */

  const BAND_LABELS = {
    ok:     "✅ Just finished — normal cooldown (< 3h)",
    watch:  "🟠 Attention — out 3h – 24h",
    warn:   "🔴 Concern — out 1–7 days",
    danger: "🟣 Priority — out over 7 days",
    none:   "⬜ No OC history found",
  };

  function renderRows(rows) {
    const body = document.getElementById("oct-body");
    if (!body) return;

    // Always recompute time-sensitive fields (duration, band, etc.) from raw
    // timestamps so the display reflects the current moment, not fetch time.
    freshenRows(rows);

    // Remove old table & sections, keep error msg if present
    const oldErr = document.getElementById("oct-error-msg");
    body.innerHTML = "";
    if (oldErr) body.prepend(oldErr);

    if (!rows || rows.length === 0) {
      const d = document.createElement("div");
      d.className = "oct-empty";
      d.textContent = "🎉 All members are currently in an OC!";
      body.appendChild(d);
      return;
    }

    // Group by urgency band
    const groups = {};
    for (const row of rows) {
      if (!groups[row.band]) groups[row.band] = [];
      groups[row.band].push(row);
    }

    const bandOrder = ["none", "danger", "warn", "watch", "ok"];

    for (const band of bandOrder) {
      const group = groups[band];
      if (!group || group.length === 0) continue;

      // Section label
      const label = document.createElement("div");
      label.className = "oct-section-label";
      label.style.color = URGENCY_COLORS[band];
      label.textContent = BAND_LABELS[band];
      body.appendChild(label);

      // Table
      const table = document.createElement("table");
      table.className = "oct-table";

      // Header
      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr>
          <th style="width:28%">Member</th>
          <th style="width:24%">Out of OC for</th>
          <th style="width:24%">Last online</th>
          <th style="width:24%">Status</th>
        </tr>
      `;
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      for (const row of group) {
        const tr = document.createElement("tr");

        // Name cell
        const tdName = document.createElement("td");
        const nameWrap = document.createElement("div");
        nameWrap.className = "oct-name-cell";

        const dot = document.createElement("span");
        dot.className = "oct-band-dot";
        dot.style.background = URGENCY_COLORS[row.band];
        nameWrap.appendChild(dot);

        const a = document.createElement("a");
        a.className = "oct-name-link";
        a.href = `https://www.torn.com/profiles.php?XID=${row.id}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = row.name;
        a.title = `${row.name} [${row.id}]`;
        nameWrap.appendChild(a);
        tdName.appendChild(nameWrap);

        // Duration cell
        const tdDur = document.createElement("td");
        tdDur.textContent = row.duration;
        tdDur.style.color = URGENCY_COLORS[row.band];

        // Last online cell
        const tdOnline = document.createElement("td");
        tdOnline.textContent = row.lastOnline;
        tdOnline.style.color = row.lastOnlineColor;
        tdOnline.title = row.lastOnline;

        // Status cell
        const tdStatus = document.createElement("td");
        tdStatus.textContent = row.status;
        tdStatus.style.color = row.statusColor;
        tdStatus.title = row.status;

        tr.appendChild(tdName);
        tr.appendChild(tdDur);
        tr.appendChild(tdOnline);
        tr.appendChild(tdStatus);
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      body.appendChild(table);
    }
  }

  /* =========================================================
     AUTO-REFRESH
  ========================================================== */

  function startAutoRefresh() {
    setInterval(() => refreshData(false), CONFIG.REFRESH_MS);
  }

  /* =========================================================
     BOOT
  ========================================================== */

  function boot() {
    injectStyles();
    createPanel();

    // Try to show cached data immediately
    const cache = loadCache();
    if (cache && cache.rows) {
      renderRows(cache.rows);
      updateLastRefreshed(cache.time);
      setStatus("ok");
    }

    // Then refresh from API
    refreshData(false);
    startAutoRefresh();
  }

  function waitForBody() {
    if (document.body) { boot(); return; }
    const t = setInterval(() => {
      if (document.body) { clearInterval(t); boot(); }
    }, CONFIG.POLL_MS);
  }

  registerMenus();
  waitForBody();

})();
