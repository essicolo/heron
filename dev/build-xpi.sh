#!/bin/zsh
# Packages extension/ into /tmp/heron.xpi (reproducibly, see dev/pack.py), for the test bench.
set -euo pipefail
ROOT="${0:A:h:h}"
python3 -I "$ROOT/dev/pack.py" /tmp/heron.xpi >/dev/null
echo /tmp/heron.xpi
