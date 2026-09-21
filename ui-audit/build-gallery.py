#!/usr/bin/env python3
"""Build a local, searchable screenshot gallery using only the Python standard library.

Usage: python3 ui-audit/build-gallery.py [--audit-dir /path/to/audit]
Input: captures.json with {"captures": [{"id", "group", "title", "file", ...}]}.
Optional capture fields: notes (string or strings), capturedAt, accountKind, sourceBuild,
sha256, width, height. Paths are relative to the audit directory. Captures stay unmodified.
Validation failures write validation-report.json and exit 1 without replacing the gallery.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from html import escape
import json
from pathlib import Path, PurePosixPath
import re
import struct
import sys
import unicodedata
from urllib.parse import quote
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_info(data: bytes) -> tuple[int, int]:
    """Check the PNG structure and every chunk CRC; read the original IHDR dimensions."""
    if not data.startswith(SIGNATURE):
        raise ValueError("Not a PNG: signature mismatch")
    offset, width, height, count, saw_data, ended = 8, 0, 0, 0, False, False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("Truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError("Truncated PNG chunk payload")
        body = data[offset + 8:end - 4]
        actual_crc = zlib.crc32(kind + body) & 0xffffffff
        if struct.unpack_from(">I", data, end - 4)[0] != actual_crc:
            raise ValueError(f"PNG CRC mismatch in {kind.decode('ascii', errors='replace')}")
        if count == 0 and kind != b"IHDR":
            raise ValueError("PNG must start with IHDR")
        if kind == b"IHDR":
            if count != 0 or length != 13:
                raise ValueError("Invalid or repeated PNG IHDR")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", body)
            valid_depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
            if not (0 < width <= 0x7fffffff and 0 < height <= 0x7fffffff):
                raise ValueError("Invalid PNG dimensions")
            if depth not in valid_depths.get(color, ()) or compression or filtering or interlace not in (0, 1):
                raise ValueError("Invalid PNG pixel format")
        if kind == b"IDAT":
            saw_data = True
        if kind == b"IEND":
            if length or not saw_data:
                raise ValueError("Invalid PNG end or missing image data")
            if end != len(data):
                raise ValueError("Unexpected bytes after PNG end")
            ended = True
            break
        offset, count = end, count + 1
    if not ended:
        raise ValueError("PNG has no complete IEND")
    return width, height


def text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(text(item) for item in value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def md(value: object) -> str:
    return escape(text(value)).replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("|", "\\|")


def href(value: str) -> str:
    return quote(value, safe="/-._~")


def group_slug(group: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", group).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:70] or "group"
    return f"{slug}-{hashlib.sha256(group.encode()).hexdigest()[:8]}"


def write(path: Path, content: str) -> None:
    # These files are generated as complete documents; replace atomically.
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def validate(root: Path, manifest: object) -> tuple[list[dict], list[str], list[str]]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("captures"), list):
        return [], ['Manifest must be an object with a "captures" array'], []
    records, errors, warnings, seen_ids, seen_files = [], [], [], set(), set()
    for index, capture in enumerate(manifest["captures"]):
        label = f"captures[{index}]"
        try:
            if not isinstance(capture, dict):
                raise ValueError("Capture must be an object")
            for field in ("id", "group", "title", "file"):
                if not isinstance(capture.get(field), str) or not capture[field].strip():
                    raise ValueError(f"{field} must be a nonempty string")
            label = capture["id"]
            if label in seen_ids:
                raise ValueError("Duplicate capture id")
            seen_ids.add(label)
            relative = PurePosixPath(capture["file"])
            if relative.is_absolute() or ".." in relative.parts or "\\" in capture["file"]:
                raise ValueError("file must be a relative path inside the audit directory")
            path = (root / relative).resolve()
            if not path.is_relative_to(root) or path.suffix.lower() != ".png":
                raise ValueError("file must resolve to a PNG inside the audit directory")
            data = path.read_bytes()
            width, height = png_info(data)
            digest = hashlib.sha256(data).hexdigest()
            for field, actual in (("width", width), ("height", height), ("sha256", digest)):
                expected = capture.get(field)
                if expected is not None and expected != actual:
                    raise ValueError(f"{field} differs from manifest: expected {expected}, got {actual}")
            if capture["file"] in seen_files:
                warnings.append(f"{label}: file is referenced by more than one capture")
            seen_files.add(capture["file"])
            records.append({**capture, "file": relative.as_posix(), "width": width, "height": height,
                            "sha256": digest, "bytes": len(data)})
        except (ValueError, OSError, struct.error) as error:
            errors.append(f"{label}: {error}")
    return records, errors, warnings


STYLE = """
:root{color-scheme:light;--ink:#203e36;--muted:#52645d;--border:#d3d9d2;--paper:#f6f4eb}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
a{color:#205c8d;text-underline-offset:3px}a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #b75025;outline-offset:3px}
header,main,footer{max-width:1500px;margin:auto;padding:24px}h1{margin:0 0 8px;font-size:clamp(26px,4vw,42px)}
h2{margin-top:30px}p{margin:8px 0}nav{display:flex;flex-wrap:wrap;gap:10px 20px;margin:18px 0}.muted{color:var(--muted)}
.filters{display:flex;flex-wrap:wrap;gap:14px;align-items:end;margin:20px 0}.filters label{display:flex;flex-direction:column;gap:4px}
input,select{font:inherit;padding:10px;border:1px solid var(--border);border-radius:8px;max-width:100%;background:white;color:var(--ink)}
input{width:min(440px,80vw)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:18px}
.card{padding:16px;background:#fffdf7;border:1px solid var(--border);border-radius:14px;min-width:0;overflow-wrap:anywhere}
.card h3{font-size:18px;margin:12px 0 6px}.image{display:flex;justify-content:center;align-items:center;min-height:200px;height:370px;background:#e7e9e4;border-radius:8px;overflow:hidden}
.image img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}.meta{font-size:13px;color:var(--muted)}
.notes{font-size:14px;white-space:pre-wrap}.card details{font-size:12px;overflow-wrap:anywhere}.group-count{font-size:14px;font-weight:normal}
[hidden]{display:none!important}.empty{padding:30px;border:1px dashed var(--border)}footer{font-size:13px;color:var(--muted)}
@media(max-width:600px){header,main,footer{padding:16px}.image{height:440px}.filters label{width:100%}input,select{width:100%}}
"""
SCRIPT = """
const search=document.getElementById('search'), filter=document.getElementById('group');
const cards=[...document.querySelectorAll('.card')], groups=[...document.querySelectorAll('.capture-group')];
function apply(){const terms=search.value.toLocaleLowerCase().trim().split(/\\s+/).filter(Boolean);let shown=0;
for(const card of cards){const match=(!filter.value||card.dataset.group===filter.value)&&terms.every(term=>card.dataset.search.includes(term));card.hidden=!match;if(match)shown++;}
for(const group of groups){const visible=[...group.querySelectorAll('.card')].filter(card=>!card.hidden).length;group.hidden=!visible;group.querySelector('.group-count').textContent=visible+' shown';}
document.getElementById('count').textContent=shown+' of '+cards.length+' captures shown';document.getElementById('empty').hidden=shown!==0;}
search.addEventListener('input',apply);filter.addEventListener('change',apply);apply();
"""


def build(root: Path, records: list[dict], generated_at: str) -> None:
    grouped: dict[str, list[dict]] = {}
    for capture in records:
        grouped.setdefault(capture["group"], []).append(capture)
    directory_groups: dict[PurePosixPath, set[str]] = {}
    for capture in records:
        directory_groups.setdefault(PurePosixPath(capture["file"]).parent, set()).add(capture["group"])
    review_links = [(name, label) for name, label in (
        ("design-review-notes.md", "Design review notes"), ("coverage.md", "Coverage and gaps"),
    ) if (root / name).is_file()]
    receipt_links = [(name, label) for name, label in (
        ("browser-validation.json", "Browser validation"), ("device-cleanup.json", "Device cleanup"),
        ("hosted-cleanup.json", "Hosted cleanup"),
    ) if (root / name).is_file()]
    navigation = "".join(f'<a href="{name}">{label}</a>' for name, label in review_links + receipt_links)
    options, sections, group_links = [], [], []
    for group, captures in grouped.items():
        slug = group_slug(group)
        options.append(f'<option value="{escape(group, quote=True)}">{escape(group)}</option>')
        group_links.append(f"- [{md(group)}](groups/{slug}/README.md) — {len(captures)} captures")
        lines = [f"# {md(group)}", "", f"{len(captures)} full-resolution captures. [Gallery](../../index.html#{slug}) · [All groups](../../README.md)", ""]
        cards = []
        for capture in captures:
            identifier, title, file = capture["id"], capture["title"], capture["file"]
            dimensions = f'{capture["width"]} × {capture["height"]}'
            metadata = " · ".join(f"{label}: {text(capture.get(key))}" for key, label in
                                  (("accountKind", "Account"), ("capturedAt", "Captured"), ("sourceBuild", "Build")) if capture.get(key))
            notes = text(capture.get("notes"))
            search_text = " ".join(text(capture.get(key)) for key in ("id", "group", "title", "notes", "accountKind", "capturedAt", "sourceBuild")).lower()
            url = href(file)
            cards.append(f'''<article class="card" data-group="{escape(group, quote=True)}" data-search="{escape(search_text, quote=True)}">
<a class="image" href="{url}" target="_blank" rel="noopener" aria-label="Open original: {escape(title, quote=True)}"><img src="{url}" alt="{escape(title, quote=True)}" width="{capture['width']}" height="{capture['height']}" loading="lazy" decoding="async"></a>
<h3>{escape(title)}</h3><p class="meta">{escape(identifier)} · {dimensions} px</p><p class="meta">{escape(metadata)}</p>
<p class="notes">{escape(notes)}</p><p><a href="{url}" target="_blank" rel="noopener">Open original PNG</a> · <a href="{url}" download>Download</a></p>
<details><summary>Integrity</summary><p>SHA-256: {capture['sha256']}</p><p>{capture['bytes']:,} bytes</p></details></article>''')
            lines.extend([f"## {md(title)}", "", f"[{md(identifier)} — original PNG]({href('../../' + file)})", "",
                          f"{dimensions} px · {capture['bytes']:,} bytes", "", md(metadata) or "Capture metadata not supplied.", ""])
            if notes:
                lines.extend([md(notes), ""])
            lines.extend([f"SHA-256: `{capture['sha256']}`", ""])
        group_readme = "\n".join(lines)
        write(root / "groups" / slug / "README.md", group_readme)
        directories = {PurePosixPath(capture["file"]).parent for capture in captures}
        if len(directories) == 1:
            directory = next(iter(directories))
            # Both locations have the same depth, so their ../../ original links agree.
            # A shared folder or a group spanning folders has no unambiguous local README.
            if len(directory.parts) == 2 and directory.parts[0] == "screens" and len(directory_groups[directory]) == 1:
                write(root / directory / "README.md", group_readme)
        sections.append(f'<section class="capture-group" id="{slug}"><h2>{escape(group)} <span class="group-count">{len(captures)} captures</span></h2><p><a href="groups/{slug}/README.md">Group notes</a></p><div class="grid">{"".join(cards)}</div></section>')
    html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flight Log UI audit</title><style>{STYLE}</style></head>
<body><header><h1>Flight Log UI audit</h1><p>Original screenshots at their captured resolution. Thumbnails fit the cards; open an original to inspect every pixel.</p>
<nav><a href="README.md">Audit summary</a>{navigation}<a href="captures.json">Capture manifest</a><a href="validation-report.json">Integrity report</a></nav>
<div class="filters"><label>Search captures<input id="search" type="search" placeholder="Screen, state, note or account" autocomplete="off"></label><label>Group<select id="group"><option value="">All groups</option>{''.join(options)}</select></label></div>
<p id="count" role="status" aria-live="polite">{len(records)} captures in {len(grouped)} groups</p><noscript>All captures are shown. Enable JavaScript to filter them.</noscript></header>
<main><p id="empty" class="empty" hidden>No captures match. Try another search or select all groups.</p>{''.join(sections)}</main>
<footer>Generated {escape(generated_at)}. Files remain local; no external scripts, fonts, requests or analytics.</footer><script>{SCRIPT}</script></body></html>'''
    write(root / "index.html", html)
    dimensions = Counter(f"{record['width']} × {record['height']}" for record in records)
    review_navigation = " · ".join(f"[{label}]({name})" for name, label in review_links)
    lines = ["# Flight Log UI audit", "", "[Open the searchable gallery](index.html)", "", review_navigation, "",
             f"**{len(records)} captures across {len(grouped)} groups.** Original PNGs are retained without resizing or recompression.", "",
             "Click a gallery thumbnail or an original-image link to inspect the native-size file. Long screens may have numbered parts; capture notes explain each state.", "",
             "## Evidence", "", "- [Capture manifest](captures.json)", "- [Validation report](validation-report.json)"]
    for name, label in [*receipt_links, ("device-and-build.json", "Device and build"), ("planned-screen-inventory.md", "Planned screen inventory")]:
        if (root / name).is_file():
            lines.append(f"- [{label}]({name})")
    lines.extend(["", "Validation checks file existence, in-audit paths, PNG structure/chunk CRCs, original dimensions and SHA-256. It does not establish visual correctness, feature completeness or field reliability.", "", "Dimensions: " + "; ".join(f"{size} px ({count})" for size, count in dimensions.items()) + ".", "", "## Groups", "", *group_links,
                  "", "## Regenerate", "", "Run `python3 ui-audit/build-gallery.py` from the repository, or pass `--audit-dir` for a separate fixture directory. No dependencies or server are required. The gallery works directly from disk.", "",
                  "The generator reads `captures.json`; it writes this README, `index.html`, `validation-report.json` and group READMEs under `groups/`. It also writes `screens/<folder>/README.md` when that folder belongs to exactly one group and contains all its captures. It leaves screenshots, the manifest, review notes, coverage, build/cleanup receipts and the planned inventory untouched.", "", f"Generated: {generated_at}", ""])
    write(root / "README.md", "\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit-dir", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    root = args.audit_dir.resolve()
    generated_at = datetime.now(timezone.utc).isoformat()
    try:
        manifest = json.loads((root / "captures.json").read_text(encoding="utf-8"))
        records, errors, warnings = validate(root, manifest)
    except (OSError, ValueError) as error:
        records, errors, warnings = [], [str(error)], []
    report = {"generatedAt": generated_at, "valid": not errors, "captureCount": len(records),
              "groupCount": len({record["group"] for record in records}), "errors": errors, "warnings": warnings,
              "validation": ["file exists", "relative in-audit path", "PNG signature and structure", "PNG chunk CRCs", "IHDR dimensions", "SHA-256", "optional manifest width/height/hash match"],
              "captures": [{key: record[key] for key in ("id", "group", "file", "width", "height", "bytes", "sha256")} for record in records]}
    write(root / "validation-report.json", json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        print("Validation failed; existing gallery and READMEs were not replaced.", file=sys.stderr)
        return 1
    build(root, records, generated_at)
    print(f"Validated {len(records)} captures in {report['groupCount']} groups; built {root / 'index.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
