#!/usr/bin/env bash
# The mos-rauc producer's PREPARE hook: build RAUC from the pinned upstream
# source for one architecture and leave its five activation files in
# MOS_DEB_STAGE, for os/build-env/deb/build.sh to hand to the packing
# Dockerfile as `bin`.
#
# THE COMPILE LIVES IN os/pkgs/rauc/, not here. os/pkgs/rauc/Dockerfile builds
# RAUC with -Dnetwork=false -Dstreaming=false and os/pkgs/rauc/versions.env is
# the file that says why; os/pkgs/rauc/build.sh drives it for one architecture
# and re-checks the export. Repeating any of that in this producer would be a
# second place the pin and the build options live, and packaging is not the
# thing that should own them.
set -euo pipefail

RAUC_DIR="${MOS_DEB_REPO_ROOT}/os/pkgs/rauc"

# os/pkgs/rauc/build.sh spells an architecture as a BOARD -- it reads MOS_ARCH
# out of os/boards/<board>/board.env -- while the RAUC build itself is
# board-independent: nothing below MOS_ARCH reaches the Dockerfile. So the board
# is LOOKED UP from the architecture rather than written down here as a pair,
# which is a table that goes stale the first time a board is added or renamed
# and goes stale silently, by building the wrong architecture's binary.
BOARD=""
for env_file in "${RAUC_DIR}/../../boards"/*/board.env; do
    [ -f "${env_file}" ] || continue
    arch="$(sed -n 's/^MOS_ARCH=//p' "${env_file}")"
    [ "${arch}" = "${MOS_DEB_ARCH}" ] || continue
    BOARD="$(basename "$(dirname "${env_file}")")"
    break
done
[ -n "${BOARD}" ] || {
    echo "error: no board under os/boards/ declares MOS_ARCH=${MOS_DEB_ARCH}, and os/pkgs/rauc/build.sh takes its architecture from a board.env. Either that architecture has no board in this tree or MOS_ARCH moved out of board.env" >&2
    exit 1
}

echo "prepare.sh: building rauc for ${MOS_DEB_ARCH} through os/pkgs/rauc/build.sh (MOS_BOARD=${BOARD})"
MOS_BOARD="${BOARD}" bash "${RAUC_DIR}/build.sh"

# The five files, named individually rather than copied wholesale. The export
# also carries NEEDED.txt, SHA256SUMS and RAUC_VERSION.env, which are the source
# build's own evidence and not files any root installs; `cp -r out-<arch>/.`
# would put all three in the payload, and each would then be a path this package
# owns on the device for no reason anyone could name.
#
# The list and the ORDER came from the retired rootfs install script this
# package replaced; they are the contract, and mos-rauc is now the only thing
# that puts these five files in an image.
STAGED=0
for f in rauc rauc-service.sh rauc.service de.pengutronix.rauc.conf de.pengutronix.rauc.service; do
    src="${RAUC_DIR}/out-${MOS_DEB_ARCH}/${f}"
    [ -f "${src}" ] || {
        echo "error: os/pkgs/rauc/build.sh reported success and left no ${f} in os/pkgs/rauc/out-${MOS_DEB_ARCH}/. That file is on the activation path -- mos-rauc ships all five -- and a package missing one holds a rauc that answers 'the name de.pengutronix.rauc was not provided by any .service files'" >&2
        exit 1
    }
    cp "${src}" "${MOS_DEB_STAGE}/${f}"
    STAGED=$((STAGED + 1))
done
echo "prepare.sh: staged ${STAGED} rauc files for ${MOS_DEB_ARCH} in ${MOS_DEB_STAGE}"
