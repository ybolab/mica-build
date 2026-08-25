#!/usr/bin/env bash
set -euo pipefail

# RFCT-087 — offline U-Boot A/B handshake harness, container side.
#
# Runs INSIDE the image os/tests/handshake-test/Dockerfile builds (started by
# run.sh). Executes the SHIPPED os/boards/cx3576/boot.cmd — compiled by the same
# `mkimage -T script` invocation os/mkimage-v2.sh uses, byte-unmodified —
# under a U-Boot v2026.07 sandbox binary (same source pin as the board build)
# against a layout-v2 GPT disk image backed by a host file, and asserts the
# whole A/B handshake state machine across separate process invocations.
#
# EXECUTION MODEL — one process invocation = one boot cycle. Three facts of
# the sandbox port make this work, all verified against the pinned source:
#
#  1. PERSISTENCE. The sandbox mmc driver mmaps its `filename` backing file
#     MAP_SHARED, and the binary carries the board's env contract (redundant
#     env at 0x1000000/0x1100000 on mmc 0), so the script's own saveenv lands
#     in mmc0.img and is read back by the NEXT process — same lifecycle as
#     eMMC across board resets.
#
#  2. RESET TERMINATES. `reset` on sandbox re-execs argv[0]
#     (sandbox_reset -> os_relaunch -> execv). The harness invokes the binary
#     with argv[0] pinned to /dev/null/mos-boot-cycle (bash `exec -a`), a path
#     that can never exec, so the relaunch fails and the process exits 1: a
#     reset ends the invocation instead of looping forever inside it. The next
#     invocation IS the post-reset boot.
#
#  3. "KERNEL ACCEPTED CONTROL" IS EMULATED — this is the one place the
#     harness stands in for hardware, and it is load-bearing for the decrement
#     trajectory. On sandbox, booti can NEVER hand over control
#     (booti_setup() fails unconditionally), so a cycle that reaches booti
#     always falls through to the script's burn-the-slot tail. A slot that
#     "boots and hangs before mark-good" — the case the 3->2->1->0 watchdog
#     trajectory exists for — is modeled by seeding kernel_addr_r ABOVE the
#     sandbox's 2048 MiB RAM: `load mmc 0:${bootpart} ${kernel_addr_r} Image`
#     then hits the sandbox's hard os_abort() on the unmappable address and
#     the process dies at exactly the semantic point where control leaves
#     U-Boot — after the decrement's saveenv, before the burn. kernel_addr_r
#     is board-env-provided on hardware (never set by the script), so seeding
#     it is environment, not a script change.
#
# Everything under the cwd (a private workspace mounted at /work); nothing
# else is written. Offline: no network use at all.

REPO=/repo
CACHE=/cache
UBOOT="${CACHE}/u-boot"
DTB="${CACHE}/u-boot.dtb"
MKIMAGE="${CACHE}/mkimage"
MKENVIMAGE="${CACHE}/mkenvimage"
BOOT_CMD="${REPO}/os/boards/cx3576/boot.cmd"

# shellcheck source=../../boards/cx3576/board.env
. "${REPO}/os/boards/cx3576/board.env"

ulimit -c 0 # SIGABRT is an expected cycle ending; do not litter cores

FAILED=0
check() {
    if [ "$2" = "$3" ]; then
        echo "PASS: $1"
    else
        echo "FAIL: $1 (expected '$3', got '$2')"
        FAILED=1
    fi
}
log_has() { # label log-file needle
    if grep -qF -- "$3" "$2"; then
        echo "PASS: $1: log carries '$3'"
    else
        echo "FAIL: $1: log lacks '$3' — tail: $(tail -n 5 "$2" | tr '\n' ' ')"
        FAILED=1
    fi
}
log_lacks() { # label log-file needle
    if grep -qF -- "$3" "$2"; then
        echo "FAIL: $1: log unexpectedly carries '$3'"
        FAILED=1
    else
        echo "PASS: $1: log does not carry '$3'"
    fi
}

fill() { head -c "$2" /dev/zero | tr '\0' "$3" > "$1"; }

# --- fixtures (mkimage-v2-selftest.sh style, synthetic) ----------------------
# boot.scr is the REAL contract artifact: the shipped source through the same
# mkimage invocation the assembler uses (os/mkimage-v2.sh compile_boot_script).
"${MKIMAGE}" -T script -C none -n "mos boot" -d "${BOOT_CMD}" boot.scr >/dev/null
fill Image $((4 * 1024 * 1024)) K
fill rk3576-src.dtb $((64 * 1024)) D
for slot in a b; do
    printf 'verity_args=dm-mod.create="mos,,0,ro,0 6144 verity 1 PARTUUID=fixture-%s PARTUUID=fixture-%s 4096 4096 768 768 sha256 1111 2222" dm-mod.waitfor=PARTUUID=fixture-%s\n' \
        "${slot}" "${slot}" "${slot}" > "mos-verity-${slot}.env"
done

# One FAT slot image; contents vary per slot/variant. 64 MiB = BOOT_SIZE_MIB.
mkfatslot() { # out-img fat-label file...
    local out="$1" label="$2"
    shift 2
    rm -f "${out}"
    truncate -s "${BOOT_SIZE_MIB}M" "${out}"
    mkfs.vfat -F 32 -n "${label}" "${out}" >/dev/null
    local f
    for f in "$@"; do
        mcopy -i "${out}" "${f}" ::/
    done
}

# Layout-v2 GPT with the real partition numbers, start sectors, labels, GUIDs
# and typecodes for p1..p5 (the ones the script's literal bootpart values point
# into) plus token-sized rootfs slots at the real p6 start so the numbering the
# script carries is the numbering the disk carries. The uenv pair sits at the
# same absolute offsets the binary's env contract uses.
ROOTFS_FIXTURE_SECTORS=16384 # 8 MiB: number and start matter here, size does not
mkdisk() { # out-img boot-a-slot-img boot-b-slot-img
    local out="$1" slota="$2" slotb="$3"
    rm -f "${out}"
    truncate -s 192M "${out}"
    sgdisk --clear -a 64 \
        -n "${LOADER_PARTNUM}:${LOADER_START_SECTOR}:$((LOADER_START_SECTOR + LOADER_SIZE_SECTORS - 1))" \
        -c "${LOADER_PARTNUM}:${LOADER_LABEL}" -t "${LOADER_PARTNUM}:${LOADER_TYPECODE}" -u "${LOADER_PARTNUM}:${LOADER_GUID}" \
        -n "${UENV_A_PARTNUM}:${UENV_A_START_SECTOR}:$((UENV_A_START_SECTOR + UENV_SIZE_SECTORS - 1))" \
        -c "${UENV_A_PARTNUM}:${UENV_A_LABEL}" -t "${UENV_A_PARTNUM}:${UENV_A_TYPECODE}" -u "${UENV_A_PARTNUM}:${UENV_A_GUID}" \
        -n "${UENV_B_PARTNUM}:${UENV_B_START_SECTOR}:$((UENV_B_START_SECTOR + UENV_SIZE_SECTORS - 1))" \
        -c "${UENV_B_PARTNUM}:${UENV_B_LABEL}" -t "${UENV_B_PARTNUM}:${UENV_B_TYPECODE}" -u "${UENV_B_PARTNUM}:${UENV_B_GUID}" \
        -n "${BOOT_A_PARTNUM}:${BOOT_A_START_SECTOR}:$((BOOT_A_START_SECTOR + BOOT_SIZE_MIB * MIB_BYTES / SECTOR_SIZE - 1))" \
        -c "${BOOT_A_PARTNUM}:${BOOT_A_LABEL}" -t "${BOOT_A_PARTNUM}:${BOOT_A_TYPECODE}" -u "${BOOT_A_PARTNUM}:${BOOT_A_GUID}" \
        -n "${BOOT_B_PARTNUM}:${BOOT_B_START_SECTOR}:$((BOOT_B_START_SECTOR + BOOT_SIZE_MIB * MIB_BYTES / SECTOR_SIZE - 1))" \
        -c "${BOOT_B_PARTNUM}:${BOOT_B_LABEL}" -t "${BOOT_B_PARTNUM}:${BOOT_B_TYPECODE}" -u "${BOOT_B_PARTNUM}:${BOOT_B_GUID}" \
        -n "${ROOTFS_A_PARTNUM}:${ROOTFS_A_START_SECTOR}:$((ROOTFS_A_START_SECTOR + ROOTFS_FIXTURE_SECTORS - 1))" \
        -c "${ROOTFS_A_PARTNUM}:${ROOTFS_A_LABEL}" -t "${ROOTFS_A_PARTNUM}:${ROOTFS_A_TYPECODE}" -u "${ROOTFS_A_PARTNUM}:${ROOTFS_A_GUID}" \
        -n "${ROOTFS_B_PARTNUM}:$((ROOTFS_A_START_SECTOR + ROOTFS_FIXTURE_SECTORS)):$((ROOTFS_A_START_SECTOR + 2 * ROOTFS_FIXTURE_SECTORS - 1))" \
        -c "${ROOTFS_B_PARTNUM}:${ROOTFS_B_LABEL}" -t "${ROOTFS_B_PARTNUM}:${ROOTFS_B_TYPECODE}" -u "${ROOTFS_B_PARTNUM}:${ROOTFS_B_GUID}" \
        "${out}" >/dev/null
    dd if="${slota}" of="${out}" bs=1M seek=$((BOOT_A_OFFSET_BYTES / MIB_BYTES)) conv=notrunc status=none
    dd if="${slotb}" of="${out}" bs=1M seek=$((BOOT_B_OFFSET_BYTES / MIB_BYTES)) conv=notrunc status=none
}

mkfatslot slot-a-complete.img "${BOOT_A_FAT_LABEL}" Image rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_A_NAME}"
mkfatslot slot-b-complete.img "${BOOT_B_FAT_LABEL}" Image rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_B_NAME}"
# The burn case: slot A ships NEITHER the suffixed nor the unsuffixed verity
# env, so both load attempts must fail and the script must zero A's credits.
mkfatslot slot-a-noverity.img "${BOOT_A_FAT_LABEL}" Image rk3576-src.dtb boot.scr

mkdisk disk-complete.img slot-a-complete.img slot-b-complete.img
mkdisk disk-noverity-a.img slot-a-noverity.img slot-b-complete.img

# Anti-vacuity: the fixtures must actually be what the scenarios claim.
check "complete slot A carries ${BOOT_VERITY_ENV_A_NAME}" \
    "$(mdir -i slot-a-complete.img -b ::/ | grep -cF "::/${BOOT_VERITY_ENV_A_NAME}")" 1
check "noverity slot A lacks ${BOOT_VERITY_ENV_A_NAME}" \
    "$(mdir -i slot-a-noverity.img -b ::/ | grep -cF "::/${BOOT_VERITY_ENV_A_NAME}")" 0
check "noverity slot A lacks the unsuffixed ${BOOT_VERITY_ENV_NAME} fallback too" \
    "$(mdir -i slot-a-noverity.img -b ::/ | grep -cF "::/${BOOT_VERITY_ENV_NAME}")" 0
check "boot.scr fixture is a legacy U-Boot image" \
    "$(od -An -tx1 -N4 boot.scr | tr -d ' \n')" 27051956

# --- environment seeding -----------------------------------------------------
# Only what the BOARD env provides and the script consumes: the load addresses.
# No BOOT_ORDER / BOOT_x_LEFT — every scenario starts on the script's own
# virgin-environment defaults. KERNEL_ADDR selects the cycle-ending mechanism:
#   0x02000000 (in RAM)      -> load succeeds, booti runs and fails natively
#   0xf0000000 (above 2 GiB) -> os_abort at load = "kernel accepted control"
seed_env() { # disk-img kernel-addr
    printf 'kernel_addr_r=%s\nfdt_addr_r=%s\n' "$2" 0x02800000 > env.txt
    "${MKENVIMAGE}" -r -s "$((UENV_SIZE_SECTORS * SECTOR_SIZE))" -o env.bin env.txt
    dd if=env.bin of="$1" bs=1M seek=$((UENV_A_OFFSET_BYTES / MIB_BYTES)) conv=notrunc status=none
    dd if=env.bin of="$1" bs=1M seek=$((UENV_B_OFFSET_BYTES / MIB_BYTES)) conv=notrunc status=none
}

# --- process invocations -----------------------------------------------------
# One boot cycle: run the shipped boot.scr the way the board's BOOTCOMMAND
# discovers it (both slots carry identical copies; the harness loads the p4
# copy, as bootmeth-script scan order would). argv[0] is pinned to an
# unexecutable path so the script's `reset` ends the process (see header).
BOOTCMD="load mmc 0:${BOOT_A_PARTNUM} 0x100000 ${BOOT_SCRIPT_NAME}; source 0x100000"
run_cycle() { # log-file -> echoes exit code
    local log="$1" rc=0
    timeout 120 bash -c 'exec -a /dev/null/mos-boot-cycle "$1" -d "$2" -c "$3"' _ \
        "${UBOOT}" "${DTB}" "${BOOTCMD}" </dev/null >"${log}" 2>&1 || rc=$?
    echo "${rc}"
}

# Reading the counters back is itself a separate process invocation against
# the same backing file — every readout is a cross-process persistence proof.
# printenv of an undefined variable exits non-zero; the parse handles absence.
read_env() {
    timeout 60 "${UBOOT}" -d "${DTB}" \
        -c 'printenv BOOT_A_LEFT; printenv BOOT_B_LEFT; printenv BOOT_ORDER' \
        </dev/null 2>&1 || true
}
assert_env() { # label wantA wantB
    # The trailing capture stops at the first non-digit: the sandbox console
    # colorizes its output and printenv lines end in an ANSI escape sequence.
    local out
    out="$(read_env)"
    check "$1: persisted BOOT_A_LEFT" "$(sed -n 's/^BOOT_A_LEFT=\([0-9]*\).*/\1/p' <<<"${out}")" "$2"
    check "$1: persisted BOOT_B_LEFT" "$(sed -n 's/^BOOT_B_LEFT=\([0-9]*\).*/\1/p' <<<"${out}")" "$3"
}
# A cycle must never fall off the end of the script (exit 0 would mean source
# returned, i.e. some command after booti was reached without a reset), and
# must never time out.
assert_cycle_rc() { # label rc
    case "$2" in
    0) echo "FAIL: $1: invocation exited 0 — boot.scr fell through"; FAILED=1 ;;
    124) echo "FAIL: $1: invocation timed out"; FAILED=1 ;;
    *) echo "PASS: $1: invocation ended by leaving U-Boot (rc=$2)" ;;
    esac
}

echo "=== scenario 1: watchdog decrement, failover at zero, refill when both are spent ==="
cp disk-complete.img mmc0.img
seed_env mmc0.img 0xf0000000
# cycle# slot A-after B-after expected-banner
S1_PLAN=(
    "1 A 2 3"
    "2 A 1 3"
    "3 A 0 3"
    "4 B 0 2"
    "5 B 0 1"
    "6 B 0 0"
)
for row in "${S1_PLAN[@]}"; do
    read -r n slot a b <<<"${row}"
    rc="$(run_cycle "s1-c${n}.log")"
    assert_cycle_rc "s1 cycle ${n}" "${rc}"
    log_has "s1 cycle ${n}" "s1-c${n}.log" "mos: booting slot ${slot} (A=${a} B=${b} left)"
    log_has "s1 cycle ${n}" "s1-c${n}.log" "Cannot map sandbox address"
    log_lacks "s1 cycle ${n}" "s1-c${n}.log" "mos: booti returned"
    log_lacks "s1 cycle ${n}" "s1-c${n}.log" "saveenv FAILED"
    assert_env "s1 cycle ${n}" "${a}" "${b}"
done
rc="$(run_cycle s1-c7.log)"
check "s1 cycle 7: exhaustion ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s1 cycle 7" s1-c7.log "mos: no bootable slot left, resetting attempt counters"
log_lacks "s1 cycle 7" s1-c7.log "mos: booting slot"
assert_env "s1 cycle 7: refill" 3 3
rc="$(run_cycle s1-c8.log)"
assert_cycle_rc "s1 cycle 8" "${rc}"
log_has "s1 cycle 8: post-refill boot restarts on slot A" s1-c8.log "mos: booting slot A (A=2 B=3 left)"
assert_env "s1 cycle 8" 2 3

echo "=== scenario 2: a slot without mos-verity-<slot>.env burns its credits ==="
cp disk-noverity-a.img mmc0.img
seed_env mmc0.img 0xf0000000
rc="$(run_cycle s2-c1.log)"
check "s2 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s2 cycle 1: decrement precedes the verity load" s2-c1.log "mos: booting slot A (A=2 B=3 left)"
log_has "s2 cycle 1" s2-c1.log "mos: slot A has no mos-verity-a.env"
assert_env "s2 cycle 1: burned" 0 3
rc="$(run_cycle s2-c2.log)"
assert_cycle_rc "s2 cycle 2" "${rc}"
log_has "s2 cycle 2: next boot moves to slot B" s2-c2.log "mos: booting slot B (A=0 B=2 left)"
log_has "s2 cycle 2: slot B's own verity env loads fine" s2-c2.log "Cannot map sandbox address"
log_lacks "s2 cycle 2" s2-c2.log "has no mos-verity"
assert_env "s2 cycle 2" 0 2

echo "=== scenario 3: booti returns (native sandbox failure) = slot did not boot ==="
cp disk-complete.img mmc0.img
seed_env mmc0.img 0x02000000
rc="$(run_cycle s3-c1.log)"
check "s3 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s3 cycle 1" s3-c1.log "mos: booting slot A (A=2 B=3 left)"
log_has "s3 cycle 1: booti fails natively on sandbox" s3-c1.log "Booting is not supported on the sandbox."
log_has "s3 cycle 1: the script sees booti return and burns the slot" s3-c1.log "mos: booti returned, slot A is bad"
assert_env "s3 cycle 1" 0 3

if [ "${FAILED}" -eq 0 ]; then
    echo "RESULT: PASS"
else
    echo "RESULT: FAIL"
    exit 1
fi
