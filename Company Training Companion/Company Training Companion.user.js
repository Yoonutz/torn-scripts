// ==UserScript==
// @name        Company Training Companion
// @namespace   kamiren.company-training-companion
// @match       https://www.torn.com/companies.php*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @author      KamiRen [2805199] - https://www.torn.com/profiles.php?XID=2805199
// @version     2.5
// @license     MIT
// @grant       GM_xmlhttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_registerMenuCommand
// @connect     script.google.com
// @connect     script.googleusercontent.com
// @connect     googleusercontent.com
// @description Adds a properly aligned Paid Trains column that will help Directors track how many paid trains their employees have left.
// @downloadURL https://update.greasyfork.org/scripts/558987/Company%20Training%20Companion.user.js
// @updateURL https://update.greasyfork.org/scripts/558987/Company%20Training%20Companion.meta.js
// ==/UserScript==

(function () {
  "use strict";

  /* =========================================================
     GLOBALS + FETCH
  ========================================================== */

  const CONFIG = Object.freeze({
    SNAPSHOT_URL_TEMPLATE: "https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec",
    SNAPSHOT_DEPLOYMENT_ID_KEY: "tcw_snapshot_deployment_id_v1",
    SNAPSHOT_STORAGE_KEY: "tcw_paid_trains_snapshot_v1",
    SNAPSHOT_AT_KEY: "tcw_paid_trains_snapshot_at",
    // kept for compatibility (but snapshot is authoritative now)
    PER_USER_PREFIX: "paidTrains_",
    POLL_MS: 300,
    REFRESH_MS: 5 * 60 * 1000, // 5 minutes
  });

  const SELECTORS = Object.freeze({
    header: "ul.employee-list-title.bold",
    employees:
      "#employees > form > div.employee-list-wrap > ul.employee-list.t-blue-cont.h > li[data-user]",
    trainButtons: ".employee-list .train a",
    stableObserveTarget: "#employees, .manage-company, .employee-list-wrap",
  });

  function getEmployeeId(li) {
    return li.getAttribute("data-user") || "";
  }

  function getEmployeeName(li) {
    const fromData =
      (li.dataset && li.dataset.name) ||
      li.getAttribute("data-name") ||
      li.getAttribute("data-user-name");
    if (fromData) return cleanName(fromData);

    const nameCandidates = [
      // common patterns (best-effort)
      '.name a[href*="profiles.php"]',
      '.employee-name a[href*="profiles.php"]',
      'a.user.name[href*="profiles.php"]',
      'a[href*="profiles.php?XID="]',
      'a[href*="profiles.php"]',
    ];

    for (const sel of nameCandidates) {
      const a = li.querySelector(sel);
      const t = cleanName(a?.textContent || "");
      if (t) return t;
    }
    return "";
  }

  function cleanName(s) {
    return String(s)
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "")
      .trim();
  }

  function getSnapshotDeploymentId() {
    try {
      if (typeof GM_getValue === "function") {
        return String(GM_getValue(CONFIG.SNAPSHOT_DEPLOYMENT_ID_KEY, "")).trim();
      }
    } catch {}
    return "";
  }

  function setSnapshotDeploymentId(id) {
    const cleaned = normalizeSnapshotDeploymentId_(id);
    if (!cleaned) return false;

    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(CONFIG.SNAPSHOT_DEPLOYMENT_ID_KEY, cleaned);
        return true;
      }
    } catch {}

    return false;
  }

  function normalizeSnapshotDeploymentId_(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    // Accept full URL like https://script.google.com/macros/s/<ID>/exec
    const fromUrl = raw.match(/\/macros\/s\/([^/?#]+)(?:\/exec)?/i);
    if (fromUrl && fromUrl[1]) {
      return fromUrl[1].trim();
    }

    // Accept plain deployment IDs like AKfycb...
    if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) {
      return raw;
    }

    return "";
  }

  function buildSnapshotUrl() {
    const deploymentId = getSnapshotDeploymentId();
    if (!deploymentId) return "";
    return CONFIG.SNAPSHOT_URL_TEMPLATE.replace("{DEPLOYMENT_ID}", deploymentId);
  }

  function registerSettingsMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;

    GM_registerMenuCommand("Set Snapshot Deployment ID", () => {
      const current = getSnapshotDeploymentId();
      const next = prompt("Paste Apps Script deployment ID (starts with AKfy...)", current);
      if (next === null) return;

      if (setSnapshotDeploymentId(next)) {
        alert("Deployment ID saved. Reload Torn page.");
      } else {
        alert("Invalid value. Paste either the deployment ID (AKfy...) or the full /macros/s/.../exec URL.");
      }
    });

    GM_registerMenuCommand("Show Snapshot Deployment ID", () => {
      const current = getSnapshotDeploymentId();
      alert(current ? `Current deployment ID: ${current}` : "No deployment ID set yet.");
    });
  }

  function ensureSnapshotDeploymentConfigured_() {
    const existing = getSnapshotDeploymentId();
    if (existing) return;

    const next = prompt(
      "Company Training Companion setup:\nPaste Apps Script deployment ID (AKfy...) or full /macros/s/.../exec URL"
    );
    if (!next) return;

    if (setSnapshotDeploymentId(next)) {
      alert("Snapshot deployment saved. Reload Torn page.");
    } else {
      alert("Invalid value. Open Violentmonkey menu and use 'Set Snapshot Deployment ID'.");
    }
  }

  function readSnapshotObject() {
    try {
      const raw = localStorage.getItem(CONFIG.SNAPSHOT_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function readSnapshotMap() {
    const obj = readSnapshotObject();
    const map = obj?.paidTrainsLeftByEmployee;
    if (!map || typeof map !== "object") return null;
    return map;
  }

  function writeSnapshotObject(obj) {
    try {
      localStorage.setItem(CONFIG.SNAPSHOT_STORAGE_KEY, JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  function setSnapshotValueByName(employeeName, newValue) {
    const obj = readSnapshotObject();
    if (!obj || typeof obj !== "object") return false;

    if (!obj.paidTrainsLeftByEmployee || typeof obj.paidTrainsLeftByEmployee !== "object") {
      obj.paidTrainsLeftByEmployee = {};
    }

    obj.paidTrainsLeftByEmployee[employeeName] = newValue;
    return writeSnapshotObject(obj);
  }

  function resolveTrainsValue(empLi) {
    const name = getEmployeeName(empLi);

    const map = readSnapshotMap();
    if (map && name && Object.prototype.hasOwnProperty.call(map, name)) {
      const v = map[name];
      if (v === "" || v == null) return "0";

      const num = parseInt(String(v), 10);
      return Number.isFinite(num) ? String(num) : "0";
    }

    const userId = getEmployeeId(empLi);
    if (userId) {
      const perUser = localStorage.getItem(CONFIG.PER_USER_PREFIX + userId);
      if (perUser != null && perUser !== "") return String(perUser);
    }

    return "0";
  }

  function fetchAndCacheSnapshot() {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest missing. Check @grant header."));
        return;
      }

      const snapshotUrl = buildSnapshotUrl();
      if (!snapshotUrl) {
        reject(new Error("Snapshot deployment ID is not set. Use Violentmonkey menu: Set Snapshot Deployment ID."));
        return;
      }

      GM_xmlhttpRequest({
        method: "GET",
        url:
          snapshotUrl +
          (snapshotUrl.includes("?") ? "&" : "?") +
          "t=" +
          Date.now(),
        timeout: 15000,
        onload: (resp) => {
          try {
            const status = resp.status ?? 0;
            const raw = String(resp.responseText || "");
            if (status && status !== 200) {
              throw new Error("HTTP " + status + " | " + raw.trim().slice(0, 160));
            }

            let text = raw.trim();
            if (text.startsWith(")]}'")) {
              const nl = text.indexOf("\n");
              text = nl !== -1 ? text.slice(nl + 1).trim() : "";
            }

            const data = JSON.parse(text);
            if (!data || typeof data !== "object" || typeof data.paidTrainsLeftByEmployee !== "object") {
              throw new Error("Invalid snapshot payload.");
            }
            localStorage.setItem(CONFIG.SNAPSHOT_STORAGE_KEY, JSON.stringify(data));
            localStorage.setItem(CONFIG.SNAPSHOT_AT_KEY, new Date().toLocaleString());
            resolve(data);
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
      });
    });
  }

  /* =========================================================
     INIT + LAYOUT
  ========================================================== */

  function injectStyles() {
    if (document.getElementById("paid-trains-style")) return;

    const style = document.createElement("style");
    style.id = "paid-trains-style";
    style.textContent = `
      .d .manage-company .employees .employee-list-title > li.paid-trains { width: 30px; }

      .d .manage-company .employees .employee-list .paid-trains {
        width: 30px;
        padding: 0 5px;
        margin-top: -1px;
        position: relative;
        float: left;
        height: 30px;
        line-height: 33px;
        border-left: 1px solid var(--default-panel-divider-inner-side-color);
        border-right: 1px solid var(--default-panel-divider-outer-side-color);
      }

      .d .manage-company .employees .employee-list .paid-trains .paid-trains-value {
        width: 100%;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 4px;
        padding: 0;
        line-height: 1;
        text-align: center;
        cursor: default;
        box-sizing: border-box;
      }

      .d .manage-company .employees .employee-list .paid-trains .paid-trains-value.daily-train {
        color: #2b8a3e;
        font-weight: bold;
      }

      /* Torn's content column is 784px; the Paid column adds 42px (30 content
         + 10 padding + 2 borders). Everything widened below is scaled to +42:
         container 976->1018, tabs (784+42)/4 - 12, stats (826/3) - 2. */
      .d .manage-company .company-tabs > li a { width: 194.5px !important; }
      .d .company-wrap .company-stats-list > li { width: 273.33px !important; }
    `;
    document.head.appendChild(style);
  }

  function resizeLayout() {
    const main = document.querySelector("#mainContainer");
    if (main && main.style.width !== "1018px") {
      main.style.width = "1018px";
    }
  }

  function bootstrap() {
    injectStyles();
    resizeLayout();

    ensureHeaderColumn();
    ensureEmployeeColumns();
    bindTrainButtons();
    updateAllTrainValues();

    fetchAndCacheSnapshot()
      .then(() => updateAllTrainValues())
      .catch(() => {});
  }

  function safeBootstrap() {
    if (safeBootstrap._pending) return;
    safeBootstrap._pending = true;
    requestAnimationFrame(() => {
      safeBootstrap._pending = false;
      bootstrap();
    });
  }
  safeBootstrap._pending = false;

  let observerCooldown = false;
  function startObserver() {
    const target = document.querySelector(SELECTORS.stableObserveTarget);
    if (!target) return;

    const observer = new MutationObserver((mutations) => {
      const hasStructureChange = mutations.some(
        (m) => m.type === "childList" && (m.addedNodes.length || m.removedNodes.length)
      );
      if (!hasStructureChange) return;

      if (observerCooldown) return;
      observerCooldown = true;

      requestAnimationFrame(() => {
        observerCooldown = false;
        ensureHeaderColumn();
        ensureEmployeeColumns();
        bindTrainButtons();
        updateAllTrainValues();
      });
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  function startAutoRefresh() {
    setInterval(() => {
      fetchAndCacheSnapshot()
        .then(() => updateAllTrainValues())
        .catch(() => {});
    }, CONFIG.REFRESH_MS);
  }

  function waitForPageReady() {
    const interval = setInterval(() => {
      if (document.querySelector(SELECTORS.header)) {
        clearInterval(interval);
        safeBootstrap();
        startObserver();
        startAutoRefresh();
      }
    }, CONFIG.POLL_MS);
  }

  /* =========================================================
     CORE LOGIC
  ========================================================== */

  function ensureHeaderColumn() {
    const header = document.querySelector(SELECTORS.header);
    if (!header) return;
    if (header.querySelector("li.paid-trains")) return;

    const trainHeader = header.querySelector("li.train");
    if (!trainHeader) return;

    const li = document.createElement("li");
    li.className = "paid-trains";
    li.textContent = "Paid";

    const delimiter = document.createElement("div");
    delimiter.className = "t-delimiter";
    li.appendChild(delimiter);

    header.insertBefore(li, trainHeader);
  }

  function ensureEmployeeColumns() {
    document.querySelectorAll(SELECTORS.employees).forEach((emp) => {
      const accBody = emp.querySelector(".acc-body");
      if (!accBody) return;
      if (accBody.querySelector(".paid-trains")) return;

      const trainCell = accBody.querySelector(".train");
      if (!trainCell) return;

      const wrap = document.createElement("div");
      wrap.className = "paid-trains";

      const delimiter = document.createElement("div");
      delimiter.className = "r-delimiter white t-show";

      const valueDiv = document.createElement("div");
      valueDiv.className = "paid-trains-value";
      valueDiv.setAttribute("aria-label", "Paid Trains");
      valueDiv.textContent = "0";

      wrap.appendChild(delimiter);
      wrap.appendChild(valueDiv);
      accBody.insertBefore(wrap, trainCell);
    });
  }

  function updateAllTrainValues() {
    document.querySelectorAll(SELECTORS.employees).forEach((emp) => {
      const valueDiv = emp.querySelector(".paid-trains-value");
      if (!valueDiv) return;

      const value = resolveTrainsValue(emp);
      valueDiv.textContent = value;
      updateDailyVisual(valueDiv);
    });
  }

  // A "Train" that renders as plain text (no href, or marked disabled) means
  // the employee cannot be trained right now - clicking it must not count down.
  function isTrainLinkActive(btn) {
    if (!btn || btn.tagName !== "A") return false;
    if (!btn.hasAttribute("href")) return false;
    if (btn.getAttribute("aria-disabled") === "true") return false;
    if (/\b(disabled?|inactive)\b/i.test(btn.className)) return false;
    return true;
  }

  function bindTrainButtons() {
    document.querySelectorAll(SELECTORS.trainButtons).forEach((btn) => {
      if (btn.dataset.ptBound) return;
      btn.dataset.ptBound = "1";

      btn.addEventListener("click", () => {
        if (!isTrainLinkActive(btn)) return;
        const emp = btn.closest('li[data-user]');
        if (!emp) return;
        decrementTrain(emp);
      });
    });
  }

  function decrementTrain(emp) {
    const name = getEmployeeName(emp);
    if (!name) return;

    let current = parseInt(resolveTrainsValue(emp), 10) || 0;
    if (current > 0) current--;

    // ✅ Write back to snapshot cache so UI stays correct and values "move" properly
    setSnapshotValueByName(name, current);

    updateAllTrainValues();
  }

  function updateDailyVisual(el) {
    const value = parseInt(el.textContent, 10) || 0;
    el.classList.toggle("daily-train", value < 0);
  }

  /* =========================================================
     BOOT
  ========================================================== */

  registerSettingsMenu();
  ensureSnapshotDeploymentConfigured_();
  waitForPageReady();
})();
