import { configureStore } from '@reduxjs/toolkit';

import { api } from './api';

/**
 * The app store.
 *
 * Created at module scope, which is safe *because* nothing here subscribes to anything:
 * the observable services are bridged in from an effect instead. `cloudAuthService`'s
 * `subscribe()` reaches `getSupabase()`, and that client is lazy on purpose so `pnpm test`,
 * `expo export` and a build with no EXPO_PUBLIC_SUPABASE_* never construct one or open a
 * socket. Subscribing here would destroy that.
 */
export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Both checks deep-walk the state on every action, in development only. `warnAfter`
      // would be the wrong knob — it raises the threshold for the "took N ms" warning
      // while the walk still happens, which buys a silent cost rather than a cheaper one.
      // Scope them instead.
      //
      // RTK Query owns `api` and only ever writes it through its own immer reducers, so
      // nothing outside can mutate it and the immutability walk has nothing to find there.
      // Skipping it keeps a few hundred cached flights — and `FlightDetail`, which embeds
      // a whole SessionRecord — off a twice-per-action traversal on a mid-range phone.
      immutableCheck: { ignoredPaths: ['api'] },
      // Actions stay fully checked, because that is where a non-plain value would actually
      // arrive: from a queryFn that threw instead of returning `{ error }`. The cache is
      // skipped for the same reason as above, and `deviceMetadata`/`appMetadata` are
      // `JSON.parse` output (database.native.ts:388-389) so they cannot hold one anyway.
      serializableCheck: { ignoredPaths: ['api.queries', 'api.mutations'] },
    }).concat(api.middleware),
  // React Native has no Redux DevTools extension to connect to, so this would fall back to
  // plain compose. Wiring the timeline up needs @redux-devtools/expo-dev-plugin.
  devTools: false,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
