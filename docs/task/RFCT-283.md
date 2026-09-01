# RFCT-283 Deliver authenticated system updates

- **status**: implementing
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
