-- A reaction belongs to the exact accepted friendship which authorized it.
-- Removing/blocking that friendship deletes both directions' reactions without
-- changing existing relationship RPCs, including calls from older app versions.
create table private.social_flight_kudos (
  id uuid not null unique default gen_random_uuid(),
  activity_id uuid not null references private.social_publications(id) on delete cascade,
  reactor_id uuid not null references auth.users(id) on delete cascade,
  relationship_id uuid not null references private.social_relationships(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key(activity_id,reactor_id)
);
create index social_flight_kudos_page on private.social_flight_kudos(activity_id,created_at desc,id desc);
create index social_flight_kudos_relationship on private.social_flight_kudos(relationship_id);
create index social_flight_kudos_reactor on private.social_flight_kudos(reactor_id);
alter table private.social_flight_kudos enable row level security;
revoke all on private.social_flight_kudos from public,anon,authenticated;

-- Used only after publication authorization. This snapshot predicate is shared
-- by counts and names. Do not acquire pair locks here: callers already hold a
-- flight lock, and reversing the pair -> flight order would cause deadlocks.
create function private.social_visible_kudos(p_activity uuid,p_viewer uuid)
returns table(id uuid,reactor_id uuid,display_name text,created_at timestamptz)
language sql stable set search_path='' as $$
 select k.id,k.reactor_id,s.display_name,k.created_at
 from private.social_flight_kudos k
 join private.social_publications p on p.id=k.activity_id and p.state='shared'
 join private.social_relationships r on r.id=k.relationship_id and r.state='accepted'
   and r.user_low=least(p.owner_id,k.reactor_id) and r.user_high=greatest(p.owner_id,k.reactor_id)
 join public.social_profiles s on s.user_id=k.reactor_id
 where k.activity_id=p_activity and p_viewer is not null
   and not exists(select 1 from private.social_sharing_preferences x
     where x.user_id in(p_viewer,p.owner_id,k.reactor_id) and x.account_deleting)
   and not exists(select 1 from private.social_blocks b where
     (b.blocker_id=p_viewer and b.blocked_id=k.reactor_id) or (b.blocker_id=k.reactor_id and b.blocked_id=p_viewer)
     or (b.blocker_id=p.owner_id and b.blocked_id=k.reactor_id) or (b.blocker_id=k.reactor_id and b.blocked_id=p.owner_id));
$$;
create function private.social_kudos_json(p_activity uuid,p_viewer uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('count',count(*),'givenByMe',coalesce(bool_or(reactor_id=p_viewer),false))
 from private.social_visible_kudos(p_activity,p_viewer);
$$;

-- Only an additive property changes. Existing apps discard unknown summary
-- fields; the exact-key replay artifact and its hash remain untouched.
create or replace function private.social_activity_json(p_activity uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('activityId',p.id,'author',jsonb_build_object('userId',p.owner_id,'displayName',s.display_name),
 'publishedAt',p.published_at,'title',f.title,'site',f.site,'siteSource',f.site_source,'startedAt',f.started_at,'endedAt',f.ended_at,
 'timezoneOffsetMinutes',f.timezone_offset_minutes,'status',f.status,'metrics',jsonb_build_object('durationMs',f.duration_ms,
 'trackDistanceMetres',f.track_distance_metres,'minGpsAltitude',f.min_gps_altitude,'maxGpsAltitude',f.max_gps_altitude,
 'maxGroundSpeed',f.max_ground_speed,'fixCount',f.fix_count,'quality',f.quality),'routePreview',p.route_preview,
 'provenance',p.provenance,'replayAvailable',p.replay_available,'artifact',jsonb_build_object('generation',p.artifact_generation,
 'sha256',p.artifact_sha256,'byteCount',p.artifact_bytes),'kudos',private.social_kudos_json(p.id,auth.uid()))
 from private.social_publications p join public.flights f on f.id=p.flight_id and f.user_id=p.owner_id
 join public.social_profiles s on s.user_id=p.owner_id where p.id=p_activity and p.state='shared';
$$;
create function private.social_require_kudos_publication(p_activity uuid,p_caller uuid)
returns private.social_publications language plpgsql volatile set search_path='' as $$
declare publication private.social_publications;
begin
 select * into publication from private.social_publications where id=p_activity;
 if not found or not private.social_can_read(p_caller,publication.owner_id) then
   raise exception using errcode='42501',message='This shared flight is unavailable.';
 end if;
 -- social_can_read holds the accepted pair lock before the flight lock.
 perform private.lock_flight(publication.owner_id,publication.flight_id);
 select * into publication from private.social_publications where id=p_activity;
 if not found or publication.state<>'shared' or exists(select 1 from private.social_sharing_preferences
   where user_id in(p_caller,publication.owner_id) and account_deleting) then
   raise exception using errcode='42501',message='This shared flight is unavailable.';
 end if;
 return publication;
end;
$$;
create function public.social_set_kudos(p_activity_id uuid,p_given boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); publication private.social_publications; friendship uuid;
begin
 if caller is null then raise exception using errcode='42501',message='Sign in to use kudos.'; end if;
 if p_given is null or p_activity_id is null then raise exception using errcode='22023',message='Invalid kudos request.'; end if;
 publication:=private.social_require_kudos_publication(p_activity_id,caller);
 if publication.owner_id=caller then raise exception using errcode='P0001',message='kudos_self_not_allowed'; end if;
 select id into friendship from private.social_relationships where user_low=least(caller,publication.owner_id)
   and user_high=greatest(caller,publication.owner_id) and state='accepted';
 if friendship is null then raise exception using errcode='42501',message='This shared flight is unavailable.'; end if;
 if p_given then
   insert into private.social_flight_kudos(activity_id,reactor_id,relationship_id) values(p_activity_id,caller,friendship)
     on conflict(activity_id,reactor_id) do nothing;
 else
   delete from private.social_flight_kudos where activity_id=p_activity_id and reactor_id=caller;
 end if;
 return jsonb_build_object('activityId',p_activity_id)||private.social_kudos_json(p_activity_id,caller);
exception when foreign_key_violation then
 -- A concurrent account deletion may remove a parent while its FK is checked.
 raise exception using errcode='42501',message='This shared flight is unavailable.';
end;
$$;
create function public.social_list_kudos(p_activity_id uuid,p_cursor_created_at timestamptz default null,
 p_cursor_id uuid default null,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); result jsonb;
begin
 if caller is null then raise exception using errcode='42501',message='Sign in to use kudos.'; end if;
 if p_activity_id is null or p_limit is null or p_limit not between 1 and 25
   or (p_cursor_created_at is null)<>(p_cursor_id is null) then
   raise exception using errcode='22023',message='Invalid kudos page.';
 end if;
 perform private.social_require_kudos_publication(p_activity_id,caller);
 -- All fields, including count and givenByMe, use one materialized visibility
 -- snapshot. Cursor comparison needs no surviving cursor row or reactor ID.
 with visible as materialized(select * from private.social_visible_kudos(p_activity_id,caller)),
 candidates as materialized(select * from visible where p_cursor_created_at is null
   or (created_at,id)<(p_cursor_created_at,p_cursor_id) order by created_at desc,id desc limit p_limit+1),
 page as materialized(select * from candidates order by created_at desc,id desc limit p_limit),
 last_item as(select * from page order by created_at,id limit 1)
 select jsonb_build_object('activityId',p_activity_id,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'displayName',display_name) order by created_at desc,id desc) from page),'[]'::jsonb),
   'count',(select count(*) from visible),'givenByMe',exists(select 1 from visible where reactor_id=caller),
   'nextCursor',case when (select count(*) from candidates)>p_limit then
     (select jsonb_build_object('createdAt',created_at,'id',id) from last_item) else null end) into result;
 return result;
end;
$$;
revoke all on function private.social_visible_kudos(uuid,uuid),private.social_kudos_json(uuid,uuid),
 private.social_require_kudos_publication(uuid,uuid) from public,anon,authenticated;
revoke all on function public.social_set_kudos(uuid,boolean),public.social_list_kudos(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.social_set_kudos(uuid,boolean),public.social_list_kudos(uuid,timestamptz,uuid,integer) to authenticated;
