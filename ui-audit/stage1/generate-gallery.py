#!/usr/bin/env python3
"""Generate the local evidence gallery; new captures require explicit provenance."""

from html import escape
from pathlib import Path
import struct


ROOT = Path(__file__).resolve().parent
CAPTURES = {
    "01-welcome.png": ("A", "Welcome", "Illustrated welcome and recorder limitation notice."),
    "02-welcome-guard.png": ("A", "Acknowledgement guard", "Start and Skip were disabled; tapping either before acknowledgement did not exit."),
    "03-name.png": ("A", "Optional private name", "Name is the first numbered setup step; equipment stays in Pilot details."),
    "04-name-keyboard.png": ("A", "Name with keyboard", "Initial keyboard evidence; enlarged-text checks are recorded separately on B."),
    "05-permissions-initial.png": ("earlier", "Permissions entry", "Earlier interim capture of passive permission status. Exact APK identity is not assigned."),
    "06-approximate.png": ("earlier", "Approximate location", "Earlier interim capture distinguishes approximate location. Exact APK identity is not assigned."),
    "07-settings-return.png": ("earlier", "Initial Settings return", "Earlier interim capture of permission refresh after Settings. Exact APK identity is not assigned."),
    "08-draft-settings-return.png": ("A", "Draft retained after Settings", "The unsaved provider-owned name draft survived the Settings round trip."),
    "09-restart-prefill.png": ("A", "Restart prefill", "After force-stop, unfinished setup returned to Welcome and used the saved name, dropping the unsaved draft."),
    "10-notifications-denied.png": ("A", "Optional notifications denied", "Denial retained the Not now path through setup."),
    "11-backup.png": ("A", "Optional Backup, step 3 of 3", "Not now advanced from Permissions to optional Backup before offline completion."),
    "12-home-offline.png": ("B", "Completed offline Home", "Installing and restarting B retained completed setup and opened Home without an account."),
    "13-equipment-editor.png": ("A", "Pilot equipment editor", "Equipment remained in the existing Pilot details editor."),
    "14-pilot.png": ("B", "Pilot details preserved", "Saved private name, QA Test Glider, and QA-123 survived installation and restart."),
    "15-review.png": ("B", "Review setup", "Review closed with Android Back and the Close button."),
    "16-blocked-preflight.png": ("B", "Blocked recorder preflight", "Recorder preflight remained blocked while required permission was unavailable."),
    "17-name-enlarged.png": ("B", "Name at enlarged font scale", "Font scale 1.3; name content and controls remained reachable."),
    "18-name-keyboard-enlarged.png": ("B", "Enlarged name with keyboard", "Font scale 1.3 with the keyboard open; action buttons remained reachable."),
    "19-permissions-enlarged.png": ("B", "Enlarged Permissions", "Font scale 1.3; setup step changes reset scroll position to the top."),
    "20-permanent-denial.png": ("B", "Permanent denial", "Only QA was seeded with revoke/user-fixed. Retry returned without a prompt before refreshed state offered Open app settings."),
    "21-permissions-restored.png": ("B", "Permissions restored", "Settings → Permissions → Location → Allow all the time restored precise/allowed state; the long-name draft remained intact."),
    "22-device-location-off.png": ("B", "Device location off", "The disabled service showed OFF and Open location settings. Foreground refresh reflected re-enabling the service."),
    "23-friends-offline.png": ("B", "Signed-out Friends offline", "Friends correctly offered Open Pilot. Enlarged tab labels are clipped in this earlier capture; final E corrects them in captures 33–34."),
    "24-talkback-progress.png": ("C", "TalkBack progress focus", "With TalkBack enabled and bound, keyboard traversal focused the accessible setup progress control."),
    "25-talkback-name.png": ("C", "TalkBack name focus", "Tab/Shift+Tab moved visible blue focus to the name field."),
    "26-talkback-permissions.png": ("C", "TalkBack activation to Permissions", "Two Tabs and Enter activated Skip and advanced from Name to Permissions."),
    "27-talkback-not-now.png": ("C", "TalkBack Not now focus", "Five Tabs focused the optional Not now action on Permissions."),
    "28-talkback-backup.png": ("C", "TalkBack activation to Backup", "Enter on Not now opened optional Backup at step 3 of 3."),
    "29-qa-ground-recording.png": ("C", "Ground recording fixture", "A ground fixture was recorded for postcard checks. After Stop, map-image loading crashed in this no-INTERNET harness; this is not flight-reliability evidence."),
    "30-postcard-square-d.png": ("D", "Square postcard · Flying", "Visual preview passed for Bricolage typography, layout, recorded route, statistics and signature. No export or send was performed."),
    "31-postcard-story-d.png": ("D", "Story postcard · Launch", "Second format/scene preview passed typography and layout checks with the recorded route, statistics and signature preserved."),
    "32-postcard-ready-d.png": ("D", "Postcard readiness after returning", "Home → return enabled Share image without edits. Fresh-open Modal focus is a pre-existing PAR-65 follow-up; no export or send was performed."),
    "33-home-tabs-normal-e.png": ("E", "Final Home tabs · normal text", "Font scale 1.0: Home / Friends / Pilot labels are fully visible after the tab-height correction."),
    "34-friends-tabs-enlarged-e.png": ("E", "Final Friends tabs · enlarged text", "Font scale 1.3: the tab bar grows with text and retains complete labels above the system navigation bar."),
    "35-pilot-equipment-preserved-e.png": ("E", "Final Pilot editor · preserved values", "At font scale 1.3, the editor retains Stage One Pilot, QA-123 and QA Test Glider after the QA build updates."),
    "36-postcard-disabled-e.png": ("E", "Existing postcard focus issue", "Fresh-open Share image remains disabled although the preview is visible. This existing readiness logic is unchanged from base b4b3771 and is tracked with PAR-65."),
    "37-postcard-ready-e.png": ("E", "Postcard focus recovery · final build", "The same unedited postcard after Home → return: Share image is enabled. Native UI trees preserve the disabled/enabled difference; no export or send occurred."),
    "38-review-final-e.png": ("E", "Final Review dismissal", "Review opens with Close review available; Android Back returned to Settings on final E."),
}
BUILD_LABELS = {
    "A": "A · interim behavior",
    "B": "B · interim visual fixes",
    "C": "C · offline setup only",
    "D": "D · standard QA previews",
    "E": "E · final standard QA",
    "earlier": "Earlier interim · exact build unassigned",
    "unclassified": "Unclassified · provenance required",
}


def dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as image:
        header = image.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def card(path: Path) -> str:
    fallback_title = path.stem.replace("-", " ")
    build, title, caption = CAPTURES.get(path.name, (
        "unclassified", fallback_title,
        "New capture: add its observed result and build association to generate-gallery.py before using it for acceptance.",
    ))
    width, height = dimensions(path)
    href = f"screens/{path.name}"
    return f"""<figure data-build="{escape(build)}">
  <a class="image-link" href="{escape(href)}" target="_blank" rel="noopener" aria-label="Open original: {escape(title)}">
    <img src="{escape(href)}" alt="{escape(title)}" width="{width}" height="{height}" loading="lazy" decoding="async">
  </a>
  <figcaption>
    <span class="badge {escape(build)}">{escape(BUILD_LABELS[build])}</span>
    <h2>{escape(title)}</h2>
    <p>{escape(caption)}</p>
    <a href="{escape(href)}" target="_blank" rel="noopener">Open original PNG · {width} × {height}</a>
    <small>{escape(path.name)}</small>
  </figcaption>
</figure>"""


def main() -> None:
    images = sorted((ROOT / "screens").glob("*.png"))
    cards = "\n".join(card(path) for path in images)
    document = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Flight Log · Stage 1 evidence gallery</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; color: #18382c; background: #f3f0e7; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 1500px; margin: auto; padding: clamp(16px, 3vw, 40px); }
    header { max-width: 940px; margin-bottom: 28px; }
    h1 { margin: 8px 0 16px; font-size: clamp(28px, 4vw, 44px); line-height: 1.12; }
    header p { font-size: 16px; line-height: 1.6; }
    a { color: #963a23; text-underline-offset: 3px; }
    a:focus-visible, select:focus-visible { outline: 3px solid #156ac3; outline-offset: 4px; }
    nav { display: flex; flex-wrap: wrap; gap: 16px; }
    .context { padding: 16px 20px; border-left: 4px solid #63705f; background: #fcfbf5; border-radius: 4px; }
    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 20px 0; }
    select { min-height: 44px; padding: 8px 12px; border: 1px solid #63705f; border-radius: 8px; font: inherit; color: inherit; background: #fcfbf5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr)); gap: 24px; align-items: start; }
    figure { margin: 0; background: #fcfbf5; border: 1px solid #d8dccf; border-radius: 14px; overflow: hidden; }
    figure[hidden] { display: none; }
    .image-link { display: block; background: #e7e7e1; border-bottom: 1px solid #d8dccf; }
    img { width: 100%; height: auto; display: block; }
    figcaption { padding: 18px; }
    h2 { font-size: 19px; line-height: 1.3; margin: 12px 0 8px; }
    figcaption p { color: #44543f; line-height: 1.5; font-size: 14px; margin: 0 0 14px; }
    figcaption a { font-size: 14px; }
    small { display: block; margin-top: 12px; color: #63705f; overflow-wrap: anywhere; }
    .badge { display: inline-block; font-size: 12px; font-weight: 700; line-height: 1.4; padding: 5px 8px; border-radius: 6px; background: #eee4ca; color: #5c481e; }
    .badge.B { background: #e1e9ed; color: #274e64; }
    .badge.C { background: #e1ebde; color: #245323; }
    .badge.D { background: #e5e0f0; color: #53416c; }
    .badge.E { background: #d7e9de; color: #183f2b; }
    .badge.earlier, .badge.unclassified { background: #f1dfd7; color: #773c25; }
    footer { margin-top: 32px; color: #44543f; line-height: 1.6; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
<main>
  <header>
    <p>Flight Log · Android QA · 27 September 2026</p>
    <h1>Stage 1 evidence gallery</h1>
    <nav aria-label="Evidence documents"><a href="README.md">Read acceptance and provenance</a><a href="build-identity.json">Final E build identity</a><a href="build-standard-d-identity.json">D preview build identity</a><a href="build-identity.json">Offline setup identities</a><a href="talkback-service.txt">TalkBack service evidence</a></nav>
    <p>Samsung SM-S938B · Android 16 · 1080 × 2340 · density 420. Select an image to open its original PNG at full resolution.</p>
    <div class="context">
      <p>The required Stage 1 checks have passed within the <a href="README.md#installed-device-acceptance">documented acceptance bounds</a>; screenshots and final statuses were read back: PAR-45/46 are Done; PAR-44/41/42 and PAR-65 remain open. Captures retain individual build labels. A, B, and C are setup-only QA builds with INTERNET removed; C includes the accessibility fix from <code>1234143</code>. Earlier interim captures have no exact APK assignment. Standard D retains INTERNET for postcard previews. Final E adds the enlarged-tab correction from <code>e835a52</code>, with fully visible labels at font scales 1.0 and 1.3.</p>
      <p>The no-INTERNET setup harness raised a native image-loader SecurityException after a ground fixture was saved. Its screenshots do not establish general offline-app reliability.</p>
      <p>TalkBack evidence covers the enabled/bound service, visible keyboard focus, activation, and overlay isolation. It does not establish an auditory recording or a complete gesture audit.</p>
      <p>Postcard font/layout previews passed on standard QA. An existing Modal-focus issue can disable Share image until Home → return; it is recorded for PAR-65. No postcard was exported or sent.</p>
    </div>
  </header>
  <div class="tools">
    <label for="build-filter">Show captures</label>
    <select id="build-filter">
      <option value="all">All builds</option><option value="A">A · interim behavior</option><option value="B">B · interim visual fixes</option><option value="C">C · offline setup only</option><option value="D">D · standard QA previews</option><option value="E">E · final standard QA</option><option value="earlier">Earlier interim</option><option value="unclassified">Unclassified</option>
    </select>
    <span id="count" aria-live="polite">__COUNT__ captures</span>
  </div>
  <section class="grid" aria-label="Device screenshots">
__CARDS__
  </section>
  <footer><p>Generated from every PNG currently in <code>screens/</code>. Rebuild with <code>python3 ui-audit/stage1/generate-gallery.py</code>; classify new captures in the generator before citing them as acceptance evidence. This gallery does not change ticket status.</p></footer>
</main>
<script>
  const filter = document.querySelector('#build-filter');
  const cards = [...document.querySelectorAll('figure[data-build]')];
  filter.addEventListener('change', () => {
    for (const card of cards) card.hidden = filter.value !== 'all' && card.dataset.build !== filter.value;
    document.querySelector('#count').textContent = `${cards.filter(card => !card.hidden).length} of ${cards.length} captures`;
  });
</script>
</body>
</html>
"""
    (ROOT / "gallery.html").write_text(document.replace("__COUNT__", str(len(images))).replace("__CARDS__", cards))
    print(f"Generated gallery.html with {len(images)} captures.")


if __name__ == "__main__":
    main()
