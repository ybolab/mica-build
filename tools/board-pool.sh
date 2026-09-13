#!/usr/bin/env bash
# What this tree takes out of the imported board bundles.
#
#   bash tools/board-pool.sh --list               the pinned boards, one per line
#   bash tools/board-pool.sh --fetch <board>      the bundle into _out/boards/<board>/
#   bash tools/board-pool.sh --fetch-all          the same for every pinned board
#   bash tools/board-pool.sh --pin <board> [--tag build-<commit12>]
#                                                 pin the board's newest (or the named) bundle artifact; prints the tag
#   bash tools/board-pool.sh --source             the boards' source at the pinned commit into _out/src/mica-boards
#
#   reads   deps/boards/<board>.json                                (the pin: what a board is, here)
#           build-env/deb/registry.env                              (where the bundle artifact is)
#           meta/verity/signer.cert.pem                              (the trust domain this assembly signs with)
#   writes  _out/boards/<board>/{board.env,evidence.json,manifests/,kernel/,firmware/,component-copyright,uboot/,trust/}
#
# THE PINS ARE THE BOARD LIST. The boards live in one repository
# (ybolab/mica-boards) that builds each kernel and U-Boot and publishes them,
# with the board's board.env, evidence.json, package manifests, the support
# image's firmware and the verity trust certificate the kernel embeds, as
# the OCI artifact <registry>/mica-board/<board>:build-<commit12>, one layer
# per bundle file (mica:docs/boards/contract.md section 3). This assembly
# imports that bundle through deps/boards/<board>.json -- the board, the
# repository, its commit, its architecture and the manifest's digest -- and
# never builds a kernel; a board exists here exactly when its bundle is
# pinned, and every host-time reader -- the composer, the resolver, the
# verifier, the labs -- reads it out of _out/boards/<board>/, which --fetch
# writes. There is no committed copy of a board file to drift from the pin.
#
# TRANSITIONAL: a board pinned the old way, deps/packages/mica-kernel-<board>.json
# naming the kernel archive in the pool, is still read out of that archive
# until every board is pinned as an artifact; then that path goes.
#
# --fetch refuses a bundle whose embedded trust certificate is not
# meta/verity/signer.cert.pem: a kernel that trusts another domain would boot
# a root this assembly did not sign.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
POOL="${MICA_POOL_DIR:-${REPO_ROOT}/_out/debs}"
PINS="${MICA_LOCK_DIR:-${REPO_ROOT}/deps/packages}"
BOARD_PINS="${MICA_BOARD_PINS:-${REPO_ROOT}/deps/boards}"
BOARDS_OUT="${MICA_BOARDS_OUT:-${REPO_ROOT}/_out/boards}"
TRUST_CERT="${MICA_VERITY_TRUST_CERT:-${REPO_ROOT}/meta/verity/signer.cert.pem}"
# shellcheck disable=SC1091
. "${REPO_ROOT}/build-env/deb/registry.sh"

pinned_boards() {
    { for f in "${BOARD_PINS}"/*.json; do [ -e "${f}" ] || continue; b="${f##*/}"; printf '%s\n' "${b%.json}"; done
      for f in "${PINS}"/mica-kernel-*.json; do [ -e "${f}" ] || continue; b="${f##*/mica-kernel-}"; printf '%s\n' "${b%.json}"; done; } | sort -u
}
# A board pin, validated: board, repository, commit, arch, digest.
board_pin() { # <board> -> TSV
    local f="${BOARD_PINS}/$1.json"
    jq -e --arg b "$1" 'type == "object" and (keys | sort) == ["arch", "board", "commit", "digest", "repository"]
        and .board == $b and (.repository | test("^[A-Za-z0-9][A-Za-z0-9._-]*$")) and (.commit | test("^[0-9a-f]{40}$"))
        and (.arch | IN("amd64", "arm64")) and (.digest | test("^sha256:[0-9a-f]{64}$"))' "${f}" >/dev/null 2>&1 ||
        { echo "error: ${f#"${REPO_ROOT}"/} is not a board pin: an object with board (this file's name), repository, a 40-hex commit, arch (amd64|arm64) and the manifest digest (sha256:<64 hex>)" >&2; return 1; }
    jq -r '[.board, .repository, .commit, .arch, .digest] | @tsv' "${f}"
}
# The bundle files every reader needs, and the trust check, over a staged directory.
check_bundle() { # <board> <staging> <what>
    local board="$1" staging="$2" what="$3" f
    for f in board.env manifests/board.pkgs kernel/config kernel/kernel.release kernel/modules.tar trust/verity-signer.cert.pem; do
        [ -e "${staging}/${f}" ] || { echo "error: ${what} carries no ${f}; it is not a board bundle this assembly can read (mica:docs/boards/contract.md section 3)" >&2; return 1; }
    done
    cmp -s "${staging}/trust/verity-signer.cert.pem" "${TRUST_CERT}" || {
        echo "error: ${what} was built against a verity trust certificate that is not ${TRUST_CERT#"${REPO_ROOT}"/}. A kernel that trusts another domain would boot a root this assembly did not sign; build and publish the board's kernel against this assembly's certificate" >&2
        return 1
    }
}
# The bundle artifact, by the pin's manifest digest, into <staging>.
fetch_artifact() { # <board> <staging>
    local board="$1" staging="$2" repository commit arch digest artifact status title media ldigest
    IFS=$'\t' read -r _ repository commit arch digest < <(board_pin "${board}") || return 1
    registry_load && registry_token || return 1
    artifact="$(oci_repo board "${board}")"
    status="$(oci_manifest_get "${artifact}" "${digest}" "${work}/manifest.json")"
    case "${status}" in
    200) ;;
    404) echo "error: ${OCI_HOST}/${artifact} holds no manifest ${digest}; the pin names a bundle ${repository} never published at $(release_tag "${commit}"), or one that was removed (bash tools/board-pool.sh --pin ${board} re-reads what it publishes)" >&2; return 1 ;;
    401 | 403) echo "error: the registry answered ${status} for ${OCI_HOST}/${artifact}; ${MICA_RELEASE_TOKEN_VAR} does not grant read access" >&2; return 1 ;;
    *) echo "error: reading ${OCI_HOST}/${artifact}@${digest} answered HTTP ${status}" >&2; return 1 ;;
    esac
    [ "$(oci_manifest_digest "${work}/manifest.json")" = "${digest}" ] || { echo "error: ${OCI_HOST}/${artifact} served a manifest hashing to $(oci_manifest_digest "${work}/manifest.json") for ${digest}" >&2; return 1; }
    [ "$(jq -r '.annotations["mica.board"] // empty' "${work}/manifest.json")" = "${board}" ] || { echo "error: the manifest ${digest} says mica.board=$(jq -r '.annotations["mica.board"] // "(none)"' "${work}/manifest.json"), not ${board}" >&2; return 1; }
    [ "$(jq -r '.annotations["mica.source-commit"] // empty' "${work}/manifest.json")" = "${commit}" ] || { echo "error: the manifest ${digest} says mica.source-commit=$(jq -r '.annotations["mica.source-commit"] // "(none)"' "${work}/manifest.json"), and the pin says ${commit}" >&2; return 1; }
    local n=0
    while IFS=$'\t' read -r title media ldigest; do
        [ -n "${title}" ] || continue
        case "${title}" in /* | *..* | '') echo "error: the manifest names a layer '${title}' outside the bundle" >&2; return 1 ;; esac
        mkdir -p "${staging}/$(dirname "${title}")"
        status="$(oci_blob_get "${artifact}" "${ldigest}" "${staging}/${title}")"
        [ "${status}" = 200 ] || { echo "error: downloading ${title} (${ldigest}) from ${OCI_HOST}/${artifact} answered HTTP ${status}" >&2; return 1; }
        [ "sha256:$(sha256sum "${staging}/${title}" | cut -d' ' -f1)" = "${ldigest}" ] || { echo "error: ${title} hashed to other bytes than ${ldigest}" >&2; return 1; }
        chmod 0644 "${staging}/${title}"
        n=$((n + 1))
    done < <(jq -r '.layers[] | [.annotations["org.opencontainers.image.title"], .mediaType, .digest] | @tsv' "${work}/manifest.json")
    if [ -f "${staging}/firmware.tar" ]; then
        mkdir -p "${staging}/firmware.d" && tar -C "${staging}/firmware.d" -xf "${staging}/firmware.tar" && rm -f "${staging}/firmware.tar"
        [ -d "${staging}/firmware.d/firmware" ] && mv "${staging}/firmware.d/firmware" "${staging}/firmware"; rm -rf "${staging}/firmware.d"
    fi
    echo "board-pool.sh: ${n} layer(s) of ${OCI_HOST}/${artifact}@${digest:0:19} ($(release_tag "${commit}"))"
}
# A bundle has exactly one target: the board's architecture, read from the
# pin rather than from a board.env that is not yet extracted.
board_arch() {
    python3 - "${PINS}/mica-kernel-$1.json" <<'PY'
import json, sys
pin = json.load(open(sys.argv[1]))
targets = list(pin.get('targets', {}))
if len(targets) != 1:
    raise SystemExit(f'error: {sys.argv[1]} pins {len(targets)} target(s); a board bundle has exactly one, its architecture')
print(targets[0])
PY
}
archive_for() {
    local board="$1" arch found=()
    [ -f "${PINS}/mica-kernel-${board}.json" ] || { echo "error: deps/packages/mica-kernel-${board}.json does not exist; a board IS its pinned bundle, and the pinned boards are: $(pinned_boards | tr '\n' ' ')" >&2; exit 1; }
    arch="$(board_arch "${board}")"
    for f in "${POOL}/${arch}/pool/"mica-kernel-"${board}"_*_"${arch}".deb; do
        [ -e "${f}" ] && found+=("${f}")
    done
    [ "${#found[@]}" -eq 1 ] || {
        echo "error: expected exactly one mica-kernel-${board} archive in ${POOL}/${arch}/pool, found ${#found[@]}. deps/packages/mica-kernel-${board}.json pins it; fetch it with \`make os-pool\`" >&2
        exit 1
    }
    printf '%s\n' "${found[0]}"
}

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
case "${1:-}" in
--list)
    pinned_boards
    ;;
--fetch)
    board="${2:-}"
    [ -n "${board}" ] || { echo "usage: bash tools/board-pool.sh --fetch <board>" >&2; exit 1; }
    [ -f "${TRUST_CERT}" ] || { echo "error: ${TRUST_CERT} does not exist; the kernel's embedded trust certificate is compared against it (MICA_VERITY_TRUST_CERT overrides the path)" >&2; exit 1; }
    dest="${BOARDS_OUT}/${board}"
    # Staged beside the destination and moved into place only once every
    # check has passed; a refusal leaves nothing behind for a discovery to
    # mistake for a board.
    mkdir -p "${BOARDS_OUT}"
    staging="${BOARDS_OUT}/.${board}.fetch"
    rm -rf "${staging}"; mkdir -p "${staging}"
    trap 'rm -rf "${work}" "${staging}"' EXIT
    if [ -f "${BOARD_PINS}/${board}.json" ]; then
        fetch_artifact "${board}" "${staging}" || exit 1
        check_bundle "${board}" "${staging}" "the pinned bundle of ${board}" || exit 1
        rm -rf "${dest}"; mv "${staging}" "${dest}"
        exit 0
    fi
    archive="$(archive_for "${board}")"
    # Every payload member under the board's directory, into the same layout.
    python3 - "${archive}" "usr/lib/mica/board/${board}/" "${staging}" <<'PY'
import io, os, sys, tarfile
archive, prefix, dest = sys.argv[1], sys.argv[2], sys.argv[3]
data = open(archive, 'rb').read()
assert data[:8] == b'!<arch>\n'
at = 8
found = False
while at + 60 <= len(data):
    name = data[at:at + 16].decode('ascii', 'replace').strip().rstrip('/')
    size = int(data[at + 48:at + 58].decode('ascii').strip())
    body = data[at + 60:at + 60 + size]
    at += 60 + size + (size & 1)
    if not name.startswith('data.tar'): continue
    with tarfile.open(fileobj=io.BytesIO(body), mode='r:*') as tar:
        n = 0
        for m in tar.getmembers():
            rel = m.name.lstrip('./')
            if not rel.startswith(prefix): continue
            out = os.path.join(dest, rel[len(prefix):])
            if m.isdir(): os.makedirs(out, exist_ok=True); continue
            if not m.isfile(): raise SystemExit(f'error: {rel} is not a regular file in {archive}')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, 'wb') as f: f.write(tar.extractfile(m).read())
            os.chmod(out, m.mode & 0o777); n += 1
        print(f'board-pool.sh: {n} file(s) of {os.path.basename(archive)}')
    found = True
    break
if not found:
    raise SystemExit(f'error: {archive} carries no data.tar member')
PY
    check_bundle "${board}" "${staging}" "the mica-kernel-${board} archive" || exit 1
    rm -rf "${dest}"; mv "${staging}" "${dest}"
    ;;
--pin)
    board="${2:-}"; tag="${4:-}"
    [ -n "${board}" ] && { [ -z "${3:-}" ] || [ "${3}" = --tag ]; } || { echo "usage: bash tools/board-pool.sh --pin <board> [--tag build-<commit12>]" >&2; exit 1; }
    [[ "${board}" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || { echo "error: '${board}' is not a board name" >&2; exit 1; }
    registry_load && registry_token || exit 1
    artifact="$(oci_repo board "${board}")"
    if [ -z "${tag}" ]; then
        tag="$(newest_tag "${artifact}")" || exit 1
        [ -n "${tag}" ] || { echo "error: ${OCI_HOST}/${artifact} has no build-<commit12> artifact; ${board} was never published (mica-boards: make publish)" >&2; exit 1; }
    fi
    [[ "${tag}" =~ ^build-[0-9a-f]{12}$ ]] || { echo "error: the tag '${tag}' is not build-<commit12>" >&2; exit 1; }
    status="$(oci_manifest_get "${artifact}" "${tag}" "${work}/manifest.json")"
    [ "${status}" = 200 ] || { echo "error: ${OCI_HOST}/${artifact} has no artifact tagged ${tag} (HTTP ${status})" >&2; exit 1; }
    commit="$(jq -r '.annotations["mica.source-commit"] // empty' "${work}/manifest.json")"
    repository="$(jq -r '.annotations["mica.source-repo"] // empty' "${work}/manifest.json")"
    arch="$(jq -r '.annotations["mica.arch"] // empty' "${work}/manifest.json")"
    [[ "${commit}" =~ ^[0-9a-f]{40}$ ]] && [ "${tag}" = "$(release_tag "${commit}")" ] || { echo "error: ${OCI_HOST}/${artifact}:${tag} says mica.source-commit='${commit}', which is not the commit its tag names" >&2; exit 1; }
    [ "$(jq -r '.annotations["mica.board"] // empty' "${work}/manifest.json")" = "${board}" ] || { echo "error: ${OCI_HOST}/${artifact}:${tag} says mica.board=$(jq -r '.annotations["mica.board"] // "(none)"' "${work}/manifest.json")" >&2; exit 1; }
    case "${arch}" in amd64 | arm64) ;; *) echo "error: ${OCI_HOST}/${artifact}:${tag} says mica.arch='${arch}'" >&2; exit 1 ;; esac
    mkdir -p "${BOARD_PINS}"
    jq -n --arg board "${board}" --arg repository "${repository}" --arg commit "${commit}" --arg arch "${arch}" --arg digest "$(oci_manifest_digest "${work}/manifest.json")" \
        '{board: $board, repository: $repository, commit: $commit, arch: $arch, digest: $digest}' >"${work}/pin.json"
    if [ -f "${BOARD_PINS}/${board}.json" ] && cmp -s "${work}/pin.json" "${BOARD_PINS}/${board}.json"; then
        echo "board-pool.sh: deps/boards/${board}.json already pins ${OCI_HOST}/${artifact}:${tag}" >&2
    else
        cp "${work}/pin.json" "${BOARD_PINS}/${board}.json"
        echo "board-pool.sh: deps/boards/${board}.json pins ${OCI_HOST}/${artifact}:${tag} ($(jq -r .digest "${work}/pin.json"))" >&2
    fi
    printf '%s\n' "${tag}"
    ;;
--fetch-all)
    n=0
    while IFS= read -r board; do
        [ -n "${board}" ] || continue
        bash "$0" --fetch "${board}"; n=$((n + 1))
    done < <(pinned_boards)
    [ "${n}" -gt 0 ] || { echo "error: deps/boards pins no board (and deps/packages no mica-kernel-<board> archive), so nothing was fetched" >&2; exit 1; }
    # A fetched board nothing pins any more is a stale directory a discovery
    # would still find.
    for d in "${BOARDS_OUT}"/*/; do
        [ -d "${d}" ] || continue
        b="$(basename "${d}")"
        [ -f "${BOARD_PINS}/${b}.json" ] || [ -f "${PINS}/mica-kernel-${b}.json" ] || { echo "board-pool.sh: removing _out/boards/${b}, which no pin names"; rm -rf "${d}"; }
    done
    echo "board-pool.sh: ${n} board(s) fetched into _out/boards/"
    ;;
--source)
    # The commit every board pin names (they must agree), else the lock rows'.
    commits="$(for f in "${BOARD_PINS}"/*.json; do [ -e "${f}" ] || continue; jq -r .commit "${f}"; done | sort -u)"
    if [ -n "${commits}" ]; then
        [ "$(printf '%s\n' "${commits}" | wc -l)" -eq 1 ] || { echo "error: deps/boards pins boards at several commits (${commits//$'\n'/ }); a bump is half done" >&2; exit 1; }
        MICA_SOURCE_COMMIT="${commits}" bash "${REPO_ROOT}/build-env/deb/source.sh" mica-boards
    else
        bash "${REPO_ROOT}/build-env/deb/source.sh" mica-boards
    fi
    # Every pinned board that boots a FIT: the labs compile its U-Boot file-boot sources.
    n=0
    while IFS= read -r board; do
        [ -n "${board}" ] || continue
        [ -f "${REPO_ROOT}/_out/boards/${board}/board.env" ] || { echo "error: ${board} is pinned and not fetched (make board-fetch BOARD=${board})" >&2; exit 1; }
        grep -qx 'BOOT_BACKEND=uboot-fit' "${REPO_ROOT}/_out/boards/${board}/board.env" || continue
        [ -d "${REPO_ROOT}/_out/src/mica-boards/boards/${board}/loader" ] || { echo "error: _out/src/mica-boards/boards/${board}/loader does not exist at the pinned commit; the labs and the FIT tests read the board's loader sources out of it" >&2; exit 1; }
        n=$((n + 1))
    done < <(pinned_boards)
    [ "${n}" -gt 0 ] || { echo "error: no pinned board boots a FIT, so no U-Boot source was checked out; the FIT labs would run over nothing" >&2; exit 1; }
    ;;
*)
    echo "usage: bash tools/board-pool.sh --list | --fetch <board> | --fetch-all | --pin <board> [--tag build-<commit12>] | --source" >&2
    exit 1
    ;;
esac
