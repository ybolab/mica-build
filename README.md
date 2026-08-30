# mos

Embedded appliance operating system. An immutable verity-protected OS core,
per-board BSP artifacts, RAUC A/B updates pinned by TUF metadata, and a local
web management plane.

`mosd` is the management daemon; `apid` is the API daemon and the web dashboard
is what it serves. Connectivity (`connd`) is not a separate process: mosd's
Wi-Fi reconcilers drive the wpa_supplicant and hostapd userland the image ships.

## Layout

```
mos/
├── docs/            project docs: PMA plans (docs/plan/), tasks (docs/task/), designs (docs/design/)
├── os/              systemd OS build: rootfs, image assembly, verification, boot, RAUC, layout;
│                    os/boards/ carries one directory per supported board — cx3576
│                    (Rockchip RK3576, arm64: U-Boot, kernel, firmware) and x64 (generic
│                    x86_64 UEFI, the QEMU/CI baseline, no BSP build); os/pkgs/ holds the
│                    compiled components: podman, RAUC, the mosd Rust workspace (mosd,
│                    apid and the MQTT broker; its workspace-level tests live under
│                    os/pkgs/mosd/tests/), and TUF release signing
├── extensions/      the optional-layer slot; see extensions/README.md
└── Makefile         top-level routing; run `make help` for the full target list
```

The image is **v2**: an A/B layout with a squashfs + dm-verity read-only root,
RAUC updates and a U-Boot `BOOT_ORDER` handshake. Build and check it with
`make os-image-cx3576-v2`, `make os-verify-cx3576-v2` and
`make os-bundle-cx3576`, paired with the U-Boot that `make -C os/boards/cx3576/bsp
uboot-mos` builds. See `docs/design/uboot-ab-handshake.md`.

Each board directory carries a `board.env` file describing the board as plain
`KEY=value` lines — partition layout, console and boot facts. It is the single
source of truth the image, rootfs, RAUC and verify steps all read.

## Architecture

`docs/architecture.md` describes the system as it stands. The design lineage:
Talos (immutable OS, COSI declarative runtime), balenaOS (field engineering:
provisioning, offline updates, per-board BSP separation), Torizon (Uptane update
security) and RAUC (A/B slot installer). The records live in `docs/plan/` and
`docs/design/`.
