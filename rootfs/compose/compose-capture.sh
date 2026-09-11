#!/bin/sh
# Preserve native installation inputs outside the selected runtime payload.
set -eu
[ ! -e /mos-build-inputs ]
install -d -m 0755 /mos-build-inputs/info
cp -a /var/lib/dpkg/info/*.list /mos-build-inputs/info/
cp /mos-compose/source-lineage.json /mos-build-inputs/source-lineage.json
cp /mos-compose/packages.txt /mos-build-inputs/selected.pkgs
cp /mos-compose/upstream.tsv /mos-compose/helper.tsv /mos-build-inputs/
cp /etc/dpkg/dpkg.cfg.d/mos-slim /mos-build-inputs/dpkg-slim.conf
cp "/mos-debs/${MOS_ARCH}/Packages" "/mos-debs/${MOS_ARCH}/SHA256SUMS" "/mos-debs/${MOS_ARCH}/manifest.txt" /mos-build-inputs/
dpkg-query -W -f='${Package}\t${source:Package}\t${source:Version}\n' | LC_ALL=C sort > /mos-build-inputs/sources.tsv
install -d -m 0755 /mos-build-inputs/alternatives /mos-build-inputs/enablement
update-alternatives --get-selections | awk '{print $1}' > /mos-build-inputs/alternative-names.txt
while IFS= read -r name; do
    update-alternatives --query "$name" > "/mos-build-inputs/alternatives/$name"
done < /mos-build-inputs/alternative-names.txt
if [ -d /var/lib/systemd/deb-systemd-helper-enabled ]; then
    cp -a /var/lib/systemd/deb-systemd-helper-enabled/. /mos-build-inputs/enablement/
fi
find /mos-build-inputs/enablement -maxdepth 1 -type f -name '*.dsh-also' -printf '%f\n' | LC_ALL=C sort > /mos-build-inputs/enablement-names.txt
: > /mos-build-inputs/preset-removed.tsv
sha256sum /mos-scripts/compose-install.sh /mos-scripts/compose-capture.sh > /mos-build-inputs/transform-sources.sha256
