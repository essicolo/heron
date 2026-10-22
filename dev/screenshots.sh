#!/bin/zsh
# Builds the README screenshots in docs/screenshots/ from the demo profile (dev/demo-mail.py: Jessica Jones's inbox).
# Usage: dev/screenshots.sh [path to an English Thunderbird binary]
# The interface must be English: with a localized Thunderbird, folder names stay in its language, so pass an English build (default: /tmp/tb-en/Thunderbird.app, see README).

set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

export HERON_TB="${1:-/tmp/tb-en/Thunderbird.app/Contents/MacOS/thunderbird}"
OUT=docs/screenshots
mkdir -p "$OUT"
js() { python3 -I dev/shoot.py eval "$1"; }
shot() { python3 -I dev/shoot.py screenshot "$OUT/$1.png" 1440 900 >/dev/null; echo "  $OUT/$1.png"; }
select_subject() { js "const SUBJECT = '$1'; $(cat dev/demo-select.js)" >/dev/null; }

start() { # $1: 1 for dark mode, 0 for light mode
  HERON_DEMO=1 HERON_XPIS="/tmp/heron.xpi:heron@essia" HERON_PREFS="user_pref(\"ui.systemUsesDarkTheme\", $1);" dev/preview.sh start >/dev/null
  sleep 20
  js "$(cat dev/open-inbox.js)" >/dev/null
  js "$(cat dev/wait-index.js)" >/dev/null 2>&1 || true
}

dev/build-xpi.sh >/dev/null

echo "== Light mode"
start 0
select_subject "Team-up proposal"
shot inbox
select_subject "Rooftop"
shot conversation
select_subject "Spider-Man"
shot trackers
js "$(sed -e 's/ROW/6/' -e 's/DX/150/' dev/freeze-swipe.js)" >/dev/null
shot swipe
js 'await window.openPreferencesTab("paneGeneral"); await new Promise(r => setTimeout(r, 2500)); return 1;' >/dev/null
shot glance
js 'gTabmail.closeTab(gTabmail.currentTabInfo); await new Promise(r => setTimeout(r, 800)); return 1;' >/dev/null
js '
const bar = document.querySelector("global-search-bar");
const input = bar.shadowRoot.querySelector("input");
input.focus();
input.value = "from:matt";
input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: "from:matt", inputType: "insertText" }));
await new Promise(r => setTimeout(r, 1500));
gTabmail.currentAbout3Pane.threadTree.selectedIndex = 0;
await new Promise(r => setTimeout(r, 2500));
bar.shadowRoot.querySelector("#heron-filters").click();
await new Promise(r => setTimeout(r, 800));
return 1;' >/dev/null
shot search

echo "== Dark mode"
start 1
# Headless macOS draws the window's native background light even in dark mode (the real app is dark): paint it like the spaces toolbar.
js '
const color = getComputedStyle(document.getElementById("spacesToolbar")).backgroundColor;
const style = document.createElement("style");
style.textContent = `:root, unified-toolbar, #status-bar { background-color: ${color} !important; } #status-bar { opacity: 1 !important; }`;
document.documentElement.append(style);
return 1;' >/dev/null
select_subject "Group rates"
shot conversation-dark

dev/preview.sh stop >/dev/null
