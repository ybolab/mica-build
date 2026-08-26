// Batch 1c: the RAUC slot contract, as `/etc/rauc/system.conf` states it.
//
// PLAN-014 M4b (RFCT-110). Six checks over one file in the packed root. The
// file is generated -- os/update/rauc/render-config.sh substitutes every GUID
// out of the board definition -- so these are not "does the renderer work"
// assertions. They are assertions about the file that SHIPPED, read back out of
// the squashfs the device mounts, against the layout the GPT was written from.
// A renderer that ran with one board's env and an assembler that ran with
// another's would agree with each other and fail here.
//
// ═══ WHY THE SLOT DEVICES ARE THE INTERESTING ONES ═══
//
// A wrong GUID in `[slot.rootfs.0]` installs an update over the RUNNING slot.
// Nothing on the device notices until the next boot, and there is no rollback
// left to take -- the slot that would have been rolled back to is the one that
// was overwritten. The shape check beside it exists so the config cannot
// acquire a `/dev/mmcblk0pN` path later: a partition number encodes a position
// in a table this campaign has already renumbered once.
//
// ═══ WHAT IS NOT HERE ═══
//
// `sq_regular /usr/bin/rauc`, `/etc/rauc/system.conf is a regular file` and the
// baked-in-keyring check are packed-root CONTENT and belong to M4c's batch --
// they are the same `sq_regular`/`check_dev_keyring` families that run over
// forty other paths. The fw_printenv/fw_setenv pair and the ESP-versus-boot-slot
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
 * wins -- os/verify-image-v2.sh:2819-2825's awk, in the same order, because a
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
    // RENUMBERING SAFETY, asserted as a SHAPE over every slot rather than over
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
    // The BACKEND FOLLOWS THE LAYOUT, not a literal: cx3576 is uboot and x64 is
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
        + `os/boards/${ctx.board.layoutBoard ?? ctx.board.name}/board.env specifies`
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
