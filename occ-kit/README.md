# occ-kit - write a script once, run it alone or inside the Command Center

Shared core for the repo's Torn userscripts. A script is written once as a **plug-in**; a small
build step makes two installable files from it:

| Build | What's in it | Where it goes |
| ----- | ------------ | ------------- |
| Standalone `.user.js` | kit + this plug-in + small window | Greasy Fork, readable, one file (Torn PDA safe) |
| Command Center | kit + every plug-in in its `occ.build.json` as tabs/badges | private, never on Greasy Fork |

When both are installed, the standalone copy sees the Command Center already runs that plug-in
(`<html data-occ-plugins="...">`) and steps aside, so nothing runs or calls the API twice.

## Layout

```
occ-kit/
  core/       storage (keys in Tampermonkey storage), http, torn (API v2), theme (Torn's look),
              frame (the window), ui (cards, folds, key fields, tips), md (markdown), ai, models
  shell/      occ.js (Command Center), standalone.js (one plug-in on its own)
  build.mjs   makes every <folder>/occ.build.json target; --check fails when a file is stale
  tests/      node --test occ-kit/tests/kit.test.mjs
<App folder>/
  plugin.js        the script's real code
  header.js        its ==UserScript== header (@version lives here)
  occ.build.json   { "out", "header", "shell": "standalone" | "occ", "plugins": [...] }
  *.user.js        BUILT - never edit by hand
```

## Plug-in contract

```js
export default {
  id: 'maol', label: "M'aol",     // id: short, lowercase, unique
  icon: '<svg ...>',               // optional, plain inline svg
  access: 'minimal',               // Torn key level it needs
  ai: true,                        // optional: Setup shows the OpenRouter key field
  skill: 'maol',                   // optional: the runner skill this tab replaces in OCC
  start(kit) {},                   // optional: runs once on every page (page buttons, timers)
  async mount(view, kit, { force }) {}, // optional: draws a tab / the standalone window
  badge(kit) { return element; },  // optional: small pill right of the OCC icon
  launcher(kit, toggle) {},        // optional, standalone: own page button instead of the round one
  settings(card, kit) {},          // optional: extra Setup fields
  css: '...',                      // optional: plug-in CSS (use var(--occ-*) colors)
};
```

- `export default` must be the last statement of `plugin.js`. Anything above it is private to the
  plug-in (the build wraps each plug-in in its own scope).
- A plug-in may `import` from `occ-kit/core/*` only.
- `view`: `body(node | html)`, `stats([{ k, v, unit?, hot? }])`, `meta(html)`, `busy(bool)`, `active`.
- `kit`: `keys` / `vault` (Tampermonkey storage), `store` (localStorage, UI state only), `http`,
  `torn(path)` + `TornApiError`, `tornKey()`, `ai.ask(skillId)` / `ai.write({ system, user })`,
  `ui.card/errCard/button/accordion/keyField/md/sections`, `tip`, `toast`, `el`, `esc`, `isPda()`.

## AI

`kit.ai.write({ system, user })`: the owner's key goes to the private runner (`POST /write`, free
model rotation). Anyone else uses their own OpenRouter key straight from the browser. Both call
**free models only** (`core/models.js`, shared with the runner). A standalone script with AI needs
`@connect occ-runner.yoonutz.workers.dev` and `@connect openrouter.ai`.

## House rules the kit enforces

- Torn's own look: every color comes from Torn's CSS variables (dark and light mode), with Torn's
  dark values as fallback. No native browser controls.
- Keys in Tampermonkey storage (old localStorage keys move over by themselves); PDA key filled in.
- Only Torn API calls; never scrape, never click for the player.
- Panels stay small (mobile): fold new things into existing rows.

## Workflow

1. Edit `plugin.js` / `header.js` (raise `@version`) or `occ-kit/*`.
2. `node occ-kit/build.mjs` - rebuilds every target. Size is no issue: Torn PDA loaded a 400 KB test script fine (2026-10-28).
3. Commit sources **and** built files together. CI (`.github/workflows/occ-kit.yml`) fails if a
   built file does not match its sources.
