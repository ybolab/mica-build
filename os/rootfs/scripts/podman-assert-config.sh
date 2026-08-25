#!/bin/sh
# Assert mos's own container configuration is present and is the only layer.
#
# Called from os/rootfs/Dockerfile.v2 (rootfs stage), where the reasoning lives.
# Build arguments read from the environment: WITH_CONTAINERS.

if [ "$WITH_CONTAINERS" != "1" ]; then exit 0; fi
set -eu
for f in /etc/containers/policy.json /etc/containers/containers.conf \
         /etc/containers/registries.conf /etc/containers/storage.conf; do
    test -f "${f}" ||
        { echo "error: ${f} is missing from the assembled root. mos ships its own container configuration because containers-common is not installed; without this file podman silently uses a built-in default" >&2; exit 1; }
done
test ! -e /usr/share/containers/containers.conf ||
    { echo "error: /usr/share/containers/containers.conf exists. mos deliberately ships one config layer, at /etc; a second file underneath it supplies settings that reading /etc does not reveal" >&2; exit 1; }
echo "podman: mos config present at /etc/containers, no second layer under /usr/share"
