# Illustrated flight journal and offline replay

Current implementation, 2026-09-05. Physical Android acceptance remains pending; see
[verification and backlog](./journal-replay-verification.md).

## Visual language

Warm ivory (`#F7F3E8`), forest ink (`#203F36`), burnt-orange actions (`#B74E29`), blue
altitude (`#356C88`), rounded journal cards and generous spacing. Archivo and IBM Plex Mono
remain the installed fonts. `src/ui/theme.ts` and `src/global.css` share tested tokens.
Font family names carry their weights; do not add `fontWeight` to those families.

Three generated gouache landscapes are bundled in `assets/images/journal/`: flight above
mountain ridges, canopy at launch, and landing valley. [Prompts and provenance](../assets/images/journal/README.md)
record the built-in image-generation tool used. `JournalArt` is decorative and excluded from
screen-reader navigation. Artwork is separate from every GPS route plot. Assets add about 7.2 MB
before packaging compression and work offline.

## Screens

| Surface | Current behavior |
| --- | --- |
| Setup overlay | Illustrated welcome, acknowledgment, numbered steps, Back/Skip, optional pilot/glider/account setup, location and notification actions. Permission copy describes requirements without promising uninterrupted capture. |
| `/` | Personal journal heading, illustrated local season totals, dated entries with full-width routes, pinned unfinished flight, setup checklist, dismissible backup invitation and Record. No guest flight limit or prompts to remove old flights. |
| `/record`, preflight | Launch illustration and readiness checklist. Existing blocked/degraded states, permission requests, system settings and Start remain. |
| `/record`, active/recovery | Solid instrument surfaces, large numbers, capture-health distinctions, hold-to-stop, retry save, Resume and Save Partial. No decorative illustration. |
| `/flights/[id]` | Title/site/date, route, statistics, personal insight and notes. Replay flight is primary for finished, non-processing flights, with Share postcard immediately below. Edit flight opens a native modal. IGC, collapsed recording evidence, diagnostics and confirmed deletion remain secondary. |
| `/flights/[id]/replay` | Offline route, moving pilot, start/end markers, GPS-altitude chart, elapsed time/altitude/speed, scrubber, ±10 seconds, Play/Pause and 1×/10×/60×. |
| `/account` | Illustrated pilot page, identity, glider and local totals above separate backup/auth controls. Sign-in, restoring, unavailable, mismatch, error, sign-out and account deletion states remain. |
| `/settings` | Grouped notebook rows. Review setup reopens setup; technical version/runtime/schema rows are under App details. |

The app remains metric, Android first, and compatible with iOS. Two-tab navigation is unchanged.
Button labels, checklist rows and replay readouts can wrap for narrow screens and larger text.
These accommodations still need physical accessibility and keyboard acceptance.

## Metadata editor

`MetadataSheet` mounts a fresh draft on every open. A remote metadata refresh cannot replace an
active draft. Saving patches only edited fields, preserving concurrent changes to untouched fields.
Site name and attribution are updated together. Cancel and Android Back share a discard confirmation. Save locks fields and close
actions, prevents repeat submissions, displays errors inside the modal, and closes only after
`updateFlight` succeeds. Site suggestions, takeoff coordinates and catalogue attribution remain.
Successful saves request sync through the existing flow. The editor does not write track samples.

Open/processing restrictions on replay, export and deletion remain. Metadata editing retains its
existing availability. Delete copy describes local removal and queued cloud deletion. Signing in
is never presented as proof that an upload completed.

## Postcards

The subsequent [postcard increment](./postcard-verification.md) adds a full-screen composer using
the same three local illustrations. Its mounted preview is captured as a 1080 × 1080 Square or
1080 × 1920 Story PNG. Controls follow system text size; typography within the fixed composition
scales with the preview width. Title/caption overflow is ellipsized on the image itself.
The actual stored route has its own plain panel and preserves proportions and gaps.
Captions remain temporary and independent of flight notes; optional signatures use a saved pilot
name. Cancel/Android Back protect a nonempty caption. Sharing preserves the draft without claiming
the image was posted. This increment adds a native capture dependency and needs a client rebuild.

## Replay implementation

- `FlightRepository.getReplay` calls the async SQLite reader in `src/recorder/replay-repository-core.ts`.
  Only the selected flight/session header and required GPS columns are read. Pressure, diagnostic
  events and thumbnail caches are not loaded by this query. No schema migration, native dependency,
  cloud API or recorder-service change is required.
- The existing `(session_id, source_timestamp, sequence)` index supports the bounded query.
  Invalid/mocked coordinates are excluded. Source timestamps sort deterministically; the highest
  usable sequence wins duplicates. Nonfinite/missing altitude and negative/nonfinite/missing speed
  remain unavailable instead of becoming zero.
- Bounds are saved session start/end, capped by a saved manual stop; endpoints are inclusive.
  Replay retains subsecond timestamps and original timing. Partial flights are labelled.
  Missing/open/processing/invalid-bound recordings and fewer than two distinct usable timestamps
  have explanatory states.
- Interpolation is limited to **15 seconds or less**. Longer gaps and time outside the available
  fixes show no moving marker or telemetry. Exact fixes at gap edges retain their values.
  Missing altitude breaks only the chart.
- `src/lib/replay/geometry.ts` makes one fixed projection for route and pilot. Static paths are
  memoized per data/view change. Route simplification uses bounded chunks with sub-unit tolerance;
  altitude envelopes retain first/last/min/max per horizontal pixel within each continuous run.
  Gaps and isolated samples remain visible. Animation uses binary search and projected interpolation
  without rebuilding paths or accessing SQLite.
- `getFlightReplay` has its own RTK Query tag and `keepUnusedDataFor: 0`. Only the focused screen
  subscribes. Leaving unmounts both the query hook and player, releasing their sample references
  as well as the Redux entry; reopening starts paused at the
  beginning. Metadata never invalidates replay. Successful deletion does; failed deletion preserves
  it. Responses arriving after unsubscribe are also released.

## Playback lifecycle and accessibility

Local playback uses `performance.now()`, opening **paused at 60×**. Scrubbing and seeking pause
and leave it paused. Reaching the end stops it; Play again restarts. Screen blur, AppState
background/inactive and Android interaction blur pause. Returning never resumes automatically.

Android Back and visible Back use `dismissTo` to reach the selected flight detail; a directly
opened replay replaces itself with that detail. Swipe-back is disabled on this screen to keep
that destination consistent. The timeline exposes native adjustable accessibility actions in
ten-second steps and elapsed/total time. Native text supplies telemetry without continuous live
announcements. Start/end markers have different shapes. Reduced motion disables decorative pulses,
navigation and flight/pilot-editor transitions, and steps user-started replay at 4 Hz; otherwise drawing
updates are capped at 30 Hz.

## References consulted

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo SQLite 57 async reads](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Expo Router 57 navigation](https://docs.expo.dev/versions/v57.0.0/sdk/router/)
- [React Native AppState change, blur and focus](https://reactnative.dev/docs/appstate)

The earlier notebook styling came from the Claude Design project
[MVP app UI design](https://claude.ai/design/p/1b347570-d36c-443c-86a4-421df6e66287?file=XC+Tracker+UI.dc.html).
This document describes the current journal milestone, not that earlier design's unsupported screens.
