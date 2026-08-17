# Research: Init & Core Strategy (Plan A / B / C)

> English | [中文](init-strategy.zh.md)
>
> Consolidated decision record from the 2026-08-17 evaluation: keep the Talos
> core, or move to systemd + Rust userland (Bottlerocket model), or rewrite
> PID 1 in Rust. Includes measured data, the industry survey, and the concrete
> triggers that would change the decision.

## DECISION 2026-08-17 (late): Plan B ADOPTED

The user decision superseded the trigger framework the same day it was
written, on accumulated evidence: (a) hardware bring-up on the 6.1 vendor
kernel hit successive machined/new-kernel-API incompatibilities (mount API
lowerdir+/SET_FD, then FSCONFIG_CMD_CREATE EINVAL on the legacy fallback) —
trigger 2's "structural incompatibility" firing in real time; (b) 4.x-kernel
boards expected in the pipeline; (c) Venus OS research showed the management
plane reduces to one Rust service (state tree + reconciler + bridge) once
systemd/networkd/RAUC own the execution layer. The bring-up flash validated
the entire BSP/boot chain (kernel, U-Boot, extlinux, eMMC, mounts up to
machined userland) — that work carries over unchanged.

Migration plan: docs/plan/PLAN-010. The talos repo becomes reference-only
(no further fixes; the fsopen legacy fallback stays as-is, unused).
Plan A sections below are retained as the historical record.

## 1. Measured scope of "what Talos provides" (non-test Go LOC)

| Subsystem | LOC |
|---|---|
| machined total (PID 1, sequencer, supervision, controllers) | 100k |
| — all controllers | 64k |
| — network stack alone (declarative netlink: link/bond/vlan/route/DNS/DHCP/nftables/wireguard/time) | 18k |
| machinery/config (multi-doc schema, validation, patching) | 51k |
| whole repo | 515k |

A faithful reimplementation of what mos actually uses is an 80–120k LOC
equivalent; the network stack and the COSI runtime are years of accumulated
edge cases.

## 2. Industry survey: Rust PID 1

No production-grade adoptable Rust Linux init exists. Closest prior art:
**Bottlerocket** (AWS: Rust userland, but systemd as init — the strongest
datapoint FOR the hybrid pattern), **Northstar** (embedded Rust container
runtime, automotive), **Aurae** (Rust PID 1, stalled), rustysd/Horust/rinit
(experimental). Real building blocks exist (rustix, rtnetlink — production-used
by netavark; containerd rust-extensions), but a Rust init is pioneering, not
assembling.

## 3. The three plans

### Plan A (current): Talos core + separate-process services

machined stays PID 1; every mos addition (webd, connd, updater, kioskd) is a
separate process speaking to machined only via COSI resources and
`/run/machined.sock`. New standalone services MAY be written in Rust — the
interface is gRPC/COSI, language-free. This is the strangler shape: the core
stays replaceable without ever betting the product on replacing it.

### Plan B (designated fallback): systemd + Rust userland (Bottlerocket model)

Feasibility is HIGH — it is the mainstream embedded path (Torizon, Venus,
balena are systemd-family), and Bottlerocket proves the exact shape at scale.
What it buys and costs vs Plan A:

| Dimension | Plan A (Talos) | Plan B (systemd + Rust) |
|---|---|---|
| Kernel floor | 5.2 hard (fsopen); 5.10 Tier 1 policy | ~4.15 (classic mounts) — the decisive advantage for old-vendor-kernel boards |
| C-userland integration (RAUC, wpa_supplicant, bluez, cage/kiosk, ModemManager) | each needs bespoke supervision wiring | **native**: all of these ship systemd units; RAUC's home turf is systemd/D-Bus |
| Declarative runtime | COSI convergence (our differentiator; connd/access/display all modeled on it) | lost — replaced by settings→template→restart (Bottlerocket style) or a self-built Rust mini-reconciler (a scoped, legitimate landing zone for Rust ambitions: reconciler over systemd/networkd, NOT PID 1 + mounts + netlink) |
| Config machinery, machine API (apid/talosctl), upstream security flow | inherited from Talos | self-built / lost |
| Extensions | Talos system extensions | systemd-sysext (close analog, arguably simpler) |
| Migration cost from today | zero — hardware bring-up already past /etc overlay | strategic reset, ~3–6 months; BSP layer (kernel/uboot/board artifacts) carries over unchanged |

### Plan C: Rust PID 1 from scratch

12–24 engineer-months to reach Talos-grade reliability (see §1), solo
maintenance forever, no base to adopt (§2). Only wins in one scenario: a hard
requirement to run on kernels below what systemd supports, with init
requirements frozen. Demoted below Plan B.

## 4. Triggers (re-evaluate, don't drift)

Fire Plan B evaluation when any two hold:

1. Upstream Talos merge cost exceeds ~1 person-week/quarter for two
   consecutive quarters.
2. A structural upstream incompatibility appears that gating cannot contain
   (e.g. dropping pre-6.x kernel mount compatibility outright), or 4.x/<5.2
   kernel boards become a primary business requirement (boards.md §6).
3. mos init-level requirements are frozen for 6+ months.

Until then: Plan A, with the separate-process discipline as the permanent
escape hatch. Direct Rust investment goes to product-layer services and to
`update/sign` tooling (tough).

## 5. What we adopt from Bottlerocket regardless of plan

See os-comparison.md addendum: tough (Rust TUF) for release signing, the
migrator pattern for config schema migrations, the admin-container pattern as
a `sealed`-profile access option, wave-based rollout for the fleet phase.
