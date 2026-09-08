# RFCT-357 cx3576: does grub-arm64-efi load under U-Boot EFI_LOADER on RK3576?

- **status**: completed
- **priority**: P1
- **owner**: bkd/1bvaelii
- **createdAt**: 2026-09-08 04:10
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

**YES under QEMU, and UNPROVEN on the RK3576 itself -- but the RK3576 half is
cheaper to answer than the proposal assumed, because `CONFIG_EFI_LOADER=y` is
ALREADY in the U-Boot this board ships.** grub-arm64-efi 2.12 loaded, read its
config off a FAT partition and drew its menu under U-Boot 2026.07 (the commit
`boards/cx3576/bsp/uboot/Dockerfile` pins) on `qemu-system-aarch64 -M virt`,
with no explicit `bootefi` -- the autoboot's own `bootflow scan -lb` found it.
No board is attached to this host, so nothing here was run on RK3576 silicon.

Three findings change the shape of the migration that would follow:

1. **The U-Boot config change the proposal is built around does not exist.**
   `boards/cx3576/bsp/uboot/build-mos.sh` never mentions EFI, and it does not
   need to: `generic-rk3576_defconfig` already resolves `CONFIG_EFI_LOADER=y`,
   `CONFIG_BOOTMETH_EFILOADER=y`, `CONFIG_EFI_BOOTMGR=y` and
   `CONFIG_CMD_BOOTEFI=y`. Read out of the `build-mos` stage's own `.config`,
   in a build whose `u-boot-rockchip.bin` is byte-identical to the shipped one
   (`sha256 989f4c00…`). **The size delta of enabling EFI_LOADER is therefore
   zero: it is already paid.** Weighed from the other side -- rebuilding the
   same tree with it disabled -- what it costs is **108,544 bytes**.

2. **What hides EFI today is one word of `BOOTCOMMAND`, not a missing symbol.**
   `bootmeth order script` reduces the order to one method; measured under
   QEMU, `bootflow scan` then reports `(0 bootflows, 0 valid)` and does not
   even scan the global `efi_mgr`. So a boot slot that gains an
   `EFI/BOOT/BOOTAA64.EFI` **does not change how a shipping device boots**, and
   the bench test below is non-destructive.

3. **The ESP typecode is not what makes the slot discoverable.** Re-running the
   scan against the identical FAT under `TYPECODE_LINUX`
   (`0fc63daf-8483-4772-8e79-3d69d8477de4`) produced the same two bootflows,
   the `efi` one still naming `/EFI/BOOT/BOOTAA64.EFI`.
   `boards/cx3576/board.env`'s claim that the ESP typecode "already makes both
   boot slots bootable to U-Boot" is true but not load-bearing here; U-Boot's
   EFI bootmeth probes filesystems, not partition types.

## ActiveForm

Finding out, in QEMU and then as far as a boardless host allows, whether
grub-arm64-efi runs under this U-Boot's EFI_LOADER on RK3576

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The answer, first line, allowed to be no.
- The exact commands, re-runnable.
- The `u-boot-rockchip.bin` size delta in bytes against `UBOOT_MAX_BYTES`.
- Boot time cost, measured or explicitly declined.
- What could not be tested, line by line.
- `make docs-verify` green from a `git archive` into an empty directory.
- Nothing migrated: no GPT change, no RAUC change, `boards/cx3576/boot.cmd`
  untouched, no `CONFIG_EFI_LOADER` committed to `build-mos.sh`, no new gate.

## Notes

### Stage 1 -- QEMU, and it came up

Two containers, both throwaway, both named `ai-agent-1bvaelii-*` and removed.
Every path below is absolute because the docker daemon is the host's.

**The grub binary is the tree's own.** Not a hand-rolled one: the package set is
`build/src/toolsets.ts`'s `uefiAssembly('arm64')` verbatim, the module list is
`build/src/grub-uefi.ts`'s `GRUB_MODULES`, and the invocation is
`build/src/mkimage-uefi.ts`'s. So this spike boots the same `BOOTAA64.EFI`
virt-arm64 already ships (grub `2.12-9+deb13u2`, 6,041,600 bytes).

```sh
# assembly image: debian trixie + uefiAssembly('arm64')'s packages
docker build -t ai-agent/1bvaelii-assembly - <<'EOF'
FROM debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132
RUN dpkg --add-architecture arm64 && apt-get update && apt-get install -y \
    --no-install-recommends gdisk dosfstools mtools e2fsprogs \
    grub-efi-arm64-bin:arm64 grub-common
EOF

# early.cfg -- the memdisk config, grub-uefi.ts's earlyCfg() with BOOT-A
cat > early.cfg <<'EOF'
search --no-floppy --label BOOT-A --set root
set prefix=($root)/EFI/mos
configfile ($root)/EFI/mos/grub.cfg
EOF

# grub.cfg -- the spike's whole payload: prove grub read the FAT and can draw
cat > grub.cfg <<'EOF'
echo "MOS-SPIKE-RFCT-357: grub.cfg was read from the FAT partition"
echo "MOS-SPIKE-RFCT-357: root=${root} prefix=${prefix}"
set timeout=5
set default=0
menuentry "MOS-SPIKE-RFCT-357 grub-arm64-efi is alive" {
    echo "MOS-SPIKE-RFCT-357: menuentry executed -- normal/menu path works"
}
EOF

grub-mkstandalone --format=arm64-efi --output=BOOTAA64.EFI \
  --modules="part_gpt fat search search_label configfile linux normal echo test loadenv regexp" \
  boot/grub/grub.cfg=early.cfg

# the boot slot, at cx3576's own geometry (board.env: 64 MiB, FAT32, BOOT-A,
# volume id C3576003), so this image is also the bench artefact
truncate -s 67108864 boot-a.img
mkfs.vfat -F 32 -n BOOT-A -i C3576003 boot-a.img
mmd   -i boot-a.img ::/EFI ::/EFI/BOOT ::/EFI/mos
mcopy -i boot-a.img BOOTAA64.EFI ::/EFI/BOOT/BOOTAA64.EFI
mcopy -i boot-a.img grub.cfg      ::/EFI/mos/grub.cfg

# a whole disk for qemu: one partition, the board's ESP typecode
truncate -s 134217728 qemu-disk.img
sgdisk -a 1 -n 1:2048:+64M -t 1:C12A7328-F81F-11D2-BA4B-00A0C93EC93B \
       -c 1:boot-a qemu-disk.img
dd if=boot-a.img of=qemu-disk.img bs=1M seek=1 conv=notrunc
```

**The U-Boot.** Same commit the BSP pins, `qemu_arm64_defconfig`, built in an
`ubuntu:24.04`-based container carrying the BSP's package list plus
`qemu-system-arm mtools dosfstools`:

```sh
cd /uboot && make qemu_arm64_defconfig
scripts/config --enable EFI_LOADER --enable CMD_BOOTEFI \
               --enable CMD_BOOTEFI_HELLO --enable CMD_BOOTEFI_HELLO_COMPILE \
               --enable BOOTMETH_EFILOADER
make olddefconfig
make -j"$(nproc)" CROSS_COMPILE=aarch64-linux-gnu-      # u-boot.bin, 1,505,552 B
```

Those five `--enable`s moved **nothing**: a diff of the EFI symbol set before
and after is empty, because `qemu_arm64_defconfig` already ships
`CONFIG_EFI_LOADER=y`, `CONFIG_CMD_BOOTEFI=y` and
`CONFIG_BOOTMETH_EFILOADER=y`. Stage 1 therefore tests upstream defaults, which
is worth saying plainly: it is not evidence that a board which *needed* the
symbols would get them cleanly.

```sh
qemu-system-aarch64 -M virt -cpu cortex-a57 -m 1024 -nographic -snapshot \
  -nic none -bios u-boot-qemu-arm64.bin \
  -drive if=none,file=qemu-disk.img,format=raw,id=hd0 \
  -device virtio-blk-device,drive=hd0
```

`-nic none` is required and not cosmetic: without it `-M virt` adds a
`virtio-net-pci` and qemu exits with `failed to find romfile "efi-virtio.rom"`
before U-Boot runs at all.

**What came out, letting the autoboot run and touching no key** (timestamps are
monotonic seconds from qemu start):

```
[0000.103] U-Boot 2026.07-gece349ade297 (Jan 01 2020 - 00:00:00 +0000)
[0002.328] Hit any key to stop autoboot: 0
[0002.328] Scanning for bootflows in all bootdevs
[0002.330] Scanning global bootmeth 'efi_mgr':
[0002.506]   0  efi_mgr      ready   (none)       0  <NULL>
[0002.506] ** Booting bootflow '<NULL>' with efi_mgr
[0002.711] MOS-SPIKE-RFCT-357: grub.cfg was read from the FAT partition
[0002.712] MOS-SPIKE-RFCT-357: root=hd0,gpt1 prefix=(hd0,gpt1)/EFI/mos
[0002.717] GNU GRUB  version 2.12-9+deb13u2
[0007.743] MOS-SPIKE-RFCT-357: menuentry executed -- normal/menu path works
```

**No explicit `bootefi` was needed.** The stock `bootflow scan -lb` found it,
through the *global* `efi_mgr` bootmeth (sequence 0), before the per-partition
`efi` bootmeth was reached. Interrupting the autoboot and asking directly shows
both routes exist:

```
=> bootefi hello
Hello, world!
Running on UEFI 2.11
Firmware vendor: Das U-Boot
Firmware revision: 20260700

=> bootflow scan -l
  0  efi_mgr      ready   (none)       0  <NULL>
  1  efi          ready   virtio       1  virtio-blk#31.bootdev.par /EFI/BOOT/BOOTAA64.EFI
(2 bootflows, 2 valid)
```

### The typecode, and the bootmeth order

Two negative controls, each run the same way with one input changed.

**ESP typecode, replaced by `TYPECODE_LINUX`.** Identical result --
`(2 bootflows, 2 valid)`, entry 1 still `efi … /EFI/BOOT/BOOTAA64.EFI`. So
`BOOT_A_TYPECODE` is not what lets U-Boot find the EFI binary. It may still be
worth keeping for the reasons `board.env` gives elsewhere; it is not this
mechanism's precondition.

**`bootmeth order script`, which is what the shipped `BOOTCOMMAND` sets.**

```
=> bootmeth order script
=> bootmeth list
    0    1  script              Script boot from a block device
(1 bootmeth)
=> bootflow scan -l
(0 bootflows, 0 valid)
```

Zero. Not "found and skipped" -- the global `efi_mgr` is not scanned at all.
This is the safety property the bench procedure rests on.

### Stage 2 -- the RK3576 side, as far as a boardless host reaches

`boards/cx3576/bsp/uboot/build-mos.sh` was **not edited** (PLAN-088 owns it).
The measurement is a Dockerfile that is a byte-identical copy of
`boards/cx3576/bsp/uboot/Dockerfile` with three stages *appended*, so
`build-mos` is the shipping loader and the extra stages are that same tree
reconfigured -- one build, three artefacts, two deltas:

```sh
# stage appended after `FROM scratch AS artifact` in the copied Dockerfile:
#   FROM build-mos AS build-efi     -> scripts/config --enable CMD_BOOTEFI_HELLO
#   FROM build-mos AS build-noefi   -> scripts/config --disable EFI_LOADER \
#                                        --disable CMD_BOOTEFI \
#                                        --disable BOOTMETH_EFILOADER \
#                                        --disable BOOTMETH_EFI_BOOTMGR \
#                                        --disable EFI_BOOTMGR
# each followed by: make olddefconfig && make -j$(nproc) \
#   CROSS_COMPILE=aarch64-linux-gnu- ROCKCHIP_TPL=<ddr> BL31=<bl31>
docker buildx --builder ai-agent-1bvaelii-spike build \
  --build-context bsp-scripts=boards/cx3576/bsp/scripts \
  -f <copy>/Dockerfile --build-arg MOS_IMAGE_UBUNTU_2404=<pin> \
  --target artifact-efi -o <out> boards/cx3576/bsp/uboot
```

`u-boot-rockchip.bin`, all three from that one tree:

| build | bytes | vs shipping | vs `UBOOT_MAX_BYTES` = 16,744,448 |
|---|---:|---:|---:|
| `EFI_LOADER` disabled | 9,338,880 | -108,544 | 7,405,568 free |
| **shipping (`build-mos`)** | **9,447,424** | 0 | **7,297,024 free (43.58%)** |
| shipping + `CMD_BOOTEFI_HELLO` | 9,464,320 | +16,896 | 7,280,128 free |

`u-boot.itb` carries all of the movement (983,040 / 1,091,584 / 1,108,480); the
idbloader is unchanged.

**The shipping row is not a claim, it is the shipped bytes.** Its sha256,
`989f4c0035428ab0cc2942d11c3a6a8149104e1881ed902d3dcbb7cad2d23065`, equals the
`u-boot-rockchip.bin` already sitting in `/srv/mos/_out/boards/cx3576/uboot-mos/`.

So there is **no size finding that changes the proposal's cost**: EFI_LOADER is
already in the 9,447,424 bytes the board flashes today, 43.58% of the loader
area is free, and the only thing an EFI-based boot would add on top is the 6 MB
grub binary -- which lives in the 64 MiB boot slot, not the 16 MiB loader area.

### The bench procedure

`/srv/mos/_out/rfct-357/` holds `BOOTAA64.EFI`, `boot-a.img`, `early.cfg`,
`grub.cfg`, the five QEMU logs, both `u-boot-rockchip.bin` variants and
`SHA256SUMS`.

**No loader reflash is needed.** The device's own U-Boot already has
EFI_LOADER; only `BOOTCOMMAND`'s `bootmeth order script` hides it, and that is
runtime state an operator overrides at the prompt.

1. Put the two files into `boot-a` (partition 4). Non-destructive -- add them
   beside the existing `Image`/`dtb`/`boot.scr`, do **not** `dd boot-a.img` over
   the slot, which would erase the kernel and leave the device unbootable until
   reflashed. From a running device:

   ```sh
   mount /dev/mmcblk0p4 /mnt && mkdir -p /mnt/EFI/BOOT /mnt/EFI/mos
   cp BOOTAA64.EFI /mnt/EFI/BOOT/ && cp grub.cfg /mnt/EFI/mos/ && umount /mnt
   ```

   `boot-a.img` is the alternative for a bench board with nothing to lose: it is
   a complete 64 MiB slot at the board's own FAT parameters.

2. Reboot, interrupt the autoboot, and at the U-Boot prompt:

   ```
   => ls mmc 0:4 /EFI/BOOT              # expect: 6041600  BOOTAA64.EFI
   => bootmeth order efi                # undo BOOTCOMMAND's `order script`
   => bootflow scan -l
   ```

   **This is the answer.** A line reading
   `efi  ready  mmc  4  …  /EFI/BOOT/BOOTAA64.EFI` means the bootmeth found it.
   `(0 bootflows, 0 valid)` means it did not, and is the interesting failure.

3. Then hand over, either route:

   ```
   => bootflow scan -lb
   ```
   or, if the scan finds nothing, explicitly -- which separates "the bootmeth
   cannot see it" from "EFI cannot run it":
   ```
   => load mmc 0:4 ${kernel_addr_r} EFI/BOOT/BOOTAA64.EFI
   => bootefi ${kernel_addr_r}
   ```

   **Yes** is `MOS-SPIKE-RFCT-357: grub.cfg was read from the FAT partition`
   followed by the GRUB menu. Anything else -- a hang, a synchronous abort, an
   `## Application terminated, r = …` -- is a no, and the line before it is the
   finding.

4. Optional, and only if step 3 fails: flash
   `u-boot-rockchip.bin.efi-hello` (`sha256 6b85eed7…`) to the loader area and
   run `bootefi hello`. It differs from the shipping loader by
   `CONFIG_CMD_BOOTEFI_HELLO=y` and nothing else, and it separates "EFI_LOADER
   is broken on this SoC" from "grub is the thing that will not run". The
   shipping loader has no `hello` payload, so this test needs that binary.

### Boot time

**Measured only under QEMU, and the number is the harness's, not the board's.**
qemu TCG emulating aarch64 on an amd64 host is not a timing model of an RK3576;
what the numbers bound is the *shape* of the cost, not its size.

- autoboot fires to grub's first `echo`: **0.383 s**
- U-Boot's handover (`** Booting … with efi_mgr`) to grub's first `echo`:
  **0.205 s**, which includes reading the 6,041,600-byte binary off virtio FAT.

**On the RK3576 this was not measured at all**, and the one term that will
dominate is the one QEMU does not have: a 6 MB eMMC read, where the present
`boot.scr` path reads a few hundred bytes. Whoever runs the bench should time
`load mmc 0:4 …` -- U-Boot prints the byte count and the elapsed time -- because
that single number is the real boot-time cost of this migration and nothing on
this host can produce it.

### What could not be tested, line by line

- **Everything on RK3576 silicon.** No board is attached to this host. The
  RK3576 half of the question is unproven by construction, and a green QEMU run
  is not an answer to it.
- **The rkbin TPL/BL31 boot chain with an EFI hand-off.** QEMU's U-Boot runs
  from `-bios` with no SPL, no vendor DDR init and no BL31; the board's does.
- **eMMC.** Stage 1 used virtio-blk. `mmc 0:4`, the eMMC bootdev's name, and
  whether the EFI bootmeth enumerates it are untested.
- **The real boot slot.** The FAT was built empty apart from the two spike
  files. A slot also holding `Image`, the dtb, `boot.scr` and
  `mos-verity-a.env` was never scanned.
- **Boot time on hardware.** See above; only the QEMU figure exists.
- **`bootmeth order efi` on the shipping loader.** Step 2's command was verified
  on QEMU's U-Boot, not on a cx3576 -- only its inverse (`order script` hiding
  EFI) was, and that too on QEMU.
- **Which slot grub would pick.** `early.cfg` searches `--label BOOT-A`, so a
  grub loaded out of `boot-b` would set `$root` to the *other* slot. cx3576 has
  no separate ESP to break the symmetry, which is the layout problem the
  migration owns and this spike deliberately did not touch.
- **`u-boot-rockchip.bin.efi-hello` has never been flashed**, here or anywhere.
  It compiles and its size is measured; that is all that is claimed.

### Files touched

`docs/task/RFCT-357.md` and nothing else. The builds, the QEMU images and the
three `u-boot-rockchip.bin` variants were written to the gitignored `_out/`, and
the bench artefacts copied to `/srv/mos/_out/rfct-357/`. No
`CONFIG_EFI_LOADER` was committed -- and, per the first finding, none needs to
be.
