begin;
select no_plan();
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','equipment-a@example.test'),
 ('22222222-2222-2222-2222-222222222222','equipment-b@example.test');
create function pg_temp.aircraft(p_id text,p_archived boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('id',p_id,'sport','paragliding','model','Rush 6','size','M','registrationId','D-123','archived',p_archived);
$$;
create function pg_temp.equipment_flight(p_id uuid) returns jsonb language sql as $$
 select jsonb_build_object('id',p_id,'recording_session_id',p_id,'status','completed','started_at',1000,'ended_at',2000,
  'client_created_at',1000,'client_updated_at',2000,'title','Flight','site',null,'site_source',null,'notes',null);
$$;
create function pg_temp.snapshot() returns jsonb language sql as $$
 select '{"version":1,"capturedAt":1000,"aircraftId":"aaaaaaaa-0000-0000-0000-000000000001","sport":"paragliding","model":"Rush 6","size":"M","registrationId":"D-123"}'::jsonb;
$$;
select ok((select relrowsecurity from pg_class where oid='public.private_equipment'::regclass),'inventory table has RLS');
set local role authenticated;
set local request.jwt.claims='{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.read_private_equipment(),' {"entities":[]}'::jsonb,'fresh inventory is empty without a Friends profile');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000001',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000001'),0,'aaaaaaaa-1111-1111-1111-000000000001')->>'status','applied','create aircraft without Friends identity');
select is((public.read_private_equipment()->'entities'->0->>'revision')::int,1,'server creates revision one');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000001',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000001'),0,'aaaaaaaa-1111-1111-1111-000000000001')->>'status','applied','retry returns durable success');
select is((select revision::int from public.private_equipment),1,'retry does not increment revision');
select throws_ok($$select public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000001',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000001',true),0,'aaaaaaaa-1111-1111-1111-000000000001')$$,'22023',null,'operation ID cannot be reused with changed payload');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000001',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000001')||'{"model":"Stale"}',0,'aaaaaaaa-1111-1111-1111-000000000002')->>'status','conflict','stale creation conflicts');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000001',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000001')||'{"model":"New model"}',1,'aaaaaaaa-1111-1111-1111-000000000003')->'entity'->'payload'->>'model','New model','expected revision changes one entity');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000001',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000001')||'{"model":"Stale"}',0,'aaaaaaaa-1111-1111-1111-000000000002')->'entity'->>'revision','1','conflict receipt stays idempotent after subsequent changes');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000002',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000002')||'{"sport":"hang_gliding"}',0,'aaaaaaaa-1111-1111-1111-000000000004')->>'status','applied','independent aircraft merges');
select is(public.write_private_equipment('sport','speedflying','{"sport":"speedflying","pilotIdentifier":"S-1"}',0,'aaaaaaaa-1111-1111-1111-000000000005')->>'status','applied','speedflying identity supported');
select is(public.write_private_equipment('selection','current','{"aircraftId":"aaaaaaaa-0000-0000-0000-000000000001"}',0,'aaaaaaaa-1111-1111-1111-000000000006')->>'status','applied','global current aircraft selected');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000001',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000001',true),2,'aaaaaaaa-1111-1111-1111-000000000007')->'related'->0->'payload','{"aircraftId":null}'::jsonb,'archiving atomically clears current selection');
select is((select revision::int from public.private_equipment where kind='selection'),2,'archive increments selection revision');
select is(public.write_private_equipment('selection','current','{"aircraftId":"aaaaaaaa-0000-0000-0000-000000000002"}',1,'aaaaaaaa-1111-1111-1111-000000000008')->>'status','conflict','stale selection cannot overwrite archive transition');
select throws_ok($$select public.write_private_equipment('selection','current','{"aircraftId":"aaaaaaaa-0000-0000-0000-000000000001"}',2,'aaaaaaaa-1111-1111-1111-000000000009')$$,'22023',null,'archived aircraft cannot be selected');
select is(public.write_private_equipment('selection','current','{"aircraftId":"aaaaaaaa-0000-0000-0000-000000000002"}',2,'aaaaaaaa-1111-1111-1111-000000000010')->>'status','applied','explicit reapply selects another active aircraft');
select throws_ok($$update public.private_equipment set revision=99$$,'42501',null,'direct writes cannot bypass CAS');
select throws_ok($$delete from public.private_equipment$$,'42501',null,'clients cannot remove history with direct delete');
select throws_ok($$select * from private.equipment_operations$$,'42501',null,'operation receipts are not directly exposed');
select throws_ok($$select public.write_private_equipment('sport','paragliding','{"sport":"hang_gliding","pilotIdentifier":null}',0,'aaaaaaaa-1111-1111-1111-000000000011')$$,'22023',null,'sport key and payload must match');
select throws_ok($$select public.write_private_equipment('sport','paragliding','{"sport":"paragliding","pilotIdentifier":null,"public":true}',0,'aaaaaaaa-1111-1111-1111-000000000012')$$,'22023',null,'unsupported identity fields rejected');
select throws_ok($$select public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000003',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000003')||'{"model":""}',0,'aaaaaaaa-1111-1111-1111-000000000013')$$,'22023',null,'empty model rejected');

select is((public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000010')||jsonb_build_object('equipment_snapshot',pg_temp.snapshot()))).equipment_snapshot,pg_temp.snapshot(),'new flight stores immutable equipment facts');
select is((public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000010')||'{"title":"Old client","client_updated_at":3000}')).equipment_snapshot,pg_temp.snapshot(),'old RPC payload omission preserves snapshot');
update public.flights set title='Direct legacy client',client_updated_at=4000,equipment_snapshot=null;
select is((select equipment_snapshot from public.flights),pg_temp.snapshot(),'direct legacy updates cannot clear snapshot');
select throws_ok($$select public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000010')||'{"equipment_snapshot":null}')$$,'22023',null,'modern explicit snapshot clear rejected');
select throws_ok($$select public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000010')||jsonb_build_object('equipment_snapshot',pg_temp.snapshot()||'{"model":"Replacement"}'))$$,'22023',null,'aircraft edits cannot rewrite recorded snapshot');
select is((public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000011'))).equipment_snapshot,null::jsonb,'legacy flight remains unknown');
select throws_ok($$select public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000011')||jsonb_build_object('equipment_snapshot',pg_temp.snapshot()))$$,'22023',null,'historical correction not implicitly enabled');
select is((public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000012')||'{"equipment_snapshot":{"version":1,"capturedAt":1000,"aircraftId":null,"sport":null,"model":null,"size":null,"registrationId":null}}')).equipment_snapshot->'aircraftId','null'::jsonb,'explicit no aircraft remains distinct from unknown legacy');
select throws_ok($$select public.write_private_flight(pg_temp.equipment_flight('aaaaaaaa-0000-0000-0000-000000000013')||'{"equipment_snapshot":{"version":1,"capturedAt":1000,"aircraftId":null,"sport":null,"model":"Fabricated","size":null,"registrationId":null}}')$$,'22023',null,'no aircraft cannot contain invented model');

set local request.jwt.claims='{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(jsonb_array_length(public.read_private_equipment()->'entities'),0,'B cannot read A inventory');
select is((select count(*)::int from public.private_equipment),0,'RLS hides A rows from B');
select throws_ok($$select public.write_private_equipment('selection','current','{"aircraftId":"aaaaaaaa-0000-0000-0000-000000000002"}',0,'bbbbbbbb-1111-1111-1111-000000000001')$$,'22023',null,'B cannot select A aircraft');
select is(public.write_private_equipment('aircraft','aaaaaaaa-0000-0000-0000-000000000002',pg_temp.aircraft('aaaaaaaa-0000-0000-0000-000000000002'),0,'bbbbbbbb-1111-1111-1111-000000000002')->>'status','applied','same aircraft ID in another owner namespace is independent');
select is((select count(*)::int from public.private_equipment),1,'B sees only B record');
reset role;
select is((select count(*)::int from public.private_equipment where owner_id='11111111-1111-1111-1111-111111111111'),4,'A records remain intact');
select public.social_begin_account_deletion('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select throws_ok($$select public.read_private_equipment()$$,'P0001','shared_account_deleting','deleting account inventory read is blocked');
select throws_ok($$select public.write_private_equipment('sport','paragliding','{"sport":"paragliding","pilotIdentifier":null}',0,'bbbbbbbb-1111-1111-1111-000000000003')$$,'P0001','shared_account_deleting','deleting account cannot write');
reset role;
delete from auth.users where id='22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.private_equipment where owner_id='22222222-2222-2222-2222-222222222222'),0,'account deletion cascades inventory');
select is((select count(*)::int from private.equipment_operations where owner_id='22222222-2222-2222-2222-222222222222'),0,'account deletion cascades operation receipts');
set local role anon;
select throws_ok($$select public.read_private_equipment()$$,'42501',null,'anonymous read denied');
select throws_ok($$select public.write_private_equipment('sport','paragliding','{}',0,'bbbbbbbb-1111-1111-1111-000000000003')$$,'42501',null,'anonymous write denied');
select * from finish();
rollback;
