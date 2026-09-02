#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REL_DIST="pkgs/mosd/apid/ui/dist"
DIST_PROBE="${REL_DIST}/index.html"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

tracked="$(git -C "${ROOT}" ls-files -- "${REL_DIST}")"
[ -z "${tracked}" ] || fail "${REL_DIST}/ is generated output but Git still tracks files below it"

git -C "${ROOT}" check-ignore --no-index -q "${DIST_PROBE}" ||
    fail "${REL_DIST}/ is generated output but is not ignored"

[ -f "${ROOT}/pkgs/mosd/apid/ui/build.sh" ] ||
    fail "the built-in UI has no production build entry"

refusal="$(
    cd "${ROOT}/pkgs/mosd/apid/ui"
    bash ./build.sh --out-dir . 2>&1
)" && fail "the production build accepted the UI source tree as its output"
case "${refusal}" in
*"because it contains the source tree"*) ;;
*) fail "the unsafe output refusal did not name the source-tree risk" ;;
esac

grep -q 'MOS_APID_UI_DIST_DIR' "${ROOT}/pkgs/mosd/apid/build.rs" ||
    fail "apid/build.rs does not require the generated UI directory"

for entry in \
    "pkgs/mosd/hack/check.sh" \
    "pkgs/mosd/hack/build-target.sh" \
    "pkgs/mosd/hack/build-deb.sh"
do
    grep -q 'apid/ui/build.sh' "${ROOT}/${entry}" ||
        fail "${entry} does not build the UI before Cargo"
    grep -q 'MOS_APID_UI_DIST_DIR' "${ROOT}/${entry}" ||
        fail "${entry} does not pass the generated UI directory to Cargo"
done

echo "APID UI BUILD CONTRACT PASSED"
