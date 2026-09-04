#!/bin/sh
# Install the resolved package set out of the local pool, and prove what landed.
#
# Called from rootfs/compose/10-compose.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: MOS_ARCH, MOS_BOARD, MOS_PROFILE,
# MOS_RELEASE_VERSION, MOS_RELEASE_COMMIT_DATE, RAUC_VERSION,
# SOURCE_DATE_EPOCH.
#
# Bind mounts this reads: /mos-debs (the whole _out/debs tree) and /mos-compose
# (the host-staged packages.txt and meta-public/, the files out of meta/ that
# reach the image).
#
# NOTHING IS COMPILED HERE and nothing is downloaded from a network. Every mos
# package comes out of the pool `make os-debs` built; every Debian package comes
# out of the pinned base image's configured archive, which is what APT resolves
# the local packages' dependency closure against.

set -eu

fail() { echo "error: $*" >&2; exit 1; }

for v in MOS_ARCH MOS_BOARD MOS_PROFILE MOS_RELEASE_VERSION MOS_RELEASE_COMMIT_DATE SOURCE_DATE_EPOCH; do
    eval "value=\${${v}:-}"
    [ -n "${value}" ] ||
        fail "${v} is empty or unset in this build step. rootfs/compose/10-compose.Dockerfile declares it and rootfs/build.sh passes it; an unset one here is not a failure anyone sees -- SOURCE_DATE_EPOCH in particular would leave the wall clock and this host's inode numbers inside the initrd that ships in the verity-covered root"
done

POOL="/mos-debs/${MOS_ARCH}"
LIST=/mos-compose/packages.txt

# The pool, checked again HERE and not only on the host. rootfs/build.sh
# refuses a missing or stale pool before a container starts, with the make
# target that produces it; this is the statement that the bind mount actually
# delivered that pool rather than an empty directory -- which is how a bind
# mount of an unshared path behaves on this host, succeeding and carrying
# nothing.
[ -d "${POOL}" ] ||
    fail "${POOL} is not a directory inside the build. The pool is bind-mounted from _out/debs; build it with 'make os-debs'"
for f in Packages SHA256SUMS manifest.txt; do
    [ -s "${POOL}/${f}" ] ||
        fail "${POOL}/${f} is missing or empty, so this pool has no usable index. APT accepts an empty Packages file without complaint, which would install none of this repository's own packages and report success. Build the pool with 'make os-debs'"
done
POOL_N="$(grep -c '^Package: ' "${POOL}/Packages")"
[ "${POOL_N}" -gt 0 ] ||
    fail "${POOL}/Packages carries no stanza at all; every package named below would be unresolvable and APT would say so one name at a time"

# The resolution, as rootfs/packages/resolve.sh printed it: one name per
# line, sorted, no comments. Read rather than recomputed -- resolve.sh takes its
# inputs as arguments and rootfs/build.sh owns the decline logic.
[ -s "${LIST}" ] ||
    fail "${LIST} is missing or empty. It is the resolved package set and it is what this stage installs; an empty one composes a root holding nothing but Debian, and every check downstream would run over that"
WANT="$(tr '\n' ' ' <"${LIST}")"
WANT_N="$(grep -c . "${LIST}")"
[ "${WANT_N}" -gt 0 ] ||
    fail "${LIST} names no package"
echo "compose: ${MOS_BOARD} (${MOS_ARCH}), ${WANT_N} resolved package(s) against a pool of ${POOL_N}"

# EXACTLY ONE PROFILE PACKAGE, asserted where the set is handed to apt.
#
# rootfs/packages/resolve.sh already counts this over the resolution it
# prints, and tests/rootfs-manifest-test.sh drives both the two-package and
# the zero-package refusals, so the guarantee is structural upstream of here.
# This is NOT a second implementation of that rule: it is the check that the set
# which ARRIVED still has the property at the moment it is used. Anything
# between the resolver and this line -- the staging step, an edited
# packages.txt, a future caller that builds the list another way -- is the seam
# a boundary assertion exists to catch.
#
# What it costs to be wrong is asymmetric, which is why it is worth a line.
# Measured: with NO profile provider available APT refuses by name and installs
# nothing, but with BOTH available it picks one SILENTLY and exits 0 -- and it
# picked mos-profile-PROD. mosd fails closed to prod when the file is absent, so
# the zero case and the two-package case both end at an image that behaves as
# production while every check downstream reports green. The composer explicitly
# naming one profile is the only thing that keeps a dev image dev.
profile_n=0
profile_names=""
for p in ${WANT}; do
    case "${p}" in
    mos-profile-*)
        profile_n=$((profile_n + 1))
        profile_names="${profile_names} ${p}"
        ;;
    esac
done
[ "${profile_n}" -eq 1 ] ||
    fail "the set handed to apt names ${profile_n} profile package(s):${profile_names:- (none)}. Exactly one belongs in an image. With none, APT installs no profile file and mosd FAILS CLOSED to prod -- a dev build with SSH off and every check green; with two, they Conflict and APT picks one silently, and it was measured picking prod. rootfs/packages/resolve.sh refuses both cases over the resolution it prints, so reaching this means something between it and here changed the set"
echo "compose: exactly one profile package in the set handed to apt:${profile_names}"

# No maintainer script may start a service while the root is being assembled.
# invoke-rc.d and deb-systemd-invoke both consult this file and both treat 101
# as "do not run"; without it, a package whose postinst starts its unit would
# try to talk to a systemd that is not PID 1 in this container, and what that
# leaves behind depends on which package it was.
printf '%s\n' '#!/bin/sh' 'exit 101' >/usr/sbin/policy-rc.d
chmod 0755 /usr/sbin/policy-rc.d

# The temporary local source. `[trusted=yes]` because these archives are built
# by this repository three directories away and signing them would be this
# build verifying its own signature; `file:` because they are already on disk,
# and no network is involved in reaching them.
printf 'deb [trusted=yes] file:%s ./\n' "${POOL}" >/etc/apt/sources.list.d/mos-local.list
apt-get update

# ONE TRANSACTION. APT resolves the Debian and the local dependency closure
# together and configures them in an order derived from `Depends`, which is the
# whole point of PLAN-036 section 4: the chain's numbers were compensating for
# metadata that now exists. --no-install-recommends keeps the package set to
# what is declared, as every apt line in the chain does.
# shellcheck disable=SC2086 # deliberate: WANT is a list of package names.
apt-get install -y --no-install-recommends ${WANT}

# apt-get check parses the whole dpkg database and reports broken dependencies;
# dpkg --audit reports packages left half-installed or half-configured. Both are
# clean on a transaction that completed, and both are run because "apt exited 0"
# is a statement about apt rather than about the database it left behind.
apt-get check
audit="$(dpkg --audit 2>&1)" ||
    fail "dpkg --audit exited non-zero: ${audit}"
[ -z "${audit}" ] ||
    fail "dpkg --audit reports packages that are not fully installed: ${audit}"

# WHICH LOCAL PACKAGES ACTUALLY LANDED, asked of dpkg rather than assumed from
# the fact that apt exited 0. The two directions are different failures:
#
#  - a resolved package that is NOT installed would be a transaction apt
#    reported as done while leaving the image without it;
#  - a local package that IS installed and was never resolved is APT having
#    pulled one in through a Depends nobody named -- an image carrying a
#    component this build did not select, which is invisible afterwards because
#    an installed package looks the same however it got there.
#
# The candidate set is every package the POOL declares, read out of the index.
#
# Written under /mos-compose and NOT under /tmp. /tmp is image content until the
# finalizer replaces it, and the first version of this wrote /tmp/pool.names and
# left it there: the dual-build gate reported the file as an `added` path, which
# is how a build-time scratch file shipping inside a signed root gets noticed.
# /mos-compose is removed wholesale at the end of this script, and the assertion
# down there is what keeps /tmp empty for the next one.
sed -n 's/^Package: //p' "${POOL}/Packages" | LC_ALL=C sort -u >/mos-compose/pool.names
POOL_NAMES_N="$(grep -c . /mos-compose/pool.names)"
[ "${POOL_NAMES_N}" -gt 0 ] ||
    fail "no package name could be read out of ${POOL}/Packages, so the check below would compare the installed set against nothing and pass"

extra=""
local_n=0
while IFS= read -r p; do
    [ -n "${p}" ] || continue
    st="$(dpkg-query -W -f='${db:Status-Status}' "${p}" 2>/dev/null || true)"
    [ "${st}" = "installed" ] || continue
    local_n=$((local_n + 1))
    case " ${WANT} " in
    *" ${p} "*) ;;
    *) extra="${extra} ${p}" ;;
    esac
done </mos-compose/pool.names
[ -z "${extra}" ] ||
    fail "APT installed local package(s) that no manifest named:${extra}. Every one of them arrived through a Depends of something that WAS named, so the image carries a component this build did not select and nothing downstream can tell that from a deliberate choice. Either name it in rootfs/packages/ or fix the dependency that pulled it"

missing=""
for p in ${WANT}; do
    st="$(dpkg-query -W -f='${db:Status-Status}' "${p}" 2>/dev/null || true)"
    [ "${st}" = "installed" ] || missing="${missing} ${p}"
done
[ -z "${missing}" ] ||
    fail "resolved package(s) that are not installed after a transaction apt reported as successful:${missing}"

[ "${local_n}" -eq "${WANT_N}" ] ||
    fail "${local_n} local package(s) are installed and ${WANT_N} were resolved; the two lists agree on every name but not on their size, which cannot happen and means this check is reading the wrong thing"
TOTAL_N="$(dpkg-query -W -f='.\n' | grep -c .)"
echo "compose: ${local_n} local package(s) installed, ${TOTAL_N} packages in the root"

# THE PUBLIC SET OUT OF meta/ (PLAN-070 section 1.1): the files that leave the
# build host for the image, and nothing else. rootfs/build.sh stages them
# under /mos-compose/meta-public/ at the paths they take here, having first
# refused to stage anything off its allowlist or anything carrying private key
# material; verify checks the same paths over the assembled image, because
# a file can arrive by a route the staging step cannot see.
#
# THREE, not two. The RAUC keyring and the update configuration are REQUIRED --
# an image without either can verify nothing -- and the development-grade
# marker is CONDITIONAL: staged exactly when the tree's meta/GENERATED is
# there, which is exactly when the signing material is development-grade
# (PLAN-077 section 2). Its absence is not a gap, it is what a production image
# says about itself.
#
# None of them is in any package and none may be: rootfs/overlay is copied
# wholesale into mos-system's payload, so a keyring left there once would reach
# every later image by being forgotten. Installed here, on the composition path,
# one place per build, from what an operator put in meta/.
#
# EACH PATH IS NAMED rather than the staged tree being walked. A walk would
# install whatever was in the directory, which turns the allowlist in build.sh
# into a suggestion; naming them means a third public file is a reviewed line
# here as well as there.
#
# WHAT THAT COSTS, PAID ONCE ALREADY: the marker was added to build.sh's
# META_PUBLIC and the reviewed line here was never written, so it was audited,
# staged, copied into the build context and dropped -- and every image built
# from a development tree reported itself production to the publication gate.
# A line nobody writes leaves no diff for a reviewer to notice. So the named
# set is RECONCILED against the staged tree at the end of this block: still
# named, never walked into an install, but a staged file this script does not
# name now stops the build here instead of surfacing as a red verify over an
# image that has already been assembled.
META_INSTALLED=""
meta_install() {
    install -D -m 0644 "/mos-compose/meta-public/$1" "/$1"
    META_INSTALLED="${META_INSTALLED} $1"
}

[ -s /mos-compose/meta-public/etc/rauc/keyring.pem ] ||
    fail "/mos-compose/meta-public/etc/rauc/keyring.pem is missing or empty. It is staged from meta/rauc/ca.cert.pem and it is what every device flashed with this image trusts RAUC bundles from; an image without it can install no update at all"
meta_install etc/rauc/keyring.pem

[ -s /mos-compose/meta-public/usr/share/mos/meta/updates/manifest.json ] ||
    fail "/mos-compose/meta-public/usr/share/mos/meta/updates/manifest.json is missing or empty. It is staged from meta/updates/manifest.json and it is where this image says which server its updates come from, on which channel and against which package signing key; an image without it has no configuration to read and no anchor to check a package against"
meta_install usr/share/mos/meta/updates/manifest.json

# THE DEVELOPMENT-GRADE MARKER, whose ABSENCE IS THE SUPPORTED STEADY STATE and
# not an error. The two refusals above are the right shape for a required file
# and the wrong shape for this one: "missing -> fail" here would refuse every
# build made on production material, which is every release build.
#
# The condition read is the STAGED tree and nothing else. rootfs/build.sh has
# already enforced tree -> staged (the conditional entry is staged iff meta/
# carries it, and B1 counts what was resolved), and verify's
# packed-meta-is-the-public-set enforces tree -> image in both directions. So
# this step's job is staged -> image, exactly, and reading meta/ from in here
# would be reading a directory this container cannot see.
#
# STAGED AND EMPTY IS STILL AN ERROR, and it is the one case worth a line:
# build.sh treats an empty source as absent and never stages it, so a zero-byte
# or non-regular file at this path is one that was damaged between that audit
# and here -- and a marker that states nothing would be baked into the verity
# root as though it stated the grade.
#
# BOTH DISPOSITIONS ARE ANNOUNCED. This is the only member of the set whose
# correct behaviour includes doing nothing, and in a log a silent nothing reads
# exactly like the line that was never written.
META_MARKER=/mos-compose/meta-public/usr/share/mos/meta/GENERATED
if [ -e "${META_MARKER}" ]; then
    { [ -f "${META_MARKER}" ] && [ -s "${META_MARKER}" ]; } ||
        fail "${META_MARKER} exists and is empty or is not a regular file. rootfs/build.sh stages meta/GENERATED only when it has content and refuses a staged path that is not a regular file, so this is not the tree it audited; the marker is what says the signing material behind this image is development-grade, and an unreadable one is baked into the dm-verity root saying nothing"
    meta_install usr/share/mos/meta/GENERATED
    echo "compose: /usr/share/mos/meta/GENERATED installed -- this image was built on DEVELOPMENT-GRADE signing material, it reports that grade on GET /api/v1/system/info, and the release gate refuses to publish it to candidate or stable"
else
    echo "compose: no /usr/share/mos/meta/GENERATED -- meta/ carries no development-grade marker, so this image states production-grade signing material by shipping none. Not an error: that is what a production build looks like"
fi

# THE NAMED SET RECONCILED AGAINST THE STAGED SET, which is the safeguard the
# comment above costs. Every file build.sh staged was named on one of the lines
# above or it was not, and one that was not is a public-set entry that reached
# this build and stopped here: audited, copied, and then dropped, with every
# build-side check still reporting it as staged.
#
# NOT A WALK-INSTALL. Nothing is installed because it was found; the staged
# tree decides only whether this build STOPS. The allowlist in build.sh and the
# named lines above remain the two reviewed places a public file passes through.
meta_unnamed=""
for staged in $(find /mos-compose/meta-public -mindepth 1 ! -type d | sort); do
    rel="${staged#/mos-compose/meta-public/}"
    case " ${META_INSTALLED} " in
    *" ${rel} "*) ;;
    *) meta_unnamed="${meta_unnamed} ${rel}" ;;
    esac
done
[ -z "${meta_unnamed}" ] ||
    fail "rootfs/build.sh staged public-set file(s) this script installs nowhere:${meta_unnamed}. Each member of the set is named on its own line here, so a staged file with no line is an entry that was added to META_PUBLIC and not here -- it is audited and copied into the build and then dropped, and the image ships without it while the build log reports it staged. Add the line, or take the entry out of META_PUBLIC"
echo "compose: $(echo ${META_INSTALLED} | wc -w) public-set file(s) installed from meta/ --${META_INSTALLED}"

# THE DEVICE IDENTITY, /usr/share/mos/release-identity.env: the file
# `rauc-update` reads to decide which published release is for this device
# (board, profile) and whether one is newer than what is running (version).
# Three facts about THIS BUILD, which is why no package carries them: an
# archive is built once per architecture and installed into images of several
# boards and profiles, and the version it would have to state is the pool's
# rather than its own.
#
# HERE, on the composition path, and from build arguments only: no wall clock,
# no git, nothing read back out of the image. rootfs/build.sh passes
# MOS_BOARD and MOS_PROFILE -- the same two values it hands the resolver -- and
# MOS_RELEASE_VERSION, which is `bash build-env/deb/version.sh`'s answer for
# this tree, the same string it has already required the POOL to have been
# built at. So the identity moves with the pool the packages came out of, and
# the finalizer's /usr/share/mos/manifest.tsv, taken from the same dpkg
# database a few steps later, carries that version on every first-party row.
#
# MOS_RELEASE_COMMIT_DATE arrives the same way, and it is what mosd reports as
# `system.commitDate`. It is the date of the commit INSIDE the version above --
# build.sh reads it out of the stamp it has already checked the pool against,
# so the two cannot come to name different commits -- and it is the one date in
# this root that a rebuild reproduces AND that says when the source was
# written. Every file time here is SOURCE_DATE_EPOCH, which is a constant, so
# without this line the only date an image could offer is one that is identical
# in every image ever built.
#
# The version, checked against a package that actually landed rather than
# taken on trust. build.sh's pool-stamp refusal is upstream of this and covers
# the tree-versus-pool case; what this covers is the seam between them -- an
# argument that arrived wrong, or a caller that composed the list another way
# -- and it is the same boundary-assertion reasoning as the profile count
# above. The upstream repacks (mos-podman, mos-rauc) carry their own upstream
# version in front of the shared stamp and are expected not to match; the
# first-party packages are.
identity_version_owner=""
for p in ${WANT}; do
    v="$(dpkg-query -W -f='${Version}' "${p}" 2>/dev/null || true)"
    [ "${v}" = "${MOS_RELEASE_VERSION}" ] || continue
    identity_version_owner="${p}"
    break
done
[ -n "${identity_version_owner}" ] ||
    fail "MOS_RELEASE_VERSION is '${MOS_RELEASE_VERSION}' and no package installed into this root carries that version. It is meant to be the version build-env/deb/version.sh printed for the tree the pool was built from, so a value no first-party package here shares means the identity file would state a release this image is not"

install -d -m 0755 /usr/share/mos
{
    printf '# What this device is, for rauc-update. Written by\n'
    printf '# rootfs/compose/compose-install.sh from the arguments of the build\n'
    printf '# that composed this image; the root is read-only, so nothing edits it.\n'
    printf 'BOARD=%s\n' "${MOS_BOARD}"
    printf 'PROFILE=%s\n' "${MOS_PROFILE}"
    printf 'VERSION=%s\n' "${MOS_RELEASE_VERSION}"
    printf 'COMMIT_DATE=%s\n' "${MOS_RELEASE_COMMIT_DATE}"
} >/usr/share/mos/release-identity.env
chmod 0644 /usr/share/mos/release-identity.env
echo "compose: release identity ${MOS_BOARD}/${MOS_PROFILE} at ${MOS_RELEASE_VERSION}, source committed ${MOS_RELEASE_COMMIT_DATE} (the version ${identity_version_owner} carries)"

# The build report's RAUC line. build/src/bundle.ts reads it back out of
# _out/<board>/rootfs-report.txt and refuses to build a bundle with a rauc
# whose version differs, so an empty value here would make that comparison pass
# by finding nothing. The finalizer consumes /rootfs-report.rauc and deletes it;
# it never reaches the image.
case " ${WANT} " in
*" mos-rauc "*)
    [ -n "${RAUC_VERSION:-}" ] ||
        fail "mos-rauc is in the resolution and RAUC_VERSION is empty. That value is the pin in pkgs/rauc/versions.env and it is what the bundle builder compares its own rauc against; empty makes that comparison pass by finding nothing"
    [ -x /usr/bin/rauc ] ||
        fail "mos-rauc is installed and /usr/bin/rauc is not there"
    printf '%s\n' "${RAUC_VERSION}" >/rootfs-report.rauc
    echo "compose: rauc ${RAUC_VERSION} recorded for the build report"
    ;;
*)
    echo "compose: rauc declined; no RAUC_VERSION recorded"
    ;;
esac

# NO INITRAMFS, asserted where the kernel and the root it must mount are
# finally in one tree together.
#
# This block used to assert the opposite. Until PLAN-074 x64 ran Debian's
# generic kernel, which has no CONFIG_DM_INIT and therefore ignored the
# dm-mod.create= verity table on the kernel command line; an initramfs
# re-implemented it, and what was checked here was that the initrd the kernel
# package's postinst had just built carried veritysetup and the local-top
# script. mos-kernel-x64 carries the device mapper, dm-verity and squashfs
# built in and reads that command line itself, so there is no initrd, no hook
# and no postinst run to get wrong.
#
# WHAT REPLACES IT IS NOT NOTHING. An absence proves itself only if something
# was there to look at, so this asserts three things rather than one: that the
# root carries exactly one kernel and the config it was built from, that the
# config declares the verity floor BUILT IN, and that no initrd file exists
# beside it. The first two are what would go red if Debian's kernel ever came
# back into this image -- its config has CONFIG_DM_INIT nowhere at all -- and
# the third is RFCT-281's guarantee in its stronger form: BusyBox cannot be an
# early-boot dependency of an image whose early boot has no userspace.
#
# Gated on a kernel being IN the root, which is an x64 fact: cx3576's kernel
# comes from its BSP and sits on the boot partition, so there is nothing here
# to look at. rootfs/scripts/pack-export-boot.sh makes the same assertions over
# what is EXPORTED; this one is earlier and names the cause.
if ls /boot/vmlinuz-* >/dev/null 2>&1; then
    kernels="$(ls /boot/vmlinuz-* | wc -l)"
    [ "${kernels}" = 1 ] ||
        fail "the composed root carries ${kernels} kernels in /boot. Which one the bootloader launches is not a question this composition can answer, and the assertions below would be about whichever sorted first"
    release="$(ls /boot/vmlinuz-* | sed 's|.*/vmlinuz-||')"
    [ -f "/boot/config-${release}" ] ||
        fail "the composed root carries /boot/vmlinuz-${release} and no /boot/config-${release} beside it. Nothing in the image then states how that kernel was configured, and the verity floor below cannot be read at all -- which is also what a distribution kernel installed by accident looks like"
    for option in DM_INIT BLK_DEV_DM DM_VERITY SQUASHFS; do
        grep -q "^CONFIG_${option}=y\$" "/boot/config-${release}" ||
            fail "/boot/config-${release} does not declare CONFIG_${option}=y. This board boots root=/dev/dm-0 from a dm-mod.create= table with no initramfs, so a kernel that has this as a module -- or, as Debian's amd64 kernel has CONFIG_DM_INIT, not at all -- assembles no root and hangs at rootwait with nothing on the console explaining why"
    done
    initrds="$(ls /boot/initrd.img-* /boot/initrd-* 2>/dev/null | tr '\n' ' ')"
    [ -z "${initrds}" ] ||
        fail "the composed root carries an initramfs: ${initrds}. Nothing here is supposed to build one -- the board ships no initramfs-tools hook and the bootloader passes no initrd -- so something reintroduced initramfs-tools and a kernel postinst that fires it, and early boot has grown a userspace this image does not verify"
    echo "compose: kernel ${release} carries the verity floor built in and the root has no initramfs (${kernels} kernel, 0 initrd)"
else
    echo "compose: no kernel in /boot; this board's bootloader is given its kernel by the BSP build"
fi

# Everything the composition brought in that the device must not carry. The
# package-manager purge in the finalizer takes /etc/apt wholesale, so the
# source file below is belt and braces; policy-rc.d lives in /usr/sbin, which
# the purge does not sweep, and would ship as a file that makes every
# invoke-rc.d on the device refuse.
rm -f /usr/sbin/policy-rc.d /etc/apt/sources.list.d/mos-local.list
rm -rf /mos-compose /var/lib/apt/lists/* /var/cache/apt/archives
[ ! -e /usr/sbin/policy-rc.d ] ||
    fail "policy-rc.d survived; the image would refuse every invoke-rc.d on the device"

# /tmp is IMAGE CONTENT until the finalizer replaces it, so a scratch file left
# here ships in the signed root. This is not hypothetical: the first composed
# root carried /tmp/pool.names, and the dual-build gate reported it as an
# `added` path. The count is printed rather than the check being silent,
# because "nothing was left" and "nothing was looked at" are the same output
# otherwise.
tmp_left="$(find /tmp -mindepth 1 | wc -l)"
[ "${tmp_left}" -eq 0 ] ||
    fail "${tmp_left} path(s) are left under /tmp after composition: $(find /tmp -mindepth 1 | tr '\n' ' '). /tmp is image content here, so each one would ship inside the signed root"
echo "compose: /tmp is empty; no build-time scratch ships in the root"
