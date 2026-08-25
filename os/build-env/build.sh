#!/usr/bin/env bash
# Build the pinned mos builder images out of os/build-env/images.env.
#
#   make build-env                     -> localhost/mos-build-{base,c,go,rust}
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
# Nothing else in this script knows how many images there are, and no image's
# row mentions another's keys -- that is what keeps one image's pin bump out of
# another image's cache key.
#
# ORDER IS SEMANTIC, not cosmetic. c, go and rust are built FROM
# LOCAL_MOS_BUILD_BASE, which is the tag the `base` row produces earlier in this
# same run. A row whose FROM is a localhost/mos-build-* tag must therefore come
# AFTER the row that produces it, or it silently builds on whatever a previous
# run left in the local image store -- and a stale parent is invisible in the
# output, because every assertion the child makes is about the child. The check
# below enforces the ordering rather than trusting this comment.
IMAGES=(
    "base:BASE_:IMAGE_DEBIAN_TRIXIE"
    "c:C_:LOCAL_MOS_BUILD_BASE"
    "go:GO_:LOCAL_MOS_BUILD_BASE"
    "rust:RUST_:LOCAL_MOS_BUILD_BASE"
)

# ---------------------------------------------------------------------------
# Which platform, decided before the pins are read
# ---------------------------------------------------------------------------
# Defaults to the host. Cross-building a build environment is real work -- the
# floor assertions run INSIDE the image, so an arm64 mos-build-base runs its
# asserts under emulation -- and the toolchain tarballs are per-architecture,
# which is why images.env records GO_SHA256_<arch> rather than one key.
#
# This sits ABOVE the pin scan because the table validation and the builder
# selection both need it, and because it creates nothing and touches no pin --
# the docker-container builder that MAY have to be created still happens after
# every pin has been checked.
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

# THE OTHER HALF OF THE BUMP FLOW: a sha256 this script fetches and computes,
# the way resolve_digest above resolves a tag. A pin is recordable only if
# something can tell you what to record; an instruction with no way to follow it
# is how PENDING placeholders end up commented out instead of filled in.
#
# IT RUNS ON THE HOST ARCHITECTURE, DELIBERATELY, and that is the property that
# makes a per-architecture pin recordable at all. The sha256 of a tarball does
# not depend on the machine that computes it, so GO_SHA256_ARM64 can be recorded
# from an amd64 laptop with no emulator, no binfmt registration and no arm64
# build. Tying the hash to a build OF that architecture would have made half the
# pins in images.env unrecordable by anyone who did not own the other machine --
# and unrecordable pins are how a file like this fills up with commented-out
# placeholders.
#
# IT RUNS INSIDE IMAGE_DEBIAN_TRIXIE and not on the host, so that this script
# keeps needing docker and nothing else -- os/build-env/build.sh must not start
# requiring a host curl of a particular vintage to bump a pin. That the image is
# the digest-pinned one is not incidental either: fetching the bytes a pin will
# name, through an unpinned container, would be recording a hash measured by
# something nobody chose.
#
# WHAT IT IS NOT. This resolves; it does not verify. The verification lives in
# each image's own fetch stage, which re-fetches and re-checks against whatever
# got recorded here -- the same two-layer arrangement the digest pin has, where
# this script proves the reference is well-formed and the image proves the
# contents are what the reference promised. One place that computes and then
# checks its own answer is a check that cannot fail.
resolve_sha256() {
    # stdin: "<key> <url>" lines. stdout: "SHA256 <key> <value>" or "FAILED <key> <url>".
    docker run --rm -i --entrypoint /bin/sh "${IMAGE_DEBIAN_TRIXIE}" -c '
        set -eu
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq --no-install-recommends ca-certificates curl >/dev/null 2>&1
        while read -r k u; do
            [ -n "${k}" ] || continue
            if curl -fsSL --proto =https --tlsv1.2 --retry 3 --retry-delay 2 -o /tmp/f "${u}"; then
                echo "SHA256 ${k} $(sha256sum /tmp/f | cut -d" " -f1)"
            else
                echo "FAILED ${k} ${u}"
            fi
            rm -f /tmp/f
        done
    '
}

# The URL key that names the bytes a hash key is about, DERIVED rather than
# looked up in a second table: GO_SHA256_AMD64 -> GO_URL_AMD64,
# RUST_STD_SHA256_ARM64 -> RUST_STD_URL_ARM64. A second table would be a thing
# that can disagree with the first, and the disagreement would look exactly like
# a missing pin.
url_key_for() { printf '%s\n' "${1/_SHA256/_URL}"; }

# A PENDING falls into one of four cases, and conflating them is what makes a
# bump flow unusable:
#
#   IMAGE_*=name:tag@PENDING   resolvable here, by asking the registry.
#   <img>_SHA256_*             resolvable here, by fetching what <img>_URL_*
#                              names and hashing it.
#   a key nothing consumes     no image row owns its prefix, so nothing in this
#                              repository will ever read it. Refused by name.
#                              This is the dormant PENDING: green in every build,
#                              looking recorded, until the day something reads it.
#   a key with no URL sibling  consumed but unresolvable -- an instruction with
#                              no way to follow it. Refused by name.
#
# EVERY key is scanned, not only the ones this run consumes, and the order of
# the two passes below is load-bearing: an unpinned BASE IMAGE is refused before
# any hash is fetched, because the fetch happens THROUGH that image and a hash
# measured through an unpinned container is not a fact this file should record.
TABLE_PREFIXES=() # "<prefix> <image name>" pairs, so a refusal can name the build that fixes it
for row in "${IMAGES[@]}"; do
    rest="${row#*:}"
    IFS=',' read -r -a _pfx <<<"${rest%%:*}"
    for p in "${_pfx[@]}"; do TABLE_PREFIXES+=("${p} ${row%%:*}"); done
done

pending=0
for k in "${KEYS[@]}"; do
    v="${!k-}"
    case "${v}" in
    *PENDING*) ;;
    *) continue ;;
    esac
    [ "${k#IMAGE_}" != "${k}" ] || continue
    pending=1
    ref="${v%@PENDING}"
    echo "resolving ${k} (${ref}) ..." >&2
    if got="$(resolve_digest "${ref}")"; then
        echo "DIGEST ${k} ${ref}@${got}"
        echo "error: ${k} is PENDING. Record the line above in os/build-env/images.env, then run again. Read it before pasting: a digest that moved because upstream rebuilt the tag is a different fact from a digest that moved because the tag was repointed" >&2
    else
        echo "error: ${k} is PENDING and the tag could not be resolved, so this build can neither run nor tell you what to record" >&2
    fi
done
[ "${pending}" = 0 ] || {
    echo "error: os/build-env/images.env carries an unrecorded base image. This is a hard failure with no override, by design: a base image that is not pinned fails nothing downstream, so a warning here would float for as long as nobody reads the log" >&2
    exit 1
}

TO_RESOLVE=""
for k in "${KEYS[@]}"; do
    v="${!k-}"
    case "${v}" in
    *PENDING*) ;;
    *) continue ;;
    esac
    pending=1

    owner=""
    for pair in "${TABLE_PREFIXES[@]}"; do
        p="${pair%% *}"
        [ "${k#"${p}"}" != "${k}" ] || continue
        owner="${pair#* }"
        break
    done
    if [ -z "${owner}" ]; then
        echo "error: ${k} is PENDING and no image in os/build-env/build.sh's table consumes a '${k%%_*}_' key, so nothing in this repository will ever read it. A pin no build reads looks recorded and stays green until the day something does; record it against a consumer or delete it" >&2
        continue
    fi

    uk="$(url_key_for "${k}")"
    if [ "${uk}" = "${k}" ] || [ -z "${!uk-}" ]; then
        echo "error: ${k} is PENDING and os/build-env/images.env defines no ${uk}, so nothing names the bytes whose hash you are being asked to record. mos-build-${owner} would be told to verify a download nobody described" >&2
        continue
    fi
    TO_RESOLVE="${TO_RESOLVE}${k} ${!uk}"$'\n'
done

if [ -n "${TO_RESOLVE}" ]; then
    echo "resolving $(printf '%s' "${TO_RESOLVE}" | grep -c .) unrecorded hash(es) through ${IMAGE_DEBIAN_TRIXIE} ..." >&2
    printf '%s' "${TO_RESOLVE}" | resolve_sha256 | while read -r tag key val; do
        if [ "${tag}" = SHA256 ]; then
            echo "SHA256 ${key} ${val}"
            echo "error: ${key} is PENDING. Record ${key}=${val} in os/build-env/images.env, then run again. Read it before pasting: this measured the bytes upstream is serving TODAY, which is a different fact from the bytes this tree agreed to compile with -- if it differs from a value already recorded, something moved and pasting over it hides what" >&2
        else
            echo "error: ${key} is PENDING and ${val} could not be fetched, so this build can neither run nor tell you what to record" >&2
        fi
    done
fi
[ "${pending}" = 0 ] || {
    echo "error: os/build-env/images.env carries an unrecorded pin. This is a hard failure with no override, by design: a toolchain that is not pinned by hash is a toolchain nobody chose, and a warning here would float for as long as nobody reads the log" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# Every IMAGE_ key must be digest-pinned, and well-formed
# ---------------------------------------------------------------------------
# Checked before `FROM` sees it, so the refusal names the key and the file. Left
# to docker, a malformed reference is an error about a manifest, and a
# well-formed reference to a TAG is not an error at all -- it is the silent
# float this milestone exists to remove.
#
# DELEGATED TO os/build-env/from.sh SINCE M2c, where it used to be written out
# here. M2c gave every Dockerfile in the tree its FROM as a build argument, so
# eight other call sites now need exactly this judgement, and two copies of "is
# this a digest" is one copy that eventually stops being it. --check validates
# EVERY IMAGE_ key, which is the same scope this loop had and the same scope the
# PENDING scan above has: a pin that is wrong is wrong the day it is written.
bash "${HERE}/from.sh" --check

# ---------------------------------------------------------------------------
# The one pin that cannot be delivered by from.sh: `# syntax=`
# ---------------------------------------------------------------------------
# Every Dockerfile in this tree opens with `# syntax=<image>`, and BuildKit
# hands the file to THAT image to parse before any ARG exists -- so unlike every
# FROM in the tree it cannot be fed a --build-arg, and os/build-env/from.sh has
# no way to reach it. The reference has to be written out at each Dockerfile.
#
# WHICH IS EXACTLY THE SHAPE M2b REFUSED -- a value in more than one place, of
# which all but one eventually stop being it -- so the copies are checked here
# instead of trusted. images.env stays the single source: it holds the digest,
# and a Dockerfile whose line has drifted from it fails `make build-env` by
# name. Bumping the frontend is one PENDING in images.env and twelve edits this
# refuses to let anyone forget.
#
# EVERY TRACKED DOCKERFILE, not a list kept here. A list would be the second
# table again, one level up, and a Dockerfile added without being added to it
# would be the unpinned frontend this check exists to prevent -- silently, since
# nothing would look at it. git ls-files is the same derivation
# os/tests/shell-pipefail-lint.sh uses for the same reason.
#
# A DOCKERFILE WITH NO `# syntax=` LINE AT ALL IS ACCEPTED, and that is a
# decision rather than a gap: without the directive BuildKit uses the frontend
# built into the daemon, fetches nothing, and there is no floating reference to
# pin. What must not happen is a directive naming something OTHER than the
# recorded digest.
check_dockerfile_frontends() {
    local f line bad=0 seen=0
    while IFS= read -r f; do
        [ -f "${REPO_ROOT}/${f}" ] || continue
        line="$(sed -n '1,3s/^#[[:space:]]*syntax=[[:space:]]*//p' "${REPO_ROOT}/${f}" | head -n1)"
        [ -n "${line}" ] || continue
        seen=$((seen + 1))
        [ "${line}" = "${IMAGE_DOCKERFILE_FRONTEND}" ] && continue
        echo "error: ${f} declares '# syntax=${line}', but os/build-env/images.env records IMAGE_DOCKERFILE_FRONTEND=${IMAGE_DOCKERFILE_FRONTEND}. The frontend parses this Dockerfile before any ARG exists, so it cannot be passed as a build argument and the reference has to be written out here -- which is why it is checked against the file rather than trusted. Change images.env and every Dockerfile together, or neither" >&2
        bad=1
    done < <(cd "${REPO_ROOT}" && git ls-files '*Dockerfile' '*Dockerfile.*' '*/Dockerfile' 2>/dev/null)
    [ "${seen}" -gt 0 ] || {
        echo "error: no tracked Dockerfile declares a '# syntax=' line, so this check passed by having nothing to check. Every Dockerfile in this tree carried one when it was written; if that is genuinely no longer true, delete this check rather than leaving it green and empty" >&2
        return 1
    }
    [ "${bad}" = 0 ] && echo "frontend pin: ${seen} Dockerfile(s) agree with IMAGE_DOCKERFILE_FRONTEND" >&2
    return "${bad}"
}
[ -n "${IMAGE_DOCKERFILE_FRONTEND-}" ] || {
    echo "error: os/build-env/images.env defines no IMAGE_DOCKERFILE_FRONTEND, but every Dockerfile in this tree names a frontend image on its '# syntax=' line. Without the key there is nothing to check those twelve copies against" >&2
    exit 1
}
check_dockerfile_frontends

# ---------------------------------------------------------------------------
# The builder that can reach the chosen platform
# ---------------------------------------------------------------------------
# THE `default` BUILDER IS NAMED EXPLICITLY FOR A NATIVE BUILD, and that is the
# one place this differs from os/podman/build.sh and os/rootfs/build-v2.sh --
# which pass no --builder at all and inherit whatever `docker buildx use` last
# selected. This family cannot inherit it, for a reason those two do not have:
# three of the four images are FROM localhost/mos-build-base, a tag that exists
# only in the LOCAL DOCKER IMAGE STORE, and only the `docker` driver can resolve
# one. A docker-container builder has its own content store and treats
# `localhost/...` as a registry HOSTNAME -- measured here, and what it produces
# is `dial tcp [::1]:80: connect: connection refused` pointing at a FROM line
# that is not wrong. Inheriting the ambient builder meant a leftover
# `mos-rauc-arm64` from an unrelated build broke `make build-env` while blaming
# the wrong file.
#
# So: native builds pin themselves to `default`. Cross builds still need a
# docker-container builder, whose buildkit image bundles the emulators and needs
# no host binfmt registration -- same name and same creation as the two scripts
# above, so there is still only one way to get a cross-capable builder.
BUILDER_ARGS=(--builder default)
if [ "${MOS_BUILD_PLATFORM}" != "${HOST_PLATFORM}" ]; then
    # AND THEN THE LOCAL-TAG PROBLEM COMES BACK, so it is refused here by name
    # rather than surfacing as a connection error to port 80. Closing it needs
    # the parent handed over as CONTENT rather than as a tag -- exporting each
    # image with `--output type=oci` and passing it to its children as
    # `--build-context <name>=oci-layout://<dir>` is the shape that works with a
    # container builder -- which is a change to how every image in the table is
    # published, not a flag. It belongs with M2c's rewiring, not in front of it.
    #
    # Recorded rather than worked around, because the thing it would buy is
    # already bought: the per-architecture toolchain hashes do NOT need a cross
    # build to be recorded (resolve_sha256 above computes them on the host), and
    # no target in this repository cross-builds the BUILDER images. What
    # os/podman/build.sh cross-builds is the podman components, FROM upstream
    # references a container builder can resolve.
    for row in "${IMAGES[@]}"; do
        from_key="${row##*:}"
        case "${!from_key-}" in
        localhost/*)
            echo "error: MOS_BUILD_PLATFORM=${MOS_BUILD_PLATFORM} is not the host ${HOST_PLATFORM}, so this build needs a docker-container builder -- and the '${row%%:*}' row is FROM ${from_key}=${!from_key}, a tag that exists only in the local docker image store, which that driver cannot read. It would fail resolving 'localhost' as a registry hostname. Note that the per-architecture toolchain hashes do NOT need a cross build to be recorded: os/build-env/build.sh resolves them on the host, because a tarball's sha256 does not depend on the machine that computes it" >&2
            exit 1
            ;;
        esac
    done
    echo "note: ${MOS_BUILD_PLATFORM} is not the host ${HOST_PLATFORM}; using docker-container builder 'mos-${PLATFORM_ARCH}'"
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
built_so_far=()
for row in "${IMAGES[@]}"; do
    name="${row%%:*}"
    rest="${row#*:}"
    prefixes="${rest%%:*}"
    from_key="${rest##*:}"

    # A row whose FROM is a tag THIS script produces has to come after the row
    # that produces it. Otherwise the build is green and wrong: docker finds a
    # localhost/mos-build-base left by an earlier run -- or by an earlier
    # checkout -- and builds the child on a parent that corresponds to nothing
    # in the tree. Nothing downstream can see that, because every assertion
    # inside the child is an assertion about the child.
    from_value_early="${!from_key-}"
    case "${from_value_early}" in
    localhost/mos-build-*)
        parent="${from_value_early#localhost/mos-build-}"
        found=0
        for b in ${built_so_far[@]+"${built_so_far[@]}"}; do
            [ "${b}" = "${parent}" ] && found=1 && break
        done
        [ "${found}" = 1 ] ||
            { echo "error: the image table builds '${name}' FROM ${from_key}=${from_value_early}, which this script produces from the '${parent}' row -- but that row does not come earlier in the table. '${name}' would build on whatever a previous run left tagged, and every assertion inside it would still pass" >&2; bad=1; }
        ;;
    esac
    built_so_far+=("${name}")

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
