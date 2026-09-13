#!/bin/bash
# mica-build-side: container -- a corrupt confirmed deployment must not loop forever.
set -euo pipefail
cd /w
board=${1:?board required}
cp --reflink=auto --sparse=always image/factory-disk.img failed-confirmed.img
cp --reflink=auto --sparse=always image/system.img damaged-system.img
python3 - <<'PY'
import base64,json,pathlib
records=json.loads(pathlib.Path('deployments.json').read_text())
current=records[1]; envelope=json.loads(current['envelope'])
signature=bytearray(base64.b64decode(envelope['signature'])); signature[0]^=1
envelope['signature']=base64.b64encode(signature).decode()
pathlib.Path('invalid.json').write_text(json.dumps(envelope,separators=(',',':')))
pathlib.Path('damage.commands').write_text(f"rm /deployments/{current['id']}.json\nwrite /w/invalid.json /deployments/{current['id']}.json\n")
pathlib.Path('current-id').write_text(current['id'])
pathlib.Path('fallback-id').write_text(records[0]['id'])
PY
debugfs -w -f damage.commands damaged-system.img > damage.log 2>&1
dd if=damaged-system.img of=failed-confirmed.img bs=1M seek=513 conv=notrunc,sparse status=none
mren -i failed-confirmed.img@@1M "::/loader/entries/mos-$(cat current-id)+3.conf" "mos-$(cat current-id).conf"
bash /lab/boot.sh failed-confirmed.img writable 60 "$board" > refused.log 2>&1
grep -q 'metadata signature rejected' refused.log
mdir -i failed-confirmed.img@@1M -b ::/loader/entries > after-refusal.txt
grep -q "mos-$(cat current-id)+0-3.conf" after-refusal.txt
bash /lab/boot.sh failed-confirmed.img writable 300 "$board" > fallback.log 2>&1
grep -q FILE_AB_RUNTIME_PASS fallback.log
grep -q "\"deploymentId\":\"$(cat fallback-id)\"" fallback.log
echo 'FILE_AB_CONFIRMED_CORRUPTION_FALLBACK_PASS'
