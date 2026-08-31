#!/usr/bin/env bash
# Generates a DEFAULT, DEVELOPMENT-GRADE trust root into the repository-root
# ca/ directory (gitignored) -- the one place the build takes signing material
# and the image's RAUC keyring from.
#
#   bash os/pkgs/rauc/gen-dev-keys.sh              generate if absent, otherwise say so
#   bash os/pkgs/rauc/gen-dev-keys.sh --force      regenerate, replacing what is there
#   bash os/pkgs/rauc/gen-dev-keys.sh --if-absent  silent when ca/ is complete; the
#                                                  form the build entries call
#
# Nothing this script writes may ever be committed: ca/ is in .gitignore and
# every file lands with restrictive modes. A committed signing key would make
# every device in the fleet trust anything anyone builds.
#
# It also drops ca/GENERATED. That marker is what distinguishes a trust root
# this script made from production material an operator put there, FOREVER
# after -- not only in the run that made it. The image build keys its loud
# development-keyring warning off the marker, and os/verify keeps refusing a
# marked root in an image unless MOS_EXPECT_DEV_KEYRING=1 says it is a bench
# image. Production material is placed in ca/ WITHOUT the marker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
# Anchored, not counted: `..` arithmetic always produces a path, so a stale
# count would put the fleet's trust root in some directory above the checkout.
[ -f "${REPO_ROOT}/Makefile" ] || {
    echo "error: ${REPO_ROOT}/Makefile does not exist, so ${REPO_ROOT} is not the repository root" >&2
    exit 1
}
KEYDIR="${REPO_ROOT}/ca"

CA_KEY="${KEYDIR}/ca.key.pem"
CA_CERT="${KEYDIR}/ca.cert.pem"
SIGNER_KEY="${KEYDIR}/signer.key.pem"
SIGNER_CERT="${KEYDIR}/signer.cert.pem"
MARKER="${KEYDIR}/GENERATED"

FORCE=0
MODE=manual
case "${1:-}" in
    "") ;;
    --force) FORCE=1 ;;
    --if-absent) MODE=if-absent ;;
    *) echo "usage: $0 [--force|--if-absent]" >&2; exit 2 ;;
esac

if ! command -v openssl >/dev/null; then
    echo "error: openssl not found; it is the only tool this script needs" >&2
    exit 1
fi

banner() {
    echo "############################################################"
    echo "#  DEVELOPMENT ONLY — NOT FOR PRODUCTION                    #"
    echo "#  Unprotected signing keys for local RAUC bundle builds.   #"
    echo "#  Never commit them, never ship them, never sign a release #"
    echo "#  with them. Production keys live in an HSM/CA outside     #"
    echo "#  this repository.                                         #"
    echo "############################################################"
}

# The notice the requirement asks for: loud, and not fatal. Printed only on the
# run that actually generates, which is what makes a second build's silence the
# evidence that nothing was regenerated.
notice() {
    echo "############################################################"
    echo "#  NOTICE: ca/ held no complete trust root, so a DEFAULT    #"
    echo "#  DEVELOPMENT-GRADE one was generated there and the build  #"
    echo "#  is continuing with it.                                   #"
    echo "#                                                           #"
    echo "#  Bundles are signed with it and images built now trust    #"
    echo "#  it. The CA key sits unprotected in the working tree.     #"
    echo "#                                                           #"
    echo "#  A PRODUCTION RELEASE MUST PUT REAL MATERIAL IN ca/       #"
    echo "#  INSTEAD (ca.cert.pem, signer.cert.pem, signer.key.pem)   #"
    echo "#  and must not carry ca/GENERATED -- that marker is what   #"
    echo "#  keeps this root flagged as development-grade.            #"
    echo "############################################################"
}

# Every file the build needs, and -s rather than -e: a half-written ca/ (an
# interrupted generation, a truncated copy) is "empty of the required files"
# just as much as an absent directory is, and must generate rather than be
# handed to openssl.
complete() {
    local f
    for f in "${CA_CERT}" "${CA_KEY}" "${SIGNER_CERT}" "${SIGNER_KEY}"; do
        [ -s "${f}" ] || return 1
    done
    return 0
}

if complete && [ "${FORCE}" = 0 ]; then
    # The build entries call --if-absent on every run; saying "nothing to do"
    # each time would train readers to skim past the one message that matters.
    [ "${MODE}" = if-absent ] && exit 0
    banner
    echo "signing material already present in ${KEYDIR}; nothing to do"
    echo "(pass --force to replace it — every bundle signed with the old key"
    echo " then fails verification against the new keyring)"
    exit 0
fi

mkdir -p "${KEYDIR}"
chmod 0700 "${KEYDIR}"
umask 0077

# RSA rather than an EC curve: RSA PKCS#1 v1.5 signatures are deterministic for
# a given key and digest, so the only thing that varies between two builds of
# the same bundle is the CMS signingTime attribute. ECDSA would add a random
# nonce and make even the signature bytes differ for no benefit here.
openssl req -x509 -newkey rsa:3072 -keyout "${CA_KEY}" -out "${CA_CERT}" \
    -days 3650 -nodes -sha256 \
    -subj "/O=mos development/CN=mos development CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

openssl req -newkey rsa:3072 -keyout "${SIGNER_KEY}" -out "${KEYDIR}/signer.csr" \
    -nodes -sha256 \
    -subj "/O=mos development/CN=mos development bundle signer" 2>/dev/null

# No extendedKeyUsage on the signer: RAUC verifies the CMS signature through
# OpenSSL's S/MIME-signing purpose check, which accepts a certificate with no
# EKU but rejects one whose EKU is codeSigning without emailProtection
# ("unsuitable certificate purpose"). Constraining it further needs
# `[keyring] check-purpose=` in system.conf, which is a production-PKI
# decision, not a development-key one.
openssl x509 -req -in "${KEYDIR}/signer.csr" \
    -CA "${CA_CERT}" -CAkey "${CA_KEY}" -CAcreateserial \
    -out "${SIGNER_CERT}" -days 3650 -sha256 \
    -extfile <(printf '%s\n' \
        "basicConstraints=critical,CA:FALSE" \
        "keyUsage=critical,digitalSignature") 2>/dev/null
rm -f "${KEYDIR}/signer.csr" "${KEYDIR}/ca.srl" "${CA_CERT}.srl"

cat > "${MARKER}" <<'MARKER_TEXT'
This trust root was auto-generated by os/pkgs/rauc/gen-dev-keys.sh and is
DEVELOPMENT-GRADE: the CA key is unprotected and every build in this tree
signs with it. Production material is placed in ca/ by an operator and this
file is NOT present beside it. Do not delete this file to silence a warning --
delete it only when ca/ holds real production material.
MARKER_TEXT

chmod 0600 "${CA_KEY}" "${SIGNER_KEY}"
chmod 0644 "${CA_CERT}" "${SIGNER_CERT}" "${MARKER}"

openssl verify -CAfile "${CA_CERT}" "${SIGNER_CERT}" >/dev/null

if [ "${MODE}" = if-absent ]; then notice; else banner; fi
echo "wrote ${KEYDIR}:"
echo "  ca.cert.pem      keyring RAUC verifies bundles against; the build stages"
echo "                   it into the image at /etc/rauc/keyring.pem"
echo "  ca.key.pem       CA private key"
echo "  signer.cert.pem  bundle signing certificate (rauc bundle --cert)"
echo "  signer.key.pem   bundle signing key (rauc bundle --key)"
echo "  GENERATED        marks this root development-grade for every later build"
echo
echo "Because GENERATED is present, os/rootfs/build-v2.sh warns loudly that the"
echo "image trusts a development CA, and the image verifier (make"
echo "os-verify-cx3576-v2) still refuses that image unless MOS_EXPECT_DEV_KEYRING=1"
echo "names it as a bench image. Do not flash it onto anything that leaves your desk."
