# Design: Local Display (HDMI Kiosk UI)

> English | [中文](../zh/design/display.md)
>
> A dedicated product UI on the HDMI output — status panel, setup wizard,
> and application UI on an attached screen, with optional touch/USB input.

## 1. Principle: one UI codebase

The local display renders **the same apid UI** that remote browsers use, in a
kiosk session pointed at `https://127.0.0.1`. No second UI stack to maintain;
every apid feature (wizard, status, updates) is automatically available on the
screen. Local-only affordances (e.g. auto-showing the setup wizard when
unprovisioned) are apid routes selected by the kiosk, not separate code.

## 2. Component stack

```
apid (existing HTTPS UI)
  ▲ localhost
kiosk session: cage (Wayland kiosk compositor) + WPE WebKit browser
  ▲ DRM/KMS + GPU driver          ▲ libinput (touch / USB kb+mouse)
board graphics stack (BSP: kernel DRM + HDMI + GPU driver/firmware)
```

- **`mos-gui` container**: cog (WPE WebKit) holding DRM/KMS directly through
  GBM — no X, no Wayland, no compositor. The whole display layer (container
  image, systemd/Quadlet orchestration, HDMI probing) lives in its own
  repository, `bkhq/mos-gui` on git.ds.cc; the base image only runs it
  through the podman/Quadlet machinery it already ships. Headless
  deployments simply do not deploy the container. Its one interface to the
  page is a URL. (Two earlier delivery ideas are retired: a sysext layer,
  and host packages — the container needs no second mechanism.) Runs as a systemd unit, like every other
  service on the device.
- WPE WebKit is the embedded-first choice (smaller than Chromium, upstream
  WPE/cage pairing is standard kiosk practice). Chromium `--kiosk` is the
  fallback if a needed web feature is missing.
- A native LVGL/Flutter path is deliberately NOT planned unless a GPU-less
  board appears; it would be a second UI codebase.

## 3. Configuration

```yaml
apiVersion: v1alpha1
kind: DisplayConfig
kiosk:
  enabled: true
  url: ""                  # empty = apid local UI; settable for custom app UIs
  rotation: 0              # 0|90|180|270
  blankAfter: 10m          # screen blanking; 0 = never
  showWizardWhenUnprovisioned: true
```

`DisplayConfig` → controller → `DisplayStatus` resource → mos-gui container
service start/stop/restart, no reboot. `url` allows a product build to point
the screen at an application UI (served by an app container) instead of apid.

## 4. Boot experience & tty policy

Implemented on cx3576 by PLAN-088. This section was rewritten against what the
pinned sources actually do; three of its earlier claims were measured wrong and
are corrected below rather than deleted, because each is the reading a person
arrives at from the outside.

- **The logo is the KERNEL's, not U-Boot's.** `CONFIG_LOGO` +
  `CONFIG_LOGO_LINUX_CLUT224`, with the board's own 224-colour PPM derived at
  build time from `boards/cx3576/bsp/rootfs/assets/splash.png` — which is no
  longer a source asset with no consumer. **U-Boot shows nothing**, and this is
  not a scheduling decision: the pinned tree is upstream u-boot at `ece349ade`,
  whose Rockchip video drivers are the VOP1-era RK3288/RK3328/RK3399 set. There
  is no VOP2 driver and no RK3576 display support anywhere in it, so
  `SPLASH_SCREEN` there would build a video core nothing can bind. HDMI is
  therefore **dark from reset until DRM probes**, and a seamless power-on splash
  is blocked on the U-Boot fork question. PLAN-088 §1 carries the evidence and
  prices the alternative.
- **`quiet` is NOT used, and must not be.** fbcon draws the logo only when
  `console_loglevel` exceeds `CONFIG_CONSOLE_LOGLEVEL_QUIET`, which this kernel
  sets to 4 (`fbcon.c:1009-1010`) — so `quiet`, which sets exactly 4, keeps text
  off the screen by keeping the **logo** off it too. The board boots
  `loglevel=5`: the floor that shows a logo, quiet enough that a healthy boot
  prints only warnings and worse, and non-zero so `console_verbose()` still
  raises the level on an oops. `loglevel=0` would make a panic invisible on
  every console including serial, and is refused by the image contract.
- **HDMI stays on the console list, deliberately.** The command line is
  `console=tty1 console=ttyFIQ0,1500000`, and **the order is the design**:
  every `console=` receives printk but `/dev/console` is the last one, so
  userspace output stays on the cable while a kernel panic still takes the
  screen. On a unit with no serial cable attached that is the only diagnostic
  path there is.
- **`getty@tty1` is disabled by a preset**, `50-mos-getty.preset` in
  `mos-board-cx3576`, not by an absent symlink — an unmatched unit presets to
  ENABLE, and `90-systemd.preset` says `enable getty@.service`. It remains
  startable: `systemctl start getty@tty1` turns the display into a login
  terminal at runtime, with no second boot path and no rebuild.
- **No plymouth and no userspace splash.** The kiosk takes DRM master when
  `mos-gui` starts; nothing else paints.
- Console channels (access.md): wizard tty2 / debug shell tty3 live on
  **serial**; VT switching from the kiosk is disabled in prod images.
- Kiosk crash policy: restart with backoff; after N failures fall back to a
  static "service unavailable + support URL" DRM splash rather than a console.

## 5. Board requirements (extends boards.md §4)

`boards/<board>/board.env` carries `BOARD_HAS_DISPLAY` (`0` or `1`), added by
PLAN-088; cx3576 declares `1` and the QEMU boards declare `0`. It gates the boot
experience above, not the kiosk. A board whose product has an HDMI output must
provide:

- kernel: DRM/KMS `=y` for the SoC display pipe + HDMI encoder; GPU driver
  (cx3576/RK3576: Mali via mainline panfrost, or the vendor blob driver as
  fallback — decided during board bring-up); `CONFIG_DRM_FBDEV_EMULATION`
  already asserted.
- GPU userland (mesa) into the mos-gui container image; kernel DRM and GPU
  firmware stay with the board (kernel + board package).
- Output and default rotation, which are still a comment in the board
  definition and not yet keys: "Display defaults, recorded rather than declared:
  the output is hdmi and the default rotation is 0"
  (`boards/cx3576/board.env`). `BOARD_HAS_DISPLAY` says whether there is a
  screen, not what it is, so DisplayConfig still has no board-supplied default
  and gains one when those become keys.

## 6. Security notes

- The kiosk browser is a large attack surface rendering only localhost by
  default; a non-apid `url` is an explicit config decision and is recorded in
  the audit log.
- Kiosk session runs unprivileged (no shell in its container, no VT access);
  compromise of the browser yields the same position as an unauthenticated
  LAN client of apid.
- Physical HDMI/USB access already implies the physical-access tier of the
  threat model (access.md §2 rescue/factory rows); kiosk does not weaken it.

## 7. Phasing

| Phase | Scope |
|---|---|
| 1 | mos-gui container (cog/WPE), DisplayConfig/controller, apid local wizard route, splash-to-kiosk handoff on cx3576 |
| 2 | touch input polish, rotation, blanking, crash-splash |
| 3 | custom app `url` mode + per-app UI containers (ties into workload/secondary-ECU design) |

Campaign mapping: phase 1 joins the access-layer campaign after cx3576
display bring-up (GPU driver decision happens in the board campaign).
