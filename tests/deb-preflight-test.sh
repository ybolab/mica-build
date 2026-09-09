#!/usr/bin/env bash
# Exercise producer input accounting in an isolated repository fixture.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT=$PWD
mkdir -p "$REPO_ROOT/tmp"
TMP=$(mktemp -d "$REPO_ROOT/tmp/deb-preflight.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
STAMP_SH="$REPO_ROOT/pkgs/podman/versions-stamp.sh"
PODMAN_PREPARE="$REPO_ROOT/pkgs/podman/deb/podman/prepare.sh"
PASS_N=0 FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }
says() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
fixture="$TMP/repo"
mkdir -p "$fixture/build-env/deb" "$fixture/pkgs/component" "$fixture/payload"
cp build-env/deb/{preflight,producers}.sh "$fixture/build-env/deb/"
printf 'fixture\n' > "$fixture/Makefile"
printf '#!/bin/bash\nprintf "fixture-image\\n"\n' > "$fixture/build-env/from.sh"
printf 'FROM scratch\n' > "$fixture/pkgs/component/Dockerfile"
cat > "$fixture/pkgs/component/producer.env" <<'ENV'
PACKAGES=mos-fixture
ARCHES=all
BUILD_CONTEXTS=payload=payload
VERSION_FROM=version.env:FIXTURE_VERSION
PREPARE=prepare.sh
PREFLIGHT=1
ENV
printf 'FIXTURE_VERSION=1.0\n' > "$fixture/version.env"
cat > "$fixture/pkgs/component/prepare.sh" <<'HOOK'
#!/bin/bash
set -eu
test "$MOS_DEB_PREFLIGHT" = 1
test -z "${MOS_DEB_STAGE:-}"
for count in examined missing warned; do
    test "${OMIT_COUNT:-}" != "$count" || continue
    case "$count" in
        examined) value=${EXAMINED:-3};;
        missing) value=${MISSING:-0};;
        warned) value=${WARNED:-0};;
    esac
    printf 'preflight-%s: %s\n' "$count" "$value"
done
exit "${HOOK_EXIT:-0}"
HOOK
run_fixture() {
    PF_RC=0
    PF_OUT=$(env "$@" bash "$fixture/build-env/deb/preflight.sh" 2>&1) || PF_RC=$?
}
run_fixture
if [ "$PF_RC" = 0 ] && says "$PF_OUT" '7 of 7 examined inputs are present'; then pass 'complete producer accounts for all inputs'; else fail "$PF_OUT"; fi
mv "$fixture/payload" "$fixture/payload.saved"
mv "$fixture/version.env" "$fixture/version.saved"
run_fixture
if [ "$PF_RC" != 0 ] && says "$PF_OUT" '2 of 7 examined inputs are missing' && says "$PF_OUT" 'payload does not exist' && says "$PF_OUT" 'version.env does not exist'; then pass 'missing context and version are both reported'; else fail "$PF_OUT"; fi
mv "$fixture/payload.saved" "$fixture/payload"
mv "$fixture/version.saved" "$fixture/version.env"
for name in examined missing warned; do
    run_fixture "OMIT_COUNT=$name"
    if [ "$PF_RC" != 0 ] && says "$PF_OUT" "usable preflight-$name count"; then pass "missing $name hook count is refused"; else fail "$PF_OUT"; fi
done
run_fixture EXAMINED=0
if [ "$PF_RC" != 0 ]; then pass 'zero examined hook count is refused'; else fail 'empty hook was accepted'; fi
run_fixture WARNED=2
if [ "$PF_RC" = 0 ] && says "$PF_OUT" 'a further 2 of 7'; then pass 'producible inputs warn without failing'; else fail "$PF_OUT"; fi
run_fixture HOOK_EXIT=9
if [ "$PF_RC" != 0 ] && says "$PF_OUT" 'exited 9'; then pass 'unexplained hook failure is preserved'; else fail "$PF_OUT"; fi
run_fixture MISSING=2 HOOK_EXIT=1
if [ "$PF_RC" != 0 ] && says "$PF_OUT" '2 of 7 examined inputs are missing'; then pass 'missing hook inputs are counted individually'; else fail "$PF_OUT"; fi
printf 'UNRELATED=1\n' > "$fixture/version.env"
run_fixture
if [ "$PF_RC" != 0 ] && says "$PF_OUT" 'no non-empty FIXTURE_VERSION'; then pass 'missing version key is named'; else fail "$PF_OUT"; fi

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


echo "RESULT: $PASS_N passed, $FAIL_N failed"
test "$FAIL_N" = 0
