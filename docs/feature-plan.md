# Feature plan and roadmap

Updated 6 September 2026. This is a proposed product direction, not a delivery schedule or a
claim that future features exist. The [project overview](./project-overview.md) describes today.

The direction is a useful personal flight journal that becomes more enjoyable with friends:
share a flight, know when friends are recording, and eventually explore their flights together.
Keep recording available offline and without an account as the social features grow.

## Suggested order

| Stage | Outcome | Starting point / dependency |
| --- | --- | --- |
| 1. Finish sharing | A polished postcard that arrives correctly in social apps | Existing PNG composer and native share flow |
| 2. Improve replay | Comfortable, reliable playback of your own flights | Existing offline route/chart player |
| 3. Add friends | Invite and connect with people you choose | Optional accounts exist; social identity and permissions are new |
| 4. Flying notifications | Opt-in updates when friends start a recording | Accepted friendships, preferences and a separate status-delivery design |
| 5. Watch shared flights | Open and replay a friend's completed flight | Publication consent, access checks and downloadable replay data |
| 6. Geographic maps, then 3D | Explore routes in their real terrain | Map/data-provider research and proven replay performance |
| Later: live viewing | Watch an explicitly shared flight in progress | Reliable status delivery, access controls and measured battery/network cost |

Stages 1–2 can progress independently of social work. Friends and basic status notifications
do not need 3D maps. Shared completed flights can initially use the existing 2D presentation.
Cloud restoration is a separate supporting track; social viewing must not require inventing
local recorder evidence for somebody else's flight.

## 1. Finish flight sharing for social media

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
Interactive shared links belong to stage 5.

## 2. Improve replay of your own flights

**Goal:** make revisiting a flight easy before adding a more demanding map renderer.

- Validate route/chart synchronization, speed controls, scrubbing, end/restart and navigation
  on a real device. Returning from another screen or the background should remain paused.
- Check long recordings for loading time, smooth scrubbing and memory release after exit.
  Include stationary sections, missing altitude/speed, gaps and saved-partial recordings.
- Refine the timeline and telemetry layout based on those checks. Explore route pan/zoom,
  tapping the chart to seek and a reset-view action as small follow-up increments.
- Retain accessible timeline controls, enlarged text and reduced-motion behavior.

**Done when:** playback remains responsive on representative long flights and its route, chart
and readouts agree at the same timestamp, including unavailable periods. New interactions must
preserve recorded timing and never draw a flight through a missing segment.

## 3. Friends and a small social foundation

**Goal:** connect with people you know without needing a public feed.

- Add a minimal social profile with a chosen display identity, separate from private email,
  registration details and the local pilot profile used for export.
- Start with an invite link or exact handle/code lookup. Support send, accept, decline,
  cancel, remove and block. Contact uploads and a searchable email directory are unnecessary.
- Add a Friends screen with accepted connections and pending requests. Establish global and
  per-friend sharing/notification preferences before showing flight activity.
- Enforce access on the server, including pending, removed and blocked relationships. Keep
  private backup and its owner-only storage separate from content deliberately shared.

**Done when:** two accounts can establish and remove a connection, a third account cannot read
their private activity, and removal/blocking stops future access and notifications.

**Decisions before implementation:** invite link versus handle, public profile fields, whether
to share with all accepted friends or selected friends, and notification defaults.

## 4. Basic notifications when friends are flying

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

## 5. Watch a friend's saved flight and share interactive links

**Goal:** open a selected flight and replay it, initially using the same 2D experience as your own.

- Let the owner explicitly publish a finished flight to chosen friends. Keep other flights and
  private notes private. Show the fields and route that will be shared before publication.
- Define a downloadable, versioned replay artifact and a separate read model for remote flights.
  Decide between an export derived from retained fixes and an IGC-derived route. An IGC-derived
  replay cannot recreate the original subsecond samples or every piece of telemetry.
- Preserve provenance, missing data and partial/gap labels. Viewing a friend's flight must not
  create a fake locally recorded session or alter the viewer's personal flight totals.
- Support unsharing, deletion and permission changes. Check access on every fetch and remove
  cached remote content when revocation is discovered, including on reconnect. Decide whether
  remote flights can be opened offline and for how long. Previously exported images or downloaded
  files cannot be recalled; make that distinction clear.
- Consider route trimming or hiding launch/landing locations before broader publication.

**Done when:** a friend can open a deliberately shared completed flight, see its owner and data
limits, replay it correctly, and lose future access when it is unshared or the relationship ends.

**Next extension:** revocable share links with a lightweight web viewer and social preview.
There is no web app today; hosting, audience rules, link expiry and previews need their own work.
Public links should expose only the approved shared representation, never the private IGC bucket.

## 6. Geographic maps, then a 3D replay experiment

**Goal:** see where a route sits in the landscape, then explore it in three dimensions.

First add an optional geographic 2D map with route, pilot marker, pan/zoom and reset-to-fit.
Keep the current offline grid available when map data cannot load. Research provider coverage,
attribution/licensing, tile costs, offline-download rights, cache limits and native compatibility
before choosing a library or service. This document makes no provider commitment.

Once that works, prototype terrain with an orbit camera and a follow-pilot camera. Synchronize
the existing timeline/chart with the 3D scene. Compare GPS altitude's reference with the terrain
dataset's reference; do not imply terrain clearance or silently snap inaccurate GPS to the ground.
Show missing altitude and gaps honestly. Measure memory, frame rate, battery use and long-flight
loading on the target phone, then decide whether the prototype merits a product feature.

**Done when:** the map has correct route placement and attribution, a useful offline fallback,
and acceptable device performance. Promote 3D only after those checks, with a simple 2D option
remaining available for devices or situations where 3D is unsuitable.

## Later: watch a flight live

Live viewing is separate from a start notification or replaying a saved flight. It needs explicit
per-flight broadcast consent, audience controls, a location-delivery protocol and a clear end or
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
