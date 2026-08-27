# RFCT-106 x64 A/B: the update has to land where the firmware actually looks

- **status**: completed
- **priority**: P0
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-25 07:05
- **claimedAt**: 2026-08-25 07:05
- **completedAt**: 2026-08-25 11:02

`rauc install` on the x64 image cannot succeed. Not "has a bug" — cannot
succeed, by construction, and it was found by trying to run the A/B test the
campaign asks for rather than by reading the code.

## What was measured, on a booted device

```
boot.mount:  What=/dev/disk/by-partuuid/…0003  Where=/boot   (BOOT-A, statically)
/boot:       vmlinuz-a  initrd-a  vmlinuz-b  initrd-b  EFI/mos/{grub.cfg,grubenv}
grub.cfg:    linux /vmlinuz-a … verity … <root hash of ROOTFS-A>
             linux /vmlinuz-b … verity … <root hash of ROOTFS-B>
grubenv:     ORDER="A B"  A_OK=1  A_TRY=0  B_OK=0
system.conf: [slot.boot.1] device=…0004 type=vfat parent=rootfs.1
```

Both slots' kernels and BOTH slots' dm-verity root hashes live on **one**
filesystem, BOOT-A, and `os/mkimage-x64.sh`'s embedded GRUB config makes that
authoritative on purpose: `search --no-floppy --label BOOT-A --set root` runs
before the BOOT-B fallback, so whichever ESP the firmware loads the EFI binary
from, GRUB reads BOOT-A's `grub.cfg` and BOOT-A's `grubenv`.

RAUC installs the boot payload into the **inactive** boot slot — BOOT-B. That
partition is never mounted and never read.

So an update to slot B writes the new rootfs to ROOTFS-B, writes the new kernel
and the new `grub.cfg` (carrying B's new root hash) to a partition nothing
reads, sets `ORDER=B` in the grubenv that IS read, and reboots. GRUB then boots
`/vmlinuz-b` from BOOT-A — the factory kernel — with BOOT-A's `grub.cfg`, whose
B entry still names the **old** root hash. dm-verity refuses the new rootfs, the
boot fails, and the slot rolls back.

The update fails safe. It never succeeds.

## Why this is a UEFI-shaped problem and not a mistake repeated from cx3576

cx3576 is correct. U-Boot reads `BOOT_ORDER` from its own environment and
**loads `boot.scr` from the boot partition it selected**, so a per-slot boot
partition is genuinely per-slot: the bootloader picks the partition.

UEFI firmware does not. It picks an ESP from NVRAM boot entries, or by the
removable-media path `\EFI\BOOT\BOOTX64.EFI` on whichever ESP-typed partition
it enumerates first. Nothing on the device gets to say "boot the other ESP this
time" without writing firmware NVRAM. An A/B pair whose selection depends on
firmware state outside the artifact is not an A/B pair.

## Decision

**The ESP stops being part of the A/B set. There is exactly one of it, and the
per-slot boot payload becomes FILES on it, installed by RAUC as `file` slots
parented to their rootfs slot.**

```
ESP (single, mounted at /boot):
  EFI/BOOT/BOOTX64.EFI    static, flash time only
  EFI/mos/grub.cfg        static, flash time only — carries NO root hash
  EFI/mos/grubenv         RAUC's boot state (ORDER, <slot>_OK, <slot>_TRY)
  EFI/mos/cmdline-a.cfg   per slot: `set CMDLINE_A="…verity…<root hash A>"`
  EFI/mos/cmdline-b.cfg   per slot
  vmlinuz-a  initrd-a  vmlinuz-b  initrd-b
```

`grub.cfg` sources the two cmdline fragments and refers to `${CMDLINE_A}` /
`${CMDLINE_B}`. RAUC's slot model becomes:

```
[slot.rootfs.0]  device=…ROOTFS_A…  type=raw   bootname=A
[slot.kernel.0]  device=/boot/vmlinuz-a           type=file  parent=rootfs.0
[slot.initrd.0]  device=/boot/initrd-a            type=file  parent=rootfs.0
[slot.cmdline.0] device=/boot/EFI/mos/cmdline-a.cfg type=file parent=rootfs.0
```

and the same with `-b` for `rootfs.1`. Installing the inactive group writes only
that slot's three files; the running slot's kernel, initrd and cmdline are not
touched, and a power loss mid-write leaves `ORDER` unchanged, so the next boot
is the slot that was already good.

### CORRECTION: RAUC has no `file` slot type

The design above was implemented and then measured against the tool. It does
not work, and the reason is worth recording because the whole first draft
turned on it:

```
$ rauc --conf=…/system.conf status
Failed to load system config: Unsupported slot type 'file' for slot kernel.0
```

Both versions this project touches say it: 1.8 in the bookworm bundle-build
container, and **1.13**, the one Debian 13 ships and the device actually runs.
RAUC installs SLOTS, and a slot is a block device — raw, ext4, vfat, ubifs and
the boot-partition switchers. There is no "write this file into that mounted
filesystem". The mechanism was assumed from memory and never checked, which is
exactly the failure mode this campaign keeps finding in other people's code.

### The design that survives the measurement

The problem it has to solve is unchanged: **the per-slot boot payload must land
where the bootloader reads.** What changes is where that is.

GRUB can read ANY partition. It is only the FIRMWARE that cannot choose. So the
firmware's boot filesystem and the per-slot payload stop being the same thing:

```
ESP      (gpt1, static)     EFI/BOOT/BOOTX64.EFI, EFI/mos/grub.cfg, grubenv
BOOT-A   (gpt2, vfat slot)  vmlinuz, initrd.img, cmdline.cfg   parent=rootfs.0
BOOT-B   (gpt3, vfat slot)  vmlinuz, initrd.img, cmdline.cfg   parent=rootfs.1
ROOTFS-A (gpt4, raw slot)   bootname=A
ROOTFS-B (gpt5, raw slot)   bootname=B
```

The firmware always boots the ESP. GRUB reads grubenv there, picks a slot, and
then points `$root` at THAT SLOT's boot partition — derived from the ESP's own
device, so it cannot name the wrong disk — and reads the slot's kernel, initrd
and command line from it.

RAUC installs the inactive group: the rootfs partition and, as an ordinary
`vfat` slot, that slot's whole boot filesystem. Both are supported slot types.
The ESP is in no slot group at all, so an install cannot rewrite the file the
firmware boots or the grubenv that records which slot is good.

This is the same shape cx3576 has always had. The difference between the boards
shrinks to one line: U-Boot selects the boot partition itself, and on UEFI the
first-stage GRUB does it instead.

### Why the root hash cannot live anywhere else

It cannot live inside the rootfs: the hash is computed over the squashfs, so
storing it in the squashfs is circular. It cannot stay in `grub.cfg` without
making `grub.cfg` a per-install artifact, which is what put it on the wrong
partition in the first place. A small per-slot file on the ESP is the only
remaining place — which is exactly what cx3576 already does with
`rootfs-verity-a.env` / `-b.env`. The two boards end up with the same shape for
the same reason, reached from opposite directions.

### The second ESP is removed; the boot PARTITIONS stay

A second ESP that RAUC no longer writes is not redundancy. After one update its
`grub.cfg` names root hashes that no slot on the device has any more, so if it
were ever booted — the label search falls back to it when BOOT-A's label is
gone — it would fail verity on both slots. A stale copy that looks like a
fallback is worse than no fallback, because it is only consulted in the
situation where being wrong is least recoverable. The x64 layout drops the
partition and the embedded GRUB config searches for one label.

Redundancy for the boot filesystem is bought instead by how rarely and how
narrowly it is written: after flashing, the only writes are `grubenv` (a fixed
1024-byte in-place rewrite, which is what that format exists for) and three
files per update, none of them the EFI binary or `grub.cfg`.

### Considered and rejected

- **`bootloader=efi` (efibootmgr, one EFI boot entry per slot).** The standard
  UEFI answer, and the one that would keep two self-contained ESPs. Rejected
  because the property "the device boots the slot RAUC selected" then lives in
  firmware NVRAM: outside the signed artifact, cleared by a battery or a
  firmware reset, and unreliable on exactly the low-cost industrial x86 boards
  this targets. With grubenv the same property lives in a file on a disk mos
  controls, and losing it falls back to a static default in `grub.cfg`.
- **`boot-gpt-switch`** (write the inactive partition, then flip partition type
  GUIDs so only one is ESP-typed). A real technique, and it keeps two ESPs.
  Rejected because it rewrites the partition table on every update and some
  firmware caches boot entries by partition GUID — a much larger blast radius
  than three files.
- **Mirroring both ESPs on every install.** Either doubles the boot payload in
  every bundle (a second image class per file) or needs a post-install hook —
  a property maintained by a protocol, which is what this whole task is about
  removing.

## Found on the way, and not caused by this task

Three defects surfaced only because an A/B install was actually performed and
the machine watched afterwards. None would have been visible from the code.

**GRUB never read ORDER.** `os/boot/x64-grub.cfg` computed only whether slot A
should be SKIPPED and otherwise set `default=A`, so `ORDER="B A"` -- the one
thing RAUC writes to say "boot the slot I just installed" -- changed nothing.
The bundle installed cleanly, RAUC set the order, every status command agreed,
and the machine rebooted into the old slot. Fixed: the first candidate in
ORDER becomes default and the second becomes GRUB's fallback.

**A 32 MiB ESP is not FAT32, and nothing said so.** The FAT specification
defines the type by cluster count: under 65525 clusters it is FAT16 whatever
the boot sector claims. `mkfs.vfat -F 32` writes a FAT32 boot sector anyway and
reports success; `minfo` reads the type out of that boot sector and agrees.
OVMF computes it the way the spec does, finds the contradiction, and leaves the
partition out of its device list entirely -- the machine dropped to the UEFI
shell with nothing said about why. Measured floor: 33 MiB. The ESP is 64 MiB,
and the assembler now asserts the CLUSTER COUNT, because the first version of
that assertion asked for the reported type and passed on the very image that
would not boot.

**/var is seeded at runtime, concurrently with the units that write /var.**
`mos-seed-var` ran `cp -a` from the factory copy and lost a race with
`systemd-networkd-persistent-storage.service`, new in the systemd Debian 13
ships, which creates `/var/lib/systemd/network` the moment /var appears:

```
cp: cannot create directory '/var/./lib/systemd/network': File exists
```

`set -e` then ended the script, the unit failed, and everything requiring
var-lib-mos.mount -- mosd, apid, the health gate -- failed with it. A first
boot that looks, from outside, like a device that will not come up. It is a
race, so it failed on some boots and not others: the same image booted cleanly
once and then failed twice.

Making the seed MERGE (tar --skip-old-files) stopped it failing, and moved the
loss to the other side: the systemd unit then ran mid-extraction, opened a
directory tar had created but not yet chowned, and failed with EACCES as
User=systemd-network. Ordering it after the seed is in place as a **stopgap**,
labelled as one in the unit.

**The structural repair is DONE.** EPHEMERAL is populated at image assembly
with `mkfs.ext4 -d` / `mke2fs -d`, from the same factory tree the rootfs build
now exports (390 KB, 93 entries — it costs nothing to carry). The stamp
`/var/.mos-var-seeded` is written in at the same time, so `mos-seed-var`'s
`ConditionPathExists=!` makes it a no-op on a normal boot. It stays for the one
path that still needs it: EPHEMERAL wiped, which is not a boot anything else is
racing. The `Before=` line stays as the belt to that brace.

Verified on an assembled x64 image, before it had ever booted: the EPHEMERAL
partition already holds `lib backups cache local lock log mail opt run spool`
and `.mos-var-seeded` at inode 12. os/verify-image-v2.sh asserts the stamp and
a populated `/lib` — the stamp specifically, because a seeded tree WITHOUT it
would still run the seed and still race.

## The assertion that would have caught this

The install test asserts, between `rauc install` and the reboot, that the
**mounted** ESP's `vmlinuz-b`, `initrd-b` and `cmdline-b.cfg` changed. Today
that assertion fails while `rauc install` reports success, which is the exact
shape of every defect this campaign has turned up: the check that passes and
the thing that works are different claims.
