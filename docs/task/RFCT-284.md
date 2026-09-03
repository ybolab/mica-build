# RFCT-284 Deliver recovery and credential access recovery

- **status**: completed
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-048](../plan/PLAN-048.md)

## Description

Provide guarded manual rollback, board recovery, administrator access recovery
and explicit reset/wipe semantics beyond automatic bad-slot fallback.

## Acceptance

- Operators can inspect slot state and request a guarded manual rollback.
- Every qualified board has a physical-presence recovery entry and tested
  both-slots-failed procedure.
- Credential recovery rotates rather than reveals secrets and is audited.
- Reset modes name effects on identity, calibration, STATE, DATA, META and
  system slots before implementation.
- Power-loss/corruption tests and a data-preserving-first decision tree pass.

## ActiveForm

Delivering local recovery and access recovery.

## Dependencies

- **blocked by**: explicit approval of PLAN-048; PLAN-047 slot state; PLAN-049 data semantics
- **blocks**: supportable field recovery and safe factory reset

## Notes

- A permanent production SSH/root shell is not the recovery design.

## Completion (2026-09-02)

Delivered under [PLAN-048](../plan/PLAN-048.md); that plan's Completion names
the modules, routes and checks. **This acceptance is not fully met on
hardware**, and the split is the deliverable rather than a caveat on it:

- *"Operators can inspect slot state and request a guarded manual rollback."*
  **Closed.** `GET /api/v1/update` carries `rollback` (`target`, `permitted`,
  `reason`) beside `slots`, `booted_slot` and `primary`;
  `POST /api/v1/update/rollback` acts or answers 409 with the guard's reason as
  its error code. QEMU phase `07-update-rollback` asserts the refused
  direction on a booted guest; a PERMITTED rollback needs a real install into
  the alternate slot and a second boot, and is bench-dependent.
- *"Every qualified board has a physical-presence recovery entry and tested
  both-slots-failed procedure."* **NOT met.** The presence *gate* ships and is
  asserted; the *asserter* does not exist — `docs/design/recovery.md` §4 says
  in terms that nothing in the tree writes a presence assertion, so the entry
  is unreachable on a fielded device. The both-slots-failed procedure is
  documented (§6) and untested on a board. **Half of this was delivered on
  2026-09-03; see the second Completion below.**
- *"Credential recovery rotates rather than reveals secrets and is audited."*
  **Closed in code, unreachable on a device.** `POST /api/v1/recovery/credential`
  mints and publishes once on the channel that proved presence, never
  discloses or derives the previous secret, and is audited under §6. Because
  nothing asserts presence, every request a fielded device can make of it is
  refused 403 `presence_required` — which QEMU phase `08-reset-recovery`
  asserts against the shipped reader.
- *"Reset modes name effects on identity, calibration, STATE, DATA, META and
  system slots before implementation."* **Closed.** §2.1's table is the
  contract and `pkgs/mosd/mosd/src/reset.rs` implements it cell for cell,
  asserting what each tier preserves as well as what it clears. Tiers 1 and 2
  are authenticated management actions and are reachable; tier 3 is
  presence-gated and therefore is not. **Secure wipe is deliberately not
  implemented** — `ResetTier` has three members, so no spelling of a fourth is
  a body the route can parse; footnote `[^wipe]` prices it on device-level
  erase evidence no board has, and §7's answer until then is to destroy the
  medium.
- *"Power-loss/corruption tests and a data-preserving-first decision tree
  pass."* **Decision tree closed; the fault tests are not.** §3 is
  data-preserving first with per-step status markers. A reset is one intent
  record plus an idempotent apply, so interruption is replayable by
  construction — asserted in unit tests, never by cutting power to a board.
  No corrupted-slot or corrupted-writable-filesystem test has been run on
  hardware.

### Bench items an operator must run

1. **~~Answer the asserter question first~~ — withdrawn 2026-09-03.** The
   console-owning asserter is not the design: the board's DEBUG console is not
   a product surface and no unit may own it (`docs/design/recovery.md` §4).
   What replaces this item: **declare and implement a physical recovery action
   on a named board** — a bootloader menu entry appending `mos.recovery=` is
   the expected shape — then declare it in that board's `board.env` per §4.4
   and render `/usr/lib/mos/recovery-actions.conf` from it in the board's
   package. Everything below still waits on this.
2. With an asserter in place: write a presence assertion at the local console
   and confirm `POST /api/v1/recovery/credential` returns 200, publishes the
   new credential on that console only, revokes every API token, and bumps
   `access.device.generation`; then confirm the previous credential no longer
   authenticates.
3. With an asserter in place: stage tier 3 (`full-factory`), reboot, and check
   §2.1's row cell for cell — including what must SURVIVE.
4. Install an update into the alternate slot on a real board, reboot into it,
   then request a rollback and confirm it is permitted, that the boot order
   changed, and that the device came back on the previous slot after an
   explicit `POST /api/v1/actions/reboot`.
5. Cut power to a board during a staged reset's apply and confirm the next
   boot replays the same tier to completion.
6. Run the both-slots-failed procedure (§6) on a cx3576 over rockusb, and
   record §8's row and the dossier's Recovery row from what actually happened.

## Completion (2026-09-03) — the interface for board-declared physical actions

The remaining half of this task's second acceptance clause, delivered under
[PLAN-048](../plan/PLAN-048.md); that plan's second Completion names the
modules and the gates. **The acceptance clause is still NOT closed**, and the
reason is now a different one: what was missing was a mechanism nobody had
decided on, and what is missing now is a BOARD that declares and implements
one. The flows become reachable on the first device whose BSP does.

What changed, in one line each:

- **The physical action is a BOARD fact**, and the system layer reserves ONE
  interface for it: a *recovery intent* on the kernel command line, mapped
  through the board's own declaration into the presence assertion and the reset
  tier the existing flows already consume. `docs/design/recovery.md` §4 is
  rewritten around it; the three candidate mechanisms it used to record as open
  questions are now examples of what a board may implement.
- **The console-owning asserter is withdrawn, not deferred.** The board's DEBUG
  serial console is not a product surface and no unit may own, reconfigure or
  depend on it; on cx3576 displacing the `ttyFIQ0` getty was measured on
  hardware to wedge the FIQ tty and block systemd uninterruptibly.
- **Both shipped boards declare NONE**, which is the honest state: neither has
  an implemented physical action. The refusal now says the board declares none
  rather than that presence is merely absent.
- **The premise is named where the guard lives** — the boot-time intent is
  proof against an API-level attacker and not against a root-level one — in the
  design record and at the mapping site, with no check built for it.
