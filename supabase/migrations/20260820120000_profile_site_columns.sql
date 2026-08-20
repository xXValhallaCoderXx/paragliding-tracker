-- Sites belong to flights, not to the pilot.
--
-- `home_site` was a single hand-typed field on the profile. It has been replaced by
-- per-flight site names chosen from a launch database, which is both more accurate and
-- the thing a logbook actually needs — a pilot flies more than one site.
--
-- A separate migration rather than an edit to 20260818120000_cloud_init.sql: that one has
-- already been applied to the linked project, and `supabase db push` tracks applied
-- migrations by version. Editing it in place would leave the live column in the database,
-- the repo claiming otherwise, and `db diff` reporting drift forever.
alter table public.profiles drop column if exists home_site;

-- The pilot's licence or federation number, which the client has held locally since v6
-- and has never been able to push. Without this column a pilot loses it on device change,
-- silently — the same class of gap `home_site` did not have.
alter table public.profiles add column if not exists registration_id text;

alter table public.profiles
  drop constraint if exists profiles_registration_id_len;
alter table public.profiles
  add constraint profiles_registration_id_len
  check (registration_id is null or char_length(registration_id) <= 30);
