# RFCT-292 Adopt the direct development-stage DATA layout

- **status**: completed
- **priority**: P0
- **owner**: codex/direct-data-layout-20260902
- **createdAt**: 2026-09-02 01:33

## Description

Replace the rollback-compatible `/srv/.mos` layout with the final clean DATA
layout because MOS is still under development and backward compatibility was
not requested. Mount DATA internally, expose independent system and user
subtrees at `/mos` and `/srv`, and remove migration links and slot-capability
gates from the implementation and current documentation.

## ActiveForm

Adopting the direct development-stage DATA layout.

## Dependencies

- **satisfied by**: approved PLAN-063 implementation
- **supersedes**: the compatibility phase delivered by [RFCT-291](RFCT-291.md)
- **plan**: [PLAN-063](../plan/PLAN-063.md)

## Notes

- 2026-09-02: Classified as Full because the change affects persistence,
  board fstab generation, systemd mounts, rootfs packaging, verification and
  current architecture documentation.
- 2026-09-02: The user established the project default that development-stage
  changes do not preserve compatibility unless compatibility is explicitly
  requested.

- complete: Direct DATA layout implemented and verified; compatibility paths removed from current implementation.
