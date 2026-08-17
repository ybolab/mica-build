# Design: Local Display (HDMI Kiosk UI)

> English | [中文](display.zh.md)
>
> A dedicated product UI on the HDMI output — status panel, setup wizard,
> and application UI on an attached screen, with optional touch/USB input.

## 1. Principle: one UI codebase

The local display renders **the same webd UI** that remote browsers use, in a
kiosk session pointed at `https://127.0.0.1`. No second UI stack to maintain;
every webd feature (wizard, status, updates) is automatically available on the
screen. Local-only affordances (e.g. auto-showing the setup wizard when
unprovisioned) are webd routes selected by the kiosk, not separate code.

## 2. Component stack

```
webd (existing HTTPS UI)
  ▲ localhost
kiosk session: cage (Wayland kiosk compositor) + WPE WebKit browser
  ▲ DRM/KMS + GPU driver          ▲ libinput (touch / USB kb+mouse)
board graphics stack (BSP: kernel DRM + HDMI + GPU driver/firmware)
```

- **`kiosk` system extension**: cage + WPE WebKit (+ mesa/GPU userland). Heavy
  C stack, therefore an extension per image profile — headless deployments
  simply omit it; base rootfs is untouched. Runs as an extension service under
  machined supervision.
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
  url: ""                  # empty = webd local UI; settable for custom app UIs
  rotation: 0              # 0|90|180|270
  blankAfter: 10m          # screen blanking; 0 = never
  showWizardWhenUnprovisioned: true
```

`DisplayConfig` → controller → `DisplayStatus` resource → kiosk extension
service start/stop/restart, no reboot. `url` allows a product build to point
the screen at an application UI (served by an app container) instead of webd.

## 4. Boot experience & tty policy

- Boot splash: U-Boot shows the board splash (assets exist in board dirs),
  kernel keeps `quiet` fbcon off the HDMI in prod; kiosk takes DRM master when
  the service starts. Target: no text ever flashes on a customer screen.
- Upstream Talos dashboard stays disabled (`talos.dashboard.disabled`,
  PLAN-007 decision) — kiosk replaces it as the local presence.
- Console channels (access.md): wizard tty2 / debug shell tty3 live on
  **serial**; VT switching from the kiosk is disabled in prod images.
- Kiosk crash policy: restart with backoff; after N failures fall back to a
  static "service unavailable + support URL" DRM splash rather than a console.

## 5. Board requirements (extends boards.md §4)

Boards advertising `display` in `board.yaml features` must provide:

- kernel: DRM/KMS `=y` for the SoC display pipe + HDMI encoder; GPU driver
  (cx3576/RK3576: Mali via mainline panfrost, or the vendor blob driver as
  fallback — decided during board bring-up); `CONFIG_DRM_FBDEV_EMULATION`
  already asserted.
- GPU firmware/userland into the kiosk extension (not base rootfs).
- `board.yaml` gains a `display:` section (output, default rotation) consumed
  by DisplayConfig defaults.

## 6. Security notes

- The kiosk browser is a large attack surface rendering only localhost by
  default; a non-webd `url` is an explicit config decision and is recorded in
  the audit log.
- Kiosk session runs unprivileged (no shell in its container, no VT access);
  compromise of the browser yields the same position as an unauthenticated
  LAN client of webd.
- Physical HDMI/USB access already implies the physical-access tier of the
  threat model (access.md §2 rescue/factory rows); kiosk does not weaken it.

## 7. Phasing

| Phase | Scope |
|---|---|
| 1 | kiosk extension (cage+WPE), DisplayConfig/controller, webd local wizard route, splash-to-kiosk handoff on cx3576 |
| 2 | touch input polish, rotation, blanking, crash-splash |
| 3 | custom app `url` mode + per-app UI containers (ties into workload/secondary-ECU design) |

Campaign mapping: phase 1 joins the access-layer/webd campaign after cx3576
display bring-up (GPU driver decision happens in the board campaign).
