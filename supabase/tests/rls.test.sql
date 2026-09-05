-- Runs only against the disposable project created by pnpm test:db.
begin;
select no_plan();
-- Match the Storage API transaction flag; RLS still applies to every statement.
set local storage.allow_delete_query = 'true';
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com'), ('22222222-2222-2222-2222-222222222222', 'b@example.com');
select is((select count(*)::int from public.profiles), 2, 'signup creates one profile per pilot');
insert into public.flights (id,user_id,recording_session_id,status,started_at,client_created_at,client_updated_at,title)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','completed',1000,1000,1000,'A original'),
       ('bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000001','partial',1000,1000,1000,'B original');
insert into storage.objects (bucket_id,name,metadata) values
 ('flight-igc','11111111-1111-1111-1111-111111111111/a.igc','{"size":10}'), ('flight-igc','22222222-2222-2222-2222-222222222222/b.igc','{"size":20}');
select is((select public from storage.buckets where id = 'flight-igc'), false, 'IGC bucket is private');
select is((select file_size_limit from storage.buckets where id = 'flight-igc'), 26214400::bigint, 'IGC size limit is 25 MB');
select is((select allowed_mime_types from storage.buckets where id = 'flight-igc'), array['application/vnd.fai.igc','text/plain'], 'IGC bucket permits only its archive types');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.flights), 1, 'A reads only their flights');
select is((select count(*)::int from public.profiles), 1, 'A reads only their profile');
select is((select count(*)::int from storage.objects where bucket_id = 'flight-igc'), 1, 'A reads only their IGC objects');
with changed as (update public.flights set title = 'hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001' returning *)
select is(count(*)::int, 0, 'cross-owner flight update affects zero rows') from changed;
with changed as (delete from public.flights where id = 'bbbbbbbb-0000-0000-0000-000000000001' returning *)
select is(count(*)::int, 0, 'cross-owner flight delete affects zero rows') from changed;
with changed as (update public.profiles set pilot_name = 'hijacked' where id = '22222222-2222-2222-2222-222222222222' returning *)
select is(count(*)::int, 0, 'cross-owner profile update affects zero rows') from changed;
with changed as (delete from public.profiles where id = '22222222-2222-2222-2222-222222222222' returning *)
select is(count(*)::int, 0, 'cross-owner profile delete affects zero rows') from changed;
with changed as (update storage.objects set metadata = '{}' where name = '22222222-2222-2222-2222-222222222222/b.igc' returning *)
select is(count(*)::int, 0, 'cross-owner IGC update affects zero rows') from changed;
with changed as (delete from storage.objects where name = '22222222-2222-2222-2222-222222222222/b.igc' returning *)
select is(count(*)::int, 0, 'cross-owner IGC delete affects zero rows') from changed;
with changed as (delete from public.profiles where id = '11111111-1111-1111-1111-111111111111' returning *)
select is(count(*)::int, 0, 'direct owner profile deletion affects zero rows') from changed;
-- Verify under a role that can actually see B's rows, independently of the mutation result.
reset role;
select is((select title from public.flights where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'B original', 'B flight survives unchanged');
select is((select count(*)::int from public.profiles where id = '22222222-2222-2222-2222-222222222222' and pilot_name is null), 1, 'B profile survives unchanged');
select is((select metadata from storage.objects where name = '22222222-2222-2222-2222-222222222222/b.igc'), '{"size":20}'::jsonb, 'B IGC survives unchanged');
set local role authenticated;
select throws_ok($$insert into public.flights (id,user_id,recording_session_id,status,started_at,client_created_at,client_updated_at) values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','cccccccc-0000-0000-0000-000000000001','completed',1,1,1)$$, '42501', null, 'cannot create another owner flight');
select throws_ok($$update public.flights set user_id = '22222222-2222-2222-2222-222222222222' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '42501', null, 'cannot reassign flight owner');
select throws_ok($$update public.profiles set id = '22222222-2222-2222-2222-222222222222' where id = '11111111-1111-1111-1111-111111111111'$$, '42501', null, 'cannot reassign profile owner');
select throws_ok($$insert into storage.objects (bucket_id,name) values ('flight-igc','22222222-2222-2222-2222-222222222222/forged.igc')$$, '42501', null, 'cannot create another owner IGC');
select throws_ok($$update storage.objects set name = '22222222-2222-2222-2222-222222222222/moved.igc' where name = '11111111-1111-1111-1111-111111111111/a.igc'$$, '42501', null, 'cannot move IGC to another owner folder');
select throws_ok($$update storage.objects set bucket_id = 'other' where name = '11111111-1111-1111-1111-111111111111/a.igc'$$, '42501', null, 'cannot move IGC outside private bucket');
select lives_ok($$insert into public.flights (id,user_id,recording_session_id,status,started_at,client_created_at,client_updated_at)
  values ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','cccccccc-0000-0000-0000-000000000001','completed',1,1,1)$$, 'owner inserts flight');
with changed as (update public.flights set title = 'A changed', updated_at = '2000-01-01' where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning *)
select is(count(*)::int, 1, 'owner updates flight') from changed;
select is((select updated_at from public.flights where id = 'aaaaaaaa-0000-0000-0000-000000000001'), now(), 'server stamps flight updates');
select is((select title from public.flights where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'A changed', 'owner update persisted');
select lives_ok($$insert into public.profiles (id,pilot_name,registration_id,client_updated_at) values ('11111111-1111-1111-1111-111111111111','Pilot A','APPI-123',3000)
  on conflict (id) do update set pilot_name = excluded.pilot_name, registration_id = excluded.registration_id, client_updated_at = excluded.client_updated_at, updated_at = '2000-01-01'$$, 'owner upserts profile and registration');
select is((select registration_id from public.profiles), 'APPI-123', 'registration persisted');
select is((select updated_at from public.profiles), now(), 'server stamps profile updates');
select lives_ok($$insert into storage.objects (bucket_id,name,metadata) values ('flight-igc','11111111-1111-1111-1111-111111111111/new.igc','{"size":30}')$$, 'owner uploads IGC');
with changed as (update storage.objects set metadata = '{"size":40}' where name = '11111111-1111-1111-1111-111111111111/new.igc' returning *)
select is(count(*)::int, 1, 'owner replaces IGC') from changed;
select is((select metadata from storage.objects where name = '11111111-1111-1111-1111-111111111111/new.igc'), '{"size":40}'::jsonb, 'replacement persisted');
with changed as (delete from storage.objects where name = '11111111-1111-1111-1111-111111111111/new.igc' returning *)
select is(count(*)::int, 1, 'owner deletes IGC') from changed;
with changed as (delete from public.flights where id = 'cccccccc-0000-0000-0000-000000000001' returning *)
select is(count(*)::int, 1, 'owner deletes flight') from changed;
set local role anon;
set local request.jwt.claims = '{}';
select throws_ok('select * from public.flights', '42501', null, 'anonymous flight read is permission denied');
select throws_ok('select * from public.profiles', '42501', null, 'anonymous profile read is permission denied');
select is((select count(*)::int from storage.objects where bucket_id = 'flight-igc'), 0, 'anonymous cannot list private IGCs');
reset role;
select * from finish();
rollback;
