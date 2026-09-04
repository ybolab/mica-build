#!/usr/bin/env bash
# Generates DEFAULT, DEVELOPMENT-GRADE signing material into the repository-root
# meta/ directory (gitignored) -- the one place the build takes signing
# material, the image's RAUC keyring and its update configuration from.
#
#   bash pkgs/rauc/gen-dev-keys.sh                    generate if absent, otherwise say so
#   bash pkgs/rauc/gen-dev-keys.sh --force            regenerate, replacing what is there
#   bash pkgs/rauc/gen-dev-keys.sh --if-absent        silent when meta/ is complete for the
#                                                     domain; the form the build entries call
#   bash pkgs/rauc/gen-dev-keys.sh --domain updates   the package signing key, opt-in
#
# TWO DOMAINS, split by object rather than by hierarchy, because they gate
# different things and fall to different attackers:
#
#   rauc     meta/rauc/{ca,signer}.{cert,key}.pem -- the X.509 chain that gates
#            the A/B SYSTEM IMAGE. The default, and build-blocking: no image can
#            be built without the keyring it must trust, so --if-absent
#            generates it and the build carries on with a loud notice.
#   updates  meta/updates/root.key -- lode's ed25519 key over the update
#            PACKAGE, with its public half written into
#            meta/updates/manifest.json's trust.signingKeys. OPT-IN, and
#            deliberately so: a development package-signing key that no
#            published repository has signed anything with is a key that
#            anchors nothing, and generating it by default would make every
#            fresh build claim a trust relationship it does not have. An empty
#            trust.signingKeys is a supported steady state -- the same steady
#            state as an absent update.source -- and an image in it can verify
#            no update package until the list is populated.
#
# meta/updates/manifest.json is instantiated from meta.example/ whenever it is
# absent, in either domain: the build bakes it into every image, so a tree
# without one has nothing to bake.
#
# THE ALGORITHM EACH KEY GETS IS A DECLARED VALUE, not a choice made here.
# pkgs/rauc/key-algorithms.env carries one per role with the reason beside it,
# and this script only maps a value to its openssl spelling. rootfs/build.sh is
# where a value outside its role's allowed set is refused (A1), and where
# material in meta/ outside that set is refused (A2); what this script refuses
# is a value it does not know how to MINT, which is a different claim and a
# smaller one.
#
# SO IS THE SIGNER'S VALIDITY WINDOW. pkgs/rauc/key-validity.env declares it in
# days with its reason, and the mint below reads it rather than carrying a
# literal -- the same file docs/design/release-signing.md §2.1's ceremony block
# is held to, so the number cannot be shortened in one place and left long in
# the other. The signer this script mints is therefore SHORT-LIVED, and a tree
# whose meta/ has aged past the window is re-minted with --force; the bundle
# build refuses before that point and names the date it read (PLAN-078 §S3).
#
# Nothing this script writes may ever be committed: meta/ is in .gitignore and
# every private file lands 0600. A committed signing key would make every device
# in the fleet trust anything anyone builds.
#
# It also drops meta/GENERATED, AND THAT MARKER NAMES THE DOMAINS IT WROTE.
# The marker is what distinguishes material this script made from production
# material an operator put there, FOREVER after -- not only in the run that made
# it. The domain list is there because the mixed tree is a real case: a
# production RAUC ceremony's output copied in while the package key is still
# development-grade. The image build keys its loud development-keyring warning
# off the marker and names the domains it lists, and verify names the grade it
# read in its verdict. Neither refuses: dev and production take the same path
# through meta/, and CI chooses which material is there before the build.
# Production material is placed in meta/ WITHOUT the marker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# Anchored, not counted: `..` arithmetic always produces a path, so a stale
# count would put the fleet's trust root in some directory above the checkout.
[ -f "${REPO_ROOT}/Makefile" ] || {
    echo "error: ${REPO_ROOT}/Makefile does not exist, so ${REPO_ROOT} is not the repository root" >&2
    exit 1
}
METADIR="${REPO_ROOT}/meta"
RAUC_DIR="${METADIR}/rauc"
UPDATES_DIR="${METADIR}/updates"

CA_KEY="${RAUC_DIR}/ca.key.pem"
CA_CERT="${RAUC_DIR}/ca.cert.pem"
SIGNER_KEY="${RAUC_DIR}/signer.key.pem"
SIGNER_CERT="${RAUC_DIR}/signer.cert.pem"
ROOT_KEY="${UPDATES_DIR}/root.key"
MANIFEST="${UPDATES_DIR}/manifest.json"
MANIFEST_EXAMPLE="${REPO_ROOT}/meta.example/updates/manifest.json"
MARKER="${METADIR}/GENERATED"
ALG_ENV="${SCRIPT_DIR}/key-algorithms.env"
VALIDITY_ENV="${SCRIPT_DIR}/key-validity.env"

FORCE=0
MODE=manual
DOMAIN=rauc
while [ "$#" -gt 0 ]; do
    case "$1" in
        --force) FORCE=1 ;;
        --if-absent) MODE=if-absent ;;
        --domain)
            shift
            DOMAIN="${1:-}"
            case "${DOMAIN}" in
                rauc | updates) ;;
                *) echo "usage: $0 [--force|--if-absent] [--domain rauc|updates]" >&2; exit 2 ;;
            esac
            ;;
        *) echo "usage: $0 [--force|--if-absent] [--domain rauc|updates]" >&2; exit 2 ;;
    esac
    shift
done

if ! command -v openssl >/dev/null; then
    echo "error: openssl not found; it is the only tool the rauc domain needs" >&2
    exit 1
fi

# The declared algorithms. Sourced rather than parsed, which is what the
# `KEY=value`-only shape of key-algorithms.env buys, and every role is demanded
# by name: a file that dropped a row would otherwise mint a key with whatever
# the environment happened to carry.
[ -f "${ALG_ENV}" ] || {
    echo "error: ${ALG_ENV} does not exist. It is where the signature algorithm of every minted key is declared; without it this script would fall back to a choice compiled into itself, which is what that file exists to remove" >&2
    exit 1
}
# shellcheck source=/dev/null
. "${ALG_ENV}"
for role in MOS_KEY_ALG_RAUC_CA MOS_KEY_ALG_RAUC_SIGNER MOS_KEY_ALG_PACKAGE; do
    eval "value=\${${role}:-}"
    [ -n "${value}" ] || {
        echo "error: ${ALG_ENV} declares no ${role}. Every key role this script mints needs one, and an empty value is not a default -- it is a row somebody deleted" >&2
        exit 1
    }
done

# The declared signer window, sourced the same way and demanded by name for the
# same reason. A missing row is not a default: a signer minted with whatever
# ${MOS_RAUC_SIGNER_VALIDITY_DAYS} happened to be in the environment is a
# window nobody chose, and an EMPTY one makes openssl's `-days` swallow the
# next argument.
[ -f "${VALIDITY_ENV}" ] || {
    echo "error: ${VALIDITY_ENV} does not exist. It is where the signer's validity window is declared, with the reason for the number beside it; without it this script would fall back to a literal, which is what that file exists to remove" >&2
    exit 1
}
# shellcheck source=/dev/null
. "${VALIDITY_ENV}"
case "${MOS_RAUC_SIGNER_VALIDITY_DAYS:-}" in
    "" | *[!0-9]*)
        echo "error: ${VALIDITY_ENV} declares MOS_RAUC_SIGNER_VALIDITY_DAYS='${MOS_RAUC_SIGNER_VALIDITY_DAYS:-}', which is not a whole number of days. openssl would read a non-number as the start of the next option and mint a certificate with a validity nobody chose" >&2
        exit 1
        ;;
esac
[ "${MOS_RAUC_SIGNER_VALIDITY_DAYS}" -gt 0 ] || {
    echo "error: ${VALIDITY_ENV} declares MOS_RAUC_SIGNER_VALIDITY_DAYS=${MOS_RAUC_SIGNER_VALIDITY_DAYS}. A zero-day signer is expired the moment it is minted and no bundle signed with it verifies anywhere" >&2
    exit 1
}

# A tool-neutral algorithm name mapped to openssl's `req` spelling.
#
# This is NOT the allowed set. The set is a claim about what RAUC's and lode's
# verifiers accept and lives in rootfs/build.sh's A1/A2 refusals; this is a
# claim about what openssl can be asked to produce, and it is deliberately the
# wider of the two -- `rsa-2048` is mintable and refused, which is what makes
# A1's refusal reachable with a value that would otherwise have worked.
openssl_newkey_args() {
    case "$1" in
        ecdsa-p256) printf '%s\n' -newkey ec -pkeyopt ec_paramgen_curve:P-256 ;;
        ecdsa-p384) printf '%s\n' -newkey ec -pkeyopt ec_paramgen_curve:P-384 ;;
        ecdsa-p521) printf '%s\n' -newkey ec -pkeyopt ec_paramgen_curve:P-521 ;;
        rsa-2048 | rsa-3072 | rsa-4096) printf '%s\n' -newkey "rsa:${1#rsa-}" ;;
        *)
            echo "error: ${ALG_ENV} declares '$1', which this script does not know how to mint with openssl." >&2
            echo "That is a spelling this generator has no mapping for -- not a judgement about whether a verifier would accept it, which is rootfs/build.sh's A1." >&2
            return 1
            ;;
    esac
}

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
    echo "#  NOTICE: meta/ held no complete trust root, so a DEFAULT  #"
    echo "#  DEVELOPMENT-GRADE one was generated there and the build  #"
    echo "#  is continuing with it.                                   #"
    echo "#                                                           #"
    echo "#  Bundles are signed with it and images built now trust    #"
    echo "#  it. The CA key sits unprotected in the working tree.     #"
    echo "#                                                           #"
    echo "#  A PRODUCTION RELEASE MUST PUT REAL MATERIAL IN           #"
    echo "#  meta/rauc/ INSTEAD (ca.cert.pem, signer.cert.pem,        #"
    echo "#  signer.key.pem) and must not carry meta/GENERATED --     #"
    echo "#  that marker is what keeps this root development-grade.   #"
    echo "############################################################"
}

# Every file a domain needs, and -s rather than -e: a half-written meta/ (an
# interrupted generation, a truncated copy) is "empty of the required files"
# just as much as an absent directory is, and must generate rather than be
# handed to openssl.
#
# PER DOMAIN, because the mixed tree is the case the marker exists for: a
# complete meta/rauc/ says nothing about whether meta/updates/root.key is there,
# and one answer covering both would regenerate a production CA to mint a
# development package key.
complete() {
    local f
    case "$1" in
        rauc)
            for f in "${CA_CERT}" "${CA_KEY}" "${SIGNER_CERT}" "${SIGNER_KEY}"; do
                [ -s "${f}" ] || return 1
            done
            ;;
        updates)
            [ -s "${ROOT_KEY}" ] || return 1
            ;;
    esac
    return 0
}

# meta/updates/manifest.json, instantiated from the committed example.
#
# The example is a directory the TOOLING uses and not prose beside it: every
# fresh tree gets this file from meta.example/, so an example that drifted from
# what the build expects is a red build rather than a document nobody re-read.
# Never overwritten -- an operator's edited manifest is not something a
# generator run may replace.
instantiate_manifest() {
    [ -s "${MANIFEST}" ] && return 0
    [ -s "${MANIFEST_EXAMPLE}" ] || {
        echo "error: ${MANIFEST_EXAMPLE} is missing or empty, so there is nothing to instantiate ${MANIFEST} from. It is committed; a checkout without it is incomplete" >&2
        exit 1
    }
    mkdir -p "${UPDATES_DIR}"
    chmod 0700 "${UPDATES_DIR}"
    cp "${MANIFEST_EXAMPLE}" "${MANIFEST}"
    chmod 0644 "${MANIFEST}"
    echo "wrote ${MANIFEST} from meta.example/updates/manifest.json (no server, no signing key)"
}

# meta/GENERATED, rewritten so its domain list is the UNION of what it already
# covered and what this run wrote. Additive because the two domains are
# generated by separate invocations, and a marker naming only the last one would
# un-flag material it still covers.
mark_generated() {
    local domain="$1" listed="" merged="" d
    [ -f "${MARKER}" ] && listed="$(sed -n 's/^DOMAINS=//p' "${MARKER}" | tail -n1)"
    for d in ${listed} "${domain}"; do
        case " ${merged} " in
            *" ${d} "*) ;;
            *) merged="${merged}${merged:+ }${d}" ;;
        esac
    done
    cat > "${MARKER}" <<MARKER_TEXT
This signing material was auto-generated by pkgs/rauc/gen-dev-keys.sh and is
DEVELOPMENT-GRADE: the private keys are unprotected and every build in this
tree signs with them. Production material is placed in meta/ by an operator and
this file is NOT present beside it. Do not delete this file to silence a
warning -- delete it only when meta/ holds real production material.

DOMAINS names the domains this generator wrote, because the mixed tree is real:
a production RAUC ceremony's output can be copied in while the package signing
key is still development-grade, and the marker has to say which half is which.

DOMAINS=${merged}
MARKER_TEXT
    chmod 0644 "${MARKER}"
}

gen_rauc() {
    local ca_args signer_args
    mapfile -t ca_args < <(openssl_newkey_args "${MOS_KEY_ALG_RAUC_CA}")
    mapfile -t signer_args < <(openssl_newkey_args "${MOS_KEY_ALG_RAUC_SIGNER}")
    # mapfile cannot fail, so the mapper's refusal reaches here as an EMPTY
    # array -- which openssl would read as "no -newkey at all" and answer with a
    # confusing usage error rather than the sentence the mapper already printed.
    { [ "${#ca_args[@]}" -gt 0 ] && [ "${#signer_args[@]}" -gt 0 ]; } || exit 1

    mkdir -p "${RAUC_DIR}"
    chmod 0700 "${METADIR}" "${RAUC_DIR}"
    umask 0077

    # The algorithm is pkgs/rauc/key-algorithms.env's MOS_KEY_ALG_RAUC_CA and
    # MOS_KEY_ALG_RAUC_SIGNER, and the reason for each value is recorded beside
    # it there. Deliberately not restated here: a reason in two places is a
    # reason that goes stale in one of them, and this one already had.
    openssl req -x509 "${ca_args[@]}" -keyout "${CA_KEY}" -out "${CA_CERT}" \
        -days 3650 -nodes -sha256 \
        -subj "/O=mos development/CN=mos development CA" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

    openssl req "${signer_args[@]}" -keyout "${SIGNER_KEY}" -out "${RAUC_DIR}/signer.csr" \
        -nodes -sha256 \
        -subj "/O=mos development/CN=mos development bundle signer" 2>/dev/null

    # No extendedKeyUsage on the signer: RAUC verifies the CMS signature through
    # OpenSSL's S/MIME-signing purpose check, which accepts a certificate with no
    # EKU but rejects one whose EKU is codeSigning without emailProtection
    # ("unsuitable certificate purpose"). Constraining it further needs
    # `[keyring] check-purpose=` in system.conf, which is a production-PKI
    # decision, not a development-key one.
    #
    # SHORT-LIVED, from pkgs/rauc/key-validity.env and not from a literal here.
    # The window is the whole of PLAN-078's answer to a stolen signer: there is
    # no CRL path to devices, so a compromised signer is out-waited, and how
    # long that takes is this number. The reason for its value lives beside it
    # in that file, deliberately not restated here -- a reason in two places is
    # a reason that goes stale in one of them, which is the defect the
    # algorithm rows above already had once.
    openssl x509 -req -in "${RAUC_DIR}/signer.csr" \
        -CA "${CA_CERT}" -CAkey "${CA_KEY}" -CAcreateserial \
        -out "${SIGNER_CERT}" -days "${MOS_RAUC_SIGNER_VALIDITY_DAYS}" -sha256 \
        -extfile <(printf '%s\n' \
            "basicConstraints=critical,CA:FALSE" \
            "keyUsage=critical,digitalSignature") 2>/dev/null
    rm -f "${RAUC_DIR}/signer.csr" "${RAUC_DIR}/ca.srl" "${CA_CERT}.srl"

    chmod 0600 "${CA_KEY}" "${SIGNER_KEY}"
    chmod 0644 "${CA_CERT}" "${SIGNER_CERT}"

    openssl verify -CAfile "${CA_CERT}" "${SIGNER_CERT}" >/dev/null
    mark_generated rauc
}

gen_updates() {
    [ "${MOS_KEY_ALG_PACKAGE}" = ed25519 ] || {
        echo "error: ${ALG_ENV} declares MOS_KEY_ALG_PACKAGE=${MOS_KEY_ALG_PACKAGE}, which this script does not know how to mint." >&2
        echo "rootfs/build.sh's A1 is what refuses a value outside the role's allowed set, and it names the verifier that bounds it." >&2
        exit 1
    }
    command -v jq >/dev/null || {
        echo "error: jq not found. The package signing key's public half is written into ${MANIFEST}, which is JSON an operator may already have edited; --domain updates will not rewrite it with sed" >&2
        exit 1
    }

    mkdir -p "${UPDATES_DIR}"
    chmod 0700 "${METADIR}" "${UPDATES_DIR}"
    umask 0077

    # Raw PKCS#8 DER, which is the encoding lode's tooling writes and reads --
    # and the reason section 1.1's private-key detector carries a DER test
    # rather than only a grep for PEM armour.
    openssl genpkey -algorithm ED25519 -outform DER -out "${ROOT_KEY}"
    chmod 0600 "${ROOT_KEY}"

    instantiate_manifest

    # lode's trusted_keys shape: base64 over the RAW 32-byte public half, which
    # is the tail of the 44-byte SubjectPublicKeyInfo DER.
    local pub
    pub="$(openssl pkey -inform DER -in "${ROOT_KEY}" -pubout -outform DER | tail -c 32 | base64 | tr -d '\n')"
    [ -n "${pub}" ] || { echo "error: could not derive the public half of ${ROOT_KEY}" >&2; exit 1; }

    # signingKeyIds is left EMPTY on purpose: it is derived by the build from
    # signingKeys, and a value written here would be a second truth for a fact
    # that has one source.
    local tmp
    tmp="$(mktemp)"
    jq --arg k "${pub}" '.trust.signingKeys = [$k] | .trust.signingKeyIds = []' "${MANIFEST}" > "${tmp}"
    cat "${tmp}" > "${MANIFEST}"
    rm -f "${tmp}"
    chmod 0644 "${MANIFEST}"
    mark_generated updates
}

# Nothing to do is silence under --if-absent and a sentence otherwise. The
# manifest counts towards "complete": a tree with every key and no manifest
# still has work to do, because the build bakes that file into every image.
if complete "${DOMAIN}" && [ -s "${MANIFEST}" ] && [ "${FORCE}" = 0 ]; then
    # The build entries call --if-absent on every run; saying "nothing to do"
    # each time would train readers to skim past the one message that matters.
    [ "${MODE}" = if-absent ] && exit 0
    banner
    echo "the ${DOMAIN} domain is already present in ${METADIR}; nothing to do"
    echo "(pass --force to replace it — every bundle signed with the old key"
    echo " then fails verification against the new keyring)"
    exit 0
fi

mkdir -p "${METADIR}"
chmod 0700 "${METADIR}"

case "${DOMAIN}" in
    rauc)
        # A complete rauc domain with no manifest is the ONE case that must not
        # regenerate: the material may be production material an operator
        # placed, and instantiating the missing file is all that is owed.
        complete rauc && [ "${FORCE}" = 0 ] || gen_rauc
        instantiate_manifest
        ;;
    updates) gen_updates ;;
esac

if [ "${MODE}" = if-absent ]; then notice; else banner; fi
echo "wrote ${METADIR}:"
case "${DOMAIN}" in
    rauc)
        echo "  rauc/ca.cert.pem      keyring RAUC verifies bundles against; the build stages"
        echo "                        it into the image at /etc/rauc/keyring.pem"
        echo "  rauc/ca.key.pem       CA private key             (${MOS_KEY_ALG_RAUC_CA})"
        echo "  rauc/signer.cert.pem  bundle signing certificate (rauc bundle --cert)"
        echo "  rauc/signer.key.pem   bundle signing key         (${MOS_KEY_ALG_RAUC_SIGNER},"
        echo "                        valid ${MOS_RAUC_SIGNER_VALIDITY_DAYS} days; re-run with --force to reissue)"
        ;;
    updates)
        echo "  updates/root.key      package signing key        (${MOS_KEY_ALG_PACKAGE})"
        echo "                        its public half is now in updates/manifest.json's"
        echo "                        trust.signingKeys; the build derives signingKeyIds"
        ;;
esac
echo "  updates/manifest.json the baked update configuration"
echo "  GENERATED             marks these domains development-grade for every later build"
echo
echo "Because GENERATED is present, rootfs/build.sh warns loudly that the"
echo "image trusts a development RAUC keyring, and the image verifier (make"
echo "os-verify-cx3576) names the trust root DEVELOPMENT-GRADE in its verdict."
echo "Do not flash it onto anything that leaves your desk."
