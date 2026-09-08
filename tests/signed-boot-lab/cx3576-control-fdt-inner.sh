#!/bin/bash
# mos-build-side: container -- every command below runs inside the U-Boot
#   sandbox image; the mkimage is the one built from the board's own commit.
#
# Write a required FIT signing key into the CX3576 U-Boot's own control FDT,
# using the mkimage built from the same U-Boot commit the board build uses.
# The board's u-boot.dtb is named by the caller; it comes out of the real
# U-Boot build.
#
#   cx3576-control-fdt-inner.sh <u-boot.dtb> <kernel-image> <board-dtb>
set -euo pipefail
DTB_IN="${1:?cx3576-control-fdt-inner.sh <u-boot.dtb> <kernel-image> <board-dtb>}"
KERNEL_IN="${2:?cx3576-control-fdt-inner.sh <u-boot.dtb> <kernel-image> <board-dtb>}"
BOARD_DTB_IN="${3:?cx3576-control-fdt-inner.sh <u-boot.dtb> <kernel-image> <board-dtb>}"
W=/w/cxfit; rm -rf "${W}"; mkdir -p "${W}/keys"; cd "${W}"
cp "${DTB_IN}" control.dtb
echo "before: $(fdtget -l control.dtb /signature 2>&1)"
openssl genrsa -out keys/mosdev.key 2048 2>/dev/null
openssl req -batch -new -x509 -key keys/mosdev.key -out keys/mosdev.crt -days 3650 \
    -subj "/O=mos development/CN=mos development FIT mosdev" 2>/dev/null
dd if="${KERNEL_IN}" of=kernel.bin bs=1M count=4 status=none
cp "${BOARD_DTB_IN}" board.dtb
dd if=/dev/urandom of=initrd.img bs=1M count=1 status=none
cp /lab/boot.its .
/uboot/tools/mkimage -f boot.its -k keys -K control.dtb -r boot.itb | tail -3
echo "after:  /signature node = $(fdtget -l control.dtb /signature)"
echo "        required = $(fdtget control.dtb /signature/key-mosdev required)"
echo "        algo     = $(fdtget control.dtb /signature/key-mosdev algo)"
echo "        hint     = $(fdtget control.dtb /signature/key-mosdev key-name-hint)"
echo "        size: before $(stat -c%s "${DTB_IN}") -> after $(stat -c%s control.dtb) bytes"
