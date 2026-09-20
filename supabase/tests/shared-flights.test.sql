begin;
select no_plan();
set local storage.allow_delete_query='true';
insert into auth.users(id,email) values
 ('61000000-0000-0000-0000-000000000001','feed-a@example.test'),
 ('61000000-0000-0000-0000-000000000002','feed-b@example.test'),
 ('61000000-0000-0000-0000-000000000003','feed-c@example.test');
insert into public.social_profiles(user_id,display_name) values
 ('61000000-0000-0000-0000-000000000001','Pilot A'),('61000000-0000-0000-0000-000000000002','Pilot B');
insert into public.flights(id,user_id,recording_session_id,status,started_at,ended_at,client_created_at,client_updated_at,
 metrics_algorithm_version,duration_ms,track_distance_metres,fix_count,quality,metrics_computed_at,title,site,notes)
select ('62000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'61000000-0000-0000-0000-000000000001',
 ('63000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'completed',1000,2000,1000,1000,3,1000,25,2,'healthy',2000,
 'Shared title','Shared site','NEVER SHARE THIS NOTE' from generate_series(1,5) i;
create function pg_temp.prepare(p_flight integer,p_operation integer,p_mode text default 'manual',p_revision integer default 0,p_generation uuid default null)
returns jsonb language sql as $$
 select public.social_prepare_share(('62000000-0000-0000-0000-'||lpad(p_flight::text,12,'0'))::uuid,
 ('64000000-0000-0000-0000-'||lpad(p_operation::text,12,'0'))::uuid,p_mode,p_generation,p_revision);
$$;
create function pg_temp.upload(p_prepared jsonb) returns jsonb language plpgsql as $$
declare reservation jsonb;
begin
 reservation:=public.social_begin_upload('61000000-0000-0000-0000-000000000001',(p_prepared->>'activityId')::uuid,(p_prepared->>'uploadToken')::uuid);
 insert into storage.objects(bucket_id,name,metadata) values('shared-flight-replays',reservation->>'objectPath','{"size":100}');
 return public.social_activate_upload('61000000-0000-0000-0000-000000000001',(p_prepared->>'activityId')::uuid,
 (p_prepared->>'uploadToken')::uuid,repeat('a',64),100,'recorded',true,'[[1,2,3,4]]');
end;
$$;
set local request.jwt.claims='{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.social_get_sharing_preferences(),'{"enabled":false,"generation":null}'::jsonb,'automatic sharing defaults off with no consent');
select is(public.social_get_my_publication('62000000-0000-0000-0000-000000000001')->>'state','private','old backed-up flights stay private');
select throws_ok($$select pg_temp.prepare(1,1,'automatic')$$,'P0001','shared_consent_changed','automatic requires current consent');
do $$begin perform set_config('test.consent',public.social_set_auto_share(true)->>'generation',true); end$$;
select is(public.social_set_auto_share(true)->>'generation',current_setting('test.consent'),'idempotent enabling preserves generation');
select is((public.social_set_auto_share(false)->>'enabled')::boolean,false,'disabling changes preference');
select isnt(public.social_set_auto_share(true)->>'generation',current_setting('test.consent'),'disable/re-enable creates a new consent generation');
select throws_ok($$select pg_temp.prepare(1,1,'automatic',0,current_setting('test.consent')::uuid)$$,'P0001','shared_consent_changed','old queued consent is invalid after re-enable');
do $$begin perform set_config('test.first',pg_temp.prepare(1,1)::text,true); end$$;
select is((current_setting('test.first')::jsonb->>'revision')::int,1,'prepare increments publication revision');
select is(pg_temp.prepare(1,1),current_setting('test.first')::jsonb,'prepare retry reuses same operation/token');
select is(public.social_get_my_publication('62000000-0000-0000-0000-000000000001')->>'state','pending','first upload remains pending');
select throws_ok($$select public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid)$$,'42501',null,'pending summary is not readable even by owner');
select is(pg_temp.upload(current_setting('test.first')::jsonb)->>'state','shared','validated activation publishes');
select is((pg_temp.prepare(1,1)->>'alreadyPublished')::boolean,true,'lost activation response is an idempotent success');
select is(public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid)->>'title','Shared title','owner reads shared projection');
select ok(not(public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid) ?| array['notes','flightId','recordingSessionId','igc_object_path']), 'projection excludes private identifiers, notes and IGC paths');
select is(public.social_set_auto_share(false)->>'enabled','false','turning auto off succeeds after publication');
select is(public.social_get_my_publication('62000000-0000-0000-0000-000000000001')->>'state','shared','turning off preserves existing publication');
-- An automatic replacement must never remove the prior active publication when
-- its consent disappears. Its own uploaded object remains cleanup work.
do $$declare consent uuid; begin
 consent:=(public.social_set_auto_share(true)->>'generation')::uuid;
 perform set_config('test.automatic',pg_temp.prepare(1,9,'automatic',1,consent)::text,true);
 perform set_config('test.auto_reservation',public.social_begin_upload('61000000-0000-0000-0000-000000000001',
 (current_setting('test.automatic')::jsonb->>'activityId')::uuid,(current_setting('test.automatic')::jsonb->>'uploadToken')::uuid)::text,true);
end$$;
insert into storage.objects(bucket_id,name,metadata) values('shared-flight-replays',current_setting('test.auto_reservation')::jsonb->>'objectPath','{"size":100}');
select is(public.social_set_auto_share(false)->>'enabled','false','disable cancels in-flight automatic replacement');
select is(public.social_get_my_publication('62000000-0000-0000-0000-000000000001')->>'state','shared','previous publication survives canceled replacement');
select is(public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid)->'artifact'->>'generation',
 '64000000-0000-0000-0000-000000000001','prior active artifact survives consent change');
select throws_ok($$select public.social_activate_upload('61000000-0000-0000-0000-000000000001',(current_setting('test.automatic')::jsonb->>'activityId')::uuid,
 (current_setting('test.automatic')::jsonb->>'uploadToken')::uuid,repeat('a',64),100,'recorded',true,'[]')$$,'P0001','shared_publication_changed','late automatic activation is fenced after disable');
select ok((select exists(select 1 from private.social_artifact_cleanup where object_path=current_setting('test.auto_reservation')::jsonb->>'objectPath')),'disabled automatic artifact has durable cleanup receipt');
select lives_ok($$select public.social_finish_failed_upload('61000000-0000-0000-0000-000000000001',(current_setting('test.automatic')::jsonb->>'activityId')::uuid,
 (current_setting('test.automatic')::jsonb->>'uploadToken')::uuid)$$,'canceled automatic upload releases its lease');
select is(pg_temp.upload(pg_temp.prepare(2,2))->>'state','shared','manual sharing works while automatic is off');
select is(jsonb_array_length(public.social_list_feed(null,null,1)->'items'),1,'feed respects bounded page size');
select ok(public.social_list_feed(null,null,1)->'nextCursor'<>'null'::jsonb,'feed supplies a cursor when more rows exist');
do $$begin perform set_config('test.page',public.social_list_feed(null,null,1)::text,true); end$$;
select is(jsonb_array_length(public.social_list_feed((current_setting('test.page')::jsonb->'nextCursor'->>'publishedAt')::timestamptz,
 (current_setting('test.page')::jsonb->'nextCursor'->>'activityId')::uuid,1)->'items'),1,'cursor reaches the remaining row without duplication');

set local role authenticated;
set local request.jwt.claims='{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(jsonb_array_length(public.social_list_feed()->'items'),0,'unrelated pilot sees no activities');
select throws_ok($$select public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid)$$,'42501',null,'unrelated pilot cannot open an activity ID');
select throws_ok($$select public.social_begin_upload('61000000-0000-0000-0000-000000000001',(current_setting('test.first')::jsonb->>'activityId')::uuid,(current_setting('test.first')::jsonb->>'uploadToken')::uuid)$$,'42501',null,'service upload bridge is not client callable');
select throws_ok($$select * from private.social_publications$$,'42501',null,'publication table is not client enumerable');
select is((select count(*)::int from storage.objects where bucket_id='shared-flight-replays'),0,'client cannot bypass Edge artifact authorization');
reset role;
insert into private.social_relationships(user_low,user_high,requester_id,state) values
 ('61000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','pending');
select is(jsonb_array_length(public.social_list_feed()->'items'),0,'pending friend receives no posts');
update private.social_relationships set state='accepted' where user_low='61000000-0000-0000-0000-000000000001';
select is(jsonb_array_length(public.social_list_feed()->'items'),2,'newly accepted friend sees all shared history');
select is(public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid)->'author'->>'displayName','Pilot A','friend receives chosen social identity');
select lives_ok($$select public.social_authorize_artifact('61000000-0000-0000-0000-000000000002',(current_setting('test.first')::jsonb->>'activityId')::uuid,'64000000-0000-0000-0000-000000000001')$$,'current friend authorized for exact generation');
select throws_ok($$select public.social_authorize_artifact('61000000-0000-0000-0000-000000000002',(current_setting('test.first')::jsonb->>'activityId')::uuid,'64000000-0000-0000-0000-000000000099')$$,'42501',null,'wrong artifact generation is denied');
insert into private.social_blocks(blocker_id,blocked_id) values('61000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002');
select is(jsonb_array_length(public.social_list_feed()->'items'),0,'owner blocking reader revokes feed');
select throws_ok($$select public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid)$$,'42501',null,'block revokes direct detail');
delete from private.social_blocks;
set local role authenticated;
select is((select count(*)::int from public.flights),0,'friend access leaves private flights inaccessible');
select is((select count(*)::int from storage.objects where bucket_id='flight-igc'),0,'friend access leaves private IGC inaccessible');
reset role;

set local request.jwt.claims='{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$begin perform set_config('test.race',pg_temp.prepare(3,3)::text,true);
 perform set_config('test.reservation',public.social_begin_upload('61000000-0000-0000-0000-000000000001',
 (current_setting('test.race')::jsonb->>'activityId')::uuid,(current_setting('test.race')::jsonb->>'uploadToken')::uuid)::text,true); end$$;
insert into storage.objects(bucket_id,name,metadata) values('shared-flight-replays',current_setting('test.reservation')::jsonb->>'objectPath','{"size":100}');
select is(public.social_hide_flight('62000000-0000-0000-0000-000000000003')->>'state','hidden','hide cancels an in-flight upload');
select throws_ok($$select public.social_activate_upload('61000000-0000-0000-0000-000000000001',(current_setting('test.race')::jsonb->>'activityId')::uuid,
 (current_setting('test.race')::jsonb->>'uploadToken')::uuid,repeat('a',64),100,'recorded',true,'[]')$$,'P0001','shared_publication_changed','late upload cannot activate after hide');
select throws_ok($$select pg_temp.prepare(3,3)$$,'P0001','shared_publication_changed','old prepare retry cannot undo hide');
select throws_ok($$select pg_temp.prepare(3,4,'manual',1)$$,'P0001','shared_publication_changed','new operation with stale revision cannot undo hide');
select lives_ok($$select pg_temp.prepare(3,4,'manual',2)$$,'explicit fresh manual request may republish');
select is(public.social_hide_flight('62000000-0000-0000-0000-000000000003')->>'revision','4','hide always revokes the latest pending revision');
select is(public.social_hide_flight('62000000-0000-0000-0000-000000000003')->>'revision','4','repeated hide is idempotent');
select ok((select count(*)>0 from private.social_artifact_cleanup),'revoked objects become durable cleanup work');
select lives_ok($$select public.social_finish_failed_upload('61000000-0000-0000-0000-000000000001',(current_setting('test.race')::jsonb->>'activityId')::uuid,
 (current_setting('test.race')::jsonb->>'uploadToken')::uuid)$$,'failed uploader releases its lease without reactivation');
select ok(jsonb_array_length(public.social_list_artifact_cleanup())>0,'inactive object cleanup can be retried');
select is(public.social_hide_flight('62000000-0000-0000-0000-000000000001')->>'state','hidden','owner can hide published activity');
select throws_ok($$select public.social_get_activity((current_setting('test.first')::jsonb->>'activityId')::uuid)$$,'42501',null,'hidden activity unavailable immediately');
delete from public.flights where id='62000000-0000-0000-0000-000000000002';
select ok((select exists(select 1 from private.social_artifact_cleanup where object_path like '%64000000-0000-0000-0000-000000000002.json')),'private flight deletion queues social artifact cleanup');
select is((select count(*)::int from private.social_publications where flight_id='62000000-0000-0000-0000-000000000002'),0,'private deletion cascades the publication');

do $$begin perform set_config('test.account',pg_temp.prepare(4,5)::text,true);
 perform set_config('test.account_reservation',public.social_begin_upload('61000000-0000-0000-0000-000000000001',
 (current_setting('test.account')::jsonb->>'activityId')::uuid,(current_setting('test.account')::jsonb->>'uploadToken')::uuid)::text,true); end$$;
select is(public.social_begin_account_deletion('61000000-0000-0000-0000-000000000001'),false,'account deletion waits for live upload reservation');
select throws_ok($$select pg_temp.prepare(5,6)$$,'P0001','shared_account_deleting','deleting account cannot reserve new uploads');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('shared-flight-replays',current_setting('test.account_reservation')::jsonb->>'objectPath','{"size":100}')$$,
 'P0001','shared_account_deleting','already-started upload cannot register a new object after deletion gate');
select lives_ok($$select public.social_finish_failed_upload('61000000-0000-0000-0000-000000000001',(current_setting('test.account')::jsonb->>'activityId')::uuid,
 (current_setting('test.account')::jsonb->>'uploadToken')::uuid)$$,'gated uploader can release lease');
select is(public.social_begin_account_deletion('61000000-0000-0000-0000-000000000001'),true,'account deletion proceeds after upload finishes');
delete from storage.objects where bucket_id='shared-flight-replays';
delete from auth.users where id='61000000-0000-0000-0000-000000000001';
select ok((select count(*)>0 from private.social_artifact_cleanup),'cleanup receipts survive account cascades');
select * from finish();
rollback;
