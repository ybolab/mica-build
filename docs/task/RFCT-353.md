# RFCT-353 cx3576: verify the whole flashed image, and give the mos image a flash path that does

- **status**: completed
- **priority**: P0
- **owner**: bkd/r3xp02ub
- **createdAt**: 2026-09-08 12:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

[RFCT-351](RFCT-351.md) ended on a delivery fault: a cx3576 booted a kernel
that was a mixture of two builds -- the shipped build at file offset `0x31da8`,
the previous build's bytes at `0x1e87800` -- and died in `paging_init`. The
flash that produced it reported success.

It reported success because nothing looked. `boards/cx3576/bsp/Makefile`'s
`verify-boot-area` read back `rl 0 32768` -- 16 MiB from offset 0 -- and
compared it against the first 16 MiB of the image. `boards/cx3576/board.env`
puts `boot-a` at 18 MiB and `rootfs-a` at 146 MiB: everything that decides
whether the machine runs was past the window, and the hole was ~22 MiB past
the last verified byte. The echo -- *"Boot area (loader + u-boot.itb)
verified"* -- was accurate about what it did and was read as broader.

And the image that took that path had no flash target at all. `flash` and
`flash-maskrom` write `$(BSP_OUT)/disk.img`, the Alpine demo image;
`docs/user/install.md` told a human to write the product image
`_out/cx3576/cx3576-mos-<epoch>.img` with `rkdeveloptool` by hand. No target,
therefore no read-back, for the one image a device actually runs.

## ActiveForm

Widening the cx3576 flash read-back from the first 16 MiB to the whole written
image, and giving the mos product image a flash target that carries it

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The full written image verified, or a measured reason it is not.
- A verified flash path for the mos image.
- The read-back timed on this host, in MB/s and seconds.
- Tests for the offset/length arithmetic, and the count they moved the suite to.
- `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## Notes

### The measurement, and what it could not measure

**There is no board here and no `rkdeveloptool` binary either** -- it is not on
this host's PATH and `boards/cx3576/bsp/tools/rkdeveloptool` does not exist
(`make rkdeveloptool-macos` builds it, on macOS). So the USB side of `rl` was
not timed, and no number in this record is one.

What was timed is everything else: `scripts/verify-flash.sh` run end to end
against the real images with a stub in place of the tool, the stub reading the
"medium" out of a local copy. That is not a proxy for the link, but it is the
whole host-side cost -- landing the read-back on disk and comparing it twice:

| image | bytes | host-side total | rate |
| --- | --- | --- | --- |
| `_out/cx3576/cx3576-mos-1788800841.img` | 1,378,877,440 | **10.50 s** | 125.2 MB/s |
| `_out/boards/cx3576/disk.img` | 624,951,296 | **4.67 s** | 127.5 MB/s |

Component measurements on the same host, which say where those seconds go:
reading 1.38 GB off this NVMe takes 1.13-7.30 s depending on layout
(180-1160 MB/s, `dd iflag=direct`), writing 1.38 GB with `fdatasync` takes
7.73 s (170 MB/s), and `cmp` of two warm 1.38 GB files takes 0.47 s. The
read-back landing on disk is the dominant host cost, and it is a cost the
design cannot avoid: the comparison is against a file, not a stream.

**The USB side, and why the design does not need it measured.**
`rkdeveloptool wl 0 <image>` already pushes exactly these bytes over exactly
this link, in one invocation, and the flash accepts that cost today. Reading
them back at most doubles it. That is an argument from symmetry rather than a
measurement, and it is stated as one -- but it is the same argument that says
the tool loops internally rather than capping a transfer per invocation, which
is what `wl 0` on a 1.38 GB file demonstrates every time it is run.

So: **the full read-back is affordable, and it is what was built.** No sampling,
no checksum over selected ranges, no fallback. Worth saying plainly because the
alternative was named: a checksum over sampled ranges would not have caught
this failure unless a sampled range happened to contain the hole, and the hole
was eight bytes at `boot-a + 0x1e87800`. Coverage that depends on where a
sample landed is not coverage.

### What the verification does now

`boards/cx3576/bsp/scripts/verify-flash.sh <image>`, driven from the Makefile
by the `verify-written-image` macro, which `flash`, `flash-maskrom` and the new
`flash-mos` all call:

1. Derives the head area from `board.env` **three ways** --
   `LOADER_START_SECTOR + LOADER_SIZE_SECTORS`, `UENV_A_START_SECTOR`, and
   `IMAGE_HEAD_MIB * MIB_BYTES / SECTOR_SIZE` -- and refuses if they disagree
   rather than reading back a window nothing justifies.
2. Reads that head area back, alone, and compares it. This is the boot area,
   and its comment is the old one, moved with the behaviour and not reworded: a
   partial or corrupt write there is the one failure that bricks the board past
   the recovery key. Reading it first means that failure is reported in the
   first second instead of after the whole image has come back over USB.
3. Reads back **every remaining sector** of the image and compares it. The
   request rounds the byte count UP to a whole sector; the comparison stops at
   the end of the file, because what the medium holds past the file was never
   written by this flash.
4. Deletes the read-back on success. On failure it is KEPT and named -- it is
   the board's copy, and the only evidence of what the medium holds -- and the
   message gives the first differing byte as an offset into the image, not into
   whichever read found it.

Two properties of the old macro are unchanged, and both are asserted by the
suite rather than by reading: it compares against **the file that was written**
(a checksum recomputed by the flashing host from the bytes it just sent proves
the host's arithmetic, not the transfer), and it runs **before**
`rkdeveloptool rd`, while the board is still in loader mode and a re-write is
one command away.

The split into two reads is about which failure is reported first and nothing
else. The two ranges are adjacent and together are the file, so no range falls
between them; the suite asserts exactly that rather than trusting it.

### The mos flash path, and where it went

`make -C boards/cx3576/bsp flash-mos`, in the **BSP Makefile**.

The image is the top-level build's output and the target is not; that asymmetry
is the whole question. It went to the BSP because this Makefile is the only
place in the tree that knows how to talk to the board -- `RKDEVELOPTOOL` and
its `tools/` fallback, the vendor loader and its sha256 check, the warning
about power, the `rd` that ends every write. A top-level target would either
duplicate that or delegate to it, and the second is what `make -C` already is.

`BSP_OUT` and `BOARD_DIR` stay distinct, and the product image is a THIRD
directory: `MOS_OUT ?= ../../../_out/cx3576`. Nothing in `flash-mos` reaches
into `_out/boards/cx3576`, which the suite checks -- RFCT-343 separated the BSP
source directory from the BSP output directory, and pointing a flash target at
`BSP_OUT` would have re-conflated them from the other side. The file NAME comes
from `board.env`'s `IMAGE_LATEST_NAME` through `$(shell)`, never copied into
the Makefile: `board.env` says at its head that a constant is read from it and
not duplicated, and an unreadable layout stops make with an `$(error)` rather
than handing `rkdeveloptool` a path ending in a slash.

### The tests

`tests/cx3576-flash-verify-test.sh`, wired as `make os-cx3576-flash-test`:
**21 checks, 21 passing**, ~8 s, no docker, no network, no root.

It drives the real `make flash-mos` and `make flash` recipes with a stub
`rkdeveloptool` that plays the eMMC with a file -- `wl` writes into it, `rl`
reads sectors out of it -- and logs every invocation, so the argv the recipes
build is checked rather than assumed. What it binds:

- **Argument construction.** The four calls, in order, with their arguments;
  that the default image is `_out/cx3576/` + `IMAGE_LATEST_NAME`; that no flash
  target names `BSP_OUT` for the product image.
- **The arithmetic against `board.env`.** The first read is sectors
  `0..32767` and that number is `LOADER_START_SECTOR + LOADER_SIZE_SECTORS` =
  `UENV_A_START_SECTOR` = `IMAGE_HEAD_MIB * MIB_BYTES / SECTOR_SIZE`; the second
  starts where the first stopped and ends at the last sector of the file; the
  two together cover the whole file. A constant that moves in the layout and
  not in the script fails these.
- **Coverage.** Every partition in `LAYOUT_PARTITIONS` with a fixed offset
  starts inside the verified range -- and the same walk against the 16 MiB
  window this replaced, which must still show `UENV_A`, `UENV_B`, `BOOT_A`,
  `BOOT_B` and `ROOTFS_A` outside it. Without that half, the coverage check
  could pass on a suite that had never been able to fail.
- **The failure path, as the incident.** Eight stale bytes -- the real ones,
  `61 ef ff 90 21 a0 0f 91`, `early_kvm_mode_cfg+0x10` of the previous build --
  planted at `BOOT_A_OFFSET_BYTES + 0x1e87800`, the offset RFCT-351 found them
  at. The flash must go red, `rd` must NOT run, the message must name image
  byte 50,886,656, and the read-back must survive as evidence. **And the old
  16 MiB read-back is run over the same medium and required to pass**, which is
  what makes the other four attributable to the widened window rather than to
  the fixture.
- **Fail-fast on the brick region.** A hole inside the loader fails on the
  first read; the second never runs.
- **The edges and the refusals.** An image `head + 1000` bytes long reads back
  2 sectors and compares 1000 bytes; an image no larger than the head area is
  refused before any read; a missing image is refused by name; a layout whose
  `UENV_A_START_SECTOR` no longer follows the loader is refused with the
  three-way disagreement printed.

**Mutation-tested, three ways.** Floor instead of ceiling on the sector count
reddens the odd-size case alone. Removing the second read and compare -- which
is the pre-change behaviour exactly -- reddens eight checks including the
incident. Removing the three-way head guard reddens the layout-mutation case
and nothing else. A guard whose removal changes no test is not a guard.

### What has never run here, named

No line that talks to a board has been executed, by anything, on this branch:

- `rkdeveloptool rl 0 32768 <scratch>` and `rkdeveloptool rl 32768 <n>
  <scratch>` in `scripts/verify-flash.sh` -- both read-backs.
- `rkdeveloptool wl 0 $(MOS_IMAGE)` and the `rkdeveloptool rd` that follows the
  verification in `flash-mos`.
- Everything `flash` and `flash-maskrom` already had: `wl`, `db`, `rd`.

Two assumptions about the tool that this branch cannot test, stated so that the
first bench run knows to check them:

- **That `rl` accepts a whole-image sector count in one call.** The mos image
  is 2,693,120 sectors. The argument that it does is symmetry with `wl 0`,
  which streams the same file in one invocation today; it is not a measurement.
  If the real tool caps a read, the fix is a chunked loop and the arithmetic
  the suite already binds is where it goes.
- **That `rl` writes exactly `count * 512` bytes.** The comparison truncates
  the read-back to the image's length, so a LONGER read-back is handled; a
  short one shows up as a difference at the first missing byte, which is a
  failure and not a false pass.

Two host-side lines are also unexercised: the BSD `stat -f %z` fallback (this
host is Linux, and the fallback exists because `make rkdeveloptool-macos` makes
macOS a supported flashing host), and the behaviour when the filesystem holding
the image has no room for a read-back of the image's size -- 1.32 GiB next to
`_out/cx3576/`, which nothing checks in advance.

### What was deliberately not done

- **`flash-rootfs-offline` still verifies nothing.** It writes one partition at
  sector 163840 and issues `rd`. Covering it means teaching the script to
  verify a range at an offset rather than a whole image at sector 0, which is a
  different shape from the one this task specified; the README now says plainly
  that this target reads nothing back.
- **No maskrom variant for the mos image.** `flash-maskrom` pushes the vendor
  loader and writes `disk.img`; the factory path for the product image would be
  the same two steps with `MOS_IMAGE`. Not added, because the task asked for one
  target and because the loader push has never been exercised here either.
- **`boards/cx3576/boot.cmd` and `build/src/mkimage-cx3576.ts` are untouched**
  -- RFCT-352 has both on another branch. The `booti`-without-an-error-check
  observation from RFCT-351 is still open and is still there.

### Gates

- `make os-cx3576-flash-test` -- 21/21.
- `make docs-verify` -- green, from a `git archive` of this branch into an
  empty directory.
- `make os-shell-pipefail-lint`, `make os-host-toolchain-lint`, and the BSP's
  own `make -C boards/cx3576/bsp source-check` -- green.
- Nothing here builds an image or touches the pool, so no verify run was
  affected: `verify/` reads assembled images and this change writes none.
