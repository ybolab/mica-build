// sgdisk: the GPT.
//
// FAILURE SIGNAL. Its exit status, mostly -- with one exception that the shell
// already learned and that is carried over here: `sgdisk --verify` can print
// problems AND exit 0. os/mkimage-v2.sh says so in as many words ("Both failure
// shapes -- nonzero exit AND problem text with exit 0 -- must reach the same
// friendly error"), so verifyGpt below requires exit 0 and the sentence.
//
// THE OTHER THING sgdisk DOES QUIETLY is move a partition. A requested start
// that is not a multiple of the alignment is RELOCATED, silently, with a
// success exit. Measured here on 2026-08-25: `--new=1:64:+32704S` with no
// `-a 1` lands the partition at sector 2048 and exits 0. On cx3576 that is the
// bootloader ending up outside its own partition, which is why
// GPT_ALIGN_SECTORS=1 is in that board's definition. So asking sgdisk for a
// layout proves nothing about the layout: readPartition exists to read back
// what is actually there, and it is the caller (M6b) that compares.
//
// WHAT THE ARGV SHAPE IS, AND WHY IT IS ONE SHAPE. The two shell assemblers
// spell the same GPT differently: os/mkimage-v2.sh passes `--clear`, `-a 1` and
// sizes as `+NS`, in the order new/change-name/typecode/partition-guid;
// os/mkimage-x64.sh passes no --clear, no -a, sizes as `+NM`, in the order
// new/typecode/partition-guid/change-name. Normalising that would be a change
// to the shipped bytes made inside the milestone that must prove nothing
// changed -- unless it is not a change at all, which was MEASURED rather than
// assumed (2026-08-25, sgdisk 1.0.10, both orders and both size suffixes over
// the same two partitions):
//
//   flag order new/name/type/guid vs new/type/guid/name   byte-identical
//   +131072S vs +64M at 512-byte sectors                  byte-identical
//   --clear on a freshly truncated (all-zero) file        byte-identical
//   -a 1 where every start is already MiB-aligned         byte-identical
//   -a 1 where a start is sector 64                       NOT the same: 64 vs 2048
//
// So the shape below is one shape, and the only knob that survives is the one
// that was shown to matter: alignSectors. The suite re-runs those comparisons,
// so the day a different sgdisk disagrees, it says so here rather than in M6b's
// byte-identity gate.

import type { Toolbox, ToolResult } from '../toolbox.ts'
import { ToolError } from '../toolbox.ts'

export interface GptPartitionSpec {
  readonly partnum: bigint
  readonly startSector: bigint
  readonly sizeSectors: bigint
  readonly label?: string
  readonly typecode?: string
  readonly guid?: string
}

export interface GptSpec {
  readonly diskGuid: string
  /**
   * `-a N`. Omitted leaves sgdisk's own default (2048), which is what
   * os/mkimage-x64.sh does; cx3576 must pass 1 or its loader is relocated.
   * Never defaulted here -- an alignment nobody asked for is how the loader
   * moved in the first place.
   */
  readonly alignSectors?: bigint
  /** `--clear`. A no-op on an all-zero file, measured; kept because a rewrite is not. */
  readonly clear?: boolean
  readonly partitions: readonly GptPartitionSpec[]
}

/**
 * The argv for one sgdisk call that writes a whole GPT.
 *
 * Pure, so the shape can be asserted without a disk. Every refusal here is one
 * whose absence would produce a well-formed and wrong partition table -- the
 * kind sgdisk writes happily and a device fails to boot from.
 */
export function writeGptArgs(spec: GptSpec, image: string): string[] {
  if (spec.partitions.length === 0) {
    // A GPT with no partitions is a valid GPT, so sgdisk would write one and
    // exit 0. That is a flashable image with nothing on it.
    throw new Error(
      `sgdisk was asked to write a GPT with no partitions in it onto ${image}. That is a valid `
      + `partition table and sgdisk would write it and succeed, which makes it exactly the kind of `
      + `empty success this tree refuses elsewhere.`,
    )
  }

  const seen = new Map<bigint, string>()
  for (const p of spec.partitions) {
    const label = p.label ?? `#${p.partnum}`
    const first = seen.get(p.partnum)
    if (first !== undefined) {
      // sgdisk applies both, and the second wins. The result is a table with
      // one fewer partition than the layout listed and no complaint.
      throw new Error(
        `partition number ${p.partnum} is given twice (${first} and ${label}) for ${image}. sgdisk `
        + `would apply both --new flags to the same slot, the second overwriting the first, and exit 0 `
        + `with one fewer partition than was asked for.`,
      )
    }
    seen.set(p.partnum, label)
    if (p.partnum <= 0n) throw new Error(`${label} has partition number ${p.partnum}; GPT numbers start at 1`)
    if (p.sizeSectors <= 0n) {
      // `--new=N:start:+0S` is sgdisk's spelling for "to the end of the disk",
      // so a zero size does not fail: it produces a partition that swallows
      // every partition after it.
      throw new Error(
        `${label} is ${p.sizeSectors} sectors long. sgdisk reads a zero-or-absent length as "to the `
        + `end of the disk", so this would not fail -- it would produce a partition covering every `
        + `one after it.`,
      )
    }
    if (p.startSector < 0n) throw new Error(`${label} starts at sector ${p.startSector}`)
  }

  const argv: string[] = ['sgdisk']
  if (spec.clear === true) argv.push('--clear')
  if (spec.alignSectors !== undefined) argv.push('-a', String(spec.alignSectors))
  argv.push(`--disk-guid=${spec.diskGuid}`)
  for (const p of spec.partitions) {
    argv.push(`--new=${p.partnum}:${p.startSector}:+${p.sizeSectors}S`)
    if (p.label !== undefined) argv.push(`--change-name=${p.partnum}:${p.label}`)
    if (p.typecode !== undefined) argv.push(`--typecode=${p.partnum}:${p.typecode}`)
    if (p.guid !== undefined) argv.push(`--partition-guid=${p.partnum}:${p.guid}`)
  }
  argv.push(image)
  return argv
}

/** Write the GPT. Throws a ToolError carrying sgdisk's own words on any failure. */
export async function writeGpt(tb: Toolbox, image: string, spec: GptSpec): Promise<ToolResult> {
  return tb.must(writeGptArgs(spec, image), { note: `sgdisk could not write the GPT of ${image}` })
}

/**
 * `sgdisk --verify`, with BOTH of its failure shapes reaching the same refusal.
 *
 * A nonzero exit, and problem text with exit 0. os/mkimage-v2.sh's guard is the
 * source of that pairing; without the second half a table with overlapping
 * partitions passes.
 */
export async function verifyGpt(tb: Toolbox, image: string): Promise<string> {
  const r = await tb.run(['sgdisk', '--verify', image])
  const output = `${r.stdout}${r.stderr}`
  if (!r.ok || !output.includes('No problems found')) {
    throw new ToolError(
      r,
      `sgdisk --verify reported problems with ${image} (exit ${r.exitCode})`,
    )
  }
  return output
}

export interface GptPartitionInfo {
  readonly partnum: bigint
  readonly firstSector: bigint
  readonly lastSector: bigint
  readonly sizeSectors: bigint
  readonly typecode: string
  readonly guid: string
  readonly name: string
}

/**
 * Read one partition back OUT of the table that was written.
 *
 * The point is stated in os/mkimage-v2.sh: "sgdisk is free to move a requested
 * start sector, so asserting what we asked for proves nothing; this asserts
 * what is actually there."
 *
 * Every field is required. A parser that returned undefined for a line it could
 * not find would hand its caller a comparison against nothing, and `undefined
 * !== 64` is a failure that names the wrong thing -- so an unreadable field is
 * a refusal carrying sgdisk's whole output instead.
 */
export async function readPartition(tb: Toolbox, image: string, partnum: bigint): Promise<GptPartitionInfo> {
  const r = await tb.must(['sgdisk', '-i', String(partnum), image], {
    note: `sgdisk could not read partition ${partnum} of ${image}`,
  })
  const text = r.stdout

  const field = (label: string): string => {
    const m = new RegExp(`^${label}: (.*)$`, 'm').exec(text)
    if (m === null || m[1] === undefined || m[1].trim() === '') {
      throw new ToolError(
        r,
        `sgdisk -i ${partnum} ${image} printed no readable "${label}" line, so there is nothing to `
        + `compare the assembled layout against. Either the partition is not there or this sgdisk `
        + `prints a shape this parser does not know`,
      )
    }
    return m[1].trim()
  }

  const firstWord = (label: string): bigint => {
    const raw = field(label).split(/\s+/)[0] ?? ''
    if (!/^[0-9]+$/.test(raw)) {
      throw new ToolError(r, `sgdisk's "${label}" for partition ${partnum} of ${image} reads "${raw}", not a sector number`)
    }
    return BigInt(raw)
  }

  const firstSector = firstWord('First sector')
  const lastSector = firstWord('Last sector')
  const sizeSectors = firstWord('Partition size')
  if (lastSector - firstSector + 1n !== sizeSectors) {
    throw new ToolError(
      r,
      `sgdisk says partition ${partnum} of ${image} runs ${firstSector}..${lastSector} and is `
      + `${sizeSectors} sectors, and those disagree by ${lastSector - firstSector + 1n - sizeSectors}`,
    )
  }

  return {
    partnum,
    firstSector,
    lastSector,
    sizeSectors,
    // "C12A7328-... (EFI system partition)" -- the code is the first word.
    typecode: field('Partition GUID code').split(/\s+/)[0] ?? '',
    guid: field('Partition unique GUID'),
    // "Partition name: 'esp'"
    name: field('Partition name').replace(/^'(.*)'$/, '$1'),
  }
}
