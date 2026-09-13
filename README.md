# Mica OS

Mica OS (云母) is an embedded Linux operating system for industrial devices.
Project identifier: `mica`. Official website: [micaos.dev](https://micaos.dev).

The system provides an immutable, signed dm-verity root, independently signed
kernel/support components, file-based A/B deployments, and a local management UI.
Images build for x64, virt-arm64, cx3576 and s905x5m; see the
[board status table](docs/boards/support-tiers.md#current-boards). Development and
acceptance use fresh complete images; there are no old-layout readers or migrations.

`micad` owns device management and connectivity. `apid` exposes the authenticated
API and React dashboard. `mica-runkit`, as init, authenticates the selected deployment before
systemd starts; `mica-deploy` acquires, installs, confirms and retires deployments.

Start with the [documentation portal](docs/README.md) or the
[Chinese user guides](docs/zh/README.md).

## Repository

| Path | Purpose |
|---|---|
| `_out/boards/` | Each pinned board's bundle -- `board.env`, `manifests/`, kernel, firmware, U-Boot -- fetched out of `ybolab/mica-boards`' archives by `make board-fetch` |
| `boot/` | UKI/FIT, initramfs and explicit development signing inputs |
| `rootfs/` | Userspace package composition and immutable root packing |
| `build/` | Signed components, offline archives and complete image assembly |
| `verify/`, `tests/` | Image verification, service tests and boot/fault acceptance |
| `docs/` | Architecture, design contracts, board and user documentation, tracking |

## Build and verify

Use `make help` for entry points. Root composition is independent of kernel and
firmware builds. `bash build/run.sh --components --help` describes the explicit
signing inputs and the `root`, `kernel`, `firmware`, `deployment`, `image` and
`archive` commands. Output directories must be new.

Each factory disk contains exactly three partitions: ESP/SYSTEM/DATA on UEFI,
or FIRMWARE/SYSTEM/DATA on U-Boot boards. SYSTEM holds immutable content objects and
signed deployment records; DATA owns persistent state and bounded writable
namespaces. Firmware maintenance is a separate operation.

Verify a complete image with:

```sh
bash verify/run.sh --verify --board x64 \
  --image /path/to/image/disk.img --public-key /path/to/metadata-public.key
```

Offline verification does not establish firmware enforcement or hardware
reliability; board dossiers under `docs/boards/` separate QEMU, signed-FIT and
physical evidence. See [architecture](docs/architecture.md),
[build](docs/design/build.md) and [updates](docs/design/updates.md).
