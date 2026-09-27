# Stage 6 implementation and verification

Contract: [Friends and sharing](../../new-design/stage-6.md). Tickets: PAR-54/56/57/60. Design pages 47–51, 54 and 56. Implementation commit: `4490f0d47e946861f70b540e32e0035722aa9674` on `feature/ui-revamp-beta`.

**Implementation and host/build verification are complete. Physical acceptance is pending.** The user instructed Stage 6 to wait until the separate Sheetless QA run releases the Samsung. This stage has not interacted with the phone, changed its settings, installed an APK, or claimed screenshots/device results. The four tickets remain In Progress. Earlier Stage 1–5, broad PAR-6, hosted and spoken-accessibility acceptance remain separate.

## Delivered slice

- Friends retains the compact header, publication chronology, real route cards, author links, own posts and distinct empty/loading/error/offline/paged states. Measurements are labelled; one-fix distance is unavailable. Empty copy respects automatic-sharing on/off/unknown state.
- Shared detail uses its own safe public presentation, matching Stage 5's four primary measured statistics and expandable recording details. It keeps Start/Stop terminology, actual geometry, gaps, missing values, archived provenance and recorder priority. No public aircraft, season totals, inferred airtime/climb or private fields are added.
- Manual Share, Hide and automatic-sharing decisions use separate native confirmation sheets, with truthful checking/unknown/pending/error and Hide-awaiting-server states. Disclosure covers endpoint coordinates, exact times, published history for later-added friends and automatic eligibility at recording start. The saved-summary edit handoff and existing controllers remain in place.
- Kudos adds authorized flight context, confirmed count and supporter-list hierarchy. Names/initials remain visible to authorized viewers even without mutual friendship, subject to existing block filtering. No handles, profile links or friendship actions. Context and names clear on discovered denial/failure, offline/account changes or departure.
- Synchronous account generations, confirmation visits and immediate request locks reject stale/dismissed/duplicate submissions, including A→B→A. A request completing while blurred releases its lock so returning to Friends remains usable.

## Automated and API results

Node `v24.16.0`, full `pnpm test`: types, lint and **3 architecture checks; 149 Jest suites / 1,510 tests; 71 Deno tests; 15 SQL suites / 522 assertions** passed. Generated database types match. Final run: 187.1 seconds. Android Metro export passed on the final source. See [verification receipt](logs/verification.json).

Focused coverage includes supported/expanded/one-fix/no-track/zero/negative/missing statistics, private-field exclusion, real route quality, own and archived detail, feed empty/paging states, consent/Hide/unknown status, dismissal/background/blur, duplicate submissions, auth generation changes, late responses, unsupported kudos, authorized context, pagination failures/Retry and names clearing. Existing Stage 1–5 regression suites remain included.

Two real Auth/PostgREST/Edge runs used separate disposable **local Supabase stacks**, synthetic flights and dedicated identities: [31 kudos checks](logs/kudos-http.log) and [44 shared-flight checks](logs/shared-flights-http.log) passed. They cover authorization, non-mutual supporter names, block-filtered count/list agreement, no self-kudos, private-field/original-file denial, publication/Hide/re-share, consent generations, pagination and deletion. Both runs cleaned up their synthetic accounts/objects and stopped their stacks. These are API checks, not hosted or native UI acceptance.

`pnpm validate:deps` returns exit 1 for **27 pre-existing patch recommendations**, also present in Stage 5. No package, lockfile, SDK, schema, RPC, migration or hosted change was made. See [dependency output](logs/dependencies.log).

## Release artifacts

| Variant | Identity and hash |
| --- | --- |
| [Normal QA](build-identity.json) | **Flight Log Stage 6 QA**, `com.xxvalhallacoderxx.xcmvp.stage6qa`; APK SHA-256 `5ab174360acd7fd0eec250ac57ac5ce1d41fa686b0663a9c85152b8c08e4b421`. Built, not installed. |
| [Large QA](large-build-identity.json) | **Flight Log Stage 6 QA Large**, `com.xxvalhallacoderxx.xcmvp.stage6qa.large`; APK SHA-256 `c939a4e36b0d6e33e0cd4ef94ed917881a7c2f415522dd85a343b18110e2b5c9`. Built, not installed. |

Both arm64 release builds retain INTERNET and `allowBackup=false`. APK signature and 16 KiB ZIP alignment checks passed. They are non-debuggable releases signed with the local Android debug certificate; this does not establish normally signed owner-APK acceptance. [Release checks](logs/release-checks.json) record the distinction. Normal build: 4m12s; large build: 59s.

Embedded JavaScript bundles match generated outputs, and all **275 mapped runtime sources**, including **16 changed runtime files**, match the implementation commit. The other changed source is the type-only internal publication view interface, checked by TypeScript and absent from runtime maps. Both builds contain the same JavaScript bundle. APKs, bundles and source maps are preserved under ignored `.artifacts/stage6/`.

The large variant changes generated-native **application resources only**: `fontScale=1.5`, `densityDpi=720` (intended 320dp on a 1440px display). [Native input receipt](large-variant-inputs.json) records those inputs. Its actual rendered dimensions, text and reachability require device verification. It is separate variant evidence; no Android system text/display setting was changed.

## Remaining acceptance

The [device checklist](device-checklist.md) covers installation/source identity, dedicated phone QA identities, navigation, scrolling, native sheets, Back, foreground return, real shared routes/replay entry, all visibility states, automatic-sharing eligibility, duplicate/late responses, kudos pagination/blocking and private-field exclusion. It also defines independent viewer readbacks, labelled large-variant checks and fixture cleanup. Create persistent phone QA identities only when that run can start; the completed local API fixtures were disposable.

No Stage 6 device model/settings baseline, screenshot, hierarchy, installed-APK hash or interaction result is claimed yet. Obtain the Sheetless handoff before collecting them. Keep PAR-54/56/57/60 open until scoped acceptance passes; PAR-43's broader public-data scope and PAR-44's broader common-UI work remain open.
