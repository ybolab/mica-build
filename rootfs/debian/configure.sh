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
