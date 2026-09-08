# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The wifi producer: the `mos-wifi` and `mos-wifi-ap` packages.
#
#   bash build-env/deb/build.sh --producer wifi --arch all
#
# TWO packages and not one combined Wi-Fi package: a board picks station and
# access point independently, so each is its own boundary -- the split is what
# lets a station-only board avoid hostapd without a single payload file
# moving. Bluetooth is its own producer (rootfs/packages-src/bluetooth).
# No path is owned by two of them and none names another in any relationship
# field.
#
# This file only STAGES and PACKS. Nothing is compiled here: the payload is
# unit files copied byte-identical out of the tree that ships them, plus the
# symlinks that mask and enable them.
#
# No default for the base, for the reason build-env/deb/Dockerfile gives: a
# driver that failed to pass the argument would otherwise build from a floating
# tag.
ARG MOS_BUILD_DEB

FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and build-env/deb/README.md
# requires this shape: an edit to the packer then takes effect without
# rebuilding the whole builder family.
COPY --from=packer pack.sh /usr/local/bin/pack.sh

COPY --from=family copyright /in/copyright
COPY control/ /in/control/

# The unit bodies, out of the tree that ships them today, rather than
# re-entered here. They are copied and never edited: a second rendering of a
# unit is a file that drifts, and the drift would show up as a device that
# mounts nothing while every gate stayed green.
COPY --from=radio-units etc-wpa_supplicant.mount etc-hostapd.mount \
     mos-regdb-reload.service /in/units/

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# mos-wifi ALSO carries the regulatory-database reload, and the unit body says
# at length why it has to exist. In short: cfg80211 is built into every board
# kernel here and these boards have no initramfs, so the boot-time
# `regulatory.db` request runs before the root is mounted and its failure is
# recorded in a file-scope pointer nothing re-reads. Installing the database
# without this unit ships a file the kernel will not look at again.
#
# It is in mos-wifi and not in both, because a path may have exactly one owner.
# `rootfs/packages/radio-wifi.pkgs` names mos-wifi and mos-wifi-ap together for
# every board that declares the `wifi` radio, so no resolution this tree
# produces has the access-point half without this one.
#
# mos-wifi: the station half. Two stanzas and not a loop, unlike
# rootfs/packages-src/profile/Dockerfile: there the two payloads are one
# payload rendered twice, here they are two different sets of files, and
# writing them out is writing out a real difference.
#
# A mask IS a symlink to /dev/null -- that is the whole mechanism, which is why
# this package can ship it as ordinary payload with no postinst. Both the unit
# and its D-Bus activation alias are masked, because leaving the alias would
# let the first D-Bus caller start the daemon mosd is reconciling.
#
# wpa_supplicant@.service is NOT touched: it stays installed by wpasupplicant
# and unenabled. mosd owns per-interface instances.
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
    install -d -m 0755 /stage/wifi/etc/systemd/system/multi-user.target.wants; \
    install -m 0644 /in/units/mos-regdb-reload.service /stage/wifi/etc/systemd/system/; \
    ln -s /etc/systemd/system/mos-regdb-reload.service \
        /stage/wifi/etc/systemd/system/multi-user.target.wants/mos-regdb-reload.service; \
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

# The export stage, the shape pkgs/mosd/deb/mosd/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
