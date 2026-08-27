# RFCT-143 PLAN-015 M5: boards.md and display.md lose the claims that describe a build that does not exist

- **status**: completed
- **priority**: P2
- **owner**: PLAN-015 M5
- **createdAt**: 2026-08-26

Both documents described a Talos-based OS core, a Talos imager and `machined`.
None of the three is in this tree.

`docs/design/boards.md` now names the build that runs. The artifact table sends
`modules.tar` through `os/rootfs/build-v2.sh` into `os/rootfs/stages/40-board.Dockerfile`
and the bootloader blob to the raw write `os/build/src/mkimage-v2.ts` performs
at the board's `UBOOT_SEEK_SECTOR`; kernel args, console and the partition
offsets are `os/boards/<n>/board.env`, and `board.yaml` is recorded as what it
is, a description nothing reads. Section 6 states the kernel floor the boot
path sets — a dm-verity squashfs root opened from the command line by `dm-init`
with no initramfs, under Debian trixie and systemd — and keeps the two intake
options that survive it. Checklist step 5 is the rootfs stage chain, the
`os/build/` assembler and `bash os/verify/run.sh --verify`, ending at apid
healthz on hardware.

`docs/design/display.md` drops the bullet disabling an upstream Talos
dashboard: `talos.dashboard.disabled` appears on no kernel command line this
build composes. The kiosk extension service runs as a systemd unit. The splash
master keeps its measured facts — a 76 KB PNG, 1920x1080 at 16 bits per channel
— and drops the comparison to the file it replaced.

An enumeration of instances and a broad acceptance criterion must be the same
size. When a specification lists the cases it knows about and then states a
criterion wider than that list, the two disagree about scope, and the criterion
is the contract: the list is a starting point for finding the work, not a bound
on it. Work that stops at the enumeration and reports the criterion met has
reported something untrue. Where the two cannot be made the same size, the
enumeration should say it is partial.
