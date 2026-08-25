#!/usr/bin/env bash
set -euo pipefail

# Verifies a cx3576 mos disk image against the layout-v2 image contract:
# the eleven-partition A/B GPT, the uboot-mos blob inside its own loader
# partition, both FAT32 boot slots,
# the squashfs+dm-verity rootfs payload and the packed root filesystem's
# contents (mosd/apid, hwinit, RAUC, health gate, storage tiers).
# Emits one PASS:/FAIL: line per check and a final
# "RESULT: PASS|FAIL (n/m checks)" summary; exits non-zero if any check fails.
# Totals are dynamic (PASS_N/total); nothing to hand-bump when checks change.
#
# v1 (os/verify-image.sh) is untouched and keeps verifying the single-slot
# image; this is a sibling, not a rewrite.
#
# Every layout constant is read from os/layout/cx3576-v2.env. Nothing here
# restates a GUID, an offset or a size, and nothing here enumerates a unit list
# that the image itself can be asked for: the hwinit set grows, and a hardcoded
# list is how a newly added unit silently falls outside coverage.
#
# NO host mutation: no loop mounts, no losetup, no device-mapper, no mount(8).
# GPT is read with sgdisk, the FAT slots with mtools at an offset, the ext4
# partitions by dd-extracting them and reading them with debugfs/tune2fs, and
# the rootfs by dd-extracting the slot and running unsquashfs + `veritysetup
# verify` (a userspace hash-tree walk — it never opens a dm device). When the
# host lacks a required tool the whole verification re-executes inside an
# Alpine container, exactly as v1 and the assembler do.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"
# MOS_BOARD selects the layout this verifier checks against. Defaulted to
# cx3576 so every existing invocation is unchanged; the x64/QEMU image is
# verified by the same assertions, which is the point of having them read the
# layout rather than name partitions and a bootloader directly.
MOS_BOARD="${MOS_BOARD:-cx3576}"
LAYOUT_ENV="${SCRIPT_DIR}/layout/${MOS_BOARD}-v2.env"

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"

# READ FROM THE IMAGE, not pinned. "6.1.115" is the cx3576 BSP kernel; x64 runs
# Debian's (6.12.101+deb13-amd64), so a literal here fails a correct image and
# says the modules directory is wrong. Resolved after the root is unpacked --
# see KERNEL_VERSION= below the unpack.
KERNEL_VERSION=""

INNER=0
EXPECT_SYMLINK=0
IMG=""
while [ $# -gt 0 ]; do
    case "$1" in
    --inner) INNER=1 ;;
    --expect-symlink) EXPECT_SYMLINK=1 ;;
    *) IMG="$1" ;;
    esac
    shift
done

# MOS_VERIFY_FIXTURE_ROOT redirects the ONE input a small set of assertions
# read -- a directory standing in for the unpacked read-only root, holding an
# etc/fstab, the mountpoints and /usr/bin/apid -- and runs that set and nothing
# else. It exists so os/ui-location-test.sh can drive THIS EXACT SCRIPT against
# mutated fixtures and watch the assertions fail, without building an image;
# nothing in the build or in make os-verify-cx3576-v2 sets it. A verifier
# assertion that has only ever been observed passing is not evidence, and a
# reimplementation of it inside a test would be exactly that.
#
# The set is check_ui_location, check_builtin_ui, check_packed_mountpoints,
# check_status_led, check_dev_keyring, check_ext_unit_dir and check_ext_policy,
# and it is expected to GROW.
# os/ui-location-test.sh names the members it expects and diffs that against
# what actually ran, so widening this hook makes that test say which name it
# did not expect rather than silently changing a count -- which is why the
# count it used to assert had to go.
FIXTURE_ROOT="${MOS_VERIFY_FIXTURE_ROOT:-}"

if [ -z "${FIXTURE_ROOT}" ]; then
    if [ -z "${IMG}" ]; then
        IMG="${REPO_ROOT}/_out/${MOS_BOARD}/${IMAGE_LATEST_NAME}"
        EXPECT_SYMLINK=1
    fi
    if [ ! -e "${IMG}" ]; then
        echo "error: image not found: ${IMG}" >&2
        exit 1
    fi

    # STALENESS. Nothing above ties this run to the tree it is checking, and a
    # verifier pointed at an old image reports PASS in the present tense about
    # work that is not in it. That is not hypothetical: during PLAN-012 M2 this
    # script was one command away from verifying a six-hour-old image built
    # from the distribution's podman and reading the result as a description of
    # the self-built one.
    #
    # mtime, not a hash: the inputs are a squashfs and a directory of binaries,
    # and what is being caught is "you forgot to re-run the build", which mtime
    # answers exactly. MOS_VERIFY_ALLOW_STALE=1 exists for verifying a
    # downloaded release image, where the local tree is not its source at all.
    if [ "${MOS_VERIFY_ALLOW_STALE:-0}" != "1" ]; then
        stale=""
        # Board-derived, not literal. These named cx3576 and out-arm64
        # whatever board was being verified, so an x64 run's freshness was
        # judged by arm64 artefacts -- it would pass on a stale x64 image and
        # refuse a fresh one whenever the arm64 tree happened to be newer.
        for input in "${REPO_ROOT}/_out/${MOS_BOARD}/rootfs-verity.img" \
                     "${REPO_ROOT}/os/podman/out-${MOS_ARCH}/podman"; do
            [ -e "${input}" ] || continue
            [ "${input}" -nt "${IMG}" ] && stale="${stale} ${input##*/}"
        done
        if [ -n "${stale}" ]; then
            echo "error: ${IMG##*/} is OLDER than${stale}. Verifying it would report on an image the current tree did not produce — re-run 'make os-image-cx3576-v2', or set MOS_VERIFY_ALLOW_STALE=1 when checking a downloaded release image whose source is not this tree" >&2
            exit 1
        fi
    fi
fi

# Re-exec in a container when the host lacks any required tool. unsquashfs,
# veritysetup and setcap/getcap are the v2 additions over v1's set; fdtget came
# with the boot-slot device-tree assertions and is provided by Alpine's dtc.
REQUIRED_TOOLS=(sgdisk mdir mcopy mlabel debugfs tune2fs dumpe2fs e2fsck cmp
    unsquashfs veritysetup getcap setcap fdtget)
if [ "${INNER}" -eq 0 ] && [ -z "${FIXTURE_ROOT}" ]; then
    missing=0
    for tool in "${REQUIRED_TOOLS[@]}"; do
        command -v "${tool}" >/dev/null 2>&1 || missing=1
    done
    if [ "${missing}" -eq 1 ]; then
        echo "required tools not all available on the host; verifying in a container" >&2
        img_dir="$(cd "$(dirname "${IMG}")" && pwd)"
        img_base="$(basename "${IMG}")"
        mounts=(-v "${REPO_ROOT}:/work:ro")
        # Never let docker create BOARD_DIR on the host; mount an empty dir
        # instead so the compare checks fail cleanly.
        tmp_board=""
        if [ -d "${BOARD_DIR}" ]; then
            mounts+=(-v "${BOARD_DIR}:/board:ro")
        else
            tmp_board="$(mktemp -d)"
            mounts+=(-v "${tmp_board}:/board:ro")
        fi
        case "${img_dir}/" in
        "${REPO_ROOT}/"*)
            img_in="/work${img_dir#"${REPO_ROOT}"}/${img_base}"
            ;;
        *)
            mounts+=(-v "${img_dir}:/img:ro")
            img_in="/img/${img_base}"
            ;;
        esac
        inner_args=(--inner)
        if [ "${EXPECT_SYMLINK}" -eq 1 ]; then
            inner_args+=(--expect-symlink)
        fi
        inner_args+=("${img_in}")
        rc=0
        # -e MOS_EXPECT_DEV_KEYRING: the dev-keyring escape must survive the
        # container re-exec, or a sanctioned dev image would verify green on a
        # tool-ful host and red on a tool-less one. docker only propagates the
        # variable when it is set on this side; it never invents a value.
        # -e MOS_BOARD: same reasoning, and it bites harder. Without it the
        # container re-exec falls back to the cx3576 layout, so `MOS_BOARD=x64
        # verify-image-v2.sh` on a tool-less host checks the x64 image against
        # cx3576's eleven-partition GPT and reports 191 failures that are all
        # the harness's. Observed exactly that way.
        # -e MOS_VERIFY_ALLOW_STALE: the third variable to need this, and the
        # third to be found by it silently not working. The staleness guard
        # runs on BOTH sides of the re-exec, so an outer run told to allow a
        # stale image re-checks it inside and refuses -- with a message about
        # the image, which sends the reader to rebuild something that is not
        # the problem.
        docker run --rm "${mounts[@]}" -e BOARD_DIR=/board -e MOS_EXPECT_DEV_KEYRING \
            -e MOS_BOARD="${MOS_BOARD}" -e MOS_VERIFY_ALLOW_STALE alpine:3.21 \
            sh -c 'apk add --no-cache -q bash coreutils diffutils gptfdisk sgdisk dosfstools mtools e2fsprogs e2fsprogs-extra squashfs-tools cryptsetup libcap libcap-setcap dtc && exec bash /work/os/verify-image-v2.sh "$@"' \
            _ "${inner_args[@]}" || rc=$?
        if [ -n "${tmp_board}" ]; then
            rmdir "${tmp_board}" 2>/dev/null || true
        fi
        exit "${rc}"
    fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
export MTOOLS_SKIP_CHECK=1

PASS_N=0
FAIL_N=0
pass() {
    PASS_N=$((PASS_N + 1))
    echo "PASS: $*"
}
fail() {
    FAIL_N=$((FAIL_N + 1))
    echo "FAIL: $*"
}

# A SKIP IS NOT A PASS, and it must not be able to look like one.
#
# Some assertions describe a bootloader only one board has: U-Boot's loader
# blob at a fixed sector, its redundant environment, its boot script. On a
# grub board they are not failures and they are not successes -- they are
# checks that do not apply, and the only wrong thing to do with them is run
# them silently or not at all.
#
# Both wrong outcomes produce the same green as a real pass. This repository
# has found that family of defect five times in one afternoon, so a skip here
# is PRINTED, COUNTED and carried into the summary, and it must say what does
# not apply and WHY -- because "not applicable" without a reason is how a
# check that should have run comes to be skipped forever.
SKIP_N=0
skip() {
    SKIP_N=$((SKIP_N + 1))
    echo "SKIP: $*"
}

# True when the layout's RAUC backend counts boot attempts through a U-Boot
# environment -- which is what every assertion below that mentions LOADER_* or
# UENV_* is really about.
is_uboot_board() { [ "${RAUC_BOOTLOADER}" = "uboot" ]; }

# GPT tooling prints GUIDs uppercase; udev/libblkid print the same GUIDs
# lowercase, and that is the spelling a kernel cmdline, an fstab entry and a
# RAUC device path must use. Both denote the same GUID, so every comparison in
# this script folds case first (the same rule os/mkimage-v2.sh states).
lc() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# Takes the first line of a stream WITHOUT an early exit.
#
# `| head -n1` closes the pipe the moment it has its line; the producer's next
# write raises SIGPIPE, `set -euo pipefail` at :2 turns that 141 into the exit
# status of the whole pipeline, and the run dies mid-check with NO FAIL: line
# and NO RESULT: line -- a signature that looks like a crash rather than a
# failed check, and one this campaign has already observed once. awk reads to
# EOF and prints only the first record, so there is no early exit left for the
# producer to be signalled by. Same reasoning as the `grep -F ... >/dev/null`
# at the libcrypt check below, which carries the same note.
#
# Whether any individual site is large enough to fill a 64 KiB pipe buffer is
# not the question: the fix costs one token and measuring a site costs a
# multi-thousand-run experiment that still would not settle it.
first_line() {
    awk 'NR == 1'
}

# Reads one KEY=value out of a plain env-style file without executing it.
env_file_get() {
    sed -n "s/^$2=//p" "$1" | tail -n1
}

# Compares two values case-insensitively and emits one PASS/FAIL line.
eq_ci() {
    local what="$1" got="$2" want="$3"
    if [ "$(lc "${got}")" = "$(lc "${want}")" ]; then
        pass "${what} is ${want}"
    else
        fail "${what} is '${got}', expected ${want}"
    fi
}

# ---------------------------------------------------------------------------
# The custom UI's location, as an asserted on-image fact.
#
# docs/design/api.md section 5.2 puts a customer's UI bundles at /srv/ui and
# argues that this needs no ninth bind and no seed unit, because /srv is the
# DATA partition's OWN mountpoint rather than a redirect. Everything that
# argument rests on was already asserted here -- but asserted about /srv AS A
# PARTITION. Neither the DATA fstab check nor the mountpoint-exists loop says
# where a custom UI lives, so the day the UI root is moved to /var/lib, or onto
# STATE for tidiness, both go on passing while every custom UI on every device
# either disappears at the next wipe or fills a 64 MiB partition. An assertion
# that holds whether or not the thing it protects is true is not an assertion.
#
# These checks CHAIN to those two rather than restating them. DATA_MOUNT is the
# mountpoint the DATA fstab check validates, and PACKED_MOUNTPOINTS is the set
# whose existence in the read-only root the mountpoint loop proves; both are
# consumed here and by the checks themselves, from one definition. What is new
# here is only the fact those two cannot express: which of them governs the
# path apid actually reads. Re-deriving either would add a line and no
# coverage.
#
# They are defined next to the other helpers, not at their call site below,
# because the fixture hook that negative-tests them dispatches before any image
# is opened.
UI_ROOT="/srv/ui"

# Section 6.3's escape, as an on-image fact. RFCT-075 fixed the reserved prefix
# in mosd/apid/src/routes.rs (BUILTIN / BUILTIN_PATH / BUILTIN_DEACTIVATE), and
# that a bundle cannot SHADOW it is a fact about dispatch order, asserted by the
# crate's own tests. Neither half is restated here. What no test in the crate
# can see is the IMAGE: section 6.2 says the built-in UI is maud expansions
# compiled into /usr/bin/apid, with no include_str!, no include_bytes! and no
# asset directory, and the reason that matters is section 6's requirement --
# "the artifact we guarantee will keep working forever is the one with no build
# chain". A crate test proves the sources say so. Only the image can say what
# was actually shipped.
BUILTIN_PREFIX="/builtin"
APID_BIN="/usr/bin/apid"
# A fragment of the escape page AS RENDERED: HTML syntax wrapped around the
# reserved prefix. maud expands the page into string literals inside the
# binary, so this byte sequence is in ${APID_BIN} if and only if the page is
# compiled into it. It is deliberately markup rather than a bare route
# constant: "/builtin/deactivate" on its own would still be in the binary after
# the pages moved out to an on-disk asset tree, which is the one change this is
# here to catch.
BUILTIN_MARKUP='<form method="post" action="/builtin/deactivate">'
DATA_MOUNT="/srv"
# The mountpoints the packed root has to SHIP, because nothing can create a
# directory on a verity root at runtime. Not the same set as "every mountpoint":
# /etc/ssh and /etc/hostapd are bind targets too, but Debian already ships them,
# so only the ones the pack stage creates are listed. The last member is
# PLAN-011 D5's writable unit directory, and it is the only one outside /mnt,
# /srv, /var and the two home binds -- it is here for exactly the same reason as
# the rest and not because it is a partition or a tier.
PACKED_MOUNTPOINTS="/mnt/state /mnt/meta /srv /var /home /root /usr/local/lib/systemd/system /etc/containers/systemd"

# Prints the /etc/fstab line whose mountpoint is the LONGEST prefix of $1: the
# entry that actually governs the filesystem that path lands on. Derived rather
# than looked up, so moving UI_ROOT moves the checks with it and mounting
# something else over the path it sits under is noticed rather than ignored.
# A deeper mountpoint wins over a shallower one, which is what the kernel does.
fstab_covering_line() {
    awk -v p="$1" '
        /^[[:space:]]*#/ { next }
        NF >= 4 {
            m = $2
            if (m == p || m == "/" || index(p, m "/") == 1) {
                if (length(m) > best) { best = length(m); line = $0 }
            }
        }
        END { print line }
    ' "${FSTAB}" 2>/dev/null || true
}

# Six assertions about UI_ROOT, each named below by WHAT IT CATCHES.
check_ui_location() {
    local line mnt dev opts dev_lc data_dev state_dev eph_dev shipped
    data_dev="partuuid=$(lc "${DATA_GUID}")"
    state_dev="partuuid=$(lc "${STATE_GUID}")"
    eph_dev="partuuid=$(lc "${EPHEMERAL_GUID}")"

    line="$(fstab_covering_line "${UI_ROOT}")"
    if [ -z "${line}" ]; then
        fail "catches a custom UI root with NO filesystem under it: no /etc/fstab entry covers ${UI_ROOT}, so it lands on the read-only verity squashfs. apid cannot create it on first install, no bundle can ever be installed, and the root is deliberately absent from fstab so no entry could ever come to cover it"
        return
    fi
    mnt="$(echo "${line}" | awk '{print $2}')"
    dev="$(echo "${line}" | awk '{print $1}')"
    opts="$(echo "${line}" | awk '{print $4}')"
    dev_lc="$(lc "${dev}")"

    # 1. Catches a UI root that has drifted off the DATA mount -- the one the
    #    growth, the survives-an-update story and section 5.2's whole "no bind
    #    needed" argument all belong to. Chained: DATA_MOUNT is the mountpoint
    #    the DATA fstab check validates, so a pass here means the entry that
    #    governs UI_ROOT is the entry that check already proved out.
    if [ "${mnt}" = "${DATA_MOUNT}" ] && [ "${dev_lc}" = "${data_dev}" ]; then
        pass "catches a custom UI root moved off DATA: ${UI_ROOT} resolves under ${DATA_MOUNT}, the DATA mount asserted above (${data_dev})"
    else
        fail "catches a custom UI root moved off DATA: ${UI_ROOT} resolves under mountpoint ${mnt} mounted from '${dev}', not under ${DATA_MOUNT} from ${data_dev}. DATA is the only partition systemd-repart grows, the only tier RAUC never touches on an update, and the only one section 5.2's no-bind argument holds for"
    fi

    # 2. Catches the tidy-looking move onto STATE, where the settings tree and
    #    the sshd host keys live in 64 MiB.
    if [ "${dev_lc}" != "${state_dev}" ]; then
        pass "catches a custom UI root moved onto STATE: ${UI_ROOT} is not governed by ${state_dev}"
    else
        fail "catches a custom UI root moved onto STATE: ${UI_ROOT} is governed by ${mnt}, mounted from ${state_dev}. STATE is 64 MiB, section 5.3 keeps TWO bundle generations, and the first large bundle fills it -- taking the settings tree and the sshd host keys down with it while nothing about the UI reports the cause"
    fi

    # 3. Catches the move onto /var, which is wiped by design.
    if [ "${dev_lc}" != "${eph_dev}" ]; then
        pass "catches a custom UI root moved onto the wipeable /var partition: ${UI_ROOT} is not governed by ${eph_dev}"
    else
        fail "catches a custom UI root moved onto the wipeable /var partition: ${UI_ROOT} is governed by ${mnt}, mounted from ${eph_dev}. /var is fixed-size disposable residue with no x-systemd.growfs, so every installed custom UI silently disappears the first time it is cleared and no bundle can outgrow the fixed partition"
    fi

    # 4. Catches a UI root under a mountpoint NOTHING has checked exists in the
    #    packed root. Chained: membership in PACKED_MOUNTPOINTS means the
    #    mountpoint loop already proves the directory is there, so its
    #    existence is not re-derived here -- only its relevance to UI_ROOT.
    local covered=0 known
    for known in ${PACKED_MOUNTPOINTS}; do
        [ "${known}" = "${mnt}" ] && covered=1
    done
    if [ "${covered}" -eq 1 ]; then
        pass "catches a custom UI root under an unasserted mountpoint: ${mnt} is in the set the packed-root mountpoint check proves exists (${PACKED_MOUNTPOINTS})"
    else
        fail "catches a custom UI root under an unasserted mountpoint: ${UI_ROOT} is governed by ${mnt}, which is NOT in the set the packed-root mountpoint check covers (${PACKED_MOUNTPOINTS}). Nothing asserts that directory exists in the read-only root, a verity root cannot create it at runtime, and the mount therefore fails silently into the squashfs"
    fi

    # 5. Catches a UI root with a ceiling. This is not the DATA entry's growfs
    #    restated: it is read off whichever entry governs UI_ROOT, so it keeps
    #    holding in exactly the case the DATA check cannot see -- the covering
    #    entry being some other partition.
    if [[ ",${opts}," == *",x-systemd.growfs,"* ]]; then
        pass "catches a custom UI root with a fixed ceiling: the entry governing ${UI_ROOT} (${mnt}) carries x-systemd.growfs"
    else
        fail "catches a custom UI root with a fixed ceiling: the entry governing ${UI_ROOT} (${mnt}) lacks x-systemd.growfs; options are '${opts}'. The bundle root is then capped at the size the image was built with however large the disk is, and section 5.3 spends two copies of every bundle on it"
    fi

    # 6. Catches ANY content baked under the UI root -- not merely the
    #    directory. Both failure modes are silent: a baked file on the
    #    read-only squashfs either WINS over the writable copy an operator
    #    installed, or NEVER UPDATES when the bundle beneath it changes, and
    #    neither produces an error anywhere.
    shipped=""
    if [ -e "${ROOT}${UI_ROOT}" ] || [ -L "${ROOT}${UI_ROOT}" ]; then
        shipped="$(find "${ROOT}${UI_ROOT}" 2>/dev/null |
            sed "s|^${ROOT}||" | sort |
            awk 'NR <= 5 { printf "%s ", $0 } END { if (NR > 5) printf "(+%d more) ", NR - 5 }')"
        [ -n "${shipped}" ] || shipped="${UI_ROOT} "
        shipped="${shipped% }"
    fi
    if [ -z "${shipped}" ]; then
        pass "catches content baked under the custom UI root: the packed read-only root ships nothing at or under ${UI_ROOT}, which is the defined shipped state -- apid creates it on first install and no seed unit is owed"
    else
        fail "catches content baked under the custom UI root: the packed read-only root ships ${shipped}. Anything baked there sits on the read-only squashfs, where it either silently WINS over the bundle an operator installed or silently NEVER UPDATES when that bundle changes -- neither raises an error anywhere. Absence is the defined shipped state: there is no seed unit and none is needed"
    fi
}

# Two assertions about the built-in UI, each named by WHAT IT CATCHES.
check_builtin_ui() {
    local shipped

    # 1. Catches the built-in escape growing an on-disk half. The reserved
    #    prefix is a URL namespace served out of the binary; the packed root
    #    has no namesake for it and must not acquire one. The day it does, the
    #    escape has stopped being the one artifact with no build chain and has
    #    become two artifacts that must be shipped in step -- and a stale or
    #    missing second half fails exactly when the escape is being used,
    #    which is when everything else is already broken.
    shipped=""
    if [ -e "${ROOT}${BUILTIN_PREFIX}" ] || [ -L "${ROOT}${BUILTIN_PREFIX}" ]; then
        shipped="$(find "${ROOT}${BUILTIN_PREFIX}" 2>/dev/null |
            sed "s|^${ROOT}||" | sort |
            awk 'NR <= 5 { printf "%s ", $0 } END { if (NR > 5) printf "(+%d more) ", NR - 5 }')"
        [ -n "${shipped}" ] || shipped="${BUILTIN_PREFIX} "
        shipped="${shipped% }"
    fi
    if [ -z "${shipped}" ]; then
        pass "catches a built-in escape that has grown an on-disk half: the packed read-only root ships nothing at or under ${BUILTIN_PREFIX}, so section 6.2's compiled-in page is the whole of it"
    else
        fail "catches a built-in escape that has grown an on-disk half: the packed read-only root ships ${shipped}. Section 6.2 guarantees the built-in UI is maud expansions inside ${APID_BIN} and nothing else, because section 6 requires the fallback to be the artifact with NO build chain. A file tree under the reserved prefix is a second artifact that has to be built, shipped and kept in step with the binary, and when it is stale or missing the escape fails in precisely the situation it exists for"
    fi

    # 2. Catches the built-in UI leaving the binary. If the pages become an
    #    on-disk asset tree -- at any path, by include_str!, by an assets/
    #    directory, by anything -- the rendered markup stops being in the
    #    binary and this goes red. That is the image-side reading of section
    #    6.2's "no include_str!, no include_bytes!, no asset directory":
    #    it asserts the OUTCOME rather than enumerating the mechanisms.
    #
    #    tr-then-grep rather than `grep -a`: the same spelling the libcrypt
    #    check below uses, and it needs no busybox-vs-GNU grep flag.
    if [ ! -f "${ROOT}${APID_BIN}" ]; then
        fail "catches a built-in escape that is no longer inside the binary: ${APID_BIN} is not a regular file in the packed root, so there is nothing that could serve ${BUILTIN_PREFIX}/ at all"
    elif LC_ALL=C tr -c '[:print:]' '\n' <"${ROOT}${APID_BIN}" |
        grep -F -- "${BUILTIN_MARKUP}" >/dev/null; then
        pass "catches a built-in escape that is no longer inside the binary: the ${APID_BIN} packed in this image carries the escape page's own rendered markup (${BUILTIN_MARKUP}), so section 6.3's one documented action needs nothing off the disk"
    else
        fail "catches a built-in escape that is no longer inside the binary: the ${APID_BIN} packed in this image does NOT carry the escape page's rendered markup (${BUILTIN_MARKUP}). Either the pages have moved out to files -- and section 6.2's whole guarantee, that the fallback has no build chain and cannot be replaced, is gone -- or the form's spelling changed and BUILTIN_MARKUP above needs updating. Both are worth a red line: nothing else in this contract can tell the difference between a compiled-in escape and one that needs a directory to exist"
    fi
}

# fstab entries and the STATE binds need their mountpoints to exist in the
# read-only root: nothing can create them at runtime. PACKED_MOUNTPOINTS is the
# list, hoisted to a constant because check_ui_location chains to THIS check
# rather than re-deriving it -- see its comment.
#
# It lives up here beside check_ui_location, not down at its call site, for the
# same reason PACKED_MOUNTPOINTS does: the fixture hook runs it too, and that
# dispatches before any image is opened. Fixture mode running it is the point.
# RFCT-073's "/srv absent from the tree" case proves the six UI assertions do
# not RE-DERIVE mountpoint existence; it does not prove anything still catches
# a missing /srv, and those two are indistinguishable from outside unless the
# check this one delegates to is in the same run. It had only ever been
# observed passing, against real images, where /srv is always there.
check_packed_mountpoints() {
    local missing_mp="" d
    for d in ${PACKED_MOUNTPOINTS}; do
        [ -d "${ROOT}${d}" ] || missing_mp="${missing_mp} ${d}"
    done
    if [ -z "${missing_mp}" ]; then
        pass "every fstab/bind mountpoint exists in the read-only root (${PACKED_MOUNTPOINTS})"
    else
        fail "mountpoint(s) missing from the read-only root:${missing_mp}; a verity root cannot create them at runtime, so the mount fails"
    fi
}

# The status indicator's presence, mode, enablement and Exec lines are already
# asserted further down with the rest of the overlay payload. These two are
# separate because they defend a different thing: not that the indicator EXISTS
# but that its blue means the booted A/B slot was CONFIRMED. An indicator that
# is present, enabled and working, but fires at multi-user.target, turns the
# board blue during the window in which the slot is still unconfirmed -- and if
# the gate then fails, blue is showing on a board U-Boot will roll back on the
# next boot. That is a WRONG signal rather than a missing one, and no presence
# check can see it. They live here rather than beside the presence block so
# fixture mode can drive them without an image.
STATUS_LED_UNIT="/usr/lib/systemd/system/mos-status-led.service"
check_status_led() {
    local unit="${ROOT}${STATUS_LED_UNIT}"
    if [ -f "${unit}" ] && grep -Eq '^After=mos-health\.service$' "${unit}"; then
        pass "catches an indicator that reports ready before the slot is confirmed: mos-status-led.service is ordered after mos-health.service"
    else
        fail "catches an indicator that reports ready before the slot is confirmed: mos-status-led.service has no 'After=mos-health.service'. mos-health is what runs 'rauc status mark-good', so without this the board turns blue while the booted slot is still unconfirmed"
    fi
    if [ -f "${unit}" ] && grep -Eq '^Requires=mos-health\.service$' "${unit}"; then
        pass "catches an indicator that turns blue on a slot whose health gate failed: mos-status-led.service requires mos-health.service"
    else
        fail "catches an indicator that turns blue on a slot whose health gate failed: mos-status-led.service has no 'Requires=mos-health.service'. Ordering alone still starts the unit after a FAILED gate, so the board would read ready while U-Boot's BOOT_x_LEFT counter is about to roll it back"
    fi
}

# A RAUC keyring baked into the signed read-only root makes every flashed
# device trust every bundle that CA signs — for the dev CA of
# os/rauc/gen-dev-keys.sh, that is anyone holding a gitignored directory. The
# overlay path is gitignored precisely so a developer CAN drop one in for
# local bundle testing, which is why absence cannot be assumed and has to be
# asserted; os/rootfs/build-v2.sh refuses to stage one under the same toggle.
# MOS_EXPECT_DEV_KEYRING=1 is the explicit dev escape (same shape as the
# MOS_VERIFY_FIXTURE_ROOT hook): the check then PASSES, but never quietly —
# the WARNING line below is the price of admission. Nothing in the build or in
# make os-verify-cx3576-v2 sets it.
DEV_KEYRING_PATH="/etc/rauc/keyring.pem"
check_dev_keyring() {
    if [ ! -e "${ROOT}${DEV_KEYRING_PATH}" ] && [ ! -L "${ROOT}${DEV_KEYRING_PATH}" ]; then
        pass "catches a baked-in RAUC keyring: the packed root ships no ${DEV_KEYRING_PATH} (absence is the shipped state; rauc install fails closed until a keyring is provisioned)"
    elif [ "${MOS_EXPECT_DEV_KEYRING:-0}" = "1" ]; then
        echo "WARNING: DEVELOPMENT KEYRING SHIPPED — ${DEV_KEYRING_PATH} is baked into this image and MOS_EXPECT_DEV_KEYRING=1 waves it through. Every device flashed with this image trusts every bundle that CA signs. Never flash it onto anything that leaves your desk."
        pass "catches a baked-in RAUC keyring: ${DEV_KEYRING_PATH} is present but explicitly expected (MOS_EXPECT_DEV_KEYRING=1, development image — see the WARNING above)"
    else
        fail "catches a baked-in RAUC keyring: the packed root ships ${DEV_KEYRING_PATH}. A keyring inside the signed read-only root is a trusted signer on every device flashed with this image. If this is a local dev image meant to install locally signed bundles, re-run with MOS_EXPECT_DEV_KEYRING=1 and accept the warning; otherwise delete os/rootfs/overlay-v2${DEV_KEYRING_PATH} and rebuild"
    fi
}

# --- PLAN-011 D5: the writable, persistent system unit directory -------------
# What this proves: an integrator can install a systemd unit on the device and
# it is still there after a reboot and after an A/B update. Every unit directory
# the image ships is inside the dm-verity squashfs, so that property exists only
# if this bind exists, is enabled, and is backed by STATE. Where= and What= are
# READ from the unit rather than restated, on the same reasoning as the
# etc-ssh.mount block further down: retargeting the mount must not leave this
# passing for a path nothing mounts any more.
#
# The mountpoint's EXISTENCE is not asserted here. It is a member of
# PACKED_MOUNTPOINTS, so check_packed_mountpoints owns it -- and owning it there
# rather than here is what puts it inside the fixture hook, where
# os/ui-location-test.sh can watch it fail without an image.
EXT_UNIT_DIR="/usr/local/lib/systemd/system"
EXT_MOUNT_UNIT="usr-local-lib-systemd-system.mount"

# check_ext_unit_dir is a function ONLY so the fixture hook below can dispatch
# it; inlining it back at its one call site reopens the hole it closed. These
# assertions sat inline BELOW that hook for this campaign's whole span, so the
# negative guard could not fail: T8 forced etc_units_binds="" and got 18/18 PASS.
check_ext_unit_dir() {
    ext_f="${ROOT}/etc/systemd/system/${EXT_MOUNT_UNIT}"
    # "|| true" is not decoration: under set -euo pipefail a sed over a missing
    # file makes the pipeline non-zero and kills the script HERE, two lines
    # before the [ ! -f ] branch that exists to report the absence. Measured
    # once these became reachable -- exit 2, no RESULT line, the assertion
    # unreachable rather than merely unobserved. Same idiom as the find below.
    ext_where="$(sed -n 's/^Where=//p' "${ext_f}" 2>/dev/null | tail -n1 || true)"
    ext_what="$(sed -n 's/^What=//p' "${ext_f}" 2>/dev/null | tail -n1 || true)"
    if [ ! -f "${ext_f}" ]; then
        fail "${EXT_MOUNT_UNIT} is not in the image, so ${EXT_UNIT_DIR} stays on the read-only squashfs; a third-party unit written there is silently discarded at the next reboot and PLAN-011 D5's whole extension model does not work on the device"
    elif [ "${ext_where}" != "${EXT_UNIT_DIR}" ]; then
        fail "${EXT_MOUNT_UNIT} mounts '${ext_where:-<no Where=>}', not ${EXT_UNIT_DIR}; ${EXT_UNIT_DIR} is the directory in systemd's unit load path that the pack stage creates, so a bind anywhere else leaves it read-only and puts a writable directory somewhere systemd does not read"
    elif [ "${ext_what#/mnt/state/}" = "${ext_what}" ]; then
        fail "${EXT_MOUNT_UNIT} binds ${ext_where} from '${ext_what:-<no What=>}', which is not under /mnt/state; installed units would not be on the STATE partition and would be lost by the next A/B update or factory reset"
    elif [ -z "$(find "${ROOT}/etc/systemd/system" -name "${EXT_MOUNT_UNIT}" -path '*.wants/*' 2>/dev/null || true)" ]; then
        fail "${EXT_MOUNT_UNIT} exists but is not enabled (no *.wants symlink under /etc/systemd/system); the bind never runs, so installing a unit appears to work and stops working at the next boot"
    else
        pass "${EXT_UNIT_DIR} is a STATE-backed bind via ${EXT_MOUNT_UNIT} (What=${ext_what}), enabled, so a third-party unit installed there survives a reboot and an A/B update"
    fi

    # The negative half, and it is not symmetry for its own sake. PLAN-011 D5
    # ORIGINALLY named /etc/systemd/system as this bind's target and was corrected on
    # 2026-08-22. Anyone reading the superseded sentence would repair the "deviation"
    # by pointing the bind back at /etc/systemd/system, and that diff reads like
    # restoring the plan while actually reintroducing the hazard: the image ships
    # this boot chain's own mount units and their local-fs.target.wants symlinks in
    # that directory, so a bind over it is performed by a unit inside the directory
    # it hides and takes the enablement of every other STATE mount down with it.
    # Nothing else in this file can tell that change apart from a legitimate one.
    etc_units_binds="$(grep -rlE '^Where=/etc/systemd/system(/|$)' \
        "${ROOT}/etc/systemd/system" "${ROOT}/usr/lib/systemd/system" \
        "${ROOT}/usr/local/lib/systemd/system" 2>/dev/null | sed "s|^${ROOT}||" | sort || true)"
    if [ -z "${etc_units_binds}" ]; then
        pass "no unit in the image mounts anything over /etc/systemd/system; the boot chain's own units and their local-fs.target.wants enablement stay inside the verity root"
    else
        fail "a unit in the image mounts over /etc/systemd/system ($(printf '%s' "${etc_units_binds}" | tr '\n' ' ')). That directory holds this boot chain's own mount units AND the local-fs.target.wants symlinks enabling them, so the bind is performed by a unit living in the directory it hides and shadows the enablement of every other STATE mount. PLAN-011 D5 named this target originally and it was rejected on 2026-08-22; the writable unit directory is ${EXT_UNIT_DIR}, and re-pointing it here looks like restoring the plan while reintroducing the defect"
    fi
}

# The three below are MOVED here from their original places further down, and
# the move is the whole point rather than tidying: check_ext_policy runs inside
# the fixture hook, which dispatches and exits ~1300 lines ABOVE where they used
# to be defined, so a policy check that referenced them from up here would call
# functions that did not exist yet (and read an unset MOSD_POLICY_PATH, which
# under set -u is a hard error, not an empty string). Their bodies are unchanged.

# Assert a file in the packed root matches an extended regex.
sq_grep() {
    local path="$1" pattern="$2" what="$3"
    if [ -f "${ROOT}${path}" ] && grep -Eq "${pattern}" "${ROOT}${path}"; then
        pass "${what}"
    else
        fail "${what} — ${path} missing or does not match /${pattern}/"
    fi
}

dbus_policy_rules_only() {
    awk '{
        line = $0
        out = ""
        while (length(line) > 0) {
            if (incomment) {
                p = index(line, "-->")
                if (p == 0) { line = ""; break }
                line = substr(line, p + 3)
                incomment = 0
            } else {
                p = index(line, "<!--")
                if (p == 0) { out = out line; line = ""; break }
                out = out substr(line, 1, p - 1)
                line = substr(line, p + 4)
                incomment = 1
            }
        }
        print out
    }' "$1"
}

MOSD_POLICY_PATH=/usr/share/dbus-1/system.d/com.mos.mosd.conf

# --- the extension D-Bus policy grants com.mos.ext.* and NOTHING ELSE --------
# PLAN-011 D5: third-party services are plain systemd units an integrator
# installs, and com.mos.ext.conf is the only thing that lets them take a bus
# name. It is one <allow own_prefix> rule, and both of the ways it can be wrong
# are silent on the device.
#
# Too narrow (a typo in the prefix) and every extension fails RequestName; that
# is annoying but loud. Too WIDE is the dangerous one, and it is a one-character
# edit: own_prefix="com.mos" reads in a diff like a simplification and actually
# grants ownership of com.mos.mosd to every local uid on the device. A unit with
# DefaultDependencies=no could then take the name before mosd does, and apid
# would spend the boot talking to an impostor -- with the root-only rules in
# com.mos.mosd.conf fully intact and every mosd policy check above still passing,
# because none of them can see a grant that lives in another file.
#
# The negative assertions below are therefore the ones that earn their keep, and
# they run against the file with XML COMMENTS STRIPPED. com.mos.ext.conf
# documents this exact hazard in prose, so a raw grep would fire on the warning
# and force somebody to choose between the check and the explanation.
EXT_POLICY_PATH=/usr/share/dbus-1/system.d/com.mos.ext.conf

# check_ext_policy is a function ONLY so the fixture hook below can dispatch it;
# inlining it back at its one call site reopens the hole it closed. These four
# assertions sat inline BELOW that hook for this campaign's whole span, so the
# widened-prefix guard could not fail: T8 forced it never to fire and the suite
# still reported PASS with zero FAIL lines. This is the SECOND author to write
# assertions past that boundary -- see the warning at the hook exit.
# The same text as dbus_policy_rules_only, reflowed to ONE XML TAG PER LINE.
# D-Bus rules routinely span several source lines --
#     <allow send_destination="com.mos.mosd"
#            send_interface="com.mos.Item1"
#            send_member="GetItems"/>
# -- so anything that judges a rule line by line sees the bus name and the
# member on different lines and can conclude the grant names no member. Which
# is the more dangerous direction: it turns a correctly scoped grant into a
# reported hazard, and the obvious repair is to stop scoping it.
dbus_policy_tags() {
    dbus_policy_rules_only "$1" | tr '\n' ' ' | sed 's|>|>\n|g' |
        sed 's/^[[:space:]]*//; s/[[:space:]][[:space:]]*/ /g' | grep . || true
}

check_ext_policy() {
    ext_policy_rules="${TMP}/ext-policy-rules.xml"
    : >"${ext_policy_rules}"
    if [ -f "${ROOT}${EXT_POLICY_PATH}" ]; then
        dbus_policy_rules_only "${ROOT}${EXT_POLICY_PATH}" >"${ext_policy_rules}"
    fi

    # Positive: the grant is actually there. A policy file that grants nothing is
    # not a safe policy file, it is a broken one -- no extension can own its name.
    sq_grep "${EXT_POLICY_PATH}" 'allow own_prefix="com\.mos\.ext"' \
        "the extension D-Bus policy grants own_prefix=com.mos.ext, so extension services can take their bus names at all"
    # ...and it survives comment-stripping, i.e. it is a RULE and not the example
    # markup in the file's own commentary.
    if grep -Eq 'allow own_prefix="com\.mos\.ext"' "${ext_policy_rules}"; then
        pass "the own_prefix=com.mos.ext grant is a live rule, not text inside an XML comment"
    else
        fail "${EXT_POLICY_PATH} mentions own_prefix=com.mos.ext only inside an XML comment. dbus-daemon ignores comments, so no extension can own a com.mos.ext.* name and every extension unit dies at RequestName with AccessDenied"
    fi

    # Negative 1: the granted prefix is never com.mos. This is the widening mistake.
    if grep -Eq 'own_prefix="com\.mos"' "${ext_policy_rules}"; then
        fail "${EXT_POLICY_PATH} grants own_prefix=\"com.mos\", not \"com.mos.ext\". That hands ownership of com.mos.mosd to every local uid: a unit with DefaultDependencies=no can claim the name before mosd does and apid then talks to an impostor for the rest of the boot. The root-only rules in ${MOSD_POLICY_PATH} do not stop this -- own= is granted here"
    else
        pass "${EXT_POLICY_PATH} does not grant the widened own_prefix=\"com.mos\"; com.mos.mosd and every future system name stay outside the extension grant"
    fi

    # Negative 2: no rule grants a system name outright. own_prefix="com.mos.ext" is
    # the ONLY ownership this file is allowed to hand out; an own= rule here would
    # name a specific bus name, and the only names worth naming are the system ones.
    ext_own_grants="$(grep -Eo '<allow[^>]*own="[^"]*"' "${ext_policy_rules}" || true)"
    ext_bad_prefix="$(grep -Eo 'own_prefix="[^"]*"' "${ext_policy_rules}" |
        grep -Fxv 'own_prefix="com.mos.ext"' || true)"
    if [ -z "${ext_own_grants}" ] && [ -z "${ext_bad_prefix}" ]; then
        pass "${EXT_POLICY_PATH} grants exactly one thing -- own_prefix=com.mos.ext -- and no <allow own=> for any system name such as com.mos.mosd"
    else
        fail "${EXT_POLICY_PATH} grants ownership beyond the extension namespace:${ext_own_grants:+ own rules [${ext_own_grants}]}${ext_bad_prefix:+ unexpected prefixes [${ext_bad_prefix}]}. Every name outside com.mos.ext.* is a system name; granting one here opens it to every local uid on the device while com.mos.mosd.conf's root-only rules keep passing, because they cannot see a grant made in another file"
    fi
}

# --- PLAN-011 D6: the MQTT bridge, as the image actually installs it ---------
# What this proves: mos-mqttd is present, runs as an identity its D-Bus grant
# can name, is granted exactly the members it needs and none of the ones that
# would turn a compromise of the only network-facing daemon into device
# control, and can be pointed at a broker without reflashing.
#
# EVERY ONE OF THESE IS A DEFECT THE WIRING ACTUALLY HAD. The crate, the unit
# and the protocol tests were all green while the bridge was absent from the
# image entirely; when it was added, the unit's DynamicUser=yes could not be
# named by any <policy user=>, and its ExecStart hardcoded a broker host into
# a read-only squashfs. None of that is visible from the code side.
MQTTD_BIN="/usr/bin/mos-mqttd"
MQTTD_UNIT="/usr/lib/systemd/system/mos-mqttd.service"
MQTTD_POLICY_PATH="/usr/share/dbus-1/system.d/mos-mqttd.conf"
MQTTD_WANTS="/etc/systemd/system/multi-user.target.wants/mos-mqttd.service"
# Members of com.mos.mosd that the bridge must never be granted. Reboot and
# PowerOff are the appliance; SetSettings rewrites the persisted tree;
# SetTransientRootPassword writes a root credential into /etc/shadow.
MQTTD_FORBIDDEN_MEMBERS="Reboot PowerOff SetSettings SetTransientRootPassword"

check_mqttd() {
    for f in "${MQTTD_BIN}" "${MQTTD_UNIT}" "${MQTTD_POLICY_PATH}"; do
        if [ -f "${ROOT}${f}" ] && [ ! -L "${ROOT}${f}" ]; then
            pass "mqttd: ${f} is a regular file"
        else
            fail "mqttd: ${f} is missing or not a regular file, so the MQTT bridge PLAN-011 D6 specifies is not in this image at all — the crate builds and its protocol tests pass either way"
        fi
    done

    # "|| true" throughout: under set -euo pipefail a sed over a missing file
    # kills the script before the branch that exists to report the absence.
    mqttd_user="$(sed -n 's/^User=//p' "${ROOT}${MQTTD_UNIT}" 2>/dev/null | tail -n1 || true)"
    mqttd_dynamic="$(sed -n 's/^DynamicUser=//p' "${ROOT}${MQTTD_UNIT}" 2>/dev/null | tail -n1 || true)"
    mqttd_exec="$(sed -n '/^ExecStart=/,/[^\\]$/p' "${ROOT}${MQTTD_UNIT}" 2>/dev/null | tr -d '\\\n' || true)"
    mqttd_envfile="$(sed -n 's/^EnvironmentFile=//p' "${ROOT}${MQTTD_UNIT}" 2>/dev/null | tail -n1 || true)"

    # NOT enabled. mqtt.enabled is a master switch that seeds false for every
    # profile, and mosd starts the bridge from it; an enablement symlink baked
    # into the image is the one thing that switch cannot override.
    #
    # -L as well as -e, and not either alone: a wants symlink points at an
    # ABSOLUTE path under /usr/lib, which resolves to nothing whenever ROOT is
    # an unpacked tree rather than /. -e follows the link and would call a
    # present-but-dangling symlink absent, passing this check on exactly the
    # image that failed it.
    if [ ! -e "${ROOT}${MQTTD_WANTS}" ] && [ ! -L "${ROOT}${MQTTD_WANTS}" ]; then
        pass "mqttd: the bridge is NOT enabled in the image (${MQTTD_WANTS} absent); mosd starts it when mqtt.enabled becomes true and not before"
    else
        fail "mqttd: ${MQTTD_WANTS} exists, so the bridge starts at boot regardless of mqtt.enabled — publishing against a broker the same switch has not started, which is the 30s retry loop this work exists to end. The root filesystem is a read-only verity squashfs, so nobody can disable it on the device"
    fi

    # A STATIC identity. This is the one that silently breaks the grant.
    if [ -n "${mqttd_user}" ] && [ "${mqttd_dynamic:-no}" != "yes" ]; then
        pass "mqttd: the unit runs as the static user '${mqttd_user}', an identity a <policy user=> can resolve"
    else
        fail "mqttd: the unit sets User='${mqttd_user}' DynamicUser='${mqttd_dynamic}'. dbus-daemon resolves <policy user=> when it reads the file at startup, before any dynamic user for the unit exists, so the grant in ${MQTTD_POLICY_PATH} would load and match nothing. The bridge then connects to the broker and publishes nothing, with no error at the point of cause"
    fi

    # ...and the policy names THAT user. Two files, one number; either alone
    # is consistent with a grant nobody holds.
    # Comment-stripped AND tag-normalised: one XML tag per line. The shipped
    # rules wrap their attributes across three lines, so a line-oriented grep
    # for send_member= on a rule whose send_destination= is on the line above
    # finds nothing and reports a blanket grant that is not there. Measured on
    # the first run of this check against the real file.
    mqttd_rules="${TMP}/mqttd-policy-rules.xml"
    : >"${mqttd_rules}"
    if [ -f "${ROOT}${MQTTD_POLICY_PATH}" ]; then
        dbus_policy_rules_only "${ROOT}${MQTTD_POLICY_PATH}" |
            tr '\n' ' ' | sed 's/</\n</g' >"${mqttd_rules}"
    fi
    mqttd_policy_user="$(grep -Eo '<policy user="[^"]*"' "${mqttd_rules}" |
        sed 's/.*user="\(.*\)"/\1/' | sort -u | first_line || true)"
    if [ -n "${mqttd_user}" ] && [ "${mqttd_policy_user}" = "${mqttd_user}" ]; then
        pass "mqttd: the D-Bus grant names the same user the unit runs as ('${mqttd_user}'), as a live rule and not commentary"
    else
        fail "mqttd: the unit runs as '${mqttd_user}' but ${MQTTD_POLICY_PATH} grants '${mqttd_policy_user}' (after comment stripping). A grant naming the wrong identity is a rule that loads, matches nothing, and reads in review exactly like a working one"
    fi

    # The identity has to EXIST in the image, or systemd cannot start the unit
    # and dbus-daemon cannot resolve the rule.
    if [ -n "${mqttd_user}" ] &&
        awk -F: -v u="${mqttd_user}" '$1 == u {found = 1} END {exit !found}' \
            "${ROOT}/etc/passwd" 2>/dev/null; then
        pass "mqttd: '${mqttd_user}' exists in the image's /etc/passwd ($(awk -F: -v u="${mqttd_user}" '$1 == u {print "uid " $3 ", gid " $4 ", shell " $7}' "${ROOT}/etc/passwd"))"
    else
        fail "mqttd: the unit runs as '${mqttd_user}' and no such account is in ${ROOT}/etc/passwd. systemd refuses to start the unit and dbus-daemon drops the policy rule; both failures are at boot, on the device"
    fi

    # The grant is PER-MEMBER. A blanket send_destination would hand the
    # network-facing daemon everything on com.mos.mosd.
    mqttd_sends="$(grep -Eo '<allow[^>]*send_destination="com\.mos\.mosd"[^>]*' "${mqttd_rules}" || true)"
    mqttd_blanket=""
    while IFS= read -r rule; do
        [ -n "${rule}" ] || continue
        case "${rule}" in
        *send_member=*) ;;
        *) mqttd_blanket="${mqttd_blanket} [${rule}]" ;;
        esac
    done <<EOF
${mqttd_sends}
EOF
    if [ -n "${mqttd_sends}" ] && [ -z "${mqttd_blanket}" ]; then
        pass "mqttd: every grant on com.mos.mosd names a member; the bridge cannot reach the interface at large"
    elif [ -z "${mqttd_sends}" ]; then
        fail "mqttd: there is no grant on com.mos.mosd at all in ${MQTTD_POLICY_PATH}. com.mos.mosd is root-only, so the bridge reaches nothing: it connects to the broker, subscribes, and publishes an empty tree forever"
    else
        fail "mqttd: a grant on com.mos.mosd in ${MQTTD_POLICY_PATH} names no member:${mqttd_blanket}. That is the whole interface — Reboot, PowerOff, SetSettings and SetTransientRootPassword included — handed to the only daemon in the image with a network socket"
    fi

    # ...and none of the members it does name is one of the dangerous ones.
    mqttd_members="$(grep -Eo 'send_member="[^"]*"' "${mqttd_rules}" |
        sed 's/.*send_member="\(.*\)"/\1/' | sort -u || true)"
    mqttd_danger=""
    for m in ${MQTTD_FORBIDDEN_MEMBERS}; do
        if printf '%s\n' "${mqttd_members}" | grep -Fxc "${m}" >/dev/null; then
            mqttd_danger="${mqttd_danger} ${m}"
        fi
    done
    if [ -z "${mqttd_danger}" ]; then
        pass "mqttd: the granted members ($(printf '%s' "${mqttd_members}" | tr '\n' ' ')) include none of ${MQTTD_FORBIDDEN_MEMBERS// /, }"
    else
        fail "mqttd: ${MQTTD_POLICY_PATH} grants the bridge${mqttd_danger}. A compromise of the network-facing daemon becomes device control, and mosd's own root-only policy keeps passing because it cannot see a grant made in another file"
    fi

    # The broker must be configurable WITHOUT reflashing. The root is an
    # immutable squashfs: a hardcoded host is a host fixed at build time,
    # identical on every device the image is written to.
    case "${mqttd_exec}" in
    *'${MOS_MQTT_BROKER_HOST}'*)
        pass "mqttd: ExecStart takes the broker from the environment, so the address is not baked into the verity root"
        ;;
    *)
        fail "mqttd: ExecStart does not reference \${MOS_MQTT_BROKER_HOST}: [${mqttd_exec}]. The root filesystem is read-only and systemctl edit has nowhere to write, so a literal broker address here is the same address on every device flashed with this image, unchangeable"
        ;;
    esac

    # ...and the file it reads that from has to be on writable, persistent
    # storage, which on this appliance means a STATE-backed bind. Optional
    # (leading '-'), or an unconfigured device fails to start.
    mqttd_envpath="${mqttd_envfile#-}"
    mqttd_envdir="$(dirname "${mqttd_envpath:-/}")"
    mqttd_envmount="$(grep -rl "^Where=${mqttd_envdir}\$" \
        "${ROOT}/etc/systemd/system" 2>/dev/null | first_line || true)"
    if [ -z "${mqttd_envfile}" ]; then
        fail "mqttd: the unit has no EnvironmentFile= line at all, so ${MQTTD_UNIT}'s Environment= defaults are the only configuration and the broker cannot be changed on the device at all"
    elif [ "${mqttd_envfile}" = "${mqttd_envpath}" ]; then
        fail "mqttd: EnvironmentFile=${mqttd_envfile} is not optional (no leading '-'). A device whose operator has not written that file fails to start the unit, which is a worse default than running unconfigured"
    elif [ -n "${mqttd_envmount}" ]; then
        pass "mqttd: EnvironmentFile=${mqttd_envfile} sits under ${mqttd_envdir}, a bind mounted by $(basename "${mqttd_envmount}") (What=$(sed -n 's/^What=//p' "${mqttd_envmount}" | tail -n1)), so a broker configured on the device survives a reboot and an A/B update"
    else
        fail "mqttd: EnvironmentFile=${mqttd_envfile} sits under ${mqttd_envdir}, which no .mount unit in the image mounts. That path is inside the read-only verity squashfs, so the operator cannot write it and the broker stays whatever the image was built with"
    fi
}

# --- RFCT-104: the MQTT broker, installed and INERT -------------------------
# What this proves: mos-mqtt-broker is in the image, is startable at all (the
# unit names a static account and that account exists), and is NOT enabled.
# The last one is the point of the whole arrangement. mqtt.enabled is a master
# switch that seeds false, and mosd starts BOTH this unit and the bridge from
# it; a broker enabled in the image would be listening from early boot, before
# anything had consulted the switch.
#
# THERE IS NO POLICY FILE IN THIS SET AND THAT IS NOT AN OMISSION. The broker
# speaks no D-Bus at all: it reads one file mosd renders into /run and listens
# on a TCP socket, so it has nothing to be granted and nothing to be denied.
# The bridge is the half of the pair that talks to com.mos.mosd, and the
# assertions above are where its grant is checked.
BROKER_BIN="/usr/bin/mos-mqtt-broker"
BROKER_UNIT="/usr/lib/systemd/system/mos-mqtt-broker.service"
BROKER_WANTS="/etc/systemd/system/multi-user.target.wants/mos-mqtt-broker.service"

check_mqtt_broker() {
    for f in "${BROKER_BIN}" "${BROKER_UNIT}"; do
        if [ -f "${ROOT}${f}" ] && [ ! -L "${ROOT}${f}" ]; then
            pass "mqtt-broker: ${f} is a regular file"
        else
            fail "mqtt-broker: ${f} is missing or not a regular file, so mqtt.enabled has nothing to start. The bridge then publishes at a broker that is not in the image and retries forever, which is the noise this work exists to end"
        fi
    done

    # "|| true": under set -euo pipefail a sed over a missing unit kills the
    # script before the branch that exists to report the absence.
    broker_user="$(sed -n 's/^User=//p' "${ROOT}${BROKER_UNIT}" 2>/dev/null | tail -n1 || true)"
    broker_dynamic="$(sed -n 's/^DynamicUser=//p' "${ROOT}${BROKER_UNIT}" 2>/dev/null | tail -n1 || true)"

    # NOT enabled. The unit carries [Install] information deliberately, and the
    # image deliberately does not act on it.
    if [ ! -e "${ROOT}${BROKER_WANTS}" ] && [ ! -L "${ROOT}${BROKER_WANTS}" ]; then
        pass "mqtt-broker: the broker is NOT enabled in the image (${BROKER_WANTS} absent); mosd owns the lifecycle and starts it from mqtt.enabled"
    else
        fail "mqtt-broker: ${BROKER_WANTS} exists, so the broker listens from early boot on every device flashed with this image, before anything consulted mqtt.enabled — and mosd owns the lifecycle, so the switch it is meant to obey is the one thing that cannot turn it off. The root filesystem is a read-only verity squashfs, so systemctl disable has nowhere to write on the device"
    fi

    # A STATIC identity, for a different reason than the bridge's.
    if [ -n "${broker_user}" ] && [ "${broker_dynamic:-no}" != "yes" ]; then
        pass "mqtt-broker: the unit runs as the static user '${broker_user}', an identity a credentials file on STATE can be owned by"
    else
        fail "mqtt-broker: the unit sets User='${broker_user}' DynamicUser='${broker_dynamic}'. A dynamic uid is allocated at start and gone at stop, so /var/lib/mos/mqtt-broker-users.toml would be left owned by a number that names nobody on the next boot, and the only way to keep the credentials readable would be to make them readable by everyone"
    fi

    # ...and that identity has to EXIST in the image, or systemd refuses the
    # unit and mqtt.enabled turns on a broker that never comes up.
    if [ -n "${broker_user}" ] &&
        awk -F: -v u="${broker_user}" '$1 == u {found = 1} END {exit !found}' \
            "${ROOT}/etc/passwd" 2>/dev/null; then
        pass "mqtt-broker: the account '${broker_user}' is present in the image ($(awk -F: -v u="${broker_user}" '$1 == u {print "uid " $3 ", gid " $4 ", shell " $7}' "${ROOT}/etc/passwd"))"
    else
        fail "mqtt-broker: the unit runs as '${broker_user}' and no account of that name is in ${ROOT}/etc/passwd. systemd refuses to start the unit, so turning mqtt.enabled on brings up a bridge and no broker, and the failure is at boot on the device"
    fi
}

# --- the connd contract, READ from the reconcilers that own it ---------------
# Every path, prefix and unit name the connd assertions compare against is read
# from the mosd source rather than restated here. A constant restated in two
# places can drift, and this drift is invisible from the code side: a
# reconciler that renders into a directory the image does not provide, or
# drives a unit the image does not install, fails on the device and nowhere
# else.
#
# THE EXTRACTOR ITSELF ROTTED, WHICH IS WHY THIS IS A FUNCTION NOW.
# The sweep marker was read with a regex over `file_name.contains("...")`.
# network.rs was later refactored to an anchored `is_mos_managed()` using
# starts_with/ends_with, the regex stopped matching, and MOS_SWEEP became "".
# Two things followed and BOTH looked like results:
#   - the collision test is `case "${n}" in *"${MOS_SWEEP}"*)`, and with an
#     empty marker that glob is `**`, which matches every filename. The
#     verifier reported eight image .network files as colliding with a sweep
#     that would never have touched them.
#   - the nineteen assertions below the contract read fell back to hardcoded
#     defaults through `${STA_UNIT:-wpa_supplicant@.service}` and PASSED,
#     comparing the image against the verifier's own restatement of a contract
#     it had just failed to read. The FAIL line said "none of them mean
#     anything until this passes"; they went green anyway.
# Both fallbacks are gone. The marker is a PREFIX now, matching the code, and
# an unread contract makes the group fail rather than substitute.
#
# MOS_VERIFY_RECONCILER_DIR exists so os/ui-location-test.sh can point this at
# a mutated copy of the reconcilers and watch the read fail. Without it the
# rot above could not be driven, only waited for.
RECONCILER_DIR="${MOS_VERIFY_RECONCILER_DIR:-${REPO_ROOT}/mosd/mosd/src/reconciler}"

# Value of a `const NAME: &str = "...";` in one of the reconcilers.
mosd_const() {
    sed -n "s/^const $2: \&str = \"\(.*\)\";\$/\1/p" "${RECONCILER_DIR}/$1" 2>/dev/null | first_line
}
# The unit TEMPLATE name behind `format!("x@{interface}.service")`.
mosd_unit_template() {
    sed -n 's/^ *format!("\(.*\)@{interface}\.service")$/\1@.service/p' "${RECONCILER_DIR}/$1" 2>/dev/null | first_line
}
# The rendered configuration file name, still carrying `{interface}`.
mosd_config_name() {
    sed -n 's/^ *format!("\([^"]*{interface}[^"]*\.conf\)")$/\1/p' "${RECONCILER_DIR}/$1" 2>/dev/null | first_line
}

CONND_CONTRACT_READ=0
read_connd_contract() {
    STA_DIR="$(mosd_const wifi_client.rs DEFAULT_CONFIG_DIR)"
    AP_DIR="$(mosd_const wifi_ap.rs DEFAULT_CONFIG_DIR)"
    STA_UNIT="$(mosd_unit_template wifi_client.rs)"
    AP_UNIT="$(mosd_unit_template wifi_ap.rs)"
    STA_CONF="$(mosd_config_name wifi_client.rs)"
    AP_CONF="$(mosd_config_name wifi_ap.rs)"
    STA_PREFIX="$(mosd_const wifi_client.rs NETWORKD_PREFIX)"
    AP_PREFIX="$(mosd_const wifi_ap.rs NETWORKD_PREFIX)"
    # The namespace network.rs owns. is_mos_managed() is
    # `starts_with(P) && ends_with(".network")`, so this is a PREFIX and the
    # collision test below anchors on it. Read from the same line the code
    # tests with, and the `.network` half is asserted rather than assumed:
    # a marker read out of a starts_with that had lost its ends_with would
    # describe a wider sweep than the code performs.
    MOS_SWEEP="$(sed -n 's/.*file_name\.starts_with("\([^"]*\)").*/\1/p' \
        "${RECONCILER_DIR}/network.rs" 2>/dev/null | first_line || true)"
    MOS_SWEEP_SUFFIX="$(sed -n 's/.*file_name\.ends_with("\([^"]*\)").*/\1/p' \
        "${RECONCILER_DIR}/network.rs" 2>/dev/null | first_line || true)"

    if [ -n "${STA_DIR}" ] && [ -n "${AP_DIR}" ] && [ -n "${STA_UNIT}" ] && [ -n "${AP_UNIT}" ] &&
        [ -n "${STA_CONF}" ] && [ -n "${AP_CONF}" ] && [ -n "${STA_PREFIX}" ] &&
        [ -n "${AP_PREFIX}" ] && [ -n "${MOS_SWEEP}" ] && [ "${MOS_SWEEP_SUFFIX}" = ".network" ]; then
        CONND_CONTRACT_READ=1
        pass "read the connd contract out of mosd: ${STA_UNIT} <- ${STA_DIR}/${STA_CONF}, ${AP_UNIT} <- ${AP_DIR}/${AP_CONF}, networkd prefixes '${STA_PREFIX}'/'${AP_PREFIX}', sweep '${MOS_SWEEP}'*'${MOS_SWEEP_SUFFIX}'"
    else
        CONND_CONTRACT_READ=0
        fail "could not read the connd contract out of ${RECONCILER_DIR}: dirs '${STA_DIR}'/'${AP_DIR}', units '${STA_UNIT}'/'${AP_UNIT}', configs '${STA_CONF}'/'${AP_CONF}', prefixes '${STA_PREFIX}'/'${AP_PREFIX}', sweep '${MOS_SWEEP}'+'${MOS_SWEEP_SUFFIX}'. Every connd assertion below compares against these. They no longer fall back to hardcoded defaults, so they FAIL from here on rather than passing against the verifier's own restatement of a contract it could not read — see the empty-marker rot recorded above the extractor"
    fi
}

# --- the image's networkd namespace must not collide with mosd's -------------
# network.rs DELETES every file matching its own prefix that it did not itself
# render, and the two WiFi reconcilers deliberately sit outside that pattern.
# An image file that landed in either namespace would be swept away, or would
# shadow a reconciler's unit, on device and nowhere else.
check_networkd_namespace() {
    if [ "${CONND_CONTRACT_READ}" -ne 1 ]; then
        fail "the image's networkd namespace check did not run: the connd contract is unread, so there is no namespace to compare against. It previously ran anyway with an empty marker, which made its glob match every filename and reported eight collisions that could not happen"
        return
    fi
    # No -printf: this script also runs under busybox find inside the container.
    img_networks="$(for d in "${ROOT}/etc/systemd/network" "${ROOT}/usr/lib/systemd/network" \
        "${ROOT}/run/systemd/network"; do
        [ -d "${d}" ] || continue
        find "${d}" -name '*.network' 2>/dev/null || true
    done | sed 's|.*/||' | sort -u)"
    collisions=""
    for n in ${img_networks}; do
        case "${n}" in
        # ANCHORED, matching is_mos_managed(). The unanchored `*marker*` this
        # replaced is what turned an empty marker into eight false positives.
        "${MOS_SWEEP}"*"${MOS_SWEEP_SUFFIX}") collisions="${collisions} ${n}(swept-by-network.rs)" ;;
        "${STA_PREFIX}"*) collisions="${collisions} ${n}(station-namespace)" ;;
        "${AP_PREFIX}"*) collisions="${collisions} ${n}(ap-namespace)" ;;
        esac
    done
    if [ -z "${img_networks}" ]; then
        fail "the image's networkd namespace is empty: it ships no .network file at all, so this check would pass vacuously"
    elif [ -z "${collisions}" ]; then
        pass "the image's networkd namespace is clear of mosd's: none of ($(echo "${img_networks}" | tr '\n' ' ')) falls in a reconciler-owned namespace ('${MOS_SWEEP}'*'${MOS_SWEEP_SUFFIX}', '${STA_PREFIX}', '${AP_PREFIX}')"
    else
        fail "the image's networkd namespace collides with a reconciler-owned one:${collisions}. A (swept-by-network.rs) file is DELETED on the reconciler's first pass — it renders ${MOS_SWEEP}*${MOS_SWEEP_SUFFIX} and removes every other file matching that shape. A (station-namespace) or (ap-namespace) file instead SHADOWS the unit a WiFi reconciler renders for that interface, since networkd applies the first match in lexical order"
    fi
}

# --- RFCT-099: no package manager in the packed root ------------------------
# What this proves: the shipped root carries no way to install software, and
# still carries the licence texts Debian ships to satisfy redistribution terms.
#
# Both halves matter and they pull in opposite directions. A purge that removed
# too little leaves apt on a device whose entire security model is that its
# root cannot change; a purge that removed too much takes 159 `copyright` files
# with it, which is a licence breach for 0.69 MB of changelogs.
#
# /var is relocated to /usr/share/factory/var by the pack stage, so the dpkg
# database is looked for in BOTH places: an image that kept it under the
# factory tree would restore it onto /var on the first boot, and a check that
# only looked at /var would report a clean root that repopulates itself.
PKGMGR_BINARIES="/usr/bin/dpkg /usr/bin/dpkg-query /usr/bin/dpkg-deb /usr/bin/apt /usr/bin/apt-get /usr/bin/apt-cache /usr/bin/apt-key /usr/bin/perl"
PKGMGR_TREES="/var/lib/dpkg /var/lib/apt /etc/apt /usr/lib/apt /usr/share/factory/var/lib/dpkg /usr/share/factory/var/lib/apt"

check_no_package_manager() {
    # The TIMERS, not just the binaries. apt-daily.timer,
    # apt-daily-upgrade.timer and dpkg-db-backup.timer are enabled by their
    # packages and survive a purge that only removes /usr/bin/apt -- they then
    # fire daily on a device with no package manager and fail daily. Found by
    # booting the x64 image, in an arm64 image that had already shipped.
    pm_timers="$(find "${ROOT}/etc/systemd" "${ROOT}/usr/lib/systemd" \
        -name 'apt-daily*' -o -name 'dpkg-db-backup*' 2>/dev/null | sed "s|^${ROOT}||" | sort | tr '\n' ' ' || true)"
    if [ -z "${pm_timers}" ]; then
        pass "no apt or dpkg systemd timer is in the image; removing the package manager's binaries does not remove its timers, and those fire daily whether or not anything is left for them to run"
    else
        fail "package-management timers are in the image:${pm_timers}. Each is enabled by its package, fires daily, and fails daily on a root with no apt and no dpkg — journal noise shaped exactly like a real fault"
    fi

    pm_found=""
    for b in ${PKGMGR_BINARIES}; do
        [ -e "${ROOT}${b}" ] && pm_found="${pm_found} ${b}"
    done
    for d in ${PKGMGR_TREES}; do
        [ -d "${ROOT}${d}" ] && pm_found="${pm_found} ${d}/"
    done
    if [ -z "${pm_found}" ]; then
        pass "the packed root carries no package manager: none of ${PKGMGR_BINARIES} and no dpkg/apt state, in /var or under the factory tree"
    else
        fail "the packed root still carries package management:${pm_found}. The root is a read-only dm-verity squashfs and updates arrive as whole RAUC slots, so nothing here can install a package — but anyone who reaches a shell now has the tool to try, and it is ~21 MB of weight that cannot be used"
    fi

    # ...and the purge stopped where the licences begin. This is the half a
    # size-driven cleanup gets wrong, and it fails silently: nobody notices a
    # missing copyright file until a redistribution question is asked.
    pm_copyrights="$(find "${ROOT}/usr/share/doc" -name copyright -type f 2>/dev/null | grep -c . || true)"
    if [ "${pm_copyrights}" -ge 100 ]; then
        pass "the licence texts survived the purge: ${pm_copyrights} copyright files under /usr/share/doc"
    else
        fail "only ${pm_copyrights} copyright files are left under /usr/share/doc (expected the full package set, ~159). Debian ships these to satisfy the redistribution terms of the GPL and the other licences in the image; removing them saves under a megabyte and breaches those terms"
    fi

    # A script whose interpreter was removed is a trap: it fails at the moment
    # it is needed, with an error about the shebang rather than about the purge.
    pm_dangling="$(grep -rlI '^#!.*perl' "${ROOT}/usr/bin" "${ROOT}/usr/sbin" \
        "${ROOT}/usr/lib/systemd" "${ROOT}/etc" 2>/dev/null | sed "s|^${ROOT}||" | tr '\n' ' ' || true)"
    if [ -z "${pm_dangling}" ]; then
        pass "no script in the packed root names perl as its interpreter, so removing perl left nothing broken behind"
    else
        fail "perl was removed but these scripts still name it as their interpreter: ${pm_dangling}. Each one fails at the moment it is invoked, reporting a missing shebang rather than the purge that caused it"
    fi
}

# --- PLAN-012: the container engine, installed and INERT --------------------
# What this proves: podman is in the image, every unit it brings is masked, and
# an operator has somewhere to put a Quadlet file that survives a reboot.
#
# THE QUADLET PATH IS THE ONE THAT WOULD HAVE SHIPPED BROKEN. The plan's first
# draft assumed a .container file goes into /usr/local/lib/systemd/system, the
# STATE-backed unit directory PLAN-011 D5 shipped, because that would make
# installing a container the same act as installing an extension. `quadlet
# --dryrun` on the shipped binary says otherwise, verbatim:
#   No files parsed from [/run/containers/systemd /etc/containers/systemd
#                         /usr/share/containers/systemd]
# Of those three, /run is tmpfs and the other two are inside the read-only
# squashfs, so without a bind there is nowhere on the device to install one.
CONTAINER_STORAGE_CONF="/etc/containers/storage.conf"
# Where each binary must be, derived from podman v5.8.6's own search lists
# rather than from where Debian's package put them:
#   crun     default.go:391    /usr/bin/crun is first
#   conmon   default.go:474    /usr/libexec/podman/conmon is first
#   helpers  config_linux.go:24  helper_binaries_dir, of which /usr/libexec/
#                               podman is the first entry not under /usr/local
# containers.conf pins all of them absolutely; these assertions are that the
# files are where that file says.
CONTAINER_BINARIES="/usr/bin/podman /usr/bin/crun /usr/libexec/podman/conmon /usr/libexec/podman/netavark /usr/libexec/podman/aardvark-dns /usr/libexec/podman/catatonit /usr/libexec/podman/quadlet"
CONTAINER_POLICY="/etc/containers/policy.json"
CONTAINER_CONF="/etc/containers/containers.conf"
CONTAINER_REGISTRIES="/etc/containers/registries.conf"
CONTAINER_NFT="/usr/sbin/nft"
QUADLET_GENERATOR="/usr/lib/systemd/system-generators/podman-system-generator"
QUADLET_DIR="/etc/containers/systemd"
QUADLET_MOUNT_UNIT="etc-containers-systemd.mount"

check_container_engine() {
    # A board can ship without the engine (WITH_CONTAINERS=0). Absence is then
    # correct, and reported rather than passed over in silence -- an image with
    # no engine and an image whose engine failed to install look identical to
    # every assertion below.
    if [ ! -e "${ROOT}/usr/bin/podman" ] && [ ! -e "${ROOT}${CONTAINER_STORAGE_CONF}" ]; then
        pass "this image carries no container engine at all (no podman, no storage.conf): a WITH_CONTAINERS=0 board, and the assertions that follow are skipped BY IDENTITY rather than passing vacuously"
        return
    fi
    ce_missing=""
    for b in ${CONTAINER_BINARIES} "${QUADLET_GENERATOR}"; do
        [ -f "${ROOT}${b}" ] || ce_missing="${ce_missing} ${b}"
    done
    if [ -z "${ce_missing}" ]; then
        pass "the container engine is in the image: podman, crun, conmon, netavark, aardvark-dns, quadlet and its systemd generator"
    else
        fail "the container engine is incomplete:${ce_missing} missing. PLAN-012 ships the engine installed and inert; a partial install is a switch that turns on nothing"
    fi

    # No podman units, at all. The engine is inert because nothing can start
    # it, not because seven symlinks point at /dev/null.
    #
    # This replaced a check that every unit podman shipped was masked. That
    # check could only fail if podman's unit set CHANGED; it could not notice a
    # unit podman ADDED, and it required the units to exist -- so it also had a
    # branch that failed when they were absent, which is now the correct state.
    # Building the engine from source means upstream's contrib/ units are never
    # installed: podman.socket, the socket-activated root REST API, is not
    # masked here, it does not exist.
    # -path '*.wants/*' is excluded on purpose, not overlooked: an enablement
    # symlink is the NEXT check's subject, and a dangling one can exist with no
    # unit file behind it. Two checks that both fire on one mutation say less
    # than two that each name a distinct way the engine could start.
    ce_units="$(find "${ROOT}/etc/systemd" "${ROOT}/usr/lib/systemd" "${ROOT}/usr/local/lib/systemd" \
        -name 'podman*' -not -name 'podman-system-generator' -not -path '*.wants/*' \
        2>/dev/null | sed "s|^${ROOT}||" | sort | tr '\n' ' ' || true)"
    if [ -z "${ce_units}" ]; then
        pass "the image contains no podman systemd unit of any name; the engine is inert by construction rather than by masking, so there is no mask list to keep in step with upstream"
    else
        fail "the image contains podman systemd units:${ce_units}. os/podman does not run 'make install.systemd', so anything named podman* under a unit directory arrived by a path nobody intended -- and podman.socket in particular is SOCKET-ACTIVATED, so being disabled is not enough"
    fi

    # nft. Reached by exec, so no NEEDED-soname check can see it, and it was
    # missing from the image RFCT-101/102 shipped -- which passed every
    # assertion this file then had.
    if [ -f "${ROOT}${CONTAINER_NFT}" ] || [ -f "${ROOT}/usr/bin/nft" ]; then
        pass "nft is in the image; netavark 2.x has no iptables driver (its FirewallImpl enum is Firewalld/Nftables/Fwnone) and execs nft by name off PATH, so without this binary every container network setup fails"
    else
        fail "nft is not in the image. netavark execs it by name (nftables crate, NFT_EXECUTABLE = \"nft\") to build every container network, and there is no fallback: the iptables driver was REMOVED in netavark 2.x. The device boots, the engine reports healthy, and the first 'podman run' fails with 'unable to execute nft'"
    fi

    # libsystemd, reached by DLOPEN. A third invisible category, after the
    # exec'd nft: podman opens "libsystemd.so.0" by name at runtime for
    # journald logging (go-systemd sdjournal/functions.go:37), so it appears in
    # no NEEDED list and ldd cannot see it. containers.conf sets
    # log_driver = "journald", so losing it does not fail -- it loses logs.
    if find "${ROOT}/usr/lib" -name 'libsystemd.so.0' -print -quit 2>/dev/null | grep -c . >/dev/null; then
        pass "libsystemd.so.0 is in the image; podman dlopens it by name for journald logging, which is a dependency neither a NEEDED list nor ldd can report"
    else
        fail "libsystemd.so.0 is not in the image. podman DLOPENS it for journald logging, so nothing in the link-time or loader checks above can see this missing -- and with log_driver=journald the symptom is container logs quietly going nowhere, not an error"
    fi

    # mos's own configuration, in place of containers-common's.
    #
    # storage.conf is NOT in this list, though it is equally mos's own. It has
    # its own assertion below, which reports where the graphroot points rather
    # than merely that a file exists. Checking it in both places would mean one
    # missing file produced two failures, and the offline harness reads a case
    # by WHICH assertions changed -- a mutation that trips two checks says less
    # than one that trips the right one.
    ce_cfg_missing=""
    for f in "${CONTAINER_POLICY}" "${CONTAINER_CONF}" "${CONTAINER_REGISTRIES}"; do
        [ -f "${ROOT}${f}" ] || ce_cfg_missing="${ce_cfg_missing} ${f}"
    done
    if [ -z "${ce_cfg_missing}" ]; then
        pass "mos ships its own policy.json, containers.conf, registries.conf and storage.conf; the distribution's containers-common is not installed, so these four files are the whole of the engine's configuration"
    else
        fail "container configuration is incomplete:${ce_cfg_missing} missing. containers-common is not installed to supply a fallback, and podman does not fail on an absent config file -- it uses a built-in default nobody chose"
    fi

    # A second config layer under /usr/share would supply settings that reading
    # /etc does not reveal.
    if [ -e "${ROOT}/usr/share/containers/containers.conf" ]; then
        fail "/usr/share/containers/containers.conf exists. podman reads it BEFORE /etc/containers/containers.conf and merges, so an operator reading /etc sees only half the configuration"
    else
        pass "there is no /usr/share/containers/containers.conf; /etc is the only layer, so what mos configured is what reading one file shows"
    fi

    # containers.conf must pin the paths, not leave podman to search: the
    # default helper_binaries_dir begins with two directories under /usr/local,
    # a prefix this image makes partially writable (PLAN-011 D5).
    if grep -q '^helper_binaries_dir *= *\["/usr/libexec/podman"\]' "${ROOT}${CONTAINER_CONF}" 2>/dev/null; then
        pass "containers.conf pins helper_binaries_dir to /usr/libexec/podman; podman's built-in default searches /usr/local/libexec/podman and /usr/local/lib/podman FIRST, and /usr/local on this image is a prefix with a STATE-backed writable subtree"
    else
        fail "containers.conf does not pin helper_binaries_dir. The default (config_linux.go:24) searches /usr/local/libexec/podman and /usr/local/lib/podman before the image's own /usr/libexec/podman, and mos deliberately makes part of /usr/local writable from STATE"
    fi

    # ...and none is enabled by a wants symlink either, which is the other way
    # a unit starts.
    ce_enabled="$(find "${ROOT}/etc/systemd/system" "${ROOT}/usr/lib/systemd/system" \
        -path '*.wants/podman*' 2>/dev/null | sed "s|^${ROOT}||" | tr '\n' ' ' || true)"
    if [ -z "${ce_enabled}" ]; then
        pass "no podman unit carries an enablement symlink; the engine is inert in the shipped image"
    else
        fail "podman units carry an enablement symlink in the image:${ce_enabled}. The device would run containers before anyone asked, which is the opposite of PLAN-012's default-off switch"
    fi

    # Image storage must NOT be on /var. podman ships no storage.conf and
    # defaults to /var/lib/containers/storage; /var here is the EPHEMERAL
    # partition, 512 MiB and wiped by design. The failure is not an error
    # message -- containers work, and then one day the partition resets and
    # every pulled image is gone.
    ce_graph="$(sed -n 's/^ *graphroot *= *"\(.*\)"/\1/p' "${ROOT}${CONTAINER_STORAGE_CONF}" 2>/dev/null | tail -n1 || true)"
    if [ ! -f "${ROOT}${CONTAINER_STORAGE_CONF}" ]; then
        fail "container image storage is unconfigured: no ${CONTAINER_STORAGE_CONF} in the image, so podman falls back to its built-in default of /var/lib/containers/storage. /var is the EPHEMERAL partition: 512 MiB and wiped by design, so every pulled image is both size-capped and destined to vanish without any error being reported"
    elif [ -z "${ce_graph}" ]; then
        fail "container image storage is unconfigured: ${CONTAINER_STORAGE_CONF} sets no graphroot, so podman uses its built-in /var/lib/containers/storage on the wipeable EPHEMERAL partition"
    else
        case "${ce_graph}" in
        /srv/*)
            pass "container image storage is at ${ce_graph}, on DATA -- the only growable partition, and the one that survives an A/B update"
            ;;
        /var/*)
            fail "container image storage is at ${ce_graph}, on the EPHEMERAL partition. /var is 512 MiB and wiped by design; images would be capped and then silently destroyed"
            ;;
        *)
            fail "container image storage is at ${ce_graph}, which is neither DATA (/srv) nor a path this check knows. Image storage grows without bound and belongs on the partition systemd-repart extends"
            ;;
        esac
    fi

    # The Quadlet directory has to be writable and persistent, or the operator
    # cannot install a container at all.
    ce_f="${ROOT}/etc/systemd/system/${QUADLET_MOUNT_UNIT}"
    ce_where="$(sed -n 's/^Where=//p' "${ce_f}" 2>/dev/null | tail -n1 || true)"
    ce_what="$(sed -n 's/^What=//p' "${ce_f}" 2>/dev/null | tail -n1 || true)"
    if [ ! -f "${ce_f}" ]; then
        fail "${QUADLET_MOUNT_UNIT} is not in the image, so ${QUADLET_DIR} stays on the read-only squashfs. Quadlet reads /run, /etc and /usr/share under containers/systemd and nothing else: /run is tmpfs and the other two are in the verity root, so an operator has NOWHERE to install a container that survives a reboot"
    elif [ "${ce_where}" != "${QUADLET_DIR}" ]; then
        fail "${QUADLET_MOUNT_UNIT} mounts '${ce_where}', not ${QUADLET_DIR} — which is the only one of Quadlet's three search directories an operator can be given"
    elif ! printf '%s' "${ce_what}" | grep -c '^/mnt/state/' >/dev/null; then
        fail "${QUADLET_MOUNT_UNIT} is backed by '${ce_what}', not STATE. Installed containers would not survive an A/B update"
    elif [ -L "${ROOT}/etc/systemd/system/local-fs.target.wants/${QUADLET_MOUNT_UNIT}" ]; then
        fail "${QUADLET_MOUNT_UNIT} is STATICALLY ENABLED. The bind then comes up at every boot whatever container.enabled says, Quadlet generates units from STATE, and they start — so anything able to write /mnt/state/quadlet gets a root-capable container at the next reboot with no operator decision anywhere in the path, and PLAN-012's switch gates nothing. mosd's ContainerReconciler enables it at runtime when the setting is true"
    else
        pass "${QUADLET_DIR} is a STATE-backed bind via ${QUADLET_MOUNT_UNIT} (What=${ce_what}), installed and NOT statically enabled — mosd brings it up only when container.enabled is true, which is what makes the switch mean anything at boot"
    fi
}

# The fixture hook: run only the assertions above, against the fixture, and
# summarise. os/ui-location-test.sh is the only caller.
if [ -n "${FIXTURE_ROOT}" ]; then
    ROOT="${FIXTURE_ROOT}"
    FSTAB="${ROOT}/etc/fstab"
    check_ui_location
    check_builtin_ui
    check_packed_mountpoints
    check_status_led
    check_dev_keyring
    check_ext_unit_dir
    check_ext_policy
    check_mqttd
    check_mqtt_broker
    read_connd_contract
    check_networkd_namespace
    check_no_package_manager
    check_container_engine
    fixture_total=$((PASS_N + FAIL_N))
    if [ "${FAIL_N}" -eq 0 ]; then
        echo "RESULT: PASS (${PASS_N}/${fixture_total} checks)"
        exit 0
    fi
    echo "RESULT: FAIL (${PASS_N}/${fixture_total} checks)"
    exit 1
fi
# BOUNDARY. Fixture mode has just exited. Every assertion written inline BELOW
# this point is structurally invisible to os/ui-location-test.sh -- it cannot be
# driven against a fixture, so it can never be observed failing, and nothing
# says so at the point of temptation. Two authors have already written past this
# line (PLAN-011 D5's mount-unit set and its com.mos.ext.conf policy set) and
# both had to be hoisted afterwards. If a new assertion reads only ${ROOT} and
# could be driven offline, put it in a function ABOVE and name it in the list
# above; if it needs the real image, inline here is correct. This is a note, not
# a rule: most assertions below genuinely need the image and must stay there.

BYTES_PER_SECTOR="${SECTOR_SIZE}"
SECTORS_PER_MIB=$((MIB_BYTES / SECTOR_SIZE))

# --- check 0: default path must be the -latest symlink ---
if [ "${EXPECT_SYMLINK}" -eq 1 ]; then
    link_target="$(readlink "${IMG}" 2>/dev/null || true)"
    link_target="${link_target#./}"
    if [ -L "${IMG}" ] && [[ "${link_target}" =~ ^${IMAGE_NAME_PREFIX}[0-9]+\.img$ ]]; then
        pass "default path is a symlink to ${link_target}"
    else
        fail "default path must be a symlink to ${IMAGE_NAME_PREFIX}<epoch>${IMAGE_NAME_SUFFIX} in the same directory (got: ${link_target:-not a symlink})"
    fi
fi

# ===========================================================================
# 1. GPT
# ===========================================================================

verify_out="$(sgdisk --verify "${IMG}" 2>&1 || true)"
complaints="$(echo "${verify_out}" | grep -E "Caution|Warning" | grep -Ev "doesn't (begin|end) on a|degraded performance" || true)"
if grep -q "No problems found" <<<"${verify_out}" &&
    ! grep -Eq "problems!|Problem:|Creating new GPT entries|invalid GPT|damaged GPT" <<<"${verify_out}" &&
    [ -z "${complaints}" ]; then
    pass "sgdisk --verify reports no problems"
else
    fail "sgdisk --verify reported problems: $(echo "${verify_out}" | tr '\n' ' ')"
fi

ptable="$(sgdisk -p "${IMG}" 2>/dev/null || true)"
disk_guid="$(echo "${ptable}" | sed -n 's/^Disk identifier (GUID): //p')"
eq_ci "disk GUID" "${disk_guid}" "${DISK_GUID}"

# The count comes from the board definition, not from a literal. `EXPECT_PARTS=11`
# was the cx3576 number, and it is why `MOS_BOARD=x64` did not report a
# difference — it died on `LOADER_PARTNUM: unbound variable` four checks in.
EXPECT_PARTS=0
for _p in ${LAYOUT_PARTITIONS}; do EXPECT_PARTS=$((EXPECT_PARTS + 1)); done
if [ "${EXPECT_PARTS}" -eq 0 ]; then
    echo "error: ${LAYOUT_ENV} declares no LAYOUT_PARTITIONS; this verifier walks the board definition and has nothing to walk" >&2
    exit 1
fi
part_count="$(echo "${ptable}" | grep -cE '^[[:space:]]+[0-9]+[[:space:]]' || true)"
if [ "${part_count}" = "${EXPECT_PARTS}" ]; then
    pass "exactly ${EXPECT_PARTS} partitions"
else
    fail "found ${part_count} partitions, expected ${EXPECT_PARTS}"
fi

# Extract one field from sgdisk -i output.
sg_field() {
    sed -n "s/^$2: //p" <<<"$1" | first_line
}

# Cache each partition's sgdisk -i output once; every check below reads it.
declare -a P_INFO
for n in $(seq 1 "${EXPECT_PARTS}"); do
    P_INFO[n]="$(sgdisk -i "${n}" "${IMG}" 2>&1 || true)"
done
p_field() {
    sg_field "${P_INFO[$1]}" "$2"
}

# The rootfs slot size is content-derived (see MOS_ROOTFS_SLOT_MIB in the layout
# env), so it is read out of the image rather than pinned here. Everything
# downstream of rootfs-b then follows from it.
slot_sectors="$(p_field "${ROOTFS_A_PARTNUM}" "Partition size" | awk '{print $1}')"
if [[ "${slot_sectors}" =~ ^[0-9]+$ ]] && [ "${slot_sectors}" -gt 0 ] &&
    [ $((slot_sectors % SECTORS_PER_MIB)) -eq 0 ]; then
    SLOT_MIB=$((slot_sectors / SECTORS_PER_MIB))
else
    SLOT_MIB=0
    slot_sectors=0
fi

# THE PARTITION TABLE, WALKED FROM THE BOARD DEFINITION.
#
# What replaced an eleven-row literal table: every row is built by iterating
# LAYOUT_PARTITIONS and resolving each field from the layout by name. A board
# that declares eight partitions produces eight rows; one that declares eleven
# produces eleven. Nothing here knows which partitions a board has.
#
# SIZE resolves in one order, and the order is the schema's: an explicit
# _SIZE_SECTORS, else _SIZE_MIB, else -- for a verity-slot -- the size read
# back out of the image, because a rootfs slot's size is content-derived and
# declaring it would be restating what the build computed.
#
# START is where this stops being a lookup and becomes an assertion. A
# partition either declares a fixed start (_START_SECTOR or _START_MIB) or it
# BEGINS WHERE THE PREVIOUS ONE ENDED. That is what a partition table means,
# and walking it that way makes the packing itself the thing under test: the
# old code carried a hand-written chain (rootfs_b_start_mib = ... ; meta_start_mib
# = ... ; four more) which restated the arithmetic the assembler had already
# done, so a gap agreed on by both would have passed.
part_size_sectors() {
    local name="$1" v
    eval "v=\${${name}_SIZE_SECTORS:-}"
    [ -n "${v}" ] && { echo "${v}"; return; }
    eval "v=\${${name}_SIZE_MIB:-}"
    [ -n "${v}" ] && { echo $((v * SECTORS_PER_MIB)); return; }
    eval "v=\${${name}_ROLE:-}"
    if [ "${v}" = "verity-slot" ]; then echo "${slot_sectors}"; return; fi
    echo ""
}

part_fixed_start_sectors() {
    local name="$1" v
    eval "v=\${${name}_START_SECTOR:-}"
    [ -n "${v}" ] && { echo "${v}"; return; }
    eval "v=\${${name}_START_MIB:-}"
    [ -n "${v}" ] && { echo $((v * SECTORS_PER_MIB)); return; }
    echo ""
}

# num|label|typecode|guid|size-sectors|start-sector
part_rows=()
cursor=0
for name in ${LAYOUT_PARTITIONS}; do
    eval "row_num=\${${name}_PARTNUM}"
    eval "row_label=\${${name}_LABEL}"
    eval "row_type=\${${name}_TYPECODE}"
    eval "row_guid=\${${name}_GUID}"

    row_size="$(part_size_sectors "${name}")"
    if [ -z "${row_size}" ]; then
        echo "error: ${LAYOUT_ENV} gives ${name} no size: it declares neither ${name}_SIZE_SECTORS nor ${name}_SIZE_MIB, and its role is not verity-slot" >&2
        exit 1
    fi

    row_start="$(part_fixed_start_sectors "${name}")"
    if [ -z "${row_start}" ]; then
        row_start="${cursor}"
    fi
    cursor=$((row_start + row_size))

    part_rows+=("${row_num}|${row_label}|${row_type}|${row_guid}|${row_size}|${row_start}")
    # Recorded per partition so later checks can ask "where does STATE start"
    # without re-deriving it. The hand-written chain this replaced
    # (meta_start_mib = ...; state_start_mib = ...) was the same numbers
    # computed a second time, which is how a checker and an assembler come to
    # agree on a wrong answer.
    eval "PART_START_MIB_${name}=$((row_start / SECTORS_PER_MIB))"
done
total_size_mib=$(( cursor / SECTORS_PER_MIB + IMAGE_TAIL_SLACK_MIB ))

for row in "${part_rows[@]}"; do
    IFS='|' read -r n label typecode guid want_size want_start <<<"${row}"

    got_label="$(p_field "${n}" "Partition name")"
    if [ "${got_label}" = "'${label}'" ]; then
        pass "p${n} PARTLABEL is '${label}'"
    else
        fail "p${n} PARTLABEL is ${got_label:-unreadable}, expected '${label}'"
    fi

    got_type="$(p_field "${n}" "Partition GUID code" | awk '{print $1}')"
    eq_ci "p${n} typecode" "${got_type}" "${typecode}"

    got_guid="$(p_field "${n}" "Partition unique GUID")"
    eq_ci "p${n} partition GUID" "${got_guid}" "${guid}"

    got_size="$(p_field "${n}" "Partition size" | awk '{print $1}')"
    if [ "${want_size}" -gt 0 ] && [ "${got_size}" = "${want_size}" ]; then
        pass "p${n} (${label}) size is ${want_size} sectors"
    else
        fail "p${n} (${label}) size is '${got_size}' sectors, expected ${want_size}"
    fi

    got_start="$(p_field "${n}" "First sector" | awk '{print $1}')"
    if [ "${want_start}" -gt 0 ] && [ "${got_start}" = "${want_start}" ]; then
        pass "p${n} (${label}) starts at sector ${want_start}"
    else
        fail "p${n} (${label}) starts at sector '${got_start}', expected ${want_start}"
    fi

    # v2 sets NO GPT attribute bits anywhere: the ESP typecode alone makes the
    # boot slots bootable to U-Boot, and the slot choice comes from the RAUC
    # BOOT_ORDER environment, never from a GPT flag.
    got_attrs="$(p_field "${n}" "Attribute flags")"
    if [[ "${got_attrs}" =~ ^0+$ ]]; then
        pass "p${n} (${label}) attribute flags are clear (${got_attrs})"
    else
        fail "p${n} (${label}) attribute flags are '${got_attrs}', expected all bits clear"
    fi
done

# HOW MANY linux-generic PARTITIONS THIS GPT CARRIES. Counted for every board,
# because section 8 cross-checks it against the shipped repart definition count
# and that check is not U-Boot's -- systemd-repart pairs definitions with
# partitions IN ORDER on every board, and a mismatch shifts every definition
# onto the wrong partition rather than failing.
#
# It used to be counted inside the loader block below, so gating that block on
# the bootloader took this with it and section 8 died on an unbound variable.
# A count that only exists on one board is not a property of the GPT.
LINUX_GENERIC_N=0
for n in $(seq 1 "${EXPECT_PARTS}"); do
    t="$(lc "$(p_field "${n}" "Partition GUID code" | awk '{print $1}')")"
    [ "${t}" = "$(lc "${TYPECODE_LINUX}")" ] && LINUX_GENERIC_N=$((LINUX_GENERIC_N + 1))
done

# U-BOOT ONLY. Everything in this section is about a bootloader image written
# raw at a fixed sector and the GPT entry that stops systemd-repart from
# discarding it. A grub board has neither: its firmware is in flash, not at a
# sector of the disk, so there is no region to protect and no entry to check.
#
# Gated on the layout's RAUC backend and SKIPPED OUT LOUD. Running these on a
# board with no loader partition is how this verifier used to die with
# `LOADER_PARTNUM: unbound variable`; deleting them would lose cx3576's
# protection against the failure that once left a device in maskrom; and
# skipping them quietly would report the same green as running them.
if is_uboot_board; then
    # --- LOADER: the reason first-boot growth no longer wipes the bootloader -----
    #
    # systemd-repart discards every region of the disk that no GPT entry covers, and
    # it does so on first boot while growing DATA. The Rockchip idbloader lives at
    # raw sector 64; before it had an entry, the growth run TRIMmed it and the device
    # reached maskrom on the next power-on. The protection is the ENTRY, so these
    # check the entry actually covers the bytes, not merely that it exists.
    loader_first="$(p_field "${LOADER_PARTNUM}" "First sector" | awk '{print $1}')"
    loader_size="$(p_field "${LOADER_PARTNUM}" "Partition size" | awk '{print $1}')"
    loader_type="$(p_field "${LOADER_PARTNUM}" "Partition GUID code" | awk '{print $1}')"

    # Abutment: a gap between the loader partition and uenv-a would itself be an
    # uncovered region, and repart would discard that.
    if [[ "${loader_first}" =~ ^[0-9]+$ ]] && [[ "${loader_size}" =~ ^[0-9]+$ ]] &&
        [ $((loader_first + loader_size)) -eq "${UENV_A_START_SECTOR}" ]; then
        pass "p${LOADER_PARTNUM} (${LOADER_LABEL}) ends exactly where ${UENV_A_LABEL} begins (sector ${UENV_A_START_SECTOR}); no untracked gap is left between them"
    else
        fail "p${LOADER_PARTNUM} (${LOADER_LABEL}) covers sectors ${loader_first}..$((${loader_first:-0} + ${loader_size:-0} - 1)) but ${UENV_A_LABEL} starts at ${UENV_A_START_SECTOR}; anything not covered by a partition entry is discarded by systemd-repart"
    fi

    # The loader partition and the U-Boot fit check must describe the same bytes.
    if [ $((LOADER_SIZE_SECTORS * BYTES_PER_SECTOR)) -eq "${UBOOT_MAX_BYTES}" ]; then
        pass "p${LOADER_PARTNUM} is ${UBOOT_MAX_BYTES} bytes, exactly the limit the U-Boot fit check enforces"
    else
        fail "p${LOADER_PARTNUM} is $((LOADER_SIZE_SECTORS * BYTES_PER_SECTOR)) bytes but UBOOT_MAX_BYTES is ${UBOOT_MAX_BYTES}; a blob that passes the fit check could still overrun the partition"
    fi

    # The first byte of the partition must be the idbloader magic. An entry over
    # the wrong bytes protects nothing.
    loader_magic="$(dd if="${IMG}" bs="${BYTES_PER_SECTOR}" skip="${LOADER_START_SECTOR}" count=1 status=none 2>/dev/null | od -An -tx1 -N4 | tr -d ' \n' || true)"
    if [ "${loader_magic}" = "${LOADER_MAGIC_HEX}" ]; then
        pass "p${LOADER_PARTNUM} starts with the Rockchip idbloader magic ${LOADER_MAGIC_HEX} ('RKNS')"
    else
        fail "p${LOADER_PARTNUM} starts with '${loader_magic}', expected the idbloader magic ${LOADER_MAGIC_HEX} ('RKNS'); the partition does not cover a bootloader"
    fi

    # THE REPART-MATCHING PROOF. repart pairs definition files with existing
    # partitions BY TYPE UUID in disk order. The claim "no definition can ever match
    # the loader" is therefore a countable fact about the assembled GPT: the loader's
    # type must appear on exactly one partition and must not be a type any
    # definition uses. Counted here, and cross-checked against the shipped
    # definition count in section 8.
    LOADER_TYPE_N=0
    for n in $(seq 1 "${EXPECT_PARTS}"); do
        t="$(lc "$(p_field "${n}" "Partition GUID code" | awk '{print $1}')")"
        if [ "${t}" = "$(lc "${LOADER_TYPECODE}")" ]; then
            LOADER_TYPE_N=$((LOADER_TYPE_N + 1))
        fi
    done
    if [ "$(lc "${loader_type}")" = "$(lc "${LOADER_TYPECODE}")" ] &&
        [ "$(lc "${LOADER_TYPECODE}")" != "$(lc "${TYPECODE_LINUX}")" ] &&
        [ "$(lc "${LOADER_TYPECODE}")" != "$(lc "${TYPECODE_ESP}")" ] &&
        [ "${LOADER_TYPE_N}" = "1" ]; then
        pass "p${LOADER_PARTNUM} is the only ${LOADER_TYPECODE} partition, and that type is neither linux-generic nor the ESP type, so no /etc/repart.d definition can pair with it"
    else
        fail "the loader type must be unique and distinct from linux-generic/ESP; p${LOADER_PARTNUM} type is '${loader_type}' and ${LOADER_TYPE_N} partition(s) carry ${LOADER_TYPECODE}"
    fi
else
    skip "the loader-partition protections (${EXPECT_PARTS}-partition ${MOS_BOARD} layout has no loader): a grub board keeps its firmware in flash, not at a fixed sector, so there is no raw region for systemd-repart to discard and no GPT entry to assert. cx3576 needs these; os/uboot-handshake-test.sh remains the only cover for the U-Boot A/B handshake either way"
fi

if [ "${SLOT_MIB}" -gt 0 ]; then
    pass "rootfs-a and rootfs-b are the same size (${SLOT_MIB} MiB each)"
else
    fail "rootfs-a size is not a positive whole-MiB multiple, so the A/B slots cannot be compared"
fi
if [ "${SLOT_MIB}" -ge "${MOS_ROOTFS_SLOT_MIB}" ]; then
    pass "rootfs slot ${SLOT_MIB} MiB is at or above the ${MOS_ROOTFS_SLOT_MIB} MiB layout floor"
else
    fail "rootfs slot ${SLOT_MIB} MiB is below the ${MOS_ROOTFS_SLOT_MIB} MiB layout floor"
fi

# Spelled from the walk, not from a sum of the partitions cx3576 happens to
# have. The old term list named ROOTFS_A_START, two slots, META, STATE,
# MOS_VAR and DATA -- correct for one board and silently wrong for any other,
# in a message an engineer reads when the size does not match.
size_terms="the ${EXPECT_PARTS} partitions ${LAYOUT_PARTITIONS} end at $((cursor / SECTORS_PER_MIB)) MiB, plus ${IMAGE_TAIL_SLACK_MIB} MiB of tail slack"
expected_size=$((total_size_mib * MIB_BYTES))
actual_size="$(stat -Lc %s "${IMG}" 2>/dev/null || echo 0)"
if [ "${SLOT_MIB}" -gt 0 ] && [ "${actual_size}" = "${expected_size}" ]; then
    pass "image size is ${expected_size} bytes / ${total_size_mib} MiB (${size_terms})"
else
    fail "image size is ${actual_size} bytes, expected ${expected_size} (${size_terms})"
fi

# DATA must be the LAST partition and must end exactly IMAGE_TAIL_SLACK_MIB
# short of the end of the image. That pairing is what systemd-repart needs in
# order to extend it to the end of the real medium on first boot.
data_last_sector="$(p_field "${DATA_PARTNUM}" "Last sector" | awk '{print $1}')"
want_data_last=$(((total_size_mib - IMAGE_TAIL_SLACK_MIB) * SECTORS_PER_MIB - 1))
last_part_start=0
for row in "${part_rows[@]}"; do
    IFS='|' read -r n _ _ _ _ start <<<"${row}"
    if [ "${start}" -gt "${last_part_start}" ]; then
        last_part_start="${start}"
        last_part_num="${n}"
    fi
done
if [ "${last_part_num}" = "${DATA_PARTNUM}" ] && [ "${data_last_sector}" = "${want_data_last}" ]; then
    pass "data is the last partition (p${DATA_PARTNUM}) and ends at sector ${want_data_last}, leaving the ${IMAGE_TAIL_SLACK_MIB} MiB repart tail"
else
    fail "data must be the last partition and end at sector ${want_data_last} (${IMAGE_TAIL_SLACK_MIB} MiB tail slack); it is p${last_part_num} ending at '${data_last_sector}'"
fi

# U-BOOT ONLY, same reason as the loader-partition section above: this whole
# section reads the idbloader out of the raw pre-GPT area and compares it with
# what the BSP built. A UEFI board has nothing at sector 64.
if is_uboot_board; then
    # ===========================================================================
    # 2. Raw pre-GPT area: the uboot-mos blob at sector 64
    # ===========================================================================

    UBOOT_SRC="${BOARD_DIR}/out/${UBOOT_VARIANT_DIR}/${UBOOT_BIN_NAME}"
    UBOOT_DEBUG_SRC="${BOARD_DIR}/out/${UBOOT_DEBUG_VARIANT_DIR}/${UBOOT_BIN_NAME}"
    UBOOT_OFFSET_BYTES=$((UBOOT_SEEK_SECTOR * BYTES_PER_SECTOR))

    if [ ! -f "${UBOOT_SRC}" ]; then
        fail "u-boot compare source not found: ${UBOOT_SRC} (build it with 'make -C board/cx3576 uboot-mos')"
        uboot_size=0
    else
        uboot_size="$(stat -c %s "${UBOOT_SRC}")"
        if dd if="${IMG}" skip="${UBOOT_OFFSET_BYTES}" count="${uboot_size}" iflag=skip_bytes,count_bytes status=none 2>/dev/null |
            cmp -s - "${UBOOT_SRC}"; then
            pass "u-boot at sector ${UBOOT_SEEK_SECTOR} matches the ${UBOOT_VARIANT_DIR} variant (${UBOOT_SRC})"
        else
            fail "u-boot at sector ${UBOOT_SEEK_SECTOR} differs from ${UBOOT_SRC}; a v2 image may only carry the ${UBOOT_VARIANT_DIR} variant"
        fi
    fi

    # Pairing guard. The debug variant boots and looks healthy but has
    # CONFIG_ENV_IS_NOWHERE and no pinned bootmeth order, so the A/B handshake
    # would silently never run. Asserting the image DIFFERS from it is what catches
    # a debug blob copied into the uboot-mos directory.
    if [ ! -f "${UBOOT_DEBUG_SRC}" ]; then
        fail "u-boot debug-variant compare source not found: ${UBOOT_DEBUG_SRC}; the ${UBOOT_VARIANT_DIR}/${UBOOT_DEBUG_VARIANT_DIR} pairing guard cannot be evaluated"
    else
        debug_size="$(stat -c %s "${UBOOT_DEBUG_SRC}")"
        if dd if="${IMG}" skip="${UBOOT_OFFSET_BYTES}" count="${debug_size}" iflag=skip_bytes,count_bytes status=none 2>/dev/null |
            cmp -s - "${UBOOT_DEBUG_SRC}"; then
            fail "the blob at sector ${UBOOT_SEEK_SECTOR} is byte-identical to the DEBUG u-boot (${UBOOT_DEBUG_SRC}). A v2 image carrying it would boot, look healthy and never run the RAUC A/B handshake: no BOOT_ORDER, no attempt counters, no rollback. Rebuild with 'make -C board/cx3576 uboot-mos'"
        else
            pass "u-boot at sector ${UBOOT_SEEK_SECTOR} differs from the debug variant (${UBOOT_DEBUG_VARIANT_DIR}), so the A/B variant is paired correctly"
        fi
    fi

    if [ "${uboot_size}" -gt 0 ] && [ $((UBOOT_OFFSET_BYTES + uboot_size)) -le "${UENV_A_OFFSET_BYTES}" ] &&
        [ "${uboot_size}" -le "${UBOOT_MAX_BYTES}" ]; then
        pass "u-boot ends at $((UBOOT_OFFSET_BYTES + uboot_size)) bytes, below ${UENV_A_LABEL} at ${UENV_A_START_MIB} MiB"
    else
        fail "u-boot (${uboot_size} bytes at offset ${UBOOT_OFFSET_BYTES}) reaches into ${UENV_A_LABEL} at ${UENV_A_OFFSET_BYTES} bytes / ${UENV_A_START_MIB} MiB"
    fi

    # Containment in the LOADER PARTITION, with room to spare. "Ends before uenv-a"
    # above is the byte-offset form of the same statement; this one is expressed
    # against the partition entry, which is what actually protects the bytes.
    loader_bytes=$((LOADER_SIZE_SECTORS * BYTES_PER_SECTOR))
    if [ "${uboot_size}" -gt 0 ] && [ "${uboot_size}" -lt "${loader_bytes}" ]; then
        pass "u-boot (${uboot_size} bytes) is fully contained in p${LOADER_PARTNUM} (${loader_bytes} bytes) with $((loader_bytes - uboot_size)) bytes to spare"
    else
        fail "u-boot is ${uboot_size} bytes and p${LOADER_PARTNUM} is ${loader_bytes} bytes; the blob must fit inside its own partition with room left"
    fi

else
    skip "the raw pre-GPT loader area (bootloader=${RAUC_BOOTLOADER}): there is no idbloader at sector 64 on a board whose firmware lives in flash, so there is nothing to compare against the BSP build"
fi

# ===========================================================================
# 3. Boot slots
# ===========================================================================

KERNEL_SRC="${BOARD_DIR}/out/kernel/Image"
DTB_SRC="${BOARD_DIR}/out/kernel/rk3576-src.dtb"

BOOT_A_IMG="${IMG}@@${BOOT_A_OFFSET_BYTES}"
BOOT_B_IMG="${IMG}@@${BOOT_B_OFFSET_BYTES}"

# Args: slot-letter fat-image offset-bytes fat-label volume-id verity-env-name
check_boot_slot() {
    local slot="$1" fatimg="$2" offset="$3" want_label="$4" want_volid="$5" verity_env="$6"

    local sig
    sig="$(dd if="${IMG}" skip=$((offset + 82)) count=5 iflag=skip_bytes,count_bytes status=none 2>/dev/null || true)"
    if [ "${sig}" = "FAT32" ]; then
        pass "BOOT-${slot} has a FAT32 boot sector signature at $((offset / MIB_BYTES)) MiB"
    else
        fail "BOOT-${slot} FAT32 signature not found at offset $((offset / MIB_BYTES)) MiB + 82"
    fi

    local volid
    volid="$(minfo -i "${fatimg}" 2>/dev/null | sed -n 's/^serial number: //p' | tr -d ' ' || true)"
    # FACTORY ONLY. mkfs.vfat --invariant gives a bundle's boot.vfat the default
    # volume id 1234ABCD, so an updated slot legitimately differs. Nothing
    # resolves a boot slot by volume id, and RAUC writes partition CONTENTS
    # without touching the GPT, so the PARTLABEL and partition GUID (asserted
    # above) survive an install and remain the real identity.
    eq_ci "factory: BOOT-${slot} FAT volume id" "${volid}" "${want_volid}"

    # FACTORY ONLY, same reason as the volume id: a RAUC-installed boot slot
    # gets the neutral label "BOOT". Nothing addresses a boot slot by label
    # (boot.scr uses "mmc 0:${bootpart}"), so this is a factory-assembly
    # assertion, not a runtime contract. Relaxing it belongs in a future
    # --post-update mode, not here.
    local label
    label="$(mlabel -s -i "${fatimg}" :: 2>/dev/null | sed -n 's/^ *Volume label is //p' | sed 's/ *$//' || true)"
    if [ "${label}" = "${want_label}" ]; then
        pass "factory: BOOT-${slot} FAT volume label is '${want_label}' (an updated slot legitimately reads 'BOOT')"
    else
        fail "factory: BOOT-${slot} FAT volume label is '${label}', expected '${want_label}' on a factory image"
    fi

    local listing
    listing="$(mdir -/ -b -i "${fatimg}" ::/ 2>/dev/null || true)"
    if [ -z "${listing}" ]; then
        fail "BOOT-${slot} FAT filesystem unreadable (cannot list files)"
    fi
    local f
    # FROM THE BOARD DEFINITION. This was `Image rk3576-src.dtb boot.scr
    # ${verity_env}` -- one board's boot chain written into a script both
    # boards run. An x64 slot holds an EFI binary, a GRUB configuration and
    # kernel/initrd pairs; the two lists have nothing in common, so neither
    # belongs here.
    #
    # @SLOT@ expands to the lowercase slot letter for boards whose slots carry
    # per-slot files. x64 uses none: it builds one ESP holding both slots'
    # kernels and copies it, so each slot legitimately contains both.
    local slot_lc required
    slot_lc="$(printf '%s' "${slot}" | tr 'AB' 'ab')"
    required="${BOOT_SLOT_REQUIRED_FILES//@SLOT@/${slot_lc}}"
    for f in ${required}; do
        if grep -qxF "::/${f}" <<<"${listing}"; then
            pass "BOOT-${slot} contains ${f}"
        else
            fail "BOOT-${slot} is missing ${f}"
        fi
    done

    # U-BOOT ONLY, and the middle one of these is not merely inapplicable to a
    # grub board -- it is INVERTED. "the slot contains no initramfs file" is
    # right for cx3576, whose kernel needs none, and wrong for x64, whose slot
    # MUST carry initrd-a and initrd-b. Left ungated it would not have crashed;
    # it would have failed a correct image and sent someone looking for a
    # defect in the assembler.
    #
    # The extlinux assertion is U-Boot's by construction (both of its boot
    # frameworks try extlinux before boot.scr), and the Image/dtb comparison is
    # against artefacts only a BSP board builds.
    if is_uboot_board; then
        # THE assertion that keeps the A/B handshake reachable. Both U-Boot boot
        # frameworks try extlinux BEFORE boot.scr, so an extlinux config in a v2
        # boot slot silently bypasses the entire handshake: BOOT_ORDER is never
        # consulted, the attempt counters are never decremented and rollback never
        # happens. There is no error on the console — just a device that boots one
        # slot forever and cannot roll back.
        if grep -qi "extlinux" <<<"${listing}"; then
            fail "BOOT-${slot} contains extlinux ($(echo "${listing}" | grep -i extlinux | tr '\n' ' ')). Both U-Boot boot frameworks try extlinux BEFORE boot.scr, so this silently bypasses the whole RAUC A/B handshake: BOOT_ORDER is never honoured, boot attempts are never counted and rollback never happens, with no error anywhere. Remove it."
        else
            pass "BOOT-${slot} contains no extlinux/ directory and no extlinux.conf (a v2 slot must boot via ${BOOT_SCRIPT_NAME})"
        fi

        if grep -qi "initr" <<<"${listing}"; then
            fail "BOOT-${slot} contains an initramfs/initrd file: $(echo "${listing}" | grep -i initr | tr '\n' ' ')"
        else
            pass "BOOT-${slot} contains no initramfs file"
        fi

        local out
        for f in Image rk3576-src.dtb; do
            out="${TMP}/boot-${slot}-${f}"
            local src
            if [ "${f}" = "Image" ]; then src="${KERNEL_SRC}"; else src="${DTB_SRC}"; fi
            if ! mcopy -n -i "${fatimg}" "::/${f}" "${out}" 2>/dev/null; then
                fail "BOOT-${slot} ${f} missing or unreadable"
            elif [ ! -f "${src}" ]; then
                fail "BOOT-${slot} ${f} compare source not found: ${src}"
            elif cmp -s "${out}" "${src}"; then
                pass "factory: BOOT-${slot} ${f} matches the local BSP artifact ${src}"
            else
                fail "factory: BOOT-${slot} ${f} differs from the local BSP artifact ${src}"
            fi
        done
    else
        skip "BOOT-${slot}: the extlinux, no-initramfs and Image/dtb assertions (bootloader=${RAUC_BOOTLOADER}). extlinux is a U-Boot boot framework; a GRUB slot legitimately CARRIES an initrd, so the no-initramfs rule is inverted here rather than absent; and Image/rk3576-src.dtb are BSP artefacts this board does not build"
    fi

    # THE LED ASSERTION, and it is made against the copy EXTRACTED FROM THE
    # IMAGE, not against ${DTB_SRC}. The byte-compare above only says the slot
    # agrees with whatever the local BSP tree happens to hold; on its own it
    # would pass just as happily for an image assembled from a kernel built
    # without the status LEDs at all. What the board reads at boot is this copy,
    # so this is what gets asserted.
    #
    # The GPIO flags cell is the cell that matters. `default-state` alone reads
    # green while a red LED behaves backwards: status-red hangs off an
    # active-low line (flags 1) and status-blue off an active-high one (flags 0),
    # so a single inverted cell turns "lit at boot" into "dark at boot" with
    # every label and every default-state still spelling exactly right.
    # BOARD-GATED on BOARD_HAS_STATUS_LED. These read a Rockchip device tree
    # for the two status LEDs and their GPIO polarity. A board with no
    # indicator has no such nodes and no such device tree -- twelve failures
    # about hardware it does not have.
    #
    # Not deleted, because the polarity assertion is the load-bearing one: a
    # single inverted flags cell turns 'lit at boot' into 'dark at boot' with
    # every label and default-state still spelling exactly right, and cx3576
    # ships an indicator the operator reads to know the device is up.
    if [ "${BOARD_HAS_STATUS_LED}" = "1" ]; then
        local dtb="${TMP}/boot-${slot}-rk3576-src.dtb"
        local led name want_state want_flags want_pol got
        local -a gpio_cells
        for led in "status-red:on:1:active-low" "status-blue:off:0:active-high"; do
            IFS=':' read -r name want_state want_flags want_pol <<<"${led}"

            got="$(fdtget "${dtb}" "/leds/${name}" label 2>/dev/null || true)"
            if [ "${got}" = "${name}" ]; then
                pass "BOOT-${slot} rk3576-src.dtb: /leds/${name} label is '${name}'"
            else
                fail "BOOT-${slot} rk3576-src.dtb: /leds/${name} label is '${got:-missing}', expected '${name}'"
            fi

            got="$(fdtget "${dtb}" "/leds/${name}" default-state 2>/dev/null || true)"
            if [ "${got}" = "${want_state}" ]; then
                pass "BOOT-${slot} rk3576-src.dtb: /leds/${name} default-state is '${want_state}'"
            else
                fail "BOOT-${slot} rk3576-src.dtb: /leds/${name} default-state is '${got:-missing}', expected '${want_state}'"
            fi

            # No pipe here on purpose: an early-exiting consumer on the read side
            # is the SIGPIPE class this file now avoids structurally. awk would
            # read to EOF and be safe, but not piping at all costs nothing and
            # removes the question rather than requiring the reader to re-derive it.
            read -r -a gpio_cells <<<"$(fdtget -t x "${dtb}" "/leds/${name}" gpios 2>/dev/null || true)"
            got="${gpio_cells[2]-}"
            if [ "${got}" = "${want_flags}" ]; then
                pass "BOOT-${slot} rk3576-src.dtb: /leds/${name} GPIO flags cell is ${want_flags} (${want_pol})"
            else
                fail "BOOT-${slot} rk3576-src.dtb: /leds/${name} GPIO flags cell is '${got:-missing}', expected ${want_flags} (${want_pol}); the wrong polarity drives this LED backwards while its label and default-state still read correctly"
            fi
        done
    else
        skip "BOOT-${slot}: the status-LED device-tree assertions (${MOS_BOARD} declares BOARD_HAS_STATUS_LED=0): there is no indicator on this board, so there are no /leds nodes and no GPIO polarity to get backwards"
    fi

    # Pulled out for the cross-slot comparisons below, both of which are
    # U-Boot's: the compiled boot script and the verity environment it sources.
    # A grub board keeps neither in the slot -- its verity parameters are on
    # the kernel command line GRUB builds -- so there is nothing to extract.
    if is_uboot_board; then
        mcopy -n -i "${fatimg}" "::/${BOOT_SCRIPT_NAME}" "${TMP}/scr-${slot}" 2>/dev/null || true
        mcopy -n -i "${fatimg}" "::/${verity_env}" "${TMP}/verity-${slot}.env" 2>/dev/null || true
    fi
}

check_boot_slot A "${BOOT_A_IMG}" "${BOOT_A_OFFSET_BYTES}" "${BOOT_A_FAT_LABEL}" "${BOOT_A_FAT_VOLUME_ID}" "${BOOT_VERITY_ENV_A_NAME:-}"
check_boot_slot B "${BOOT_B_IMG}" "${BOOT_B_OFFSET_BYTES}" "${BOOT_B_FAT_LABEL}" "${BOOT_B_FAT_VOLUME_ID}" "${BOOT_VERITY_ENV_B_NAME:-}"

# U-BOOT ONLY. Everything from here to the next section is about boot.scr --
# the compiled script U-Boot runs, its uImage magic, and the GPT partition
# NUMBER baked into it because hush cannot read the layout file. A grub board
# has no boot script: GRUB reads its own grub.cfg and addresses slots by
# PARTUUID on the kernel command line, so none of it applies and none of it
# can be silently dropped.
if is_uboot_board; then
    # boot.scr is deliberately identical in both slots: whichever copy U-Boot runs
    # may boot either slot, so they must not diverge.
    if [ -f "${TMP}/scr-A" ] && [ -f "${TMP}/scr-B" ] && cmp -s "${TMP}/scr-A" "${TMP}/scr-B"; then
        pass "factory: ${BOOT_SCRIPT_NAME} is byte-identical in BOOT-A and BOOT-B"
    else
        fail "factory: ${BOOT_SCRIPT_NAME} differs between BOOT-A and BOOT-B (or is missing); the same script must be able to boot either slot"
    fi

    scr_magic="$(od -An -tx1 -N4 "${TMP}/scr-A" 2>/dev/null | tr -d ' \n' || true)"
    if [ "${scr_magic}" = "27051956" ]; then
        pass "${BOOT_SCRIPT_NAME} carries the legacy uImage magic 27051956"
    else
        fail "${BOOT_SCRIPT_NAME} magic is '${scr_magic}', expected 27051956 (mkimage -T script output)"
    fi

    # THE RENUMBERING ASSERTION. boot.scr addresses its slot as `mmc 0:${bootpart}`
    # — a literal GPT partition NUMBER baked into the compiled script, because hush
    # cannot read the layout file. Inserting the loader partition shifted every
    # number by one. A stale value does not announce itself: U-Boot persists the
    # boot-attempt decrement, then fails to find Image in a partition that now holds
    # something else, and the board is bricked until it is re-flashed. This reads the
    # numbers back out of the COMPILED script in the assembled image, not out of
    # os/boot/cx3576-boot.cmd, so it also covers a boot.scr built from a stale source.
    scr_body="$(tr -d '\0' < "${TMP}/scr-A" 2>/dev/null || true)"
    for want in "bootpart:A:${BOOT_A_PARTNUM}" "bootpart:B:${BOOT_B_PARTNUM}" \
        "rootpart:A:${ROOTFS_A_PARTNUM}" "rootpart:B:${ROOTFS_B_PARTNUM}"; do
        IFS=':' read -r var slot num <<<"${want}"
        got="$(awk -v slot="${slot}" -v var="${var}" '
            $1 == "setenv" && $2 == "bootslot" && $3 == slot { in_slot = 1; next }
            $1 == "setenv" && $2 == var && in_slot { print $3; exit }
        ' <<<"${scr_body}")"
        if [ "${got}" = "${num}" ]; then
            pass "${BOOT_SCRIPT_NAME} sets ${var}=${num} for slot ${slot}, matching the layout"
        else
            fail "${BOOT_SCRIPT_NAME} sets ${var}='${got:-nothing}' for slot ${slot}, but the layout puts that partition at p${num}; U-Boot would load from the wrong partition after already persisting the attempt decrement"
        fi
    done

    # U-BOOT ONLY: the per-slot verity environment file the boot script sources.
    # A grub slot carries no such file -- its verity table is on the kernel
    # command line in grub.cfg, and the cmdline assertions check that from the
    # image for both boards.
    if is_uboot_board; then
        # Each slot's verity env must point dm-verity at its OWN rootfs partition;
        # swapping them would make an update verify the slot it just replaced.
        verity_env_ok=1
        for pair in "A:${ROOTFS_A_GUID}:${ROOTFS_B_GUID}" "B:${ROOTFS_B_GUID}:${ROOTFS_A_GUID}"; do
            IFS=':' read -r slot own other <<<"${pair}"
            body="$(cat "${TMP}/verity-${slot}.env" 2>/dev/null || true)"
            body_lc="$(lc "${body}")"
            if [ -z "${body}" ]; then
                fail "BOOT-${slot} ${BOOT_VERITY_ENV_NAME%.env}-$(lc "${slot}").env is missing or empty"
                verity_env_ok=0
            elif [ "${body_lc#*"$(lc "${own}")"}" != "${body_lc}" ] &&
                [ "${body_lc#*"$(lc "${other}")"}" = "${body_lc}" ]; then
                pass "BOOT-${slot} verity env references its own rootfs PARTUUID ${own} and not the other slot's"
            else
                fail "BOOT-${slot} verity env must reference PARTUUID ${own} (its own rootfs slot) and must not mention ${other}"
                verity_env_ok=0
            fi
        done
    else
        verity_env_ok=1
        skip "the per-slot verity environment files (bootloader=${RAUC_BOOTLOADER}): a GRUB slot carries no verity env; the table is on the kernel command line, which is checked from the image above"
    fi

    # The two files are the same table over different partitions: rewriting A's
    # PARTUUID to B's must reproduce B's file exactly. Anything else means the
    # slots' verity parameters have drifted apart.
    if [ "${verity_env_ok}" -eq 1 ]; then
        sed "s/$(lc "${ROOTFS_A_GUID}")/$(lc "${ROOTFS_B_GUID}")/g" "${TMP}/verity-A.env" >"${TMP}/verity-A-as-B.env"
        if cmp -s "${TMP}/verity-A-as-B.env" "${TMP}/verity-B.env"; then
            pass "the A and B verity env files differ only in the rootfs PARTUUID"
        else
            fail "the A and B verity env files differ by more than the rootfs PARTUUID: $(diff "${TMP}/verity-A-as-B.env" "${TMP}/verity-B.env" | tr '\n' ' ')"
        fi
    else
        fail "the A/B verity env comparison could not be made (a slot's verity env is missing or wrong)"
    fi

else
    skip "the boot.scr assertions (bootloader=${RAUC_BOOTLOADER}): there is no compiled boot script in a slot GRUB boots, no uImage magic to check, and no baked-in partition number to catch drifting -- GRUB addresses slots by PARTUUID on the kernel command line, which the cmdline assertions below cover instead"
fi

# ===========================================================================
# 4. Verity / read-only invariants
# ===========================================================================

# Everything needed to verify the payload is taken from the image itself: the
# verity table the bootloader will hand the kernel. Verifying against that
# table (rather than against the build-time env file) is what makes this an
# end-to-end assertion — it proves the cmdline the device will actually boot
# with describes the bytes actually in the slot.
# THE KERNEL COMMAND LINE, FROM WHEREVER THIS BOARD KEEPS IT.
#
# Everything below asserts properties of the command line that are true of BOTH
# boards -- the verity table exists and is read-only, dm-mod.waitfor is present,
# the root hash matches the locally built rootfs, and the boot path names its
# slot. Only the SOURCE differs: U-Boot sources a verity env file out of the
# boot slot, GRUB writes the arguments into its own grub.cfg.
#
# Skipping these on a grub board would have been the easy move and the wrong
# one: it would drop real coverage of verity, of the read-only flag and of
# rauc.slot=, on the board this project now verifies first. So the extraction
# is board-aware and the assertions are not.
board_cmdline() {
    local slot="$1"
    if is_uboot_board; then
        cat "${TMP}/verity-${slot}.env" 2>/dev/null || true
        return
    fi
    # GRUB: the `linux` line for this slot inside the ESP's grub.cfg. Read from
    # the image's own boot slot, not from os/boot/x64-grub.cfg -- the template
    # is what the build INTENDED and this is what the device will read.
    local esp cfg
    case "${slot}" in
    A) esp="${BOOT_A_IMG}" ;;
    B) esp="${BOOT_B_IMG}" ;;
    esac
    cfg="${TMP}/grubcfg-${slot}"
    mcopy -n -i "${esp}" "::/EFI/mos/grub.cfg" "${cfg}" 2>/dev/null || true
    # One entry per slot; take the linux line of the entry for THIS slot.
    awk -v want="$(lc "${slot}")" '
        /menuentry/ { inentry = (tolower($0) ~ ("--id " want) || tolower($0) ~ ("slot " want)) }
        inentry && $1 == "linux" { print; exit }
    ' "${cfg}" 2>/dev/null || true
}

CREATE="$(board_cmdline A | sed -n 's/.*dm-mod\.create="\([^"]*\)".*/\1/p')"
WAITFOR="$(board_cmdline A | sed -n 's/.*\(dm-mod\.waitfor=[^ ]*\).*/\1/p')"

cmdline_hash=""
cmdline_salt=""
hash_offset=0
data_blocks=0
if [ -n "${CREATE}" ]; then
    # rootfs,,,ro,0 <sectors> verity 1 <data> <hash> <dbs> <hbs> <blocks> <hash_start> <algo> <root_hash> <salt>
    cmdline_hash="$(echo "${CREATE}" | awk '{print $(NF-1)}')"
    cmdline_salt="$(echo "${CREATE}" | awk '{print $NF}')"
    hash_block_size="$(echo "${CREATE}" | awk '{print $8}')"
    data_blocks="$(echo "${CREATE}" | awk '{print $9}')"
    hash_start_block="$(echo "${CREATE}" | awk '{print $10}')"
    if [[ "${hash_start_block}" =~ ^[0-9]+$ ]] && [[ "${hash_block_size}" =~ ^[0-9]+$ ]]; then
        hash_offset=$((hash_start_block * hash_block_size))
    fi
fi

ROOTFS_A_IMG="${TMP}/rootfs-a.img"
if [ "${SLOT_MIB}" -gt 0 ]; then
    dd if="${IMG}" of="${ROOTFS_A_IMG}" bs=1M skip="${ROOTFS_A_START_MIB}" count="${SLOT_MIB}" \
        conv=sparse status=none 2>/dev/null || true
else
    : >"${ROOTFS_A_IMG}"
fi

# `veritysetup verify` walks the hash tree in USERSPACE. It never creates a
# device-mapper target, never calls losetup and never mounts anything, which is
# what makes this safe to run against the host.
if [ -z "${cmdline_hash}" ] || [ "${hash_offset}" -eq 0 ]; then
    fail "could not read a dm-mod.create= verity table out of BOOT-A, so the ROOTFS-A payload cannot be verified"
elif veritysetup verify "${ROOTFS_A_IMG}" "${ROOTFS_A_IMG}" "${cmdline_hash}" \
    --hash-offset="${hash_offset}" >"${TMP}/verity-verify.log" 2>&1; then
    pass "ROOTFS-A payload verifies against the root hash in BOOT-A's cmdline (${cmdline_hash})"
else
    fail "ROOTFS-A payload FAILED dm-verity verification against BOOT-A's root hash ${cmdline_hash}: $(tr '\n' ' ' <"${TMP}/verity-verify.log")"
fi

ROOTFS_VERITY_ENV="${REPO_ROOT}/_out/${MOS_BOARD}/rootfs-verity.env"
if [ ! -f "${ROOTFS_VERITY_ENV}" ]; then
    fail "verity parameter file not found: ${ROOTFS_VERITY_ENV} (produce it with os/rootfs/build-v2.sh)"
else
    # FACTORY ONLY: after an update, ROOTFS-A may hold a different release than
    # the rootfs-verity.env sitting in the local _out/ tree.
    eq_ci "factory: root hash in BOOT-A's cmdline vs the locally built rootfs-verity.env" "${cmdline_hash}" "$(env_file_get "${ROOTFS_VERITY_ENV}" VERITY_ROOT_HASH)"
fi

eq_ci "verity salt on the cmdline" "${cmdline_salt}" "${VERITY_SALT}"

# dm_init_init() runs at late_initcall and its wait_for_device_probe() does not
# cover eMMC card discovery, so without this the verity table is assembled
# before the partitions exist. The boot then fails INTERMITTENTLY rather than
# cleanly, which is the hardest class of bug to find later.
if [ -n "${WAITFOR}" ]; then
    pass "the kernel cmdline carries ${WAITFOR} (required on the BSP kernel this board ships: dm-init runs at late_initcall and does not wait for eMMC discovery)"
else
    fail "the kernel cmdline carries NO dm-mod.waitfor=. It is REQUIRED, not optional: dm_init_init() runs at late_initcall and wait_for_device_probe() does not cover eMMC card discovery, so verity assembly races the eMMC probe and boot becomes flaky rather than broken"
fi

# squashfs superblock: magic 'hsqs', compression id at offset 20 (6 == zstd).
sq_magic="$(dd if="${ROOTFS_A_IMG}" bs=1 count=4 status=none 2>/dev/null | tr -d '\0' || true)"
if [ "${sq_magic}" = "hsqs" ]; then
    pass "ROOTFS-A starts with the squashfs magic 'hsqs'"
else
    fail "ROOTFS-A does not start with the squashfs magic 'hsqs' (got '${sq_magic}')"
fi
sq_comp="$(od -An -tu2 -j20 -N2 "${ROOTFS_A_IMG}" 2>/dev/null | tr -d ' \n' || true)"
if [ "${sq_comp}" = "6" ]; then
    pass "ROOTFS-A squashfs compressor id is 6 (zstd)"
else
    fail "ROOTFS-A squashfs compressor id is '${sq_comp}', expected 6 (zstd)"
fi

# An ext4 superblock here would mean a writable root got packed into the slot.
ext4_magic="$(od -An -tx2 -j$((1024 + 56)) -N2 "${ROOTFS_A_IMG}" 2>/dev/null | tr -d ' \n' || true)"
if [ "${ext4_magic}" != "ef53" ]; then
    pass "ROOTFS-A carries no ext4 superblock (magic at 1024+56 is 0x${ext4_magic:-????}, not 0xef53)"
else
    fail "ROOTFS-A carries an ext4 superblock; the v2 root must be a read-only squashfs, not a writable filesystem"
fi

# Read-only by design, asserted in two independent places: the dm table's own
# read-only flag, and the root arguments boot.scr builds around it.
if [ -n "${CREATE}" ] && grep -q '^rootfs,,,ro,' <<<"${CREATE}"; then
    pass "the dm-verity table is created read-only (rootfs,,,ro,...), so the root cannot be written by design"
else
    fail "the dm-verity table is not marked read-only; expected a table beginning 'rootfs,,,ro,' (got '${CREATE}')"
fi
# U-BOOT ONLY. These read the root arguments out of the compiled boot script.
# On a grub board the same arguments are on the kernel command line GRUB
# builds, and the cmdline assertions above already cover them -- the verity
# table, its read-only flag, the waitfor and the root= device are all checked
# there, from the image, for both boards.
if is_uboot_board; then
    # boot.scr is a uImage-wrapped text script, so the root arguments it assembles
    # are readable straight out of it.
    if [ -f "${TMP}/scr-A" ] &&
        grep -aq 'root=/dev/dm-0' "${TMP}/scr-A" &&
        grep -aq 'rootfstype=squashfs' "${TMP}/scr-A" &&
        grep -aqE 'rootfstype=squashfs ro( |$)' "${TMP}/scr-A"; then
        pass "${BOOT_SCRIPT_NAME} boots root=/dev/dm-0 rootfstype=squashfs ro (read-only squashfs root)"
    else
        fail "${BOOT_SCRIPT_NAME} does not set 'root=/dev/dm-0 rootfstype=squashfs ro'; the v2 root must be mounted read-only from the verity device"
    fi

    # ROOTFS-B is zero-filled at build: the first update is what fills it.
    rootfs_b_nonzero="$(dd if="${IMG}" bs=1M skip="${PART_START_MIB_ROOTFS_B}" count="${SLOT_MIB}" status=none 2>/dev/null | tr -d '\0' | wc -c || echo -1)"
    if [ "${SLOT_MIB}" -gt 0 ] && [ "${rootfs_b_nonzero}" = "0" ]; then
        pass "factory: ROOTFS-B is entirely zero (${SLOT_MIB} MiB; the first update fills it)"
    else
        fail "factory: ROOTFS-B contains ${rootfs_b_nonzero} non-zero bytes, expected none"
    fi
else
    skip "the boot.scr root-argument assertions (bootloader=${RAUC_BOOTLOADER}): there is no compiled boot script on this board; GRUB assembles the same arguments onto the kernel command line, which the cmdline assertions above check from the image"
fi

# ===========================================================================
# 5. The U-Boot environment pair is zero-filled at build
# ===========================================================================

# U-BOOT ONLY: section 5 exists because the redundant U-Boot environment must
# ship zeroed, so U-Boot writes it on first boot rather than inheriting a
# build machine's. A grub board has no such pair.
if is_uboot_board; then
    for pair in "A:${UENV_A_OFFSET_BYTES}" "B:${UENV_B_OFFSET_BYTES}"; do
        IFS=':' read -r slot offset <<<"${pair}"
        nonzero="$(dd if="${IMG}" skip="${offset}" count="${UENV_SIZE_BYTES}" iflag=skip_bytes,count_bytes status=none 2>/dev/null | tr -d '\0' | wc -c || echo -1)"
        if [ "${nonzero}" = "0" ]; then
            pass "factory: UENV-${slot} is entirely zero ($((UENV_SIZE_BYTES / 1024)) KiB at ${offset} bytes; U-Boot populates it on first boot)"
        else
            fail "factory: UENV-${slot} contains ${nonzero} non-zero bytes, expected none"
        fi
    done
else
    skip "the zero-filled U-Boot environment pair (bootloader=${RAUC_BOOTLOADER}): this board has no uenv partitions, so there is nothing that must ship blank for the bootloader to populate"
fi

# ===========================================================================
# 6. META / STATE / EPHEMERAL / DATA
# ===========================================================================

# Args: name start-mib size-mib fs-label fs-uuid
check_ext4() {
    local name="$1" start_mib="$2" size_mib="$3" want_label="$4" want_uuid="$5"
    local img="${TMP}/${name}.img"
    dd if="${IMG}" of="${img}" bs=1M skip="${start_mib}" count="${size_mib}" conv=sparse status=none 2>/dev/null || true

    local info label uuid
    info="$(tune2fs -l "${img}" 2>/dev/null || true)"
    label="$(echo "${info}" | sed -n 's/^Filesystem volume name:[[:space:]]*//p')"
    if [ "${label}" = "${want_label}" ]; then
        pass "${name} ext4 label is '${want_label}'"
    else
        fail "${name} ext4 label is '${label}', expected '${want_label}'"
    fi
    uuid="$(echo "${info}" | sed -n 's/^Filesystem UUID:[[:space:]]*//p')"
    eq_ci "${name} ext4 UUID" "${uuid}" "${want_uuid}"

    # orphan_file cannot be mounted by kernel 6.1, so its presence would make
    # the partition unusable on the device this image is built for.
    if sed -n 's/^Filesystem features:[[:space:]]*//p' <<<"${info}" | grep -w "orphan_file" >/dev/null; then
        fail "${name} ext4 has the orphan_file feature; kernel ${KERNEL_VERSION} cannot mount it"
    else
        pass "${name} ext4 has no orphan_file feature"
    fi

    local header block_count block_size fs_bytes want_bytes
    header="$(dumpe2fs -h "${img}" 2>/dev/null || true)"
    block_count="$(echo "${header}" | sed -n 's/^Block count:[[:space:]]*//p')"
    block_size="$(echo "${header}" | sed -n 's/^Block size:[[:space:]]*//p')"
    fs_bytes=$((${block_count:-0} * ${block_size:-0}))
    want_bytes=$((size_mib * MIB_BYTES))
    if [ "${fs_bytes}" -gt 0 ] && [ "${fs_bytes}" -eq "${want_bytes}" ]; then
        pass "${name} ext4 fills its partition (${block_count} blocks x ${block_size} bytes = ${size_mib} MiB)"
    else
        fail "${name} ext4 is ${fs_bytes} bytes, expected ${want_bytes} (the partition size)"
    fi

    if e2fsck -fn "${img}" >/dev/null 2>&1; then
        pass "e2fsck -fn on ${name} is clean"
    else
        fail "e2fsck -fn on ${name} reported errors"
    fi

    # Created empty at build: the seed oneshots populate them on first boot.
    local entries
    entries="$(debugfs -R "ls -p /" "${img}" 2>/dev/null |
        awk -F/ 'NF >= 7 && $6 != "." && $6 != ".." && $6 != "lost+found" {print $6}' || true)"
    if [ -z "${entries}" ]; then
        pass "factory: ${name} is empty at build (nothing but lost+found)"
    else
        fail "factory: ${name} is not empty at build; it contains: $(echo "${entries}" | tr '\n' ' ')"
    fi

}

check_ext4 meta "${PART_START_MIB_META}" "${META_SIZE_MIB}" "${META_FS_LABEL}" "${META_FS_UUID}"
check_ext4 state "${PART_START_MIB_STATE}" "${STATE_SIZE_MIB}" "${STATE_FS_LABEL}" "${STATE_FS_UUID}"
check_ext4 ephemeral "${PART_START_MIB_EPHEMERAL}" "${MOS_VAR_MIB}" "${EPHEMERAL_FS_LABEL}" "${EPHEMERAL_FS_UUID}"
check_ext4 data "${PART_START_MIB_DATA}" "${DATA_SIZE_MIB}" "${DATA_FS_LABEL}" "${DATA_FS_UUID}"

# ===========================================================================
# 7. Packed root filesystem contents
# ===========================================================================

# Extract once; every content check below is then a plain read of the extracted
# tree. -xattrs is required for the file-capability assertion further down.
ROOT="${TMP}/root"
if unsquashfs -n -xattrs -d "${ROOT}" "${ROOTFS_A_IMG}" >"${TMP}/unsquashfs.log" 2>&1; then
    pass "ROOTFS-A squashfs unpacks cleanly"
else
    fail "ROOTFS-A squashfs failed to unpack: $(tail -n 3 "${TMP}/unsquashfs.log" | tr '\n' ' ')"
fi

# Assert a path in the packed root is a regular file.
sq_regular() {
    if [ -f "${ROOT}$1" ] && [ ! -L "${ROOT}$1" ]; then
        pass "${1} is a regular file"
    else
        fail "${1} missing or not a regular file"
    fi
}

# Assert a path is a symlink whose target ends in the given basename.
sq_symlink() {
    local path="$1" target="$2" dest
    if [ -L "${ROOT}${path}" ]; then
        dest="$(readlink "${ROOT}${path}")"
        case "${dest}" in
        "${target}" | */"${target}")
            pass "${path} is a symlink to ${dest}"
            return
            ;;
        esac
        fail "${path} is a symlink to '${dest}', expected ${target}"
    else
        fail "${path} missing or not a symlink"
    fi
}

# Assert a unit is enabled, i.e. some *.wants directory links to it. The wants
# directory is not named by the caller: units land in multi-user.target.wants,
# local-fs.target.wants or timers.target.wants depending on what they do.
sq_enabled() {
    local unit="$1" found
    found="$(find "${ROOT}/etc/systemd/system" -name "${unit}" -path '*.wants/*' 2>/dev/null || true)"
    found="${found%%$'\n'*}"
    if [ -n "${found}" ]; then
        pass "${unit} is enabled (${found#"${ROOT}"})"
    else
        fail "${unit} enablement symlink missing (no *.wants entry under /etc/systemd/system)"
    fi
}

# Same, but also accepting the vendor preset tree. Distro units (the systemd
# timers, repart) are statically enabled by a .wants symlink shipped under
# /usr/lib/systemd/system, never by one under /etc, so asserting only /etc
# would fail on a correctly enabled unit.
sq_enabled_any() {
    local unit="$1" found
    found="$(find "${ROOT}/etc/systemd/system" "${ROOT}/usr/lib/systemd/system" \
        -name "${unit}" -path '*.wants/*' 2>/dev/null || true)"
    found="${found%%$'\n'*}"
    if [ -n "${found}" ]; then
        pass "${unit} is enabled (${found#"${ROOT}"})"
    else
        fail "${unit} enablement symlink missing (no *.wants entry under /etc or /usr/lib systemd trees)"
    fi
}


# --- kernel modules and firmware (carried over from v1) ---
modules_entries="$(ls "${ROOT}/usr/lib/modules" 2>/dev/null || true)"
# THE PROPERTY IS "EXACTLY ONE", not "exactly 6.1.115". The version was pinned
# at the top of this file to the cx3576 BSP kernel, so the x64 image -- running
# Debian's 6.12.101+deb13-amd64, which is correct for it -- failed with a
# message saying its modules directory was wrong. What actually matters is that
# a single kernel's modules are present: two entries means a stale set shipped
# beside the live one, and none means the modules never made it in.
KERNEL_VERSION="$(printf '%s' "${modules_entries}" | tr -d ' ')"
if [ -n "${KERNEL_VERSION}" ] && [ "$(printf '%s\n' "${modules_entries}" | wc -l)" = "1" ]; then
    pass "/usr/lib/modules contains exactly one kernel's modules (${KERNEL_VERSION})"
else
    fail "/usr/lib/modules entries: '$(echo "${modules_entries}" | tr '\n' ' ')', expected exactly one"
fi
# The board's radio firmware set, from its definition. This was five literal
# AIC8800D80 paths -- correct for cx3576, and five failures on a board with no
# radio at all. An empty BOARD_FIRMWARE_FILES is the board saying it carries
# none, which is why the skip below names the board rather than the files.
if [ -n "${BOARD_FIRMWARE_FILES}" ]; then
    for fw in ${BOARD_FIRMWARE_FILES}; do
        sq_regular "${fw}"
    done
else
    skip "the board radio-firmware set (${MOS_BOARD} declares BOARD_FIRMWARE_FILES empty): there is no radio on this board, so there is no runtime firmware it must carry"
fi
sq_regular /usr/lib/systemd/systemd

# --- base services (carried over from v1) ---
# ssh.service enablement is NOT asserted here: it is a function of the image
# profile, and both directions of that are checked in the M5 section below.
if [ -n "$(find "${ROOT}/etc/systemd/system" -name 'systemd-networkd.service' -path '*.wants/*' 2>/dev/null || true)" ] ||
    [ -e "${ROOT}/etc/systemd/system/dbus-org.freedesktop.network1.service" ]; then
    pass "systemd-networkd is enabled"
else
    fail "systemd-networkd enablement symlink missing"
fi
sq_grep /etc/systemd/network/80-dhcp.network 'DHCP=yes' "/etc/systemd/network/80-dhcp.network has DHCP=yes"
sq_grep /etc/systemd/journald.conf.d/00-volatile.conf '^Storage=volatile$' \
    "journald is Storage=volatile (the journal never lands on the fixed-size /var)"

# --- mosd (carried over from v1) ---
# e_machine follows the board's architecture. It was pinned to aarch64, so the
# x64 image reported "/usr/bin/mosd is not an aarch64 ELF" -- true, and not a
# defect: the binary is exactly the architecture that board asks for. The
# assertion that earns its keep is "the staged binary matches THIS board", which
# is what catches a host-arch artefact shipping to a device.
case "${MOS_ARCH}" in
arm64) ELF_MACHINE_LE=b700 ;;
amd64) ELF_MACHINE_LE=3e00 ;;
*) echo "error: MOS_ARCH is '${MOS_ARCH}'; this verifier knows arm64 and amd64" >&2; exit 1 ;;
esac

elf_is_board_arch() {
    local head
    head="$(od -An -tx1 -N20 "${ROOT}$1" 2>/dev/null | tr -d ' \n' || true)"
    # ELF magic 7f454c46; e_machine is the 16-bit LE field at offset 18.
    if [ "${head:0:8}" = "7f454c46" ] && [ "${head:36:4}" = "${ELF_MACHINE_LE}" ]; then
        pass "$1 is a ${MOS_ARCH} ELF"
    else
        fail "$1 is not a ${MOS_ARCH} ELF (header: '${head:0:40}')"
    fi
}
sq_regular /usr/bin/mosd
elf_is_board_arch /usr/bin/mosd
sq_grep /usr/lib/systemd/system/mosd.service 'BusName=com.mos.mosd' \
    "/usr/lib/systemd/system/mosd.service has BusName=com.mos.mosd"
sq_enabled mosd.service
sq_regular /usr/share/dbus-1/system.d/com.mos.mosd.conf
sq_regular /usr/share/dbus-1/system.d/com.mos.ext.conf

# --- apid (carried over from v1) ---
sq_regular "${APID_BIN}"
elf_is_board_arch "${APID_BIN}"
# Section 6.3's escape, asserted against the image rather than against the
# crate; the helper and its reasoning are up beside the other helpers.
check_builtin_ui
sq_grep /usr/lib/systemd/system/apid.service 'After=.*mosd\.service' \
    "/usr/lib/systemd/system/apid.service orders After= mosd.service"
sq_grep /usr/lib/systemd/system/apid.service 'StateDirectory=mos/apid' \
    "/usr/lib/systemd/system/apid.service has StateDirectory=mos/apid"
sq_enabled apid.service

# --- board hardware init (carried over from v1; the unit set is ENUMERATED) ---
# Single SKU: bcmdhd was dropped with the AIC-only fleet decision and must not
# creep back into the module list.
# Comment lines are excluded — the file may legitimately EXPLAIN the drop.
# The module list is about THIS BOARD'S radio, so it is gated on the board
# declaring one. A board with no firmware set has no modules.conf to hold a
# driver name, and asserting one would be asserting the presence of hardware.
if [ -n "${BOARD_FIRMWARE_FILES}" ]; then
    if [ -f "${ROOT}/etc/mos/modules.conf" ] && \
        ! grep -v '^[[:space:]]*#' "${ROOT}/etc/mos/modules.conf" | grep 'bcmdhd' >/dev/null; then
        pass "/etc/mos/modules.conf loads no bcmdhd module (single-SKU AIC8800)"
    else
        fail "/etc/mos/modules.conf missing or still loads bcmdhd (single-SKU AIC8800 board)"
    fi
    sq_grep /etc/mos/modules.conf 'aic8800_fdrv' "/etc/mos/modules.conf lists aic8800_fdrv"
    sq_grep /etc/mos/modules.conf '^aic8800_btlpm$' "/etc/mos/modules.conf lists aic8800_btlpm (BT core of the combo chip)"
else
    skip "the radio module-list assertions (${MOS_BOARD} declares no BOARD_FIRMWARE_FILES): there is no radio, so there is no driver the module list must load and no superseded one it must not"
fi

# health.conf is shared by every board and is asserted unconditionally; the
# rest are the board's own hardware facts.
sq_regular "/etc/mos/health.conf"
if [ -n "${BOARD_HWINIT_CONFS}" ]; then
    for c in ${BOARD_HWINIT_CONFS}; do
        sq_regular "/etc/mos/${c}.conf"
    done
else
    skip "the per-board hwinit facts under /etc/mos (${MOS_BOARD} declares BOARD_HWINIT_CONFS empty): this board has no CAN bus, USB gadget controller, Bluetooth radio or burned MAC for an hwinit unit to read"
fi

# The board facts are READ, never restated: os/verify-image.sh already asserts
# their values against board/cx3576/init, which is the user's area. Here we
# only assert that each unit that exists is also enabled.
hw_units="$(cd "${ROOT}/usr/lib/systemd/system" 2>/dev/null && ls mos-*.service 2>/dev/null || true)"
if [ -z "${hw_units}" ]; then
    fail "no mos-*.service units found in /usr/lib/systemd/system"
else
    pass "found $(echo "${hw_units}" | wc -w) mos-*.service unit(s) in the image: $(echo "${hw_units}" | tr '\n' ' ')"
    # ENUMERATED, never hardcoded: the hwinit set grows (mos-mac and mos-gadget
    # were added and silently shipped disabled once already), and a hardcoded
    # list is exactly how the next added unit falls outside coverage.
    # UNITS A RECONCILER OWNS ARE DELIBERATELY NOT ENABLED, and this loop used
    # to say every mos-*.service must be. That was true while every mos-* unit
    # was an hwinit oneshot; it stopped being true when PLAN-011 D7 shipped
    # mos-mqttd and mos-mqtt-broker INERT, started and stopped by mosd from
    # `mqtt.enabled`. An image that force-enabled them would defeat the switch.
    #
    # So the two assertions would have contradicted each other -- check_mqttd
    # and check_mqtt_broker assert these are NOT enabled, this one asserted
    # they must be -- and the contradiction only surfaced when a real image
    # carrying the broker was verified for the first time. Neither side's
    # tests could see it: the fixture-driven checks never ran on an assembled
    # root, and this enumeration never ran on one that had the broker in it.
    #
    # Derived from the checks that own them, not a second hardcoded list: a
    # future reconciler-owned unit is added HERE and to its own inert check, or
    # it fails one of the two.
    # Bare unit names: MQTTD_UNIT and MQTT_BROKER_UNIT above are full paths and
    # would never match. Each name here is asserted inert by check_mqttd or
    # check_mqtt_broker; adding one without adding it there fails that check.
    reconciler_owned="mos-mqttd.service mos-mqtt-broker.service"
    not_enabled=""
    skipped_owned=""
    for u in ${hw_units}; do
        case " ${reconciler_owned} " in
        *" ${u} "*) skipped_owned="${skipped_owned} ${u}"; continue ;;
        esac
        if [ -z "$(find "${ROOT}/etc/systemd/system" -name "${u}" -path '*.wants/*' 2>/dev/null || true)" ]; then
            not_enabled="${not_enabled} ${u}"
        fi
    done
    [ -z "${skipped_owned}" ] ||
        skip "the enabled-at-boot assertion for${skipped_owned}: these are started by mosd from the settings tree, not by the image, and their own checks assert the image does NOT enable them"
    if [ -z "${not_enabled}" ]; then
        pass "every mos-*.service present in the image is also enabled"
    else
        fail "these mos-*.service units are installed but NOT enabled:${not_enabled}"
    fi
fi
# The hwinit helper scripts are enumerated the same way, from os/hwinit/.
hw_helpers="$(cd "${ROOT}/usr/lib/mos" 2>/dev/null && ls hwinit-* 2>/dev/null || true)"
if [ -n "${hw_helpers}" ]; then
    pass "hwinit helpers present in /usr/lib/mos: $(echo "${hw_helpers}" | tr '\n' ' ')"
else
    fail "no hwinit-* helpers found in /usr/lib/mos"
fi
sq_regular /usr/lib/udev/rules.d/60-mos-gadget-getty.rules
sq_grep /usr/lib/udev/rules.d/60-mos-gadget-getty.rules 'serial-getty@ttyGS0\.service' \
    "the udev rule pulls in serial-getty@ttyGS0 when the gadget enumerates"
sq_regular /usr/bin/btattach
if [ -f "${ROOT}/etc/bluetooth/main.conf" ] && grep -qE "^[[:space:]]*Name[[:space:]]*=" "${ROOT}/etc/bluetooth/main.conf"; then
    fail "/etc/bluetooth/main.conf pins Name (blocks the hostname plugin)"
else
    pass "/etc/bluetooth/main.conf leaves Name to the hostname plugin"
fi
sq_enabled bluetooth.service
if [ -e "${ROOT}/etc/modules-load.d/wifi.conf" ]; then
    fail "/etc/modules-load.d/wifi.conf still present (superseded by mos-modules)"
else
    pass "/etc/modules-load.d/wifi.conf is gone (superseded by mos-modules)"
fi

# --- the status indicator: red until multi-user.target, then blue ------------
# The device tree gives status-red `default-state = "on"`, so the kernel lights
# red at init and only a consumer in the rootfs ever turns it off. Upstream has
# one for the Alpine v1 demo; the v2 systemd rootfs had none, which shipped a
# booted board on a permanent "still booting" red.
#
# Modelled on the mos-shadow-reconcile block below: M4 shipped units that were
# installed but never enabled, and Before= lines naming units that were absent.
# systemd drops both SILENTLY, so presence alone proves nothing.
sq_regular /usr/lib/mos/mos-status-led
LED_SCRIPT="${ROOT}/usr/lib/mos/mos-status-led"
led_script_mode="$(stat -c %a "${LED_SCRIPT}" 2>/dev/null || echo none)"
if [ -x "${LED_SCRIPT}" ] && [ ! -L "${LED_SCRIPT}" ]; then
    pass "/usr/lib/mos/mos-status-led is executable (mode 0${led_script_mode})"
else
    fail "/usr/lib/mos/mos-status-led is mode ${led_script_mode}, not executable; ExecStart= would fail with 203/EXEC and the board would stay on the kernel's boot red for the whole session"
fi
sq_regular /usr/lib/systemd/system/mos-status-led.service
# ENABLED, not merely installed: an installed-but-unenabled unit is exactly the
# M4 failure, and it is invisible -- nothing logs it and nothing fails.
sq_enabled mos-status-led.service
sq_grep /usr/lib/systemd/system/mos-status-led.service \
    '^ExecStart=/usr/lib/mos/mos-status-led start$' \
    "mos-status-led.service runs /usr/lib/mos/mos-status-led start"
# Without ExecStop= the shutdown half simply does not exist, and a board that is
# powered down but still energised keeps reading as ready.
sq_grep /usr/lib/systemd/system/mos-status-led.service \
    '^ExecStop=/usr/lib/mos/mos-status-led stop$' \
    "mos-status-led.service restores red on stop (ExecStop=)"
# Not a style point: a Type=oneshot unit without RemainAfterExit counts as
# inactive the moment ExecStart returns, so systemd runs ExecStop immediately
# and the board snaps back to red the instant it went blue.
sq_grep /usr/lib/systemd/system/mos-status-led.service \
    '^RemainAfterExit=yes$' \
    "mos-status-led.service sets RemainAfterExit=yes, so ExecStop runs at shutdown and not straight after ExecStart"
# After=, never Before=: the unit is pulled in BY multi-user.target and ordered
# AFTER it, so the target is reached without waiting for the LED. Ordered the
# other way round, an unwritable brightness attribute would hold up boot.
sq_grep /usr/lib/systemd/system/mos-status-led.service \
    '^After=multi-user\.target$' \
    "mos-status-led.service is ordered After=multi-user.target, so nothing in boot blocks on the indicator"

# The no-dark ordering, asserted IN THE SHIPPED SCRIPT and per branch. Turning
# the destination colour on before extinguishing the source is the whole reason
# the transition is safe: with the two writes swapped there is an instant where
# both LEDs are off and the board reads as dead. Nothing else can catch that --
# either order is valid shell and passes every syntax check.
for spec in "start:led_on.*BLUE:led_off.*RED:blue is switched ON before red is switched off, so the boot->ready transition never goes dark" \
    "stop:led_on.*RED:led_off.*BLUE:red is switched ON before blue is switched off, so the ready->shutdown transition never goes dark"; do
    IFS=':' read -r branch first second what <<<"${spec}"
    # Region-scoped by line number: the branch label opens it, the next `;;`
    # closes it, so a write in the other branch cannot satisfy this one.
    if [ -f "${LED_SCRIPT}" ] && awk -v label="${branch})" -v a="${first}" -v z="${second}" '
        $0 == label { inb = 1; next }
        inb && $0 ~ /^[[:space:]]*;;[[:space:]]*$/ { inb = 0; next }
        inb && !na && $0 ~ a { na = NR }
        inb && !nz && $0 ~ z { nz = NR }
        END { exit !(na > 0 && nz > 0 && na < nz) }' "${LED_SCRIPT}"; then
        pass "mos-status-led ${branch}: ${what}"
    else
        fail "mos-status-led ${branch}: ${what} — /usr/lib/mos/mos-status-led is missing, or its ${branch}) branch does not write /${first}/ before /${second}/"
    fi
done

# --- M4: RAUC ---
sq_regular /usr/bin/rauc
# U-BOOT ONLY. RAUC writes the boot slot through fw_setenv on a uboot board
# and through grub-editenv on a grub one; the grub helper is asserted in its
# own section above, keyed on the same RAUC_BOOTLOADER.
if is_uboot_board; then
    sq_regular /usr/bin/fw_printenv
    # fw_setenv is a SYMLINK to fw_printenv on trixie and was a second regular file
    # on bookworm: libubootenv now ships one multi-call binary. What RAUC needs is
    # a working fw_setenv, so the assertion is that the path RESOLVES to a regular
    # file, whichever way the packager spelled it. Asserting "regular file" here
    # would fail on a correct image, and asserting "symlink" would fail on the
    # previous one.
    if [ -f "${ROOT}/usr/bin/fw_setenv" ]; then
        if [ -L "${ROOT}/usr/bin/fw_setenv" ]; then
            pass "/usr/bin/fw_setenv resolves to a regular file (symlink -> $(readlink "${ROOT}/usr/bin/fw_setenv"))"
        else
            pass "/usr/bin/fw_setenv is a regular file"
        fi
    else
        fail "/usr/bin/fw_setenv is missing or does not resolve to a regular file; RAUC writes the boot slot through it and the A/B handover fails on the device"
    fi
else
    skip "fw_printenv/fw_setenv (bootloader=${RAUC_BOOTLOADER}): RAUC reaches this board's boot state through grub-editenv, which is asserted separately above"
fi
sq_regular /etc/rauc/system.conf

RAUC_CONF="${ROOT}/etc/rauc/system.conf"
# The slot devices must be the layout's rootfs and boot partitions, addressed
# by PARTUUID. A wrong GUID here installs an update over the running slot.
rauc_slots_ok=1
for pair in "rootfs.0:${ROOTFS_A_GUID}" "rootfs.1:${ROOTFS_B_GUID}" "boot.0:${BOOT_A_GUID}" "boot.1:${BOOT_B_GUID}"; do
    IFS=':' read -r slot guid <<<"${pair}"
    got="$(awk -v s="[slot.${slot}]" '$0 == s {f = 1; next} /^\[/ {f = 0} f && /^device=/ {sub(/^device=/, ""); print; exit}' "${RAUC_CONF}" 2>/dev/null || true)"
    if [ "$(lc "${got}")" != "/dev/disk/by-partuuid/$(lc "${guid}")" ]; then
        rauc_slots_ok=0
        bad_slot="${slot} -> '${got}' (expected /dev/disk/by-partuuid/$(lc "${guid}"))"
    fi
done
if [ "${rauc_slots_ok}" -eq 1 ]; then
    pass "RAUC system.conf addresses all four slots by the layout's partition GUIDs"
else
    fail "RAUC system.conf slot device mismatch: ${bad_slot}"
fi

# RENUMBERING SAFETY. Every slot device must be a by-partuuid path. A
# /dev/mmcblk0pN path would encode a partition NUMBER, and inserting or removing
# a partition ahead of it would silently point RAUC at the wrong slot — it would
# install an update over the running rootfs. Asserted as a shape, so the config
# cannot acquire such a path later.
bad_devs="$(grep '^device=' "${RAUC_CONF}" 2>/dev/null | grep -v '^device=/dev/disk/by-partuuid/' || true)"
if [ -z "${bad_devs}" ]; then
    pass "every RAUC slot device is a /dev/disk/by-partuuid/ path; no slot is addressed by partition number, so renumbering cannot mis-target an install"
else
    fail "RAUC system.conf addresses a slot by something other than a PARTUUID: $(echo "${bad_devs}" | tr '\n' ' '); a partition-number path breaks silently when the table is renumbered"
fi

# WIPE-SAFETY CONTRACT. RAUC's status file is update state — which slot was
# installed and whether it was marked good. /var is DISCARDABLE by design, so
# putting it there would make "wipe /var" quietly destroy update bookkeeping.
statusfile="$(sed -n 's/^statusfile=//p' "${RAUC_CONF}" 2>/dev/null | tail -n1 || true)"
status_mount=""
case "${statusfile}" in
/mnt/meta/*) status_mount="META" ;;
/mnt/state/*) status_mount="STATE" ;;
esac
if [ -n "${status_mount}" ]; then
    pass "RAUC statusfile '${statusfile}' resolves onto ${status_mount}, not /var (wipe-safety contract)"
else
    fail "RAUC statusfile is '${statusfile}'; update state must live on META or STATE, never on the discardable /var"
fi
# The config must point at the canonical keyring path; whether a keyring
# actually SHIPS there is a separate, stricter question. It used to be answered
# here by assertion-free prose ("deliberately not shipped") while the overlay
# path was gitignored so a dev CA COULD be dropped in and staged silently —
# check_dev_keyring is what closes that gap.
sq_grep /etc/rauc/system.conf '^path=/etc/rauc/keyring\.pem$' \
    "RAUC keyring path is /etc/rauc/keyring.pem (whether a keyring ships there is asserted separately by the baked-in-keyring check)"
check_dev_keyring

# ===========================================================================
# INTEGRATION MACHINERY
#
# A recurring defect class in this tree: the component is present, the checks
# pass, and the integration does not work. Three instances have now been found
# in M4 alone -- a missing rauc.slot= on the cmdline, a health gate parsing a
# variable rauc never emits, and the rauc D-Bus service package missing while
# /usr/bin/rauc is present. Each shipped a binary or a config file that looked
# right and was inert at runtime.
#
# So wherever this verifier asserts that something EXISTS, it also asserts the
# runtime machinery that makes it USABLE: the D-Bus policy and activation that
# let a bus name be owned, the systemd units that actually apply a timer or a
# definition file, the tools an fstab option is implemented by, and the
# mountpoints a bind mount needs.
# ===========================================================================

# rauc: Debian bookworm SPLITS the CLI from the daemon. `rauc` does not depend
# on, or even recommend, `rauc-service`, and Debian builds the CLI WITH service
# support so it proxies every command over D-Bus instead of operating locally.
# With /usr/bin/rauc alone there is no bus policy, no activation file and no
# unit, so every `rauc status` dies with "The name de.pengutronix.rauc was not
# provided by any .service files" -- and the health gate, which depends on that
# command, silently no-ops. Asserting the binary alone is what missed this.
sq_regular /usr/share/dbus-1/system.d/de.pengutronix.rauc.conf
sq_regular /usr/share/dbus-1/system-services/de.pengutronix.rauc.service
sq_regular /usr/lib/systemd/system/rauc.service

# The system bus itself, which rauc, mosd and bluez all depend on.
if [ -f "${ROOT}/usr/lib/systemd/system/dbus.service" ] &&
    [ -f "${ROOT}/usr/lib/systemd/system/dbus.socket" ]; then
    pass "the D-Bus system bus (dbus.service + dbus.socket) is present, so bus-activated services can run"
else
    fail "dbus.service and/or dbus.socket missing; rauc, mosd and bluez all address each other over the system bus"
fi
# A policy file that does not grant `own` is as good as no policy file: the
# daemon starts, fails to take its name, and every client call errors.
sq_grep /usr/share/dbus-1/system.d/com.mos.mosd.conf 'allow own="com\.mos\.mosd"' \
    "the mosd D-Bus policy actually grants own= of com.mos.mosd (a policy that does not is inert)"

# --- the mosd D-Bus policy is ROOT-ONLY (RFCT-048) ---------------------------
# com.mos.mosd reboots and powers off the appliance, rewrites the persisted
# settings tree, and -- since RFCT-033 -- writes a root credential straight
# into /etc/shadow through SetTransientRootPassword. Who may reach that name is
# decided by a FILE IN THIS IMAGE, so it is the image contract's business.
#
# The path matters as much as the contents. dbus-daemon reads system-bus policy
# from /usr/share/dbus-1/system.d/ (and /etc/dbus-1/system.d/); a policy dropped
# anywhere else is not a stricter policy, it is NO policy -- the daemon still
# takes the name and the base system.conf alone decides who may talk to it.
#
# The bus name is READ from mosd.service's BusName= rather than restated here.
# A policy for a name nothing owns is the existence-versus-function trap: it
# would sail through a file-exists check while protecting nothing at all.
mosd_policy_text="$(cat "${ROOT}${MOSD_POLICY_PATH}" 2>/dev/null || true)"
mosd_bus_name="$(sed -n 's/^BusName=[[:space:]]*//p' \
    "${ROOT}/usr/lib/systemd/system/mosd.service" 2>/dev/null | tr -d '\r' | tail -n1)"
if [ -n "${mosd_policy_text}" ]; then
    pass "${MOSD_POLICY_PATH} ships and is readable, i.e. the mosd bus policy is where dbus-daemon actually looks for it"
else
    fail "${MOSD_POLICY_PATH} is missing or empty. dbus-daemon reads system-bus policy from this directory; with nothing here the base system.conf decides alone, and every local uid can call Reboot, SetSettings and SetTransientRootPassword"
fi

# Parse the policy the way dbus-daemon groups it: rules are collected per policy
# BLOCK, and a rule's block decides who it applies to. XML comments are stripped
# first -- this file documents its own extension point with example markup, and
# a grep that could not tell an example from a rule would be worse than no check.
printf '%s\n' "${mosd_policy_text}" >"${TMP}/mosd-policy.xml"
mosd_policy_facts="$(awk -v bus="${mosd_bus_name}" '
function attrval(s, key,   re, p, rest, q) {
    re = key "=\""
    p = index(s, re)
    if (p == 0) return ""
    rest = substr(s, p + length(re))
    q = index(rest, "\"")
    if (q == 0) return ""
    return substr(rest, 1, q - 1)
}
{
    line = $0
    out = ""
    while (length(line) > 0) {
        if (incomment) {
            p = index(line, "-->")
            if (p == 0) { line = ""; break }
            line = substr(line, p + 3)
            incomment = 0
        } else {
            p = index(line, "<!--")
            if (p == 0) { out = out line; line = ""; break }
            out = out substr(line, 1, p - 1)
            line = substr(line, p + 4)
            incomment = 1
        }
    }
    doc = doc " " out
}
END {
    n = split(doc, seg, /<policy/)
    for (i = 2; i <= n; i++) {
        s = seg[i]
        gt = index(s, ">")
        attrs = (gt > 0) ? substr(s, 1, gt - 1) : s
        body = (gt > 0) ? substr(s, gt + 1) : ""
        e = index(body, "</policy>")
        if (e > 0) body = substr(body, 1, e - 1)
        isdefault = (attrs ~ /context="default"/)
        isroot = (attrs ~ /user="root"/)
        m = split(body, tok, "<")
        for (j = 1; j <= m; j++) {
            t = tok[j]
            if (t ~ /^allow[ \t]/) kind = "allow"
            else if (t ~ /^deny[ \t]/) kind = "deny"
            else continue
            q = index(t, ">")
            if (q > 0) t = substr(t, 1, q - 1)
            own = attrval(t, "own")
            snd = attrval(t, "send_destination")
            rcv = attrval(t, "receive_sender")
            for (k = 1; k <= 3; k++) {
                v = (k == 1) ? own : ((k == 2) ? snd : rcv)
                if (v ~ /^com\.mos\./) names[v] = 1
            }
            if (kind == "allow" && isdefault && (snd == bus || rcv == bus)) defallow++
            if (kind == "allow" && own == bus) {
                if (isroot) ownroot++
                else ownother++
            }
        }
    }
    namelist = ""
    for (v in names) namelist = namelist " " v
    printf "%d %d %d%s\n", defallow + 0, ownroot + 0, ownother + 0, namelist
}
' "${TMP}/mosd-policy.xml")"
mosd_default_allows="$(echo "${mosd_policy_facts}" | awk '{print $1}')"
mosd_own_root="$(echo "${mosd_policy_facts}" | awk '{print $2}')"
mosd_own_other="$(echo "${mosd_policy_facts}" | awk '{print $3}')"
# `|| true`: with no com.mos.* name in the policy at all, grep exits 1 and
# set -e would kill the verifier here -- turning "the policy is missing" into a
# crash with no RESULT line instead of the three explicit FAILs below.
mosd_policy_names="$(echo "${mosd_policy_facts}" | cut -d' ' -f4- | tr ' ' '\n' |
    grep -v '^$' | sort -u | tr '\n' ' ' | sed 's/ $//' || true)"

# No default-context ALLOW, in either direction. send_destination is the obvious
# half; receive_sender is the half that is easy to leave open, because
# SettingsChanged broadcasts the settings VALUE -- a uid that may not call
# anything can still subscribe and read access.webAdmin.password_hash the moment
# an operator sets it. A caller who cannot ask can still listen.
if [ "${mosd_default_allows}" = "0" ]; then
    pass "no <policy context=\"default\"> allows send_destination= or receive_sender= for ${mosd_bus_name:-the mosd bus name}, so neither calling it nor listening to its signals is open to every local uid"
else
    fail "the mosd D-Bus policy has ${mosd_default_allows} default-context allow rule(s) for ${mosd_bus_name:-the mosd bus name}: any local uid can call Reboot/SetSettings/SetTransientRootPassword and/or subscribe to SettingsChanged, which carries settings values including access.webAdmin.password_hash"
fi

# own= is what lets mosd take the name at all, and granting it outside root
# would let an unprivileged process take the name FIRST and impersonate mosd.
if [ "${mosd_own_root}" != "0" ] && [ "${mosd_own_other}" = "0" ]; then
    pass "allow own=\"${mosd_bus_name}\" appears only under <policy user=\"root\">"
else
    fail "allow own= for '${mosd_bus_name}' appears ${mosd_own_root} time(s) under <policy user=\"root\"> and ${mosd_own_other} time(s) elsewhere; it must appear at least once under root and nowhere else, or an unprivileged process could take the name before mosd does"
fi

# Every com.mos.* name the policy mentions must be the one mosd.service owns.
# This catches the typo that is invisible by inspection: a deny naming
# com.mos.mosdx denies nothing, and the default-context check above would still
# report zero allows while the real name sat wide open.
if [ -n "${mosd_bus_name}" ] && [ "${mosd_policy_names}" = "${mosd_bus_name}" ]; then
    pass "the policy names exactly the bus mosd.service declares (BusName=${mosd_bus_name}); it is not a policy for a name nothing owns"
else
    fail "policy/unit bus-name mismatch: mosd.service declares BusName='${mosd_bus_name}' but the policy mentions '${mosd_policy_names}'. A policy naming anything else guards a name nothing owns while the real one is governed by system.conf alone"
fi
# ONE policy file, not two. dbus-daemon reads system-bus policy from BOTH
# /usr/share/dbus-1/system.d/ and /etc/dbus-1/system.d/, concatenating every
# .conf it finds and letting later rules override earlier ones. A second file
# naming com.mos.mosd -- an operator drop-in, a stale copy left by a package,
# a debugging file that shipped by accident -- would therefore not be a
# stricter policy layered on top: it could hand back exactly the
# default-context allow the checks above just proved absent, and every one of
# those checks would still pass. RFCT-048 restricted the name to root and named
# this as the one path back out that it left unasserted; this is that assertion.
#
# The bus name is READ from mosd.service, as above, so this cannot go stale
# against a rename. The blessed path is excluded by name, not by directory: a
# second file in /usr/share/dbus-1/system.d/ is exactly as dangerous as one in
# /etc/dbus-1/system.d/.
#
# The search is over RULES, not raw bytes: XML comments are stripped first, the
# same way the parse above strips them and for the same reason. com.mos.ext.conf
# ships in this very directory and its comment NAMES com.mos.mosd -- that is the
# whole point of its extension-point warning, which explains that widening its
# own_prefix would re-grant the mosd name. Matching that prose would turn a file
# documenting the hazard into a reported instance of it, and the obvious repair
# (delete the warning) is strictly worse than the check. A real <allow> or
# <deny> naming com.mos.mosd in a second file still trips it.
#
# `grep -c ... >/dev/null` and NOT `grep -q`: -q exits at the first match, which
# closes the pipe under the writer on the left; that writer dies of SIGPIPE
# (141), and `set -o pipefail` reports the status of the RIGHTMOST command to
# exit non-zero -- so the pipeline reads as FAILED exactly when the pattern was
# FOUND. This check reported "com.mos.mosd.conf is the ONLY file" on an image
# whose mos-mqttd.conf grants three members on that very name, and it reported
# it BECAUSE the grant was there. -c reads to EOF, so nothing is ever handed a
# closed pipe, and the count goes to /dev/null because only the status is read.
#
# A SECOND FILE IS NOT AUTOMATICALLY A DEFECT, and asserting that it is made
# this check contradict the design. mos-mqttd.conf grants the MQTT bridge three
# named members on com.mos.mosd, deliberately and with its rationale in the
# file: the bridge is the only daemon in the image with a network socket, so it
# does not run as root, so it needs a grant, and the grant names members
# precisely so it can never reach Reboot or SetTransientRootPassword. A rule
# that banned the file outright would be satisfied only by deleting the grant
# (breaking the bridge) or by widening com.mos.mosd back to every local uid.
#
# What actually has to hold is that no second file re-opens the name to
# ANYBODY: every rule naming it must sit inside a <policy user=> or
# <policy group=> block -- not the default context -- and must name a member
# rather than the interface at large. That is judged here, from the file, and
# does not depend on check_mqttd running later.
mosd_policy_dups=""
mosd_policy_scoped=""
for d in /etc/dbus-1/system.d /usr/share/dbus-1/system.d; do
    [ -d "${ROOT}${d}" ] || continue
    for f in "${ROOT}${d}"/*; do
        [ -f "${f}" ] || continue
        [ "${f#"${ROOT}"}" = "${MOSD_POLICY_PATH}" ] && continue
        [ -n "${mosd_bus_name}" ] || continue
        dbus_policy_tags "${f}" | grep -Fc "${mosd_bus_name}" >/dev/null || continue
        unscoped="$(dbus_policy_tags "${f}" |
            awk -v name="${mosd_bus_name}" '
                /^<policy/ { scoped = ($0 ~ /user=/ || $0 ~ /group=/) ? 1 : 0; next }
                /^<\/policy/ { scoped = 0; next }
                index($0, name) > 0 {
                    member = ($0 ~ /send_member=/ || $0 ~ /receive_member=/) ? 1 : 0
                    if (!scoped || !member) print
                }' | tr '\n' ' ')"
        if [ -n "${unscoped}" ]; then
            mosd_policy_dups="${mosd_policy_dups} ${f#"${ROOT}"} [${unscoped}]"
        else
            mosd_policy_scoped="${mosd_policy_scoped} ${f#"${ROOT}"}"
        fi
    done
done
if [ -n "${mosd_policy_dups}" ]; then
    fail "a second D-Bus policy file grants ${mosd_bus_name:-the mosd bus name} outside a named identity or without naming a member:${mosd_policy_dups}. dbus-daemon reads both system.d directories and applies later rules over earlier ones, so this reinstates what ${MOSD_POLICY_PATH} removes -- and every other policy check here would still pass"
elif [ -n "${mosd_policy_scoped}" ]; then
    pass "the only other file(s) naming ${mosd_bus_name} --${mosd_policy_scoped} -- grant it strictly per-member inside a <policy user=|group=> block, so nothing outside ${MOSD_POLICY_PATH} widens the name to the default context"
else
    pass "${MOSD_POLICY_PATH} is the ONLY file under /etc/dbus-1/system.d or /usr/share/dbus-1/system.d that mentions ${mosd_bus_name:-the mosd bus name}; no second policy can override the root-only restriction"
fi

# --- the extension D-Bus policy grants com.mos.ext.* and NOTHING ELSE --------
# Defined beside check_ui_location and the rest of the fixture-hook set, because
# the hook has to be able to dispatch it; called here so the non-fixture path
# still runs it in exactly this position. The rationale is on the function.
check_ext_policy

# bluez's D-Bus policy moved from /etc/dbus-1/system.d to
# /usr/share/dbus-1/system.d between bookworm and trixie — the general dbus
# relocation of VENDOR policy out of /etc, which is reserved for the admin's
# overrides. mos's own policies (com.mos.mosd.conf, com.mos.ext.conf,
# mos-mqttd.conf) already install to the /usr/share path; bluez caught up.
# Both are accepted because dbus-daemon reads both, and asserting only the new
# one would make this verifier refuse a correct bookworm image.
if [ -f "${ROOT}/usr/share/dbus-1/system.d/bluetooth.conf" ] ||
    [ -f "${ROOT}/etc/dbus-1/system.d/bluetooth.conf" ]; then
    pass "bluez ships a D-Bus policy (in /usr/share/dbus-1/system.d or /etc/dbus-1/system.d); without it bluetoothd cannot own org.bluez"
else
    fail "no bluetooth.conf in either dbus policy directory; bluetoothd cannot take org.bluez and every Bluetooth feature fails at runtime"
fi

# DNS: systemd-resolved is only reachable through the stub resolver symlink.
sq_enabled systemd-resolved.service
sq_symlink /etc/resolv.conf stub-resolv.conf

# modprobe needs the dependency index; mos-modules is modprobe-driven.
sq_regular "/usr/lib/modules/${KERNEL_VERSION}/modules.dep"

# The repart definitions asserted above are inert without the unit that applies
# them, and it is enabled by a vendor preset rather than by anything in /etc.
sq_enabled_any systemd-repart.service
# x-systemd.growfs on the /srv entry is implemented by this helper binary.
sq_regular /usr/lib/systemd/systemd-growfs
# A timer without its service does nothing.
sq_regular /usr/lib/systemd/system/fstrim.service
# The /var age policies in tmpfiles.d are applied only by this timer.
sq_enabled_any systemd-tmpfiles-clean.timer
# The gadget udev rule pulls in this template unit by name.
sq_regular /usr/lib/systemd/system/serial-getty@.service

# The mountpoints every fstab entry and every STATE bind needs to already exist
# in the read-only root. Defined beside check_ui_location, which chains to it.
check_packed_mountpoints

# --- M4 integration: RAUC must be able to identify the BOOTED slot ---
#
# os/health/mos-health reads RAUC_SYSTEM_BOOTED_BOOTNAME out of
# `rauc status --output-format=shell` and exits 0 early when it is empty. If
# rauc can never identify the booted slot the gate silently no-ops forever:
# `rauc status mark-good` is never reached, the installed slot is never
# confirmed, and U-Boot rolls back once the boot credits are spent. A health
# gate that always passes is worse than none, so the preconditions are checked
# here rather than assumed.
#
# rauc 1.8 get_cmdline_bootname() (src/context.c) reads /proc/cmdline and takes
# the FIRST of: `rauc.external`, `rauc.slot=<x>`, barebox bootstate (n/a for
# bootloader=uboot), then `root=<x>`. determine_slot_states() (src/install.c)
# then matches that string against each slot's bootname, its slot name, or
# realpath(device) -- and errors with "Did not find booted slot" if none match.
#
# A v2 image boots `root=/dev/dm-0`, the verity device. That is not a bootname
# ("A"/"B"), not a slot name ("rootfs.0"/"rootfs.1"), and not the realpath of
# any slot device (/dev/mmcblk0pN), so the root= fallback CANNOT work here and
# `rauc.slot=` is required. This is a property of the boot path, not of RAUC.
# The backend follows the LAYOUT, not a literal. cx3576 is uboot and x64 is
# grub, and pinning the assertion to one of them would make it fail on the
# correct configuration of the other -- reported as a defect in the image
# rather than as a check that was written for a single board.
sq_grep /etc/rauc/system.conf "^bootloader=${RAUC_BOOTLOADER}\$" \
    "RAUC system.conf selects the ${RAUC_BOOTLOADER} bootloader backend, which is what os/layout/${LAYOUT_BOARD}-v2.env specifies"
if [ "$(grep -c '^bootname=[AB]$' "${RAUC_CONF}" 2>/dev/null || true)" = "2" ]; then
    pass "RAUC system.conf gives both rootfs slots a bootname (A and B), so a booted slot can be named at all"
else
    fail "RAUC system.conf must give both rootfs slots a bootname=A / bootname=B; without one, rauc has no bootable slot group"
fi

# The effective cmdline: on a U-Boot board it is assembled by boot.scr from its
# own rootargs PLUS the per-slot verity env, so either may legitimately carry
# rauc.slot=; on a grub board it is the whole `linux` line for that slot. Both
# go through board_cmdline, and the assertion below is the same either way --
# rauc must be able to name the slot it booted, whatever wrote the arguments.
for pair in "A:${ROOTFS_A_GUID}" "B:${ROOTFS_B_GUID}"; do
    IFS=':' read -r slot guid <<<"${pair}"
    if is_uboot_board; then
        cmdline_src="$(cat "${TMP}/scr-A" "${TMP}/verity-${slot}.env" 2>/dev/null | tr -d '\0' || true)"
    else
        cmdline_src="$(board_cmdline "${slot}" | tr -d '\0' || true)"
    fi
    root_arg="$(grep -ao 'root=[^ "]*' <<<"${cmdline_src}" | first_line || true)"
    if grep -aqE "rauc\.slot=(\\\$\{bootslot\}|${slot})" <<<"${cmdline_src}"; then
        pass "slot ${slot}: the boot path sets rauc.slot=, so rauc can identify the booted slot"
    elif [ "$(lc "${root_arg}")" = "root=partuuid=$(lc "${guid}")" ]; then
        pass "slot ${slot}: root= names the slot's own PARTUUID, so rauc's root= fallback identifies the booted slot"
    else
        fail "slot ${slot}: the boot path sets neither rauc.slot= nor a root= naming the slot device (found '${root_arg:-none}'). rauc 1.8 derives the booted slot from rauc.slot= or root= and matches it against bootname / slot name / realpath(device); '${root_arg:-none}' matches none of those, so \`rauc status\` fails with \"Did not find booted slot\", RAUC_SYSTEM_BOOTED_BOOTNAME is never emitted, mos-health exits 0 without ever running \`rauc status mark-good\`, and every update rolls back when the boot credits run out. Fix belongs in the boot path (os/boot/cx3576-boot.cmd), NOT here"
    fi
done

# The variable the shipped health gate parses must be one rauc actually emits.
# Verified empirically against rauc 1.8 (the version the Debian bookworm
# allowlist installs) driving THIS system.conf: with a slot matching the booted
# root device, `rauc status --output-format=shell` emits
#
#   RAUC_SYSTEM_COMPATIBLE, RAUC_SYSTEM_VARIANT,
#   RAUC_SYSTEM_BOOTED_BOOTNAME, RAUC_SYSTEM_SLOTS
#
# and per-slot RAUC_SLOT_STATE_n (the booted one reads 'booted'). There is NO
# RAUC_SYSTEM_BOOTED_SLOT in the output under any configuration, so a gate that
# greps for it always reads empty and always exits 0 without reaching
# `rauc status mark-good` -- independently of the rauc.slot= problem above.
if [ ! -f "${ROOT}/usr/lib/mos/mos-health" ]; then
    fail "/usr/lib/mos/mos-health missing, so its RAUC status parsing cannot be checked"
elif grep -q 'RAUC_SYSTEM_BOOTED_SLOT' "${ROOT}/usr/lib/mos/mos-health"; then
    fail "mos-health parses RAUC_SYSTEM_BOOTED_SLOT, which rauc 1.8 NEVER emits. \`rauc status --output-format=shell\` emits RAUC_SYSTEM_BOOTED_BOOTNAME (plus per-slot RAUC_SLOT_STATE_n='booted'); verified against rauc 1.8 driving this exact system.conf. The gate therefore always reads an empty slot, always exits 0 and never reaches \`rauc status mark-good\`, so every update rolls back. Fix belongs in os/health/mos-health, NOT here"
else
    pass "mos-health does not depend on the non-existent RAUC_SYSTEM_BOOTED_SLOT variable"
fi

# --- M4 integration: apid's health probe needs an HTTP client ---
# mos-health probe c calls curl (or wget) against https://127.0.0.1/healthz and
# logs "SKIP (no curl or wget in the image)" when neither exists -- a silent
# hole in the gate. curl was added to the rootfs allowlist deliberately (commit
# 4c1180c, which shipped curl in the v2 rootfs so the apid health probe stops
# skipping), so its absence is now a regression, not a neutral fact.
http_client=""
for c in /usr/bin/curl /usr/bin/wget /bin/curl /bin/wget; do
    if [ -f "${ROOT}${c}" ]; then
        http_client="${c}"
        break
    fi
done
if [ -n "${http_client}" ]; then
    pass "apid health probe is LIVE: ${http_client} is in the image (mos-health probe c would SKIP without an HTTP client)"
else
    fail "no curl or wget in the image, so mos-health probe c degrades to 'SKIP (no curl or wget in the image)' and apid is never actually probed by the health gate"
fi

# --- the bootloader's environment access from Linux --------------------------
#
# Each backend rewrites its own A/B state through a HELPER BINARY, and RAUC
# execs it: fw_setenv for uboot, grub-editenv for grub. A missing helper does
# not stop rauc.service -- it starts and then cannot answer anything, reporting
# only "Failed to start grub-editenv", which reads as a RAUC problem rather
# than a missing 403 KB file. That is how it was found on x64.
if [ "${RAUC_BOOTLOADER}" = "grub" ]; then
    sq_regular /usr/bin/grub-editenv
    pass_or_fail_note="RAUC's grub backend execs it to read and write ${RAUC_GRUBENV:-the grubenv}"
    if [ -f "${ROOT}/usr/bin/grub-editenv" ]; then
        pass "grub-editenv is in the packed root; ${pass_or_fail_note}"
    else
        fail "grub-editenv is absent; ${pass_or_fail_note}, so the A/B boot order can be neither read nor written and rauc.service is up but useless"
    fi
fi

# U-BOOT ONLY: fw_env.config tells libubootenv where the redundant U-Boot
# environment lives. A grub board has no such environment and no such file.
if is_uboot_board; then
    # --- M4: U-Boot environment access from Linux ---
    sq_regular /etc/fw_env.config
    fwenv="${ROOT}/etc/fw_env.config"
    fwenv_lines="$(grep -cE '^/dev/' "${fwenv}" 2>/dev/null || echo 0)"
    if [ "${fwenv_lines}" = "2" ]; then
        pass "/etc/fw_env.config has exactly two device lines (this is what marks the environment redundant to libubootenv)"
    else
        fail "/etc/fw_env.config has ${fwenv_lines} device lines, expected 2; with only one side configured, every read from the other fails its CRC check"
    fi
    uenv_hex="$(printf '0x%x' "${UENV_SIZE_BYTES}")"
    fwenv_ok=1
    for guid in "${UENV_A_GUID}" "${UENV_B_GUID}"; do
        if ! grep -qiE "^/dev/disk/by-partuuid/$(lc "${guid}")[[:space:]]+0x0[[:space:]]+${uenv_hex}[[:space:]]*$" "${fwenv}" 2>/dev/null; then
            fwenv_ok=0
            bad_uenv="${guid}"
        fi
    done
    if [ "${fwenv_ok}" -eq 1 ]; then
        pass "/etc/fw_env.config addresses both UENV partitions at offset 0x0 with size ${uenv_hex}"
    else
        fail "/etc/fw_env.config has no '/dev/disk/by-partuuid/$(lc "${bad_uenv}") 0x0 ${uenv_hex}' line"
    fi
else
    skip "/etc/fw_env.config and its two-device redundancy assertions (bootloader=${RAUC_BOOTLOADER}): there is no U-Boot environment on this board, so there is nothing for libubootenv to address"
fi

# --- M4: health gate and first-boot machine id ---
sq_regular /usr/lib/mos/mos-health
sq_regular /usr/lib/mos/mos-machine-id
sq_regular /usr/lib/systemd/system/mos-health.service
sq_regular /usr/lib/systemd/system/mos-machine-id.service
sq_enabled mos-health.service
sq_enabled mos-machine-id.service

check_status_led
# --- M4: storage tiers in /etc/fstab ---
FSTAB="${ROOT}/etc/fstab"
# Args: description partuuid mountpoint required-opts forbidden-opt
check_fstab() {
    local what="$1" guid="$2" mnt="$3" want="$4" forbid="${5:-}"
    local line
    line="$(awk -v d="PARTUUID=$(lc "${guid}")" -v m="${mnt}" '$1 == d && $2 == m {print; exit}' "${FSTAB}" 2>/dev/null || true)"
    if [ -z "${line}" ]; then
        fail "/etc/fstab has no ${mnt} entry for PARTUUID=$(lc "${guid}") (${what})"
        return
    fi
    local opts
    opts="$(echo "${line}" | awk '{print $4}')"
    local o
    for o in ${want//,/ }; do
        if [[ ",${opts}," != *",${o},"* ]]; then
            fail "/etc/fstab ${mnt} lacks the '${o}' option (${what}); options are '${opts}'"
            return
        fi
    done
    if [ -n "${forbid}" ] && [[ ",${opts}," == *",${forbid},"* ]]; then
        fail "/etc/fstab ${mnt} carries '${forbid}' but must not (${what}); options are '${opts}'"
        return
    fi
    pass "/etc/fstab mounts ${mnt} from PARTUUID=$(lc "${guid}") with ${opts} (${what})"
}
check_fstab "DATA is the growth target" "${DATA_GUID}" "${DATA_MOUNT}" "noatime,x-systemd.growfs"
check_fstab "STATE: configuration + identity, precious" "${STATE_GUID}" /mnt/state "noatime"
check_fstab "META: update metadata, precious" "${META_GUID}" /mnt/meta "noatime"
check_fstab "/var is fixed-size disposable residue, NOT a growth target" \
    "${EPHEMERAL_GUID}" /var "noatime" "x-systemd.growfs"
# The four checks above are about the PARTITIONS. None of them would notice the
# custom UI root moving off DATA, so that fact is asserted separately; the
# helper and its reasoning are up beside the other helpers.
check_ui_location
if awk '$1 == "tmpfs" && $2 == "/tmp" && $3 == "tmpfs"' "${FSTAB}" 2>/dev/null | grep . >/dev/null; then
    pass "/etc/fstab mounts /tmp as tmpfs"
else
    fail "/etc/fstab has no tmpfs /tmp entry"
fi
# The root is deliberately absent from fstab: the kernel assembles /dev/dm-0
# from the cmdline and mounts it read-only, so no entry could ever rewrite it.
if awk '$2 == "/" {found = 1} END {exit !found}' "${FSTAB}" 2>/dev/null; then
    fail "/etc/fstab has a / entry; the verity root is assembled from the cmdline and must not be remountable via fstab"
else
    pass "/etc/fstab has no / entry (the read-only verity root is assembled from the cmdline)"
fi
sq_enabled fstrim.timer

# --- M4: systemd-repart definitions ---
# repart pairs definitions with partitions by type UUID in DISK ORDER, so the
# count must match the number of linux-generic partitions exactly: one too few
# and the grow flag attaches to the wrong partition, one too many and repart
# CREATES a partition nobody asked for.
# WANT_DEFS is not a literal: it is the number of linux-generic partitions
# COUNTED in the assembled GPT above. That is what makes this an integration
# check rather than two hardcoded numbers agreeing with each other — and it is
# what proves the loader partition is invisible to repart, since its distinct
# type keeps it out of the count.
WANT_DEFS="${LINUX_GENERIC_N}"
def_count="$(find "${ROOT}/etc/repart.d" -name '*.conf' 2>/dev/null | wc -l)"
if [ "${def_count}" = "${WANT_DEFS}" ] && [ "${WANT_DEFS}" -gt 0 ]; then
    pass "/etc/repart.d has exactly ${WANT_DEFS} definitions, one per linux-generic partition counted in the image's own GPT (the loader is not one of them)"
else
    fail "/etc/repart.d has ${def_count} definitions but the GPT carries ${WANT_DEFS} linux-generic partitions; repart matches definitions to partitions by type UUID in disk order, so a miscount silently attaches growth to the wrong partition"
fi
grow_defs="$(grep -l '^Weight=1000$' "${ROOT}/etc/repart.d/"*.conf 2>/dev/null || true)"
grow_n="$(echo "${grow_defs}" | grep -c . || true)"
if [ "${grow_n}" = "1" ] && [ "$(basename "${grow_defs}")" = "80-data.conf" ]; then
    pass "exactly one repart definition grows, and it is 80-data.conf (DATA / p${DATA_PARTNUM}), not ephemeral"
else
    fail "expected exactly one growing repart definition, 80-data.conf; found ${grow_n}: $(echo "${grow_defs}" | xargs -r -n1 basename | tr '\n' ' ')"
fi

# --- the loader is protected STRUCTURALLY, not by a flag ---
# systemd-repart's discard is deliberately left ON: first-boot TRIM is worth
# having, and the loader is safe because it has a partition entry. A
# --discard=no drop-in would be the other approach, and having both would hide a
# regression in the partition entry behind a flag nobody remembers is there.
discard_hits="$(grep -rl -- '--discard=no' "${ROOT}/etc/systemd" "${ROOT}/usr/lib/systemd" 2>/dev/null || true)"
if [ -z "${discard_hits}" ]; then
    pass "no --discard=no override ships in the image; the loader is protected by its GPT entry and first-boot TRIM stays enabled"
else
    fail "a --discard=no override ships in the image ($(echo "${discard_hits}" | tr '\n' ' ')); loader protection must come from the partition entry, not from disabling discard"
fi

# --- M4: wipe-safety — nothing precious is reachable only from /var ---
# This is the assertion that makes "/var is discardable" true rather than
# aspirational: identity, credentials and pairings must be binds onto STATE.
for pair in "var-lib-mos.mount:/var/lib/mos" "var-lib-bluetooth.mount:/var/lib/bluetooth"; do
    IFS=':' read -r unit where <<<"${pair}"
    f="${ROOT}/etc/systemd/system/${unit}"
    if [ ! -f "${f}" ]; then
        fail "${where} holds precious state but ${unit} does not exist; it would stay on the discardable /var"
    elif ! grep -qx "Where=${where}" "${f}"; then
        fail "${unit} does not mount ${where}"
    elif ! grep -qE '^What=/mnt/state/' "${f}"; then
        fail "${unit} is not backed by STATE (What= must be under /mnt/state)"
    elif [ -z "$(find "${ROOT}/etc/systemd/system" -name "${unit}" -path '*.wants/*' 2>/dev/null || true)" ]; then
        fail "${unit} exists but is not enabled; ${where} would stay on the discardable /var"
    else
        pass "${where} is a STATE-backed bind via ${unit} (survives a /var wipe)"
    fi
done

# --- PLAN-011 D5: the writable, persistent system unit directory -------------
# Defined beside check_ui_location and the rest of the fixture-hook set, because
# the hook has to be able to dispatch it; called here so the non-fixture path
# still runs it in exactly this position. The rationale is on the function.
check_ext_unit_dir

# --- RFCT-099: the packed root ships no package manager ----------------------
# Fixture-hook set, called here for the non-fixture path. Rationale on the
# function.
check_no_package_manager

# --- the TLS trust anchors -------------------------------------------------
#
# Asserted separately from every other file check because the bundle is
# GENERATED at build time by update-ca-certificates, not shipped by a package,
# so it is exactly the kind of artefact a purge or a layer rebuild can drop
# without anything else changing. The image carried libssl3t64 and no trust
# store for its whole life before this: TLS code with nobody to believe, which
# fails only on the first outbound connection and reports it as the remote's
# fault ("certificate signed by unknown authority").
check_ca_bundle() {
    local bundle=/etc/ssl/certs/ca-certificates.crt n
    if [ ! -s "${ROOT}${bundle}" ]; then
        fail "${bundle} is missing or empty; the image can speak TLS and cannot verify anyone. Container pulls, curl and any HTTPS update fetch fail closed with 'certificate signed by unknown authority'"
        return
    fi
    n="$(grep -c 'BEGIN CERTIFICATE' "${ROOT}${bundle}" 2>/dev/null || echo 0)"
    if [ "${n}" -ge 100 ]; then
        pass "${bundle} holds ${n} CA certificates (a count, not a pinned set: the assertion is that the store was GENERATED, which is what fails when ca-certificates ships without its postinst having run)"
    else
        fail "${bundle} holds only ${n} certificates; the package is installed but its trust store was not generated"
    fi
}
check_ca_bundle

# --- PLAN-012: the container engine, installed and inert ---------------------
# Fixture-hook set, called here for the non-fixture path.
check_container_engine

# --- PLAN-011 D6: the MQTT bridge as installed -------------------------------
# Same arrangement, same reason. The function is up with the fixture set so
# os/ui-location-test.sh can watch each of its assertions fail without an
# image; this is the call that runs them against the real one.
check_mqttd

# --- RFCT-104: the MQTT broker, installed and inert --------------------------
# Same arrangement, same reason.
check_mqtt_broker

# --- M5: /etc/shadow lives on STATE (per-device password) ---
# access.md phase 1 gives every device its own root password, and the only file
# pam_unix will read for it is /etc/shadow. On v2 that path is inside the
# dm-verity squashfs, so the file has to be a SYMLINK onto the STATE-backed
# tree; a bind-mounted file would not do, because a bind cannot be replaced by
# rename and rename is how a credential is written without a torn read.
SHADOW_LINK_TARGET=/var/lib/mos/shadow
FACTORY_SHADOW=/usr/share/factory/etc/shadow

# Half one of the end-to-end property: the path PAM reads IS the symlink, and it
# names the STATE-backed directory exactly. Asserting "a symlink exists" would
# pass for a symlink pointing anywhere at all.
shadow_type="$(stat -c %F "${ROOT}/etc/shadow" 2>/dev/null || echo absent)"
shadow_dest="$(readlink "${ROOT}/etc/shadow" 2>/dev/null || true)"
if [ "${shadow_type}" = "symbolic link" ] && [ "${shadow_dest}" = "${SHADOW_LINK_TARGET}" ]; then
    pass "/etc/shadow is a symlink to ${SHADOW_LINK_TARGET} (the path pam_unix opens is writable at runtime)"
else
    fail "/etc/shadow is '${shadow_type}'${shadow_dest:+ -> ${shadow_dest}}, expected a symlink to ${SHADOW_LINK_TARGET}; on the read-only verity root a regular file there can never be written, so no per-device password is possible"
fi

# Half two: nothing inside the squashfs can satisfy that path. Both the source
# (/etc/shadow itself) and the destination (/var/lib/mos/shadow) must be absent
# as regular files in the packed image, or PAM would read an image-wide file
# that is byte-identical on every device. This is the pair that makes the claim
# "PAM reads the STATE copy" provable from the artifact rather than asserted.
if [ "${shadow_type}" = "regular file" ]; then
    fail "/etc/shadow is a REGULAR FILE inside the squashfs; it shadows the STATE-backed copy and is identical on every device in the fleet"
else
    pass "no regular /etc/shadow inside the squashfs (nothing shadows the STATE-backed copy)"
fi
if [ -e "${ROOT}${SHADOW_LINK_TARGET}" ] || [ -L "${ROOT}${SHADOW_LINK_TARGET}" ]; then
    fail "${SHADOW_LINK_TARGET} exists inside the squashfs, so /etc/shadow would resolve to an image file rather than to the STATE bind"
else
    pass "${SHADOW_LINK_TARGET} does not exist inside the squashfs, so the symlink can only ever resolve through var-lib-mos.mount onto STATE"
fi

# And the link target must be exactly what var-lib-mos.mount puts on STATE.
# A symlink into a directory nothing mounts is a dangling file, not a credential.
VLM_UNIT="${ROOT}/etc/systemd/system/var-lib-mos.mount"
vlm_where="$(sed -n 's/^Where=//p' "${VLM_UNIT}" 2>/dev/null | tail -n1)"
vlm_what="$(sed -n 's/^What=//p' "${VLM_UNIT}" 2>/dev/null | tail -n1)"
# Derived from the ACTUAL link destination, not from the constant above: a
# check against the constant would keep passing for a symlink retargeted
# anywhere else, which is the whole thing being guarded against.
link_dir="$([ -n "${shadow_dest}" ] && dirname "${shadow_dest}" || echo "<not a symlink>")"
if [ -n "${shadow_dest}" ] && [ "${vlm_where}" = "${link_dir}" ] &&
    [ "${vlm_what#/mnt/state/}" != "${vlm_what}" ]; then
    pass "the /etc/shadow symlink lands in ${vlm_where}, which var-lib-mos.mount binds from ${vlm_what} on STATE"
else
    fail "the /etc/shadow symlink target dir '${link_dir}' is not bound from STATE by var-lib-mos.mount (Where='${vlm_where}', What='${vlm_what}')"
fi

# /etc/passwd and /etc/group stay in the image, read-only: only the
# secret-bearing file moves, so account definitions remain verity-covered.
sq_regular /etc/passwd
sq_regular /etc/group

# The factory template the reconciler derives from.
sq_regular "${FACTORY_SHADOW}"
FAC="${ROOT}${FACTORY_SHADOW}"

# It has to carry the accounts the image ships, or an account added by a later
# update would get a bare placeholder instead of its proper aging fields — and
# an empty factory copy would make every check above pass for the wrong reason.
if [ ! -f "${FAC}" ] || [ ! -f "${ROOT}/etc/passwd" ]; then
    fail "cannot compare /etc/passwd against ${FACTORY_SHADOW}: one of them is missing"
else
    fac_missing=""
    while IFS=: read -r u _; do
        [ -n "${u}" ] || continue
        grep -q "^${u}:" "${FAC}" || fac_missing="${fac_missing} ${u}"
    done <"${ROOT}/etc/passwd"
    fac_n="$(grep -c . "${FAC}" || true)"
    if [ -z "${fac_missing}" ] && [ "${fac_n}" -gt 0 ]; then
        pass "${FACTORY_SHADOW} carries all ${fac_n} accounts listed in /etc/passwd (root included)"
    else
        fail "${FACTORY_SHADOW} has ${fac_n} entries and is missing:${fac_missing:- (nothing, but it is empty)}"
    fi
fi

# 0640 root:shadow, and it must survive packing. unix_chkpwd is setgid shadow
# precisely so a non-root PAM stack can read this file; any other group and
# password verification stops working for every non-root caller.
shadow_gid="$(awk -F: '$1 == "shadow" { print $3 }' "${ROOT}/etc/group" 2>/dev/null || true)"
fac_mode="$(stat -c %a "${FAC}" 2>/dev/null || echo none)"
fac_own="$(stat -c '%u:%g' "${FAC}" 2>/dev/null || echo none)"
if [ -n "${shadow_gid}" ]; then
    pass "the image defines the 'shadow' group (gid ${shadow_gid}), which unix_chkpwd runs setgid to"
else
    fail "the image has no 'shadow' group, so unix_chkpwd cannot read /etc/shadow at all"
fi
if [ "${fac_mode}" = "640" ] && [ "${fac_own}" = "0:${shadow_gid}" ]; then
    pass "${FACTORY_SHADOW} is 0640 root:shadow (0:${shadow_gid}) in the packed image"
else
    fail "${FACTORY_SHADOW} is mode ${fac_mode} owner ${fac_own}, expected 640 and 0:${shadow_gid} (root:shadow)"
fi

# The reconcile unit: present, ENABLED, and its ordering naming units that
# actually exist. M4 shipped units that were installed but never enabled and
# Before= lines naming units that were absent; systemd drops both silently.
sq_regular /usr/lib/mos/mos-shadow-reconcile
sq_regular /etc/systemd/system/mos-shadow-reconcile.service
sq_enabled mos-shadow-reconcile.service
REC_UNIT="${ROOT}/etc/systemd/system/mos-shadow-reconcile.service"
sq_grep /etc/systemd/system/mos-shadow-reconcile.service \
    '^ExecStart=/usr/lib/mos/mos-shadow-reconcile$' \
    "mos-shadow-reconcile.service runs /usr/lib/mos/mos-shadow-reconcile"
# after= / before= must name the real unit names, and each named unit must be
# in the image: an ordering against a unit that does not exist is inert.
# unit-file-path pairs, so "named" and "present" are asserted together.
for pair in "After:var-lib-mos.mount:/etc/systemd/system/var-lib-mos.mount" \
    "Before:mosd.service:/usr/lib/systemd/system/mosd.service" \
    "Before:ssh.service:/usr/lib/systemd/system/ssh.service"; do
    IFS=':' read -r keyw dep depfile <<<"${pair}"
    # Whitespace-separated unit list, matched as a whole token: a substring
    # match would accept "Before=xmosd.serviceX" and a bare grep for the name
    # would accept it appearing in a comment.
    named=0
    if [ -f "${REC_UNIT}" ]; then
        sed -n "s/^${keyw}=//p" "${REC_UNIT}" | tr ' ' '\n' | grep -Fx "${dep}" >/dev/null && named=1
    fi
    if [ ! -f "${REC_UNIT}" ]; then
        fail "mos-shadow-reconcile.service is missing, so its ${keyw}=${dep} ordering cannot be checked"
    elif [ "${named}" -eq 0 ]; then
        fail "mos-shadow-reconcile.service has no ${keyw}= naming ${dep}; /etc/shadow would be read or written before it converges"
    elif [ ! -f "${ROOT}${depfile}" ]; then
        fail "mos-shadow-reconcile.service orders ${keyw}=${dep} but ${depfile} is not in the image; systemd drops an ordering against a non-existent unit SILENTLY"
    else
        pass "mos-shadow-reconcile.service orders ${keyw}=${dep}, and ${depfile} is present in the image"
    fi
done

# mos-seed-state must hand the reconciler the /mnt/state path: on first boot it
# runs inside the local mount phase, before var-lib-mos.mount exists, so the
# default /var/lib/mos would not yet be the STATE directory.
sq_grep /usr/lib/mos/mos-seed-state \
    '^/usr/lib/mos/mos-shadow-reconcile /mnt/state/mos/shadow$' \
    "mos-seed-state seeds the STATE shadow directly at /mnt/state/mos/shadow (var-lib-mos.mount is not up yet on first boot)"

# The unit being present and enabled is asserted above. That is not the same as
# it DOING anything: what makes the root password transient is that this script
# clears the marker on every boot. Assert the script the unit runs actually
# carries that logic, so a reconciler stripped back to the account-sync path
# would fail here rather than silently make a "transient" password permanent.
REC_SCRIPT="${ROOT}/usr/lib/mos/mos-shadow-reconcile"
rec_marker="$(sed -n 's/^MARKER=.*\/\([a-z-]*\)".*/\1/p' "${REC_SCRIPT}" 2>/dev/null | first_line)"
if [ ! -f "${REC_SCRIPT}" ]; then
    fail "/usr/lib/mos/mos-shadow-reconcile is not in the image, so the transient-password clearing cannot be checked"
elif [ -z "${rec_marker}" ]; then
    fail "mos-shadow-reconcile names no transient-password marker file; nothing would ever clear a transient root password and it would survive every reboot"
elif ! grep -qE '^[[:space:]]*rm -f "\$MARKER"' "${REC_SCRIPT}"; then
    fail "mos-shadow-reconcile names the marker '${rec_marker}' but never removes it, so a transient root password would be re-applied on every boot instead of being cleared"
else
    pass "mos-shadow-reconcile clears the transient-password marker '${rec_marker}' on every boot, which is what makes the password transient"
fi

# The two environment overrides that let os/shadow-reconcile-test.sh drive the
# REAL script against fixtures. They are safe only while nothing in the image
# sets them: a stray drop-in pointing MOS_SHADOW_PASSWD or MOS_SHADOW_FACTORY
# elsewhere would silently reconcile root's credentials against the wrong files,
# and every other check here would still pass. Checked in the shipped unit AND
# in both drop-in directories, since a drop-in overrides the unit invisibly.
REC_OVERRIDES='MOS_SHADOW_PASSWD|MOS_SHADOW_FACTORY'
rec_env_hits=""
for envf in "${ROOT}/etc/systemd/system/mos-shadow-reconcile.service" \
    "${ROOT}/etc/systemd/system/mos-shadow-reconcile.service.d/"*.conf \
    "${ROOT}/usr/lib/systemd/system/mos-shadow-reconcile.service.d/"*.conf; do
    [ -f "${envf}" ] || continue
    if grep -qE "^[[:space:]]*Environment(File)?=.*(${REC_OVERRIDES})" "${envf}"; then
        rec_env_hits="${rec_env_hits} ${envf#"${ROOT}"}"
    fi
done
if [ -z "${rec_env_hits}" ]; then
    pass "no Environment=/EnvironmentFile= in mos-shadow-reconcile.service or its drop-in dirs names MOS_SHADOW_PASSWD or MOS_SHADOW_FACTORY (the test-harness overrides stay inert in the image)"
else
    fail "mos-shadow-reconcile.service is given a MOS_SHADOW_PASSWD/MOS_SHADOW_FACTORY override by:${rec_env_hits}. Those exist so the offline test harness can run the real script; in the image they redirect where root's credentials are reconciled from and to"
fi

# --- the AuthorizedKeysFile drop-in (v2 only) --------------------------------
# v2-only on purpose: v1 ships no sshd_config.d drop-in and no etc-ssh.mount.
# Its root is a writable ext4 with no A/B update, so there is no STATE bind for
# authorised keys to survive across and nothing here that could be asserted.
SSHD_DROPIN=/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf
AK_EXPECT='/etc/ssh/authorized_keys.d/%u'
sq_regular "${SSHD_DROPIN}"
ak_value="$(sed -n 's/^[[:space:]]*AuthorizedKeysFile[[:space:]]\{1,\}\(.*[^[:space:]]\)[[:space:]]*$/\1/p' \
    "${ROOT}${SSHD_DROPIN}" 2>/dev/null | tail -n1)"
if [ "${ak_value}" = "${AK_EXPECT}" ]; then
    pass "${SSHD_DROPIN} sets AuthorizedKeysFile ${AK_EXPECT}, the file mosd renders per user"
else
    fail "${SSHD_DROPIN} sets AuthorizedKeysFile to '${ak_value:-<nothing>}', expected '${AK_EXPECT}'; sshd would read keys from somewhere mosd does not write, so no installed key would ever grant access"
fi

# The path it names has to sit inside the directory etc-ssh.mount binds from
# STATE, or the keys are written into the read-only squashfs view of /etc and
# vanish on the next A/B update. Where=/What= are READ from the unit rather than
# restated, so retargeting the mount cannot leave this passing for a stale path.
ETC_SSH_UNIT="${ROOT}/etc/systemd/system/etc-ssh.mount"
es_where="$(sed -n 's/^Where=//p' "${ETC_SSH_UNIT}" 2>/dev/null | tail -n1)"
es_what="$(sed -n 's/^What=//p' "${ETC_SSH_UNIT}" 2>/dev/null | tail -n1)"
if [ ! -f "${ETC_SSH_UNIT}" ]; then
    fail "etc-ssh.mount is not in the image, so authorised keys have no STATE-backed home and would be lost by every update"
elif [ -z "${es_where}" ] || [ "${ak_value#"${es_where}"/}" = "${ak_value}" ]; then
    fail "the AuthorizedKeysFile path '${ak_value}' is not inside '${es_where:-<no Where=>}', the directory etc-ssh.mount binds; keys written there would land in the read-only image view of /etc and not survive an A/B update"
elif [ "${es_what#/mnt/state/}" = "${es_what}" ]; then
    fail "etc-ssh.mount binds ${es_where} from '${es_what}', which is not under /mnt/state; authorised keys would not be on the STATE partition and would not survive an A/B update"
else
    pass "the AuthorizedKeysFile path ${ak_value} is inside ${es_where}, which etc-ssh.mount binds from ${es_what} on STATE, so installed keys survive an A/B update"
fi

# Exactly one shipped drop-in may emit AuthorizedKeysFile. sshd keeps the FIRST
# value it reads for this keyword and reads sshd_config.d in lexical order, so a
# second file emitting it would make the winner depend on filename ordering.
ak_emitters="$(grep -lE '^[[:space:]]*AuthorizedKeysFile[[:space:]]' \
    "${ROOT}/etc/ssh/sshd_config" "${ROOT}/etc/ssh/sshd_config.d/"*.conf 2>/dev/null |
    sed "s|^${ROOT}||" | sort || true)"
ak_n="$(printf '%s\n' "${ak_emitters}" | grep -c . || true)"
if [ "${ak_n}" = "1" ] && [ "${ak_emitters}" = "${SSHD_DROPIN}" ]; then
    pass "${SSHD_DROPIN} is the ONLY shipped sshd config emitting AuthorizedKeysFile, so which value wins cannot depend on filename ordering"
else
    fail "${ak_n} shipped sshd config files emit AuthorizedKeysFile ($(printf '%s' "${ak_emitters}" | tr '\n' ' ')); sshd keeps the first value it reads in lexical order, so the effective authorised-keys path depends on filenames"
fi

# --- M5 (R5): no baked credential ---
# What this proves: the shadow file that SHIPS carries no usable root password,
# so a signed rootfs — byte-identical on every device in the fleet — cannot
# hand anyone a working login. What it does NOT prove: that the device ends up
# with a good password. That is mosd's job at runtime and is only observable on
# a real boot.
root_entry="$(awk -F: '$1 == "root" { print; exit }' "${FAC}" 2>/dev/null || true)"
root_hash="$(printf '%s' "${root_entry}" | cut -d: -f2)"
if [ -z "${root_entry}" ]; then
    fail "${FACTORY_SHADOW} has no root: entry, so no claim can be made about the baked root password"
else
    case "${root_hash}" in
    "")
        fail "the root: entry in ${FACTORY_SHADOW} has an EMPTY hash field, which means PASSWORDLESS root login: pam_unix accepts any password, including none. Empty is not a locked marker — only '!' (including '!!' and '!'-prefixed forms that retain a hash) and '*' lock an account"
        ;;
    "!"* | "*"*)
        pass "the packed rootfs carries NO usable root password (root: hash field is '${root_hash}', a locked marker)"
        ;;
    *)
        fail "the packed rootfs carries a usable root password hash in ${FACTORY_SHADOW}. A signed rootfs is byte-identical on every device, so this is a fleet-wide shared secret. Something in the build wrote a root credential (v2 has no ROOT_PASSWORD build arg on purpose); root access is provisioned at runtime — mosd's transient password"
        ;;
    esac
fi

# --- EVERY account is locked, not just root (RFCT-024 generalised by RFCT-039)
# RFCT-024 wrote the rule that an EMPTY password field is not a locked marker
# but passwordless login, and scoped it to root because root was the only
# account in the image. RFCT-039 adds `mos` as the second, so the rule is
# widened here to every account the image ships: a check that stayed
# root-shaped would quietly stop covering the case it was written for, and the
# third account would arrive with nothing looking at it at all.
#
# Two failure branches with two messages, because they are two different
# defects. EMPTY means the account accepts any password on this device. A
# USABLE HASH means a credential that every device in the fleet shares, since a
# signed rootfs is byte-identical across all of them. Reporting one as the
# other would send the fix in the wrong direction.
fac_empty=""
fac_hashed=""
fac_checked=0
if [ -f "${FAC}" ] && [ -f "${ROOT}/etc/passwd" ]; then
    while IFS=: read -r u _; do
        [ -n "${u}" ] || continue
        line="$(grep "^${u}:" "${FAC}" | first_line || true)"
        [ -n "${line}" ] || continue
        fac_checked=$((fac_checked + 1))
        h="$(printf '%s' "${line}" | cut -d: -f2)"
        case "${h}" in
        "") fac_empty="${fac_empty} ${u}" ;;
        "!"* | "*"*) ;;
        *) fac_hashed="${fac_hashed} ${u}" ;;
        esac
    done <"${ROOT}/etc/passwd"
fi
if [ "${fac_checked}" -eq 0 ]; then
    fail "no account could be read from ${FACTORY_SHADOW}, so nothing can be claimed about the passwords this image ships"
elif [ -n "${fac_empty}" ]; then
    fail "account(s) in ${FACTORY_SHADOW} with an EMPTY password field:${fac_empty}. An empty field means PASSWORDLESS login — pam_unix accepts any password, including none. Empty is not a locked marker; only '!' (including '!!' and '!'-prefixed forms that retain a hash) and '*' lock an account"
elif [ -n "${fac_hashed}" ]; then
    fail "account(s) in ${FACTORY_SHADOW} carrying a usable password hash:${fac_hashed}. A signed rootfs is byte-identical on every device in the fleet, so any hash baked into one is a shared secret by construction; passwords are provisioned per device at runtime, never in the image"
else
    pass "all ${fac_checked} accounts in ${FACTORY_SHADOW} have a LOCKED password field — none empty, none a usable hash"
fi

# ===========================================================================
# RFCT-039: a persistent /home on DATA, owned by the `mos` account
#
# Venus OS keeps an operator's home across reboots and firmware updates; mos
# now does the same. The decisions this section makes checkable:
#
#   DATA, NOT STATE.  /home accumulates USER DATA of unbounded size — a staged
#     update bundle alone is ~72 MiB against a 64 MiB STATE partition. STATE is
#     small, precious configuration and identity, and filling it would take the
#     settings tree and the sshd host keys down with it. DATA is the only
#     partition carrying x-systemd.growfs and the only one repart extends.
#   PINNED uid/gid 1000.  The home outlives the rootfs that created it, so its
#     owner is part of the on-disk contract, not an allocation detail. If a
#     later image resolved `mos` to a different id, every file already in
#     /home/mos would belong to a uid that no longer exists — and nothing would
#     fail at build time or on the update. Asserted NUMERICALLY here for that
#     reason; asserting the name alone would pass through the whole failure.
#   NOT A PRIVILEGE TIER.  AuthorizedKeysFile is %u over one shared key list,
#     so every authorised key is a root key. `mos` buys a persistent working
#     directory and a non-root default shell, nothing weaker.
# ===========================================================================

MOS_USER=mos
MOS_ID=1000

# The bind, and specifically what BACKS it. The DATA mountpoint is read out of
# the fstab entry for DATA_GUID rather than spelled `/srv` here, so a What=
# under /mnt/state — STATE, the wrong tier — fails on the tier and not on a
# string. Enablement is checked the way the STATE binds are: a unit that is
# present but unenabled leaves /home inside the read-only squashfs forever.
HOME_UNIT="${ROOT}/etc/systemd/system/home.mount"
DATA_MNT="$(awk -v d="PARTUUID=$(lc "${DATA_GUID}")" '$1 == d {print $2; exit}' "${FSTAB}" 2>/dev/null || true)"
hm_what="$(sed -n 's/^What=//p' "${HOME_UNIT}" 2>/dev/null | tail -n1 || true)"
hm_where="$(sed -n 's/^Where=//p' "${HOME_UNIT}" 2>/dev/null | tail -n1 || true)"
if [ ! -f "${HOME_UNIT}" ]; then
    fail "home.mount is not in the image, so /home stays inside the read-only verity squashfs and nothing an operator puts there survives a reboot"
elif [ "${hm_where}" != "/home" ]; then
    fail "home.mount mounts '${hm_where:-<no Where=>}', not /home"
elif [ -z "${DATA_MNT}" ]; then
    fail "no /etc/fstab entry mounts DATA (PARTUUID=$(lc "${DATA_GUID}")), so home.mount's backing tier cannot be established"
elif [ -z "${hm_what}" ] || [ "${hm_what#"${DATA_MNT}"/}" = "${hm_what}" ]; then
    fail "home.mount binds /home from '${hm_what:-<no What=>}', which is not under ${DATA_MNT} (the DATA partition). A home directory is user data of unbounded size — an update bundle alone is ~72 MiB — and STATE is 64 MiB of precious identity: filling it would take the settings tree and the sshd host keys with it. DATA is also the only partition repart grows"
elif [ -z "$(find "${ROOT}/etc/systemd/system" -name home.mount -path '*.wants/*' 2>/dev/null || true)" ]; then
    fail "home.mount exists but is not enabled (no symlink in a .wants directory); /home would never be bound and every file written there would live in the read-only squashfs view"
else
    pass "home.mount binds /home from ${hm_what} on DATA (fstab mounts DATA at ${DATA_MNT}) and is enabled"
fi

# The bind SOURCE, which mount(8) does not create. mos-seed-home makes it, and
# it must run before the mount rather than after: a seed ordered after the bind
# could not have made that bind succeed in the first place, so it would never
# run at all. It writes only under DATA, which is why the usual "a seed on a
# verity root must run after the bind" hazard does not apply to it.
SEED_HOME_UNIT="${ROOT}/etc/systemd/system/mos-seed-home.service"
sq_regular /usr/lib/mos/mos-seed-home
if [ ! -f "${SEED_HOME_UNIT}" ]; then
    fail "mos-seed-home.service is not in the image; nothing creates ${hm_what:-the home.mount source} on DATA and the bind fails, because mount(8) never creates the SOURCE of a bind"
elif ! sed -n 's/^Before=//p' "${SEED_HOME_UNIT}" | tr ' ' '\n' | grep -Fx home.mount >/dev/null; then
    fail "mos-seed-home.service has no Before= naming home.mount; the bind source would not be guaranteed to exist when the mount is attempted, and the mount fails"
elif [ -z "$(find "${ROOT}/etc/systemd/system" -name mos-seed-home.service -path '*.wants/*' 2>/dev/null || true)" ]; then
    fail "mos-seed-home.service exists but is not enabled, so the home.mount source is never created and the bind fails on every boot"
else
    pass "mos-seed-home.service is enabled and ordered Before=home.mount, so the bind source exists on DATA before the mount is attempted"
fi
# It must write to the DATA path and never to /home: /home in the unbound view
# is inside the read-only verity squashfs, so a seed touching it would fail.
SEED_HOME="${ROOT}/usr/lib/mos/mos-seed-home"
seed_uid="$(sed -n 's/^MOS_UID=//p' "${SEED_HOME}" 2>/dev/null | tail -n1 || true)"
seed_gid="$(sed -n 's/^MOS_GID=//p' "${SEED_HOME}" 2>/dev/null | tail -n1 || true)"
if [ ! -f "${SEED_HOME}" ]; then
    fail "/usr/lib/mos/mos-seed-home is not in the image, so what it creates cannot be checked"
elif [ "${seed_uid}" != "${MOS_ID}" ] || [ "${seed_gid}" != "${MOS_ID}" ]; then
    fail "mos-seed-home pins uid '${seed_uid:-<none>}' gid '${seed_gid:-<none>}', not ${MOS_ID}:${MOS_ID}. The seed and /etc/passwd must agree by NUMBER: the home on DATA outlives this rootfs, so a mismatch leaves the directory owned by an id the image does not define"
elif ! grep -Eq '^[[:space:]]*mkdir /srv/home/mos$' "${SEED_HOME}"; then
    fail "mos-seed-home does not create /srv/home/mos. It must create the home under the DATA path, never under /home: /home in the unbound view is inside the read-only verity squashfs, and a seed writing there fails"
elif ! grep -Eq '^[[:space:]]*chmod 0700 /srv/home/mos$' "${SEED_HOME}"; then
    fail "mos-seed-home does not chmod 0700 /srv/home/mos; a home directory readable by every local uid is not a private home"
elif ! grep -Eq '^[[:space:]]*chown "\$\{MOS_UID\}:\$\{MOS_GID\}" /srv/home/mos$' "${SEED_HOME}"; then
    fail "mos-seed-home does not chown /srv/home/mos to its pinned MOS_UID:MOS_GID pair; resolving the name at runtime would make the owner whatever the running image says today"
else
    pass "mos-seed-home creates /srv/home/mos on DATA, mode 0700, owned by the pinned pair ${seed_uid}:${seed_gid} — the same numbers /etc/passwd gives ${MOS_USER}"
fi

# The account, asserted by NUMBER. `mos` resolving to some other uid is the
# failure that costs a device its whole home directory, and it is invisible:
# the account is there, the shell is right, and every file already on DATA
# belongs to nobody.
mos_pw="$(awk -F: -v u="${MOS_USER}" '$1 == u { print; exit }' "${ROOT}/etc/passwd" 2>/dev/null || true)"
mos_uid="$(printf '%s' "${mos_pw}" | cut -d: -f3)"
mos_gid="$(printf '%s' "${mos_pw}" | cut -d: -f4)"
mos_home="$(printf '%s' "${mos_pw}" | cut -d: -f6)"
mos_shell="$(printf '%s' "${mos_pw}" | cut -d: -f7)"
mos_grp_gid="$(awk -F: -v g="${MOS_USER}" '$1 == g { print $3; exit }' "${ROOT}/etc/group" 2>/dev/null || true)"
if [ -z "${mos_pw}" ]; then
    fail "no '${MOS_USER}' account in the packed /etc/passwd; the persistent home would have no owner"
elif [ "${mos_uid}" != "${MOS_ID}" ] || [ "${mos_gid}" != "${MOS_ID}" ]; then
    fail "'${MOS_USER}' is uid ${mos_uid}, gid ${mos_gid} in the packed /etc/passwd, expected ${MOS_ID}:${MOS_ID}. The home directory sits on DATA and outlives this rootfs, so its owner is part of the ON-DISK CONTRACT: an image that resolves ${MOS_USER} to a different id leaves every file already in ${mos_home:-the home} owned by a uid that no longer exists, and nothing reports an error"
elif [ "${mos_grp_gid}" != "${MOS_ID}" ]; then
    fail "the '${MOS_USER}' group is gid '${mos_grp_gid:-absent}' in the packed /etc/group, expected ${MOS_ID}; the primary group of the home's owner is part of the same on-disk contract as the uid"
elif [ "${mos_shell}" != "/bin/bash" ] || [ ! -f "${ROOT}/bin/bash" ]; then
    fail "'${MOS_USER}' has shell '${mos_shell}' and /bin/bash is $([ -f "${ROOT}/bin/bash" ] && echo present || echo ABSENT) in the packed root; the login shell must be /bin/bash and that binary must actually ship, or every login dies at exec"
elif [ "${mos_home}" != "/home/${MOS_USER}" ]; then
    fail "'${MOS_USER}' has home '${mos_home}', expected /home/${MOS_USER}"
else
    pass "'${MOS_USER}' is uid ${MOS_ID}, gid ${MOS_ID} (group ${MOS_USER} = gid ${mos_grp_gid}), shell ${mos_shell} (present in the image), home ${mos_home}"
fi

# NO SUDO AND NO SUPPLEMENTARY GROUPS is a deliberate phase-1 deferral, not an
# oversight: there is no privilege policy to express yet, the web UI is the
# admin surface, and a guessed policy would outlive the release that guessed
# it. A deferral nothing asserts is one `usermod -aG` away from being undone
# silently, so it is asserted. sudo not being installed is checked too — a
# group grant needs a binary to mean anything, and vice versa.
mos_extra_groups="$(awk -F: -v u="${MOS_USER}" '$1 != u && $4 ~ "(^|,)" u "(,|$)" { print $1 }' \
    "${ROOT}/etc/group" 2>/dev/null | tr '\n' ' ' | sed 's/ $//' || true)"
if [ -n "${mos_extra_groups}" ]; then
    fail "'${MOS_USER}' is a member of supplementary group(s): ${mos_extra_groups}. Phase 1 grants none — not adm, not shadow, nothing reaching the settings tree — and this is a recorded deferral (docs/task/RFCT-039.md), so a grant appearing here is an undocumented privilege decision"
elif [ -f "${ROOT}/usr/bin/sudo" ] || [ -f "${ROOT}/bin/sudo" ]; then
    fail "sudo ships in the image; phase 1 deliberately gives '${MOS_USER}' no privilege-escalation path and the package is not in the allowlist"
else
    pass "'${MOS_USER}' has no supplementary groups and no sudo ships in the image (a deliberate phase-1 deferral, recorded in docs/task/RFCT-039.md)"
fi

# The account's home must be INSIDE what home.mount binds. An account pointed
# at a directory the bind does not cover would look completely healthy and
# would lose everything on the next update — which is the entire problem this
# task exists to solve.
if [ -z "${mos_home}" ] || [ -z "${hm_where}" ]; then
    fail "cannot compare '${MOS_USER}' home '${mos_home:-<none>}' against home.mount Where='${hm_where:-<none>}'; one of them is missing"
elif [ "${mos_home}" = "${hm_where}" ] || [ "${mos_home#"${hm_where}"/}" != "${mos_home}" ]; then
    pass "'${MOS_USER}' home ${mos_home} is inside ${hm_where}, the directory home.mount binds from ${hm_what} on DATA, so it persists across reboots and A/B updates"
else
    fail "'${MOS_USER}' home is '${mos_home}', which is NOT inside '${hm_where}' — the only path home.mount makes persistent. Everything written there would sit in the read-only squashfs view and be gone on the next A/B update"
fi

# ===========================================================================
# RFCT-054: a persistent /root on DATA
#
# The same problem RFCT-039 fixed for /home, applied to the OTHER home
# directory on the device. On the read-only verity root an operator cannot keep
# anything in /root: whatever they put there is lost on reboot and replaced
# wholesale by the next A/B update. /srv/root is bind-mounted onto /root, on
# DATA and not STATE for the same reason /home is — a root home accumulates
# shell history, scratch scripts and downloaded bundles, which is USER DATA of
# unbounded size, while STATE is 64 MiB of small precious identity.
#
# TWO THINGS A READER WILL OTHERWISE GET WRONG, both about SSH keys:
#
#   KEY LOGIN DOES NOT DEPEND ON THIS BIND. Keys render to
#     /etc/ssh/authorized_keys.d/%u, not /root/.ssh/authorized_keys — RFCT-034
#     chose that path precisely because /root was ephemeral. So a /root that
#     fails to mount does not lock anyone out, and nothing below should be read
#     as guarding login. The two are not coupled.
#   A KEY IN /root/.ssh/authorized_keys NOW SURVIVES A REBOOT AND STILL GRANTS
#     NOTHING. AuthorizedKeysFile REPLACES the default locations rather than
#     adding to them, so that file is inert — but it now PERSISTS, so anyone
#     auditing the device will find a plausible-looking authorized_keys that
#     does nothing. It is exactly the kind of file someone later "fixes" into a
#     real grant.
# ===========================================================================

# The bind, and specifically what BACKS it. As with home.mount, the DATA
# mountpoint is read out of the fstab entry for DATA_GUID rather than spelled
# `/srv` here, so a What= under /mnt/state — STATE, the wrong tier — fails on
# the TIER and not on a string. Enablement is asserted separately: a unit that
# is present but unenabled leaves /root inside the read-only squashfs forever,
# and every check that only looks for the file would still pass.
ROOT_UNIT="${ROOT}/etc/systemd/system/root.mount"
rm_what="$(sed -n 's/^What=//p' "${ROOT_UNIT}" 2>/dev/null | tail -n1 || true)"
rm_where="$(sed -n 's/^Where=//p' "${ROOT_UNIT}" 2>/dev/null | tail -n1 || true)"
if [ ! -f "${ROOT_UNIT}" ]; then
    fail "root.mount is not in the image, so /root stays inside the read-only verity squashfs and nothing an operator leaves there — shell history, a scratch script, a staged bundle — survives a reboot"
elif [ "${rm_where}" != "/root" ]; then
    fail "root.mount mounts '${rm_where:-<no Where=>}', not /root"
elif [ -z "${DATA_MNT}" ]; then
    fail "no /etc/fstab entry mounts DATA (PARTUUID=$(lc "${DATA_GUID}")), so root.mount's backing tier cannot be established"
elif [ -z "${rm_what}" ] || [ "${rm_what#"${DATA_MNT}"/}" = "${rm_what}" ]; then
    fail "root.mount binds /root from '${rm_what:-<no What=>}', which is not under ${DATA_MNT} (the DATA partition). A root home is user data of unbounded size — shell history, scratch scripts, a staged update bundle at ~72 MiB — and STATE is 64 MiB of precious identity: filling it would take the settings tree and the sshd host keys with it. DATA is also the only partition repart grows"
elif [ -z "$(find "${ROOT}/etc/systemd/system" -name root.mount -path '*.wants/*' 2>/dev/null || true)" ]; then
    fail "root.mount exists but is not enabled (no symlink in a .wants directory); /root would never be bound and everything written there would live in the read-only squashfs view"
else
    pass "root.mount binds /root from ${rm_what} on DATA (fstab mounts DATA at ${DATA_MNT}) and is enabled"
fi

# The MOUNTPOINT's own mode, in the packed root. /root is checked for existence
# with the rest of the mountpoint set above; this asserts what that check
# cannot — that it is 0700 root:root. Debian already ships it that way, but
# nothing guaranteed it stayed that way through the pack stage, and DATA is not
# verity-protected, so the mode is not implied by anything. A group- or
# world-readable root home is a DIFFERENT failure from the one this fixes.
root_mp_mode="$(stat -c %a "${ROOT}/root" 2>/dev/null || echo none)"
root_mp_own="$(stat -c '%u:%g' "${ROOT}/root" 2>/dev/null || echo none)"
if [ "${root_mp_mode}" = "700" ] && [ "${root_mp_own}" = "0:0" ]; then
    pass "/root in the packed root is mode 0${root_mp_mode} owned ${root_mp_own} (root:root), the mode a root home must have"
else
    fail "/root in the packed root is mode ${root_mp_mode} owned ${root_mp_own}, expected 700 and 0:0. A root home readable by any other uid is a different defect from the one root.mount fixes, and nothing else in the image asserts it"
fi

# The bind SOURCE, which mount(8) does not create. mos-seed-root makes it, and
# it must run BEFORE the mount rather than after: a seed ordered after the bind
# could not have made that bind succeed in the first place, so it would never
# run at all. tmpfiles.d cannot substitute either — systemd-tmpfiles-setup is
# After=local-fs.target while root.mount is WantedBy=local-fs.target, so a
# tmpfiles rule runs strictly after the bind. The ordering is declared from
# both ends (Before= here, Requires=/After= in root.mount); this asserts the
# Before=, which is the half systemd needs to sequence the mount job.
SEED_ROOT_UNIT="${ROOT}/etc/systemd/system/mos-seed-root.service"
SEED_ROOT="${ROOT}/usr/lib/mos/mos-seed-root"
seed_root_mode="$(stat -c %a "${SEED_ROOT}" 2>/dev/null || echo none)"
if [ ! -f "${SEED_ROOT_UNIT}" ]; then
    fail "mos-seed-root.service is not in the image; nothing creates ${rm_what:-the root.mount source} on DATA and the bind fails, because mount(8) never creates the SOURCE of a bind"
elif ! sed -n 's/^Before=//p' "${SEED_ROOT_UNIT}" | tr ' ' '\n' | grep -Fx root.mount >/dev/null; then
    fail "mos-seed-root.service has no Before= naming root.mount; the bind source would not be guaranteed to exist when the mount is attempted, and the mount fails"
elif [ -z "$(find "${ROOT}/etc/systemd/system" -name mos-seed-root.service -path '*.wants/*' 2>/dev/null || true)" ]; then
    fail "mos-seed-root.service exists but is not enabled, so the root.mount source is never created and the bind fails on every boot"
elif [ ! -f "${SEED_ROOT}" ] || [ -L "${SEED_ROOT}" ]; then
    fail "/usr/lib/mos/mos-seed-root is missing or not a regular file, so mos-seed-root.service cannot start and the bind source is never created"
elif [ ! -x "${SEED_ROOT}" ]; then
    fail "/usr/lib/mos/mos-seed-root is mode ${seed_root_mode}, not executable; ExecStart= would fail with 203/EXEC, the bind source would never be created and root.mount would fail on every boot"
else
    pass "mos-seed-root.service is enabled and ordered Before=root.mount, and /usr/lib/mos/mos-seed-root is executable (mode 0${seed_root_mode}), so the bind source exists on DATA before the mount is attempted"
fi

# WHAT THE SEED WRITES. It must create /srv/root — the DATA path — and must
# never write under /root: /root in the unbound view is inside the read-only
# verity squashfs, and this runs before the bind, so a write there fails. It
# must chmod 0700 and chown 0:0 NUMERICALLY (the directory outlives every
# rootfs flashed onto the device, so its owner is part of the on-disk
# contract), and it must not overwrite the dotfiles on a directory that already
# exists — an operator who edits .bashrc has to keep that edit across the next
# reboot, which is the whole point of the feature.
#
# This is a STATIC check: it reads the script, it does not run it. There is no
# offline harness for either seed script (see the follow-up in
# docs/task/RFCT-054.md), so idempotence and non-clobbering are asserted by
# reading eleven lines of shell, not by exercising them.
SEED_WRITE_CMDS='mkdir|touch|cp|mv|ln|rm|chmod|chown|install|tee|dd'
seed_root_writes_root="$(grep -nE "^[[:space:]]*(${SEED_WRITE_CMDS})[[:space:]]+([^#]*[[:space:]]+)?\"?/root(/|\"|[[:space:]]|$)" \
    "${SEED_ROOT}" 2>/dev/null | first_line || true)"
if [ ! -f "${SEED_ROOT}" ]; then
    fail "/usr/lib/mos/mos-seed-root is not in the image, so what it creates cannot be checked"
elif ! grep -Eq '^[[:space:]]*mkdir /srv/root$' "${SEED_ROOT}"; then
    fail "mos-seed-root does not create /srv/root. It must create the bind source under the DATA path, never under /root: /root in the unbound view is inside the read-only verity squashfs, and a seed writing there before the bind fails"
elif ! grep -Eq '^[[:space:]]*chmod 0700 /srv/root$' "${SEED_ROOT}"; then
    fail "mos-seed-root does not chmod 0700 /srv/root; DATA is not verity-protected, so a root home group- or world-readable on disk is not caught by anything else"
elif ! grep -Eq '^[[:space:]]*chown 0:0 /srv/root$' "${SEED_ROOT}"; then
    fail "mos-seed-root does not chown 0:0 /srv/root numerically; the directory outlives every rootfs flashed onto this device, so its owner is part of the on-disk contract and must not be resolved out of the running image's /etc/passwd"
elif [ -n "${seed_root_writes_root}" ]; then
    fail "mos-seed-root writes under /root: ${seed_root_writes_root}. It runs BEFORE root.mount, so /root there is still the read-only verity squashfs and the write fails; everything it creates belongs under ${DATA_MNT:-/srv}"
else
    pass "mos-seed-root creates /srv/root on DATA (never under /root, which is read-only before the bind), mode 0700 owned 0:0 — a static read of the script, not a run of it"
fi

# --- every external binary the /usr/lib/mos boot scripts invoke --------------
# These scripts run at boot, as root, outside any package's dependency graph, so
# nothing in the image declares what they need. The dependency is real: the
# newline-safety fix in mos-shadow-reconcile made it call `od`, and neither
# Dockerfile installs coreutils explicitly — it arrives with the base image and
# would disappear without a word if the base were ever slimmed. A missing binary
# here is a boot-time failure in the code that reconciles root's credentials.
#
# The extractor is deliberately conservative: it takes command names at COMMAND
# POSITION only. Commands the scripts invoke through their own `run`/`have`
# wrappers (busctl, rauc, systemctl, curl, wget) are NOT in this set, and must
# not be — mos-health uses `have X ||` precisely to mark curl and wget optional,
# and asserting those exist would be asserting the wrong thing.
SH_BUILTINS=" : . [ alias bg break cd continue echo eval exec exit export false fg getopts hash jobs local printf pwd read readonly return set shift test times trap true type ulimit umask unalias unset wait command source "
SH_KEYWORDS=" if then else elif fi for while until do done case esac in function ! "

# Command names at command position in one shell script.
mos_script_commands() {
    local f="$1" funcs
    funcs=" $(sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*()[[:space:]]*{.*/\1/p' "${f}" | tr '\n' ' ') "
    # Join line continuations, drop backslash escapes (so an escaped backtick in
    # a message is not mistaken for a command substitution), strip comments,
    # remove `case` patterns, split on command substitution and on ; | &, strip
    # quoted spans, then take the first word of what is left.
    sed -e :a -e '/\\$/N; s/\\\n/ /; ta' "${f}" |
        sed -e 's/\\.//g' |
        sed -E -e 's/(^|[[:space:]])#.*$/\1/' |
        awk '
            /(^|[[:space:]])case[[:space:]].*[[:space:]]in[[:space:]]*$/ { d++; print; next }
            /(^|[[:space:]])esac([[:space:]]|$)/ { if (d > 0) d--; print; next }
            d > 0 { sub(/^[[:space:]]*[^()]*\)/, "") } { print }' |
        sed -e 's/\$(/\n/g' -e 's/`/\n/g' |
        sed -e "s/'[^']*'//g" -e 's/"[^"]*"//g' |
        sed -e 's/[;|&]/\n/g' -e 's/^[[:space:]]*//' |
        sed -E ':a; s/^(if|then|else|elif|do|while|until|!|\{)[[:space:]]+//; ta' |
        awk '{ print $1 }' |
        while read -r w; do
            [ -n "${w}" ] || continue
            case " ${SH_BUILTINS} ${SH_KEYWORDS} ${funcs} " in *" ${w} "*) continue ;; esac
            case "${w}" in
            *=* | \$* | -* | [0-9]* | \** | \[*) continue ;;
            *[!A-Za-z0-9_./+-]*) continue ;;
            /* | [A-Za-z_]*) echo "${w}" ;;
            esac
        done
}

# Does this command name resolve to a real file inside the packed root? Symlinks
# are chased WITHIN the image (an absolute target resolves against ROOT, not the
# host), so a dangling /etc/alternatives entry fails rather than passes.
sq_resolves_cmd() {
    local c="$1" p="" d t hops=0
    case "${c}" in
    /*) p="${ROOT}${c}" ;;
    *)
        for d in /usr/bin /bin /usr/sbin /sbin; do
            if [ -e "${ROOT}${d}/${c}" ] || [ -L "${ROOT}${d}/${c}" ]; then
                p="${ROOT}${d}/${c}"
                break
            fi
        done
        ;;
    esac
    [ -n "${p}" ] || return 1
    while [ -L "${p}" ] && [ "${hops}" -lt 8 ]; do
        t="$(readlink "${p}")"
        case "${t}" in
        /*) p="${ROOT}${t}" ;;
        *) p="$(dirname "${p}")/${t}" ;;
        esac
        hops=$((hops + 1))
    done
    [ -f "${p}" ]
}

mos_cmds="$(for f in "${ROOT}"/usr/lib/mos/*; do
    [ -f "${f}" ] || continue
    case "$(head -c 2 "${f}" 2>/dev/null)" in '#!') ;; *) continue ;; esac
    mos_script_commands "${f}"
done | sort -u)"
mos_cmd_n="$(printf '%s\n' "${mos_cmds}" | grep -c . || true)"
mos_cmd_missing=""
for c in ${mos_cmds}; do
    sq_resolves_cmd "${c}" || mos_cmd_missing="${mos_cmd_missing} ${c}"
done
# A vacuity guard: if the extractor stops seeing commands, an empty set would
# make the check below pass while proving nothing at all.
if [ "${mos_cmd_n}" -lt 10 ]; then
    fail "only ${mos_cmd_n} command names were extracted from the /usr/lib/mos boot scripts; the extractor is not reading them, so the binary-presence check would pass vacuously"
elif [ -z "${mos_cmd_missing}" ]; then
    pass "all ${mos_cmd_n} external commands invoked at command position by the /usr/lib/mos boot scripts resolve in the packed rootfs ($(printf '%s' "${mos_cmds}" | tr '\n' ' '))"
else
    fail "the /usr/lib/mos boot scripts invoke commands that are NOT in the packed rootfs:${mos_cmd_missing}. These scripts run at boot as root with no package dependency declaring them; a missing one fails at runtime, in the code that reconciles root's credentials"
fi

# --- M4: /var fill-up containment ---
sq_grep /etc/tmpfiles.d/mos-var.conf '^[qQ] /var/tmp ' "tmpfiles.d ages /var/tmp (fixed-size /var cannot grow)"
sq_grep /etc/tmpfiles.d/mos-var.conf '^e /var/cache ' "tmpfiles.d ages /var/cache (regenerable by definition, nothing else reclaims it)"

# --- M4: squashfs xattr / file capabilities ---
# CONFIG_SQUASHFS_XATTR was enabled on the kernel side so a squashfs root does
# not silently drop file capabilities. What can be proven from the PACKED IMAGE
# is that the capability set survived packing intact, so first establish that
# this environment can observe a capability at all — otherwise an empty result
# is indistinguishable from a container that silently drops security.* xattrs,
# and the check would pass for the wrong reason.
: >"${TMP}/cap-probe"
if setcap cap_net_raw+ep "${TMP}/cap-probe" 2>/dev/null &&
    getcap "${TMP}/cap-probe" 2>/dev/null | grep cap_net_raw >/dev/null; then
    cap_observable=1
    pass "the verification environment can set and read security.capability, so a capability inventory taken here is trustworthy"
else
    cap_observable=0
    fail "the verification environment cannot round-trip a security.capability xattr, so no claim about capability preservation can be made here"
fi

# The source tree's inventory, captured by the Dockerfile before packing.
ROOTFS_REPORT="${REPO_ROOT}/_out/${MOS_BOARD}/rootfs-report-v2.txt"
if [ "${cap_observable}" -eq 0 ]; then
    fail "file-capability preservation not evaluated (the environment cannot observe capabilities)"
elif [ ! -f "${ROOTFS_REPORT}" ]; then
    fail "capability inventory not found: ${ROOTFS_REPORT} (produce it with os/rootfs/build-v2.sh)"
else
    # An empty capability set is a legitimate result, and both of these
    # pipelines exit non-zero when they match nothing, so neither may be
    # allowed to trip `set -o pipefail`.
    { sed -n '/^== file capabilities ==$/,/^== /p' "${ROOTFS_REPORT}" |
        grep -vE '^(==|$)' | sed 's/[[:space:]]*$//' | sort || true; } >"${TMP}/caps-src.txt"
    { getcap -r "${ROOT}" 2>/dev/null | sed "s|^${ROOT}||" | sed 's/[[:space:]]*$//' | sort || true; } >"${TMP}/caps-pkg.txt"
    src_n="$(grep -c . "${TMP}/caps-src.txt" || true)"
    if diff -q "${TMP}/caps-src.txt" "${TMP}/caps-pkg.txt" >/dev/null 2>&1; then
        if [ "${src_n}" = "0" ]; then
            # Reported honestly rather than dressed up as a preservation proof:
            # this rootfs's package set installs no file capabilities at all,
            # so there is nothing whose survival could be demonstrated. The
            # check is a tripwire for the day a cap-carrying package lands.
            pass "packed file-capability set matches the source inventory (both EMPTY: this rootfs carries no file capabilities, so xattr survival is NOT demonstrated by this image — see docs/task/RFCT-017.md)"
        else
            pass "all ${src_n} file capabilities survived packing into the squashfs (security.capability xattrs preserved)"
        fi
    else
        fail "file capabilities changed during packing; the squashfs must preserve security.capability: $(diff "${TMP}/caps-src.txt" "${TMP}/caps-pkg.txt" | tr '\n' ' ')"
    fi
fi

# ===========================================================================
# M5: connd userland, image profile, and the crypt(3) format
# ===========================================================================
# The contract read, and the namespace check that depends on it, are defined
# up with the fixture-hook set so os/ui-location-test.sh can drive them; they
# are CALLED here so the non-fixture path runs them in exactly this position.
# The rationale, including the empty-marker rot that made this a function, is
# on read_connd_contract.
read_connd_contract

# --- the daemons and their unit templates ---
sq_regular /usr/sbin/hostapd
sq_regular /usr/sbin/wpa_supplicant
sq_regular "/usr/lib/systemd/system/${STA_UNIT}"
sq_regular "/usr/lib/systemd/system/${AP_UNIT}"

# The unit's ExecStart and the reconciler's render path are ONE contract: the
# template bakes the config file name into its command line, so a rename on
# either side leaves a daemon starting against a file nothing writes. Both
# systemd instance specifiers are accepted (%i escaped, %I unescaped); for a
# plain interface name they are the same string, and which one the packager
# chose is not this repo's business.
# Args: description unit-path config-dir config-name-with-{interface}
check_execstart() {
    local what="$1" unit="$2" dir="$3" name="$4" spec want found=0
    if [ ! -f "${ROOT}${unit}" ]; then
        fail "${what}: ${unit} is not in the image, so mosd would drive a unit that does not exist"
        return
    fi
    for spec in '%i' '%I'; do
        want="${dir}/$(printf '%s' "${name}" | sed "s|{interface}|${spec}|")"
        if grep -F -- "ExecStart=" "${ROOT}${unit}" | grep -F -- "${want}" >/dev/null; then
            found=1
            pass "${what}: $(basename "${unit}") reads ${want}, which is exactly what the reconciler renders"
            break
        fi
    done
    if [ "${found}" -eq 0 ]; then
        fail "${what}: $(basename "${unit}")'s ExecStart does not name ${dir}/${name} (with %i or %I); it is '$(grep -F 'ExecStart=' "${ROOT}${unit}" | tr '\n' ' ')'. The unit and the reconciler disagree about the config path, so the daemon starts against a file nothing writes"
    fi
}
check_execstart "station" "/usr/lib/systemd/system/${STA_UNIT}" "${STA_DIR}" "${STA_CONF}"
check_execstart "access point" "/usr/lib/systemd/system/${AP_UNIT}" "${AP_DIR}" "${AP_CONF}"

# mosd owns these lifecycles: it enables and starts exactly the instance the
# settings tree asks for. A statically enabled template instance would race it.
for u in "${STA_UNIT}" "${AP_UNIT}"; do
    if [ -n "$(find "${ROOT}/etc/systemd/system" "${ROOT}/usr/lib/systemd/system" \
        -name "${u}" -path '*.wants/*' 2>/dev/null || true)" ]; then
        fail "${u} is statically enabled in the image; mosd owns that lifecycle and would race the image's own instance"
    else
        pass "${u} is installed but NOT statically enabled (mosd owns the lifecycle)"
    fi
done

# Both packages ship a non-templated unit their postinst ENABLES. Masked, not
# merely disabled: masking is the only form that also blocks the D-Bus
# activation path wpasupplicant ships
# (/usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service). On v2 the
# mask lives inside the signed read-only root, so it cannot be undone on device.
for u in hostapd.service wpa_supplicant.service dbus-fi.w1.wpa_supplicant1.service; do
    dest="$(readlink "${ROOT}/etc/systemd/system/${u}" 2>/dev/null || true)"
    if [ "${dest}" = "/dev/null" ]; then
        pass "${u} is masked (-> /dev/null); it cannot start and fight mosd for the radio"
    else
        fail "${u} is not masked (it is '${dest:-not a symlink to /dev/null}'). The package enables it, and it starts a second daemon on the same radio against a config mosd never writes while mosd's own instance still reports healthy"
    fi
    if [ -n "$(find "${ROOT}/etc/systemd/system" "${ROOT}/usr/lib/systemd/system" \
        -name "${u}" -path '*.wants/*' 2>/dev/null || true)" ]; then
        fail "${u} still carries the package's *.wants enablement symlink"
    else
        pass "${u} carries no enablement symlink from the package postinst"
    fi
done

# --- the config directories must be WRITABLE at runtime, backed by STATE -----
# The v2 root is a read-only dm-verity squashfs. A reconciler rendering into a
# read-only path fails on device and nowhere else, so the BACKING is asserted,
# not just that the directory exists: the bind must name the directory, its
# source must be on STATE, and the unit must actually be ENABLED — M4 shipped
# units that were installed and never enabled.
for where in "${STA_DIR}" "${AP_DIR}"; do
    [ -n "${where}" ] || continue
    unit="$(echo "${where#/}" | tr / -).mount"
    f="${ROOT}/etc/systemd/system/${unit}"
    if [ ! -f "${f}" ]; then
        fail "${where} is a reconciler render target but ${unit} does not exist; on the read-only verity root the render would fail on device and nowhere else"
    elif ! grep -qx "Where=${where}" "${f}"; then
        fail "${unit} does not mount ${where} (its Where= is '$(sed -n 's/^Where=//p' "${f}" | tail -n1)')"
    elif ! grep -qE '^What=/mnt/state/' "${f}"; then
        fail "${unit} is not backed by STATE (What= must be under /mnt/state); a tmpfs or nothing at all would lose every configured network on reboot"
    elif [ -z "$(find "${ROOT}/etc/systemd/system" -name "${unit}" -path '*.wants/*' 2>/dev/null || true)" ]; then
        fail "${unit} exists but is not enabled; ${where} would stay on the read-only squashfs"
    else
        pass "${where} is a STATE-backed bind via ${unit} ($(sed -n 's/^What=//p' "${f}" | tail -n1)), so the reconciler can write there and the result survives an A/B update"
    fi
    # The bind source has to be created before the mount is attempted, and with
    # a mode that does not expose the pre-shared keys the directory ends up
    # holding. mos-seed-state is the only thing that runs early enough.
    src="$(sed -n 's/^What=//p' "${f}" 2>/dev/null | tail -n1)"
    base="$(basename "${src:-none}")"
    seed="${ROOT}/usr/lib/mos/mos-seed-state"
    # The seed script creates both directories from one loop, so the assertion
    # is in two halves: the loop does mkdir + chmod 0700 under /mnt/state, and
    # THIS directory's name is one of the loop's items. Either half alone would
    # pass for a script that creates the other directory twice.
    if [ -n "${src}" ] && [ -f "${seed}" ] &&
        grep -q 'mkdir -p "/mnt/state/\$d"' "${seed}" &&
        grep -q 'chmod 0700 "/mnt/state/\$d"' "${seed}" &&
        sed -n 's/^for d in \(.*\); do$/\1/p' "${seed}" | tr ' ' '\n' | grep -Fx "${base}" >/dev/null; then
        pass "mos-seed-state creates ${src} at 0700 before ${unit} is attempted"
    else
        fail "mos-seed-state does not create ${src} (0700); the bind would have no source on first boot and ${where} would stay read-only"
    fi
done

# The AP's DHCP server is systemd-networkd's own DHCPServer=yes. dnsmasq would
# be a second package and a second lifecycle for a job already done.
if [ -e "${ROOT}/usr/sbin/dnsmasq" ]; then
    fail "dnsmasq ships in the image; the provisioning AP hands out addresses through systemd-networkd's DHCPServer=yes and a second DHCP server on the same link is a conflict, not a fallback"
else
    pass "no dnsmasq in the image (the AP's DHCP server is systemd-networkd's own DHCPServer=yes)"
fi

# --- the image's networkd namespace must not collide with mosd's ---
# Hoisted into the fixture-hook set with read_connd_contract, for the reason
# recorded there: with an empty sweep marker this check's own glob matched
# every filename in the image and reported eight collisions that could not
# happen. It is anchored now, and refuses to run at all on an unread contract.
check_networkd_namespace

# networkd applies the FIRST matching unit in lexical order across its
# directories, so the image's fallback has to sort BEFORE the reconcilers'
# units. Compared as strings, not assumed from the numbers.
# Each prefix is compared with the image's file INDEPENDENTLY: the two
# reconciler prefixes have no ordering requirement between themselves (they
# never match the same interface), so requiring the three to be sorted as one
# list would be a check about the wrong property.
dhcp_default="80-dhcp.network"
sort_bad=""
for prefix in "${STA_PREFIX}" "${AP_PREFIX}"; do
    if [ -z "${prefix}" ]; then
        sort_bad="${sort_bad} <unreadable>"
    elif [ "$(printf '%s\n' "${dhcp_default}" "${prefix}" | LC_ALL=C sort | first_line)" != "${dhcp_default}" ]; then
        sort_bad="${sort_bad} ${prefix}"
    fi
done
if [ -z "${sort_bad}" ]; then
    pass "${dhcp_default} sorts before both '${STA_PREFIX}' and '${AP_PREFIX}', so a reconciler-rendered unit is never shadowed by the image's fallback"
else
    fail "${dhcp_default} does not sort before:${sort_bad}; networkd applies the first match in lexical order, so the image's fallback would win over the unit mosd rendered for that interface"
fi

# --- the image profile, and the SSH default it selects ---
PROFILE_FILE="/usr/lib/mos/profile.conf"
PROVISIONING_SRC="${REPO_ROOT}/mosd/mosd/src/provisioning.rs"
PROFILE_KEY="$(sed -n 's/^const PROFILE_KEY: \&str = "\(.*\)";$/\1/p' "${PROVISIONING_SRC}" 2>/dev/null | first_line)"
PROFILE_DEFAULT_PATH="$(sed -n 's/^pub const DEFAULT_PROFILE_PATH: \&str = "\(.*\)";$/\1/p' "${PROVISIONING_SRC}" 2>/dev/null | first_line)"
if [ "${PROFILE_DEFAULT_PATH}" = "${PROFILE_FILE}" ] && [ -n "${PROFILE_KEY}" ]; then
    pass "mosd reads the image profile from ${PROFILE_DEFAULT_PATH} with key ${PROFILE_KEY}, which is the file this image ships"
else
    fail "mosd reads its profile from '${PROFILE_DEFAULT_PATH}' with key '${PROFILE_KEY}', but the image ships ${PROFILE_FILE}; mosd FAILS CLOSED on a missing file, so every image would self-provision to prod and disable its own sshd with every check still green"
fi
sq_regular "${PROFILE_FILE}"
profile_mode="$(stat -c %a "${ROOT}${PROFILE_FILE}" 2>/dev/null || echo none)"
if [ "${profile_mode}" = "444" ]; then
    pass "${PROFILE_FILE} is mode 0${profile_mode} (it describes the image, not the device, and lives inside the read-only verity root)"
else
    fail "${PROFILE_FILE} is mode ${profile_mode}, expected 444"
fi

# The value is matched CASE-SENSITIVELY by mosd and anything it does not
# recognise resolves to prod, so `DEV`, `Dev`, a comment or a typo in the key
# are all the same silent failure: SSH off on an image built to have it on.
profile_values="$(sed -n "s/^${PROFILE_KEY:-MOS_PROFILE}=\(.*\)\$/\1/p" "${ROOT}${PROFILE_FILE}" 2>/dev/null || true)"
profile_n="$(printf '%s\n' "${profile_values}" | grep -c . || true)"
MOS_PROFILE_VALUE="$(printf '%s\n' "${profile_values}" | tail -n1)"
case "${MOS_PROFILE_VALUE}" in
dev | prod)
    if [ "${profile_n}" = "1" ]; then
        pass "${PROFILE_FILE} carries exactly one ${PROFILE_KEY:-MOS_PROFILE}=${MOS_PROFILE_VALUE} line, an exact lowercase value mosd recognises"
    else
        fail "${PROFILE_FILE} carries ${profile_n} ${PROFILE_KEY:-MOS_PROFILE}= lines; mosd takes the LAST one, so the file's meaning depends on line order"
    fi
    ;;
*)
    fail "${PROFILE_FILE} resolves to '${MOS_PROFILE_VALUE}', which mosd does not recognise. Its match is case-sensitive and it FAILS CLOSED: this image would self-provision to prod and disable its own sshd, with every other check still green. Contents: $(tr '\n' ' ' <"${ROOT}${PROFILE_FILE}" 2>/dev/null)"
    ;;
esac

# ssh.service must NOT be enabled in the image, on EITHER profile.
#
# This assertion used to be profile-dependent and pointed the other way: dev
# shipped sshd enabled. It no longer does. mosd seeds access.ssh.enabled false
# for dev and prod alike (Profile::ssh_enabled_default), so an image that
# shipped ssh.service enabled would be listening from early boot until mosd's
# first reconcile stopped it — precisely the window the setting exists to close.
# The profile value is still read from the packed image, so this is checked for
# whichever profile was actually built, and a returning enablement symlink under
# any *.wants directory fails it.
ssh_wants="$(find "${ROOT}/etc/systemd/system" "${ROOT}/usr/lib/systemd/system" \
    \( -name ssh.service -o -name sshd.service \) -path '*.wants/*' 2>/dev/null || true)"
case "${MOS_PROFILE_VALUE}" in
dev | prod)
    if [ -z "${ssh_wants}" ]; then
        pass "profile is ${MOS_PROFILE_VALUE} and ssh.service is NOT enabled in the image, so sshd never listens before mosd has decided (both profiles seed access.ssh.enabled false)"
    else
        fail "profile is ${MOS_PROFILE_VALUE} but ssh.service IS enabled in the image ($(printf '%s' "${ssh_wants}" | sed "s|${ROOT}||g" | tr '\n' ' ')); sshd would be listening from early boot until mosd's reconciler stopped it, and both profiles now seed access.ssh.enabled false"
    fi
    ;;
*)
    fail "ssh.service enablement cannot be judged: the image profile did not resolve to dev or prod"
    ;;
esac

# --- ssh.service KillMode: defence in depth, NOT the mitigation --------------
# The mitigation for "an operator sets a transient root password over SSH and
# disconnects themselves" is that the sshd reconciler RELOADS ssh.service on a
# configuration-only change instead of restarting it (RFCT-047). sshd re-reads
# its configuration on SIGHUP, so established sessions survive a reload BY
# CONSTRUCTION — not by grace, and not because of anything asserted here.
#
# What this check is for: KillMode=process is an inherited property of Debian's
# openssh-server packaging that this image does not author and had never
# asserted. It bounds the damage if something restarts the unit anyway — under
# the systemd default KillMode=control-group a restart kills every process in
# the unit's cgroup, including the forked session carrying the operator's own
# connection. So it is a second line of defence and a tripwire for the day a
# base-image change moves it.
#
# It is NOT a substitute for the reload, and this check passing is NOT a reason
# to go back to restarting.
SSH_UNIT="${ROOT}/usr/lib/systemd/system/ssh.service"
if [ ! -f "${SSH_UNIT}" ]; then
    fail "/usr/lib/systemd/system/ssh.service is not in the image, so no claim can be made about KillMode"
elif grep -qE '^KillMode=process[[:space:]]*$' "${SSH_UNIT}"; then
    pass "ssh.service sets KillMode=process, so a restart would spare established sessions — defence in depth only: what actually protects an operator's own session is that the reconciler RELOADS on a config-only change (RFCT-047), and this passing is not a reason to restart instead"
else
    fail "ssh.service does NOT set KillMode=process (found '$(sed -n 's/^KillMode=//p' "${SSH_UNIT}" | tail -n1)'; systemd defaults to control-group). The image has lost its second line of defence: anything that RESTARTS this unit now kills established SSH sessions with it. This does not by itself disconnect an operator setting a transient root password — the reconciler reloads rather than restarts (RFCT-047) — but that reload is now the ONLY thing preventing it, so do not treat this as cosmetic"
fi

# --- ssh.service ExecReload: what the reconciler's reload depends on ---------
# RFCT-047 made SshdReconciler RELOAD ssh.service on a configuration-only
# change instead of restarting it, so an operator who sets a transient root
# password over their own SSH session keeps it. That correctness now rests on
# the unit shipped by Debian's openssh-server carrying an ExecReload= -- a
# property this image INHERITS rather than chooses, exactly like KillMode
# above. RFCT-047 could not assert it, because the verifier is not its file.
#
# With no ExecReload=, `systemctl reload ssh.service` fails outright. The
# reconciler renders its sshd configuration to disk and the running sshd never
# re-reads it, so a change -- PasswordAuthentication among them -- SILENTLY
# fails to apply: the file on disk says one thing and the listener keeps
# enforcing another until something else restarts the unit.
if [ ! -f "${SSH_UNIT}" ]; then
    fail "/usr/lib/systemd/system/ssh.service is not in the image, so no claim can be made about ExecReload"
elif grep -qE '^ExecReload=' "${SSH_UNIT}"; then
    pass "ssh.service carries ExecReload=, so the config-only reload the sshd reconciler issues (RFCT-047) can actually reach the running sshd"
else
    fail "ssh.service has NO ExecReload=. The sshd reconciler RELOADS this unit on a configuration-only change (RFCT-047); without ExecReload that reload fails, and the rendered sshd configuration — PasswordAuthentication included — silently never applies to the running listener"
fi

# --- the shadow hash format, against the libcrypt PACKED IN THIS IMAGE ------
# No Rust test can make this assertion: the test host is x86 and the library is
# an arm64 object inside the image. mosd writes a crypt(3) hash into the root
# account's shadow entry and pam_unix verifies it through this exact libcrypt;
# a format the library cannot parse rejects every password while the file, the
# unit and the reconciler all look perfectly healthy.
# The prefix is READ from the assertion transient.rs pins on its own output, so
# the two cannot drift; requiring exactly one keeps that source unambiguous.
# transient.rs and not sshd.rs: RFCT-033 moved the code that writes the root
# hash out of the reconciler into the transient-password module, and the pin
# moved with it.
CRYPT_SRC="${REPO_ROOT}/mosd/mosd/src/transient.rs"
crypt_prefixes="$(grep -oE 'starts_with\("\$[0-9a-zA-Z]+\$' "${CRYPT_SRC}" 2>/dev/null | grep -oE '\$[0-9a-zA-Z]+\$' | sort -u || true)"
crypt_n="$(printf '%s\n' "${crypt_prefixes}" | grep -c . || true)"
CRYPT_PREFIX="$(first_line <<<"${crypt_prefixes}")"
if [ "${crypt_n}" = "1" ]; then
    pass "transient.rs pins exactly one crypt(3) prefix for the shadow field: ${CRYPT_PREFIX}"
else
    fail "transient.rs pins ${crypt_n} distinct crypt(3) prefixes ($(printf '%s' "${crypt_prefixes}" | tr '\n' ' ')); the format the image must support is ambiguous, so the libcrypt check below cannot mean anything"
fi

# The multiarch triplet follows the board. This was pinned to
# aarch64-linux-gnu, so on x64 the check reported that libcrypt "does not
# resolve to a regular file in the image" -- true of a path that board never
# had, and a statement about the wrong directory rather than about the library.
case "${MOS_ARCH}" in
arm64) MULTIARCH_TRIPLET=aarch64-linux-gnu ;;
amd64) MULTIARCH_TRIPLET=x86_64-linux-gnu ;;
*) echo "error: MOS_ARCH is '${MOS_ARCH}'; this verifier knows arm64 and amd64" >&2; exit 1 ;;
esac
LIBCRYPT_LINK="/usr/lib/${MULTIARCH_TRIPLET}/libcrypt.so.1"
LIBCRYPT_REAL=""
if [ -e "${ROOT}${LIBCRYPT_LINK}" ]; then
    LIBCRYPT_REAL="$(readlink -f "${ROOT}${LIBCRYPT_LINK}" 2>/dev/null || true)"
fi
if [ -n "${LIBCRYPT_REAL}" ] && [ -f "${LIBCRYPT_REAL}" ]; then
    pass "${LIBCRYPT_LINK} resolves to ${LIBCRYPT_REAL#"${ROOT}"} in the image (the SONAME the login stack loads)"
else
    fail "${LIBCRYPT_LINK} does not resolve to a regular file in the image; without it pam_unix cannot verify any password at all"
fi
if [ "${crypt_n}" != "1" ] || [ ! -s "${LIBCRYPT_REAL:-/nonexistent}" ]; then
    fail "cannot check the crypt(3) format against the image's libcrypt: prefix count ${crypt_n}, library '${LIBCRYPT_REAL:-missing}'"
# `grep -F`, not `grep -Fq`: with -q grep exits the moment it matches, tr
# takes SIGPIPE, and `set -o pipefail` turns that 141 into a FAILED check on
# a library that does carry the format. It reproduces about one run in three.
elif LC_ALL=C tr -c '[:print:]' '\n' <"${LIBCRYPT_REAL}" | grep -F -- "${CRYPT_PREFIX}" >/dev/null; then
    pass "the libcrypt packed in this image implements ${CRYPT_PREFIX}, the crypt(3) format mosd writes into the root shadow entry"
else
    fail "the libcrypt packed in this image ($(basename "${LIBCRYPT_REAL}")) does NOT implement ${CRYPT_PREFIX}, the format mosd writes into /etc/shadow. pam_unix would reject every password while the shadow file, the reconciler and every other check look healthy. Formats it does carry: $(LC_ALL=C tr -c '[:print:]' '\n' <"${LIBCRYPT_REAL}" | grep -oE '^\$[0-9a-z]+\$$' | sort -u | tr '\n' ' ')"
fi

# ===========================================================================
# summary
# ===========================================================================
total=$((PASS_N + FAIL_N))
# The skip count is in the summary, not only in the body. A reader who scrolls
# to the last line is the reader most likely to mistake "nothing applied" for
# "everything passed".
skips=""
[ "${SKIP_N}" -gt 0 ] && skips=", ${SKIP_N} skipped (${MOS_BOARD}/${RAUC_BOOTLOADER}; each named above)"
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} checks${skips})"
else
    echo "RESULT: FAIL (${PASS_N}/${total} checks${skips})"
    exit 1
fi
