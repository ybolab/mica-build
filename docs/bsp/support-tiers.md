# Board support tiers

A tier is a claim about evidence and ownership, not about whether an image
boots. mos normally supplies the contract and the guidance while the
integrating customer selects and integrates the board, so the tiers exist to
keep three different situations from blurring into one word "supported".

> status: proposed — evidence: `docs/plan/PLAN-050.md`

## The tiers

### mos-qualified

**Definition.** mos owns the board's port and its evidence: the dossier is
complete, and the field-reliability matrix
([qualification.md](qualification.md)) was run by mos on a named revision
with dated rows — including the power-cut, A/B-update and recovery rows,
which are the tier's gate.

**Evidence it names.** A dossier validating against
[board-template.md](board-template.md); a qualification matrix with dated
`pass` rows for at least cold/warm boot, A/B switch and update, power-cut
during update, and recovery, on the named combination; an Assurance level
section with per-level status lines.

**Lifecycle owner.** mos: BSP sync, CVE response and requalification on
change are mos's to run, on mos's cadence.

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

**Lifecycle owner.** The integrating customer, with mos providing the
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
  either becomes mos-qualified only when mos runs and owns the matrix.
- Movement down is automatic in effect: a re-qualification trigger
  ([qualification.md](qualification.md) section 5) reverts rows to
  `not tested` for the new combination, and the tier's claims lapse with
  them until the matrix is re-run.

## Current boards

Honest placement of the two boards in the tree today — neither has a dated
hardware matrix on file:

| Board | Tier today | Why |
|---|---|---|
| cx3576 | bring-up | full port (own boot chain, kernel assertions, A/B handshake); qualification matrix not yet run on a named revision — see [cx3576-example.md](cx3576-example.md) |
| x64 | bring-up (QEMU/CI baseline) | exists to prove the OS core in QEMU before hardware; it is a test vehicle, and its evidence is CI evidence, not field evidence |

> status: board-dependent — evidence: `boards/cx3576/board.env`

> status: board-dependent — evidence: `boards/x64/board.env`
