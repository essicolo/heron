#!/bin/zsh
# Starts a headless Thunderbird on a fresh test profile, ready for dev/shoot.py.
# Usage: dev/preview.sh start | restart | stop

set -euo pipefail

ROOT="${0:A:h:h}"
PROFILE=/tmp/heron-test-profile
PIDFILE=/tmp/heron-test.pid
TB="${HERON_TB:-/Applications/Thunderbird.app/Contents/MacOS/thunderbird}" # HERON_TB: another Thunderbird, e.g. an English build for screenshots

case "${1:-start}" in
  start)
    if [[ -f $PIDFILE ]]; then kill "$(cat $PIDFILE)" 2>/dev/null && sleep 2 || true; fi
    # Any other instance on this profile (left over by an earlier run) would keep the Marionette port and answer instead.
    pkill -f "thunderbird.*$PROFILE" 2>/dev/null && sleep 2 || true
    "$ROOT/dev/make-test-profile.sh" "$PROFILE" >/dev/null
    MOZ_HEADLESS=1 "$TB" --headless --marionette -remote-allow-system-access --no-remote --profile "$PROFILE" \
      >/tmp/heron-test.log 2>&1 &
    echo $! > $PIDFILE
    echo "Test Thunderbird started (pid $(cat $PIDFILE))"
    ;;
  restart)
    # Same profile (keeps the settings and the extension), new process. Quit cleanly (like the user would), so Thunderbird saves its state (folder pane, etc.).
    python3 -I "$ROOT/dev/shoot.py" eval 'setTimeout(() => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit), 100); return 1;' >/dev/null 2>&1 || true
    if [[ -f $PIDFILE ]]; then
      for i in {1..30}; do kill -0 "$(cat $PIDFILE)" 2>/dev/null || break; sleep 0.5; done
      kill "$(cat $PIDFILE)" 2>/dev/null || true
    fi
    sleep 1
    rm -f "$PROFILE/parent.lock" "$PROFILE/.parentlock" "$PROFILE/lock"
    MOZ_HEADLESS=1 "$TB" --headless --marionette -remote-allow-system-access --no-remote --profile "$PROFILE" \
      >>/tmp/heron-test.log 2>&1 &
    echo $! > $PIDFILE
    ;;
  stop)
    if [[ -f $PIDFILE ]]; then kill "$(cat $PIDFILE)" 2>/dev/null || true; fi
    pkill -f "thunderbird.*$PROFILE" 2>/dev/null || true
    rm -f $PIDFILE
    ;;
esac
