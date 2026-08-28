# RFCT-012 Adopt the verified Alpine board rootfs and port its hardware facts to os/rootfs

- **status**: completed — implementation complete, pending user hardware acceptance
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-18 04:10
- **claimedAt**: 2026-08-18 04:10
- **completedAt**: 2026-08-18 04:25

## Description

A hardware-verified revision of the Alpine board rootfs was dropped into the
tree as `board/cx3576/def/rootfs/`. It is an overlay-based rewrite of the
tracked `board/cx3576/rootfs/` and carries board facts (CAN bitrate, BT attach
parameters, USB OTG role, per-port MAC derivation) that the tracked copy and
the systemd base in `os/rootfs/` do not have.

Two deliverables:

**Part 1 — replace the demo board rootfs.** `board/cx3576/rootfs/` is replaced
by `def/rootfs/` verbatim (firmware and assets are byte-identical; only the
`alpine/` layer changes). The new Dockerfile expects `rootfs/alpine/` as its
build context plus two named contexts, so the `rootfs` make target is adapted.
The tracked Dockerfile referenced `scripts/rs485-pair-test.sh`, a path that
does not exist, so the Alpine build path was broken before this task; the
replacement carries the script in the overlay and fixes it.

**Part 2 — port the board facts to `os/rootfs`.** Only hardware facts and
mechanisms that the systemd base lacks; anything already covered natively
(rootfs growth, getty, resolv.conf) is not ported, and anything belonging to a
later milestone (wpa_supplicant/M5, container engine/M6) stays out.

User decisions taken during proposal (2026-08-18):

1. Firmware: adopt `def` as-is — only the verified AIC8800D80 U02 runtime blobs
   enter the Alpine image; the Broadcom links are not re-added.
2. USB OTG: default role is `otg`, not `host`. The PHY decides the role at
   runtime, so plugging a host PC in enumerates the CDC ACM debug console.
   This makes the USB gadget console worth porting.
3. MAC: derive from the eMMC CID (`/sys/block/mmcblk0/device/cid`), a read-only
   chip register that survives any rootfs update. Applied to every `eth*` whose
   `addr_assign_type` is `1` (NET_ADDR_RANDOM), which also covers gmac0/eth0 —
   its dts node carries neither `mac-address` nor `nvmem-cells`, so stmmac
   falls back to a random address. Ports with a real MAC are skipped.
   The SoC OTP CPUID was considered as a deeper root of identity but has no
   dts node in our tree and no hardware validation; not implemented.

Work checklist:

- [x] Part 1: replace `board/cx3576/rootfs/` with `def/rootfs/`
- [x] Part 1: adapt the `rootfs` make target (build contexts) and keep the
      arm64 platform pin
- [x] Part 1: translate the overlay README to English, refresh board README
- [x] Part 2: `hwinit-mac` + `mos-mac.service` (CID-derived MAC)
- [x] Part 2: CAN 250000 + `fd off`
- [x] Part 2: BT `speed=` conf key, `aic8800_btlpm` module
- [x] Part 2: USB OTG default `otg`, gadget console + `serial-getty@ttyGS0`
- [x] Part 2: build-time CJK guard in the pack stage
- [x] Part 2: verify-image assertions for everything above
- [x] Docs finalize

Acceptance:

- `make cx3576-rootfs` produces an arm64 Alpine rootfs image from the replaced
  tree.
- `make os-image-cx3576` + `make os-verify-cx3576` green with the new
  assertions.
- On-device behaviour (can0 at 250 kbit/s, hci0, ttyGS0 on a host PC, stable
  MACs across reflash) is the user's hardware acceptance — never claimed done
  by agents.

## ActiveForm

Adopting the verified Alpine rootfs and porting its board facts to os/rootfs.

## Dependencies

- **blocked by**: RFCT-011 (hwinit layer this extends)
- **blocks**: -

## Not ported (and why)

- **rootfs growth** (`resize-rootfs`): systemd-repart + `x-systemd.growfs`
  already cover it natively and are boot-safe.
- **Bluetooth adapter name** (`bluetoothd-hostname` wrapper): bluez loads the
  hostname plugin by default and it overrides `Name`, so the adapter already
  follows the system hostname. Covered by an assertion, not by code.
- **`securetty` / `inittab` / gettys**: systemd's getty-generator derives the
  console getty from the kernel `console=` parameter.
- **Static `/etc/resolv.conf`**: the systemd base uses systemd-resolved's
  stub resolver.
- **`rs485-pair-test`**: a bench tool, not a runtime feature. It stays in the
  Alpine demo overlay; adding 200 lines of test script to the appliance rootfs
  would violate the package/size allowlist.
- **`wpa_supplicant` / wlan0**: PLAN-010 M5.
- **docker + `daemon.json`**: superseded by the balena-engine decision,
  PLAN-010 M6.

## Verification (2026-08-18)

- `BUILDX_BUILDER=mos-arm64 make cx3576-rootfs` — PASS. The replaced tree
  builds an aarch64 Alpine rootfs (541 MB image); the Dockerfile's own
  assertions (runlevel links, `ifquery` on can0, the `bluetoothd-hostname`
  dry run, the CJK scan) all hold. `/bin/busybox` in the artifact is
  `ELF 64-bit LSB pie executable, ARM aarch64`, confirming the restored
  `--platform=linux/arm64` pin.
- `make os-image-cx3576` — PASS. Installed size 212 MB (budget 400 MB, was
  204 MB before this task); assembled image 372 MiB, unchanged: the new units,
  scripts, conf files and udev rule add well under 1 MiB.
- `make os-verify-cx3576` — PASS (88/88 checks; RFCT-011 baseline was 71).
  The 17 new checks cover the two new units and their confs, the CAN 250000 /
  `fd=off` facts, the AIC8800D80 BT attach parameters, `aic8800_btlpm`,
  `mode=otg`, the CID MAC seed, the gadget getty udev rule, and the bluez
  `Name` / `bluetooth.service` assertions.
- `bash mosd/hack/check.sh` — PASS (no Rust changes in this task; gate kept
  green).

Pending user hardware acceptance: can0 UP at 250 kbit/s with FD off; hci0
present via the H:4 attach; `ttyGS0` login prompt on a host PC plugged into
the OTG port; eth0/eth1 MACs stable across a reflash.
