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

**Independence, stated as facts about files rather than intent.** The two
domains share no key material and no single file whose compromise breaks
both. The RAUC domain's material is the repository-root `ca/` directory (RSA
X.509, PEM: `ca.key.pem`, `ca.cert.pem`, `signer.key.pem`,
`signer.cert.pem`) and nothing else reads or writes it but the RAUC build
surfaces (`pkgs/rauc/gen-dev-keys.sh`, `build/src/bundle.ts`,
`rootfs/build.sh`). The TUF domain's material is a `<role>.pk8` directory
(ed25519, raw PKCS#8 — `pkgs/rauc-sign/.devkeys/` in development, the §1
ceremony media in production) and nothing reads it but `rauc-sign`. Either
directory can be wiped and re-provisioned without touching the other; both
are gitignored. `tests/trust-domain-hygiene-test.sh` re-proves all of this
on every run — no tracked key material, both directories ignored, neither
domain's tooling naming the other's files — so the separation is enforced,
not remembered.

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

### 1.7 Replacing a compromised *online* key — **[runbook]**

`rotate-online` is the recovery for a compromised (or retiring) release host:
it publishes the next root version with **fresh** `targets`, `snapshot` and
`timestamp` keys bound, revoking the outgoing ones. The trust anchor does not
change hands — the root role's binding is untouched — so nothing is
distributed to devices and no §1.6 rotation is implied. What §1.5's host
hygiene is holding off is therefore no longer the end of the repository's
lineage: an online-key compromise is now a ceremony, not a fresh repository.

Same room as §1.1, same sealed `root.pk8`, same complete `metadata/` carried
in on media. Blank media for the incoming online keys.

**Step 1: generate the incoming online keys.**

```sh
rauc-sign gen-dev-keys --keys-dir /ceremony/new-online \
  --role targets --role snapshot --role timestamp
```

Three roles and not four: the root key is not being replaced, and a spare
copy of it on media bound for the release host would be a custody violation,
not a convenience.

**Step 2: publish.**

```sh
rauc-sign rotate-online \
  --repo /ceremony/tuf \
  --keys-dir /ceremony/keys \
  --new-keys-dir /ceremony/new-online \
  --root-expires <RFC 3339, one year out> \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...
```

Unlike the §1.6 ceremonies this one cannot stop at the root document: the
repository's `targets`, `snapshot` and `timestamp` are signed by the very
keys being revoked, and a repository left that way would be refused whole by
every client that walks to the new root. So the command re-signs the three
online roles with the incoming keys in the same run — target entries carried
forward unchanged, every online version bumped — which is why it takes the
three online expirations that `sign` normally takes. The §1.6 refusals still
hold: an incumbent key offered as "new" is refused naming the role, a
published `<n>.root.json` is never rewritten, and both root-threshold checks
run before anything is written.

**Step 3: the media, and the minutes.** Per §1.5, in the custody record: the
root version published and its sha256; the incoming online keys carried to
the release host on media that is wiped afterwards; the **outgoing** online
keys destroyed — they are revoked, and if this ceremony is a response to
compromise, the incident recorded. The anchor is unchanged, so there is
nothing to distribute.

**Step 4: prove it, from a held anchor.**

```sh
rauc-sign verify --repo <repo> --root <out-of-band anchor copy>
```

Must print `OK root v<n> ...`. A device pinned to any earlier anchor walks to
the new root and accepts only metadata the incoming keys sign;
`pkgs/rauc-sign/tests/online_rotation.rs` proves both directions — the walk
succeeds, and metadata the revoked keys sign afterwards is refused by signer
and client alike.

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
# them. Validity 15 years: the 2.4 rollover can replace a fielded keyring,
# but only on devices that take the overlap update -- a device that misses
# the window keeps this CA until reflash or the (missing) 2.3 provisioning
# path, so the CA must outlive the fleet, and an expired baked keyring
# bricks updates on every device at once.
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
verifies until the CA itself is replaced. Replacing the CA is the §2.4
rollover; read its compromise caveat before treating it as the remedy, because
a rollover shipped through the update channel is signed by the very chain
being retired. Record the incident; ship the fleet-wide mitigation through
the update itself if one is warranted.

### 2.3 How the keyring reaches devices — at build time; the update channel carries rotation

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
  `verify/src/checks-root.ts` fails an image whose keyring is not byte-equal
  to `ca/ca.cert.pem`, and `verify/src/checks-root.test.ts` proves both
  directions of that gate.
- **Rotation rides the update channel, with a bounded residue.** `/etc` is a
  read-only squashfs replaced whole by every A/B update, so the keyring cannot
  be edited in place — but it CAN be replaced by the update itself, and the
  keyring is a CA *file*, not a single certificate, so old and new can coexist
  in it during a rollover. §2.4 is that procedure. What it cannot cover —
  devices that miss the overlap window, and rotation away from a CA that is
  already compromised — still needs a trust channel outside the image (the
  STATE-backed seed plus bind mount, the way `/etc/ssh` is handled), which
  does not exist yet.

The affirmative half — placing `ca.cert.pem` on the device through a
provisioning-time channel (META partition, factory step, or first-boot
enrolment) rather than relying on the image to carry it — is the trust-anchor
provisioning story, designed together with the TUF root anchor from §1.5,
which has the same shape and should ship through the same channel. Until that
channel ships, the image IS the road (§2.5), the update channel carries
rotation (§2.4), and the two cases the image cannot carry — missed overlap
windows and CA compromise — are named where they arise instead of gestured
past.

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
  and refuses one that carries anything else. Whether that root is
  development-grade (`ca/GENERATED`) is stated in the verdict, not refused. So
  the keyring RAUC reads is, by the shipped configuration, the CA the build was
  pointed at.
  Whether it is honoured end to end — `rauc install` accepting a
  production-signed bundle on hardware — is observable only on a booted
  device; that last step stays documented, not tested.
- **How it survives updates.** `/etc` is the read-only dm-verity squashfs,
  replaced whole by every A/B update, so the baked keyring is whatever the
  installed image's build staged from `ca/` — which is what makes §2.4's
  overlap update work, and what makes it the only writer. A *provisioned*
  keyring — the future channel — would instead live on STATE or META and
  reach `/etc/rauc/keyring.pem` the way `/etc/ssh` reaches its path — a
  seed plus bind mount (`rootfs/overlay/usr/lib/mos/mos-seed-state`). No
  such bind exists yet, deliberately: creating one is part of choosing the
  channel.
- **The open decision, stated as the user's.** Which channel delivers the
  file (STATE/META provisioning file, factory step, first-boot enrolment —
  the same candidates as the TUF root anchor above), and who holds,
  rotates and revokes the signing CA, are product decisions about key
  custody that this repository records and does not make.

### 2.4 CA rollover: old and new coexist in one keyring — **[runbook]**, with a compromise caveat

The keyring RAUC verifies against is an OpenSSL CA file: concatenated PEM
certificates, every one of them trusted. That is the whole rollover
mechanism, and `tests/rauc-trust-negative-test.sh` proves its three
properties host-side — a keyring holding the outgoing and the incoming CA
accepts bundles chained to either, and still refuses a third party.

The procedure, one phase per fleet-visible state:

1. **Mint the incoming CA** — the §2.1 ceremony, again, on the offline
   machine. The outgoing CA's media stay sealed; nothing here reads its key.
2. **The overlap update.** On the build host, `ca/ca.cert.pem` becomes the
   concatenation — outgoing certificate first, incoming appended
   (`cat old-ca.cert.pem new-ca.cert.pem > ca/ca.cert.pem`); `ca/signer.*`
   stay the OUTGOING signer's. Build and release as normal (§3). The bundle
   chains to the old CA, so every fielded device installs it; the image it
   installs carries the two-certificate keyring. The verifier's
   `packed-keyring-from-ca` check is byte-equality against `ca/ca.cert.pem`,
   so the concatenated file flows through the build and the checks unchanged.
3. **Switch the signer.** Once the fleet has converged on the overlap image
   — convergence is measured by whatever fleet telemetry exists, and waiting
   is the cost of not stranding anyone — replace `ca/signer.{cert,key}.pem`
   with a signer issued by the INCOMING CA (§2.1's signer step). Bundles now
   chain to the new CA; devices on the overlap keyring accept them. A device
   that missed the overlap window refuses them and is stranded — recoverable
   only by physical reflash until the out-of-image trust channel (§2.3)
   exists.
4. **The retirement update.** `ca/ca.cert.pem` becomes the incoming
   certificate alone; build and release, signed by the new chain. Destroy or
   retire the outgoing CA key under the §1.5 custody rules, and record it.

**The compromise caveat, stated plainly.** Every update in this procedure is
signed by a chain the device already trusts, so a *scheduled* rotation is
sound. Rotation away from a **compromised** CA is not: the attacker holds the
same signing power the rollover update uses, and can race it or sign a
"rollover" of their own. Recovery from CA compromise therefore needs a trust
channel the CA does not control — the provisioning-time channel of §2.3,
which does not exist yet. Until it does, CA compromise means physical
re-provisioning, and this runbook says so rather than implying the rollover
covers it. **[not implemented]** — the out-of-image channel only; every step
above it is executable today.

### 2.5 Production provisioning: the operator steps, and what the build then does — **[runbook]** host-side

Placing production material, exactly:

```sh
# On the build host, from the §2.1 ceremony's public/host-side outputs:
mkdir -p ca && chmod 0700 ca
cp <media>/ca.cert.pem     ca/ca.cert.pem      # the keyring (public)
cp <media>/signer.cert.pem ca/signer.cert.pem  # the bundle signer cert
cp <media>/signer.key.pem  ca/signer.key.pem   # the bundle signer key
chmod 0600 ca/signer.key.pem
# ca/ca.key.pem does NOT exist here: the CA key never touches this host.
# ca/GENERATED does NOT exist here: that marker means "development-grade",
# and nothing may write it but pkgs/rauc/gen-dev-keys.sh.
```

What the build does with that, each step observable without hardware:

- `pkgs/rauc/gen-dev-keys.sh --if-absent` (run by every build entry) finds
  the four files it checks for complete and exits silently — it generates
  only into an empty or half-written `ca/`, and refuses to overwrite
  otherwise. No development-keyring banner is printed, because the banner
  keys off generation, not presence.
- `rootfs/build.sh` stages `ca/ca.cert.pem` into the image at
  `/etc/rauc/keyring.pem`, and does not warn: the warning keys off
  `ca/GENERATED`, which production material does not carry.
- The bundle build signs with `ca/signer.{cert,key}.pem` and read-backs
  through the shipped `system.conf` against the same keyring (§3).
- `make os-verify-cx3576` passes `packed-keyring-from-ca`: the shipped keyring
  is byte-equal to `ca/ca.cert.pem`. When a marker names that root
  development-grade the check says so in the verdict rather than refusing, so a
  dev image cannot masquerade as production in a transcript —
  `verify/src/checks-root.test.ts` holds both readings.

The TUF half of provisioning — pinning the production `root.json` on the
device — has no tooling road yet: the anchor is distributed out of band
(§1.5) and `rauc-verify --root` consumes wherever an integrator placed it.
The candidate channels and their tradeoffs are recorded in
`pkgs/rauc-sign/README.md` (image-baked, STATE/META provisioning file,
signed USB import), all **[not implemented]**; choosing one is the same
product decision as the keyring channel above, and this runbook does not
pre-empt it.

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
#    explicitly and deliberately. --manifest pins the gated release's
#    manifest.json as its own TUF target beside the bundle
#    (<bundle>.manifest.json, sha256+length) and stamps the bundle target's
#    custom block with the manifest's board/profile/channel/version and
#    schema version -- the SIGNED facts rauc-update's selection reads, so
#    device-side compatibility needs no unsigned side channel. A manifest
#    that does not pin this bundle's sha256 is refused.
rauc-sign add \
  --repo <repo> --keys-dir <online-keys> \
  --target _out/cx3576/mos-cx3576-<epoch>.raucb \
  --verity-root-hash <64 hex> \
  --release-version 1.2.3 \
  --manifest _out/cx3576/release/manifest.json \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...

# 4. Verify the published repository as a CLIENT would, against the ceremony
#    trust anchor from 1.5 -- never against the repository's own root.json
#    (1.5). --datastore persists trusted metadata so the
#    NEXT release's verify also proves no rollback happened between them.
rauc-sign verify --repo <repo> --root /trusted/root.json --datastore /var/lib/rauc-sign/trusted
```

Then publish `<repo>` as static content (`pkgs/rauc-sign/README.md`'s
layout). Any web server or object store that serves the directory unchanged
will do; range requests are the one feature the device client uses.

### 3.1 The device-side update client — **[runbook]**; shipped in the image and driven by mosd

`rauc-update` (same crate) consumes what §3 publishes. Its verification is
`rauc-verify`'s walk — pinned root, persistent rollback state — with
transport and policy on top, and no flag on any subcommand skips metadata or
digest verification. The operator sequence on a device (or a bench shell):

```sh
# 1. Mirror the metadata over plain HTTP (or rsync the repo and skip this).
#    The mirror is unverified input; step 2 is what trusts or refuses it.
rauc-update sync --url http://mirror.example/tuf --repo /var/lib/mos/tuf-mirror

# 2. Verify from the pinned anchor and select the newest compatible target:
#    board+profile (identity below), channel (default stable), manifest
#    schema floor (equality with 1), version strictly newer than running.
#    Prints every rejected candidate with its reason; "none" exits 2.
#    A downgrade needs --allow-downgrade and is logged to stderr.
rauc-update check \
  --repo /var/lib/mos/tuf-mirror --root <pinned root.json> --state <state.json>

# 3. Probe the /mos/updates workspace (DATA mounted, writable, not
#    exhausted — exit 3 and a `<status> <kind>: ...` line otherwise), then
#    download resumably (HTTP range requests) into /mos/updates/downloads.
#    The completed size never exceeds --max-bytes together with what the
#    workspace already holds; a digest mismatch deletes the partial; the
#    verified bundle is renamed into /mos/updates/verified and that path is
#    the last stdout line. There is no flag that stages anywhere else.
rauc-update fetch \
  --repo /var/lib/mos/tuf-mirror --root <pinned root.json> --state <state.json> \
  --url http://mirror.example/tuf --max-bytes <n>

# 4. Hand off. The orchestrated route is mosd's D-Bus member:
busctl call com.mos.mosd /com/mos/mosd com.mos.mosd1 InstallUpdate s <path>
#    The direct fallback (also what `rauc-update fetch --install` runs):
rauc install <path>
```

Both binaries are in the image. The `mos-rauc-update` package
(`pkgs/rauc-sign/deb/rauc-update`) installs `/usr/bin/rauc-update` and
`/usr/bin/rauc-verify` on both boards, through `feature-rauc.pkgs` — so
declining `rauc` declines the client with the installer it feeds. The
release-side `rauc-sign` is not in that package and never will be: it loads
the offline keys and runs where §1 runs.

Device identity comes from `/usr/share/mos/release-identity.env`
(`BOARD=`/`PROFILE=`/`VERSION=` lines) or explicit
`--board`/`--profile`/`--current-version` flags, and the image pipeline now
writes that file: `rootfs/compose/compose-install.sh` renders the three
lines from the board, the profile and the pool version the composition was
given — build arguments only, so two builds of one tree write one file — and
`verify`'s `packed-release-identity` refuses an image whose file disagrees
with its own board, its own profile marker or its own
`/usr/share/mos/manifest.tsv`.

**What `VERSION` is, stated because it is not what a reader assumes.** It is
the POOL version — `<workspace version>+git<commit>[.dirty]-1`, the string
`build-env/deb/version.sh` prints — and not a marketing release number. It
is the one version an image build can measure about itself; the release
version in §3's signed manifest is chosen at bundle time and no image input
carries it. The consequence for selection: `compare_versions` splits on `.`
and compares numerically where both sides parse, so a release published as
`1.0.0` orders above `0.1.0+git…-1` and is offered, while two images built
from different commits at one workspace version compare EQUAL — a bundle
built from such a pair is a downgrade unless `--allow-downgrade` is passed.
Binding the identity to a real release version is owed, and is the same
decision as choosing where the release version enters the image build.

Nothing above waits for an operator any more: mosd drives this client. Its
update lifecycle runs `rauc-update probe`/`sync`/`check`/`fetch` as bounded
subprocesses and a policy file (`/var/lib/mos/update-policy.toml`) sets the
auto-check cadence (`docs/design/updates.md`). Where the bytes go is not a
flag but PLAN-061's contract on PLAN-063's layout: partial downloads only
in `/mos/updates/downloads`, a verified bundle moved into
`/mos/updates/verified` by one same-filesystem rename, transaction-local
work in `/mos/updates/staging`, and RAUC handed only a path in `verified/`.
The workspace is created by `mos-data-layout` on the DATA pool; the client
probes it before the first byte (mount source resolves to `/mnt/data`, no
symlink substitution, not read-only, a private probe file written and
removed, the pool's free space against the budget) and refuses with a named
`unavailable`/`degraded` verdict instead of writing anywhere else
(`updates.md` §1.1). What is still owed is the rest of the image-side
contract: **[not implemented]** the pinned `root.json` is provisioned by
nothing (§2.5's last paragraph), nothing provisions the `/var/lib/mos/update/`
tree that policy defaults to for the metadata mirror and rollback state, and
`mos-health` does not report `health.boot` — the entry that lifts the
lifecycle past `validating`. How many bytes `--max-bytes` may promise of the
pool is a storage-policy decision owned outside this crate (PLAN-049); the
client refuses to exceed the budget or start a download the pool visibly
cannot hold, and that is its whole side of the bargain.

Transport is plain HTTP by design: integrity and authenticity come from the
signed metadata (a hostile mirror yields a refusal), confidentiality is not
provided — terminate TLS at a local proxy or sync the repository out of band
if it is needed.

### 3.2 The offline lockbox — **[runbook]**

The USB/SD path for devices without a network route. On the release host:

```sh
# The complete metadata set plus the named bundle and its pinned manifest
# (all targets when none is named). No key is read; this is file copies.
rauc-sign lockbox --repo <repo> --out /media/usb/lockbox \
  --target mos-cx3576-<epoch>.raucb
```

On the device, with the media mounted:

```sh
rauc-update import \
  --lockbox /media/usb/lockbox --root <pinned root.json> --state <state.json> \
  --max-bytes <n>
```

`import` verifies exactly as online — same pinned anchor, same rollback
state, same selection, same digest gate, same workspace probe — then copies
the bundle through `/mos/updates/staging` into `/mos/updates/verified`,
which is the path to install (the file on the media itself is never one). A
lockbox carrying stale metadata is refused by the state file; a
tampered bundle is refused by the digest; there is no import that bypasses
either. The metadata in a lockbox is carried verbatim (no key leaves §1.5's
custody to produce one), so a partial lockbox lists targets it does not
carry: `import` verifies the target it selects, and only a full lockbox
passes `rauc-sign verify` whole.

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
  verifier names the grade it read. Which material is in `ca/` is chosen before
  the build — by the release pipeline, not by a flag at verify time. No gate in
  this repository yet refuses to PUBLISH an image built on a generated root;
  that assertion belongs to the release gate and does not exist.
- **No expiry decided ad hoc.** The horizons in §1.4 and §2.1 are the
  policy; a `sign` invocation that invents a different horizon is a change
  to this document first.
- **No `--allow-rollback` outside a recorded incident.**
- **No keyring from anywhere but `ca/`.** The keyring in the signed root is
  staged from `ca/` and byte-checked against it (`packed-keyring-from-ca`);
  one found in the overlay is refused unconditionally. And no pretending the
  baked keyring solves rotation: a keyring inside the dm-verity-sealed root
  is replaced only by an image update a currently-trusted CA signed — §2.4's
  overlap makes that sound for a scheduled rotation and says plainly that it
  cannot recover from CA compromise, which is what the provisioning-time
  trust channel (§2.3) remains owed for.
