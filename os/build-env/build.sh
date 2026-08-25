#!/usr/bin/env bash
# Build the pinned mos builder images out of os/build-env/images.env.
#
#   make build-env                     -> localhost/mos-build-base
#   bash os/build-env/build.sh         same thing
#   MOS_BUILD_PLATFORM=linux/arm64 ... build for another architecture
#
# PLAN-014 M2 (RFCT-108). A driver script rather than a `docker buildx build`
# line in the Makefile, for the reason os/podman/build.sh gives: the builder
# selection and the lock derivation below are real logic, and a Makefile recipe
# that grew them would grow their bugs a second time. This is also where the
# pins are ENFORCED -- a digest reaches `FROM` only after this script has agreed
# it is a digest.
set -euo pipefail

# Path arithmetic, then proved rather than assumed. This script is invoked as
# `bash os/build-env/build.sh` from the repository root, but nothing here may
# depend on that: a relative path silently resolves against whatever the caller's
# working directory happened to be, and the failure surfaces as a missing file
# somewhere else. os-bundle-cx3576 spent two merges broken on exactly this.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
IMAGES_ENV="${HERE}/images.env"

for p in "${REPO_ROOT}/Makefile" "${REPO_ROOT}/os/build-env" "${IMAGES_ENV}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. os/build-env/build.sh derives REPO_ROOT as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done
[ "$(cd "${REPO_ROOT}/os/build-env" && pwd)" = "${HERE}" ] || {
    echo "error: ${REPO_ROOT}/os/build-env is not ${HERE}; REPO_ROOT was derived wrongly and every path below it is suspect" >&2
    exit 1
}

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH" >&2
    exit 1
}

# THE IMAGE TABLE. One row per builder image:
#
#   <directory under os/build-env/> : <lock key prefixes, comma-separated> : <images.env key holding its FROM>
#
# M2b appends c, go and rust here. Nothing else in this script knows how many
# images there are, and no image's row mentions another's keys -- that is what
# keeps one image's pin bump out of another image's cache key.
IMAGES=(
    "base:BASE_:IMAGE_DEBIAN_TRIXIE"
)

# ---------------------------------------------------------------------------
# Read the pins
# ---------------------------------------------------------------------------
# Comments and blank lines out, nothing else touched -- the same derivation
# os/podman/build.sh and os/update/rauc/build.sh use, so images.lock and
# versions.lock mean the same thing to a reader of either.
STRIPPED="$(sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "${IMAGES_ENV}")"
[ -n "${STRIPPED}" ] || {
    echo "error: ${IMAGES_ENV} carries no assignments once comments are stripped; every build below would run from an empty pin set" >&2
    exit 1
}

# Sourced, so that a value written as ${OTHER_KEY} expands the way it will when
# a Dockerfile sources the same lock.
# shellcheck disable=SC1090
. <(printf '%s\n' "${STRIPPED}")

mapfile -t KEYS < <(printf '%s\n' "${STRIPPED}" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p')
[ "${#KEYS[@]}" -gt 0 ] || {
    echo "error: ${IMAGES_ENV} yielded no KEY=VALUE assignments; a pin file that parses to nothing passes every check below by having nothing to check" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# PENDING: the bump flow, and why it is fatal here
# ---------------------------------------------------------------------------
# EVERY key is scanned, not only the ones this run consumes. A PENDING that
# nothing reads yet is the worst kind: it sits in the tree looking recorded,
# green in every build, until the day something reads it. os/build-env/images.env
# explains why there is no environment variable that downgrades this to a
# warning, and how it differs from os/podman/versions.env on that one point.
resolve_digest() {
    # `imagetools inspect` prints the index digest first, then one per platform.
    # The whole output is captured before anything reads it: a `| head` here
    # would close the pipe under pipefail and turn "the tag resolved" into an
    # intermittent failure of the producer.
    local ref="$1" out digests
    out="$(docker buildx imagetools inspect "${ref}" 2>&1)" || {
        printf 'could not resolve %s:\n%s\n' "${ref}" "${out}" >&2
        return 1
    }
    digests="$(printf '%s\n' "${out}" | awk '/^Digest:[[:space:]]/{print $2}')"
    [ -n "${digests}" ] || { echo "no Digest: line in the output for ${ref}" >&2; return 1; }
    printf '%s\n' "${digests%%$'\n'*}"
}

pending=0
for k in "${KEYS[@]}"; do
    v="${!k-}"
    case "${v}" in
    *PENDING*) ;;
    *) continue ;;
    esac
    pending=1
    if [ "${k#IMAGE_}" != "${k}" ] && [ "${v%@PENDING}" != "${v}" ]; then
        ref="${v%@PENDING}"
        echo "resolving ${k} (${ref}) ..." >&2
        if got="$(resolve_digest "${ref}")"; then
            echo "DIGEST ${k} ${ref}@${got}"
            echo "error: ${k} is PENDING. Record the line above in os/build-env/images.env, then run again. Read it before pasting: a digest that moved because upstream rebuilt the tag is a different fact from a digest that moved because the tag was repointed" >&2
        else
            echo "error: ${k} is PENDING and the tag could not be resolved, so this build can neither run nor tell you what to record" >&2
        fi
    else
        echo "error: ${k} is PENDING. The build that consumes it prints the value it computed and fails, the same way os/podman/Dockerfile does; run that build and record what it prints in os/build-env/images.env" >&2
    fi
done
[ "${pending}" = 0 ] || {
    echo "error: os/build-env/images.env carries an unrecorded pin. This is a hard failure with no override, by design: a base image that is not pinned fails nothing downstream, so a warning here would float for as long as nobody reads the log" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# Every IMAGE_ key must be digest-pinned, and well-formed
# ---------------------------------------------------------------------------
# Checked before `FROM` sees it, so the refusal names the key and the file. Left
# to docker, a malformed reference is an error about a manifest, and a
# well-formed reference to a TAG is not an error at all -- it is the silent
# float this milestone exists to remove.
bad=0
for k in "${KEYS[@]}"; do
    [ "${k#IMAGE_}" != "${k}" ] || continue
    v="${!k-}"
    if [ "${v#*@}" = "${v}" ]; then
        echo "error: ${k}=${v} in os/build-env/images.env names a TAG and not a digest. A tag is repointed by upstream whenever it rebuilds; pin it as name:tag@sha256:<64 hex> (see the HOW TO BUMP A DIGEST note in that file)" >&2
        bad=1
    elif ! [[ "${v}" =~ ^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$ ]]; then
        echo "error: ${k}=${v} in os/build-env/images.env is not a well-formed digest pin. Expected name:tag@sha256: followed by exactly 64 lowercase hex digits" >&2
        bad=1
    fi
done
[ "${bad}" = 0 ] || exit 1

# ---------------------------------------------------------------------------
# Platform, and the builder that can reach it
# ---------------------------------------------------------------------------
# Defaults to the host. Cross-building a build environment is real work -- the
# floor assertions run INSIDE the image, so an arm64 mos-build-base runs its
# asserts under emulation -- and M2b's toolchain tarballs are per-architecture
# anyway, which is why images.env reserves GO_SHA256_<arch> rather than one key.
case "$(uname -m)" in
x86_64) HOST_PLATFORM=linux/amd64 ;;
aarch64 | arm64) HOST_PLATFORM=linux/arm64 ;;
*) HOST_PLATFORM="" ;;
esac
MOS_BUILD_PLATFORM="${MOS_BUILD_PLATFORM:-${HOST_PLATFORM}}"
[ -n "${MOS_BUILD_PLATFORM}" ] || {
    echo "error: $(uname -m) is not a platform this script maps; set MOS_BUILD_PLATFORM=linux/<arch> explicitly rather than letting the build guess" >&2
    exit 1
}
PLATFORM_ARCH="${MOS_BUILD_PLATFORM#linux/}"

# Same fallback, same builder name and the same condition as os/podman/build.sh
# and os/rootfs/build-v2.sh: if the current builder cannot run the target
# platform, use a docker-container builder, whose buildkit image bundles the
# emulators and needs no host binfmt registration. Two ways to get a
# cross-capable builder would be two things to keep working.
BUILDER_ARGS=()
if [ -z "${BUILDX_BUILDER:-}" ] && ! docker buildx inspect 2>/dev/null | grep -c "${MOS_BUILD_PLATFORM}" >/dev/null; then
    echo "note: current builder lacks ${MOS_BUILD_PLATFORM}; using docker-container builder 'mos-${PLATFORM_ARCH}'"
    docker buildx inspect "mos-${PLATFORM_ARCH}" >/dev/null 2>&1 ||
        docker buildx create --name "mos-${PLATFORM_ARCH}" --driver docker-container >/dev/null
    BUILDER_ARGS=(--builder "mos-${PLATFORM_ARCH}")
fi

# ---------------------------------------------------------------------------
# The table, checked before anything is built
# ---------------------------------------------------------------------------
# Every ${VAR}-assembled path and every key reference in the table, resolved up
# front rather than on the way past. A row is data, and a typo in one is found
# by the loop that reaches it -- which, once M2b adds three more rows, means
# discovering a misspelled directory after two images have already been built
# and tagged. Half a table is a worse state to be in than none of it, and the
# check that avoids it costs nothing.
bad=0
for row in "${IMAGES[@]}"; do
    name="${row%%:*}"
    rest="${row#*:}"
    prefixes="${rest%%:*}"
    from_key="${rest##*:}"

    [ -d "${HERE}/${name}" ] ||
        { echo "error: the image table names '${name}', but ${HERE}/${name} does not exist" >&2; bad=1; continue; }
    [ -f "${HERE}/${name}/Dockerfile" ] ||
        { echo "error: ${HERE}/${name}/Dockerfile does not exist" >&2; bad=1; }
    [ -n "${!from_key-}" ] ||
        { echo "error: the image table builds '${name}' FROM ${from_key}, and os/build-env/images.env defines no such key" >&2; bad=1; }

    # A prefix that matches nothing yields an empty lock, and an image that
    # asserts nothing at all is indistinguishable, in the output, from an image
    # whose every assertion passed.
    IFS=',' read -r -a pfx <<<"${prefixes}"
    for p in "${pfx[@]}"; do
        printf '%s\n' "${STRIPPED}" | sed -n "s/^\(${p}[A-Za-z0-9_]*=.*\)$/\1/p" | grep -c . >/dev/null ||
            { echo "error: no key in os/build-env/images.env starts with '${p}', so mos-build-${name} would be handed an empty lock and would assert nothing at all -- which looks exactly like passing" >&2; bad=1; }
    done
done
[ "${bad}" = 0 ] || exit 1

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
for row in "${IMAGES[@]}"; do
    name="${row%%:*}"
    rest="${row#*:}"
    prefixes="${rest%%:*}"
    from_key="${rest##*:}"

    DF_DIR="${HERE}/${name}"
    DOCKERFILE="${DF_DIR}/Dockerfile"
    LOCK="${DF_DIR}/images.lock"
    TAG="localhost/mos-build-${name}"
    from_value="${!from_key}"

    # The filtered lock: this image's own keys and nothing else, so that a pin
    # added for another image does not invalidate this one's layers. The
    # 42-minute measurement behind that is in os/podman/Dockerfile.
    : >"${LOCK}"
    IFS=',' read -r -a pfx <<<"${prefixes}"
    for p in "${pfx[@]}"; do
        printf '%s\n' "${STRIPPED}" | sed -n "s/^\(${p}[A-Za-z0-9_]*=.*\)$/\1/p" >>"${LOCK}"
    done
    # Re-checked after writing, not only before: the pre-pass proved the keys
    # exist, this proves they reached the file docker is about to copy in.
    [ -s "${LOCK}" ] || {
        echo "error: ${LOCK} came out empty, though os/build-env/images.env does carry '${prefixes}' keys; mos-build-${name} would assert nothing at all -- which looks exactly like passing" >&2
        exit 1
    }

    echo
    echo "=== mos-build-${name} ==="
    echo "  from      ${from_key}=${from_value}"
    echo "  platform  ${MOS_BUILD_PLATFORM}"
    echo "  pins      $(grep -c . "${LOCK}") from images.env: $(tr '\n' ' ' <"${LOCK}" | sed 's/=[^ ]*//g')"

    docker buildx build "${BUILDER_ARGS[@]}" \
        --platform "${MOS_BUILD_PLATFORM}" \
        --build-arg "MOS_BASE_IMAGE=${from_value}" \
        -f "${DOCKERFILE}" \
        -t "${TAG}" \
        --load \
        "${DF_DIR}"

    # The image asserted its floor while it was being built. This asserts what
    # LANDED in the local image store, which is a different claim: the same
    # separation os/podman/build.sh and os/update/rauc/build.sh draw between the
    # verify stage and the exported tree. A cache hit that served an older layer,
    # or a --load that tagged nothing, is invisible to the first check.
    id="$(docker image inspect --format '{{.Id}}' "${TAG}" 2>/dev/null || true)"
    [ -n "${id}" ] || {
        echo "error: the build reported success but ${TAG} is not in the local image store" >&2
        exit 1
    }
    #
    # The file read back is named after THIS image, not a fixed one. M2b's
    # mos-build-go is FROM mos-build-base and therefore inherits base.env: a
    # check for that filename would be satisfied by the parent's record and
    # would prove exactly nothing about the child. Each image records its own,
    # and each is asked for its own.
    recorded="$(docker run --rm --platform "${MOS_BUILD_PLATFORM}" --entrypoint /bin/sh "${TAG}" -c "cat /etc/mos-build/${name}.env 2>/dev/null || true")"
    [ -n "${recorded}" ] || {
        echo "error: ${TAG} carries no /etc/mos-build/${name}.env, so what it asserted at build time cannot be read back out of it. An image that inherits its parent's record and writes none of its own is asserting nothing under its own name" >&2
        exit 1
    }
    echo "  tagged    ${TAG}"
    echo "  image id  ${id}"
    printf '%s\n' "${recorded}" | sed 's/^/  /'
done
