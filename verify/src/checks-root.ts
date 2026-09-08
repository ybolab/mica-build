// Batch 2a: what the packed read-only root CONTAINS.
//
// `sq_regular`, `sq_symlink`, `sq_grep` and the two unit-enablement helpers are
// one-line assertions over the squashfs the device mounts, all sharing one
// matcher shape: the conclusion's own `what` clause.
//
// `ctx.unpackRoot()` unpacks the whole archive -- 4,354 paths on cx3576, 9,238
// on x64 -- once per run, keyed on the payload's content, which is what makes it
// safe to run twice at one `--work`: keyed on the slot's name it handed the
// second run the first image's tree.
//
// A check lands here only if it produces the same conclusion text on both
// shipped boards, measured against their real output rather than read off the
// source; everything the oracle guards with a board or profile condition is
// M4d's, because it needs a `boards:` list and a SKIP rather than a silence.
//
// No matcher here is ` contains `. Measured 2026-08-26 against both boards' real
// conclusion lists, that substring claims 14 lines on cx3576 and 8 on x64, ten
// of them M4d's `BOOT-A contains Image`-shaped boot-slot listing; `ShellMatcher`
// takes a substring and not a regex, so whichever batch registered it first
// would make the other's lines `ambiguous`. The one line this file needs is
// claimed by `/usr/lib/modules contains exactly one kernel's modules`.

import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, type Stats } from 'node:fs'
import { basename, dirname, join, normalize } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { derivedManifest } from './manifest-keys.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { verdict } from './verdict.ts'

/**
 * The unpacked root, refused if it is EMPTY.
 *
 * A listing of nothing makes every "is X absent from the image?" check pass,
 * and three of the checks below are exactly that shape. M4a's `squashfsList`
 * and `ext4List` already refuse an empty listing for this reason; this is the
 * same guard at the directory the checks read.
 *
 * It is a THROW and not a fail: "unsquashfs produced an empty tree" is a
 * statement about the run, not about the image, and the image's own
 * unpacks-cleanly conclusion is a separate check below.
 */
export async function packedRoot(ctx: ImageContext): Promise<string> {
  const root = await ctx.unpackRoot()
  if (readdirSync(root).length === 0) {
    throw new ToolOutputError(
      `${root} is empty. unsquashfs exited 0 and unpacked nothing, so every "is this path in the `
      + `image?" check below would answer no and every "is this path ABSENT?" check would answer `
      + `yes -- a whole batch of green about an image that was never read.`,
    )
  }
  return root
}

/**
 * `lstat`, or undefined. Never follows a link: what is AT the path is the question.
 *
 * Exported for M4d: the board-conditional families read the same tree through
 * the same predicate, and a second spelling of "a regular file and not a link
 * to one" beside this one is how two batches come to disagree about a path.
 */
export function entry(root: string, path: string): Stats | undefined {
  try {
    return lstatSync(join(root, path))
  }
  catch {
    return undefined
  }
}

/** Linux's own ELOOP ceiling, so a cycle ends the walk where the kernel ends it. */
const SYMLINK_HOPS = 40

/**
 * A regular file at `path`, resolved THE WAY THE DEVICE WOULD -- every symlink
 * followed INSIDE the unpacked root, absolute ones included.
 *
 * `regularFileFollowingLinks` cannot answer this, and the difference is not
 * academic. It is `statSync(join(root, path))`, which hands the whole path to
 * the host kernel: a RELATIVE symlink inside the root resolves correctly by
 * accident, because the host resolves it relative to where it sits, but an
 * ABSOLUTE one is resolved against the HOST's `/`. So the answer for such a
 * path is a fact about the machine running the verifier.
 *
 * Measured, and it is the reason this exists: Debian's `wireless-regdb`
 * registers its database through update-alternatives, so a shipped root
 * carries `/usr/lib/firmware/regulatory.db -> /etc/alternatives/regulatory.db
 * -> /lib/firmware/regulatory.db-debian` -- two absolute hops and a merged-usr
 * one. The file is present and correct; `statSync` reported it missing,
 * because the host has no `/etc/alternatives/regulatory.db`. On a host that
 * happened to have one, it would have reported the HOST's database as the
 * image's.
 *
 * The wider defect is NOT closed here. `regularFileFollowingLinks` has around
 * forty call sites and every one of them inherits the same host resolution;
 * changing it is a verdict-affecting edit across the whole register and wants
 * its own review. Prefer this function for any path whose resolution can cross
 * an absolute symlink.
 */
export function regularFileInRoot(root: string, path: string): boolean {
  let current = path.startsWith('/') ? path : `/${path}`
  for (let hop = 0; hop <= SYMLINK_HOPS; hop += 1) {
    // Normalised first, so a `..` in a link target is collapsed the way the
    // kernel collapses it -- and, because the walk always starts at `/`, a
    // target that climbs past the root is clamped there rather than escaping
    // into the host, which is what a chroot does with the same path.
    const parts = normalize(current).split('/').filter(p => p !== '')
    let walked = ''
    let followed = false
    for (let i = 0; i < parts.length; i += 1) {
      const next = `${walked}/${parts[i]}`
      const st = entry(root, next)
      if (st === undefined) return false
      if (st.isSymbolicLink()) {
        let target: string
        try {
          target = readlinkSync(join(root, next))
        }
        catch {
          return false
        }
        const head = target.startsWith('/') ? target : `${walked}/${target}`
        current = [head, ...parts.slice(i + 1)].join('/')
        followed = true
        break
      }
      walked = next
    }
    if (!followed) return entry(root, walked)?.isFile() === true
  }
  return false
}

// sq_regular

/**
 * The paths the oracle asserts on EVERY board, in its own order.
 *
 * `[ -f "${ROOT}$1" ] && [ ! -L "${ROOT}$1" ]` is what it tests, and a single
 * `lstat().isFile()` is the same predicate rather than a re-spelling of it:
 * `-f` follows a symlink and `-L` catches it, so the pair means "a regular file
 * and not a link to one" -- which is what lstat reports directly. A symlink
 * pointing at a regular file fails both.
 *
 * Board-invariant by measurement, not by reading the source. Every path here
 * produces the identical conclusion on cx3576 and on x64; the ones the oracle
 * guards with a board condition are M4d's and are not in this list.
 */
const REGULAR_FILES: readonly string[] = [
  '/usr/lib/systemd/systemd',
  '/usr/bin/mosd',
  '/usr/share/dbus-1/system.d/com.mos.mosd.conf',
  '/usr/bin/apid',
  '/etc/mos/health.conf',
  '/usr/bin/rauc',
  '/etc/rauc/system.conf',
  '/usr/share/dbus-1/system.d/de.pengutronix.rauc.conf',
  '/usr/share/dbus-1/system-services/de.pengutronix.rauc.service',
  '/usr/lib/systemd/system/rauc.service',
  '/usr/lib/systemd/systemd-growfs',
  '/usr/lib/systemd/system/fstrim.service',
  '/usr/lib/systemd/system/serial-getty@.service',
  '/usr/lib/mos/mos-health',
  '/usr/lib/mos/mos-machine-id',
  '/usr/lib/systemd/system/mos-health.service',
  '/usr/lib/systemd/system/mos-machine-id.service',
  '/etc/passwd',
  '/etc/group',
  '/usr/share/factory/etc/shadow',
  '/usr/lib/mos/mos-shadow-reconcile',
  '/etc/systemd/system/mos-shadow-reconcile.service',
  '/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf',
  '/usr/lib/mos/mos-seed-home',
  '/usr/lib/mos/profile.conf',
]

/**
 * One check per path, NOT one `many` check over the family.
 *
 * A `many` check would have to claim ` is a regular file`, and that substring
 * covers the board-conditional paths too -- the radio firmware, the hwinit
 * confs, hostapd. Claiming them here would make M4d's lines `ambiguous` and
 * M4d could not repair it by landing later, which is the same trap ` contains `
 * sets. A per-path matcher carries the path, so the two batches cannot collide
 * however they are ordered.
 */
function regularFileCheck(path: string): CheckCase {
  return {
    id: `packed-regular${path}`,
    shell: {
      pass: `${path} is a regular file`,
      fail: `${path} missing or not a regular file`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), path)
      const ok = st !== undefined && st.isFile()
      return [verdict(
        `packed-regular${path}`,
        ok,
        ok ? `${path} is a regular file` : `${path} missing or not a regular file`,
      )]
    },
  }
}

// sq_grep

interface GrepCase {
  readonly id: string
  readonly path: string
  readonly pattern: RegExp
  readonly what: string
}

/**
 * The `what` clause IS the identity, and both directions carry it.
 *
 * The oracle prints `pass "${what}"` and `fail "${what} — ${path} missing or
 * does not match /${pattern}/"`, so the pass matcher claims the fail line too
 * and no separate fail matcher is registered. That is not a shortcut: a matcher
 * taken from further along the pass line would stop matching the moment the
 * check went red, which is the failure mode the whole register exists to avoid.
 *
 * The patterns are the oracle's own ERE, transcribed. `grep -Eq` is line-wise,
 * so each is tested against the file's lines rather than its whole text --
 * `^Storage=volatile$` means a LINE, and a multiline test would match it inside
 * a longer one.
 */
const GREPS: readonly GrepCase[] = [
  {
    id: 'packed-grep-dhcp',
    path: '/etc/systemd/network/80-dhcp.network',
    pattern: /DHCP=yes/,
    what: '/etc/systemd/network/80-dhcp.network has DHCP=yes',
  },
  {
    id: 'packed-grep-journald-volatile',
    path: '/etc/systemd/journald.conf.d/00-volatile.conf',
    pattern: /^Storage=volatile$/,
    what: 'journald is Storage=volatile (the journal never lands on the fixed-size /var)',
  },
  {
    id: 'packed-grep-mosd-busname',
    path: '/usr/lib/systemd/system/mosd.service',
    pattern: /BusName=com\.mos\.mosd/,
    what: '/usr/lib/systemd/system/mosd.service has BusName=com.mos.mosd',
  },
  {
    id: 'packed-grep-apid-after-mosd',
    path: '/usr/lib/systemd/system/apid.service',
    pattern: /After=.*mosd\.service/,
    what: '/usr/lib/systemd/system/apid.service orders After= mosd.service',
  },
  {
    id: 'packed-grep-apid-statedir',
    path: '/usr/lib/systemd/system/apid.service',
    pattern: /StateDirectory=mos\/apid/,
    what: '/usr/lib/systemd/system/apid.service has StateDirectory=mos/apid',
  },
  {
    id: 'packed-grep-mosd-policy-own',
    path: '/usr/share/dbus-1/system.d/com.mos.mosd.conf',
    pattern: /allow own="com\.mos\.mosd"/,
    what: 'the mosd D-Bus policy actually grants own= of com.mos.mosd (a policy that does not is inert)',
  },
  {
    id: 'packed-grep-shadow-reconcile-exec',
    path: '/etc/systemd/system/mos-shadow-reconcile.service',
    pattern: /^ExecStart=\/usr\/lib\/mos\/mos-shadow-reconcile$/,
    what: 'mos-shadow-reconcile.service runs /usr/lib/mos/mos-shadow-reconcile',
  },
  {
    id: 'packed-grep-tmpfiles-var-tmp',
    path: '/etc/tmpfiles.d/mos-var.conf',
    pattern: /^[qQ] \/var\/tmp /,
    what: 'tmpfiles.d ages /var/tmp (fixed-size /var cannot grow)',
  },
  {
    id: 'packed-grep-tmpfiles-var-cache',
    path: '/etc/tmpfiles.d/mos-var.conf',
    pattern: /^e \/var\/cache /,
    what: 'tmpfiles.d ages /var/cache (regenerable by definition, nothing else reclaims it)',
  },
]

function grepCheck(c: GrepCase): CheckCase {
  return {
    id: c.id,
    shell: { pass: c.what },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const st = entry(root, c.path)
      // `[ -f ... ] && grep -Eq ...` -- and `-f` FOLLOWS a link here, unlike
      // sq_regular's paired test, so a symlink to a readable file is read.
      const ok = st !== undefined && existsSync(join(root, c.path))
        && readFileSync(join(root, c.path), 'utf8').split('\n').some(l => c.pattern.test(l))
      return [verdict(
        c.id,
        ok,
        ok ? c.what : `${c.what} — ${c.path} missing or does not match /${c.pattern.source}/`,
      )]
    },
  }
}

// sq_enabled / sq_enabled_any

/**
 * The trees a `*.wants` symlink may live in.
 *
 * `sq_enabled` searches /etc only; `sq_enabled_any` also searches
 * /usr/lib/systemd/system, because distro units -- the systemd timers, repart
 * -- are statically enabled by a symlink the VENDOR ships and asserting only
 * /etc would fail on a correctly enabled unit.
 */
export const ETC_UNITS = ['/etc/systemd/system'] as const
export const ANY_UNITS = ['/etc/systemd/system', '/usr/lib/systemd/system'] as const

/**
 * The first `*.wants/<unit>` under any of `trees`, as a root-relative path.
 *
 * `find ... -name UNIT -path '*.wants/*'`, in the same order and taking the
 * same first line: the oracle prints the path it found and so does this, so a
 * unit enabled from a different target produces the same message on both sides
 * rather than a divergence about which of two true paths to name.
 */
export function wantsLink(root: string, trees: readonly string[], unit: string): string | undefined {
  const found: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    }
    catch {
      return
    }
    for (const name of entries.sort()) {
      const full = join(dir, name)
      let st: Stats
      try {
        st = lstatSync(full)
      }
      catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (name === unit && basename(dirname(full)).endsWith('.wants')) found.push(full)
    }
  }
  for (const tree of trees) walk(join(root, tree))
  const first = found[0]
  return first === undefined ? undefined : first.slice(root.length)
}

interface EnabledCase {
  readonly unit: string
  readonly trees: readonly string[]
  /** The oracle's two helpers word their failure differently; this is which. */
  readonly anyTree: boolean
}

const ENABLED: readonly EnabledCase[] = [
  { unit: 'mosd.service', trees: ETC_UNITS, anyTree: false },
  { unit: 'apid.service', trees: ETC_UNITS, anyTree: false },
  { unit: 'systemd-resolved.service', trees: ETC_UNITS, anyTree: false },
  { unit: 'systemd-repart.service', trees: ANY_UNITS, anyTree: true },
  { unit: 'systemd-tmpfiles-clean.timer', trees: ANY_UNITS, anyTree: true },
  { unit: 'mos-health.service', trees: ETC_UNITS, anyTree: false },
  { unit: 'mos-machine-id.service', trees: ETC_UNITS, anyTree: false },
  { unit: 'fstrim.timer', trees: ETC_UNITS, anyTree: false },
  { unit: 'mos-shadow-reconcile.service', trees: ETC_UNITS, anyTree: false },
]

/**
 * The pass matcher carries the open paren, and that is not decoration.
 *
 * Measured: `mos-seed-home.service is enabled` and `mos-seed-root.service is
 * enabled` are real conclusions of a DIFFERENT check -- "is enabled and ordered
 * Before=home.mount" -- so `<unit> is enabled` alone is a substring of another
 * assertion's line for any unit that check ever covers. `is enabled (` is
 * sq_enabled's own prose and nothing else's.
 */
function enabledCheck(c: EnabledCase): CheckCase {
  const id = `packed-enabled-${c.unit}`
  const where = c.anyTree
    ? 'no *.wants entry under /etc or /usr/lib systemd trees'
    : 'no *.wants entry under /etc/systemd/system'
  return {
    id,
    shell: {
      pass: `${c.unit} is enabled (`,
      fail: `${c.unit} enablement symlink missing`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const link = wantsLink(await packedRoot(ctx), c.trees, c.unit)
      return [verdict(
        id,
        link !== undefined,
        link !== undefined
          ? `${c.unit} is enabled (${link})`
          : `${c.unit} enablement symlink missing (${where})`,
      )]
    },
  }
}

// the rest, one at a time

const BUILTIN_PREFIX = '/builtin'
const APID_BIN = '/usr/bin/apid'
// A fragment of the built-in UI's index.html as apid embeds it, verbatim.
// Markup and not a bare route constant: "/_ui/assets/" alone would still be in
// the binary -- the asset route registers that prefix -- after index.html moved
// out to an on-disk asset tree, which is the one change this catches.
//
// It stops at the entry chunk's content hash on purpose. The bundler renames
// that file on every rebuild, so a fragment carrying one hash would go red on
// a correct image the next time the UI is built; everything up to the hash is
// the part the markup states about itself.
//
// EXPORTED so that checks-fixture.ts's independent transcription of the same
// string can be asserted equal to it. Two independent transcriptions of one
// string keep each other honest; a shared constant would not.
export const BUILTIN_MARKUP = '<script type="module" crossorigin src="/_ui/assets/index-'
const KEYRING_PATH = '/etc/rauc/keyring.pem'
const MANIFEST_PATH = '/usr/share/mos/manifest.tsv'

/** Where the baked half of `meta/` lands in the image. */
const BAKED_META_DIR = '/usr/share/mos/meta'

/**
 * The public set under `BAKED_META_DIR`, relative to it AND to the tree's
 * `meta/` -- one spelling, because the image mirrors the source layout there.
 *
 * The keyring is the seam's other public file and is NOT here: it lands at
 * `/etc/rauc/keyring.pem`, which RAUC's own `system.conf` names, and
 * `packed-keyring-from-meta` above is the byte comparison over it.
 *
 * A second entry belongs here only alongside a new line in rootfs/build.sh's
 * `META_PUBLIC`. That is the point of an allowlist: a file reaches a device by
 * two reviewed edits or not at all.
 */
const BAKED_META_SET = ['updates/manifest.json'] as const

/**
 * The development-grade marker, relative to `BAKED_META_DIR` and to `meta/`.
 *
 * It is on the public set CONDITIONALLY: present exactly when the material the
 * image was built from was generated by `pkgs/rauc/gen-dev-keys.sh`, absent
 * when an operator placed production material. So it is not in
 * `BAKED_META_SET` above, whose members are required and whose absence is a
 * throw -- the assertion here is a BICONDITIONAL rather than a presence, and
 * `bakedMarkerVerdict` below is where it lives (PLAN-077 §2.1).
 */
const BAKED_META_MARKER = 'GENERATED'

/**
 * Where the private-key detector looks, and it is not the whole packed root.
 *
 * A whole-root scan would fire on Debian packages that legitimately ship
 * key-shaped test fixtures, and a check whose findings are usually false is a
 * check people learn to pass. These are the paths this seam creates: mos-owned,
 * closed, and always populated.
 */
const PRIVATE_KEY_SCAN_DIRS = [BAKED_META_DIR, '/etc/rauc'] as const
const PACKED_MOUNTPOINTS = [
  '/mnt/data', '/mnt/state', '/mnt/meta', '/srv', '/mos', '/var', '/home', '/root',
  '/usr/local/lib/systemd/system', '/etc/containers/systemd',
] as const

/**
 * What the packed root ships at or under `path`, in the oracle's own words.
 *
 * `find ... | sed | sort | awk 'NR <= 5 ...'`: the first five paths, then
 * `(+N more)`. Reproduced rather than summarised, because this string is the
 * whole of what a reader gets to see when the check goes red -- and a port that
 * printed the count where the oracle prints the names would diverge on message
 * for a reason that is not about the image.
 */
function shippedUnder(root: string, path: string): string {
  const abs = join(root, path)
  if (entry(root, path) === undefined) return ''
  const all: string[] = []
  const walk = (p: string): void => {
    all.push(p.slice(root.length))
    let st: Stats
    try {
      st = lstatSync(p)
    }
    catch {
      return
    }
    if (!st.isDirectory()) return
    for (const name of readdirSync(p)) walk(join(p, name))
  }
  walk(abs)
  all.sort()
  const head = all.slice(0, 5)
  const more = all.length > 5 ? `(+${all.length - 5} more)` : ''
  return [...head, more].filter(s => s !== '').join(' ')
}

export const ROOT_CHECKS: readonly CheckCase[] = [
  {
    // The unpack itself. This is the ONE place where "unsquashfs would not run"
    // is a statement about the image rather than about the run, so it is the
    // one check here that catches rather than throws.
    id: 'packed-root-unpacks',
    shell: {
      pass: 'ROOTFS-A squashfs unpacks cleanly',
      fail: 'ROOTFS-A squashfs failed to unpack',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      try {
        await ctx.unpackRoot()
        return [verdict('packed-root-unpacks', true, 'ROOTFS-A squashfs unpacks cleanly')]
      }
      catch (error) {
        return [verdict(
          'packed-root-unpacks',
          false,
          `ROOTFS-A squashfs failed to unpack: ${error instanceof Error ? error.message : String(error)}`,
        )]
      }
    },
  },

  ...REGULAR_FILES.map(regularFileCheck),
  ...GREPS.map(grepCheck),
  ...ENABLED.map(enabledCheck),

  {
    // The property is "EXACTLY ONE", not a version. The oracle pinned 6.1.115
    // once and the x64 image -- running Debian's 6.12.101+deb13-amd64, which is
    // correct for it -- failed for saying so. Two entries means a stale set
    // shipped beside the live one; none means the modules never made it in.
    //
    // The matcher is deliberately long: ` contains ` alone claims fourteen
    // lines on cx3576, ten of them M4d's boot-slot listing.
    id: 'packed-modules-exactly-one',
    shell: {
      pass: "/usr/lib/modules contains exactly one kernel's modules",
      fail: '/usr/lib/modules entries: ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const entries = kernelModuleDirs(await packedRoot(ctx))
      const only = entries.length === 1 ? entries[0] as string : undefined
      return [verdict(
        'packed-modules-exactly-one',
        only !== undefined && only !== '',
        only !== undefined && only !== ''
          ? `/usr/lib/modules contains exactly one kernel's modules (${only})`
          : `/usr/lib/modules entries: '${entries.join(' ')}${entries.length > 0 ? ' ' : ''}', expected exactly one`,
      )]
    },
  },

  {
    // The kernel's own modules.dep, at whatever version the image carries --
    // read back out of the tree rather than named, for the same reason as
    // above. The matcher is the SUFFIX, because the path is board-dependent and
    // a per-board literal would report `orphan` on the board that changed
    // kernels rather than red.
    id: 'packed-modules-dep',
    shell: {
      pass: '/modules.dep is a regular file',
      fail: '/modules.dep missing or not a regular file',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const version = kernelModuleDirs(root).join('').replace(/\s/g, '')
      const path = `/usr/lib/modules/${version}/modules.dep`
      const st = entry(root, path)
      const ok = st !== undefined && st.isFile()
      return [verdict(
        'packed-modules-dep',
        ok,
        ok ? `${path} is a regular file` : `${path} missing or not a regular file`,
      )]
    },
  },

  {
    // sq_symlink, the oracle's only call of it. The TARGET is matched by
    // basename OR whole string (`"${target}" | */"${target}"`), so
    // ../run/systemd/resolve/stub-resolv.conf passes and so would a bare
    // stub-resolv.conf.
    //
    // TWO fail messages, one fail matcher. `... is a symlink to 'X', expected
    // Y` and `... missing or not a symlink` share only the path, so the path IS
    // the fail matcher -- measured as one line on each board, and no other
    // conclusion in either run mentions /etc/resolv.conf at all.
    id: 'packed-resolv-conf-symlink',
    shell: {
      pass: '/etc/resolv.conf is a symlink to ',
      fail: '/etc/resolv.conf ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const target = 'stub-resolv.conf'
      const st = entry(root, '/etc/resolv.conf')
      if (st === undefined || !st.isSymbolicLink()) {
        return [verdict('packed-resolv-conf-symlink', false, '/etc/resolv.conf missing or not a symlink')]
      }
      const dest = readlinkSync(join(root, '/etc/resolv.conf'))
      const ok = dest === target || dest.endsWith(`/${target}`)
      return [verdict(
        'packed-resolv-conf-symlink',
        ok,
        ok
          ? `/etc/resolv.conf is a symlink to ${dest}`
          : `/etc/resolv.conf is a symlink to '${dest}', expected ${target}`,
      )]
    },
  },

  {
    // Nothing can create a directory on a verity root at runtime, so every
    // mountpoint an fstab entry or a bind needs has to be IN the packed root.
    // Not "every mountpoint": /etc/ssh and /etc/hostapd are bind targets too,
    // and Debian already ships them, so this is the set the pack stage creates.
    id: 'packed-mountpoints-exist',
    shell: {
      pass: 'every fstab/bind mountpoint exists in the read-only root',
      fail: 'mountpoint(s) missing from the read-only root',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const missing = PACKED_MOUNTPOINTS.filter(d => entry(root, d)?.isDirectory() !== true)
      return [verdict(
        'packed-mountpoints-exist',
        missing.length === 0,
        missing.length === 0
          ? `every fstab/bind mountpoint exists in the read-only root (${PACKED_MOUNTPOINTS.join(' ')})`
          : `mountpoint(s) missing from the read-only root: ${missing.join(' ')}; a verity root cannot `
            + `create them at runtime, so the mount fails`,
      )]
    },
  },

  {
    // Section 6.2: the built-in UI is compiled into apid and has NO on-disk
    // half. The day it grows one, the escape has stopped being the artifact
    // with no build chain and has become two artifacts that must ship in step
    // -- and a stale or missing second half fails exactly when the escape is
    // being used, which is when everything else is already broken.
    id: 'packed-builtin-no-on-disk-half',
    shell: { pass: 'catches a built-in escape that has grown an on-disk half' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const shipped = shippedUnder(await packedRoot(ctx), BUILTIN_PREFIX)
      const what = 'catches a built-in escape that has grown an on-disk half'
      return [verdict(
        'packed-builtin-no-on-disk-half',
        shipped === '',
        shipped === ''
          ? `${what}: the packed read-only root ships nothing at or under ${BUILTIN_PREFIX}, so `
            + `section 6.2's compiled-in page is the whole of it`
          : `${what}: the packed read-only root ships ${shipped}. Section 6.2 guarantees the `
            + `built-in UI is compiled into ${APID_BIN} and nothing else`,
      )]
    },
  },

  {
    // The image-side reading of "the built-in UI ships inside the binary": it
    // asserts the OUTCOME -- the embedded index markup is IN the binary --
    // rather than naming the mechanism (today an include_bytes! of ui/dist)
    // by which it got there or might stop being there.
    id: 'packed-builtin-in-binary',
    shell: { pass: 'catches a built-in escape that is no longer inside the binary' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const what = 'catches a built-in escape that is no longer inside the binary'
      const st = entry(root, APID_BIN)
      if (st === undefined || !st.isFile()) {
        return [verdict('packed-builtin-in-binary', false,
          `${what}: ${APID_BIN} is not a regular file in the packed root, so there is nothing that `
          + `could serve ${BUILTIN_PREFIX}/ at all`)]
      }
      // The oracle's `tr -c '[:print:]' '\n' | grep -F` finds the markup exactly
      // when the bytes are contiguous and printable, which is what an indexOf
      // over the raw file answers -- and the markup is printable ASCII, so
      // there is no case where the two disagree.
      const found = readFileSync(join(root, APID_BIN)).includes(Buffer.from(BUILTIN_MARKUP, 'latin1'))
      return [verdict(
        'packed-builtin-in-binary',
        found,
        found
          ? `${what}: the ${APID_BIN} packed in this image carries the built-in UI's own index `
            + `markup (${BUILTIN_MARKUP}), so section 6.3's escape needs nothing off the disk`
          : `${what}: the ${APID_BIN} packed in this image does NOT carry the built-in UI's index `
            + `markup (${BUILTIN_MARKUP})`,
      )]
    },
  },

  {
    // The shipped bill of materials. The finalizer purges the package manager,
    // dpkg database included, so /usr/share/mos/manifest.tsv is the one record
    // on the device of what was installed and at which version. Three things,
    // each with its own failure: the file parses (three tab-separated fields
    // per row), it names mos packages at all (a manifest of only Debian rows
    // is a compose that installed none of this repository's packages while
    // this check read it as fine), and every mos row ends in ONE
    // `+git<commit>[.dirty]-<rev>` stamp -- versions are per package since the
    // upstream split, and the stamp is what still says "one commit built all
    // of this".
    id: 'packed-mos-manifest',
    shell: { pass: 'the shipped manifest lists ', fail: 'manifest.tsv' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const st = entry(root, MANIFEST_PATH)
      if (st === undefined || !st.isFile()) {
        return [verdict('packed-mos-manifest', false,
          `${MANIFEST_PATH} is not a regular file in the packed root. The purge takes /var/lib/dpkg `
          + 'away, so without this file the image has no record of what it is made of')]
      }
      const rows = readFileSync(join(root, MANIFEST_PATH), 'latin1')
        .split('\n')
        .filter(l => l !== '' && !l.startsWith('#'))
      const malformed = rows.filter(l => l.split('\t').length !== 3)
      if (malformed.length > 0) {
        return [verdict('packed-mos-manifest', false,
          `${MANIFEST_PATH} carries ${malformed.length} of ${rows.length} row(s) that are not `
          + `package<TAB>version<TAB>architecture, the first being '${malformed[0] as string}'`)]
      }
      const mosRows = rows.filter(l => (l.split('\t')[0] as string).startsWith('mos'))
      if (rows.length === 0 || mosRows.length === 0) {
        return [verdict('packed-mos-manifest', false,
          `${MANIFEST_PATH} lists ${rows.length} package(s) and ${mosRows.length} of them are mos `
          + 'packages. A manifest without the mos set is a compose that installed none of it')]
      }
      const stamps = new Set(mosRows.map(l => (l.split('\t')[1] as string).split('+').pop() as string))
      const shaped = [...stamps].every(s => /^git[0-9a-f]{12}(\.dirty)?-\d+$/.test(s))
      return [verdict(
        'packed-mos-manifest',
        stamps.size === 1 && shaped,
        stamps.size === 1 && shaped
          ? `the shipped manifest lists ${rows.length} package(s), ${mosRows.length} of them mos, `
            + `all mos rows at the one stamp ${[...stamps][0] as string}`
          : `${MANIFEST_PATH}'s mos rows carry ${stamps.size} git stamp(s) [${[...stamps].sort().join(' ')}]; `
            + 'every mos package is stamped by the one commit that built the pool, so two stamps or a '
            + 'shapeless one mean a half-rebuilt pool composed this image',
      )]
    },
  },
  {
    // A keyring inside the signed read-only root is a trusted signer on every
    // device flashed with this image, so the question is not whether one is
    // there -- rootfs/build.sh stages one into every image now -- but
    // WHERE it came from. `meta/rauc/` is the single seam by which a
    // trust root enters a build, and a byte comparison against
    // meta/rauc/ca.cert.pem is what ties the image to that seam: a keyring that
    // arrived any other way (left in the overlay, copied in by a stage, edited
    // afterwards) does not match and is refused. That refusal is the old
    // check's real purpose, kept through the change of what the shipped state is.
    //
    // meta/GENERATED still answers WHICH material this is -- the generator
    // leaves it, production material arrives without it -- and the verdict
    // says which one it read. It is not a refusal: dev and production take the
    // same path through meta/, and which material is there is CI's choice, made
    // before the build rather than waived after it. Nothing in this repository
    // records the grade of a published release; see the task record.
    id: 'packed-keyring-from-meta',
    shell: { pass: 'the shipped RAUC keyring came from meta/' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const what = 'the shipped RAUC keyring came from meta/'
      const caCertPath = join(ctx.metaDir, 'rauc', 'ca.cert.pem')
      const caCert = fileBytes(caCertPath)
      // A THROW and not a fail, like packedRoot's own vacuity guard: "this tree
      // has no trust root to compare against" is a statement about the RUN.
      // Answering `pass` would make every image green on a host that had never
      // built one, which is the shape of green this suite exists to refuse.
      if (caCert === undefined) {
        throw new ToolOutputError(
          `${caCertPath} does not exist, so there is nothing to compare `
          + `${KEYRING_PATH} against. That file is the trust root every image is built to trust; `
          + `a build creates it (pkgs/rauc/gen-dev-keys.sh) before staging the keyring, so a `
          + `tree without one has not built this image.`,
        )
      }
      // lstat for presence and read for content, because they differ: a
      // DANGLING symlink is a keyring path in the signed root and cannot be
      // read, and the two facts get different sentences.
      if (entry(root, KEYRING_PATH) === undefined) {
        return [verdict('packed-keyring-from-meta', false,
          `${what}: the packed root ships no ${KEYRING_PATH} at all. Every image stages one from `
          + `meta/rauc/ca.cert.pem, so this image can verify no bundle and rauc install fails closed on it`)]
      }
      const shipped = fileBytes(join(root, KEYRING_PATH))
      if (shipped === undefined || !shipped.equals(caCert)) {
        return [verdict('packed-keyring-from-meta', false,
          `${what}: ${KEYRING_PATH} in the packed root is not ${caCertPath} `
          + `(${shipped === undefined ? 'it cannot be read -- a dangling symlink counts as shipped' : 'the bytes differ'}). `
          + `meta/rauc/ is the one place a trust root may enter a build; a keyring that arrived any other `
          + `way is a trusted signer on every device flashed with this image and nobody chose it`)]
      }
      const generated = existsSync(join(ctx.metaDir, 'GENERATED'))
      return [verdict('packed-keyring-from-meta', true,
        `${what}: ${KEYRING_PATH} is ${caCertPath} byte for byte, and that material `
        + (generated
          ? `carries ${ctx.metaDir}/GENERATED, so it is DEVELOPMENT-GRADE: every device flashed with `
            + `this image trusts bundles signed by a key in a working tree. A release build puts `
            + `production material in meta/ instead, and CI is what chooses which is there`
          : `carries no GENERATED marker, so it is production material placed there on purpose`))]
    },
  },

  {
    // B2, first half: the image contains EXACTLY the public set, and the bytes
    // are the tree's.
    //
    // rootfs/build.sh's B1 refuses to STAGE anything off its allowlist and
    // proves the build's intent; this proves the OUTCOME, and the two are not
    // belt-and-braces. B1 cannot see material that arrives by a route other
    // than staging -- a file left in the overlay, a package postinst, a stray
    // `cp` in a later slice -- and this check does not care how it got there.
    //
    // Three failures, one shape: an EXTRA file under the baked directory (the
    // hazard: a private key that rode along), a MISSING one (an image that
    // cannot say where its updates come from), and a DIFFERING one (a document
    // edited after the build, which is a configuration nobody reviewed inside a
    // signature everybody trusts).
    //
    // And a fourth, in its own shape because it is a BICONDITIONAL rather than
    // a presence: the image carries `GENERATED` if and only if the tree does
    // (PLAN-077 §2.1). Both directions are refused and they are different
    // defects -- an image without the marker its tree has calls development
    // material production, which is what the publication gate reads.
    id: 'packed-meta-is-the-public-set',
    shell: { pass: 'the baked meta/ is exactly the public set' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const what = 'the baked meta/ is exactly the public set'

      // The vacuity guard, and it is a THROW for `packed-keyring-from-meta`'s
      // recorded reason: with no meta/ to compare against, answering `pass`
      // would make every image green on a host that had never built one --
      // "nothing wrong found" over a directory that does not exist.
      const sources = new Map<string, Buffer>()
      for (const rel of BAKED_META_SET) {
        const src = join(ctx.metaDir, rel)
        const bytes = fileBytes(src)
        if (bytes === undefined) {
          throw new ToolOutputError(
            `${src} does not exist, so there is nothing to compare ${BAKED_META_DIR}/${rel} `
            + `against. The public set is what a build copies out of meta/ into the image; a tree `
            + `without it has not built this image, and a verdict over an absent source would be `
            + `green about bytes nobody read.`,
          )
        }
        sources.set(rel, bytes)
      }

      // The marker's BICONDITIONAL, before the set comparison, because the two
      // directions are different defects with different sentences and the
      // generic "arrived without a reviewer" wording fits neither.
      //
      // The image saying PRODUCTION about development material is the
      // dangerous direction: the release gate reads exactly this file to
      // decide whether a release may be published to a customer channel, and a
      // bench image that ships no marker is one the gate would let out.
      const markerSource = fileBytes(join(ctx.metaDir, BAKED_META_MARKER))
      const markerShipped = fileBytes(join(root, BAKED_META_DIR, BAKED_META_MARKER))
      const markerPath = `${BAKED_META_DIR}/${BAKED_META_MARKER}`
      if (markerSource !== undefined && markerShipped === undefined) {
        return [verdict('packed-meta-is-the-public-set', false,
          `${what}: ${ctx.metaDir}/${BAKED_META_MARKER} marks this tree's signing material `
          + `DEVELOPMENT-GRADE and the packed root ships no ${markerPath}. The image would report `
          + `itself production on GET /api/v1/system/info, and the publication gate would let it out `
          + `to a customer channel, because the one file that says otherwise did not reach it`)]
      }
      if (markerSource === undefined && markerShipped !== undefined) {
        return [verdict('packed-meta-is-the-public-set', false,
          `${what}: the packed root ships ${markerPath} and ${ctx.metaDir}/${BAKED_META_MARKER} `
          + `does not exist, so the image calls development-grade material an operator placed as `
          + `production. Nothing but pkgs/rauc/gen-dev-keys.sh may write that marker, and a stale `
          + `copy of it inside the signed root refuses every release built from this tree`)]
      }
      if (markerSource !== undefined) {
        sources.set(BAKED_META_MARKER, markerSource)
      }

      const shipped = listRelative(join(root, BAKED_META_DIR))
      const extra = shipped.filter(rel => !sources.has(rel))
      if (extra.length > 0) {
        return [verdict('packed-meta-is-the-public-set', false,
          `${what}: ${BAKED_META_DIR}/ ships ${extra.length} file(s) that are not on it `
          + `[${extra.join(' ')}]. meta/ holds every private key a release needs and only its `
          + `public half may reach a device, so a path here that the allowlist in rootfs/build.sh `
          + `does not name arrived without a reviewer`)]
      }
      const missing = [...sources.keys()].filter(rel => !shipped.includes(rel))
      if (missing.length > 0) {
        return [verdict('packed-meta-is-the-public-set', false,
          `${what}: ${BAKED_META_DIR}/ is missing ${missing.join(' ')}. That is the configuration `
          + `this image reads to decide where its updates come from and which package signing key `
          + `it trusts; without it the image has nothing to read and no anchor to check against`)]
      }
      const differing = [...sources.entries()]
        .filter(([rel, bytes]) => {
          const got = fileBytes(join(root, BAKED_META_DIR, rel))
          if (rel === 'updates/manifest.json') {
            const expected = derivedManifest(bytes, join(ctx.metaDir, rel))
            if (got === undefined) return true
            try {
              return !isDeepStrictEqual(JSON.parse(got.toString('utf8')), expected)
            }
            catch {
              return true
            }
          }
          return got === undefined || !got.equals(bytes)
        })
        .map(([rel]) => rel)
      if (differing.length > 0) {
        return [verdict('packed-meta-is-the-public-set', false,
          `${what}: ${differing.join(' ')} in the packed root does not match `
          + `${ctx.metaDir}/${differing[0] as string} the build staged (either the bytes differ or the path `
          + `cannot be read -- a dangling symlink counts as shipped). A baked document that does not `
          + `match its source is configuration nobody reviewed, inside a signature every device trusts`)]
      }
      return [verdict('packed-meta-is-the-public-set', true,
        `${what}: ${BAKED_META_DIR}/ holds exactly ${sources.size} file(s) [${[...sources.keys()].join(' ')}], `
        + `matching sources under ${ctx.metaDir}/ (manifest signingKeyIds derived from key bytes; other files byte-equal)`)]
    },
  },

  {
    // B2, second half: no private key reached the image by any route.
    //
    // SCOPED to the two paths this seam creates, and not the whole packed root.
    // A whole-root scan would fire on Debian packages that legitimately ship
    // key-shaped test fixtures, and a check whose findings are usually false is
    // a check people learn to pass. These two directories are mos-owned, closed,
    // and always populated -- a keyring and a manifest -- so the count in the
    // verdict is a real measurement rather than a vacuous one.
    //
    // THE COUNT IS PART OF THE VERDICT. A green line that does not say what it
    // looked at cannot be distinguished from a green line that looked at
    // nothing, and a scan of zero files is refused rather than reported.
    id: 'no-private-key-in-baked-meta',
    shell: { pass: 'no private key material is baked into the image' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const what = 'no private key material is baked into the image'
      const found: string[] = []
      let scanned = 0
      for (const dir of PRIVATE_KEY_SCAN_DIRS) {
        for (const rel of listRelative(join(root, dir))) {
          const path = `${dir}/${rel}`
          scanned += 1
          const test = privateKeyMaterial(path, fileBytes(join(root, dir, rel)))
          if (test !== undefined) found.push(`${path} (${test})`)
        }
      }
      if (found.length > 0) {
        return [verdict('no-private-key-in-baked-meta', false,
          `${what}: ${found.length} of the ${scanned} file(s) under `
          + `[${PRIVATE_KEY_SCAN_DIRS.join(' ')}] carries some -- ${found.join(', ')}. Every device `
          + `flashed from this image carries a byte-identical copy, so a private key here is one an `
          + `attacker gets by buying a single unit and then uses to sign an update the whole fleet `
          + `verifies, installs and trusts`)]
      }
      if (scanned === 0) {
        return [verdict('no-private-key-in-baked-meta', false,
          `${what}: nothing was scanned. [${PRIVATE_KEY_SCAN_DIRS.join(' ')}] are mos-owned and always `
          + `populated -- a keyring and a manifest -- so an empty search space is not a clean image, `
          + `it is a check that read nothing and would have reported the same green whatever the `
          + `image contained`)]
      }
      return [verdict('no-private-key-in-baked-meta', true,
        `${what}: scanned ${scanned} file(s) under [${PRIVATE_KEY_SCAN_DIRS.join(' ')}] with all three `
        + `detectors (PEM private-key armour, a DER PKCS#8 PrivateKeyInfo header, a key-container `
        + `filename extension) and none carries any`)]
    },
  },
]

/**
 * The bytes of a file, or undefined when there are none to read.
 *
 * Undefined covers absence AND a link with nothing at the other end, which is
 * why the caller establishes presence separately: the two get different
 * sentences, and a dangling `/etc/rauc/keyring.pem` is still a keyring path in
 * the signed root.
 */
function fileBytes(path: string): Buffer | undefined {
  try {
    return readFileSync(path)
  }
  catch {
    return undefined
  }
}

/**
 * Every file at or under `dir`, as paths relative to it, sorted. Empty when
 * there is no such directory.
 *
 * **Empty and not a throw, because both callers already refuse the empty case
 * and say more about it than a stack trace can.**
 * `packed-meta-is-the-public-set` reports the missing paths by name;
 * `no-private-key-in-baked-meta` owns the vacuity rule outright -- its
 * `scanned === 0` branch is a red verdict explaining that these directories are
 * always populated, so an empty search space is a check that read nothing
 * rather than a clean image. Throwing here pre-empts that verdict with a bare
 * ENOENT and makes the branch unreachable in exactly the case its test drives.
 * "An absent scan input cannot prove absence" is right; it is enforced one
 * level up, where the check can name what it means.
 *
 * Directories are recursed into and everything else is an ENTRY -- a symlink
 * included, because a link under a baked directory is a path the image ships
 * and the checks that read this decide separately what to say about one whose
 * bytes cannot be read.
 */
function listRelative(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string, prefix: string): void => {
    let entries
    try {
      entries = readdirSync(at, { withFileTypes: true })
    }
    catch {
      return
    }
    for (const e of entries) {
      const rel = prefix === '' ? e.name : `${prefix}/${e.name}`
      if (e.isDirectory()) walk(join(at, e.name), rel)
      else out.push(rel)
    }
  }
  walk(dir, '')
  return out.sort()
}

/**
 * Which private-key test a file trips, or undefined for none.
 *
 * THREE tests, and the obvious spelling alone is wrong here. The previous
 * revision of this rule grepped for PEM armour; the package signing key is raw
 * PKCS#8 DER, so an armour grep is blind to exactly the file the hazard is
 * named after. A detector with one test is a detector that names one file
 * format.
 *
 * The name of the test that fired is returned rather than a boolean, because
 * "this file is a key" and "this file is NAMED like a key" want different fixes
 * and a verdict that cannot tell them apart sends half its readers to the wrong
 * place.
 */
function privateKeyMaterial(path: string, bytes: Buffer | undefined): string | undefined {
  // 3. A filename in a key-container extension. First, because it is the one
  //    test that answers for a path whose bytes cannot be read at all -- a
  //    dangling symlink named `root.key` is still a key-shaped path in the
  //    signed root.
  if (/\.(?:key|pk8|p12|pfx|jks)$/.test(path)) return 'key-container filename extension'
  if (bytes === undefined) return undefined
  // 1. PEM private-key armour, in every spelling openssl and ssh-keygen write.
  if (/-----BEGIN (?:RSA |DSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY-----/.test(bytes.toString('latin1'))) {
    return 'PEM private-key armour'
  }
  // 2. A DER PKCS#8 PrivateKeyInfo header: a SEQUENCE whose first element is
  //    INTEGER 0, the version -- 30 <len...> 02 01 00. This is what
  //    `rauc-sign gen-dev-keys` and `gen-dev-keys.sh --domain updates` write.
  if (bytes.length > 0 && bytes[0] === 0x30) {
    const lengthByte = bytes[1] ?? 0
    const contentAt = lengthByte < 0x80 ? 2 : 2 + (lengthByte & 0x7f)
    if (bytes[contentAt] === 0x02 && bytes[contentAt + 1] === 0x01 && bytes[contentAt + 2] === 0x00) {
      return 'DER PKCS#8 PrivateKeyInfo header'
    }
  }
  return undefined
}

/** `ls ROOT/usr/lib/modules`, in the oracle's spelling: entries, not versions. */
function kernelModuleDirs(root: string): string[] {
  try {
    return readdirSync(join(root, '/usr/lib/modules')).sort()
  }
  catch {
    return []
  }
}
