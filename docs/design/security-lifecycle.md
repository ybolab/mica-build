# Design: Security Lifecycle — Keys, Credentials, Releases, Response

> Who does what, to which trust material, when. This document assigns an
> owning **role** to every lifecycle procedure — key ceremonies, channel
> promotion, support windows, vulnerability response — and states each
> procedure's real maturity. The ceremony *commands* live in
> `docs/design/release-signing.md` and are not duplicated here; this document
> owns the surrounding lifecycle. Companion to
> `docs/design/security-model.md` (what the material defends) and
> `docs/design/manufacturing.md` (the factory half of identity).

## 0. Markers, and the owner roles

Markers follow `docs/design/access.md` §0's discipline, with this document's
set (a lifecycle's sections are procedures, like
`docs/design/release-signing.md`'s):

- **[procedure]** — shipped tooling supports every step; executable today.
- **[partial]** — executable with a named gap.
- **[proposed]** — the tooling or operational channel does not exist; prose
  only, kept honest here rather than implied to be enforced.

**Roles, not people.** Four owner roles are named throughout. A person may
hold more than one role in a small organisation, with one exception noted
below; the point is that every procedure has exactly one accountable role:

| Role | Accountable for |
|---|---|
| **release owner** | key ceremonies and custody, channel promotion, release publication, support windows and EOL |
| **security owner** | vulnerability intake, severity assignment, advisories, incident response |
| **manufacturing owner** | factory inputs, injection, manufacturing records, quarantine and rework (`docs/design/manufacturing.md`) |
| **support owner** | field escalation intake, RMA authorization, linking field failures back to releases and manufacturing records |

Exception: the **security owner** must be able to trigger an emergency
release, so where staffing allows, release and security ownership are held by
different people — a compromise of the release path is precisely the incident
the security owner must be able to respond to independently.

## 1. Credential inventory and lifecycle

Every class of trust material, with its generation, injection, storage,
rotation, revocation and recovery. **Production private material is never in
git** — see §1.6, which is the one rule with build-time teeth today.

### 1.1 Metadata signing keys — owner: release owner — **[implemented]** software flow

Ed25519 anchors authenticate current catalog, deployment and firmware envelopes.
They are explicit kernel-package inputs; public factory settings do not carry
editable trust keys. The server receives an explicit overlap set and refuses to
remove an anchor while a published artifact still depends on it. Withdraw or
replace those artifacts before removing the key.

Catalog issue/expiry times and revision checkpoints protect acquisition freshness.
Deployment generations and recorded failed IDs prevent automatic rollback to a
known failed release. Installed offline boot uses authenticated installed metadata
without requiring a fresh catalog or network clock. Do not describe catalog expiry
as revocation of an already installed deployment.

Rotation requires a separately authenticated kernel policy carrying the intended
overlap/removal, plus matching signed deployment associations. Preserve a usable
retained combination throughout the ceremony. Recovery from lost or compromised
anchors follows [key delivery](key-delivery.md) and the explicit complete-image
reflash path when no accepted association remains. No mutable settings API imports
an older trust root or walks a historical metadata format.

### 1.2 Content signing keys — owner: release owner — **[implemented]** software flow

Content certificates authenticate detached PKCS#7 root hashes for root and support.
The kernel's builtin trust policy requires these signatures for every corresponding
verity mapping. Blocks are authenticated when read. A build-time checksum or a
userspace signature check cannot replace the kernel's required signature.

The signer/certificate are explicit build inputs. Private keys never enter the
root, kernel package, firmware package or release directory. Certificate overlap
and removal are kernel-package changes; they do not use a mutable rootfs keyring.
Ordinary boot never waits for network validation, CRL delivery or catalog refresh.
Do not claim a wall-clock signer-expiry window as installed-boot revocation.

`pkgs/mos-boot/dev-keys.sh` creates separate boot/content/metadata development
domains only when explicitly invoked with a new output directory. Its marker is
baked with the public defaults. The native observer reports that provenance;
`build/run.sh --release gate` refuses marked material on candidate/stable channels.
Empty or malformed generated markers fail release assembly. A missing marker is
not proof of operational key custody or physical qualification.

Current negative tests cover domain separation, unknown/missing/modified
signatures, metadata/object tampering, staged overlap and old-key removal. Exact
software/VM evidence is in the current delivery task. Production custody ceremonies
and physical platform qualification are not inferred from those tests.

### 1.3 Device TLS identities — owner: release owner (policy), support owner (field) — **[partial]**

What exists: apid generates a **self-signed** certificate on first start into
its STATE directory and reuses it (`pkgs/mosd/apid/src/tls.rs`); it
authenticates nothing beyond "same device as last time" to a browser that
has accepted it. There is no device certificate hierarchy, no fleet CA and no
enrollment — first-boot provisioning deliberately mints no PKI
(`docs/design/provisioning.md` §2, "What was NOT carried over").

- **Generation** — on device, first apid start; never in the image.
- **Rotation/revocation** — delete the pair on STATE; the next start
  regenerates. No expiry-driven or fleet-driven rotation exists.
- **Recovery** — wiping STATE regenerates identity wholesale, as with every
  STATE credential.
- A managed device identity (fleet CA, enrollment, revocation) is
  **[proposed]** and proceeds with the fleet/remote-management work
  (`docs/design/remote-management.md`), not here.

### 1.4 Administrator credentials — owner: support owner (field procedure) — **[procedure]**

Three live credential classes, each with its lifecycle already designed and
shipped; this section assigns ownership and cross-references rather than
restating:

- **apid webAdmin credential** — hash on STATE; set at setup through apid.
- **SSH authorized keys** — the persistent access credential; rotation is
  editing the `access.ssh.authorizedKeys` list, and every key is a root key
  (`docs/design/access.md` §4.1).
- **Transient root password** — self-revoking by design: cleared by
  `mos-shadow-reconcile` on the next boot via the marker mechanism
  (`docs/design/access.md` §4.1, `pkgs/mosd/mosd/src/transient.rs`).

**Recovery is deliberately absent**: an operator who loses the webAdmin
credential and every key has no software path back in, and the recovery is a
whole-disk reflash that costs everything on the device
(`docs/design/access.md` §9). Support procedures must state this up front
rather than discover it on a call. The inert first-boot device password
authenticates nothing (`docs/design/provisioning.md` §3.6) and must never be
offered to a customer as a credential.

### 1.5 Board boot keys — owner: release owner — **[implemented]** software flow, physical qualification pending

UEFI authenticates systemd-boot and signed UKIs. cx3576's fixed-policy U-Boot
requires the FIT signer embedded in its control FDT. Boot keys are separate from
content and metadata signing keys. Hardware authentication of every earlier
mutable stage remains platform-specific and is not claimed by these mechanisms.

The firmware maintenance workflow authenticates previous/candidate packages,
keeps recovery material outside the ESP, writes only the declared offline target
and compares readback before recording success. cx3576 full-image flashing verifies
the complete written image before reset. QEMU and host stubs do not replace
physical USB, watchdog or power-loss tests. No OTP/fuse change is part of ordinary
component update or development key generation.

### 1.6 Production private material is never in git — **[implemented]** where checkable

The rule, and its mechanisms: `meta/` and `pkgs/mos-deploy/.devkeys/` are
gitignored, both generators refuse to overwrite existing keys, the pack stage
fails any build whose factory shadow carries a usable hash
(`docs/design/access.md` §5.3), and a first-boot settings tree is asserted to
contain no secret material (`docs/design/provisioning.md` §3.1). What no
check can see — a production key pasted into an unrelated file — remains a
custody rule owned by the release owner: production private material exists
only on ceremony media and the release host, per
`docs/design/release-signing.md` §4.

## 2. Release operating procedures — owner: release owner

### 2.1 Channels and promotion — **[proposed]**

Three channels, promotion strictly forward, one release at a time:

- **development** — every successful build; dev keys permitted; no support
  claim attaches.
- **candidate** — built from a tagged source state with production signing
  (`docs/design/release-signing.md` §3); promoted from development when the
  repository gates are green and the release artifacts are complete.
- **stable** — promoted from candidate, never directly from development,
  when: the candidate has soaked on bench hardware for every board the
  release claims, with the board's ladder-level evidence rows current
  (`docs/design/security-model.md` §5); A/B update *and rollback* from the
  previous stable have been exercised; release notes exist; and no open
  release-blocking severity (§3.2) targets it.

Promotion is a signing act, not a file move — a channel's metadata is signed
per `docs/design/release-signing.md` §3 — and a publication gate must refuse
a release whose claims exceed its board evidence, including any boot-assurance
claim above the board's evidenced ladder level. The unsupported-claim
publication gate is **[implemented]** by `checkBoardEvidence` in
`build/src/release-manifest.ts`. Channel promotion remains **[proposed]**;
until it exists, promotion is this procedure executed by hand by the release
owner, recorded in the release notes.

### 2.2 Signing and key custody — **[procedure]**

Custody follows [release signing](release-signing.md) and
[key delivery](key-delivery.md): independent boot/content/metadata private material,
restricted signer access, recorded public fingerprints, and retained recovery
inputs for every accepted association. CI uses explicit disposable development
material. It must not import production private keys or claim production custody.
A role or medium handover requires a recorded review of the corresponding trust
domain and its accepted public anchors.

### 2.3 Support windows and end of life — **[proposed]**

Policy, stated so a customer can plan against it and so EOL is an announced
event rather than a discovered one:

- A **stable release** is supported until superseded by the next stable,
  plus a fixed overlap window during which security fixes are backported to
  it; the window's length is a product commitment set per release in its
  release notes, never silently shortened.
- **Per-board support** is bounded by the board's qualification: a
  board/revision whose evidence lapses or whose vendor BSP input becomes
  unmaintainable moves to unsupported with an advisory, not by omission.
- **End of life** of a channel, release line or board is announced through
  the advisory mechanism (§3.3) with a minimum notice period stated in the
  announcement, and names the last release, the end of security fixes, and
  the recommended migration.

No tooling enforces any of this today; the support owner tracks windows and
the release owner announces EOL. That is the honest state.

## 3. Security response — owner: security owner

All four subsections are **[proposed]** as operational channels — none has
tooling or a published endpoint today — and they are written as the procedure
to stand up, not as one that exists.

### 3.1 Vulnerability intake

A published security contact (a `SECURITY.md` at the repository root naming
an address and a disclosure policy) is the intake channel; until it is
published, intake is private disclosure to the maintainers through the forge,
and publishing the contact is the security owner's first deliverable.
Every report gets an acknowledgement, a tracking record, and a severity
(§3.2) within the triage target below. Reports are held privately until a
fix ships or the reporter-agreed disclosure date arrives, whichever is first.

### 3.2 Severity classes and patch targets

| Severity | Definition (this system's terms) | Triage | Fix target |
|---|---|---|---|
| **critical** | remote compromise of the management plane without credentials; update-authenticity bypass (a bundle or metadata accepted that signing should refuse); persistent code execution surviving the verity root | 24 h | emergency release within 7 days, backported to every supported stable |
| **high** | authenticated-to-root escalation beyond the documented root-equivalence set; defeat of a shipped credential mechanism; denial of update or recovery | 72 h | next release within 30 days, backported to supported stable |
| **medium** | weaknesses requiring local access or unusual configuration; information disclosure short of credentials | 1 week | next scheduled release, target 90 days |
| **low** | hardening gaps, defense-in-depth findings | 2 weeks | recorded; scheduled with related work |

Severity is judged against the real model — e.g. "any SSH key is a root key"
is documented behaviour (`docs/design/access.md` §4.1), not a finding — and
against `docs/design/security-model.md`'s stated limits, so a report that
restates a documented limit is answered with the document, not a patch.

### 3.3 Advisory publication

One advisory per fixed vulnerability at fix release, and per EOL event
(§2.3): affected releases/boards, severity, the fixed release, workarounds if
any, and credit. Advisories are published where releases are published, and
an advisory is also the vehicle for honestly retracting an overstated claim,
should one ship despite §2.1's gate.

### 3.4 Incident response

For a live compromise (key compromise, malicious release, fleet-affecting
exploitation), in order: **contain** (suspend publication; a compromised metadata
online key ends the repository lineage — `docs/design/release-signing.md`
§1.6 — and a compromised signer is reissued per §2.2 there); **assess**
(which keys, which releases, which devices; the custody minutes and audit
trail are the record); **rotate** (the relevant §1 procedure — root rotation,
signer reissue, or fresh repository; any use of `--allow-rollback` is itself
a recorded incident); **notify** (advisory per §3.3, including what cannot be
fixed remotely — e.g. re-anchoring devices while anchor provisioning remains
unbuilt is a physical-contact event, and the advisory must say so); and
**record** (a written post-incident note whose action items land as tracked
work, not resolutions in prose).
