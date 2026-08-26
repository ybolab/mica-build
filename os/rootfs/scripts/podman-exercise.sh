#!/bin/sh
# Execute the engine and the Quadlet generator, rather than only installing them.
#
# Called from os/rootfs/stages/31-feature-containers.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: none.

set -eu
ran() {
    out="$("$@" 2>&1 || true)"
    case "${out}" in
    *"exec format error"*|*"not found"*|*"cannot execute"*|"")
        echo "error: $1 did not execute on arm64 under emulation. Output was: ${out:-<nothing>}" >&2; return 1;;
    esac
    printf '  %s\n' "${out}" | head -n1
}
ran podman --version | grep -q '5\.' ||
    { echo "error: podman did not report a 5.x version" >&2; exit 1; }
ran /usr/libexec/podman/netavark --version | grep -q 'netavark' ||
    { echo "error: netavark did not report its version" >&2; exit 1; }
ran /usr/libexec/podman/aardvark-dns --version | grep -q 'aardvark' ||
    { echo "error: aardvark-dns did not report its version" >&2; exit 1; }
crun_out="$(crun --version 2>&1 || true)"
case "${crun_out}" in
*"crun version"*) : ;;
*"re-execute libcrun via memory file descriptor"*)
    echo "  crun: executed; version withheld under emulation (memfd re-exec unavailable)";;
*) echo "error: crun neither reported a version nor failed the one way emulation is known to break it. Output was: ${crun_out}" >&2; exit 1;;
esac
nft_out="$(nft --version 2>&1 || true)"
case "${nft_out}" in
*"nftables v"*) : ;;
*"Unable to initialize Netlink socket"*)
    echo "  nft: executed; netlink unavailable in the build sandbox";;
*) echo "error: nft neither reported a version nor failed the one way the build sandbox is known to break it. Output was: ${nft_out}" >&2; exit 1;;
esac
printf '[engine\nruntime = \n' >/tmp/broken.conf
if ! CONTAINERS_CONF=/tmp/broken.conf podman --version 2>&1 | grep -q 'Failed to obtain podman configuration'; then
    rm -f /tmp/broken.conf
    echo "error: podman did not complain about a deliberately malformed containers.conf, so the check below cannot fail and proves nothing. Either podman stopped reading the file on this path, or the message changed" >&2; exit 1
fi
rm -f /tmp/broken.conf
if podman --version 2>&1 | grep -q 'Failed to obtain podman configuration'; then
    echo "error: podman cannot parse the image's /etc/containers/containers.conf: $(podman --version 2>&1 | head -n2)" >&2; exit 1
fi
echo "  containers.conf parses: podman reports the malformed control and accepts the shipped file"
probe=/etc/containers/systemd/mos-build-probe.container
printf '[Container]\nImage=docker.io/library/busybox\nExec=sleep 1\n[Install]\nWantedBy=multi-user.target\n' >"${probe}"
out="$(/usr/libexec/podman/quadlet --dryrun 2>&1)"
rm -f "${probe}"
printf '%s\n' "${out}" | grep -q 'mos-build-probe.service' ||
    { echo "error: Quadlet did not generate a unit for a valid .container file. The generator is installed but not doing its job, and on the device that failure is silent: the operator's file is simply ignored. Output was: ${out}" >&2; exit 1; }
printf '%s\n' "${out}" | grep -qE 'ExecStart=.*podman' ||
    { echo "error: Quadlet generated a unit whose ExecStart does not invoke podman: ${out}" >&2; exit 1; }
printf '%s\n' "${out}" | grep -q 'busybox' ||
    { echo "error: the generated unit does not name the image the .container file asked for; Quadlet parsed the file but dropped its content: ${out}" >&2; exit 1; }
echo "podman: engine and Quadlet generator exercised on arm64 — a .container file generates a podman ExecStart"
