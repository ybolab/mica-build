# RFCT-012 Partition layout v2 constants + mkimage v2 mode (cx3576)

- **status**: implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: 2026-08-18 04:20

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
- **SLOT_MIB freeze.** `SLOT_MIB = max(MOS_ROOTFS_SLOT_MIB,
  align16(ceil(verity_image_MiB * 125 / 100)))`, default
  `MOS_ROOTFS_SLOT_MIB=256`. Once a device is flashed its slot size is frozen:
  rootfs-b, meta, state and ephemeral all sit at offsets derived from it, and no
  update can move them. Production releases must therefore pin
  `MOS_ROOTFS_SLOT_MIB` explicitly to the value the fleet was flashed with
  rather than letting it float with content; the assembler fails loudly if the
  verity image does not fit the resolved slot.

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

## Acceptance

- `bash -n` clean and shellcheck clean on both new scripts.
- v1 stays green: `make os-image-cx3576` + `make os-verify-cx3576`.
- `make os-image-cx3576-v2` fails naming `os/rootfs/build-v2.sh` until
  RFCT-013 lands - the expected state, not a defect.
- `bash os/mkimage-v2-selftest.sh` reports `RESULT: PASS`.

## Verification (2026-08-18)

- `bash -n os/mkimage-v2.sh` and `bash -n os/mkimage-v2-selftest.sh` clean.
  `shellcheck -x -P os -s bash os/mkimage-v2.sh os/mkimage-v2-selftest.sh`
  exit 0 (run from the `koalaman/shellcheck:stable` image; the host has no
  shellcheck).
- `make os-image-cx3576` + `make os-verify-cx3576` (BOARD_DIR pointed at the
  prebuilt BSP tree) - `RESULT: PASS (71/71 checks)`, unchanged from RFCT-011.
- `make os-image-cx3576-v2` -> `bash: os/rootfs/build-v2.sh: No such file or
  directory`; `bash os/mkimage-v2.sh` alone -> `error: .../rootfs-verity.img
  not found; run 'bash os/rootfs/build-v2.sh' first`.
- `bash os/mkimage-v2-selftest.sh` - `RESULT: PASS`, 62 checks: two
  consecutive assemblies byte-identical, image 803 MiB (146 + 2*256 + 16 + 64
  + 64 + 1), all nine partitions matching the pinned labels / unique GUIDs /
  typecodes / start sectors / sizes, both FAT slots carrying Image + dtb +
  their own cmdline, rootfs-a holding the payload, rootfs-b and the uenv pair
  fully zero-filled.
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
