#!/bin/bash
# Emit the public manifest with build-derived key IDs; never alter host input.
set -euo pipefail

manifest=${1:?usage: derive-signing-key-ids.sh MANIFEST}
for tool in jq base64 sha256sum wc mktemp; do
    command -v "$tool" >/dev/null || { echo "error: missing $tool for manifest key derivation" >&2; exit 1; }
done
[ -s "$manifest" ] || { echo "error: $manifest is missing or empty" >&2; exit 1; }
jq -e '
    .schema == "mos/meta/v1" and
    (.trust | type == "object") and
    (.trust | keys | all(. == "signingKeys" or . == "signingKeyIds")) and
    (.trust.signingKeys | type == "array" and all(type == "string" and test("^[A-Za-z0-9+/]{43}=$"))) and
    ((.trust | has("signingKeyIds") | not) or (.trust.signingKeyIds | type == "array"))
' "$manifest" >/dev/null || { echo "error: $manifest has invalid trust fields; only inline signingKeys and derived signingKeyIds are accepted" >&2; exit 1; }

key_tmp=$(mktemp)
trap 'rm -f "$key_tmp"' EXIT
ids='[]'
while IFS= read -r key; do
    if ! printf '%s' "$key" | base64 --decode > "$key_tmp"; then
        echo "error: $manifest has a signingKeys entry that is not base64" >&2
        exit 1
    fi
    if [ "$(wc -c < "$key_tmp")" -ne 32 ] || [ "$(base64 -w 0 "$key_tmp")" != "$key" ]; then
        echo "error: $manifest signingKeys must contain canonical base64 over 32-byte Ed25519 public keys" >&2
        exit 1
    fi
    key_id=$(sha256sum "$key_tmp")
    ids=$(jq --arg id "${key_id%% *}" '. + [$id]' <<< "$ids")
done < <(jq -r '.trust.signingKeys[]' "$manifest")

if ! jq -e --argjson ids "$ids" '(.trust | has("signingKeyIds") | not) or .trust.signingKeyIds == $ids' "$manifest" >/dev/null; then
    echo "error: $manifest trust.signingKeyIds does not match signingKeys; remove signingKeyIds to derive it at build time" >&2
    exit 1
fi
jq --argjson ids "$ids" '.trust.signingKeyIds = $ids' "$manifest"
