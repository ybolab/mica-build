# RFCT-285 Add storage status and data lifecycle management

- **status**: pending
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-049](../plan/PLAN-049.md)

## Description

Add operator visibility and safe lifecycle policy to the existing fixed GPT,
tiered filesystems, DATA growth and TRIM foundation.

## Acceptance

- StorageStatus reports each fixed tier and physical medium, current space,
  mount/error state and check/repair evidence.
- Available eMMC/NVMe/SATA health signals are normalized per board without
  inventing unsupported metrics.
- Low-space thresholds, hysteresis and reserved update workspace are enforced.
- Backup/restore, repair, reset/wipe, replacement, encryption and removable-
  media choices are explicitly supported or explicitly unsupported.
- Normal apid exposes no generic format or repartition action.

## ActiveForm

Adding fixed-tier storage status and lifecycle management.

## Dependencies

- **blocked by**: explicit approval of PLAN-049; media access for board validation
- **blocks**: update-space guarantees, recovery semantics and storage troubleshooting

## Notes

- Current answer: layout automation exists; operator-facing disk management does
  not yet exist.
