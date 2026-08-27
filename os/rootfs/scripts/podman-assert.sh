#!/bin/sh
# Assert the assembled root has no podman units, resolves every soname, and
# carries nft.
#
# Called from os/rootfs/stages/31-feature-containers.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: none.

set -eu
found="$(find /etc/systemd /usr/lib/systemd /usr/local/lib/systemd \
              -name 'podman*' -not -name 'podman-system-generator' \
              2>/dev/null || true)"
[ -z "${found}" ] ||
    { echo "error: the image contains podman systemd units, which os/pkgs/podman is not supposed to install: ${found}. The engine must be inert because nothing starts it, not because something masks it" >&2; exit 1; }
missing=""
for b in /usr/bin/podman /usr/bin/crun /usr/libexec/podman/quadlet \
         /usr/libexec/podman/conmon /usr/libexec/podman/netavark \
         /usr/libexec/podman/aardvark-dns; do
    for lib in $(ldd "${b}" 2>/dev/null | awk '/not found/{print $1}'); do
        missing="${missing} ${b}:${lib}"
    done
done
[ -z "${missing}" ] ||
    { echo "error: the loader cannot resolve these libraries in the assembled root:${missing}. Each is an exec-time failure on the device. Add the runtime package to the apt list in stages/31-feature-containers.Dockerfile, or drop the os/pkgs/podman build tag that pulls the dependency" >&2; exit 1; }
ldd /usr/libexec/podman/catatonit 2>&1 | grep -q 'not a dynamic executable' ||
    { echo "error: catatonit is dynamically linked. It is copied INTO containers as their init, where the libc is whatever the container ships" >&2; exit 1; }
ls /usr/lib/*/libsystemd.so.0 >/dev/null 2>&1 ||
    { echo "error: libsystemd.so.0 is not in the image. podman DLOPENS it by name for journald logging (go-systemd sdjournal/functions.go:37), so no NEEDED or ldd check can see this dependency -- and containers.conf sets log_driver=journald, so losing it loses container logs silently rather than failing" >&2; exit 1; }
command -v nft >/dev/null ||
    { echo "error: nft is not in the image. netavark 2.x has no iptables driver and execs nft by name off PATH; without it every container network setup fails" >&2; exit 1; }
echo "podman: no units, every soname resolves, nft present"
