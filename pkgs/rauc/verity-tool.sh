#!/usr/bin/env bash
# Stage explicit public trust inputs or sign a root hash with pinned tooling.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
die() { echo "verity-tool: $*" >&2; exit 1; }
command -v docker >/dev/null || die 'docker is required'
command -v realpath >/dev/null || die 'realpath is required'
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) die 'unsupported build architecture' ;; esac
image="$(bash "${ROOT}/build-env/from.sh" --arch="${arch}" --ref LOCAL_MOS_BUILD_OPENSSL)"

# Docker bind sources are host paths, including when this checkout is in station.
host_path() {
    case "$1" in /work/*) printf '/srv/station/work/%s\n' "${1#/work/}" ;; /root/*) printf '/srv/station/root/%s\n' "${1#/root/}" ;; *) printf '%s\n' "$1" ;; esac
}
input() { [ -f "$1" ] && [ -s "$1" ] || die "explicit input is missing: $1"; realpath "$1"; }

mode="${1:-}"
case "${mode}" in
    stage)
        [ "$#" -eq 3 ] || die 'usage: verity-tool.sh stage CERTIFICATE_BUNDLE CONTEXT_PARENT'
        cert="$(input "$2")"
        mkdir -p "$3"
        parent="$(realpath "$3")"
        ;;
    sign)
        [ "$#" -eq 5 ] || die 'usage: verity-tool.sh sign ROOTHASH PRIVATE_KEY CERTIFICATE OUTPUT'
        hash="$(input "$2")"; key="$(input "$3")"; cert="$(input "$4")"
        [ ! -e "$5" ] && [ ! -L "$5" ] || die 'signature output already exists'
        mkdir -p "$(dirname "$5")"
        output="$(realpath -m "$5")"
        parent="$(dirname "${output}")"
        ;;
    *) die 'expected stage or sign' ;;
esac
temporary="$(mktemp -d "${parent}/.verity.XXXXXX")"
cleanup() {
    rm -f "${temporary}/signer.cert.pem" "${temporary}/sha256" "${temporary}/signature"
    rmdir "${temporary}" 2>/dev/null || true
}
trap cleanup EXIT
args=(--rm --label ai-agent=true --network traefik --name "ai-agent-verity-tool-$$"
    --user "$(id -u):$(id -g)"
    -v "$(host_path "${HERE}/verity-tool-inner.sh"):/tool.sh:ro"
    -v "$(host_path "${cert}"):/certificate.pem:ro"
    -v "$(host_path "${temporary}"):/output")
if [ "${mode}" = sign ]; then
    args+=(-v "$(host_path "${hash}"):/roothash:ro" -v "$(host_path "${key}"):/private.pem:ro")
fi
docker run "${args[@]}" --entrypoint /bin/bash "${image}" /tool.sh "${mode}"
if [ "${mode}" = stage ]; then
    digest="$(cat "${temporary}/sha256")"
    [[ "${digest}" =~ ^[0-9a-f]{64}$ ]] || die 'invalid staged certificate digest'
    destination="${parent}/${digest}"
    if ! mv -T "${temporary}" "${destination}" 2>/dev/null; then
        [ -d "${destination}" ] && [ ! -L "${destination}" ] || die 'invalid existing trust context'
        cmp -s "${temporary}/signer.cert.pem" "${destination}/signer.cert.pem" || die 'existing trust context differs'
        cmp -s "${temporary}/sha256" "${destination}/sha256" || die 'existing trust digest differs'
        [ "$(find "${destination}" -mindepth 1 -maxdepth 1 | wc -l)" -eq 2 ] || die 'unexpected material in trust context'
    fi
    printf '%s\n' "${destination}"
else
    ln "${temporary}/signature" "${output}"
fi
