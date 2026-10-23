// ==UserScript==
// @name        Covy OC Requirements
// @namespace   Just Covy things
// @match       https://www.torn.com/factions.php*
// @icon        https://www.torn.com/favicon.ico
// @grant       GM_xmlhttpRequest
// @version     1.10.1
// @author      KamiRen [2805199]
// @license     MIT
// @description Shows OC requirements and role weights on the Torn faction page.
// @match       https://www.torn.com/organizedcrimes.php*
// @connect     tornprobability.com
// ==/UserScript==
 
(function () {
  'use strict';
 
  const OC_REQUIREMENTS = [
    { OC: '1/10',  Requirements: 70 },
    { OC: '2/10',  Requirements: 70 },
    { OC: '3/10',  Requirements: 70 },
    { OC: '4/10',  Requirements: 75 },
    { OC: '5/10',  Requirements: 75 },
    { OC: '6/10',  Requirements: 75 },
    { OC: '7/10',  Requirements: 70 },
    { OC: '8/10',  Requirements: 60 },
    { OC: '9/10',  Requirements: 50 },
    { OC: '10/10', Requirements: 0  },
  ];

  // Required item per crime + role slot, extracted from Torn API (faction crimes -> slot.item_requirement.id).
  // Key = exact crime panel title. Inner key = exact slot label as shown in-game, INCLUDING "#n".
  // Numbered slots can require DIFFERENT items (e.g. Bidding War Robber #1/#2/#3), so do NOT collapse them.
  // Slots with no item requirement are simply omitted -> those just pulse, no link (safe).
  const OC_ITEMS = {
    "Ace in the Hole":          { "Imitator": 1381 },
    "Manifest Cruelty":         { "Hacker": 73, "Interrogator": 1223, "Reviver": 884, "Cat Burglar": 1429 },
    "Blast from the Past":      { "Hacker": 103, "Engineer": 1431, "Bomber": 1430, "Muscle": 1429 },
    "Counter Offer":            { "Robber": 1429, "Looter": 1429, "Hacker": 70, "Picklock": 1203, "Engineer": 981 },
    "Stage Fright":             { "Lookout": 1258 },
    "Crane Reaction":           { "Lookout": 1258, "Engineer": 1430, "Bomber": 1230, "Muscle #2": 256 },
    "Leave No Trace":           { "Negotiator": 1350, "Imitator": 1350 },
    "Gaslight the Way":         { "Imitator #1": 643, "Imitator #2": 1381, "Imitator #3": 1381 },
    "Break the Bank":           { "Robber": 1331, "Muscle #1": 1331, "Muscle #2": 1429, "Muscle #3": 1331, "Thief #1": 1331, "Thief #2": 1331 },
    "Clinical Precision":       { "Imitator": 1094, "Assassin": 576, "Cleaner": 1012 },
    "Sneaky Git Grab":          { "Hacker": 71, "Techie": 579 },
    "Plucking the Lotus Petal": { "Hustler": 327 },
    "Bidding War":              { "Robber #1": 568, "Robber #2": 222, "Robber #3": 1284, "Bomber #1": 190, "Bomber #2": 190 },
    "Market Forces":            { "Arsonist": 172 },
    "Window of Opportunity":    { "Engineer": 981, "Looter #1": 980, "Looter #2": 1509, "Muscle #1": 1259, "Muscle #2": 1277 },
    "Dish It Out":              { "Assassin": 1363, "Muscle": 159, "Saboteur #1": 1461, "Saboteur #2": 1461, "Engineer": 981 },
    "Stacking the Deck":        { "Cat Burglar": 568, "Driver": 226, "Hacker": 73, "Imitator": 1381 },
    "Snow Blind":               { "Imitator": 201 },
    "Gone Fission":             { "Hijacker": 1429, "Engineer": 1461, "Pickpocket": 567, "Imitator": 1383, "Bomber": 190 },
    "No Reserve":               { "Car Thief": 159, "Techie": 856, "Engineer": 576 },
    "Honey Trap":               { "Enforcer": 1080, "Muscle #2": 1080 },
    "Guardian \u00c1ngels":     { "Engineer": 1331 },
  };

  const WEIGHTS_API_URL = 'https://tornprobability.com:3000/api/GetRoleWeights';
  let weightData = {};
  
  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .covy-lpz-requirement-stamp {
        position: absolute;
        top: -10px;
        right: 20px;
        width: 80px;
        height: 80px;
        z-index: 9999;
        pointer-events: none;
        opacity: 0.95;
        background-image: url("${WARNING_SVG_DATA_URI}");
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        display: none;
      }
      
      .covy-lpz-requirement-stamp.show {
        display: block;
      }
      
      .covy-oc-requirement {
        display: block;
        margin: 6px 10px 6px auto;
        width: fit-content;
        padding: 2px 8px;
        border: 1px solid #fff;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.4;
        white-space: nowrap;
        color: #fff;
      }
      
      .covy-oc-warning-icon {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 16px;
        height: 16px;
        z-index: 9999;
        pointer-events: none;
      }
 
      .oc-weight-box {
        margin-top: 6px;
        padding: 6px;
        text-align: center;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        background: rgba(255,255,255,0.03);
      }
 
      .oc-weight-box .oc-weight-label {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .05em;
        opacity: .8;
        padding-bottom: 3px;
        margin-bottom: 4px;
        border-bottom: 1px solid rgba(255,255,255,0.2);
      }
 
      .oc-weight-box .oc-weight-value {
        display: block;
        font-size: 16px;
        font-weight: 700;
        margin-top: 2px;
      }
 
      .covy-warning-bubble {
        position: absolute;
        top: -8px;
        right: -8px;
        width: 20px;
        height: 20px;
        background: #ff6600;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        color: #fff;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        z-index: 10000;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }
  
  function init() {
    injectStyle();
    injectStopSignPulse();
    installItemQuickLink();
    installPanelRequirements(OC_REQUIREMENTS);
    fetchWeights();
  }

  function marketUrl(id) {
    return `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${id}`;
  }

  function lookupItemId(crime, role) {
    const byCrime = OC_ITEMS[crime];
    if (!byCrime) return null;
    // Exact slot-label match (incl "#n"). Numbered slots differ, so no normalization.
    return byCrime[role] != null ? byCrime[role] : null;
  }

  // Make the pulsing stop-sign a one-click jump to that item's Item Market search.
  // Non-destructive: keeps the icon + pulse, just adds a click handler. Survives TornTools re-renders.
  function installItemQuickLink() {
    const wire = () => {
      try {
        document.querySelectorAll('div[class*="slotIcon"] div[class*="inactive"]').forEach((iconBox) => {
          if (iconBox.dataset.covyLinked) return;
          const btn = iconBox.closest('button');
          const card = iconBox.closest('[class*="contentLayer"]') || iconBox.closest('[data-oc-id]');
          const crime = card && card.querySelector('p[class*="panelTitle"]') ? card.querySelector('p[class*="panelTitle"]').textContent.trim() : null;
          const role = btn && btn.querySelector('span[class*="title"]') ? btn.querySelector('span[class*="title"]').textContent.trim() : null;
          if (!crime || !role) return;
          const id = lookupItemId(crime, role);
          if (id == null) return;
          iconBox.dataset.covyLinked = '1';
          iconBox.style.cursor = 'pointer';
          iconBox.title = `Buy required item — ${crime} / ${role}`;
          iconBox.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(marketUrl(id), '_blank');
          }, true);
        });
      } catch (e) { /* never throw */ }
    };
    wire();
    try { new MutationObserver(() => wire()).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* ignore */ }
    setInterval(wire, 1500);
  }

  // Make Torn's own red stop-sign icon (missing-item indicator) pulsate in place.
  // CSS-only: targets the existing inactive icon, so it survives TornTools re-renders.
  function injectStopSignPulse() {
    const ID = 'covy-stopsign-pulse-style';
    if (document.getElementById(ID)) return;
    const style = document.createElement('style');
    style.id = ID;
    style.textContent = `
      div[class*="slotIcon"] div[class*="inactive"] {
        animation: covy-stopsign-pulse 1s ease-in-out infinite;
        transform-origin: center;
      }
      div[class*="slotIcon"] div[class*="inactive"] svg path {
        fill: #ff1f1f !important;
        stroke: #ff1f1f !important;
      }
      @keyframes covy-stopsign-pulse {
        0%   { transform: scale(1);    opacity: 1;   }
        50%  { transform: scale(1.35); opacity: 0.45; }
        100% { transform: scale(1);    opacity: 1;   }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
 
  function getJsonData(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
 
          try {
            const parsed = JSON.parse(res.responseText);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Invalid JSON: ${e.message || e}`));
          }
        },
        onerror: () => reject(new Error('Network request failed')),
        ontimeout: () => reject(new Error('Request timed out'))
      });
    });
  }
 
  function ensureRelative(el) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  }

  function findPanelTitle(el) {
    let node = el;
    while (node) {
      const found = node.querySelector('p[class*="panelTitle"]');
      if (found) return found;
      node = node.parentElement;
    }
    return null;
  }

  function findMatchedRow(titleEl, rows) {
    const panelTitle = titleEl.textContent.trim();
    const panelBody = titleEl.parentElement?.querySelector('[class*="panelBody"]');
    const levelValue = parseNumber(panelBody?.querySelector('span[class*="levelValue"]')?.textContent);
    return rows.find(r => r.ocParts?.current === levelValue) || rows.find(r => r.OC === panelTitle);
  }

  function renderStampsOnUnqualifiedWrappers(rows) {
    document.querySelectorAll('div[class*="successChance"]').forEach((chanceDom) => {
      const chanceValue = parseNumber(chanceDom.textContent);
      if (chanceValue == null) return;

      const wrapper = chanceDom.closest('div[class*="wrapper"]');
      if (!wrapper) return;

      const titleEl = findPanelTitle(wrapper);
      if (!titleEl) return;

      const matchedRow = findMatchedRow(titleEl, rows);
      const requiredValue = matchedRow ? parseNumber(matchedRow.Requirements) : null;
      if (requiredValue == null) return;

      const isUnqualified = chanceValue < requiredValue;
      const badgeContainer = wrapper.querySelector('[class*="badgeContainer"]');
      const button = wrapper.querySelector('button[class*="torn-btn"]');

      if (badgeContainer) {
        const existingBubble = badgeContainer.querySelector('.covy-warning-bubble');
        if (isUnqualified && !existingBubble) {
          ensureRelative(badgeContainer);
          const bubble = document.createElement('div');
          bubble.className = 'covy-warning-bubble';
          bubble.textContent = '!';
          bubble.title = 'Warning: Low chance!';
          badgeContainer.appendChild(bubble);
        } else if (!isUnqualified) {
          existingBubble?.remove();
        }
      }

      ensureRelative(wrapper);
      let stamp = wrapper.querySelector('.covy-lpz-requirement-stamp');
      let icon = wrapper.querySelector('.covy-oc-warning-icon');

      if (isUnqualified) {
        if (!stamp) {
          stamp = document.createElement('div');
          stamp.className = 'covy-lpz-requirement-stamp';
          wrapper.appendChild(stamp);
        }
        stamp.classList.add('show');

        if (!icon) {
          icon = document.createElement('img');
          icon.className = 'covy-oc-warning-icon';
          icon.src = WARNING_SVG_DATA_URI;
          icon.alt = 'Warning';
          wrapper.appendChild(icon);
        }

        if (button) {
          button.disabled = true;
          button.classList.add('torn-btn--disabled');
        }
      } else {
        stamp?.classList.remove('show');
        icon?.remove();
        if (button?.classList.contains('torn-btn--disabled')) {
          button.disabled = false;
          button.classList.remove('torn-btn--disabled');
        }
      }
    });
  }
 
  function parseOcParts(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!match) {
      return null;
    }
 
    return {
      current: Number(match[1]),
      total: Number(match[2]),
      key: `${match[1]}/${match[2]}`
    };
  }
 
  function normalizeRows(data) {
    if (!Array.isArray(data)) {
      return [];
    }
 
    return data
      .map((row) => {
        const ocText = String(row?.OC ?? '').trim();
        const requirements = String(row?.Requirements ?? '').trim();
        return { OC: ocText, Requirements: requirements, ocParts: parseOcParts(ocText) };
      })
      .filter((row) => row.OC.length > 0);
  }
 
  function normalizeKey(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
 
  function addWeightBoxes(ocRoot) {
    const ocNameEl = ocRoot.querySelector('p[class*="panelTitle"]');
    if (!ocNameEl) return;
 
    const ocKey = normalizeKey(ocNameEl.textContent.trim());
    const ocWeights = weightData[ocKey];
    if (!ocWeights) return;
 
    const roles = Array.from(ocRoot.querySelectorAll('div[class*="wrapper"]:not([data-oc-id])'));
    roles.forEach((role) => {
      if (role.querySelector('.oc-weight-box')) return;
 
      const titleEl = role.querySelector('[class*="title"]:not([class*="panelTitle"])');
      if (!titleEl || titleEl.closest('div[class*="wrapper"]') !== role) return;
      const roleKey = normalizeKey(titleEl.textContent.trim());
      const weight = ocWeights[roleKey];
      if (weight == null) return;
 
      const box = document.createElement('div');
      box.className = 'oc-weight-box';
      box.innerHTML = `<span class="oc-weight-label">Weight</span><span class="oc-weight-value">${weight.toFixed(1)}%</span>`;
      role.appendChild(box);
    });
  }
 
  function scanWeights() {
    document.querySelectorAll('div[class*="wrapper"][data-oc-id]').forEach(addWeightBoxes);
  }
 
  async function fetchWeights() {
    try {
      const data = await getJsonData(WEIGHTS_API_URL);
      weightData = {};
      for (const [ocName, roles] of Object.entries(data)) {
        const ocKey = normalizeKey(ocName);
        weightData[ocKey] = {};
        for (const [roleName, value] of Object.entries(roles)) {
          weightData[ocKey][normalizeKey(roleName)] = value;
        }
      }
      scanWeights();
    } catch (err) {
      console.error('[OC Weights] Failed to fetch weights:', err);
    }
  }
 
  function setRequirementBadge(titleElement, text) {
    const panelContainer = titleElement.parentElement;
    if (!panelContainer) {
      return;
    }
 
    const panelBody = panelContainer.querySelector(':scope > div[class*="panelBody"]')
      || panelContainer.querySelector('[class*="panelBody"]');
 
    let badge = panelContainer.querySelector('.covy-oc-requirement');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'covy-oc-requirement';
    }
 
    if (panelBody) {
      if (badge.nextSibling !== panelBody || badge.parentElement !== panelContainer) {
        panelContainer.insertBefore(badge, panelBody);
      }
    } else if (badge.parentElement !== panelContainer) {
      panelContainer.appendChild(badge);
    }
 
    if (badge.textContent !== text) {
      badge.textContent = text;
    }
  } 
 
  function nodeTouchesPanelTitle(node) {
    if (!(node instanceof Element)) return false;
    const selectors = ['p[class*="panelTitle"]', 'span[class*="levelValue"]', 'div[class*="successChance"]', 'div[class*="wrapper"]'];
    return selectors.some(s => node.matches(s) || node.querySelector(s) !== null);
  }
 
  function parseNumber(value) {
    if (value == null) {
      return null;
    }
 
    const cleaned = String(value).replace(/[^\d.-]/g, '');
    if (!cleaned) {
      return null;
    }
 
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
 
  function applyRequirementsToPanels(rows) {
    const titles = Array.from(document.querySelectorAll('p[class*="panelTitle"]'));
    if (!titles.length) return;
 
    const withParts = rows.filter(r => r.ocParts).sort((a, b) => a.ocParts.current - b.ocParts.current);
 
    titles.forEach((titleElement, index) => {
      const matched = findMatchedRow(titleElement, rows) || withParts[index];
      const val = matched ? parseNumber(matched.Requirements) : null;
      setRequirementBadge(titleElement, `Required: ${val ?? matched?.Requirements ?? '-'}`);
    });
  }
 
  function installPanelRequirements(data) {
    const rows = normalizeRows(data);
 
    const render = () => {
      applyRequirementsToPanels(rows);
      renderStampsOnUnqualifiedWrappers(rows);
      scanWeights();
    };
    render();
 
    let scheduleId = 0;
    const observer = new MutationObserver((mutations) => {
      const shouldRender = mutations.some(m =>
        [...m.addedNodes, ...m.removedNodes].some(n => nodeTouchesPanelTitle(n))
      );
 
      if (!shouldRender) {
        return;
      }
 
      if (scheduleId) {
        return;
      }
 
      scheduleId = window.setTimeout(() => {
        scheduleId = 0;
        render();
      }, 120);
    });
 
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
 


  const WARNING_SVG_DATA_URI = 'data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjRjAwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNzUgMjIzIj48cGF0aCBkPSJNMCAwQzAgMCAwIDAgMCAwQzAgMSAwIDEgMSAyQzEgMSAyIDEgMiAxQzIgMSAyIDEgMyAxQzQgMSA0IDEgNCAxQzQgMyA0IDMgMyA0QzMgNCAzIDQgMyA0QzMgNSAzIDUgNCA2QzEgOC0xIDktMyAxMUMtNCAxMi02IDEzLTcgMTRDLTkgMTUtMTEgMTYtMTIgMTdDLTE0IDE4LTE1IDE5LTE2IDIwQy0xNyAyMS0xOSAyMi0yMCAyM0MtMjIgMjQtMjQgMjUtMjUgMjdDLTI3IDI4LTI4IDI5LTI5IDI5Qy0zMCAzMC0zMiAzMS0zMyAzMkMtMzUgMzQtMzcgMzUtNDAgMzdDLTQwIDM3LTQxIDM4LTQyIDM4Qy00MiAzOS00MyAzOS00MyAzOUMtNDQgNDAtNDQgNDAtNDQgNDBDLTQ1IDQxLTQ2IDQyLTQ4IDQyQy00OCA0MS00OCA0MS00OCA0MEMtNDggNDAtNDggNDAtNDkgNDBDLTUwIDQxLTUxIDQxLTUyIDQwQy01MyA0MC01NCA0MC01NCAzOUMtNTQgNDAtNTQgNDAtNTQgNDBDLTU0IDQwLTU0IDQwLTU0IDQxQy01NCA0MS01NCA0MS01NCA0MkMtNTQgNDMtNTQgNDMtNTQgNDRDLTU0IDQ0LTU0IDQ0LTU0IDQ1Qy01NCA0NS01NCA0NS01NCA0NUMtNTMgNDQtNTMgNDUtNTIgNDVDLTUzIDQ2LTU0IDQ3LTU1IDQ4Qy01NSA0OC01NiA0OC01NiA0OEMtNTYgNDktNTcgNDktNTcgNDlDLTU4IDUwLTU4IDUwLTU5IDUxQy02MCA1MS02MCA1Mi02MSA1MkMtNjIgNTMtNjMgNTMtNjMgNTRDLTY2IDU1LTY4IDU3LTcwIDU4Qy03MSA1OS03MyA2MC03NCA2MUMtNzYgNjMtNzggNjQtODEgNjZDLTgyIDY3LTgzIDY4LTg0IDY5Qy04NCA2OS04NSA2OS04NSA2OUMtODYgNzAtODYgNzAtODcgNzFDLTkwIDcyLTkyIDc0LTk1IDc2Qy05NSA3Ni05NSA3Ni05NSA3NkMtOTYgNzYtOTYgNzctOTYgNzdDLTk3IDc3LTk3IDc4LTk4IDc4Qy0xMDAgNzktMTAyIDgwLTEwNCA4MEMtMTA0IDc4LTEwMyA3Ny0xMDIgNzZDLTEwMiA3Ni0xMDIgNzYtMTAxIDc2Qy0xMDEgNzYtMTAxIDc2LTEwMSA3NkMtMTAxIDc1LTEwMSA3NS0xMDEgNzVDLTEwMSA3NS0xMDEgNzQtMTAwIDc0Qy0xMDAgNzMtMTAwIDczLTEwMCA3MkMtMTAwIDcyLTEwMCA3Mi0xMDAgNzJDLTEwMSA3My0xMDIgNzQtMTAzIDc0Qy0xMDMgNzQtMTA0IDc1LTEwNCA3NUMtMTA1IDc1LTEwNSA3Ni0xMDUgNzZDLTEwNSA3Ni0xMDYgNzYtMTA2IDc2Qy0xMDcgNzctMTA4IDc3LTEwOCA3N0MtMTA5IDc3LTEwOSA3Ny0xMDkgNzhDLTEwOSA3OC0xMTAgNzktMTEwIDgwQy0xMTMgODAtMTE3IDc4LTExOSA3N0MtMTIwIDc2LTEyMCA3Ni0xMjEgNzZDLTEyMSA3NS0xMjEgNzUtMTIyIDc1Qy0xMjQgNzQtMTI1IDcxLTEyNyA2OUMtMTI4IDY4LTEyOCA2Ny0xMjkgNjVDLTEyOSA2NS0xMzAgNjUtMTMwIDY1Qy0xMzAgNjQtMTMwIDY0LTEzMSA2NEMtMTMzIDYxLTEzNSA1Ny0xMzcgNTRDLTEzOCA1My0xMzkgNTItMTM5IDUyQy0xNDAgNTEtMTQwIDUxLTE0MCA1MEMtMTQwIDUwLTE0MCA1MC0xNDEgNTBDLTE0MSA0OS0xNDEgNDktMTQyIDQ4Qy0xNDIgNDgtMTQyIDQ4LTE0MiA0OEMtMTQyIDQ3LTE0MyA0Ny0xNDMgNDZDLTE0NCA0NS0xNDQgNDQtMTQ1IDQ0Qy0xNDUgNDMtMTQ1IDQzLTE0NiA0M0MtMTQ2IDQyLTE0NiA0Mi0xNDcgNDJDLTE0NyA0Mi0xNDcgNDEtMTQ3IDQxQy0xNDcgNDEtMTQ3IDQxLTE0NyA0MUMtMTQ4IDQwLTE0OCA0MC0xNDcgNDBDLTE0NyAzOC0xNDQgMzctMTQzIDM2Qy0xNDIgMzYtMTQyIDM2LTE0MiAzNkMtMTQxIDM2LTE0MSAzNy0xNDEgMzdDLTE0MCAzNy0xNDAgMzctMTQwIDM4Qy0xNDAgMzgtMTQwIDM4LTE0MCAzOEMtMTQwIDM5LTEzOSAzOS0xMzkgMzlDLTEzOSAzOS0xMzkgNDAtMTM5IDQwQy0xMzggNDEtMTM3IDQyLTEzNyA0M0MtMTM2IDQ0LTEzNSA0Ni0xMzQgNDdDLTEzMiA0OS0xMzEgNTEtMTI5IDUzQy0xMjkgNTQtMTI4IDU1LTEyOCA1NUMtMTI3IDU2LTEyNyA1Ni0xMjcgNTdDLTEyNiA1Ny0xMjUgNTgtMTI1IDU5Qy0xMjMgNjItMTIyIDY0LTEyMCA2NkMtMTIwIDY2LTEyMCA2Ni0xMTkgNjZDLTExOSA2Ny0xMTkgNjctMTE5IDY3Qy0xMTkgNjctMTE5IDY3LTExOCA2OEMtMTE5IDY4LTExOSA2OC0xMTkgNjhDLTExOSA2OC0xMTkgNjgtMTIwIDY4Qy0xMjAgNjktMTIwIDY5LTEyMCA3MEMtMTE5IDY5LTExOSA2OS0xMTggNjlDLTExNyA2OS0xMTYgNjktMTE1IDcwQy0xMTUgNzAtMTE1IDcwLTExNCA3MEMtMTEzIDcxLTExMyA3MS0xMTMgNzJDLTExMyA3Mi0xMTMgNzMtMTEzIDc0Qy0xMTQgNzQtMTE0IDc0LTExNSA3NEMtMTE2IDc0LTExNiA3NC0xMTcgNzRDLTExNyA3NS0xMTYgNzYtMTE1IDc2Qy0xMTUgNzYtMTE1IDc2LTExNSA3NkMtMTE1IDc2LTExNCA3Ni0xMTQgNzVDLTExNCA3NC0xMTMgNzQtMTEyIDc0Qy0xMTIgNzMtMTEyIDczLTExMSA3M0MtMTExIDcyLTExMCA3Mi0xMDkgNzJDLTEwOSA3Mi0xMDkgNzItMTA4IDcyQy0xMDggNzItMTA4IDcyLTEwOCA3MkMtMTAzIDcyLTEwMCA3MS05NiA2OEMtOTYgNjgtOTYgNjgtOTYgNjhDLTkzIDY2LTkxIDY0LTg4IDYyQy04NiA2MS04NCA1OS04MiA1OEMtNzkgNTYtNzcgNTUtNzUgNTNDLTczIDUxLTcwIDUwLTY4IDQ4Qy02NiA0Ni02MyA0NS02MCA0M0MtNTkgNDItNTcgNDAtNTYgMzlDLTU0IDM4LTUzIDM3LTUxIDM2Qy01MCAzNS00OCAzNC00NiAzM0MtNDUgMzItNDQgMzEtNDMgMzBDLTQxIDI5LTM5IDI4LTM3IDI2Qy0zNyAyNi0zNyAyNi0zNiAyNkMtMzYgMjUtMzUgMjUtMzUgMjVDLTM1IDI1LTM1IDI1LTM0IDI0Qy0zMyAyNC0zMyAyNC0zMyAyNEMtMzMgMjQtMzIgMjQtMzIgMjRDLTMyIDI0LTMyIDI1LTMzIDI1Qy0zMyAyNi0zMyAyNy0zMiAyOEMtMzIgMjgtMzEgMjktMzAgMjlDLTI5IDI4LTI4IDI4LTI4IDI3Qy0yNyAyNy0yNyAyNy0yOCAyNkMtMjggMjYtMjkgMjUtMjkgMjVDLTI5IDI0LTI5IDIzLTI4IDIyQy0yNyAyMi0yNyAyMi0yNiAyMkMtMjYgMjEtMjYgMjEtMjcgMjBDLTI3IDIwLTI3IDIxLTI3IDIxQy0yNyAyMS0yNyAyMS0yNyAyMUMtMjcgMjEtMjggMjEtMjggMjJDLTI4IDIxLTI4IDIxLTI4IDIxQy0yOCAyMC0yOCAyMC0yNyAxOUMtMjcgMTktMjcgMTktMjcgMTlDLTI1IDE3LTIzIDE2LTIyIDE1Qy0yMSAxNS0yMSAxNC0yMCAxNEMtMjAgMTQtMjAgMTQtMjAgMTRDLTIwIDE0LTE5IDEzLTE5IDEzQy0xOSAxMy0xOCAxMy0xOCAxM0MtMTcgMTMtMTcgMTMtMTcgMTNDLTE3IDEzLTE3IDEzLTE3IDEyQy0xNSA5LTExIDgtOCA2Qy04IDYtOCA2LTcgNkMtNyA2LTcgNi03IDZDLTcgNS03IDUtNyA1Qy02IDQtNSAzLTQgMkMtMyAyLTMgMi0zIDJDLTIgMS0xIDEgMCAwWk0tNiA4Qy01IDgtNSA4LTUgOUMtNSA5LTUgOC01IDhDLTUgOC01IDgtNiA4Wk0tMzQgMjlDLTM0IDMwLTM0IDMwLTM0IDMwQy0zMyAzMC0zMyAzMC0zMyAzMEMtMzMgMzAtMzMgMzAtMzQgMjlDLTM0IDI5LTM0IDI5LTM0IDI5Wk0tNDAgMzRDLTQwIDM0LTQwIDM0LTQwIDM1Qy00MCAzNS00MCAzNS00MCAzNUMtNDAgMzUtNDAgMzQtNDAgMzRDLTQwIDM0LTQwIDM0LTQwIDM0Wk0tNTggNDZDLTU4IDQ2LTU4IDQ2LTU4IDQ2Wk0tODggNjRDLTg4IDY0LTg4IDY0LTg4IDY1Qy04NyA2NC04NyA2NC04NyA2NEMtODcgNjQtODcgNjQtODggNjRaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxNTIsMTQ0KSIvPjxwYXRoIGQ9Ik0wIDBDMSAxIDIgMiAzIDRDMyA1IDMgNSAzIDZDMiA2IDIgNyAyIDdDMSA4IDEgOCAxIDhDMiA5IDIgMTAgMyAxMEMzIDExIDMgMTEgMyAxMUM0IDEyIDQgMTIgNCAxMkM1IDEzIDUgMTQgNiAxNUM3IDE2IDggMTggOSAxOUMxMCAyMSAxMSAyMyAxMyAyNEMxMyAyNSAxNCAyNiAxNSAyN0MxNSAyNyAxNSAyOCAxNSAyOEMxNiAyOSAxNiAyOSAxNyAzMEMxNyAzMSAxOCAzMSAxOCAzMkMxOCAzMiAxOCAzMyAxOSAzM0MxOSAzNCAyMCAzNSAyMSAzNkMyMSAzNiAyMSAzNiAyMSAzNkMyMSAzNyAyMSAzNyAyMSAzN0MyMCAzOSAxNyA0MSAxNSA0MkMxMyA0MiAxMCA0MCA4IDM5QzggMzkgOCAzOSA3IDM5QzYgMzkgNiAzOCA1IDM4QzQgMzcgMyAzNyAzIDM3QzEgMzYgMCAzNi0xIDM1Qy0xIDM1LTEgMzUtMSAzNEMtMSAzNC0xIDMzLTEgMzJDLTEgMzItMSAzMi0yIDMzQy0yIDM0LTIgMzQtMiAzNEMtMyAzNC01IDMzLTYgMzNDLTYgMzMtNiAzMy03IDMyQy03IDMyLTggMzItOCAzMkMtOSAzMS0xMCAzMS0xMCAzMUMtMTEgMzEtMTEgMzAtMTIgMzBDLTEzIDMwLTEzIDMwLTE0IDMwQy0xMiAzMS0xMSAzMy0xMCAzNUMtOSAzNi05IDM2LTggMzdDLTcgMzktNSA0Mi00IDQ0Qy0zIDQ0LTMgNDQtMyA0M0MtMyA0My0yIDQzLTIgNDNDLTIgNDMtMiA0My0xIDQzQzAgNDIgMSA0MiAyIDQyQzMgNDIgNCA0NCA1IDQ1QzUgNDYgNSA0NyA1IDQ4QzQgNDkgNCA0OSAzIDUwQzMgNTAgMyA1MCAzIDUwQzIgNTAgMiA1MSAxIDUxQzEgNTEgMSA1MSAwIDUyQzAgNTItMSA1My0yIDUzQy0yIDUzLTIgNTQtMyA1NEMtNyA1Ny03IDU3LTkgNTdDLTExIDU3LTExIDU2LTEyIDU0Qy0xMyA1My0xMyA1Mi0xMiA1MUMtMTIgNTAtMTEgNTAtMTEgNDlDLTExIDQ5LTExIDQ5LTExIDQ5Qy0xMSA0OC0xMSA0OC0xMSA0OEMtMTEgNDgtMTIgNDgtMTIgNDhDLTEyIDQ3LTEyIDQ3LTEzIDQ2Qy0xMyA0NS0xNCA0NC0xNSA0M0MtMTYgNDEtMTggMzktMTkgMzdDLTIwIDM2LTIxIDM1LTIyIDMzQy0yMiAzMy0yMiAzMy0yMiAzM0MtMjMgMzItMjQgMzEtMjQgMzBDLTI0IDMwLTI1IDMwLTI1IDI5Qy0yNSAyOS0yNSAyOS0yNSAyOUMtMjYgMjgtMjYgMjgtMjYgMjdDLTI2IDI3LTI2IDI4LTI3IDI4Qy0yOCAyOC0yOCAyOS0zMCAyOEMtMzEgMjgtMzIgMjctMzMgMjZDLTMzIDI1LTMzIDI0LTMzIDIzQy0zMyAyMi0zMiAyMS0zMCAyMEMtMzAgMjAtMzAgMjAtMzAgMjBDLTMwIDIwLTMwIDIxLTMwIDIxQy0yOSAyMS0yOSAyMS0yOCAyMUMtMjggMjAtMjggMjAtMjcgMjBDLTI4IDIwLTI4IDIwLTI4IDE5Qy0yOCAxOS0yOCAxOS0yOCAxOUMtMjggMTgtMjggMTgtMjcgMThDLTI2IDE4LTI2IDE4LTI2IDE4Qy0yNiAxOC0yNiAxOS0yNiAxOUMtMjUgMTktMjUgMTktMjUgMTlDLTI1IDE5LTI1IDE5LTI0IDE5Qy0yNCAxOS0yNCAxOS0yNCAxOUMtMjMgMTktMjMgMTktMjMgMTlDLTIyIDIwLTIyIDIwLTIyIDIxQy0yMiAyMS0yMiAyMS0yMyAyMkMtMjQgMjItMjQgMjItMjQgMjJDLTI1IDIyLTI1IDIyLTI1IDIyQy0yNCAyMy0yMyAyMy0yMiAyNEMtMjIgMjQtMjIgMjQtMjEgMjRDLTIwIDI0LTIwIDI1LTE4IDI0Qy0xOCAyNC0xNyAyMy0xNyAyM0MtMTYgMjMtMTYgMjMtMTYgMjNDLTE1IDIyLTE1IDIyLTE1IDIxQy0xNSAyMC0xNSAyMC0xNSAyMEMtMTQgMjAtMTMgMjAtMTIgMjBDLTEyIDIxLTEyIDIxLTExIDIxQy0xMSAyMS0xMSAyMS0xMCAyMUMtMTAgMjEtMTAgMjEtMTAgMjJDLTYgMjQtNiAyNC00IDI1Qy00IDI1LTQgMjUtNCAyNUMtNCAyNS00IDI1LTQgMjVDLTIgMjUtMSAyNiAwIDI2QzAgMjYgMCAyNiAxIDI2QzIgMjcgMyAyNyA0IDI4QzQgMjggNCAyOCA0IDI4QzQgMjggNCAyNyA0IDI3QzMgMjcgMyAyNiAyIDI1QzIgMjUgMiAyNSAyIDI1QzIgMjQgMiAyNCAxIDI0QzEgMjQgMSAyNCAxIDI0QzEgMjMgMSAyMyAxIDIyQzEgMjIgMSAyMSAxIDIxQzEgMjEgMCAyMSAwIDIxQzAgMjEgMCAyMSAwIDIxQzAgMjEtMSAyMC0xIDIwQy0xIDIwLTEgMjAtMSAyMEMtMSAxOS0yIDE5LTMgMThDLTMgMTgtNCAxNy00IDE2Qy00IDE2LTQgMTYtNCAxNkMtNSAxNS02IDE0LTYgMTNDLTYgMTMtNyAxMy03IDE0Qy03IDE0LTcgMTQtOCAxNEMtOCAxNC04IDE0LTggMTVDLTEwIDE1LTEwIDE1LTEyIDE1Qy0xMyAxNS0xNCAxNC0xNSAxMkMtMTUgMTEtMTUgMTEtMTUgMTBDLTE0IDgtMTMgNy0xMSA2Qy0xMSA2LTExIDYtMTEgNkMtMTAgNS05IDUtOCA0Qy04IDUtOCA1LTggNkMtOCA2LTggNi04IDZDLTcgNi03IDYtNyA2Qy02IDYtNiA2LTYgN0MtNiA3LTYgOC02IDhDLTQgOS0zIDktMiA5Qy0yIDktMiA4LTIgOEMtMiA4LTIgNy0yIDdDLTIgNy0yIDctMiA2Qy0yIDYtMiA1LTIgNUMtMSA1IDAgNSAwIDRDMCA0IDAgNC0xIDRDLTEgNC0xIDQtMSA0Qy0yIDQtMiA0LTIgNEMtNCA1LTUgNS02IDRDLTYgMy02IDMtNiAzQy00IDEtMyAwIDAgMFpNLTEwIDEwQy0xMCAxMC0xMCAxMC0xMCAxMUMtOSAxMC05IDEwLTkgMTBDLTkgMTAtMTAgMTAtMTAgMTBaTS0yIDEwQy0xIDExLTEgMTItMSAxMkMtMSAxMi0xIDEyIDAgMTJDLTEgMTEtMSAxMS0xIDExQy0xIDExLTEgMTEtMiAxMFpNLTExIDI1Qy0xMSAyNS0xMiAyNS0xMiAyNkMtMTIgMjYtMTIgMjYtMTIgMjZDLTExIDI2LTExIDI2LTExIDI2Qy0xMSAyNi0xMSAyNS0xMSAyNVpNMTQgMzBDMTQgMzAgMTQgMzEgMTQgMzFDMTQgMzEgMTQgMzEgMTUgMzFDMTUgMzEgMTUgMzAgMTUgMzBDMTUgMzAgMTQgMzAgMTQgMzBaTTcgMzdDNyAzNyA3IDM4IDcgMzhDNyAzOCA3IDM4IDggMzhDOCAzOCA3IDM3IDcgMzdDNyAzNyA3IDM3IDcgMzdaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMjQsOTcpIi8+PHBhdGggZD0iTTAgMEMxIDEgMSAxIDIgMkMyIDIgMiAzIDIgM0MzIDMgMyA0IDMgNUMyIDUgMiA1IDIgNUMxIDUgMSA1IDAgNEMwIDUgMCA1LTEgNUMwIDUgMCA2IDEgNkMwIDcgMCA4LTEgOEMwIDggMSA4IDIgN0MzIDYgMyA2IDQgNkM2IDcgNiA4IDcgMTBDNyAxMSA3IDEyIDcgMTNDNiAxNCA1IDE1IDMgMTZDMiAxNiAxIDE1IDAgMTRDLTEgMTMtMiAxMi0zIDEwQy0zIDEwLTMgMTAtMyAxMUMtNCAxMS00IDExLTQgMTFDLTUgMTItNSAxMi02IDEyQy03IDEzLTcgMTMtOCAxNEMtOSAxNC05IDE0LTkgMTRDLTEwIDE1LTExIDE2LTEyIDE3Qy0xMyAxNy0xMyAxOC0xNCAxOEMtMTQgMTgtMTQgMTgtMTQgMThDLTE1IDE5LTE1IDE5LTE2IDIwQy0xNSAyMS0xNSAyMS0xNCAyMkMtMTQgMjItMTQgMjItMTQgMjNDLTEzIDI0LTEyIDI1LTExIDI2Qy0xMCAyNi05IDI1LTggMjVDLTggMjUtOCAyNS04IDI0Qy03IDI0LTcgMjQtNiAyNEMtNiAyMy02IDIzLTcgMjJDLTcgMjItNyAyMS03IDIwQy03IDE4LTYgMTctNCAxN0MtMyAxNi0yIDE2LTEgMTdDMCAxOCAxIDIwIDIgMjJDMiAyMiAxIDIzIDEgMjRDMSAyNCAxIDI0IDAgMjRDMiAyNCAyIDI0IDMgMjRDMyAyNCAzIDI0IDQgMjRDNCAyNCA0IDI0IDUgMjVDNSAyNSA1IDI1IDUgMjZDNiAyNyA2IDI4IDYgMzBDNSAzMSA0IDMyIDMgMzJDMiAzMiAxIDMyIDAgMzJDMCAzMS0xIDMxLTEgMzBDLTIgMzAtMyAzMS00IDMyQy00IDMyLTUgMzItNSAzMkMtNSAzMi01IDMyLTUgMzNDLTUgMzMtNiAzMy02IDMzQy02IDMzLTYgMzMtNiAzM0MtNiAzNC02IDM0LTUgMzVDLTUgMzUtNSAzNS01IDM1Qy01IDM2LTUgMzYtNCAzNkMtNCAzNy00IDM3LTQgMzdDLTMgMzgtMyAzOC0zIDM4Qy0yIDM5LTIgMzktMiA0MUMtMiA0MS0yIDQxLTIgNDFDLTIgNDItMiA0Mi0yIDQyQy0xIDQyIDAgNDEgMiA0MEMyIDQwIDIgNDAgMyA0MEMzIDM5IDQgMzkgNCAzOEMxMiAzMyAxMiAzMyAxNCAzM0MxNCAzMiAxNCAzMiAxMyAzMUMxMyAzMSAxMyAzMSAxMiAzMEMxMCAyOSAxMCAyOCA5IDI2QzEwIDI0IDExIDIzIDEyIDIyQzEzIDIyIDEzIDIyIDE0IDIyQzE3IDIyIDE5IDI2IDIwIDI4QzIxIDI4IDIxIDI5IDIyIDMwQzI0IDMzIDI0IDMzIDI0IDM0QzIzIDM2IDIyIDM3IDIwIDM3QzIwIDM4IDIwIDM4IDIwIDM4QzE4IDM5IDE3IDQwIDE1IDQxQzE0IDQyIDEzIDQzIDEyIDQ0QzEwIDQ1IDkgNDYgNyA0N0M2IDQ4IDQgNDkgMyA1MEMxIDUxIDAgNTItMiA1M0MtMiA1My0yIDUzLTIgNTNDLTMgNTQtNCA1NS02IDU1Qy02IDU1LTcgNTUtNyA1NUMtOCA1NC04IDU0LTggNTRDLTkgNTMtOSA1My05IDUyQy05IDUyLTkgNTItMTAgNTJDLTEwIDUxLTEwIDUwLTEwIDQ5Qy05IDQ4LTkgNDgtOCA0N0MtOCA0Ny04IDQ3LTkgNDZDLTEwIDQ0LTEyIDQyLTEzIDQwQy0xNCAzOS0xNSAzOC0xNSAzN0MtMTYgMzYtMTcgMzQtMTggMzNDLTE4IDMzLTE4IDMzLTE4IDMzQy0xOSAzMi0xOSAzMS0yMCAzMEMtMjAgMjktMjAgMjktMjEgMjhDLTIyIDI3LTIyIDI3LTIyIDI2Qy0yMiAyNS0yMiAyNS0yMiAyNEMtMjEgMjQtMjEgMjQtMjEgMjRDLTIxIDI0LTIyIDI0LTIyIDI0Qy0yMiAyNS0yMiAyNS0yMyAyNUMtMjMgMjUtMjMgMjUtMjMgMjVDLTI0IDI2LTI1IDI3LTI3IDI2Qy0yOSAyNi0yOSAyNS0zMCAyNEMtMzEgMjMtMzEgMjEtMzAgMjBDLTMwIDIwLTI5IDE5LTI4IDE5Qy0yOCAxOC0yOCAxOC0yOCAxOEMtMjcgMTgtMjcgMTctMjYgMTdDLTI1IDE3LTI0IDE2LTI0IDE1Qy0yMyAxNS0yMyAxNS0yMiAxNEMtMjEgMTMtMjAgMTMtMTkgMTJDLTE3IDExLTE2IDktMTQgOEMtMTQgOC0xNCA4LTE0IDhDLTEyIDctMTEgNi0xMCA2Qy0xMCA2LTEwIDctMTAgN0MtOSA3LTkgNy05IDdDLTkgNS04IDQtNyA0Qy02IDQtNiA0LTYgNEMtNSA0LTUgNC00IDRDLTUgNC01IDQtNSA0Qy01IDMtNSAzLTQgMkMtMyAwLTItMSAwIDBaTS0xMSAxMEMtMTIgMTAtMTIgMTEtMTIgMTJDLTEyIDEyLTEyIDEyLTEyIDEyQy0xMCAxMi0xMCAxMi05IDExQy05IDExLTkgMTEtOSAxMUMtMTAgMTEtMTEgMTEtMTIgMTFDLTExIDExLTExIDEwLTEwIDlDLTExIDktMTEgOS0xMSAxMFpNLTIwIDE3Qy0yMCAxNy0yMCAxOC0yMCAxOEMtMTkgMTgtMTkgMTgtMTkgMThDLTE5IDE4LTE5IDE3LTE5IDE3Qy0xOSAxNy0yMCAxNy0yMCAxN1pNLTI3IDIwQy0yNyAyMC0yNyAyMC0yNyAyMEMtMjggMjEtMjggMjEtMjggMjFDLTI5IDIyLTI5IDIyLTI5IDIzQy0yOCAyMy0yOCAyMy0yNyAyM0MtMjcgMjMtMjcgMjQtMjYgMjRDLTI2IDI0LTI2IDI0LTI1IDIzQy0yNSAyMy0yNSAyMy0yNSAyM0MtMjQgMjItMjQgMjItMjMgMjFDLTIyIDIxLTIyIDIxLTIyIDIwQy0yMiAyMC0yMiAyMC0yMiAyMEMtMjMgMTktMjMgMTktMjQgMTlDLTI1IDE5LTI2IDIwLTI3IDIwWk0xNCAzNEMxNCAzNCAxNCAzNCAxNSAzNEMxNSAzNCAxNSAzNCAxNiAzNEMxNSAzNCAxNSAzNCAxNSAzNEMxNSAzNCAxNCAzNCAxNCAzNFpNNCA0MkMzIDQyIDMgNDIgMyA0MkMzIDQ0IDIgNDQgMSA0NUMwIDQ1IDAgNDUgMCA0NUMwIDQ1IDAgNDYgMCA0NkMwIDQ2IDAgNDYgMSA0NkMyIDQ2IDMgNDYgNCA0NUM0IDQ0IDUgNDQgNSA0M0M1IDQyIDYgNDIgNiA0MUM3IDQxIDcgNDEgOCA0MUM4IDQxIDggNDEgOCA0MEM4IDQwIDggNDAgOCAzOUM2IDM5IDUgNDAgNCA0MloiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE5NSw0NikiLz48cGF0aCBkPSJNMCAwQzAgMCAwIDAgMSAxQzEgMSAxIDEgMSAyQzAgMiAwIDItMiAyQy0xIDMtMSAzLTEgNEMwIDQgMCA0IDAgNEMxIDQgMSA0IDEgNEMyIDQgMiA0IDIgNEMyIDQgMiA0IDIgM0MzIDMgMyAyIDQgMkM0IDIgMyAyIDMgMUMyIDEgMiAxIDIgMEMyIDAgMiAwIDIgMEMzIDAgNCAwIDYgMEM2IDAgNiAwIDYgMEM4IDEgMTEgMyAxMiA1QzEzIDUgMTMgNSAxMyA1QzEzIDYgMTMgNiAxMyA3QzE0IDcgMTQgNyAxNCA3QzE1IDggMTUgOCAxNSA4QzE2IDkgMTYgOSAxNiA5QzE5IDEwIDIwIDE0IDIxIDE3QzIyIDE5IDIyIDIxIDIyIDIzQzIyIDI0IDIyIDI0IDIyIDI0QzIyIDI5IDIwIDMzIDE2IDM3QzE0IDM5IDExIDQxIDkgNDNDOCA0MyA3IDQ0IDcgNDRDNiA0NCA2IDQ1IDUgNDVDNCA0NiA0IDQ2IDMgNDdDMiA0NyAyIDQ3IDIgNDhDMiA0OCAxIDQ4IDEgNDhDMCA0OS0xIDUwLTMgNDlDLTQgNDktNSA0OC02IDQ3Qy02IDQ2LTcgNDUtNiA0NEMtNiA0My01IDQyLTQgNDFDLTYgMzktNyAzNy05IDM0Qy0xMCAzMy0xMSAzMS0xMiAzMEMtMTIgMzAtMTMgMjktMTMgMjlDLTEzIDI5LTEzIDI5LTEzIDI5Qy0xMyAyOC0xMyAyOC0xMyAyOEMtMTQgMjgtMTQgMjctMTQgMjdDLTE0IDI2LTE0IDI2LTEzIDI2Qy0xMiAyNi0xMiAyNy0xMSAyN0MtMTEgMjgtMTEgMjgtMTAgMjhDLTEwIDI4LTEwIDI4LTEwIDI4Qy0xMCAyOC0xMCAyNy0xMCAyN0MtMTEgMjctMTEgMjYtMTIgMjZDLTEyIDI0LTEyIDIzLTEyIDIyQy0xMiAyMS0xMyAyMS0xNCAyMUMtMTUgMjItMTYgMjItMTYgMjNDLTE4IDIzLTE5IDIxLTE5IDIwQy0yMCAxOS0xOSAxOS0xOSAxOEMtMTkgMTgtMjAgMTktMjAgMTlDLTIwIDE5LTIxIDE5LTIyIDE5Qy0yMiAxOS0yMiAxOS0yMiAyMEMtMjIgMjAtMjIgMjAtMjIgMjBDLTIzIDIxLTI0IDIwLTI1IDE5Qy0yNiAxOS0yNyAxOC0yNyAxN0MtMjcgMTUtMjcgMTUtMjYgMTRDLTI0IDEyLTIxIDEwLTE5IDlDLTE4IDgtMTcgNy0xNiA3Qy0xNCA1LTEzIDQtMTEgM0MtMTAgMy0xMCAzLTEwIDJDLTkgMi03IDEtNiAxQy02IDAtNiAwLTYgMEMtNCAwLTItMSAwIDBaTTUgNUM1IDYgNSA2IDUgNkM1IDcgNSA3IDYgN0M3IDcgNyA3IDggNkM3IDYgNyA2IDYgNUM2IDUgNiA1IDUgNVpNLTIgNUMtMyA2LTMgNi0zIDZDLTQgOC00IDktNiAxMEMtNyAxMS04IDExLTggMTFDLTggMTEtOSAxMi05IDEyQy0xMCAxMi0xMSAxMy0xMiAxNEMtMTEgMTUtMTEgMTYtMTAgMTdDLTEwIDE3LTkgMTgtOSAxOEMtOSAxOC05IDE5LTggMTlDLTggMjAtNyAyMS02IDIyQy02IDIyLTYgMjItNiAyMkMtNSAyNC00IDI1LTMgMjdDLTIgMjgtMSAyOSAwIDMwQzEgMzIgMiAzNCA0IDM2QzggMzMgMTEgMjkgMTIgMjRDMTMgMjQgMTMgMjQgMTMgMjRDMTQgMjMgMTQgMjMgMTUgMjNDMTUgMjIgMTUgMjAgMTUgMThDMTUgMTggMTUgMTggMTUgMTdDMTUgMTcgMTUgMTYgMTYgMTVDMTUgMTUgMTUgMTUgMTUgMTVDMTUgMTUgMTUgMTUgMTQgMTVDMTQgMTUgMTQgMTUgMTQgMTRDMTMgMTQgMTMgMTQgMTIgMTNDMTIgMTQgMTMgMTUgMTMgMTZDMTMgMTYgMTMgMTYgMTIgMTZDMTIgMTYgMTIgMTYgMTEgMTdDMTAgMTcgMTAgMTcgMTAgMTdDOSAxNiA4IDE2IDggMTVDOCAxNSA3IDE1IDcgMTVDNiAxMyA2IDEzIDYgMTNDNiAxMiA2IDEyIDYgMTFDNiAxMSA2IDExIDYgMTFDNSAxMSA0IDExIDMgMTFDMyAxMSAyIDEwIDIgMTBDMiAxMCAxIDEwIDEgMTBDMCAxMC0xIDktMiA5Qy0yIDktMyA5LTMgOUMtMyA5LTMgOS00IDlDLTMgOS0zIDgtMiA4Qy0xIDgtMSA4LTEgN0MtMSA3LTEgNi0yIDZDLTIgNi0yIDUtMiA1Wk0xMCA3QzEwIDcgMTAgOCAxMCA4QzEwIDkgMTEgMTAgMTEgMTBDMTEgMTEgMTEgMTEgMTIgMTFDMTMgMTEgMTMgMTEgMTMgMTFDMTMgMTAgMTMgMTAgMTQgOUMxMyA5IDEyIDkgMTIgOUMxMSA5IDExIDkgMTEgOUMxMSA5IDExIDkgMTEgOEMxMSA4IDExIDggMTEgOEMxMSA3IDExIDcgMTAgN1pNLTE3IDE3Qy0xNyAxNy0xNyAxNy0xOCAxOEMtMTcgMTctMTcgMTctMTYgMTdDLTE3IDE3LTE3IDE3LTE3IDE3Wk0tMTcgMjBDLTE3IDIwLTE3IDIwLTE2IDIwQy0xNiAyMC0xNiAyMC0xNiAyMEMtMTYgMjAtMTYgMjAtMTYgMjBDLTE2IDIwLTE2IDIwLTE3IDIwWk0xOCAyMUMxOCAyMSAxOCAyMSAxOCAyMUMxOCAyMSAxOCAyMSAxOCAyMUMxOCAyMSAxOCAyMSAxOCAyMVpNLTIgMzBDLTIgMzAtMiAzMS0yIDMxQy0xIDMxLTEgMzEtMSAzMUMtMSAzMS0xIDMxLTEgMzBDLTEgMzAtMSAzMC0yIDMwWk0xMiAzMUMxMiAzMSAxMiAzMSAxMSAzMUMxMSAzMiAxMCAzMiAxMCAzM0MxMCAzMyAxMCAzMyAxMCAzM0MxMSAzMyAxMiAzMiAxNCAzMUMxNCAzMSAxNCAzMSAxNCAzMEMxMyAzMCAxMyAzMSAxMiAzMVpNLTMgNDFDLTMgNDEtMyA0Mi0zIDQzQy0zIDQzLTIgNDMtMiA0M0MtMSA0My0xIDQzLTEgNDNDLTEgNDIgMCA0MiAwIDQyQzAgNDIgMCA0MiAwIDQxQy0xIDQxLTEgNDEtMiA0MUMtMiA0MS0zIDQxLTMgNDFaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgyMjgsMjYpIi8+PHBhdGggZD0iTTAgMEMwIDAgMCAwIDAgMEMxIDEgMSAxIDIgMUMyIDIgMiAyIDMgM0MzIDMgNCA0IDQgNEM5IDkgMTAgMTUgMTAgMjFDMTAgMjQgMTAgMjcgOCAyOUM4IDI5IDggMjkgNyAyOUM3IDI5IDcgMjkgNyAyOUM2IDI5IDYgMjkgNiAzMEM2IDMwIDYgMzAgNiAzMEM2IDMwIDcgMzAgNyAzMUM3IDMyIDYgMzIgNSAzM0M1IDMzIDUgMzMgNCAzM0MzIDMzIDMgMzMgMyAzMkMzIDMyIDIgMzIgMiAzMkMzIDMyIDMgMzMgMyAzM0MzIDMzIDMgMzMgMyAzNEMzIDM2IDAgMzctMiAzOUMtMiAzOS0yIDM5LTIgMzlDLTMgMzktMyAzOS0zIDM5Qy0zIDM4LTMgMzgtMyAzN0MtNCAzNy00IDM3LTQgMzhDLTUgMzgtNSAzOC02IDM4Qy02IDM4LTYgMzgtNiAzOEMtNiAzOC02IDM4LTYgMzhDLTYgMzktNSAzOS00IDM5Qy01IDQxLTYgNDItOCA0M0MtOCA0Mi04IDQyLTkgNDJDLTkgNDItOSA0MS04IDQxQy05IDQxLTkgNDEtOSA0MUMtMTAgNDEtMTAgNDEtMTEgNDFDLTExIDM4LTkgMzctOCAzNUMtOCAzNS04IDM1LTggMzVDLTkgMzUtOSAzNS0xMCAzNUMtMTAgMzUtMTAgMzYtMTAgMzZDLTExIDM4LTEyIDM5LTE0IDQwQy0xNCA0MS0xNCA0MS0xNSA0MkMtMTUgNDItMTUgNDEtMTQgNDFDLTEzIDQxLTEzIDQxLTEyIDQxQy0xMiA0Mi0xMiA0Mi0xMSA0MkMtMTEgNDMtMTEgNDMtMTEgNDNDLTEwIDQzLTEwIDQzLTEwIDQzQy0xMCA0NS0xMSA0NS0xMiA0NkMtMTMgNDYtMTQgNDYtMTUgNDZDLTE2IDQ1LTE2IDQ1LTE3IDQ0Qy0xNyA0NC0xNyA0NC0xNyA0NEMtMTggNDMtMTggNDEtMTggNDBDLTE3IDM5LTE3IDM4LTE2IDM4Qy0xNiAzNy0xNiAzNy0xNiAzN0MtMTggMzUtMTkgMzMtMjEgMzFDLTIyIDI5LTIzIDI3LTI1IDI1Qy0yNSAyNC0yNiAyMy0yNiAyM0MtMjYgMjItMjYgMjItMjcgMjJDLTI3IDIyLTI3IDIxLTI3IDIxQy0yOCAyMS0yOCAyMC0yOCAyMEMtMjggMjAtMjggMjAtMjggMjBDLTI5IDE5LTI5IDE5LTI5IDE5Qy0zMCAxNy0zMCAxNi0zMCAxNUMtMzEgMTUtMzEgMTUtMzEgMTRDLTMxIDE0LTMxIDEzLTMxIDEzQy0zMSAxMy0zMSAxMy0zMiAxM0MtMzIgMTMtMzIgMTMtMzMgMTNDLTMzIDEyLTMzIDEyLTMzIDExQy0zMyA5LTMyIDgtMzAgN0MtMjkgNi0yOCA2LTI3IDZDLTI2IDYtMjYgNi0yNSA3Qy0yNSA3LTI0IDctMjQgN0MtMjQgNy0yNCA3LTI1IDZDLTI2IDYtMjYgNi0yNiA1Qy0yNiA0LTI1IDQtMjUgNEMtMjUgMy0yNCAzLTI0IDNDLTIzIDItMjMgMi0yMiAxQy0yMS0xLTIwLTItMTgtM0MtMTItNS01LTQgMCAwWk0tMjAgNEMtMjAgNC0yMCA0LTIwIDRaTTEgNUMxIDYgMCA2IDAgNkMwIDYgMCA3IDAgN0MxIDYgMSA2IDIgNkMxIDUgMSA1IDEgNVpNLTIzIDEwQy0yMyAxMS0yMiAxMi0yMSAxM0MtMjEgMTMtMjEgMTQtMjEgMTRDLTIxIDE0LTIwIDE1LTIwIDE2Qy0yMCAxNi0xOSAxNi0xOSAxNkMtMTkgMTctMTggMTgtMTggMThDLTE3IDIwLTE2IDIxLTE1IDIzQy0xNCAyNC0xMyAyNS0xMiAyN0MtMTAgMjgtOSAzMC04IDMyQy02IDMxLTUgMzAtNCAyOUMtNCAyOS00IDI5LTMgMjlDLTIgMjcgMCAyNSAwIDIyQzAgMTctMiAxMy01IDEwQy03IDgtMTAgNi0xMyA2Qy0xNyA2LTIwIDgtMjMgMTBaTS0yNSAxMEMtMjUgMTEtMjUgMTEtMjUgMTFaTTkgMTVDOSAxNSA5IDE1IDkgMTVaTS0xNCAyOUMtMTQgMzAtMTQgMzAtMTQgMzBDLTE0IDMwLTE0IDMwLTE0IDMwQy0xNCAzMC0xNCAzMC0xNCAyOVpNLTE3IDMxQy0xNyAzMi0xNyAzMy0xNiAzM0MtMTYgMzItMTcgMzItMTcgMzFDLTE3IDMxLTE3IDMxLTE3IDMxWk0tMyAzNUMtMyAzNS0zIDM1LTIgMzZDLTIgMzYtMiAzNi0xIDM2Qy0xIDM2LTEgMzUtMSAzNUMtMiAzNC0yIDM0LTMgMzVaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg1NiwxNjApIi8+PHBhdGggZD0iTTAgMEMyIDAgMyAwIDQgMUM1IDEgNSAyIDUgMkM1IDMgNiAzIDYgM0M2IDQgNSA0IDQgNUM1IDUgNSA2IDUgNkM1IDYgNSA2IDUgNkM1IDUgNiA1IDYgNUM2IDUgNiA1IDYgNUM2IDYgNiA3IDUgOEM1IDggNSA5IDUgOUMyIDE0LTQgMTgtOSAyMUMtMTAgMjItMTIgMjMtMTMgMjRDLTE1IDI2LTE3IDI3LTE5IDI5Qy0yMCAyOS0yMCAzMC0yMSAzMEMtMjIgMzEtMjIgMzEtMjMgMzJDLTI0IDMyLTI0IDMyLTI0IDMyQy0yNyAzNC0yOSAzNi0zMSAzN0MtMzEgMzctMzEgMzctMzIgMzdDLTMzIDM4LTM0IDM4LTM1IDM5Qy0zNSAzOS0zNSAzOS0zNiA0MEMtMzYgNDAtMzcgNDAtMzcgNDBDLTM3IDQwLTM3IDQwLTM4IDQxQy0zNyA0MS0zNyA0MS0zNyA0MUMtMzcgNDEtMzcgNDEtMzcgNDFDLTM5IDQzLTQxIDQ0LTQzIDQ1Qy00NSA0Ny00NyA0OC00OSA1MEMtNTAgNTAtNTAgNTEtNTEgNTFDLTUyIDUyLTU0IDU0LTU2IDU1Qy01NyA1Ni01OSA1Ny02MCA1OEMtNjEgNTktNjMgNjAtNjUgNjFDLTY2IDYyLTY3IDYzLTY4IDY0Qy03MSA2Ni03MyA2Ny03NiA2OUMtNzggNzAtODAgNzItODIgNzNDLTg0IDc1LTg3IDc3LTkwIDc5Qy05MSA4MC05MSA4MC05MSA4MEMtOTQgODItOTQgODItOTUgODJDLTk2IDgyLTk2IDgzLTk3IDg0Qy05OCA4Ni0xMDAgODctMTAyIDg3Qy0xMDMgODgtMTAzIDg4LTEwNCA4OUMtMTA0IDkwLTEwNSA5MC0xMDYgOTBDLTEwNyA5MC0xMDcgOTAtMTA3IDkwQy0xMDggOTEtMTA4IDkwLTEwOSA5MEMtMTEwIDg5LTExMCA4OS0xMTAgODhDLTExMCA4Ny0xMTAgODctMTEwIDg2Qy0xMTAgODYtMTEwIDg2LTExMCA4NUMtMTEwIDg1LTExMCA4NS0xMDkgODRDLTEwOSA4NC0xMDkgODQtMTA5IDg0Qy0xMDkgODQtMTA5IDg0LTEwOCA4M0MtMTA4IDgzLTEwOCA4My0xMDggODNDLTEwNyA4My0xMDcgODMtMTA3IDgzQy0xMDYgODItMTA2IDgyLTEwNSA4MkMtMTA1IDgxLTEwNCA4MC0xMDMgODBDLTEwMSA3OC05OSA3Ny05NyA3NkMtOTYgNzUtOTUgNzQtOTQgNzNDLTk0IDczLTk0IDczLTk0IDczQy05MyA3Mi05MiA3Mi05MSA3MUMtODkgNjktODcgNjgtODUgNjdDLTg0IDY2LTgzIDY1LTgxIDY0Qy04MSA2NC04MSA2NC04MCA2M0MtODAgNjMtNzkgNjItNzggNjJDLTc2IDYwLTc0IDYwLTcyIDYwQy03MiA2MC03MiA2MC03MiA1OUMtNzIgNTktNzIgNTgtNzIgNTdDLTcxIDU2LTY5IDU1LTY4IDU1Qy02NyA1NC02NiA1My02NSA1M0MtNjUgNTItNjUgNTItNjQgNTJDLTY0IDUyLTY0IDUyLTY0IDUxQy02MiA1MC02MCA0OS01OCA0OEMtNTYgNDYtNTQgNDUtNTIgNDNDLTUxIDQyLTQ5IDQxLTQ3IDQwQy00NSAzOS00NCAzOC00MyAzN0MtNDEgMzUtNDAgMzQtMzggMzNDLTM3IDMyLTM1IDMxLTMzIDMwQy0zMiAyOS0zMCAyNy0yOCAyNkMtMjcgMjUtMjYgMjUtMjUgMjRDLTIzIDIzLTIxIDIxLTE5IDIwQy0xOSAyMC0xOSAyMC0xOSAyMEMtMTkgMjEtMTkgMjEtMTggMjFDLTE3IDIwLTE1IDIwLTE0IDE4Qy0xNCAxOC0xNCAxOC0xNCAxOEMtMTUgMTgtMTUgMTgtMTUgMThDLTE1IDE3LTE0IDE2LTEzIDE1Qy0xMiAxNS0xMSAxNC0xMCAxM0MtMTAgMTMtMTAgMTMtOSAxM0MtOSAxMi05IDEyLTkgMTJDLTggMTEtNyAxMS02IDEwQy02IDEwLTYgMTAtNSAxMEMtNSAxMC01IDEwLTUgOUMtNSA5LTUgOS00IDlDLTMgOC0zIDctMiA2Qy0yIDUtMiA1LTIgNUMtMSAzIDAgMiAwIDBaTTEgOEMxIDggMSA4IDEgOEMxIDggMSA4IDIgOEMyIDggMiA4IDIgOEMyIDggMSA4IDEgOFpNLTIgMTFDLTMgMTEtMyAxMi00IDEyQy0zIDEzLTIgMTMtMiAxMkMtMSAxMi0xIDEyLTEgMTJDLTEgMTEtMSAxMS0xIDExQy0yIDExLTIgMTEtMiAxMVpNLTggMTVDLTcgMTUtNyAxNS02IDE1Qy02IDE1LTYgMTQtNiAxNEMtNyAxNC03IDE0LTggMTVaTS0xMiAxNkMtMTIgMTctMTIgMTctMTIgMTdDLTExIDE3LTExIDE3LTEwIDE3Qy0xMCAxNi0xMCAxNi0xMCAxNkMtMTEgMTYtMTEgMTYtMTIgMTZaTS0zNyAzNEMtMzcgMzUtMzcgMzUtMzcgMzZDLTM2IDM2LTM2IDM2LTM1IDM2Qy0zNSAzNi0zNSAzNS0zNSAzNUMtMzUgMzUtMzYgMzQtMzcgMzRaTS00NCA0MkMtNDQgNDItNDQgNDItNDQgNDJDLTQ0IDQyLTQ0IDQyLTQzIDQyQy00MyA0Mi00NCA0Mi00NCA0MloiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDI2Nyw1NSkiLz48cGF0aCBkPSJNMCAwQzAgMCAxIDAgMSAwQzYgMiA5IDUgMTIgOUMxMiA5IDEyIDkgMTIgOUMxNCAxMSAxNSAxMyAxNyAxNUMxNyAxNSAxNyAxNiAxOCAxNkMxOSAxOSAyMSAyMSAyMiAyM0MyMyAyMyAyMyAyNCAyNCAyNUMyNCAyNSAyNCAyNiAyNSAyNkMyNSAyNyAyNiAyOCAyNiAyOUMyNyAyOSAyNyAzMCAyNyAzMEMyOCAzMCAyOCAzMSAyOCAzMUMyOSAzMiAyOSAzMyAzMCAzNEMzMCAzNSAzMCAzNSAzMCAzNUMyOSAzNSAyOSAzNiAyOSAzNkMyOSAzOCAyOCAzOSAyNiA0MEMyNSAzOSAyNSAzOSAyNCAzOEMyNCAzOCAyNCAzOCAyNCAzN0MyMiAzNSAyMSAzNCAyMCAzMkMxOSAzMSAxOSAzMSAxOCAzMEMxNiAyNyAxNCAyNSAxMiAyMkMxMiAyMSAxMiAyMSAxMSAyMEMxMSAyMCAxMSAyMCAxMSAxOUMxMSAxOSAxMCAxOSAxMCAxOEM5IDE3IDkgMTcgOSAxNkM5IDE1IDkgMTUgOSAxNUM4IDE1IDcgMTUgNyAxNEM0IDEwIDAgOC01IDdDLTEwIDctMTQgOS0xOSAxMkMtMjAgMTMtMjEgMTMtMjIgMTRDLTIzIDE1LTI1IDE2LTI3IDE4Qy0yOCAxOS0zMCAyMC0zMSAyMEMtMzMgMjItMzQgMjMtMzYgMjRDLTM3IDI1LTM5IDI2LTQwIDI3Qy00MiAyOS00NCAzMC00NiAzMUMtNDcgMzItNDkgMzMtNTAgMzRDLTUxIDM1LTUzIDM2LTU0IDM3Qy01NiAzOC01OCA0MC02MCA0MUMtNjEgNDEtNjIgNDAtNjIgMzlDLTYyIDM4LTYyIDM4LTYyIDM4Qy02MiAzOC02MiAzOC02MSAzOEMtNjAgMzgtNjAgMzgtNjAgMzdDLTYwIDM3LTU5IDM2LTU5IDM2Qy01OSAzNS01OSAzNS01OCAzNUMtNTggMzUtNTggMzUtNTggMzVDLTU4IDM1LTU4IDM1LTU4IDM0Qy01OSAzNC01OSAzNC01OSAzM0MtNTkgMzEtNTggMzEtNTcgMzBDLTU2IDMwLTU2IDMwLTU2IDMwQy01NSAzMC01NSAzMS01NSAzMUMtNTUgMzItNTUgMzItNTQgMzNDLTU0IDMzLTU0IDMzLTU0IDMzQy01NCAzMi01MyAzMS01NCAzMEMtNTQgMzAtNTQgMzAtNTUgMzBDLTU1IDI5LTU1IDI5LTU1IDI5Qy01NCAyOC01NCAyOC01NCAyOEMtNTQgMjgtNTMgMjctNTMgMjdDLTUyIDI2LTUxIDI1LTQ5IDI1Qy00OSAyNC00OSAyNC00OSAyNEMtNDkgMjQtNDggMjQtNDggMjRDLTQ4IDI0LTQ4IDI0LTQ4IDIzQy00NyAyMy00NyAyMy00NiAyM0MtNDYgMjMtNDYgMjQtNDYgMjRDLTQ1IDIzLTQ0IDIyLTQzIDIxQy00MiAyMC00MSAxOS00MCAxOEMtMzkgMTctMzkgMTctMzggMTdDLTM4IDE3LTM4IDE3LTM4IDE2Qy0zNyAxNi0zNiAxNS0zNSAxNUMtMzQgMTMtMzIgMTItMzAgMTFDLTI5IDExLTI5IDEwLTI5IDEwQy0yOCAxMC0yOCAxMC0yOCAxMEMtMjggMTAtMjggMTAtMjggMTBDLTI4IDExLTI4IDExLTI4IDEyQy0yOCAxMi0yOCAxMi0yNyAxMUMtMjcgMTAtMjcgMTAtMjcgMTBDLTI2IDgtMjYgNy0yNCA3Qy0yNCA2LTIzIDYtMjMgNUMtMTYgMC05LTIgMCAwWk0tMTAgMUMtMTAgMS0xMCAxLTEwIDFDLTEwIDEtMTAgMi0xMCAyQy0xMCAyLTkgMi05IDJDLTkgMS05IDEtOSAxQy05IDEtMTAgMS0xMCAxWk0tMjAgN0MtMjAgNy0yMCA3LTIwIDhDLTIwIDctMjAgNy0xOSA3Qy0xOSA3LTE5IDctMTkgNkMtMjAgNi0yMCA2LTIwIDdaTTQgN0M0IDcgNCA4IDQgOEM0IDggNCA4IDQgOUM0IDkgNSA5IDUgOEM1IDggNSA4IDUgN0M1IDcgNSA3IDQgN1pNMjYgMzVDMjYgMzUgMjYgMzUgMjYgMzZDMjcgMzYgMjcgMzUgMjggMzVDMjcgMzUgMjcgMzUgMjcgMzRDMjcgMzQgMjcgMzQgMjYgMzVaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgyMzcsMSkiLz48cGF0aCBkPSJNMCAwQzEgMCAyIDAgMyAxQzQgMyA0IDQgNCA1QzQgNyAyIDggMCA5QzAgMTAtMSAxMC0xIDEwQy0xIDEwLTEgMTEtMiAxMUMtMiAxMS0yIDExLTMgMTJDLTMgMTItMiAxMi0yIDEzQy0yIDEzLTIgMTMtMiAxNEMtMSAxNC0xIDE0LTEgMTRDMCAxNSAwIDE2IDAgMTdDLTIgMTgtMiAxOC0yIDE4Qy0zIDE3LTMgMTctMyAxNkMtMyAxNi0zIDE2LTIgMTVDLTMgMTQtNCAxNC01IDE0Qy01IDE0LTQgMTQtNCAxNUMtNCAxNi00IDE3LTMgMThDLTMgMTgtMyAxOC0zIDE4Qy0zIDE5LTIgMTktMiAxOUMwIDE5IDAgMTkgMiAyMEMyIDIxIDIgMjEgMiAyMkMyIDIyIDEgMjMgMSAyNEMwIDI0IDAgMjQgMCAyNkMxIDI1IDEgMjUgMiAyNEMyIDIzIDMgMjMgNCAyMkM1IDIyIDUgMjMgNiAyNEM2IDI0IDYgMjQgNiAyNEM3IDI1IDcgMjUgNiAyNkM2IDI3IDYgMjcgNiAyN0M2IDI3IDYgMjggNyAyOEM3IDI4IDggMjcgOCAyN0M5IDI4IDEwIDI5IDExIDMwQzExIDMxIDExIDMxIDExIDMxQzExIDMxIDExIDMyIDEyIDMyQzEyIDMyIDEyIDMzIDEyIDMzQzEzIDMzIDE0IDMzIDE0IDMyQzE2IDMxIDE3IDMxIDE4IDMxQzE4IDMxIDE5IDMxIDE5IDMxQzE5IDMxIDE5IDMxIDIwIDMxQzE5IDMxIDE5IDMxIDE5IDMxQzE5IDMwIDE5IDMwIDE5IDI5QzIwIDI5IDIxIDI5IDIyIDI5QzIzIDMwIDI0IDMxIDI1IDMyQzI1IDMzIDI1IDMzIDI1IDMzQzI1IDM0IDI1IDM0IDI1IDM0QzI0IDM2IDIzIDM3IDIyIDM4QzIwIDM5IDE4IDQwIDE3IDQxQzE2IDQyIDE0IDQzIDEzIDQ0QzExIDQ1IDEwIDQ2IDggNDdDOCA0NyA4IDQ3IDggNDdDNyA0OCA2IDQ5IDUgNDlDMyA1MSAzIDUxIDIgNTFDMCA1MS0xIDUwLTIgNDhDLTMgNDctMiA0Ni0yIDQ0QzAgNDIgMiA0MSA0IDM5QzQgMzggNCAzNyAzIDM2QzMgMzYgMyAzNiAyIDM2QzIgMzUgMiAzNSAyIDM1QzAgMzIgMCAzMiAwIDMxQy0xIDMwLTEgMzAtMiAzMEMtMiAyOS0zIDI4LTQgMjdDLTQgMjctNCAyNy00IDI2Qy03IDIzLTcgMjMtNyAyMUMtNyAyMS03IDIxLTcgMjFDLTggMjEtOCAyMC05IDIwQy05IDIwLTkgMTktOSAxOUMtMTAgMTgtMTAgMTgtMTAgMTdDLTEyIDE4LTEzIDE5LTE0IDIwQy0xNSAyMC0xNSAyMC0xNiAyMUMtMTYgMjEtMTYgMjEtMTYgMjFDLTE3IDIyLTE4IDIyLTIwIDIyQy0yMSAyMS0yMiAyMS0yMyAxOUMtMjMgMTgtMjMgMTctMjMgMTZDLTIyIDE1LTIwIDE0LTE5IDEyQy0xOCAxMi0xOCAxMi0xOCAxMkMtMTggMTItMTcgMTEtMTcgMTFDLTE2IDExLTE2IDEwLTE1IDEwQy0xNCA5LTE0IDktMTMgOEMtMTMgOC0xMiA4LTEyIDhDLTEwIDYtNyA0LTUgM0MtNCAyLTQgMi00IDJDLTMgMi0zIDItMyAyQy0zIDEtMyAxLTIgMUMtMiAxLTEgMSAwIDBDMCAxIDAgMSAwIDFDMCAxIDAgMSAwIDBaTTAgNUMwIDUgMCA1IDAgNkMxIDUgMiA1IDMgNEMzIDQgMyA0IDIgM0MxIDMgMSA0IDAgNVpNLTYgNkMtNiA2LTYgNy02IDdDLTYgOC02IDgtNiA4Qy01IDgtNSA4LTQgOEMtNCA3LTQgNy01IDdDLTUgNi01IDYtNiA2Wk0tMTAgOUMtMTAgOS0xMSAxMC0xMSAxMEMtMTEgMTAtMTEgMTAtMTAgMTFDLTEwIDExLTEwIDExLTEwIDExQy0xMCAxMC0xMCA5LTEwIDlDLTEwIDktMTAgOS0xMCA5Wk0tMTAgMTJDLTEwIDEzLTEwIDEzLTEwIDE0Qy05IDEzLTkgMTMtOCAxM0MtOSAxMy05IDEzLTkgMTJDLTkgMTItOSAxMi0xMCAxMlpNLTE3IDE0Qy0xNyAxNC0xNyAxNC0xNyAxNUMtMTcgMTUtMTcgMTYtMTcgMTZDLTE3IDE2LTE3IDE2LTE3IDE2Qy0xNiAxNi0xNiAxNi0xNiAxN0MtMTUgMTYtMTUgMTYtMTUgMTZDLTE1IDE2LTE1IDE1LTE1IDE1Qy0xNCAxNS0xNCAxNS0xNCAxNEMtMTUgMTQtMTUgMTQtMTYgMTRDLTE2IDE0LTE2IDE0LTE2IDE0Qy0xNiAxNC0xNyAxNC0xNyAxNFpNLTEwIDE2Qy0xMCAxNi0xMCAxNi0xMCAxNkMtMTAgMTYtOSAxNi05IDE2Qy05IDE2LTEwIDE2LTEwIDE2Wk0tNCAyMEMtNCAyMS00IDIxLTQgMjFDLTQgMjEtNCAyMS00IDIxQy00IDIxLTQgMjEtNCAyMEMtNCAyMC00IDIwLTQgMjBaTS0zIDI0Qy0zIDI0LTMgMjUtMyAyNUMtMyAyNS0zIDI1LTMgMjRDLTMgMjQtMyAyNC0zIDI0Wk00IDI4QzMgMjggMyAyOCAzIDI5QzMgMjkgNCAyOCA0IDI4QzQgMjggNCAyOCA0IDI4WiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTU0LDc0KSIvPjxwYXRoIGQ9Ik0wIDBDMSAxIDEgMSAxIDFDMSAxIDEgMiAxIDJDNyA5IDcgOSA3IDExQzcgMTMgNyAxMyA1IDE0QzQgMTUgNCAxNSAzIDE1QzEgMTUgMSAxNCAwIDEzQy0xIDEzLTIgMTQtMyAxNUMtMyAxNS00IDE1LTQgMTVDLTQgMTUtNSAxNi01IDE2Qy01IDE3LTQgMTgtMyAxOUMtMyAyMC0yIDIwLTIgMjFDLTIgMjEtMiAyMS0yIDIxQy0xIDIyIDAgMjMgMCAyNEMzIDI0IDUgMjIgNyAyMEMxMSAxOCAxMSAxOCAxMiAxN0MxMiAxNiAxMiAxNiAxMyAxNkMxNCAxNSAxNSAxNSAxNiAxNkMxNyAxNSAxNyAxNCAxNyAxM0MxNiAxNCAxNiAxNCAxNSAxNUMxNSAxNSAxNSAxNSAxNSAxNUMxNCAxNSAxNCAxNSAxNCAxNEMxMyAxNCAxMyAxNCAxMyAxNEMxMyAxMyAxMyAxMyAxMyAxM0MxMiAxMyAxMiAxMiAxMiAxMUMxMyAxMSAxMyAxMCAxNCAxMUMxNCAxMSAxNSAxMSAxNSAxMUMxNSAxMCAxNSA5IDE0IDlDMTQgOSAxNCA5IDE0IDlDMTMgOSAxMyA5IDEzIDEwQzEzIDEwIDEzIDEwIDEyIDEwQzEyIDEwIDEyIDEwIDExIDEwQzExIDEwIDExIDEwIDExIDEwQzEwIDkgMTAgOCAxMSA3QzEyIDYgMTMgNSAxNSA0QzE4IDUgMjAgOSAyMiAxMkMyMiAxMiAyMyAxMyAyMyAxM0MyMyAxMyAyNCAxNCAyNCAxNEMyNCAxNCAyNCAxNCAyNCAxNUMyNSAxNiAyNSAxNiAyNSAxN0MyNCAxOCAyNCAxOCAyNCAxOUMyMyAxOSAyMyAxOSAyMyAxOUMyMSAyMCAxOSAyMiAxOCAyM0MxNyAyMyAxNiAyNCAxNiAyNEMxNCAyNiAxMiAyNyAxMCAyOEMxMCAyOSAxMCAyOSA5IDI5QzggMzAgOCAzMCA2IDMwQzYgMzAgNiAyOSA2IDI4QzYgMjkgNiAyOSA1IDI5QzUgMzAgNSAzMCA0IDMwQzQgMzAgMyAzMCAzIDMxQzMgMzEgMyAzMSAyIDMxQzIgMzAgMiAzMCAyIDI5QzAgMjktMSAyOS0yIDMwQy0zIDMxLTMgMzEtMyAzMkMtNCAzMy00IDM0LTYgMzRDLTYgMzQtNyAzNS03IDM1Qy03IDM1LTcgMzUtNyAzNUMtOCAzNS04IDM1LTggMzVDLTkgMzQtOSAzNC05IDMzQy04IDMyLTggMzItNyAzMkMtNyAzMi03IDMyLTcgMzFDLTYgMzEtNiAzMC02IDMwQy02IDMwLTYgMzAtNyAyOUMtOCAyOC0xMCAyNy0xMCAyNEMtMTAgMjQtMTAgMjQtOSAyNEMtOSAyNC04IDI0LTggMjNDLTggMjItOCAyMi04IDIxQy04IDIxLTggMjEtOCAyMUMtOSAyMS05IDIyLTEwIDIzQy0xMCAyMy0xMCAyMy0xMSAyM0MtMTEgMjMtMTEgMjMtMTEgMjRDLTEyIDIyLTEzIDIxLTE0IDIwQy0xNCAyMC0xNCAxOS0xNSAxOUMtMTUgMTktMTUgMTgtMTUgMTdDLTE1IDE3LTE1IDE3LTE1IDE3Qy0xNSAxNy0xNSAxNy0xNCAxN0MtMTIgMTYtMTAgMTUtOCAxM0MtOCAxMy04IDEyLTggMTJDLTggMTItOCAxMi04IDEyQy05IDEyLTkgMTEtMTAgMTFDLTEwIDExLTEwIDExLTEwIDEwQy0xMCAxMC0xMCAxMC0xMCAxMEMtOSA5LTkgOS04IDhDLTcgNy03IDctNiA2Qy02IDYtNiA2LTYgNkMtNiA0LTYgMy02IDJDLTUgMS00IDAtMi0xQy0xLTEtMSAwIDAgMFpNLTIgMjhDLTIgMjgtMiAyOC0zIDI4Qy0zIDI4LTIgMjgtMiAyOEMtMiAyOC0yIDI4LTIgMjhaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg4NCwxNDIpIi8+PHBhdGggZD0iTTAgMEMyIDAgMyAyIDQgM0M0IDQgNCA0IDQgNEM4IDEwIDggMTAgOCAxMkM4IDEzIDcgMTQgNiAxNUM1IDE2IDMgMTYgMiAxNUMxIDE0LTEgMTItMiAxMUMtMyAxMS00IDEyLTUgMTNDLTYgMTMtNiAxNC03IDE0Qy03IDE0LTcgMTQtOCAxNEMtOSAxNS05IDE1LTkgMTVDLTkgMTUtMTAgMTUtMTAgMTVDLTEwIDE1LTEwIDE1LTEwIDE0Qy0xMCAxNC0xMCAxNC0xMCAxNEMtMTAgMTUtMTAgMTUtMTAgMTVDLTEwIDE2LTExIDE3LTEyIDE4Qy0xMiAxOC0xMiAxOC0xMiAxOEMtMTMgMTgtMTMgMTgtMTMgMThDLTE0IDE5LTE0IDE5LTE0IDE5Qy0xNSAxOC0xNiAxOC0xNiAxN0MtMTYgMTctMTYgMTctMTYgMTZDLTE1IDE2LTE1IDE2LTE0IDE2Qy0xNCAxNi0xNCAxNS0xNSAxNEMtMTUgMTQtMTUgMTQtMTUgMTRDLTE1IDEzLTE1IDEzLTE1IDEzQy0xNiAxMi0xNiAxMi0xNyAxM0MtMTcgMTMtMTggMTItMTggMTJDLTE3IDExLTE3IDExLTE2IDEwQy0xNiAxMC0xNSAxMC0xNSAxMEMtMTQgMTAtMTQgOS0xMyA5Qy0xMyAxMC0xMyAxMC0xMiAxMEMtMTEgMTAtMTEgOS0xMCA5Qy0xMCA5LTkgOS05IDhDLTkgOC05IDgtOSA4Qy05IDgtOSA4LTkgOEMtOSA3LTkgNi05IDZDLTkgNi05IDUtOCA1Qy04IDUtOCA1LTggNUMtNyA0LTYgNC01IDRDLTUgMy01IDMtNSAzQy01IDItNCAyLTQgMkMtMyAxLTMgMS0zIDFDLTIgMC0xIDAgMCAwWk0tNSA2Qy01IDctNSA3LTUgN0MtNSA4LTUgOC00IDhDLTQgOC00IDgtMyA4Qy0zIDctMyA3LTMgN0MtNCA2LTQgNi01IDZaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg4NCwxMjQpIi8+PHBhdGggZD0iTTAgMEMwIDEgMCAxIDAgMkMwIDIgMCAyIDAgMkMxIDIgMSAyIDEgM0MxIDMgMSAzIDIgM0MzIDQgMyA0IDQgNUMzIDYgMSA3LTEgOUMtMiAxMC00IDExLTUgMTJDLTcgMTMtOCAxNC0xMCAxNUMtMTEgMTYtMTMgMTctMTQgMThDLTE1IDE5LTE3IDIwLTE5IDIyQy0yMCAyMi0yMSAyMy0yMiAyNEMtMjQgMjUtMjUgMjYtMjcgMjdDLTI3IDI3LTI3IDI3LTI3IDI4Qy0yNyAyOC0yNyAyOC0yOCAyOEMtMjggMjgtMjggMjgtMjggMjhDLTI5IDI5LTI5IDI5LTMwIDI5Qy0zMCAyOC0zMSAyOC0zMSAyN0MtMzEgMjYtMzEgMjYtMzEgMjZDLTMwIDI1LTI5IDI0LTI4IDI0Qy0yNyAyNC0yNyAyNS0yNiAyNUMtMjYgMjUtMjYgMjUtMjYgMjVDLTI3IDIzLTI3IDIyLTI2IDIxQy0yNSAyMS0yNSAyMS0yNCAyMUMtMjQgMjEtMjMgMjEtMjMgMjFDLTIzIDIxLTIyIDIxLTIyIDIxQy0yMiAyMS0yMiAyMS0yMiAyMUMtMjIgMTktMjEgMTgtMjAgMTdDLTE5IDE3LTE5IDE3LTE5IDE2Qy0xOSAxNi0xOCAxNi0xOCAxNUMtMTggMTUtMTggMTQtMTkgMTRDLTE5IDEzLTE4IDEyLTE4IDEyQy0xNyAxMS0xNSAxMS0xNCAxMkMtMTQgMTEtMTQgMTEtMTQgMTFDLTE0IDExLTE0IDExLTE0IDExQy0xNCAxMC0xNCAxMC0xNCA5Qy0xNCA5LTEzIDktMTMgOUMtMTMgOS0xMyA5LTEzIDlDLTEyIDgtMTIgOC0xMiA4Qy0xMSA4LTEwIDgtMTAgOEMtMTAgOC0xMCA4LTEwIDdDLTEwIDYtMTAgNi05IDZDLTggNS03IDQtNiA0Qy02IDQtNiAzLTYgM0MtMSAwLTEgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxNzIsMzgpIi8+PHBhdGggZD0iTTAgMEMxIDEgMiAyIDIgNEMyIDQgMSA1IDEgNUMwIDYgMCA2IDAgNkMtMSA1LTIgNS0yIDVDLTMgNS0zIDUtMyA1Qy00IDYtNCA3LTQgOEMtNSA4LTYgOC02IDhDLTcgOS03IDEwLTcgMTBDLTcgMTEtNyAxMS03IDExQy03IDExLTcgMTItNyAxMkMtNyAxMi02IDEyLTYgMTJDLTYgMTItNiAxMi02IDEzQy04IDE0LTEwIDE2LTEyIDE3Qy0xMiAxNy0xMiAxNy0xMiAxN0MtMTEgMTYtMTEgMTUtMTAgMTRDLTEzIDE0LTEzIDE0LTE1IDE2Qy0xNSAxNy0xNSAxNy0xNSAxN0MtMTUgMTctMTUgMTctMTUgMThDLTE2IDE4LTE2IDE4LTE3IDE4Qy0xNyAxOC0xNyAxOC0xOCAxOEMtMTggMTgtMTggMTgtMTggMThDLTE4IDE3LTE4IDE3LTE3IDE2Qy0xNiAxNS0xNiAxNS0xNiAxNUMtMTYgMTUtMTYgMTUtMTYgMTRDLTE2IDE0LTE2IDE0LTE2IDE0Qy0xNyAxNC0xNyAxNC0xOCAxNEMtMTggMTMtMTcgMTItMTYgMTFDLTE2IDExLTE2IDExLTE1IDExQy0xNSAxMS0xNCAxMC0xNCAxMEMtMTQgMTAtMTMgOS0xMyA5Qy0xMiA5LTExIDgtMTEgOEMtOSA3LTggNi03IDVDLTUgMy0yIDIgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTI3LDY4KSIvPjxwYXRoIGQ9Ik0wIDBDMCAwIDAgMCAwIDBDMCAyIDAgMyAxIDRDMSA1IDEgNSAxIDVDMCA2IDAgNi0xIDZDLTMgNy00IDctNiA4Qy02IDgtNiA4LTYgOEMtNiA4LTYgOS02IDlDLTYgOS02IDktNSA5Qy00IDktNCA5LTQgMTBDLTMgMTEtMiAxMSAwIDExQzAgMTEgMCAxMSAwIDExQzEgMTIgMSAxMiAyIDEyQzIgMTMgMiAxMyAxIDEzQzEgMTQgMSAxNCAxIDE0QzEgMTUgMSAxNiAyIDE2QzIgMTYgMyAxNiAzIDE2QzMgMTcgMyAxNyAyIDE4QzIgMTggMiAxOCAxIDE4QzEgMTggMSAxOCAxIDE4QzAgMTkgMCAxOC0xIDE4Qy0xIDE4LTEgMTgtMiAxN0MtMiAxNy0yIDE3LTIgMTZDLTIgMTYtMiAxNi0yIDE2Qy0zIDE2LTMgMTYtMyAxNUMtMyAxNS00IDE0LTQgMTNDLTUgMTMtNiAxMy02IDE0Qy02IDEzLTcgMTMtNyAxMkMtNyAxMi04IDEyLTggMTJDLTggMTItOCAxMi04IDEyQy04IDEzLTggMTMtOCAxNEMtOSAxNC05IDE0LTEwIDEzQy0xMSAxMi0xMiAxMC0xMiA4Qy0xMSA4LTExIDgtMTAgOEMtMTAgOS0xMCA5LTEwIDlDLTkgOS05IDktOSA4Qy05IDgtOCA3LTggN0MtOCA2LTggNi04IDZDLTggNS04IDUtOCA1Qy03IDQtNiAzLTUgMkMtNSAyLTQgMi00IDJDLTQgMi0zIDEtMyAxQy0zIDEtMyAxLTMgMUMtMiAwLTEgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2NiwxMzcpIi8+PHBhdGggZD0iTTAgMEMxIDAgMSAxIDIgMkMyIDIgMiAyIDIgMkMzIDMgMyA0IDMgNEMyIDUgMiA1IDEgNkMxIDYgMSA2IDEgNkMxIDYgMSA2IDEgNkMyIDYgMiA2IDIgNkMyIDYgMiA2IDMgNkMzIDYgMyA2IDQgNkM0IDcgNCA4IDQgOUM0IDEwIDMgMTAgMiAxMUMyIDExIDIgMTEgMiAxMUMyIDEyIDIgMTIgMiAxMkMzIDEyIDMgMTIgMyAxMkM0IDEyIDQgMTIgNCAxMkM0IDEyIDUgMTIgNSAxMkM1IDEzIDUgMTMgNSAxNEM1IDE0IDUgMTUgNSAxNUM1IDE2IDUgMTYgNCAxN0MzIDE3IDIgMTYgMSAxNUMwIDE1IDAgMTQgMCAxNEMwIDE0LTEgMTQtMSAxNEMtMSAxNS0yIDE1LTIgMTVDLTMgMTUtMyAxNS0zIDE0Qy00IDEwLTQgMTAtNSA1Qy02IDQtNiAzLTYgMkMtNSAxLTQgMS0zIDFDLTIgMS0yIDEtMSAwQzAgMCAwIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjcwLDM5KSIvPjxwYXRoIGQ9Ik0wIDBDMCAxIDAgMSAwIDJDLTEgMi0xIDItMSAyQy0xIDMtMiAzLTIgNEMtMiA0LTIgNC0yIDRDLTMgNS0zIDUtNCA1Qy01IDUtNSA1LTYgNUMtNiA2LTYgNi03IDZDLTcgNy04IDgtOSA4Qy05IDgtOSA5LTkgOUMtMTAgOS0xMCA5LTExIDEwQy0xMiA5LTEyIDgtMTIgN0MtMTEgNy0xMSA3LTExIDZDLTExIDYtMTAgNi0xMCA2Qy0xMCA1LTEwIDUtOSA1Qy05IDUtOSA1LTkgNUMtNyAzLTUgMi0zIDFDLTMgMS0zIDEtMyAxQy0yIDAtMSAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE0MCw2MCkiLz48cGF0aCBkPSJNMCAwQzEgMCAxIDAgMSAxQzEgMiAxIDIgMSAzQzAgMyAwIDMgMCAzQy0xIDMtMSAzLTEgNEMtMiA1LTMgNi00IDdDLTQgNy00IDctNCA3Qy01IDgtNiA4LTcgOUMtOCA3LTggNy04IDdDLTcgNi03IDYtNyA1Qy03IDUtNiA1LTYgNUMtNiA1LTUgNS01IDVDLTUgNS01IDUtNSA0Qy00IDMtNCAzLTMgMkMtMiAyLTIgMi0yIDJDLTIgMi0yIDItMiAyQy0xIDAtMSAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDc1LDExMSkiLz48cGF0aCBkPSJNMCAwQzIgMSAyIDEgMyAyQzIgMyAyIDQgMSA0Qy0xIDQtMiA0LTMgM0MtNCAyLTQgMi00IDJDLTQgMS00IDEtNCAwQy00IDAtMyAwLTMgMEMtMyAwLTMgMC0yIDBDLTIgMC0xIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjMsMTczKSIvPjxwYXRoIGQ9Ik0wIDBDMCAxIDAgMSAwIDJDMCAyIDAgMiAwIDNDMCAzIDAgMyAwIDRDLTEgNC0xIDQtMiA0Qy0yIDQtMiA0LTIgNEMtMyA1LTMgNS0zIDZDLTMgNi0zIDYtNCA2Qy00IDYtNCA2LTUgNUMtNSAzLTUgMy00IDJDLTEgMC0xIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTM4LDY2KSIvPjxwYXRoIGQ9Ik0wIDBDMCAxIDAgMS0xIDJDLTEgMi0xIDMtMSAzQy0xIDMtMSAzLTIgM0MtMiA0LTIgNC0yIDRDLTMgNC0zIDQtNCA0Qy00IDMtNCAzLTQgM0MtNCAxLTMgMC0xIDBDLTEgMC0xIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoODUsMTAzKSIvPjxwYXRoIGQ9Ik0wIDBDMCAwIDAgMCAwIDBDMCAxIDAgMSAwIDJDMCAyLTEgMi0xIDJDLTEgMy0xIDMtMSAzQy0yIDMtMyA0LTQgNEMtMyAyLTMgMS0yIDBDLTEgMC0xIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTI1LDc3KSIvPjxwYXRoIGQ9Ik0wIDBDMiAxIDIgMSAyIDFDMiAyIDIgMiAyIDNDMSA0IDEgNCAwIDRDMCA0IDAgNCAwIDRDLTEgMi0xIDEgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoODAsMTc2KSIvPjxwYXRoIGQ9Ik0wIDBDMSAwIDEgMCAyIDFDMiAxIDIgMSAyIDJDMCA0IDAgNC0yIDRDLTIgMy0yIDMtMiAzQy0xIDItMSAyIDAgMUMwIDAgMCAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEyOCw3NCkiLz48cGF0aCBkPSJNMCAwQzAgMCAwIDAgMSAxQzEgMiAxIDIgMCAzQy0xIDItMiAyLTMgMkMtMyAxLTIgMS0yIDBDLTEgMC0xIDAtMSAwQy0xIDAtMSAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE0Myw1OCkiLz48cGF0aCBkPSJNMCAwQzAgMCAwIDAgMSAwQzEgMSAwIDEgMCAyQy0xIDMtMiAzLTQgM0MtMyAyLTMgMi0yIDFDLTIgMS0xIDEtMSAxQzAgMCAwIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTUyLDUxKSIvPjxwYXRoIGQ9Ik0wIDBDMSAwIDEgMCAyIDBDMyAxIDMgMiAzIDJDMiAyIDEgMiAwIDFDMCAxIDAgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg3MCwxNDkpIi8+PHBhdGggZD0iTTAgMEMwIDEgMCAxLTEgMUMtMSAyLTEgMi0xIDJDLTIgMi0yIDItMiAyQy0zIDMtMyAzLTQgM0MtNCAyLTQgMi00IDJDLTMgMS0zIDEtMyAxQy0zIDEtMyAxLTIgMUMtMSAwLTEgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2NiwxMjApIi8+PHBhdGggZD0iTTAgMEMwIDAgMCAwIDEgMEMxIDAgMSAxIDEgMUMwIDIgMCAyLTEgMkMtMSAyLTEgMi0xIDNDLTIgMy0yIDMtMyAzQy0zIDItMiAxLTEgMEMtMSAwLTEgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg4NiwxNzQpIi8+PHBhdGggZD0iTTAgMEMwIDEgMCAyLTEgM0MtMSAzLTEgMy0yIDJDLTIgMi0yIDEtMiAwQy0xIDAtMSAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDIsMTY5KSIvPjxwYXRoIGQ9Ik0wIDBDMCAwIDEgMCAxIDBDMSAxIDEgMSAxIDJDMSAyIDEgMiAxIDJDMCAyIDAgMiAwIDJDLTEgMi0xIDEtMSAxQzAgMCAwIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoODAsMTA3KSIvPjxwYXRoIGQ9Ik0wIDBDMCAwIDEgMCAxIDBDMSAxIDEgMSAxIDJDMCAyIDAgMiAwIDJDLTEgMi0xIDItMSAxQzAgMCAwIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoODgsMTcyKSIvPjxwYXRoIGQ9Ik0wIDBDMCAwIDAgMCAxIDBDMCAxIDAgMSAwIDJDLTEgMi0xIDItMSAyQy0yIDItMiAxLTIgMUMtMSAwLTEgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMjUsNzQpIi8+PHBhdGggZD0iTTAgMEMwIDEgMCAxLTEgMkMtMiAyLTIgMi0yIDJDLTIgMS0yIDEtMiAwQy0xIDAtMSAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDExNCw4NikiLz48cGF0aCBkPSJNMCAwQzAgMCAwIDAgMCAwQzAgMSAwIDEgMCAyQzAgMiAwIDItMSAyQy0xIDEtMSAxLTEgMEMtMSAwIDAgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxNDgsNTQpIi8+PHBhdGggZD0iTTAgMEMwIDAgMCAwIDEgMEMxIDEgMSAxIDAgMUMwIDEgMCAxIDAgMkMtMSAxLTEgMS0xIDBDLTEgMCAwIDAgMCAwWiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTAyLDk0KSIvPjxwYXRoIGQ9Ik0wIDBDMCAwIDAgMCAxIDBDMSAxIDEgMSAwIDFDMCAxIDAgMSAwIDFDMCAxIDAgMCAwIDBaIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMTcsMTAwKSIvPjxwYXRoIGQ9Ik0wIDBDMCAxIDAgMS0xIDFDLTEgMS0xIDEtMSAxQy0xIDEtMSAxLTEgMEMwIDAgMCAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEyMSwxNjYpIi8+PHBhdGggZD0iTTAgMEMwIDAgMSAwIDEgMEMxIDAgMSAwIDAgMUMwIDEgMCAwIDAgMFoiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDcyLDEzMikiLz48L3N2Zz4=';
 
  init();
})();