# 20260908-2011-wtmp-unbounded-append Login accounting appends to /var/log/wtmp without a bound

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-08 20:11

## Description

Login accounting appended to the classic `/var/log/wtmp` without a bound.

Implemented: `rootfs/scripts/pack-tree-surgery.sh` links `wtmp`, `btmp` and
`lastlog` to `/run/mos`, and `rootfs/overlay/etc/tmpfiles.d/mos-var.conf`
creates the volatile targets, so no login record reaches DATA.

Acceptance outstanding: on a current x64 QEMU image, repeated SSH logins leave
DATA usage unchanged and the `/run/mos` targets stay within the tmpfs bound.

## ActiveForm

Accepting the implemented fix on a current image.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-09-12: description rewritten against current source during the
  documentation restructure.
