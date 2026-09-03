// The kernel floor, read off the image that ships it.
//
// x64 ONLY, and the scope is what it has always been rather than what it means.
// Both boards now build their own kernel and both merge
// `boards/common/mos-required.fragment` before `olddefconfig`, asserting every
// `=y` line against the final `.config` and failing the build otherwise -- so a
// symbol that fragment names cannot be missing from either board's kernel,
// because there would be no kernel. What differs is what reaches the ROOT:
// x64's kernel is packaged as `mos-kernel-x64` and installs `/boot/vmlinuz-*`
// and the `/boot/config-*` it was built from, while cx3576's stays on the boot
// partition and its config never enters the image. These two checks read that
// config, so they can only run where there is one.
//
// WHAT THEY USED TO SAY, AND WHY IT CHANGED. Until PLAN-074 x64 ran Debian's
// `linux-image-amd64`. That kernel's config is not in this repository and
// nothing in-tree proved what it set, so these checks were the x64 half of the
// same guarantee -- and they accepted `=y` OR `=m`, because that board shipped
// `kmod` and a full Debian module set and a module was genuinely available to
// it. That relaxation was a board fact, and the board fact is gone:
// `mos-kernel-x64` boots a dm-verity root from a `dm-mod.create=` table with NO
// INITRAMFS, so nothing can load a module before the root exists and `=m` for
// anything on this list is a kernel that hangs at rootwait. `=y` is now the
// only acceptable answer, and `builtin` is the only acceptable resolution.
//
// So the two checks keep their shapes and their reasons for being separate --
// a missing symbol is a kernel that was configured wrong, a missing index is a
// root this repository packed wrong -- and both got stricter rather than
// weaker. They are also what would go red if a distribution kernel ever came
// back into this image: Debian's amd64 config has twelve of these as `=m` and
// `CONFIG_DM_INIT` nowhere at all.

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
  // The boot floor: everything between "the disk exists" and "the verity root
  // is mounted". With no initramfs there is nothing to load a module FROM at
  // the moment these are needed, which is why they are here and not merely in
  // the fragment.
  { symbol: 'CONFIG_BLK_DEV_DM', module: 'dm-mod', what: 'the device mapper the verity root is built on' },
  { symbol: 'CONFIG_DM_VERITY', module: 'dm-verity', what: 'the dm-verity target itself' },
  { symbol: 'CONFIG_SQUASHFS', module: 'squashfs', what: 'the root filesystem type' },
  { symbol: 'CONFIG_OVERLAY_FS', module: 'overlay', what: 'the writable overlays above an immutable root' },
  // The virtual link kinds mosd renders .netdev units for.
  { symbol: 'CONFIG_VLAN_8021Q', module: '8021q', what: 'VLAN interfaces' },
  { symbol: 'CONFIG_BRIDGE', module: 'bridge', what: 'bridge interfaces' },
  { symbol: 'CONFIG_WIREGUARD', module: 'wireguard', what: 'WireGuard tunnels' },
  // The container-network floor, the same set boards/common/mos-required.fragment
  // pins =y: netavark creates the container/host veth pair and programs
  // `fib daddr type local` in an inet table. The per-symbol citations into the
  // pinned netavark source live in tests/netavark-kernel-config-test.sh.
  { symbol: 'CONFIG_VETH', module: 'veth', what: 'container/host veth pairs' },
  { symbol: 'CONFIG_NFT_FIB_INET', module: 'nft_fib_inet', what: "netavark's inet fib port-forward rule" },
  { symbol: 'CONFIG_NFT_FIB_IPV4', module: 'nft_fib_ipv4', what: 'the IPv4 fib lookup that rule delegates to' },
  { symbol: 'CONFIG_NFT_FIB_IPV6', module: 'nft_fib_ipv6', what: 'the IPv6 fib lookup that rule delegates to' },
] as const

/**
 * Symbols with no module of their own, checked in the config and nowhere else.
 *
 * `CONFIG_DM_INIT` is the whole reason this board has no initramfs: it is the
 * code inside dm-mod that parses `dm-mod.create=` off the kernel command line
 * at late_initcall. It compiles INTO dm-mod and there is no `dm-init.ko`, so
 * asking the module indexes about it would be asking a question with no
 * answer -- and getting `UNRESOLVED` for a symbol that is present.
 */
const CONFIG_ONLY = [
  { symbol: 'CONFIG_DM_INIT', what: 'the dm-mod.create= command-line parser this board boots through' },
] as const

const ALL_SYMBOLS = [...REQUIRED, ...CONFIG_ONLY]

/** `BLK_DEV_DM, DM_VERITY, …` -- the one list, spelled from the register. */
const SYMBOL_LIST = ALL_SYMBOLS.map(r => r.symbol.slice('CONFIG_'.length)).join(', ')
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
 *
 * `m` is still distinguished from absent, although both now fail: the two are
 * different defects with different repairs -- a symbol built as a module was
 * configured, a symbol that is absent was not -- and a message that called them
 * the same thing would send the reader to the wrong file.
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
  return ALL_SYMBOLS.map(({ symbol }) => {
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
 * The dependency existence walk is what keeps the `module` answer meaningful.
 * `modules.dep` is generated by `depmod` at build time and describes the module
 * set as it was then; a root that dropped an object during packing still
 * carries the index entry that names it, so "listed in modules.dep" is a claim
 * about the build host and "listed AND every named object present" is a claim
 * about the artefact under test. Nothing on the REQUIRED list is supposed to
 * take that branch any more -- the check below fails a `module` answer outright
 * -- but this root still ships modules, so the branch is live.
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

/**
 * How many entries `modules.builtin` has.
 *
 * The anti-vacuity number for the resolution check below. Every symbol on the
 * REQUIRED list is expected to resolve as `builtin` now, and "resolves as
 * builtin" is decided by a lookup in ONE file -- so a root whose
 * `modules.builtin` is missing or empty would fail every entry, which is right,
 * while a check that only counted failures could not tell "this kernel is
 * configured wrong" from "this root has no module index at all". The count is
 * what separates them, and it is printed on both paths.
 */
export function builtinCount(root: string, release: string): number {
  try {
    return readFileSync(join(root, 'lib', 'modules', release, 'modules.builtin'), 'utf8')
      .split('\n').filter(l => l !== '').length
  }
  catch {
    return 0
  }
}

const CONFIG_ID = 'kernel-config-floor-built-in'
const MODPROBE_ID = 'kernel-floor-resolves-builtin'

export const KERNEL_CHECKS: readonly CheckCase[] = [
  {
    // The config file the running kernel was built from, as the image carries
    // it. mos-kernel-x64 installs it beside the kernel it describes, which is
    // what makes this readable at all.
    id: CONFIG_ID,
    boards: ['x64'],
    shell: {
      pass: 'the shipped kernel config builds in',
      fail: 'the shipped kernel config does not build in',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const release = kernelRelease(root)
      if (release === '') {
        return [verdict(CONFIG_ID, false,
          'no single /boot/config-* in the packed root, so which kernel config describes the kernel '
          + `this image boots cannot be decided. The verity boot floor, the virtual link kinds and `
          + `the container network need ${SYMBOL_LIST}, and none of them can be read`)]
      }
      const found = configLines(root, release)
      const bad = found.filter(f => f.value !== 'y')
      const quoted = found
        .map(f => f.line ?? `${f.symbol} (no such line; absent or "is not set")`)
        .join(', ')
      const ok = bad.length === 0
      return [verdict(
        CONFIG_ID,
        ok,
        ok
          ? `the shipped kernel config builds in ${SYMBOL_LIST} in `
            + `/boot/config-${release}: ${quoted}`
          : `the shipped kernel config does not build in ${bad.map(b => b.symbol).join(', ')} as =y in `
            + `/boot/config-${release}: ${quoted}. This board boots root=/dev/dm-0 from a `
            + `dm-mod.create= table with no initramfs, so a symbol that is =m here cannot be loaded `
            + `at the moment it is needed and one that is absent was never built at all -- and the `
            + `same config is what says whether a distribution kernel has been reintroduced, whose `
            + `answer to CONFIG_DM_INIT is no line at all`,
      )]
    },
  },

  {
    // `=y` promises a symbol; this asks whether the module INDEX agrees. The
    // two are separate checks rather than one because they fail for unrelated
    // reasons and the repairs differ: a symbol that is not built in is a kernel
    // configured wrong, and an index that does not name it is a root this
    // repository packed wrong -- `modules_install` skipped, or the tree dropped
    // during packing. `modprobe <name>` and every consumer of modules.builtin
    // read the index, not the config.
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
      const builtins = builtinCount(root, release)
      const resolved = REQUIRED.map(r => resolveModule(root, release, r.module))
      const bad = resolved.filter(r => r.how !== 'builtin')
      const quoted = resolved
        .map(r => r.how === 'builtin'
          ? `${r.module}=builtin (${r.path})`
          : r.how === 'module'
            ? `${r.module}=MODULE ${r.path}${r.missingDeps.length === 0 ? '' : ` MISSING ${r.missingDeps.join(' ')}`}`
            : `${r.module}=UNRESOLVED`)
        .join(', ')
      const ok = bad.length === 0
      return [verdict(
        MODPROBE_ID,
        ok,
        ok
          ? `modprobe resolves ${MODULE_LIST} as built in against /lib/modules/${release} `
            + `(${builtins} entries in modules.builtin): ${quoted}`
          : `modprobe would not resolve ${bad.map(b => b.module).join(', ')} as built in against `
            + `/lib/modules/${release} (${builtins} entries in modules.builtin): ${quoted}. This `
            + `board loads nothing before its root exists, so a name that resolves to a .ko instead `
            + `of to the kernel image -- or to nothing -- means `
            + `${REQUIRED.filter(r => bad.some(b => b.module === r.module)).map(r => r.what).join(' and ')} `
            + `is unavailable at the moment it is needed. A modules.builtin with 0 entries is the `
            + `other shape of this: the index the answer comes from is not in the root`,
      )]
    },
  },
]
