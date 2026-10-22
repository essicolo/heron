#!/bin/zsh
# Prepares a heron release (the version in extension/manifest.json) as two packages of the same code:
#   dist/heron-<version>.xpi: GitHub, with update_url, for automatic updates from the repo
#   dist/heron-<version>-atn.xpi: addons.thunderbird.net, without update_url (ATN handles updates)
# and adds the version to updates.json (at the repo root, read by Thunderbird through update_url).
#
# Usage: dev/release.sh <owner/repo>   e.g. dev/release.sh essicolo/heron
# Publishes nothing: prints the git / gh commands to run once the packages are checked.

set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

REPO="${1:?Usage: dev/release.sh <owner/repo>}"
VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
ID=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['browser_specific_settings']['gecko']['id'])")
MIN=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['browser_specific_settings']['gecko']['strict_min_version'])")
UPDATE_URL="https://raw.githubusercontent.com/$REPO/main/updates.json"
XPI_URL="https://github.com/$REPO/releases/download/v$VERSION/heron-$VERSION.xpi"

mkdir -p dist
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ATN package: the extension as is.
rm -f "dist/heron-$VERSION-atn.xpi"
(cd extension && zip -qr "$ROOT/dist/heron-$VERSION-atn.xpi" . -x '.*')

# GitHub package: same code, manifest with update_url.
cp -R extension "$WORK/extension"
python3 - "$WORK/extension/manifest.json" "$UPDATE_URL" <<'EOF'
import json, sys
path, url = sys.argv[1], sys.argv[2]
manifest = json.load(open(path))
manifest["browser_specific_settings"]["gecko"]["update_url"] = url
open(path, "w").write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
EOF
rm -f "dist/heron-$VERSION.xpi"
(cd "$WORK/extension" && zip -qr "$ROOT/dist/heron-$VERSION.xpi" . -x '.*')

# updates.json: the new version is appended to the history (one entry per version).
python3 - updates.json "$ID" "$VERSION" "$XPI_URL" "$MIN" <<'EOF'
import json, os, sys
path, addon_id, version, link, minimum = sys.argv[1:]
data = json.load(open(path)) if os.path.exists(path) else {"addons": {}}
updates = data["addons"].setdefault(addon_id, {"updates": []})["updates"]
updates[:] = [u for u in updates if u["version"] != version]
updates.append({"version": version, "update_link": link,
                "applications": {"gecko": {"strict_min_version": minimum}}})
open(path, "w").write(json.dumps(data, indent=2) + "\n")
EOF

echo "heron $VERSION ready:"
echo "  dist/heron-$VERSION.xpi      (GitHub, updates: $UPDATE_URL)"
echo "  dist/heron-$VERSION-atn.xpi  (addons.thunderbird.net)"
echo
echo "To publish on GitHub, once the packages are checked:"
echo "  git add -A && git commit -m \"heron $VERSION\" && git push"
echo "  gh release create v$VERSION dist/heron-$VERSION.xpi --repo $REPO --title \"heron $VERSION\" --notes-file CHANGELOG.md"
echo "(updates.json must be pushed to main: it is what announces the version to installed Thunderbirds.)"
