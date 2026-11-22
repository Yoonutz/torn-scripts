# Torn Colored Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Color the header and tint the messages of each Torn group chat window (not private chats), with a monocolor palette icon in the header to change the color.

**Architecture:** One hand-written userscript file. A throttled MutationObserver marks group chat windows with `data-tcc` and a `--tcc` CSS variable; one injected stylesheet does the coloring. The palette popup lives in `document.body` (position fixed) so it never widens a chat window.

**Tech Stack:** Plain JS userscript, GM_getValue/GM_setValue (localStorage fallback for PDA), Playwright + node:test on a mock.

**Spec:** `docs/superpowers/specs/2026-11-22-torn-colored-chats-design.md`

## Global Constraints
- 0 requests of any kind. No Torn key. `@grant GM_getValue, GM_setValue` only.
- Private chat = window `id` of digits only: never touched.
- Header with a `message___` class (Torn green "new message") keeps Torn's look.
- No horizontal scrollbar, no wider header (P24). Pause work while `document.hidden`.
- Match hashed classes by stable prefix only (`[class*="header___"]`).
- Public script: no comments, no unrelated code.

## Review Focus
- Click on the palette icon must not minimize the window or start a drag (header is a button, windows are draggable).
- React re-render of a window: mark again, no duplicate icon.
- Light theme: tint mixes with #f2f2f2, not #333.
- Popup near the right screen edge (Trade window) stays inside the viewport.
- Unknown room ids (group chats) get the "other" default.

---

### Task 1: Mock + script + tests
**Files:** Create `Torn Colored Chats/torn-colored-chats.user.js`, `Torn Colored Chats/tests/mock/chat.html` (chatRoot from Ionut's 2026-11-22 save, other-script nodes removed, small CSS that copies Torn's header gradient and the green `message___` rule), `Torn Colored Chats/tests/harness.mjs`, `Torn Colored Chats/tests/chats.pw.mjs`.

**Interfaces:** palette `PAL` = 8 hex colors (red, orange, amber, teal, blue, indigo, purple, pink, no green). Defaults: faction red, company blue, global teal, trade amber, other purple. Storage key `tcc.colors` = `{ [windowId]: hex | 'none' }`.

- [ ] Tests: `privateUntouched`, `groupsColored` (4 windows, icon before minimize, header bg = default), `newMessageGreenKept`, `pickColor` (click icon, click swatch: header changes, value stored, header click counter unchanged), `noneAndDefault`, `keptAfterReload`, `reRenderNoDup`, `noWiden at 1280/390`, `popupInViewport`.
- [ ] Run, see FAIL. Write script. Run, see PASS.

### Task 2: README, greasyfork.md, screenshots, repo README row
- [ ] README with ToS table + KamiRen credit; greasyfork.md pure HTML; Playwright screenshots 1280/390 DSF 2.
- [ ] One commit on branch, push after Ionut's go.
