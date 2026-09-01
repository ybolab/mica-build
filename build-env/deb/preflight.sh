#!/usr/bin/env bash
# EVERY input `make os-debs` needs and does not have, reported in ONE run,
# before any container is started.
#
#   bash build-env/deb/preflight.sh
#   bash build-env/deb/preflight.sh --producer board-cx3576
#
# WHAT THIS REPLACES. `make os-debs` builds the discovered producers in
# sequence and each checks its own inputs when its turn comes. A missing BSP
# artefact therefore surfaced AFTER the producers before it had already been
# packed, named ONE file, and the operator learned about the next missing one
# on the next attempt -- one file per attempt, each attempt paying again for
# the builds that had succeeded. The inputs were always all knowable up front;
# nothing looked at them together.
#
# WHY NOT PRODUCE THE MISSING INPUT INSTEAD. The other shape considered for
# this was to have the aggregate build the cx3576 BSP as a stage. PLAN-036
# section 4 rules that out in as many words -- composition "does not compile a
# component and refuses a missing or stale package repository with the exact
# target that produces it" -- and a `make os-debs` that compiled a kernel would
# be that rule broken in the loudest available way. The complaint is that
# missing inputs are discovered late and one at a time, and the answer to that
# is to report them, not to make them.
#
# BOARD_DIR IS UNTOUCHED and stays the documented escape. It reaches a
# producer's hook through the environment here exactly as it reaches it from
# `make os-debs`, so this run and the build after it read the same directory.
#
# NOTHING HERE RE-IMPLEMENTS A DECLARATION. The producer set comes from
# build-env/deb/producers.sh, the base images from build-env/from.sh, and
# a producer's own artefact requirements from its PREPARE hook, run in the
# check-only mode described below -- which is the SAME code that refuses the
# build, so the two cannot come to disagree about what an input is. The only
# thing this script owns is the ORDER: examine everything, then report.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FROM_SH="${REPO_ROOT}/build-env/from.sh"
PRODUCERS_SH="${HERE}/producers.sh"
for p in "${REPO_ROOT}/Makefile" "${FROM_SH}" "${PRODUCERS_SH}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. build-env/deb/preflight.sh derives the repository as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

ONLY=""
while [ "$#" -gt 0 ]; do
    case "$1" in
    --producer)
        ONLY="${2-}"
        [ -n "${ONLY}" ] || { echo "error: --producer takes a producer name" >&2; exit 1; }
        shift 2
        ;;
    *)
        echo "usage: bash build-env/deb/preflight.sh [--producer <name>]" >&2
        exit 1
        ;;
    esac
done
# Resolved through discovery so that an unknown name is refused by discovery's
# one message, listing what does exist -- the same route build.sh takes.
[ -z "${ONLY}" ] || bash "${PRODUCERS_SH}" --dir-for "${ONLY}" >/dev/null

# An `all` producer packs at the HOST's architecture: its payload holds no ELF,
# so there is nothing to resolve against a foreign architecture's libraries and
# build-env/deb/build.sh builds it natively. The base image it will be handed
# is therefore the host's family, and asking for the other one here would report
# a missing input the build never wanted.
case "$(uname -m)" in
x86_64) HOST_ARCH=amd64 ;;
aarch64 | arm64) HOST_ARCH=arm64 ;;
*)
    echo "error: $(uname -m) is not an architecture build-env/images.env builds a mos-build-deb for, so there is no container any producer here could pack in" >&2
    exit 1
    ;;
esac

# Captured before it is read, never piped into the loop below: `producers.sh |
# while` reports the READER's status, so an empty discovery -- the one failure
# a pre-flight most needs to see -- would be swallowed and this would report
# that every input of no producers at all is present.
ROWS="$(bash "${PRODUCERS_SH}")"

PRODUCERS=0
CTX_N=0
HOOK_N=0
IMAGE_N=0
ARTEFACT_N=0
VF_N=0
REPORTS=()
MISSING_N=0
WARNED_N=0
# One reported input is one BLOCK and one COUNT, and the two are separate
# because a producer's own hook reports several inputs in one block and
# contributes its own count for them: a summary that counted blocks would say
# `1 missing` over a report that had just named four files.
note_missing() {
    REPORTS+=("$1")
    MISSING_N=$((MISSING_N + 1))
}

# THE TWO CATEGORIES, and the line between them is what the RUN would do about
# it, not how serious it looks.
#
#   MISSING  -- nothing in the run produces it. `make os-debs` gets no further
#               than the producer that needs it, so the run is refused here.
#   WARNED   -- the producer that needs it makes it itself, at a cost. The run
#               would succeed; it would just spend three quarters of an hour
#               somewhere the operator did not expect. That is a VISIBILITY
#               problem and it is answered by saying so, not by refusing.
#
# Refusing the second category would change what `make os-debs` MEANS -- its
# help line says it builds every Debian package, and a producer whose hook
# compiles its own input is how a pool comes to exist on a fresh host. Three of
# the five hooks here compile, so refusing on the fourth would also be
# arbitrary from the operator's side, and an arbitrary refusal is one people
# learn to route around.
note_warning() {
    REPORTS+=("$1")
    WARNED_N=$((WARNED_N + 1))
}
# Base images are declared per producer and shared between them; the pair
# (key, architecture) is checked once so that one absent builder family is one
# line in the report rather than ten copies of itself.
declare -A IMAGE_SEEN=()

while read -r producer dir arches _packages _enablement; do
    [ -n "${producer}" ] || continue
    [ -z "${ONLY}" ] || [ "${producer}" = "${ONLY}" ] || continue
    PRODUCERS=$((PRODUCERS + 1))
    producer_dir="${REPO_ROOT}/${dir}"

    # producer.env is plain KEY=value, and it is sourced in a SUBSHELL for the
    # reason producers.sh sources it in one: a producer must not be able to
    # change what this script does with the producers after it.
    vals="$(
        BUILD_CONTEXTS=""
        FROM_IMAGES=""
        PREPARE=""
        PREFLIGHT=""
        VERSION_FROM=""
        # shellcheck disable=SC1090
        . "${producer_dir}/producer.env"
        printf 'C=%s\nF=%s\nP=%s\nL=%s\nV=%s\n' "${BUILD_CONTEXTS}" "${FROM_IMAGES}" "${PREPARE}" "${PREFLIGHT}" "${VERSION_FROM}"
    )"
    contexts="$(printf '%s\n' "${vals}" | sed -n 's/^C=//p')"
    from_images="$(printf '%s\n' "${vals}" | sed -n 's/^F=//p')"
    prepare="$(printf '%s\n' "${vals}" | sed -n 's/^P=//p')"
    preflight="$(printf '%s\n' "${vals}" | sed -n 's/^L=//p')"
    version_from="$(printf '%s\n' "${vals}" | sed -n 's/^V=//p')"

    # ---------------------------------------------------------- build contexts
    #
    # build.sh refuses one of these too, and keeps doing so: `make
    # os-deb-<producer>` builds one producer without coming through here, and a
    # driver that trusted a check somewhere else would resolve a missing local
    # context as a REMOTE one and fail naming neither. The difference is when:
    # there, at that producer's turn; here, together with every other.
    for entry in ${contexts}; do
        CTX_N=$((CTX_N + 1))
        name="${entry%%=*}"
        path="${entry#*=}"
        if [ -z "${name}" ] || [ -z "${path}" ] || [ "${name}" = "${entry}" ]; then
            note_missing "error: ${dir}/producer.env declares the build context '${entry}', which is not <context name>=<repository-relative path>."
            continue
        fi
        [ -e "${REPO_ROOT}/${path}" ] || note_missing "error: ${dir}/producer.env declares the build context '${name}=${path}' and ${path} does not exist.
Every build context a producer names is a COMMITTED tree, so this is a path that
moved or a checkout that is incomplete -- not something a build produces."
    done

    # ------------------------------------------------- the upstream version
    #
    # build.sh refuses these too, at this producer's turn; here they are
    # reported together with every other missing input. The value's SHAPE
    # (digit after a stripped `v`) stays build.sh's own refusal: it is about
    # what the version MEANS, not about whether an input file is present.
    if [ -n "${version_from}" ]; then
        VF_N=$((VF_N + 1))
        vf_path="${version_from%%:*}"
        vf_key="${version_from##*:}"
        if [ -z "${vf_path}" ] || [ -z "${vf_key}" ] || [ "${vf_path}" = "${version_from}" ]; then
            note_missing "error: ${dir}/producer.env declares VERSION_FROM='${version_from}', which is not <repository-relative env file>:<KEY>."
        elif [ ! -f "${REPO_ROOT}/${vf_path}" ]; then
            note_missing "error: ${dir}/producer.env declares VERSION_FROM=${version_from} and ${vf_path} does not exist.
The upstream version this producer stamps comes from that file or from nowhere."
        elif [ -z "$(sed -n "s/^${vf_key}=//p" "${REPO_ROOT}/${vf_path}" | head -n1)" ]; then
            note_missing "error: ${dir}/producer.env declares VERSION_FROM=${version_from} and ${vf_path} declares no non-empty ${vf_key}.
An empty upstream version would compose into '+git<commit>-1', which dpkg accepts and orders below every real version."
        fi
    fi

    # ---------------------------------------------------------- the hook file
    if [ -n "${prepare}" ]; then
        HOOK_N=$((HOOK_N + 1))
        [ -f "${producer_dir}/${prepare}" ] || note_missing "error: ${dir}/producer.env names PREPARE=${prepare} and ${dir}/${prepare} does not exist.
The hook is the producer's own half of its build: it is what produces the payload
the packing step copies, so without it the build stages nothing."
    fi

    # ---------------------------------------------------------- the base images
    #
    # A LOCAL_ key resolves to a tag that carries its architecture and
    # build-env/from.sh answers "is it in this host's image store" -- it
    # builds nothing and pulls nothing. A missing builder family is otherwise
    # learned one producer at a time, in the middle of a run, and the message
    # that reaches the terminal first is buildx's failed pull from a registry
    # called `localhost`.
    #
    # LOCAL_MOS_BUILD_DEB is added UNBIDDEN because build.sh adds it unbidden:
    # a producer packs inside mos-build-deb by construction, which is what a
    # producer IS, so no producer.env names it. Only the KEYS are collected
    # here and not build.sh's <build-arg>=<key> pairs -- the question is
    # whether the image exists, and the argument name it will be carried in
    # cannot change that answer.
    keys="LOCAL_MOS_BUILD_DEB"
    for entry in ${from_images}; do
        keys="${keys} ${entry#*=}"
    done
    for arch in $(printf '%s' "${arches}" | tr ',' ' '); do
        image_arch="${arch}"
        [ "${arch}" != all ] || image_arch="${HOST_ARCH}"
        for key in ${keys}; do
            [ -z "${IMAGE_SEEN[${key}/${image_arch}]:-}" ] || continue
            IMAGE_SEEN["${key}/${image_arch}"]=1
            IMAGE_N=$((IMAGE_N + 1))
            out=""
            rc=0
            out="$(bash "${FROM_SH}" --arch="${image_arch}" --ref "${key}" 2>&1)" || rc=$?
            [ "${rc}" -eq 0 ] || note_missing "${out}"
        done
    done

    # ------------------------------------------- the producer's own artefacts
    #
    # What no key in producer.env can express: the BOARD_DIR-selected BSP
    # artefacts, which are chosen at run time and so cannot be written down as
    # the fixed repository-relative paths a build context is. The hook that
    # refuses them at build time is asked here, in check-only mode, so that the
    # list of BSP inputs has exactly one implementation.
    #
    # OPT-IN, and that is the whole reason for the PREFLIGHT key. A hook that
    # had not been taught MOS_DEB_PREFLIGHT would do its full work: the podman
    # hook compiles a container engine from six upstream clones, three quarters
    # of an hour of it under emulation for arm64. A pre-flight that compiles is
    # not a pre-flight.
    #
    # THE CONTRACT. In this mode the hook is given MOS_DEB_REPO_ROOT,
    # MOS_DEB_PRODUCER, MOS_DEB_PRODUCER_DIR, MOS_DEB_ARCH and
    # MOS_DEB_PREFLIGHT=1, and deliberately NO MOS_DEB_STAGE -- there is
    # nothing to stage into, and a hook that wrote anywhere in this mode would
    # be writing before the operator had been told what is missing. It prints
    # what it found, then THREE counts -- `preflight-examined:`,
    # `preflight-missing:` and `preflight-warned:` -- and exits non-zero if and
    # only if the missing one is not zero.
    #
    # ALL THREE ARE REQUIRED, ON BOTH PATHS, and a zero is WRITTEN rather than
    # omitted. A hook that reported success without saying what it looked at is
    # indistinguishable from one that looked at nothing; a failing hook that
    # reported no missing count would arrive here as one report and be counted
    # as one file however many it had just listed; and a hook with no warning
    # count would make "this producer has nothing it can produce for itself"
    # and "this hook has not been taught the category" the same run.
    if [ -n "${preflight}" ] && [ "${preflight}" != 0 ]; then
        [ -n "${prepare}" ] || {
            echo "error: ${dir}/producer.env declares PREFLIGHT=${preflight} and no PREPARE. The pre-flight mode is a mode OF the PREPARE hook; there is no other script here to run in it" >&2
            exit 1
        }
        # A hook file that is ABSENT has already been reported above as the
        # missing input it is, and is not run: bash would fail to open it, and
        # this would replace that report with a refusal about a contract a file
        # that does not exist cannot keep.
        for arch in $(! [ -f "${producer_dir}/${prepare}" ] || printf '%s' "${arches}" | tr ',' ' '); do
            out=""
            rc=0
            out="$(
                MOS_DEB_PREFLIGHT=1 \
                    MOS_DEB_REPO_ROOT="${REPO_ROOT}" \
                    MOS_DEB_PRODUCER="${producer}" \
                    MOS_DEB_PRODUCER_DIR="${producer_dir}" \
                    MOS_DEB_ARCH="${arch}" \
                    bash "${producer_dir}/${prepare}" 2>&1
            )" || rc=$?
            n="$(printf '%s\n' "${out}" | sed -n 's/^preflight-examined: //p' | tail -1)"
            m="$(printf '%s\n' "${out}" | sed -n 's/^preflight-missing: //p' | tail -1)"
            w="$(printf '%s\n' "${out}" | sed -n 's/^preflight-warned: //p' | tail -1)"
            # Each count checked ON ITS OWN, and an empty one is a failure
            # rather than a zero. Testing them concatenated is wrong in the one
            # direction that matters: a hook that printed no examined count and
            # a missing count of 0 gives "0", which passes as a number and adds
            # nothing to the total -- a hook that checked nothing, reported as a
            # pre-flight that found everything present.
            #
            # Only `examined` refuses a zero, and the asymmetry is deliberate: a
            # hook that examined nothing has nothing to say about its producer,
            # while zero missing and zero warned are the ordinary answer of a
            # producer whose inputs are all there.
            bad=""
            case "${n}" in '' | *[!0-9]* | 0) bad="preflight-examined" ;; esac
            case "${m}" in '' | *[!0-9]*) bad="${bad:+${bad} and }preflight-missing" ;; esac
            case "${w}" in '' | *[!0-9]*) bad="${bad:+${bad} and }preflight-warned" ;; esac
            [ -z "${bad}" ] || {
                echo "error: ${dir}/${prepare} ran in pre-flight mode for ${arch} and did not print a usable ${bad} count. A hook says what it looked at with 'preflight-examined: <count>', how much of it nothing in the run can make with 'preflight-missing: <count>', and how much the producer will make for itself with 'preflight-warned: <count>' -- all three on every path, and the first above zero. Without them a hook that checked nothing reads exactly like one that checked everything, and a report naming four files is counted as one:" >&2
                printf '%s\n' "${out}" >&2
                exit 1
            }
            ARTEFACT_N=$((ARTEFACT_N + n))
            if [ "${m}" -gt 0 ] || [ "${w}" -gt 0 ]; then
                # The contract lines are for this script, not for the operator;
                # the report above them is what names the files, and it carries
                # its own error:/warning: prefixes.
                REPORTS+=("$(printf '%s\n' "${out}" | grep -v '^preflight-\(examined\|missing\|warned\): ' || true)")
                MISSING_N=$((MISSING_N + m))
                WARNED_N=$((WARNED_N + w))
            fi
            # A hook that exited non-zero having reported nothing missing is a
            # hook that failed for some other reason -- an unreadable board.env,
            # a renamed template -- and that reason must not be swallowed as a
            # clean run.
            [ "${rc}" -eq 0 ] || [ "${m}" -gt 0 ] || {
                echo "error: ${dir}/${prepare} exited ${rc} in pre-flight mode for ${arch} while reporting nothing missing. A hook refuses by counting what it cannot find; a non-zero exit with a zero missing count is a failure of the hook itself:" >&2
                printf '%s\n' "${out}" >&2
                exit 1
            }
        done
    fi
done <<<"${ROWS}"

EXAMINED=$((CTX_N + HOOK_N + IMAGE_N + ARTEFACT_N + VF_N))
BREAKDOWN="${CTX_N} build context(s), ${HOOK_N} PREPARE hook(s), ${IMAGE_N} base image(s), ${VF_N} upstream version source(s) and ${ARTEFACT_N} producer artefact(s)"

# A count refused rather than reported. Every number above is derived from a set
# discovered at run time, and each of them can go to zero -- a producer.env that
# stops declaring contexts, a discovery that matched nothing, a hook whose
# check-only mode was removed. This script would then print a green line having
# looked at nothing, which is worth less than no script at all.
[ "${EXAMINED}" -gt 0 ] || {
    echo "error: the pre-flight examined 0 inputs across ${PRODUCERS} producer(s) (${BREAKDOWN}) and would report success by having checked nothing. Every one of those counts is read out of the tree at run time; a zero means the declarations moved, not that there is nothing to build" >&2
    exit 1
}

[ "${#REPORTS[@]}" -eq 0 ] || printf '%s\n\n' "${REPORTS[@]}" >&2

# THE VERDICT IS ONE LINE, and the warning count is its OWN line rather than
# folded into it. Two numbers in one sentence is how a category that does not
# fail a run stops being visible: it gets read as part of the total, and then
# as noise.
PRESENT_N=$((EXAMINED - MISSING_N - WARNED_N))
if [ "${MISSING_N}" -gt 0 ]; then
    echo "preflight: ${MISSING_N} of ${EXAMINED} examined inputs are missing across ${PRODUCERS} producer(s): ${BREAKDOWN}. Every one of them is listed above -- nothing was built and no container was started." >&2
else
    echo "preflight: ${PRESENT_N} of ${EXAMINED} examined inputs are present across ${PRODUCERS} producer(s): ${BREAKDOWN}"
fi
if [ "${WARNED_N}" -gt 0 ]; then
    echo "preflight: a further ${WARNED_N} of ${EXAMINED} are absent and will be BUILT BY THE RUN ITSELF, at the cost named in the warnings above. Making them first is how that cost is paid where it can be seen; it is not a prerequisite." >&2
fi
[ "${MISSING_N}" -eq 0 ] || exit 1
