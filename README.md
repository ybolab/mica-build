# mos

Embedded appliance operating system. Immutable Talos-derived OS core, per-board
BSP artifacts, RAUC/Uptane A/B updates, local web management (webd), unified
connectivity service (connd).

## Layout

```
mos/
├── docs/            project docs: PMA plans (docs/plan/) and tasks (docs/task/)
├── talos/           OS core (independent git repo): Talos fork — rootfs, machined, webd
├── board/           one directory per supported board
│   ├── cx3576/      CX3576-Z (Rockchip RK3576, arm64): U-Boot, kernel, firmware, Alpine demo
│   └── x64/         generic x86_64 UEFI platform (QEMU/CI baseline, no BSP build)
├── extensions/      Talos system extensions (connectivity, rescue) — per-image profiles
├── update/          Uptane/RAUC release signing + lockbox tooling (static-content server side)
└── Makefile         top-level routing: make os, make cx3576-kernel, ...
```

`talos/` is a standalone git repository (large upstream fork history); everything
else is versioned by this root repo. Each board directory carries a `board.yaml`
metadata file consumed by image assembly.

## Architecture references

Derived from: Talos (immutable OS, COSI declarative runtime), balenaOS (field
engineering: provisioning, offline updates, per-board BSP separation), Torizon
(Uptane update security), RAUC (A/B slot installer). Design records live in
docs/plan/PLAN-005..008.
