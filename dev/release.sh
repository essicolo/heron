#!/bin/zsh
# Prepares a heron release (the version in extension/manifest.json).
#   1. builds dist/heron-<version>.xpi reproducibly (dev/pack.py), with the update_url of the GitHub repository;
#   2. adds the version and the package's SHA-256 to updates.json (read by installed copies through update_url).
# Then commit and push to main, and push the tag: the release workflow (.github/workflows/release.yml) rebuilds the same package from the tagged source, checks that its SHA-256 is the one in updates.json, attests it and publishes the release.
#
# Usage: dev/release.sh <owner/repo>   e.g. dev/release.sh essicolo/heron
# Publishes nothing itself.

set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

REPO="${1:?Usage: dev/release.sh <owner/repo>}"
VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
ID=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['browser_specific_settings']['gecko']['id'])")
MIN=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['browser_specific_settings']['gecko']['strict_min_version'])")
UPDATE_URL="https://raw.githubusercontent.com/$REPO/main/updates.json"
XPI_URL="https://github.com/$REPO/releases/download/v$VERSION/heron-$VERSION.xpi"

grep -q "^## $VERSION$" CHANGELOG.md || { echo "CHANGELOG.md has no '## $VERSION' section (it becomes the release notes)."; exit 1; }

mkdir -p dist
python3 -I dev/pack.py "dist/heron-$VERSION.xpi" --update-url "$UPDATE_URL" >/dev/null
HASH="sha256:$(shasum -a 256 "dist/heron-$VERSION.xpi" | cut -d' ' -f1)" # Thunderbird refuses a downloaded file that doesn't match

# updates.json: the new version is appended to the history (one entry per version).
python3 - updates.json "$ID" "$VERSION" "$XPI_URL" "$MIN" "$HASH" <<'EOF'
import json, os, sys
path, addon_id, version, link, minimum, digest = sys.argv[1:]
data = json.load(open(path)) if os.path.exists(path) else {"addons": {}}
updates = data["addons"].setdefault(addon_id, {"updates": []})["updates"]
updates[:] = [u for u in updates if u["version"] != version]
updates.append({"version": version, "update_link": link, "update_hash": digest,
                "applications": {"gecko": {"strict_min_version": minimum}}})
open(path, "w").write(json.dumps(data, indent=2) + "\n")
EOF

echo "heron $VERSION ready: dist/heron-$VERSION.xpi ($HASH)"
echo
echo "To publish:"
echo "  git add -A && git commit -m \"heron $VERSION\" && git push"
echo "  git tag v$VERSION && git push origin v$VERSION"
echo "The release workflow then rebuilds the package, checks it against updates.json, attests it and publishes the release."
