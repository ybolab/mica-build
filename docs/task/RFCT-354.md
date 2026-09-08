# RFCT-354 cx3576 boot logo on HDMI, with the console recoverable on demand

- **status**: in-progress
- **priority**: P1
- **owner**: bkd/p6mvvj35
- **createdAt**: 2026-09-08 03:40
- **relatedPlans**: PLAN-088

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

HDMI on cx3576 shows a login prompt. Measured on the assembled image, the
chain that puts it there is four facts and no decision:

- U-Boot drives no display, so HDMI is dark until the kernel probes DRM;
- `# CONFIG_LOGO is not set` in the resolved kernel config, so nothing is drawn
  when it does;
- `CONFIG_FRAMEBUFFER_CONSOLE=y` with deferred takeover off, so fbcon paints the
  VT the moment the Rockchip DRM fbdev appears;
- `90-systemd.preset:18` says `enable getty@.service`, and `getty@.service`
  declares `DefaultInstance=tty1`, so the packed root carries
  `etc/systemd/system/getty.target.wants/getty@tty1.service`.

The product has no GUI. A login prompt is the wrong thing to show, and a logo
that permanently owned the display would be worse: HDMI is the only diagnostic
path on a unit with no serial cable attached.

Two halves, and the second is the requirement rather than the nicety:

- **The logo.** A boot logo instead of a text console.
- **The console.** HDMI keeps receiving kernel messages, an oops or panic takes
  the screen, and `systemctl start getty@tty1` turns it into a login terminal at
  runtime with no second boot path and no rebuild.

PLAN-088 carries the route decision, the evidence for it, and the two places
where the dispatched design was measured to be wrong.

## ActiveForm

Enabling the kernel logo, keeping HDMI on the console list behind serial, and
disabling the tty1 getty by preset rather than by absence
