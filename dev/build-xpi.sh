#!/bin/zsh
# Packages extension/ into /tmp/heron.xpi
set -euo pipefail
ROOT="${0:A:h:h}"
rm -f /tmp/heron.xpi
(cd "$ROOT/extension" && zip -qr /tmp/heron.xpi . -x '.*')
echo /tmp/heron.xpi
