begin;
select no_plan();
insert into auth.users(id,email) select ('71000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 'kudos-'||i||'@example.test' from generate_series(1,4) i;
insert into public.social_profiles(user_id,display_name) select id,case when id::text like '%0001' then 'Author' else 'Same Pilot' end
 from auth.users where id::text like '71000000-%';
insert into public.flights(id,user_id,recording_session_id,status,started_at,ended_at,client_created_at,client_updated_at,
 metrics_algorithm_version,duration_ms,track_distance_metres,fix_count,quality,metrics_computed_at)
 values('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001',
 'completed',1000,2000,1000,1000,3,1000,0,0,'no_track',2000);
insert into private.social_publications(id,owner_id,flight_id,state,artifact_generation,artifact_path,artifact_sha256,artifact_bytes,provenance,published_at)
 values('74000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',
 'shared',gen_random_uuid(),'fixture',repeat('a',64),100,'recorded',now());
insert into private.social_relationships(user_low,user_high,requester_id,state)
 select '71000000-0000-0000-0000-000000000001',('71000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '71000000-0000-0000-0000-000000000001',case when i=4 then 'pending' else 'accepted' end from generate_series(2,4) i;
create function pg_temp.set_viewer(p_number integer) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','71000000-0000-0000-0000-'||lpad(p_number::text,12,'0'),'role','authenticated')::text,true);
end;
$$;
create function pg_temp.kudos(p_given boolean) returns jsonb language sql as $$
 select public.social_set_kudos('74000000-0000-0000-0000-000000000001',p_given);
$$;
create function pg_temp.list_kudos() returns jsonb language sql as $$
 select public.social_list_kudos('74000000-0000-0000-0000-000000000001');
$$;
select ok((select relrowsecurity from pg_class where oid='private.social_flight_kudos'::regclass),'reaction table has RLS');
set local role anon;
select throws_ok($$select pg_temp.list_kudos()$$,'42501',null,'anonymous names are denied');
select throws_ok($$select pg_temp.kudos(true)$$,'42501',null,'anonymous reactions are denied');
reset role;
select pg_temp.set_viewer(1);
select is(public.social_get_activity('74000000-0000-0000-0000-000000000001')->'kudos','{"count":0,"givenByMe":false}'::jsonb,'existing detail adds true zero kudos');
select throws_ok($$select pg_temp.kudos(true)$$,'P0001','kudos_self_not_allowed','author cannot react to own flight');
select throws_ok($$select pg_temp.kudos(false)$$,'P0001','kudos_self_not_allowed','author cannot forge an own reaction removal');
select pg_temp.set_viewer(4);
select throws_ok($$select pg_temp.list_kudos()$$,'42501',null,'pending friend cannot enumerate supporter names');
select throws_ok($$select pg_temp.kudos(true)$$,'42501',null,'pending friend cannot react');
select pg_temp.set_viewer(2);
select is(pg_temp.kudos(true),'{"activityId":"74000000-0000-0000-0000-000000000001","count":1,"givenByMe":true}'::jsonb,'accepted friend gives one reaction');
do $$begin perform set_config('test.first_reaction',(pg_temp.list_kudos()->'items'->0->>'id'),true); end$$;
select is(pg_temp.kudos(true)->>'count','1','retrying desired true never adds another reaction');
select is(pg_temp.list_kudos()->'items'->0->>'id',current_setting('test.first_reaction'),'duplicate reaction retains its stable identity');
select is(public.social_list_feed()->'items'->0->'kudos','{"count":1,"givenByMe":true}'::jsonb,'feed includes viewer-specific aggregate');
select pg_temp.set_viewer(3);
select is(pg_temp.kudos(true)->>'count','2','another friend contributes independently');
update private.social_relationships set state='accepted' where user_high='71000000-0000-0000-0000-000000000004';
select pg_temp.set_viewer(4);
select is(pg_temp.list_kudos()->>'count','2','newly accepted viewer sees prior reactions');
select is(jsonb_array_length(pg_temp.list_kudos()->'items'),2,'duplicate display names remain two different reactions');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.list_kudos()->'items') row
 where (select count(*) from jsonb_object_keys(row))<>2 or not(row ?& array['id','displayName'])),'names expose only reaction identity and chosen display name');
select throws_ok($$select public.social_get_friend_profile('71000000-0000-0000-0000-000000000002')$$,'42501',null,'seeing supporter name grants no additional profile access');
select throws_ok($$select public.social_list_kudos('74000000-0000-0000-0000-000000000001',null,null,26)$$,'22023',null,'page size is capped');
select throws_ok($$select public.social_list_kudos('74000000-0000-0000-0000-000000000001',now(),null,25)$$,'22023',null,'cursor requires both immutable tuple fields');
do $$begin perform set_config('test.page',public.social_list_kudos('74000000-0000-0000-0000-000000000001',null,null,1)::text,true); end$$;
select is(jsonb_array_length(current_setting('test.page')::jsonb->'items'),1,'page limit is applied');
select is(current_setting('test.page')::jsonb->>'count','2','page count is the full visible count');
update public.social_profiles set display_name='Renamed Pilot' where user_id='71000000-0000-0000-0000-000000000003';
select is(jsonb_array_length(public.social_list_kudos('74000000-0000-0000-0000-000000000001',
 (current_setting('test.page')::jsonb->'nextCursor'->>'createdAt')::timestamptz,
 (current_setting('test.page')::jsonb->'nextCursor'->>'id')::uuid,1)->'items'),1,'name changes cannot invalidate the stable cursor');
delete from private.social_flight_kudos where id=(current_setting('test.page')::jsonb->'nextCursor'->>'id')::uuid;
select is(jsonb_array_length(public.social_list_kudos('74000000-0000-0000-0000-000000000001',
 (current_setting('test.page')::jsonb->'nextCursor'->>'createdAt')::timestamptz,
 (current_setting('test.page')::jsonb->'nextCursor'->>'id')::uuid,1)->'items'),1,'deletion of the cursor reaction does not break the next page');
select pg_temp.set_viewer(2); select pg_temp.kudos(true);
select pg_temp.set_viewer(3); select pg_temp.kudos(true);
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002','accepted');
select pg_temp.set_viewer(2);
select public.social_change_relationship('71000000-0000-0000-0000-000000000003','block');
select is(pg_temp.list_kudos()->>'count','1','viewer block hides the other reactor from count');
select is(jsonb_array_length(pg_temp.list_kudos()->'items'),1,'viewer block hides the same reactor from names');
select is(public.social_get_activity('74000000-0000-0000-0000-000000000001')->'kudos'->>'count','1','card/detail count uses the names filter');
select pg_temp.set_viewer(3);
select is(pg_temp.list_kudos()->>'count','1','reverse-direction block is equally excluded');
select pg_temp.set_viewer(1);
select is(pg_temp.list_kudos()->>'count','2','author still sees both reactions on their own flight');
select is((select count(*)::int from private.social_flight_kudos),2,'third-party block does not delete reactions on unrelated author flight');
select pg_temp.set_viewer(2);
select public.social_change_relationship('71000000-0000-0000-0000-000000000003','unblock');
select is(pg_temp.list_kudos()->>'count','2','unblocking restores visibility without granting extra profile access');
insert into private.social_sharing_preferences(user_id,account_deleting) values('71000000-0000-0000-0000-000000000003',true);
select is(pg_temp.list_kudos()->>'count','1','reactor starting account deletion disappears from count');
select is(jsonb_array_length(pg_temp.list_kudos()->'items'),1,'reactor starting account deletion disappears from names');
delete from private.social_sharing_preferences where user_id='71000000-0000-0000-0000-000000000003';
select pg_temp.set_viewer(1);
select public.social_hide_flight('72000000-0000-0000-0000-000000000001');
select is((select count(*)::int from private.social_flight_kudos),2,'Hide preserves reactions');
select pg_temp.set_viewer(2);
select throws_ok($$select pg_temp.list_kudos()$$,'42501',null,'hidden names are unavailable');
select throws_ok($$select pg_temp.kudos(false)$$,'42501',null,'hidden publication cannot be mutated');
update private.social_publications set state='shared' where id='74000000-0000-0000-0000-000000000001';
select is(pg_temp.list_kudos()->>'count','2','re-sharing same publication retains reactions');
select is(pg_temp.kudos(false)->>'givenByMe','false','reactor can withdraw their own reaction');
select is(pg_temp.kudos(false)->>'count','1','retrying withdrawal is idempotent');
select pg_temp.kudos(true);
select pg_temp.set_viewer(1);
select public.social_change_relationship('71000000-0000-0000-0000-000000000002','remove',
 (select id from private.social_relationships where user_low='71000000-0000-0000-0000-000000000001' and user_high='71000000-0000-0000-0000-000000000002'));
select is(pg_temp.list_kudos()->>'count','1','friendship removal cascades its exact reactions');
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','accepted');
select is(pg_temp.list_kudos()->>'count','1','re-accepting friendship does not resurrect reactions');
select pg_temp.set_viewer(2); select pg_temp.kudos(true);
select pg_temp.set_viewer(1);
select public.social_change_relationship('71000000-0000-0000-0000-000000000002','block');
select is(pg_temp.list_kudos()->>'count','1','owner block deletes reactions by that friend');
delete from auth.users where id='71000000-0000-0000-0000-000000000003';
select is(pg_temp.list_kudos()->>'count','0','reactor account deletion cascades remaining reaction');
select pg_temp.set_viewer(4); select pg_temp.kudos(true);
delete from public.flights where id='72000000-0000-0000-0000-000000000001';
select is((select count(*)::int from private.social_flight_kudos),0,'flight deletion cascades all reactions');
select throws_ok($$select pg_temp.list_kudos()$$,'42501',null,'deleted publication names unavailable');
set local role authenticated;
select throws_ok($$select * from private.social_flight_kudos$$,'42501',null,'client cannot enumerate reaction rows');
select throws_ok($$select private.social_visible_kudos('74000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001')$$,
 '42501',null,'private visibility helper cannot bypass authorization');
reset role;
select * from finish();
rollback;
