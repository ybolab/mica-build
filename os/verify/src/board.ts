// The typed view of a board definition.
//
// What this adds over the parse. `board-env.ts` turns the file into a map of
// strings, faithfully. This turns that map into the shape the rest of os/
// actually reasons about: an ordered partition set, each entry's role and its
// geometry, the bootloader backend, and the four lists a board declares. The
// point is that a consumer stops spelling out `${BOOT_A_START_SECTOR:-}` and
// starts asking a partition for its start sector.
//
// The line this file does not cross. It never decides whether a board
// definition is CORRECT. A missing LAYOUT_PARTITIONS, a role no checker knows,
// a partition with no PARTNUM -- all of those are reported as absent or
// unknown and handed on. The schema lint is a separate consumer of this model
// (os/verify/src/lint.ts), and it is the one
// that gets to say a board is wrong. Two reasons: a model that threw on the
// first fault could only ever report one, and a lint whose messages came from
// its data layer would say what the model noticed rather than what a board
// engineer needs to read.
//
// So: the PARSER throws, because a file it cannot read faithfully is not a
// board definition at all. The MODEL does not, because a board definition it
// can read and disagrees with is exactly what a lint exists to report.
//
// Declared-empty is not absent, and keeping the two apart is most of the value
// here. `BOARD_FIRMWARE_FILES=""` on x64 is a statement -- a QEMU machine has
// no radio firmware -- and `BOARD_HWINIT_CONFS=""` likewise. Under the
// `${X:-}` idiom every shell consumer uses, those are indistinguishable from a
// board that never mentioned them. Here the first is `[]` and the second is
// `undefined`.

import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseBoardEnv, type BoardEnvFile } from './board-env.ts'

/** The roles the board definitions dispatch on. */
export const KNOWN_ROLES = ['raw-blob', 'uboot-env', 'esp', 'verity-slot', 'ext4'] as const
export type KnownRole = (typeof KNOWN_ROLES)[number]

export function isKnownRole(role: string | undefined): role is KnownRole {
  return role !== undefined && (KNOWN_ROLES as readonly string[]).includes(role)
}

/**
 * A key the model is typed to read as a number, whose value is not one.
 *
 * Collected rather than thrown: a board with three bad integers should produce
 * three lines, not stop at the first.
 */
export interface BoardFault {
  readonly key: string
  readonly value: string
  readonly reason: string
}

export interface Partition {
  /** The name as it appears in LAYOUT_PARTITIONS, e.g. `BOOT_A`. */
  readonly name: string
  /** 1-based position in LAYOUT_PARTITIONS -- the order repart pairs on. */
  readonly position: number
  readonly role: string | undefined
  readonly partnum: number | undefined
  readonly label: string | undefined
  readonly guid: string | undefined
  readonly typecode: string | undefined
  readonly startMib: number | undefined
  readonly startSector: number | undefined
  readonly offsetBytes: number | undefined
  readonly sizeMib: number | undefined
  readonly sizeSectors: number | undefined
  readonly magicHex: string | undefined
  readonly fatLabel: string | undefined
  readonly fatVolumeId: string | undefined
  readonly fsLabel: string | undefined
  readonly fsUuid: string | undefined
  /** Raw access for any suffix, e.g. `MOUNT`. Undefined when not declared. */
  get: (suffix: string) => string | undefined
  /** True even when the value is the empty string. */
  declared: (suffix: string) => boolean
}

export interface Board {
  readonly path: string
  /** The directory name -- `boards/<board>/board.env` -- which is a board's identity. */
  readonly name: string
  readonly env: BoardEnvFile
  readonly layoutVersion: number | undefined
  /** What the file calls itself. Not assumed equal to `name`; a lint may compare them. */
  readonly layoutBoard: string | undefined
  readonly arch: string | undefined
  readonly sectorSize: number | undefined
  readonly mibBytes: number | undefined
  /** Undefined when the key is absent; empty when it is declared empty. */
  readonly layoutPartitions: readonly string[] | undefined
  readonly partitions: readonly Partition[]
  readonly bootloader: string | undefined
  readonly grubenv: string | undefined
  readonly bootAttemptsDefault: number | undefined
  readonly hasStatusLed: string | undefined
  readonly sizeBudgetMb: number | undefined
  readonly cmdlineArgs: string | undefined
  readonly firmwareFiles: readonly string[] | undefined
  readonly hwinitConfs: readonly string[] | undefined
  readonly radios: readonly string[] | undefined
  readonly bootSlotRequiredFiles: readonly string[] | undefined
  readonly espRequiredFiles: readonly string[] | undefined
  /** Keys typed as numbers here whose values are not. Never thrown, never dropped. */
  readonly faults: readonly BoardFault[]
  get: (key: string) => string | undefined
  declared: (key: string) => boolean
  partition: (name: string) => Partition | undefined
}

/** Build the typed view over an already-parsed definition. */
export function modelBoard(env: BoardEnvFile, name: string): Board {
  const faults: BoardFault[] = []

  const get = (key: string): string | undefined => env.values.get(key)
  const declared = (key: string): boolean => env.values.has(key)

  // A key typed as a number here is read as a `number`, and a `number` is a
  // DOUBLE. Past 2^53 that stops being exact -- which is the same reason
  // board-env.ts:431-434 evaluates `$(( ))` in BigInt and says so: "a size that
  // is silently one byte out is the class of defect this whole package exists
  // to make visible". Handing back `Number(t)` regardless would read
  // `ROOTFS_A_SIZE_SECTORS=9007199254740993` back as ...992 with `faults`
  // EMPTY -- inexact, and silent about it, in the one place whose job is to be
  // neither.
  //
  // A FAULT, not a BigInt. Widening the type would ripple through walkLayout,
  // every GPT comparison and image.ts's sector arithmetic -- a change to the
  // instrument, mid-migration, for a value no shipped board is within eleven
  // orders of magnitude of. What was actually wrong is that the loss was
  // SILENT, and `faults` is this file's existing word for "declared as a number
  // and not usable as one": it is never thrown and never dropped, and
  // lint.ts:499-503 prints one line per fault before anything derived from it.
  //
  // The boundary is `Number.isSafeInteger`, so a value at exactly 2^53 is
  // refused too. It round-trips, but its neighbours do not, and a board one
  // increment away from silent inexactness is not a board this package should
  // be quiet about.
  const int = (key: string): number | undefined => {
    const v = env.values.get(key)
    if (v === undefined) return undefined
    const t = v.trim()
    if (!/^[+-]?[0-9]+$/.test(t)) {
      faults.push({ key, value: v, reason: 'is read as a number here, and it is not one' })
      return undefined
    }
    const n = Number(t)
    if (!Number.isSafeInteger(n)) {
      faults.push({
        key,
        value: v,
        reason: `is a whole number too large to read exactly as a double (it would come back as `
          + `${BigInt(t) < 0n ? '-' : ''}${n.toLocaleString('en-US', { useGrouping: false })}); `
          + `values here must be within ±(2^53 - 1)`,
      })
      return undefined
    }
    return n
  }

  // A list is whitespace-separated, which is how every shell consumer already
  // iterates these -- `for f in ${BOARD_FIRMWARE_FILES}`. Declared-and-empty
  // stays [] and absent stays undefined; the whole point is that those differ.
  const list = (key: string): readonly string[] | undefined => {
    const v = env.values.get(key)
    if (v === undefined) return undefined
    const parts = v.split(/\s+/).filter(s => s !== '')
    return parts
  }

  const layoutPartitions = list('LAYOUT_PARTITIONS')

  const partitions: Partition[] = (layoutPartitions ?? []).map((pname, idx) => {
    const k = (suffix: string): string => `${pname}_${suffix}`
    return {
      name: pname,
      position: idx + 1,
      role: get(k('ROLE')),
      partnum: int(k('PARTNUM')),
      label: get(k('LABEL')),
      guid: get(k('GUID')),
      typecode: get(k('TYPECODE')),
      startMib: int(k('START_MIB')),
      startSector: int(k('START_SECTOR')),
      offsetBytes: int(k('OFFSET_BYTES')),
      sizeMib: int(k('SIZE_MIB')),
      sizeSectors: int(k('SIZE_SECTORS')),
      magicHex: get(k('MAGIC_HEX')),
      fatLabel: get(k('FAT_LABEL')),
      fatVolumeId: get(k('FAT_VOLUME_ID')),
      fsLabel: get(k('FS_LABEL')),
      fsUuid: get(k('FS_UUID')),
      get: (suffix: string) => get(k(suffix)),
      declared: (suffix: string) => declared(k(suffix)),
    }
  })

  const byName = new Map(partitions.map(p => [p.name, p]))

  return {
    path: env.path,
    name,
    env,
    layoutVersion: int('LAYOUT_VERSION'),
    layoutBoard: get('LAYOUT_BOARD'),
    arch: get('MOS_ARCH'),
    sectorSize: int('SECTOR_SIZE'),
    mibBytes: int('MIB_BYTES'),
    layoutPartitions,
    partitions,
    bootloader: get('RAUC_BOOTLOADER'),
    grubenv: get('RAUC_GRUBENV'),
    bootAttemptsDefault: int('BOOT_ATTEMPTS_DEFAULT'),
    hasStatusLed: get('BOARD_HAS_STATUS_LED'),
    sizeBudgetMb: int('BOARD_SIZE_BUDGET_MB'),
    cmdlineArgs: get('BOARD_CMDLINE_ARGS'),
    firmwareFiles: list('BOARD_FIRMWARE_FILES'),
    hwinitConfs: list('BOARD_HWINIT_CONFS'),
    radios: list('BOARD_RADIOS'),
    bootSlotRequiredFiles: list('BOOT_SLOT_REQUIRED_FILES'),
    espRequiredFiles: list('ESP_REQUIRED_FILES'),
    faults,
    get,
    declared,
    partition: (n: string) => byName.get(n),
  }
}

/**
 * The board name a path stands for.
 *
 * The board's identity is its DIRECTORY, not the filename: every board
 * definition is called `board.env`, so a basename would report them all as
 * "board.env". A file called anything else keeps its own name -- which is what
 * makes a mutated copy report as "candidate.env" rather than as a real board
 * it is not.
 *
 * Exported because the lint needs it for a file the parser REFUSED, where
 * there is no Board to ask.
 */
export function boardNameForPath(path: string): string {
  return basename(path) === 'board.env' ? basename(dirname(path)) : basename(path)
}

/** Read and model one `boards/<board>/board.env`. */
export function loadBoard(path: string): Board {
  const text = readFileSync(path, 'utf8')
  const env = parseBoardEnv(text, path)
  return modelBoard(env, boardNameForPath(path))
}

/** Read every board under a `boards/` directory, in name order. */
export function loadBoards(boardsDir: string, names: readonly string[]): Board[] {
  return names.map(n => loadBoard(join(boardsDir, n, 'board.env')))
}
