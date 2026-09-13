#!/usr/bin/env bash
# tools/board-pool.sh against a real registry: a board bundle pushed as its
# artifact is pinned by --pin and read back by --fetch, layer by layer, and
# every refusal is by name.
#
#   bash tests/board-artifact-test.sh          (docker on the host)
#
# The registry is the image build-env/images.env pins, a sibling container
# spoken to over plain HTTP; the bundle is a fixture written here. The
# scripts are pointed at scratch pins, a scratch boards directory and the
# fixture's trust certificate through their environment overrides.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
for t in curl sha256sum jq docker tar; do
    command -v "${t}" >/dev/null 2>&1 || { echo "error: ${t} is required" >&2; exit 1; }
done
WORK="$(mktemp -d "${REPO_ROOT}/_out/board-artifact-test.XXXXXX")"
NAME="ai-agent-board-artifact-test-$$"
cleanup() { docker rm -f "${NAME}" >/dev/null 2>&1 || true; rm -rf "${WORK}"; }
trap cleanup EXIT
PASS_N=0; FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }
says() { grep -c -- "$2" "$1" >/dev/null; }

IMAGE="$(bash build-env/from.sh --ref IMAGE_REGISTRY_2)"
docker run -d --rm --label ai-agent=true --name "${NAME}" --network "${MICA_TEST_NETWORK:-traefik}" "${IMAGE}" >/dev/null
for i in $(seq 1 30); do curl -sf -o /dev/null "http://${NAME}:5000/v2/" && break; sleep 1; done
curl -sf -o /dev/null "http://${NAME}:5000/v2/" || { echo "error: the registry ${NAME} did not answer" >&2; exit 1; }
cat >"${WORK}/registry.env" <<ENV
MICA_REGISTRY=${NAME}:5000/testorg
MICA_REGISTRY_USER=nobody
MICA_RELEASE_TOKEN_VAR=BOARD_TEST_TOKEN
MICA_SOURCE_URL=https://example.invalid/testorg
ENV
export MICA_REGISTRY_ENV="${WORK}/registry.env" MICA_RELEASE_NO_GH=1 MICA_REGISTRY_PLAIN_HTTP=1 BOARD_TEST_TOKEN=fixture
export MICA_BOARD_PINS="${WORK}/pins" MICA_BOARDS_OUT="${WORK}/boards" MICA_LOCK_DIR="${WORK}/packages"
mkdir -p "${MICA_BOARD_PINS}" "${MICA_BOARDS_OUT}" "${MICA_LOCK_DIR}"
export MICA_VERITY_TRUST_CERT="${WORK}/trust.pem"
printf -- '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n' >"${MICA_VERITY_TRUST_CERT}"

# A bundle, as tools/publish-boards.sh in mica-boards lays one out.
BUNDLE="${WORK}/bundle"
mkdir -p "${BUNDLE}/manifests" "${BUNDLE}/kernel" "${BUNDLE}/trust" "${BUNDLE}/fw/firmware/vendor"
printf 'LAYOUT_BOARD=fixture-board\nMICA_ARCH=arm64\nBOOT_BACKEND=systemd-boot\n' >"${BUNDLE}/board.env"
printf '{"board":"fixture-board"}\n' >"${BUNDLE}/evidence.json"
printf 'mica-board-fixture-board\n' >"${BUNDLE}/manifests/board.pkgs"
printf 'CONFIG_FIXTURE=y\n' >"${BUNDLE}/kernel/config"
printf '6.12.0-fixture\n' >"${BUNDLE}/kernel/kernel.release"
printf 'modules\n' >"${BUNDLE}/kernel/modules.tar"
cp "${MICA_VERITY_TRUST_CERT}" "${BUNDLE}/trust/verity-signer.cert.pem"
printf 'blob\n' >"${BUNDLE}/fw/firmware/vendor/chip.bin"
(cd "${BUNDLE}/fw" && tar --owner=0 --group=0 --numeric-owner --mtime='@0' -cf ../firmware.tar firmware) && rm -rf "${BUNDLE}/fw"
COMMIT="$(printf '%040d' 7 | tr 0 a)"; TAG="build-${COMMIT:0:12}"
# shellcheck disable=SC1091
. build-env/deb/registry.sh
registry_load; registry_token
: >"${WORK}/layers.tsv"
while IFS= read -r f; do printf '%s\t%s\t%s\n' "${BUNDLE}/${f}" "application/vnd.mica.board.file" "${f}" >>"${WORK}/layers.tsv"; done < <(cd "${BUNDLE}" && find . -type f -printf '%P\n' | LC_ALL=C sort)
jq -n --arg commit "${COMMIT}" --arg cert "$(sha256sum "${MICA_VERITY_TRUST_CERT}" | cut -d' ' -f1)" \
    '{"org.opencontainers.image.revision": $commit, "org.opencontainers.image.created": "2026-09-13T10:00:00Z", "mica.source-repo": "mica-boards", "mica.source-commit": $commit, "mica.board": "fixture-board", "mica.arch": "arm64", "mica.verity-cert-sha256": $cert}' >"${WORK}/annotations.json"
# The package is the repository that publishes it; the artifact is a tag.
ARTIFACT="$(oci_repo mica-boards)"; REF="$(oci_tag board fixture-board "${TAG}")"
[ "${ARTIFACT}:${REF}" = "testorg/mica-boards:board.fixture-board.${TAG}" ] && pass "a board bundle is <owner>/mica-boards:board.<board>.build-<commit12>" || fail "the bundle name is ${ARTIFACT}:${REF}"
DIGEST="$(oci_push "${ARTIFACT}" "${REF}" application/vnd.mica.board "${WORK}/annotations.json" "${WORK}/layers.tsv")"
[ -n "${DIGEST}" ] && pass "the fixture bundle is pushed as ${ARTIFACT}:${REF} (${DIGEST:0:19})" || fail "the fixture bundle could not be pushed"

LOG="${WORK}/log"
if tag="$(bash tools/board-pool.sh --pin fixture-board 2>"${LOG}")" && [ "${tag}" = "${TAG}" ] && [ "$(jq -r .digest "${MICA_BOARD_PINS}/fixture-board.json")" = "${DIGEST}" ] && [ "$(jq -r .arch "${MICA_BOARD_PINS}/fixture-board.json")" = arm64 ]; then
    pass "--pin writes deps/boards/<board>.json with the newest artifact's commit, architecture and manifest digest, and prints the tag"
else fail "--pin did not pin the fixture: $(tail -n 3 "${LOG}")"; fi
if bash tools/board-pool.sh --list >"${LOG}" 2>&1 && says "${LOG}" "^fixture-board$"; then pass "--list names the pinned board"; else fail "--list did not name the board: $(cat "${LOG}")"; fi
if bash tools/board-pool.sh --fetch fixture-board >"${LOG}" 2>&1 && [ -f "${MICA_BOARDS_OUT}/fixture-board/board.env" ] && [ -f "${MICA_BOARDS_OUT}/fixture-board/firmware/vendor/chip.bin" ] && [ ! -e "${MICA_BOARDS_OUT}/fixture-board/firmware.tar" ] && [ "$(cat "${MICA_BOARDS_OUT}/fixture-board/kernel/kernel.release")" = 6.12.0-fixture ]; then
    pass "--fetch reads every layer at its digest into _out/boards/<board>/ and unpacks the firmware tar"
else fail "--fetch did not lay the bundle out: $(tail -n 3 "${LOG}")"; fi
if bash tools/board-pool.sh --fetch-all >"${LOG}" 2>&1 && says "${LOG}" "1 board(s) fetched"; then pass "--fetch-all fetches every pinned board"; else fail "--fetch-all: $(tail -n 2 "${LOG}")"; fi
if ! bash tools/board-pool.sh --pin nosuch-board >"${LOG}" 2>&1 && says "${LOG}" "was never published"; then pass "a board nobody published is refused by name"; else fail "an unpublished board was not refused: $(tail -n 2 "${LOG}")"; fi
jq '.digest = "sha256:" + ("0" * 64)' "${MICA_BOARD_PINS}/fixture-board.json" >"${WORK}/p.json" && mv "${WORK}/p.json" "${MICA_BOARD_PINS}/fixture-board.json"
rm -rf "${MICA_BOARDS_OUT}/fixture-board"
if ! bash tools/board-pool.sh --fetch fixture-board >"${LOG}" 2>&1 && says "${LOG}" "holds no manifest sha256:0000"; then pass "a pin whose digest the registry does not hold is refused by name"; else fail "an unknown manifest digest was not refused: $(tail -n 2 "${LOG}")"; fi
[ ! -e "${MICA_BOARDS_OUT}/fixture-board" ] && pass "a refused fetch leaves no board directory behind" || fail "a refused fetch left a board directory"
bash tools/board-pool.sh --pin fixture-board >/dev/null 2>&1
printf -- '-----BEGIN CERTIFICATE-----\nother\n-----END CERTIFICATE-----\n' >"${MICA_VERITY_TRUST_CERT}"
if ! bash tools/board-pool.sh --fetch fixture-board >"${LOG}" 2>&1 && says "${LOG}" "verity trust certificate that is not"; then pass "a bundle built against another trust certificate is refused"; else fail "another trust domain was not refused: $(tail -n 2 "${LOG}")"; fi

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) (${PASS_N} passed, ${FAIL_N} failed)"
[ "${FAIL_N}" -eq 0 ]
