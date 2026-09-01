# Release signing: the production key ceremonies

> **Status:** runbook. The tooling accepts real keys — the bundle
> builder honours caller CERT/KEY/KEYRING, `rauc-sign verify` demands an out-of-band root,
> rollback publication is gated — and then named the remaining step plainly:
> *owning* production keys is an operational act, not a code change. This
> document is that act, written down before it is performed, so that when it is
> performed nothing is improvised. The audience is the release owner who will
> hold these keys, and any auditor who asks how a mos release comes to be
> trusted.

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

1. **The TUF repository** (`pkgs/rauc-sign`, `rauc-sign`): four ed25519 role keys
   sign the metadata that tells a device *which* bundle is current, pinning
   its sha256, length and dm-verity root hash. The `root` key is offline
   material; `targets`/`snapshot`/`timestamp` are online release-host keys.
   See `pkgs/rauc-sign/README.md` for the phase-1 scope.
2. **The RAUC CMS signature** (`build/src/bundle.ts`, `rauc bundle`): an X.509
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
media deliberately written. `rauc-sign` is a static-enough Rust binary; build
it beforehand (`cargo build --release -p rauc-sign` in the `pkgs/rauc-sign/`
workspace)
and carry the binary and this repository checkout to the machine.

### 1.2 Key generation

```sh
rauc-sign gen-dev-keys --keys-dir /ceremony/keys
```

The name says `dev` because the *default* directory is the gitignored
development location; the generator itself is the production generator — one
fresh ed25519 key per role (`root.pk8`, `targets.pk8`, `snapshot.pk8`,
`timestamp.pk8`, raw PKCS#8, mode 0600), refusing to overwrite anything that
exists, so a stale key cannot be silently replaced (`pkgs/rauc-sign/src/keys.rs`).

### 1.3 Repository initialization, and the threshold decision

```sh
rauc-sign init \
  --repo /ceremony/tuf \
  --keys-dir /ceremony/keys \
  --threshold 1 \
  --root-expires    <RFC 3339> \
  --targets-expires <RFC 3339> \
  --snapshot-expires <RFC 3339> \
  --timestamp-expires <RFC 3339>
```

`init` is the only command that loads `root.pk8`; `add` and `sign` load only
the three online keys. All expirations are explicit — nothing in `rauc-sign`
reads the wall clock, so what a ceremony *signs* is reproducible from its
inputs. The file's bytes are not; see §1.6, step 3.

`--threshold` applies to every role, and today it must be `1`:
`rauc-sign` holds exactly one key per role, and since a threshold
above a role's key count is rejected at `init` rather than producing metadata
no set of signatures can ever satisfy. Multi-key roles, delegated targets and
hardware-backed key stores are explicitly out of phase 1
(`pkgs/rauc-sign/README.md`); when a threshold above 1 becomes possible, this section
gets rewritten around it — until then, writing "use 3-of-5" here would be a
procedure the tooling cannot execute.

### 1.4 Expiry policy

Chosen here so every later `sign` invocation copies rather than decides:

| role | expiry horizon | who re-signs, with what |
| --- | --- | --- |
| `root` | 1 year | the offline ceremony: `refresh-root`, or `rotate-root` (§1.6) |
| `targets` | 6 months | release host, online key, at each release or `sign` |
| `snapshot` | 3 months | release host, online key |
| `timestamp` | 2 weeks | release host, online key, on a calendar reminder |

The short `timestamp` horizon is the freshness guarantee: a mirror serving
stale metadata goes visibly expired within two weeks. The `sign` command
refreshes the three online roles between releases:

```sh
rauc-sign sign --repo <repo> --keys-dir <online-keys> \
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
  of band. Every later `rauc-sign verify --root <this file>` is anchored to
  it. `--root` is required — the tool has no default and never reads the
  repository's own `root.json` as an anchor — but it does not detect an
  operator pointing `--root` back into the repository being verified, so
  this procedure forbids it: that run would prove only internal consistency,
  which an attacker-authored repository has too.
- The ceremony machine's storage is destroyed or wiped after the media are
  written.

### 1.6 Republishing root: the annual refresh, and rotation — **[runbook]**

`root.json` expires (§1.4: one year), and republishing it is **two different
ceremonies**. Performing the wrong one is the failure this section is arranged
to prevent, so decide which this is before reading further:

- **Refresh** — the same key signs a new version with a later expiration. The
  trust anchor does not change hands, so nothing is distributed and no device
  is asked to do anything. This is the ordinary annual event.
- **Rotation** — a *new* root key takes over the role, and the outgoing key is
  revoked. The new version is signed by the outgoing key **as well as** the
  incoming one — TUF's cross-sign — which is what lets a device still pinned to
  the old anchor reach the new one by itself. Do this when the root key is
  compromised or suspected compromised, when custody of it changes, or on a
  deliberate rotation schedule.

The commands are separate for the same reason. `rotate-root` refuses a
`--new-keys-dir` holding the key that already holds the role, and names
`refresh-root` in the refusal; `refresh-root` cannot introduce a key at all.
Neither one can be reached by forgetting an argument to the other.

Both run on the offline machine of §1.1, both need the sealed `root.pk8`, and
**neither reads an online key** — `targets.pk8`, `snapshot.pk8` and
`timestamp.pk8` do not enter the room. Nothing is lost by their absence: no
top-level role's metadata pins `root.json`, so `targets`, `snapshot` and
`timestamp` keep their existing signatures across either ceremony and are
refreshed afterwards on the release host (step 4 below).

**What is carried in.** The `rauc-sign` binary and this checkout (§1.1); the
repository's `metadata/` directory, complete, on media; the sealed `root.pk8`
from §1.5. For a rotation, blank media for the incoming key. Both commands
verify that the `metadata/root.json` they are handed is signed by its own root
keys before building on it and refuse otherwise, so a partial or substituted
copy is caught in the room rather than by the fleet.

**Step 1, for a rotation only: generate the incoming key.**

```sh
rauc-sign gen-dev-keys --keys-dir /ceremony/new-keys --role root
```

`--role root` writes `root.pk8` and nothing else. Generating all four here
would put spare copies of the release host's online keys on offline media that
this ceremony never uses, each then needing its own destruction record.

**Step 2: publish the new root version.** One of these, never both:

```sh
# Rotation: the incoming key takes over; both keys sign.
rauc-sign rotate-root \
  --repo /ceremony/tuf \
  --keys-dir /ceremony/keys \
  --new-keys-dir /ceremony/new-keys \
  --root-expires <RFC 3339, one year out>

# Annual refresh: same key, later expiry, anchor unchanged.
rauc-sign refresh-root \
  --repo /ceremony/tuf \
  --keys-dir /ceremony/keys \
  --root-expires <RFC 3339, one year out>
```

The expiration is explicit, as everywhere else in this tool: nothing reads the
wall clock, so what the ceremony signs is fixed by its inputs (its bytes are
not — step 3). Each command prints the version it published — call it `n` —
and writes `metadata/<n>.root.json` plus the `metadata/root.json` alias.

Neither command will overwrite an already-published `<n>.root.json`: a
published root version is a file some device may already have walked to, and
two different documents under one name is not an update. If that refusal
appears, the `metadata/root.json` in hand is a stale copy of an older version —
take a complete copy of `metadata/` and start again.

Before writing anything, both commands check the result the way the fleet will:
that a threshold of the **outgoing** root's keys signed it, and a threshold of
the **new** root's own. A rotation that would strand devices on either anchor is
refused rather than written to the output media, so there is no in-room
verification step to remember here. (`rauc-sign verify` is not that step and
will usually fail at a root ceremony for an unrelated reason: the `timestamp`
horizon is two weeks, so it is almost certainly expired by the time root is a
year old. Verification is step 5, after the online roles are refreshed.)

**Step 3: the media, and the minutes.** Carry `metadata/` back out. Then, per
§1.5 and in the same custody record:

- Which ceremony this was — refresh or rotation — the date, and who was
  present.
- The root version `n` published, and the sha256 of `metadata/<n>.root.json`.
- For a rotation: the incoming `root.pk8` written to **two or more** offline
  media in separate physical locations, sealed, exactly as §1.5 requires of the
  original — it is now the key that matters.
- For a rotation: the disposition of the **outgoing** `root.pk8`. If this
  rotation is a response to compromise, destroy it now; retaining a compromised
  key buys nothing. Otherwise keep it sealed under §1.5 custody until the fleet
  is known to be on the new anchor, because it is the only thing that could
  re-issue a chain from the old one if the new media are lost, and then destroy
  it and record that.
- The ceremony machine's storage destroyed or wiped.

That sha256 identifies the file as distributed. It is **not** re-derivable by
re-running the command: `root.json`'s `keys` object is serialized in an
unordered map's iteration order, so two runs over identical inputs produce
different bytes carrying the same signature (the signature is computed over
canonical JSON; the file is not written in it). Compare the file you hold
against the recorded digest — never against a fresh run.

**Step 4: refresh the online roles, on the release host.** The root ceremony did
not touch `targets`, `snapshot` or `timestamp`, and at a root's annual expiry
`timestamp` is long past its own two-week horizon:

```sh
rauc-sign sign --repo <repo> --keys-dir <online-keys> \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...
```

**Step 5: prove it, from the anchor devices actually hold.**

```sh
# The one that matters after a rotation: the OLD anchor must still reach the
# repository, walking itself forward to root v<n>. This is the overlap window.
rauc-sign verify --repo <repo> --root <out-of-band copy of the OLD anchor>

# And the new one, for devices provisioned from here on.
rauc-sign verify --repo <repo> --root <out-of-band copy of <n>.root.json>
```

Both must print `OK root v<n> ...`. `--root` is a copy held outside the
repository, never a path back into it (§1.5).

**Step 6, for a rotation only: distribute the new anchor.** Record the sha256
of `metadata/<n>.root.json` in the minutes and distribute the file out of band,
as §1.5 says of the original. This is for **newly provisioned** devices: a
device already carrying an older anchor does not need it, because it reaches
`<n>.root.json` through the repository. How any anchor first reaches a device
is a separate, still-unbuilt question — see the trust anchor provisioning
section of `pkgs/rauc-sign/README.md`.

**Never delete an intermediate root file.** `metadata/1.root.json`,
`metadata/2.root.json`, … all stay served, forever. A device that has been
offline across several rotations walks the chain one version at a time from
whatever anchor it holds; a gap in that sequence is where its walk stops, and
it stops permanently.

**Still not implemented: replacing a compromised *online* key.**
`rotate-root` carries the `targets`, `snapshot` and `timestamp` key bindings
forward unchanged, and no command binds a *different* online key into a new
root version. So the consequence §1.5's host hygiene is holding off is
unchanged: a compromised online key still ends the repository's lineage, and
the recovery is still a fresh ceremony (§1.1–1.5) with a new trust anchor
distributed out of band and devices re-anchored by whatever mechanism ships
anchors to devices — which does not exist either. Rotating the *root* key no
longer requires that, which is the point of the cross-sign; revoking an online
key still does. **[not implemented]**, and narrower than it was.

## 2. The RAUC production CA — **[runbook]** for the ceremony, with a named gap

### 2.1 The offline CA ceremony

This mirrors `pkgs/rauc/gen-dev-keys.sh` step for step — the dev script is the
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

`rauc bundle` takes PEM file paths; there is no HSM/PKCS#11 wiring in the bundle
builder today, so the signer key is a file on the release host and the host's
hygiene is part of the trust model. Worth saying rather than implying.

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

### 2.3 How the keyring reaches devices — at build time; **rotation** is the remaining gap

The keyring reaches a device **in the image**, from one place. The facts:

- `pkgs/rauc/system.conf.in` names `/etc/rauc/keyring.pem`;
  `pkgs/rauc/render-config.sh` renders the generated
  `rootfs/overlay/etc/rauc/system.conf`.
- The repository-root `ca/` directory is the single seam by which a CA enters a
  build: `build` signs bundles with `ca/signer.{cert,key}.pem` and
  `rootfs/build.sh` stages `ca/ca.cert.pem` to `etc/rauc/keyring.pem`. Put
  the CA this runbook produces in `ca/`, build, and the image trusts it. `ca/`
  is gitignored, so the material is never in the history.
- A build that finds `ca/` empty **generates a development-grade root** there,
  says so unmissably, and continues; the generator leaves `ca/GENERATED` beside
  it, and that marker is what keeps such a root recognisable on every later
  build. `rootfs/build.sh` warns off the marker. Production material is
  placed in `ca/` without it.
- The overlay is **not** a source: `rootfs/build.sh` refuses an
  `etc/rauc/keyring.pem` found there, unconditionally, because the overlay is
  copied wholesale into every image and a file left in it is a CA nobody chose.
  `verify/src/checks-root.ts` still fails an image carrying a baked-in
  keyring unless `MOS_EXPECT_DEV_KEYRING=1` names it a bench image, and
  `verify/src/checks-root.test.ts` proves both directions of that gate.
- **The gap that remains is rotation, not provisioning.** `/etc` is a read-only
  squashfs, so replacing the keyring on a deployed device means shipping a new
  image or a channel that survives an A/B update — a STATE-backed seed plus bind
  mount, the way `/etc/ssh` is handled. No such channel exists yet, and §1.4's
  reissue horizon depends on it.

The affirmative half — placing `ca.cert.pem` on the device through a
provisioning-time channel (META partition, factory step, or first-boot
enrolment) rather than baking it into the signed root — is the trust-anchor
provisioning story designed and **completed 2026-08-23** — together with the TUF root anchor from §1.5,
which has the same shape and should ship through the same channel. Until
provisioning ships, this runbook produces a CA whose keyring has no road to a
production device, and says so rather than gesturing at one.

What is pinned down today, so the eventual decision has a fixed place to
land:

- **The read path is settled and testable without a booted device.** What
  RAUC verifies bundles against is `path=` in the rendered
  `/etc/rauc/system.conf`, and two verifier checks hold the contract from
  both directions: `rauc-keyring-path`
  (`verify/src/checks-rauc.ts`) asserts the rendered config names
  exactly `/etc/rauc/keyring.pem` (`pkgs/rauc/system.conf.in`), and
  `packed-keyring-from-ca` (`verify/src/checks-root.ts`) asserts the
  shipped root carries at that path a BYTE-EQUAL copy of `ca/ca.cert.pem` —
  and refuses one that carries anything else, or a development-grade root
  (`ca/GENERATED`) without `MOS_EXPECT_DEV_KEYRING=1`. So the keyring RAUC
  reads is, by the shipped configuration, the CA the build was pointed at.
  Whether it is honoured end to end — `rauc install` accepting a
  production-signed bundle on hardware — is observable only on a booted
  device; that last step stays documented, not tested.
- **How it survives updates.** `/etc` is the read-only dm-verity squashfs,
  replaced whole by every A/B update, so the keyring cannot simply be
  written in place and must not be baked in (§4). A provisioned keyring
  must live on STATE or META and reach `/etc/rauc/keyring.pem` the way
  `/etc/ssh` reaches its path — a seed plus bind mount
  (`rootfs/overlay/usr/lib/mos/mos-seed-state`). No such bind exists
  yet, deliberately: creating one is part of choosing the channel.
- **The open decision, stated as the user's.** Which channel delivers the
  file (STATE/META provisioning file, factory step, first-boot enrolment —
  the same candidates as the TUF root anchor above), and who holds,
  rotates and revokes the signing CA, are product decisions about key
  custody that this repository records and does not make.

## 3. Signing a release bundle — **[runbook]**

On the release host, with the online TUF keys (§1.5) and the RAUC signer
(§2.1) in place, `_out/cx3576/` populated by the mos rootfs build and the BSP
kernel present (the privileged CI lane's deep job,
`.github/workflows/privileged.yml`, runs this same chain with dev keys —
production signing is deliberately **not** a CI step; see §4):

```sh
# 1. Build the prod-profile rootfs and the image inputs.
MOS_PROFILE=prod make os-rootfs-cx3576

# 2. Build and CMS-sign the bundle. Caller-supplied CERT/KEY/KEYRING win over
#    the dev-key defaults on both the host and the container build path --
#    this is the fix; before it, both branches hardcoded .devkeys
#    and no production bundle was buildable at all. KEYRING is used by the
#    script's own read-back verification (rauc info against the shipped
#    system.conf), so passing the production ca.cert.pem here is also the
#    first end-to-end check of the chain.
CERT=/path/to/signer.cert.pem \
KEY=/path/to/signer.key.pem \
KEYRING=/path/to/ca.cert.pem \
    bash build/run.sh --bundle 1.2.3

# 3. Publish into the TUF repository with the online keys. The verity root
#    hash is the bundle's own (verity-format) root hash as `rauc info`
#    reports it -- rauc-sign never shells out to rauc, so it is supplied
#    explicitly and deliberately.
rauc-sign add \
  --repo <repo> --keys-dir <online-keys> \
  --target _out/cx3576/mos-cx3576-<epoch>.raucb \
  --verity-root-hash <64 hex> \
  --release-version 1.2.3 \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...

# 4. Verify the published repository as a CLIENT would, against the ceremony
#    trust anchor from 1.5 -- never against the repository's own root.json
#    (1.5). --datastore persists trusted metadata so the
#    NEXT release's verify also proves no rollback happened between them.
rauc-sign verify --repo <repo> --root /trusted/root.json --datastore /var/lib/rauc-sign/trusted
```

Then publish `<repo>` as static content (`pkgs/rauc-sign/README.md`'s layout). The
offline "lockbox" workflow is planned and not implemented; when it exists it
will consume the same signed artifacts.

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
- **No dev CA on a shipped device.** A generated trust root carries
  `ca/GENERATED`, so the build says loudly which images trust one and the
  verifier fails such an image closed unless `MOS_EXPECT_DEV_KEYRING=1` names it
  a bench image. That variable is a bench waiver, not a build option, and
  nothing that leaves a desk is built with it.
- **No expiry decided ad hoc.** The horizons in §1.4 and §2.1 are the
  policy; a `sign` invocation that invents a different horizon is a change
  to this document first.
- **No `--allow-rollback` outside a recorded incident.**
- **No keyring baked into the signed root filesystem** — even the production
  one, tempting as it is as a shortcut past §2.3: a keyring inside the
  dm-verity-sealed root can only ever be replaced by a full image update
  signed by the very CA being replaced, which is exactly the circularity a
  provisioning-time trust anchor exists to break.
