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

- **Status**: implementation complete — RFCT-010 (plus RFCT-011 for the
  image-sizing and board hardware-init continuations, and RFCT-012 for
  adopting the hardware-verified Alpine board rootfs and porting its board
  facts into the hwinit layer). Done criteria met locally (2026-08-18): `mosd/hack/check.sh`
  green incl. the webd e2e test; `make os-image-cx3576` +
  `make os-verify-cx3576` green (verify 70/70, image ~427 MiB); on-device
  "browser to `https://<board-ip>/` -> wizard -> applied settings survive"
  remains the user's hardware acceptance (pending).
- Port webd's UI/HTTP layer to the mosd API (drop machined socket client);
  first-run setup + status + network config pane; kiosk deferred to display
  phase.

### M4 - A/B updates (PLAN-006 executed on systemd)

- **Status**: implementation complete — RFCT-020 (layout v2 constants +
  `os/mkimage-v2.sh`), RFCT-013 (squashfs+dm-verity pack + read-only root
  wiring), RFCT-014 (RAUC `system.conf`, bundle build, dev signing keys),
  RFCT-015 (health gate + machine-id oneshot), RFCT-016 (`update/sign` TUF
  skeleton), RFCT-017 (`os/verify-image-v2.sh`), RFCT-018 (U-Boot A/B handshake
  contract) and RFCT-019 (these docs). The on-device A/B switch and rollback
  remain the user's hardware acceptance and are **not** claimed here.
- Partition layout and trust chain per PLAN-006 (refined — see PLAN-006
  "Implementation notes (PLAN-010 M4)"); RAUC with native systemd integration;
  U-Boot BOOT_ORDER handshake; tough-based signing in update/sign; health gate
  = systemd unit states + mosd checks -> rauc mark-good.
- v2 is a sibling of v1 throughout: new files, new Makefile targets, a new
  `...-0002-...` GUID namespace. `os/mkimage.sh` and `os/verify-image.sh` are
  untouched, so a v1 image is still buildable and verifiable.

#### What was delivered

- **Layout v2**, ten partitions, one source of truth in
  `os/layout/cx3576-v2.env`; every consumer (assembler, verifier, RAUC
  `system.conf` renderer, `fw_env.config` renderer, `boot.cmd` compile) sources
  it rather than restating a constant.
- **Read-only root**: squashfs + appended dm-verity hash tree, assembled from
  the kernel command line alone (`dm-mod.create=` / `dm-mod.waitfor=`), no
  initramfs in the normal boot path. Writable state is split across STATE
  (configuration + identity), DATA (`/srv`, application data, the only growth
  target) and EPHEMERAL (`/var`, disposable). See `docs/design/ro-root.md`.
- **RAUC**: `rauc` + `libubootenv-tool` in the image, a rendered
  `/etc/rauc/system.conf` with two raw rootfs slots and the FAT boot slots as
  children, `statusfile=/mnt/meta/rauc.status`, and `os/bundle.sh` producing a
  CMS-signed verity bundle from gitignored development keys.
- **Boot contract**: `boot.scr` compiled from `os/boot/cx3576-boot.cmd` and
  written byte-identically into both boot slots, with the per-slot
  `mos-verity-<slot>.env` as the only file that differs. No
  `extlinux/extlinux.conf` in a v2 boot slot — see the lesson below.
- **Health gate**: `mos-health` confirms the booted slot with
  `rauc status mark-good` only on a clean probe result, and never performs
  remediation — rollback stays with U-Boot's `BOOT_x_LEFT` counter, which is
  what keeps the power-loss guarantee intact.
- **Signing**: `update/sign` (`mos-sign`) with a TUF repository layout and a
  sign/verify roundtrip, covering PLAN-006 Parts A and L phase 1.

#### Verification (2026-08-18, done criteria met locally)

- `make os-image-cx3576` + `make os-verify-cx3576` (v1 regression) —
  `RESULT: PASS (88/88 checks)`.
- `make os-image-cx3576-v2` — ten-partition image, 1315 MiB apparent / ~161 MiB
  on disk (sparse).
- `bash os/mkimage-v2-selftest.sh` — `RESULT: PASS`, 137 checks.
- `make os-health-test` — `RESULT: PASS (43/43)`.
- `make os-devkeys` + `make os-bundle-cx3576` — signed verity bundle;
  `rauc info` validates it against the shipped `system.conf`;
  `compatible=mos-cx3576`.
- `bash mosd/hack/check.sh` — `ALL CHECKS PASSED`.
- `make os-verify-cx3576-v2` — recorded with RFCT-017.

Every number above is a local build/verify result. None of them is a hardware
result.

#### What remains the user's hardware acceptance

Not claimed, not testable in this repository:

- A/B switch on device: install a bundle, reboot, land on the other slot.
- Rollback on device: a slot that fails to boot or fails the health gate
  exhausts `BOOT_x_LEFT` and U-Boot falls back to the previous slot.
- `rauc status` / `rauc install` against a provisioned keyring on real hardware.
- The dm-verity root actually mounting from `/dev/dm-0` at boot.
- The `mos-machine-id` oneshot writing a `machine_id` that the next boot picks
  up (inert until the custom U-Boot is flashed).
- The `docs/design/uboot-ab-handshake.md` §8 bring-up checklist.

#### `board/` dependency — resolved, with one gap

The v2 image must be paired with the **`uboot-mos`** U-Boot variant
(`make -C board/cx3576 uboot-mos`, `board/cx3576/out/uboot-mos/`), which the
user landed as commit `8b24f9d`. Escalation items 1-3 of
`docs/design/uboot-ab-handshake.md` §10 — the three marked as blocking M4
entirely — are resolved by that commit. The earlier framing that "the v2 image
cannot boot until the user applies a U-Boot change" is obsolete.

The two variants are not interchangeable and neither mistake announces itself:
`uboot-mos` in a v1 image corrupts the boot FAT partition on the first
`saveenv` (v1's boot partition starts at 16 MiB, exactly the mos env copy A
offset), and the debug variant in a v2 image has no persistent environment, so
it boots, looks healthy, and silently never runs the A/B handshake. The v2
assembler asserts both directions: the raw blob at sector 64 must equal
`out/uboot-mos/u-boot-rockchip.bin` and must differ from
`out/uboot/u-boot-rockchip.bin`.

Still escalated, unchanged: `board/**` is user-owned, so any further
defconfig or kernel-fragment change proposed by
`docs/design/uboot-ab-handshake.md` is applied by the user, never by this
repository's OS-side tasks.

#### Lesson carried out of M4

The same failure class occurred five times: extlinux silently winning over
`boot.scr`; hwinit units installed but not enabled; the debug U-Boot blob in a
v2 image; the unsuffixed `mos-verity.env` making every update roll back; and a
missing `DATA_GUID` silently producing a nine-partition layout. In every case
the full gate was green and the gate was right — the checks were consistent
with the artifact, they simply were not checking the thing that was wrong.
Each was found by reading or by an explicit cross-check, never by a failing
test.

That is why M4 ends with assertions at build time rather than verification
alone: the setuid/setgid inventory diff, the precious-data bind checks, the
U-Boot variant pairing guard, the required-layout-constants check, and the
`boot.cmd` / bundle-filename drift guards. A verifier can only check what it
was told to look for; a build-time assertion fails at the moment the
assumption stops holding.

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

Scope: balena-engine as a systemd unit with its data-root pinned to exactly
**`/srv/balena-engine`** (user decision); app delivery = compose bundle managed
by mosd, versioned as the Uptane secondary ECU per PLAN-006 Part I. The
data-root is on DATA, not on EPHEMERAL: under the layout-v2 storage tiers
`/var` is a fixed-size, disposable partition and container layers are
application data that must survive a log cleanup and grow with the disk. No
engine bits are implemented in M4. Integration notes: engine tracks Moby with version
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
