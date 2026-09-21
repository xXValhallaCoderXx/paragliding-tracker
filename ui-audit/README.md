# Flight Log UI audit

[Open the searchable gallery](index.html)

[Design review notes](design-review-notes.md) · [Coverage and gaps](coverage.md)

**108 captures across 20 groups.** Original PNGs are retained without resizing or recompression.

Click a gallery thumbnail or an original-image link to inspect the native-size file. Long screens may have numbered parts; capture notes explain each state.

## Evidence

- [Capture manifest](captures.json)
- [Validation report](validation-report.json)
- [Browser validation](browser-validation.json)
- [Device cleanup](device-cleanup.json)
- [Hosted cleanup](hosted-cleanup.json)
- [Device and build](device-and-build.json)
- [Planned screen inventory](planned-screen-inventory.md)

Validation checks file existence, in-audit paths, PNG structure/chunk CRCs, original dimensions and SHA-256. It does not establish visual correctness, feature completeness or field reliability.

Dimensions: 1080 × 2340 px (108).

## Groups

- [settings](groups/settings-cde0fb0d/README.md) — 2 captures
- [offline-maps](groups/offline-maps-a8abb6f7/README.md) — 10 captures
- [friends-profile](groups/friends-profile-43253083/README.md) — 4 captures
- [feed](groups/feed-c8bc2586/README.md) — 8 captures
- [pilot-search](groups/pilot-search-45adce2b/README.md) — 9 captures
- [friend-profile](groups/friend-profile-bfdddfcc/README.md) — 3 captures
- [manage-friends](groups/manage-friends-369e0508/README.md) — 5 captures
- [onboarding](groups/onboarding-a4963c49/README.md) — 5 captures
- [logbook](groups/logbook-a5b89279/README.md) — 7 captures
- [recorder](groups/recorder-93384247/README.md) — 10 captures
- [system-permissions](groups/system-permissions-1a720eca/README.md) — 2 captures
- [flight-detail](groups/flight-detail-44a1713f/README.md) — 10 captures
- [account](groups/account-9af21132/README.md) — 13 captures
- [flight-edit](groups/flight-edit-6b266c6d/README.md) — 3 captures
- [replay](groups/replay-ac203c98/README.md) — 3 captures
- [postcard](groups/postcard-22f0b24b/README.md) — 8 captures
- [shared-flight](groups/shared-flight-c0cdc514/README.md) — 2 captures
- [kudos](groups/kudos-95f3e4b1/README.md) — 1 captures
- [shared-replay](groups/shared-replay-73311678/README.md) — 2 captures
- [navigation](groups/navigation-d70d5a79/README.md) — 1 captures

## Regenerate

Run `python3 ui-audit/build-gallery.py` from the repository, or pass `--audit-dir` for a separate fixture directory. No dependencies or server are required. The gallery works directly from disk.

The generator reads `captures.json`; it writes this README, `index.html`, `validation-report.json` and group READMEs under `groups/`. It also writes `screens/<folder>/README.md` when that folder belongs to exactly one group and contains all its captures. It leaves screenshots, the manifest, review notes, coverage, build/cleanup receipts and the planned inventory untouched.

Generated: 2026-09-20T21:51:28.507047+00:00
