#!/bin/sh
# Remove package management from the packed root, and prove what survived.
#
# Called from os/rootfs/stages/90-pack.Dockerfile (closed stage), where the reasoning lives.

set -eu
# The logs go too, and they are the one part of this that has a prerequisite:
# /var/log/dpkg.log is what the stage-order claim is measured with, so
# package-manager-logs-capture.sh must already have taken it out of the tree.
# Refuse rather than remove it, because a purge that quietly destroyed the
# instrument would read as a clean image and cost the claim silently.
[ -s /rootfs-report.pkglogs/dpkg.log ] ||
    { echo "error: the package-manager logs were not captured before this purge; /rootfs-report.pkglogs/dpkg.log is missing or empty. Removing /var/log/dpkg.log without capturing it first destroys the instrument the stage-order claim is measured with -- os/rootfs/README.md, 'Check the apt order directly' -- and nothing downstream can tell that from a build that never needed it" >&2; exit 1; }
# THE ENABLEMENT OF THE MACHINERY THIS PURGE REMOVES, found by asking dpkg who
# OWNS each unit rather than by matching its name.
#
# apt ships apt-daily.timer and apt-daily-upgrade.timer, dpkg ships
# dpkg-db-backup.timer, and each ships the wants-symlink that enables it -- into
# /etc/systemd/system/timers.target.wants, the level that overrides vendor
# defaults. On a root whose package manager is about to be deleted they fire
# daily and fail daily, and nothing else in the image is wrong enough to notice.
#
# THIS RUNS FIRST because it is the only step here that needs the dpkg database,
# and the `rm -rf` below deletes it. That ordering is the whole reason this
# check lives in this file rather than in the finalizer's residue stripper,
# which runs in the pack stage over a tree with no /var/lib/dpkg left.
#
# BY OWNERSHIP AND NOT BY NAME, and that is the point of the change. The old
# spelling removed nine literal paths and then asserted `find -name 'apt-daily*'
# -o -name 'dpkg-db-backup*'` found nothing -- so a fourth timer, shipped by apt
# or dpkg under any other name, survived the removal AND the assertion. The
# membership test is a set of PACKAGE names, which is the granularity the purge
# is actually about: it removes apt's and dpkg's binaries, so it removes what
# apt and dpkg enabled, whatever those units are called.
#
# The by-name assertion is KEPT, below, as the check on this mechanism rather
# than as the mechanism. If this sweep stops working, that assertion is what
# says so, and it can only say so because it no longer does the removing.
PURGED_PACKAGES="apt dpkg"
owned_by_purged() {
    _owner="$(dpkg-query -S "$1" 2>/dev/null | sed 's/:.*//')" || return 1
    [ -n "${_owner}" ] || return 1
    for _p in $(printf '%s' "${_owner}" | tr ',' ' '); do
        for _q in ${PURGED_PACKAGES}; do
            [ "${_p}" != "${_q}" ] || return 0
        done
    done
    return 1
}
purged_units=0
purged_names=""
for _path in /etc/systemd/system/*.target.wants/*              /etc/systemd/system/*.timer /etc/systemd/system/*.service              /usr/lib/systemd/system/*.timer /usr/lib/systemd/system/*.service; do
    { [ -e "${_path}" ] || [ -L "${_path}" ]; } || continue
    owned_by_purged "${_path}" || continue
    rm -f "${_path}"
    purged_units=$((purged_units + 1))
    purged_names="${purged_names} ${_path}"
done
# A zero is not proof of a clean root, it is the shape this sweep takes when it
# is reading the wrong thing -- every image this repository builds installs apt
# and dpkg, and both ship enabled timers.
[ "${purged_units}" -gt 0 ] ||
    { echo "error: no unit under /etc/systemd/system or /usr/lib/systemd/system is owned by ${PURGED_PACKAGES}, so this swept nothing. Both packages ship enabled timers in every image this repository builds; a zero here means dpkg-query answered nothing -- a database already removed, or a path spelling it does not recognise -- and the assertion below would then be checking a removal that never happened" >&2; exit 1; }
echo "purge: ${purged_units} unit(s) owned by ${PURGED_PACKAGES} removed with their enablement:${purged_names}"

rm -rf /var/lib/dpkg /var/lib/apt /var/cache/apt /var/cache/debconf \
       /var/log/apt \
       /etc/apt /etc/dpkg /usr/lib/apt /usr/lib/dpkg /usr/share/debconf \
       /usr/share/perl /usr/share/perl5 \
       /usr/bin/dpkg /usr/bin/dpkg-deb /usr/bin/dpkg-divert \
       /usr/bin/dpkg-maintscript-helper /usr/bin/dpkg-query \
       /usr/bin/dpkg-split /usr/bin/dpkg-statoverride /usr/bin/dpkg-trigger \
       /usr/sbin/dpkg-preconfigure /usr/sbin/dpkg-reconfigure \
       /usr/bin/apt /usr/bin/apt-cache /usr/bin/apt-cdrom /usr/bin/apt-config \
       /usr/bin/apt-get /usr/bin/apt-key /usr/bin/apt-mark /usr/bin/apt-sortpkgs \
       /usr/bin/gpgv /usr/bin/perl /usr/bin/perl5.* \
       /usr/lib/*-linux-gnu/perl-base /usr/lib/*-linux-gnu/libapt-pkg.so.* \
       /usr/lib/*-linux-gnu/libapt-private.so.*
rm -f /var/log/dpkg.log /var/log/alternatives.log \
      /usr/bin/debconf /usr/bin/debconf-apt-progress /usr/bin/debconf-communicate \
      /usr/bin/debconf-copydb /usr/bin/debconf-escape /usr/bin/debconf-set-selections \
      /usr/bin/debconf-show /usr/bin/deb-systemd-helper /usr/bin/deb-systemd-invoke \
      /usr/bin/ucf /usr/bin/ucfq /usr/bin/ucfr \
      /usr/sbin/adduser /usr/sbin/deluser /usr/sbin/addgroup /usr/sbin/delgroup \
      /usr/sbin/update-rc.d /usr/sbin/dpkg-fsys-usrunmess \
      /usr/sbin/pam-auth-update /usr/sbin/pam_getenv \
      /usr/bin/linux-check-removal /usr/bin/linux-run-hooks \
      /usr/bin/linux-update-symlinks /usr/bin/linux-version \
      /usr/sbin/update-initramfs \
      /usr/sbin/veritysetup /usr/sbin/cryptsetup /usr/sbin/integritysetup \
      /etc/initramfs-tools/hooks/mos-verity
# The by-name check on the ownership sweep above. It names the three units this
# tree has actually seen, so it is narrower than the sweep on purpose: the sweep
# is the general statement and this is the instance that would notice the sweep
# breaking. It no longer removes anything -- that would make it the cure and the
# test at once, and a check that fixes what it is checking cannot fail.
left="$(find /etc/systemd /usr/lib/systemd -name 'apt-daily*' -o -name 'dpkg-db-backup*' 2>/dev/null | tr '\n' ' ')"
[ -z "${left}" ] ||
    { echo "error: package-management timers survived the purge: ${left}. They are enabled, they fire daily, and every one of them fails on an image with no apt and no dpkg -- which is noise in the journal shaped exactly like a real fault" >&2; exit 1; }
for gone in dpkg dpkg-query apt apt-get perl; do
    if command -v "${gone}" >/dev/null 2>&1; then
        echo "error: ${gone} survived the package-manager purge; the packed root still carries a way to install software" >&2; exit 1
    fi
done
for kept in bash sh ls cp mv rm sed awk grep find systemctl sshd ssh scp curl ip; do
    command -v "${kept}" >/dev/null 2>&1 ||
        { echo "error: the purge removed ${kept}, which the image needs at runtime" >&2; exit 1; }
done
test -s /etc/ssl/certs/ca-certificates.crt ||
    { echo "error: the purge removed the CA bundle. It is a GENERATED file, not a shipped one -- update-ca-certificates writes it from /usr/share/ca-certificates -- so anything that sweeps package-manager output can take it, and the loss is silent until the first HTTPS connection" >&2; exit 1; }
dangling="$(grep -rlI '^#!.*perl' /usr/bin /usr/sbin /usr/lib/systemd /etc 2>/dev/null || true)"
[ -z "${dangling}" ] ||
    { echo "error: perl is gone but these scripts still name it as their interpreter: ${dangling}" >&2; exit 1; }
kept_copyrights="$(find /usr/share/doc -name copyright -type f 2>/dev/null | wc -l)"
[ "${kept_copyrights}" -ge 100 ] ||
    { echo "error: only ${kept_copyrights} copyright files are left under /usr/share/doc; Debian ships them to satisfy redistribution terms" >&2; exit 1; }
echo "package management removed; ${kept_copyrights} copyright files kept"
