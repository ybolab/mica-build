# RFCT-012 Partition layout v2 constants + mkimage v2 mode (cx3576)

- **status**: implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: 2026-08-18 05:05

## Description

PLAN-010 M4 puts PLAN-006 A/B updates on the systemd rootfs. This task owns the
disk-image assembly side of that move: the single source of truth for the v2
partition layout, and the v2 image assembler that consumes it.

Layout v2 (sector size 512, SPL+U-Boot stays raw at sector 64):

```text
part  label       start        size        content
p1    uenv-a      16 MiB       64 KiB      U-Boot env copy A (zero-filled)
p2    uenv-b      17 MiB       64 KiB      U-Boot env copy B (zero-filled)
p3    boot-a      18 MiB       64 MiB      FAT32, vol label BOOT-A
p4    boot-b      82 MiB       64 MiB      FAT32, vol label BOOT-B
p5    rootfs-a    146 MiB      SLOT_MIB    squashfs+verity raw image
p6    rootfs-b    146+SLOT     SLOT_MIB    zero-filled (first update fills it)
p7    meta        -            16 MiB      ext4, label meta
p8    state       -            64 MiB      ext4, label state
p9    ephemeral   -            64 MiB      ext4, label ephemeral (grown by repart)
```

Two design points worth recording:

- **The UENV pair sits before the rootfs slots.** PLAN-006 Part C sketched it
  after them. Placing it first makes `UENV_A_OFFSET_BYTES` (16 MiB) and
  `UENV_B_OFFSET_BYTES` (17 MiB) absolute constants that a U-Boot `ENV_OFFSET`
  and `/etc/fw_env.config` can be pinned to for the lifetime of the board.
  Behind a variable-size rootfs slot the env offset would move with every
  release that changes SLOT_MIB, which would strand the RAUC boot-order
  handshake on already-flashed devices.
- **SLOT_MIB has two modes, selected by whether the pin was supplied.**
  Supplying `MOS_ROOTFS_SLOT_MIB` from the environment means FROZEN GEOMETRY:
  `SLOT_MIB` equals the pin exactly and the build fails, naming the pin, the
  actual verity size and the shortfall, if the rootfs does not fit. This is the
  release path. Growing a slot silently is the failure mode that matters for an
  A/B system: rootfs-b, meta, state and ephemeral all sit at offsets derived
  from `SLOT_MIB`, so a grown slot yields a GPT no already-flashed device can
  accept, and RAUC bundles whose rootfs image no longer fits the deployed slot
  fail at install time on the fielded fleet — the worst place to find out.
  Not supplying it selects the dev path, where the built-in default 256 is a
  floor and `SLOT_MIB = max(256, align16(ceil(verity_MiB * 125 / 100)))`.
  The two modes are distinguished with `${MOS_ROOTFS_SLOT_MIB+set}`, never by
  comparing against 256, so a release that legitimately pins 256 still gets the
  strict behaviour. The host wrapper forwards the pin to the inner `--assemble`
  run only when it really was pinned; forwarding the resolved value
  unconditionally would silently freeze every build.
- **No GPT partition attribute bits are set, and none are required.** v1 sets
  legacy-BIOS-bootable (bit 2) on its single boot partition; v2 sets nothing.
  Verified against mainline U-Boot v2026.07 (the ref `board/cx3576/uboot`
  builds): `disk/part_efi.c:get_bootable()` marks a partition bootable if
  *either* its type GUID is the ESP GUID *or* attribute bit 2 is set, and
  `boot/bootdev-uclass.c` only restricts its scan to bootable partitions
  (`part_get_bootable()`), so the ESP typecode that boot-a and boot-b already
  carry is sufficient — bit 2 would add nothing. RFCT-017 should therefore
  assert that the attribute flags are clear on all nine partitions. RFCT-018
  should note the corollary: because both boot slots are ESP-typed, U-Boot's
  own scan would find them in partition order, which cannot express the RAUC
  `BOOT_ORDER`; the v2 boot path must select the slot explicitly from the
  environment rather than rely on the bootable-partition scan. On the Linux
  side no attribute matters either — the data partitions use the generic Linux
  filesystem type GUID rather than a Discoverable Partitions Specification type
  GUID, so systemd's GPT partition flags play no role, and ephemeral is grown
  by an explicit systemd-repart definition, not by a flag.

The v2 image identifiers use the `...-0002-...` GUID namespace so v1 and v2
images can never be confused with one another. v1 (`os/mkimage.sh`,
`os/verify-image.sh`) is untouched and stays buildable.

## Scope

Owned here:

- `os/layout/cx3576-v2.env` - the constants file (`KEY=value` only).
- `os/mkimage-v2.sh` - the v2 assembler.
- `os/mkimage-v2-selftest.sh` - BSP-free assembler selftest.
- `Makefile` - all M4 v2 targets, added up front so no other M4 task has to
  touch this file.
- `docs/task/RFCT-012.md`.

Consumed as documented interfaces, not implemented here:

- `_out/cx3576/rootfs-verity.img`, `_out/cx3576/rootfs-verity.env`,
  `_out/cx3576/boot-cmdline-a.txt`, `_out/cx3576/boot-cmdline-b.txt` -
  produced by `os/rootfs/build-v2.sh` (RFCT-013).
- RAUC `system.conf` / `fw_env.config` renderers (RFCT-014) and
  `os/verify-image-v2.sh` (RFCT-017) read their constants from
  `os/layout/cx3576-v2.env`.

## Work checklist

- [x] `os/layout/cx3576-v2.env` with every v2 constant, sourceable and
      grep/sed-parseable, headed by its consumer list
- [x] `os/mkimage-v2.sh`: nine-partition GPT, `--assemble` inner mode plus the
      alpine:3.21 container fallback
- [x] Both boot slots populated (Image + dtb + extlinux.conf from that slot's
      cmdline file), distinct FAT volume ids/labels
- [x] rootfs-a filled, rootfs-b and the uenv pair left as holes
- [x] meta/state/ephemeral ext4 with pinned labels, fs UUIDs, `-b 4096`,
      `-O ^orphan_file,^metadata_csum_seed`, `-E root_owner=0:0`
- [x] Deterministic ext4: `E2FSPROGS_FAKE_TIME` plus a pinned `-E hash_seed`
- [x] `sgdisk --verify` gate; sparse-friendly `truncate` + `dd conv=notrunc`
- [x] Makefile v2 targets + help text; v1 targets byte-identical
- [x] `os/mkimage-v2-selftest.sh` proving byte-identical rebuilds and the
      pinned GPT
- [x] Strict pinned mode vs. floor mode, covered in the selftest in all three
      shapes (pin that fits, pin that refuses, unpinned growth)
- [x] GPT attribute bits confirmed unnecessary against the U-Boot source

## Acceptance

- `bash -n` clean and shellcheck clean on both new scripts.
- v1 stays green: `make os-image-cx3576` + `make os-verify-cx3576`.
- `make os-image-cx3576-v2` fails naming `os/rootfs/build-v2.sh` until
  RFCT-013 lands - the expected state, not a defect.
- `bash os/mkimage-v2-selftest.sh` reports `RESULT: PASS`.

## Verification (2026-08-18, re-run after the strict-pin rework)

- `bash -n os/mkimage-v2.sh` and `bash -n os/mkimage-v2-selftest.sh` clean.
  `shellcheck -x -P os -s bash os/mkimage-v2.sh os/mkimage-v2-selftest.sh`
  exit 0 (run from the `koalaman/shellcheck:stable` image; the host has no
  shellcheck).
- `make os-image-cx3576` + `make os-verify-cx3576` (BOARD_DIR pointed at the
  prebuilt BSP tree) - `RESULT: PASS (71/71 checks)`, unchanged from RFCT-011.
- `make os-image-cx3576-v2` -> `bash: os/rootfs/build-v2.sh: No such file or
  directory`; `bash os/mkimage-v2.sh` alone -> `error: .../rootfs-verity.img
  not found; run 'bash os/rootfs/build-v2.sh' first`.
- `bash os/mkimage-v2-selftest.sh` - `RESULT: PASS`, 79 checks: two
  consecutive assemblies byte-identical, image 803 MiB (146 + 2*256 + 16 + 64
  + 64 + 1), all nine partitions matching the pinned labels / unique GUIDs /
  typecodes / start sectors / sizes, both FAT slots carrying Image + dtb +
  their own cmdline, rootfs-a holding the payload, rootfs-b and the uenv pair
  fully zero-filled. Slot sizing is covered in all three shapes: a pin of 64
  MiB produces a 419 MiB image with rootfs-a exactly 64 MiB, rootfs-b at 210
  MiB and meta at 274 MiB while uenv-a stays at 16 MiB; a pin of 2 MiB against
  a 4 MiB rootfs exits non-zero naming the pin, the size, the 2 MiB shortfall
  and the freeze; a pin of 256 MiB (the built-in default value) against a 300
  MiB rootfs likewise refuses, proving the mode is chosen by supply and not by
  value; and the same 300 MiB rootfs unpinned grows the slot to 384 MiB.
- Sparseness: the 803 MiB image occupies 278 MiB on disk.
- Host note: the assembly runs in the alpine:3.21 container because host
  e2fsprogs is 1.46.5, which can neither switch `orphan_file` off nor honour
  `-E hash_seed`. `os/mkimage-v2.sh` probes for that with a `mke2fs -n` dry run
  instead of only checking for the binaries.
- Host note: the selftest workspace comes from `mktemp -d`, so it honours
  `$TMPDIR`. Where the docker daemon cannot bind-mount the sandbox's private
  `/tmp`, it fails with a hint to set `TMPDIR` to a visible directory; it was
  run here with `TMPDIR=$PWD/_out/tmp`.

## ActiveForm

Defining the v2 layout constants and building the v2 image assembler.

## Dependencies

- **blocked by**: RFCT-008 (M1 image pipeline)
- **blocks**: RFCT-013 (verity rootfs), RFCT-014 (RAUC config),
  RFCT-017 (v2 image verification)
