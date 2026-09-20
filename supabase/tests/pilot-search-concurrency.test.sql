-- Real connections verify discovery decisions after visibility and deletion locks.
create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table pilot_race_backend(pid integer);
create function pg_temp.wait_for_pilot_lock()
returns boolean language plpgsql as $$begin
 for attempt in 1..100 loop
   if exists(select 1 from pg_stat_activity where pid=(select pid from pilot_race_backend)
     and wait_event_type='Lock') then return true; end if;
   perform pg_sleep(0.02);
 end loop;
 return false;
end$$;
create function pg_temp.pilot_remote_owner(p_owner text)
returns void language plpgsql as $$begin
 perform dblink_exec('pilot_race',format('set request.jwt.claims=%L',jsonb_build_object('sub',p_owner,'role','authenticated')::text));
end$$;
create function pg_temp.pilot_drain()
returns void language plpgsql as $$begin
 perform value from dblink_get_result('pilot_race') as response(value text);
end$$;
insert into auth.users(id,email) values
 ('83000000-0000-0000-0000-000000000001','pilot-race-a@example.com'),
 ('83000000-0000-0000-0000-000000000002','pilot-race-b@example.com');
insert into public.social_profiles(user_id,display_name,username,discoverable) values
 ('83000000-0000-0000-0000-000000000001','Pilot Race A','pilot_race_a',true),
 ('83000000-0000-0000-0000-000000000002','Pilot Race B','pilot_race_b',true);
do $$begin
 perform dblink_connect('pilot_race','hostaddr='||host(inet_server_addr())||' dbname='||current_database()||' user=postgres password=postgres');
 perform dblink_exec('pilot_race','set role authenticated');
 perform pg_temp.pilot_remote_owner('83000000-0000-0000-0000-000000000001');
end$$;
insert into pilot_race_backend select pid from dblink('pilot_race','select pg_backend_pid()') as backend(pid integer);

-- Hiding linearizes before a waiting request; a previously found UUID is insufficient.
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$begin perform public.social_save_profile('Pilot Race B','pilot_race_b',false); end$$;
reset role;
do $$begin perform dblink_send_query('pilot_race',$remote$select public.social_request_pilot('83000000-0000-0000-0000-000000000002')$remote$); end$$;
select ok(pg_temp.wait_for_pilot_lock(),'a request waits for the target visibility edit');
commit;
select is((select value->>'status' from dblink_get_result('pilot_race') as response(value jsonb)),'unavailable','request rechecks hidden state after the lock');
do $$begin perform pg_temp.pilot_drain(); end$$;
select is((select count(*)::int from private.social_relationships where user_low='83000000-0000-0000-0000-000000000001'),0,'hide-before-request creates no relationship');

-- In the other order, hiding preserves the already admitted pending request.
update public.social_profiles set discoverable=true where user_id='83000000-0000-0000-0000-000000000002';
do $$begin perform pg_temp.pilot_remote_owner('83000000-0000-0000-0000-000000000002'); end$$;
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_request_pilot('83000000-0000-0000-0000-000000000002')->>'status','sent','the first request admits a pending relationship');
reset role;
do $$begin perform dblink_send_query('pilot_race',$remote$select public.social_save_profile('Pilot Race B','pilot_race_b',false)::text$remote$); end$$;
select ok(pg_temp.wait_for_pilot_lock(),'visibility edit waits for the already admitted request');
commit;
do $$begin perform pg_temp.pilot_drain(); perform pg_temp.pilot_drain(); end$$;
select is((select state from private.social_relationships where user_low='83000000-0000-0000-0000-000000000001'),'pending','request-before-hide keeps its pending relationship');
select is((select discoverable from public.social_profiles where user_id='83000000-0000-0000-0000-000000000002'),false,'the waiting privacy choice still takes effect');
delete from private.social_relationships where user_low='83000000-0000-0000-0000-000000000001';
update public.social_profiles set discoverable=true where user_id='83000000-0000-0000-0000-000000000002';
do $$begin perform pg_temp.pilot_remote_owner('83000000-0000-0000-0000-000000000001'); end$$;

-- Identity does not move with a username edit.
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$begin perform public.social_save_profile('Renamed Pilot','pilot_race_renamed',true); end$$;
reset role;
do $$begin perform dblink_send_query('pilot_race',$remote$select public.social_request_pilot('83000000-0000-0000-0000-000000000002')$remote$); end$$;
select ok(pg_temp.wait_for_pilot_lock(),'request waits through the target username edit');
commit;
select is((select value->>'status' from dblink_get_result('pilot_race') as response(value jsonb)),'sent','renaming preserves the intended request target');
do $$begin perform pg_temp.pilot_drain(); end$$;
select is((select user_high from private.social_relationships where user_low='83000000-0000-0000-0000-000000000001'),'83000000-0000-0000-0000-000000000002'::uuid,'request still belongs to the original pilot UUID');
delete from private.social_relationships where user_low='83000000-0000-0000-0000-000000000001';

-- Discovery blocking wins against an already dispatched request.
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$begin perform public.social_block_pilot('83000000-0000-0000-0000-000000000001'); end$$;
reset role;
do $$begin perform dblink_send_query('pilot_race',$remote$select public.social_request_pilot('83000000-0000-0000-0000-000000000002')$remote$); end$$;
select ok(pg_temp.wait_for_pilot_lock(),'request waits behind a discovered-stranger block');
commit;
select is((select value->>'status' from dblink_get_result('pilot_race') as response(value jsonb)),'unavailable','waiting request cannot bypass a new reverse block');
do $$begin perform pg_temp.pilot_drain(); end$$;
select is((select count(*)::int from private.social_relationships where user_low='83000000-0000-0000-0000-000000000001'),0,'blocking prevents relationship resurrection');
delete from private.social_blocks where blocker_id='83000000-0000-0000-0000-000000000002';

-- Account-deletion admission shares the same owner lock, in either operation.
begin;
do $$begin perform public.social_begin_account_deletion('83000000-0000-0000-0000-000000000002'); end$$;
do $$begin perform dblink_send_query('pilot_race',$remote$select public.social_request_pilot('83000000-0000-0000-0000-000000000002')$remote$); end$$;
select ok(pg_temp.wait_for_pilot_lock(),'request waits behind target account-deletion admission');
commit;
select is((select value->>'status' from dblink_get_result('pilot_race') as response(value jsonb)),'unavailable','waiting request cannot reach a deleting account');
do $$begin perform pg_temp.pilot_drain(); end$$;
update private.social_sharing_preferences set account_deleting=false where user_id='83000000-0000-0000-0000-000000000002';
begin;
do $$begin perform public.social_begin_account_deletion('83000000-0000-0000-0000-000000000002'); end$$;
do $$begin perform dblink_send_query('pilot_race',$remote$select public.social_block_pilot('83000000-0000-0000-0000-000000000002')::text$remote$); end$$;
select ok(pg_temp.wait_for_pilot_lock(),'discovery block waits behind target deletion admission');
commit;
select throws_ok($$select * from dblink_get_result('pilot_race') as response(value text)$$,'42501',null,'deleting discovery target is generically unavailable after the wait');
do $$begin perform pg_temp.pilot_drain(); end$$;
update private.social_sharing_preferences set account_deleting=false where user_id='83000000-0000-0000-0000-000000000002';

-- Different owners can simultaneously claim the same name; only one commits.
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$begin perform public.social_save_profile('Winning Pilot','pilot_claim_race',true); end$$;
reset role;
do $$begin perform dblink_send_query('pilot_race',$remote$select public.social_save_profile('Losing Pilot','pilot_claim_race',true)::text$remote$); end$$;
select ok(pg_temp.wait_for_pilot_lock(),'simultaneous username claim waits on database uniqueness');
commit;
select throws_ok($$select * from dblink_get_result('pilot_race') as response(value text)$$,'23505',null,'the losing username claim gets a conflict');
do $$begin perform pg_temp.pilot_drain(); end$$;
select is((select user_id from public.social_profiles where username='pilot_claim_race'),'83000000-0000-0000-0000-000000000002'::uuid,'only the winning owner receives the username');
select is((select display_name||':'||username from public.social_profiles where user_id='83000000-0000-0000-0000-000000000001'),'Pilot Race A:pilot_race_a','failed claim leaves the losing profile intact');

do $$begin perform dblink_disconnect('pilot_race'); end$$;
delete from auth.users where id in('83000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000002');
select * from finish();
