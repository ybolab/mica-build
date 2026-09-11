#!/usr/bin/env bash
# Validate one built early-boot BusyBox before packaging it.
set -euo pipefail

usage() {
    echo 'usage: check-busybox.sh BINARY {x64|aa64} REQUIRED_APPLETS [EXPECTED_SHA256] [RUNNER ...]' >&2
    exit 64
}

[ "$#" -ge 3 ] || usage
BINARY=$1
EFI_ARCH=$2
REQUIRED=$3
EXPECTED_SHA256=${4:-}
if [ "$#" -ge 4 ]; then shift 4; else shift 3; fi
RUNNER=("$@")

[ -f "${BINARY}" ] || { echo "error: missing BusyBox payload: ${BINARY}" >&2; exit 1; }
[ ! -L "${BINARY}" ] || { echo "error: BusyBox payload is a symlink: ${BINARY}" >&2; exit 1; }
[ -x "${BINARY}" ] || { echo "error: BusyBox payload is not executable: ${BINARY}" >&2; exit 1; }
[ -s "${REQUIRED}" ] || { echo "error: required applet contract is missing or empty: ${REQUIRED}" >&2; exit 1; }
command -v file >/dev/null
command -v readelf >/dev/null
command -v sha256sum >/dev/null

case "${EFI_ARCH}" in
    x64) EXPECTED_MACHINE='Advanced Micro Devices X86-64' ;;
    aa64) EXPECTED_MACHINE='AArch64' ;;
    *) usage ;;
esac

FILE_INFO="$(file -b "${BINARY}")"
case "${FILE_INFO}" in
    *ELF*statically\ linked*) ;;
    *) echo "error: BusyBox payload is not statically linked: ${FILE_INFO}" >&2; exit 1 ;;
esac

ELF_HEADER="$(readelf -h "${BINARY}")"
case "${ELF_HEADER}" in
    *"Machine:"*"${EXPECTED_MACHINE}"*) ;;
    *) echo "error: BusyBox payload has the wrong architecture; expected ${EXPECTED_MACHINE}" >&2; exit 1 ;;
esac

PROGRAM_HEADERS="$(readelf -l "${BINARY}")"
case "${PROGRAM_HEADERS}" in
    *INTERP*) echo 'error: BusyBox payload carries a dynamic program interpreter' >&2; exit 1 ;;
esac
DYNAMIC_SECTION="$(readelf -d "${BINARY}")"
case "${DYNAMIC_SECTION}" in
    *NEEDED*) echo 'error: BusyBox payload carries a dynamic library dependency' >&2; exit 1 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -r "${WORK}"' EXIT
LC_ALL=C sort "${REQUIRED}" >"${WORK}/required"
[ "$(uniq -d "${WORK}/required" | wc -l)" -eq 0 ] || {
    echo 'error: required applet contract contains duplicates' >&2
    exit 1
}

if [ "${#RUNNER[@]}" -eq 0 ]; then
    "${BINARY}" --list >"${WORK}/applets"
else
    "${RUNNER[@]}" "${BINARY}" --list >"${WORK}/applets"
fi
[ -s "${WORK}/applets" ] || { echo 'error: BusyBox payload returned an empty applet list' >&2; exit 1; }
LC_ALL=C sort "${WORK}/applets" >"${WORK}/applets.sorted"
[ "$(uniq -d "${WORK}/applets.sorted" | wc -l)" -eq 0 ] || {
    echo 'error: BusyBox payload returned duplicate applet names' >&2
    exit 1
}
while IFS= read -r applet; do
    [ -n "${applet}" ] || { echo 'error: required applet contract contains an empty line' >&2; exit 1; }
    if [ "$(grep -Fxc -- "${applet}" "${WORK}/applets.sorted")" -ne 1 ]; then
        echo "error: BusyBox payload is missing required applet: ${applet}" >&2
        exit 1
    fi
done <"${WORK}/required"

SHA256="$(sha256sum "${BINARY}")"
SHA256=${SHA256%% *}
if [ -n "${EXPECTED_SHA256}" ]; then
    [[ "${EXPECTED_SHA256}" =~ ^[0-9a-f]{64}$ ]] || { echo 'error: expected payload SHA-256 is malformed' >&2; exit 1; }
    [ "${SHA256}" = "${EXPECTED_SHA256}" ] || { echo 'error: payload SHA-256 does not match the recorded identity' >&2; exit 1; }
fi
SIZE="$(stat -c %s "${BINARY}")"
APPLET_COUNT="$(wc -l <"${WORK}/applets.sorted")"
printf 'BOOT_BUSYBOX_PASS arch=%s sha256=%s size=%s applets=%s\n' \
    "${EFI_ARCH}" "${SHA256}" "${SIZE}" "${APPLET_COUNT}"
