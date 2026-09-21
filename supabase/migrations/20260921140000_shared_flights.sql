-- Friend-visible publications are separate from the owner's private backup.
-- No client receives SELECT/INSERT on these tables or on the artifact bucket.
create table private.social_sharing_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  generation uuid,
  account_deleting boolean not null default false
);
create table private.social_publications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  flight_id uuid not null unique references public.flights(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  state text not null default 'private' check (state in ('private','pending','shared','hidden')),
  current_operation uuid,
  artifact_generation uuid,
  artifact_path text,
  artifact_sha256 text,
  artifact_bytes integer,
  provenance text check (provenance in ('recorded','igc')),
  replay_available boolean not null default false,
  route_preview jsonb not null default '[]',
  published_at timestamptz
);
create index social_publications_feed on private.social_publications(published_at desc,id desc) where state='shared';
-- Operation receipts and cleanup survive removal of the publication/account. A
-- delayed worker can never activate an object without the live parent revision.
create table private.social_uploads (
  operation_id uuid primary key,
  owner_id uuid not null,
  activity_id uuid not null,
  flight_id uuid not null,
  revision integer not null,
  mode text not null check (mode in ('automatic','manual')),
  consent_generation uuid,
  upload_token uuid not null default gen_random_uuid(),
  object_path text not null unique,
  state text not null default 'prepared' check (state in ('prepared','uploading','active','cleanup','cleaned')),
  lease_until timestamptz,
  sha256 text,
  byte_count integer,
  created_at timestamptz not null default now(),
  check (object_path = owner_id::text || '/' || activity_id::text || '-' || operation_id::text || '.json')
);
create index social_uploads_owner on private.social_uploads(owner_id);
create table private.social_artifact_cleanup (
  object_path text primary key,
  owner_id uuid not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table private.social_sharing_preferences enable row level security;
alter table private.social_publications enable row level security;
alter table private.social_uploads enable row level security;
alter table private.social_artifact_cleanup enable row level security;
revoke all on private.social_sharing_preferences,private.social_publications,private.social_uploads,
  private.social_artifact_cleanup from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('shared-flight-replays','shared-flight-replays',false,8388608,array['application/json']);

create function private.social_lock_owner(p_owner uuid) returns void language sql volatile set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social-owner:'||p_owner::text,0));
$$;
create function private.social_require_owner(p_owner uuid) returns void language plpgsql set search_path='' as $$
begin
 if p_owner is null or not exists(select 1 from auth.users where id=p_owner)
   then
   raise exception using errcode='42501',message='Sharing is unavailable for this account.';
 end if;
 if exists(select 1 from private.social_sharing_preferences where user_id=p_owner and account_deleting) then
   raise exception using errcode='P0001',message='shared_account_deleting';
 end if;
end;
$$;
create function private.social_publication_json(p_flight uuid,p_owner uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('flightId',p_flight,'activityId',p.id,'revision',coalesce(p.revision,0),'state',coalesce(p.state,'private'))
 from (select 1) seed left join private.social_publications p on p.flight_id=p_flight and p.owner_id=p_owner;
$$;
create function public.social_get_sharing_preferences() returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); result jsonb;
begin
 perform private.social_require_owner(caller);
 select jsonb_build_object('enabled',enabled,'generation',generation) into result from private.social_sharing_preferences where user_id=caller;
 return coalesce(result,'{"enabled":false,"generation":null}'::jsonb);
end;
$$;
create function public.social_set_auto_share(p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); previous_generation uuid; current_generation uuid;
begin
 perform private.social_lock_owner(caller); perform private.social_require_owner(caller);
 if p_enabled is null then raise exception using errcode='22023',message='Choose whether future flights are shared.'; end if;
 if not exists(select 1 from public.social_profiles where user_id=caller) then
   raise exception using errcode='P0001',message='shared_profile_required';
 end if;
 select generation into previous_generation from private.social_sharing_preferences where user_id=caller;
 insert into private.social_sharing_preferences(user_id,enabled,generation) values(caller,p_enabled,gen_random_uuid())
 on conflict(user_id) do update set enabled=excluded.enabled,
   generation=case when private.social_sharing_preferences.enabled is distinct from excluded.enabled then excluded.generation
     else private.social_sharing_preferences.generation end returning generation into current_generation;
 if current_generation is distinct from previous_generation then
   -- Consent changes cancel unactivated automatic work, including an upload
   -- already in flight. Published artifacts remain readable and unchanged.
   insert into private.social_artifact_cleanup(object_path,owner_id)
     select object_path,owner_id from private.social_uploads where owner_id=caller and mode='automatic'
       and state not in('active','cleaned') and (not p_enabled or consent_generation is distinct from current_generation)
     on conflict do nothing;
   update private.social_publications p set revision=p.revision+1,current_operation=null,
     state=case when p.artifact_path is not null then 'shared' else 'private' end
     from private.social_uploads u where p.current_operation=u.operation_id and u.owner_id=caller
       and u.mode='automatic' and u.state<>'active' and (not p_enabled or u.consent_generation is distinct from current_generation);
   update private.social_uploads set state='cleanup' where owner_id=caller and mode='automatic'
     and state not in('active','cleaned') and (not p_enabled or consent_generation is distinct from current_generation);
 end if;
 return public.social_get_sharing_preferences();
end;
$$;
create function public.social_get_my_publication(p_flight_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid();
begin
 perform private.social_require_owner(caller);
 if not exists(select 1 from public.flights where id=p_flight_id and user_id=caller) then
   raise exception using errcode='42501',message='This flight is unavailable.';
 end if;
 return private.social_publication_json(p_flight_id,caller);
end;
$$;
create function public.social_prepare_share(p_flight_id uuid,p_operation_id uuid,p_mode text,
 p_consent_generation uuid,p_expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); publication private.social_publications; operation private.social_uploads; flight public.flights;
begin
 perform private.social_lock_owner(caller); perform private.social_require_owner(caller);
 perform private.lock_flight(caller,p_flight_id);
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or p_mode is null or p_mode not in('automatic','manual') then
   raise exception using errcode='22023',message='Invalid publication request.';
 end if;
 if not exists(select 1 from public.social_profiles where user_id=caller) then
   raise exception using errcode='P0001',message='shared_profile_required';
 end if;
 select * into flight from public.flights where id=p_flight_id and user_id=caller;
 if not found or flight.status not in('completed','partial') or flight.ended_at is null or flight.metrics_algorithm_version is null
   or flight.duration_ms is null or flight.track_distance_metres is null or flight.fix_count is null
   or flight.quality is null or flight.metrics_computed_at is null then
   raise exception using errcode='P0001',message='shared_flight_not_ready';
 end if;
 select * into publication from private.social_publications where flight_id=p_flight_id and owner_id=caller;
 select * into operation from private.social_uploads where operation_id=p_operation_id;
 if found then
   if operation.owner_id<>caller or operation.flight_id<>p_flight_id or operation.mode<>p_mode
      or operation.consent_generation is distinct from p_consent_generation
      or publication.current_operation is distinct from operation.operation_id or publication.revision<>operation.revision
      or publication.state='hidden' or operation.state in('cleanup','cleaned') then
     raise exception using errcode='P0001',message='shared_publication_changed';
   end if;
   -- A successful publication remains shared when automatic sharing is disabled.
   if operation.state='active' then
     return jsonb_build_object('activityId',publication.id,'revision',publication.revision,'uploadToken',operation.upload_token,'alreadyPublished',true);
   end if;
 end if;
 if p_mode='automatic' and not exists(select 1 from private.social_sharing_preferences
   where user_id=caller and enabled and generation=p_consent_generation) then
   raise exception using errcode='P0001',message='shared_consent_changed';
 end if;
 if operation.operation_id is not null then
   return jsonb_build_object('activityId',publication.id,'revision',publication.revision,'uploadToken',operation.upload_token,'alreadyPublished',false);
 end if;
 if coalesce(publication.revision,0)<>p_expected_revision or (p_mode='automatic' and publication.state='hidden') then
   raise exception using errcode='P0001',message='shared_publication_changed';
 end if;
 if publication.id is null then
   insert into private.social_publications(owner_id,flight_id) values(caller,p_flight_id) returning * into publication;
 end if;
 if publication.current_operation is not null then
   insert into private.social_artifact_cleanup(object_path,owner_id)
     select object_path,owner_id from private.social_uploads where operation_id=publication.current_operation and state<>'active'
     on conflict do nothing;
   update private.social_uploads set state='cleanup' where operation_id=publication.current_operation and state<>'active';
 end if;
 update private.social_publications set revision=revision+1,current_operation=p_operation_id,
   state=case when state='shared' then 'shared' else 'pending' end where id=publication.id returning * into publication;
 insert into private.social_uploads(operation_id,owner_id,activity_id,flight_id,revision,mode,consent_generation,object_path)
   values(p_operation_id,caller,publication.id,p_flight_id,publication.revision,p_mode,p_consent_generation,
     caller::text||'/'||publication.id::text||'-'||p_operation_id::text||'.json') returning * into operation;
 return jsonb_build_object('activityId',publication.id,'revision',publication.revision,'uploadToken',operation.upload_token,'alreadyPublished',false);
end;
$$;
create function public.social_hide_flight(p_flight_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); publication private.social_publications;
begin
 perform private.social_lock_owner(caller); perform private.social_require_owner(caller); perform private.lock_flight(caller,p_flight_id);
 if not exists(select 1 from public.flights where id=p_flight_id and user_id=caller) then
   raise exception using errcode='42501',message='This flight is unavailable.';
 end if;
 insert into private.social_publications(owner_id,flight_id,state,revision) values(caller,p_flight_id,'hidden',1)
 on conflict(flight_id) do update set state='hidden',revision=private.social_publications.revision+
   case when private.social_publications.state='hidden' then 0 else 1 end,
   current_operation=null,artifact_generation=null,artifact_path=null,artifact_sha256=null,artifact_bytes=null,route_preview='[]',replay_available=false
 returning * into publication;
 insert into private.social_artifact_cleanup(object_path,owner_id)
   select object_path,owner_id from private.social_uploads where activity_id=publication.id and state<>'cleaned' on conflict do nothing;
 update private.social_uploads set state='cleanup' where activity_id=publication.id and state<>'cleaned';
 return private.social_publication_json(p_flight_id,caller);
end;
$$;

-- Service-role-only Edge bridge. The endpoint verifies the bearer token and
-- supplies its owner, never an owner ID from the incoming body.
create function public.social_begin_upload(p_owner uuid,p_activity_id uuid,p_upload_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare publication private.social_publications; operation private.social_uploads; flight public.flights;
begin
 perform private.social_lock_owner(p_owner); perform private.social_require_owner(p_owner);
 select * into publication from private.social_publications where id=p_activity_id and owner_id=p_owner;
 if not found then raise exception using errcode='42501',message='This publication is unavailable.'; end if;
 perform private.lock_flight(p_owner,publication.flight_id);
 select * into publication from private.social_publications where id=p_activity_id and owner_id=p_owner;
 select * into operation from private.social_uploads where operation_id=publication.current_operation and upload_token=p_upload_token;
 if not found or publication.state='hidden' or operation.state in('cleanup','cleaned') or publication.revision<>operation.revision then
   raise exception using errcode='P0001',message='shared_publication_changed';
 end if;
 if operation.state='active' then return jsonb_build_object('alreadyPublished',true,'publication',private.social_publication_json(publication.flight_id,p_owner)); end if;
 if operation.mode='automatic' and not exists(select 1 from private.social_sharing_preferences
   where user_id=p_owner and enabled and generation=operation.consent_generation) then
   raise exception using errcode='P0001',message='shared_consent_changed';
 end if;
 if operation.lease_until>clock_timestamp() then raise exception using errcode='P0001',message='shared_upload_busy'; end if;
 select * into flight from public.flights where id=publication.flight_id and user_id=p_owner;
 if not found then raise exception using errcode='42501',message='This flight is unavailable.'; end if;
 -- Longer than the hosted Edge maximum 400s wall-clock lifetime. A crashed
 -- worker cannot leave deletion blocked forever; object registration is gated too.
 update private.social_uploads set state='uploading',lease_until=clock_timestamp()+interval '10 minutes' where operation_id=operation.operation_id;
 return jsonb_build_object('alreadyPublished',false,'operationId',operation.operation_id,'objectPath',operation.object_path,
   'startedAt',flight.started_at,'endedAt',flight.ended_at,'partial',flight.status='partial');
end;
$$;
create function public.social_activate_upload(p_owner uuid,p_activity_id uuid,p_upload_token uuid,
 p_sha256 text,p_byte_count integer,p_provenance text,p_replay_available boolean,p_route_preview jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare publication private.social_publications; operation private.social_uploads;
begin
 perform private.social_lock_owner(p_owner); perform private.social_require_owner(p_owner);
 select * into publication from private.social_publications where id=p_activity_id and owner_id=p_owner;
 if not found then raise exception using errcode='42501',message='This publication is unavailable.'; end if;
 perform private.lock_flight(p_owner,publication.flight_id);
 select * into publication from private.social_publications where id=p_activity_id and owner_id=p_owner;
 select * into operation from private.social_uploads where operation_id=publication.current_operation and upload_token=p_upload_token;
 if not found or publication.state='hidden' or operation.state not in('uploading','active') or publication.revision<>operation.revision then
   raise exception using errcode='P0001',message='shared_publication_changed';
 end if;
 if operation.state='active' then return private.social_publication_json(publication.flight_id,p_owner); end if;
 if operation.mode='automatic' and not exists(select 1 from private.social_sharing_preferences
   where user_id=p_owner and enabled and generation=operation.consent_generation) then
   raise exception using errcode='P0001',message='shared_consent_changed';
 end if;
 if operation.lease_until is null or operation.lease_until<=clock_timestamp() or p_sha256 is null or p_byte_count is null
   or p_provenance is null or p_replay_available is null or p_route_preview is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_byte_count not between 1 and 8388608
   or p_provenance not in('recorded','igc') or jsonb_typeof(p_route_preview)<>'array'
   or not exists(select 1 from storage.objects where bucket_id='shared-flight-replays' and name=operation.object_path) then
   raise exception using errcode='22023',message='The shared route could not be verified.';
 end if;
 if publication.artifact_path is not null and publication.artifact_path<>operation.object_path then
   insert into private.social_artifact_cleanup(object_path,owner_id) values(publication.artifact_path,p_owner) on conflict do nothing;
   update private.social_uploads set state='cleanup' where object_path=publication.artifact_path;
 end if;
 update private.social_publications set state='shared',artifact_generation=operation.operation_id,artifact_path=operation.object_path,
   artifact_sha256=p_sha256,artifact_bytes=p_byte_count,provenance=p_provenance,replay_available=p_replay_available,
   route_preview=p_route_preview,published_at=coalesce(published_at,clock_timestamp()) where id=publication.id;
 update private.social_uploads set state='active',lease_until=null,sha256=p_sha256,byte_count=p_byte_count where operation_id=operation.operation_id;
 return private.social_publication_json(publication.flight_id,p_owner);
end;
$$;
create function public.social_finish_failed_upload(p_owner uuid,p_activity_id uuid,p_upload_token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare operation private.social_uploads;
begin
 perform private.social_lock_owner(p_owner);
 select * into operation from private.social_uploads where owner_id=p_owner and activity_id=p_activity_id and upload_token=p_upload_token;
 if not found or operation.state='active' then return; end if;
 update private.social_uploads set lease_until=null,state=case when state='uploading' then 'prepared' else state end where operation_id=operation.operation_id;
 -- The same immutable path may be retried. Cleanup is claimed only when no
 -- current publication can still activate it; an uploaded retry reuses its bytes.
 if not exists(select 1 from private.social_publications where id=p_activity_id and current_operation=operation.operation_id and state<>'hidden')
   or exists(select 1 from private.social_sharing_preferences where user_id=p_owner and account_deleting) then
   insert into private.social_artifact_cleanup(object_path,owner_id) values(operation.object_path,p_owner) on conflict do nothing;
   update private.social_uploads set state='cleanup' where operation_id=operation.operation_id;
 end if;
end;
$$;

create function private.social_can_read(p_caller uuid,p_owner uuid) returns boolean language plpgsql volatile set search_path='' as $$
begin
 if p_caller is null or not exists(select 1 from auth.users where id=p_caller)
   or exists(select 1 from private.social_sharing_preferences where user_id in(p_caller,p_owner) and account_deleting) then return false; end if;
 if p_caller=p_owner then return true; end if;
 perform private.social_lock_pair(p_caller,p_owner);
 return exists(select 1 from private.social_relationships where user_low=least(p_caller,p_owner)
   and user_high=greatest(p_caller,p_owner) and state='accepted')
   and not exists(select 1 from private.social_blocks where
     (blocker_id=p_caller and blocked_id=p_owner) or (blocker_id=p_owner and blocked_id=p_caller));
end;
$$;
create function private.social_activity_json(p_activity uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('activityId',p.id,'author',jsonb_build_object('userId',p.owner_id,'displayName',s.display_name),
 'publishedAt',p.published_at,'title',f.title,'site',f.site,'siteSource',f.site_source,'startedAt',f.started_at,'endedAt',f.ended_at,
 'timezoneOffsetMinutes',f.timezone_offset_minutes,'status',f.status,'metrics',jsonb_build_object('durationMs',f.duration_ms,
 'trackDistanceMetres',f.track_distance_metres,'minGpsAltitude',f.min_gps_altitude,'maxGpsAltitude',f.max_gps_altitude,
 'maxGroundSpeed',f.max_ground_speed,'fixCount',f.fix_count,'quality',f.quality),'routePreview',p.route_preview,
 'provenance',p.provenance,'replayAvailable',p.replay_available,'artifact',jsonb_build_object('generation',p.artifact_generation,
 'sha256',p.artifact_sha256,'byteCount',p.artifact_bytes))
 from private.social_publications p join public.flights f on f.id=p.flight_id and f.user_id=p.owner_id
 join public.social_profiles s on s.user_id=p.owner_id where p.id=p_activity and p.state='shared';
$$;
create function public.social_get_activity(p_activity_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); publication private.social_publications; result jsonb;
begin
 select * into publication from private.social_publications where id=p_activity_id;
 if not found or not private.social_can_read(caller,publication.owner_id) then
   raise exception using errcode='42501',message='This shared flight is unavailable.';
 end if;
 perform private.lock_flight(publication.owner_id,publication.flight_id);
 result:=private.social_activity_json(p_activity_id);
 if result is null then raise exception using errcode='42501',message='This shared flight is unavailable.'; end if;
 return result;
end;
$$;
create function public.social_list_feed(p_cursor_published_at timestamptz default null,p_cursor_activity_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); candidate record; item jsonb; items jsonb:='[]'; last_item jsonb; more boolean:=false;
begin
 perform private.social_require_owner(caller);
 if p_limit is null or p_limit not between 1 and 50 or (p_cursor_published_at is null)<>(p_cursor_activity_id is null) then
   raise exception using errcode='22023',message='Invalid feed page.';
 end if;
 -- Lock accepted pairs in deterministic order before taking the fresh feed
 -- snapshot. A concurrent removal/block cannot authorize an old joined row.
 for candidate in select case when user_low=caller then user_high else user_low end as owner_id
   from private.social_relationships where caller in(user_low,user_high) and state='accepted' order by 1 loop
   perform private.social_lock_pair(caller,candidate.owner_id);
 end loop;
 for candidate in select p.id,p.owner_id,p.flight_id from private.social_publications p
   where p.state='shared' and (p.owner_id=caller or exists(select 1 from private.social_relationships r
     where r.user_low=least(caller,p.owner_id) and r.user_high=greatest(caller,p.owner_id) and r.state='accepted'))
   and (p_cursor_published_at is null or (p.published_at,p.id)<(p_cursor_published_at,p_cursor_activity_id))
   order by p.published_at desc,p.id desc loop
   if not private.social_can_read(caller,candidate.owner_id) then continue; end if;
   perform private.lock_flight(candidate.owner_id,candidate.flight_id);
   item:=private.social_activity_json(candidate.id);
   if item is null then continue; end if;
   if jsonb_array_length(items)=p_limit then more:=true; exit; end if;
   items:=items||jsonb_build_array(item); last_item:=item;
 end loop;
 return jsonb_build_object('items',items,'nextCursor',case when more then
   jsonb_build_object('publishedAt',last_item->>'publishedAt','activityId',last_item->>'activityId') else null end);
end;
$$;
create function public.social_authorize_artifact(p_caller uuid,p_activity_id uuid,p_generation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare publication private.social_publications;
begin
 select * into publication from private.social_publications where id=p_activity_id;
 if not found or not private.social_can_read(p_caller,publication.owner_id) then
   raise exception using errcode='42501',message='This shared route is unavailable.';
 end if;
 perform private.lock_flight(publication.owner_id,publication.flight_id);
 select * into publication from private.social_publications where id=p_activity_id;
 if not found or publication.state<>'shared' or publication.artifact_generation is distinct from p_generation then
   raise exception using errcode='42501',message='This shared route is unavailable.';
 end if;
 return jsonb_build_object('objectPath',publication.artifact_path,'sha256',publication.artifact_sha256,'byteCount',publication.artifact_bytes);
end;
$$;

create function private.social_queue_deleted_artifacts() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.social_artifact_cleanup(object_path,owner_id)
   select object_path,owner_id from private.social_uploads where activity_id=old.id and state<>'cleaned' on conflict do nothing;
 update private.social_uploads set state='cleanup' where activity_id=old.id and state<>'cleaned';
 return old;
end;
$$;
create trigger social_publication_cleanup before delete on private.social_publications
 for each row execute function private.social_queue_deleted_artifacts();
create function public.social_list_artifact_cleanup(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- Recover abandoned uploads. Prepared operations without a live object may
 -- retry normally; inactive paths remain durable cleanup work.
 insert into private.social_artifact_cleanup(object_path,owner_id)
 select u.object_path,u.owner_id from private.social_uploads u where u.state<>'cleaned'
 and (u.lease_until is null or u.lease_until<clock_timestamp())
 and (not exists(select 1 from private.social_publications p where p.id=u.activity_id and
      (p.artifact_path=u.object_path or (p.current_operation=u.operation_id and p.state<>'hidden')))
   or not exists(select 1 from auth.users where id=u.owner_id)
   or exists(select 1 from private.social_sharing_preferences where user_id=u.owner_id and account_deleting)) on conflict do nothing;
 return (select coalesce(jsonb_agg(jsonb_build_object('objectPath',q.object_path,'ownerId',q.owner_id)),'[]') from
   (select c.* from private.social_artifact_cleanup c left join private.social_uploads u on u.object_path=c.object_path
    where (u.lease_until is null or u.lease_until<clock_timestamp())
      and not exists(select 1 from private.social_publications p where p.state='shared' and p.artifact_path=c.object_path)
    order by c.queued_at,c.object_path limit least(greatest(p_limit,1),100)) q);
end;
$$;
create function public.social_ack_artifact_cleanup(p_object_path text,p_removed boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_removed then
   delete from private.social_artifact_cleanup where object_path=p_object_path;
   update private.social_uploads set state='cleaned',lease_until=null where object_path=p_object_path and state<>'active';
 else update private.social_artifact_cleanup set attempts=attempts+1 where object_path=p_object_path; end if;
end;
$$;
create function public.social_begin_account_deletion(p_owner uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform private.social_lock_owner(p_owner);
 if not exists(select 1 from auth.users where id=p_owner) then return true; end if;
 insert into private.social_sharing_preferences(user_id,account_deleting) values(p_owner,true)
   on conflict(user_id) do update set account_deleting=true,enabled=false,generation=gen_random_uuid();
 -- Refuse final account cleanup while a worker may still register an object.
 return not exists(select 1 from private.social_uploads where owner_id=p_owner and lease_until>clock_timestamp());
end;
$$;
create function private.social_guard_artifact_storage() returns trigger language plpgsql security definer set search_path='' as $$
declare operation private.social_uploads;
begin
 if new.bucket_id<>'shared-flight-replays' then return new; end if;
 select * into operation from private.social_uploads where object_path=new.name;
 if not found then raise exception using errcode='42501',message='No shared upload reservation.'; end if;
 perform private.social_lock_owner(operation.owner_id); perform private.social_require_owner(operation.owner_id);
 select * into operation from private.social_uploads where object_path=new.name;
 if operation.state<>'uploading' or operation.lease_until<=clock_timestamp() then
   raise exception using errcode='42501',message='This shared upload reservation expired.';
 end if;
 return new;
end;
$$;
create trigger shared_flight_object_guard before insert or update on storage.objects
 for each row execute function private.social_guard_artifact_storage();

revoke all on function private.social_lock_owner(uuid),private.social_require_owner(uuid),
 private.social_publication_json(uuid,uuid),private.social_can_read(uuid,uuid),private.social_activity_json(uuid),
 private.social_queue_deleted_artifacts(),private.social_guard_artifact_storage() from public,anon,authenticated;
revoke all on function public.social_get_sharing_preferences(),public.social_set_auto_share(boolean),
 public.social_get_my_publication(uuid),public.social_prepare_share(uuid,uuid,text,uuid,integer),public.social_hide_flight(uuid),
 public.social_get_activity(uuid),public.social_list_feed(timestamptz,uuid,integer) from public,anon;
grant execute on function public.social_get_sharing_preferences(),public.social_set_auto_share(boolean),
 public.social_get_my_publication(uuid),public.social_prepare_share(uuid,uuid,text,uuid,integer),public.social_hide_flight(uuid),
 public.social_get_activity(uuid),public.social_list_feed(timestamptz,uuid,integer) to authenticated;
revoke all on function public.social_begin_upload(uuid,uuid,uuid),public.social_activate_upload(uuid,uuid,uuid,text,integer,text,boolean,jsonb),
 public.social_finish_failed_upload(uuid,uuid,uuid),public.social_authorize_artifact(uuid,uuid,uuid),
 public.social_list_artifact_cleanup(integer),public.social_ack_artifact_cleanup(text,boolean),public.social_begin_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.social_begin_upload(uuid,uuid,uuid),public.social_activate_upload(uuid,uuid,uuid,text,integer,text,boolean,jsonb),
 public.social_finish_failed_upload(uuid,uuid,uuid),public.social_authorize_artifact(uuid,uuid,uuid),
 public.social_list_artifact_cleanup(integer),public.social_ack_artifact_cleanup(text,boolean),public.social_begin_account_deletion(uuid) to service_role;
