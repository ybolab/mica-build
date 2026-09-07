#!/usr/bin/env bash
# Negative and positive tests for build-env/deb/preflight.sh and for the two
# producer hooks that answer it.
#
#   bash tests/deb-preflight-test.sh
#
# WHY THIS FILE EXISTS. The pre-flight's whole value is a count and a list, and
# both fail SILENTLY: a check that looked at nothing prints the same shape of
# green line as one that looked at everything, and a report naming four missing
# files can be counted as one without anything saying so. The first spelling of
# the hook-count guard had exactly that bug -- it tested the two counts
# concatenated, so an absent `preflight-examined` beside a `preflight-missing: 0`
# read as the number 0, passed, and the run reported every input present having
# skipped a producer entirely. It was found by mutating the hook by hand.
# Section C is that mutation, checked in, because hand-driven evidence does not
# survive the next edit.
#
# NOTHING HERE ASSERTS AN ABSOLUTE GREEN. Whether this host has BSP artefacts or
# a compiled container engine is a property of the host, not of the tree, so a
# test that demanded either would report the host. Section A builds a BSP
# fixture out of the paths the code itself asks for and every later case is a
# delta on a baseline measured against it.
#
# NOTHING REAL IS CLOBBERED. The podman cases run the real prepare.sh against a
# FIXTURE repository root -- MOS_DEB_REPO_ROOT is the seam build-env/deb/build.sh
# itself sets -- so an out-<arch> holding three quarters of an hour of emulated
# compiling is never read, moved or deleted. The cases that must move a tracked
# file restore it in an EXIT trap.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"
PREFLIGHT="${REPO_ROOT}/build-env/deb/preflight.sh"
RENDER="${REPO_ROOT}/boards/cx3576/deb/board-cx3576/render.sh"
STAMP_SH="${REPO_ROOT}/pkgs/podman/versions-stamp.sh"
PODMAN_PREPARE="${REPO_ROOT}/pkgs/podman/deb/podman/prepare.sh"
for f in "${PREFLIGHT}" "${RENDER}" "${STAMP_SH}" "${PODMAN_PREPARE}"; do
    [ -f "${f}" ] || { echo "error: ${f} does not exist; this test asserts over it" >&2; exit 1; }
done

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

# `case` and not `grep -q` on the right of a pipe: tests/shell-pipefail-lint.sh
# exists for that inversion and this file sets pipefail.
says() {
    case "$1" in *"$2"*) return 0 ;; esac
    return 1
}

# Under the worktree, never /tmp: this host cannot bind-mount /tmp into a
# container, and every scratch path in this repository lives here for that
# reason even when the case using it starts none.
TMP="${REPO_ROOT}/tmp/deb-preflight-test.$$"
rm -rf "${TMP}"
mkdir -p "${TMP}"

# What has been moved out of the tree, so the trap puts it back whatever
# happens. A test that leaves a tracked file moved aside is worse than one that
# fails.
MOVED=()
hide() {
    local path="$1" keep
    keep="${TMP}/hidden.$(printf '%s' "${path#"${REPO_ROOT}/"}" | tr / _)"
    mv "${path}" "${keep}"
    MOVED+=("${keep}|${path}")
}
restore_all() {
    local entry
    for entry in ${MOVED[@]+"${MOVED[@]}"}; do
        [ -e "${entry%%|*}" ] || continue
        rm -rf "${entry#*|}"
        mv "${entry%%|*}" "${entry#*|}"
    done
    MOVED=()
}
cleanup() {
    restore_all
    [ ! -f "${TMP}/render.sh.orig" ] || cp "${TMP}/render.sh.orig" "${RENDER}"
    [ ! -f "${TMP}/rauc-versions.env.orig" ] || cp "${TMP}/rauc-versions.env.orig" "${REPO_ROOT}/pkgs/rauc/versions.env"
    # Section E mutates the real pool's manifest.txt; a saved copy is the
    # restore, and leaving the mutated one behind would refuse every later
    # image build on this host.
    [ ! -f "${TMP}/pool-manifest.txt.orig" ] || cp "${TMP}/pool-manifest.txt.orig" "${REPO_ROOT}/_out/debs/amd64/manifest.txt"
    rm -rf "${TMP}"
}
# INT and TERM as well as EXIT. Several cases move a tracked file or a real
# build directory aside for the length of one run, and bash does not run an
# EXIT trap for an untrapped terminating signal -- so without these a
# Ctrl-C in the wrong second leaves the tree with a file missing.
trap cleanup EXIT INT TERM

# The three numbers every case reads, taken out of the pre-flight's own summary
# rather than recomputed here: the summary IS the thing under test, so a test
# that counted the reports itself would pass over a summary that had stopped
# agreeing with them.
#
#   preflight: P of N examined inputs are present across ...
#   preflight: M of N examined inputs are missing across ...
#   preflight: a further W of N are absent and will be BUILT BY THE RUN ITSELF ...
PF_RC=0
PF_EXAMINED=""
PF_MISSING=""
PF_WARNED=""
PF_OUT=""
run_preflight() {
    PF_RC=0
    PF_OUT="$(BOARD_DIR="${BSP_FIXTURE}" BSP_OUT="${BSP_OUT_FIXTURE}" bash "${PREFLIGHT}" "$@" 2>&1)" || PF_RC=$?
    PF_EXAMINED="$(printf '%s\n' "${PF_OUT}" | sed -n 's/^preflight: [0-9]* of \([0-9]*\) examined.*/\1/p' | tail -1)"
    PF_MISSING="$(printf '%s\n' "${PF_OUT}" | sed -n 's/^preflight: \([0-9]*\) of [0-9]* examined inputs are missing.*/\1/p' | tail -1)"
    PF_WARNED="$(printf '%s\n' "${PF_OUT}" | sed -n 's/^preflight: a further \([0-9]*\) of [0-9]* are absent.*/\1/p' | tail -1)"
    [ -n "${PF_MISSING}" ] || PF_MISSING=0
    [ -n "${PF_WARNED}" ] || PF_WARNED=0
}

echo "== A. BOARD_DIR and BSP_OUT: still the escape, in both directions =="

# TWO fixtures, because RFCT-343 split one variable into two things that were
# never the same: BOARD_DIR is the bsp SOURCE tree (committed vendor firmware)
# and BSP_OUT is where a build put its artefacts (kernel, U-Boot). Both are
# threaded through to the hook, so every BSP refusal must NAME one of these
# directories -- which is deterministic on every host, whatever the real
# _out/boards/cx3576 happens to hold. Setting only one would leave the other
# half of the inputs read from the real tree, and this test would then pass on
# a machine that had built a kernel and fail on one that had not.
BSP_FIXTURE="${TMP}/bsp"
BSP_OUT_FIXTURE="${TMP}/bsp-out"
mkdir -p "${BSP_FIXTURE}" "${BSP_OUT_FIXTURE}"
run_preflight --producer board-cx3576
# The paths it asked for, read out of its own report -- NOT a list written
# here. A second list of the BSP inputs in this file is one that stops matching
# board.env the day the board declares another, and stops matching silently, by
# testing yesterday's set.
mapfile -t WANTED < <(printf '%s\n' "${PF_OUT}" |
    sed -n "s|^error: \(${BSP_FIXTURE}/[^ ]*\) not found.*|\1|p;s|^error: .* and \(${BSP_FIXTURE}/[^ ]*\) does not exist.*|\1|p;s|^error: \(${BSP_OUT_FIXTURE}/[^ ]*\) not found.*|\1|p;s|^error: .* and \(${BSP_OUT_FIXTURE}/[^ ]*\) does not exist.*|\1|p")
if [ "${PF_RC}" -ne 0 ] && [ "${#WANTED[@]}" -gt 1 ]; then
    pass "A1 BOARD_DIR and BSP_OUT are honoured: ${#WANTED[@]} inputs are demanded under the directories they name, in one run"
else
    fail "A1 expected exit!=0 and more than one input demanded under BOARD_DIR/BSP_OUT; got exit ${PF_RC}, ${#WANTED[@]} paths"
fi

# The same directory, filled with exactly the paths the code just asked for.
# Built from the report, so it cannot be a fixture for some other set of inputs
# than the one the hook actually checks.
for p in ${WANTED[@]+"${WANTED[@]}"}; do
    mkdir -p "$(dirname "${p}")"
    : >"${p}"
done
run_preflight --producer board-cx3576
if [ "${PF_RC}" -eq 0 ] && [ -n "${PF_EXAMINED}" ] && [ "${PF_EXAMINED}" -gt "${#WANTED[@]}" ]; then
    pass "A2 the same two directories, filled with what they asked for, are green over ${PF_EXAMINED} inputs"
else
    fail "A2 expected exit 0 and more than ${#WANTED[@]} inputs examined; got exit ${PF_RC}, examined '${PF_EXAMINED}'"
fi

echo "== B. the aggregate: counts, and every missing input in ONE run =="

run_preflight
BASE_EXAMINED="${PF_EXAMINED}"
BASE_MISSING="${PF_MISSING}"
BASE_WARNED="${PF_WARNED}"
BASE_RC="${PF_RC}"
[ -n "${BASE_EXAMINED}" ] || { echo "error: the pre-flight printed no summary line to take a baseline from:" >&2; printf '%s\n' "${PF_OUT}" >&2; exit 1; }
echo "note: baseline is ${BASE_MISSING} missing of ${BASE_EXAMINED} examined (exit ${BASE_RC})"

# THE ANTI-VACUITY CASE. Everything below is a delta on this number, so a zero
# here would make every one of them true by having examined nothing.
if [ "${BASE_EXAMINED}" -gt 0 ]; then
    pass "B1 the pre-flight examines ${BASE_EXAMINED} inputs and prints the count"
else
    fail "B1 the pre-flight examined 0 inputs; every case below would pass by checking nothing"
fi

# THREE PRODUCERS, THREE CATEGORIES, ONE RUN -- a PREPARE hook file, a build
# context and a BSP artefact. This is the behaviour the pre-flight replaces:
# the old failure named one file, after the producers ahead of it had been
# packed, and the next one was learned on the next attempt.
#
# Each is declared by exactly ONE producer, so the delta is exactly three. A
# path two producers name would move the count by two and the arithmetic below
# would be testing this file's bookkeeping rather than the pre-flight's.
ARTEFACT="${WANTED[0]}"
hide "${REPO_ROOT}/pkgs/rauc/deb/rauc/prepare.sh"
hide "${REPO_ROOT}/pkgs/mosd/broker/dist"
hide "${ARTEFACT}"
run_preflight
if [ "${PF_RC}" -ne 0 ] &&
    [ "${PF_MISSING}" = "$((BASE_MISSING + 3))" ] &&
    says "${PF_OUT}" "pkgs/rauc/deb/rauc/prepare.sh does not exist" &&
    says "${PF_OUT}" "pkgs/mosd/broker/dist does not exist" &&
    says "${PF_OUT}" "${ARTEFACT}"; then
    pass "B2 three missing inputs across three producers, three categories, all named in ONE run (${BASE_MISSING} -> ${PF_MISSING})"
else
    fail "B2 expected exit!=0 and $((BASE_MISSING + 3)) missing naming all three; got exit ${PF_RC}, missing ${PF_MISSING}"
fi

restore_all
run_preflight
if [ "${PF_RC}" = "${BASE_RC}" ] && [ "${PF_MISSING}" = "${BASE_MISSING}" ] &&
    [ "${PF_WARNED}" = "${BASE_WARNED}" ] && [ "${PF_EXAMINED}" = "${BASE_EXAMINED}" ]; then
    pass "B3 restoring all three returns the run to the baseline (${BASE_MISSING} missing, ${BASE_WARNED} warned, of ${BASE_EXAMINED})"
else
    fail "B3 after restoring, expected exit ${BASE_RC}, ${BASE_MISSING} missing and ${BASE_WARNED} warned of ${BASE_EXAMINED}; got exit ${PF_RC}, ${PF_MISSING} missing and ${PF_WARNED} warned of ${PF_EXAMINED}"
fi

echo "== C. the hook count contract, driven by mutating the hook =="

cp "${RENDER}" "${TMP}/render.sh.orig"

# C1 is the bug this file was written for: a hook that stops saying what it
# examined must not be able to report everything present.
sed -i '/^    echo "preflight-examined: ${EXAMINED}"$/d' "${RENDER}"
run_preflight --producer board-cx3576
if [ "${PF_RC}" -ne 0 ] && says "${PF_OUT}" "did not print a usable preflight-examined count"; then
    pass "C1 a hook that reports success without an examined count is refused"
else
    fail "C1 expected the missing-count refusal; got exit ${PF_RC}: ${PF_OUT}"
fi
cp "${TMP}/render.sh.orig" "${RENDER}"

# A zero is refused with the same words as an absent count: a hook that
# examined nothing has nothing to say about whether its producer can be built.
sed -i 's/^    echo "preflight-examined: ${EXAMINED}"$/    echo "preflight-examined: 0"/' "${RENDER}"
run_preflight --producer board-cx3576
if [ "${PF_RC}" -ne 0 ] && says "${PF_OUT}" "did not print a usable preflight-examined count"; then
    pass "C2 a hook that reports an examined count of zero is refused"
else
    fail "C2 expected the zero-count refusal; got exit ${PF_RC}: ${PF_OUT}"
fi
cp "${TMP}/render.sh.orig" "${RENDER}"

# The failing side. Without the missing count, one producer's whole report is
# counted as a single missing input however many files it names -- so this is
# driven against a BOARD_DIR and a BSP_OUT with nothing in them, where the hook
# does fail.
sed -i '/^        echo "preflight-missing: ${#MISSING\[@\]}" >&2$/d' "${RENDER}"
C_RC=0
C_OUT="$(BOARD_DIR="${TMP}/bsp-nothing" BSP_OUT="${TMP}/bsp-out-nothing" bash "${PREFLIGHT}" --producer board-cx3576 2>&1)" || C_RC=$?
if [ "${C_RC}" -ne 0 ] && says "${C_OUT}" "did not print a usable preflight-missing count"; then
    pass "C3 a FAILING hook that omits its missing count is refused"
else
    fail "C3 expected the missing-count refusal on the failing path; got exit ${C_RC}: ${C_OUT}"
fi
cp "${TMP}/render.sh.orig" "${RENDER}"

# The THIRD count. Without it, "this producer has nothing it can make for
# itself" and "this hook has not been taught the category" are the same run --
# and the second silently drops a producer's warnings out of the total.
sed -i '/^    echo "preflight-warned: 0"$/d' "${RENDER}"
run_preflight --producer board-cx3576
if [ "${PF_RC}" -ne 0 ] && says "${PF_OUT}" "did not print a usable preflight-warned count"; then
    pass "C4 a hook that omits its warned count is refused"
else
    fail "C4 expected the warned-count refusal; got exit ${PF_RC}: ${PF_OUT}"
fi
cp "${TMP}/render.sh.orig" "${RENDER}"
rm -f "${TMP}/render.sh.orig"

echo "== D. the podman versions stamp, and a pre-flight that must not compile =="

# A real host ELF, because prepare.sh checks the architecture of what it
# stages: the fixture satisfies that check honestly rather than by the check
# being weakened for the test. Resolved by PATH and not by `command -v true`,
# which answers `true` -- the shell builtin -- and never a file.
case "$(uname -m)" in
x86_64) FIX_ARCH=amd64 FIX_ELF=x86-64 ;;
aarch64 | arm64) FIX_ARCH=arm64 FIX_ELF=aarch64 ;;
*) FIX_ARCH="" FIX_ELF="" ;;
esac
HOST_ELF=""
if [ -n "${FIX_ELF}" ]; then
    for c in /bin/true /usr/bin/true /bin/ls /usr/bin/ls /bin/cat /usr/bin/cat; do
        [ -f "${c}" ] || continue
        case "$(file -b "${c}" 2>/dev/null)" in
        *"ELF 64-bit"*"${FIX_ELF}"*) HOST_ELF="${c}"; break ;;
        esac
    done
fi
[ -n "${HOST_ELF}" ] || {
    echo "error: no ${FIX_ELF} ELF was found among the standard binaries on this host, so section D has nothing to build its fixture out-${FIX_ARCH} from. Skipping it would leave the stamp guard untested, which is the state that guard exists to end" >&2
    exit 1
}

# A FIXTURE repository root. MOS_DEB_REPO_ROOT is the seam the driver itself
# sets, so the real prepare.sh runs unmodified against a tree this test owns.
FIX="${TMP}/fixture"
FIXP="${FIX}/pkgs/podman"
OUTDIR="${FIXP}/out-${FIX_ARCH}"
mkdir -p "${FIXP}/deb/podman" "${OUTDIR}"
cp "${REPO_ROOT}/pkgs/podman/versions.env" "${FIXP}/versions.env"
cp "${STAMP_SH}" "${FIXP}/versions-stamp.sh"
# THE TRIPWIRE. prepare.sh runs this when it decides to compile, and in
# pre-flight mode it must never decide that. A placeholder that fails loudly
# turns "the pre-flight compiled" from a forty-five minute wait into a red line.
cat >"${FIXP}/build.sh" <<'TRIPWIRE'
#!/usr/bin/env bash
echo "TRIPWIRE: the container engine build was invoked" >&2
exit 99
TRIPWIRE
BINARIES=(podman quadlet crun conmon netavark aardvark-dns catatonit)
for b in "${BINARIES[@]}"; do cp "${HOST_ELF}" "${OUTDIR}/${b}"; done

D_RC=0
D_OUT="$(bash "${FIXP}/versions-stamp.sh" --digest 2>&1)" || D_RC=$?
case "${D_OUT}" in
*[!0-9a-f]* | "") D_RC=1 ;;
*) [ "${#D_OUT}" -eq 64 ] || D_RC=1 ;;
esac
if [ "${D_RC}" -eq 0 ]; then
    pass "D1 --digest yields a sha256 over the normalised versions.env"
else
    fail "D1 expected a 64-hex digest; got '${D_OUT}'"
fi

bash "${FIXP}/versions-stamp.sh" --stamp "${OUTDIR}"
D_RC=0
D_OUT="$(bash "${FIXP}/versions-stamp.sh" --check "${OUTDIR}" 2>&1)" || D_RC=$?
if [ "${D_RC}" -eq 0 ]; then
    pass "D2 a directory stamped from the current versions.env passes --check"
else
    fail "D2 expected --check to pass on a freshly stamped directory; got exit ${D_RC}: ${D_OUT}"
fi

# THE DEFECT THE STAMP CLOSES, stated as pkgs/podman/build.sh states it: a
# stale out/ looks exactly like a fresh one to anything that only checks the
# files are present. Every file below is still present, executable and the
# right architecture; only the pin it was compiled from has moved.
sed -i 's/^CRUN_VERSION=.*/CRUN_VERSION=1.99.9/' "${FIXP}/versions.env"
D_RC=0
D_OUT="$(bash "${FIXP}/versions-stamp.sh" --check "${OUTDIR}" 2>&1)" || D_RC=$?
if [ "${D_RC}" -ne 0 ] &&
    says "${D_OUT}" "was built from a different pkgs/podman/versions.env" &&
    says "${D_OUT}" "stamped:" && says "${D_OUT}" "current:"; then
    pass "D3 a version bump makes the stamped directory refuse BY NAME, with both digests"
else
    fail "D3 expected the stale-stamp refusal naming both digests; got exit ${D_RC}: ${D_OUT}"
fi

# prepare.sh's REUSE path, through the same mismatch. That is the path which
# packaged the previous engine silently before the stamp existed.
mkdir -p "${TMP}/stage-d"
D_RC=0
D_OUT="$(MOS_DEB_REPO_ROOT="${FIX}" MOS_DEB_ARCH="${FIX_ARCH}" MOS_DEB_PRODUCER=podman \
    MOS_DEB_STAGE="${TMP}/stage-d" bash "${PODMAN_PREPARE}" 2>&1)" || D_RC=$?
if [ "${D_RC}" -ne 0 ] &&
    says "${D_OUT}" "was built from a different pkgs/podman/versions.env" &&
    ! says "${D_OUT}" "TRIPWIRE"; then
    pass "D4 prepare.sh refuses to reuse a stale out-${FIX_ARCH}, and does not compile instead"
else
    fail "D4 expected prepare.sh to refuse the stale directory without compiling; got exit ${D_RC}: ${D_OUT}"
fi

# Restore the pin and the same reuse succeeds -- the guard is a claim about
# STALENESS, not a refusal of reuse. Without this direction the guard could be
# a bare `exit 1` and every case above would still pass.
sed -i 's/^CRUN_VERSION=.*/CRUN_VERSION=1.29.1/' "${FIXP}/versions.env"
rm -rf "${TMP}/stage-d"
mkdir -p "${TMP}/stage-d"
D_RC=0
D_OUT="$(MOS_DEB_REPO_ROOT="${FIX}" MOS_DEB_ARCH="${FIX_ARCH}" MOS_DEB_PRODUCER=podman \
    MOS_DEB_STAGE="${TMP}/stage-d" bash "${PODMAN_PREPARE}" 2>&1)" || D_RC=$?
staged="$(find "${TMP}/stage-d" -type f | wc -l)"
if [ "${D_RC}" -eq 0 ] && [ "${staged}" = "${#BINARIES[@]}" ] && ! says "${D_OUT}" "TRIPWIRE"; then
    pass "D5 restoring the pin lets the same directory be reused, staging ${staged} binaries"
else
    fail "D5 expected reuse to succeed and stage ${#BINARIES[@]}; got exit ${D_RC}, staged ${staged}: ${D_OUT}"
fi

# An UNSTAMPED directory: what every out-<arch> on every host looked like
# before this guard, and the state in which it must not be trusted.
rm -f "${OUTDIR}/VERSIONS.env"
D_RC=0
D_OUT="$(bash "${FIXP}/versions-stamp.sh" --check "${OUTDIR}" 2>&1)" || D_RC=$?
if [ "${D_RC}" -ne 0 ] && says "${D_OUT}" "carries no VERSIONS.env"; then
    pass "D6 an unstamped directory is refused rather than trusted"
else
    fail "D6 expected the unstamped refusal; got exit ${D_RC}: ${D_OUT}"
fi
bash "${FIXP}/versions-stamp.sh" --stamp "${OUTDIR}"

# PRE-FLIGHT MODE, and the thing it must not do. No MOS_DEB_STAGE is passed,
# because the driver has not made one: no build has started.
D_EX=""
D_MI=""
D_WA=""
run_podman_preflight() {
    D_RC=0
    D_OUT="$(MOS_DEB_PREFLIGHT=1 MOS_DEB_REPO_ROOT="${FIX}" MOS_DEB_ARCH="${FIX_ARCH}" \
        MOS_DEB_PRODUCER=podman bash "${PODMAN_PREPARE}" 2>&1)" || D_RC=$?
    D_EX="$(printf '%s\n' "${D_OUT}" | sed -n 's/^preflight-examined: //p')"
    D_MI="$(printf '%s\n' "${D_OUT}" | sed -n 's/^preflight-missing: //p')"
    D_WA="$(printf '%s\n' "${D_OUT}" | sed -n 's/^preflight-warned: //p')"
}
EXPECT_EX="$((${#BINARIES[@]} + 1))"

run_podman_preflight
if [ "${D_RC}" -eq 0 ] && [ "${D_EX}" = "${EXPECT_EX}" ] && [ "${D_MI}" = 0 ] && [ "${D_WA}" = 0 ] &&
    ! says "${D_OUT}" "TRIPWIRE"; then
    pass "D7 the podman hook answers the pre-flight over ${D_EX} inputs without compiling"
else
    fail "D7 expected exit 0, examined ${EXPECT_EX}, missing 0, warned 0 and no compile; got exit ${D_RC}, examined '${D_EX}', missing '${D_MI}', warned '${D_WA}': ${D_OUT}"
fi

# THE FORTY-FIVE MINUTE CASE, and it is a WARNING rather than a refusal. This
# producer builds its own binaries, so an absent one does not stop the run --
# it costs three quarters of an hour somewhere the operator did not expect, and
# saying so in advance is the whole point. Refusing instead would mean `make
# os-debs` could no longer build a pool on a fresh host, which its own help
# line promises it can.
#
# What the case still requires: exit 0, the cost and the command named, the
# count in the WARNED column and not the missing one, and no compile.
rm -f "${OUTDIR}/crun"
run_podman_preflight
if [ "${D_RC}" -eq 0 ] && [ "${D_EX}" = "${EXPECT_EX}" ] && [ "${D_MI}" = 0 ] && [ "${D_WA}" = 1 ] &&
    says "${D_OUT}" "warning:" && says "${D_OUT}" "make podman" &&
    says "${D_OUT}" "three quarters of an hour" && ! says "${D_OUT}" "TRIPWIRE"; then
    pass "D8 an absent binary WARNS with the cost and the command, does not refuse, and does not compile"
else
    fail "D8 expected exit 0, examined ${EXPECT_EX}, missing 0, warned 1, the cost named and no compile; got exit ${D_RC}, examined '${D_EX}', missing '${D_MI}', warned '${D_WA}': ${D_OUT}"
fi

# THE LINE BETWEEN THE TWO CATEGORIES. Complete but STALE is the case nothing
# in the run can fix -- prepare.sh refuses it -- so it must land in the missing
# column and turn the run red, while the case above stays a warning. Without
# this the two categories could be one, with every case above still passing.
cp "${HOST_ELF}" "${OUTDIR}/crun"
sed -i 's/^CRUN_VERSION=.*/CRUN_VERSION=1.99.9/' "${FIXP}/versions.env"
run_podman_preflight
if [ "${D_RC}" -ne 0 ] && [ "${D_EX}" = "${EXPECT_EX}" ] && [ "${D_MI}" = 1 ] && [ "${D_WA}" = 0 ] &&
    says "${D_OUT}" "was built from a different pkgs/podman/versions.env" &&
    ! says "${D_OUT}" "TRIPWIRE"; then
    pass "D9 a complete but STALE directory is MISSING, not warned: the run goes red and nothing compiles"
else
    fail "D9 expected exit!=0, examined ${EXPECT_EX}, missing 1, warned 0 and no compile; got exit ${D_RC}, examined '${D_EX}', missing '${D_MI}', warned '${D_WA}': ${D_OUT}"
fi
sed -i 's/^CRUN_VERSION=.*/CRUN_VERSION=1.29.1/' "${FIXP}/versions.env"

echo "== E. the IMAGE path: rootfs/build.sh refuses a pool from another tree =="

# The composed image path installs everything -- the engine included -- from
# the package pool, so the staleness that used to live on an out-<arch>
# staging directory now lives on the POOL: rootfs/build.sh refuses a pool
# whose git stamp is not this tree's, before resolve.sh runs and before any
# container starts. (This section used to drive a stale-engine refusal
# through pkgs/podman/out-amd64 staging; that staging left build.sh with
# the stage chain, and its stamp is now section D's business at package-build
# time.)
#
# Driven by mutating the pool's own manifest.txt, backed up and restored --
# the .deb archives are untouched, and SHA256SUMS covers only those. Whether a
# pool exists here is a property of the HOST, like the BSP artefacts in
# section A, so with none the section says so and proves nothing rather than
# demanding a build.
mkdir -p "${TMP}/nodocker"
printf '#!/bin/sh\necho "STOPHERE: docker was invoked" >&2\nexit 97\n' >"${TMP}/nodocker/docker"
chmod +x "${TMP}/nodocker/docker"
build_rootfs() {
    E_RC=0
    E_OUT="$(PATH="${TMP}/nodocker:${PATH}" MOS_BOARD=x64 WITH_MOSD=0 MOS_ROOTFS_WITHOUT="rauc" \
        timeout 300 bash "${REPO_ROOT}/rootfs/build.sh" 2>&1)" || E_RC=$?
}

POOL_MANIFEST="${REPO_ROOT}/_out/debs/amd64/manifest.txt"
# A stamp no tree produces: rev-parse never yields twelve zeros, so the
# baseline run's output cannot contain it and the fragment discriminates on
# every host, whatever state its real pool is in.
BOGUS_STAMP="git000000000000-1"
if [ ! -f "${POOL_MANIFEST}" ]; then
    pass "E0 no amd64 pool on this host; the pool-stamp refusal is proven where one exists (build one with 'make os-debs')"
else
    # E0: the baseline outcome, whatever it is -- a stamp-matching pool
    # reaches the docker stop, a genuinely stale one refuses; both are host
    # facts. What E1/E2 assert is the DELTA the mutation makes against it.
    build_rootfs
    E0_RC="${E_RC}"
    if says "${E_OUT}" "${BOGUS_STAMP}"; then
        fail "E0 the baseline run already names ${BOGUS_STAMP}; the mutation below could not discriminate"
    else
        pass "E0 baseline captured (exit ${E0_RC}); it does not name ${BOGUS_STAMP}"
    fi

    cp "${POOL_MANIFEST}" "${TMP}/pool-manifest.txt.orig"
    sed -E -i "s/\+git[0-9a-f]{12}(\.dirty)?-[0-9]+/+${BOGUS_STAMP}/g" "${POOL_MANIFEST}"
    build_rootfs
    if [ "${E_RC}" -ne 0 ] && ! says "${E_OUT}" "STOPHERE" &&
        says "${E_OUT}" "pool was built at stamp '${BOGUS_STAMP}'"; then
        pass "E1 a pool stamped by another tree is refused BY STAMP, before any container starts"
    else
        fail "E1 expected a refusal naming ${BOGUS_STAMP} and no docker; got exit ${E_RC}: $(printf '%s\n' "${E_OUT}" | tail -3)"
    fi

    # THE GREEN DIRECTION, which is the one that matters: without it the guard
    # could be a bare `exit 1` and E1 would still pass. Restoring the manifest
    # returns the run to its baseline outcome.
    cp "${TMP}/pool-manifest.txt.orig" "${POOL_MANIFEST}"
    build_rootfs
    if [ "${E_RC}" = "${E0_RC}" ] && ! says "${E_OUT}" "pool was built at stamp '${BOGUS_STAMP}'"; then
        pass "E2 restoring the manifest returns the run to its baseline (exit ${E_RC})"
    else
        fail "E2 expected the baseline exit ${E0_RC} back and no ${BOGUS_STAMP} refusal; got exit ${E_RC}: $(printf '%s\n' "${E_OUT}" | tail -3)"
    fi
fi

echo "== F. a warning-only run is GREEN, and says what it will cost =="

# THE WARNED COUNT IS ABSOLUTE; THE EXIT CODE CANNOT BE. Everything in section B
# compares against a baseline, so a pre-flight that failed on warnings would
# move the baseline with it and every one of those cases would still pass. This
# case fixes what it can: BOTH podman output directories are moved aside, so the
# warned count is 7 binaries x 2 architectures on every host, whatever was built
# here.
#
# It used to demand `exit 0` outright, and that was a hidden assumption about
# the host rather than an assertion about the code. The pre-flight exits
# non-zero whenever ANYTHING is missing, so `PF_RC -eq 0` silently required
# BASE_MISSING to be 0 -- true only on a machine that has built every board's
# BSP. It went red on a machine that had built cx3576 and not x64, with the
# counts agreeing exactly and only the status differing, which reads as a defect
# in the code under test and is not one. RFCT-343 moved the BSP outputs, which
# changed WHICH hosts tripped it and is how it surfaced; the assumption predates
# that move.
#
# WHY THE FIXTURE ROUTE IS NOT AVAILABLE, since section A uses it. BOARD_DIR and
# BSP_OUT redirect the board-cx3576 producer, and A2 fills both. They cannot
# redirect boards/{x64,virt-arm64}/deb/kernel-*/stage.sh, which read
# ${REPO_ROOT}/_out/boards/<board>/kernel and honour no variable ON PURPOSE --
# one global read by several producers would make `BOARD_DIR=<a cx3576 tree>`
# mean two things in the aggregate run this file drives. So those inputs are
# host state that no fixture can supply, and BASE_MISSING is host state with
# them.
#
# What it asserts is therefore the ruling, in the form that holds on any host:
# an input the run makes for itself does not CHANGE the exit code, is counted in
# its own column and not among the missing, and the cost is on the terminal
# before anything starts. On a host whose baseline is already green the stronger
# absolute form -- exit 0 -- is required as well, so nothing is lost where it
# can be checked.
#
# WHAT THE WEAKER FORM DOES NOT BIND, measured by mutating the pre-flight rather
# than reasoned about. Two mutations, each run against both host states:
#
#   * `WARNED_N` accumulated into `MISSING_N` (warnings counted as missing):
#     caught on BOTH hosts, by the warned/missing comparison.
#   * `exit 1` when `WARNED_N > 0` (warnings fail the run): caught on a complete
#     host, NOT caught on a partial one -- the run is already non-zero for an
#     unrelated reason, so the status cannot witness it.
#
# That gap is irreducible here, not an oversight: on a host where something is
# genuinely missing, no observation of this pre-flight's exit code can show that
# warnings alone would have been green. It is written down because a reader
# comparing a green F1 on a partial host against a green F1 on a complete one is
# otherwise entitled to think they mean the same thing.
for d in "${REPO_ROOT}/pkgs/podman/out-amd64" "${REPO_ROOT}/pkgs/podman/out-arm64"; do
    [ ! -d "${d}" ] || hide "${d}"
done
run_preflight
# The absolute half is only demanded where the host can show it. `BASE_MISSING`
# is 0 on a machine with every board's BSP built and non-zero otherwise; when it
# is 0 the run must be GREEN, and when it is not, the most this case can say is
# that warnings did not move the status either way.
F1_WANT_RC="${BASE_RC}"
[ "${BASE_MISSING}" -eq 0 ] && F1_WANT_RC=0
if [ "${PF_RC}" = "${F1_WANT_RC}" ] && [ "${PF_WARNED}" = "$((${#BINARIES[@]} * 2))" ] &&
    [ "${PF_MISSING}" = "${BASE_MISSING}" ] &&
    says "${PF_OUT}" "BUILT BY THE RUN ITSELF" && says "${PF_OUT}" "three quarters of an hour"; then
    if [ "${BASE_MISSING}" -eq 0 ]; then
        pass "F1 ${PF_WARNED} producible inputs warn, are counted apart from the ${PF_MISSING} missing, and do NOT fail the run (exit 0)"
    else
        pass "F1 ${PF_WARNED} producible inputs warn, are counted apart from the ${BASE_MISSING} missing, and do not change the exit code (${BASE_RC}); the green form needs a host with every board's BSP built"
    fi
else
    fail "F1 expected exit ${F1_WANT_RC} with $((${#BINARIES[@]} * 2)) warned and ${BASE_MISSING} missing; got exit ${PF_RC}, warned ${PF_WARNED}, missing ${PF_MISSING}"
fi
restore_all

echo "== G. the upstream version source is an examined input =="

# The two VERSION_FROM declarations (podman, rauc) are inputs like any other:
# absent, they are reported with everything else in one run rather than at
# that producer's turn. The baseline is re-measured here because section F
# proved the tree returns to it, and a stale baseline would fold F's state
# into these deltas.
run_preflight
G_MISSING="${PF_MISSING}"
G_EXAMINED="${PF_EXAMINED}"

# G1: the named env file is gone -- exactly one more missing input, named.
hide "${REPO_ROOT}/pkgs/rauc/versions.env"
run_preflight
if [ "${PF_RC}" -ne 0 ] && [ "${PF_MISSING}" = "$((G_MISSING + 1))" ] &&
    says "${PF_OUT}" "VERSION_FROM=pkgs/rauc/versions.env:RAUC_VERSION and pkgs/rauc/versions.env does not exist"; then
    pass "G1 a hidden versions.env is one missing input, named with its VERSION_FROM (${G_MISSING} -> ${PF_MISSING})"
else
    fail "G1 expected exit!=0 and $((G_MISSING + 1)) missing naming the VERSION_FROM; got exit ${PF_RC}, missing ${PF_MISSING}"
fi
restore_all

# G2: the file is there and the KEY is not -- the same count, the other message.
RAUC_VERSIONS_ENV="${REPO_ROOT}/pkgs/rauc/versions.env"
cp "${RAUC_VERSIONS_ENV}" "${TMP}/rauc-versions.env.orig"
sed -i 's/^RAUC_VERSION=/RAUC_VERSION_RENAMED=/' "${RAUC_VERSIONS_ENV}"
run_preflight
G2_RC="${PF_RC}"
G2_MISSING="${PF_MISSING}"
G2_NAMED=0
! says "${PF_OUT}" "declares no non-empty RAUC_VERSION" || G2_NAMED=1
cp "${TMP}/rauc-versions.env.orig" "${RAUC_VERSIONS_ENV}"
if [ "${G2_RC}" -ne 0 ] && [ "${G2_MISSING}" = "$((G_MISSING + 1))" ] && [ "${G2_NAMED}" = 1 ]; then
    pass "G2 a versions.env without the named key is one missing input, naming the key"
else
    fail "G2 expected exit!=0 and $((G_MISSING + 1)) missing naming RAUC_VERSION; got exit ${G2_RC}, missing ${G2_MISSING}, named ${G2_NAMED}"
fi

# G3: restored, the run returns to its baseline -- the two mutations above
# proved a delta of exactly one each, and this proves they proved it against
# the same denominator.
run_preflight
if [ "${PF_MISSING}" = "${G_MISSING}" ] && [ "${PF_EXAMINED}" = "${G_EXAMINED}" ]; then
    pass "G3 restoring returns the run to ${G_MISSING} missing of ${G_EXAMINED} examined"
else
    fail "G3 after restoring, expected ${G_MISSING} missing of ${G_EXAMINED}; got ${PF_MISSING} of ${PF_EXAMINED}"
fi

echo
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${PASS_N} checks passed)"
else
    echo "RESULT: FAIL (${FAIL_N} failed, ${PASS_N} passed)"
    exit 1
fi
