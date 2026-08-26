#!/usr/bin/env bash
# Generates the DEVELOPMENT-ONLY CMS signing material RAUC bundles are signed
# with, into os/update/rauc/.devkeys/ (gitignored).
#
#   bash os/update/rauc/gen-dev-keys.sh            generate if absent, otherwise no-op
#   bash os/update/rauc/gen-dev-keys.sh --force    regenerate, replacing what is there
#
# Nothing this script writes may ever be committed: the directory is in
# .gitignore and every file lands with restrictive modes. A committed signing
# key would make every device in the fleet trust anything anyone builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYDIR="${SCRIPT_DIR}/.devkeys"

CA_KEY="${KEYDIR}/ca.key.pem"
CA_CERT="${KEYDIR}/ca.cert.pem"
SIGNER_KEY="${KEYDIR}/signer.key.pem"
SIGNER_CERT="${KEYDIR}/signer.cert.pem"

FORCE=0
case "${1:-}" in
    "") ;;
    --force) FORCE=1 ;;
    *) echo "usage: $0 [--force]" >&2; exit 2 ;;
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

if [ -f "${SIGNER_KEY}" ] && [ "${FORCE}" = 0 ]; then
    banner
    echo "development signing material already present in ${KEYDIR}; nothing to do"
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

chmod 0600 "${CA_KEY}" "${SIGNER_KEY}"
chmod 0644 "${CA_CERT}" "${SIGNER_CERT}"

openssl verify -CAfile "${CA_CERT}" "${SIGNER_CERT}" >/dev/null

banner
echo "wrote ${KEYDIR}:"
echo "  ca.cert.pem      keyring RAUC verifies bundles against (rauc --keyring)"
echo "  ca.key.pem       CA private key"
echo "  signer.cert.pem  bundle signing certificate (rauc bundle --cert)"
echo "  signer.key.pem   bundle signing key (rauc bundle --key)"
echo
echo "To let a locally built image install these bundles, copy the keyring to"
echo "  os/rootfs/overlay-v2/etc/rauc/keyring.pem   (gitignored)"
echo "and rebuild the image with MOS_EXPECT_DEV_KEYRING=1 — both the build"
echo "(os/rootfs/build-v2.sh) and the verifier (make os-verify-cx3576-v2) refuse a"
echo "baked keyring without it, and warn loudly with it. Do not do this for"
echo "anything that leaves your desk."
