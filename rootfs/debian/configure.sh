#!/bin/sh
# Finish the installation `run.sh install` prepared, from INSIDE that root.
# mos-build-side: container -- the composition stage whose rootfs IS the root.
#
# WHY THIS IS A SEPARATE FILE AND NOT THE SECOND HALF OF run.sh: dpkg
# configuration runs maintainer scripts, so it has to execute with the new root
# as `/`. There are two ways to get there and only one of them works everywhere.
#
#   chroot into the root       -- native only, see run.sh configure
#   BE the root                -- a build stage whose rootfs is the tree
#
# The composition takes the second, because the first cannot work under an
# emulated cross-build: buildkit runs a foreign-architecture step by prepending
# its own x86-64 emulator to the step, and that emulator implements execve by
# re-executing itself through /proc/self/exe. A chroot moves the root out from
# under that path -- $ROOT/proc is an empty directory -- so the re-exec fails
# and the kernel reports ENOENT for the BINARY, which reads as
# `chroot: failed to run command '/debootstrap/debootstrap': No such file or
# directory` about a file that is demonstrably there. Measured: staging the
# emulator inside the root changes nothing (the lookup does not go through a
# path in the root), and mounting /proc inside the root fixes it completely --
# which a RUN step cannot do, having no CAP_SYS_ADMIN.
#
# So the root is entered, not chrooted into, and this file is what runs there.
set -eu
export LC_ALL=C
EXTRA=/.debian-extra
fail() { echo "debian-base: error: $*" >&2; exit 1; }
[ -d "$EXTRA" ] ||
    fail "$EXTRA is missing, so this root was not prepared by rootfs/debian/run.sh install"

# THE SLIM BASE'S EXCLUSIONS, RESTORED. This root used to be composed on top of
# `debian:trixie-slim`, and what kept documentation, manual pages, info, lintian
# overrides and translated messages out of it was that image's
# /etc/dpkg/dpkg.cfg.d/docker -- not anything this repository wrote. Bootstrapping
# from scratch dropped the base image and the file with it, and nothing replaced
# it: measured on cx3576, the root came back 48 MB heavier
# (/usr/share/locale 33.9, doc 9.7, man 4.4, info 0.6), which is 434 MB against a
# 400 MB slot budget. x64 kept composing only because its budget has the headroom.
#
# The copyright include is not decoration. Debian ships those files to satisfy
# the redistribution terms and rootfs/scripts/package-manager-purge.sh refuses a
# root with fewer than 100 of them.
mkdir -p /etc/dpkg/dpkg.cfg.d
cat >/etc/dpkg/dpkg.cfg.d/mos-slim <<'CFG'
path-exclude /usr/share/doc/*
path-include /usr/share/doc/*/copyright
path-exclude /usr/share/info/*
path-exclude /usr/share/lintian/overrides/*
path-exclude /usr/share/locale/*
path-exclude /usr/share/man/*
CFG
# What is already on disk, because dpkg only declines to put files back -- it
# does not remove what it never unpacked. debootstrap's first stage extracted
# the bootstrap floor with `dpkg-deb -x`, which reads no dpkg configuration at
# all, so the excluded trees are here now. The copyright files are stepped
# around rather than deleted and restored, so this never depends on the second
# stage choosing to re-unpack a package.
rm -rf /usr/share/info /usr/share/lintian /usr/share/locale /usr/share/man
if [ -d /usr/share/doc ]; then
    find /usr/share/doc -mindepth 2 \( -type f -o -type l \) ! -name copyright -delete
    find /usr/share/doc -mindepth 1 -type d -empty -delete
fi

# debootstrap's own second stage: dpkg-configure the base floor the first stage
# unpacked. ARCH_ALL_SUPPORTED=0 is what makes its Architecture: all discovery
# work against the saved tarball; DEBOOTSTRAP_DIR is deliberately not exported
# here, so it reads the copy inside the root rather than a host path.
ARCH_ALL_SUPPORTED=0 /debootstrap/debootstrap --second-stage ||
    fail "dpkg configuration failed; inspect /debootstrap/debootstrap.log"

# Everything outside the base floor, in one dpkg transaction that honours
# Pre-Depends. policy-rc.d refuses every service start for its duration.
set --
while IFS= read -r deb; do set -- "$@" "$deb"; done <"$EXTRA/extras.list"
if [ "$#" -gt 0 ]; then
    printf '%s\n' '#!/bin/sh' 'exit 101' >/usr/sbin/policy-rc.d
    chmod 755 /usr/sbin/policy-rc.d
    bash "$EXTRA/install.sh" "$EXTRA/helper.deb" "$@"
    rm /usr/sbin/policy-rc.d
fi

audit=$(dpkg --audit 2>&1) || fail "dpkg --audit failed: $audit"
[ -z "$audit" ] || fail "dpkg --audit reported: $audit"
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n' |
    sort >"$EXTRA/installed.tsv"
diff -u "$EXTRA/expected.tsv" "$EXTRA/installed.tsv" ||
    fail 'installed package set differs from the lock'
[ ! -e /usr/bin/apt ] && [ ! -e /usr/bin/apt-get ] || fail 'APT was installed unexpectedly'
count=$(wc -l <"$EXTRA/installed.tsv")

# Last, because the inventory above is read out of this directory. Nothing it
# holds may reach the image: the archives alone are tens of megabytes, and the
# composition that follows asserts an empty /tmp for the same reason.
rm -rf "$EXTRA"
echo "debian-base: installed $count locked packages using dpkg"
