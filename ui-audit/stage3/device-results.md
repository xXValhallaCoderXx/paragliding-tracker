# Stage 3 Android results — 28 September 2026

Installed **Flight Log Stage 3 QA**, package `com.xxvalhallacoderxx.xcmvp.stage3qa`, from implementation commit `7728c4845d60a173998a98beac795a7217a7f2e9`. [Build identity and hashes](build-identity.json) verify the release APK, bundled sources and INTERNET permission. Samsung SM-S938B / Android 16. Standalone release; no Metro connection.

Tests began with the existing 840×1600 display override (320dp width) and font scale 1.3, and also used the native 1080×2340 size. Original display/font/accessibility settings were restored. The existing accessibility overlay visible in screenshots belongs to the phone, not Flight Log. Normal app and Stage 2 data were not reset or replaced. Only synthetic names, aircraft and identifiers were entered; no actual flight was recorded.

| Check | Observed result |
| --- | --- |
| Fresh local-only setup | Acknowledgement then Skip setup opened Home; Pilot showed empty aircraft. [Empty state](screens/01-pilot-empty-small-large-text.png). |
| Private pilot editor | Saved synthetic name and reopened saved value. First Android Back dismissed keyboard; second offered Keep editing / Discard. Keep editing retained draft. Scroll exposed truthful export preview. [Preview](screens/02-private-pilot-igc.png). Save-failure injection is covered separately in component tests. |
| Validation and three sports | Save without sport showed actionable error. Paraglider, Hang glider and Speedwing saved with optional size/registration; identifiers stayed separate. Adding another paraglider reused its existing identifier. [Groups](screens/05-three-sports.png). |
| Native inputs and large text | All fields, header Save, optional identifier, current toggle, IGC preview and explanatory copy remained reachable by scrolling at 320dp / 1.3 font scale. [Headers](screens/04-aircraft-header-preview.png). |
| Draft lifecycle | Android Back/Discard removed a changed add draft; re-entry had blank fields and no sport. Home/app switch then return preserved the mounted model, registration and identifier draft. |
| Current/default | First saved aircraft became current. Explicitly making Speedwing current replaced the previous default. [Current after overrides](screens/08-default-preserved-after-preflight.png). |
| Preflight override and none | Selected Hang glider for one flight, then explicit none. Pilot still showed Speedwing current. [Choices](screens/06-preflight-choices.png), [none](screens/07-preflight-none.png). Recording itself was not started. |
| Archive and restore | Confirmation stated that archiving current clears it. Archived current left other aircraft without a Current marker; restoring returned the aircraft without choosing it. [Archived](screens/09-archived-aircraft.png). |
| TalkBack | Pending. Initial generic component was unavailable; the installed Samsung service was identified and bound, but opened its phone-access setup prompt. No phone permission was granted. Original enabled services were restored; no spoken-label acceptance claimed. |
| Physical signed-in backup/restoration | Pending user sign-in on this isolated app. The 20 hosted HTTP checks passed separately. |
| Physical offline/conflict/error recovery | Pending. Local-only UI and automated local/network-failure tests passed, but those are not a physical offline or second-device demonstration. |

The isolated QA app remains installed with synthetic equipment and the sign-in screen ready. No credentials or codes are stored in shared evidence. Account-bearing captures, if needed later, belong only under ignored `.artifacts/stage3/device-private/`.

This is partial device acceptance. PAR-48/49 remain open with their implementation dependencies until remaining gates are accepted; PAR-61/66 remain open for their broader work. No background/endurance/field-reliability claim is made.
