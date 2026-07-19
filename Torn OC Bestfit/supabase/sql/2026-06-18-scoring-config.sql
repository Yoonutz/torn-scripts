-- Per-faction scoring config. RLS on; anon revoked; only service_role (the gateway) touches it.
-- Paste into Supabase → SQL Editor → Run. Runs as one transaction.
create table if not exists torn_oc_cpr.scoring_config (
  faction_id  bigint primary key,
  cfg         jsonb  not null default '{}'::jsonb,
  updated_by  bigint,
  updated_at  timestamptz not null default now()
);

alter table torn_oc_cpr.scoring_config enable row level security;
revoke all on torn_oc_cpr.scoring_config from anon, authenticated;
-- (service_role bypasses RLS; no policies needed — all access is via the oc-gateway function.)
