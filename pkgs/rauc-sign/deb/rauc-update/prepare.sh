#!/usr/bin/env bash
# The rauc-update producer's PREPARE hook: cross-compile the two device-side
# binaries, assert that nothing this producer does not own was compiled with
# them, and leave the result in MOS_DEB_STAGE for build-env/deb/build.sh to
# pack.
#
# THE BINARY LIST LIVES HERE, per producer, because it is the one thing about
# this producer that no key in producer.env could describe: it is an input to a
# cargo build, not to a docker build. That is what a PREPARE hook is for.
set -euo pipefail

exec bash "${MOS_DEB_REPO_ROOT}/pkgs/rauc-sign/hack/build-deb.sh" \
    --producer "${MOS_DEB_PRODUCER}" \
    --bins "rauc-update rauc-verify" \
    --arch "${MOS_DEB_ARCH}" \
    --stage "${MOS_DEB_STAGE}"
