# Page brief: Supported hardware

- **Purpose**: tell a visitor whether their board runs mos, at what support
  level, and on what evidence — and route integrators with a new board to the
  porting contract.
- **Audience**: integrators selecting or qualifying a board; support engineers
  checking what a claimed board is actually entitled to.
- **Navigation position**: page 4, after [downloads](downloads.md). Links to
  [../bsp/porting.md](../bsp/porting.md) as the integrator entry point and to
  [support](support.md) for lifecycle ownership.

## Content outline

1. The support taxonomy: three levels, defined by evidence and ownership.
2. The board table: one row per board, each naming its evidence dossier.
3. "Bringing your own board": the porting route.

## Draft copy

### How support levels work

mos does not call any image that boots "supported". A board's level is defined
by who qualified it and what evidence exists, using the taxonomy the BSP
documentation defines in
[../bsp/support-tiers.md](../bsp/support-tiers.md):

- **mos-qualified** — qualified by the mos project against the field
  reliability matrix (dated boot, A/B update, power-cut, storage, recovery
  results), with mos as the named lifecycle owner. Every row of the matrix is
  pass, fail, N/A or not tested — never implicitly green.
- **integrator-qualified / bring-up** — ported by an integrator through the
  published board contract; the integrator owns qualification evidence and
  lifecycle. mos supplies the contract and guidance, not the guarantee.
- **unsupported** — no evidence dossier exists. mos makes no claim that the
  board works, and the site says so.

> status: shipped — evidence: `docs/bsp/support-tiers.md`

The taxonomy is published vocabulary, not a claim about any board: a level is
earned by a completed qualification matrix in the board's dossier, and no
board on this page may be labelled mos-qualified until one exists.

### Boards

Each row names the board, its architecture, its support level and its evidence
dossier. The dossier — not this page — is where the claim lives; this table
regenerates from the dossiers per the [content contract](contract.md).

| Board | Architecture | Level | Evidence dossier |
|-------|--------------|-------|------------------|
| CX3576-Z (Rockchip RK3576) | arm64 | bring-up | [../bsp/cx3576-example.md](../bsp/cx3576-example.md) |
| Generic UEFI x86_64 | x86_64 | bring-up (QEMU/CI baseline) | `boards/x64/board.env` |

The CX3576-Z has a full in-repository BSP — vendor kernel tree with recorded
provenance, mainline U-Boot, Wi-Fi and Bluetooth — and is the board the
U-Boot A/B boot-order handshake is built for. The x64 board is the QEMU and
CI baseline: firmware boots it, so it has no BSP build.

> status: shipped — evidence: `boards/cx3576/board.env`, `docs/design/bsp-cx3576-sync.md`
> status: shipped — evidence: `boards/x64/board.env`

Neither board carries a completed field-reliability qualification matrix — the
cx3576 dossier holds the matrix with every row at `not tested`, and the
x64 baseline has no dossier at all — so neither is presented as mos-qualified.

> status: board-dependent — evidence: `docs/bsp/cx3576-example.md`

### Bringing your own board

The default mos customer selects and integrates the board; mos supplies the
contract. A new board declares its partition geometry and layout constants in
one `board.env`, produces kernel, device tree and bootloader artifacts through
the BSP boundary, and must satisfy the shared kernel assertion set.

> status: shipped — evidence: `docs/design/boards.md`, `boards/common/mos-required.fragment`

The staged porting manual, intake rubric, board template and qualification
procedure are published, and together they are the integrator's path from a
blank board to a supported row on this page; start at
[../bsp/porting.md](../bsp/porting.md).

> status: shipped — evidence: `docs/bsp/porting.md`, `docs/bsp/intake.md`, `docs/bsp/board-template.md`, `docs/bsp/qualification.md`
