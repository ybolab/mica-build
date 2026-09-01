# PLAN-050 Document BSP porting and qualify field reliability

- **status**: completed
- **completedAt**: 2026-09-01
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-286](../task/RFCT-286.md)

## Context

`docs/design/boards.md` defines `board.env`, the BSP artifact boundary and
kernel/U-Boot requirements, while cx3576 provenance is recorded separately.
There is no complete blank-board-to-supported-board manual, field reference,
vendor/BSP intake rubric, peripheral matrix, hardware-in-the-loop dossier,
revision policy or long-term BSP/CVE procedure. Customers normally select and
integrate the board; mos primarily supplies the contract and guidance.

## Proposal

- **DOC:** publish a staged porting manual for SoC/vendor intake, redistribution
  rights and provenance, boot ROM/SPL/TF-A/U-Boot, kernel/config/DTS, firmware
  and calibration, `board.env`, image layout, hwinit, factory provisioning,
  update/recovery integration and release registration.
- **SW/DOC:** provide schema/reference checks and reusable templates for board
  metadata, artifact digests, supported revisions, media/layout, console,
  peripherals, recovery method, maintenance owner and known limitations.
- **INT:** qualify each named revision with dated cold/warm boot, A/B/update,
  power-cut, storage growth/health, network/radio, USB/fieldbus as applicable,
  RTC, thermal/throttling, watchdog/reset cause, offline service and recovery
  results. Rows are pass, fail, N/A or not tested—never implicitly green.
- **DOC/OPS:** distinguish `mos-qualified`, `integrator-qualified/bring-up` and
  unsupported boards, naming the evidence and lifecycle owner.
- **INT/DOC:** accept binary-only bootloader/BSP inputs when their version,
  digest, redistribution rights, A/B, recovery and rootfs-integrity behavior can
  be tested; record the reduced auditability.
- **DOC:** report additive boot assurance: I1 verity-protected root; I2
  authenticated normal system update; I3 authenticated kernel/FIT, DTB and
  verity parameters; I4 hardware-rooted boot plus production debug policy.
  I1 is the common target, I2 gates authenticated updates, and I3/I4 are
  board-specific best effort.

## Risks

- One board result cannot be generalized to another revision, storage device,
  radio module, thermal solution or vendor BSP.
- Hardware qualification requires physical boards and vendor evidence; document
  authors cannot close an empty evidence row.
- Binary-only inputs can prove observed behavior and reproducibility, not source
  auditability; marketing language must respect that boundary.

## Scope

In scope: porting guide, `board.env` reference, intake/evidence templates,
contract validators, field-reliability matrix and lifecycle ownership. Out of
scope: mos implementing every vendor BSP, paying regulatory certification or
promising universal I3/I4 secure boot.

## Alternatives

1. Support only boards whose bootloader source is available. Rejected because
   many embedded products cannot meet that input constraint.
2. Let each customer invent a qualification process. Rejected because release
   compatibility and support claims need comparable evidence.
3. Call any image that boots “supported”. Rejected because field reliability,
   recovery, update and lifecycle ownership remain unproven.

## Annotations

- 2026-08-31: The user made board selection/integration customer-owned and mos
  guidance-led, while allowing binary-only U-Boot with best-effort trust.
- 2026-09-01: Split from PLAN-037 as the board contract and evidence unit.

## Completion

Completed 2026-09. Delivered by a BKD three-tier campaign
(`l1-6rjx4wrt-20260901180748`) as the documentation and evidence-contract half
of this plan. The hardware half is, by the plan's own risk section, not
something a document author can close.

**What the tree holds now.** `docs/bsp/` is eight pages: `porting.md`, the
staged blank-board-to-supported-board manual; `board-env.md`, the key
reference; `intake.md`, the vendor and BSP intake rubric including the
binary-only input case; `board-template.md`, the dossier template;
`cx3576-example.md`, the reference board's dossier instance;
`qualification.md`, the field-reliability process; `support-tiers.md`, the
`mos-qualified` / `integrator-qualified` / `unsupported` vocabulary with its
evidence and lifecycle owner; and `assurance.md`, the additive I1-I4 boot
assurance ladder. The user-facing view of the same contract is
`docs/user/support.md`, and the supported-hardware brief is
`docs/website/hardware.md`.

**The gate is `make docs-verify` and `make docs-verify-test`.**
`docs/bsp/verify-board.sh` holds every dossier against the template: the
thirteen required H2 headings, present, in the template's order, with no
heading outside the template's list, and every qualification row's result one
of `pass`, `fail`, `N/A` or `not tested` — with a `pass` required to carry an
ISO date, so "never implicitly green" is enforced rather than requested. It
reports 42 assertions at this head. Its negative-test sibling is nine cases,
including the two vacuity floors that matter here: a template yielding zero
required headings, and a dossier with zero qualification rows. A `TODO(PLAN-050)`
sweep across the user and website pages is left to the owner of each section,
because the sections rest on the evidence below.

**What remains open, and why it cannot be closed from a desk:**

- **Every qualification row in the cx3576 dossier reads `not tested`.** All
  twelve of them. The instrument is in place — the row taxonomy, the dated-pass
  rule, the check that refuses a dossier with no rows — but cold/warm boot,
  A/B update, power-cut, storage growth, network/radio, RTC, thermal, watchdog
  and recovery results need physical boards on a bench. The dossier states the
  absence rather than implying a green result, which is the contract working as
  designed.
- **No second board has been through the intake rubric.** The porting manual
  and the intake rubric are written against the cx3576 experience and the
  board contract the build enforces; a board that is not the reference board
  has not yet exercised them end to end.
- **I3 and I4 remain board-specific best effort.** As the proposal states, I1
  is the common target and I2 gates authenticated updates; on cx3576 nothing in
  the build signs SPL or U-Boot, so the chain below the kernel is unauthenticated
  and `docs/user/security.md` records that as a gap rather than assuming it away.
- **Support windows, end-of-life procedure and vulnerability triage** are named
  as undefined in `docs/user/support.md` and belong to PLAN-043 and PLAN-053.
