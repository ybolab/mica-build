#!/bin/sh
# Take grub-editenv out of its package for boards RAUC drives through grub.
#
# Called from os/rootfs/stages/40-board.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: RAUC_BOOTLOADER.

set -eu
if [ "$RAUC_BOOTLOADER" = "grub" ]; then
    apt-get update
    # libdevmapper is grub-editenv's one dependency this root does not
    # already carry at THIS point in the build. It arrives later anyway,
    # with cryptsetup-bin in kernel-and-initramfs.sh -- but depending on
    # that ordering would make this step pass or fail according to where
    # someone moves it, so it is named here and the step stands alone.
    apt-get install -y --no-install-recommends libdevmapper1.02.1
    cd /tmp
    apt-get download grub-common
    dpkg-deb --fsys-tarfile grub-common_*.deb \
        | tar -xO ./usr/bin/grub-editenv > /usr/bin/grub-editenv
    chmod 0755 /usr/bin/grub-editenv
    rm -f /tmp/grub-common_*.deb
    cd /
    [ -s /usr/bin/grub-editenv ] ||
        { echo "error: extracting grub-editenv produced an empty file; RAUC's grub backend would fail at runtime with 'No such file or directory'" >&2; exit 1; }
    missing="$(ldd /usr/bin/grub-editenv | awk '/not found/{print $1}' | tr '\n' ' ')"
    [ -z "${missing}" ] ||
        { echo "error: grub-editenv was taken out of its package but this root does not carry:${missing}. Extracting one file skips dependency resolution, so a missing library shows up as a dynamic-link failure at runtime, inside a child process RAUC reports only as 'Failed to start grub-editenv'" >&2; exit 1; }
    grub-editenv --help >/dev/null 2>&1 ||
        { echo "error: grub-editenv is installed and will not run" >&2; exit 1; }
    echo "rauc: grub-editenv installed ($(stat -c%s /usr/bin/grub-editenv) bytes), which the grub backend execs to read and write grubenv"
fi
