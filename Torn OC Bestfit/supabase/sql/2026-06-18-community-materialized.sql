-- Upgrade community_crime_stats from a LIVE view to a MATERIALIZED view, refreshed hourly.
-- Why: the live view re-aggregated every faction's oc_crimes on every client call. As a
-- materialized view it is precomputed; reads are a cheap index scan and the heavy GROUP BY
-- runs once an hour in the background. Data is at most ~1h stale - fine for a slow-moving
-- knowledge base. The gateway query is UNCHANGED (same name, same columns) - no redeploy.
--
-- Run the WHOLE file in Supabase -> SQL Editor (runs as the postgres role, which owns the
-- tables and can read every faction's rows). If `cron.schedule` errors, enable the pg_cron
-- extension first: Dashboard -> Database -> Extensions -> enable "pg_cron", then re-run step 5.

-- 1) Replace the live view with a materialized view (same query).
drop view if exists torn_oc_cpr.community_crime_stats;
drop materialized view if exists torn_oc_cpr.community_crime_stats;
create materialized view torn_oc_cpr.community_crime_stats as
select
  name,
  difficulty,
  count(*) filter (where status = 'Successful')                                   as ok,
  count(*) filter (where status = 'Failure')                                      as fail,
  count(*)                                                                          as samples,
  count(distinct faction_id)                                                        as factions,
  percentile_cont(0.5) within group (order by money)   filter (where money > 0)     as med_money,
  percentile_cont(0.5) within group (order by respect) filter (where respect > 0)   as med_respect
from torn_oc_cpr.oc_crimes
group by name, difficulty
with data;

-- 2) Unique index on the group key -> enables REFRESH ... CONCURRENTLY (no read lock).
create unique index if not exists community_crime_stats_pk
  on torn_oc_cpr.community_crime_stats (name, difficulty);

-- 3) Lock down: only the gateway (service_role) reads it; anon/authenticated denied.
revoke all on torn_oc_cpr.community_crime_stats from anon, authenticated;
grant select on torn_oc_cpr.community_crime_stats to service_role;

-- 4) Tell PostgREST about the swapped relation.
notify pgrst, 'reload schema';

-- 5) Hourly concurrent refresh via pg_cron (idempotent: drops an existing job of this name first).
select cron.unschedule('refresh-community-crime-stats')
where exists (select 1 from cron.job where jobname = 'refresh-community-crime-stats');

select cron.schedule(
  'refresh-community-crime-stats',
  '0 * * * *',
  $$refresh materialized view concurrently torn_oc_cpr.community_crime_stats$$
);
