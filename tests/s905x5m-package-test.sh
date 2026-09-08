#!/usr/bin/env bash
# Verify preflight failures and independent radio/component selections without a BSP build.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$PWD
work=$(mktemp -d "$repo/tmp/s905-package-test.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bsp/kernel" "$work/bsp/uboot" "$work/bsp/userland"
for f in Image modules.tar s7d_s905x5m_m100.dtb config kernel.release System.map; do
    printf fixture >"$work/bsp/kernel/$f"
done
for f in u-boot.bin.signed u-boot.bin.sd.bin.signed DDR.USB; do
    printf fixture >"$work/bsp/uboot/$f"
done
. boards/s905x5m/board.env
for f in $BOARD_USERLAND_FILES; do
    mkdir -p "$(dirname "$work/bsp/userland$f")"
    printf fixture >"$work/bsp/userland$f"
done
preflight() {
    MOS_DEB_PREFLIGHT=1 BSP_OUT="$work/bsp" bash boards/s905x5m/deb/board-s905x5m/render.sh
}
preflight >"$work/preflight"
grep -qx 'preflight-examined: 20' "$work/preflight"
grep -qx 'preflight-missing: 0' "$work/preflight"
rm "$work/bsp/kernel/config"
if preflight >"$work/preflight" 2>"$work/error"; then
    echo 'error: preflight accepted a BSP without the resolved config' >&2
    exit 1
fi
grep -qx 'preflight-missing: 1' "$work/preflight"
grep -F '/kernel/config' "$work/error" >/dev/null
resolve() {
    bash rootfs/packages/resolve.sh --board s905x5m --profile dev --radios 'wifi bluetooth' "$@"
}
resolve --without bluetooth >"$work/packages"
grep -qx mos-s905x5m-radio "$work/packages"
grep -qx mos-wifi "$work/packages"
! grep -qx mos-s905x5m-bluetooth "$work/packages"
resolve --without wifi >"$work/packages"
grep -qx mos-s905x5m-radio "$work/packages"
grep -qx mos-s905x5m-bluetooth "$work/packages"
! grep -qx mos-wifi "$work/packages"
resolve --without 'wifi bluetooth' >"$work/packages"
! grep -q '^mos-s905x5m-' "$work/packages"
! grep -q '^mos-mqtt-reference$\|^mos-bm201-front-panel$' "$work/packages"
resolve --without '' --components 'mqtt-reference bm201-front-panel' >"$work/packages"
grep -qx mos-mqtt-reference "$work/packages"
grep -qx mos-bm201-front-panel "$work/packages"
if resolve --without mqtt --components mqtt-reference >"$work/packages" 2>"$work/error"; then
    echo 'error: MQTT reference resolved without its broker/bridge' >&2; exit 1
fi
grep -F 'mqtt-reference requires selected' "$work/error" >/dev/null
if bash rootfs/packages/resolve.sh --board s905x5m --profile prod --radios '' --without '' \
    --components mqtt-reference >"$work/packages" 2>"$work/error"; then
    echo 'error: production MQTT reference was accepted' >&2; exit 1
fi
grep -F 'forbidden in production' "$work/error" >/dev/null
if bash rootfs/packages/resolve.sh --board x64 --profile dev --radios '' --without '' \
    --components bm201-front-panel >"$work/packages" 2>"$work/error"; then
    echo 'error: BM201 panel was selected for x64' >&2; exit 1
fi
grep -F 'unavailable for board' "$work/error" >/dev/null
printf '%s\n' 'PASS: s905x5m preflight, independent radio declines and optional component constraints'
