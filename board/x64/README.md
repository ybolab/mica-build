# board/x64 — generic x86_64 platform

QEMU/CI baseline placeholder. Unlike SoC boards, it has no BSP build at all:
no vendor kernel tree and no bootloader port — a UEFI machine boots via
firmware (systemd-boot/GRUB), so there is nothing for a board directory to
compile. The v2 pipeline (systemd base + mosd, RAUC A/B — PLAN-010) currently
builds images for `cx3576` only; this board exists so that when it grows an
x86_64 target it can:

- run the appliance image in QEMU/KVM for CI and development (fast feedback,
  no hardware);
- target generic PC / NUC / server deployments.

Anything that works here but breaks on `cx3576` is board-specific by
definition — keep this platform green as the baseline.
