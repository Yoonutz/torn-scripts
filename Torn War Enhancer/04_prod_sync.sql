-- 04_prod_sync.sql — catch the repo up with production (mmoaqgkhfxmbgvirsgxw).
-- Columns and defaults read from the live catalog on 2026-10-23; already applied there.
-- Not yet verified from the catalog: enemy_status key and its anon policy (inferred from
-- war-poll's upsert onConflict "war_id,member_id" and the userscript's anon read), and
-- which tables the console's Realtime channel publishes.

alter table config add column if not exists idle_minutes_target int not null default 10;

alter table war_state add column if not exists per_member_score_target int;
alter table war_state add column if not exists max_attacks_per_member  int;
alter table war_state add column if not exists idle_minutes_target     int;
alter table war_state add column if not exists enlisted                boolean default false;
alter table war_state add column if not exists start_ts                bigint;
alter table war_state add column if not exists opponent_name           text;

-- ---- enemy_status: enemy last-action per war (written by war-poll, anon-readable) ----
create table if not exists enemy_status (
  war_id         bigint not null,
  member_id      bigint not null,
  last_action_ts bigint,
  status         text,
  updated_at     timestamptz default now(),
  primary key (war_id, member_id)
);
alter table enemy_status enable row level security;

drop policy if exists anon_read_enemy on enemy_status;
create policy anon_read_enemy on enemy_status
  for select to anon using (true);

-- Production cron job `war-poll-1m` inlines the URL and anon key in its command instead of
-- reading Vault as 02_schedule.sql does; both work, the anon key is public.
