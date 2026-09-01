// The networking symbols the network reconciler needs from the kernel, read off the image
// that ships it.
//
// x64 ONLY, and the scope is the point. cx3576 builds its kernel in-tree, so
// `os/boards/common/mos-required.fragment` is merged before `olddefconfig` and
// every `=y` line in it is then asserted against the final `.config`, failing
// the build otherwise (`os/boards/cx3576/bsp/kernel/Dockerfile`) --
// a symbol that fragment names cannot be missing from a cx3576 image, because
// there is no cx3576 image. x64 has no such build: the kernel is Debian's
// `linux-image-6.12.101+deb13-amd64`, installed whole as a package
// (`mos-board-x64` Depends on it), and **the Debian config is
// not in this repository**. Nothing in-tree proves what it sets. So the x64
// half of the same guarantee has to be read off the built artefact, which is
// what these two checks are.
//
// `=y` OR `=m` here, unlike the fragment's `=y`-only floor. The reason is a
// board fact rather than a relaxation: cx3576 boots dm-verity with no initramfs
// and cannot load a module at all, while x64 ships `kmod`
// (`mos-system` Depends on it) and a full Debian module set, so
// `=m` there is a symbol that is genuinely available. Which is also why the
// second check exists: `=m` in a config file is a claim about a build, not
// about this image, and a module whose `.ko` was never packed resolves to
// nothing at `modprobe` time with the config line still reading `=m`.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { packedRoot } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { verdict } from './verdict.ts'

/**
 * The symbols, and the module each one is loaded by.
 *
 * The two names are not the same string and neither can be derived from the
 * other -- `CONFIG_VLAN_8021Q` is loaded as `8021q` and `CONFIG_BRIDGE` as
 * `bridge` -- so both are written down. A check that guessed one from the other
 * would report a missing module for a symbol that is present under its real
 * name, which reads as an image defect and is not one.
 */
const REQUIRED = [
  { symbol: 'CONFIG_VLAN_8021Q', module: '8021q', what: 'VLAN interfaces' },
  { symbol: 'CONFIG_BRIDGE', module: 'bridge', what: 'bridge interfaces' },
  { symbol: 'CONFIG_WIREGUARD', module: 'wireguard', what: 'WireGuard tunnels' },
  // The container-network floor, the same set os/boards/common/mos-required.fragment
  // pins =y for the in-tree kernels: netavark creates the container/host veth
  // pair and programs `fib daddr type local` in an inet table. The per-symbol
  // citations into the pinned netavark source live in
  // os/tests/netavark-kernel-config-test.sh. CONFIG_NFT_FIB itself is not
  // listed here: both address families select it, and its nft_fib.ko is
  // reached through the three modules' own modules.dep dependency walk.
  { symbol: 'CONFIG_VETH', module: 'veth', what: 'container/host veth pairs' },
  { symbol: 'CONFIG_NFT_FIB_INET', module: 'nft_fib_inet', what: "netavark's inet fib port-forward rule" },
  { symbol: 'CONFIG_NFT_FIB_IPV4', module: 'nft_fib_ipv4', what: 'the IPv4 fib lookup that rule delegates to' },
  { symbol: 'CONFIG_NFT_FIB_IPV6', module: 'nft_fib_ipv6', what: 'the IPv6 fib lookup that rule delegates to' },
] as const

/** `VLAN_8021Q, BRIDGE, …` -- the one list, spelled from the register. */
const SYMBOL_LIST = REQUIRED.map(r => r.symbol.slice('CONFIG_'.length)).join(', ')
const MODULE_LIST = REQUIRED.map(r => r.module).join(', ')

/** What a `/boot/config-*` file was found to say about one symbol. */
export interface ConfigLine {
  readonly symbol: string
  /** The whole line as the config spells it, or undefined when there is none. */
  readonly line: string | undefined
  /** `y`, `m`, or undefined for absent-or-`is not set`. */
  readonly value: 'y' | 'm' | undefined
}

/**
 * The kernel version this root ships, taken from `/boot/config-*`.
 *
 * EXACTLY one, and more than one is an error rather than a pick. A root
 * carrying two kernel configs has two kernels in it, and which of them the
 * bootloader launches is not a question this file can answer -- reading the
 * first would be asserting about a kernel the image may never boot.
 */
export function kernelRelease(root: string): string {
  let entries: string[]
  try {
    entries = readdirSync(join(root, 'boot'))
  }
  catch {
    return ''
  }
  const configs = entries.filter(e => e.startsWith('config-'))
  const only = configs.length === 1 ? configs[0] : undefined
  return only === undefined ? '' : only.slice('config-'.length)
}

/**
 * Read one `/boot/config-<release>` and answer for each required symbol.
 *
 * Anchored at the start of the line and matched to the `=`, so
 * `CONFIG_BRIDGE_VLAN_FILTERING=y` is not read as an answer about
 * `CONFIG_BRIDGE`, and `# CONFIG_WIREGUARD is not set` is read as the absence
 * it is rather than as a line mentioning the symbol.
 */
export function configLines(root: string, release: string): ConfigLine[] {
  let text = ''
  try {
    text = readFileSync(join(root, 'boot', `config-${release}`), 'utf8')
  }
  catch {
    text = ''
  }
  const lines = text.split('\n')
  return REQUIRED.map(({ symbol }) => {
    const found = lines.find(l => l.startsWith(`${symbol}=`))
    if (found === undefined) return { symbol, line: undefined, value: undefined }
    const raw = found.slice(symbol.length + 1).trim()
    const value = raw === 'y' ? 'y' : raw === 'm' ? 'm' : undefined
    return { symbol, line: found.trim(), value }
  })
}

/** How a module name resolves under `/lib/modules/<release>`, and to what. */
export interface Resolution {
  readonly module: string
  /** `builtin`, `module`, or `none`. */
  readonly how: 'builtin' | 'module' | 'none'
  /**
   * For `builtin` and `module`: the path the index named it by, relative to
   * `/lib/modules/<release>`. For `none`: the empty string.
   */
  readonly path: string
  /**
   * Dependency object files the index says must load first and which are NOT
   * present in this root. Non-empty means `modprobe` would fail on a module
   * `modules.dep` does list -- the case a "is it in modules.dep" check misses.
   */
  readonly missingDeps: readonly string[]
}

/** `8021q` from `kernel/net/8021q/8021q.ko.xz`; compression suffix and all. */
function moduleNameOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.indexOf('.ko')
  return dot === -1 ? base : base.slice(0, dot)
}

/**
 * What `modprobe -n <name>` would conclude, resolved against this root's own
 * indexes rather than the host's.
 *
 * The order is `modprobe`'s: `modules.builtin` first, because a symbol compiled
 * in has no object file to find and `modprobe` succeeds on it without loading
 * anything; then `modules.dep`, whose left-hand side is the module and whose
 * right-hand side is every object that must load before it. Both index files
 * name paths relative to `/lib/modules/<release>`.
 *
 * The dependency existence walk is what makes this an answer about THIS IMAGE.
 * `modules.dep` is generated by `depmod` at package-build time and describes
 * the module set as it was then; a root that dropped an object during packing
 * still carries the index entry that names it, so "listed in modules.dep" is a
 * claim about Debian's build host and "listed AND every named object present"
 * is a claim about the artefact under test.
 */
export function resolveModule(root: string, release: string, module: string): Resolution {
  const modDir = join(root, 'lib', 'modules', release)
  const read = (name: string): string[] => {
    try {
      return readFileSync(join(modDir, name), 'utf8').split('\n').filter(l => l !== '')
    }
    catch {
      return []
    }
  }

  const builtin = read('modules.builtin').find(p => moduleNameOf(p) === module)
  if (builtin !== undefined) {
    return { module, how: 'builtin', path: builtin, missingDeps: [] }
  }

  for (const line of read('modules.dep')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const self = line.slice(0, colon).trim()
    if (moduleNameOf(self) !== module) continue
    const deps = line.slice(colon + 1).trim().split(/\s+/).filter(d => d !== '')
    const missing = [self, ...deps].filter(p => !existsSync(join(modDir, p)))
    return { module, how: 'module', path: self, missingDeps: missing }
  }

  return { module, how: 'none', path: '', missingDeps: [] }
}

const CONFIG_ID = 'kernel-config-declares-plan022-net'
const MODPROBE_ID = 'kernel-modules-resolve-plan022-net'

export const KERNEL_CHECKS: readonly CheckCase[] = [
  {
    // The config file the running kernel was built from, as the image carries
    // it. Debian installs it beside the kernel it describes, which is what
    // makes this readable at all -- the source config is not in this tree.
    id: CONFIG_ID,
    boards: ['x64'],
    shell: {
      pass: 'the shipped kernel config declares',
      fail: 'the shipped kernel config does not declare',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const release = kernelRelease(root)
      if (release === '') {
        return [verdict(CONFIG_ID, false,
          'no single /boot/config-* in the packed root, so which kernel config describes the kernel '
          + `this image boots cannot be decided. The virtual link kinds and the container network need `
          + `${SYMBOL_LIST}, and none of them can be read`)]
      }
      const found = configLines(root, release)
      const bad = found.filter(f => f.value === undefined)
      const quoted = found
        .map(f => f.line ?? `${f.symbol} (no such line; absent or "is not set")`)
        .join(', ')
      const ok = bad.length === 0
      return [verdict(
        CONFIG_ID,
        ok,
        ok
          ? `the shipped kernel config declares ${SYMBOL_LIST} in `
            + `/boot/config-${release}: ${quoted}`
          : `the shipped kernel config does not declare ${bad.map(b => b.symbol).join(', ')} as =y or `
            + `=m in /boot/config-${release}: ${quoted}. mosd renders .netdev units for VLAN, bridge `
            + `and WireGuard interfaces, and netavark needs the veth pair and the nft fib expression `
            + `for every bridge network; a device the kernel has no support for is never created, `
            + `while the write or the container start that asked for it reports success`,
      )]
    },
  },

  {
    // `=m` promises a module; this asks whether the module is THERE. The two
    // are separate checks rather than one because they fail for unrelated
    // reasons and the repairs differ: a missing symbol is a kernel Debian did
    // not build, a missing object is a root this repository packed wrong.
    id: MODPROBE_ID,
    boards: ['x64'],
    shell: {
      pass: 'modprobe resolves',
      fail: 'modprobe would not resolve',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const release = kernelRelease(root)
      if (release === '') {
        return [verdict(MODPROBE_ID, false,
          'no single /boot/config-* in the packed root, so there is no kernel release to resolve '
          + '/lib/modules/<release> against and no module lookup can be performed')]
      }
      const resolved = REQUIRED.map(r => resolveModule(root, release, r.module))
      const bad = resolved.filter(r => r.how === 'none' || r.missingDeps.length > 0)
      const quoted = resolved
        .map(r => r.how === 'builtin'
          ? `${r.module}=builtin (${r.path})`
          : r.how === 'module'
            ? `${r.module}=${r.path}${r.missingDeps.length === 0 ? '' : ` MISSING ${r.missingDeps.join(' ')}`}`
            : `${r.module}=UNRESOLVED`)
        .join(', ')
      const ok = bad.length === 0
      return [verdict(
        MODPROBE_ID,
        ok,
        ok
          ? `modprobe resolves ${MODULE_LIST} against /lib/modules/${release}: ${quoted}`
          : `modprobe would not resolve ${bad.map(b => b.module).join(', ')} against `
            + `/lib/modules/${release}: ${quoted}. A module listed in modules.dep whose object is not `
            + `in the root fails at load time with the config line still reading =m, so the config `
            + `check above stays green while ${REQUIRED.filter(r => bad.some(b => b.module === r.module))
              .map(r => r.what).join(' and ')} cannot be created on the device`,
      )]
    },
  },
]
