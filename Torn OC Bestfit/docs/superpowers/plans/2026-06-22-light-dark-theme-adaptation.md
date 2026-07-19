# Light/Dark Theme Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every injected UI surface in `torn-oc-bestfit.user.js` auto-follow Torn's light/dark theme so the panel, modals, entry card, native tags, and weight boxes are readable on both themes — with zero change to the dark-theme look.

**Architecture:** A small CSS custom-property token layer set on `document.documentElement`. JS detects Torn's theme by the luminance of `--default-bg-panel-color`, assigns one of two token maps, and re-applies on a debounced MutationObserver when Torn's theme toggles. All injected nodes inherit the tokens from the root.

**Tech Stack:** Single Tampermonkey/TornPDA userscript (vanilla JS + injected CSS strings). No build, no test framework, no git in this repo.

**Project constraints (must hold):**
- ONE canonical file: `userscripts/torn-oc-bestfit.user.js`. Edit it directly. No new files (except this plan/spec), no build artifacts.
- Comment-free, keep under ~120 KB (PDA refuses larger). This change is net byte-neutral (literals → shorter `var()` refs).
- `@match` line stays exactly `https://www.torn.com/*` — do not touch the header except the version bumps in Task 6.
- Repo is NOT a git repository and global rules forbid auto-commit — there are **no commit steps**. Verification is `node --check` plus a manual visual checklist.

**Spec:** `docs/superpowers/specs/2026-06-22-light-dark-theme-adaptation-design.md`

---

## File map

- Modify: `userscripts/torn-oc-bestfit.user.js` only.
  - New code block (token maps + detection + apply + observer) inserted just before the `T` object (≈ line 2319).
  - `T` object repointed to tokens (≈ 2319–2326).
  - `boot()` wires the theme watcher (≈ 2672).
  - Main `injectStyle` CSS literal (≈ 2332).
  - 2nd-module `injectStyle` CSS literal (≈ 2898).
  - Inline node styles in `renderKeyPrompt` (≈ 611), `renderHelp` (≈ 1634, 1699), `render` (≈ 1792), `exportDataModal` (≈ 2130).
  - Header `@version` + `VERSION` fallback (Task 6).

**Token reference (used by every task):**

| Token | Dark | Light |
|---|---|---|
| `--ocbf-sub` | `#9aa0a6` | `#5a6066` |
| `--ocbf-ctl-text` | `#eaeaea` | `#2b2d31` |
| `--ocbf-hi1` | `rgba(255,255,255,.05)` | `rgba(0,0,0,.05)` |
| `--ocbf-hi2` | `rgba(255,255,255,.11)` | `rgba(0,0,0,.08)` |
| `--ocbf-hi3` | `rgba(255,255,255,.28)` | `rgba(0,0,0,.28)` |
| `--ocbf-card` | `rgba(0,0,0,.22)` | `rgba(0,0,0,.05)` |
| `--ocbf-ctl-bg` | `rgba(0,0,0,.32)` | `rgba(0,0,0,.06)` |
| `--ocbf-border` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.12)` |

---

## Task 1: Token maps, detection, apply, observer

**Files:**
- Modify: `userscripts/torn-oc-bestfit.user.js` — insert new block immediately **before** the line `const T = {` (≈ 2319).

- [ ] **Step 1: Insert the new code block before `const T = {`**

Insert exactly this (no comment lines):

```javascript
  const DARK_TOKENS = {
    "--ocbf-sub": "#9aa0a6",
    "--ocbf-ctl-text": "#eaeaea",
    "--ocbf-hi1": "rgba(255,255,255,.05)",
    "--ocbf-hi2": "rgba(255,255,255,.11)",
    "--ocbf-hi3": "rgba(255,255,255,.28)",
    "--ocbf-card": "rgba(0,0,0,.22)",
    "--ocbf-ctl-bg": "rgba(0,0,0,.32)",
    "--ocbf-border": "rgba(255,255,255,.08)"
  };
  const LIGHT_TOKENS = {
    "--ocbf-sub": "#5a6066",
    "--ocbf-ctl-text": "#2b2d31",
    "--ocbf-hi1": "rgba(0,0,0,.05)",
    "--ocbf-hi2": "rgba(0,0,0,.08)",
    "--ocbf-hi3": "rgba(0,0,0,.28)",
    "--ocbf-card": "rgba(0,0,0,.05)",
    "--ocbf-ctl-bg": "rgba(0,0,0,.06)",
    "--ocbf-border": "rgba(0,0,0,.12)"
  };
  function ocbfIsLight() {
    try {
      const root = document.documentElement;
      let v = getComputedStyle(root).getPropertyValue("--default-bg-panel-color").trim();
      if (!v && document.body) v = getComputedStyle(document.body).backgroundColor;
      if (!v) return false;
      let r, g, b;
      const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (m) {
        r = +m[1];
        g = +m[2];
        b = +m[3]
      } else {
        let h = v.replace("#", "").trim();
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length < 6) return false;
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16)
      }
      if ([r, g, b].some(n => isNaN(n))) return false;
      return (.299 * r + .587 * g + .114 * b) > 140
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
```

- [ ] **Step 2: Repoint the `T` object**

Replace the existing `T` object (≈ 2319–2326):

```javascript
  const T = {
    bg: "var(--default-bg-panel-color, #2e2f33)",
    text: "var(--default-color, #d4d4d4)",
    sub: "var(--tooltip-comment-color, #9aa0a6)",
    border: "rgba(0,0,0,.4)",
    divider: "var(--default-panel-divider-color, rgba(255,255,255,.08))",
    titleGrad: "linear-gradient(180deg,#5b5b5b 0%,#383838 55%,#262626 100%)"
  };
```

with:

```javascript
  const T = {
    bg: "var(--default-bg-panel-color, #2e2f33)",
    text: "var(--default-color, #d4d4d4)",
    sub: "var(--ocbf-sub, #9aa0a6)",
    border: "var(--ocbf-border, rgba(0,0,0,.4))",
    divider: "var(--ocbf-border, var(--default-panel-divider-color, rgba(255,255,255,.08)))",
    titleGrad: "linear-gradient(180deg,#5b5b5b 0%,#383838 55%,#262626 100%)"
  };
```

- [ ] **Step 3: Call the watcher at the top of `boot()`**

In `boot()` (≈ 2672), the body currently starts:

```javascript
  function boot() {
    if (booted) return;
    booted = true;
    setInterval(() => {
```

Change to (insert the `try { watchTheme() }` line):

```javascript
  function boot() {
    if (booted) return;
    booted = true;
    try {
      watchTheme()
    } catch (e) {}
    setInterval(() => {
```

- [ ] **Step 4: Syntax check**

Run: `node --check userscripts/torn-oc-bestfit.user.js`
Expected: no output, exit 0.

---

## Task 2: Main `injectStyle` CSS literal (≈ line 2332)

**Files:**
- Modify: `userscripts/torn-oc-bestfit.user.js` — the single `st.textContent = \`…\`` string in the first `injectStyle()`.

Apply these exact substring replacements (operate on the one big literal). Each `old` carries enough context to be unique; do them in order.

- [ ] **Step 1: scrollbar-color (2 occurrences — replace all)**

old: `scrollbar-color:rgba(255,255,255,.32) rgba(0,0,0,.25)`
new: `scrollbar-color:var(--ocbf-hi3) var(--ocbf-hi1)`

- [ ] **Step 2: scrollbar track**

old: `-track,.ocbf-scroll::-webkit-scrollbar-track{background:rgba(0,0,0,.28);border-radius:5px}`
new: `-track,.ocbf-scroll::-webkit-scrollbar-track{background:var(--ocbf-hi1);border-radius:5px}`

- [ ] **Step 3: scrollbar thumb**

old: `-thumb,.ocbf-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.32);border-radius:5px}`
new: `-thumb,.ocbf-scroll::-webkit-scrollbar-thumb{background:var(--ocbf-hi3);border-radius:5px}`

- [ ] **Step 4: scrollbar thumb hover**

old: `-thumb:hover{background:rgba(255,255,255,.45)}`
new: `-thumb:hover{background:var(--ocbf-hi3)}`

- [ ] **Step 5: range tracks (webkit + moz)**

old: `::-webkit-slider-runnable-track{height:4px;border-radius:3px;background:rgba(255,255,255,.25)}`
new: `::-webkit-slider-runnable-track{height:4px;border-radius:3px;background:var(--ocbf-hi3)}`

old: `::-moz-range-track{height:4px;border-radius:3px;background:rgba(255,255,255,.25)}`
new: `::-moz-range-track{height:4px;border-radius:3px;background:var(--ocbf-hi3)}`

- [ ] **Step 6: range thumbs (webkit + moz)**

old: `border-radius:50%;background:#e8e8e8;border:1px solid rgba(0,0,0,.6);box-shadow:0 1px 2px rgba(0,0,0,.5)}`
new: `border-radius:50%;background:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.6);box-shadow:0 1px 2px rgba(0,0,0,.5)}`

old: `border:1px solid rgba(0,0,0,.6);border-radius:50%;background:#e8e8e8}`
new: `border:1px solid rgba(0,0,0,.6);border-radius:50%;background:var(--ocbf-ctl-text)}`

- [ ] **Step 7: table header bg (resolves the .28 collision via context)**

old: `#ocbf-panel th{position:sticky;top:34px;background:rgba(0,0,0,.28);`
new: `#ocbf-panel th{position:sticky;top:34px;background:var(--ocbf-ctl-bg);`

- [ ] **Step 8: row stripe + row hover**

old: `table tr:nth-child(even){background:rgba(255,255,255,.03)}`
new: `table tr:nth-child(even){background:var(--ocbf-hi1)}`

old: `table tr:hover{background:rgba(255,255,255,.06)}`
new: `table tr:hover{background:var(--ocbf-hi2)}`

- [ ] **Step 9: `.ocbf-ctl` base + hover**

old: `.ocbf-ctl{background:rgba(0,0,0,.3);color:#eaeaea;border:1px solid rgba(0,0,0,.5);border-radius:4px;`
new: `.ocbf-ctl{background:var(--ocbf-ctl-bg);color:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.5);border-radius:4px;`

old: `.ocbf-ctl:hover{background:rgba(255,255,255,.12)}`
new: `.ocbf-ctl:hover{background:var(--ocbf-hi2)}`

- [ ] **Step 10: segment container + buttons**

old: `.ocbf-seg{display:inline-flex;border:0.5px solid rgba(255,255,255,.2);border-radius:8px;overflow:hidden;background:rgba(255,255,255,.04)}`
new: `.ocbf-seg{display:inline-flex;border:0.5px solid var(--ocbf-border);border-radius:8px;overflow:hidden;background:var(--ocbf-hi1)}`

old: `border-right:0.5px solid rgba(255,255,255,.12);background:transparent;color:#cfcfcf;`
new: `border-right:0.5px solid var(--ocbf-border);background:transparent;color:var(--ocbf-ctl-text);`

old: `.ocbf-segbtn:hover{background:rgba(255,255,255,.10);color:#fff}`
new: `.ocbf-segbtn:hover{background:var(--ocbf-hi2);color:var(--ocbf-ctl-text)}`

old: `.ocbf-segbtn:active{background:rgba(255,255,255,.16)}`
new: `.ocbf-segbtn:active{background:var(--ocbf-hi3)}`

- [ ] **Step 11: `#ocbf-dir` bg + dropdown arrow color**

old: `#ocbf-dir{-webkit-appearance:none;appearance:none;background-color:rgba(0,0,0,.4);`
new: `#ocbf-dir{-webkit-appearance:none;appearance:none;background-color:var(--ocbf-ctl-bg);`

old: `fill='%23cfcfcf'`
new: `fill='%23999999'`

- [ ] **Step 12: `.ocbf-lab` text**

old: `#ocbf-panel .ocbf-lab{font-size:11px;color:#dcdcdc;`
new: `#ocbf-panel .ocbf-lab{font-size:11px;color:var(--ocbf-ctl-text);`

(Leave `#ocbf-dir option{background:#2e2f33;color:#eaeaea}` and `option:checked` untouched — native dropdown lists ignore `var()` on most platforms; a dark list reads fine on both themes.)

- [ ] **Step 13: Syntax check**

Run: `node --check userscripts/torn-oc-bestfit.user.js`
Expected: no output, exit 0.

---

## Task 3: 2nd-module `injectStyle` CSS literal (≈ line 2898)

**Files:**
- Modify: `userscripts/torn-oc-bestfit.user.js` — the `style.textContent = \`…\`` in the second `injectStyle()`.

- [ ] **Step 1: weight box border + bg**

old: `.oc-weight-box { margin-top:6px; padding:6px; text-align:center; border:1px solid rgba(255,255,255,0.15); border-radius:6px; background:rgba(255,255,255,0.03); }`
new: `.oc-weight-box { margin-top:6px; padding:6px; text-align:center; border:1px solid var(--ocbf-border); border-radius:6px; background:var(--ocbf-hi1); }`

- [ ] **Step 2: weight label divider**

old: `border-bottom:1px solid rgba(255,255,255,0.2); }`
new: `border-bottom:1px solid var(--ocbf-border); }`

(Leave `.ocbf-oc-requirement` rule as-is: it is dead code — `applyRequirementsToPanels` only removes those nodes, never creates them. Leave `.ocbf-warning-bubble` `#ff6600`/`#fff` as-is: orange badge with white text reads fine on both themes.)

- [ ] **Step 3: Syntax check**

Run: `node --check userscripts/torn-oc-bestfit.user.js`
Expected: no output, exit 0.

---

## Task 4: Inline node styles

**Files:**
- Modify: `userscripts/torn-oc-bestfit.user.js` at the inline `style:`/`cssText` strings listed below.

- [ ] **Step 1: API-key textarea in `renderKeyPrompt` (≈ 611)**

old: `style: "width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);color:#eaeaea;border:1px solid rgba(0,0,0,.5);border-radius:6px;padding:9px;font-size:14px;font-family:monospace"`
new: `style: "width:100%;box-sizing:border-box;background:var(--ocbf-ctl-bg);color:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.5);border-radius:6px;padding:9px;font-size:14px;font-family:monospace"`

- [ ] **Step 2: help info block bg in `renderHelp` (≈ 1634)**

old: `style: "background:rgba(0,0,0,.18);border-radius:6px;padding:8px"`
new: `style: "background:var(--ocbf-card);border-radius:6px;padding:8px"`

- [ ] **Step 3: help keycap chip in `renderHelp` (≈ 1699)**

old: `style: "font-family:monospace;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.13);border-radius:4px;padding:1px 5px;color:#eaeaea;font-size:11px;white-space:nowrap",`
new: `style: "font-family:monospace;background:var(--ocbf-ctl-bg);border:1px solid var(--ocbf-border);border-radius:4px;padding:1px 5px;color:var(--ocbf-ctl-text);font-size:11px;white-space:nowrap",`

- [ ] **Step 4: recommended card tint in `render` (≈ 1792)**

old: `style: `display:flex;align-items:center;gap:12px;border-left:4px solid ${c};background:rgba(0,0,0,.22);padding:12px;border-radius:4px;cursor:pointer``
new: `style: `display:flex;align-items:center;gap:12px;border-left:4px solid ${c};background:var(--ocbf-card);padding:12px;border-radius:4px;cursor:pointer``

- [ ] **Step 5: export textarea in `exportDataModal` (≈ 2130)**

old: `style: "width:100%;box-sizing:border-box;height:300px;background:rgba(0,0,0,.3);color:#eaeaea;border:1px solid rgba(0,0,0,.5);border-radius:6px;padding:8px;font-family:monospace;font-size:11px;white-space:pre"`
new: `style: "width:100%;box-sizing:border-box;height:300px;background:var(--ocbf-ctl-bg);color:var(--ocbf-ctl-text);border:1px solid rgba(0,0,0,.5);border-radius:6px;padding:8px;font-family:monospace;font-size:11px;white-space:pre"`

(Leave modal backdrop scrims `rgba(0,0,0,.6)` at ≈ 2112/2193/2304, the popover/box shadows, the header text-shadow, and `${T.titleGrad}` untouched — scrims and shadows read correctly on both themes; the header stays a dark gradient with white text by design.)

- [ ] **Step 6: Syntax check**

Run: `node --check userscripts/torn-oc-bestfit.user.js`
Expected: no output, exit 0.

---

## Task 5: Verify behavior + size

**Files:** none (verification only).

- [ ] **Step 1: Confirm no leftover dark-only literals in injected CSS**

Run: `grep -nE "rgba\(255,255,255" userscripts/torn-oc-bestfit.user.js`
Expected: only the harmless fallback inside `T.divider` (`var(--ocbf-border, var(--default-panel-divider-color, rgba(255,255,255,.08)))`) and the sparkline stroke fallback at ≈ 1471 (`var(--default-panel-divider-color, rgba(255,255,255,.08))`). No bare `rgba(255,255,255,…)` remains in `.ocbf-*` rules or inline styles.

- [ ] **Step 2: Confirm size under cap**

Run: `wc -c userscripts/torn-oc-bestfit.user.js`
Expected: under 122880 bytes (120 KB). Should be ≈ the pre-change size or smaller.

- [ ] **Step 3: Manual visual check — dark theme**

In Torn with the **dark** theme active, open the OC Best-Fit panel, Settings, About, Export, Help tabs, and the on-page crime panels. Expected: visually identical to before this change (no perceptible shift).

- [ ] **Step 4: Manual visual check — light theme**

Switch Torn to the **light** theme. Expected:
- "RECOMMENDED", "Your score", "OC access", the color legend, sub-lines, and history note are dark-grey and clearly legible (not pale grey).
- Row hover, scrollbar, segment-control borders, control buttons, and the dropdown arrow are visible.
- The recommended card tint is a faint light shade, not a dark slab.
- The native crime-panel weight boxes show a visible border and background; their text is legible.

- [ ] **Step 5: Manual visual check — live toggle**

With the panel open, toggle Torn's theme. Expected: the panel re-themes within ~150 ms without a page reload.

---

## Task 6: Version bump

**Files:**
- Modify: `userscripts/torn-oc-bestfit.user.js` — header `@version` (line 4) and the `VERSION` fallback constant.

- [ ] **Step 1: Bump `@version`**

old: `// @version      0.83.0`
new: `// @version      0.84.0`

- [ ] **Step 2: Bump the `VERSION` fallback constant (≈ line 61)**

old: `  const VERSION = typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version || "0.83.0";`
new: `  const VERSION = typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version || "0.84.0";`

- [ ] **Step 3: Final syntax check**

Run: `node --check userscripts/torn-oc-bestfit.user.js`
Expected: no output, exit 0.

---

## Done criteria

- `node --check` passes.
- File < 120 KB.
- No bare `rgba(255,255,255,…)` in `.ocbf-*` CSS rules or inline styles (only the two documented `var(...)` fallbacks remain).
- Dark theme unchanged; light theme legible; live toggle works.
- `@version` and `VERSION` both bumped to `0.84.0`.

(No commit step: repo is not a git repository and global rules forbid auto-commit. Propose the commit message to the user only if/when the repo is initialized.)
