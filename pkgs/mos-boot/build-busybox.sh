#!/usr/bin/env bash
# mos-build-side: container -- build one pinned static early-boot BusyBox payload.
set -euo pipefail

[ "$#" -ge 4 ] || {
    echo 'usage: build-busybox.sh SOURCE OUTPUT {x64|aa64} CROSS_PREFIX [RUNNER ...]' >&2
    exit 64
}
SOURCE=$1
OUTPUT=$2
EFI_ARCH=$3
CROSS_PREFIX=$4
shift 4
RUNNER=("$@")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${HERE}/busybox.config"
REQUIRED="${HERE}/busybox.required-applets"
CHECK="${HERE}/check-busybox.sh"
SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-1577836800}
BUSYBOX_BUILD_JOBS=${BUSYBOX_BUILD_JOBS:-2}

[ -d "${SOURCE}" ] || { echo "error: BusyBox source directory is missing: ${SOURCE}" >&2; exit 1; }
[ -f "${SOURCE}/Makefile" ] || { echo "error: BusyBox source has no Makefile: ${SOURCE}" >&2; exit 1; }
[ -f "${SOURCE}/LICENSE" ] || { echo "error: BusyBox source has no LICENSE: ${SOURCE}" >&2; exit 1; }
[[ "${BUSYBOX_BUILD_JOBS}" =~ ^[1-9][0-9]*$ ]] || { echo 'error: BUSYBOX_BUILD_JOBS must be a positive integer' >&2; exit 1; }
case "${EFI_ARCH}" in x64|aa64) ;; *) echo "error: unsupported EFI architecture: ${EFI_ARCH}" >&2; exit 1 ;; esac

BUILD="$(mktemp -d)"
trap 'rm -r "${BUILD}"' EXIT
export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH
export KBUILD_BUILD_TIMESTAMP="@${SOURCE_DATE_EPOCH}"
export KBUILD_BUILD_USER=mos
export KBUILD_BUILD_HOST=boot-builder

make -C "${SOURCE}" O="${BUILD}" CROSS_COMPILE="${CROSS_PREFIX}" allnoconfig
while IFS= read -r setting; do
    case "${setting}" in
    CONFIG_*=*) symbol=${setting%%=*} ;;
    '# CONFIG_'*' is not set')
        symbol=${setting#\# }
        symbol=${symbol% is not set}
        ;;
    *) continue ;;
    esac
    grep -Eq "^(${symbol}=.*|# ${symbol} is not set)$" "${BUILD}/.config" || {
        echo "error: BusyBox ${EFI_ARCH} configuration symbol is unavailable: ${symbol}" >&2
        exit 1
    }
    sed -i -e "/^${symbol}=/c\\${setting}" \
        -e "/^# ${symbol} is not set$/c\\${setting}" "${BUILD}/.config"
done <"${CONFIG}"
make -C "${SOURCE}" O="${BUILD}" CROSS_COMPILE="${CROSS_PREFIX}" silentoldconfig
while IFS= read -r setting; do
    case "${setting}" in
    CONFIG_*=*|'# CONFIG_'*' is not set') ;;
    *) continue ;;
    esac
    grep -Fqx "${setting}" "${BUILD}/.config" || {
        echo "error: BusyBox ${EFI_ARCH} configuration did not retain: ${setting}" >&2
        exit 1
    }
done <"${CONFIG}"
make -C "${SOURCE}" O="${BUILD}" CROSS_COMPILE="${CROSS_PREFIX}" \
    -j"${BUSYBOX_BUILD_JOBS}" busybox

mkdir -p "${OUTPUT}"
install -m 0755 "${BUILD}/busybox" "${OUTPUT}/busybox"
"${CHECK}" "${OUTPUT}/busybox" "${EFI_ARCH}" "${REQUIRED}" '' "${RUNNER[@]}"
if [ "${#RUNNER[@]}" -eq 0 ]; then
    "${OUTPUT}/busybox" --list >"${OUTPUT}/busybox.applets"
else
    "${RUNNER[@]}" "${OUTPUT}/busybox" --list >"${OUTPUT}/busybox.applets"
fi
LC_ALL=C sort -o "${OUTPUT}/busybox.applets" "${OUTPUT}/busybox.applets"
install -m 0644 "${REQUIRED}" "${OUTPUT}/busybox.required-applets"

BINARY_SHA256="$(sha256sum "${OUTPUT}/busybox")"
BINARY_SHA256=${BINARY_SHA256%% *}
CONFIG_SHA256="$(sha256sum "${CONFIG}")"
CONFIG_SHA256=${CONFIG_SHA256%% *}
BINARY_SIZE="$(stat -c %s "${OUTPUT}/busybox")"
{
    printf 'ARCH=%s\n' "${EFI_ARCH}"
    printf 'BINARY_SHA256=%s\n' "${BINARY_SHA256}"
    printf 'BINARY_SIZE=%s\n' "${BINARY_SIZE}"
    printf 'CONFIG_SHA256=%s\n' "${CONFIG_SHA256}"
    printf 'LICENSE=GPL-2.0-only\n'
    printf 'SOURCE_DATE_EPOCH=%s\n' "${SOURCE_DATE_EPOCH}"
} >"${OUTPUT}/busybox.provenance"
find "${OUTPUT}" -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +
