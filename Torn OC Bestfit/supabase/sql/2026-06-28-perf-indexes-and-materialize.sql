-- Performance: indexes for oc_crimes / cpr_snapshots, and an optional materialized
-- upgrade for the per-faction oc_crime_stats view (mirrors the community-materialized
-- pattern). Paste into Supabase -> SQL Editor -> Run.
--
-- The index block is additive and safe to run as-is. The materialized-view block
-- REPLACES the live `oc_crime_stats` view the `pull` action reads; before running it,
-- confirm the column list below matches what the gateway selects
-- (difficulty,name,ok,fail,med_money,med_respect,samples,payout_pct,participants).

-- ── Indexes (safe, additive) ──────────────────────────────────────────────────
-- pull/per-faction scan + the new player_events range query (faction_id, executed_at):
create index if not exists oc_crimes_faction_ts
  on torn_oc_cpr.oc_crimes (faction_id, executed_at desc);

-- diagnose skill's jsonb containment scan slots @> [{"user_id":N}] :
create index if not exists oc_crimes_slots_gin
  on torn_oc_cpr.oc_crimes using gin (slots jsonb_path_ops);

-- personal CPR trend read (user_id, ts asc):
create index if not exists cpr_snapshots_user_ts
  on torn_oc_cpr.cpr_snapshots (user_id, ts asc);

-- ── Optional: materialize oc_crime_stats (per-faction) ────────────────────────
-- Eliminates the per-request GROUP BY + percentile_cont aggregation the `pull` action
-- currently runs live on every page load. Refresh hourly via pg_cron, like community.
-- VERIFY the live view's definition first, then uncomment to run.
--
-- drop view if exists torn_oc_cpr.oc_crime_stats;
-- create materialized view torn_oc_cpr.oc_crime_stats as
-- select
--   faction_id,
--   name,
--   difficulty,
--   count(*) filter (where status = 'Successful')                                     as ok,
--   count(*) filter (where status = 'Failure')                                        as fail,
--   count(*)                                                                            as samples,
--   percentile_cont(0.5) within group (order by money)        filter (where money > 0)        as med_money,
--   percentile_cont(0.5) within group (order by respect)      filter (where respect > 0)      as med_respect,
--   percentile_cont(0.5) within group (order by payout_pct)   filter (where payout_pct > 0)   as payout_pct,
--   percentile_cont(0.5) within group (order by participants) filter (where participants > 0) as participants
-- from torn_oc_cpr.oc_crimes
-- group by faction_id, name, difficulty;
--
-- create unique index if not exists oc_crime_stats_pk
--   on torn_oc_cpr.oc_crime_stats (faction_id, difficulty, name);
--
-- select cron.schedule(
--   'refresh-oc-crime-stats', '7 * * * *',
--   $$refresh materialized view concurrently torn_oc_cpr.oc_crime_stats$$
-- );
