# PLAN-070 Design the meta/ seam: signing material on the build host, a public subset baked into the image

- **status**: draft
- **createdAt**: 2026-09-03 11:11
- **approvedAt**: (pending)
- **relatedTask**: (none — design only; task records are owed on approval)

## Context

### The correction this revision has to make first

Two revisions precede this one. The first replaced a device-side factory record
on the META partition with a **`meta/` directory in this repository** that the
build bakes into the image. The second made the channel operator-selectable and
moved the operator document to DATA (§5.1). Both stand; the document's path
has since been settled as `/mos/config/updates.json`, in a namespace §5.2
establishes for every later subsystem.

**This revision answers the concrete layout the user has now given**, and that
layout invalidates two load-bearing decisions the first revision made:

```text
meta/rauc/                    the RAUC key
meta/updates/manifest.json    update configuration: server info, and the signing PUBLIC key
meta/updates/root.key         the update signing PRIVATE key, used locally to sign update bundles
```

The user has since settled what each of those keys *is*, and it is a split by
**object** rather than by hierarchy: `meta/rauc/` carries the RAUC CA and
signer, which gate the **A/B system image**; `meta/updates/root.key` is lode's
key over the update **package**, which guarantees a downloaded package has not
been tampered with. §6.2 works the custody table around that split, and §6.2 is
also where an earlier reading of this record — that `root.key` is the TUF
root-role key — is retired rather than defended.

`meta/` is now the single directory carrying **configuration and signing
material together**. Two consequences follow immediately, and the second is why
this revision exists:

1. **`meta/` cannot be committed.** It holds private keys. It becomes what
   `ca/` is today — gitignored, generated when absent, never in history. The
   rules M1 (every file tracked) and M2 (no private-key armour, scoped to the
   directory) are **deleted**, not weakened: a rule saying every file under
   `meta/` is tracked cannot survive a directory whose whole point includes an
   untracked key. §1.2 says what replaces them.
2. **Baking `meta/` verbatim would ship the fleet its own signing keys.** §1.1
   states that hazard in one sentence and designs against it. Everything else
   in this revision is consequence.

What is *not* re-opened: the seam is still a **build-time input directory in
this repository**, not a partition, not a provisioning payload and not
something a device is handed after it is built. The META partition is still
untouched. The three-layer precedence rule of §5.1, the operator document on
DATA, the reset consequence of §4.1 and the no-default-server rule of §7 are
unchanged, and are re-stated below only where the layout makes a sentence
false.

### `meta/` is not the META partition

The repository directory `meta/` and the on-device **META partition** mounted
at `/mnt/meta` are unrelated, and the name collision is real enough to trip a
reader who knows the partition table. This record uses `meta/` for the
repository directory only. **No part of this plan writes to, reads from, or
changes the meaning of the META partition**, which continues to hold RAUC's
`rauc.status` and nothing else. The old draft's entire content lived there; this
one does not touch it.

### What the tree already has

- **A gitignored directory of signing material, generated when absent, of
  which exactly one public file reaches the image.** `ca/` holds
  `ca.cert.pem`, `ca.key.pem`, `signer.cert.pem` and `signer.key.pem`;
  `rootfs/build.sh` runs `pkgs/rauc/gen-dev-keys.sh --if-absent`, which
  generates a development-grade root, prints a loud non-fatal notice and drops
  `ca/GENERATED` — a marker that keeps the material flagged development-grade
  **forever after**, not only in the run that made it, with production material
  placed there *without* it. The build then copies `ca/ca.cert.pem` alone to
  `/etc/rauc/keyring.pem`; the three private-or-host-only files stay on the
  build host. **Selective baking is therefore not a new idea in this tree — it
  is what `ca/` already does**, and §1 keeps that property while the directory
  grows. Two verifier checks hold the path from both ends: `rauc-keyring-path`
  (`verify/src/checks-rauc.ts`) asserts the rendered `system.conf` names
  exactly one keyring path, and `packed-keyring-from-ca`
  (`verify/src/checks-root.ts`) asserts the shipped keyring is **byte-equal**
  to `ca/ca.cert.pem` and **throws** rather than passing when there is nothing
  to compare against.
- **A build that already refuses a second source for a trust root.**
  `rootfs/build.sh` rejects an `etc/rauc/keyring.pem` found in the overlay,
  unconditionally and unwaivably, because the overlay is copied wholesale into
  every image and a file left there is a CA that arrives *by being forgotten*.
  That refusal is the shape §1 copies, and §6 is the reason it must not be
  contradicted.
- **The release-side signing tooling writes ed25519 keys as raw PKCS#8.**
  `rauc-sign gen-dev-keys` produces `<name>.pk8` files, mode 0600
  (`docs/design/release-signing.md` §1.2). **These files are binary DER, not
  PEM** — which is why the first revision's M2, a grep for PEM private-key
  armour, would have been blind to a package-signing key held in that format,
  and why §1.1's detector has three tests rather than one. What that tooling's
  role hierarchy has to do with `meta/updates/root.key` is settled in §6.2 and
  is narrower than an earlier revision of this record assumed.
- **A production runbook that already says the private half stays away.**
  `docs/design/release-signing.md` §2.5 provisions a build host with
  `ca.cert.pem`, `signer.cert.pem` and `signer.key.pem` and states plainly that
  `ca/ca.key.pem` does **not** exist there. §6 generalises that rule to the TUF
  root key.
- **Trust, unprovisioned.** The TUF pinned root. `pkgs/rauc-sign` builds and
  verifies the four-role repository and `rauc-update` walks it, but **no
  shipped mechanism puts `root.json` on a device.**
  `pkgs/rauc-sign/README.md` records three candidates and picks none;
  `docs/design/updates.md` §7 lists the anchor among the deployment contract
  still owed. **This plan picks the first candidate** — image-baked — and §6
  states the tradeoff the README already names for it. There is also no home in
  the tree for the TUF *keys*: the RAUC half of the signing material lives in
  `ca/`, the TUF half lives nowhere.
- **A build-fact directory in the image.** `/usr/share/mos/` holds
  `manifest.tsv` (the bill of materials the SBOM derives from) and
  `release-identity.env` (`BOARD`, `PROFILE`, `VERSION`, `COMMIT_DATE`,
  written at compose time). Both are facts *about the build*, read by mosd and
  by `rauc-update`, inside the read-only root. §3 is why `meta/` belongs
  beside them.
- **Update configuration on STATE.** `update-policy.toml`, read fresh on every
  decision by `pkgs/mosd/mosd/src/update_policy.rs`, carrying `source.*`,
  `network`, `autoCheck`, `maintenance.windows` and `rebootGate`. `source.url`
  has **no default** — an unset URL means no online source, and the offline
  import path remains. That absence is load-bearing and this plan preserves it.
  `docs/design/updates.md` §2 argues for STATE explicitly, on PLAN-061's rule
  that small authoritative metadata stays on STATE and only large bytes go to
  `/mos`. §5.1 moves the document anyway, and prices that contradiction rather
  than stepping around it.
- **A `/mos` layout created by name, and a reset rule that clears by
  allowlist.** `mos-data-layout` creates `ui`, `containers`, `home`, `root`,
  `apps` and `updates/{downloads,verified,staging}` (PLAN-063), each at a
  declared mode; a new subtree is one more entry. `docs/design/recovery.md`
  §2.1's `[^apps-mos]` says tier 2 clears the application-owned subtrees
  (`apps/`, `containers/`) and opens nothing else — so a new subtree is
  preserved by tier 2 **by default**, which §4.1 turns into a decision rather
  than leaving as an accident.
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

### 1. `meta/` on the build host: what reaches the image, and what never leaves

`meta/` is a **build-host** directory, gitignored, holding everything needed to
configure and sign a release:

```text
meta/rauc/ca.cert.pem            RAUC CA certificate            PUBLIC  -> image
meta/rauc/ca.key.pem             RAUC CA private key            SECRET  -> never
meta/rauc/signer.cert.pem        bundle signer certificate      public  -> host only
meta/rauc/signer.key.pem         bundle signer private key      SECRET  -> never
meta/updates/manifest.json       update configuration           PUBLIC  -> image
meta/updates/root.key            package signing private key    SECRET  -> never
meta/GENERATED                   development-grade marker       host only
```

Five files and one marker — the user's three lines, expanded only where an
X.509 pair is four files rather than one. `ca/` is absorbed into `meta/rauc/`
rather than kept beside it; §6.1 is the decision and prices the alternative.
The three private keys sit in **two domains with two different blast radii**,
and §6.2 is where they are told apart.

**What must never appear in the *baked* set**, which is where the previous
revision's prohibitions survive and where they now bite:

1. **No private key of any kind** — not a CA key, not a signer key, not a role
   key, not a TLS client key. Private keys are `meta/`'s purpose; the rule is
   that none of them ship, and §1.1 is the mechanism.
2. **No per-device value** — not a serial, not a MAC, not a device id, not a
   claim code. Every device flashed from one image carries a byte-identical
   baked set, so a per-device value in it is a per-device value that is the same
   on every device, which is a defect with no correct reading. PLAN-072 §2
   relies on this to exclude enrolment shape (b) structurally rather than by
   argument.
3. **No secret of any kind** — no bearer token, no PSK, no password, no
   registration key. `manifest.json` is baked, so a token pasted into it ships
   to every device. §4's schema has no field for one, and §1.2 says why no
   check is proposed for it.

#### 1.1 The hazard, the allowlist, and the two checks that hold it

**If `meta/` were baked verbatim — which is what the first revision specified —
every shipped device would carry `meta/rauc/ca.key.pem` and
`meta/updates/root.key`, the private keys behind both gates its updates pass,
so anyone who obtained one device could extract them and sign an update that
every other device in the fleet verifies, installs and trusts.**

That is fleet-wide remote code execution reachable by buying one unit. It is
not a consequence of a careless implementation; it is the direct reading of
"bake `meta/` into the image" applied to the layout as given. Hence:

**The public set — the only files that reach the image:**

| File in `meta/` | Path in the image | What it is |
|---|---|---|
| `meta/rauc/ca.cert.pem` | `/etc/rauc/keyring.pem` | the RAUC keyring: the CA certificate devices verify bundle CMS signatures against. Unchanged from today, including the path, which RAUC's own `system.conf` names |
| `meta/updates/manifest.json` | `/usr/share/mos/meta/updates/manifest.json` | the §2 configuration, carrying the **public half** of `root.key` inline (§2.1) and by schema no secret |

**The build-host-only set — everything else, and it never leaves:**
`ca.key.pem`, `signer.key.pem`, `signer.cert.pem`, `root.key`, `GENERATED`,
and **any file not named above**.

**Two files, not three.** An earlier revision baked a third, a pinned TUF root
document. §2.1 and §6.2 are why it is gone: the package-trust anchor is now the
public key carried inside the manifest, so there is no separate document to
ship. If the release-side mechanism turns out to need one (open question 6),
the allowlist gains one reviewed line — which is the behaviour an allowlist
exists to produce.

**Allowlist, not denylist, and this is the whole mechanism.** The staging step
enumerates the public files by name and copies those. A denylist would
pattern-match the secrets and copy the rest, which means a file nobody
anticipated ships **by default** — and the default is what decides the outcome
on the day somebody adds `meta/updates/notes-for-the-release-host.txt`. Under
an allowlist a new file is invisible to the image until somebody adds a line to
the allowlist, in a diff, with a reviewer.

`signer.cert.pem` is public and still does not ship: the device never needs it,
because RAUC takes the signer certificate from the bundle's own CMS structure
and chains it to the keyring. A file that ships for no reason is a file whose
removal nobody can later justify.

**Two checks, in two places, for two different questions.** One is not enough,
and the reason is not belt-and-braces — they fail on different days:

- **B1 — the build refuses to stage a secret. Proves the *intent*.** In
  `rootfs/build.sh`, in the shape its overlay-keyring refusal already uses: a
  hard `error:` naming the offending file, a paragraph saying why the rule
  exists, `exit 1`, and **no waiver flag**, for build.sh's own stated reason
  that a waiver reintroduces the thing the rule exists to forbid. It fires when
  a staged path is not on the allowlist above, and independently when any file
  about to be staged carries private key material.
- **B2 — the verifier refuses an image that contains one. Proves the
  *outcome*.** Over the packed root, in `packed-keyring-from-ca`'s exact shape
  including its throw-on-nothing-to-compare guard. B1 cannot see material that
  arrives by a route other than staging — an overlay file, a package
  `postinst`, a stray `cp` in a future slice. B2 does not care how it got
  there.

**What "carries private key material" means, spelled out, because the obvious
spelling is wrong here.** The previous revision's M2 grepped for PEM
private-key armour. The TUF role keys are **raw PKCS#8 DER**, so an armour grep
is blind to `root.key` — the one file the hazard is named after. The detector
is three tests, any of which is a refusal:

1. PEM private-key armour: `BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`,
   `BEGIN EC PRIVATE KEY`, `BEGIN ENCRYPTED PRIVATE KEY`,
   `BEGIN OPENSSH PRIVATE KEY`.
2. A DER PKCS#8 `PrivateKeyInfo` header, which is what `rauc-sign gen-dev-keys`
   writes.
3. A filename in a key-container extension: `.key`, `.pk8`, `.p12`, `.pfx`,
   `.jks`.

**B2's scope is the paths this seam creates** — `/usr/share/mos/meta/` and
`/etc/rauc/` — and not the whole packed root. A whole-root scan would fire on
Debian packages that legitimately ship key-shaped test fixtures, and a check
whose findings are usually false is a check people learn to pass. The seam's
own paths are mos-owned, closed, and always populated (a keyring, a root
document, a manifest), so "scanned N files, found no private material" is a
real measurement rather than a vacuous one. B2 is two verdicts:

- **`packed-meta-is-the-public-set`** — `/usr/share/mos/meta/` contains exactly
  the allowlisted files, each byte-equal to its source in `meta/`: no extra
  file, no missing file, no differing byte. **Throws** when the tree has no
  `meta/` to compare against, for `packed-keyring-from-ca`'s recorded reason —
  answering `pass` would make every image green on a host that never built one.
- **`no-private-key-in-baked-meta`** — the three detectors over those two
  paths, reporting the file count it scanned, so an empty search space is
  visible in the verdict rather than hidden behind a green tick.

`packed-keyring-from-ca` keeps its contract and changes only the directory it
reads; it becomes `packed-keyring-from-meta` (§6).

#### 1.2 `meta/` is gitignored, generated when absent, documented by `meta.example/`

**Gitignored.** `.gitignore` gains `/meta/` with the paragraph `/ca/` carries
today — a committed signing key would make every device trust anything anyone
builds. **The `/ca/` entry stays as a tombstone**, exactly as the file already
keeps `pkgs/rauc/.devkeys/` after that location was retired: a stale `ca/` on a
developer's machine still holds a private CA key, and the entry is what stops
it being committed by an absent-minded `git add -A` after §6's move.

**Generated when absent, by the mechanism that already does it.**
`pkgs/rauc/gen-dev-keys.sh` is extended rather than duplicated: same
`--if-absent` entry point `rootfs/build.sh` already calls on every build, same
loud non-fatal notice, same rule that the build carries on with
development-grade material rather than refusing. It gains a `--domain`
argument:

- **`--domain rauc`** (default, and what `--if-absent` runs): generates
  `meta/rauc/` with openssl, exactly as it generates `ca/` today. The build
  cannot proceed without a keyring, so this half stays build-blocking and
  automatic.
- **`--domain updates`**: generates a development `meta/updates/root.key` and
  writes its public half into `meta/updates/manifest.json`'s
  `trust.signingKeys`. **Not automatic**, for a reason worth stating rather
  than discovering: a development package-signing key that no published
  repository has signed anything with is a key that anchors nothing, and
  generating it by default would make every fresh build claim a trust
  relationship it does not have. **An empty `trust.signingKeys` is a supported
  steady state** — the same steady state as an absent `update.source` (§7),
  and consistent with it, since a device configured to reach no server has no
  package to verify. The build says so in one line and continues: *no package
  signing key baked; this image can verify no update package until
  `trust.signingKeys` is populated*.

**One marker, and it names what it covers.** `meta/GENERATED` replaces
`ca/GENERATED` and keeps its whole contract: it marks material
development-grade **forever after**; nothing but the generator writes it;
production material is placed without it. What changes is that it now **lists
the domains it generated**, because the mixed tree is a real case — a
production RAUC ceremony's output copied in while the TUF root is still
development-grade. `complete()` becomes per-domain, the build's warning names
which domains are development-grade, and the keyring check reads the marker for
the same verdict wording it prints today.

**`meta.example/` is what a reader learns the format from.** Committed,
carrying no key and no server URL:

```text
meta.example/updates/manifest.json    the §4 document, update.source = null
meta.example/README.md                which files are public, which never leave the host
```

It is a **directory the tooling uses**, not prose beside the tooling: the
generator instantiates `meta/updates/manifest.json` from it when `meta/` is
absent, and the schema validator runs over it in CI. An example only humans
read drifts from the schema silently; one that every fresh build instantiates
and every CI run validates cannot. It deliberately contains no `rauc/` and no
key of any shape, not even a placeholder — a file named like a key in a
committed directory is a file somebody eventually fills in.

**What replaces M1, M2 and M3:**

| Rule | Was | Now |
|---|---|---|
| **M1** every file under `meta/` is tracked by git | the mechanical form of "no per-device value" | **Deleted, and inverted.** `meta/` is gitignored. The build refuses if `git ls-files meta/` returns anything, because a tracked file under `meta/` is a signing key on its way into permanent history |
| **M2** no private key material under `meta/` | a directory-scoped grep for PEM armour | **Deleted as written; re-aimed and strengthened.** The prohibition moves to the *staged set* (B1) and the *image* (B2), and gains the two detectors an armour grep misses |
| **M3** no X.509 certificate under `meta/` | kept the RAUC keyring to one source, `ca/` | **Deleted.** `meta/rauc/` is now where that certificate lives. The single-source property M3 protected is preserved by there being exactly one directory (§6), plus the overlay refusal already in the build |

**The limit of all of this, stated rather than glossed.** These checks catch the
realistic accident — a key copied in beside the certificate, a directory staged
wholesale — and they catch it twice. They cannot catch a secret that does not
look like one: a bearer token in `manifest.json` is a JSON string and no
assertion distinguishes it from a URL. No check is proposed for that, because a
token-entropy heuristic over a file full of URLs and hashes would fire mostly
on things that are fine. **And the previous revision's structural defence for
this case is gone**: `meta/` is no longer committed, so a secret in it no
longer appears in a diff. What remains is the release process — the same
out-of-band control that governs `ca/` today — and `meta.example/`, which makes
the intended shape reviewable even though the instance is not.

### 2. `meta/updates/manifest.json`: lode's vocabulary, mos's mechanism

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

  "trust": {
    "signingKeys":   ["<ed25519 public key, base64>"],
    "signingKeyIds": ["<derived by the build: sha256 of those bytes>"]
  },

  "http": { "credentialHosts": [] },

  "fleet": { "enabled": false, "url": null }
}
```

**That is the document `meta.example/` commits**, and `update.source` is `null`
in it deliberately — §7. A product build edits its own gitignored `meta/`; the
tree's example configures no server.

**Three different files in this tree are called a manifest, and a reader will
meet all three.** `/usr/share/mos/manifest.tsv` is the bill of materials the
SBOM derives from; the release `manifest.json` that `rauc-sign add --manifest`
pins as a TUF target beside a bundle is the *gated release description*; and
this one is *local configuration*. The name is kept because it is the user's
layout and lode's, and the disambiguation is stated once here so it does not
have to be re-derived at every mention.

#### 2.1 The public key in the manifest: inline, because there is nothing to point at

The layout says `manifest.json` carries "the signing PUBLIC key", and under the
user's ruling that `root.key` is **lode's key over the update package** the
answer is the plain one: **the manifest carries the public key itself**, in
lode's `trusted_keys` shape.

**This retires the previous revision's answer, which was a pin on a separate
document.** That answer rested on `root.key` being the TUF root-role key, whose
public half is already stated — signed, versioned, threshold-bearing and
expiring — inside a `root.json`; a second inline copy would then have been one
fact stated twice with no rule for a disagreement. Under lode's model **there
is no second statement**: the manifest is the only place the trusted key is
declared, so the objection has nothing to object to and the indirection would
buy nothing. `trust.tufRoot` and `trust.tufRootSha256` are gone with it.

**What survives from that answer, because it was never about the indirection.**
The properties that made the pin right still hold, and they are what the fields
above deliver:

- **Fixed at build, unwritable at runtime.** The key is inside the manifest,
  the manifest is inside the read-only verity root, and no key in the operator
  layer names it (§5.1). Baking is what makes an inline key a pin rather than a
  copy somebody could edit.
- **Independently checkable against the ceremony record.**
  `trust.signingKeyIds` is the sha256 of each key's bytes, **derived by the
  build**, with a hand-written mismatch failing the build. It is the value an
  operator compares against the minutes and the value §8's read surface
  exposes, so nobody has to eyeball base64.

**A list, not a scalar, and the rotation cost stated rather than discovered.**
The previous revision rejected lode's inline `trusted_keys` on the ground that
a bare key list has no rotation rule. That objection is **real and does not go
away** — rotating the package-signing key means a new image, because its public
half is baked. What the list form buys is the same thing concatenation buys the
RAUC keyring in `docs/design/release-signing.md` §2.4: an **overlap window**.
Ship an image trusting both the outgoing and incoming keys, sign with the
incoming one, and devices that took that image follow without a flag day; a
device that missed the window needs a new image, exactly as it does for a CA
rollover. A scalar forecloses that for no saving, so the field is a list from
the first day even though it will hold one key.

`trust.signingKeyIds` is derived and must not be hand-written; `signingKeys` is
the input. Two fields where one would do, because the derived one is the one a
human reads and compares, and deriving it is what stops it becoming a second
truth.

**The mapping**, re-checked against lode's vocabulary now that `root.key` is
lode's rather than TUF's. Two rows changed as a result and are marked; two rows
are mos **extensions** with no lode analogue, which are marked and justified
rather than left to look native.

| lode `lode.toml` | mos `meta/updates/manifest.json` | Verdict |
|---|---|---|
| `[update] manifest = <url>` | `update.source` | **Adopt the role, rename the key.** Both name the one place releases are discovered; lode's is a `lode/v1` JSON feed and mos's is a package repository whose layout is the release side's (open question 6), so the same name would promise a format this key does not fix |
| `[update] channel` | `update.channel` | **Adopt verbatim, as the default.** The operator overrides it at runtime (§5.1); lode's is an operator file to begin with, so this is the same key doing the same job one layer down |
| `[update] policy = off \| check \| auto` | `update.policy` | **Adopt verbatim.** PLAN-071 owns the semantics |
| `[update] check_interval` (seconds) | `update.checkIntervalMinutes` | **Adopt the key, keep mos's unit.** `update-policy.toml` is minutes today, and two units for one quantity is a defect waiting for a reader who does not notice |
| `[update] asset` | — | **No analogue.** mos selects a whole-system bundle by board, profile, channel and a version newer than `release-identity.env`'s; there is no filename to choose |
| `[update] keep_versions`, `pin` | — | **Structurally absent** (PLAN-071 §6): two slots, fixed by the partition table, not by a setting |
| `[trust] trusted_keys` (inline list) | `trust.signingKeys` + derived `trust.signingKeyIds` | **Adopted — changed from the previous revision, which rejected it.** With `root.key` being lode's package key there is no signed root document to point at, so the inline list is the only statement of the trusted key rather than a duplicate of one. The rotation objection stands and is answered by the list form plus an overlap window, not by indirection (§2.1) |
| `[trust] trusted_keys_file` | — | **Not adopted — changed from the previous revision, which adopted it.** A file beside the manifest, inside the same baked directory, covered by the same signature, is indirection with no added rotation semantics. It would be worth having only if the trusted material were a document with its own expiry and threshold, which is the reading §6.2 retires |
| `[trust] require_signature` | — | **Not adoptable**, and now for a sharper reason than PLAN-071's Context gives: lode's `off` exists because lode can install unverified artifacts, and mos has **two** mandatory gates (§6.2) with no mode that skips either. Importing the setting would mean building an unverified path in order to configure it off |
| `[http] headers` | — | Not built. mos does not authenticate to its update source today and this plan adds no credential |
| `[http] credential_hosts` | `http.credentialHosts` | **Adopt the key and the rule now, empty by default** — the same-origin rule must exist before the first credential does, because the failure it prevents is silent |
| `[http] allow_insecure` | — | **No analogue.** The package signature is what establishes trust; `docs/design/release-signing.md` §3.1 already mirrors metadata over plain HTTP deliberately and treats the mirror as unverified input |
| `[global] app`, `[command]`, `[runtime]`, `[env]`, `[supervise]`, `[signals]` | — | lode launches and supervises one application; mos's supervisor is systemd and its unit of update is the whole system |
| — | `product.vendor`, `product.model` | **mos EXTENSION.** lode's nearest thing is `[global] app`, which names the application lode supervises — a different fact. mos has no application to name and does need a place to say which product an image is, because §5's per-deployment argument turns on telling two builds apart. Justified as a label, not a selector: nothing reads it to make a decision |
| — | `fleet.enabled`, `fleet.url` | **mos EXTENSION.** lode has no fleet plane and therefore no analogue at all. It lives here rather than in the settings tree because *may this device dial out* is a product fact with a baked default, which is the §5.2 rule for what belongs in this layer; PLAN-072 owns everything it turns on |

**Where mos differs, once, so no later reader re-derives it.** lode's
`manifest.json` is a *remote* catalog: it enumerates versions, assets, sha256
digests and ed25519 signatures, and lode reads it over the network. mos's
`meta/updates/manifest.json` enumerates none of that, because all of it is
signed release-side metadata the server is authoritative for. Baking a copy of
a release catalog into an image would freeze a moving fact at build time and
produce a second, always staler answer to a question the update client already
asks correctly. What is baked is the *configuration for asking* — where, which
channel, under what policy, against which signing key — and nothing the server
owns. **The name is shared with lode and the role is not**, which is the third
manifest collision this record has to name.

**The same-origin rule, and the review property that changed.** Credentials
configured for the update source are attached only to hosts same-origin with
`update.source` as baked, plus the explicit `http.credentialHosts` list. The
previous revision claimed the list was **reviewable in a diff** because `meta/`
was committed. **That claim is now false and is withdrawn**: `meta/` is
gitignored, so a deployment's actual host list is out-of-band material like
`ca/` today. What survives is that the *shape* is committed in `meta.example/`,
and that the rule exists before the first credential does.

### 3. Where the public set lands in the image

```
meta/rauc/ca.cert.pem         →  /etc/rauc/keyring.pem                        0644 root:root
meta/updates/manifest.json    →  /usr/share/mos/meta/updates/manifest.json    0644 root:root
```

Two files, by name, and nothing else — §1.1 is why this is an enumeration
rather than a directory copy, and §2.1 is why the package-trust anchor needs no
file of its own.

**Inside the read-only dm-verity root**, which is the point: the configuration
and the anchors are covered by the same signature and the same block-level
integrity as the code that reads them. There is no state here that a device
knows and the build does not.

**`/usr/share/mos/`, and not `/etc/`.** `/usr/share/mos/` already holds exactly
this kind of thing — `manifest.tsv` and `release-identity.env` are build facts
that mosd and `rauc-update` read and nothing on the device writes. `/etc/` is
where an operator reasonably expects to be able to edit a file; putting an
unwritable configuration document there would invite an edit that silently does
nothing, and `/etc/rauc/keyring.pem` is in `/etc` only because RAUC's own
configuration names that path.

**The keyring keeps its existing path and its existing gate.** Staging it is
what the build does today; only the source directory's name changes (§6). The
byte-equality check over it is unchanged in contract, and
`packed-meta-is-the-public-set` (§1.1) extends the same shape to the other two
files — no extra file, no missing file, no differing byte, and a throw rather
than a pass when there is no `meta/` to compare against.

**The consequence, taken deliberately:** the device-side anchor stops being a
*path* and becomes a *field*. `rauc-update` today defaults to an anchor file at
`/usr/share/mos/uptane/root.json`; under this design it reads
`trust.signingKeys` out of the baked manifest instead. That default is
`[not implemented]` today — no shipped mechanism delivers an anchor to any
location — so nothing is broken by the change, and one place holding both the
trusted key and the source it applies to is one fewer pair that can disagree.
Open question 6 is the one thing that would bring a file back.

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
columns cover the baked update configuration and the trust anchors, because
those are files in the root filesystem.

#### 4.1 The reset disposition of `/mos/config/`, decided for the directory

§5.1 puts the operator's own update configuration in `/mos/config/updates.json`
on DATA. That is the `DATA (/mos)` column, which is already in the table, so no
row and no column is invented — but `/mos/config/` is a **new subtree**, it is
not covered by `[^apps-mos]`'s carve-out (which names `updates/`), and its
disposition is decided **for the directory** rather than inherited from
whatever the tier-2 rule happens to produce. A configuration subtree and an
application-data subtree are not the same claim, and the next subsystem must
find this answered rather than reopen it.

| Tier | `/mos/config/` | Why |
|---|---|---|
| 1 configuration reset | **re-seeded** | Tier 1's promise is *the modelled settings back to their defaults; the device configured as it left the factory.* A subtree named `config` surviving the configuration reset is a contradiction a reader trips over, and after a tier 1 the device would still be following a channel the previous operator chose |
| 2 application-data reset | **unaffected** | Tier 2 clears the application-owned subtrees, `apps/` and `containers/`, and opens nothing else. Configuration is not application data, which is the same reason `updates/` is left alone — stated for `config/` directly rather than borrowed from a footnote about verified bundles |
| 3 full factory reset | **re-seeded** | Tier 3 re-seeds `/mos` wholesale; every occupant returns to its baked default, which is what first-boot state means |
| 4 secure wipe | cleared | With everything else |

**This re-derives the previous revision's answer, which said tier 1 preserves
it.** That answer was written when the document lived inside `/mos/updates/`,
and its load-bearing objection was that teaching `reset.rs` to reach one file
inside a transactional workspace would give the applier a reach it does not
have. **That objection does not survive the move.** `reset.rs` already reaches
the DATA pool — its `Roots` type has the DATA pool and STATE — so tier 1
clearing `/mos/config/` is not a new root; it is the same operation tier 2
already performs on `apps/` and `containers/`, applied to a whole subtree
rather than reaching inside one. What was expensive at a file granularity is
ordinary at a directory granularity, which is a second reason the namespace is
worth having.

**What it costs, since the table's cells are asserted cell for cell.** The
tier-1 `DATA (/mos)` cell changes from `preserved` to `re-seeded` with its own
footnote, in the same shape tier 2's `re-seeded [^apps-mos]` already uses: only
`config/` is re-seeded, and `ui/`, `apps/`, `containers/`, `updates/`,
`home/` and `root/` are untouched by tier 1 exactly as they are today. That is a
real change to shipped, tested code and to a document whose tests assert the
`preserved` and `unaffected` cells, and F6c carries it.

**What it buys, and it is more than tidiness.** Today `update-policy.toml` is
on STATE and tier 1 re-seeds it, so *configuration reset returns the update
channel to its default* is the current behaviour. The previous revision
accepted losing that as a side effect of moving to DATA and documented the
regression. This decision keeps the behaviour instead: **the move stops being a
behaviour change at all**, and the operator page no longer has to explain that
one reset used to do something and now does not.

**The finer-grained action stays useful.** *Return to the baked default
channel* remains an explicit action on the update surface — clearing the
operator layer — because an operator who wants their channel back should not
have to spend a whole tier-1 reset on it. A reset tier is not the place to
discover a channel change; it is now merely also not the place where one
silently survives.

**One debt this removes.** The previous revision owed `[^apps-mos]` an extra
clause, because with the document inside `/mos/updates/` that footnote's stated
reason — *a verified bundle is not application data* — no longer covered
everything the cell protected. With the document in `/mos/config/`, the
footnote is correct as written and covers exactly what it says. `[^apps-mos]`
instead gains `config/` in its list of subtrees tier 2 does not open, which is
an addition to an enumeration rather than a repair of a reason.

### 5. The cost: which facts are per-build, and which the operator changes

The previous draft of this section said "baked means a rebuild" and left it
there. That is no longer true of everything, and the honest split matters more
than the slogan.

**Per-build, and not changeable on a running device:**

- the update source URL (`update.source`);
- the trust anchors — the RAUC keyring staged from `meta/rauc/ca.cert.pem`,
  and the trusted package keys in the baked manifest's `trust.signingKeys`.

**Operator-changeable, with no new image, through the layer of §5.1:**

- the **channel**;
- `policy` (`off | check | auto`), `checkIntervalMinutes`, `rebootPolicy`;
- the maintenance windows, the network mode and the reboot-gate keys, which
  were never baked at all.

The line is **what the device talks to and what it believes** versus **what it
does about it**. Changing the server or an anchor is a trust decision and rides
a release; changing the channel or the schedule is an operating decision and
rides one authenticated API call.

Four consequences follow from the half that stays per-build, and two of them
are narrower than the previous draft claimed:

1. **One build serves one *server*, not one fleet.** Two deployments that share
   an update source and differ only by channel are **one image**, and the
   difference is an operator setting on each device. Channel differentiation no
   longer forks the build, which is the single largest thing this addendum
   bought.
2. **The release-identity problem survives, but only where trust differs.**
   Two images differing in `meta/` still report the same `BOARD`, `PROFILE` and
   `VERSION`, and `rauc-update` selects on exactly those plus channel — so two
   deployments the update mechanism must tell apart still need distinct release
   identity, and `PROFILE` is still the field with the right shape (open
   question 1). What changed is *when* that bites: only when the source URL or
   an anchor differs, not when a customer wants `beta`.
3. **`meta/` is now out-of-band material, which trades one problem for
   another.** The previous revisions noted that a committed `meta/` publishes
   every customer endpoint to anyone with repository access, permanently. That
   disclosure problem is gone with the directory's gitignoring. In its place: a
   deployment's configuration is no longer reproducible from a checkout, and a
   build is reproducible only together with the `meta/` its build host carried.
   That belongs in the release record beside the keys, and it is the property
   `ca/` already has.
4. **The chicken-and-egg case is unchanged and now has no configuration
   escape.** The server that must deliver the new image is the one being
   changed, and after this addendum an operator cannot re-point it either. The
   escapes are offline `rauc-update import` — a bundle on removable media,
   verified against the baked keyring and the pinned root, needing no server at
   all — and a reflash. A device with no operator *and* no physical access
   whose server has gone away is stranded; that is the true residue and it is
   not fixable by anything short of a channel this product deliberately does
   not have. **The residue has to be visible outside this plan**: F11 owes the
   operator page a statement that the update server is fixed at build time,
   that changing it needs a new image or an offline import, and what to do when
   the server is gone. A stranded device whose operator was never told is a
   support case that reads as a defect.

**A capability is being removed, and it should be seen.** `update-policy.toml`
lets an operator set `source.url` today. After this plan the operator document
has no key for it, and `deny_unknown_fields` means adding one is a load error —
so "the operator cannot re-point the update server" is enforced by the schema
rather than by a rule somebody has to remember. That is a deliberate
tightening: the source URL joins the anchors on the build side, because which
TUF repository a device walks is a trust decision and one fewer writable knob
on the trust-relevant path is worth the flexibility it costs. The price is
consequence 4, stated above rather than discovered.

#### 5.1 Three layers, one precedence rule

1. **The public set baked from `meta/` at build (§1.1).** Fleet-identical,
   per-build: the source URL, the trust anchors, and the **default** channel,
   policy and check interval.
2. **`/mos/config/updates.json`, on DATA.** Operator-owned, machine-written,
   survives every A/B update and every slot rollback because DATA is neither;
   re-seeded by the reset tiers §4.1 names. It is the update subsystem's
   occupant of the `/mos/config/` namespace §5.2 establishes.
3. **The running state.** What the lifecycle actually did — `idle`, `checking`,
   `ready`, `reboot-required` and the rest. It configures nothing; it is the
   record of what happened, and it is in this list only so that a reader stops
   looking for a fourth place a channel could come from.

| Key | Layer 1 baked from `meta/` | Layer 2 `/mos/config/updates.json` | Rule |
|---|---|---|---|
| update source URL | **owns it** | no such key | baked only; not overridable, and the schema is what says so |
| RAUC keyring, TUF root | **own them** | no such key | baked only; not overridable |
| channel | default | **overrides** | layer 2 wins; absent → the baked default |
| `policy`, `checkIntervalMinutes` | default | **overrides** | layer 2 wins; absent → the baked default |
| `rebootPolicy`, windows, network mode, reboot-gate keys | not present | **owns them** | layer 2 only; absent → the code defaults |

**Where layer 2 lives: `/mos/config/updates.json`, in a namespace of its
own.** The user's request first named `/mos/update`, one letter from the
existing `/mos/updates/` workspace — a collision that would be silent in both
directions. An intermediate revision of this record answered that by putting
the document *inside* the workspace, at `/mos/updates/config.json`. **That is
superseded.** The document lives in a new subtree, `/mos/config/`, and §5.2 is
the reason it is a namespace rather than a location for one file: later
subsystem configuration of this kind goes there too, and the first occupant
sets the rules the rest inherit.

Three things the move buys, beyond avoiding the near-collision: a workspace
whose discipline is *unverified leftovers are removed* is no longer asked to
hold a durable document; the reset disposition is decided once for a directory
that means one thing (§4.1) instead of inherited from a carve-out written about
verified bundles; and a reader looking for *where is this device's
configuration* has one answer rather than one per subsystem.

**What becomes of `/var/lib/mos/update-policy.toml`: it goes away.** Not split,
not kept for a subset — **moved wholesale**, because two files that both name
the channel is the defect this campaign exists to remove, and a split with no
overlap would still be two homes for one operator-owned concern. Layer 2 is
today's policy document minus exactly the two keys that moved up to layer 1:
`source.url` (per §5, now baked) and `source.rootPath` (the anchor, now the
baked manifest's `trust.signingKeys`). `channel`, `repoDir`, `statePath`, `maxBytes`,
`network`, the check interval, `maintenance.windows` and `rebootGate` carry
over unchanged, re-expressed as JSON. **One fact, one writer, one file.**

**What the move costs, since it contradicts a written rule.**
`docs/design/updates.md` §2 chose STATE deliberately, on PLAN-061's tier rule
that small authoritative metadata belongs on STATE and only large bytes go to
`/mos`. This addendum overrides that for this document, and the honest ledger
is:

- **Against:** a few hundred bytes of authoritative configuration now live on
  the tier meant for bulk, and PLAN-061's rule gains an exception that
  `updates.md` §2 must be rewritten to state rather than left contradicting
  itself.
- **For, and it is the stronger half:** the update subsystem's configuration
  and its workspace now share one availability domain. Today they do not —
  configuration on STATE, bundles on DATA — so a device can have readable
  policy and an unusable workspace, which is one condition reported as two
  different refusals. After the move both are on the DATA pool, and the
  existing readiness probe checks the **pool and its mount** rather than any
  one directory, so it gates both and there is one answer to "can this device
  update". **That argument is now at the pool level, not the directory level**:
  an earlier revision put the document inside `/mos/updates/` and could say the
  two shared a directory. Under `/mos/config/` they do not, and the probe is
  why the conclusion survives the move.
- **And the reset consequence is §4.1's**, priced there in the table's own
  terms rather than as an aside here.

**Absent, malformed, and a channel the source does not carry.** The existing
rules stand and gain one case:

- **Layer 2 absent** → the baked defaults, which is the design: a device that
  has never been configured follows what it shipped with. This is only reachable
  as *never configured* or *reset*, because a DATA pool that is missing or
  unmounted fails the workspace readiness probe first, and that refuses the
  actions with `update-unavailable` instead of quietly falling back.
- **Layer 2 malformed** → fail closed on the *actions*, fail open on the
  *device*, and **never** silently adopt the baked channel. Every capability
  the document gates is refused with a message naming the file; everything else
  on the device keeps working. A parse error is not absence, and treating it as
  absence would put a device on a channel its operator did not choose.
- **Layer 1 malformed** → impossible at runtime: it is validated at build time
  and a malformed one fails the build.
- **The selected channel is not published by the source** → report exactly
  that, and **do not fall back to the baked default**. A fallback here is a
  device quietly following a channel its operator did not choose, which is the
  same defect as the malformed case wearing different clothes. This is a
  *distinct* reason from PLAN-071 §4's existing one — *the selected channel
  holds no release newer than the running system* — because the operator's next
  action differs: wait, versus fix the selection. Two states that need two
  different responses must not share one sentence.
- **No default server** is untouched by all of this: absent in layer 1 and
  absent in layer 2 still means no online source, refuse, and offline import
  remains (§7).

#### 5.2 `/mos/config/` is a namespace, and the first occupant sets its rules

Update configuration is merely the first thing to live here; later
configuration of this kind goes in the same subtree. The rules below are
therefore written for the **namespace**, not for `updates.json`, because the
second subsystem will otherwise arrive with TOML, a hand-editing assumption and
its own opinion about resets — and by then the rules will be load-bearing.

**Naming: `/mos/config/<subsystem>.json`, one flat document per subsystem.**
The alternative, `/mos/config/<subsystem>/…`, is rejected. One document per
subsystem means one writer, one atomic rename and one parse-error blast radius;
a directory invites several files with **no transaction across them**, so a
subsystem could half-apply a change and have no way to say so. A flat listing
of `/mos/config/` is also the namespace's own index — `ls` answers *what on
this device is configured this way*. A subsystem that genuinely needs several
documents may take a directory, and that is a decision with a stated cost
(atomicity stops at the file) rather than a default. Changing this rule later
means touching every writer, which is why it is settled here.

**Format and write discipline, as namespace rules:**

- **JSON.** Not TOML, not YAML, not "whatever the subsystem prefers". These are
  machine-written documents and JSON is what a machine writes without a
  round-trip formatting problem; a mixed-format namespace also means every
  reader guesses by extension, which is exactly the failure the `config.toml`
  naming correction was made to avoid.
- **Machine-written, never hand-edited.** The writing daemon owns the file's
  shape. A human edits it through an authenticated API; if a human edits it
  with `vi`, the next write overwrites them and that is the documented
  behaviour, not a bug.
- **Atomic: temp file, fsync, rename, directory fsync.** The discipline already
  used elsewhere in the tree. An interrupted write leaves the previous document
  intact, never a truncated one.
- **Fail closed on a parse error, with no fallback.** A document that exists and
  does not parse refuses the capabilities it gates and **never** silently
  reverts to the baked layer. §5.1 argues this for updates; it is a namespace
  rule because the argument is not update-specific — a parse error is not
  absence, and treating it as absence configures a device the way nobody chose.
- **No secrets.** These documents are world-readable at 0755 and are not
  redacted. A subsystem with a credential to store needs a different home;
  putting one here is the same defect as putting one in the baked layer (§1.4),
  one tier down.

**One writer per document, and it is a daemon.** mosd writes; apid holds the
authenticated route and **asks**. Stated for the namespace so that two
processes never write one document, which no amount of atomic renaming makes
safe. A subsystem whose daemon is not mosd owns its own document and no other.

**The subtree itself.** `rootfs/overlay/usr/lib/mos/mos-data-layout` creates
`/mos`'s subtrees by name — `ui`, `containers`, `home`, `root`, `apps`,
`updates` — and `config` needs its own entry at **0755**: readable by any local
reader, writable only by root, matching `updates/` and `ui/`. 0755 is safe
precisely because of the no-secrets rule above; if that rule is ever broken the
mode is the wrong question to fix first.

**The boundary against the settings tree, as a rule a reader can apply without
asking.** mosd already owns a schema-versioned settings tree with a migration
chain on STATE, holding `hostname`, `network`, `access`, `provisioning`,
`wifi`, `container`, `mqtt`, `time` and the staged reset intent. The rule is:

> **A document belongs in `/mos/config/` if and only if the image bakes a
> default for it in `meta/`.** Everything else is the settings tree's.

That is mechanical, and it is why the update document moved: its channel,
policy and interval have baked defaults and its source URL is baked outright,
so the operator layer is the second half of a two-layer system whose first half
is in the image. Nothing in `meta/` defaults a hostname or an IP address, so
those stay where they are.

**Two weaker lines were considered and rejected, and one of them is the obvious
one.** *Device behaviour versus how a subsystem reaches the outside world* is
close and reads well, but the settings tree already contains `mqtt` — broker and
bridge policy, which is outward-reaching by definition — so a reader applying
that line would move an existing key and be wrong. *Must survive an A/B update*
does not discriminate at all: STATE and DATA are both separate partitions and
both survive; the A/B slots are what is replaced. The baked-default rule is the
one that matches the tree as it actually is, and it has the property the other
two lack — it can be checked by looking at `meta.example/` rather than by
judging a category.

**What the rule implies for the next subsystem.** Adding a document here is
therefore *two* changes, not one: a baked default in `meta/` and an operator
document in `/mos/config/`. A subsystem that wants only the second has not met
the rule and belongs in the settings tree; a subsystem that wants only the
first is baked configuration with no operator override, which is allowed and
needs no file here at all.

### 6. One directory, not two: `ca/` absorbed, and the six keys it now holds

#### 6.1 The decision, and the price of the alternative

**Recommended: absorb.** `ca/` ceases to exist; its four files move to
`meta/rauc/` unchanged in name, mode and meaning. The previous revision
concluded the opposite — one input, `ca/` wins, M3 forbids certificates in
`meta/` — and that conclusion is **retired by the layout**, not defended: the
user's `meta/rauc/` puts the RAUC key inside `meta/`, and with `meta/` now
gitignored, generated-when-absent and full of private keys, `ca/` and `meta/`
would be **two directories with identical properties and no rule
distinguishing them.** The property that made two directories legible — `ca/`
secret, `meta/` public — is exactly what this layout deletes.

Three reasons, in order of weight:

1. **A boundary a reader cannot apply will be applied wrongly.** "Which one
   does this file go in?" had an answer while one directory was the secret one.
   It has none now.
2. **One selective-bake rule instead of two.** §1.1's allowlist has to cover
   every directory that feeds the image. With `ca/` beside `meta/`, B1 and B2
   are written twice over two trees, and the second one is the one a later
   slice forgets.
3. **One generator, one marker, one ignore entry.** Two directories mean two
   `GENERATED` markers and the question of what a tree with `ca/GENERATED` and
   no `meta/GENERATED` means.

**The price, enumerated rather than waved at.** Absorption is mechanical rename
churn with no behavioural change, across: `rootfs/build.sh` (`CA_DIR`),
`build/src/bundle-cli.ts` (the `keyDir` default resolving `signer.cert.pem`,
`signer.key.pem` and `ca.cert.pem`), `pkgs/rauc/gen-dev-keys.sh` (`KEYDIR`),
`verify/src/checks-root.ts` (`ctx.caDir`, and `packed-keyring-from-ca` →
`packed-keyring-from-meta`), `verify/src/checks-fixture.ts` and the verify and
build test suites, `rootfs/compose/compose-install.sh`,
`tests/rauc-trust-negative-test.sh`, `tests/trust-domain-hygiene-test.sh`,
`.gitignore`, and the operator steps of `docs/design/release-signing.md` §2.5.
The check's assertion — the shipped keyring is byte-equal to the one
certificate in the tree — is unchanged; only its name and its directory move.

**The alternative, priced: keep `ca/` beside `meta/`.** Zero churn today. It
costs, permanently: two homes for private keys with no rule saying which; two
generators, or one with two roots; two `GENERATED` markers; the allowlist and
both its checks written over two trees; and the user's layout not actually
implemented, since `meta/rauc/` would not exist. It is the cheaper change and
the more expensive design, and the tree is in development, so the churn is the
thing worth spending. **Re-openable** if the rename reaches further than the
list above — but that list was enumerated, not estimated.

#### 6.2 Two domains, three keys: the image chain and the package chain

**The split is by object, not by hierarchy**, and it is the user's ruling:

- **`meta/rauc/`** — the RAUC CA and its signer. This chain gates the **A/B
  system image**. Compromise means an attacker **installs a system**.
- **`meta/updates/root.key`** — lode's key over the update **package**. It is
  what guarantees a downloaded package has not been tampered with. Compromise
  means an attacker **forges a package, not a system image**.

| File | Domain | Signs | Used | If stolen | Rotation |
|---|---|---|---|---|---|
| `meta/rauc/ca.key.pem` | image | signer certificates | at a ceremony, rarely | mint a signer the fleet already trusts, and **install a system** on every device until reflash | `release-signing.md` §2.4 rollover with an overlap window; a *compromised* CA is §2.3's uncovered case and needs a reflash |
| `meta/rauc/signer.key.pem` | image | the bundle's CMS signature | every release | **install a system**, while the certificate is valid | §2.2 reissue — cheap, needs the CA key, no fleet update, because devices trust the CA |
| `meta/updates/root.key` | package | the update package and its release metadata | every release, **locally** | have a device accept a forged package as authentic — download it, verify it, and then **fail to install it** | a new image, because the public half is baked; the trusted-key **list** (§2.1) is what makes an overlap window possible |

**The blast-radius sentence, which is the point of the split.** An attacker
holding `root.key` alone can make a device accept a package as authentic, and
still cannot make it install anything: installation is gated by the RAUC CMS
signature chaining to `meta/rauc/ca.cert.pem`, which they do not hold. An
attacker holding the RAUC CA alone can build an installable bundle and cannot
get it distributed as an authentic package. **Both gates must fall**, and they
fall to different keys with different custody.

That independence holds **at install time** and not **at provisioning time**:
the package-signing public key is baked in the image, so whoever controls the
image signing path controls what the package gate trusts. §6.3 is that tradeoff
stated in full, and it is the reason the two gates are not a substitute for
keeping the image chain's keys offline.

**The reading this retires.** The previous revision concluded `root.key` was
the **TUF root-role key** — offline, signing only a `root.json`, never a
release. That is retired, not defended, and the user's own phrasing is what
should have decided it the first time: *"used locally to sign update bundles"*
means a key used on **every release, on the release host**. A TUF root key is
never used to sign a release; that is the entire point of an offline root. The
first revision explained the phrase away as describing a release flow that
touches several keys, which was the weaker reading of a sentence that was
already clear.

**Three consequences of retiring it, so the change is not cosmetic:**

1. **`meta/updates/online/` is gone.** It was an addition the layout did not
   state, and it existed only because a TUF hierarchy separates its offline
   root from three online role keys. One key that signs every release needs no
   such separation, and the directory tree is now exactly the user's three
   lines.
2. **The manifest's trust block changed shape** — inline key rather than a pin
   on a document — and §2.1 is that re-derivation, including which part of the
   old answer survives and which of its objections had to be answered
   differently.
3. **The baked public set dropped from three files to two** (§1.1, §3): there
   is no root document to ship.

**The production shape: `root.key` is present, and that is the difference.**
`meta/rauc/ca.key.pem` stays off a release host —
`docs/design/release-signing.md` §2.5 already says so — because signing a
release needs the *signer* key, not the CA key. `root.key` is the opposite: it
signs every package, so a release host must hold it, and the protection it gets
is operational (host hardening, restricted access, an audit trail) rather than
the CA's air gap. Stating that plainly matters because a reader who has just
read §2.5 will otherwise assume the same rule covers both keys, and it does
not.

**The consequence of one directory, said plainly.** `meta/` now holds both
domains' private material, so one build-host compromise yields both gates —
which is exactly the pair the split above exists to keep apart. The mitigation
is the same one `release-signing.md` §2.5 already applies to the CA key: the
key that does not need to be there is not there. On a release host that is
`ca.key.pem`; a development tree that holds everything is a development tree,
and the marker in §1.2 is what says so.

#### 6.3 The two anchors: one source each

**The RAUC keyring keeps exactly one source**, now spelled
`meta/rauc/ca.cert.pem`. `rootfs/build.sh` already refuses a second source —
the overlay — unconditionally and with a stated reason, that a trust root
arriving from a place nobody is watching arrives *by being forgotten*; that
refusal is untouched. The union case needs no second directory: a keyring is an
OpenSSL CA file — concatenated PEMs, every one trusted — which is what
`docs/design/release-signing.md` §2.4's rollover already is and what
`tests/rauc-trust-negative-test.sh` already proves the properties of. An
operator wanting a two-CA image concatenates the second certificate into
`meta/rauc/ca.cert.pem`, where the rollover procedure puts it.

**The package anchor keeps exactly one source too**, and it is a field rather
than a file: `trust.signingKeys` in the baked manifest (§2.1). There is nowhere
else a trusted package key may enter — no path key naming a file, no operator
override, no compiled-in default (§7) — so there is no precedence to arbitrate
and no second place to look. The union case is the same shape as the keyring's
and is served the same way: more than one entry in the list, which is what an
overlap window is.

**The tradeoff that comes with baking the package anchor**, which
`pkgs/rauc-sign/README.md` already states for an image-carried anchor and which
this plan accepts rather than restates as new: the trusted package key is
exactly as trustworthy as the image carrying it, so first trust and any
re-anchoring ride the RAUC channel, and **the package gate cannot outlive a
compromise of the image signing path.** §6.2's independence claim is bounded by
exactly this: the two gates are independent *at install time*, when both must
pass, and dependent *at provisioning time*, because one supplies the other's
anchor. What is bought is that there is nothing to distribute in the ordinary
case and nothing on the device that can be rewritten to change what it trusts.

**What this does not close.** The two cases `docs/design/release-signing.md`
§2.3 names as uncovered by an image-carried keyring stay uncovered: a device
that missed a CA rollover's overlap window, and rotation away from a CA that is
already compromised. Both still need a reflash, and **the package key inherits
both**, because a baked trusted-key list has the same overlap-window shape and
the same failure when the window is missed. Both still need a reflash. Open
question 2 is where a later device-time channel would land, and it would now
cover two anchors rather than one.

### 7. No default server, and the check that holds it

**There is no built-in vendor URL anywhere in the tree and this plan adds
none.** `meta.example/`'s `manifest.json` sets `update.source` to `null` and
`fleet.url` to `null`, so a build from a fresh checkout produces a device that
checks nothing until somebody either edits its own gitignored `meta/` for a
product build or writes the operator document on the device. A device whose
baked manifest names no server **refuses to check** and says so, rather than
falling back to a vendor host.

That rule is mechanical rather than promised: a verifier check over the
assembled image fails any build in which the update client, mosd or the
`meta/` reader carries a **compiled-in scheme-and-host default** for an update
or fleet endpoint. Baking `meta/` makes that check *more* necessary, not less —
there is now a legitimate place for a URL in the image, and a compiled-in
fallback beside it would be an easy and invisible addition. The check
distinguishes data from code: `/usr/share/mos/meta/` may name a host, and no
binary may.

**What a fresh checkout does, end to end**, since `meta/` is now absent by
default rather than committed:

1. `rootfs/build.sh` calls `gen-dev-keys.sh --if-absent`, which finds no
   `meta/rauc/`, generates a development-grade CA and signer, prints the loud
   notice, and writes `meta/GENERATED` naming the `rauc` domain.
2. The same step instantiates `meta/updates/manifest.json` from
   `meta.example/`, so the tree's default configuration names no server.
3. `trust.signingKeys` is empty, so no package-signing key is baked and the
   build says so in one line (§1.2). This is not an error: with no source
   configured there is no package to verify.
4. The image builds; `packed-keyring-from-meta` reports the trust root
   **development-grade**, and `packed-meta-is-the-public-set` asserts the baked
   set is exactly the manifest — the anchor's absence is a fact it states, not
   a failure.
5. The device boots, self-provisions, derives its hostname from its identity,
   and is fully manageable over apid on the LAN. Update source: none, so check
   and fetch refuse with the reason they refuse with today, and the offline
   lockbox import path remains. Fleet: off.

The absent case is a supported steady state, not a degraded one.

The rule is about the **source**, and §5.1's channel rules are its companion
rather than an exception to it: a device with a baked source and an
operator-selected channel that source does not publish refuses, and says which
channel it was asked for. Neither an absence nor a bad selection is ever
answered by a value the device picked for itself.

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
`/usr/share/mos/meta/`. It returns the whole baked document, and the reason is
now structural rather than a promise about a directory: **the baked set is
allowlisted and checked twice (§1.1), so nothing secret is in the image for
this endpoint to disclose.** The private half of `meta/` never left the build
host and is not reachable from any device API because it is not on any device.
The redactor still covers the settings subtrees beside it.

The digests carry most of the value. An operator debugging *why will this
device not update* needs to know which anchor it pinned and which configuration
it was built with, and a digest answers both without shipping a certificate
through an API. Because the digests are over files inside the verity root, they
are also the cheapest available cross-check that the image is the one the
release claims — and `trust.signingKeyIds` (§2.1) makes the package anchor
checkable against the ceremony minutes without decoding base64 by hand.

Three facts should read side by side wherever this surfaces: the **baked**
value, the **operator** value from `/mos/config/updates.json`, and the
**effective** one after §5.1's precedence. An operator looking at a device
following a channel they do not recognise needs to see, in one place, whether
it came from the image or from a selection somebody made — and, after a full
factory reset, that the selection is gone and the baked default is back
(§4.1).

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
   `docs/design/release-signing.md` §2.3's missed-overlap case (§6.3). A signed
   USB import with the TUF chain rule is the natural shape and is
   `pkgs/rauc-sign/README.md`'s third candidate; it is strictly better
   authorisation than the physical-possession rule the old draft used, and it
   is now a *second* channel added to a pinned root rather than the way first
   trust arrives. Not designed here, and named so that removing the old
   mechanism does not look like removing the requirement.
3. **Does the baked set carry anything a device could not compute?** Today it
   carries configuration and both anchors. The pressure to add per-device values
   will come from manufacturing (`docs/design/manufacturing.md` §3 wants a
   serial in a per-device record) and from zero-touch enrolment (PLAN-054
   question 6). Both are structurally excluded by baking, and the answer must
   stay no; the question is recorded so that the next person who wants it finds
   the argument instead of the directory.
4. **Should the image carry the development-grade marker?** `meta/GENERATED` is
   build-host-only, so a fielded device cannot say whether it trusts a
   development CA — only a verifier run against the tree that built it can. A
   baked `/usr/share/mos/meta/GENERATED` would make the device self-describing,
   at the cost of one more file on the allowlist and one more thing to keep
   true. Not designed here; named because it is the obvious next request from
   anyone debugging a device they did not build.
5. **Is `--domain updates` generation wanted in the default build?** §1.2 makes
   it opt-in because a development package-signing key that has signed nothing
   anchors nothing, and generating one by default would have every fresh image
   claim a trust relationship it does not have. If a development release
   repository becomes part of the standard loop, this flips.
6. **What is the release-side mechanism `root.key` signs with?** The user's
   ruling settles the key's *identity, custody and blast radius* — lode's key
   over the package, not the image's — and this record designs all three. It
   does not settle whether the package repository stays the TUF one
   `pkgs/rauc-sign` builds today or becomes lode's plainer scheme, and that is
   the release side's question, which `docs/design/release-artifacts.md`
   already records as open. **What it changes here is exactly one thing**: if a
   signed root document survives on the release side, the device needs it and
   the baked public set gains a third file — one reviewed line on §1.1's
   allowlist, which is the behaviour the allowlist exists to produce. Nothing
   else in this record turns on the answer, and the record deliberately does not
   retire shipped, tested tooling by implication. **This must be answered before
   F5**, because the reader's `trust` block differs between the two.

## Risks

- **A private key reaching the image.** The one that matters (§1.1): every
  device would carry the key that signs its own updates, and one purchased unit
  would yield fleet-wide code execution. Mitigated by an allowlist rather than
  a denylist, checked at the build (intent) and over the packed root (outcome),
  with a detector covering DER PKCS#8 and not only PEM armour — because the
  file the hazard is named after is DER.
- **Absorbing `ca/` touches eleven files and two trust test suites** (§6.1).
  Mechanical, but mechanical churn across trust-critical code is exactly where
  a rename lands in the wrong branch. The existing suites are the control, and
  the slice's gate is that they pass with their meanings unchanged rather than
  with their expectations edited.
- **`meta/` is no longer reviewable.** The previous revision leaned on "it is
  committed, so a secret appears in a diff". That defence is gone (§1.2), and
  its replacement — `meta.example/` plus the release process — is weaker for
  exactly one case: a secret that does not look like one, inside
  `manifest.json`. Stated so nobody re-derives the withdrawn claim.
- **One directory now holds both signing hierarchies** (§6.2). In a development
  tree, one host compromise yields both the RAUC CMS gate and the TUF metadata
  gate. Mitigated by the production rule that `ca.key.pem` and `root.key` are
  absent from a release host — which is the rule `release-signing.md` §2.5
  already states for the first of them, but it is a rule, and rules about which
  files are *absent* are the ones nobody notices being broken.
- **A server or anchor change costs a release, and now has no configuration
  escape.** This is the design, not a defect, and the risk is that it is
  discovered at the wrong moment — the first time a customer's server moves.
  §5 prices it, and §5 also removes an ability `update-policy.toml` has today,
  which is the part most likely to surprise somebody who knows the current
  file.
- **The operator layer moved tiers, so a reset means something different.**
  §4.1 is the table. The specific risk is a support call that starts *the
  device went back to `stable` by itself*: it did, because somebody ran a full
  factory reset, and nothing told them that would happen. The mitigation is
  documentation and the read surface of §8, and both are backlog items rather
  than good intentions.
- **`/mos/config/` is a namespace with one occupant, and namespaces set by
  their first tenant.** Every rule in §5.2 was written against a single JSON
  document holding a channel and a switch. The second subsystem will arrive
  with something the rules did not anticipate — a secret, a document too large
  to rewrite atomically, a value two daemons both want to write — and the rules
  will be load-bearing by then. That is the reason to state them now rather
  than the reason not to; the specific mitigation is that each rule in §5.2
  carries the failure it prevents, so a subsystem that must break one can see
  what it is buying.
- **Tier 1 gains a write to DATA it does not have today** (§4.1). `reset.rs`
  already reaches the DATA pool, so this is not a new root — but it is a new
  cell in a table whose cells are asserted cell-for-cell by tests, and the
  failure mode of getting it wrong is a reset that clears more than its row.
  The existing survival assertion is the control.
- **`meta/` looks editable and is not.** It is a JSON file in a directory, in
  an image, on a read-only verity root. Somebody will edit
  `/usr/share/mos/meta/updates/manifest.json` on a running device, or try to, and
  nothing will happen — or worse, they will remount and break verity. The read
  surface of §8 showing baked-versus-effective side by side is what points them
  at the policy file instead.
- **The `meta/` versus META-partition name collision**, and now a second one:
  three files in this tree are called a manifest (§2). A reader who knows the
  partition table will assume the wrong one.
  Mitigated only by saying so, in this record and in the design docs the
  backlog updates.
- **B1 and B2 catch the accident and not the adversary.** §1.2 states the
  limit; the risk is that their existence creates a false sense that the baked
  set is *verified* free of secrets rather than *known* to hold only three
  named files. The allowlist is the control; the detectors are the backstop.
- **Moving `rauc-update`'s default anchor path.** It is unimplemented today, so
  the move is free — but it is exactly the kind of change that is free until
  something outside this tree has already hard-coded the old path. Worth one
  grep at implementation time rather than an assumption now.
- **Baking the package anchor ties the two gates together at provisioning
  time** (§6.3). §6.2's independence claim — both gates must fall — holds at
  install time and not when the image is built: whoever controls the image
  signing path controls what the package gate trusts. This is the accepted cost
  of the image-baked candidate, it is the one `pkgs/rauc-sign/README.md` names,
  and open question 2 is where the mitigation would go. The risk specific to
  this revision is that §6.2's split reads as stronger than it is if that bound
  is skipped.

## Scope

In scope: `meta/`'s layout and its split into a baked public set and a
build-host-only set; the allowlist and the two checks that hold it; the
absorption of `ca/`; the two signing domains, and the identity, custody and
blast radius of each of the three private keys; `meta/updates/manifest.json`'s
schema, its mapping from lode's `lode.toml`, and the form the package anchor's
public half takes in it; `meta/` being gitignored, the committed
`meta.example/`, and generation when absent; the image paths and the
byte-equality gate; the three layers and the one precedence rule between them;
**the `/mos/config/` namespace and every rule a later subsystem inherits from
it, including its reset disposition and its boundary against the settings
tree**; what becomes of the STATE policy file; the no-default-server rule, the
channel rules and their verifier check; the read surface.

Out of scope: the update policy semantics (PLAN-071); anything the fleet switch
turns on (PLAN-072); the per-device manufacturing record
(`docs/design/manufacturing.md` stays `[proposed]`); a device-time trust
channel (open question 2); **the release-side package repository's mechanism
and hosting** (open question 6), which `docs/design/release-artifacts.md`
already records as open; the META partition, which this plan does not touch.

### Implementation backlog — estimated separately from approval

Sized in slices, each independently verifiable. No slice is authorised by
approving this plan; each becomes a task record when it is scheduled.

| # | Slice | Size | Gate |
|---|---|---|---|
| F1 | `meta.example/` committed with the §2 document and its README; `/meta/` gitignored with the `/ca/` tombstone kept | S | the committed example names no server and contains no key-shaped file |
| F1b | `gen-dev-keys.sh` absorbed onto `meta/`: `--domain rauc` by default, `--domain updates` opt-in, `meta/GENERATED` naming the domains it wrote, `manifest.json` instantiated from `meta.example/` | M | a fresh checkout builds an image; a second build regenerates nothing; the marker survives and names what it covers |
| F2 | The `ca/` → `meta/rauc/` rename across `rootfs/build.sh`, `bundle-cli.ts`, `verify` (`ctx.caDir`, `packed-keyring-from-ca` → `packed-keyring-from-meta`), the fixtures, `compose-install.sh` and both trust test suites (§6.1) | M | the existing suites pass with their meanings unchanged, not their expectations edited |
| F3 | Selective staging: the §1.1 allowlist in `rootfs/build.sh`, plus refusal **B1** (off-allowlist path; private-key detector with all three tests) | S | a planted `root.key` under a staged path turns the build red and names the file; the tree as generated stays green |
| F4 | Verifier **B2**: `packed-meta-is-the-public-set` (byte-equal, nothing extra, throw on absent `meta/`) and `no-private-key-in-baked-meta` (three detectors, scoped paths, reports the file count scanned) | M | an image with an added, removed or altered file under the path fails; an image with a planted key under either scoped path fails; a tree with no `meta/` throws rather than passing |
| F5 | The reader in mosd: parse, validate, `deny_unknown_fields`, expose as live state | M | unknown key is a build error, not a runtime one; the reader always answers with a document |
| F6 | §5.1 precedence in `update_policy.rs`: the three layers, per-key override, and the parse-error rule that does **not** fall back | M | a layer-2 document that fails to parse refuses actions and does not silently adopt the baked channel |
| F6b | Move the operator document: `/var/lib/mos/update-policy.toml` retired, `/mos/config/updates.json` in its place, `source.url` and `source.rootPath` dropped from its schema | M | the channel is readable from exactly one file; a document naming a source URL is a load error |
| F6c | The `/mos/config/` namespace: the `mos-data-layout` entry at 0755, the §5.2 rules written where a subsystem author meets them, and tier 1's re-seed of the subtree in `reset.rs` | M | a virgin device has the subtree at its declared mode; tier 1 returns every occupant to its baked default and leaves the rest of `/mos` alone; §2.1's table and its tests agree cell for cell |
| F7 | `rauc-update` reads `trust.signingKeys` from the baked manifest instead of an anchor file path; `trust.signingKeyIds` derived at build time | S | an anchor supplied any other way is refused; a hand-written `signingKeyIds` that does not match `signingKeys` fails the build |
| F8 | No-compiled-in-endpoint verifier check | S | fails a build with a planted default URL in a binary; passes with one in `meta/` |
| F9 | `GET /api/v1/provisioning/status` extension: the document, the digests, and baked-versus-effective | S | — |
| F10 | Design-doc updates: `recovery.md` §2.1's clarifying note, its **new tier-1 footnote and `config/` in `[^apps-mos]`'s untouched list (§4.1)**, `updates.md` §2 (the policy file's tier, its new home and format) and §7, `release-signing.md` §2.3 and §2.5 **plus §6.2's custody split and the rule that `root.key` is present on a release host while `ca.key.pem` is not**, `provisioning.md` §4, `manufacturing.md` §1, `security-model.md` §3, and `pkgs/rauc-sign/README.md`'s anchor section | M | `make docs-verify` |
| F11 | Operator documentation: which reset returns the device to the baked default channel (§4.1), stated where a reader meets the reset, not only in the design tree; **and the baked-only source URL's residue (§5) — that the update server is fixed at build time, that changing it needs a new image or an offline import, and what to do when the server is gone** | S | a reader who runs tier 3 was told the channel goes back; a reader whose server has moved finds the two remedies and the stranded case named, not a dead end |

F3 and F4 are the pair that make §1.1's hazard mechanical rather than
conventional, and neither is optional: F3 without F4 proves only that the build
meant well. F2 has the widest blast radius and the least interesting content.
F6 and F6b are the slices with the highest chance of a silent defect, because
getting the parse-error case wrong is invisible until the day it matters, and
because a half-finished move is exactly the two-files-name-the-channel state
the move exists to prevent. They should ship together or not at all.

Compared with the first draft of this record, this backlog replaces one whose
largest and riskiest item was a two-target atomic commit across META and STATE.
That item does not exist here.

## Approval boundary

**This plan ends at an approved seam.** What approval means, exactly:

- `meta/` is a **gitignored, build-host** directory holding the configuration
  and every private key a release needs, generated development-grade when
  absent by the mechanism `ca/` already uses, with `meta.example/` as the
  committed statement of its shape;
- **only two files reach the image**, by allowlist: the RAUC CA certificate and
  `manifest.json`. Every private key is build-host-only, and two checks in two
  places — a build refusal and a packed-root verdict — enforce it;
- `ca/` is absorbed into `meta/rauc/`; the RAUC keyring keeps exactly one
  source, and the package anchor has exactly one source, `trust.signingKeys`
  in the baked manifest;
- there are **two signing domains**: `meta/rauc/` gates the A/B system image,
  and `meta/updates/root.key` is lode's key over the update package. Both gates
  must fall for an attacker to install a system, and `root.key` alone forges a
  package that will not install (§6.2);
- `root.key` is **present** on a release host — it signs every package — while
  `ca.key.pem` stays off it, and no image build touches either;
- `manifest.json` carries the trusted package key **inline**, as a list, with a
  build-derived key id beside it; there is no separate anchor document to ship;
- the three layers of §5.1: `meta/` bakes the source URL, the anchors and the
  channel/policy **defaults**; `/mos/config/updates.json` on DATA is the single
  operator-owned document and overrides the defaults per key; the running state
  configures nothing;
- the source URL and the trust anchors are **not** overridable at runtime, and
  `/var/lib/mos/update-policy.toml` goes away rather than keeping a subset;
- an absent operator layer takes the baked defaults, a malformed one refuses
  the actions and never falls back, and a selected channel the source does not
  publish is reported rather than replaced;
- reset tiers 1 and 3 both return the channel to the baked default, tier 2
  leaves it alone, and that disposition is decided for the `/mos/config/`
  directory rather than inherited (§4.1);
- `/mos/config/` is the **namespace for system configuration of this kind**,
  not a home for one file: one JSON document per subsystem at
  `/mos/config/<subsystem>.json`, machine-written by a daemon and never
  hand-edited, atomic on write, fail-closed on a parse error, holding no
  secret, and re-seeded by reset tiers 1 and 3 (§5.2);
- the boundary against the settings tree is the **baked-default rule**: a
  document belongs in `/mos/config/` if and only if the image bakes a default
  for it in `meta/` (§5.2);
- absence of a server is a supported steady state and there is no default
  server;
- open questions 1–5 are answered before the slices that depend on them
  (question 1 blocks the second deployment, not a slice; question 5 blocks
  nothing until a development TUF repository is wanted).

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
2. **Bake `meta/` verbatim.** The first revision's design, and now the hazard
   rather than the plan: §1.1. Rejected without a price, because there is no
   configuration of it that is safe.
3. **Denylist instead of allowlist** — stage everything under `meta/` except
   files the private-key detectors match. Genuinely close, and cheaper to
   write. Rejected because the default decides the outcome: a file nobody
   anticipated ships, and the detector has to be right about a file nobody has
   seen. An allowlist is wrong in the safe direction — its failure mode is a
   missing file, which is loud.
4. **Keep `ca/` beside `meta/`.** Priced in §6.1: no churn now, two homes for
   private keys forever, both checks written twice, and the user's layout not
   implemented. Re-openable if §6.1's enumerated rename list turns out to be
   incomplete.
5. **Keep `meta/` committed and put the keys somewhere else** — `meta/` for
   configuration, a second gitignored directory for signing material. This is
   the first revision plus a rename, and it preserves the review property §1.2
   gives up. Rejected because it is the layout the user replaced: the
   instruction was that `meta/` carries both, and a design that splits them
   back apart answers a question that was not asked. Named because the property
   it preserves is real.
6. **Keep the package anchor unprovisioned and ship only the update
   configuration.** The smallest possible version of this plan. Rejected: it
   leaves `docs/design/updates.md` §7's owed item owed and leaves
   `rauc-update`'s verifier a tool a person points at a `--root` they brought
   themselves, which is the current state stated honestly and is not a shipped
   update path.
7. **Put the update configuration in the settings tree instead.** Rejected for
   `docs/design/updates.md` §2's unchanged reason — a settings key means a
   schema bump plus a migration, and a concurrent workstream owns the next bump
   — and for a second reason this seam adds: a settings key is per-device
   mutable state, and the trust half of `meta/` must not be. §5.2 turns this
   from a one-off rejection into the rule that decides it for every later
   subsystem.
8. **`/mos/config/<subsystem>/` directories instead of flat documents.**
   Rejected in §5.2: a directory invites several files with no transaction
   across them, so a subsystem can half-apply a change with no way to say so,
   and a flat listing of `/mos/config/` stops being the namespace's index. A
   subsystem that genuinely needs several documents may still take a directory,
   at that stated cost.
9. **Put the operator document inside `/mos/updates/`.** An intermediate
   revision's answer, and it worked — `[^apps-mos]` gives that directory
   durable semantics and `used_bytes` never walks the workspace root. Rejected
   because the properties that made it safe were **accidents of the current
   code rather than stated intent**, so keeping it meant writing three rules
   into a workspace contract to defend one file, and because §4.1's tier-1
   decision is ordinary for a directory and expensive for a file reached inside
   a transactional workspace.
10. **Keep the operator policy on STATE and read only the channel from `/mos`.**
   Rejected, and it is the option the addendum explicitly forbids: two files
   that both name the channel is the defect this campaign has spent its life
   removing. A split with no overlapping key is the weaker version of the same
   objection — one operator-owned concern in two homes, with two failure modes,
   two atomicity stories and two things to reset.
11. **`/mos/update/` as a sibling of `/mos/updates/`.** Rejected on the name
   alone (§5.1): one letter apart, different meanings, silent in both
   directions when somebody writes the wrong one.
12. **Ship the operator document as TOML, matching the file it replaces.** The
   request that settled this named `config.toml` while asking for JSON. JSON is
   what was chosen — the document is machine-written state, not a hand-edited
   file — so the name follows the format and it is `config.json`. Named here
   rather than silently renamed, because a `.toml` file containing JSON fails
   at a reader that parses by extension, and it fails naming the wrong thing.
13. **A single plan covering `meta/`, the update module and the fleet plane.**
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
- 2026-09-03: **Addendum folded in.** The update channel is operator-selectable
  at runtime, read from an operator document on DATA. This split §5 into
  what stays per-build (the source URL and the trust anchors) and what an
  operator changes without a new image (the channel and the rest of the
  policy), turned §5.1 into a three-layer precedence rule, and added §4.1 —
  the operator layer moves from STATE to DATA, so tier 1 no longer returns the
  channel to its default and tier 3 does. The source URL became baked-only,
  which removes an ability `update-policy.toml` has today; §5 states that
  rather than letting it pass as a simplification.
- 2026-09-03: Two names were corrected against the request that asked for them,
  and both corrections are in the record rather than applied silently:
  `/mos/update` would sit one letter from the existing `/mos/updates/`
  workspace, so the configuration goes inside that workspace; and
  `config.toml` holding JSON would fail at a reader that parses by extension,
  so it is `config.json`.
- 2026-09-03: **Revised again, against the concrete layout.** `meta/` holds
  `rauc/`, `updates/manifest.json` and `updates/root.key`, so it carries
  signing material and cannot be committed. Changed: `meta/` is gitignored and
  generated when absent by `gen-dev-keys.sh` with one `meta/GENERATED` marker,
  documented by a committed `meta.example/` (§1.2); M1 and M2 are deleted and
  M3 with them, replaced by an inverse tracked-file refusal and by prohibitions
  re-aimed at the staged set and the image (§1.1–§1.2); **baking is selective
  by allowlist**, held by a build-time refusal and a packed-root verifier,
  because baking verbatim would ship every device the key that signs its
  updates (§1.1); `ca/` is absorbed into `meta/rauc/` rather than kept beside
  it (§6.1 — re-decided against the layout, not defended); `root.key` is
  identified as the TUF root role key among six, with a custody table and the
  rule that it is absent in production (§6.2); the manifest carries a path plus
  a build-derived digest rather than a copy of the public key (§2.1); and §7
  spells out what a fresh checkout does when `meta/` is absent. **Withdrawn**:
  the claim that the configuration and the credential host list are reviewable
  in a diff (§2). **Deliberately unchanged**: the three-layer precedence of
  §5.1 and the operator document on DATA, §4.1's reset consequence, the
  no-default-server rule and its check, §4's survival analysis, PLAN-071's
  `off | check | auto` semantics and PLAN-072's outbound-only boundary. The
  title changed again with this revision; `docs/plan/index.md`'s row is owed
  the change and is deliberately not edited here.
- 2026-09-03: **Two rulings recorded, one of them since superseded.** The
  source URL being baked-only is accepted — which repository a device fetches
  from is a trust decision and belongs with the anchors — and its residue is
  owed to the operator page on F11 rather than living only in this record. The
  other ruling put the operator document inside `/mos/updates/` and attached
  three written rules to make that location safe; the annotation below
  supersedes it.
- 2026-09-03: **Five decisions from the user folded in.** (1) `ca/` is
  abandoned; the absorb call and its enumerated rename list stand. (2)
  `meta/updates/root.key` is **lode's key over the update package**, not the
  TUF root-role key this record previously called it. §6.2 is rebuilt around
  the two domains — `meta/rauc/` gates the system image, `root.key` gates the
  package — and states the blast-radius split: both gates must fall to install
  a system, and `root.key` alone forges a package that will not install. Three
  conclusions were re-derived rather than adjusted: `meta/updates/online/` is
  gone, the manifest carries the trusted key **inline** rather than a pin on a
  document (§2.1, including which objection had to be answered differently and
  how), and the baked public set dropped from three files to two (§1.1, §3).
  The mechanism the key signs with is open question 6, which this record
  deliberately does not close by implication. (3) `manifest.json` is lode's;
  the mapping table now marks two rows as **changed** and two mos fields as
  **extensions** with their justification. (4) The operator document moves to
  `/mos/config/updates.json`; the previous ruling that kept it inside the
  workspace, and the three written rules that made that location safe, are
  dropped with it. (5) `/mos/config/` is established as the **namespace** for
  system configuration of this kind: flat `<subsystem>.json`, JSON,
  machine-written by one daemon, atomic, fail-closed, secret-free, its
  `mos-data-layout` entry at 0755, its reset disposition decided for the
  directory (§4.1 — tier 1 now re-seeds it, which re-derives the previous
  revision's answer and removes the behaviour regression it had accepted), and
  a boundary against the settings tree stated as a rule a reader can apply: a
  document belongs here **if and only if** the image bakes a default for it in
  `meta/`. Two weaker lines are named and rejected, including the one proposed
  in review, because the settings tree's existing `mqtt` key falsifies it.
  Unchanged: the hazard sentence, the allowlist bake with B1/B2, the three-test
  detector and its scoped surface, the gitignored `meta/` with `meta.example/`,
  the withdrawn diff-review claim, the fresh-checkout behaviour, the
  no-default-server rule, and PLAN-071/072's invariants.
