// The board-hardware families, driven from the failing side and from the OTHER
// board.
//
// Every check lands with the fixture that fails it, because the parity harness
// cannot tell a check that passes from one that cannot fail: both report "agrees
// with the oracle" against a healthy image. Every family here also has a third
// direction, the SKIP it takes on the board without the hardware, so each is
// driven three ways -- green on the board that has the thing, red on a mutation
// of that board's tree, and skipped on the board that declares it absent.
//
// `status-led-absent`, check_status_led's BOARD_HAS_STATUS_LED=0 branch, had
// never been observed failing anywhere in this tree: it runs on x64's real image
// and passes (the verification contract dispatches it unconditionally),
// and the image fixture contract drives fixture mode with cx3576's
// board.env, which declares 1, while the verification contract leans on it to
// claim both directions are covered. `the =0 branch FAILS when the image carries
// the unit anyway` below is the first time its failing arm has been driven, and
// it needs the x64-shaped packed-root fixture in `checks-fixture.ts`.

import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { openSync, closeSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { BOARD_CHECKS } from './checks-board.ts'
import {
  healthyGpt,
  imageFixture,
  packedRootFixture,
  toolsAnswering,
  type Fixture,
  type RootFixture,
} from './checks-fixture.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

function checkNamed(id: string): CheckCase {
  const found = BOARD_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no batch-3 check is registered as '${id}'. Registered: `
      + BOARD_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

async function resultsOf(ctx: ImageContext, id: string): Promise<readonly CheckResult[]> {
  return checkNamed(id).run(ctx)
}

async function verdictOf(ctx: ImageContext, id: string): Promise<Verdict> {
  const got = await resultsOf(ctx, id)
  expect(got.length).toBe(1)
  return (got[0] as CheckResult).verdict
}

async function messageOf(ctx: ImageContext, id: string): Promise<string> {
  const got = await resultsOf(ctx, id)
  return (got[0] as CheckResult).message
}

/**
 * Seed a packed-root fixture for `board`, assert the check is GREEN, mutate.
 *
 * The green assertion is what makes the red one mean something: a fixture that
 * was already failing reports the same red after any edit at all, including one
 * that changed nothing.
 */
async function mutated(board: Board, id: string, mutate: (root: string) => void): Promise<RootFixture> {
  const fx = packedRootFixture(board)
  expect(await verdictOf(fx.ctx, id)).toBe('pass')
  mutate(fx.root)
  return fx
}

// the register itself

describe('the register batch 3 adds', () => {
  test('every id is unique, and every check registers at least one matcher', () => {
    const ids = BOARD_CHECKS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of BOARD_CHECKS) {
      const any = c.shell.pass !== undefined || c.shell.fail !== undefined || c.shell.skip !== undefined
      expect(`${c.id}: ${any}`).toBe(`${c.id}: true`)
    }
  })

  test('no check declares an EMPTY boards list, which would apply to no board', () => {
    // The shape a filtered-down list takes when the filter was wrong. Every
    // list here is derived from boards/, so an empty one means a predicate
    // that selects nothing -- and the check would silently never run.
    for (const c of BOARD_CHECKS) {
      if (c.boards === undefined) continue
      expect(`${c.id}: ${c.boards.length}`).not.toBe(`${c.id}: 0`)
    }
  })

  test('a family and its skip owner cover the shipped boards exactly once between them', () => {
    // The two `boards:` lists are complements of one derived predicate. If they
    // ever overlapped, two checks would claim one line on the overlapping board
    // and the run would be `ambiguous`; if they left a gap, the family would be
    // silent on the board in it.
    for (const [item, skipper] of [
      ['radio-modules-no-bcmdhd', 'radio-module-list-skipped'],
      ['bt-btattach', 'bt-userland-skipped'],
      ['gadget-udev-rule', 'gadget-udev-rule-skipped'],
      ['led-script', 'led-overlay-skipped'],
      ['status-led-ordering', 'status-led-absent'],
    ] as const) {
      const a = new Set(checkNamed(item).boards ?? [])
      const b = new Set(checkNamed(skipper).boards ?? [])
      const overlap = [...a].filter(n => b.has(n))
      expect(`${item}/${skipper} overlap: ${overlap.join(',')}`).toBe(`${item}/${skipper} overlap: `)
      expect(new Set([...a, ...b])).toEqual(new Set(['cx3576', 'x64']))
    }
  })

  test('the boards lists are DERIVED: they agree with what the definitions declare', () => {
    // The literal-list defect M4c found twice. Asserted against the board files
    // rather than against two names written here, so a third board added to
    // boards/ widens this test with the tree instead of pinning it.
    expect(checkNamed('loader-size-matches-uboot-max').boards)
      .toEqual([cx3576, x64].filter(b => b.bootloader === 'uboot').map(b => b.name))
    expect(checkNamed('bt-btattach').boards)
      .toEqual([cx3576, x64].filter(b => (b.radios ?? []).includes('bluetooth')).map(b => b.name))
    expect(checkNamed('status-led-absent').boards)
      .toEqual([cx3576, x64].filter(b => b.hasStatusLed !== '1').map(b => b.name))
  })

  test('one check is generated per (board, slot, required file), with @SLOT@ substituted', () => {
    // The ` contains ` collision M4b flagged and M4c measured: the substring
    // claims fourteen lines on cx3576, so the family could only be registered
    // one line at a time. The @SLOT@ substitution is the oracle's.
    const ids = BOARD_CHECKS.filter(c => c.id.startsWith('boot-slot-file-')).map(c => c.id)
    expect(ids).toContain('boot-slot-file-cx3576-BOOT-A-mos-verity-a.env')
    expect(ids).toContain('boot-slot-file-cx3576-BOOT-B-mos-verity-b.env')
    expect(ids).not.toContain('boot-slot-file-cx3576-BOOT-A-mos-verity-@SLOT@.env')
    // x64 declares no @SLOT@ at all: it builds one ESP holding both slots'
    // kernels and copies it, so each slot legitimately contains both.
    expect(ids).toContain('boot-slot-file-x64-BOOT-A-vmlinuz')
    expect(ids).toContain('boot-slot-file-x64-BOOT-B-vmlinuz')
    // Two boards, two slots, four + three declared files.
    expect(ids.length).toBe(2 * ((cx3576.bootSlotRequiredFiles ?? []).length)
      + 2 * ((x64.bootSlotRequiredFiles ?? []).length))
  })

  test('no matcher in this batch is the bare ` contains ` or ` is a regular file`', () => {
    // The two substrings that would swallow another batch. Every matcher here
    // that ends in one of them must be strictly longer, i.e. carry the path or
    // the slot that names it alone.
    for (const c of BOARD_CHECKS) {
      for (const m of [c.shell.pass, c.shell.fail, c.shell.skip]) {
        if (m === undefined) continue
        expect(`${c.id}: ${m}`).not.toBe(`${c.id}:  contains `)
        expect(`${c.id}: ${m}`).not.toBe(`${c.id}:  is a regular file`)
      }
    }
  })
})

// the status indicator -- both branches, both directions

describe('check_status_led, BOARD_HAS_STATUS_LED=0 (x64)', () => {
  test('the =0 branch PASSES on an x64-shaped tree that ships no mos-status-led file', async () => {
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'status-led-absent')).toBe('pass')
      expect(await messageOf(fx.ctx, 'status-led-absent'))
        .toContain('declares no status indicator and ships no mos-status-led files')
    }
    finally {
      fx.dispose()
    }
  })

  test('the =0 branch FAILS when the image carries the unit anyway', async () => {
    // The direction that had never run. The verification contract claims
    // check_status_led "asserts the ABSENCE for those boards, so the two
    // together cover both directions" -- and until this case, the absence
    // assertion had only ever been observed agreeing.
    //
    // The mutation is the real regression: x64 carried mos-status-led.service
    // until BOARD_HAS_STATUS_LED reached the image assembler, and the unit
    // reads /sys/class/leds/status-*/brightness on a board that has no such
    // path, so it failed on EVERY boot -- indistinguishable to an operator from
    // a real fault.
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'status-led-absent')).toBe('pass')
      writeFileSync(join(fx.root, '/usr/lib/systemd/system/mos-status-led.service'), '[Unit]\n')
      expect(await verdictOf(fx.ctx, 'status-led-absent')).toBe('fail')
      const message = await messageOf(fx.ctx, 'status-led-absent')
      expect(message).toContain('declares BOARD_HAS_STATUS_LED=0 but the image carries:')
      // The FILE is named, because "the image carries something" without saying
      // what leaves a reader unable to find it in a 9,238-path tree.
      expect(message).toContain('/usr/lib/systemd/system/mos-status-led.service')
      expect(message).toContain('/sys/class/leds/status-*/brightness')
    }
    finally {
      fx.dispose()
    }
  })

  test('it finds the leftovers in all THREE directories the oracle searches', async () => {
    // /usr/lib/systemd/system, /etc/systemd/system and /usr/lib/mos. A search
    // of only the first would pass for an image that shipped the SCRIPT and not
    // the unit, which is exactly what a half-reverted board overlay leaves.
    for (const dir of ['/usr/lib/systemd/system', '/etc/systemd/system', '/usr/lib/mos']) {
      const fx = packedRootFixture(x64)
      try {
        expect(await verdictOf(fx.ctx, 'status-led-absent')).toBe('pass')
        mkdirSync(join(fx.root, dir), { recursive: true })
        writeFileSync(join(fx.root, dir, 'mos-status-led-leftover'), 'x\n')
        expect(`${dir}: ${await verdictOf(fx.ctx, 'status-led-absent')}`).toBe(`${dir}: fail`)
      }
      finally {
        fx.dispose()
      }
    }
  })

  test('it is registered for x64 and NOT for cx3576, from the definitions themselves', () => {
    expect(checkNamed('status-led-absent').boards).toEqual(['x64'])
  })
})

describe('check_status_led, BOARD_HAS_STATUS_LED=1 (cx3576)', () => {
  test('both orderings pass on a healthy tree, as two firings with names', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const got = await resultsOf(fx.ctx, 'status-led-ordering')
      expect(got.map(r => r.verdict)).toEqual(['pass', 'pass'])
      expect(got.map(r => r.instance)).toEqual([
        'reports ready before the slot is confirmed',
        'turns blue on a slot whose health gate failed',
      ])
    }
    finally {
      fx.dispose()
    }
  })

  test('a unit with no After=mos-health.service fails the ordering firing only', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const unit = join(fx.root, '/usr/lib/systemd/system/mos-status-led.service')
      writeFileSync(unit, readFileSync(unit, 'utf8').replace('After=mos-health.service\n', ''))
      const got = await resultsOf(fx.ctx, 'status-led-ordering')
      expect(got.map(r => r.verdict)).toEqual(['fail', 'pass'])
      expect(got[0]?.message).toContain("has no 'After=mos-health.service'")
    }
    finally {
      fx.dispose()
    }
  })

  test('a unit with no Requires= fails the other firing, and the two are told apart', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const unit = join(fx.root, '/usr/lib/systemd/system/mos-status-led.service')
      writeFileSync(unit, readFileSync(unit, 'utf8').replace('Requires=mos-health.service\n', ''))
      const got = await resultsOf(fx.ctx, 'status-led-ordering')
      expect(got.map(r => r.verdict)).toEqual(['pass', 'fail'])
      expect(got[1]?.message).toContain("has no 'Requires=mos-health.service'")
    }
    finally {
      fx.dispose()
    }
  })

  test('a MISSING unit collapses to ONE firing, which is why this is a `many` check', async () => {
    // check_status_led returns early when the unit is absent and prints ONE
    // conclusion naming neither clause. Two independent `one` checks could not
    // model that: the oracle's single line would match neither of their
    // matchers, and the harness would report one unclaimed conclusion and two
    // orphans about an image that is merely missing a file. The `many` shape
    // makes the early return one firing with its own name.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, '/usr/lib/systemd/system/mos-status-led.service'))
      const got = await resultsOf(fx.ctx, 'status-led-ordering')
      expect(got.length).toBe(1)
      expect(got[0]?.verdict).toBe('fail')
      expect(got[0]?.instance).toBe('is not in the image')
      expect(got[0]?.message).toContain('declares BOARD_HAS_STATUS_LED=1 but')
    }
    finally {
      fx.dispose()
    }
  })

  test("the instance pattern matches every message this check can produce", () => {
    // A firing whose instance pattern finds nothing in the shell's line is
    // `ambiguous` -- the harness says so by name -- so the three sentences are
    // asserted against the pattern here rather than discovered on a red image.
    const pattern = checkNamed('status-led-ordering').instance as RegExp
    for (const line of [
      'catches an indicator that reports ready before the slot is confirmed: mos-status-led.service '
      + 'is ordered after mos-health.service',
      'catches an indicator that turns blue on a slot whose health gate failed: mos-status-led.service '
      + 'requires mos-health.service',
      'cx3576 declares BOARD_HAS_STATUS_LED=1 but /usr/lib/systemd/system/mos-status-led.service is '
      + 'not in the image; the indicator the operator reads to know the device is up would never run',
    ]) {
      expect(`${line.slice(0, 30)}: ${pattern.exec(line)?.[1] !== undefined}`)
        .toBe(`${line.slice(0, 30)}: true`)
    }
  })
})

describe('the status-indicator overlay set', () => {
  test('every overlay check passes on cx3576 and the group SKIPS on x64', async () => {
    const led = packedRootFixture(cx3576)
    try {
      for (const id of [
        'led-script', 'led-script-executable', 'led-unit', 'led-unit-enabled',
        'led-unit-execstart', 'led-unit-execstop', 'led-unit-remain-after-exit',
        'led-unit-after-multi-user', 'led-no-dark-start', 'led-no-dark-stop',
      ]) expect(`${id}: ${await verdictOf(led.ctx, id)}`).toBe(`${id}: pass`)
    }
    finally {
      led.dispose()
    }
    const none = packedRootFixture(x64)
    try {
      expect(await verdictOf(none.ctx, 'led-overlay-skipped')).toBe('skip')
      expect(await messageOf(none.ctx, 'led-overlay-skipped'))
        .toContain('the status-indicator unit and script assertions (x64 declares BOARD_HAS_STATUS_LED=0)')
    }
    finally {
      none.dispose()
    }
  })

  test('a script that is not executable fails, and the mode is NAMED', async () => {
    // ExecStart= on a mode-0644 script fails with 203/EXEC and the board stays
    // on the kernel's boot red for the whole session -- with the file present,
    // the unit enabled and every other check here green.
    const fx = await mutated(cx3576, 'led-script-executable',
      root => chmodSync(join(root, '/usr/lib/mos/mos-status-led'), 0o644))
    try {
      expect(await verdictOf(fx.ctx, 'led-script-executable')).toBe('fail')
      expect(await messageOf(fx.ctx, 'led-script-executable')).toContain('is mode 644, not executable')
    }
    finally {
      fx.dispose()
    }
  })

  test('an ExecStart with a suffix stops matching the anchored pattern', async () => {
    const fx = await mutated(cx3576, 'led-unit-execstart', (root) => {
      const unit = join(root, '/usr/lib/systemd/system/mos-status-led.service')
      writeFileSync(unit, readFileSync(unit, 'utf8')
        .replace('ExecStart=/usr/lib/mos/mos-status-led start',
          'ExecStart=/usr/lib/mos/mos-status-led start --quiet'))
    })
    try {
      expect(await verdictOf(fx.ctx, 'led-unit-execstart')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('a Type=oneshot unit with no RemainAfterExit is caught', async () => {
    // Not a style point: without it the unit counts as inactive the moment
    // ExecStart returns, systemd runs ExecStop immediately, and the board snaps
    // back to red the instant it went blue.
    const fx = await mutated(cx3576, 'led-unit-remain-after-exit', (root) => {
      const unit = join(root, '/usr/lib/systemd/system/mos-status-led.service')
      writeFileSync(unit, readFileSync(unit, 'utf8').replace('RemainAfterExit=yes\n', ''))
    })
    try {
      expect(await verdictOf(fx.ctx, 'led-unit-remain-after-exit')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('SWAPPING the two writes in one branch fails only that branch', async () => {
    // The failure nothing else can catch: either order is valid shell and
    // passes every syntax check, and the symptom is an instant where both LEDs
    // are off and the board reads as dead.
    const fx = await mutated(cx3576, 'led-no-dark-start', (root) => {
      const script = join(root, '/usr/lib/mos/mos-status-led')
      writeFileSync(script, readFileSync(script, 'utf8')
        .replace('\tled_on BLUE\n\tled_off RED\n', '\tled_off RED\n\tled_on BLUE\n'))
    })
    try {
      expect(await verdictOf(fx.ctx, 'led-no-dark-start')).toBe('fail')
      // The OTHER branch is untouched and stays green: the region scoping is
      // what makes one mutation name one branch.
      expect(await verdictOf(fx.ctx, 'led-no-dark-stop')).toBe('pass')
      expect(await messageOf(fx.ctx, 'led-no-dark-start')).toContain('does not write')
    }
    finally {
      fx.dispose()
    }
  })

  test('a write in the OTHER branch does not satisfy this one', async () => {
    // The whole reason the oracle's awk is region-scoped by line number. With
    // the start) branch emptied, the writes it needs still exist in the file --
    // in stop) -- and a whole-file grep would pass.
    const fx = await mutated(cx3576, 'led-no-dark-start', (root) => {
      const script = join(root, '/usr/lib/mos/mos-status-led')
      writeFileSync(script, readFileSync(script, 'utf8')
        .replace('start)\n\tled_on BLUE\n\tled_off RED\n\t;;\n', 'start)\n\t:\n\t;;\n'))
    })
    try {
      expect(await verdictOf(fx.ctx, 'led-no-dark-start')).toBe('fail')
      expect(await verdictOf(fx.ctx, 'led-no-dark-stop')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})

// the radio: firmware set, module list, Bluetooth userland

describe('the board radio-firmware set', () => {
  test('every declared firmware path is its own check, and each passes on cx3576', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      for (const fw of cx3576.firmwareFiles ?? []) {
        const id = `board-firmware-cx3576${fw}`
        expect(`${id}: ${await verdictOf(fx.ctx, id)}`).toBe(`${id}: pass`)
      }
    }
    finally {
      fx.dispose()
    }
  })

  test('a firmware file that became a SYMLINK fails -- the shape a package move takes', async () => {
    const fw = (cx3576.firmwareFiles ?? [])[0] as string
    const id = `board-firmware-cx3576${fw}`
    const fx = await mutated(cx3576, id, (root) => {
      rmSync(join(root, fw))
      symlinkSync('/usr/lib/firmware/elsewhere.bin', join(root, fw))
    })
    try {
      expect(await verdictOf(fx.ctx, id)).toBe('fail')
      expect(await messageOf(fx.ctx, id)).toContain('missing or not a regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('x64 SKIPS the set, and the skip is a third verdict rather than a pass', async () => {
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'board-radio-firmware-set-skipped')).toBe('skip')
      expect(await messageOf(fx.ctx, 'board-radio-firmware-set-skipped'))
        .toContain('x64 declares BOARD_FIRMWARE_FILES empty')
    }
    finally {
      fx.dispose()
    }
  })

  test('no per-path firmware check is generated for a board declaring none', () => {
    // Declared-EMPTY is not absent, and it is not "some default set" either.
    expect(BOARD_CHECKS.filter(c => c.id.startsWith('board-firmware-x64'))).toEqual([])
    expect(BOARD_CHECKS.filter(c => c.id.startsWith('board-firmware-cx3576')).length)
      .toBe((cx3576.firmwareFiles ?? []).length)
  })
})

describe('the radio module list', () => {
  test('a modules.conf that still loads bcmdhd fails', async () => {
    // Single SKU: bcmdhd was dropped with the AIC-only fleet decision and must
    // not creep back into the list.
    const fx = await mutated(cx3576, 'radio-modules-no-bcmdhd', root =>
      writeFileSync(join(root, '/etc/mos/modules.conf'), 'aic8800_fdrv\naic8800_btlpm\nbcmdhd\n'))
    try {
      expect(await verdictOf(fx.ctx, 'radio-modules-no-bcmdhd')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('bcmdhd inside a COMMENT is not a defect -- the file may explain the drop', async () => {
    // The oracle strips comment lines before looking, and a port that did not
    // would fail a correct image for documenting itself.
    const fx = packedRootFixture(cx3576)
    try {
      writeFileSync(join(fx.root, '/etc/mos/modules.conf'),
        '   # bcmdhd is deliberately absent\naic8800_fdrv\naic8800_btlpm\n')
      expect(await verdictOf(fx.ctx, 'radio-modules-no-bcmdhd')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('an absent modules.conf fails rather than passing for having nothing to object to', async () => {
    const fx = await mutated(cx3576, 'radio-modules-no-bcmdhd', root =>
      rmSync(join(root, '/etc/mos/modules.conf')))
    try {
      expect(await verdictOf(fx.ctx, 'radio-modules-no-bcmdhd')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the btlpm pattern is ANCHORED, so a longer module name does not satisfy it', async () => {
    const fx = await mutated(cx3576, 'radio-modules-aic-btlpm', root =>
      writeFileSync(join(root, '/etc/mos/modules.conf'), 'aic8800_fdrv\naic8800_btlpm_old\n'))
    try {
      expect(await verdictOf(fx.ctx, 'radio-modules-aic-btlpm')).toBe('fail')
      // ...and the unanchored one still matches, which is what makes the
      // anchoring a deliberate difference rather than an accident.
      expect(await verdictOf(fx.ctx, 'radio-modules-aic-fdrv')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('x64 SKIPS the module-list assertions', async () => {
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'radio-module-list-skipped')).toBe('skip')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the Bluetooth userland', () => {
  test('it passes on cx3576 and SKIPS on x64', async () => {
    const bt = packedRootFixture(cx3576)
    try {
      for (const id of ['bt-btattach', 'bt-main-conf-leaves-name', 'bt-service-enabled']) {
        expect(`${id}: ${await verdictOf(bt.ctx, id)}`).toBe(`${id}: pass`)
      }
    }
    finally {
      bt.dispose()
    }
    const none = packedRootFixture(x64)
    try {
      expect(await verdictOf(none.ctx, 'bt-userland-skipped')).toBe('skip')
    }
    finally {
      none.dispose()
    }
  })

  test('a main.conf that PINS Name fails -- the inverted direction', async () => {
    // The only check in this batch whose failure is the presence of a line
    // rather than its absence: pinning Name blocks bluez's hostname plugin and
    // every device in the fleet advertises the same name.
    const fx = await mutated(cx3576, 'bt-main-conf-leaves-name', root =>
      writeFileSync(join(root, '/etc/bluetooth/main.conf'), '[General]\n  Name = mos\n'))
    try {
      expect(await verdictOf(fx.ctx, 'bt-main-conf-leaves-name')).toBe('fail')
      expect(await messageOf(fx.ctx, 'bt-main-conf-leaves-name')).toContain('pins Name')
    }
    finally {
      fx.dispose()
    }
  })

  test('an ABSENT main.conf passes, exactly as the oracle passes it', async () => {
    // A vacuous pass, reproduced rather than improved on: `[ -f ] && grep`
    // is false when the file is missing, and the oracle's `else` branch is the
    // PASS. A port that failed here would go red on an image the oracle passes,
    // and the divergence would be the port's own.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, '/etc/bluetooth/main.conf'))
      expect(await verdictOf(fx.ctx, 'bt-main-conf-leaves-name')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('an installed-but-unenabled bluetooth.service fails', async () => {
    const fx = await mutated(cx3576, 'bt-service-enabled', root =>
      rmSync(join(root, '/etc/systemd/system/bluetooth.target.wants/bluetooth.service')))
    try {
      expect(await verdictOf(fx.ctx, 'bt-service-enabled')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the legacy wifi.conf is board-UNCONDITIONAL and fails on either board', async () => {
    for (const board of [cx3576, x64]) {
      const fx = packedRootFixture(board)
      try {
        expect(await verdictOf(fx.ctx, 'radio-no-legacy-wifi-modules-conf')).toBe('pass')
        mkdirSync(join(fx.root, '/etc/modules-load.d'), { recursive: true })
        writeFileSync(join(fx.root, '/etc/modules-load.d/wifi.conf'), 'aic8800_fdrv\n')
        expect(`${board.name}: ${await verdictOf(fx.ctx, 'radio-no-legacy-wifi-modules-conf')}`)
          .toBe(`${board.name}: fail`)
      }
      finally {
        fx.dispose()
      }
    }
  })
})

// the hwinit facts

describe('the per-board hwinit facts', () => {
  test('one check per declared conf on cx3576, and a SKIP on x64', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      for (const c of cx3576.hwinitConfs ?? []) {
        const id = `hwinit-conf-cx3576/etc/mos/${c}.conf`
        expect(`${id}: ${await verdictOf(fx.ctx, id)}`).toBe(`${id}: pass`)
      }
    }
    finally {
      fx.dispose()
    }
    const none = packedRootFixture(x64)
    try {
      expect(await verdictOf(none.ctx, 'hwinit-confs-skipped')).toBe('skip')
    }
    finally {
      none.dispose()
    }
  })

  test('a conf that ships WITHOUT being declared is caught by the other direction', async () => {
    // cx3576 shipped modules.conf while BOARD_HWINIT_CONFS named five of its
    // six facts, and every forward check passed on all five.
    const fx = await mutated(cx3576, 'hwinit-no-undeclared-conf', root =>
      writeFileSync(join(root, '/etc/mos/thermal.conf'), '# undeclared\n'))
    try {
      expect(await verdictOf(fx.ctx, 'hwinit-no-undeclared-conf')).toBe('fail')
      expect(await messageOf(fx.ctx, 'hwinit-no-undeclared-conf')).toContain('thermal')
    }
    finally {
      fx.dispose()
    }
  })

  test('health.conf is excluded BY NAME: it is shared and asserted unconditionally', async () => {
    // It ships on every board and is in batch 2a's list. Counting it as
    // undeclared would fail both shipped images.
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'hwinit-no-undeclared-conf')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('an hwinit unit that is installed and NOT enabled is caught', async () => {
    const fx = await mutated(cx3576, 'hwinit-units-enabled', root =>
      rmSync(join(root, '/etc/systemd/system/multi-user.target.wants/mos-can.service')))
    try {
      expect(await verdictOf(fx.ctx, 'hwinit-units-enabled')).toBe('fail')
      expect(await messageOf(fx.ctx, 'hwinit-units-enabled')).toContain('mos-can.service')
    }
    finally {
      fx.dispose()
    }
  })

  test('the reconciler-owned pair is STEPPED OVER, not required to be enabled', async () => {
    // mos-mqttd and mos-mqtt-broker are deliberately inert: mosd starts them
    // from mqtt.enabled. The enumeration used to require every mos-*.service to
    // be enabled, which contradicted their own checks, and the contradiction
    // only surfaced when a real image carrying the broker was verified.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx.ctx, 'hwinit-units-enabled')).toBe('pass')
      expect(await verdictOf(fx.ctx, 'hwinit-reconciler-owned-skipped')).toBe('skip')
      expect(await messageOf(fx.ctx, 'hwinit-reconciler-owned-skipped'))
        .toContain('mos-mqtt-broker.service mos-mqttd.service')
    }
    finally {
      fx.dispose()
    }
  })

  test('a board whose every mos-*.service is reconciler-owned SKIPS rather than passing', async () => {
    // Zero judged is a skip, not a pass. Without the count, "every
    // mos-*.service present is also enabled" comes out of a loop that examined
    // none of them.
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'hwinit-units-enabled')).toBe('pass')
      for (const u of ['mos-health.service', 'mos-machine-id.service']) {
        rmSync(join(fx.root, '/usr/lib/systemd/system', u))
      }
      expect(await verdictOf(fx.ctx, 'hwinit-units-enabled')).toBe('skip')
      expect(await messageOf(fx.ctx, 'hwinit-units-enabled'))
        .toContain('every mos-*.service in the image is reconciler-owned')
    }
    finally {
      fx.dispose()
    }
  })

  test('an image with NO mos-*.service at all fails the presence check', async () => {
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'hwinit-units-present')).toBe('pass')
      for (const u of [
        'mos-health.service', 'mos-machine-id.service',
        'mos-mqttd.service', 'mos-mqtt-broker.service',
      ]) rmSync(join(fx.root, '/usr/lib/systemd/system', u))
      expect(await verdictOf(fx.ctx, 'hwinit-units-present')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('a helper with no fact, and a fact with no helper, are both caught', async () => {
    // The count IS the assertion. "At least one is present" cannot tell a board
    // that legitimately has none from one whose install step dropped them all.
    const extra = await mutated(cx3576, 'hwinit-helpers-match-declaration', root =>
      writeFileSync(join(root, '/usr/lib/mos/hwinit-thermal'), 'x\n'))
    try {
      expect(await verdictOf(extra.ctx, 'hwinit-helpers-match-declaration')).toBe('fail')
    }
    finally {
      extra.dispose()
    }
    const missing = await mutated(cx3576, 'hwinit-helpers-match-declaration', root =>
      rmSync(join(root, `/usr/lib/mos/hwinit-${(cx3576.hwinitConfs ?? [])[0] as string}`)))
    try {
      expect(await verdictOf(missing.ctx, 'hwinit-helpers-match-declaration')).toBe('fail')
    }
    finally {
      missing.dispose()
    }
  })

  test('x64 SKIPS the helpers as an EQUALITY, and a stray helper there fails it', async () => {
    // The skip is asserted rather than assumed: a helper present on a board
    // with no fact to read can never run, and this is the only thing that says so.
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx.ctx, 'hwinit-helpers-match-declaration')).toBe('skip')
      mkdirSync(join(fx.root, '/usr/lib/mos'), { recursive: true })
      writeFileSync(join(fx.root, '/usr/lib/mos/hwinit-can'), 'x\n')
      expect(await verdictOf(fx.ctx, 'hwinit-helpers-match-declaration')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the gadget udev rule passes on cx3576, skips on x64, and fails without the WANTS', async () => {
    const fx = await mutated(cx3576, 'gadget-udev-rule-pulls-getty', root =>
      writeFileSync(join(root, '/usr/lib/udev/rules.d/60-mos-gadget-getty.rules'),
        'ACTION=="add", SUBSYSTEM=="tty", KERNEL=="ttyGS0", TAG+="systemd"\n'))
    try {
      expect(await verdictOf(fx.ctx, 'gadget-udev-rule-pulls-getty')).toBe('fail')
      expect(await verdictOf(fx.ctx, 'gadget-udev-rule')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
    const none = packedRootFixture(x64)
    try {
      expect(await verdictOf(none.ctx, 'gadget-udev-rule-skipped')).toBe('skip')
    }
    finally {
      none.dispose()
    }
  })
})

// the loader partition -- read off the GPT, not the packed root

const LOADER_MAGIC = Buffer.from('524b4e53', 'hex')

/** A synthetic image whose loader sector carries the idbloader magic. */
function loaderFixture(board: Board, magic: Buffer = LOADER_MAGIC): Fixture {
  const slotSectors = Number(board.partition('ROOTFS_A')?.sizeSectors ?? 0)
  const fx = imageFixture({ board, gpt: healthyGpt(board, slotSectors) })
  const start = Number(board.partition('LOADER')?.startSector ?? 0)
  const sectorSize = board.sectorSize ?? 512
  const fd = openSync(fx.ctx.image, 'r+')
  try {
    writeSync(fd, magic, 0, magic.length, start * sectorSize)
  }
  finally {
    closeSync(fd)
  }
  return fx
}

describe('the loader-partition protections', () => {
  test('all four pass against a table the board definition describes', async () => {
    const fx = loaderFixture(cx3576)
    try {
      for (const id of [
        'loader-abuts-uenv-a', 'loader-size-matches-uboot-max',
        'loader-idbloader-magic', 'loader-typecode-unique',
      ]) expect(`${id}: ${await verdictOf(fx.ctx, id)}`).toBe(`${id}: pass`)
    }
    finally {
      fx.dispose()
    }
  })

  test('a loader that does not reach uenv-a leaves an uncovered region, and fails', async () => {
    // systemd-repart DISCARDS every region no GPT entry covers, on first boot,
    // while growing DATA. Before the loader had an entry, that TRIMmed the
    // idbloader and the device reached maskrom on the next power-on.
    const slotSectors = Number(cx3576.partition('ROOTFS_A')?.sizeSectors ?? 0)
    const healthy = healthyGpt(cx3576, slotSectors)
    const partnum = Number(cx3576.partition('LOADER')?.partnum)
    const shrunk = {
      ...healthy,
      partitions: healthy.partitions.map(p =>
        (p.number === partnum ? { ...p, sizeSectors: p.sizeSectors - 8 } : p)),
    }
    const fx = imageFixture({
      board: cx3576,
      gpt: { ...shrunk, partition: (n: number) => shrunk.partitions.find(p => p.number === n) },
    })
    try {
      expect(await verdictOf(fx.ctx, 'loader-abuts-uenv-a')).toBe('fail')
      expect(await messageOf(fx.ctx, 'loader-abuts-uenv-a'))
        .toContain('discarded by systemd-repart')
    }
    finally {
      fx.dispose()
    }
  })

  test('a loader whose first bytes are not the idbloader magic fails, and the bytes are NAMED', async () => {
    const fx = loaderFixture(cx3576, Buffer.from('deadbeef', 'hex'))
    try {
      expect(await verdictOf(fx.ctx, 'loader-idbloader-magic')).toBe('fail')
      expect(await messageOf(fx.ctx, 'loader-idbloader-magic')).toContain("starts with 'deadbeef'")
    }
    finally {
      fx.dispose()
    }
  })

  test('a loader carrying the linux-generic type fails: a repart definition could pair with it', async () => {
    const slotSectors = Number(cx3576.partition('ROOTFS_A')?.sizeSectors ?? 0)
    const healthy = healthyGpt(cx3576, slotSectors)
    const partnum = Number(cx3576.partition('LOADER')?.partnum)
    const linux = cx3576.get('TYPECODE_LINUX') as string
    const retyped = {
      ...healthy,
      partitions: healthy.partitions.map(p => (p.number === partnum ? { ...p, typeGuid: linux } : p)),
    }
    const fx = imageFixture({
      board: cx3576,
      gpt: { ...retyped, partition: (n: number) => retyped.partitions.find(p => p.number === n) },
    })
    try {
      expect(await verdictOf(fx.ctx, 'loader-typecode-unique')).toBe('fail')
      expect(await messageOf(fx.ctx, 'loader-typecode-unique'))
        .toContain('must be unique and distinct from linux-generic/ESP')
    }
    finally {
      fx.dispose()
    }
  })

  test('a grub board SKIPS the group, on the one entry that owns that line', async () => {
    const slotSectors = Number(x64.partition('ROOTFS_A')?.sizeSectors ?? 0)
    const fx = imageFixture({ board: x64, gpt: healthyGpt(x64, slotSectors) })
    try {
      expect(await verdictOf(fx.ctx, 'loader-abuts-uenv-a')).toBe('skip')
      expect(await messageOf(fx.ctx, 'loader-abuts-uenv-a'))
        .toContain('9-partition x64 layout has no loader')
    }
    finally {
      fx.dispose()
    }
    // ...and the other three are not registered for it at all, so the run has
    // no second claimant for that line and no `unfired` row either.
    for (const id of ['loader-size-matches-uboot-max', 'loader-idbloader-magic', 'loader-typecode-unique']) {
      expect(`${id}: ${(checkNamed(id).boards ?? []).includes('x64')}`).toBe(`${id}: false`)
    }
  })
})

// what a boot slot must contain -- read through mtools

/** A context whose only readable thing is one `mdir` listing, for both slots. */
function slotFixture(board: Board, listing: readonly string[]): Fixture {
  const slotSectors = Number(board.partition('ROOTFS_A')?.sizeSectors ?? 0)
  return imageFixture({
    board,
    gpt: healthyGpt(board, slotSectors),
    tools: toolsAnswering(/mdir/, { stdout: `${listing.join('\n')}\n` }),
  })
}

const CX_SLOT_FILES = ['::/Image', '::/rk3576-src.dtb', '::/boot.scr', '::/mos-verity-a.env', '::/mos-verity-b.env']

describe("what a boot slot must contain", () => {
  test('each declared file is its own check, and each passes when the slot lists it', async () => {
    const fx = slotFixture(cx3576, CX_SLOT_FILES)
    try {
      for (const slot of ['BOOT-A', 'BOOT-B']) {
        for (const raw of cx3576.bootSlotRequiredFiles ?? []) {
          const file = raw.replaceAll('@SLOT@', slot === 'BOOT-A' ? 'a' : 'b')
          const id = `boot-slot-file-cx3576-${slot}-${file}`
          expect(`${id}: ${await verdictOf(fx.ctx, id)}`).toBe(`${id}: pass`)
        }
      }
    }
    finally {
      fx.dispose()
    }
  })

  test('a slot missing ONE file fails exactly that check', async () => {
    const fx = slotFixture(cx3576, CX_SLOT_FILES.filter(f => f !== '::/boot.scr'))
    try {
      expect(await verdictOf(fx.ctx, 'boot-slot-file-cx3576-BOOT-A-boot.scr')).toBe('fail')
      expect(await messageOf(fx.ctx, 'boot-slot-file-cx3576-BOOT-A-boot.scr'))
        .toBe('BOOT-A is missing boot.scr')
      expect(await verdictOf(fx.ctx, 'boot-slot-file-cx3576-BOOT-A-Image')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('the match is EXACT: the same name in a subdirectory does not satisfy it', async () => {
    // `grep -qxF "::/${f}"`. A `boot/Image` would satisfy a substring test and
    // is not the file U-Boot loads.
    const fx = slotFixture(cx3576, ['::/boot', '::/boot/Image', '::/rk3576-src.dtb', '::/boot.scr',
      '::/mos-verity-a.env', '::/mos-verity-b.env'])
    try {
      expect(await verdictOf(fx.ctx, 'boot-slot-file-cx3576-BOOT-A-Image')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('an extlinux.conf in a slot fails, because it bypasses the whole A/B handshake', async () => {
    // Both U-Boot boot frameworks try extlinux BEFORE boot.scr: BOOT_ORDER is
    // never consulted, attempts are never counted, rollback never happens, and
    // there is no error on the console.
    const clean = slotFixture(cx3576, CX_SLOT_FILES)
    try {
      const got = await resultsOf(clean.ctx, 'boot-slot-no-extlinux')
      expect(got.map(r => r.verdict)).toEqual(['pass', 'pass'])
      expect(got.map(r => r.instance)).toEqual(['BOOT-A', 'BOOT-B'])
    }
    finally {
      clean.dispose()
    }
    const dirty = slotFixture(cx3576, [...CX_SLOT_FILES, '::/extlinux', '::/extlinux/extlinux.conf'])
    try {
      const got = await resultsOf(dirty.ctx, 'boot-slot-no-extlinux')
      expect(got.map(r => r.verdict)).toEqual(['fail', 'fail'])
      expect(got[0]?.message).toContain('bypasses the whole RAUC A/B handshake')
    }
    finally {
      dirty.dispose()
    }
  })

  test('an initrd in a U-Boot slot fails -- and the check is not registered for a grub board', async () => {
    // Not merely inapplicable on x64: INVERTED. An x64 slot MUST carry
    // initrd.img, so an ungated check would fail a correct image and send
    // someone looking for a defect in the assembler.
    const fx = slotFixture(cx3576, [...CX_SLOT_FILES, '::/initrd.img'])
    try {
      const got = await resultsOf(fx.ctx, 'boot-slot-no-initramfs')
      expect(got.map(r => r.verdict)).toEqual(['fail', 'fail'])
    }
    finally {
      fx.dispose()
    }
    expect((checkNamed('boot-slot-no-initramfs').boards ?? []).includes('x64')).toBe(false)
  })

  test('a grub board SKIPS the U-Boot-only group, once per slot, on one owning entry', async () => {
    // ONE skip per slot naming two families -- extlinux and the Image/dtb
    // byte-compare. It named three until PLAN-073: a grub slot carried an
    // initrd then, so the no-initramfs rule was inverted there and travelled in
    // this skip. x64's kernel now assembles the verity root from the command
    // line, both boards' slots carry no initrd, and that check runs
    // unconditionally instead -- which is why the slot listing below has no
    // initrd.img in it either.
    const fx = slotFixture(x64, ['::/vmlinuz', '::/cmdline.cfg'])
    try {
      const got = await resultsOf(fx.ctx, 'boot-slot-no-extlinux')
      expect(got.map(r => r.verdict)).toEqual(['skip', 'skip'])
      expect(got.map(r => r.instance)).toEqual(['BOOT-A', 'BOOT-B'])
      expect(got[0]?.message).toContain('the extlinux and Image/dtb assertions (bootloader=grub)')
      // The rule the skip stopped covering now fires here, green, on the same
      // fixture: a skip that had quietly become a way of not asking is exactly
      // what unscoping it was for.
      const noInitrd = await resultsOf(fx.ctx, 'boot-slot-no-initramfs')
      expect(noInitrd.map(r => r.verdict)).toEqual(['pass', 'pass'])
      // ...and x64's own required files still pass in the same run: the skip is
      // about the U-Boot group, not about the slot.
      for (const f of x64.bootSlotRequiredFiles ?? []) {
        const id = `boot-slot-file-x64-BOOT-A-${f}`
        expect(`${id}: ${await verdictOf(fx.ctx, id)}`).toBe(`${id}: pass`)
      }
    }
    finally {
      fx.dispose()
    }
  })
})
