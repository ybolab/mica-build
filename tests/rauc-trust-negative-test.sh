#!/usr/bin/env bash
# The RAUC bundle-signature trust domain, tested from the attacker's side.
#
#   bash tests/rauc-trust-negative-test.sh
#
# WHY THIS FILE EXISTS. The RAUC chain (docs/design/release-signing.md §2) is
# one of the two production trust domains: an X.509 CA whose certificate is the
# device keyring, and a signer certificate that CMS-signs every bundle. Every
# positive path in the tree exercises it — the bundle builder read-backs its
# own bundle through `rauc info --keyring` — but nothing proved the REFUSALS:
# that a bundle signed by a CA the keyring does not chain to is rejected, and
# that a bundle whose bytes changed after signing is rejected. A trust domain
# whose negative direction is untested is indistinguishable from `--no-verify`.
#
# WHAT IS PROVED, AND WHERE EACH REFUSAL LIVES. A verity-format bundle (the
# only format pkgs/rauc/system.conf.in accepts) is verified in two layers, and
# the two layers catch different tampering:
#
#   * The CMS signature covers the manifest, which pins the payload's dm-verity
#     root hash, salt and tree size. `rauc info --keyring` checks it, so a
#     FOREIGN-CA bundle and a bundle whose SIGNED REGION was edited are refused
#     there — cases 2 and 4.
#   * The payload squashfs is covered by the dm-verity tree, checked block by
#     block AT INSTALL TIME by the kernel. `rauc info` deliberately does not
#     hash the payload — that is the point of the verity format — so case 3
#     first RECORDS that `rauc info` alone accepts a payload-flipped bundle,
#     then performs the device's check in userspace: `veritysetup verify` over
#     the payload and tree, with the root hash and salt read out of the
#     CMS-verified manifest. The flipped byte fails it; the pristine bundle
#     passes it (the control that proves the verifier verifies).
#
# Case 5 proves the ROTATION overlap of §2.3: a keyring holding the outgoing
# CA and the incoming CA concatenated accepts bundles chained to either, and
# still refuses a third party — old and new can coexist during rollover
# without trusting the world.
#
# THE TRUSTED CA IS MADE BY THE REAL GENERATOR. pkgs/rauc/gen-dev-keys.sh is
# copied into a scratch tree (it anchors on the Makefile beside its
# grandparent, so a stub Makefile makes the scratch tree a "repository") and
# run there — the repository's own meta/ is never touched, and the suite
# exercises the generator's actual output, GENERATED marker and key modes
# included. Mutating the generator's CA→signer chaining reddens case 1.
#
# Five files come over with it, because the generator reads them and a scratch
# tree without them is not a repository it can run in: key-algorithms.env, which
# declares the algorithm of every key it mints, key-validity.env, which declares
# the signer's validity window, meta.example/'s manifest, which it instantiates
# meta/updates/manifest.json from, and build-env/{from.sh,images.env}, which is
# how it resolves the pinned image it mints in. Copied rather than stubbed, so
# this suite signs with the algorithm AND the window the tree actually ships,
# and a change to either value is exercised here rather than assumed harmless
# -- a signer window shortened past the point where `rauc info --keyring`
# accepts a freshly signed bundle reddens every positive case below.
#
# AND IT RUNS OUTSIDE THE CONTAINER, which is new. The generator no longer takes
# openssl off whatever host it is on: it mints in localhost/mos-build-openssl
# and therefore drives docker itself, and there is no docker client inside the
# trixie container below. So it runs here, in the scratch tree, before that
# container starts; the material lands in ${SCRATCH}/meta either way, and the
# container -- which mounts the scratch tree -- reads exactly what it read
# before. `make build-env` is a prerequisite of this suite now, for that image.
#
# TOOLING. rauc is not on the host and pkgs/rauc/out-*/ need not be built, so
# everything cryptographic runs in the pinned Debian trixie container
# (build-env/images.env IMAGE_DEBIAN_TRIXIE) with the distribution's rauc 1.13
# — the same upstream release pkgs/rauc/versions.env pins, and reading/
# verifying with a distro rauc is explicitly fair (build/src/toolsets.ts:
# "Reading is allowed on either"). Nothing built here is installed anywhere:
# the bundles are throwaway fixtures that exist to be refused.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"

command -v docker >/dev/null || { echo "error: docker is required" >&2; exit 1; }

IMAGE="$(bash "${REPO_ROOT}/build-env/from.sh" --ref IMAGE_DEBIAN_TRIXIE)"
[ -n "${IMAGE}" ] || { echo "error: could not resolve IMAGE_DEBIAN_TRIXIE from build-env/images.env" >&2; exit 1; }

# Scratch under the repository's tmp/: container-visible (a bind mount of the
# system /tmp silently delivers an empty directory on this host — see
# .gitignore's tmp/ entry) and gitignored.
SCRATCH="${REPO_ROOT}/tmp/rauc-trust-neg.$$"
trap 'rm -rf "${SCRATCH}"' EXIT
rm -rf "${SCRATCH}"
mkdir -p "${SCRATCH}/pkgs/rauc" "${SCRATCH}/meta.example/updates" "${SCRATCH}/stage"

# The scratch "repository": the real generator and the two committed files it
# reads, anchored by a stub Makefile so it writes its material into
# ${SCRATCH}/meta and not into this checkout.
cp "${REPO_ROOT}/pkgs/rauc/gen-dev-keys.sh" "${SCRATCH}/pkgs/rauc/gen-dev-keys.sh"
cp "${REPO_ROOT}/pkgs/rauc/key-algorithms.env" "${SCRATCH}/pkgs/rauc/key-algorithms.env"
cp "${REPO_ROOT}/pkgs/rauc/key-validity.env" "${SCRATCH}/pkgs/rauc/key-validity.env"
cp "${REPO_ROOT}/meta.example/updates/manifest.json" "${SCRATCH}/meta.example/updates/manifest.json"
# The resolver and the pins it reads, because the generator asks them which
# image to mint in. Copied rather than pointed at the checkout for the reason
# everything else here is: what runs is the tree's own file, in a tree the
# generator anchors on, so a change to either is exercised rather than bypassed.
mkdir -p "${SCRATCH}/build-env"
cp "${REPO_ROOT}/build-env/from.sh" "${SCRATCH}/build-env/from.sh"
cp "${REPO_ROOT}/build-env/images.env" "${SCRATCH}/build-env/images.env"
: > "${SCRATCH}/Makefile"

# THE TRUSTED CA, from the repository's own generator, minted BEFORE the
# container starts: it mints in localhost/mos-build-openssl and drives docker to
# do it, and the trixie container below carries no docker client. Everything the
# suite then reads is the file the generator wrote, exactly as before.
( cd "${SCRATCH}" && bash pkgs/rauc/gen-dev-keys.sh >/dev/null )
[ -f "${SCRATCH}/meta/GENERATED" ] ||
    { echo "error: the generator left no meta/GENERATED marker" >&2; exit 1; }
grep -q '^DOMAINS=.*rauc' "${SCRATCH}/meta/GENERATED" ||
    { echo "error: meta/GENERATED does not name the rauc domain it just wrote" >&2; exit 1; }

# A minimal verity bundle: one payload file, the format system.conf accepts.
# The compatible string is a fixture's — trust verification does not read it,
# and rendering the real manifest template would drag the whole board layout in.
head -c 65536 /dev/urandom > "${SCRATCH}/stage/rootfs.img"
cat > "${SCRATCH}/stage/manifest.raucm" <<'MANIFEST'
[update]
compatible=mos-trust-fixture
version=1.0.0

[bundle]
format=verity

[image.rootfs]
filename=rootfs.img
MANIFEST

cat > "${SCRATCH}/inner.sh" <<'INNER'
#!/usr/bin/env bash
# Runs inside the pinned trixie container, in the scratch directory.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends \
    rauc openssl cryptsetup-bin squashfs-tools ca-certificates >/dev/null

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

# The trusted CA is already here: the generator ran outside this container,
# because it mints in a pinned image and there is no docker client in here.
[ -s meta/rauc/ca.cert.pem ] && [ -s meta/rauc/signer.key.pem ] ||
    { echo "error: meta/rauc/ is not populated, so the generator did not run before this container started" >&2; exit 1; }

# The foreign CA: same shape as the production ceremony in
# docs/design/release-signing.md §2.1, keys nobody in the fixture trusts.
mkforeign() {
    local dir="$1" org="$2"
    mkdir -p "${dir}"
    openssl req -x509 -newkey rsa:3072 -keyout "${dir}/ca.key.pem" -out "${dir}/ca.cert.pem" \
        -days 3650 -nodes -sha256 -subj "/O=${org}/CN=${org} CA" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
    openssl req -newkey rsa:3072 -keyout "${dir}/signer.key.pem" -out "${dir}/signer.csr" \
        -nodes -sha256 -subj "/O=${org}/CN=${org} signer" 2>/dev/null
    openssl x509 -req -in "${dir}/signer.csr" \
        -CA "${dir}/ca.cert.pem" -CAkey "${dir}/ca.key.pem" -CAcreateserial \
        -out "${dir}/signer.cert.pem" -days 3650 -sha256 \
        -extfile <(printf '%s\n' \
            "basicConstraints=critical,CA:FALSE" \
            "keyUsage=critical,digitalSignature") 2>/dev/null
}
mkforeign foreign-ca "attacker"
mkforeign third-ca "bystander"

rauc bundle --cert meta/rauc/signer.cert.pem --key meta/rauc/signer.key.pem stage good.raucb >/dev/null 2>&1
rauc bundle --cert foreign-ca/signer.cert.pem --key foreign-ca/signer.key.pem stage foreign.raucb >/dev/null 2>&1

# `rauc info` with signature verification on, as the bundle builder runs it.
# Output is captured so an expect-fail case can assert the REASON: an exit
# code alone cannot tell "refused the signature" from "could not read the file".
info() { rauc info --keyring "$1" "$2" 2>&1; }

# Case 1, the control the whole suite hangs off: the generator's chain
# verifies. If this fails, every refusal below would be refusing garbage.
if out="$(info meta/rauc/ca.cert.pem good.raucb)"; then
    pass "a bundle signed by the trusted signer verifies against the trusted keyring"
else
    fail "the trusted chain itself does not verify: ${out}"
fi

# Case 2: foreign CA refused — and refused for trust, which the second half
# proves by showing the same bundle is fine against the keyring it chains to.
if out="$(info meta/rauc/ca.cert.pem foreign.raucb)"; then
    fail "a bundle signed by a foreign CA verified against the trusted keyring"
else
    case "${out}" in
        *"signature verification failed"*)
            pass "a bundle signed by a foreign CA is refused by the trusted keyring" ;;
        *)
            fail "the foreign bundle failed for some other reason: ${out}" ;;
    esac
fi
if out="$(info foreign-ca/ca.cert.pem foreign.raucb)"; then
    pass "the foreign bundle is well-formed (its own keyring accepts it), so the refusal above is trust"
else
    fail "the foreign bundle is broken rather than merely untrusted: ${out}"
fi

# The bundle tail layout, needed by cases 3 and 4: the last 8 bytes are the
# big-endian size of the CMS signature that precedes them; the signed manifest
# is embedded in that CMS structure and carries the verity facts for the
# payload in front of it.
BUNDLE=good.raucb
SIZE=$(stat -c%s "${BUNDLE}")
SIGSIZE=$(od -An -tu8 --endian=big -j $((SIZE - 8)) -N8 "${BUNDLE}" | tr -d ' ')
[ "${SIGSIZE}" -gt 0 ] && [ "${SIGSIZE}" -lt "${SIZE}" ] || {
    echo "error: implausible CMS signature size ${SIGSIZE} in ${BUNDLE}" >&2; exit 1; }
dd if="${BUNDLE}" of=sig.der bs=1 skip=$((SIZE - 8 - SIGSIZE)) count="${SIGSIZE}" status=none
openssl cms -verify -inform DER -in sig.der -CAfile meta/rauc/ca.cert.pem -out manifest.signed 2>/dev/null
VHASH="$(sed -n 's/^verity-hash=//p' manifest.signed)"
VSALT="$(sed -n 's/^verity-salt=//p' manifest.signed)"
VSIZE="$(sed -n 's/^verity-size=//p' manifest.signed)"
[ -n "${VHASH}" ] && [ -n "${VSALT}" ] && [ -n "${VSIZE}" ] || {
    echo "error: the CMS-verified manifest carries no verity facts" >&2; cat manifest.signed >&2; exit 1; }
DSIZE=$((SIZE - 8 - SIGSIZE - VSIZE))
[ $((DSIZE % 4096)) -eq 0 ] || { echo "error: payload size ${DSIZE} is not block-aligned" >&2; exit 1; }

# The device's payload check, in userspace: split data and tree, verify the
# tree over the data against the SIGNED root hash and salt. This is the same
# computation dm-verity performs block-by-block at install time.
verity_verify() {
    local bundle="$1"
    dd if="${bundle}" of=data.img bs=4096 count=$((DSIZE / 4096)) status=none
    dd if="${bundle}" of=hash.img bs=4096 skip=$((DSIZE / 4096)) count=$((VSIZE / 4096)) status=none
    veritysetup verify data.img hash.img "${VHASH}" --no-superblock --salt="${VSALT}" \
        --data-block-size=4096 --hash-block-size=4096 --data-blocks=$((DSIZE / 4096)) 2>&1
}

# Flips one byte at an offset, guaranteed to change it: the replacement is
# chosen off the original, so a byte that already was 0xff still mutates.
flip_byte() {
    local file="$1" offset="$2" orig
    orig="$(od -An -tu1 -j "${offset}" -N1 "${file}" | tr -d ' ')"
    if [ "${orig}" = "255" ]; then printf '\x00'; else printf '\xff'; fi |
        dd of="${file}" bs=1 seek="${offset}" count=1 conv=notrunc status=none
}

# Case 3: one payload byte flipped after signing.
cp good.raucb tampered-payload.raucb
flip_byte tampered-payload.raucb 100
cmp -s good.raucb tampered-payload.raucb && { echo "error: the payload mutation changed nothing" >&2; exit 1; }
# Recorded, not merely tolerated: the signature layer alone accepts this file,
# which is exactly why the verity layer below must exist and be checked.
if info meta/rauc/ca.cert.pem tampered-payload.raucb >/dev/null; then
    pass "recorded: rauc info alone accepts a payload flip in a verity bundle (payload is verified at install, by dm-verity)"
else
    fail "rauc info now hashes the verity payload; this suite's layer model is stale — re-read it"
fi
if out="$(verity_verify good.raucb)"; then
    pass "the pristine payload passes the device's dm-verity check (control)"
else
    fail "the pristine payload fails its own verity tree: ${out}"
fi
if out="$(verity_verify tampered-payload.raucb)"; then
    fail "a payload byte flipped after signing still passes the dm-verity check"
else
    case "${out}" in
        *"Verification failed"*)
            pass "a payload byte flipped after signing is refused by the dm-verity check" ;;
        *)
            fail "the tampered payload failed for some other reason: ${out}" ;;
    esac
fi

# Case 4: a byte flipped in the SIGNED region (inside the CMS structure).
cp good.raucb tampered-sig.raucb
flip_byte tampered-sig.raucb $((SIZE - 100))
cmp -s good.raucb tampered-sig.raucb && { echo "error: the signature mutation changed nothing" >&2; exit 1; }
if out="$(info meta/rauc/ca.cert.pem tampered-sig.raucb)"; then
    fail "a bundle whose signed region was edited after signing still verifies"
else
    case "${out}" in
        *"verification fail"*|*"signature"*)
            pass "a bundle whose signed region was edited after signing is refused" ;;
        *)
            fail "the edited bundle failed for some other reason: ${out}" ;;
    esac
fi

# Case 5: the §2.3 rollover overlap. A keyring carrying the outgoing CA and
# the incoming CA concatenated accepts bundles chained to either — and still
# refuses a third party, because coexistence is not promiscuity.
cat meta/rauc/ca.cert.pem foreign-ca/ca.cert.pem > rollover-keyring.pem
rauc bundle --cert third-ca/signer.cert.pem --key third-ca/signer.key.pem stage third.raucb >/dev/null 2>&1
if info rollover-keyring.pem good.raucb >/dev/null; then
    pass "rollover keyring (old+new concatenated) accepts a bundle signed under the old CA"
else
    fail "rollover keyring refuses the old CA's bundle"
fi
if info rollover-keyring.pem foreign.raucb >/dev/null; then
    pass "rollover keyring accepts a bundle signed under the new CA"
else
    fail "rollover keyring refuses the new CA's bundle"
fi
if info rollover-keyring.pem third.raucb >/dev/null; then
    fail "rollover keyring accepts a third party's bundle"
else
    pass "rollover keyring still refuses a CA it does not hold"
fi

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) (${PASS_N} passed, ${FAIL_N} failed)"
[ "${FAIL_N}" -eq 0 ]
INNER

docker run --rm --label ai-agent=true \
    -v "${SCRATCH}:${SCRATCH}" -w "${SCRATCH}" \
    "${IMAGE}" bash inner.sh

# What the generator wrote, asserted from outside the container: the marker
# that keeps a generated root recognisable (verify/'s packed-keyring gate keys
# off it) and the restrictive mode on the CA key.
[ -f "${SCRATCH}/meta/GENERATED" ] || { echo "FAIL: gen-dev-keys.sh left no GENERATED marker" >&2; exit 1; }
KEY_MODE="$(stat -c%a "${SCRATCH}/meta/rauc/ca.key.pem")"
[ "${KEY_MODE}" = "600" ] || { echo "FAIL: ca.key.pem mode is ${KEY_MODE}, not 600" >&2; exit 1; }
echo "PASS: the generated trust root carries its GENERATED marker and a 0600 CA key"
