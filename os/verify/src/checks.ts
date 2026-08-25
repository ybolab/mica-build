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

import { existsSync, mkdirSync } from 'node:fs'
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
 * EMPTY AT M4a. See the head of this file: this is the state the harness must
 * describe rather than round off, and os/verify/README.md's parity section
 * records what the two boards' oracles conclude that nothing here claims yet.
 */
export const CHECKS: readonly CheckCase[] = []

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

  const unpackRoot = async (slot = 'rootfs-a'): Promise<string> => {
    const existing = roots.get(slot)
    if (existing !== undefined) return existing
    const started = (async () => {
      const payload = await extract(slot)
      const dest = join(workDir, `root-${slot}`)
      if (existsSync(dest)) return dest
      return squashfsExtract(tools, payload, dest)
    })()
    roots.set(slot, started)
    return started
  }

  return { board, image, tools, workDir, gpt, partition, fatSlot, extract, unpackRoot }
}
