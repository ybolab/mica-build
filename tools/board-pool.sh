#!/usr/bin/env bash
# What this tree takes out of the imported board bundles.
#
#   bash tools/board-pool.sh --list               the pinned boards, one per line
#   bash tools/board-pool.sh --fetch <board>      the bundle into _out/boards/<board>/
#   bash tools/board-pool.sh --fetch-all          the same for every pinned board
#   bash tools/board-pool.sh --source             the boards' source at the pinned commit into _out/src/mica-boards
#
#   reads   deps/packages/mica-kernel-<board>.json                 (the pins: what a board is, here)
#           _out/debs/<arch>/pool/mica-kernel-<board>_*.deb         (fetched at the pin by build-env/deb/fetch.sh)
#           meta/verity/signer.cert.pem                              (the trust domain this assembly signs with)
#   writes  _out/boards/<board>/{board.env,evidence.json,manifests/,kernel/,firmware/,component-copyright,uboot/,trust/}
#
# THE PINS ARE THE BOARD LIST. The boards live in one repository
# (ybolab/mica-boards) that builds each kernel and U-Boot and publishes them,
# with the board's board.env, evidence.json, package manifests, the support
# image's firmware and the verity trust certificate the kernel embeds, as the
# bundle mica-kernel-<board> under /usr/lib/mica/board/<board>/. This
# assembly imports that bundle through deps/packages/ and never builds a
# kernel; a board exists here exactly when its bundle is pinned, and every
# host-time reader -- the composer, the resolver, the verifier, the labs --
# reads it out of _out/boards/<board>/, which --fetch writes. There is no
# committed copy of a board file to drift from the pin.
#
# --fetch refuses a bundle whose embedded trust certificate is not
# meta/verity/signer.cert.pem: a kernel that trusts another domain would boot
# a root this assembly did not sign.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
POOL="${MICA_POOL_DIR:-${REPO_ROOT}/_out/debs}"
PINS="${REPO_ROOT}/deps/packages"
TRUST_CERT="${MICA_VERITY_TRUST_CERT:-${REPO_ROOT}/meta/verity/signer.cert.pem}"

pinned_boards() {
    for f in "${PINS}"/mica-kernel-*.json; do
        [ -e "${f}" ] || continue
        b="${f##*/mica-kernel-}"; printf '%s\n' "${b%.json}"
    done | sort
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
    archive="$(archive_for "${board}")"
    [ -f "${TRUST_CERT}" ] || { echo "error: ${TRUST_CERT} does not exist; the kernel's embedded trust certificate is compared against it (MICA_VERITY_TRUST_CERT overrides the path)" >&2; exit 1; }
    dest="${REPO_ROOT}/_out/boards/${board}"
    # Staged beside the destination and moved into place only once every
    # check has passed; a refusal leaves nothing behind for a discovery to
    # mistake for a board.
    staging="${REPO_ROOT}/_out/boards/.${board}.fetch"
    rm -rf "${staging}"; mkdir -p "${staging}"
    trap 'rm -rf "${work}" "${staging}"' EXIT
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
    for f in board.env manifests/board.pkgs kernel/config kernel/kernel.release kernel/modules.tar trust/verity-signer.cert.pem; do
        [ -e "${staging}/${f}" ] || { echo "error: the mica-kernel-${board} archive carries no ${f}; it is not a board bundle this assembly can read (mica:docs/boards/contract.md section 3)" >&2; exit 1; }
    done
    cmp -s "${staging}/trust/verity-signer.cert.pem" "${TRUST_CERT}" || {
        echo "error: the pinned mica-kernel-${board} archive was built against a verity trust certificate that is not ${TRUST_CERT#"${REPO_ROOT}"/}. A kernel that trusts another domain would boot a root this assembly did not sign; build and release the board's kernel against this assembly's certificate" >&2
        exit 1
    }
    rm -rf "${dest}"; mv "${staging}" "${dest}"
    ;;
--fetch-all)
    n=0
    while IFS= read -r board; do
        [ -n "${board}" ] || continue
        bash "$0" --fetch "${board}"; n=$((n + 1))
    done < <(pinned_boards)
    [ "${n}" -gt 0 ] || { echo "error: deps/packages pins no mica-kernel-<board> archive, so nothing was fetched" >&2; exit 1; }
    # A fetched board nothing pins any more is a stale directory a discovery
    # would still find.
    for d in "${REPO_ROOT}"/_out/boards/*/; do
        [ -d "${d}" ] || continue
        b="$(basename "${d}")"
        [ -f "${PINS}/mica-kernel-${b}.json" ] || { echo "board-pool.sh: removing _out/boards/${b}, which no pin names"; rm -rf "${d}"; }
    done
    echo "board-pool.sh: ${n} board(s) fetched into _out/boards/"
    ;;
--source)
    bash "${REPO_ROOT}/build-env/deb/source.sh" mica-boards
    # Every pinned board that boots a FIT: the labs compile its U-Boot file-boot sources.
    n=0
    while IFS= read -r board; do
        [ -n "${board}" ] || continue
        [ -f "${REPO_ROOT}/_out/boards/${board}/board.env" ] || { echo "error: ${board} is pinned and not fetched (make board-fetch BOARD=${board})" >&2; exit 1; }
        grep -qx 'BOOT_BACKEND=uboot-fit' "${REPO_ROOT}/_out/boards/${board}/board.env" || continue
        [ -d "${REPO_ROOT}/_out/src/mica-boards/${board}/bsp" ] || { echo "error: _out/src/mica-boards/${board}/bsp does not exist at the pinned commit; the labs and the FIT tests read the board's sources out of it" >&2; exit 1; }
        n=$((n + 1))
    done < <(pinned_boards)
    [ "${n}" -gt 0 ] || { echo "error: no pinned board boots a FIT, so no U-Boot source was checked out; the FIT labs would run over nothing" >&2; exit 1; }
    ;;
*)
    echo "usage: bash tools/board-pool.sh --list | --fetch <board> | --fetch-all | --source" >&2
    exit 1
    ;;
esac
