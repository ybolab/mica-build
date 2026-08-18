# PLAN-010 Plan B migration - systemd base + mosd management plane

- **status**: in progress
- **createdAt**: 2026-08-17 20:30
- **approvedAt**: 2026-08-17 20:30 (user decision; see research/init-strategy.md)
- **completedAt**: -
- **relatedTask**: RFCT-008 (M1); further tasks created per-milestone on dispatch

## Context

Decision record: research/init-strategy.md "DECISION 2026-08-17". The Talos
core is replaced by systemd as the OS base; the mos-specific value moves into
a Rust management plane. Everything OS-agnostic survives unchanged: the whole
BSP layer (validated on hardware through the machined bring-up), the
RAUC+Uptane update design (PLAN-006 — RAUC integration actually simplifies,
its native home is systemd/D-Bus), and the model layer of every design doc
(access, provisioning, display, connd, remote-management).

Architecture target (Venus OS + Bottlerocket hybrid, see research docs):

```text
systemd base: PID 1, mounts, networkd (incl. native WireGuard), journald,
              sysext (extension analog), udev
      ^
mosd (Rust): central state/settings tree + persistence + reconcilers
             (applies settings to networkd/systemd/RAUC) + remote bridge
      ^                                        ^
webd + kiosk (one UI, local/remote paths)    RAUC (native) + tough (TUF signing)
```

## Milestones

### M1 - systemd rootfs prototype boots on cx3576

- **Status**: in progress — RFCT-008. Done criteria: image build + verify script green
  locally; hardware boot to sshd over DHCP is the user's manual acceptance (pending
  user validation).
- buildkit-assembled Debian-based (bookworm/trixie slim) arm64 rootfs with
  systemd, systemd-networkd (DHCP default), sshd (dev profile), dropping onto
  the EXISTING boot chain (U-Boot -> extlinux -> BSP kernel + initramfs or
  direct root=; layout per current image pipeline, adapted in the mos repo —
  new `os/` directory, NOT in the talos repo).
- Reuse board/cx3576 artifacts as-is; kernel fragment already carries
  machined-era options (harmless) + WireGuard.
- Acceptance: boots to sshd + networkd DHCP on hardware; journald readable.

### M2 - mosd skeleton (Rust)

- **Status**: implementation complete — RFCT-009. Done criteria met locally
  (2026-08-18): `./mosd/hack/check.sh` green; `make os-image-cx3576` +
  `make os-verify-cx3576` green with mosd included (verify 47/47);
  on-device "settings applied live + survive reboot" remains the user's
  hardware acceptance (pending).
- Workspace per pma-rust baseline; state tree + settings persistence
  (STATE partition), IPC endpoint, first two reconcilers: hostname, network
  (rendering networkd units).
- Open decisions to settle in M2 design: IPC protocol (D-Bus vs varlink vs
  gRPC), settings schema/versioning (adopt Bottlerocket migrator pattern).
- Acceptance: settings write -> networkd unit rendered -> applied live;
  survives reboot.

### M3 - webd on mosd

- Port webd's UI/HTTP layer to the mosd API (drop machined socket client);
  first-run setup + status + network config pane; kiosk deferred to display
  phase.

### M4 - A/B updates (PLAN-006 executed on systemd)

- Partition layout and trust chain per PLAN-006 (unchanged); RAUC with native
  systemd integration; U-Boot BOOT_ORDER handshake; tough-based signing in
  update/sign; health gate = systemd unit states + mosd checks -> rauc
  mark-good.

### M5 - access + provisioning + connd on the new base

- access.md phase 1 (per-device password, gated sshd), provisioning.md Layer 1
  (first-boot self-provisioning in mosd), connd reconcilers over
  wpa_supplicant/hostapd (much thinner: systemd owns lifecycles).

### M6 - workload layer: balena-engine

**Decision (2026-08-17, user): the container engine is balena-engine**
(balena-os/balena-engine, Apache-2.0 Moby fork), not containerd/docker.
Rationale — it is engineered for exactly our field constraints:

- **container deltas** (10-70x bandwidth reduction) — the app-layer answer to
  PLAN-006's delta story;
- **atomic, durable image pulls** — power-cut-safe by design (same invariant
  class as our A/B updates);
- single static binary, ~3.5x smaller than docker, conservative RAM/storage;
- Docker-API compatible: compose-based app delivery works unchanged, and mosd
  drives it from Rust via the mature `bollard` client crate.

Scope: balena-engine as a systemd unit (data-root on EPHEMERAL); app
delivery = compose bundle managed by mosd, versioned as the Uptane secondary
ECU per PLAN-006 Part I. Integration notes: engine tracks Moby with version
lag (acceptable for an appliance); balena's delta *generation* is server-side
infra — phase 1 uses plain pulls, delta serving evaluated with the fleet
phase (openBalena delta service vs registry-native alternatives).

## Out of scope / retired

- talos repo: reference-only, archived at its final commit; no further fixes.
- PLAN-009's Talos image pipeline (hack/cx3576 in the talos repo): superseded
  by the M1 pipeline in the mos repo.

## Risks

- Debian base pulls in more userland than Talos's rootfs did — counter with a
  strict package allowlist and image-size budget in M1 acceptance.
- mosd is new code on the critical path — mitigated by scope (reconciler over
  systemd, not PID 1), pma-rust quality gates, and keeping webd/RAUC
  independent of mosd internals (narrow API only).
- systemd version vs old kernels: pin a systemd version compatible with the
  oldest supported kernel tier (boards.md §6 revisit: floors relax under
  systemd — update that section in M1).
