# PLAN-070 Design the meta/ seam: signing material on the build host, a public subset baked into the image

- **status**: draft
- **createdAt**: 2026-09-03 11:11
- **approvedAt**: (pending)
- **relatedTask**: (none — design only; task records are owed on approval)

## Context

### The correction this revision has to make first

The previous revision of this record designed `meta/` as a **committed,
secret-free** directory, held to that by three build-time refusals (every file
tracked by git; no private-key armour; no certificate), and **baked verbatim**
into the image at `/usr/share/mos/meta/`.

The user has since given the concrete layout, and it invalidates both of those
decisions:

```text
meta/rauc/                    the RAUC key
meta/updates/manifest.json    update configuration: server info, and the signing PUBLIC key
meta/updates/root.key         the update signing PRIVATE key, used locally to sign update bundles
```

`meta/` is now the single directory carrying **configuration and signing
material together**. Two consequences follow immediately, and the second is the
reason this revision exists:

1. **`meta/` cannot be committed.** It holds private keys. It becomes what
   `ca/` is today — gitignored, generated when absent, never in history. The
   rules M1 (every file tracked) and M2 (no private-key armour, scoped to the
   directory) are **deleted**, not weakened: a rule saying every file under
   `meta/` is tracked cannot survive a directory whose whole point includes an
   untracked key. §2 says what replaces them.
2. **Baking `meta/` verbatim would ship the fleet its own signing keys.** §1.1
   states that hazard in one sentence and the rest of §1 designs against it.
   This is the load-bearing change in this revision; everything else is
   consequence.

What is *not* re-opened: the seam is still a **build-time input directory in
this repository**, not a partition, not a provisioning payload and not
something a device is handed after it is built. The META partition is still
untouched. The operator layer on STATE, the precedence rule, and the
no-default-server rule are unchanged and are re-stated below only where the
layout makes a sentence false.

### `meta/` is not the META partition

The repository directory `meta/` and the on-device **META partition** mounted
at `/mnt/meta` are unrelated, and the name collision is real enough to trip a
reader who knows the partition table. This record uses `meta/` for the
repository directory only. **No part of this plan writes to, reads from, or
changes the meaning of the META partition**, which continues to hold RAUC's
`rauc.status` and nothing else.

### What the tree already has

- **A gitignored directory of signing material that the build generates when
  it is absent.** `ca/` holds `ca.cert.pem`, `ca.key.pem`, `signer.cert.pem`
  and `signer.key.pem`. `rootfs/build.sh` runs `pkgs/rauc/gen-dev-keys.sh
  --if-absent` before staging, and that script generates a development-grade
  root, prints a loud non-fatal notice, and drops `ca/GENERATED` — a marker
  that keeps the material flagged development-grade **forever after**, not only
  in the run that made it. Production material is placed in `ca/` by an
  operator *without* the marker. This is the exact mechanism §2 reuses; the
  plan does not invent a second one.
- **Exactly one public file from that directory reaches the image.**
  `rootfs/build.sh` copies `ca/ca.cert.pem` to `/etc/rauc/keyring.pem`. The
  three private-or-host-only files stay on the build host. **Selective baking
  is therefore not a new idea in this tree — it is what `ca/` already does**,
  and this plan's job is to keep that property while the directory grows.
- **A build that refuses a second source for a trust root.**
  `rootfs/build.sh` rejects an `etc/rauc/keyring.pem` found in the overlay,
  unconditionally and unwaivably, because the overlay is copied wholesale into
  every image and a file left there is a CA that arrives *by being forgotten*.
- **A verifier check that holds the outcome, not the intent.**
  `packed-keyring-from-ca` (`verify/src/checks-root.ts`) asserts the shipped
  keyring is **byte-equal** to `ca/ca.cert.pem`, and **throws** rather than
  passing when there is no `ca/` to compare against, because "nothing to
  compare" is a statement about the run. `rauc-keyring-path`
  (`verify/src/checks-rauc.ts`) asserts the rendered `system.conf` names
  exactly one keyring path. §1.3 copies this shape.
- **A TUF hierarchy whose anchor is unprovisioned.** `pkgs/rauc-sign` builds
  and verifies the four-role repository (`root`, `targets`, `snapshot`,
  `timestamp`) and `rauc-update` walks it, but **no shipped mechanism puts
  `root.json` on a device.** `pkgs/rauc-sign/README.md` records three candidate
  paths and picks none; `docs/design/updates.md` §7 lists the anchor among the
  deployment contract still owed. **This plan picks the first candidate** —
  image-baked — and §3 states the tradeoff the README already names for it.
- **Four ed25519 keys, stored as raw PKCS#8, one per role, named
  `<role>.pk8`.** `docs/design/release-signing.md` §1.2 and §1.5: `root.pk8`
  is offline and signs `root.json` at `init` and at the republish ceremonies
  only; `targets.pk8`, `snapshot.pk8` and `timestamp.pk8` live on the release
  host and sign every release. **These files are binary DER, not PEM.** That
  is not trivia — it is why the previous revision's M2, a grep for PEM
  private-key armour, would have been blind to exactly the file the user's
  layout names (§1.3).
- **A production runbook that already says the private half stays away.**
  `docs/design/release-signing.md` §2.5 provisions a build host with
  `ca.cert.pem`, `signer.cert.pem` and `signer.key.pem`, and states plainly
  that `ca/ca.key.pem` does **not** exist there. §3.2 generalises that rule to
  the TUF root key.
- **A build-fact directory in the image.** `/usr/share/mos/` holds
  `manifest.tsv` and `release-identity.env` (`BOARD`, `PROFILE`, `VERSION`,
  `COMMIT_DATE`) — facts *about the build*, read by mosd and `rauc-update`,
  inside the read-only root. §1.2 is why the baked public set belongs beside
  them.
- **Update configuration on STATE.** `update-policy.toml`, read fresh on every
  decision by `pkgs/mosd/mosd/src/update_policy.rs`. `source.url` has **no
  default** — an unset URL means no online source, and the offline import path
  remains. That absence is load-bearing and this plan preserves it (§7).
- **A reset taxonomy in which the root filesystem already has its answer.**
  `docs/design/recovery.md` §2.1's columns include `system slot A` and
  `system slot B`; `pkgs/mosd/mosd/src/reset.rs`'s `Roots` type reaches the
  DATA pool and STATE and has no member for a slot. §6 is why that means this
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

Its `manifest.json` (`lode/v1`) is the *remote* release feed. §4 adopts its
document conventions — a `schema` tag first, one JSON object, no implicit
defaults — for a **local** document, and says where mos's whole-system RAUC
bundles make lode's per-app asset vocabulary inapplicable.

### What is missing

There is no place in this repository that says *where this image's updates come
from, which channel it defaults to, which trust roots it honours beyond the
RAUC CA, and whether it may talk to a fleet plane* — and that ships inside the
artifact. Every one of those is per-deployment configuration that today has
nowhere to live except an operator's hands after the device is already running.
And there is no single home for the signing material that produces a release:
the RAUC half lives in `ca/`, the TUF half lives nowhere in the tree at all.

## Proposal

### 1. The layout, the hazard, and what reaches the image

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

#### 1.1 The hazard this section exists to prevent

**If `meta/` were baked verbatim, every shipped device would carry
`meta/updates/root.key` and `meta/rauc/ca.key.pem` — the private keys that sign
its own updates — so anyone who obtained one device could extract them and sign
an update that every other device in the fleet verifies, installs and trusts.**

That is a fleet-wide remote code execution reachable by buying one unit. It is
not a hypothetical consequence of a careless implementation: it is the direct
reading of "bake `meta/` into the image" applied to the layout as given, which
is why the rule below is an **allowlist** and why §1.3 checks it twice.

#### 1.2 Two sets, and the allowlist that separates them

**The public set — the only files that reach the image:**

| File in `meta/` | Path in the image | What it is |
|---|---|---|
| `meta/rauc/ca.cert.pem` | `/etc/rauc/keyring.pem` | the RAUC keyring: the CA certificate devices verify bundle CMS signatures against. Unchanged from today, including the path, which RAUC's own `system.conf` names |
| `meta/updates/root.json` | `/usr/share/mos/meta/updates/root.json` | the pinned TUF root document — public, signed, self-describing, rotatable |
| `meta/updates/manifest.json` | `/usr/share/mos/meta/updates/manifest.json` | the update configuration of §4, which by schema holds no secret |

**The build-host-only set — everything else, and it never leaves:**
`ca.key.pem`, `signer.key.pem`, `signer.cert.pem`, `root.key`, `online/*.key`,
`GENERATED`, and **any file not named above**.

**Allowlist, not denylist, and this is the whole mechanism.** The staging step
enumerates the three public files by name and copies those. A denylist would
pattern-match the secrets and copy the rest, which means a file nobody
anticipated ships **by default** — and the default is what decides the outcome
on the day somebody adds `meta/updates/notes-for-the-release-host.txt`. Under
an allowlist a new file is invisible to the image until someone adds a line to
the allowlist, in a diff, with a reviewer.

`signer.cert.pem` is public and still does not ship: the device never needs it,
because RAUC gets the signer certificate from the bundle's own CMS structure
and chains it to the keyring. A file that ships for no reason is a file whose
removal nobody can later justify.

**`/usr/share/mos/`, and not `/etc/`.** `/usr/share/mos/` already holds exactly
this kind of thing — `manifest.tsv` and `release-identity.env` are build facts
that mosd and `rauc-update` read and nothing on the device writes. `/etc/` is
where an operator reasonably expects to be able to edit a file; putting an
unwritable configuration document there would invite an edit that silently does
nothing. `/etc/rauc/keyring.pem` is in `/etc` only because RAUC's own
configuration names that path.

**Inside the read-only dm-verity root**, which is the point: the configuration
and the anchors are covered by the same signature and the same block-level
integrity as the code that reads them.

#### 1.3 Two mechanical checks, in two places, for two different questions

One check is not enough, and the reason is not belt-and-braces: the two answer
different questions and fail on different days.

- **B1 — the build refuses to stage a secret. Proves the *intent*.** In
  `rootfs/build.sh`, in the shape its overlay-keyring refusal already uses — a
  hard `error:` naming the offending file, a paragraph saying why the rule
  exists, `exit 1`, and **no waiver flag**, for build.sh's own stated reason
  that a waiver reintroduces the second source the rule exists to forbid. It
  fires when a staged path is not on the §1.2 allowlist, and independently when
  any file about to be staged carries private key material.
- **B2 — the verifier refuses an image that contains one. Proves the
  *outcome*.** Over the packed root, in `packed-keyring-from-ca`'s exact shape,
  including its throw-on-nothing-to-compare guard. B1 cannot see material that
  arrives by a route other than staging — an overlay file, a package
  `postinst`, a stray `cp` in a future slice. B2 does not care how it got
  there.

**What "carries private key material" means, stated concretely, because the
obvious spelling is wrong here.** The previous revision's M2 grepped for PEM
private-key armour. The TUF keys are **raw PKCS#8 DER** (`docs/design/release-signing.md`
§1.2), so an armour grep is blind to `root.key` — the single file the hazard is
named after. The detector is therefore three tests, any of which is a refusal:

1. PEM private-key armour: `BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`,
   `BEGIN EC PRIVATE KEY`, `BEGIN ENCRYPTED PRIVATE KEY`, `BEGIN OPENSSH PRIVATE KEY`.
2. A DER PKCS#8 `PrivateKeyInfo` header, which is what `rauc-sign gen-dev-keys`
   writes.
3. A filename in a key container extension: `.key`, `.pk8`, `.p12`, `.pfx`, `.jks`.

**B2's scope is the paths this seam creates**, `/usr/share/mos/meta/` and
`/etc/rauc/` — not the whole packed root. A whole-root scan would fire on
Debian packages that legitimately ship key-shaped test fixtures, and a check
whose findings are usually false is a check people learn to pass. The seam's
own paths are mos-owned, closed, and always populated (a keyring, a root
document, a manifest), so "scanned N files, found no private material" is a
real measurement rather than a vacuous one.

B2 is two verdicts, not one:

- **`packed-meta-is-the-public-set`** — `/usr/share/mos/meta/` contains exactly
  the allowlisted files, each byte-equal to its source in `meta/`: no extra
  file, no missing file, no differing byte. **Throws** when the tree has no
  `meta/` to compare against, for `packed-keyring-from-ca`'s recorded reason —
  answering `pass` would make every image green on a host that never built one.
- **`no-private-key-in-baked-meta`** — the three detectors above over
  `/usr/share/mos/meta/` and `/etc/rauc/`, reporting the file count it scanned
  so an empty search space is visible in the verdict rather than hidden behind
  a green tick.

`packed-keyring-from-ca` keeps its contract and changes only the directory it
reads (§3.1).

#### 1.4 What `meta/` may still never contain — the prohibition that survives

One of the previous revision's three prohibitions is unchanged, because it was
never about secrecy:

**No per-device value in the baked public set** — not a serial, not a MAC, not
a device id, not a claim code. Every device flashed from one image carries
byte-identical baked bytes, so a per-device value in it is a per-device value
that is the same on every device, which is a defect with no correct reading.
`packed-meta-is-the-public-set` is the mechanical form: the baked set is
byte-equal to a build-host directory that does not know which device it is
for. PLAN-072 §2 relies on this to rule out enrolment shape (b) structurally
rather than by argument.

**And no secret in the baked public set**, which is now a property of the
allowlist rather than of the directory. `manifest.json` is baked, so a bearer
token pasted into it ships to every device. §4's schema has no field for one,
and §1.5 says why no check is proposed for it.

#### 1.5 What replaces M1, M2 and M3

| Rule | Was | Now |
|---|---|---|
| **M1** every file under `meta/` is tracked by git | the mechanical form of "no per-device value" | **Deleted, and inverted.** `meta/` is gitignored (§2). The build refuses if `git ls-files meta/` returns anything, because a tracked file under `meta/` is a signing key on its way into permanent history |
| **M2** no private key material under `meta/` | a directory-scoped grep for PEM armour | **Deleted as written; re-aimed and strengthened.** Private keys are the directory's purpose. The prohibition moves to the *staged set* (B1) and the *image* (B2), and gains the two detectors an armour grep misses (§1.3) |
| **M3** no X.509 certificate under `meta/` | kept the RAUC keyring to one source, `ca/` | **Deleted.** `meta/rauc/` is now where that certificate lives. The single-source property M3 protected is preserved by there being exactly one directory (§3), plus the overlay refusal that is already in the build |

**The limit of all of this, stated rather than glossed.** These checks catch the
realistic accident — a key copied in beside the certificate, a directory staged
wholesale — and they catch it twice. They cannot catch a secret that does not
look like one: a bearer token in `manifest.json` is a JSON string and no
assertion distinguishes it from a URL. No check is proposed for that, because a
token-entropy heuristic over a file full of URLs and hashes would fire mostly on
things that are fine. **And the previous revision's structural defence for this
case is gone**: `meta/` is no longer committed, so a secret in it no longer
appears in a diff. What remains is the release process — the same out-of-band
control that governs `ca/` today, and `meta.example/` (§2) is what makes the
intended shape reviewable even though the instance is not.

### 2. `meta/` is gitignored, generated when absent, documented by `meta.example/`

Three parts, and the middle one is deliberately not new.

**Gitignored.** `.gitignore` gains `/meta/` with the same paragraph `/ca/`
carries — a committed signing key would make every device trust anything anyone
builds. **The `/ca/` entry stays as a tombstone**, exactly as the file already
keeps `pkgs/rauc/.devkeys/` after that location was retired: a stale `ca/` on a
developer's machine still holds a private CA key, and the entry is what stops it
being committed by an absent-minded `git add -A` after §3's move.

**Generated when absent, by the mechanism that already does it.**
`pkgs/rauc/gen-dev-keys.sh` is extended rather than duplicated: same
`--if-absent` entry point that `rootfs/build.sh` already calls on every build,
same loud non-fatal notice, same rule that a build carries on with
development-grade material rather than refusing. It gains a `--domain` argument:

- **`--domain rauc`** (default, and what `--if-absent` runs): generates
  `meta/rauc/` with openssl, exactly as it generates `ca/` today. The build
  cannot proceed without a keyring, so this half stays build-blocking and
  automatic.
- **`--domain updates`**: generates `meta/updates/root.key` and
  `meta/updates/online/*.key` with `rauc-sign gen-dev-keys`, then a development
  `root.json` via `rauc-sign init`. **Not automatic**, for two reasons worth
  stating rather than discovering: it needs the `rauc-sign` binary, so wiring it
  into `--if-absent` puts a cargo build in the image path; and a TUF root that
  anchors a repository nobody has published is ceremony without content.
  **Absent update material is a supported steady state** — the same steady state
  as an absent `update.source` (§7). The build says so in one line: *no update
  anchor baked; this image cannot verify an update repository until
  `meta/updates/root.json` exists*, and it continues.

**One marker, and it names what it covers.** `meta/GENERATED` replaces
`ca/GENERATED` and keeps its whole contract: it marks material
development-grade **forever after**, not only in the run that made it; nothing
but the generator writes it; production material is placed in `meta/` *without*
it. What changes is that the file now **lists the domains it generated**,
because the mixed tree is a real case — a production RAUC ceremony's output
copied in while the TUF root is still development-grade. `complete()` becomes
per-domain, the build's warning names which domains are development-grade, and
`packed-keyring-from-ca` reads the marker for the same verdict wording it prints
today.

**`meta.example/` is what a reader learns the format from.** Committed,
carrying no key and no server URL:

```text
meta.example/updates/manifest.json    the §4 document, update.source = null
meta.example/README.md                which files are public, which never leave the host
```

It is a **directory the tooling uses**, not prose beside the tooling: the
generator copies `meta.example/updates/manifest.json` into `meta/` when `meta/`
is absent, and the schema validator of F5 runs over `meta.example/` in CI. An
example that is only read by humans drifts from the schema silently; one that
every fresh build instantiates and every CI run validates cannot.

`meta.example/` deliberately does **not** contain a `rauc/` or a key of any
shape, not even a placeholder. A file named like a key in a committed directory
is a file somebody eventually fills in.

### 3. `ca/` is absorbed into `meta/rauc/`; four private keys, four roles

#### 3.1 The decision: one directory, and the churn it costs

**Recommended: absorb.** `ca/` ceases to exist; its four files move to
`meta/rauc/` unchanged in name, mode and meaning. The user's layout puts the
RAUC key under `meta/`, and with `meta/` now gitignored, generated-when-absent
and holding private keys, `ca/` and `meta/` would be **two directories with
identical properties and no rule distinguishing them** — the previous revision's
distinction (`ca/` secret, `meta/` public) is exactly what this layout deletes.

Three reasons, in order of weight:

1. **The property that made two directories legible is gone.** A reader could
   previously answer "which one does this file go in?" with "is it secret?".
   Under the new layout that question has no discriminating answer, and a
   boundary a reader cannot apply is a boundary that will be applied wrongly.
2. **One selective-bake rule instead of two.** §1.2's allowlist has to cover
   every directory that feeds the image. With `ca/` beside `meta/`, B1 and B2
   are written twice, over two trees, and the second one is the one that gets
   forgotten when a slice adds a file.
3. **One generator, one marker, one ignore entry.** Two directories mean two
   `GENERATED` markers and the question of what a tree with `ca/GENERATED` and
   no `meta/GENERATED` means.

**The price, named rather than waved at.** Absorption is mechanical rename
churn with no behavioural change, across: `rootfs/build.sh` (`CA_DIR`),
`build/src/bundle-cli.ts` (the `keyDir` default that resolves `signer.cert.pem`,
`signer.key.pem` and `ca.cert.pem`), `pkgs/rauc/gen-dev-keys.sh` (`KEYDIR`),
`verify/src/checks-root.ts` (`ctx.caDir` and `packed-keyring-from-ca`),
`verify/src/checks-fixture.ts` and the verify and build test suites,
`rootfs/compose/compose-install.sh`, `tests/rauc-trust-negative-test.sh`,
`tests/trust-domain-hygiene-test.sh`, `.gitignore`, and the operator steps of
`docs/design/release-signing.md` §2.5. The check id `packed-keyring-from-ca`
becomes `packed-keyring-from-meta`; it is a rename, and its assertion — the
shipped keyring is byte-equal to the one certificate in the tree — is unchanged.
F3 is the slice.

**The alternative, priced: keep `ca/` beside `meta/`.** Zero churn today. It
costs, permanently: two homes for private keys with no rule saying which; two
generators or one generator with two roots; two `GENERATED` markers; §1.2's
allowlist and both its checks written over two trees; and the user's layout not
actually implemented, since `meta/rauc/` would not exist. It is the cheaper
change and the more expensive design, and the tree is in development, so the
churn is the thing worth spending. **Re-openable** if the rename turns out to
reach further than F3's list — but the list above was enumerated, not estimated.

#### 3.2 `meta/updates/root.key` is the TUF **root role** key, and here is what it is not

The layout names one key file where a release needs **six** private keys across
**two independent hierarchies**. Letting one filename stand for several roles is
the failure this section prevents; they have different rotation rules and
different blast radii.

| File | Hierarchy | Signs | If stolen | Rotation |
|---|---|---|---|---|
| `meta/rauc/ca.key.pem` | RAUC X.509 | signer certificates | mint a signer the fleet already trusts; every device installs your bundles until reflash | `release-signing.md` §2.4 rollover with an overlap window; a *compromised* CA is §2.3's uncovered case and needs a reflash |
| `meta/rauc/signer.key.pem` | RAUC X.509 | the bundle's CMS signature | sign bundles while the certificate is valid | §2.2 reissue — cheap, needs the CA key, no fleet update, because devices trust the CA |
| `meta/updates/root.key` | TUF | **`root.json` only — never a release** | re-anchor the entire update metadata hierarchy: bind attacker-controlled online keys and have pinned devices walk forward to them | `rotate-root` cross-signs so a pinned device follows with nothing shipped to it; `refresh-root` for expiry alone |
| `meta/updates/online/targets.key` | TUF | the metadata pinning each release | offer a device an attacker-chosen target | `rotate-online`, no distribution |
| `meta/updates/online/snapshot.key` | TUF | the metadata index | freeze or mix metadata versions | `rotate-online` |
| `meta/updates/online/timestamp.key` | TUF | freshness | withhold updates | `rotate-online` |

**Why `root.key` is the root role and not the bundle signer.** The bundle
signer already exists, is X.509, and cannot be a bare `.key` without losing the
certificate that makes it verifiable — it is `meta/rauc/signer.key.pem`. The
directory `updates/` is the TUF trust domain, `root` is TUF's role name, and
§4's public-key field is a statement about the anchor. The user's phrase "used
locally to sign update bundles" describes the *release flow this repository
performs* — build a bundle, CMS-sign it, publish it into the TUF repository —
which touches four keys, and `root.key` is the one that makes the repository
anchorable at all. It is **not** a delegation key: `rauc-sign` has delegated
targets roles explicitly out of scope, and `rauc-verify` refuses targets
metadata that carries them.

**`meta/updates/online/` is an addition the layout implies rather than states.**
`rauc-sign add` and `rauc-sign sign` load the three online keys on every
release; without a home they would arrive from somewhere this record does not
name. They are separated from `root.key` by a directory because their custody
rules differ — the root key is offline material, the online keys live on the
release host.

**The production shape: `root.key` is absent.** `rauc-sign init` is the only
command that loads it, and no image build touches it. `release-signing.md` §2.5
already establishes the pattern for the other hierarchy — a production build
host carries `signer.key.pem` but explicitly **not** `ca.key.pem`. The same
rule applies here: a production tree holds `meta/rauc/{ca.cert,signer.cert,signer.key}.pem`,
`meta/updates/{manifest.json,root.json}` and `meta/updates/online/*.key`, and
**neither `ca.key.pem` nor `root.key`**, both of which stay on offline media
between ceremonies. `root.key` in the tree is a development convenience, and no
tool this plan designs may require it to be present.

**The consequence of one directory, said plainly.** A development tree that
holds all six keys is a tree where one host compromise yields **both**
hierarchies — the RAUC CMS gate and the TUF metadata gate, which exist
precisely so that neither alone suffices to install code. `ca/` today already
holds both RAUC keys, so the change is that the TUF half joins them. This is
acceptable for a development tree and is exactly why the paragraph above makes
the two offline keys absent in production. It is also a second, sharper reading
of the tradeoff §3.3 accepts.

#### 3.3 The TUF anchor: one place, and the tradeoff that comes with baking it

A TUF repository has exactly one root, so a union is meaningless for it — two
pinned roots are two repositories. There is exactly one source,
`meta/updates/root.json`, so precedence has nothing to arbitrate;
`trust.tufRoot` names a path *inside* `meta/`, and naming one outside it is a
build error.

The tradeoff `pkgs/rauc-sign/README.md` states for the image-baked candidate is
accepted rather than restated as new: the root is exactly as trustworthy as the
image carrying it, so first trust and re-anchoring both ride the RAUC channel,
and **the TUF hierarchy cannot outlive a compromise of the image signing path —
the two hierarchies stand or fall together.** What is bought is that the root
does not have to be replaced to follow a rotation; a pinned device walks the
cross-signed root chain forward on its own, so an image update is needed only to
re-anchor a device whose chain is broken.

**The RAUC keyring keeps its one source**, now spelled `meta/rauc/ca.cert.pem`.
The union case is unchanged and needs no second directory: a keyring is an
OpenSSL CA file — concatenated PEMs, every one trusted — which is what
`release-signing.md` §2.4's rollover already is and what
`tests/rauc-trust-negative-test.sh` already proves the properties of. An
operator wanting a two-CA image concatenates the second certificate into
`meta/rauc/ca.cert.pem`, where the rollover procedure puts it.

**What this does not close.** The two cases `release-signing.md` §2.3 names as
uncovered by an image-carried keyring stay uncovered: a device that missed a CA
rollover's overlap window, and rotation away from a CA that is already
compromised. Both still need a reflash. Open question 2 is where a later
device-time channel would land.

### 4. `meta/updates/manifest.json`: lode's vocabulary, mos's mechanism

One document, schema-tagged first key, no implicit defaults, unknown keys are a
**build** error for `update_policy.rs`'s reason: a mistyped key must fail loudly
rather than silently configure nothing.

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
in it deliberately — §7. A product build edits its own `meta/`; the tree's
example configures no server.

**Three different files in this tree are called a manifest, and a reader will
meet all three.** `/usr/share/mos/manifest.tsv` is the bill of materials the
SBOM derives from; the release `manifest.json` that `rauc-sign add --manifest`
pins as a TUF target beside a bundle is the *gated release description*; and
this one is *local configuration*. The name is kept because it is the user's
layout and lode's, and the disambiguation is stated here once so it does not
have to be re-derived at every mention.

#### 4.1 The public key in the manifest: a pin, not a copy

The layout says `manifest.json` carries "the signing PUBLIC key". The public
half of `meta/updates/root.key` is **already stated** — signed, versioned,
threshold-bearing and expiring — inside `meta/updates/root.json`. That is what a
TUF root document is *for*: a bare public key has no expiry, no threshold and no
rotation rule, which is the same reason §4's mapping table declines lode's
inline `trusted_keys` list.

So a second inline copy in `manifest.json` would be **a second statement of one
fact**, unsigned, with no rule for what a device does when the two disagree. It
is dropped. What the manifest carries instead is a **pin on** that statement:

- `trust.tufRoot` — the path, so the manifest names which anchor this image is
  built against;
- `trust.tufRootSha256` — the digest of exactly those bytes, **derived by the
  build**, with a hand-written mismatch failing the build. A derived value
  cannot become a second truth, and it makes the manifest self-checking: an
  image whose `root.json` was swapped after the manifest was written fails
  before it ships.

That digest is not a new artefact: it is the same number
`release-signing.md` §1.5 already tells the root ceremony to record in its
minutes and distribute out of band. An operator comparing the manifest's value
against the ceremony record is performing the anchor check the runbook already
describes, with no new procedure. And a reader who wants the key bytes
themselves has `root.json` in the same directory.

#### 4.2 The mapping from lode

| lode `lode.toml` | mos `meta/updates/manifest.json` | Verdict |
|---|---|---|
| `[update] manifest = <url>` | `update.source` | **Adopt the role, rename the key.** Both name the one place releases are discovered; lode's is a `lode/v1` JSON feed and mos's is a TUF repository root, so the same name would mislead |
| `[update] channel` | `update.channel` | **Adopt verbatim** |
| `[update] policy = off \| check \| auto` | `update.policy` | **Adopt verbatim.** PLAN-071 owns the semantics |
| `[update] check_interval` (seconds) | `update.checkIntervalMinutes` | **Adopt the key, keep mos's unit.** `update-policy.toml` is minutes today, and two units for one quantity is a defect waiting for a reader who does not notice |
| `[update] asset` | — | **No analogue.** mos selects a whole-system bundle by board, profile, channel and a version newer than `release-identity.env`'s; there is no filename to choose |
| `[update] keep_versions`, `pin` | — | **Structurally absent** (PLAN-071 §6): two slots, fixed by the partition table, not by a setting |
| `[trust] trusted_keys` (inline list) | — | **Not adopted**, and §4.1 is the argument: a bare key list has no rotation rule |
| `[trust] trusted_keys_file` | `trust.tufRoot` + `trust.tufRootSha256` | **Adopt the file form, add the pin.** mos's anchor is a signed TUF root with roles and its own rotation rule, which is strictly more than a key list |
| `[trust] require_signature` | — | **Not adoptable**, and PLAN-071's Context already argues it: lode's `off` exists because lode can install unverified artifacts; mos has no such mode, and importing the setting would mean building one in order to configure it off |
| `[http] headers` | — | Not built. mos does not authenticate to its update source today and this plan adds no credential |
| `[http] credential_hosts` | `http.credentialHosts` | **Adopt the key and the rule now, empty by default** — the same-origin rule must exist before the first credential does, because the failure it prevents is silent |
| `[http] allow_insecure` | — | **No analogue.** The TUF walk establishes trust; `docs/design/release-signing.md` §3.1 already mirrors metadata over plain HTTP deliberately and treats the mirror as unverified input |
| `[global] app`, `[command]`, `[runtime]`, `[env]`, `[supervise]`, `[signals]` | — | lode launches and supervises one application; mos's supervisor is systemd and its unit of update is the whole system |

**Where mos differs, once, so no later reader re-derives it.** lode's
`manifest.json` is a *remote* catalog: it enumerates versions, assets, sha256
digests and ed25519 signatures, and lode reads it over the network. mos's
enumerates none of that, because all of it lives in signed TUF `targets.json` on
the server. Baking a copy of a release catalog into an image would freeze a
moving fact at build time and produce a second, always staler answer to a
question the update client already asks correctly. What is baked is the
*configuration for asking* — where, which channel, under what policy, against
which anchor — and nothing the server is authoritative for.

**The same-origin rule, and the review property that changed.** Credentials
configured for the update source are attached only to hosts same-origin with
`update.source` as baked, plus the explicit `http.credentialHosts` list. The
previous revision claimed this list was **reviewable in a diff** because `meta/`
was committed. **That claim is now false and is withdrawn**: `meta/` is
gitignored, so a deployment's actual host list is out-of-band material like
`ca/` today. What survives is that the *shape* is committed in `meta.example/`
and the rule exists before the first credential does.

### 5. The cost: configuration is per-build

Stated plainly and up front, because it is the price of everything §6 makes
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
   **a per-deployment `meta/` implies a per-deployment `PROFILE`** — that is the
   field with the right shape, and it is a decision the release process has to
   make consciously rather than discover when the second customer appears (open
   question 1).
3. **`meta/` is now out-of-band material, which trades one problem for
   another.** The previous revision noted that a committed `meta/` publishes
   every customer endpoint to anyone with repository access, permanently. That
   disclosure problem is gone. In its place: a deployment's configuration is no
   longer reproducible from a checkout, and a build is reproducible only
   together with the `meta/` its build host carried. That belongs in the release
   record beside the keys, and it is the same property `ca/` already has.
4. **The chicken-and-egg case.** The server that must deliver the new image is
   the one being changed. A device pointed at a server that has moved cannot be
   told the new address over the channel that is dead.

**The escapes, so that baked defaults read as overridable rather than
absolute.** They are what make consequence 4 survivable:

- **The operator-editable policy file on STATE.** `update-policy.toml` is
  PLAN-071's, it already exists, and it **outranks the baked values on every key
  it names — including the server URL**. An operator whose vendor server moved
  edits one file on the device; no reflash, no new image. §5.1 is the precedence
  rule in full.
- **Offline `rauc-update import`.** A bundle on removable media, verified
  against the baked keyring and the pinned root, with no server at all. This is
  the answer for a device whose operator can reach it physically but whose
  server is gone, and it is shipped today.

**What neither escape covers, said rather than left to be found.** A device with
no operator *and* no physical access, whose server has gone away, is stranded.
That is the true residue of a baked configuration, it is not fixable by anything
short of a channel this product deliberately does not have, and it is the reason
§5.1's precedence puts the STATE file on top rather than treating the baked
values as authoritative.

#### 5.1 Precedence: configuration is overridable, trust is baked

Per key, and the file on STATE wins:

- `update-policy.toml` names a key → that value.
- It does not name it, or does not exist → the baked `manifest.json` value.
- Neither → the code default, **except `update.source`, which has none.** Absent
  in both means no online source: check and fetch refuse with today's reason,
  and the offline import path remains (§7).
- `update-policy.toml` exists and **does not parse** → today's fail-closed
  behaviour, unchanged: every restricted action refuses while the reboot gate
  keeps evaluating. It does **not** fall back to the baked values. A parse error
  is not absence, and silently reverting to the baked server on a typo would
  move a device back to the server its operator was in the middle of moving it
  off.
- The baked document cannot fail this way at all: it is validated at build time
  and a malformed one fails the build. "The configuration names no server" is a
  supported steady state rather than an error.
- **Trust anchors have no runtime override.** `/usr/share/mos/meta/updates/root.json`
  and `/etc/rauc/keyring.pem` are read, never written, and no key in
  `update-policy.toml` names either. Changing an anchor is an image change, full
  stop; recovering from a compromised one is a reflash, which is what it is
  today.

That line — **configuration is overridable, trust is baked** — is the spine of
this design, and it is the answer to "does baking take control away from the
operator": it takes it away for exactly the things that must not be rewritable
on a running device, and for nothing else.

### 6. What survives what — the root's answer, and no new row

The baked set is part of the root filesystem, so its survival profile is the
root filesystem's, exactly:

- **Every A/B update replaces it.** RAUC writes the inactive slot, which carries
  its own `/usr/share/mos/meta/` and its own `/etc/rauc/keyring.pem`.
  Configuration and code move together, atomically, under one signature.
- **A slot rollback restores it**, along with everything else in that slot — a
  device that falls back to the previous system falls back to the previous
  system's update configuration too. That is the correct behaviour and worth
  naming because it is easy to assume otherwise: there is no configuration that
  survives a rollback and no configuration that a rollback can strand.
- **All three implemented reset tiers leave it untouched**, because a reset
  never rewrites the root.
- **A whole-disk reflash replaces it** — with the new image's, which *is* the
  configuration. There is nothing to re-apply and no procedure to write.

**In `docs/design/recovery.md` §2.1's terms: this plan adds no row and no
column.** The table's rows are the four tiers and its columns are the stores;
the baked set lives inside `system slot A` and `system slot B` and its cells
*are* those columns' cells — `unaffected` for tiers 1, 2 and 3 (per that table's
`[^slots]` footnote, and because `reset.rs`'s `Roots` type has no member for a
slot, which is a property of the type rather than a claim about the code),
`cleared` for tier 4. Inventing a "baked configuration" column would state
something the slot columns already state, and a table with two columns that must
agree is a table that will one day disagree.

The one sentence §2.1 gains is a clarifying note, not a new claim: the slot
columns cover the update configuration and the trust anchors, because those are
files in the root filesystem.

### 7. No default server, and the check that holds it

**There is no built-in vendor URL anywhere in the tree and this plan adds none.**
`meta.example/`'s `manifest.json` sets `update.source` to `null` and `fleet.url`
to `null`, so a build from a fresh checkout produces a device that checks
nothing until somebody either edits its own `meta/` for a product build or
writes the policy file on the device. A device whose baked manifest names no
server **refuses to check** and says so, rather than falling back to a vendor
host.

That rule is mechanical rather than promised: a verifier check over the
assembled image fails any build in which the update client, mosd or the `meta/`
reader carries a **compiled-in scheme-and-host default** for an update or fleet
endpoint. Baking `meta/` makes that check *more* necessary, not less — there is
now a legitimate place for a URL in the image, and a compiled-in fallback beside
it would be an easy and invisible addition. The check distinguishes data from
code: `/usr/share/mos/meta/` may name a host, and no binary may.

**What a fresh checkout does, end to end**, since `meta/` is now absent by
default rather than committed:

1. `rootfs/build.sh` calls `gen-dev-keys.sh --if-absent`, which finds no
   `meta/rauc/`, generates a development-grade CA and signer, prints the loud
   notice, and writes `meta/GENERATED` naming the `rauc` domain.
2. The same step instantiates `meta/updates/manifest.json` from
   `meta.example/`, so the tree's default configuration names no server.
3. No `meta/updates/root.json` exists, so no anchor is baked and the build says
   so in one line (§2). This is not an error: with no source configured there is
   no repository to anchor to.
4. The image builds, `packed-keyring-from-meta` reports the trust root
   **development-grade**, and `packed-meta-is-the-public-set` asserts the baked
   set is exactly the manifest — the anchor being absent is a fact it states,
   not a failure.
5. The device boots, self-provisions, derives its hostname from its identity,
   and is fully manageable over apid on the LAN. Update source: none, so check
   and fetch refuse with the reason they refuse with today, and the offline
   lockbox import path remains. Fleet: off.

**A server that does not answer** is the existing behaviour and no new one: the
lifecycle records `failed` with the client's stderr tail, the next scheduled
check retries, the bounded subprocess timeouts apply. Stated as the autonomy
claim `docs/design/security-model.md` requires: **no operation on this device
requires the update server or the fleet plane to answer**, and nothing degrades
as a function of time since last contact.

### 8. Reading it back

`GET /api/v1/provisioning/status` gains the baked configuration as read — the
schema tag, the product labels, the update source and channel, the policy
default, the fleet switch, and the sha256 of each file under
`/usr/share/mos/meta/`. It returns the whole baked document, and the reason is
now structural rather than a promise about the directory: **the baked set is
allowlisted and checked twice (§1.3), so nothing secret is in the image for this
endpoint to disclose.** The private half of `meta/` never left the build host
and is not reachable from any device API because it is not on any device. The
redactor still covers the settings subtrees beside it.

The digests carry most of the value. An operator debugging *why will this device
not update* needs to know which anchor it pinned and which configuration it was
built with, and a digest answers both without shipping a certificate through an
API. `trust.tufRootSha256` (§4.1) makes one of them checkable against the
ceremony minutes without an API call at all.

Two facts should read side by side wherever this surfaces: the **baked** value
and the **effective** one after §5.1's precedence. An operator looking at a
device that is checking a server they do not recognise needs to see, in one
place, that the policy file is overriding what was built in.

### 9. Open questions — decisions with costs, not guesses

1. **Does a per-deployment `meta/` get a per-deployment `PROFILE`?** (§5,
   consequence 2.) It is the field with the right shape and `rauc-update`
   already selects on it, but it makes the profile namespace a customer list and
   profiles appear in release artifacts. The alternative — encoding the
   deployment in `VERSION` — pollutes the version ordering the rollback guard
   depends on. **Recommended: `PROFILE`**, decided before the second deployment
   exists rather than after.
2. **Is a device-time trust channel still wanted, later?** This plan does not
   build one, so `docs/design/release-signing.md` §2.3's missed-overlap case
   stays uncovered (§3.3). A signed USB import with the TUF chain rule is the
   natural shape and is `pkgs/rauc-sign/README.md`'s third candidate; it is now
   a *second* channel added to a pinned root rather than the way first trust
   arrives.
3. **Does the baked set carry anything a device could not compute?** Today it
   carries configuration and two anchors. The pressure to add per-device values
   will come from manufacturing (`docs/design/manufacturing.md` §3 wants a
   serial in a per-device record) and from zero-touch enrolment (PLAN-054
   question 6). Both are structurally excluded by baking, and the answer must
   stay no; the question is recorded so that the next person who wants it finds
   the argument instead of the directory.
4. **Should the image carry the development-grade marker?** `meta/GENERATED` is
   build-host-only today, so a fielded device cannot say whether it trusts a
   development CA — only a verifier run against the tree that built it can. A
   baked `/usr/share/mos/meta/GENERATED` would make the device self-describing
   at the cost of one more file in the allowlist and one more thing to keep
   true. Not designed here; named because it is the obvious next request from
   anyone debugging a device they did not build.
5. **Is `--domain updates` generation wanted in the default build?** §2 makes it
   opt-in because it needs `rauc-sign` in the image path and produces an anchor
   for a repository nobody has published. If a development TUF repository
   becomes part of the standard loop, this flips and the cargo dependency has to
   be priced.

## Risks

- **A private key reaching the image.** The one that matters (§1.1): every
  device would carry the key that signs its own updates, and one purchased unit
  would yield fleet-wide code execution. The mitigation is an allowlist rather
  than a denylist, checked at the build (intent) and over the packed root
  (outcome), with a detector that covers DER PKCS#8 and not only PEM armour —
  because the file the hazard is named after is DER.
- **Absorbing `ca/` touches eleven files and two test suites.** Mechanical, but
  mechanical churn across trust-critical code is exactly where a rename lands in
  the wrong branch. The existing suites — `tests/rauc-trust-negative-test.sh`,
  `tests/trust-domain-hygiene-test.sh`, `verify`'s own tests — are the control,
  and F3's gate is that they pass with their meanings unchanged rather than with
  their expectations edited.
- **`meta/` is no longer reviewable.** The previous revision leaned on "it is
  committed, so a secret appears in a diff". That defence is gone (§1.5) and its
  replacement — `meta.example/` plus the release process — is weaker for
  exactly one case: a secret that does not look like one, inside
  `manifest.json`. Stated so nobody re-derives the withdrawn claim.
- **One directory now holds both signing hierarchies** (§3.2). In a development
  tree, one host compromise yields both the RAUC CMS gate and the TUF metadata
  gate. Mitigated by the production rule that `ca.key.pem` and `root.key` are
  absent from a release host, which is the rule `release-signing.md` §2.5
  already states for the first of them — but it is a rule, and rules about which
  files are *absent* are the ones nobody notices being broken.
- **A configuration change now costs a release.** This is the design, not a
  defect, and the risk is that it is discovered at the wrong moment — the first
  time a customer's server moves. §5 prices it; §5.1's precedence is the
  mitigation that actually works.
- **`meta/` looks editable on the device and is not.** Somebody will edit
  `/usr/share/mos/meta/updates/manifest.json` on a running device, or try to,
  and nothing will happen — or worse, they will remount and break verity. §8's
  baked-versus-effective read surface is what points them at the policy file
  instead.
- **The `meta/` versus META-partition name collision**, and now a second one:
  three files in this tree are called a manifest (§4). Mitigated only by saying
  so, here and in the design docs the backlog updates.
- **Moving `rauc-update`'s default anchor path** from
  `/usr/share/mos/uptane/root.json` to `/usr/share/mos/meta/updates/root.json`.
  It is unimplemented today, so the move is free — but it is exactly the kind of
  change that is free until something outside this tree has already hard-coded
  the old path. Worth one grep at implementation time rather than an assumption
  now.
- **Baking the TUF root ties the two hierarchies together** (§3.3). A compromise
  of the image signing path compromises the anchor for the TUF path as well.
  This is the accepted cost of the candidate chosen, and open question 2 is
  where the mitigation would go.

## Scope

In scope: `meta/`'s layout and its split into a baked public set and a
build-host-only set; the allowlist and the two checks that hold it; the
absorption of `ca/`; the identity and custody of each of the six private keys;
`meta/updates/manifest.json`'s schema, its mapping from lode's `lode.toml`, and
the form the anchor's public half takes in it; `meta/` being gitignored, the
committed `meta.example/`, and generation when absent; the image paths and the
byte-equality gate; the precedence rule between baked defaults and the STATE
policy file; the no-default-server rule and its verifier check; the read
surface.

Out of scope: the update policy semantics (PLAN-071); anything the fleet switch
turns on (PLAN-072); the per-device manufacturing record
(`docs/design/manufacturing.md` stays `[proposed]`); a device-time trust channel
(open question 2); hosting for the TUF repository, which
`docs/design/release-artifacts.md` records as open; the META partition, which
this plan does not touch.

### Implementation backlog — estimated separately from approval

Sized in slices, each independently verifiable. No slice is authorised by
approving this plan; each becomes a task record when it is scheduled.

| # | Slice | Size | Gate |
|---|---|---|---|
| F1 | `meta.example/` committed with the §4 document and its README; `/meta/` gitignored with the `/ca/` tombstone kept | S | the committed example names no server and contains no key-shaped file |
| F2 | `gen-dev-keys.sh` absorbed onto `meta/`: `--domain rauc` by default, `--domain updates` opt-in, `meta/GENERATED` naming the domains it wrote, `manifest.json` instantiated from `meta.example/` | M | a fresh checkout builds an image; a second build regenerates nothing; the marker survives and names what it covers |
| F3 | The rename across consumers: `rootfs/build.sh`, `bundle-cli.ts`, `verify` (`ctx.caDir`, `packed-keyring-from-ca` → `packed-keyring-from-meta`), the fixtures, `compose-install.sh`, both trust test suites, `release-signing.md` §2.5 | M | the existing suites pass with their meanings unchanged, not their expectations edited |
| F4 | Selective staging: the §1.2 allowlist in `rootfs/build.sh`, plus refusal **B1** (off-allowlist path; private-key detector with all three tests) | S | a planted `root.key` under a staged path turns the build red and names the file; the tree as generated stays green |
| F5 | The reader in mosd: parse, validate, `deny_unknown_fields`, expose the baked document as live state | M | unknown key is a build error, not a runtime one; the reader always answers with a document |
| F6 | Verifier **B2**: `packed-meta-is-the-public-set` (byte-equal, nothing extra, throw on absent `meta/`) and `no-private-key-in-baked-meta` (three detectors, scoped paths, reports the file count scanned) | M | an image with an added, removed or altered file under the path fails; an image with a planted key under either scoped path fails; a tree with no `meta/` throws rather than passing |
| F7 | §5.1 precedence in `update_policy.rs`: per-key override, and the parse-error rule that does **not** fall back | M | a policy file that fails to parse refuses actions and does not silently adopt the baked server |
| F8 | `rauc-update` reads `trust.tufRoot`; its default anchor path moves; `trust.tufRootSha256` derived at build time | S | a `tufRoot` naming a path outside `meta/` is a build error; a hand-edited digest that does not match `root.json` fails the build |
| F9 | No-compiled-in-endpoint verifier check | S | fails a build with a planted default URL in a binary; passes with one in `meta/` |
| F10 | `GET /api/v1/provisioning/status` extension: the baked document, the digests, and baked-versus-effective | S | — |
| F11 | Design-doc updates: `recovery.md` §2.1's clarifying note, `release-signing.md` §1.5, §2.3, §2.5 and a new key-custody table, `updates.md` §7, `provisioning.md` §4, `manufacturing.md` §1, `security-model.md` §3, and `pkgs/rauc-sign/README.md`'s anchor section | M | `make docs-verify` |

F4 and F6 are the pair that make §1.1's hazard mechanical rather than
conventional, and neither is optional: F4 without F6 proves only that the build
meant well. F3 is the slice with the widest blast radius and the least
interesting content. F7 is the slice with the highest chance of a silent defect,
because getting the parse-error case wrong is invisible until the day it
matters.

## Approval boundary

**This plan ends at an approved seam.** What approval means, exactly:

- `meta/` is a **gitignored, build-host** directory holding the configuration
  and every private key a release needs, generated development-grade when
  absent by the mechanism `ca/` already uses, with `meta.example/` as the
  committed statement of its shape;
- **only three files reach the image**, by allowlist: the RAUC CA certificate,
  the pinned TUF root, and `manifest.json`. Every private key is build-host-only
  and two checks in two places enforce it;
- `ca/` is absorbed into `meta/rauc/`; the RAUC keyring keeps exactly one
  source, and the TUF root has exactly one source, `meta/updates/root.json`;
- `meta/updates/root.key` is the **TUF root role** key, absent on a production
  release host, and no tool may require it to be present to build an image or
  publish a release;
- `manifest.json` carries a **pin on** the anchor (path plus build-derived
  digest), never a copy of the key;
- configuration is overridable at runtime by the STATE policy file, per key,
  with the parse-error rule of §5.1; trust anchors are not overridable at all;
- absence of a server is a supported steady state and there is no default
  server;
- open questions 1–5 are answered before the slices that depend on them
  (question 1 blocks the second deployment, not a slice; question 5 blocks
  nothing until a development TUF repository is wanted).

Approval does **not** authorise writing any of the backlog above. Each slice
takes a task record and its own proposal.

## Alternatives

1. **Bake `meta/` verbatim.** The previous revision's design, and now the
   hazard rather than the plan: §1.1. Rejected without a price, because there is
   no configuration of it that is safe.
2. **Denylist instead of allowlist** — stage everything under `meta/` except
   files matching the private-key detectors. Genuinely close, and cheaper to
   write. Rejected because the default is what decides the outcome: a file
   nobody anticipated ships, and the detector has to be right about a file
   nobody has seen. An allowlist is wrong in the safe direction — the failure
   mode is a missing file, which is loud.
3. **Keep `ca/` beside `meta/`.** Priced in §3.1: no churn now, two homes for
   private keys forever, both checks written twice, and the user's layout not
   implemented. Re-openable if F3's enumerated list turns out to be incomplete.
4. **Keep `meta/` committed and put the keys somewhere else** — `meta/` for
   configuration, a second gitignored directory for signing material. This is
   the previous revision plus a rename, and it preserves the review property
   §1.5 gives up. Rejected because it is the layout the user replaced: the
   instruction was that `meta/` carries both, and a design that splits them back
   apart answers a question that was not asked. Worth naming because the
   property it preserves is real.
5. **Put the update configuration in the settings tree instead.** Rejected for
   `docs/design/updates.md` §2's unchanged reason — a settings key means a
   schema bump plus a migration, and a concurrent workstream owns the next bump
   — and because a settings key is per-device mutable state, while the trust
   half of the baked set must not be.
6. **Keep the TUF anchor unprovisioned and ship only the update
   configuration.** The smallest possible version of this plan. Rejected: it
   leaves `docs/design/updates.md` §7's owed item owed and leaves
   `rauc-update`'s verifier a tool a person points at a `--root` they brought
   themselves, which is the current state stated honestly and is not a shipped
   update path.
7. **A single plan covering `meta/`, the update module and the fleet plane.**
   Rejected; the argument is in PLAN-072's *Why three plans and not one* and is
   not duplicated here.

## Annotations

- 2026-09-03: Created as the first of three records answering the user's request
  for an update-configuration seam, an update module and a cloud registration
  capability.
- 2026-09-03: The request as first phrased asked for "the remote server
  configured in `ca/`". The first revision answered that `ca/` holds trust
  material only. **The second revision retires that answer**: under the layout
  the user gave, `ca/` is absorbed into `meta/rauc/` and the one directory holds
  both (§3.1).
- 2026-09-03: **Rewritten (first revision).** The original draft designed a
  device-side factory record on the META partition, carried by an extended
  `mos-provisioning.toml`. That was the wrong seam: what was asked for is a
  `meta/` directory in this repository that the build bakes into the image. That
  revision replaced the storage tier, the transport, the authorisation model and
  the trust layering. The META partition is not touched by this plan.
- 2026-09-03: **Revised again (second revision), against the concrete layout.**
  `meta/` holds `rauc/`, `updates/manifest.json` and `updates/root.key`, so it
  carries signing material and cannot be committed. Changed: `meta/` is now
  gitignored and generated when absent by `gen-dev-keys.sh` with one
  `meta/GENERATED` marker (§2); M1 and M2 are deleted and M3 with them, replaced
  by an inverse tracked-file refusal and by prohibitions re-aimed at the staged
  set and the image (§1.5); **baking is selective by allowlist**, held by a
  build-time refusal and a packed-root verifier, because baking verbatim would
  ship every device the key that signs its updates (§1.1–§1.3); `ca/` is
  absorbed rather than kept beside (§3.1, re-decided rather than defended);
  `root.key` is identified as the TUF root role key among six, with a custody
  table and the rule that it is absent in production (§3.2); the manifest
  carries a path plus a build-derived digest rather than a copy of the public
  key (§4.1); and §7 now spells out what a fresh checkout does when `meta/` is
  absent. Withdrawn: the claim that the credential host list and the
  configuration are reviewable in a diff (§4.2). Deliberately unchanged: the
  operator layer on STATE and §5.1's precedence including the parse-error rule,
  the no-default-server rule and its check, §6's survival analysis, PLAN-071's
  `off | check | auto` semantics and PLAN-072's outbound-only boundary. The
  record's title changed with this revision; `docs/plan/index.md`'s row is owed
  the same change and is deliberately not edited here.
