# PLAN-077 Gate A: trust is real — the anchor, the grade, and the rotation decision

- **status**: proposed
- **createdAt**: 2026-09-04 19:10
- **relatedTask**: [RFCT-305](../task/RFCT-305.md)
- **relatedPlans**: [PLAN-037](PLAN-037.md) (the 1.0 milestone), [PLAN-070](PLAN-070.md) (the `meta/` seam)

## Context

### What this record is for

[PLAN-037](PLAN-037.md)'s 1.0 milestone names four gates and one ordering
clause: **A → B → C → D**, Gate A first, because every signing assumption in
Gate B rests on it. It also records that the current sequence is inverted — the
update module is being designed against a trust anchor that no image
provisions — and calls that inversion the programme's largest scheduling risk.

Gate A is stated there as five bullets. This record turns them into a design,
and the first thing it does is **split them into two piles that have different
owners**, because four of the five are mechanism this repository can build and
one of them is a human act nobody in this repository may perform.

### The measurement, taken rather than remembered

`docs/design/release-signing.md`, on 2026-09-04, carries **10 `[runbook]`
sections, 1 `[implemented]`, 1 `[proposed]` and 4 `[not implemented]`
markers**. PLAN-037 quotes the last number and it is right, but three of those
four are substantive claims and the fourth is the marker legend in §0:

| Where | The claim |
|---|---|
| §0, line 22 | the legend defining what `[not implemented]` means — not a claim about the product |
| §2.4 | the out-of-image rotation channel; every step above it is executable today |
| §2.5 | the trust-anchor provisioning channel: image-baked, STATE/META file, signed USB import — "all **[not implemented]**" |
| §3.1 | "the pinned `root.json` is provisioned by nothing" |

So the gap this gate exists to close is **three sentences, not four**, and two
of the three (§2.5, §3.1) are the same gap seen from two sides. The third
(§2.4) is rotation, and it is the one this record does not close.

`docs/user/security.md` §2 states the same three gaps in customer-facing
words, under a `> status: shipped` line, which is the sharpest form of the
problem: the page says *shipped* and the bullets under it say *nothing
provisions the anchor*.

### The two decisions upstream of this one, and what they already settled

**[PLAN-070](PLAN-070.md), approved 2026-09-04.** The trust anchor is not a
`root.json`. It is `trust.signingKeys` — a list of ed25519 public keys carried
**inline** in `meta/updates/manifest.json`, which the build bakes to
`/usr/share/mos/meta/updates/manifest.json` inside the read-only verity root.
The RAUC keyring stays what it is, `/etc/rauc/keyring.pem`, staged from
`meta/rauc/ca.cert.pem`. There are two anchors, one source each, and no
runtime override of either (§6.3).

**PLAN-070 open question 6, answered 2026-09-03.** The release side becomes
lode's scheme; the TUF repository `pkgs/rauc-sign` builds is not the mechanism
`root.key` signs with. The baked public set therefore stays at two files —
there is no signed root document to ship.

**RFCT-301, in flight on `bkd/67n9ae87` at the time of writing.** PLAN-070
F1–F4 and F12: `meta.example/`, the generator's absorption onto `meta/`, the
`ca/` → `meta/rauc/` rename, the staging allowlist with refusal **B1**, the
verifier pair **B2** (`packed-meta-is-the-public-set`,
`no-private-key-in-baked-meta`), and the key-algorithm parameter with **A1**
and **A2**. **That work is the seam this record builds on, and it delivers the
first of Gate A's mechanism bullets outright** (§5). Everything below is
written against its shapes — the `META_PUBLIC` allowlist, the marker's
`DOMAINS=` line, the throw-on-absent-`meta/` guard — rather than beside them.

## Proposal

### 1. The split: ceremony and mechanism, and which is whose

Gate A's five bullets divide cleanly, and the division is the first thing this
record commits to, because getting it wrong produces either an invented
procedure nobody agreed to perform or a key this repository should never have
touched.

| Gate A bullet | Class | Owner |
|---|---|---|
| A production key ceremony is performed and recorded | **ceremony** | the release owner, off this repository, following §7 |
| A shipped image provisions its trust anchor | mechanism | PLAN-070 F3 (RFCT-301) — §5 |
| A keyring rotation path not requiring an image signed by the key being replaced | **design, then a product decision** | §6 |
| A device can state whether it trusts a development CA | mechanism | §3 |
| An image carrying a development keyring cannot be published | mechanism | §4 |

**What "ceremony" means here, normatively.** Generating the production RAUC CA
and the production package signing key, holding them, storing them offline,
deciding who is present, and writing down what happened are **human acts
performed by a named owner on machines this repository does not run**. No step
of this plan generates, holds, reads or transports a production key, and no
implementation slice below does either. §7 is a runbook for a person; its
output is material placed in a gitignored directory and minutes filed
somewhere this tree cannot see.

**What "mechanism" means here.** Everything that makes the ceremony's output
*verifiable* and its *absence detectable*. The mechanism half never asks
whether a key is good; it asks whether the material an image was built from
was generated by `pkgs/rauc/gen-dev-keys.sh`, which is a question with a
mechanical answer — the marker — and it makes that answer travel with the
artifact.

**The seam between the two piles is exactly one file: `meta/GENERATED`.** The
generator writes it and nothing else may; production material is placed
without it. That is already the contract (PLAN-070 §1.2). What this record
adds is that the marker stops being build-host-only.

### 2. The image carries its own trust grade — answering PLAN-070 question 4

**PLAN-070 open question 4 is answered here, and this record says so rather
than assuming it.** The question: *should the image carry the
development-grade marker?* It was left open on the ground that a baked
`/usr/share/mos/meta/GENERATED` would make the device self-describing at the
cost of one more allowlist line and one more thing to keep true, and that it
was "the obvious next request from anyone debugging a device they did not
build".

**The answer is yes, and the evidence is that two of Gate A's four mechanism
bullets are unbuildable without it.**

- **A device can state whether it trusts a development CA** (§3) is the
  question restated. `meta/GENERATED` on a build host is not readable by a
  device; nothing else in the image distinguishes a development CA from a
  production one, and PLAN-070 §1.2 forbids guessing it from the bytes — the
  marker is the whole condition, deliberately, so that a subject string like
  `/O=mos development` is never load-bearing.
- **An image with a development keyring cannot be published** (§4) is a
  refusal in the release gate, and `gateReleaseDir` is contracted to answer
  "may this be published?" *from the artifacts*, "whether the directory was
  written a minute ago or restored from an archive". A refusal that reads
  build-host state answers a different question — *was the host that ran this
  command development-grade* — which is green on any host that has no `meta/`
  at all. That is the vacuity shape this campaign keeps producing, and here it
  would be a security check that passes by finding nothing.

So the marker is baked, **verbatim**, at `/usr/share/mos/meta/GENERATED`.

**Verbatim rather than derived**, because the seam's whole assertion shape is
byte-equality against the source in `meta/` (`packed-keyring-from-meta`,
`packed-meta-is-the-public-set`). A derived summary — a JSON `{"grade":
"development"}` — would be a second statement of one fact with no rule for a
disagreement, and PLAN-070 rejected exactly that shape for the trust anchor
(§2.1) for exactly that reason. The marker's text also carries its own
instructions ("Do not delete this file to silence a warning"), which are worth
more on a device being debugged than a grade token would be.

**It carries no secret and no per-device value**, so PLAN-070 §1's three
prohibitions on the baked set are satisfied without argument: it is prose plus
a `DOMAINS=` line, byte-identical on every device of a release.

#### 2.1 The allowlist gains a conditional entry, and that is a real change of shape

The public set today is two mandatory entries, and the staging loop refuses
when a source file is missing or empty — correctly, because an image without a
keyring or without a manifest is an image that can verify nothing. **The
marker is the first entry whose absence is meaningful**: it is absent exactly
when the material is production-grade, which is the case a release wants.

So `META_PUBLIC` gains a third entry marked **conditional**, and three things
change with it:

1. **Staging**: a conditional entry is staged iff its source exists and is
   non-empty; a required entry that is missing is still the existing refusal.
2. **B1's count**: `staged == the number of entries whose source was present`,
   with the required entries all present. The count assertion survives — it is
   what stops B1 reading a tree the build is not going to ship — but it stops
   being a constant.
3. **B2's `packed-meta-is-the-public-set`**: gains a **biconditional**. The
   image carries `/usr/share/mos/meta/GENERATED` **iff** `meta/GENERATED`
   exists, byte-equal when both do. Both directions fail: a production tree
   whose image ships a marker is as wrong as a development tree whose image
   hides one, and the second is the direction that matters, because it is the
   one that turns a bench image into something the gate would let out.

The existing throw-on-absent-`meta/` guard covers this check's vacuity
unchanged: a tree with no `meta/` cannot answer the question and says so
instead of passing.

`no-private-key-in-baked-meta` is unaffected in contract. Its scanned-file
count grows by one on a development tree, which is what its count exists to
report.

### 3. The device states its grade

`GET /api/v1/system/info` — mosd's `system_info.rs`, served over the bus as
`GetSystemInfo` and over HTTPS by apid — is the surface. It is already the
place a device answers "what am I" out of files that already exist, with an
`available` member on every fact and an explicit reason when a fact is absent;
`docs/design/diagnostics.md` §2 is its contract.

A new member, `trust`:

```json
"trust": {
  "available": true,
  "grade": "development",
  "developmentDomains": ["rauc", "updates"],
  "marker": "/usr/share/mos/meta/GENERATED"
}
```

- **`grade: "production"`** when the baked `meta/` tree is present and carries
  no marker; `developmentDomains` is then absent and so is `marker`.
- **`grade: "development"`** when the marker is there, with the domains its
  `DOMAINS=` line names — so a mixed image (a production RAUC ceremony's
  output beside a development package key) reports `["updates"]` and a reader
  learns *which half*, which is the reason PLAN-070 gave the marker a domain
  list in the first place.
- **`available: false`** with a reason when
  `/usr/share/mos/meta/updates/manifest.json` is absent.

**That last case is the whole vacuity guard, and it is why the manifest is
read at all.** "No marker" and "no baked `meta/` tree" are different facts with
the same absent file. An image built before this seam, or an image whose
staging was broken, has no marker *and* no anchor; reporting it as
`production` would be the surface saying "I trust a production CA" about a
device that provisions nothing. The mandatory member of the public set is the
evidence that the tree is there to be asked, and the surface refuses to answer
without it.

**Two consequences worth stating rather than discovering:**

- `pkgs/mosd/apid/src/diagnostics.rs` carries a redaction allowlist over this
  surface, and its own comment records that **a key not named there is dropped
  from every snapshot without a word**. `trust` is added to it in the same
  change. A support bundle that silently lost the trust grade is the exact
  failure that comment was written about.
- The member is added to `docs/design/diagnostics.md` §2's table, which is the
  document that says what this surface answers.

### 4. The release gate refuses a development-grade publication

`build/src/release-manifest.ts`'s `gateReleaseDir` is the publication gate: it
re-checks a release directory from scratch, trusts nothing the assembly wrote,
and refuses the first gap by name.

#### 4.1 Where the gate gets the fact

**By extraction from the image, handed in as an input — the shape
`--package-manifest` already uses.** `docs/design/release-artifacts.md` §3
records that decision and its reason: the assembly takes the image's
`/usr/share/mos/manifest.tsv` as an explicit input rather than unpacking the
squashfs itself, because the extraction needs the verify toolset and the
extracted bytes are the same either way.

So: a new required input, the image's `/usr/share/mos/meta/` directory as
extracted — `--baked-meta DIR` / `MOS_BAKED_META`. Assembly measures the grade
from it and records it; the gate re-measures from it and requires the record
to agree — the same two-source shape the gate already applies to
`bootAssurance` against `boards/<board>/evidence.json`.

**The bound this inherits, stated and not glossed.** A caller who hands over a
directory that did not come out of the image gets an answer about that
directory. That is exactly the bound `--package-manifest` already carries, and
this record adopts it rather than inventing a second, stronger contract for
one field; closing it means the gate unpacking images, which is the verify
toolset's job and a different plan. What is bought over today's state is large
and worth having: the fact is measured from something, rather than asserted by
nobody.

**And its vacuity is closed where the manifest's is.** An absent, empty or
wrong directory reads as "no marker" — which is "production" — unless the
reader refuses it. So the reader **throws** unless `updates/manifest.json` is
present in the handed-over directory: that file is a mandatory member of the
public set, so its absence means the extraction is wrong or the image
provisions no anchor, and neither is a release. A missing directory is never a
green release.

#### 4.2 The refusal, and why it is channel-conditional

`RELEASE_CHANNELS` are `development | candidate | stable`, and
`release-artifacts.md` §2 already fixes their meaning: "`development` carries
no promise, `candidate` is under qualification, `stable` is what customers
deploy."

**The refusal: a release on `candidate` or `stable` whose image carries
`/usr/share/mos/meta/GENERATED` is refused, naming the file it found and the
domains it names.** On `development` the grade is recorded in `manifest.json`
and printed, and the release is assembled.

**Why not unconditional.** Every gated release directory this tree has ever
produced was built on development material, because production material has
never existed. An unconditional refusal makes the release path unrunnable
until the ceremony of §7 is performed — which means the publication gate
itself would ship untested, and a gate nobody can run is a gate nobody notices
breaking. The conditional form refuses precisely where "published" means "to a
customer", and the `development` channel keeps the path exercised.

**The mixed case is refused too.** A marker naming only `updates` still fails
`candidate`/`stable`: the image would trust a development package signing key.
The message names the domains rather than saying "development-grade", because
"which half" is the first thing a release owner will ask.

#### 4.3 The second refusal: an anchor that anchors nothing

With the baked `manifest.json` already in hand for §4.1's guard, one more
incoherence is visible and worth refusing: **`update.source` names a server and
`trust.signingKeys` is empty.** Such an image downloads packages it can never
verify, on every device of the release, and reports a refusal that looks like
a server problem.

- An empty `trust.signingKeys` with `update.source: null` is a **supported
  steady state** (PLAN-070 §7) and passes: a device configured to reach no
  server has no package to verify.
- The refusal is in the **gate** and not in the build, deliberately. A
  development tree that points at a server before anyone has run
  `--domain updates` is a legitimate state to build in; publishing that image
  is not.

### 5. The anchor is provisioned — by RFCT-301, and this record does not rebuild it

Gate A's "a shipped image provisions its trust anchor" is **PLAN-070 F3**: the
staging allowlist copies `meta/updates/manifest.json` to
`/usr/share/mos/meta/updates/manifest.json` inside the verity root, and F4's
`packed-meta-is-the-public-set` holds the image to it byte for byte. RFCT-301
implements both. This record adds no second provisioning path and no second
anchor location; PLAN-070 §6.3 is explicit that each anchor has exactly one
source, and a second would be a precedence question nobody has.

**What is honestly true when that lands, and what is not:**

| | State |
|---|---|
| The RAUC keyring anchor | provisioned, and always was — `/etc/rauc/keyring.pem`, staged from one source, byte-checked |
| The package anchor's **mechanism** | provisioned by F3: the field exists, it is inside the signed root, and nothing at runtime can name another |
| The package anchor's **value** | ceremony output. `trust.signingKeys` is `[]` in `meta.example/`, and stays `[]` until either `gen-dev-keys.sh --domain updates` (development) or §7's Part B (production) populates it |
| The **reader** | **not implemented**. `rauc-update` still verifies TUF metadata from a `--root` path. PLAN-070 **F7** is what makes it read `trust.signingKeys`, and F7 is not in this record's scope |

That table is the reason `docs/user/security.md` §2 can be corrected but not
deleted: after this work the image provisions an anchor and the shipped client
does not yet read it. **Documentation may describe a missing capability and
may not mark it shipped** (PLAN-037's own principle), so the bullet changes
from "no image provisions that root" to what is then true, and names F7 as
what is still owed.

### 6. Keyring rotation without an image signed by the key being replaced

This is Gate A's hard bullet, and this record designs it and **stops at a
decision it may not take**. What follows is the honest answer, including the
part that sounds worse.

#### 6.1 What the gap actually is

`/etc` is inside the read-only dm-verity root, replaced whole by every A/B
update. So the keyring can be replaced — by an update — and
`release-signing.md` §2.4 is that procedure: an overlap image whose keyring
concatenates outgoing and incoming CA certificates, then a signer switch, then
a retirement image. **Every bundle in that procedure is signed by a chain the
device already trusts.** Two cases fall outside it:

1. **A device that missed the overlap window.** Off the network, powered down,
   in a warehouse. It trusts only the outgoing CA, the release side has moved
   to the incoming one, and no bundle it will accept exists any more.
2. **Rotation away from a CA that is already compromised.** The attacker holds
   the same signing power the rollover update uses.

Both are recorded today as needing "a trust channel outside the image", and
`docs/design/security-lifecycle.md` §1.2 marks device-keyring rotation
`[proposed]` for exactly this reason.

The package anchor **inherits both cases** verbatim (PLAN-070 §6.3): a baked
`trust.signingKeys` list has the same overlap shape and the same failure when
the window is missed.

#### 6.2 The honest answer

**There is no rotation path that does not either require physical access or
introduce a second anchor.** That is not a limitation of any particular
design; it is what "authorised by something other than the key being replaced"
means. The authority has to come from somewhere, and there are exactly two
somewheres: a key the device already holds that is not the one being replaced,
or a human standing next to it.

So the design is: **a second anchor — an offline trust-rotation key that signs
nothing else — plus a transport, of which the physical one is the fallback the
remote one degrades to.**

#### 6.3 The shape, priced

**The key.** A third production key, `meta/rotation/rotation.key`, ed25519,
generated at the §7 ceremony and **sealed offline beside the RAUC CA**. Its
public half is baked, as a third anchor. It signs exactly one kind of object
and may never be used to sign a bundle, a package or a certificate. It is
never on the release host — that is the property that makes it worth having,
and it is the property a release host would destroy.

**The object.** A *trust statement*: a small signed document naming the new
keyring bytes (or their digest), the new `trust.signingKeys` list, a
**monotonic sequence number** and an expiry. Monotonic, because a replayed
older statement is a downgrade of the fleet's trust — the same class of attack
PLAN-070 question 6 already required PLAN-071 to defend against for releases;
expiry for the reason §9.6 there gives.

**The device side.** The keyring stops being read only from the verity root:
`/etc/rauc/keyring.pem` becomes a bind mount over a STATE-backed file when one
has been installed, the shape `/etc/ssh` already uses
(`rootfs/overlay/usr/lib/mos/mos-seed-state`). `release-signing.md` §2.3 names
this shape and says no such bind exists "deliberately: creating one is part of
choosing the channel". This is that choice.

**The transport, two, and the second is not weaker:**

- **Over the update channel** — cheap, remote, no truck roll. Covers case 1
  entirely for any device that can still reach a server.
- **By physical import** — removable medium, the shape `rauc-sign lockbox`
  already has and `pkgs/rauc-sign/README.md` names as its third candidate.
  Covers a device with no route at all, and is the only one that works when
  the fleet's server is what was lost.

**What it costs, enumerated:**

1. **A third key with its own custody and its own ceremony.** An OPS
   commitment: another sealed medium, another set of minutes, another thing to
   find in five years.
2. **The property PLAN-070 §6.3 deliberately bought is given up.** Today
   "there is nothing on the device that can be rewritten to change what it
   trusts". After this, there is: a STATE file. It is replaced only by a
   statement signed by an offline key that signs nothing else, and a tier-1
   reset returns the device to its baked anchors — but the sentence is no
   longer true as written, and the design documents that state it have to
   change.
3. **A new failure mode: the device that took a bad statement.** A statement
   that is validly signed and names a keyring nobody can sign against strands
   the device exactly as a missed window does. The reset path is the remedy,
   and it has to be reachable without the update channel.
4. **Attack surface.** An import path that parses attacker-supplied signed
   documents, on the device, before any other trust decision.

#### 6.4 What it does not buy, said plainly

**It does not defeat an attacker holding the release CA who reaches the device
first.** Such an attacker signs a complete image, and an image carries the
rotation anchor; whatever the defender installs, the attacker can install
something else. What the second anchor buys in the compromise case is narrower
and still real: the defender can re-anchor a device **without racing the
attacker on version numbers**, and a device that has taken the defender's
statement refuses the attacker's bundles from then on. The race becomes "who
reaches the device first" rather than "who publishes the higher version",
which is a race a fleet operator can win on devices they can reach.

Case 1 — the missed window — is where it is unambiguously the right answer,
and case 1 is the one that will actually happen.

#### 6.5 Why this record stops here

**This is a decision only the user can make**, and this plan does not take it.
Three reasons, each sufficient:

1. It **reverses an explicitly approved property**. PLAN-070 §6.3 was approved
   on 2026-09-04 with "nothing on the device that can be rewritten to change
   what it trusts" as a stated benefit, and PLAN-070 open question 2 asks
   whether a device-time trust channel is wanted *later* and deliberately does
   not design one.
2. It **creates a third production key**. Key custody is a product decision
   about who holds what; `release-signing.md` §2.3 already records that "who
   holds, rotates and revokes the signing CA" is a decision this repository
   records and does not make.
3. It is **not small**. §6.3's four items are a new signed document format, a
   device-side verifier, a STATE seam with a seed and a bind mount, an import
   path and a reset interaction — comparable in size to PLAN-071's update
   reader, and deserving its own plan rather than a section in this one.

**The decision to take:** *is a device-time trust-rotation channel wanted for
1.0, at the price of a third offline key and of the immutability property
PLAN-070 §6.3 bought?* If yes, it is its own plan and its own task, and
Gate A's ordering means it lands before Gate B's update work depends on it. If
no, then **1.0 ships with a documented rotation gap**, `release-signing.md`
§2.4's compromise caveat stands as written, and the honest sentence in
`docs/user/security.md` §2 stays — which is a defensible product position, and
is not the same thing as the gap being unrecorded.

### 7. The ceremony runbook

This is the human half. It is written to be followed by a release owner and
audited by somebody who was not present. **Nothing in this repository performs
any of it**, and no implementation slice below reads its output.

#### 7.0 Preconditions

- A **named release owner** who will hold the material afterwards.
- A **second person present** for the whole ceremony, who signs the minutes.
  Not for skill: for the record. A ceremony with one witness has a record
  somebody can dispute, and a ceremony with none has no record at all.
- An **offline machine**: no network interface up, freshly booted from known
  media, with `openssl` and nothing that syncs a directory anywhere.
  `release-signing.md` §1.1 is the same machine discipline and this reuses it.
- **Write-once media**, one per private key generated (or one set per key, if
  the custody policy is n-of-m). Labelled before anything is written to them.
- A **minutes template** — §7.4 — printed, on paper, filled in as the ceremony
  runs and not reconstructed afterwards.

#### 7.1 Part A — the RAUC CA and its signer

The procedure is `docs/design/release-signing.md` §2.1 and is **not restated
here**; restating a shell block in two documents is how two documents come to
disagree about a key that must outlive every device it signs for. What this
runbook adds is what §2.1 does not say:

- The algorithm is a **declared parameter with an allowed set**, not a value
  copied from the development script (PLAN-070 §6.4). The set for both RAUC
  roles is `ecdsa-p256 | ecdsa-p384 | rsa-3072 | rsa-4096`, bounded by
  OpenSSL's CMS implementation, which is what a fielded `rauc` verifies with.
  **A production ceremony that chooses differently from the development
  default is the ceremony doing its job**; what is not permitted is a value
  outside the set, and `rootfs/build.sh`'s **A2** refuses a build whose
  `meta/` holds one.
- **Record the choice and the reason in the minutes.** The value is
  recoverable from the certificate; the *reason* is not.
- The CA validity horizon is a **fleet decision, not a default**: §2.1 uses 15
  years and states why — a device that misses a rollover window keeps this CA
  until it is reflashed, so the CA must outlive the fleet, and an expired
  baked keyring breaks updates on every device at once. If §6's rotation
  channel is approved, that reasoning weakens and the horizon should be
  revisited **at that time**, not pre-emptively.

Outputs, and where each goes:

| Output | Where it goes | Never |
|---|---|---|
| `ca.key.pem` | sealed medium, offline custody | a release host, a build host, a backup that syncs |
| `ca.cert.pem` | the build host, as `meta/rauc/ca.cert.pem` | — |
| `signer.key.pem` | the release host, as `meta/rauc/signer.key.pem`, mode 0600 | anywhere else |
| `signer.cert.pem` | the release host, as `meta/rauc/signer.cert.pem` | — |

#### 7.2 Part B — the package signing key

**New, and it is new because PLAN-070 question 6 made it so.** The release side
is lode's scheme, so `meta/updates/root.key` is a key that signs **every
release, on the release host** — the opposite custody from the CA, and the
runbook has to say so, or a reader who has just read Part A will assume the air
gap covers both.

The material, exactly as `pkgs/rauc/gen-dev-keys.sh --domain updates` produces
it for development, so that the production shape and the development shape are
the same shape:

```sh
umask 0077

# The package signing key. ed25519, and the allowed set for this role is
# {ed25519} ALONE, because lode verifies with ed25519-dalek and that verifier
# has no second algorithm. Raw PKCS#8 DER, which is what lode's tooling reads
# -- and the reason rootfs/build.sh's private-key detector carries a DER test
# rather than only a grep for PEM armour.
openssl genpkey -algorithm ED25519 -outform DER -out root.key
chmod 0600 root.key

# The public half in lode's trusted_keys spelling: base64 over the RAW 32
# bytes, which are the tail of the 44-byte SubjectPublicKeyInfo DER.
openssl pkey -inform DER -in root.key -pubout -outform DER | tail -c 32 | base64

# The key id an operator compares against these minutes: sha256 over those
# same raw 32 bytes. The build derives this into trust.signingKeyIds
# (PLAN-070 F7); it is written down HERE so the comparison has two ends.
openssl pkey -inform DER -in root.key -pubout -outform DER | tail -c 32 | sha256sum
```

Then, in the release host's `meta/updates/manifest.json`:

- paste the base64 public half into `trust.signingKeys` as a **list entry**.
  The field is a list on purpose (PLAN-070 §2.1): an image trusting both the
  outgoing and the incoming key is what an overlap window is, and a scalar
  forecloses it for no saving.
- leave `trust.signingKeyIds` **empty**. It is derived by the build, and a
  hand-written value is a second truth for a fact that has one source.

**Custody, and it differs from Part A's:**

| | The RAUC CA key | The package signing key |
|---|---|---|
| Where it lives | sealed, offline | **on the release host** |
| Why | it signs signer certificates at a ceremony, rarely | it signs every release |
| What protects it | an air gap | host hardening, restricted access, an audit trail |
| If stolen | mint a signer the fleet already trusts, and **install a system** on every device until reflash | have a device accept a forged package as authentic, download it, verify it, and then **fail to install it** |

The second column is the reason the split exists, and the last row is
PLAN-070 §6.2's blast-radius sentence: **both gates must fall**, and they fall
to different keys with different custody.

A copy of `root.key` goes to a sealed medium as well — not for an air gap,
which it does not have, but because losing it means every fielded device
trusts a key nobody can sign with any more, and the remedy for that is a new
image.

#### 7.3 Part C — placing the material, and what the build then does

`release-signing.md` §2.5 is the placement procedure and is not restated. Two
things are worth being explicit about here:

- **`meta/GENERATED` must not exist.** That marker means development-grade,
  nothing but the generator may write it, and after §2 it is baked into the
  image and reported by the device. If it is present when production material
  is placed, delete it **because the material is now production** — the one
  condition its own text permits deletion under.
- **`meta/rauc/ca.key.pem` must not exist on this host.** The CA key never
  touches a release host; signing a release needs the *signer* key.

Then the mechanisms take over, and each is a thing a reviewer can run:

| What it proves | How |
|---|---|
| the image trusts the CA the ceremony produced | `packed-keyring-from-meta` — byte equality against `meta/rauc/ca.cert.pem` |
| the image ships the anchor and nothing else | `packed-meta-is-the-public-set` |
| no private key reached the image | `no-private-key-in-baked-meta`, with the file count it scanned |
| the material is production-grade | the absence of `/usr/share/mos/meta/GENERATED` in the image, asserted in both directions (§2.1) |
| the device agrees | `GET /api/v1/system/info` → `trust.grade: "production"` (§3) |
| a development image cannot be published | the release gate refuses `candidate`/`stable` and names the file (§4) |
| the baked key id matches the minutes | `trust.signingKeyIds` against §7.2's recorded sha256 — **owed by PLAN-070 F7** |

#### 7.4 Part D — the minutes

Filled in during the ceremony, signed by both people present, filed where the
release owner's policy says. The auditable questions are the ones a reviewer
asks a year later:

1. **Date, place, and the two names.**
2. **The machine**: what it was, how it was booted, and that no network
   interface was up. Recorded as an assertion the witness signs, because it is
   not recoverable afterwards.
3. **Per key generated**: the role, the algorithm and the reason for it, the
   validity horizon and the reason for it, the subject, and the public
   fingerprint — `openssl x509 -noout -fingerprint -sha256` for the
   certificates, §7.2's sha256 for the package key.
4. **Per medium**: its label, which key is on it, where it was sealed, and who
   holds it.
5. **What left the room** and what did not — §1.5's discipline applied to both
   domains.
6. **What was destroyed**, if anything, and who watched.

A reviewer establishes that the ceremony was followed by comparing (3) against
what the build and the device report: the certificate fingerprint against the
keyring in the image, and the package key's sha256 against
`trust.signingKeyIds`. **Both ends of both comparisons are mechanical**, which
is the property that makes minutes worth writing.

#### 7.5 What this runbook does not cover

Stated explicitly, because a runbook that is silent about its edges reads as
complete:

- **Key custody policy.** Who may hold a medium, whether an n-of-m split is
  required, where the safe is, and what happens when a holder leaves. This
  runbook assumes a policy exists and records what it is; it does not set one.
- **HSM or KMS.** Every command here is `openssl` against a file. A ceremony
  performed into an HSM produces the same public outputs and a different
  custody story, and the mechanisms in §7.3 would be unchanged — but the
  procedure is not written and nothing here is tested against one.
- **The rotation ceremony.** §6 is undecided, so there is no ceremony for the
  rotation key and none is invented here.
- **CA rollover and signer reissue.** `release-signing.md` §2.4 and §2.2 own
  those, and §2.4's compromise caveat is unaffected by anything in this record.
- **Revocation.** There is no CRL path to devices
  (`security-lifecycle.md` §1.2), and this runbook adds none.
- **The release host's own hardening.** Part B's custody column says host
  hardening protects `root.key`; what that means concretely is an operations
  document this repository does not hold.
- **Anything about a specific product deployment** — its update server, its
  channel, its `product.vendor`. Those are `meta/updates/manifest.json`
  content, per deployment, and PLAN-070 §5 owns them.

### 8. `pkgs/rauc-sign`: a recommendation, and not a decision

PLAN-070 question 6 settles that the release side becomes lode's scheme and
**explicitly leaves open** whether `pkgs/rauc-sign` is deleted or kept as a
release-side tool with its two device binaries dropped from the image, noting
that the question belongs with `docs/design/release-artifacts.md`. This record
**does not decide it and must not decide it as a side effect**, so nothing
below touches that crate.

The recommendation, offered because Gate A is where the evidence turns up:
**keep the release-side tool, drop the two device binaries from the image.**

- The device binaries are the part Gate A is about, and they are the part that
  is provably unused: `docs/user/security.md` §2 and
  `pkgs/rauc-sign/README.md` both record that nothing has ever provisioned the
  root they verify from. Shipping a verifier whose anchor does not exist is
  what produced this gate.
- The release-side tool is 7351 lines of Rust with a substantial offline test
  suite, including root rotation and seven rotation refusals. If §6's rotation
  channel is ever approved, **that is the closest thing in the tree to a worked
  implementation of signed trust rotation with a chain rule**, and deleting it
  before that decision is taken is deleting the evidence for it.
- Deletion is cheap to do later and impossible to undo cheaply.

This paragraph is input to `release-artifacts.md`'s open question, not an
answer to it.

## Risks

- **The marker becomes a thing to keep true, and PLAN-070 named that cost.**
  Three readers now depend on `/usr/share/mos/meta/GENERATED`: the verifier,
  the device surface and the release gate. The mitigation is that all three
  read the same file at the same path, and two of them assert it in both
  directions; the failure being guarded is a fourth reader that infers the
  grade some other way, and §2 forbids that explicitly.
- **The gate's extraction is caller-supplied.** §4.1 states the bound. A caller
  who hands over the wrong directory gets an answer about the wrong directory.
  This is inherited from `--package-manifest` rather than invented, and the
  vacuity guard means the wrong directory usually **throws** rather than
  passing.
- **A channel-conditional refusal can be sidestepped by publishing to
  `development`.** True, and it is the point: `development` carries no promise.
  The residual risk is somebody re-labelling a development directory as stable
  by hand, which the gate catches on re-run because it re-measures.
- **`docs/user/security.md` §2 gets less wrong rather than right.** After this
  work the anchor is provisioned and the shipped client does not read it (§5).
  Writing that carefully is most of the documentation work, and writing it
  carelessly re-creates the exact defect this gate exists to fix.
- **RFCT-301 is in flight.** Every mechanism here lands on files that task is
  rewriting. If it does not merge, none of this can be implemented as written,
  and implementing it against the pre-`meta/` tree would build a second seam
  beside the approved one.
- **§6 stays open, and open is a state that decays.** A rotation gap that is
  recorded and undecided reads, six months on, like a gap nobody noticed. The
  decision named in §6.5 is the thing to schedule, not the design.

## Scope

**In scope, and implemented under [RFCT-305](../task/RFCT-305.md):**

- the baked development-grade marker, its conditional allowlist entry, and the
  biconditional in `packed-meta-is-the-public-set` (§2);
- the `trust` member on the system-information surface, its redaction
  allowlist entry, and its absent case (§3);
- the release gate's two refusals and the `--baked-meta` input (§4);
- the documentation those three make true, mirrored into `docs/zh/`.

**In scope as design only:** §6's rotation path, §7's ceremony runbook, §8's
recommendation.

**Explicitly out of scope:**

- **Any production key.** Nothing here generates, holds, reads or transports
  one.
- **PLAN-070 F5–F11**, and F7 in particular: making `rauc-update` read
  `trust.signingKeys` is what completes the anchor's device side, and it is
  PLAN-070's slice, not this record's.
- **The rotation channel's implementation**, pending §6.5's decision.
- **`pkgs/rauc-sign`'s fate**, which belongs to `release-artifacts.md`.
- **Gates B, C and D.** PLAN-037's ordering puts them after this.

## Alternatives

1. **Leave the marker on the build host and have the release gate read
   `meta/GENERATED` from the repository.** Zero new baked files. Rejected: the
   gate then answers "was this host development-grade", which is green on any
   host with no `meta/` — including the archive-restore case its own contract
   names — and the device still cannot answer question 4 at all. It is the
   cheaper change and the check that cannot fail on the defect it was built
   for.
2. **Bake a derived grade document rather than the marker verbatim.** A
   `{"grade": "..."}` JSON is easier to parse. Rejected: it is one fact stated
   twice with no rule for a disagreement, which is precisely the shape
   PLAN-070 §2.1 rejected for the anchor; and byte-equality against the source
   is the assertion the seam already makes everywhere else.
3. **Have the release gate unpack the image itself.** Strictly stronger: the
   fact would come from the artifact with no caller in between. Rejected for
   now: it needs the verify toolset inside `build/`, duplicating machinery
   that exists, and `release-artifacts.md` §3 already took this tradeoff for
   `--package-manifest` with a recorded reason. Re-openable if the gate ever
   needs a second fact out of the image, at which point one extraction serves
   both.
4. **Refuse a development-grade image on every channel.** Simplest rule,
   strongest sentence. Rejected: no production material exists yet, so it
   would make the release path unrunnable and ship the publication gate
   untested. §4.2 is the reasoning.
5. **Infer the grade from the CA certificate's subject** (`/O=mos
   development`). No new file at all. Rejected: PLAN-070 §1.2 forbids guessing
   the grade from the bytes, and a production ceremony is free to choose any
   subject — including, on a bad day, one that contains the word development.
6. **Design the rotation channel and implement it here.** Rejected: §6.5. It
   reverses an approved property, creates a third production key, and is
   plan-sized on its own.
7. **Put the ceremony runbook into `release-signing.md` now.** Rejected for
   sequencing, not content: that file is being rewritten by RFCT-301 in the
   same window, and a runbook nobody has approved is a procedure sitting in a
   document that reads as approved. It migrates there as a slice once this
   plan is approved (backlog G7).

## Approval boundary

**This plan ends at an approved seam.** What approval means, exactly:

- Gate A is **two piles**: a human ceremony this repository never performs, and
  mechanism that makes the ceremony's output verifiable and its absence
  detectable. The seam between them is `meta/GENERATED`;
- **PLAN-070 open question 4 is answered: yes**, the image carries the
  development-grade marker, verbatim, at `/usr/share/mos/meta/GENERATED`, as a
  conditional third entry on the public-set allowlist, asserted in both
  directions;
- a device **states its trust grade** on `GET /api/v1/system/info`, with the
  domains the marker names, and reports **absent with a reason** — never
  `production` — when the baked `meta/` tree is not there;
- the **release gate refuses** a `candidate` or `stable` release whose image
  carries the marker, naming the file and the domains; a `development` release
  records the grade and proceeds;
- the gate also refuses an image whose baked manifest **names a source and
  trusts no key**, while an empty key list with no source stays a supported
  steady state;
- the gate's fact is **measured from an extraction of the image**, handed in as
  `--baked-meta`, on `--package-manifest`'s precedent and with its bound
  stated; the reader **throws** rather than passing when the extraction does
  not carry the mandatory member of the public set;
- **the trust anchor's provisioning is PLAN-070 F3's**, not this record's, and
  what is honestly true after it lands is §5's table — mechanism provisioned,
  value from the ceremony, reader owed by F7;
- **rotation requires either physical access or a second anchor**, and the
  recommended shape is an offline trust-rotation key that signs nothing else, a
  monotonic signed trust statement, a STATE-backed keyring behind a bind mount,
  and two transports. **It is designed and not approved**;
- the **decision the user must take** is §6.5's: whether a device-time
  trust-rotation channel is wanted for 1.0 at the price of a third offline key
  and of PLAN-070 §6.3's immutability property. Answering "no" is a defensible
  product position and leaves the gap recorded rather than unrecorded;
- the **ceremony runbook is §7**, including §7.5's explicit list of what it does
  not cover, and it is a design deliverable here rather than an edit to
  `release-signing.md`;
- `pkgs/rauc-sign` is **recommended** to be kept release-side with its device
  binaries dropped, and that recommendation **decides nothing**.

Approval does **not** authorise writing §6's rotation channel, touching
`pkgs/rauc-sign`, or performing any part of §7.

## Implementation backlog — estimated separately from approval

Sized in slices, each independently verifiable. G1–G6 are RFCT-305 and are the
mechanism half; every one of them lands **on RFCT-301's seam** and none can be
written before it merges.

| # | Slice | Size | Gate |
|---|---|---|---|
| G1 | The conditional allowlist entry in `rootfs/build.sh`: `META_PUBLIC` gains `GENERATED`, staged iff present; B1's count becomes "entries whose source was present", with the required ones still mandatory | S | a development tree bakes the marker; a tree whose marker is deleted bakes none and stays green; a required member still missing is still red |
| G2 | `packed-meta-is-the-public-set` gains the biconditional: the image carries the marker **iff** `meta/` does, byte-equal when both | S | both directions RED — an image with a marker its tree lacks, and an image without one its tree has; the absent-`meta/` throw is unchanged |
| G3 | The `trust` member on `system_info.rs`, its evidence field and observer read, plus the `trust` entry in apid's diagnostics redaction allowlist | M | fixture trees for all three cases; **an absent baked `meta/` tree reports `available: false`, and a test that plants exactly that is RED against a reader that answers `production`**; a snapshot carries the member |
| G4 | The release gate: `readBakedTrust` with its throw-on-missing-manifest guard, the `trust` block in `ReleaseManifest`, the assembly measurement, the gate's agreement check, and both refusals | M | dev-grade + `stable` red naming the file and domains; dev-grade + `development` green with the grade recorded; production-grade + `stable` green; source-set-with-no-keys red; **an absent or empty `--baked-meta` throws** |
| G5 | `--baked-meta` / `MOS_BAKED_META` on `release-cli.ts`, and the Makefile documentation that names it | S | an unrecognised flag is still refused; the gate cannot be run without the input |
| G6 | Documentation: `docs/user/security.md` §2's three bullets rewritten to what is true, `docs/design/diagnostics.md` §2's member table, `docs/design/release-artifacts.md` §2 and §5 (the schema's `trust` block, the new input, both refusals), `docs/design/security-lifecycle.md` §1.2 and `docs/design/manufacturing.md` §1 where a convention became a mechanism — each mirrored into `docs/zh/` in the same commit | M | `make docs-verify`; **nothing marked shipped that is not**, and §5's table is the wording source |
| G7 | §7's runbook migrated into `docs/design/release-signing.md` as a new section, with §7.5's limits | S | `make docs-verify`; no restatement of §2.1's or §2.5's shell blocks |
| G8 | **The rotation channel** (§6): the signed trust-statement format, the device-side verifier, the STATE seam and bind mount, both transports, and the reset interaction | **L** | **blocked on §6.5's decision; not authorised by approving this plan** |

G1 and G2 are a pair, for F3/F4's recorded reason: G1 without G2 proves only
that the build meant well. G3 and G4 are independent of each other and both
depend on G1. G6 depends on all of G1–G5 landing, because it is the slice that
writes down what became true. G7 depends on this plan being approved and on
nothing else. G8 depends on a decision.

## Annotations

- 2026-09-04 19:10 UTC: Created for PLAN-037's Gate A. Answers PLAN-070 open
  question 4 (yes, with the evidence in §2), designs the rotation path and
  stops at §6.5's decision, and carries the ceremony runbook in §7.
