#!/usr/bin/env bash
# One product, one closure: from the product's recipe to its signed image,
# under _out/products/<name>/, reusing the result when nothing it was built
# from has changed.
#
#   bash tools/product-build.sh <name>            build (or reuse) the product
#   bash tools/product-build.sh <name> --verify   verify its image against the contract
#
#   reads   products/<name>/ (tools/product.sh), deps/packages/, _out/boards/<board>/ (make board-fetch),
#           _out/debs/<arch>/ (build-env/deb/fetch.sh), the signing workspace (MICA_SIGNING_OUTPUT, default meta/)
#   writes  _out/products/<name>/{receipt.txt,lifecycle/,root/,kernel/,firmware/,deployments/,records.json,image/,update.mosupd}
#
# THE STEPS, in the order the components depend on one another:
#   fetch     the product's closure out of the pool of the board's architecture, and the board bundle
#   compose   the root (rootfs/build.sh, MICA_PRODUCT), into _out/<board>/
#   root      the signed root component out of that composition
#   kernel    the signed kernel/support component out of the bundle and the pinned lifecycle binaries
#   firmware  the signed firmware package: built and signed (efi) or the bundle's loader (a FIT board)
#   deploy    two signed factory deployment records, generations 1 and 2
#   image     every IMAGE_KIND the product names (disk; rockchip-update is 20260912-2251 and refused)
#   archive   the signed update archive of generation 2
#
# THE RECEIPT is the sha256 of everything the build read: the product
# directory, every pin, the board's board.env and kernel release, the
# public certificates of the three signing domains and the tree's commit.
# A product whose receipt matches the one on disk and whose image exists is
# not rebuilt; a changed input rebuilds it whole (the components bind one
# another by identity, so a partial rebuild would be a different product
# with an old name).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
cd "${REPO_ROOT}"
NAME="${1:-}"
MODE="${2:-build}"
[ -n "${NAME}" ] || { echo "usage: bash tools/product-build.sh <name> [--verify]" >&2; exit 1; }
SIGNING="${MICA_SIGNING_OUTPUT:-${REPO_ROOT}/meta}"
OUT="${REPO_ROOT}/_out/products/${NAME}"

# The product, validated against its fetched board; the board is fetched
# first so a fresh clone gets a refusal that names the fetch, not a path.
BOARD_NAME="$(sed -n 's/^BOARD=//p' "products/${NAME}/product.env" | head -1 | tr -d '"')"
[ -n "${BOARD_NAME}" ] || { echo "error: products/${NAME}/product.env declares no BOARD (or the product does not exist; the products are: $(bash tools/product.sh --list | tr '\n' ' '))" >&2; exit 1; }
[ -f "_out/boards/${BOARD_NAME}/board.env" ] || bash tools/board-pool.sh --fetch "${BOARD_NAME}"
eval "$(bash tools/product.sh "${NAME}")"
env_value() { sed -n "s/^$2=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" "$1" | head -1; }
BOOT_BACKEND="$(env_value "${BOARD_DIR}/board.env" BOOT_BACKEND)"
UBOOT_BIN_NAME="$(env_value "${BOARD_DIR}/board.env" UBOOT_BIN_NAME)"

# The signing inputs: public certificates enter the build, private keys sign.
for f in verity/signer.key.pem verity/signer.cert.pem boot/signer.key.pem boot/signer.cert.pem updates/signer.key.pem updates/public.key; do
    [ -f "${SIGNING}/${f}" ] || { echo "error: ${SIGNING}/${f} does not exist; the signing workspace is incomplete (development inputs: make os-devkeys)" >&2; exit 1; }
done
PUBLIC_KEY="$(tr -d '\n' <"${SIGNING}/updates/public.key")"

if [ "${MODE}" = --verify ]; then
    # The image is the one SHA256SUMS names; the directory also holds the
    # partition images the assembler built it from.
    image="${OUT}/image/$(awk 'NR == 1 { print $2 }' "${OUT}/image/SHA256SUMS" 2>/dev/null || true)"
    [ -n "${image##*/}" ] && [ -f "${image}" ] || { echo "error: ${OUT}/image holds no image; build the product first (make product PRODUCT=${NAME})" >&2; exit 1; }
    exec bash verify/run.sh --verify --board "${BOARD}" --image "${image}" --public-key "${SIGNING}/updates/public.key"
fi
[ "${MODE}" = build ] || { echo "usage: bash tools/product-build.sh <name> [--verify]" >&2; exit 1; }

for kind in ${IMAGE_KINDS}; do
    case "${kind}" in
    disk) ;;
    rockchip-update) echo "error: product ${NAME} names the image kind '${kind}', which is not produced yet (mica:docs/task/20260912-2251-rockchip-update-image)" >&2; exit 1 ;;
    *) echo "error: product ${NAME} names the image kind '${kind}', which the assembly does not produce" >&2; exit 1 ;;
    esac
done

# The receipt: what this build reads.
receipt() {
    {
        find "products/${NAME}" -type f | sort | xargs sha256sum
        sha256sum deps/packages/*.json deps/sources/*.json
        sha256sum "${BOARD_DIR}/board.env" "${BOARD_DIR}/kernel/kernel.release" "${BOARD_DIR}/kernel/config"
        sha256sum "${SIGNING}/verity/signer.cert.pem" "${SIGNING}/boot/signer.cert.pem" "${SIGNING}/updates/public.key"
        printf 'tree %s%s\n' "$(git rev-parse HEAD)" "$([ -z "$(git status --porcelain)" ] || printf ' dirty')"
    } | sed "s|${REPO_ROOT}/||"
}
WANT="$(receipt)"
if [ -f "${OUT}/receipt.txt" ] && [ "$(cat "${OUT}/receipt.txt")" = "${WANT}" ] && [ -f "${OUT}/image/SHA256SUMS" ]; then
    echo "product: ${NAME} is up to date -- every input in ${OUT}/receipt.txt is unchanged and the image exists; nothing to do"
    awk -v d="${OUT}/image/" '{ print d $2 }' "${OUT}/image/SHA256SUMS"
    exit 0
fi
case "${WANT}" in *' dirty'*) echo "note: the tree is dirty; this build is recorded as such and is not a release candidate" ;; esac

# THE CLOSURE, resolved before anything is fetched: the resolver reads the
# pins and the bundle's manifests, not the pool, so the pool can be fetched
# for exactly what this product installs, plus the two archives the
# components read -- the board bundle and the lifecycle binaries.
echo "=== product ${NAME}: fetch (board ${BOARD}, ${MICA_ARCH}) ==="
CLOSURE="$(bash rootfs/packages/resolve.sh --board "${BOARD}" --board-dir "${BOARD_DIR}/manifests" --profile "${PROFILE}" --features "${FEATURES}" --components "${COMPONENTS}" | tr '\n' ' ')"
bash build-env/deb/fetch.sh --arch "${MICA_ARCH}" --packages "${CLOSURE} mica-kernel-${BOARD} mica-lifecycle"
bash build-env/deb/repo.sh --arch "${MICA_ARCH}"
bash tools/board-pool.sh --fetch "${BOARD}"

echo "=== product ${NAME}: compose ==="
MICA_PRODUCT="${NAME}" bash rootfs/build.sh

rm -rf "${OUT}"
mkdir -p "${OUT}/deployments"
VERSION="$(bash build-env/deb/version.sh)"
echo "=== product ${NAME}: components at version ${VERSION} ==="
bash tools/deploy-pool.sh --lifecycle "${MICA_ARCH}" "${OUT}/lifecycle"
bash build/run.sh --components root --input "_out/${BOARD}" --arch "${MICA_ARCH}" --version "${VERSION}" --out "${OUT}/root" \
    --content-key "${SIGNING}/verity/signer.key.pem" --content-cert "${SIGNING}/verity/signer.cert.pem"
# THE PACKAGER, built from the pinned boot/ tree before the kernel component
# runs in it: a UEFI board's boot-tools image for its EFI architecture, a FIT
# board's fit-tools image over the board's own mkimage (uboot/tools in the
# bundle). docker's cache makes an unchanged image free; what this refuses to
# inherit is a local tag left behind by an older boot/ tree, which packaged
# with the wrong tool names until the next hand-run make os-boot-tools.
# build-tools.sh names its target as UEFI names the architecture (X64, AA64),
# in lower case.
efi_target() { case "$1" in amd64) echo X64 ;; arm64) echo AA64 ;; *) echo "error: no EFI architecture for $1" >&2; exit 1 ;; esac | tr '[:upper:]' '[:lower:]'; }
if [ "${BOOT_BACKEND}" = uboot-fit ]; then
    bash boot/build-tools.sh --target "$(efi_target amd64)"
    # The bundle's files are all 0644 (a board archive ships data, not
    # executables); the packager runs these four, so they are staged executable.
    rm -rf "${OUT}/fit-tools"; mkdir -p "${OUT}/fit-tools"
    for t in mkimage fit_check_sign fdt_add_pubkey dumpimage; do install -m 0755 "${BOARD_DIR}/uboot/tools/${t}" "${OUT}/fit-tools/${t}"; done
    docker build --label ai-agent=true -t ai-agent/mos-fit-tools-amd64 --build-arg MICA_BOOT_TOOLS=ai-agent/mos-boot-tools-amd64 \
        --build-context "fit-tools=${OUT}/fit-tools" -f boot/Dockerfile.fit boot
else
    bash boot/build-tools.sh --target "$(efi_target "${MICA_ARCH}")"
fi
bash build/run.sh --components kernel --board "${BOARD}" --input "${BOARD_DIR}/kernel" \
    --init "${OUT}/lifecycle/mica-init" --shutdown "${OUT}/lifecycle/mica-shutdown" --public-key "${PUBLIC_KEY}" --out "${OUT}/kernel" \
    --content-key "${SIGNING}/verity/signer.key.pem" --content-cert "${SIGNING}/verity/signer.cert.pem" \
    --boot-key "${SIGNING}/boot/signer.key.pem" --boot-cert "${SIGNING}/boot/signer.cert.pem"
if [ "${BOOT_BACKEND}" = uboot-fit ]; then
    [ -n "${UBOOT_BIN_NAME}" ] && [ -f "${BOARD_DIR}/uboot/${UBOOT_BIN_NAME}" ] || { echo "error: the ${BOARD} bundle carries no uboot/${UBOOT_BIN_NAME:-?}; a FIT board's firmware is its loader" >&2; exit 1; }
    bash build/run.sh --components firmware --board "${BOARD}" --out "${OUT}/firmware" --metadata-key "${SIGNING}/updates/signer.key.pem" \
        --generation 1 --version "${VERSION}" --input "${BOARD_DIR}/uboot/${UBOOT_BIN_NAME}"
else
    bash build/run.sh --components firmware --board "${BOARD}" --out "${OUT}/firmware" --metadata-key "${SIGNING}/updates/signer.key.pem" \
        --generation 1 --version "${VERSION}" --boot-key "${SIGNING}/boot/signer.key.pem" --boot-cert "${SIGNING}/boot/signer.cert.pem"
fi
for generation in 1 2; do
    bash build/run.sh --components deployment --kernel "${OUT}/kernel" --root "${OUT}/root" --generation "${generation}" --version "${VERSION}" \
        --metadata-key "${SIGNING}/updates/signer.key.pem" --out "${OUT}/deployments/${generation}.json"
done
python3 - "${OUT}" <<'PY'
import json, sys
out = sys.argv[1]
records = [{'envelope': open(f'{out}/deployments/{g}.json').read(), 'kernelDirectory': f'{out}/kernel', 'rootDirectory': f'{out}/root'} for g in (1, 2)]
json.dump(records, open(f'{out}/records.json', 'w'))
PY
echo "=== product ${NAME}: image ==="
bash build/run.sh --components image --board "${BOARD}" --records "${OUT}/records.json" --public-key "${PUBLIC_KEY}" \
    --firmware "${OUT}/firmware" --out "${OUT}/image" ${PROVISIONING:+--provisioning "${PROVISIONING}"}
bash build/run.sh --components archive --input "${OUT}/deployments/2.json" --kernel "${OUT}/kernel" --root "${OUT}/root" \
    --public-key "${PUBLIC_KEY}" --out "${OUT}/update.mosupd"
printf '%s\n' "${WANT}" >"${OUT}/receipt.txt"
echo "=== product ${NAME}: done ==="
awk -v d="${OUT}/image/" '{ print d $2 }' "${OUT}/image/SHA256SUMS"; ls -1 "${OUT}/update.mosupd"
