#!/usr/bin/env bash
# mos-build-side: container -- run.sh starts the sandbox U-Boot image and invokes this
# with `docker run ... bash /repo/tests/handshake-test/harness.sh`; the mkimage it drives
# is ${MKIMAGE} out of that image's cache, which no scan can resolve from the text.
set -euo pipefail

# Offline U-Boot A/B handshake harness, container side.
#
# Runs inside the image tests/handshake-test/Dockerfile builds (started by
# run.sh). Executes the shipped boards/cx3576/boot.cmd -- compiled by the
# same `mkimage -T script` invocation the assembler uses, byte-unmodified --
# under a U-Boot v2026.07 sandbox binary (same source pin as the board build)
# against a A/B-layout GPT disk image backed by a host file, and asserts the
# whole A/B handshake state machine across separate process invocations.

# Execution model: one process invocation = one boot cycle. Three facts of the
# sandbox port make this work, all verified against the pinned source.

#  1. Persistence. The sandbox mmc driver mmaps its `filename` backing file
#     MAP_SHARED, and the binary carries the board's env contract (redundant
#     env at 0x1000000/0x1100000 on mmc 0), so the script's own saveenv lands
#     in mmc0.img and is read back by the next process -- the same lifecycle
#     as eMMC across board resets.

#  2. Reset terminates. `reset` on sandbox re-execs argv[0] (sandbox_reset ->
#     os_relaunch -> execv). The harness invokes the binary with argv[0] pinned
#     to /dev/null/mos-boot-cycle (bash `exec -a`), a path that can never exec,
#     so the relaunch fails and the process exits 1: a reset ends the
#     invocation instead of looping forever inside it. The next invocation is
#     the post-reset boot.

#  3. "Kernel accepted control" is NOT modelled, and cannot be. On sandbox,
#     booti can never hand over control (booti_setup() fails unconditionally),
#     so a cycle that reaches booti always falls through to the script's
#     burn-the-slot tail. EVERY other path in the script burns too. So every
#     cycle here ends in a burn, and the only ending that is not one is the
#     refill.

#     This is a LOSS, taken deliberately under RFCT-352, and it is worth
#     stating what it cost. Until the load guard landed, this harness modelled
#     the handoff by pointing kernel_addr_r above the sandbox's 2048 MiB RAM,
#     and read the resulting os_abort() as "control left U-Boot" after the
#     decrement's saveenv and before the burn -- which produced the watchdog's
#     3->2->1->0 decrement trajectory across real process invocations.
#     Measured while extending this file: that abort never came from the load.
#     With CONFIG_LMB=y -- sandbox's default, and not optional, since CMD_BOOTI
#     will not build without it -- fs_read_lmb_check() refuses an out-of-RAM
#     read before writing anything and `load` returns FAILURE; the abort came
#     from the NEXT line, `booti` mapping an address nothing had been loaded
#     to. The model worked only because the script ignored a failed load, which
#     is the defect the guard closes. A guarded script refuses that slot, so
#     the trajectory is no longer reachable on sandbox at all.

#     What still holds, and what scenario 1 now asserts instead: the decrement
#     is persisted BEFORE the boot attempt (two separate env writes per cycle,
#     the decrement's and the burn's, in that order), a spent slot fails over
#     to the other one, both spent refills to three, and the refilled device
#     restarts at the head of BOOT_ORDER. What is no longer covered anywhere is
#     a slot being given its three attempts across three resets, because
#     nothing on sandbox can end a cycle without burning the slot.

# Everything is written under the cwd (a private workspace mounted at /work);
# nothing else. Offline: no network use at all.

REPO=/repo
CACHE=/cache
UBOOT="${CACHE}/u-boot"
DTB="${CACHE}/u-boot.dtb"
MKIMAGE="${CACHE}/mkimage"
MKENVIMAGE="${CACHE}/mkenvimage"
BOOT_CMD="${REPO}/boards/cx3576/boot.cmd"

# shellcheck source=../../boards/cx3576/board.env
. "${REPO}/boards/cx3576/board.env"

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

# --- fixtures (synthetic)
# boot.scr is the real contract artifact: the shipped source through the same
# mkimage invocation the assembler uses. The line below is
# `mkimage -T script -C none -n "mos boot" -d $BOOT_CMD boot.scr`, and
# build/src/tools/mkimage.ts's `bootScriptArgs` returns
# ['mkimage','-T','script','-C','none','-n',name,'-d',input,output] -- argv-identical.

# One residual, recorded rather than fixed: `makeBootScript` sets and validates
# SOURCE_DATE_EPOCH -- mkimage silently falls back to the wall clock without
# it, so an unvalidated value is a boot script that rebuilds differently every
# time -- and this harness sets it nowhere. The two therefore produce different
# bytes, and "same invocation" must not be read here as "same output". It does
# not weaken what this harness tests: the U-Boot sandbox executes the script's
# content, and the header timestamp it differs in is not part of that.
"${MKIMAGE}" -T script -C none -n "mos boot" -d "${BOOT_CMD}" boot.scr >/dev/null
fill Image $((4 * 1024 * 1024)) K
fill rk3576-src.dtb $((64 * 1024)) D
for slot in a b; do
    printf 'verity_args=dm-mod.create="mos,,0,ro,0 6144 verity 1 PARTUUID=fixture-%s PARTUUID=fixture-%s 4096 4096 768 768 sha256 1111 2222" dm-mod.waitfor=PARTUUID=fixture-%s\n' \
        "${slot}" "${slot}" "${slot}" > "mos-verity-${slot}.env"
done

# The digests boot.scr checks the loaded Image and dtb against, in the two
# spellings U-Boot compares: `load` publishes ${filesize} through env_set_hex
# ("%lx" -- lowercase, unprefixed, unpadded) and `crc32 -v` reads eight hex
# digits. Computed here with python3's zlib.crc32, which is the same CRC-32
# U-Boot's crc32 computes, and deliberately NOT with the assembler's
# TypeScript: build/src/boot-cx3576.ts is the producer this script has to agree
# with, so a fixture built by calling it would agree with it by construction.
digest_env() { # out-file artefact...   (in BOOT_DIGEST_ARTEFACTS order)
    python3 - "$@" <<'PY'
import sys, zlib
out, *files = sys.argv[1:]
with open(out, 'w') as fh:
    for key, path in zip(['kernel', 'fdt'], files):
        data = open(path, 'rb').read()
        fh.write('%s_bytes=%x\n' % (key, len(data)))
        fh.write('%s_crc=%08x\n' % (key, zlib.crc32(data)))
PY
}
digest_env "${BOOT_DIGEST_ENV_NAME}" Image rk3576-src.dtb

# The two ways a slot can carry an Image that is not the one its digest
# describes, one per assertion in the script.
#   mixed  -- SAME LENGTH, different bytes in the middle. This is the shape of
#             the failure that was measured on hardware: the console reported
#             the full 44493312 bytes read while DRAM held a mixture of two
#             kernel builds. Only the checksum can see it.
#   short  -- fewer bytes than the digest records, which ${filesize} alone sees.
mkdir -p mixed short
cp Image mixed/Image
printf 'STALE-BYTES-FROM-ANOTHER-BUILD' \
    | dd of=mixed/Image bs=1 seek=$((2 * 1024 * 1024)) conv=notrunc status=none
head -c $((4 * 1024 * 1024 - 4096)) Image > short/Image

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

# A/B-layout GPT with the real partition numbers, start sectors, labels, GUIDs
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

mkfatslot slot-a-complete.img "${BOOT_A_FAT_LABEL}" Image rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_A_NAME}" "${BOOT_DIGEST_ENV_NAME}"
mkfatslot slot-b-complete.img "${BOOT_B_FAT_LABEL}" Image rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_B_NAME}" "${BOOT_DIGEST_ENV_NAME}"
# The burn case: slot A ships NEITHER the suffixed nor the unsuffixed verity
# env, so both load attempts must fail and the script must zero A's credits.
# Everything else about the slot is complete, including the digest file, so the
# scenario has exactly one fault in it.
mkfatslot slot-a-noverity.img "${BOOT_A_FAT_LABEL}" Image rk3576-src.dtb boot.scr "${BOOT_DIGEST_ENV_NAME}"
# The three ways the load guard must refuse. Each carries ONE fault: an Image
# that is the recorded length and not the recorded bytes, an Image that is
# short, and a slot with no digest file to check anything against.
mkfatslot slot-a-mixed.img "${BOOT_A_FAT_LABEL}" mixed/Image rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_A_NAME}" "${BOOT_DIGEST_ENV_NAME}"
mkfatslot slot-a-short.img "${BOOT_A_FAT_LABEL}" short/Image rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_A_NAME}" "${BOOT_DIGEST_ENV_NAME}"
mkfatslot slot-a-nodigest.img "${BOOT_A_FAT_LABEL}" Image rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_A_NAME}"
# And the branch that fires when there is nothing to load: a complete slot
# minus the kernel. It is here rather than in scenario 1 because scenario 1's
# out-of-RAM address does not reach it -- the sandbox aborts on the unmappable
# write instead (see the LMB note in the header).
mkfatslot slot-a-noimage.img "${BOOT_A_FAT_LABEL}" rk3576-src.dtb boot.scr "${BOOT_VERITY_ENV_A_NAME}" "${BOOT_DIGEST_ENV_NAME}"

mkdisk disk-complete.img slot-a-complete.img slot-b-complete.img
mkdisk disk-noverity-a.img slot-a-noverity.img slot-b-complete.img
mkdisk disk-mixed-a.img slot-a-mixed.img slot-b-complete.img
mkdisk disk-short-a.img slot-a-short.img slot-b-complete.img
mkdisk disk-nodigest-a.img slot-a-nodigest.img slot-b-complete.img
mkdisk disk-noimage-a.img slot-a-noimage.img slot-b-complete.img

# Anti-vacuity: the fixtures must actually be what the scenarios claim.
check "complete slot A carries ${BOOT_VERITY_ENV_A_NAME}" \
    "$(mdir -i slot-a-complete.img -b ::/ | grep -cF "::/${BOOT_VERITY_ENV_A_NAME}")" 1
check "noverity slot A lacks ${BOOT_VERITY_ENV_A_NAME}" \
    "$(mdir -i slot-a-noverity.img -b ::/ | grep -cF "::/${BOOT_VERITY_ENV_A_NAME}")" 0
check "noverity slot A lacks the unsuffixed ${BOOT_VERITY_ENV_NAME} fallback too" \
    "$(mdir -i slot-a-noverity.img -b ::/ | grep -cF "::/${BOOT_VERITY_ENV_NAME}")" 0
check "boot.scr fixture is a legacy U-Boot image" \
    "$(od -An -tx1 -N4 boot.scr | tr -d ' \n')" 27051956
check "complete slot A carries ${BOOT_DIGEST_ENV_NAME}" \
    "$(mdir -i slot-a-complete.img -b ::/ | grep -cF "::/${BOOT_DIGEST_ENV_NAME}")" 1
check "nodigest slot A lacks ${BOOT_DIGEST_ENV_NAME}" \
    "$(mdir -i slot-a-nodigest.img -b ::/ | grep -cF "::/${BOOT_DIGEST_ENV_NAME}")" 0
check "noimage slot A lacks Image and keeps everything else" \
    "$(mdir -i slot-a-noimage.img -b ::/ | grep -cF "::/Image")" 0
check "noimage slot A still carries its digest file" \
    "$(mdir -i slot-a-noimage.img -b ::/ | grep -cF "::/${BOOT_DIGEST_ENV_NAME}")" 1
# The mixed fixture is the whole point of the crc32 assertion, so the two facts
# that make it one are asserted rather than assumed: SAME length, DIFFERENT
# bytes. A `cp` that silently produced an identical file would make scenario 4
# pass by booting, not by refusing.
check "mixed Image is the same length as the digested one" \
    "$(stat -c %s mixed/Image)" "$(stat -c %s Image)"
check "mixed Image differs from the digested one" \
    "$(cmp -s mixed/Image Image && echo same || echo differs)" differs
check "short Image is shorter than the digested one" \
    "$( [ "$(stat -c %s short/Image)" -lt "$(stat -c %s Image)" ] && echo shorter || echo not)" shorter
# And the digest file must actually describe the pristine pair, or every
# scenario below burns for the wrong reason.
check "the digest records the Image's real length" \
    "$(sed -n 's/^kernel_bytes=//p' "${BOOT_DIGEST_ENV_NAME}")" \
    "$(printf '%x' "$(stat -c %s Image)")"
check "the digest records the dtb's real length" \
    "$(sed -n 's/^fdt_bytes=//p' "${BOOT_DIGEST_ENV_NAME}")" \
    "$(printf '%x' "$(stat -c %s rk3576-src.dtb)")"
check "the digest's checksums are eight hex digits" \
    "$(grep -c '^[a-z]*_crc=[0-9a-f]\{8\}$' "${BOOT_DIGEST_ENV_NAME}")" 2

# The two checksums the passing cycles print, read back out of the fixture
# rather than written down: the fixture files are generated, so a literal here
# would be a second statement of a value this script already computed.
KERNEL_CRC="$(sed -n 's/^kernel_crc=//p' "${BOOT_DIGEST_ENV_NAME}")"
FDT_CRC="$(sed -n 's/^fdt_crc=//p' "${BOOT_DIGEST_ENV_NAME}")"
check "the fixture digest yielded a kernel checksum" "${#KERNEL_CRC}" 8
check "the fixture digest yielded a dtb checksum" "${#FDT_CRC}" 8

# --- environment seeding
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

# --- process invocations
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
# Every cycle now ends the same way -- a burn or a refill, both of which call
# `reset`, which the poisoned argv[0] turns into exit 1 -- so each one is
# checked against that exact code rather than against "not 0 and not 124". It
# is the stronger statement and it subsumes both: exit 0 would mean boot.scr
# fell through past booti without resetting, and 124 would mean the invocation
# hung. The helper that made the weaker check no longer has a caller: nothing
# on sandbox can end a cycle by leaving U-Boot any more (see note 3 above).

echo "=== scenario 1: failover at zero, refill when both are spent, restart at the head ==="
# A COMPLETE disk, so every cycle gets all the way to booti and burns there.
# The banner is what shows the decrement -- "A=2" is the value the script wrote
# and persisted before it touched the slot -- and the counter read back
# afterwards is what the burn left. Both matter, and they are different
# numbers on purpose.
cp disk-complete.img mmc0.img
seed_env mmc0.img 0x02000000
# cycle# slot banner-A banner-B persisted-A persisted-B
S1_PLAN=(
    "1 A 2 3 0 3"
    "2 B 0 2 0 0"
)
for row in "${S1_PLAN[@]}"; do
    read -r n slot ba bb pa pb <<<"${row}"
    rc="$(run_cycle "s1-c${n}.log")"
    check "s1 cycle ${n}: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
    log_has "s1 cycle ${n}: the decremented counter is announced" "s1-c${n}.log" \
        "mos: booting slot ${slot} (A=${ba} B=${bb} left)"
    log_has "s1 cycle ${n}: both artefacts verify against the digest" "s1-c${n}.log" \
        "crc32 ${KERNEL_CRC} verified in DRAM"
    log_has "s1 cycle ${n}: and the slot burns on booti, not on the guard" "s1-c${n}.log" \
        "mos: booti returned, slot ${slot} is bad"
    log_lacks "s1 cycle ${n}" "s1-c${n}.log" "saveenv FAILED"
    # DECREMENT-THEN-SAVE-THEN-BOOT (design section 4.2), read off the console:
    # two environment writes per cycle, the decrement's before the banner and
    # the burn's after it. One write would mean the attempt was never counted.
    check "s1 cycle ${n}: the environment is written twice, decrement then burn" \
        "$(grep -c 'Saving Environment to MMC' "s1-c${n}.log")" 2
    check "s1 cycle ${n}: and the first write precedes the boot attempt" \
        "$(grep -n 'Saving Environment to MMC\|mos: booting slot' "s1-c${n}.log" | head -1 | grep -c 'Saving Environment')" 1
    assert_env "s1 cycle ${n}" "${pa}" "${pb}"
done
rc="$(run_cycle s1-c3.log)"
check "s1 cycle 3: exhaustion ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s1 cycle 3" s1-c3.log "mos: no bootable slot left, resetting attempt counters"
log_lacks "s1 cycle 3" s1-c3.log "mos: booting slot"
assert_env "s1 cycle 3: refill" 3 3
rc="$(run_cycle s1-c4.log)"
check "s1 cycle 4: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s1 cycle 4: post-refill boot restarts on slot A" s1-c4.log "mos: booting slot A (A=2 B=3 left)"
assert_env "s1 cycle 4" 0 3

echo "=== scenario 2: a slot without mos-verity-<slot>.env burns its credits ==="
cp disk-noverity-a.img mmc0.img
seed_env mmc0.img 0x02000000
rc="$(run_cycle s2-c1.log)"
check "s2 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s2 cycle 1: decrement precedes the verity load" s2-c1.log "mos: booting slot A (A=2 B=3 left)"
log_has "s2 cycle 1" s2-c1.log "mos: slot A has no mos-verity-a.env"
log_lacks "s2 cycle 1: the verity env is missing, so nothing is loaded to check" s2-c1.log "verified in DRAM"
assert_env "s2 cycle 1: burned" 0 3
rc="$(run_cycle s2-c2.log)"
check "s2 cycle 2: slot B reaches booti and burns there" "${rc}" 1
log_has "s2 cycle 2: next boot moves to slot B" s2-c2.log "mos: booting slot B (A=0 B=2 left)"
log_has "s2 cycle 2: slot B's own verity env loads fine" s2-c2.log "verified in DRAM"
log_lacks "s2 cycle 2" s2-c2.log "has no mos-verity"
assert_env "s2 cycle 2" 0 0

echo "=== scenario 3: booti returns (native sandbox failure) = slot did not boot ==="
cp disk-complete.img mmc0.img
seed_env mmc0.img 0x02000000
rc="$(run_cycle s3-c1.log)"
check "s3 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s3 cycle 1" s3-c1.log "mos: booting slot A (A=2 B=3 left)"
# The POSITIVE control for the load guard, and it belongs here rather than in a
# scenario of its own: this is the only cycle that gets past both verifications
# to booti, so these two lines are the evidence that the guard passes a good
# slot instead of refusing everything.
log_has "s3 cycle 1: the Image verifies against the digest" s3-c1.log \
    "mos: Image 400000 bytes, crc32 ${KERNEL_CRC} verified in DRAM"
log_has "s3 cycle 1: the dtb verifies too" s3-c1.log \
    "mos: rk3576-src.dtb 10000 bytes, crc32 ${FDT_CRC} verified in DRAM"
log_has "s3 cycle 1: booti fails natively on sandbox" s3-c1.log "Booting is not supported on the sandbox."
log_has "s3 cycle 1: the script sees booti return and burns the slot" s3-c1.log "mos: booti returned, slot A is bad"
assert_env "s3 cycle 1" 0 3

# The load guard, three ways. KERNEL_ADDR is IN RAM for all three: the whole
# point is that `load` succeeds -- as it did on the board, reporting the full
# byte count -- and that the script refuses anyway. Every one of them must also
# NOT reach booti: a burn that happened because booti returned would be the
# pre-existing tail firing, not the new guard, and the two are told apart by
# which line the log carries.
echo "=== scenario 4: an Image of the RIGHT LENGTH and the wrong bytes burns the slot ==="
cp disk-mixed-a.img mmc0.img
seed_env mmc0.img 0x02000000
rc="$(run_cycle s4-c1.log)"
check "s4 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s4 cycle 1: decrement precedes the load" s4-c1.log "mos: booting slot A (A=2 B=3 left)"
log_has "s4 cycle 1: crc32 -v reports the mismatch" s4-c1.log "** ERROR **"
log_has "s4 cycle 1: the script names the slot and the fault" s4-c1.log \
    "mos: slot A p${BOOT_A_PARTNUM}: Image:"
log_has "s4 cycle 1: and names the checksum as the failing half" s4-c1.log "crc32 is not"
log_lacks "s4 cycle 1: the SIZE was fine, so that half must not fire" s4-c1.log "bytes landed, mos-boot-digest.env says"
log_lacks "s4 cycle 1: the kernel was never handed control" s4-c1.log "mos: booti returned"
assert_env "s4 cycle 1: burned" 0 3
rc="$(run_cycle s4-c2.log)"
check "s4 cycle 2: slot B reaches booti and its burn resets too" "${rc}" 1
log_has "s4 cycle 2: next boot moves to slot B" s4-c2.log "mos: booting slot B (A=0 B=2 left)"
log_has "s4 cycle 2: slot B's own Image verifies -- the guard passes a good slot" s4-c2.log \
    "crc32 ${KERNEL_CRC} verified in DRAM"
# kernel_addr_r is in RAM for this scenario, so B gets past both verifications
# to booti, which cannot hand over control on sandbox: B burns on the
# pre-existing tail, by a DIFFERENT line from A's. Both counters at zero is the
# correct end state, not a second digest refusal.
log_has "s4 cycle 2: and B burns on booti, not on the digest" s4-c2.log "mos: booti returned, slot B is bad"
assert_env "s4 cycle 2" 0 0

echo "=== scenario 5: a SHORT Image burns the slot, named as a short read ==="
cp disk-short-a.img mmc0.img
seed_env mmc0.img 0x02000000
rc="$(run_cycle s5-c1.log)"
check "s5 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s5 cycle 1: the size compare is what fires" s5-c1.log \
    "mos: slot A p${BOOT_A_PARTNUM}: Image: 3ff000 bytes landed, mos-boot-digest.env says 400000"
log_lacks "s5 cycle 1: and it fires BEFORE the checksum, which never runs" s5-c1.log "** ERROR **"
log_lacks "s5 cycle 1: the kernel was never handed control" s5-c1.log "mos: booti returned"
assert_env "s5 cycle 1: burned" 0 3

echo "=== scenario 6: a slot with no mos-boot-digest.env burns its credits ==="
cp disk-nodigest-a.img mmc0.img
seed_env mmc0.img 0x02000000
rc="$(run_cycle s6-c1.log)"
check "s6 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s6 cycle 1: its own verity env loaded fine, so this is the digest file" s6-c1.log \
    "mos: slot A p${BOOT_A_PARTNUM}: no mos-boot-digest.env beside Image"
log_lacks "s6 cycle 1" s6-c1.log "has no mos-verity"
log_lacks "s6 cycle 1: nothing was loaded, let alone booted" s6-c1.log "mos: booti returned"
assert_env "s6 cycle 1: burned" 0 3
rc="$(run_cycle s6-c2.log)"
check "s6 cycle 2: slot B reaches booti and its burn resets too" "${rc}" 1
log_has "s6 cycle 2: next boot moves to slot B" s6-c2.log "mos: booting slot B (A=0 B=2 left)"
log_has "s6 cycle 2: B has a digest file and gets past it to booti" s6-c2.log "mos: booti returned, slot B is bad"
assert_env "s6 cycle 2" 0 0

echo "=== scenario 7: a slot with no Image at all burns its credits ==="
cp disk-noimage-a.img mmc0.img
seed_env mmc0.img 0x02000000
rc="$(run_cycle s7-c1.log)"
check "s7 cycle 1: burn ends in a reset (exit 1 via poisoned re-exec)" "${rc}" 1
log_has "s7 cycle 1: the load failure is named, not the checksum" s7-c1.log \
    "mos: slot A p${BOOT_A_PARTNUM}: Image would not load"
log_lacks "s7 cycle 1: and nothing was compared" s7-c1.log "** ERROR **"
log_lacks "s7 cycle 1: the kernel was never handed control" s7-c1.log "mos: booti returned"
assert_env "s7 cycle 1: burned" 0 3

if [ "${FAILED}" -eq 0 ]; then
    echo "RESULT: PASS"
else
    echo "RESULT: FAIL"
    exit 1
fi
