#!/usr/bin/env bash
# Deterministic lifecycle/descriptor and compile-only ABI fixtures; no devices or guest.
set -euo pipefail
for tool in docker timeout bash dirname mkdir uname; do command -v "$tool" >/dev/null; done
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
case "$(uname -m)" in x86_64) ;; *) echo 'This fixture runner requires the pinned amd64 build container' >&2; exit 1;; esac
IMAGE=$(bash "$REPO/build-env/from.sh" --arch=amd64 --ref LOCAL_MOS_BUILD_RUST_CHECK)
HOST_REPO=$REPO
case "$REPO" in /root/*) HOST_REPO="/srv/station/root/${REPO#/root/}";; /work/*) HOST_REPO="/srv/station/work/${REPO#/work/}";; esac
docker image inspect --format '{{.Id}}' "$IMAGE"
CACHE="$REPO/_out/b3-rust"
mkdir -p "$CACHE/target" "$CACHE/registry" "$CACHE/git"
# /srv paths map identically; /root and /work are translated above for siblings.
# mos-build-side: container-block -- pinned native and UAPI fixture toolchain.
timeout 110 docker run --rm --label ai-agent=true --network traefik \
    --name "ai-agent-mos-boot-shutdown-$$" \
    -v "$HOST_REPO:/src:ro" -v "$HOST_REPO/_out/b3-rust/target:/target" \
    -v "$HOST_REPO/_out/b3-rust/registry:/usr/local/cargo/registry" \
    -v "$HOST_REPO/_out/b3-rust/git:/usr/local/cargo/git" \
    -e CARGO_TARGET_DIR=/target -w /src/pkgs/mos-deploy --entrypoint /bin/bash "$IMAGE" -c '
set -euo pipefail
for tool in cargo gcc aarch64-linux-gnu-gcc; do command -v "$tool" >/dev/null; done
cargo test --locked --offline --lib boot::shutdown::tests
cargo test --locked --offline --test shutdown --test exitrd --test startup --test boot
cargo test --locked --offline -p lifecycle-sys
for compiler in gcc aarch64-linux-gnu-gcc; do
    "$compiler" -std=c11 -Wall -Werror -c /src/tests/boot-shutdown/uapi.c -o "/target/b3-uapi-$compiler.o"
    "$compiler" -dumpfullversion
done
dpkg-query -W "linux-libc-dev*"
sha256sum /usr/include/linux/loop.h /usr/include/linux/watchdog.h /usr/include/asm-generic/ioctl.h \
    /usr/aarch64-linux-gnu/include/linux/loop.h /usr/aarch64-linux-gnu/include/linux/watchdog.h \
    /usr/aarch64-linux-gnu/include/asm-generic/ioctl.h
printf "%s\n" BOOT_SHUTDOWN_FIXTURES_PASS
'
# mos-build-side: host
