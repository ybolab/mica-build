# RFCT-011 Minimal image sizing + board hardware init (cx3576)

- **status**: completed — implementation complete, pending user hardware acceptance
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-18 01:59
- **claimedAt**: 2026-08-18 01:59
- **completedAt**: -

## Description

Three user continuations delivered alongside PLAN-010 M3: shrink the assembled
image to content-derived sizes, and add a board hardware-init layer for the
cx3576 peripherals (WiFi/OTG/CAN/BT).

Scope / deliverables:

1. Minimal rootfs sizing (32fa7c1): pack the rootfs ext4 at
   `ceil(du*115/100)+48 MiB` instead of a fixed size, with `mke2fs -b 4096`
   pinned (within 3197b78); verify assertions: `e2fsck -fn` clean and
   free space >= 32 MiB floor. The repart/growfs first-boot contract is
   unchanged.
2. Content-derived boot partition (c5bd469): boot partition sized at
   `align4(max(64, payload+16))` MiB — the 64 MiB floor matches the M4
   BOOT-A/B slots (PLAN-006) — with GPT-derived verify assertions.
3. Board hardware-init layer (3197b78): generic oneshot units in `os/hwinit/`
   with board facts split into NEW `board/cx3576/init/` conf files —
   - `mos-modules`: `modprobe -q` dual-SKU WiFi, replacing
     `/etc/modules-load.d`;
   - `mos-otg`: syscon USB role switch with `/etc/mos/otg-mode` override;
   - `mos-can`: bitrate 500000, restart-ms 100;
   - `mos-bt` (Type=simple): rfkill unblock + btattach. BT uart is
     `/dev/ttyS4` (vendor dtb wireless-bluetooth node, alias serial4 =
     2ad70000); patchram symlink `brcm/BCM4362A2.hcd -> ../SYN43756B0.hcd` is
     a candidate pending hardware confirm (fallbacks: `btattach -S 1500000` or
     an alternate hcd name — conf-only changes on device).
   - bluez + rfkill add ~11 MB to the rootfs.

Work checklist:

- [x] Content-derived rootfs pack size + fsck/free-space verify assertions
- [x] Content-derived boot partition size + GPT verify assertions
- [x] Hardware-init oneshots (`os/hwinit/`) + `board/cx3576/init/` confs
- [x] Docs finalize

Acceptance:

- `make os-image-cx3576` + `make os-verify-cx3576` green with the sizing and
  hwinit checks included.
- On-device peripheral bring-up (wlan0/can0/hci0) is the user's hardware
  acceptance — out of scope here; never claimed done by agents.

## Verification (2026-08-18)

Final verification on integration branch head `fbf20dd`:

- `make os-image-cx3576` + `make os-verify-cx3576` — RESULT: PASS (70/70
  checks; M2 baseline was 47): +11 hwinit checks, sizing/boot assertions
  rederived from content, +5 webd checks (RFCT-010).
- Assembled image 457179136 bytes (~427 MiB, was 1554 MiB): boot partition at
  the 128 MiB floor (payload 43 MiB), content-derived rootfs ~282 MiB packed
  from ~204 MB installed (TOTAL_MB 204 of the 400 budget), 16 MiB pre-boot +
  1 MiB slack; byte-identical across cache-hot rebuilds.
- `bash mosd/hack/check.sh` green on the same head (no Rust changes in this
  task, gate kept green).
- Boot floor lowered afterwards from 128 to 64 MiB with 4 MiB alignment (the
  43 MiB payload never needed 128, and M4 reserves 64 MiB BOOT-A/B slots):
  boot partition 64 MiB, image 390070272 bytes (372 MiB), verify 71/71.
- Pending user hardware acceptance: wlan0 exists (either WiFi SKU); can0 UP at
  bitrate 500000; hci0 present after boot.

## ActiveForm

Shrinking the cx3576 image and adding the board hardware-init layer.

## Dependencies

- **blocked by**: RFCT-008 (M1 image pipeline)
- **blocks**: -
