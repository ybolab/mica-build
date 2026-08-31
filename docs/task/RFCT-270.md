# RFCT-270 Deliver rootfs components as Debian packages

- **status**: in_progress
- **priority**: P1
- **owner**: roy/plan036-bkd-campaign-20260830
- **createdAt**: 2026-08-30 11:54
- **plan**: [PLAN-036](../plan/PLAN-036.md)

## Description

Replace the ordered `10-base` through `40-board` rootfs mutation chain with
independently built Debian packages. Build mosd/apid, MQTT, RAUC, Podman,
system policy and board content in their own pinned builder images, publish
`.deb` artifacts with explicit dependencies and file ownership, and compose a
rootfs by installing a board/profile package manifest through APT. Retain only
the final image-closing and squashfs/dm-verity work outside the package model.

Substantially reduce commentary while migrating the code: preserve concise
security, boot, reproducibility and shell-semantics invariants; remove repeated
incident narratives and descriptions that are already executable as package
metadata or tests.

## Acceptance

- Every repository-owned file installed before rootfs closing is owned by one
  `mos-*` Debian package, with no duplicate paths between packages.
- mosd/apid and MQTT are separate build targets and separate package sets;
  installing or building one does not compile or install the other's binaries.
- RAUC, Podman, common system content and board content are delivered as
  packages. Wi-Fi client, Wi-Fi AP and Bluetooth are three disjoint packages;
  they share `rfkill` only through Debian dependency resolution and do not
  depend on one another.
- APT installs the selected board/profile manifest into a clean Debian base,
  and `apt-get check`, `dpkg --audit`, the image verifier and smoke gate pass.
- The `10` through `40` stage chain and its driver are retired. Final tree
  closing, squashfs, dm-verity and artifact export remain explicit pack steps.
- Rootfs/package comments are reduced by at least 60% without removing the
  executable checks that enforce the image contract.

## ActiveForm

Waiting for RFCT-272 to complete and commit before refreshing the proposal;
no implementation is in progress.

## Dependencies

- **blocked by**: RFCT-272 completion and commit
- **coordinates with**: re-investigate the committed RFCT-272 result before implementation
- **blocks**: (none)

## Notes

- PLAN-034 was rejected because it retained ordered rootfs mutation and tried
  to simplify the existing stage-selection model.
- The accepted direction from the user is independent `.deb` production per
  component and APT-based image composition; proposal is PLAN-036.
- Each board's rootfs policy, hardware initialization and staged boot inputs
  are delivered by its own `mos-board-*` package rather than a loose overlay.
- The user explicitly paused implementation until RFCT-272 is completed and
  committed; do not claim or edit overlapping implementation files before it
  lands.
