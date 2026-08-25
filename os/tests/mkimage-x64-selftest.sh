#!/usr/bin/env bash
# Drives the REAL os/mkimage-x64.sh over fabricated inputs, so the x64 assembler
# can be exercised without a BSP, without os/rootfs/build-v2.sh, without a built
# image and without root. The sibling instrument for cx3576 is
# os/tests/mkimage-v2-selftest.sh and this file is deliberately its shape;
# RFCT-086 keeps both in the cheap CI lane -- minutes and a docker socket --
# next to the image-pipeline lane that needs a built image.
#
# WHY IT EXISTS SEPARATELY FROM THE PORT IT PRECEDES. PLAN-014 M6c ports this
# assembler to TypeScript and will gate that port on byte-identity. A
# byte-identity gate CANNOT SEE A DROPPED REFUSAL: a port that quietly loses the
# ESP cluster-count floor still produces identical bytes for a good input and
# passes the gate perfectly, and the failure it stopped catching is a machine
# sitting at the UEFI shell with no console output to explain it. Five of the
# behaviours below are of exactly that kind. So the instrument comes first, and
# M6c's scope stays "port it" rather than "port it, and also write the test that
# should have existed".
#
# WHAT IT DRIVES, AND FROM WHICH SIDE. Two halves:
#
#   The image, read back. Two assemblies must hash equal, and the result must
#   carry the nine partitions, GUIDs, typecodes, start sectors, FAT payloads,
#   ext4 labels and root listings os/boards/x64/board.env pins.
#
#   The refusals, driven FROM THE FAILING SIDE. Every guard below is mutated
#   until it SHOULD fire and required to fire WITH ITS OWN MESSAGE -- not merely
#   to exit non-zero, and not merely to print something. A guard that has only
#   ever been observed passing is not evidence that it still can fail; the whole
#   reason these guards exist is that none of the failures they catch announce
#   itself at build time.
#
# THE ASSERTION IDENTITIES ARE NAMED, NOT COUNTED. REFUSALS below is a register
# of every refusal this file drives, each with the substring that identifies it
# and the file that substring must live in. Two things hang off it. Before
# anything is assembled, every registered substring is required to appear
# VERBATIM in the shipped script -- so a register naming a message the code can
# no longer produce fails here instead of quietly asserting nothing (that exact
# case was found in this repository's other instruments earlier in this
# campaign, twice). And every negative case declares the SET of identities it
# expects, which the harness diffs against the set that actually fired -- so a
# case that trips the wrong guard on the way to the one it meant to test is a
# FAIL rather than a pass. os/tests/ui-location-test.sh is the reference for
# this discipline and says at length why a PASS count is not a substitute.
#
# BYTE-IDENTITY IS ASSERTED AS IDENTITY, NEVER AS A DELTA. The single seeding-
# time defect RFCT-106 closed measured 465, 467, 562 or 925 differing bytes
# depending only on the gap between the two assemblies and on whether relatime
# had bumped the fixture's atimes in the last 24 hours -- `cmp -l` counts BYTES,
# and how many bytes of a four-byte epoch differ is a function of the clock. A
# test that pinned a number would be flaky for a reason that has nothing to do
# with the code. Hashes are compared; the per-MiB block list is printed only as
# a DIAGNOSTIC when they differ, and nothing asserts anything about its size.
#
# THE FIXTURE IS REBUILT ON EVERY RUN, and that is load-bearing rather than
# tidy. `cp -a` preserves the source's atime and the first read of a tree whose
# atime is older than a day is itself what bumps it, so a fixture built fresh
# and stamped into the past has assembly 1 and assembly 2 seeding EPHEMERAL from
# two DIFFERENT atimes -- the harder case, and the one a machine that has not
# built today is in. A fixture reused within 24 hours has that class quiescent
# and the byte comparison silently tests less. This file measures the bump
# rather than assuming it: "the atime class was live" below FAILS if the two
# assemblies were handed the same atime, because then the identity they agree on
# would be an identity nothing was ever asked about.
#
# WHY IT ASSEMBLES IN A COPIED TREE. os/mkimage-v2.sh takes every input from the
# environment, so its selftest can point it at a workspace. os/mkimage-x64.sh
# takes NONE: it derives its layout, its grub.cfg and its output directory from
# its own ${BASH_SOURCE[0]}. Running it in place would write into the
# developer's real _out/x64 and could not mutate board.env to drive a refusal
# without editing a tracked file. So the four files it reads are COPIED into a
# workspace tree, byte-identity of the copies is asserted, and every mutation
# below happens to the copy. The script under test is the shipped one; only its
# surroundings are fabricated.
#
# Everything is created under a private ${TMPDIR} workspace; nothing outside it
# is written and no host system state is touched. It fails loudly when it cannot
# run rather than skipping.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS_DIR="$(dirname "${SCRIPT_DIR}")"
REPO_ROOT="$(dirname "${OS_DIR}")"
ASSEMBLER="${OS_DIR}/mkimage-x64.sh"
COMMON="${OS_DIR}/mkimage-common.sh"
LAYOUT_ENV="${OS_DIR}/boards/x64/board.env"
GRUB_CFG_IN="${OS_DIR}/boards/x64/grub.cfg"

for required in "${ASSEMBLER}" "${COMMON}" "${LAYOUT_ENV}" "${GRUB_CFG_IN}"; do
    [ -f "${required}" ] || { echo "error: ${required} not found" >&2; exit 1; }
done
# shellcheck source=../boards/x64/board.env
. "${LAYOUT_ENV}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

FAILED=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); echo "PASS: $1"; }
fail() { FAILED=1; echo "FAIL: $1"; }
check() {
    if [ "$2" = "$3" ]; then
        pass "$1"
    else
        fail "$1 (expected '$3', got '$2')"
    fi
}

# Deterministic filler: the same byte repeated, so a rebuild sees identical
# input bytes without depending on a random source.
fill() { head -c "$2" /dev/zero | tr '\0' "$3" > "$1"; }

echo "workspace ${WORK}"

# --- the workspace has to be reachable by the docker daemon ------------------
# The assembly ALWAYS runs in a container -- os/mkimage-x64.sh has no host path
# at all -- and it binds its own work directory, which lives under the tree this
# script fabricates. On this host a bind of a /tmp path does not propagate
# writes back out: the daemon has its own /tmp, so the assembly reports success
# and leaves nothing behind. Diagnosed here by name rather than discovered as a
# missing image four minutes later.
require_visible_workspace() {
    if docker run --rm -v "${WORK}:/t" debian:trixie-slim test -f /t/visible; then
        return 0
    fi
    echo "error: the docker daemon cannot bind-mount the workspace ${WORK}" >&2
    echo "hint: point TMPDIR at a directory the daemon can see, e.g." >&2
    echo "  mkdir -p ${REPO_ROOT}/_out/tmp && TMPDIR=${REPO_ROOT}/_out/tmp bash ${BASH_SOURCE[0]}" >&2
    exit 1
}
: > "${WORK}/visible"
require_visible_workspace
rm -f "${WORK}/visible"

# --- the assertion container is the ASSEMBLY container -----------------------
# The base image and the package line are READ OUT OF os/mkimage-x64.sh, not
# restated. cx3576's selftest names its assertion tools in a list of its own and
# named two its container could never supply; that went unnoticed for as long as
# it did only because the host running it happened to have them, so the check
# was passing for a reason unrelated to the container it claimed to describe.
# Deriving both from the assembler makes that failure unreachable: the tools the
# assertions use come from the same image, built from the same line, as the
# tools the assembly uses. If the docker invocation is ever reshaped so these
# patterns stop matching, this refuses by name rather than falling back to some
# older guess.
ASSEMBLY_BASE_IMAGE="$(sed -n 's|^[[:space:]]*\([a-z0-9][a-z0-9._/-]*:[a-z0-9][a-z0-9._-]*\) bash -c .*|\1|p' "${ASSEMBLER}" | head -n1)"
ASSEMBLY_PACKAGES="$(awk '
    /apt-get install/ && !seen { grab = 1; seen = 1 }
    grab { line = line " " $0; if ($0 !~ /\\$/) grab = 0 }
    END {
        sub(/.*--no-install-recommends/, "", line)
        sub(/>.*/, "", line)
        gsub(/\\/, " ", line)
        gsub(/[[:space:]]+/, " ", line)
        sub(/^ /, "", line); sub(/ $/, "", line)
        print line
    }' "${ASSEMBLER}")"
[ -n "${ASSEMBLY_BASE_IMAGE}" ] || {
    echo "error: could not read the assembly container's base image out of ${ASSEMBLER}; the assertion phase would silently use a different one" >&2
    exit 1
}
[ -n "${ASSEMBLY_PACKAGES}" ] || {
    echo "error: could not read the assembly container's package line out of ${ASSEMBLER}; the assertion phase would silently use a different one" >&2
    exit 1
}
echo "assembly container: ${ASSEMBLY_BASE_IMAGE} + ${ASSEMBLY_PACKAGES}"

# Built once and cached, rather than apt-get'ed per container: the assertion
# phase makes dozens of tool calls and one network fetch instead of dozens is
# also what keeps a single flaky mirror from failing an unrelated case. The
# assembler pays its own apt-get per run and that is not this file's to change.
TOOL_IMAGE="$(docker build -q - <<EOF
FROM ${ASSEMBLY_BASE_IMAGE}
RUN apt-get update -qq >/dev/null 2>&1 && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ${ASSEMBLY_PACKAGES} >/dev/null 2>&1
EOF
)"
[ -n "${TOOL_IMAGE}" ] || { echo "error: could not build the assertion tool image" >&2; exit 1; }

# minfo is here for the cluster-count floor and nothing else; it is in mtools,
# which the assembler already installs, so naming it costs no package.
ASSERT_TOOLS=(sgdisk mdir mcopy minfo dumpe2fs debugfs)
tool_in_container() { docker run --rm -v "${WORK}:${WORK}" "${TOOL_IMAGE}" "$@"; }

# The R2 guard, unconditional: every tool the assertions use must be one the
# ASSEMBLY container can supply. Asserted against the image just built, not
# against this host -- a host that happens to carry sgdisk would otherwise hide
# a package line that no longer installs it.
echo "--- the assertion tools must exist in the assembly container ---"
# shellcheck disable=SC2016  # ${t} is the CONTAINER shell's variable, not this one's
container_tools="$(tool_in_container bash -c '
    for t in '"${ASSERT_TOOLS[*]}"'; do command -v "${t}" >/dev/null 2>&1 && echo "${t}"; done')"
for t in "${ASSERT_TOOLS[@]}"; do
    if printf '%s\n' "${container_tools}" | grep -cxF "${t}" >/dev/null; then
        pass "${ASSEMBLY_BASE_IMAGE} + the assembler's own package line supplies ${t}"
    else
        fail "${t} is not in the assembly container; an assertion naming it would be measuring this host, not the image"
    fi
done
[ "${FAILED}" -eq 0 ] || { echo "RESULT: FAIL"; exit 1; }

# Host binary when present, otherwise a shell function of the SAME NAME running
# it in the image above with ${WORK} mounted at its own path -- so every file
# argument resolves identically and the output is byte-identical on both routes,
# which the expected-value comparisons depend on.
for t in "${ASSERT_TOOLS[@]}"; do
    if ! command -v "${t}" >/dev/null 2>&1; then
        eval "${t}() { tool_in_container ${t} \"\$@\"; }"
    fi
done

# --- the workspace tree the assembler runs out of ----------------------------
# Four files, because those are the four os/mkimage-x64.sh reads: its own text,
# the shared timestamp pass it sources, the board layout and the grub.cfg
# template. They are copied rather than symlinked -- a mutation below must not
# be able to reach the tracked file -- and the copies are compared back against
# the originals so that "the script under test is the shipped script" is a
# measured claim rather than a comment.
#
# PATH ARITHMETIC. The assembler resolves everything from its own location:
# SCRIPT_DIR=${TREE}/os, REPO_ROOT=${TREE}, LAYOUT_ENV=${TREE}/os/boards/x64/
# board.env, OUT_DIR=${TREE}/_out/x64, and its own work directory at
# ${TREE}/_out/x64/.mkimage-work -- which is what crosses into the container as
# /w. That is x64's ONLY mount and its whole path vocabulary; cx3576 binds the
# repository at /work instead, and the two are not the same word for the same
# thing. Nothing here may assume either: the tree is addressed by ${TREE} on the
# host and the container's view is the assembler's business.
TREE="${WORK}/tree"
OUT_DIR="${TREE}/_out/x64"
mkdir -p "${TREE}/os/boards/x64" "${OUT_DIR}/boot"
cp "${ASSEMBLER}" "${TREE}/os/mkimage-x64.sh"
cp "${COMMON}" "${TREE}/os/mkimage-common.sh"
cp "${LAYOUT_ENV}" "${TREE}/os/boards/x64/board.env"
cp "${GRUB_CFG_IN}" "${TREE}/os/boards/x64/grub.cfg"
TREE_ASSEMBLER="${TREE}/os/mkimage-x64.sh"
TREE_LAYOUT="${TREE}/os/boards/x64/board.env"
TREE_GRUB_CFG="${TREE}/os/boards/x64/grub.cfg"

echo "--- the copied tree is the shipped tree ---"
for pair in "${ASSEMBLER}:${TREE_ASSEMBLER}" "${COMMON}:${TREE}/os/mkimage-common.sh" \
    "${LAYOUT_ENV}:${TREE_LAYOUT}" "${GRUB_CFG_IN}:${TREE_GRUB_CFG}"; do
    if cmp -s "${pair%%:*}" "${pair#*:}"; then
        pass "$(basename "${pair%%:*}") in the workspace is byte-identical to the shipped file"
    else
        fail "$(basename "${pair%%:*}") in the workspace differs from the shipped file"
    fi
done

# --- synthetic rootfs-verity inputs (stand-ins for os/rootfs/build-v2.sh) -----
# 4 MiB, which is far below the layout's floor, so the FLOOR path is what the
# main assembly exercises. The growth path gets its own oversize fixture and its
# own assembly further down; the two together are the whole of the slot-sizing
# arithmetic.
VERITY_MIB=4
fill "${OUT_DIR}/rootfs-verity.img" $((VERITY_MIB * 1024 * 1024)) R
KERNEL_MIB=2
INITRD_MIB=3
fill "${OUT_DIR}/boot/vmlinuz" $((KERNEL_MIB * 1024 * 1024)) K
fill "${OUT_DIR}/boot/initrd.img" $((INITRD_MIB * 1024 * 1024)) I
FAKE_ROOT_HASH=1111111111111111111111111111111111111111111111111111111111111111
cat > "${OUT_DIR}/rootfs-verity.env" <<EOF
VERITY_ROOT_HASH=${FAKE_ROOT_HASH}
VERITY_SALT=${VERITY_SALT}
VERITY_HASH_ALGO=sha256
VERITY_DATA_BLOCK_SIZE=4096
VERITY_HASH_BLOCK_SIZE=4096
VERITY_DATA_BLOCKS=768
VERITY_HASH_START_BLOCK=768
VERITY_DATA_SECTORS=6144
EOF

# --- synthetic factory /var (stand-in for _out/x64/factory-var) --------------
# FABRICATED, like every other input here, rather than read out of _out/: a
# fresh clone has no _out/, and producing one costs a full rootfs build to test
# an assembler that does not care what /var holds. Only two properties of the
# real export reach the assembler -- it must be a directory and it must contain
# lib/ -- and both are driven from the failing side below. The subdirectories
# are the ones the real export carries, so if that guard is ever widened to name
# another of them this fixture fails the way the real input would rather than
# passing by being unopinionated.
#
# EVERY ENTRY IS STAMPED INTO THE PAST, and one file is then given a DIFFERENT
# mtime on purpose. `mke2fs -d` copies the source inode's atime, mtime and ctime
# into the image; pin_seeded_times() in os/mkimage-common.sh rewrites atime and
# ctime and deliberately leaves mtime alone, because mtime is the producer's
# data and the other two are the assembler's own noise. Byte-identity cannot see
# the difference -- a pass that also flattened mtime would rebuild identically
# and would be silently discarding what the exported tree said -- so the
# distinct mtime below is asserted in the image by name.
FACTORY_VAR="${OUT_DIR}/factory-var"
PRODUCER_MTIME_EPOCH=1622851200
PRODUCER_FILE=lib/dpkg/status
build_factory_var() {
    rm -rf "${FACTORY_VAR}"
    mkdir -p "${FACTORY_VAR}"/{backups,cache,lib/dpkg,lib/mos,local,log,spool,tmp}
    fill "${FACTORY_VAR}/${PRODUCER_FILE}" 4096 S
    fill "${FACTORY_VAR}/log/wtmp" 1024 W
    find "${FACTORY_VAR}" -exec touch -h -d "${FILE_MTIME}" {} +
    touch -h -m -d "@${PRODUCER_MTIME_EPOCH}" "${FACTORY_VAR}/${PRODUCER_FILE}"
}
build_factory_var

# --- THE REFUSAL REGISTER ----------------------------------------------------
# One row per refusal this file drives, as
#
#     key | the file the message must live in | the substring that identifies it
#
# The substrings are what makes each case name WHICH guard fired rather than
# just "something refused". They are deliberately the distinguishing clause of
# each message and not its whole text: a message may be reworded without this
# file going stale, but it may not be reworded into a different assertion
# without the guard below noticing.
#
# It is a heredoc rather than a quoted string because several of these messages
# contain an apostrophe ("the slot's own boot partition"), and a single-quoted
# register would end at the first one and turn the rows after it into commands.
# ui-location-test.sh carries the same warning, having been bitten by it.
#
# container-failed is not a guard of its own: it is the one line the HOST prints
# when the container exits non-zero, so it accompanies every container-side
# refusal and never a host-side one. Registering it is what makes "this refusal
# came from inside the assembly" a thing a case can state.
REFUSALS="$(cat <<'ROWS'
missing-input|mkimage-x64.sh| not found. Build the root first: MOS_BOARD=x64 bash os/rootfs/build-v2.sh
missing-factory-var|mkimage-x64.sh|The rootfs build exports it; run 'MOS_BOARD=x64 bash os/rootfs/build-v2.sh' first
unrendered-placeholder|mkimage-x64.sh|error: unrendered placeholder left in grub.cfg
literal-hash|mkimage-x64.sh|carries a literal hash. The dm-verity root hash changes with every build
unused-fragment-var|mkimage-x64.sh|; the per-slot fragment would be installed and never read
esp-cluster-floor|mkimage-x64.sh|below the 65525 the FAT specification requires for FAT32
grubenv-size|mkimage-x64.sh|bytes, not 1024; GRUB would ignore it and the A/B order would silently never change
esp-stray|mkimage-x64.sh|is on the ESP. The per-slot payload belongs on the slot
boot-slots-differ|mkimage-x64.sh|error: the two boot slots do not carry the same files
factory-var-no-lib|mkimage-x64.sh|the staged factory /var has no lib/; seeding EPHEMERAL from it would produce a /var
pin-debugfs|mkimage-common.sh|debugfs could not pin the seeded timestamps in
container-failed|mkimage-x64.sh|error: image assembly failed
ROWS
)"

# THE REGISTER MUST DESCRIBE THE CODE, and this is where that is established.
# A register naming a message the shipped script can no longer produce asserts
# nothing at all, and from outside it looks exactly like coverage: every case
# still exits non-zero, and the identity diff below still finds the set it was
# told to expect ONLY because it finds nothing in either. Two of this
# repository's other instruments had rows in that state; both were found by a
# guard of this shape and not by a failing run.
echo "--- every registered refusal exists in the shipped source ---"
while IFS='|' read -r key file sub; do
    [ -n "${key}" ] || continue
    if grep -cF -- "${sub}" "${OS_DIR}/${file}" >/dev/null; then
        pass "${key}: its message is in os/${file}"
    else
        fail "${key}: no such message in os/${file} -- this register names an assertion the code cannot produce: '${sub}'"
    fi
done <<<"${REFUSALS}"
[ "${FAILED}" -eq 0 ] || { echo "RESULT: FAIL"; exit 1; }

# --- driving the assembler ---------------------------------------------------
# The image name carries an epoch second, so two assemblies inside one second
# would collide on one filename. Each result is moved out to a stable name as
# soon as it exists, which removes that race and halves the peak disk the run
# needs. The path is taken from the -latest symlink rather than from a glob:
# resolving it is also the assertion that the assembler published one.
assemble() { # out-name
    local out="$1" rc=0 produced
    bash "${TREE_ASSEMBLER}" > "${WORK}/$1.log" 2>&1 || rc=$?
    if [ "${rc}" -ne 0 ]; then
        fail "assembly for ${out} exited ${rc}: $(tr '\n' ' ' < "${WORK}/$1.log")"
        return 1
    fi
    produced="$(readlink -f "${OUT_DIR}/${IMAGE_LATEST_NAME}" 2>/dev/null || true)"
    if [ -z "${produced}" ] || [ ! -f "${produced}" ]; then
        fail "assembly for ${out} left no ${IMAGE_LATEST_NAME} pointing at a file"
        return 1
    fi
    mv "${produced}" "${WORK}/${out}"
    rm -f "${OUT_DIR}/${IMAGE_LATEST_NAME}"
}

# expect_refusal <label> <expected key set> [<extra literal substring> ...]
#
# The expected set is the WHOLE set: a case that trips a guard it did not name
# fails, which is what stops a mutation from being credited to the guard it was
# aimed at when something earlier caught it first. Extra substrings are the
# particulars -- the number in a message, the name of the file it is about --
# because identity says WHICH guard fired and these say the message carried the
# right facts.
expect_refusal() {
    local label="$1" want_keys="$2"
    shift 2
    local log="${WORK}/refusal.log" rc=0 key file sub want got
    bash "${TREE_ASSEMBLER}" > "${log}" 2>&1 || rc=$?
    if [ "${rc}" -eq 0 ]; then
        fail "${label}: the assembly succeeded but should have refused"
        rm -f "${OUT_DIR}/${IMAGE_LATEST_NAME}" "${OUT_DIR}"/"${IMAGE_NAME_PREFIX}"*"${IMAGE_NAME_SUFFIX}"
        return
    fi
    pass "${label}: exits non-zero (${rc})"
    got=""
    while IFS='|' read -r key file sub; do
        [ -n "${key}" ] || continue
        if grep -cF -- "${sub}" "${log}" >/dev/null; then
            got="${got}${key}
"
        fi
    done <<<"${REFUSALS}"
    got="$(printf '%s' "${got}" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ *$//')"
    want="$(printf '%s\n' "${want_keys}" | tr ' ' '\n' | sed '/^$/d' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ *$//')"
    if [ "${got}" = "${want}" ]; then
        pass "${label}: the refusals that fired are exactly [${want}]"
    else
        fail "${label}: expected refusals [${want}], got [${got}] — message: $(tr '\n' ' ' < "${log}")"
    fi
    for sub in "$@"; do
        if grep -cF -- "${sub}" "${log}" >/dev/null; then
            pass "${label}: message states '${sub}'"
        else
            fail "${label}: message lacks '${sub}' — got: $(tr '\n' ' ' < "${log}")"
        fi
    done
    rm -f "${OUT_DIR}/${IMAGE_LATEST_NAME}"
}

FILE_MTIME_EPOCH="${FILE_MTIME#@}"

# --- assemble twice ----------------------------------------------------------
echo "--- assembly 1 ---"
ATIME_BEFORE="$(stat -c %X "${FACTORY_VAR}/${PRODUCER_FILE}")"
assemble one.img || { echo "RESULT: FAIL"; exit 1; }
ATIME_AFTER_ONE="$(stat -c %X "${FACTORY_VAR}/${PRODUCER_FILE}")"
echo "--- assembly 2 ---"
assemble two.img || { echo "RESULT: FAIL"; exit 1; }

echo "--- byte-identity ---"
# THE VACUITY GUARD ON THE COMPARISON BELOW. Under relatime a tree whose atime
# is older than its mtime, or older than a day, has its atime bumped by the
# FIRST read of it -- and that first read is assembly 1's own `cp -a`. So
# assembly 1 stages the stamped-into-the-past atime and assembly 2 stages the
# timestamp assembly 1 created, and the images agree only because
# pin_seeded_times() rewrites the field. If this check ever goes red the
# comparison below has stopped proving what it says: the two assemblies were
# handed identical inputs in every field, and an assembler that pinned nothing
# would pass it. Fixing THAT means rebuilding the fixture, not relaxing this.
check "the atime class was live: assembly 1's own read moved the fixture's atime" \
    "$([ "${ATIME_BEFORE}" = "${FILE_MTIME_EPOCH}" ] && [ "${ATIME_AFTER_ONE}" != "${ATIME_BEFORE}" ] && echo live || echo quiescent)" \
    live
# IDENTITY, NOT A DELTA -- see the header. The block list is a diagnostic for a
# human reading a failure, and nothing asserts anything about its length.
ONE_SHA="$(sha256sum "${WORK}/one.img" | cut -d' ' -f1)"
TWO_SHA="$(sha256sum "${WORK}/two.img" | cut -d' ' -f1)"
if [ "${ONE_SHA}" = "${TWO_SHA}" ]; then
    pass "the two assemblies are byte-identical (${ONE_SHA})"
else
    fail "the two assemblies differ: ${ONE_SHA} vs ${TWO_SHA}"
    echo "  differing bytes per MiB block (diagnostic only):" >&2
    cmp -l "${WORK}/one.img" "${WORK}/two.img" |
        awk '{ print int(($1 - 1) / 1048576) }' | uniq -c |
        awk '{ printf "    %s bytes in MiB %s\n", $1, $2 }' >&2 || true
fi

# --- geometry, derived from the layout ---------------------------------------
# SLOT_MIB = max(MOS_ROOTFS_SLOT_MIB, align(ceil(VERITY_MIB * HEADROOM / 100)))
# and with a 4 MiB payload the floor wins by a wide margin, so this assembly is
# the floor path. The oversize fixture further down is the growth path.
SLOT_MIB="${MOS_ROOTFS_SLOT_MIB}"
ROOTFS_B_START_MIB=$((ROOTFS_A_START_MIB + SLOT_MIB))
META_START_MIB=$((ROOTFS_B_START_MIB + SLOT_MIB))
STATE_START_MIB=$((META_START_MIB + META_SIZE_MIB))
EPHEMERAL_START_MIB=$((STATE_START_MIB + STATE_SIZE_MIB))
DATA_START_MIB=$((EPHEMERAL_START_MIB + MOS_VAR_MIB))
TOTAL_MIB=$((DATA_START_MIB + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))

IMG="${WORK}/one.img"
echo "--- GPT ---"
check "image size is ${TOTAL_MIB} MiB" "$(stat -c %s "${IMG}")" "$((TOTAL_MIB * MIB_BYTES))"
# shellcheck disable=SC2086
LAYOUT_PART_COUNT="$(printf '%s\n' ${LAYOUT_PARTITIONS} | wc -l | tr -d ' ')"
check "partition count" \
    "$(sgdisk --print "${IMG}" | awk '$1 ~ /^[0-9]+$/ {n++} END {print n+0}')" \
    "${LAYOUT_PART_COUNT}"
check "disk GUID" "$(sgdisk --print "${IMG}" | sed -n 's/^Disk identifier (GUID): //p')" "${DISK_GUID}"

part_field() { sgdisk -i "$1" "${IMG}" | sed -n "s/^$2: //p"; }
assert_part() { # num label guid typecode start-sector size-sectors
    check "p$1 name" "$(part_field "$1" 'Partition name' | tr -d "'")" "$2"
    check "p$1 unique GUID" "$(part_field "$1" 'Partition unique GUID')" "$3"
    check "p$1 typecode" "$(part_field "$1" 'Partition GUID code' | cut -d' ' -f1)" "$4"
    check "p$1 first sector" "$(part_field "$1" 'First sector' | cut -d' ' -f1)" "$5"
    check "p$1 size in sectors" "$(part_field "$1" 'Partition size' | cut -d' ' -f1)" "$6"
}
mib_to_sectors() { echo $(( $1 * MIB_BYTES / SECTOR_SIZE )); }

assert_part "${ESP_PARTNUM}" "${ESP_LABEL}" "${ESP_GUID}" "${ESP_TYPECODE}" \
    "$(mib_to_sectors "${ESP_START_MIB}")" "$(mib_to_sectors "${ESP_SIZE_MIB}")"
assert_part "${BOOT_A_PARTNUM}" "${BOOT_A_LABEL}" "${BOOT_A_GUID}" "${BOOT_A_TYPECODE}" \
    "$(mib_to_sectors "${BOOT_A_START_MIB}")" "$(mib_to_sectors "${BOOT_SIZE_MIB}")"
assert_part "${BOOT_B_PARTNUM}" "${BOOT_B_LABEL}" "${BOOT_B_GUID}" "${BOOT_B_TYPECODE}" \
    "$(mib_to_sectors "${BOOT_B_START_MIB}")" "$(mib_to_sectors "${BOOT_SIZE_MIB}")"
assert_part "${ROOTFS_A_PARTNUM}" "${ROOTFS_A_LABEL}" "${ROOTFS_A_GUID}" "${ROOTFS_A_TYPECODE}" \
    "$(mib_to_sectors "${ROOTFS_A_START_MIB}")" "$(mib_to_sectors "${SLOT_MIB}")"
assert_part "${ROOTFS_B_PARTNUM}" "${ROOTFS_B_LABEL}" "${ROOTFS_B_GUID}" "${ROOTFS_B_TYPECODE}" \
    "$(mib_to_sectors "${ROOTFS_B_START_MIB}")" "$(mib_to_sectors "${SLOT_MIB}")"
assert_part "${META_PARTNUM}" "${META_LABEL}" "${META_GUID}" "${META_TYPECODE}" \
    "$(mib_to_sectors "${META_START_MIB}")" "$(mib_to_sectors "${META_SIZE_MIB}")"
assert_part "${STATE_PARTNUM}" "${STATE_LABEL}" "${STATE_GUID}" "${STATE_TYPECODE}" \
    "$(mib_to_sectors "${STATE_START_MIB}")" "$(mib_to_sectors "${STATE_SIZE_MIB}")"
assert_part "${EPHEMERAL_PARTNUM}" "${EPHEMERAL_LABEL}" "${EPHEMERAL_GUID}" "${EPHEMERAL_TYPECODE}" \
    "$(mib_to_sectors "${EPHEMERAL_START_MIB}")" "$(mib_to_sectors "${MOS_VAR_MIB}")"
assert_part "${DATA_PARTNUM}" "${DATA_LABEL}" "${DATA_GUID}" "${DATA_TYPECODE}" \
    "$(mib_to_sectors "${DATA_START_MIB}")" "$(mib_to_sectors "${DATA_SIZE_MIB}")"

# The boot chain is three partitions laid end to end from IMAGE_HEAD_MIB, and
# their starts are LITERALS in the layout while their sizes are separate keys.
# Three literals that must agree with two sizes is exactly the shape that drifts
# silently: a gap here is only wasted space, but an overlap is one partition
# writing over another and sgdisk --verify does not object to either being
# further apart than intended.
check "the ESP ends exactly where ${BOOT_A_LABEL} begins" \
    "$((ESP_START_MIB + ESP_SIZE_MIB))" "${BOOT_A_START_MIB}"
check "${BOOT_A_LABEL} ends exactly where ${BOOT_B_LABEL} begins" \
    "$((BOOT_A_START_MIB + BOOT_SIZE_MIB))" "${BOOT_B_START_MIB}"
check "${BOOT_B_LABEL} ends exactly where ${ROOTFS_A_LABEL} begins" \
    "$((BOOT_B_START_MIB + BOOT_SIZE_MIB))" "${ROOTFS_A_START_MIB}"
check "the ESP starts at IMAGE_HEAD_MIB" "${ESP_START_MIB}" "${IMAGE_HEAD_MIB}"

# data must be LAST: systemd-repart can only extend the final partition to the
# end of the disk. Nothing may sit between its end and the backup-GPT slack.
check "data is the last partition" \
    "$(sgdisk --print "${IMG}" | awk '$1 ~ /^[0-9]+$/ {n=$1} END {print n}')" "${DATA_PARTNUM}"
check "data ends ${IMAGE_TAIL_SLACK_MIB} MiB before the end of the image" \
    "$(($(part_field "${DATA_PARTNUM}" 'Last sector' | cut -d' ' -f1) + 1))" \
    "$(mib_to_sectors $((TOTAL_MIB - IMAGE_TAIL_SLACK_MIB)))"
check "ephemeral is exactly MOS_VAR_MIB (${MOS_VAR_MIB} MiB), not a growth target" \
    "$(part_field "${EPHEMERAL_PARTNUM}" 'Partition size' | cut -d' ' -f1)" \
    "$(mib_to_sectors "${MOS_VAR_MIB}")"

# EXACTLY ONE ESP-TYPED PARTITION, and on this board that is behaviour rather
# than documentation. UEFI firmware enumerates every partition carrying the ESP
# type GUID and will try \EFI\BOOT\BOOTX64.EFI on each; the slot boot partitions
# hold a kernel, an initrd and a cmdline and no EFI binary, so a second ESP type
# code invites the firmware to pick one and fail to boot a machine whose real
# ESP is sitting right there. The layout says so in prose next to BOOT_A_TYPECODE
# and this is the assertion of it.
check "exactly one partition carries the ESP type code" \
    "$(sgdisk --print "${IMG}" | awk -v n=0 '$1 ~ /^[0-9]+$/ && $6 == "EF00" {n++} END {print n+0}')" 1

echo "--- the ESP ---"
# THE CLUSTER COUNT, COMPUTED THE WAY THE FIRMWARE COMPUTES IT. The FAT
# specification defines the type by cluster count and by nothing else, and
# `mkfs.vfat -F 32` does not enforce it: given a 32 MiB partition it writes a
# FAT32 boot sector over 64495 clusters and reports success. Every tool that
# reads the type out of the BPB then agrees it is FAT32 -- mtools does, the
# image verifier did -- and OVMF, which computes it from the count, refuses the
# filesystem outright. The symptom is not an error: it is the ESP simply absent
# from the firmware's device list and the machine at the UEFI shell.
#
# So this derives the count from the BPB rather than asking any tool for a type,
# and it is deliberately NOT the same reading the assembler takes: the assembler
# reads the FSInfo sector's FREE cluster count on an empty filesystem, where
# free is total minus the one cluster the root directory occupies. That is
# conservative by exactly one and correct where it stands, but it is a different
# quantity, so computing the total here is a second opinion rather than an echo.
esp_bpb() { minfo -i "${IMG}@@${ESP_OFFSET_BYTES}" 2>/dev/null | sed -n "$1"; }
esp_total_sectors="$(esp_bpb 's/^big size: \([0-9]*\) sectors.*/\1/p')"
esp_reserved="$(esp_bpb 's/^reserved (boot) sectors: \([0-9]*\).*/\1/p')"
esp_fats="$(esp_bpb 's/^fats: \([0-9]*\).*/\1/p')"
esp_fatlen="$(esp_bpb 's/^Big fatlen=\([0-9]*\).*/\1/p')"
esp_clustersz="$(esp_bpb 's/^cluster size: \([0-9]*\) sectors.*/\1/p')"
for v in "${esp_total_sectors}" "${esp_reserved}" "${esp_fats}" "${esp_fatlen}" "${esp_clustersz}"; do
    [ -n "${v}" ] || { echo "error: could not read the ESP's BPB out of minfo" >&2; exit 1; }
done
esp_clusters=$(( (esp_total_sectors - (esp_reserved + esp_fats * esp_fatlen)) / esp_clustersz ))
check "the ESP holds at least the 65525 clusters FAT32 requires (${esp_clusters})" \
    "$([ "${esp_clusters}" -ge 65525 ] && echo enough || echo short)" enough
check "the ESP's FAT volume id is the pinned one" \
    "$(minfo -i "${IMG}@@${ESP_OFFSET_BYTES}" 2>/dev/null | sed -n 's/^serial number: //p')" \
    "${ESP_FAT_VOLUME_ID}"
check "the ESP's FAT label is the pinned one" \
    "$(minfo -i "${IMG}@@${ESP_OFFSET_BYTES}" 2>/dev/null | sed -n 's/^disk label="\(.*\)"$/\1/p' | sed 's/ *$//')" \
    "${ESP_FAT_LABEL}"

# EXACTLY the layout's ESP_REQUIRED_FILES, in both directions. The forward half
# alone -- "each required file is present" -- passes happily on an ESP that also
# carries a per-slot kernel, which is the thing that must not be here: the ESP
# is in no slot group, so a file that lands on it is one no install would ever
# replace and no rollback could ever undo.
# The `|| true` on the filter is not decoration: `grep -v` exits 1 when it
# filters every line out, an empty FAT is a state a mutation below produces, and
# under pipefail that status would abort the run instead of failing an assertion.
fat_files() {
    mdir -/ -b -i "${IMG}@@$1" ::/ 2>/dev/null | { grep -v '/$' || true; } |
        sed 's|^::/||' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ *$//'
}
# shellcheck disable=SC2086
ESP_WANT="$(printf '%s\n' ${ESP_REQUIRED_FILES} | LC_ALL=C sort | tr '\n' ' ' | sed 's/ *$//')"
check "the ESP carries exactly ESP_REQUIRED_FILES" "$(fat_files "${ESP_OFFSET_BYTES}")" "${ESP_WANT}"
# Named separately from the listing above, because this is the assertion the
# assembler itself makes and this file drives from the failing side; the two
# together are the positive and negative directions of one property.
# shellcheck disable=SC2086
for stray in ${BOOT_SLOT_REQUIRED_FILES}; do
    if mdir -/ -b -i "${IMG}@@${ESP_OFFSET_BYTES}" ::/ 2>/dev/null | grep -cxF "::/${stray}" >/dev/null; then
        fail "the per-slot ${stray} is at the ESP root"
    else
        pass "no per-slot ${stray} at the ESP root"
    fi
done

# grubenv IS 1024 BYTES OR IT IS NOT A GRUBENV. GRUB rewrites it in place and
# ignores a file of any other size SILENTLY, which on a device looks exactly
# like an A/B order that never changes -- an update that installs cleanly, is
# marked good, and never boots. Read out of the assembled image rather than out
# of the assembler's work directory, because the file that matters is the one
# that shipped.
mcopy -n -i "${IMG}@@${ESP_OFFSET_BYTES}" "::/EFI/mos/grubenv" "${WORK}/grubenv"
check "grubenv in the image is exactly 1024 bytes" "$(stat -c %s "${WORK}/grubenv")" 1024
if grep -cF 'ORDER=A B' "${WORK}/grubenv" >/dev/null; then
    pass "grubenv ships the factory boot order"
else
    fail "grubenv does not ship ORDER=A B: $(tr -d '\0' < "${WORK}/grubenv" | head -c 200)"
fi
for v in A_OK A_TRY B_OK B_TRY; do
    if grep -cF "${v}=0" "${WORK}/grubenv" >/dev/null; then
        pass "grubenv ships ${v}=0"
    else
        fail "grubenv does not ship ${v}=0"
    fi
done

# THE RENDERED grub.cfg, read back out of the ESP. RFCT-106's whole point is
# that this file holds board constants and NOTHING that changes with a build,
# because it is the one file RAUC never rewrites. The assembler asserts all
# three of these against its own work copy before it builds the ESP; asserting
# them against the shipped bytes is what makes them about the image.
mcopy -n -i "${IMG}@@${ESP_OFFSET_BYTES}" "::/EFI/mos/grub.cfg" "${WORK}/grub.cfg.shipped"
if grep -c '@[A-Z_]\+@' "${WORK}/grub.cfg.shipped" >/dev/null; then
    fail "the shipped grub.cfg still carries an unrendered placeholder: $(grep -o '@[A-Z_]\+@' "${WORK}/grub.cfg.shipped" | tr '\n' ' ')"
else
    pass "the shipped grub.cfg has no unrendered placeholder"
fi
# By SHAPE -- a run of 32+ hex bytes on a linux line -- not by grepping for the
# word "verity", for the reason the assembler records: two earlier drafts of its
# own check did that and rejected the correct file, once for a comment and once
# for a console message.
if grep -E '^[[:space:]]*linux[[:space:]]' "${WORK}/grub.cfg.shipped" | grep -cE '[0-9a-f]{32,}' >/dev/null; then
    fail "a linux line in the shipped grub.cfg carries a literal hash"
else
    pass "no linux line in the shipped grub.cfg carries a literal hash"
fi
for v in MOS_SECTORS MOS_DATA_BLOCKS MOS_HASH_START_BLOCK MOS_ROOT_HASH MOS_SALT; do
    if grep -cE "^[[:space:]]*linux[[:space:]].*\\\$\{${v}\}" "${WORK}/grub.cfg.shipped" >/dev/null; then
        pass "the shipped grub.cfg consumes \${${v}} from the per-slot fragment"
    else
        fail "no linux line in the shipped grub.cfg uses \${${v}}; the fragment would be installed and never read"
    fi
done
# Both slot PARTUUIDs must be rendered in, lowercase: udev and libblkid spell
# by-partuuid names lowercase and GRUB compares the string it is given.
for g in "${ROOTFS_A_GUID}" "${ROOTFS_B_GUID}"; do
    lc="$(printf '%s' "${g}" | tr '[:upper:]' '[:lower:]')"
    if grep -cF "PARTUUID=${lc}" "${WORK}/grub.cfg.shipped" >/dev/null; then
        pass "the shipped grub.cfg addresses ${lc} in lowercase"
    else
        fail "the shipped grub.cfg does not carry PARTUUID=${lc}"
    fi
done

echo "--- the per-slot boot partitions ---"
# BOTH SLOTS START LIFE IDENTICAL. An image whose B side were empty would have
# nothing to fall back TO on the first bad update, and the failure would arrive
# on the first rollback rather than at build time. The two lists are compared to
# each other AND each to the layout's own BOOT_SLOT_REQUIRED_FILES: comparing
# them only to each other passes on two slots that are equally wrong.
# shellcheck disable=SC2086
SLOT_WANT="$(printf '%s\n' ${BOOT_SLOT_REQUIRED_FILES} | LC_ALL=C sort | tr '\n' ' ' | sed 's/ *$//')"
BOOT_A_LIST="$(fat_files "${BOOT_A_OFFSET_BYTES}")"
BOOT_B_LIST="$(fat_files "${BOOT_B_OFFSET_BYTES}")"
check "${BOOT_A_LABEL} carries exactly BOOT_SLOT_REQUIRED_FILES" "${BOOT_A_LIST}" "${SLOT_WANT}"
check "${BOOT_B_LABEL} carries exactly BOOT_SLOT_REQUIRED_FILES" "${BOOT_B_LIST}" "${SLOT_WANT}"
check "the two boot slots carry the same files" "${BOOT_A_LIST}" "${BOOT_B_LIST}"

# ...and they must differ in exactly one thing: their filesystem identity. `cp`
# plus `mlabel` would change the label and leave the volume id as A's, which is
# what BOOT_B_FAT_VOLUME_ID sitting in the layout with nothing writing it used
# to mean. mlabel cannot set a volume id at all, so each slot is made rather
# than copied, and this is the assertion that it still is.
for slot in a b; do
    case "${slot}" in
    a) off="${BOOT_A_OFFSET_BYTES}"; want_label="${BOOT_A_FAT_LABEL}"; want_id="${BOOT_A_FAT_VOLUME_ID}" ;;
    b) off="${BOOT_B_OFFSET_BYTES}"; want_label="${BOOT_B_FAT_LABEL}"; want_id="${BOOT_B_FAT_VOLUME_ID}" ;;
    esac
    check "boot-${slot} FAT volume id" \
        "$(minfo -i "${IMG}@@${off}" 2>/dev/null | sed -n 's/^serial number: //p')" "${want_id}"
    check "boot-${slot} FAT label" \
        "$(minfo -i "${IMG}@@${off}" 2>/dev/null | sed -n 's/^disk label="\(.*\)"$/\1/p' | sed 's/ *$//')" \
        "${want_label}"
    mcopy -n -i "${IMG}@@${off}" "::/${SLOT_KERNEL_NAME}" "${WORK}/kernel-${slot}"
    mcopy -n -i "${IMG}@@${off}" "::/${SLOT_INITRD_NAME}" "${WORK}/initrd-${slot}"
    mcopy -n -i "${IMG}@@${off}" "::/${SLOT_CMDLINE_NAME}" "${WORK}/cmdline-${slot}"
    check "boot-${slot} ${SLOT_KERNEL_NAME} is the fixture kernel byte-for-byte" \
        "$(cmp -s "${WORK}/kernel-${slot}" "${OUT_DIR}/boot/vmlinuz" && echo same || echo differs)" same
    check "boot-${slot} ${SLOT_INITRD_NAME} is the fixture initrd byte-for-byte" \
        "$(cmp -s "${WORK}/initrd-${slot}" "${OUT_DIR}/boot/initrd.img" && echo same || echo differs)" same
done
check "the two slots' FAT volume ids differ" \
    "$([ "${BOOT_A_FAT_VOLUME_ID}" = "${BOOT_B_FAT_VOLUME_ID}" ] && echo same || echo differ)" differ
check "the two slots ship the same ${SLOT_CMDLINE_NAME}" \
    "$(cmp -s "${WORK}/cmdline-a" "${WORK}/cmdline-b" && echo same || echo differs)" same

# THE PER-SLOT FRAGMENT is where every value that changes with a build lives,
# and each of these is read back out of the shipped file with the value the
# fixture's rootfs-verity.env gave it. A fragment that lost one of them would
# leave grub.cfg composing a verity table with an empty field, which the kernel
# rejects with a panic seconds after handover and nothing on the console to say
# why. Derived from the env file rather than restated, so the two cannot agree
# with each other while disagreeing with the producer.
# shellcheck source=/dev/null
. "${OUT_DIR}/rootfs-verity.env"
for pair in "MOS_SECTORS:${VERITY_DATA_SECTORS}" "MOS_DATA_BLOCK_SIZE:${VERITY_DATA_BLOCK_SIZE}" \
    "MOS_HASH_BLOCK_SIZE:${VERITY_HASH_BLOCK_SIZE}" "MOS_DATA_BLOCKS:${VERITY_DATA_BLOCKS}" \
    "MOS_HASH_START_BLOCK:${VERITY_HASH_START_BLOCK}" "MOS_HASH_ALGO:${VERITY_HASH_ALGO}" \
    "MOS_ROOT_HASH:${VERITY_ROOT_HASH}" "MOS_SALT:${VERITY_SALT}"; do
    check "${SLOT_CMDLINE_NAME} sets ${pair%%:*}" \
        "$(sed -n "s/^set ${pair%%:*}=//p" "${WORK}/cmdline-a")" "${pair#*:}"
done
check "${SLOT_CMDLINE_NAME} carries only the fragment's own facts" \
    "$(grep -cv '^set MOS_[A-Z_]*=' "${WORK}/cmdline-a" || true)" 0

echo "--- the rootfs slots ---"
# BOTH slots carry the payload on this board -- unlike cx3576, whose B side is
# left zero-filled -- because RAUC's grub backend gives an unconfirmed slot one
# try and the factory image has to have something to fall back to on the first
# bad update. Asserting it of B is the half that would otherwise go unnoticed:
# a device only reads B after an update has already gone wrong.
for spec in "${ROOTFS_A_LABEL}:${ROOTFS_A_START_MIB}" "${ROOTFS_B_LABEL}:${ROOTFS_B_START_MIB}"; do
    check "${spec%%:*} holds the verity payload" \
        "$(dd if="${IMG}" bs=1M skip="${spec#*:}" count="${VERITY_MIB}" status=none |
            cmp -s - "${OUT_DIR}/rootfs-verity.img" && echo yes || echo no)" yes
done

echo "--- the ext4 filesystems ---"
# Each must carry the pinned label and fs UUID and hold in its root exactly what
# its role calls for: nothing beyond what mke2fs itself creates, except
# EPHEMERAL, which SHIPS SEEDED. The comparison is against the LISTING and not a
# count -- a count answers "how many" when the question is "which", and would go
# on passing if the seeded tree were replaced wholesale by the same number of
# different entries.
assert_ext4() { # partnum start-mib size-mib fs-label fs-uuid [expected-root-entries]
    local part="${WORK}/ext4-p$1.img" want="${6-}" got
    dd if="${IMG}" bs=1M skip="$2" count="$3" status=none > "${part}"
    check "p$1 fs label" "$(dumpe2fs -h "${part}" 2>/dev/null | sed -n 's/^Filesystem volume name: *//p')" "$4"
    check "p$1 fs UUID" "$(dumpe2fs -h "${part}" 2>/dev/null | sed -n 's/^Filesystem UUID: *//p')" "$5"
    # grep -v exits 1 when it filters every line out, and under pipefail that
    # would fail the assignment -- but an empty root is the EXPECTED result for
    # three of these four. `|| got=""` makes "nothing left" mean the empty
    # listing instead of aborting the run.
    got="$(debugfs -R 'ls -p /' "${part}" 2>/dev/null | tr '/' '\n' |
        grep -vE '^$|^[0-9]+$|^\.$|^\.\.$|^lost\+found$' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" || got=""
    if [ -n "${want}" ]; then
        check "p$1 root holds exactly the seeded factory /var" "${got}" "${want}"
    else
        check "p$1 is empty apart from lost+found" "${got}" ""
    fi
}

# The factory half is DERIVED from the fixture: restating it would only assert
# that two lists in this file agree with each other. The stamp is restated by
# name, because it is a contract with something OUTSIDE this script --
# mos-seed-var's ConditionPathExists is what keeps the first-boot seeder from
# running over a /var that is already populated, and a stamp that stopped
# shipping would put back the boot race RFCT-106 removed without changing
# anything else visible here.
EPHEMERAL_WANT="$( { echo .mos-var-seeded; ls -A "${FACTORY_VAR}"; } |
    LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"

assert_ext4 "${META_PARTNUM}" "${META_START_MIB}" "${META_SIZE_MIB}" "${META_FS_LABEL}" "${META_FS_UUID}"
assert_ext4 "${STATE_PARTNUM}" "${STATE_START_MIB}" "${STATE_SIZE_MIB}" "${STATE_FS_LABEL}" "${STATE_FS_UUID}"
assert_ext4 "${EPHEMERAL_PARTNUM}" "${EPHEMERAL_START_MIB}" "${MOS_VAR_MIB}" \
    "${EPHEMERAL_FS_LABEL}" "${EPHEMERAL_FS_UUID}" "${EPHEMERAL_WANT}"
assert_ext4 "${DATA_PARTNUM}" "${DATA_START_MIB}" "${DATA_SIZE_MIB}" "${DATA_FS_LABEL}" "${DATA_FS_UUID}"

echo "--- EPHEMERAL's seeded inode times ---"
# WHAT BYTE-IDENTITY CANNOT SEE HERE, and it is the reason this section exists
# rather than being left to the comparison above. pin_seeded_times() in
# os/mkimage-common.sh rewrites every seeded inode's atime and ctime and
# DELIBERATELY LEAVES MTIME ALONE: mtime is the producer's data, carried in by
# `cp -a`, and the other two are the assembler's own noise. A pass that flattened
# mtime as well would rebuild byte-identically every time and would be silently
# discarding what the exported tree said about its own contents. So the fixture
# gives one file a distinct mtime and this reads it back out of the image.
EPH="${WORK}/ext4-p${EPHEMERAL_PARTNUM}.img"
eph_hdr="$(dumpe2fs -h "${EPH}" 2>/dev/null)"
eph_first="$(printf '%s\n' "${eph_hdr}" | sed -n 's/^First inode: *//p')"
eph_count="$(printf '%s\n' "${eph_hdr}" | sed -n 's/^Inode count: *//p')"
eph_free="$(printf '%s\n' "${eph_hdr}" | sed -n 's/^Free inodes: *//p')"
eph_want=$(( eph_count - eph_free - (eph_first - 1) ))
# The second, independent derivation: what the fixture actually contains, plus
# lost+found and the stamp the assembler authors. Two derivations that agree is
# what makes the scan below sound; one alone would be the scan agreeing with
# itself.
fixture_objects=$(( $(find "${FACTORY_VAR}" | wc -l) + 1 ))
check "the number of seeded inodes matches the fixture" "${eph_want}" "${fixture_objects}"

# Scanned over a RANGE rather than reconstructed from the inode bitmap: parsing
# the bitmap here would be a second copy of the very function under test, and a
# copy of it would agree with it about a mistake. The range is generously wider
# than the seed, free inodes are skipped by their zero link count, and the count
# of what was found is required to equal eph_want -- so an in-use inode outside
# the range is a FAIL rather than something silently not looked at.
: > "${WORK}/eph-cmds"
for n in $(seq "${eph_first}" $((eph_first + 199))); do
    [ "${n}" -le "${eph_count}" ] || break
    echo "stat <${n}>" >> "${WORK}/eph-cmds"
done
debugfs -f "${WORK}/eph-cmds" "${EPH}" > "${WORK}/eph-stat.txt" 2>/dev/null || true
WANT_TIME_HEX="0x$(printf '%08x' "${FILE_MTIME_EPOCH}")"
PRODUCER_TIME_HEX="0x$(printf '%08x' "${PRODUCER_MTIME_EPOCH}")"
eph_scan="$(awk -v want="${WANT_TIME_HEX}" '
    /^Inode: [0-9]+/ { ino = $2; links = ""; a = ""; c = "" }
    /^Links: [0-9]+/ { links = $2 }
    /^ atime: 0x/    { split($2, p, ":"); a = p[1] }
    /^ ctime: 0x/    { split($2, p, ":"); c = p[1] }
    /^crtime: 0x/ {
        if (links + 0 > 0) {
            seen++
            if (a != want) bad_atime = bad_atime " " ino "(" a ")"
            if (c != want) bad_ctime = bad_ctime " " ino "(" c ")"
        }
    }
    END { printf "%d|%s|%s\n", seen + 0, bad_atime, bad_ctime }
' "${WORK}/eph-stat.txt")"
check "every seeded inode was examined" "${eph_scan%%|*}" "${eph_want}"
eph_rest="${eph_scan#*|}"
check "every seeded inode's atime is pinned to FILE_MTIME" "${eph_rest%%|*}" ""
check "every seeded inode's ctime is pinned to FILE_MTIME" "${eph_rest##*|}" ""

inode_time() { # path field
    debugfs -R "stat $1" "${EPH}" 2>/dev/null |
        sed -n "s/^[[:space:]]*$2: \(0x[0-9a-f]*\):.*/\1/p" | head -n1
}
check "the producer's mtime on /${PRODUCER_FILE} survived into the image" \
    "$(inode_time "/${PRODUCER_FILE}" mtime)" "${PRODUCER_TIME_HEX}"
check "/${PRODUCER_FILE}'s atime was pinned even though its mtime was not" \
    "$(inode_time "/${PRODUCER_FILE}" atime)" "${WANT_TIME_HEX}"
check "/${PRODUCER_FILE}'s ctime was pinned even though its mtime was not" \
    "$(inode_time "/${PRODUCER_FILE}" ctime)" "${WANT_TIME_HEX}"
# The one file in the seed the ASSEMBLER authors, so the one whose mtime is the
# assembler's to pin. pin_seeded_times() does not touch mtime by design, so this
# needs its own `touch` in the assembler; without it the stamp's mtime is
# assembly time and the image moves by five bytes and nothing else.
check "the stamp the assembler authors has its mtime pinned too" \
    "$(inode_time "/.mos-var-seeded" mtime)" "${WANT_TIME_HEX}"

echo "--- slot sizing: the growth path ---"
# The floor is what every assembly above exercised, because a 4 MiB payload is
# far below MOS_ROOTFS_SLOT_MIB. The other branch -- headroom applied, then
# rounded up to the alignment -- is arithmetic no byte comparison can reach: a
# port that dropped the alignment would still rebuild identically and would
# produce a slot RAUC's install cannot write to on the day the rootfs grows.
# Restated here from the layout's own three keys rather than from the
# assembler's expression, so the two are independent.
OVERSIZE_MIB=$(( MOS_ROOTFS_SLOT_MIB * 100 / ROOTFS_SLOT_HEADROOM_PCT + 3 * ROOTFS_SLOT_ALIGN_MIB ))
GROWN_MIB=$(( (OVERSIZE_MIB * ROOTFS_SLOT_HEADROOM_PCT + 99) / 100 ))
GROWN_MIB=$(( (GROWN_MIB + ROOTFS_SLOT_ALIGN_MIB - 1) / ROOTFS_SLOT_ALIGN_MIB * ROOTFS_SLOT_ALIGN_MIB ))
check "the oversize fixture really does exceed the floor" \
    "$([ "${GROWN_MIB}" -gt "${MOS_ROOTFS_SLOT_MIB}" ] && echo grows || echo does-not)" grows
mv "${OUT_DIR}/rootfs-verity.img" "${WORK}/rootfs-verity-small.img"
truncate -s "${OVERSIZE_MIB}M" "${OUT_DIR}/rootfs-verity.img"
build_factory_var
assemble grown.img || { echo "RESULT: FAIL"; exit 1; }
GROWN_IMG="${WORK}/grown.img"
check "an oversize payload grows the slot past the floor" \
    "$(sgdisk -i "${ROOTFS_A_PARTNUM}" "${GROWN_IMG}" | sed -n 's/^Partition size: //p' | cut -d' ' -f1)" \
    "$(mib_to_sectors "${GROWN_MIB}")"
check "the grown slot is a multiple of ROOTFS_SLOT_ALIGN_MIB" \
    "$(( GROWN_MIB % ROOTFS_SLOT_ALIGN_MIB ))" 0
check "both slots grow together" \
    "$(sgdisk -i "${ROOTFS_B_PARTNUM}" "${GROWN_IMG}" | sed -n 's/^Partition size: //p' | cut -d' ' -f1)" \
    "$(mib_to_sectors "${GROWN_MIB}")"
check "the grown image is still ${IMAGE_TAIL_SLACK_MIB} MiB longer than its last partition" \
    "$(( $(stat -c %s "${GROWN_IMG}") / MIB_BYTES - $(( ($(sgdisk -i "${DATA_PARTNUM}" "${GROWN_IMG}" | sed -n 's/^Last sector: //p' | cut -d' ' -f1) + 1) * SECTOR_SIZE / MIB_BYTES )) ))" \
    "${IMAGE_TAIL_SLACK_MIB}"
rm -f "${GROWN_IMG}"
mv "${WORK}/rootfs-verity-small.img" "${OUT_DIR}/rootfs-verity.img"

# ============================================================================
# THE REFUSALS, EACH DRIVEN FROM THE FAILING SIDE
# ============================================================================
# Two classes, and the difference between them is worth stating because it is a
# property of what each guard defends against rather than a convenience.
#
#   FIXTURE-DRIVEN. The guard is about an INPUT -- the layout, the grub.cfg
#   template, the exported /var -- so mutating that input is a faithful
#   simulation of the mistake. Every case in this class runs the shipped
#   assembler unmodified.
#
#   PRODUCER-DRIVEN. Three guards are about the assembler's OWN output, and no
#   input reaches them: nothing in board.env, grub.cfg or factory-var can put a
#   kernel on the ESP, make grub-editenv write a file that is not 1024 bytes, or
#   give the two boot slots different contents. They exist to catch a future
#   EDIT to the assembler, so the failing side has to be that edit, made in the
#   workspace copy. Two guards keep it honest: the doctored copy must differ
#   from the shipped one (or the case would pass vacuously), and the refusal's
#   own text is required to be present in the SHIPPED file by the register check
#   at the top -- so the message a doctored run prints is the shipped script's
#   message and not something this file put there.
restore_tree() {
    cp "${LAYOUT_ENV}" "${TREE_LAYOUT}"
    cp "${GRUB_CFG_IN}" "${TREE_GRUB_CFG}"
    cp "${ASSEMBLER}" "${TREE_ASSEMBLER}"
    build_factory_var
}

mutate() { # label file sed-expression
    local label="$1" target="$2" expr="$3"
    sed -i "${expr}" "${target}"
    if cmp -s "${target}" "${OS_DIR}/${target#"${TREE}/os/"}"; then
        fail "${label}: the mutation changed nothing; the case would pass vacuously"
        return 1
    fi
    return 0
}

doctor() { # label sed-expression expected-changed-line-count
    local label="$1" expr="$2" want="$3" changed
    sed "${expr}" "${ASSEMBLER}" > "${TREE_ASSEMBLER}"
    changed="$(diff "${ASSEMBLER}" "${TREE_ASSEMBLER}" | grep -cE '^[<>]' || true)"
    if [ "${changed}" -eq 0 ]; then
        fail "${label}: the doctoring changed nothing; the case would pass vacuously"
        return 1
    fi
    check "${label}: the doctoring touches ${want} line(s) of the assembler" "${changed}" "${want}"
    return 0
}

echo "--- a missing rootfs input ---"
mv "${OUT_DIR}/boot/vmlinuz" "${WORK}/vmlinuz.aside"
expect_refusal "the kernel the rootfs build exports is absent" "missing-input" \
    "Build the root first" "MOS_BOARD=x64 bash os/rootfs/build-v2.sh"
mv "${WORK}/vmlinuz.aside" "${OUT_DIR}/boot/vmlinuz"

echo "--- a missing factory /var ---"
# The message must name x64 as a LITERAL. It used to interpolate ${MOS_BOARD},
# which no board.env sets and this script needs for nothing, so under `set -u`
# the one case somebody wrote an actionable message for died with
# "MOS_BOARD: unbound variable" instead of printing it. A ${MOS_BOARD:-x64}
# default would still be wrong -- a cx3576 left in the environment would tell
# the reader to build the wrong board's rootfs -- so the run below deliberately
# carries the OTHER board in MOS_BOARD and requires the message not to move.
mv "${FACTORY_VAR}" "${WORK}/factory-var.aside"
expect_refusal "the exported factory /var is absent" "missing-factory-var" \
    "run 'MOS_BOARD=x64 bash os/rootfs/build-v2.sh' first"
wrongboard_rc=0
env MOS_BOARD=cx3576 bash "${TREE_ASSEMBLER}" > "${WORK}/wrongboard.log" 2>&1 || wrongboard_rc=$?
check "a wrong MOS_BOARD in the environment still refuses" \
    "$([ "${wrongboard_rc}" -ne 0 ] && echo refused || echo assembled)" refused
if grep -cF "MOS_BOARD=x64 bash os/rootfs/build-v2.sh" "${WORK}/wrongboard.log" >/dev/null; then
    pass "a wrong MOS_BOARD in the environment does not move the message off x64"
else
    fail "with MOS_BOARD=cx3576 set, the message named the wrong board: $(tr '\n' ' ' < "${WORK}/wrongboard.log")"
fi
if grep -cF "unbound variable" "${WORK}/wrongboard.log" >/dev/null; then
    fail "the missing-factory-var path still dies on an unbound variable instead of printing its message"
else
    pass "the missing-factory-var path reaches its message rather than an unbound-variable death"
fi
mv "${WORK}/factory-var.aside" "${FACTORY_VAR}"

echo "--- a factory /var with no lib/ ---"
rm -rf "${FACTORY_VAR:?}/lib"
expect_refusal "the exported /var has no lib/" "factory-var-no-lib container-failed" \
    "no dpkg database and no mosd state directory"
restore_tree

echo "--- an unrendered placeholder in grub.cfg ---"
if mutate "unrendered placeholder" "${TREE_GRUB_CFG}" \
    's|@BOARD_CMDLINE_ARGS@|@BOARD_CMDLINE_ARGS@ @MOS_NEVER_RENDERED@|'; then
    expect_refusal "grub.cfg carries a placeholder nothing renders" "unrendered-placeholder" \
        "@MOS_NEVER_RENDERED@"
fi
restore_tree

echo "--- a literal verity hash on a linux line ---"
# THE DEFECT RFCT-106 EXISTS TO REMOVE. grub.cfg is the one file on the ESP that
# no install ever rewrites, so a root hash baked into it is a per-install fact
# frozen at flash time: every update would install a new rootfs and leave the
# bootloader asserting the old one's hash, and the machine would fail verity on
# the first boot after the first update.
if mutate "literal hash" "${TREE_GRUB_CFG}" \
    "s|\${MOS_ROOT_HASH}|${FAKE_ROOT_HASH}|g"; then
    expect_refusal "grub.cfg carries a literal root hash" "literal-hash" \
        "it belongs in the per-slot fragment RAUC installs"
fi
restore_tree

echo "--- a linux line that no longer reads the fragment ---"
# The mirror image of the case above, and it is why that one is not enough on
# its own: a grub.cfg with no hash in it at all is "clean" by the first check
# and boots nothing, because the fragment RAUC installs on every update would be
# written and never read.
# shellcheck disable=SC2016  # the literal text ${MOS_ROOT_HASH} is what sed must match
if mutate "unused fragment variable" "${TREE_GRUB_CFG}" 's| \${MOS_ROOT_HASH}||g'; then
    expect_refusal "no linux line consumes the fragment's root hash" "unused-fragment-var" \
        "uses \${MOS_ROOT_HASH}" "installed and never read"
fi
restore_tree

echo "--- an ESP below the FAT32 cluster floor ---"
# The measured floor is 33 MiB; 32 is the size that actually shipped and did not
# boot. mkfs.vfat writes a FAT32 boot sector over it and reports success, mtools
# reads it happily, and OVMF leaves the partition out of its filesystem list
# entirely -- the machine drops to the UEFI shell having printed nothing about
# an ESP at all. Nothing downstream of a wrong ESP_SIZE_MIB can catch this;
# refusing at build time is the entire defence.
if mutate "ESP below the cluster floor" "${TREE_LAYOUT}" \
    's/^ESP_SIZE_MIB=.*/ESP_SIZE_MIB=32/'; then
    expect_refusal "the ESP is sized below 65525 clusters" "esp-cluster-floor container-failed" \
        "Raise ESP_SIZE_MIB (33 MiB is the measured floor)"
fi
restore_tree

echo "--- a FILE_MTIME the timestamp pass cannot write ---"
# This drives os/mkimage-common.sh's OWN refusal from x64's side, and it is the
# one guarantee in that file that x64 exercises differently from cx3576:
# mkimage-v2.sh runs under `set -euo pipefail` and x64's inner assembly script
# runs under `set -eu` with NO pipefail. pin_seeded_times() is written not to
# delegate either guarantee to pipefail -- debugfs exits 0 even when an
# individual command fails, so its STDERR is the only failure signal there is,
# and it is read directly rather than inferred from a pipeline status. That
# argument was made when the function was lifted into the shared file; this is
# it being run. A value `touch -d` accepts and debugfs's `sif` does not is what
# separates the two: it reaches the pass instead of dying earlier in the
# assembly, which is what makes the refusal the thing under test.
if mutate "unwritable FILE_MTIME" "${TREE_LAYOUT}" \
    's|^FILE_MTIME=.*|FILE_MTIME="2020-01-01 00:00:00"|'; then
    expect_refusal "debugfs cannot write the pinned timestamp" "pin-debugfs container-failed" \
        "could not pin the seeded timestamps in"
fi
restore_tree

echo "--- grubenv that is not 1024 bytes ---"
# PRODUCER-DRIVEN (see the note above the two classes). grub-editenv creates a
# grubenv at a fixed 1024 bytes and RAUC rewrites it in place with the same
# tool, so no input this script has can produce another size; what the guard
# defends against is a future edit here, or a grub whose editenv changes. GRUB
# ignores a file of any other size SILENTLY, so the failure it prevents is an
# A/B order that never changes: updates install, are marked good, and the device
# keeps booting the slot it was flashed with.
if doctor "grubenv size" \
    's|^grub-editenv grubenv set A_OK=0 A_TRY=0 B_OK=0 B_TRY=0$|&\nprintf x >> grubenv|' 1; then
    expect_refusal "grubenv is not 1024 bytes" "grubenv-size container-failed" \
        "GRUB would ignore it and the A/B order would silently never change"
fi
restore_tree

echo "--- a per-slot file back on the ESP ---"
# PRODUCER-DRIVEN. The ESP belongs to no slot group, so a kernel that reappeared
# on it would be a per-install file on the one partition RAUC never installs
# into: an update would replace the slot's copy and leave this one, and which of
# the two GRUB read would depend on a path nothing in the boot chain guarantees.
# The previous x64 layout had exactly this shape -- two ESPs, no slot boot pair,
# every update written where nothing reads it.
if doctor "a kernel on the ESP" \
    's|^mcopy -s -m -i esp.img esp-stage/EFI ::/$|&\nmcopy -m -i esp.img vmlinuz ::/vmlinuz|' 1; then
    expect_refusal "a per-slot kernel is copied to the ESP root" "esp-stray container-failed" \
        "on the ESP no install would ever replace it"
fi
restore_tree

echo "--- boot slots that do not carry the same files ---"
# PRODUCER-DRIVEN. An image whose B slot were missing a file has nothing to fall
# back TO, and the discovery happens on the first bad update -- on a device, at
# the moment its owner most needs the fallback to be there.
# shellcheck disable=SC2016  # sed must see ${slot} and ${SLOT_CMDLINE_NAME} literally
if doctor "slot B loses its cmdline" \
    's|^    mcopy -m -i "boot-${slot}.img" cmdline.cfg "::/${SLOT_CMDLINE_NAME}"$|    [ "${slot}" = b ] \|\| mcopy -m -i "boot-${slot}.img" cmdline.cfg "::/${SLOT_CMDLINE_NAME}"|' 2; then
    expect_refusal "the two boot slots differ" "boot-slots-differ container-failed" \
        "the two boot slots do not carry the same files"
fi
restore_tree

echo "--- the tree is back to the shipped one ---"
# Every case above mutated a file the next case reads. A restore that silently
# stopped working would make every later case run against the previous case's
# mutation, which is the failure mode most likely to look like a pass.
for pair in "${ASSEMBLER}:${TREE_ASSEMBLER}" "${LAYOUT_ENV}:${TREE_LAYOUT}" "${GRUB_CFG_IN}:${TREE_GRUB_CFG}"; do
    if cmp -s "${pair%%:*}" "${pair#*:}"; then
        pass "$(basename "${pair%%:*}") was restored after the last mutation"
    else
        fail "$(basename "${pair%%:*}") was left mutated; every case after the one that changed it ran against the wrong file"
    fi
done
# ...and the restored tree still assembles. Without this the restore assertions
# above prove only that three files compare equal, not that the thing they are
# part of still works -- and the very last state this script leaves behind is
# the one no later case would have exercised.
echo "--- assembly 3, on the restored tree ---"
assemble three.img || { echo "RESULT: FAIL"; exit 1; }
THREE_SHA="$(sha256sum "${WORK}/three.img" | cut -d' ' -f1)"
check "the restored tree assembles to the same bytes as the first two" "${THREE_SHA}" "${ONE_SHA}"

echo
echo "PASS=${PASSED} FAIL_STATE=${FAILED}"
if [ "${FAILED}" -eq 0 ]; then
    echo "RESULT: PASS"
else
    echo "RESULT: FAIL"
    exit 1
fi
