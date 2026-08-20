import * as Location from 'expo-location';

import type { Coordinate } from '@/sites/types';

/**
 * One coarse position, or null.
 *
 * The recorder deliberately never runs a foreground location subscription — see
 * `recorder-presentation.ts` — because holding one open competes with the capture service
 * during a multi-hour flight. This is a different thing: a single read, on a finished
 * flight, that ends itself. The invariant is about not *holding* GPS, not about never
 * touching it.
 *
 * Non-throwing by design. "We could not offer nearby launches" degrades to "type it
 * yourself", which is why the field accepts free text in the first place.
 */

/** Long enough for a warm fix, short enough that the button does not feel stuck. */
const DEFAULT_TIMEOUT_MS = 8_000;

/** A five-minute-old, kilometre-accurate fix names the same launch as a fresh one. */
const CACHED_MAX_AGE_MS = 5 * 60_000;
const CACHED_REQUIRED_ACCURACY_M = 2_000;

export async function readCoarsePosition(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Coordinate | null> {
  if (!(await Location.hasServicesEnabledAsync().catch(() => false))) return null;

  // Deliberately not `recorderService.getCapabilities()`: that reports 'denied' unless
  // permission is *precise*, because that is what recording a track needs. Naming a
  // launch inside a 25 km radius does not — refusing a pilot who granted approximate
  // location would be gating on the wrong requirement.
  const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (permission?.status !== 'granted') return null;

  const cached = await Location.getLastKnownPositionAsync({
    maxAge: CACHED_MAX_AGE_MS,
    requiredAccuracy: CACHED_REQUIRED_ACCURACY_M,
  }).catch(() => null);
  if (cached) {
    return { latitude: cached.coords.latitude, longitude: cached.coords.longitude };
  }

  return watchOnce(timeoutMs);
}

/**
 * A single fix from a subscription we immediately cancel.
 *
 * `getCurrentPositionAsync` would be the obvious call and is the wrong one: it takes no
 * timeout and cannot be cancelled, so racing it against a timer abandons a request that
 * keeps running — and with `mayShowUserSettingsDialog` defaulting to true it can raise a
 * system dialog after we have already given up. `watchPositionAsync` is the only
 * cancellable primitive this SDK offers.
 */
function watchOnce(timeoutMs: number): Promise<Coordinate | null> {
  return new Promise<Coordinate | null>((resolve) => {
    let subscription: Location.LocationSubscription | null = null;
    let settled = false;

    const finish = (value: Coordinate | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    void Location.watchPositionAsync(
      {
        // Balanced, not BestForNavigation: ~100 m is far finer than the distance at which
        // two launches are distinguishable, and BestForNavigation is exactly what makes a
        // cold fix take a minute.
        accuracy: Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: false,
      },
      (location) =>
        finish({ latitude: location.coords.latitude, longitude: location.coords.longitude }),
    ).then(
      (handle) => {
        subscription = handle;
        // The timeout may already have fired while the subscription was being created.
        if (settled) handle.remove();
      },
      () => finish(null),
    );
  });
}
