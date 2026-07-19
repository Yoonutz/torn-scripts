# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Sol** — an AI companion chat web app for [Torn.com](https://www.torn.com) players. It runs as a **Google Apps Script web app**: a single server file (`Code.js`) plus a single-page frontend (`Index.html`) served via `doGet`. The backend calls the **Groq** LLM API for chat and the **Torn API v2** for game data. There is no build step, no package manager, and no test runner — it is plain ES5-style JS executed on the Apps Script V8 runtime.

## Deploy & develop

Deployment is via [`clasp`](https://github.com/google/clasp) (script id is in `.clasp.json`). Apps Script files map as: `.js`/`.gs` → script files, `.html` → HTML files, `.json` → manifest.

```bash
clasp push          # upload Code.js + Index.html to the bound Apps Script project
clasp deploy        # cut a new web-app deployment (required after adding/changing doGet/doPost)
clasp open          # open the project in the Apps Script editor
```

A new web-app deployment is required whenever you add or change an HTTP entry point (`doGet`/`doPost`); pushing alone updates the `/dev` URL but not the published `/exec` URL.

**The app only works through the Apps Script web-app URL** (`…/exec` or `…/dev`) — opening `Index.html` as a file fails because the `google.script.run` server bridge isn't loaded (the frontend detects this and tells the user).

### Required Script Properties

Set these in the Apps Script editor under **Project Settings → Script properties** (never commit secrets):

- `GROQ_API_KEY` — required; spent by every chat turn.
- `DEBUG_TOKEN` — optional shared secret that gates the `doPost` debug endpoint.
- `TEST_TORN_KEY` — optional Torn key used only by the in-editor test functions.

### Tests & diagnostics (run from the editor Run dropdown)

These are named without a trailing underscore so they appear in the Apps Script editor's Run menu; output goes to `Logger.log` (View → Logs):

- `runRouterEval` — golden-set check that the intent router maps questions to the right endpoints. **Run this after any change to the router prompt or `MODEL`/`ROUTER_MODEL`.**
- `runPaginationTest` — verifies the `_metadata.links` follow-and-merge logic against the live API (needs `TEST_TORN_KEY`).
- `debugQuery` — runs the full route→fetch pipeline for the hard-coded `DEBUG_QUERY` and logs what the router picked and what Torn returned (needs `TEST_TORN_KEY`).
- `refreshApiIndex` — rebuilds the endpoint index from Torn's OpenAPI spec (see below).

The `doPost` endpoint (gated by `DEBUG_TOKEN`) runs the **real** reply pipeline via `_getReplyTraced_` and returns the reply plus a full debug trace (router classification, endpoints called, fetched data, per-stage timings) — use it to debug from outside the browser. Note: Apps Script web apps always return HTTP 200; auth/validation failures come back as an `{error}` field in the JSON body.

## Architecture

### Two-phase reply pipeline (`_getReplyTraced_`)

Every chat turn flows through one function, `_getReplyTraced_` (`getReply` is a thin wrapper that keeps only `.reply`). The pipeline:

1. **Route (Phase 1) — `classifyIntent_`.** A Groq call (JSON mode, `temperature 0`) classifies the latest message as Torn-related or not and, if so, picks Torn API endpoints with concrete param values. To keep the prompt small, the full API catalog is **not** dumped in; instead `retrieveEndpoints_` does lexical retrieval (token overlap + a hand-tuned `_SYNONYMS` map) to shortlist ~25 candidate endpoints. Hallucinated paths (not in the shortlist) are dropped after the call.
2. **Fetch (Phase 2) — `fetchTornEndpoints_`.** Resolves each endpoint spec to a URL, fires all first-page requests in **one parallel `UrlFetchApp.fetchAll` batch** (with in-batch retry on 429/5xx), then per-endpoint follows pagination, applies time-window filtering, annotates, and truncates.
3. **Reply — `_groqChat`.** The fetched Torn data is injected as a `[TORN DATA]` block into the message history before the user's last message, and the chat model (warm persona, `temperature 0.4`) writes the final reply. The reply model gets the persona + profile context + the data block only — **not** the API catalog.

### Things the LLM is deliberately not trusted to do

The 17B chat model is unreliable at arithmetic, epoch math, and table syntax, so the server pre-computes these and instructs the model to reproduce them verbatim:

- **Relative time** (`_applyRelativeTime_` / `_parseRelativeTime_`): "last 3 hours" etc. is parsed server-side into integer Unix `from`/`to`, overriding whatever the model emitted.
- **Timestamps** (`_annotateTimestamps_`): every plausible Unix-epoch field gets a sibling `<key>_utc` ISO string so the model never converts epochs itself.
- **Sums** (`_annotateComputed_`): endpoint-aware totals (e.g. `/user/money` total cash) go in a `_computed` block the model must state explicitly.
- **Tables** (`_buildDisplayTables_` / `_recordsTable_`): Markdown tables are built in code and the model reproduces them exactly.
- **Armory routing** (`_applyArmoryRouting_`): Torn has **no** armory-inventory endpoint — armory data lives in faction-news categories (`cat=armoryDeposit` / `armoryAction`). The router is flaky here, so this deterministically forces the right route/category regardless of router output. This is the canonical example of the pattern: when the router is unreliable for a known phrasing, override it in code rather than fighting the prompt.

### The API index

`Code.js` doesn't hard-code Torn endpoints. `refreshApiIndex` fetches Torn's OpenAPI spec (`SWAGGER_URL`), compiles a compact per-endpoint index (path, method, tag, summary, pagination flag, path/query params with enums), and stores it. Storage tiers (`getApiIndex`, cheapest first):

1. In-memory memo (one execution).
2. `CacheService` — **chunked** because a value can exceed the 100KB cache limit.
3. A **Google Sheet** (`INDEX_SHEET_ID`) — the index is >9KB, which the Script Properties UI rejects, so it lives one-endpoint-per-row in a Sheet.

If the stored index predates the current `INDEX_SCHEMA` constant, `getApiIndex` auto-rebuilds it. **Bump `INDEX_SCHEMA` whenever you change the index row shape** so deployed instances rebuild instead of reading stale rows.

### Pagination

Torn list endpoints sort newest-first, so the forward `next` link is often null and continuation is `prev`. `_followPages_`/`_tornGetPaged` pick whichever direction the first page provides and follow it up to `PAGE_MAX` pages, then `_mergePages` concatenates arrays and shallow-merges object maps.

### Frontend (`Index.html`)

Single self-contained file. The Torn API key lives **only in the browser** (`localStorage`) and is sent with each `getReply` request — it is never stored server-side. Replies that contain block-level markdown (tables/lists/code) are rendered via `DOMPurify.sanitize(marked.parse(...))`; plain replies use a client-side word-by-word typewriter (Apps Script can't stream tokens). Both paths must keep using `textContent`/sanitization — Torn data and LLM output are untrusted and can contain raw HTML.

## Conventions

- Code is **ES5-flavored** (`var`, function declarations, no arrow functions / template literals in `Code.js`) to stay clearly within the Apps Script idiom already used throughout — match it.
- Internal/helper functions use a **trailing-underscore** convention (`_helper_`); functions meant to be runnable from the editor (tests, `refreshApiIndex`) have **no** trailing underscore.
- Errors are surfaced as data, not thrown to the client: Torn API failures become `{_error}` entries in the per-endpoint result; the whole turn degrades to plain chat rather than erroring when routing/classification fails.
