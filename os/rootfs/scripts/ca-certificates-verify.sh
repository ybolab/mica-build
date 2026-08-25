#!/bin/sh
# Assert the trust bundle copied from the certs stage arrived whole, and that
# the openssl CLI did not come with it.
#
# Called from os/rootfs/Dockerfile.v2 (rootfs stage), where the reasoning lives.

set -eu
test -s /etc/ssl/certs/ca-certificates.crt ||
    { echo "error: /etc/ssl/certs/ca-certificates.crt is missing or empty. The image can speak TLS and cannot verify anyone: container pulls, curl and any HTTPS update fetch all fail with 'certificate signed by unknown authority'" >&2; exit 1; }
certs="$(grep -c 'BEGIN CERTIFICATE' /etc/ssl/certs/ca-certificates.crt)"
want="$(cat /etc/ssl/certs/.mos-cert-count)"
rm -f /etc/ssl/certs/.mos-cert-count
[ "${certs}" = "${want}" ] ||
    { echo "error: the certs stage generated ${want} certificates and ${certs} arrived here. A COPY that drops or truncates the bundle leaves TLS working for whatever happens to still verify, which is the hardest version of this failure to notice" >&2; exit 1; }
[ "${certs}" -ge 100 ] ||
    { echo "error: the CA bundle holds only ${certs} certificates" >&2; exit 1; }
dangling="$(find /etc/ssl/certs -xtype l | head -n3 | tr '\n' ' ')"
[ -z "${dangling}" ] ||
    { echo "error: /etc/ssl/certs has dangling symlinks (${dangling}...); the hash farm points at /usr/share/ca-certificates and that copy did not arrive" >&2; exit 1; }
if command -v openssl >/dev/null 2>&1; then
    echo "error: the openssl CLI is in the packed root. The certificates are copied in precisely so it is not: it is 2.5 MB, nothing here uses it (apid's TLS is rustls/rcgen/ring), and it brings /usr/bin/c_rehash, which is Perl. Something else has started depending on it" >&2; exit 1
fi
echo "trust: ${certs} CA certificates in place, no openssl CLI"
