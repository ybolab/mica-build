#!/bin/bash
# Prove watchdog reset before SYSTEM is opened and systemd is started.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
source=$(realpath "${1:?current full-runtime evidence required}")
board=${2:?board required}
init=$(realpath "${3:?fault-injected init required}")
cert=$(realpath "${4:?content certificate required}")
key=$(realpath "${5:?content key required}")
case "$board" in x64|virt-arm64) ;; *) exit 1;; esac
work=$(mktemp -d "$PWD/_out/early-hang.XXXXXX")
out="$work/boot"
mkdir -p "$out/image" "$work/tree"
cp --reflink=auto --sparse=always "$source/image/factory-disk.img" "$out/image/disk.img"
for file in root kernel firmware metadata.key.pem metadata.pub db.key.pem db.cert.pem; do
    cp -a "$source/$file" "$out/$file"
done
printf 'Evidence: %s\n' "$work"
timeout -k 20 700 bun tests/file-ab-x64/update.ts "$out" "$cert" "$key" 7 kernel "$out/root" "$out/kernel" "$init"
timeout -k 15 450 docker run --rm --label ai-agent=true --network traefik \
    -v "$out:/w" -v "$PWD/tests/file-ab-x64:/harness:ro" ai-agent/mos-p2-lab \
    bash /harness/boot.sh image/disk.img writable 400 "$board" > "$out/install.log" 2>&1
grep -F FILE_AB_INSTALL_PASS "$out/install.log"
grep -F FILE_AB_RUNTIME_PASS "$out/install.log"
bash tests/file-ab-x64/shutdown-check.sh "$out/install.log"
bad=$(cat "$out/offline/expected-id")
mv "$out/offline" "$out/updates/7/installed-media"
python3 - "$out/boot.sh" <<'PY'
from pathlib import Path
import sys
s=Path('tests/file-ab-x64/boot.sh').read_text()
assert s.count('-nographic -no-reboot')==1
Path(sys.argv[1]).write_text(s.replace('-nographic -no-reboot', '-qmp unix:/w/boot-events.sock,server=on,wait=off -nographic -no-reboot'))
PY
for attempt in 1 2 3; do
    timeout -k 15 450 docker run --rm --label ai-agent=true --network traefik \
        -v "$out:/w" -v "$PWD/tests/file-ab-x64:/harness:ro" ai-agent/mos-p2-lab \
        python3 /harness/qmp-boot.py "/w/events-$attempt.jsonl" bash /w/boot.sh image/disk.img writable 400 "$board" > "$out/attempt-$attempt.log" 2>&1
    grep -F 'FILE_AB_EARLY_HANG_TRIGGER: before SYSTEM and systemd' "$out/attempt-$attempt.log"
    ! grep -F 'mos-init: verified deployment' "$out/attempt-$attempt.log"
    ! grep -F 'systemd[1]:' "$out/attempt-$attempt.log"
    python3 - "$out/events-$attempt.jsonl" <<'PY'
from pathlib import Path
import json,sys
events=[json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
assert any(e.get('event')=='WATCHDOG' and e['data']['action']=='reset' for e in events), events
assert any(e.get('event')=='SHUTDOWN' for e in events), events
PY
    docker run --rm --label ai-agent=true --network traefik -v "$out:/w:ro" ai-agent/mos-p2-lab \
        mdir -i /w/image/disk.img@@1M -b ::/loader/entries > "$out/entries-$attempt.txt"
    grep -F "mos-$bad+$((3-attempt))-$attempt.conf" "$out/entries-$attempt.txt"
done
timeout -k 15 450 docker run --rm --label ai-agent=true --network traefik \
    -v "$out:/w" -v "$PWD/tests/file-ab-x64:/harness:ro" ai-agent/mos-p2-lab \
    bash /harness/boot.sh image/disk.img writable 400 "$board" > "$out/fallback.log" 2>&1
grep -F FILE_AB_RUNTIME_PASS "$out/fallback.log"
! grep -F "mos-init: verified deployment $bad;" "$out/fallback.log"
bash tests/file-ab-x64/shutdown-check.sh "$out/fallback.log"
echo "FILE_AB_EARLY_HANG_FALLBACK_PASS: $board"
