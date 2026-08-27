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
├── os/              systemd OS build: rootfs, image assembly, verification, boot, RAUC, layout
├── mosd/            Rust workspace: mosd (management plane), apid, and the MQTT broker
├── board/           one directory per supported board, plus common/ fragments
│   ├── cx3576/      CX3576-Z (Rockchip RK3576, arm64): U-Boot, kernel, firmware, Alpine demo
│   └── x64/         generic x86_64 UEFI platform (QEMU/CI baseline, no BSP build)
├── extensions/      the optional-layer slot; see extensions/README.md
├── update/          TUF release signing and device-side verification (`mos-sign`, `mos-update-verify`)
├── test/            the apid HTTP API suite (test/apid-api)
└── Makefile         top-level routing; run `make help` for the full target list
```

The image is **v2**: an A/B layout with a squashfs + dm-verity read-only root,
RAUC updates and a U-Boot `BOOT_ORDER` handshake. Build and check it with
`make os-image-cx3576-v2`, `make os-verify-cx3576-v2` and
`make os-bundle-cx3576`, paired with the U-Boot that `make -C os/boards/cx3576/bsp
uboot-mos` builds. See `docs/design/uboot-ab-handshake.md`.

Each board directory carries a `board.yaml` metadata file describing the board;
no build step consumes it yet, because the image scripts hardcode their artifact
paths.

## Architecture

`docs/architecture.md` describes the system as it stands. The design lineage:
Talos (immutable OS, COSI declarative runtime), balenaOS (field engineering:
provisioning, offline updates, per-board BSP separation), Torizon (Uptane update
security) and RAUC (A/B slot installer). The records live in `docs/plan/` and
`docs/design/`.
