# Design: Recovery — reset tiers, the recovery decision tree and physical presence

> What an operator does when a device is wedged, locked out or being retired,
> ordered least-destructive first, with every reset tier naming its effect on
> identity, calibration, STATE, DATA, META and both system slots BEFORE any of
> it is built. Companion to `docs/design/access.md` (the lockout this document
> answers), `docs/design/security-model.md` (the boundaries it must not
> undermine), `docs/design/updates.md` (the slot lifecycle it reuses),
> `docs/design/storage.md` (the tiers it clears) and
> `docs/design/manufacturing.md` (the identity rules it obeys).
> Implements the design half of PLAN-048 / RFCT-284.

## 0. How to read the status markers

The discipline is `docs/design/access.md` §0's and `docs/design/security-model.md`
§0's, and it matters more here than anywhere: a recovery path that exists only
as prose is discovered to be absent by the one operator who needed it. Every
section describing a **mechanism** carries one of:

- **[implemented]** — code exists and is named, by path.
- **[partial]** — some of it exists; what is missing is named.
- **[proposed]** — no code at all; prose only.
- **[not implemented]** — deliberately no code, and the absence is the
  position rather than a gap.

**This document was written with almost everything [proposed], and that was
the point:** PLAN-048 is explicit that reset modes are built only after their
tier semantics are agreed, so §2, §4 and §5 fixed the semantics first and the
implementation followed them. What now ships is §2's tiers 1-3, §4's gate and
§5's credential recovery, each marked at its own section with what is still
missing named. The *repair tier* (§6.2) is still [proposed], and §4's own half
— a BOARD with an implemented physical recovery action to declare — is the gap
§4 names and §8 carries as bench-dependent.

Sections without a marker (§1, §6, §7) state principles and limits rather than
one mechanism — §6's subsections carry their own.

## 1. The boundary this design inherits, and what recovery may therefore claim

`docs/design/security-model.md` §1 states the axiom — physical possession of
the boot medium implies full control — and §5 defines the I1–I4 ladder that
says when it weakens. **Both mos boards stand at I1** (§5), so the axiom holds
in full on every board that exists: the person holding the hardware can already
rewrite the rootfs, read STATE and reflash the medium.

Two consequences run through everything below, and no section may quietly
contradt them:

1. **Recovery adds serviceability, not a trust boundary.** A physical-presence
   recovery entry grants an operator, in a supported and audited form, a
   capability an attacker with the same access already has by other means. Its
   security argument is *audit and accident-avoidance*, never *keeping an
   attacker out*.
2. **Nothing here may be reachable without that presence.** The same axiom that
   makes the presence gate honest makes a *remote* recovery path a plain
   authentication bypass, because it would grant over the network what §1 grants
   only to the hand. PLAN-048's first risk is exactly this.

Scope: this document owns reset semantics, the operator decision tree, the
presence contract, credential recovery, both-slots-failed and the repair tier.
It owns neither an interactive rescue distribution nor backup contents
(PLAN-049, and `docs/design/storage.md` §7's `backupRestore` answer), and it
does not restate the update lifecycle, the storage layout or the slot state
machine — it cites them.

## 2. The reset tier taxonomy — **[partial]**

**Tiers 1, 2 and 3 are [implemented]; tier 4 is [not implemented].** The
vocabulary is `pub enum ResetTier {` in
`pkgs/mosd/mosd-settings/src/model.rs`, which has exactly three members, so
no spelling of secure wipe is a request this device can accept — the absence
is the position and not a gap (footnote [^wipe], §7). The tiers execute in
`pkgs/mosd/mosd/src/reset.rs` and are staged by `POST /api/v1/reset` in
`pkgs/mosd/apid/src/routes.rs`; §2.1's table below is what those tests assert,
cell for cell, including the `preserved` and `unaffected` ones.

**Four tiers, and no fifth.** A device operation that destroys operator state
is one of these four or it is not offered; "reset" without a tier name is not
a supported request.

1. **Configuration reset** — return the modelled settings to their schema
   defaults. The device is the same device, running the same software, holding
   the same data, configured as it left the factory.
2. **Application-data reset** — remove operator applications and their data.
   The platform's own configuration and credentials survive.
3. **Full factory reset** — return the device to its first-boot state:
   settings, applications, operator data and management credentials all go.
   Identity, calibration and the installed software do not.
4. **Secure wipe** — end the device's life with an operator's data on it. The
   promise is about the *medium*, not the filesystem, and it is the only tier
   that removes identity.

### 2.1 The table

Every cell is exactly one of four words, and they are not synonyms:

- **`preserved`** — the tier is in reach of this store and deliberately keeps
  it. Keeping it is a decision this document makes, and a reader may hold the
  implementation to it.
- **`cleared`** — the tier removes the contents and puts nothing back. Read
  `cleared` as *unreachable through the filesystem*, not *erased from the
  medium*, in every row except tier 4; §7 is why that distinction has a whole
  tier to itself.
- **`re-seeded`** — the tier removes the contents and the next boot recreates
  them at their first-boot defaults, by the code that creates them on a virgin
  device (`mos-data-layout` for the DATA skeleton, the settings defaults and
  first-boot provisioning for STATE).
- **`unaffected`** — outside the tier's reach entirely. No code path of the
  tier opens this store, which is a stronger statement than `preserved`.

| Tier | device identity | calibration data | STATE | DATA (`/mos`) | DATA (`/srv`) | META | system slot A | system slot B |
|---|---|---|---|---|---|---|---|---|
| 1 configuration reset | preserved | preserved | re-seeded [^cfg] | re-seeded [^cfg-mos] | preserved | unaffected | unaffected | unaffected |
| 2 application-data reset | preserved | preserved | preserved [^apps-state] | re-seeded [^apps-mos] | cleared | unaffected | unaffected | unaffected |
| 3 full factory reset | preserved [^identity] | preserved [^identity] | re-seeded | re-seeded | cleared | preserved [^meta] | unaffected [^slots] | unaffected [^slots] |
| 4 secure wipe | cleared | cleared | cleared | cleared | cleared | cleared | cleared | cleared [^wipe] |

**What now enforces each row.** `pkgs/mosd/mosd/src/reset.rs` reaches exactly
two roots — the DATA pool and the STATE partition — and its `Roots` type has no
member for META and none for a slot, so the `unaffected` and `preserved` cells
in those three columns are a property of the type rather than a claim about the
code. Slot vocabulary stays where `docs/design/updates.md` §5.2 put it,
`validate_mark` and `rollback_eligibility` in `pkgs/mosd/mosd/src/rauc.rs`,
which the applier neither calls nor duplicates. Identity, calibration and the
per-device secrets survive because nothing in the applier opens them, and a
test drives a populated pool through every tier asserting what SURVIVES and not
only what goes — a tier that cleared more than its row is the failure mode here,
and only a survival assertion catches it.

The tier column names the *only* four resets; the whole-disk reflash is not in
this table because it is not a reset — it replaces every partition including the
system slots, and its semantics are `docs/design/access.md` §9.2's, not this
document's. §3 places it in the operator ordering, between tiers 3 and 4.

[^cfg]: Tier 1 re-seeds the modelled settings tree and keeps three things on
    STATE that are not configuration: the identity record, the apid management
    credential (`access.webAdmin`), and the per-device secrets
    (`docs/design/provisioning.md` §3.2). Since PLAN-070 §5.2 the survivor list
    is exactly what STATE still holds, because everything tier 1 used to clear
    moved to `/mos/config/` and is cleared by the cell beside this one. A reset that dropped the credential
    would be a lockout dressed as a settings action, and it would also be a
    remote credential-clearing primitive — §5 is where a credential is
    deliberately replaced, under §4's authority and nowhere else.

[^cfg-mos]: **Only `config/`**, and the rest of `/mos` is untouched by tier 1
    exactly as it was before: `ui/`, `apps/`, `containers/`, `updates/`,
    `home/` and `root/` are not opened. `/mos/config/` holds the device's
    system configuration (PLAN-070 §5.2, `docs/design/mosd.md` §5.1a), and a
    subtree named `config` surviving the *configuration* reset would be a
    contradiction a reader trips over — after a tier 1 the device would still
    be following a channel the previous operator chose. The disposition is
    decided **for the directory** rather than per document, which is what keeps
    the shipped safety property working after the mechanism changed: a document
    added to `/mos/config/` by any subsystem is cleared by default, including
    one this daemon does not model, because the tier empties the directory
    rather than enumerating what is in it. The settings the tier hands back to
    first-boot provisioning are re-seeded by the STATE half in the same save,
    which is the `re-seeded [^cfg]` cell beside this one.

[^apps-state]: Tier 2's only write to STATE is the removal of the application
    enrolment records the application layer owns there — the Quadlet units and
    unit drop-ins on STATE that `docs/design/containers.md` and
    `docs/design/ro-root.md` §4 describe. Settings, identity, credentials and
    the audit trail are not opened. Named as an exception rather than folded
    into `re-seeded`, because a unit file surviving the payload it starts is a
    boot-time failure loop, and because a reader deserves to know the one place
    this tier touches STATE at all.

[^apps-mos]: `/mos` is the system-owned namespace and tier 2 does not empty it.
    It clears the application-owned subtrees (`apps/`, `containers/`) and lets
    `mos-data-layout` recreate them at their declared modes. `ui/`, `config/`
    (system configuration is not application data), `updates/` (a verified
    bundle is not application data) and the `home/`/`root/` backing directories
    are not opened. `/srv` is `cleared` rather than `re-seeded`
    because the product gives that namespace to the operator: mos recreates the
    mount point, never its contents.

[^identity]: **A full factory reset does not re-mint identity or calibration,
    deliberately.** Identity is CSPRNG-drawn on the device and never re-issued
    (`docs/design/provisioning.md` §3.1, `docs/design/manufacturing.md` §5), so
    re-minting it on a serviceable device silently severs every fleet-side
    record that names it — a support outcome strictly worse than the lockout the
    reset was answering. Calibration is unit-specific data no field operation
    can recreate. The operation that *does* replace identity is the whole-disk
    reflash, which mints a fresh `deviceId` on the next first boot because it
    replaces STATE outright (`docs/design/access.md` §9.2), and that is a
    property of replacing the partition, not a reset tier's decision.
    **mos ships no calibration store today.** The column is fixed here anyway,
    because RFCT-284 requires every tier to name its effect on calibration, and
    fixing the answer in advance means the store cannot be introduced without
    one.

[^meta]: META is `preserved`, not `re-seeded`, for one load-bearing reason
    already stated in `docs/design/access.md` §5.2: the proposed META lockdown
    is a one-way bit whose entire value is that no software action lifts it, and
    that section says in terms that factory reset must not clear it — "forgot
    the password" is self-serviceable, "un-lock the shell" is not. A tier 3 that
    re-seeded META would be precisely the software action the bit exists to
    exclude. Only the reflash and tier 4 reach META.

[^slots]: A reset resets *state*, not the software version. Neither system slot
    is written, re-installed, activated or condemned by any tier: the device
    keeps running the slot it booted, the other slot keeps whatever it holds,
    and slot changes stay the update lifecycle's (`docs/design/updates.md`
    §5.2, and §6.2 below for repair).

[^wipe]: Tier 4's row is a **specification of what the tier must achieve**, not
    a claim that a board achieves it. `cleared` here means the medium no longer
    yields the data, which requires a device-level primitive (eMMC sanitize,
    NVMe format-NVM) whose behaviour is a flash-translation claim nobody has
    verified on these boards — `docs/design/storage.md` §7 records `secureErase`
    as `unsupported` and gates it behind physical-media evidence. Every cell in
    this row is therefore **bench-dependent**: a board may implement tier 4 only
    once it has that evidence, and until then the honest operator answer is
    §7's, destroy the medium.

### 2.2 Rules that bind every tier

Each rule names what enforces it, because a rule with no enforcement is the
prose §0 warns about.

- **A tier names itself in the request and in the audit record.** There is no
  parameterless reset. The request body carries `tier` and nothing else, and a
  body without one is refused before anything is written; the trail records
  `reset-configuration`, `reset-application-data` or `reset-full-factory`, with
  the outcomes `staged` and `refused` (`pkgs/mosd/apid/src/routes.rs`).
- **A tier is replayable.** Power loss during a reset must leave the device
  either in the pre-reset state or in a state where re-running the same tier
  completes it; a reset is therefore staged as an intent record plus an
  idempotent apply, never as a sequence whose interruption is a third state.
  PLAN-048 requires this and it is the reason a reset is not "delete some
  directories". **The record is `reset` in the settings tree** (schema v12,
  `pub struct ResetSettings {` in `pkgs/mosd/mosd-settings/src/model.rs`,
  `docs/design/api.md` §3): apid commits it in ONE `SetSettings`, which is one
  `Store::save`, and mosd applies it before anything else on the next boot. The
  filesystem work runs first and is idempotent; the save that clears the record
  runs last, so a power loss leaves the record staged and the next boot
  finishes the job. Both halves are asserted — an interrupted tier replayed
  over its own half-done output is driven against the uninterrupted path and
  must produce the same device.
- **A tier never widens under failure.** If a tier cannot complete its own
  scope it fails and says so; it does not escalate to the next tier because the
  next tier's delete happened to succeed. The applier returns the error, leaves
  the record staged and writes no settings at all, so a failed tier is a tier
  that will be retried rather than one that half-happened.
- **Tiers 3 and 4 require §4 physical presence.** Tiers 1 and 2 are
  authenticated management actions. The line is drawn where the operation stops
  being self-serviceable: a device whose identity and credentials are gone
  cannot be handed back to its owner over the network. Tier 3 is refused
  without an assertion — 403 and `presence_required`, audited, nothing staged —
  and the refusal is asserted rather than promised.

## 3. The recovery decision tree, data-preserving first — **[partial]**

The *ordering* is this document's contribution and is normative; the nodes are
not uniformly new, so each carries its own marker — steps 1, 2 and 7 exist in
some form today and steps 3 to 6 and 8 do not. Least destructive first, and an
operator who reaches step *n* has established that steps 1..*n*-1 were
insufficient. The line after step 2 is the important
one in this document: **everything above it can be undone by rebooting;
everything below it destroys something that was on the device.**

### Reversible

**1. Read-only diagnosis** — **[implemented]**
- *Precondition:* apid answers, or the serial console is attached.
- *Fixes:* nothing. It decides which of the steps below is the right one, and
  most cases stop here.
- *Costs:* nothing.
- *Does not recover:* a device that does not boot far enough to answer — for
  that case the evidence path is §6.1's, not this one.
- *What to read:* `GET /api/v1/update` (lifecycle with reasons, slots,
  `booted_slot`, `primary`, `pending_not_confirmed`, `last_mark`),
  `GET /api/v1/storage/status` (tier readiness, the `/mos` write probe, media
  health), the diagnostics snapshot and the audit trail
  (`docs/design/updates.md` §5.4, `docs/design/storage.md` §2–3,
  `docs/design/diagnostics.md`).

**2. Guarded manual rollback** — **[partial]**
- *Precondition:* the device boots, the operator can authenticate, and the
  *other* slot holds a system that booted successfully before. The guard
  enforces that last one by derivation rather than by reading it; the bullet
  below states the premise that derivation stands on.
- *Fixes:* a bad update — a slot that boots but misbehaves, which the automatic
  attempt-counter fallback never catches because the slot does boot.
- *Costs:* one reboot, and the condemned slot stops being a rollback target.
  No operator data is touched.
- *Does not recover:* anything caused by STATE or DATA content, because both
  survive the switch; a slot that cannot boot at all (the bootloader already
  handled that, §6.1); a lost credential.
- *Mechanism, and no second state machine:* the vocabulary is RAUC's own and
  already exists — `good`/`bad` on `booted`/`other`, validated by
  `validate_mark` in `pkgs/mosd/mosd/src/rauc.rs`, which deliberately refuses
  `active` and concrete slot names (`docs/design/updates.md` §5.2).
- *What ships:* the guard, as `rollback_eligibility` in
  `pkgs/mosd/mosd/src/rauc.rs` and `POST /api/v1/update/rollback` in
  `pkgs/mosd/apid/src/update_api.rs`. The action emits one mark, `bad` on the
  **booted** slot, and can therefore never mark the target `good` — an
  invariant with a test over the whole two-slot input space, not a review
  note. It refuses, 409 and a named reason each, when there is no alternate
  slot, when the alternate is the booted slot, when the alternate was never
  written or is marked bad, when the alternate is not the strictly older of
  the two installs, and when the booted slot is itself pending-not-confirmed.
  The verdict — `target`, `permitted`, `reason` — rides in the same
  `GET /api/v1/update` answer as `slots`, `booted_slot`, `primary` and
  `pending_not_confirmed`, so the state and the offer cannot disagree.
- *What the guard actually checks:* that **a rollback goes backward** — the
  target must be the strictly OLDER of the two installs, by
  `installed.timestamp`. It refuses a newer target (`alternate_is_newer`: a
  pending or skipped update, not a rollback target) and every case it cannot
  order at all (`install_order_unknown`: absent, unparseable or equal
  timestamps, the last being a factory flash that wrote both slots at once).
  It fails CLOSED on the unorderable case.
- *How the precondition is derived, and THE PREMISE it stands on:* "booted
  successfully before" is not observable directly — RAUC v1.13 (the version
  `pkgs/rauc/versions.env` pins) reports `boot-status` as the bootloader's
  attempt counter read as exhausted-or-not, and persists no mark history: its
  slot status file holds bundle metadata, an install-progress `status`, a
  checksum and `installed.*`/`activated.*`, and `mark-good` writes none of it
  — it touches the bootloader and an event log only. So the backward-only
  refusal *derives* the precondition from RAUC's invariant that **an install
  never writes the running slot**: a booted slot installed after the target
  means the device was running the target at that moment, which is a
  successful boot of it. **If that invariant ever stops holding — a future
  install path able to target the booted slot, or an out-of-band flash that
  also rewrites `installed.timestamp` — the derivation does not.** The
  invariant is RAUC's and the image pipeline's, not this tree's, so nothing
  here goes red if it changes; this bullet is the warning, and deliberately
  not a check. A direct confirmed-boot record would remove the dependency and
  is a separate design.
- *How well the premise is established — the conjunction it has become:*
  RAUC's target-selection code has now been read at the pinned v1.13, and the
  premise survives as a **conjunction with both halves verified**, not as a
  single unchecked invariant. **(i) RAUC only ever selects a slot it believes
  is inactive** — `select_inactive_slot_class_member` skips every slot whose
  state is not `ST_INACTIVE`, and no install option, config key or D-Bus
  argument can name a target; the bullet below is the reading. **(ii) Nothing
  on this device tells RAUC that the wrong slot is booted** — mosd names no
  target (`install_bundle` in `pkgs/mosd/mosd/src/rauc.rs` calls
  `InstallBundle` with the bundle path and an empty options map), the D-Bus
  install API carries no target or boot-slot key to pass, and the one lever
  that exists, `--override-boot-slot`, appears nowhere in this repository —
  not in `pkgs/rauc/`, not in the shipped `rauc.service`. This repository also
  recorded the behaviour independently of this guard, for a different feature
  and before it existed — `docs/design/updates.md`'s lifecycle table says the
  install task "is writing the other slot", authored in 98379d18. It stays a
  **premise** rather than a property of this tree: it is established *at the
  pinned version*, and a pin bump can move it, which is what the re-run recipe
  below exists for.
- *The RAUC v1.13 evidence, recorded here so a later reader hits it:*
  - *The pin is verified.* `pkgs/rauc/versions.env` pins v1.13 with
    `RAUC_SHA256=372828c2...87941`, and
    `git archive --format=tar v1.13 | sha256sum` recomputes exactly that. The
    findings below are byte-for-byte the rauc this image builds, not a guess
    about some rauc.
  - *The decisive contrast.* `r_mark_good` (`src/mark.c`) calls
    `r_boot_set_state` and writes an event-log line; it never calls
    `r_slot_status_save` and never touches `slot->status`. `r_mark_active`
    immediately above it DOES persist `activated_timestamp`/`activated_count`
    and save. The omission is deliberate rather than an oversight, and that
    contrast is what proves the mark is bootloader-only.
  - *`activated.*` cannot substitute.* It is written by `set_primary` — what an
    install does — so a slot activated but never booted still reads
    `activated_count >= 1`. It records activation, never a boot.
  - *How the install target is chosen, and whether it can be the booted slot.*
    It is the inactive slot — and *which* slot that is, is the overridable
    part. `do_install_bundle` calls `determine_target_install_group`
    (`src/install.c`), which per root slot class takes
    `select_inactive_slot_class_member`, a loop that skips every slot whose
    `state != ST_INACTIVE`. Nothing on the install path can name a slot
    instead: `RaucInstallArgs` (`include/install.h`) holds only
    `ignore_compatible`, `ignore_version_limit`, `transaction` and the
    bundle-access args, and `r_installer_handle_install_bundle`
    (`src/service.c`) accepts only `ignore-compatible`,
    `ignore-version-limit`, `transaction-id`, `tls-*` and `http-headers`,
    failing every other key with "Unsupported key". What IS overridable is the
    *input* to that filter — which slot counts as booted.
    `determine_slot_states` (`src/install.c`) labels `ST_BOOTED` the slot
    matching `r_context()->bootslot`, everything else `ST_INACTIVE`, and
    `bootslot` comes from `--override-boot-slot BOOTNAME` when given
    (`src/main.c`), otherwise from `get_cmdline_bootname` (`src/context.c`).
    Point that option at the *other* slot and the running slot is labelled
    inactive and becomes the target. `rauc.external` on the kernel command
    line is the blunter form of the same thing: bootslot becomes `_external_`
    (as does `/dev/nfs`), `determine_slot_states` marks EVERY slot inactive,
    and no slot is protected.
  - *Why that override is out of reach on this image.* `pkgs/rauc/Dockerfile`
    builds `-Dservice=true`, and `entries_install` compiles
    `--override-boot-slot` in only under `#if ENABLE_SERVICE == 0`
    (`src/main.c`) — so the shipped `rauc install` does not accept it, and in
    a service build `install_start` hands the job to the daemon over
    `InstallBundle` regardless. The option survives only on `entries_service`,
    the daemon's own argv, and the shipped unit is upstream's
    `ExecStart=… rauc --mount=/run/rauc/mnt service`. Separately, and worth
    knowing as the honest edge of the invariant: `rauc write-slot` DOES name a
    slot directly and refuses only a `readonly` one, never a booted one
    (`write_slot_start`, `src/main.c`). It is not the install path, and mosd
    never invokes it.
  - *What the shipped binary actually carries — measured, not inferred.* The
    bullet above says `--override-boot-slot` "appears nowhere in this
    repository", and that is a statement about this repository's own text. It
    is **not** a claim that the option is absent from the image, and a reader
    should not round it up into one: the string `override-boot-slot` **is
    present in the shipped `/usr/bin/rauc`, once, with its help text**.
    `-Dservice=true` compiles it out of the *install subcommand*, not out of
    the binary — it survives on `entries_service`. So an assertion of the form
    "the string is absent from the image" would be false about a correct image,
    and is deliberately not made anywhere in this tree.
  - *What is asserted instead, and by what.* The honest and sufficient
    statement is that **nothing on the device passes the option**, and that is
    now a gate rather than a paragraph:
    `rauc-units-never-override-boot-slot` (`verify/src/checks-rauc-units.ts`,
    in the register `verify/run.sh --verify` runs against every assembled
    image) reads every unit and drop-in under `/etc/systemd/system`,
    `/usr/lib/systemd/system` and `/usr/local/lib/systemd/system` in the packed
    root, folds continuation lines, and fails if any `Exec*=` command line that
    starts rauc names the option. It fails, too, when it finds *no* rauc
    command line: an "is X absent?" assertion passes for free over a tree it
    never read, so the search space is counted. This is the one failure the
    rest of the tree is silent about — a unit passing the flag inverts the
    derivation above while every other gate stays green. Half (i) of the
    premise — RAUC selecting only inactive slots — is not gated by anything and
    a pin bump can still move it; that is what the re-run recipe below is for.
  - *To re-run this reading at the next pin bump.* Clone the tag, confirm
    `git archive --format=tar <tag> | sha256sum` equals `RAUC_SHA256`, then
    read, in order: `determine_target_install_group`,
    `select_inactive_slot_class_member` and `determine_slot_states` in
    `src/install.c`; the `entries_install` / `entries_service` option tables
    and the `r_context_conf()->bootslot` assignment in `src/main.c`; and the
    `g_variant_dict_lookup` key list plus its "Unsupported key" rejection in
    `r_installer_handle_install_bundle` (`src/service.c`). Confirm
    `pkgs/rauc/Dockerfile` still builds `-Dservice=true`, since that is what
    keeps the override off the install command.
- *What does not ship, which is why this is still **[partial]**:* the reboot.
  The route changes the boot order and stops; realising it is a second,
  explicit `POST /api/v1/actions/reboot` through the safe-to-reboot gate
  (`docs/design/updates.md` §4), and nothing sequences the two. And the
  install-order rule is only as good as the clock at install time: a device
  that installed with a wrong clock can record an order that did not happen.
  That the bootloader then actually falls back is bench evidence, §6.1's, not
  a claim made here.

---

### Destructive — each step below loses something no earlier step lost

**3. Configuration reset — DESTRUCTIVE (configuration)** — **[implemented]**
- *Precondition:* the device boots and the operator can authenticate; the fault
  survives a reboot and a rollback, and looks like configuration.
- *Fixes:* an unreachable device that is unreachable because of its own network,
  access or policy settings, and any settings state too tangled to unpick.
- *Costs irreversibly:* every modelled setting. Network, access, time, update
  policy, application settings — all of them, at once; there is no per-subtree
  reset, because a partial reset leaves an operator unsure which half they are
  debugging.
- *Does not recover:* a lost credential (§5 does that, and tier 1 keeps the
  credential on purpose — footnote [^cfg]), application data, a broken slot.
- *What ships, and it is reachable today:* `POST /api/v1/reset` with
  `{"tier": "configuration"}` (`pkgs/mosd/apid/src/routes.rs`), authenticated,
  no presence needed. It STAGES §2.2's intent record and the tier runs on the
  next boot (`pkgs/mosd/mosd/src/reset.rs`) — so the operator's step is two
  actions, the request and a reboot, and the device is fully pre-reset until
  that boot.

**4. Application-data reset — DESTRUCTIVE (operator data)** — **[implemented]**
- *Precondition:* as step 3, plus evidence that the fault follows the
  applications rather than the platform.
- *Fixes:* an application whose own state wedges it or the device, a full
  `/srv`, an application layer to be handed over clean.
- *Costs irreversibly:* **all operator data in `/srv`** and every application's
  data under `/mos`. There is no backup contract to fall back on —
  `docs/design/storage.md` §7 answers `backupRestore` `unsupported`, and an
  unversioned dump is worse than none — so this step is unrecoverable in the
  strongest sense the product currently offers.
- *Does not recover:* platform settings, credentials, slots.
- *What ships, and it is reachable today:* step 3's route with
  `{"tier": "application-data"}`, on step 3's terms exactly — authenticated, no
  presence, staged and applied on the next boot.

**5. Credential recovery — DESTRUCTIVE (the old credential)** — **[partial]**
- *Precondition:* §4 physical presence. Nothing else, ever.
- *Fixes:* the lockout `docs/design/access.md` §9.1 describes — no webAdmin
  password and no authorized key — without losing a byte of operator data.
- *Costs irreversibly:* the previous credential stops working at the same
  commit that mints the new one. Any client or automation holding it must be
  re-enrolled.
- *Does not recover:* the previous secret, which is never disclosed (§5); a
  device that does not boot far enough to run the flow.
- *Ordered here deliberately:* it is the only step that cures a lockout while
  preserving everything, so it must be reached before anyone considers a
  factory reset for the same symptom.
- *What ships:* the whole flow — `POST /api/v1/recovery/credential`
  (`pkgs/mosd/apid/src/routes.rs`), every §5.1 rule asserted, §5.4's guard
  release and its one-rotation-per-assertion bound included.
- **What is missing, and it is why this step is not `[implemented]`:** the flow
  is gated on a §4 presence assertion, the system side that produces one from a
  board-declared physical action ships, and **neither shipped board declares an
  action**. An operator standing at a device today cannot take this step. Until
  a board declares one and its BSP implements it, the lockout §9.1 of
  `docs/design/access.md` describes is still answered by step 7 and not by this
  one — which is the ordering cost this step exists to avoid, and the reason
  §4's missing half is the highest bench priority in this document.

**6. Full factory reset — DESTRUCTIVE (everything but identity)** — **[partial]**
- *Precondition:* §4 physical presence, and a decision that the device's whole
  mutable state is to be abandoned — decommissioning from one operator,
  handover, or a fault that survived steps 3–5.
- *Costs irreversibly:* settings, credentials, applications and all operator
  data together (§2's tier 3 row).
- *Does not recover:* a device that cannot boot (nothing in-band runs), a
  corrupted system slot, and — deliberately — the META lockdown bit stays set
  (footnote [^meta]).
- *What ships:* the tier itself, executed and tested cell for cell against §2.1
  row 3 (`pkgs/mosd/mosd/src/reset.rs`), staged by step 3's route with
  `{"tier": "full-factory"}`.
- **What is missing:** step 5's missing half, for step 5's reason. This tier is
  presence-gated (§2.2), the assertion nothing writes gates it, and the request
  is refused — 403, `presence_required`, audited, nothing staged. An operator
  who needs a factory reset on a device today takes step 7 instead, and pays
  the device's identity for it.

**7. Whole-disk reflash — DESTRUCTIVE (every partition, new identity)** — **[implemented]**
- *Precondition:* physical access to the board's loader transport (§8) and a
  host with the image. It needs nothing on the device to work: this is the step
  that survives a dead bootloader environment and an unbootable rootfs.
- *Fixes:* everything software can be wrong with the device, including both
  slots at once.
- *Costs irreversibly:* every partition, and **the device's identity**: STATE is
  replaced, so the next first boot mints a new `deviceId` and new secrets
  (`docs/design/access.md` §9.2, `docs/design/manufacturing.md` §5). Fleet-side
  records naming the old identity must be re-linked by hand.
- *Does not recover:* nothing software-wise — but see §7, it does **not** erase:
  blocks beyond the flashed extent survive unreferenced.

**8. Secure wipe — TERMINAL** — **[not implemented]**, bench-dependent
- *Precondition:* the device is leaving the operator's control, and the board
  has device-level erase evidence on file (footnote [^wipe]). Without that
  evidence there is no software step here at all; §7 states the alternative.
- *Fixes:* nothing. It is a disposal operation, not a repair.
- *Costs irreversibly:* the device, as a configured unit — identity included.
- *Does not recover:* anything. There is no step 9.

## 4. The physical-presence contract — **[partial]**

**What ships is the gate, the interface behind it, and the mapping that joins
them; what does not ship is any board's physical action.** Every
presence-gated operation asks ONE seam — `pub(crate) trait Presence` in
`pkgs/mosd/apid/src/routes.rs` — keyed by the named board capability
`recovery.presence`. What answers that capability is no longer a constant in
this tree: it is what the BOARD declares.

**The physical action is a BOARD fact, and the product decision is that it
stays one.** Each board declares its own — a GRUB menu entry, a U-Boot menu
selection, a button pattern held across a power cycle, a USB event — and the
board's BSP implements it. Bootloader entry is the expected shape because it is
the industry-standard one, and nothing bespoke is invented at the system layer
to replace it. This document names examples (§4.4) and ranks none: a board's
mechanism is the board's to choose and its BSP's to build.

**The SYSTEM layer reserves exactly one interface and knows nothing about the
mechanism.** It reads a *recovery intent* — one token the board's mechanism
leaves on the kernel command line — maps it through the board's declaration,
and turns it into the presence assertion and the reset tier the existing flows
already consume, recording which declared action produced it. That is the whole
of §4.2. No board name, no bootloader and no console device appears anywhere in
it, which is the property that keeps a per-board mechanism from becoming a
per-board flow.

**What is missing, and it is named rather than implied: neither shipped board
declares an action.** `boards/cx3576/board.env` and `boards/x64/board.env` both
declare `BOARD_RECOVERY_ACTIONS` empty (§4.4), because neither board has an
implemented physical action to declare. So §5's credential recovery and §2's
tier 3 are **implemented, tested and still unreachable on a fielded device** —
and the refusal now says *this board declares no physical recovery action*
rather than *presence is not asserted*, which are different sentences sending
an operator to different places. What closes the gap is BSP work on a named
board, not a system-layer change: §3's steps 5 and 6 stay `[partial]`, §8's
rows stay bench-dependent, and this section's marker stays `[partial]` until a
board declares and implements one.

**The board's DEBUG serial console is NOT a product surface, and no unit may
own, reconfigure or depend on it.** On cx3576 that console is `ttyFIQ0`;
displacing its getty was measured on hardware to wedge the FIQ tty and block
systemd uninterruptibly. Nothing in this design is built on it, no board may
declare it as a recovery channel, and the console-owning asserter this section
used to lean on is withdrawn rather than left open. `docs/design/access.md`
§9.1 remains the measurement of record.

There is **no button code in this tree and no button flow in this document**.
The cx3576 recovery button drops the board into rockusb loader mode and no
software recovery flow reads it (§4.4, §8); its `adc-keys` node is
`status = "disabled"` in the board DTS, so the board has nothing to declare
today.

### 4.1 What the gate is, and what it is not

`docs/design/security-model.md` §1 and §5 settle this before it is designed:
both boards are **I1**, so physical possession is already full control, and a
presence gate does not raise a wall against anyone holding the board. **The
gate exists so that a supported, audited, non-destructive path exists for the
legitimate operator who is standing at the device** — the alternative today is
step 7, which costs the device's identity to recover a forgotten password.

Stated as a rule, so no later section softens it: the presence gate's security
value is (a) that a *remote* attacker cannot reach the operations behind it,
(b) that every use leaves a record, and (c) that a destructive operation cannot
be triggered by a stray API call or a misconfigured automation. It is not, and
may never be described as, protection against the person holding the hardware.

### 4.2 The recovery intent, and what the system does with one — **[implemented]**

**A recovery intent is one token, `mos.recovery=<intent>`, on the kernel
command line.** The board's mechanism puts it there — a GRUB menu entry that
appends it, a U-Boot menu selection that adds it to `bootargs`, anything else a
board implements — and the system layer reads it and nothing else about the
mechanism. `mosd_settings`'s recovery module owns the parameter's name, the
grammar of a declaration and the mapping; `pkgs/mosd/mosd/src/recovery.rs` is
the boot-time caller.

**What happens on a boot, in order, and the order is the contract:**

1. **Read the intent.** mosd reads `/proc/cmdline` before every reconciler and
   before the staged-reset applier, so an action takes effect on the boot the
   operator made it on rather than the next one. A command line with no
   `mos.recovery=` is an ordinary boot and nothing below runs.
2. **Map it through the board's declaration** (§4.4). The intent selects at
   most one declared action; the action carries the mechanism, the channel and
   the tier.
3. **Write the presence assertion** at `/run/mos/presence` — the mechanism, the
   channel and a REQUIRED deadline, which is what the shipped reader
   (`MarkerPresence` in `pkgs/mosd/apid/src/routes.rs`) consumes. The deadline
   is a system constant measured from the boot, fifteen minutes: it measures
   the operator's session, and how long a person stands at a device is not a
   property of the hardware. On tmpfs, mode 0600, so an assertion is spent by
   the boot it was made on.
4. **Stage the tier the action declares**, when it declares one, as the same
   one-record intent `POST /api/v1/reset` writes — so what a tier DOES is
   unchanged and replayable across a power loss for exactly the reason an
   API-staged tier is (§2.2). An action may declare `none` and only assert
   presence, which is the credential-recovery shape.
5. **Audit it, naming the declared action.** One line under
   `recovery-action-<mechanism>` whose source is the action's own name, and,
   when a tier was staged, a second under the same `reset-<tier>` event the API
   route uses, also sourced to the action. An audit entry that does not name
   the mechanism cannot answer "how did this device get reset".

**mosd writes the assertion; apid never creates one and spends the one it
used.** There is no route, no settings path and no line in apid that creates
`/run/mos/presence`, so an API that could set it would have to be written
first — which is the change this section forbids. A "presence" flag an API can
set is not presence. apid's only write to that file is its REMOVAL, by the
credential recovery the assertion authorized (§5.4), and removing an assertion
can only take authority away. `apid.service` carries `RuntimeDirectory=mos` for
exactly that unlink, because `ProtectSystem=strict` otherwise leaves `/run`
read-only; `RuntimeDirectoryPreserve=yes` keeps mosd's other runtime files when
apid restarts.

**Everything fails closed, and each closed door is recorded under its own
outcome** so that "why did this device not enter recovery" is greppable:
`refused-board-declares-none`, `refused-unknown-intent`,
`refused-declaration-unreadable`, `refused-malformed-intent`. A command line
carrying the parameter twice, or carrying it empty, is a mechanism that did not
do what it meant to, and guessing which occurrence was meant is how a
mechanism ends up selecting a tier nobody asked for. A declaration this build
cannot read maps nothing at all rather than mapping part of itself.

**THE PREMISE THIS STANDS ON, stated because the guard stands on it and on
nothing else.** The intent arrives on the kernel command line, which is written
by the bootloader before Linux runs. *This holds because no route, task or
settings path in this tree writes a bootloader configuration, a U-Boot
environment or a kernel command line, so nothing an API client can do produces
an intent; if that stops holding, it does not.* It is therefore **not** proof
against an attacker who already has root on the running system — root can
rewrite the boot configuration and reboot into whatever intent it likes — and
it is not described as one. It is proof against an API-level attacker, which is
the threat this gate exists for (§4.1), on boards that are **I1** and where
physical possession is already full control. There is deliberately **no check
for the premise**: a check on this side could only inspect the intent it was
handed, which is exactly the thing that would have been forged.

**What qualifies as a physical action.** A board may declare a mechanism only
if it demands an action **at the device that no network client can perform**,
taken from the bootloader or an early boot stage rather than from a logged-in
shell. A file placed on the boot medium with the medium out of the device
qualifies by construction — it requires possession of the medium — and
`docs/design/access.md` §7's provisioning path already ranks it first. A token
read from a medium left in the slot does not: that assertion happens at a boot
nobody attended (§4.4).

### 4.3 What presence authorizes, exhaustively

Three operations, and adding a fourth is a change to this section:

1. **Credential recovery** (§5) — rotate the management credential.
   **[implemented]**, `POST /api/v1/recovery/credential`.
2. **Release of a brute-force lockout** — the release path
   `docs/design/access.md` §6 says is missing, and whose absence is the stated
   reason the hard `lockoutThreshold` is not shipped: a permanent lockout with
   no release is a brick. Supplying the release is what unblocks that threshold.
   **[implemented]**, and deliberately not as an operation of its own: a
   SUCCESSFUL credential recovery clears the counters and the window (§5.4), so
   the release is a property of the flow that already proves presence rather
   than a second route that would have to prove it again.
3. **Tiers 3 and 4** (§2.2), the resets an authenticated session may not reach.
   Tier 3 is **[implemented]**; tier 4 is **[not implemented]** and is not a
   request this device can express.

What presence must **never** authorize, and each of these is a specific
mistake worth naming:

- **Reading, decrypting or exporting any stored secret.** Presence rotates; it
  never reveals (§5). The device already holds plaintexts on unencrypted STATE
  (`docs/design/security-model.md` §6); a supported *read* path would turn a
  physical-access fact into a product feature and an exfiltration primitive.
- **A permanent shell.** RFCT-284 says it in one line: a permanent production
  SSH/root shell is not the recovery design. Presence may mint a credential;
  the operator then uses the normal, auditable channels
  (`docs/design/access.md` §4.1).
- **Disabling audit, or performing an operation the trail does not record.**
  An unaudited recovery step is indistinguishable from the attack it resembles.
- **Lifting the META lockdown** (`docs/design/access.md` §5.2). That bit is
  cleared by a full wipe of the partition and by nothing else, by design.
- **Bypassing update verification.** Recovery never installs an unverified
  bundle; the offline route stays `rauc-update import` through the same pinned
  root walk and the same `/mos/updates/verified` workspace
  (`docs/design/updates.md` §5.3).

### 4.4 How a board declares its actions — schema **[implemented]**, actions **[not implemented]** on both boards

A board declares its physical recovery actions where its other facts live, in
`boards/<board>/board.env`, and the layout lint holds the declaration to a
schema (`verify/src/lint.ts`, `make os-layout-lint`). One key lists the
actions; four keys describe each one:

| Key | What it is |
|---|---|
| `BOARD_RECOVERY_ACTIONS` | the action names, whitespace-separated. **Declared empty means the board has none**; absent is not the same claim and the lint refuses it |
| `RECOVERY_<name>_INTENT` | the value the board's mechanism sets as `mos.recovery=<intent>` |
| `RECOVERY_<name>_MECHANISM` | what the presence assertion carries and what the audit event is named for |
| `RECOVERY_<name>_CHANNEL` | the `/dev` node a minted credential is published on — never a file, and never the board's debug console |
| `RECOVERY_<name>_TIER` | `none`, `configuration`, `application-data` or `full-factory`. There is no fourth tier, so no board can declare an action staging one |

Two actions may not share an intent — that is a mapping with two answers — or a
mechanism, which would leave an audit trail that cannot say which door was
used. The same schema is enforced twice, and deliberately: the lint fails the
BUILD, and the device's own reader fails CLOSED at boot, so a board cannot ship
a declaration the device would silently ignore.

The declaration reaches the device as `/usr/lib/mos/recovery-actions.conf`,
which is those same lines and nothing else. **Rendering it is part of
implementing a board's action** and belongs to the board's package alongside
the mechanism itself; a board with no action ships no file, and an absent file
reads as "this board declares none". Both shipped boards are in that state.

**Both shipped boards declare NONE, and that is the honest state rather than a
placeholder:**

- **cx3576** — the recovery button is a *loader* entry (`PREBOOT` → rockusb,
  `docs/design/uboot-ab-handshake.md` §5.2) and its `adc-keys` node is
  `status = "disabled"` in the board DTS; U-Boot on this board cannot take a
  USB keyboard today; and the debug console is excluded by the rule above. It
  has nothing to declare.
- **x64** — there is no board-defined button and no in-band loader transport.
  A GRUB menu entry appending `mos.recovery=` is the shape this board would
  most likely take, and the firmware and GRUB configuration are the platform
  owner's rather than facts mos can assert on their behalf.

**What a board that declares none does, exactly.** The flows refuse as they do
today — same seam, same status, same envelope — and the refusal says the board
declares none. `MarkerPresence` reads the declaration BEFORE the marker, so a
file left in `/run` by anything at all reaches nothing on such a board: there
is no mechanism it could name that the board declares.

**Examples of what a BOARD may implement.** These are examples, not open
questions for the system layer, and this section ranks none of them. Each is
stated with its cost in the same breath, because a candidate whose weakness
arrives in a later caveat is one that gets picked before its weakness is read.
All of them end at the same interface: adopting one changes a board's
declaration and the BSP that implements it, and changes no flow, no route and
no tier.

1. **A bootloader menu entry**, GRUB or U-Boot, appending the intent to the
   kernel command line. The industry-standard shape and the one this interface
   expects. *Strongest property:* the operator is at the device at the moment
   the entry is selected, which is what the assertion's deadline measures.
   *Cost:* it is per-board firmware work, and on x64 the GRUB configuration is
   the platform owner's.
2. **A recovery button**, on boards that have one and where a stage that can
   set the intent may read it. *Cost, and it is a bench question twice over:*
   the cx3576 button is wired to the loader today, so whether anything that can
   set an intent may read it is untested. ***Structurally, and this is the one
   to weigh first:* it is cx3576-ONLY** — x64 has no board-defined button, so a
   product flow built on it would exist on one board and not the other. Under
   this design that asymmetry is survivable in a way it was not before: the
   capability is declared per board and the flows refuse visibly where it is
   absent, which is exactly what `docs/design/security-model.md` §4 requires of
   a board-specific mechanism.
3. **A token on removable media**, reusing the mount path P1 already ships
   (`/run/mos/provisioning/{boot,media}`, staged by `mos-provisioning-import`).
   *Board-independent and needs no bench answer.* ***Weakness, in the same
   breath:* a medium can be posted, left in a drawer, or forgotten in the
   slot, so the assertion would happen AT BOOT with nobody standing at the
   device** — weaker in exactly the dimension presence exists to carry, and it
   sits badly beside the required deadline, which measures a session somebody
   is present for. Note this is *not* §4.2's medium-out-of-the-device case:
   that one is possession, and therefore presence by construction. A board
   adopting this should weigh it for **tier 3** and against **credential
   recovery**, which mints a working management credential and would, on a
   forgotten stick, mint it at a boot nobody attended.

## 5. Credential recovery: rotate, never reveal — **[implemented]**

`POST /api/v1/recovery/credential` (`pkgs/mosd/apid/src/routes.rs`). The flow
itself is complete and every rule below is asserted; it is reachable on a
device only once that board has a way to WRITE the §4 assertion, which §4
records as the missing half and §8 as bench-dependent. That dependency is the
honest shape of "implemented": the code is here and named, and the door it sits
behind is not yet cut.

**The route takes no credential extractor.** §5.2 says an authenticated
session may not run this flow, so a caller presenting a working bearer token or
browser session is refused before presence is even consulted, and told to use
`POST /api/v1/actions/change-password` instead.

**A device claimed by a provisioning document, recovered under presence** — the
seam `docs/design/access.md` §4.4 stops at, and this section owns. The recovery
writes the claim record with the channel that claimed the device preserved and
`rotationRequired` **false**: the credential it mints was drawn by the device
from `OsRng` and shown once at the device, so it is not a bootstrap secret that
sat in plaintext on a medium, and demanding a rotation of a credential that was
just rotated under physical presence would be a bound with nothing left to
protect. A device with NO credential is refused (`not_claimed`) and pointed at
`POST /api/v1/setup`: there is nothing to recover, and minting one here would
be a third channel that can claim a device, which
`mosd_settings::ClaimChannel`'s two members exist to exclude.

### 5.1 The normative rules

1. **The flow MINTS a new credential.** It never discloses, decrypts, derives
   or otherwise recovers the previous secret. There is no code path from this
   flow to a stored plaintext.
2. **The new credential is returned exactly once**, on the channel that proved
   presence (printed at the local console; or written to the boot medium the
   operator supplied), never over the network and never a second time. If the
   operator loses it, they run the flow again — which costs no data, because it
   is non-destructive, and costs one fresh presence assertion, because §5.4's
   bound spends the one that authorized the rotation they lost.
3. **The previous secret is invalidated at the same commit that publishes the
   new one.** Not before (a crash between the two would be a self-inflicted
   lockout), not after (a window where both work is a window where the old one
   still works). One atomic replacement, with the same
   write-temp-set-mode-rename discipline STATE credentials already use
   (`docs/design/provisioning.md` §3.4).
4. **Every attempt is audited — success and failure alike.** A refused attempt
   is the more interesting record.
5. **The rotation counter moves.** `access.device.generation` is the revision
   counter anything derived from a credential keys off
   (`docs/design/provisioning.md` §3.2); a rotation increments the
   corresponding generation, so "which credential is of record" is answerable
   after the fact.
6. **This is not a shell, and not a session.** The flow's entire output is a
   credential for the normal management channel.

**How rules 2 and 3 are ordered, and why that order is the safe one.** The
credential is published on the presence channel FIRST and committed second. The
commit is ONE write of the whole `access` subtree, so the new hash, the emptied
API-token list, the claim record and the bumped generation land together and
the previous secret stops working at that same moment. Publishing after the
commit would make a failed publication a self-inflicted lockout — the old
credential dead and the new one unknown — which is exactly what rule 3's "not
before" excludes; publishing first makes the worst outcome a credential the
operator saw and that never worked, and the flow is cheap to re-run. Both
directions are asserted, including the interrupted commit and the retry.

Every API token goes at that commit too, and §3's step 5 prices it: "any client
or automation holding it must be re-enrolled". A recovery that left a stored
token authenticating would leave whoever holds it precisely the access the
operator came to the device to take back.

This also closes the gap `docs/design/provisioning.md` §3.5 names — "there is
no credential-rotation path … a real gap, not a design position" — for the
management credential. It does not resurrect the device password, which
authenticates nothing (`docs/design/provisioning.md` §3.6).

### 5.2 Authority

Exactly two authorities may run it:

- **Physical presence** (§4), in the field. This is the operator-facing path.
- **Factory authority**, during manufacturing, where the device is not yet
  anyone's and the line holds full access by policy
  (`docs/design/manufacturing.md` §6). A factory rotation is recorded in the
  per-device manufacturing record (`docs/design/manufacturing.md` §3), not only
  in the device's own trail, because the device's trail does not leave the line
  with it.

No third authority exists. In particular an authenticated management session
may **not** run this flow: a session that can rotate the credential it
authenticated with is a session-fixation lever, and the operator holding a
working credential does not need recovery — they need the ordinary change-password
path, which is a different feature.

### 5.3 The audit record

The trail's shape is already fixed and implemented
(`docs/design/access.md` §6): one JSONL line per event with an RFC 3339 UTC
timestamp, the event, the outcome and the source address, bounded to a ~512 KiB
two-file ring, fsynced per line, mirrored to the journal, and **never carrying
credential material**. Rule 1 above makes the last constraint free: there is no
secret in this flow that the trail could leak.

The record for a recovery is therefore:

| Field | Value |
|---|---|
| timestamp | RFC 3339 UTC, as every line |
| event | names the flow **and the presence mechanism** — `credential-recovery-console`, `credential-recovery-button`, `credential-recovery-medium`, `credential-recovery-factory` |
| outcome | `success`, `refused` (presence not established), `aborted` (established, not completed) |
| source | the local mechanism, not a peer — this flow has no network peer by construction |

The mechanism rides in the event name rather than in a new field, deliberately:
the implemented line shape has exactly four members, and one enumerated event
per mechanism keeps the trail's grammar unchanged while making "which door was
used" greppable.

**One of those four names exists in code**, `credential-recovery-console`
(`pkgs/mosd/apid/src/routes.rs`), and its three siblings deliberately do not: a
constant for a door this build cannot open would be a claim §8's board table
does not support. All three outcomes are reachable and asserted — `success`,
`refused` when presence is not established or the caller is authenticated, and
`aborted` when presence was established and the flow did not complete, which is
what a console that cannot be written produces.

### 5.4 Interaction with the brute-force counters

`docs/design/access.md` §6 persists a consecutive-failure run and a backoff
deadline to STATE, capped on load, never permanent, degrading open on
corruption. The interaction is three rules:

- **A presence-gated rotation is not throttled by that guard.** The guard slows
  a remote guesser; presence is not guessable, and a device whose operator is
  standing in front of it must not be made to wait out a window an attacker
  armed. Its own bound is the mechanism: one rotation per presence assertion,
  and the assertion is re-performed physically for the next one. That bound is
  the marker being SPENT — the route reads the assertion and unlinks it inside
  one guard, so the read and the spend are one step — and a request that finds
  a spent assertion is refused 403 `presence_required` saying so, having minted,
  published and written nothing.
- **A successful rotation clears the guard** — counters and window both. This is
  the release path §4.3 item 2 promises, and it is what makes a hard
  `lockoutThreshold` safe to ship later.
- **A refused or aborted rotation clears nothing.** Otherwise a failed attempt
  becomes a remote-reachable throttle reset for whoever can rattle the door.

All three are **[implemented]** and asserted through the guard's own behaviour
rather than through a reader on its counters: the login route answers a request
made inside an armed window with 429 before it looks at the password, so "the
window is gone" is exactly "a correct password is admitted again". Nothing on
the recovery path calls `GuardStore::begin_attempt`, which is the first rule
rather than a comment about it, and `record_success` is reached only after the
commit, which is the third.

**The one-rotation bound was a sentence before it was a mechanism** (RFCT-316's
F3, closed by RFCT-322). The marker was read and never taken, so one assertion
authorized rotations without limit and concurrent ones raced. Measured against
the shipped binaries — real mosd on a private session bus, real apid over real
TLS, real HTTP, no barrier and no fake:

- a **second rotation on the same marker** was answered `200` in **100 attempts
  out of 100**;
- **two concurrent callers were both answered `200` in 100 iterations out of
  100**, and at concurrency 8 every one of 50 iterations answered **eight**
  `200`s — 400 rotations from 50 assertions;
- every one of those rotations printed a credential on the console and exactly
  one of them authenticated, so at concurrency 8 the device published 400
  credentials of which 50 worked. Worse than a count: the credential published
  LAST was not always the one whose write landed last, in 5 of the 100
  concurrency-2 iterations, so an operator could not tell which console line was
  real by reading down.

The spend plus the guard close both. The same harness against the fixed
binaries: **exactly one `200` per assertion** in all 250 iterations, every one
of the 550 losing requests `403`, every published credential authenticating, and
the marker gone afterwards in every iteration.

**The spend happens after the commit, never before it**, which is the third
rule read literally: an assertion cost the operator a trip to the device, and a
rotation that aborted — a console that could not be written, a mosd that did
not answer — leaves it standing so the retry is theirs rather than another
walk. The cost of that ordering is bounded and stated: a rotation whose spend
itself fails is a rotation that happened, so it answers `200` and records the
failure in the journal rather than unsaying a commit, and the reader keeps the
bound in memory meanwhile.

**Spending the assertion also ends the presence window for §2.2's tier 3.** An
operator who rotates the credential and then wants a full-factory reset asserts
presence again; a board that wants both in one visit declares an action whose
`RECOVERY_*_TIER` is that tier (§4.2 step 4), which stages it at boot without
the API.

## 6. Both slots failed, and the non-destructive repair tier

### 6.1 Both slots failed — **[partial]**

**What the bootloader does today**, per board, and it is not a hang in either
case:

- **cx3576** — `boards/cx3576/boot.cmd` walks `BOOT_ORDER` for a slot with
  credits; with none anywhere it refills both counters, persists them and
  `reset`s, so the device retries forever rather than stopping at a prompt
  (`docs/design/uboot-ab-handshake.md` §4.2, §5.3). The rescue entry is
  U-Boot-resident and already in the tree: the recovery-button `PREBOOT` path
  into rockusb, and the `bootcmd` tail that enters rockusb when boot fails
  (`docs/design/uboot-ab-handshake.md` §5.2). **[implemented]**
- **x64** — `boards/x64/grub.cfg` ends with the same judgement written
  differently: when neither slot is a candidate it boots in `ORDER` anyway
  rather than sitting at a menu, because an appliance with no console is not
  helped by a prompt. **[implemented]**

The consequence an operator must be told, because it is the visible symptom:
**a device with two unbootable slots reboots in a loop.** It is not bricked and
it is not idle; the loop is the design, and the evidence is on the console.

**The minimum failure record that must survive**, and the constraint that
shapes it: a both-slots-failed device may have a corrupted writable filesystem,
so **the record must be readable without mounting STATE, DATA or META**. That
leaves exactly the state the bootloader already persists, and this design
requires it to remain sufficient:

| Evidence | Where it lives | Readable how |
|---|---|---|
| slot order and both attempt counters | `BOOT_ORDER`, `BOOT_A_LEFT`, `BOOT_B_LEFT` in the redundant U-Boot environment (cx3576); `ORDER`, `A_OK`/`A_TRY`, `B_OK`/`B_TRY` in `grubenv` on the ESP (x64) | the loader prompt, `fw_printenv`/`grub-editenv` from a repair host, or the medium in another machine |
| which slot was attempted, and why it stopped | the bootloader's own console lines (`mos: booting slot …`, `mos: no bootable slot left, resetting attempt counters`, the `saveenv FAILED` warning, GRUB's "no usable cmdline.cfg" refusal) | attached serial console — the only live channel at this stage |
| whether the slot's boot payload is intact | presence and content of the slot's `mos-verity-<slot>.env` (cx3576) or `cmdline.cfg` (x64) on its boot partition | mounted read-only from a repair host |

Everything richer — the journal, the audit trail, the diagnostics snapshot —
is on a writable tier and is **best effort** in this state. What is
**[proposed]** here is not a new mechanism but a discipline: nothing may move
the boot-decision evidence off the bootloader-visible stores onto a writable
tier, because that is the store this failure mode may have destroyed.

### 6.2 The non-destructive repair tier — **[partial]**

Between "reboot it" and "reset it" there is a tier with no name today, and
naming it is what keeps operators from reaching for tier 3 to fix a dirty
filesystem. **Repair fixes a store's structure; it never removes an operator's
content.**

**Three of the four capabilities below have shipped code and one does not, and
none of them is reachable as a repair STEP.** That split is the whole of this
marker, so each bullet carries its own: what exists arrived under other names —
the layout script, a fail-open daemon, the update lifecycle — and what is
missing is (a) offline repair, which needs a recovery environment nobody has
built, and (b) the tier itself as a named, ordered operator step with a route
and an audit event. An operator today reaches these capabilities by knowing
they exist, which is precisely the discovery problem §0 warns about.

What repair **may** touch:

- **An unmounted writable tier**, offline — **[not implemented]**: a filesystem
  consistency pass on
  STATE, DATA or META from a recovery context. `docs/design/storage.md` §7 is
  unambiguous about the two halves of this — the boot-time `systemd-fsck` pass
  is automatic repair and exists, while deliberate offline repair is
  `unsupported` because the image ships no recovery environment and running
  `fsck` on a *mounted* tier from a management API is a way to corrupt it. This
  tier therefore depends on a recovery environment (`docs/design/access.md`
  §2's rescue entry, **[not implemented]**), and no part of it may be exposed
  as a management route that operates on a mounted tier.
- **The layout skeleton** — **[implemented]**, under another name: recreating
  missing directories under `/mos` and
  their modes, which is `mos-data-layout`'s idempotent job already, and the
  reason a missing skeleton reports `notAttempted`/`unavailable` rather than
  being silently improvised around (`docs/design/storage.md` §3). It runs on
  every boot, so the repair a reader would come here for has already happened;
  §2's tier 2 and tier 3 rely on the same property, which is why the applier
  empties the declared directories rather than deleting and recreating them —
  the modes stay `mos-data-layout`'s to state and are never restated in
  `pkgs/mosd/mosd/src/reset.rs`.
- **Daemon-private state that is already fail-open** — **[implemented]**, under
  another name: a corrupt
  `login_guard.json` degrades to a clean in-RAM guard by design
  (`docs/design/access.md` §6); repair may delete such a file, and only such a
  file — one whose loss the owning daemon already treats as recoverable. The
  one case an operator actually reaches for — an armed backoff window on a
  device they are standing at — now has a supported answer that is not a file
  deletion at all: a successful §5 rotation clears the counters and the window
  (§5.4), which is why the release path is a property of that flow rather than
  a repair operation of its own.
- **The inactive system slot** — **[implemented]**, under another name: by
  re-installing a verified bundle into it
  through the ordinary update path. This repairs a corrupted slot without
  touching a byte of operator data, and it is the correct answer to "one slot
  is bad" — reusing `docs/design/updates.md`'s lifecycle, `/mos/updates/verified`
  and the existing `good`/`bad` on `booted`/`other` vocabulary. **No second slot
  state machine is introduced here**, and repair does not invent an "installing
  into the booted slot" operation. §2's tiers keep it that way: no tier writes,
  installs, activates or condemns a slot (footnote [^slots]).

What repair **may not** touch, ever:

- `/srv`, or any application data under `/mos`. Repair that deletes operator
  content is tier 2 wearing a friendlier name.
- Identity, credentials, secrets or the audit trail.
- META's lockdown bit, by the same rule as §2's footnote [^meta].
- The booted slot's mark. Repair never marks the running slot `good`: that is
  the health gate's statement about a boot, and a repair tool asserting it
  would confirm a system nobody validated.

### 6.3 The emergency BusyBox binary — **[implemented]**

§6.2's first bullet says the offline repair tier depends on a recovery
environment nobody has built, and that is still true. What the image now carries
is smaller and is deliberately not that: **one binary at `/usr/bin/busybox`**,
shipped by `mos-busybox` (`rootfs/packages-src/busybox/`), named in
`rootfs/packages/common.pkgs` so that every image on every board has it.

**What it is.** A tool an operator reaches for when a normal command is missing
or broken — `busybox sh` when the shell will not start, `busybox ls`,
`busybox mount` when coreutils or util-linux is the damaged thing. An applet is
reached by NAMING it, and that is the whole interface.

**What it is not**, and each of these is asserted rather than promised:

- **Not an applet farm.** No BusyBox applet link exists anywhere in the image —
  symlink or hard link — and `verify/`'s `packed-busybox-unexpanded` walks the
  whole packed root to say so, driven red from a fixture carrying one.
  `rootfs/packages-src/busybox/Dockerfile` makes the stronger, upstream half of
  the same statement: the staged payload is exactly the binary and its
  copyright, so no link can reach an image at all.
- **Not a PATH change and not `/build/bin`.** PLAN-045's rejected alternative 1
  was applets under `/build/bin` at the end of PATH; `packed-busybox-no-path-change`
  refuses both the directory and any PATH source naming BusyBox. An applet that
  resolves without being asked for by name has replaced a GNU command for every
  script on the device, and BusyBox applets take fewer options and differ in
  behaviour from their GNU counterparts.
- **Not an initramfs or init dependency.** Debian's own `busybox` package ships
  the initramfs hook that copies the binary into the initrd and hard-links every
  applet beside it; this package unpacks that archive and keeps one file, so the
  hook never arrives. `packed-busybox-not-early-boot` asserts no initramfs hook,
  no `BUSYBOXDIR`, and no unit, generator, preset or `/usr/lib/mos` script naming
  it, and `rootfs/scripts/pack-export-boot.sh` asserts the same over the initrd
  that actually ships. A tool early boot depends on is part of the boot contract,
  not an emergency tool — and it would be a part nobody qualified.
- **Not a rescue environment.** It is dynamically linked against the same libc
  as everything else, which is PLAN-045's stated cost: a system damaged badly
  enough to lose `/lib` has lost this too. A static rescue binary is PLAN-045's
  alternative 3 and stays **deferred** to the recovery environment §6.2's first
  bullet needs; this section does not claim to be it.

**Transient links, when a repair needs them.** A script that calls `ls` while
coreutils is what is broken needs the applets to look like commands. The
sanctioned form creates them in tmpfs and puts only that directory on that one
shell's PATH:

```sh
mkdir -p /run/mos-toolbox
busybox --install -s /run/mos-toolbox
PATH=/run/mos-toolbox:$PATH busybox sh
```

`/run` is tmpfs, so the links are gone at the next boot and nothing outside that
shell sees them. A persistent farm is refused twice over: the root is a read-only
dm-verity squashfs and cannot hold one, and the reason it is also refused
wherever it could be written is the shadowing above. The operator-facing form of
all of this is `docs/user/troubleshooting.md` §4, which labels the applets
diagnostic-only — they are not a supported command API, and nothing on the
device may depend on them.

## 7. What no software path recovers

Three limits, stated together because operators meet them together.

**A reflash does not erase.** DATA grows past the flashed image's extent on
first boot, and a later reflash writes only the image's own extent and a fresh
GPT — so the blocks beyond that extent are left on the medium, unreferenced by
the new filesystem. `docs/design/access.md` §9.2 records this precisely and
this document does not restate its argument: **"cleared" there, and in every
row of §2's table except tier 4, means unreachable through the new filesystem,
not erased.** That precision is the entire reason secure wipe is a separate
tier from full factory reset — if a reflash erased, tier 4 would be a synonym
for step 7 and would not need to exist. It also means a device leaving an
operator's control is not made safe by any tier that lacks device-level erase
evidence (§2 footnote [^wipe]); until a board has that evidence, the honest
instruction is to destroy the medium, exactly as
`docs/design/security-model.md` §6 concludes.

**A lost secret stays lost.** Nothing recovers a credential — the flows above
replace it (§5). Nothing decrypts anything, because nothing is encrypted
(`docs/design/security-model.md` §6): what "no recovery" means here is that
there is no plaintext to hand back and no oracle that will produce one.

**Hardware failure is not in this document.** A dead eMMC, a bad board and a
failed medium are replacement cases, not recovery cases: the device gets a new
identity because a replacement board mints one
(`docs/design/manufacturing.md` §5), and moving DATA to new media is
`dataPreservingReplacement`, answered `unsupported` by
`docs/design/storage.md` §7 for want of a published on-disk contract and a
validated procedure. An operator asking "can I keep my data" gets a plain no
today, and this document does not soften it.

## 8. Per-board recovery level — **[partial]**

| Board | Bootloader access | Reflash transport | Physical-presence entry mechanism | Both-slots-failed evidence path | Recovery level, honestly |
|---|---|---|---|---|---|
| **cx3576** (RK3576) | U-Boot console over the serial console on `ttyFIQ0`; the loader prompt is reachable when a loader boots at all | rockusb over USB, driven by `rkdeveloptool`; maskrom when the loader area itself is unbootable — the path of last resort and the factory flash path | adc-keys recovery button (`PREBOOT` → rockusb) **[implemented]** as a *loader* entry; **no software recovery flow reads it**, and its `adc-keys` node is `status = "disabled"` in the board DTS. The board declares `BOARD_RECOVERY_ACTIONS` EMPTY (§4.4): it has no implemented physical action, so every presence-gated flow refuses on it saying so — **bench-dependent**, and what it waits on is BSP work rather than a system-layer change | serial console transcript plus `BOOT_ORDER`/`BOOT_A_LEFT`/`BOOT_B_LEFT` from the redundant U-Boot environment (§6.1) | **I1** (`docs/design/security-model.md` §5). Physical reflash recovery exists and is `[implemented]`; §2's tiers 1-3, §4's gate and §5's recovery are code (§2, §4, §5) with no field evidence, and §6.2's repair step is `[partial]`. The dossier's Recovery row is `not tested` — **bench-dependent** |
| **x64** (generic UEFI) | the platform owner's firmware setup and the GRUB console; mos configures neither | remove the medium and write the full-disk image from another machine; there is no in-band loader mode | none defined by mos — presence is the machine's own console/firmware or possession of the medium — **bench-dependent**, and it is a claim about a chassis mos does not specify. The board declares `BOARD_RECOVERY_ACTIONS` EMPTY (§4.4); a GRUB menu entry appending `mos.recovery=` is the shape it would most likely take, and that configuration is the platform owner's | attached console output plus `ORDER`/`A_TRY`/`B_TRY` read from `grubenv` on the ESP (§6.1) | **I1**. QEMU/CI evidence only; no field evidence exists; §2's tiers, §4's gate and §5's recovery are code that no x64 unit has run — **bench-dependent** |

**Who must prove each bench-dependent row.** The qualification owner named in
the board's dossier, against `docs/bsp/qualification.md` row 12 (Recovery):
"every recovery path in the dossier's Recovery method section actually restores
a unit from the state it claims to handle". For cx3576 that owner is mos core,
and the matrix row is `not tested` today; for a customer-selected board it is
the integrator, per `docs/bsp/support-tiers.md`. Until a dated `pass` row
exists on a named board revision, no release material may describe these paths
as proven — a board's recovery claim is bounded by its evidence, exactly as its
assurance level is.

Both rows say I1 and neither says more. A board that closes its loader
transport to raise that level is making an I4-class decision and owes the
validation `docs/design/manufacturing.md` §7 requires — closing the recovery
path without a validated replacement destroys the device class rather than
hardening it, which is the warning `docs/design/security-model.md` §7 already
carries.
