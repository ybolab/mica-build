#!/bin/sh
# Install ca-certificates, refuse a trust store that moved since it was
# recorded, and record how many certificates the bundle holds.
#
# Called from the generate stage of os/rootfs/packages-src/ca-trust, which runs
# THIS file rather than restating it, so the store the package ships and the
# rule the guard below enforces have one definition.

set -eu
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates
test -s /etc/ssl/certs/ca-certificates.crt ||
    { echo "error: ca-certificates installed but generated no bundle" >&2; exit 1; }

# THE GUARD (PLAN-036 decision (h)). The base image is pinned by digest; the
# apt-get above is not -- it resolves against live deb.debian.org, which
# re-points a suite's packages on every point release. So the store just built
# is a function of when this ran, and nothing downstream would notice a
# substitution: the count written below and os/verify's ca-bundle-generated
# check are counts rather than pinned sets, and the package gate's two builds
# see one mirror state. The values recorded beside this file are what turn that
# into a refusal with a name.
RECORDED="$(dirname "$0")/ca-certificates-recorded.env"
[ -f "${RECORDED}" ] ||
    { echo "error: ${RECORDED} does not exist. It is the record of the trust store this repository ships, and this script reads it from beside itself; without it the build would install whatever the mirror offers and assert nothing about it" >&2; exit 1; }
. "${RECORDED}"
[ -n "${CA_CERTIFICATES_VERSION:-}" ] && [ -n "${CA_CERTIFICATES_ANCHORS_SHA256:-}" ] ||
    { echo "error: ${RECORDED} does not declare both CA_CERTIFICATES_VERSION and CA_CERTIFICATES_ANCHORS_SHA256. A missing value is not an empty one to compare against: it would make this guard pass over anything" >&2; exit 1; }

# The count first, and it is not a second version of the digest. An absent or
# truncated anchor tree hashes to a perfectly stable value, so a digest taken
# over it would agree with itself forever once recorded; the floor is what
# keeps the comparison below a statement about a populated set.
anchors="$(find /usr/share/ca-certificates -type f | wc -l)"
[ "${anchors}" -ge 100 ] ||
    { echo "error: /usr/share/ca-certificates holds ${anchors} anchors, and the store should carry ~150. The digest comparison below would be a statement about an empty tree" >&2; exit 1; }

got_version="$(dpkg-query -W -f='${Version}' ca-certificates)"
got_digest="$(find /usr/share/ca-certificates -type f -print0 | LC_ALL=C sort -z |
    xargs -0 -r sha256sum | sha256sum | cut -d' ' -f1)"

# Both are reported, not the first to fail: they normally move together, and a
# message naming only one would send a reader looking for a cause that is half
# the change.
moved=""
[ "${got_version}" = "${CA_CERTIFICATES_VERSION}" ] ||
    moved="${moved}  ca-certificates version: recorded ${CA_CERTIFICATES_VERSION}, installed ${got_version}
"
[ "${got_digest}" = "${CA_CERTIFICATES_ANCHORS_SHA256}" ] ||
    moved="${moved}  anchor set sha256: recorded ${CA_CERTIFICATES_ANCHORS_SHA256}, built ${got_digest}
"
if [ -n "${moved}" ]; then
    echo "error: the trust store moved. This build installed something other than what ${RECORDED} records, over ${anchors} anchors:" >&2
    printf '%s' "${moved}" >&2
    echo "That is the set of certificate authorities every device will believe, so it is refused rather than absorbed. If the move is wanted, re-record BOTH values in ca-certificates-recorded.env in one commit that changes nothing else; the refresh procedure is written at them." >&2
    exit 1
fi

grep -c 'BEGIN CERTIFICATE' /etc/ssl/certs/ca-certificates.crt > /etc/ssl/certs/.mos-cert-count
echo "trust: generated $(cat /etc/ssl/certs/.mos-cert-count) CA certificates from ca-certificates ${got_version}, ${anchors} anchors at the recorded sha256 ${got_digest}"
