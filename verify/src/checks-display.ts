// The local display: a boot logo instead of a text console, and HDMI still
// reachable as one. PLAN-088's contract, read off the assembled image.
//
// Scoped by `BOARD_HAS_DISPLAY`, so a board with no screen takes the skip and
// the register still prints a conclusion for it. cx3576 is the only board that
// declares one today; the list is derived from the declarations, so a second
// display board is covered the day its definition says so.
//
// EVERY ASSERTION HERE IS AN ORDERING OR AN INEQUALITY, NOT A PRESENCE, and that
// is the whole point of the file. The three ways this design would plausibly
// ship broken all pass a presence test:
//
//   * `console=ttyFIQ0,1500000 console=tty1` carries both consoles and moves
//     /dev/console to HDMI, so systemd's output lands on the screen the logo is
//     meant to own and the serial console goes quiet -- the opposite of the
//     intent, and a substring check for the two values is green on it.
//   * `quiet` or `loglevel=0` are what a reader reaches for to silence the boot,
//     and both are measured to SUPPRESS THE LOGO: fbcon only draws it when
//     `console_loglevel > CONSOLE_LOGLEVEL_QUIET` (fbcon.c:1009-1010, and the
//     shipped config sets that to 4). `loglevel=0` additionally makes an oops
//     invisible on every console, because `console_verbose()` is guarded by
//     `if (console_loglevel)` (printk.c:2567-2571) and does nothing at zero. A
//     check for "loglevel is set" is green on both.
//   * `getty@tty1` with no enablement symlink looks disabled and is not: an
//     unmatched unit presets to ENABLE, and `90-systemd.preset` says
//     `enable getty@.service`. A check for the absence of a link is green on an
//     image one `systemctl preset-all` away from a login prompt.
//
// So the loglevel check is `>= 5` rather than `= 5`, the console check compares
// POSITIONS, and the getty check reads the preset RESOLUTION through
// `unit-state.ts` rather than grepping for a `disable` line.
//
// WHERE THE COMMAND LINE IS READ FROM. On a U-Boot board it is composed inside
// the compiled boot script -- `boot.cmd`'s `consoleargs` -- and NOT in the
// per-slot verity env, which carries only the dm-verity table. So these checks
// read `boot.scr`, which is why `bootScript` is imported rather than
// `boardCmdline`. A grub display board would keep its console arguments in the
// cmdline the bootloader composes, and takes that branch.

import { readFileSync } from 'node:fs'
import { boardsWhere, hasDisplay, isUBoot } from './board-scope.ts'
import { SLOTS, type BootSlot } from './boot-slots.ts'
import { bootScript } from './checks-bootchain.ts'
import { boardCmdline } from './checks-cmdline.ts'
import { kernelRelease } from './checks-kernel.ts'
import { packedRoot, pathInRoot, regularFileInRoot } from './checks-root.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { uImageText } from './image.ts'
import type { CheckResult } from './parity.ts'
import { UNIT_DIRS, PRESET_DIRS, presetForInstance, wantsLinksNaming } from './unit-state.ts'
import { skipped, verdict } from './verdict.ts'

const DISPLAY = boardsWhere(hasDisplay)
const NO_DISPLAY = boardsWhere(b => !hasDisplay(b))

/** The getty instance HDMI would show a login prompt on. */
const GETTY_UNIT = 'getty@tty1.service'

/**
 * The floor `console_loglevel` must clear for fbcon to draw the logo.
 *
 * `fbcon_init` sets `logo_shown = FBCON_LOGO_DONTSHOW` when
 * `console_loglevel <= CONSOLE_LOGLEVEL_QUIET` (fbcon.c:1009-1010), and the
 * shipped config has `CONFIG_CONSOLE_LOGLEVEL_QUIET=4`. So 5 is the lowest
 * value that shows a logo, and `quiet` -- which sets exactly 4 -- does not.
 */
const LOGLEVEL_FLOOR = 5

/**
 * The value `setenv consoleargs "<...>"` assigns, with comment lines discarded.
 *
 * THE EXTRACTION IS THE FIX FOR A REAL DEFECT, and it is worth the words. This
 * read the WHOLE boot script text first, on the reasoning that every token
 * looked for here is a literal in it. It is -- and so is every token in
 * `boot.cmd`'s PROSE. That file documents at length why `quiet` must not be set
 * and what `fbcon=logo-pos:center,logo-count:1` is for, and the first run
 * against a real image failed two checks on its own comments: the loglevel
 * check found the word `quiet` in a sentence explaining that `quiet` is
 * forbidden, and the logo-count check parsed `fbcon=logo-pos:center,logo-count:1.`
 * out of a sentence that ended in a full stop, so the option came out as
 * `logo-count:1.` and did not match.
 *
 * Both were the check reading documentation as configuration -- green or red
 * according to how the file is WORDED rather than what it sets. So the value is
 * extracted from the assignment, and lines whose first non-space character is
 * `#` are dropped before anything is matched.
 *
 * `consoleargs` by name, which is `boot.cmd`'s own spelling, for the same
 * reason `checks-bootchain.ts` reads `bootpart` and `rootpart` by name. A board
 * that moved these tokens elsewhere makes every check here report "no console="
 * -- loudly wrong rather than quietly green.
 */
export function consoleArgsOf(script: string): string {
  for (const raw of script.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) continue
    const m = /^setenv[ \t]+consoleargs[ \t]+"([^"]*)"/.exec(line)
    if (m !== null) return m[1] as string
  }
  return ''
}

/**
 * The effective console arguments for slot A.
 *
 * On a U-Boot board they are composed inside the compiled boot script; on a
 * grub board the bootloader's own command line carries them.
 */
async function cmdlineText(ctx: ImageContext): Promise<string> {
  if (!isUBoot(ctx.board)) return boardCmdline(ctx, SLOTS[0] as BootSlot)
  const file = await bootScript(ctx, SLOTS[0] as BootSlot)
  return file === undefined ? '' : consoleArgsOf(uImageText(file))
}

/**
 * Every `console=` value on the command line, in the order it appears.
 *
 * The order is the assertion: `__add_preferred_console` sets
 * `preferred_console` on each one parsed, so the LAST wins and is what
 * `/dev/console` binds to (printk.c:2437-2468). Bounded on the left by a
 * delimiter so a hypothetical `earlyconsole=` could not be read as a console.
 */
function consoleList(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s"'])console=([^\s"']+)/g)].map(m => m[1] as string)
}

/** `tty1`, `tty0` and friends: the virtual consoles, which are the display. */
const isVirtualConsole = (name: string): boolean => /^tty\d+$/.test(name)

/**
 * The shipped `/boot/config-<release>`, or '' when there is no single one.
 *
 * Read through `pathInRoot`, which resolves every hop INSIDE the image. A plain
 * `join(root, path)` hands an absolute symlink stored in the image to the
 * verifier's own filesystem, and the answer for such a path is a fact about the
 * machine running the check rather than about the image (RFCT-358). `pathInRoot`
 * throws when a hop is missing, and the throw lands in the catch that already
 * spells absence as `''`.
 */
async function shippedKernelConfig(ctx: ImageContext): Promise<string> {
  const root = await packedRoot(ctx)
  const release = kernelRelease(root)
  if (release === '') return ''
  try {
    return readFileSync(pathInRoot(root, `/boot/config-${release}`), 'utf8')
  }
  catch {
    return ''
  }
}

/** A `CONFIG_X=y` line, anchored so `CONFIG_LOGO` is not an answer about `CONFIG_LOGO_LINUX_MONO`. */
const declares = (config: string, symbol: string): boolean =>
  config.split('\n').some(l => l.trim() === `${symbol}=y`)

export const DISPLAY_CHECKS: readonly CheckCase[] = [
  {
    // THE ORDERING, and it is the reason this file exists. Both consoles
    // receiving printk is the easy half; which one is LAST decides where init,
    // systemd and every service's stdout go, and getting it backwards is a
    // working boot that quietly moves the console onto the customer's screen.
    id: 'display-console-order',
    boards: DISPLAY,
    shell: {
      pass: 'the kernel cmdline puts the display console before the serial one',
      fail: 'the kernel cmdline does not put the display console before the serial one',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const consoles = consoleList(await cmdlineText(ctx))
      const id = 'display-console-order'
      if (consoles.length === 0) {
        return [verdict(id, false,
          'the kernel cmdline does not put the display console before the serial one: it carries no '
          + 'console= at all, so the board would boot with nowhere to print why it did not')]
      }
      const vcs = consoles.filter(isVirtualConsole)
      if (vcs.length === 0) {
        return [verdict(id, false,
          `the kernel cmdline does not put the display console before the serial one: the console `
          + `list is ${consoles.join(' ')} and none of them is a virtual console. This board `
          + `declares BOARD_HAS_DISPLAY=1, and without a tty on the list the display receives no `
          + `kernel message -- so an oops on a unit with no serial cable attached is invisible, `
          + `which is the whole reason the logo is allowed to own the screen`)]
      }
      const last = consoles[consoles.length - 1] as string
      if (isVirtualConsole(last)) {
        return [verdict(id, false,
          `the kernel cmdline does not put the display console before the serial one: the console `
          + `list is ${consoles.join(' ')} and the LAST entry is '${last}'. Every console= receives `
          + `printk, but /dev/console is the last one (printk.c:2437-2468), so this arrangement `
          + `binds init's and systemd's output to the display instead of to serial. The logo would `
          + `be scrolled away by service output and the serial console would go quiet`)]
      }
      return [verdict(id, true,
        `the kernel cmdline puts the display console before the serial one: ${consoles.join(' ')} . `
        + `Both receive printk, and /dev/console is the last one, '${last}', so init and systemd `
        + `write to serial while an oops still reaches the display`)]
    },
  },

  {
    // The inequality. `= 5` would be a check that has to be edited to raise the
    // verbosity, and the property is a floor rather than a value.
    id: 'display-loglevel-shows-logo',
    boards: DISPLAY,
    shell: {
      pass: 'the kernel cmdline loglevel is high enough for fbcon to draw the logo',
      fail: 'the kernel cmdline loglevel is not high enough for fbcon to draw the logo',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const text = await cmdlineText(ctx)
      const id = 'display-loglevel-shows-logo'
      if (/(?:^|[\s"'])quiet(?=[\s"']|$)/.test(text)) {
        return [verdict(id, false,
          'the kernel cmdline loglevel is not high enough for fbcon to draw the logo: it carries '
          + '`quiet`, which sets console_loglevel to CONSOLE_LOGLEVEL_QUIET (init/main.c:242-246). '
          + 'The shipped config has CONFIG_CONSOLE_LOGLEVEL_QUIET=4, and fbcon_init suppresses the '
          + 'logo when console_loglevel <= that value (fbcon.c:1009-1010) -- so `quiet` reads like '
          + 'the way to keep text off the screen and is in fact the way to keep the LOGO off it')]
      }
      const m = /(?:^|[\s"'])loglevel=(\d+)/.exec(text)
      if (m === null) {
        return [verdict(id, false,
          'the kernel cmdline loglevel is not high enough for fbcon to draw the logo: it carries no '
          + `loglevel=, so console_loglevel stays at CONFIG_CONSOLE_LOGLEVEL_DEFAULT and every `
          + `NOTICE and INFO message prints onto the display the logo is meant to own`)]
      }
      const got = Number(m[1])
      if (got < LOGLEVEL_FLOOR) {
        return [verdict(id, false,
          `the kernel cmdline loglevel is not high enough for fbcon to draw the logo: loglevel=`
          + `${got}, and fbcon_init suppresses the logo unless console_loglevel exceeds `
          + `CONFIG_CONSOLE_LOGLEVEL_QUIET, which this kernel sets to `
          + `${LOGLEVEL_FLOOR - 1} (fbcon.c:1009-1010). ${got === 0
            ? 'At zero it is worse than a blank screen: suppress_message_printing() drops even '
              + 'KERN_EMERG, and console_verbose() is guarded by `if (console_loglevel)` so the '
              + 'oops/panic auto-raise never fires -- the crash would be invisible on serial too '
              + '(printk.c:1230-1233, :2567-2571)'
            : `${LOGLEVEL_FLOOR} is the floor`}`)]
      }
      return [verdict(id, true,
        `the kernel cmdline loglevel is high enough for fbcon to draw the logo: loglevel=${got}, `
        + `above the CONFIG_CONSOLE_LOGLEVEL_QUIET=${LOGLEVEL_FLOOR - 1} threshold fbcon_init tests. `
        + `A healthy boot still prints only WARNING and worse, and console_verbose() raises to `
        + `MOTORMOUTH on an oops because the level is non-zero`)]
    },
  },

  {
    id: 'display-fbcon-single-logo',
    boards: DISPLAY,
    shell: {
      pass: 'the kernel cmdline draws exactly one logo',
      fail: 'the kernel cmdline does not draw exactly one logo',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const text = await cmdlineText(ctx)
      const id = 'display-fbcon-single-logo'
      const m = /(?:^|[\s"'])fbcon=([^\s"']+)/.exec(text)
      const opts = m === null ? [] : (m[1] as string).split(',')
      if (!opts.includes('logo-count:1')) {
        return [verdict(id, false,
          `the kernel cmdline does not draw exactly one logo: fbcon=${m === null ? '(absent)' : m[1]} `
          + `carries no logo-count:1. fb_logo_count defaults to -1, which means ONE COPY PER ONLINE `
          + `CPU (fbmem.c:695) -- on this SoC that is a row of logos rather than a boot splash`)]
      }
      return [verdict(id, true,
        `the kernel cmdline draws exactly one logo: fbcon=${m?.[1]} pins logo-count:1, so the `
        + `per-CPU default of fb_logo_count does not tile it across the screen`)]
    },
  },

  {
    // Read off the SHIPPED config rather than the build, for the reason
    // checks-kernel.ts gives: the BSP output is an input to the image, and a
    // stale one ships a kernel predating whatever the build asserts.
    id: 'display-kernel-logo-built-in',
    boards: DISPLAY,
    shell: {
      pass: 'the shipped kernel config builds in the boot logo',
      fail: 'the shipped kernel config does not build in the boot logo',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const config = await shippedKernelConfig(ctx)
      const id = 'display-kernel-logo-built-in'
      if (config === '') {
        return [verdict(id, false,
          'the shipped kernel config does not build in the boot logo: there is no single '
          + '/boot/config-* in the packed root to read, so this says nothing about the kernel the '
          + 'board boots')]
      }
      const missing = ['CONFIG_LOGO', 'CONFIG_LOGO_LINUX_CLUT224'].filter(s => !declares(config, s))
      if (missing.length > 0) {
        return [verdict(id, false,
          `the shipped kernel config does not build in the boot logo: ${missing.join(' and ')} `
          + `${missing.length === 1 ? 'is' : 'are'} not =y. Without CONFIG_LOGO there is no logo at `
          + `all; without CONFIG_LOGO_LINUX_CLUT224 the board's own PPM is compiled by nothing `
          + `(drivers/video/logo/Makefile keys the object off that symbol) and HDMI stays blank `
          + `with the getty already disabled -- a screen showing neither a logo nor a console`)]
      }
      return [verdict(id, true,
        'the shipped kernel config builds in the boot logo: CONFIG_LOGO=y and '
        + 'CONFIG_LOGO_LINUX_CLUT224=y, so the board\'s own 224-colour PPM is linked in')]
    },
  },

  {
    // INVERTED, and the reason is counter-intuitive enough to be worth the
    // entry: this symbol reads like protection for the logo and would suppress
    // it. It protects a framebuffer that FIRMWARE painted, and the pinned
    // upstream U-Boot cannot drive this SoC's display at all (PLAN-088 §1), so
    // there is nothing handed over to protect.
    id: 'display-no-deferred-takeover',
    boards: DISPLAY,
    shell: {
      pass: 'the shipped kernel config leaves fbcon deferred takeover off',
      fail: 'the shipped kernel config turns fbcon deferred takeover on',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const config = await shippedKernelConfig(ctx)
      const id = 'display-no-deferred-takeover'
      if (config === '') {
        return [verdict(id, false,
          'the shipped kernel config turns fbcon deferred takeover on: there is no single '
          + '/boot/config-* in the packed root to read, and an absent config cannot witness the '
          + 'symbol being off')]
      }
      const symbol = 'CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER'
      if (declares(config, symbol)) {
        return [verdict(id, false,
          `the shipped kernel config turns fbcon deferred takeover on: ${symbol}=y. fbcon's `
          + `deferred path sets logo_shown = FBCON_LOGO_DONTSHOW BEFORE it registers the `
          + `framebuffers (fbcon.c:3338-3340), so this kernel's logo is never drawn. It is the `
          + `right symbol for a logo handed over by firmware and the wrong one for a logo the `
          + `kernel draws`)]
      }
      return [verdict(id, true,
        `the shipped kernel config leaves fbcon deferred takeover off: no ${symbol}=y, so fbcon `
        + `draws the logo when it initialises instead of suppressing it and waiting for a VT write`)]
    },
  },

  {
    // Three facts, one conclusion, and the same shape as
    // checks-firewall.ts's nftables entry: the unit is in the root, nothing
    // enables it, and the presets RESOLVE it to disabled. The first is what
    // stops the other two being statements about nothing.
    id: 'display-getty-tty1-disabled',
    boards: DISPLAY,
    shell: {
      pass: 'getty@tty1 is disabled by a preset',
      fail: 'getty@tty1 is not disabled by a preset',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'display-getty-tty1-disabled'
      // The TEMPLATE is what the root carries; `getty@tty1.service` is an
      // instance systemd synthesises from it, so looking for a file by that
      // name would find nothing on a perfectly good image.
      const template = UNIT_DIRS
        .map(dir => `${dir}/getty@.service`)
        .find(p => regularFileInRoot(root, p))
      if (template === undefined) {
        return [verdict(id, false,
          `getty@tty1 is not disabled by a preset: there is no getty@.service in `
          + `${UNIT_DIRS.join(' or ')} at all, so "nothing enables it" is a statement about `
          + `nothing -- true of a root that failed to unpack and of a directory that was never a `
          + `root. systemd ships this template on every image`)]
      }
      const links = wantsLinksNaming(root, GETTY_UNIT)
      if (links.length > 0) {
        return [verdict(id, false,
          `getty@tty1 is not disabled by a preset: ${links.join(' ')} enable(s) it. tty1 is this `
          + `board's HDMI output, so the unit puts a login prompt on the customer's screen over the `
          + `boot logo. It must be startable on demand and not started at boot`)]
      }
      const rule = presetForInstance(root, GETTY_UNIT)
      if (rule === undefined) {
        return [verdict(id, false,
          `getty@tty1 is not disabled by a preset: no preset rule in ${PRESET_DIRS.join(' ')} `
          + `matches ${GETTY_UNIT} or the getty@.service template, and an unmatched unit presets to `
          + `ENABLE. No enablement link exists today, but that is an absence and not a decision: `
          + `90-systemd.preset says \`enable getty@.service\` and the template declares `
          + `DefaultInstance=tty1, so one \`systemctl preset-all\` puts the prompt back`)]
      }
      if (rule.verb !== 'disable') {
        return [verdict(id, false,
          `getty@tty1 is not disabled by a preset: the first rule that claims it is `
          + `'${rule.verb} ${rule.pattern}' in ${rule.file}. Preset rules are consulted in `
          + `lexicographic order of basename and the first match wins, so a later \`disable\` line `
          + `would never be read`)]
      }
      return [verdict(id, true,
        `getty@tty1 is disabled by a preset: ${template} is in the root, no .wants or .requires `
        + `link names ${GETTY_UNIT}, and the first preset rule that claims it is '${rule.verb} `
        + `${rule.pattern}' in ${rule.file}. \`systemctl start getty@tty1\` still works`)]
    },
  },

  {
    // The board definition against the image. BOARD_CMDLINE_ARGS is the board's
    // written-down console list and boot.cmd's consoleargs is what the board
    // actually boots; on a U-Boot board they are two files with no mechanism
    // binding them, which is exactly the pair that goes stale silently.
    id: 'display-board-env-console-agrees',
    boards: DISPLAY,
    shell: {
      pass: 'BOARD_CMDLINE_ARGS names the same console list the image boots',
      fail: 'BOARD_CMDLINE_ARGS does not name the same console list the image boots',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'display-board-env-console-agrees'
      const booted = consoleList(await cmdlineText(ctx))
      const declared = consoleList(` ${ctx.board.cmdlineArgs ?? ''}`)
      const same = booted.length === declared.length && booted.every((c, i) => c === declared[i])
      return [verdict(id, same,
        same
          ? `BOARD_CMDLINE_ARGS names the same console list the image boots, in the same order: `
            + `${booted.join(' ')}`
          : `BOARD_CMDLINE_ARGS does not name the same console list the image boots: `
            + `${ctx.board.path} declares [${declared.join(' ') || 'none'}] and the image boots `
            + `[${booted.join(' ') || 'none'}]. The order is part of the comparison, because it is `
            + `what decides which console /dev/console binds to -- two files agreeing on the set `
            + `and not on the order describe two different boots`)]
    },
  },

  {
    id: 'display-skipped',
    boards: NO_DISPLAY,
    shell: { skip: 'the local-display assertions (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped('display-skipped',
      `the local-display assertions (${ctx.board.name} declares BOARD_HAS_DISPLAY=0): there is no `
      + `product screen on this board, so there is no boot logo to draw, no console ordering to `
      + `keep /dev/console off a display, and no tty1 getty whose enablement would show a login `
      + `prompt to a customer`)],
  },
]
