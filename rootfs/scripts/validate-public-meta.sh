#!/usr/bin/env bash
set -euo pipefail

[ "$#" -eq 1 ] || {
    echo 'error: validate-public-meta.sh requires one public metadata directory' >&2
    exit 2
}

meta_dir=$1
while [ "$meta_dir" != / ] && [ "${meta_dir%/}" != "$meta_dir" ]; do
    meta_dir=${meta_dir%/}
done
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)

[ -d "$meta_dir" ] && [ ! -L "$meta_dir" ] || {
    echo 'error: public metadata directory is missing or is a symlink' >&2
    exit 1
}

shopt -s dotglob nullglob
for entry in "$meta_dir"/*; do
    name=${entry##*/}
    case "$name" in
    updates | GENERATED) ;;
    *)
        printf 'error: unexpected public metadata entry: %q\n' "$name" >&2
        exit 1
        ;;
    esac
done

[ -d "$meta_dir/updates" ] && [ ! -L "$meta_dir/updates" ] || {
    echo 'error: updates must be a regular non-symlink directory' >&2
    exit 1
}

for entry in "$meta_dir/updates"/*; do
    name=${entry##*/}
    [ "$name" = manifest.json ] || {
        printf 'error: unexpected public metadata entry: %q\n' "updates/$name" >&2
        exit 1
    }
done

manifest="$meta_dir/updates/manifest.json"
[ -f "$manifest" ] && [ ! -L "$manifest" ] || {
    echo 'error: updates/manifest.json is missing or is not a regular non-symlink file' >&2
    exit 1
}
[ -s "$manifest" ] || {
    echo 'error: updates/manifest.json is empty' >&2
    exit 1
}

marker="$meta_dir/GENERATED"
if [ -e "$marker" ] || [ -L "$marker" ]; then
    [ -f "$marker" ] && [ ! -L "$marker" ] || {
        echo 'error: GENERATED is not a regular non-symlink file' >&2
        exit 1
    }
fi

for relative in updates/manifest.json GENERATED; do
    file="$meta_dir/$relative"
    [ -e "$file" ] || continue
    if LC_ALL=C grep -aE 'BEGIN [^-[:cntrl:]]*PRIVATE KEY|"privateKey"|"private_key"' "$file" >/dev/null; then
        echo "error: $relative contains private key material" >&2
        exit 1
    fi
done

docker_cli=${MOS_BUILD_DOCKER:-docker}
command -v "$docker_cli" >/dev/null || {
    echo "error: public metadata validation requires the configured Docker CLI: $docker_cli" >&2
    exit 1
}
bun_image=$(bash "$repo_root/build-env/from.sh" --ref IMAGE_BUN_1)
"$docker_cli" run --rm --label ai-agent=true --network traefik -i "$bun_image" bun -e '
const filename = "updates/manifest.json"
const fail = (path, reason) => {
  console.error(`error: ${filename}: ${path}: ${reason}`)
  process.exit(1)
}
const safeKey = key => /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)
const keyPath = (path, key) => `${path}.${safeKey(key)}`
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value)
const exactObject = (value, path, keys) => {
  if (!isObject(value)) fail(path, "must be an object")
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(keyPath(path, key), "required key is missing")
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(keyPath(path, key), "unknown key")
  }
}
const string = (value, path) => {
  if (typeof value !== "string") fail(path, "must be a string")
}
const nullableString = (value, path) => {
  if (value !== null && typeof value !== "string") fail(path, "must be a string or null")
}

const text = await Bun.stdin.text()
let intervalSource
let document
try {
  document = JSON.parse(text, (key, value, context) => {
    if (key === "checkIntervalMinutes" && typeof value === "number") intervalSource = context?.source
    return value
  })
} catch {
  fail("document", "invalid JSON")
}

exactObject(document, "manifest", ["schema", "product", "update", "http", "fleet"])
exactObject(document.product, "product", ["vendor", "model"])
exactObject(document.update, "update", ["source", "channel", "policy", "checkIntervalMinutes"])
exactObject(document.http, "http", ["credentialHosts"])
exactObject(document.fleet, "fleet", ["enabled", "url"])

if (document.schema !== "mos/meta/v1") fail("schema", "must equal the current schema mos/meta/v1")
string(document.product.vendor, "product.vendor")
string(document.product.model, "product.model")
nullableString(document.update.source, "update.source")
string(document.update.channel, "update.channel")
if (document.update.channel.trim() === "") fail("update.channel", "must not be empty")
if (!["off", "check", "auto"].includes(document.update.policy)) {
  fail("update.policy", "must be one of off, check, or auto")
}
if (typeof document.update.checkIntervalMinutes !== "number"
    || !/^(0|[1-9][0-9]*)$/.test(intervalSource ?? "")) {
  fail("update.checkIntervalMinutes", "must be a non-negative integer")
}
if (BigInt(intervalSource) > 18446744073709551615n) {
  fail("update.checkIntervalMinutes", "must fit the unsigned 64-bit range")
}
if (!Array.isArray(document.http.credentialHosts)) fail("http.credentialHosts", "must be an array")
for (let index = 0; index < document.http.credentialHosts.length; index += 1) {
  string(document.http.credentialHosts[index], `http.credentialHosts[${index}]`)
}
if (typeof document.fleet.enabled !== "boolean") fail("fleet.enabled", "must be a boolean")
nullableString(document.fleet.url, "fleet.url")
' < "$manifest"
