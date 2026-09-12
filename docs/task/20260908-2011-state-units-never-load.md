# 20260908-2011-state-units-never-load STATE-seeded systemd units never load on first boot

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-08 20:11

## Description

Units seeded into `DATA/state/systemd-units` were never loaded on first boot:
systemd built the initial transaction before
`usr-local-lib-systemd-system.mount` bound the directory over
`/usr/local/lib/systemd/system`.

Implemented: `mos-load-extensions.service` runs after that mount and
`etc-containers-systemd.mount`, issues `daemon-reload` and starts
`multi-user.target` again; the container reconciler reloads after its own bind.

Acceptance outstanding: on a fresh current x64 QEMU image, a unit seeded into
`DATA/state/systemd-units` with a `multi-user.target.wants` link starts on the
first boot, and a Quadlet definition under the container bind does the same.

## ActiveForm

Accepting the implemented fix on a current image.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-09-12: description rewritten against current source during the
  documentation restructure; the removed `tools/qemu-seed-state.sh` reproducer
  is no longer cited.
