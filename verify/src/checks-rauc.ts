// Batch 1c: the RAUC slot contract, as `/etc/rauc/system.conf` states it.
//
// Seven checks over one generated file in the packed root -- pkgs/rauc/
// render-config.sh substitutes every GUID out of the board definition -- so
// these assert the file that shipped, read back out of the squashfs the device
// mounts, against the layout the GPT was written from. A renderer that ran with
// one board's env and an assembler that ran with another's would agree with each
// other and fail here.
//
// The slot devices are the interesting ones: a wrong GUID in `[slot.rootfs.0]`
// installs an update over the running slot, nothing on the device notices until
// the next boot, and there is no rollback left to take because the slot that
// would have been rolled back to is the one overwritten. The shape check beside
// it exists so the config cannot acquire a `/dev/mmcblk0pN` path later, a
// partition number encoding a position in a table already renumbered once.
//
// Not here: `sq_regular /usr/bin/rauc`, `/etc/rauc/system.conf is a regular
// file` and the baked-in-keyring check are packed-root content and belong to
// M4c's batch, and the fw_printenv/fw_setenv pair and the ESP-versus-boot-slot
// assertion are gated on the bootloader and belong to M4d's.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { verdict } from './verdict.ts'

const SYSTEM_CONF = 'etc/rauc/system.conf'

/**
 * The shipped config's text, or the empty string when it is not there.
 *
 * Absence is NOT a throw here, and that is deliberate: whether the packed root
 * carries `/etc/rauc/system.conf` is a fact about the image, and it is one the
 * oracle answers with a FAIL on every one of these checks (`2>/dev/null ||
 * true` into an empty comparison). A throw would turn a shipped image with no
 * update configuration into "the check could not run".
 */
async function systemConf(ctx: ImageContext): Promise<string> {
  const root = await ctx.unpackRoot()
  const path = join(root, SYSTEM_CONF)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/**
 * One key out of one `[slot.<name>]` section.
 *
 * The section ends at the next line beginning `[`, and the first matching key
 * wins -- the verification contract's awk, in the same order, because a
 * reader that took the LAST match would answer with a different section's value
 * for a config whose sections are not closed the way it expects.
 */
function slotField(conf: string, slot: string, key: string): string | undefined {
  const header = `[slot.${slot}]`
  let inSection = false
  for (const line of conf.split('\n')) {
    if (line === header) {
      inSection = true
      continue
    }
    if (line.startsWith('[')) {
      inSection = false
      continue
    }
    if (inSection && line.startsWith(`${key}=`)) return line.slice(key.length + 1)
  }
  return undefined
}

/**
 * The `[keyring]` keys the rendered device configuration may not carry, and
 * why this is asserted as an ABSENCE rather than as a value.
 *
 * `use-bundle-signing-time=true` switches RAUC from "is this signer valid
 * now" to "was it valid at the signing time the CMS carries" -- a timestamp
 * the key holder chose. PLAN-078 §M10 measured what that costs: a bundle
 * signed by a signer that had expired 370 days earlier, with the signing
 * host's clock rolled back into its old window, was ACCEPTED. It is not a
 * milder expiry, it is none, and it is the single line that would silently
 * disable short-lived signers fleet-wide.
 *
 * `check-crl` is here for the opposite reason: RAUC 1.13 supports it and this
 * tree deliberately does not use it, because a CRL needs a delivery channel an
 * offline device does not have. Turned on without one it refuses every bundle.
 *
 * ABSENCE, NOT `false`. A config that says `use-bundle-signing-time=false` is
 * a config somebody edited, and the next edit to that line is the one that
 * says `true`. A check that only rejected `true` would report green on the
 * commit that put the setting there, and would be answering a question about
 * a value when the property is about a line existing at all.
 *
 * The release HOST needs `use-bundle-signing-time=true` locally to repair its
 * own archive (docs/design/release-signing.md §2.2). That is a different
 * machine's config file, and this check is the reason the two can never be
 * copies of each other.
 */
const KEYRING_MUST_NOT_SET = ['use-bundle-signing-time', 'check-crl'] as const

/**
 * Every assignment inside `[keyring]`, or `undefined` when the section is not
 * there at all.
 *
 * The two are not the same answer and the difference is the whole point: an
 * absence asserted over a section that does not exist is an absence asserted
 * over nothing, and it stays green forever -- including for an image carrying
 * no update configuration. So the reader reports "no section" separately and
 * the check turns it into a FAIL rather than into the pass it would otherwise
 * be entitled to.
 *
 * Keys are trimmed because RAUC reads this file with GKeyFile, which accepts
 * `key = value` and leading indentation; a reader that only matched `key=`
 * would be satisfied by a spelling RAUC honours.
 */
function keyringAssignments(conf: string): readonly { readonly key: string, readonly value: string }[] | undefined {
  let inSection = false
  let present = false
  const out: { key: string, value: string }[] = []
  for (const raw of conf.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inSection = line === '[keyring]'
      if (inSection) present = true
      continue
    }
    // A commented setting is not a setting. GKeyFile takes `#` at the start of
    // a line as a comment, and system.conf.in is mostly comments.
    if (!inSection || line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    out.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() })
  }
  return present ? out : undefined
}

function guidOf(board: Board, layoutName: string): string {
  const guid = board.partition(layoutName)?.guid
  if (guid === undefined || guid.trim() === '') {
    throw new ToolOutputError(
      `${board.path} declares no ${layoutName}_GUID, so there is nothing to compare the RAUC slot `
      + `device against. A fail here would be a statement about the image.`,
    )
  }
  return guid
}

/** The four PARTITION slots, on every board. The boot half's SHAPE differs; its addressing does not. */
const SLOT_PAIRS = [
  { slot: 'rootfs.0', layout: 'ROOTFS_A' },
  { slot: 'rootfs.1', layout: 'ROOTFS_B' },
  { slot: 'boot.0', layout: 'BOOT_A' },
  { slot: 'boot.1', layout: 'BOOT_B' },
] as const

export const RAUC_CHECKS: readonly CheckCase[] = [
  {
    id: 'rauc-slot-devices-are-layout-guids',
    shell: {
      pass: 'RAUC system.conf addresses all ',
      fail: 'RAUC system.conf slot device mismatch',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const conf = await systemConf(ctx)
      let bad: string | undefined
      for (const pair of SLOT_PAIRS) {
        const want = `/dev/disk/by-partuuid/${guidOf(ctx.board, pair.layout).toLowerCase()}`
        const got = slotField(conf, pair.slot, 'device')
        if ((got ?? '').toLowerCase() !== want) {
          // The LAST mismatch is the one named, as the oracle names it. Which
          // one it is does not change the verdict, and reporting the set here
          // while the oracle reports one would make the two sides' messages
          // differ for a reason that is not about the image.
          bad = `${pair.slot} -> '${got ?? ''}' (expected ${want})`
        }
      }
      return [verdict(
        'rauc-slot-devices-are-layout-guids',
        bad === undefined,
        bad === undefined
          ? `RAUC system.conf addresses all ${SLOT_PAIRS.length} partition slots by the layout's partition GUIDs`
          : `RAUC system.conf slot device mismatch: ${bad}`,
      )]
    },
  },

  {
    // Renumbering safety, asserted as a SHAPE over every slot rather than over
    // the four this layout has: the config cannot acquire a partition-number
    // path later without this going red, and it would go red for a slot group
    // nobody thought to name here.
    id: 'rauc-slot-devices-by-partuuid',
    shell: {
      pass: 'every RAUC slot device is a /dev/disk/by-partuuid/ path',
      fail: 'RAUC system.conf addresses a slot by something other than a PARTUUID',
    },
    run: async (ctx) => {
      const conf = await systemConf(ctx)
      const bad: string[] = []
      let type = ''
      let dev = ''
      for (const line of conf.split('\n')) {
        if (line.startsWith('[slot.')) {
          type = ''
          dev = ''
          continue
        }
        if (line.startsWith('type=')) type = line.slice(5)
        if (line.startsWith('device=')) dev = line.slice(7)
        if (dev === '' || type === '') continue
        // A `file` slot is a path INSIDE another slot's filesystem -- x64's
        // per-slot kernel and cmdline are these -- so it is asserted absolute
        // rather than by-partuuid. Folding the two would either let a relative
        // file path through or fail every grub board.
        if (type === 'file') {
          if (!dev.startsWith('/')) bad.push(`${dev} (type=file, not an absolute path)`)
        }
        else if (!dev.startsWith('/dev/disk/by-partuuid/')) {
          bad.push(`${dev} (type=${type}, not addressed by PARTUUID)`)
        }
        dev = ''
      }
      return [verdict(
        'rauc-slot-devices-by-partuuid',
        bad.length === 0,
        bad.length === 0
          ? 'every RAUC slot device is a /dev/disk/by-partuuid/ path; no slot is addressed by '
            + 'partition number, so renumbering cannot mis-target an install'
          : `RAUC system.conf addresses a slot by something other than a PARTUUID: ${bad.join(' ')}; `
            + `a partition-number path breaks silently when the table is renumbered`,
      )]
    },
  },

  {
    // WIPE-SAFETY. RAUC's status file is update state -- which slot was
    // installed and whether it was marked good. /var is DISCARDABLE by design,
    // so putting it there would make "wipe /var" quietly destroy update
    // bookkeeping.
    id: 'rauc-statusfile-not-on-var',
    shell: { pass: 'RAUC statusfile' },
    run: async (ctx) => {
      const conf = await systemConf(ctx)
      const all = conf.split('\n').filter(l => l.startsWith('statusfile='))
      // The LAST assignment, because that is the one RAUC itself would use and
      // the one the oracle reads (`| tail -n1`).
      const statusfile = all.length === 0 ? '' : (all[all.length - 1] as string).slice('statusfile='.length)
      const mount = statusfile.startsWith('/mnt/meta/')
        ? 'META'
        : statusfile.startsWith('/mnt/state/') ? 'STATE' : undefined
      return [verdict(
        'rauc-statusfile-not-on-var',
        mount !== undefined,
        mount !== undefined
          ? `RAUC statusfile '${statusfile}' resolves onto ${mount}, not /var (wipe-safety contract)`
          : `RAUC statusfile is '${statusfile}'; update state must live on META or STATE, never on `
            + `the discardable /var`,
      )]
    },
  },

  {
    // The config must point at the CANONICAL keyring path; whether a keyring
    // actually ships there is a separate and stricter question, answered by the
    // baked-in-keyring check (M4c's).
    id: 'rauc-keyring-path',
    shell: { pass: 'RAUC keyring path is /etc/rauc/keyring.pem' },
    run: async (ctx) => {
      const conf = await systemConf(ctx)
      const ok = conf.split('\n').some(l => l === 'path=/etc/rauc/keyring.pem')
      const what = 'RAUC keyring path is /etc/rauc/keyring.pem (whether a keyring ships there is '
        + 'asserted separately by the baked-in-keyring check)'
      return [verdict(
        'rauc-keyring-path',
        ok,
        ok ? what : `${what} — /${SYSTEM_CONF} missing or does not match /^path=\\/etc\\/rauc\\/keyring\\.pem$/`,
      )]
    },
  },

  {
    // The device verifies a signer against NOW, which is what RAUC 1.13 does by
    // default and what this tree already ships. The whole of PLAN-078's
    // short-lived signer rests on it, and the mechanism cost is zero -- which is
    // exactly why it needs asserting: today the setting is absent because nobody
    // added it, and nothing would notice the commit that added it.
    id: 'rauc-keyring-verifies-against-now',
    shell: { pass: 'RAUC [keyring] sets neither use-bundle-signing-time nor check-crl' },
    run: async (ctx) => {
      const conf = await systemConf(ctx)
      const what = 'RAUC [keyring] sets neither use-bundle-signing-time nor check-crl, so the device '
        + 'verifies a signer against the current clock and a short-lived signer really expires'
      const assignments = keyringAssignments(conf)
      if (assignments === undefined) {
        return [verdict(
          'rauc-keyring-verifies-against-now',
          false,
          `${what} — /${SYSTEM_CONF} is missing or carries no [keyring] section, so this absence `
          + `would be an absence asserted over nothing`,
        )]
      }
      const set = assignments.filter(a => (KEYRING_MUST_NOT_SET as readonly string[]).includes(a.key))
      return [verdict(
        'rauc-keyring-verifies-against-now',
        set.length === 0,
        set.length === 0
          ? what
          : `RAUC [keyring] sets ${set.map(a => `${a.key}=${a.value}`).join(' ')}; the device's `
            + `configuration must not carry ${KEYRING_MUST_NOT_SET.join(' or ')} AT ALL, not even `
            + `spelled false — a value here is a line somebody edited, and use-bundle-signing-time=true `
            + `accepts a bundle signed by a signer that expired 370 days earlier (PLAN-078 §M10). `
            + `use-bundle-signing-time=true belongs to the release host's own config and never to a device`,
      )]
    },
  },

  {
    // The backend follows the layout, not a literal: cx3576 is uboot and x64 is
    // grub, and pinning this to either would make it fail on the correct
    // configuration of the other -- reported as a defect in the image rather
    // than as a check written for a single board.
    id: 'rauc-bootloader-backend',
    shell: { pass: 'RAUC system.conf selects the ' },
    run: async (ctx) => {
      const conf = await systemConf(ctx)
      const backend = ctx.board.bootloader
      if (backend === undefined || backend.trim() === '') {
        throw new ToolOutputError(`${ctx.board.path} declares no RAUC_BOOTLOADER.`)
      }
      const ok = conf.split('\n').some(l => l === `bootloader=${backend}`)
      const what = `RAUC system.conf selects the ${backend} bootloader backend, which is what `
        + `boards/${ctx.board.layoutBoard ?? ctx.board.name}/board.env specifies`
      return [verdict(
        'rauc-bootloader-backend',
        ok,
        ok ? what : `${what} — /${SYSTEM_CONF} missing or does not match /^bootloader=${backend}$/`,
      )]
    },
  },

  {
    // Without a bootname, rauc has no BOOTABLE slot group at all: `rauc status`
    // cannot name the booted slot, RAUC_SYSTEM_BOOTED_BOOTNAME is never
    // emitted, and mos-health exits 0 without ever reaching `rauc status
    // mark-good` -- so every update rolls back when the credits run out.
    id: 'rauc-rootfs-bootnames',
    shell: { pass: 'rootfs slots a bootname' },
    run: async (ctx) => {
      const conf = await systemConf(ctx)
      const n = conf.split('\n').filter(l => /^bootname=[AB]$/.test(l)).length
      const ok = n === 2
      return [verdict(
        'rauc-rootfs-bootnames',
        ok,
        ok
          ? 'RAUC system.conf gives both rootfs slots a bootname (A and B), so a booted slot can be '
            + 'named at all'
          : 'RAUC system.conf must give both rootfs slots a bootname=A / bootname=B; without one, '
            + 'rauc has no bootable slot group',
      )]
    },
  },
]
