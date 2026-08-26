#!/usr/bin/env bash
# Is the OCI export of the factory root the same tree as the image that ships?
#
#   bash os/tests/factory-root-gate/gate.sh _out/x64
#
# THIS HAS NO `make` TARGET, DELIBERATELY. RFCT-113 M7a wrote it and used it to
# take the measurements in os/rootfs/stages/README.md; M7c owns the gate and
# decides whether it gets a target or whether the README recipe suffices and
# this directory goes. README.md here states the decision in full. A committed
# script nothing runs is worse than no script -- so if you are reading this
# because it has sat here unrun, that is the thing to fix.
#
# WHY A CONTAINER. Neither side of the comparison is readable on the build host:
# there is no unsquashfs and no getcap. os/verify/src/tools.ts answers the same
# problem the same way, and this uses ITS image key and ITS package list, so a
# difference here cannot be a difference between two versions of squashfs-tools.
#
# WHY IT ALWAYS RUNS mutate.sh. Four of inner.sh's five comparisons had only
# ever been seen agreeing, and the capability one had nothing behind it at all --
# this root carries no file capabilities, so it compared an empty file with an
# empty file and reported agreement. A comparison nobody has watched fail is not
# a check, so proving each one can fail is part of the gate rather than a thing
# to remember to do.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
for anchor in "${HERE}/inner.sh" "${HERE}/mutate.sh" "${REPO}/os/build-env/from.sh"; do
    [ -e "${anchor}" ] || {
        echo "error: ${anchor} does not exist." >&2
        echo "       This script computed HERE=${HERE} and REPO=${REPO} from its own location;" >&2
        echo "       either this directory moved and that arithmetic is stale, or the anchor did." >&2
        exit 1
    }
done

out="${1:-_out/x64}"
[ -d "${out}" ] || {
    echo "error: ${out} is not a directory. Build a root first:" >&2
    echo "         MOS_BOARD=x64 bash os/rootfs/build-v2.sh" >&2
    exit 1
}
out="$(cd "${out}" && pwd)"
work="${2:-${out}/gate-work}"

# Resolved before the container starts rather than inside it: a key that does
# not resolve is a question about os/build-env/images.env, and answering it from
# inside a container nobody could start is two problems instead of one.
image="$(bash "${REPO}/os/build-env/from.sh" --ref IMAGE_ALPINE_3_21)"
[ -n "${image}" ] || {
    echo "error: os/build-env/from.sh --ref IMAGE_ALPINE_3_21 resolved to nothing." >&2
    echo "       That would reach docker as \`docker run \"\" ...\`, which fails with a message" >&2
    echo "       about an invalid reference and not about a missing pin." >&2
    exit 1
}
echo "gate: ${image}"
echo "gate: comparing ${out}/factory-root.oci against ${out}/rootfs-verity.img"

# The package list is os/verify/src/tools.ts's TOOL_PACKAGES, plus findutils.
# findutils is NOT decoration: alpine's busybox `find` has no -printf, and every
# inventory below is a -printf. Without it the comparison does not fail, it
# prints busybox's usage and the script dies mid-way -- which was measured.
PKGS="bash coreutils diffutils findutils squashfs-tools cryptsetup libcap libcap-setcap tar"

docker run --rm \
    -v "${REPO}:${REPO}" -w "${REPO}" \
    "${image}" \
    sh -c "apk add --no-cache -q ${PKGS} >/dev/null \
        && bash ${HERE}/inner.sh '${out}' '${work}' \
        && bash ${HERE}/mutate.sh '${work}'"
