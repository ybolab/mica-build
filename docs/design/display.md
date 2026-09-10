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

The current CX3576 image shows **YBO - Hub OS**, centered in white over a soft
blue/teal gradient that fades to black around the text. The authoritative bitmap
is `boards/cx3576/bsp/rootfs/assets/splash.png`. The kernel build converts it to
a deterministic 720×405 CLUT224 logo, fitting modes from 800×600 upward. Its
black edges blend into the framebuffer around the centered image.

U-Boot does not initialize RK3576 HDMI. Linux DRM/fbcon displays one centered
logo using `fbcon=logo-pos:center,logo-count:1`; `vt.global_cursor_default=0`
hides the idle cursor. The forced signed command line routes kernel and service
output to `ttyFIQ0` at 1500000 baud. It has neither `quiet` nor `console=tty1`;
the latter would let kernel messages overwrite the HDMI artwork.

Connect a USB keyboard and press **Alt+F2** (Ctrl+Alt+F2 also works) to select
`tty2`. The board's logind policy sets `NAutoVTs=0` and `ReserveVT=2`, reserving
only this VT for an on-demand getty. The ordinary getty/login/PAM path still
requires authentication. Set a transient root password in the management UI's
access controls, then log in as `root`; the browser administrator password is a
different credential. The default root account is locked, and the transient
password is cleared at the next boot, as described in the [access policy](access.md).
No auto-login or shell bypass is introduced. The disabled getty preset keeps `tty1` idle during normal startup,
but does not prevent logind from starting the reserved console. Bare F2 keeps
its normal terminal meaning.

Alt+F1 selects tty1 again, but the kernel does not retain the boot logo for
redrawing after a VT switch: fbcon clears its logo state, and logo memory is
freed after initialization. Late HDMI attachment can create the framebuffer,
but cannot reliably recover this init-only bitmap either. Restoring the logo
on VT return or late attachment remains task 20260910-0117-cx3576-late-hdmi-logo.
The image does not ship a userspace splash renderer or a kiosk service.

The console policy is covered by signed QEMU acceptance; actual CX3576 USB
keyboard, EDID negotiation and visual output require testing the flashed image.

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
