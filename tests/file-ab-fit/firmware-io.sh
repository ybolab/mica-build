#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
command -v docker >/dev/null
work=$(mktemp -d "$PWD/_out/fit-firmware-io.XXXXXX")
image=$(bash build-env/from.sh --arch=amd64 --ref LOCAL_MOS_BUILD_C)
# The empty headers isolate hardware declarations; the complete production C
# policy is included unchanged and called through its normal entry point.
# mos-build-side: container-block -- the pinned C compiler builds and runs the firmware policy.
docker run --rm --label ai-agent=true --network traefik -v "$PWD:/src:ro" -v "$work:/out" \
    --entrypoint /bin/bash "$image" -ceu '
    mkdir -p /out/include/asm /out/include/u-boot
    for header in blk bootm button command console dm env fs hang image malloc memalign mmc part wdt asm/unaligned u-boot/crc; do
        touch /out/include/$header.h
    done
    gcc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
        -I/out/include /src/tests/file-ab-fit/firmware-io.c -o /out/firmware-io
    timeout 20 /out/firmware-io
'
# mos-build-side: host
