# Stage 1: shared foundation and setup

Source: [PAR-40](https://linear.app/sentiment-hound/issue/PAR-40), 27 September 2026 pack, PDF pages 1–8 / HTML batch 1 boards 1–8. This agreement supersedes the original board's Archivo direction for this slice.

- PAR-44 foundation: bundled Bricolage Grotesque 400/500/600/700/800 and IBM Plex Mono share one startup/postcard registry. Runtime and CSS tokens share paper, card, sheet, ink/body/rust roles. Muted text is `#63705F`; shared labels/helpers are at least 12px. Primary/secondary/text/icon minimum targets are 56/50/48/44px and grow with text. Dark-recorder tokens are defined only; activation and instrument changes remain PAR-62.
- Navigation labels are **Home / Friends / Pilot**, with existing route URLs. Home is currently the personal logbook; the separate Friends feed remains unchanged. Combined Home, filtering and totals remain PAR-42/50. Cloud-account actions retain account terminology.
- PAR-45: Welcome sits outside **Name → Permissions → optional Backup** (1/3–3/3). Both Welcome exits require acknowledgement. Skip setup opens Home only after saving completion or explicitly choosing Continue without saving. A failed write stays visible.
- The optional private name keeps its 60-character limit. Continue saves a trimmed changed nonblank name before advancing. Skip does not save; blank cannot erase an existing name. Errors keep the draft with Retry/Skip. Friends identity is explicitly separate.
- PAR-46: permission checks on entry/foreground are passive. The view distinguishes approximate/precise, denied, unrequested, unavailable, checking, and disabled device location. `canAskAgain` selects requests versus Settings. Foreground precedes background; notifications have an independent optional action. Neither grants nor notifications imply healthy capture. Requests exclude one another, errors remain actionable, and obsolete results cannot advance prompts or update a departed step.
- Provider state preserves drafts during back navigation, overlay remounts and Android Settings visits. A full restart of unfinished setup returns to Welcome with the saved name. Unfinished drafts are not persisted.
- The navigator remains mounted beneath loading/setup overlays, with touches and screen-reader access blocked. Startup retains the five-second fail-open settings read. Review setup can be closed; it preloads current saved values and does not rewrite completion or acknowledgement history.
- Equipment, glider ID and pilot registration remain in **Pilot → Edit pilot details**. Existing values and IGC mappings are preserved. Broader aircraft/sport/history work stays with PAR-41/48/49.
- No database migration or backend change. Backup inherits shared styling; PAR-47 and the sign-in part of PAR-66 are next.

## Validation

See [Stage 1 evidence](../ui-audit/stage1/README.md) for source/build identity, automated checks, screenshots and Android results. Device checks and implementation checks are separate. PAR-44 stays open for the remaining PAR-42-dependent navigation work. PAR-45/46 can close only after their acceptance evidence passes.

## Isolated Android QA build

`app.config.ts` leaves ordinary builds on their existing package and scheme. `FLIGHT_LOG_QA=stage1` selects `com.xxvalhallacoderxx.xcmvp.stage1qa` / `xcmvp-stage1qa`. Use this standard isolated flavor, with INTERNET retained, for navigation, recording fixtures, and postcard acceptance. It uses the same isolated QA package/database as the setup-only flavor.

Adding `FLIGHT_LOG_QA_OFFLINE=1` removes this QA app's INTERNET permission. That flavor is **for account-free setup checks only**: after a ground recording was stopped, Expo Image/OkHttp attempted to load a map image and raised a native `SecurityException` because INTERNET was missing. Removing the manifest permission is therefore not a valid simulation of general app offline behavior. The ordinary app and standard isolated QA flavor retain INTERNET. Exercise broader offline behavior by controlling network availability, not by removing this permission.

```sh
env -u FLIGHT_LOG_QA_OFFLINE FLIGHT_LOG_QA=stage1 pnpm exec expo prebuild --platform android --no-install
cd android
env -u FLIGHT_LOG_QA_OFFLINE FLIGHT_LOG_QA=stage1 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

For setup-only network isolation, add `FLIGHT_LOG_QA_OFFLINE=1` to both QA commands and label the resulting evidence accordingly. Do not use that artifact for postcard/image-loading acceptance. Preserve its APK/source-map identity separately from the standard QA artifact.

After copying the named QA APK and source maps, regenerate ordinary native configuration with `env -u FLIGHT_LOG_QA -u FLIGHT_LOG_QA_OFFLINE pnpm exec expo prebuild --platform android --no-install`. Prebuild may rewrite the iOS package script; immediately preserve the repository's `expo start --ios` script. Never reset or replace the normal installation for setup acceptance.
