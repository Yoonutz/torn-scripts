-- ============================================================
-- Torn War Enforcement — Phase 0: schema + RLS
-- Run once in Supabase SQL editor.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---- config: constant rules (single row, edit in dashboard) ----
create table if not exists config (
  id                      int primary key default 1,
  faction_id              bigint not null default 0,   -- << SET THIS
  total_score_target      int not null default 16000,
  per_member_score_target int not null default 400,
  max_attacks_per_member  int not null default 10,
  constraint config_single check (id = 1)
);
insert into config (id) values (1) on conflict (id) do nothing;

-- ---- wars: working/historical store (service_role only) ----
create table if not exists wars (
  war_id        bigint primary key,
  faction_id    bigint not null,
  opponent_id   bigint,
  opponent_name text,
  start_ts      bigint not null,
  end_ts        bigint,
  our_score     numeric default 0,
  opp_score     numeric default 0,
  our_attacks   int default 0,
  win_target    int,
  active        boolean default true,
  last_poll_ts  bigint default 0,
  updated_at    timestamptz default now()
);

-- ---- attacks: idempotent ingest, dedupe by code (Phase 2) ----
create table if not exists attacks (
  code         text primary key,
  war_id       bigint,
  attacker_id  bigint,
  attacker_fac bigint,
  respect_gain numeric,
  ts           bigint
);
create index if not exists idx_atk_war_member on attacks(war_id, attacker_id);

-- ---- member_progress: per-member verdict (Phase 2) ----
create table if not exists member_progress (
  war_id     bigint,
  member_id  bigint,
  name       text,
  score      numeric default 0,
  attacks    int default 0,
  blocked    boolean default false,
  reasons    jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  primary key (war_id, member_id)
);

-- ---- war_state: denormalized single-row read surface for the userscript ----
create table if not exists war_state (
  id                 int primary key default 1,
  active             boolean default false,
  war_id             bigint,
  our_score          numeric default 0,
  opp_score          numeric default 0,
  our_attacks        int default 0,
  win_target         int,
  total_score_target int,
  faction_blocked    boolean default false,
  updated_at         timestamptz default now(),
  constraint war_state_single check (id = 1)
);
insert into war_state (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- RLS
--   anon  : SELECT war_state + member_progress only (read surface)
--   Edge Fn (service_role) : bypasses RLS, writes everything
--   config / wars / attacks : NOT exposed to anon
-- ============================================================
alter table config          enable row level security;
alter table wars            enable row level security;
alter table attacks         enable row level security;
alter table member_progress enable row level security;
alter table war_state       enable row level security;

drop policy if exists anon_read_state on war_state;
create policy anon_read_state on war_state
  for select to anon using (true);

drop policy if exists anon_read_progress on member_progress;
create policy anon_read_progress on member_progress
  for select to anon using (true);

-- service_role bypasses RLS automatically — no write policies needed.
-- No anon policies on config/wars/attacks → invisible to the public anon key.
