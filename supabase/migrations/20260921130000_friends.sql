-- Friends v1 exposes a chosen name and an aggregate only. The private pilot
-- profile, flights, archive bucket and their owner-only policies stay unchanged.
create table public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60
    and display_name = btrim(regexp_replace(display_name, '[[:space:]]+', ' ', 'g'))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.social_profiles enable row level security;
revoke all on public.social_profiles from public, anon, authenticated;
grant select on public.social_profiles to authenticated;
create policy social_profiles_select_own on public.social_profiles for select to authenticated
  using (user_id = (select auth.uid()));

-- These tables have no client grants or policies. Even an accepted friend may
-- not enumerate names, invite codes, relationships or another pilot's count.
create table private.social_invites (
  user_id uuid primary key references public.social_profiles(user_id) on delete cascade,
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{12}$')
);
create table private.social_relationships (
  id uuid not null unique default gen_random_uuid(),
  user_low uuid not null references public.social_profiles(user_id) on delete cascade,
  user_high uuid not null references public.social_profiles(user_id) on delete cascade,
  requester_id uuid not null references public.social_profiles(user_id) on delete cascade,
  state text not null check (state in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high),
  check (requester_id in (user_low, user_high))
);
create index social_relationships_high on private.social_relationships(user_high);
create table private.social_blocks (
  id uuid not null unique default gen_random_uuid(),
  blocker_id uuid not null references public.social_profiles(user_id) on delete cascade,
  blocked_id uuid not null references public.social_profiles(user_id) on delete cascade,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index social_blocks_blocked on private.social_blocks(blocked_id);
create table private.social_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count between 1 and 21)
);
alter table private.social_invites enable row level security;
alter table private.social_relationships enable row level security;
alter table private.social_blocks enable row level security;
alter table private.social_request_limits enable row level security;
revoke all on private.social_invites, private.social_relationships, private.social_blocks,
  private.social_request_limits from public, anon, authenticated;

create function private.social_lock_pair(p_first uuid, p_second uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'social:' || least(p_first, p_second)::text || ':' || greatest(p_first, p_second)::text, 0));
$$;

create function private.social_new_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  random_bytes bytea := extensions.gen_random_bytes(12);
  result text := '';
begin
  for position in 0..11 loop
    result := result || substr(alphabet, (get_byte(random_bytes, position) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

-- Match the archive summary's metrics completeness predicate. Partial/no-track
-- summaries count; IGC presence and download state are intentionally irrelevant.
create function private.social_profile_json(p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('userId', p.user_id, 'displayName', p.display_name,
    'backedUpFlightCount', (select count(*) from public.flights f
      where f.user_id = p.user_id and f.status in ('completed', 'partial')
        and f.metrics_algorithm_version is not null and f.duration_ms is not null
        and f.track_distance_metres is not null and f.fix_count is not null
        and f.quality is not null and f.metrics_computed_at is not null))
  from public.social_profiles p where p.user_id = p_user_id;
$$;

create function public.social_get_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); relationships jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Sign in to use Friends.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'userId', r.other_id,
    'displayName', p.display_name, 'state', r.state) order by p.display_name, r.other_id), '[]'::jsonb)
  into relationships from (
    select f.id, case when f.user_low = caller then f.user_high else f.user_low end as other_id,
      case when f.state = 'accepted' then 'accepted'
        when f.requester_id = caller then 'outgoing' else 'incoming' end as state
    from private.social_relationships f where caller in (f.user_low, f.user_high)
      and not exists (select 1 from private.social_blocks b
        where (b.blocker_id = f.user_low and b.blocked_id = f.user_high)
          or (b.blocker_id = f.user_high and b.blocked_id = f.user_low))
    union all
    select b.id, b.blocked_id, 'blocked' from private.social_blocks b where b.blocker_id = caller
  ) r join public.social_profiles p on p.user_id = r.other_id;
  return jsonb_build_object('profile', private.social_profile_json(caller),
    'inviteCode', (select code from private.social_invites where user_id = caller),
    'relationships', relationships);
end;
$$;

create function public.social_save_profile(p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); chosen_name text := btrim(regexp_replace(p_display_name, '[[:space:]]+', ' ', 'g'));
begin
  if caller is null then raise exception using errcode = '42501', message = 'Sign in to use Friends.'; end if;
  if chosen_name is null or char_length(chosen_name) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'Choose a display name between 1 and 60 characters.';
  end if;
  -- This row lock also serializes initial code creation with edits/rotation.
  insert into public.social_profiles(user_id, display_name) values (caller, chosen_name)
    on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();
  if not exists (select 1 from private.social_invites where user_id = caller) then
    loop
      begin
        insert into private.social_invites(user_id, code) values (caller, private.social_new_code());
        exit;
      exception when unique_violation then null;
      end;
    end loop;
  end if;
end;
$$;

create function public.social_rotate_invite_code()
returns text language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); next_code text; previous_code text;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Sign in to use Friends.'; end if;
  -- NO KEY UPDATE remains compatible with the relationship FK's key-share lock.
  perform 1 from public.social_profiles where user_id = caller for no key update;
  if not found then raise exception using errcode = '22023', message = 'Set up your pilot profile first.'; end if;
  select code into previous_code from private.social_invites where user_id = caller;
  loop
    next_code := private.social_new_code();
    if next_code = previous_code then continue; end if;
    begin
      insert into private.social_invites(user_id, code) values (caller, next_code)
        on conflict (user_id) do update set code = excluded.code;
      return next_code;
    exception when unique_violation then null;
    end;
  end loop;
end;
$$;

create function public.social_request_friend(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); target uuid; normalized text; attempts integer;
  attempted_at timestamptz := clock_timestamp(); relationship private.social_relationships;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Sign in to use Friends.'; end if;
  if not exists (select 1 from public.social_profiles where user_id = caller) then
    raise exception using errcode = '22023', message = 'Set up your pilot profile first.';
  end if;
  -- All attempts share one locked row. Failed lookups RETURN (never RAISE), so
  -- PostgREST commits their rate counter instead of rolling it back with an error.
  insert into private.social_request_limits(user_id, window_started_at, attempt_count)
    values (caller, attempted_at, 1)
    on conflict (user_id) do update set
      window_started_at = case when private.social_request_limits.window_started_at <= attempted_at - interval '10 minutes'
        then attempted_at else private.social_request_limits.window_started_at end,
      attempt_count = case when private.social_request_limits.window_started_at <= attempted_at - interval '10 minutes'
        then 1 else least(private.social_request_limits.attempt_count + 1, 21) end
    returning attempt_count into attempts;
  if attempts > 20 then return jsonb_build_object('status', 'rate_limited'); end if;
  if p_code is null or octet_length(p_code) > 128 then return jsonb_build_object('status', 'unavailable'); end if;
  normalized := upper(regexp_replace(p_code, '[[:space:]-]', '', 'g'));
  if normalized !~ '^[A-HJ-NP-Z2-9]{12}$' then return jsonb_build_object('status', 'unavailable'); end if;
  -- Serialize against rotation: once rotation commits, the old code cannot match.
  select user_id into target from private.social_invites where code = normalized for share;
  if target is null or target = caller then return jsonb_build_object('status', 'unavailable'); end if;
  perform private.social_lock_pair(caller, target);
  if exists (select 1 from private.social_blocks where
    (blocker_id = caller and blocked_id = target) or (blocker_id = target and blocked_id = caller)) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select * into relationship from private.social_relationships
    where user_low = least(caller, target) and user_high = greatest(caller, target);
  if found then
    return jsonb_build_object('status', case when relationship.state = 'accepted' then 'accepted'
      when relationship.requester_id = caller then 'outgoing' else 'incoming' end);
  end if;
  begin
    insert into private.social_relationships(user_low, user_high, requester_id, state)
      values (least(caller, target), greatest(caller, target), caller, 'pending');
  exception when foreign_key_violation then
    -- A simultaneous account deletion must not roll back the failed-attempt counter.
    return jsonb_build_object('status', 'unavailable');
  end;
  return jsonb_build_object('status', 'sent');
end;
$$;

create function public.social_change_relationship(p_other_user_id uuid, p_action text, p_request_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); relationship private.social_relationships;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Sign in to use Friends.'; end if;
  if p_other_user_id is null or p_other_user_id = caller or p_action is null
    or p_action not in ('accept', 'decline', 'cancel', 'remove', 'block', 'unblock') then
    raise exception using errcode = '22023', message = 'Invalid friendship action.';
  end if;
  if p_action in ('accept', 'decline', 'cancel', 'remove') and p_request_id is null then
    raise exception using errcode = '22023', message = 'Refresh this friendship before trying again.';
  end if;
  perform private.social_lock_pair(caller, p_other_user_id);
  if p_action = 'unblock' then
    delete from private.social_blocks where blocker_id = caller and blocked_id = p_other_user_id;
    return;
  end if;
  select * into relationship from private.social_relationships
    where user_low = least(caller, p_other_user_id) and user_high = greatest(caller, p_other_user_id);
  if p_action = 'block' then
    -- Only a visible relationship (or an existing caller-owned block) can be
    -- blocked. This prevents an arbitrary UUID from becoming a name lookup.
    if relationship.id is null and not exists (select 1 from private.social_blocks
      where blocker_id = caller and blocked_id = p_other_user_id) then return; end if;
    insert into private.social_blocks(blocker_id, blocked_id) values (caller, p_other_user_id)
      on conflict (blocker_id, blocked_id) do nothing;
    delete from private.social_relationships where user_low = least(caller, p_other_user_id)
      and user_high = greatest(caller, p_other_user_id);
    return;
  end if;
  if relationship.id is null or relationship.id <> p_request_id then return; end if;
  if exists (select 1 from private.social_blocks where
    (blocker_id = caller and blocked_id = p_other_user_id) or (blocker_id = p_other_user_id and blocked_id = caller)) then return; end if;
  if p_action in ('accept', 'decline') and relationship.requester_id = caller
    or p_action = 'cancel' and relationship.requester_id <> caller then
    raise exception using errcode = '42501', message = 'This action belongs to the other pilot.';
  end if;
  if p_action = 'accept' then
    update private.social_relationships set state = 'accepted' where id = relationship.id;
  elsif p_action in ('decline', 'cancel') then
    -- A late cancel/decline must not remove an already accepted friendship.
    delete from private.social_relationships where id = relationship.id and state = 'pending';
  elsif p_action = 'remove' then
    delete from private.social_relationships where id = relationship.id and state = 'accepted';
  end if;
end;
$$;

create function public.social_get_friend_profile(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); profile jsonb;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Sign in to use Friends.'; end if;
  if p_user_id is null or p_user_id = caller then
    raise exception using errcode = '42501', message = 'This pilot profile is unavailable.';
  end if;
  -- VOLATILE PL/pgSQL reads a fresh snapshot after any lock wait. Removal/block
  -- and this permission check have one serialization point, not a stale join.
  perform private.social_lock_pair(caller, p_user_id);
  if not exists (select 1 from private.social_relationships where user_low = least(caller, p_user_id)
    and user_high = greatest(caller, p_user_id) and state = 'accepted')
    or exists (select 1 from private.social_blocks where
      (blocker_id = caller and blocked_id = p_user_id) or (blocker_id = p_user_id and blocked_id = caller)) then
    raise exception using errcode = '42501', message = 'This pilot profile is unavailable.';
  end if;
  profile := private.social_profile_json(p_user_id);
  if profile is null then raise exception using errcode = '42501', message = 'This pilot profile is unavailable.'; end if;
  return profile;
end;
$$;

revoke all on function private.social_lock_pair(uuid, uuid), private.social_new_code(),
  private.social_profile_json(uuid) from public, anon, authenticated;
revoke all on function public.social_get_state(), public.social_save_profile(text),
  public.social_rotate_invite_code(), public.social_request_friend(text),
  public.social_change_relationship(uuid, text, uuid), public.social_get_friend_profile(uuid) from public, anon;
grant execute on function public.social_get_state(), public.social_save_profile(text),
  public.social_rotate_invite_code(), public.social_request_friend(text),
  public.social_change_relationship(uuid, text, uuid), public.social_get_friend_profile(uuid) to authenticated;
