// The PLAN-022 kernel checks, driven from the failing side.
//
// Every case here mutates the healthy packed-root fixture and asserts the
// baseline green FIRST, because a check that reports PASS and a check that
// cannot report anything else are indistinguishable against a healthy root.
//
// The mutations are the shapes the failure actually takes on this board:
//
//   - `# CONFIG_WIREGUARD is not set`, which is how a kernel config spells a
//     symbol that is off. It is a line that MENTIONS the symbol, so a check
//     grepping for the name alone reads it as present.
//   - `CONFIG_BRIDGE_VLAN_FILTERING=y` as the only BRIDGE-ish line, which is
//     the prefix collision: it satisfies a `startsWith('CONFIG_BRIDGE')`
//     reader while `CONFIG_BRIDGE` itself is absent.
//   - a module the index still lists whose object was never packed. This is
//     the one the config check cannot see: `=m` is exactly as true after the
//     object goes missing as before.
//   - two `/boot/config-*` files, i.e. two kernels in one root, where reading
//     the first would be an assertion about a kernel the image may not boot.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { KERNEL_CHECKS, configLines, kernelRelease, resolveModule } from './checks-kernel.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult } from './parity.ts'

const x64 = loadBoard(boardEnvPath('x64'))

/** The release the fixture seeds; spelled independently, as the fixture is. */
const RELEASE = '6.12.101+deb13-amd64'

const CONFIG_ID = 'kernel-config-declares-plan022-net'
const MODPROBE_ID = 'kernel-modules-resolve-plan022-net'

function checkNamed(id: string): CheckCase {
  const found = KERNEL_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no kernel check is registered as '${id}'. Registered: `
      + KERNEL_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

async function only(fx: RootFixture, id: string): Promise<CheckResult> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  const first = got[0]
  if (first === undefined) throw new Error(`check '${id}' produced no result`)
  return first
}

function write(fx: RootFixture, path: string, content: string): void {
  const full = join(fx.root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** Run `body` against a fresh fixture, with both checks green first. */
async function withHealthyRoot(body: (fx: RootFixture) => Promise<void>): Promise<void> {
  const fx = packedRootFixture(x64)
  try {
    expect((await only(fx, CONFIG_ID)).verdict).toBe('pass')
    expect((await only(fx, MODPROBE_ID)).verdict).toBe('pass')
    await body(fx)
  }
  finally {
    fx.dispose()
  }
}

describe('the register entries', () => {
  test('both checks are scoped to x64 and to no other board', () => {
    // cx3576 asserts the same symbols at BUILD time -- the fragment's =y lines
    // are grepped against the final .config and the build fails otherwise -- so
    // a cx3576 image cannot exist without them. Scoping is what keeps this from
    // being a second, weaker opinion about a board that already has a hard one.
    expect(KERNEL_CHECKS.map(c => c.id).sort()).toEqual([CONFIG_ID, MODPROBE_ID])
    for (const check of KERNEL_CHECKS) {
      expect(check.boards).toEqual(['x64'])
    }
  })
})

describe('the shipped kernel config', () => {
  test('a symbol switched off is read as off, not as mentioned', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/boot/config-${RELEASE}`,
        'CONFIG_VLAN_8021Q=m\n'
        + 'CONFIG_BRIDGE=m\n'
        + '# CONFIG_WIREGUARD is not set\n')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_WIREGUARD')
      expect(got.message).toContain('no such line')
    })
  })

  test('a longer symbol sharing the prefix does not answer for the short one', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/boot/config-${RELEASE}`,
        'CONFIG_VLAN_8021Q=m\n'
        + 'CONFIG_BRIDGE_VLAN_FILTERING=y\n'
        + 'CONFIG_WIREGUARD=y\n')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_BRIDGE')
    })
  })

  test('the PASS message quotes the config lines it read', async () => {
    await withHealthyRoot(async (fx) => {
      const got = await only(fx, CONFIG_ID)
      expect(got.message).toContain('CONFIG_VLAN_8021Q=m')
      expect(got.message).toContain('CONFIG_BRIDGE=m')
      expect(got.message).toContain('CONFIG_WIREGUARD=y')
      expect(got.message).toContain(`/boot/config-${RELEASE}`)
    })
  })

  test('two kernel configs in one root is a failure, not a pick', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, '/boot/config-6.1.0-99-amd64', 'CONFIG_VLAN_8021Q=y\n')
      expect(kernelRelease(fx.root)).toBe('')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('no single /boot/config-*')
    })
  })

  test('an absent config file fails both checks rather than resolving nothing quietly', async () => {
    await withHealthyRoot(async (fx) => {
      rmSync(join(fx.root, 'boot', `config-${RELEASE}`))
      expect((await only(fx, CONFIG_ID)).verdict).toBe('fail')
      expect((await only(fx, MODPROBE_ID)).verdict).toBe('fail')
    })
  })
})

describe('modprobe resolution', () => {
  test('a built-in symbol resolves without an object file', async () => {
    await withHealthyRoot(async (fx) => {
      const got = resolveModule(fx.root, RELEASE, 'wireguard')
      expect(got.how).toBe('builtin')
      expect(got.missingDeps).toEqual([])
    })
  })

  test('a module the index lists whose object was never packed is UNRESOLVED', async () => {
    await withHealthyRoot(async (fx) => {
      // The config still says =m. This is the whole reason the two checks are
      // separate: nothing about the config file changes here.
      rmSync(join(fx.root, 'lib', 'modules', RELEASE, 'kernel/net/8021q/8021q.ko'))
      expect((await only(fx, CONFIG_ID)).verdict).toBe('pass')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('8021q')
      expect(got.message).toContain('MISSING')
      expect(got.message).toContain('VLAN interfaces')
    })
  })

  test('a dependency that is missing fails the module that needs it', async () => {
    await withHealthyRoot(async (fx) => {
      // bridge.ko itself is present; stp.ko, which must load first, is not.
      rmSync(join(fx.root, 'lib', 'modules', RELEASE, 'kernel/net/802/stp.ko'))
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('stp.ko')
      expect(got.message).toContain('bridge interfaces')
    })
  })

  test('a module named in neither index is UNRESOLVED', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/lib/modules/${RELEASE}/modules.dep`,
        'kernel/bridge/bridge.ko: kernel/net/802/stp.ko kernel/net/llc/llc.ko\n')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('8021q=UNRESOLVED')
    })
  })

  test('the module name is taken from the object, compression suffix and all', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/lib/modules/${RELEASE}/modules.dep`,
        'kernel/net/8021q/8021q.ko.xz: \n'
        + 'kernel/bridge/bridge.ko.xz: \n')
      write(fx, `/lib/modules/${RELEASE}/kernel/net/8021q/8021q.ko.xz`, 'x')
      write(fx, `/lib/modules/${RELEASE}/kernel/bridge/bridge.ko.xz`, 'x')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('8021q.ko.xz')
    })
  })

  test('the PASS message names how each of the three resolved', async () => {
    await withHealthyRoot(async (fx) => {
      const got = await only(fx, MODPROBE_ID)
      expect(got.message).toContain('8021q=kernel/net/8021q/8021q.ko')
      expect(got.message).toContain('bridge=kernel/bridge/bridge.ko')
      expect(got.message).toContain('wireguard=builtin')
    })
  })
})

describe('the readers, directly', () => {
  test('configLines reports the raw line and the parsed value', async () => {
    await withHealthyRoot(async (fx) => {
      const got = configLines(fx.root, RELEASE)
      expect(got.map(l => l.value)).toEqual(['m', 'm', 'y'])
      expect(got.map(l => l.line)).toContain('CONFIG_VLAN_8021Q=m')
    })
  })

  test('a value that is neither y nor m is not a value', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/boot/config-${RELEASE}`, 'CONFIG_VLAN_8021Q=n\nCONFIG_BRIDGE=m\nCONFIG_WIREGUARD=y\n')
      const got = configLines(fx.root, RELEASE)
      expect(got.filter(l => l.value === undefined).map(l => l.symbol)).toEqual(['CONFIG_VLAN_8021Q'])
      expect(got.map(l => l.line)).toContain('CONFIG_VLAN_8021Q=n')
      expect((await only(fx, CONFIG_ID)).verdict).toBe('fail')
    })
  })
})
