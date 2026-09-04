# PLAN-037 Coordinate the embedded delivery roadmap

- **status**: draft
- **createdAt**: 2026-08-31 03:08
- **approvedAt**: (pending)
- **relatedTask**: [RFCT-273](../task/RFCT-273.md)

## Context

The original proposal combined the complete embedded delivery programme in one
plan: customer documentation, website content, releases, time, installation,
updates, recovery, storage, board porting, applications, diagnostics, security
and fleet management. That made approval ambiguous and would give unrelated
work one lifecycle, one owner and one acceptance gate.

This file is now only the programme roadmap. Each capability below has its own
small plan and task so it can be approved, scheduled, implemented and accepted
independently. Splitting the records does not approve any implementation.

The common product principles remain:

- mos is an embedded appliance OS; Fedora CoreOS is a user-journey and
  immutable-OS documentation reference, not an implementation template;
- system software and OS-integrated native applications are composed into a
  signed RAUC A/B image; there is no `systemd-sysext` or on-device package
  installation contract;
- containers are the independently delivered application path, with a trusted
  product integrator as the default threat model;
- fixed embedded storage tiers are managed by the platform; mos does not expose
  a generic partition editor;
- board and BSP selection normally belongs to the customer/integrator. mos
  supplies contracts, examples and qualification guidance, and markets a board
  as mos-qualified only when mos owns dated evidence;
- binary-only U-Boot/BSP inputs may be accepted if the update, recovery and
  rootfs-integrity contracts can be tested. Boot assurance is reported as an
  evidenced I1-I4 level, not advertised universally as secure boot;
- documentation may describe a missing capability, but cannot mark it shipped.

Work is labelled consistently in every child plan:

- **DOC**: user, integrator, website or reference documentation;
- **SW**: repository implementation and automated verification;
- **INT**: board/BSP integration and hardware qualification;
- **OPS**: release, key, support or manufacturing operating process;
- **COND**: work required only if a product promise is selected.

## Proposal

### Independently approved child plans

| Plan / task | Deliverable and approval boundary | Class | Priority | Estimate | Main dependencies |
| --- | --- | --- | --- | --- | --- |
| PLAN-042 / RFCT-278 (completed) | User documentation contract and official website content | DOC | P0 | 3-4 engineer-weeks | Verified claims from all shipped capabilities |
| PLAN-043 / RFCT-279 (completed) | Release identity, artifacts, SBOM and supply-chain publication | SW/OPS/DOC | P0 | 2-3 weeks | Existing build, TUF and RAUC tooling |
| PLAN-044 / RFCT-280 (completed) | RTC, always-running NTP and timezone management | SW/INT/DOC | P0 | 2-3 weeks plus board validation | mosd/apid/UI settings and board RTC support |
| [PLAN-045](PLAN-045.md) / [RFCT-281](../task/RFCT-281.md) | One unexpanded `/usr/bin/busybox` emergency binary | SW/DOC | P2 | 0.5-1 week | Base rootfs composition |
| PLAN-046 / RFCT-282 (completed) | Installation, first-run onboarding and provisioning | SW/INT/DOC | P0 | 3-5 weeks | Release artifacts and board installation paths |
| PLAN-047 / RFCT-283 (completed) | Authenticated, resumable system update delivery | SW/OPS/DOC | P0 | 5-8 weeks | Release metadata, trusted time and RAUC/TUF keys |
| PLAN-048 / RFCT-284 (completed) | Manual recovery, access recovery and reset contracts | SW/INT/DOC | P0 | 4-6 weeks | Slot/update state and storage reset decisions |
| PLAN-049 / RFCT-285 (completed) | Storage status, media health and data lifecycle | SW/INT/DOC | P0 | 4-7 weeks | Board media capabilities and recovery policy |
| PLAN-050 / RFCT-286 (completed) | BSP porting manual and field-reliability qualification | INT/DOC | P0 | 2-3 weeks for framework; 1-3 per board | Vendor inputs and physical hardware |
| [PLAN-051](PLAN-051.md) / [RFCT-287](../task/RFCT-287.md) | Native/image and custom-container application delivery | DOC/INT, COND controls | P1 | 2-3 weeks | Stable update, persistence and API contracts |
| PLAN-052 / RFCT-288 (completed) | Diagnostics bundle and operational network state | SW/DOC | P0 | 4-6 weeks | Storage, time and redaction rules |
| PLAN-053 / RFCT-289 (completed) | Security boundary and manufacturing lifecycle | SW/INT/OPS/DOC | P0 | 4-7 weeks | Board assurance, release keys and provisioning |
| [PLAN-054](PLAN-054.md) / [RFCT-290](../task/RFCT-290.md) | Conditional fleet-management architecture | COND | P2 | 3-5 weeks design only | A product decision to sell fleet operation |

Each row has one acceptance boundary. A child may be approved without approving
its siblings; implementation begins only after that child plan is explicitly
approved and its task is claimed.

### The 1.0 milestone — decided 2026-09-04

**1.0 is not a feature count. It is the point at which every promise the product
makes can be kept.** A capability that works but cannot be updated, recovered or
trusted in the field is not part of 1.0; a capability that is absent and said to
be absent does not block it.

**Baseline, measured on 2026-09-04** across `docs/design/` and `docs/user/`:
**101 `[implemented]`, 33 `[partial]`, 54 `[proposed]`, 29 `[not implemented]`.**
The three documents furthest from their own claims are `recovery.md` (21 / 14 /
4 / 7), `access.md` (13 / 4 / 0 / 10) and `api.md` (33 / 4 / 18 / 2). This
snapshot is the thing the gates below move, and it is re-measured rather than
remembered.

Four gates block 1.0. Everything else is explicitly outside it.

#### Gate A — Trust is real

The largest gap, and the only one where **something already published has no
starting point**. `release-signing.md` is 1 `[implemented]` against 4
`[not implemented]`.

- A production key ceremony is performed and recorded — RAUC CA, the signing
  key, and their custody.
- **A shipped image provisions its trust anchor.** `docs/user/security.md` §2
  records that the device-side verifier ships and its anchor does not: no image
  provisions the pinned root, so the walk has never had a starting point in the
  field. Under PLAN-070 question 6 the release side is lode's scheme, so this
  gate is that scheme's anchor, not TUF's.
- **A keyring rotation path exists that does not require an image signed by the
  key being replaced.** Recorded today as a gap in the same section.
- **A device can state whether it trusts a development CA.** PLAN-070 question 4;
  `meta/GENERATED` is build-host-only, so a fielded device cannot answer it.
- **An image carrying a development keyring cannot be published.** Enforced by
  the release gate, not by the convention that no such image should leave a desk.

Without this gate, every device sold under 1.0 is a device that cannot be safely
updated. It is the one gate with no acceptable partial form.

#### Gate B — The update loop closes

- PLAN-070 implemented: the `meta/` seam and the `/mos/config/` namespace, so a
  freshly flashed device can be configured by dropping documents in.
- PLAN-071 implemented, **including §9's downgrade floor and §9.6's freshness
  bound** — the two properties that replace what leaving TUF gave up. A shipped
  update path without both is a net loss of a security property.
- **Enumerated failure codes on the update path** (PLAN-076's B4). The path
  reports failure as free text today, so no fleet or support surface can say why
  an update failed without shipping a string that fails the reporting rule.
- The release side's **re-sign cadence** decided and operating, per §9.6: metadata
  must be re-signed before it expires or fielded devices report stale checks
  against a repository nobody attacked.

#### Gate C — Recovery is honest

`recovery.md` carries 14 `[partial]` and 7 `[not implemented]`; `access.md`
carries 10 `[not implemented]`. **A device that cannot be recovered in the field
is not a 1.0 product**, but the gate is not "implement all of it".

- Every `[partial]` in `recovery.md` and `access.md` is either **completed** or
  **restated as an explicit non-capability**. A half-built capability described
  as if it works is the failure mode; either end state passes.
- No customer-facing page describes as available anything the tree marks
  `[partial]` or `[proposed]`. This is already the rule
  (`docs/verify-status.sh` gates it); the gate is that the rule has nothing left
  to catch in the pages 1.0 ships.

#### Gate D — Exactly one board is qualified, and it is cx3576

**x64 is explicitly not a 1.0 board.** The tree describes it in four places as
the QEMU/CI baseline at bring-up tier, with no dossier and explicitly not
mos-qualified, and PLAN-074 relied on exactly that to narrow its kernel. That
stays true through 1.0.

- cx3576's dossier complete, with **dated evidence** — the condition PLAN-037's
  own principles already set for marketing a board as mos-qualified.
- Boot assurance published as an evidenced **I1–I4 level**, not as "secure boot".
- The outstanding bench measurements taken and recorded: the `eth1` DHCPv4
  lease defect, whether a watchdog device exists at all, which UART drives the
  display, and the input device set (`adc-keys` is `status = "disabled"` in the
  board DTS).
- The **arm64 verification debt** discharged on a host that can run it, rather
  than deferred a further release.

#### Explicitly outside 1.0

These are not unfinished — they are **deliberately not in it**, and saying so is
what keeps 1.0 reachable:

- **The cloud plane**: PLAN-072 registration and PLAN-076 state reporting. Both
  are off by default and assistive; a device that never contacts a plane is a
  complete product.
- **Encryption at rest.** PLAN-074 provisions the kernel capability; the product
  decision stays gated, because it needs a key custody and recovery story and
  **a key that cannot be recovered turns a full disk into a dead device.**
- **Managed and untrusted application controls** (PLAN-069), which waits on its
  own trigger conditions rather than on a date.
- **A remote support channel** (PLAN-054's deferred half), excluded by
  PLAN-072 §4 and requiring its own record.

#### Order, and why it is not the current order

**A → B → C → D.** Gate A first, because every signing assumption in Gate B
rests on it. Today the sequence is inverted: the update module is being designed
against a trust anchor that does not yet exist in any image. That inversion is
the single largest scheduling risk in this programme, and it is the reason this
milestone names the order rather than only the contents.

### Dependency and critical path

The first pilot-critical chain is release identity and trusted time (PLAN-043,
PLAN-044) into authenticated updates (PLAN-047). Installation and provisioning
(PLAN-046) can advance in parallel but need the same release and board
identities. Recovery and storage (PLAN-048, PLAN-049) jointly define which
reset, repair and data-preserving operations are safe. BSP evidence (PLAN-050)
feeds every public hardware claim.

Documentation and website structure (PLAN-042) can start early, but capability
pages remain explicitly proposed until their software, integration and
operations evidence passes. BusyBox ([PLAN-045](PLAN-045.md)) is independent.
Application guidance ([PLAN-051](PLAN-051.md)) and diagnostics (PLAN-052) use
the stable platform contracts. Fleet management ([PLAN-054](PLAN-054.md)) stays
conditional and outside the pilot critical path unless product scope changes.

### Capacity-based draft schedule

Assume two platform engineers, one documentation/QA engineer and a half-time
BSP integrator. Dates are scheduling inputs, not approval or delivery promises.

| Window | Work that may run after its own approval |
| --- | --- |
| 2026-09-01 to 2026-09-11 | Review the split, assign owners, approve only the first bounded plans |
| 2026-09-14 to 2026-10-09 | Documentation skeleton, release identity, time, install/onboarding, BSP qualification skeleton and BusyBox |
| 2026-10-12 to 2026-11-06 | Device-side update, storage visibility, diagnostics foundations and recovery design |
| 2026-11-09 to 2026-12-04 | Recovery execution, board evidence, application guidance, security/manufacturing and verified public content |
| From 2026-12-07 | Remaining P1 work and PLAN-054 only if fleet scope is approved |

The programme owner updates dependencies and sequencing here; implementation
details, file scope and acceptance remain exclusively in the child records.

## Risks

- Splitting records can hide cross-plan dependencies. The matrix and critical
  path above are the coordination source of truth.
- Documentation can certify fiction if published ahead of evidence. PLAN-042
  must expose capability status and link each claim to a test, release artifact,
  board dossier or approved policy.
- Hardware evidence has no owner by default on user-selected boards. Such
  boards must be labelled integrator-qualified, not silently included in the
  mos-qualified matrix.
- Other repository plans are active concurrently. Child tasks must claim their
  scopes and preserve unrelated changes before implementation.
- Conditional managed-application, encryption, fleet, RT, safety and
  product-specific hardware promises can expand the programme materially; they
  require new approval rather than being absorbed into these plans.

## Scope

This umbrella plan owns only programme structure, shared principles,
dependencies, priority and draft scheduling. It does not implement software,
write the user manual, publish a website, qualify a board or close any product
gap. Those outcomes belong to PLAN-042 through PLAN-054.

## Alternatives

1. Keep the original monolithic plan. Rejected because unrelated capabilities
   cannot be assigned, approved or accepted independently.
2. Split only into “documentation” and “software”. Rejected because update,
   time, storage, recovery and BSP work have different hardware, operations and
   release dependencies.
3. Create one plan per documentation page. Rejected because pages are not
   independently shippable system capabilities and would fragment acceptance.

## Annotations

- 2026-08-31 03:29 UTC: Include official website content and hardware/board
  porting.
- 2026-08-31 03:35 UTC: Treat mos as embedded Linux rather than ordinary
  CoreOS; retain CoreOS only as a documentation/lifecycle reference.
- 2026-08-31 03:43 UTC: Cover software-package publication, custom program
  startup and custom containers.
- 2026-08-31 03:50 UTC: Remove `systemd-sysext`; use whole-system RAUC updates.
- 2026-08-31 03:54 UTC: Compare mos with a complete embedded Linux and state
  precisely whether disk management exists.
- 2026-08-31 04:01 UTC: Make trusted boot best effort for binary-only U-Boot
  boards and make board integration primarily a documented user/integrator
  responsibility.
- 2026-08-31 04:11 UTC: Distinguish documentation guidance from technical
  enforcement for native signatures, container keys, least-privilege hardware,
  resource limits and application rollback.
- 2026-08-31 04:20 UTC: Make software versus documentation work explicit,
  prepare a schedule and include NTP/time/timezone.
- 2026-08-31 04:26 UTC: Consider BusyBox and require base-image NTP with
  UI-configurable servers and timezone.
- 2026-08-31 04:30 UTC: Include only the BusyBox binary, without expanded
  applet links, so emergency links can be created when needed.
- 2026-08-31 04:31 UTC: Put BusyBox in `/usr/bin` and keep NTP continuously
  running without a pause control.
- 2026-08-31 04:34 UTC: Pin time synchronization policy to adaptive 32-2048
  second polling, 30-second retry and 60-second saved-clock intervals.
- 2026-09-01 13:18 UTC: Split the monolithic proposal into independently
  approvable small plans and tasks; keep PLAN-037 as coordination only.
