#!/usr/bin/env bash
# Cache exact package locks and bootstrap a minimal dpkg-managed root offline.
# mos-build-side: container -- docker.sh and BuildKit run package tools.
set -euo pipefail
export LC_ALL=C
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
WORK=
trap '[ -z "$WORK" ] || rm -rf "$WORK"' EXIT
fail() { echo "debian-base: error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "required tool is missing: $1"; }
usage() {
    cat <<'USAGE'
usage: bash rootfs/debian/run.sh cache|verify|select|install --arch amd64|arm64
       [--cache-dir PATH] [--packages FILE | --all | --package NAME] [--root PATH]

The default selection is the minimal Debian bootstrap floor. --packages names
local mos packages whose locked upstream dependencies are added to that floor.
--all selects every locked runtime package. --package selects one upstream
package for cache, verify or select; it excludes the base and bootstrap helper.
select prints temporary installation rows generated from the JSON manifests.
cache downloads only missing archives and verifies their SHA256 and metadata.
verify and install require no network. install requires root, a native target
architecture and an empty destination. No command invokes APT.

Default cache: _out/debian-base/debs/<sha256>.deb. Version, architecture, URL,
SHA256 and package consumers are recorded in rootfs/debian/packages/<name>.json.
Use docker.sh to run these commands in the repository's pinned Bun container.
USAGE
}
COMMAND=${1:---help}
case "$COMMAND" in
--help|-h) usage; exit 0 ;;
cache|verify|select|install) shift ;;
*) fail "unknown command: $COMMAND" ;;
esac
ARCH= ROOT= PACKAGE_FILE= PACKAGE= ALL=0
CACHE_DIR=$REPO_ROOT/_out/debian-base
while [ "$#" -gt 0 ]; do
    case "$1" in
    --arch|--cache-dir|--packages|--package|--root)
        [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || fail "$1 requires a value"
        case "$1" in
        --arch) ARCH=$2 ;; --cache-dir) CACHE_DIR=$2 ;;
        --packages) PACKAGE_FILE=$2 ;; --package) PACKAGE=$2 ;; --root) ROOT=$2 ;;
        esac
        shift 2 ;;
    --all) ALL=1; shift ;;
    *) fail "unknown option: $1" ;;
    esac
done
[ -n "$ARCH" ] || fail '--arch is required'
case "$ARCH" in amd64|arm64) ;; *) fail "unsupported architecture: $ARCH" ;; esac
selection_count=$ALL
[ -z "$PACKAGE_FILE" ] || selection_count=$((selection_count + 1))
[ -z "$PACKAGE" ] || selection_count=$((selection_count + 1))
[ "$selection_count" -le 1 ] || fail '--all, --packages and --package are mutually exclusive'
[ "$COMMAND" != install ] || [ -z "$PACKAGE" ] || fail '--package cannot be used with install; select a complete system closure'
[ "$COMMAND" = install ] || [ -z "$ROOT" ] || fail '--root is only valid with install'
CACHE_DIR=$(realpath -m -- "$CACHE_DIR")
[ "$CACHE_DIR" != / ] || fail 'cache directory cannot be the host root'
if [ "$COMMAND" = install ]; then
    [ -n "$ROOT" ] || fail 'install requires --root'
    ROOT=$(realpath -m -- "$ROOT")
    [ "$ROOT" != / ] || fail 'installation cannot target the host root'
    if [ -e "$ROOT" ]; then
        [ -d "$ROOT" ] && [ -z "$(ls -A -- "$ROOT")" ] || fail 'installation root must be empty'
    fi
    case "$CACHE_DIR/" in "$ROOT/"*) fail 'installation root cannot contain the cache' ;; esac
    case "$ROOT/" in "$CACHE_DIR/"*) fail 'installation root cannot be inside the cache' ;; esac
fi
. "$HERE/sources.env"
need bun
mode=base
selection=
if [ "$ALL" = 1 ]; then mode=all; fi
if [ -n "$PACKAGE_FILE" ]; then mode=consumers; selection=$PACKAGE_FILE; fi
if [ -n "$PACKAGE" ]; then mode=package; selection=$PACKAGE; fi
SELECTED=$(bun "$HERE/manifest.ts" runtime "$ARCH" "$mode" "$selection")
if [ "$COMMAND" = select ]; then printf '%s\n' "$SELECTED"; exit 0; fi
need sha256sum
need dpkg-deb
HELPER=
if [ -z "$PACKAGE" ]; then HELPER=$(bun "$HERE/manifest.ts" helper); fi
IFS=$'\t' read -r helper_name helper_version helper_arch helper_sha helper_url <<<"$HELPER"
ARCHIVES=$SELECTED
if [ -n "$HELPER" ]; then ARCHIVES=$(printf '%s\n%s' "$HELPER" "$SELECTED"); fi
verify_cache() {
    bash "$HERE/verify.sh" "$CACHE_DIR" <<<"$ARCHIVES"
}
if [ "$COMMAND" = cache ]; then
    need flock
    mkdir -p "$CACHE_DIR/debs"
    exec 9>"$CACHE_DIR/.lock"
    flock -x 9
    WORK=$(mktemp -d "$CACHE_DIR/.download.XXXXXX")
    downloaded=0
    while IFS=$'\t' read -r name version arch sha url consumers; do
        if [ ! -e "$CACHE_DIR/debs/$sha.deb" ]; then
            need bun
            bun "$HERE/fetch.ts" "$url" "$WORK/$sha.deb"
            [ "$(sha256sum "$WORK/$sha.deb" | cut -d' ' -f1)" = "$sha" ] || fail "SHA256 mismatch downloading $name"
            mv "$WORK/$sha.deb" "$CACHE_DIR/debs/$sha.deb"
            downloaded=$((downloaded + 1))
        fi
    done <<<"$ARCHIVES"
    verify_cache
    echo "debian-base: verified $(printf '%s\n' "$SELECTED" | wc -l) packages; downloaded $downloaded archives; cache $CACHE_DIR"
    exit 0
fi
verify_cache
if [ "$COMMAND" = verify ]; then
    echo "debian-base: verified $(printf '%s\n' "$SELECTED" | wc -l) packages in $CACHE_DIR"
    exit 0
fi
for tool in dpkg chroot flock tar; do need "$tool"; done
[ "$(id -u)" -eq 0 ] || fail 'installation requires root'
[ "$(dpkg --print-architecture)" = "$ARCH" ] || fail "installation requires a native $ARCH host"
# EMULATED CROSS-BUILDS CHROOT INTO A ROOT THE INTERPRETER IS NOT IN.
#
# `dpkg --print-architecture` above answers the CONTAINER's architecture, which
# under buildx is the target one -- so an arm64 stage on this amd64 host passes
# the native check and is in fact running every binary through an interpreter
# registered in binfmt_misc, at a path outside the root about to be chrooted
# into (buildkit's is /dev/.buildkit_qemu_emulator). The kernel then cannot open
# the interpreter and reports ENOENT for the BINARY, so the failure reads
# `chroot: failed to run command '/debootstrap/debootstrap': No such file or
# directory` about a file that is demonstrably there.
#
# Staging the interpreter inside the root for the duration of the chroot is the
# whole fix. Registrations carrying binfmt_misc's `F` flag need none of this --
# the kernel holds the interpreter open -- so this stages only what exists and
# is a no-op on a native host, where no registration names an interpreter the
# root is missing.
EMULATORS=()
stage_emulators() {
    local interp staged=0
    # Two sources, because neither alone covers this project's two routes.
    #
    # binfmt_misc names the interpreter on a host that registered one -- but it
    # is not mounted inside a buildkit step, so scanning only this finds
    # nothing and finds it SILENTLY, which is how the first version of this
    # function shipped a no-op and the chroot failed exactly as before.
    #
    # buildkit injects its own emulator at a fixed path into the step's rootfs
    # instead, and that is the route this repository actually cross-builds
    # through: the docker daemon here cannot exec arm64 at all, so arm64 stages
    # run in the `mos-arm64` docker-container builder, which bundles it.
    for interp in $(binfmt_interpreters) /dev/.buildkit_qemu_emulator; do
        [ -f "$interp" ] || continue
        [ ! -e "$ROOT$interp" ] || continue
        mkdir -p "$ROOT$(dirname "$interp")"
        cp "$interp" "$ROOT$interp" || fail "could not stage the binfmt interpreter $interp into $ROOT"
        EMULATORS+=("$ROOT$interp")
        staged=$((staged + 1))
        echo "debian-base: staged the binfmt interpreter $interp into the root for the chroot"
    done
    # Silence is not a result. A run that staged nothing says so, so that the
    # next confusing chroot ENOENT can be read against a line that states
    # whether this ran and found nothing or never looked.
    [ "$staged" -gt 0 ] ||
        echo "debian-base: no binfmt interpreter to stage; the chroot runs natively"
}
binfmt_interpreters() {
    local reg
    [ -d /proc/sys/fs/binfmt_misc ] || return 0
    for reg in /proc/sys/fs/binfmt_misc/*; do
        [ -f "$reg" ] || continue
        case "$reg" in */register | */status) continue ;; esac
        awk '/^interpreter /{print $2; exit}' "$reg" 2>/dev/null || true
    done
}
unstage_emulators() {
    [ "${#EMULATORS[@]}" -gt 0 ] || return 0
    rm -f "${EMULATORS[@]}"
    EMULATORS=()
}
# Both, in one handler: the EXIT trap set at the top of this file cleans $WORK,
# and a second `trap ... EXIT` REPLACES it rather than adding to it. A staged
# interpreter that outlived this script would be copied into the image by the
# Dockerfile stage that consumes $ROOT, so it has to come off here -- and the
# temp directory still has to go.
trap 'unstage_emulators; [ -z "$WORK" ] || rm -rf "$WORK"' EXIT

WORK=$(mktemp -d "${TMPDIR:-/tmp}/debian-base-install.XXXXXX")
dpkg-deb -x "$CACHE_DIR/debs/$helper_sha.deb" "$WORK/helper"
export DEBOOTSTRAP_DIR=$WORK/helper/usr/share/debootstrap
BOOTSTRAP=$WORK/helper/usr/sbin/debootstrap
# debootstrap checks for wget even when every download phase is disabled.
# A refusing shim satisfies that presence check and makes any download a failure.
mkdir "$WORK/bin"
printf '#!/bin/sh\necho "offline bootstrap attempted a download" >&2\nexit 97\n' >"$WORK/bin/wget"
chmod 755 "$WORK/bin/wget"
export PATH=$WORK/bin:$PATH
stage=$WORK/archive
mkdir -p "$stage/debootstrap" "$stage/var/cache/apt/archives" "$stage/var/lib/apt/lists"
# This is debootstrap's apt_dest index filename; no APT program is used.
index=$stage/var/lib/apt/lists/$(printf '%s' "${MIRROR#https://}/dists/$SUITE/main/binary-$ARCH/Packages" | tr / _)
touch "$stage/debootstrap/base" "$stage/debootstrap/required" "$stage/debootstrap/debpaths" "$index"
while IFS=$'\t' read -r name version arch sha url consumers; do
    case ",$consumers," in *,base,*) ;; *) continue ;; esac
    cp "$CACHE_DIR/debs/$sha.deb" "$stage/var/cache/apt/archives/$sha.deb"
    printf '%s\n' "$name" >>"$stage/debootstrap/required"
    printf '%s var/cache/apt/archives/%s.deb\n' "$name" "$sha" >>"$stage/debootstrap/debpaths"
    dpkg-deb -f "$CACHE_DIR/debs/$sha.deb" >>"$index"
    printf '\n' >>"$index"
done <<<"$SELECTED"
tar -cf "$WORK/base.tar" -C "$stage" debootstrap var
mkdir -p "$ROOT"
exec 8<"$ROOT"
flock -n 8 || fail "another installation is using $ROOT"
[ -z "$(ls -A -- "$ROOT")" ] || fail 'installation root must be empty'
bash "$BOOTSTRAP" --arch="$ARCH" --variant=minbase --exclude=apt --no-check-gpg \
    --unpack-tarball="$WORK/base.tar" --foreign "$SUITE" "$ROOT" "$MIRROR" ||
    fail "bootstrap extraction failed; inspect $ROOT/debootstrap/debootstrap.log"
stage_emulators
# The chroot below fails as `No such file or directory` for a file that is
# demonstrably present whenever the interpreter cannot be resolved inside the
# new root, so a bare failure here sends a reader after the wrong file. Probe
# the cheapest possible exec first and report what the root actually holds.
if ! chroot "$ROOT" /bin/true 2>/dev/null; then
    echo "debian-base: a trivial exec inside $ROOT failed; this is the interpreter, not /debootstrap/debootstrap" >&2
    echo "debian-base: /bin/sh in the root: $(ls -la "$ROOT/bin/sh" 2>&1)" >&2
    for e in "${EMULATORS[@]}"; do
        echo "debian-base: staged interpreter: $(ls -la "$e" 2>&1)" >&2
    done
    echo "debian-base: interpreters binfmt_misc names: $(binfmt_interpreters | tr '\n' ' ')" >&2
    echo "debian-base: this process runs under: $(tr '\0' ' ' </proc/self/cmdline 2>/dev/null)" >&2
    echo "debian-base: /bin/true in the root: $(ls -la "$ROOT/bin/true" 2>&1)" >&2
    # The decisive one. If the staged interpreter runs INSIDE the chroot, the
    # interpreter is resolvable and the failure is something else; if it does
    # not, staging is not enough and the emulated route needs a different shape.
    for e in "${EMULATORS[@]}"; do
        echo "debian-base: interpreter inside the chroot: $(chroot "$ROOT" "${e#"$ROOT"}" -version 2>&1 | head -2)" >&2
    done
fi
env -u DEBOOTSTRAP_DIR ARCH_ALL_SUPPORTED=0 chroot "$ROOT" /debootstrap/debootstrap --second-stage ||
    fail "dpkg configuration failed; inspect $ROOT/debootstrap/debootstrap.log"
mkdir "$ROOT/.debian-extra"
extras=()
while IFS=$'\t' read -r name version arch sha url consumers; do
    case ",$consumers," in *,base,*) continue ;; esac
    cp "$CACHE_DIR/debs/$sha.deb" "$ROOT/.debian-extra/$sha.deb"
    extras+=("/.debian-extra/$sha.deb")
done <<<"$SELECTED"
if [ "${#extras[@]}" -gt 0 ]; then
    printf '#!/bin/sh\nexit 101\n' >"$ROOT/usr/sbin/policy-rc.d"
    chmod 755 "$ROOT/usr/sbin/policy-rc.d"
    cp "$HERE/install.sh" "$ROOT/.debian-extra/install.sh"
    cp "$CACHE_DIR/debs/$helper_sha.deb" "$ROOT/.debian-extra/helper.deb"
    chroot "$ROOT" bash /.debian-extra/install.sh /.debian-extra/helper.deb "${extras[@]}"
    rm "$ROOT/usr/sbin/policy-rc.d"
fi
rm -rf "$ROOT/.debian-extra"
audit=$(chroot "$ROOT" dpkg --audit 2>&1) || fail "dpkg --audit failed: $audit"
[ -z "$audit" ] || fail "dpkg --audit reported: $audit"
chroot "$ROOT" dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n' | sort >"$WORK/installed.tsv"
awk -F '\t' 'BEGIN { OFS="\t" } { print $1,$2,$3,"installed" }' <<<"$SELECTED" | sort >"$WORK/expected.tsv"
diff -u "$WORK/expected.tsv" "$WORK/installed.tsv" || fail 'installed package set differs from the lock'
[ ! -e "$ROOT/usr/bin/apt" ] && [ ! -e "$ROOT/usr/bin/apt-get" ] || fail 'APT was installed unexpectedly'
echo "debian-base: installed $(wc -l <"$WORK/installed.tsv") locked packages into $ROOT using dpkg"
