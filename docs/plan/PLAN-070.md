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
moved the operator document to `/mos/updates/config.json` on DATA (§5.1). Both
stand.

**This revision answers the concrete layout the user has now given**, and that
layout invalidates two load-bearing decisions the first revision made:

```text
meta/rauc/                    the RAUC key
meta/updates/manifest.json    update configuration: server info, and the signing PUBLIC key
meta/updates/root.key         the update signing PRIVATE key, used locally to sign update bundles
```

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
- **Four ed25519 keys, one per TUF role, stored as raw PKCS#8 named
  `<role>.pk8`.** `docs/design/release-signing.md` §1.2 and §1.5: `root.pk8` is
  offline and signs `root.json` at `init` and at the republish ceremonies only;
  `targets.pk8`, `snapshot.pk8` and `timestamp.pk8` live on the release host
  and sign every release. **These files are binary DER, not PEM** — which is
  why the previous revision's M2, a grep for PEM private-key armour, would have
  been blind to exactly the file the user's layout names (§1.1).
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
- **An update workspace on DATA, already namespaced.** `mos-data-layout`
  creates `/mos/updates/{downloads,verified,staging}` (PLAN-063), and
  `docs/design/recovery.md` §2.1's `[^apps-mos]` footnote already carves
  `updates/` out of tier 2 by name. That directory is where §5.1 puts the
  operator's layer, and the carve-out is why it can go there at all.
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
meta/updates/root.json           pinned TUF root document       PUBLIC  -> image
meta/updates/root.key            TUF root role private key      SECRET  -> never
meta/updates/online/*.key        TUF targets/snapshot/timestamp SECRET  -> never
meta/GENERATED                   development-grade marker       host only
```

`ca/` is absorbed into `meta/rauc/` rather than kept beside it; §6 is the
decision and prices the alternative. The six private keys are six different
roles with six different blast radii, and §6.1 refuses to let one filename
stand for several.

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

**If `meta/` were baked verbatim — which is what the previous revision
specified — every shipped device would carry `meta/updates/root.key` and
`meta/rauc/ca.key.pem`, the private keys that sign its own updates, so anyone
who obtained one device could extract them and sign an update that every other
device in the fleet verifies, installs and trusts.**

That is fleet-wide remote code execution reachable by buying one unit. It is
not a consequence of a careless implementation; it is the direct reading of
"bake `meta/` into the image" applied to the layout as given. Hence:

**The public set — the only files that reach the image:**

| File in `meta/` | Path in the image | What it is |
|---|---|---|
| `meta/rauc/ca.cert.pem` | `/etc/rauc/keyring.pem` | the RAUC keyring: the CA certificate devices verify bundle CMS signatures against. Unchanged from today, including the path, which RAUC's own `system.conf` names |
| `meta/updates/root.json` | `/usr/share/mos/meta/updates/root.json` | the pinned TUF root document — public, signed, self-describing, rotatable |
| `meta/updates/manifest.json` | `/usr/share/mos/meta/updates/manifest.json` | the §4 configuration, which by schema holds no secret |

**The build-host-only set — everything else, and it never leaves:**
`ca.key.pem`, `signer.key.pem`, `signer.cert.pem`, `root.key`, `online/*.key`,
`GENERATED`, and **any file not named above**.

**Allowlist, not denylist, and this is the whole mechanism.** The staging step
enumerates the three public files by name and copies those. A denylist would
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
- **`--domain updates`**: generates `meta/updates/root.key` and
  `meta/updates/online/*.key` with `rauc-sign gen-dev-keys`, then a development
  `root.json` via `rauc-sign init`. **Not automatic**, for two reasons worth
  stating rather than discovering: it needs the `rauc-sign` binary, so wiring
  it into `--if-absent` puts a cargo build in the image path; and a TUF root
  that anchors a repository nobody has published is ceremony without content.
  **Absent update material is a supported steady state** — the same steady
  state as an absent `update.source` (§7). The build says so in one line and
  continues: *no update anchor baked; this image cannot verify an update
  repository until `meta/updates/root.json` exists*.

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
    "tufRoot":       "updates/root.json",
    "tufRootSha256": "<derived by the build from those bytes>"
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

#### 2.1 The public key in the manifest: a pin, not a copy

The layout says `manifest.json` carries "the signing PUBLIC key". The public
half of `meta/updates/root.key` is **already stated** — signed, versioned,
threshold-bearing and expiring — inside `meta/updates/root.json`. That is what
a TUF root document is *for*: a bare public key has no expiry, no threshold and
no rotation rule, which is the same reason the table below declines lode's
inline `trusted_keys` list.

A second inline copy in `manifest.json` would therefore be **a second statement
of one fact**, unsigned, with no rule for what a device does when the two
disagree. It is dropped. What the manifest carries instead is a **pin on** that
statement:

- `trust.tufRoot` — the path, so the manifest names which anchor this image is
  built against;
- `trust.tufRootSha256` — the digest of exactly those bytes, **derived by the
  build**, with a hand-written mismatch failing the build. A derived value
  cannot become a second truth, and it makes the manifest self-checking: an
  image whose `root.json` was swapped after the manifest was written fails
  before it ships.

That digest is not a new artefact. It is the same number
`docs/design/release-signing.md` §1.5 already tells the root ceremony to record
in its minutes and distribute out of band, so an operator comparing the two is
performing a check the runbook already describes, with no new procedure. And a
reader who wants the key bytes themselves has `root.json` beside it.

Two of those keys are **owned** by `meta/` and two are **defaults**, and the
difference is §5's whole subject. `update.source` and everything under `trust`
are owned: no runtime layer can override them, and the operator document of
§5.1 has no key that names them. `update.channel`, `update.policy` and
`update.checkIntervalMinutes` are the values a device uses **until an operator
chooses otherwise**, and the operator can choose otherwise without a new
image.

| lode `lode.toml` | mos `meta/updates/manifest.json` | Verdict |
|---|---|---|
| `[update] manifest = <url>` | `update.source` | **Adopt the role, rename the key.** Both name the one place releases are discovered; lode's is a `lode/v1` JSON feed and mos's is a TUF repository root, so the same name would mislead |
| `[update] channel` | `update.channel` | **Adopt verbatim, as the default.** The operator overrides it at runtime (§5.1); lode's is an operator file to begin with, so this is the same key doing the same job one layer down |
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
`meta/updates/manifest.json` enumerates none of that, because all of it lives in signed
TUF `targets.json` on the server. Baking a copy of a release catalog into an
image would freeze a moving fact at build time and produce a second, always
staler answer to a question the update client already asks correctly. What is
baked is the *configuration for asking* — where, which channel, under what
policy, against which root — and nothing that the server is authoritative for.

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
meta/updates/root.json        →  /usr/share/mos/meta/updates/root.json        0644 root:root
meta/updates/manifest.json    →  /usr/share/mos/meta/updates/manifest.json    0644 root:root
```

Three files, by name, and nothing else — §1.1 is why this is an enumeration
rather than a directory copy.

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

**The consequence, taken deliberately:** `rauc-update`'s default anchor path
moves from `/usr/share/mos/uptane/root.json` to
`/usr/share/mos/meta/updates/root.json`. That path is `[not implemented]`
today — no shipped mechanism delivers a root to either location — so nothing is
broken by moving it, and the alternative (bake it *and* copy it to the old
path) would put the same anchor in two places, which is two truths and one of
them eventually stale.

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

#### 4.1 The operator layer's row, which is a different column and a real change

§5.1 puts the operator's own update configuration in `/mos/updates/config.json`
on DATA. That is the `DATA (/mos)` column, which is already in the table, so
again no row and no column is invented — but the *document moves columns*, and
that changes which reset takes an operator's channel choice away. Stated as the
before-and-after it is:

| Tier | Update policy today, on STATE | Operator layer under `/mos/updates/` |
|---|---|---|
| 1 configuration reset | **re-seeded** — the operator's channel goes back to the default | **preserved** — the choice survives |
| 2 application-data reset | preserved | **preserved**, via `[^apps-mos]`'s carve-out |
| 3 full factory reset | re-seeded | **re-seeded** — the choice goes back to the baked default |
| 4 secure wipe | cleared | cleared |

**So the answer to "which reset takes the channel away" is tier 3 and tier 4,
and it used to also be tier 1.** That is a real behaviour change with a real
argument on each side, and the record picks rather than hiding it: a channel
selection is not part of the modelled settings tree that tier 1 re-seeds, and
it has never been in it, so tier 1 losing it is consistent with what tier 1
promises. The cost is that tier 1's prose says *configured as it left the
factory*, and after this move a tier-1 reset leaves the device on whichever
channel the previous operator chose.

**The record does not answer that by special-casing tier 1.** Teaching
`reset.rs` to reach one file inside `/mos/updates/` would give the applier a
fourth root it does not have and would contradict `[^apps-mos]`'s framing of
`/mos` as the system-owned namespace. Instead, *return to the baked default
channel* is an explicit action on the update surface — clearing the operator
layer — which is a thing the console needs regardless and which says what it
does. A reset tier is not the place to discover it.

**One debt this creates, and it is the kind that goes unnoticed.**
`[^apps-mos]` currently carves `updates/` out of tier 2 with the reason *"a
verified bundle is not application data"*. After this plan the directory also
holds a configuration document, so the cell stays right and its stated reason
stops covering everything it protects. The footnote owes one clause — the
update subsystem's own state, configuration included, is not application data
either — and F10 carries it. A table whose cells are correct for reasons that
no longer describe their contents is how a later editor deletes the right
answer.

### 5. The cost: which facts are per-build, and which the operator changes

The previous draft of this section said "baked means a rebuild" and left it
there. That is no longer true of everything, and the honest split matters more
than the slogan.

**Per-build, and not changeable on a running device:**

- the update source URL (`update.source`);
- the trust anchors — the RAUC keyring staged from `meta/rauc/ca.cert.pem`,
  and the pinned TUF root `meta/updates/root.json`.

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
   not have.

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
2. **`/mos/updates/config.json`, on DATA.** Operator-owned, machine-written,
   survives every A/B update and every slot rollback because DATA is neither;
   cleared by the reset tiers §4.1 names.
3. **The running state.** What the lifecycle actually did — `idle`, `checking`,
   `ready`, `reboot-required` and the rest. It configures nothing; it is the
   record of what happened, and it is in this list only so that a reader stops
   looking for a fourth place a channel could come from.

| Key | Layer 1 baked from `meta/` | Layer 2 `/mos/updates/config.json` | Rule |
|---|---|---|---|
| update source URL | **owns it** | no such key | baked only; not overridable, and the schema is what says so |
| RAUC keyring, TUF root | **own them** | no such key | baked only; not overridable |
| channel | default | **overrides** | layer 2 wins; absent → the baked default |
| `policy`, `checkIntervalMinutes` | default | **overrides** | layer 2 wins; absent → the baked default |
| `rebootPolicy`, windows, network mode, reboot-gate keys | not present | **owns them** | layer 2 only; absent → the code defaults |

**Where layer 2 lives, and why not one letter away.** The user's request named
`/mos/update`. `/mos/updates/` — plural — already exists as the update
workspace, created by `mos-data-layout` and holding `downloads/`, `verified/`
and `staging/`. Shipping a configuration path one letter from it guarantees
somebody writes the wrong one, and the mistake would be silent in both
directions. **The configuration goes inside the existing workspace**, at
`/mos/updates/config.json`: one directory then owns everything the update
subsystem keeps on DATA, the name is already carved out of tier 2 by
`[^apps-mos]`, and the three neighbours are directories while this is a file,
so the two cannot be confused even at a glance.

**What becomes of `/var/lib/mos/update-policy.toml`: it goes away.** Not split,
not kept for a subset — **moved wholesale**, because two files that both name
the channel is the defect this campaign exists to remove, and a split with no
overlap would still be two homes for one operator-owned concern. Layer 2 is
today's policy document minus exactly the two keys that moved up to layer 1:
`source.url` (per §5, now baked) and `source.rootPath` (the anchor, now
`meta/updates/root.json`). `channel`, `repoDir`, `statePath`, `maxBytes`,
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
  different refusals. After the move, the workspace readiness probe that
  already exists gates both, and there is one answer to "can this device
  update".
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

#### 6.2 `meta/updates/root.key` is the TUF **root role** key, and here is what it is not

The layout names one key file where a release needs **six** private keys across
**two independent hierarchies**. Letting one filename stand for several roles is
the failure this section prevents; they have different rotation rules and
different blast radii.

| File | Hierarchy | Signs | If stolen | Rotation |
|---|---|---|---|---|
| `meta/rauc/ca.key.pem` | RAUC X.509 | signer certificates | mint a signer the fleet already trusts; every device installs your bundles until reflash | `release-signing.md` §2.4 rollover with an overlap window; a *compromised* CA is §2.3's uncovered case and needs a reflash |
| `meta/rauc/signer.key.pem` | RAUC X.509 | the bundle's CMS signature | sign bundles while the certificate is valid | §2.2 reissue — cheap, needs the CA key, no fleet update, because devices trust the CA |
| `meta/updates/root.key` | TUF | **`root.json` only — never a release** | re-anchor the whole update metadata hierarchy: bind attacker-controlled online keys and have pinned devices walk forward to them | `rotate-root` cross-signs, so a pinned device follows with nothing shipped to it; `refresh-root` for expiry alone |
| `meta/updates/online/targets.key` | TUF | the metadata pinning each release | offer a device an attacker-chosen target | `rotate-online`, no distribution |
| `meta/updates/online/snapshot.key` | TUF | the metadata index | freeze or mix metadata versions | `rotate-online` |
| `meta/updates/online/timestamp.key` | TUF | freshness | withhold updates | `rotate-online` |

**Why `root.key` is the root role and not the bundle signer.** The bundle
signer already exists, is X.509, and cannot be a bare `.key` without losing the
certificate that makes it verifiable — it is `meta/rauc/signer.key.pem`. The
directory `updates/` is the TUF trust domain, `root` is TUF's role name, and
§2.1's public-key field is a statement about the anchor. The user's phrase
"used locally to sign update bundles" describes the *release flow this
repository performs* — build a bundle, CMS-sign it, publish it into the TUF
repository — which touches four keys, and `root.key` is the one that makes the
repository anchorable at all. It is **not** a delegation key: `rauc-sign` has
delegated targets roles explicitly out of scope, and `rauc-verify` refuses
targets metadata carrying them.

**`meta/updates/online/` is an addition the layout implies rather than
states.** `rauc-sign add` and `rauc-sign sign` load the three online keys on
every release; without a home they would arrive from somewhere this record does
not name. They sit under their own directory because their custody differs —
the root key is offline material, the online keys live on the release host.

**The production shape: `root.key` is absent.** `rauc-sign init` is the only
command that loads it, and no image build touches it.
`docs/design/release-signing.md` §2.5 already establishes the pattern for the
other hierarchy: a production build host carries `signer.key.pem` and
explicitly **not** `ca.key.pem`. The same rule applies here. A production tree
holds `meta/rauc/{ca.cert,signer.cert,signer.key}.pem`,
`meta/updates/{manifest.json,root.json}` and `meta/updates/online/*.key`, and
**neither `ca.key.pem` nor `root.key`**, both of which stay on offline media
between ceremonies. `root.key` in the tree is a development convenience, and no
tool this plan designs may require it to be present.

**The consequence of one directory, said plainly.** A development tree holding
all six keys is a tree where one host compromise yields **both** hierarchies —
the RAUC CMS gate and the TUF metadata gate, which exist precisely so that
neither alone suffices to install code. `ca/` today already holds both RAUC
keys, so what changes is that the TUF half joins them. That is acceptable for a
development tree and is exactly why the paragraph above makes the two offline
keys absent in production.

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

**The TUF root: one place, so precedence has nothing to arbitrate.** A TUF
repository has exactly one root, which is why a union is meaningless for it —
two pinned roots are two repositories. There is exactly one source,
`meta/updates/root.json`; `trust.tufRoot` names a file *inside* `meta/`, and
naming a path outside it is a build error.

**The tradeoff that comes with picking the image-baked candidate**, which
`pkgs/rauc-sign/README.md` already states and which this plan accepts rather
than restates as new: the root is exactly as trustworthy as the image carrying
it, so first trust and re-anchoring both ride the RAUC channel, and **the TUF
hierarchy cannot outlive a compromise of the image signing path — the two
hierarchies stand or fall together.** What is bought is that the root does not
have to be replaced to follow a rotation; a pinned device walks the
cross-signed root chain forward on its own, so an image update is needed only
to re-anchor a device whose chain is broken. §6.2's storage consequence is the
same statement one layer down.

**What this does not close.** The two cases `docs/design/release-signing.md`
§2.3 names as uncovered by an image-carried keyring stay uncovered: a device
that missed a CA rollover's overlap window, and rotation away from a CA that is
already compromised. Both still need a reflash. Open question 2 is where a
later device-time channel would land.

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
3. No `meta/updates/root.json` exists, so no anchor is baked and the build says
   so in one line (§1.2). This is not an error: with no source configured there
   is no repository to anchor to.
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
release claims — and `trust.tufRootSha256` (§2.1) makes the anchor checkable
against the ceremony minutes without an API call at all.

Three facts should read side by side wherever this surfaces: the **baked**
value, the **operator** value from `/mos/updates/config.json`, and the
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
   carries configuration and two anchors. The pressure to add per-device values
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
   it opt-in because it needs `rauc-sign` in the image path and produces an
   anchor for a repository nobody has published. If a development TUF
   repository becomes part of the standard loop, this flips and the cargo
   dependency has to be priced.

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
- **`/mos/updates/config.json` beside `downloads/`, `verified/`, `staging/`.**
  Putting configuration inside a workspace is the right call for the naming
  reason §5.1 gives, and it does mean the `maxBytes` budget, the workspace
  probe and the cleanup paths all now share a directory with a file that must
  never be deleted as scratch. Anything that sweeps that directory has to know
  the difference.
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
- **Baking the TUF root ties the two hierarchies together** (§6.3). A compromise
  of the image signing path compromises the anchor for the TUF path as well.
  This is the accepted cost of the candidate chosen, it is the one
  `pkgs/rauc-sign/README.md` names, and open question 2 is where the mitigation
  would go.

## Scope

In scope: `meta/`'s layout and its split into a baked public set and a
build-host-only set; the allowlist and the two checks that hold it; the
absorption of `ca/`; the identity and custody of each of the six private keys;
`meta/updates/manifest.json`'s schema, its mapping from lode's `lode.toml`, and
the form the anchor's public half takes in it; `meta/` being gitignored, the
committed `meta.example/`, and generation when absent; the image paths and the
byte-equality gate; the three layers and the one precedence rule between them,
including where the operator layer lives and what becomes of the STATE policy
file; the no-default-server rule, the channel rules and their verifier check;
the read surface.

Out of scope: the update policy semantics (PLAN-071); anything the fleet switch
turns on (PLAN-072); the per-device manufacturing record
(`docs/design/manufacturing.md` stays `[proposed]`); a device-time trust
channel (open question 2); hosting for the TUF repository, which
`docs/design/release-artifacts.md` records as open; the META partition, which
this plan does not touch.

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
| F6b | Move the operator document: `/var/lib/mos/update-policy.toml` retired, `/mos/updates/config.json` in its place, `source.url` and `source.rootPath` dropped from its schema | M | the channel is readable from exactly one file; a document naming a source URL is a load error |
| F7 | `rauc-update` reads `trust.tufRoot`; its default anchor path moves; `trust.tufRootSha256` derived at build time | S | a `tufRoot` naming a path outside `meta/` is a build error; a hand-edited digest that does not match `root.json` fails the build |
| F8 | No-compiled-in-endpoint verifier check | S | fails a build with a planted default URL in a binary; passes with one in `meta/` |
| F9 | `GET /api/v1/provisioning/status` extension: the document, the digests, and baked-versus-effective | S | — |
| F10 | Design-doc updates: `recovery.md` §2.1's clarifying note **and `[^apps-mos]`'s extended reason (§4.1)**, `updates.md` §2 (the policy file's tier, its new home and format) and §7, `release-signing.md` §2.3 and §2.5, `provisioning.md` §4, `manufacturing.md` §1, `security-model.md` §3, and `pkgs/rauc-sign/README.md`'s anchor section | M | `make docs-verify` |
| F11 | Operator documentation: which reset returns the device to the baked default channel (§4.1), stated where a reader meets the reset, not only in the design tree | S | a reader who runs tier 3 was told the channel goes back |

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
- **only three files reach the image**, by allowlist: the RAUC CA certificate,
  the pinned TUF root, and `manifest.json`. Every private key is
  build-host-only, and two checks in two places — a build refusal and a
  packed-root verdict — enforce it;
- `ca/` is absorbed into `meta/rauc/`; the RAUC keyring keeps exactly one
  source, and the TUF root has exactly one source, `meta/updates/root.json`;
- `meta/updates/root.key` is the **TUF root role** key, absent on a production
  release host, and no tool may require it to be present to build an image or
  publish a release;
- `manifest.json` carries a **pin on** the anchor — its path plus a
  build-derived digest — never a copy of the key;
- the three layers of §5.1: `meta/` bakes the source URL, the anchors and the
  channel/policy **defaults**; `/mos/updates/config.json` on DATA is the single
  operator-owned document and overrides the defaults per key; the running state
  configures nothing;
- the source URL and the trust anchors are **not** overridable at runtime, and
  `/var/lib/mos/update-policy.toml` goes away rather than keeping a subset;
- an absent operator layer takes the baked defaults, a malformed one refuses
  the actions and never falls back, and a selected channel the source does not
  publish is reported rather than replaced;
- tier 3 returns the channel to the baked default and tier 1 no longer does
  (§4.1);
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
6. **Keep the TUF anchor unprovisioned and ship only the update
   configuration.** The smallest possible version of this plan. Rejected: it
   leaves `docs/design/updates.md` §7's owed item owed and leaves
   `rauc-update`'s verifier a tool a person points at a `--root` they brought
   themselves, which is the current state stated honestly and is not a shipped
   update path.
7. **Put the update configuration in the settings tree instead.** Rejected for
   `docs/design/updates.md` §2's unchanged reason — a settings key means a
   schema bump plus a migration, and a concurrent workstream owns the next bump
   — and for a second reason this seam adds: a settings key is per-device
   mutable state, and the trust half of `meta/` must not be.
8. **Keep the operator policy on STATE and read only the channel from `/mos`.**
   Rejected, and it is the option the addendum explicitly forbids: two files
   that both name the channel is the defect this campaign has spent its life
   removing. A split with no overlapping key is the weaker version of the same
   objection — one operator-owned concern in two homes, with two failure modes,
   two atomicity stories and two things to reset.
9. **`/mos/update/` as a sibling of `/mos/updates/`.** Rejected on the name
   alone (§5.1): one letter apart, different meanings, silent in both
   directions when somebody writes the wrong one.
10. **Ship the operator document as TOML, matching the file it replaces.** The
   request that settled this named `config.toml` while asking for JSON. JSON is
   what was chosen — the document is machine-written state, not a hand-edited
   file — so the name follows the format and it is `config.json`. Named here
   rather than silently renamed, because a `.toml` file containing JSON fails
   at a reader that parses by extension, and it fails naming the wrong thing.
11. **A single plan covering `meta/`, the update module and the fleet plane.**
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
  at runtime, read from `/mos/updates/config.json` on DATA. This split §5 into
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
