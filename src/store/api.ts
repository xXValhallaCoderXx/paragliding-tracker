import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';

import type { SerializedQueryError } from './query-fn';

/**
 * The cache in front of the local database.
 *
 * `fakeBaseQuery` because nothing here is HTTP: every endpoint is a `queryFn` wrapping a
 * repository that reads SQLite. RTK Query supports this explicitly — it is the same shape
 * their docs use for Firebase and Supabase SDKs — and it buys the two things this app
 * actually lacks: one shared cache across screens, and tag invalidation so a write
 * refreshes the screens that care instead of each one re-reading on focus.
 *
 * Endpoints are added in step 2. This file exists first so `configureStore` has a reducer
 * and a middleware to mount, and so step 1 can be verified as a no-op before any screen
 * changes.
 */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: fakeBaseQuery<SerializedQueryError>(),
  /**
   * Declared up front rather than grown ad hoc: a mutation can only invalidate a tag that
   * exists, and a typo in a tag name is otherwise a silent no-invalidation.
   *
   * `Flight` uses the `LIST` id convention so a metadata edit can invalidate one flight
   * without refetching every other cached entry.
   */
  tagTypes: ['Flight', 'Profile', 'AppSettings'],
  endpoints: () => ({}),
});
