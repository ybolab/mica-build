# PLAN-048 Deliver recovery and credential access recovery

- **status**: completed
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-284](../task/RFCT-284.md)

## Context

Boot-credit exhaustion can return to the previous slot, and whole-disk reflash
is the physical last resort. mos lacks a supported manual rollback, both-slots-
failed flow, non-destructive repair tier, administrator credential recovery,
factory reset, secure wipe and board/storage replacement procedure. A reflash
can make grown DATA blocks unreachable without erasing their contents.

## Proposal

- **SW/DOC:** expose authenticated current/alternate slot state and a guarded
  manual rollback/reboot action that cannot mark an unverified slot good.
- **INT/DOC:** define a physical-presence recovery entry and per-board recovery
  runbook for bootloader, image reflash and collection of a minimal failure
  record when normal apid is unavailable.
- **SW/OPS:** design credential recovery with physical-presence or factory
  authority, credential rotation, audit and no disclosure of the previous
  secret.
- **SW:** implement explicit reset modes only after their tier semantics are
  agreed: configuration reset, application-data reset, full factory reset and
  secure wipe must each name effects on identity, calibration, STATE, DATA,
  META and both system slots.
- **SW/INT:** make interrupted recovery/reset replayable; validate corrupted
  slot, corrupted writable filesystem, lost credentials, no network and power
  loss scenarios on qualified boards.
- **DOC:** publish a decision tree that starts with data-preserving actions and
  makes irreversible operations and recovery limitations unambiguous.

## Risks

- A recovery channel can become an authentication bypass; physical presence,
  factory authority and audit need an explicit threat model.
- Resetting identity or calibration can permanently decommission a device;
  tier ownership must be resolved with manufacturing before implementation.
- Binary-only bootloaders may limit rescue features; the board dossier must
  report the available recovery level honestly.

## Scope

In scope: manual slot rollback, physical recovery contract, access recovery,
reset/wipe semantics, fault tests and operator guides. Out of scope: a general
interactive Linux rescue distribution and application backup contents, which
PLAN-049 defines.

## Alternatives

1. Document full-disk reflash as the only recovery. Rejected because it loses
   serviceability and has unclear data destruction semantics.
2. Enable permanent SSH/root shell for recovery. Rejected because it broadens
   the normal attack surface.
3. Implement reset before defining tier ownership. Rejected because safe data
   loss and identity behavior cannot be inferred later.

## Annotations

- 2026-08-31: Embedded parity review identified recovery, reset, credential
  access and storage replacement as product gaps rather than doc-only gaps.
- 2026-09-01: Split from PLAN-037 as one recovery acceptance boundary.

## Completion (2026-09-02)

- **Guarded manual rollback** (R1/R4): `rollback_eligibility` in
  `pkgs/mosd/mosd/src/rauc.rs` resolves the alternate slot and refuses with a
  named reason; `GET /api/v1/update` carries the verdict as
  `rollback` (`target`, `permitted`, `reason`) and
  `POST /api/v1/update/rollback` answers 409 with that reason as its error code
  (`pkgs/mosd/apid/src/update_api.rs`). It changes the boot order and does not
  reboot. The guard is backward-only and fails CLOSED on anything it cannot
  order. Contract: `docs/design/updates.md` §5.2,
  `docs/design/recovery.md` §3 node 2.
- **The premise the guard stands on**: RAUC installs only the inactive slot.
  Read at the pinned v1.13 and recorded with its evidence and a re-run recipe
  in `docs/design/recovery.md` §3 node 2. The half that an image can be held to
  is now a gate rather than a paragraph: `rauc-units-never-override-boot-slot`
  (`verify/src/checks-rauc-units.ts`) fails any image in which a unit or
  drop-in whose `Exec*=` command line starts rauc names
  `--override-boot-slot`, and fails an image in which it finds no rauc command
  line at all. The option's string is present in `/usr/bin/rauc` — compiled out
  of the install subcommand under `-Dservice=true`, not out of the binary — so
  the units, not the binary, are what can be asserted.
- **Reset tiers** (R2): three tiers and no fourth. `ResetSettings` /
  `ResetTier` at settings schema v12
  (`pkgs/mosd/mosd-settings/src/model.rs`); `POST /api/v1/reset` stages ONE
  intent record (`api_v1_reset`, `pkgs/mosd/apid/src/routes.rs`) and
  `pkgs/mosd/mosd/src/reset.rs` applies it before anything else on the next
  boot and clears it, so an interrupted reset is replayable by construction.
  Per-tier effects are `docs/design/recovery.md` §2.1's table cell for cell,
  and the module asserts what each tier PRESERVES as well as what it clears.
- **Credential recovery** (R2): `POST /api/v1/recovery/credential` mints,
  publishes once on the channel that proved presence, and only then commits —
  it never reads, decrypts or returns the previous secret, and its response
  body has no member a secret could travel in. Authorized by physical presence
  and by nothing else: an authenticated caller is turned away with
  `authenticated_session` before presence is consulted. Audited under
  `docs/design/recovery.md` §6.
- **Physical presence**: one seam, `trait Presence`, keyed by the board
  capability `recovery.presence`; the shipped `ConsolePresence` reads
  `/run/mos/presence` and refuses an absent, expired, unreadable or
  wrong-mechanism assertion.
- **Console** (U1): `pkgs/mosd/apid/ui/src/features/recovery/`
  (`reset-panel`, `credential-recovery-panel`) and
  `features/system/rollback-panel`.
- **Decision tree and runbooks** (D1/X1): `docs/design/recovery.md` §3 is
  data-preserving first with per-step status markers; the per-board recovery
  level is §8 and `docs/bsp/cx3576-example.md`; the operator page is
  `docs/user/recovery.md`, mirrored under `docs/zh/user/`.
- **Live evidence**: `pkgs/mosd/tests/apid-api` phases `07-update-rollback` and
  `08-reset-recovery` drive the rollback verdict, the 409 refusal, a staged
  tier 1 read back out of the settings store, and the 403 `presence_required`
  refusals of tier 3 and credential recovery — the last of these against the
  SHIPPED presence reader on a real booted root, which a `FakePresence` cannot
  speak for.

### What is closed, and where

- Closed by code and static gates: the rollback guard and its refusal
  vocabulary; the premise's unit-level assertion; the tier taxonomy, its
  staging and its idempotent apply; credential recovery's rotate-never-reveal
  rule and its audit.
- Closed only in QEMU: the rollback verdict computed from RAUC's live slot
  state, a staged tier surviving the bus and a TOML save, and the presence gate
  refusing on a booted device (phases 07 and 08).
- **Bench-dependent, and therefore NOT closed:** the presence gate's PASSING
  direction. §4 says it in terms — *nothing in the tree writes a presence
  assertion* — so tier 3 and credential recovery are implemented, tested and
  **unreachable on hardware** until an asserter exists; §4.4 records the
  candidate set and the console-contention question no board has been asked.
  Also bench-dependent: a permitted rollback (it needs a real install into the
  alternate slot and a second boot), the both-slots-failed procedure, §6.2's
  repair step, and every row of §8.
- **Deliberately not implemented:** secure wipe. `ResetTier` has three members,
  so no spelling of a fourth tier is a body `POST /api/v1/reset` can parse.
  §2's footnote `[^wipe]` makes every cell of that row conditional on
  device-level erase evidence no board has on file, and §7's answer until then
  is to destroy the medium. The absence is the position, not a gap.
