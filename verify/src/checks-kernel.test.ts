// The kernel-floor checks, driven from the failing side.
//
// Every case here mutates the healthy packed-root fixture and asserts the
// baseline green FIRST, because a check that reports PASS and a check that
// cannot report anything else are indistinguishable against a healthy root.
//
// The mutations are the shapes the failure actually takes on this board:
//
//   - `# CONFIG_DM_VERITY is not set`, which is how a kernel config spells a
//     symbol that is off. It is a line that MENTIONS the symbol, so a check
//     grepping for the name alone reads it as present.
//   - `CONFIG_BRIDGE_VLAN_FILTERING=y` as the only BRIDGE-ish line, which is
//     the prefix collision: it satisfies a `startsWith('CONFIG_BRIDGE')`
//     reader while `CONFIG_BRIDGE` itself is absent.
//   - `=m` for a floor symbol. This is the case PLAN-073 added and the one a
//     distribution kernel would produce: twelve of these are `=m` in Debian's
//     amd64 config and `CONFIG_DM_INIT` is absent from it entirely. A board
//     that loads nothing before its root exists cannot use a module here, so
//     `=m` is a failure and not a weaker pass.
//   - a floor name that resolves to a `.ko` instead of to the kernel image,
//     which the config check cannot see: the config is free to say `=y` while
//     the index the device actually reads says otherwise.
//   - an empty `modules.builtin`, i.e. the index every answer comes from
//     missing from the root.
//   - two `/boot/config-*` files, i.e. two kernels in one root, where reading
//     the first would be an assertion about a kernel the image may not boot.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { KERNEL_CHECKS, builtinCount, configLines, kernelRelease, resolveModule } from './checks-kernel.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult } from './parity.ts'

const x64 = loadBoard(boardEnvPath('x64'))

/** The release the fixture seeds; spelled independently, as the fixture is. */
const RELEASE = '6.12.107'

const CONFIG_ID = 'kernel-config-floor-built-in'
const MODPROBE_ID = 'kernel-floor-resolves-builtin'

/**
 * A complete, healthy config, with any symbol overridden.
 *
 * Spelled out here rather than imported, for the same reason the fixture spells
 * its own: a case that built its input from the check's own list would move
 * with the check and stay green through a change to what the image must carry.
 */
function config(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    CONFIG_BLK_DEV_DM: 'y',
    CONFIG_DM_INIT: 'y',
    CONFIG_DM_VERITY: 'y',
    CONFIG_SQUASHFS: 'y',
    CONFIG_OVERLAY_FS: 'y',
    CONFIG_VLAN_8021Q: 'y',
    CONFIG_BRIDGE: 'y',
    CONFIG_WIREGUARD: 'y',
    CONFIG_VETH: 'y',
    CONFIG_NFT_FIB_INET: 'y',
    CONFIG_NFT_FIB_IPV4: 'y',
    CONFIG_NFT_FIB_IPV6: 'y',
  }
  const merged = { ...base, ...overrides }
  return Object.entries(merged)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => (v === 'off' ? `# ${k} is not set` : `${k}=${v}`))
    .join('\n') + '\n'
}

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
    // Both boards assert the floor at BUILD time -- the fragment's =y lines are
    // grepped against the final .config and the build fails otherwise. What
    // scopes these to x64 is that only x64's kernel package puts its config IN
    // THE ROOT; cx3576's stays on the boot partition and there is nothing here
    // to read.
    expect(KERNEL_CHECKS.map(c => c.id).sort()).toEqual([MODPROBE_ID, CONFIG_ID].sort())
    for (const check of KERNEL_CHECKS) {
      expect(check.boards).toEqual(['x64'])
    }
  })
})

describe('the shipped kernel config', () => {
  test('a symbol switched off is read as off, not as mentioned', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/boot/config-${RELEASE}`, config({ CONFIG_DM_VERITY: 'off' }))
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_DM_VERITY')
      expect(got.message).toContain('no such line')
    })
  })

  test('a longer symbol sharing the prefix does not answer for the short one', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/boot/config-${RELEASE}`,
        config({ CONFIG_BRIDGE: '' }) + 'CONFIG_BRIDGE_VLAN_FILTERING=y\n')
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_BRIDGE')
    })
  })

  test('a floor symbol built as a MODULE fails, which is the distribution-kernel shape', async () => {
    await withHealthyRoot(async (fx) => {
      // Exactly what Debian's amd64 kernel says about these two. It is a real
      // configuration, it is not a typo, and on a board that assembles its root
      // before any module can be loaded it does not boot.
      write(fx, `/boot/config-${RELEASE}`,
        config({ CONFIG_DM_VERITY: 'm', CONFIG_SQUASHFS: 'm' }))
      const got = await only(fx, CONFIG_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('CONFIG_DM_VERITY')
      expect(got.message).toContain('CONFIG_SQUASHFS')
      expect(got.message).toContain('CONFIG_DM_VERITY=m')
      expect(got.message).toContain('no initramfs')
    })
  })

  test('CONFIG_DM_INIT absent entirely fails, and it is checked in the config alone', async () => {
    await withHealthyRoot(async (fx) => {
      // There is no dm-init.ko, so the resolution check cannot see this symbol
      // at all -- and it is the one that makes the no-initramfs boot possible.
      write(fx, `/boot/config-${RELEASE}`, config({ CONFIG_DM_INIT: '' }))
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
      expect(got.message).toContain('CONFIG_BRIDGE=y')
      expect(got.message).toContain(`/boot/config-${RELEASE}`)
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

  test('a floor name that is a loadable module fails, config unchanged', async () => {
    await withHealthyRoot(async (fx) => {
      // 8021q leaves modules.builtin and appears in modules.dep with its object
      // present, so `modprobe 8021q` would SUCCEED on a running system. It
      // still fails here, and that is the point: this board has no running
      // system at the moment it needs the root. Nothing about the config file
      // changes, which is why the two checks are separate.
      write(fx, `/lib/modules/${RELEASE}/modules.builtin`,
        'kernel/drivers/md/dm-mod.ko\n'
        + 'kernel/drivers/md/dm-verity.ko\n'
        + 'kernel/fs/squashfs/squashfs.ko\n'
        + 'kernel/fs/overlayfs/overlay.ko\n'
        + 'kernel/net/bridge/bridge.ko\n'
        + 'kernel/drivers/net/wireguard/wireguard.ko\n'
        + 'kernel/drivers/net/veth.ko\n'
        + 'kernel/net/netfilter/nft_fib.ko\n'
        + 'kernel/net/netfilter/nft_fib_inet.ko\n'
        + 'kernel/net/ipv4/netfilter/nft_fib_ipv4.ko\n'
        + 'kernel/net/ipv6/netfilter/nft_fib_ipv6.ko\n')
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
      expect(got.message).toContain('8021q=UNRESOLVED')
    })
  })

  test('an empty modules.builtin fails everything, and the count says why', async () => {
    await withHealthyRoot(async (fx) => {
      // The index every builtin answer comes from, gone. Without the count in
      // the message this reads identically to a kernel configured wrong, which
      // sends the reader to the config file rather than to the packing.
      write(fx, `/lib/modules/${RELEASE}/modules.builtin`, '')
      expect(builtinCount(fx.root, RELEASE)).toBe(0)
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('0 entries in modules.builtin')
    })
  })

  test('the module name is taken from the object, compression suffix and all', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/lib/modules/${RELEASE}/modules.builtin`,
        'kernel/drivers/md/dm-mod.ko.xz\n'
        + 'kernel/drivers/md/dm-verity.ko.xz\n'
        + 'kernel/fs/squashfs/squashfs.ko.xz\n'
        + 'kernel/fs/overlayfs/overlay.ko.xz\n'
        + 'kernel/net/8021q/8021q.ko.xz\n'
        + 'kernel/net/bridge/bridge.ko.xz\n'
        + 'kernel/drivers/net/wireguard/wireguard.ko.xz\n'
        + 'kernel/drivers/net/veth.ko.xz\n'
        + 'kernel/net/netfilter/nft_fib_inet.ko.xz\n'
        + 'kernel/net/ipv4/netfilter/nft_fib_ipv4.ko.xz\n'
        + 'kernel/net/ipv6/netfilter/nft_fib_ipv6.ko.xz\n')
      const got = await only(fx, MODPROBE_ID)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('8021q.ko.xz')
    })
  })

  test('the PASS message names how each one resolved, and over how many entries', async () => {
    await withHealthyRoot(async (fx) => {
      const got = await only(fx, MODPROBE_ID)
      expect(got.message).toContain('dm-verity=builtin')
      expect(got.message).toContain('bridge=builtin')
      expect(got.message).toContain('wireguard=builtin')
      expect(got.message).toContain('12 entries in modules.builtin')
    })
  })
})

describe('the readers, directly', () => {
  test('configLines reports the raw line and the parsed value', async () => {
    await withHealthyRoot(async (fx) => {
      const got = configLines(fx.root, RELEASE)
      expect(got.every(l => l.value === 'y')).toBe(true)
      expect(got.map(l => l.line)).toContain('CONFIG_VLAN_8021Q=y')
    })
  })

  test('a value that is neither y nor m is not a value', async () => {
    await withHealthyRoot(async (fx) => {
      write(fx, `/boot/config-${RELEASE}`, config({ CONFIG_VLAN_8021Q: 'n' }))
      const got = configLines(fx.root, RELEASE)
      expect(got.filter(l => l.value === undefined).map(l => l.symbol)).toEqual(['CONFIG_VLAN_8021Q'])
      expect(got.map(l => l.line)).toContain('CONFIG_VLAN_8021Q=n')
      expect((await only(fx, CONFIG_ID)).verdict).toBe('fail')
    })
  })
})
