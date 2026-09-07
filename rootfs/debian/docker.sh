#!/usr/bin/env bash
# Keep runtime-package tools in Docker and reusable archives on the build host.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
fail() { echo "debian-base: error: $*" >&2; exit 1; }
host_path() { case "$1" in /work/*) echo "/srv/station/work/${1#/work/}";; /root/*) echo "/srv/station/root/${1#/root/}";; *) echo "$1";; esac; }
COMMAND=${1:---help}
case "$COMMAND" in --help|-h) exec bash "$HERE/run.sh" --help;; cache|verify|select|install) shift;; *) fail "unknown command: $COMMAND";; esac
ARCH= ROOT= PACKAGES= PACKAGE= ALL=0
CACHE=$REPO_ROOT/_out/debian-base
while [ "$#" -gt 0 ]; do
    case "$1" in
    --arch|--root|--cache-dir|--packages|--package)
        [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || fail "$1 requires a value"
        case "$1" in --arch) ARCH=$2;; --root) ROOT=$2;; --cache-dir) CACHE=$2;; --packages) PACKAGES=$2;; --package) PACKAGE=$2;; esac
        shift 2;;
    --all) ALL=1; shift;;
    *) fail "unknown option: $1";;
    esac
done
case "$ARCH" in amd64|arm64) ;; *) fail '--arch must be amd64 or arm64';; esac
[ "$COMMAND" != install ] || [ -z "$PACKAGE" ] || fail '--package cannot be used with install'
[ "$COMMAND" = install ] || [ -z "$ROOT" ] || fail '--root is only valid with install'
CACHE=$(realpath -m -- "$CACHE")
[ "$CACHE" != / ] || fail 'cache directory cannot be the host root'
case "$(host_path "$CACHE")" in
/srv|/srv/station|/srv/station/work|/work|/root) fail 'cache must use a project-scoped directory';;
esac
if [ "$COMMAND" = install ]; then
    [ -n "$ROOT" ] || fail 'install requires --root'
    ROOT=$(realpath -m -- "$ROOT")
    [ "$ROOT" != / ] || fail 'installation cannot target the host root'
    if [ -e "$ROOT" ]; then
        [ -d "$ROOT" ] && [ -z "$(ls -A -- "$ROOT")" ] || fail 'installation root must be empty'
    fi
    case "$CACHE/" in "$ROOT/"*) fail 'installation root cannot contain the cache';; esac
    case "$ROOT/" in "$CACHE/"*) fail 'installation root cannot be inside the cache';; esac
fi
command -v docker >/dev/null || fail 'docker is required'
IMAGE=$(bash "$REPO_ROOT/build-env/from.sh" --ref IMAGE_BUN_1)
network=none
cache_mode=ro
# MOS_DEBIAN_MIRROR crosses into the container ONLY here. Every other command
# runs with --network none and could not fetch through a mirror if it wanted
# to; not handing it the variable says so at the boundary rather than relying
# on run.sh reading it in one branch.
docker_env=()
if [ "$COMMAND" = cache ]; then
    mkdir -p "$CACHE"; network=traefik; cache_mode=rw
    [ -z "${MOS_DEBIAN_MIRROR:-}" ] || docker_env+=(-e "MOS_DEBIAN_MIRROR=$MOS_DEBIAN_MIRROR")
fi
[ -d "$CACHE" ] || [ "$COMMAND" = select ] || fail "cache is missing: $CACHE"
mounts=(-v "$(host_path "$HERE"):/mos/rootfs/debian:ro")
[ ! -d "$CACHE" ] || mounts+=(-v "$(host_path "$CACHE"):/cache:$cache_mode")
args=(--arch "$ARCH" --cache-dir /cache)
if [ -n "$PACKAGES" ]; then
    PACKAGES=$(realpath -e -- "$PACKAGES")
    [ -f "$PACKAGES" ] || fail 'package selection must be a file'
    mounts+=(-v "$(host_path "$PACKAGES"):/selection.pkgs:ro")
    args+=(--packages /selection.pkgs)
fi
[ "$ALL" = 0 ] || args+=(--all)
[ -z "$PACKAGE" ] || args+=(--package "$PACKAGE")
run() {
    docker run --rm --label ai-agent=true --network "$network" \
        ${docker_env[@]+"${docker_env[@]}"} "${mounts[@]}" \
        "$IMAGE" /bin/bash /mos/rootfs/debian/run.sh "$@"
}
if [ "$COMMAND" = install ]; then
    # Refuse invalid inputs before creating the caller's destination.
    run verify "${args[@]}"
    mkdir -p "$ROOT"
    mounts+=(-v "$(host_path "$ROOT"):/target")
    args+=(--root /target)
    run "$COMMAND" "${args[@]}"
    # `install` unpacks and stages; the root still has to be ENTERED for dpkg to
    # configure it. Here that is a chroot, which is exactly what this route can
    # afford: run.sh has already refused a non-native architecture, so nothing
    # in the root goes through an emulator. The composition cannot use it and
    # does not -- see rootfs/compose/10-compose.Dockerfile.
    run configure --root /target
    exit 0
fi
run "$COMMAND" "${args[@]}"
