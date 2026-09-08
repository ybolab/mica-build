# RFCT-919 Re-derive the s905x5m `SYS_BOOTM_LEN` requirement

- **status**: completed
- **priority**: P1
- **owner**: plan-910-bootm-derivation
- **createdAt**: 2026-08-31 06:51 UTC
- **completedAt**: 2026-08-31 06:51 UTC
- **plan**: PLAN-910 M2 follow-up

## Description

Measure the s905x5m payload and its real U-Boot boot path to derive the
minimum `CONFIG_SYS_BOOTM_LEN` needed by this board. Establish the current
`booti`/`bootm` path, whether an initramfs is loaded, the kernel/DTB/FIT
payloads, compression behaviour, and explicit growth headroom. Read the pinned
U-Boot source for the relevant limit semantics. Produce an owner-facing
proposal for the shared section-5 contract without changing that contract,
the s905x5m gate, any board configuration, hardware, deployment, or reboot
state.

## Acceptance

- The record states what the current s905x5m boot path passes to U-Boot and
  whether a normal boot carries an initramfs.
- The source-backed distinction between `booti` and `bootm` is recorded,
  including the expected FIT path.
- The proposed s905x5m minimum includes arithmetic and stated growth
  headroom, and does not extrapolate it to cx3576 or x64 without evidence.
- The proposal selects and justifies (a), (b), or (c) for the shared contract.
- No eMMC, boot area, `bootloader_a`, deployment, or reboot is performed.

## ActiveForm

Measured the s905x5m boot payload and derived its bootm-length proposal.

## Dependencies

- **blocked by**: (none)
- **blocks**: owner decision on the shared section-5 bootm-length contract

## Notes

- Claimed on 2026-08-31 as an investigation/proposal-only PLAN-910 follow-up.
- Scope guard: do not modify `docs/design/boards.md`, the s905x5m U-Boot
  section-5 gate, board configurations, or hardware state.
- A read-only SSH probe of `root@192.168.27.55` was made on 2026-08-31; it
  performed no deployment, storage write, boot-area access, or reboot. The
  running system reports `rauc.slot=B`, `/dev/dm-0` mounted as squashfs,
  `dm-mod.waitfor=` plus the verity root command line, no `initrd=`/`rd.*`
  argument, no `/run/initramfs`, and `MemTotal: 1956180 kB`. `/boot` is not
  mounted in that running root, so boot-file provenance remains the generated
  SD bridge and BSP artifacts measured below rather than a live mount listing.

## Investigation

### Boot path in use today

The hardware-proven SD path begins in the vendor U-Boot. Its `cfgload` check
requires a non-empty p1 `/Image`, then executes the rendered `boot.ini` bridge.
That p1 file is a validation copy only. The bridge loads the selected mos boot
slot's `Image` and `s7d_s905x5m_m100.dtb` with `fatload`, then executes:

```text
booti ${loadaddr_kernel} - ${dtb_mem_addr}
```

The literal `-` is an absent initrd argument. The current template uses
`loadaddr_kernel=0x03000000` and `dtb_mem_addr=0x01000000`; it is independent
of which slot the rendered bridge selects. The production mos-U-Boot export is
still blocked by the section-5 gate, so this is the path the board actually
uses today, not a projection of an unexported bootloader.

The normal arm64 rootfs path confirms that this is not hiding an initramfs:
`kernel-and-initramfs.sh` installs a Debian kernel and builds an initrd only
for `MOS_ARCH=amd64`; its arm64 branch extracts `modules.tar` only and removes
the staged initramfs inputs. The pack stage consequently writes the arm64
`.no-kernel-in-root` marker, while the U-Boot-slot verifier rejects every
`initr` filename. The read-only board probe independently found no initrd/rd
kernel argument and no `/run/initramfs`; its squashfs root is created by the
`dm-mod.create=` command line, as intended.

### Measured payload

The preserved M1 BSP artifacts on the build host were copied read-only and
matched the already-recorded SHA-256 values. `file` identifies `Image` as a
Linux ARM64 boot executable, not a compressed stream. Its first two bytes are
`4d 5a`; the pinned U-Boot compression-magic table recognises only bzip2,
gzip, lzma, lzo, lz4, and zstd prefixes, so `booti` classifies this payload as
`IH_COMP_NONE`.

| component or reservation | bytes | MiB | role |
|---|---:|---:|---|
| `Image` file | 32,135,680 (`0x1ea5a00`) | 30.646973 | current `fatload` input |
| ARM64 Image header `image_size` | 32,899,072 (`0x1f60000`) | 31.375000 | effective runtime Image span used by `booti_setup` |
| DTB file | 82,175 (`0x140ff`) | 0.078368 | current third `booti` argument |
| DTB after `fdt resize 65536` | 147,711 (`0x240ff`) | 0.140868 | bridge's mutable-DTB workspace |
| DTB after the built `CONFIG_SYS_FDT_PAD=0x3000` relocation pad | 159,999 (`0x270ff`) | 0.152587 | upper bound for the handed-off DTB workspace |

The Image header carries `text_offset=0`, `flags=0xa`, and the ARM64
position-independent bit. Therefore `booti_setup` keeps the Image at
`0x03000000` rather than creating a second relocated copy. The known kernel
runtime span plus final DTB workspace is 33,059,071 bytes (31.527587 MiB),
before normal U-Boot allocations and excluding any future FIT container. There
is no decompression peak on this path: no initramfs is passed and the kernel
Image/FIT sample both declare `compression = "none"`.

The board reports 1,956,180 KiB of Linux `MemTotal` (a 2 GiB-class target), so
the current payload is not close to physical-RAM exhaustion. That fact does
not turn a payload measurement into a claim about another board's memory map.

### What `CONFIG_SYS_BOOTM_LEN` actually controls

The pinned CoreELEC U-Boot is commit
`5f7ac2b1dc4df2f466ed88c3958a8675873f8a1a`. Its Kconfig help calls
`SYS_BOOTM_LEN` a decompressed-OS buffer limit, but the executable paths need
the more precise reading below.

| path | source behaviour | `SYS_BOOTM_LEN` effect |
|---|---|---|
| current `booti Image - dtb` | `cmd/booti.c` starts the common state machine, detects no compression, calls `booti_setup`, and supplies its own Image load handling | None for this uncompressed Image. `cmd/booti.c` has no direct `CONFIG_SYS_BOOTM_LEN` reference. If a compressed Image were used, this fork instead uses a `kernel_comp_size * 10` output bound at `kernel_comp_addr_r`; that is a separate constraint that must be measured then. |
| a future FIT | `booti` cannot parse a FIT: it expects an ARM64 Image header. `bootm` recognises `IMAGE_FORMAT_FIT`, selects the kernel through `fit_image_load`, then reaches `bootm_load_os` | `bootm_load_os` passes `CONFIG_SYS_BOOTM_LEN` to `image_decomp`. For an uncompressed component that must move, it is the maximum copied kernel-data length; for a compressed kernel, it is the maximum decompressed output. |

`booti` does invoke the common `BOOTM_STATE_START`, but that does not make the
symbol a whole-boot memory limit. `env_get_bootm_size()` defaults the LMB map to
the usable DRAM range (unless the environment overrides `bootm_size`), not to
`CONFIG_SYS_BOOTM_LEN`. Conversely, the FIT container itself, the DTB and an
optional FIT ramdisk are not summed into the `image_decomp()` buffer argument.
They still need non-overlapping RAM addresses and a separate total-RAM peak
calculation.

### FIT container measurement

There is no committed FIT ITS, key algorithm, or load-address policy yet, so a
future artifact cannot be named exactly. To establish the payload order of
magnitude, the measured Image and DTB were packed as an embedded-data FIT with
both components marked `compression = "none"`; a second run used a temporary
`sha256,rsa2048` configuration signature. No measurement key or FIT artifact
was placed in the repository.

| representation | bytes | delta from Image + DTB |
|---|---:|---:|
| Image + DTB inputs | 32,217,855 | 0 |
| unsigned FIT | 32,219,640 | 1,785 |
| signed `sha256,rsa2048` FIT | 32,219,766 | 1,911 |

The signed sample is 30.727163 MiB, leaving 33.272837 MiB in the existing
64 MiB boot slot if it replaces the separate Image and DTB and still carries
no initramfs. Its exact metadata delta is not a durable contract: FIT node
names, hashes, key type/size, signatures and FDT padding can all change it.
The result proves that the current kernel+DTB payload is the dominant term; it
does **not** prove that 1,911 bytes is a universal signature allowance.

If a FIT later adds a ramdisk, its full data component and any relocation or
decompression workspace must be measured separately. It is not present in the
current FIT sample or normal board path, and it would not justify silently
charging a historical Talos initramfs against this board.

## Proposal

The evidence supports **(c): replace the shared fixed minimum with a
per-board derived value and a documented derivation method**, after an owner
decision. No shared-contract change is made by this task.

For s905x5m, the proposed board-derived configured floor is its current
`0x4000000` (64 MiB), not the shared `0x8000000` (128 MiB). Use the larger of
the measured raw kernel file and effective ARM64 runtime Image size, then keep
one additional current-image worth of growth and round to a power-of-two MiB:

```text
payload = max(0x1ea5a00, 0x1f60000) = 0x1f60000  (31.375 MiB)
2 * payload = 0x3ec0000                         (62.75 MiB)
s905x5m floor = round_up_power_of_two_mib(...) = 0x4000000 (64 MiB)
```

That leaves `0x20a0000` = 34,209,792 bytes = 32.625 MiB of capacity beyond
the effective current Image, or 103.98% growth. Against the exact raw FIT
kernel component, the same value leaves `0x215a600` = 33.353027 MiB, or
108.83% growth. A 32 MiB floor would leave only 0.625 MiB (1.99%) beyond the
effective Image and is not defensible headroom. A 48 MiB floor would allow
16.625 MiB (52.99%) growth, but gives up the simple measured two-current-image
budget without an evidence-based need to do so.

This derives a conservative s905x5m value for the planned `bootm`/FIT route;
the current uncompressed `booti` route does not consume this configuration
limit. It also does not establish anything about cx3576 or x64. In particular,
the s905x5m result cannot justify lowering a shared 128 MiB requirement that
the owner says binds those boards too.

A future derived-contract method should require each U-Boot board to record:

1. the actual boot command and whether it is `booti` or `bootm`;
2. final-artifact raw size, effective runtime/decompressed kernel size, DTB
   workspace, and every initramfs component actually passed;
3. the pinned-source code path that applies `SYS_BOOTM_LEN`;
4. a declared growth policy and arithmetic; and
5. an independent RAM-layout calculation for FIT containers, ramdisks and
   relocation buffers that the symbol does not itself bound.

## Risks

- A compressed future kernel needs a fresh decompressed-size measurement; on
  this fork a compressed direct `booti` kernel also has the separate ten-times
  compressed-input bound.
- FIT's total transient RAM footprint depends on its load address and chosen
  component addresses. The small measured container metadata must not be
  mistaken for a complete memory-layout proof.
- An added initramfs changes the analysis materially, even though it is not
  present today and is not the `bootm_load_os()` buffer subject.
- cx3576 and x64 remain unmeasured for this decision. Their requirements may
  legitimately retain 128 MiB or need a different value.

## Scope

- Changed only this task record and its index status.
- Did not change `docs/design/boards.md`, the s905x5m Dockerfile section-5
  gate, any board configuration, a build artifact, eMMC, a boot area,
  `bootloader_a`, a deployment, or the board's power state.

## Alternatives

- **(a) Keep `0x8000000` as a shared minimum.** This remains an owner option
  if independent cx3576/x64 evidence needs it, but s905x5m evidence does not
  show that value is necessary: it would leave 96.625 MiB (307.97%) beyond the
  effective measured Image.
- **(b) Lower the shared minimum to `0x4000000`.** Do not take this path from
  this measurement alone. It would generalise one board's no-initramfs,
  uncompressed payload to boards not measured here.
- **(c) Per-board derivation (recommended).** Preserve the shared capability
  requirements while moving the numeric floor to per-board evidence and a
  reviewed derivation record. The owner can then decide the cx3576 and x64
  values independently before changing the shared contract or gates.

## Result

The s905x5m measurement is complete and recommends a 64 MiB board-derived
floor with explicit two-current-image headroom. The shared 128 MiB contract is
unchanged and awaits an owner-level cross-board decision.
