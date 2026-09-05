# Testing

Test observable behavior or a demonstrated regression. Keep one primary owner for each rule.
Avoid exact presentation copy unless it carries a warning, attribution, privacy promise or
format contract. Use large fixtures only when size changes the behavior being tested. Do not
add self-comparisons, assertions about mock availability, or checks of a fixture's own values.

## Commands and isolation

`pnpm test` requires Node 24 and Docker and runs types, lint, Jest and isolated Postgres checks.
Use `pnpm test:unit <path> --testNamePattern <name>` for a focused Jest scenario; `test:types`,
`test:lint`, and `test:db` select the other components. `db:test` uses the same database runner.
Jest retains `jest-expo`, injects Math into its sandbox, and transforms dynamic imports only in
Jest so the bootstrap test can execute the lazy database import with CommonJS mocks. Metro's
production transform is unchanged.

The database runner uses Supabase CLI 2.116.0 and a unique temporary project. It applies only
repository migrations, runs pgTAP, generates public-schema types into a temporary file and
compares that file with `src/cloud/database.types.ts`, with a consistent final newline. Only
`pnpm db:types` updates the checked-in file. The runner copies no linked-project metadata,
credentials, seeds or SMTP configuration;
SMTP is disabled. It allocates separate ports and stops only its own project with `--no-backup`
on success, failure or interruption. It never uses `supabase stop --all` or prunes Docker.
The first run may download Supabase's pinned service images; later runs still pay startup cost.

## Primary owners

| Behavior | Primary check |
| --- | --- |
| Supported SQLite versions, preserved raw evidence, backups, corruption and rollback | `database-migration.test.ts`, using shipped SQL and Node SQLite |
| Callback/source dedupe, Stop/recovery boundaries, snapshot/replay reads, deletion and tombstones | `sqlite-repository.test.ts`, executing the native database module |
| Sync eligibility/backoff, metadata conflict handling, push watermarks, account rebinding | `sync-repository-core.test.ts`, using real SQLite transactions |
| Native Stop ordering, recovery reconciliation and final-proof races | `recorder-lifecycle.test.ts`, public service methods with real queue/policies |
| Task registration before Router, lazy database loading and installed TaskManager patch | `location-task-bootstrap.test.ts` |
| Cloud payload values, nulls, local-data exclusions and registration | `payloads.test.ts`; generated types also check production queries |
| Owner operations, cross-owner isolation, anonymous denial, storage and schema constraints | Applied-migration pgTAP in `supabase/tests` |
| Runtime import boundaries, cached UI access and unsupported native APIs | ESLint architecture rule and its negative examples |
| Coordinate usability | `lib/track/__tests__/fixes.test.ts`, plus one replay integration check |
| Safe-area class registration | Focused `safe-area.test.ts` wrapper regression |
| IGC determinism, route gaps, postcard cancellation, readiness and cache ownership | Existing domain/component tests, with corrected postcard assertions |

Only repeated flight/metrics/profile fixtures and renderer setup are shared. The SQLite adapter
executes SQL and BEGIN/COMMIT/ROLLBACK; it does not interpret SQL text or manufacture schema
from expected-column constants. Its exclusive transaction handle rejects outer-handle queries
that would escape the native transaction. Migration backups are real SQLite files. Storage faults
use SQLite abort triggers or targeted backup I/O injection. These are host transaction and policy
checks; they do not establish native fsync, power-loss, locked-screen, physical-device or
export/share-sheet reliability. File-backed test databases disable synchronous disk flushing
for speed; those physical durability claims require separate device evidence.

## Redesign evidence (2026-09-06)

Baseline: clean `main` at `987d906`, Node 24.16.0. All 661 tests in 61 suites passed; local Jest
reported 17.431 seconds, including 10.662 seconds for track simplification. This was the old
Jest-only default command. The new default also includes TypeScript, lint and Docker startup,
so total verification time is not directly comparable to the old command.

Removed: the unused `igcHeaderSummary`, duplicate site-picker/setup/onboarding/replay AppState
cases, repeated coordinate matrices, the 43,201-point cache-eviction payload, per-colour palette
cases, repeated email-template cases, fixture/self-comparisons, SQL-interpreting fake databases,
schema/source-order parsers and the private-package class-name whitelist. The large geometry
fixtures remain because input size affects simplification and replay behavior. Palette maps
are compared once; each auth template has one code-only sign-in contract. No production
migration or recorder lifecycle behavior was changed.

Handwritten test files shrank from 7,796 lines / 324,456 bytes to 6,354 lines / 292,517 bytes.
New dedicated fixtures, SQLite adapter, runners, Jest config and architecture enforcement total
433 lines / 24,305 bytes. Combined handwritten test/tooling size is 6,787 lines / 316,822 bytes
(12.9% fewer lines, 2.4% fewer bytes). Generated schema types are separate: 291 lines / 10,026
bytes. Counts include SQL tests and the ESLint rule tests, and exclude documentation and the
lockfile and package/ESLint wiring; embedded old fake databases were counted as tests. There is no test-count target.

`pnpm test:regressions` makes temporary isolated copies and intentionally breaks callback
deduplication, exclusive transaction handles, recovery receipt deadlines, immediate Stop
persistence, final proof reads, profile registration, postcard cancellation cleanup, typed query
columns and flight RLS.
It requires the corresponding behavioral checks to reject each defect. It also verifies
that stale generated types and unavailable Docker fail verification. No working-tree or
hosted-database mutations are made by these checks.

SIGTERM was sent to the default runner's database component during schema initialization.
It exited 130 and left zero containers, volumes or networks bearing that run's project label.
Other local Supabase projects remained in place. SIGINT during schema-type generation also
exited 130 and removed the run's resources, including its temporary generation container.
Database failure and successful-run cleanup were also exercised.

Final `pnpm test`: passed TypeScript, lint (including three architecture-rule regressions),
571 Jest tests in 61 suites, 54 pgTAP checks, and generated-type drift verification. A frozen
lockfile install passed. `pnpm test:regressions` rejected all ten deliberate defects; its
missing-Docker check also passed. No run containers or volumes remained afterward.

| Host timing | Before | After |
| --- | ---: | ---: |
| Jest reported duration | 17.431 s | 4.879 s (warm) |
| TypeScript component | outside old default | 4.0 s |
| ESLint plus rule regressions | outside old default | 8.9 s |
| Jest component including process startup | old default | 5.9 s |
| Postgres, pgTAP, types and cleanup | outside old default | 32.0 s |
| Entire default verification | Jest only | 50.9 s |

These are host measurements with Supabase images already downloaded for the final run, not
budgets or device performance guarantees. The first image download/startup attempt took
113.5 seconds and exposed the old SQL test setup error. Jest transform warmup also adds time;
the first complete run after the new transform reported 14.435 seconds.

References: [Expo 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/),
[Jest sandbox globals](https://jestjs.io/docs/configuration#sandboxinjectedglobals-arraystring),
[Supabase database testing](https://supabase.com/docs/reference/cli/supabase-test-db).
The pgTAP storage tests set the [Storage API's transaction deletion flag](https://github.com/supabase/storage/pull/817)
so they exercise row policies while retaining current Storage's direct-SQL deletion protection
in normal use.
