#!/bin/sh
# Remove package management from the packed root, and prove what survived.
#
# Called from os/rootfs/stages/90-pack.Dockerfile (closed stage), where the reasoning lives.

set -eu
rm -rf /var/lib/dpkg /var/lib/apt /var/cache/apt /var/cache/debconf \
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
rm -f /usr/bin/debconf /usr/bin/debconf-apt-progress /usr/bin/debconf-communicate \
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
      /etc/initramfs-tools/hooks/mos-verity \
      /usr/lib/systemd/system/apt-daily.timer \
      /usr/lib/systemd/system/apt-daily.service \
      /usr/lib/systemd/system/apt-daily-upgrade.timer \
      /usr/lib/systemd/system/apt-daily-upgrade.service \
      /usr/lib/systemd/system/dpkg-db-backup.timer \
      /usr/lib/systemd/system/dpkg-db-backup.service \
      /etc/systemd/system/timers.target.wants/apt-daily.timer \
      /etc/systemd/system/timers.target.wants/apt-daily-upgrade.timer \
      /etc/systemd/system/timers.target.wants/dpkg-db-backup.timer
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
