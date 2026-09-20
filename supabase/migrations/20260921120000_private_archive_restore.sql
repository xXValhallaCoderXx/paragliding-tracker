-- Private archive restoration. A deleted identity is durable until account deletion;
-- it can never be recreated by an older phone coming back online.
alter table public.flights add column site_source text
  constraint flights_site_source_valid check (site_source is null or site_source in ('paraglidingearth', 'osm', 'manual'));

create table public.private_flight_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  flight_id uuid not null,
  recording_session_id uuid,
  deleted_at timestamptz not null default now(),
  storage_object_path text not null,
  storage_cleanup_pending boolean not null default true,
  storage_cleanup_attempts integer not null default 0 check (storage_cleanup_attempts >= 0),
  storage_cleanup_last_error text,
  storage_cleaned_at timestamptz,
  primary key (user_id, flight_id),
  constraint private_flight_deletion_path check (storage_object_path = user_id::text || '/' || flight_id::text || '.igc')
);
create index private_flight_deletions_cursor on public.private_flight_deletions(user_id, deleted_at, flight_id);
create index private_flight_deletions_object on public.private_flight_deletions(user_id, storage_object_path);
alter table public.private_flight_deletions enable row level security;
revoke all on public.private_flight_deletions from anon, authenticated;
grant select on public.private_flight_deletions to authenticated;
create policy private_flight_deletions_select_own on public.private_flight_deletions
  for select to authenticated using (user_id = (select auth.uid()));

-- Internal functions are outside the exposed public RPC schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.lock_flight(p_owner uuid, p_flight uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text || ':' || p_flight::text, 0));
$$;
revoke all on function private.lock_flight(uuid, uuid) from public, anon, authenticated;

-- This trigger also protects old clients which still perform direct upserts.
-- The RPC sets a transaction-local flag solely to distinguish explicit site-source
-- input from legacy clients which never knew that column existed.
create function private.guard_flight_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.user_id <> old.user_id or new.recording_session_id <> old.recording_session_id) then
    raise exception using errcode = '42501', message = 'A flight identity cannot be reassigned.';
  end if;
  perform private.lock_flight(new.user_id, new.id);
  if exists (select 1 from public.private_flight_deletions where user_id = new.user_id and flight_id = new.id) then
    raise exception using errcode = 'PFL01', message = 'This flight was deleted everywhere.';
  end if;
  if tg_op = 'UPDATE' then
    if new.client_updated_at <= old.client_updated_at then
      new.title := old.title;
      new.site := old.site;
      new.site_source := old.site_source;
      new.notes := old.notes;
      new.client_updated_at := old.client_updated_at;
    elsif new.site is distinct from old.site and coalesce(current_setting('app.private_flight_write', true), '') <> '1' then
      new.site_source := null;
    end if;
  end if;
  if new.site is null then new.site_source := null; end if;
  return new;
end;
$$;
revoke all on function private.guard_flight_write() from public, anon, authenticated;
create trigger flights_guard_private_write before insert or update on public.flights
  for each row execute function private.guard_flight_write();

create function private.mark_individual_flight_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Account deletion is a separate action: the auth parent is already absent
  -- during its cascade, and it must not tell phones to erase their logbooks.
  if auth.uid() = old.user_id and auth.role() = 'authenticated'
     and exists (select 1 from auth.users where id = old.user_id) then
    if old.status not in ('completed', 'partial') then
      raise exception using errcode = '22023', message = 'Only saved flights can be deleted everywhere.';
    end if;
    perform private.lock_flight(old.user_id, old.id);
    insert into public.private_flight_deletions(user_id, flight_id, recording_session_id, storage_object_path)
    values (old.user_id, old.id, old.recording_session_id, old.user_id::text || '/' || old.id::text || '.igc')
    on conflict (user_id, flight_id) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function private.mark_individual_flight_delete() from public, anon, authenticated;
create trigger flights_mark_individual_delete before delete on public.flights
  for each row execute function private.mark_individual_flight_delete();

-- p_metadata_only=true requires the complete editable bundle; omitted fields are
-- not interpreted as clears. The normal backup payload keeps its existing shape.
create function public.write_private_flight(p_flight jsonb, p_metadata_only boolean default false)
returns public.flights language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  incoming public.flights;
  stored public.flights;
  previous_flag text := coalesce(current_setting('app.private_flight_write', true), '');
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'Sign in to sync private flights.'; end if;
  if jsonb_typeof(p_flight) is distinct from 'object' or not (p_flight ?& array['id','title','site','site_source','notes','client_updated_at']) then
    raise exception using errcode = '22023', message = 'A complete flight metadata bundle is required.';
  end if;
  if exists (select 1 from jsonb_object_keys(p_flight) as k where
    (p_metadata_only and k not in ('id','user_id','title','site','site_source','notes','client_updated_at'))
    or k not in ('id','user_id','recording_session_id','status','started_at','ended_at','timezone_offset_minutes','title','site','site_source','notes','client_created_at','client_updated_at','device_platform','recorder_schema_version','metrics_algorithm_version','duration_ms','track_distance_metres','min_gps_altitude','max_gps_altitude','max_ground_speed','fix_count','median_source_gap_ms','p95_source_gap_ms','max_source_gap_ms','quality','metrics_computed_at','igc_object_path','igc_sha256','igc_byte_count','igc_artifact_version')) then
    raise exception using errcode = '22023', message = 'Unsupported flight fields.';
  end if;
  if exists (select 1 from jsonb_each(p_flight) where key in ('title','site','site_source','notes') and jsonb_typeof(value) not in ('string','null'))
    or jsonb_typeof(p_flight->'client_updated_at') <> 'number' then
    raise exception using errcode = '22023', message = 'Invalid flight metadata types.';
  end if;
  incoming := jsonb_populate_record(null::public.flights, p_flight);
  if incoming.id is null or incoming.client_updated_at is null or incoming.client_updated_at < 0 then
    raise exception using errcode = '22023', message = 'Invalid flight identity or edit timestamp.';
  end if;
  if p_flight ? 'user_id' and incoming.user_id is distinct from owner_id then
    raise exception using errcode = '42501', message = 'Flight access denied.';
  end if;
  perform private.lock_flight(owner_id, incoming.id);
  if exists (select 1 from public.private_flight_deletions where user_id = owner_id and flight_id = incoming.id) then
    raise exception using errcode = 'PFL01', message = 'This flight was deleted everywhere.';
  end if;
  select * into stored from public.flights where id = incoming.id for update;
  if found and stored.user_id <> owner_id then
    raise exception using errcode = '42501', message = 'Flight access denied.';
  end if;
  if p_metadata_only and stored.id is null then
    raise exception using errcode = 'PFL02', message = 'The archived flight is no longer available.';
  end if;
  perform set_config('app.private_flight_write', '1', true);
  if p_metadata_only then
    update public.flights set title = incoming.title, site = incoming.site, site_source = incoming.site_source,
      notes = incoming.notes, client_updated_at = incoming.client_updated_at
    where id = incoming.id and user_id = owner_id returning * into stored;
  else
    if incoming.status not in ('completed','partial') or incoming.status is null then
      raise exception using errcode = '22023', message = 'Only saved flights can be backed up.';
    end if;
    if incoming.igc_object_path is not null and incoming.igc_object_path <> owner_id::text || '/' || incoming.id::text || '.igc' then
      raise exception using errcode = '22023', message = 'Invalid private IGC path.';
    end if;
    insert into public.flights (
      id,user_id,recording_session_id,status,started_at,ended_at,timezone_offset_minutes,
      title,site,site_source,notes,client_created_at,client_updated_at,device_platform,recorder_schema_version,
      metrics_algorithm_version,duration_ms,track_distance_metres,min_gps_altitude,max_gps_altitude,max_ground_speed,
      fix_count,median_source_gap_ms,p95_source_gap_ms,max_source_gap_ms,quality,metrics_computed_at,
      igc_object_path,igc_sha256,igc_byte_count,igc_artifact_version
    ) values (
      incoming.id,owner_id,incoming.recording_session_id,incoming.status,incoming.started_at,incoming.ended_at,incoming.timezone_offset_minutes,
      incoming.title,incoming.site,incoming.site_source,incoming.notes,incoming.client_created_at,incoming.client_updated_at,incoming.device_platform,incoming.recorder_schema_version,
      incoming.metrics_algorithm_version,incoming.duration_ms,incoming.track_distance_metres,incoming.min_gps_altitude,incoming.max_gps_altitude,incoming.max_ground_speed,
      incoming.fix_count,incoming.median_source_gap_ms,incoming.p95_source_gap_ms,incoming.max_source_gap_ms,incoming.quality,incoming.metrics_computed_at,
      incoming.igc_object_path,incoming.igc_sha256,incoming.igc_byte_count,incoming.igc_artifact_version
    ) on conflict (id) do update set
      recording_session_id = excluded.recording_session_id, status = excluded.status, started_at = excluded.started_at,
      ended_at = excluded.ended_at, timezone_offset_minutes = excluded.timezone_offset_minutes,
      title = excluded.title, site = excluded.site, site_source = excluded.site_source, notes = excluded.notes,
      client_updated_at = excluded.client_updated_at, device_platform = excluded.device_platform,
      recorder_schema_version = excluded.recorder_schema_version, metrics_algorithm_version = excluded.metrics_algorithm_version,
      duration_ms = excluded.duration_ms, track_distance_metres = excluded.track_distance_metres,
      min_gps_altitude = excluded.min_gps_altitude, max_gps_altitude = excluded.max_gps_altitude,
      max_ground_speed = excluded.max_ground_speed, fix_count = excluded.fix_count,
      median_source_gap_ms = excluded.median_source_gap_ms, p95_source_gap_ms = excluded.p95_source_gap_ms,
      max_source_gap_ms = excluded.max_source_gap_ms, quality = excluded.quality, metrics_computed_at = excluded.metrics_computed_at,
      igc_object_path = case when p_flight ? 'igc_object_path' then excluded.igc_object_path else public.flights.igc_object_path end,
      igc_sha256 = case when p_flight ? 'igc_sha256' then excluded.igc_sha256 else public.flights.igc_sha256 end,
      igc_byte_count = case when p_flight ? 'igc_byte_count' then excluded.igc_byte_count else public.flights.igc_byte_count end,
      igc_artifact_version = case when p_flight ? 'igc_artifact_version' then excluded.igc_artifact_version else public.flights.igc_artifact_version end
    where public.flights.user_id = owner_id returning * into stored;
    if stored.id is null then raise exception using errcode = '42501', message = 'Flight access denied.'; end if;
  end if;
  perform set_config('app.private_flight_write', previous_flag, true);
  return stored;
end;
$$;
revoke all on function public.write_private_flight(jsonb, boolean) from public, anon;
grant execute on function public.write_private_flight(jsonb, boolean) to authenticated;

create function public.delete_private_flight(p_flight_id uuid)
returns public.private_flight_deletions language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  stored public.flights;
  marker public.private_flight_deletions;
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'Sign in to delete private flights.'; end if;
  if p_flight_id is null then raise exception using errcode = '22023', message = 'A flight ID is required.'; end if;
  perform private.lock_flight(owner_id, p_flight_id);
  select * into stored from public.flights where id = p_flight_id for update;
  if found and stored.user_id <> owner_id then raise exception using errcode = '42501', message = 'Flight access denied.'; end if;
  if stored.id is not null and stored.status not in ('completed','partial') then
    raise exception using errcode = '22023', message = 'Only saved flights can be deleted everywhere.';
  end if;
  insert into public.private_flight_deletions(user_id,flight_id,recording_session_id,storage_object_path)
  values (owner_id,p_flight_id,stored.recording_session_id,owner_id::text || '/' || p_flight_id::text || '.igc')
  on conflict (user_id,flight_id) do nothing;
  delete from public.flights where id = p_flight_id and user_id = owner_id;
  select * into marker from public.private_flight_deletions where user_id = owner_id and flight_id = p_flight_id;
  return marker;
end;
$$;
revoke all on function public.delete_private_flight(uuid) from public, anon;
grant execute on function public.delete_private_flight(uuid) to authenticated;

-- Cleanup uses the Storage API, never SQL DELETE on storage.objects (which would
-- orphan the actual file). A successful acknowledgement verifies its absence.
create function public.acknowledge_private_flight_cleanup(p_flight_id uuid, p_error text default null)
returns public.private_flight_deletions language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  marker public.private_flight_deletions;
  failure text := nullif(left(p_error, 1000), '');
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'Sign in to finish private archive cleanup.'; end if;
  perform private.lock_flight(owner_id, p_flight_id);
  select * into marker from public.private_flight_deletions where user_id = owner_id and flight_id = p_flight_id for update;
  if not found then raise exception using errcode = 'PFL02', message = 'The deletion receipt was not found.'; end if;
  if failure is null and exists (select 1 from storage.objects where bucket_id = 'flight-igc' and name = marker.storage_object_path) then
    failure := 'The archived file still exists. Retry cleanup.';
  end if;
  update public.private_flight_deletions set
    storage_cleanup_pending = failure is not null,
    storage_cleanup_attempts = storage_cleanup_attempts + 1,
    storage_cleanup_last_error = failure,
    storage_cleaned_at = case when failure is null then now() else null end
  where user_id = owner_id and flight_id = p_flight_id returning * into marker;
  return marker;
end;
$$;
revoke all on function public.acknowledge_private_flight_cleanup(uuid,text) from public, anon;
grant execute on function public.acknowledge_private_flight_cleanup(uuid,text) to authenticated;

-- VOLATILE gives the post-lock check a fresh snapshot. Storage uploads and the
-- deletion RPC therefore cannot both commit a newly readable deleted object.
create function private.can_write_flight_object(p_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  file_id text := split_part(p_name, '/', 2);
begin
  if owner_id is null or split_part(p_name, '/', 1) <> owner_id::text then return false; end if;
  if p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.igc$' then
    perform private.lock_flight(owner_id, left(file_id, 36)::uuid);
  end if;
  return not exists (select 1 from public.private_flight_deletions where user_id = owner_id and storage_object_path = p_name);
end;
$$;
revoke all on function private.can_write_flight_object(text) from public, anon;
grant execute on function private.can_write_flight_object(text) to authenticated;

drop policy flight_igc_select_own on storage.objects;
create policy flight_igc_select_own on storage.objects for select to authenticated using (
  bucket_id = 'flight-igc' and (storage.foldername(name))[1] = (select auth.uid())::text and (
    not exists (select 1 from public.private_flight_deletions d where d.user_id = (select auth.uid()) and d.storage_object_path = name)
    -- remove() needs SELECT as well as DELETE. Storage sets this operation GUC;
    -- ordinary downloads/listing cannot use this cleanup-only exception.
    or current_setting('storage.operation', true) in ('storage.object.delete','object.delete','storage.object.delete_many','object.delete_many')
  )
);
drop policy flight_igc_insert_own on storage.objects;
create policy flight_igc_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'flight-igc' and private.can_write_flight_object(name));
drop policy flight_igc_update_own on storage.objects;
create policy flight_igc_update_own on storage.objects for update to authenticated
  using (bucket_id = 'flight-igc' and private.can_write_flight_object(name))
  with check (bucket_id = 'flight-igc' and private.can_write_flight_object(name));
-- The existing owner-only DELETE policy deliberately remains usable for cleanup.
