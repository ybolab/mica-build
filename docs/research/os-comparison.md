# Research: OS Landscape Comparison (decision basis)

> English | [中文](os-comparison.zh.md)
>
> Condensed from the 2026-08 evaluation of balenaOS, Talos, Torizon OS, Venus
> OS, and Yocto-from-scratch. Records what was chosen from whom and what was
> rejected — so future contributors don't re-litigate settled trade-offs.

## 1. Comparison matrix

| Dimension | balenaOS | Torizon OS | Talos | Yocto DIY | **mos choice** |
|---|---|---|---|---|---|
| Build | Yocto (Poky+BSP+meta-balena) | Yocto (meta-toradex) | buildkit + Go pkgs | Yocto | **buildkit** (Yocto only inside board dirs when unavoidable) |
| Rootfs immutability | RO partition A/B | OSTree hardlink trees | squashfs (in-initramfs) | assemble yourself | **Talos squashfs, disk-backed + dm-verity** (PLAN-006) |
| OS update | HUP full-partition A/B | OSTree commits + aktualizr | full-image A/B | RAUC/swupdate layers | **RAUC slots + Uptane client in machined** |
| Update security | TLS + proprietary | **Uptane** | image signature | assemble yourself | **Uptane** (Torizon-validated) |
| Delta updates | binary deltas (10-70x) | OSTree object pull | none | casync options | **RAUC adaptive block-hash over static HTTP** |
| App delivery | supervisor + docker-compose | compose as Uptane secondary | Kubernetes | assemble yourself | future: **compose bundle as Uptane secondary ECU** |
| Declarative runtime config | none (target state = apps only) | none (/etc + scripts) | **COSI machine config** | none | **COSI** — the reason Talos is the core |
| Field provisioning | boot-partition config.json, AP tools | Toradex tooling | none (push config first) | none | **balena patterns**: BOOT file, USB, AP portal (access.md §7) |
| Remote reach (NAT) | VPN dial-back + cloud | Torizon Cloud | SideroLink (Omni) | none | **SideroLink** (planned) |
| Shell/SSH | yes (dev open, prod keyed) | yes (normal Linux) | none | yes | **gated + variant-split** (access.md) |
| Hardware reach | 90+ device types via Yocto BSPs | Toradex SoMs first | UEFI-centric + overlays | anything, at cost | per-board artifact dirs (boards.md) |
| License | OS Apache-2 / openBalena AGPL / cloud closed | OS open / cloud closed | MPL-2.0 | n/a | MPL-2.0 (talos fork) + Apache-2 tooling |

## 2. What was taken from whom

- **Talos**: the core. COSI declarative convergence, machined supervision,
  immutable squashfs rootfs, single-image mindset, machine-config model,
  upstream-maintained apid/talosctl. Kept by riding upstream k8s-less gating
  (PLAN-007) instead of forking by deletion.
- **Torizon**: the update trust architecture (Uptane, lockbox-style offline
  bundles, multi-ECU model for future app/bootloader updates). Its OSTree was
  rejected: content-addressed rootfs would replace Talos's squashfs identity
  model and widen the runtime attack surface.
- **RAUC** (Yocto ecosystem): the slot installer. Chosen over reimplementing
  slot writing/bootcount/power-safety in Go (PLAN-005, superseded) once the
  disk-backed rootfs removed the "single FIT file" elegance argument.
  Integrated CLI-only, no D-Bus, machined stays the only orchestrator.
- **balenaOS / Venus OS**: field engineering patterns — offline provisioning
  media, SD/USB update UX, dev/prod image variants, "config file on the boot
  partition" as the zero-network bootstrap. Their cloud-centric device
  supervisors were not adopted (webd + updater fill the role locally).
- **Yocto**: only as a caged BSP tool inside board directories; its package
  ecosystem/licensing tooling is the one real loss, compensated by SBOM
  scanning in CI (tracked as an open obligation).

## 3. Rejected alternatives (with the killing argument)

| Option | Why rejected |
|---|---|
| Whole-OS Yocto (build a mini-Torizon) | runtime control plane would be empty: no COSI equivalent, config drift returns; build times and specialist skill cost |
| balenaOS as base | supervisor/cloud coupling; no declarative machine config; AGPL/closed pieces in the management plane |
| Torizon as base | Toradex SoM gravity; OSTree vs our verity/squashfs identity model; cloud closed |
| PLAN-005 (FIT-in-RAM single file + custom Go updater) | ~130MB RAM residency; re-implements RAUC's hardened territory; per-pair delta server needed. Superseded by PLAN-006 |
| OCI/registry as update transport | second transport beside static HTTP + lockbox must exist anyway; registry adds a stateful service for zero gain |
| Keeping the deletion-based fork | 401-commit drift proved unmergeable; upstream k8s-less gating (9ffa772ba) made it obsolete |

## 4. Addendum: Bottlerocket (evaluated 2026-08-17)

AWS's from-scratch immutable OS: upstream LTS kernel + glibc + **systemd** +
patched GRUB (GPT-priority A/B via signpost), all management userland in Rust
(apiserver, updog/TUF, migrator), host access via admin/control containers,
dm-verity rootfs, SELinux enforcing. Build system: Rust `buildsys` driving
internal RPM specs (no runtime package manager).

Verdict: **same architectural pattern mos converged on independently**
(immutable + verity + A/B + TUF + gated access + image variants); not adopted
as a base because signpost speaks no U-Boot, its settings tree has no
reconciliation loop (too weak for connd-class networking), and the
AWS-coupled build system plus thin non-AWS community make derivation more
expensive than the Talos path. Its init choice (boring systemd, Rust only at
the edges) is recorded as Plan B in research/init-strategy.md.

Adopted from it regardless: **tough** (Rust TUF library) for `update/sign`,
the **migrator** pattern for config schema migrations, the **admin container**
pattern as a `sealed`-profile access option, **waves** for fleet rollout.

## 5. Positioning

balenaOS wins at cloud-managed container fleets; Torizon wins at industrial
SoM + update standards; Talos wins at immutability and declarative purity. mos
takes Talos's architecture as the differentiator and back-fills the field
engineering the data-center heritage lacks — while keeping every borrowed
mechanism (Uptane, RAUC, SideroLink) in its upstream-maintained form rather
than absorbing forks.
