# OC Best-Fit Panel — Drag + Mobile Fit + Close Button

Date: 2026-06-19
File: `userscripts/torn-oc-bestfit.user.js`

## Goal

Replace anchor-tethered panel positioning with a draggable, position-remembering
floating window that fully fits the phone viewport (portrait + landscape) and has
an explicit X close button.

## Decisions

- Drag everywhere (desktop + mobile); auto-size + clamp to viewport.
- Persist last position via `GM_setValue`; clamp on restore.
- Keep both close paths: X button **and** click-outside.

## Changes

1. **Fix dead `injectStyle`.** Two `function injectStyle()` declarations exist in the
   same IIFE scope; the second (native-page styles) overrides the first (panel styles),
   so the panel stylesheet never injects. Merge into one `injectStyle()` keeping the
   `#ocbf-style` dedup guard. Both call sites unchanged.

2. **Remove anchor positioning.** `openPanelFrom(anchor, onToggle)` no longer reads
   `anchor.getBoundingClientRect()`. Tab buttons remain open/close togglers. Anchor is
   still referenced only in the click-outside guard. Drop the `ocbf-sheet` bottom-sheet
   branch.

3. **Drag.** Header is the drag handle via pointer events (mouse + touch). Drag does not
   start when the grab lands on an interactive control (button/select/input/X). New
   `POS_STORE` key persists `{left, top}`, restored + clamped on open.

4. **Mobile fit.** On open: `width = min(360, innerWidth-16)`, `panel.maxHeight =
   innerHeight-16`, body max-height set to remaining space (scrolls). Clamp left/top so
   the panel is fully on-screen. A `resize` listener re-sizes + re-clamps. Remove the
   `@media (max-width:640px)` position-forcing `!important` rules; keep the larger
   touch-target rules.

5. **X button.** Top-right of header row1; closes the panel. Click-outside retained.

## Constraints

- No comment lines in the script; keep under ~120 KB.
- Single canonical file; no throwaway copies left behind.
- Bump `@version` header and `VERSION` fallback on release.
