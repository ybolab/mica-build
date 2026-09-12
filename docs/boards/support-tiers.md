# Board support tiers

A tier is a claim about evidence and ownership, not about whether an image
boots. Mica OS normally supplies the contract and the guidance while the
integrating customer selects and integrates the board, so the tiers exist to
keep three different situations from blurring into one word "supported".

The definitions below are the vocabulary. Whether a board has reached a tier
is answered by that board's dossier; the current placement is under
[Current boards](#current-boards).

> status: shipped — evidence: `docs/boards/qualification.md`, `docs/boards/board-template.md`
> status: board-dependent — evidence: `docs/boards/cx3576.md`

## The tiers

### mos-qualified

**Definition.** Mica OS owns the board's port and its evidence: the dossier is
complete, and the field-reliability matrix
([qualification.md](qualification.md)) was run by Mica OS on a named revision
with dated rows — including the power-cut, A/B-update and recovery rows,
which are the tier's gate.

**Evidence it names.** A dossier validating against
[board-template.md](board-template.md); a qualification matrix with dated
`pass` rows for at least cold/warm boot, A/B switch and update, power-cut
during update, and recovery, on the named combination; an Assurance level
section with per-level status lines.

**Lifecycle owner.** Mica OS: BSP sync, CVE response and requalification on
change are Mica OS's to run, on Mica OS's cadence.

**Permitted claims.** Release notes may list the board as supported at the
named revision/combination; the website may present it as a qualified
platform, stating the evidenced assurance level (I1–I4) and nothing above
it.

### integrator-qualified / bring-up

**Definition.** The port exists and the contract is met — the board builds,
the image verifies, the dossier exists — but the field evidence is owned by
the integrating customer, or is still being accumulated (bring-up). This is
the normal tier for customer-selected hardware.

**Evidence it names.** The same dossier and matrix grammar, with the matrix
rows filled by the integrator (or honestly `not tested` during bring-up),
and the Owners section naming the integrator as qualification owner.

**Lifecycle owner.** The integrating customer, with Mica OS providing the
contract, the templates and guidance. Which side owns BSP sync and CVE
response is recorded per board in the dossier's Owners section — it is not
implied by the tier.

**Permitted claims.** Release notes may state that the board builds and
passes the repository's gates; neither release notes nor the website may
call it "supported" or "qualified" without naming whose qualification it
is. Field-reliability language belongs to whoever holds the evidence.

### unsupported

**Definition.** Everything else: no dossier, an out-of-support kernel tier,
unresolved redistribution rights, or a port that was never taken through the
[porting manual](porting.md). "It boots" does not move a board out of this
tier — field reliability, recovery, update and lifecycle ownership are
exactly the things a booting image leaves unproven.

**Evidence it names.** None required; where a dossier fragment exists it
records why the board is unsupported (Known limitations).

**Lifecycle owner.** Nobody — which is the point of saying it.

**Permitted claims.** None. The board may be mentioned only as explicitly
unsupported.

## Tier assignment and movement

- A tier is assigned per board **and revision combination** (the
  qualification binding), at release registration (porting manual stage 10).
- Movement up requires the evidence, not intent: bring-up becomes
  integrator-qualified when the integrator's matrix rows are dated;
  either becomes mos-qualified only when Mica OS runs and owns the matrix.
- Movement down is automatic in effect: a re-qualification trigger
  ([qualification.md](qualification.md) section 5) reverts rows to
  `not tested` for the new combination, and the tier's claims lapse with
  them until the matrix is re-run.

## Current boards

This table is the single source for board status; other documents link here
instead of restating it. No board is mos-qualified: no dossier has a dated
physical qualification row.

| Board | SoC / boot | Disk layout | Release target | Build | Acceptance on file | Tier today |
|---|---|---|---|---|---|---|
| `x64` | generic x86_64, UEFI systemd-boot with a signed UKI | ESP/SYSTEM/DATA | yes | complete image | QEMU lifecycle: API, power actions, reboot, runtime, updates and reset | bring-up (QEMU baseline) |
| `virt-arm64` | QEMU ARM64, UEFI systemd-boot with a signed UKI | ESP/SYSTEM/DATA | no | complete image | QEMU API, update, fault and reboot rows — [virt-arm64.md](virt-arm64.md) | bring-up (QEMU reference) |
| `cx3576` | Rockchip RK3576, U-Boot with a signed FIT | FIRMWARE/SYSTEM/DATA | yes | complete image, static verification | physical rows not tested — [cx3576.md](cx3576.md) | bring-up |
| `s905x5m` | Amlogic S7D (BM201), U-Boot with a signed FIT, SD boot | FIRMWARE/SYSTEM/DATA | no | complete image, static verification | build and fixture rows only; physical rows not tested — [s905x5m.md](s905x5m.md) | bring-up |

"Release target" is `BOARD_RELEASE_TARGET` in the board's `board.env`.
x64 and virt-arm64 evidence is emulator evidence, not field evidence.

> status: board-dependent — evidence: `boards/x64/board.env`, `boards/virt-arm64/board.env`, `boards/cx3576/board.env`, `boards/s905x5m/board.env`
