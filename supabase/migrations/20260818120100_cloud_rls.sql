-- Row level security.
--
-- The anon key ships inside the app bundle and is public by design, so these policies
-- are the only thing standing between one pilot's logbook and another's.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is the documented
-- initplan-cached form: Postgres evaluates it once per statement instead of once per
-- row, which matters on the pull query over a long logbook.

alter table public.profiles enable row level security;
alter table public.flights  enable row level security;

-- profiles -------------------------------------------------------------------

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Deliberately no delete policy: a profile dies with its auth.users row through
-- ON DELETE CASCADE, and account deletion goes through the edge function.

-- flights --------------------------------------------------------------------

create policy flights_select_own on public.flights
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy flights_insert_own on public.flights
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy flights_update_own on public.flights
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy flights_delete_own on public.flights
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- anon is never granted anything on these tables, so an unauthenticated client cannot
-- even attempt a read. Revoked explicitly rather than relying on defaults.
revoke all on public.profiles from anon;
revoke all on public.flights  from anon;
