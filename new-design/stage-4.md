# Stage 4 — personal Home and journal filters

Contract for PAR-42, PAR-50/51 and the personal Home portion of PAR-44. Reference: the 27 September 2026 social-pass designs, PDF/HTML pages 19–25. Android acceptance is separate from implementation and automated checks.

## Agreed product behavior

- Home remains the personal journal. Friends remains its existing separate, online feed. Default: all history, newest first. The summary always describes the visible result set.
- Applied filters/sort survive navigation in memory. Fresh app launch, authentication identity changes and archive-owner changes reset them. Same-user token refresh does not. Owner changes dismiss drafts and fence late Apply actions.
- Site, sport, historical aircraft and quality support multiple selections: OR within categories, AND across categories. Year is single-select or all time. Newest/oldest group by flight-local month; recorded-time/track-distance sorts are flat, missing values last with stable timestamp/ID ties.
- Site matching normalizes stored names, not geography. Aircraft identity comes from captured snapshots, including archived/removed inventory. Missing legacy snapshots are Unknown; an explicit empty snapshot is No aircraft selected. Years use the start timestamp and recorded offset, with the existing device-timezone fallback for legacy null offsets.
- Options come from the whole saved catalogue. Search only narrows displayed options. Selections remain visible if a refresh removes their last matching flight. Opening a sheet copies applied state; Reset affects the draft, Apply commits, Cancel/dismissal/Back discards. Back dismisses the keyboard first. Clear all also resets sort. Applying zero matches is allowed.
- Pinned recording/recovery entry is excluded from filters, counts and aggregates. Filtering must not trigger repository reads, raw-fix parsing, metric calculation, IGC downloads or network requests. Existing focus repair and sync triggers remain intact.

## Truthful presentation

Result count includes every matching saved row, even while processing. Summary shows total recorded time, longest recording and longest track distance from available persisted metrics, with coverage counts when incomplete. Recorded time is start-to-stop duration, including interruptions; it is not detected airtime. Track distance retains the existing calculation and is not XC distance. Fewer than two usable fixes means unavailable distance. Missing measurements display an em dash, never a fabricated zero.

Good track, gaps, partial, no usable track and stats pending/unavailable match the same card/filter predicates. Partial can overlap no track. Processing/unknown measurements never imply healthy tracking. Restored summaries contribute independently of IGC download readiness. All totals describe the locally available journal, not an account-wide catalogue still being restored.

Preserve real route geometry, visible-card-only map rendering, setup/recovery states and existing navigation. Use the current shared theme and controls, 12px minimum labels and accessible touch targets. No unsupported gap-duration, retained-duration, automatic landing, cached-Friends or queued-sharing claims.

## Deferred work and compatibility

Mixed All/Mine/Friends requires complete server filtering, ordering, aggregates, deduplication and authorization/cache semantics. Own-card Private/Shared and kudos require a reliable publication mapping/status contract; a missing local publication intent does not prove Private. Keep existing sharing controls in flight detail and public equipment out of this change.

No schema migration, backend change, metrics-algorithm change, SDK upgrade or persistent filter preference. Stage 1–3 contracts and their outstanding device/field gates remain independent.

## Verification

Pure selector tests cover combinations, historical data, timezone boundaries, quality overlap, missing statistics, stable sorts and large journals. Component tests cover draft lifecycle, zero matches, clear actions, remount persistence, scope resets, late Apply, pinned recovery and no refetch on filter interactions. Run focused tests, full Node 24 `pnpm test`, Android export and release checks.

Named build: **Flight Log Stage 4 QA**, package `com.xxvalhallacoderxx.xcmvp.stage4qa`, retaining INTERNET. Use synthetic data for populated/empty/offline/all-card-state checks, keyboard/search, Back, scrolling, enlarged text and TalkBack. Record build hash, source commit, device and screenshots. PAR-50/51 remain open until screen acceptance; PAR-44 records only the delivered slice. No automatic acceptance of prior outstanding gates.
