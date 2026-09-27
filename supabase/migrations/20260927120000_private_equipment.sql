-- Private aircraft are independent of Friends and of the legacy device pilot profile.
create table public.private_equipment (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('aircraft','sport','selection')),
  entity_key text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id,kind,entity_key)
);
alter table public.private_equipment enable row level security;
revoke all on public.private_equipment from public,anon,authenticated;
grant select on public.private_equipment to authenticated;
create policy private_equipment_select_own on public.private_equipment for select to authenticated
  using (owner_id = (select auth.uid()));

create table private.equipment_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  primary key(owner_id,operation_id)
);
revoke all on private.equipment_operations from public,anon,authenticated;

create function private.equipment_json(p_row public.private_equipment) returns jsonb
language sql immutable set search_path='' as $$
  select case when p_row.owner_id is null then null else jsonb_build_object(
    'kind',p_row.kind,'key',p_row.entity_key,'payload',p_row.payload,'revision',p_row.revision) end;
$$;

create function private.equipment_nullable_text(p_value jsonb,p_key text,p_max integer) returns boolean
language sql immutable set search_path='' as $$
  select p_value ? p_key and (p_value->p_key='null'::jsonb or
    (jsonb_typeof(p_value->p_key)='string' and char_length(p_value->>p_key)<=p_max));
$$;
create function private.validate_equipment_payload(p_kind text,p_key text,p_payload jsonb) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_kind is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode='22023',message='Invalid equipment record.';
  end if;
  if p_kind='aircraft' then
    if p_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or not (p_payload ?& array['id','sport','model','size','registrationId','archived'])
      or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','sport','model','size','registrationId','archived'))
      or p_payload->>'id' is distinct from p_key
      or coalesce(p_payload->>'sport','') not in ('paragliding','hang_gliding','speedflying')
      or jsonb_typeof(p_payload->'model') is distinct from 'string'
      or char_length(btrim(p_payload->>'model')) not between 1 and 60
      or char_length(p_payload->>'model')>60
      or not private.equipment_nullable_text(p_payload,'size',20)
      or not private.equipment_nullable_text(p_payload,'registrationId',30)
      or jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then
      raise exception using errcode='22023',message='Invalid aircraft details.';
    end if;
  elsif p_kind='sport' then
    if p_key not in ('paragliding','hang_gliding','speedflying') or p_payload->>'sport' is distinct from p_key
      or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('sport','pilotIdentifier'))
      or not private.equipment_nullable_text(p_payload,'pilotIdentifier',30) then
      raise exception using errcode='22023',message='Invalid sport identity.';
    end if;
  elsif p_kind='selection' then
    if p_key<>'current' or not private.equipment_nullable_text(p_payload,'aircraftId',36)
      or exists(select 1 from jsonb_object_keys(p_payload) k where k<>'aircraftId') then
      raise exception using errcode='22023',message='Invalid current aircraft.';
    end if;
  else raise exception using errcode='22023',message='Unsupported equipment record.';
  end if;
end;
$$;

create function public.read_private_equipment() returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); result jsonb;
begin
  perform private.social_require_owner(caller);
  select coalesce(jsonb_agg(private.equipment_json(e) order by e.kind,e.entity_key),'[]'::jsonb)
    into result from public.private_equipment e where e.owner_id=caller;
  return jsonb_build_object('entities',result);
end;
$$;

create function public.write_private_equipment(p_kind text,p_key text,p_payload jsonb,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); stored public.private_equipment; selection public.private_equipment;
  receipt private.equipment_operations; request jsonb; response jsonb; related jsonb:='[]'::jsonb;
begin
  -- The same owner lock as account deletion also serializes selection/archive changes.
  perform private.social_lock_owner(caller);
  perform private.social_require_owner(caller);
  if p_operation_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception using errcode='22023',message='Invalid equipment operation.';
  end if;
  request:=jsonb_build_object('kind',p_kind,'key',p_key,'payload',p_payload,'expectedRevision',p_expected_revision);
  select * into receipt from private.equipment_operations where owner_id=caller and operation_id=p_operation_id;
  if found then
    if receipt.request<>request then raise exception using errcode='22023',message='An operation ID cannot be reused for another edit.'; end if;
    return receipt.response;
  end if;
  perform private.validate_equipment_payload(p_kind,p_key,p_payload);
  select * into stored from public.private_equipment where owner_id=caller and kind=p_kind and entity_key=p_key for update;
  if coalesce(stored.revision,0)<>p_expected_revision then
    response:=jsonb_build_object('status','conflict','entity',private.equipment_json(stored),'related',related);
  else
    if p_kind='selection' and p_payload->>'aircraftId' is not null and not exists(
      select 1 from public.private_equipment where owner_id=caller and kind='aircraft'
        and entity_key=p_payload->>'aircraftId' and payload->>'archived'='false') then
      raise exception using errcode='22023',message='Choose an active aircraft from this inventory.';
    end if;
    insert into public.private_equipment(owner_id,kind,entity_key,payload,revision)
      values(caller,p_kind,p_key,p_payload,p_expected_revision+1)
      on conflict(owner_id,kind,entity_key) do update set payload=excluded.payload,revision=excluded.revision,updated_at=clock_timestamp()
      returning * into stored;
    if p_kind='aircraft' and p_payload->>'archived'='true' then
      update public.private_equipment set payload=jsonb_build_object('aircraftId',null),revision=revision+1,updated_at=clock_timestamp()
        where owner_id=caller and kind='selection' and entity_key='current' and payload->>'aircraftId'=p_key returning * into selection;
      if found then related:=jsonb_build_array(private.equipment_json(selection)); end if;
    end if;
    response:=jsonb_build_object('status','applied','entity',private.equipment_json(stored),'related',related);
  end if;
  insert into private.equipment_operations values(caller,p_operation_id,request,response);
  return response;
end;
$$;
revoke all on function private.equipment_json(public.private_equipment) from public,anon,authenticated;
revoke all on function private.equipment_nullable_text(jsonb,text,integer),private.validate_equipment_payload(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.read_private_equipment(),public.write_private_equipment(text,text,jsonb,bigint,uuid) from public,anon;
grant execute on function public.read_private_equipment(),public.write_private_equipment(text,text,jsonb,bigint,uuid) to authenticated;

-- A frozen snapshot belongs to the private flight, not to the mutable inventory.
alter table public.flights add column equipment_snapshot jsonb;
create function private.validate_equipment_snapshot(p_value jsonb) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_value is null or p_value='null'::jsonb then return; end if;
  if jsonb_typeof(p_value) is distinct from 'object'
    or not (p_value ?& array['version','capturedAt','aircraftId','sport','model','size','registrationId'])
    or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('version','capturedAt','aircraftId','sport','model','size','registrationId'))
    or p_value->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_value->'capturedAt') is distinct from 'number' then
    raise exception using errcode='22023',message='Invalid flight equipment snapshot.';
  end if;
  if (p_value->>'capturedAt')::numeric not between 0 and 9007199254740991
    or trunc((p_value->>'capturedAt')::numeric)<>(p_value->>'capturedAt')::numeric then
    raise exception using errcode='22023',message='Invalid equipment capture time.';
  end if;
  if p_value->'aircraftId'='null'::jsonb then
    if exists(select 1 from jsonb_each(p_value) where key in ('sport','model','size','registrationId') and value<>'null'::jsonb) then
      raise exception using errcode='22023',message='Unselected aircraft has no equipment details.';
    end if;
  else
    perform private.validate_equipment_payload('aircraft',p_value->>'aircraftId',jsonb_build_object(
      'id',p_value->'aircraftId','sport',p_value->'sport','model',p_value->'model','size',p_value->'size',
      'registrationId',p_value->'registrationId','archived',false));
  end if;
end;
$$;

create function private.guard_equipment_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare supplied text:=nullif(current_setting('app.equipment_snapshot',true),'');
begin
  if tg_op='INSERT' then
    if supplied is not null then new.equipment_snapshot:=nullif(supplied::jsonb,'null'::jsonb); end if;
    perform private.validate_equipment_snapshot(new.equipment_snapshot);
  else
    -- Also protects direct upserts from older clients which know no snapshot field.
    new.equipment_snapshot:=old.equipment_snapshot;
  end if;
  return new;
end;
$$;
create trigger flights_equipment_snapshot before insert or update on public.flights
  for each row execute function private.guard_equipment_snapshot();

-- Preserve the proven existing write/deletion rules; a wrapper adds the new field.
alter function public.write_private_flight(jsonb,boolean) set schema private;
alter function private.write_private_flight(jsonb,boolean) rename to write_private_flight_without_equipment;
revoke all on function private.write_private_flight_without_equipment(jsonb,boolean) from public,anon,authenticated;
create function public.write_private_flight(p_flight jsonb,p_metadata_only boolean default false)
returns public.flights language plpgsql security definer set search_path='' as $$
declare previous text:=coalesce(current_setting('app.equipment_snapshot',true),''); stored public.flights;
begin
  if p_flight ? 'equipment_snapshot' then
    if p_metadata_only then raise exception using errcode='22023',message='Flight equipment corrections are not supported.'; end if;
    perform private.validate_equipment_snapshot(p_flight->'equipment_snapshot');
    if auth.uid() is null then raise exception using errcode='42501',message='Sign in to sync private flights.'; end if;
    perform private.lock_flight(auth.uid(),(p_flight->>'id')::uuid);
    select * into stored from public.flights where id=(p_flight->>'id')::uuid;
    if found and stored.user_id<>auth.uid() then raise exception using errcode='42501',message='Flight access denied.'; end if;
    if found and stored.equipment_snapshot is distinct from nullif(p_flight->'equipment_snapshot','null'::jsonb) then
      raise exception using errcode='22023',message='Recorded flight equipment cannot be changed.';
    end if;
    perform set_config('app.equipment_snapshot',(p_flight->'equipment_snapshot')::text,true);
  else perform set_config('app.equipment_snapshot','',true);
  end if;
  stored:=private.write_private_flight_without_equipment(p_flight-'equipment_snapshot',p_metadata_only);
  perform set_config('app.equipment_snapshot',previous,true);
  return stored;
end;
$$;
revoke all on function private.validate_equipment_snapshot(jsonb),private.guard_equipment_snapshot() from public,anon,authenticated;
revoke all on function public.write_private_flight(jsonb,boolean) from public,anon;
grant execute on function public.write_private_flight(jsonb,boolean) to authenticated;
