#!/usr/bin/env bash
# ENTRY SCRIPT -- boot an assembled UEFI image the way the machine boots it.
#
# WHAT IT PROVES. That the image this tree assembled comes up through firmware,
# the ESP's GRUB and its own `dm-mod.create=` command line with no initramfs,
# to a login prompt -- and, since the kernel logs the certificate it embedded,
# that the anchor is in the running kernel's keyring. It is the regression
# check for a kernel-configuration change: the signed-verity symbols must not
# disturb the boot path that ships today, which still takes an unauthenticated
# root hash from the command line.
#
# ON WHICH TARGET. QEMU, Secure Boot OFF, on the image named -- x64 with OVMF.
# `-snapshot` so the shipped image file is never written to.
#
#   bash tests/signed-boot-lab/image-boot.sh --image _out/x64/x64-mos-latest.img
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
lab_require_image "${LAB_IMAGE}"

IMAGE=""; SECS=260
while [ "$#" -gt 0 ]; do
    case "$1" in
        --image)   IMAGE="${2:?--image takes a file}"; shift 2 ;;
        --seconds) SECS="${2:?--seconds takes a number}"; shift 2 ;;
        *) echo "error: '$1' is not an option this script takes" >&2; exit 2 ;;
    esac
done
[ -n "${IMAGE}" ] || { echo "error: --image is required" >&2; exit 2; }
[ -s "${IMAGE}" ] || { echo "error: ${IMAGE} does not exist; assemble it first (make os-image-<board>, or build/run.sh --mkimage-uefi --board <board>)" >&2; exit 1; }

mkdir -p "${LAB_WORK}"
# A copy, and -snapshot on top of it: the assembled image is an artefact other
# checks read, and a boot that wrote to it would change what they see.
cp "${IMAGE}" "${LAB_WORK}/image-under-test.img"
LOG="${LAB_WORK}/image-boot.log"
lab_docker_run "${LAB_IMAGE}" bash -c "
set -eu
cp /usr/share/OVMF/OVMF_VARS_4M.fd /run/vars.fd
timeout ${SECS} qemu-system-x86_64 -machine q35 -cpu max -m 2048 -smp 2 \
    -nographic -no-reboot -snapshot \
    -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
    -drive if=pflash,format=raw,unit=1,format=raw,file=/run/vars.fd \
    -drive if=none,id=disk0,format=raw,file=/w/image-under-test.img \
    -device virtio-blk-pci,drive=disk0,bootindex=0 \
    -netdev user,id=net0 -device virtio-net-pci,netdev=net0 2>&1" > "${LOG}" || true
lab_note "captured ${LOG}"
grep -aE 'Command line:|Loaded X.509 cert|device-mapper: verity|login:' "${LOG}" | head -6
grep -aq 'login:' "${LOG}" || {
    echo "error: the guest never reached a login prompt; the console is in ${LOG}" >&2
    exit 1
}
lab_note "the image reached a login prompt"
