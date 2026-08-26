// The board-definition schema lint.
//
// Why this exists. A board is defined by its layout file, and the shared build
// and verification scripts read that definition rather than knowing any board's
// shape. That only holds if the definition is complete and honest, and neither
// is self-evident: a missing key makes a shared script fail somewhere far from
// the omission, and a key a board CANNOT honour reads as a policy nobody
// implements.
//
// The second failure is the one that has actually happened. os/boards/x64/board.env
// declared BOOT_ATTEMPTS_DEFAULT=3 under a comment asserting that grub keeps
// attempt counters "where U-Boot keeps them in its redundant environment; the
// CONTRACT is identical". It is not: RAUC's grub backend has no attempt counter
// and REFUSES a configuration that sets one. Nothing in the tree objected. The
// image built, shipped, booted, and rauc.service exited 1 with "Configuring
// boot attempts is valid for uboot or barebox only", taking the health gate and
// the status indicator down with it.
//
// So this checks BOTH directions: every key a role requires is present, and no
// key a role does not use is present. Only the second one would have caught it.
//
// What this port changes, and why it is not a translation
//
// The predecessor was os/verify/lint.sh: it `source`d each board definition in
// a subshell and read every key as `${NAME_KEY:-}`. That idiom cannot tell
// Declared empty from not declared, and four holes measured on 2026-08-25 all
// come from exactly that:
//
//   1. `ROOTFS_A_FS_UUID=""` -- a forbidden key on a forbidden role -- PASSED.
//      The non-empty spelling of the same line was rejected. `[ -z "${val}" ]
//      && continue` skipped it, so the forbidden direction could be defeated by
//      writing the claim as empty.
//   2. `BOOT_ATTEMPTS_DEFAULT=""` on the grub board PASSED, by the same route.
//      That is the check this linter was written for.
//   3. `LAYOUT_PARTITIONS=" "` PASSED, reporting "0 partitions, numbered 1..0,
//      no gaps and no duplicates" -- and emitting a pass, so the vacuity guard
//      was satisfied by a board that declared no partitions at all.
//   4. A board declaring no MOS_ARCH PASSED when MOS_ARCH was exported in the
//      caller's environment, because `source` reads the process environment and
//      `${MOS_ARCH:-}` cannot see where the value came from.
//
// Hole 4 is closed one layer down: board-env.ts parses instead of sourcing and
// never consults process.env. Holes 1-3 are closed here, by asking
// `declared()` -- which answers PRESENCE without consulting the value -- rather
// than testing the value for emptiness.
//
// This makes the port stricter than its predecessor, deliberately. The
// emptiness of a declaration is never taken as its absence, because on these
// boards emptiness is a STATEMENT: x64 declares BOARD_FIRMWARE_FILES="" and
// BOARD_HWINIT_CONFS="" on purpose -- a QEMU machine has no radio firmware and
// no MAC to burn. A schema that reads those as "not declared" cannot tell a
// board that said "none" from a board that forgot to say anything.
//
// The messages are the product. A verdict tells a board engineer that something
// is wrong; the message is what tells them which line to edit. So absent and
// empty get DIFFERENT sentences even where they share a verdict: the shell said
// "declares no ESP_FAT_VOLUME_ID" for `ESP_FAT_VOLUME_ID=""`, which sends a
// reader looking for a line that is already there.

import { BoardEnvError } from './board-env.ts'
import {
  boardNameForPath,
  isKnownRole,
  KNOWN_ROLES,
  loadBoard,
  type Board,
  type Partition,
} from './board.ts'
import { boardEnvPath, requireShippedBoards } from './paths.ts'

/** Keys every partition carries, whatever its role. */
export const COMMON_KEYS = ['PARTNUM', 'LABEL', 'GUID', 'TYPECODE'] as const

/**
 * Per role: the keys it REQUIRES, and the keys it FORBIDS.
 *
 * A key in neither list is unconstrained -- placement keys (_START_MIB,
 * _START_SECTOR and _SIZE_MIB, _OFFSET_BYTES) differ legitimately between a
 * fixed-start partition and one whose offset is derived, and pinning them here
 * would encode the arrangement this file exists to stop encoding.
 *
 * The forbidden half is what catches a board claiming a capability it lacks.
 */
export const ROLE_SCHEMA: Readonly<Record<string, { required: readonly string[], forbidden: readonly string[] }>> = {
  'raw-blob': {
    required: ['START_SECTOR', 'SIZE_SECTORS', 'MAGIC_HEX'],
    forbidden: ['FS_LABEL', 'FS_UUID', 'FAT_LABEL', 'FAT_VOLUME_ID'],
  },
  'uboot-env': {
    required: ['OFFSET_BYTES'],
    forbidden: ['FS_LABEL', 'FS_UUID', 'FAT_LABEL', 'FAT_VOLUME_ID'],
  },
  'esp': {
    required: ['FAT_LABEL', 'FAT_VOLUME_ID'],
    forbidden: ['FS_LABEL', 'FS_UUID', 'MAGIC_HEX'],
  },
  'verity-slot': {
    required: [],
    forbidden: ['FS_LABEL', 'FS_UUID', 'FAT_LABEL', 'FAT_VOLUME_ID', 'MAGIC_HEX'],
  },
  'ext4': {
    required: ['FS_LABEL', 'FS_UUID'],
    forbidden: ['FAT_LABEL', 'FAT_VOLUME_ID', 'MAGIC_HEX'],
  },
}

/** The board-level keys every board must declare with a value. */
export const REQUIRED_BOARD_KEYS = [
  'BOARD_CMDLINE_ARGS',
  'BOARD_SIZE_BUDGET_MB',
  'BOARD_HAS_STATUS_LED',
  'MOS_ARCH',
] as const

/**
 * The three states a key can be in, which is the whole point of this port.
 *
 * `${NAME:-}` collapses `absent` and `empty` into one answer. Every check below
 * asks for this instead.
 */
export type Presence = 'absent' | 'empty' | 'present'

/** One thing the lint has to say about one board. */
export interface Check {
  readonly board: string
  readonly ok: boolean
  readonly message: string
}

/** Everything the lint has to say about one file. */
export interface BoardLint {
  readonly path: string
  readonly board: string
  readonly checks: readonly Check[]
  /** True when the parser refused the file outright, so nothing else could run. */
  readonly unreadable: boolean
}

/** Everything the lint has to say about a run over one or more files. */
export interface LintRun {
  readonly boards: readonly BoardLint[]
  readonly checks: readonly Check[]
  readonly passed: number
  readonly failed: number
  readonly ok: boolean
}

class Recorder {
  readonly checks: Check[] = []
  constructor(private readonly board: string) {}

  pass(message: string): void {
    this.checks.push({ board: this.board, ok: true, message })
  }

  fail(message: string): void {
    this.checks.push({ board: this.board, ok: false, message })
  }

  get failed(): number {
    return this.checks.filter(c => !c.ok).length
  }
}

function presenceOf(declared: boolean, value: string | undefined): Presence {
  if (!declared) return 'absent'
  return value === '' ? 'empty' : 'present'
}

function boardKeyPresence(b: Board, key: string): Presence {
  return presenceOf(b.declared(key), b.get(key))
}

function partKeyPresence(p: Partition, suffix: string): Presence {
  return presenceOf(p.declared(suffix), p.get(suffix))
}

/**
 * The sentence a declared-but-empty key gets, everywhere one is required.
 *
 * Its own wording, not the absent one's: "declares no X" about a file that
 * contains `X=""` sends a reader looking for a line that is already there, and
 * the edit they need is to give it a value rather than to add it.
 */
function emptyRequired(what: string, key: string): string {
  return `${what} declares ${key} as empty. An empty declaration is not a value: `
    + `every reader of this key would get "" and act on it, or skip the key and act as if the board never mentioned it`
}

/**
 * Check one partition against the schema for its role.
 *
 * Returns nothing; everything it has to say goes to the recorder. A partition
 * whose role cannot be resolved still contributes its common-core checks and
 * still contributes its partition number to the numbering check -- the shell
 * predecessor `continue`d past the number, which turned one missing role into a
 * second, spurious "these numbers are absent" line pointing at a partition that
 * was declared correctly.
 */
function lintPartition(r: Recorder, p: Partition): void {
  const before = r.failed
  lintPartitionInner(r, p)
  if (r.failed === before) {
    r.pass(
      `${p.name} is role ${p.role as string} and declares the common core, `
      + 'every key that role requires and none it forbids',
    )
  }
}

function lintPartitionInner(r: Recorder, p: Partition): void {
  for (const key of COMMON_KEYS) {
    const full = `${p.name}_${key}`
    switch (partKeyPresence(p, key)) {
      case 'absent':
        r.fail(`${p.name} declares no ${full}; every partition carries the common core whatever its role`)
        break
      case 'empty':
        r.fail(`${emptyRequired(p.name, full)}; every partition carries the common core whatever its role`)
        break
      case 'present':
        break
    }
  }

  const rolePresence = partKeyPresence(p, 'ROLE')
  if (rolePresence === 'absent') {
    r.fail(`${p.name} declares no ${p.name}_ROLE, so nothing can decide which assertions apply to it`)
    return
  }
  if (rolePresence === 'empty') {
    r.fail(`${emptyRequired(p.name, `${p.name}_ROLE`)}; nothing can decide which assertions apply to it`)
    return
  }

  const role = p.role as string
  if (!isKnownRole(role)) {
    r.fail(`${p.name}_ROLE is '${role}', which is not one of: ${KNOWN_ROLES.join(' ')}`)
    return
  }

  const schema = ROLE_SCHEMA[role]
  if (schema === undefined) {
    // Unreachable while isKnownRole and ROLE_SCHEMA agree -- and asserted so in
    // the suite, because a role added to one and not the other would otherwise
    // be silently unchecked, which is the shape of failure this file exists for.
    r.fail(`${p.name}_ROLE is '${role}', which this schema knows by name but has no key list for`)
    return
  }

  for (const key of schema.required) {
    const full = `${p.name}_${key}`
    switch (partKeyPresence(p, key)) {
      case 'absent':
        r.fail(`${p.name} is role ${role} and declares no ${full}`)
        break
      case 'empty':
        r.fail(`${p.name} is role ${role} and ${emptyRequired('it', full)}`)
        break
      case 'present':
        break
    }
  }

  // The forbidden direction, and the one hole 1 was in. Presence is the claim.
  // A key declared empty is still a key this role has no meaning for, and a
  // reader of the file cannot tell it from a value that has yet to be filled in.
  for (const key of schema.forbidden) {
    const full = `${p.name}_${key}`
    const presence = partKeyPresence(p, key)
    if (presence === 'absent') continue
    const shown = presence === 'empty'
      ? `${full} as empty`
      : `${full}=${p.get(key) as string}`
    r.fail(
      `${p.name} is role ${role} and declares ${shown}, which that role cannot honour. `
      + `A constant nobody reads is how a board comes to claim a capability it does not have`
      + (presence === 'empty'
        ? `, and declaring it empty is still declaring it -- remove the key rather than blank it`
        : ''),
    )
  }
}

/**
 * One fact, three units.
 *
 * A board may spell a start as MiB, as a sector and as a byte offset; cx3576
 * does, as three independent literals, and three literals can disagree. Checked
 * rather than trusted -- and only when both forms are present, so a board that
 * declares one is not forced to declare the others.
 *
 * MIB_BYTES and SECTOR_SIZE are needed to do the arithmetic. The shell
 * predecessor read them under `set -u` inside `$(( ))`, so a board missing
 * either died mid-file and reported "made no assertions at all"; here the
 * missing constant is named.
 */
function lintStartUnits(r: Recorder, b: Board, p: Partition): void {
  const { startMib: mib, startSector: sector, offsetBytes: offset } = p
  if (mib === undefined) return
  if (sector === undefined && offset === undefined) return

  const mibBytes = b.mibBytes
  const sectorSize = b.sectorSize
  if (mibBytes === undefined || sectorSize === undefined) {
    r.fail(
      `${p.name} spells its start in more than one unit, but the board declares no `
      + `${mibBytes === undefined ? 'MIB_BYTES' : 'SECTOR_SIZE'}, so the units cannot be compared`,
    )
    return
  }

  if (sector !== undefined) {
    const want = (mib * mibBytes) / sectorSize
    if (sector !== want) {
      r.fail(`${p.name}_START_MIB=${mib} and ${p.name}_START_SECTOR=${sector} disagree; ${mib} MiB is ${want} sectors`)
    }
  }
  if (offset !== undefined) {
    const want = mib * mibBytes
    if (offset !== want) {
      r.fail(`${p.name}_START_MIB=${mib} and ${p.name}_OFFSET_BYTES=${offset} disagree; ${mib} MiB is ${want} bytes`)
    }
  }
}

/**
 * The bootloader backend decides whether boot attempts may be declared at all.
 *
 * This is the check that would have caught the x64 layout before it reached a
 * device -- and the one hole 2 was in: `BOOT_ATTEMPTS_DEFAULT=""` on the grub
 * board passed the shell predecessor, because an empty value read as an absent
 * key. Measured against the real consumer: os/update/rauc/render-config.sh:137
 * also reads `${BOOT_ATTEMPTS_DEFAULT:-}` and so tolerates the empty spelling
 * today, which makes this a schema failure rather than a device failure. It is
 * still a failure: the key's presence is a claim about a capability grub does
 * not have, and the absence is what x64's own comment says the statement is.
 */
function lintBootloader(r: Recorder, b: Board): void {
  const presence = boardKeyPresence(b, 'RAUC_BOOTLOADER')
  if (presence === 'absent') {
    r.fail('declares no RAUC_BOOTLOADER')
    return
  }
  if (presence === 'empty') {
    r.fail(emptyRequired('it', 'RAUC_BOOTLOADER'))
    return
  }

  const bootloader = b.bootloader as string
  const attempts = boardKeyPresence(b, 'BOOT_ATTEMPTS_DEFAULT')

  switch (bootloader) {
    case 'uboot':
    case 'barebox': {
      if (attempts === 'absent') {
        r.fail(
          `bootloader=${bootloader} counts boot attempts but no BOOT_ATTEMPTS_DEFAULT is declared; `
          + 'a slot would be handed control with no credit to lose and rollback would never fire',
        )
        return
      }
      if (attempts === 'empty') {
        r.fail(
          `bootloader=${bootloader} counts boot attempts and ${emptyRequired('it', 'BOOT_ATTEMPTS_DEFAULT')}; `
          + 'a slot would be handed control with no credit to lose and rollback would never fire',
        )
        return
      }
      r.pass(`bootloader=${bootloader}, and it declares the boot-attempt credit that backend counts down`)
      return
    }
    case 'grub': {
      let ok = true
      const grubenv = boardKeyPresence(b, 'RAUC_GRUBENV')
      if (grubenv === 'absent') {
        ok = false
        r.fail('bootloader=grub but no RAUC_GRUBENV; RAUC would have nowhere to read or write the A/B order')
      } else if (grubenv === 'empty') {
        ok = false
        r.fail(`bootloader=grub and ${emptyRequired('it', 'RAUC_GRUBENV')}; RAUC would have nowhere to read or write the A/B order`)
      }
      if (attempts !== 'absent') {
        ok = false
        const shown = attempts === 'empty'
          ? 'BOOT_ATTEMPTS_DEFAULT as empty'
          : `BOOT_ATTEMPTS_DEFAULT=${b.get('BOOT_ATTEMPTS_DEFAULT') as string}`
        r.fail(
          `bootloader=grub and declares ${shown}. RAUC refuses a grub configuration that sets boot attempts `
          + "-- 'Configuring boot attempts is valid for uboot or barebox only' -- and the daemon exits 1"
          + (attempts === 'empty'
            ? '. Declaring it empty is still declaring it: the absence is the statement, so remove the key'
            : ''),
        )
      }
      if (ok) r.pass('bootloader=grub, with a grubenv to order the slots and no boot-attempt counters it cannot honour')
      return
    }
    default:
      r.fail(`RAUC_BOOTLOADER is '${bootloader}'; this schema knows uboot, barebox and grub`)
  }
}

function lintBoardKeys(r: Recorder, b: Board): void {
  let ok = true
  for (const key of REQUIRED_BOARD_KEYS) {
    switch (boardKeyPresence(b, key)) {
      case 'absent':
        ok = false
        r.fail(`declares no ${key}`)
        break
      case 'empty':
        ok = false
        r.fail(emptyRequired('it', key))
        break
      case 'present':
        break
    }
  }

  const led = b.hasStatusLed
  if (led !== undefined && led !== '' && led !== '0' && led !== '1') {
    ok = false
    r.fail(`BOARD_HAS_STATUS_LED is '${led}'; it must be 0 or 1`)
  }

  if (ok) r.pass(`declares all ${REQUIRED_BOARD_KEYS.length} board-level keys, and BOARD_HAS_STATUS_LED is 0 or 1`)
}

/**
 * The partition set, its numbering, and the roles of everything in it.
 *
 * `LAYOUT_PARTITIONS=" "` is hole 3: the shell predecessor found it non-empty,
 * iterated zero names and reported "0 partitions, numbered 1..0, no gaps and no
 * duplicates" -- a PASS, which also satisfied its vacuity guard. The set is
 * checked here by its NAMES, not by the emptiness of the string that carries
 * them.
 */
function lintPartitionSet(r: Recorder, b: Board): void {
  const presence = boardKeyPresence(b, 'LAYOUT_PARTITIONS')
  if (presence === 'absent') {
    r.fail(
      'declares no LAYOUT_PARTITIONS. Shared scripts would have to enumerate the partitions themselves, '
      + 'which is what this key exists to stop',
    )
    return
  }
  if (b.partitions.length === 0) {
    r.fail(
      `declares LAYOUT_PARTITIONS${presence === 'empty' ? ' as empty' : ' with no partition names in it'}. `
      + 'Shared scripts would have to enumerate the partitions themselves, which is what this key exists to stop',
    )
    return
  }

  const seen = new Map<number, string>()
  for (const p of b.partitions) {
    lintPartition(r, p)
    lintStartUnits(r, b, p)

    if (p.partnum === undefined) continue
    const first = seen.get(p.partnum)
    if (first !== undefined) {
      r.fail(`partition number ${p.partnum} is declared twice (${first} and ${p.name})`)
      continue
    }
    seen.set(p.partnum, p.name)
  }

  // 1..N with no gaps. systemd-repart pairs definitions with partitions IN
  // ORDER, so a hole does not fail, it shifts every definition onto the wrong
  // partition -- see the comment in os/rootfs/build-v2.sh.
  const n = b.partitions.length
  const missing: number[] = []
  for (let want = 1; want <= n; want += 1) {
    if (!seen.has(want)) missing.push(want)
  }
  if (missing.length > 0) {
    r.fail(
      `${n} partitions declared but these numbers are absent: ${missing.join(' ')}. `
      + `Numbering must be 1..${n} with no gaps`,
    )
  } else {
    r.pass(`${n} partitions, numbered 1..${n}, no gaps and no duplicates`)
  }
}

/**
 * Every key this schema reads as a number whose value is not one.
 *
 * The model collects these rather than throwing, so a board with three bad
 * integers produces three lines. They are reported before anything derived from
 * them, because `STATE_PARTNUM=seven` otherwise surfaces only as the downstream
 * "partition number 7 is absent" -- which names a partition that is declared and
 * sends the reader to the wrong line. That is what the shell predecessor did.
 */
function lintNumericFaults(r: Recorder, b: Board): void {
  for (const f of b.faults) {
    r.fail(`${f.key}=${f.value} ${f.reason}`)
  }
}

/** Lint one already-modelled board. Pure: it reads nothing and prints nothing. */
export function lintBoard(b: Board): BoardLint {
  const r = new Recorder(b.name)
  lintNumericFaults(r, b)
  lintPartitionSet(r, b)
  lintBootloader(r, b)
  lintBoardKeys(r, b)
  return { path: b.path, board: b.name, checks: r.checks, unreadable: false }
}

/**
 * Read, parse, model and lint one file.
 *
 * A file the PARSER refuses is reported as a finding rather than thrown: one
 * unreadable board must not stop the run from reporting the others, and the
 * refusal -- which names the construct, the line and the column -- is exactly
 * what a board engineer needs to read. This is where the shell predecessor was
 * weakest: an unresolvable reference killed its subshell mid-file and the run
 * said "made no assertions at all", naming neither the key nor the line.
 */
export function lintFile(path: string): BoardLint {
  const board = boardNameForPath(path)
  let modelled: Board
  try {
    modelled = loadBoard(path)
  } catch (err) {
    const message = err instanceof BoardEnvError
      ? `is not a board definition this schema can read. ${err.message}`
      : `could not be read: ${err instanceof Error ? err.message : String(err)}`
    return {
      path,
      board,
      checks: [{ board, ok: false, message }],
      unreadable: true,
    }
  }
  return lintBoard(modelled)
}

/**
 * Refuse a file that contributed no assertions at all.
 *
 * Per file, not just in total. When the x64 layout referenced a key that had
 * been renamed, `set -u` killed the shell predecessor's subshell at the first
 * line, the board contributed ZERO assertions, and the run reported
 * `RESULT: PASS (1/1 checks)` from the OTHER board alone. A total that is not
 * zero cannot see that; a per-file count can.
 *
 * It is a backstop, and exported so that it can be tested as one. No input can
 * currently reach it through lintFile: lintBoard always contributes something,
 * because a board with no LAYOUT_PARTITIONS still fails on that, and a file the
 * parser refuses becomes a finding. It was proved unreachable by mutation --
 * deleting the branch left the suite green -- and it is kept anyway, because
 * "no check can produce zero" is an invariant of the CURRENT check set, and the
 * shell predecessor's history is what happens when such an invariant quietly
 * stops holding. The invariant itself is asserted separately, over degenerate
 * files.
 */
export function requireAssertions(one: BoardLint): BoardLint {
  if (one.checks.length > 0) return one
  return {
    ...one,
    checks: [{
      board: one.board,
      ok: false,
      message: 'made no assertions at all; a layout nothing checks reports the same green as one that passes',
    }],
  }
}

export function lintPaths(paths: readonly string[]): LintRun {
  const boards = paths.map(p => requireAssertions(lintFile(p)))

  const checks = boards.flatMap(b => b.checks)
  const passed = checks.filter(c => c.ok).length
  const failed = checks.length - passed
  return { boards, checks, passed, failed, ok: failed === 0 && checks.length > 0 }
}

/**
 * The default target: every board this tree ships, by name, read off the tree.
 *
 * This was a literal, and a board added under os/boards/ was therefore a board
 * the lint never opened -- while still reporting `RESULT: PASS (26/26 checks)`,
 * which is green by having looked at less. paths.ts:requireShippedBoards
 * discovers them and refuses an empty answer; the refusal matters because an
 * empty list makes this whole run vacuous, and formatRun's own "made no
 * assertions at all" guard would then be the only thing standing between that
 * and a green.
 */
export function shippedBoardPaths(): string[] {
  return requireShippedBoards().map(b => boardEnvPath(b))
}

/** Render a run the way the shell predecessor did, so a reader's eye is unchanged. */
export function formatRun(run: LintRun): { readonly stdout: string[], readonly stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  for (const c of run.checks) {
    if (c.ok) stdout.push(`PASS: ${c.board}: ${c.message}`)
    else stderr.push(`FAIL: ${c.board}: ${c.message}`)
  }
  const total = run.checks.length
  if (total === 0) {
    stderr.push(
      'error: the linter ran and made no assertions at all. A layout that is checked by nothing '
      + 'reports the same green as one that passes',
    )
    return { stdout, stderr }
  }
  const line = `RESULT: ${run.ok ? 'PASS' : 'FAIL'} (${run.passed}/${total} checks)`
  if (run.ok) stdout.push(line)
  else stderr.push(line)
  return { stdout, stderr }
}
