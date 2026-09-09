#!/usr/bin/env bash
# Run the Rust gate inside localhost/mos-build-rust-check.
#
#   bash tests/rust-gate.sh              both workspaces
#   bash tests/rust-gate.sh mosd         pkgs/mosd only
#   bash tests/rust-gate.sh mos-deploy    pkgs/mos-deploy only
#
# It runs `pkgs/<ws>/hack/check.sh` UNMODIFIED. That is the whole contract of
# this file: the gate is those two scripts, this is the container they need, and
# a target that ran a different set of commands than the script the design docs
# name would recreate the failure it exists to fix -- a documented gate and a
# runnable gate that are not the same gate.
#
# Two workspaces, because pkgs/mos-deploy is its own `[workspace]` and
# `cargo clippy --workspace` from pkgs/mosd has not reached it since the split.
# One image serves both: same compiler, same four tools, different Cargo.lock.
#
# WHY A TARGET AT ALL. The tools used to come from /srv/mos-rust-tools, a host
# directory bind-mounted at /tools, named by no Makefile target and no script.
# It was emptied on 2026-08-29 and nothing went red, because nothing HERE ran
# this gate -- CI ran the same two scripts on a toolchain of its own, so the
# only thing that vanished was the local route, and it vanished silently.
# Being reachable as `make os-rust-gate` is what makes "nobody can run it here"
# a thing somebody notices.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
for p in "${REPO_ROOT}/Makefile" "${REPO_ROOT}/build-env/from.sh"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. tests/rust-gate.sh derives REPO_ROOT as one level above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

# The workspaces, and what each needs. Both run the same script name; only mosd
# needs the built-in UI tree, because only its `ui-bundle` crate embeds one.
ALL_WORKSPACES=(mosd mos-deploy)
WORKSPACES=()
if [ "$#" -eq 0 ]; then
    WORKSPACES=("${ALL_WORKSPACES[@]}")
else
    for arg in "$@"; do
        ok=0
        for w in "${ALL_WORKSPACES[@]}"; do [ "${arg}" = "${w}" ] && ok=1 && break; done
        [ "${ok}" = 1 ] || {
            echo "error: '${arg}' is not a workspace this gate knows. It runs pkgs/<ws>/hack/check.sh for: ${ALL_WORKSPACES[*]}" >&2
            exit 1
        }
        WORKSPACES+=("${arg}")
    done
fi

for w in "${WORKSPACES[@]}"; do
    [ -x "${REPO_ROOT}/pkgs/${w}/hack/check.sh" ] || {
        echo "error: ${REPO_ROOT}/pkgs/${w}/hack/check.sh is missing or not executable. This target runs that script and defines no gate of its own; without it there is nothing to run" >&2
        exit 1
    }
done

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. This gate runs inside localhost/mos-build-rust-check rather than on a host toolchain, which is what makes clippy, rustfmt, nextest and cargo-deny values build-env/images.env records instead of whatever the machine happens to have" >&2
    exit 1
}

# The image is amd64 because the gate compiles and RUNS the workspace's tests,
# and this host executes only its own architecture -- docs/design/build-harness.md
# section 5 measures that. A cross-built arm64 gate image would build and then
# die on its first test with `exec format error`.
case "$(uname -m)" in
x86_64) IMAGE_ARCH=amd64 ;;
aarch64 | arm64) IMAGE_ARCH=arm64 ;;
*)
    echo "error: $(uname -m) is not an architecture build-env/images.env pins this image for" >&2
    exit 1
    ;;
esac

IMAGE="$(bash "${REPO_ROOT}/build-env/from.sh" --arch="${IMAGE_ARCH}" --ref LOCAL_MOS_BUILD_RUST_CHECK)" || {
    echo "error: localhost/mos-build-rust-check:${IMAGE_ARCH} could not be resolved (see the message above). Build it: make build-env" >&2
    exit 1
}

# The built-in UI tree, produced on the host in the pinned bun container,
# because the gate's own route to it cannot run here: check.sh falls back to
# `bash apid/ui/build.sh`, which drives docker, and the Rust image carries no
# docker client. Building it here and passing MOS_APID_UI_DIST_DIR is the same
# handoff pkgs/mosd/hack/build-target.sh makes.
APID_UI_DIST="${REPO_ROOT}/_out/apid-ui/dist"
for w in "${WORKSPACES[@]}"; do
    [ "${w}" = mosd ] || continue
    bash "${REPO_ROOT}/pkgs/mosd/apid/ui/build.sh"
done

# Repo-local caches, not docker volumes and not $HOME/.cargo, for
# build-target.sh's reason: `rm -rf _out` then means what it says and the host
# carries no Rust state. The registry is shared with the cross build; the target
# directories are per workspace, because two Cargo.lock files in one
# CARGO_TARGET_DIR rebuild each other's dependencies on every alternation.
CARGO_CACHE="${REPO_ROOT}/_out/cargo"
mkdir -p "${CARGO_CACHE}/registry" "${CARGO_CACHE}/git"

failed=()
for w in "${WORKSPACES[@]}"; do
    TARGET_DIR="${REPO_ROOT}/_out/rust-gate/${w}"
    mkdir -p "${TARGET_DIR}"

    ui_args=()
    [ "${w}" = mosd ] && ui_args=(-v "${APID_UI_DIST}:/build/apid-ui:ro" -e "MOS_APID_UI_DIST_DIR=/build/apid-ui")

    echo
    echo "=== rust gate: pkgs/${w} in ${IMAGE} ==="

    # The repository is mounted read-only at the fixed path /src, the same
    # decision and the same path as pkgs/mosd/hack/build-target.sh: rustc records
    # the paths it is given, so mounting the checkout where it happens to live
    # would make diagnostics depend on the directory the repository was cloned
    # into. Read-only is also an assertion -- a gate that can write to the tree
    # it is judging is one that can fix what it found.
    rc=0
    docker run --rm \
        --label ai-agent=true \
        --platform "linux/${IMAGE_ARCH}" \
        -v "${REPO_ROOT}:/src:ro" \
        -v "${TARGET_DIR}:/target" \
        -v "${CARGO_CACHE}/registry:/usr/local/cargo/registry" \
        -v "${CARGO_CACHE}/git:/usr/local/cargo/git" \
        ${ui_args[@]+"${ui_args[@]}"} \
        -w "/src/pkgs/${w}" \
        -e "CARGO_TARGET_DIR=/target" \
        -e "MOS_RUST_GATE_WORKSPACE=${w}" \
        --entrypoint /bin/bash \
        "${IMAGE}" -c '
            set -euo pipefail
            # The image records what it is; this reads it back, so the gate log
            # answers "which clippy said that" without anyone having to know
            # which image was current. build-env/build.sh refuses to tag an
            # image with no record, so an absent one means this is not that
            # image.
            [ -f /etc/mos-build/rust-check.env ] || {
                echo "error: this image carries no /etc/mos-build/rust-check.env, so what ran this gate cannot be read back out of it" >&2
                exit 1
            }
            . /etc/mos-build/rust-check.env
            echo "gate: pkgs/${MOS_RUST_GATE_WORKSPACE} with rustc ${MOS_BUILD_RUSTC}, clippy ${MOS_BUILD_CLIPPY}, rustfmt ${MOS_BUILD_RUSTFMT}, nextest ${MOS_BUILD_NEXTEST}, deny ${MOS_BUILD_DENY} from ${MOS_BUILD_IMAGE}"
            # Unmodified, and invoked with `bash -c` above rather than `bash -lc`:
            # -l sources /etc/profile, which overwrites the PATH this container
            # was given and takes /opt/rust/bin with it.
            bash hack/check.sh
        ' || rc=$?

    if [ "${rc}" != 0 ]; then
        echo "rust gate: pkgs/${w} FAILED (rc=${rc})" >&2
        failed+=("${w}")
    fi
done

if [ "${#failed[@]}" -gt 0 ]; then
    echo >&2
    echo "error: the Rust gate is red for: ${failed[*]}. Nothing above was softened to get here -- the invocation is pkgs/<ws>/hack/check.sh unchanged, clippy still at -D warnings" >&2
    exit 1
fi

echo
echo "RUST GATE PASSED (${WORKSPACES[*]})"
