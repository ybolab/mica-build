#!/usr/bin/env bash
# Check the package lock and minimal-first selection before any Docker build.
set -euo pipefail
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [ "${MOS_DEBIAN_TEST_INNER:-0}" != 1 ]; then
    command -v docker >/dev/null
    IMAGE=$(bash "$REPO_ROOT/build-env/from.sh" --ref IMAGE_BUN_1)
    case "$REPO_ROOT" in
    /work/*) HOST_PROJECT=/srv/station/work/${REPO_ROOT#/work/} ;;
    /root/*) HOST_PROJECT=/srv/station/root/${REPO_ROOT#/root/} ;;
    *) HOST_PROJECT=$REPO_ROOT ;;
    esac
    exec docker run --rm --label ai-agent=true --network none \
        -v "$HOST_PROJECT/rootfs/debian:/mos/rootfs/debian:ro" \
        -v "$HOST_PROJECT/tests:/mos/tests:ro" \
        -v "$HOST_PROJECT/rootfs/packages:/mos/rootfs/packages:ro" \
        -e MOS_DEBIAN_TEST_INNER=1 "$IMAGE" bash /mos/tests/debian-lock-test.sh
fi
ENTRY=$REPO_ROOT/rootfs/debian/run.sh
mkdir -p "$REPO_ROOT/tmp"
WORK=$(mktemp -d "$REPO_ROOT/tmp/debian-lock-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
for arch in amd64 arm64; do
    bash "$ENTRY" select --arch "$arch" >"$WORK/base"
    test "$(wc -l <"$WORK/base")" -gt 0
    test "$(wc -l <"$WORK/base")" -lt 100
    if cut -f1 "$WORK/base" | grep -Ex 'apt|openssh-server|bluez|systemd|curl'; then
        echo 'FAIL: optional runtime package reached the minimal base' >&2
        exit 1
    fi
    printf 'mos-system\n' >"$WORK/system.pkgs"
    bash "$ENTRY" select --arch "$arch" --packages "$WORK/system.pkgs" >"$WORK/system"
    test "$(wc -l <"$WORK/system")" -gt "$(wc -l <"$WORK/base")"
    grep -q $'^openssh-server\t' "$WORK/system"
    if grep -q $'^bluez\t' "$WORK/system"; then exit 1; fi
    printf 'mos-system\nmos-bluetooth\n' >"$WORK/radio.pkgs"
    bash "$ENTRY" select --arch "$arch" --packages "$WORK/radio.pkgs" >"$WORK/radio"
    grep -q $'^bluez\t' "$WORK/radio"
    bash "$ENTRY" select --arch "$arch" --packages "$REPO_ROOT/rootfs/packages/common.pkgs" >"$WORK/common"
    if grep -q $'^ca-certificates\t' "$WORK/common"; then
        echo 'FAIL: upstream certificates conflict with the mos-ca-trust payload' >&2
        exit 1
    fi
done
echo 'RESULT: PASS (minimal base and additive system/radio selection on both architectures)'
