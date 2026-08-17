# board/x64 — generic x86_64 platform

The reference/development platform. Unlike SoC boards, it has no BSP build at
all: kernel, modules, and bootloader come from the upstream Talos build in
`talos/` (UEFI, systemd-boot/GRUB, A/B handled by the upstream dual-boot
mechanisms). This board exists to:

- run the appliance image in QEMU/KVM for CI and development (fast feedback,
  no hardware);
- target generic PC / NUC / server deployments.

Anything that works here but breaks on `cx3576` is board-specific by
definition — keep this platform green as the baseline.
