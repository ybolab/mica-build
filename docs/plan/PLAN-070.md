# PLAN-070 Design the factory record: the out-of-image trust and update seam

- **status**: draft
- **createdAt**: 2026-09-03 11:11
- **approvedAt**: (pending)
- **relatedTask**: (none — design only; task records are owed on approval)

## Context

### The correction this record has to make first

The request that produced this plan asked for "the remote server configured in
`ca/`". That is the wrong directory and the correction belongs in the record
rather than in a reviewer's head.

The repository-root `ca/` is a **build-time seam holding trust MATERIAL and
nothing else**. `rootfs/build.sh` stages `ca/ca.cert.pem` into the image at
`/etc/rauc/keyring.pem`, inside the read-only dm-verity root; the bundle build
signs with `ca/signer.{cert,key}.pem`; `verify/src/checks-root.ts`'s
`packed-keyring-from-ca` fails any assembled image whose keyring is not
byte-equal to `ca/ca.cert.pem`. The directory is gitignored, and a build that
finds it empty generates a development-grade root and marks it `ca/GENERATED`.
Its entire meaning is *"the CA this image trusts"*.

Putting an update server URL there would mix configuration into the one
directory whose whole value is that it holds nothing but trust material, and it
would bake a per-deployment fact into an artifact that is byte-identical across
every device built from it. `ca/` is not extended by this plan and no key in it
is added, renamed or read differently.

What the request actually needs is a **second seam**, out of the image, that a
factory or a field provisioning step writes and that survives the operations a
device undergoes in service. That is what this plan designs, and it is named
the **factory record** throughout so that no reader confuses it with `ca/`.

### What the tree already has

- **Trust, baked**: `/etc/rauc/keyring.pem` from `ca/`, as above. `/etc` is
  the read-only squashfs, replaced whole by every A/B update, which is what
  makes `docs/design/release-signing.md` §2.4's CA rollover work and what
  makes the image its only writer.
- **Trust, unprovisioned**: the TUF pinned root. `pkgs/rauc-sign` builds and
  verifies the four-role repository and `rauc-update` walks it from
  `/usr/share/mos/uptane/root.json`, but **no shipped mechanism puts that file
  on a device.** `docs/design/release-signing.md` §2.3 and §2.5 and
  `pkgs/rauc-sign/README.md` all record the anchor-provisioning decision as
  open, with the same three candidates: image-baked, a provisioning file on
  STATE/META, and a signed USB import. `docs/design/updates.md` §7 lists the
  anchor among the deployment contract still owed.
- **Update configuration**: `update-policy.toml` on STATE, read fresh per
  decision by `pkgs/mosd/mosd/src/update_policy.rs`. `source.url` has **no
  default** — an unset URL means no online source and the offline import path
  remains. That absence is load-bearing and this plan preserves it.
- **Device identity**: `provisioning.deviceId`, 16 CSPRNG bytes drawn on the
  device at first boot, never in the image
  (`docs/design/provisioning.md` §2–3).
- **An offline document transport, shipped**: `mos-provisioning-import`
  mounts the BOOT partitions then removable media read-only before mosd
  starts, and `provisioning_doc.rs` parses, totally validates and applies
  `mos-provisioning.toml` through exactly one `Store::save`. It verifies no
  signature; its authorisation is physical possession of the medium, bounded
  by the already-claimed rule.
- **META, mounted and nearly empty**: `boards/cx3576/board.env` declares a
  16 MiB ext4 META partition; `rootfs/overlay/etc/fstab.in` mounts it at
  `/mnt/meta` and describes it as *"update/appliance metadata. Precious,
  small."* Today the only thing on it is RAUC's `rauc.status`.
- **A reset taxonomy that already tabulates META**:
  `docs/design/recovery.md` §2.1 gives META `unaffected` for tiers 1 and 2,
  `preserved` for tier 3 (full factory reset) and `cleared` for tier 4, and
  `pkgs/mosd/mosd/src/reset.rs`'s `Roots` type has no member for META, so
  those cells are a property of the type rather than a claim about code.

### What is missing

There is no place on a device that says *which vendor built it, which trust
roots it honours beyond the baked one, where its updates come from, and
whether it may talk to a fleet plane* — and that survives a factory reset.
Every one of those facts is per-product configuration that cannot be baked
(the image is fleet-identical) and must not be re-invented per device (identity
is minted on-device and is deliberately not a factory input).

## Proposal

### 1. One file and one directory on META

```
/mnt/meta/factory/factory.toml     the record
/mnt/meta/factory/material/        the public trust material it names
```

`factory.toml`, version-tagged the way the provisioning document is:

```toml
version = 1                       # the FACTORY RECORD schema version, independent
                                  # of the settings SCHEMA_VERSION and of the
                                  # provisioning document's own `version`

[product]
vendor = "example"                # labels only; no behaviour keys off them
model  = "mos-appliance"

[trust]
raucKeyringAdd = "material/vendor-ca.cert.pem"   # ADDED to the baked keyring
tufRoot        = "material/root.json"            # REPLACES the image fallback

[update]
url     = "https://updates.example/tuf"
channel = "stable"
policy  = "check"                 # off | check | auto — the shipped default

[fleet]
enabled = false                   # off by default; PLAN-072 owns the rest
url     = "https://fleet.example"
```

Every section is optional except `version`. Unknown keys are load errors, for
`update_policy.rs`'s reason: a mistyped key must fail loudly rather than
silently configure nothing.

### 2. WHERE: META, and why not the two alternatives

**META**, because the survival profile a factory record needs is exactly
META's, and META's row is already written:

| Operation | Factory record | Why |
|---|---|---|
| Tier 1 configuration reset | **unaffected** | `reset.rs` reaches STATE and the DATA pool; its `Roots` type has no META member |
| Tier 2 application-data reset | **unaffected** | same |
| Tier 3 full factory reset | **preserved** | `docs/design/recovery.md` §2.1 already fixes META as `preserved` here, for the META-lockdown reason. A factory-reset device that could no longer find its update server would be a support disaster manufactured by the reset button |
| Tier 4 secure wipe | **cleared** | with META, bench-dependent per that table's footnote |
| A/B update | **unaffected** | RAUC writes ROOTFS and BOOT slots only |
| Slot rollback | **unaffected** | a rollback is a boot-order change; no partition is written |
| Whole-disk reflash | **REPLACED** | `build/src/mkimage-cx3576.ts` builds a fresh `meta.img` into the full-disk image. The record is gone and must be re-applied |

That last row is the only one with a cost, and §5 is the procedure that pays
it. It is stated as a row and not as an exception: the factory record inherits
META's column verbatim and adds no new semantics to the tier taxonomy.

**Not STATE.** STATE is `re-seeded` by tier 1 *and* tier 3. A trust anchor on
STATE is an anchor a configuration reset destroys, which is precisely the
tradeoff `pkgs/rauc-sign/README.md` names against the provisioning-file
candidate (*"a device that loses STATE loses its anchor"*). Choosing META
answers that objection rather than accepting it.

**Not a dedicated partition.** `boards/*/board.env` is the single source of
truth for the partition table and nothing edits it after the assembler writes
it. Adding a twelfth partition changes the layout for every board, and a device
already in the field cannot adopt it without a whole-disk reflash — which is
the one operation that destroys the record anyway. META is already there,
already precious, already mounted, and already declared to hold "update and
appliance metadata". This *is* update and appliance metadata.

**Not the BOOT partition** as the resting place. BOOT is a FAT A/B pair whose
slots RAUC replaces, and `mos-provisioning-import` already owns a fixed
filename at its root. BOOT is the *transport* (§3), not the home.

### 3. WHO writes it, and when: both, through the transport that already exists

The factory record is carried by the **shipped provisioning document
transport**, extended — not by a second transport. `docs/design/provisioning.md`
§4.1 exists to stop a second grammar from appearing, and a second medium scan
with a second filename and a second validator would be exactly that.

Concretely: the same `mos-provisioning.toml`, at the same fixed path on the
same two media, gains a top-level `[factory]` table whose body is the record of
§1. One mount, one parse, one total validation pass — and **two commit
targets**, because the settings sections commit through `Store::save` onto
STATE and the factory section commits onto META. Both are atomic in the same
temp-file-plus-rename sense, and the whole document still validates before any
of it is applied, so a document with one bad field applies nothing to either
target.

**At manufacture.** A factory station writes the medium once per batch (§4:
the record is per-product) and the device consumes it on first boot. Nothing
new is needed at the station — the station already flashes an image and
witnesses first boot, per `docs/design/manufacturing.md` §2, and this adds one
file to the medium it already handles. That document's §1 already anticipates
this: *"Production trust anchors (RAUC keyring, TUF root), when their
provisioning channel exists, are versioned public inputs with their sha256
checked at injection."* This plan is that channel.

**At first provisioning in the field.** A device that reaches an integrator
with no factory record takes one from the same medium by the same path. This is
the case a reflashed spare board lands in (§5).

**Authorisation, and why it differs from the settings sections.** The
already-claimed rule — apply only while `access.webAdmin` is absent — is what
makes the unsigned transport safe for settings, because a settings document can
rewrite a fielded device's administrator password. The factory section needs a
different rule because it carries trust material:

- **First write** (META holds no record): permitted while the device is
  unclaimed, same rule, same reason — physical possession of the boot medium
  already implies full control (`docs/design/access.md` §7).
- **Later write** (a record exists): **refused**, with one exception. A
  document whose `[trust]` anchors chain from the currently pinned ones — the
  TUF root-rotation rule the verifier already walks — is a rotation and is
  accepted. Anything else needs a physical-presence assertion
  (`docs/design/recovery.md` §4), audited.

That asymmetry is the point: the settings half is gated on *nobody owns this
device yet*; the trust half is gated on *the new anchor is reachable from the
old one*. A single rule cannot express both.

### 4. WHAT it contains, and the trust-layering rules

#### 4.1 Per-product, never per-device

Nothing in the record is per-device and nothing in it is secret. Consequences,
all deliberate:

- **One medium image serves a whole batch.** The station holds no per-device
  factory state, which is the difference between "add a file to the flashing
  step" and "build the factory tooling `docs/design/manufacturing.md` §0 says
  does not exist".
- **It cannot carry a device credential**, and must not be extended to.
  Identity is CSPRNG-drawn on the device and never issued
  (`docs/design/provisioning.md` §3.1, `docs/design/manufacturing.md` §5); a
  per-device factory record would reintroduce the injected-identity shape those
  two documents structurally exclude.
- **It is not credential material.** Unlike a provisioning document carrying an
  administrator password and a WPA2 PSK (which
  `docs/design/provisioning.md` §4.1.6 tells operators to treat as secret), the
  factory record holds public trust material and public URLs. An attacker who
  reads it learns what the vendor's own download page says. That is why it can
  be read back over the management API (§6) while the provisioning document
  deliberately cannot.

#### 4.2 The RAUC keyring: the baked one stays authoritative; the record may only ADD

The effective keyring is `concat(baked, factory-added)`, and the factory record
**cannot remove or replace** the baked CA.

Why add-only:

- `packed-keyring-from-ca` asserts the shipped keyring is byte-equal to
  `ca/ca.cert.pem`. A record that replaced it would leave that gate passing at
  build time while a fielded device trusted something the build never saw — the
  gate would be measuring a file nothing reads.
- The keyring RAUC verifies against is an OpenSSL CA file: concatenated PEMs,
  every one trusted. `docs/design/release-signing.md` §2.4's rollover *is* that
  union, and `tests/rauc-trust-negative-test.sh` already proves the three
  properties a two-certificate keyring must have. Adding a certificate from
  META is the same mechanism with a different writer.
- **They therefore never "disagree".** The union is the answer: a bundle
  chaining to either CA is accepted. The question "which is authoritative" has
  no case to arbitrate, and that is a property of the mechanism rather than a
  rule this plan invents.

**Mechanism.** `pkgs/rauc/system.conf.in` names `/etc/rauc/keyring.pem`, which
is inside the verity squashfs and cannot be edited. The effective keyring
reaches that path the way `/etc/ssh` reaches its own — a seed plus a bind
mount, the shape `docs/design/release-signing.md` §2.3 already names as what a
provisioned keyring would need. The seed unit composes baked-plus-added into a
file outside the verity root and binds it over the path. Two verifier checks
move with it: `rauc-keyring-path` still asserts the rendered config names
exactly one path, and `packed-keyring-from-ca` still asserts the *baked* file
is byte-equal to `ca/ca.cert.pem` — the bind's base, not its result.

**What this closes and what it does not.** It closes
`docs/design/release-signing.md` §2.3's first uncovered case: a device that
missed a CA rollover's overlap window can be handed the incoming CA on a
medium instead of being reflashed. It does **not** close the second: rotation
away from a CA that is already compromised needs *subtraction*, and add-only
cannot subtract. §7 carries that as an open question with both options priced,
because allowing subtraction turns META write access into a device-stranding
primitive and that is a decision, not an implementation detail.

#### 4.3 The TUF root: the record WINS, the image is the fallback

Opposite rule, deliberately. Precedence, not union:

- A TUF repository has exactly one root of trust. Two pinned roots are two
  repositories, not a rotation-friendly set — the union that is natural for an
  OpenSSL CA file is meaningless here. The asymmetry between §4.2 and §4.3 is a
  property of the two mechanisms and not an inconsistency.
- The record's root is a **pin**, and TUF's own rotation rule means a pinned
  device walks itself forward across cross-signed root versions without the pin
  ever being replaced (`pkgs/rauc-sign/README.md`). A factory-pinned root
  therefore needs no update channel of its own.
- Pinning at the factory is what enables **per-fleet or per-customer roots**,
  which is the capability the README names as the provisioning-file candidate's
  whole benefit, and the objection it raises against that candidate — anchor on
  mutable storage that STATE loss destroys — is answered by META, which
  survives all three reset tiers.
- Replacement is safe *here* in a way §4.2's is not: a factory root replaces
  the image fallback at manufacture, before the device protects anything. Once
  pinned, §3's rule binds — a later change must chain from the pinned root, or
  arrive with physical presence.

The image-baked `/usr/share/mos/uptane/root.json` stays as the fallback for a
device with no record, and shipping it is the deployment item
`docs/design/updates.md` §7 already owes.

#### 4.4 The update source and the fleet switch

`[update].url`, `.channel` and `.policy` seed what
`update-policy.toml` holds today. **Seeding is not owning**: the policy file
stays the operator's, and an operator edit outranks the factory value on every
subsequent decision. The record answers "what does this device do before anyone
configures it", not "what may this device be configured to do". A record that
could pin the policy would be a vendor lock the operator cannot see in the file
they are editing.

`[fleet].enabled = false` is the default and PLAN-072 owns everything past it.
It lives here rather than in the settings tree so that "may this device talk to
a fleet plane at all" is answered by the same tier that answers "which trust
roots does it honour" — both are facts about the product, not about the
installation.

### 5. Absent, malformed, unreachable — fail closed and stay usable

The requirement is that a device with no factory configuration must still boot,
still be manageable on the LAN, and must never silently fall back to a default
server. Four states, four answers:

**Absent** — the state of every device built from this tree today, and a
supported steady state, not an error. The device boots, self-provisions,
derives its hostname from its identity and is fully manageable over apid on the
LAN. Update source: none, so `check` and `fetch` are refused with the reason
they are refused with today (`source.url` has no default), and the offline
lockbox import path remains. Fleet: off. Trust: the baked keyring only, and no
TUF anchor unless the image ships the fallback.

**No default server, and a check that says so.** There is no built-in vendor
URL anywhere in the tree and this plan adds none. That is made mechanical
rather than promised: a verifier check over the assembled image fails any
build in which the update client, mosd or the factory-record reader carries a
compiled-in scheme-and-host default for an update or fleet endpoint. A rule
whose violation nothing can detect is the prose `docs/design/recovery.md` §0
warns about.

**Malformed** — fail closed on the *actions*, fail open on the *device*. The
shape `update_policy.rs`'s `LoadedPolicy` already uses: the reader always
answers with either a record or the reason it could not be read, never
neither. While the reason is set, every capability the record could enable —
check, fetch, install, fleet registration — is refused with a message naming
the file, and everything else works. It is deliberately **not** the shape
`provisioning.rs` uses, which aborts mosd startup: there the failure means the
device has no credential and is not usable at all, whereas here the failure
means one optional capability is unavailable.

**Named material missing or corrupt** — refused, and specifically **not**
silently downgraded to the baked anchors. "The record said use root X, X is
unreadable, so I used the image's" is a downgrade an attacker forces by
corrupting one file on a partition the physical-access boundary already grants
them. Named state, refused actions, visible reason.

**Server does not answer** — the existing behaviour and no new one: the
lifecycle records `failed` with the client's stderr tail, the next scheduled
check retries, the bounded subprocess timeouts apply. No escalation and no
alternate source. Stated as the autonomy claim
`docs/design/security-model.md` requires: **no operation on this device
requires the update server or the fleet plane to answer.** Nothing degrades as
a function of time since last contact.

### 6. Reading it back

`GET /api/v1/provisioning/status` gains the record as loaded — version, the
product labels, the update URL and channel, the fleet switch, the digests of
the named trust material, and the load error when there is one. It returns the
whole record because §4.1 established the record is not secret; the redactor
still covers the settings subtrees beside it.

The digests matter more than the values: an operator debugging "why won't this
device update" needs to know *which* anchor it pinned, and a digest answers
that without shipping a certificate through an API.

### 7. Open questions — decisions with costs, not guesses

1. **May the factory record subtract a CA?** Add-only (§4.2) leaves CA
   compromise recoverable only by physical reflash, which is today's position
   stated honestly. Allowing subtraction — gated on physical presence and
   audited — buys compromise recovery at the cost of making write access to
   META a way to strand a device (remove the CA that signs its updates and it
   accepts nothing). **Recommended: add-only for this plan**, with subtraction
   as a named follow-up that ships with the physical-presence gate
   `docs/design/recovery.md` §4 designs and not before.
2. **Does the image ship a fallback TUF root at all?**
   `docs/design/updates.md` §7 owes one. Shipping it means a device with no
   record can still verify the vendor's public repository; not shipping it
   means an unprovisioned device has no online update path whatsoever. The
   second is more honest for a product sold to integrators who pin their own
   root; the first is friendlier for a vendor-run channel. This is the same
   product decision as who runs the update service, and it belongs with
   PLAN-054's open list.
3. **Does the factory record carry a serial number?** Manufacturing wants one
   in the per-device record (`docs/design/manufacturing.md` §3); the factory
   record is per-product and cannot carry it. Either serials stay entirely in
   the manufacturing system and never reach the device, or a second per-device
   META file is designed. Not decided here.

## Risks

- **META becomes load-bearing for the first time.** Today META holds
  `rauc.status` and losing it costs a slot-status re-derivation. After this
  plan it holds the trust configuration, and a corrupt META is a device that
  cannot update. Mitigation is the §5 fail-closed reader plus the fact that
  the record is re-appliable from a medium at any time; there is no state in it
  that only the device knows.
- **A second trust surface exists where there was one.** Reviewers reason about
  `ca/` today; after this they must reason about `ca/` *and* the record. The
  add-only rule (§4.2) is what keeps the combination monotonic and reviewable,
  and it is the reason the recommended answer to open question 1 is "no
  subtraction".
- **Extending `mos-provisioning.toml` touches shipped, tested code.**
  `provisioning_doc.rs` is total-validation, never-quotes-a-value,
  one-`Store::save` code with a defect history recorded in
  `docs/design/provisioning.md`. A second commit target is the largest change
  that file has taken since it shipped, and the atomicity argument has to be
  re-made for two targets rather than assumed to carry over. Specifically: a
  power loss between the META commit and the STATE commit must leave a state
  the next boot completes, not a blend.
- **The bind-mounted keyring changes what `/etc/rauc/keyring.pem` means.**
  Two verifier checks currently pin that path's contents; after the bind, one
  of them is measuring the bind's base. Getting that wrong silently makes the
  image gate stop measuring what RAUC reads — the exact defect shape
  `docs/design/provisioning.md` §3.3 records for the Argon2id-into-shadow
  failure, where every check stayed green.

## Scope

In scope: the factory record's format, storage tier, transport, authorisation
rules, trust-layering semantics, failure behaviour and read surface; the row it
occupies in `docs/design/recovery.md` §2.1; the verifier checks that hold the
no-default-server rule and the keyring bind.

Out of scope: factory station tooling and the per-device manufacturing record
(`docs/design/manufacturing.md` stays `[proposed]`); the update policy
semantics (PLAN-071); anything the fleet switch turns on (PLAN-072); META
lockdown (`docs/design/access.md` §5.2, an independent decision that happens to
share the partition); secure wipe of META.

### Implementation backlog — estimated separately from approval

Sized in slices, each independently verifiable. No slice is authorised by
approving this plan; each becomes a task record when it is scheduled.

| # | Slice | Size | Gate |
|---|---|---|---|
| F1 | Factory-record reader in mosd: parse, total validation, `deny_unknown_fields`, the `LoadedPolicy`-shaped error, live-state exposure | M | unit tests over every malformed shape; a record and an error, never neither |
| F2 | META commit path with the two-target atomicity argument and its replay test | M | interrupted apply replayed against the uninterrupted path produces the same device |
| F3 | `[factory]` section in `mos-provisioning.toml`, its validators, and the first-write / rotation / physical-presence authorisation rules | M | a document with one bad field applies nothing to either target |
| F4 | Effective-keyring seed and bind, `system.conf` alignment, and the two verifier checks re-pointed | M | `packed-keyring-from-ca` measures the bind base; an image whose bound keyring is not baked-plus-record fails |
| F5 | TUF root precedence and the refuse-don't-downgrade rule for missing material | S | corrupting the named root refuses; it never falls back |
| F6 | Image-baked TUF fallback root (owed by `docs/design/updates.md` §7 independently) | S | gated on open question 2 |
| F7 | No-compiled-in-endpoint verifier check | S | fails a build with a planted default URL |
| F8 | `GET /api/v1/provisioning/status` extension and its console read surface | S | — |
| F9 | Design-doc updates: `recovery.md` §2.1 row, `release-signing.md` §2.3, `provisioning.md` §4, `manufacturing.md` §1–2, `security-model.md` §3 | M | `make docs-verify` |

Rough shape: F1–F3 are the record; F4–F6 are the trust chain; F7–F9 are the
gates and the paper. F4 is the slice with the highest chance of a silent
defect and should not be scheduled in the same slice as anything else.

## Approval boundary

**This plan ends at an approved seam.** What approval means, exactly:

- the record lives on META, per-product, add-only for the RAUC keyring and
  precedence for the TUF root;
- it rides the existing provisioning-document transport with the split
  authorisation rule of §3;
- absence is a supported steady state and there is no default server;
- open questions 1–3 are answered before the slices that depend on them
  (F4 depends on 1; F6 depends on 2; nothing depends on 3).

Approval does **not** authorise writing any of the backlog above. Each slice
takes a task record and its own proposal.

## Alternatives

1. **Put the configuration in `ca/`.** Rejected in the Context: `ca/` is
   build-time trust material inside a fleet-identical artifact, and a
   per-deployment server URL is neither build-time nor trust material.
2. **Put the record on STATE.** Rejected: tiers 1 and 3 re-seed STATE, so a
   configuration reset would destroy the trust anchor. This is the objection
   `pkgs/rauc-sign/README.md` already raises against the provisioning-file
   candidate; META answers it.
3. **A dedicated partition.** Rejected: the partition table is fixed per board
   and a new partition is unreachable for every fielded device without the one
   operation that erases the record anyway.
4. **A second transport (signed USB import) for the trust material alone.**
   Rejected as the first slice, not on the merits — a signed import with the
   chain rule is strictly better authorisation than physical possession, and it
   is `pkgs/rauc-sign/README.md`'s third candidate. But it needs a trust root
   for the import itself, which is the problem the factory record exists to
   solve; it is the natural *second* channel once a record is pinned, and it is
   recorded here rather than built now.
5. **Keep the TUF anchor image-baked and skip the record's `[trust]` half.**
   Rejected: it is the simplest option and it forecloses per-customer roots
   permanently, and it leaves both of `docs/design/release-signing.md` §2.3's
   uncovered cases uncovered. Named because it is genuinely cheaper and a
   product that never sells per-customer trust should take it.
6. **A single plan covering the record, the update module and the fleet
   plane.** Rejected; the argument is in PLAN-072's Approval boundary and is
   summarised there rather than duplicated.

## Annotations

- 2026-09-03: Created as the first of three records answering the user's
  request for a factory seam, an update module and a cloud registration
  capability. Split from PLAN-071 and PLAN-072 because the three carry
  different approval boundaries; the split is argued in PLAN-072.
- 2026-09-03: The request as phrased asked for "the remote server configured in
  `ca/`". The Context records the correction: `ca/` holds trust material only
  and is not extended by this plan.
