# Feature plan and roadmap

Updated 12 September 2026. This is a proposed product direction, not a delivery schedule or a
claim that future features exist. The [project overview](./project-overview.md) describes today.

19 September implementation update: PAR-29's optional in-flight map is now implemented locally,
with Android acceptance still pending. Its [implementation and acceptance guide](./in-flight-map.md)
supersedes the provisional in-flight direction below. PAR-32 archive pagination and PAR-33 replay
bookmark maintenance are included as separate changes; hosted/device acceptance is still distinct.

20 September implementation update: PAR-28 downloadable map areas are implemented locally.
The [offline maps guide](./offline-maps.md) records the agreed defaults, native/persistence
design and remaining cold-start, storage-size and overlap/deletion Android checks.

21 September implementation update: [Friends v1](./friends.md) provides profiles, invitations
and accepted connections. The owner selected the [shared-flight feed](./shared-flights.md) next,
ahead of notifications and further personal replay polish. Its local implementation includes
explicit publication, optional automatic sharing of future recordings and authorized 2D replay;
release and physical acceptance remain separate. The next approved increment, [kudos](./kudos.md)
(PAR-39), adds reversible support and supporter names to published flights. The numbered order
below is the original proposal.

The direction is a useful personal flight journal that becomes more enjoyable with friends:
share a flight, know when friends are recording, and eventually explore their flights together.
Keep recording available offline and without an account as the social features grow.

The first personal Android test was accepted on 12 September: the standalone app launched offline
after reboot, recorded and saved a walk, retained it after a full app restart, replayed it, and
opened postcard/IGC/JSON share sheets. Exact recording and locked-screen durations were unmeasured;
this does not establish long-flight reliability. Saved replay, the optional live map and
downloaded map areas now have local implementations with separate physical acceptance gates.

## Suggested order

| Stage | Outcome | Starting point / dependency |
| --- | --- | --- |
| 1. Saved replay map | Place your recorded route and replay marker on a geographic 2D map | Provider/native feasibility, existing saved fixes and playback timeline |
| 2. Finish sharing | A polished postcard that arrives correctly in social apps | Existing PNG composer and native share flow |
| 3. Improve replay | Comfortable, reliable playback of your own flights | Existing offline route/chart player plus focused map acceptance |
| 4. Add friends | Invite and connect with people you choose | Optional accounts exist; social identity and permissions are new |
| 5. Flying notifications | Opt-in updates when friends start a recording | Accepted friendships, preferences and a separate status-delivery design |
| 6. Watch shared flights | Open and replay a friend's completed flight | Publication consent, access checks and downloadable replay data |
| Later: 3D replay | Explore the route in three dimensions | Proven 2D map behavior and measured native performance |
| Later: remote live viewing | Watch an explicitly shared flight in progress | Reliable status delivery, access controls and measured battery/network cost |

Stages 1–3 can progress independently of social work. Friends and basic status notifications
do not need 3D maps. Shared completed flights can initially use the existing 2D presentation.
Cloud restoration is a separate supporting track; social viewing must not require inventing
local recorder evidence for somebody else's flight.

Downloadable map areas and the optional map during the pilot's own recording are implemented
locally. Their measured Android acceptance remains the next feature-specific gate.

## 1. Add a geographic map to saved replay

**Goal:** replay a saved flight against geographic context while keeping the current offline grid
and recorded timing available.

The owner expanded Cycle 1 (12–18 September) on 12 September after accepting the first internal
test. The owner then approved Mapbox Outdoors implementation. PAR-19 (native Mapbox proof) and
PAR-20 (implementation) remain In Progress while PAR-19's remaining checks are open. PAR-27
(focused Android map acceptance) is In Progress. All three belong to the owner. Historical APK
`ef8278c3f6ad` retained all three flights and passed initial map/manual-selector checks; the owner
also confirmed its offline Grid Play/Pause/scrubbing. The owner now approved removing that selector:
open Map automatically when configured, fall back to Grid when unavailable, and offer Retry map
after a failed attempt. Earlier APK `44058268580d` was installed with a matching phone checksum;
all three flights remain. It opens Outdoors directly with no selector, and pan/Fit restores the
full route. Automated fallback/retry checks passed; physical failure/retry and offline fallback
on this UI remain pending.
Malaysian coverage, map tile-failure/retry, offline basemap behavior and broader resource/performance
checks remain open. A pre-existing Home/return replay-time reset
is tracked in PAR-3; the recorder recovery gate is preserved. EAS preview configuration is pending.
The [saved-flight map plan](https://linear.app/sentiment-hound/document/saved-flight-maps-cycle-plan-and-future-in-flight-design-fecd2d3a6c12)
owns the detailed implementation decisions and acceptance cases.

The owner also selected [PAR-30](https://linear.app/sentiment-hound/issue/PAR-30/add-static-flight-maps-to-logbook-and-flight-details)
for this cycle: static Outdoors basemap images on Logbook cards and flight detail, with local
route/Start/Stop overlays and no pilot. It is In Progress, blocked by PAR-19 and related to PAR-20.
Use Expo Image disk caching and visible-card requests, with Grid during loading/failure/timeout.
The provider receives the viewport, not encoded route overlays. Combined APK `8b743aee52e2` is
installed with matching checksum and all three flights retained; static card/detail maps, local
Start/Stop labels, card navigation and full attribution passed. The target overlay pan/refit check
passed on its immediate predecessor, with only detail-corner styling changed afterward.
PAR-27 retains forced failure/offline/retry, Malaysian coverage and long-list stress checks.

- Use `@rnmapbox/maps` 10.3.5, its default Android Mapbox SDK 11.23.1, and the explicit style
  `mapbox://styles/mapbox/outdoors-v12`. [Outdoors is a classic style](https://docs.mapbox.com/map-styles/reference/outdoors/)
  that remains available but is no longer actively maintained; this is the owner's chosen style.
  The selected Android setup uses a public `pk.` token only. PAR-28 now adds explicit downloaded
  regions and a shared store; [its storage policy](./offline-maps.md#transfer-and-storage-policy)
  preserves a recording reserve without claiming a measured country-size limit or device acceptance.
- Aim for worldwide online map coverage, with Singapore walks and Malaysian flying areas as the
  primary coverage checks, not a geographic restriction. Saved walks are valid test recordings;
  the recorder still uses manual Start/Stop and GPS without requiring detected flight.
- Show the saved route and playback marker, support pan/zoom, and keep attribution visible.
  A map-only **Fit flight** target icon at bottom right refits the entire route after pan/zoom;
  its phone pan/refit evidence is recorded in the map guide.
  Use the existing playback timestamp and original retained fixes; preserve gaps and
  partial-flight labels. Geographic context must not change route/chart/telemetry timing.
- Keep the map component focused on presentation. Use separate saved-replay and live-recorder
  adapters; the in-flight map consumes recorder-captured fixes without starting a second
  GPS watcher or making capture depend on map rendering/network access.
- Open Map whenever configured, with no Map/Grid selector. Automatically use Grid for missing
  configuration, native failure or a 15-second initial-load timeout; offer **Retry map** after
  a failed attempt. Preserve replay position/playback through automatic fallback and retry.
  PAR-28 adds explicit region downloads for both native map consumers; its cold-start offline
  acceptance remains separate from the fallback implementation.
- PAR-27 owns focused Android checks for placement, camera controls, fallback/attribution,
  playback regressions and relevant performance. Broader replay/lifecycle and long-flight suites
  remain PAR-3/PAR-5 in Backlog; PAR-5 is not an implementation prerequisite for PAR-20.

**Done when:** a named standalone Android build passes the focused map checks, the saved route is
placed correctly, replay timing remains honest, and the offline grid works when tiles cannot load.
The [map implementation guide](./saved-replay-maps.md) records the chosen configuration and checks.

**Map work:** PAR-28's [local implementation](./offline-maps.md) provides destination search,
downloaded areas, storage/attribution and recoverable deletion. It still needs measured
local/province/small-country downloads and physical offline/overlap acceptance.
PAR-29's local optional in-flight map consumes captured fixes and awaits PAR-37 Android acceptance.
Neither feature publishes live location to anyone else.

## 2. Finish flight sharing for social media

**Goal:** make the existing Share postcard flow feel finished and dependable.

- Verify all three scenes in Square and Story on a physical Android phone, including actual
  exported dimensions, fonts, route proportions, missing GPS, partial flights and timing gaps.
- Check long titles, emoji, the full caption length, signature opt-out, site attribution,
  keyboard access, enlarged text and Android Back.
- Exercise offline creation, rapid Share taps, background/close during preparation, cancellation
  and retry. The draft should survive a dismissed share sheet; cancellation must not look like
  a successful post.
- Preview attachments in the social/messaging apps the pilot actually uses, then discard the
  test drafts. Resolve cropping or handoff problems found there. Repeat on iOS before claiming
  iOS sharing is ready.

**Done when:** the saved PNG matches the preview, chosen receiving apps accept it, cancellation
and retry behave correctly, and temporary-file cleanup preserves files already handed off.

**Later options:** more postcard layouts, optional photos, Save to Photos, or a short replay
video. Choose these after image sharing is accepted; none is required to finish the current flow.
Interactive shared links belong to stage 6.

## 3. Improve replay of your own flights

**Goal:** make revisiting a flight dependable across representative recordings, beyond the focused
checks required for the first geographic map.

- Validate route/chart synchronization, speed controls, scrubbing, end/restart and navigation
  on a real device. Returning from another screen or the background should remain paused.
- Check long recordings for loading time, smooth scrubbing and memory release after exit.
  Include stationary sections, missing altitude/speed, gaps and saved-partial recordings.
- Refine the timeline and telemetry layout based on those checks. Explore tapping the chart to
  seek as a small follow-up; map pan/zoom and reset-to-fit belong to the saved-map increment.
- Retain accessible timeline controls, enlarged text and reduced-motion behavior.

**Done when:** playback remains responsive on representative long flights and its route, chart
and readouts agree at the same timestamp, including unavailable periods. New interactions must
preserve recorded timing and never draw a flight through a missing segment.

## 4. Friends and a small social foundation

**Selected first stage, 21 September 2026:** connect with people you know and open their basic
profile. [Friends v1](./friends.md) is the implementation and acceptance record for PAR-12–14.

- Add a minimal social profile with a chosen display name and initials, separate from private
  email, registration details and the local pilot profile used for export.
- Find pilots by display name or editable unique username, with a search-visibility switch.
  Send an explicit request; support accept, decline, cancel, remove and block. This approved
  PAR-14 expansion replaces invitation codes. Contact uploads and email search remain excluded.
- Add a Friends tab with accepted connections, pending requests and a blocked list. Accepted
  profiles show only display identity and a server-derived **Backed-up flights** count.
- Enforce access on the server, including pending, removed and blocked relationships. Keep
  private backup and its owner-only storage separate from content deliberately shared.

**Done when:** two accounts can establish and remove a connection, a third account cannot read
their private activity, and removal/blocking stops future access and notifications.

The v1 foundation deliberately excluded individual flights and replay. The next selected slice
now implements the accepted-friends feed and shared replay described below. Kudos is implemented as
PAR-39; notifications remain deferred. Social viewing is online and held only in memory for the current signed-in
account. External postcard sharing remains separate. Signing in alone does not publish a profile
or a flight.

## 5. Basic notifications when friends are flying

**Goal:** a small opt-in update, not continuous location tracking.

The app currently starts and stops recording manually. A recording start does not prove
takeoff, and Stop does not prove landing. Use wording such as “Alex started a flight recording”
until an explicit pilot status or validated detection feature can support “flying”/“landed.”

- Let the pilot enable status sharing and recipients opt into alerts. Begin with a start event;
  an ended-recording event can follow if useful. Exact coordinates are not needed for this step.
- Send one logical update per event despite retries, reconnects or recovery restarts. A status
  should expire or become “last updated…” when fresh information stops arriving.
- Handle denied notification permission, token changes, muted friends, blocks and removals.
  Decide when delayed offline events should be suppressed rather than delivered as live news.
- Design a small separate status path. Existing cloud backup intentionally pauses during
  recording; enabling ordinary backup in the air is not the implementation of this feature.
  Status delivery must not block capture or perform network work inside recording transactions.

**Done when:** accepted, opted-in friends receive a single relevant alert; unrelated or muted
accounts do not; offline delivery is honest about freshness; recording still works when the
notification service fails. This is social awareness, not an emergency or safety service.

## 6. Watch a friend's saved flight

**Implemented and deployed, 21 September 2026:** open a published flight from the Friends
feed and replay it with the existing 2D presentation. [Shared flights](./shared-flights.md) owns
the exact contract and acceptance ledger; interactive links remain a later extension.

- Manual sharing of saved flights and explicit automatic-sharing consent, off by default, cover
  the title, site, dates/times, full route including endpoints, approved statistics and replay.
  Current accepted friends see all published history; this is not a per-flight recipient picker.
- Automatic sharing covers future recordings only after save/backup. Disabling stops future posts;
  existing posts require Hide. Durable retries cannot override a newer Hide or consent change.
- A versioned, validated artifact is projected from saved GPS or verified IGC. Preserve provenance,
  missing speed, precision, partial flights and timing gaps; never create a viewer's recorder session
  or alter their personal totals. Original IGCs and diagnostics remain private.
- Remote viewing is online and memory-only, cleared on background/offline/account changes. Every
  fetch checks current friendship and publication access. Existing views reauthorize on focus,
  refresh and reconnect; there is no push revocation or ability to recall a viewer's screenshots.
- Title/site edits appear after backup sync without bumping feed time. Friends management remains
  accessible from the feed. [Kudos](./kudos.md) extends this in PAR-39; comments, notifications
  and public links remain deferred.
- Route trimming and endpoint privacy zones remain a prerequisite to reconsider before broader
  publication, not part of this consented full-route implementation.

**Done when:** a friend can open a deliberately shared completed flight, see its owner and data
limits, replay it correctly, and lose future access when it is unshared or the relationship ends.

**Current extension:** one reversible kudos per friend and publication, with paginated current
display names and initials. Own posts show supporters without self-kudos. Names are visible to
every authorized flight viewer, with either-direction blocks excluded from both names and count.
Hide/re-share preserves reactions; removing the author/reactor friendship deletes them permanently.
The [kudos guide](./kudos.md) owns the implementation and acceptance record.

**Later extension:** revocable share links with a lightweight web viewer and social preview.
There is no web app today; hosting, audience rules, link expiry and previews need their own work.
Public links should expose only the approved shared representation, never the private IGC bucket.

## Later: a 3D replay experiment

**Goal:** see where a route sits in the landscape, then explore it in three dimensions.

After geographic 2D replay is accepted, PAR-21 can prototype terrain with an orbit camera and a
follow-pilot camera. Synchronize the existing timeline/chart with the 3D scene. Compare GPS
altitude's reference with the terrain dataset's reference; do not imply terrain clearance or
silently snap inaccurate GPS to the ground.
Show missing altitude and gaps honestly. Measure memory, frame rate, battery use and long-flight
loading on the target phone, then decide whether the prototype merits a product feature.

**Done when:** the map has correct route placement and attribution, a useful offline fallback,
and acceptable device performance. Promote 3D only after those checks, with a simple 2D option
remaining available for devices or situations where 3D is unsuitable.

## Later: watch somebody else's flight live

Remote live viewing is separate from an on-device map of your own recording, a start notification
or replaying a saved flight. It needs explicit per-flight broadcast consent, audience controls,
a location-delivery protocol and a clear end or
expiry state. Show last-update time, gaps and disconnection; never infer fresh positions from old
samples. Plan bounded buffering, delivery cadence and battery/data budgets before implementation.

Build this only after shared-flight permissions and status freshness work well. Failure of live
viewing must leave local recording intact. Public live broadcasting, group races and multi-pilot
comparison are ideas for later discussion, not part of the first social increment.

## Supporting work to keep alongside the roadmap

| Track | Work still needed |
| --- | --- |
| Recorder confidence | Physical foreground and locked-screen trials, a two-hour rehearsal and six-hour endurance run; Recents removal, force-stop and Stop/recovery crash boundaries; reconcile persisted rows and repeated IGC/JSON exports. Record battery, GPS gaps, accuracy and pressure continuity against a named build. |
| Cloud restoration | Restore summaries and archived IGCs on a new device without claiming recovered raw evidence. Define remote/archive provenance, duplicates and conflict handling separately from captured sessions. |
| Platform readiness | Complete Android accessibility/device acceptance and iOS device checks. Coordinate SDK updates with the installed TaskManager patch and a rebuilt native client. |
| Release preparation | Verify hosted email/backup/account deletion end to end; prepare privacy and deletion pages, credentials, signing and store submission separately from local feature work. |

For every increment, test observable behavior and keep one primary owner for each rule.
Preserve recording integrity, deterministic exports, truthful gaps, private metadata and
cancellation behavior. Use the [README checks](../README.md#validation); record physical results
with the device and build instead of treating automated success as field acceptance.
