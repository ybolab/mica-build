# Support and lifecycle

Mica OS is an operating system a product is built on, so support is a shared
responsibility: Mica OS owns the OS contract, the reference boards and the update
trust chain; the product integrator owns the board they selected, the
applications they deliver, and the product's own support relationship with its
end customers. This page states who owns what, how hardware support is
tiered, and what a support case needs to contain to be actionable.

## 1. Support tiers for hardware

The tier vocabulary, aligned with the board qualification plan:

- **mos-qualified** — a board revision qualified by the Mica OS project itself,
  with a dated hardware-in-the-loop dossier (boot, A/B update, power-cut,
  storage growth, recovery, peripherals as applicable) in which every row is
  pass, fail, N/A or not-tested — never implicitly green.
- **integrator-qualified / bring-up** — a board an integrator has ported and
  qualified against the published contract; Mica OS supports the contract, the
  integrator owns the board evidence.
- **unsupported** — everything else, including boards whose kernels fall
  below the support floor.

The tier definitions, the qualification matrix and the intake rubric are
published with the BSP documentation: the tiers in
[../boards/support-tiers.md](../boards/support-tiers.md), the matrix and its row
grammar in [../boards/qualification.md](../boards/qualification.md), the vendor
rubric in [../boards/intake.md](../boards/intake.md). The vocabulary existing is not
a board having earned a tier: no board is mos-qualified today, because the one
dossier on file carries every qualification row as `not tested`, so today's
boards hold their standing by the evidence in this repository rather than by a
completed dossier.

> status: shipped — evidence: `docs/boards/support-tiers.md`, `docs/boards/qualification.md`, `docs/boards/intake.md`
> status: board-dependent — evidence: `docs/boards/cx3576.md`

## 2. Current hardware standing

| Board | What it is | Standing |
|---|---|---|
| cx3576 (CX3576-Z, RK3576, arm64) | the reference hardware board: vendor kernel, mainline U-Boot with the A/B handshake, WiFi/Bluetooth | the board the full contract is built and tested against; behaviours verified locally, with on-hardware acceptance tracked in the design records |
| x64 (generic UEFI x86_64) | the QEMU and CI baseline | supported as a development and verification target, not a product board |

Integrators bringing their own hardware start at
[../boards/porting.md](../boards/porting.md); the board contract itself (artifact
boundary, kernel assertion set, layout schema) is shipped and enforced by the
build.

> status: board-dependent — evidence: `boards/cx3576/board.env`, `boards/x64/board.env`, `docs/boards/contract.md`

## 3. Lifecycle ownership

- **Mica OS** owns: the OS image contract and its verification, the A/B update
  mechanism and signing chain, the management API contract, the BSP contract,
  and the documentation set with its truth-status discipline.
- **The integrator** owns: board selection and qualification evidence beyond
  the reference boards, application delivery and updates (containers are
  explicitly not updated by Mica OS), the product's configuration profile, and
  end-customer support.
- **The security lifecycle** assigns every procedure an owning role — release
  owner, security owner, support owner, manufacturing owner — and states each
  procedure's real maturity: key ceremonies and custody, credential lifecycle,
  vulnerability intake, severity classes with triage and patch targets,
  advisory publication, incident response, support windows and end of life.
  Read it before promising anything on Mica OS's behalf
  ([../design/security-lifecycle.md](../design/security-lifecycle.md)).

> status: shipped — evidence: `docs/design/security-lifecycle.md`

**Written policy is not an operating channel, and the difference matters
here.** No tooling enforces a support window; no end-of-life date is bound to
a release by any mechanism; there is no published security contact, no
advisory feed and no channel promotion. Until those exist, **no support
duration, patch target or advisory coverage may be promised to an end customer
on Mica OS's behalf** — a severity target with no intake channel behind it is a
number, not a commitment.

> status: unsupported

## 4. What a support case needs

A report that can be acted on cites, in this order:

1. **Release identity** — the bundle version, the verity root hash, and the
   git stamp from `/usr/share/mos/manifest.tsv`
   ([release-notes.md](release-notes.md)).
2. **Board and revision** — and, for non-reference boards, the integrator's
   qualification standing.
3. **The device identity** — hostname / device id ([first-run.md](first-run.md)).
4. **Evidence captured before recovery** — journal excerpts, health-gate
   verdicts, update state, and any refusal text quoted verbatim
   ([troubleshooting.md](troubleshooting.md)); a reflash destroys evidence,
   so capture first.

> status: shipped — evidence: `rootfs/compose/90-pack.Dockerfile`, `docs/user/troubleshooting.md`

## 5. Where to ask

Support channels and the product-facing support brief are part of the
official-site content set at [../website/support.md](../website/support.md);
for source-level questions this repository's documentation
([../README.md](../README.md)) is the entry point.
