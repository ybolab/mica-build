#!/bin/sh
# Observe the full production services and writable namespace policy in QEMU.
set -eu
exec >/dev/console 2>&1
fail() {
    echo "FILE_AB_RUNTIME_FAIL: $*"
    journalctl --no-pager -b -u mos-data-layout -u systemd-repart -u systemd-growfs@mnt-data -u mos-load-extensions -u systemd-random-seed -u mos-health -n 120
    findmnt -rn -M /mnt/data
    systemctl poweroff --force
    exit 1
}
storage_measurement() (
    phase=$1
    [ "$phase" = sample ] || sync
    for storage in system esp; do
        case "$storage" in system) mountpoint=/mnt/system; device=vda2;; esp) mountpoint=/boot; device=vda1;; esac
        set -- $(stat -f -c '%b %f %S' "$mountpoint")
        used=$(( ($1 - $2) * $3 ))
        capacity=$(( $1 * $3 ))
        sectors=$(awk '{print $7}' "/sys/class/block/$device/stat")
        echo "FILE_AB_STORAGE: $phase $storage usedBytes=$used capacityBytes=$capacity writtenSectors=$sectors"
    done
)
install_deployment() {
    descriptor=$1
    objects=$2
    if [ -f /run/mos/import/recover-data-write ]; then
        chattr +i /mnt/data/meta/deployments.json || fail 'metadata fault injection'
        if mos-deploy install "$descriptor" --objects "$objects"; then
            chattr -i /mnt/data/meta/deployments.json
            fail 'immutable metadata accepted a state write'
        fi
        chattr -i /mnt/data/meta/deployments.json || fail 'metadata fault removal'
        mos-deploy status | grep -F "\"candidate\":\"$expected\"" || fail 'committed candidate was hidden after DATA write failure'
        mos-deploy confirm | grep -F "\"candidate\":\"$expected\"" || fail 'reconfirmation discarded the committed candidate'
        echo FILE_AB_ACTIVATION_RECOVERY_PASS
    else
        mos-deploy install "$descriptor" --objects "$objects" || fail 'component installation'
    fi
}
for unit in systemd-repart.service systemd-growfs@mnt-data.service mos-data-layout.service mos-seed-state.service systemd-random-seed.service systemd-tmpfiles-setup.service mosd.service apid.service; do
    systemctl is-active --quiet "$unit" || fail "$unit is not active"
done
for path in /mnt/data /mos /srv /var/lib/mos /var/lib/systemd/timesync /var/lib/systemd/network /var/lib/systemd/timers /var/tmp; do
    findmnt -rn -M "$path" -o TARGET,SOURCE,FSTYPE,OPTIONS || fail "missing mount $path"
done
set -- $(stat -f -c '%b %S' /mnt/data)
[ $(( $1 * $2 )) -gt 1073741824 ] || fail 'DATA did not grow with the medium'
for path in /var/unlisted /var/lib/unlisted /var/cache/unlisted /var/log/unlisted; do
    if touch "$path" 2>/run/immutable-error; then fail "unexpected writable parent $path"; fi
    grep -c 'Read-only file system' /run/immutable-error >/dev/null || fail "wrong error for $path"
done
# The service runs as root with the production bounding set.
cap=$(awk '/^CapBnd:/ {print $2}' /proc/self/status)
[ $((0x$cap & (1 << 24))) -eq 0 ] || fail 'CAP_SYS_RESOURCE can bypass quotas'
if dd if=/dev/zero of=/var/tmp/quota-bytes bs=1M count=40 2>/run/quota-error; then
    fail 'root service bypassed disposable byte quota'
fi
grep -c 'Disk quota exceeded' /run/quota-error >/dev/null || fail 'expected project quota failure'
printf 'state reserve\n' >/mnt/data/state/reserve-proof
printf 'meta reserve\n' >/mnt/data/meta/reserve-proof
rm /var/tmp/quota-bytes
for n in $(seq 1 2200); do
    if ! touch "/var/tmp/quota-inode-$n" 2>/run/quota-error; then break; fi
done
grep -c 'Disk quota exceeded' /run/quota-error >/dev/null || fail 'root service bypassed inode quota'
printf 'state inode reserve\n' >/mnt/data/state/inode-reserve-proof
find /mnt/data/tmp -maxdepth 1 -type f -name 'quota-inode-*' -delete
[ -e /run/mos/persistent-unit-ran ] || fail 'persistent extension was not loaded at startup'
seed_inode=$(stat -c %i /mnt/data/state/random-seed)
systemctl stop systemd-random-seed.service || fail 'random seed shutdown save'
[ "$(stat -c %i /mnt/data/state/random-seed)" = "$seed_inode" ] || fail 'random seed inode replaced'
[ "$(stat -c %s /mnt/data/state/random-seed)" -ge 32 ] || fail 'random seed not persisted'
systemctl start systemd-random-seed.service || fail 'random seed reload'
machine_id=$(cat /etc/machine-id)
[ "$machine_id" = "$(cat /mnt/data/state/machine-id)" ] || fail 'machine identity differs from DATA'
[ "${#machine_id}" -eq 32 ] || fail 'machine identity length'
[ "$(cat /var/lib/dbus/machine-id)" = "$machine_id" ] || fail 'D-Bus identity mismatch'
findmnt -rn -M /etc/machine-id -o OPTIONS | grep -qw ro || fail 'machine identity is writable'
echo "FILE_AB_MACHINE_ID: $machine_id"
booted=$(mos-deploy booted)
confirmed=0
for n in $(seq 1 100); do
    if mos-deploy status | grep -F "\"current\":\"$booted\"" >/dev/null; then confirmed=1; break; fi
    sleep 1
done
[ "$confirmed" = 1 ] || fail 'health did not confirm the deployment'
mos-deploy status || fail 'deployment status unavailable'
busctl --system --json=short call com.mos.mosd /com/mos/mosd com.mos.mosd1 GetUpdateState > /run/mos/service-update.json || fail 'native update service query'
grep -F "$booted" /run/mos/service-update.json >/dev/null || fail 'service deployment identity mismatch'
grep -F 'kernelId' /run/mos/service-update.json >/dev/null || fail 'service component identity absent'
grep -E 'succeeded|rolled-back' /run/mos/service-update.json >/dev/null || fail 'service did not observe confirmed success or fallback'
echo FILE_AB_NATIVE_SERVICE_PASS
mos-deploy firmware-readback | grep -F '"readbackVerified":true' || fail 'installed firmware readback'
cp /mnt/data/meta/firmware.json /run/mos/firmware-receipt.json
mos-deploy firmware-readback /run/mos/firmware-receipt.json --record | grep -F '"receiptRecorded":true' || fail 'firmware receipt recording'
cmp /run/mos/firmware-receipt.json /mnt/data/meta/firmware.json || fail 'firmware receipt changed'
echo FILE_AB_FIRMWARE_READBACK_PASS

for tag in /sys/bus/virtio/devices/*/mount_tag; do
    [ -r "$tag" ] || continue
    [ "$(cat "$tag")" = mos-update ] || continue
    mkdir -p /run/mos/import
    mount -t 9p -o trans=virtio,version=9p2000.L,ro mos-update /run/mos/import || fail 'offline test media mount'
    expected=$(cat /run/mos/import/expected-id)
    if [ "$booted" != "$expected" ]; then
        storage_measurement before
        : > /run/mos/storage-sampling
        (
            count=0
            while [ -f /run/mos/storage-sampling ]; do
                count=$((count + 1))
                [ "$count" -le 6000 ] || exit 1
                storage_measurement sample || exit 1
                sleep 0.1
            done
        ) > /run/mos/storage-samples.log &
        sampler=$!
        mos-deploy probe || fail 'DATA acquisition workspace probe'
        if [ -f /run/mos/import/update.mosupd ]; then
            mos-deploy import /run/mos/import/update.mosupd || fail 'offline archive acquisition'
            install_deployment "/mos/updates/verified/$expected.json" /mos/updates/verified/objects
        elif [ -f /run/mos/import/source-url ]; then
            source=$(cat /run/mos/import/source-url)
            mos-deploy check --source "$source" --channel stable || fail 'signed online catalog check'
            mos-deploy fetch --source "$source" --channel stable || fail 'online component acquisition'
            install_deployment "/mos/updates/verified/$expected.json" /mos/updates/verified/objects
        else
            install_deployment /run/mos/import/deployment.json /run/mos/import/objects
        fi
        rm /run/mos/storage-sampling
        wait "$sampler" || fail 'storage sampler failed or exceeded its bound'
        cat /run/mos/storage-samples.log
        storage_measurement after
        echo "FILE_AB_INSTALL_PASS: $expected"
    else
        echo "FILE_AB_UPDATE_BOOT_PASS: $booted"
        mos-deploy gc || fail 'confirmed object collection'
    fi
    umount /run/mos/import
    break
done
repquota -P -n -O csv /mnt/data || fail 'project quota report'
echo FILE_AB_RUNTIME_PASS
systemctl --no-block poweroff
