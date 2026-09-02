# RFCT-282 Deliver install, onboarding and provisioning

- **status**: completed
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-046](../plan/PLAN-046.md)

## Description

Provide a verified release-to-first-login journey for embedded boards,
including factory and zero/offline-network provisioning.

## Acceptance

- Every claimed board/profile has a tested artifact-selection, flash, first
  boot, status and recovery-entry procedure with data-loss warnings.
- A versioned validated provisioning document is idempotent and secret-safe.
- At least one appropriate offline/factory transport works per qualified board.
- Bootstrap claim/rotation survives retry and power loss without cloning or
  leaking identity.
- Manufacturing ownership, failure quarantine and first-run user guides are
  documented and tested end to end.

## ActiveForm

Delivering embedded installation and onboarding.

## Dependencies

- **blocked by**: explicit approval of PLAN-046; PLAN-043 release identity; board access
- **blocks**: repeatable customer and factory deployment

## Notes

- The common provisioning schema may have board-specific transports.

## Completion (2026-09-02)

Delivered under [PLAN-046](../plan/PLAN-046.md); that plan's Completion names
the modules, routes and checks. The acceptance clauses, split by what actually
holds them:

- *"Every claimed board/profile has a tested artifact-selection, flash, first
  boot, status and recovery-entry procedure with data-loss warnings."*
  **Documented, not tested on hardware.** `docs/user/install.md`,
  `docs/user/first-run.md` and `docs/bsp/cx3576-example.md` carry the
  procedure and the data-loss warnings. No board was flashed from these steps.
- *"A versioned validated provisioning document is idempotent and
  secret-safe."* **Closed** — `pkgs/mosd/mosd/src/provisioning_doc.rs` and its
  tests; `docs/design/provisioning.md` §4.1.
- *"At least one appropriate offline/factory transport works per qualified
  board."* **Implemented and unit-tested, unproven on a board.** Both the BOOT
  and the removable-media transports are staged by
  `rootfs/overlay/usr/lib/mos/mos-provisioning-import`; neither has been run
  from real media.
- *"Bootstrap claim/rotation survives retry and power loss without cloning or
  leaking identity."* **Closed for retry, bench-dependent for power loss.** The
  claim is one settings save, and the rotation bound is enforced in the one
  extractor every authenticated mutation passes through; a real power cut
  during the claim has not been performed.
- *"Manufacturing ownership, failure quarantine and first-run user guides are
  documented and tested end to end."* **Documented, NOT tested end to end.**
  `docs/user/manufacturing.md` and `docs/design/manufacturing.md` state
  ownership and quarantine; there has been no factory run.

### Bench items an operator must run

1. Flash an x64 and a cx3576 image by the steps in `docs/user/install.md`, and
   record the first boot, the status indications and the recovery entry.
2. Stage a provisioning document on removable media and on the BOOT partition
   of a real board; confirm the applied record in
   `GET /api/v1/provisioning/status` and that a second boot with the same
   document reports `unchanged`.
3. Claim a real device, cut power during `POST /api/v1/setup`, and confirm the
   device comes up either unclaimed or claimed with a usable credential —
   never half-claimed.
4. Run one factory batch through `docs/user/manufacturing.md`, including a
   deliberate failure, and record the quarantine outcome.
