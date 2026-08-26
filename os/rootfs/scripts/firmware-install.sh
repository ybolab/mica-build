#!/bin/sh
# Install the AIC8800D80 firmware on the board that has the radio, and on no other.
#
# Called from os/rootfs/stages/40-board.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: MOS_ARCH.

set -eu
if [ "$MOS_ARCH" = "amd64" ]; then
    rm -rf /tmp/fw
else
    mkdir -p /usr/lib/firmware
    mv /tmp/fw/* /usr/lib/firmware/
    rmdir /tmp/fw
    test -f /usr/lib/firmware/fmacfw_8800d80_u02.bin
fi
