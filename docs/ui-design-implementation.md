# UI design implementation notes

Status as of 2026-08-18: the three routes were restyled to the "field notebook" design.
Recorder, database, headless-task, repository, and root recovery code are unchanged.

## Source

- Claude Design project "MVP app UI design", file `XC Tracker UI.dc.html` (with `support.js`
  and `uploads/xc-tracker-mvp-screens.md`):
  <https://claude.ai/design/p/1b347570-d36c-443c-86a4-421df6e66287?file=XC+Tracker+UI.dc.html>
- Direction: warm paper screens throughout, Archivo + IBM Plex Mono, thermal `#D9591F`,
  altitude `#1F5F6B`, paper `#F4EFE6`.
- The design originally paired these with a near-black instrument mode for the in-flight
  recorder. That was removed on 2026-08-18 in favour of one consistent theme; `StatusPill` and
  `HoldToStop`, which had no paper styling at all, were repainted onto the same soft/border
  pairs `Chip` and `Notice` use.
- Colour tokens are `@theme` variables in `src/global.css`, mirrored in `src/ui/theme.ts` for
  the few runtime JS reads. `src/ui/__tests__/theme-css.test.ts` fails if the two drift.
- The shared kit is `src/components/ui/` (one file per component, barrel `index.ts`), styled
  with NativeWind `className`. It replaced the single 798-line `src/components/flight-ui.tsx`.

Fonts load at runtime with `expo-font` (`useFonts`) from `@expo-google-fonts/archivo` and
`@expo-google-fonts/ibm-plex-mono` in `src/app/_layout.tsx`. Only the seven used weights are
imported, so no native rebuild is required for the design work itself. Custom families carry the
weight in their name; styles never combine `fontFamily` with `fontWeight`.

## Screen mapping

| Design | Route | What it became |
| --- | --- | --- |
| S1 Logbook | `/` (`src/app/(tabs)/index.tsx`) | Season card derived from local finished flights, month-grouped cards, pinned card for the single unfinished flight (recording: neutral; interrupted: attention with Resume / Save partial), empty state, loading, error/retry, Record FAB, disclaimer. |
| S2 Pre-flight | `/record` idle/completed | Readiness rows from `RecorderSnapshot.capabilities` and power state (location, permissions, barometer, battery/optimization) with plain-language consequences; blocked states link to Android settings; manual-start note; Start (or "Start anyway" / "Ask for permission again"). |
| S3 Recording | `/record` arming/recording/stopping | Instrument view: state pill (only "REC" pulses, and only while capture is verifiably healthy), phone-sensors/battery badge, airtime, GPS altitude, ground speed, capture evidence line, degraded cards (stale, recovering, not running, low battery, recorder errors), hold-to-stop, saving and retry-save states. |
| S4 Save flight | `/flights/[id]?saved=stopped\|partial` | The recorder navigates to the flight detail after a save; the hero shows the fresh-save (or partial-save) banner and the optional title/site/notes fields sit directly below. |
| S5 Flight detail | `/flights/[id]` | Story-order hero (distance when a track exists, else airtime), one honest logbook insight, date/time in the recorded timezone, stat rows, metadata form, collapsed "How this was recorded" evidence block with diagnostics export, unsigned IGC share, permanent delete. |
| Recovery states | `/record` interrupted | Attention screen with recorded airtime, fixes, last fix time and altitude; Resume and Save Partial both retained; explains the 20-second recovery deadline. |
| S6 Instruments & connections | — | Not implemented: BLE vario, XContest account, units, storage usage are unsupported. The recorder-version and unsigned-IGC facts appear in the detail evidence block instead. |
| S7 Pilot & season | — | Not implemented as a route. The season totals card on the logbook is the supported subset (derived locally, non-interactive). |
| Share card | — | Not implemented: needs track rendering and image capture, both unsupported. |

## Feature-mapping rules applied

- Working controls only for supported features (recording, resume/finalize, metadata, unsigned
  IGC, diagnostics, delete, Android settings deep links).
- Unsupported features are omitted rather than faked: no map, track thumbnail, chart, climb
  rate, vario/BLE source, weather, equipment, XContest, uploads, share image, accounts, cloud.
- No "Coming later" placeholders were needed; nothing essential to the composition depended on
  an unsupported feature once the map plates were removed.
- The persistent `TEST_BUILD_WARNING` stays on every recorder state; the logbook and empty state
  carry the longer "not a certified flight recorder" sentence.
- Interrupted, stale, recovering and not-running states never use the healthy REC styling.
- Active or processing flights cannot be deleted; deletion copy stays explicit that it is
  permanent with no cloud copy.
- Copy avoids reliability claims that the physical evidence gate has not established.

## States covered

Logbook: loading, empty, list, error/retry, recovering recorder, recording pinned, interrupted
pinned, processing card, partial card, gaps card, no-track card.
Recorder: ready, degraded (no barometer, low battery, battery optimization), blocked (services off,
permissions denied, Expo Go), starting GPS, recording, GPS stale, recovering, not running, saving,
retry save, interrupted (with and without a failed resume), start/resume/finalize errors.
Detail: loading, missing/deleted, fresh save, partial save, processing, partial, gaps, no track,
open flight (in progress / needs attention), unsaved-changes guard, export busy, delete busy.

## Verification

- `pnpm typecheck`, `pnpm lint` (including the React Compiler rules), `pnpm test`,
  `pnpm validate:deps`, Expo Doctor, and Android/iOS exports pass.
- Visual fidelity must be checked on the physical Samsung through the development client before
  standalone acceptance.

## Structure (2026-08-18)

```
src/
  app/                    routes only — (tabs)/index = logbook, record, flights/[id], settings
  components/ui/          shared kit, one file per component + barrel index.ts
  features/               one slice per route segment
    logbook/{components,logbook.ts,__tests__}
    record/{components,recorder-presentation.ts,capture-health.ts,recorder-lifecycle.tsx}
    flights/{components,flight-detail.ts}
  lib/                    cross-cutting helpers (format/, use-stable-animated-value)
  recorder/               domain layer — sqlite, service, igc, metrics (no React)
  ui/theme.ts             TS mirror of the palette for runtime JS reads
global.css                @theme token source of truth
```

Rule: **feature folder name == route segment**. If `/settings` grows beyond route composition,
its feature logic belongs in `src/features/settings/`.
