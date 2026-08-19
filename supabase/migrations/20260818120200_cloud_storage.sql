-- IGC artifact storage.
--
-- Object key convention: <user_id>/<flight_id>.igc
-- The owner is the first path segment, so every policy is one foldername comparison
-- and there is no join back to public.flights.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'flight-igc',
  'flight-igc',
  false,
  26214400, -- 25 MB; a very long flight is well under 1 MB, so this is pure headroom.
  array['application/vnd.fai.igc', 'text/plain']
)
on conflict (id) do nothing;

create policy flight_igc_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'flight-igc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy flight_igc_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'flight-igc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Required because the client uploads with `upsert: true`: re-exporting a flight after
-- the pilot fills in their profile writes a new IGC to the same key.
create policy flight_igc_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'flight-igc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'flight-igc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy flight_igc_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'flight-igc'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
