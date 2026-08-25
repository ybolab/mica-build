#!/bin/sh
# Install ca-certificates and record how many certificates the bundle holds.
#
# Called from os/rootfs/Dockerfile.v2 (certs stage), where the reasoning lives.

set -eu
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates
test -s /etc/ssl/certs/ca-certificates.crt ||
    { echo "error: ca-certificates installed but generated no bundle" >&2; exit 1; }
grep -c 'BEGIN CERTIFICATE' /etc/ssl/certs/ca-certificates.crt > /etc/ssl/certs/.mos-cert-count
echo "trust: generated $(cat /etc/ssl/certs/.mos-cert-count) CA certificates"
