#!/bin/bash
# Independent loader replacement, recovery, and boot-key removal after rotation.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
evidence=${1:?completed trust-rotation evidence required}
test -f "$evidence/updates/6/fallback.log"
test ! -d "$evidence/loader-replacement"
bun_image=$(bash build-env/from.sh --ref IMAGE_BUN_1)
docker build --label ai-agent=true -t ai-agent/mos-firmware-lab \
    --build-arg "MOS_BUN_IMAGE=$bun_image" --build-arg MOS_LAB_IMAGE=ai-agent/mos-p2-lab \
    -f tests/file-ab-x64/Dockerfile.maintenance tests/file-ab-x64
maintain() {
    timeout -k 10 300 docker run --rm --privileged --label ai-agent=true --network traefik \
        -v "$PWD:/src:ro" -v "$evidence:/w" ai-agent/mos-firmware-lab \
        bash /src/tests/file-ab-x64/firmware-mounted.sh "$@"
}
boot() {
    timeout -k 10 350 docker run --rm --label ai-agent=true --network traefik \
        -v "$evidence:/w" -v "$PWD/tests/file-ab-x64:/harness:ro" ai-agent/mos-p2-lab \
        bash /harness/boot.sh "$1" writable "${3:-300}" x64 > "$2" 2>&1
}
maintain /w/image/disk.img /w/firmware-next /w/firmware/firmware.json /w/loader-replacement
boot image/disk.img "$evidence/loader-replaced.log"
grep -F FILE_AB_RUNTIME_PASS "$evidence/loader-replaced.log"
maintain /w/image/disk.img /w/loader-replacement /w/firmware-next/firmware.json /w/loader-restoration
boot image/disk.img "$evidence/loader-restored.log"
grep -F FILE_AB_RUNTIME_PASS "$evidence/loader-restored.log"
maintain /w/image/disk.img /w/firmware-next /w/firmware/firmware.json /w/loader-final
cp "$evidence/vars.fd" "$evidence/vars-overlap.fd"
docker run --rm --label ai-agent=true --network traefik -v "$evidence:/w" ai-agent/mos-p2-lab \
    virt-fw-vars --input /usr/share/OVMF/OVMF_VARS_4M.fd --output /w/vars.fd \
    --set-pk 6b62601e-3448-4418-8923-7c9fa22ab09b /w/db-next.cert.pem \
    --add-kek 6b62601e-3448-4418-8923-7c9fa22ab09b /w/db-next.cert.pem \
    --add-db 6b62601e-3448-4418-8923-7c9fa22ab09b /w/db-next.cert.pem --no-microsoft --sb
boot image/disk.img "$evidence/new-boot-key-only.log"
grep -F FILE_AB_RUNTIME_PASS "$evidence/new-boot-key-only.log"
cp --reflink=auto --sparse=always "$evidence/image/disk.img" "$evidence/image/old-loader.img"
maintain /w/image/old-loader.img /w/loader-replacement /w/firmware-next/firmware.json /w/removed-key-recovery
result=0
boot image/old-loader.img "$evidence/removed-boot-key.log" 60 || result=$?
test "$result" = 124
! grep -F 'mica-init:' "$evidence/removed-boot-key.log"
grep -Ei 'Security Violation|Access Denied|Image failed to load' "$evidence/removed-boot-key.log"
cp --reflink=auto --sparse=always "$evidence/image/disk.img" "$evidence/image/retained-key.img"
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$evidence/updates/5/inputs.json")
docker run --rm --label ai-agent=true --network traefik -v "$evidence:/w" ai-agent/mos-p2-lab \
    mren -i /w/image/retained-key.img@@1M "::/loader/entries/mos-$id.conf" "mos-$id+0-3.conf"
boot image/retained-key.img "$evidence/retained-boot-key.log"
grep -F FILE_AB_RUNTIME_PASS "$evidence/retained-boot-key.log"
python3 - "$evidence" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]); expected=json.loads((p/'updates/4/inputs.json').read_text())['id']
for line in (p/'retained-boot-key.log').read_text().splitlines():
    if '{"boot":' in line:
        receipt=json.loads(line[line.index('{"boot":'):])['boot']; break
else: raise AssertionError('missing retained boot receipt')
assert receipt['deploymentId']==expected and receipt['secureBoot']
print('UEFI_FIRMWARE_REPLACEMENT_RECOVERY_KEY_REMOVAL_PASS')
PY
