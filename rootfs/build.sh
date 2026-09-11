#!/usr/bin/env bash
# Build the squashfs + dm-verity arm64 rootfs slot image for cx3576 (A/B layout).
# Usage: [BOARD_DIR=...] [WITH_MOSD=0|1] [MOS_ROOTFS_NO_CACHE=0|1]
#        [WITH_CONTAINERS=0|1] [MOS_PROFILE=dev|prod]
#        [MOS_ROOTFS_WITHOUT="wifi bluetooth mqtt ..."] bash rootfs/build.sh

# There is deliberately no ROOT_PASSWORD here. A mos rootfs is a signed,
# byte-identical squashfs and the pack stage fails any build whose factory
# shadow carries a usable hash, so a baked mos root password is unbuildable by
# design, not merely discouraged. Dev root access on mos is the transient
# password set at runtime through mosd (SetTransientRootPassword; cleared on
# the next boot by mos-shadow-reconcile) plus the serial console, whose root
# account stays locked until that password is set. See
# docs/design/access.md section 4.1.

# Outputs (all under _out/<board>/). The first four are consumed by the image
# assembler, build/src/mkimage-cx3576.ts and mkimage-uefi.ts:
#   rootfs-verity.img: squashfs-zstd with the verity hash tree appended,
#     padded to a whole MiB
#   rootfs-verity.env: verity parameters, strict KEY=value
#   boot-cmdline-a.txt, boot-cmdline-b.txt: the kernel append line per slot

# The rest are records rather than assembler inputs:
#   rootfs-report.txt: package list + installed size
#   pkg-logs/: dpkg.log, alternatives.log and apt/, taken out of /var/log by
#     the finalizer before the package-manager purge removes them. They are
#     NOT in the image -- the purge takes them -- and they are kept because
#     dpkg.log with its timestamps stripped is the record of what APT
#     configured, in the order it configured it.
#   factory-root.oci: the packed root as an OCI image, in OCI-layout tar form.
#     NOT consumed by the assembler -- this is what the smoke runner executes
#     the self-built binaries in, so "it linked" and "it runs" stop being the
#     same claim. `docker load -i` it.
#   factory-root.txt: what that archive is -- ref, platform, size, sha256
#   rootfs-stages.txt: the Dockerfiles as built, in order, each with its content
#     hash and a `# declined:` line. Written by the driver over whatever
#     directory it was pointed at; it records which files ran, not what the
#     image is made of.
#   rootfs-packages.txt: the local packages installed, with the version,
#     architecture, archive sha256 and owning producer directory of each, read
#     out of the pool index. PLAN-036 section 4's durable composition record,
#     and the one that says what this image is made of.
#   mosd-build.txt: the commit mosd and apid in this root were built from,
#     copied from _out/mosd-build-<arch>.txt, which the producer that compiled
#     them wrote. NOT copied into the image. Not written when mosd is declined;
#     see below.
# rootfs/README.md, "Outputs to _out/<board>/", is the table version of this.

# Every layout constant is read from boards/cx3576/board.env.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
# MOS_BOARD selects the layout, the output directory and the architecture.
# cx3576 is the default and its path is unchanged; x64 and virt-arm64 are the
# QEMU targets -- x64 so that the two things an arm64 build could not prove (a
# container actually starting, and containers.conf's values taking effect) have
# somewhere to be proven before hardware, and virt-arm64 so that the proving can
# happen on the ARCHITECTURE THE DEVICE RUNS rather than beside it.
MOS_BOARD=${MOS_BOARD:-cx3576}
LAYOUT_ENV="$REPO_ROOT/boards/${MOS_BOARD}/board.env"

# THE BOARD IS ITS DEFINITION FILE, and the refusal says so.
#
# This used to be a `case` mapping each board name to an architecture, whose
# default arm named the known boards in prose. Two things were wrong with it.
# The list was a second place to add a board, and the tree has a standing rule
# against those -- verify/src/paths.ts discovers boards by listing boards/*/
# for exactly this reason, because a literal is what a new board gets left out
# of. And the architecture it assigned was a SECOND STATEMENT of a fact
# boards/<board>/board.env already makes: the file sourced below sets MOS_ARCH
# itself, to the same value, so the two agreed only because nobody had changed
# one of them.
#
# What the `case` also did, and what is kept, is REFUSE AN UNKNOWN BOARD BY
# NAME. Without it a typo becomes a missing-file error much later, about a path
# rather than about the board, in a state the reader then has to reconstruct.
# The refusal now asks the question that actually decides the answer -- is
# there a definition for this board -- and lists what it found.
if [ ! -f "$LAYOUT_ENV" ]; then
    known=$(cd "$REPO_ROOT/boards" && for d in */; do
        [ -f "${d}board.env" ] && printf '%s ' "${d%/}"
    done)
    echo "error: MOS_BOARD is '$MOS_BOARD', and $LAYOUT_ENV does not exist." >&2
    echo "       A board IS its board.env; boards with one here: ${known:-(none)}" >&2
    exit 1
fi
BOARD_DIR=${BOARD_DIR:-"$REPO_ROOT/boards/${MOS_BOARD}/bsp"}
OUT_DIR="$REPO_ROOT/_out/${MOS_BOARD}"
# Installed-size budget. A per-board fact for the same reason
# BOARD_CMDLINE_ARGS is: it protects a rootfs slot, and the slots differ.
SIZE_BUDGET_MB="${SIZE_BUDGET_MB_OVERRIDE:-}"
WITH_MOSD=${WITH_MOSD:-1}
case "$WITH_MOSD" in
0 | 1) ;;
*)
    echo "error: WITH_MOSD is '$WITH_MOSD'; it must be exactly 0 or 1. It selects whether the mosd packages are in the resolved set, and anything else here would be read as 'not 1' and silently build an image with no management daemon" >&2
    exit 1
    ;;
esac

# Whether the container engine is in the image at all.
#
# BOARD-LEVEL, because it is a board decision: the engine costs ~107 MB
# installed and a board with a tighter rootfs slot, or no use for containers,
# should not carry it. The board opts OUT by shipping a containers.env saying
# so; absent means ON, which is the cx3576 default the user asked for.
#
# An explicit WITH_CONTAINERS in the environment beats the board file, so a
# one-off build can go either way without editing the board.
#
# This is the BUILD-time switch: is the engine present. The RUN-time switch --
# `container.enabled` in the settings tree, driven from apid -- is a different
# question: whether an engine that IS present may be used.
if [ -z "${WITH_CONTAINERS:-}" ] && [ -f "$BOARD_DIR/containers.env" ]; then
    # shellcheck disable=SC1091
    . "$BOARD_DIR/containers.env"
fi
WITH_CONTAINERS=${WITH_CONTAINERS:-1}
case "$WITH_CONTAINERS" in
0 | 1) ;;
*)
    echo "error: WITH_CONTAINERS is '$WITH_CONTAINERS'; it must be exactly 0 or 1. It selects whether mos-podman is in the resolved set, and anything else here would be read as 'not 1' and the engine would silently not ship" >&2
    exit 1
    ;;
esac

# Cold reproducibility checks need a cache-independent route through the same
# stages driver as an ordinary build. The driver already implements --no-cache;
# this explicit opt-in only bridges the rootfs entry point to that existing
# behavior and keeps normal developer builds cached by default.
ROOTFS_CACHE_ARGS=()
case "${MOS_ROOTFS_NO_CACHE-0}" in
0) ;;
1) ROOTFS_CACHE_ARGS=(--no-cache) ;;
*)
    echo "error: MOS_ROOTFS_NO_CACHE is '${MOS_ROOTFS_NO_CACHE}'; it must be exactly 0 or 1" >&2
    exit 1
    ;;
esac
# The declined features, as one list. WITH_CONTAINERS and WITH_MOSD are the
# two historical spellings and they fold into it here, so there is one answer
# to "is this feature in the image" and every consumer below asks the same
# question. MOS_ROOTFS_WITHOUT is the general form -- a space-separated list of
# feature names -- and it is what makes the three features with no WITH_*
# history (wifi, bluetooth, mqtt) reachable from the shipping path at all.

# A name nothing matches is not validated here, deliberately: the resolver
# holds the list of feature names (it reads rootfs/packages/) and refuses an
# unknown one by name, with the features that do exist. A second copy of that
# list in this file is the second table this repository keeps deleting.
MOS_ROOTFS_WITHOUT=${MOS_ROOTFS_WITHOUT:-}
WITHOUT_FEATURES=" ${MOS_ROOTFS_WITHOUT} "
[ "$WITH_CONTAINERS" = "1" ] || WITHOUT_FEATURES="${WITHOUT_FEATURES}containers "
[ "$WITH_MOSD" = "1" ] || WITHOUT_FEATURES="${WITHOUT_FEATURES}mosd "
# `case` and not a substring test with [[ ]]: this file is bash, but the pattern
# is the same one the POSIX scripts use and one spelling reads the same in both.
declined() { case "$WITHOUT_FEATURES" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
if [ -n "${MOS_ROOTFS_WITHOUT}" ]; then
    echo "note: MOS_ROOTFS_WITHOUT declines:${MOS_ROOTFS_WITHOUT}"
fi

# Image profile baked into /usr/lib/mos/profile.conf. mosd reads it on first
# boot and FAILS CLOSED to prod, so the value has to be exactly "dev" or "prod"
# in lowercase; the Dockerfile rejects anything else. It does NOT select the
# access.ssh.enabled seed: both profiles seed SSH OFF and neither image ships
# ssh.service enabled, so the profile currently changes nothing that is seeded.
MOS_PROFILE=${MOS_PROFILE:-dev}

# HOW THE ROOT IS ASSEMBLED, and there is one answer.
#
# rootfs/compose/*.Dockerfile: one apt transaction against the local package
# pool `make os-debs` builds, with APT deriving the configuration order from
# `Depends`, and then the finalizer -- 90-pack.Dockerfile beside it, which
# closes the root, does the tree surgery, runs the assertions, builds the
# squashfs, appends the verity tree and writes both export surfaces.
# PLAN-036 sections 4 and 5.
#
# The numbered stage chain this replaced is gone (PLAN-036 section 5, last
# paragraph): the floor, the read-only-root wiring, the four feature stages and
# the board were Dockerfile numbers standing in for package metadata, and they
# are Debian packages now. What is left is not a chain of nine files with an
# order to defend -- it is one transaction and one finalizer.

# Existence was already refused, by name and with the board list, right after
# MOS_BOARD was read -- a second check here would be a second message for one
# condition, and the earlier one is the better message.
# shellcheck source=../boards/cx3576/board.env
. "$LAYOUT_ENV"

# The architecture, from the board definition and from nowhere else.
#
# There is no fallback and no `case` behind this: the board file is the one
# statement of its architecture (see the refusal above), so a layout that does
# not make it has to say so here rather than be assigned one. Everything
# downstream -- the package pool it composes from, the docker platform it
# builds for, the emulation it may need -- follows from this line.
if [ -z "${MOS_ARCH:-}" ]; then
    echo "error: $LAYOUT_ENV sets no MOS_ARCH. The architecture is a board fact and is deliberately not derived from the board name -- 'virt-arm64' and 'cx3576' are both arm64 and 'x64' is amd64, so a name-based guess would be a guess. Without it this build would choose a package pool and a docker platform for a board that has not said which it is" >&2
    exit 1
fi
DOCKER_PLATFORM="linux/${MOS_ARCH}"

# Board console facts. These describe a board's serial console, not its
# partition layout, so each boards/<board>/board.env carries its own
# BOARD_CMDLINE_ARGS and this refuses a layout that forgot to.
SIZE_BUDGET_MB="${SIZE_BUDGET_MB:-${BOARD_SIZE_BUDGET_MB:-}}"
if [ -z "$SIZE_BUDGET_MB" ]; then
    echo "error: $LAYOUT_ENV sets no BOARD_SIZE_BUDGET_MB. Without a budget the root can grow past its slot and the first sign would be an image that does not fit" >&2
    exit 1
fi
if [ -z "${BOARD_CMDLINE_ARGS:-}" ]; then
    echo "error: $LAYOUT_ENV sets no BOARD_CMDLINE_ARGS. The kernel command line would carry no console= at all, so the board would boot with nowhere to print why it did not" >&2
    exit 1
fi

# There is deliberately no VERITY_UUID here. The pack formats with
# --no-superblock, because the cmdline this script writes below hands dm-init a
# verity v1 table whose hash_start_block the kernel reads as the tree's top
# level -- a superblock at that offset is what the kernel reports as a corrupt
# metadata block. The UUID lived IN that superblock, so with the superblock gone
# there is nothing left for a pinned UUID to pin, and veritysetup would take the
# option and discard the value. Reproducibility is unaffected: the field that
# used to be randomised no longer exists in the image at all.

# FILE_MTIME is the touch(1) form (@epoch); mksquashfs wants bare seconds.
#
# One instant, two consumers: this value is also what the driver is given as
# --source-date-epoch, which buildkit stamps into the OCI export of the packed
# root. It was three until PLAN-074, the third being the initrd that Debian's
# kernel postinst built under 10-compose's declared SOURCE_DATE_EPOCH; there is
# no initrd on either board now. Deliberately the same number and not separate
# pinned constants -- the squashfs and the OCI image are two encodings of one
# tree, and a second epoch would be a second answer to "when was this root made"
# that nothing would reconcile. The assembler spells it this way for mkimage's SOURCE_DATE_EPOCH.
SQUASHFS_TIME=${FILE_MTIME#@}

mkdir -p "$OUT_DIR"

# REMOVED HERE AND WRITTEN AFTER THE PACK, near the end of this file. A record
# left by a previous build would name the commit of an image this run did not
# produce, and a run that dies in between would leave it looking current --
# which is worse than its absence, because the smoke runner says out loud when
# it has no record and cannot say anything at all about a wrong one.
rm -f "$OUT_DIR/mosd-build.txt"

# Validate the package pool before resolving the OpenSSL inspection container.
POOL_DIR="$REPO_ROOT/_out/debs/$MOS_ARCH"
pool_refusal() {
    echo "error: $1" >&2
    echo "       The rootfs composer installs from _out/debs/<arch>; it does not build a package." >&2
    echo "       Build the pool and its index with: make os-debs" >&2
    exit 1
}
[ -d "$POOL_DIR" ] ||
    pool_refusal "$POOL_DIR does not exist, so there is no $MOS_ARCH package pool to compose from."
for f in Packages SHA256SUMS manifest.txt; do
    [ -s "$POOL_DIR/$f" ] ||
        pool_refusal "$POOL_DIR/$f is missing or empty, so the pool carries no usable index. APT takes an empty Packages file without complaint, so this would install none of this repository's own packages and report success."
done
[ -d "$POOL_DIR/pool" ] ||
    pool_refusal "$POOL_DIR/pool does not exist, so the index beside it describes archives that are not there."
pool_debs=$(find "$POOL_DIR/pool" -maxdepth 1 -type f -name '*.deb' | wc -l)
[ "$pool_debs" -gt 0 ] ||
    pool_refusal "$POOL_DIR/pool holds no .deb at all."

# STALE, sense 1: the index does not describe the archives beside it.
# build-env/deb/repo.sh writes SHA256SUMS over exactly the pool it
# indexed, so a mismatch means an archive was rebuilt or removed afterwards
# and the Packages APT would read describes a different set of bytes.
( cd "$POOL_DIR" && sha256sum --quiet -c SHA256SUMS ) >/dev/null 2>&1 ||
    pool_refusal "$POOL_DIR/SHA256SUMS does not verify against the archives beside it, so the index and the pool have come apart."
indexed=$(grep -c '^' "$POOL_DIR/SHA256SUMS")
[ "$indexed" -eq "$pool_debs" ] ||
    pool_refusal "$POOL_DIR/pool holds $pool_debs archive(s) and SHA256SUMS lists $indexed. sha256sum -c only checks the listed ones, so an archive the index has never seen would be installable and unrecorded."

# STALE, sense 2: an archive is newer than the index over it. `find -newer`
# rather than a timestamp comparison, because that is the question --
# is there any archive repo.sh has not seen.
newer=$(find "$POOL_DIR/pool" -maxdepth 1 -type f -name '*.deb' -newer "$POOL_DIR/manifest.txt" -printf '%f ')
[ -z "$newer" ] ||
    pool_refusal "these archives are newer than $POOL_DIR/manifest.txt, so the pool was rebuilt without being re-indexed: $newer"

# STALE, sense 3: the pool was not built from THIS tree. Versions are per
# package -- an upstream repack carries its upstream number in front -- but
# every archive ends in the one `+git<commit><dirty>-<rev>` STAMP
# build-env/deb/version.sh printed when it was built, and
# tests/deb-package-gate.sh asserts that stamp over the built pool. A pool
# whose stamp is not this tree's resolves, installs, and composes an image out
# of some other commit's packages while every check downstream reports on the
# tree in front of it.
pool_stamps=$(grep -v '^#' "$POOL_DIR/manifest.txt" | cut -f2 | sed 's/^.*+//' | sort -u | tr '\n' ' ')
pool_stamp=${pool_stamps% }
case "$pool_stamp" in
*' '*)
    [ -n "${MOS_ROOTFS_PRODUCER_JOIN:-}" ] || pool_refusal "$POOL_DIR/manifest.txt carries more than one git stamp: $pool_stamp. The pool carries one stamp across every producer by rule; two stamps mean it was half-rebuilt across a tree change."
    ;;
esac
PACKAGE_SOURCE=${MOS_ROOTFS_PACKAGE_SOURCE:-$REPO_ROOT}
[ -z "${MOS_ROOTFS_PRODUCER_JOIN_SHA256:-}" ] || [ -n "${MOS_ROOTFS_PRODUCER_JOIN:-}" ] ||
    pool_refusal "producer join digest requires an explicit joined input."
# Verify the actual clean sources and frozen receipt before executing a producer
# version script or resolving any container. An explicit source is not a stamp override.
LINEAGE_ARGS=()
if [ -n "${MOS_ROOTFS_PACKAGE_SOURCE:-}" ]; then
    LINEAGE_ARGS+=(--package-source "$PACKAGE_SOURCE")
fi
if [ -n "${MOS_ROOTFS_PACKAGE_RECEIPT:-}" ]; then
    LINEAGE_ARGS+=(--receipt "$MOS_ROOTFS_PACKAGE_RECEIPT" --receipt-sha256 "${MOS_ROOTFS_PACKAGE_RECEIPT_SHA256:-}")
fi
if [ -n "${MOS_ROOTFS_PRODUCER_JOIN:-}" ]; then
    LINEAGE_ARGS+=(--producer-join "$MOS_ROOTFS_PRODUCER_JOIN" --producer-join-sha256 "${MOS_ROOTFS_PRODUCER_JOIN_SHA256:-}")
fi
LINEAGE_STAGE="$OUT_DIR/source-lineage.json"
tree_version=$(python3 "$REPO_ROOT/rootfs/runtime/source-lineage.py" \
    --composition-source "$REPO_ROOT" --pool "$POOL_DIR" --arch "$MOS_ARCH" \
    --epoch "$SQUASHFS_TIME" --output "$LINEAGE_STAGE" "${LINEAGE_ARGS[@]}")
tree_stamp=${tree_version##*+}
# The explicit named tool witness is verified before any resolver/container.
# Propagate its immutable manifest identity; a tag/config digest cannot replace it.
boot_tools_image=$(python3 - "$LINEAGE_STAGE" <<'PY_BOOT_TOOL'
import json, sys
record = json.load(open(sys.argv[1]))
joined = record.get('producer_join', {})
if joined.get('schema') == 'mos/producer-join/boot-tools-v1':
    print(joined['boot_tools']['production']['manifest'])
PY_BOOT_TOOL
)
if [ -n "$boot_tools_image" ]; then
    [ "${MOS_BOOT_TOOLS_IMAGE:-$boot_tools_image}" = "$boot_tools_image" ] ||
        pool_refusal "boot-tools image differs from the verified producer witness."
    export MOS_BOOT_TOOLS_IMAGE="$boot_tools_image"
fi
[ -n "${MOS_ROOTFS_PRODUCER_JOIN:-}" ] || [ "$pool_stamp" = "$tree_stamp" ] ||
    pool_refusal "the $MOS_ARCH pool was built at stamp '$pool_stamp' and the verified package source is '$tree_stamp'."
echo "pool: $POOL_DIR, $pool_debs archive(s) at stamp $pool_stamp"

# --- the composition's inputs: the package pool, the resolution, the context ---
#
# The composer INSTALLS; it never compiles. Everything below either reads the
# pool `make os-debs` wrote or asks rootfs/packages/resolve.sh which packages
# this build's inputs select, and every refusal here names the make target that
# produces what is missing. A composer that built a component on demand would
# make "the pool is stale" invisible -- the build would simply take longer and
# then install something the pool never held.
COMPOSE_STAGE="$OUT_DIR/compose"
PACKAGES_RECORD="$OUT_DIR/rootfs-packages.txt"
rm -rf "$COMPOSE_STAGE"
# Removed for the reason mosd-build.txt is: a record left by a previous build
# would describe the package set of an image this run did not produce, and a
# run that dies before the record is written would leave it looking current.
rm -f "$PACKAGES_RECORD"

# THE SOURCE COMMIT'S DATE, for /usr/share/mos/release-identity.env and from
# there for mosd's system-information surface.
#
# Every timestamp inside a composed root is pinned: SQUASHFS_TIME above is
# FILE_MTIME, which build/src/geometry.ts fixes to a constant so two builds of
# one tree are byte-identical. That is the point of it -- and it means an
# image's file times say 2020-01-01 and always will, so the surface that used
# to read one back reported the same "build date" on every image ever built.
#
# The commit date is the fact that is BOTH truthful and reproducible: it is a
# property of the commit, so every rebuild of one source states it identically,
# and it is the date that source was actually written.
#
# Derived from the STAMP and not from HEAD. $tree_stamp is what
# build-env/deb/version.sh printed and what the pool was just required to
# carry; asking git about HEAD instead would be a second question with a second
# answer the moment anything moved between the two calls, and the identity file
# would then date an image by a commit its packages were not built from.
commit_of_stamp=${tree_stamp#git}      # git<12hex>[.dirty]-<rev> -> <12hex>[.dirty]-<rev>
commit_of_stamp=${commit_of_stamp%%-*} #                          -> <12hex>[.dirty]
commit_of_stamp=${commit_of_stamp%.dirty}
# `^{commit}` so the argument can only resolve as a commit: a bare 12-hex
# string is also a path a repository could hold, and `git show` would then
# print that file and this would date the image by it.
tree_commit_date=$(git -C "$PACKAGE_SOURCE" show -s --format=%cI "${commit_of_stamp}^{commit}" 2>/dev/null || true)
[ -n "$tree_commit_date" ] || {
    echo "error: git names no commit date for '$commit_of_stamp', the commit in this tree's stamp '$tree_stamp'." >&2
    echo "       That date is written into /usr/share/mos/release-identity.env and is the only date in a" >&2
    echo "       composed image that is not the pinned SOURCE_DATE_EPOCH; composing without it would leave" >&2
    echo "       the system-information surface with no date to report at all." >&2
    exit 1
}
echo "identity: source commit $commit_of_stamp committed $tree_commit_date"

# WHAT TO INSTALL. resolve.sh takes every input as an ARGUMENT and
# deliberately re-derives nothing: which board file was read, which
# environment variable beats which file, and how the historical WITH_*
# spellings fold into one decline list are all decided above, in this
# script, and a second copy of that logic in the resolver would be the
# second table this repository keeps deleting. `echo` unquoted is what
# turns " containers mosd " into "containers mosd", which is the spelling
# its --without takes.
# shellcheck disable=SC2116,SC2086 # deliberate: collapse the padded list.
WITHOUT_ARG=$(echo $WITHOUT_FEATURES)
RESOLVED=$(bash "$REPO_ROOT/rootfs/packages/resolve.sh" \
    --board "$MOS_BOARD" \
    --profile "$MOS_PROFILE" \
    --radios "$BOARD_RADIOS" \
    --without "$WITHOUT_ARG" \
    --components "${MOS_ROOTFS_COMPONENTS:-}")
resolved_n=$(printf '%s\n' "$RESOLVED" | { grep -c . || true; })
[ "$resolved_n" -gt 0 ] ||
    { echo "error: rootfs/packages/resolve.sh printed no package and exited 0" >&2; exit 1; }

# Every resolved package has to BE in the pool, refused here rather than
# inside the composition: APT would report "unable to locate package",
# which names the package and not the producer that was never built.
# `grep -c ... >/dev/null` and never `grep -q`: this file sets pipefail, and
# a -q reader exits at the first match, so the producer on its left dies of
# SIGPIPE and the pipeline reports failure exactly when the package IS
# present. tests/shell-pipefail-lint.sh polices the same trap.
pool_names=$(grep -v '^#' "$POOL_DIR/manifest.txt" | cut -f1)
missing_pkgs=""
for p in $RESOLVED; do
    printf '%s\n' "$pool_names" | grep -cx -- "$p" >/dev/null ||
        missing_pkgs="$missing_pkgs $p"
done
if [ -n "$missing_pkgs" ]; then
    echo "error: the resolution names package(s) the $MOS_ARCH pool does not contain:$missing_pkgs" >&2
    for p in $missing_pkgs; do
        producer=$(bash "$REPO_ROOT/build-env/deb/producers.sh" |
            awk -v pkg="$p" '{ n = split($4, a, ","); for (i = 1; i <= n; i++) if (a[i] == pkg) print $1 }')
        if [ -n "$producer" ]; then
            echo "       $p is emitted by the '$producer' producer: make os-deb-$producer" >&2
        else
            echo "       $p is emitted by NO producer in this repository, which rootfs/packages/resolve.sh should already have refused" >&2
        fi
    done
    exit 1
fi

# package=directory for every package any producer emits, as one
# `;`-separated string the record writer below reads. Built from
# producers.sh, which discovers producers from the tree, so a producer that
# moves takes its row with it; the alternative is a table in this file that
# is right until somebody renames a directory.
PRODUCER_DIRS=$(bash "$REPO_ROOT/build-env/deb/producers.sh" |
    awk '{ n = split($4, a, ","); for (i = 1; i <= n; i++) printf "%s=%s;", a[i], $2 }')
[ -n "$PRODUCER_DIRS" ] ||
    { echo "error: build-env/deb/producers.sh named no package, so every row of the composition record would carry '(no producer declares it)' for its source" >&2; exit 1; }

# Only the unchanged validated public set enters the composition.
META_DIR="${MOS_META_DIR:-$REPO_ROOT/meta}"
bash "$REPO_ROOT/rootfs/scripts/validate-public-meta.sh" "$META_DIR"
META_STAGE="$(mktemp -d "$OUT_DIR/meta-public.XXXXXX")"
mkdir -p "$META_STAGE/usr/share/mos/meta/updates"
manifest="$META_DIR/updates/manifest.json"
install -m 0644 "$manifest" "$META_STAGE/usr/share/mos/meta/updates/manifest.json"
if [ -s "$META_DIR/GENERATED" ]; then
    install -m 0644 "$META_DIR/GENERATED" "$META_STAGE/usr/share/mos/meta/GENERATED"
else
    rm -f "$META_STAGE/usr/share/mos/meta/GENERATED"
fi

mkdir -p "$COMPOSE_STAGE"
cp "$LINEAGE_STAGE" "$COMPOSE_STAGE/source-lineage.json"
printf '%s\n' "$RESOLVED" > "$COMPOSE_STAGE/packages.txt"
# The public set, audited above, handed to the composition context as the
# image-relative tree it will be installed as. Copied and not bound, because
# these files have to end up IN the image.
mkdir -p "$COMPOSE_STAGE/meta-public"
cp -a "$META_STAGE/." "$COMPOSE_STAGE/meta-public/"
echo "compose: $resolved_n package(s) resolved for $MOS_BOARD/$MOS_PROFILE, declined:${MOS_ROOTFS_WITHOUT:- (none)}"
sed 's/^/  /' "$COMPOSE_STAGE/packages.txt"

# The builder is NAMED rather than inherited -- the same BUILDX_BUILDER
# register as pkgs/mos-deploy/build.sh and pkgs/podman/build.sh, and the same
# selection. BUILDX_BUILDER wins, because a caller who names a builder has made
# a decision. With nothing named, `default` is the docker driver on every
# docker installation, and it reaches linux/${MOS_ARCH} exactly when the host
# has binfmt registered for it. When it does not, the `mos-${MOS_ARCH}`
# docker-container builder is used, whose buildkit image bundles the
# emulators and needs no host registration.
#
# What changed, and why it used to refuse here. The finalizer opens `FROM
# ${MOS_STAGE_PREV}` -- the composition's image; on the docker driver that is a
# tag in the image store, which a docker-container builder cannot read
# (measured: "pull access denied", about an image that is right there). So for a
# while a cross build needed host binfmt and this script said so with the
# `tonistiigi/binfmt` command. The driver now hands one file's output to the
# next by OCI layout on any builder that is not the docker driver -- exported
# `type=oci,tar=false` under _out/<board>/stages/ and taken as a named build
# context -- and build/src/stages-cli.ts decides which mode from the
# builder's driver. Nothing here needs to know; it only has to name a builder
# that can execute the platform.
if [ -n "${BUILDX_BUILDER:-}" ]; then
    echo "note: using the builder BUILDX_BUILDER names (${BUILDX_BUILDER})"
    BUILDER="${BUILDX_BUILDER}"
else
    # `grep -c ... >/dev/null`, not `grep -q`: this file sets pipefail, and a
    # -q grep exits as soon as it matches, so the producer dies of SIGPIPE and
    # the pipeline reports failure exactly when the platform IS present.
    # tests/shell-pipefail-lint.sh caught the regression once already.
    default_platforms="$(docker buildx inspect default 2>/dev/null || true)"
    if printf '%s\n' "${default_platforms}" | grep -c "${DOCKER_PLATFORM}" >/dev/null; then
        BUILDER=default
    else
        BUILDER="mos-${MOS_ARCH}"
        echo "note: the 'default' builder cannot reach ${DOCKER_PLATFORM} on this host; using the docker-container builder '${BUILDER}', which bundles its own emulator, and passing the composition to the finalizer by OCI layout"
        docker buildx inspect "${BUILDER}" >/dev/null 2>&1 ||
            docker buildx create --name "${BUILDER}" --driver docker-container >/dev/null
    fi
fi
BUILDER_ARGS=(--builder "${BUILDER}")

log=$(mktemp)
trap 'rm -f "$log"' EXIT
# The two base images of the chain, resolved out of build-env/images.env
# before a forty-minute build starts rather than at the FROM line that consumes
# them. NO --arch: both are IMAGE_ keys, which images.env pins as MULTI-
# ARCHITECTURE index digests precisely so that a cross build picks the right
# manifest -- the check pkgs/podman/build.sh needs is about localhost tags, which
# carry exactly one architecture, and this file uses none.
mapfile -t FROM_ARGS < <("$REPO_ROOT/build-env/from.sh" \
    MOS_IMAGE_BUN=IMAGE_BUN_1 \
    MOS_IMAGE_DEBIAN_BOOKWORM=IMAGE_DEBIAN_BOOKWORM)
# mapfile cannot fail, so its status says nothing about the process inside the
# substitution; an empty array is what a refusal looks like from here, and it
# would reach docker as a build with no --build-arg at all.
if [ "${#FROM_ARGS[@]}" -ne 4 ]; then
    echo "error: build-env/from.sh did not yield the two base images (see its message above); this build would have run with an unpinned or missing FROM" >&2
    exit 1
fi

# from.sh yields `--build-arg KEY=VALUE` pairs; the driver takes `--arg KEY=VALUE`.
# Rewritten here rather than teaching from.sh a second output shape: it has one
# caller that wants docker's spelling and one that does not, and a resolver that
# formats for whoever asks is a resolver two callers have to agree with.
DRIVER_FROM_ARGS=()
for a in "${FROM_ARGS[@]}"; do
    case "$a" in --build-arg) DRIVER_FROM_ARGS+=(--arg) ;; *) DRIVER_FROM_ARGS+=("$a") ;; esac
done

# What the driver is handed: the board, the platform, the context, the output
# directory, the two pinned base images, the values the composition reads and
# the values the finalizer reads.
#
# The driver ENFORCES this list rather than trusting it: an --arg no file
# declares is refused (build/src/stages.ts, unusedArgs), because docker only
# warns about an unused --build-arg and a warning scrolls past in a build this
# size. So a stray argument is a refusal with its own name in it rather than a
# value that quietly does nothing.
#
# VERITY_UUID is deliberately absent, for the reason stated further up: the pack
# formats with --no-superblock and the UUID lived in that superblock. It is not
# merely unused -- passing it would fail the build by name.
#
# No --without either, and that is not an omission: the decline list reaches the
# image through the RESOLUTION, which names fewer packages. resolve.sh refuses a
# feature name nothing matches, with the features that exist -- so
# `MOS_ROOTFS_WITHOUT=contaners` is still a refusal and not a full image
# reported as a reduced one.
DRIVER_ARGS=(
    --board "$MOS_BOARD"
    --platform "$DOCKER_PLATFORM"
    --context "$REPO_ROOT"
    --dest "$OUT_DIR"
    ${BUILDER_ARGS[@]+"${BUILDER_ARGS[@]}"}
    "${DRIVER_FROM_ARGS[@]}"
    --arg MOS_ARCH="$MOS_ARCH"
    --arg BOARD_RADIOS="$BOARD_RADIOS"
    --arg MOS_BOARD="$MOS_BOARD"
    --arg MOS_PROFILE="$MOS_PROFILE"
    --arg MOS_RELEASE_VERSION="$tree_version"
    --arg MOS_RELEASE_COMMIT_DATE="$tree_commit_date"
    --arg VERITY_SALT="$VERITY_SALT"
    --arg SQUASHFS_TIME="$SQUASHFS_TIME"
    --arg SOURCE_DATE_EPOCH="$SQUASHFS_TIME"
    --source-date-epoch "$SQUASHFS_TIME"
    --stages-dir "$REPO_ROOT/rootfs/compose"
    --arg COMPOSE_DIR="_out/$MOS_BOARD/compose"
)

# TWO DOCKERFILES, not one build. build/run.sh --build-rootfs sequences the
# *.Dockerfile files in --stages-dir in numeric order, handing each one's image
# to the next: 10-compose installs the resolved package set, and 90-pack closes
# and packs what it produced. Everything above this line -- the resolved package
# set, the layout checks, the verity parameters -- is this script's job. The
# driver decides only the order, the tags and which argument reaches which file,
# and it refuses an argument no file declares rather than letting docker warn
# about it.
# THE TWO EXPORT DIRECTORIES, EMPTIED FIRST (PLAN-086 S2). `-o type=local`
# MERGES into its destination: it writes what the stage holds and removes
# nothing that is already there. Both of these are sets whose membership is the
# point -- `boot/` is every boot input this root carried and `debug/` is one
# `.build-id/<id>.debug` per binary that was stripped -- so a file left behind
# by a previous build is a boot blob no image was assembled from, or debug
# information for a binary this image does not ship. The second is the worse
# one: a debug file that resolves a core against symbols from another build is
# a wrong answer where no file at all would have been an honest miss.
rm -rf "$OUT_DIR/boot" "$OUT_DIR/debug"

echo "rootfs: composing $MOS_BOARD"
bash "$REPO_ROOT/rootfs/debian/docker.sh" cache --arch "$MOS_ARCH" \
    --packages "$COMPOSE_STAGE/packages.txt"
if ! bash "$REPO_ROOT/build/run.sh" --build-rootfs \
        ${ROOTFS_CACHE_ARGS[@]+"${ROOTFS_CACHE_ARGS[@]}"} \
        "${DRIVER_ARGS[@]}" 2>&1 | tee "$log"; then
    if grep -qi 'exec format error' "$log"; then
        echo >&2
        echo "hint: the builder '${BUILDER}' could not execute ${DOCKER_PLATFORM}. On the default builder that means" >&2
        echo "      ${MOS_ARCH} emulation is not registered on this host (docker run --privileged --rm" >&2
        echo "      tonistiigi/binfmt --install ${MOS_ARCH}); on a docker-container builder, that a stage's" >&2
        echo "      base was resolved at the wrong architecture -- docs/design/build-harness.md section 5.1." >&2
    fi
    exit 1
fi

# THE COMPOSITION RECORD, and it replaces rootfs-stages.txt as the durable
# statement of what this image is made of (PLAN-036 section 4). Written only
# after the build succeeded, for the reason the driver writes its own manifest
# then: a list of packages a failed build would have installed is a list of
# intentions.
#
# EVERY COLUMN IS READ OUT OF THE POOL INDEX, which build-env/deb/repo.sh
# generated by asking dpkg-deb about each archive -- not out of a list kept
# anywhere. The one column that is not in the index is the owning source
# directory, and it comes from build-env/deb/producers.sh, which discovers
# producers from the tree. The NAME SET is not taken on trust either: the
# composition asserts inside the image that dpkg's installed local packages are
# exactly this list, in both directions, so a package that arrived through
# somebody's Depends cannot be missing from here.
#
# It is deliberately NOT staged into the image. Section 4 puts it under
# _out/<board>/, outside the packed root, which is where rootfs-stages.txt has
# always lived; inside the image it would be a second copy of facts dpkg's own
# database already carries at the point the finalizer purges it.
{
    echo "# The local packages composed into the $MOS_BOARD root, one per line."
    echo "# Read out of $POOL_DIR/manifest.txt (which build-env/deb/repo.sh"
    echo "# generated from the archives themselves) and out of"
    echo "# build-env/deb/producers.sh; never from a list kept by hand."
    echo "#"
    printf '#board\t%s\n' "$MOS_BOARD"
    printf '#profile\t%s\n' "$MOS_PROFILE"
    printf '#declined\t%s\n' "${MOS_ROOTFS_WITHOUT:-(none)}"
    printf '#pool\t_out/debs/%s at stamp %s\n' "$MOS_ARCH" "$pool_stamp"
    printf '#package\tversion\tarchitecture\tsha256\tsource\n'
    for p in $RESOLVED; do
        awk -F'\t' -v pkg="$p" -v prods="$PRODUCER_DIRS" '
            $1 == pkg {
                n = split(prods, rows, ";")
                dir = "(no producer declares it)"
                for (i = 1; i <= n; i++) {
                    split(rows[i], kv, "=")
                    if (kv[1] == pkg) dir = kv[2]
                }
                printf "%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, $5, dir
            }' "$POOL_DIR/manifest.txt"
    done
} > "$PACKAGES_RECORD"
recorded=$(grep -vc '^#' "$PACKAGES_RECORD" || true)
[ "$recorded" -eq "$resolved_n" ] ||
    { echo "error: $PACKAGES_RECORD records $recorded package(s) and $resolved_n were resolved and installed. The record is read out of the pool index by name, so a short one means a name the index does not carry -- and a composition record that silently omits a package is worse than none" >&2; exit 1; }
echo
echo "=== rootfs-packages.txt ($recorded package(s)) ==="
cat "$PACKAGES_RECORD"

VERITY_ENV="$OUT_DIR/rootfs-verity.env"
IMG="$OUT_DIR/rootfs-verity.img"
REPORT="$OUT_DIR/rootfs-report.txt"
FACTORY_ROOT_OCI="$OUT_DIR/factory-root.oci"

# The OCI export, asserted here as well as in the driver, because the two
# statements are different. The driver checks the file it just wrote is not
# empty; this checks that a build which reported success left one at all -- the
# case that matters is a chain built by something OTHER than the current driver
# (an older tree, a hand-typed docker command) dropping its output into the same
# _out directory, where a stale or absent archive would be handed to the smoke
# runner as this build's root. index.json is the OCI-layout entry point, so its
# presence is what distinguishes an OCI archive from any other tar.
if [ ! -s "$FACTORY_ROOT_OCI" ]; then
    echo "error: $FACTORY_ROOT_OCI is missing or empty after a build that reported success." >&2
    echo "       the smoke run executes the self-built binaries inside this image; with no" >&2
    echo "       image there is nothing to execute them in, and an image that ships them unexecuted" >&2
    echo "       looks exactly like one whose smoke run passed." >&2
    exit 1
fi
if ! tar -tf "$FACTORY_ROOT_OCI" index.json >/dev/null 2>&1; then
    echo "error: $FACTORY_ROOT_OCI has no index.json, so it is not an OCI image layout." >&2
    echo "       Whatever wrote it did not write what \`docker load\` reads." >&2
    exit 1
fi

# Read the pack stage's output the same way the assembler does: by parsing
# KEY=value, never by sourcing a generated file.
env_get() { sed -n "s/^$2=//p" "$1" | tail -n1; }

for key in VERITY_ROOT_HASH VERITY_SALT VERITY_DATA_BLOCKS VERITY_HASH_START_BLOCK \
    VERITY_DATA_BLOCK_SIZE VERITY_HASH_BLOCK_SIZE VERITY_HASH_ALGO \
    VERITY_DATA_SECTORS SQUASHFS_BYTES IMAGE_BYTES; do
    if [ -z "$(env_get "$VERITY_ENV" "$key")" ]; then
        echo "error: $key missing from $VERITY_ENV" >&2
        exit 1
    fi
done

ROOT_HASH=$(env_get "$VERITY_ENV" VERITY_ROOT_HASH)
DATA_SECTORS=$(env_get "$VERITY_ENV" VERITY_DATA_SECTORS)
DATA_BLOCKS=$(env_get "$VERITY_ENV" VERITY_DATA_BLOCKS)
HASH_START_BLOCK=$(env_get "$VERITY_ENV" VERITY_HASH_START_BLOCK)
DATA_BLOCK_SIZE=$(env_get "$VERITY_ENV" VERITY_DATA_BLOCK_SIZE)
HASH_BLOCK_SIZE=$(env_get "$VERITY_ENV" VERITY_HASH_BLOCK_SIZE)
HASH_ALGO=$(env_get "$VERITY_ENV" VERITY_HASH_ALGO)
IMAGE_BYTES=$(env_get "$VERITY_ENV" IMAGE_BYTES)

if [ "$(env_get "$VERITY_ENV" VERITY_SALT)" != "$VERITY_SALT" ]; then
    echo "error: pack stage salt does not match the pinned VERITY_SALT" >&2
    exit 1
fi
img_bytes=$(stat -c %s "$IMG")
if [ "$img_bytes" != "$IMAGE_BYTES" ] || [ $((img_bytes % 4096)) -ne 0 ] || [ "$img_bytes" -eq 0 ]; then
    echo "error: $IMG is $img_bytes bytes, not a non-zero 4096-byte multiple matching IMAGE_BYTES=$IMAGE_BYTES" >&2
    exit 1
fi

total_mb=$(awk '/^TOTAL_MB/ {print $2}' "$REPORT")
if [ -z "$total_mb" ]; then
    echo "error: TOTAL_MB missing from $REPORT" >&2
    exit 1
fi
if [ "$total_mb" -gt "$SIZE_BUDGET_MB" ]; then
    echo "error: installed size ${total_mb} MB exceeds budget ${SIZE_BUDGET_MB} MB" >&2
    exit 1
fi
echo "installed size: ${total_mb} MB (budget ${SIZE_BUDGET_MB} MB)"

# THE BUILD COMMIT, beside the image it describes, and written only now that
# the image exists. The mosd and mos-apid binaries in this root came out of the
# pool, so the record comes from the producer that compiled them --
# pkgs/mosd/hack/build-deb.sh writes _out/mosd-build-<arch>.txt whenever it
# does -- and not from pkgs/mosd/hack/build-target.sh, which compiles a set
# nothing here installs and therefore no longer writes one.
#
# WHAT THE SMOKE RUN THEN ASSERTS, said plainly because it is easy to over-read.
# The two sides are the string COMPILED INTO the binary in the packed root, read
# back by executing it, and the string that producer run WROTE TO DISK -- and
# both descend from one `MOS_BUILD_COMMIT` in one build-deb.sh invocation. So it
# is not evidence that the commit is correct. Nothing a reader of an image could
# do would be, which is why comparing against `git rev-parse HEAD` at run time is
# refused by name in verify/src/smoke.ts.
#
# What it IS evidence of is the one gap the pool checks above cannot see. Those
# refuse an archive built from another tree -- by stamp, and by SHA256SUMS over
# the pool -- but they read the archive's NAME and its bytes, never what was
# compiled into the binary inside it. This closes the distance between "the
# producer was told to embed X" and "the binary in the image reports X": a
# compile cargo did not re-run for a changed environment variable, an
# `option_env!` that resolved to nothing so the binary says `unknown`, a stage
# that installed a binary from somewhere other than the package. Each of those
# ships an archive every check upstream accepts, and turns the version rows red
# only here.
if declined mosd; then
    echo "mosd: declined, so this root carries no mosd or mos-apid and no build commit is recorded for it"
else
    MOSD_BUILD_SRC="$PACKAGE_SOURCE/_out/mosd-build-$MOS_ARCH.txt"
    [ -s "$MOSD_BUILD_SRC" ] || {
        echo "error: $MOSD_BUILD_SRC is missing or empty, so the commit the mosd and mos-apid in this root" >&2
        echo "       were built from cannot be recorded beside it, and the smoke run would report that it" >&2
        echo "       asserted nothing about the commit -- which is the state this refusal exists to end." >&2
        echo "       pkgs/mosd/hack/build-deb.sh writes it every time it compiles them. The pool above" >&2
        echo "       passed the stamp check, so a pool with those packages and no record beside it is one" >&2
        echo "       that was carried in from another tree rather than built here." >&2
        echo "       Build it with: make os-debs" >&2
        exit 1
    }
    cp "$MOSD_BUILD_SRC" "$OUT_DIR/mosd-build.txt"
    echo "mosd: build commit $(sed -n 's/^commit\t//p' "$OUT_DIR/mosd-build.txt") recorded from $MOSD_BUILD_SRC"
fi

# The smoke run, and it is part of the build. A wrong-arch, missing-soname or
# version-skewed binary must fail the build, so every self-built binary is
# executed inside the base rootfs before an image ships it. That is this line:
# an image that ships them unexecuted looks exactly like one whose smoke run
# passed.

# It is here rather than in the Makefile because two make targets run this
# script, so does the CI deep lane, and anyone can run it directly; a step
# wired into the callers would be three copies to keep in step and would be
# bypassed by the fourth. The root is not handed to an assembler, to a bundle,
# or to a person, without its binaries having been executed.

# No skip and no opt-out: a flag that turned this off would make "the build
# passed" mean two things. `set -e` is what makes it a gate -- run.sh exits
# with the runner's own status, and a non-zero status here ends the build
# before $OUT_DIR is handed on. It adds no dependency this script did not
# already have: run.sh --smoke needs docker, which this script has needed since
# the first buildx line, and it needs to execute the target platform. When the
# daemon cannot, the runner executes inside the builder named here -- the one
# that just built the root, so it can execute what it built -- through one
# throwaway build per artifact. Same register, same judging, and the runner
# says which executor it used.
echo
echo "=== smoke: executing the self-built binaries inside the root just packed ==="
MOS_BOARD="$MOS_BOARD" bash "$REPO_ROOT/verify/run.sh" --smoke --board "$MOS_BOARD" --builder "${BUILDER}"
