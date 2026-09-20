-- Replace invitation codes without recreating any profile, relationship,
-- publication or reaction identity. Existing pilots explicitly claim a username.
alter table public.social_profiles
  add column username text,
  add column discoverable boolean not null default false,
  add constraint social_profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  add constraint social_profiles_username_unique unique(username),
  add constraint social_profiles_discovery_complete check (not discoverable or username is not null);
create extension if not exists pg_trgm with schema extensions;
create index social_profiles_username_search on public.social_profiles(username text_pattern_ops)
  where discoverable and username is not null;
create index social_profiles_name_search on public.social_profiles using gin(lower(display_name) extensions.gin_trgm_ops)
  where discoverable and username is not null;
create table private.social_search_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count between 1 and 61)
);
alter table private.social_search_limits enable row level security;
revoke all on private.social_search_limits from public,anon,authenticated;

-- All discovery writes take owner locks in UUID order BEFORE a pair lock.
-- Profile visibility edits and account-deletion admission use those same owner
-- locks. No new path acquires an owner lock after holding a pair/flight lock.
create function private.social_lock_discovery_pair(p_first uuid,p_second uuid)
returns void language plpgsql volatile set search_path='' as $$
begin
 perform private.social_lock_owner(least(p_first,p_second));
 if p_first<>p_second then perform private.social_lock_owner(greatest(p_first,p_second)); end if;
 perform private.social_lock_pair(p_first,p_second);
end;
$$;
create function private.social_require_discovery_owner(p_owner uuid)
returns void language plpgsql volatile set search_path='' as $$
begin
 perform private.social_require_owner(p_owner);
 if not exists(select 1 from public.social_profiles where user_id=p_owner and username is not null) then
   raise exception using errcode='22023',message='Choose your name and username before finding pilots.';
 end if;
end;
$$;
create or replace function private.social_profile_json(p_user_id uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('userId',p.user_id,'displayName',p.display_name,'username',p.username,
   'backedUpFlightCount',(select count(*) from public.flights f where f.user_id=p.user_id
     and f.status in('completed','partial') and f.metrics_algorithm_version is not null
     and f.duration_ms is not null and f.track_distance_metres is not null and f.fix_count is not null
     and f.quality is not null and f.metrics_computed_at is not null))
 from public.social_profiles p where p.user_id=p_user_id
   and not exists(select 1 from private.social_sharing_preferences x where x.user_id=p.user_id and x.account_deleting);
$$;
create or replace function public.social_get_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); relationships jsonb; own_profile jsonb;
begin
 perform private.social_require_owner(caller);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'userId',r.other_id,'displayName',p.display_name,
   'username',p.username,'state',r.state) order by p.display_name,r.other_id),'[]'::jsonb)
 into relationships from (
   select f.id,case when f.user_low=caller then f.user_high else f.user_low end as other_id,
     case when f.state='accepted' then 'accepted' when f.requester_id=caller then 'outgoing' else 'incoming' end as state
   from private.social_relationships f where caller in(f.user_low,f.user_high)
     and not exists(select 1 from private.social_blocks b where
       (b.blocker_id=f.user_low and b.blocked_id=f.user_high) or (b.blocker_id=f.user_high and b.blocked_id=f.user_low))
   union all select b.id,b.blocked_id,'blocked' from private.social_blocks b where b.blocker_id=caller
 ) r join public.social_profiles p on p.user_id=r.other_id
 where not exists(select 1 from private.social_sharing_preferences x where x.user_id=r.other_id and x.account_deleting);
 own_profile:=private.social_profile_json(caller);
 if own_profile is not null then
   own_profile:=own_profile||jsonb_build_object('discoverable',(select discoverable from public.social_profiles where user_id=caller));
 end if;
 return jsonb_build_object('profile',own_profile,'relationships',relationships);
end;
$$;
drop function public.social_save_profile(text);
create function public.social_save_profile(p_display_name text,p_username text,p_discoverable boolean)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); chosen_name text:=btrim(regexp_replace(p_display_name,'[[:space:]]+',' ','g'));
 chosen_username text:=lower(btrim(p_username));
begin
 perform private.social_lock_owner(caller); perform private.social_require_owner(caller);
 if chosen_name is null or char_length(chosen_name) not between 1 and 60
   or chosen_username is null or chosen_username !~ '^[a-z0-9_]{3,24}$' or p_discoverable is null then
   raise exception using errcode='22023',message='Choose a name, a valid username and a search preference.';
 end if;
 -- The unique constraint arbitrates simultaneous claims; expose SQLSTATE 23505.
 insert into public.social_profiles(user_id,display_name,username,discoverable)
 values(caller,chosen_name,chosen_username,p_discoverable)
 on conflict(user_id) do update set display_name=excluded.display_name,username=excluded.username,
   discoverable=excluded.discoverable,updated_at=now();
end;
$$;

create function public.social_search_pilots(p_query text,p_cursor jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); normalized text; term text; escaped text; username_only boolean;
 attempts integer; attempted_at timestamptz:=clock_timestamp(); result jsonb;
 cursor_rank integer; cursor_username text; cursor_user uuid;
begin
 perform private.social_require_discovery_owner(caller);
 if p_query is null or octet_length(p_query)>512 then
   raise exception using errcode='22023',message='Search using between 2 and 60 characters.';
 end if;
 normalized:=lower(btrim(regexp_replace(p_query,'[[:space:]]+',' ','g')));
 username_only:=left(normalized,1)='@';
 term:=case when username_only then substr(normalized,2) else normalized end;
 if char_length(term) not between 2 and 60 then
   raise exception using errcode='22023',message='Search using between 2 and 60 characters.';
 end if;
 if p_cursor is not null then
   if jsonb_typeof(p_cursor)<>'object' or not(p_cursor ?& array['query','rank','username','userId']) then
     raise exception using errcode='22023',message='Invalid pilot search cursor.';
   end if;
   if (select count(*) from jsonb_object_keys(p_cursor))<>4
     or jsonb_typeof(p_cursor->'query')<>'string' or p_cursor->>'query' is distinct from normalized
     or p_cursor->'rank' not in('0'::jsonb,'1'::jsonb)
     or jsonb_typeof(p_cursor->'username')<>'string' or (p_cursor->>'username') !~ '^[a-z0-9_]{3,24}$'
     or jsonb_typeof(p_cursor->'userId')<>'string'
     or (p_cursor->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
     raise exception using errcode='22023',message='Invalid pilot search cursor.';
   end if;
   cursor_rank:=(p_cursor->>'rank')::numeric::integer; cursor_username:=p_cursor->>'username'; cursor_user:=(p_cursor->>'userId')::uuid;
 end if;
 insert into private.social_search_limits(user_id,window_started_at,attempt_count) values(caller,attempted_at,1)
 on conflict(user_id) do update set
   window_started_at=case when private.social_search_limits.window_started_at<=attempted_at-interval '1 minute'
     then attempted_at else private.social_search_limits.window_started_at end,
   attempt_count=case when private.social_search_limits.window_started_at<=attempted_at-interval '1 minute'
     then 1 else least(private.social_search_limits.attempt_count+1,61) end returning attempt_count into attempts;
 if attempts>60 then return jsonb_build_object('status','rate_limited','items','[]'::jsonb,'nextCursor',null); end if;
 -- Escape a dedicated LIKE escape character too: %, _ and ! are literal input.
 escaped:=replace(replace(replace(term,'!','!!'),'%','!%'),'_','!_');
 with candidates as materialized(
   select p.user_id,p.display_name,p.username,case when p.username=term then 0 else 1 end as rank,
     r.id as relationship_id,case when r.id is null then 'none' when r.state='accepted' then 'accepted'
       when r.requester_id=caller then 'outgoing' else 'incoming' end as relationship_state
   from public.social_profiles p left join private.social_relationships r
     on r.user_low=least(caller,p.user_id) and r.user_high=greatest(caller,p.user_id)
   where p.user_id<>caller and p.discoverable and p.username is not null
     and (p.username like escaped||'%' escape '!' or
       (not username_only and lower(p.display_name) like '%'||escaped||'%' escape '!'))
     and not exists(select 1 from private.social_blocks b where
       (b.blocker_id=caller and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=caller))
     and not exists(select 1 from private.social_sharing_preferences x where x.user_id in(caller,p.user_id) and x.account_deleting)
 ), remaining as materialized(
   select * from candidates where p_cursor is null or (rank,username collate "C",user_id)>(cursor_rank,cursor_username collate "C",cursor_user)
   order by rank,username collate "C",user_id limit 21
 ), page as materialized(select * from remaining order by rank,username collate "C",user_id limit 20)
 select jsonb_build_object('status','ok','items',coalesce((select jsonb_agg(
   jsonb_build_object('userId',user_id,'displayName',display_name,'username',username,'relationshipId',relationship_id,'relationshipState',relationship_state)
   order by rank,username collate "C",user_id) from page),'[]'::jsonb),
   'nextCursor',case when (select count(*) from remaining)>20 then
     (select jsonb_build_object('query',normalized,'rank',rank,'username',username,'userId',user_id)
       from page order by rank desc,username collate "C" desc,user_id desc limit 1) else null end) into result;
 return result;
end;
$$;

create function public.social_request_pilot(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); attempts integer; attempted_at timestamptz:=clock_timestamp(); relationship private.social_relationships;
begin
 perform private.social_require_discovery_owner(caller);
 -- Expected failures return a status so their rate counter remains committed.
 insert into private.social_request_limits(user_id,window_started_at,attempt_count) values(caller,attempted_at,1)
 on conflict(user_id) do update set
   window_started_at=case when private.social_request_limits.window_started_at<=attempted_at-interval '10 minutes'
     then attempted_at else private.social_request_limits.window_started_at end,
   attempt_count=case when private.social_request_limits.window_started_at<=attempted_at-interval '10 minutes'
     then 1 else least(private.social_request_limits.attempt_count+1,21) end returning attempt_count into attempts;
 if attempts>20 then return jsonb_build_object('status','rate_limited'); end if;
 if p_user_id is null or p_user_id=caller then return jsonb_build_object('status','unavailable'); end if;
 perform private.social_lock_discovery_pair(caller,p_user_id);
 if not exists(select 1 from public.social_profiles where user_id=p_user_id)
   or exists(select 1 from private.social_sharing_preferences where user_id in(caller,p_user_id) and account_deleting)
   or exists(select 1 from private.social_blocks where
     (blocker_id=caller and blocked_id=p_user_id) or (blocker_id=p_user_id and blocked_id=caller)) then
   return jsonb_build_object('status','unavailable');
 end if;
 select * into relationship from private.social_relationships
   where user_low=least(caller,p_user_id) and user_high=greatest(caller,p_user_id);
 if found then return jsonb_build_object('status',case when relationship.state='accepted' then 'accepted'
   when relationship.requester_id=caller then 'outgoing' else 'incoming' end); end if;
 if not exists(select 1 from public.social_profiles where user_id=p_user_id and discoverable and username is not null) then
   return jsonb_build_object('status','unavailable');
 end if;
 begin
   insert into private.social_relationships(user_low,user_high,requester_id,state)
     values(least(caller,p_user_id),greatest(caller,p_user_id),caller,'pending');
 exception when foreign_key_violation then return jsonb_build_object('status','unavailable');
 end;
 return jsonb_build_object('status','sent');
end;
$$;

create function public.social_block_pilot(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid();
begin
 perform private.social_require_discovery_owner(caller);
 if p_user_id is null or p_user_id=caller then
   raise exception using errcode='42501',message='This pilot is unavailable.';
 end if;
 perform private.social_lock_discovery_pair(caller,p_user_id);
 perform private.social_require_owner(caller);
 if not exists(select 1 from public.social_profiles where user_id=p_user_id)
   or exists(select 1 from private.social_sharing_preferences where user_id=p_user_id and account_deleting) then
   raise exception using errcode='42501',message='This pilot is unavailable.';
 end if;
 if exists(select 1 from private.social_blocks where blocker_id=caller and blocked_id=p_user_id) then return; end if;
 if exists(select 1 from private.social_blocks where blocker_id=p_user_id and blocked_id=caller)
   or not(exists(select 1 from private.social_relationships where user_low=least(caller,p_user_id) and user_high=greatest(caller,p_user_id))
     or exists(select 1 from public.social_profiles where user_id=p_user_id and discoverable and username is not null)) then
   raise exception using errcode='42501',message='This pilot is unavailable.';
 end if;
 insert into private.social_blocks(blocker_id,blocked_id) values(caller,p_user_id) on conflict do nothing;
 delete from private.social_relationships where user_low=least(caller,p_user_id) and user_high=greatest(caller,p_user_id);
end;
$$;

-- Legacy profiles can still manage existing connections while choosing a
-- username. Hiding either pilot never destroys or prevents accepting that pair.
create or replace function public.social_change_relationship(p_other_user_id uuid,p_action text,p_request_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); relationship private.social_relationships;
begin
 perform private.social_require_owner(caller);
 if p_other_user_id is null or p_other_user_id=caller or p_action is null
   or p_action not in('accept','decline','cancel','remove','block','unblock') then
   raise exception using errcode='22023',message='Invalid friendship action.';
 end if;
 if p_action in('accept','decline','cancel','remove') and p_request_id is null then
   raise exception using errcode='22023',message='Refresh this friendship before trying again.';
 end if;
 perform private.social_lock_discovery_pair(caller,p_other_user_id);
 perform private.social_require_owner(caller);
 if exists(select 1 from private.social_sharing_preferences where user_id=p_other_user_id and account_deleting) then
   raise exception using errcode='42501',message='This pilot is unavailable.';
 end if;
 if p_action='unblock' then delete from private.social_blocks where blocker_id=caller and blocked_id=p_other_user_id; return; end if;
 select * into relationship from private.social_relationships where user_low=least(caller,p_other_user_id) and user_high=greatest(caller,p_other_user_id);
 if p_action='block' then
   if relationship.id is null and not exists(select 1 from private.social_blocks where blocker_id=caller and blocked_id=p_other_user_id) then return; end if;
   insert into private.social_blocks(blocker_id,blocked_id) values(caller,p_other_user_id) on conflict do nothing;
   delete from private.social_relationships where user_low=least(caller,p_other_user_id) and user_high=greatest(caller,p_other_user_id);
   return;
 end if;
 if relationship.id is null or relationship.id<>p_request_id then return; end if;
 if exists(select 1 from private.social_blocks where
   (blocker_id=caller and blocked_id=p_other_user_id) or (blocker_id=p_other_user_id and blocked_id=caller)) then return; end if;
 if p_action in('accept','decline') and relationship.requester_id=caller or p_action='cancel' and relationship.requester_id<>caller then
   raise exception using errcode='42501',message='This action belongs to the other pilot.';
 end if;
 if p_action='accept' then update private.social_relationships set state='accepted' where id=relationship.id;
 elsif p_action in('decline','cancel') then delete from private.social_relationships where id=relationship.id and state='pending';
 elsif p_action='remove' then delete from private.social_relationships where id=relationship.id and state='accepted'; end if;
end;
$$;
create or replace function public.social_get_friend_profile(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); profile jsonb;
begin
 if caller is null or p_user_id is null or p_user_id=caller then
   raise exception using errcode='42501',message='This pilot profile is unavailable.';
 end if;
 perform private.social_lock_discovery_pair(caller,p_user_id);
 if exists(select 1 from private.social_sharing_preferences where user_id in(caller,p_user_id) and account_deleting)
   or not exists(select 1 from private.social_relationships where user_low=least(caller,p_user_id)
     and user_high=greatest(caller,p_user_id) and state='accepted')
   or exists(select 1 from private.social_blocks where
     (blocker_id=caller and blocked_id=p_user_id) or (blocker_id=p_user_id and blocked_id=caller)) then
   raise exception using errcode='42501',message='This pilot profile is unavailable.';
 end if;
 profile:=private.social_profile_json(p_user_id);
 if profile is null then raise exception using errcode='42501',message='This pilot profile is unavailable.'; end if;
 return profile;
end;
$$;

-- Explicitly remove the obsolete product surface. Nothing references these
-- identities from friendships, shared flights or kudos; no CASCADE is needed.
drop function public.social_request_friend(text);
drop function public.social_rotate_invite_code();
drop function private.social_new_code();
drop table private.social_invites;
revoke all on function private.social_lock_discovery_pair(uuid,uuid),private.social_require_discovery_owner(uuid) from public,anon,authenticated;
revoke all on function public.social_save_profile(text,text,boolean),public.social_search_pilots(text,jsonb),
 public.social_request_pilot(uuid),public.social_block_pilot(uuid) from public,anon;
grant execute on function public.social_save_profile(text,text,boolean),public.social_search_pilots(text,jsonb),
 public.social_request_pilot(uuid),public.social_block_pilot(uuid) to authenticated;
