# os/rootfs — Debian systemd arm64 rootfs (cx3576, PLAN-010 M1)

Builds a minimal Debian bookworm + systemd root filesystem for the cx3576
board as a minimally-sized, content-derived ext4 image, ready to be dd'd into
the disk image by the assembly step.

## Sizing

The pack stage computes the image size from content only (deterministic — no
clock, no randomness):

```
size_mib = ceil(du_mib(/rootfs) * 115 / 100) + 48
```

The 15% headroom scales with content; the fixed 48 MiB margin covers ext4
metadata (journal, inode tables, bitmaps) plus everything that must be written
BEFORE systemd-repart + growfs expand the partition on first boot: journal
replay, systemd first-boot machine-id and /var directories, and ssh host key
generation. `os/verify-image.sh` asserts that at least 32 MiB of that margin
survives packing as free space. The ext4 block size is pinned to 4 KiB
(`mke2fs -b 4096`, matching the page size) so mke2fs's "small" profile cannot
silently switch to 1 KiB blocks now that the filesystem is under 512 MiB.

## Build

```sh
# needs board/cx3576/out/kernel/modules.tar (make -C board/cx3576 kernel),
# or point BOARD_DIR at prebuilt BSP artifacts:
BOARD_DIR=/srv/ai/mos/board/cx3576 bash os/rootfs/build.sh
```

Outputs to `_out/cx3576/`: `rootfs.img` (ext4, content-derived whole-MiB size)
and `rootfs-report.txt` (package list + installed size; the build fails if the
installed size exceeds 400 MB).

On x86 hosts, arm64 emulation comes from binfmt
(`docker run --privileged --rm tonistiigi/binfmt --install arm64`). If the
current builder still lacks linux/arm64 (e.g. host binfmt registration is
unavailable), build.sh automatically falls back to a docker-container builder
named `mos-arm64`, whose buildkit image bundles its own QEMU emulators.

## Package allowlist

Only: systemd systemd-sysv systemd-resolved udev dbus kmod openssh-server
iproute2 bluez rfkill (plus their hard dependencies). Do not add packages
without updating this list.

bluez and rfkill exist for the board hardware-init layer (btattach + rfkill
unblock in `mos-bt`); with their new dependencies (libglib2.0-0, libdw1,
libelf1) they add about 11 MB of installed size (TOTAL_MB 204, budget 400) —
see `rootfs-report.txt`.

## mosd

The mos management daemon is cross-built on the host
(`mosd/hack/build-aarch64.sh`, rust target `aarch64-unknown-linux-gnu` linked
with `aarch64-linux-gnu-gcc`) and installed into the rootfs:

- `/usr/bin/mosd` — aarch64 release binary
- `/usr/lib/systemd/system/mosd.service` — enabled via the
  `multi-user.target.wants` symlink
- `/usr/share/dbus-1/system.d/com.mos.mosd.conf` — D-Bus system bus policy
- `/var/lib/mos` — daemon state directory

No new apt packages: mosd only needs `dbus` and `systemd`, both already in the
allowlist. Set `WITH_MOSD=0` to build the rootfs without mosd (default is on).

## Board hardware init

Generic, board-agnostic mechanism in `os/hwinit/` (six best-effort units +
scripts); board-specific facts (module names, sysfs paths, UART device, CAN
defaults, MAC seed, gadget IDs) in conf files staged from `BOARD_DIR/init/`
(falling back to the in-repo `board/cx3576/init/`) into `/etc/mos/`. Every unit
is condition-gated on its conf file and never blocks, delays, or fails the
boot; WiFi association / BT pairing stay with connd. The units are enabled via
`multi-user.target.wants` symlinks like mosd.

| Unit | Conf | Does |
|---|---|---|
| `mos-modules` | `modules.conf` | `modprobe -q` the board's hardware modules; a module for an absent SKU is skipped |
| `mos-otg` | `otg.conf` | write the USB OTG role to its syscon node (`/etc/mos/otg-mode` overrides) |
| `mos-can` | `can.conf` | set bitrate / restart-ms / CAN FD and bring the interface up |
| `mos-bt` | `bt.conf` | rfkill unblock + `btattach` on the configured UART (ordered after `mos-modules`) |
| `mos-mac` | `mac.conf` | give every `eth*` with a kernel-random MAC a stable address derived from a hardware identity |
| `mos-gadget` | `gadget.conf` | build the CDC ACM debug console gadget and bind it to the UDC |

`mos-mac` exists because neither cx3576 NIC has a MAC in hardware, so the
kernel invents a random one on every boot: gmac0/eth0's dts node carries
neither `mac-address` nor `nvmem-cells`, and the PCIe RTL8168 has no EEPROM.
The address is derived as `02:` + `md5(seed + ifname)`, with the seed being the
eMMC CID — a read-only chip register that is unaffected by reflashing the
media, so a board keeps its MACs (and DHCP reservations) across image updates.
Interfaces whose `addr_assign_type` is not `NET_ADDR_RANDOM` are left alone,
and the unit is ordered before `network-pre.target` so networkd configures the
final addresses. The SoC OTP CPUID would be a deeper root of identity but has
no dts node in this tree and no hardware validation.

`mos-gadget` gives the board an out-of-band console: with the OTG port in `otg`
role the PHY enumerates as a device when a host PC is plugged in, and a udev
rule (`60-mos-gadget-getty.rules`) pulls in `serial-getty@ttyGS0` when the port
appears. The gadget serial number reuses the `mac.conf` seed, so USB identity
is stable too.

The Bluetooth adapter name needs no unit of its own: bluez's hostname plugin
is loaded by default and overrides `Name`, so the adapter follows the system
hostname as long as `/etc/bluetooth/main.conf` does not pin one.

## Dev profile — root login

`ROOT_PASSWORD=... bash os/rootfs/build.sh` sets the root password and writes
`PermitRootLogin yes`. **Dev only — never use for production images.** By
default (unset), root stays locked and SSH root login is not enabled.

## First-boot growth

The flashed image is packed minimally but lands on much larger media (cx3576
eMMC: 116 GiB), so the rootfs grows to fill the disk automatically on first
boot:

- `/etc/repart.d/50-rootfs.conf` (`Type=linux-generic`) makes systemd-repart
  grow partition 2 and relocate the backup GPT. The service is statically
  enabled in bookworm's systemd and only activates when `/etc/repart.d` is
  non-empty; unmatched partitions are never touched.
- `/etc/fstab` mounts the rootfs with `x-systemd.growfs`, which emits a unit
  running `systemd-growfs` (online ext4 grow).

Both steps are systemd-native (zero extra packages), idempotent (no-op when
there is no free space), and cannot wedge boot. A growpart/cloud-guest-utils
fallback was rejected as unnecessary since repart ships in bookworm's systemd.

## Determinism deviation

SSH host keys are generated at build time by the openssh-server postinst and
baked into the image — acceptable for the dev profile, not for reproducible
production builds.

---

# Layout v2 — squashfs + dm-verity rootfs (PLAN-010 M4)

`build-v2.sh` / `Dockerfile.v2` / `overlay-v2/` are a **sibling** of the v1 path
above, not a replacement. v1 keeps building the writable single-slot ext4 root
and is untouched; `make os-image-cx3576` and `make os-verify-cx3576` keep
passing. Everything below applies only to v2.

The design record is `docs/design/ro-root.md` — read it before changing
anything here.

## Build

```sh
# same prerequisites as v1
BOARD_DIR=/srv/ai/mos/board/cx3576 make os-rootfs-cx3576-v2   # rootfs only
BOARD_DIR=/srv/ai/mos/board/cx3576 make os-image-cx3576-v2    # rootfs + full v2 image
```

Outputs to `_out/cx3576/`, all consumed by `os/mkimage-v2.sh`:

| File | Contents |
|---|---|
| `rootfs-verity.img` | squashfs-zstd with the dm-verity hash tree appended, padded to a whole MiB |
| `rootfs-verity.env` | verity parameters as strict `KEY=value` |
| `boot-cmdline-a.txt` / `-b.txt` | the full kernel `append` line for each slot |
| `rootfs-report-v2.txt` | package list, installed size, setuid/setgid inventory, file capabilities |

Every layout constant is read from `os/layout/cx3576-v2.env`; none is duplicated
in `build-v2.sh`, `Dockerfile.v2` or the overlay. The one thing that is *not* a
layout constant is the board console/storage cmdline fragment
(`console=ttyFIQ0,… earlycon=… storagemedia=emmc net.ifnames=0`), carried over
verbatim from v1's `APPEND` and kept in `build-v2.sh`.

### The cmdline files are a contract

`os/mkimage-v2.sh` does not re-derive the verity table: it lifts the
`dm-mod.create="..."` and `dm-mod.waitfor=` fragments straight out of these two
files with `sed` and writes them into each boot slot's `mos-verity.env`, next to
the shared `boot.scr`. (The v2 slots carry no `extlinux.conf` — U-Boot tries
extlinux before `boot.scr`, which would bypass the RAUC A/B handshake.) So:

- `dm-mod.waitfor=PARTUUID=<that slot's rootfs GUID>` is **required**, and the
  assembler fails the build without it. `dm_init_init()` is a `late_initcall`
  and its `wait_for_device_probe()` does not cover eMMC card discovery.
- The `dm-mod.create=` table must be double-quoted, with the spaces inside the
  quotes.
- GUIDs are **lowercase** everywhere — cmdline and `fstab` alike — matching
  udev's `by-partuuid` symlinks, which libblkid formats lowercase. The kernel
  compares with `strncasecmp` and accepts either.
  `os/mkimage-v2.sh` cross-checks the cmdline against the layout env's
  uppercase `ROOTFS_x_GUID` case-insensitively (RFCT-020), so the two spellings
  coexist by design. Do not "reconcile" them by uppercasing the cmdline.

## Pack

Three steps: `mksquashfs -comp zstd -Xcompression-level 19 -noappend
-no-exports -mkfs-time <FILE_MTIME> -all-time <FILE_MTIME> -processors 1`, then
the ownership gate, then `veritysetup format` against the same file with
`--hash-offset=<squashfs bytes>`, the pinned `VERITY_SALT` and a pinned
`--uuid`. `-processors 1` and the two pinned UUID/salt values are what make the
image byte-reproducible; see the determinism table in
`docs/design/ro-root.md`.

**No `-all-root`** (and no `-force-uid`/`-force-gid`). Those rewrite ownership
but not mode bits, so every setgid binary whose group was not root ships
setgid-**root** — `ssh-agent`, `chage`, `expiry`, `unix_chkpwd`,
`dbus-daemon-launch-helper`. Ownership does not need forcing to be
deterministic: it comes from a pinned base image and a pinned package set.
Step 2 of the pack diffs the packed image's setuid/setgid inventory against the
source tree's and **fails the build** on any difference, so re-adding the flag
is a build error rather than a review finding. The verified inventory is in
`rootfs-report-v2.txt`.

## v2 package allowlist

v1's list (systemd systemd-sysv systemd-resolved udev dbus kmod openssh-server
iproute2 bluez rfkill) **plus**:

- **`rauc`** — the update client itself. Required by RFCT-014 (slot definitions,
  `system.conf`) and RFCT-015 (install flow). Installed here so no other task
  has to touch a Dockerfile.
- **`libubootenv-tool`** — provides `fw_printenv` / `fw_setenv`. RAUC's U-Boot
  backend needs it, and so does the first-boot machine-id oneshot (RFCT-015).

Deliberately **not** added: `squashfs-tools` and `cryptsetup-bin`. Packing the
root is a build-stage job (they are installed in `Dockerfile.v2`'s pack stage
only), and the kernel opens the verity device straight from `dm-mod.create=`
with no userspace tool involved.

Installed size: **216 MB against the 400 MB budget** (v1 is 204 MB). The two new
packages and their dependencies account for the 12 MB; the budget is unchanged.

## Read-only root wiring (`overlay-v2/`)

Staged into the build context by `build-v2.sh`, with `*.in` templates rendered
from the layout env so the shipped image carries no placeholder:

| Path | Purpose |
|---|---|
| `etc/fstab.in` | `/srv` from DATA (`noatime,x-systemd.growfs`), `/mnt/state` from STATE, `/mnt/meta` from META, `/var` from EPHEMERAL (`noatime`, **no** growfs), tmpfs `/tmp` — all keyed on lowercased `PARTUUID=` |
| `etc/fw_env.config.in` | the redundant U-Boot env pair, addressed by partition GUID. The single `fw_env.config` source in the tree; RFCT-014's `render-config.sh` asserts its structure rather than shipping a competing file |
| `etc/repart.d/*.conf` | eight definitions in disk order; only `80-data.conf` grows. v1's root-growing definition is gone |
| `etc/tmpfiles.d/mos-var.conf` | age policies for `/var/tmp` and `/var/cache` — `/var` is now a fixed-size partition |
| `etc/systemd/system/mos-seed-var.service` | first-boot restore of `/var` from `/usr/share/factory/var` |
| `etc/systemd/system/mos-seed-state.service` | first-boot STATE directories + per-device sshd host keys |
| `etc/systemd/system/var-lib-mos.mount` | binds `/mnt/state/mos` onto `/var/lib/mos` so mosd's paths are unchanged |
| `etc/systemd/system/var-lib-bluetooth.mount` | binds `/mnt/state/bluetooth` onto `/var/lib/bluetooth` so pairings survive a `/var` wipe |
| `etc/systemd/system/etc-ssh.mount` | binds `/mnt/state/ssh` onto `/etc/ssh` |
| `etc/systemd/system/etc-hostname.mount` | binds `/mnt/state/hostname` onto `/etc/hostname`, so mosd's hostname reconciler can persist a change |
| `etc/systemd/system/mos-apply-hostname.service` | re-applies the persisted hostname after the bind — PID 1 read the squashfs copy long before mount units ran |

Six hwinit units (`mos-modules`, `mos-otg`, `mos-can`, `mos-bt`, `mos-mac`,
`mos-gadget`) are installed and enabled on the v2 path exactly as on v1; all of
them are read-only-root safe (they read `/etc/mos` and write only configfs and
sysfs). See `docs/design/ro-root.md` §6 for the one override that read-only
`/etc` does take away.
| `usr/lib/mos/mos-seed-*` | the two seed scripts |

`fstrim.timer` is enabled. Why all seven repart definitions are needed, why the
growth target moved off the root, and what happens to `/etc/machine-id` are all
explained in `docs/design/ro-root.md`.

## Board hardware init — parity with v1 is enumerated, not restated

`Dockerfile.v2` installs `hwinit-*`, `*.service` **and** `*.rules` from
`os/hwinit/`, and derives the enable list by iterating the units that are
actually present:

```
for f in /tmp/hwinit/*.service; do u="$(basename "$f")"; ln -sf ... ; done
```

This is not a style preference. The previous hardcoded
`for u in mos-modules mos-otg mos-can mos-bt` list is exactly how this file
drifted behind the v1 `Dockerfile` once already: when `mos-mac` and
`mos-gadget` were added, both were *installed* by the existing globs but never
*enabled*, and `60-mos-gadget-getty.rules` was not installed at all — so a v2
image silently lost its stable MAC and its USB debug console with no error
anywhere. Adding a unit to `os/hwinit/` is now sufficient; the build also
asserts at least one unit was enabled, so a glob that matches nothing fails
loudly.

No board fact is restated in the v2 layer. Module names, sysfs paths, UART
device and speed, CAN bitrate and FD flag, MAC seed and gadget IDs all live in
`BOARD_INIT_DIR` and are staged verbatim into `/etc/mos`, where the units read
them at runtime.

## RAUC system.conf is rendered, not committed

`os/rootfs/overlay-v2/etc/rauc/system.conf` is **generated** by
`os/rauc/render-config.sh` (RFCT-014's renderer, which owns the template and
its assertions) and is gitignored. `build-v2.sh` runs the renderer before
staging the overlay, so the template plus `os/layout/cx3576-v2.env` are the
single source of truth and the rendered file cannot drift from them.

`os/bundle.sh` still runs `render-config.sh --check`. It now guards a narrower
case — someone hand-editing the generated file after the last build — rather
than committed-copy drift, which can no longer happen. Note that `bundle.sh`
consumes `rootfs-verity.img` too, so `build-v2.sh` has necessarily run first
and the file is present.

## Storage tiers, and the /var contract

`/srv` (DATA) grows to fill the media and holds the application data worth the
disk. `/mnt/state` (STATE) holds configuration and identity. `/mnt/meta` (META)
holds update metadata. `/var` (EPHEMERAL) is **fixed-size disposable residue** —
logs, caches, package bookkeeping — and wiping it is a supported recovery
action.

That contract is enforced, not just documented: the pack stage fails the build
unless every precious path under `/var` is redirected onto STATE by an enabled
bind mount whose mountpoint exists in the factory `/var`. Today that covers
`/var/lib/mos` (mosd settings, webd credentials) and `/var/lib/bluetooth`
(pairing keys), plus an assertion that journald is `Storage=volatile` and that
`/var/lib/dbus/machine-id` is a symlink rather than a baked per-image identity.
The rule is: **identity, credentials, pairings and update state never live on
`/var`**. Full audit in `docs/design/ro-root.md` §4.

The DATA constants (`DATA_GUID`, `DATA_PARTNUM`, `DATA_FS_UUID`,
`MOS_VAR_MIB`) are **required**: `build-v2.sh` fails if any is missing from
`os/layout/cx3576-v2.env`. There is deliberately no fallback. A build that
quietly emitted the superseded nine-partition arrangement — `/var` growing, no
`/srv` — would pass every downstream check, which is precisely the class of
silent-wrong-artifact this layout work exists to prevent.

## CJK guard

The v2 pack stage runs the same CJK check as the v1 pack stage, over the same
character ranges, extended with the v2-only mos-owned paths (the overlay's
mount units, seed scripts, `repart.d` definitions, `fstab` and
`fw_env.config`). Vendor packages ship translations and are deliberately not
scanned.

## Determinism, and what still deviates

Two cache-hot `make os-rootfs-cx3576-v2` runs produce a byte-identical
`rootfs-verity.img`. Unlike v1, sshd host keys are **not** baked into the image
— they would be a private key shared by every device and would change the verity
root hash on every cold build; `mos-seed-state` generates them per device on
first boot instead.

What still deviates on a cold build: the byte layout depends on the
`squashfs-tools` and `cryptsetup` versions pulled from `debian:bookworm-slim` in
the pack stage. Pinning that base image by digest is the follow-up.
