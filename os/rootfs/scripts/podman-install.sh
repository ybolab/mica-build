#!/bin/sh
# Install the seven self-built container-engine binaries and the Quadlet generator.
#
# Called from os/rootfs/stages/31-feature-containers.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: none.
#
# The `if [ "$WITH_CONTAINERS" != "1" ]; then rm -rf /tmp/podman; exit 0; fi`
# that opened this file is gone with the argument (RFCT-111 M5c): the stage is
# the switch, so running at all means the engine was asked for.

set -eu
for b in podman quadlet crun conmon netavark aardvark-dns catatonit; do
    if [ ! -f "/tmp/podman/${b}" ]; then
        echo "error: ${b} is not in the staged os/podman output. This chain includes stages/31-feature-containers, which asks for an engine, and no engine was built; run 'make podman' first, or leave the stage out with --without containers. Continuing would produce an image that boots, reports itself healthy, and cannot run a container" >&2; exit 1
    fi
done
install -d -m0755 /usr/libexec/podman
install -m0755 /tmp/podman/podman /usr/bin/podman
install -m0755 /tmp/podman/crun   /usr/bin/crun
for b in quadlet conmon netavark aardvark-dns catatonit; do
    install -m0755 "/tmp/podman/${b}" "/usr/libexec/podman/${b}"
done
install -d -m0755 /etc/containers/systemd
install -d -m0755 /usr/lib/systemd/system-generators
ln -sf ../../../libexec/podman/quadlet \
    /usr/lib/systemd/system-generators/podman-system-generator
rm -rf /tmp/podman
echo "podman: seven self-built binaries installed"
