# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
ARG MOS_IMAGE_DEBIAN_TRIXIE
FROM ${MOS_IMAGE_DEBIAN_TRIXIE} AS tools
ARG MOS_DEBIAN_SNAPSHOT
RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    printf 'deb [check-valid-until=no] %s trixie main\n' "${MOS_DEBIAN_SNAPSHOT}" > /etc/apt/sources.list.d/snapshot.list && \
    apt-get -o Acquire::Retries=3 update -qq && \
    apt-get install -y --no-install-recommends \
        cryptsetup-bin dmsetup util-linux mount cpio file binutils \
        systemd systemd-boot-efi systemd-ukify sbsigntool squashfs-tools && \
    rm -rf /var/lib/apt/lists/*
RUN dpkg --add-architecture arm64 && apt-get update -qq && \
    mkdir -p /arm-debs/partial /arm64 && \
    apt-get -o APT::Architecture=arm64 -o APT::Architectures::=arm64 \
        -o Dir::State::status=/dev/null -o Dir::Cache::archives=/arm-debs \
        --download-only -y --no-install-recommends install \
        cryptsetup-bin:arm64 util-linux:arm64 mount:arm64 libgcc-s1:arm64 systemd:arm64 systemd-boot-efi:arm64 && \
    for archive in /arm-debs/*.deb; do dpkg-deb -x "$archive" /arm64; done && \
    rm -rf /arm-debs /var/lib/apt/lists/*
COPY initramfs.sh kernel.sh elf-closure.py /tools/

FROM tools AS loader-build
RUN printf 'Package: *\nPin: origin snapshot.debian.org\nPin-Priority: 1001\n' > /etc/apt/preferences.d/snapshot && \
    apt-get update -qq && apt-get install -y --allow-downgrades --no-install-recommends \
        ca-certificates curl gcc g++ gcc-aarch64-linux-gnu g++-aarch64-linux-gnu libc6-dev meson ninja-build pkgconf \
        python3-jinja2 python3-pyelftools gperf libcap-dev libmount-dev patch && \
    rm -rf /var/lib/apt/lists/*
COPY versions.env /versions.env
RUN set -eu; . /versions.env; \
    curl --fail --location --retry 3 --max-time 120 "$SYSTEMD_URL" -o /systemd.tar.gz; \
    echo "$SYSTEMD_SHA256  /systemd.tar.gz" | sha256sum -c -; \
    mkdir /source; tar -xzf /systemd.tar.gz --strip-components=1 -C /source
COPY systemd-boot-persistence.patch /policy.patch
COPY arm64-cross.ini /arm64-cross.ini
RUN cd /source && patch -p1 < /policy.patch && \
    meson setup /build -Dmode=release -Dauto_features=disabled -Dbootloader=enabled \
        -Dman=disabled -Dhtml=disabled -Dtests=false -Dinstall-tests=false \
        -Dversion-tag=257.13-mos1 -Dvcs-tag=false && \
    ninja -C /build src/boot/systemd-bootx64.efi && \
    meson setup /build-arm64 --cross-file=/arm64-cross.ini \
        -Dmode=release -Dauto_features=disabled -Dbootloader=enabled \
        -Dman=disabled -Dhtml=disabled -Dtests=false -Dinstall-tests=false \
        -Dversion-tag=257.13-mos1 -Dvcs-tag=false && \
    ninja -C /build-arm64 src/boot/systemd-bootaa64.efi

FROM tools AS artifact-tools
COPY --from=loader-build /build/src/boot/systemd-bootx64.efi /usr/lib/systemd/boot/efi/systemd-bootx64.efi
COPY --from=loader-build /build-arm64/src/boot/systemd-bootaa64.efi /usr/lib/systemd/boot/efi/systemd-bootaa64.efi
COPY --from=loader-build /source/LICENSE.LGPL2.1 /usr/share/doc/mos-systemd-boot/LICENSE.LGPL2.1
