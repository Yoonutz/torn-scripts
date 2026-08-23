# Operational Command Center - design (mock-up)

Date: 2026-08-23. Approved by Kami in chat before this file was written.

## Goal

One floating dashboard inside Torn that hosts every future "skill" as a button. Pressing a
button runs that skill and shows its result in the content pane. First release is a mock-up:
the shell is real, the single Ledger skill returns static numbers.

## Constraints

- Runs in desktop Tampermonkey and in Torn PDA: `@grant none`, `localStorage` only, no `GM_*`.
- `@match https://www.torn.com/*` exactly (anything after `#` never matches).
- Single file, comment-free body, well under 120 KB (PDA refuses larger scripts).
- Version starts at 0.1.0; the Greasy Fork stub must never carry a higher number.
- No browser-default widgets; every control is drawn by the script.

## Architecture

- `Operational Command Center/operational-command-center.user.js` - the one canonical file.
- Registry: `skills` array of `{ id, label, icon, run }`. `run()` returns a DOM node or a Promise
  of one. Sidebar buttons are generated from the array; adding a skill is one array entry.
- Launcher: round floating button, bottom right, z-index above Torn's bars. Tap toggles window.
- Window: fixed overlay. Below 768px it fills the viewport; above it floats 420x640 bottom right.
- Layout: CSS grid with three areas - header (title, active skill, close), sidebar (56px icon
  column, one button per skill, active highlighted), content (scrollable result pane).
- Run flow: press button, content shows "Running <label>...", then the node `run()` returned.
  A thrown error renders as a red card with the message, never a blank pane.
- State in `localStorage` under `occ.open` and `occ.skill`; restored on page load.
- Mock Ledger skill: static numbers from the 2026-08-23 Torn Ledger report, text bars, leak list.

## Out of scope

Live data, real skill execution, dragging, theming options, settings page.

## Testing

Visual check in the shared headless Chrome on torn.com at 375x812 mobile and 1280x800 desktop:
launcher visible, window opens, Ledger button renders the mock card, close works, no native
widgets. Publish check against the Greasy Fork code endpoint after the webhook sync.

## Update 0.4.0 - real data through a runner (same day)

Approved flow: button press sends the skill's SKILL.md to the free model router; the model calls a
`run_script` tool; the script executes that tool against a private Cloudflare Worker
(`occ-runner`, folder `Operational Command Center/worker/`); the tool result goes back to the
model, which delivers the answer per the skill's delivery rule. The exact script output stays
available behind a "Show exact script output" toggle, because free models sometimes mangle a line.

- Worker bundles `lib.mjs` from the skill folder (one source of truth), pulls the nine Torn
  endpoints, stores snapshots in KV (`ledger:<date>` plus `ledger:index`), reuses a snapshot
  younger than 10 minutes, and renders with `compare` + `render`.
- No Worker secrets (0.4.1): the caller sends their own Torn API key as the credential; the
  Worker uses it for the Torn calls, never stores it, and keeps snapshots under a hash of the key.
  The key is pasted once in Setup as "Torn API token"; Torn PDA fills it in automatically.
- If the model answers without calling the tool, the script runs the tool itself and asks once
  more; if the model still gives nothing, the raw report is shown.
- Worker history is separate from the desktop weekly run; both use identical logic.
