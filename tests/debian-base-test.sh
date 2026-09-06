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
trap 'rm -rf "$WORK"' EXIT
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
