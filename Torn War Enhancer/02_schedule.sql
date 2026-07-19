-- ============================================================
-- Torn War Enforcement — Phase 1: schedule the poller
-- Run AFTER `supabase functions deploy war-poll`.
-- ============================================================

-- 1. Store project URL + invoke token in Vault (run once; edit the two values).
--    invoke_key = your project's anon (publishable) key — public-safe, RLS-gated.
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_ANON_KEY', 'invoke_key');

-- 2. Schedule war-poll every minute.
select cron.schedule(
  'war-poll-1m',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/war-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'invoke_key')
    ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);

-- ---- ops ----
-- list jobs:        select * from cron.job;
-- recent runs:      select jobname, status, return_message, start_time
--                     from cron.job_run_details order by start_time desc limit 10;
-- pg_net responses: select id, status_code, content
--                     from net._http_response order by id desc limit 10;
-- unschedule:       select cron.unschedule('war-poll-1m');
