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
//   - `=m` for a floor symbol, which is exactly what a distribution kernel
//     produces and what a board with no initramfs cannot use.
//   - a floor name that resolves to a `.ko` instead of to the kernel image.
//     The config check cannot see it: the config is free to say `=y` while
//     the index the device actually reads says otherwise.
//   - an object `modules.dep` names that packing dropped. No FLOOR symbol
//     reaches that branch since PLAN-074 -- they are all builtin -- so the
//     walk runs over every module this root ships, and this is the case that
//     proves it still has subjects.
//   - an empty `modules.builtin`, i.e. the index every answer comes from
//     missing from the root.
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
import {
  KERNEL_CHECKS, REQUIRED, RESOLVABLE, brokenModules, builtinCount, configLines, depCount,
  kernelRelease, resolveModule,
} from './checks-kernel.ts'
import type { CheckCase } from './checks.ts'
import { REPO_ROOT, boardEnvPath } from './paths.ts'
import type { CheckResult } from './parity.ts'

const x64 = loadBoard(boardEnvPath('x64'))

/** The release the fixture seeds; spelled independently, as the fixture is. */
const RELEASE = '6.12.107'

const CONFIG_ID = 'kernel-config-floor-built-in'
const MODPROBE_ID = 'kernel-floor-resolves-builtin'

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
  test('the config check runs on every board and the modprobe check only on x64', () => {
    // Every board asserts the floor at BUILD time -- the fragment's =y lines are
    // grepped against the built .config and the build fails otherwise. That
    // proves nothing about an IMAGE, because the BSP kernel output is an input to
    // assembly and a stale one skips the build entirely; reading the shipped
    // /boot/config-* is the half that sees it, and since RFCT-343 every board
    // ships one. An UNDEFINED `boards` is what "every board" spells, so this
    // asserts the absence rather than a list that would have to be edited for a
    // fourth board.
    expect(KERNEL_CHECKS.map(c => c.id).sort()).toEqual([CONFIG_ID, MODPROBE_ID].sort())
    expect(KERNEL_CHECKS.find(c => c.id === CONFIG_ID)?.boards).toBeUndefined()
    // The modprobe check keeps its scope, for the reason checks-kernel.ts gives:
    // its dependency walk covers the whole of modules.dep, which is four entries
    // on this board and a vendor tree's worth on cx3576.
    expect(KERNEL_CHECKS.find(c => c.id === MODPROBE_ID)?.boards).toEqual(['x64'])
  })
})

describe('the shipped kernel config', () => {
  test('a symbol switched off is read as off, not as mentioned', async () => {
    await withHealthyRoot(async (fx) => {
      editConfig(fx, 'CONFIG_DM_VERITY=y', '# CONFIG_DM_VERITY is not set')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_DM_VERITY')
      expect(got.message).toContain('no such line')
    })
  })

  test('a longer symbol sharing the prefix does not answer for the short one', async () => {
    await withHealthyRoot(async (fx) => {
      // CONFIG_BRIDGE_VLAN_FILTERING=y stays in the fixture; only CONFIG_BRIDGE
      // itself goes. A startsWith reader would still find a BRIDGE-ish line.
      editConfig(fx, 'CONFIG_BRIDGE=y\n', '')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_BRIDGE')
    })
  })

  test('a floor symbol built as a MODULE fails -- the distribution-kernel shape', async () => {
    await withHealthyRoot(async (fx) => {
      // Exactly what Debian's amd64 kernel says about these two. Not a typo: a
      // real configuration, and on a board that assembles its root before any
      // module can be loaded it does not boot.
      editConfig(fx, 'CONFIG_DM_VERITY=y', 'CONFIG_DM_VERITY=m')
      editConfig(fx, 'CONFIG_SQUASHFS=y', 'CONFIG_SQUASHFS=m')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_DM_VERITY')
      expect(got.message).toContain('CONFIG_SQUASHFS')
      expect(got.message).toContain('CONFIG_DM_VERITY=m')
      expect(got.message).toContain('does not boot')
    })
  })

  test('CONFIG_DM_INIT absent fails the config check and only that one', async () => {
    await withHealthyRoot(async (fx) => {
      // There is no dm-init.ko, so the resolution check cannot see this symbol
      // at all -- and it is the one that makes the no-initramfs boot possible.
      editConfig(fx, 'CONFIG_DM_INIT=y\n', '')
      expect((await only(fx, CONFIG_ID)).verdict).toBe('fail')
      expect((await only(fx, MODPROBE_ID)).verdict).toBe('pass')
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

  test('the PASS message quotes the config lines it read', async () => {
    await withHealthyRoot(async (fx) => {
      const got = await only(fx, CONFIG_ID)
      expect(got.message).toContain('CONFIG_DM_INIT=y')
      expect(got.message).toContain('CONFIG_NF_TABLES=y')
      expect(got.message).toContain(`/boot/config-${RELEASE}`)
    })
  })
})

describe('modprobe resolution', () => {
  test('a floor symbol resolves as builtin, with no object file', async () => {
    await withHealthyRoot(async (fx) => {
      const got = resolveModule(fx.root, RELEASE, 'dm-verity')
      expect(got.how).toBe('builtin')
      expect(got.missingDeps).toEqual([])
    })
  })

  test('a floor name that is a loadable MODULE fails, config unchanged', async () => {
    await withHealthyRoot(async (fx) => {
      // 8021q leaves modules.builtin and appears in modules.dep with its object
      // present, so `modprobe 8021q` on a running system would SUCCEED. It
      // still fails here, and that is the point: this board has no running
      // system at the moment it needs the root. The config file is untouched,
      // which is why the two checks are separate.
      const idx = join(fx.root, 'lib', 'modules', RELEASE, 'modules.builtin')
      writeFileSync(idx, readFileSync(idx, 'utf8').replace('kernel/net/8021q/8021q.ko\n', ''))
      write(fx, `/lib/modules/${RELEASE}/modules.dep`, 'kernel/net/8021q/8021q.ko:\n')
      write(fx, `/lib/modules/${RELEASE}/kernel/net/8021q/8021q.ko`, '\x7fELF\n')
      expect((await only(fx, CONFIG_ID)).verdict).toBe('pass')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('8021q=MODULE')
      expect(got.message).toContain('VLAN interfaces')
    })
  })

  test('a name in neither index is UNRESOLVED', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/lib/modules/${RELEASE}/modules.builtin`, 'kernel/drivers/md/dm-mod.ko\n')
      write(fx, `/lib/modules/${RELEASE}/modules.dep`, '')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('=UNRESOLVED')
    })
  })

  test('an empty modules.builtin fails everything, and the count says why', async () => {
    await withHealthyRoot(async (fx) => {
      // The index every builtin answer comes from, gone. Without the count in
      // the message this reads exactly like a kernel configured wrong, which
      // sends the reader to the config file rather than to the packing.
      write(fx, `/lib/modules/${RELEASE}/modules.builtin`, '')
      expect(builtinCount(fx.root, RELEASE)).toBe(0)
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('0 entries in modules.builtin')
    })
  })

  test('a firewall-floor symbol is resolved like any other', async () => {
    await withHealthyRoot(async (fx) => {
      const idx = join(fx.root, 'lib', 'modules', RELEASE, 'modules.builtin')
      writeFileSync(idx, readFileSync(idx, 'utf8').replace('kernel/net/netfilter/x_tables.ko\n', ''))
      expect((await only(fx, CONFIG_ID)).verdict).toBe('pass')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('x_tables=UNRESOLVED')
      expect(got.message).toContain('NFT_COMPAT depends on')
    })
  })

  test('the module name is taken from the object, compression suffix and all', async () => {
    await withHealthyRoot(async (fx) => {
      const idx = join(fx.root, 'lib', 'modules', RELEASE, 'modules.builtin')
      writeFileSync(idx, readFileSync(idx, 'utf8').replace(/\.ko$/gm, '.ko.xz'))
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('.ko.xz')
    })
  })

  test('the PASS message names how each one resolved, over how many entries', async () => {
    await withHealthyRoot(async (fx) => {
      const got = await only(fx, MODPROBE_ID)
      expect(got.message).toContain('dm-verity=builtin')
      expect(got.message).toContain('nf_tables=builtin')
      expect(got.message).toContain(`${RESOLVABLE.length} entries in modules.builtin`)
    })
  })
})

describe('the dependency walk, which the floor no longer exercises', () => {
  // PLAN-074's cost, and the check that keeps it from being silent. Every floor
  // symbol is builtin now, so none of them reaches resolveModule's
  // missing-object branch -- the sharpest thing this check used to do. It is
  // applied to the whole of modules.dep instead, whose subjects are the modules
  // this kernel really ships.

  test('the walk has subjects: this root ships loadable modules', async () => {
    await withHealthyRoot(async (fx) => {
      // Without this the two cases below pass by walking nothing, which is
      // exactly the shape the restriction to the floor had.
      expect(depCount(fx.root, RELEASE)).toBeGreaterThan(0)
      expect(brokenModules(fx.root, RELEASE)).toEqual([])
    })
  })

  test('an object modules.dep names but packing dropped turns the check red', async () => {
    await withHealthyRoot(async (fx) => {
      rmSync(join(fx.root, 'lib', 'modules', RELEASE, 'kernel/net/netfilter/xt_LOG.ko'))
      expect(brokenModules(fx.root, RELEASE).map(b => b.module)).toEqual(['xt_LOG'])
      // The config check cannot see it: no config line changed.
      expect((await only(fx, CONFIG_ID)).verdict).toBe('pass')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('xt_LOG')
      expect(got.message).toContain('packing dropped the files')
    })
  })

  test('a DEPENDENCY that is missing fails the module that needs it', async () => {
    await withHealthyRoot(async (fx) => {
      // nf_log_syslog.ko is present; nf_log_common.ko, which must load first,
      // is not. "listed in modules.dep" would still be true of both.
      rmSync(join(fx.root, 'lib', 'modules', RELEASE, 'kernel/net/netfilter/nf_log_common.ko'))
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('nf_log_common.ko')
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
        .toEqual({ symbol: 'CONFIG_VLAN_8021Q', line: 'CONFIG_VLAN_8021Q=y', value: 'y' })
      // The two shapes the fixture seeds on purpose: a module symbol and a
      // module-less bool. Both are =y now -- the distinction is whether
      // modprobe has anything to look up, not what the config says.
      expect(got.find(l => l.symbol === 'CONFIG_NF_TABLES')?.value).toBe('y')
      expect(got.find(l => l.symbol === 'CONFIG_BPF_JIT'))
        .toEqual({ symbol: 'CONFIG_BPF_JIT', line: 'CONFIG_BPF_JIT=y', value: 'y' })
    })
  })

  test('a value that is neither y nor m is not a value', async () => {
    await withHealthyRoot(async (fx) => {
      editConfig(fx, 'CONFIG_VLAN_8021Q=y', 'CONFIG_VLAN_8021Q=n')
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

})

describe('the register and the shared fragment', () => {
  // Two halves of ONE floor: the fragment is merged into a board kernel and
  // asserted against the built .config, this register is asserted against the
  // artefact the image ships. Free to disagree, they are two floors, and the
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
