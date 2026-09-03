// The networking kernel checks, driven from the failing side.
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
//   - a required symbol that names NO module -- the eBPF floor and the
//     nf_tables family bools -- taken out of the config. Nothing in the
//     modprobe half can see that one, so if the config half did not fail on it
//     the symbol would be in the register and asserted by neither check.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { KERNEL_CHECKS, REQUIRED, RESOLVABLE, configLines, kernelRelease, resolveModule } from './checks-kernel.ts'
import type { CheckCase } from './checks.ts'
import { REPO_ROOT, boardEnvPath } from './paths.ts'
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

/**
 * Edit ONE line of the seeded kernel config, leaving every other line alone.
 *
 * Rewriting the whole file was fine when the register held three symbols; with
 * a register this long it makes every case fail for the same reason -- the
 * twenty lines the case did not bother to write -- and a case that goes red
 * for a reason it did not choose proves nothing about the reason it did.
 * Asserts the edit actually landed, so a renamed symbol turns the test red
 * here rather than leaving it asserting against an unmutated root.
 */
function editConfig(fx: RootFixture, from: string, to: string): void {
  const full = join(fx.root, 'boot', `config-${RELEASE}`)
  const before = readFileSync(full, 'utf8')
  expect(before).toContain(from)
  writeFileSync(full, before.replace(from, to))
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
      editConfig(fx, 'CONFIG_WIREGUARD=y', '# CONFIG_WIREGUARD is not set')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_WIREGUARD')
      expect(got.message).toContain('no such line')
    })
  })

  test('a longer symbol sharing the prefix does not answer for the short one', async () => {
    await withHealthyRoot(async (fx) => {
      // CONFIG_BRIDGE_VLAN_FILTERING=y is already in the seeded config; taking
      // the short symbol away leaves it as the only BRIDGE-ish line.
      editConfig(fx, 'CONFIG_BRIDGE=m\n', '')
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
        + 'kernel/bridge/bridge.ko.xz: \n'
        + 'kernel/drivers/net/veth.ko:\n'
        + 'kernel/net/ipv4/netfilter/nft_fib_ipv4.ko: kernel/net/netfilter/nft_fib.ko\n'
        + 'kernel/net/ipv6/netfilter/nft_fib_ipv6.ko: kernel/net/netfilter/nft_fib.ko\n'
        + 'kernel/net/netfilter/nft_fib_inet.ko: kernel/net/netfilter/nft_fib.ko\n'
        // The firewall floor's modules, whose objects the fixture already
        // packed; the index has to name them or this rewrite would fail the
        // check for a reason that has nothing to do with the suffix.
        + 'kernel/net/netfilter/x_tables.ko:\n'
        + 'kernel/net/netfilter/nf_conntrack.ko:\n'
        + 'kernel/net/netfilter/nf_tables.ko:\n'
        + 'kernel/net/netfilter/nft_ct.ko:\n'
        + 'kernel/net/netfilter/nf_nat.ko:\n'
        + 'kernel/net/netfilter/nft_nat.ko:\n'
        + 'kernel/net/netfilter/nft_masq.ko:\n'
        + 'kernel/net/netfilter/nft_compat.ko.xz: kernel/net/netfilter/x_tables.ko\n'
        + 'kernel/net/bridge/br_netfilter.ko:\n'
        + 'kernel/net/bridge/netfilter/nf_conntrack_bridge.ko:\n')
      write(fx, `/lib/modules/${RELEASE}/kernel/net/8021q/8021q.ko.xz`, 'x')
      write(fx, `/lib/modules/${RELEASE}/kernel/bridge/bridge.ko.xz`, 'x')
      write(fx, `/lib/modules/${RELEASE}/kernel/net/netfilter/nft_compat.ko.xz`, 'x')
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
  test('configLines answers for every required symbol, in the register order', async () => {
    await withHealthyRoot(async (fx) => {
      const got = configLines(fx.root, RELEASE)
      // One answer per requirement and no silent drop: a reader that skipped a
      // symbol would leave the check reporting green about a line it never read.
      expect(got.map(l => l.symbol)).toEqual(REQUIRED.map(r => r.symbol))
      expect(got.filter(l => l.value === undefined)).toEqual([])
      expect(got.find(l => l.symbol === 'CONFIG_VLAN_8021Q'))
        .toEqual({ symbol: 'CONFIG_VLAN_8021Q', line: 'CONFIG_VLAN_8021Q=m', value: 'm' })
      // The two shapes the fixture seeds on purpose: a module symbol and a
      // module-less bool.
      expect(got.find(l => l.symbol === 'CONFIG_NF_TABLES')?.value).toBe('m')
      expect(got.find(l => l.symbol === 'CONFIG_BPF_JIT'))
        .toEqual({ symbol: 'CONFIG_BPF_JIT', line: 'CONFIG_BPF_JIT=y', value: 'y' })
    })
  })

  test('a value that is neither y nor m is not a value', async () => {
    await withHealthyRoot(async (fx) => {
      editConfig(fx, 'CONFIG_VLAN_8021Q=m', 'CONFIG_VLAN_8021Q=n')
      const got = configLines(fx.root, RELEASE)
      expect(got.filter(l => l.value === undefined).map(l => l.symbol)).toEqual(['CONFIG_VLAN_8021Q'])
      expect(got.map(l => l.line)).toContain('CONFIG_VLAN_8021Q=n')
      expect((await only(fx, CONFIG_ID)).verdict).toBe('fail')
    })
  })
})

describe('a symbol that names no module', () => {
  test('the register holds both shapes, so neither check runs over nothing', () => {
    // Either half emptying is silent: a modprobe check over no modules and a
    // config check over no bools both print the same green line as one that
    // compared everything.
    const builtinOnly = REQUIRED.filter(r => r.module === undefined)
    expect(RESOLVABLE.length).toBeGreaterThan(0)
    expect(builtinOnly.length).toBeGreaterThan(0)
    expect(RESOLVABLE.length + builtinOnly.length).toBe(REQUIRED.length)
    // The eBPF floor is the reason the shape exists; requiring it by name keeps
    // a later edit from satisfying the counts above with something else.
    expect(builtinOnly.map(r => r.symbol)).toContain('CONFIG_BPF_JIT')
  })

  test('taking it out of the config fails the config check, by name', async () => {
    await withHealthyRoot(async (fx) => {
      editConfig(fx, 'CONFIG_BPF_JIT=y\n', '')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_BPF_JIT')
      expect(got.message).toContain('no such line')
      // The failure says what was lost, not just which string was missing.
      expect(got.message).toContain('native compilation')
    })
  })

  test('"is not set" is read as absent for the module-less shape too', async () => {
    await withHealthyRoot(async (fx) => {
      editConfig(fx, 'CONFIG_CGROUP_BPF=y', '# CONFIG_CGROUP_BPF is not set')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_CGROUP_BPF')
    })
  })

  test('the modprobe check does not look it up, and says so instead of resolving it', async () => {
    await withHealthyRoot(async (fx) => {
      // The same mutation that turned the config check red above leaves this
      // one green: the two checks are separate, and this one never had an
      // opinion about a symbol with no object to find.
      editConfig(fx, 'CONFIG_BPF_JIT=y\n', '')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('BPF_JIT')
      expect(got.message).toContain('build no object of their own')
      // A module name conjured from a symbol that has none would show up here.
      expect(got.message).not.toContain('undefined')
      expect(got.message).not.toContain('bpf_jit=')
    })
  })

  test('a module the firewall floor added is resolved like any other', async () => {
    await withHealthyRoot(async (fx) => {
      rmSync(join(fx.root, 'lib', 'modules', RELEASE, 'kernel/net/netfilter/x_tables.ko'))
      expect((await only(fx, CONFIG_ID)).verdict).toBe('pass')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      // nft_compat names x_tables in its modules.dep line, so both the module
      // itself and the dependent are reported.
      expect(got.message).toContain('x_tables')
      expect(got.message).toContain('MISSING')
      expect(got.message).toContain('NFT_COMPAT depends on')
    })
  })
})

describe('the register and the shared fragment', () => {
  // Two halves of ONE floor: the fragment is merged into a board kernel and
  // asserted against the built .config, this register is asserted against
  // Debian's built artefact. Free to disagree, they are two floors, and the
  // board that is not the one you are looking at silently has the other.
  const fragment = readFileSync(
    join(REPO_ROOT, 'boards/common/mos-required.fragment'), 'utf8')
  const pinned = fragment.split('\n')
    .map(l => l.trim())
    .filter(l => /^CONFIG_[A-Z0-9_]+=y$/.test(l))
    .map(l => l.slice(0, l.indexOf('=')))

  test('the fragment pins something at all', () => {
    // Without this, an emptied or moved fragment makes the case below pass by
    // comparing the register against nothing.
    expect(pinned.length).toBeGreaterThanOrEqual(REQUIRED.length)
  })

  test('every symbol this check requires is pinned =y in the fragment', () => {
    const missing = REQUIRED.map(r => r.symbol).filter(sym => !pinned.includes(sym))
    expect(missing).toEqual([])
  })
})
