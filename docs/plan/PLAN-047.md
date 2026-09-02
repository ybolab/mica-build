# PLAN-047 Deliver authenticated system updates

- **status**: completed
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **completedAt**: 2026-09-02
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

## Completion

### Delivered

- `pkgs/rauc-sign` now ships the `rauc-update` client, signed target selection,
  resumable and bounded `/mos/updates` acquisition, verified handoff and
  lockbox import; `pkgs/rauc-sign/deb/rauc-update` installs the device binaries.
- `pkgs/mosd/mosd/src/update_lifecycle.rs` and `update_policy.rs` drive the
  state machine and policy gates; `pkgs/mosd/apid/src/update_api.rs` and the
  System UI expose the authenticated control and status surface.
- `docs/design/updates.md` records the state model, policies, operator paths
  and the unit-versus-bench fault-evidence boundary.

### Verification

- `(cd verify && bun test)`, `make os-apid-api-spec-pins` and
  `bash tests/deb-preflight-test.sh` — packaged client, release identity, API
  contract and package inputs.
- `bash tests/rauc-trust-negative-test.sh` and
  `bash tests/trust-domain-hygiene-test.sh` — wrong-key/tampered-bundle
  refusals and trust-domain separation.
- `bash tests/rootfs-manifest-test.sh`, `bash tests/mos-data-layout-test.sh`,
  `make docs-verify` and `bash tests/shell-pipefail-lint.sh`.

Cargo gates were not rerun in this acceptance sweep: each merged Rust subtask
ran its Cargo gates on the identical delivered commit.

### Residue

- Production images still need a product-selected provisioning path for the
  pinned TUF `root.json` and `/var/lib/mos/update/` rollback state; RAUC device
  keyring rotation also remains a fleet re-anchoring decision.
- `mos-health` does not yet report `health.boot`, so a real device does not
  advance from validation to the `succeeded` state through that signal.
- PLAN-049 still owns the numeric DATA reservation behind `maxBytes`.
- Every bench column in `docs/design/updates.md` section 6 remains owed,
  including real power cuts, low-space/read-only DATA, incompatible install,
  exhausted boot credits and the complete automatic-fallback loop on each
  claimed board/storage class.

### Acceptance matrix

| Acceptance | Verdict | Evidence and verification | Residue |
|---|---|---|---|
| Production RAUC and TUF trust domains are provisioned, rotatable and tested against wrong-key/tampered artifacts. | Partially satisfied | `docs/design/release-signing.md`; `pkgs/rauc-sign/tests/rotation.rs`; `tests/rauc-trust-negative-test.sh`; the negative suite passed. | Device provisioning of the pinned TUF root/state and RAUC keyring rotation are not shipped; production key ceremonies are operator-owned. |
| Compatible targets are discovered from signed release metadata and downloaded resumably within reserved space, with an offline import path. | Partially satisfied | `pkgs/rauc-sign/src/update.rs`; `pkgs/rauc-sign/src/workspace.rs`; `pkgs/rauc-sign/deb/rauc-update`; packaging/verifier gates passed. | The pinned root and STATE rollback directory are not provisioned, and PLAN-049 still owes the numeric storage reservation policy. |
| mosd/apid/UI expose complete update, validation and rollback state. | Partially satisfied | `pkgs/mosd/mosd/src/update_lifecycle.rs`; `pkgs/mosd/apid/src/update_api.rs`; `pkgs/mosd/apid/ui/src/app/routes/system.tsx`; verify Bun tests and API spec pins passed. | `mos-health` does not publish `health.boot`, so the real image cannot yet emit the healthy `succeeded` transition through that contract. |
| Maintenance, metered/offline and safe-to-reboot policies are explicit. | Satisfied | `pkgs/mosd/mosd/src/update_policy.rs`; `pkgs/mosd/mosd/src/update_lifecycle.rs`; `docs/design/updates.md`; the merged Rust subtask gates cover policy branches and docs verification passed. | None. |
| Board tests cover power loss, incompatibility, low space, failed first boot and automatic fallback; operator docs match the evidence. | Partially satisfied | `docs/design/updates.md`; `pkgs/rauc-sign/tests/update.rs`; `docs/design/uboot-ab-handshake.md`; merged Rust gates cover host-side behavior and docs verification passed. | Bench owed: every section 6 hardware row, including real power interruption, storage faults, board compatibility refusal, failed first boot/credit exhaustion and the full automatic fallback loop. |

## Annotations

- 2026-08-31: The user removed system extensions and selected whole-system
  updates for all system components.
- 2026-09-01: Split from PLAN-037 as the authenticated device-update boundary.
- 2026-09-02: Bound update acquisition and verified artifacts to PLAN-061's
  writable `/mos/updates` DATA workspace; no alternate staging filesystem is
  permitted.
- 2026-09-02: Campaign `l1-6rjx4wrt-20260901180748` was integrated from merge
  branch `bkd/v0nvqwf3` for acceptance and completion.
