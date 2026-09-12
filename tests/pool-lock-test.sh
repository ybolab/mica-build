#!/usr/bin/env bash
# fetch.sh and lock.sh against a stub registry: every refusal by name, every
# acceptance leaving exactly the locked archive in the pool.
#
#   bash tests/pool-lock-test.sh
#
# The stub is a local HTTP server that requires the Authorization header and
# serves a Debian-registry layout (pool/<dist>/<component>/<archive> and
# dists/<dist>/<component>/binary-<arch>/Packages) out of a scratch
# directory; the archives are written in Python, no dpkg on the host. registry.sh's
# MOS_REGISTRY_ENV and MOS_LOCK_FILE point the scripts at the stub and at a
# scratch lock, MOS_POOL_DIR at a scratch pool. No docker, no network.
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
REG="${WORK}/registry"
mkdir -p "${REG}/pool/mica/mica-fixture" "${REG}/dists/mica/mica-fixture/binary-amd64" "${REG}/dists/mica/mica-fixture/binary-all"
COMMIT="$(printf 'b%.0s' $(seq 1 40))"
# Fixture archives are written in Python -- an `ar` of debian-binary,
# control.tar.gz and data.tar.gz -- because the host carries no dpkg
# (docs/design/build.md section 0) and this test runs no container.
build_deb() { # name version arch repo commit -> path
    python3 - "${REG}/pool/mica/mica-fixture/$1_$2_$3.deb" "$1" "$2" "$3" "$4" "$5" <<'DEB'
import io, sys, tarfile
path, name, version, arch, repo, commit = sys.argv[1:]
control = f'Package: {name}\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Fixture <fixture@example.invalid>\nDescription: fixture\nMos-Source-Repo: {repo}\nMos-Source-Commit: {commit}\n'.encode()
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
    echo "${REG}/pool/mica/mica-fixture/$1_$2_$3.deb"
}
V1="1.0.0+git${COMMIT:0:12}-1"
V2="1.1.0+git${COMMIT:0:12}-1"
A1="$(build_deb mos-fixture "${V1}" amd64 mica-fixture "${COMMIT}")"
A2="$(build_deb mos-fixture "${V2}" amd64 mica-fixture "${COMMIT}")"
ALL="$(build_deb mos-data "${V2}" all mica-fixture "${COMMIT}")"
LIAR="$(build_deb mos-liar "${V2}" amd64 mica-other "${COMMIT}")"   # says another repository inside
FIELDS="python3 ${REPO_ROOT}/build-env/deb/control-fields.py"
stanza() { # path -> Packages stanza
    printf 'Package: %s\nVersion: %s\nArchitecture: %s\nMos-Source-Repo: %s\nMos-Source-Commit: %s\nFilename: pool/mica/mica-fixture/%s\nSHA256: %s\n\n' \
        "$(${FIELDS} "$1" Package)" "$(${FIELDS} "$1" Version)" "$(${FIELDS} "$1" Architecture)" \
        "$2" "$(${FIELDS} "$1" Mos-Source-Commit)" "$(basename "$1")" "$(sha256sum "$1" | cut -d' ' -f1)"
}
{ stanza "${A1}" mica-fixture; stanza "${A2}" mica-fixture; } >"${REG}/dists/mica/mica-fixture/binary-amd64/Packages"
stanza "${ALL}" mica-fixture >"${REG}/dists/mica/mica-fixture/binary-all/Packages"
sha() { sha256sum "$1" | cut -d' ' -f1; }

python3 - "${REG}" "${WORK}/port" <<'PY' &
import http.server, socketserver, sys, os, pathlib
root, portfile = sys.argv[1:]
os.chdir(root)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def authorized(self):
        if self.headers.get('Authorization', '') == 'token fixture-token': return True
        self.send_response(401); self.end_headers(); return False
    def do_GET(self):
        if self.authorized(): super().do_GET()
    def do_HEAD(self):
        if self.authorized(): super().do_HEAD()
with socketserver.TCPServer(('127.0.0.1', 0), Handler) as httpd:
    pathlib.Path(portfile).write_text(str(httpd.server_address[1]))
    httpd.serve_forever()
PY
SERVER_PID=$!
for _ in $(seq 1 50); do [ -s "${WORK}/port" ] && break; sleep 0.1; done
PORT="$(cat "${WORK}/port")"

cat >"${WORK}/registry.env" <<ENV
MOS_REGISTRY_URL=http://127.0.0.1:${PORT}
MOS_REGISTRY_DIST=mica
MOS_REGISTRY_TOKEN_VAR=MOS_POOL_TEST_TOKEN
MOS_SOURCE_URL=file://${WORK}/src
ENV
LOCK="${WORK}/lock.tsv"
printf '#package\tversion\tarch\tsha256\tsource-repo\tsource-commit\n' >"${LOCK}"
POOL="${WORK}/pool"
export MOS_REGISTRY_ENV="${WORK}/registry.env" MOS_LOCK_FILE="${LOCK}" MOS_POOL_DIR="${POOL}"
export MOS_POOL_TEST_TOKEN=fixture-token
FETCH="bash ${REPO_ROOT}/build-env/deb/fetch.sh"
LOCKSH="bash ${REPO_ROOT}/build-env/deb/lock.sh"
OUT="${WORK}/out.txt"

# ------------------------------------------------------------ lock.sh --bump
if ${LOCKSH} --bump mica-fixture >"${OUT}" 2>&1 && says "${OUT}" "+mos-fixture	${V2}	amd64" && says "${OUT}" "+mos-data	${V2}	all" && ! says "${OUT}" "${V1}"; then
    pass "L1 --bump locks the newest version of each package of the component and prints the diff"
else fail "L1 --bump: $(cat "${OUT}")"; fi
if ${LOCKSH} --bump mica-fixture >"${OUT}" 2>&1 && says "${OUT}" "no change"; then
    pass "L2 a second --bump is a no-op"
else fail "L2 second bump: $(cat "${OUT}")"; fi
if ${LOCKSH} --bump mica-fixture --version "${V1}" --package mos-fixture >"${OUT}" 2>&1 && says "${OUT}" "+mos-fixture	${V1}" && says "${OUT}" "-mos-fixture	${V2}" && ! says "${OUT}" "^[-+]mos-data"; then
    pass "L3 --version and --package pin one package to an older version and keep the other rows"
else fail "L3 pinned bump: $(cat "${OUT}")"; fi
if ! ${LOCKSH} --bump mica-absent >"${OUT}" 2>&1 && says "${OUT}" "holds no archive for component mica-absent"; then
    pass "L4 an unknown component is refused by name"
else fail "L4 unknown component: $(cat "${OUT}")"; fi
cp "${REG}/dists/mica/mica-fixture/binary-amd64/Packages" "${WORK}/Packages.amd64"
stanza "${LIAR}" mica-other >>"${REG}/dists/mica/mica-fixture/binary-amd64/Packages"
if ! ${LOCKSH} --bump mica-fixture --package mos-liar >"${OUT}" 2>&1 && says "${OUT}" "says Mos-Source-Repo: mica-other"; then
    pass "L5 an index stanza attributing an archive to another repository is refused"
else fail "L5 liar stanza: $(cat "${OUT}")"; fi
cp "${WORK}/Packages.amd64" "${REG}/dists/mica/mica-fixture/binary-amd64/Packages"
if ! MOS_POOL_TEST_TOKEN= ${LOCKSH} --bump mica-fixture >"${OUT}" 2>&1 && says "${OUT}" "MOS_POOL_TEST_TOKEN is unset" && ! says "${OUT}" "fixture-token"; then
    pass "L6 an empty token variable is refused by the variable's name, never its value"
else fail "L6 token: $(cat "${OUT}")"; fi
ROWS="$(${LOCKSH} --rows --arch amd64 | cut -f1 | tr '\n' ' ')"
[ "${ROWS}" = "mos-data mos-fixture " ] && pass "L7 --rows --arch amd64 lists the amd64 and all rows (${ROWS% })" || fail "L7 rows: ${ROWS}"

# ------------------------------------------------------------ fetch.sh
if ${FETCH} --arch amd64 --check >"${OUT}" 2>&1 && says "${OUT}" "every locked archive for amd64 (2) is reachable"; then
    pass "F1 --check reaches every row"
else fail "F1 check: $(cat "${OUT}")"; fi
if ${FETCH} --arch amd64 >"${OUT}" 2>&1 && [ -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb" ] && [ -f "${POOL}/amd64/pool/mos-data_${V2}_all.deb" ] && says "${OUT}" "2 archive(s) fetched"; then
    pass "F2 the locked archives land in the pool, verified"
else fail "F2 fetch: $(cat "${OUT}")"; fi
if ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "0 archive(s) fetched, 2 already present"; then
    pass "F3 a second fetch downloads nothing"
else fail "F3 refetch: $(cat "${OUT}")"; fi
if ! MOS_POOL_TEST_TOKEN= ${FETCH} --arch arm64 >"${OUT}" 2>&1 && says "${OUT}" "MOS_POOL_TEST_TOKEN is unset"; then
    pass "F4 a missing token is refused by the variable's name (the lock has an all row for arm64)"
else fail "F4 token: $(cat "${OUT}")"; fi
if ! MOS_POOL_TEST_TOKEN=wrong-scheme ${FETCH} --arch amd64 --check >"${OUT}" 2>&1 && says "${OUT}" "answered 401; MOS_POOL_TEST_TOKEN does not grant"; then
    pass "F5 a 401 names the token variable"
else fail "F5 401: $(cat "${OUT}")"; fi

# The registry replaces an archive under its name: the digest no longer matches the lock.
cp "${A1}" "${WORK}/a1.orig"
python3 - "${A1}" <<'PY'
import sys; p = sys.argv[1]; d = bytearray(open(p, 'rb').read()); d[-1] ^= 1; open(p, 'wb').write(d)
PY
rm -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "mos-fixture ${V1} amd64: the registry served bytes with sha256" && [ ! -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb" ] && [ -z "$(find "${POOL}/amd64/pool" -name '.fetch.*')" ]; then
    pass "F6 an archive whose bytes differ from the lock is refused by name and discarded"
else fail "F6 altered bytes: $(cat "${OUT}")"; fi
cp "${WORK}/a1.orig" "${A1}"

# The lock row is wrong about the archive it names: same bytes, other source commit.
python3 - "${LOCK}" "${COMMIT}" <<'PY'
import sys, pathlib; p = pathlib.Path(sys.argv[1]); c = sys.argv[2]
p.write_text(p.read_text().replace('\t' + c + '\n', '\t' + 'c' * 40 + '\n', 1))
PY
rm -f "${POOL}/amd64/pool/mos-fixture_${V1}_amd64.deb" "${POOL}/amd64/pool/mos-data_${V2}_all.deb"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "control file says Mos-Source-Commit: '${COMMIT}', and the lock row says '$(printf 'c%.0s' $(seq 1 40))'" && [ "$(find "${POOL}/amd64/pool" -name '*.deb' | wc -l)" -eq 0 ]; then
    pass "F7 a lock row that disagrees with the archive's control field is refused by name and the download discarded"
else fail "F7 control mismatch: $(cat "${OUT}")"; fi
${LOCKSH} --bump mica-fixture >/dev/null 2>&1
rm -f "${REG}/pool/mica/mica-fixture/mos-data_${V2}_all.deb"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "does not hold mos-data_${V2}_all.deb under component mica-fixture"; then
    pass "F8 a row the registry cannot serve is refused by name"
else fail "F8 404: $(cat "${OUT}")"; fi
printf 'mos-fixture\t%s\tamd64\t%s\tmica-fixture\t%s\n' "${V2}" "$(sha "${A2}")" "${COMMIT}" >"${LOCK}.bad"
cat "${LOCK}" "${LOCK}.bad" >"${LOCK}.dup"; cp "${LOCK}.dup" "${LOCK}"
if ! ${FETCH} --arch amd64 >"${OUT}" 2>&1 && says "${OUT}" "locked twice"; then
    pass "F9 a package locked twice for one architecture is refused before any download"
else fail "F9 duplicate row: $(cat "${OUT}")"; fi

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) (${PASS_N}/$((PASS_N + FAIL_N)) checks passed)"
[ "${FAIL_N}" -eq 0 ]
