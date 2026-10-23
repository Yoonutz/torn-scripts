# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Torn City faction war enforcement tool. Blocks faction members' attack links in-game once agreed war caps are hit (total score, per-member score, max hits, enemy-idle rule). Three parts:

1. **Supabase backend** — Postgres tables + RLS (`01_schema.sql`), a Deno Edge Function `war-poll` (`index.ts`) polled every minute by pg_cron (`02_schedule.sql`). Polls the Torn API, detects active ranked wars, writes a denormalized single-row read surface (`war_state`).
2. **Userscript** (`Torn-War-Enforcer.user.js`) — Tampermonkey/PDA script running on torn.com. Reads `war_state` / `member_progress` / `enemy_status` via the anon key (RLS read-only), visually disables + click-kills attack links, shows reasons in a tooltip, floating panel with admin rule editing (via `set-rules` Edge Function + `x-admin-token` header).
3. **Console** (`index.html`) — standalone dashboard page (hosted on Cloudflare Pages). Same anon-key reads, plus Supabase Realtime websocket for instant refresh, title-flash + desktop notifications on cap hits, admin rule editor.

## Repo vs deployed backend

Synced with the live Supabase project (`mmoaqgkhfxmbgvirsgxw`) on 2026-10-23: `index.ts` matches deployed `war-poll` v12, `set-rules.ts` matches deployed `set-rules` v4, and `01`→`04` SQL rebuild the production columns. Still unverified from the catalog: constraints, indexes, policies and the Realtime publication beyond what `01_schema.sql` and `04_prod_sync.sql` declare. The same project also hosts `oc-gateway` and the `torn_oc_cpr` schema for Torn OC Bestfit (cron `refresh-community-crime-stats`); those live in that app's folder.

## Deploy / operate

No build, lint, or tests — plain JS/SQL/TS, deployed manually:

- **Schema changes**: paste SQL into the Supabase SQL editor.
- **Edge Functions**: needs layout `supabase/functions/war-poll/index.ts` (from `index.ts`) and `supabase/functions/set-rules/index.ts` (from `set-rules.ts`), then `supabase functions deploy <name>` (CLI must be linked: `supabase link --project-ref <ref>`). Secrets: `TORN_API_KEY` (war-poll), `ADMIN_TOKEN` (set-rules) — `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` auto-injected.
- **Cron ops** (SQL editor): jobs `select * from cron.job;` · runs `select jobname, status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;` · HTTP results `select id, status_code, content from net._http_response order by id desc limit 10;`
- **Smoke test**: `curl -s -X POST "https://<ref>.supabase.co/functions/v1/war-poll" -H "Authorization: Bearer <anon_key>" -d '{}'` → expect `{"ok":true,"war":false}` idle.
- **Userscript**: bump `@version` in the header on every change (users update via Tampermonkey).
- Secrets for this project live in `D:\Dropbox\Apps\Torn\.env.local` (not user env vars).

## Architecture rules

- **Torn API budget**: idle tick = exactly 1 Torn call (`/faction/wars` v2, header auth `Authorization: ApiKey ...`). Faction totals come free from that same response — never add extra calls for data already in it. Uses a Custom/Limited key (selections: `faction → rankedwars, attacksfull, basic`), never a Full key.
- **RLS model**: anon key may SELECT only the read-surface tables (`war_state`, `member_progress`, `enemy_status`); `config`/`wars`/`attacks` are service-role-only. The Edge Function writes with service role (bypasses RLS). All writes from clients go through Edge Functions, never direct REST.
- **Rule semantics**: target value `0` = no limit/off (rendered as `∞`). Block logic client-side: `war_active && (faction_blocked || my_member.blocked)` plus the activity rule (online enemy = blocked; idle enemy = blocked until idle ≥ `idle_minutes_target`; offline = attackable).
- **Fail-open**: backend unreachable → userscript allows attacks and says so. Keep it that way.
- **Userscript singletons**: guards against double-injection (PDA injects twice) via `#tw-singleton` meta + `#tw-enforcer` panel check, and runs only in the top frame. Event handling is document-delegated (Torn re-renders swap nodes). Preserve these patterns when editing.
- **Attacks dedupe**: `attacks.code` is the primary key — ingest is idempotent by design (Phase 2 windowed `attacksfull` polling overlaps windows deliberately).
- The anon key + project URL are intentionally public (RLS-gated); the admin token and `TORN_API_KEY` are the actual secrets.
