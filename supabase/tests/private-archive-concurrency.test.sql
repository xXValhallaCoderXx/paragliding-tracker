-- Two real PostgreSQL connections exercise both lock orders. This suite runs only
-- in scripts/test-db.mjs's disposable Supabase instance (default local credentials).
create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table archive_race_backend(pid integer);
create function pg_temp.wait_for_archive_lock()
returns boolean language plpgsql as $$
begin
  for attempt in 1..100 loop
    if exists (select 1 from pg_stat_activity where pid = (select pid from archive_race_backend)
      and wait_event_type = 'Lock' and wait_event = 'advisory') then return true; end if;
    perform pg_sleep(0.02);
  end loop;
  return false;
end;
$$;
do $$
begin
  -- Use the database's network address: its loopback connection uses trust auth,
  -- which dblink correctly refuses for a non-superuser even with a password.
  perform dblink_connect('archive_race', 'hostaddr=' || host(inet_server_addr()) || ' dbname=' || current_database() || ' user=postgres password=postgres');
  perform dblink_exec('archive_race', $remote$
    insert into auth.users(id,email) values ('44444444-4444-4444-4444-444444444444','archive-race@example.com');
    insert into public.flights(id,user_id,recording_session_id,status,started_at,client_created_at,client_updated_at)
    values ('dddddddd-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','dddddddd-0000-0000-0000-000000000001','completed',1000,1000,1000);
    set role authenticated;
    set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
  $remote$);
end;
$$;
insert into archive_race_backend select pid from dblink('archive_race','select pg_backend_pid()') as backend(pid integer);

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
do $$ begin
  perform public.delete_private_flight('dddddddd-0000-0000-0000-000000000001');
end $$;
reset role;
do $$ begin
  perform dblink_send_query('archive_race', $remote$
    select to_jsonb(public.write_private_flight('{"id":"dddddddd-0000-0000-0000-000000000001","recording_session_id":"dddddddd-0000-0000-0000-000000000001","status":"completed","started_at":1000,"ended_at":2000,"client_created_at":1000,"client_updated_at":9000,"title":"Late write","site":null,"site_source":null,"notes":null}'))
  $remote$);
end $$;
select ok(pg_temp.wait_for_archive_lock(),'captured upload waits while deletion owns the flight identity');
commit;
select throws_ok($$select * from dblink_get_result('archive_race') as response(value jsonb)$$,
  'PFL01',null,'blocked captured upload observes committed deletion after acquiring its lock');
do $$ begin perform value from dblink_get_result('archive_race') as response(value jsonb); end $$;
select is((select count(*)::int from public.flights where id = 'dddddddd-0000-0000-0000-000000000001'),0,
  'delete-before-write race cannot resurrect a flight');

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
do $$ begin
  perform public.write_private_flight('{"id":"dddddddd-0000-0000-0000-000000000002","recording_session_id":"dddddddd-0000-0000-0000-000000000002","status":"completed","started_at":1000,"ended_at":2000,"client_created_at":1000,"client_updated_at":1000,"title":"First write","site":null,"site_source":null,"notes":null}');
end $$;
reset role;
do $$ begin
  perform dblink_send_query('archive_race', $remote$select to_jsonb(public.delete_private_flight('dddddddd-0000-0000-0000-000000000002'))$remote$);
end $$;
select ok(pg_temp.wait_for_archive_lock(),'deletion waits while a new captured upload owns the flight identity');
commit;
select is((select value->>'flight_id' from dblink_get_result('archive_race') as response(value jsonb)),
  'dddddddd-0000-0000-0000-000000000002','waiting deletion commits the original identity marker');
do $$ begin perform value from dblink_get_result('archive_race') as response(value jsonb); end $$;
select is((select count(*)::int from public.flights where id = 'dddddddd-0000-0000-0000-000000000002'),0,
  'write-before-delete race also leaves the flight deleted');

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
do $$ begin perform public.delete_private_flight('dddddddd-0000-0000-0000-000000000003'); end $$;
reset role;
do $$ begin
  perform dblink_send_query('archive_race', $remote$
    insert into storage.objects(bucket_id,name)
    values ('flight-igc','44444444-4444-4444-4444-444444444444/dddddddd-0000-0000-0000-000000000003.igc') returning to_jsonb(name)
  $remote$);
end $$;
select ok(pg_temp.wait_for_archive_lock(),'late Storage upload shares the deletion identity lock');
commit;
select throws_ok($$select * from dblink_get_result('archive_race') as response(value jsonb)$$,
  '42501',null,'late Storage upload sees deletion instead of its pre-lock snapshot');
do $$ begin perform value from dblink_get_result('archive_race') as response(value jsonb); end $$;
select is((select count(*)::int from storage.objects where name = '44444444-4444-4444-4444-444444444444/dddddddd-0000-0000-0000-000000000003.igc'),0,
  'late Storage upload cannot recreate an object after cleanup');

do $$ begin perform dblink_disconnect('archive_race'); end $$;
delete from auth.users where id = '44444444-4444-4444-4444-444444444444';
select * from finish();
