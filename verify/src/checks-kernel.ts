// The kernel symbols the shipped runtime needs, read off the image that ships
// it: the dm-verity boot floor, the virtual link kinds the network reconciler
// creates, the container network, the eBPF runtime the container engine loads
// its cgroup device filter through, and the firewall back-end including its
// bridge half.
//
// THE CONFIG CHECK IS UNCONDITIONAL SINCE RFCT-343, and the scoping it lost is
// worth recording because the hole it left was real. Every shipped board builds
// its kernel in-tree, so `boards/common/mos-required.fragment` is merged before
// `olddefconfig` and every `=y` line asserted against the final `.config` on all
// of them -- but that runs at KERNEL-BUILD time, and `_out/boards/<board>/kernel/` is an
// INPUT to the image, not something assembling one rebuilds. x64 and virt-arm64
// packaged the resolved config into `/boot/config-*`, so this check read the
// floor back off the artefact for them; cx3576 exported none, so its floor was
// enforced only by a build that a stale BSP output skips entirely. Measured:
// that board's `Image` sat at its 2026-08-31 build for a week while the
// fragment gained dm-crypt, the eBPF/firewall/bridge floor and
// NF_CONNTRACK_MARK/NF_NAT_MASQUERADE, every image in that window shipped a
// kernel predating them, and nothing went red. cx3576 exports and ships the
// config now, so all three do and there is no list to keep.
//
// THE MODPROBE CHECK BELOW IS STILL x64 ONLY, deliberately and not by
// oversight. It walks the WHOLE of `modules.dep`, and what makes that walk
// affordable on x64 is that this kernel ships four loadable modules. cx3576 runs
// a vendor tree with a couple of hundred, and it KEEPS the dangling
// `build`/`source` symlinks that its board package documents at length -- so
// extending the walk there is a judgement about that board's module tree, with
// its own measurement to do, rather than a `boards:` entry. RFCT-343 scoped it
// out rather than half-doing it.
//
// `=y` AND `builtin`, where this file once accepted `=y` or `=m` and "resolves".
// That relaxation was a board fact and the board fact is gone. x64 ran Debian's
// `linux-image-amd64` -- a full module set with `kmod` beside it, so `=m` was a
// symbol genuinely available. `mos-kernel-x64` boots a dm-verity root from a
// `dm-mod.create=` table with NO INITRAMFS: nothing can load a module before the
// root exists, so `=m` for anything on this list is a kernel that hangs at
// rootwait. Tightening it is also what makes these checks catch a distribution
// kernel coming back -- Debian's amd64 config has twelve of these `=m` and
// `CONFIG_DM_INIT` nowhere at all.
//
// WHY THERE ARE STILL TWO CHECKS, now that both want "built in". They read
// different artefacts produced by different steps: `/boot/config-*` is what the
// kernel was CONFIGURED with, installed by the package, and `modules.builtin` is
// what Kbuild GENERATED during the compile and `modules_install` laid down. A
// config that says `=y` beside a module tree that does not name the symbol is a
// root this repository packed wrong, or a config from a different kernel than
// the modules beside it -- neither of which the config check can see.
//
// ONE ENTRY HERE HAS NO CONSUMER, and it is marked as such rather than blended
// in. `CONFIG_DM_CRYPT` is provisioned capability: no package in any resolution
// opens a dm-crypt device. It is on the list for the reason the rest are not --
// x64's config is built by subtraction, so an unnamed symbol is removed rather
// than merely absent, and this is the assertion that a later trim cannot take
// it out silently. Adding it changes nothing about what the two checks
// distinguish: it is `=y` and builtin on both boards like every other entry,
// so the config half still reads the package's `/boot/config-*` and the
// modprobe half still reads Kbuild's `modules.builtin`, and a config that
// claims it beside an index that does not name it is still a root packed
// wrong. It adds a subject to both halves and makes neither vacuous.
//
// WHAT THE TIGHTENING COST, stated because it is a real loss. `resolveModule`'s
// dependency-existence walk was the sharpest part of the modprobe check: a
// module `modules.dep` lists whose object was dropped during packing. No
// REQUIRED symbol reaches that branch any more, because they all resolve as
// builtin. So the walk is applied to the WHOLE of `modules.dep` instead of only
// to the required set -- this kernel still ships four loadable modules, and
// they are exactly the subjects the walk was built for. Four and not eight
// since RFCT-304: the xt extensions that were =m became =y, which is the
// direction that shrinks this walk's subject set, so the count is stated
// here rather than left to drift towards zero unremarked.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SHIPPED } from './board-scope.ts'
import { packedRoot } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { skipped, verdict } from './verdict.ts'

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
  // The dm-verity boot floor: everything between "the disk exists" and "the
  // root is mounted". It is on this list rather than only in the fragment
  // because this is the half read off the SHIPPED image, and a board with no
  // initramfs has nothing to load a module from at the moment these are
  // needed. CONFIG_DM_INIT names no module on purpose -- it is the
  // dm-mod.create= parser compiled INTO dm-mod, there is no dm-init.ko, and
  // asking modprobe about it would return UNRESOLVED for a symbol that is
  // present.
  { symbol: 'CONFIG_BLK_DEV_DM', module: 'dm-mod', what: 'the device mapper the verity root is built on' },
  { symbol: 'CONFIG_DM_INIT', what: 'the dm-mod.create= command-line parser this board boots through' },
  { symbol: 'CONFIG_DM_VERITY', module: 'dm-verity', what: 'the dm-verity target itself' },
  { symbol: 'CONFIG_SQUASHFS', module: 'squashfs', what: 'the root filesystem type' },
  { symbol: 'CONFIG_OVERLAY_FS', module: 'overlay', what: 'the writable overlays above an immutable root' },
  // The disk-encryption capability, and the ONE entry on this list whose
  // `what` names no consumer in the image. Nothing opens a dm-crypt device,
  // the image ships no cryptsetup and nothing is encrypted at rest; this is
  // asserted so the capability cannot be dropped unremarked from a config that
  // is built by subtraction. boards/common/mos-required.fragment carries the
  // argument and the condition under which the block goes away.
  { symbol: 'CONFIG_DM_CRYPT', module: 'dm-crypt', what: 'the dm-crypt target -- capability only, with no consumer in the image' },
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
  // The x_tables extensions the shipped iptables cannot do without. NOT a
  // second firewall and not the legacy back-end: iptables-nft stores every
  // extension it is asked for as an nft_compat `xt` expression -- measured off
  // `nft --json`, because the text renderer prints an xt expression through
  // libxtables' xlate callback and a compat rule then reads exactly like a
  // native one -- and nft_compat resolves that expression by loading the xt
  // module by name. Without the module the rule is REFUSED: "Warning:
  // Extension REDIRECT revision 0 not supported, missing kernel module?".
  // Three of these were absent on x64 while cx3576 had them =y, so the
  // documented compatibility path answered differently per board; RFCT-304
  // has the run and boards/common/mos-required.fragment the argument, plus
  // why the list is eight rather than the eleven symbols PLAN-074 listed.
  { symbol: 'CONFIG_NETFILTER_XT_MARK', module: 'xt_mark', what: 'the MARK target -j MARK is stored as' },
  { symbol: 'CONFIG_NETFILTER_XT_NAT', module: 'xt_nat', what: 'the SNAT and DNAT targets' },
  { symbol: 'CONFIG_NETFILTER_XT_MATCH_ADDRTYPE', module: 'xt_addrtype', what: 'the addrtype match -m addrtype is stored as' },
  { symbol: 'CONFIG_NETFILTER_XT_MATCH_CONNTRACK', module: 'xt_conntrack', what: 'the conntrack match -m conntrack is stored as' },
  { symbol: 'CONFIG_NETFILTER_XT_TARGET_CHECKSUM', module: 'xt_CHECKSUM', what: 'the CHECKSUM target, which has no native nft form at all' },
  { symbol: 'CONFIG_NETFILTER_XT_TARGET_CT', module: 'xt_CT', what: 'the CT target, -j CT --notrack included' },
  { symbol: 'CONFIG_NETFILTER_XT_TARGET_MASQUERADE', module: 'xt_MASQUERADE', what: 'the MASQUERADE target -j MASQUERADE is stored as' },
  { symbol: 'CONFIG_NETFILTER_XT_TARGET_REDIRECT', module: 'xt_REDIRECT', what: 'the REDIRECT target -j REDIRECT is stored as' },
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
 * One symbol a board's kernel must NOT build, and what building it would turn
 * on.
 *
 * The opposite direction from REQUIRED, and it needs one because the two
 * failures are not each other's mirror. A missing required symbol is a
 * capability the image promised and does not have. An excluded symbol that
 * appears is a capability nobody asked for that CHANGES WHAT THE DEVICE DOES
 * the moment it exists -- there is no code to add, no unit to enable, and
 * therefore nothing else in this contract that would notice.
 */
interface Exclusion {
  readonly symbol: string
  readonly what: string
}

/**
 * Per board, the symbols its kernel must not build.
 *
 * PER BOARD AND NOT SHARED, which is the opposite of how
 * `boards/common/mos-required.fragment` works, and the asymmetry is the
 * finding rather than an oversight. x64 and virt-arm64 build
 * `CONFIG_AUTOFS_FS=y` -- both configs derive from a mainline defconfig that
 * sets it -- and cx3576 does not, because its config derives from a Rockchip
 * vendor tree that does not. That difference was invisible until the board
 * booted and systemd said `Failed to find module 'autofs4'` (RFCT-355).
 *
 * WHY THE ANSWER IS NOT "MAKE THEM AGREE", which was the obvious repair. The
 * three boards differ in something else first: cx3576's boot slots are typed
 * ESP and appear in no fstab, so `systemd-gpt-auto-generator` generates an
 * `efi.automount` for BOOT-A on it and on neither of the others (x64 and
 * virt-arm64 mount their ESP from fstab, which is what makes the generator
 * skip it). On the booted hardware that generated unit is inert, and systemd
 * says exactly why: `Starting of efi.automount - EFI System Partition
 * Automount unsupported.` -- `automount_supported()` is `access("/dev/autofs")`
 * and there is no autofs. Building autofs into this board's kernel would
 * therefore not add a capability nothing uses; it would arm a read-write
 * automount of a RAUC-owned boot partition, chosen by disk order rather than
 * by which slot is running, on a device where /boot is deliberately not a
 * mountpoint. That is a decision about the generator, and it is not this one.
 *
 * So the symbols stay out, and this is what says so. The systemd line is
 * expected: `kmod_setup()` asks for `autofs4` on every boot whatever the unit
 * set is, so it is not evidence that anything wanted it. The only two
 * `.automount` units in the packed root are that generated `efi.automount` and
 * `proc-sys-fs-binfmt_misc.automount`, which is skipped on its own
 * `ConditionPathExists=/proc/sys/fs/binfmt_misc` because CONFIG_BINFMT_MISC is
 * not set either.
 */
export const EXCLUDED_BY_BOARD: Readonly<Record<string, readonly Exclusion[]>> = {
  cx3576: [
    {
      symbol: 'CONFIG_AUTOFS_FS',
      what: 'automount support, which would arm the efi.automount that '
        + 'systemd-gpt-auto-generator builds for this board’s ESP-typed BOOT-A',
    },
    {
      symbol: 'CONFIG_AUTOFS4_FS',
      what: 'the same filesystem under the name systemd still modprobes, which is why the '
        + 'absence of both and not just one is the statement',
    },
  ],
}

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
export function configLines(
  root: string,
  release: string,
  symbols: readonly string[] = REQUIRED.map(r => r.symbol),
): ConfigLine[] {
  let text = ''
  try {
    text = readFileSync(join(root, 'boot', `config-${release}`), 'utf8')
  }
  catch {
    text = ''
  }
  const lines = text.split('\n')
  return symbols.map((symbol) => {
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

/**
 * How many entries `modules.builtin` has.
 *
 * The anti-vacuity number for the check below. Every RESOLVABLE symbol is now
 * expected to answer `builtin`, and that answer comes from ONE file -- so a
 * root whose `modules.builtin` is missing or empty fails every entry, which is
 * right, while a check that only counted failures could not tell "this kernel
 * is configured wrong" from "this root has no module index at all". The count
 * separates them and is printed on both paths.
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

/**
 * How many loadable modules this root ships, i.e. how many subjects the
 * dependency walk below actually has.
 *
 * Printed on the passing path for the same reason `builtinCount` is: "every
 * object is present" over an empty `modules.dep` and over a full one are the
 * same sentence, and only one of them means anything.
 */
export function depCount(root: string, release: string): number {
  try {
    return readFileSync(join(root, 'lib', 'modules', release, 'modules.dep'), 'utf8')
      .split('\n').filter(l => l.includes(':')).length
  }
  catch {
    return 0
  }
}

/** One `modules.dep` entry whose object, or one of its dependencies, is absent. */
export interface BrokenModule {
  readonly module: string
  readonly missing: readonly string[]
}

/**
 * Every loadable module this root ships, walked for objects that are not there.
 *
 * THIS IS WHERE THE DEPENDENCY WALK LIVES NOW. It used to run only over the
 * required set, and it was the sharpest thing the modprobe check did: an entry
 * `depmod` wrote at build time whose `.ko` was dropped during packing resolves
 * to nothing at load time while the config line still reads `=m`. Since
 * PLAN-074 no required symbol is a module, so restricting the walk to them
 * would be a walk with no subjects -- green forever, having stopped looking.
 * The subjects it does have are the modules that actually ship, so it is
 * applied to all of them.
 */
export function brokenModules(root: string, release: string): BrokenModule[] {
  const modDir = join(root, 'lib', 'modules', release)
  let lines: string[] = []
  try {
    lines = readFileSync(join(modDir, 'modules.dep'), 'utf8').split('\n').filter(l => l !== '')
  }
  catch {
    return []
  }
  const broken: BrokenModule[] = []
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const self = line.slice(0, colon).trim()
    const deps = line.slice(colon + 1).trim().split(/\s+/).filter(d => d !== '')
    const missing = [self, ...deps].filter(p => !existsSync(join(modDir, p)))
    if (missing.length > 0) broken.push({ module: moduleNameOf(self), missing })
  }
  return broken
}

const CONFIG_ID = 'kernel-config-floor-built-in'
const EXCLUDED_ID = 'kernel-config-excluded'
const MODPROBE_ID = 'kernel-floor-resolves-builtin'

export const KERNEL_CHECKS: readonly CheckCase[] = [
  {
    // The config file the running kernel was built from, as the image carries
    // it. Every board's kernel package installs it beside the kernel it
    // describes, which is what makes this readable at all -- the resolved
    // config is an output of the BSP build and is in this tree nowhere.
    id: CONFIG_ID,
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
          + `this image boots cannot be decided. The virtual link kinds, the container network, the `
          + `eBPF runtime and the firewall back-end need ${SYMBOL_LIST}, and none of them can be read`)]
      }
      const found = configLines(root, release)
      // `=y` ONLY. `=m` is still parsed apart from absent, because the two are
      // different defects with different repairs -- a symbol built as a module was
      // configured, one that is absent was never built -- and a message that called
      // them the same thing sends the reader to the wrong file.
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
          : `the shipped kernel config does not build in ${bad.map(b => b.symbol).join(', ')} as =y `
            + `in /boot/config-${release}: ${quoted}. Each one buys: `
            + `${bad.map(b => `${b.symbol} -- ${REQUIRED.find(r => r.symbol === b.symbol)?.what ?? '?'}`)
              .join('; ')}. mosd renders .netdev units for VLAN, bridge and WireGuard interfaces, `
            + `netavark needs the veth pair and the nft fib expression for every bridge network, crun `
            + `loads its cgroup v2 device filter through bpf(2), and a firewall front-end programs `
            + `nf_tables; a capability the kernel does not have is never created, while the write, the `
            + `container start or the rule load that asked for it reports success. A symbol that is `
            + `=m rather than absent is worse here than a missing one: it reads as configured, and `
            + `on a board that assembles its root before any module can be loaded it does not boot`,
      )]
    },
  },

  {
    // `=y` promises a symbol; this asks whether the module INDEX agrees, and
    // whether every object this root DOES ship is present.
    //
    // Separate from the config check because they fail for unrelated reasons
    // and the repairs differ: a symbol that is not built in is a kernel
    // configured wrong, an index that does not name it is a root this
    // repository packed wrong -- `modules_install` skipped, the tree dropped
    // during packing, or a `/boot/config-*` left behind by a different kernel
    // than the modules beside it. `modprobe` and everything else on the device
    // reads the index, not the config.
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
      const resolved = RESOLVABLE.map(r => resolveModule(root, release, r.module))
      const notBuiltin = resolved.filter(r => r.how !== 'builtin')
      const broken = brokenModules(root, release)
      const quoted = resolved
        .map(r => r.how === 'builtin'
          ? `${r.module}=builtin (${r.path})`
          : r.how === 'module'
            ? `${r.module}=MODULE ${r.path}${r.missingDeps.length === 0 ? '' : ` MISSING ${r.missingDeps.join(' ')}`}`
            : `${r.module}=UNRESOLVED`)
        .join(', ')
      const ok = notBuiltin.length === 0 && broken.length === 0
      return [verdict(
        MODPROBE_ID,
        ok,
        ok
          ? `modprobe resolves ${MODULE_LIST} as built in against /lib/modules/${release} `
            + `(${builtins} entries in modules.builtin): ${quoted}. ${BUILTIN_ONLY_LIST} build no `
            + `object of their own and were not looked up here; the config check above is their `
            + `whole assertion. Every object named by the ${depCount(root, release)} modules.dep `
            + `entry/entries this root ships is present`
          : notBuiltin.length > 0
            ? `modprobe would not resolve ${notBuiltin.map(b => b.module).join(', ')} as built in `
              + `against /lib/modules/${release} (${builtins} entries in modules.builtin): ${quoted}. `
              + `This board loads nothing before its root exists, so a name that resolves to a .ko `
              + `instead of to the kernel image -- or to nothing -- means `
              + `${RESOLVABLE.filter(r => notBuiltin.some(b => b.module === r.module)).map(r => r.what).join(' and ')} `
              + `is unavailable at the moment it is needed. A modules.builtin with 0 entries is the `
              + `other shape of this: the index the answer comes from is not in the root`
            : `the module index names objects this root does not carry: `
              + `${broken.map(b => `${b.module} MISSING ${b.missing.join(' ')}`).join(', ')}. `
              + `depmod wrote those entries at build time and packing dropped the files, so `
              + `modprobe fails at load time with the config line still reading =m and the `
              + `config check above still green`,
      )]
    },
  },

  {
    // The other direction: symbols this board's kernel must NOT build. The
    // argument, the measurement and why "make the boards agree" is not the
    // repair are all at EXCLUDED_BY_BOARD.
    id: EXCLUDED_ID,
    boards: Object.keys(EXCLUDED_BY_BOARD),
    shell: {
      pass: 'the shipped kernel config leaves out',
      fail: 'the shipped kernel config builds',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const excluded = EXCLUDED_BY_BOARD[ctx.board.name] ?? []
      const root = await packedRoot(ctx)
      const release = kernelRelease(root)
      const names = excluded.map(e => e.symbol.slice('CONFIG_'.length)).join(', ')
      if (release === '') {
        return [verdict(EXCLUDED_ID, false,
          'no single /boot/config-* in the packed root, so whether this kernel leaves out '
          + `${names} cannot be decided`)]
      }
      const found = configLines(root, release, excluded.map(e => e.symbol))
      const built = found.filter(f => f.value !== undefined)
      const quoted = found
        .map(f => f.line ?? `${f.symbol} (no such line; absent or "is not set")`)
        .join(', ')
      const ok = built.length === 0
      return [verdict(
        EXCLUDED_ID,
        ok,
        ok
          ? `the shipped kernel config leaves out ${names} in /boot/config-${release}: ${quoted}`
          : `the shipped kernel config builds ${built.map(b => `${b.symbol}=${b.value}`).join(', ')} `
            + `in /boot/config-${release}: ${quoted}. Each one turns on: `
            + `${built.map(b => `${b.symbol} -- ${excluded.find(e => e.symbol === b.symbol)?.what ?? '?'}`)
              .join('; ')}. Nothing else in this contract would notice: there is no unit to enable `
            + `and no code to add, so the behaviour arrives with the symbol`,
      )]
    },
  },

  {
    id: `${EXCLUDED_ID}-skipped`,
    boards: SHIPPED.map(b => b.name).filter(n => EXCLUDED_BY_BOARD[n] === undefined),
    shell: { skip: 'the excluded-symbol assertions (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped(`${EXCLUDED_ID}-skipped`,
      `the excluded-symbol assertions (${ctx.board.name} names none): a board lists a symbol here `
      + `when building it would change what the device does with no unit and no code to say so, `
      + `and this board has no such symbol on file`)],
  },
]
