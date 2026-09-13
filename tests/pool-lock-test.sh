#!/usr/bin/env bash
# fetch.sh and lock.sh against a stub release API: every refusal by name, every
# acceptance leaving exactly the locked archive in the pool.
#
#   bash tests/pool-lock-test.sh
#
# The stub is a local HTTP server shaped like the GitHub release API for one
# organisation: releases per repository, assets with their digests, bytes
# served for `Accept: application/octet-stream`, 401 without the token. The
# archives are written in Python, no dpkg on the host. registry.sh's
# MICA_REGISTRY_ENV and MICA_LOCK_DIR point the scripts at the stub and at a
# scratch pin directory, MICA_POOL_DIR at a scratch pool. No docker, no network, no gh.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
for t in python3 curl sha256sum; do
    command -v "${t}" >/dev/null 2>&1 || { echo "error: ${t} is required" >&2; exit 1; }
done
WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() { [ -z "${SERVER_PID}" ] || kill "${SERVER_PID}" 2>/dev/null || true; rm -rf "${WORK}"; }
trap cleanup EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }
says() { grep -c -- "$2" "$1" >/dev/null; }

# ------------------------------------------------------------ the stub
#
# A GitHub-shaped release API for one organisation (asset names carry `.`
# where the archive name carries `+`, as GitHub rewrites them): GET
# /repos/<owner>/<repo>/releases (newest first), /releases/tags/<tag>, and
# each asset's `url` serving its bytes for `Accept: application/octet-stream`
# (200 directly; the real API redirects, which registry_download follows).
# Every request needs `Authorization: Bearer fixture-token`; anything else is
# 401, and the token itself never appears in a refusal.
REG="${WORK}/registry"
mkdir -p "${REG}/assets"
COMMIT="$(printf 'b%.0s' $(seq 1 40))"
TAG="build-${COMMIT:0:12}"
OTHER_COMMIT="$(printf 'c%.0s' $(seq 1 40))"
OTHER_TAG="build-${OTHER_COMMIT:0:12}"
FIELDS="python3 ${REPO_ROOT}/build-env/deb/control-fields.py"
# Fixture archives are written in Python -- an `ar` of debian-binary,
# control.tar.gz and data.tar.gz -- because the host carries no dpkg
# (docs/design/build.md section 0) and this test runs no container.
build_deb() { # name version arch repo commit -> path (asset name: + mapped to . as GitHub does)
    local asset="$1_$2_$3.deb"; asset="${asset//+/.}"
    python3 - "${REG}/assets/${asset}" "$1" "$2" "$3" "$4" "$5" <<'DEB'
import io, sys, tarfile
path, name, version, arch, repo, commit = sys.argv[1:]
control = f'Package: {name}\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Fixture <fixture@example.invalid>\nDescription: fixture\nMica-Source-Repo: {repo}\nMica-Source-Commit: {commit}\n'.encode()
def tar_of(entries):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        for member, data in entries:
            info = tarfile.TarInfo('./' + member); info.size = len(data); info.mtime = 0; info.mode = 0o644
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()
members = [('debian-binary', b'2.0\n'), ('control.tar.gz', tar_of([('control', control)])),
           ('data.tar.gz', tar_of([(f'usr/share/doc/{name}/copyright', b'fixture\n')]))]
out = bytearray(b'!<arch>\n')
for member, data in members:
    out += f'{member:<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'.encode()
    out += data
    if len(data) % 2: out += b'\n'
open(path, 'wb').write(out)
DEB
    echo "${REG}/assets/${asset}"
}
V1="1.0.0+git${COMMIT:0:12}-1"
V2="1.1.0+git${OTHER_COMMIT:0:12}-1"
A1="$(build_deb mos-fixture "${V1}" amd64 mica-fixture "${COMMIT}")"
ALL="$(build_deb mos-data "${V1}" all mica-fixture "${COMMIT}")"
A2="$(build_deb mos-fixture "${V2}" amd64 mica-fixture "${OTHER_COMMIT}")"
LIAR="$(build_deb mos-liar "${V1}" amd64 mica-other "${COMMIT}")"   # says another repository inside
sha() { sha256sum "$1" | cut -d' ' -f1; }

python3 - "${REG}" "${WORK}/port" <<'PY' &
import http.server, socketserver, sys, os, pathlib, json, hashlib, re
root, portfile = sys.argv[1:]
root = pathlib.Path(root)
# releases/<repo>.json: [{tag_name, id, assets:[names]}] written by the test; assets served from assets/.
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, code, body=b'', ctype='application/json'):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def releases(self, repo):
        p = root / 'releases' / (repo + '.json')
        return json.loads(p.read_text()) if p.exists() else None
    def asset(self, name, aid):
        data = (root / 'assets' / name).read_bytes()
        return {'name': name, 'id': aid, 'url': f'http://127.0.0.1:{self.server.server_address[1]}/assets/{aid}/{name}',
                'size': len(data), 'digest': 'sha256:' + hashlib.sha256(data).hexdigest()}
    def release(self, repo, rel, rid):
        return {'id': rid, 'tag_name': rel['tag_name'], 'draft': False, 'prerelease': False,
                'assets': [self.asset(n, rid * 100 + i) for i, n in enumerate(rel['assets']) if (root / 'assets' / n).exists()]}
    def do_GET(self):
        if self.headers.get('Authorization', '') != 'Bearer fixture-token':
            return self.reply(401, b'{"message":"Bad credentials"}')
        m = re.fullmatch(r'/repos/([^/]+)/([^/]+)/releases(?:\?.*)?', self.path)
        if m:
            rels = self.releases(m.group(2))
            if rels is None: return self.reply(404, b'{"message":"Not Found"}')
            return self.reply(200, json.dumps([self.release(m.group(2), r, i + 1) for i, r in enumerate(rels)]).encode())
        m = re.fullmatch(r'/repos/([^/]+)/([^/]+)/releases/tags/([^/]+)', self.path)
        if m:
            rels = self.releases(m.group(2)) or []
            for i, r in enumerate(rels):
                if r['tag_name'] == m.group(3): return self.reply(200, json.dumps(self.release(m.group(2), r, i + 1)).encode())
            return self.reply(404, b'{"message":"Not Found"}')
        m = re.fullmatch(r'/assets/(\d+)/([^/]+)', self.path)
        if m and (root / 'assets' / m.group(2)).exists() and self.headers.get('Accept') == 'application/octet-stream':
            return self.reply(200, (root / 'assets' / m.group(2)).read_bytes(), 'application/octet-stream')
        return self.reply(404, b'{"message":"Not Found"}')
    do_HEAD = do_GET
with socketserver.TCPServer(('127.0.0.1', 0), Handler) as httpd:
    pathlib.Path(portfile).write_text(str(httpd.server_address[1]))
    httpd.serve_forever()
PY
SERVER_PID=$!
for _ in $(seq 1 50); do [ -s "${WORK}/port" ] && break; sleep 0.1; done
PORT="$(cat "${WORK}/port")"
mkdir -p "${REG}/releases"
releases() { # repo, then tag:asset,asset ... (newest first)
    local repo="$1"; shift
    python3 - "${REG}/releases/${repo}.json" "$@" <<'PY'
import json, sys
out = []
for spec in sys.argv[2:]:
    tag, _, assets = spec.partition(':')
    out.append({'tag_name': tag, 'assets': [a for a in assets.split(',') if a]})
open(sys.argv[1], 'w').write(json.dumps(out))
PY
}
releases mica-fixture "${OTHER_TAG}:$(basename "${A2}")" "${TAG}:$(basename "${A1}"),$(basename "${ALL}")"

cat >"${WORK}/registry.env" <<ENV
MICA_RELEASE_API=http://127.0.0.1:${PORT}
MICA_RELEASE_UPLOAD=http://127.0.0.1:${PORT}
MICA_RELEASE_OWNER=ybolab
MICA_RELEASE_TOKEN_VAR=MICA_POOL_TEST_TOKEN
MICA_SOURCE_URL=file://${WORK}/src
ENV
LOCK="${WORK}/pins"
mkdir -p "${LOCK}"
POOL="${WORK}/pool"
export MICA_REGISTRY_ENV="${WORK}/registry.env" MICA_LOCK_DIR="${LOCK}" MICA_POOL_DIR="${POOL}" MICA_RELEASE_NO_GH=1
# A pin file, written the way lock.sh writes one: name, repository, commit, and
# one target per pool the archive serves.
pin() { # package version arch sha256 repo commit
    python3 - "${LOCK}/$1.json" "$@" <<'PY'
import json, sys
path, name, version, arch, sha, repo, commit = sys.argv[1:]
asset = f'{name}_{version}_{arch}.deb'.replace('+', '.')
targets = {pool: {'version': version, 'architecture': arch, 'sha256': sha, 'asset': asset} for pool in (['amd64', 'arm64'] if arch == 'all' else [arch])}
open(path, 'w').write(json.dumps({'name': name, 'repository': repo, 'commit': commit, 'targets': targets}, indent=2, sort_keys=True) + '\n')
PY
}
export MICA_POOL_TEST_TOKEN=fixture-token
FETCH="bash ${REPO_ROOT}/build-env/deb/fetch.sh"
LOCKSH="bash ${REPO_ROOT}/build-env/deb/lock.sh"
OUT="${WORK}/out.txt"

# ------------------------------------------------------------ lock.sh --bump
if ${LOCKSH} --bump mica-fixture >"${OUT}" 2>&1 && says "${OUT}" "\"version\": \"${V2}\"" && [ -f "${LOCK}/mos-fixture.json" ] && [ ! -f "${LOCK}/mos-data.json" ]; then
    pass "L1 --bump without a tag locks the newest build-* release (one archive, from the archive's own fields) and prints the diff"
else fail "L1 --bump: $(cat "${OUT}")"; fi
if ${LOCKSH} --bump mica-fixture >"${OUT}" 2>&1 && says "${OUT}" "no change"; then
    pass "L2 a second --bump is a no-op"
else fail "L2 second bump: $(cat "${OUT}")"; fi
if ${LOCKSH} --bump mica-fixture --tag "${TAG}" >"${OUT}" 2>&1 && says "${OUT}" "+.*\"version\": \"${V1}\"" && says "${OUT}" "-.*\"version\": \"${V2}\"" && [ "$(jq -r '.targets | keys | join(" ")' "${LOCK}/mos-data.json")" = "amd64 arm64" ]; then
    pass "L3 --tag locks that release: both of its archives, the other release's row replaced"
else fail "L3 tagged bump: $(cat "${OUT}")"; fi
if ${LOCKSH} --bump mica-fixture --tag "${TAG}" --package mos-data >"${OUT}" 2>&1 && says "${OUT}" "no change"; then
    pass "L4 --package narrows the bump and keeps the component's other rows"
else fail "L4 narrowed bump: $(cat "${OUT}")"; fi
if ! ${LOCKSH} --bump mica-absent >"${OUT}" 2>&1 && says "${OUT}" "does not exist or is not readable"; then
    pass "L5 an unknown repository is refused by name"
else fail "L5 unknown component: $(cat "${OUT}")"; fi
releases mica-fixture "${TAG}:$(basename "${A1}"),$(basename "${ALL}"),$(basename "${LIAR}")"
if ! ${LOCKSH} --bump mica-fixture --tag "${TAG}" >"${OUT}" 2>&1 && says "${OUT}" "says Mica-Source-Repo: mica-other"; then
    pass "L6 an asset attributing itself to another repository is refused"
else fail "L6 liar asset: $(cat "${OUT}")"; fi
releases mica-fixture "${OTHER_TAG}:$(basename "${A2}")" "${TAG}:$(basename "${A1}"),$(basename "${ALL}")"
if ! ${LOCKSH} --bump mica-fixture --tag v1.0 >"${OUT}" 2>&1 && says "${OUT}" "is not build-<commit12>"; then
    pass "L7 a tag that is not a per-commit build release is refused"
else fail "L7 tag shape: $(cat "${OUT}")"; fi
if ! MICA_POOL_TEST_TOKEN= ${LOCKSH} --bump mica-fixture >"${OUT}" 2>&1 && says "${OUT}" "MICA_POOL_TEST_TOKEN is unset" && ! says "${OUT}" "fixture-token"; then
    pass "L8 an empty token variable is refused by the variable's name, never its value"
else fail "L8 token: $(cat "${OUT}")"; fi
ROWS="$(${LOCKSH} --rows --arch amd64 | cut -f1 | tr '\n' ' ')"
[ "${ROWS}" = "mos-data mos-fixture " ] && pass "L9 --rows --arch amd64 lists the amd64 and all rows (${ROWS% })" || fail "L9 rows: ${ROWS}"
# A package that used to come from another repository: its pin is rewritten
# when the new repository's release provides it (one file per package).
pin mos-fixture "${V2}" amd64 "$(sha "${A2}")" mica-old "${OTHER_COMMIT}"
if ${LOCKSH} --bump mica-fixture --tag "${TAG}" >"${OUT}" 2>&1 && says "${OUT}" "-.*\"repository\": \"mica-old\"" && [ "$(jq -r '.repository' "${LOCK}/mos-fixture.json")" = mica-fixture ]; then
    pass "L10 a pin of the same package from another repository is replaced, not kept beside the new one"
else fail "L10 moved package: $(cat "${OUT}")"; fi

# ------------------------------------------------------------ fetch.sh
if ${FETCH} --arch amd64 --check >"${OUT}" 2>&1 && says "${OUT}" "every locked archive for amd64 (2) is published" && says "${OUT}" "digest matches the lock"; then
    pass "F1 --check reads every row's release and compares the API digest"
else fail "F1 check: $(cat "${OUT}")"; fi
if ${FETCH} --arch amd64 >"${OUT}" 2>&1 && [ -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb" ] && [ -f "${POOL}/amd64/pool/mos-data_${V1}_all.deb" ] && says "${OUT}" "2 archive(s) fetched"; then
    pass "F2 the locked archives land in the pool, verified"
else fail "F2 fetch: $(cat "${OUT}")"; fi
if ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "0 archive(s) fetched, 2 already present"; then
    pass "F3 a second fetch downloads nothing"
else fail "F3 refetch: $(cat "${OUT}")"; fi
if ! MICA_POOL_TEST_TOKEN= ${FETCH} --arch arm64 >"${OUT}" 2>&1 && says "${OUT}" "MICA_POOL_TEST_TOKEN is unset"; then
    pass "F4 a missing token is refused by the variable's name (the lock has an all row for arm64)"
else fail "F4 token: $(cat "${OUT}")"; fi
if ! MICA_POOL_TEST_TOKEN=wrong-token ${FETCH} --arch amd64 --check >"${OUT}" 2>&1 && says "${OUT}" "answered 401 for ybolab/mica-fixture; MICA_POOL_TEST_TOKEN does not grant"; then
    pass "F5 a 401 names the token variable"
else fail "F5 401: $(cat "${OUT}")"; fi

# The release replaces an asset under its name: the digest no longer matches the lock.
cp "${A1}" "${WORK}/a1.orig"
python3 - "${A1}" <<'PY'
import sys; p = sys.argv[1]; d = bytearray(open(p, 'rb').read()); d[-1] ^= 1; open(p, 'wb').write(d)
PY
rm -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb"
if ! ${FETCH} --arch amd64 --check >"${OUT}" 2>&1 && says "${OUT}" "publishes $(basename "${A1}") with digest sha256:" && says "${OUT}" "the lock says sha256:$(sha "${WORK}/a1.orig")"; then
    pass "F6 --check refuses an asset whose published digest differs from the lock"
else fail "F6 check digest: $(cat "${OUT}")"; fi
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "mos-fixture ${V1} amd64: the release served bytes with sha256" && [ ! -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb" ] && [ -z "$(find "${POOL}/amd64/pool" -name '.fetch.*')" ]; then
    pass "F7 an asset whose bytes differ from the lock is refused by name and discarded"
else fail "F7 altered bytes: $(cat "${OUT}")"; fi
cp "${WORK}/a1.orig" "${A1}"

# The pin is wrong about the archive it names: same bytes, other source commit.
pin mos-data "${V1}" all "$(sha "${ALL}")" mica-fixture "$(printf 'd%.0s' $(seq 1 40))"
rm -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb" "${POOL}/amd64/pool/mos-data_${V1}_all.deb"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "has no release tagged build-dddddddddddd" && [ "$(find "${POOL}/amd64/pool" -name '*.deb' | wc -l)" -eq 0 ]; then
    pass "F8 a lock row naming a commit the repository never released is refused by tag, before any download"
else fail "F8 unreleased commit: $(cat "${OUT}")"; fi
${LOCKSH} --bump mica-fixture --tag "${TAG}" >/dev/null 2>&1
releases mica-fixture "${TAG}:$(basename "${A1}")"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "carries no asset named $(basename "${ALL}")"; then
    pass "F9 a row whose asset the release does not hold is refused by name"
else fail "F9 missing asset: $(cat "${OUT}")"; fi
releases mica-fixture "${TAG}:$(basename "${A1}"),$(basename "${ALL}")"
# Same bytes, a lock row that lies about the archive's fields: the release's
# own asset under a name that says one thing while the control file says another.
pin mos-fixture "${V1}" amd64 "$(sha "${LIAR}")" mica-fixture "${COMMIT}"
cp "${LIAR}" "${A1}"
rm -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "control file says Package: 'mos-liar', and the lock row says 'mos-fixture'" && [ ! -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb" ]; then
    pass "F10 a lock row that disagrees with the archive's control field is refused by name and the download discarded"
else fail "F10 control mismatch: $(cat "${OUT}")"; fi
cp "${WORK}/a1.orig" "${A1}"
${LOCKSH} --bump mica-fixture --tag "${TAG}" >/dev/null 2>&1
cp "${LOCK}/mos-fixture.json" "${LOCK}/mos-other.json"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "is not a package pin"; then
    pass "F11 a pin file that does not name the package it holds is refused before any download"
else fail "F11 misnamed pin: $(cat "${OUT}")"; fi
rm -f "${LOCK}/mos-other.json"

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) (${PASS_N}/$((PASS_N + FAIL_N)) checks passed)"
[ "${FAIL_N}" -eq 0 ]
