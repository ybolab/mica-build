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

### 1.1 TUF role keys — owner: release owner — **[procedure]**, revocation **[partial]**

Four ed25519 keys: `root` offline, `targets`/`snapshot`/`timestamp` on the
release host (`pkgs/rauc-sign/README.md`).

- **Generation/injection/storage** — the offline ceremony of
  `docs/design/release-signing.md` §1.1–1.5: root on sealed media in two
  locations with a written custody record; online keys to the release host,
  mode 0600; the public `root.json` anchor distributed out of band with its
  sha256 in the ceremony minutes.
- **Rotation** — two distinct ceremonies, `refresh-root` (same key, later
  expiry, the annual event) and `rotate-root` (new key, cross-signed so a
  fielded anchor walks itself forward): `docs/design/release-signing.md`
  §1.6. Online roles are re-signed routinely by `sign` per the §1.4 expiry
  policy.
- **Revocation** — root revocation is `rotate-root` (the outgoing key is
  pruned from the new root); revoking a compromised **online** key is
  **[partial]**: no command binds a different online key into a new root
  version, so the recovery is a fresh repository and a newly distributed
  anchor (`docs/design/release-signing.md` §1.6, closing paragraph).
- **Recovery** — loss of the root media before fleet migration is why the
  outgoing key's sealed copy is retained until the fleet is on the new
  anchor (`docs/design/release-signing.md` §1.6 step 3).
- **Negative tests, by path** — `pkgs/rauc-sign/tests/rotation.rs` (a
  rotation the outgoing key did not sign, a broken outgoing signature, a
  root rollback across restarts, rotating to the incumbent key, rewriting a
  published root version, rotating from an unsigned anchor, the wrong
  outgoing key); `pkgs/rauc-sign/tests/repository.rs` and
  `pkgs/rauc-sign/tests/client.rs` (published rollback, tampered target,
  tampered metadata, expired metadata, unmet threshold — each rejected).

### 1.2 RAUC CA and signer — owner: release owner — **[procedure]**, keyring rotation **[proposed]**

- **Generation/storage** — the offline CA ceremony of
  `docs/design/release-signing.md` §2.1: CA key sealed offline, signer
  key/cert to the release host. The development generator
  (`pkgs/rauc/gen-dev-keys.sh`) writes the same shape into the gitignored
  `ca/` seam and drops the `ca/GENERATED` marker that distinguishes a
  development root from production material forever after.
- **Injection** — at image build: `ca/ca.cert.pem` is staged to
  `/etc/rauc/keyring.pem`; the overlay is refused as a source
  (`rootfs/build.sh`), and the shipped root must carry a byte-equal copy of
  the CA the build was pointed at (`verify/src/checks-root.ts`).
- **Rotation** — signer reissue is routine and touches no device
  (`docs/design/release-signing.md` §2.2). Rotating the **device keyring**
  is **[proposed]**: `/etc` is inside the verity root, no STATE-backed
  keyring channel exists, and until one does an expired or replaced CA means
  a full re-flash (`docs/design/release-signing.md` §2.3).
- **Revocation** — a compromised signer is reissued and out-waited; there is
  no CRL path to devices (`docs/design/release-signing.md` §2.2). A
  compromised CA is a fleet re-anchoring event — the §2.3 gap again.
- **Negative tests, by path** — `verify/src/checks-root.test.ts` proves both
  directions of the dev-keyring gate: an image carrying a `GENERATED` root
  fails closed unless `MOS_EXPECT_DEV_KEYRING=1` names a bench image, and a
  keyring that is not byte-equal to `ca/ca.cert.pem` is refused.

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

### 1.5 Board boot keys — owner: release owner — **[proposed]**

No board today enrolls boot-verification keys: `CONFIG_FIT_SIGNATURE` is
configured nowhere in the tree (`docs/design/boards.md` §8), and the I3/I4
ladder levels that would consume such keys are board-specific best effort
(`docs/design/security-model.md` §5). When a board reaches for I3:

- keys are **per board/revision**, generated in an offline ceremony under
  the same custody discipline as §1.1, never shared across boards;
- injection (into the FIT build, and for I4 into fuses) is a manufacturing
  step with a verification record (`docs/design/manufacturing.md` §2, §7);
- rotation and revocation limits are board silicon facts and must be
  recorded per board before, not after, keys are fused — for many SoCs a
  fused hash is unrotatable, which makes the ceremony's custody rules
  stricter than TUF root's, not looser.

### 1.6 Production private material is never in git — **[implemented]** where checkable

The rule, and its mechanisms: `ca/` and `pkgs/rauc-sign/.devkeys/` are
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

Custody is the ceremonies' §1.5/§2.1 rules; the operational summary the
release owner is accountable for: offline material (TUF root, RAUC CA) on
sealed media in two locations with written custody minutes; online material
(TUF `targets`/`snapshot`/`timestamp`, RAUC signer) on the release host only;
no production key on a build machine and no signing in CI
(`docs/design/release-signing.md` §4); custody changes are rotation events
(§1.1), not handovers of media.

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
exploitation), in order: **contain** (suspend publication; a compromised TUF
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
