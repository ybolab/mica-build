# 20260910-0047-cx3576-hdmi-fullscreen-logo Show one centered CX3576 HDMI logo without a cursor

- **status**: completed
- **createdAt**: 2026-09-10 00:47
- **approvedAt**: 2026-09-10 00:51
- **relatedTask**: 20260910-0044-cx3576-hdmi-fullscreen-logo

## Context


The supplied CX3576 screenshot shows two copies of the board artwork at the top
of an otherwise black screen, with a text cursor below them. The user clarified that one centered logo is sufficient; duplicate logos and
a visible text cursor are forbidden. Existing development-stage display behavior requires no compatibility.

Three concrete causes are present:

1. `boards/cx3576/board.env` requests
   `fbcon=logo-pos:center,logo-count:1`, but the board kernel sets
   `CONFIG_CMDLINE_FORCE=y`. Both its source configuration and the exported
   `_out/cx3576/components/kernel/config` force a serial-only command line with
   no display arguments. `build/src/kernel-package.ts` independently requires
   that exact command line through `CX3576_CMDLINE`. The historical boot log
   `_out/cx3576/image/a.txt:167` confirms the same effective arguments; it does
   not establish the screenshot's exact image identity or display resolution.
2. `boards/cx3576/bsp/kernel/Dockerfile` converts the 1920x1080 master PNG into a
   720x405 indexed kernel logo. The pinned renderer does not scale it. Its default
   count is the number of online CPUs, limited by available width. At 1920 pixels,
   two copies fit at x=0 and x=728, matching the reported arrangement. Restoring
   centering alone would still leave a small image.
3. VT defaults to a visible underline cursor. Disabling `getty@tty1` prevents a
   login process, but does not hide the kernel console cursor.

Pinned source inspected at
`armbian/linux-rockchip@c6157104418d012823413c02f9222f3fe123dd25`:

- [fbmem.c](https://github.com/armbian/linux-rockchip/blob/c6157104418d012823413c02f9222f3fe123dd25/drivers/video/fbdev/core/fbmem.c):
  copy count, image dimensions, palette setup, and framebuffer drawing.
- [fbcon.c](https://github.com/armbian/linux-rockchip/blob/c6157104418d012823413c02f9222f3fe123dd25/drivers/video/fbdev/core/fbcon.c):
  logo options, reserved console rows, cursor work, and redraw after logo display.
- [vt.c](https://github.com/armbian/linux-rockchip/blob/c6157104418d012823413c02f9222f3fe123dd25/drivers/tty/vt/vt.c):
  `global_cursor_default` controls initial cursor visibility.
- [logo.c](https://github.com/armbian/linux-rockchip/blob/c6157104418d012823413c02f9222f3fe123dd25/drivers/video/logo/logo.c):
  `fb_find_logo` refuses access after late initialization. The generated bitmap
  and palette are init-only data. Existing display documentation therefore
  overstates late hotplug support: creating fbdev later does not by itself make
  the freed artwork available.

## Proposal

1. Add `fbcon=logo-pos:center,logo-count:1 vt.global_cursor_default=0` to the
   forced kernel command line and the authenticated packaging expectation.
   Align the board.env declaration with this effective policy. Keep the serial
   console, signed-boot arguments, existing artwork, and renderer.
   Verification: RED/GREEN regressions assert the effective display policy and
   agreement between kernel configuration, packaging, and board declaration.
2. Rebuild the board kernel and inspect its resolved configuration. Verify the
   options against the pinned fbcon and VT implementations. Run the relevant
   build suite and typecheck, then review the scoped diff with pma-cr.
   Verification: one logo with centered coordinates and hidden initial cursor;
   stale/mismatched command policy is rejected by packaging.
3. Package the changed signed kernel and a candidate image where available inputs
   permit, retaining the existing signed root and firmware. Update the task and
   changelog with artifact identities and checks. Physical HDMI appearance requires
   board acceptance and must not be represented as proven by host tests.

## Risks

The board kernel forces its embedded arguments, so changing board.env alone has
no effect. Packaging requires exact agreement with the kernel policy. The source
and built artifact must both be checked before delivery.

## Scope

Board kernel command line, board.env display declaration, authenticated kernel
packaging policy, and focused regressions. The user-approved centered result uses
the existing 720x405 artwork and native fbcon behavior. Fullscreen scaling and
logo lifetime/hotplug changes from the original draft are outside this reduced
repair. No compatibility branch, kernel renderer patch, or new service is needed.

## Alternatives

Fullscreen scaling adds kernel rendering and logo-lifetime work that the clarified
request no longer requires. Merely disabling getty leaves the VT cursor visible.

## Annotations

- User accepts centered display and requires one logo with no cursor.
- This clarification approves the smaller implementation; no second approval is
  required. Record IDs remain stable although their titles and scope changed.
- Source inspection established the existing late-hotplug limitation, which is
  recorded separately from this connected-display repair.

## Result

Implemented the three command-line updates and four regression checks. The full
build suite (388 tests), kernel build, signed FIT verification, all 123 offline
image checks, flash geometry and image checksum passed. The related task records
the candidate image and its checksum. Physical HDMI verification remains untested.
