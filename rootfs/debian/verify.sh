#!/usr/bin/env bash
# Check rendered lock rows at the archive boundary, including inside the rootfs.
# mos-build-side: container -- called by run.sh and compose-install.sh.
set -euo pipefail
CACHE_DIR=${1:?cache directory is required}
fail() { echo "debian-base: error: $*" >&2; exit 1; }
count=0
while IFS=$'\t' read -r name version arch sha url consumers; do
    [[ "$sha" =~ ^[a-f0-9]{64}$ ]] || fail 'invalid rendered archive checksum'
    file=$CACHE_DIR/debs/$sha.deb
    [ -s "$file" ] || fail "cache is missing: $file"
    [ "$(sha256sum "$file" | cut -d' ' -f1)" = "$sha" ] || fail "SHA256 mismatch: $file"
    [ "$(dpkg-deb -W --showformat='${Package}\t${Version}\t${Architecture}' "$file")" = "$(printf '%s\t%s\t%s' "$name" "$version" "$arch")" ] || fail "package metadata mismatch: $file"
    count=$((count + 1))
done
[ "$count" -gt 0 ] || fail 'rendered package selection is empty'
