# Torn War Enforcement — Phase 0–1 Setup

All Supabase. No Cloudflare. Order matters.

## Files
- `01_schema.sql` — tables + RLS (run once)
- `war-poll/index.ts` — Edge Function (war detection + heartbeat + faction totals)
- `02_schedule.sql` — pg_cron job that invokes the function every minute

## Prereqs
- Supabase project (you have one)
- Supabase CLI installed + logged in: `supabase login`
- A Torn **Custom/Limited** API key with selections: `faction → rankedwars, attacksfull` (+ `basic`). Never a Full key.

## Steps

**1. Schema**
SQL Editor → paste `01_schema.sql` → run. Enables `pg_cron` + `pg_net`, creates tables, RLS.

**2. Set your faction ID**
```sql
update config set faction_id = <YOUR_FACTION_ID> where id = 1;
```
(Rules already seeded: 16000 / 400 / 10 — edit in the `config` row anytime.)

**3. Link CLI + set the Torn key as a secret**
```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set TORN_API_KEY=your_torn_key_here
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — don't set them.

**4. Deploy the function**
```bash
# from the folder that contains supabase/functions/war-poll/index.ts
supabase functions deploy war-poll
```
(Folder layout the CLI expects: `supabase/functions/war-poll/index.ts`. Move `war-poll/` under `supabase/functions/` first.)

**5. Smoke test (manual invoke)**
```bash
curl -s -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/war-poll" \
  -H "Authorization: Bearer YOUR_ANON_KEY" -H "Content-Type: application/json" -d '{}'
```
Expect `{"ok":true,"war":false}` outside a war, or `{"ok":true,"war":true,...}` during one.
Then check the row: `select * from war_state;`

**6. Schedule it**
Edit `project_url` + `invoke_key` (anon key) in `02_schedule.sql`, run it.
Verify: `select jobname, status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`

## What Phase 1 does
- Idle (no war): 1 Torn call/min, `war_state.active=false`.
- War: writes faction score/attacks + `faction_blocked = our_score >= total_score_target`.
- War ends: `active=false` automatically → userscript re-enables attacks by default.

## Read surface (for the userscript, Phase 3)
Single row, anon key, RLS-gated read-only:
```
GET https://YOUR_PROJECT_REF.supabase.co/rest/v1/war_state?id=eq.1&select=*
  apikey: YOUR_ANON_KEY
  Authorization: Bearer YOUR_ANON_KEY
```
Block logic: `war_active && (faction_blocked || my_member.blocked)`.
(`my_member` comes from `member_progress` once Phase 2 lands.)

## Hardening (optional, later)
Anyone with the anon key can invoke `war-poll` (just triggers a cheap, cache-bounded poll). To lock it: deploy with `--no-verify-jwt` and check a custom `X-Cron-Secret` header inside the function instead.

## Next
Phase 2 — roster fetch + incremental `attacksfull` tally + per-member verdicts. Hook point is marked in `index.ts`.
