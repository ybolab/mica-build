#!/usr/bin/env bash
# os/rootfs/packages/resolve.sh, driven over the boards, profiles, radios and
# features this repository actually supports.
#
# Three things are asserted and the third is the one that is easy to skip:
#
#   1. THE RESOLVED SETS, for both boards at both profiles, and for a build that
#      declines every feature. Written out literally: a test that recomputed the
#      answer from the manifests would agree with any manifest at all.
#   2. EVERY REFUSAL, each proven RED BY MUTATION. A copy of the manifest tree
#      is made under tmp/, perturbed there, and the refusal is required to fire
#      on the copy and NOT on the pristine one -- a negative test whose removal
#      changes nothing is not a test. Each is matched on a FRAGMENT of its
#      message and not on the exit status alone, because a perturbed tree is
#      usually true of more than one refusal at once; and every fragment is then
#      required to be absent from all the other refusals' messages, so a
#      fragment that stopped discriminating fails here rather than silently
#      accepting whichever refusal happened to fire.
#   3. THE REVERSE DIRECTION: every package every producer declares has to be
#      reachable by SOME legal resolution. A package no manifest can ever name
#      is a package the composer will never install, and nothing else in this
#      repository would notice -- every check downstream of composition runs
#      over the set that WAS installed. Both counts are printed and a zero on
#      either side fails.
#
# No docker, no build, no pool: this reads manifests and runs producers.sh.
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
export LC_ALL=C

PACKAGES_DIR="${REPO_ROOT}/os/rootfs/packages"
# tmp/ and not /tmp: the repository-local scratch, per .gitignore.
SCRATCH="${REPO_ROOT}/tmp/rootfs-manifest-test.$$"
mkdir -p "${SCRATCH}"
trap 'rm -rf "${SCRATCH}"' EXIT

PASS_N=0
FAIL_N=0
pass() {
    PASS_N=$((PASS_N + 1))
    echo "PASS: $1"
}
fail() {
    FAIL_N=$((FAIL_N + 1))
    echo "FAIL: $1"
}

resolve_out=""
resolve_err=""
resolve_rc=0
# Runs resolve.sh out of a NAMED directory, so the same call drives the tracked
# manifests and a perturbed copy of them. resolve.sh finds the repository by
# walking up to the Makefile, so a copy under tmp/ resolves against the same
# producers the tracked one does.
run_resolve() {
    local dir="$1"
    shift
    local errfile="${SCRATCH}/stderr"
    resolve_out=""
    resolve_rc=0
    if resolve_out="$(bash "${dir}/resolve.sh" "$@" 2>"${errfile}")"; then
        resolve_rc=0
    else
        resolve_rc=$?
    fi
    resolve_err="$(cat "${errfile}")"
    rm -f "${errfile}"
    # The directory is what differs between the pristine tree and each copy, so
    # it is normalised out before the messages are compared to each other.
    resolve_err="${resolve_err//${dir}/<MANIFESTS>}"
}

REFUSAL_LABELS=()
REFUSAL_TOKENS=()
REFUSAL_TEXTS=()
# label, the fragment the message must carry, manifest dir, args.
#
# Matching the MESSAGE and not only the exit status is the point: a refusal that
# fired for an unrelated reason is not the refusal under test, and every fault
# here is reachable from a tree in which some OTHER fault is also true. The
# fragments are held to their own standard below -- each has to be absent from
# every other refusal's message -- so a fragment that stopped discriminating
# turns this file red rather than quietly accepting the wrong refusal.
expect_refusal() {
    local label="$1" token="$2" dir="$3"
    shift 3
    run_resolve "${dir}" "$@"
    if [ "${resolve_rc}" -eq 0 ]; then
        fail "${label}: resolve.sh SUCCEEDED where it had to refuse. It printed: $(printf '%s' "${resolve_out}" | tr '\n' ' ')"
        return
    fi
    if [ "${resolve_err}" = "${resolve_err/${token}/}" ]; then
        fail "${label}: refused, but with a message that does not carry '${token}', so this is some OTHER refusal firing: ${resolve_err}"
        return
    fi
    REFUSAL_LABELS+=("${label}")
    REFUSAL_TOKENS+=("${token}")
    REFUSAL_TEXTS+=("${resolve_err}")
    pass "${label}: refused, naming '${token}'"
}

expect_set() {
    local label="$1" want="$2" dir="$3"
    shift 3
    run_resolve "${dir}" "$@"
    if [ "${resolve_rc}" -ne 0 ]; then
        fail "${label}: resolve.sh refused a legal resolution: ${resolve_err}"
        return
    fi
    local got
    got="$(printf '%s' "${resolve_out}" | tr '\n' ' ')"
    got="${got% }"
    if [ "${got}" = "${want}" ]; then
        pass "${label}: ${got}"
    else
        fail "${label}: resolved [${got}], expected [${want}]"
    fi
}

# ---------------------------------------------------------------------------
# 1. The resolved sets.
# ---------------------------------------------------------------------------

# The radios are read HERE and passed in, exactly as os/rootfs/build.sh does
# it: resolve.sh takes its inputs as arguments and re-derives none of them, so
# this test stands in for the driver rather than letting the resolver read the
# board file behind it.
board_radios() {
    local board="$1"
    local env_file="${REPO_ROOT}/os/boards/${board}/board.env"
    [ -f "${env_file}" ] || {
        echo "error: ${env_file} does not exist, but os/rootfs/packages holds a board-${board}.pkgs. A board with a package manifest and no layout is a board this test cannot resolve radios for" >&2
        exit 1
    }
    (
        # shellcheck disable=SC1090
        . "${env_file}"
        # set -u is inherited: a board.env that declares no BOARD_RADIOS at all
        # fails here rather than resolving to "this board has none".
        printf '%s' "${BOARD_RADIOS}"
    )
}

CX_RADIOS="$(board_radios cx3576)"
X64_RADIOS="$(board_radios x64)"

CX_DEV="mos-apid mos-bluetooth mos-board-cx3576 mos-ca-trust mos-mqtt-broker mos-mqttd mos-podman mos-profile-dev mos-rauc mos-system mos-wifi mos-wifi-ap mosd"
CX_PROD="mos-apid mos-bluetooth mos-board-cx3576 mos-ca-trust mos-mqtt-broker mos-mqttd mos-podman mos-profile-prod mos-rauc mos-system mos-wifi mos-wifi-ap mosd"
X64_DEV="mos-apid mos-board-x64 mos-ca-trust mos-mqtt-broker mos-mqttd mos-podman mos-profile-dev mos-rauc mos-system mosd"
X64_PROD="mos-apid mos-board-x64 mos-ca-trust mos-mqtt-broker mos-mqttd mos-podman mos-profile-prod mos-rauc mos-system mosd"
CX_MINIMAL="mos-board-cx3576 mos-ca-trust mos-profile-dev mos-system"

expect_set "cx3576 dev, radios '${CX_RADIOS}', nothing declined" "${CX_DEV}" \
    "${PACKAGES_DIR}" --board cx3576 --profile dev --radios "${CX_RADIOS}" --without ""
expect_set "cx3576 prod, radios '${CX_RADIOS}', nothing declined" "${CX_PROD}" \
    "${PACKAGES_DIR}" --board cx3576 --profile prod --radios "${CX_RADIOS}" --without ""
expect_set "x64 dev, radios '${X64_RADIOS}', nothing declined" "${X64_DEV}" \
    "${PACKAGES_DIR}" --board x64 --profile dev --radios "${X64_RADIOS}" --without ""
expect_set "x64 prod, radios '${X64_RADIOS}', nothing declined" "${X64_PROD}" \
    "${PACKAGES_DIR}" --board x64 --profile prod --radios "${X64_RADIOS}" --without ""

# The x64 set carries no cx3576 content. Asserted as its own check and not left
# to the literal above, because the failure it guards against -- a board's
# packages leaking into the other board's image -- is one an updated expectation
# would absorb without anyone reading it.
run_resolve "${PACKAGES_DIR}" --board x64 --profile dev --radios "${X64_RADIOS}" --without ""
leaked=""
for pkg in ${resolve_out}; do
    case "${pkg}" in
    mos-board-cx3576 | mos-wifi | mos-wifi-ap | mos-bluetooth) leaked="${leaked}${pkg} " ;;
    esac
done
if [ -z "${leaked}" ]; then
    pass "x64 dev carries no cx3576 board package and no radio package"
else
    fail "x64 dev carries cx3576 content: ${leaked% }. x64 declares BOARD_RADIOS='' and has its own board package"
fi

# Declining every feature drops exactly the feature packages and leaves a legal
# image set: common, one profile, one board.
expect_set "cx3576 dev, --without 'mosd mqtt containers rauc radios'" "${CX_MINIMAL}" \
    "${PACKAGES_DIR}" --board cx3576 --profile dev --radios "${CX_RADIOS}" \
    --without "mosd mqtt containers rauc radios"
dropped=""
for pkg in ${CX_DEV}; do
    case " ${CX_MINIMAL} " in
    *" ${pkg} "*) ;;
    *) dropped="${dropped}${pkg} " ;;
    esac
done
want_dropped="mos-apid mos-bluetooth mos-mqtt-broker mos-mqttd mos-podman mos-rauc mos-wifi mos-wifi-ap mosd"
if [ "${dropped% }" = "${want_dropped}" ]; then
    pass "declining all five features drops exactly: ${want_dropped}"
else
    fail "declining all five features dropped [${dropped% }], expected [${want_dropped}]"
fi

# ---------------------------------------------------------------------------
# 2. The refusals, each proven red by mutation.
# ---------------------------------------------------------------------------

# A copy of the manifest tree that nothing perturbs. Every mutation below is
# measured against it: the refusal has to fire on the perturbed copy and stay
# silent on this one, or the mutation proved nothing.
PRISTINE="${SCRATCH}/pristine"
cp -a "${PACKAGES_DIR}" "${PRISTINE}"
expect_set "the pristine copy under tmp/ resolves identically to the tracked tree" "${CX_DEV}" \
    "${PRISTINE}" --board cx3576 --profile dev --radios "${CX_RADIOS}" --without ""

mutate() {
    local name="$1"
    local dir="${SCRATCH}/${name}"
    rm -rf "${dir}"
    cp -a "${PACKAGES_DIR}" "${dir}"
    printf '%s' "${dir}"
}

# (a) an unknown feature name in --without.
expect_refusal "unknown feature in --without" "zigbee" "${PACKAGES_DIR}" \
    --board cx3576 --profile dev --radios "${CX_RADIOS}" --without "zigbee"
run_resolve "${PACKAGES_DIR}" --board cx3576 --profile dev --radios "${CX_RADIOS}" --without "rauc"
if [ "${resolve_rc}" -eq 0 ]; then
    pass "a legal --without does not trip the unknown-feature refusal"
else
    fail "--without rauc was refused on the tracked tree: ${resolve_err}"
fi
# The mutation runs the other way for this one, and it is the stronger
# direction: a NEW feature manifest makes a previously illegal name legal, which
# a hardcoded list of features could not do.
dir="$(mutate feature-added)"
printf '# scratch mutation\nmos-rauc\n' >"${dir}/feature-zigbee.pkgs"
run_resolve "${dir}" --board cx3576 --profile dev --radios "${CX_RADIOS}" --without "zigbee"
if [ "${resolve_rc}" -eq 0 ]; then
    pass "adding feature-zigbee.pkgs to a copy makes --without zigbee legal there: the feature list is read from the tree"
else
    fail "feature-zigbee.pkgs was added to a copy and --without zigbee was still refused, so the feature list does not come from the manifests: ${resolve_err}"
fi

# (b) a manifest line naming a package no producer declares.
dir="$(mutate undeclared-package)"
printf 'mos-not-a-real-package\n' >>"${dir}/common.pkgs"
expect_refusal "manifest names a package no producer declares" "mos-not-a-real-package" "${dir}" \
    --board cx3576 --profile dev --radios "${CX_RADIOS}" --without ""

# (c) both profile packages, and neither.
dir="$(mutate two-profiles)"
printf 'mos-profile-prod\n' >>"${dir}/common.pkgs"
expect_refusal "resolution carries both profile packages" "2 profile packages" "${dir}" \
    --board cx3576 --profile dev --radios "${CX_RADIOS}" --without ""

dir="$(mutate no-profile)"
: >"${dir}/profile-dev.pkgs"
expect_refusal "resolution carries no profile package" "NO profile package" "${dir}" \
    --board cx3576 --profile dev --radios "${CX_RADIOS}" --without ""

# (d) an empty resolution, and one with no board package.
#
# The fragment matters more here than anywhere else: an empty resolution also
# carries no profile package and no board package, so all three refusals are
# true of this tree and only the first one to run says the useful thing. With a
# bare exit-status assertion, deleting the emptiness check entirely would leave
# this test green.
dir="$(mutate empty-resolution)"
for f in "${dir}"/*.pkgs; do : >"${f}"; done
expect_refusal "empty resolution" "is EMPTY" "${dir}" \
    --board cx3576 --profile dev --radios "${CX_RADIOS}" --without ""

dir="$(mutate no-board-package)"
: >"${dir}/board-cx3576.pkgs"
expect_refusal "resolution carries no board package" "NO board package" "${dir}" \
    --board cx3576 --profile dev --radios "${CX_RADIOS}" --without ""

REFUSAL_N="${#REFUSAL_LABELS[@]}"
[ "${REFUSAL_N}" -gt 0 ] || {
    echo "error: not one refusal was recorded, so the two checks below compare nothing against nothing" >&2
    exit 1
}

# Every refusal must have its OWN message. One message covering two faults tells
# an operator that something is wrong and not which thing.
distinct_n="$(printf '%s\n' "${REFUSAL_TEXTS[@]}" | sort -u | wc -l)"
if [ "${distinct_n}" -eq "${REFUSAL_N}" ]; then
    pass "${REFUSAL_N} refusals, ${distinct_n} distinct messages"
else
    fail "${REFUSAL_N} refusals produced only ${distinct_n} distinct messages; at least two faults share one message"
fi

# And every fragment matched above must be absent from every OTHER refusal's
# message. Without this, a fragment could match all six and each expect_refusal
# would be asserting nothing beyond a non-zero exit.
cross_n=0
shared=""
for ((i = 0; i < REFUSAL_N; i++)); do
    for ((j = 0; j < REFUSAL_N; j++)); do
        [ "${i}" -ne "${j}" ] || continue
        cross_n=$((cross_n + 1))
        if [ "${REFUSAL_TEXTS[j]}" != "${REFUSAL_TEXTS[j]/${REFUSAL_TOKENS[i]}/}" ]; then
            shared="${shared}'${REFUSAL_TOKENS[i]}' (${REFUSAL_LABELS[i]}) also appears in the message for ${REFUSAL_LABELS[j]}; "
        fi
    done
done
if [ -z "${shared}" ]; then
    pass "each of the ${REFUSAL_N} fragments appears in its own refusal and in none of the others (${cross_n} comparisons)"
else
    fail "a refusal fragment does not discriminate: ${shared}"
fi

# ---------------------------------------------------------------------------
# 3. The reverse direction: every declared package reachable.
# ---------------------------------------------------------------------------

# Packages that NO legal resolution can name, with the reason each is exempt.
# Empty today, and it stays a written list rather than a tolerance: a package
# that quietly stops being reachable is a package the composer stops installing,
# and every check downstream of composition would keep passing over the smaller
# image.
declare -A UNREACHABLE_OK=()

PRODUCER_ROWS="$(bash "${REPO_ROOT}/os/build-env/deb/producers.sh")"
DECLARED=""
DECLARED_N=0
while read -r _producer _dir _arches packages _enablement; do
    for pkg in ${packages//,/ }; do
        DECLARED="${DECLARED}${pkg} "
        DECLARED_N=$((DECLARED_N + 1))
    done
done <<<"${PRODUCER_ROWS}"

# The legal space, taken from the manifest tree and the board files rather than
# from a list written here: a board, profile, radio or feature added to the
# repository is enumerated by this check the day it lands.
mapfile -t ALL_BOARDS < <(cd "${PACKAGES_DIR}" && for f in board-*.pkgs; do basename "${f}" .pkgs | sed 's/^board-//'; done)
mapfile -t ALL_PROFILES < <(cd "${PACKAGES_DIR}" && for f in profile-*.pkgs; do basename "${f}" .pkgs | sed 's/^profile-//'; done)
mapfile -t ALL_FEATURES < <(
    cd "${PACKAGES_DIR}" && for f in feature-*.pkgs; do basename "${f}" .pkgs | sed 's/^feature-//'; done
    echo radios
)
mapfile -t ALL_FEATURES < <(printf '%s\n' "${ALL_FEATURES[@]}" | sort -u)

REACHED=""
RESOLUTIONS_N=0
feat_n="${#ALL_FEATURES[@]}"
for board in "${ALL_BOARDS[@]}"; do
    radios="$(board_radios "${board}")"
    for profile in "${ALL_PROFILES[@]}"; do
        # The full power set of declined features, not just "decline none".
        # "Decline none" alone would prove reachability just as well, and would
        # also pass over a resolver that ignored --without entirely.
        for ((mask = 0; mask < (1 << feat_n); mask++)); do
            without=""
            for ((i = 0; i < feat_n; i++)); do
                if (((mask >> i) & 1)); then without="${without}${ALL_FEATURES[i]} "; fi
            done
            run_resolve "${PACKAGES_DIR}" --board "${board}" --profile "${profile}" \
                --radios "${radios}" --without "${without% }"
            if [ "${resolve_rc}" -ne 0 ]; then
                fail "reachability: --board ${board} --profile ${profile} --radios '${radios}' --without '${without% }' was refused, and every one of these is a legal build: ${resolve_err}"
                continue
            fi
            RESOLUTIONS_N=$((RESOLUTIONS_N + 1))
            for pkg in ${resolve_out}; do
                case " ${REACHED} " in
                *" ${pkg} "*) ;;
                *) REACHED="${REACHED}${pkg} " ;;
                esac
            done
        done
    done
done

REACHED_N=0
for _pkg in ${REACHED}; do REACHED_N=$((REACHED_N + 1)); done

echo "COUNTS: ${DECLARED_N} packages declared by producers, ${REACHED_N} proven reachable, over ${RESOLUTIONS_N} legal resolutions (${#ALL_BOARDS[@]} boards x ${#ALL_PROFILES[@]} profiles x $((1 << feat_n)) feature subsets)"
[ "${DECLARED_N}" -gt 0 ] || {
    echo "error: the producers declared no package, so the reachability check would have compared nothing against nothing and passed" >&2
    exit 1
}
[ "${REACHED_N}" -gt 0 ] || {
    echo "error: no package was reached by any resolution, so the reachability check would have found every declared package unreachable or -- with an empty declared set -- nothing at all" >&2
    exit 1
}
[ "${RESOLUTIONS_N}" -gt 0 ] || {
    echo "error: no legal resolution was enumerated; the union above is the union of nothing" >&2
    exit 1
}

for pkg in ${DECLARED}; do
    case " ${REACHED} " in
    *" ${pkg} "*)
        pass "reachable: ${pkg}"
        continue
        ;;
    esac
    if [ -n "${UNREACHABLE_OK[${pkg}]:-}" ]; then
        pass "unreachable by design: ${pkg} -- ${UNREACHABLE_OK[${pkg}]}"
    else
        fail "${pkg} is declared by a producer and NO legal resolution names it. The composer will never install it, and no check downstream of composition can see that: they all run over the set that was installed. Name it in a manifest, or list it in UNREACHABLE_OK in this file with the reason"
    fi
done
# A stale exemption is an exemption that hides the next regression.
for pkg in ${!UNREACHABLE_OK[@]+"${!UNREACHABLE_OK[@]}"}; do
    case " ${REACHED} " in
    *" ${pkg} "*)
        fail "${pkg} is listed in UNREACHABLE_OK but a legal resolution does name it. Remove the exemption; while it stands, this package's reachability is asserted by nothing"
        ;;
    esac
done

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) ($((PASS_N))/$((PASS_N + FAIL_N)) checks passed, ${DECLARED_N} packages declared, ${REACHED_N} reachable, ${RESOLUTIONS_N} resolutions, ${REFUSAL_N} refusals)"
[ "${FAIL_N}" -eq 0 ]
