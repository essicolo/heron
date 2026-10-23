"""Generates css/userChrome.css, heron's CSS-only edition, from the add-on's own style sheets.

It keeps everything that is plain CSS and drops the rules that only make sense with heron's code: those whose selector targets something the scripts create or set (an id, class or attribute containing "heron", such as the "Aa" button or the hidden formatting bar). Run it after changing a style sheet; dev/release.sh runs it too, and the release workflow checks that the committed file is up to date.

Usage: python3 -I dev/make-css.py
"""

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHEETS = ["extension/styles/theme.css", "extension/styles/compose.css"]
OUTPUT = ROOT / "css" / "userChrome.css"


def blocks(css):
    """Splits CSS into top-level items: (prelude, body or None, text). Comments stay attached to the next item."""
    items, i, start = [], 0, 0
    while i < len(css):
        if css.startswith("/*", i):
            i = css.index("*/", i) + 2
            continue
        c = css[i]
        if c == "{":
            depth, j = 1, i + 1
            while depth:
                if css.startswith("/*", j):
                    j = css.index("*/", j) + 2
                    continue
                depth += {"{": 1, "}": -1}.get(css[j], 0)
                j += 1
            items.append((css[start:i], css[i + 1:j - 1], css[start:j]))
            i = start = j
            continue
        if c == ";":
            items.append((css[start:i + 1], None, css[start:i + 1]))
            start = i + 1
        i += 1
    items.append(("", None, css[start:]))  # trailing comments and spaces
    return items


def without_code(css):
    """The same CSS without the rules whose selector mentions heron (nested rules included)."""
    out = []
    for prelude, body, text in blocks(css):
        selector = re.sub(r"/\*.*?\*/", "", prelude, flags=re.S)
        if body is None:
            out.append(text)
        elif "heron" in selector:
            out.append(prelude[: len(prelude) - len(prelude.lstrip())])  # keep the spacing before it
        elif selector.strip().startswith("@") or "{" in body:
            out.append(prelude + "{" + without_code(body) + "}")
        else:
            out.append(text)
    return "".join(out)


version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
header = f"""/* heron {version}, CSS-only edition: https://github.com/essicolo/heron
   Generated from the add-on's style sheets by dev/make-css.py. Do not edit: changes would be lost at the next release.

   No add-on, no code, no permissions: just a style sheet that Thunderbird applies to its own windows.
   It gives heron's calmer look (cards, hairlines, spaces bar, softer warnings, compose toolbar). Everything that needs code (conversation view, swipe, unified search, sender domains, undo send...) is only in the add-on.

   To install:
   1. In Thunderbird, open Help, Troubleshooting Information, and click Open Folder next to Profile Folder.
   2. In that folder, create a folder named chrome (if it isn't there) and put this file in it, named userChrome.css.
   3. In Settings, General, Config Editor, set toolkit.legacyUserProfileCustomizations.stylesheets to true.
   4. Restart Thunderbird.
   For the roomier density and a larger text size, use Settings, Appearance. To remove it, delete the file and restart. */

"""
sheets = []
for name in SHEETS:
    css = re.sub(r"\n[ \t]*(\n[ \t]*)+\n", "\n\n", without_code((ROOT / name).read_text()))  # no runs of blank lines where rules were dropped
    sheets.append(f"/* ===== {name} ===== */\n\n" + css.strip() + "\n")
OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(header + "\n\n".join(sheets))
print(f"{OUTPUT.relative_to(ROOT)}: {len(OUTPUT.read_text().splitlines())} lines")
