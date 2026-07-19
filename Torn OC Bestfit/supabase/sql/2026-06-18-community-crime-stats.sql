-- Community knowledge base: global aggregate over ALL factions' completed crimes.
-- Exposes only crime-level facts (success baseline + reward medians) + a distinct-faction
-- count for k-anonymity. NO faction_id / user_id in the output. Read by the gateway
-- (service_role, bypasses RLS so it sees every faction's rows) via the `community` action,
-- which filters to factions >= K_ANON before returning anything.
-- Paste into Supabase -> SQL Editor -> Run. (drop+create so columns can change.)
drop view if exists torn_oc_cpr.community_crime_stats;
create view torn_oc_cpr.community_crime_stats
with (security_invoker = on) as
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
group by name, difficulty;

revoke all on torn_oc_cpr.community_crime_stats from anon, authenticated;
