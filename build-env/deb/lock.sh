#!/usr/bin/env bash
# The lock's only writer, and its reader for every other script.
#
#   bash build-env/deb/lock.sh --rows [--arch <amd64|arm64>]
#       print the validated rows (all, or the ones that pool holds)
#   bash build-env/deb/lock.sh --bump <component> [--version <v>] [--package <p> ...]
#       rewrite <component>'s rows from the registry's index and print the diff
#
# --bump reads the registry's Packages index for the component (the
# distribution's binary-amd64, binary-arm64 and binary-all lists), takes
# for each package the newest version -- or exactly --version -- and writes a
# row per (package, architecture) with the SHA256, Mos-Source-Repo and
# Mos-Source-Commit the index reports. Every row of that component is
# replaced; rows of other components are untouched; the file is sorted. The
# diff it prints is the reviewable import: nothing else in the assembly
# changes when a package repository releases.
#
# The index is the registry's statement about the archives it holds. fetch.sh
# verifies the archive itself against the row -- bytes and control fields --
# so an index that lied about an archive is caught at fetch, naming the
# package.
#
# mos-build-side: host
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
# shellcheck disable=SC1091
. "${HERE}/registry.sh"

MODE=""
ARCH=""
COMPONENT=""
VERSION=""
PACKAGES=()
while [ "$#" -gt 0 ]; do
    case "$1" in
    --rows) MODE=rows; shift ;;
    --arch) ARCH="${2-}"; [ -n "${ARCH}" ] || { echo "error: --arch takes amd64 or arm64" >&2; exit 1; }; shift 2 ;;
    --bump) MODE=bump; COMPONENT="${2-}"; [ -n "${COMPONENT}" ] || { echo "error: --bump takes a component (source repository) name" >&2; exit 1; }; shift 2 ;;
    --version) VERSION="${2-}"; [ -n "${VERSION}" ] || { echo "error: --version takes a Debian version" >&2; exit 1; }; shift 2 ;;
    --package) [ -n "${2-}" ] || { echo "error: --package takes a package name" >&2; exit 1; }; PACKAGES+=("$2"); shift 2 ;;
    *) echo "usage: bash build-env/deb/lock.sh --rows [--arch <a>] | --bump <component> [--version <v>] [--package <p> ...]" >&2; exit 1 ;;
    esac
done
[ -n "${MODE}" ] || { echo "usage: bash build-env/deb/lock.sh --rows [--arch <a>] | --bump <component> [--version <v>] [--package <p> ...]" >&2; exit 1; }

registry_load
if [ "${MODE}" = rows ]; then
    case "${ARCH}" in '' | amd64 | arm64) ;; *) echo "error: --arch must be amd64 or arm64" >&2; exit 1 ;; esac
    lock_rows "${ARCH}"
    exit 0
fi

[[ "${COMPONENT}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "error: '${COMPONENT}' is not a component name" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "error: curl is required and not on PATH" >&2; exit 1; }
lock_rows >/dev/null   # the current file must already be well formed
registry_token

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
for a in amd64 arm64 all; do
    url="${MOS_REGISTRY_URL}/dists/${MOS_REGISTRY_DIST}/${COMPONENT}/binary-${a}/Packages"
    status="$(registry_curl GET "${url}" "${WORK}/Packages.${a}")"
    case "${status}" in
    200) ;;
    404) : >"${WORK}/Packages.${a}" ;;   # no archive of that architecture under this component
    401 | 403) echo "error: ${url} answered ${status}; ${MOS_REGISTRY_TOKEN_VAR} does not grant read access to the registry" >&2; exit 1 ;;
    000) echo "error: ${url} could not be reached (transport failure)" >&2; exit 1 ;;
    *) echo "error: ${url} answered HTTP ${status}" >&2; exit 1 ;;
    esac
done

python3 - "${LOCK_FILE}" "${COMPONENT}" "${VERSION}" "${WORK}" "${PACKAGES[@]+"${PACKAGES[@]}"}" <<'PY'
import re, sys, pathlib
lock_path, component, want_version, work, *only = sys.argv[1:]
lock = pathlib.Path(lock_path)

def deb_order(v):
    """Debian version ordering (epoch:upstream-revision) as a sortable key."""
    epoch, rest = (v.split(':', 1) + [''])[:2] if ':' in v else ('0', v)
    if '-' in rest: upstream, revision = rest.rsplit('-', 1)
    else: upstream, revision = rest, ''
    def parts(s):
        out = []
        for m in re.finditer(r'([^0-9]*)([0-9]*)', s):
            alpha, digits = m.groups()
            if not alpha and not digits: continue
            out.append((tuple((0 if c == '~' else 2 if c.isalpha() else 3, c) for c in alpha), int(digits) if digits else -1))
        return out
    return (int(epoch), parts(upstream), parts(revision))

def stanzas(text):
    for paragraph in text.strip().split('\n\n'):
        if not paragraph.strip(): continue
        fields = {}
        for line in paragraph.splitlines():
            if line.startswith((' ', '\t')): continue
            k, _, v = line.partition(': ')
            fields[k] = v
        yield fields

found = {}
for arch in ('amd64', 'arm64', 'all'):
    for f in stanzas(pathlib.Path(work, 'Packages.' + arch).read_text()):
        for k in ('Package', 'Version', 'Architecture', 'SHA256', 'Mos-Source-Repo', 'Mos-Source-Commit'):
            if k not in f: sys.exit(f"error: the registry index for {component}/binary-{arch} has a stanza without {k}: {f.get('Package', '?')}")
        if f['Architecture'] != arch: sys.exit(f"error: {f['Package']} in binary-{arch} declares Architecture: {f['Architecture']}")
        if f['Mos-Source-Repo'] != component: sys.exit(f"error: {f['Package']} {f['Version']} under component {component} says Mos-Source-Repo: {f['Mos-Source-Repo']}")
        if only and f['Package'] not in only: continue
        if want_version and f['Version'] != want_version: continue
        found.setdefault(f['Package'], {}).setdefault(f['Version'], {})[arch] = f
if not found:
    sys.exit(f"error: the registry holds no archive for component {component}" + (f" at version {want_version}" if want_version else '') + (f" among {' '.join(only)}" if only else '') + "; nothing to lock")
for p in only:
    if p not in found: sys.exit(f"error: the registry holds no archive named {p} under component {component}")

rows = []
for pkg, versions in sorted(found.items()):
    version = max(versions, key=deb_order)
    if '.dirty-' in version: sys.exit(f"error: the newest {pkg} under {component} is {version}, a dirty archive the registry should never hold")
    for arch, f in sorted(versions[version].items()):
        if not re.fullmatch('[0-9a-f]{64}', f['SHA256']) or not re.fullmatch('[0-9a-f]{40}', f['Mos-Source-Commit']):
            sys.exit(f"error: {pkg} {version} {arch}: malformed SHA256 or Mos-Source-Commit in the registry index")
        rows.append((pkg, version, arch, f['SHA256'], component, f['Mos-Source-Commit']))

text = lock.read_text()
header = [l for l in text.splitlines() if l.startswith('#') or not l.strip()]
kept = [l for l in text.splitlines() if l and not l.startswith('#') and l.split('\t')[4] != component]
if only:
    # A partial bump keeps the component's rows for the packages not named.
    kept += [l for l in text.splitlines() if l and not l.startswith('#') and l.split('\t')[4] == component and l.split('\t')[0] not in only]
body = sorted(set(kept + ['\t'.join(r) for r in rows]))
new = '\n'.join(header + body) + '\n'
pathlib.Path(work, 'lock.new').write_text(new)
pathlib.Path(work, 'lock.old').write_text(text)
PY

if diff -u --label "a/${LOCK_FILE#"${REPO_ROOT}"/}" --label "b/${LOCK_FILE#"${REPO_ROOT}"/}" "${WORK}/lock.old" "${WORK}/lock.new"; then
    echo "lock.sh: ${LOCK_FILE#"${REPO_ROOT}"/} already locks what the registry holds for ${COMPONENT}; no change"
    exit 0
fi
cp "${WORK}/lock.new" "${LOCK_FILE}"
lock_rows >/dev/null
echo "lock.sh: ${LOCK_FILE#"${REPO_ROOT}"/} rewritten for ${COMPONENT}; review the diff above, then \`make os-pool\`"
