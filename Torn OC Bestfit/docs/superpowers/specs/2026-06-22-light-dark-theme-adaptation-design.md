# OC Best-Fit — Light/Dark Theme Adaptation

**Date:** 2026-06-22
**File:** `userscripts/torn-oc-bestfit.user.js` (single canonical script)

## Problem

The injected UI half-adapts to Torn's theme. The floating panel and modals take their
surface background from Torn's own CSS variable (`--default-bg-panel-color`), so on Torn's
**light** theme the background turns light — but the text, highlights, and borders were all
hardcoded for a dark surface:

- Muted/secondary text uses `var(--tooltip-comment-color, #9aa0a6)` — a light grey that has
  poor contrast on a light background (the "RECOMMENDED", sub-lines, "OC access", legend, and
  history note in the screenshot).
- ~27 hardcoded `rgba(255,255,255,.x)` highlights (hover rows, stripes, scrollbar track/thumb,
  segment borders, range track) become invisible on a light surface.
- Control/button text hexes (`#eaeaea`, `#cfcfcf`, `#dcdcdc`) are near-white → invisible on light.
- The 2nd module's weight box (`border:1px solid #fff`, `background:rgba(255,255,255,.03)`)
  and requirement chip border (`#fff`) disappear on light.

Goal: **auto-follow Torn's theme** so every injected surface is readable on both themes, with
**zero change to the dark-theme appearance** and the file staying under the ~120 KB PDA cap.

## Decisions (from brainstorming)

- **Theme source:** Auto-follow Torn. No setting, no manual toggle.
- **Scope:** Everything injected — floating panel + body, all modals (Settings/About/Export/Help),
  entry/recommendation card, native-page crime-slot tags, and the 2nd-module requirement/weight boxes.
- **Approach:** A — a CSS custom-property token layer (chosen over duplicate stylesheets or
  pure Torn-var reliance because it is both lean and complete).

The green/yellow/red score colors (`COLORS`) already read fine on both themes and are left untouched.
The panel header gradient (`T.titleGrad`) stays dark on both themes (white text on a dark gradient
reads fine either way) and is left untouched.

## Token layer

Define ~8 CSS custom properties on `document.documentElement`. Every injected node (the panel and
all modals are appended to `body`; native tags are inside Torn's DOM) inherits from the root, so a
single assignment themes all surfaces. Nearby opacities collapse to the nearest token — ~27 literal
colors reduce to 8 variables (net byte-neutral or smaller).

| Token | Role (current hardcoded usage) | Dark value | Light value |
|---|---|---|---|
| `--ocbf-sub` | muted/secondary text (`T.sub`, 32 uses) | `#9aa0a6` | `#5a6066` |
| `--ocbf-ctl-text` | control/button text (`#eaeaea`, `#cfcfcf`, `#dcdcdc`) | `#eaeaea` | `#2b2d31` |
| `--ocbf-hi1` | subtle bg: row stripes, segment bg, weight-box bg, range/scrollbar track (.03–.06) | `rgba(255,255,255,.05)` | `rgba(0,0,0,.05)` |
| `--ocbf-hi2` | hover (.10–.13) | `rgba(255,255,255,.11)` | `rgba(0,0,0,.08)` |
| `--ocbf-hi3` | active / strong border / scrollbar thumb (.16–.32) | `rgba(255,255,255,.28)` | `rgba(0,0,0,.28)` |
| `--ocbf-card` | recommended-card tint (`rgba(0,0,0,.22)`) | `rgba(0,0,0,.22)` | `rgba(0,0,0,.05)` |
| `--ocbf-ctl-bg` | control/select base bg (`rgba(0,0,0,.3–.4)`) | `rgba(0,0,0,.32)` | `rgba(0,0,0,.06)` |
| `--ocbf-border` | dividers / borders (`T.divider`, segment/control borders) | `rgba(255,255,255,.08)` | `rgba(0,0,0,.12)` |

`T.bg` and `T.text` keep referencing Torn's own variables (`--default-bg-panel-color`,
`--default-color`) — those already flip with Torn's theme — but their dark fallbacks are retained.
The other `T` fields (`sub`, `divider`, `border`) are repointed to `var(--ocbf-*)`, so all existing
`T.sub`/`T.divider`/`T.border` call-sites are fixed by editing the `T` object alone.

## Detection

```
function ocbfIsLight() {
  read computed --default-bg-panel-color on documentElement;
  if empty -> sample getComputedStyle(document.body).backgroundColor;
  parse to r,g,b (supports #hex and rgb()/rgba());
  luminance = .299*r + .587*g + .114*b;
  return luminance > 140;   // light
  // unparseable -> return false (dark = today's behavior, safe default)
}
```

## Apply + live flip

```
function applyTheme() {
  const light = ocbfIsLight();
  const map = light ? LIGHT_TOKENS : DARK_TOKENS;   // two small plain objects
  for (k,v of map) if (root style[k] !== v) documentElement.style.setProperty(k, v);
}
```

- Call `applyTheme()` once at boot, **before** the first `injectStyle()`, so the panel renders
  themed from the first paint.
- One debounced (~150 ms) `MutationObserver` watches `document.documentElement` and
  `document.body` for `class`/`attr`/`style` changes (Torn toggles its theme via a body/root class).
  On change, re-run `applyTheme()`. `setProperty` only when the value actually changed, so a no-op
  mutation costs nothing visible.
- Single shared observer; no per-render polling.

## Touched code

1. **`T` object** (≈ line 2319): `sub`/`divider`/`border` → `var(--ocbf-*)`; `bg`/`text` keep Torn
   vars with fallbacks.
2. **Main `injectStyle` CSS literal** (≈ 2328–2334): swap every `rgba(255,255,255,.x)` and grey hex
   (`#eaeaea`, `#cfcfcf`, `#dcdcdc`, scrollbar/range/seg colors) to `var(--ocbf-*)`.
3. **2nd-module `injectStyle` CSS literal** (≈ 2896–2900): weight box border/bg, weight-label
   border, requirement chip border → `var(--ocbf-*)`.
4. **Inline node styles** in `render`, `buildPanel`, and the modal builders (`openSettings`,
   `aboutModal`, `exportDataModal`, `buildScoreContent`, `renderHelp`, `renderTrend`): swap the
   scattered `rgba(0,0,0,.22)` card tint and any inline `rgba(255,255,255,…)` to `var(--ocbf-*)`.
5. **New code:** `DARK_TOKENS` / `LIGHT_TOKENS` objects, `ocbfIsLight()`, `applyTheme()`, and the
   observer wiring inside `boot()`.

## Testing

- `node --check torn-oc-bestfit.user.js` passes.
- **Dark theme:** panel/modals/native tags pixel-identical to current (DARK_TOKENS reproduce the
  exact current values for the .05/.11/.28 buckets within rounding; spot-check no visible shift).
- **Light theme:** sub-text is dark and legible; hover rows, scrollbar, segment borders, weight box,
  and requirement chip are all visible; recommended-card tint is subtle, not a dark slab.
- **Live toggle:** flipping Torn's theme re-themes the open panel without a reload.
- **Size:** file stays < 120 KB (expected net-neutral or smaller — literals replaced by shorter
  `var()` refs).

## Out of scope

- No manual light/dark/auto setting.
- No change to score colors, header gradient, or the stop-sign pulse animation colors.
- No new top-level files, no build step (single canonical script, edited directly per project rules).
