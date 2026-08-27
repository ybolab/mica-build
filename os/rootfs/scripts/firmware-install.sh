#!/bin/sh
# Install the radio firmware THIS BOARD declares, and nothing at all for a board
# that declares none.
#
# Called from os/rootfs/stages/40-board.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: BOARD_FIRMWARE_FILES.
#
# It reads no MOS_ARCH and takes no per-board early exit: the board stages what
# it carries, so the question this script asks is what is HERE rather than
# which board it is on.

set -eu
if [ -z "${BOARD_FIRMWARE_FILES}" ]; then
    # NOTHING IS CREATED on the way out. `mkdir -p /usr/lib/firmware` is inside
    # the branch below and not above it, so a board with no radio does not get
    # an empty directory standing where firmware would be -- which would be one
    # more thing in a signed root that an operator cannot account for.
    rm -rf /tmp/fw
    echo "firmware: this board declares none"
    exit 0
fi

# The staged set and the declared set must be the same size. build-v2.sh stages
# exactly BOARD_FIRMWARE_FILES and refuses a declared file the BSP does not
# have, so a difference here is a stale or hand-edited staging directory -- and
# the consequence is a file in /usr/lib/firmware that no board fact names and
# no check covers.
staged=0
for f in /tmp/fw/*; do
    [ -e "$f" ] || continue
    staged=$((staged + 1))
done
declared=0
for f in ${BOARD_FIRMWARE_FILES}; do
    declared=$((declared + 1))
done
if [ "$staged" != "$declared" ]; then
    echo "error: the board declares $declared firmware file(s) in BOARD_FIRMWARE_FILES and $staged were staged into /tmp/fw. os/rootfs/build-v2.sh stages exactly the declared set, so the two disagreeing means the image would carry firmware no board fact names" >&2
    exit 1
fi

mkdir -p /usr/lib/firmware
mv /tmp/fw/* /usr/lib/firmware/
rmdir /tmp/fw

# THE POSITIVE CONTROL, and the reason the list is passed as well as staged.
# What this replaces is `test -f /usr/lib/firmware/fmacfw_8800d80_u02.bin`: the
# same assertion with one board's answer written into a file every board runs.
# BOARD_FIRMWARE_FILES holds the INSTALLED paths, which is what makes it usable
# here and is also how the os/verify suite reads it -- one list, two readers.
for f in ${BOARD_FIRMWARE_FILES}; do
    [ -f "$f" ] || {
        echo "error: the board declares $f in BOARD_FIRMWARE_FILES and it is not on the root after the install. BOARD_FIRMWARE_FILES holds installed paths under /usr/lib/firmware; a declared path that is somewhere else is a radio whose driver finds no firmware on the device" >&2
        exit 1
    }
done
echo "firmware: $declared file(s) installed from the board's declared set"
