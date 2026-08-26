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

# ═══ THE COMMIT THE BINARIES REPORT, RESOLVED HERE AND PASSED IN ═════════════
#
# RFCT-113 M7d. mosd and apid answer `--version` with
# `<name> <crate version> (<commit>)`, and the commit half cannot be discovered
# by the code that prints it: MEASURED on 2026-08-26 inside
# localhost/mos-build-rust, with the exact mount the build below uses --
#
#   docker run --rm -v "${REPO_ROOT}:/src" -w /src/mosd ... \
#       -c "command -v git; git rev-parse HEAD"
#     command -v git   -> /usr/bin/git
#     git rev-parse    -> fatal: not a git repository:
#                         /srv/mos/.git/worktrees/ifukam2z          (rc=128)
#
# -- git IS in the image, and the repository is still not a repository from
# inside it, because this checkout is a git WORKTREE whose `.git` is a 41-byte
# file naming a gitdir OUTSIDE the mount. A build.rs that shelled out to git
# would fail there, or -- written the way build scripts usually are, tolerating
# a missing git -- would embed nothing on every single build and look like it
# worked. So the value is resolved on the HOST, where the repository is a
# repository, and handed in as an environment variable.
#
# AN EMPTY VALUE IS NOT AN ERROR. `-e MOS_BUILD_COMMIT=` sets the variable to
# the empty string, `option_env!` yields `Some("")`, and both crates report
# `unknown` for it and still exit 0. A build outside a checkout must still
# produce a binary that can answer the question, even if the answer is that
# nobody recorded one.
#
# DIRTY IS MARKED, NEVER PASSED OFF AS THE CLEAN SHA. `git status --porcelain`
# and not `git diff`: an untracked-but-not-ignored `.rs` file is compiled into
# these binaries exactly like a modified one, so it makes the tree dirty here
# too.
#
# THE CALLER MAY SUPPLY IT. An already-resolved MOS_BUILD_COMMIT in the
# environment wins, which is how a build that knows its own provenance (a
# release pipeline handed a commit, a rebuild of an exported tarball with no
# .git at all) says so rather than being told it is `unknown`.
if [ -z "${MOS_BUILD_COMMIT:-}" ]; then
    MOS_BUILD_COMMIT=""
    if command -v git >/dev/null 2>&1 &&
        git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
        MOS_BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD 2>/dev/null || true)"
        if [ -n "${MOS_BUILD_COMMIT}" ] &&
            [ -n "$(git -C "${REPO_ROOT}" status --porcelain 2>/dev/null)" ]; then
            MOS_BUILD_COMMIT="${MOS_BUILD_COMMIT}-dirty"
        fi
    fi
fi
if [ -n "${MOS_BUILD_COMMIT}" ]; then
    echo "mosd: embedding build commit ${MOS_BUILD_COMMIT}"
else
    echo "mosd: no build commit could be resolved; mosd and apid will report unknown" >&2
fi

# THE RECORD THE SMOKE RUNNER READS, written beside the build rather than
# inferred from it. `os/verify/src/smoke.ts` asserts the commit these binaries
# REPORT against the commit this build EMBEDDED, and it has to take that second
# value from somewhere that is not `git rev-parse HEAD` at run time -- which
# would pass on any freshly built tree and assert only that somebody had just
# rebuilt. os/rootfs/build-v2.sh copies this into _out/<board>/ beside the
# factory root it goes into.
#
# THIS COPY DESCRIBES THE LAST BUILD FOR ANY TARGET, which is why the runner
# does not read it. MEASURED: an x64 rootfs build followed by
# `bash mosd/hack/build-aarch64.sh` leaves this file saying
# target=aarch64-unknown-linux-gnu while _out/x64/ still holds x86_64 binaries.
# The per-board copy build-v2.sh makes is what keeps the smoke runner comparing
# an image against the build that produced it rather than against whatever was
# compiled most recently.
#
# TAB-SEPARATED `key<TAB>value` with `#` comments, the shape
# os/build/src/stages.ts already writes for factory-root.txt, so one reader
# reads both.
MOSD_BUILD_RECORD="${REPO_ROOT}/_out/mosd-build.txt"
{
    echo "# What mosd/hack/build-target.sh built, and the commit it embedded in mosd and apid."
    echo "# Written on every build. os/rootfs/build-v2.sh copies it into _out/<board>/."
    echo "# An empty commit means none could be resolved; the binaries then report unknown."
    printf 'target\t%s\n' "${TARGET}"
    printf 'elf-arch\t%s\n' "${ELF_ARCH}"
    printf 'commit\t%s\n' "${MOS_BUILD_COMMIT}"
} >"${MOSD_BUILD_RECORD}"

# THE REPOSITORY IS MOUNTED, NOT mosd/, AND THAT IS NOT A CONVENIENCE.
# mosd/Cargo.toml's workspace members include `../update/sign` -- a crate that
# lives OUTSIDE the directory this script's own path arithmetic calls the
# workspace. Mounting mosd/ alone produced
#
#   error: failed to load manifest for workspace member `/src/../update/sign`
#   Caused by: No such file or directory (os error 2)
#
# which names the file and not the cause, and which the host build could never
# have hit because the host build could see the whole checkout. This was found
# by the switchover comparison, and it is precisely the class of thing that
# comparison exists to find: a container boundary drawn one directory too tight.
#
# The check below is the general form, so the next member added outside mosd/
# fails with a sentence instead of a missing file.
#
# AT A FIXED PATH, /src, deliberately. rustc records the paths it is given, so
# mounting the checkout where it happens to live would make the output depend on
# the directory the repository was cloned into -- two machines, same commit,
# different binaries, for a reason that is not about the source. It also means
# these binaries are NOT byte-comparable with a host cargo run from a different
# directory, which is the first variable the switchover comparison controlled.
while IFS= read -r m; do
    [ -n "${m}" ] || continue
    case "${m}" in
    ../*) ;;
    *) continue ;;
    esac
    abs="$(cd "${WORKSPACE}" && cd "$(dirname "${m}")" 2>/dev/null && pwd)/$(basename "${m}")" || abs=""
    case "${abs}" in
    "${REPO_ROOT}"/*) ;;
    *)
        echo "error: mosd/Cargo.toml lists the workspace member '${m}', which resolves outside ${REPO_ROOT}. This build mounts the repository into the container and nothing above it, so cargo would report that member as a missing Cargo.toml rather than as a member the container cannot see" >&2
        exit 1
        ;;
    esac
done < <(sed -n 's/^members = \[\(.*\)\]/\1/p' "${WORKSPACE}/Cargo.toml" | tr ',' '\n' | tr -d ' "')

# `--network host` is not used and is not needed: cargo fetches through the
# container's default network, and the only thing bound in is this repository.
docker run --rm \
    --platform "linux/${IMAGE_ARCH}" \
    -v "${REPO_ROOT}:/src" \
    -v "${CARGO_CACHE}/registry:/usr/local/cargo/registry" \
    -v "${CARGO_CACHE}/git:/usr/local/cargo/git" \
    -w /src/mosd \
    -e "TARGET=${TARGET}" \
    -e "MOS_BUILD_COMMIT=${MOS_BUILD_COMMIT}" \
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
# IT IS A SECOND CONTAINER, NOT THE BUILD ONE, and not the host either. The
# separation is the one os/podman/build.sh and os/update/rauc/build.sh draw: the
# build asserts what it BUILT, this asserts what LANDED in the directory
# os/rootfs/build-v2.sh is about to copy from, so an export that dropped a file
# or a mount that wrote somewhere unexpected is caught rather than assumed away.
#
# Running it on the host would have been the obvious way to get that separation
# and it would have cost the thing this whole change buys: `file` would become a
# host requirement, and RFCT-108's outcome for this script is that the host
# needs docker and NOTHING else. A second `docker run` keeps both properties --
# and the `file` it uses is mos-build-base's, whose version images.env pins a
# floor for, rather than whatever the machine happens to ship.
docker run --rm \
    --platform "linux/${IMAGE_ARCH}" \
    -v "${WORKSPACE}/target:/target:ro" \
    -e "TARGET=${TARGET}" -e "ELF_ARCH=${ELF_ARCH}" \
    --entrypoint /bin/bash "${IMAGE}" -c '
        set -euo pipefail
        for name in mosd apid mos-mqttd mos-mqtt-broker; do
            bin="/target/${TARGET}/release/${name}"
            [ -f "${bin}" ] || { echo "error: ${name} was not produced by the build" >&2; exit 1; }
            got="$(file -b "${bin}")"
            case "${got}" in
            *"ELF 64-bit"*"${ELF_ARCH}"*) ;;
            *) echo "error: ${name} is not an ${ELF_ARCH} ELF: ${got}" >&2; exit 1 ;;
            esac
        done
        echo "mosd: four ${ELF_ARCH} ELFs in target/${TARGET}/release"
    '
for name in mosd apid mos-mqttd mos-mqtt-broker; do
    echo "${WORKSPACE}/target/${TARGET}/release/${name}"
done
