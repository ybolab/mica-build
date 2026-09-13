#!/bin/bash
# Compose a disposable acceptance root from the actual production root artifact.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
root_image=${1:?root image required}
kernel=${2:?BSP kernel directory required}
certificate=${3:?public content certificate required}
key=${4:?external content signing key required}
init=${5:?compiled mica-init required}
board=${6:?x64 or virt-arm64 required}
shutdown=${7:?compiled mica-shutdown required}
case "$board" in x64|virt-arm64) ;; *) echo 'unsupported acceptance board' >&2; exit 1;; esac
scratch=$(mktemp -d "$PWD/_out/file-runtime.XXXXXX")
evidence="$scratch/boot"
mkdir "$scratch/tree"
# mica-build-side: container-block -- extract the production root using its pinned tools.
docker run --rm --label ai-agent=true --network traefik -v "$scratch:/w" \
    -v "$root_image:/root.img:ro" ai-agent/mos-boot-tools-amd64 \
    unsquashfs -f -d /w/tree /root.img >/dev/null
# mica-build-side: host
install -m 0755 tests/file-ab-x64/runtime.sh "$scratch/tree/usr/lib/mica/test-file-runtime"
install -m 0644 tests/file-ab-x64/runtime.service "$scratch/tree/etc/systemd/system/test-file-runtime.service"
ln -s /etc/systemd/system/test-file-runtime.service "$scratch/tree/etc/systemd/system/multi-user.target.wants/test-file-runtime.service"
install -m 0644 tests/file-ab-x64/var-state.service "$scratch/tree/etc/systemd/system/test-var-state.service"
ln -s /etc/systemd/system/test-var-state.service "$scratch/tree/etc/systemd/system/sysinit.target.wants/test-var-state.service"
install -m 0644 "$certificate" "$scratch/content.cert.pem"
install -m 0600 "$key" "$scratch/content.key.pem"
bash tests/file-ab-x64/bun.sh tests/file-ab-x64/build.ts "$evidence" "$board" "$kernel" "$scratch/content.cert.pem" "$scratch/content.key.pem" "$init" "$scratch/tree" "$shutdown"
cat >"$scratch/extension.service" <<'UNIT'
[Unit]
Description=Persistent extension acceptance
Before=test-file-runtime.service
[Service]
Type=oneshot
ExecStart=/usr/bin/touch /run/mica/persistent-unit-ran
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
bash tests/file-ab-x64/bun.sh tools/qemu-seed-data.ts "$board" "$evidence/image/disk.img" \
    "$scratch/extension.service" /state/systemd-units/extension.service \
    --enable extension.service
truncate -s 4G "$evidence/image/disk.img"
cp --reflink=auto --sparse=always "$evidence/image/disk.img" "$evidence/image/factory-disk.img"
printf '%s\n' "$evidence"
