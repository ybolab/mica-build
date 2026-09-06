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
- **[decided absent]** — no tooling exists for this step and none is owed at
  this level: its answer is the physical one, chosen with the reason recorded
  beside it. It is spelled differently from `[not implemented]` because the
  two are read differently — one is a debt a reader may reasonably expect to
  be paid, the other is a product position they have to plan a fleet around.
  §2.4a is the only instance, and it names the one open decision that would
  turn it back into a debt.

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
both. The RAUC domain's material is the repository-root `meta/rauc/` directory
(X.509, PEM: `ca.key.pem`, `ca.cert.pem`, `signer.key.pem`,
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

**The handover is a different document.** Everything below is written for the
person standing in the room. [`key-delivery.md`](key-delivery.md) picks up
where each ceremony stops: what may travel and what never does, how material
reaches a recipient, what that recipient checks before building anything, and
which refusal fires when the material is wrong.

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

**Run `init` twice: a production repository and a rescue repository.** The
second is the same command with a different `--repo`, rooted at the same root
key, and it stays empty until §2.4a case 1 needs it — a repository holding one
old-chain release is what recovers a device that missed a keyring rollover,
and it must be rooted at the root the fleet's baked `trust.signingKeys`
already name. Because `init` is the only command that touches `root.pk8`,
creating it later is an offline root-key checkout during an incident; creating
it now, while the key is already out of its envelope, costs one command. Its
standing cost is that it joins the re-sign cadence (§1.4, and
`docs/plan/PLAN-071.md` §9.6's freshness bound) like any other repository — a
rescue repository whose timestamp has expired is refused as stale by the
device it exists to rescue.

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

## 2. The RAUC production CA — **[runbook]** for the ceremony; the gap it names is now decided

### 2.1 The offline CA ceremony

This mirrors `pkgs/rauc/gen-dev-keys.sh` step for step — the dev script is the
tested shape, and deviating from a tested shape in a ceremony is how typos
become fleet incidents — with the three choices that distinguish production:
a real subject, real validity horizons, and offline custody. Same machine
discipline as §1.1. openssl is the only tool.

**One mechanical difference, so a reader diffing the two does not read it as
drift.** Since 2026-09-05 the dev script mints inside
`localhost/mos-build-openssl` rather than with whatever openssl is on the host
(PLAN-080 §0.1: the material it writes is baked into every image, which makes
openssl a producer there). A container cannot see the calling shell's file
descriptors, so the signer's `-extfile` is a real file in the script and stays a
`<(...)` here — the same two lines, the same certificate. The ceremony machine
is offline and outside the build; its openssl is the operator's, as it must be.

**What the ceremony and the generator must agree on is the SET, not the
default — with one exception, and it is the signer's validity.** The algorithm
each key role gets is a declared value in `pkgs/rauc/key-algorithms.env`, and
the values there are development defaults; this block is a shell block a human
copies onto an offline machine that may hold no checkout, so it cannot source
that file and is not asked to. The **allowed set** for both RAUC roles is `ecdsa-p256`, `ecdsa-p384`, `rsa-3072`,
`rsa-4096`, and it is bounded by RAUC's own verifier — OpenSSL's CMS
implementation, which verifies RSA and EC alike, and a keyring that is an
OpenSSL CA file either way. A production CA that differs from the development
default is **not drift**; it is the ceremony doing its job. What is not
permitted is a value outside the set, and that is mechanical rather than a
sentence somebody re-checks: `rootfs/build.sh` reads the material actually
present in `meta/` and refuses a build whose CA, signer or package key is
outside its role's set, naming the verifier that bounds it.

**The reason for the values below is production's own, and it is not the dev
script's.** The generator used to record RSA on the ground that PKCS#1 v1.5
signatures are deterministic, so two builds of one bundle differ only in the
CMS `signingTime`. That reason was measured and does not hold: the bundle
rebuild gate hashes the squashfs payload at the head of the bundle and excludes
the signature on purpose, and byte-identical bundles are unreachable whatever
key signs them because rauc salts the bundle's own dm-verity hash tree at
random. Determinism is therefore not why a production CA is RSA. The reason is
conservatism about a key that cannot be rotated cheaply: RSA-4096 is the most
widely fielded thing an OpenSSL CMS verifier will check, on a certificate that
has to outlive every device it signs for and that a missed rollover window
strands until reflash. A ceremony that prefers `ecdsa-p384` for the same
15-year horizon is inside the set and is a decision to record in the minutes,
not a deviation to justify.

**The signer's validity is the exception, and it is a VALUE this ceremony is
held to rather than a default it may depart from.** It is declared once, in
`pkgs/rauc/key-validity.env`, with the reason for the number beside it;
`pkgs/rauc/gen-dev-keys.sh` mints from that declaration, and
`build/src/signer-window.test.ts` asserts that the `-days` on the signer step
below is the same number. That gate exists because this block cannot source the
file: two literals that agree today are exactly the arrangement in which one of
them moves and both go on looking correct. A ceremony that wants a different
window changes the declaration — which moves this block, the development mint
and the build's refusal threshold together — rather than editing the line
below. The CA's own `-days` is deliberately **not** covered by it: the CA must
outlive the fleet and the signer must not, and binding the two would shorten the
baked keyring to the signer's window.

```sh
umask 0077

# The CA. RSA 4096 for a key that must outlive every device it signs for; see
# the note above for why, and for the set this value has to be inside.
# CA:TRUE pathlen:0 -- it signs signer certificates and nothing below
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

# The signer. SHORT-LIVED, and the number is pkgs/rauc/key-validity.env's
# MOS_RAUC_SIGNER_VALIDITY_DAYS -- see the note above, and that file for why the
# value is what it is. Reissuing a signer needs the CA key and no fleet update:
# devices trust the CA, so a new signer chains without touching any keyring.
# What the window buys is the only revocation this design has -- there is no CRL
# path to devices, so a stolen signer is out-waited, and the window IS the wait.
# A CA and its signer may legitimately differ in algorithm; both are bounded by
# the one set.
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
    -out signer.cert.pem -days 45 -sha256 \
    -extfile <(printf '%s\n' \
        "basicConstraints=critical,CA:FALSE" \
        "keyUsage=critical,digitalSignature")

openssl verify -CAfile ca.cert.pem signer.cert.pem
```

Custody, mirroring §1.5: `ca.key.pem` stays offline on sealed media, two
copies, two locations — it is needed once per signer reissue, which under
PLAN-078 §4a's decision is **monthly**, eleven or so ceremonies a year rather
than one every two years. That is the price of option (a): no intermediate CA,
so the root itself mints every short-lived signer, and every checkout is an
exposure and a custody-record entry. §2.2 is the recurring procedure.
`signer.key.pem` and `signer.cert.pem` go to the release signing host.
`ca.cert.pem` is public: it is the keyring, and its sha256 goes in the
ceremony minutes next to root.json's.

`rauc bundle` takes PEM file paths; there is no HSM/PKCS#11 wiring in the bundle
builder today, so the signer key is a file on the release host and the host's
hygiene is part of the trust model. Worth saying rather than implying.

### 2.2 Signer reissue — a monthly cadence, and repairing what expires behind it

The signer is **short-lived**: `pkgs/rauc/key-validity.env` declares the window
in days with the reason for the number beside it, and §2.1's mint reads that
declaration. What the window buys is the only revocation this design has. There
is no CRL path to devices, so a stolen signer is not revoked, it is
**out-waited** — and the window *is* the wait. §2.4 is a different remedy for a
different key; read its compromise caveat before reaching for it.

**The ceremony is recurring.** Under PLAN-078 §4a the shipping organisation
took option (a), monthly root access: the root CA issues every signer directly,
with no intermediate, and `basicConstraints` stays `pathlen:0`. So a reissue is
a **root ceremony** — minutes, witness, sealed medium in and out — eleven or so
times a year rather than once every two. §1.5's custody record applies to every
one of them, and the risk that goes with the frequency is stated rather than
hoped away: *the more often a ceremony runs, the more likely it is to be run
casually.* A recurring-ceremony runbook saying what a monthly run may skip and
what it may never skip is owed to PLAN-077 §7, which was written for a one-time
event; until it exists, run the full §2.1 signer steps each time.

The steps themselves are unchanged and small: with the CA media checked out
under the custody record, new key + CSR as in §2.1, sign with the CA, carry the
new pair to the release host, destroy the old signer key. **No device is
touched** — devices trust the CA, so a new signer chains without any keyring
changing anywhere.

**The build is what stops a slipped calendar becoming an outage**, and it has
two lines rather than one:

- `build/src/tools/rauc.ts` passes `--keyring` at signing time, so `rauc bundle`
  verifies what it just signed and prints *"Certificate 1 (…) will expire in
  less than a month!"* inside rauc's own 30-day band. That warning is upstream's
  and its threshold is not configurable here. It did not fire in this tree
  before: `bundleArgs` passed no keyring, and `rauc info --keyring` does not
  emit it either, so the runway the window was chosen for was runway before a
  warning nobody received.
- Inside `MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS` the build **refuses** to sign
  at all, naming the `notAfter` it read and the file that declares the
  threshold. It refuses rather than warning on `pkgs/rauc/versions.env`'s
  precedent — recording a hash is an act, and so is convening a ceremony — and
  because under option (a) a missed reissue needs a root ceremony scheduled at
  short notice, during which nothing ships.

A signer that expires with no reissue therefore stops the release line, loudly
and before the fact rather than after it. That is the standing operational
commitment the window buys; an organisation that cannot keep the cadence should
lengthen the declared window deliberately rather than discover it by missing a
date.

#### What expiry costs the archive, and the repair — **[runbook]**

An expired signer does not only stop new releases. RAUC 1.13 verifies a
certificate's validity **against the current clock**, so `rauc install` of an
**archived** `.raucb` whose signer has since expired is refused, at the
`Verifying signature` step. Three populations, priced separately:

- **A factory reflash to a known-good older release is unaffected.** A reflash
  writes the release's `.img`, which carries no CMS signature and which RAUC
  never verifies (`release-artifacts.md` §1). Signer expiry touches the
  `.raucb` path only.
- **The release side's own archive is repairable**, by the procedure below.
- **A customer holding a downloaded `.raucb` cannot repair it** and must
  re-download. This is the population that genuinely loses something; what they
  lose is a stale local copy, not their device, and the current release is
  always installable.

The repair is `rauc resign` under a signer reissued from the **unchanged** CA.
It needs one thing that looks alarming and is not, provided it stays where it
belongs:

```sh
# ON THE RELEASE HOST, in the release host's OWN rauc configuration.
# NEVER on a device, and never in pkgs/rauc/system.conf.in -- see the warning
# below, which is the most important sentence in this section.
cat > /etc/rauc/release-host.conf <<'CONF'
[system]
compatible=release-host
bootloader=grub
bundle-formats=verity

[keyring]
path=/path/to/ca.cert.pem
use-bundle-signing-time=true
CONF

# Re-sign one archived bundle with the reissued signer. The payload is not
# rebuilt: only the CMS signature changes.
rauc --conf /etc/rauc/release-host.conf resign \
    --cert signer.cert.pem --key signer.key.pem \
    archived.raucb resigned.raucb
```

Why the setting is needed here and nowhere else: `resign` verifies the
**incoming** signature first, against the same clock as everything else, so
without it the repair fails for exactly the reason the repair exists. With it,
the release host evaluates the old signature at the CMS `signingTime` — which
is sound *for its own archive*, because the release host is the party that
signed it and is curating its own material. The resigned bundle then installs on
an **unchanged** device running the default semantics, and the payload is
byte-identical: only the CMS changed. All of this is measured, in PLAN-078
§R7–R10.

> **`use-bundle-signing-time=true` MUST NEVER REACH A DEVICE.** On a device it
> replaces "is this signer valid now" with "was it valid at the time the signer
> claims it signed" — a timestamp the key holder chooses. Measured (PLAN-078
> §M10): with it set, a bundle signed by a signer that had **expired 370 days
> earlier**, with the signing host's clock rolled back into its old window, was
> ACCEPTED. It is not a milder expiry; it is none, and it silently deletes
> everything this section is for. The release host's configuration file and the
> device's are **different objects and must never be copies of each other**;
> `verify/src/checks-rauc.ts`'s `rauc-keyring-verifies-against-now` refuses an
> image whose rendered `/etc/rauc/system.conf` sets the key at all — including
> spelled `false`, because a config that says `false` is a config somebody
> edited and the next edit is the one that says `true`.

**A resigned bundle is a NEW release record, not an in-place edit.** Re-signing
changes the bundle's bytes and therefore its `sha256`, which
`release-artifacts.md` §1 pins in `SHA256SUMS` and §3 records in
`manifest.json`'s `artifacts[]`. The publication gate must see a repaired bundle
as a new record with a named reason. **That record is not designed yet** —
PLAN-078 §9 carries it as a backlog item blocked on the coupling above — so
until it is, a repair is an incident-time procedure with a written reason, not a
routine one.

**Re-signing the whole archive on a schedule is deliberately not the answer.**
It would restore "old bundles work forever" and with it the property expiry
exists to remove: an attacker's bundle would be re-signed along with everyone
else's unless someone curated the list, and a curation step nobody performs is
an audit that does not happen. Repair is **on demand, per bundle, with a named
reason**, and the reason belongs in the release record.

**What this does not cover.** A compromised **CA** is untouched by any of it: an
attacker holding the CA key mints their own fresh signer whenever they like, and
neither a short window nor a CRL helps when the thing being replaced is what
signs them. That is §2.4's problem, with §2.4's caveat.

### 2.3 How the keyring reaches devices — at build time; the update channel carries rotation

The keyring reaches a device **in the image**, from one place. The facts:

- `pkgs/rauc/system.conf.in` names `/etc/rauc/keyring.pem`;
  `pkgs/rauc/render-config.sh` renders the generated
  `rootfs/overlay/etc/rauc/system.conf`.
- The repository-root `meta/rauc/` directory is the single seam by which a CA enters a
  build: `build` signs bundles with `meta/rauc/signer.{cert,key}.pem` and
  `rootfs/build.sh` stages `meta/rauc/ca.cert.pem` to `etc/rauc/keyring.pem`. Put
  the CA this runbook produces in `meta/rauc/`, build, and the image trusts it. `meta/rauc/`
  is gitignored, so the material is never in the history.
- A build that finds `meta/rauc/` empty **generates a development-grade root** there,
  says so unmissably, and continues; the generator leaves `meta/GENERATED` beside
  it, and that marker is what keeps such a root recognisable on every later
  build. `rootfs/build.sh` warns off the marker. Production material is
  placed in `meta/rauc/` without it.
- The overlay is **not** a source: `rootfs/build.sh` refuses an
  `etc/rauc/keyring.pem` found there, unconditionally, because the overlay is
  copied wholesale into every image and a file left in it is a CA nobody chose.
  `verify/src/checks-root.ts` fails an image whose keyring is not byte-equal
  to `meta/rauc/ca.cert.pem`, and `verify/src/checks-root.test.ts` proves both
  directions of that gate.
- **Rotation rides the update channel, with a bounded residue.** `/etc` is a
  read-only squashfs replaced whole by every A/B update, so the keyring cannot
  be edited in place — but it CAN be replaced by the update itself, and the
  keyring is a CA *file*, not a single certificate, so old and new can coexist
  in it during a rollover. §2.4 is that procedure. The two states it cannot
  reach — a device that missed the overlap window, and rotation away from a CA
  that is already compromised — are **§2.4a**, which says what the answer is
  for each rather than leaving them as an absence. One of the two is an update
  and needs nothing this tree does not ship; the other is a reflash, and that
  is a decision rather than an omission.

The affirmative half — placing `ca.cert.pem` on the device through a
provisioning-time channel (META partition, factory step, or first-boot
enrolment) rather than relying on the image to carry it — is the trust-anchor
provisioning story, and **no such channel exists or is owed for 1.0**. The
image IS the road (§2.5), the update channel carries rotation (§2.4), and
§2.4a records what happens in the two cases the image cannot carry. The
reason that is a position rather than a shrug is worth having here as well as
there: authority to replace an anchor comes either from a key the device
already holds that is not the one being replaced, or from a human standing at
the device, and there is no third source. The first is a second baked anchor —
`docs/plan/PLAN-077.md` §6's open question, held by the user and not decided
by this document. So until that question is answered, the physical route is
the answer, and §2.4a names it as one.

**The package anchor took the other road, and it is settled.** The TUF side
of this question is no longer open: the trusted package signing keys are
baked **inline**, as `trust.signingKeys` in
`/usr/share/mos/meta/updates/manifest.json`, with build-derived
`trust.signingKeyIds` beside them, and there is no separate anchor document
to ship and no `--root` to point at one (§3.1). So the two hierarchies now
reach a device by the same road — the image — and the honest consequence is
worth stating rather than leaving as an inference: **the TUF hierarchy
cannot outlive a compromise of the image signing path**, because whoever
controls what gets baked controls what the package gate trusts. That
independence is real at install time (§6.2's split) and not at provisioning
time, which is why keeping the RAUC CA's key offline still carries the
weight it does.

Two things follow for this section's remaining question. The open decision is
now about the **RAUC keyring only**; the candidates and their tradeoffs
recorded in `pkgs/rauc-sign/README.md` are read as candidates for that file.
And an anchor channel that exists would help both hierarchies, because the
baked-inline answer is a decision about *where the key lives*, not a claim
that no better channel could deliver one.

What is pinned down today, so the eventual decision has a fixed place to
land:

- **The read path is settled and testable without a booted device.** What
  RAUC verifies bundles against is `path=` in the rendered
  `/etc/rauc/system.conf`, and two verifier checks hold the contract from
  both directions: `rauc-keyring-path`
  (`verify/src/checks-rauc.ts`) asserts the rendered config names
  exactly `/etc/rauc/keyring.pem` (`pkgs/rauc/system.conf.in`), and
  `packed-keyring-from-meta` (`verify/src/checks-root.ts`) asserts the
  shipped root carries at that path a BYTE-EQUAL copy of `meta/rauc/ca.cert.pem` —
  and refuses one that carries anything else. Whether that root is
  development-grade (`meta/GENERATED`) is stated in the verdict, not refused. So
  the keyring RAUC reads is, by the shipped configuration, the CA the build was
  pointed at. A third check, `rauc-keyring-verifies-against-now`, holds the
  SEMANTICS beside the path: the rendered `[keyring]` may not carry
  `use-bundle-signing-time` or `check-crl` at all, so what the device does with
  that keyring is asserted rather than incidental (§2.2).
  Whether it is honoured end to end — `rauc install` accepting a
  production-signed bundle on hardware — is observable only on a booted
  device; that last step stays documented, not tested.
- **How it survives updates.** `/etc` is the read-only dm-verity squashfs,
  replaced whole by every A/B update, so the baked keyring is whatever the
  installed image's build staged from `meta/rauc/` — which is what makes §2.4's
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
  custody that this repository records and does not make. What is NOT open
  any more is what a fleet owner does in the meantime: §2.4a is that, for
  both cases, and it is written so that answering the open decision one way
  supersedes exactly one half of it and leaves the other standing.

### 2.4 CA rollover: old and new coexist in one keyring — **[runbook]**, with a compromise caveat

The keyring RAUC verifies against is an OpenSSL CA file: concatenated PEM
certificates, every one of them trusted. That is the whole rollover
mechanism, and `tests/rauc-trust-negative-test.sh` proves its three
properties host-side — a keyring holding the outgoing and the incoming CA
accepts bundles chained to either, and still refuses a third party.

The procedure, one phase per fleet-visible state:

1. **Mint the incoming CA** — the §2.1 ceremony, again, on the offline
   machine. The outgoing CA's media stay sealed; nothing here reads its key.
2. **The overlap update.** On the build host, `meta/rauc/ca.cert.pem` becomes the
   concatenation — outgoing certificate first, incoming appended
   (`cat old-ca.cert.pem new-ca.cert.pem > meta/rauc/ca.cert.pem`); `meta/rauc/signer.*`
   stay the OUTGOING signer's. Build and release as normal (§3). The bundle
   chains to the old CA, so every fielded device installs it; the image it
   installs carries the two-certificate keyring. The verifier's
   `packed-keyring-from-meta` check is byte-equality against `meta/rauc/ca.cert.pem`,
   so the concatenated file flows through the build and the checks unchanged.
3. **Switch the signer, once convergence is measured rather than assumed.**
   Replace `meta/rauc/signer.{cert,key}.pem` with a signer issued by the
   INCOMING CA (§2.1's signer step). Bundles now chain to the new CA; devices
   on the overlap keyring accept them, and devices still on the old-only
   keyring refuse them.

   **What "converged" means, concretely, because a step nothing can perform is
   not a step.** A device answers `GET /api/v1/system/info`; the booted slot's
   `bundleVersion` is the version RAUC recorded from the bundle that installed
   the slot it is running, so a device reporting the overlap release or newer
   is holding the two-certificate keyring. Three limits belong with it, and
   none of them is small.

   - **It reads only if §3 step 2's version rule was followed.** The recorded
     string is whatever the bundle build was given; if it is not the release
     version, this comparison has nothing to compare.
   - **A device that has never taken an update reports no bundle version at
     all** — it is running what it was flashed with. It is converged only if it
     was flashed with an image built at or after phase 2, which is a build-host
     fact about that batch and not something the device can answer.
   - **There is no fleet-wide reading of this today.** The reporting plane is
     PLAN-076's and is not shipped, so at 1.0 this is one device at a time
     through its API. That bounds how large a fleet this procedure is
     practical for, and it is the honest reason to run a rollover early rather
     than late.

   **A device that missed the window is stranded, and that is now a decision
   with a remedy rather than an accident.** Waiting is the cost of not
   stranding anyone; a device that never answers is exactly the case this step
   is about, and the absence of an answer is the answer — do not switch until
   stranding it is a choice somebody made. When it is made, §2.4a case 1 is the
   route back, and it is an update rather than a reflash.
4. **The retirement update, and the key that must NOT be destroyed with it.**
   `meta/rauc/ca.cert.pem` becomes the incoming certificate alone; build and
   release, signed by the new chain.

   **Retire the outgoing CA key; do not destroy it here.** Seal it under the
   §1.5 custody rules and keep it until the deployment decides §2.4a's rescue
   route is no longer offered — it is the only authority that can sign
   anything a device left behind by phase 3 will accept, and §2.2's expiry
   arithmetic reaches it: the shipped `[keyring]` carries no
   `use-bundle-signing-time` at all (`verify/src/checks-rauc.ts`'s
   `rauc-keyring-verifies-against-now` refuses an image that sets it), so RAUC
   checks the signer against the current clock and an *archived* overlap
   bundle stops installing on its own once its short-lived signer expires.
   Reissuing that signer needs this key. Destroying it at this phase therefore
   converts every device that missed the window from recoverable into a
   reflash, permanently and silently — the bundles are all still on the
   release host and none of them installs.

   The cost of the retention is real and is the reason it is bounded rather
   than indefinite: a sealed key is a key that can still be stolen, and every
   month it is held is a month in which its theft would matter. Record the
   destruction under §1.5 when it is finally performed, and record the
   decision to stop offering the rescue route as the thing that permits it.

**The compromise caveat, stated plainly.** Every update in this procedure is
signed by a chain the device already trusts, so a *scheduled* rotation is
sound. Rotation away from a **compromised** CA is not: the attacker holds the
same signing power the rollover update uses, and can race it or sign a
"rollover" of their own. Recovery from CA compromise therefore needs authority
the CA does not control, and this runbook says what that is rather than
implying the rollover covers it — §2.4a, immediately below. Every phase above
is executable today.

### 2.4a The two states the rollover cannot reach — the answer for each, decided

§2.4 names two states and, until now, answered both with "still needs a trust
channel outside the image". That is a description of an absence, not a
procedure, and a fleet owner planning against it has nothing to plan against.
This section is the answer. The two states are **not** the same case and do
not get the same answer, which is the substance of it.

**The constraint, stated once so neither answer reads as arbitrary.**
Replacing what a device trusts requires authority, and there are exactly two
places authority can come from: a key the device already holds that is *not*
the one being replaced, or a human standing at the device. There is no third —
that is what "not authorised by the key being replaced" means, and
`docs/plan/PLAN-077.md` §6.2 is where it is argued rather than asserted. The
first is a **second baked anchor**, which is PLAN-077 §6's open question, is a
product decision about key custody, and is **not decided by this document**.
So what follows is what the anchors this image already carries can be made to
buy, and the exact point where the physical route takes over.

#### Case 1 — a device that missed the overlap window: an update, not a reflash

It trusts the outgoing CA and nothing else, and the release side has moved on.
The route back uses no mechanism this tree does not already ship:

1. **Publish the overlap release into the rescue repository**, still signed by
   the OUTGOING chain. The bundle is the one phase 2 already built; §3's steps
   3 and 4, with `--repo` naming the rescue repository. If its short-lived
   signer has expired in the meantime, reissue one from the **retained**
   outgoing CA (§2.2, and phase 4 above for why the key is still there) and
   re-sign the archived bundle — the CMS signature changes and the payload is
   not rebuilt.

   **It has to be a separate repository, and not a separate channel.** A
   channel would be the obvious answer and the tooling refuses it:
   `build/src/release-manifest.ts` holds `development`/`candidate`/`stable` as
   a closed set and rejects an invented name, on the stated ground that a
   channel is a promise about qualification. `development` is the wrong one to
   borrow — a device parked there selects the *newest* target it finds, which
   on that channel is by definition something nobody qualified. And the
   production repository's own `stable` cannot carry it either: a device
   selects the highest version there, so an old-chain bundle published above
   the retirement release is one every converged device downloads and then
   refuses. A repository containing only the overlap release has none of these
   problems, because selection has exactly one candidate.

   **Initialize that repository at the §1.3 ceremony, not when it is needed.**
   It must be rooted at the SAME TUF root the fleet's baked
   `trust.signingKeys` name, and `init` is the only command that loads
   `root.pk8` — so creating one later is an offline root-key checkout at the
   worst possible moment. One more `rauc-sign init` while the root key is
   already out costs nothing; the repository then sits empty until it is
   wanted. It joins the re-sign cadence (`docs/plan/PLAN-071.md` §9.6's
   freshness bound is enforced against it like any other), which is its only
   standing cost: a rescue repository whose timestamp expired is refused as
   stale by the very device it exists to rescue.

2. **Deliver it, by whichever of the two routes the device's situation
   allows.** Both are shipped:

   - **Reachable on a network** — serve the rescue repository over HTTP and
     override the device's `source.url`: `POST /api/v1/update/config`, the
     administrator-authenticated write that
     `pkgs/mosd/apid/src/update_api.rs` serves. apid asks; mosd, the only
     writer of `/mos/config/updates.json`, performs it. This is layer 2 of
     PLAN-070 §5.1 used for exactly the case §5.3.1 made it overridable for —
     *the only exit from a device stranded by an address*. The rescue host
     will not be same-origin with the baked source, so it is fetched
     anonymously (§5.3.2); nothing needs a credential.
   - **No network route at all** — §3.2's lockbox, exported from the rescue
     repository rather than the production one, and `rauc-update import
     --lockbox` on the device. Same anchors, same selection, same digest gate.
     The rescue repository is what makes the lockbox usable here: a lockbox
     cut from the production repository carries metadata listing the
     retirement release, `import` would select that newest target, and it is
     not in the lockbox.

3. **The device recovers itself.** It selects the overlap release — the only
   candidate, and a higher version than the one it is running, so
   `docs/plan/PLAN-071.md` §9.1's downgrade floor is not in the way and no
   `--allow-downgrade` is involved — RAUC verifies the bundle against the
   outgoing CA it still holds, and it installs. It is now on the two-certificate keyring. Clear the
   `source.url` override and it takes the retirement release from the
   production repository normally, arriving where the rest of the fleet
   already is.

**Why this is not a second trust-anchor path, which is the thing it must not
be.** PLAN-070 §5.3 forbids a layer-2 key, an on-device write path for an
anchor, and even *naming* an anchor in an operator document. Nothing above
does any of those. The only thing that moves is **where the device looks**;
what it trusts is unchanged, still baked, still inside the verity root, and
the bundle it installs is one its own existing keyring verifies. The route
used is the same one whose 422 refuses a trust anchor **by name** — §5.3.5
gives the operator schema no `trust` object at all, and `source.rootPath`
stayed dropped when the URL carried over — so the write that performs the
rescue is mechanically incapable of naming a key. This is PLAN-070 §5.3's
split (the addresses move, the anchors do not) used exactly as drawn, and it
is the reason case 1 needs no decision from anybody.

**What it costs, said without flattering it.** The two delivery routes have
different prices and only the first avoids a visit. Over the network it is one
authenticated call and nothing else. By lockbox it is a site visit — but a
site visit carrying a USB stick, not a factory image: the device installs
through its normal update path, DATA is untouched, and nothing is
disassembled. That is the whole improvement over case 2, and it is a real one.

A device reachable by **neither** route is not helped by this, and is not
helped by any remote channel either — including the one PLAN-077 §6.3 designs,
whose update transport has exactly the same precondition. Case 1 also costs
phase 4's retention rule, whose price is stated there, and an `import` run as
root on the device (a serial or SSH session; there is no API route that
imports a lockbox).

**And it is bounded in time by the outgoing CA certificate, not only by its
key.** RAUC verifies against the current clock, so once the outgoing CA's own
certificate expires no bundle chained to it installs anywhere, however well
the key was retained and however recently the signer was reissued. §2.1 mints
the CA for 15 years for exactly this reason — the comment there says the CA
must outlive the fleet — and that date is the hard end of this route. Past it,
a device that never converged has case 2's answer whether or not anything was
compromised.

#### Case 2 — rotation away from an already-compromised CA — **[decided absent]**

**The answer is physical re-provisioning, and it is chosen.** The attacker
holds the authority every remote path in this document runs on. There is no
bundle the defender can sign that the attacker cannot also sign, no channel
the defender can publish on that the attacker cannot publish on, and no
version number the defender can reach that the attacker cannot exceed. Case
1's route does not help: it rests on the outgoing CA still being trustworthy,
and here it is precisely what is not.

A reflash is not a fallback in this case, it is the mechanism. Flashing writes
the device's storage whole; RAUC is not involved and no CMS signature is
verified against the old keyring, so it is the one rotation path in this
document that **does not require an image signed by the key being replaced**.
That is the property PLAN-037's Gate A asks for, and physical presence is what
supplies it.

The price is named rather than left to be discovered: one site visit per
device, and the reflash this document means writes the storage whole, so DATA
does not survive it unless the operator arranged its own copy first. A
fleet-wide CA compromise is therefore a fleet-wide reflash. That is the cost
of keeping the CA key offline being
the only thing standing between the fleet and this case — which is why §1.5's
custody rules and §2.1's air gap carry the weight they do, and why they are
the mitigation for case 2 rather than any mechanism on the device.

#### What would change this, and what would not

The only thing that changes case 2's answer is `docs/plan/PLAN-077.md` §6's
open question: a **third offline key** that signs trust statements and nothing
else, baked as a second anchor beside the CA. The decision is the user's and
neither this document nor PLAN-077 takes it. Both outcomes are written down
here so that the answer above is complete under either:

- **If it is declined**, this section is the 1.0 answer as written. §2.3's
  provisioning channel is not owed, `docs/design/security-lifecycle.md` §1.2's
  `[proposed]` keyring rotation stays prose, and the marker on case 2 stays
  `[decided absent]` rather than becoming a debt.
- **If it is approved**, it is its own plan and its own task, it lands before
  Gate B's update work depends on it, and it supersedes **case 2 only**: the
  defender can then re-anchor a reachable device without racing the attacker
  on version numbers (PLAN-077 §6.4), which turns "no remote answer exists"
  into "a remote answer exists for devices you can reach". It would also cost
  the property PLAN-070 §6.3 bought — *nothing on the device can be rewritten
  to change what it trusts* — which is the trade that makes it a decision
  rather than an improvement.

**Case 1 is unchanged under either choice.** Its route needs no new key, no
new anchor and no new device code, and a third key would not make it shorter.
That is worth stating because the two cases are easy to bundle: the case that
will actually happen is already answered, and what the open decision is really
pricing is CA compromise alone.

### 2.5 Production provisioning: the operator steps, and what the build then does — **[runbook]** host-side

Placing production material, exactly:

```sh
# On the build host, from the §2.1 ceremony's public/host-side outputs:
mkdir -p meta/rauc meta/updates && chmod 0700 meta meta/rauc meta/updates
cp <media>/ca.cert.pem     meta/rauc/ca.cert.pem      # the keyring (public)
cp <media>/signer.cert.pem meta/rauc/signer.cert.pem  # the bundle signer cert
cp <media>/signer.key.pem  meta/rauc/signer.key.pem   # the bundle signer key
chmod 0600 meta/rauc/signer.key.pem
# The baked update configuration: this deployment's own, edited from the
# committed example. It names the update server, the channel and the package
# signing keys this image will trust, and it ships in every image.
cp <this deployment's manifest> meta/updates/manifest.json
# meta/rauc/ca.key.pem does NOT exist here: the CA key never touches this host.
# meta/updates/root.key IS present on a release host if this deployment signs
# update packages -- it signs every release, so unlike the CA key it cannot be
# kept offline, and what protects it is host hardening rather than an air gap.
# meta/GENERATED does NOT exist here: that marker means "development-grade",
# and nothing may write it but pkgs/rauc/gen-dev-keys.sh.
```

What the build does with that, each step observable without hardware:

- `pkgs/rauc/gen-dev-keys.sh --if-absent` (run by every build entry) finds
  the four files it checks for complete and exits silently — it generates
  only into an empty or half-written `meta/rauc/`, and refuses to overwrite
  otherwise. No development-keyring banner is printed, because the banner
  keys off generation, not presence. If `meta/updates/manifest.json` is
  absent it is instantiated from the committed `meta.example/` and the run
  says so in one line; a manifest already there is never overwritten.
- `rootfs/build.sh` stages `meta/rauc/ca.cert.pem` into the image at
  `/etc/rauc/keyring.pem`, and does not warn: the warning keys off
  `meta/GENERATED`, which production material does not carry.
- The bundle build signs with `meta/rauc/signer.{cert,key}.pem` and read-backs
  through the shipped `system.conf` against the same keyring (§3).
- `make os-verify-cx3576` passes `packed-keyring-from-meta`: the shipped keyring
  is byte-equal to `meta/rauc/ca.cert.pem`. When a marker names that root
  development-grade the check says so in the verdict rather than refusing, so a
  dev image cannot masquerade as production in a transcript —
  `verify/src/checks-root.test.ts` holds both readings.

**The TUF half of provisioning is answered, and the answer is `meta/`.** The
production package anchors are `trust.signingKeys` in
`meta/updates/manifest.json` on this host; `rootfs/build.sh` stages that file
to `/usr/share/mos/meta/updates/manifest.json` by the same two-file
allowlist that stages the keyring, and the device reads its anchors from
there and from nowhere else (§3.1). There is no `root.json` to pin, no
out-of-band anchor copy for a device to receive, and no `--root` on either
device binary. What §2.3 leaves open is the **keyring's** provisioning
channel; the candidates in `pkgs/rauc-sign/README.md` (STATE/META
provisioning file, signed USB import) are candidates for that file, and
image-baked is what both anchors do today.

### 2.6 Two domains, three keys, and why one of them lives on the release host

The split is **by object, not by hierarchy** (PLAN-070 §6.2), and it is what
makes `root.key`'s custody different from everything else in this document:

- **`meta/rauc/`** — the RAUC CA and its signer. This chain gates the **A/B
  system image**. Compromise means an attacker **installs a system**.
- **`meta/updates/root.key`** — the ed25519 key over the update **package**
  and its release metadata. It is what guarantees a downloaded package has
  not been tampered with. Compromise means an attacker **forges a package,
  not a system image**.

| File | Domain | Signs | Used | If stolen | Rotation |
|---|---|---|---|---|---|
| `meta/rauc/ca.key.pem` | image | signer certificates | at a ceremony, rarely | mint a signer the fleet already trusts, and **install a system** on every device until reflash | §2.4's rollover, with an overlap window; a *compromised* CA is §2.3's uncovered case and needs a reflash |
| `meta/rauc/signer.key.pem` | image | the bundle's CMS signature | every release | **install a system**, while the certificate is valid | §2.2 reissue — cheap, needs the CA key, no fleet update, because devices trust the CA |
| `meta/updates/root.key` | package | the update package and its release metadata | every release, **locally** | have a device accept a forged package as authentic — download it, verify it, and then **fail to install it** | a new image, because the public half is baked; `trust.signingKeys` is a **list**, which is what makes an overlap window possible |

**Both gates must fall.** An attacker holding `root.key` alone can make a
device accept a package as authentic and still cannot make it install
anything: installation is gated by the RAUC CMS signature chaining to
`meta/rauc/ca.cert.pem`, which they do not hold. An attacker holding the RAUC
CA alone can build an installable bundle and cannot get it distributed as an
authentic package. The two gates fall to different keys with different
custody — which is the value of the split, and it holds **at install time**,
not at provisioning time (§2.3's last paragraph).

**The custody rule, which is the asymmetry a reader will otherwise get
backwards.** `meta/rauc/ca.key.pem` is **not present** on a release host and
never touches one: signing a release needs the *signer* key, not the CA key,
so the CA key stays sealed under §1.5's custody. `meta/updates/root.key` is
the opposite: it signs **every** package, on the release host, so it **is
present** there and cannot be kept offline. What protects it is operational —
host hardening, restricted access, an audit trail — rather than the CA's air
gap, and that is a weaker protection deliberately accepted for a key whose
compromise buys a forged package rather than an installed system.
`pkgs/rauc/gen-dev-keys.sh --domain updates` writes a development-grade one
and marks it in `meta/GENERATED`; that marker names the domains it wrote,
because a complete `meta/rauc/` says nothing about whether
`meta/updates/root.key` is there.

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
#
#    THE VERSION STRING HERE AND --release-version IN STEP 3 MUST BE THE SAME.
#    Nothing enforces it: the bundle version is whatever this caller passes and
#    the TUF target's release version is whatever step 3 passes. The example
#    below says 1.2.3 twice on purpose. RAUC records the bundle's version in
#    the slot it installs, and that recorded value is the ONLY thing a fielded
#    device can be asked about a release it is running -- it is what makes
#    2.4 phase 3's convergence reading possible, and two different strings
#    here make that reading impossible rather than merely awkward.
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
`rauc-verify`'s walk — baked anchors, persistent rollback state — with
transport and policy on top, and no flag on any subcommand skips metadata or
digest verification.

**Where the anchor comes from, because it is no longer an argument.** Both
device binaries read `trust.signingKeys` from
`/usr/share/mos/meta/updates/manifest.json`, which
`pkgs/rauc-sign/src/anchor.rs` pins as a constant: *there is no environment,
argument or operator-document anchor override.* The reader refuses a
`trust` object carrying any key but `signingKeys` and `signingKeyIds`,
refuses an empty key list, refuses a `signingKeyIds` that does not match the
sha256 of the keys beside it, and then starts the TUF walk at **the earliest
repository root one of those keys authenticates**, letting the rotation chain
carry it forward from there — so a freshly baked incoming key that only
signs later roots still works and a rotation needs no new flag. **The
`--root` flag is gone from `rauc-update` and from `rauc-verify`**; earlier
revisions of this section and of `updates.md` §5.3 showed it, and an
invocation carrying it fails. `rauc-sign verify --root` is unaffected: that
is the host-side tool and its anchor is an out-of-band copy an operator
holds (§1.5).

The operator sequence on a device (or a bench shell):

```sh
# 1. Mirror the metadata over plain HTTP (or rsync the repo and skip this).
#    The mirror is unverified input; step 2 is what trusts or refuses it.
rauc-update sync --url http://mirror.example/tuf --repo /var/lib/mos/tuf-mirror

# 2. Verify from the BAKED anchors and select the newest compatible target:
#    board+profile (identity below), channel (default stable), manifest
#    schema floor (equality with 1), version strictly newer than running.
#    Prints every rejected candidate with its reason; "none" exits 2.
#    A downgrade needs --allow-downgrade and is logged to stderr.
#    There is no --root: the anchors are trust.signingKeys in the baked
#    manifest, and no argument can substitute one (below).
rauc-update check \
  --repo /var/lib/mos/tuf-mirror --state <state.json>

# 3. Probe the /mos/updates workspace (DATA mounted, writable, not
#    exhausted — exit 3 and a `<status> <kind>: ...` line otherwise), then
#    download resumably (HTTP range requests) into /mos/updates/downloads.
#    The completed size never exceeds --max-bytes together with what the
#    workspace already holds; a digest mismatch deletes the partial; the
#    verified bundle is renamed into /mos/updates/verified and that path is
#    the last stdout line. There is no flag that stages anywhere else.
rauc-update fetch \
  --repo /var/lib/mos/tuf-mirror --state <state.json> \
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
subprocesses; the cadence, the channel and the source address come from
`/usr/share/mos/meta/updates/manifest.json`'s defaults with
`/mos/config/updates.json` overriding them per key
(`docs/design/updates.md` §2). `/var/lib/mos/update-policy.toml` is retired
and nothing reads it. Where the bytes go is not a
flag but PLAN-061's contract on PLAN-063's layout: partial downloads only
in `/mos/updates/downloads`, a verified bundle moved into
`/mos/updates/verified` by one same-filesystem rename, transaction-local
work in `/mos/updates/staging`, and RAUC handed only a path in `verified/`.
The workspace is created by `mos-data-layout` on the DATA pool; the client
probes it before the first byte (mount source resolves to `/mnt/data`, no
symlink substitution, not read-only, a private probe file written and
removed, the pool's free space against the budget) and refuses with a named
`unavailable`/`degraded` verdict instead of writing anywhere else
(`updates.md` §1.1). What is still owed of the image-side contract is one
thing, not two: **[not implemented]** `mos-health` does not report
`health.boot` — the entry that lifts the lifecycle past `validating`, and
whose absence `pkgs/mosd/mosd/src/update_lifecycle.rs` records at the site
that needs it. **The `/var/lib/mos/update/` tree is no longer on that list**:
both halves of it are provisioned on demand by the client that uses them —
`sync_metadata` creates the mirror's `metadata/` and `targets/`
(`pkgs/rauc-sign/src/update.rs`) and `save_state` creates the state file's
parent before its atomic write (`pkgs/rauc-sign/src/client.rs`) — and mosd
passes both paths in from the effective policy (`--repo`, `--state`). Nothing
has to lay the tree down first. **The package anchor is not on it either**: it
is baked, and `verify`'s `packed-meta-is-the-public-set` and
`no-private-key-in-baked-meta` hold the image side of it. And what §2.3
records as open — the *provisioning channel* for the RAUC keyring, a way for
an anchor to reach a device other than by riding an image — is not on it in
the sense this list means: §2.4a decides it rather than owing it, and it is a
different question from where a running device reads one. How many bytes
`--max-bytes` may promise of the
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
  --lockbox /media/usb/lockbox --state <state.json> \
  --max-bytes <n>
```

`import` verifies exactly as online — same baked anchors, same rollback
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
- **The TUF root-role key and the RAUC CA key never touch a networked
  machine.** Not for a "quick re-sign", not in CI, not on the release host.
  **This does not cover `meta/updates/root.key`, and the name is why**: that
  key signs every update package, locally, so a release host must hold it
  (§2.6). One sentence covering both would have been false in one direction
  or the other; the two are named separately because their custody genuinely
  differs.
- **No production key on a build machine, and no signing in CI.** CI builds
  with dev keys (`make os-devkeys`) and proves the pipeline; a runner that
  held production material would make every person and plugin with runner
  access a signer. The privileged lane's deep job says this in its own
  comments.
- **No dev CA on a shipped device.** A generated trust root carries
  `meta/GENERATED`, so the build says loudly which images trust one and the
  verifier names the grade it read. Which material is in `meta/rauc/` is chosen before
  the build — by the release pipeline, not by a flag at verify time. No gate in
  this repository yet refuses to PUBLISH an image built on a generated root;
  that assertion belongs to the release gate and does not exist.
- **No expiry decided ad hoc.** The horizons in §1.4 and §2.1 are the
  policy; a `sign` invocation that invents a different horizon is a change
  to this document first.
- **No `--allow-rollback` outside a recorded incident.**
- **No keyring from anywhere but `meta/rauc/`.** The keyring in the signed root is
  staged from `meta/rauc/` and byte-checked against it (`packed-keyring-from-meta`);
  one found in the overlay is refused unconditionally. And no pretending the
  baked keyring solves rotation: a keyring inside the dm-verity-sealed root
  is replaced only by an image update a currently-trusted CA signed — §2.4's
  overlap makes that sound for a scheduled rotation and says plainly that it
  cannot recover from CA compromise, which is what the provisioning-time
  trust channel (§2.3) remains owed for.
- **No package anchor from anywhere but the baked manifest.** The device
  reads `trust.signingKeys` from
  `/usr/share/mos/meta/updates/manifest.json` and there is no environment
  variable, no command-line flag and no operator document that can name one
  (§3.1). The operator document refuses `trust`, `signingKeys`,
  `signingKeyId`, `signingKeyIds`, `rootPath` and `keyring` **by name** and
  not merely as unknown keys (`docs/design/updates.md` §2.3), so widening
  that schema cannot quietly reopen the road. The **address** a device dials
  is an operator setting; what it will accept is not.
- **No private key baked into an image.** Exactly two files reach the image
  from `meta/`, by allowlist: `rauc/ca.cert.pem` and
  `updates/manifest.json`. `rootfs/build.sh` refuses an off-allowlist staged
  path and runs a private-key detector over what it stages, and the image
  verifier asserts the same set from the other end
  (`packed-meta-is-the-public-set`, `no-private-key-in-baked-meta`). Two
  checks in two places, because a build that meant well is not evidence.
