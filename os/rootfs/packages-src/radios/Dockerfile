# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The radios producer: the `mos-wifi`, `mos-wifi-ap` and `mos-bluetooth`
# packages.
#
#   bash os/rootfs/packages-src/build-deb.sh \
#       --producer-dir os/rootfs/packages-src/radios --arch all
#
# THREE packages and not one `mos-radio`, and not one combined Wi-Fi package.
# A board picks station, access point and Bluetooth independently, so each is
# its own boundary: the split is what lets a Bluetooth-only board avoid
# wpasupplicant and hostapd, and a station-only board avoid hostapd, without a
# single payload file moving. No path is owned by two of them and none names
# another in any relationship field.
#
# This file only STAGES and PACKS. Nothing is compiled here: the payload is
# unit files and a POSIX shell script copied byte-identical out of the tree the
# stage chain ships them from today, plus the symlinks that mask and enable
# them.
#
# No default for the base, for the reason os/build-env/deb/Dockerfile gives: a
# driver that failed to pass the argument would otherwise build from a floating
# tag.
ARG MOS_BUILD_DEB

FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and os/build-env/deb/README.md
# requires this shape: an edit to the packer then takes effect without
# rebuilding the whole builder family.
COPY --from=packer pack.sh /usr/local/bin/pack.sh

COPY --from=family copyright /in/copyright
COPY control/ /in/control/

# The unit bodies and the attach program, out of the tree that ships them
# today, rather than re-entered here. They are copied and never edited: a
# second rendering of a unit is a file that drifts, and the drift would show up
# as a device that mounts nothing while every gate stayed green. The stage
# chain keeps installing these same files until a later workstream switches the
# image over to these packages, so the duplication is expected and temporary.
COPY --from=radio-units etc-wpa_supplicant.mount etc-hostapd.mount \
    var-lib-bluetooth.mount /in/units/
COPY --from=radio-hwinit hwinit-bt mos-bt.service /in/hwinit/

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# mos-wifi: the station half. Three stanzas and not a loop, unlike
# os/rootfs/packages-src/profile/Dockerfile: there the two payloads are one
# payload rendered twice, here they are three different sets of files, and
# writing them out is writing out a real difference.
#
# A mask IS a symlink to /dev/null -- that is the whole mechanism, which is why
# this package can ship it as ordinary payload with no postinst. Both the unit
# and its D-Bus activation alias are masked, because leaving the alias would
# let the first D-Bus caller start the daemon mosd is reconciling.
#
# wpa_supplicant@.service is NOT touched: it stays installed by wpasupplicant
# and unenabled, which is the state os/rootfs/scripts/radios-mask-units.sh
# asserts today. mosd owns per-interface instances.
#
# The wants-link is shipped as a file rather than created by a maintainer
# script. Enablement here is package-owned files: the image root is an
# immutable dm-verity squashfs, so nothing runs `systemctl enable` on it.
RUN set -eu; \
    install -d -m 0755 /stage/wifi/etc/systemd/system/local-fs.target.wants; \
    ln -s /dev/null /stage/wifi/etc/systemd/system/wpa_supplicant.service; \
    ln -s /dev/null /stage/wifi/etc/systemd/system/dbus-fi.w1.wpa_supplicant1.service; \
    install -m 0644 /in/units/etc-wpa_supplicant.mount /stage/wifi/etc/systemd/system/; \
    ln -s /etc/systemd/system/etc-wpa_supplicant.mount \
        /stage/wifi/etc/systemd/system/local-fs.target.wants/etc-wpa_supplicant.mount; \
    install -D -m 0644 /in/copyright /stage/wifi/usr/share/doc/mos-wifi/copyright; \
    pack.sh --root /stage/wifi --control /in/control/mos-wifi.control \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# mos-wifi-ap: the access-point half, and the reason mos-wifi ships no hostapd
# mask. hostapd@.service is likewise left installed and unenabled.
RUN set -eu; \
    install -d -m 0755 /stage/wifi-ap/etc/systemd/system/local-fs.target.wants; \
    ln -s /dev/null /stage/wifi-ap/etc/systemd/system/hostapd.service; \
    install -m 0644 /in/units/etc-hostapd.mount /stage/wifi-ap/etc/systemd/system/; \
    ln -s /etc/systemd/system/etc-hostapd.mount \
        /stage/wifi-ap/etc/systemd/system/local-fs.target.wants/etc-hostapd.mount; \
    install -D -m 0644 /in/copyright /stage/wifi-ap/usr/share/doc/mos-wifi-ap/copyright; \
    pack.sh --root /stage/wifi-ap --control /in/control/mos-wifi-ap.control \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# mos-bluetooth: the attach program, its unit, that unit's enablement link and
# the pairing-key mount.
#
# The unit goes to /usr/lib/systemd/system and the wants-link to
# /etc/systemd/system/multi-user.target.wants, which is exactly what
# os/rootfs/scripts/hwinit-install.sh does with it today. The link is
# unconditional payload while the unit carries
# ConditionPathExists=/etc/mos/bt.conf, so on a board that ships no bt.conf the
# unit is enabled and inert rather than failing -- which is what lets this
# package hold the Bluetooth service while /etc/mos/bt.conf, the radio kernel
# modules and the firmware stay board facts in mos-board-cx3576.
RUN set -eu; \
    install -d -m 0755 /stage/bluetooth/etc/systemd/system/local-fs.target.wants \
        /stage/bluetooth/etc/systemd/system/multi-user.target.wants; \
    install -D -m 0755 /in/hwinit/hwinit-bt /stage/bluetooth/usr/lib/mos/hwinit-bt; \
    install -D -m 0644 /in/hwinit/mos-bt.service \
        /stage/bluetooth/usr/lib/systemd/system/mos-bt.service; \
    ln -s /usr/lib/systemd/system/mos-bt.service \
        /stage/bluetooth/etc/systemd/system/multi-user.target.wants/mos-bt.service; \
    install -m 0644 /in/units/var-lib-bluetooth.mount /stage/bluetooth/etc/systemd/system/; \
    ln -s /etc/systemd/system/var-lib-bluetooth.mount \
        /stage/bluetooth/etc/systemd/system/local-fs.target.wants/var-lib-bluetooth.mount; \
    install -D -m 0644 /in/copyright /stage/bluetooth/usr/share/doc/mos-bluetooth/copyright; \
    pack.sh --root /stage/bluetooth --control /in/control/mos-bluetooth.control \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape os/pkgs/mosd/deb/mosd/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
