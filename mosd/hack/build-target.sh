#!/usr/bin/env bash
# Cross-build mosd, apid, mos-mqttd and mos-mqtt-broker for one Rust target
# and verify the ELF.
#
#   bash mosd/hack/build-target.sh <rust-target> <elf-arch-substring>
#   bash mosd/hack/build-target.sh aarch64-unknown-linux-gnu aarch64
#   bash mosd/hack/build-target.sh x86_64-unknown-linux-gnu  x86-64
#
# THE COMPILER IS localhost/mos-build-rust, NOT THE HOST'S. PLAN-014 M2 decision
# 4, RFCT-108 M2c. Until then the first line of work here was
#
#     export PATH="$HOME/.cargo/bin:$PATH"
#
# followed by `cargo build`, which made this the one build in the whole chain
# with no pin of any kind: every other component names its compiler in
# os/podman/versions.env, os/update/rauc/versions.env or now
# os/build-env/images.env, and this one used whatever rustup the person running
# it happened to have. PLAN-014's own context lists it as such -- "the one
# wholly unpinned build in the chain". Two devices could ship mosd binaries
# built by different compilers and nothing in the tree could say so.
#
# It was also, on the machine where this was written, unrunnable: `command -v
# cargo` and `command -v rustc` were both empty while this script prepended
# ~/.cargo/bin to PATH and ran cargo. A build path that reads as working because
# nothing exercises it is the failure mode this campaign keeps finding.
#
# WHAT THE HOST NEEDS NOW: docker. That is RFCT-108's stated outcome for this
# file and it is the whole of it -- no rustup, no cross linker, no target std.
#
# WHAT RUNS INSIDE: exactly the cargo line that used to run outside, with the
# same --locked and the same --target. The container is a boundary around the
# toolchain, not a change to the build, and that claim was tested at switchover
# rather than asserted -- os/build-env/README.md records what the comparison
# could and could not establish on the machine it was run on.
set -euo pipefail
cd "$(dirname "$0")/.."
WORKSPACE="$(pwd)"
REPO_ROOT="$(cd "${WORKSPACE}/.." && pwd)"
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"

TARGET="${1:?usage: build-target.sh <rust-target> <elf-arch>}"
ELF_ARCH="${2:?usage: build-target.sh <rust-target> <elf-arch>}"

# Path arithmetic, proved rather than assumed: this file is reached from
# os/rootfs/build-v2.sh, from mosd/hack/build-aarch64.sh and by hand, and a
# relative path resolves against whichever of those was the caller.
for p in "${WORKSPACE}/Cargo.toml" "${FROM_SH}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. mosd/hack/build-target.sh derives the workspace as its own directory's parent and the repository as the level above that; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. Since RFCT-108 M2c this build runs inside localhost/mos-build-rust rather than on the host's cargo, which is what makes the compiler a value recorded in os/build-env/images.env instead of whatever the machine happened to have" >&2
    exit 1
}

# THE ARCHITECTURE THE IMAGE MUST BE, derived from the Rust target rather than
# taken as a third argument: a second way to say the same thing is a thing that
# can disagree with itself, and the disagreement would look like a wrong-arch
# binary two builds later.
case "${TARGET}" in
aarch64-*) IMAGE_ARCH=amd64 ;; # cross-built FROM an amd64 builder
x86_64-*) IMAGE_ARCH=amd64 ;;
*)
    echo "error: '${TARGET}' is not a target os/build-env/images.env pins a Rust std for. mos-build-rust ships std for exactly two triples -- RUST_TRIPLE_AMD64 and RUST_TRIPLE_ARM64 -- and adding a third is an images.env edit (RUST_STD_SHA256_<arch>) and not an argument to this script" >&2
    exit 1
    ;;
esac

# The image, out of images.env, and refused by name if it is missing or is the
# wrong architecture -- docker reports the first as a failed pull from a
# registry called `localhost` and the second as a manifest error, neither of
# which names `make build-env`.
mapfile -t FROM_ARGS < <("${FROM_SH}" --arch="${IMAGE_ARCH}" MOS_BUILD_RUST=LOCAL_MOS_BUILD_RUST)
[ "${#FROM_ARGS[@]}" -eq 2 ] || {
    echo "error: os/build-env/from.sh did not yield localhost/mos-build-rust (see its message above)" >&2
    exit 1
}
IMAGE="${FROM_ARGS[1]#MOS_BUILD_RUST=}"

# THE CARGO CACHES ARE REPO-LOCAL BIND MOUNTS, not docker volumes and not
# $HOME/.cargo. Repo-local because `make clean` and `rm -rf _out` then mean what
# they say, and because a docker volume is state this repository would create on
# a machine and never account for. NOT $HOME/.cargo, because the point of the
# switchover is that the host carries no Rust state at all.
#
# CARGO_HOME=/usr/local/cargo is the image's own setting, deliberately the same
# path os/podman/Dockerfile's cargo cache mounts already use -- so the two Rust
# builds in this repository warm the same directory layout even though they do
# not share the cache itself.
CARGO_CACHE="${REPO_ROOT}/_out/cargo"
mkdir -p "${CARGO_CACHE}/registry" "${CARGO_CACHE}/git"

# THE WORKSPACE IS MOUNTED AT A FIXED PATH, /src, and that is a deliberate
# improvement rather than an accident of writing a `docker run`. rustc records
# the paths it was given; mounting the workspace where it happens to live on
# this machine would make the output depend on the checkout directory, so two
# machines building the same commit would produce different binaries for a
# reason that is not about the source. A fixed path removes that variable. It
# also means the binaries this produces are NOT byte-comparable with a host
# cargo run from a different directory, which is the first thing the switchover
# comparison had to control for.
#
# `--network host` is not used and is not needed: cargo fetches through the
# container's default network, and the only thing bound in is this repository.
docker run --rm \
    --platform "linux/${IMAGE_ARCH}" \
    -v "${WORKSPACE}:/src" \
    -v "${CARGO_CACHE}/registry:/usr/local/cargo/registry" \
    -v "${CARGO_CACHE}/git:/usr/local/cargo/git" \
    -w /src \
    -e "TARGET=${TARGET}" \
    --entrypoint /bin/bash \
    "${IMAGE}" -c '
        set -euo pipefail
        # The image records what it is; this reads it back and prints it, so the
        # build log answers "which rustc compiled this" without anyone having to
        # know which image was current. An image with no record is one that
        # cannot answer that, and os/build-env/build.sh refuses to tag one.
        [ -f /etc/mos-build/rust.env ] || {
            echo "error: this image carries no /etc/mos-build/rust.env, so what compiled these binaries cannot be read back out of it" >&2
            exit 1
        }
        . /etc/mos-build/rust.env
        echo "mosd: building ${TARGET} with rustc ${MOS_BUILD_RUSTC} from ${MOS_BUILD_IMAGE} (RUST_SHA256=${MOS_BUILD_RUST_SHA256})"
        # --locked, unchanged from the host build this replaced: it is what makes
        # Cargo.lock the decision and refuses a build that would have quietly
        # updated it.
        cargo build --release --locked --target "${TARGET}" \
            -p mosd -p apid -p mos-mqttd -p mos-mqtt-broker
    '

# The ELF check is per binary, not just the first: a target that silently
# produced a host-arch artifact for ONE crate would otherwise ship and fail at
# exec time on the device -- which is the same class of failure as building the
# wrong architecture entirely, but reported one binary later.
#
# IT RUNS ON THE HOST, on the exported files, and that is deliberate: the
# container asserts what it built, this asserts what landed in the directory
# os/rootfs/build-v2.sh is about to copy from. os/podman/build.sh and
# os/update/rauc/build.sh draw the same line for the same reason. `file` is a
# host tool here -- and if a host has none, the check would silently not run,
# so its absence is refused rather than skipped.
command -v file >/dev/null 2>&1 || {
    echo "error: 'file' is not on PATH, so the per-binary architecture check below cannot run. It is the check that catches a target which built one crate for the host, and skipping it silently is how that ships" >&2
    exit 1
}
for name in mosd apid mos-mqttd mos-mqtt-broker; do
    BIN="${WORKSPACE}/target/${TARGET}/release/${name}"
    if [ ! -f "${BIN}" ]; then
        echo "error: ${BIN} was not produced by the build" >&2
        exit 1
    fi
    if ! file -b "${BIN}" | grep -c "ELF 64-bit.*${ELF_ARCH}" >/dev/null; then
        echo "error: ${BIN} is not an ${ELF_ARCH} ELF: $(file -b "${BIN}")" >&2
        exit 1
    fi
    echo "${BIN}"
done
