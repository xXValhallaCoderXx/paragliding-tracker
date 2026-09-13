# Saved replay maps

Decision recorded 12 September 2026. The owner approved Mapbox Outdoors for saved-flight replay.
PAR-19, PAR-20, PAR-27 and PAR-30 are In Progress. The owner approved removing the Map/Grid selector:
Map opens when configured and falls back automatically to Grid, with Retry map after a failed
attempt. Earlier APK `44058268580d` demonstrated direct Map opening and pan/Fit on Android.
Focused native tile-error fallback and Retry passed on APK `d619c12b8bb7` on 13 September,
both paused and playing at 10×. Broader offline and resource cases remain pending. Earlier manual-selector
and offline Grid observations belong to APK `ef8278c3f6ad` and do not accept the new fallback flow.
The earlier recorder smoke remains valid; EAS preview is still unconfigured.

The target overlay and static Logbook/detail maps are implemented. The combined installed build
and its observed cases are recorded below; broader failure/resource acceptance remains open.

## Decision and configuration

- Pin `@rnmapbox/maps` 10.3.5, using its default Android Mapbox SDK 11.23.1.
- Select `mapbox://styles/mapbox/outdoors-v12` explicitly. [Outdoors](https://docs.mapbox.com/map-styles/reference/outdoors/)
  remains available as a classic style, but is no longer actively maintained.
- Set `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` to a public Mapbox `pk.` token in `.env.local`; set the
  same public value in EAS's **preview** environment with **plaintext** visibility. The token is
  embedded in the app bundle. This Android setup uses no secret download token.
- Preserve SDK ambient-cache defaults. Cached tiles may be available offline; no numeric cache
  budget is enforced by the app and no downloaded-area coverage is promised.
- Aim for worldwide online coverage. Singapore walks and Malaysian flying areas are primary
  checks, with no country restriction or requirement that a recording be an actual flight.

Map downloads (PAR-28), the pilot's own in-flight map (PAR-29), 3D (PAR-21) and remote live sharing
remain outside this increment. Mapbox's [regional offline support](https://docs.mapbox.com/android/maps/guides/offline/)
provides a future path; downloads, storage management and offline guarantees need their own work.

## Implementation contract

- A shared map view accepts geographic route segments, track identity, a nullable current marker
  and optional endpoints. It owns rendering/camera state, with separate saved and future live
  adapters; it never owns GPS collection, recorder lifecycle, database access or a second clock.
- Saved replay uses original normalized fixes and the existing playback timestamp. Preserve gaps
  over 15 seconds, absent telemetry, isolated fixes, partial tracks and antimeridian crossings.
- Open Map automatically when configured; there is no Map/Grid selector. Keep replay position
  and playback state through automatic fallback/retry. Initially fit a new track; map-only
  **Fit flight** is a round 48 dp target button inside the map at bottom right, clear of Mapbox
  attribution. It refits the entire recorded route after pan/zoom and is absent on Grid. Use the
  accessible name "Fit flight" and hint "Show the entire recorded route on the map". Marker
  updates must not refit or rebuild the route.
- Missing configuration, native failure or a 15-second initial-load timeout automatically shows
  Grid. Offer **Retry map** after a failed map attempt. Preserve pause-on-background/navigation behavior,
  reject obsolete callbacks and release inactive map resources.
- Keep the pinned `@rnmapbox/maps` Android patch: version 10.3.5's compatibility error
  subscription is a no-op. The patch subscribes to real SDK loading errors and cancels the
  subscription when the view is dropped, rejecting callbacks from obsolete subscriptions.
  The [patch maintenance note](./par-27-map-fallback-checks.md#why-the-dependency-patch-is-kept)
  records the 13 September release check, files to commit together and removal criteria.
- Keep Mapbox logo/attribution and accessible controls visible. Map failure cannot affect saved
  data or recording. A future live adapter will consume recorder-captured fixes without a new GPS
  watcher; the current change adds no in-flight screen.

## Static Logbook and detail maps

[PAR-30](https://linear.app/sentiment-hound/issue/PAR-30/add-static-flight-maps-to-logbook-and-flight-details)
is In Progress in Cycle 1, blocked by PAR-19 and related to PAR-20. It adds static Outdoors
basemap images to Logbook cards and flight detail. Draw the stored route and clear Start/Stop
markers locally over the matching Mercator camera, with no pilot. Mapbox receives viewport
requests; route and endpoint overlays are not encoded into those requests.

Use Expo Image disk caching with a 12-hour mount-bucket key, subject to platform eviction and no
app cache quota. Keep Grid visible during image loading/failure/timeout and limit list requests
to visible cards through virtualization. The local public token's Static Images request returned
HTTP 200 with `max-age=43200`. Preserve route gaps/dateline handling and card/detail navigation.
Initial static-map checks passed; forced failure/offline and long-list stress remain open in
PAR-27. The replay target overlay remains in PAR-20.

## Build and evidence

Read the [exact Expo SDK 57 docs](https://docs.expo.dev/versions/v57.0.0/) before native changes.
Preserve the existing local signing key, package identity, TaskManager patch and unrelated
dependency versions. Follow the README's in-place prebuild and `pnpm android:release` workflow;
install a compatible update without uninstalling or clearing the owner's data. A native module
requires a rebuilt APK; a token change requires a new embedded bundle.

Run focused geometry/adapter/replay checks and the required `pnpm test` workflow, including Docker
database checks. Retain the exact APK with commit/diff, checksum, package/version, signer and
native SDK versions. Record automated checks separately from named-phone observations.

When adding or changing a pnpm native patch in an existing Android build, regenerate the
ignored `android/build/generated/autolinking/autolinking.json` and verify its dependency
`sourceDir` matches the patched package. React Native 0.86.2's default autolinking inputs omit
the pnpm lockfile, so a cached path may otherwise keep compiling the unpatched package.
Confirm the compiled `RNMBXMapView` calls `MapboxMap.subscribeMapLoadingError` before installation.

Latest fixed APK: `FlightLogAlpha-1.0.0-map-error-fix-d619c12b8bb7.apk`, retained under
`android/app/build/outputs/internal/par27-error-subscription-20260913/`. Its on-phone checksum
and compatible signature match; all three flights remain. Real failed tile requests now show
Grid + Retry. Paused Retry preserves `0:22:39`, and a second cycle preserves active 10× playback.
Full project checks passed (603 Jest tests, 54 pgTAP checks, types/lint) and the native build
passed; existing Expo dependency-version warnings remain. See the
[PAR-27 check report](./par-27-map-fallback-checks.md) for exact identity, evidence and open cases.

Historical combined target/static-map artifact:
`android/app/build/outputs/internal/mapbox-previews-20260912T154420Z/FlightLogAlpha-1.0.0-mapbox-previews-8b743aee52e2.apk`,
SHA-256 `8b743aee52e29145fef2946b538200f5ab9d0eee53f56a0139a33d31222d52fa`.
The full `pnpm test` gate passed in 51.7 seconds: 70 Jest suites / 603 tests, 54 pgTAP checks,
types, lint/architecture and database types. A later Start/Stop fallback-label refinement passed
four targeted tests and types/lint. The combined candidate built in 30 seconds; the final
detail-corner-only fix passed a 32-second build plus lint/whitespace checks.

The final APK installed in place with a matching on-phone checksum and all three flights retained.
Static list/detail Outdoors maps show the local route and separate Start/Stop labels, no pilot;
tapping the card image opens detail. Final detail attribution is fully visible after removing
the bottom-corner clipping. The immediate predecessor `632200a716d6` verified target-overlay
pan/refit, its clearance from attribution and native replay Start/Stop labels; the final change
only squared the detail map's bottom corners. Forced failure/offline/retry, Malaysian coverage
and long-list stress remain untested. Private route screenshots stay in the local device evidence.

Historical automatic-fallback artifact:
`android/app/build/outputs/internal/mapbox-automatic-20260912T152619Z/FlightLogAlpha-1.0.0-mapbox-automatic-44058268580d.apk`,
SHA-256 `44058268580df1b410f56c67066cb7c196a8bad5b129c1c7519a4e999d669247`.
The update passed 6 replay tests and 3 native renderer tests, focused lint/types/whitespace checks,
and a 29-second build. Automated checks cover error/timeout fallback and retry with playback
preservation. Its public token is embedded and its signer unchanged; `adb install -r` succeeded
and the on-phone APK checksum matches.

Observed on this new APK: all three flights remain, the latest walk reopens, and Replay opens
directly into Outdoors with no Map/Grid selector. Only **Fit flight** appears above the map.
The map stays healthy after loading; panning moves the view and Fit restores the full route.
Physical failure/retry and offline fallback on this revised UI remain unverified.

Historical checks before this UI simplification, recorded 12 September: `pnpm test` passed in
67 seconds (67 Jest suites / 592 tests, 54 pgTAP
checks, TypeScript, lint/architecture and generated database types). Android release Kotlin
compilation passed in 2 minutes 19 seconds; the initial standalone arm64 assembly passed in
1 minute 52 seconds with native Mapbox 11.23.1. Subsequent fixes make selecting the current Map
view a no-op and reset camera state for a changed track identity. Their 6 replay and 7 renderer
tests passed, followed by focused lint, typecheck and whitespace checks. The corrected incremental
standalone release passed in 40 seconds.
The 27 existing dependency-version warnings remain tracked in PAR-26.

Historical tokenless artifact: `android/app/build/outputs/internal/mapbox-20260912T144001Z/FlightLogAlpha-1.0.0-mapbox-3c9bc28040ea.apk`,
SHA-256 `3c9bc28040eaca061008c0f4b3d418e554d46b362cd7d2a08bcd4c19ddb2ecfa`.
It installed compatibly while the phone was locked and provided installation evidence only.
Its build/source records remain retained; subsequent configured-token builds supersede it.

Historical manual-selector artifact: `android/app/build/outputs/internal/mapbox-online-20260912T151118Z/FlightLogAlpha-1.0.0-mapbox-online-ef8278c3f6ad.apk`,
SHA-256 `ef8278c3f6adfcade06692fb05bfcf482dff9f3ae0e15f31301a59a734ff5eb4`.
The local public token returned HTTP 200 and is embedded in this build; its value is not recorded
here. The initial online build exposed a false 15-second timeout despite a visible map. Readiness
now uses the supported MapIdle event because the pinned Android wrapper does not emit the prior
MapFully callback. The fix passed 7 renderer tests, lint/types and a 29-second native build.

`adb install -r` succeeded on the SM-S938B / Android 16; the installed `base.apk` checksum matches
that artifact. Its signer remains
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
The unlocked logbook retains three flights. The latest Singapore walk reopens with
1:07:08 / 1.3 km / 34 m displayed. Named-phone records are retained in `phone-verification.json`
and `device-evidence/` beside the APK; private route screenshots are not published to Linear.

Observed on that historical build: Outdoors shows streets, buildings, route and endpoints in Singapore,
and remains healthy beyond 15 seconds. Playback advances at 60x; pausing at 0:20:23
shows the blue pilot with synchronized chart/telemetry. Seeking was also verified at 0:02:39
with the pilot/chart updated.
Pan works and **Fit flight** restores framing. Map → Grid → Map preserves paused 0:20:23.
Attribution opens with a visible telemetry opt-out choice; no preference was changed.
The parent page scrolls after map gestures. Pinch zoom remains unverified.

Owner-reported device check on that historical APK: with Airplane mode on and Wi-Fi off, saved
flight → Replay → Grid supports Play, Pause and timeline dragging. This confirms offline Grid
controls only; physical map tile-failure/retry and offline basemap coverage are not established.

Home/return remounts the map, but replay time resets to zero. The existing recorder recovery
gate unmounts ReplayPlayer; this behavior predates the map change. Preserve that integrity gate
and track replay-position continuity in PAR-3. Malaysian coverage, physical map tile-failure/retry,
offline basemap behavior and broader fixtures/resource/performance checks remain unverified.

## Android acceptance

Use the owner's SM-S938B / Android 16 with the preserved logbook. Earlier selector-based results
are recorded above. The new automatic-fallback APK has direct Map/pan/Fit evidence; its physical
failure/retry and offline fallback cases remain pending.
PAR-19's remaining criteria stay open; PAR-20 retains that dependency and PAR-27 is the physical gate.

1. Verify the fresh standalone build opens a saved Singapore walk in Map automatically with no
   selector, and inspect a Malaysian flying-area sample. Check placement and provider attribution.
2. Play, pause and scrub; compare map marker, chart and telemetry at the same timestamp. Exercise
   stationary/gapped/partial/dateline fixtures only in an isolated test installation.
3. Verify the round target overlay is inside the map at bottom right, clear of attribution,
   labelled **Fit flight** for accessibility and absent on Grid. Pan/zoom, then tap it to refit
   the entire route. Marker movement must respect manual framing.
4. Check automatic Grid fallback for missing configuration, native failure and the 15-second
   timeout; use **Retry map** after failure. Replay position/playback must survive fallback/retry.
   Confirm Grid Play/Pause/scrubbing offline without requiring a manual mode choice.
   A cached map may work offline; no downloaded map coverage is assumed.
5. Background/return paused; reopen and retry repeatedly. Check gestures with scrolling,
   accessible labels, resource cleanup and comparative Grid/map responsiveness on the same track.
6. Attach actual results and fix/retest concrete blockers. Full replay and long-flight studies
   remain PAR-3/PAR-5; do not repeat the earlier recorder smoke solely for this map addition.
7. For PAR-30, verify static card/detail basemap placement, local route/Start/Stop alignment and
   no pilot; confirm Grid during load/error/timeout, visible-card loading and ordinary navigation.

Detailed work: [Linear map plan](https://linear.app/sentiment-hound/document/saved-flight-maps-cycle-plan-and-future-in-flight-design-fecd2d3a6c12).
