# Design: Configuration Without a Network (Provisioning Model)

> English | [中文](provisioning.zh.md)
>
> How the appliance obtains and changes its machine configuration when no
> network can be assumed. Approved 2026-08-17. Companion to access.md §7 and
> connd (PLAN-008 Part D).

## 1. The break from upstream

Upstream Talos metal boots without config into maintenance mode and waits for
config over the network — a data-center assumption. A mos appliance must reach
a fully working state with zero external input. Three layers:

## 2. Layer 1 — first-boot self-provisioning (the product behavior)

When STATE holds no configuration, machined (TypeAppliance) generates its own:

- default config: DHCP on all ethernet, webd enabled, apid/SSH disabled,
  hostname `mos-<serial-suffix>`;
- **fresh per-device PKI**, generated on the device at first boot — fleet-wide
  shared secrets baked into images are forbidden;
- result persisted to STATE; factory reset (STATE wipe) naturally returns the
  device to this state.

Owner: access-layer campaign (it is one feature with webd first-run setup and
the default-password scheme).

## 3. Layer 2 — local configuration channels

All channels ultimately write config documents through the machined API — one
trust path, ordered by preference (details in access.md §7):

1. BOOT-partition provisioning file (offline pre-seed at factory or field);
2. USB signed config drop (udev-triggered, vendor-key verified);
3. AP captive portal (connd, PLAN-008) and HDMI kiosk wizard (display.md);
4. webd over LAN once any network exists;
5. tty2 serial wizard as the last resort.

## 4. Layer 3 — bring-up interim (dev images only)

Until Layer 1 exists, cx3576 dev images embed a static machine config via the
imager's embedded-config mechanism (rootfs `/usr/local/etc/talos/`, loaded by
config.AcquireController):

- lives at `talos/hack/cx3576/dev-config/config.yaml`, gated by
  `BSP_VARIANT=cx3576`;
- carries a committed throwaway CA — acceptable ONLY because these are dev
  images; the file is marked DO NOT SHIP;
- retirement criterion: deleted in the same campaign that delivers Layer 1.
  Production image profiles must assert the embedded config directory is
  absent (CI check).

## 5. Security invariants

- No fleet-shared credentials or keys in any shipped image (Layer 3 is the
  explicit, dev-only exception).
- Provisioning channels never bypass config validation or the audit log.
- Wiping STATE resets configuration but never clears META lockdown
  (access.md §5).
