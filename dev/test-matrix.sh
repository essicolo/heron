#!/bin/zsh
# Decoupling matrix: each module ALONE, then each module REMOVED, plus "everything on".
# For each configuration: each module's effects must be present if and only if the module is active (dev/test-modules.js). For "alone", the module's functional test also runs.
# Usage: dev/test-matrix.sh [module...]   (no argument: all modules)
# Duration: about one minute per configuration. Throwaway profile, never the real profile.

set -uo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

MODULES=(theme list threads conversation swipe search glance foldQuotes trackers undoSend compose unifiedFolders)
TARGETS=(${@:-$MODULES})

dev/build-xpi.sh >/dev/null
js() { python3 -I dev/shoot.py eval "$1"; }

# Module configuration (JSON): all set to $1, except $2 set to the opposite.
modules_json() {
  python3 -c "
import json, sys
mods, default, flip = sys.argv[1].split(), sys.argv[2] == 'on', sys.argv[3]
print(json.dumps({m: (not default) if m == flip else default for m in mods}))" "$MODULES" "$1" "$2"
}

run_config() { # name, modules json, functional test (optional)
  local name="$1" modules="$2" functional="${3:-}"
  HERON_XPIS="/tmp/heron.xpi:heron@essia" HERON_PREFS='user_pref("heron.unifiedFolders.force", true);' \
    dev/preview.sh start >/dev/null
  sleep 15
  js "$(sed "s/CONFIG/{\"modules\":$modules}/" dev/set-config.js)" >/dev/null
  dev/preview.sh restart
  sleep 15
  js "$(cat dev/open-inbox.js)" >/dev/null
  js "$(cat dev/wait-index.js)" >/dev/null
  local result
  result=$(js "$(cat dev/test-modules.js)")
  python3 - "$name" "$modules" "$result" <<'EOF'
import json, sys
name, modules, result = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
expected = dict(modules)
expected["undoSendCompose"] = modules["undoSend"]
wrong = [f"{m}: expected {'present' if e else 'absent'}" for m, e in expected.items() if result["out"].get(m) != e]
if result["failed"]:
    wrong.append(f"failed modules: {result['failed']}")
print(f"  {name:28} {'OK' if not wrong else 'FAILED: ' + '; '.join(wrong)}")
for m, e in result["errors"].items():
    if expected.get(m):
        print(f"      error {m}: {e}")
EOF
  if [[ -n "$functional" ]]; then
    eval "$functional"
  fi
  grep -i 'heron' /tmp/heron-test.log | grep -i 'error\|impossible\|fail' | sort -u | head -3 | sed 's/^/      /'
}

functional_for() { # functional test when the module is alone
  case "$1" in
    search) echo 'js "$(cat dev/test-search.js)" | python3 -c "import json,sys; d=json.load(sys.stdin); k=[x for x,v in d.items() if v.get(\"ok\") is False]; print(\"      functional:\", \"OK\" if not k else \"FAILED \"+str(k))"' ;;
    swipe) echo 'js "$(cat dev/test-swipe-physics.js)" | python3 -c "import json,sys; d=json.load(sys.stdin); ok=(not d[\"slowBelowThreshold\"] and d[\"slowPastThreshold\"] and d[\"fastAndShort\"] and not d[\"pastThenBack\"] and d[\"labelArmed\"] and d[\"icon\"] and d[\"reflowsDuringGesture\"]==0); print(\"      functional:\", \"OK\" if ok else \"FAILED \"+str(d))"' ;;
    undoSend) echo 'rm -rf /tmp/heron-smtp; python3 -I dev/smtp-sink.py 2525 /tmp/heron-smtp >/dev/null 2>&1 & SINK=$!; js "$(cat dev/test-undo-send.js)" | python3 -c "import json,sys; d=json.load(sys.stdin); ok=d[\"afterDelay\"][\"received\"]==1 and d[\"nothingSent\"][\"received\"]==1 and d[\"undone\"][\"windowReopened\"]; print(\"      functional:\", \"OK\" if ok else \"FAILED \"+str(d))"; kill $SINK 2>/dev/null' ;;
  esac
}

echo "== Everything on"
run_config "all" "$(modules_json on none)"

echo "== Each module alone"
for m in $TARGETS; do
  run_config "alone: $m" "$(modules_json off $m)" "$(functional_for $m)"
done

echo "== Each module removed"
for m in $TARGETS; do
  run_config "without: $m" "$(modules_json on $m)"
done

dev/preview.sh stop
pkill -f dev/smtp-sink.py 2>/dev/null || true
