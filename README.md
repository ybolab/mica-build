# mos

Embedded appliance operating system. Immutable verity-protected OS core, per-board
BSP artifacts, RAUC/Uptane A/B updates, local web management (apid), unified
connectivity service (connd).

`apid` is the API daemon; the web dashboard is what it serves.

## Layout

```
mos/
├── docs/            project docs: PMA plans (docs/plan/), tasks (docs/task/), designs (docs/design/)
├── os/              systemd OS build: rootfs, image assembly, verification, boot, RAUC, layout
├── mosd/            Rust workspace: mosd (management plane) + apid
├── talos/           abandoned Talos base, reference-only archive superseded by os/ and mosd/ (PLAN-010, 2026-08-17)
├── board/           one directory per supported board
│   ├── cx3576/      CX3576-Z (Rockchip RK3576, arm64): U-Boot, kernel, firmware, Alpine demo
│   └── x64/         generic x86_64 UEFI platform (QEMU/CI baseline, no BSP build)
├── extensions/      Talos system extensions (connectivity, rescue) — per-image profiles
├── update/          Uptane/RAUC release signing + lockbox tooling (static-content server side)
└── Makefile         top-level routing; run `make help` for the full target list
```

The image is **v2**: the A/B layout — squashfs + dm-verity read-only root,
RAUC updates, U-Boot `BOOT_ORDER` handshake (`make os-image-cx3576-v2`,
`make os-verify-cx3576-v2`, `make os-bundle-cx3576`), paired with the U-Boot
built by `make -C board/cx3576 uboot-mos`. See `docs/plan/PLAN-010.md` M4 and
`docs/design/uboot-ab-handshake.md`.

The v1 single-slot development image it grew out of was deleted by RFCT-107
(PLAN-014 M1); git history is its archive.

`talos/` is an untracked standalone git repository (large upstream fork history),
archived at its final commit and kept for reference only; everything else is
versioned by this root repo. Each board directory carries a `board.yaml`
metadata file describing the board; no build step consumes it yet (the image
scripts hardcode their artifact paths).

## Architecture references

Derived from: Talos (immutable OS, COSI declarative runtime), balenaOS (field
engineering: provisioning, offline updates, per-board BSP separation), Torizon
(Uptane update security), RAUC (A/B slot installer). Design records live in
docs/plan/PLAN-005..010 and docs/design/.
