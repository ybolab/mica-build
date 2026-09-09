#!/bin/bash
# mos-build-side: container -- package an already built kernel and early init.
set -euo pipefail
export SOURCE_DATE_EPOCH=1577836800
EFI_ARCH=${2:?EFI architecture required}
case "$EFI_ARCH" in
    x64) STUB=/usr/lib/systemd/boot/efi/linuxx64.efi.stub; BOOT_NAME=BOOTX64.EFI ;;
    aa64) STUB=/arm64/usr/lib/systemd/boot/efi/linuxaa64.efi.stub; BOOT_NAME=BOOTAA64.EFI ;;
    *) echo 'error: unsupported EFI architecture' >&2; exit 1 ;;
esac
case "$1" in
kernel)
    bash /tools/initramfs.sh /tmp/initramfs "$EFI_ARCH"
    ukify build --linux=/input/kernel --initrd=/output/initramfs.cpio \
        --cmdline=@/input/cmdline --uname="$(cat /input/kernel.release)" \
        --stub="$STUB" --efi-arch="$EFI_ARCH" \
        --os-release=@/input/os-release --output=/output/boot.efi \
        --signtool=sbsign --secureboot-private-key=/signing/key.pem --secureboot-certificate=/signing/cert.pem
    sbverify --cert /signing/cert.pem /output/boot.efi
    ;;
firmware)
    sbsign --key /signing/key.pem --cert /signing/cert.pem --output "/output/$BOOT_NAME" \
        "/usr/lib/systemd/boot/efi/systemd-boot$EFI_ARCH.efi"
    sbverify --cert /signing/cert.pem "/output/$BOOT_NAME"
    ;;
*) echo 'error: expected kernel or firmware' >&2; exit 1 ;;
esac
