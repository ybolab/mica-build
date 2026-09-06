# Key delivery: produce, hand over, place, verify

> **Status:** delivery record. [`release-signing.md`](release-signing.md) is
> written for the person standing in the ceremony room. This page is written
> for everyone downstream of them: the integrator who receives signing
> material, the operator told to place it on a build host, and the engineer
> asked a year from now whether what is on this host is the right material at
> all. It repeats no ceremony step. Where a procedure exists, this page points
> at it and picks up where it stops — which is the moment material leaves the
> room.

## 0. What this page owns, and what it does not

This page owns the handover: the artefact inventory as a *recipient* sees it,
the rule for what may travel, the delivery form (and the fact that this
repository defines none), the checks a recipient runs before building
anything, and the refusals that fire when the material is wrong.

It owns none of the ceremonies. Each stays where it is:

| For | Read |
|---|---|
| the TUF root ceremony | `release-signing.md` §1 |
| what leaves the TUF ceremony room | §1.5 |
| the offline RAUC CA ceremony | §2.1 |
| signer reissue, and repairing an expired archive | §2.2 |
| CA rollover | §2.4 |
| the exact `cp`/`chmod` lines that place material on a build host | §2.5 |
| the two domains, three keys, and the custody asymmetry | §2.6 |
| signing a release bundle, and the offline lockbox | §3, §3.2 |
| what never happens, as a list | §4 |

§2.5 is the placement procedure and this page does not restate it. Section 4
below starts *after* those lines have been run.

**Every command block below was run, and what it printed is quoted verbatim.**
This repository contains no production signing material and cannot: `meta/` is
gitignored and a production key never enters a checkout. So the runs are
against development-grade material and against images built from it, and each
quote says which. Where a claim is about the production shape specifically, the
evidence is a check whose fixture *is* that shape, and it is named.

## 1. What is produced, and what each artefact is for

A mos release is signed twice, by two hierarchies that share no key and no
file. §2.6 is the table; this is the paragraph a reader who has not read it
needs.

**The image domain** produces a certificate authority — `ca.key.pem` and
`ca.cert.pem` — and, chained to it, a short-lived bundle signer,
`signer.key.pem` and `signer.cert.pem`. The CA *certificate* becomes the
device's RAUC keyring; the signer CMS-signs each `.raucb` bundle. This chain
gates the A/B system image, so compromise here means an attacker **installs a
system**.

**The package domain** produces one ed25519 key, `root.key`, over the update
package and its release metadata. Its public half is baked into the image's
update configuration as `trust.signingKeys`. Compromise here means an attacker
gets a device to accept a forged package as authentic — and then fail to
install it, because installation is the other gate. Both gates must fall for a
device to run attacker code, which is the whole value of the split.

Three private keys, then: `ca.key.pem`, `signer.key.pem`, `root.key`. Alongside
them the ceremonies produce the public artefacts a recipient actually receives
and places: `ca.cert.pem`, `signer.cert.pem`, and this deployment's own
`updates/manifest.json`, edited from the committed
[`meta.example/`](../../meta.example/README.md).

The TUF ceremony also produces `1.root.json`, and it is worth naming here
because its absence downstream surprises people: **no device receives it.**
Devices read their package-trust anchors from the baked
`usr/share/mos/meta/updates/manifest.json` and from nowhere else (§2.3, §3.1).
`1.root.json` is the anchor a *human* verifying a published repository uses
with `rauc-sign verify --root`; it is not part of a device delivery.

## 2. What travels and what never does

§1.5 states this for the TUF domain. The RAUC domain needs the same statement
and it is **not symmetric**, so it is stated here as a rule rather than as a
list of files:

> **A private key travels exactly as far as the machine that must use it, at
> the cadence it is used — and no further.**

The tempting rule, "private material stays and public material travels", gets
the RAUC side backwards. What decides custody is *use frequency*, not secrecy:

- **`ca.key.pem` never travels.** It is used once per signer reissue, on an
  offline machine, and nothing else in this design ever needs it. It does not
  reach a build host, a release host, CI, or a delivery to an integrator; §2.5
  provisions a release host without it **on purpose**, and §4's second item
  says so as a rule.
- **`signer.key.pem` does travel, to exactly one place.** It signs every
  bundle, and `rauc bundle` takes PEM file paths — there is no PKCS#11 wiring
  in the bundle builder — so it is a file on the release host and that host's
  hygiene is part of the trust model. What pays for that exposure is the
  45-day validity window (section 6), which is the only revocation this design
  has.
- **`meta/updates/root.key` also lives on a release host**, for the same
  reason and with the same consequence: it signs every package, locally, so it
  cannot be kept offline. What protects it is host hardening and an audit
  trail rather than an air gap — a weaker protection, accepted deliberately
  for a key whose compromise buys a forged package rather than an installed
  system.
- **The public halves travel freely**: `ca.cert.pem` (which becomes the
  keyring), `signer.cert.pem`, `updates/manifest.json`.
- **Nothing private reaches a device, by allowlist.** Exactly two files leave
  `meta/` for the image — `rauc/ca.cert.pem` and `updates/manifest.json` — plus
  the `GENERATED` marker when it is there. Section 4 is where a recipient
  proves that on their own image.

**The consequence a handover must state out loud.** A recipient who is given
`signer.key.pem` and the public halves, but not CA custody, **cannot reissue
the signer when it expires**. The reissue needs the CA key, which by the rule
above they will never hold. Whoever holds the sealed CA media owns that
calendar; a delivery that does not name them has handed over a 45-day fuse with
nobody holding the match.

## 3. How it is delivered

**This repository defines no delivery format.** There is no packaging
convention, no transfer tool, no `make` target that produces or ingests a
handover bundle, and no signed manifest a recipient can check a delivery
against. That is stated plainly here rather than left for a reader to discover
by looking for one.

What the tree *does* record is a **medium discipline**, and it is the
ceremonies' own (§1.5, §2.1):

- offline media, two or more copies, in separate physical locations, in
  tamper-evident envelopes, with a written custody record of who sealed what
  and when;
- host-bound keys (the online TUF roles; by extension the RAUC signer) move on
  media that is **wiped afterwards**, and land mode `0600`;
- public anchors are distributed **out of band**, and their sha256 is recorded
  in the ceremony minutes — `1.root.json`'s in §1.5, `ca.cert.pem`'s in §2.1,
  next to it.

That sha256 in the minutes is the only integrity value this design names for a
delivery, and the minutes are not a file in this repository. So, until a
delivery format exists, do this and record that you did:

1. **One sealed medium per delivery.** The custody record names the sender, the
   recipient, the date, and the file list.
2. **The checksums travel on a different channel from the medium.** A
   `SHA256SUMS` on the same USB stick as the key proves the stick is
   self-consistent, which is a property a substituted stick also has.
3. **The recipient recomputes before placing anything**, compares against the
   minutes, and sends the values they computed back to the sender. A handover
   is complete when both sides hold the same list, not when the medium arrives.
4. **Nothing is emailed and nothing is committed.** `git ls-files meta/` is
   empty and section 4's first step is what keeps that honest.

And the honest framing, because the above is discipline rather than mechanism:
with no signed handover, **the transfer is not what should give a recipient
confidence.** What should is section 4 — the build refusing material it cannot
use, and the image checks reporting what actually got baked. Verify the
material by what the build does with it.

## 4. What the recipient checks, before building anything

Six steps, in order. Each one is a command with an exit status, not an
impression.

### 4.1 The material never arrives through a clone

`meta/` is gitignored, so nothing in it is in the history and no delivery can
be performed by `git pull`. The committed statement of the directory's shape is
[`meta.example/`](../../meta.example/README.md), which carries no `rauc/` and no
key of any shape, not even a placeholder.

```console
$ git ls-files meta/ | wc -l
0
```

That is an absence, and an absence is worth a check rather than a glance.
[`tests/trust-domain-hygiene-test.sh`](../../tests/trust-domain-hygiene-test.sh)
is the one that holds it, and it holds both domains at once:

```console
$ bash tests/trust-domain-hygiene-test.sh
PASS: no key or trust-root material is tracked by git
PASS: meta/rauc/ is gitignored
PASS: meta/updates/ is gitignored
PASS: ca/ is gitignored
PASS: pkgs/rauc-sign/.devkeys/ is gitignored
PASS: pkgs/rauc/.devkeys/ is gitignored
PASS: pkgs/rauc-sign/src/ names no RAUC CA/signer/keyring file
PASS: the RAUC build surfaces name no TUF key directory or .pk8 file
RESULT: PASS (8 passed, 0 failed)
```

### 4.2 The received anchor is the one the ceremony minted

```console
$ sha256sum meta/rauc/ca.cert.pem
d77d3cac806f2ac879fa9d0710dde886ae5c1c91fb4f2368c2d9c32fe3ad2e1d  meta/rauc/ca.cert.pem
```

*(development-grade material in a working tree; the value is meaningless off
this host and is shown for the shape of the step.)*

Compare it against the ceremony minutes, on the channel the minutes came by.
**This is the only step in this list with no script behind it**, and section 5
explains why that matters more than it looks: every automated check below
asserts that the image agrees with `meta/`, and none of them can know whether
`meta/` holds *your* CA.

### 4.3 The pair chains, and the windows are the ones the ceremony set

```console
$ openssl verify -CAfile meta/rauc/ca.cert.pem meta/rauc/signer.cert.pem
meta/rauc/signer.cert.pem: OK

$ openssl x509 -in meta/rauc/signer.cert.pem -noout -subject -issuer -dates
subject=O = mos development, CN = mos development bundle signer
issuer=O = mos development, CN = mos development CA
notBefore=Sep  6 19:22:13 2026 GMT
notAfter=Oct 21 19:22:13 2026 GMT
```

*(development material again; the same two commands are what a recipient runs
on production material.)* `notBefore` to `notAfter` is 45 days — the window
declared in [`pkgs/rauc/key-validity.env`](../../pkgs/rauc/key-validity.env),
which section 6 is about. A recipient who reads a materially different number
here has been given material from a ceremony that did not follow §2.1, and
should stop rather than build.

### 4.4 Place it, and let the build read it: A1 and A2

Place per §2.5, then run a build. Two refusals in
[`rootfs/build.sh`](../../rootfs/build.sh) read the signing material before any
of it is staged:

- **A1** checks that the *declared* algorithm for each key role, in
  [`pkgs/rauc/key-algorithms.env`](../../pkgs/rauc/key-algorithms.env), is
  inside that role's allowed set. It runs before the generator, so a refused
  value never mints a key.
- **A2** checks that the material **actually present in `meta/`** is inside its
  role's set. A1 alone passes exactly the production case — production material
  is *placed* by an operator rather than minted, so every declared value can be
  in range while the placed files are not. A2 additionally covers
  `meta/updates/root.key`, which A1 could never see at all: the package key is
  not minted on the build path, so nothing A1 reads describes it.

Both are green here, on this tree's material:

```console
$ MOS_BOARD=x64 bash rootfs/build.sh
meta: declared key algorithms -- CA ecdsa-p256, signer ecdsa-p256, package ed25519 (pkgs/rauc/key-algorithms.env)
pool: /srv/bkd/worktrees/33z9aa5q/qjq7dk6b/_out/debs/amd64, 17 archive(s) at stamp gitef07af2fba87-1
meta: A2 read 4 file(s) of key material in meta/; every one is in its role's allowed set
meta: staged and checked 3 of 3 public-set entries from meta/ -- etc/rauc/keyring.pem usr/share/mos/meta/updates/manifest.json usr/share/mos/meta/GENERATED
```

**Read the count.** A2 checks each file that is *there* — §2.5 provisions a
release host without `ca.key.pem` on purpose, and demanding a file that rule
says must be absent would refuse every production build. Four here because a
development tree keeps the generated CA key beside the rest. A host provisioned
by §2.5 has three (`ca.cert.pem`, `signer.cert.pem`, `signer.key.pem`), plus
`root.key` when the deployment signs packages. The number is printed because a
check that does not say what it read cannot be told apart from one that read
nothing.

### 4.5 Verify the image that came out

Two checks read the baked result from the other end, and they are not
belt-and-braces with A2: A2 proves the build's *intent*, these prove the
*outcome*, and an outcome check does not care how a file arrived — an overlay
leftover, a package postinst, a stray `cp` in a later slice.

Run on all three boards in this tree today, against images built at this
commit:

```console
$ bash verify/run.sh --verify --board x64
$ bash verify/run.sh --verify --board cx3576
$ bash verify/run.sh --verify --board virt-arm64
```

Each printed, identically:

```text
PASS: the baked meta/ is exactly the public set: /usr/share/mos/meta/ holds exactly 2 file(s) [updates/manifest.json GENERATED], matching sources under /srv/mos/meta/ (manifest signingKeyIds derived from key bytes; other files byte-equal)
PASS: no private key material is baked into the image: scanned 4 file(s) under [/usr/share/mos/meta /etc/rauc] with all three detectors (PEM private-key armour, a DER PKCS#8 PrivateKeyInfo header, a key-container filename extension) and none carries any
```

with a third that names the grade it read rather than refusing it:

```text
PASS: the shipped RAUC keyring came from meta/: /etc/rauc/keyring.pem is /srv/mos/meta/rauc/ca.cert.pem byte for byte, and that material carries /srv/mos/meta/GENERATED, so it is DEVELOPMENT-GRADE: every device flashed with this image trusts bundles signed by a key in a working tree. A release build puts production material in meta/ instead, and CI is what chooses which is there
```

and, per board:

```text
RESULT: PASS (315/315 checks, 22 skipped (x64/grub; each named above))
RESULT: PASS (418/418 checks, 3 skipped (cx3576/uboot; each named above))
RESULT: PASS (313/313 checks, 22 skipped (virt-arm64/grub; each named above))
```

The scan count is part of the verdict for the same reason A2's is: those two
directories are mos-owned and always populated, so a scan of zero files is
refused as a check that read nothing rather than reported as a clean image.

### 4.6 The marker, which is how a recipient knows the delivery took effect

`meta/GENERATED` is present **exactly when** the signing material is
development-grade. Nothing may write it but `pkgs/rauc/gen-dev-keys.sh`, it is
baked into the image at `usr/share/mos/meta/GENERATED` if and only if the tree
has it, the device reports that grade on `GET /api/v1/system/info`, and the
release gate refuses to publish a marked image to `candidate` or `stable`.

So:

> **A production delivery is one that produces an image with no marker** — and
> therefore an image whose baked `meta/` holds **one** file, not two.

That is the single most useful sentence for a recipient asking "did my material
actually take effect?". The development reading is quoted in section 4.5 above:
two files, `GENERATED` among them. The production reading is the positive
control in `verify/src/checks-root.test.ts`, whose fixture carries no marker —
`holds exactly 1 file(s) [updates/manifest.json]` — and that file is green:

```console
$ bash verify/run.sh src/checks-root.test.ts
 68 pass
 0 fail
 447 expect() calls
RESULT: PASS (68/68 tests)
```

Both directions of the biconditional are refusals in that check, and they are
different defects: an image without the marker its tree has calls development
material production, which is exactly what the publication gate reads; an image
with a marker its tree does not have refuses every release built from that
tree.

On a development tree the build says the same thing at the top of its voice:

```text
############################################################
# WARNING: this image trusts a DEVELOPMENT RAUC keyring    #
# at etc/rauc/keyring.pem, staged from                     #
# meta/rauc/ca.cert.pem. Every device flashed with it      #
# trusts every bundle that CA signs. Never flash this      #
# image onto anything that leaves your desk. For a         #
# release, put real production material in meta/ --        #
# without meta/GENERATED beside it.                        #
############################################################
meta: GENERATED marks these domains development-grade: rauc
meta: the marker is baked at /usr/share/mos/meta/GENERATED, so the device reports this grade on GET /api/v1/system/info and the release gate refuses to publish this image to candidate or stable
```

A production build prints neither line. **Their absence is the receipt.**

## 5. What happens if it is wrong

### 5.1 Material outside its role's algorithm set

A2 refuses at the rootfs build, before anything is staged, naming the file, the
value it read, the allowed set and the verifier that bounds it. Placing an
RSA-2048 CA — a plausible output of a ceremony run from memory — produces:

```console
$ MOS_BOARD=x64 bash rootfs/build.sh; echo "exit=$?"
meta: declared key algorithms -- CA ecdsa-p256, signer ecdsa-p256, package ed25519 (pkgs/rauc/key-algorithms.env)
error: .../meta/rauc/ca.cert.pem is 'rsa-2048', which is not in the set of algorithms allowed for the RAUC CA (meta/rauc/ca.cert.pem).
       allowed: ecdsa-p256 ecdsa-p384 rsa-3072 rsa-4096
       That set is bounded by RAUC's own verifier -- OpenSSL's CMS implementation, which is what a fielded rauc checks a bundle signature with, and which is why the set is EC-or-RSA and excludes ed25519.
       A value outside it mints material that verifier cannot check, and the failure lands late and far away: on a device, at install time, after a download, on a fleet that already took the image. Changing an algorithm is a one-line edit to pkgs/rauc/key-algorithms.env; WIDENING the set is an edit to rootfs/build.sh and a claim about the verifier named above. There is no environment variable that softens either.
exit=1
```

And the case A1 structurally cannot see — an ECDSA key delivered for the
package role, whose verifier accepts one algorithm and no other:

```console
$ MOS_BOARD=x64 bash rootfs/build.sh; echo "exit=$?"
meta: declared key algorithms -- CA ecdsa-p256, signer ecdsa-p256, package ed25519 (pkgs/rauc/key-algorithms.env)
error: .../meta/updates/root.key is 'ecdsa-p256', which is not in the set of algorithms allowed for the package signing key (meta/updates/root.key).
       allowed: ed25519
       That set is bounded by lode's verifier -- ed25519-dalek, over [trust] trusted_keys entries of the form <key_id>:<base64 ed25519 public key>, which has no second algorithm.
exit=1
```

Note the first line of both: **A1 stayed green.** The declaration was correct
and the delivered material was not, which is the entire reason A2 exists.

*(Both runs were made by placing deliberately wrong material in a development
tree, and the paths above are elided to `...`; the real output prints the
absolute path.)*

### 5.2 Development-grade material published to a customer

The release gate refuses at assembly, and again when an already-assembled
directory is re-gated — the archive-restore path, which is why the grade
travels *inside the image* rather than being a fact about the build host. The
refusal names the file, the channel and the domains the marker declares, and it
is driven both ways by `build/src/release-manifest.test.ts`: every customer
channel refused, a directory relabelled to `stable` after assembly refused
again, development-on-`development` allowed with the grade recorded, and a
production-on-`stable` positive control that would fail if the gate simply
refused everything.

```console
$ bash build/run.sh src/release-manifest.test.ts
 128 pass
 0 fail
 203 expect() calls
RESULT: PASS (128/128 tests)
```

### 5.3 What none of this catches

The list matters more than the list above it, because every check in section 4
asserts that the **image agrees with `meta/`** — not that `meta/` is right.

1. **The wrong CA, correctly formed.** An `ecdsa-p256` CA from *any* ceremony
   passes A1, A2, `packed-keyring-from-meta` and both baked-set checks: it is
   well-formed, in the set, and byte-equal to what the build was pointed at.
   Nothing in this repository knows which CA was yours. Only section 4.2's
   sha256 comparison against the minutes catches it, and that is the one step
   with no script behind it. The same holds for a *misfiled* delivery — a
   `signer.cert.pem` copied over `ca.cert.pem` is the same algorithm and passes
   identically, and the first thing that notices is a device refusing to
   install.
2. **`ca.key.pem` on the build host.** §2.5 says it is not there. Nothing
   refuses it if it is: A2 reads it and checks its algorithm — it is one of the
   four files in section 4.4's count — and the build proceeds. The rule is
   procedural, and this page states it as one rather than implying a gate.
3. **Expiry, at placement time.** A2 reads algorithms, not dates. The refusal
   that reads `notAfter` lives in the bundle-signing path
   (`build/src/signer-window.ts`, threshold declared in
   `pkgs/rauc/key-validity.env`), so a signer with two days left places
   cleanly, bakes cleanly, and refuses at the first bundle.
4. **Whether the delivered chain actually installs.** The keyring read path is
   settled and testable without hardware, and the bundle build's read-back
   against the shipped `system.conf` is the first end-to-end check of the
   chain — but `rauc install` accepting a production-signed bundle **on a
   booted device** is documented and not tested (§2.3).
5. **Whether the *package* key is the one the ceremony produced.** The baked
   manifest carries the public halves and `trust.signingKeyIds` derived by the
   build from the key bytes; a recipient compares those ids against the
   ceremony record. Same shape as item 1: an eyeball comparison against a
   document outside this tree.

## 6. The 45-day clock a recipient inherits

Under PLAN-078 §4a the shipping organisation chose **monthly root access**: the
root CA issues every signer directly, with no intermediate. The signer's
validity is therefore short and declared once, in
[`pkgs/rauc/key-validity.env`](../../pkgs/rauc/key-validity.env):
`MOS_RAUC_SIGNER_VALIDITY_DAYS=45`. Section 4.3's measurement is that window,
minted.

§2.2 is the reissue runbook. What a *recipient* needs to have in place before
day 45 is the consequence, and it is four things:

- **A ceremony on somebody's calendar, and it is not theirs.** A reissue needs
  the CA key. If the recipient does not hold the sealed CA media — and by
  section 2's rule they should not — the reissue belongs to whoever does. The
  handover record names them.
- **An understanding of what the runway actually is.** `rauc bundle` warns
  inside its own non-configurable 30-day band, and the build **refuses** to
  sign inside `MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=7`, naming the `notAfter`
  it read. That is roughly a fortnight of warning and one week of hard stop.
  A signer that expires with no reissue stops the release line — loudly, and
  before the fact rather than after it.
- **A plan for the archive.** RAUC verifies a certificate against the current
  clock, so installing an *archived* `.raucb` whose signer has since expired is
  refused. The release side repairs its own archive with `rauc resign` under a
  reissued signer and the **unchanged** CA (§2.2, and read its warning about
  where that configuration may live). A customer holding a downloaded bundle
  cannot repair it and must re-download. A factory reflash to an older release
  is unaffected: the `.img` carries no CMS signature.
- **No device work at all.** Devices trust the CA, not the signer, so a new
  signer chains without any keyring changing anywhere. This is the one part of
  the clock that costs nothing.

An organisation that cannot keep a monthly cadence should lengthen the declared
window deliberately — which moves the ceremony block, the development mint and
the build's threshold together — rather than discover the number by missing a
date.

## 7. The gap §2 named, and the answer it now carries

`release-signing.md` §2's own header used to say **"with a named gap"**. The
gap is real and unchanged — **there is no provisioning-time channel that puts
`ca.cert.pem` on a device** — but it is no longer only an absence: §2.4a
decides what happens instead, and a recipient planning a fleet is entitled to
that answer here rather than three subsections deep in a runbook.

The image is the only road. A device trusts the CA that was baked into the
image it was flashed with, `/etc` is a read-only dm-verity squashfs replaced
whole by every A/B update, and the keyring is therefore replaced only by an
update that a currently-trusted CA signed. §2.4's rollover makes that sound for
a *scheduled* rotation — old and new CA coexist in one keyring during an
overlap window — and it cannot reach two states. **They have different
answers, and bundling them is the mistake this section exists to prevent:**

- **A device that misses the overlap window** — an **update**, not a reflash.
  The overlap release is republished into a *rescue repository*, still signed
  by the outgoing chain, and the device is pointed at it — over the network by
  an administrator-authenticated `source.url` override, or by a §3.2 lockbox
  when it has no route at all. It then installs a bundle its own keyring
  already trusts and rejoins the fleet. Nothing new is invented for this: what
  moves is where the device looks, never what it trusts. §2.4a case 1 has the
  steps, and §1.3 has the one thing a ceremony must do in advance for them to
  work — initialize that second repository while the root key is out.
- **Rotation away from a CA that is already compromised** — a **reflash**, and
  that is a decision rather than an omission. The attacker holds the same
  signing authority every remote path runs on, so no remote answer exists at
  all; physical re-provisioning is the mechanism, not a fallback. §2.4a case 2
  records it with its price.

For a delivery, that translates into three sentences a recipient needs before
they flash anything: **changing this CA later is an update every device must
take inside a window**; **a device that misses the window is recoverable, but
only if you can still reach it and only if the outgoing CA key was retained
rather than destroyed** (`release-signing.md` §2.4 phase 4 — the rule is
retain-sealed, and a recipient who destroys it early converts a recoverable
device into a reflash permanently); and **a compromised CA is a reflash, not
an update.** Which channel should one day deliver the file, and who holds,
rotates and revokes the signing CA, are product decisions this repository
records and does not make; the one open question that would change any of the
above is `docs/plan/PLAN-077.md` §6's third offline key, and it would change
only the compromise case.

Two smaller absences belong beside it, so they are named rather than met by
surprise:

- The TUF half of this question is **settled and is not a gap**: package
  anchors are baked inline in the manifest, there is no `root.json` for a
  device to receive and no `--root` on either device binary (§2.3, §3.1). The
  honest consequence, also §2.3's, is that the TUF hierarchy cannot outlive a
  compromise of the image signing path — whoever controls what gets baked
  controls what the package gate trusts. That independence is real at install
  time and not at provisioning time, which is why keeping the CA key offline
  carries the weight it does.
- The **recurring-ceremony runbook** — what a monthly signer reissue may skip
  and what it may never skip — is owed to PLAN-077 §7, which was written for a
  one-time event. Until it exists, run the full §2.1 signer steps every time.
