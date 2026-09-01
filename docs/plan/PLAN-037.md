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
| [PLAN-042](PLAN-042.md) / [RFCT-278](../task/RFCT-278.md) | User documentation contract and official website content | DOC | P0 | 3-4 engineer-weeks | Verified claims from all shipped capabilities |
| [PLAN-043](PLAN-043.md) / [RFCT-279](../task/RFCT-279.md) | Release identity, artifacts, SBOM and supply-chain publication | SW/OPS/DOC | P0 | 2-3 weeks | Existing build, TUF and RAUC tooling |
| [PLAN-044](PLAN-044.md) / [RFCT-280](../task/RFCT-280.md) | RTC, always-running NTP and timezone management | SW/INT/DOC | P0 | 2-3 weeks plus board validation | mosd/apid/UI settings and board RTC support |
| [PLAN-045](PLAN-045.md) / [RFCT-281](../task/RFCT-281.md) | One unexpanded `/usr/bin/busybox` emergency binary | SW/DOC | P2 | 0.5-1 week | Base rootfs composition |
| [PLAN-046](PLAN-046.md) / [RFCT-282](../task/RFCT-282.md) | Installation, first-run onboarding and provisioning | SW/INT/DOC | P0 | 3-5 weeks | Release artifacts and board installation paths |
| [PLAN-047](PLAN-047.md) / [RFCT-283](../task/RFCT-283.md) | Authenticated, resumable system update delivery | SW/OPS/DOC | P0 | 5-8 weeks | Release metadata, trusted time and RAUC/TUF keys |
| [PLAN-048](PLAN-048.md) / [RFCT-284](../task/RFCT-284.md) | Manual recovery, access recovery and reset contracts | SW/INT/DOC | P0 | 4-6 weeks | Slot/update state and storage reset decisions |
| [PLAN-049](PLAN-049.md) / [RFCT-285](../task/RFCT-285.md) | Storage status, media health and data lifecycle | SW/INT/DOC | P0 | 4-7 weeks | Board media capabilities and recovery policy |
| [PLAN-050](PLAN-050.md) / [RFCT-286](../task/RFCT-286.md) | BSP porting manual and field-reliability qualification | INT/DOC | P0 | 2-3 weeks for framework; 1-3 per board | Vendor inputs and physical hardware |
| [PLAN-051](PLAN-051.md) / [RFCT-287](../task/RFCT-287.md) | Native/image and custom-container application delivery | DOC/INT, COND controls | P1 | 2-3 weeks | Stable update, persistence and API contracts |
| [PLAN-052](PLAN-052.md) / [RFCT-288](../task/RFCT-288.md) | Diagnostics bundle and operational network state | SW/DOC | P0 | 4-6 weeks | Storage, time and redaction rules |
| [PLAN-053](PLAN-053.md) / [RFCT-289](../task/RFCT-289.md) | Security boundary and manufacturing lifecycle | SW/INT/OPS/DOC | P0 | 4-7 weeks | Board assurance, release keys and provisioning |
| [PLAN-054](PLAN-054.md) / [RFCT-290](../task/RFCT-290.md) | Conditional fleet-management architecture | COND | P2 | 3-5 weeks design only | A product decision to sell fleet operation |

Each row has one acceptance boundary. A child may be approved without approving
its siblings; implementation begins only after that child plan is explicitly
approved and its task is claimed.

### Dependency and critical path

The first pilot-critical chain is release identity and trusted time
([PLAN-043](PLAN-043.md), [PLAN-044](PLAN-044.md)) into authenticated updates
([PLAN-047](PLAN-047.md)). Installation and provisioning
([PLAN-046](PLAN-046.md)) can advance in parallel but need the same release and
board identities. Recovery and storage ([PLAN-048](PLAN-048.md),
[PLAN-049](PLAN-049.md)) jointly define which reset, repair and data-preserving
operations are safe. BSP evidence ([PLAN-050](PLAN-050.md)) feeds every public
hardware claim.

Documentation and website structure ([PLAN-042](PLAN-042.md)) can start early,
but capability pages remain explicitly proposed until their software,
integration and operations evidence passes. BusyBox ([PLAN-045](PLAN-045.md))
is independent. Application guidance ([PLAN-051](PLAN-051.md)) and diagnostics
([PLAN-052](PLAN-052.md)) use the stable platform contracts. Fleet management
([PLAN-054](PLAN-054.md)) stays conditional and outside the pilot critical
path unless product scope changes.

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
