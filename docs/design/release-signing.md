# Release signing: the production key ceremonies

> **Status:** runbook. RFCT-083 made the tooling accept real keys — `os/update/bundle.sh`
> honours caller CERT/KEY/KEYRING, `mos-sign verify` demands an out-of-band root,
> rollback publication is gated — and then named the remaining step plainly:
> *owning* production keys is an operational act, not a code change. This
> document is that act, written down before it is performed, so that when it is
> performed nothing is improvised. The audience is the release owner who will
> hold these keys, and any auditor who asks how a mos release comes to be
> trusted.
>
> This document ships **English-only**, joining the recorded exception in
> `docs/README.md`: whether the `*.zh.md` translations are kept current is a
> decision parked with the user (`docs/task/RFCT-045.md`), and a translation of
> a live runbook that drifted from it would be worse than none.

## 0. How to read this document

**Status markers.** The discipline is `docs/design/access.md` section 0's — a
mechanism that exists only as prose has nothing that will ever notice it is
absent, so prose must say which it is. The marker set here is this document's
own, because a runbook's sections are neither `[implemented]` code nor
`[proposed]` code; they are procedures:

- **[runbook]** — the shipped tooling supports every step as written; the
  procedure can be executed today, and the commands are the real ones.
- **[not implemented]** — the tooling for this step does not exist. Prose
  only, kept here so the gap is on the same page as the procedure that runs
  into it.

**The two trust chains.** A mos release is signed twice, by two unrelated key
hierarchies, and conflating them is the first mistake this document exists to
prevent:

1. **The TUF repository** (`update/sign`, `mos-sign`): four ed25519 role keys
   sign the metadata that tells a device *which* bundle is current, pinning
   its sha256, length and dm-verity root hash. The `root` key is offline
   material; `targets`/`snapshot`/`timestamp` are online release-host keys.
   See `update/README.md` for the phase-1 scope.
2. **The RAUC CMS signature** (`os/update/bundle.sh`, `rauc bundle`): an X.509
   signer certificate, chained to a CA whose certificate is the device-side
   keyring, signs the bundle payload itself. This is what
   `/etc/rauc/system.conf` verifies at install time.

Compromise of either chain alone is contained by the other only if the keys
are actually separate — separate machines, separate custodians where staffing
allows, and nothing below ever merges them.

## 1. The TUF root ceremony — **[runbook]**

### 1.1 Where it runs

On an **offline machine**: no network interfaces up, an OS booted from known
media, and a filesystem that will not outlive the ceremony except for the key
media deliberately written. `mos-sign` is a static-enough Rust binary; build
it beforehand (`cargo build --release -p mos-sign` in the `mosd/` workspace)
and carry the binary and this repository checkout to the machine.

### 1.2 Key generation

```sh
mos-sign gen-dev-keys --keys-dir /ceremony/keys
```

The name says `dev` because the *default* directory is the gitignored
development location; the generator itself is the production generator — one
fresh ed25519 key per role (`root.pk8`, `targets.pk8`, `snapshot.pk8`,
`timestamp.pk8`, raw PKCS#8, mode 0600), refusing to overwrite anything that
exists, so a stale key cannot be silently replaced (`update/sign/src/keys.rs`).

### 1.3 Repository initialization, and the threshold decision

```sh
mos-sign init \
  --repo /ceremony/tuf \
  --keys-dir /ceremony/keys \
  --threshold 1 \
  --root-expires    <RFC 3339> \
  --targets-expires <RFC 3339> \
  --snapshot-expires <RFC 3339> \
  --timestamp-expires <RFC 3339>
```

`init` is the only command that loads `root.pk8`; `add` and `sign` load only
the three online keys. All expirations are explicit — nothing in `mos-sign`
reads the wall clock, so the ceremony's output is reproducible and can be
re-derived to check the media.

`--threshold` applies to every role, and today it must be `1`:
`mos-sign` holds exactly one key per role, and since RFCT-083 a threshold
above a role's key count is rejected at `init` rather than producing metadata
no set of signatures can ever satisfy. Multi-key roles, delegated targets and
hardware-backed key stores are explicitly out of phase 1
(`update/README.md`); when a threshold above 1 becomes possible, this section
gets rewritten around it — until then, writing "use 3-of-5" here would be a
procedure the tooling cannot execute.

### 1.4 Expiry policy

Chosen here so every later `sign` invocation copies rather than decides:

| role | expiry horizon | who re-signs, with what |
| --- | --- | --- |
| `root` | 1 year | the offline ceremony, repeated (§1.6) |
| `targets` | 6 months | release host, online key, at each release or `sign` |
| `snapshot` | 3 months | release host, online key |
| `timestamp` | 2 weeks | release host, online key, on a calendar reminder |

The short `timestamp` horizon is the freshness guarantee: a mirror serving
stale metadata goes visibly expired within two weeks. The `sign` command
refreshes the three online roles between releases:

```sh
mos-sign sign --repo <repo> --keys-dir <online-keys> \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...
```

Publishing an explicitly *lower* snapshot or timestamp version is an error
unless `--allow-rollback` is passed — that flag exists for disaster recovery
of a corrupted repository, never for routine use, and any use of it is an
incident to be recorded, not a convenience.

### 1.5 What leaves the room, and what never does

- `root.pk8` is written to **two or more** offline media (its file is small;
  paper backup of the base64 PKCS#8 is a legitimate third copy), sealed in
  tamper-evident envelopes, stored in **separate physical locations**, with a
  written custody record of who sealed what and when. It never touches a
  networked machine again until the next ceremony.
- `targets.pk8`, `snapshot.pk8`, `timestamp.pk8` move to the release host's
  key directory (the `--keys-dir` that `add` and `sign` will use), mode 0600,
  on media that is wiped afterwards.
- `metadata/1.root.json` (and its `root.json` alias) is the **public** trust
  anchor. Record its sha256 in the ceremony minutes; distribute the file out
  of band. Every later `mos-sign verify --root <this file>` is anchored to
  it. `--root` is required — the tool has no default and never reads the
  repository's own `root.json` as an anchor — but it does not detect an
  operator pointing `--root` back into the repository being verified, so
  this procedure forbids it: that run would prove only internal consistency,
  which an attacker-authored repository has too.
- The ceremony machine's storage is destroyed or wiped after the media are
  written.

### 1.6 Rotation and revocation — **[not implemented]**, stated honestly

TUF rotates the root by publishing `<n+1>.root.json` signed by **both** the
old and the new root keys, so existing clients can walk to the new anchor.
`mos-sign` has no command that produces such a file — root key rotation is
explicitly out of phase 1 (`update/README.md`) — and revoking a compromised
*online* key is the same missing operation, because the replacement key must
be introduced by a new root.json.

What this means operationally, today: a compromised online key ends the
repository's lineage. The recovery is a fresh ceremony (§1.1–1.5), a new
trust anchor distributed out of band, and devices re-anchored by whatever
mechanism ships trust anchors to devices — which is the RFCT-088 workstream's
territory (`docs/task/RFCT-088.md`, in flight in parallel with this
document). Until rotation tooling exists, the root key's protection (§1.5)
and the online keys' host hygiene are carrying the weight that rotation
would; this is the single strongest argument for scheduling that tooling.

Re-signing root at its annual expiry with the *same* key needs the offline
key but no new trust anchor: repeat the ceremony access procedure and run
`init`'s successor... which also does not exist — `init` refuses an existing
repository. Practically, the annual root refresh is blocked on the same
missing rotation command, and the 1-year horizon in §1.4 is the deadline for
building it. **[not implemented]**, and dated.

## 2. The RAUC production CA — **[runbook]** for the ceremony, with a named gap

### 2.1 The offline CA ceremony

This mirrors `os/update/rauc/gen-dev-keys.sh` step for step — the dev script is the
tested shape, and deviating from a tested shape in a ceremony is how typos
become fleet incidents — with the three choices that distinguish production:
a real subject, real validity horizons, and offline custody. Same machine
discipline as §1.1. openssl is the only tool.

```sh
umask 0077

# The CA. RSA (deterministic PKCS#1 v1.5 signatures, same reasoning the dev
# script records); 4096 for a key that must outlive every device it signs
# for. CA:TRUE pathlen:0 -- it signs signer certificates and nothing below
# them. Validity 15 years: the keyring baked into a fielded device is
# realistically never replaced without the (missing) provisioning path in
# 2.3, so the CA must outlive the fleet, and an expired baked keyring bricks
# updates on every device at once.
openssl req -x509 -newkey rsa:4096 -keyout ca.key.pem -out ca.cert.pem \
    -days 5475 -nodes -sha256 \
    -subj "/O=<the shipping organisation>/CN=mos release CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"

# The signer. Short validity (2 years) because reissuing a signer is cheap --
# it needs the CA key, not a fleet update: devices trust the CA, so a new
# signer chains without touching any keyring.
openssl req -newkey rsa:3072 -keyout signer.key.pem -out signer.csr \
    -nodes -sha256 \
    -subj "/O=<the shipping organisation>/CN=mos release bundle signer"

# No extendedKeyUsage, deliberately, same as the dev script and for its
# recorded reason: RAUC verifies through OpenSSL's S/MIME purpose check,
# which accepts no-EKU and rejects codeSigning-without-emailProtection.
# Tightening this via `[keyring] check-purpose=` in system.conf is a
# production-PKI decision to take together with this ceremony -- if taken,
# the EKU here and the system.conf line change as one commit.
openssl x509 -req -in signer.csr \
    -CA ca.cert.pem -CAkey ca.key.pem -CAcreateserial \
    -out signer.cert.pem -days 730 -sha256 \
    -extfile <(printf '%s\n' \
        "basicConstraints=critical,CA:FALSE" \
        "keyUsage=critical,digitalSignature")

openssl verify -CAfile ca.cert.pem signer.cert.pem
```

Custody, mirroring §1.5: `ca.key.pem` stays offline on sealed media, two
copies, two locations — it is needed once per signer reissue, roughly every
two years. `signer.key.pem` and `signer.cert.pem` go to the release signing
host. `ca.cert.pem` is public: it is the keyring, and its sha256 goes in the
ceremony minutes next to root.json's.

`rauc bundle` takes PEM file paths; there is no HSM/PKCS#11 wiring in
`os/update/bundle.sh` today, so the signer key is a file on the release host and the
host's hygiene is part of the trust model. Worth saying rather than implying.

### 2.2 Signer reissue

With the CA media checked out under the custody record: new key + CSR as
above, sign with the CA, carry the new pair to the release host, destroy the
old signer key. No device is touched; the next bundle simply chains through
the new signer. A *compromised* signer is revoked the hard way — RAUC's
keyring model as shipped here has no CRL distribution to devices — by
reissuing and then out-waiting the exposure: any bundle the attacker signed
verifies until the CA itself is replaced, which is the §2.3 gap again. Record
the incident; ship the fleet-wide mitigation through the update itself if one
is warranted.

### 2.3 How the keyring reaches devices — **[not implemented]**, the honest gap

Today, **no provisioning path ships a production keyring**. The facts, all
post-RFCT-083:

- `os/rootfs/overlay-v2/etc/rauc/system.conf` names
  `/etc/rauc/keyring.pem`, and the root filesystem deliberately does not
  contain it.
- `os/rootfs/build-v2.sh` **refuses** to stage `etc/rauc/keyring.pem`, and
  `os/verify-image-v2.sh` fails an image that carries one in the packed
  root. Both are waivable only by `MOS_EXPECT_DEV_KEYRING=1`, which warns
  unmissably and exists for exactly one case: a local dev image installing
  locally signed bundles, on a bench, never shipped
  (`os/update/rauc/gen-dev-keys.sh`'s closing instructions). The ui-location
  harness proves both directions of that gate.
- Therefore a production image, as buildable today, cannot install any
  bundle: RAUC has no keyring to verify against. The refusal is correct —
  it is what stopped the dev CA from riding along in prod images (the
  RFCT-083 P1 finding) — but the affirmative half is missing.

The affirmative half — placing `ca.cert.pem` on the device through a
provisioning-time channel (META partition, factory step, or first-boot
enrolment) rather than baking it into the signed root — is the trust-anchor
provisioning story RFCT-088 is designing **in parallel with this document**
(`docs/task/RFCT-088.md`), together with the TUF root anchor from §1.5,
which has the same shape and should ship through the same channel. Until
that lands, this runbook produces a CA whose keyring has no road to a
production device, and says so rather than gesturing at one.

## 3. Signing a release bundle — **[runbook]**

On the release host, with the online TUF keys (§1.5) and the RAUC signer
(§2.1) in place, `_out/cx3576/` populated by the v2 rootfs build and the BSP
kernel present (the privileged CI lane's deep job,
`.gitea/workflows/privileged.yml`, runs this same chain with dev keys —
production signing is deliberately **not** a CI step; see §4):

```sh
# 1. Build the prod-profile rootfs and the image inputs.
MOS_PROFILE=prod make os-rootfs-cx3576-v2

# 2. Build and CMS-sign the bundle. Caller-supplied CERT/KEY/KEYRING win over
#    the dev-key defaults on both the host and the container build path --
#    this is the RFCT-083 fix; before it, both branches hardcoded .devkeys
#    and no production bundle was buildable at all. KEYRING is used by the
#    script's own read-back verification (rauc info against the shipped
#    system.conf), so passing the production ca.cert.pem here is also the
#    first end-to-end check of the chain.
CERT=/path/to/signer.cert.pem \
KEY=/path/to/signer.key.pem \
KEYRING=/path/to/ca.cert.pem \
    bash os/update/bundle.sh 1.2.3

# 3. Publish into the TUF repository with the online keys. The verity root
#    hash is the bundle's own (verity-format) root hash as `rauc info`
#    reports it -- mos-sign never shells out to rauc, so it is supplied
#    explicitly and deliberately.
mos-sign add \
  --repo <repo> --keys-dir <online-keys> \
  --target _out/cx3576/mos-cx3576-<epoch>.raucb \
  --verity-root-hash <64 hex> \
  --release-version 1.2.3 \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...

# 4. Verify the published repository as a CLIENT would, against the ceremony
#    trust anchor from 1.5 -- never against the repository's own root.json
#    (1.5). --datastore persists trusted metadata so the
#    NEXT release's verify also proves no rollback happened between them.
mos-sign verify --repo <repo> --root /trusted/root.json --datastore /var/lib/mos-sign/trusted
```

Then publish `<repo>` as static content (`update/README.md`'s layout). The
offline "lockbox" bundle path is planned and not implemented
(`update/lockbox/`); when it exists it consumes the same signed artifacts.

## 4. What never happens

The negative space of this runbook, listed because every item is a thing a
deadline will one day propose:

- **No private key is ever committed**, to this repository or any other. The
  dev-key directories are gitignored and the generators refuse overwrite;
  production keys never enter a checkout at all.
- **The root key and the CA key never touch a networked machine.** Not for a
  "quick re-sign", not in CI, not on the release host.
- **No production key on a build machine, and no signing in CI.** CI builds
  with dev keys (`make os-devkeys`) and proves the pipeline; a runner that
  held production material would make every person and plugin with runner
  access a signer. The privileged lane's deep job says this in its own
  comments.
- **No dev CA on a shipped device.** `MOS_EXPECT_DEV_KEYRING=1` is a bench
  waiver, not a build option; the build and the verifier both fail closed
  without it, and nothing that leaves a desk is built with it.
- **No expiry decided ad hoc.** The horizons in §1.4 and §2.1 are the
  policy; a `sign` invocation that invents a different horizon is a change
  to this document first.
- **No `--allow-rollback` outside a recorded incident.**
- **No keyring baked into the signed root filesystem** — even the production
  one, tempting as it is as a shortcut past §2.3: a keyring inside the
  dm-verity-sealed root can only ever be replaced by a full image update
  signed by the very CA being replaced, which is exactly the circularity a
  provisioning-time trust anchor exists to break.
