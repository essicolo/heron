#!/bin/zsh
# Prepares heron for stable Thunderbird:
#  1. builds the extension into dist/heron.xpi (theme, settings and features: everything is in it);
#  2. removes the old Zenbird theme (the previous name), now useless, from the profile (chrome/userChrome.css, user.js).
# Then: Thunderbird > Add-ons and Themes > gear > Install Add-on From File...
# Uninstall: add-ons manager > heron > Remove (Thunderbird gets its settings back).

set -euo pipefail

ROOT="${0:A:h}"
TB_DIR="$HOME/Library/Thunderbird"

mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/heron.xpi"
(cd "$ROOT/extension" && zip -qr "$ROOT/dist/heron.xpi" . -x '.*')
echo "Extension ready: $ROOT/dist/heron.xpi"

# Profile tied to /Applications/Thunderbird.app ("Install..." section of profiles.ini).
PROFILE_REL=$(awk -F= '/^\[Install/{inst=1; next} /^\[/{inst=0} inst && $1=="Default"{print $2}' "$TB_DIR/profiles.ini" 2>/dev/null \
  | grep -m1 'default-release' || true)
if [[ -n "$PROFILE_REL" ]]; then
  for f in "$TB_DIR/$PROFILE_REL/chrome/userChrome.css" "$TB_DIR/$PROFILE_REL/user.js"; do
    if [[ -f "$f" ]] && grep -qi zenbird "$f"; then
      rm "$f"
      echo "Old theme removed: $f"
    fi
  done
fi

echo
echo "Next: Thunderbird > Add-ons and Themes > gear > Install Add-on From File..."
echo "then pick dist/heron.xpi and restart Thunderbird."
