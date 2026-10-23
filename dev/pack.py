"""Builds heron's .xpi reproducibly: the same source always gives the same file, byte for byte.

Files are sorted, stored uncompressed (compressed output varies with the zlib version), every date is fixed and no machine-specific metadata is stored, so anyone can rebuild a release from the repository and compare its SHA-256 with the published one. Used by dev/release.sh, dev/build-xpi.sh and the release workflow (.github/workflows/release.yml).

Usage: python3 -I dev/pack.py OUTPUT.xpi [--update-url URL]
With --update-url, the manifest gets that update_url (GitHub releases); without it, the manifest is packed as is.
"""

import argparse
import hashlib
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
FIXED_DATE = (1980, 1, 1, 0, 0, 0)  # earliest date a zip can store

parser = argparse.ArgumentParser()
parser.add_argument("output")
parser.add_argument("--update-url")
args = parser.parse_args()

files = sorted(
    path for path in SOURCE.rglob("*")
    if path.is_file() and not any(part.startswith(".") for part in path.relative_to(SOURCE).parts)
)

with zipfile.ZipFile(args.output, "w") as xpi:
    for path in files:
        name = path.relative_to(SOURCE).as_posix()
        data = path.read_bytes()
        if name == "manifest.json" and args.update_url:
            manifest = json.loads(data)
            manifest["browser_specific_settings"]["gecko"]["update_url"] = args.update_url
            data = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()
        info = zipfile.ZipInfo(name, FIXED_DATE)
        info.compress_type = zipfile.ZIP_STORED  # no compression: compressed output depends on the zlib version of the machine
        info.external_attr = 0o644 << 16  # same permissions everywhere
        info.create_system = 3  # Unix, whatever the machine
        xpi.writestr(info, data)

digest = hashlib.sha256(pathlib.Path(args.output).read_bytes()).hexdigest()
print(f"{args.output} sha256:{digest}")
