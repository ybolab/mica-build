# Field-reliability qualification

Qualification is how a board earns claims: a fixed matrix of
reliability-relevant behaviors, each proven on real hardware (or honestly
left unproven), recorded with dates and evidence in the board dossier's
Qualification results section. It is what separates "an image that boots"
from a supported product — the distinction [support-tiers.md](support-tiers.md)
is built on. What follows is the process and the row grammar; the results are
a board fact, and no board has produced them yet — the one dossier on file
carries all twelve of its rows as `not tested`.

> status: shipped — evidence: `docs/bsp/board-template.md`
> status: board-dependent — evidence: `docs/bsp/cx3576-example.md`

## 1. The named-revision rule

Results bind to exactly one combination of:

- board revision (the vendor's revision marking),
- storage device (the concrete eMMC/SD/NVMe part, not the technology),
- radio module (the concrete SKU, where the board has radio variants),
- BSP version (the synced-to upstream commit plus the mos tree's own
  revision).

A result is **never generalized** to another revision, storage part, radio
module, thermal solution or vendor BSP. A new combination gets a new matrix;
the old one stays on file for the units that shipped with it. This rule is
why the dossier's Supported revisions section must list uncovered revisions
explicitly.

## 2. Row grammar

Every row is one of exactly four results:

- `pass` — the procedure ran on the named combination and met its criterion.
  Carries an ISO date (`YYYY-MM-DD`) and an evidence note: what was run,
  where the log/artifact lives.
- `fail` — the procedure ran and did not meet its criterion. Carries an ISO
  date and an evidence note. A `fail` row does not disappear when fixed; it
  is superseded by a later dated `pass`.
- `N/A` — the row does not apply to this board (no radio, no fieldbus), with
  a one-line reason. `N/A` is a statement about the hardware, never about
  missing time or missing rigs.
- `not tested` — the row applies and has not been run, with a one-line
  reason. This is the honest default for every row until someone runs it.

**Never implicitly green.** A missing row, an empty cell, or an undated
`pass` is a defect in the dossier, not evidence. Document authors without
hardware cannot close an evidence row, and do not.

Recommended table shape:

| Row | Result | Date | Evidence / reason |
|---|---|---|---|

## 3. The matrix rows

The fixed row set. "As applicable" rows go `N/A` (with reason) on boards
without the hardware; nothing else may be dropped.

| # | Row | What it proves |
|---|---|---|
| 1 | Cold boot | power-on from cold reaches a healthy system (health gate green), repeatably |
| 2 | Warm boot | reboot from a running system reaches healthy, repeatably |
| 3 | A/B switch and update | a bundle installs to the inactive slot, the order flips, the health gate confirms; a bad slot rolls back after its attempt credits |
| 4 | Power-cut during update | power removed mid-install leaves the device bootable into the previous slot; repeated cuts do not brick |
| 5 | Storage growth/health | data partition grows on first boot; fill-up of data//var does not take the system down; storage health readout works |
| 6 | Network/radio | Ethernet and each named radio module associate/transfer under the shipped stack |
| 7 | USB/fieldbus (as applicable) | USB host/gadget roles and fieldbus (e.g. CAN) traffic under the shipped hwinit units |
| 8 | RTC | time survives power-off (battery-backed) or the absence is handled (documented resync behavior) |
| 9 | Thermal/throttling | sustained load stays inside the thermal envelope; throttling degrades, not crashes |
| 10 | Watchdog/reset cause | a hung system is reset by the watchdog; the reset cause is readable afterwards |
| 11 | Offline service | the device is fully operable and configurable with no network, per the provisioning model |
| 12 | Recovery | every recovery path in the dossier's Recovery method section actually restores a unit from the state it claims to handle |

Rows 3, 4 and 12 are the ones that make a board *supported* rather than
*booting*: the BSP contract's new-board checklist ends with the power-cut
rig run for the same reason, and a board without dated rows 3/4/12 cannot be
mos-qualified regardless of the rest.

## 4. Evidence standards

- Hardware rows need hardware. A host-side or QEMU gate may back a `pass`
  only where the row's claim is actually about the tested surface — e.g. the
  U-Boot handshake logic has an off-hardware test suite, which is evidence
  about the script's logic, not about row 3 on a bench. The evidence note
  must name which it is.

> status: shipped — evidence: `make os-uboot-handshake-test`

- Evidence notes name a location: a log path, a rig run ID, a linked record.
  "Worked on my bench" without an artifact is `not tested` with extra words.
- Repeatability counts: cold/warm boot rows state the cycle count.

## 5. Re-qualification triggers

A matrix goes stale — its rows revert to `not tested` for the new
combination — when any binding element changes: a BSP sync to a new upstream
commit, a kernel or bootloader bump, a new storage part or radio SKU, a new
board revision. Rows whose subject is untouched by the change may be carried
forward only as an explicit dated decision in the dossier ("carried from
<date> run; change judged irrelevant because ..."), never silently.

## 6. Who runs it

Per [support-tiers.md](support-tiers.md): for a mos-qualified board, mos owns
the run and the evidence; for an integrator-qualified board, the integrating
customer owns both and mos's claims are correspondingly narrower. In both
cases the grammar and the matrix are this document's — comparable evidence
is the point.
