-- Real connections prove publication and permission checks use post-lock state.
create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table shared_race_backend(pid integer);
create function pg_temp.wait_for_shared_lock() returns boolean language plpgsql as $$begin
 for attempt in 1..100 loop
   if exists(select 1 from pg_stat_activity where pid=(select pid from shared_race_backend)
      and wait_event_type='Lock' and wait_event='advisory') then return true; end if;
   perform pg_sleep(0.02);
 end loop;
 return false;
end$$;
insert into auth.users(id,email) values
 ('65000000-0000-0000-0000-000000000001','shared-race-a@example.test'),
 ('65000000-0000-0000-0000-000000000002','shared-race-b@example.test');
insert into public.social_profiles(user_id,display_name) values
 ('65000000-0000-0000-0000-000000000001','Race A'),('65000000-0000-0000-0000-000000000002','Race B');
insert into public.flights(id,user_id,recording_session_id,status,started_at,ended_at,client_created_at,client_updated_at,
 metrics_algorithm_version,duration_ms,track_distance_metres,fix_count,quality,metrics_computed_at)
 values('66000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000001',
 '67000000-0000-0000-0000-000000000001','completed',1000,2000,1000,1000,3,1000,25,2,'healthy',2000);
set request.jwt.claims='{"sub":"65000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$declare prepared jsonb; reservation jsonb; begin
 prepared:=public.social_prepare_share('66000000-0000-0000-0000-000000000001','68000000-0000-0000-0000-000000000001','manual',null,0);
 perform set_config('test.shared_race',prepared::text,false);
 reservation:=public.social_begin_upload('65000000-0000-0000-0000-000000000001',(prepared->>'activityId')::uuid,(prepared->>'uploadToken')::uuid);
 insert into storage.objects(bucket_id,name,metadata) values('shared-flight-replays',reservation->>'objectPath','{"size":100}');
 perform dblink_connect('shared_race','hostaddr='||host(inet_server_addr())||' dbname='||current_database()||' user=postgres password=postgres');
end$$;
insert into shared_race_backend select pid from dblink('shared_race','select pg_backend_pid()') as backend(pid integer);
begin;
select is(public.social_hide_flight('66000000-0000-0000-0000-000000000001')->>'state','hidden','hide owns publication lock first');
do $$begin perform dblink_send_query('shared_race',format($remote$
 select public.social_activate_upload('65000000-0000-0000-0000-000000000001',%L::uuid,%L::uuid,repeat('a',64),100,'recorded',true,'[]')
$remote$,current_setting('test.shared_race')::jsonb->>'activityId',current_setting('test.shared_race')::jsonb->>'uploadToken')); end$$;
select ok(pg_temp.wait_for_shared_lock(),'activation waits behind hide on the owner lock');
commit;
select throws_ok($$select * from dblink_get_result('shared_race') as result(value jsonb)$$,'P0001','shared_publication_changed','activation rechecks hidden state after waiting');
do $$begin perform value from dblink_get_result('shared_race') as result(value jsonb); end$$;

-- Publish with a fresh explicit operation, then remove friendship while a detail
-- read is waiting. Neither a stale detail nor a stale artifact grant is returned.
do $$declare prepared jsonb; reservation jsonb; begin
 prepared:=public.social_prepare_share('66000000-0000-0000-0000-000000000001','68000000-0000-0000-0000-000000000002','manual',null,2);
 perform set_config('test.shared_race',prepared::text,false);
 reservation:=public.social_begin_upload('65000000-0000-0000-0000-000000000001',(prepared->>'activityId')::uuid,(prepared->>'uploadToken')::uuid);
 insert into storage.objects(bucket_id,name,metadata) values('shared-flight-replays',reservation->>'objectPath','{"size":100}');
 perform public.social_activate_upload('65000000-0000-0000-0000-000000000001',(prepared->>'activityId')::uuid,(prepared->>'uploadToken')::uuid,repeat('a',64),100,'recorded',true,'[]');
 perform dblink_exec('shared_race',$remote$set role authenticated; set request.jwt.claims='{"sub":"65000000-0000-0000-0000-000000000002","role":"authenticated"}'$remote$);
end$$;
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('65000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000002','65000000-0000-0000-0000-000000000001','accepted');
begin;
do $$begin perform public.social_change_relationship('65000000-0000-0000-0000-000000000002','remove',
 (select id from private.social_relationships where user_low='65000000-0000-0000-0000-000000000001')); end$$;
do $$begin perform dblink_send_query('shared_race',format('select public.social_get_activity(%L::uuid)',current_setting('test.shared_race')::jsonb->>'activityId')); end$$;
select ok(pg_temp.wait_for_shared_lock(),'detail read shares the friendship removal lock');
commit;
select throws_ok($$select * from dblink_get_result('shared_race') as result(value jsonb)$$,'42501',null,'waiting detail cannot reuse pre-removal permission');
do $$begin perform value from dblink_get_result('shared_race') as result(value jsonb); end$$;

-- A feed request also waits on the same pair, and must return an empty page.
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('65000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000002','65000000-0000-0000-0000-000000000001','accepted');
begin;
do $$begin perform public.social_change_relationship('65000000-0000-0000-0000-000000000002','block'); end$$;
do $$begin perform dblink_send_query('shared_race','select public.social_list_feed()'); end$$;
select ok(pg_temp.wait_for_shared_lock(),'feed waits for concurrent block');
commit;
select is((select jsonb_array_length(value->'items') from dblink_get_result('shared_race') as result(value jsonb)),0,'feed uses post-block permission state');
do $$begin perform value from dblink_get_result('shared_race') as result(value jsonb); perform dblink_disconnect('shared_race'); end$$;
set storage.allow_delete_query='true';
delete from storage.objects where bucket_id='shared-flight-replays' and name like '65000000-0000-0000-0000-000000000001/%';
delete from auth.users where id in('65000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000002');
delete from private.social_artifact_cleanup where owner_id='65000000-0000-0000-0000-000000000001';
delete from private.social_uploads where owner_id='65000000-0000-0000-0000-000000000001';
select * from finish();
