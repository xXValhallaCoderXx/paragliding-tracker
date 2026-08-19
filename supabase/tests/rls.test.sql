-- Row level security regression tests.
--
-- Run with: pnpm dlx supabase@latest test db
--
-- The anon key ships inside the app bundle, so these policies are the only thing
-- separating one pilot's logbook from another's. That makes them worth testing directly
-- rather than trusting the policy text to say what it means.

begin;
select plan(11);

-- Two pilots -----------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com', '', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com', '', now(), now(), now());

-- handle_new_user ------------------------------------------------------------
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'handle_new_user creates exactly one profile per account'
);
select is(
  (select count(*)::int from public.profiles),
  2,
  'and does not create profiles for anyone else'
);

insert into public.flights (id, user_id, recording_session_id, status, started_at, client_created_at, client_updated_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'completed', 1000, 1000, 1000),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'completed', 1000, 1000, 1000);

-- Pilot A --------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.flights), 1, 'A sees only their own flights');
select is(
  (select count(*)::int from public.flights where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read B flights even by asking for them directly'
);
select is((select count(*)::int from public.profiles), 1, 'A sees only their own profile');

-- A write aimed at B is silently filtered by the USING clause, so the assertion is on
-- the row count rather than on an error.
update public.flights set title = 'hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.flights where title = 'hijacked'),
  0,
  'A cannot update a B flight'
);

delete from public.flights where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.flights where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'the delete affected nothing A can see'
);

update public.profiles set pilot_name = 'hijacked' where id = '22222222-2222-2222-2222-222222222222';
select is(
  (select count(*)::int from public.profiles where pilot_name = 'hijacked'),
  0,
  'A cannot update a B profile'
);

-- Inserting a flight owned by someone else must be rejected outright.
select throws_ok(
  $$insert into public.flights (id, user_id, recording_session_id, status, started_at, client_created_at, client_updated_at)
    values ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'cccccccc-0000-0000-0000-0000000000c1', 'completed', 1, 1, 1)$$,
  '42501',
  null,
  'A cannot insert a flight owned by B'
);

-- anon -----------------------------------------------------------------------
set local role anon;
set local request.jwt.claims to null;
select is((select count(*)::int from public.flights), 0, 'anon sees no flights at all');
select is((select count(*)::int from public.profiles), 0, 'anon sees no profiles at all');

select * from finish();
rollback;
