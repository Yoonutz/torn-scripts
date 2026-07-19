# OC Best-Fit Standalone HTML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `standalone/oc-bestfit.html` — one self-contained file that reproduces the OC Best-Fit userscript 1:1 (Torn-style OC card list + Best-Fit recommender), fed live from the Torn API and Supabase gateway.

**Architecture:** Single HTML file with five clearly-marked `<script>`/`<style>` sections (api, score, render, css, app). The pure scoring/data logic is lifted verbatim from `userscripts/torn-oc-bestfit.user.js` (v0.87.0) so numbers match exactly; only the transport changes (`GM_xmlhttpRequest` → `fetch`, CORS confirmed open). Rendering builds Torn-style DOM from API data; CSS reproduces the dark theme.

**Tech Stack:** Vanilla JS (ES2020), `fetch`, `localStorage`. No libraries, no build step. Node (with `node:vm`) used only to unit-test the pure scoring block.

**Source of truth:** `userscripts/torn-oc-bestfit.user.js`. Visual reference: the pasted Torn Planning DOM in the spec.

**Not a git repo:** the working dir is not initialized for git. Each task ends with a **checkpoint** (Node test or browser check) instead of a commit. Task 0 offers an optional `git init`; if accepted, replace each checkpoint with a commit.

---

## File Structure

- Create: `standalone/oc-bestfit.html` — the deliverable. Internal order:
  1. `<style id="ocbf-css">` — theme (Task 3).
  2. `<body>` skeleton: `#ocbf-topbar` (tabs + controls), `#ocbf-list`, `#ocbf-msg` (Task 6).
  3. `<script>` with marked blocks:
     - `// ==SCORE START==` … `// ==SCORE END==` — lifted pure logic (Task 2).
     - `// ==API START==` … `// ==API END==` — fetch layer (Task 1).
     - `// ==RENDER START==` … `// ==RENDER END==` — DOM builders (Tasks 4–5).
     - `// ==APP START==` … `// ==APP END==` — state, load, wiring (Tasks 6–9).
- Create: `standalone/test-core.mjs` — Node test: reads the html, extracts the SCORE block via the markers, evals it in a `vm` context, asserts behavior (Tasks 2,5-logic).
- Create: `standalone/fixtures.mjs` — sample crime/slot/history objects shared by tests.

The SCORE block is self-contained (no DOM, no fetch) so it evals cleanly in Node.

---

## Task 0: Scaffold + decide version control

**Files:**
- Create: `standalone/oc-bestfit.html`
- Create: `standalone/test-core.mjs`

- [ ] **Step 1: Confirm Node is available**

Run: `node --version`
Expected: prints a version (any v18+).

- [ ] **Step 2: Optional git init**

Ask the user once: "Initialize git in `D:\Dropbox\Apps\Torn` so tasks can commit? (y/n)". If yes:
Run: `cd /d/Dropbox/Apps/Torn && git init && printf "node_modules/\n" > .gitignore`
If no: skip; tasks use checkpoints.

- [ ] **Step 3: Create the HTML skeleton**

Create `standalone/oc-bestfit.html` with exactly:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OC Best-Fit</title>
<style id="ocbf-css">/* css added in Task 3 */</style>
</head>
<body>
<div id="ocbf-topbar"></div>
<div id="ocbf-msg"></div>
<div id="ocbf-list" class="tt-oc2-list"></div>
<script>
"use strict";
// ==SCORE START==
// ==SCORE END==
// ==API START==
// ==API END==
// ==RENDER START==
// ==RENDER END==
// ==APP START==
// ==APP END==
</script>
</body>
</html>
```

- [ ] **Step 4: Checkpoint**

Open the file in a browser. Expected: blank page, no console errors.
(If git: `git add standalone/oc-bestfit.html && git commit -m "chore: scaffold standalone page"`.)

---

## Task 1: API transport layer

**Files:**
- Modify: `standalone/oc-bestfit.html` (API block)

- [ ] **Step 1: Add the fetch wrapper + key storage between the API markers**

Paste between `// ==API START==` and `// ==API END==`:

```js
const API = "https://api.torn.com/v2";
const SUPA_URL = "https://mmoaqgkhfxmbgvirsgxw.supabase.co";
const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tb2FxZ2toZnhtYmd2aXJzZ3h3Iiwicm9sZSI6ImФub24iLCJpYXQiOjE3ODA4NTkzODQsImV4cCI6MjA5NjQzNTM4NH0.axLRQuuDx3uHHR6kK4hZugPPllBz2gawxINOA7yPPJM";
const KEY_STORE = "oc_bestfit_apikey";
const SHARE_STORE = "oc_bestfit_share";
const HIST_CACHE = "oc_bestfit_histcache";
const HIST_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } };
const setKey = v => { try { localStorage.setItem(KEY_STORE, String(v || "").trim()); } catch (e) {} };
const clearKey = () => { try { localStorage.removeItem(KEY_STORE); } catch (e) {} };
const shareOn = () => { try { return localStorage.getItem(SHARE_STORE) !== "0"; } catch (e) { return true; } };

async function gmGet(url) {
  let r;
  try { r = await fetch(url, { headers: { Accept: "application/json" } }); }
  catch (e) { throw new Error("Network error"); }
  let j;
  try { j = await r.json(); } catch (e) { throw new Error("Bad JSON from Torn API"); }
  if (j && j.error) throw new Error(`Torn API ${j.error.code}: ${j.error.error}`);
  return j;
}

async function supaFn(payload) {
  let r;
  try {
    r = await fetch(`${SUPA_URL}/functions/v1/oc-gateway`, {
      method: "POST",
      headers: { apikey: SUPA_ANON, Authorization: `Bearer ${SUPA_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) { throw new Error("Gateway unreachable"); }
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (r.status >= 200 && r.status < 300) return j || {};
  throw new Error(j && j.error || `Gateway ${r.status}`);
}
const supaOn = () => !!SUPA_ANON;
```

Note: the `SUPA_ANON` value above contains a typo placeholder character (`Ф`). Copy the **real** token verbatim from `userscripts/torn-oc-bestfit.user.js` line 51 instead — do not transcribe by hand.

- [ ] **Step 2: Add the Torn data fetchers (still in the API block)**

Append:

```js
async function fetchSelfId(key) {
  try {
    const j = await gmGet(`${API}/key/info?key=${encodeURIComponent(key)}`);
    return j.info?.user?.id || j.user?.id || null;
  } catch (e) { return null; }
}

async function fetchOpenSlots(key) {
  const j = await gmGet(`${API}/user/organizedcrimes?key=${encodeURIComponent(key)}`);
  const out = [];
  for (const oc of j.organizedcrimes || [])
    for (const s of oc.slots || []) {
      if (s.user) continue;
      out.push({
        crimeId: oc.id, name: oc.name, difficulty: oc.difficulty,
        position: s.position_info?.label || s.position,
        cpr: s.checkpoint_pass_rate || 0,
        itemRequired: !!s.item_requirement,
        itemAvailable: s.item_requirement ? !!s.item_requirement.is_available : true
      });
    }
  return out;
}

async function fetchFactionCrimes(key, cat) {
  const j = await gmGet(`${API}/faction/crimes?cat=${cat}&limit=100&sort=desc&key=${encodeURIComponent(key)}`);
  return j.crimes || [];
}
```

- [ ] **Step 3: Browser smoke test (manual, needs a key)**

In the page console with a valid key set via `setKey("YOURKEY")`:
Run: `fetchSelfId(getKey()).then(console.log)`
Expected: prints your numeric user id (not null). Confirms CORS + transport.

- [ ] **Step 4: Checkpoint**

No console errors on load. (If git: commit "feat: api transport layer".)

---

## Task 2: Lift the pure scoring block

**Files:**
- Modify: `standalone/oc-bestfit.html` (SCORE block)
- Create: `standalone/fixtures.mjs`
- Create: `standalone/test-core.mjs`

- [ ] **Step 1: Copy the pure logic verbatim from the userscript**

From `userscripts/torn-oc-bestfit.user.js`, copy these symbols **verbatim** into the SCORE block, in this order (grep each name to find it; copy the whole declaration):

- Constants: `GREEN` (line 73), `YELLOW` (74), `DIRECTIONS` (75-82).
- `OCScore` IIFE module (83-305).
- Helpers: `blendedColor` (329), `COLORS` (330-334), `median` (323-328), `fmtMoney` (322), `normKey` (1266).
- `aggregate` (956-994), `effSuccess` (1049-1064), `score` (1112-1145), `rankMetric` (1147-1163), `rank` (1165-1167), `recommend` (1169-1184), `applyFilters` (1360-1366).
- `buildWeightMap` (1268-1276).
- `OC_REQUIREMENTS` array (starts line 2883) and immediately after it add:
  `const OCBF_WEIGHTS = buildWeightMap(OC_REQUIREMENTS.flatMap(o => Object.entries(o).flatMap(([k,v]) => k==="name"?[]:[{name:o.name,position:k,weight:v}])));`
  — but first inspect the real shape of `OC_REQUIREMENTS` (read lines 2883-2900); if it is already an array of `{name, weight:{role:val}}` objects, adapt the flattener to that shape. Match the shape the script's own weight code expects.

These reference `state` and `weightsLookup`; add shims at the top of the SCORE block:

```js
let state = { weights: null, factionCfg: null, community: null, scores: null, selfId: null,
  direction: "higher", floor: 0, hideNoItem: false, slots: [], hist: null };
const effCfg = () => Object.assign({}, OCScore.CFG, state.factionCfg || {});
const weightsLookup = () => state.weights || OCBF_WEIGHTS || null;
const selfScore = () => OCScore.playerScore(state.scores || {}, state.selfId, effCfg()).score;
```

- [ ] **Step 2: Write the fixtures**

Create `standalone/fixtures.mjs`:

```js
export const SLOTS = [
  { name: "No Reserve", difficulty: 5, position: "Techie", cpr: 76, itemRequired: false, itemAvailable: true },
  { name: "No Reserve", difficulty: 5, position: "Car Thief", cpr: 81, itemRequired: false, itemAvailable: true },
  { name: "Ace in the Hole", difficulty: 9, position: "Driver", cpr: 56, itemRequired: false, itemAvailable: true }
];
export const HIST = { table: {
  "5|No Reserve": { successRate: 0.94, samples: 50, medMoney: 0, medRespect: 0, perPlayerMoney: 0, payoutPct: null, participants: 0 },
  "9|Ace in the Hole": { successRate: 0.62, samples: 30, medMoney: 0, medRespect: 0, perPlayerMoney: 0, payoutPct: null, participants: 0 }
} };
```

- [ ] **Step 3: Write the failing test**

Create `standalone/test-core.mjs`:

```js
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert";
import { SLOTS, HIST } from "./fixtures.mjs";

const html = readFileSync(new URL("./oc-bestfit.html", import.meta.url), "utf8");
const block = html.split("// ==SCORE START==")[1].split("// ==SCORE END==")[0];
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(block + "\n;this.__exports={score,rank,recommend,blendedColor,aggregate,OCScore};", ctx);
const { score, rank, recommend, blendedColor } = ctx.__exports;

// blended = round(cpr * successRate); color thresholds 70/50
const scored = score(SLOTS, HIST);
const nr = scored.find(s => s.position === "Techie");
assert.strictEqual(nr.blended, Math.round(76 * 0.94), "blended = cpr*sr");
assert.strictEqual(blendedColor(nr.blended), "green", "72>=70 is green");
const driver = scored.find(s => s.position === "Driver");
assert.strictEqual(driver.blended, Math.round(56 * 0.62));
assert.strictEqual(blendedColor(driver.blended), "red", "35<50 is red");

// ranking by raw CPR returns highest cpr first
const r = rank(scored, "raw", 1000);
assert.strictEqual(r[0].cpr, 81, "raw rank by cpr desc");
console.log("OK: scoring block");
```

- [ ] **Step 4: Run the test, expect failure first**

Run: `node standalone/test-core.mjs`
Expected (before the SCORE block is correctly filled): throws (missing symbol or marker). This proves the test exercises the extraction.

- [ ] **Step 5: Make it pass**

Ensure the SCORE block compiles in `vm` (no references to DOM/`fetch`/GM). If `score()` references `weightsLookup`/`selfScore`/`effCfg`, the shims from Step 1 cover them. Re-run.
Run: `node standalone/test-core.mjs`
Expected: `OK: scoring block`.

- [ ] **Step 6: Checkpoint**

(If git: `git add standalone/ && git commit -m "feat: lift pure scoring block + node test"`.)

---

## Task 3: Theme CSS

**Files:**
- Modify: `standalone/oc-bestfit.html` (`#ocbf-css`)

- [ ] **Step 1: Add base + card theme**

Replace the `#ocbf-css` contents with (this reproduces the dark Torn look closely; class names match the reference DOM so render code can mirror it):

```css
:root{--oc-bg:#2e2f33;--oc-card:#1c1d21;--oc-text:#d9d9d9;--oc-sub:#9aa0a6;--oc-border:#3a3b40;
--oc-clock-planning-bg:#2b8be6;--oc-clock-bg:#3a3b40;--ocbf-green:#3fb950;--ocbf-yellow:#d4a017;--ocbf-red:#e5534b;}
*{box-sizing:border-box}
body{margin:0;background:#101114;color:var(--oc-text);font:13px/1.45 Arial,Helvetica,sans-serif}
#ocbf-topbar{position:sticky;top:0;z-index:50;background:linear-gradient(#34353a,#26272b);
border-bottom:1px solid #000;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 12px}
#ocbf-topbar .tab{padding:6px 12px;border-radius:6px;cursor:pointer;color:#cfcfcf;background:rgba(255,255,255,.04)}
#ocbf-topbar .tab.active{background:#1f6feb;color:#fff}
#ocbf-topbar select,#ocbf-topbar button{background:rgba(0,0,0,.4);color:#eaeaea;border:1px solid rgba(0,0,0,.5);border-radius:6px;padding:6px 10px;cursor:pointer}
#ocbf-msg{padding:10px 14px;color:var(--oc-sub)}
.tt-oc2-list{max-width:900px;margin:0 auto;padding:12px}
.wrapper___tgDjk{position:relative;background:var(--oc-card);border:1px solid var(--oc-border);border-radius:8px;margin-bottom:12px;overflow:hidden}
.wrapper___tgDjk.tt-oc-highlight,.contentLayer___Fsdba.tt-oc-highlight{outline:2px solid #58a6ff;outline-offset:-2px}
.scenario___xSDuk .wrapper___KcK7h{background-size:cover;background-position:center;min-height:64px;display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #000}
.phase___hNuQ7{display:flex;align-items:center;gap:10px;color:#fff;text-shadow:0 1px 2px #000}
.title___b7wYN{font-weight:700;font-size:13px}
.panel___RQa61{padding:8px 12px}
.panelTitle____Ko9_{margin:0 0 4px;font-size:15px;font-weight:700}
.description___XPCiM{color:var(--oc-sub);font-size:12px;max-height:3.2em;overflow:hidden}
.description___XPCiM.expanded{max-height:none}
.seeMoreBtn___WCAXv{background:none;border:none;color:#58a6ff;cursor:pointer;padding:0;font-size:12px}
.wrapper___xXMjl{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px}
.wrapper___QkQL5{position:relative;flex:1 1 130px;min-width:130px;background:rgba(255,255,255,.03);border:1px solid var(--oc-border);border-radius:6px;padding:15px 8px 8px}
.title___d55Wy{display:block;font-weight:700;margin-bottom:4px}
.badge___b4FxD .textName___X5wiu{color:#bcd;font-size:12px}
.slotMenu___C_y_3 a{color:#58a6ff;font-size:11px;text-decoration:none}
.ocbf-cprhdr{font-weight:700;cursor:pointer;margin-left:6px}
.ocbf-crime-success{display:block;margin:4px 10px 4px auto;width:fit-content;padding:2px 8px;border:1px solid;border-radius:7px;font-size:12px;font-weight:700;background:transparent}
.oc-weight-box{margin-top:6px;padding:6px;text-align:center;border:1px solid rgba(255,255,255,.15);border-radius:6px;background:rgba(255,255,255,.03)}
.oc-weight-box .oc-weight-label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.8;border-bottom:1px solid rgba(255,255,255,.2);padding-bottom:3px;margin-bottom:4px}
.oc-weight-box .oc-weight-value{display:block;font-size:16px;font-weight:700}
@media(max-width:640px){.wrapper___QkQL5{flex-basis:100%}}
```

- [ ] **Step 2: Checkpoint**

Open in browser; topbar + empty list area styled, no errors. (If git: commit "feat: theme css".)

---

## Task 4: Render a crime card

**Files:**
- Modify: `standalone/oc-bestfit.html` (RENDER block)

- [ ] **Step 1: Add element helpers + card builder**

Between the RENDER markers paste:

```js
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null) n.append(k); return n; };
const SCEN_BASE = "https://www.torn.com/images/v2/organizedCrimes/scenario/";

function scenarioSlug(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }

function fmtCountdown(sec) {
  if (sec == null || sec <= 0) return "Ready";
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = n => String(n).padStart(2, "0");
  return `${p(d)}:${p(h)}:${p(m)}:${p(s)}`;
}

function buildCard(crime, slotsHtml, crimeSuccess) {
  const card = el("div", { className: "wrapper___tgDjk" });
  card.dataset.ocId = crime.id;
  const content = el("div", { className: "contentLayer___Fsdba" });
  const scen = el("div", { className: "scenario___xSDuk" });
  const bg = el("div", { className: "wrapper___KcK7h" });
  bg.style.backgroundImage = `url("${SCEN_BASE}${scenarioSlug(crime.name)}/dark.webp")`;
  const ready = crime.ready_at ? crime.ready_at - Math.floor(Date.now() / 1e3) : null;
  bg.append(el("div", { className: "phase___hNuQ7" }, el("div", { className: "title___b7wYN", textContent: fmtCountdown(ready) })));
  scen.append(bg);
  const panelWrap = el("div", { className: "wrapper___qZi55" });
  const panel = el("div", { className: "panel___RQa61" });
  panel.append(el("p", { className: "panelTitle____Ko9_", textContent: crime.name }));
  if (crimeSuccess != null) {
    const c = COLORS[blendedColor(crimeSuccess)];
    const badge = el("span", { className: "ocbf-crime-success", textContent: `Crime success: ${crimeSuccess}%`,
      title: "Weighted average of every role’s CPR by role importance (Σ weight × CPR)." });
    badge.style.color = c; badge.style.borderColor = c; badge.dataset.c = c;
    panel.append(badge);
  }
  panel.append(el("p", { className: "description___XPCiM", textContent: crime.description || "" }));
  panelWrap.append(panel);
  content.append(scen, panelWrap);
  const slotWrap = el("div", { className: "wrapper___xXMjl" });
  slotsHtml.forEach(s => slotWrap.append(s));
  content.append(slotWrap);
  card.append(content);
  return card;
}
```

- [ ] **Step 2: Browser check**

In console: `document.getElementById("ocbf-list").append(buildCard({id:1,name:"No Reserve",difficulty:5,ready_at:Math.floor(Date.now()/1e3)+3600,description:"test"}, [], 80))`
Expected: a styled card with scenario art (No Reserve), "Crime success: 80%" green badge, countdown ~`00:00:59:59`.

- [ ] **Step 3: Checkpoint** (If git: commit "feat: crime card renderer".)

---

## Task 5: Render slots + OCBF overlays

**Files:**
- Modify: `standalone/oc-bestfit.html` (RENDER block)
- Modify: `standalone/test-core.mjs`

- [ ] **Step 1: Add the slot builder**

Append to the RENDER block:

```js
function detailString(crime, s) {
  const sr = s.successRate;
  const fac = sr == null ? "no data" : Math.round(sr * 100) + "% of the time";
  return `${crime.name} (D${crime.difficulty}) - ${s.position}\n`
    + `Success score ${s.blended}% - chance the crime actually succeeds with you in it.\n`
    + `· in-game CPR ${s.cpr}% (your single-checkpoint pass rate)\n`
    + `· faction finishes this ${fac}`;
}

function buildSlot(crime, s, memberName) {
  const wrap = el("div", { className: "wrapper___QkQL5" });
  wrap.style.position = "relative";
  const color = COLORS[blendedColor(s.blended)];
  const header = el("button", { type: "button", className: "slotHeader___oD218" });
  header.append(el("span", { className: "title___d55Wy", textContent: s.position }));
  const cprHdr = el("span", { className: "ocbf-cprhdr", textContent: String(s.blended),
    title: `Success ${s.blended}% · CPR ${s.cpr}% (tap for detail)` });
  cprHdr.style.color = color; cprHdr.dataset.c = blendedColor(s.blended);
  cprHdr.dataset.detail = detailString(crime, s);
  cprHdr.addEventListener("click", e => { e.stopPropagation(); openDetail(cprHdr.dataset.detail, e); });
  header.append(cprHdr);
  wrap.append(header);
  if (memberName) {
    const body = el("div", { className: "slotBody___qy1ah" });
    body.append(el("div", { className: "badge___b4FxD" }, el("span", { className: "textName___X5wiu", textContent: memberName })));
    wrap.append(body);
  }
  if (s.weight != null) {
    const wb = el("div", { className: "oc-weight-box" });
    wb.append(el("span", { className: "oc-weight-label", textContent: "Weight" }),
      el("span", { className: "oc-weight-value", textContent: (Math.round(s.weight * 10) / 10) + "%" }));
    wrap.append(wb);
  }
  return wrap;
}

function openDetail(text, ev) {
  closeDetail();
  const pop = el("div", { id: "ocbf-pop", textContent: text });
  pop.style.cssText = "position:fixed;z-index:100001;white-space:pre-line;background:#1c1d21;color:#d9d9d9;border:1px solid #3a3b40;border-radius:8px;padding:12px;font-size:13px;max-width:320px;box-shadow:0 10px 34px rgba(0,0,0,.6)";
  document.body.append(pop);
  const x = ev ? ev.clientX : 120, y = ev ? ev.clientY : 120;
  pop.style.left = Math.max(8, Math.min(x, innerWidth - 332)) + "px";
  pop.style.top = Math.max(8, Math.min(y + 12, innerHeight - pop.offsetHeight - 12)) + "px";
  setTimeout(() => document.addEventListener("click", closeDetail, { once: true }), 0);
}
function closeDetail() { const p = document.getElementById("ocbf-pop"); if (p) p.remove(); }
```

- [ ] **Step 2: Add a crime-success helper (pure) to the SCORE block and export it**

In the SCORE block add:

```js
function crimeSuccessPct(scoredSlots) {
  let sumW = 0, sumWC = 0, filled = 0;
  for (const s of scoredSlots) {
    if (s.assigned) filled++;
    if (s.weight == null || !s.cpr) continue;
    sumW += s.weight; sumWC += s.weight * s.cpr;
  }
  if (sumW <= 0) return null;
  return filled === 0 ? 0 : Math.round(sumWC / sumW);
}
```

This mirrors `paintCrimeSuccess` (userscript line 1312-1357): weighted average of CPR by role weight over filled slots.

- [ ] **Step 3: Extend the Node test**

Append to `standalone/test-core.mjs` before the final log, and add `crimeSuccessPct` to the exports list in the `runInContext` string:

```js
const { crimeSuccessPct } = ctx.__exports;
const cs = crimeSuccessPct([
  { weight: 50, cpr: 80, assigned: true },
  { weight: 50, cpr: 60, assigned: true }
]);
assert.strictEqual(cs, 70, "crime success = weighted avg");
assert.strictEqual(crimeSuccessPct([{ weight: 50, cpr: 80, assigned: false }]), 0, "0 when none filled");
```

- [ ] **Step 4: Run test**

Run: `node standalone/test-core.mjs`
Expected: `OK: scoring block`.

- [ ] **Step 5: Checkpoint** (If git: commit "feat: slot + overlay renderer".)

---

## Task 6: Top bar, tabs, and the load pipeline

**Files:**
- Modify: `standalone/oc-bestfit.html` (APP block)

- [ ] **Step 1: Build the top bar + render orchestration**

Between the APP markers paste:

```js
const TABS = [["recruiting", "Recruiting"], ["planning", "Planning"], ["completed", "Completed"]];
let activeTab = "recruiting";

function setMsg(t) { const m = document.getElementById("ocbf-msg"); if (m) m.textContent = t || ""; }

function buildTopbar() {
  const bar = document.getElementById("ocbf-topbar");
  bar.textContent = "";
  TABS.forEach(([id, label]) => {
    const t = el("div", { className: "tab" + (id === activeTab ? " active" : ""), textContent: label });
    t.addEventListener("click", () => { activeTab = id; buildTopbar(); load(false); });
    bar.append(t);
  });
  const dir = el("select", { id: "ocbf-dir" });
  for (const [k, v] of Object.entries(DIRECTIONS)) dir.append(el("option", { value: k, textContent: v }));
  dir.value = state.direction;
  dir.addEventListener("change", () => { state.direction = dir.value; renderActive(); });
  bar.append(el("span", { textContent: "CPR Preset:" }), dir);
  const gear = el("button", { textContent: "⚙", title: "Settings" });
  gear.addEventListener("click", openSettings);
  const refresh = el("button", { textContent: "⟳", title: "Reload" });
  refresh.addEventListener("click", () => load(true));
  bar.append(refresh, gear);
}

let lastData = { crimes: [], openSlots: [] };

function renderActive() {
  const list = document.getElementById("ocbf-list");
  list.textContent = "";
  if (activeTab === "recruiting") return renderRecruiting(list);
  return renderFilled(list, lastData.crimes);
}
```

- [ ] **Step 2: Add the load() pipeline**

Append:

```js
async function load(force) {
  const key = getKey();
  if (!key) { renderKeyPrompt(); return; }
  setMsg("Loading…");
  try {
    state.selfId = state.selfId || await fetchSelfId(key);
    state.weights = await getWeightsSafe(key);
    state.hist = await getHistorySafe(key, force);
    state.community = await getCommunitySafe(key);
    if (activeTab === "recruiting") {
      lastData.openSlots = await fetchOpenSlots(key);
    } else {
      lastData.crimes = await fetchFactionCrimes(key, activeTab);
    }
    setMsg("");
    renderActive();
  } catch (e) {
    setMsg("Error: " + e.message);
  }
}
```

`getWeightsSafe`, `getHistorySafe`, `getCommunitySafe` are added in Task 8 (gateway). For now add temporary stubs at the end of the APP block so the page runs:

```js
async function getWeightsSafe() { return OCBF_WEIGHTS; }
async function getHistorySafe() { return { table: {} }; }
async function getCommunitySafe() { return null; }
```

- [ ] **Step 3: Add the two renderers**

Append:

```js
function scoreToWeight(name, position) {
  const W = weightsLookup(); if (!W) return null;
  const ow = W[normKey(name)]; if (!ow) return null;
  const w = ow[normKey(String(position).replace(/\s*#\d+$/, ""))];
  return w == null ? null : w;
}

function renderRecruiting(list) {
  const scored = score(lastData.openSlots, state.hist);
  const filtered = applyFilters(scored);
  const ranked = rank(filtered, state.direction, selfScore());
  const best = recommend(ranked, state.direction);
  if (!ranked.length) { setMsg("No joinable roles."); return; }
  // group by crime
  const byCrime = {};
  ranked.forEach(s => { (byCrime[s.crimeId] || (byCrime[s.crimeId] = { crime: s, slots: [] })).slots.push(s); });
  Object.values(byCrime).forEach(g => {
    const slots = g.slots.map(s => buildSlot(g.crime, { ...s, weight: scoreToWeight(s.name, s.position) }, null));
    const cs = crimeSuccessPct(g.slots.map(s => ({ weight: scoreToWeight(s.name, s.position), cpr: s.cpr, assigned: true })));
    const card = buildCard({ id: g.crime.crimeId, name: g.crime.name, difficulty: g.crime.difficulty }, slots, cs);
    if (best && best.crimeId === g.crime.crimeId) card.classList.add("tt-oc-highlight");
    list.append(card);
  });
}

function renderFilled(list, crimes) {
  if (!crimes.length) { setMsg("No crimes in this tab."); return; }
  crimes.forEach(c => {
    const slotScored = (c.slots || []).map(s => {
      const cpr = s.checkpoint_pass_rate || 0;
      const key = `${c.difficulty}|${c.name}`;
      const h = state.hist?.table?.[key];
      const eff = effSuccess(key, h);
      const sr = eff.p;
      const blended = sr != null ? Math.round(cpr * sr) : cpr;
      return { position: s.position_info?.label || s.position, cpr, successRate: sr, blended,
        weight: scoreToWeight(c.name, s.position_info?.label || s.position), assigned: !!s.user,
        member: s.user?.name || null };
    });
    const slots = slotScored.map(s => buildSlot(c, s, s.member));
    const cs = crimeSuccessPct(slotScored);
    list.append(buildCard(c, slots, cs));
  });
}
```

- [ ] **Step 4: Boot**

Append:

```js
buildTopbar();
load(false);
```

- [ ] **Step 5: Browser check (needs key)**

Set key in console, reload. Expected: Planning tab shows faction OCs with member CPR colors + weight boxes + crime-success badges; Recruiting shows joinable roles with one card highlighted; preset dropdown reorders Recruiting.

- [ ] **Step 6: Checkpoint** (If git: commit "feat: tabs + load pipeline + renderers".)

---

## Task 7: Key prompt + settings

**Files:**
- Modify: `standalone/oc-bestfit.html` (APP block)

- [ ] **Step 1: Add key prompt + settings modal**

Append to the APP block:

```js
function renderKeyPrompt() {
  setMsg("");
  const list = document.getElementById("ocbf-list");
  list.textContent = "";
  const box = el("div", { style: "max-width:480px;margin:40px auto;background:#1c1d21;border:1px solid #3a3b40;border-radius:8px;padding:18px" });
  box.append(el("div", { style: "font-weight:700;font-size:15px;margin-bottom:6px", textContent: "Set your Torn API key" }));
  box.append(el("div", { style: "color:#9aa0a6;font-size:12px;margin-bottom:10px",
    textContent: "Needs faction crimes access. Stored only in your browser (localStorage); it transits the gateway once to verify you, then is discarded. Nothing is sent anywhere else." }));
  const inp = el("input", { type: "text", placeholder: "paste API key", value: getKey(),
    style: "width:100%;padding:9px;border-radius:6px;border:1px solid #000;background:rgba(0,0,0,.3);color:#eaeaea;font-family:monospace" });
  const save = el("button", { textContent: "Save key", style: "margin-top:10px" });
  const link = el("a", { href: "https://www.torn.com/preferences.php#tab=api", target: "_blank", textContent: "get a key", style: "color:#58a6ff;margin-left:10px;font-size:12px" });
  const submit = () => { const v = inp.value.trim(); if (!v) return; setKey(v); state.selfId = null; load(true); };
  save.addEventListener("click", submit);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  box.append(inp, el("div", { style: "margin-top:8px" }, save, link));
  list.append(box);
}

function openSettings() {
  const ov = el("div", { style: "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center" });
  const box = el("div", { style: "width:420px;max-width:94vw;background:#1c1d21;border:1px solid #3a3b40;border-radius:8px;padding:18px" });
  box.append(el("div", { style: "font-weight:700;margin-bottom:10px", textContent: "Settings" }));
  const shareLbl = el("label", { style: "display:flex;gap:8px;align-items:center;margin-bottom:10px" });
  const shareChk = el("input", { type: "checkbox", checked: shareOn() });
  shareChk.addEventListener("change", () => { try { localStorage.setItem(SHARE_STORE, shareChk.checked ? "1" : "0"); } catch (e) {} });
  shareLbl.append(shareChk, document.createTextNode("Share my anonymized CPR snapshots to the community gateway"));
  const changeKey = el("button", { textContent: "Change API key" });
  changeKey.addEventListener("click", () => { ov.remove(); renderKeyPrompt(); });
  const clearBtn = el("button", { textContent: "Clear key", style: "margin-left:8px" });
  clearBtn.addEventListener("click", () => { clearKey(); state.selfId = null; ov.remove(); renderKeyPrompt(); });
  const close = el("button", { textContent: "Close", style: "margin-left:8px" });
  close.addEventListener("click", () => ov.remove());
  box.append(shareLbl, changeKey, clearBtn, close);
  ov.append(box);
  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  document.body.append(ov);
}
```

- [ ] **Step 2: Browser check**

With no key (run `clearKey()` then reload): key prompt shows. Save a key → loads. Gear → settings; toggle share; Change/Clear key work.

- [ ] **Step 3: Checkpoint** (If git: commit "feat: key prompt + settings".)

---

## Task 8: Gateway integration (community, weights, history)

**Files:**
- Modify: `standalone/oc-bestfit.html` (APP block — replace the Task 6 stubs)

- [ ] **Step 1: Replace the three stubs with real gateway-backed versions**

Delete the temporary `getWeightsSafe`/`getHistorySafe`/`getCommunitySafe` stubs and paste:

```js
async function getWeightsSafe(key) {
  if (supaOn()) {
    try {
      const r = await supaFn({ action: "weights", key });
      const rows = r && r.rows || [];
      if (rows.length) return buildWeightMap(rows);
    } catch (e) { /* fall through */ }
  }
  return OCBF_WEIGHTS;
}

async function getCommunitySafe(key) {
  if (!supaOn()) return null;
  try {
    const res = await supaFn({ action: "community", key });
    const rows = res && res.rows || [];
    const m = {};
    for (const r of rows) {
      const ok = +r.ok || 0, fail = +r.fail || 0, n = ok + fail;
      m[`${r.difficulty}|${r.name}`] = { pGlobal: n ? ok / n : null, medMoney: +r.med_money || 0, medRespect: +r.med_respect || 0 };
    }
    return m;
  } catch (e) { return null; }
}

function aggregateRows(rows) {
  const table = {};
  for (const r of rows || []) {
    const ok = +r.ok || 0, fail = +r.fail || 0, n = ok + fail;
    const medMoney = +r.med_money || 0, pct = r.payout_pct != null ? +r.payout_pct : null, part = +r.participants || 0;
    table[`${r.difficulty}|${r.name}`] = { successRate: n ? ok / n : null, medMoney, medRespect: +r.med_respect || 0,
      samples: n, payoutPct: pct, participants: part, perPlayerMoney: pct != null && part > 0 ? Math.round(medMoney * pct / 100 / part) : null };
  }
  return table;
}

function compactCrime(c) {
  const r = c.rewards || {};
  return { id: c.id, name: c.name, difficulty: c.difficulty, status: c.status, executed_at: c.executed_at || 0,
    money: r.money || 0, respect: r.respect || 0, payout_pct: r.payout && r.payout.percentage || null,
    participants: (c.slots || []).length,
    slots: (c.slots || []).map(s => ({ position: s.position_info?.label || s.position, user_id: s.user?.id || null, cpr: s.checkpoint_pass_rate || 0 })) };
}

async function getHistorySafe(key, force) {
  // gateway aggregate first
  if (supaOn()) {
    try {
      const res = await supaFn({ action: "pull", key });
      const t = aggregateRows(res && res.rows || []);
      if (Object.keys(t).length) return { table: t, source: "gateway" };
    } catch (e) { /* fall back to local */ }
  }
  // local cache
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(HIST_CACHE) || "null");
      if (c && Date.now() - c.ts < HIST_TTL_MS) return { table: c.table, source: "cache" };
    } catch (e) {}
  }
  // local fetch completed + aggregate (uses lifted aggregate())
  try {
    const crimes = (await fetchFactionCrimes(key, "completed")).map(compactCrime);
    const table = aggregate(crimes);
    try { localStorage.setItem(HIST_CACHE, JSON.stringify({ ts: Date.now(), table })); } catch (e) {}
    return { table, source: "local" };
  } catch (e) { return { table: {} }; }
}
```

- [ ] **Step 2: Verify the gateway payload shapes against the script**

Cross-check `action` names and row field names against the userscript: `getWeights` (1278), `getCommunity` (1023), `supaAggregate` (995). Field names (`ok`, `fail`, `med_money`, `med_respect`, `payout_pct`, `participants`, `difficulty`, `name`) must match exactly. Fix any divergence.

- [ ] **Step 3: Browser check (needs key)**

Reload. Expected: "faction finishes this X%" values now populate in slot detail tooltips and blended success colors shift accordingly. If you block network to the gateway (devtools offline for supabase only), it falls back to local completed-crime aggregation without errors.

- [ ] **Step 4: Checkpoint** (If git: commit "feat: gateway-backed weights/community/history".)

---

## Task 9: Snapshot push, share toggle, polish, README note

**Files:**
- Modify: `standalone/oc-bestfit.html` (APP block)
- Create: `standalone/README.md`

- [ ] **Step 1: Push CPR snapshot when sharing is on (parity with the script)**

Append to the APP block and call `pushSnapshot(key)` at the end of a successful `load()` (after `renderActive()`):

```js
async function pushSnapshot(key) {
  if (!supaOn() || !shareOn()) return;
  const slots = lastData.openSlots || [];
  if (!slots.length) return;
  const cprs = slots.map(s => ({ name: s.name, difficulty: s.difficulty, position: s.position, cpr: s.cpr }));
  try { await supaFn({ action: "push", key, snapshot: { ts: Date.now(), cprs } }); } catch (e) {}
}
```

Wire it: in `load()`, after `renderActive();` add `pushSnapshot(key);` (fire-and-forget).

- [ ] **Step 2: Add a README**

Create `standalone/README.md`:

```markdown
# OC Best-Fit — standalone page

Open `oc-bestfit.html` in any browser. Paste your Torn API key (needs faction
crimes access). The key is stored only in your browser's localStorage; it is sent
to the Torn API and once to the community gateway to verify you, and nowhere else.

Tabs: Recruiting (joinable roles, ranked by the CPR preset), Planning and Completed
(faction OCs with per-member success scores). Same scoring as the OC Best-Fit
userscript.

No install, no extension. Works offline-ish: if the community gateway is down it
falls back to your own faction's history.
```

- [ ] **Step 3: Full Node test run**

Run: `node standalone/test-core.mjs`
Expected: `OK: scoring block`.

- [ ] **Step 4: Browser regression pass**

Checklist in browser with a real key:
- Recruiting: ranked roles, one highlighted, preset reorders, min-score slider hides low.
- Planning/Completed: member CPRs colored, crime-success badges, weight boxes, countdowns.
- Slot click → detail popup; click elsewhere closes.
- Settings: share toggle persists; change/clear key.
- No console errors.

- [ ] **Step 5: Checkpoint** (If git: commit "feat: snapshot push + README".)

---

## Task 10: Min-score + item filters in the top bar

**Files:**
- Modify: `standalone/oc-bestfit.html` (APP block — `buildTopbar`)

- [ ] **Step 1: Add the two controls to buildTopbar (before the gear button)**

Insert in `buildTopbar()` after appending the preset dropdown:

```js
const floorWrap = el("label", { style: "display:flex;align-items:center;gap:4px;font-size:12px" });
const floor = el("input", { type: "range", min: "0", max: "100", value: String(state.floor) });
const floorVal = el("span", { textContent: String(state.floor), style: "min-width:24px;text-align:right" });
floor.addEventListener("input", () => { state.floor = +floor.value; floorVal.textContent = floor.value; renderActive(); });
floorWrap.append(document.createTextNode("min score"), floor, floorVal);
const itemWrap = el("label", { style: "display:flex;align-items:center;gap:4px;font-size:12px" });
const itemChk = el("input", { type: "checkbox", checked: state.hideNoItem });
itemChk.addEventListener("change", () => { state.hideNoItem = itemChk.checked; renderActive(); });
itemWrap.append(itemChk, document.createTextNode("only roles I can fill"));
bar.append(floorWrap, itemWrap);
```

(The filters apply via `applyFilters` already wired in `renderRecruiting`. They only affect Recruiting, matching the script.)

- [ ] **Step 2: Browser check**

Recruiting tab: dragging min-score hides roles below the threshold; "only roles I can fill" hides item-gated roles you lack. Switching preset keeps the filters.

- [ ] **Step 3: Checkpoint** (If git: commit "feat: min-score + item filters".)

---

## Self-Review Notes (author)

- Spec "full parity": Recruiting/Planning/Completed tabs (Task 6), preset (6 `DIRECTIONS`, Task 6), min-score + item filters (Task 10), recommendation highlight (Task 6 `tt-oc-highlight`), per-slot success+color+detail (Task 5), crime-success badge (Tasks 4-5), weight box (Task 5), settings + key prompt + share toggle (Task 7), snapshot push (Task 9). ✓
- Spec "gateway on": weights/community/history/snapshot via `supaFn` (Tasks 8-9), local fallbacks. ✓
- Spec "shareable": key in localStorage, never hardcoded, disclaimer copy (Task 7, README Task 9). ✓
- Spec "identical numbers": pure block lifted verbatim + Node test (Task 2). ✓
- Type consistency: `score()` slots carry `crimeId,name,difficulty,position,cpr,blended,successRate`; `buildSlot` consumes `position,cpr,blended,successRate,weight,assigned,member`; `crimeSuccessPct` consumes `weight,cpr,assigned`. Renderers map API fields → these shapes before calling builders. ✓
- Known open item for the executor: confirm the real shape of `OC_REQUIREMENTS` (Task 2 Step 1) and the real `SUPA_ANON` token (Task 1 Step 1) by copying from source — flagged inline, not a silent placeholder.
