begin;
select no_plan();
set local storage.allow_delete_query = 'true';
insert into auth.users(id,email) values
 ('51000000-0000-0000-0000-000000000001','friends-a@example.com'),
 ('51000000-0000-0000-0000-000000000002','friends-b@example.com'),
 ('51000000-0000-0000-0000-000000000003','friends-c@example.com');
select is((select count(*)::int from public.social_profiles),0,'sign-up does not silently create a social profile');
select ok((select relrowsecurity from pg_class where oid='public.social_profiles'::regclass),'social profiles use RLS');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
 'private.social_search_limits'::regclass,'private.social_relationships'::regclass,
 'private.social_blocks'::regclass,'private.social_request_limits'::regclass)),'private social tables all use RLS');

-- Three complete summaries (including partial and zero-track); six incomplete
-- metrics bundles; processing and recording rows. None needs an IGC object.
insert into public.flights(id,user_id,recording_session_id,status,started_at,ended_at,
 client_created_at,client_updated_at,metrics_algorithm_version,duration_ms,track_distance_metres,
 fix_count,quality,metrics_computed_at,title,notes)
select ('52000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '51000000-0000-0000-0000-000000000002',('53000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 (case when i=2 then 'partial' when i=10 then 'processing' when i=11 then 'recording' else 'completed' end)::public.flight_status,
 1000,2000,1000,1000,case when i=4 then null else 3 end,case when i=5 then null else 1000 end,
 case when i=6 then null else 0 end,case when i=7 then null when i=3 then 0 else 2 end,
 (case when i=8 then null when i=3 then 'no_track' when i=2 then 'partial' else 'healthy' end)::public.track_quality,
 case when i=9 then null else 3000 end,'Private title','Private notes' from generate_series(1,11) i;
insert into storage.objects(bucket_id,name,metadata) values
 ('flight-igc','51000000-0000-0000-0000-000000000002/private.igc','{"size":10}');

set local role authenticated;
set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_get_state(),'{"profile":null,"relationships":[]}'::jsonb,'new account has an explicit empty social state');
select throws_ok($$select public.social_search_pilots('pi')$$,'22023',null,'search requires a completed social profile');
select throws_ok($$select public.social_request_pilot('51000000-0000-0000-0000-000000000001')$$,'22023',null,'requesting friends requires a chosen profile');
select throws_ok($$select public.social_save_profile(null,'pilot_a',true)$$,'22023',null,'null display name refused');
select throws_ok($$select public.social_save_profile('  ','pilot_a',true)$$,'22023',null,'empty display name refused');
select throws_ok($$select public.social_save_profile(repeat('x',61),'pilot_a',true)$$,'22023',null,'overlong display name refused');
select lives_ok($$select public.social_save_profile(E'  Pilot\t A\n ',' Pilot_A ',true)$$,'explicit profile save succeeds');
select is(public.social_get_state()->'profile'->>'displayName','Pilot A','display name whitespace is normalized');
select is((public.social_get_state()->'profile'->>'backedUpFlightCount')::int,0,'owner with no backed-up flights sees zero');
select is(public.social_get_state()->'profile'->>'username','pilot_a','username is normalized');
select is(public.social_get_state()->'profile'->>'discoverable','true','new profile opts into search');
select ok(not(public.social_get_state() ? 'inviteCode'),'state no longer exposes invitation codes');
select lives_ok($$select public.social_save_profile('A New Name','pilot_a',true)$$,'social name can be edited');
select is(public.social_get_state()->'profile'->>'username','pilot_a','editing a name retains its username');
select is((select pilot_name from public.profiles),null::text,'social name never overwrites the private IGC pilot name');
select throws_ok($$insert into public.social_profiles(user_id,display_name) values ('51000000-0000-0000-0000-000000000002','Forged')$$,'42501',null,'client cannot create another social profile directly');
select throws_ok($$update public.social_profiles set display_name='Bypass'$$,'42501',null,'profile writes must use the narrow RPC');
select throws_ok($$select * from private.social_search_limits$$,'42501',null,'clients cannot enumerate search quotas');
select throws_ok($$select * from private.social_relationships$$,'42501',null,'clients cannot enumerate relationships');
select throws_ok($$select private.social_profile_json('51000000-0000-0000-0000-000000000002')$$,'42501',null,'private aggregate helper cannot bypass friendship checks');
select is(public.social_request_pilot(null)->>'status','unavailable','null discovery identity has generic unavailable response');
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000001')->>'status','unavailable','self request refused');

set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.social_save_profile('Pilot B','pilot_b',true)$$,'B explicitly creates a social profile');
select is((public.social_get_state()->'profile'->>'backedUpFlightCount')::int,3,'count includes partial/no-track but excludes every incomplete bundle and unfinished status');
select is((select count(*)::int from public.social_profiles),1,'B can directly read only their own social profile');
select throws_ok($$select public.social_get_friend_profile('51000000-0000-0000-0000-000000000001')$$,'42501',null,'unrelated profile is unavailable');

set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000002')->>'status',
 'sent','stable discovery identity creates a request');
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000002')->>'status','outgoing','retry does not create a second request');
select is(jsonb_array_length(public.social_get_state()->'relationships'),1,'one pair produces one relationship');
select is(public.social_get_state()->'relationships'->0->>'state','outgoing','sender sees outgoing state');
select is(public.social_get_state()->'relationships'->0->>'displayName','Pilot B','pending request reveals only chosen identity');
select ok(not ((public.social_get_state()->'relationships'->0) ? 'backedUpFlightCount'),'pending relationships do not include counts');
do $$begin perform set_config('test.request_id',public.social_get_state()->'relationships'->0->>'id',true); end$$;
select throws_ok($$select public.social_get_friend_profile('51000000-0000-0000-0000-000000000002')$$,'42501',null,'outgoing request does not authorize a count');
select throws_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','accept',current_setting('test.request_id')::uuid)$$,'42501',null,'requester cannot accept their own request');
select throws_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','decline',current_setting('test.request_id')::uuid)$$,'42501',null,'requester cannot decline as the recipient');

set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000001')->>'status','incoming','crossed invitation does not auto-accept');
select is(public.social_get_state()->'relationships'->0->>'state','incoming','recipient sees incoming state');
select throws_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','cancel',current_setting('test.request_id')::uuid)$$,'42501',null,'recipient cannot cancel as sender');
select throws_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','accept')$$,'22023',null,'accept requires the exact request identity');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','accept',current_setting('test.request_id')::uuid)$$,'recipient accepts');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','accept',current_setting('test.request_id')::uuid)$$,'accept retry is idempotent');
select is(public.social_get_state()->'relationships'->0->>'state','accepted','accepted state is visible');

set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_get_friend_profile('51000000-0000-0000-0000-000000000002'),
 '{"userId":"51000000-0000-0000-0000-000000000002","displayName":"Pilot B","username":"pilot_b","backedUpFlightCount":3}'::jsonb,
 'accepted profile contains exactly chosen identity and backed-up count');
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000002')->>'status','accepted','accepted invite retry preserves friendship');
select is((select count(*)::int from public.flights),0,'friendship grants no access to private flight rows');
select is((select count(*)::int from public.profiles),1,'friendship grants no access to private pilot profile');
select is((select count(*)::int from public.social_profiles),1,'friend name remains accessible only through the authorized RPC');
select is((select count(*)::int from storage.objects where bucket_id='flight-igc'),0,'friendship grants no IGC access');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','cancel',current_setting('test.request_id')::uuid)$$,'late cancellation safely resolves');
select is(public.social_get_state()->'relationships'->0->>'state','accepted','late cancellation does not remove an accepted friendship');

set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select public.social_save_profile('Pilot C','pilot_c',true)$$,'C creates a social profile');
select throws_ok($$select public.social_get_friend_profile('51000000-0000-0000-0000-000000000002')$$,'42501',null,'third account cannot read an accepted pair profile');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','block')$$,'unknown pair block safely resolves');
select is(public.social_get_state()->'relationships','[]'::jsonb,'arbitrary UUID block cannot become a name lookup');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','remove',current_setting('test.request_id')::uuid)$$,'third-party stale request identity safely resolves');

set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_get_state()->'relationships'->0->>'state','accepted','third party cannot remove the pair');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','remove',current_setting('test.request_id')::uuid)$$,'either accepted friend can remove');
select throws_ok($$select public.social_get_friend_profile('51000000-0000-0000-0000-000000000002')$$,'42501',null,'removal immediately revokes profile access');
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000002')->>'status','sent','removed friend needs a new invitation');
select isnt(public.social_get_state()->'relationships'->0->>'id',current_setting('test.request_id'),'new invitation has a new identity');
do $$begin perform set_config('test.new_request_id',public.social_get_state()->'relationships'->0->>'id',true); end$$;
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','cancel',current_setting('test.request_id')::uuid)$$,'old cancellation is a harmless retry');
select is(public.social_get_state()->'relationships'->0->>'id',current_setting('test.new_request_id'),'old cancellation cannot remove a newer request');
set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','accept',current_setting('test.request_id')::uuid)$$,'old acceptance is a harmless retry');
select is(public.social_get_state()->'relationships'->0->>'state','incoming','old acceptance cannot accept a newer request');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','accept',current_setting('test.new_request_id')::uuid)$$,'current request can be accepted');
set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','remove',current_setting('test.request_id')::uuid)$$,'old removal is a harmless retry');
select is(public.social_get_state()->'relationships'->0->>'state','accepted','old removal cannot remove a newer accepted friendship');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','block')$$,'accepted friend can be blocked');
select is(public.social_get_state()->'relationships'->0->>'state','blocked','blocker sees a removable block entry');
select throws_ok($$select public.social_get_friend_profile('51000000-0000-0000-0000-000000000002')$$,'42501',null,'block revokes profile access');
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000002')->>'status','unavailable','blocker cannot send until unblocking');
set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.social_get_state()->'relationships','[]'::jsonb,'blocked person does not receive a blocker identity or block status');
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000001')->>'status','unavailable','blocked account cannot send in reverse direction');
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','unblock')$$,'unblocking another owner block cannot change it');
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000001')->>'status','unavailable','only the blocker can remove their block');
set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','unblock')$$,'blocker can unblock');
select is(public.social_get_state()->'relationships','[]'::jsonb,'unblock does not recreate friendship');
select throws_ok($$select public.social_get_friend_profile('51000000-0000-0000-0000-000000000002')$$,'42501',null,'unblock alone does not authorize a count');

set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.social_save_profile('Pilot B','pilot_b_new',true)$$,'username can be edited');
set local request.jwt.claims='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_request_pilot('51000000-0000-0000-0000-000000000002')->>'status','sent','stable account identity survives username edit');
select throws_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000001','block')$$,'22023',null,'self block is invalid');
select throws_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','invented')$$,'22023',null,'unknown transition rejected');

set local role anon;
set local request.jwt.claims='{}';
select throws_ok($$select public.social_get_state()$$,'42501',null,'anonymous cannot get social state');
select throws_ok($$select public.social_save_profile('Anon','anon_pilot',true)$$,'42501',null,'anonymous cannot create a social profile');
select throws_ok($$select public.social_search_pilots('pi')$$,'42501',null,'anonymous cannot search pilots');
select throws_ok($$select public.social_request_pilot('51000000-0000-0000-0000-000000000001')$$,'42501',null,'anonymous cannot request discovery identities');
select throws_ok($$select public.social_change_relationship('51000000-0000-0000-0000-000000000002','block')$$,'42501',null,'anonymous cannot mutate relationships');
select throws_ok($$select public.social_get_friend_profile('51000000-0000-0000-0000-000000000002')$$,'42501',null,'anonymous cannot read friend profiles');
select throws_ok($$select * from public.social_profiles$$,'42501',null,'anonymous cannot enumerate social profiles');
reset role;
select * from finish();
rollback;
