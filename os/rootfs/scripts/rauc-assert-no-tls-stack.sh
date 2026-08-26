#!/bin/sh
# Assert the rauc in this root links neither curl nor GnuTLS.
#
# Called from os/rootfs/stages/32-feature-rauc.Dockerfile, where the reasoning lives.

set -eu
if ldd /usr/bin/rauc | grep -ciE 'curl|gnutls' >/dev/null; then
    echo "error: the rauc in this image links curl or GnuTLS:" >&2
    ldd /usr/bin/rauc | grep -iE 'curl|gnutls' >&2
    echo "os/update/rauc/ builds it with -Dnetwork=false -Dstreaming=false precisely so it does not" >&2; exit 1
fi
ldd /usr/bin/rauc | awk '{print "  " $1}' | sort
