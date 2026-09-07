#!/usr/bin/env bash
# Exercise the cache boundary without network access or host package changes.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [ "${MOS_DEBIAN_TEST_INNER:-0}" != 1 ]; then
    command -v docker >/dev/null
    IMAGE=$(bash "$REPO_ROOT/build-env/from.sh" --ref IMAGE_BUN_1)
    case "$REPO_ROOT" in
    /work/*) HOST_PROJECT=/srv/station/work/${REPO_ROOT#/work/} ;;
    /root/*) HOST_PROJECT=/srv/station/root/${REPO_ROOT#/root/} ;;
    *) HOST_PROJECT=$REPO_ROOT ;;
    esac
    exec docker run --rm --label ai-agent=true --network none \
        -v "$HOST_PROJECT/rootfs/debian:/mos/rootfs/debian:ro" \
        -v "$HOST_PROJECT/tests:/mos/tests:ro" \
        -e MOS_DEBIAN_TEST_INNER=1 "$IMAGE" bash /mos/tests/debian-base-test.sh
fi
# mos-build-side: container-block -- fixture archives are built only in the pinned test container.
mkdir -p "$REPO_ROOT/tmp"
WORK=$(mktemp -d "${REPO_ROOT}/tmp/debian-base-test.XXXXXX")
trap 'rm -rf "$WORK"; [ -z "${MIRROR_PID:-}" ] || kill "$MIRROR_PID" 2>/dev/null || true' EXIT
ENTRY=${REPO_ROOT}/rootfs/debian/run.sh
PASS=0

reject() {
    local expected=$1
    shift
    if "$@" >"$WORK/output" 2>&1; then
        cat "$WORK/output" >&2
        echo "FAIL: expected refusal: $expected" >&2
        exit 1
    fi
    if ! grep -Fq -- "$expected" "$WORK/output"; then
        cat "$WORK/output" >&2
        echo "FAIL: missing refusal: $expected" >&2
        exit 1
    fi
    PASS=$((PASS + 1))
}

bash "$ENTRY" --help >"$WORK/help"
grep -Fq 'cache|verify|select|install' "$WORK/help"
grep -Fq -- '--package NAME' "$WORK/help"
PASS=$((PASS + 1))
reject 'unknown command' bash "$ENTRY" unknown
reject '--arch is required' bash "$ENTRY" cache
reject 'unsupported architecture' bash "$ENTRY" cache --arch riscv64
reject 'unknown option' bash "$ENTRY" cache --arch amd64 --missing
reject 'requires --root' bash "$ENTRY" install --arch amd64
reject 'host root' bash "$ENTRY" install --arch amd64 --root /
ln -s / "$WORK/root-link"
reject 'host root' bash "$ENTRY" install --arch amd64 --root "$WORK/root-link"
reject 'cannot contain the cache' bash "$ENTRY" install --arch amd64 --root "$WORK/parent" --cache-dir "$WORK/parent/cache"
reject 'cannot be inside the cache' bash "$ENTRY" install --arch amd64 --root "$WORK/cache/child" --cache-dir "$WORK/cache"
mkdir "$WORK/root"
printf 'preserve\n' >"$WORK/root/sentinel"
reject 'must be empty' bash "$ENTRY" install --arch amd64 --root "$WORK/root"
test "$(cat "$WORK/root/sentinel")" = preserve
reject 'configure requires --root' bash "$ENTRY" configure
reject 'not used by configure' bash "$ENTRY" configure --arch amd64 --root "$WORK/root"
reject 'no .debian-extra/configure.sh' bash "$ENTRY" configure --root "$WORK/root"
test "$(cat "$WORK/root/sentinel")" = preserve
reject 'cache is missing' bash "$ENTRY" verify --arch amd64 --cache-dir "$WORK/cache"
test ! -e "$WORK/cache"
reject 'cache is missing' bash "$ENTRY" install --arch amd64 --root "$WORK/new-root" --cache-dir "$WORK/cache"
test ! -e "$WORK/new-root"
reject 'rendered package selection is empty' bash "$REPO_ROOT/rootfs/debian/verify.sh" "$WORK/cache" </dev/null
reject 'invalid rendered archive checksum' bash "$REPO_ROOT/rootfs/debian/verify.sh" "$WORK/cache" <<<'bad row'

# Real tiny deb archives let verification check metadata as well as bytes.
FIXTURE=$WORK/repo/rootfs/debian
mkdir -p "$FIXTURE/packages" "$FIXTURE/helpers" "$WORK/fixture-cache/debs"
cp "$ENTRY" "$FIXTURE/run.sh"
cp "$REPO_ROOT/rootfs/debian/manifest.ts" "$REPO_ROOT/rootfs/debian/verify.sh" "$FIXTURE/"
cp "$REPO_ROOT/rootfs/debian/sources.env" "$FIXTURE/sources.env"
printf 'mos-system\n' >"$FIXTURE/consumers.pkgs"
make_deb() {
    local name=$1 version=$2
    mkdir -p "$WORK/pkg-$name/DEBIAN"
    printf 'Package: %s\nVersion: %s\nArchitecture: all\nMaintainer: Test <test@example.invalid>\nDescription: Cache fixture\n' "$name" "$version" >"$WORK/pkg-$name/DEBIAN/control"
    dpkg-deb --build "$WORK/pkg-$name" "$WORK/$name.deb" >/dev/null
    sha256sum "$WORK/$name.deb" | cut -d' ' -f1
}
helper_hash=$(make_deb debootstrap 1.0)
package_hash=$(make_deb libc6 2.41)
cp "$WORK/debootstrap.deb" "$WORK/fixture-cache/debs/$helper_hash.deb"
cp "$WORK/libc6.deb" "$WORK/fixture-cache/debs/$package_hash.deb"
write_package() {
    local name=$1 version=$2 sha=$3
    cat >"$FIXTURE/packages/$name.json" <<JSON
{
  "name": "$name",
  "targets": {
    "amd64": {
      "version": "$version",
      "architecture": "all",
      "sha256": "$sha",
      "url": "https://snapshot.debian.org/archive/debian/20260905T000000Z/pool/$name.deb",
      "consumers": ["base"]
    }
  }
}
JSON
}
write_package libc6 2.41 "$package_hash"
cat >"$FIXTURE/helpers/debootstrap.json" <<JSON
{"name":"debootstrap","version":"1.0","architecture":"all","sha256":"$helper_hash","url":"https://deb.debian.org/debian/pool/bootstrap.deb"}
JSON
printf 'throw new Error("unexpected download invocation");\n' >"$FIXTURE/fetch.ts"
FIXTURE_ENTRY=(bash "$FIXTURE/run.sh")
FIXTURE_ARGS=(--arch amd64 --cache-dir "$WORK/fixture-cache")
"${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}" >"$WORK/output"
grep -Fq 'verified 1 packages' "$WORK/output"
PASS=$((PASS + 1))
"${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" >"$WORK/output"
grep -Fq 'downloaded 0 archives' "$WORK/output"
PASS=$((PASS + 1))

printf 'damage' >>"$WORK/fixture-cache/debs/$package_hash.deb"
reject 'SHA256 mismatch' "${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}"
reject 'SHA256 mismatch' "${FIXTURE_ENTRY[@]}" install "${FIXTURE_ARGS[@]}" --root "$WORK/corrupt-root"
test ! -e "$WORK/corrupt-root"
cp "$WORK/libc6.deb" "$WORK/fixture-cache/debs/$package_hash.deb"
cp "$FIXTURE/packages/libc6.json" "$WORK/good.json"
sed -i 's/2.41/2.42/' "$FIXTURE/packages/libc6.json"
reject 'package metadata mismatch' "${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"
sed -i 's/"architecture": "all"/"architecture": "arm64"/' "$FIXTURE/packages/libc6.json"
reject 'invalid package lock' "${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"
sed -i 's/"name": "libc6"/"name": "apt"/' "$FIXTURE/packages/libc6.json"
reject 'invalid package lock' "${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"
sed -i 's@https://snapshot@http://snapshot@' "$FIXTURE/packages/libc6.json"
reject 'invalid package lock' "${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"
printf 'damage' >>"$WORK/fixture-cache/debs/$helper_hash.deb"
reject 'SHA256 mismatch' "${FIXTURE_ENTRY[@]}" install "${FIXTURE_ARGS[@]}" --root "$WORK/bad-helper-root"
test ! -e "$WORK/bad-helper-root"
cp "$WORK/debootstrap.deb" "$WORK/fixture-cache/debs/$helper_hash.deb"
printf 'mos-unknown\n' >"$WORK/selection"
reject 'unknown package consumer' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}" --packages "$WORK/selection"
printf '# Empty selection\n' >"$WORK/selection"
reject 'package selection is empty' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}" --packages "$WORK/selection"
reject 'mutually exclusive' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}" --packages "$WORK/selection" --all
reject 'cannot be used with install' "${FIXTURE_ENTRY[@]}" install "${FIXTURE_ARGS[@]}" --package libc6 --root "$WORK/single-root"
test ! -e "$WORK/single-root"
reject 'mutually exclusive' "${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libc6 --all
reject 'invalid package lock' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}" --package ../libc6
reject 'invalid package lock' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}" --package missing
reject 'no arm64 variant' "${FIXTURE_ENTRY[@]}" select --arch arm64 --package libc6
printf '{broken' >"$FIXTURE/packages/libc6.json"
reject 'invalid package lock' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"
sed -i 's/"consumers":/"consumer":/' "$FIXTURE/packages/libc6.json"
reject 'unexpected or missing fields' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"
sed -i 's/"2.41"/"2.41\\n"/' "$FIXTURE/packages/libc6.json"
reject 'invalid field value' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"
sed -i 's/"base"/"mos-unknown"/' "$FIXTURE/packages/libc6.json"
reject 'unknown package consumer' "${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}"
cp "$WORK/good.json" "$FIXTURE/packages/libc6.json"

# Update one JSON file to a new version/snapshot. Only the new archive is fetched;
# old archives, the helper and unrelated package records are not touched.
other_hash=$(make_deb libother 1.0)
write_package libother 1.0 "$other_hash"
cp "$WORK/libother.deb" "$WORK/fixture-cache/debs/$other_hash.deb"
cp "$FIXTURE/packages/libother.json" "$WORK/other.json"
find "$WORK/fixture-cache/debs" -type f -printf '%f %s %T@\n' | sort >"$WORK/cache-before"
new_hash=$(make_deb libc6 2.42)
write_package libc6 2.42 "$new_hash"
sed -i 's/20260905T000000Z/20260906T000000Z/' "$FIXTURE/packages/libc6.json"
cat >"$FIXTURE/fetch.ts" <<'TS'
import { appendFileSync } from "node:fs";
if (Bun.argv[2] !== "https://snapshot.debian.org/archive/debian/20260906T000000Z/pool/libc6.deb") throw new Error("unexpected download URL");
await Bun.write(Bun.argv[3], Bun.file(process.env.FIXTURE_DOWNLOAD!));
appendFileSync(process.env.FIXTURE_DOWNLOAD_LOG!, `${Bun.argv[2]}\n`);
TS
export FIXTURE_DOWNLOAD=$WORK/libc6.deb FIXTURE_DOWNLOAD_LOG=$WORK/download.log
"${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libc6 >"$WORK/output"
grep -Fq 'verified 1 packages; downloaded 1 archives' "$WORK/output"
test "$(wc -l <"$WORK/download.log")" -eq 1
cmp "$WORK/other.json" "$FIXTURE/packages/libother.json"
find "$WORK/fixture-cache/debs" -type f ! -name "$new_hash.deb" -printf '%f %s %T@\n' | sort >"$WORK/cache-after"
cmp "$WORK/cache-before" "$WORK/cache-after"
PASS=$((PASS + 1))
"${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" >"$WORK/output"
grep -Fq 'verified 2 packages; downloaded 0 archives' "$WORK/output"
test "$(wc -l <"$WORK/download.log")" -eq 1
PASS=$((PASS + 1))
# THE MIRROR. It rewrites the PREFIX of a record's URL at fetch time; the record
# is untouched, so the JSON keeps saying which snapshot and pool path the pin
# came from. Two halves are checked separately because they fail differently.
#
# First half, over a REAL HTTPS transport: a Bun server on loopback, which
# --network none still provides, so this reaches nothing. It is here because the
# 404 -> exit 44 mapping lives in fetch.ts, and a stub fetch.ts that exits 44
# when the test tells it to would be asserting the test's own arithmetic. The
# self-signed certificate is why TLS verification is off for these two cases
# only -- fetch.ts's https:// requirement is what is being kept, not bypassed.
command -v openssl >/dev/null
mirror_hash=$(make_deb libmirror 1.0)
write_package libmirror 1.0 "$mirror_hash"
MIRROR_DIR=$WORK/mirror
mkdir -p "$MIRROR_DIR"
openssl req -x509 -newkey rsa:2048 -keyout "$MIRROR_DIR/key.pem" -out "$MIRROR_DIR/cert.pem" \
    -days 1 -nodes -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 >/dev/null 2>&1
cat >"$MIRROR_DIR/serve.ts" <<'TS'
const dir = process.env.MIRROR_DIR!;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  tls: { cert: Bun.file(`${dir}/cert.pem`), key: Bun.file(`${dir}/key.pem`) },
  fetch(request) {
    if (new URL(request.url).pathname === "/debian/pool/libmirror.deb") {
      return new Response(Bun.file(process.env.MIRROR_DEB!));
    }
    return new Response("not on this mirror", { status: 404 });
  },
});
await Bun.write(`${dir}/port`, String(server.port));
TS
MIRROR_DIR=$MIRROR_DIR MIRROR_DEB=$WORK/libmirror.deb bun "$MIRROR_DIR/serve.ts" &
MIRROR_PID=$!
for _ in $(seq 1 50); do [ -s "$MIRROR_DIR/port" ] && break; sleep 0.2; done
test -s "$MIRROR_DIR/port"
MIRROR_PORT=$(cat "$MIRROR_DIR/port")
cp "$REPO_ROOT/rootfs/debian/fetch.ts" "$FIXTURE/fetch.ts"
export NODE_TLS_REJECT_UNAUTHORIZED=0
export MOS_DEBIAN_MIRROR=https://127.0.0.1:$MIRROR_PORT/debian/
"${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror >"$WORK/output" 2>&1
grep -Fq 'downloaded 1 archives (1 from the mirror, 0 from the pinned URL)' "$WORK/output"
cmp "$WORK/libmirror.deb" "$WORK/fixture-cache/debs/$mirror_hash.deb"
PASS=$((PASS + 1))
# A 404 from the mirror is normal and falls back to the record's own URL. That
# URL is snapshot.debian.org and this container has no route to it, which is
# exactly what makes the refusal evidence: the fallback leg ran, with the
# canonical URL, and the message names it.
rm "$WORK/fixture-cache/debs/$mirror_hash.deb"
export MOS_DEBIAN_MIRROR=https://127.0.0.1:$MIRROR_PORT/absent
reject 'download failed for libmirror: https://snapshot.debian.org/archive/debian/20260905T000000Z/pool/libmirror.deb' \
    "${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror
unset NODE_TLS_REJECT_UNAUTHORIZED
kill "$MIRROR_PID" 2>/dev/null || true
MIRROR_PID=
test ! -e "$WORK/fixture-cache/debs/$mirror_hash.deb"

# Second half: run.sh's branching, with the transport stubbed. Only the network
# is fabricated here -- which URL is asked for, what a 44 does next, what a hash
# mismatch does instead, and what the run reports are all the real code.
cat >"$FIXTURE/fetch.ts" <<'TS'
import { appendFileSync } from "node:fs";
const url = Bun.argv[2];
appendFileSync(process.env.FIXTURE_DOWNLOAD_LOG!, `${url}\n`);
const prefix = (name: string) => process.env[name] && url.startsWith(process.env[name]!);
if (prefix("FIXTURE_ABSENT")) process.exit(44);
if (prefix("FIXTURE_BROKEN")) process.exit(7);
await Bun.write(Bun.argv[3], prefix("FIXTURE_CORRUPT") ? "not the pinned bytes" : Bun.file(process.env.FIXTURE_DOWNLOAD!));
TS
export FIXTURE_DOWNLOAD=$WORK/libmirror.deb
export MOS_DEBIAN_MIRROR=https://mirror.invalid/debian
# The split, and the warning that names a mirror which is configured and doing
# nothing. Silence here is what a decorative mirror would look like.
: >"$WORK/download.log"
FIXTURE_ABSENT=https://mirror.invalid/ "${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror >"$WORK/output" 2>&1
grep -Fq 'downloaded 1 archives (0 from the mirror, 1 from the pinned URL)' "$WORK/output"
grep -Fq 'https://mirror.invalid/debian served none of the 1 archive(s) downloaded' "$WORK/output"
diff -u - "$WORK/download.log" <<'LOG'
https://mirror.invalid/debian/pool/libmirror.deb
https://snapshot.debian.org/archive/debian/20260905T000000Z/pool/libmirror.deb
LOG
PASS=$((PASS + 1))
# Mirror bytes that do not match the pin are a WRONG MIRROR, not a reason to try
# somewhere else. The refusal names the mirror URL, and the download log holds
# one line: the canonical URL was never asked, so no fallback can launder this.
rm "$WORK/fixture-cache/debs/$mirror_hash.deb"
: >"$WORK/download.log"
export FIXTURE_CORRUPT=https://mirror.invalid/
reject 'SHA256 mismatch downloading libmirror from https://mirror.invalid/debian/pool/libmirror.deb' \
    "${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror
diff -u - "$WORK/download.log" <<'LOG'
https://mirror.invalid/debian/pool/libmirror.deb
LOG
unset FIXTURE_CORRUPT
test ! -e "$WORK/fixture-cache/debs/$mirror_hash.deb"
# A mirror that fails for any other reason stops the run. Only absence is
# ordinary; a broken mirror that silently fell back would be indistinguishable
# from one that works.
: >"$WORK/download.log"
export FIXTURE_BROKEN=https://mirror.invalid/
reject 'mirror download failed for libmirror: https://mirror.invalid/debian/pool/libmirror.deb' \
    "${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror
test "$(wc -l <"$WORK/download.log")" -eq 1
unset FIXTURE_BROKEN
# The snapshot layout replaces only the host, so each record keeps its own
# snapshot and no pin is missing from the mirror.
: >"$WORK/download.log"
export MOS_DEBIAN_MIRROR=snapshot:https://snap.invalid
"${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror >"$WORK/output" 2>&1
grep -Fq 'downloaded 1 archives (1 from the mirror, 0 from the pinned URL)' "$WORK/output"
diff -u - "$WORK/download.log" <<'LOG'
https://snap.invalid/archive/debian/20260905T000000Z/pool/libmirror.deb
LOG
PASS=$((PASS + 1))
export MOS_DEBIAN_MIRROR=ftp://mirror.invalid/debian
reject 'must be an https:// base' "${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror
# ... and no command but cache reads the variable at all, which is why a value
# cache would refuse leaves the offline commands exactly as they were.
"${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}" --package libmirror >"$WORK/output"
grep -Fq 'verified 1 packages' "$WORK/output"
"${FIXTURE_ENTRY[@]}" select "${FIXTURE_ARGS[@]}" --package libmirror >/dev/null
PASS=$((PASS + 1))
unset MOS_DEBIAN_MIRROR
# Unconfigured, the download path is the one that was here before: no mirror URL
# is tried and the report carries no split.
rm "$WORK/fixture-cache/debs/$mirror_hash.deb"
: >"$WORK/download.log"
"${FIXTURE_ENTRY[@]}" cache "${FIXTURE_ARGS[@]}" --package libmirror >"$WORK/output" 2>&1
grep -Fq 'verified 1 packages; downloaded 1 archives; cache' "$WORK/output"
diff -u - "$WORK/download.log" <<'LOG'
https://snapshot.debian.org/archive/debian/20260905T000000Z/pool/libmirror.deb
LOG
PASS=$((PASS + 1))
rm "$FIXTURE/packages/libmirror.json" "$WORK/fixture-cache/debs/$mirror_hash.deb"
printf 'throw new Error("unexpected download invocation");\n' >"$FIXTURE/fetch.ts"

# Targeted operations do not read unrelated package/helper JSON or archives.
printf '{broken' >"$FIXTURE/packages/libother.json"
printf '{broken' >"$FIXTURE/helpers/debootstrap.json"
printf 'damage' >>"$WORK/fixture-cache/debs/$other_hash.deb"
"${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}" --package libc6 >"$WORK/output"
grep -Fq 'verified 1 packages' "$WORK/output"
PASS=$((PASS + 1))
reject 'invalid package lock' "${FIXTURE_ENTRY[@]}" verify "${FIXTURE_ARGS[@]}"
echo "RESULT: PASS ($PASS checks)"
# mos-build-side: host
