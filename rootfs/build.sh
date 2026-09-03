#!/usr/bin/env bash
# Build the squashfs + dm-verity arm64 rootfs slot image for cx3576 (A/B layout).
# Usage: [BOARD_DIR=...] [WITH_MOSD=0|1]
#        [WITH_CONTAINERS=0|1] [MOS_PROFILE=dev|prod]
#        [MOS_ROOTFS_WITHOUT="wifi bluetooth rauc mqtt ..."] bash rootfs/build.sh

# There is deliberately no ROOT_PASSWORD here. A mos rootfs is a signed,
# byte-identical squashfs and the pack stage fails any build whose factory
# shadow carries a usable hash, so a baked mos root password is unbuildable by
# design, not merely discouraged. Dev root access on mos is the transient
# password set at runtime through mosd (SetTransientRootPassword; cleared on
# the next boot by mos-shadow-reconcile) plus the serial console, whose root
# account stays locked until that password is set. See
# docs/design/access.md section 4.1.

# Outputs (all under _out/<board>/). The first four are consumed by the image
# assembler, build/src/mkimage-cx3576.ts and mkimage-x64.ts:
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
#     copied from _out/mosd-build.txt. NOT copied into the image. Removed when
#     mosd is declined; see below.
# rootfs/README.md, "Outputs to _out/<board>/", is the table version of this.

# Every layout constant is read from boards/cx3576/board.env.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
# MOS_BOARD selects the layout, the output directory and the architecture.
# cx3576 is the default and its path is unchanged; x64 is the QEMU target, and
# it exists so that the two things the arm64 build CANNOT prove -- a container
# actually starting, and containers.conf's values taking effect -- have
# somewhere to be proven before hardware.
MOS_BOARD=${MOS_BOARD:-cx3576}
case "$MOS_BOARD" in
cx3576)
    MOS_ARCH=arm64
    ;;
x64)
    MOS_ARCH=amd64
    ;;
*)
    echo "error: MOS_BOARD is '$MOS_BOARD'; known boards are cx3576 and x64" >&2
    exit 1
    ;;
esac
DOCKER_PLATFORM="linux/${MOS_ARCH}"
LAYOUT_ENV="$REPO_ROOT/boards/${MOS_BOARD}/board.env"
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
# The declined features, as one list. WITH_CONTAINERS and WITH_MOSD are the
# two historical spellings and they fold into it here, so there is one answer
# to "is this feature in the image" and every consumer below asks the same
# question. MOS_ROOTFS_WITHOUT is the general form -- a space-separated list of
# feature names -- and it is what makes the three features with no WITH_*
# history (wifi, bluetooth, rauc, mqtt) reachable from the shipping path at all.

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

if [ ! -f "$LAYOUT_ENV" ]; then
    echo "error: $LAYOUT_ENV not found" >&2
    exit 1
fi
# shellcheck source=../boards/cx3576/board.env
. "$LAYOUT_ENV"

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
# root. It was three until PLAN-073, the third being the initrd that Debian's
# kernel postinst built under 10-compose's declared SOURCE_DATE_EPOCH; there is
# no initrd on either board now. Deliberately the same number and not separate
# pinned constants -- the squashfs and the OCI image are two encodings of one
# tree, and a second epoch would be a second answer to "when was this root made"
# that nothing would reconcile. The assembler spells it this way for mkimage's SOURCE_DATE_EPOCH.
SQUASHFS_TIME=${FILE_MTIME#@}

mkdir -p "$OUT_DIR"

# REMOVED ON EVERY BUILD, and nothing on this path writes it back. The mosd and
# mos-apid binaries in a composed root are compiled by
# pkgs/mosd/hack/build-deb.sh, which embeds the commit and does NOT write
# _out/mosd-build.txt -- so the smoke runner takes its printed-only branch and
# says on its own first lines that the commit was not asserted. That is a real
# gap and it is visible; what it must not become is a stale record left by an
# older build being asserted against binaries that came out of a package.
rm -f "$OUT_DIR/mosd-build.txt"

# Read-only root wiring. The overlay tree is copied into the build context with
# its *.in templates rendered from the layout env, so the shipped image carries
# no placeholder and the Dockerfile carries no layout constant.
#
# THE COMPOSITION DOES NOT INSTALL FROM THIS TREE -- mos-system and
# mos-board-<board> carry these bytes as package payload, rendered inside their
# own producers from the same board.env. It is staged anyway for two things
# that are not package content: the repart-definition count checked against the
# layout below, and the RAUC keyring, which is per-build trust material that no
# package may ever carry.
# PARTUUID values are lowercased: udev derives /dev/disk/by-partuuid/ symlinks
# from libblkid, which formats GUIDs in lowercase, and systemd's fstab-generator
# resolves PARTUUID= through those symlinks without normalising case.
OVERLAY_SRC="$SCRIPT_DIR/overlay"
OVERLAY_STAGE="$OUT_DIR/overlay"

# The RAUC system.conf is rendered from pkgs/rauc/system.conf.in and the
# layout env by pkgs/rauc/render-config.sh, which owns that template and
# its assertions (the statusfile must not land on /var, the boot-attempts radix
# range, and the fw_env.config structure). It is generated rather than
# committed: a rendered artifact in git can drift from its template, and a
# --check can only report that drift after the fact, not prevent it. Rendering
# it here, on the build path that consumes it, makes the template the single
# source of truth. The renderer writes into OVERLAY_SRC, so it must run before staging.
MOS_BOARD="$MOS_BOARD" bash "$REPO_ROOT/pkgs/rauc/render-config.sh"

rm -rf "$OVERLAY_STAGE"
mkdir -p "$OVERLAY_STAGE"
cp -a "$OVERLAY_SRC/." "$OVERLAY_STAGE/"

# Per-board overlay, layered on top of the shared one. Only files that are
# wrong on another board belong here -- x64's ESP mount unit is one, because
# RAUC's grub backend edits a file and the U-Boot backend edits a raw
# partition, so /boot is a mountpoint on exactly one of the two boards.
# Layered rather than selected: everything both boards share stays in one
# place, so a change to it cannot reach one board and miss the other.

# The status indicator is a board file. It is not in overlay and is deleted
# here for boards that declare no LED: the shared overlay would otherwise claim
# every board has an indicator and the truth would live in a conditional
# somewhere else. boards/cx3576/overlay/ carries mos-status-led, its unit
# and its wants symlink, so the file's location is the fact.
# BOARD_HAS_STATUS_LED stays, because the verifier still needs to know which
# outcome to assert -- present and enabled, or absent entirely.

BOARD_OVERLAY_SRC="$REPO_ROOT/boards/$MOS_BOARD/overlay"
if [ -d "$BOARD_OVERLAY_SRC" ]; then
    cp -a "$BOARD_OVERLAY_SRC/." "$OVERLAY_STAGE/"
    echo "overlay: layered $(find "$BOARD_OVERLAY_SRC" -type f | wc -l) board-specific file(s) from boards/$MOS_BOARD/overlay"
fi
if [ ! -s "$OVERLAY_STAGE/etc/rauc/system.conf" ]; then
    echo "error: pkgs/rauc/render-config.sh produced no system.conf to stage" >&2
    exit 1
fi

# The RAUC keyring inside the signed read-only root is a trusted signer on every
# device flashed with this image, so it enters the build from ONE place: the
# repository-root ca/, the same trust root build signs bundles with. That is
# what lets a released image install the releases it is shipped alongside.
#
# The overlay is not that place, and no flag makes it one. rootfs/overlay/
# is copied wholesale into the root, so a keyring left there once reaches every
# later image by being FORGOTTEN -- exactly the way a trust root must never
# arrive. The refusal was waivable once, when dropping a file here was the only
# way to get a development CA into a bench image; ca/ is that way now, so a
# waiver would only reintroduce a second source.
if [ -e "$OVERLAY_STAGE/etc/rauc/keyring.pem" ]; then
    echo "error: $OVERLAY_SRC/etc/rauc/keyring.pem exists; refusing to stage it into the image." >&2
    echo "A keyring baked into the signed root makes every flashed device trust that CA's bundles, and the overlay is copied wholesale into every image, so a file left here is a trust root nobody chose. The image's keyring is staged from the repository-root ca/ instead -- delete this file and put the CA you want in ca/ (pkgs/rauc/gen-dev-keys.sh writes a development-grade one when ca/ is empty)." >&2
    exit 1
fi

# ca/ absent is not fatal: the generator makes a development-grade trust root
# and says so loudly, and the build carries on. --if-absent so a ca/ that is
# already there -- production material or a root generated by an earlier run --
# is left exactly as it is and prints nothing.
CA_DIR="$REPO_ROOT/ca"
bash "$REPO_ROOT/pkgs/rauc/gen-dev-keys.sh" --if-absent
if [ ! -s "$CA_DIR/ca.cert.pem" ]; then
    echo "error: $CA_DIR/ca.cert.pem is missing or empty after pkgs/rauc/gen-dev-keys.sh --if-absent." >&2
    echo "The image cannot be built without the CA it must trust; ca/ is the one place it comes from." >&2
    exit 1
fi
mkdir -p "$OVERLAY_STAGE/etc/rauc"
cp "$CA_DIR/ca.cert.pem" "$OVERLAY_STAGE/etc/rauc/keyring.pem"
chmod 0644 "$OVERLAY_STAGE/etc/rauc/keyring.pem"
echo "overlay: staged etc/rauc/keyring.pem from ca/ca.cert.pem"

# Whether that CA is development-grade is not guessed from the bytes. The
# generator leaves ca/GENERATED beside what it wrote and production material
# arrives without it, so the marker answers the question on every later build
# and not only on the one that generated. The marker is the whole condition:
# there is no build-time variable that declares a bench image, because dev and
# production take the same path through ca/ and CI decides which material is
# there. verify reads the same marker and reports the same fact.
if [ -e "$CA_DIR/GENERATED" ]; then
    echo "############################################################"
    echo "# WARNING: this image trusts a DEVELOPMENT RAUC keyring    #"
    echo "# at etc/rauc/keyring.pem, staged from ca/ca.cert.pem.     #"
    echo "# Every device flashed with it trusts every bundle that    #"
    echo "# CA signs. Never flash this image onto anything that      #"
    echo "# leaves your desk. For a release, put real production     #"
    echo "# material in ca/ -- without ca/GENERATED beside it.       #"
    echo "############################################################"
fi

lower() { echo "$1" | tr 'A-Z' 'a-z'; }
render() {
    local src="$1" dst="$2"
    shift 2
    local expr=()
    while [ "$#" -gt 0 ]; do
        expr+=(-e "s|@$1@|$2|g")
        shift 2
    done
    sed "${expr[@]}" "$src" > "$dst"
    rm -f "$src"
    if grep -q '@[A-Z_]\+@' "$dst"; then
        echo "error: unrendered placeholder left in $dst" >&2
        exit 1
    fi
}

# Storage tiers. /mnt/data (DATA) is the only filesystem that grows;
# /var (EPHEMERAL) is fixed-size disposable residue and must NOT carry
# x-systemd.growfs.

# The DATA constants are required, not optional. A fallback for a missing one
# would not fail: it would quietly emit a nine-partition rootfs with /var
# growing and no DATA mount, and every downstream check would pass. All four are
# demanded even though only DATA_GUID is read here, because the assembler needs
# the other three, and a rootfs built against half a layout is the kind of
# artifact that reaches hardware before anyone notices.
missing=""
for key in DATA_GUID DATA_PARTNUM DATA_FS_UUID MOS_VAR_MIB; do
    eval "value=\${$key:-}"
    [ -n "$value" ] || missing="$missing $key"
done
if [ -n "$missing" ]; then
    echo "error: $LAYOUT_ENV is missing:$missing" >&2
    echo "The DATA partition (/mnt/data) and the fixed /var size are part of the A/B layout;" >&2
    echo "a rootfs built without them would silently ship the superseded" >&2
    echo "nine-partition arrangement. Restore the constants in $LAYOUT_ENV." >&2
    exit 1
fi

DATA_LINE="PARTUUID=$(lower "$DATA_GUID")	/mnt/data	ext4	noatime,x-systemd.growfs	0	2"
VAR_OPTS="noatime"

# The repart definition count must equal the number of linux-generic partitions
# on the disk, or repart silently attaches the grow flag to the wrong one — and
# an unmatched definition does not fail, it makes repart CREATE a partition.
# The count is DERIVED from the layout, not written down. systemd-repart pairs
# definitions with existing partitions in order by Type, so the invariant is
# "one definition per linux-generic partition this board actually has" -- and
# a literal 8 was the cx3576 number, which the x64 build satisfied with two
# definitions for U-Boot partitions it does not have. Every partition then got
# the definition meant for the one before it, DATA did not grow, and repart
# reported success.
want_defs=$(grep -c "^[A-Z0-9_]*_TYPECODE=$TYPECODE_LINUX\$" "$LAYOUT_ENV")
have_defs=$(find "$OVERLAY_STAGE/etc/repart.d" -name '*.conf' | wc -l)
if [ "$have_defs" -ne "$want_defs" ]; then
    echo "error: $have_defs repart definitions staged, but $LAYOUT_ENV declares $want_defs partitions of type $TYPECODE_LINUX. systemd-repart matches definitions to partitions IN ORDER, so a mismatch does not fail — it shifts every definition onto the wrong partition and creates new ones for the remainder" >&2
    exit 1
fi
# `|| true` because zero matches must reach the diagnostic below: grep -l
# exits 1 when nothing matches, and under set -e/pipefail that killed the run
# before the "expected exactly 1" message could say what was missing.
grow_defs=$({ grep -l '^Weight=1000$' "$OVERLAY_STAGE"/etc/repart.d/*.conf || true; } | wc -l)
if [ "$grow_defs" -ne 1 ]; then
    echo "error: $grow_defs repart definitions carry Weight=1000, expected exactly 1" >&2
    exit 1
fi
echo "layout: DATA present -> /mnt/data grows, /var fixed"
echo "layout: $have_defs repart definitions, 1 of them growing"

if [ -f "$OVERLAY_STAGE/etc/systemd/system/boot.mount.in" ]; then
    render "$OVERLAY_STAGE/etc/systemd/system/boot.mount.in" \
           "$OVERLAY_STAGE/etc/systemd/system/boot.mount" \
        ESP_GUID "$(lower "$ESP_GUID")"
fi

render "$OVERLAY_STAGE/etc/fstab.in" "$OVERLAY_STAGE/etc/fstab" \
    EPHEMERAL_GUID "$(lower "$EPHEMERAL_GUID")" \
    STATE_GUID "$(lower "$STATE_GUID")" \
    META_GUID "$(lower "$META_GUID")" \
    VAR_OPTS "$VAR_OPTS" \
    DATA_LINE "$DATA_LINE"

# fw_env.config is U-Boot's environment configuration and it is NOT rendered on
# x64: there is no U-Boot there, and the file names two partitions the QEMU
# layout does not create. Shipping it anyway would put a configuration file in
# the image describing storage that does not exist -- readable, plausible, and
# wrong, which is the shape of defect this repo keeps finding.
if [ "$MOS_ARCH" = "amd64" ]; then
    rm -f "$OVERLAY_STAGE/etc/fw_env.config.in"
else
    render "$OVERLAY_STAGE/etc/fw_env.config.in" "$OVERLAY_STAGE/etc/fw_env.config" \
        UENV_A_GUID "$(lower "$UENV_A_GUID")" \
        UENV_B_GUID "$(lower "$UENV_B_GUID")" \
        UENV_SIZE_HEX "$(printf '0x%x' "$UENV_SIZE_BYTES")"
fi

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
POOL_DIR="$REPO_ROOT/_out/debs/$MOS_ARCH"
COMPOSE_RAUC_VERSION=""
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
    pool_refusal "$POOL_DIR/manifest.txt carries more than one git stamp: $pool_stamp. The pool carries one stamp across every producer by rule; two stamps mean it was half-rebuilt across a tree change."
    ;;
esac
tree_version=$(bash "$REPO_ROOT/build-env/deb/version.sh")
tree_stamp=${tree_version##*+}
[ "$pool_stamp" = "$tree_stamp" ] ||
    pool_refusal "the $MOS_ARCH pool was built at stamp '$pool_stamp' and this tree is '$tree_stamp'. Composing would install another commit's packages into an image every check downstream would attribute to this one; a '.dirty' suffix on either side means uncommitted changes when that side was made."
echo "pool: $POOL_DIR, $pool_debs archive(s) at stamp $pool_stamp"

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
tree_commit_date=$(git -C "$REPO_ROOT" show -s --format=%cI "${commit_of_stamp}^{commit}" 2>/dev/null || true)
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
    --without "$WITHOUT_ARG")
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

# The RAUC upstream version, for the finalizer's build report. The pin in
# pkgs/rauc/versions.env is the same value verify's smoke register
# requires the rauc binary in the image to REPORT, so this is not a second
# source of truth for it -- it is the one the smoke run checks the binary
# against. On the chain path the same number travels with the binary in
# out-<arch>/RAUC_VERSION.env, which the composer must not read: that
# directory is the SOURCE build's output and the composer installs from the
# pool.
if ! declined rauc; then
    COMPOSE_RAUC_VERSION=$(sed -n 's/^RAUC_VERSION=//p' "$REPO_ROOT/pkgs/rauc/versions.env" | tail -n1)
    [ -n "$COMPOSE_RAUC_VERSION" ] ||
        { echo "error: pkgs/rauc/versions.env declares no RAUC_VERSION. The finalizer records it in rootfs-report.txt and build/src/bundle.ts refuses to build a bundle whose rauc differs from it; an empty value makes that comparison pass by finding nothing" >&2; exit 1; }
fi

mkdir -p "$COMPOSE_STAGE"
printf '%s\n' "$RESOLVED" > "$COMPOSE_STAGE/packages.txt"
cp "$OVERLAY_STAGE/etc/rauc/keyring.pem" "$COMPOSE_STAGE/keyring.pem"
echo "compose: $resolved_n package(s) resolved for $MOS_BOARD/$MOS_PROFILE, declined:${MOS_ROOTFS_WITHOUT:- (none)}"
sed 's/^/  /' "$COMPOSE_STAGE/packages.txt"

# The builder is NAMED rather than inherited -- the same BUILDX_BUILDER
# register as pkgs/rauc/build.sh and pkgs/podman/build.sh, and the same
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
    MOS_IMAGE_DEBIAN_TRIXIE=IMAGE_DEBIAN_TRIXIE \
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
    --arg RAUC_VERSION="$COMPOSE_RAUC_VERSION"
)

# TWO DOCKERFILES, not one build. build/run.sh --build-rootfs sequences the
# *.Dockerfile files in --stages-dir in numeric order, handing each one's image
# to the next: 10-compose installs the resolved package set, and 90-pack closes
# and packs what it produced. Everything above this line -- the resolved package
# set, the layout checks, the verity parameters -- is this script's job. The
# driver decides only the order, the tags and which argument reaches which file,
# and it refuses an argument no file declares rather than letting docker warn
# about it.
echo "rootfs: composing $MOS_BOARD"
if ! bash "$REPO_ROOT/build/run.sh" --build-rootfs \
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
if [ "$img_bytes" != "$IMAGE_BYTES" ] || [ $((img_bytes % MIB_BYTES)) -ne 0 ] || [ "$img_bytes" -eq 0 ]; then
    echo "error: $IMG is $img_bytes bytes, not a non-zero whole-MiB multiple matching IMAGE_BYTES=$IMAGE_BYTES" >&2
    exit 1
fi

# Kernel cmdline, one per slot. dm-init (CONFIG_DM_INIT=y, kernel 6.1.115)
# builds the verity device before the root mount with no initramfs. Both the
# data and the hash device are the same partition -- the hash tree is appended
# to the squashfs -- so the same PARTUUID appears twice, and <hash_start_block>
# tells the target where the tree begins. dm-init resolves PARTUUID= through
# dm_get_dev_t -> name_to_dev_t -> devt_from_partuuid (case-insensitive),
# verified against the vendor tree; see docs/design/ro-root.md.

# dm-mod.waitfor= is MANDATORY, not an optimisation. dm_init_init runs at
# late_initcall and its wait_for_device_probe() does not cover eMMC card
# discovery, which happens on a delayed workqueue; without the wait the verity
# table is built before the partitions exist, so the boot breaks intermittently
# rather than cleanly. The assembler rejects a cmdline file that lacks it.

# The GUID is lowercased, the same form used in /etc/fstab and the same form
# udev gives /dev/disk/by-partuuid/ (libblkid formats GUIDs lowercase). The
# kernel compares with strncasecmp and accepts either, so one canonical
# lowercase spelling everywhere is the least surprising choice. The assembler
# cross-checks this table against ${ROOTFS_x_GUID}, which the layout env holds
# uppercase, comparing case-insensitively. Do not "fix" anything by
# uppercasing this: lowercase is what udev and fstab use.
write_cmdline() {
    local out="$1" guid="$2"
    local partuuid
    partuuid="PARTUUID=$(lower "$guid")"
    printf '%s\n' "dm-mod.create=\"rootfs,,,ro,0 ${DATA_SECTORS} verity 1 ${partuuid} ${partuuid} ${DATA_BLOCK_SIZE} ${HASH_BLOCK_SIZE} ${DATA_BLOCKS} ${HASH_START_BLOCK} ${HASH_ALGO} ${ROOT_HASH} ${VERITY_SALT}\" dm-mod.waitfor=${partuuid} root=/dev/dm-0 rootfstype=squashfs ro rootwait ${BOARD_CMDLINE_ARGS}" > "$out"
}
write_cmdline "$OUT_DIR/boot-cmdline-a.txt" "$ROOTFS_A_GUID"
write_cmdline "$OUT_DIR/boot-cmdline-b.txt" "$ROOTFS_B_GUID"

echo
echo "=== rootfs-report.txt ==="
cat "$REPORT"
echo "=== rootfs-verity.env ==="
cat "$VERITY_ENV"
echo "=== boot-cmdline-a.txt ==="
cat "$OUT_DIR/boot-cmdline-a.txt"
echo "=== image: $IMG ($img_bytes bytes, $((img_bytes / MIB_BYTES)) MiB) ==="

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
