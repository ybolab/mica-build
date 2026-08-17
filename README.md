# mos

Embedded appliance operating system project. Talos-derived immutable OS core,
per-board BSP artifacts, RAUC/Uptane A/B updates, local web management.

## Layout

- `docs/` — project docs: PMA plans (`docs/plan/`) and tasks (`docs/task/`) governing the whole project
- `talos/` — OS core (independent git repo): Talos fork providing the rootfs, machined, webd
- `board-cx3576/` — CX3576-Z (RK3576) BSP (independent git repo): U-Boot, kernel, firmware, Alpine demo image

`talos/` and `board-cx3576/` are standalone git repositories, intentionally not
submodules; this root repo versions only project-level docs and layout.
Doc history prior to the relocation lives in the talos repo history.
