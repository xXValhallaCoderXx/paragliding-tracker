# Flight Log Alpha: project overview

Map and navigation updates reviewed on 13 September 2026 at `a348f6c`.
The original core implementation review was on 6 September 2026 at `d22d095`.

Flight Log Alpha is a personal paragliding journal built around recording a flight on your
phone, reviewing what happened, and keeping a shareable memory of it. It is an Android-first
native app built with Expo SDK 57 and React Native. iOS is configured; there is no web app.

The core experience works offline and without an account. Optional sign-in adds private cloud
backup. The app is an internal alpha, not a certified flight recorder or a replacement for a
pilot's primary recording equipment.

## What you can do today

| Area | Current features |
| --- | --- |
| Setup | Guided first run, pilot and glider details, permission checks and optional backup. Open Settings from its row on Account to revisit setup and app settings. |
| Record | Start a flight manually, record GPS locally with background-location support, view airtime, GPS altitude, ground speed and capture health, then hold to stop. Leaving the recording screen does not stop capture. |
| Recover | Reconcile an unfinished recording after reopening; Resume or Save Partial when interrupted; retry a failed save. A persisted manual Stop remains terminal. |
| Flight journal | Browse locally recorded flights grouped by month, return to an unfinished flight, and see static route maps with Start/Stop labels, season totals and personal milestones derived from this phone's history. Only visible cards request map images. |
| Flight detail | View a static route map, airtime, track distance, altitude, speed, route quality and recording evidence. Edit title, launch site and private notes. Delete a finished flight after confirmation. |
| Launch sites | Look up nearby ParaglidingEarth launches or search names through OSM/Photon. Enter a name manually when offline or no suitable result exists. Saved catalogue choices retain attribution. |
| Saved replay | Play a saved route on a geographic map with a moving pilot marker, GPS-altitude chart and synchronized telemetry. Pan, zoom and Fit flight; pause, scrub, seek by 10 seconds, and choose 1×, 10× or 60× speed. An offline grid remains the fallback. |
| Postcard sharing | Compose a Square or Story PNG with one of three illustrations, the saved route, flight statistics, a temporary caption and optional pilot signature. Open the phone's share menu to choose a receiving app. |
| File export | Export deterministic unsigned IGC files and diagnostic JSON through native sharing. Pilot/glider details populate applicable IGC headers. |
| Pilot and backup | Keep a local profile, optionally sign in with an email code, inspect backup progress/errors, retry sync, sign out or delete the cloud account while retaining the local logbook. |

The journal uses bundled illustrations and fonts. Map backgrounds need a connection or cached
data; static previews show the local route grid while loading or after failure. Recording
instruments remain focused on readability and capture status.

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
Downloaded map areas and guaranteed offline basemaps are not implemented.

Playback respects the saved recording bounds, pauses when leaving or backgrounding, and does
not resume automatically. Gaps longer than 15 seconds and unavailable telemetry remain visible
as missing data rather than invented movement. Samples are released when leaving replay.
A known Home/return reset to zero is tracked in PAR-3: recorder recovery currently remounts the
player, and preserving replay position must retain that recovery safeguard.

Samsung Android checks have confirmed static card/detail map placement and attribution, replay
pan/refit, and the recent Settings/layout changes. Physical automatic fallback/retry, offline
fallback on the revised UI, and broader resource/performance acceptance remain pending; see the
[map verification record](./saved-replay-maps.md). Full postcard/replay acceptance, including
social-app handoff, accessibility and long-flight playback, remains in the
[feature plan](./feature-plan.md).

## What backup means today

The phone remains the source of truth for recorded flight evidence. With a configured backend
and an account, completed flight summaries, profile details and derived IGC files can upload
to private storage. Newer profile fields and flight title/site/notes can merge back down.
Deleting a local flight queues its cloud deletion; remote deletion does not erase local evidence.

**Backup does not yet restore a logbook onto a new phone.** Cloud-only flights can be counted,
but they are not downloaded into local recordings or made replayable. Raw GPS fixes, pressure
samples and diagnostics are not automatically uploaded. The IGC archive does contain route
coordinates, so private backup must not be treated as consent to publish a flight.

Backup pauses during active recording and recovery. Current Android notification support is
for the recorder's foreground service; friend notifications and live sharing do not exist.
Signing in alone is not proof that an upload finished. Hosted email setup is documented in
[email-setup.md](./email-setup.md).

## Current limits and confidence

- Flights are recorded on this device; there is no manual flight creation or file import.
- No friends, public pilot profiles, social feed, shared-flight links, remote replay or live viewing.
- No in-flight or 3D maps, airspace tools, automatic takeoff/landing detection, Bluetooth vario,
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
| Postcard composition and image export | [src/features/postcard](../src/features/postcard) |
| Track and replay calculations | [src/lib/track](../src/lib/track), [src/lib/replay](../src/lib/replay) |
| Cached screen data | [src/store](../src/store) |
| Account, backup and payload contracts | [src/cloud](../src/cloud) |
| Server schema, owner access and private storage | [supabase/migrations](../supabase/migrations) |

For development and testing use the [README](../README.md). Future product work belongs in
the [feature plan](./feature-plan.md); this overview should change only when capabilities change.
