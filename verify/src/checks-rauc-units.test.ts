// `rauc-units-never-override-boot-slot`, driven from the failing side.
//
// The baseline is the shared packed-root fixture, which seeds upstream's
// `rauc.service` with the ExecStart the image ships and no override flag.
// Every case below is ONE edit to that tree: a flag added to the unit, to a
// drop-in, to a wrapped continuation line, in the `=` spelling, behind a shell
// -- and, the case an "is X absent?" assertion needs most, a tree with no rauc
// command line in it at all.
//
// The mutations are made with the real spelling of the option because that is
// the failure this exists for: a unit that passes `--override-boot-slot` looks
// exactly like a working unit to everything else in the tree. Nothing here
// invents an obviously-broken unit, which would go red for reasons the real
// failure does not have.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { RAUC_UNIT_CHECKS } from './checks-rauc-units.ts'
import type { CheckResult } from './parity.ts'
import { boardEnvPath } from './paths.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

const ID = 'rauc-units-never-override-boot-slot'
const RAUC_UNIT = '/usr/lib/systemd/system/rauc.service'

const check = RAUC_UNIT_CHECKS.find(c => c.id === ID)
if (check === undefined) throw new Error(`no check is registered as '${ID}'`)

async function drive(fx: RootFixture): Promise<CheckResult> {
  const results = await check!.run(fx.ctx)
  const first = results[0]
  if (first === undefined) throw new Error(`'${ID}' concluded nothing`)
  return first
}

/** Seed one file into the fixture root, creating its directory. */
function put(fx: RootFixture, path: string, text: string): void {
  mkdirSync(dirname(join(fx.root, path)), { recursive: true })
  writeFileSync(join(fx.root, path), text)
}

/** The fixture's `rauc.service`, with `from` replaced by `to`. Refuses a no-op edit. */
function rewriteRaucUnit(fx: RootFixture, from: string, to: string): void {
  const before = readFileSync(join(fx.root, RAUC_UNIT), 'utf8')
  const after = before.replace(from, to)
  expect(after).not.toBe(before)
  writeFileSync(join(fx.root, RAUC_UNIT), after)
}

async function withFixture(
  board: typeof cx3576,
  body: (fx: RootFixture) => Promise<void>,
): Promise<void> {
  const fx = packedRootFixture(board)
  try {
    await body(fx)
  }
  finally {
    fx.dispose()
  }
}

describe('the shipped units satisfy the check', () => {
  for (const board of [cx3576, x64]) {
    test(`${board.name} — green, and the pass line counts what it read`, async () => {
      await withFixture(board, async (fx) => {
        const r = await drive(fx)
        expect(r.verdict).toBe('pass')
        // The count is in the message on purpose: "nothing was found" and
        // "nothing was looked at" print the same verdict otherwise.
        expect(r.message).toMatch(/[1-9]\d* unit command line\(s\) start rauc/)
      })
    })
  }

  test('the check applies to every board', () => {
    for (const c of RAUC_UNIT_CHECKS) expect(`${c.id}: ${c.boards}`).toBe(`${c.id}: undefined`)
  })
})

describe('a unit that passes the flag is RED, with this check\'s own message', () => {
  test('on the shipped unit itself', async () => {
    await withFixture(cx3576, async (fx) => {
      rewriteRaucUnit(fx, '--mount=/run/rauc/mnt service', '--override-boot-slot B --mount=/run/rauc/mnt service')
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('a shipped unit passes --override-boot-slot')
      expect(r.message).toContain(RAUC_UNIT)
      expect(r.message).toContain('--override-boot-slot B')
    })
  })

  test('in the `=` spelling', async () => {
    await withFixture(cx3576, async (fx) => {
      rewriteRaucUnit(fx, 'service\n', 'service --override-boot-slot=B\n')
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('--override-boot-slot=B')
    })
  })

  test('on a CONTINUATION line, which an unfolded reader would miss', async () => {
    await withFixture(cx3576, async (fx) => {
      rewriteRaucUnit(
        fx,
        'ExecStart=/usr/bin/rauc --mount=/run/rauc/mnt service\n',
        'ExecStart=/usr/bin/rauc \\\n    --override-boot-slot B \\\n    --mount=/run/rauc/mnt service\n',
      )
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('--override-boot-slot B')
    })
  })

  test('in a DROP-IN, which is where an override is added in practice', async () => {
    await withFixture(cx3576, async (fx) => {
      // The real shape: an empty `ExecStart=` clears the vendor's, and the
      // second line replaces it. The vendor unit is untouched, so a check that
      // read only `rauc.service` would report green.
      put(fx, '/etc/systemd/system/rauc.service.d/10-slot.conf',
        '[Service]\nExecStart=\nExecStart=/usr/bin/rauc --override-boot-slot A service\n')
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('/etc/systemd/system/rauc.service.d/10-slot.conf')
    })
  })

  test('behind a shell, where rauc is not argv[0]', async () => {
    await withFixture(cx3576, async (fx) => {
      rewriteRaucUnit(
        fx,
        'ExecStart=/usr/bin/rauc --mount=/run/rauc/mnt service\n',
        'ExecStart=/bin/sh -c "exec /usr/bin/rauc --override-boot-slot B service"\n',
      )
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('--override-boot-slot B')
    })
  })

  test('an enablement symlink does not report the same unit twice', async () => {
    await withFixture(cx3576, async (fx) => {
      rewriteRaucUnit(fx, 'service\n', 'service --override-boot-slot=B\n')
      const wants = join(fx.root, '/etc/systemd/system/multi-user.target.wants')
      mkdirSync(wants, { recursive: true })
      symlinkSync(RAUC_UNIT, join(wants, 'rauc.service'))
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message.match(/--override-boot-slot=B/g)).toHaveLength(1)
    })
  })
})

describe('the search space is counted, so the assertion cannot pass vacuously', () => {
  test('RED when no unit starts rauc at all', async () => {
    await withFixture(cx3576, async (fx) => {
      // The unit stays, and so does every other unit in the tree with an
      // ExecStart of its own. Only rauc's command line goes. A check that
      // called every command line a rauc command line would stay green here.
      rewriteRaucUnit(fx, 'ExecStart=/usr/bin/rauc --mount=/run/rauc/mnt service\n', '')
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('no shipped unit starts rauc at all')
    })
  })

  test('RED when the unit trees are gone entirely', async () => {
    await withFixture(cx3576, async (fx) => {
      for (const tree of ['/etc/systemd/system', '/usr/lib/systemd/system']) {
        rmSync(join(fx.root, tree), { recursive: true, force: true })
      }
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('no shipped unit starts rauc at all')
    })
  })

  test('a rauc command line in the admin tree is read too', async () => {
    await withFixture(cx3576, async (fx) => {
      put(fx, '/usr/local/lib/systemd/system/mos-slot-pin.service',
        '[Service]\nExecStart=/usr/bin/rauc --override-boot-slot A status\n')
      const r = await drive(fx)
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('/usr/local/lib/systemd/system/mos-slot-pin.service')
    })
  })
})
