-- Cloud backup schema for Flight Log Alpha.
--
-- The phone is the source of truth. This schema is a mirror of the device's local
-- SQLite logbook, never an authority over it: flight facts are overwritten by the
-- client on every push, and only title/site/notes are ever merged back down.
--
-- Flight ids are the device's own Crypto.randomUUID() values, so there is no id
-- remapping and a re-push after a crash is idempotent by construction.

create extension if not exists pgcrypto;

create type public.flight_status as enum ('recording', 'processing', 'completed', 'partial');
create type public.track_quality as enum ('healthy', 'gaps', 'partial', 'no_track');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  pilot_name        text,
  glider_type       text,
  glider_id         text,
  home_site         text,
  -- The device's own epoch-ms clock, carried verbatim. This is what last-write-wins
  -- compares; `updated_at` below is server time and is only ever a pull cursor.
  client_updated_at bigint      not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_pilot_name_len  check (pilot_name  is null or char_length(pilot_name)  <= 60),
  constraint profiles_glider_type_len check (glider_type is null or char_length(glider_type) <= 60),
  constraint profiles_glider_id_len   check (glider_id   is null or char_length(glider_id)   <= 30),
  constraint profiles_home_site_len   check (home_site   is null or char_length(home_site)   <= 120)
);

-- ---------------------------------------------------------------------------
-- flights
-- ---------------------------------------------------------------------------
--
-- Metrics are denormalised into this table rather than mirroring the local
-- flights/flight_metrics split: they are one-to-one, immutable per algorithm version,
-- and one row per flight keeps the whole sync surface to two tables.
--
-- Raw evidence (location_fixes, pressure_samples, events) is deliberately NOT uploaded.
-- The derived IGC file is the archive; the raw track stays on the device that recorded it.

create table public.flights (
  id                      uuid primary key,
  user_id                 uuid not null references auth.users (id) on delete cascade,
  recording_session_id    uuid not null,
  status                  public.flight_status not null,
  started_at              bigint not null,
  ended_at                bigint,
  timezone_offset_minutes int,
  title                   text,
  site                    text,
  notes                   text,
  client_created_at       bigint not null,
  client_updated_at       bigint not null,
  device_platform         text,
  recorder_schema_version int,

  metrics_algorithm_version int,
  duration_ms               bigint,
  track_distance_metres     double precision,
  min_gps_altitude          double precision,
  max_gps_altitude          double precision,
  max_ground_speed          double precision,
  fix_count                 int,
  median_source_gap_ms      int,
  p95_source_gap_ms         int,
  max_source_gap_ms         int,
  quality                   public.track_quality,
  metrics_computed_at       bigint,

  igc_object_path      text,
  igc_sha256           text,
  igc_byte_count       bigint,
  igc_artifact_version int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One flight per recording session per pilot, matching the device's own
  -- flights.recording_session_id UNIQUE constraint.
  unique (user_id, recording_session_id),

  -- Mirrors the client-side limits in normalizeFlightMetadataPatch, so a client that
  -- somehow skips normalisation is still rejected rather than storing unbounded text.
  constraint flights_title_len  check (title is null or char_length(title) <= 120),
  constraint flights_site_len   check (site  is null or char_length(site)  <= 120),
  constraint flights_notes_len  check (notes is null or char_length(notes) <= 4000),
  constraint flights_time_order check (ended_at is null or ended_at >= started_at)
);

-- The pull cursor is (updated_at, id), so this index is the pull query.
create index flights_user_updated_at on public.flights (user_id, updated_at asc, id asc);
create index flights_user_started_at on public.flights (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------

-- updated_at is the pull cursor, so the database must own it. If the client could set
-- it, a device with a skewed clock could write a row that every other device's cursor
-- has already passed, and that flight would never be pulled.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger flights_touch_updated_at
  before update on public.flights
  for each row execute function public.touch_updated_at();

-- Every account gets a profile row, so the client can assume one exists.
-- `security definer` with an empty search_path and fully-qualified names is what the
-- Supabase security linter requires.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
