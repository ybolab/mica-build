# PLAN-047 Deliver authenticated system updates

- **status**: implementing
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-283](../task/RFCT-283.md)

## Context

RAUC can install a bundle already present on the device, boot credits support
automatic slot fallback, and host-side TUF publication tooling exists. Devices
cannot yet discover, authenticate, download or resume an update; production
RAUC trust anchors, release streams, maintenance policy and management API/UI
are also incomplete. This is the only field-update path for system packages and
OS-integrated native applications.

## Proposal

- **SW/OPS:** provision production RAUC verification keys independently from
  TUF repository trust, with documented rotation, revocation and recovery.
- **SW:** add a device-side client that selects a compatible target from signed
  PLAN-043 metadata, enforces board/profile/schema/version constraints, downloads
  resumably into bounded `/mos/updates/downloads` space, moves only a complete
  authenticated artifact into `/mos/updates/verified`, then invokes RAUC with
  that verified DATA-tier path. PLAN-061 owns the writable mount and readiness
  contract; the updater must not fall back to STATE, `/var`, rootfs or tmpfs.
- **SW:** model explicit idle, checking, downloading, ready, installing,
  reboot-required, validating, succeeded, rolled-back and failed states through
  mosd, authenticated apid and UI.
- **SW:** add maintenance windows, metered/offline policy and an application-aware
  safe-to-reboot interlock with a bounded administrative override and audit.
- **SW/INT:** test power interruption during download/install/first boot,
  exhausted boot credits, incompatible targets and insufficient space on every
  claimed board/storage class.
- **OPS/DOC:** define staged promotion, rollback barriers, schema migrations,
  offline bundle import, operator update/rollback procedures and support data.

The system update replaces a complete inactive rootfs slot. It does not install
individual `.deb` files on the device and does not use `systemd-sysext`.

## Risks

- Incorrect trusted time can reject valid metadata or accept expired metadata;
  PLAN-044 boot ordering is a prerequisite for online signed updates.
- A valid but incompatible image can still brick peripherals or data schemas;
  compatibility and first-boot health gates must precede slot confirmation.
- Download space can compete with DATA applications; PLAN-049 must define
  reservation and low-space behavior.
- `/mos` can be absent, read-only or exhausted even when the rootfs is healthy;
  PLAN-061 readiness must make that a named update-unavailable state before
  acquisition starts, not a late write failure or fallback path.

## Scope

In scope: keyring delivery, metadata selection, resumable/offline acquisition
under `/mos/updates`,
RAUC orchestration, state/API/UI, reboot gating, board fault-injection and user
guides. Out of scope: application-container updates and fleet-wide orchestration.

## Alternatives

1. Let operators copy a bundle and call RAUC manually. Retained as an offline
   service path, but insufficient as the normal supported update lifecycle.
2. Update individual packages. Rejected because it breaks atomic A/B rollback.
3. Treat automatic boot fallback as the full rollback UX. Rejected because
   operators also need status, manual policy and recovery when both slots fail.

## Annotations

- 2026-08-31: The user removed system extensions and selected whole-system
  updates for all system components.
- 2026-09-01: Split from PLAN-037 as the authenticated device-update boundary.
- 2026-09-02: Bound update acquisition and verified artifacts to PLAN-061's
  writable `/mos/updates` DATA workspace; no alternate staging filesystem is
  permitted.
