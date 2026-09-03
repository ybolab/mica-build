# PLAN-070 Design the meta/ seam: update configuration and trust anchors baked into the image

- **status**: draft
- **createdAt**: 2026-09-03 11:11
- **approvedAt**: (pending)
- **relatedTask**: (none — design only; task records are owed on approval)

## Context

### The correction this revision has to make first

The previous draft of this record designed a **device-side factory record on
the META partition**, written by an extended `mos-provisioning.toml` and
applied through a second commit target. That is not what was asked for, and the
correction belongs in the record rather than in a reviewer's head.

What is wanted is a **`meta/` directory in this repository**, holding
`meta/ca/`, `meta/manifest.json` and the like, which the **build bakes into the
image**, so that a shipped system already carries its online-update
configuration and its trust anchors. The seam is a **build-time input directory
beside `ca/`** — not a partition, not a provisioning payload, and not something
a device is handed after it is built.

Almost everything the old draft made hard becomes easy under that reading, and
one thing becomes genuinely harder. Both are stated here rather than discovered
later:

- **Gone**: the two-target atomicity argument across META and STATE; the
  extension of shipped, tested `provisioning_doc.rs`; the split authorisation
  rule (first write versus rotation versus physical presence); the
  effective-keyring seed-and-bind-mount; three of the four runtime failure
  states; the §5 re-apply procedure after a whole-disk reflash; and every new
  factory-station step. None of that is needed when the configuration is part
  of the image.
- **New**: the configuration is now per-**build**. Changing an update server,
  a channel default or a trust anchor means shipping a new image. §5 prices
  that plainly instead of burying it.

### `meta/` is not the META partition

The repository directory `meta/` and the on-device **META partition** mounted
at `/mnt/meta` are unrelated, and the name collision is real enough to trip a
reader who knows the partition table. This record uses `meta/` for the
repository directory only. **No part of this plan writes to, reads from, or
changes the meaning of the META partition**, which continues to hold RAUC's
`rauc.status` and nothing else. The old draft's entire content lived there; this
one does not touch it.

### What the tree already has

- **Trust, baked, from one place.** `rootfs/build.sh` stages
  `ca/ca.cert.pem` into the image at `/etc/rauc/keyring.pem`, inside the
  read-only dm-verity root; `build` signs bundles with
  `ca/signer.{cert,key}.pem`. `ca/` is gitignored, and a build that finds it
  empty generates a development-grade root and marks it `ca/GENERATED`.
  Two verifier checks hold that path from both ends: `rauc-keyring-path`
  (`verify/src/checks-rauc.ts`) asserts the rendered `system.conf` names
  exactly one keyring path, and `packed-keyring-from-ca`
  (`verify/src/checks-root.ts`) asserts the shipped keyring is **byte-equal**
  to `ca/ca.cert.pem`.
- **A build that already refuses a second source for a trust root.**
  `rootfs/build.sh` rejects an `etc/rauc/keyring.pem` found in the overlay,
  unconditionally and unwaivably, because the overlay is copied wholesale into
  every image and a file left there is a CA that arrives *by being forgotten*.
  That refusal is the shape §1 copies, and §6 is the reason it must not be
  contradicted.
- **Trust, unprovisioned.** The TUF pinned root. `pkgs/rauc-sign` builds and
  verifies the four-role repository and `rauc-update` walks it, but **no
  shipped mechanism puts `root.json` on a device.**
  `pkgs/rauc-sign/README.md` records three candidates and picks none;
  `docs/design/updates.md` §7 lists the anchor among the deployment contract
  still owed. **This plan picks the first candidate** — image-baked — and §6
  states the tradeoff the README already names for it.
- **A build-fact directory in the image.** `/usr/share/mos/` holds
  `manifest.tsv` (the bill of materials the SBOM derives from) and
  `release-identity.env` (`BOARD`, `PROFILE`, `VERSION`, `COMMIT_DATE`,
  written at compose time). Both are facts *about the build*, read by mosd and
  by `rauc-update`, inside the read-only root. §3 is why `meta/` belongs
  beside them.
- **Update configuration on STATE.** `update-policy.toml`, read fresh on every
  decision by `pkgs/mosd/mosd/src/update_policy.rs`. `source.url` has **no
  default** — an unset URL means no online source, and the offline import path
  remains. That absence is load-bearing and this plan preserves it.
- **A reset taxonomy in which the root filesystem already has its answer.**
  `docs/design/recovery.md` §2.1's columns include `system slot A` and
  `system slot B`; `pkgs/mosd/mosd/src/reset.rs`'s `Roots` type reaches the
  DATA pool and STATE and has no member for a slot. §4 is why that means this
  plan adds no row and no column.

### The reference: lode's `lode.toml`

`/srv/dotns/lode` is the named model, and the shape being adopted is its
**configuration file**, not its mechanism:

- `[update]` — `manifest` (the one place releases are discovered), `channel`,
  `policy = off | check | auto`, `check_interval`.
- `[trust]` — `require_signature`, `trusted_keys`, `trusted_keys_file`.
- `[http]` — the **same-origin credential rule**: credentials are attached to
  an artifact download only when its host is same-origin with the source, so a
  tampered catalog cannot redirect a token to an attacker; additional hosts are
  an explicit operator list.

Its `manifest.json` (`lode/v1`) is the *remote* release feed. §2 adopts its
document conventions — a `schema` tag first, one JSON object, no implicit
defaults — for a **local** document, and says where mos's whole-system RAUC
bundles make lode's per-app asset vocabulary inapplicable.

### What is missing

There is no place in this repository that says *where this image's updates come
from, which channel it defaults to, which trust roots it honours beyond the
RAUC CA, and whether it may talk to a fleet plane* — and that ships inside the
artifact. Every one of those is per-deployment configuration that today has
nowhere to live except an operator's hands after the device is already running.

## Proposal

### 1. `meta/` beside `ca/`: the boundary, and the refusals that hold it

Two sibling build-time input directories, and the difference between them is
the whole design:

| | `ca/` | `meta/` |
|---|---|---|
| Tracked by git | **no** — gitignored | **yes**, and the build asserts it |
| Holds | private keys, and the CA certificate they sign with | configuration, and public trust anchors |
| Supplied by | CI or the release operator, out of band | the repository, reviewed in a diff |
| Secret | **yes** | **no**, ever |
| Fleet-identical | yes (the public half) | yes, by construction |
| Enters the image as | `/etc/rauc/keyring.pem` — the certificate only | `/usr/share/mos/meta/` — verbatim |
| Absent in a fresh tree | generated development-grade, marked `ca/GENERATED` | cannot be absent; it is committed |

**What must never appear in `meta/`**, stated as three prohibitions rather than
one vague one:

1. **No private key of any kind** — not a CA key, not a signer key, not a TLS
   client key, not an SSH key.
2. **No per-device value** — not a serial, not a MAC, not a device id, not a
   claim code. Every device flashed from one image carries byte-identical
   `meta/` bytes, so a per-device value in it is a per-device value that is the
   same on every device, which is a defect with no correct reading.
3. **No secret of any kind** — no bearer token, no PSK, no password, no
   registration key. `meta/` is committed; a secret placed in it is published
   to everyone who can read the repository, and remains in the history after it
   is deleted.

#### 1.1 Three build-time refusals, in the shape `rootfs/build.sh` already uses

The existing overlay-keyring refusal is the model: a hard `error:` naming the
offending file, a paragraph saying why the rule exists and what to do instead,
`exit 1`, and **no waiver flag** — for build.sh's own stated reason, that a
waiver only reintroduces the second source the rule exists to forbid.

- **M1 — every file under `meta/` is tracked by git.** The build resolves the
  set with `git ls-files` and refuses an untracked one, naming it. This is the
  mechanical form of prohibition 2: a per-device or per-host value cannot be
  committed once and be different per device, so it can only arrive as a file
  the repository does not record. It is safe to depend on git here because the
  build already does — `rootfs/build.sh` reads the source commit's date for
  `release-identity.env`.
- **M2 — no private key material.** Refuse any file under `meta/` containing a
  PEM private-key armour, and any file whose extension is a key container
  (`.key`, `.p12`, `.pfx`, `.jks`). This is prohibition 1.
- **M3 — no X.509 certificate.** Refuse any `-----BEGIN CERTIFICATE-----` under
  `meta/`. The RAUC keyring has exactly one source and it is `ca/`; §6 is the
  argument, and M3 is what stops the argument from being prose. A future
  feature that genuinely needs a certificate in `meta/` for a non-RAUC purpose
  removes M3 *deliberately*, which is the correct cost for re-opening a
  settled question.

**The limit of M1–M3, stated rather than glossed.** A grep for PEM armour
catches the realistic accident — somebody copies a keypair in beside the
certificate they meant to copy. It cannot catch a secret that does not look
like one: a bearer token pasted into `manifest.json` is a JSON string and no
assertion distinguishes it from a URL. There is no check proposed for that,
because a token-entropy heuristic over a file full of URLs and hashes would
fire mostly on things that are fine, and a check whose findings are usually
false is a check people learn to pass. The defence is structural instead:
`meta/` is committed and reviewed, so a secret in it appears in a diff before
it ships, and — the part that actually deters — stays in the published history
afterwards.

### 2. `meta/manifest.json`: lode's vocabulary, mos's mechanism

One document, schema-tagged first key, no implicit defaults, unknown keys are a
**build** error for `update_policy.rs`'s reason: a mistyped key must fail
loudly rather than silently configure nothing.

```json
{
  "schema": "mos/meta/v1",

  "product": { "vendor": "example", "model": "mos-appliance" },

  "update": {
    "source":               null,
    "channel":              "stable",
    "policy":               "check",
    "checkIntervalMinutes": 1440
  },

  "trust": { "tufRoot": "ca/root.json" },

  "http": { "credentialHosts": [] },

  "fleet": { "enabled": false, "url": null }
}
```

**That is the document this repository commits**, and `update.source` is `null`
in it deliberately — §7. A product build edits it; the tree's own default
configures no server.

| lode `lode.toml` | mos `meta/manifest.json` | Verdict |
|---|---|---|
| `[update] manifest = <url>` | `update.source` | **Adopt the role, rename the key.** Both name the one place releases are discovered; lode's is a `lode/v1` JSON feed and mos's is a TUF repository root, so the same name would mislead |
| `[update] channel` | `update.channel` | **Adopt verbatim** |
| `[update] policy = off \| check \| auto` | `update.policy` | **Adopt verbatim.** PLAN-071 owns the semantics |
| `[update] check_interval` (seconds) | `update.checkIntervalMinutes` | **Adopt the key, keep mos's unit.** `update-policy.toml` is minutes today, and two units for one quantity is a defect waiting for a reader who does not notice |
| `[update] asset` | — | **No analogue.** mos selects a whole-system bundle by board, profile, channel and a version newer than `release-identity.env`'s; there is no filename to choose |
| `[update] keep_versions`, `pin` | — | **Structurally absent** (PLAN-071 §6): two slots, fixed by the partition table, not by a setting |
| `[trust] trusted_keys` (inline list) | — | **Not adopted.** A bare key list has no rotation rule |
| `[trust] trusted_keys_file` | `trust.tufRoot`, naming a file in `meta/` | **Adopt the file form.** mos's anchor is a signed TUF root with roles and its own rotation rule, which is strictly more than a key list and is the reason the list form is not adopted |
| `[trust] require_signature` | — | **Not adoptable**, and PLAN-071's Context already argues it: lode's `off` exists because lode can install unverified artifacts; mos has no such mode, and importing the setting would mean building one in order to configure it off |
| `[http] headers` | — | Not built. mos does not authenticate to its update source today and this plan adds no credential |
| `[http] credential_hosts` | `http.credentialHosts` | **Adopt the key and the rule now, empty by default** — the same-origin rule must exist before the first credential does, because the failure it prevents is silent |
| `[http] allow_insecure` | — | **No analogue.** The TUF walk establishes trust; `docs/design/release-signing.md` §3.1 already mirrors metadata over plain HTTP deliberately and treats the mirror as unverified input |
| `[global] app`, `[command]`, `[runtime]`, `[env]`, `[supervise]`, `[signals]` | — | lode launches and supervises one application; mos's supervisor is systemd and its unit of update is the whole system |

**Where mos differs, once, so no later reader re-derives it.** lode's
`manifest.json` is a *remote* catalog: it enumerates versions, assets, sha256
digests and ed25519 signatures, and lode reads it over the network. mos's
`meta/manifest.json` enumerates none of that, because all of it lives in signed
TUF `targets.json` on the server. Baking a copy of a release catalog into an
image would freeze a moving fact at build time and produce a second, always
staler answer to a question the update client already asks correctly. What is
baked is the *configuration for asking* — where, which channel, under what
policy, against which root — and nothing that the server is authoritative for.

**The same-origin rule, made concrete.** Credentials configured for the update
source are attached only to hosts same-origin with `update.source` as baked,
plus the explicit `http.credentialHosts` list. Because both live in a committed
file, the origin a credential is scoped to is **reviewable in a diff** — which
is one thing this seam gives that an operator-edited file does not.

**`meta/ca/`** holds the public trust anchors the image bakes. In this design
that is exactly one file, `meta/ca/root.json`, the pinned TUF root — a public,
self-signed, rotatable document. M3 is why it holds no certificate.

### 3. Where it lands in the image

```
meta/                 →  /usr/share/mos/meta/            verbatim, 0644, root:root
meta/manifest.json    →  /usr/share/mos/meta/manifest.json
meta/ca/root.json     →  /usr/share/mos/meta/ca/root.json
```

**Inside the read-only dm-verity root**, which is the point: the configuration
is covered by the same signature and the same block-level integrity as the code
that reads it. There is no state here that a device knows and the build does
not.

**`/usr/share/mos/`, and not `/etc/`.** `/usr/share/mos/` already holds exactly
this kind of thing — `manifest.tsv` and `release-identity.env` are build facts
that mosd and `rauc-update` read and nothing on the device writes. `/etc/` is
where an operator reasonably expects to be able to edit a file; putting an
unwritable configuration document there would invite an edit that silently does
nothing, and `/etc/rauc/keyring.pem` is in `/etc` only because RAUC's own
configuration names that path.

**Verbatim, and not mapped file-by-file to the paths readers expect today.**
A verbatim copy makes one gate possible that a scatter does not: a verifier
check, `packed-meta-from-repo`, in `packed-keyring-from-ca`'s exact shape,
asserting the packed `/usr/share/mos/meta/` tree is byte-equal to `meta/` file
for file — no extra file, no missing file, no differing byte. It carries the
same vacuity guard, and for the same reason: a `meta/` that does not exist in
the tree is a **throw**, not a pass, because "there is nothing to compare
against" is a statement about the run and answering `pass` would make every
image green on a host that never built one.

**The consequence, taken deliberately:** `rauc-update`'s default anchor path
moves from `/usr/share/mos/uptane/root.json` to
`/usr/share/mos/meta/ca/root.json`. That path is `[not implemented]` today —
no shipped mechanism delivers a root to either location — so nothing is broken
by moving it, and the alternative (bake to `meta/` *and* copy to the old path)
would put the same anchor in two places, which is two truths and one of them
eventually stale.

### 4. What survives what — the root's answer, and no new row

The record is part of the root filesystem, so its survival profile is the root
filesystem's, exactly:

- **Every A/B update replaces it.** RAUC writes the inactive slot, which
  carries its own `/usr/share/mos/meta/`. Configuration and code move together,
  atomically, under one signature.
- **A slot rollback restores it**, along with everything else in that slot — a
  device that falls back to the previous system falls back to the previous
  system's update configuration too. That is the correct behaviour and worth
  naming because it is easy to assume otherwise: there is no configuration that
  survives a rollback and no configuration that a rollback can strand.
- **All three implemented reset tiers leave it untouched**, because a reset
  never rewrites the root.
- **A whole-disk reflash replaces it** — with the new image's, which *is* the
  configuration. There is nothing to re-apply and no procedure to write. The
  old draft needed a whole section for this row.

**In `docs/design/recovery.md` §2.1's terms: this plan adds no row and no
column.** The table's rows are the four tiers and its columns are the stores;
the baked configuration lives inside `system slot A` and `system slot B` and
its cells *are* those columns' cells — `unaffected` for tiers 1, 2 and 3 (per
that table's `[^slots]` footnote, and because `reset.rs`'s `Roots` type has no
member for a slot, which is a property of the type rather than a claim about
the code), `cleared` for tier 4. Inventing a "baked configuration" column would
state something the slot columns already state, and a table with two columns
that must agree is a table that will one day disagree.

The one sentence §2.1 gains is a clarifying note, not a new claim: the slot
columns cover the update configuration and the trust anchors, because those are
files in the root filesystem.

### 5. The cost: configuration is per-build

Stated plainly and up front, because it is the price of everything §4 makes
easy.

**Changing the update server, the channel default, or a trust anchor requires
shipping a new image.** There is no smaller unit of change. Four consequences
follow, and none of them is hypothetical:

1. **One build serves one fleet.** A deployment that must point at a different
   server needs its own image, which means its own signing run, its own
   verification run and its own release artifacts.
2. **It is a release-identity problem, not only a build problem.** Two images
   differing only in `meta/` report the same `BOARD`, `PROFILE` and `VERSION`
   from `release-identity.env`, and `rauc-update` selects on exactly board,
   profile, channel and version. Two fleets whose devices claim identical
   release identity are two fleets the update mechanism cannot tell apart. So
   **a per-deployment `meta/` implies a per-deployment `PROFILE`** — that is
   the field with the right shape, and it is a decision the release process has
   to make consciously rather than discover when the first second customer
   appears (open question 1).
3. **`meta/` is committed, so a per-customer endpoint is a fact in the
   repository.** Every server URL that ships is a URL anyone with repository
   access can read, permanently. That is acceptable for a vendor endpoint and
   it is a disclosure decision for a customer one.
4. **The chicken-and-egg case.** The server that must deliver the new image is
   the one being changed. A device pointed at a server that has moved cannot be
   told the new address over the channel that is dead.

**The escapes, so that baked defaults read as overridable rather than
absolute.** They are what make consequence 4 survivable:

- **The operator-editable policy file on STATE.** `update-policy.toml` is
  PLAN-071's, it already exists, and it **outranks the baked values on every
  key it names — including the server URL**. An operator whose vendor server
  moved edits one file on the device; no reflash, no new image. §5.1 is the
  precedence rule in full.
- **Offline `rauc-update import`.** A bundle on removable media, verified
  against the baked keyring and the pinned root, with no server at all. This is
  the answer for a device whose operator can reach it physically but whose
  server is gone, and it is shipped today.

**What neither escape covers, said rather than left to be found.** A device
with no operator *and* no physical access, whose server has gone away, is
stranded. That is the true residue of a baked configuration, it is not fixable
by anything short of a channel this product deliberately does not have, and it
is the reason §5.1's precedence puts the STATE file on top rather than treating
the baked values as authoritative.

#### 5.1 Precedence: configuration is overridable, trust is baked

Per key, and the file on STATE wins:

- `update-policy.toml` names a key → that value.
- It does not name it, or does not exist → the baked `meta/manifest.json`
  value.
- Neither → the code default, **except `update.source`, which has none.**
  Absent in both means no online source: check and fetch refuse with today's
  reason, and the offline import path remains (§7).
- `update-policy.toml` exists and **does not parse** → today's fail-closed
  behaviour, unchanged: every restricted action refuses while the reboot gate
  keeps evaluating. It does **not** fall back to the baked values. A parse
  error is not absence, and silently reverting to the baked server on a typo
  would move a device back to the server its operator was in the middle of
  moving it off.
- The baked document cannot fail this way at all: it is validated at build time
  and a malformed one fails the build. Three of the old draft's four runtime
  failure states cease to exist, and the fourth — "the configuration names no
  server" — is a supported steady state rather than an error.
- **Trust anchors have no runtime override.** `meta/ca/root.json` and
  `/etc/rauc/keyring.pem` are read, never written, and no key in
  `update-policy.toml` names either. Changing an anchor is an image change,
  full stop; recovering from a compromised one is a reflash, which is what it
  is today.

That line — **configuration is overridable, trust is baked** — is the spine of
this design, and it is the answer to "does baking take control away from the
operator": it takes it away for exactly the things that must not be rewritable
on a running device, and for nothing else.

### 6. The layering question, re-answered for two build-time inputs

With `ca/` and `meta/` both at build time, **neither union nor precedence is a
runtime rule any more.** The build resolves both, and what ships is a single
byte-fixed set of files the verifier holds to exactly. The analysis that
survives from the old draft is the part about the two *mechanisms*, and it now
points somewhere simpler.

**The RAUC keyring: one input, and `ca/` wins.** `meta/ca` and `ca/` would
produce the same keyring, so they are **one input, not two**, and M3 enforces
it. Three reasons, in order of weight:

1. `rootfs/build.sh` already refuses a second source for the keyring,
   unconditionally, with a stated reason — that a trust root arriving from a
   place nobody is watching arrives *by being forgotten*. Making `meta/ca` a
   second source contradicts a rule that is in the build today and cannot be
   waived without deleting it.
2. **The union is real but needs no second directory.** A keyring is an
   OpenSSL CA file: concatenated PEMs, every one trusted, which is exactly what
   `docs/design/release-signing.md` §2.4's rollover already is and what
   `tests/rauc-trust-negative-test.sh` already proves the properties of. An
   operator who wants a two-CA image concatenates the second certificate **in
   `ca/`**, where the rollover procedure already puts it. The capability exists;
   a second input adds nothing but a second place to look.
3. `packed-keyring-from-ca` therefore stays **byte-for-byte unchanged**. That
   is the strongest available evidence that this plan added no second RAUC
   trust surface: not an argument that it did not, but a gate that would fail
   if it had.

**The TUF root: one place, so precedence has nothing to arbitrate.** A TUF
repository has exactly one root, which is why a union is meaningless for it —
two pinned roots are two repositories. Under the old design that forced a
precedence rule between a device record and an image fallback. Under this one
there is exactly one source, `meta/ca/root.json`, so the rule is trivially
satisfied and the fallback disappears; `trust.tufRoot` names a file *inside*
`meta/`, and naming a path outside it is a build error.

**The tradeoff that comes with picking the image-baked candidate**, which
`pkgs/rauc-sign/README.md` already states and which this plan accepts rather
than restates as new: the root is exactly as trustworthy as the image carrying
it, so first trust and re-anchoring both ride the RAUC channel, and **the TUF
hierarchy cannot outlive a compromise of the image signing path — the two
hierarchies stand or fall together.** What is bought is that the root does not
have to be replaced to follow a rotation; a pinned device walks the
cross-signed root chain forward on its own, so an image update is needed only
to re-anchor a device whose chain is broken.

**What this does not close.** The two cases `docs/design/release-signing.md`
§2.3 names as uncovered by an image-carried keyring stay uncovered: a device
that missed a CA rollover's overlap window, and rotation away from a CA that is
already compromised. Both still need a reflash. The old draft claimed to close
the first, using the device-time channel that this revision removes; the honest
statement now is that it does not, and open question 2 is where a later channel
would land.

### 7. No default server, and the check that holds it

**There is no built-in vendor URL anywhere in the tree and this plan adds
none.** `meta/manifest.json` as committed sets `update.source` to `null` and
`fleet.url` to `null`, so a build from a clean checkout produces a device that
checks nothing until somebody either edits `meta/` for a product build or
writes the policy file on the device. A device whose `meta/` names no server
**refuses to check** and says so, rather than falling back to a vendor host.

That rule is mechanical rather than promised: a verifier check over the
assembled image fails any build in which the update client, mosd or the
`meta/` reader carries a **compiled-in scheme-and-host default** for an update
or fleet endpoint. Baking `meta/` makes that check *more* necessary, not less —
there is now a legitimate place for a URL in the image, and a compiled-in
fallback beside it would be an easy and invisible addition. The check
distinguishes data from code: `/usr/share/mos/meta/` may name a host, and no
binary may.

The absent case remains a supported steady state: the device boots,
self-provisions, derives its hostname from its identity, and is fully
manageable over apid on the LAN. Update source: none, so check and fetch refuse
with the reason they refuse with today, and the offline lockbox import path
remains. Fleet: off.

**A server that does not answer** is the existing behaviour and no new one: the
lifecycle records `failed` with the client's stderr tail, the next scheduled
check retries, the bounded subprocess timeouts apply. Stated as the autonomy
claim `docs/design/security-model.md` requires: **no operation on this device
requires the update server or the fleet plane to answer**, and nothing degrades
as a function of time since last contact.

### 8. Reading it back

`GET /api/v1/provisioning/status` gains the baked configuration as read —
the schema tag, the product labels, the update source and channel, the policy
default, the fleet switch, and the sha256 of each file under
`/usr/share/mos/meta/`. It returns the whole document because §1 established
that nothing in it is secret; the redactor still covers the settings subtrees
beside it.

The digests carry most of the value. An operator debugging *why will this
device not update* needs to know which anchor it pinned and which configuration
it was built with, and a digest answers both without shipping a certificate
through an API. Because the digests are over files inside the verity root, they
are also the cheapest available cross-check that the image is the one the
release claims.

Two facts should read side by side wherever this surfaces: the **baked** value
and the **effective** one after §5.1's precedence. An operator looking at a
device that is checking a server they do not recognise needs to see, in one
place, that the policy file is overriding what was built in.

### 9. Open questions — decisions with costs, not guesses

1. **Does a per-deployment `meta/` get a per-deployment `PROFILE`?** (§5,
   consequence 2.) It is the field with the right shape and `rauc-update`
   already selects on it, but it makes the profile namespace a customer list
   and profiles appear in release artifacts. The alternative — encoding the
   deployment in `VERSION` — pollutes the version ordering the rollback guard
   depends on. **Recommended: `PROFILE`**, decided before the second
   deployment exists rather than after.
2. **Is a device-time trust channel still wanted, later?** This plan removes
   the one the old draft designed, and with it the coverage of
   `docs/design/release-signing.md` §2.3's missed-overlap case (§6). A signed
   USB import with the TUF chain rule is the natural shape and is
   `pkgs/rauc-sign/README.md`'s third candidate; it is strictly better
   authorisation than the physical-possession rule the old draft used, and it
   is now a *second* channel added to a pinned root rather than the way first
   trust arrives. Not designed here, and named so that removing the old
   mechanism does not look like removing the requirement.
3. **Does `meta/` carry anything a device could not compute?** Today it carries
   configuration and one anchor. The pressure to add per-device values will
   come from manufacturing (`docs/design/manufacturing.md` §3 wants a serial in
   a per-device record) and from zero-touch enrolment (PLAN-054 question 6).
   Both are structurally excluded by baking, and the answer must stay no; the
   question is recorded so that the next person who wants it finds the argument
   instead of the directory.

## Risks

- **A configuration change now costs a release.** This is the design, not a
  defect, and the risk is that it is discovered at the wrong moment — the first
  time a customer's server moves. §5 exists so that it is priced in the record;
  the mitigation that actually works is §5.1's precedence, which lets an
  operator override every configuration key on the device without one.
- **`meta/` looks editable and is not.** It is a JSON file in a directory, in
  an image, on a read-only verity root. Somebody will edit
  `/usr/share/mos/meta/manifest.json` on a running device, or try to, and
  nothing will happen — or worse, they will remount and break verity. The read
  surface of §8 showing baked-versus-effective side by side is what points them
  at the policy file instead.
- **The `meta/` versus META-partition name collision.** Two things named the
  same, one in the repository and one on the device, with adjacent subject
  matter. A reader who knows the partition table will assume the wrong one.
  Mitigated only by saying so, in this record and in the design docs the
  backlog updates.
- **M1–M3 catch the accident and not the adversary.** §1.1 states the limit;
  the risk is that their existence creates a false sense that `meta/` is
  *verified* clean rather than *reviewed* clean. The review is the control.
- **Moving `rauc-update`'s default anchor path.** It is unimplemented today, so
  the move is free — but it is exactly the kind of change that is free until
  something outside this tree has already hard-coded the old path. Worth one
  grep at implementation time rather than an assumption now.
- **Baking the TUF root ties the two hierarchies together** (§6). A compromise
  of the image signing path compromises the anchor for the TUF path as well.
  This is the accepted cost of the candidate chosen, it is the one
  `pkgs/rauc-sign/README.md` names, and open question 2 is where the mitigation
  would go.

## Scope

In scope: the `meta/` directory's contents and boundary against `ca/`; the
build-time refusals that hold it; `meta/manifest.json`'s schema and its mapping
from lode's `lode.toml`; the image path and the byte-equality gate; the
precedence rule between baked defaults and the STATE policy file; the trust
layering between `ca/` and `meta/ca/`; the no-default-server rule and its
verifier check; the read surface.

Out of scope: the update policy semantics (PLAN-071); anything the fleet switch
turns on (PLAN-072); the per-device manufacturing record
(`docs/design/manufacturing.md` stays `[proposed]`); a device-time trust
channel (open question 2); the META partition, which this plan does not touch.

### Implementation backlog — estimated separately from approval

Sized in slices, each independently verifiable. No slice is authorised by
approving this plan; each becomes a task record when it is scheduled.

| # | Slice | Size | Gate |
|---|---|---|---|
| F1 | `meta/` in the repository with its committed default document, and `meta/manifest.json`'s schema | S | the committed default names no server |
| F2 | Build-time refusals M1–M3 in `rootfs/build.sh` | S | one fixture per rule turns the build red, and the tree as committed stays green |
| F3 | Staging `meta/` verbatim into `/usr/share/mos/meta/` | S | — |
| F4 | Verifier check `packed-meta-from-repo`, byte-equal file for file, with the throw-on-absent vacuity guard | S | an image with an added, removed or altered file under the path fails; a tree with no `meta/` throws rather than passing |
| F5 | The reader in mosd: parse, validate, `deny_unknown_fields`, expose as live state | M | unknown key is a build error, not a runtime one; the reader always answers with a document |
| F6 | §5.1 precedence in `update_policy.rs`: per-key override, and the parse-error rule that does **not** fall back | M | a policy file that fails to parse refuses actions and does not silently adopt the baked server |
| F7 | `rauc-update` reads `trust.tufRoot` and its default anchor path moves | S | a `tufRoot` naming a path outside `meta/` is a build error |
| F8 | No-compiled-in-endpoint verifier check | S | fails a build with a planted default URL in a binary; passes with one in `meta/` |
| F9 | `GET /api/v1/provisioning/status` extension: the document, the digests, and baked-versus-effective | S | — |
| F10 | Design-doc updates: `recovery.md` §2.1's clarifying note, `release-signing.md` §2.3 and §2.5, `updates.md` §7, `provisioning.md` §4, `manufacturing.md` §1, `security-model.md` §3, and `pkgs/rauc-sign/README.md`'s anchor section | M | `make docs-verify` |

F2 and F4 are the pair that make the boundary mechanical; F6 is the slice with
the highest chance of a silent defect, because getting the parse-error case
wrong is invisible until the day it matters.

Compared with the previous draft, F1–F10 replace a backlog whose largest and
riskiest item was a two-target atomic commit across META and STATE. That item
does not exist here.

## Approval boundary

**This plan ends at an approved seam.** What approval means, exactly:

- `meta/` is a committed, fleet-identical, secret-free build-time input beside
  `ca/`, baked verbatim into the read-only root at `/usr/share/mos/meta/`;
- the RAUC keyring has exactly one source and it stays `ca/`; the TUF root has
  exactly one source and it is `meta/ca/root.json`;
- configuration is overridable at runtime by the STATE policy file, per key,
  with the parse-error rule of §5.1; trust anchors are not overridable at all;
- absence of a server is a supported steady state and there is no default
  server;
- open questions 1–3 are answered before the slices that depend on them
  (question 1 blocks the second deployment, not a slice; nothing else blocks).

Approval does **not** authorise writing any of the backlog above. Each slice
takes a task record and its own proposal.

## Alternatives

1. **A device-side record on the META partition, provisioned through
   `mos-provisioning.toml`.** The previous draft of this record. Rejected: it
   is not what was asked for, and re-reading it against this design it also
   costs more for less — a second commit target in shipped provisioning code, a
   split authorisation rule, a keyring bind mount, four runtime failure states
   and a re-apply procedure after every reflash, in exchange for the ability to
   change configuration without a release. §5's precedence rule buys most of
   that ability back at no cost.
2. **Let `meta/ca` add RAUC CA certificates to the keyring** — the build
   composes `concat(ca/ca.cert.pem, meta/ca/*.pem)` and
   `packed-keyring-from-ca` asserts the composed result. Genuinely close, and
   named because it has a real argument: a committed CA certificate is a trust
   anchor that appears in a diff, which is a better review property than
   `ca/`'s out-of-band material. Rejected for §6's first reason — it
   contradicts a refusal that is in `rootfs/build.sh` today — and because the
   union it enables is already available inside `ca/`, where §2.4's rollover
   puts it. Re-openable, at the cost of deleting M3 deliberately.
3. **Put the configuration in `ca/`.** Rejected, and this is the correction the
   previous draft made that still stands: `ca/` is gitignored private key
   material, and configuration in it would be configuration nobody can review
   and that CI must supply out of band.
4. **Keep the TUF anchor unprovisioned and ship only the update
   configuration.** The smallest possible version of this plan. Rejected: it
   leaves `docs/design/updates.md` §7's owed item owed and leaves
   `rauc-update`'s verifier a tool a person points at a `--root` they brought
   themselves, which is the current state stated honestly and is not a shipped
   update path.
5. **Put the update configuration in the settings tree instead.** Rejected for
   `docs/design/updates.md` §2's unchanged reason — a settings key means a
   schema bump plus a migration, and a concurrent workstream owns the next bump
   — and for a second reason this seam adds: a settings key is per-device
   mutable state, and the trust half of `meta/` must not be.
6. **A single plan covering `meta/`, the update module and the fleet plane.**
   Rejected; the argument is in PLAN-072's *Why three plans and not one* and is
   not duplicated here.

## Annotations

- 2026-09-03: Created as the first of three records answering the user's
  request for an update-configuration seam, an update module and a cloud
  registration capability.
- 2026-09-03: The request as first phrased asked for "the remote server
  configured in `ca/`". The correction that `ca/` holds trust material only,
  and is not extended by this plan, stands and is Alternative 3.
- 2026-09-03: **Rewritten.** The previous draft designed a device-side factory
  record on the META partition, carried by an extended `mos-provisioning.toml`.
  That was the wrong seam: what was asked for is a `meta/` directory in this
  repository that the build bakes into the image. This revision replaces the
  storage tier, the transport, the authorisation model and the trust layering;
  it keeps the `ca/`-is-not-configuration correction, the no-default-server rule
  and its verifier check, and the analysis of why a keyring unions and a TUF
  root does not. The META partition is no longer touched by this plan. The
  record's title changed with it; `docs/plan/index.md`'s row is owed the same
  change and is deliberately not edited here.
