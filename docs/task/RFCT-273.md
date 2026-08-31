# RFCT-273 Design the embedded-first user delivery documentation set

- **status**: in_progress
- **priority**: P1
- **owner**: codex/coreos-delivery-docs-20260831
- **createdAt**: 2026-08-31 03:08

## Description

Turn the current design-record collection into a user-delivery documentation
system that uses Fedora CoreOS only as an immutable-OS documentation reference
while making mos's embedded-appliance lifecycle primary. Include the public
website content contract, an application/software-publisher track, and an
end-to-end hardware/BSP porting track. Audit documentation gaps, product
capability gaps and board-productisation gaps, then propose staged information
architectures, truth-status rules, verification gates, and the system work that
must precede claims that mos cannot yet support.

## Acceptance

- A draft PMA plan records the CoreOS benchmark, current mos documentation
  inventory, documentation-only gaps, product/design gaps, priorities, scope,
  risks, and alternatives.
- The proposal separates user-operable shipped behavior from proposed or
  missing mechanisms and does not turn Fedora CoreOS implementation choices
  into mos requirements without a mos use-case rationale.
- The proposed delivery set covers acquisition, installation, first boot,
  configuration, workload deployment, updates and rollback, recovery,
  troubleshooting, security, release/lifecycle information, and reference
  material for both English and Chinese users.
- The proposal separates OS-integrated native package publication from custom
  OCI/Quadlet containers; it documents how
  programs start and update without claiming unsupported on-device `apt/dpkg`
  or independently field-installed native-bundle behavior. System components,
  native applications and optional product profiles are updated only through
  signed RAUC A/B system images.
- The application contract defaults to a trusted product integrator: native
  applications are OS-integrated, while container identity, hardware access,
  resource limits, secrets and manual rollback are documented with tested
  examples. It requires protected technical enforcement only before claiming a
  managed/untrusted application channel or non-bypassable policy.
- The proposal includes a public website brief and page inventory tied to the
  release, capability and supported-hardware sources of truth.
- The proposal includes a hardware/BSP porting manual from board intake through
  bootloader, kernel/device tree, firmware/hwinit, image integration, factory
  provisioning, hardware-in-the-loop qualification and lifecycle maintenance.
- The porting contract treats board/BSP selection and hardware evidence as an
  integrator responsibility, supports documented binary-only bootloader inputs,
  distinguishes mos-qualified from integrator-qualified boards, and reports
  I1-I4 boot assurance without requiring or implying universal secure boot.
- Embedded delivery requirements cover zero/offline-network operation, bounded
  flash, power-loss safety, thermal/watchdog behavior, factory provisioning,
  field recovery/RMA and long-lived BSP/kernel maintenance.
- The gap audit compares mos with a production embedded-appliance baseline and
  explicitly covers storage layout, capacity, media health/wear, filesystem
  failure and repair, quotas, encryption, backup/restore, reset/secure erase,
  removable media and storage replacement without proposing a generic disk
  partition editor for the fixed A/B system layout.
- Every identified gap is assigned to documentation, software, board/BSP
  integration, operations/policy or conditional product work, with an explicit
  rule that documentation cannot close an unimplemented capability.
- The proposal includes a capacity-based draft schedule, dependency/critical
  path and work-package estimates suitable for creating separately approved
  follow-up tasks.
- Clock handling covers the actual current gap: no packed network-time daemon,
  an unproven cx3576 RTC driver path, no persistent time floor and no supported
  runtime timezone write. It schedules UTC/API semantics, RTC, NTP, offline
  recovery, status, TLS/TUF ordering, timezone persistence and per-board tests
  as software plus integration and documentation work.
- The time proposal selects `systemd-timesyncd` for the base image and defines
  an always-running service with typed NTP-server and IANA timezone settings,
  mosd reconciliation, authenticated apid/UI configuration and status,
  STATE-backed clock history, schema migration and cross-board verification
  while keeping machine time in UTC. No API or UI switch pauses NTP.
- The time policy pins adaptive NTP polling at 32-2048 seconds, failed-source
  retry at 30 seconds and persisted-clock saving at 60 seconds. These are base
  policy values rather than per-device UI settings.
- BusyBox is included in the base as the single `/usr/bin/busybox` binary, with
  no generated applet symlinks, global PATH change or normal-service dependency.
  Emergency use is explicit through `busybox APPLET` or transient links under
  `/run/mos-toolbox`; image gates preserve GNU command resolution and prevent an
  implicit initramfs role.
- No user-facing delivery guide is implemented until the proposal is approved.

## ActiveForm

Designing the embedded-first user delivery documentation set.

## Dependencies

- **blocked by**: (none)
- **blocks**: user delivery documentation implementation and the product-gap backlog derived from it

## Notes

- Reference baseline: Fedora CoreOS product and documentation sites, inspected
  on 2026-08-31.
- Investigation recorded in `docs/plan/PLAN-037.md`. The principal finding is
  that mos has strong subsystem design records but lacks a user-journey delivery
  layer, while production update trust/discovery, recovery, offline
  provisioning, diagnostics and optional fleet management remain product gaps
  that documentation must not present as shipped.
- User annotation at 2026-08-31 03:29 UTC: add an official website description
  and explicitly cover hardware and board porting. PLAN-037 was expanded to add
  both tracks and their acceptance gates.
- User annotation at 2026-08-31 03:35 UTC: mos is an embedded system, not an
  ordinary CoreOS node. The benchmark was demoted to reusable immutable-OS
  documentation patterns and the plan was recentered on the embedded product
  lifecycle.
- User annotation at 2026-08-31 03:43 UTC: include package publishing, custom
  program startup and custom containers. PLAN-037 now has a dedicated
  application-publisher documentation tree, delivery-model decision table and
  explicit product gaps for native bundles and container lifecycle/security.
- User annotation at 2026-08-31 03:50 UTC: remove the system-extension
  mechanism and use system updates. PLAN-037 now routes all system components
  through image composition plus signed RAUC A/B updates and includes cleanup
  of the obsolete extension reservation and stale design references.
- User annotation at 2026-08-31 03:54 UTC: compare the current system with a
  complete embedded Linux and determine whether disk management exists.
  PLAN-037 now includes a production embedded-appliance maturity audit and a
  precise storage assessment: automated fixed layout/growth/TRIM exists, while
  operator capacity, media health, recovery, encryption, backup/reset and
  removable-media lifecycle remain gaps.
- User annotation at 2026-08-31 04:01 UTC: trusted boot is best effort because
  many selected boards have binary-only U-Boot; board definitions are chosen
  and integrated by users, while mos primarily provides documentation guidance.
  PLAN-037 now defines the mos/integrator responsibility split, I1-I4 additive
  assurance levels, binary-only BSP intake rules and qualification ownership.
- User annotation at 2026-08-31 04:11 UTC: ask whether native signing,
  container keys, least-privilege hardware access, resource limits and
  application rollback should be documentation guidance or technical controls.
  PLAN-037 now defaults to trusted-integrator documentation plus tested
  systemd/Quadlet examples, routes native applications through RAUC OS updates,
  and makes protected enforcement conditional on a managed/untrusted app model.
- User annotation at 2026-08-31 04:20 UTC: make the software-versus-documentation
  split explicit, prepare an implementation schedule, and include NTP, time and
  timezone handling. PLAN-037 now contains an authoritative DOC/SW/INT/OPS/COND
  work breakdown, capacity-based calendar and a P0 clock/time work package.
- User annotation at 2026-08-31 04:26 UTC: consider BusyBox under `/build/bin`
  at the end of PATH, and require base-image NTP with UI-configurable NTP
  addresses and timezone. PLAN-037 rejects an implicit production BusyBox
  fallback, selects `systemd-timesyncd` for W03 and defines the settings,
  reconciler, API/UI, persistence and verification boundaries.
- User annotation at 2026-08-31 04:30 UTC: include BusyBox itself but do not
  expand applet links, so links can be created in an emergency. PLAN-037 now
  schedules the normal dynamic `/usr/bin/busybox` binary, preserves all existing
  PATH/GNU resolution, uses transient `/run` links on the read-only appliance,
  and adds image, initramfs, SBOM and cross-architecture gates.
- User annotation at 2026-08-31 04:31 UTC: confirm BusyBox should be preinstalled
  under `/usr/bin`, and keep NTP running rather than exposing a pause control.
  PLAN-037 already uses `/usr/bin/busybox`; W03 now removes `time.ntp.enabled`
  and makes timesyncd an unconditional base service while retaining editable
  server and timezone settings plus degraded/retry status.
- User annotation at 2026-08-31 04:34 UTC: ask for the time synchronization
  period. PLAN-037 now records and pins systemd 257.13's adaptive 32-2048 second
  polling window, 30-second retry floor and 60-second clock-save interval.
