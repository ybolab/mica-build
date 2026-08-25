// A synthetic image, for driving a ported check RED.
//
// PLAN-014 M4b (RFCT-110). RFCT-096's rule is that a ported check lands with
// the fixture that fails it, because the parity harness cannot tell a check
// that PASSES from a check that CANNOT FAIL -- both report "agrees with the
// oracle" against a healthy image, and only a mutation separates them.
//
// ═══ WHY A FAKE IMAGE AND NOT A MUTATED REAL ONE ═══
//
// Both, actually: `os/verify/HARNESS.md` records an end-to-end run against a
// real image edited on disk, which is what proves the whole pipeline reports
// the failing direction. What that run CANNOT be is one mutation per check --
// it is a 1.3 GB copy and a three-minute run each time, and half the mutations
// (a partition that is not the last one, a table with a partition missing)
// cannot be made with sgdisk without making three other checks red at the same
// time, so the failure would not name one check.
//
// So each check is also driven here, against a table built in memory: one
// mutation, one check, one named failure, no image and no container. The
// baseline is asserted GREEN first in every case, because a fixture that fails
// a check it did not mutate proves nothing about the mutation.

import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Board } from './board.ts'
import type { ImageContext } from './checks.ts'
import type { FatSlot, GptPartition, GptTable } from './image.ts'
import { walkLayout } from './layout.ts'
import type { ToolResult, ToolRuntime } from './tools.ts'
import { ToolOutputError } from './tools.ts'

/** A tool run that never happened, for the checks that drive no tool. */
const NO_TOOLS: ToolRuntime = {
  route: 'host',
  announce: 'os/verify: no tools (fixture)',
  run: async (argv): Promise<ToolResult> => {
    throw new ToolOutputError(
      `the fixture runtime was asked to run \`${argv.join(' ')}\`. A check reaching a real tool from `
      + `a synthetic context is reading something the fixture did not set up, so the verdict would `
      + `be about the host rather than about the mutation.`,
    )
  },
  dispose: async () => {},
}

/** A runtime that answers exactly one command and refuses every other. */
export function toolsAnswering(match: RegExp, result: Partial<ToolResult>): ToolRuntime {
  return {
    ...NO_TOOLS,
    run: async (argv): Promise<ToolResult> => {
      const line = argv.join(' ')
      if (!match.test(line)) return NO_TOOLS.run(argv)
      return { argv, code: 0, stdout: '', stderr: '', ...result }
    },
  }
}

export { NO_TOOLS }

/**
 * The GPT a board's own definition describes -- i.e. the table of an image that
 * is exactly right.
 *
 * Built by the SAME walk the checks compare against, which is the one place
 * that is legitimate: the fixture's job is to be green until it is mutated, so
 * a baseline the checks agree with is the baseline. Every assertion below then
 * comes from a MUTATION of it, and it is the mutation that is the test.
 */
export function healthyGpt(board: Board, slotSectors: number): GptTable {
  const walk = walkLayout(board, slotSectors)
  const partitions: GptPartition[] = walk.rows.map(row => ({
    number: row.number,
    firstSector: row.startSector,
    lastSector: row.startSector + row.sizeSectors - 1,
    sizeSectors: row.sizeSectors,
    typeGuid: row.typecode,
    uniqueGuid: row.guid,
    name: row.label,
    attributeFlags: '0000000000000000',
  }))
  return {
    image: '(fixture)',
    sectorSize: board.sectorSize ?? 512,
    diskGuid: board.get('DISK_GUID') ?? '',
    totalSectors: walk.totalSizeMib * walk.sectorsPerMib,
    partitions,
    partition: (n: number) => partitions.find(p => p.number === n),
  }
}

/** `healthyGpt` with one partition's fields replaced. */
export function gptWith(
  table: GptTable,
  number: number,
  over: Partial<GptPartition>,
): GptTable {
  const partitions = table.partitions.map(p => (p.number === number ? { ...p, ...over } : p))
  return { ...table, partitions, partition: (n: number) => partitions.find(p => p.number === n) }
}

/** `healthyGpt` with one partition removed entirely. */
export function gptWithout(table: GptTable, number: number): GptTable {
  const partitions = table.partitions.filter(p => p.number !== number)
  return { ...table, partitions, partition: (n: number) => partitions.find(p => p.number === n) }
}

export interface FixtureRequest {
  readonly board: Board
  readonly gpt: GptTable
  readonly tools?: ToolRuntime
  /** The size the file at `ctx.image` should report. Defaults to the walk's. */
  readonly imageBytes?: number
}

export interface Fixture {
  readonly ctx: ImageContext
  readonly dispose: () => void
}

/**
 * A context over a synthetic table and a real, EMPTY file of a chosen size.
 *
 * The file has to exist because `gpt-image-size` stats it, and it is sparse
 * because the size is the only thing about it any check reads. Everything that
 * would touch the image's CONTENT throws, by name: a check that reached for
 * bytes here would be answered by the fixture rather than by the mutation.
 */
export function imageFixture(request: FixtureRequest): Fixture {
  const { board, gpt, tools = NO_TOOLS } = request
  const dir = mkdtempSync(join(tmpdir(), 'mos-image-fixture-'))
  const image = join(dir, 'fixture.img')
  writeFileSync(image, '')
  const walk = walkLayout(board, gpt.partition(Number(board.get('ROOTFS_A_PARTNUM')))?.sizeSectors ?? 0)
  truncateSync(image, request.imageBytes ?? walk.totalSizeMib * (board.mibBytes ?? 1048576))

  const refuse = (what: string): never => {
    throw new ToolOutputError(`the fixture has no ${what}; this check reads more than the table.`)
  }

  const ctx: ImageContext = {
    board,
    image,
    tools,
    workDir: dir,
    gpt: async () => gpt,
    partition: async (nameOrNumber: string | number) => {
      const found = typeof nameOrNumber === 'number'
        ? gpt.partition(nameOrNumber)
        : gpt.partitions.find(p => p.name.toLowerCase() === String(nameOrNumber).toLowerCase())
      if (found === undefined) throw new ToolOutputError(`the fixture table has no partition '${nameOrNumber}'`)
      return found
    },
    fatSlot: async (nameOrNumber: string | number): Promise<FatSlot> => {
      const found = typeof nameOrNumber === 'number'
        ? gpt.partition(nameOrNumber)
        : gpt.partitions.find(p => p.name.toLowerCase() === String(nameOrNumber).toLowerCase())
      if (found === undefined) throw new ToolOutputError(`the fixture table has no partition '${nameOrNumber}'`)
      return { image, offsetBytes: found.firstSector * gpt.sectorSize }
    },
    extract: async () => refuse('extracted partition payloads'),
    unpackRoot: async () => refuse('unpacked root'),
  }

  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
