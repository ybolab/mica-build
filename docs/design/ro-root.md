# Read-only root: squashfs + dm-verity on cx3576

Decision record for PLAN-010 M4 / RFCT-013. Covers how the root filesystem is
packed, how the kernel assembles it without an initramfs, and where every
runtime write goes once `/` is immutable.

Companion documents: `docs/plan/PLAN-006.md` Parts C, D and J (the A/B update
design this implements), `os/layout/cx3576-v2.env` (every layout constant),
`os/rootfs/README.md` (how to build it).

> **Daemon rename (campaign `apid`, 2026-08-19, RFCT-056).** The HTTPS management
> daemon formerly called `webd` is now `apid` — it is the API daemon, and the
> dashboard is one of the things it serves. Only the name changed here; the
> mechanism this document describes is unaffected. See
> `docs/design/dashboard.md` §7.4.

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
| file ownership | *not* forced. It comes from a pinned base image and a pinned package set, and is gated by the assertion below |
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

RFCT-018 has since reached the same conclusions independently and they are now
settled, not open: `dm-mod.waitfor=` exists and is required
(`drivers/md/dm-init.c:26,297-305,324`); `PARTUUID=` resolves through the
`name_to_dev_t()` fallback in `dm_get_dev_t()`
(`drivers/md/dm-table.c:334-341`, `init/do_mounts.c:277-295`, and
`name_to_dev_t` is `EXPORT_SYMBOL_GPL`, not `__init`); dm-verity's SHA-256 is
already built in (`CRYPTO_SHA256=y`, `CRYPTO_SHA256_ARM64=y`,
`CRYPTO_SHA2_ARM64_CE=y`), so no kernel fragment change is needed. The two
investigations agree on every point.

### The generated cmdline

`build-v2.sh` writes one line per slot into `boot-cmdline-a.txt` /
`boot-cmdline-b.txt`. The boot slots deliberately carry **no**
`extlinux/extlinux.conf`: RFCT-018 found that both U-Boot boot frameworks try
extlinux *before* `boot.scr`, so an extlinux config in a slot would silently
bypass the whole RAUC A/B handshake. `os/mkimage-v2.sh` instead compiles
`os/boot/cx3576-boot.cmd` into a `boot.scr` shared by both slots and derives a
per-slot `mos-verity-<slot>.env` by extracting the `dm-mod.create="..."` and
`dm-mod.waitfor=` fragments out of these files with `sed`. The filename carries
the slot because a RAUC bundle installs one boot payload into whichever slot is
inactive, so it must ship both slots' files under distinct names.

That makes the *shape* of these two files part of the contract, not just their
values: a quoted `dm-mod.create=` table with spaces inside the quotes, followed
by `dm-mod.waitfor=PARTUUID=<that slot's rootfs GUID>`, then the rest of the
append line. The files themselves stay exactly as specified — this task does
not produce `mos-verity-<slot>.env`.

The generated line:

```
dm-mod.create="rootfs,,,ro,0 <DATA_SECTORS> verity 1 PARTUUID=<slot> PARTUUID=<slot> 4096 4096 <DATA_BLOCKS> <HASH_START_BLOCK> sha256 <ROOT_HASH> <SALT>"
dm-mod.waitfor=PARTUUID=<slot>
root=/dev/dm-0 rootfstype=squashfs ro rootwait
console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 storagemedia=emmc net.ifnames=0
```

(one line in the file; wrapped here for reading). Notes:

- The same PARTUUID appears twice because the data device and the hash device
  are the same partition; `<HASH_START_BLOCK>` is where the tree begins.
- The device-mapper device is named `rootfs`. The name is cosmetic — it only
  shows up in `dmsetup` output, because the boot path mounts `root=/dev/dm-0`
  and never `/dev/mapper/<name>` (there is no udev at root-mount time).
  `docs/design/uboot-ab-handshake.md` §7.3 originally said `mos`; this
  generator is the authority and that section has been reconciled.
- `dm-mod.waitfor=` is **mandatory**, not an optimisation, and
  `os/mkimage-v2.sh` rejects a cmdline file that lacks it. `dm_init_init()`
  runs at `late_initcall` and the `wait_for_device_probe()` it already calls
  does **not** cover eMMC card discovery, which happens on a delayed
  workqueue. Without the wait, the verity table is built before the partitions
  exist: the boot breaks *intermittently* rather than cleanly, which is the
  worst failure mode to ship. Each slot waits on its own rootfs partition.
- The value of `dm-mod.create=` contains spaces and is therefore quoted. The
  kernel's `next_arg()` (`lib/cmdline.c`) handles a double-quoted value.
- The GUIDs are **lowercase**, the same spelling used in `/etc/fstab` and the
  same one udev gives `/dev/disk/by-partuuid/` (libblkid formats GUIDs
  lowercase). The kernel compares with `strncasecmp` and accepts either, so one
  canonical lowercase spelling everywhere is the least surprising choice.
  `os/mkimage-v2.sh` cross-checks each slot's table against `ROOTFS_A_GUID` /
  `ROOTFS_B_GUID` — which the layout env holds in uppercase — comparing
  case-insensitively (RFCT-020), so the two spellings coexist by design.
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
- **`-all-root` was dropped, and the build now asserts it stays dropped.**
  The M4 spec originally mandated `-all-root` for determinism. That reasoning
  was wrong on both halves. It is not needed — mksquashfs carries the source
  tree's ownership through, and the source tree comes from a pinned base image
  with a pinned package set, so ownership is already deterministic. And it is
  actively harmful: `-all-root` rewrites ownership but **not** mode bits, so
  every setgid binary whose group was not root shipped **setgid-root** —
  `usr/bin/ssh-agent` (was `_ssh`), `usr/bin/chage`, `usr/bin/expiry`,
  `usr/sbin/unix_chkpwd` (were `shadow`), plus
  `usr/lib/dbus-1.0/dbus-daemon-launch-helper` (setuid root, group
  `messagebus`). That widens a privilege boundary inside the part of the system
  that is supposed to be the trustworthy one. It also broke `unix_chkpwd` in
  the *other* direction: it needs egid `shadow` to read `/etc/shadow`, and egid
  root does not grant that, so non-root PAM password verification would have
  stopped working. `-force-uid`/`-force-gid` have the identical mode-bit
  problem and are not an escape hatch.

  Rather than rely on nobody re-adding the flag, the pack stage now proves it:
  it records the setuid/setgid inventory of the **source tree** before packing
  (`find -printf '%M %U %G %P'`), extracts the same inventory from the packed
  image afterwards (`unsquashfs -lln`), and fails the build on any difference.
  Numeric uid/gid on both sides, because the tree is arm64 Debian while the
  pack stage runs on the build platform, whose `/etc/passwd` cannot resolve ids
  like `_ssh` or `messagebus`. The verified inventory is appended to
  `rootfs-report-v2.txt`. Verified negatively as well as positively: re-adding
  `-all-root` fails the build with the expected diff.

## 4. Where writes go

`/` is a verity-protected squashfs and can never be written. The layout v2 data
partitions absorb everything:

| Path | Backing | Options |
|---|---|---|
| `/` | rootfs-a / rootfs-b (`/dev/dm-0`) | squashfs, `ro` |
| `/srv` | DATA (p11) | ext4, `noatime,x-systemd.growfs` |
| `/mnt/state` | STATE (p9) | ext4, `noatime` |
| `/mnt/meta` | META (p8) | ext4, `noatime` |
| `/var` | EPHEMERAL (p10) | ext4, `noatime` — **no** growfs |
| `/tmp` | tmpfs | `noatime,nosuid,nodev,mode=1777` |
| `/var/lib/mos` | bind from `/mnt/state/mos` | mosd settings, apid credentials, **per-device secrets**, **the shadow file** and its **transient-password marker** |
| `/var/lib/bluetooth` | bind from `/mnt/state/bluetooth` | pairing keys |
| `/etc/ssh` | bind from `/mnt/state/ssh` | sshd config + host keys + mosd's `sshd_config.d/10-mos.conf` |
| `/etc/hostname` | bind from `/mnt/state/hostname` | file bind, not a directory |
| `/etc/wpa_supplicant` | bind from `/mnt/state/wpa_supplicant` | mosd's rendered supplicant config (M5) |
| `/etc/hostapd` | bind from `/mnt/state/hostapd` | mosd's rendered hostapd config (M5) |
| `/home` | bind from `/srv/home` | operator home directories, on **DATA** (RFCT-039); source created by `mos-seed-home` |
| `/root` | bind from `/srv/root` | root's home directory, on **DATA** (RFCT-054); source created by `mos-seed-root` |
| **`/etc/shadow`** | **symlink → `/var/lib/mos/shadow`** | **not read-only any more — see below (M5)** |
| `/run`, `/run/lock`, `/dev/shm` | tmpfs | systemd API mounts, unchanged |

> **Partition numbers shifted in M5.** The Rockchip loader area became a real
> GPT partition at p1 (RFCT-031), so every partition after it moved up by one.
> The numbers above are the current ones and match `os/layout/cx3576-v2.env`.
> Partition **GUIDs did not move** — the identity digits in each GUID are
> allocated in the order partitions were added and are frozen once allocated,
> which is exactly why the dm-verity cmdline, `/etc/fstab`, `/etc/fw_env.config`
> and the RAUC slot devices are pinned to PARTUUIDs and needed no change.

### `/etc/shadow` is writable, and this document used to say it was not

**This is a correction.** Earlier revisions listed `/etc/shadow` among the
read-only paths on the verity squashfs. Since PLAN-010 M5 that is no longer
true, and the change is load-bearing: **per-device password authentication works
on v2 ONLY because of it.**

`pam_unix` will read exactly one file for a password, and on v2 that path sat
inside the dm-verity squashfs — so sshd password auth could not work and mosd
could not apply a per-device password at all.

The arrangement:

| Path | What it is |
|---|---|
| `/etc/shadow` | symlink → `/var/lib/mos/shadow` (i.e. onto STATE) |
| `/usr/share/factory/etc/shadow` | the image's own shadow, retained as the factory template |
| `/etc/passwd`, `/etc/group` | **unchanged**, still in the image, still read-only |

A **symlink, not a bind-mounted file**, because a bind-mounted file cannot be
replaced by `rename(2)`, and atomic replace is how mosd writes a credential
without a torn read. (`/etc/hostname` is a bind because systemd-hostnamed
rewrites that file in place — a different case.)

Only the secret-bearing file moves. Account *definitions* stay inside the
signed, verity-covered root while account *credentials* become per-device.

#### Reconcile on every boot, not seed-once

`/usr/lib/mos/mos-shadow-reconcile` runs on **every** boot from
`mos-shadow-reconcile.service`, ordered `After=`/`Requires=var-lib-mos.mount`
and `Before=mosd.service ssh.service`. A seed-once design would freeze the file
at first-boot content, so a later image that adds a system account would leave it
with no shadow entry at all — which M6 will hit the moment balena-engine brings
a service account.

Two rules, in this order:

1. **An entry that already exists in the STATE file is NEVER touched.** The
   device's own credential always wins over the image's — an A/B update must not
   be able to reset a password the operator set.
2. **An account in `/etc/passwd` with no STATE entry gets one appended, always
   LOCKED.** The factory copy supplies the aging fields and the hash field is
   forced to a locked marker; if the factory copy has no entry for that account,
   a locked placeholder is written.

Appending is the only mutation the script makes, so it is **idempotent by
construction**: when nothing is missing it does not rewrite the file at all, only
re-enforcing `0640 root:shadow`.

**Rule 1 has one bounded exception, and it is the transient root password.**
When mosd sets one, it writes a bcrypt hash into root's entry **and records
exactly that hash in a marker file beside the shadow file**,
`/var/lib/mos/transient-root-password`, 0600. On the next boot the reconciler
compares root's current hash against the marker: **equal → the field is rewritten
to a locked marker and the marker file is deleted**, so the password vanishes;
**not equal → the shadow file is left alone.** So rule 1 still holds for every
credential the reconciler did not write — including a dev image's build-time
`ROOT_PASSWORD`, whose hash never matches a marker and therefore survives. That
distinction is the whole reason a marker exists instead of "lock root on every
boot". See `docs/design/access.md` §4.1 and `mosd/mosd/src/transient.rs`.

The marker is resolved **beside** the shadow file rather than at a fixed path,
because that file is `/mnt/state/mos/shadow` before `var-lib-mos.mount` is up
and `/var/lib/mos/shadow` after it, and both must name the same STATE-backed
marker.

The group is not cosmetic. `unix_chkpwd` is setgid `shadow` precisely so a
non-root PAM stack can read this file — the same reason the pack stage
deliberately avoids `-all-root` (§3).

**An EMPTY hash field is not a locked account.** `pam_unix` reads it as "no
password required", so an empty root field is passwordless root login — the worst
state in the threat model, not a benign one. Only genuine locked markers (`!`,
including `!!` and `!`-prefixed forms that retain a hash, and `*`) are accepted;
empty is rewritten to `!` by the reconciler and **fails** both verifiers and the
build-time gate, with its own distinct message.

#### Two known consequences, recorded rather than hidden

- **`/etc/.pwd.lock` remains read-only.** The `shadow` suite's locking is
  therefore unavailable on device. Nothing depends on it: both writers — the
  reconciler and mosd — write by temp-file + atomic rename, which needs no lock
  file. (§6 already recorded `.pwd.lock` writes as failing silently with nothing
  depending on them; that is still true, and it is now true for a path that
  matters.)
- **`/etc/shadow` is a DANGLING symlink for part of early boot** — between
  `mos-seed-var` restoring `/var` and `var-lib-mos.mount` binding STATE over
  `/var/lib/mos`. **Nothing reads it in that window**: the reconciler is ordered
  after the mount, and sshd and mosd after the reconciler. A unit that did read
  shadow during the local mount phase would see a *missing* file rather than a
  *wrong* one, which is the safe failure direction.

**What writes this file has changed since M5.** The sshd reconciler used to
write a per-device password into root's entry on every reconcile; it does not
any more, and the device credential authenticates nothing at all
(`docs/design/provisioning.md` §3.6). Today the file has exactly two writers:
`mos-shadow-reconcile` at boot, and mosd's transient-password bus method. Every
account in it is locked except while a transient password is live.

The credential model this file carries — why a hash written into it is bcrypt
while `access.device.passwordHash` is Argon2id — is stated once in
`docs/design/provisioning.md` §3.3, which is retained there as the superseded
M5 record with the libcrypt measurement that still governs the bcrypt choice.

#### v1 does not get any of this

v1 (single-slot writable ext4 root) gets **only** the no-baked-credential
assertion: no symlink, no factory copy, no reconcile unit. Its `/etc/shadow` is
already writable in place, so there is nothing to redirect and the machinery
would be pure risk for zero gain. What the two images genuinely share is the rule
that no usable root password may ship inside one, and that — and only that — is
asserted in both verifiers.

### Storage tiers

Four partitions, four different answers to "what happens if this is lost?".
The tier decides where a given piece of state belongs, and the mount options
follow from the tier rather than the other way round.

| Tier | Mount | Contents | Grows? | Lost when |
|---|---|---|---|---|
| **STATE** (p9) | `/mnt/state` | configuration and identity: mosd settings, the apid admin password hash and session key, **the per-device secrets and the shadow file**, sshd host keys, **the WiFi daemon configs**, hostname, Bluetooth pairings | no — small and fixed | factory reset only |
| **DATA** (p11) | `/srv` | application data, and the **operator's home directories**: `/home` and `/root` are binds from `/srv/home` and `/srv/root` | **yes** — fills the media | factory reset only |
| **META** (p8) | `/mnt/meta` | update and appliance metadata | no | factory reset only |
| **EPHEMERAL** (p10) | `/var` | disposable runtime residue: logs, caches, package bookkeeping | no — **fixed** size | factory reset **and** routine log cleanup |

Two operations follow from that table:

- **Factory reset** would wipe DATA + STATE + `/var`, bringing the device back
  as if freshly flashed: new host keys, new machine-id, default hostname.
  **Nothing implements it.** No unit, script or bus method performs a factory
  reset; the only mention in code is a doc comment in
  `mosd/mosd/src/provisioning.rs` explaining why wiping STATE *would* return the
  device to first boot. The nearest real operation is a whole-disk reflash,
  which replaces META, STATE and DATA with the image's fresh filesystems — see
  `docs/design/access.md` §9.2, including why "cleared" there means unreachable
  rather than erased.
- **Log cleanup** wipes `/var` alone, and by contract costs nothing that
  matters. It is a recovery action that can be taken on a wedged device
  without asking the user whether they mind losing anything.

**Why `/var` is exactly 512 MiB (`MOS_VAR_MIB`).** The factory `/var` seed is
~9 MiB; journald runs `Storage=volatile` so there is no persistent journal to
grow; the remaining consumers are `/var/tmp`, `/var/cache` and dpkg working
space; and balena-engine's data-root is pinned to `/srv/balena-engine`
(PLAN-010 M6), on DATA, so no container layer ever lands here. 512 MiB is ~50x
the seeded content and under 2% of the smallest realistic eMMC, so `/var` can
never compete with DATA for the disk. Changing the number moves DATA's start
offset, so it is frozen for a flashed fleet in the same way
`MOS_ROOTFS_SLOT_MIB` is; the constant and this rationale live in
`os/layout/cx3576-v2.env`.

**Standing review criterion for future units**, not a one-off audit result:
**identity, credentials, pairings and update state never live on `/var`.** Any
new unit that wants to write one of those must be pointed at STATE (or META for
update bookkeeping) with a bind mount, and the build-time check below must be
extended to cover it. `/var` may hold only what the device can lose at any
moment without a user noticing.

The growth target has now moved twice, and the reasoning is worth keeping.
v1 grew the root. Early v2 grew EPHEMERAL, on the assumption that `/var` was
the filesystem that needed the disk. Neither is right: the root is a
fixed-size verity image in a frozen A/B slot and must never be resized, and
`/var` is disposable — spending 100 GB of eMMC on log space would be an odd
choice while the data worth keeping sat in a fixed partition. DATA/`/srv`
holds what is worth the whole disk, so it is the partition that grows and
`/var` is deliberately capped.

Capping `/var` creates a fill-up mode that did not exist while it grew, which
is what §4's "Fill-up containment" below is for.

**The DATA constants are required, and the build proves it.** `build-v2.sh`
fails if `DATA_GUID`, `DATA_PARTNUM`, `DATA_FS_UUID` or `MOS_VAR_MIB` is absent
from `os/layout/cx3576-v2.env`, naming the file and the missing keys. All four
are demanded even though only `DATA_GUID` is read here, because a
partially-edited layout env is the failure being guarded against: the assembler
needs the other three, and a rootfs built against half a layout is the kind of
artifact that reaches hardware before anyone notices.

While p10 was still being added, this build carried a nine-partition fallback so
the two halves could land in either order. That path is now unreachable and has
been deleted. Keeping it would have been worse than useless: if a constant went
missing through a bad merge or an editing slip, the build would not have failed
— it would have quietly emitted a nine-partition rootfs with `/var` growing and
no `/srv`, and every downstream check would have passed. Silently shipping the
superseded layout is exactly the failure mode the repart hazard below describes.

Two assertions survive from that period and stay meaningful: the staged
definition count must be eight, and exactly one definition must carry
`Weight=1000`.

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

### Nothing precious on /var — audited, and asserted at build time

Calling `/var` disposable is a claim about every file on it, so it is checked
rather than asserted in prose. The pack stage fails the build unless each
precious path under `/var` is redirected onto STATE by a bind mount that is
**actually enabled**, mounts the path it claims to, is backed by `/mnt/state`,
and has a mountpoint in the factory `/var` that gets restored on first boot:

```
precious: /var/lib/mos -> STATE via var-lib-mos.mount
precious: /var/lib/bluetooth -> STATE via var-lib-bluetooth.mount
precious: journald Storage=volatile (journal never lands on /var)
```

The standing rule the check enforces: **identity, credentials, pairings and
update state never live on `/var`.**

What the audit of the built tree found:

| Path | Shape | Disposition |
|---|---|---|
| `/var/lib/mos` | credentials — mosd settings, apid admin password hash and session key | **STATE**, via `var-lib-mos.mount`. apid's `StateDirectory=mos/apid` lands inside it, so it is covered too. |
| `/var/lib/bluetooth` | pairings — bluez link keys | **STATE**, via `var-lib-bluetooth.mount`. Seeded 0700, which bluez requires. |
| `/var/lib/dbus/machine-id` | identity | **Fixed.** It was a *regular file* holding a build-time id — the same D-Bus machine id on every device that flashes the release, sitting on a disposable filesystem. Now a symlink to `/etc/machine-id`, which is the Debian convention and makes it follow the real machine-id (§5). The build asserts it is a symlink. |
| `/var/lib/systemd/random-seed` | entropy | **Left on `/var`**, deliberately. Persisting it is more fiddly than it looks: the unit path escapes to `var-lib-systemd-random\x2dseed.mount`, the file must pre-exist with mode 0600 for a file bind to work, and `systemd-random-seed` loads at early boot and saves at shutdown, either side of the local-fs mount phase. The payoff is small — a wiped `/var` leaves the device exactly where a freshly-flashed one starts, and the SoC has other entropy sources. Not worth the machinery. |
| `/var/lib/systemd/deb-systemd-helper-enabled`, `/var/lib/systemd/catalog` | packaging bookkeeping, regenerable | accepted-discardable |
| `/var/lib/dpkg`, `/var/lib/apt`, `/var/cache/*`, `/var/log/*` | package db, caches, logs | accepted-discardable; restored from the factory copy on first boot |
| RAUC statusfile | **update state** | Must NOT be on `/var`. See below. |

**RAUC statusfile — recommend META.** RFCT-014 owns the `statusfile=` line in
`system.conf`, and of the two safe tiers META is the right one. STATE is
configuration and identity — things a user sets. META is update and appliance
metadata, which is exactly what slot status is, and PLAN-006 Part C already
scopes it that way. Putting it on META also keeps STATE's contents entirely
user-meaningful, which matters for describing what a factory reset destroys.
`/mnt/meta` is an fstab mount brought up in the local-fs phase, long before
anything invokes RAUC, so there is no ordering obstacle. Concretely:
`statusfile=/mnt/meta/rauc.status`. (RAUC's own default would put it under
`/var/lib/rauc`, which is precisely the failure this rule exists to prevent —
losing slot status mid-update is what the A/B design is there to survive.)

### Fill-up containment

While `/var` grew to fill the disk, filling it was hard. Now that it is a
fixed-size partition, it is a real failure mode, so the image degrades rather
than dies:

- **journald stays `Storage=volatile`** — confirmed, and now asserted by the
  same build check. The journal lives in RAM and never touches `/var` at all,
  which removes the single largest source of unbounded growth.
- **`/etc/tmpfiles.d/mos-var.conf`** ages the two remaining unbounded
  directories, applied daily by `systemd-tmpfiles-clean.timer`:
  `q /var/tmp 1777 root root 10d` (Debian's own rule says 30d; an appliance has
  no long-lived interactive sessions, so 10d is the more useful default) and
  `e /var/cache 0755 root root 30d` (regenerable by definition — apt archives,
  ldconfig and debconf caches — and no distro rule ages it today).

Ordinary housekeeping, deliberately not a garbage collector. Reporting `/var`
pressure as a degraded health signal is RFCT-015's side, and it must **not**
fail `mark-good`: a log flood must never trigger an update rollback.

### First-boot growth moved to DATA

v1 grew the root partition with `/etc/repart.d/50-rootfs.conf`. Under v2 the
root is a fixed-size verity image inside a frozen A/B slot and must never be
resized, so that definition is gone from the v2 rootfs and DATA grows instead.
Filesystem growth is `x-systemd.growfs` on the `/srv` fstab entry; repart only
moves the partition boundary and relocates the backup GPT, which is why the
assembled image reserves only a 1 MiB tail.

There is a trap here worth recording. systemd-repart pairs definition files
with existing partitions **by partition type UUID, in order**: the Nth
definition of a type matches the Nth on-disk partition of that type
(`man 5 repart.d`). Eight of the ten v2 partitions carry the `linux-generic`
type — uenv-a, uenv-b, rootfs-a, rootfs-b, meta, state, ephemeral, data — so a
lone "grow the last one" file would have silently attached itself to
**uenv-a**. `/etc/repart.d/` therefore holds all eight definitions in disk
order (`10-uenv-a` … `80-data`); the first seven carry `Weight=0`/`PaddingWeight=0`
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
creating the sources of every STATE bind mount — `/mnt/state/mos`,
`/mnt/state/ssh`, `/mnt/state/bluetooth`, `/mnt/state/hostname`, and since M5
`/mnt/state/wpa_supplicant` and `/mnt/state/hostapd` (both 0700, because they
hold WiFi keys). These must exist before those mounts are attempted, so a
tmpfiles rule (which runs long after `local-fs.target`) would be too late.

It also seeds `/mnt/state/ssh` from `/etc/ssh` while that path still shows the
read-only image copy, and then generates the RSA / ECDSA / Ed25519 host keys
into it if they are absent. `etc-ssh.mount` binds `/mnt/state/ssh` over
`/etc/ssh` afterwards and is ordered `Before=ssh.service`, so sshd sees a
writable directory with per-device keys that survive every A/B update. Binding
over a mountpoint does not write to the underlying read-only filesystem.

It also creates `/mnt/state/bluetooth` at mode 0700 (bluez refuses a laxer
directory), which `var-lib-bluetooth.mount` binds over `/var/lib/bluetooth` so
pairings survive a `/var` wipe.

It seeds `/mnt/state/hostname` the same way, from the `/etc/hostname` baked
into the image, and `etc-hostname.mount` binds that file over `/etc/hostname`.
One extra step is needed there that `/etc/ssh` does not need: PID 1 reads
`/etc/hostname` and sets the kernel hostname long before any mount unit runs,
so at that moment it still sees the squashfs copy. `mos-apply-hostname.service`
runs right after the bind and re-applies the persisted value with
`hostname -F /etc/hostname`. Without it, a hostname set through the web UI
would be written to STATE correctly and then silently revert to the image
default on every reboot. See §6.

**Known consequence:** because the whole of `/etc/ssh` is bound, not just the
key files, changes an update makes to `sshd_config` (or to `sshd_config.d/`)
never reach a device that has already been seeded. This is the shape the M4
spec calls for. Two follow-ups would fix it: bind only `ssh_host_*` files, or
have a RAUC post-install hook refresh the non-key files from
`/usr/share/factory/etc/ssh`.

### The seeding contract, and the constraint it puts on every future image

**`mos-seed-state` is gated by `ConditionPathExists=!/mnt/state/.mos-state-seeded`.
On an already-seeded device the whole oneshot is SKIPPED** — not partially run,
skipped. It creates the directories a fresh STATE needs and then never runs
again.

The consequence, spelled out because the next person to add a bind mount will
otherwise discover it on a device rather than here:

> **A STATE directory added after devices exist will not be seeded.** The
> directory has no source, so its bind mount has nothing to bind, and the
> feature that depends on it is silently absent on exactly the devices that
> already shipped. **Any future image that adds a STATE directory needs a
> seed-generation bump** — some mechanism that makes the oneshot re-run for the
> new directories on an already-seeded device.

This is the **pre-existing shape** of STATE seeding, not something M5
introduced: `/etc/ssh` has had the same property since M4. M5 added
`/mnt/state/wpa_supplicant` and `/mnt/state/hostapd` and deliberately followed
the existing shape rather than redesigning a mechanism several tasks depend on.

It is **harmless today** because nothing has been field-seeded — every device is
flashed whole-disk from an image that carries the current seed script. It stops
being harmless the moment the first device is in the field.

The shadow file is the one case that is already covered, and only by accident of
its design: `mos-shadow-reconcile` runs on **every** boot and creates the STATE
shadow from the factory copy when it is missing, so a device seeded by an older
image still gets one. That is a property of the reconciler, not of the seeding
mechanism, and it does not generalise to any other directory.

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

**Status — steps 1 and 2 are live; step 3 is what remains.** The U-Boot half has
landed: `uboot-mos` is on main, a v2 image carries it (and `os/mkimage-v2.sh`
refuses to assemble a v2 image around the debug variant), and
`os/boot/cx3576-boot.cmd` appends `systemd.machine_id=${machine_id}` whenever
that environment variable is set. The redundant environment this design depends
on genuinely exists on a v2 device, which is also why `/etc/fw_env.config`
addresses something real rather than something planned.

What is still pending is the oneshot that *populates* `machine_id`, which is
RFCT-015's. Until it lands and has run once, nothing sets the variable, the
boot script's `test -n` guard leaves the cmdline argument off, and systemd finds
an empty `/etc/machine-id` on a read-only filesystem, falls back to a transient
id in `/run` and bind-mounts it over `/etc/machine-id`. The machine-id is
therefore **per-boot transient** in the interim: the system boots and works, but
the id changes on every reboot. Note it stays transient for one extra boot even
after the oneshot lands, since the value it writes only reaches the cmdline on
the following boot.

That fallback has a hard prerequisite, independently flagged by RFCT-018: the
image must ship `/etc/machine-id` as an **empty regular file**. systemd
bind-mounts the transient id over that path, and if the file is absent there is
nothing to mount over. The pack stage creates it (`: > /rootfs/etc/machine-id`),
and it is verified present and zero-length in the packed squashfs.

**Constraint — one writer at a time.** RAUC's U-Boot backend and this oneshot
both write the same redundant environment pair through libubootenv, which
provides no cross-process locking. Concurrent writes can corrupt both copies.
The oneshot runs once, early, and RAUC only writes during an install or a
`mark-good`, so they do not overlap in practice — but any future env writer must
respect this.

`/etc/fw_env.config` is shipped by this task pointing both entries at the uenv
partitions by GUID (`/dev/disk/by-partuuid/…`, offset 0, size 64 KiB) rather
than at a hardcoded `/dev/mmcblk0` offset: the GUIDs are layout constants, the
disk name is not. It is the single `fw_env.config` source in the tree — RFCT-014
deliberately did not create a competing `os/rauc/fw_env.config.in` and instead
**asserts this file's structure** in `os/rauc/render-config.sh`: exactly two
device lines (which is what marks the environment redundant to libubootenv),
each matching its UENV GUID case-insensitively at offset 0 with size
`UENV_SIZE_BYTES`, and the partition starts cross-checked against
`UENV_A/B_OFFSET_BYTES` so that the partition-relative offset provably denotes
the same bytes as U-Boot's absolute `ENV_OFFSET`.

The oneshot itself is **RFCT-015's** deliverable and the U-Boot side is
**RFCT-018's**; neither is implemented here.

## 6. Runtime writers to `/etc` — audit

Every `/etc` write path in the v1 rootfs, and what happens to it under v2:

| Writer | Status |
|---|---|
| sshd host key generation | **Redirected.** Keys are not baked; `mos-seed-state` generates them into `/mnt/state/ssh`, bound over `/etc/ssh`. |
| `/etc/resolv.conf` | **Already fine.** v1 makes it a symlink to `../run/systemd/resolve/stub-resolv.conf`; the target is on tmpfs and stays writable. Carried into v2 unchanged. |
| networkd unit rendering by mosd | **Solved as this row predicted.** M5's WiFi reconcilers render into `/run/systemd/network`, which networkd reads at higher precedence than `/etc`, exactly as required here. The static `/etc/systemd/network/80-dhcp.network` is still baked at build time and is still never written. See `docs/design/connd.md` §6 for the naming constraint that goes with it. |
| `/etc/shadow` | **Redirected to STATE** (M5). Symlink → `/var/lib/mos/shadow`, seeded from `/usr/share/factory/etc/shadow` and reconciled on every boot. See §4. This is the one row in this table that changed from read-only to writable. |
| `/etc/ssh/sshd_config.d/10-mos.conf` | **Writable.** Rendered by mosd's sshd reconciler into the existing `/etc/ssh` STATE bind. No new mount was needed. |
| `/etc/wpa_supplicant`, `/etc/hostapd` | **Writable** (M5). New STATE binds, mode 0700; mosd's WiFi reconcilers render 0600 config files into them. The paths are contracts with Debian's `wpa_supplicant@.service` / `hostapd@.service` templates, not preferences. |
| hostname persistence | **Solved**, and it had a live consumer — see below. `/etc/hostname` is bound from `/mnt/state/hostname` and re-applied by `mos-apply-hostname.service`. |
| `/etc/machine-id` | **Solved via the U-Boot env** (§5). The U-Boot half is live; transient per boot until RFCT-015's oneshot populates the `machine_id` variable. |
| `/etc/mos/otg-mode` (hwinit-otg override) | **Read-only in v2.** The documented per-device USB OTG role override cannot be created on the device. Defaults from `otg.conf` are unaffected — see below. |
| `/etc/adjtime` (hwclock) | Not written: no RTC sync unit is enabled. |
| `/etc/mtab` | Symlink to `/proc/self/mounts` in Debian; never written. |
| `/etc/.updated`, `/etc/.pwd.lock` | systemd/shadow best-effort writes; they fail silently on EROFS and nothing depends on them. **`.pwd.lock` stays read-only even though `/etc/shadow` no longer is** — both writers of the shadow file use temp+rename, which needs no lock file. See §4. |

### Board hardware-init units under a read-only root

All six `os/hwinit` units are read-only-root safe, checked rather than assumed:
every `/etc` reference in `hwinit-modules`, `hwinit-otg`, `hwinit-can`,
`hwinit-bt`, `hwinit-mac` and `hwinit-gadget` is a **read** of its
`/etc/mos/*.conf` fact file. Their writes go to configfs
(`/sys/kernel/config/usb_gadget/...` for the CDC ACM gadget), to sysfs, or
through `ip link` — none of them to the root filesystem.

One consequence is worth recording, because it is a silent capability loss
rather than an error. `hwinit-otg` supports a per-device override at
`/etc/mos/otg-mode` (`[ -r /etc/mos/otg-mode ] && mode=$(head -n1 ...)`). On v2
that path is inside the verity-protected squashfs, so an operator cannot create
it on the device: the override is effectively unavailable and the board always
takes the `mode=` from `otg.conf`. Nothing regresses for the default
configuration, and no code needs changing for it today. When the override is
actually wanted, the fix is the same shape as everything else here — read it
from `/mnt/state` (persistent) or `/run` (per-boot) with the `/etc/mos` path
kept as a fallback. That is a change to `os/hwinit`, which is shared with v1,
so it is deliberately not made unilaterally from the v2 side.

### Correction: hostname was not a latent gap

An earlier revision of this document claimed "nothing in mos sets the hostname
today". That was wrong. `mosd/mosd/src/reconciler/hostname.rs` is a merged M2
reconciler that calls `SetStaticHostname` on `org.freedesktop.hostname1`, and
`systemd-hostnamed` implements that by writing `/etc/hostname`. It is reachable
from the M3 first-run wizard, so on a read-only `/etc` "set the hostname in the
web UI" would have failed with EROFS — a user-visible functional regression in
v2, not a gap waiting for a future consumer.

It is fixed with the mechanism already built for `/etc/ssh` rather than a new
one: seed `/mnt/state/hostname` on first boot, bind it over `/etc/hostname`,
re-apply it once the bind is in place. `mosd` is unchanged — the reconciler was
correct as written; the filesystem underneath it was not writable.

One cosmetic gap remains and is deliberately not chased: `/etc/hosts` still
carries the baked `127.0.1.1 mos` line, so it does not follow a hostname
change. Nothing depends on it — systemd's `nss-myhostname`, which is in
`nsswitch.conf`, resolves the current hostname regardless.

## 7. What this task does not cover

- The RAUC slot definitions and `system.conf`, including the `statusfile=`
  line this document recommends putting on META (RFCT-014).
- The DATA partition and the fixed EPHEMERAL size in the layout env and the
  assembler (RFCT-020).
- Reporting `/var` pressure as a degraded health signal (RFCT-015).
- The machine-id oneshot (RFCT-015).
- The U-Boot side: `ENV_OFFSET` pinning, `BOOT_ORDER` handshake, appending
  `systemd.machine_id=` (RFCT-018 — since landed).
- v2 image contract verification (RFCT-017).
- Any initramfs. Per §2, M4 ships none.
