# Journal and replay delivery record

Implementation date: 2026-09-05. Starting checkout: `main`, `5b9ec4e`, clean working tree.
Changes are in the working tree. No device data was reset or deleted.

## Review increments

1. **Shared visuals:** mirrored palette/radii, readable controls, `JournalArt`, three local
   illustrations and their prompts, reduced-motion helper.
2. **Journal/detail/editor:** illustrated season and larger entries, title/site/date/notes,
   primary Replay action, guarded metadata modal and secondary exports/evidence/deletion.
3. **Remaining screens:** setup/preflight illustrations, restrained instruments/recovery,
   pilot page, grouped Settings, permission/backup copy and removal of the fictional capacity policy.
4. **Replay:** domain model, minimal async SQLite reader, separate query tag, geometry,
   local playback controller, native screen/chart/controls and focused regression tests.
5. **Verification/docs:** automated results, synthetic fixture generator, current-state
   UI documentation and ordered backlog. Physical acceptance is still pending.

## Deep review and cleanup

The follow-up code review found and corrected:

- **Metadata overwrite:** saving a title-only edit sent the entire opening draft, which could
  replace notes or site details received from a concurrent refresh. Saves now patch only edited
  fields; site name and attribution remain atomic.
- **Replay sample retention:** skipping a mounted RTK query released the Redux entry but kept
  its previous payload in the hook. The query-owning component now unmounts on blur or recorder
  recovery, releasing both owners. Returning loads a fresh, paused player.
- **Timeline jump:** touch coordinates used the full width while the thumb used an inset span.
  Both now use the thumb-centre span, including the final release position.
- **Motion preference race:** a late initial native read could overwrite a newer accessibility
  change. Live events now take precedence. Focus loss also cancels the animation loop promptly.
- **Editor and read errors:** closed launch-picker actions now lock during saving, and a failed
  flight read presents a retry instead of claiming the flight was deleted.
- **Copy and cleanup:** corrected current-profile IGC export and backup mismatch explanations,
  removed the unused decorative ghost track and capacity remnants, and made pilot-sheet motion
  follow the accessibility setting.

No new faults were found in saved recording bounds, deterministic timestamp deduplication,
gap interpolation, nullable telemetry, chart extrema, fixed projection or deletion invalidation.
This is a code and automated-test assessment; physical acceptance below remains outstanding.

## Automated results

| Check | Result |
| --- | --- |
| Baseline Jest | 522 tests passed before implementation. |
| Initial implementation Jest | 573 tests passed in 52 suites. Guest-capacity tests were replaced with backup-invitation tests; replay/editor tests were added. |
| After deep review Jest | 606 tests passed in 57 suites: 33 additional regression cases. |
| TypeScript | `pnpm typecheck` passed after review. Typed routes were regenerated during initial implementation. |
| Expo lint | Passed with no warnings. |
| Android and iOS exports | Passed after review; local illustrations included. Review bundles: `/tmp/xc-journal-review-export`. |
| Diff whitespace | `git diff --check` passed. |
| SQLite integration | Generated the full v7 schema in isolated in-memory Python SQLite, imported 42,900 synthetic fixes and ran production replay SQL with checked bounds. `EXPLAIN QUERY PLAN` used `location_fixes_source_order`. |
| Dependencies, offline | Installed SDK map reports up to date; this does not check current remote compatibility guidance. |
| Dependencies, online | Reports 21 existing package mismatches with newer SDK 57 patches, including Expo 57.0.20, React Native 0.86.3 and TaskManager 57.0.16. Package/lock/native dependencies are unchanged. A coordinated upgrade needs verification of the pinned TaskManager patch and a native rebuild. |

Coverage includes invalid/mocked/out-of-bounds fixes, timestamp ordering/duplicates, exact gap
boundaries, no extrapolation, missing telemetry, stationary tracks, dateline/projection alignment,
altitude extrema, monotonic timing, speeds, scrubbing, end/restart, AppState/Android focus,
navigation Back, cache release and deletion. Native React renderer tests exercise metadata
save failure/success, duplicate submission, Cancel/Android Back and refresh during an edit.
Review coverage also exercises partial metadata patches, locked picker controls, flight-detail
read errors and action restrictions, the actual playback hook's animation cleanup, timeline
touch/release/cancellation, query-owner unmounting, and the native motion-preference race.
They do not establish device layout.

The twelve-hour geometry test measured **121 ms** to normalize 42,900 usable fixes and derive
2,803 route / 696 chart vertices, then **4 ms** for 10,000 seeks on the development host in one
run. These are host measurements, not Android latency or memory claims. A cache test confirms
a 43,201-point payload leaves Redux after the final unsubscribe. Native heap reclamation and
renderer memory remain physical acceptance items. A separate review run measured 127 ms for
the same preprocessing fixture and 7 ms for 10,000 seeks.

## Physical Android acceptance: not executed

ADB enumeration was attempted, including outside the sandbox. It did not return a usable
device connection before a 15-second timeout. No physical results are claimed. Reconnect the
development client using the README's WSL/ADB workflow, then record results for:

- [ ] Setup → record → stop/save → edit → replay, including Cancel/Back with a draft.
- [ ] Interrupted recording → Resume; separately interrupted recording → Save Partial.
- [ ] Offline synchronized route/chart/scrubber, missing telemetry and timing gaps.
- [ ] Play/Pause, 1×/10×/60×, ±10 seconds, end/restart and scrub-stays-paused.
- [ ] Background/return, notification drawer blur/focus and screen leave/return: no auto-resume.
- [ ] Direct replay link → Android Back → selected flight detail.
- [ ] Twelve-hour loading, scrubbing, exit/reopen and native heap release.
- [ ] Auth/backup pending/error/mismatch states, IGC/diagnostic exports, deletion confirmation,
  and open/processing restrictions after restyling.
- [ ] Small display, enlarged text, TalkBack adjustable timeline, keyboard/site suggestions,
  reduced motion, readable active instruments and hold-to-stop.
- [ ] iOS screen/keyboard/modal/navigation smoke check.

Generate a reviewable fixture without touching a device:

```sh
python3 scripts/create-replay-fixture.py --output /tmp/xc-replay-12h.sql
```

The script refuses to overwrite a file. The SQL creates only `synthetic-replay-12h-v1` and
never replaces existing rows. It includes a five-minute gap, missing altitude/speed periods,
and narrow altitude extremes. Import only into a backed-up or disposable test database after
stopping the app. Open the logbook once to finish metrics, then open the labelled synthetic
flight's replay. Synthetic coordinates are not flight evidence.

## Backlog order

1. **Shareable flight postcards:** next product increment, using real routes/statistics,
   explicit sharing, and truthful partial/gap labels.
2. **Cloud restoration:** retrieve cloud-only flights on a new device. Existing push-only
   backup, metadata merge and cloud-only counts do not implement restoration.
3. **Geographic maps:** provider, offline storage and licensing decisions. The current grid
   has no geographic background or pan/zoom.
4. **Shareable flight links.**
5. **Friends/community.**

No search/filter system, achievement engine, avatar uploads, icon redesign, cloud fixes or
native SDK upgrade were added. Recorder endurance acceptance and dependency maintenance sit
alongside this product backlog.
