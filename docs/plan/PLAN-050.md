# PLAN-050 Document BSP porting and qualify field reliability

- **status**: implementing
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
