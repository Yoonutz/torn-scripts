// ==UserScript==
// @name        OC Member Tracker
// @namespace   kamiren.oc-member-tracker
// @match       https://www.torn.com/factions.php?step=your#/tab=crimes*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @author      KamiRen [2805199] - https://www.torn.com/profiles.php?XID=2805199
// @version     1.9.2
// @grant       GM_xmlhttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_registerMenuCommand
// @connect     api.torn.com
// @license     MIT
// @description Quickly see which faction members are not currently participating in Organized Crimes and how long they've been inactive. Perfect for faction leaders looking to recruit available players or keep track of member activity levels.
// ==/UserScript==

(function () {
  "use strict";

  /* =========================================================
     CONFIG
  ========================================================== */

  const CONFIG = Object.freeze({
    API_KEY_STORAGE:   "oct_api_key_v1",
    MINIMIZED_STORAGE: "oct_minimized_v1",
    CACHE_DATA_STORAGE:"oct_cache_data_v2",
    CACHE_TIME_STORAGE:"oct_cache_time_v2",
    REFRESH_MS:        60 * 60 * 1000,   // 1 hour
    POLL_MS:           500,
  });

  /* =========================================================
     STYLES & CONSTANTS
  ========================================================== */

  const PANEL_ID    = "oct-panel";
  const STYLE_ID    = "oct-style";
  const FACTION_ROOT_ID = "faction-crimes-root";

  /* URLs */
  const API_BASE_URL = "https://api.torn.com/v2";
  const TORN_BASE_URL = "https://www.torn.com";
  /* SVG Icons */
  const SVG_PLAY = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 3 14 9-14 9z"/></svg>`;
  const SVG_EXPAND = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="16" viewBox="0 0 11 16" class="grayFill___tkuer"><path d="M1302,21l-5,5V16Z" transform="translate(-1294 -13)"/></svg>`;
  const SVG_COLLAPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" class="grayFill___tkuer"><path d="M1302,21l-5,5V16Z" transform="translate(29 -1294) rotate(90)"/></svg>`;

  /* CSS Styles */
  const STYLES = `
    #oct-panel{ margin-top:14px; }
    #oct-panel .main___QuzF7{ background:var(--default-bg-panel-color); border-radius:5px; }
    #oct-panel #oct-content{ padding:5px; background:var(--default-bg-panel-color); border:1px solid var(--default-panel-divider-outer-side-color); border-top:none; border-radius:0 0 6px 6px; }

    #oct-panel .pill{ display:inline-block; border:1px solid var(--default-panel-divider-outer-side-color); border-radius:999px; padding:2px 8px; font-size:11px; background:var(--default-bg-panel-active-color); }
    #oct-panel .pill a{ color:var(--default-blue-color); text-decoration:underline; cursor:pointer; }
    #oct-panel .pills-row{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; align-items:center; }
    #oct-panel .pills-right{ margin-left:auto; display:flex; gap:6px; }
    #oct-panel .btn-icon{ width:28px; height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
    #oct-panel .btn-icon svg{ width:16px; height:16px; }
    #oct-panel .status-err{ color:#b00020; font-size:12px; margin-left:6px; display:none; }

    #oct-panel .header___f_BFs{ display:flex; align-items:center; padding:0 8px; }
    #oct-panel .icons___VmEI4{ margin-left:auto; display:flex; align-items:center; gap:6px; }
    #oct-panel .icons___VmEI4 .button___MO5cW{ background:transparent; border:0; padding:6px; line-height:0; cursor:pointer; }
    #oct-panel .icons___VmEI4 .grayFill___tkuer{ fill:#cfd6de; }
    #oct-panel .icons___VmEI4 .button___MO5cW:hover .grayFill___tkuer{ fill:#ffffff; }

    #oct-panel .grid{ display:grid; gap:8px; grid-template-columns:1fr; }
    #oct-panel .card{ border:1px solid var(--default-panel-divider-outer-side-color); border-radius:6px; background:var(--default-bg-panel-color); padding:8px; }
    #oct-panel .card--table{ padding:0; }
    #oct-panel .card h4{ margin:0; padding:8px 6px; font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--default-panel-divider-outer-side-color); }
    #oct-panel .oct-table{ width:100%; border-collapse:collapse; color:var(--default-color); }
    #oct-panel .oct-table th, #oct-panel .oct-table td{ padding:6px 12px; font-size:12px; border-bottom:1px solid var(--default-panel-divider-outer-side-color); vertical-align:middle; text-align:center !important; }
    #oct-panel .oct-table tr:last-child td { border-bottom: none; }
    #oct-panel .oct-table tr:hover td { background: rgba(255,255,255,0.04); }

    #oct-panel .oct-band-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; flex-shrink:0; vertical-align:middle; }
    #oct-panel .oct-name-cell { display:flex; align-items:center; justify-content:center; gap:2px; }
    #oct-panel .oct-name-link { color:var(--default-blue-color, #5c9af5); text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px; display:inline-block; vertical-align:middle; }
    #oct-panel .oct-name-link:hover { text-decoration:underline; }
    #oct-panel .oct-empty { text-align:center; padding:20px 12px; color:#666; font-size:11px; }

    #oct-panel, #oct-panel .card, #oct-panel .oct-table td, #oct-panel .oct-table th, #oct-panel .pill{ color:var(--default-color); }
    #oct-panel .icons___VmEI4 button, #oct-panel #oct-refresh-btn{ color:var(--default-color); }
    #oct-panel .icons___VmEI4 button svg, #oct-panel #oct-refresh-btn svg{ stroke:currentColor; fill:none; }
    #oct-panel #oct-refresh-btn[disabled]{ opacity:.55; }

    #oct-panel .header___f_BFs{ background:linear-gradient(180deg,#555,#333) no-repeat; border-bottom:2px solid transparent; border-radius:5px 5px 0 0; display:flex; height:34px; position:relative; }
    #oct-panel .title___nIMRx{ align-self:center; color:#fff; font:700 12px/14px Arial,sans-serif; margin-left:10px; text-shadow:0 0 2px #000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  `;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

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
    updateApiKeyPill();
    return true;
  }

  function promptForApiKey() {
    const current = getApiKey();
    const next = prompt(
      "OC Member Tracker\n\nPaste your Torn API key (needs 'Faction' access — read-only is fine):",
      current
    );
    if (next === null) return;
    if (!next.trim()) {
      alert("No key entered. Click Run to try again.");
      return;
    }
    setApiKey(next);
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
      gmFetch(`${API_BASE_URL}/faction?selections=members&key=${apiKey}`),
      gmFetch(`${API_BASE_URL}/faction?selections=crimes&cat=completed&limit=100&key=${apiKey}`),
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

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    // Find faction root container
    const factionRoot = document.getElementById(FACTION_ROOT_ID);
    if (!factionRoot) {
      console.log("[OCT] Waiting for #faction-crimes-root...");
      return false;
    }

    // Restore minimized state
    let minimized = false;
    try {
      minimized = !!GM_getValue(CONFIG.MINIMIZED_STORAGE, false);
    } catch {}

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "equipped-items-wrap";

    const hasKey = !!getApiKey();

    panel.innerHTML = `
      <div class="main___QuzF7">
        <header id="oct-header" class="header___f_BFs">
        <p class="title___nIMRx" role="heading" aria-level="2">OC Member Tracker</p>
        <nav class="icons___VmEI4">
          <button type="button" class="button___MO5cW iconParentButton___POutJ" id="oct-min-btn" aria-label="${minimized ? 'Open' : 'Collapse'}" aria-expanded="${!minimized}">
            ${minimized ? SVG_EXPAND : SVG_COLLAPSE}
          </button>
        </nav>
      </header>
      <div class="content___Gb8DR" id="oct-content" ${minimized ? 'hidden' : ''}>
        <div class="pills-row">
          <span id="oct-apikey-pill" class="pill">API key: <strong>${hasKey ? 'set' : 'not set'}</strong> · <a id="oct-editkey">${hasKey ? 'edit' : 'set'}</a></span>
          <span id="oct-status-pill" class="pill status-err" style="display: none;"></span>
          <span id="oct-refresh-pill" class="pill" style="display: none;"></span>
          <span class="pills-right">
            <button class="btn btn-icon" id="oct-refresh-btn" title="Run">${SVG_PLAY}</button>
          </span>
        </div>
        <div class="grid" id="oct-results"></div>
      </div>
    </div>
    `;

    // Insert after faction tabs (at the page level, not inside crimes root)
    const pageTabs = document.querySelector("#factions > ul.faction-tabs, #factions ul.faction-tabs");
    if (pageTabs && pageTabs.parentNode) {
      pageTabs.after(panel);
    } else {
      // Fallback: insert at beginning of faction-crimes-root
      factionRoot.insertBefore(panel, factionRoot.firstChild);
    }

    // API key edit link
    document.getElementById("oct-editkey")?.addEventListener("click", promptForApiKey);

    // Minimize toggle
    const content = document.getElementById("oct-content");
    const minBtn = document.getElementById("oct-min-btn");
    minBtn.addEventListener("click", () => {
      const isMin = !content.hasAttribute("hidden");
      if (isMin) {
        content.setAttribute("hidden", "");
        minBtn.innerHTML = SVG_EXPAND;
        minBtn.setAttribute("aria-label", "Open");
        minBtn.setAttribute("aria-expanded", "false");
      } else {
        content.removeAttribute("hidden");
        minBtn.innerHTML = SVG_COLLAPSE;
        minBtn.setAttribute("aria-label", "Collapse");
        minBtn.setAttribute("aria-expanded", "true");
      }
      try { GM_setValue(CONFIG.MINIMIZED_STORAGE, isMin); } catch {}
    });

    // Refresh / Run
    document.getElementById("oct-refresh-btn").addEventListener("click", () => refreshData(true));

    return true;
  }

  /* =========================================================
     STATUS + LAST REFRESHED
  ========================================================== */

  function setStatus(state, message) {
    const statusPill = document.getElementById("oct-status-pill");
    const refreshBtn = document.getElementById("oct-refresh-btn");

    if (!statusPill) return;

    if (state === "loading") {
      statusPill.style.display = "inline-block";
      statusPill.className = "pill status-loading";
      statusPill.textContent = "Loading…";
      if (refreshBtn) refreshBtn.disabled = true;
    } else if (state === "error") {
      statusPill.style.display = "inline-block";
      statusPill.className = "pill status-err";
      statusPill.textContent = message || "Error";
      if (refreshBtn) refreshBtn.disabled = false;
    } else if (state === "ok") {
      statusPill.style.display = "none";
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  function updateApiKeyPill() {
    const pill = document.getElementById("oct-apikey-pill");
    if (!pill) return;
    const hasKey = !!getApiKey();
    pill.innerHTML = `API key: <strong>${hasKey ? 'set' : 'not set'}</strong> · <a id="oct-editkey">edit</a>`;
    document.getElementById("oct-editkey")?.addEventListener("click", promptForApiKey);
  }

  function updateLastRefreshed(ts) {
    const pill = document.getElementById("oct-refresh-pill");
    if (!pill) return;
    if (!ts) {
      pill.style.display = "none";
      return;
    }
    const date = new Date(ts);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    pill.style.display = "inline-block";
    pill.textContent = `Updated ${timeStr}`;
  }

  /* =========================================================
     RENDER ROWS
  ========================================================== */

  const BAND_LABELS = {
    ok:     "Recently active",
    watch:  "Recently inactive",
    warn:   "Inactive for a while",
    danger: "Long time inactive",
  };

  function renderRows(rows) {
    const results = document.getElementById("oct-results");
    if (!results) return;

    freshenRows(rows);

    results.innerHTML = "";

    if (!rows || rows.length === 0) {
      results.innerHTML = `<div class="card card--table"><h4><span>Status</span></h4><div class="oct-empty">All members are currently in an OC!</div></div>`;
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

      const card = document.createElement("div");
      card.className = "card card--table";

      const table = document.createElement("table");
      table.className = "oct-table";

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

        const tdName = document.createElement("td");
        const nameWrap = document.createElement("div");
        nameWrap.className = "oct-name-cell";

        const dot = document.createElement("span");
        dot.className = "oct-band-dot";
        dot.style.background = URGENCY_COLORS[row.band];
        nameWrap.appendChild(dot);

        const a = document.createElement("a");
        a.className = "oct-name-link";
        a.href = `${TORN_BASE_URL}/profiles.php?XID=${row.id}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = row.name;
        a.title = `${row.name} [${row.id}]`;
        nameWrap.appendChild(a);
        tdName.appendChild(nameWrap);

        const tdDur = document.createElement("td");
        tdDur.textContent = row.duration;
        tdDur.style.color = URGENCY_COLORS[row.band];

        const tdOnline = document.createElement("td");
        tdOnline.textContent = row.lastOnline;
        tdOnline.style.color = row.lastOnlineColor;
        tdOnline.title = row.lastOnline;

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
      card.appendChild(table);
      results.appendChild(card);
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
    const created = createPanel();
    if (!created) return false; // Will retry

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
    return true;
  }

  function waitForFactionRoot() {
    const attempt = () => {
      const factionRoot = document.getElementById(FACTION_ROOT_ID);
      // Check if page-level tabs exist (they're outside faction-crimes-root)
      const pageTabs = document.querySelector("#factions ul.faction-tabs");

      if (!factionRoot || !pageTabs) {
        setTimeout(attempt, CONFIG.POLL_MS);
        return;
      }

      // Both exist - boot the panel
      const success = boot();
      if (!success) {
        setTimeout(attempt, CONFIG.POLL_MS);
      }
    };
    attempt();
  }

  registerMenus();
  waitForFactionRoot();

})();
