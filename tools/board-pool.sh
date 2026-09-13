#!/usr/bin/env bash
# What this tree takes out of the imported board archives.
#
#   bash tools/board-pool.sh --check              boards/<b>/board.env and evidence.json against every pinned mica-kernel-<b>
#   bash tools/board-pool.sh --kernel <board>     the BSP outputs into _out/boards/<board>/
#   bash tools/board-pool.sh --kernels            the same for every pinned board
#   bash tools/board-pool.sh --source              the boards' source at the pinned commit into _out/src/mica-boards
#
#   reads   _out/debs/<arch>/pool/mica-kernel-<board>_*.deb   (fetched at the pin by build-env/deb/fetch.sh)
#           meta/verity/signer.cert.pem                        (the trust domain this assembly signs with)
#   writes  _out/boards/<board>/{kernel,firmware,component-copyright,uboot,board.env,evidence.json,trust}
#
# The boards live in one repository (ybolab/mica-boards) that builds each
# kernel and U-Boot and publishes them, with its board.env, evidence.json,
# the support image's firmware and the verity trust certificate the kernel
# embeds, as the archive mica-kernel-<board> under /usr/lib/mica/board/<board>/.
# This assembly imports that archive through deps/packages/ and never builds
# a kernel. Two things it still needs at host time:
#
# - boards/<board>/board.env and evidence.json are read by forty-odd
#   scripts and suites here, and the board discovery is "a directory under
#   boards/ with a board.env". Both stay committed as derived copies of what
#   the archive carries; --check, run by `make os-pool`, refuses a copy that
#   is not the archive's, so the pair cannot drift from the pin.
# - the kernel directory, firmware, copyright and U-Boot the kernel component
#   and the image take: --kernel <board> reads them out of the archive into
#   _out/boards/<board>/ (tools/deb-member.py), and refuses an archive whose
#   embedded trust certificate is not meta/verity/signer.cert.pem -- a kernel
#   that trusts another domain would boot a root this assembly did not sign.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
POOL="${MICA_POOL_DIR:-${REPO_ROOT}/_out/debs}"
MEMBER="${HERE}/deb-member.py"
TRUST_CERT="${MICA_VERITY_TRUST_CERT:-${REPO_ROOT}/meta/verity/signer.cert.pem}"

board_arch() {
    sed -n 's/^MICA_ARCH=\(.*\)$/\1/p' "${REPO_ROOT}/boards/$1/board.env" | head -1
}
archive_for() {
    local board="$1" arch found=()
    arch="$(board_arch "${board}")"
    [ -n "${arch}" ] || { echo "error: boards/${board}/board.env declares no MICA_ARCH, so the archive's pool cannot be named" >&2; exit 1; }
    for f in "${POOL}/${arch}/pool/"mica-kernel-"${board}"_*_"${arch}".deb; do
        [ -e "${f}" ] && found+=("${f}")
    done
    [ "${#found[@]}" -eq 1 ] || {
        echo "error: expected exactly one mica-kernel-${board} archive in ${POOL}/${arch}/pool, found ${#found[@]}. deps/packages/mica-kernel-${board}.json pins it; fetch it with \`make os-pool\`" >&2
        exit 1
    }
    printf '%s\n' "${found[0]}"
}
pinned_boards() {
    for f in "${REPO_ROOT}"/deps/packages/mica-kernel-*.json; do
        [ -e "${f}" ] || continue
        b="${f##*/mica-kernel-}"; printf '%s\n' "${b%.json}"
    done
}

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
case "${1:-}" in
--check)
    n=0
    while IFS= read -r board; do
        [ -n "${board}" ] || continue
        archive="$(archive_for "${board}")"
        for f in board.env evidence.json; do
            # board.env is what makes a board; evidence.json is a record some
            # boards carry, compared when either side has it.
            if [ "${f}" = evidence.json ] && ! python3 "${MEMBER}" "${archive}" "usr/lib/mica/board/${board}/${f}" "${work}/${f}" 2>/dev/null; then
                [ ! -f "${REPO_ROOT}/boards/${board}/${f}" ] || { echo "error: boards/${board}/${f} exists here but the pinned mica-kernel-${board} archive carries none; a copy of nothing is stale by definition" >&2; exit 1; }
                continue
            fi
            [ "${f}" = evidence.json ] || python3 "${MEMBER}" "${archive}" "usr/lib/mica/board/${board}/${f}" "${work}/${f}"
            cmp -s "${work}/${f}" "${REPO_ROOT}/boards/${board}/${f}" || {
                echo "error: boards/${board}/${f} is not the ${f} the pinned mica-kernel-${board} archive carries (see the diff below). The copy is derived from the pin; after a lock bump copy the archive's file over it and commit both" >&2
                diff -u "${REPO_ROOT}/boards/${board}/${f}" "${work}/${f}" >&2 || true
                exit 1
            }
        done
        n=$((n + 1))
    done < <(pinned_boards)
    [ "${n}" -gt 0 ] || { echo "error: deps/packages pins no mica-kernel-<board> archive, so nothing was compared" >&2; exit 1; }
    echo "board-pool.sh: boards/<board>/board.env and evidence.json match the pinned archives of ${n} board(s)"
    ;;
--kernel)
    board="${2:-}"
    [ -n "${board}" ] && [ -f "${REPO_ROOT}/boards/${board}/board.env" ] || { echo "usage: bash tools/board-pool.sh --kernel <board>" >&2; exit 1; }
    archive="$(archive_for "${board}")"
    [ -f "${TRUST_CERT}" ] || { echo "error: ${TRUST_CERT} does not exist; the kernel's embedded trust certificate is compared against it (MICA_VERITY_TRUST_CERT overrides the path)" >&2; exit 1; }
    python3 "${MEMBER}" "${archive}" "usr/lib/mica/board/${board}/trust/verity-signer.cert.pem" "${work}/cert.pem"
    cmp -s "${work}/cert.pem" "${TRUST_CERT}" || {
        echo "error: the pinned mica-kernel-${board} archive was built against a verity trust certificate that is not ${TRUST_CERT#"${REPO_ROOT}"/}. A kernel that trusts another domain would boot a root this assembly did not sign; build and release the board's kernel against this assembly's certificate" >&2
        exit 1
    }
    dest="${REPO_ROOT}/_out/boards/${board}"
    rm -rf "${dest}"; mkdir -p "${dest}"
    # Every payload member under the board's directory, into the same layout.
    python3 - "${archive}" "usr/lib/mica/board/${board}/" "${dest}" <<'PY'
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
        print(f'board-pool.sh: {n} file(s) of {os.path.basename(archive)} into {dest}')
    found = True
    break
if not found:
    raise SystemExit(f'error: {archive} carries no data.tar member')
PY
    for f in kernel/config kernel/kernel.release kernel/modules.tar board.env; do
        [ -e "${dest}/${f}" ] || { echo "error: ${dest}/${f} is missing after extraction; the archive does not carry the kernel directory this assembly expects" >&2; exit 1; }
    done
    ;;
--kernels)
    n=0
    while IFS= read -r board; do
        [ -n "${board}" ] || continue
        bash "$0" --kernel "${board}"; n=$((n + 1))
    done < <(pinned_boards)
    [ "${n}" -gt 0 ] || { echo "error: deps/packages pins no mica-kernel-<board> archive, so nothing was extracted" >&2; exit 1; }
    ;;
--source)
    bash "${REPO_ROOT}/build-env/deb/source.sh" mica-boards
    for board in cx3576 s905x5m; do
        [ -d "${REPO_ROOT}/_out/src/mica-boards/${board}/bsp" ] || { echo "error: _out/src/mica-boards/${board}/bsp does not exist at the pinned commit; the labs and the FIT tests read the board's sources out of it" >&2; exit 1; }
    done
    ;;
*)
    echo "usage: bash tools/board-pool.sh --check | --kernel <board> | --kernels | --source" >&2
    exit 1
    ;;
esac
