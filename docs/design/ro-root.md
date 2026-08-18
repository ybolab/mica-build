# Read-only root: squashfs + dm-verity on cx3576

Decision record for PLAN-010 M4 / RFCT-013. Covers how the root filesystem is
packed, how the kernel assembles it without an initramfs, and where every
runtime write goes once `/` is immutable.

Companion documents: `docs/plan/PLAN-006.md` Parts C, D and J (the A/B update
design this implements), `os/layout/cx3576-v2.env` (every layout constant),
`os/rootfs/README.md` (how to build it).

## 1. What the rootfs image is

`os/rootfs/build-v2.sh` produces a single raw file, `_out/cx3576/rootfs-verity.img`:

```
+---------------------------+ 0
| squashfs (zstd -19)       |  SQUASHFS_BYTES, a multiple of 4096
+---------------------------+ SQUASHFS_BYTES == hash offset
| dm-verity hash tree       |  superblock + 107 hash blocks
+---------------------------+
| zero padding              |  up to the next whole MiB
+---------------------------+ IMAGE_BYTES
```

The hash tree lives in the same file as the data it covers, at
`--hash-offset=SQUASHFS_BYTES`. One file means one artifact to sign, one raw
`dd` into a slot, and one RAUC image per slot. The trailing pad exists because
`os/mkimage-v2.sh` writes the file into the slot at a MiB boundary.

The parameters needed to reconstruct the verity target are written next to it in
`_out/cx3576/rootfs-verity.env`, as strict `KEY=value` lines: `VERITY_ROOT_HASH`,
`VERITY_SALT`, `VERITY_UUID`, `VERITY_HASH_ALGO`, `VERITY_DATA_BLOCK_SIZE`,
`VERITY_HASH_BLOCK_SIZE`, `VERITY_DATA_BLOCKS`, `VERITY_HASH_START_BLOCK`,
`VERITY_DATA_SECTORS`, `SQUASHFS_BYTES`, `IMAGE_BYTES`.

### Determinism

The root hash is the identity of a release, so the pack must be a pure function
of its content. Every source of variation is pinned:

| Source | Pin |
|---|---|
| mksquashfs thread count | `-processors 1` — multi-threaded packing is not byte-reproducible |
| superblock and inode timestamps | `-mkfs-time` and `-all-time` set to `FILE_MTIME` (2020-01-01T00:00:00Z) |
| build-container uid/gid map | `-all-root` |
| leftover state from a previous run | `-noappend` |
| NFS export table | `-no-exports` (unused, and it embeds inode ordering) |
| verity salt | `--salt=$VERITY_SALT` from the layout env; the default is random |
| verity superblock UUID | `--uuid=$VERITY_UUID`; the default is random, and it lands in the first hash block |

The verity UUID is not a separate magic constant: `build-v2.sh` derives it from
`ROOTFS_A_GUID` (lowercased). Both slots hold identical content, so one value
for A and B is correct.

sshd host keys are deliberately **not** baked into the image. The openssh-server
postinst generates a set at build time; keeping them would put the same private
host key on every device that ever flashes this release, and would also make the
root hash differ on every cold build. They are generated per device on first
boot instead (§4, "Seeding STATE").

Remaining deviation: the byte layout still depends on the `squashfs-tools` and
`cryptsetup` versions in the pack stage, both of which come from
`debian:bookworm-slim` at build time. Pinning the base image digest is the
follow-up that would close this; it is the same class of deviation
`os/mkimage-v2.sh` already documents for mtools.

Verified: two cache-hot `make os-rootfs-cx3576-v2` runs produce a byte-identical
`rootfs-verity.img` and the same `VERITY_ROOT_HASH`.

## 2. Decision: cmdline-only `dm-mod.create=`, no initramfs

**Chosen: (A) `dm-mod.create=` on the kernel cmdline. M4 ships no initramfs.**

The alternative, (B) a micro-initramfs that runs `veritysetup open` and
`switch_root`, is not needed on this kernel. The evidence, read out of the
vendor tree (`armbian/linux-rockchip`, branch `rk-6.1-rkr5.1`, 6.1.115) and out
of the built `Image`:

1. **`CONFIG_DM_INIT=y` is asserted at kernel build time.**
   `board/common/mos-required.fragment` already pins `CONFIG_BLK_DEV_DM=y`,
   `CONFIG_DM_INIT=y`, `CONFIG_DM_VERITY=y`, `CONFIG_SQUASHFS=y`,
   `CONFIG_SQUASHFS_ZSTD=y`. `drivers/md/dm-init.c` appears in the built Image's
   string table.

2. **`verity` is an allowed early target.** `dm_allowed_targets[]` in
   `drivers/md/dm-init.c` is `crypt, delay, linear, snapshot-origin, striped,
   verity`. Nothing has to be relaxed.

3. **`PARTUUID=` resolves.** `dm-init` passes each table device path to
   `dm_get_dev_t()` (`drivers/md/dm-table.c`):

   ```c
   dev_t dm_get_dev_t(const char *path)
   {
           dev_t dev;
           if (lookup_bdev(path, &dev))
                   dev = name_to_dev_t(path);
           return dev;
   }
   ```

   `lookup_bdev("PARTUUID=...")` fails, so the `name_to_dev_t()` fallback runs,
   and that function dispatches `PARTUUID=` to `devt_from_partuuid()`
   (`init/do_mounts.c`). Matching is done by `match_dev_by_uuid()` with
   `strncasecmp`, so the case of the GUID does not matter. This is what lets the
   cmdline name a slot by its frozen partition GUID instead of by a
   `/dev/mmcblk0pN` number that a layout change could invalidate.

4. **`dm-mod.waitfor=` exists on 6.1.115.** `dm-init.c` declares
   `static char *waitfor[DM_MAX_WAITFOR]` with
   `module_param_array(waitfor, charp, NULL, 0)`, and `dm_init_init()` spins on
   `dm_get_dev_t()` for each entry before building any table.

Because (A) holds, the fallback described in PLAN-006 Part D ("a micro-initramfs
is kept as a fallback profile for kernels/boards where `dm-mod.create=` is
unavailable") is not built for cx3576. If on-hardware bring-up disproves this,
the shape of (B) would be: a ~5 MB cpio with busybox, `veritysetup` and the
cryptsetup libraries; an `init` that reads the root hash from the cmdline, runs
`veritysetup open --hash-offset` against the slot partition, mounts
`/dev/mapper/rootfs` and `switch_root`s. It costs a second signed artifact per
boot slot and permanent RAM for the cpio, which is exactly what PLAN-006 Part D
set out to avoid. The cmdline generated here stays valid either way, so the
decision is re-testable on hardware without a rebuild.

RFCT-018 is analysing the same question in parallel. The findings above are
read directly from the vendor tree; if RFCT-018 reports differently, the
disagreement must be resolved before hardware bring-up rather than silently
picking one.

### The generated cmdline

`build-v2.sh` writes one line per slot into `boot-cmdline-a.txt` /
`boot-cmdline-b.txt`, which `os/mkimage-v2.sh` drops verbatim into that slot's
`extlinux.conf` `append`:

```
dm-mod.create="rootfs,,,ro,0 <DATA_SECTORS> verity 1 PARTUUID=<slot> PARTUUID=<slot> 4096 4096 <DATA_BLOCKS> <HASH_START_BLOCK> sha256 <ROOT_HASH> <SALT>"
dm-mod.waitfor=PARTUUID=<slot>
root=/dev/dm-0 rootfstype=squashfs ro rootwait
console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 storagemedia=emmc net.ifnames=0
```

(one line in the file; wrapped here for reading). Notes:

- The same PARTUUID appears twice because the data device and the hash device
  are the same partition; `<HASH_START_BLOCK>` is where the tree begins.
- `dm-mod.waitfor=` is set even though `dm_init_init()` already calls
  `wait_for_device_probe()`. The eMMC host probes asynchronously and `dm-init`
  is only a `late_initcall`; without it, a slow probe produces no `/dev/dm-0`
  and the failure then surfaces as an unexplained `rootwait` hang instead of a
  logged wait. This is an addition to the cmdline template in the task spec and
  is called out as such.
- The value of `dm-mod.create=` contains spaces and is therefore quoted. The
  kernel's `next_arg()` (`lib/cmdline.c`) handles a double-quoted value, and
  U-Boot's extlinux parser passes everything after `append ` through verbatim.
- The console/earlycon/storagemedia/net.ifnames arguments are carried over from
  the v1 `APPEND` in `os/mkimage.sh`. v1's `root=PARTLABEL=rootfs rw` is
  replaced by `root=/dev/dm-0 ... ro`.
- `rootwait` is kept. Note that if `dm-init` fails, `/dev/dm-0` never appears
  and `rootwait` waits forever; recovery from that state is U-Boot's job
  (`BOOT_x_LEFT` attempt counters plus a watchdog reset), not the kernel's.

## 3. squashfs xattrs

`CONFIG_SQUASHFS_XATTR` has been approved by L1 and applied to
`board/common/mos-required.fragment` on master, with the kernel artifact
rebuild running on the L1 side. Squashfs xattr support is therefore assumed
present and no workaround for dropped file capabilities is implemented.

The pack stage records the actual privilege inventory in
`rootfs-report-v2.txt` rather than assuming it, so a regression is visible:

- **File capabilities: none.** `getcap -r` over the packed tree returns an
  empty set. The v2 package allowlist contains no capability-carrying binary
  (notably `iputils-ping`, the usual one, is not installed), so whether xattrs
  survive the buildkit layer export is currently moot for this image. It stops
  being moot the moment a package with capabilities is added — the report
  section is the tripwire.
- **`-all-root` and setgid binaries.** `-all-root` rewrites ownership but not
  mode bits, so a setgid binary whose group was not root becomes setgid-root.
  In this image that affects `usr/bin/ssh-agent` (was `_ssh`),
  `usr/bin/chage`, `usr/bin/expiry`, `usr/sbin/unix_chkpwd` (were `shadow`) and
  `usr/lib/dbus-1.0/dbus-daemon-launch-helper` (setuid root, group `messagebus`,
  and `-all-root` makes it group-root and world-executable in effect). None of
  these are reachable by an unprivileged user on an appliance image with no
  interactive non-root accounts, but the effect is real and is a follow-up worth
  taking: either drop the setgid bits in the rootfs stage or replace
  `-all-root` with a pinned `-force-uid 0 -force-gid 0`. `-all-root` is
  mandated by the M4 spec, so it is not changed here.

## 4. Where writes go

`/` is a verity-protected squashfs and can never be written. The layout v2 data
partitions absorb everything:

| Path | Backing | Options |
|---|---|---|
| `/` | rootfs-a / rootfs-b (`/dev/dm-0`) | squashfs, `ro` |
| `/var` | EPHEMERAL (p9) | ext4, `noatime,x-systemd.growfs` |
| `/mnt/state` | STATE (p8) | ext4, `noatime` |
| `/mnt/meta` | META (p7) | ext4, `noatime` |
| `/tmp` | tmpfs | `noatime,nosuid,nodev,mode=1777` |
| `/var/lib/mos` | bind from `/mnt/state/mos` | |
| `/etc/ssh` | bind from `/mnt/state/ssh` | |
| `/run`, `/run/lock`, `/dev/shm` | tmpfs | systemd API mounts, unchanged |

The three block mounts are `/etc/fstab` entries rather than hand-written
`.mount` units, so that `x-systemd.growfs` works through the fstab generator
and mountpoint ordering is derived automatically. They are keyed on
`PARTUUID=` taken from `os/layout/cx3576-v2.env`, **lowercased**: udev builds
`/dev/disk/by-partuuid/` symlinks from libblkid, which formats GUIDs in
lowercase, and systemd's fstab generator resolves `PARTUUID=` through those
symlinks without normalising case. (The kernel cmdline is case-insensitive, but
lowercase is used there too for consistency.)

`fstrim.timer` is enabled — the writable filesystems are on eMMC and nothing
else issues discards.

`Storage=volatile` for journald is carried over from v1. `/var` is writable
under v2, so a persistent journal is now possible; enabling it is a separate
decision about flash wear and retention and is left to a follow-up.

### First-boot growth moved to EPHEMERAL

v1 grew the root partition with `/etc/repart.d/50-rootfs.conf`. Under v2 the
root is a fixed-size verity image inside a frozen A/B slot and must never be
resized, so that definition is gone from the v2 rootfs and EPHEMERAL grows
instead. Filesystem growth is still `x-systemd.growfs` on the `/var` fstab
entry; repart only moves the partition boundary and relocates the backup GPT,
which is why the assembled image reserves only a 1 MiB tail.

There is a trap here worth recording. systemd-repart pairs definition files
with existing partitions **by partition type UUID, in order**: the Nth
definition of a type matches the Nth on-disk partition of that type
(`man 5 repart.d`). Seven of the nine v2 partitions carry the `linux-generic`
type — uenv-a, uenv-b, rootfs-a, rootfs-b, meta, state, ephemeral — so a lone
"grow the last one" file would have silently attached itself to **uenv-a**.
`/etc/repart.d/` therefore holds all seven definitions in disk order
(`10-uenv-a` … `70-ephemeral`); the first six carry `Weight=0`/`PaddingWeight=0`
and no size, exist only to hold their position, and are inert because repart
never shrinks, moves or deletes an existing partition. No size is pinned on the
rootfs slots because their size is resolved by the image assembler, long after
these files are baked into the squashfs. The two ESP-typed boot partitions have
no definitions and are left alone as unmatched existing partitions.

One more thing had to be checked: systemd-repart with no node argument operates
on the block device backing `/`, which here is `/dev/dm-0`. `acquire_root_devno()`
in systemd's `src/partition/repart.c` calls `block_get_originating()` — commented
"From dm-crypt to backing partition", and its debug message names dm-verity
explicitly — before `block_get_whole_disk()`. So repart walks
`dm-0 → mmcblk0p5 → mmcblk0` correctly and does not need `--dry-run=no <node>`
to be spelled out. (Checked against systemd v252, the version in bookworm.)

### Seeding EPHEMERAL

EPHEMERAL is created as an empty ext4 filesystem by the assembler, and mounting
it at `/var` would hide the `/var` tree the installed packages expect (the dpkg
database, `/var/lib/dbus`, spool directories, the `/var/lib/mos` mountpoint).
The pack stage therefore moves the built tree to `/usr/share/factory/var` and
leaves `/var` as an empty mountpoint; `mos-seed-var.service` copies it out once,
on the first boot after a flash or after EPHEMERAL is wiped, gated on
`/var/.mos-var-seeded`. The factory copy is 9 MB and is a move, not a
duplication, so it costs nothing in the squashfs.

Ordering: `DefaultDependencies=no`, `RequiresMountsFor=/var` (which implies
`After=var.mount`), `Before=local-fs.target systemd-tmpfiles-setup.service`, and
`WantedBy=local-fs.target`. It runs inside the local mount phase, after `/var`
is mounted and before anything that assumes a populated `/var` — including
systemd's own tmpfiles rules, which then apply on top of the seeded tree instead
of racing it.

### Seeding STATE

`mos-seed-state.service` runs under the same rules against `/mnt/state`,
creating `/mnt/state/mos` and `/mnt/state/ssh` — the sources of the two bind
mounts, which must exist before those mounts are attempted, so a tmpfiles rule
(which runs long after `local-fs.target`) would be too late.

It also seeds `/mnt/state/ssh` from `/etc/ssh` while that path still shows the
read-only image copy, and then generates the RSA / ECDSA / Ed25519 host keys
into it if they are absent. `etc-ssh.mount` binds `/mnt/state/ssh` over
`/etc/ssh` afterwards and is ordered `Before=ssh.service`, so sshd sees a
writable directory with per-device keys that survive every A/B update. Binding
over a mountpoint does not write to the underlying read-only filesystem.

**Known consequence:** because the whole of `/etc/ssh` is bound, not just the
key files, changes an update makes to `sshd_config` (or to `sshd_config.d/`)
never reach a device that has already been seeded. This is the shape the M4
spec calls for. Two follow-ups would fix it: bind only `ssh_host_*` files, or
have a RAUC post-install hook refresh the non-key files from
`/usr/share/factory/etc/ssh`.

## 5. `/etc/machine-id` — solved through the U-Boot environment

Not a limitation, and deliberately **not** solved with an `/etc` overlay or an
initramfs.

The mechanism:

1. The device's machine-id is persisted in the U-Boot environment variable
   `machine_id`, in the redundant uenv-a/uenv-b pair (partitions 1 and 2, at
   fixed byte offsets that never move).
2. The custom U-Boot appends `systemd.machine_id=<uuid>` to the kernel bootargs
   whenever that variable is set. systemd consumes `systemd.machine_id=` as a
   first-class cmdline option, which is what fixes the id on a read-only `/etc`
   with no initramfs.
3. On first boot, a Linux oneshot gated on
   `ConditionKernelCommandLine=!systemd.machine_id` generates a UUID and
   persists it with `fw_setenv machine_id <uuid>`. It takes effect from the
   **next** boot onward, not the one that generated it.

**The UUID format is mandatory: 32 lowercase hex characters with NO dashes.**
That is the only form systemd accepts for `systemd.machine_id=` and for
`/etc/machine-id`; a dashed UUID is rejected.

**Caveat — inert until the custom U-Boot lands.** Step 2 is RFCT-018's work. Until
that U-Boot ships, nothing puts `systemd.machine_id=` on the cmdline, so systemd
finds an empty `/etc/machine-id` on a read-only filesystem, falls back to a
transient id in `/run` and bind-mounts it over `/etc/machine-id`. The machine-id
is therefore **per-boot transient** in the interim: the system boots and works,
but the id changes on every reboot. `/etc/machine-id` must exist as an empty
file for that fallback to work, and the pack stage creates it.

**Constraint — one writer at a time.** RAUC's U-Boot backend and this oneshot
both write the same redundant environment pair through libubootenv, which
provides no cross-process locking. Concurrent writes can corrupt both copies.
The oneshot runs once, early, and RAUC only writes during an install or a
`mark-good`, so they do not overlap in practice — but any future env writer must
respect this.

`/etc/fw_env.config` is shipped by this task pointing both entries at the uenv
partitions by GUID (`/dev/disk/by-partuuid/…`, offset 0, size 64 KiB) rather
than at a hardcoded `/dev/mmcblk0` offset: the GUIDs are layout constants, the
disk name is not. It is provisional — RFCT-014 owns `os/rauc/fw_env.config(.in)`
and may replace it.

The oneshot itself is **RFCT-015's** deliverable and the U-Boot side is
**RFCT-018's**; neither is implemented here.

## 6. Runtime writers to `/etc` — audit

Every `/etc` write path in the v1 rootfs, and what happens to it under v2:

| Writer | Status |
|---|---|
| sshd host key generation | **Redirected.** Keys are not baked; `mos-seed-state` generates them into `/mnt/state/ssh`, bound over `/etc/ssh`. |
| `/etc/resolv.conf` | **Already fine.** v1 makes it a symlink to `../run/systemd/resolve/stub-resolv.conf`; the target is on tmpfs and stays writable. Carried into v2 unchanged. |
| networkd unit rendering by mosd | **No writer exists.** mosd and webd write only `/var/lib/mos/settings.toml` and `/var/lib/mos/webd` (`mosd-settings/src/store.rs`, `webd/src/config.rs`); both land on STATE through `var-lib-mos.mount`. The static `/etc/systemd/network/80-dhcp.network` is baked at build time. If a later milestone adds runtime network rendering it must target `/run/systemd/network`, which networkd reads at higher precedence than `/etc`. |
| hostname persistence | **Known breakage.** `/etc/hostname` is baked as `mos` and `hostnamectl set-hostname` fails with EROFS. Nothing in mos sets it today. The fix, when it is needed, is `/etc/hostname` as a symlink into `/mnt/state` plus a `systemd-hostnamed` drop-in, or a `hostname` variable in the same U-Boot env used for machine-id — deliberately not built speculatively. |
| `/etc/machine-id` | **Solved via the U-Boot env** (§5), transient until RFCT-018's U-Boot ships. |
| `/etc/adjtime` (hwclock) | Not written: no RTC sync unit is enabled. |
| `/etc/mtab` | Symlink to `/proc/self/mounts` in Debian; never written. |
| `/etc/.updated`, `/etc/.pwd.lock` | systemd/shadow best-effort writes; they fail silently on EROFS and nothing depends on them. |

## 7. What this task does not cover

- The RAUC slot definitions and `system.conf` (RFCT-014).
- The machine-id oneshot (RFCT-015).
- The U-Boot side: `ENV_OFFSET` pinning, `BOOT_ORDER` handshake, appending
  `systemd.machine_id=` (RFCT-018).
- v2 image contract verification (RFCT-017).
- Any initramfs. Per §2, M4 ships none.
