create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table kudos_race_backend(pid integer);
create function pg_temp.wait_for_kudos_lock() returns boolean language plpgsql as $$begin
 for attempt in 1..100 loop
   if exists(select 1 from pg_stat_activity where pid=(select pid from kudos_race_backend)
      and wait_event_type='Lock' and wait_event='advisory') then return true; end if;
   perform pg_sleep(0.02);
 end loop;
 return false;
end$$;
insert into auth.users(id,email) values
 ('75000000-0000-0000-0000-000000000001','kudos-race-a@example.test'),
 ('75000000-0000-0000-0000-000000000002','kudos-race-b@example.test');
insert into public.social_profiles(user_id,display_name) values
 ('75000000-0000-0000-0000-000000000001','Author'),('75000000-0000-0000-0000-000000000002','Reactor');
insert into public.flights(id,user_id,recording_session_id,status,started_at,ended_at,client_created_at,client_updated_at,
 metrics_algorithm_version,duration_ms,track_distance_metres,fix_count,quality,metrics_computed_at)
 values('76000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001',
 'completed',1000,2000,1000,1000,3,1000,0,0,'no_track',2000);
insert into private.social_publications(id,owner_id,flight_id,state) values
 ('78000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001','shared');
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','75000000-0000-0000-0000-000000000001','accepted');
do $$begin
 perform dblink_connect('kudos_race','hostaddr='||host(inet_server_addr())||' dbname='||current_database()||' user=postgres password=postgres');
 perform dblink_exec('kudos_race',$remote$set role authenticated; set request.jwt.claims='{"sub":"75000000-0000-0000-0000-000000000002","role":"authenticated"}'$remote$);
end$$;
insert into kudos_race_backend select pid from dblink('kudos_race','select pg_backend_pid()') as backend(pid integer);
set request.jwt.claims='{"sub":"75000000-0000-0000-0000-000000000002","role":"authenticated"}';
begin;
select is(public.social_set_kudos('78000000-0000-0000-0000-000000000001',true)->>'count','1','first give holds pair and flight locks');
do $$begin perform dblink_send_query('kudos_race',$remote$select public.social_set_kudos('78000000-0000-0000-0000-000000000001',true)$remote$); end$$;
select ok(pg_temp.wait_for_kudos_lock(),'duplicate give waits for first commit');
commit;
select is((select value->>'count' from dblink_get_result('kudos_race') as result(value jsonb)),'1','concurrent duplicate give is idempotent');
do $$begin perform value from dblink_get_result('kudos_race') as result(value jsonb); end$$;
select is((select count(*)::int from private.social_flight_kudos where activity_id='78000000-0000-0000-0000-000000000001'),1,'only one stored reaction exists');

set request.jwt.claims='{"sub":"75000000-0000-0000-0000-000000000001","role":"authenticated"}';
begin;
do $$begin perform public.social_change_relationship('75000000-0000-0000-0000-000000000002','remove',
 (select id from private.social_relationships where user_low='75000000-0000-0000-0000-000000000001')); end$$;
do $$begin perform dblink_send_query('kudos_race',$remote$select public.social_set_kudos('78000000-0000-0000-0000-000000000001',true)$remote$); end$$;
select ok(pg_temp.wait_for_kudos_lock(),'give waits behind friendship removal');
commit;
select throws_ok($$select * from dblink_get_result('kudos_race') as result(value jsonb)$$,'42501',null,'late give cannot recreate reaction after removal');
do $$begin perform value from dblink_get_result('kudos_race') as result(value jsonb); end$$;
select is((select count(*)::int from private.social_flight_kudos where activity_id='78000000-0000-0000-0000-000000000001'),0,'removal cascades previous reaction');
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','75000000-0000-0000-0000-000000000001','accepted');
begin;
do $$begin perform public.social_hide_flight('76000000-0000-0000-0000-000000000001'); end$$;
do $$begin perform dblink_send_query('kudos_race',$remote$select public.social_set_kudos('78000000-0000-0000-0000-000000000001',true)$remote$); end$$;
select ok(pg_temp.wait_for_kudos_lock(),'give waits behind Hide flight lock');
commit;
select throws_ok($$select * from dblink_get_result('kudos_race') as result(value jsonb)$$,'42501',null,'waiting give rechecks publication visibility');
do $$begin perform value from dblink_get_result('kudos_race') as result(value jsonb); end$$;
update private.social_publications set state='shared' where id='78000000-0000-0000-0000-000000000001';
begin;
do $$begin perform public.social_change_relationship('75000000-0000-0000-0000-000000000002','block'); end$$;
do $$begin perform dblink_send_query('kudos_race',$remote$select public.social_list_kudos('78000000-0000-0000-0000-000000000001')$remote$); end$$;
select ok(pg_temp.wait_for_kudos_lock(),'supporter names wait behind author block');
commit;
select throws_ok($$select * from dblink_get_result('kudos_race') as result(value jsonb)$$,'42501',null,'waiting supporter list sees post-block denial');
do $$begin perform value from dblink_get_result('kudos_race') as result(value jsonb); end$$;
delete from private.social_blocks where blocker_id='75000000-0000-0000-0000-000000000001';
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','75000000-0000-0000-0000-000000000001','accepted');
begin;
delete from public.flights where id='76000000-0000-0000-0000-000000000001';
do $$begin perform dblink_send_query('kudos_race',$remote$select public.social_set_kudos('78000000-0000-0000-0000-000000000001',true)$remote$); end$$;
select ok(pg_temp.wait_for_kudos_lock(),'give waits behind private flight deletion');
commit;
select throws_ok($$select * from dblink_get_result('kudos_race') as result(value jsonb)$$,'42501',null,'waiting reaction cannot survive deleted publication');
do $$begin perform value from dblink_get_result('kudos_race') as result(value jsonb); perform dblink_disconnect('kudos_race'); end$$;
delete from auth.users where id in('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002');
select * from finish();
