#!/bin/sh
# Copy the rendered overlay in, set every mode explicitly, and wire the units.
#
# Called from os/rootfs/Dockerfile.v2 (rootfs stage), where the reasoning lives.

cp -a /tmp/overlay/. / &&
rm -rf /tmp/overlay &&
{ [ ! -e /etc/fw_env.config ] || chmod 0644 /etc/fw_env.config; } &&
chmod 0755 /usr/lib/mos/mos-seed-var /usr/lib/mos/mos-seed-state \
           /usr/lib/mos/mos-seed-home /usr/lib/mos/mos-seed-root \
           /usr/lib/mos/mos-shadow-reconcile &&
chmod 0644 /etc/fstab /etc/repart.d/*.conf \
           /etc/tmpfiles.d/mos-var.conf \
           /etc/systemd/system/mos-seed-*.service \
           /etc/systemd/system/mos-apply-hostname.service \
           /etc/systemd/system/mos-shadow-reconcile.service \
           /etc/systemd/system/var-lib-mos.mount \
           /etc/systemd/system/etc-ssh.mount \
           /etc/systemd/system/etc-hostname.mount \
           /etc/systemd/system/usr-local-lib-systemd-system.mount \
           /etc/systemd/system/home.mount \
           /etc/systemd/system/root.mount &&
mkdir -p /srv /mnt/state /mnt/meta /home \
         /etc/systemd/system/local-fs.target.wants \
         /etc/systemd/system/timers.target.wants \
         /etc/systemd/system/multi-user.target.wants &&
mkdir -p -m 0700 /root && chown 0:0 /root && chmod 0700 /root &&
mkdir -p -m 0755 /usr/local/lib/systemd /usr/local/lib/systemd/system &&
chown 0:0 /usr/local/lib/systemd /usr/local/lib/systemd/system &&
mkdir -p /etc/containers/systemd && chmod 0755 /etc/containers/systemd &&
{ [ ! -e /etc/systemd/system/boot.mount ] || {
    mkdir -p -m 0755 /boot &&
    chmod 0644 /etc/systemd/system/boot.mount &&
    ln -sf /etc/systemd/system/boot.mount \
        /etc/systemd/system/local-fs.target.wants/boot.mount &&
    test -L /etc/systemd/system/local-fs.target.wants/boot.mount; }; } &&
: "etc-containers-systemd.mount is INSTALLED and deliberately NOT linked into" \
  "local-fs.target.wants below. It was, until PLAN-012 M3: RFCT-102 added the" \
  "symlink because without it the Quadlet directory was the image's empty one" \
  "and nothing persisted. That was the right fix for an image with no switch," \
  "and it pre-empted the switch. Statically enabled, the bind comes up at every" \
  "boot regardless of container.enabled, Quadlet generates units from STATE," \
  "and they start -- so anything able to write /mnt/state/quadlet has a" \
  "root-capable container at the next reboot with no operator decision in the" \
  "path. mosd's ContainerReconciler enables and starts it when the setting says" \
  "true, which is the same runtime-scoped enablement every other mos-driven" \
  "unit uses." &&
for u in mos-seed-var.service mos-seed-state.service mos-seed-home.service \
         mos-seed-root.service \
         var-lib-mos.mount \
         etc-ssh.mount etc-hostname.mount home.mount root.mount \
         usr-local-lib-systemd-system.mount \
         mos-apply-hostname.service; do
    ln -sf "/etc/systemd/system/$u" "/etc/systemd/system/local-fs.target.wants/$u" &&
    test -L "/etc/systemd/system/local-fs.target.wants/$u"
done &&
ln -sf /lib/systemd/system/fstrim.timer \
       /etc/systemd/system/timers.target.wants/fstrim.timer &&
test -L /etc/systemd/system/timers.target.wants/fstrim.timer &&
ln -sf /etc/systemd/system/mos-shadow-reconcile.service \
       /etc/systemd/system/multi-user.target.wants/mos-shadow-reconcile.service &&
test -L /etc/systemd/system/multi-user.target.wants/mos-shadow-reconcile.service
