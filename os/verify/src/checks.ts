// The check register: one entry per image-contract check, carrying BOTH the
// TypeScript that decides it and the shell conclusion it replaces.
//
// PLAN-014 M4 (RFCT-110). At M4a this register is EMPTY, on purpose: M4a builds
// the instrument, M4b..M4d fill it in batches, M4e deletes
// os/verify-image-v2.sh once nothing is left unclaimed. An empty register is
// not a neutral state and the harness does not treat it as one -- every one of
// the oracle's conclusions comes out `not-ported`, and the run's conclusion is
// INCOMPLETE.
//
// ═══ WHY THE MATCHER LIVES ON THE CHECK ═══
//
// The obvious alternative is a table mapping ids to substrings, kept beside the
// checks. It was rejected for the reason ui-location-test.sh gives for its own
// register being one structure rather than two: a port and its identity that
// live in different places drift, and the drift is invisible -- a check whose
// matcher stopped matching reports the same "no divergence" as a check that
// agrees. Here the two cannot separate. A CheckCase with no `shell` matcher
// does not typecheck; a matcher with no check is not a CheckCase.
//
// ═══ WHAT M4b ADDS, PER CHECK ═══
//
//   {
//     id: 'gpt-disk-guid',
//     shell: { pass: 'disk GUID is' },          // eq_ci prints "X is Y" / "X is 'Z', expected Y"
//     run: async (ctx) => {
//       const gpt = await ctx.gpt()
//       const want = ctx.board.get('DISK_GUID') ?? ''
//       return [eq('gpt-disk-guid', gpt.diskGuid, want, `disk GUID is ${want}`)]
//     },
//   }
//
// and, in the same change, its negative test -- a port without one is not done
// (RFCT-096). The harness cannot tell a check that passes from a check that
// cannot fail; only a fixture that drives it red can.

import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import {
  extractRange,
  readGpt,
  squashfsExtract,
  type FatSlot,
  type GptPartition,
  type GptTable,
} from './image.ts'
import { FSTAB_CHECKS } from './checks-fstab.ts'
import { GPT_CHECKS } from './checks-gpt.ts'
import { RAUC_CHECKS } from './checks-rauc.ts'
import { ROOT_CHECKS } from './checks-root.ts'
import { SLOT_CHECKS } from './checks-slots.ts'
import { ToolOutputError, type ToolRuntime } from './tools.ts'
import type { CheckResult, RegisteredCheck, Verdict } from './parity.ts'

export type { CheckResult, Verdict }

/**
 * What a check is handed. Everything here reads the image; nothing writes to it.
 *
 * The geometry comes from the GPT THE IMAGE ACTUALLY CARRIES, not from the
 * board definition. That is deliberate: a check comparing the image to the
 * board definition must read the two independently, and a context that resolved
 * partitions through the board definition would hand a check the same number on
 * both sides of its own comparison.
 */
export interface ImageContext {
  readonly board: Board
  readonly image: string
  readonly tools: ToolRuntime
  /** A directory the helpers may write extracts into. Never the image's own. */
  readonly workDir: string
  /** The partition table, read once. */
  gpt: () => Promise<GptTable>
  /** A partition by GPT name (`boot-a`) or number. Throws when there is none. */
  partition: (nameOrNumber: string | number) => Promise<GptPartition>
  /** The FAT at that partition's offset -- mtools reads it in place. */
  fatSlot: (nameOrNumber: string | number) => Promise<FatSlot>
  /** That partition's bytes, extracted once into workDir. */
  extract: (nameOrNumber: string | number) => Promise<string>
  /** The read-only root, unpacked once out of the named verity slot. */
  unpackRoot: (slot?: string) => Promise<string>
}

export interface CheckCase extends RegisteredCheck {
  /**
   * Decide the check, and hand back one result per firing.
   *
   * A check that cannot decide THROWS. It does not return a `fail`: a fail is a
   * statement about the image, and "sgdisk would not run" is not one. The
   * harness turns a throw into a named error against this id, which is
   * distinguishable from both directions of the check.
   */
  readonly run: (ctx: ImageContext) => Promise<readonly CheckResult[]>
}

/**
 * Every ported check, in no particular order.
 *
 * One module per batch, concatenated here. The batches are separate files and
 * not sections of this one because each carries its own reading of the image --
 * the GPT walk, the FAT slots, the packed root -- and because M4c and M4d add
 * to the register without touching what M4b landed.
 *
 * M4a left this EMPTY on purpose; M4b filled in batch 1 (GPT geometry, the boot
 * slots' filesystems, and the RAUC contract) and M4c batch 2 (the packed root's
 * content, /etc/fstab and where the custom UI root lands). What is still
 * unclaimed stays `not-ported` rather than being rounded off to agreement.
 */
export const CHECKS: readonly CheckCase[] = [
  ...GPT_CHECKS,
  ...SLOT_CHECKS,
  ...RAUC_CHECKS,
  ...ROOT_CHECKS,
  ...FSTAB_CHECKS,
]

/**
 * Refuse a register that cannot be diffed, before anything runs against it.
 *
 * diffParity refuses a duplicate id and a `many` with no instance pattern, but
 * only once it has a shell run in hand -- and a register fault should be found
 * by `bun test`, on a host with no image, rather than three minutes into a
 * parity run. The two overlap on purpose: the same fault stops the harness
 * whichever door it comes in by.
 */
export function assertRegisterWellFormed(checks: readonly CheckCase[] = CHECKS): void {
  const seen = new Set<string>()
  for (const c of checks) {
    if (c.id.trim() === '') {
      throw new ToolOutputError('a check is registered with an empty id; the id IS its identity.')
    }
    if (seen.has(c.id)) {
      throw new ToolOutputError(`two checks are registered as '${c.id}'.`)
    }
    seen.add(c.id)
    if (c.shell.pass.trim() === '') {
      throw new ToolOutputError(
        `check '${c.id}' registers an empty PASS matcher. An empty substring is contained in every `
        + `line, so it would claim the FIRST shell conclusion of the run and compare this check's `
        + `verdict against something unrelated.`,
      )
    }
    if (c.cardinality === 'many' && c.instance === undefined) {
      throw new ToolOutputError(
        `check '${c.id}' fires many times and registers no \`instance\` pattern, so its firings `
        + `could only be compared by count.`,
      )
    }
    if (c.boards !== undefined && c.boards.length === 0) {
      throw new ToolOutputError(
        `check '${c.id}' declares \`boards: []\`, so it applies to no board and can never run. `
        + `Omit the field to mean every board; an empty list is the shape a filtered-down list `
        + `takes when the filter was wrong.`,
      )
    }
  }
}

/** The checks that apply to a board, which is what the diff is scoped to. */
export function checksFor(board: string, checks: readonly CheckCase[] = CHECKS): CheckCase[] {
  return checks.filter(c => c.boards === undefined || c.boards.includes(board))
}

export interface CheckFailure {
  readonly id: string
  readonly error: Error
}

export interface CheckRun {
  readonly results: readonly CheckResult[]
  /** Checks that threw. Never folded into a `fail`; see CheckCase.run. */
  readonly failures: readonly CheckFailure[]
}

/**
 * Run the register against one image.
 *
 * Sequential, not concurrent. Several checks extract multi-hundred-megabyte
 * partitions through one container, and the cache below only helps if the
 * second asker waits for the first rather than starting its own extract.
 */
export async function runChecks(ctx: ImageContext, checks: readonly CheckCase[] = CHECKS): Promise<CheckRun> {
  const results: CheckResult[] = []
  const failures: CheckFailure[] = []
  for (const check of checksFor(ctx.board.name, checks)) {
    try {
      const got = await check.run(ctx)
      for (const r of got) {
        if (r.id !== check.id) {
          throw new ToolOutputError(
            `check '${check.id}' produced a result labelled '${r.id}'. The id is the identity the `
            + `parity diff pairs on; a mislabelled result would be compared against another check's `
            + `shell conclusion.`,
          )
        }
        results.push(r)
      }
      if (got.length === 0) {
        throw new ToolOutputError(
          `check '${check.id}' ran and concluded nothing. A check that returns no result is `
          + `invisible in a pass/fail count and reports the same absence of failure as one that `
          + `passed -- so it is an error here, not a quiet zero.`,
        )
      }
    }
    catch (error) {
      failures.push({ id: check.id, error: error instanceof Error ? error : new Error(String(error)) })
    }
  }
  return { results, failures }
}

// ---------------------------------------------------------------------------
// building the context
// ---------------------------------------------------------------------------

export interface ContextRequest {
  readonly board: Board
  readonly image: string
  readonly tools: ToolRuntime
  readonly workDir: string
}

/**
 * A short content digest of a file, for naming a cache entry after what is IN it.
 *
 * Streamed in 4 MiB chunks rather than read whole: the payloads this names are
 * whole partitions -- 256 MiB on cx3576, 512 MiB on x64 -- and reading one into
 * a Buffer to hash it would cost more memory than every other thing this
 * harness does put together.
 *
 * Sixteen hex characters, not all sixty-four. This is a cache key inside one
 * work directory and not a signature: it names a directory a human reads in
 * `ls`, the population it distinguishes is the handful of images one host
 * builds, and 64 bits of SHA-256 is far past the point where two of them
 * collide. Nothing here is a security claim -- an attacker who could choose the
 * payload could also choose the image.
 */
function digestOf(file: string): string {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const chunk = new Uint8Array(4 * 1024 * 1024)
    let position = 0
    for (;;) {
      const got = readSync(fd, chunk, 0, chunk.length, position)
      if (got === 0) break
      hash.update(chunk.subarray(0, got))
      position += got
    }
  }
  finally {
    closeSync(fd)
  }
  return hash.digest('hex').slice(0, 16)
}

export function createImageContext(request: ContextRequest): ImageContext {
  const { board, image, tools, workDir } = request
  mkdirSync(workDir, { recursive: true })

  let gptOnce: Promise<GptTable> | undefined
  const extracts = new Map<number, Promise<string>>()
  const roots = new Map<string, Promise<string>>()

  const gpt = (): Promise<GptTable> => {
    gptOnce ??= readGpt(tools, image)
    return gptOnce
  }

  const partition = async (nameOrNumber: string | number): Promise<GptPartition> => {
    const table = await gpt()
    const found = typeof nameOrNumber === 'number'
      ? table.partition(nameOrNumber)
      : table.partitions.find(p => p.name.toLowerCase() === nameOrNumber.toLowerCase())
    if (found === undefined) {
      throw new ToolOutputError(
        `${image} has no partition '${nameOrNumber}'. It carries `
        + `${table.partitions.map(p => `${p.number}:${p.name}`).join(', ')}.\n`
        + `  Answered as a throw rather than as a failed check: which partitions exist is itself `
        + `asserted by a check, and a helper that answered "absent" here would let that check's `
        + `verdict be produced twice, in two places, with no guarantee they agree.`,
      )
    }
    return found
  }

  const fatSlot = async (nameOrNumber: string | number): Promise<FatSlot> => {
    const p = await partition(nameOrNumber)
    const table = await gpt()
    return { image, offsetBytes: p.firstSector * table.sectorSize }
  }

  const extract = async (nameOrNumber: string | number): Promise<string> => {
    const p = await partition(nameOrNumber)
    const existing = extracts.get(p.number)
    if (existing !== undefined) return existing
    const started = (async () => {
      const table = await gpt()
      const dest = join(workDir, `p${p.number}-${p.name || 'unnamed'}.img`)
      return extractRange(image, p.firstSector * table.sectorSize, p.sizeSectors * table.sectorSize, dest)
    })()
    extracts.set(p.number, started)
    return started
  }

  // THE CACHE IS KEYED ON THE PAYLOAD'S CONTENT, and that is the whole point.
  //
  // It used to be keyed on the slot's NAME -- `root-rootfs-a` -- and short-
  // circuited on `existsSync(dest)`. `extract` beside it always reopens its
  // destination with 'w', so a second run at the same `--work` against a
  // DIFFERENT image re-extracted the partition and then handed back the
  // PREVIOUS image's unpacked root. The two runs described two different images
  // and nothing anywhere complained: every packed-root check went on reading a
  // tree that had nothing to do with the image named on the command line, and
  // reported agreement about it. M4b avoided it by clearing _out/parity before
  // every run and said so; a cache whose correctness depends on the caller
  // remembering to delete it is not a cache.
  //
  // WHY KEYING AND NOT DROPPING THE SHORT-CIRCUIT. Dropping it does stop the
  // silent wrong answer -- `squashfsExtract` refuses a `dest` that exists, by
  // name -- but it converts every re-run at one `--work` into a hard refusal,
  // so the only way to run twice is the `rm -rf` that was already the
  // workaround. Keying on content keeps the reuse AND makes it sound: the same
  // bytes resolve to the same directory, different bytes cannot, and the key
  // cannot go stale because it IS the content. Nothing has to be invalidated.
  //
  // WHY IT IS PUBLISHED BY RENAME. A run killed mid-unsquashfs leaves a PARTIAL
  // tree, and a partial tree at the right name is indistinguishable from a
  // complete one -- `existsSync` says yes to both, and "is X absent from the
  // image?" then passes for every path unsquashfs had not reached yet. That is
  // the same defect one layer down, and this campaign has had two L3s SIGKILLed
  // mid-run. So the unpack lands in a staging directory and is moved into place
  // only once it has finished; a kill leaves `.unpack-*`, which is a name
  // nothing reads.
  const unpackRoot = async (slot = 'rootfs-a'): Promise<string> => {
    const existing = roots.get(slot)
    if (existing !== undefined) return existing
    const started = (async () => {
      const payload = await extract(slot)
      const dest = join(workDir, `root-${slot}-${digestOf(payload)}`)
      if (existsSync(dest)) return dest
      const staging = mkdtempSync(join(workDir, `.unpack-${slot}-`))
      try {
        await squashfsExtract(tools, payload, join(staging, 'root'))
        try {
          renameSync(join(staging, 'root'), dest)
        }
        catch (error) {
          // Another unpack of the SAME payload won the race and published first.
          // Its tree is this tree -- same content hash, same archive -- so the
          // published one is taken rather than the rename being retried.
          if (!existsSync(dest)) throw error
        }
      }
      finally {
        rmSync(staging, { recursive: true, force: true })
      }
      return dest
    })()
    roots.set(slot, started)
    return started
  }

  return { board, image, tools, workDir, gpt, partition, fatSlot, extract, unpackRoot }
}
