#!/usr/bin/env bash
# Turn os/build-env/images.env keys into the --build-arg lines that carry a
# `FROM` into a Dockerfile, and refuse everything that must not reach one.
#
#   bash os/build-env/from.sh MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404
#       -> --build-arg MOS_IMAGE_UBUNTU_2404=ubuntu:24.04@sha256:33ceb719...
#   bash os/build-env/from.sh --ref IMAGE_ALPINE_3_21
#       -> alpine:3.21@sha256:48b0309c...
#   bash os/build-env/from.sh --check
#       -> validate every IMAGE_ key, print nothing, exit 0 or 1
#   bash os/build-env/from.sh --arch=arm64 --contexts=/some/dir LOCAL_MOS_BUILD_C
#       -> --build-context localhost/mos-build-c:arm64=oci-layout:///some/dir/mos-build-c-arm64
#
# A LOCAL_ key resolves to a tag that CARRIES its architecture, and --arch is
# what says which. os/build-env/images.env holds the repository name and no tag;
# this is the one place that puts the two together. RFCT-234 records why: the
# tag used to be architecture-less, so an arm64 `make build-env` overwrote the
# amd64 family's four tags on the same host, and an hour later the reverse.
#
# Every Dockerfile in this tree takes its base image as a build argument, and
# this is the only thing that produces one.

# --ref exists because `docker run` takes its image positionally and has no
# --build-arg to carry one, and around fifteen call sites in this tree are
# `docker run` -- including os/build/'s toolbox, which opens the containers
# that write the GPT, the filesystems and the signed update bundle. The
# alternative is for each of those call sites to cut the value back out of
# `--build-arg NAME=value`, which is fifteen small parsers of this script's
# output. One resolver, one validation path, two output shapes: the pair form
# for `docker build`, the bare reference for `docker run`. Both go through
# resolve_key below, so a key refused for a Dockerfile is refused identically
# for a container.

# A script rather than `$(grep ... images.env)` at each call site, because
# there are eight call sites -- os/pkgs/podman/build.sh, os/pkgs/rauc/build.sh,
# os/rootfs/build-v2.sh, os/tests/handshake-test/run.sh,
# os/pkgs/mosd/hack/build-target.sh and four os/boards/cx3576/bsp make recipes -- and the check
# that a value is a digest and not a tag is the entire point of the exercise. A
# grep at each call site is eight copies of that check, of which seven
# eventually stop being it. os/build-env/build.sh calls this too, with --check.

# The argument name is written out at each call site rather than derived from
# the key: deriving it would make the Dockerfile's ARG name a consequence of a
# naming rule in this file, and a reader of the Dockerfile would have to come
# here to learn what feeds it. `MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404` is the
# whole wiring, on one line, at the place that does the wiring.

# What it does not do: build anything, or pull anything. It reads a file and
# asks the local image store one question. A caller that gets output from this
# has a value it can put after `FROM`; a caller that gets a non-zero exit has a
# reason. --contexts is the one mode that also WRITES: it copies images the
# local store already holds into OCI layouts, for the callers whose builder
# cannot read that store. It still builds and pulls nothing.
set -euo pipefail

# Path arithmetic, proved rather than assumed -- os/build-env/build.sh derives
# REPO_ROOT the same way and for the same reason (os-bundle-cx3576 spent two
# merges broken on a relative path that resolved against the caller's cwd).
# This one is called from os/boards/cx3576/bsp/Makefile, whose cwd is four directories
# further down, so "the caller is at the repository root" is not merely
# something not to depend on: it is false at four of the eight call sites.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
IMAGES_ENV="${HERE}/images.env"

for p in "${REPO_ROOT}/Makefile" "${IMAGES_ENV}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. os/build-env/from.sh derives REPO_ROOT as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

STRIPPED="$(sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "${IMAGES_ENV}")"
[ -n "${STRIPPED}" ] || {
    echo "error: ${IMAGES_ENV} carries no assignments once comments are stripped, so every FROM below it would be handed an empty string" >&2
    exit 1
}
# shellcheck disable=SC1090
. <(printf '%s\n' "${STRIPPED}")

# The same expression os/build-env/build.sh applied to IMAGE_ keys before this
# file existed, now in one place. A tag is well-formed and resolves and is
# WRONG: it is the silent float this milestone removes, so it is named
# separately from a malformed reference.
check_image_key() {
    local k="$1" v="$2"
    case "${v}" in
    *PENDING*)
        echo "error: ${k}=${v} in os/build-env/images.env is still PENDING, so there is no recorded base image to build on. Run \`make build-env\`: it resolves the tag, prints the digest and fails, which is how a digest gets recorded here" >&2
        return 1
        ;;
    esac
    if [ "${v#*@}" = "${v}" ]; then
        echo "error: ${k}=${v} in os/build-env/images.env names a TAG and not a digest. A tag is repointed by upstream whenever it rebuilds; pin it as name:tag@sha256:<64 hex> (see the HOW TO BUMP A DIGEST note in that file)" >&2
        return 1
    fi
    if ! [[ "${v}" =~ ^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$ ]]; then
        echo "error: ${k}=${v} in os/build-env/images.env is not a well-formed digest pin. Expected name:tag@sha256: followed by exactly 64 lowercase hex digits" >&2
        return 1
    fi
    return 0
}

# A LOCAL_ key names an image this repository builds, so the question is not
# "is it a digest" -- it has none that survives a rebuild, and images.env says
# why -- but "is it here". Left to docker, a missing localhost/mos-build-c is
# reported as a failed pull from a registry called `localhost`, which names
# neither the image that is missing nor the command that makes it. This is also
# the check that keeps `make build-env` a real prerequisite rather than a step
# in a README.

# The architecture is part of the name it resolves TO, and --arch is what
# supplies it: `LOCAL_MOS_BUILD_C` plus `--arch=arm64` is
# `localhost/mos-build-c:arm64`. That is the one property a locally-tagged FROM
# loses relative to an upstream reference -- `debian:trixie-slim@sha256:...` is
# a multi-architecture index and docker picks the right manifest, while a local
# tag carries exactly one -- and it is recovered by putting the architecture in
# the tag rather than by hoping the store holds the right family.
#
# The check below therefore asks a DIFFERENT question than it used to. It is no
# longer "is the family the caller happens to have the one it needs": that is
# now answered by the name. It is "does this tag hold what its name says",
# which is what catches an image tagged by hand, or by a build that composed
# the suffix differently from this file.
FROM_ARCH=""
check_local_key() {
    local k="$1" v="$2" got
    case "${v}" in
    localhost/*) ;;
    *)
        echo "error: ${k}=${v} in os/build-env/images.env does not start with localhost/, but its LOCAL_ prefix says it is an image this repository builds. One of the two is wrong" >&2
        return 1
        ;;
    esac
    docker image inspect "${v}" >/dev/null 2>&1 || {
        echo "error: ${k} resolves to ${v}, which is not in the local docker image store. It is built by \`MOS_BUILD_PLATFORM=linux/${FROM_ARCH} make build-env\` (os/build-env/build.sh), which must run before any component build that stands on it -- there is no registry to fall back to and docker would report this as a failed pull from a host called 'localhost'. Note the architecture in that tag: a family for another architecture is a DIFFERENT tag and does not satisfy this, which is the point -- the two used to share one name and overwrite each other" >&2
        return 1
    }
    [ -n "${FROM_ARCH}" ] || return 0
    got="$(docker image inspect --format '{{.Architecture}}' "${v}" 2>/dev/null || true)"
    [ -n "${got}" ] || {
        echo "error: ${v} is in the local image store but reports no architecture, so nothing can say whether it matches the ${FROM_ARCH} build that is about to stand on it" >&2
        return 1
    }
    [ "${got}" = "${FROM_ARCH}" ] || {
        echo "error: ${k} resolves to ${v}, whose tag says ${FROM_ARCH} and whose image is ${got}. That tag is written by os/build-env/build.sh and by nothing else, so this is not a family that needs rebuilding -- it is a tag that lies about what it holds, which means it was applied by hand or by a build that composed the suffix differently from os/build-env/from.sh. Retag or rebuild it; do not pass --arch=${got} to make this sentence go away, because the FROM under it would then be the wrong architecture for the build that asked" >&2
        return 1
    }
    return 0
}

# One key to its validated value, and the only place that decides which check a
# key gets. Both output shapes call this: --ref prints what it returns, and the
# pair form wraps it in --build-arg. Written as a function rather than inlined
# twice because the dispatch below IS the policy -- "a base image is either an
# upstream reference pinned by digest or one this repository builds" -- and a
# policy stated in two places is a policy that eventually holds in one.
resolve_key() {
    local key="$1" val
    # `${!key-}` is empty for a key that is absent AND for a key that is
    # defined empty, and both are the same failure here: a FROM with nothing
    # after it. docker reports that as "base name should not be blank", which
    # names neither the key nor the file.
    val="${!key-}"
    if [ -z "${val}" ]; then
        echo "error: os/build-env/images.env defines no ${key}. Every base image in this tree is a key in that file; if this is a new one, add it there rather than writing it into a FROM or a docker run" >&2
        return 1
    fi
    case "${key}" in
    IMAGE_*) check_image_key "${key}" "${val}" || return 1 ;;
    LOCAL_*)
        # The architecture, appended HERE and in no other file. images.env holds
        # `localhost/mos-build-c` -- a repository with no tag -- and every
        # caller that wants one says which architecture it is building for. A
        # caller that does not say cannot be answered: both families are in the
        # store at once by design, so there is no "the" local image to fall back
        # to, and picking the host's would hand a native answer to a cross build
        # silently.
        [ -n "${FROM_ARCH}" ] || {
            echo "error: ${key} is an image this repository builds, and those are tagged by architecture -- localhost/mos-build-c:amd64 and localhost/mos-build-c:arm64 are two images that coexist. Pass --arch=<amd64|arm64> to say which this build stands on. Guessing the host's would be wrong for exactly the cross builds this naming exists to serve" >&2
            return 1
        }
        val="${val}:${FROM_ARCH}"
        check_local_key "${key}" "${val}" || return 1
        ;;
    *)
        echo "error: ${key} is neither an IMAGE_ nor a LOCAL_ key, so os/build-env/from.sh cannot say what would make it valid. A base image is either an upstream reference pinned by digest (IMAGE_) or one this repository builds (LOCAL_)" >&2
        return 1
        ;;
    esac
    printf '%s\n' "${val}"
}

# --check: every IMAGE_ key in the file, whether or not this run consumes it.
# os/build-env/build.sh calls this before it builds anything, for the reason its
# PENDING scan gives: a pin added for one build and wrong is wrong the day it is
# written, not the day something reads it.
if [ "${1-}" = "--check" ]; then
    [ "$#" -eq 1 ] || { echo "error: --check takes no other arguments" >&2; exit 1; }
    bad=0
    seen=0
    while IFS= read -r k; do
        [ "${k#IMAGE_}" != "${k}" ] || continue
        seen=$((seen + 1))
        check_image_key "${k}" "${!k-}" || bad=1
    done < <(printf '%s\n' "${STRIPPED}" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p')
    [ "${seen}" -gt 0 ] || {
        echo "error: os/build-env/images.env defines no IMAGE_ key at all, so this check passed by having nothing to check" >&2
        exit 1
    }
    exit "${bad}"
fi

if [ "${1-}" != "${1#--arch=}" ]; then
    FROM_ARCH="${1#--arch=}"
    shift
    [ -n "${FROM_ARCH}" ] || {
        echo "error: --arch= was given with no architecture. Omit the flag entirely to skip the check; an empty one reads like a check that ran" >&2
        exit 1
    }
fi

# --ref: the bare reference, for the callers that have nowhere to put a
# --build-arg. Exactly one key, and the value goes to stdout with nothing else
# on it, so `IMG="$(... --ref KEY)"` is the whole call site.
#
# One key and not a list, deliberately. A list would have to be read back by
# position, and a caller that mismatched the order would get a well-formed
# reference to the wrong image -- which is the one failure this file exists to
# prevent and the one a `docker run` would not report, because the wrong base
# still runs. One key per call is one answer that cannot be mis-indexed.
if [ "${1-}" = "--ref" ]; then
    shift
    [ "$#" -eq 1 ] || {
        echo "error: --ref takes exactly one os/build-env/images.env key. It prints one reference on stdout; a call with none would print an empty string that a caller would substitute into a docker command line as no image at all, and a call with several would have to be read back by position" >&2
        exit 1
    }
    resolve_key "$1"
    exit 0
fi

# --contexts: the same LOCAL_ images, handed to a builder that cannot read the
# local docker image store at all.
#
# The tag form above works for one driver only. `docker buildx build` with the
# `docker` driver resolves `localhost/mos-build-c` out of the image store;
# every other driver has its own content store and reads `localhost/` as a
# registry hostname. Measured on this host with the `mos-arm64`
# docker-container builder, against a FROM line that is correct:
#
#   ERROR: failed to resolve source metadata for localhost/mos-build-base:latest:
#   failed to do request: Head "http://localhost/v2/mos-build-base/manifests/latest":
#   dial tcp [::1]:80: connect: connection refused
#
# So the image is handed over as CONTENT rather than as a name. `docker image
# save` writes an OCI layout, and buildx takes one as a named build context
# whose name overrides a FROM -- so the Dockerfile keeps saying
# `FROM ${MOS_BUILD_C}` and neither it nor images.env learns anything about
# which driver is in use. Measured here on the mos-arm64 builder: the same
# probe that produced the refusal above, given the layout, ran its RUN step.
#
# A local `registry:2` on a host port is the other shape that could carry this,
# and it is not what this does. Measured, on the builder this tree creates:
# `docker inspect buildx_buildkit_mos-arm640` reports NetworkMode=bridge with
# its own address (172.17.0.2), so `localhost:<port>` inside it is its own
# loopback and not the host's, and the container carries no
# /etc/buildkit/buildkitd.toml, so an http registry would also need an
# insecure-registry configuration baked in at creation time. Both are creation
# options the two `docker buildx create` call sites in this tree do not pass --
# os/tests/quadlet-doc-test.sh:83-85 and os/build-env/build.sh -- so a registry
# would have to change every place a builder is made, and leave a long-lived
# container holding state that images.env exists to keep in the tree. An OCI
# layout needs no daemon, no port and no builder options.
#
# Only LOCAL_ keys. An IMAGE_ key is a digest-pinned upstream reference that
# every driver resolves for itself, and exporting one here would replace a
# multi-architecture index with the single manifest this host happens to hold.
if [ "${1-}" != "${1#--contexts=}" ]; then
    CTX_DIR="${1#--contexts=}"
    shift
    [ -n "${CTX_DIR}" ] || {
        echo "error: --contexts= was given with no directory. It is where the OCI layouts are written; an empty one would put them at the filesystem root" >&2
        exit 1
    }
    [ -d "${CTX_DIR}" ] || {
        echo "error: --contexts=${CTX_DIR} is not a directory. This writes one layout per key into it and does not create it: a caller that mistyped the path would otherwise get a tree of exports nothing reads" >&2
        exit 1
    }
    [ "$#" -gt 0 ] || {
        echo "error: --contexts= takes at least one LOCAL_ key. A call with none would print nothing and exit 0, and a caller that substituted that into a docker command line would build with no --build-context at all -- which is the unresolvable FROM this mode exists to prevent" >&2
        exit 1
    }
    CTX_ABS="$(cd "${CTX_DIR}" && pwd)"
    bad=0
    out=()
    for key in "$@"; do
        case "${key}" in
        LOCAL_*) ;;
        *)
            echo "error: ${key} is not a LOCAL_ key. Only an image this repository builds is exported as a layout; an IMAGE_ key is a digest-pinned upstream reference that every driver resolves for itself" >&2
            bad=1
            continue
            ;;
        esac
        # The same validation the pair form performs, including the --arch
        # check: a layout exported from a wrong-architecture image is a
        # well-formed context that fails at the FROM as "no match for platform
        # in manifest", which is the report this file exists to replace.
        if ! val="$(resolve_key "${key}")"; then
            bad=1
            continue
        fi
        # The layout directory is named after the tag with its colon replaced:
        # `mos-build-c:arm64` would put a colon in a path that is then handed to
        # buildx as `oci-layout://<path>`, and a colon in that position is not
        # worth finding out about at a FROM line.
        dir="${CTX_ABS}/$(printf '%s' "${val##*/}" | tr ':' '-')"
        rm -rf "${dir}"
        mkdir -p "${dir}"
        if ! docker image save "${val}" | tar -x -C "${dir}"; then
            echo "error: exporting ${val} to an OCI layout under ${dir} failed" >&2
            bad=1
            continue
        fi
        # What `docker image save` writes is the daemon's choice, not this
        # script's. Measured on this one -- docker 29.7.2 with the containerd
        # image store -- it writes an OCI layout: oci-layout, index.json and
        # blobs/, which is what buildx takes as oci-layout://. The format is
        # not a promise of the command, so it is checked rather than assumed;
        # anything else would surface at the FROM as an unreadable context
        # rather than as the daemon configuration it is.
        if [ ! -f "${dir}/oci-layout" ] || [ ! -f "${dir}/index.json" ]; then
            echo "error: \`docker image save ${val}\` did not produce an OCI layout (no oci-layout/index.json under ${dir}); this daemon writes the older docker-archive format, which buildx cannot take as a build context. A builder that cannot read the local image store needs the containerd image store enabled on the daemon that holds ${val}" >&2
            bad=1
            continue
        fi
        out+=(--build-context "${val}=oci-layout://${dir}")
    done
    [ "${bad}" = 0 ] || exit 1
    printf '%s\n' "${out[@]}"
    exit 0
fi

[ "$#" -gt 0 ] || {
    cat >&2 <<'USAGE'
usage: from.sh [--arch=<amd64|arm64>] <ARG_NAME>=<IMAGES_ENV_KEY> [...]
       from.sh [--arch=<amd64|arm64>] --ref <IMAGES_ENV_KEY>
       from.sh [--arch=<amd64|arm64>] --contexts=<DIR> <LOCAL_KEY> [...]
       from.sh --check

A call with no pairs would print nothing and exit 0, and a caller that
substituted that into a docker command line would build with no --build-arg at
all -- which is precisely the unpinned build this file exists to prevent.
USAGE
    exit 1
}

bad=0
out=()
for pair in "$@"; do
    arg="${pair%%=*}"
    key="${pair#*=}"
    if [ "${arg}" = "${pair}" ] || [ -z "${arg}" ] || [ -z "${key}" ]; then
        echo "error: '${pair}' is not <ARG_NAME>=<IMAGES_ENV_KEY>" >&2
        bad=1
        continue
    fi
    # The same validation --ref performs, because it IS --ref's: one dispatch,
    # so a key that a Dockerfile may not stand on is one a `docker run` may not
    # stand on either. The loop keeps going on a failure rather than exiting, so
    # a call naming four keys reports all four rather than the first.
    if ! val="$(resolve_key "${key}")"; then
        bad=1
        continue
    fi
    out+=(--build-arg "${arg}=${val}")
done
[ "${bad}" = 0 ] || exit 1

printf '%s\n' "${out[@]}"
