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

**Almost everything in this document is [proposed], and that is the point.**
What exists today is the bootloader's automatic A/B fallback, the manual
`good`/`bad` mark, and a physical whole-disk reflash. Every *reset tier*, the
*presence gate*, *credential recovery* and the *repair tier* are designs this
document fixes so the implementation subtasks that follow have agreed
semantics — PLAN-048 is explicit that reset modes are built only after their
tier semantics are agreed.

Sections without a marker (§1, §6, §7) state principles and limits rather than
one mechanism — §6's two subsections carry their own.

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

## 2. The reset tier taxonomy — **[proposed]**

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
| 1 configuration reset | preserved | preserved | re-seeded [^cfg] | preserved | preserved | unaffected | unaffected | unaffected |
| 2 application-data reset | preserved | preserved | preserved [^apps-state] | re-seeded [^apps-mos] | cleared | unaffected | unaffected | unaffected |
| 3 full factory reset | preserved [^identity] | preserved [^identity] | re-seeded | re-seeded | cleared | preserved [^meta] | unaffected [^slots] | unaffected [^slots] |
| 4 secure wipe | cleared | cleared | cleared | cleared | cleared | cleared | cleared | cleared [^wipe] |

The tier column names the *only* four resets; the whole-disk reflash is not in
this table because it is not a reset — it replaces every partition including the
system slots, and its semantics are `docs/design/access.md` §9.2's, not this
document's. §3 places it in the operator ordering, between tiers 3 and 4.

[^cfg]: Tier 1 re-seeds the modelled settings tree and keeps three things on
    STATE that are not configuration: the identity record, the apid management
    credential (`access.webAdmin`), and the per-device secrets
    (`docs/design/provisioning.md` §3.2). A reset that dropped the credential
    would be a lockout dressed as a settings action, and it would also be a
    remote credential-clearing primitive — §5 is where a credential is
    deliberately replaced, under §4's authority and nowhere else.

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
    `mos-data-layout` recreate them at their declared modes. `ui/`, `updates/`
    (a verified bundle is not application data) and the `home/`/`root/` backing
    directories are not opened. `/srv` is `cleared` rather than `re-seeded`
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

- **A tier names itself in the request and in the audit record.** There is no
  parameterless reset.
- **A tier is replayable.** Power loss during a reset must leave the device
  either in the pre-reset state or in a state where re-running the same tier
  completes it; a reset is therefore staged as an intent record plus an
  idempotent apply, never as a sequence whose interruption is a third state.
  PLAN-048 requires this and it is the reason a reset is not "delete some
  directories".
- **A tier never widens under failure.** If a tier cannot complete its own
  scope it fails and says so; it does not escalate to the next tier because the
  next tier's delete happened to succeed.
- **Tiers 3 and 4 require §4 physical presence.** Tiers 1 and 2 are
  authenticated management actions. The line is drawn where the operation stops
  being self-serviceable: a device whose identity and credentials are gone
  cannot be handed back to its owner over the network.

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
  *other* slot holds a system that booted successfully before.
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
- *How the precondition above is enforced, not merely asserted:* "booted
  successfully before" is not a field RAUC records, so the guard derives it
  from the install order. An install always writes the slot that is not
  running; therefore a booted slot installed AFTER the alternate proves the
  device was running the alternate when that install happened. The guard
  permits a rollback only when the target is the strictly older install, and
  refuses every case it cannot order — absent, unparseable or equal
  timestamps, the last being a factory flash that wrote both slots at once.
  It fails CLOSED, because the failure this node exists to prevent is booting
  a slot that has never worked.
- *What does not ship, which is why this is still **[partial]**:* the reboot.
  The route changes the boot order and stops; realising it is a second,
  explicit `POST /api/v1/actions/reboot` through the safe-to-reboot gate
  (`docs/design/updates.md` §4), and nothing sequences the two. And the
  install-order derivation is only as good as the clock at install time: a
  device that installed with a wrong clock can record an ordering that did not
  happen. Closing that needs a monotonic per-slot boot record, which no field
  on this surface carries — RAUC's `boot-status` reads the U-Boot attempt
  counter only as exhausted-or-not (`pkgs/mosd/mosd/src/rauc.rs` states that
  limit). That the bootloader then actually falls back is bench evidence,
  §6.1's, not a claim made here.

---

### Destructive — each step below loses something no earlier step lost

**3. Configuration reset — DESTRUCTIVE (configuration)** — **[proposed]**
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

**4. Application-data reset — DESTRUCTIVE (operator data)** — **[proposed]**
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

**5. Credential recovery — DESTRUCTIVE (the old credential)** — **[proposed]**
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

**6. Full factory reset — DESTRUCTIVE (everything but identity)** — **[proposed]**
- *Precondition:* §4 physical presence, and a decision that the device's whole
  mutable state is to be abandoned — decommissioning from one operator,
  handover, or a fault that survived steps 3–5.
- *Costs irreversibly:* settings, credentials, applications and all operator
  data together (§2's tier 3 row).
- *Does not recover:* a device that cannot boot (nothing in-band runs), a
  corrupted system slot, and — deliberately — the META lockdown bit stays set
  (footnote [^meta]).

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

**8. Secure wipe — TERMINAL** — **[proposed]**, bench-dependent
- *Precondition:* the device is leaving the operator's control, and the board
  has device-level erase evidence on file (footnote [^wipe]). Without that
  evidence there is no software step here at all; §7 states the alternative.
- *Fixes:* nothing. It is a disposal operation, not a repair.
- *Costs irreversibly:* the device, as a configured unit — identity included.
- *Does not recover:* anything. There is no step 9.

## 4. The physical-presence contract — **[proposed]**

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

### 4.2 What counts as presence, per board

An entry mechanism qualifies only if it demands an action **at the device that
no network client can perform**, and it must be one of these:

- **A physical control asserted across a power cycle** — a recovery/reset
  button held during boot. The device reads it before any network interface is
  configured.
- **A local console the operator is physically attached to** — the serial
  console, or an attached keyboard/display, with the mechanism entered from the
  bootloader or from an early boot stage rather than from a logged-in shell.
- **A file placed on the boot medium with the medium out of the device** —
  the provisioning path `docs/design/access.md` §7 already ranks first, which is
  presence by construction: it requires possession of the medium.

Per board, honestly (see §8 for the full row):

- **cx3576** — the adc-keys recovery button and the serial console on
  `ttyFIQ0` both exist in the tree; the button already drops the board into
  rockusb loader mode (`docs/design/uboot-ab-handshake.md` §5.2). Neither has
  ever been used as a *presence assertion for a software recovery flow*, and no
  code reads it for that purpose — **bench-dependent**.
- **x64** — there is no board-defined button and no in-band loader transport.
  Presence means the machine's own console and firmware, or the medium in
  another machine's hand. Every mechanism is the platform owner's, not mos's —
  **bench-dependent**, and weaker: an x64 presence assertion is a claim about a
  chassis mos does not define.

Nothing here is entered over the network. A "presence" flag an API can set is
not presence, and a design that adds one has removed the gate.

### 4.3 What presence authorizes, exhaustively

Three operations, and adding a fourth is a change to this section:

1. **Credential recovery** (§5) — rotate the management credential.
2. **Release of a brute-force lockout** — the release path
   `docs/design/access.md` §6 says is missing, and whose absence is the stated
   reason the hard `lockoutThreshold` is not shipped: a permanent lockout with
   no release is a brick. Supplying the release is what unblocks that threshold.
3. **Tiers 3 and 4** (§2.2), the resets an authenticated session may not reach.

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

## 5. Credential recovery: rotate, never reveal — **[proposed]**

### 5.1 The normative rules

1. **The flow MINTS a new credential.** It never discloses, decrypts, derives
   or otherwise recovers the previous secret. There is no code path from this
   flow to a stored plaintext.
2. **The new credential is returned exactly once**, on the channel that proved
   presence (printed at the local console; or written to the boot medium the
   operator supplied), never over the network and never a second time. If the
   operator loses it, they run the flow again — which is cheap, because it is
   non-destructive.
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

### 5.4 Interaction with the brute-force counters

`docs/design/access.md` §6 persists a consecutive-failure run and a backoff
deadline to STATE, capped on load, never permanent, degrading open on
corruption. The interaction is three rules:

- **A presence-gated rotation is not throttled by that guard.** The guard slows
  a remote guesser; presence is not guessable, and a device whose operator is
  standing in front of it must not be made to wait out a window an attacker
  armed. Its own bound is the mechanism: one rotation per presence assertion,
  and the assertion is re-performed physically for the next one.
- **A successful rotation clears the guard** — counters and window both. This is
  the release path §4.3 item 2 promises, and it is what makes a hard
  `lockoutThreshold` safe to ship later.
- **A refused or aborted rotation clears nothing.** Otherwise a failed attempt
  becomes a remote-reachable throttle reset for whoever can rattle the door.

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

### 6.2 The non-destructive repair tier — **[proposed]**

Between "reboot it" and "reset it" there is a tier with no name today, and
naming it is what keeps operators from reaching for tier 3 to fix a dirty
filesystem. **Repair fixes a store's structure; it never removes an operator's
content.**

What repair **may** touch:

- **An unmounted writable tier**, offline: a filesystem consistency pass on
  STATE, DATA or META from a recovery context. `docs/design/storage.md` §7 is
  unambiguous about the two halves of this — the boot-time `systemd-fsck` pass
  is automatic repair and exists, while deliberate offline repair is
  `unsupported` because the image ships no recovery environment and running
  `fsck` on a *mounted* tier from a management API is a way to corrupt it. This
  tier therefore depends on a recovery environment (`docs/design/access.md`
  §2's rescue entry, **[not implemented]**), and no part of it may be exposed
  as a management route that operates on a mounted tier.
- **The layout skeleton**: recreating missing directories under `/mos` and
  their modes, which is `mos-data-layout`'s idempotent job already, and the
  reason a missing skeleton reports `notAttempted`/`unavailable` rather than
  being silently improvised around (`docs/design/storage.md` §3).
- **Daemon-private state that is already fail-open**: a corrupt
  `login_guard.json` degrades to a clean in-RAM guard by design
  (`docs/design/access.md` §6); repair may delete such a file, and only such a
  file — one whose loss the owning daemon already treats as recoverable.
- **The inactive system slot**, by re-installing a verified bundle into it
  through the ordinary update path. This repairs a corrupted slot without
  touching a byte of operator data, and it is the correct answer to "one slot
  is bad" — reusing `docs/design/updates.md`'s lifecycle, `/mos/updates/verified`
  and the existing `good`/`bad` on `booted`/`other` vocabulary. **No second slot
  state machine is introduced here**, and repair does not invent an "installing
  into the booted slot" operation.

What repair **may not** touch, ever:

- `/srv`, or any application data under `/mos`. Repair that deletes operator
  content is tier 2 wearing a friendlier name.
- Identity, credentials, secrets or the audit trail.
- META's lockdown bit, by the same rule as §2's footnote [^meta].
- The booted slot's mark. Repair never marks the running slot `good`: that is
  the health gate's statement about a boot, and a repair tool asserting it
  would confirm a system nobody validated.

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
| **cx3576** (RK3576) | U-Boot console over the serial console on `ttyFIQ0`; the loader prompt is reachable when a loader boots at all | rockusb over USB, driven by `rkdeveloptool`; maskrom when the loader area itself is unbootable — the path of last resort and the factory flash path | adc-keys recovery button (`PREBOOT` → rockusb) **[implemented]** as a *loader* entry; **no software recovery flow reads it** — **bench-dependent** | serial console transcript plus `BOOT_ORDER`/`BOOT_A_LEFT`/`BOOT_B_LEFT` from the redundant U-Boot environment (§6.1) | **I1** (`docs/design/security-model.md` §5). Physical reflash recovery exists and is `[implemented]`; every §2 reset tier, §4 presence flow and §6.2 repair step is `[proposed]`. The dossier's Recovery row is `not tested` — **bench-dependent** |
| **x64** (generic UEFI) | the platform owner's firmware setup and the GRUB console; mos configures neither | remove the medium and write the full-disk image from another machine; there is no in-band loader mode | none defined by mos — presence is the machine's own console/firmware or possession of the medium — **bench-dependent**, and it is a claim about a chassis mos does not specify | attached console output plus `ORDER`/`A_TRY`/`B_TRY` read from `grubenv` on the ESP (§6.1) | **I1**. QEMU/CI evidence only; no field evidence exists, and none of §2–§6.2 is implemented — **bench-dependent** |

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
