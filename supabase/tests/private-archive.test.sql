begin;
select no_plan();
set local storage.allow_delete_query = 'true';
insert into auth.users(id,email) values
  ('11111111-1111-1111-1111-111111111111','archive-a@example.com'),
  ('22222222-2222-2222-2222-222222222222','archive-b@example.com');

create function pg_temp.archive_payload(flight uuid, title text, edited bigint)
returns jsonb language sql as $$
  select jsonb_build_object('id',flight,'recording_session_id',flight,'status','completed',
    'started_at',1000,'ended_at',2000,'client_created_at',1000,'client_updated_at',edited,
    'title',title,'site','Bukit Jugra','site_source','osm','notes',null,'duration_ms',1000);
$$;
create function pg_temp.archive_metadata(flight uuid, title text, edited bigint)
returns jsonb language sql as $$
  select jsonb_build_object('id',flight,'client_updated_at',edited,'title',title,
    'site','Bukit Jugra','site_source','osm','notes',null);
$$;

select has_column('public','flights','site_source','flight metadata carries optional site provenance');
select ok((select relrowsecurity from pg_class where oid = 'public.private_flight_deletions'::regclass), 'deletion ledger has RLS');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000001','Recorded',1000))).title,
  'Recorded','captured backup RPC creates a canonical flight');
select is((select site_source from public.flights), 'osm','RPC retains explicit provenance');
select is((public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000001','Restored edit',3000),true)).title,
  'Restored edit','newer archive edit changes metadata');
select is((select duration_ms from public.flights), 1000::bigint,'archive edit preserves captured metrics');
select is((public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000001','Stale capture',2000))).title,
  'Restored edit','stale captured upload cannot overwrite a newer archive edit');
select is((public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000001','Tied edit',3000),true)).title,
  'Restored edit','server canonical metadata wins equal timestamps');
select is((public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000001',null,4000),true)).title,
  null,'explicit null clears metadata');
select throws_ok($$select public.write_private_flight('{"id":"aaaaaaaa-0000-0000-0000-000000000001","title":"Incomplete"}',true)$$,
  '22023',null,'partial bundle cannot accidentally clear fields');
select throws_ok($$select public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000001','Facts',5000) || '{"duration_ms":999}',true)$$,
  '22023',null,'archive metadata path rejects fact writes');
select throws_ok($$select public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000099','Missing',5000),true)$$,
  'PFL02',null,'metadata-only edit never creates a missing flight');
select throws_ok($$select public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000002','Bad owner',1000) || '{"user_id":"22222222-2222-2222-2222-222222222222"}')$$,
  '42501',null,'RPC refuses another owner');
select throws_ok($$select public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000002','Open',1000) || '{"status":"recording"}')$$,
  '22023',null,'RPC accepts only saved flights');
select throws_ok($$select public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000002','Bad path',1000) || '{"igc_object_path":"22222222-2222-2222-2222-222222222222/x.igc"}')$$,
  '22023',null,'captured backup refuses an unrelated artifact path');
select throws_ok($$select public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000001','Bad source',5000) || '{"site_source":"invented"}',true)$$,
  '23514',null,'site provenance is constrained');

update public.flights set igc_object_path = '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.igc',
  igc_sha256 = repeat('a',64), igc_byte_count = 5, igc_artifact_version = 1;
select is((public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000001','Fresh capture',5000))).igc_byte_count,
  5::bigint,'captured payload omitting IGC fields preserves existing artifact');
update public.flights set title = 'Legacy stale', client_updated_at = 1000;
select is((select title from public.flights), 'Fresh capture','legacy direct writes obey newer metadata protection');
update public.flights set title = 'Legacy tie', client_updated_at = 5000;
select is((select title from public.flights), 'Fresh capture','legacy equal timestamps preserve canonical metadata');
update public.flights set site = 'Manually named elsewhere', client_updated_at = 6000;
select is((select site_source from public.flights), null,'legacy site change clears stale catalogue credit');
select is((public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000001','Source restored',7000),true)).site_source,
  'osm','modern metadata RPC can explicitly set the same provider on a changed site');

insert into storage.objects(bucket_id,name) values ('flight-igc','11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.igc');
select is((public.delete_private_flight('aaaaaaaa-0000-0000-0000-000000000001')).storage_cleanup_pending,
  true,'delete records pending Storage cleanup');
select is((select count(*)::int from public.flights),0,'delete removes cloud flight immediately');
select is((select recording_session_id from public.private_flight_deletions),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,'deletion retains original session identity');
select is((select count(*)::int from storage.objects where bucket_id = 'flight-igc'),0,'deleted archive cannot be listed or downloaded');
select is((public.acknowledge_private_flight_cleanup('aaaaaaaa-0000-0000-0000-000000000001')).storage_cleanup_pending,
  true,'false-success cleanup cannot acknowledge an existing object');
select is((public.acknowledge_private_flight_cleanup('aaaaaaaa-0000-0000-0000-000000000001','Network unavailable')).storage_cleanup_last_error,
  'Network unavailable','cleanup failure remains actionable');
select is((public.delete_private_flight('aaaaaaaa-0000-0000-0000-000000000001')).storage_cleanup_attempts,
  2,'repeated deletion keeps its durable receipt and cleanup retry state');
select throws_ok($$select public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000001','Resurrection',9000))$$,
  'PFL01',null,'captured RPC cannot resurrect a deleted flight');
select throws_ok($$select public.write_private_flight(pg_temp.archive_metadata('aaaaaaaa-0000-0000-0000-000000000001','Resurrection',9000),true)$$,
  'PFL01',null,'archive edit cannot resurrect a deleted flight');
select throws_ok($$insert into public.flights(id,user_id,recording_session_id,status,started_at,client_created_at,client_updated_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','completed',1,1,9000)$$,
  'PFL01',null,'legacy direct insertion cannot resurrect a deleted flight');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('flight-igc','11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001.igc')$$,
  '42501',null,'deleted IGC cannot be uploaded again');
select throws_ok($$delete from public.private_flight_deletions$$,'42501',null,'clients cannot erase deletion history');

set local storage.operation = 'storage.object.delete_many';
select is((select count(*)::int from storage.objects where bucket_id = 'flight-igc'),1,'Storage delete operation can read the cleanup target');
with removed as (delete from storage.objects where bucket_id = 'flight-igc' returning *)
select is(count(*)::int,1,'owner can remove tombstoned storage object') from removed;
set local storage.operation = 'storage.object.get_authenticated';
select is((public.acknowledge_private_flight_cleanup('aaaaaaaa-0000-0000-0000-000000000001')).storage_cleanup_pending,
  false,'verified file removal completes cleanup');
select is((select count(*)::int from public.private_flight_deletions),1,'cleanup never removes the anti-resurrection marker');

select lives_ok($$select public.write_private_flight(pg_temp.archive_payload('aaaaaaaa-0000-0000-0000-000000000002','Legacy delete',1000))$$,'second saved flight created');
delete from public.flights where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select is((select count(*)::int from public.private_flight_deletions),2,'legacy individual delete creates a durable marker');
select is((public.delete_private_flight('aaaaaaaa-0000-0000-0000-000000000003')).recording_session_id,
  null,'deleting an already absent identity remains idempotent');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.private_flight_deletions),0,'another account cannot see deletion receipts');
select throws_ok($$select public.acknowledge_private_flight_cleanup('aaaaaaaa-0000-0000-0000-000000000001')$$,
  'PFL02',null,'another account cannot acknowledge a deletion receipt');
select lives_ok($$select public.write_private_flight(pg_temp.archive_payload('bbbbbbbb-0000-0000-0000-000000000001','B flight',1000))$$,'B can create a private flight');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$select public.delete_private_flight('bbbbbbbb-0000-0000-0000-000000000001')$$,
  '42501',null,'RPC cannot delete another owner flight');
select throws_ok($$select public.write_private_flight(pg_temp.archive_metadata('bbbbbbbb-0000-0000-0000-000000000001','Hijack',9000),true)$$,
  '42501',null,'RPC cannot edit another owner flight');

reset role;
select is((select title from public.flights where user_id = '22222222-2222-2222-2222-222222222222'), 'B flight','other account data remains intact');
-- Retain authenticated claims deliberately: absence of the auth parent, not only
-- service-role claims, must distinguish an account cascade from an individual delete.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$delete from auth.users where id = '22222222-2222-2222-2222-222222222222'$$,
  'account cascade creates no individual deletion marker or failed marker FK');
select is((select count(*)::int from public.private_flight_deletions where user_id = '22222222-2222-2222-2222-222222222222'),0,
  'account deletion leaves no instruction to erase other phones');
select lives_ok($$delete from auth.users where id = '11111111-1111-1111-1111-111111111111'$$,'account deletion can remove its durable ledger');
select is((select count(*)::int from public.private_flight_deletions),0,'deletion ledger has account-bounded lifetime');
set local role anon;
set local request.jwt.claims = '{}';
select throws_ok($$select public.write_private_flight('{}')$$,'42501',null,'anonymous cannot call flight write RPC');
select throws_ok($$select public.delete_private_flight('aaaaaaaa-0000-0000-0000-000000000001')$$,'42501',null,'anonymous cannot call delete RPC');
select throws_ok('select * from public.private_flight_deletions','42501',null,'anonymous cannot read deletion receipts');
reset role;
select * from finish();
rollback;
