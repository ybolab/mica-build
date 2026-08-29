// The derived layout of a cx3576 image: how big the rootfs slot is, and where
// everything after it starts.
//
// Not in geometry.ts: everything geometry.ts answers is a fact the board file
// states and nothing here is. os/boards/cx3576/board.env declares
// ROOTFS_A_START_MIB and stops -- rootfs-b, meta, state, ephemeral and data sit
// behind a slot sized by the rootfs actually built, which it "cannot compute"
// -- so the chain is computed here, and the identities it documents are checked.
//
// Pure, and that is the point: nothing here touches a disk, a container or a
// tool. The arithmetic that decides where DATA starts is what a byte-identity
// gate really compares, and a bug reachable only by assembling a 1.3 GiB image
// is found by diffing 1.3 GiB. Every function below is reachable from a test at
// sizes no rootfs has: one MiB under a pin, one over, on the alignment boundary.

import type { Geometry, PlacedPartition } from './geometry.ts'
import type { GptSpec } from './tools/sgdisk.ts'

// The two slot modes are selected by presence, never by value, and that is a
// requirement. os/mkimage-v2.sh (deleted) captures MOS_ROOTFS_SLOT_MIB with
// `${MOS_ROOTFS_SLOT_MIB+set}` before sourcing the layout, "so a release that
// legitimately pins the same number as the built-in default still gets the
// strict mode". Comparing the value against the board file's
// MOS_ROOTFS_SLOT_MIB would agree with the shell on every number and disagree
// about which mode a release build is in -- and the mode decides whether an
// oversized rootfs is a failure or a silently bigger image that no flashed
// device can take an update for.
export type SlotMode = 'pinned' | 'floor'

export interface SlotDecision {
  readonly mode: SlotMode
  readonly slotMib: bigint
  /** The payload that decided it, in MiB. */
  readonly payloadMib: bigint
  /** The line os/mkimage-v2.sh (deleted) prints, so the two assemblers say the same thing. */
  readonly summary: string
}

/**
 * Was a slot size supplied from the environment at all?
 *
 * `MOS_ROOTFS_SLOT_MIB=` -- set and empty -- is SUPPLIED. It selects the strict
 * mode and then fails its own validation, which is the shell's behaviour and the
 * right one: an empty pin is a release build whose pin got lost, not a dev build.
 */
export function slotPinFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.MOS_ROOTFS_SLOT_MIB
}

/** The pinned mode's own validation of the pin, before the board file is consulted. */
export function parseSlotPin(raw: string): bigint {
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(
      `MOS_ROOTFS_SLOT_MIB='${raw}' is not a positive whole number of MiB. Supplying it at all `
      + `selects the FROZEN-GEOMETRY mode -- the slot size every already-flashed device was `
      + `partitioned with -- so an unreadable pin is refused rather than falling back to the `
      + `built-in default, which would silently produce a dev-mode image on the release path.`,
    )
  }
  return BigInt(raw)
}

/**
 * How big the rootfs slot is, and which mode said so.
 *
 * pinned  the geometry is frozen at the pin and an oversized rootfs is a build
 *         failure. Growing the slot would move rootfs-b, meta, state and
 *         ephemeral, producing a GPT no already-flashed device can accept and
 *         RAUC bundles that no longer fit the deployed slot.
 * floor   the built-in MOS_ROOTFS_SLOT_MIB acts as a floor and the slot grows
 *         with the content: max(floor, alignUp(ceil(payload * pct / 100), align)).
 */
export function decideSlot(
  geometry: Geometry,
  payloadMib: bigint,
  pin: string | undefined,
  imagePath: string,
): SlotDecision {
  const floorMib = geometry.slot.slotMib
  const bootMib = geometry.requireInt('BOOT_SIZE_MIB')
  const metaMib = geometry.requireInt('META_SIZE_MIB')
  const stateMib = geometry.requireInt('STATE_SIZE_MIB')
  const varMib = geometry.requireInt('MOS_VAR_MIB')
  const dataMib = geometry.requireInt('DATA_SIZE_MIB')

  const tail = (slotMib: bigint): string => {
    const total = totalSizeMib(geometry, slotMib)
    return `boot ${bootMib}+${bootMib} MiB; meta ${metaMib} + state ${stateMib} + var ${varMib} + `
      + `data ${dataMib} MiB; image ${total} MiB`
  }

  if (pin !== undefined) {
    const slotMib = parseSlotPin(pin)
    if (payloadMib > slotMib) {
      throw new Error(
        `rootfs slot geometry is pinned at MOS_ROOTFS_SLOT_MIB=${slotMib} MiB but ${imagePath} is `
        + `${payloadMib} MiB -- ${payloadMib - slotMib} MiB too large.\n`
        + `The slot size is frozen for every device already flashed with this layout, so it cannot be `
        + `grown: shrink the rootfs instead.`,
      )
    }
    return {
      mode: 'pinned',
      slotMib,
      payloadMib,
      summary: `rootfs payload ${payloadMib} MiB -> rootfs slot ${slotMib} MiB (pinned, frozen `
        + `geometry); ${tail(slotMib)}`,
    }
  }

  const pct = geometry.slot.headroomPct
  const align = geometry.slot.alignMib
  if (pct <= 0n) throw new Error(`ROOTFS_SLOT_HEADROOM_PCT=${pct} in ${geometry.path} is not a positive percentage`)
  if (align <= 0n) throw new Error(`ROOTFS_SLOT_ALIGN_MIB=${align} in ${geometry.path} is not a positive alignment`)

  // `(payload * pct + 99) / 100` in the shell -- integer division, so the +99 IS
  // the ceiling. Written the same way rather than as a divide-and-round, because
  // the two differ for a payload whose headroom lands exactly on a whole MiB and
  // this must agree with the shell on every input, not on the ones tried.
  const withHeadroom = (payloadMib * pct + 99n) / 100n
  const aligned = ((withHeadroom + align - 1n) / align) * align
  const slotMib = aligned < floorMib ? floorMib : aligned
  return {
    mode: 'floor',
    slotMib,
    payloadMib,
    summary: `rootfs payload ${payloadMib} MiB -> rootfs slot ${slotMib} MiB (floor ${floorMib}, `
      + `${pct}% headroom, ${align} MiB aligned); ${tail(slotMib)}`,
  }
}

export interface DerivedLayout {
  readonly slotMib: bigint
  readonly rootfsBStartMib: bigint
  readonly metaStartMib: bigint
  readonly stateStartMib: bigint
  readonly ephemeralStartMib: bigint
  readonly dataStartMib: bigint
  readonly totalSizeMib: bigint
}

/** The image's total length, which is the end of the chain plus the backup GPT's slack. */
export function totalSizeMib(geometry: Geometry, slotMib: bigint): bigint {
  return deriveLayout(geometry, slotMib).totalSizeMib
}

/**
 * The chain from ROOTFS_A down to DATA, and the image length that follows.
 *
 * Every start after rootfs-a is `previous start + previous size`, in MiB, which
 * is what makes DATA's start a function of the slot size and therefore frozen
 * for a flashed fleet. The board file states the first link (ROOTFS_A_START_MIB)
 * and none of the rest.
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

/**
 * The three loader identities os/boards/cx3576/board.env documents and cannot compute.
 *
 * "The partition covers sector 64 through the sector before uenv-a, so
 * LOADER_START_SECTOR + LOADER_SIZE_SECTORS == UENV_A_START_SECTOR and
 * LOADER_SIZE_SECTORS * SECTOR_SIZE == UBOOT_MAX_BYTES." If these drift the
 * loader ends up partly outside its own partition, which is precisely the state
 * systemd-repart trims away -- and the device comes up in maskrom on the next
 * power-on, with nothing having failed at build time.
 *
 * Every failure is collected rather than thrown at the first, because three
 * drifting numbers should produce three lines: a reader who fixes the one they
 * were shown and rebuilds should not discover the second one twenty minutes later.
 */
export function loaderIdentityFaults(geometry: Geometry): string[] {
  const faults: string[] = []
  const loader = geometry.requirePartition('LOADER')
  const uenvA = geometry.requirePartition('UENV_A')
  const startSector = loader.requireInt('START_SECTOR')
  const sizeSectors = loader.requireInt('SIZE_SECTORS')
  const seekSector = geometry.requireInt('UBOOT_SEEK_SECTOR')
  const maxBytes = geometry.requireInt('UBOOT_MAX_BYTES')
  const uenvAStart = uenvA.requireInt('START_SECTOR')

  if (startSector !== seekSector) {
    faults.push(
      `LOADER_START_SECTOR=${startSector} but the U-Boot blob is written at sector ${seekSector}; `
      + `the loader partition must start where the bootloader does`,
    )
  }
  const loaderBytes = geometry.sectorsToBytes(sizeSectors)
  if (loaderBytes !== maxBytes) {
    faults.push(
      `the loader partition is ${loaderBytes} bytes but UBOOT_MAX_BYTES is ${maxBytes}; a blob that `
      + `passes the fit check must fit the partition`,
    )
  }
  if (startSector + sizeSectors !== uenvAStart) {
    faults.push(
      `the loader partition ends at sector ${startSector + sizeSectors} but ${uenvA.label ?? 'uenv-a'} `
      + `starts at ${uenvAStart}; the two must abut or the GPT overlaps / leaves an untracked gap`,
    )
  }
  return faults
}

/** The size, in sectors, that a partition takes in the GPT this assembler writes. */
function sizeSectorsOf(geometry: Geometry, p: PlacedPartition, slotMib: bigint): bigint {
  if (p.name === 'ROOTFS_A' || p.name === 'ROOTFS_B') return geometry.mibToSectors(slotMib)
  const size = p.size
  if (size === undefined) {
    throw new Error(
      `${geometry.path} declares no size for ${p.name}, and every partition in a cx3576 image is `
      + `either given a size there or sized from the built rootfs (the two slots).`,
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
      + `partition placed by neither would be placed by sgdisk's allocator, which is the one thing `
      + `this layout is pinned to avoid.`,
    )
  }
  return start.sectors
}

/**
 * The whole GPT, as one spec, in LAYOUT_PARTITIONS order.
 *
 * Order is read off the board, not written here. os/mkimage-v2.sh (deleted) spells eleven
 * --new flags in a fixed sequence, a second copy of LAYOUT_PARTITIONS that
 * nothing checks; this walks the list, so a partition added to the board file
 * and forgotten here cannot become one sgdisk never writes.
 *
 * `-a ${GPT_ALIGN_SECTORS}` is the load-bearing flag: cx3576's loader starts at
 * sector 64, which is not 2048-aligned, and sgdisk silently relocates a
 * misaligned start to 2048 and exits 0 (measured). So this passes the board's
 * alignment and the assembler reads the loader back out of the finished table
 * to prove it landed.
 */
export function gptSpecFor(geometry: Geometry, layout: DerivedLayout): GptSpec {
  return {
    diskGuid: geometry.disk.guid,
    // Not `?? something`: an alignment nobody asked for is how the loader moved
    // in the first place. cx3576 declares 1; a board that declares none gets
    // sgdisk's default, which is what os/mkimage-x64.sh relies on.
    alignSectors: geometry.disk.alignSectors === 0n ? undefined : geometry.disk.alignSectors,
    clear: true,
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
