# mos System Architecture

> English | [中文](architecture.zh.md)
>
> Status: living document. Detailed designs live in `design/` and `plan/`;
> this file is the top-level map. Last updated: 2026-08-17.

## 1. What mos is

An embedded appliance operating system: an immutable, declaratively-managed OS
for ARM SoC boards and generic x86_64 machines, with A/B updates, a local web
management plane, and field-grade provisioning. It composes proven pieces
rather than inventing them:

| Layer | Source | Why |
|---|---|---|
| OS core (rootfs, PID 1, declarative runtime) | **Talos fork** (`talos/`) | COSI controller convergence, immutable squashfs rootfs, single-binary Go userland |
| Update security | **Uptane/TUF** | role-separated signing, offline root keys, rollback/freeze protection (Torizon-proven) |
| A/B slot installer | **RAUC** (CLI-only) | field-hardened slot writing, U-Boot handshake, adaptive (delta) streaming |
| BSP artifacts | per-board buildkit Dockerfiles (`board/`) | vendor kernel/U-Boot pinned and containerized; no Yocto in the OS build |
| Field engineering patterns | modeled on balenaOS / Venus OS | offline provisioning, SD/USB updates, dev/prod variants |

## 2. Component inventory (runtime)

```
                   machine config (multi-doc YAML, STATE partition)
                                     |
                          machined (PID 1, COSI runtime)
     ______________________________________|________________________________
    |          |           |            |           |            |          |
  webd       connd       sshd*      console*     updater      apid       containerd
  local      WiFi/AP     Go SSH     tty2 wizard  Uptane +     upstream   workload ONLY:
  HTTPS      BT/CAN      + busybox  tty3 shell   RAUC CLI     mgmt gRPC  extension svcs,
  UI/API     (PLAN-008)  (debug     (debug       (PLAN-006)   (off by    future app
                          variant)   variant)                  default)   containers
```

\* debug-variant only; excluded from prod images at build time.

- **machined** — Talos PID 1: service supervision, COSI controllers, sequencer.
  Appliance machine type (`TypeAppliance`) gates off k8s/etcd/trustd/CRI/dashboard
  (PLAN-007).
- **webd** — the end-user management plane (HTTPS): first-run setup, status,
  network config, update UI. Talks to machined over `/run/machined.sock`.
- **connd** — unified connectivity: WiFi STA/AP, Bluetooth, CAN (design/PLAN-008).
- **updater** — in-machined orchestration: Uptane metadata verification, policy
  gates, RAUC invocation, health-gated commit (PLAN-006).
- **apid + talosctl** — upstream-maintained machine API, kept for operations and
  future fleet management (SideroLink); disabled/bound by default
  (design/remote-management.md).
- **containerd** — workload layer only; never part of the update path.

## 3. Storage & boot (per PLAN-006)

- Partitions: raw U-Boot area | BOOT-A/B (FIT: kernel+dtb) | ROOTFS-A/B
  (squashfs + dm-verity) | UENV-A/B (redundant env) | META | STATE | EPHEMERAL.
- **No initramfs in the normal boot path**: verity device assembled by
  `dm-mod.create=` on the signed FIT cmdline; rootfs is disk-backed, zero
  non-reclaimable RAM for the OS image (256MB boards feasible).
- Rescue: third FIT configuration with a micro-initramfs, loaded only when all
  slots fail or `talos.rescue=1`; plus rockusb/factory reflash below it.
- Invariant: **a power cut at any instant leaves the device bootable into some
  working slot** (matrix in PLAN-006 Part F; 200-cut rig is an acceptance gate).

## 4. Trust chain

```
factory key ─ signs ─> U-Boot verified boot ─> FIT (kernel+dtb+cmdline)
                                                  └─ cmdline carries dm-verity root hash
                                                        └─ rootfs verified per-block at runtime
update path:  TUF root (offline) ─> targets/snapshot/timestamp ─> RAUC bundle (CMS, separate key)
lockbox:      same metadata carried on the media; expiry invalidates stale field media
variants:     prod images contain no shell/sshd — "has a shell" is part of the image hash
```

Two signing systems on purpose: TUF online keys cannot sign bundles, bundle CMS
key cannot sign metadata; root rotation is exercised as an acceptance item.

## 5. Access model (design/access.md)

Three channels, three strengths — never one shell for everything:

1. **Network wizard** (tty2 TUI / AP captive portal): resource-whitelisted,
   weak auth (per-device PIN), covers "no network on site".
2. **Full shell** (tty3 / SSH): debug variant only; phase 1 = per-device
   default password, later offline challenge-response; META-persisted
   brute-force counters; audit to syslogd.
3. **Rescue**: physical-access recovery, below the OS.

Layered disablement: config switch (runtime) → META lockdown (irreversible
without wipe) → prod image variant (compile-time absence).

## 6. Repository & directory map

```
mos/                 this repo: docs, boards, extensions, update tooling, Makefile
├── talos/           independent git repo — the OS fork (upstream: siderolabs/talos)
├── board/<name>/    BSP per board: board.yaml + buildkit Dockerfiles -> artifacts
├── extensions/      system extensions (connectivity, rescue) per image profile
└── update/          release signing (TUF+CMS) and lockbox builder; server side is static files
```

Derivation strategy (PLAN-007): the talos fork tracks upstream via **k8s-less
gating plus additive increments** — never deletions — so upstream merges stay
routine. Current base: v1.14.0-rc.1 era.

## 7. Boards

- `board/cx3576` — CX3576-Z (RK3576, arm64): vendor kernel 6.1.115 tree,
  mainline U-Boot, WiFi/BT/CAN. First hardware target.
- `board/x64` — generic UEFI x86_64: no BSP build, upstream Talos boot chain;
  QEMU/CI baseline ("x64 green + cx3576 red ⇒ board-specific bug").

BSP contract (design/boards.md): boards produce artifacts (kernel Image +
modules + dtb, U-Boot binary), consumed by the talos image build via stage
substitution; kernel configs must pass the mos assertion set (verity, squashfs,
containerd prerequisites).

## 8. Roadmap ↔ documents

| Stage | Content | Doc |
|---|---|---|
| done | rebase onto upstream + gating strategy | PLAN-007 |
| next | board bring-up (cx3576 flashable Talos image) | plan TBD (campaign L2-B) |
| then | A/B update stack (RAUC+Uptane) | PLAN-006 |
| then | access layer (webd completion, sshd/console, auth) | design/access.md → plan TBD |
| then | connectivity (connd) | PLAN-008 |
| later | app workload as Uptane secondary ECU, fleet mgmt (SideroLink), BLE provisioning | design/remote-management.md, PLAN-008 P3 |
