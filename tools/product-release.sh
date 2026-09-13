#!/usr/bin/env bash
# Publish a built product's composed root as its OCI image.
#
#   bash tools/product-release.sh <product>       (make product-release PRODUCT=<product>)
#
#   reads   _out/products/<product>/build/factory-root.oci   (the OCI archive rootfs/build.sh exported)
#           _out/products/<product>/build/factory-root.txt   (its record: ref, digest, platform)
#   writes  <registry>/mica-root/<product>:build-<commit12>  -- the image, blob for blob and
#           manifest for manifest as the archive holds them, so the digest the
#           record names is the digest the registry serves.
#
# The image is what the smoke runner executed and the factory-root gate
# compared against the squashfs the device ships; publishing it is publishing
# that exact tree. The tree must be clean: an image of a dirty tree is one no
# commit reproduces.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
# shellcheck disable=SC1091
. "${REPO_ROOT}/build-env/deb/registry.sh"
NAME="${1:?product name required}"
eval "$(bash "${HERE}/product.sh" "${NAME}")"
BUILD="${REPO_ROOT}/_out/products/${NAME}/build"
[ -f "${BUILD}/factory-root.oci" ] && [ -f "${BUILD}/factory-root.txt" ] || { echo "error: ${BUILD} holds no factory-root.oci and its record; build the product first (make product PRODUCT=${NAME})" >&2; exit 1; }
[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ] || { echo "error: ${REPO_ROOT} has uncommitted changes; a root is published as the output of one commit" >&2; exit 1; }
HEAD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
TAG="$(release_tag "${HEAD_COMMIT}")"
registry_load; registry_repo_name; registry_token --write
WORK="$(mktemp -d "${REPO_ROOT}/_out/.product-release.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
tar -C "${WORK}" -xf "${BUILD}/factory-root.oci"
[ -f "${WORK}/index.json" ] || { echo "error: factory-root.oci carries no index.json; it is not an OCI layout" >&2; exit 1; }
# The one manifest the index names (an image index in between is followed).
manifest_digest="$(jq -r '.manifests[0].digest' "${WORK}/index.json")"
manifest_type="$(jq -r '.manifests[0].mediaType' "${WORK}/index.json")"
blob() { printf '%s/blobs/%s/%s' "${WORK}" "${1%%:*}" "${1#*:}"; }
if [ "${manifest_type}" = application/vnd.oci.image.index.v1+json ]; then
    manifest_digest="$(jq -r '.manifests[0].digest' "$(blob "${manifest_digest}")")"
    manifest_type=application/vnd.oci.image.manifest.v1+json
fi
manifest="$(blob "${manifest_digest}")"
[ -f "${manifest}" ] || { echo "error: the layout holds no blob for its manifest ${manifest_digest}" >&2; exit 1; }
recorded="$(sed -n 's/^digest\t//p' "${BUILD}/factory-root.txt" | head -n1)"
[ -z "${recorded}" ] || [ "${recorded}" = "${manifest_digest}" ] || echo "note: factory-root.txt records ${recorded}; the layout's manifest is ${manifest_digest}"
artifact="$(oci_repo root "${NAME}")"
n=0
while IFS= read -r d; do
    [ -n "${d}" ] || continue
    [ -f "$(blob "${d}")" ] || { echo "error: the layout holds no blob ${d}" >&2; exit 1; }
    oci_blob_put "${artifact}" "$(blob "${d}")" "${d}" || exit 1
    n=$((n + 1))
done < <(jq -r '[.config.digest] + [.layers[].digest] | .[]' "${manifest}")
status="$(oci_request PUT "${artifact}" pull,push "manifests/${TAG}" "${WORK}/put.out" -H "Content-Type: ${manifest_type}" --data-binary "@${manifest}")"
[ "${status}" = 201 ] || { echo "error: putting the manifest ${TAG} to ${OCI_HOST}/${artifact} answered HTTP ${status}: $(head -c 200 "${WORK}/put.out")" >&2; exit 1; }
status="$(oci_manifest_get "${artifact}" "${TAG}" "${WORK}/back.json")"
[ "${status}" = 200 ] && [ "$(oci_manifest_digest "${WORK}/back.json")" = "${manifest_digest}" ] || { echo "error: ${OCI_HOST}/${artifact}:${TAG} reads back as $(oci_manifest_digest "${WORK}/back.json" 2>/dev/null || echo '?'), not ${manifest_digest}" >&2; exit 1; }
echo "product-release.sh: ${NAME}: ${n} blob(s), ${OCI_HOST}/${artifact}:${TAG} = ${manifest_digest}"
