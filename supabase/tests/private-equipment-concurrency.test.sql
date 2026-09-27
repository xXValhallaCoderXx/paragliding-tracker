-- Real concurrent sessions establish revision, archive/selection, and deletion ordering.
create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table equipment_race_backend(pid integer);
create function pg_temp.wait_for_equipment_lock() returns boolean language plpgsql as $$
begin
  for attempt in 1..100 loop
    if exists(select 1 from pg_stat_activity where pid=(select pid from equipment_race_backend)
      and wait_event_type='Lock' and wait_event='advisory') then return true; end if;
    perform pg_sleep(0.02);
  end loop;
  return false;
end;
$$;
do $$ begin
  perform dblink_connect('equipment_race','hostaddr='||host(inet_server_addr())||' dbname='||current_database()||' user=postgres password=postgres');
  perform dblink_exec('equipment_race',$remote$
    insert into auth.users(id,email) values('55555555-5555-5555-5555-555555555555','equipment-race@example.test');
    set role authenticated;
    set request.jwt.claims='{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
  $remote$);
end $$;
insert into equipment_race_backend select pid from dblink('equipment_race','select pg_backend_pid()') as result(pid integer);

begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
do $$ begin perform public.write_private_equipment('sport','paragliding','{"sport":"paragliding","pilotIdentifier":"First"}',0,'55555555-1111-1111-1111-000000000001'); end $$;
reset role;
do $$ begin perform dblink_send_query('equipment_race',$remote$
  select public.write_private_equipment('sport','paragliding','{"sport":"paragliding","pilotIdentifier":"Second"}',0,'55555555-1111-1111-1111-000000000002')
$remote$); end $$;
select ok(pg_temp.wait_for_equipment_lock(),'same entity writer waits for first CAS commit');
commit;
select is((select value->>'status' from dblink_get_result('equipment_race') as result(value jsonb)),'conflict','concurrent create sees canonical revision instead of overwriting');
do $$ begin perform value from dblink_get_result('equipment_race') as result(value jsonb); end $$;
select is((select payload->>'pilotIdentifier' from public.private_equipment where owner_id='55555555-5555-5555-5555-555555555555'),'First','first accepted edit is retained');

set role authenticated;
set request.jwt.claims='{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
do $$ begin
  perform public.write_private_equipment('aircraft','55555555-aaaa-aaaa-aaaa-000000000001','{"id":"55555555-aaaa-aaaa-aaaa-000000000001","sport":"speedflying","model":"Wing","size":null,"registrationId":null,"archived":false}',0,'55555555-1111-1111-1111-000000000003');
  perform public.write_private_equipment('selection','current','{"aircraftId":"55555555-aaaa-aaaa-aaaa-000000000001"}',0,'55555555-1111-1111-1111-000000000004');
end $$;
reset role;
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
do $$ begin perform public.write_private_equipment('aircraft','55555555-aaaa-aaaa-aaaa-000000000001','{"id":"55555555-aaaa-aaaa-aaaa-000000000001","sport":"speedflying","model":"Wing","size":null,"registrationId":null,"archived":true}',1,'55555555-1111-1111-1111-000000000005'); end $$;
reset role;
do $$ begin perform dblink_send_query('equipment_race',$remote$
  select public.write_private_equipment('selection','current','{"aircraftId":"55555555-aaaa-aaaa-aaaa-000000000001"}',1,'55555555-1111-1111-1111-000000000006')
$remote$); end $$;
select ok(pg_temp.wait_for_equipment_lock(),'selection waits while archive clears the global current record');
commit;
select is((select value->>'status' from dblink_get_result('equipment_race') as result(value jsonb)),'conflict','stale selection sees archive-cleared revision');
do $$ begin perform value from dblink_get_result('equipment_race') as result(value jsonb); end $$;
select is((select payload->'aircraftId' from public.private_equipment where owner_id='55555555-5555-5555-5555-555555555555' and kind='selection'),'null'::jsonb,'archive race leaves no invalid current aircraft');

begin;
do $$ begin perform public.social_begin_account_deletion('55555555-5555-5555-5555-555555555555'); end $$;
do $$ begin perform dblink_send_query('equipment_race',$remote$
  select public.write_private_equipment('sport','hang_gliding','{"sport":"hang_gliding","pilotIdentifier":null}',0,'55555555-1111-1111-1111-000000000007')
$remote$); end $$;
select ok(pg_temp.wait_for_equipment_lock(),'equipment writes wait behind account deletion fence');
commit;
select throws_ok($$select * from dblink_get_result('equipment_race') as result(value jsonb)$$,'P0001','shared_account_deleting','pending write cannot reopen deleting inventory');
do $$ begin perform value from dblink_get_result('equipment_race') as result(value jsonb); end $$;
do $$ begin perform dblink_disconnect('equipment_race'); end $$;
delete from auth.users where id='55555555-5555-5555-5555-555555555555';
select * from finish();
