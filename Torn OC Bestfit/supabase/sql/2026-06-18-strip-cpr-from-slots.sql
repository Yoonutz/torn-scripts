-- Privacy cleanup: remove per-member CPR from EXISTING oc_crimes.slots (kept position + user_id only).
-- New pushes already omit CPR (client strips it); this fixes rows stored before that change.
-- Paste into Supabase → SQL Editor → Run. Safe/idempotent (re-running is a no-op once stripped).
update torn_oc_cpr.oc_crimes
set slots = (
  select coalesce(
    jsonb_agg(jsonb_build_object('position', s->>'position', 'user_id', s->'user_id')),
    '[]'::jsonb
  )
  from jsonb_array_elements(slots) s
)
where slots is not null
  and exists (select 1 from jsonb_array_elements(slots) s where s ? 'cpr');
