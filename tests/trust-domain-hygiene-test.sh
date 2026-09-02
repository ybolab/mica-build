#!/usr/bin/env bash
# The independence of the two production trust domains, and the hygiene both
# depend on, asserted against the tree.
#
#   bash tests/trust-domain-hygiene-test.sh
#
# WHY THIS FILE EXISTS. docs/design/release-signing.md's whole containment
# argument is one sentence: compromise of either chain is contained by the
# other ONLY if the keys are actually separate. In this tree that separation
# is two directories — the repository-root ca/ (RAUC: X.509 CA and signer,
# PEM) and pkgs/rauc-sign/.devkeys/ or a ceremony directory (TUF: four
# ed25519 .pk8 files) — and nothing enforced that they stay two: a
# convenience edit pointing one tool at the other's directory, or a key file
# slipping into git, would be visible only to a reader who happened to look.
# These are cheap greps against the index and the sources, so the claim is
# re-proved on every run instead of trusted to review.
#
# WHAT IS PROVED:
#   1. No key material is tracked by git, under any of the names the two
#      generators write, and none can be added: the directories both
#      generators write into are covered by .gitignore.
#   2. Each domain's tooling names only its OWN key directory. The seams are
#      first proved to exist (the grep that would catch a violation runs over
#      content that demonstrably contains the positive case), so an empty
#      result means "clean", not "looked at nothing".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
cd "${REPO_ROOT}"

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

# 1a. Nothing tracked looks like key material. The name list is both
# generators' output plus the PKCS#8/PEM shapes any future generator would
# plausibly use. `git ls-files` is the index — what a commit would ship.
tracked_keys="$(git ls-files '*.pk8' '*.key.pem' '*.key' '*ca.cert.pem' '*signer.cert.pem' '*.srl')"
if [ -z "${tracked_keys}" ]; then
    pass "no key or trust-root material is tracked by git"
else
    fail "tracked files that look like key material:"$'\n'"${tracked_keys}"
fi

# The search space is populated: the tree really does contain the sources the
# greps below run over, so their empty results mean something.
[ -f build/src/bundle.ts ] || { echo "error: build/src/bundle.ts is gone; this suite's seam map is stale" >&2; exit 1; }
[ -f pkgs/rauc-sign/src/main.rs ] || { echo "error: pkgs/rauc-sign/src/main.rs is gone; this suite's seam map is stale" >&2; exit 1; }

# 1b. Both key directories are gitignored, checked the way git itself decides:
# a path inside each must be ignored. check-ignore exits 1 for "not ignored",
# which is exactly the failure being tested for.
for probe in ca/ca.key.pem pkgs/rauc-sign/.devkeys/root.pk8 pkgs/rauc/.devkeys/ca.key.pem; do
    if git check-ignore -q "${probe}"; then
        pass "${probe%/*}/ is gitignored"
    else
        fail "${probe%/*}/ is NOT gitignored; a key written there could be committed"
    fi
done

# 2. Each domain names only its own seam. The positive controls come first:
# if the tree stops naming the seams at all, the negative greps would pass
# vacuously and this suite must say so instead.
grep -q "ca/" build/src/bundle.ts || {
    echo "error: build/src/bundle.ts no longer names ca/; the RAUC seam moved and this suite's map is stale" >&2
    exit 1
}
grep -q "pkgs/rauc-sign/.devkeys" pkgs/rauc-sign/src/main.rs || {
    echo "error: pkgs/rauc-sign/src/main.rs no longer names its .devkeys default; the TUF seam moved and this suite's map is stale" >&2
    exit 1
}

# The TUF tool never reaches into the RAUC trust root...
tuf_reaches_ca="$(grep -rn "ca\.cert\.pem\|ca\.key\.pem\|signer\.cert\.pem\|signer\.key\.pem\|keyring\.pem" pkgs/rauc-sign/src/ || true)"
if [ -z "${tuf_reaches_ca}" ]; then
    pass "pkgs/rauc-sign/src/ names no RAUC CA/signer/keyring file"
else
    fail "the TUF tool reaches into the RAUC trust domain:"$'\n'"${tuf_reaches_ca}"
fi

# ...and the RAUC side never reaches into the TUF key directory.
rauc_reaches_tuf="$(grep -rn "\.devkeys\|\.pk8" pkgs/rauc/*.sh pkgs/rauc/*.in rootfs/build.sh build/src/bundle.ts || true)"
if [ -z "${rauc_reaches_tuf}" ]; then
    pass "the RAUC build surfaces name no TUF key directory or .pk8 file"
else
    fail "the RAUC side reaches into the TUF trust domain:"$'\n'"${rauc_reaches_tuf}"
fi

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) (${PASS_N} passed, ${FAIL_N} failed)"
[ "${FAIL_N}" -eq 0 ]
