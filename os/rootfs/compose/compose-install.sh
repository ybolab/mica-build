#!/bin/sh
# Install the resolved package set out of the local pool, and prove what landed.
#
# Called from os/rootfs/compose/10-compose.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: MOS_ARCH, MOS_BOARD, RAUC_VERSION,
# SOURCE_DATE_EPOCH.
#
# Bind mounts this reads: /mos-debs (the whole _out/debs tree) and /mos-compose
# (the host-staged packages.txt and keyring.pem).
#
# NOTHING IS COMPILED HERE and nothing is downloaded from a network. Every mos
# package comes out of the pool `make os-debs` built; every Debian package comes
# out of the pinned base image's configured archive, which is what APT resolves
# the local packages' dependency closure against.

set -eu

fail() { echo "error: $*" >&2; exit 1; }

for v in MOS_ARCH MOS_BOARD SOURCE_DATE_EPOCH; do
    eval "value=\${${v}:-}"
    [ -n "${value}" ] ||
        fail "${v} is empty or unset in this build step. os/rootfs/compose/10-compose.Dockerfile declares it and os/rootfs/build-v2.sh passes it; an unset one here is not a failure anyone sees -- SOURCE_DATE_EPOCH in particular would leave the wall clock and this host's inode numbers inside the initrd that ships in the verity-covered root"
done

POOL="/mos-debs/${MOS_ARCH}"
LIST=/mos-compose/packages.txt

# The pool, checked again HERE and not only on the host. os/rootfs/build-v2.sh
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

# The resolution, as os/rootfs/packages/resolve.sh printed it: one name per
# line, sorted, no comments. Read rather than recomputed -- resolve.sh takes its
# inputs as arguments and os/rootfs/build-v2.sh owns the decline logic.
[ -s "${LIST}" ] ||
    fail "${LIST} is missing or empty. It is the resolved package set and it is what this stage installs; an empty one composes a root holding nothing but Debian, and every check downstream would run over that"
WANT="$(tr '\n' ' ' <"${LIST}")"
WANT_N="$(grep -c . "${LIST}")"
[ "${WANT_N}" -gt 0 ] ||
    fail "${LIST} names no package"
echo "compose: ${MOS_BOARD} (${MOS_ARCH}), ${WANT_N} resolved package(s) against a pool of ${POOL_N}"

# EXACTLY ONE PROFILE PACKAGE, asserted where the set is handed to apt.
#
# os/rootfs/packages/resolve.sh already counts this over the resolution it
# prints, and os/tests/rootfs-manifest-test.sh drives both the two-package and
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
    fail "the set handed to apt names ${profile_n} profile package(s):${profile_names:- (none)}. Exactly one belongs in an image. With none, APT installs no profile file and mosd FAILS CLOSED to prod -- a dev build with SSH off and every check green; with two, they Conflict and APT picks one silently, and it was measured picking prod. os/rootfs/packages/resolve.sh refuses both cases over the resolution it prints, so reaching this means something between it and here changed the set"
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
    fail "APT installed local package(s) that no manifest named:${extra}. Every one of them arrived through a Depends of something that WAS named, so the image carries a component this build did not select and nothing downstream can tell that from a deliberate choice. Either name it in os/rootfs/packages/ or fix the dependency that pulled it"

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

# The RAUC trust root, staged from the repository-root ca/ by
# os/rootfs/build-v2.sh, which is the single seam by which a CA enters a build.
# It is not in any package and must not be: os/rootfs/overlay-v2 is copied
# wholesale into mos-system's payload, so a keyring left there once would reach
# every later image by being forgotten. Installed here, on the composition path,
# for exactly the reason build-v2.sh stages it into the overlay on the chain
# path -- one place, per build, chosen by whoever filled ca/.
[ -s /mos-compose/keyring.pem ] ||
    fail "/mos-compose/keyring.pem is missing or empty. It is staged from ca/ca.cert.pem and it is what every device flashed with this image trusts RAUC bundles from; an image without it can install no update at all"
install -D -m 0644 /mos-compose/keyring.pem /etc/rauc/keyring.pem

# The build report's RAUC line. os/build/src/bundle.ts reads it back out of
# _out/<board>/rootfs-report-v2.txt and refuses to build a bundle with a rauc
# whose version differs, so an empty value here would make that comparison pass
# by finding nothing. The finalizer consumes /rootfs-report.rauc and deletes it;
# it never reaches the image.
case " ${WANT} " in
*" mos-rauc "*)
    [ -n "${RAUC_VERSION:-}" ] ||
        fail "mos-rauc is in the resolution and RAUC_VERSION is empty. That value is the pin in os/pkgs/rauc/versions.env and it is what the bundle builder compares its own rauc against; empty makes that comparison pass by finding nothing"
    [ -x /usr/bin/rauc ] ||
        fail "mos-rauc is installed and /usr/bin/rauc is not there"
    printf '%s\n' "${RAUC_VERSION}" >/rootfs-report.rauc
    echo "compose: rauc ${RAUC_VERSION} recorded for the build report"
    ;;
*)
    echo "compose: rauc declined; no RAUC_VERSION recorded"
    ;;
esac

# THE INITRAMFS, asserted where the kernel and the board's hook are finally in
# one root together. os/boards/x64/deb/board-x64/Dockerfile puts the assertion
# here by name: the package ships /etc/initramfs-tools/hooks/mos-verity and the
# local-top script, linux-image-amd64 arrives through its Depends, and it is
# that package's own postinst that runs update-initramfs. dpkg unpacks every
# archive before it configures any of them, so the hook is on disk when the
# kernel's postinst runs -- but nothing in either package states that, and
# without veritysetup in the initrd the boot stops at "ALERT! /dev/dm-0 does
# not exist", days after the build reported success.
#
# Gated on a kernel being IN the root, which is an x64 fact: cx3576's kernel
# comes from its BSP and sits on the boot partition, so there is nothing here to
# rebuild. os/rootfs/scripts/pack-export-boot.sh makes the same assertion over
# the EXPORTED initrd; this one is earlier and names the cause.
if ls /boot/vmlinuz-* >/dev/null 2>&1; then
    contents="$(lsinitramfs /boot/initrd.img-*)"
    [ -n "${contents}" ] ||
        fail "there is a kernel in /boot and its initramfs could not be read at all. A Debian initrd is a concatenation -- an uncompressed early cpio for microcode, then the compressed main archive -- so a reader built on zcat sees only the first and reports every file as missing"
    for want in usr/sbin/veritysetup scripts/local-top/mos-verity; do
        printf '%s\n' "${contents}" | grep -qx "${want}" ||
            fail "the composed initramfs does not contain ${want}. mos-board-${MOS_BOARD} ships the hook and the local-top script under /etc/initramfs-tools and linux-image arrives through its Depends, so update-initramfs ran from the kernel package's postinst BEFORE the hook was unpacked -- which is a dpkg ordering fact neither package declares. The fix belongs in the board package (a postinst that fires the update-initramfs trigger), not in a second update-initramfs run here that would hide it"
    done
    echo "compose: the initramfs the kernel package built carries veritysetup and the mos-verity local-top script"
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
