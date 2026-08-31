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

- Boot splash: U-Boot shows the board splash (cx3576's master is
  `os/boards/cx3576/bsp/rootfs/assets/splash.png`), kernel keeps `quiet` fbcon off the
  HDMI in prod; kiosk takes DRM master when the service starts. Target: no text
  ever flashes on a customer screen.
  - The master is a **source asset with no consumer yet**: no build step reads
    it, and U-Boot's splash path wants BMP, so the conversion belongs to phase 1
    below. It is a 76 KB PNG, 1920x1080 at 16 bits per channel.
- Console channels (access.md): wizard tty2 / debug shell tty3 live on
  **serial**; VT switching from the kiosk is disabled in prod images.
- Kiosk crash policy: restart with backoff; after N failures fall back to a
  static "service unavailable + support URL" DRM splash rather than a console.

## 5. Board requirements (extends boards.md §4)

`os/boards/<board>/board.env` carries no display capability key, so no board
advertises the feature today. A board whose product has an HDMI output must
provide:

- kernel: DRM/KMS `=y` for the SoC display pipe + HDMI encoder; GPU driver
  (cx3576/RK3576: Mali via mainline panfrost, or the vendor blob driver as
  fallback — decided during board bring-up); `CONFIG_DRM_FBDEV_EMULATION`
  already asserted.
- GPU userland (mesa) into the mos-gui container image; kernel DRM and GPU
  firmware stay with the board (kernel + board package).
- Output and default rotation, which are a comment in the board definition and
  not yet a key: "Display defaults, recorded rather than declared: the output is
  hdmi and the default rotation is 0"
  (`os/boards/cx3576/board.env`). DisplayConfig therefore has no
  board-supplied default, and gains one when a key does.

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
