#!/usr/bin/env bash
# Shared by fetch.sh, lock.sh, publish.sh and source.sh: the registry
# declaration, the token, the lock file and the origin-derived repository
# name. Sourced, not executed; every function refuses by name.
#
# mos-build-side: host
[ -n "${BASH_VERSION:-}" ] || { echo "registry.sh: bash only" >&2; exit 1; }

REGISTRY_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY_REPO_ROOT="$(cd "${REGISTRY_HERE}/../.." && pwd)"
REGISTRY_ENV="${REGISTRY_HERE}/registry.env"
LOCK_FILE="${REGISTRY_REPO_ROOT}/rootfs/packages/lock.tsv"

# registry.env is KEY=value in the producer.env discipline, checked for that
# shape before it is sourced: a declaration that can execute is a build step
# nothing declared.
registry_load() {
    [ -f "${REGISTRY_ENV}" ] || { echo "error: ${REGISTRY_ENV} does not exist; it declares the package registry" >&2; return 1; }
    while IFS= read -r line; do
        case "${line}" in
        '' | '#'*) continue ;;
        *'$('* | *'`'*) echo "error: ${REGISTRY_ENV} carries a command substitution: ${line}" >&2; return 1 ;;
        esac
        [[ "${line}" =~ ^[A-Z][A-Z0-9_]*= ]] || { echo "error: ${REGISTRY_ENV} carries a line that is neither KEY=value nor a comment: ${line}" >&2; return 1; }
    done <"${REGISTRY_ENV}"
    MOS_REGISTRY_URL=""
    MOS_REGISTRY_DIST=""
    MOS_REGISTRY_TOKEN_VAR=""
    MOS_SOURCE_URL=""
    # shellcheck disable=SC1090
    . "${REGISTRY_ENV}"
    for v in MOS_REGISTRY_URL MOS_REGISTRY_DIST MOS_REGISTRY_TOKEN_VAR MOS_SOURCE_URL; do
        [ -n "${!v}" ] || { echo "error: ${REGISTRY_ENV} declares no ${v}" >&2; return 1; }
    done
    case "${MOS_REGISTRY_URL}" in
    https://*) ;;
    *) echo "error: MOS_REGISTRY_URL='${MOS_REGISTRY_URL}' is not an https:// URL; the token would be sent in clear" >&2; return 1 ;;
    esac
    MOS_REGISTRY_URL="${MOS_REGISTRY_URL%/}"
}

# The token, from the variable registry.env names. Printed nowhere; a refusal
# names the VARIABLE so the operator knows what to export.
registry_token() {
    REGISTRY_TOKEN="${!MOS_REGISTRY_TOKEN_VAR:-}"
    [ -n "${REGISTRY_TOKEN}" ] || {
        echo "error: ${MOS_REGISTRY_TOKEN_VAR} is unset or empty. The registry at ${MOS_REGISTRY_URL} is private; export the API token in that variable (build-env/deb/registry.env names it)" >&2
        return 1
    }
}

# curl with the token, writing the body to $2 and printing the HTTP status.
# Transport failures are printed as status 000 so every caller has one thing
# to decide on.
registry_curl() {
    local method="$1" url="$2" out="$3"; shift 3
    curl -sS --max-time 600 -o "${out}" -w '%{http_code}' \
        -H "Authorization: token ${REGISTRY_TOKEN}" -X "${method}" "$@" "${url}" 2>/dev/null || echo 000
}

# The repository this checkout is: MOS_SOURCE_REPO, else the basename of
# origin -- the same rule build.sh writes into Mos-Source-Repo.
registry_repo_name() {
    if [ -n "${MOS_SOURCE_REPO:-}" ]; then
        REPO_NAME="${MOS_SOURCE_REPO}"
    else
        local origin_url
        origin_url="$(git -C "${REGISTRY_REPO_ROOT}" remote get-url origin 2>/dev/null || true)"
        REPO_NAME="$(basename "${origin_url%/}" .git)"
        [ -n "${origin_url}" ] && [ -n "${REPO_NAME}" ] || {
            echo "error: ${REGISTRY_REPO_ROOT} has no 'origin' remote, so the repository name cannot be derived; set MOS_SOURCE_REPO=<name>" >&2
            return 1
        }
    fi
    [[ "${REPO_NAME}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "error: '${REPO_NAME}' is not a plain repository name" >&2; return 1; }
}

# Every lock row, validated, as TAB-separated fields on stdout:
#   package version arch sha256 source-repo source-commit
# With an architecture, only the rows that pool holds: that arch and `all`.
lock_rows() {
    local want="${1:-}"
    [ -f "${LOCK_FILE}" ] || { echo "error: ${LOCK_FILE} does not exist; it is the package lock and every reader needs it, even empty" >&2; return 1; }
    awk -F'\t' -v want="${want}" -v file="${LOCK_FILE}" '
        /^#/ || /^$/ { next }
        {
            if (NF != 6) { printf "error: %s line %d has %d fields, not 6 (package version arch sha256 source-repo source-commit)\n", file, NR, NF > "/dev/stderr"; bad = 1; exit 1 }
            if ($1 !~ /^[a-z0-9][a-z0-9+.-]+$/) { printf "error: %s line %d: %s is not a package name\n", file, NR, $1 > "/dev/stderr"; bad = 1; exit 1 }
            if ($2 !~ /^[0-9][A-Za-z0-9.~+-]*\+git[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[1-9][0-9]*$/) { printf "error: %s line %d: version %s carries no clean git stamp; a dirty or unstamped archive cannot be locked\n", file, NR, $2 > "/dev/stderr"; bad = 1; exit 1 }
            if ($3 != "amd64" && $3 != "arm64" && $3 != "all") { printf "error: %s line %d: arch %s is not amd64, arm64 or all\n", file, NR, $3 > "/dev/stderr"; bad = 1; exit 1 }
            if ($4 !~ /^[0-9a-f]{64}$/) { printf "error: %s line %d: sha256 is malformed\n", file, NR > "/dev/stderr"; bad = 1; exit 1 }
            if ($5 !~ /^[A-Za-z0-9][A-Za-z0-9._-]*$/) { printf "error: %s line %d: source-repo %s is not a repository name\n", file, NR, $5 > "/dev/stderr"; bad = 1; exit 1 }
            if ($6 !~ /^[0-9a-f]{40}$/) { printf "error: %s line %d: source-commit is not a 40-hex commit\n", file, NR > "/dev/stderr"; bad = 1; exit 1 }
            key = $1 "\t" $3
            if (key in seen) { printf "error: %s line %d: %s for %s is locked twice\n", file, NR, $1, $3 > "/dev/stderr"; bad = 1; exit 1 }
            seen[key] = 1
            if (want == "" || $3 == want || $3 == "all") print
        }
        END { if (bad) exit 1 }
    ' "${LOCK_FILE}"
}
