# Stage 3 evidence

Contract: [Pilot and aircraft](../../new-design/stage-3.md). Work: PAR-41, PAR-48/49, PAR-69/70, private editor slice of PAR-66 and preflight aircraft slice of PAR-61.

## Verification

| Gate | Result |
| --- | --- |
| Node 24.16.0 full `pnpm test` | Passed: 139 Jest suites / 1,382 tests; 71 Deno tests; 15 SQL suites / 522 assertions; TypeScript, lint architecture checks, generated database types. 98.9 seconds. |
| Interrupted resume follow-up | Added one real SQLite interruption/resume/partial-finalize snapshot regression; affected repository suite passed 24 tests with clean targeted lint. Current source has 1,383 Jest tests. |
| Final test-only lint cleanup | Removed one require-style warning; affected export receipt suite (3 tests) and targeted lint passed afterwards. |
| Android Metro export | Passed, Stage 3 configuration. |
| Hosted private equipment / account isolation | Applied only `20260927120000_private_equipment.sql`; 20 real HTTP checks passed; disposable synthetic accounts/fixtures cleaned. |
| Android release / artifact identity | Release arm64 build passed (871 tasks, 1m 28s); source identity recording follows implementation commit. |
| Named Stage 3 installed Android QA | Pending. |
| Keyboard, Back, enlarged text, TalkBack | Pending. |
| Dependency compatibility advisory | `pnpm validate:deps` reports newer patch versions for 27 existing Expo/React Native/tooling packages. No package or lockfile upgrade in this stage. Build and acceptance use the existing versions. |

Raw local logs and APKs are ignored under `.artifacts/stage3/`. Hosted checks use `scripts/test-equipment-http.mjs` and cover independent owner sessions, lost-response retries, conflicts, explicit review/reapply, archive/current consistency, restoration, owner RLS, anonymous/direct-write rejection, flight snapshot immutability, old-client omission, deletion fences, and no Friends profile creation.

A source-to-source integration test exercises actual SQLite equipment save, first account claim, recording snapshot capture, cloud serialization, separate SQLite archive restoration and actual IGC bytes. Later aircraft edits, archive and replacement defaults preserve captured details and exports. Existing IGC artifacts remain immutable in the updated client; older installed clients retain their pre-existing server storage update permission.

The full test log contains the initial lint warning; it was corrected afterwards and verified separately. Automated evidence does not establish physical recording reliability or final screen acceptance. See [automated coverage](automated-coverage.md) for contract coverage and remaining gates.

Use only synthetic data and dedicated QA accounts. Keep credentials, email codes and account-bearing screenshots out of shared evidence. Existing normal app/data and Stage 1/2 acceptance remain intact.
