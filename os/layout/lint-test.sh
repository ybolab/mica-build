#!/usr/bin/env bash
# Prove os/layout/lint.sh rejects a broken board definition.
#
# WHY. A linter that has only ever been observed passing is not evidence, and
# this one proved the point about itself: its first version printed FAIL lines
# and then reported "RESULT: PASS (0/0 checks)", because the counters lived in
# a subshell that discarded them. It was green while being wrong, which is the
# failure it exists to catch.
#
# Each case mutates a COPY of a real layout in one specific way and asserts
# that lint.sh (a) exits non-zero and (b) says something that names the actual
# problem. The second half matters: an exit code alone would pass for a linter
# that rejects everything, and the message is what an engineer reads.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT="${HERE}/lint.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
RAN=""
ok() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
no() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*" >&2; }

# Run the linter on a mutated copy; assert it rejects, and name what it must say.
reject() {
    local name="$1" src="$2" want="$3" mutate="$4" out rc=0
    RAN="${RAN} ${name}"
    cp "${HERE}/${src}" "${WORK}/lint-v2.env"
    ( cd "${WORK}" && eval "${mutate}" )
    out="$(bash "${LINT}" "${WORK}/lint-v2.env" 2>&1)" || rc=$?
    if [ "${rc}" -eq 0 ]; then
        no "${name}: lint.sh ACCEPTED a layout it must reject"
        return
    fi
    if ! grep -qF "${want}" <<<"${out}"; then
        no "${name}: rejected, but no message contained '${want}'. Said: $(tr '\n' ' ' <<<"${out}")"
        return
    fi
    ok "${name}: rejected, and the message names it"
}

# THE CASE THIS LINTER WAS WRITTEN FOR. x64 carried BOOT_ATTEMPTS_DEFAULT=3
# under a comment claiming grub's contract matches U-Boot's. It does not, RAUC
# refuses the rendered configuration, and rauc.service exits 1 on the device.
reject boot-attempts-on-grub x64-v2.env \
    "RAUC refuses a grub configuration that sets boot attempts" \
    "printf 'BOOT_ATTEMPTS_DEFAULT=3\n' >> lint-v2.env"

reject grub-without-grubenv x64-v2.env \
    "no RAUC_GRUBENV" \
    "sed -i '/^RAUC_GRUBENV=/d' lint-v2.env"

reject uboot-without-attempts cx3576-v2.env \
    "no BOOT_ATTEMPTS_DEFAULT is declared" \
    "sed -i '/^BOOT_ATTEMPTS_DEFAULT=/d' lint-v2.env"

reject no-partition-set x64-v2.env \
    "declares no LAYOUT_PARTITIONS" \
    "sed -i '/^LAYOUT_PARTITIONS=/d' lint-v2.env"

reject missing-role-key x64-v2.env \
    "declares no BOOT_A_FAT_VOLUME_ID" \
    "sed -i '/^BOOT_A_FAT_VOLUME_ID=/d' lint-v2.env"

reject forbidden-role-key x64-v2.env \
    "which that role cannot honour" \
    "printf 'ROOTFS_A_FS_UUID=00000000-0000-4000-8000-000000000000\n' >> lint-v2.env"

reject unknown-role x64-v2.env \
    "is not one of" \
    "sed -i 's/^STATE_ROLE=ext4/STATE_ROLE=btrfs/' lint-v2.env"

reject missing-common-key x64-v2.env \
    "declares no META_GUID" \
    "sed -i '/^META_GUID=/d' lint-v2.env"

reject partition-number-gap x64-v2.env \
    "these numbers are absent" \
    "sed -i 's/^DATA_PARTNUM=8/DATA_PARTNUM=9/' lint-v2.env"

reject duplicate-partition-number x64-v2.env \
    "is declared twice" \
    "sed -i 's/^STATE_PARTNUM=6/STATE_PARTNUM=5/' lint-v2.env"

# One fact in three units. cx3576 spells a start as MiB, as a sector AND as a
# byte offset, as three independent literals; nothing tied them together until
# this check, and three literals can drift apart one edit at a time.
reject start-units-disagree cx3576-v2.env \
    "disagree" \
    "sed -i 's/^BOOT_A_START_SECTOR=36864/BOOT_A_START_SECTOR=36865/' lint-v2.env"

reject offset-units-disagree cx3576-v2.env \
    "disagree" \
    "sed -i 's/^BOOT_A_OFFSET_BYTES=18874368/BOOT_A_OFFSET_BYTES=18874369/' lint-v2.env"

reject no-arch x64-v2.env \
    "declares no MOS_ARCH" \
    "sed -i '/^MOS_ARCH=/d' lint-v2.env"

reject bad-status-led x64-v2.env \
    "it must be 0 or 1" \
    "sed -i 's/^BOARD_HAS_STATUS_LED=0/BOARD_HAS_STATUS_LED=no/' lint-v2.env"

# The other direction: the shipped layouts must PASS. Without this the suite
# would be satisfied by a linter that rejects everything.
for board in cx3576 x64; do
    RAN="${RAN} accepts-${board}"
    if bash "${LINT}" "${HERE}/${board}-v2.env" >/dev/null 2>&1; then
        ok "accepts-${board}: the shipped layout passes"
    else
        no "accepts-${board}: lint.sh REJECTS the shipped layout"
    fi
done

# The set that ran, declared by identity and diffed against what happened.
# "12 passed" and "9 passed, 3 never ran" are the same number to a reader, and
# a suite cut short does not fail loudly -- it tests fewer cases and reports
# green on the ones it reached.
EXPECTED="accepts-cx3576 accepts-x64 bad-status-led boot-attempts-on-grub
duplicate-partition-number forbidden-role-key grub-without-grubenv
missing-common-key missing-role-key no-arch no-partition-set
offset-units-disagree partition-number-gap start-units-disagree
unknown-role uboot-without-attempts"
got="$(tr ' ' '\n' <<<"${RAN}" | grep -v '^$' | sort | tr '\n' ' ')"
want="$(tr ' \n' '\n\n' <<<"${EXPECTED}" | grep -v '^$' | sort | tr '\n' ' ')"
if [ "${got}" = "${want}" ]; then
    ok "the cases that ran are exactly the cases declared"
else
    no "case set drift — ran: ${got}| declared: ${want}"
fi

TOTAL=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${TOTAL} checks)"
    exit 0
fi
echo "RESULT: FAIL (${PASS_N}/${TOTAL} checks)" >&2
exit 1
