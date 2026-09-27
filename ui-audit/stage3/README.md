# Stage 3 evidence

Contract: [Pilot and aircraft](../../new-design/stage-3.md). Work: PAR-41, PAR-48/49, PAR-69/70, private editor slice of PAR-66 and preflight aircraft slice of PAR-61.

## Verification

| Gate | Result |
| --- | --- |
| Node 24.16.0 full `pnpm test` | Passed: 140 Jest suites / 1,391 tests; 71 Deno tests; 15 SQL suites / 522 assertions; TypeScript, lint architecture checks, generated database types. 91.8 seconds; final run includes both follow-up suites, with no lint warnings. |
| Android Metro export | Passed, Stage 3 configuration. |
| Hosted private equipment / account isolation | Applied only `20260927120000_private_equipment.sql`; 20 real HTTP checks passed; disposable synthetic accounts/fixtures cleaned. |
| Android release / artifact identity | Passed: release arm64 (871 tasks, 1m 28s); APK and all 43 changed Android runtime sources match `7728c48`. See [build identity](build-identity.json). |
| Named Stage 3 installed Android QA | Installed on SM-S938B / Android 16. Local-only Pilot, three sports, current/archive/restore and preflight UI passed. Signed-in backup/restoration and physical offline/recovery remain pending. |
| Keyboard, Back, enlarged text, TalkBack | Keyboard/Back, draft lifecycle and enlarged-text checks passed at 320dp and native viewport. Samsung TalkBack setup prevented a completed spoken-label check; pending. |
| Dependency compatibility advisory | `pnpm validate:deps` reports newer patch versions for 27 existing Expo/React Native/tooling packages. No package or lockfile upgrade in this stage. Build and acceptance use the existing versions. |

Raw local logs and APKs are ignored under `.artifacts/stage3/`. Hosted checks use `scripts/test-equipment-http.mjs` and cover independent owner sessions, lost-response retries, conflicts, explicit review/reapply, archive/current consistency, restoration, owner RLS, anonymous/direct-write rejection, flight snapshot immutability, old-client omission, deletion fences, and no Friends profile creation.

A source-to-source integration test exercises actual SQLite equipment save, first account claim, recording snapshot capture, cloud serialization, separate SQLite archive restoration and actual IGC bytes. Later aircraft edits, archive and replacement defaults preserve captured details and exports. Existing IGC artifacts remain immutable in the updated client; older installed clients retain their pre-existing server storage update permission.

The final full workflow log is `.artifacts/stage3/final-full-test.log`; its [verification receipt](logs/verification.json) records counts and hash. Automated evidence does not establish physical recording reliability or final screen acceptance. See [automated coverage](automated-coverage.md) for contract coverage and remaining gates.

Use only synthetic data and dedicated QA accounts. Keep credentials, email codes and account-bearing screenshots out of shared evidence. Existing normal app/data and Stage 1/2 acceptance remain intact.

Implementation commit: `7728c4845d60a173998a98beac795a7217a7f2e9`. [Physical results and screenshots](device-results.md). APK SHA-256: `edb413cd0fe8b3c16317b87cbb36152b8858d71e74157aaf6e901848948a06e5`.
