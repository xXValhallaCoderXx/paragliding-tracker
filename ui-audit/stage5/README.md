# Stage 5 implementation and verification

Contract: [saved flights, detail and editing](../../new-design/stage-5.md). Scope: PAR-52/53, design pages 26, 34 and 36–39. Source commit: `0ed69d74244f17d6a7dca3a57e22d95d5bcb8645` (implementation `f867ab8`, React Compiler compatibility `0ed69d7`).

**Implementation and host/build verification are complete. Physical acceptance is incomplete.** Phone interaction is paused at the user's request until the separate Sheetless QA run finishes. PAR-52/53 remain In Progress; earlier-stage, hosted and spoken-accessibility gates remain separate.

## Automated and build results

Node `v24.16.0` full `pnpm test` passed: types, lint, 3 architecture checks, **149 Jest suites / 1,486 tests; 71 Deno tests; 15 SQL suites / 522 assertions**. Generated database types match. Total verification: 146.6 seconds. Android Metro export and the isolated arm64 release passed; final release took 65 seconds. [Verification receipt](logs/verification.json) records commands, counts and log hashes.

Focused coverage includes actual SQLite transaction conflicts and rollback; edited-field comparisons and untouched-field preservation; site/provenance pairing; source/owner/session/finished/deleted validation; authentication A→B→A; duplicate actions; late callbacks; post-commit read/cleanup failures; summary Done/Close/Back and dirty sharing handoff; editor/site draft nesting and request cancellation; metrics/equipment variants; original IGC preservation and private-field exclusion from social sharing. Stage 1–4 regression suites remain included.

`pnpm validate:deps` reports **exit 1** for 27 pre-existing Expo/React Native patch recommendations. No dependency or SDK upgrade was made. There are no schema, migration or backend changes.

| Artifact | Identity and scope |
|---|---|
| [Normal QA build](build-identity.json) | `Flight Log Stage 5 QA`, `com.xxvalhallacoderxx.xcmvp.stage5qa`; APK SHA-256 `266f04eb87cf5e3e00f96dece158633f82fafce6abb5cda26eec3f4e3140e402`. Installed and independently checked against the package file on the phone. |
| [Large QA build](large-build-identity.json) | `Flight Log Stage 5 QA Large`, `com.xxvalhallacoderxx.xcmvp.stage5qa.large`; APK SHA-256 `9b44b3b525cfdf686bd55dd0447040ced20893edf0f2c171614e4cd31f38691a`. Built, not installed or accepted. |

Both retain INTERNET and `allowBackup=false`. Both APKs' embedded bundles match their generated outputs; 276 runtime source-map entries, including all 28 changed runtime files, match the source commit. APKs, bundles, maps and fixture tools are preserved under ignored `.artifacts/stage5/`.

The large variant uses generated-native **application-only** resource overrides (`fontScale=1.5`, `densityDpi=720`, intended 320dp at 1440px). [Native input receipt](large-variant-inputs.json) records those inputs. The actual rendered dimensions and reachability still require device verification. This is separate variant evidence, not a claim that the user's system text/display settings were tested or changed.

After preserving the artifacts, the generated Android project was restored to the normal `com.xxvalhallacoderxx.xcmvp` / Flight Log Alpha configuration with INTERNET and `allowBackup=false`. `package.json` and the lockfile are unchanged.

## Physical checks completed on the normal QA build

Device: Samsung SM-S938B, Android 16, original font scale `0.8`, density override `560`, physical 1440×3120. No display, accessibility or network settings were changed. The separate fixture companion verified package, signing certificate, installed APK SHA-256 and schema v11 before inserting **8 local and 2 restored synthetic flights** into the fresh unbound QA database. Profile/settings were retained; normal Flight Log and Stage 1–4 packages were not reset or replaced. No real account was used and no cloud binding/publication was performed.

| Observed interaction | Evidence / result |
|---|---|
| Home → own detail | Tapped QA 01 from the populated Home. Ordinary detail shows its stored route, Start/Stop and supported metrics. [Home](screens/01-populated-home.png), [detail](screens/02-own-detail-route.png). |
| More stats and scrolling | Expanded and scrolled to minimum GPS altitude, straight-line distance, fix count, Start/Stop and UTC+2. [Expanded stats](screens/03-expanded-stats.png). |
| Captured aircraft and private notes | Historical model, size and synthetic registration render read-only independently of current inventory. Notes remain in the private section. [Aircraft/notes](screens/04-captured-aircraft-and-notes.png). |
| Native actions sheet | Opened overflow; Share, Edit, Replay, postcard, unsigned IGC and Delete are reachable. [Actions](screens/05-overflow-actions.png). |
| Editor and Android Back | Changed the title. First Back dismissed the keyboard; second opened dirty-draft protection. Keep editing retained the title. [Keyboard](screens/06-editor-keyboard.png), [discard guard](screens/07-dirty-editor-back.png). Saving while the keyboard is visible still needs a direct physical check. |
| Nested site picker | Nearby results loaded using the stored recording start. Searching a synthetic name reached no results; manual/clear actions remained above the keyboard. Cancel retained the parent's previous site and edited title. Reopened and selected a manual name. [Nearby](screens/08-nearby-site-provider.png), [search/no-results/keyboard](screens/09-site-keyboard-actions.png). |
| Delete cancellation and metadata save | Delete explained immediate local removal and delayed remote Hide/deletion. Cancel returned to the editor with title/site drafts intact. Save details closed the editor successfully. Restart/readback of those edits remains to be checked. [Delete explanation](screens/10-delete-explanation.png). |
| Export failure and retry entry | First unsigned-IGC action showed a native SQLite error without closing the flight. Reopening actions and retrying reached Android's share sheet. Receiving-app selection/return was not completed before the pause. [Error](screens/11-export-retryable-error.png). |

These are interaction observations from the named build, not inferred successes from screenshots. [Device receipt](logs/device-results.json) records screenshot hashes, fixture/build scope and pending checks.

## Export finding requiring follow-up

The first unsigned export reported `NativeDatabase.prepareAsync` / `NativeStatement` / `Cannot use shared object that was already released`; the next attempt reached Android's share sheet. Installed `expo-sqlite` is 57.0.1. A [report in Expo's tracker](https://github.com/expo/expo/issues/48995) describes the same error string under concurrent queries on SDK 56, but is closed with an incomplete-reproduction label. This is a diagnostic lead, **not a confirmed cause or proof of an upstream fix** for this app. No speculative global database workaround or dependency upgrade was applied. Repeat export/read stress, native logs and receiving-app return remain required. The recorder's existing export implementation is unchanged.

## Remaining Stage 5 device acceptance

- Persisted summary: real completed-storage handoff and compatible saved parameters, quick Done/Close/Back, dirty sharing handoff and ordinary Home reopening.
- Durable variants: partial/gaps, no fixes/explicit none, one fix/legacy unknown, processing, missing metrics, deleted and retryable reads; historical/removed equipment and long metadata.
- Editor: restart readback, private-note editing, save with keyboard visible, nested Back/Clear/provider attribution, offline/manual/Retry, unavailable-coordinate location opt-in, cancellation during pending work, conflicts/rebase and identity transitions.
- Actions: Replay/postcard navigation; unsigned export repeat reliability; verified archived original after failed replacement; receiving-app return; successful deletion with retained Home filters and failure recovery.
- Dedicated-account sharing: separate social consent, private-field exclusion, checking/unknown/pending/error/Hide states and actual owner/account changes. Automated coverage does not establish hosted/device acceptance.
- Large QA variant: install, validate app-resource override and inspect long text/scrolling/keyboard/Back/actions separately. Spoken accessibility remains PAR-6's separate gate.
- Final read-only settings comparison and temporary fixture-companion cleanup after the phone is available. The companion and normal QA app remain installed with synthetic data; no receiver handoff was completed.

Private metric decisions are recorded on PAR-43 without closing its public-data scope. Historical aircraft corrections are deferred to [PAR-72](https://linear.app/sentiment-hound/issue/PAR-72), linked to PAR-53. Replay redesign, postcard fixes, recorder redesign and broader hosted acceptance retain their existing tickets.
