# extensions

Talos system extensions shipped per board/image profile. Planned (see docs/plan):

- `connectivity/` — wpa_supplicant + hostapd (+ bluez, phase 3) for the connd
  service (PLAN-008). Included only on boards with wireless hardware.
- `rescue/` — busybox + filesystem/diagnostic tools backing the `talos.rescue`
  boot path.

Each extension builds with buildkit into the Talos system-extension image
format; none of them modify the base rootfs.
