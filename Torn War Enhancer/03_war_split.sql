-- 03_war_split.sql — track ALL respect earned during a war, split war vs outside.
-- Caps still fire on WAR score/hits only (matches Torn's war page + faction agreements);
-- outside_score / outside_attacks are informational.
-- Applied to production 2026-07-19.

alter table attacks add column if not exists is_war boolean not null default true;
alter table member_progress add column if not exists outside_score numeric not null default 0;
alter table member_progress add column if not exists outside_attacks integer not null default 0;

create or replace function public.recompute_member_verdicts(p_war_id bigint, p_faction_blocked boolean)
returns void
language plpgsql
as $function$
declare
  c      config%rowtype;
  my_fid bigint;
begin
  select * into c from config where id = 1;
  select faction_id into my_fid from wars where war_id = p_war_id;

  -- WAR score/attacks gate the caps; outside_* is display-only.
  -- (target = 0 disables that rule)
  update member_progress mp set
    score           = coalesce(a.war_score, 0),
    attacks         = coalesce(a.war_cnt, 0),
    outside_score   = coalesce(a.out_score, 0),
    outside_attacks = coalesce(a.out_cnt, 0),
    reasons =
      (case when p_faction_blocked then '["faction_target"]'::jsonb else '[]'::jsonb end)
      || (case when c.per_member_score_target > 0 and coalesce(a.war_score,0) >= c.per_member_score_target then '["member_score"]'::jsonb else '[]'::jsonb end)
      || (case when c.max_attacks_per_member  > 0 and coalesce(a.war_cnt,0)   >= c.max_attacks_per_member  then '["attack_limit"]'::jsonb else '[]'::jsonb end),
    updated_at = now()
  from (select member_id from member_progress where war_id = p_war_id) m
  left join (
    select attacker_id,
           count(*)              filter (where is_war)     as war_cnt,
           coalesce(sum(respect_gain) filter (where is_war), 0)     as war_score,
           count(*)              filter (where not is_war) as out_cnt,
           coalesce(sum(respect_gain) filter (where not is_war), 0) as out_score
    from attacks
    where war_id = p_war_id and attacker_fac = my_fid
    group by attacker_id
  ) a on a.attacker_id = m.member_id
  where mp.war_id = p_war_id and mp.member_id = m.member_id;

  -- blocked = any reason present
  update member_progress
    set blocked = (jsonb_array_length(reasons) > 0)
    where war_id = p_war_id;
end $function$;
