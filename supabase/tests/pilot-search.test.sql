begin;
select no_plan();
insert into auth.users(id,email)
 select ('81000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'search-'||i||'@example.test'
 from generate_series(1,30) i;
insert into public.social_profiles(user_id,display_name) values
 ('81000000-0000-0000-0000-000000000001','Legacy Observer'),
 ('81000000-0000-0000-0000-000000000028','Valley Legacy');
insert into public.social_profiles(user_id,display_name,username,discoverable)
 select ('81000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 case when i=2 then 'Exact Other Name' else 'Valley Pilot '||lpad(i::text,2,'0') end,
 case when i=2 then 'valley' when i=3 then 'valley_03' else 'pilot_'||lpad(i::text,2,'0') end,true
 from generate_series(2,26) i;
insert into public.social_profiles(user_id,display_name,username,discoverable) values
 ('81000000-0000-0000-0000-000000000027','Valley Hidden','hidden',false),
 ('81000000-0000-0000-0000-000000000029','Valley Deleting','deleting',true),
 ('81000000-0000-0000-0000-000000000030','Literal 100%__! Match','literal_pilot',true);
insert into private.social_sharing_preferences(user_id,account_deleting) values('81000000-0000-0000-0000-000000000029',true);
insert into private.social_relationships(id,user_low,user_high,requester_id,state) values
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000002','accepted');
insert into public.flights(id,user_id,recording_session_id,status,started_at,ended_at,client_created_at,client_updated_at)
 values('83000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000001','completed',1000,2000,1000,1000);
insert into private.social_publications(id,owner_id,flight_id,state) values
 ('85000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','83000000-0000-0000-0000-000000000001','shared');
insert into private.social_flight_kudos(id,activity_id,reactor_id,relationship_id) values
 ('86000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001');
create function pg_temp.search_viewer(p_number integer) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',jsonb_build_object('sub','81000000-0000-0000-0000-'||lpad(p_number::text,12,'0'),'role','authenticated')::text,true); end$$;
select is(to_regclass('private.social_invites'),null::regclass,'code table is removed');
select is(to_regprocedure('public.social_request_friend(text)'),null::regprocedure,'code request RPC is removed');
select is(to_regprocedure('public.social_rotate_invite_code()'),null::regprocedure,'code rotation RPC is removed');
select is(to_regprocedure('private.social_new_code()'),null::regprocedure,'code generation is removed');
select is(to_regprocedure('public.social_save_profile(text)'),null::regprocedure,'legacy name-only profile writer is removed');
select pg_temp.search_viewer(1);
select is(public.social_get_state()->'profile'->'username','null'::jsonb,'legacy profile keeps null username');
select is(public.social_get_state()->'profile'->>'discoverable','false','legacy profile remains hidden');
select throws_ok($$select public.social_search_pilots('va')$$,'22023',null,'legacy profile must choose username before search');
select throws_ok($$select public.social_request_pilot('81000000-0000-0000-0000-000000000003')$$,'22023',null,'legacy profile must choose username before new requests');
select throws_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000003')$$,'22023',null,'legacy profile must choose username before discovery block');
select lives_ok($$select public.social_get_friend_profile('81000000-0000-0000-0000-000000000002')$$,'legacy accepted friendship still authorizes profile');
select throws_ok($$select public.social_save_profile('Observer','ab',true)$$,'22023',null,'username minimum length enforced');
select throws_ok($$select public.social_save_profile('Observer',repeat('a',25),true)$$,'22023',null,'username maximum length enforced');
select throws_ok($$select public.social_save_profile('Observer','@observer',true)$$,'22023',null,'save expects a bare username');
select throws_ok($$select public.social_save_profile('Observer','bad name',true)$$,'22023',null,'username whitespace rejected');
select throws_ok($$select public.social_save_profile('Observer','ééé',true)$$,'22023',null,'username alphabet is ASCII');
select throws_ok($$select public.social_save_profile('Observer','observer',null)$$,'22023',null,'search preference must be explicit');
select throws_ok($$select public.social_save_profile('Observer',' VALLEY ',true)$$,'23505',null,'case-normalized duplicate username rejected');
select lives_ok($$select public.social_save_profile('  Observer  ',' Observer_1 ',true)$$,'legacy profile can claim a chosen username');
select is(public.social_get_state()->'profile'->>'username','observer_1','username normalization persisted');
select is(public.social_get_state()->'relationships'->0->>'id','82000000-0000-0000-0000-000000000001','claim preserves relationship identity');
select is((select id::text from private.social_flight_kudos where reactor_id='81000000-0000-0000-0000-000000000001'),'86000000-0000-0000-0000-000000000001','claim preserves reaction identity');
select throws_ok($$select public.social_search_pilots('x')$$,'22023',null,'short name query refused');
select throws_ok($$select public.social_search_pilots('@x')$$,'22023',null,'marker does not count toward minimum');
select throws_ok($$select public.social_search_pilots(repeat('x',61))$$,'22023',null,'overlong normalized term refused');
select lives_ok($$select public.social_search_pilots('@'||repeat('x',60))$$,'maximum term length excludes optional marker');
select is(jsonb_array_length(public.social_search_pilots('observer')->'items'),0,'self excluded');
select is(public.social_search_pilots(E'  VaLLeY \n')->'items'->0->>'username','valley','exact username ranks first');
select is(jsonb_array_length(public.social_search_pilots('@valley')->'items'),2,'@ searches only username prefix');
select is(jsonb_array_length(public.social_search_pilots('OTHER NAME')->'items'),1,'name matching is literal case-insensitive contains');
select is(public.social_search_pilots('%_')->'items'->0->>'username','literal_pilot','percent and underscore are literal characters');
select is(jsonb_array_length(public.social_search_pilots('%%')->'items'),0,'wildcard characters never enumerate the directory');
select is(jsonb_array_length(public.social_search_pilots('hidden')->'items'),0,'hidden profile excluded');
select is(jsonb_array_length(public.social_search_pilots('legacy')->'items'),0,'unclaimed legacy profile excluded');
select is(jsonb_array_length(public.social_search_pilots('deleting')->'items'),0,'deleting profile excluded');
select ok(not exists(select 1 from jsonb_array_elements(public.social_search_pilots('valley')->'items') hit
 where (select count(*) from jsonb_object_keys(hit))<>5 or not(hit ?& array['userId','displayName','username','relationshipId','relationshipState'])),
 'discovery exposes only the approved identity and relationship fields');
select is(public.social_search_pilots('@valley')->'items'->0->>'relationshipState','accepted','search labels accepted relationship');
select is(public.social_search_pilots('@valley')->'items'->0->>'relationshipId','82000000-0000-0000-0000-000000000001','search retains exact relationship ID');
select throws_ok($$select public.social_get_friend_profile('81000000-0000-0000-0000-000000000003')$$,'42501',null,'discovery grants no prefriend profile/count access');
set local role authenticated;
select is((select count(*)::int from public.flights),0,'discovery grants no private flight access');
select is((select count(*)::int from public.social_profiles),1,'direct profile RLS remains owner-only');
select throws_ok($$select * from private.social_search_limits$$,'42501',null,'search quota rows remain private');
reset role;
do $$begin perform set_config('test.search_page',public.social_search_pilots('valley')::text,true); end$$;
select is(jsonb_array_length(current_setting('test.search_page')::jsonb->'items'),20,'search page size is fixed at 20');
select is(current_setting('test.search_page')::jsonb->'nextCursor'->>'query','valley','cursor binds normalized query');
select is(jsonb_array_length(public.social_search_pilots('valley',current_setting('test.search_page')::jsonb->'nextCursor')->'items'),5,'second page contains remaining five');
select ok(not exists(
 select 1 from jsonb_array_elements(current_setting('test.search_page')::jsonb->'items') a
 join jsonb_array_elements(public.social_search_pilots('valley',current_setting('test.search_page')::jsonb->'nextCursor')->'items') b
 on a->>'userId'=b->>'userId'),'pages do not repeat identities');
select throws_ok($$select public.social_search_pilots('other',current_setting('test.search_page')::jsonb->'nextCursor')$$,'22023',null,'cursor cannot cross queries');
select throws_ok($$select public.social_search_pilots('valley','{"query":"valley","rank":2,"username":"pilot_20","userId":"81000000-0000-0000-0000-000000000020"}')$$,'22023',null,'cursor rank is bounded');
select throws_ok($$select public.social_search_pilots('valley','{"query":"valley","rank":1,"username":"pilot_20","userId":"invalid"}')$$,'22023',null,'cursor ID is validated');
select lives_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000030')$$,'discovered stranger can be blocked without requesting');
select is(jsonb_array_length(public.social_search_pilots('literal')->'items'),0,'caller block excludes discovery hit');
select lives_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000030')$$,'own block retry is idempotent');
select pg_temp.search_viewer(30);
select is(jsonb_array_length(public.social_search_pilots('observer')->'items'),0,'reverse block also excludes discovery hit');
select throws_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000001')$$,'42501',null,'blocked stranger cannot use block as an identity probe');
select pg_temp.search_viewer(1);
select throws_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000027')$$,'42501',null,'hidden stranger cannot be blocked by arbitrary UUID');
select throws_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000099')$$,'42501',null,'missing stranger uses same generic denial');
select is(public.social_request_pilot('81000000-0000-0000-0000-000000000027')->>'status','unavailable','hidden stranger cannot receive request by stale ID');
select is(public.social_request_pilot('81000000-0000-0000-0000-000000000029')->>'status','unavailable','deleting stranger cannot receive request');
select throws_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000029')$$,'42501',null,'deleting stranger is unavailable for block');
select is(public.social_request_pilot('81000000-0000-0000-0000-000000000003')->>'status','sent','visible stable ID creates pending request');
select is(public.social_search_pilots('@valley_03')->'items'->0->>'relationshipState','outgoing','search labels outgoing request');
do $$begin perform set_config('test.discovery_pending',(select id::text from private.social_relationships
 where user_low='81000000-0000-0000-0000-000000000001' and user_high='81000000-0000-0000-0000-000000000003'),true); end$$;
select pg_temp.search_viewer(3);
select is(public.social_search_pilots('observer')->'items'->0->>'relationshipState','incoming','search labels incoming request');
select public.social_save_profile('Valley Renamed','renamed_three',false);
select is(public.social_get_state()->'relationships'->0->>'id',current_setting('test.discovery_pending'),'rename and hide preserve pending identity');
select public.social_change_relationship('81000000-0000-0000-0000-000000000001','accept',current_setting('test.discovery_pending')::uuid);
select pg_temp.search_viewer(1);
select is(public.social_request_pilot('81000000-0000-0000-0000-000000000003')->>'status','accepted','hidden existing relationship stays usable');
select is(public.social_get_friend_profile('81000000-0000-0000-0000-000000000003')->>'username','renamed_three','accepted profile shows current username');
select ok(not(public.social_get_friend_profile('81000000-0000-0000-0000-000000000003') ? 'discoverable'),'friend profile does not expose owner search preference');
select pg_temp.search_viewer(4);
select is(public.social_request_pilot('81000000-0000-0000-0000-000000000003')->>'status','unavailable','hidden pilot rejects new unrelated requests');
select pg_temp.search_viewer(2);
select public.social_save_profile('Exact Other Name','valley',false);
select pg_temp.search_viewer(1);
select is((select id::text from private.social_flight_kudos where reactor_id='81000000-0000-0000-0000-000000000001'),'86000000-0000-0000-0000-000000000001','hiding author preserves existing kudos');
select public.social_block_pilot('81000000-0000-0000-0000-000000000002');
select is((select count(*)::int from private.social_flight_kudos where reactor_id='81000000-0000-0000-0000-000000000001'),0,'blocking hidden existing friend cascades their exact relationship kudos');
insert into private.social_sharing_preferences(user_id,account_deleting) values('81000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.social_search_pilots('valley')$$,'P0001','shared_account_deleting','deleting caller cannot search');
select throws_ok($$select public.social_request_pilot('81000000-0000-0000-0000-000000000004')$$,'P0001','shared_account_deleting','deleting caller cannot request');
select throws_ok($$select public.social_get_state()$$,'P0001','shared_account_deleting','deleting caller cannot read social state');
set local role anon;
set local request.jwt.claims='{}';
select throws_ok($$select public.social_search_pilots('valley')$$,'42501',null,'anonymous cannot search');
select throws_ok($$select public.social_request_pilot('81000000-0000-0000-0000-000000000003')$$,'42501',null,'anonymous cannot request');
select throws_ok($$select public.social_block_pilot('81000000-0000-0000-0000-000000000003')$$,'42501',null,'anonymous cannot block discovered pilot');
reset role;
select * from finish();
rollback;
