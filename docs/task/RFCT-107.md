# RFCT-107 PLAN-014 M1: delete v1 and restructure the os/ tree without changing a byte of the image

- **status**: pending
- **priority**: P1
- **owner**: -
- **createdAt**: 2026-08-25 10:50
- **plan**: PLAN-014 (M1)

Delete the v1 single-slot chain and reshape `os/` into the PLAN-014 target
tree by pure `git mv` — zero logic changes.

## Scope

- Delete: `os/mkimage.sh`, `os/verify-image.sh`, `os/rootfs/build.sh`,
  `os/rootfs/Dockerfile`, their Makefile targets (`os-image-cx3576`,
  `os-verify-cx3576`), help text, and doc references. Sweep comments that
  cite v1 as a live sibling (e.g. `build-v2.sh`'s ROOT_PASSWORD note).
- Move (no content edits beyond path references):
  `layout/<b>-v2.env` → `boards/<b>/board.env`; `boot/cx3576-boot.cmd` and
  `boot/x64-grub.cfg` → `boards/<b>/`; `rootfs/overlay-<b>/` →
  `boards/<b>/overlay/`; `os/hwinit/` → `boards/cx3576/hwinit/`;
  `rauc/` + `bundle.sh` → `update/`; test scripts → `tests/`;
  `qemu-*.sh` → `tools/`; assemblers keep working from their new homes.
- Update every path reference: Makefile, inter-script, `shellcheck source=`,
  the consumer lists in the board env headers, doc citations.

## Acceptance

- `os-verify-*-v2` green for both boards on images rebuilt from the moved tree.
- A rebuilt image is byte-identical to one built from the pre-move commit.
- `make docs-verify` passes; a repo-wide grep finds no reference to a
  deleted or pre-move path.

## Dependencies

- Blocked on RFCT-106 landing on main (its working-tree changes touch
  `mkimage-v2.sh`, `mkimage-x64.sh`, `Dockerfile.v2`, `verify-image-v2.sh`).
