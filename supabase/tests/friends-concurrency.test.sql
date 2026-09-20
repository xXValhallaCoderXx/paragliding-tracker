-- Two actual connections exercise fresh post-lock snapshots and pair serialization.
create extension if not exists dblink with schema extensions;
select no_plan();
create temporary table friends_race_backend(pid integer);
create function pg_temp.wait_for_friends_lock()
returns boolean language plpgsql as $$begin
  for attempt in 1..100 loop
    if exists (select 1 from pg_stat_activity where pid=(select pid from friends_race_backend)
      and wait_event_type='Lock' and wait_event='advisory') then return true; end if;
    perform pg_sleep(0.02);
  end loop;
  return false;
end$$;
insert into auth.users(id,email) values
 ('55000000-0000-0000-0000-000000000001','friends-race-a@example.com'),
 ('55000000-0000-0000-0000-000000000002','friends-race-b@example.com');
insert into public.social_profiles(user_id,display_name,username,discoverable) values
 ('55000000-0000-0000-0000-000000000001','Race A','race_a',true),('55000000-0000-0000-0000-000000000002','Race B','race_b',true);
do $$begin
  perform dblink_connect('friends_race','hostaddr='||host(inet_server_addr())||' dbname='||current_database()||' user=postgres password=postgres');
  perform dblink_exec('friends_race',$remote$
    set role authenticated;
    set request.jwt.claims='{"sub":"55000000-0000-0000-0000-000000000002","role":"authenticated"}';
  $remote$);
end$$;
insert into friends_race_backend select pid from dblink('friends_race','select pg_backend_pid()') as backend(pid integer);

begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"55000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_request_pilot('55000000-0000-0000-0000-000000000002')->>'status','sent','first crossed request starts pending');
reset role;
do $$begin perform dblink_send_query('friends_race',$remote$select public.social_request_pilot('55000000-0000-0000-0000-000000000001')$remote$); end$$;
select ok(pg_temp.wait_for_friends_lock(),'crossed request waits on the common pair lock');
commit;
select is((select value->>'status' from dblink_get_result('friends_race') as response(value jsonb)),'incoming','waiting crossed request sees incoming, never auto-accepts');
do $$begin perform value from dblink_get_result('friends_race') as response(value jsonb); end$$;
select is((select count(*)::int from private.social_relationships where user_low='55000000-0000-0000-0000-000000000001'),1,'crossed requests preserve pair uniqueness');
do $$begin perform set_config('test.race_request',(select id::text from private.social_relationships
 where user_low='55000000-0000-0000-0000-000000000001'),false); end$$;

-- Block wins first: the waiting accept must not recreate an accepted relation.
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"55000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$begin perform public.social_change_relationship('55000000-0000-0000-0000-000000000002','block'); end$$;
reset role;
do $$begin perform dblink_send_query('friends_race',format($remote$
  select public.social_change_relationship('55000000-0000-0000-0000-000000000001','accept',%L::uuid)::text
$remote$,current_setting('test.race_request'))); end$$;
select ok(pg_temp.wait_for_friends_lock(),'accept waits while block owns the pair');
commit;
do $$begin perform value from dblink_get_result('friends_race') as response(value text);
  perform value from dblink_get_result('friends_race') as response(value text); end$$;
select is((select count(*)::int from private.social_relationships where user_low='55000000-0000-0000-0000-000000000001'),0,'block-before-accept leaves no friendship');
select is((select count(*)::int from private.social_blocks where blocker_id='55000000-0000-0000-0000-000000000001'),1,'block-before-accept retains the block');

-- Restore a pending pair. Accept owns the pair first; subsequent block removes it.
set role authenticated;
set request.jwt.claims='{"sub":"55000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$begin perform public.social_change_relationship('55000000-0000-0000-0000-000000000002','unblock');
  perform public.social_request_pilot('55000000-0000-0000-0000-000000000002'); end$$;
reset role;
do $$begin perform set_config('test.race_request',(select id::text from private.social_relationships
 where user_low='55000000-0000-0000-0000-000000000001'),false); end$$;
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"55000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$begin perform public.social_change_relationship('55000000-0000-0000-0000-000000000001','accept',current_setting('test.race_request')::uuid); end$$;
reset role;
do $$begin perform dblink_send_query('friends_race',$remote$
  select public.social_change_relationship('55000000-0000-0000-0000-000000000001','block')::text
$remote$); end$$;
select ok(pg_temp.wait_for_friends_lock(),'block waits while accept owns the pair');
commit;
do $$begin perform value from dblink_get_result('friends_race') as response(value text);
  perform value from dblink_get_result('friends_race') as response(value text); end$$;
select is((select count(*)::int from private.social_relationships where user_low='55000000-0000-0000-0000-000000000001'),0,'accept-before-block also leaves no friendship');

-- A profile read started before removal commits must recheck after the wait.
delete from private.social_blocks where blocked_id='55000000-0000-0000-0000-000000000001';
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000001','accepted');
do $$begin perform set_config('test.race_request',(select id::text from private.social_relationships
 where user_low='55000000-0000-0000-0000-000000000001'),false); end$$;
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"55000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$begin perform public.social_change_relationship('55000000-0000-0000-0000-000000000002','remove',current_setting('test.race_request')::uuid); end$$;
reset role;
do $$begin perform dblink_send_query('friends_race',$remote$select public.social_get_friend_profile('55000000-0000-0000-0000-000000000001')$remote$); end$$;
select ok(pg_temp.wait_for_friends_lock(),'profile fetch shares the removal lock');
commit;
select throws_ok($$select * from dblink_get_result('friends_race') as response(value jsonb)$$,'42501',null,'waiting profile fetch cannot use a pre-removal authorization snapshot');
do $$begin perform value from dblink_get_result('friends_race') as response(value jsonb); end$$;

-- A stale acceptance blocked behind removal must remain removed, too.
insert into private.social_relationships(id,user_low,user_high,requester_id,state) values
 (current_setting('test.race_request')::uuid,'55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000001','accepted');
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"55000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$begin perform public.social_change_relationship('55000000-0000-0000-0000-000000000002','remove',current_setting('test.race_request')::uuid); end$$;
reset role;
do $$begin perform dblink_send_query('friends_race',format($remote$
  select public.social_change_relationship('55000000-0000-0000-0000-000000000001','accept',%L::uuid)::text
$remote$,current_setting('test.race_request'))); end$$;
select ok(pg_temp.wait_for_friends_lock(),'late acceptance waits behind removal');
commit;
do $$begin perform value from dblink_get_result('friends_race') as response(value text);
  perform value from dblink_get_result('friends_race') as response(value text); end$$;
select is((select count(*)::int from private.social_relationships where user_low='55000000-0000-0000-0000-000000000001'),0,'late acceptance cannot resurrect a removed friendship');

do $$begin perform dblink_disconnect('friends_race'); end$$;
delete from auth.users where id in ('55000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002');
select * from finish();
