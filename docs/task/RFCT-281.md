# RFCT-281 Add the unexpanded BusyBox emergency binary

- **status**: pending
- **priority**: P2
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-045](../plan/PLAN-045.md)

## Description

Place one emergency BusyBox binary in the base image without changing command
resolution or creating a fallback dependency for normal services.

## Acceptance

- `/usr/bin/busybox` is present on supported architectures.
- The image contains no generated BusyBox applet links and makes no PATH or
  `/build/bin` change.
- Final-image tests prove existing GNU commands resolve as before and BusyBox is
  not an initramfs/init dependency.
- Emergency docs use `busybox APPLET` or transient `/run/mos-toolbox` links.
- SBOM, license and source-offer outputs include the shipped package.

## ActiveForm

Adding the unexpanded BusyBox emergency binary.

## Dependencies

- **blocked by**: explicit approval of PLAN-045
- **blocks**: (none)

## Notes

- This is not a rescue environment or supported application command API.
