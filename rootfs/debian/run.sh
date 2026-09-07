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
       bash rootfs/debian/run.sh configure --root PATH

The default selection is the minimal Debian bootstrap floor. --packages names
local mos packages whose locked upstream dependencies are added to that floor.
--all selects every locked runtime package. --package selects one upstream
package for cache, verify or select; it excludes the base and bootstrap helper.
select prints temporary installation rows generated from the JSON manifests.
cache downloads only missing archives and verifies their SHA256 and metadata.
It is the only command that touches the network. Set MOS_DEBIAN_MIRROR to an
https:// base to fetch through a mirror -- `<base>` or `pool:<base>` for a
mirror serving /pool, `snapshot:<base>` for a mirror of snapshot.debian.org.
The mirror is tried first and each record's own URL is the fallback; a 404 from
the mirror is normal, the committed SHA256 is checked either way, and cache
reports how many archives came from each.
verify, install and configure require no network. install requires root, a
native target architecture and an empty destination; it unpacks the bootstrap
floor and stages .debian-extra/configure.sh, which finishes the installation
FROM INSIDE the root. configure enters a prepared root with chroot and runs
that script, which only a native host can do; the composition instead runs it
in a build stage whose rootfs IS the root. No command invokes APT.

Default cache: _out/debian-base/debs/<sha256>.deb. Version, architecture, URL,
SHA256 and package consumers are recorded in rootfs/debian/packages/<name>.json.
Use docker.sh to run these commands in the repository's pinned Bun container.
USAGE
}
COMMAND=${1:---help}
case "$COMMAND" in
--help|-h) usage; exit 0 ;;
cache|verify|select|install|configure) shift ;;
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
# configure takes no --arch: it runs against a root that already IS one
# architecture, and a flag it would ignore is a flag that could disagree.
if [ "$COMMAND" = configure ]; then
    [ -z "$ARCH" ] || fail '--arch is not used by configure; the prepared root is already one architecture'
else
    [ -n "$ARCH" ] || fail '--arch is required'
    case "$ARCH" in amd64|arm64) ;; *) fail "unsupported architecture: $ARCH" ;; esac
fi
selection_count=$ALL
[ -z "$PACKAGE_FILE" ] || selection_count=$((selection_count + 1))
[ -z "$PACKAGE" ] || selection_count=$((selection_count + 1))
[ "$selection_count" -le 1 ] || fail '--all, --packages and --package are mutually exclusive'
[ "$COMMAND" != install ] || [ -z "$PACKAGE" ] || fail '--package cannot be used with install; select a complete system closure'
case "$COMMAND" in install | configure) ;; *) [ -z "$ROOT" ] || fail '--root is only valid with install and configure' ;; esac
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
if [ "$COMMAND" = configure ]; then
    [ -n "$ROOT" ] || fail 'configure requires --root'
    ROOT=$(realpath -m -- "$ROOT")
    [ "$ROOT" != / ] || fail 'configuration cannot target the host root'
    [ -f "$ROOT/.debian-extra/configure.sh" ] ||
        fail "$ROOT has no .debian-extra/configure.sh, so it is not a root that install prepared"
    need chroot
    [ "$(id -u)" -eq 0 ] || fail 'configuration requires root'
    # THE ONE CHROOT LEFT, and the failure it has is worth naming. A chroot
    # reports `No such file or directory` for a file that is demonstrably
    # present whenever the new root cannot execute anything at all, so a bare
    # failure below sends a reader after the wrong file. Probe the cheapest
    # possible exec first, and say what the root holds.
    if ! chroot "$ROOT" /bin/true 2>/dev/null; then
        echo "debian-base: a trivial exec inside $ROOT failed, so this is the root itself and not /.debian-extra/configure.sh" >&2
        echo "debian-base: /bin/sh in the root: $(ls -la "$ROOT/bin/sh" 2>&1)" >&2
        echo "debian-base: /bin/true in the root: $(ls -la "$ROOT/bin/true" 2>&1)" >&2
        echo "debian-base: this process runs under: $(tr '\0' ' ' </proc/self/cmdline 2>/dev/null)" >&2
        echo "debian-base: PID 1 here runs: $(readlink /proc/1/exe 2>&1)" >&2
        # The measured cause, so the next reader does not spend a day on the
        # file name in the message. If PID 1 above is a qemu emulator, this
        # process is emulated: buildkit runs a foreign-architecture step by
        # prepending that emulator, and the emulator implements execve by
        # re-executing itself through /proc/self/exe. chroot puts an empty
        # $ROOT/proc under that path, the re-exec fails, and the kernel
        # reports ENOENT for the BINARY. Staging the emulator inside the root
        # does not help; only /proc does, and a RUN step has no CAP_SYS_ADMIN
        # to mount it. Enter the root as a build stage instead of chrooting.
        echo "debian-base: if PID 1 is a qemu emulator, nothing can be chrooted into from here; run /.debian-extra/configure.sh in a build stage whose rootfs IS the root" >&2
    fi
    exec chroot "$ROOT" /bin/sh /.debian-extra/configure.sh
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
# The two mirror layouts, which cut the canonical URL at different points.
# Prints the mirror URL for a record, or returns 1 when this mirror has no URL
# for it and the pin must be fetched as written.
#   pool     a live Debian mirror serving /pool -- <base>/pool/<path>. It
#            carries the CURRENT pool, so a pin some newer upload has
#            superseded is simply not in it. That 404 is the entire reason the
#            fallback exists, and the older the snapshot the more pins take it.
#   snapshot a mirror of snapshot.debian.org, which keeps /archive/debian/
#            <SNAPSHOT>/ -- only the host is replaced, each record's own
#            snapshot is preserved, and every pin resolves. The bootstrap
#            helper is the one exception either way: its URL names
#            deb.debian.org and carries no snapshot, so a snapshot-shaped
#            mirror has nothing to rewrite and it falls back, once.
mirror_url() {
    case "$MIRROR_KIND" in
    pool) case "$1" in
        */pool/*) printf '%s/pool/%s' "$MIRROR_BASE" "${1#*/pool/}" ;;
        *) return 1 ;;
        esac ;;
    snapshot) case "$1" in
        https://snapshot.debian.org/*) printf '%s/%s' "$MIRROR_BASE" "${1#https://snapshot.debian.org/}" ;;
        *) return 1 ;;
        esac ;;
    *) return 1 ;;
    esac
}
if [ "$COMMAND" = cache ]; then
    need flock
    # THE ONLY COMMAND THAT DOWNLOADS, and therefore the only one that reads
    # MOS_DEBIAN_MIRROR. A mirror is a fetch-time detail and never a fact about
    # a package: it rewrites the PREFIX of a record's URL and leaves the record
    # alone, so packages/<name>.json keeps stating which snapshot and which pool
    # path the pin came from. There is no mirror in the committed defaults;
    # unset, everything below is what it has always been.
    MIRROR_KIND= MIRROR_BASE=
    if [ -n "${MOS_DEBIAN_MIRROR:-}" ]; then
        case "$MOS_DEBIAN_MIRROR" in
        pool:https://*) MIRROR_KIND=pool; MIRROR_BASE=${MOS_DEBIAN_MIRROR#pool:} ;;
        snapshot:https://*) MIRROR_KIND=snapshot; MIRROR_BASE=${MOS_DEBIAN_MIRROR#snapshot:} ;;
        https://*) MIRROR_KIND=pool; MIRROR_BASE=$MOS_DEBIAN_MIRROR ;;
        *) fail "MOS_DEBIAN_MIRROR must be an https:// base, optionally prefixed with pool: or snapshot: -- got $MOS_DEBIAN_MIRROR" ;;
        esac
        MIRROR_BASE=${MIRROR_BASE%/}
    fi
    mkdir -p "$CACHE_DIR/debs"
    exec 9>"$CACHE_DIR/.lock"
    flock -x 9
    WORK=$(mktemp -d "$CACHE_DIR/.download.XXXXXX")
    downloaded=0 from_mirror=0 from_pin=0
    while IFS=$'\t' read -r name version arch sha url consumers; do
        if [ ! -e "$CACHE_DIR/debs/$sha.deb" ]; then
            need bun
            source_url= status=0
            if [ -n "$MIRROR_KIND" ] && mirror=$(mirror_url "$url"); then
                bun "$HERE/fetch.ts" "$mirror" "$WORK/$sha.deb" || status=$?
                case "$status" in
                0) source_url=$mirror; from_mirror=$((from_mirror + 1)) ;;
                # A pin the mirror does not carry. Expected, not an error --
                # see mirror_url. The pin itself still has to be satisfied.
                44) ;;
                *) fail "mirror download failed for $name: $mirror" ;;
                esac
            fi
            if [ -z "$source_url" ]; then
                status=0
                bun "$HERE/fetch.ts" "$url" "$WORK/$sha.deb" || status=$?
                [ "$status" = 0 ] || fail "download failed for $name: $url"
                source_url=$url
                from_pin=$((from_pin + 1))
            fi
            # THE ANCHOR, and it sits here whichever host answered. That is the
            # whole reason fetching from anywhere is sound. A mirror whose bytes
            # do not match the pin is a WRONG MIRROR, not a reason to quietly go
            # somewhere else: this fails, and the message names the URL that
            # produced the bytes.
            [ "$(sha256sum "$WORK/$sha.deb" | cut -d' ' -f1)" = "$sha" ] || fail "SHA256 mismatch downloading $name from $source_url"
            mv "$WORK/$sha.deb" "$CACHE_DIR/debs/$sha.deb"
            downloaded=$((downloaded + 1))
        fi
    done <<<"$ARCHIVES"
    verify_cache
    split=
    # A configured mirror reports its split unconditionally, including 0/0.
    # Falling back is silent per archive by design, and a run that reported only
    # a total could not tell a working mirror from a decorative one.
    [ -z "$MIRROR_KIND" ] || split=" ($from_mirror from the mirror, $from_pin from the pinned URL)"
    echo "debian-base: verified $(printf '%s\n' "$SELECTED" | wc -l) packages; downloaded $downloaded archives$split; cache $CACHE_DIR"
    if [ -n "$MIRROR_KIND" ] && [ "$from_mirror" = 0 ] && [ "$from_pin" -gt 0 ]; then
        echo "debian-base: warning: $MIRROR_BASE served none of the $from_pin archive(s) downloaded; it is configured and doing nothing" >&2
    fi
    exit 0
fi
verify_cache
if [ "$COMMAND" = verify ]; then
    echo "debian-base: verified $(printf '%s\n' "$SELECTED" | wc -l) packages in $CACHE_DIR"
    exit 0
fi
for tool in dpkg flock tar; do need "$tool"; done
[ "$(id -u)" -eq 0 ] || fail 'installation requires root'
# The architecture of the CONTAINER, which under buildx is the target one -- an
# arm64 stage on this amd64 host answers arm64 and passes. That is correct for
# what follows: nothing here executes a target binary, and the step that does
# (configure.sh) runs where the root is already `/`.
[ "$(dpkg --print-architecture)" = "$ARCH" ] || fail "installation requires a native $ARCH host"

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
mkdir "$ROOT/.debian-extra"
cp "$HERE/configure.sh" "$HERE/install.sh" "$ROOT/.debian-extra/"
cp "$CACHE_DIR/debs/$helper_sha.deb" "$ROOT/.debian-extra/helper.deb"
: >"$ROOT/.debian-extra/extras.list"
extras=0
while IFS=$'\t' read -r name version arch sha url consumers; do
    case ",$consumers," in *,base,*) continue ;; esac
    cp "$CACHE_DIR/debs/$sha.deb" "$ROOT/.debian-extra/$sha.deb"
    printf '/.debian-extra/%s.deb\n' "$sha" >>"$ROOT/.debian-extra/extras.list"
    extras=$((extras + 1))
done <<<"$SELECTED"
# The inventory configure.sh will hold the finished root to, written here
# because this is where the lock is: nothing inside the root can re-derive it
# without a JSON runtime, which is the whole reason manifest.ts stays out here.
awk -F '\t' 'BEGIN { OFS="\t" } { print $1,$2,$3,"installed" }' <<<"$SELECTED" |
    sort >"$ROOT/.debian-extra/expected.tsv"
echo "debian-base: unpacked the bootstrap floor into $ROOT and staged $extras further archive(s)"
echo "debian-base: the root is NOT configured yet -- run /.debian-extra/configure.sh inside it (\`run.sh configure --root $ROOT\`, or a build stage whose rootfs is this tree)"
