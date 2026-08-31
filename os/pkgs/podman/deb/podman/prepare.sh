#!/usr/bin/env bash
# The podman producer's PREPARE hook: put the seven container-engine binaries in
# MOS_DEB_STAGE for os/build-env/deb/build.sh to hand the packaging build as its
# `bin` context.
#
# WHY A HOOK AND NOT A KEY IN producer.env. The binaries are compiled by
# os/pkgs/podman/build.sh -- six upstream clones verified against their pinned
# source hashes, across four language toolchains, the whole of it under
# emulation for arm64. That is an input to a compile, not to a docker build, and
# no producer.env key describes it. The generic driver packs what it is handed;
# this decides what it is handed.
#
# EXISTING OUTPUT IS REUSED. os/pkgs/podman/build.sh writes out-<arch>/ and a
# cold arm64 build of it takes roughly three quarters of an hour, so a complete
# one is used as it stands -- the same directory, and the same reuse,
# os/rootfs/build-v2.sh stages into an image. It is rebuilt only when a binary
# is missing from it. The directory carries the architecture in its name, so the
# other architecture's output cannot be mistaken for this one's.
set -euo pipefail

for v in MOS_DEB_REPO_ROOT MOS_DEB_ARCH MOS_DEB_STAGE MOS_DEB_PRODUCER; do
    [ -n "${!v:-}" ] || {
        echo "error: ${v} is not set. This script is os/pkgs/podman/deb/podman/producer.env's PREPARE hook and is run by os/build-env/deb/build.sh, which sets it; it is not a standalone command" >&2
        exit 1
    }
done

REPO_ROOT="${MOS_DEB_REPO_ROOT}"
ARCH="${MOS_DEB_ARCH}"
STAGE="${MOS_DEB_STAGE}"
BUILD_SH="${REPO_ROOT}/os/pkgs/podman/build.sh"
OUT="${REPO_ROOT}/os/pkgs/podman/out-${ARCH}"

[ -f "${BUILD_SH}" ] || {
    echo "error: ${BUILD_SH} does not exist; it is what compiles the binaries this producer packages" >&2
    exit 1
}

case "${ARCH}" in
amd64) ELF_ARCH=x86-64 ;;
arm64) ELF_ARCH=aarch64 ;;
*)
    echo "error: MOS_DEB_ARCH is '${ARCH}'. os/pkgs/podman/build.sh builds amd64 and arm64 and no other, and this producer's ARCHES says the same" >&2
    exit 1
    ;;
esac

# THE SET THIS PRODUCER OWNS, and the only set it stages. os/pkgs/podman builds
# exactly these and os/rootfs/scripts/podman-install.sh installs exactly these.
BINARIES=(podman quadlet crun conmon netavark aardvark-dns catatonit)

missing=""
for b in "${BINARIES[@]}"; do
    [ -f "${OUT}/${b}" ] || missing="${missing} ${b}"
done
if [ -n "${missing}" ]; then
    echo "prepare: ${OUT} is missing${missing}; building the engine for ${ARCH}"
    MOS_ARCH="${ARCH}" bash "${BUILD_SH}"
    for b in "${BINARIES[@]}"; do
        [ -f "${OUT}/${b}" ] || {
            echo "error: os/pkgs/podman/build.sh reported success and ${OUT}/${b} does not exist" >&2
            exit 1
        }
    done
else
    echo "prepare: reusing the existing ${OUT}"
fi

# The architecture, checked on the REUSE path too and not only after a build.
# out-<arch> is a directory in the worktree that nothing here created, and
# packing an amd64 binary into an arm64 archive is a failure dpkg-shlibdeps
# reports as a missing dependency rather than as a wrong architecture.
for b in "${BINARIES[@]}"; do
    got="$(file -b "${OUT}/${b}")"
    case "${got}" in
    *"ELF 64-bit"*"${ELF_ARCH}"*) ;;
    *)
        echo "error: ${OUT}/${b} is not an ${ELF_ARCH} ELF: ${got}. That directory holds the output of \`MOS_ARCH=${ARCH} make podman\`; delete it and build again" >&2
        exit 1
        ;;
    esac
done

for b in "${BINARIES[@]}"; do
    cp "${OUT}/${b}" "${STAGE}/${b}"
done

# What os/pkgs/podman/build.sh also writes into out-<arch> -- SHA256SUMS, and
# anything a later revision of it adds -- stays there. The `bin` context is what
# the payload is built from, and a file in it that no COPY names is a file
# nothing accounts for; the payload assertion in this producer's Dockerfile is
# over the staged ROOT, so it would never see it.
echo "prepare: staged ${BINARIES[*]} for ${ARCH} into ${STAGE}"
