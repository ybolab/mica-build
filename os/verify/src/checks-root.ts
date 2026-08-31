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
import { basename, dirname, join } from 'node:path'
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
// A fragment of the escape page as rendered, verbatim. Markup and
// not a bare route constant: "/builtin/deactivate" alone would still be in the
// binary after the pages moved out to an on-disk asset tree, which is the one
// change this catches.
//
// EXPORTED so that checks-fixture.ts's independent transcription of the same
// string can be asserted equal to it. Two independent transcriptions of one
// string keep each other honest; a shared constant would not.
export const BUILTIN_MARKUP = '<form method="post" action="/builtin/deactivate">'
const KEYRING_PATH = '/etc/rauc/keyring.pem'
const PACKED_MOUNTPOINTS = [
  '/mnt/state', '/mnt/meta', '/srv', '/var', '/home', '/root',
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
            + `built-in UI is maud expansions inside ${APID_BIN} and nothing else`,
      )]
    },
  },

  {
    // The image-side reading of "no include_str!, no include_bytes!, no asset
    // directory": it asserts the OUTCOME -- the rendered markup is IN the
    // binary -- rather than enumerating the mechanisms by which it might not be.
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
          ? `${what}: the ${APID_BIN} packed in this image carries the escape page's own rendered `
            + `markup (${BUILTIN_MARKUP}), so section 6.3's one documented action needs nothing off the disk`
          : `${what}: the ${APID_BIN} packed in this image does NOT carry the escape page's rendered `
            + `markup (${BUILTIN_MARKUP})`,
      )]
    },
  },

  {
    // A keyring inside the signed read-only root is a trusted signer on every
    // device flashed with this image, so the question is not whether one is
    // there -- os/rootfs/build-v2.sh stages one into every image now -- but
    // WHERE it came from. The repository-root ca/ is the single seam by which a
    // trust root enters a build, and a byte comparison against ca/ca.cert.pem
    // is what ties the image to that seam: a keyring that arrived any other way
    // (left in the overlay, copied in by a stage, edited afterwards) does not
    // match and is refused. That refusal is the old check's real purpose, kept
    // through the change of what the shipped state is.
    //
    // The ENV escape survives with it. ca/GENERATED marks a trust root
    // os/pkgs/rauc/gen-dev-keys.sh made, and an image trusting one is a bench
    // image: it fails here exactly as before unless MOS_EXPECT_DEV_KEYRING=1
    // names it. Production material carries no marker and needs no variable.
    id: 'packed-keyring-from-ca',
    shell: { pass: 'the shipped RAUC keyring came from ca/' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const what = 'the shipped RAUC keyring came from ca/'
      const caCert = fileBytes(join(ctx.caDir, 'ca.cert.pem'))
      // A THROW and not a fail, like packedRoot's own vacuity guard: "this tree
      // has no trust root to compare against" is a statement about the RUN.
      // Answering `pass` would make every image green on a host that had never
      // built one, which is the shape of green this suite exists to refuse.
      if (caCert === undefined) {
        throw new ToolOutputError(
          `${ctx.caDir}/ca.cert.pem does not exist, so there is nothing to compare `
          + `${KEYRING_PATH} against. That file is the trust root every image is built to trust; `
          + `a build creates it (os/pkgs/rauc/gen-dev-keys.sh) before staging the keyring, so a `
          + `tree without one has not built this image.`,
        )
      }
      // lstat for presence and read for content, because they differ: a
      // DANGLING symlink is a keyring path in the signed root and cannot be
      // read, and the two facts get different sentences.
      if (entry(root, KEYRING_PATH) === undefined) {
        return [verdict('packed-keyring-from-ca', false,
          `${what}: the packed root ships no ${KEYRING_PATH} at all. Every image stages one from `
          + `ca/ca.cert.pem, so this image can verify no bundle and rauc install fails closed on it`)]
      }
      const shipped = fileBytes(join(root, KEYRING_PATH))
      if (shipped === undefined || !shipped.equals(caCert)) {
        return [verdict('packed-keyring-from-ca', false,
          `${what}: ${KEYRING_PATH} in the packed root is not ${ctx.caDir}/ca.cert.pem `
          + `(${shipped === undefined ? 'it cannot be read -- a dangling symlink counts as shipped' : 'the bytes differ'}). `
          + `ca/ is the one place a trust root may enter a build; a keyring that arrived any other `
          + `way is a trusted signer on every device flashed with this image and nobody chose it`)]
      }
      if (!existsSync(join(ctx.caDir, 'GENERATED'))) {
        return [verdict('packed-keyring-from-ca', true,
          `${what}: ${KEYRING_PATH} is ${ctx.caDir}/ca.cert.pem byte for byte, and that trust root `
          + `carries no GENERATED marker, so it is production material placed there on purpose`)]
      }
      if (process.env['MOS_EXPECT_DEV_KEYRING'] === '1') {
        return [verdict('packed-keyring-from-ca', true,
          `${what}: ${KEYRING_PATH} is ${ctx.caDir}/ca.cert.pem, which ${ctx.caDir}/GENERATED marks `
          + `development-grade -- explicitly expected (MOS_EXPECT_DEV_KEYRING=1, development image `
          + `— see the WARNING above)`)]
      }
      return [verdict('packed-keyring-from-ca', false,
        `${what}: ${KEYRING_PATH} is ${ctx.caDir}/ca.cert.pem, but ${ctx.caDir}/GENERATED marks that `
        + `trust root DEVELOPMENT-GRADE. Every device flashed with this image would trust bundles `
        + `signed by an unprotected key in a working tree. Put production material in ca/ without `
        + `the marker, or set MOS_EXPECT_DEV_KEYRING=1 to name this a bench image`)]
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

/** `ls ROOT/usr/lib/modules`, in the oracle's spelling: entries, not versions. */
function kernelModuleDirs(root: string): string[] {
  try {
    return readdirSync(join(root, '/usr/lib/modules')).sort()
  }
  catch {
    return []
  }
}
