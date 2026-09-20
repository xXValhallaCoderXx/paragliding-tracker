# Flight Log Alpha: project overview

Map and navigation updates reviewed on 13 September 2026 at `a348f6c`.
The original core implementation review was on 6 September 2026 at `d22d095`.
The optional in-flight map and replay recovery fix were added locally on 19 September 2026;
their [Android acceptance remains pending](./in-flight-map.md).
Downloadable map areas were added locally on 20 September 2026; [PAR-28 physical acceptance
remains pending](./offline-maps.md).
Friends profiles and private invitations were added on 21 September 2026;
[Friends v1](./friends.md) records validation and delivery evidence separately.
The accepted-friends feed and explicitly shared flight detail/replay are implemented and deployed;
[shared flights](./shared-flights.md) tracks their separate release and device gates.

Flight Log Alpha is a personal paragliding journal built around recording a flight on your
phone, reviewing what happened, and keeping a shareable memory of it. It is an Android-first
native app built with Expo SDK 57 and React Native. iOS is configured; there is no web app.

The core experience works offline and without an account. Optional sign-in adds private cloud
backup and enables Friends. The app is an internal alpha, not a certified flight recorder or a replacement for a
pilot's primary recording equipment.

## What you can do today

| Area | Current features |
| --- | --- |
| Setup | Guided first run, pilot and glider details, permission checks and optional backup. Open Settings from its row on Account to revisit setup and app settings. |
| Record | Start a flight manually, record GPS locally with background-location support, view airtime, GPS altitude, ground speed and capture health, then hold to stop. Optionally open Map for recorded position and a bounded recent trail with Grid fallback. Leaving the recording screen does not stop capture. |
| Recover | Reconcile an unfinished recording after reopening; Resume or Save Partial when interrupted; retry a failed save. A persisted manual Stop remains terminal. |
| Flight journal | Browse locally recorded flights grouped by month, return to an unfinished flight, and see static route maps with Start/Stop labels, season totals and personal milestones derived from this phone's history. Only visible cards request map images. |
| Flight detail | View a static route map, airtime, track distance, altitude, speed, route quality and recording evidence. Edit title, launch site and private notes. Delete a finished flight after confirmation. |
| Launch sites | Look up nearby ParaglidingEarth launches or search names through OSM/Photon. Enter a name manually when offline or no suitable result exists. Saved catalogue choices retain attribution. |
| Saved replay | Play a saved route on a geographic map with a moving pilot marker, GPS-altitude chart and synchronized telemetry. Pan, zoom and Fit flight; pause, scrub, seek by 10 seconds, and choose 1×, 10× or 60× speed. An offline grid remains the fallback. |
| Offline maps | Settings searches destinations, previews suggested coverage and manages multiple Android map downloads for live recording and replay. Pause, Resume/Retry, Cancel, Update and Delete are implemented; physical offline acceptance is pending. |
| Postcard sharing | Compose a Square or Story PNG with one of three illustrations, the saved route, flight statistics, a temporary caption and optional pilot signature. Open the phone's share menu to choose a receiving app. |
| File export | Export deterministic unsigned IGC files and diagnostic JSON through native sharing. Pilot/glider details populate applicable IGC headers. |
| Pilot and backup | Keep a local profile, optionally sign in with an email code, inspect backup progress/errors, retry sync, sign out or delete the cloud account while retaining the local logbook. |
| Friends | View deliberately published flights from accepted friends and preview your own posts; open shared detail and 2D replay. Manage friends keeps display names, invite codes, requests/connections and backed-up flight counts. Online only. |
| Share with friends | Manually publish a saved flight or opt into automatic sharing of future recordings, off by default. Full route and approved summary fields are shared; private notes, pilot/export details and diagnostics are excluded. Hide and durable retry status live on your own flight detail. |

The journal uses bundled illustrations and fonts. Live/replay map backgrounds can use a
connection, cache or completed downloaded coverage. Static previews use their separate image
cache and show the local route grid while loading or after failure. Recording instruments
remain focused on readability and capture status.

## Sharing and replay: implemented, still being finished

**Postcards already work in the code.** Eligible completed and saved-partial flights offer
Share postcard once statistics are ready. Formats are 1080 × 1080 and 1080 × 1920; scenes are
Flying, Launch and Landing. Captions are temporary, limited to 140 characters and independent
of private flight notes. A saved pilot name can be included or omitted.

The preview uses the actual recorded route and retains partial-flight, gap, missing-data and
site-attribution labels. Capture waits for the current fonts, image and layout. Retry,
cancellation and temporary-file cleanup are implemented. The phone's share sheet hands an image
to another app; it does not confirm that the pilot published a social post. No account or
photo-library access is needed. Hosted links, video export and Save to Photos are not present.

**Saved replay opens Mapbox Outdoors by default when configured.** It supports pan/zoom and
Fit flight, with automatic Grid fallback for missing configuration, map failure or an initial
load timeout. Retry map is available after a failed attempt; there is no Map/Grid selector.
Android [downloaded map areas](./offline-maps.md) are implemented locally with shared storage,
verified completion and recovery. Cold-start airplane-mode basemap behavior, storage measurements
and overlap/deletion remain physical acceptance gates.

Playback respects the saved recording bounds, pauses when leaving or backgrounding, and does
not resume automatically. Gaps longer than 15 seconds and unavailable telemetry remain visible
as missing data rather than invented movement. Samples are released when leaving replay.
The PAR-33 fix retains a small paused position/speed bookmark across the recovery remount while
still releasing samples. A new replay entry starts at zero; named-device confirmation remains pending.

Samsung Android checks have confirmed static card/detail map placement and attribution, replay
pan/refit, and the recent Settings/layout changes. Physical automatic fallback/retry, offline
fallback on the revised UI, and broader resource/performance acceptance remain pending; see the
[map verification record](./saved-replay-maps.md). Full postcard/replay acceptance, including
social-app handoff, accessibility and long-flight playback, remains in the
[feature plan](./feature-plan.md).

## What backup means today

The phone remains the source of truth for recorded flight evidence. With a configured backend
and an account, completed flight summaries, profile details and derived IGC files can upload
to private storage. PAR-22 now implements automatic restoration of summaries and archived IGCs
into the normal logbook, with foreground Wi-Fi downloads, explicit mobile permission and
Pause/Resume/Retry controls. Restored flights contribute backed-up totals, support metadata edits,
and replay from archived positions; original raw samples and diagnostics are not reconstructed.
Downloaded archives remain available while offline or signed out.

Confirmed individual-flight deletion propagates to linked phones, including verified original
finished recordings. Cloud account deletion remains a separate action that retains local copies.
The [restoration guide](./private-flight-restoration.md) records account isolation, editing conflicts,
original export, migration/old-APK limits, and the still-pending physical acceptance checks.
The IGC archive contains route coordinates; private backup is not consent to publish a flight.

The [shared-flight feed](./shared-flights.md) uses a separate approved summary and replay artifact.
Current accepted friends can see published history, including friends added later. Turning off
automatic sharing stops future posts; existing ones stay visible until hidden. Shared views do
not enter the viewer's logbook or totals and are cleared on background, offline and account changes.

Backup pauses during active recording and recovery. Current Android notification support is
for the recorder's foreground service; friend notifications and live sharing do not exist.
Signing in alone is not proof that an upload finished. Hosted email setup is documented in
[email-setup.md](./email-setup.md).

## Current limits and confidence

- Flights are recorded on this device; there is no manual flight creation or file import.
- Shared flights have no per-flight recipient picker, route trimming or endpoint privacy zones.
  No public pilot directory, kudos, comments, notifications, share links or live viewing. Friend
  detail/replay requires connectivity; the new feed's exact-build acceptance is still pending.
- No 3D maps, airspace tools, automatic takeoff/landing detection, Bluetooth vario,
  calibrated climb-rate instrument, competition signing or XContest integration.
- Units are metric. Recorded pressure depends on the JavaScript sensor listener staying active;
  continuous locked-screen pressure capture has not been established.
- The Android build has been installed on a Samsung device, but full postcard/replay acceptance,
  long-duration recording and termination/recovery evidence remain incomplete. iOS device
  acceptance is also outstanding. Build success and host tests do not prove these behaviors.

The original baseline verification on 6 September 2026 passed TypeScript, ESLint, 571 Jest
tests and 54 pgTAP checks, including real SQLite transactions and generated database-type checks.
That is evidence for the checked implementation, not a field-reliability claim. See the
[README validation commands](../README.md#validation) for how to repeat it.

## Where the implementation lives

| Responsibility | Source |
| --- | --- |
| Routes and screens | [src/app](../src/app) |
| Capture, persistence, recovery, metrics and exports | [src/recorder](../src/recorder) |
| Flight detail and replay UI | [src/features/flights](../src/features/flights) |
| Offline map search, downloads and recovery | [src/offline-maps](../src/offline-maps), [src/features/offline-maps](../src/features/offline-maps) |
| Postcard composition and image export | [src/features/postcard](../src/features/postcard) |
| Track and replay calculations | [src/lib/track](../src/lib/track), [src/lib/replay](../src/lib/replay) |
| Cached screen data | [src/store](../src/store) |
| Account, backup and payload contracts | [src/cloud](../src/cloud) |
| Friends permissions, publication and remote feed/replay | [src/social](../src/social), [src/features/feed](../src/features/feed) |
| Server schema, owner access and private storage | [supabase/migrations](../supabase/migrations) |

For development and testing use the [README](../README.md). Future product work belongs in
the [feature plan](./feature-plan.md); this overview should change only when capabilities change.
