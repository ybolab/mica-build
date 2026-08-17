# os/rootfs — Debian systemd arm64 rootfs (cx3576, PLAN-010 M1)

Builds a minimal Debian bookworm + systemd root filesystem for the cx3576
board as a fixed-size 1024 MiB ext4 image, ready to be dd'd into the disk
image by the assembly step.

## Build

```sh
# needs board/cx3576/out/kernel/modules.tar (make -C board/cx3576 kernel),
# or point BOARD_DIR at prebuilt BSP artifacts:
BOARD_DIR=/srv/ai/mos/board/cx3576 bash os/rootfs/build.sh
```

Outputs to `_out/cx3576/`: `rootfs.img` (ext4, exactly 1024 MiB) and
`rootfs-report.txt` (package list + installed size; the build fails if the
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

## Dev profile — root login

`ROOT_PASSWORD=... bash os/rootfs/build.sh` sets the root password and writes
`PermitRootLogin yes`. **Dev only — never use for production images.** By
default (unset), root stays locked and SSH root login is not enabled.

## Determinism deviation

SSH host keys are generated at build time by the openssh-server postinst and
baked into the image — acceptable for the dev profile, not for reproducible
production builds.
