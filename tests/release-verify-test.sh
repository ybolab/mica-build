#!/usr/bin/env bash
# docs/design/release-artifacts.md section 6.2's customer verification,
# EXECUTED, and the publication gate's refusals, each proven red by mutation.
#
# Three things are asserted, and the first is the one that keeps the document
# honest:
#
#   1. THE DOCUMENTED COMMANDS RUN. The verification command lines are read
#      OUT OF THE DOCUMENT, from between its `release-verify-test` markers --
#      never copied here -- and executed in a release directory assembled by
#      the shipped CLI from fixture inputs. An empty extraction is a failure,
#      not a green: a marker rename would otherwise turn this file into a test
#      of nothing. The sha256 line is additionally driven RED on a tampered
#      copy, because a verification command that cannot fail on the defect it
#      documents is prose, not verification.
#   2. THE GATE'S REFUSALS, each proven red by mutating a fresh copy of the
#      assembled release -- delete an artifact, flip a byte, drop the notes,
#      drop the evidence, edit the channel, diverge the evidence -- and each
#      matched on a FRAGMENT of its message, with every fragment then required
#      to be absent from all the other refusals' messages, the discipline
#      tests/rootfs-manifest-test.sh states.
#   3. THE POSITIVE CONTROLS beside them: the pristine directory assembles,
#      verifies and gates green, or the refusals above prove nothing.
#
# Fixture-based: no image build, no docker beyond what build/run.sh itself
# asserts. Scratch lives under tmp/, never /tmp, per .gitignore.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
export LC_ALL=C

DOC="docs/design/release-artifacts.md"
SCRATCH="${REPO_ROOT}/tmp/release-verify-test.$$"
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

# The customer procedure names these tools, so their absence is a failure of
# this host to run the test, said plainly rather than skipped over.
for tool in sha256sum jq; do
    command -v "${tool}" >/dev/null 2>&1 || {
        echo "error: ${tool} is not on this host, and ${DOC}'s customer procedure runs it; this test cannot stand in for a customer without it" >&2
        exit 1
    }
done

# ---------------------------------------------------------------------------
# 1. A release, assembled by the shipped CLI from fixture inputs.
# ---------------------------------------------------------------------------

IN="${SCRATCH}/in"
mkdir -p "${IN}"
printf 'fixture disk image bytes\n' >"${IN}/cx3576-mos-90001.img"
printf 'fixture bundle bytes\n' >"${IN}/mos-cx3576-90001.raucb"
printf '#package\tversion\tarchitecture\nlibc6\t2.41-12\tarm64\nmos-system\t0.1.0+git0123456789ab-1\tarm64\nmosd\t0.1.0+git0123456789ab-1\tarm64\n' >"${IN}/manifest.tsv"
printf '# fixture release\n\ntest material; nothing shipped.\n' >"${IN}/NOTES.md"
cat >"${IN}/evidence.json" <<'EOF'
{
  "schemaVersion": 2,
  "board": "cx3576",
  "revision": "all",
  "bootAssurance": "I1",
  "qualification": "dev-fixture: test material, no hardware evidence",
  "evidenceRefs": [{"class": "verity-root", "ref": "dev-fixture: verify/run.sh --verify"}],
  "physicalBoundaries": {
    "jtag": "dev-fixture: open on the bench",
    "serialConsole": "dev-fixture: login prompt only",
    "recoveryPath": "dev-fixture: rockusb open to physical access"
  }
}
EOF

RELEASE="${SCRATCH}/release"
assemble_log="${SCRATCH}/assemble.log"
if bash build/run.sh --release assemble 9.9.9-test --board cx3576 \
    --image "${IN}/cx3576-mos-90001.img" \
    --update-bundle "${IN}/mos-cx3576-90001.raucb" \
    --package-manifest "${IN}/manifest.tsv" \
    --notes "${IN}/NOTES.md" \
    --evidence "${IN}/evidence.json" \
    --out-dir "${RELEASE}" >"${assemble_log}" 2>&1; then
    pass "the fixture release assembles through the shipped CLI"
else
    echo "error: the fixture release did not assemble; everything below would test nothing. Output:" >&2
    cat "${assemble_log}" >&2
    exit 1
fi

for f in manifest.json SHA256SUMS sbom.cdx.json provenance.json licenses.json release-notes.md; do
    if [ -s "${RELEASE}/${f}" ]; then
        pass "the release directory carries ${f}"
    else
        fail "the release directory is missing ${f} after a successful assemble"
    fi
done

# The empty-notes refusal at assembly: requirement "release notes are absent"
# has a second edge -- present and empty -- and the assembler is the arm that
# can see it before anything is written.
: >"${IN}/EMPTY-NOTES.md"
if bash build/run.sh --release assemble 9.9.9-test --board cx3576 \
    --image "${IN}/cx3576-mos-90001.img" --update-bundle "${IN}/mos-cx3576-90001.raucb" \
    --package-manifest "${IN}/manifest.tsv" --notes "${IN}/EMPTY-NOTES.md" \
    --evidence "${IN}/evidence.json" --out-dir "${SCRATCH}/release-empty-notes" \
    >"${SCRATCH}/empty-notes.log" 2>&1; then
    fail "assemble ACCEPTED empty release notes"
elif grep -c "are empty" "${SCRATCH}/empty-notes.log" >/dev/null; then
    pass "assemble refuses empty release notes, saying so"
else
    fail "assemble refused empty notes with some OTHER message: $(cat "${SCRATCH}/empty-notes.log")"
fi

# ---------------------------------------------------------------------------
# 2. The documented customer verification, read out of the document and run.
# ---------------------------------------------------------------------------

CMDS="$(sed -n '/release-verify-test: begin/,/release-verify-test: end/p' "${DOC}" \
    | sed -e '/release-verify-test/d' -e '/^```/d' -e '/^[[:space:]]*$/d')"
CMD_N=0
while IFS= read -r _; do CMD_N=$((CMD_N + 1)); done <<<"${CMDS}"
[ -n "${CMDS}" ] && [ "${CMD_N}" -gt 0 ] || {
    echo "error: no command line could be extracted from ${DOC}'s release-verify-test markers; the markers moved or the block is empty, and a test that runs nothing reports the same green as one that passes" >&2
    exit 1
}
case "${CMDS}" in
*"sha256sum -c"*) pass "the document names 'sha256sum -c' as the integrity check (${CMD_N} command line(s) extracted)" ;;
*)
    echo "error: the extracted commands do not include 'sha256sum -c'; the customer procedure lost its integrity check and this test would happily run whatever replaced it" >&2
    exit 1
    ;;
esac

while IFS= read -r cmd; do
    if (cd "${RELEASE}" && bash -o pipefail -c "${cmd}" >"${SCRATCH}/cmd.out" 2>&1); then
        pass "documented command succeeds on the pristine release: ${cmd}"
    else
        fail "documented command FAILED on the pristine release: ${cmd} -- $(cat "${SCRATCH}/cmd.out")"
    fi
done <<<"${CMDS}"

# The RED direction: the sha256 line must fail on a tampered copy, or the
# document's integrity check is a command that cannot fail.
SUM_CMD="$(printf '%s\n' "${CMDS}" | sed -n '/sha256sum -c/p' | head -n 1)"
TAMPERED="${SCRATCH}/tampered"
cp -a "${RELEASE}" "${TAMPERED}"
printf 'fixture disk image bytEs\n' >"${TAMPERED}/cx3576-mos-90001.img"
if (cd "${TAMPERED}" && bash -o pipefail -c "${SUM_CMD}" >"${SCRATCH}/tamper.out" 2>&1); then
    fail "the documented '${SUM_CMD}' PASSED on a release with a flipped byte"
else
    pass "the documented '${SUM_CMD}' goes red on a flipped byte"
fi

# ---------------------------------------------------------------------------
# 3. The publication gate: pristine green, then each refusal red by mutation.
# ---------------------------------------------------------------------------

gate_out=""
gate_err=""
gate_rc=0
run_gate() {
    local dir="$1" evidence="$2"
    local errfile="${SCRATCH}/gate.err"
    gate_out=""
    gate_rc=0
    if gate_out="$(bash build/run.sh --release gate --board cx3576 --dir "${dir}" --evidence "${evidence}" 2>"${errfile}")"; then
        gate_rc=0
    else
        gate_rc=$?
    fi
    gate_err="$(cat "${errfile}")"
    rm -f "${errfile}"
    # The copy's directory is what differs between mutations, so it is
    # normalised out before messages are compared to each other.
    gate_err="${gate_err//${dir}/<RELEASE>}"
    gate_err="${gate_err//${SCRATCH}/<SCRATCH>}"
}

run_gate "${RELEASE}" "${IN}/evidence.json"
if [ "${gate_rc}" -eq 0 ]; then
    case "${gate_out}" in
    *"release gate: PASS"*) pass "the gate passes the pristine release, saying PASS" ;;
    *) fail "the gate exited 0 without saying PASS: ${gate_out}" ;;
    esac
else
    fail "the gate refused the pristine release: ${gate_err}"
fi

REFUSAL_LABELS=()
REFUSAL_TOKENS=()
REFUSAL_TEXTS=()
# label, the fragment the message must carry, then a mutation run in the
# copy's directory. Matching the MESSAGE and not only the exit status is the
# point: several faults are true of more than one refusal at once, and only
# the fragment says which guard actually fired.
mutate_n=0
expect_gate_refusal() {
    local label="$1" token="$2" evidence="$3"
    shift 3
    mutate_n=$((mutate_n + 1))
    local dir="${SCRATCH}/mutant-${mutate_n}"
    cp -a "${RELEASE}" "${dir}"
    (cd "${dir}" && "$@")
    run_gate "${dir}" "${evidence}"
    if [ "${gate_rc}" -eq 0 ]; then
        fail "${label}: the gate PASSED where it had to refuse"
        return
    fi
    if [ "${gate_err}" = "${gate_err/${token}/}" ]; then
        fail "${label}: refused, but with a message that does not carry '${token}', so this is some OTHER refusal firing: ${gate_err}"
        return
    fi
    REFUSAL_LABELS+=("${label}")
    REFUSAL_TOKENS+=("${token}")
    REFUSAL_TEXTS+=("${gate_err}")
    pass "${label}: refused, naming '${token}'"
}

flip_image_byte() {
    printf 'fixture disk image bytEs\n' >cx3576-mos-90001.img
}
edit_channel() {
    jq '.release.channel = "nightly"' manifest.json >manifest.json.new
    mv manifest.json.new manifest.json
}

expect_gate_refusal "a deleted artifact (the bundle)" \
    "mos-cx3576-90001.raucb (role bundle)" "${IN}/evidence.json" \
    rm mos-cx3576-90001.raucb
expect_gate_refusal "a flipped byte in the image" \
    "hashes to sha256" "${IN}/evidence.json" \
    flip_image_byte
expect_gate_refusal "deleted release notes" \
    "release-notes.md (role release-notes)" "${IN}/evidence.json" \
    rm release-notes.md
expect_gate_refusal "absent board evidence" \
    "no board evidence at" "${SCRATCH}/no-such-evidence.json" \
    true
expect_gate_refusal "a channel outside the enum, edited into the manifest" \
    "nightly" "${IN}/evidence.json" \
    edit_channel

# The diverged file must itself be a VALID I2 claim (every I2 class present),
# or the evidence-semantics refusal would fire before the divergence guard.
cat >"${IN}/evidence-diverged.json" <<'EOF'
{
  "schemaVersion": 2,
  "board": "cx3576",
  "revision": "all",
  "bootAssurance": "I2",
  "qualification": "dev-fixture: diverged after assembly",
  "evidenceRefs": [
    {"class": "verity-root", "ref": "dev-fixture: verity suite"},
    {"class": "ab-fallback", "ref": "dev-fixture: handshake suite"},
    {"class": "update-negative", "ref": "dev-fixture: tampered-bundle suite"}
  ],
  "physicalBoundaries": {
    "jtag": "dev-fixture: open on the bench",
    "serialConsole": "dev-fixture: login prompt only",
    "recoveryPath": "dev-fixture: rockusb open to physical access"
  }
}
EOF
expect_gate_refusal "evidence that diverged from the manifest after assembly" \
    "asserts boot-assurance 'I2'" "${IN}/evidence-diverged.json" \
    true

sed 's/"bootAssurance": "I1"/"bootAssurance": "I2"/' "${IN}/evidence.json" >"${IN}/evidence-inflated.json"
expect_gate_refusal "a claim inflated past its evidence classes" \
    "no evidenceRefs entry of class 'ab-fallback'" "${IN}/evidence-inflated.json" \
    true

REFUSAL_N="${#REFUSAL_LABELS[@]}"
[ "${REFUSAL_N}" -gt 0 ] || {
    echo "error: not one refusal was recorded, so the two checks below compare nothing against nothing" >&2
    exit 1
}

# Every refusal must have its OWN message, and every fragment must appear in
# its own refusal and in none of the others -- the same two closing checks
# tests/rootfs-manifest-test.sh states the reasons for.
distinct_n="$(printf '%s\n' "${REFUSAL_TEXTS[@]}" | sort -u | wc -l)"
if [ "${distinct_n}" -ge "${REFUSAL_N}" ]; then
    pass "${REFUSAL_N} refusals, each with its own message"
else
    fail "${REFUSAL_N} refusals produced shared messages; at least two faults are indistinguishable to an operator"
fi

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

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) ($((PASS_N))/$((PASS_N + FAIL_N)) checks passed, ${CMD_N} documented commands executed, ${REFUSAL_N} refusals proven red)"
[ "${FAIL_N}" -eq 0 ]
