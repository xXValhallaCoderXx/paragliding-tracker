# PAR-27 map fallback checks

Session: 13 September 2026. Status: **fix implemented, installed and physically
verified for native tile-error fallback/Retry; broader PAR-27 acceptance remains open**.

Before the fix, with a previously loaded map, failed requests for new tiles left a blank/partial
basemap for more than 21 seconds. Grid and Retry map never appeared. Elapsed time
remained paused at `0:24:41`. The fixed APK now passes this focused failure/retry
case both while paused and during active playback, as recorded below.

## Applied fix and validation

The pinned pnpm patch in
[`patches/@rnmapbox__maps@10.3.5.patch`](../patches/@rnmapbox__maps@10.3.5.patch)
replaces the no-op compatibility subscription with SDK `subscribeMapLoadingError`.
It forwards the existing error event to JavaScript, owns the returned subscription,
cancels it when the map view is dropped, and invalidates obsolete callbacks before
cancellation. Dependency versions and the recorder recovery gate are unchanged.

- Full `pnpm test` passed in 45.7 seconds: TypeScript, lint/architecture,
  70 Jest suites / 603 tests, 54 pgTAP checks and generated database types.
- `pnpm validate:deps` still reports existing Expo SDK 57 patch-version mismatches;
  this is not a dependency-compatibility pass, and no upgrade was included.
- Android release build passed. Regenerated the stale native autolinking JSON,
  verified it resolves to the patched package, and inspected compiled bytecode for
  actual `MapboxMap.subscribeMapLoadingError` and `Cancelable.cancel` calls.
- Current APK: `FlightLogAlpha-1.0.0-map-error-fix-d619c12b8bb7.apk`.
  SHA-256: `d619c12b8bb7e8c86786ae502729b60053ae7236636a802c5cdcf7b070aff37a`.
  Package `com.xxvalhallacoderxx.xcmvp`, version `1.0.0` / code `1`, arm64.
- Its signing certificate matches the previous APK. In-place installation passed;
  the on-phone base.apk checksum matches. The Logbook still shows three flights.
- Patched-phone native tile-error fallback and Retry passed in two cycles:
  one paused and one playing at 10×. The detailed observed cases follow.

The exact source patch, APK, checks, compiled-bytecode evidence and private device
captures are retained in
`android/app/build/outputs/internal/par27-error-subscription-20260913/`.

## Why the dependency patch is kept

Release check on **13 September 2026**: the project already uses the latest
published `@rnmapbox/maps`, **10.3.5**. npm's `next` tag points to the older
`10.3.2-rc.2`; there is no newer published candidate to try. See the
[npm versions](https://www.npmjs.com/package/@rnmapbox/maps?activeTab=versions) and
[10.3.5 release](https://github.com/rnmapbox/maps/releases/tag/v10.3.5).

A fresh download of the published 10.3.5 package, verified against its registry
SHA-512 integrity value, still contains the broken subscription. Upstream `main`
was also at `cbf2a2d0045b46258270f27959bef9bde04c72bc`: its
[error registration](https://github.com/rnmapbox/maps/blob/cbf2a2d0045b46258270f27959bef9bde04c72bc/android/src/main/java/com/rnmapbox/rnmbx/components/mapview/RNMBXMapView.kt#L325-L333)
still calls the
[empty v11 compatibility method](https://github.com/rnmapbox/maps/blob/cbf2a2d0045b46258270f27959bef9bde04c72bc/android/src/main/mapbox-v11-compat/v11/com/rnmapbox/rnmbx/v11compat/Event.kt#L25-L28).
The checked upstream source therefore cannot replace our fix. Recheck releases
when revisiting this dated finding.

Commit `patches/@rnmapbox__maps@10.3.5.patch`, `pnpm-workspace.yaml` and
`pnpm-lock.yaml` together. pnpm needs the referenced patch file to reproduce the
fix on fresh installs and CI; do not ignore it or rely on edits to `node_modules`.

Remove the patch and its pnpm registration only when an upgraded dependency
provides equivalent error delivery and subscription cleanup. Regenerate the
lockfile, run the project checks, rebuild Android, and repeat the paused and
active-playback fallback/Retry phone checks on the unpatched replacement before
accepting it. The build's native dependency path must be refreshed as described
in [Build and evidence](./saved-replay-maps.md#build-and-evidence).

## Passed focused retest on the fixed APK

Device: SM-S938B / Android 16. APK: `d619c12b8bb7` as identified above.
The same temporary unreachable-proxy method preserved Wi-Fi/ADB while making
new native tile requests fail. No app data or map cache was cleared.

| Case | Observed result |
| --- | --- |
| Paused failure, 09:09:51–09:10:20 Asia/Singapore | Native proxy/tile failures switched the loaded map to Grid with the failure notice and Retry map. Elapsed stayed `0:22:39`, with `31 m` / `1 km/h` and the corresponding chart position. Fit flight was absent. |
| Paused Retry after network restoration | Tapping Retry map restored the geographic map, route/pilot and Fit flight at the same paused `0:22:39`. |
| Second failure while playing at 10×, 09:11:15–09:11:53 | Play/Pause controls confirmed 10× playback beforehand. Native failures again produced Grid + Retry; elapsed advanced to `0:27:22` in the failure capture. |
| Second Retry while playing | Map returned at `0:31:29`. Playback continued: the controls subsequently showed Pause, selected 10×, and `0:33:38`. A manual Pause stopped it at `0:33:43`; it was then left showing the fitted route. |
| Restoration and retained data | Both runs restored all proxy settings to their original absence; effective proxy was clear, Wi-Fi on and mobile data off. The compatible installation retained all three flights. |

Private artifacts: `device-evidence/paused-fallback/`, `paused-retry.png`,
`playing-fallback/`, `playing-controls-before.png`, `playing-retry.png`,
`playing-controls-after-retry.png`, and `paused-after-cycles.png` within the fixed
APK's evidence directory. Logs were checked for actual native request failures in
each run's time window. No fatal exception was found in the captured run logs.

The active-playback UI dump could not reach idle, so that run has screenshots
rather than an XML hierarchy; the paused run has both. These observations accept
the reproduced native-error defect and two failure/retry cycles. They do not
accept missing configuration, initial timeout/cold-load failures, radio-off Grid
scrubbing, navigation during a pending load, or broader coverage/resource cases.

## Original verified baseline

- Source: `a348f6c718083604d0112b9ef6eccbaa8e67e025`, branch
  `feature/mapbox-intgration`. The pre-existing `docs/project-overview.md` edit is preserved.
- Phone: Samsung SM-S938B, Android 16.
- Installed APK SHA-256, read from the phone:
  `9dc84f742ac81b714f2bc9211f3150be289c21bc63196be1b558bb8cd0e5e4c4`.
  This matches the recorded settings-spacing APK and source patch.
- The Logbook shows three flights. The saved walk opens in detail and Replay.
  Its Mapbox map, local Start/Stop markers and Fit flight control render.
- Scrubbing sets paused elapsed time to `0:22:39`; the pilot and altitude-chart
  marker update together, with `31 m` altitude and `1 km/h` ground speed displayed.
- Play at 60× advances from that position; Pause stops at `0:24:41`. Page scrolling
  exposes the controls, and returning to the full map preserves this position.
- Three focused Jest suites passed: replay map, static flight-map preview and
  native-map adapter; 13 tests total. These invoke mocked renderer callbacks and
  therefore do not prove delivery of real Android map errors.

Private screenshots and retrieved device artifacts belong under
`android/app/build/outputs/internal/par27-fallback-20260913/`; do not publish
route screenshots or raw device logs with this report.

## Native error delivery defect

The unpatched dependency is `@rnmapbox/maps` 10.3.5 with Android Mapbox SDK 11.23.1.
Its `android/src/main/java/com/rnmapbox/rnmbx/components/mapview/RNMBXMapView.kt`
registers map loading errors through `map.subscribe(...)` at lines 325–333.
The imported implementation in
`android/src/main/mapbox-v11-compat/v11/com/rnmapbox/rnmbx/v11compat/Event.kt`
at lines 25–28 is an empty TODO. The separate style-load error handler at
`RNMBXMapView.kt:648–650` only logs. The compiled dependency bytecode also calls
that empty compatibility subscription.

The app's `onMapLoadingError` handler in
`src/components/flight-map/index.native.tsx` consequently cannot receive actual
Android loading errors through that registration. The 15-second timeout in
`src/features/flights/replay/replay-map.tsx` still protects initial loading;
it is removed after readiness. A later tile failure therefore lacks that timeout
and the intended native error notification.

The existing MapIdle listener is wired. Offline cached rendering may legitimately
succeed and is not evidence that automatic failure fallback works.

## Reproduced physical failure: temporary unreachable proxy

Run: 08:53:48–08:54:18 Asia/Singapore. Private artifacts are in `device-evidence/proxy-run/`.

1. Open the saved walk's configured replay map, play/pause, and leave it at
   `0:24:41` with the map fully loaded.
2. Confirm no existing global proxy settings. Temporarily set the HTTP proxy to
   unreachable loopback endpoint `127.0.0.1:9`; Wi-Fi remains connected and mobile
   data remains off. No requests are routed to a third party.
3. Pan horizontally twelve times to require tiles outside the original viewport.
   Release the gesture and wait 21 seconds before capturing the screen/UI tree.
4. Capture process-scoped native logs, clear the effective proxy with `:0`, then
   remove all test-created proxy keys to restore their original absence.

Observed:

- Native Mapbox logs repeatedly report `net::ERR_PROXY_CONNECTION_FAILED` and
  `OnMapLoadError: Tile` during the test. This establishes actual failed tile
  requests, rather than merely assuming that changing a network setting worked.
- The screenshot shows a blank/partial geographic map with its attribution and
  Fit flight control. There is no fallback notice, Grid route or Retry map button;
  the captured UI hierarchy corroborates the absence of Retry.
- Paused elapsed time stays at `0:24:41`, with the same telemetry/chart position.
  Retry cannot be exercised because its control never becomes available.
- After restoration, both the global proxy settings and effective-proxy checks
  are empty, matching the baseline. Wi-Fi is on (`1`); mobile data is off (`0`).
- Fit flight restores the saved route at the same elapsed time. A subsequent pan
  into another area renders streets/buildings again with the proxy removed; the
  replay is then left fitted to its saved route.

Expected: real native loading errors after readiness should switch to Grid and
offer Retry while preserving replay state. The source/compiled subscription gap
above explains the missing error delivery. A repair and named-build retest are
required before accepting fallback/retry.

## Earlier inconclusive attempt: switching off Wi-Fi

Prepared a device-local test that checks Wi-Fi is on and mobile data is off,
captures the paused replay, disables Wi-Fi, pans the map twelve times, waits
21 seconds, captures the result, and restores Wi-Fi. It also starts a separate
55-second restoration timer. App storage, cached maps and credentials are untouched.

The script was staged and launched, but execution stopped when disabling Wi-Fi
lost the wireless ADB connection. Only the start timestamp, an unusable initial
capture and an empty watchdog log were retrieved; none of the offline observation
or restoration steps produced evidence. The owner manually reconnected the phone.
Wi-Fi on (`1`) and mobile data off (`0`) were then verified. This attempt is
**inconclusive**, not a passed or failed map check. Do not repeat this detached
wireless-ADB approach; use a method that preserves the control connection or
owner-operated steps.

## Remaining acceptance

1. Check leaving during a pending load and requests that stall without emitting
   an error. These are separate from the emitted native errors accepted above.
2. Keep missing-configuration, initial timeout/cold-load, radio-off controls,
   resource stress and the remaining PAR-27 coverage cases open until observed.

The native dependency patch and compatible APK update are applied. Linear status
is unchanged. PAR-3's Home/return reset and PAR-9's recorder checks remain separate work.
