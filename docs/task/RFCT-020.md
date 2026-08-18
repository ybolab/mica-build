# RFCT-020 Partition layout v2 constants + mkimage v2 mode (cx3576)

- **status**: implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: 2026-08-18 07:05

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

Design points worth recording:

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
- **The v2 boot slots carry `boot.scr`, not `extlinux/extlinux.conf`.** This
  replaces the extlinux config the first version of this assembler wrote.
  RFCT-018 (`docs/design/uboot-ab-handshake.md` sections 5.4-5.5) established
  that both U-Boot boot frameworks try extlinux *before* `boot.scr` — bootstd
  orders bootmeths by numbered driver name (`bootmeth_1extlinux` before
  `bootmeth_2script`) and the legacy path runs `scan_dev_for_extlinux` before
  `scan_dev_for_scripts`. An extlinux config in a v2 boot slot therefore wins
  outright and the entire RAUC A/B handshake — `BOOT_ORDER`, the attempt
  counters, rollback — is bypassed with no error at all. A device would simply
  never fail over. That is the worst failure mode available to this campaign,
  so extlinux is gone from the v2 path entirely rather than kept as a fallback;
  a fallback *is* the bypass. v1's `os/mkimage.sh` keeps its extlinux config
  and is untouched.
  Each slot's FAT root now holds `Image`, `rk3576-src.dtb`, the shared
  `boot.scr`, and a per-slot `mos-verity.env`. `boot.scr` is byte-identical in
  both slots — the running copy may boot either — and `mos-verity.env` is the
  only thing that differs, which is what lets one script serve both slots.
- **`boot.scr` provenance and determinism.** The source is
  `os/boot/cx3576-boot.cmd`, whose body is verbatim from
  `docs/design/uboot-ab-handshake.md` section 5.3; that document is the
  authority. It is compiled with
  `SOURCE_DATE_EPOCH=<FILE_MTIME> mkimage -T script -C none -n "mos boot"`.
  `SOURCE_DATE_EPOCH` is mandatory, not hygiene: RFCT-018 found `mkimage`
  stamps the legacy image header with wall-clock time without it, and that was
  confirmed here — two compiles of the same `boot.cmd` two seconds apart differ
  at byte 5 without it and are byte-identical with it. The epoch is taken from
  the layout env's `FILE_MTIME` so the number is pinned in one place.
- **`mos-verity.env` is derived, not re-derived.** Each slot's file holds one
  line, `verity_args=dm-mod.create="..." dm-mod.waitfor=...`, lifted out of
  that slot's `boot-cmdline-{a,b}.txt` — already a documented RFCT-013 output.
  Nothing about the verity table is recomputed here, so there is exactly one
  producer of it and no new contract for RFCT-013 to satisfy. The assembler
  does assert what it extracted: the table must reference that slot's own
  rootfs PARTUUID (`...0005` for A, `...0006` for B), must carry the root hash
  from `rootfs-verity.env`, and must carry `dm-mod.waitfor=`. A missing
  `dm-mod.waitfor=` fails the build as an explicit cross-task mismatch rather
  than being synthesised: RFCT-018 established it exists on 6.1.115 and is
  required, because `dm_init_init()` runs at `late_initcall` and its
  `wait_for_device_probe()` does not cover eMMC card discovery.
- **GUID comparisons fold case; GUID *values* are never rewritten.** GPT
  tooling (sgdisk, and therefore `os/layout/cx3576-v2.env`) spells GUIDs
  uppercase; udev/libblkid spell `/dev/disk/by-partuuid/` names — and hence the
  `PARTUUID=` forms a kernel cmdline must use — lowercase. Both denote the same
  GUID. The first integration run against RFCT-013's real output failed here:
  the assembler compared the extracted verity table against the uppercase
  layout constant literally and rejected a perfectly correct lowercase cmdline.
  The guard was right to exist (it caught a real class of error at build time
  rather than on hardware) but wrong to compare literally. Every identifier
  comparison in `os/mkimage-v2.sh` now folds case through a single `lc()`
  helper — the slot PARTUUID in the verity table, the `dm-mod.waitfor=`
  PARTUUID, the root hash and the verity salt — so the rule is stated once and
  cannot drift between call sites. The producer's spelling is passed through
  into `mos-verity.env` verbatim; nothing is normalised on the way. RFCT-013's
  lowercase choice is correct and must not be "fixed": systemd's
  fstab-generator does not normalise case either, so a lowercase cmdline is
  what actually resolves on the device.
  The same note now sits beside the GUID constants in the layout env, because
  RFCT-014 (RAUC `system.conf` slot device paths) and RFCT-017 (verifier
  assertions) will hit it too.
- **Boot-attempt credits are pinned to 1..9.** RAUC writes `BOOT_x_LEFT` with
  `%x` and reads it base 16, while U-Boot's `test -gt` parses decimal; the two
  radices agree only for 0-9. `BOOT_ATTEMPTS_MIN/MAX/DEFAULT` live in the
  layout env with that rationale, and the assembler refuses to compile a
  `boot.cmd` whose credit literals fall outside the range. RFCT-014 applies the
  same limit to `boot-attempts` / `boot-attempts-primary` in `system.conf`.
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
- `os/boot/cx3576-boot.cmd` - the tracked `boot.scr` source (OS-side data;
  nothing under `board/**`).
- `Makefile` - all M4 v2 targets, added up front so no other M4 task has to
  touch this file.
- `docs/task/RFCT-020.md`.

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
- [x] extlinux dropped from the v2 boot slots; `boot.scr` compiled from
      `os/boot/cx3576-boot.cmd` with a pinned `SOURCE_DATE_EPOCH` and written
      identically to both slots
- [x] Per-slot `mos-verity.env` derived from the slot's cmdline, with
      PARTUUID / root-hash / `dm-mod.waitfor=` assertions
- [x] Boot-attempt credits constrained to 1..9 and documented
- [x] All GUID/hash comparisons folded to one case via a single helper, with
      the uppercase/lowercase rule recorded beside the layout constants

## Boot-path dependency (expected non-booting state)

The v2 image will **not** boot on today's U-Boot build, and that is the correct
state, not a regression. The image is being built to the RFCT-018 contract while
the U-Boot side is applied separately by the user. Today's `generic-rk3576`
build has `CONFIG_ENV_IS_NOWHERE=y` — no persistent environment at all — and
explicitly disables `CONFIG_CMD_SETEXPR`, without which the attempt counter
cannot be decremented from a script. The boot path therefore depends on the
custom U-Boot carrying the commands in RFCT-018 escalation item 2
(`CONFIG_CMD_SETEXPR` in particular, plus `CMD_SOURCE`, `CMD_IMPORTENV`,
`CMD_FS_GENERIC`, `CMD_BOOTI`, `LEGACY_IMAGE_FORMAT`) on top of the persistent
redundant environment of item 1.

No extlinux fallback is provided "so that it boots in the meantime". Such a
fallback is precisely the silent-bypass failure this design removes: it would
boot, look healthy, and never honour `BOOT_ORDER` or roll back.

## Acceptance

- `bash -n` clean and shellcheck clean on both new scripts.
- v1 stays green: `make os-image-cx3576` + `make os-verify-cx3576`.
- `make os-image-cx3576-v2` fails naming `os/rootfs/build-v2.sh` until
  RFCT-013 lands - the expected state, not a defect.
- `bash os/mkimage-v2-selftest.sh` reports `RESULT: PASS`.

## Verification (2026-08-18, re-run after the GUID-case rework)

- `bash -n os/mkimage-v2.sh` and `bash -n os/mkimage-v2-selftest.sh` clean.
  `shellcheck -x -P os -s bash os/mkimage-v2.sh os/mkimage-v2-selftest.sh`
  exit 0 (run from the `koalaman/shellcheck:stable` image; the host has no
  shellcheck).
- `make os-image-cx3576` + `make os-verify-cx3576` (BOARD_DIR pointed at the
  prebuilt BSP tree) - `RESULT: PASS (71/71 checks)`, unchanged from RFCT-011.
- `make os-image-cx3576-v2` -> `bash: os/rootfs/build-v2.sh: No such file or
  directory`; `bash os/mkimage-v2.sh` alone -> `error: .../rootfs-verity.img
  not found; run 'bash os/rootfs/build-v2.sh' first`.
- `bash os/mkimage-v2-selftest.sh` - `RESULT: PASS`, 99 checks: two
  consecutive assemblies byte-identical, image 803 MiB (146 + 2*256 + 16 + 64
  + 64 + 1), all nine partitions matching the pinned labels / unique GUIDs /
  typecodes / start sectors / sizes, both FAT slots carrying Image + dtb +
  their own cmdline, rootfs-a holding the payload, rootfs-b and the uenv pair
  fully zero-filled. Boot-slot contract: both slots contain `Image`,
  `rk3576-src.dtb`, `boot.scr` and `mos-verity.env` and **no** extlinux entry;
  `boot.scr` is byte-identical across the two slots and carries the legacy
  uImage magic `27051956`; each slot's `mos-verity.env` is a single
  `verity_args=` line referencing its own rootfs PARTUUID with a matching
  `dm-mod.waitfor=`, and the two slots' files differ. Refusals: a cmdline with
  `dm-mod.waitfor=` stripped fails as a cross-task mismatch naming
  `os/rootfs/build-v2.sh`, and a slot-B cmdline pointing at rootfs-A's PARTUUID
  fails naming the expected GUID and echoing the table it found. GUID case is a
  standing regression case: the slot-A fixture uses lowercase PARTUUIDs (the
  shape the real producer emits) and the slot-B fixture uppercase, both are
  accepted, both survive into `mos-verity.env` verbatim, and the wrong-slot
  rejection is driven with a lowercase GUID so it proves case folding did not
  simply disable the guard. Slot sizing is covered in all three shapes: a pin of 64
  MiB produces a 419 MiB image with rootfs-a exactly 64 MiB, rootfs-b at 210
  MiB and meta at 274 MiB while uenv-a stays at 16 MiB; a pin of 2 MiB against
  a 4 MiB rootfs exits non-zero naming the pin, the size, the 2 MiB shortfall
  and the freeze; a pin of 256 MiB (the built-in default value) against a 300
  MiB rootfs likewise refuses, proving the mode is chosen by supply and not by
  value; and the same 300 MiB rootfs unpinned grows the slot to 384 MiB.
- End-to-end integration against RFCT-013's real outputs:
  `BOARD_DIR=/srv/ai/mos/board/cx3576 MOS_ROOTFS_SLOT_MIB=256 make
  os-image-cx3576-v2` succeeds. Verity payload 53 MiB (55574528 bytes,
  13447 data blocks, root hash
  `bb710ec6090a6acdca98765f0f646a1b89bab0145ab18d92443e4a8fd311acd7`),
  pinned slot 256 MiB, assembled image 842006528 bytes (803 MiB).
  `sgdisk --verify`: "No problems found. 38589 free sectors (18.8 MiB)
  available in 4 segments, the largest of which is 32734 (16.0 MiB) in size."
  Both boot slots hold exactly `Image`, `boot.scr`, `mos-verity.env`,
  `rk3576-src.dtb` — no extlinux — with slot A's verity args naming
  `PARTUUID=5ac35760-...-000000000005` and slot B's
  `...-000000000006`, lowercase as emitted.
- Sparseness: the 803 MiB image occupies 278 MiB on disk (synthetic selftest
  payload); the real 803 MiB image occupies 335 MiB.
- `mkimage` determinism confirmed directly: two compiles of the same
  `boot.cmd` two seconds apart differ at byte 5 without `SOURCE_DATE_EPOCH` and
  are byte-identical with it.
- The 1..9 boot-attempts guard was exercised against a mutated `boot.cmd`
  (`BOOT_A_LEFT 16`): it aborts the build. The tracked `boot.cmd`'s four credit
  literals are all 3.
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
