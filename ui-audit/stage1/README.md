# Stage 1: shared UI foundation and onboarding evidence

Date: 27 September 2026. Scope: [PAR-44](https://linear.app/sentiment-hound/issue/PAR-44)'s foundation slice, [PAR-45](https://linear.app/sentiment-hound/issue/PAR-45), and [PAR-46](https://linear.app/sentiment-hound/issue/PAR-46), using pages 1–8 of the latest [PAR-40](https://linear.app/sentiment-hound/issue/PAR-40) pack. The [implementation agreement](../../new-design/stage-1.md) records the decisions and remaining scope.

The required Stage 1 implementation, automated verification, and bounded Android acceptance checks have passed. Final standard isolated QA build **E** verifies that Home / Friends / Pilot labels remain fully visible at font scales 1.0 and 1.3 and that saved pilot/equipment values survive the build updates. Standard D provides representative postcard font/layout previews. The existing postcard Modal-focus issue is recorded below for PAR-65; no postcard was exported or sent. Screenshot attachments, acceptance comments and final statuses were read back: PAR-45/46 are Done; PAR-44/41/42 and PAR-65 remain open.

Open the [screenshot gallery](gallery.html) for captions, build labels, and links to each full-resolution image. The screenshot provenance below controls how these captures may be used.

## Implementation covered

- Bricolage Grotesque 400/500/600/700/800 replaces Archivo, retaining IBM Plex Mono. App startup and postcards use one bundled font registry. Runtime/CSS tokens, shared controls, minimum targets, labels, recovery/loading states, and route-error presentation use the new foundation. Muted text is `#63705F`; dark-recorder tokens are defined for later work.
- Navigation labels are **Home / Friends / Pilot**, retaining route URLs. Home remains the personal logbook. The separate Friends feed and cloud-account terminology remain. The remaining PAR-42 navigation contract is outside this slice.
- Welcome retains the recorder limitation notice. Both Start and Skip require acknowledgement in their controls and handlers. Welcome is outside **Name → Permissions → optional Backup**, numbered 1/3–3/3.
- Name is optional and limited to 60 characters. Continue saves only a trimmed, changed, nonblank name; Skip preserves the session draft without saving it. Blank input cannot erase a saved name. Save failures retain the draft with Retry/Skip. Equipment and registration remain in **Pilot → Edit pilot details**.
- Permission reads on entry/foreground are passive. UI distinguishes precise/approximate access, denied/unrequested/unavailable/checking states, and device location being off. Foreground precedes background requests; notifications remain independently optional. Request eligibility chooses retry versus Settings. Requests are serialized across step re-entry; departed owners cannot continue prompts or apply results.
- The provider owns session drafts, Review mode, and saving/error state. Review can be dismissed without rewriting completion history. First-run completion persists before dismissal, with Retry or explicit Continue without saving after failure. A full restart restores only the saved name and repeats unfinished setup.
- The navigator remains mounted behind setup/loading. Native setup uses a modal to isolate touches and accessibility; startup retains fail-open behavior. Android keyboard avoidance uses `height`.
- The tab bar grows with system font scale while retaining 12px labels. Its custom total height includes the bottom inset once; the navigator remains responsible for bottom safe-area padding.

There are no database migrations or backend changes. Backup inherits the shared styling; its dedicated redesign remains PAR-47 and the sign-in portion of PAR-66. PAR-44 stays open for the remaining PAR-42-dependent work. Equipment placement and temporary Home behavior belong in PAR-41/42 without closing their broader scope.

## Source and isolated QA identity

| Item | Recorded value |
| --- | --- |
| Branch | `feature/ui-revamp-beta` |
| Base commit when verification began | `b4b377107b487837e2213a679dd1f6c3a9832935` |
| Recorded implementation commit | `123414322bf73dd0faf13748d95e4c05b47cb026` |
| Final source commit | `e835a5298949025d7debeafce85a5ff5c01c3142` — enlarged-tab correction |
| Standard QA app name | `Flight Log Stage 1 QA` |
| QA package | `com.xxvalhallacoderxx.xcmvp.stage1qa` |
| QA scheme | `xcmvp-stage1qa` |
| QA version | `1.0.0-stage1-qa` / version code `1` |
| Build target | Android release, `arm64-v8a` |
| Final standard QA APK | `.artifacts/stage1/flight-log-stage1-20260927.apk` — **E**, also preserved as `flight-log-stage1-standard-e.apk` |
| Standard QA E APK SHA-256 | `bc06af4e392b99a9be846d4511249cd69c674d840728bd58b0535532531f9e57` |
| Standard QA E identity | [Final standard build identity](build-identity.json); copied APK/bundle match generated outputs, and both source maps match all 43 changed runtime files and all 239 mapped runtime files at `e835a52` |
| Preserved standard QA D APK | `.artifacts/stage1/flight-log-stage1-standard-d.apk` — postcard preview evidence before the tab-height correction |
| Standard QA D APK SHA-256 | `b08df914555e770aa25aa55c41fe535ca0107295782712c97d47020264bec2e1` |
| Standard QA D APK/source-map parity | Passed: copied APK and embedded bundle match generated outputs; all 43 runtime sources in both maps match commit `1234143`. The later tab-layout edit is not included in D. |
| Preserved setup-only offline APK | `.artifacts/stage1/flight-log-stage1-offline-20260927.apk` — **C**, SHA-256 `0886251a2f26ab469705cc3586019888d71a7dd0819137bddc3ba64b047fb779` |
| Device | Samsung `SM-S938B`, Android 16; isolated QA package above |
| Display settings | 1080 × 2340; physical density 450, override 420; font scale 1.0 and enlarged 1.3 |

The standard QA configuration uses `FLIGHT_LOG_QA=stage1` with `FLIGHT_LOG_QA_OFFLINE` absent. It retains INTERNET and shares the same isolated QA package/database with the setup-only offline flavor. First-run and permission resets target only this isolated QA package. The normal installation, saved flights, and account session are outside these resets.

**Setup-only harness limitation:** `FLIGHT_LOG_QA_OFFLINE=1` removes the INTERNET manifest permission. This supported the recorded account-free setup checks without disconnecting wireless ADB. After a ground recording was stopped, however, Expo Image/OkHttp attempted a map-image load and crashed with a native `SecurityException` for the missing permission. That artifact is valid as setup evidence, not as a simulation of broader offline app/image-loading behavior. The standard QA build and normal app retain INTERNET; no product-source change is being made for this harness finding. See the [ground fixture capture](screens/29-qa-ground-recording.png) and [native crash evidence](logs/offline-harness-image-limitation.log).

Offline C was built before commit, then verified against the committed bytes: all **43 runtime files, 10 test files, and 4 build-input files** match commit `1234143`. The `offlineSetupBuild` section of the [combined build identity](build-identity.json) records that APK, bundle, preserved source maps, build inputs, individual source hashes, and commit comparison. Its source snapshot hash is `583b726e7cd12819c2c690a07b5fef1664be64a90c2b18ec60a60f017efd62f5`. [Standard D identity](build-standard-d-identity.json) separately proves that D's runtime sources match the same commit; the later enlarged-tab correction is excluded from D. The combined identity's top level describes **final E**; `priorStandardBuild` also preserves D.

The offline setup identity preserves intermediate **B**, SHA-256 `d2fbdef65bc4b0d1093044dfe0e20ef8ae1491674168835731b230247d3070f5`, and **A**, SHA-256 `b842894bd25bc837fc017fcafd7f503efd435c8da2615facb980ca317b53c903`, through its nested `priorBuild` chain. Their APKs remain at `.artifacts/stage1/flight-log-stage1-offline-behavior-{a,b}.apk`; the dated offline APK contains C. A establishes earlier setup behavior, B adds dark status-bar styling and scroll reset, and C makes the progress control accessible while hiding its duplicate visual count. Standard D uses that committed runtime source with INTERNET retained; final E adds the tab-height correction.

Ordinary native configuration was restored and verified after copying the final QA artifact/source maps using the [QA build instructions](../../new-design/stage-1.md#isolated-android-qa-build): normal package `com.xxvalhallacoderxx.xcmvp`, `xcmvp` scheme, INTERNET permission, and `allowBackup=false`. Prebuild's automatic iOS-script change was reverted. No normal APK was built or installed. See the [final restoration log](logs/prebuild-ordinary-final.log) and `ordinaryNativeRestoration` in the final build identity for the recorded verification.

## Automated verification

All commands use Node `v24.16.0`. The latest full repository workflow at implementation commit `1234143` completed in **125.7 seconds**, including the notification-read failure, dark status-bar, per-step scroll-reset, and progress-accessibility fixes. It did not skip database verification. The final tab-height correction at `e835a52` then passed TypeScript, focused ESLint, diff checks, and the physical E checks at normal/enlarged font scales.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm test`: TypeScript | Passed | [Latest full workflow](logs/verification-delivery.log) |
| Full ESLint and architecture checks | Passed; 3 architecture tests | Same full log |
| Full Jest suite | Passed; 128 suites / 1,244 tests | Same full log |
| Deno function tests | Passed; 71 tests | Same full log |
| Isolated Supabase / pgTAP | Passed; 13 files / 469 tests | Same full log |
| Generated database types | Match checked-in types; isolated database cleaned up | Same full log |
| Final focused onboarding tests | Passed; 3 suites / 34 tests | [Focused tests](logs/onboarding-delivery.log) |
| Final full TypeScript | Passed, exit 0 | [TypeScript output](logs/types-delivery.log); empty output on success |
| Final focused ESLint | Passed, exit 0 | [Lint output](logs/lint-delivery.log); empty output on success |
| Tab-height correction TypeScript and focused ESLint | Passed at `e835a52`; physical E verification also passed | Command results and screenshots 33–35 |
| Working-tree and staged `git diff --check` | Passed at the final source snapshot | Command results |

The full workflow covers the real acknowledgement exits, setup navigation, name save/skip/error behavior, draft retention, Review dismissal/history, completion recovery, restart prefill, permission eligibility/refresh, optional notifications, duplicate actions, and stale responses. Font-registry and runtime/CSS token parity checks pass, including normal-text contrast for muted text on the three light surfaces. These checks do not prove keyboard geometry, TalkBack output, postcard visual layout, or uninterrupted recording on a phone.

`pnpm validate:deps` returned exit 1 because the current SDK 57 compatibility service recommends **27 newer package patches**, including Expo `57.0.25` versus installed `57.0.14` and React Native `0.86.3` versus installed `0.86.2`. This is a recorded dependency-check warning, not a passed check. No SDK patch upgrade was included in Stage 1. See the [dependency log](logs/deps.log).

The copied logs retain their original output except for one disposable local-test database credential URL, which was redacted. Original and copied log hashes are recorded in the build identity. No other token or secret candidates were found in the log scan.

## Android build evidence

The [offline setup C release build](logs/build-delivery.log) passed in **58 seconds**, with **871 actionable tasks** (24 executed, 847 up-to-date). It includes the permission re-entry/notification-read fixes, native modal, Android `KeyboardAvoidingView`, explicit dark status-bar styling, `key={state.step}` to reset scroll position, and the accessible setup progress control. [Standard isolated QA D](logs/build-standard-qa.log) passed in **3m 6s**, with 871 tasks (839 executed, 32 up-to-date), using the same implementation commit and retaining INTERNET. [Final standard QA E](logs/build-standard-final.log) passed in **58 seconds**, with 871 tasks (24 executed, 847 up-to-date), and adds the tab-height correction verified on the phone.

```sh
env -u FLIGHT_LOG_QA_OFFLINE FLIGHT_LOG_QA=stage1 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

For both offline C and standard D, the copied APK matched the Gradle output, and the embedded bundle matched the generated release bundle. Both sets of source maps exactly match all **43 runtime files** from commit `1234143`, including the font registry, permission step/hook, overlay, first-run gate, provider, and CSS. The 10 changed test files are absent from the production bundle as expected. D's maps are preserved under `.artifacts/stage1/sourcemaps/standard-d/`; final E has its own [identity and source-map comparison](build-identity.json). A successful build establishes artifact construction, while the next section records installed-device acceptance.

## Installed-device acceptance

The following results come from manual checks on the named Samsung device, using only the isolated QA installation. A/B results remain evidence for those builds; they are not presented as checks repeated on C. Each later build was installed over the isolated QA package and exercised with its existing setup/profile state. The main Flight Log installation was not reset.

| Scenario | Observed result and evidence |
| --- | --- |
| Welcome limitation notice and acknowledgement guard | A: Start and Skip were disabled and tapping either did not exit before acknowledgement. Acknowledged Start opened Name. [Welcome](screens/01-welcome.png), [guard](screens/02-welcome-guard.png). The acknowledged Skip-to-Home handler is covered by automated tests; no additional manual claim is made here. |
| Name, draft navigation, and keyboard | A: Skip then Back retained the name draft. B: at font scale 1.3, the name screen and keyboard left the buttons reachable. [Name](screens/03-name.png), [initial keyboard](screens/04-name-keyboard.png), [enlarged name](screens/17-name-enlarged.png), [enlarged keyboard](screens/18-name-keyboard-enlarged.png). |
| Draft retention through Settings | A: the unsaved name draft survived the Android Settings round trip. B: the provider-owned long-name draft also survived permanent-denial recovery through Settings. [Returned draft](screens/08-draft-settings-return.png), [permissions restored](screens/21-permissions-restored.png). |
| Full restart before completion | A: force-stop/relaunch returned to Welcome; Name used the saved value, dropping the unfinished unsaved draft. [Restart prefill](screens/09-restart-prefill.png). |
| Location precision and background access | Interim/A: actual permission interaction moved approximate access to precise; background Settings allowed all-the-time access and the screen refreshed on return. B: Open app settings → Permissions → Location → Allow all the time restored precise/allowed state on return. [Approximate](screens/06-approximate.png), [initial Settings return](screens/07-settings-return.png), [B restored permissions](screens/21-permissions-restored.png). |
| Optional notifications and Backup | A: notification denial retained Not now, which advanced to optional Backup at 3/3 and then offline Home. [Notification denial](screens/10-notifications-denied.png), [Backup](screens/11-backup.png). |
| Permanent denial and preflight | B: only the QA package was seeded with permission revoke plus `user-fixed`. Expo initially reported request eligibility, so Retry returned without showing a prompt; the refreshed state then correctly offered Open app settings. Settings recovery passed and retained the name draft. [Permanent denial](screens/20-permanent-denial.png), [blocked preflight](screens/16-blocked-preflight.png), [recovery](screens/21-permissions-restored.png). |
| Device location service off | B: disabling device location showed OFF, an explanatory notice, and Open location settings. Re-enabling it refreshed the state on foreground return. [Device location off](screens/22-device-location-off.png). |
| Completed offline launch | B: after install and restart, completed setup opened directly to Home without an account. [Offline Home](screens/12-home-offline.png). |
| Review cancellation and Android Back | B: Review setup closed both through Android Back and its Close button. Final E: Review opened with Close review available, and Android Back returned to Settings. [B Review](screens/15-review.png), [E Review](screens/38-review-final-e.png). |
| Pilot details and preservation | A: equipment editor retained the established placement. B and final E: saved `Stage One Pilot`, `QA Test Glider`, and `QA-123` survived build updates/restarts and remained in the editor at font scale 1.3. [A equipment editor](screens/13-equipment-editor.png), [B Pilot](screens/14-pilot.png), [E editor](screens/35-pilot-equipment-preserved-e.png). |
| Status bar, enlarged text, and step scrolling | B: dark status-bar icons were visible. Font scale 1.3 name/keyboard actions remained reachable; moving between setup steps reset the scroll position to the top. [Enlarged permissions](screens/19-permissions-enlarged.png). Normal scale was 1.0. |
| Overlay isolation and TalkBack | C: TalkBack was enabled and its service bound. Keyboard Tab/Shift+Tab traversal moved visible blue focus to the setup progress control and name field. Two Tabs then Enter activated Skip and opened Permissions; five Tabs focused Not now, and Enter opened Backup at 3/3. The compressed UI tree contained no underlying Home/Friends/Pilot navigator. [Service evidence](talkback-service.txt), [progress focus](screens/24-talkback-progress.png), [name focus](screens/25-talkback-name.png), [Permissions](screens/26-talkback-permissions.png), [Not now focus](screens/27-talkback-not-now.png), [Backup](screens/28-talkback-backup.png). |
| Existing-screen navigation and tab labels | B: Home, Pilot, Review setup, blocked recorder preflight, and signed-out Friends were exercised. The [B Friends capture](screens/23-friends-offline.png) exposed enlarged-label clipping. E corrects it: Home / Friends / Pilot labels are fully visible at [normal font scale 1.0](screens/33-home-tabs-normal-e.png) and [enlarged scale 1.3](screens/34-friends-tabs-enlarged-e.png). |
| Representative postcard previews | D: Square/Flying and Story/Launch previews passed visual checks of Bricolage typography, layout, recorded route, statistics, and pilot signature. [Square](screens/30-postcard-square-d.png), [Story](screens/31-postcard-story-d.png). Existing fresh-open Modal focus behavior initially disabled Share image; Home → return made it available without edits. [D recovered readiness](screens/32-postcard-ready-d.png). Final E reproduced [disabled](screens/36-postcard-disabled-e.png) → [enabled](screens/37-postcard-ready-e.png) on the same unedited postcard. No postcard was exported or sent. See the PAR-65 follow-up below. |

Screenshot provenance: **01–11 and 13 are interim/A evidence**. Within that group, **05–07** were captured on earlier interim builds exercising the same permission behavior, so they must not be assigned A's exact APK hash. **12 and 14–23 are B evidence**. **24–29 are offline-C evidence**, with 29 a ground fixture, not flight-reliability acceptance. **30–32 are standard-D evidence**. **33–38 are final standard-E evidence**. A/B identities remain in the offline identity's `priorBuild` chain. Earlier images must not be relabelled as final-QA captures. [Permissions entry](screens/05-permissions-initial.png) remains an interim visual reference.

TalkBack evidence is limited to the enabled/bound service, visible keyboard focus traversal, activation, and navigator isolation described above. There is no auditory recording or full gesture-navigation audit; broader [PAR-6](https://linear.app/sentiment-hound/issue/PAR-6) acceptance remains separate. The original Wispr accessibility service, original font scale **0.9**, and enabled device-location service have been restored and confirmed in [device identity](device-identity.json).

**Existing postcard focus limitation — PAR-65 follow-up:** Freshly opening the postcard Modal can leave Share image disabled after fonts, image and layout are visibly ready. Home → return immediately enables it without editing the postcard. Final E preserves both the [disabled native UI tree](postcard-disabled-e.xml) and [resumed native UI tree](postcard-ready-e.xml), alongside screenshots 36–37. The readiness/blur/focus logic in `postcard-composer.tsx`, the card, and the export adapter are unchanged from base commit `b4b3771`. Source inspection identifies the Activity losing focus to the native Modal without a matching Activity-focus event for that Modal; the existing app-state resume handler restores readiness. This is a pre-existing issue, reproduced during Stage 1 QA, for [PAR-65](https://linear.app/sentiment-hound/issue/PAR-65), whose existing scope already includes the unexplained disabled Share button. Stage 1 changed postcard font loading through the shared registry; it did not change that readiness logic. The preview checks above do not claim export/share acceptance.

Regenerate the [gallery](gallery.html) after adding captures with `python3 ui-audit/stage1/generate-gallery.py`. New filenames receive an explicit unclassified build label until their metadata is added to the generator. Build provenance and the recorded limitations must accompany ticket evidence.

## Ticket delivery

- PAR-45 and PAR-46: **Done**; required Stage 1 acceptance passed within the bounds above. Completion states, comments and screenshot attachments were read back.
- PAR-44: delivered foundation slice recorded; remains **Backlog** for the PAR-42-dependent navigation contract and broader coverage.
- PAR-41/42: equipment placement and temporary personal-logbook Home behavior recorded; both remain **Backlog**.
- PAR-65: existing postcard Modal-focus issue, resume workaround and before/after screenshots recorded; remains **Backlog**, with export/share acceptance separate.
- Final implementation commit, named build, device and verification results are recorded on PAR-44/45/46. The [ticket receipt](ticket-delivery.json) preserves the verified comments and attachment IDs.

No host/static result here establishes field recording reliability. Recorder lifecycle/endurance acceptance remains its existing separate gate.
