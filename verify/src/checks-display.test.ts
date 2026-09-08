// The display family, driven from the failing side.
//
// Every check here is an ORDERING or an INEQUALITY rather than a presence, so
// the mutations are the arrangements that carry every required token and are
// still wrong. That is the whole risk this family exists against: the three
// most plausible ways to ship PLAN-088 broken all satisfy a substring test.
//
//   * the console list REVERSED -- both consoles present, /dev/console on HDMI;
//   * `quiet`, and `loglevel=0` and `loglevel=4` -- all three read like "keep
//     the boot quiet" and all three suppress the logo, and the last also blinds
//     the oops path on every console;
//   * `getty@tty1` with no enablement link and no preset -- which looks disabled
//     and presets to ENABLE.
//
// THE COMMAND-LINE CHECKS RUN THROUGH THE REAL SEAM. `bootScript` short-circuits
// on a file already present in the work directory, so writing `boot-a-boot.scr`
// there drives the actual path -- slot selection from the board definition,
// `uImageText`'s NUL strip, `consoleList`'s parse -- rather than a stub the test
// invented. A fabricated seam would only test the fabrication.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { DISPLAY_CHECKS } from './checks-display.ts'
import { assertRegisterWellFormed, CHECKS, type CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

/**
 * The console arguments the board ships, as `boot.cmd` composes them.
 *
 * Read off the board definition rather than written out, so this suite cannot
 * pass against a boot.cmd the tree stopped shipping: if `BOARD_CMDLINE_ARGS`
 * moves, the healthy fixture moves with it and the mutations stay mutations OF
 * the shipped arrangement.
 */
const SHIPPED_ARGS = cx3576.cmdlineArgs ?? ''

/** A compiled boot script's text: the uImage header is NULs, which uImageText strips. */
function bootScr(args: string): string {
  return `\0\0\0\0mos boot\0\nsetenv consoleargs "${args}"\n`
    + `setenv bootargs "\${rootargs} \${verity_args} \${raucargs} \${consoleargs}"\n`
}

function checkNamed(id: string): CheckCase {
  const found = DISPLAY_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no display check is registered as '${id}'. Registered: `
      + DISPLAY_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

/** A fixture whose slot-A boot script carries `args`. */
function withCmdline(args: string): RootFixture {
  const fx = packedRootFixture(cx3576)
  writeFileSync(join(fx.ctx.workDir, 'boot-a-boot.scr'), bootScr(args))
  return fx
}

async function only(fx: RootFixture, id: string): Promise<CheckResult> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  return got[0] as CheckResult
}

async function verdictOf(fx: RootFixture, id: string): Promise<Verdict> {
  return (await only(fx, id)).verdict
}

/**
 * Assert `id` is green on the shipped command line, then red on `args`.
 *
 * Both halves, because a red-only assertion is satisfied by a check that
 * rejects everything, and a green-only one by a check that accepts everything.
 */
async function cmdlineGoesRed(id: string, args: string): Promise<string> {
  const good = withCmdline(SHIPPED_ARGS)
  try {
    expect(await verdictOf(good, id)).toBe('pass')
  }
  finally {
    good.dispose()
  }
  const bad = withCmdline(args)
  try {
    const got = await only(bad, id)
    expect(`${id}:${got.verdict}`).toBe(`${id}:fail`)
    return got.message
  }
  finally {
    bad.dispose()
  }
}

describe('the display family is in the register and can be diffed', () => {
  test('every check is registered in CHECKS, and the register is well formed', () => {
    const registered = new Set(CHECKS.map(c => c.id))
    for (const c of DISPLAY_CHECKS) expect(registered.has(c.id)).toBe(true)
    expect(DISPLAY_CHECKS.length).toBeGreaterThan(0)
    assertRegisterWellFormed()
  })

  test('the family fires on cx3576 and skips on the boards with no screen', () => {
    // Derived from BOARD_HAS_DISPLAY, so the lists grow with the tree rather
    // than with an edit here. Both must be non-empty: a family scoped to no
    // board reports no divergence about anything.
    const firing = DISPLAY_CHECKS.filter(c => c.id !== 'display-skipped')
    for (const c of firing) {
      expect(`${c.id}:${(c.boards ?? []).includes('cx3576')}`).toBe(`${c.id}:true`)
      expect(`${c.id}:${(c.boards ?? []).includes('x64')}`).toBe(`${c.id}:false`)
    }
    const skip = checkNamed('display-skipped')
    expect(skip.boards).toContain('x64')
    expect(skip.boards).not.toContain('cx3576')
    expect((skip.boards ?? []).length).toBeGreaterThan(0)
  })

  test('the whole family is green on the healthy fixture', async () => {
    const fx = withCmdline(SHIPPED_ARGS)
    try {
      for (const c of DISPLAY_CHECKS.filter(c => c.id !== 'display-skipped')) {
        const got = await c.run(fx.ctx)
        expect(got.length).toBe(1)
        expect(`${c.id}:${(got[0] as CheckResult).verdict}`).toBe(`${c.id}:pass`)
      }
    }
    finally {
      fx.dispose()
    }
  })

  test('the skip owner names the board and its declaration', async () => {
    const fx = packedRootFixture(x64)
    try {
      const got = await checkNamed('display-skipped').run(fx.ctx)
      expect(got.length).toBe(1)
      expect((got[0] as CheckResult).verdict).toBe('skip')
      expect((got[0] as CheckResult).message).toContain('x64 declares BOARD_HAS_DISPLAY=0')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the console list, where the ORDER is the assertion', () => {
  test('the shipped arrangement puts the display first and serial last', async () => {
    const fx = withCmdline(SHIPPED_ARGS)
    try {
      const got = await only(fx, 'display-console-order')
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('console=tty1')
      expect(got.message).toContain('/dev/console is the last one')
    }
    finally {
      fx.dispose()
    }
  })

  test('REVERSED is red, though both consoles are present', async () => {
    // The failure this family exists for. Every substring a presence check
    // would look for is here; only the order is wrong, and the order is what
    // decides that systemd writes to the customer's screen.
    const message = await cmdlineGoesRed(
      'display-console-order',
      'console=ttyFIQ0,1500000 console=tty1 loglevel=5 fbcon=logo-pos:center,logo-count:1',
    )
    expect(message).toContain('the LAST entry')
    expect(message).toContain("'tty1'")
  })

  test('serial only is red: the display would receive no kernel message', async () => {
    const message = await cmdlineGoesRed(
      'display-console-order',
      'console=ttyFIQ0,1500000 loglevel=5 fbcon=logo-pos:center,logo-count:1',
    )
    expect(message).toContain('none of them is a virtual console')
  })

  test('no console at all is red', async () => {
    const message = await cmdlineGoesRed('display-console-order', 'loglevel=5')
    expect(message).toContain('no console= at all')
  })
})

describe('the loglevel floor, which is what lets fbcon draw the logo', () => {
  test('`quiet` is red, and the message says it suppresses the LOGO', async () => {
    // The correction that the source forced: `quiet` is the obvious way to keep
    // text off the screen and is measured to keep the logo off it too.
    const message = await cmdlineGoesRed(
      'display-loglevel-shows-logo',
      'console=tty1 console=ttyFIQ0,1500000 quiet fbcon=logo-count:1',
    )
    expect(message).toContain('`quiet`')
    expect(message).toContain('fbcon.c:1009-1010')
  })

  test('loglevel=0 is red, and the message names the blinded panic path', async () => {
    const message = await cmdlineGoesRed(
      'display-loglevel-shows-logo',
      'console=tty1 console=ttyFIQ0,1500000 loglevel=0 fbcon=logo-count:1',
    )
    expect(message).toContain('KERN_EMERG')
    expect(message).toContain('console_verbose()')
  })

  test('loglevel=4 is red: equal to the threshold is not above it', async () => {
    // The off-by-one the fbcon test is written as `<=`. A check written as
    // `loglevel is set` or `loglevel < 5 is fine` passes here.
    const message = await cmdlineGoesRed(
      'display-loglevel-shows-logo',
      'console=tty1 console=ttyFIQ0,1500000 loglevel=4 fbcon=logo-count:1',
    )
    expect(message).toContain('loglevel=4')
  })

  test('a missing loglevel is red', async () => {
    const message = await cmdlineGoesRed(
      'display-loglevel-shows-logo',
      'console=tty1 console=ttyFIQ0,1500000 fbcon=logo-count:1',
    )
    expect(message).toContain('no loglevel=')
  })

  test('above the floor is green, so the check is a floor and not a value', async () => {
    const fx = withCmdline('console=tty1 console=ttyFIQ0,1500000 loglevel=7 fbcon=logo-count:1')
    try {
      expect(await verdictOf(fx, 'display-loglevel-shows-logo')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the logo count, which defaults to one per CPU', () => {
  test('a missing logo-count:1 is red', async () => {
    const message = await cmdlineGoesRed(
      'display-fbcon-single-logo',
      'console=tty1 console=ttyFIQ0,1500000 loglevel=5 fbcon=logo-pos:center',
    )
    expect(message).toContain('ONE COPY PER ONLINE CPU')
  })

  test('no fbcon= at all is red', async () => {
    const message = await cmdlineGoesRed(
      'display-fbcon-single-logo',
      'console=tty1 console=ttyFIQ0,1500000 loglevel=5',
    )
    expect(message).toContain('(absent)')
  })
})

describe('the shipped kernel config', () => {
  const CONFIG = '/boot/config-6.12.107'

  async function configGoesRed(id: string, edit: (text: string) => string): Promise<string> {
    const fx = withCmdline(SHIPPED_ARGS)
    try {
      expect(await verdictOf(fx, id)).toBe('pass')
      const path = join(fx.root, CONFIG)
      writeFileSync(path, edit(await Bun.file(path).text()))
      const got = await only(fx, id)
      expect(`${id}:${got.verdict}`).toBe(`${id}:fail`)
      return got.message
    }
    finally {
      fx.dispose()
    }
  }

  test('CONFIG_LOGO absent is red', async () => {
    const message = await configGoesRed('display-kernel-logo-built-in',
      t => t.replace('CONFIG_LOGO=y\n', '# CONFIG_LOGO is not set\n'))
    expect(message).toContain('CONFIG_LOGO')
  })

  test('CONFIG_LOGO_LINUX_CLUT224 absent is red, with CONFIG_LOGO still on', async () => {
    // The half that is easy to lose: LOGO alone builds the logo machinery and
    // no bitmap, so the screen is blank with the getty already disabled.
    const message = await configGoesRed('display-kernel-logo-built-in',
      t => t.replace('CONFIG_LOGO_LINUX_CLUT224=y\n', ''))
    expect(message).toContain('CONFIG_LOGO_LINUX_CLUT224')
    expect(message).toContain('compiled by nothing')
  })

  test('deferred takeover turned ON is red', async () => {
    // Inverted, and the reason is the one a reader would get wrong: this symbol
    // reads like protection for the logo and suppresses it.
    const message = await configGoesRed('display-no-deferred-takeover',
      t => `${t}CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y\n`)
    expect(message).toContain('FBCON_LOGO_DONTSHOW')
  })

  test('a root with no /boot/config-* is red, not vacuously green', async () => {
    const fx = withCmdline(SHIPPED_ARGS)
    try {
      expect(await verdictOf(fx, 'display-no-deferred-takeover')).toBe('pass')
      rmSync(join(fx.root, CONFIG))
      const got = await only(fx, 'display-no-deferred-takeover')
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('an absent config cannot witness the symbol being off')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('getty@tty1, disabled by a decision rather than by an absence', () => {
  const PRESET = '/usr/lib/systemd/system-preset/50-mos-getty.preset'
  const ID = 'display-getty-tty1-disabled'

  async function rootGoesRed(mutate: (root: string) => void): Promise<string> {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, ID)).toBe('pass')
      mutate(fx.root)
      const got = await only(fx, ID)
      expect(`${ID}:${got.verdict}`).toBe(`${ID}:fail`)
      return got.message
    }
    finally {
      fx.dispose()
    }
  }

  test('the healthy fixture names the template, the preset and the runtime escape', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const got = await only(fx, ID)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('50-mos-getty.preset')
      expect(got.message).toContain('systemctl start getty@tty1')
    }
    finally {
      fx.dispose()
    }
  })

  test('the preset DELETED is red, though no enablement link exists', async () => {
    // The case a grep for the disable line and a check for the absence of a
    // symlink both pass: nothing enables the unit today, and an unmatched unit
    // presets to ENABLE.
    const message = await rootGoesRed(root => rmSync(join(root, PRESET)))
    expect(message).toContain('presets to ENABLE')
    expect(message).toContain('DefaultInstance=tty1')
  })

  test('an enable rule SORTING EARLIER beats the disable line, and is red', async () => {
    // First match wins across the merged set in basename order, so a grep that
    // found `disable getty@.service` would report green on this root.
    const message = await rootGoesRed(root =>
      writeFileSync(join(root, '/usr/lib/systemd/system-preset/10-vendor.preset'),
        'enable getty@*.service\n'))
    expect(message).toContain('10-vendor.preset')
    expect(message).toContain('first match wins')
  })

  test('an enablement symlink is red', async () => {
    const message = await rootGoesRed((root) => {
      const dir = join(root, '/etc/systemd/system/getty.target.wants')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'getty@tty1.service'), '')
    })
    expect(message).toContain('enable(s) it')
  })

  test('the template GONE is red, so the check cannot pass over an empty root', async () => {
    const message = await rootGoesRed(root =>
      rmSync(join(root, '/usr/lib/systemd/system/getty@.service')))
    expect(message).toContain('a statement about nothing')
  })
})

describe('the board definition against the image', () => {
  test('a boot.cmd that drifts from BOARD_CMDLINE_ARGS is red', async () => {
    const message = await cmdlineGoesRed(
      'display-board-env-console-agrees',
      'console=ttyS0,115200 loglevel=5 fbcon=logo-count:1',
    )
    expect(message).toContain('declares')
    expect(message).toContain('the image boots')
  })

  test('the same consoles in a different ORDER is red', async () => {
    // Two files agreeing on the set and not on the order describe two different
    // boots, so set equality is not the comparison.
    const reversed = SHIPPED_ARGS
      .replace('console=tty1 console=ttyFIQ0,1500000', 'console=ttyFIQ0,1500000 console=tty1')
    expect(reversed).not.toBe(SHIPPED_ARGS)
    const message = await cmdlineGoesRed('display-board-env-console-agrees', reversed)
    expect(message).toContain('The order is part of the comparison')
  })
})
