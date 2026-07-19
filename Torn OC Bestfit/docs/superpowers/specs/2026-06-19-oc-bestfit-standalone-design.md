# OC Best-Fit — Standalone HTML Page

Date: 2026-06-19
Source of truth: `userscripts/torn-oc-bestfit.user.js` (v0.87.0)
Deliverable: `standalone/oc-bestfit.html` — one self-contained file.

## Goal

A single standalone HTML file that reproduces the OC Best-Fit userscript **1:1** for
people who can't install userscripts. It renders Torn's Organized Crimes list in Torn's
visual style and applies the same Best-Fit scoring, coloring, weights, and recommendation.

## Confirmed decisions

- **Full parity**: Torn-style OC card list + Best-Fit recommender + settings.
- **Gateway on**: use the Supabase `oc-gateway` for community success, shared weights,
  player scores — same payloads as the script.
- **Shareable**: anyone opens the file and pastes their own Torn API key (stored only in
  their browser, `localStorage`). No key baked into the file. Short "key stays local" note.
- **Integrated top bar** (not a floating panel): tabs + preset + filters + settings in a
  fixed strip; the recommendation highlights the best card inline.
- **History**: gateway aggregate first; fallback to local `faction/crimes?cat=completed`
  aggregation cached in `localStorage` with a TTL.

## Feasibility (verified)

- `api.torn.com/v2` returns `access-control-allow-origin: *` on GET and reflects Origin on
  OPTIONS → a browser page can call it directly with `fetch`.
- Supabase `oc-gateway` returns `Access-Control-Allow-Origin: *` on the POST preflight.
- Therefore no proxy is needed; the page runs the script's exact data pipeline.

## Architecture (single file, clearly sectioned)

1. **api** — `gmGet` (fetch wrapper, JSON + Torn error handling), `fetchOpenSlots`
   (`user/organizedcrimes`), `fetchFactionCrimes` (`faction/crimes?cat=recruiting|planning|completed`),
   `fetchSelfId` (`key/info`), `getHistory` + `aggregate` / gateway `supaAggregate`,
   `getCommunity`, `getWeights`, `supaFn` (gateway POST, same payloads/headers).
2. **score** — lifted **verbatim** from the userscript: `OCScore` module, `score`,
   `rank`, `recommend`, `effSuccess`, `aggregate`, `rankMetric`, color thresholds
   (GREEN 70 / YELLOW 50), `DIRECTIONS`, `OC_REQUIREMENTS`, `buildWeightMap`,
   `weightsLookup`, `normKey`. Only transport differs (GM → fetch).
3. **render** — build Torn-style DOM from API data: crime cards (scenario background via
   absolute torn.com image URLs, phase clock conic-gradient, level bar, description with
   Show more) + OCBF overlays exactly as the script emits: `ocbf-crime-success` badge,
   per-slot `ocbf-cprhdr` success score with color + detail tooltip, `oc-weight-box`,
   recommendation highlight (`tt-oc-highlight`).
4. **css** — reproduce Torn dark theme for the used classes (cards, tabs, clocks, level
   bars, badges) plus the script's panel/control CSS.
5. **app** — `state`, `load()`, tab switching, preset/filter wiring, key prompt, settings
   (API key, share toggle, replace-CPR toggle), self-score + delta.

## Layout / UX

- **Top strip**: `Recruiting | Planning | Completed` tabs + **CPR Preset** dropdown (the six
  `DIRECTIONS`) + min-score slider + "only roles I can fill" checkbox + info / refresh /
  settings (gear). Fixed at top.
- **Recruiting tab** = open joinable roles (`user/organizedcrimes`); your CPR per role,
  best-fit ranked by the active preset, recommendation highlighted.
- **Planning tab** = faction's filled OCs; each assigned member's CPR + crime-success% +
  weight box (the pasted reference view).
- **Completed tab** = faction's finished OCs (`faction/crimes?cat=completed`); same card
  style, shows outcome. Reuses the history fetch already needed for success rates.

## Data flow per load

key → verify (`key/info`) → fetch faction crimes (+ open slots) → history table
(gateway pull; fallback local aggregate of completed, cached) → community / weights /
scores via gateway → `score()` → `rank()` / `recommend()` → render.

## Error handling (same behavior as script)

- No key → key prompt.
- Bad key / no faction-crimes access → inline error message.
- Gateway unavailable → embedded `OC_REQUIREMENTS` weights + own-faction local history;
  show a small "community data unavailable" note.
- No history → show raw CPR only (no blended success), flagged low-confidence.

## Fidelity

Torn's hashed CSS isn't shipped to the page, so structural CSS is reverse-engineered to
match closely; scenario art is hotlinked from torn.com. Result is visually very close, not
byte-identical. OCBF overlays match the script exactly.

## Verification

- Node unit-check the lifted scoring functions against fixed inputs to confirm numbers
  match the script.
- Live end-to-end requires a Torn API key in a browser (user confirms render).

## Constraints

- One file, no external JS libraries, no build step.
- Never hardcode an API key in the shared file.
- The ~120 KB TornPDA size cap does **not** apply (that was userscript-specific).
