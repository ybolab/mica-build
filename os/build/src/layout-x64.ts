// The DERIVED layout of an x64 image: how big the rootfs slot is, and where
// everything after it starts.
//
// BESIDE src/layout-cx3576.ts, NOT A `case` INSIDE IT. The two boards agree on
// the IDEA -- a rootfs slot sized from the built payload, with everything after
// it chained off that size -- and on almost nothing about the arithmetic that
// implements it or the partition set it places. Three differences, each of which
// changes a number or a behaviour rather than a spelling:
//
//   1. THE HEADROOM IS APPLIED IN BYTES, NOT IN MiB. os/mkimage-x64.sh:117 is
//        slot_mib=$(( (rootfs_bytes * PCT / 100 + MIB_BYTES - 1) / MIB_BYTES ))
//      -- percentage first, on the byte count, THEN the ceiling to MiB. cx3576's
//      is `(payload_mib * pct + 99) / 100`: the ceiling to MiB happens first and
//      the percentage is applied to a whole number of MiB. Those are not the same
//      function. They agree whenever the payload is a whole MiB (which is what
//      os/mkimage-v2.sh REFUSES to proceed without and os/mkimage-x64.sh never
//      checks) and they diverge otherwise -- see the table in layout-x64.test.ts,
//      which drives both spellings over the same payloads and shows where: they
//      agree on all 2048 whole-MiB payloads and disagree on thousands of others.
//
//   2. THERE IS NO PINNED MODE. os/mkimage-v2.sh captures
//      `${MOS_ROOTFS_SLOT_MIB+set}` BEFORE sourcing the board file, precisely so
//      an environment pin selects the frozen-geometry mode. os/mkimage-x64.sh
//      does not: it sources os/boards/x64/board.env at line 74 and reads
//      MOS_ROOTFS_SLOT_MIB at line 119, so the board's 512 has already
//      overwritten anything the environment said. x64 has exactly one mode, the
//      floor, and this file has one too. Adding a pinned mode here would give the
//      x64 release path a behaviour the shell it is gated against has never had,
//      inside the milestone whose whole job is to prove nothing changed.
//
//   3. THE ALIGNMENT IS THE BOARD'S 2048 AND EVERY START IS ALREADY ON IT.
//      cx3576 must pass `-a 1` or sgdisk relocates its sector-64 loader; x64's
//      first partition starts at 1 MiB and there is no loader partition at all.
//      See gptSpecFor below for what is passed and what was measured.
//
// PURE, AND THAT IS THE POINT -- the reasoning is layout-cx3576.ts's and it holds
// here for the same reason. The arithmetic that decides where DATA starts is what
// a byte-identity gate is really comparing, and an arithmetic bug reachable only
// by assembling a 1.9 GiB image is a bug found by diffing 1.9 GiB. Nothing below
// touches a disk, a container or a tool.

import type { Geometry, PlacedPartition } from './geometry.ts'
import type { GptSpec } from './tools/sgdisk.ts'

export interface SlotDecision {
  readonly slotMib: bigint
  /** The payload that decided it, in BYTES -- x64 sizes from the byte count. */
  readonly payloadBytes: bigint
  /** The floor the board declares, for a caller that wants to say which side won. */
  readonly floorMib: bigint
  /** True when the payload, grown and aligned, was smaller than the floor. */
  readonly floorApplied: boolean
  readonly summary: string
}

/**
 * How big the rootfs slot is.
 *
 * `max(floor, alignUp(ceilToMib(payloadBytes * pct / 100), align))`, with every
 * division integer and in the order os/mkimage-x64.sh:117-121 does them. Written
 * step by step rather than as one expression because each step truncates, and a
 * rearrangement that looks equivalent in algebra is not equivalent in integers.
 *
 * @param payloadBytes the size of rootfs-verity.img, in bytes. NOT in MiB: the
 *   shell reads `stat -c%s` and multiplies the byte count by the percentage, so
 *   a port that rounded to MiB first would agree on every whole-MiB payload and
 *   quietly disagree on the rest.
 */
export function decideSlot(geometry: Geometry, payloadBytes: bigint): SlotDecision {
  const floorMib = geometry.slot.slotMib
  const pct = geometry.slot.headroomPct
  const align = geometry.slot.alignMib
  const mibBytes = geometry.mibBytes

  if (payloadBytes <= 0n) {
    // `truncate`/`dd` would place nothing and every partition after ROOTFS_A
    // would still be chained off the floor, so this fails as an empty image that
    // assembles rather than as a build error.
    throw new Error(
      `the rootfs payload is ${payloadBytes} bytes, which is not a rootfs. The slot chain is computed `
      + `from it and every partition after ROOTFS_A is placed by adding to that size, so an empty `
      + `payload produces an image that assembles, verifies and has no root filesystem in it.`,
    )
  }
  if (pct <= 0n) throw new Error(`ROOTFS_SLOT_HEADROOM_PCT=${pct} in ${geometry.path} is not a positive percentage`)
  if (align <= 0n) throw new Error(`ROOTFS_SLOT_ALIGN_MIB=${align} in ${geometry.path} is not a positive alignment`)
  if (floorMib <= 0n) throw new Error(`MOS_ROOTFS_SLOT_MIB=${floorMib} in ${geometry.path} is not a positive slot floor`)

  const withHeadroom = (payloadBytes * pct) / 100n
  const ceiled = (withHeadroom + mibBytes - 1n) / mibBytes
  const aligned = ((ceiled + align - 1n) / align) * align
  const slotMib = aligned < floorMib ? floorMib : aligned

  return {
    slotMib,
    payloadBytes,
    floorMib,
    floorApplied: aligned < floorMib,
    summary: `rootfs payload ${payloadBytes} bytes -> rootfs slot ${slotMib} MiB (floor ${floorMib}, `
      + `${pct}% headroom, ${align} MiB aligned)`,
  }
}

export interface DerivedLayout {
  readonly slotMib: bigint
  readonly rootfsBStartMib: bigint
  readonly metaStartMib: bigint
  readonly stateStartMib: bigint
  readonly ephemeralStartMib: bigint
  readonly dataStartMib: bigint
  /** DISK_MIB in the shell: the end of the chain plus the backup GPT's slack. */
  readonly totalSizeMib: bigint
}

/**
 * The chain from ROOTFS_A down to DATA, and the image length that follows.
 *
 * os/mkimage-x64.sh:123-128, one line at a time. Every start after rootfs-a is
 * `previous start + previous size` in MiB, which is what makes DATA's start a
 * function of the slot size and therefore frozen for a flashed fleet.
 *
 * The board file states the first link (ROOTFS_A_START_MIB=257) and none of the
 * rest -- the same division of labour cx3576 has, and the reason this arithmetic
 * lives with the assembler rather than in the board definition.
 */
export function deriveLayout(geometry: Geometry, slotMib: bigint): DerivedLayout {
  if (slotMib <= 0n) throw new Error(`a rootfs slot of ${slotMib} MiB is not a slot`)
  const rootfsA = geometry.requirePartition('ROOTFS_A')
  const rootfsAStart = rootfsA.start
  if (rootfsAStart === undefined || rootfsAStart.mib === undefined) {
    throw new Error(
      `${geometry.path} does not place ROOTFS_A on a whole MiB, and every partition after it is `
      + `placed by adding MiB to that start.`,
    )
  }
  const metaMib = geometry.requireInt('META_SIZE_MIB')
  const stateMib = geometry.requireInt('STATE_SIZE_MIB')
  const varMib = geometry.requireInt('MOS_VAR_MIB')
  const dataMib = geometry.requireInt('DATA_SIZE_MIB')

  const rootfsBStartMib = rootfsAStart.mib + slotMib
  const metaStartMib = rootfsBStartMib + slotMib
  const stateStartMib = metaStartMib + metaMib
  const ephemeralStartMib = stateStartMib + stateMib
  const dataStartMib = ephemeralStartMib + varMib
  return {
    slotMib,
    rootfsBStartMib,
    metaStartMib,
    stateStartMib,
    ephemeralStartMib,
    dataStartMib,
    totalSizeMib: dataStartMib + dataMib + geometry.disk.tailSlackMib,
  }
}

/** The size, in sectors, that a partition takes in the GPT this assembler writes. */
function sizeSectorsOf(geometry: Geometry, p: PlacedPartition, slotMib: bigint): bigint {
  if (p.name === 'ROOTFS_A' || p.name === 'ROOTFS_B') return geometry.mibToSectors(slotMib)
  const size = p.size
  if (size === undefined) {
    throw new Error(
      `${geometry.path} declares no size for ${p.name}, and every partition in an x64 image is either `
      + `given a size there or sized from the built rootfs (the two slots).`,
    )
  }
  return size.sectors
}

/** The start, in sectors, that a partition takes in the GPT this assembler writes. */
function startSectorsOf(geometry: Geometry, p: PlacedPartition, layout: DerivedLayout): bigint {
  const derived: Record<string, bigint | undefined> = {
    ROOTFS_B: layout.rootfsBStartMib,
    META: layout.metaStartMib,
    STATE: layout.stateStartMib,
    EPHEMERAL: layout.ephemeralStartMib,
    DATA: layout.dataStartMib,
  }
  const mib = derived[p.name]
  if (mib !== undefined) return geometry.mibToSectors(mib)
  const start = p.start
  if (start === undefined) {
    throw new Error(
      `${geometry.path} declares no start for ${p.name} and this assembler derives none for it. A `
      + `partition placed by neither would be placed by sgdisk's allocator, which is the one thing this `
      + `layout is pinned to avoid.`,
    )
  }
  return start.sectors
}

/**
 * The whole GPT, as one spec, in LAYOUT_PARTITIONS order.
 *
 * ORDER IS READ OFF THE BOARD, not written here -- os/mkimage-x64.sh:421-458
 * spells nine --new flags in a fixed sequence, which is a second copy of
 * LAYOUT_PARTITIONS that nothing checks. A partition added to the board file and
 * forgotten in the assembler is a partition sgdisk never writes, and the shell
 * has no way to notice.
 *
 * THE ALIGNMENT. os/mkimage-x64.sh passes NO `-a` and takes sgdisk's default;
 * this passes the board's GPT_ALIGN_SECTORS, which x64 declares as 2048 -- the
 * same number sgdisk defaults to. That is a deliberate difference in SPELLING
 * and it was MEASURED rather than assumed to be a difference in nothing (see
 * mkimage-x64.test.ts, which writes both tables with a real sgdisk over the real
 * x64 geometry and compares the bytes). The reason for spelling it is that a
 * board is the single source of truth for its board: GPT_ALIGN_SECTORS=2048 sits
 * in os/boards/x64/board.env today, and an assembler that ignored it would keep
 * agreeing with the file only for as long as the file kept agreeing with
 * sgdisk's built-in default.
 *
 * There is no loader read-back here and that absence is deliberate rather than
 * an omission: cx3576 needs one because its loader starts at sector 64 and
 * sgdisk silently relocates a non-2048-aligned start. Every x64 start is a whole
 * MiB, which is 2048 sectors, so no start here is relocatable -- and
 * checkPartitionsLanded in src/mkimage-x64.ts reads the assembled table back
 * anyway, because "no start here is relocatable" is a claim about the board file
 * and not about the table sgdisk wrote.
 */
export function gptSpecFor(geometry: Geometry, layout: DerivedLayout): GptSpec {
  return {
    diskGuid: geometry.disk.guid,
    // 0n is geometry.ts's "the board declared none"; see its note. x64 declares
    // 2048, so this is the board's number and not a default invented here.
    alignSectors: geometry.disk.alignSectors === 0n ? undefined : geometry.disk.alignSectors,
    // No --clear. On a freshly truncated (all-zero) file --clear is
    // byte-identical to omitting it, so omitting it is the cheaper of two
    // equal answers.
    partitions: geometry.partitions.map(p => ({
      partnum: p.requireInt('PARTNUM'),
      startSector: startSectorsOf(geometry, p, layout),
      sizeSectors: sizeSectorsOf(geometry, p, layout.slotMib),
      label: p.require('LABEL'),
      typecode: p.require('TYPECODE'),
      guid: p.require('GUID'),
    })),
  }
}

/** Where each standalone filesystem image is placed in the disk, in MiB, in order. */
export function placementMib(geometry: Geometry, layout: DerivedLayout): Record<string, bigint> {
  const startOf = (name: string): bigint => {
    const p = geometry.requirePartition(name)
    const mib = p.start?.mib
    if (mib === undefined) {
      throw new Error(
        `${geometry.path} does not place ${name} on a whole MiB, and dd seeks this image in MiB blocks.`,
      )
    }
    return mib
  }
  return {
    ESP: startOf('ESP'),
    BOOT_A: startOf('BOOT_A'),
    BOOT_B: startOf('BOOT_B'),
    ROOTFS_A: startOf('ROOTFS_A'),
    ROOTFS_B: layout.rootfsBStartMib,
    META: layout.metaStartMib,
    STATE: layout.stateStartMib,
    EPHEMERAL: layout.ephemeralStartMib,
    DATA: layout.dataStartMib,
  }
}
