#!/usr/bin/env bash
# Boot the x64 disk image in QEMU, through firmware, from the disk.
#
#   bash os/tools/qemu-run.sh                 boot and leave the console attached
#   MOS_QEMU_TIMEOUT=300 bash os/tools/qemu-run.sh --capture <file>

# Not `-kernel`. QEMU will happily load a kernel and initrd from the host and
# skip the disk entirely, and that would be a faster test of a smaller thing:
# it bypasses the firmware, GRUB, grubenv and the A/B order, which on this
# board are exactly the parts with no other test. The image here boots the way
# an industrial PC boots it: OVMF finds the ESP, runs BOOTX64.EFI, GRUB reads
# its own grub.cfg and grubenv, and the kernel comes off the same partition
# RAUC updates. QEMU runs inside a container because this host has none, and
# because pinning the machine model, the firmware build and the disk interface
# here means a green run means the same thing on someone else's laptop.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/_out/x64"
. "${REPO_ROOT}/os/boards/x64/board.env"

# The container this file runs everything in, resolved from
# os/build-env/images.env. Unlike the assemblers, this one is resolved at file
# scope and not inside a branch, because there is no host path to protect: QEMU
# runs in a container because this host has none, so every route through this
# script needs the image and a failure to resolve it fails the run either way.

# One resolution for three uses -- the ESP grub.cfg edit under MOS_QEMU_APPEND,
# and the two qemu invocations at the bottom. They were three separate
# `debian:trixie-slim` literals and had to stay in step by hand; the machine
# model, the firmware build and the disk interface are pinned here precisely so
# "a green run means the same thing on someone else's laptop", and the ovmf
# that supplies the firmware comes out of this base.
QEMU_IMAGE="$(bash "${REPO_ROOT}/os/build-env/from.sh" --ref IMAGE_DEBIAN_TRIXIE)"
IMG="${MOS_QEMU_IMAGE:-${OUT_DIR}/${IMAGE_LATEST_NAME}}"
TIMEOUT="${MOS_QEMU_TIMEOUT:-240}"
MEM="${MOS_QEMU_MEM:-2048}"

CAPTURE=""
PREPARE_ONLY=0
case "${1:-}" in
--capture) CAPTURE="${2:?usage: --capture <file>}" ;;
--prepare-only) PREPARE_ONLY=1 ;;
"") ;;
*) echo "usage: $0 [--capture <file>] [--prepare-only]" >&2; exit 2 ;;
esac

if [ ! -e "${IMG}" ]; then
    echo "error: ${IMG} not found. Build it: MOS_BOARD=x64 bash os/rootfs/build-v2.sh && bash os/build/run.sh --mkimage-x64" >&2
    exit 1
fi

# The image is bound in from _out/, not copied: it is ~2 GiB, and a bind of a
# /tmp path does not propagate on this host anyway (see
# os/build/src/mkimage-x64.ts).
# Read-only, so a run cannot mutate the artifact it is testing -- QEMU is given
# a copy-on-write overlay instead, which also makes repeated runs start from
# the same state rather than from whatever the last one left.
RUN_DIR="${OUT_DIR}/.qemu"
# MOS_QEMU_REUSE_DISK keeps the disk a previous --prepare-only made, so
# os/tools/qemu-seed-state.sh's writes survive into the boot. Without it every run
# starts from the pristine image, which is the right default: a test that
# silently inherited the last run's state would pass for reasons nobody chose.
if [ "${MOS_QEMU_REUSE_DISK:-0}" = "1" ]; then
    [ -f "${RUN_DIR}/disk.img" ] || {
        echo "error: MOS_QEMU_REUSE_DISK=1 but ${RUN_DIR}/disk.img does not exist; run --prepare-only first" >&2
        exit 1
    }
    echo "note: reusing the prepared disk, including anything seeded into it"
else
    rm -rf "${RUN_DIR}"
    mkdir -p "${RUN_DIR}"
    cp "$(readlink -f "${IMG}")" "${RUN_DIR}/disk.img"
fi

# The virtual disk is made LARGER than the image, because that is what flashing
# one to a device does. systemd-repart's job is to extend DATA into whatever
# space the medium has beyond the image, and a disk that is exactly the image
# gives it nothing to extend into -- repart then FAILS, which is what the first
# x64 boot showed. Booting the image at its own size tests a case no real
# device is ever in.
if [ "${MOS_QEMU_REUSE_DISK:-0}" = "1" ]; then
    # Already grown by the --prepare-only run, and re-checking would compare
    # the disk against itself: the growth guard would then refuse a disk that
    # is exactly the size it was asked to be.
    echo "note: disk was sized by the prepare step; not resizing"
else
    DISK_MIB="${MOS_QEMU_DISK_MIB:-4096}"
    img_mib=$(( $(stat -c%s "${RUN_DIR}/disk.img") / 1048576 ))
    if [ "${DISK_MIB}" -le "${img_mib}" ]; then
        echo "error: MOS_QEMU_DISK_MIB=${DISK_MIB} is not larger than the ${img_mib} MiB image; systemd-repart would have nothing to grow into and the run would not exercise first-boot growth at all" >&2
        exit 1
    fi
    truncate -s "${DISK_MIB}M" "${RUN_DIR}/disk.img"
    
        echo "note: virtual disk is ${DISK_MIB} MiB for a ${img_mib} MiB image, so systemd-repart has room to extend DATA"
fi

# Applied on both paths, reused disk included. Inside the "grow the disk"
# branch it would only run when the disk is fresh, so every run that reused a
# seeded disk would silently boot without the debugging arguments it was told
# to add and mosd's journal would never reach the console -- a daemon that
# looks silent and is not.

# MOS_QEMU_APPEND adds kernel arguments to the disk copy, by rewriting the
# grub.cfg in its ESP. The shipped image is untouched, and the boot still goes
# through GRUB reading its own configuration, so this is a debugging knob and
# not a second boot path. It exists because mos keeps the journal in RAM
# (/etc/systemd/journald.conf.d/00-volatile.conf sets Storage=volatile, which
# follows from /var being the EPHEMERAL partition). That is deliberate, and it
# means a failed unit's reason is in a journal that dies with the machine: the
# console shows "[FAILED] ... See systemctl status for details" and the details
# are unreachable. systemd.journald.forward_to_console=1 puts them on the
# serial line.
if [ -n "${MOS_QEMU_APPEND:-}" ]; then
    # ESP_START_MIB, not BOOT_A_START_MIB. The two are different partitions on
    # this board and only one of them holds a grub.cfg: the ESP (partition 1, at
    # 1 MiB) carries EFI/mos/grub.cfg and EFI/mos/grubenv, while BOOT-A
    # (partition 2, at 65 MiB) carries vmlinuz, initrd.img and cmdline.cfg at its
    # FAT root and has no EFI directory at all. Measured against
    # x64-mos-v2-latest.img, 2026-08-28. Reading the boot slot here made mcopy
    # fail with `File "::/EFI/mos/grub.cfg" not found`, which took the whole
    # prepare down -- and since the apid-api harness always sets MOS_QEMU_APPEND
    # (its readiness signal is the journald line the append produces), that
    # failure was unconditional.
    esp_off=$(( ESP_START_MIB * 1048576 ))
    docker run --rm -v "${RUN_DIR}:/w" -e OFF="${esp_off}" -e APPEND="${MOS_QEMU_APPEND}" \
        "${QEMU_IMAGE}" bash -c '
            set -eu
            apt-get update -qq >/dev/null 2>&1
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends mtools >/dev/null 2>&1
            cd /w
            mcopy -n -i "disk.img@@${OFF}" ::/EFI/mos/grub.cfg grub.cfg
            # The indentation is matched as WHITESPACE, not as four spaces.
            # os/boards/x64/grub.cfg:98 and :116 indent their linux lines with
            # EIGHT, so a four-space pattern matched neither and the count came
            # back 0 on every run.
            #
            # `|| true` on both counts, because `set -e` aborts a command
            # substitution whose command exits non-zero -- and grep -c exits 1
            # when it counts nothing. So the assignment itself killed the shell
            # BEFORE the guard on the next line could report why, which is how a
            # completely unmatched pattern came to look like a prepare step that
            # printed nothing and failed.
            before=$(grep -c "^[[:space:]]*linux " grub.cfg || true)
            [ "${before}" -ge 1 ] || { echo "error: no linux line in the ESP grub.cfg; MOS_QEMU_APPEND would have added nothing and the run would look normal" >&2; exit 1; }
            # Already there: leave it alone. This runs on the prepare AND on
            # every boot that reuses the disk, so an unconditional append lands
            # the same arguments two or three times over a run. For
            # `systemd.journald.forward_to_console=1` a repeat is the same value
            # twice and costs nothing; for `systemd.run=` it is not, because
            # systemd takes each occurrence as another ExecStart and RUNS THE
            # COMMAND AGAIN. Measured 2026-08-28: a duplicated systemd.run
            # executed the seeded script twice, back to back, on one boot.
            existing=$(grep -c -F -- "${APPEND}" grub.cfg || true)
            if [ "${existing}" -ge 1 ]; then
                echo "note: the append is already on the linux line; not adding it a second time" >&2
                exit 0
            fi
            sed -i "s|^\([[:space:]]*linux .*\)\$|\1 ${APPEND}|" grub.cfg
            # -F: the append is a fixed string, and a value carrying a `.` or a
            # `*` must be looked for as itself rather than as a pattern that
            # happens to match something else on the line.
            landed=$(grep -c -F -- "${APPEND}" grub.cfg || true)
            [ "${landed}" -ge 1 ] || { echo "error: the append did not land in grub.cfg" >&2; exit 1; }
            mcopy -o -n -i "disk.img@@${OFF}" grub.cfg ::/EFI/mos/grub.cfg
        '
    echo "note: appended to the disk copy's kernel command line: ${MOS_QEMU_APPEND}"
fi

if [ "${PREPARE_ONLY}" -eq 1 ]; then
    echo "prepared ${RUN_DIR}/disk.img; seed it with os/tools/qemu-seed-state.sh, then run with MOS_QEMU_REUSE_DISK=1"
    exit 0
fi

cat >"${RUN_DIR}/run.sh" <<'INNER'
set -eu
# ovmf is Debian's build of the EDK2 UEFI firmware. The vars file is writable
# and per-run: UEFI stores its boot order there, and a shared one would carry a
# previous run's decisions into this one.
RUN_SECONDS="${RUN_SECONDS:-}"
# Empty unless MOS_QEMU_FORWARD asked for it; `set -u` would kill the run
# otherwise, after the image had already been copied and grown.
HOSTFWD="${HOSTFWD:-}"
cp /usr/share/OVMF/OVMF_CODE_4M.fd /run/code.fd
cp /usr/share/OVMF/OVMF_VARS_4M.fd /run/vars.fd

# A GRACEFUL SHUTDOWN, not a kill. The first version let `timeout` send
# SIGTERM to qemu, which stops the machine where it stands: the guest's page
# cache is never written, so /var/log/journal was EMPTY on a disk whose
# systemd-journal-flush.service had reported success. Nothing was wrong with
# the guest -- the harness threw the evidence away.
#
# MOS_QEMU_RUN_SECONDS of running, then ACPI power button, which systemd turns
# into a real shutdown: units stop, filesystems unmount, and what the device
# wrote is on the disk. It also means the shutdown path itself is exercised
# rather than skipped.
if [ -n "${RUN_SECONDS}" ]; then
    ( sleep "${RUN_SECONDS}"
      if ! printf 'system_powerdown\n' | socat - UNIX-CONNECT:/run/mon.sock >/dev/null; then
          echo "error: could not reach the QEMU monitor to request shutdown" >&2
      fi
      # A guest that ignores the power button must not hold the harness open
      # forever; 90s after the request, take it down.
      sleep 90
      echo "note: guest did not power off 90s after the request; taking it down" >&2
      printf 'quit\n' | socat - UNIX-CONNECT:/run/mon.sock >/dev/null || true ) &
fi

exec qemu-system-x86_64 \
    -monitor unix:/run/mon.sock,server,nowait \
    -machine q35 \
    -cpu max \
    -m "${MEM}" \
    -nographic \
    -no-reboot \
    -drive if=pflash,format=raw,unit=0,readonly=on,file=/run/code.fd \
    -drive if=pflash,format=raw,unit=1,format=raw,file=/run/vars.fd \
    -drive if=none,id=disk0,format=raw,file=/w/disk.img \
    -device virtio-blk-pci,drive=disk0,bootindex=0 \
    -netdev user,id=net0${HOSTFWD} \
    -device virtio-net-pci,netdev=net0 \
    -serial mon:stdio
INNER

RUN_SECONDS="${MOS_QEMU_RUN_SECONDS:-}"
DOCKER_ARGS=(--rm -v "${RUN_DIR}:/w" -e MEM="${MEM}" -e RUN_SECONDS="${RUN_SECONDS}")
[ -e /dev/kvm ] && DOCKER_ARGS+=(--device /dev/kvm)

# MOS_QEMU_FORWARD opens a path from the host to apid inside the guest, for the
# API suite. It is off by default, and the default is the point: a management
# daemon is otherwise unreachable from outside the machine, which is what makes
# an unattended run a closed box.

# Two doors, not one. QEMU's user-mode `hostfwd` binds inside the container, so
# a forward alone reaches nothing; the container must publish the port too.
# Getting one of the two right produces a connection refused with nothing to
# say which half is missing, so both are set here or neither is. The forward is
# bound to 127.0.0.1 on the host: the guest has no password until the suite
# sets one, and until then anything that can reach the port can complete
# first-boot setup and own the device.
HOSTFWD=""
if [ -n "${MOS_QEMU_FORWARD:-}" ]; then
    https_port="${MOS_QEMU_HTTPS_PORT:-18443}"
    http_port="${MOS_QEMU_HTTP_PORT:-18080}"
    HOSTFWD=",hostfwd=tcp::${https_port}-:443,hostfwd=tcp::${http_port}-:80"
    DOCKER_ARGS+=(-p "127.0.0.1:${https_port}:${https_port}"
        -p "127.0.0.1:${http_port}:${http_port}")

    # The third door, and the one that is invisible until it bites.
    #
    # `-p 127.0.0.1:...` publishes on the DOCKER HOST's loopback. A caller
    # that is itself a container has its own loopback and its own network, so
    # it connects to itself and gets a refusal that says nothing about why.
    # Measured here: this repository's own session runs inside a container on
    # `traefik`/172.18.0.0/16 while a plain `docker run` lands on the default
    # bridge at 172.17.0.0/16, with no route between them. The publish was
    # correct, the hostfwd was correct, and the port was unreachable anyway.
    #
    # MOS_QEMU_NETWORK attaches the QEMU container to a named docker network so
    # a sibling container can reach it directly. The address to use is then the
    # CONTAINER's, not loopback, so it is printed rather than left to be
    # discovered.
    if [ -n "${MOS_QEMU_NETWORK:-}" ]; then
        DOCKER_ARGS+=(--network "${MOS_QEMU_NETWORK}")
        echo "note: QEMU joins the '${MOS_QEMU_NETWORK}' network; a sibling container reaches it at <container-ip>:${https_port}, NOT at 127.0.0.1"
    fi
    # MOS_QEMU_SSH_PORT, off unless asked for, because it is the way IN to a
    # machine whose whole security posture is that there is no way in until an
    # operator makes one. It exists because two things this repository has to
    # verify cannot be reached over HTTP at all: `rauc install`, which apid
    # exposes no endpoint for, and whether the transient root password actually
    # AUTHENTICATES -- the API can only report that it was set. A feature with
    # no way to exercise it end to end is the existence-versus-function trap in
    # its purest form, so the harness gets a door rather than the assertions
    # getting weaker.
    if [ -n "${MOS_QEMU_SSH_PORT:-}" ]; then
        ssh_port="${MOS_QEMU_SSH_PORT}"
        HOSTFWD="${HOSTFWD},hostfwd=tcp::${ssh_port}-:22"
        DOCKER_ARGS+=(-p "127.0.0.1:${ssh_port}:${ssh_port}")
        echo "note: forwarding :${ssh_port} -> guest :22; sshd still has to be enabled and given a key or a password through the API before it answers"
    fi
    echo "note: forwarding :${https_port} -> guest :443 and :${http_port} -> guest :80"
    echo "note: on the docker host that is https://127.0.0.1:${https_port}; from another container it is the QEMU container's own address on a shared network (see MOS_QEMU_NETWORK)"
    echo "note: the guest ships no admin password until something completes /setup, which is why the host publish is loopback-only"
fi
DOCKER_ARGS+=(-e HOSTFWD="${HOSTFWD}")

echo "note: booting ${IMG##*/} through OVMF; no /dev/kvm on this host means TCG, which is slow but complete"

# `timeout` wraps docker directly. An earlier version put the invocation in a
# function and re-declared it into `bash -c` so timeout could see it -- which
# silently dropped DOCKER_ARGS, because a bash array does not survive being
# exported. The container then ran with no volume and reported
# "/w/run.sh: No such file or directory", a message about the script rather
# than about the mount that was missing.
INSTALL_AND_RUN='
    apt-get update -qq >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        qemu-system-x86 ovmf socat >/dev/null 2>&1
    command -v socat >/dev/null || { echo "error: socat is not installed; the graceful-shutdown request could not be sent and the run would end in a SIGTERM that discards whatever the guest had not yet written" >&2; exit 1; }
    bash /w/run.sh'

if [ -n "${CAPTURE}" ]; then
    timeout "${TIMEOUT}" docker run "${DOCKER_ARGS[@]}" "${QEMU_IMAGE}" \
        bash -c "${INSTALL_AND_RUN}" >"${CAPTURE}" 2>&1 || true
    echo "console captured to ${CAPTURE} ($(wc -l <"${CAPTURE}") lines)"
else
    docker run "${DOCKER_ARGS[@]}" "${QEMU_IMAGE}" bash -c "${INSTALL_AND_RUN}"
fi
