// The kernel symbols the shipped runtime needs, read off the image that ships
// it: the virtual link kinds the network reconciler creates, the container
// network, the eBPF runtime the container engine loads its cgroup device
// filter through, and the firewall back-end including its bridge half.
//
// x64 ONLY, and the scope is the point. cx3576 builds its kernel in-tree, so
// `boards/common/mos-required.fragment` is merged before `olddefconfig` and
// every `=y` line in it is then asserted against the final `.config`, failing
// the build otherwise (`boards/cx3576/bsp/kernel/Dockerfile`) --
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
 * One required symbol: what it is, what loads it, and what it buys.
 *
 * `module` is the name modprobe would be asked for -- not derivable from the
 * symbol (`CONFIG_VLAN_8021Q` loads as `8021q`, `CONFIG_NETFILTER_XTABLES` as
 * `x_tables`), so both are written down. A check that guessed one from the
 * other would report a missing module for a symbol that is present under its
 * real name, which reads as an image defect and is not one.
 *
 * `module` is ABSENT for a symbol that builds no object of its own. Those are
 * bools: `CONFIG_BPF_SYSCALL` and the rest of the eBPF floor compile into the
 * kernel image, and `CONFIG_NF_TABLES_INET`, `_IPV4` and `_IPV6` compile into
 * `nf_tables.ko`, which `CONFIG_NF_TABLES` already names. There is nothing for
 * modprobe to look up, so the modprobe check skips them and the config check
 * is the whole assertion. Giving one of them a module name anyway would make
 * the modprobe check resolve the same object several times and report a
 * confidence about a symbol it never looked at.
 */
interface Requirement {
  readonly symbol: string
  readonly module?: string
  readonly what: string
}

/** A requirement that names a module, i.e. one modprobe can be asked about. */
interface ModuleRequirement extends Requirement {
  readonly module: string
}

/**
 * The symbols, and the module each one is loaded by where it has one.
 *
 * This list and `boards/common/mos-required.fragment` are the same floor read
 * from two sides -- the fragment is merged into a board kernel before
 * `olddefconfig` and asserted against the built `.config`, this is asserted
 * against Debian's built artefact -- so every symbol here is pinned `=y`
 * there. `checks-kernel.test.ts` reads the fragment and requires it.
 */
export const REQUIRED: readonly Requirement[] = [
  { symbol: 'CONFIG_VLAN_8021Q', module: '8021q', what: 'VLAN interfaces' },
  { symbol: 'CONFIG_BRIDGE', module: 'bridge', what: 'bridge interfaces' },
  { symbol: 'CONFIG_WIREGUARD', module: 'wireguard', what: 'WireGuard tunnels' },
  // The container-network floor, the same set boards/common/mos-required.fragment
  // pins =y for the in-tree kernels: netavark creates the container/host veth
  // pair and programs `fib daddr type local` in an inet table. The per-symbol
  // citations into the pinned netavark source live in
  // tests/netavark-kernel-config-test.sh. CONFIG_NFT_FIB itself is not
  // listed here: both address families select it, and its nft_fib.ko is
  // reached through the three modules' own modules.dep dependency walk.
  { symbol: 'CONFIG_VETH', module: 'veth', what: 'container/host veth pairs' },
  { symbol: 'CONFIG_NFT_FIB_INET', module: 'nft_fib_inet', what: "netavark's inet fib port-forward rule" },
  { symbol: 'CONFIG_NFT_FIB_IPV4', module: 'nft_fib_ipv4', what: 'the IPv4 fib lookup that rule delegates to' },
  { symbol: 'CONFIG_NFT_FIB_IPV6', module: 'nft_fib_ipv6', what: 'the IPv6 fib lookup that rule delegates to' },
  // The eBPF runtime. Not a diagnostics nicety: crun programs the cgroup v2
  // device controller as a BPF_PROG_TYPE_CGROUP_DEVICE program
  // (crun 1.29.1 src/libcrun/ebpf.c:490,496), and on cgroup v2 that program IS
  // the device policy -- there is no devices controller file to write instead.
  // All four are bools with no object of their own.
  { symbol: 'CONFIG_BPF', what: 'the eBPF core every program runs on' },
  { symbol: 'CONFIG_BPF_SYSCALL', what: 'the bpf(2) syscall, without which no program can be loaded at all' },
  { symbol: 'CONFIG_BPF_JIT', what: 'native compilation of those programs instead of interpretation' },
  { symbol: 'CONFIG_CGROUP_BPF', what: "crun's cgroup v2 device filter, which is the device policy there" },
  // The firewall floor: the kernel side of an nftables front-end, with
  // iptables-nft as the reference. Citations into iptables 1.8.11, the
  // per-symbol table and the three-bucket measurement against Debian's shipped
  // config are in docs/design/boards.md section 4.
  { symbol: 'CONFIG_NF_TABLES', module: 'nf_tables', what: 'the nf_tables core every rule is programmed into' },
  { symbol: 'CONFIG_NF_TABLES_INET', what: 'the inet family netavark puts its whole table in' },
  { symbol: 'CONFIG_NF_TABLES_IPV4', what: 'the ip family iptables-nft builds its five tables in' },
  { symbol: 'CONFIG_NF_TABLES_IPV6', what: 'the ip6 family ip6tables-nft builds them in' },
  { symbol: 'CONFIG_NFT_COMPAT', module: 'nft_compat', what: 'the xt match and target expressions iptables-nft emits for everything with no native form' },
  { symbol: 'CONFIG_NETFILTER_XTABLES', module: 'x_tables', what: 'the x_tables core NFT_COMPAT depends on' },
  { symbol: 'CONFIG_NF_CONNTRACK', module: 'nf_conntrack', what: 'connection tracking, the state stateful filtering matches on' },
  { symbol: 'CONFIG_NFT_CT', module: 'nft_ct', what: 'the ct expression that reads that state' },
  { symbol: 'CONFIG_NF_NAT', module: 'nf_nat', what: 'the NAT core' },
  { symbol: 'CONFIG_NFT_NAT', module: 'nft_nat', what: 'the snat and dnat expressions' },
  { symbol: 'CONFIG_NFT_MASQ', module: 'nft_masq', what: 'the masquerade expression' },
  // Bridge filtering. Same-bridge container traffic is switched at layer 2 and
  // never reaches the ip-family hooks; these three are what make it visible at
  // all. NF_TABLES_BRIDGE builds no object: it is a tristate menuconfig whose
  // family compiles into nf_tables.ko and whose submenu holds the
  // per-expression modules, which are policy.
  { symbol: 'CONFIG_BRIDGE_NETFILTER', module: 'br_netfilter', what: 'bridged IP and ARP frames reaching the ip-family hooks, so one firewall covers container-to-container traffic' },
  { symbol: 'CONFIG_NF_TABLES_BRIDGE', what: 'the nf_tables bridge family, i.e. filtering a bridged frame at layer 2 without redirecting it into the ip hooks' },
  { symbol: 'CONFIG_NF_CONNTRACK_BRIDGE', module: 'nf_conntrack_bridge', what: 'conntrack and IP defragmentation for bridged traffic, without which ct state is not answerable there' },
]

/**
 * The half of the list modprobe can be asked about.
 *
 * Everything not here is asserted by the config check ALONE, which is why
 * checks-kernel.test.ts requires both halves to be non-empty: a list that
 * emptied either one would leave a whole check comparing nothing while still
 * printing green.
 */
export const RESOLVABLE: readonly ModuleRequirement[]
  = REQUIRED.filter((r): r is ModuleRequirement => r.module !== undefined)

/** The symbols that build no object, so that a message can say so. */
const BUILTIN_ONLY = REQUIRED.filter(r => r.module === undefined)

/** `VLAN_8021Q, BRIDGE, …` -- the one list, spelled from the register. */
const SYMBOL_LIST = REQUIRED.map(r => r.symbol.slice('CONFIG_'.length)).join(', ')
const MODULE_LIST = RESOLVABLE.map(r => r.module).join(', ')
/** `BPF, BPF_SYSCALL, …` -- the symbols the modprobe check deliberately skips. */
const BUILTIN_ONLY_LIST = BUILTIN_ONLY.map(r => r.symbol.slice('CONFIG_'.length)).join(', ')

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
          + `this image boots cannot be decided. The virtual link kinds, the container network, the `
          + `eBPF runtime and the firewall back-end need ${SYMBOL_LIST}, and none of them can be read`)]
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
            + `=m in /boot/config-${release}: ${quoted}. Each one buys: `
            + `${bad.map(b => `${b.symbol} -- ${REQUIRED.find(r => r.symbol === b.symbol)?.what ?? '?'}`)
              .join('; ')}. mosd renders .netdev units for VLAN, bridge and WireGuard interfaces, `
            + `netavark needs the veth pair and the nft fib expression for every bridge network, crun `
            + `loads its cgroup v2 device filter through bpf(2), and a firewall front-end programs `
            + `nf_tables; a capability the kernel does not have is never created, while the write, the `
            + `container start or the rule load that asked for it reports success`,
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
      const resolved = RESOLVABLE.map(r => resolveModule(root, release, r.module))
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
          ? `modprobe resolves ${MODULE_LIST} against /lib/modules/${release}: ${quoted}. `
            + `${BUILTIN_ONLY_LIST} build no object of their own and were not looked up here; the `
            + `config check above is their whole assertion`
          : `modprobe would not resolve ${bad.map(b => b.module).join(', ')} against `
            + `/lib/modules/${release}: ${quoted}. A module listed in modules.dep whose object is not `
            + `in the root fails at load time with the config line still reading =m, so the config `
            + `check above stays green while ${RESOLVABLE.filter(r => bad.some(b => b.module === r.module))
              .map(r => r.what).join(' and ')} cannot be created on the device`,
      )]
    },
  },
]
