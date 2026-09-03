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

Two of those keys are **owned** by `meta/` and two are **defaults**, and the
difference is §5's whole subject. `update.source` and everything under `trust`
are owned: no runtime layer can override them, and the operator document of
§5.1 has no key that names them. `update.channel`, `update.policy` and
`update.checkIntervalMinutes` are the values a device uses **until an operator
chooses otherwise**, and the operator can choose otherwise without a new
image.

| lode `lode.toml` | mos `meta/manifest.json` | Verdict |
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
- the trust anchors — the RAUC keyring staged from `ca/`, and the pinned TUF
  root `meta/ca/root.json`.

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
3. **`meta/` is committed, so a per-customer endpoint is a permanent fact in
   the repository.** Unchanged.
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

1. **`meta/`, baked at build.** Fleet-identical, per-build: the source URL, the
   trust anchors, and the **default** channel, policy and check interval.
2. **`/mos/updates/config.json`, on DATA.** Operator-owned, machine-written,
   survives every A/B update and every slot rollback because DATA is neither;
   cleared by the reset tiers §4.1 names.
3. **The running state.** What the lifecycle actually did — `idle`, `checking`,
   `ready`, `reboot-required` and the rest. It configures nothing; it is the
   record of what happened, and it is in this list only so that a reader stops
   looking for a fourth place a channel could come from.

| Key | Layer 1 `meta/` | Layer 2 `/mos/updates/config.json` | Rule |
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
`meta/ca/root.json`). `channel`, `repoDir`, `statePath`, `maxBytes`,
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
`/usr/share/mos/meta/`. It returns the whole document because §1 established
that nothing in it is secret; the redactor still covers the settings subtrees
beside it.

The digests carry most of the value. An operator debugging *why will this
device not update* needs to know which anchor it pinned and which configuration
it was built with, and a digest answers both without shipping a certificate
through an API. Because the digests are over files inside the verity root, they
are also the cheapest available cross-check that the image is the one the
release claims.

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
from lode's `lode.toml`; the image path and the byte-equality gate; the three
layers and the one precedence rule between them, including where the operator
layer lives and what becomes of the STATE policy file; the trust layering
between `ca/` and `meta/ca/`; the no-default-server rule, the channel rules and
their verifier check; the read surface.

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
| F6 | §5.1 precedence in `update_policy.rs`: the three layers, per-key override, and the parse-error rule that does **not** fall back | M | a layer-2 document that fails to parse refuses actions and does not silently adopt the baked channel |
| F6b | Move the operator document: `/var/lib/mos/update-policy.toml` retired, `/mos/updates/config.json` in its place, `source.url` and `source.rootPath` dropped from its schema | M | the channel is readable from exactly one file; a document naming a source URL is a load error |
| F7 | `rauc-update` reads `trust.tufRoot` and its default anchor path moves | S | a `tufRoot` naming a path outside `meta/` is a build error |
| F8 | No-compiled-in-endpoint verifier check | S | fails a build with a planted default URL in a binary; passes with one in `meta/` |
| F9 | `GET /api/v1/provisioning/status` extension: the document, the digests, and baked-versus-effective | S | — |
| F10 | Design-doc updates: `recovery.md` §2.1's clarifying note **and `[^apps-mos]`'s extended reason (§4.1)**, `updates.md` §2 (the policy file's tier, its new home and format) and §7, `release-signing.md` §2.3 and §2.5, `provisioning.md` §4, `manufacturing.md` §1, `security-model.md` §3, and `pkgs/rauc-sign/README.md`'s anchor section | M | `make docs-verify` |
| F11 | Operator documentation: which reset returns the device to the baked default channel (§4.1), stated where a reader meets the reset, not only in the design tree | S | a reader who runs tier 3 was told the channel goes back |

F2 and F4 are the pair that make the boundary mechanical; F6 and F6b are the
slices with the highest chance of a silent defect, because getting the
parse-error case wrong is invisible until the day it matters, and because a
half-finished move is exactly the two-files-name-the-channel state the move
exists to prevent. They should ship together or not at all.

Compared with the previous draft, F1–F10 replace a backlog whose largest and
riskiest item was a two-target atomic commit across META and STATE. That item
does not exist here.

## Approval boundary

**This plan ends at an approved seam.** What approval means, exactly:

- `meta/` is a committed, fleet-identical, secret-free build-time input beside
  `ca/`, baked verbatim into the read-only root at `/usr/share/mos/meta/`;
- the RAUC keyring has exactly one source and it stays `ca/`; the TUF root has
  exactly one source and it is `meta/ca/root.json`;
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
6. **Keep the operator policy on STATE and read only the channel from `/mos`.**
   Rejected, and it is the option the addendum explicitly forbids: two files
   that both name the channel is the defect this campaign has spent its life
   removing. A split with no overlapping key is the weaker version of the same
   objection — one operator-owned concern in two homes, with two failure modes,
   two atomicity stories and two things to reset.
7. **`/mos/update/` as a sibling of `/mos/updates/`.** Rejected on the name
   alone (§5.1): one letter apart, different meanings, silent in both
   directions when somebody writes the wrong one.
8. **Ship the operator document as TOML, matching the file it replaces.** The
   request that settled this named `config.toml` while asking for JSON. JSON is
   what was chosen — the document is machine-written state, not a hand-edited
   file — so the name follows the format and it is `config.json`. Named here
   rather than silently renamed, because a `.toml` file containing JSON fails
   at a reader that parses by extension, and it fails naming the wrong thing.
9. **A single plan covering `meta/`, the update module and the fleet plane.**
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
