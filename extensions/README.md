# extensions

Historical placeholder. This directory was reserved for Talos system
extensions (connectivity, rescue), but PLAN-010 retired the Talos base in
favor of systemd + mosd with RAUC A/B updates, and the Talos system-extension
format went with it. Nothing is built from here today.

Where the planned contents actually went:

- `connectivity/` (wpa_supplicant + hostapd for connd, PLAN-008) — now plain
  rootfs packages driven by mosd reconcilers (`wifi.client` / `wifi.ap`); see
  PLAN-010 M5 and `docs/design/connd.md`.
- `rescue/` (busybox + diagnostics behind `talos.rescue`) — superseded by the
  U-Boot RockUSB recovery/rescue paths and the PLAN-006 Part D rescue design;
  see `docs/design/uboot-ab-handshake.md`.

The systemd-native analog is sysext (see PLAN-010's architecture diagram). If
the v2 image ever ships optional layers as sysext images, they would live
here; until then this README is the directory's only content.
