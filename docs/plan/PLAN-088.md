# PLAN-088 cx3576 HDMI boot logo, with the console recoverable on demand

- **status**: completed
- **createdAt**: 2026-09-08 03:40
- **approvedAt**: 2026-09-08 03:40
- **relatedTask**: RFCT-354

## Context

HDMI on cx3576 shows a login prompt. The task is to show a boot logo instead,
without turning the display into dead weight: on a unit with no serial cable
attached, HDMI is the only diagnostic path there is.

The dispatch proposed a primary route (a U-Boot splash handed over to the
kernel) and a fallback (the kernel's own logo), and asked for the vendor source
to be read rather than assumed. It was, and the reading changed three of the
decisions. This plan records what was measured, which route survived, and what
the rejected one would have cost.

## 1. The rejected route: U-Boot splash with seamless handover

**Rejected, and not on grounds of cost. The pinned U-Boot cannot drive this
SoC's display at all.**

`boards/cx3576/bsp/uboot/Dockerfile:70-71` pins **upstream** U-Boot —
`https://github.com/u-boot/u-boot.git` at `ece349ade2973e220f524ce59e59711cc919263f`
— not Rockchip's vendor fork. In that tree:

| Where | What is there |
|---|---|
| `drivers/video/rockchip/` | `rk3288_vop.c`, `rk3328_vop.c`, `rk3399_vop.c`, `rk3288_hdmi.c`, `rk3328_hdmi.c`, `rk3399_hdmi.c`, `rk_edp.c`, `rk_lvds.c`, `rk_mipi.c` |
| `drivers/video/rockchip/Kconfig` | *"This driver supports the on-chip video output device, and targets the Rockchip RK3288 and RK3399."* |
| `arch/arm/mach-rockchip/rk3576/` | `boot0.h`, `clk_rk3576.c`, `rk3576.c`, `syscon_rk3576.c`, `gpio.h` — no display |
| whole tree, `vop2` | `dts/upstream/Bindings/display/rockchip/rockchip-vop2.yaml` and `dts/upstream/include/dt-bindings/soc/rockchip,vop2.h` — DT metadata, **no driver** |
| `configs/generic-rk3576_defconfig` | the config this tree builds (`BOARD=generic-rk3576`): no `VIDEO`, no `DM_VIDEO`, no display of any kind |

The tree listing is the complete recursive tree at that commit, and the API
reported `"truncated": false`, so "no VOP2 driver" is an exhaustive answer
rather than a failed grep.

RK3576 drives its display through **VOP2** and an **HDMI 2.1 QP** PHY. Upstream
U-Boot has neither. Enabling `DM_VIDEO`, `SPLASH_SCREEN` and `CMD_BMP` would
compile the video core and the BMP decoder into a bigger U-Boot with **no driver
that can bind to this SoC's display controller** — no framebuffer, no output,
and `drm-logo@0` still arriving at `base 0, size 0`. It would be a config change
that looks like the feature and is not.

**The kernel half of the handover does exist**, which is worth recording because
it is what makes the route sound in principle. `armbian/linux-rockchip` at
`c6157104418d012823413c02f9222f3fe123dd25` ships
`drivers/gpu/drm/rockchip/rockchip_drm_logo.c`, and the adoption is DT-driven
exactly as predicted — no Kconfig symbol gates it:

- `rockchip_drm_logo.c:251-255` resolves the framebuffer through
  `memory-region-names` = `"drm-logo"` (falling back to a `logo-memory-region`
  phandle), and `:298-302` does the same for `"drm-cubic-lut"`;
- `:468-523` parses each `route` subnode — a `connect` phandle plus
  `video,clock`, `video,hdisplay`, `video,vdisplay`, `video,vrefresh` and the
  `post-csc,*` group — and builds a mode set from it.

So the kernel is ready to adopt a framebuffer that a bootloader filled in. On
this tree nothing fills it, which is precisely why `drm-logo@0` and
`drm-cubic-lut@0` arrive empty.

**What taking the route anyway would cost.** Not "HDMI PHY bring-up and a bigger
U-Boot" — that is the cost of *writing* the drivers. The realistic path is
switching U-Boot to `rockchip-linux/u-boot`, the vendor fork that already has
VOP2 and the RK3576 HDMI. That fork is a 2017-era U-Boot. This tree's entire A/B
handshake is built on upstream 2025 semantics — `bootstd`, `bootmeth order
script`, `bootflow scan -lb`, the `/bootstd` `bootdev-order` property that
`build-mos.sh:100` asserts, and the redundant environment pinned at
`ENV_OFFSET=0x1000000` / `ENV_OFFSET_REDUND=0x1100000` that
`docs/design/uboot-ab-handshake.md` specifies. None of it exists in that fork.
The price of the logo would be re-deriving the boot contract on a different
bootloader, and re-qualifying the update path that rides on it. That is not a
display change; it is a new bootloader campaign.

**Recorded as the standing answer**: a seamless power-on-to-DRM logo on cx3576
is blocked on the U-Boot fork question, not on display configuration. Nothing in
this plan makes it harder to revisit.

## 2. The route taken: the kernel's own logo

`CONFIG_LOGO=y` + `CONFIG_LOGO_LINUX_CLUT224=y`, with the board's own artwork
replacing the vendor tree's `logo_linux_clut224.ppm`.

**What it gives up, stated plainly.** It does not cover the window from power-on
to DRM probe: HDMI is dark from reset until the Rockchip DRM driver brings the
pipeline up and fbcon initialises on the emulated fbdev. There is no handover,
because there is nothing to hand over. Compared with a firmware splash the user
sees black for the first part of the boot and then a logo, rather than a logo
throughout. This is a real regression against the ideal and it is not
recoverable without §1's bootloader change.

It also constrains the artwork: 224 colours, drawn as one bitmap at its own
pixel size.

### 2.1 Three corrections the source forced

The dispatched design specified `quiet loglevel=0` and
`CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y`. All three were measured
against the pinned kernel and all three are wrong **for this route**. They are
right for the route in §1, which is where they came from — deferred takeover and
a silent console protect a framebuffer that *firmware* painted. With the
*kernel* drawing the logo, each one defeats it.

**(a) `quiet` suppresses the kernel logo.** `drivers/video/fbdev/core/fbcon.c:1009-1010`:

```c
	if (logo_shown < 0 && console_loglevel <= CONSOLE_LOGLEVEL_QUIET)
		logo_shown = FBCON_LOGO_DONTSHOW;
```

`quiet` sets `console_loglevel = CONSOLE_LOGLEVEL_QUIET` (`init/main.c:242-246`),
and the resolved config has `CONFIG_CONSOLE_LOGLEVEL_QUIET=4`. `4 <= 4` is true,
so the logo is never drawn. **Any** `console_loglevel` of 4 or less suppresses
it; the floor that shows a logo is 5.

**(b) `loglevel=0` blinds the panic path on every console, HDMI and serial
alike.** Two independent mechanisms, both in `kernel/printk/printk.c`:

```c
static bool suppress_message_printing(int level)          /* :1230 */
{
	return (level >= console_loglevel && !ignore_loglevel);
}

void console_verbose(void)                                 /* :2567 */
{
	if (console_loglevel && !printk_console_no_auto_verbose)
		console_loglevel = CONSOLE_LOGLEVEL_MOTORMOUTH;
}
```

At `console_loglevel == 0`, `KERN_EMERG` is level 0 and `0 >= 0` is true, so
even an emergency message is suppressed — and `console_verbose()`, the call that
oops and panic use to raise the level, is guarded by `if (console_loglevel)` and
does nothing at zero. The oops would be invisible everywhere. Upstream says so
at `init/main.c:255-258`: *"Only update loglevel value when a correct setting was
passed, to prevent blind crashes (when loglevel being set to 0) that are quite
hard to debug."*

**`loglevel=5` is the one value that satisfies both halves**, and it is chosen
because of the conjunction rather than in spite of it:

| | at `console_loglevel=5` |
|---|---|
| logo | drawn — `5 <= 4` is false, so `fbcon.c:1009` does not suppress it |
| healthy boot | `EMERG`/`ALERT`/`CRIT`/`ERR`/`WARNING` print; `NOTICE`, `INFO` and `DEBUG` are suppressed |
| oops / panic | `console_verbose()` sees a non-zero level and raises to `MOTORMOUTH` (15); the crash takes the screen |

And the logo survives the messages that do print: `fbcon_prepare_logo` sets
`vc->vc_top = logo_lines` (`fbcon.c:640`), so the scrolling region begins *below*
the logo. Warnings appear underneath it instead of erasing it.

**(c) `CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER` must stay off.** It is the
protection for a *handed-over* framebuffer, and there is none. Worse, it is
self-defeating here — the deferred path sets `logo_shown = FBCON_LOGO_DONTSHOW`
*before* registering the framebuffers (`fbcon.c:3338-3340`):

```c
static void fbcon_register_existing_fbs(struct work_struct *work)
{
	...
	deferred_takeover = false;
	logo_shown = FBCON_LOGO_DONTSHOW;
```

so with deferred takeover on, the kernel logo is never drawn at all. It is
already off in the resolved config; this plan pins that as a decision with a
reason attached rather than leaving it an accident, and the contract asserts it.

Nothing is lost by its absence. Deferred takeover was named as "the logo's
protection and the switch", but on this route the logo needs no protection (no
one else paints) and the switch is not needed either: HDMI reaches a console
because `console=tty1` puts it on the console list, and becomes a *terminal*
because the getty is startable. That is §2.2.

### 2.2 HDMI stays reachable as a console

**Console ordering, and it is load-bearing.** Every `console=` receives printk;
`/dev/console` — where init and systemd write — is the **last** one.
`__add_preferred_console` sets `preferred_console = i` on each parsed
`console=`, so the last assignment wins (`printk.c:2437-2468`). The board
therefore boots

```
console=tty1 console=ttyFIQ0,1500000
```

so HDMI receives kernel messages while `/dev/console` stays on serial. x64
already ships exactly this shape (`console=tty0 console=ttyS0,115200` in
`boards/x64/board.env`), so this is the tree's existing convention, not a new
one.

**The getty is disabled by a file, not by an absence.** It is enabled today by
`90-systemd.preset:18` (`enable getty@.service`) plus `DefaultInstance=tty1` in
`getty@.service`, which is what materialises
`etc/systemd/system/getty.target.wants/getty@tty1.service` in the packed root.
`mos-board-cx3576` ships `50-mos-getty.preset` with `disable getty@.service`;
`50-` sorts before `90-`, preset rules are read in basename order and the first
match wins, so the resolution is *disabled*. Same shape and same reason as the
`50-mos-ssh.preset` and `50-mos-nftables.preset` already in the image: an
unenabled unit is one `systemctl preset-all` away from being enabled, and that
is an absence rather than a decision.

`console=tty1` does not smuggle one back in. systemd 257.13's getty-generator
skips virtual consoles — *"We assume that gettys on virtual terminals are started
via manual configuration and do this magic only for non-VC terminals"*,
`getty-generator.c:259-263` — so it adds a unit for `ttyFIQ0` and none for
`tty1`.

A disabled unit is still startable, so the runtime affordance is
`systemctl start getty@tty1`, with no second boot path and no rebuild.

**No plymouth, no userspace splash.** PLAN-086 is removing ~95 MiB from this
root; a splash daemon spends it back. Nothing here adds a package.

### 2.3 The artwork

`boards/cx3576/bsp/rootfs/assets/splash.png` is the committed master — 1920x1080,
16 bits per channel — and until now it was *a source asset with no consumer*,
which `docs/design/display.md:63-66` records. It becomes the logo's source.

`boards/cx3576/bsp/kernel/logo/mklogo.py` converts it to the ASCII PPM that the
kernel's own `drivers/video/logo/pnmtologo.c` compiles, and
`kernel/Dockerfile` runs it and writes the result over
`drivers/video/logo/logo_linux_clut224.ppm`.

**Generated at build time, not committed.** A generated PPM beside the PNG would
be a second copy of the artwork that nothing forces to agree with the first, and
the two drift the moment one is edited. Deriving it means the question cannot be
asked. The generator is pure integer arithmetic — exact rational area-average
resampling, a median cut whose splits are decided by channel extent and
population, and a sorted palette — because it runs inside the reproducibility
boundary `kernel/Dockerfile`'s four pins establish. Measured twice, because
"deterministic" is a claim that is easy to make about one interpreter: two runs
on the same host agree byte for byte, and the host's Python 3.10.12 and the
builder image's Python 3.12.3 also produce the same 2,200,294 bytes
(`sha256:c3223bd3…`). The logo the kernel links is therefore a function of the
master and nothing else.

**Geometry: 720x405.** The constraint is not aesthetic. `fb_prepare_logo` drops
the logo entirely when its height exceeds the mode's `yres`
(`fbmem.c:650-653`), and `fb_show_logo_line` reduces the copy count to zero when
its width will not fit `xres` (`fbmem.c:513`). Both failures are a blank screen.
720x405 fits every mode from 800x600 upward, which covers 1280x720 and 1920x1080
and the common no-EDID fallbacks; a full-size 1920x1080 logo would vanish on any
monitor that negotiated less. The cost is ~285 KiB of kernel data.

The master quantises to exactly 224 colours — the `pnmtologo.c:43` ceiling —
with the gradient intact and the wordmark crisp. The rebuilt kernel confirms it
linked: `System.map` carries `logo_linux_clut224_clut` and
`logo_linux_clut224_data` exactly 0x2a0 = 672 bytes apart, which is 224 colours
at three bytes each, and the `Image` grew 327,680 bytes.

**`fbcon=logo-pos:center,logo-count:1`** on the command line. Without it the
logo is drawn top-left, and `fb_logo_count` defaults to `-1`, which means *one
copy per online CPU* (`fbmem.c:695`) — eight side-by-side logos on this SoC.
`logo-count:1` pins a single copy and `logo-pos:center` places it
(`fbcon.c:476-487`, `fbmem.c:504-513`, `:681-682`).

## 3. What changes

| File | Change |
|---|---|
| `boards/cx3576/bsp/kernel/configure.sh` | enable `LOGO` + `LOGO_LINUX_CLUT224`, disable `LOGO_LINUX_MONO`/`LOGO_LINUX_VGA16`, and re-assert all of it after `olddefconfig` — including refusing deferred takeover |
| `boards/cx3576/bsp/kernel/logo/mklogo.py` | new: the master-to-PPM converter |
| `boards/cx3576/bsp/kernel/Dockerfile` | stage the master and the converter, run it over the vendor logo |
| `boards/cx3576/bsp/kernel/Dockerfile.dockerignore` | allow `kernel/logo/` and the master into the context |
| `boards/cx3576/boot.cmd` | `consoleargs` gains `console=tty1` **before** the serial console, plus `loglevel=5` and the `fbcon=` options |
| `boards/cx3576/board.env` | `BOARD_CMDLINE_ARGS` tracks it, and the board declares `BOARD_HAS_DISPLAY=1` |
| `boards/x64/board.env`, `boards/virt-arm64/board.env` | declare `BOARD_HAS_DISPLAY=0` |
| `boards/cx3576/overlay/.../50-mos-getty.preset` | new: `disable getty@.service` |
| `boards/cx3576/deb/board-cx3576/Dockerfile` | ship the board's presets, and refuse a build that staged none |
| `verify/src/lint.ts` | `BOARD_HAS_DISPLAY` joins `REQUIRED_BOARD_KEYS`, with the same 0-or-1 rule as `BOARD_HAS_STATUS_LED` |
| `verify/src/board.ts`, `board-scope.ts` | model the key, and the `hasDisplay` predicate the checks are scoped by |
| `verify/src/unit-state.ts` | new: the preset-resolution reader, lifted whole out of `checks-firewall.ts` so there is one implementation |
| `verify/src/checks-firewall.ts` | imports it instead of keeping its own copy |
| `verify/src/checks-bootchain.ts` | exports `bootScript`, so the command line is read by one reader |
| `verify/src/checks-display.ts` | new: the display and console contract |
| `verify/src/checks-fixture.ts` | the healthy root gains `getty@.service`, the board preset and the logo config symbols |
| `verify/src/checks-display.test.ts` | new: every check driven red, through the real seam |
| `verify/src/board.test.ts`, `lint.test.ts` | the deliberate counts, and the new key's reject case |
| `docs/design/display.md` + the zh mirror | §4's boot-experience claims replaced with what was measured; §5 gains the key it asked for |
| `docs/bsp/board-env.md`, `board-template.md` | document `BOARD_HAS_DISPLAY`, and that `BOARD_CMDLINE_ARGS`' consoles are ordered |
| `docs/bsp/cx3576-bench.md` | §10: the rows only hardware can settle |

## 4. What the contract asserts

Every choice above is checkable off the image, and `verify/src/checks-display.ts`
checks them. The ordering assertions are ordering assertions, not substring
matches — a check that merely found both `console=` values would be green on the
arrangement that moves `/dev/console` to HDMI, which is the failure this design
would most plausibly ship with.

1. `console=tty1` and the serial console both appear in the compiled `boot.scr`,
   **and tty1 appears first**, so `/dev/console` is the serial one.
2. `loglevel=` is present and its value is `>= 5` — the `fbcon.c:1009` floor.
   Asserted as an inequality, because `loglevel=0` and `loglevel=4` are the two
   values that would silently produce a blank screen, and `quiet` is refused
   outright for the same reason.
3. `fbcon=` carries `logo-count:1`, so the logo is not drawn once per CPU.
4. The shipped `/boot/config-<release>` has `CONFIG_LOGO=y` and
   `CONFIG_LOGO_LINUX_CLUT224=y` — read off the image, not off the build.
5. The same config does **not** have `CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y`,
   which would suppress the logo.
6. `getty@tty1.service` resolves to **disabled**: the unit exists, no `.wants`
   or `.requires` link names it, and a preset rule matching it says `disable`.
   The unit-exists half is what stops the check passing vacuously over a root
   that lost the unit.
7. `boot.cmd`'s `consoleargs` and `BOARD_CMDLINE_ARGS` agree on the console
   list, so the board file cannot drift from what the board actually boots.

Boards that declare no display take the `skipOwner` path, so the register still
prints a conclusion for them.

### 4.1 One thing asserted by execution rather than by reading

`consoleargs` grew from 59 to 118 characters, which puts the composed `bootargs`
at 549 (357 of which is `verity_args`) before `systemd.machine_id=` is appended
— long enough that "does U-Boot truncate it" is a fair
question rather than a pedantic one. Reading the source says no: with
`CONFIG_HUSH_PARSER=y` the expansion is built in a `o_string` that reallocates,
and `fdt_chosen()` hands `env_get("bootargs")` straight to `fdt_setprop`, so no
fixed buffer is in the path.

That reasoning was then checked by running it. `make os-uboot-handshake-test`
executes the **shipped** `boards/cx3576/boot.cmd` inside a real U-Boot sandbox
binary through the real hush parser, and it passes on the edited file — every
cycle reaches `booti`, which means the longer `setenv consoleargs` and the
`setenv bootargs` that expands it both executed. The harness asserts the A/B
arithmetic rather than the command line, so this is not a check that the console
list is *right*; it is a check that the file still parses and runs, which is the
failure mode a longer line introduces.

## 5. What only hardware can settle

There is no board here, so **nothing visual has been confirmed**. Specifically
untested: that the logo appears at all, that it is centred and legible at the
negotiated mode, that a panic reaches the screen, and that
`systemctl start getty@tty1` produces a usable login prompt. Rows are added to
`docs/bsp/cx3576-bench.md` for each.

What *is* confirmed is every step of the reasoning that leads to them: the
source of each mechanism at the pinned commit, and the resulting bytes in the
assembled image.
