# Stage 4 verification and acceptance

Contract: [personal Home and journal filters](../../new-design/stage-4.md). Tickets: PAR-42, PAR-50/51 and the personal Home slice of PAR-44. Mixed Home source queries and publication badges remain in [PAR-71](https://linear.app/sentiment-hound/issue/PAR-71).

## Automated coverage

- `journal-query.test.ts`: filter composition, historical and explicit-none equipment, normalized sites, calendar boundaries, overlapping quality, partial records without metrics, metric coverage/unknowns, deterministic date/metric ordering, duplicate aircraft labels, retained empty selections and a 12,000-flight catalogue.
- `journal-filter-sheet.test.ts`: explicit Apply (including zero results), draft Reset/Cancel/reopen, keyboard-first Back, single year/sort selections, catalogue refresh, current-year availability and bounded site/aircraft paging with search/selection persistence.
- `journal-view-state.test.ts`, `journal-identity-bridge.test.ts`: navigation memory, fresh-store defaults, actual provider authentication/owner events, same-account refresh, synchronous archive boundaries, dismissed drafts and stale Apply rejection.
- `logbook-screen.test.ts`: pinned recovery, visible/focused map previews, no repository refetch/sync during filter changes, summary/list agreement, empty/no-match/error distinctions, remount persistence and stale callbacks that must not close a newer sheet.
- `journal-cards.test.ts`: complete, partial/gaps, no-track, processing and restored cards; metrics independent of file availability; explicit labels, coverage and unavailable versus measured-zero values.

The existing cloud-sync provider suite retains recovery, foreground/network and subscription cleanup coverage. Its test environment now uses the same Node export conditions as the other Redux tests. No production dependency changed.

## Final Build C verification

Source commit: `82ed2495c465defe698aa6dc9b62ed0f6cf29f5b`. Node `v24.16.0` full `pnpm test` passed: types, lint and 3 architecture checks; **145 Jest suites / 1,436 tests; 71 Deno tests; 15 SQL suites / 522 assertions**; generated database types match. Total verification: **108.3 seconds**. The Android release build passed in **1 minute 7 seconds**.

[Verification receipt](logs/verification.json) records log hashes and results. [Build C identity](build-identity.json) records the APK, bundle, source-map/source comparison and build inputs. Final APK SHA-256: `a11210c1fb496e1cc410cde72e8387c6c335d426a0496142d619733cdc744d30`. The separate initial Android export passed; the final C release also bundled the updated application.

`pnpm validate:deps` remains a separate **exit 1** check reporting 27 existing Expo/React Native patch-version recommendations. Dependencies were not upgraded. This is not reported as a passing check.

After preserving the QA APK, bundle and source maps, the generated Android project was restored to the ordinary `com.xxvalhallacoderxx.xcmvp` / Flight Log Alpha configuration, with INTERNET and `allowBackup=false`. `package.json` and the lockfile remain unchanged. The installed QA APK remains the frozen Build C artifact.

## Physical QA builds and fixes

The named **Flight Log Stage 4 QA** installation is isolated at `com.xxvalhallacoderxx.xcmvp.stage4qa`, retaining INTERNET and disabling Android app backup. Logs and APKs are local ignored artifacts under `.artifacts/stage4/`; evidence receipts belong here.

| Build | Source | Physical QA finding / change |
|---|---|---|
| [A](build-a-identity.json) | `c132516` | Initial personal Home/filter implementation. The full zero-result summary pushed the no-match message below the visible area. |
| [B](build-b-identity.json) | `8707d50` | Replaced the zero-result summary with compact result information, keeping the no-match explanation/actions visible. Populated search then exposed a footer hidden by the Android keyboard. |
| [C](build-identity.json) | `82ed249` | Added Android height-based keyboard avoidance to keep filter actions above the keyboard. Final physical interaction acceptance is recorded separately. |

The device is a Samsung SM-S938B running Android 16. **All further phone QA must retain the user's original font scale `0.8` and density override `560`. Do not change phone display settings.** Those originals were restored when the user imposed this restriction. [Screenshot 04](screens/04-large-text-filter-sheet.png) was captured before the restriction, on an earlier build; it does not establish final enlarged-text or TalkBack acceptance. Enlarged-text testing is deferred under the restriction, and TalkBack remains unverified.

## Completed observations on Builds A and B

The following are the device operator's completed checks, scoped to the named build. Screenshots show rendered states; the interaction results are recorded from the operator's run, not inferred from a still image.

| Build | Completed check | Evidence / observed result |
|---|---|---|
| A | Empty Home and filter sheet | [Empty Home](screens/01-empty-home.png), [empty filter sheet](screens/02-empty-filter-sheet.png). Applying Year 2026 with zero matches succeeded. |
| A | Draft discard and launch reset | Reset changed only the draft; Android Back preserved the applied Year filter. Force-stop/relaunch reset applied filters. [Original no-match state](screens/03-no-matches.png) also records the layout problem subsequently fixed in B. |
| B | Compact zero-results state | [No matches](screens/05-build-b-no-matches.png) shows the B correction. |
| B | Populated Home and good-track card | [Populated journal](screens/06-populated-home.png), [good-track card](screens/09-good-track-card.png), using synthetic fixtures. |
| B | OR/AND composition, summary and navigation memory | Alpine + High Pass sites, AND aircraft Cirrus 4, produced 2 flights. Summary: 1h 54m total, 1h 08m longest recording, 13.8km longest track. Pilot → Home retained applied filters. [Filtered Home](screens/07-applied-or-and-filters.png). |
| B | Search selection retention and Back/Cancel | Searching Alpine hid the selected High Pass option without clearing it. First Back dismissed the keyboard while retaining the sheet; Cancel preserved applied criteria. [Search/keyboard](screens/08-site-search-keyboard.png) also records the footer-obstruction problem fixed in C. |

The separate instrumentation companion successfully seeded **8 local and 2 restored synthetic rows** on Build B with no cloud binding. It preserved profile/settings and uses only the isolated QA package. The processing fixture is a deliberately persistent presentation state; restored rows contain no real remote IGC object. These fixtures establish presentation inputs, not real recording, processing, backup or restore behavior. The seed receipt is `.artifacts/stage4/fixture-seed.txt`; it identifies Build B and must not be relabelled as a C execution.

## Confirmed Build C checks

The operator confirmed the following on the final Build C APK at the unchanged user display settings. The [device receipt](logs/device-results.json) records the installed APK hash, scenario outcomes, cleanup, screenshot hashes and remaining checks.

| Check | Confirmed result / evidence |
|---|---|
| Keyboard, Apply and Back | The filter action stayed above the keyboard in [search](screens/10-build-c-search-keyboard.png) and [direct Apply](screens/11-build-c-keyboard-apply.png). Applying with the keyboard visible returned 2 flights. First Back dismissed the keyboard and preserved the draft; second Back dismissed the sheet and preserved the applied site filter. |
| Zero results and clear all | [Zero matches](screens/12-build-c-no-matches.png) displayed the compact state and both actions. Clear all restored all 10 saved rows. |
| Cards and route/file distinctions | Inspected [good track](screens/13-build-c-good-track.png), [gaps](screens/14-build-c-gaps.png), [partial](screens/15-build-c-partial.png), [no usable track](screens/16-build-c-no-track-processing.png), [processing](screens/17-build-c-processing-restored.png), [restored IGC pending](screens/18-build-c-restored-pending.png), and [restored metrics unavailable](screens/19-build-c-oldest.png). These are synthetic presentation checks; real restore/recorder behavior remains separate. |
| All four sorts and summary | Newest showed QA 01 first; oldest showed QA 09; longest recorded time and longest track distance both showed QA 08. Labels/top-row checks are recorded in `.artifacts/stage4/scenario-sorts.json`; [duration](screens/20-build-c-duration.png) and [distance](screens/21-build-c-distance.png) screenshots supplement them. All-history summary: 10 flights, 5h 10m from 8 measured recordings, longest recording 1h 33m, longest track 22.1km, distance coverage 7/10. |
| Missing measurements, navigation and launch reset | Unknown-quality filtering returned 2 rows, with all summary measurements shown as em dashes and time/distance coverage 0/2. [Unknown metrics](screens/22-build-c-unknown-metrics.png). Pilot → Home retained those 2 results; force-stop/relaunch returned all 10 with newest first. Receipt: `.artifacts/stage4/scenario-unknown.json`. |
| Draft Reset and Cancel | Reset changed only the draft; Cancel preserved the applied Alpine filter and its 2 flights. |
| Detail Back and clear-one | Opened QA 01 detail; Android Back returned with the Alpine site filter and 2-flight summary unchanged. Removing the single active site chip restored all 10 rows/default criteria. Receipt: `.artifacts/stage4/scenario-detail.json`. |
| Interrupted entry | The [synthetic interrupted banner](screens/23-build-c-interrupted.png) remained outside the 10-flight/5h 10m summary and stayed visible with [zero matching saved flights](screens/24-build-c-interrupted-filtered.png). “Look at the recorder first” opened the existing interrupted recorder; Android Back preserved filters. Resume and Save were not invoked. |

The temporary interrupted fixture was removed successfully, leaving zero unfinished sessions and the original 10 synthetic saved rows. The fixture companion was uninstalled. [Final Home](screens/25-build-c-final-home.png) is ready for user review at all-history/newest defaults. Instrumentation independently verified the installed Build C APK hash; the final read-only settings comparison matched the original baseline, including font scale, density, accessibility and network settings. Normal Flight Log and Stage 1–3 data were not changed.

## Remaining physical acceptance

Only the checks below remain pending or deferred in this matrix. Earlier A/B checks retain their build-specific scope; the confirmed C results above are not pending a blanket regression pass. See the [device receipt](logs/device-results.json) for the final outcomes and limitations.

| Area | Remaining evidence |
|---|---|
| Additional filter coverage | Physical option paging and remaining year/sport/historical-aircraft/quality-overlap combinations beyond the confirmed cases. Automated coverage is already recorded above. |
| Recorder lifecycle | Live active recorder entry and field recovery retain their existing acceptance owners. The synthetic interrupted banner and entry navigation passed; they do not prove recording or recovery reliability. |
| Offline and account boundaries | Saved history/filter behavior without network; real account/owner reset and error/retry. Synthetic unavailable-file cards are already inspected but do not prove a real account transition or IGC download. |
| Accessibility | Broader reachability/long-label coverage and TalkBack labels/focus remain pending. Enlarged text is deferred under the no-display-change restriction. |

Use dedicated QA identities and synthetic flight data. Do not reset or replace the normal application or existing Stage 1–3 data. No new hosted deployment/migration is part of Stage 4. PAR-50/51 remain In Progress until screen acceptance; broader accessibility, recorder field reliability and earlier outstanding gates retain their owners.
