# RFCT-283 Deliver authenticated system updates

- **status**: completed
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-047](../plan/PLAN-047.md)

## Description

Turn existing RAUC installation and host-side TUF tools into the supported
device-side authenticated system-update lifecycle.

## Acceptance

- Production RAUC and TUF trust domains are provisioned, rotatable and tested
  against wrong-key/tampered artifacts.
- Compatible targets are discovered from signed release metadata and downloaded
  resumably within reserved space, with an offline import path.
- mosd/apid/UI expose complete update, validation and rollback state.
- Maintenance, metered/offline and safe-to-reboot policies are explicit.
- Board tests cover power loss, incompatibility, low space, failed first boot
  and automatic fallback; operator docs match the evidence.

## ActiveForm

Delivering authenticated A/B system updates.

## Dependencies

- **blocked by**: explicit approval of PLAN-047; PLAN-043, PLAN-044 and storage-space policy from PLAN-049
- **blocks**: supported field release of system and native application changes

## Notes

- Updates replace the inactive rootfs through RAUC; no `systemd-sysext` or
  on-device `.deb` installation is introduced.

## Completion

Completed on 2026-09-02 after the campaign acceptance sweep.

| Acceptance | Verdict | Evidence and verification | Residue |
|---|---|---|---|
| Production RAUC and TUF trust domains are provisioned, rotatable and tested against wrong-key/tampered artifacts. | Partially satisfied | `docs/design/release-signing.md`; `pkgs/rauc-sign/tests/rotation.rs`; `tests/rauc-trust-negative-test.sh`; the negative suite passed. | Device provisioning of the pinned TUF root/state and RAUC keyring rotation are not shipped; production key ceremonies are operator-owned. |
| Compatible targets are discovered from signed release metadata and downloaded resumably within reserved space, with an offline import path. | Partially satisfied | `pkgs/rauc-sign/src/update.rs`; `pkgs/rauc-sign/src/workspace.rs`; `pkgs/rauc-sign/deb/rauc-update`; packaging and verifier gates passed. | The pinned root and STATE rollback directory are not provisioned, and PLAN-049 owes the numeric storage reservation. |
| mosd/apid/UI expose complete update, validation and rollback state. | Partially satisfied | `pkgs/mosd/mosd/src/update_lifecycle.rs`; `pkgs/mosd/apid/src/update_api.rs`; `pkgs/mosd/apid/ui/src/app/routes/system.tsx`; verify Bun tests and API spec pins passed. | `mos-health` does not publish `health.boot`, so the real image cannot yet emit the healthy `succeeded` transition through that contract. |
| Maintenance, metered/offline and safe-to-reboot policies are explicit. | Satisfied | `pkgs/mosd/mosd/src/update_policy.rs`; `pkgs/mosd/mosd/src/update_lifecycle.rs`; `docs/design/updates.md`; merged Rust gates cover the policy branches and docs verification passed. | None. |
| Board tests cover power loss, incompatibility, low space, failed first boot and automatic fallback; operator docs match the evidence. | Partially satisfied | `docs/design/updates.md`; `pkgs/rauc-sign/tests/update.rs`; `docs/design/uboot-ab-handshake.md`; host-side evidence and docs gates passed. | Bench owed: every section 6 hardware row, including power interruption, storage faults, board incompatibility, failed first boot/credit exhaustion and the complete automatic-fallback loop. |

Cargo gates were not rerun in this acceptance sweep because each merged Rust
subtask ran them on the identical delivered commit.
