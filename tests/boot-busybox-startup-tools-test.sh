#!/usr/bin/env bash
# mos-build-side: container -- real applet syscalls, in an isolated mount namespace.
# Requires SYS_ADMIN and access to loop-control/block major 7 in this test container.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK=$(mktemp -d)
MOUNTS=()
LOOP=
cleanup() {
    local index
    for ((index=${#MOUNTS[@]}-1; index>=0; index--)); do
        /busybox-out/x64/busybox umount "${MOUNTS[index]}" || return 1
    done
    if [ -n "$LOOP" ]; then
        test "$(cat "/sys/class/block/${LOOP##*/}/loop/backing_file")" = "$WORK/root.squashfs" || return 1
        /busybox-out/x64/busybox losetup -d "$LOOP" || return 1
    fi
    if [ -d "$WORK" ]; then rm -r "$WORK"; fi
}
trap cleanup EXIT
mount_id() { awk -v path="$1" '$5 == path {print $1 ":" $3 ":" $4}' /proc/self/mountinfo; }
flags() { awk -v path="$1" '$5 == path {print $6}' /proc/self/mountinfo; }
require_flags() {
    local path=$1 flag actual
    shift
    actual=",$(flags "$path"),"
    for flag in "$@"; do [[ "$actual" == *",$flag,"* ]]; done
}
refuse() {
    if "$@" > "$WORK/refusal" 2>&1; then
        printf 'FAIL: invalid applet request accepted: %s\n' "$*" >&2; exit 1
    fi
}

mkdir "$WORK/payload"
printf 'signed-root fixture\n' > "$WORK/payload/identity"
mksquashfs "$WORK/payload" "$WORK/root.squashfs" -noappend -processors 1 -quiet
test -e /dev/loop-control || mknod /dev/loop-control c 10 237

for arch in x64 aa64; do
    BB=("/busybox-out/$arch/busybox")
    if [ "$arch" = aa64 ]; then BB=(qemu-aarch64 "${BB[@]}"); fi
    "$REPO/pkgs/mos-boot/check-busybox.sh" "${BB[-1]}" "$arch" \
        "$REPO/pkgs/mos-boot/busybox.required-applets" '' "${BB[@]:0:${#BB[@]}-1}"
    root="$WORK/$arch"
    mkdir -p "$root"/{dev,proc,sys,run,newroot,support,modules,firmware}
    for entry in 'dev devtmpfs nosuid,mode=0755' 'proc proc nosuid,nodev,noexec' \
        'sys sysfs nosuid,nodev,noexec' 'run tmpfs nosuid,nodev,mode=0755,size=32M'; do
        read -r dir kind options <<< "$entry"
        "${BB[@]}" mount -t "$kind" -o "$options" "$kind" "$root/$dir"
        MOUNTS+=("$root/$dir")
        require_flags "$root/$dir" nosuid
    done
    require_flags "$root/proc" nodev noexec
    require_flags "$root/sys" nodev noexec

    LOOP=$("${BB[@]}" losetup -f)
    [[ "$LOOP" =~ ^/dev/loop[0-9]+$ ]]
    test -e "$LOOP" || mknod "$LOOP" b 7 "${LOOP#/dev/loop}"
    test ! -e "/sys/class/block/${LOOP##*/}/loop/backing_file"
    "${BB[@]}" losetup -r "$LOOP" "$WORK/root.squashfs"
    test "$(cat "/sys/class/block/${LOOP##*/}/ro")" = 1
    test "$(cat "/sys/class/block/${LOOP##*/}/loop/backing_file")" = "$WORK/root.squashfs"
    test "$(cat "/sys/class/block/${LOOP##*/}/loop/offset")" = 0
    test "$(cat "/sys/class/block/${LOOP##*/}/loop/sizelimit")" = 0
    refuse "${BB[@]}" losetup -r "$LOOP" "$WORK/root.squashfs"
    refuse "${BB[@]}" losetup --read-only --find --show "$WORK/root.squashfs"
    "${BB[@]}" mount -t squashfs -o ro,nodev "$LOOP" "$root/support"
    MOUNTS+=("$root/support")
    cmp "$root/support/identity" "$WORK/payload/identity"
    require_flags "$root/support" ro nodev

    "${BB[@]}" mount -o bind "$root/support" "$root/modules"
    MOUNTS+=("$root/modules")
    "${BB[@]}" mount -o remount,bind,ro,nodev,nosuid "$root/support" "$root/modules"
    require_flags "$root/modules" ro nodev nosuid
    [[ ",$(flags "$root/modules")," != *,noexec,* ]]
    test "$(stat -c %d:%i "$root/support/identity")" = "$(stat -c %d:%i "$root/modules/identity")"

    printf 'machine identity\n' > "$root/run/machine-id"
    touch "$root/machine-id"
    "${BB[@]}" mount -o bind "$root/run/machine-id" "$root/machine-id"
    MOUNTS+=("$root/machine-id")
    "${BB[@]}" mount -o remount,bind,ro,nodev,nosuid,noexec "$root/run/machine-id" "$root/machine-id"
    require_flags "$root/machine-id" ro nodev nosuid noexec
    refuse sh -c 'printf changed > "$1"' sh "$root/machine-id"

    # The exitrd is an independent tmpfs carried under /run; moving API mounts
    # must preserve their kernel mount IDs and this retained child mount.
    mkdir "$root/run/initramfs"
    "${BB[@]}" mount -t tmpfs -o nosuid,nodev,mode=0700,size=36M tmpfs "$root/run/initramfs"
    MOUNTS+=("$root/run/initramfs")
    printf 'retained shutdown\n' > "$root/run/initramfs/shutdown"
    retained=$(mount_id "$root/run/initramfs")
    for dir in dev proc sys run; do
        mkdir "$root/newroot/$dir"
        before=$(mount_id "$root/$dir")
        "${BB[@]}" mount -o move "$root/$dir" "$root/newroot/$dir"
        test "$before" = "$(mount_id "$root/newroot/$dir")"
        for index in "${!MOUNTS[@]}"; do
            case "${MOUNTS[index]}" in
                "$root/$dir"|"$root/$dir/"*) MOUNTS[index]="$root/newroot/$dir${MOUNTS[index]#"$root/$dir"}" ;;
            esac
        done
    done
    test "$retained" = "$(mount_id "$root/newroot/run/initramfs")"
    test "$(cat "$root/newroot/run/initramfs/shutdown")" = 'retained shutdown'
    # Non-PID-1 and ordinary directories must refuse before deleting old files.
    refuse "${BB[@]}" switch_root "$root/newroot" /sbin/init
    test -f "$root/newroot/run/initramfs/shutdown"
    printf 'STARTUP_TOOLS_PASS arch=%s\n' "$arch"
    cleanup
    MOUNTS=()
    LOOP=
    if [ "$arch" = x64 ]; then
        mkdir -p "$WORK/payload"
        printf 'signed-root fixture\n' > "$WORK/payload/identity"
        mksquashfs "$WORK/payload" "$WORK/root.squashfs" -noappend -processors 1 -quiet
    fi
done
