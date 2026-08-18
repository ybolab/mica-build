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
survives packing as free space.

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
iproute2 (plus their hard dependencies). Do not add packages without updating
this list.

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
