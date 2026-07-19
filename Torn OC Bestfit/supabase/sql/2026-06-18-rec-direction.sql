-- Add the preset/direction that drove each logged recommendation (for the alignment score event).
-- Paste into Supabase → SQL Editor → Run.
alter table torn_oc_cpr.recommendations add column if not exists direction text;
