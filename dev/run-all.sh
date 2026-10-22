#!/bin/zsh
# Reruns every automated test, each on a fresh test Thunderbird, and prints a summary.
# Usage: dev/run-all.sh
# Never touches the real profile (throwaway profile in /tmp, macOS address book disabled).

set -uo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

dev/build-xpi.sh >/dev/null
PREFS=""
start() {
  HERON_XPIS="/tmp/heron.xpi:heron@essia" HERON_PREFS="$PREFS" dev/preview.sh start >/dev/null
  sleep 15
  python3 -I dev/shoot.py eval "$(cat dev/open-inbox.js)" >/dev/null
}
js() { python3 -I dev/shoot.py eval "$1"; }
errors() { grep -i 'heron' /tmp/heron-test.log | grep -i 'error\|impossible' | head -5; }

echo "== Search (dev/test-search.js)"
start
js "$(cat dev/wait-index.js)" >/dev/null
js "$(cat dev/test-search.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = sum(1 for v in d.values() if v.get('ok') is True)
ko = [k for k, v in d.items() if v.get('ok') is False]
print(f'  {ok} OK, {len(ko)} failed', *(f'\n  FAILED {k}' for k in ko))"
errors

echo "== Suggestions (dev/test-suggest.js)"
start
js "$(cat dev/test-suggest.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = d['fieldAfterChoice'].startswith(('de:lef', 'from:lef')) and d['suggestionsClosed'] and not d['thunderbirdMenuOpen'] and d['tabs'] == 1
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Swipe (dev/measure-swipe.js)"
start
js "$(cat dev/measure-swipe.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = d['messagesLoadedByAction'] == 0 and d['toast'] and d['selectionBefore'] == d['selectionAfter']
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Swipe physics (dev/test-swipe-physics.js)"
start
python3 -I dev/shoot.py screenshot /tmp/heron-run-all.png 1680 1000 >/dev/null
js "$(cat dev/test-swipe-physics.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = (not d['slowBelowThreshold'] and d['slowPastThreshold'] and d['fastAndShort'] and not d['pastThenBack']
      and d['elastic']['card'] < d['elastic']['fingers'] and d['labelArmed'] and d['icon']
      and d['reflowsDuringGesture'] == 0)
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Conversation"
start
js "$(cat dev/wait-index.js)" >/dev/null
js "$(cat dev/open-thread.js)" >/dev/null
sleep 4
js '
const v = window.gTabmail.currentAbout3Pane.document.getElementById("heron-conversation");
const cards = [...v.querySelectorAll(".heron-msg")];
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = () => cards.filter(c => c.getAttribute("aria-expanded") == "true").length;
const before = open();
cards[0].querySelector(".heron-head").click(); await wait(300);
const afterClose = open();
cards[0].querySelector(".heron-head").click(); await wait(1500);
return { visible: !v.hidden, cards: cards.length, open: before, afterCollapse: afterClose, afterReopen: open() };
' | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = d['visible'] and d['cards'] == 5 and d['afterCollapse'] == d['open'] - 1 and d['afterReopen'] == d['open']
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Calendar, tasks, contacts (dev/test-spaces.js)"
start
js "$(cat dev/test-spaces.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = (not d['calendarOpen']['listVisible'] and d['calendarSearch']['results'] == 1
      and not d['calendarEmpty']['listVisible'] and d['tasks']['searchNoResults'] == 0
      and d['contacts']['search'] == 1 and d['backToMail']['field'] == '')
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Stacked cards (Settings, Escape)"
start
js 'await window.openPreferencesTab("paneGeneral"); await new Promise(r => setTimeout(r, 2500)); return document.documentElement.getAttribute("heron-glance");' >/dev/null
python3 -I dev/shoot.py key escape >/dev/null
sleep 1
js 'return { glance: document.documentElement.getAttribute("heron-glance"), tabs: window.gTabmail.tabInfo.length, bar: document.getElementById("tabs-toolbar").getBoundingClientRect().height };' | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = d['glance'] is None and d['tabs'] == 1 and d['bar'] == 0
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Compose"
start
js "$(sed 's/FORMAT/Default/' dev/open-compose.js)" >/dev/null
js "$(cat dev/compose-state.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = d['order'][:3] == ['button-send', 'button-attach', 'heron-format-toggle'] and not d['formatToolbarVisible']
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Undo send (dev/test-undo-send.js, fake SMTP server)"
rm -rf /tmp/heron-smtp
python3 -I dev/smtp-sink.py 2525 /tmp/heron-smtp >/dev/null 2>&1 &
SINK=$!
start
js "$(cat dev/test-undo-send.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = (d['pending']['outbox'] == 1 and d['pending']['received'] == 0 and d['afterDelay']['received'] == 1
      and d['undone']['windowReopened'] and d['undone']['outbox'] == 0 and d['nothingSent']['received'] == 1)
print('  OK' if ok else f'  FAILED {d}')"
errors
kill $SINK 2>/dev/null

echo "== Trackers"
start
js '
const a = window.gTabmail.currentAbout3Pane;
let idx = -1; for (let i = 0; i < a.gDBView.rowCount; i++) if (a.gDBView.getMsgHdrAt(i).mime2DecodedSubject.includes("infolettre")) idx = i;
a.threadTree.selectedIndex = idx; await new Promise(r => setTimeout(r, 3500));
return a.document.getElementById("messageBrowser").contentDocument.getElementById("heron-trackers")?.textContent ?? null;' | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('  OK' if d and '2' in d else f'  FAILED {d}')"
errors

echo "== Teardown (dev/test-teardown.js: disable, re-enable, live modules)"
start
js "$(cat dev/wait-index.js)" >/dev/null
js "$(cat dev/open-thread.js)" >/dev/null
js "$(cat dev/test-teardown.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
on = lambda p: p['conversation'] and p['domains'] and p['filters'] and p['density'] == 2
off = d['modulesOff']
ok = (on(d['before']) and not d['disabled']['leftovers'] and d['disabled']['density'] != 2
      and d['disabled']['thunderbirdView'] and on(d['reenabled']) and on(d['modulesBackOn'])
      and not (off['conversation'] or off['domains'] or off['filters']))
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Pending send when heron is disabled (dev/test-undo-send-disable.js)"
rm -rf /tmp/heron-smtp
python3 -I dev/smtp-sink.py 2525 /tmp/heron-smtp >/dev/null 2>&1 &
SINK=$!
start
js "$(cat dev/test-undo-send-disable.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ok = d['pending']['received'] == 0 and d['afterDisable']['received'] == 1 and d['afterDisable']['outbox'] == 0
print('  OK' if ok else f'  FAILED {d}')"
errors
kill $SINK 2>/dev/null

echo "== Settings kept when removing heron (dev/test-keep.js)"
PREFS='user_pref("heron.unifiedFolders.force", true);'
start
js "$(cat dev/test-keep.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
k = d['removedKeeping']
ok = (d['active']['density'] == 2 and d['active']['unified'] and k['density'] == 2 and k['unified']
      and k['fontSize'] == 0 and not k['nameOnly'])
print('  OK' if ok else f'  FAILED {d}')"
errors
PREFS=""

echo "== Quoted text, 10 real formats (dev/test-quotes.js, dev/fixtures/quotes)"
start
js "$(cat dev/test-quotes.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ko = {k: v for k, v in d.items() if not v['ok']}
print(f'  {len(d) - len(ko)} OK, {len(ko)} failed', *(f'\n  FAILED {k} {v}' for k, v in ko.items()))"
errors

echo "== Collapsible recipients (dev/test-recipients.js)"
start
js "$(cat dev/test-recipients.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
l, c = d['reading'], d.get('card')
ok = (l['start']['more'] and l['expanded']['lessVisible'] and l['expanded']['shown'] > l['start']['shown']
      and l['collapsed'] == l['start'] and l['nextMessage']['more'] and not l['nextMessage']['less']
      and c and c['expanded']['height'] > c['start']['height'] and c['collapsed']['height'] == c['start']['height'])
print('  OK' if ok else f'  FAILED {d}')"
errors

echo "== Native swipe tracking: holds during a pause (dev/test-swipe-native.js)"
start
js "$(cat dev/test-swipe-native.js)" | python3 -c "
import json, sys
d = json.load(sys.stdin)
s, c = d['pauseThenSuccess'], d['pauseThenCancel']
ok = (s['heldDuringPause']['before'] > 50 and s['heldDuringPause']['after'] == s['heldDuringPause']['before'] and s['acted']
      and c['heldDuringPause']['after'] == c['heldDuringPause']['before'] and not c['acted'] and c['afterRelease'] == 0
      and d['systemFirst']['heldDuringPause']['after'] == d['systemFirst']['heldDuringPause']['before'] > 50 and d['systemFirst']['acted']
      and not d['systemGivesUp']['stuck'] and d['armedWithoutSystemSuccess']['acted'])
print('  OK' if ok else f'  FAILED {d}')"
errors

dev/preview.sh stop
