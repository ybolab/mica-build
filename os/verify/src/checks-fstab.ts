// Batch 2b: /etc/fstab, and where the custom UI root actually lands.
//
// Four storage tiers, two shape assertions about the table itself, and the
// six-way question the four tier checks cannot answer: which entry governs the
// path apid reads.
//
// WHY UI_ROOT is asserted separately at all.
//
// The tier checks are about PARTITIONS. None of them would notice /srv/ui
// moving off DATA -- onto STATE, where 64 MiB holds the settings tree and the
// sshd host keys and the first large bundle fills it; or onto /var, which is
// wiped by design and has no growfs, so every installed custom UI silently
// disappears. Both are silent on the device and neither is visible to a check
// that only asks "is DATA mounted at /srv with growfs".
//
// One check, seven firings, and why not seven checks.
//
// `check_ui_location` has two paths. With no covering fstab entry it emits ONE
// conclusion and returns; otherwise it emits SIX. Seven independent `one`
// checks could not model that -- on the early-return path six of them would
// conclude nothing, the oracle would print nothing for them, and the harness
// would report six `unfired` rows, which is exit 1 for a run that behaved
// correctly. So this is a single `many` check whose instance is the assertion's
// own clause, and the early return is one firing rather than six absences.
// os/tests/ui-location-test.sh names the same seven identities for the same
// reason and asserts the six ABSENT in its case 7.
//
// The matcher is `custom UI root`, measured at exactly six lines on each board.
// It is the only substring common to all seven messages: five of them read
// `catches a custom UI root ...` and the sixth reads `catches content baked
// under the custom UI root`.

import { existsSync, lstatSync, readdirSync, readFileSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { packedRoot } from './checks-root.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { verdict } from './verdict.ts'

const UI_ROOT = '/srv/ui'
const DATA_MOUNT = '/srv'
const PACKED_MOUNTPOINTS = [
  '/mnt/state', '/mnt/meta', '/srv', '/var', '/home', '/root',
  '/usr/local/lib/systemd/system', '/etc/containers/systemd',
] as const

interface FstabEntry {
  readonly device: string
  readonly mount: string
  readonly type: string
  readonly options: string
  readonly raw: string
}

/**
 * /etc/fstab as rows, comments dropped, fields split on whitespace.
 *
 * Absent is an empty table and not a throw, on the same reasoning as
 * checks-rauc.ts's system.conf: whether the packed root carries an /etc/fstab
 * is a fact about the image, and it is one the oracle answers with a FAIL on
 * every check here -- its awk redirects a missing file to /dev/null and the
 * comparison comes back empty. A throw would turn a shipped image with no fstab
 * into "the check could not run".
 */
function readFstab(root: string): FstabEntry[] {
  const path = join(root, '/etc/fstab')
  if (!existsSync(path)) return []
  const rows: FstabEntry[] = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (/^\s*#/.test(raw)) continue
    const f = raw.trim().split(/\s+/)
    if (f.length < 4) continue
    rows.push({
      device: f[0] as string,
      mount: f[1] as string,
      type: f[2] as string,
      options: f[3] as string,
      raw: raw.trim(),
    })
  }
  return rows
}

function lc(s: string): string {
  return s.toLowerCase()
}

function guidOf(board: Board, layoutName: string): string {
  const guid = board.partition(layoutName)?.guid
  if (guid === undefined || guid.trim() === '') {
    throw new ToolOutputError(
      `${board.path} declares no ${layoutName}_GUID, so there is no PARTUUID to look for in `
      + `/etc/fstab. A fail here would be a statement about the image.`,
    )
  }
  return lc(guid)
}

/** `,${options},` contains `,${opt},` -- the oracle's own membership test. */
function hasOption(options: string, opt: string): boolean {
  return `,${options},`.includes(`,${opt},`)
}

// the four storage tiers

interface TierCase {
  readonly id: string
  readonly layout: string
  readonly mount: string
  readonly require: readonly string[]
  readonly forbid?: string
  /** The oracle's `what`, which every direction of the conclusion carries. */
  readonly what: string
}

/**
 * The `what` clause is the matcher, for all four directions.
 *
 * The pass line ends `(${what})` and each of the three failure shapes carries
 * `(${what})` too -- `has no <mnt> entry for PARTUUID=...`, `<mnt> lacks the
 * '<o>' option`, `<mnt> carries '<forbid>' but must not`. Nothing else is
 * common to all four: the mountpoint appears in every one but also in the six
 * UI assertions' text, so a mountpoint matcher would go `ambiguous` on a run
 * where both failed. Measured at one line per board for each of the four.
 */
const TIERS: readonly TierCase[] = [
  {
    id: 'fstab-data',
    layout: 'DATA',
    mount: DATA_MOUNT,
    require: ['noatime', 'x-systemd.growfs'],
    what: 'DATA is the growth target',
  },
  {
    id: 'fstab-state',
    layout: 'STATE',
    mount: '/mnt/state',
    require: ['noatime'],
    what: 'STATE: configuration + identity, precious',
  },
  {
    id: 'fstab-meta',
    layout: 'META',
    mount: '/mnt/meta',
    require: ['noatime'],
    what: 'META: update metadata, precious',
  },
  {
    // /var is fixed-size disposable residue. x-systemd.growfs is FORBIDDEN and
    // not merely unrequired: growing the wipeable tier is how a fill-up becomes
    // permanent rather than transient.
    id: 'fstab-ephemeral',
    layout: 'EPHEMERAL',
    mount: '/var',
    require: ['noatime'],
    forbid: 'x-systemd.growfs',
    what: '/var is fixed-size disposable residue, NOT a growth target',
  },
]

function tierCheck(t: TierCase): CheckCase {
  return {
    id: t.id,
    shell: { pass: `(${t.what})` },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const guid = guidOf(ctx.board, t.layout)
      const rows = readFstab(await packedRoot(ctx))
      // `$1 == d && $2 == m {print; exit}` -- the FIRST matching row, on both
      // device and mountpoint. A row that matched the device at another
      // mountpoint is not this entry.
      const row = rows.find(r => lc(r.device) === `partuuid=${guid}` && r.mount === t.mount)
      if (row === undefined) {
        return [verdict(t.id, false,
          `/etc/fstab has no ${t.mount} entry for PARTUUID=${guid} (${t.what})`)]
      }
      for (const o of t.require) {
        if (!hasOption(row.options, o)) {
          return [verdict(t.id, false,
            `/etc/fstab ${t.mount} lacks the '${o}' option (${t.what}); options are '${row.options}'`)]
        }
      }
      if (t.forbid !== undefined && hasOption(row.options, t.forbid)) {
        return [verdict(t.id, false,
          `/etc/fstab ${t.mount} carries '${t.forbid}' but must not (${t.what}); `
          + `options are '${row.options}'`)]
      }
      return [verdict(t.id, true,
        `/etc/fstab mounts ${t.mount} from PARTUUID=${guid} with ${row.options} (${t.what})`)]
    },
  }
}

// where UI_ROOT lands

/**
 * The fstab row whose mountpoint is the longest prefix of `path`.
 *
 * Derived rather than looked up, so moving UI_ROOT moves the check with it and
 * mounting something else over the path it sits under is noticed rather than
 * ignored. A deeper mountpoint wins over a shallower one, which is what the
 * kernel does. `m == p || m == "/" || index(p, m "/") == 1`, transcribed.
 */
function coveringRow(rows: readonly FstabEntry[], path: string): FstabEntry | undefined {
  let best: FstabEntry | undefined
  for (const r of rows) {
    const m = r.mount
    if (m === path || m === '/' || path.startsWith(`${m}/`)) {
      if (best === undefined || m.length > best.mount.length) best = r
    }
  }
  return best
}

/** `find "${ROOT}${UI_ROOT}" | sed | sort | awk 'NR <= 5 ...'`, transcribed. */
function shippedUnder(root: string, path: string): string {
  const abs = join(root, path)
  let top: Stats
  try {
    top = lstatSync(abs)
  }
  catch {
    return ''
  }
  const all: string[] = []
  const walk = (p: string, st: Stats): void => {
    all.push(p.slice(root.length))
    if (!st.isDirectory()) return
    for (const name of readdirSync(p)) {
      try {
        walk(join(p, name), lstatSync(join(p, name)))
      }
      catch { /* raced away between readdir and lstat; nothing to report */ }
    }
  }
  walk(abs, top)
  all.sort()
  const more = all.length > 5 ? `(+${all.length - 5} more)` : ''
  return [...all.slice(0, 5), more].filter(s => s !== '').join(' ')
}

const UI_ID = 'ui-location'

/** One firing, tagged with the clause that is its identity. */
function uiFiring(instance: string, ok: boolean, message: string): CheckResult {
  return verdict(UI_ID, ok, message, { instance })
}

const UI_NO_FILESYSTEM = 'catches a custom UI root with NO filesystem under it'
const UI_OFF_DATA = 'catches a custom UI root moved off DATA'
const UI_ON_STATE = 'catches a custom UI root moved onto STATE'
const UI_ON_EPHEMERAL = 'catches a custom UI root moved onto the wipeable /var partition'
const UI_UNASSERTED = 'catches a custom UI root under an unasserted mountpoint'
const UI_CEILING = 'catches a custom UI root with a fixed ceiling'
const UI_BAKED = 'catches content baked under the custom UI root'

export const FSTAB_CHECKS: readonly CheckCase[] = [
  ...TIERS.map(tierCheck),

  {
    id: 'fstab-tmpfs-tmp',
    shell: {
      pass: '/etc/fstab mounts /tmp as tmpfs',
      fail: '/etc/fstab has no tmpfs /tmp entry',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const rows = readFstab(await packedRoot(ctx))
      const ok = rows.some(r => r.device === 'tmpfs' && r.mount === '/tmp' && r.type === 'tmpfs')
      return [verdict('fstab-tmpfs-tmp', ok,
        ok ? '/etc/fstab mounts /tmp as tmpfs' : '/etc/fstab has no tmpfs /tmp entry')]
    },
  },

  {
    // The root is deliberately ABSENT from fstab: the kernel assembles /dev/dm-0
    // from the cmdline and mounts it read-only, so no entry could ever rewrite
    // it -- and one that tried would be a remount path into a verity root.
    // Note the direction: an entry is the FAILURE.
    id: 'fstab-no-root-entry',
    shell: {
      pass: '/etc/fstab has no / entry',
      fail: '/etc/fstab has a / entry',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const rows = readFstab(await packedRoot(ctx))
      const found = rows.some(r => r.mount === '/')
      return [verdict('fstab-no-root-entry', !found,
        found
          ? '/etc/fstab has a / entry; the verity root is assembled from the cmdline and must not '
            + 'be remountable via fstab'
          : '/etc/fstab has no / entry (the read-only verity root is assembled from the cmdline)')]
    },
  },

  {
    id: UI_ID,
    cardinality: 'many',
    // The clause up to the colon IS the identity, and it is what
    // os/tests/ui-location-test.sh keys its own register on.
    instance: /^(catches [^:]+):/,
    shell: { pass: 'custom UI root' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const board = ctx.board
      const root = await packedRoot(ctx)
      const rows = readFstab(root)
      const dataDev = `partuuid=${guidOf(board, 'DATA')}`
      const stateDev = `partuuid=${guidOf(board, 'STATE')}`
      const ephDev = `partuuid=${guidOf(board, 'EPHEMERAL')}`

      const row = coveringRow(rows, UI_ROOT)
      if (row === undefined) {
        // The early return, and the whole reason this check is `many`: one
        // conclusion instead of six, on both sides, rather than six silences.
        return [uiFiring(UI_NO_FILESYSTEM, false,
          `${UI_NO_FILESYSTEM}: no /etc/fstab entry covers ${UI_ROOT}, so it lands on the read-only `
          + `verity squashfs. apid cannot create it on first install, no bundle can ever be `
          + `installed, and the root is deliberately absent from fstab so no entry could ever come `
          + `to cover it`)]
      }
      const { mount, device, options } = row
      const devLc = lc(device)
      const out: CheckResult[] = []

      // 1. CHAINED to the DATA tier check above: DATA_MOUNT is the mountpoint
      //    that check validates, so a pass here means the entry governing
      //    UI_ROOT is the entry that check already proved out.
      out.push(uiFiring(UI_OFF_DATA, mount === DATA_MOUNT && devLc === dataDev,
        mount === DATA_MOUNT && devLc === dataDev
          ? `${UI_OFF_DATA}: ${UI_ROOT} resolves under ${DATA_MOUNT}, the DATA mount asserted above `
            + `(${dataDev})`
          : `${UI_OFF_DATA}: ${UI_ROOT} resolves under mountpoint ${mount} mounted from '${device}', `
            + `not under ${DATA_MOUNT} from ${dataDev}`))

      // 2. STATE is 64 MiB and holds the settings tree and the sshd host keys.
      out.push(uiFiring(UI_ON_STATE, devLc !== stateDev,
        devLc !== stateDev
          ? `${UI_ON_STATE}: ${UI_ROOT} is not governed by ${stateDev}`
          : `${UI_ON_STATE}: ${UI_ROOT} is governed by ${mount}, mounted from ${stateDev}`))

      // 3. /var is wiped by design and has no growfs.
      out.push(uiFiring(UI_ON_EPHEMERAL, devLc !== ephDev,
        devLc !== ephDev
          ? `${UI_ON_EPHEMERAL}: ${UI_ROOT} is not governed by ${ephDev}`
          : `${UI_ON_EPHEMERAL}: ${UI_ROOT} is governed by ${mount}, mounted from ${ephDev}`))

      // 4. CHAINED again: membership in PACKED_MOUNTPOINTS means the mountpoint
      //    check already proves the directory is in the read-only root, so its
      //    existence is not re-derived -- only its relevance to UI_ROOT.
      const covered = (PACKED_MOUNTPOINTS as readonly string[]).includes(mount)
      out.push(uiFiring(UI_UNASSERTED, covered,
        covered
          ? `${UI_UNASSERTED}: ${mount} is in the set the packed-root mountpoint check proves exists `
            + `(${PACKED_MOUNTPOINTS.join(' ')})`
          : `${UI_UNASSERTED}: ${UI_ROOT} is governed by ${mount}, which is NOT in the set the `
            + `packed-root mountpoint check covers (${PACKED_MOUNTPOINTS.join(' ')})`))

      // 5. Read off WHICHEVER entry governs UI_ROOT, so it keeps holding in the
      //    case the DATA check cannot see -- the covering entry being some
      //    other partition. Not the DATA entry's growfs restated.
      const grows = hasOption(options, 'x-systemd.growfs')
      out.push(uiFiring(UI_CEILING, grows,
        grows
          ? `${UI_CEILING}: the entry governing ${UI_ROOT} (${mount}) carries x-systemd.growfs`
          : `${UI_CEILING}: the entry governing ${UI_ROOT} (${mount}) lacks x-systemd.growfs; `
            + `options are '${options}'`))

      // 6. ANY content baked under the UI root, not merely the directory. Both
      //    failure modes are silent: a baked file on the read-only squashfs
      //    either WINS over the writable copy an operator installed, or NEVER
      //    UPDATES when the bundle beneath it changes.
      const shipped = shippedUnder(root, UI_ROOT)
      out.push(uiFiring(UI_BAKED, shipped === '',
        shipped === ''
          ? `${UI_BAKED}: the packed read-only root ships nothing at or under ${UI_ROOT}, which is `
            + `the defined shipped state -- apid creates it on first install and no seed unit is owed`
          : `${UI_BAKED}: the packed read-only root ships ${shipped}`))

      return out
    },
  },
]
