// Batch 1b: the boot slots' filesystems.
//
// `check_boot_slot` (os/verify-image-v2.sh:1776) runs twice per board, once
// for BOOT-A and once for BOOT-B, and everything it concludes is `many` here
// with the slot NAME as the instance -- not a count. R4 measured one defect as
// 465, 467, 562 and 925 differing bytes from nothing but the clock, so a
// family that fired twice and matched twice would say nothing about WHICH
// slot.
//
// WHERE THE SLOTS COME FROM.
//
// From the LAYOUT's `<SLOT>_OFFSET_BYTES`, which is what the oracle uses
// (:1769-1770). Not from the GPT's first sector, though both agree on a healthy
// image: WHERE a slot is, is asserted by `gpt-partition-start`, and reading the
// offset back out of the same table would make these checks agree with a
// partition that had moved. The offset here is the layout's claim, and what is
// under test is the filesystem at it.
//
// THE THREE FACTORY ASSERTIONS.
//
// The FAT32 signature, the volume SERIAL and the volume LABEL. The last two are
// factory-only and the oracle says why at :1796 and :1804: a RAUC-installed
// slot legitimately reads volume id 1234ABCD and label "BOOT", because a
// bundle's boot.vfat is built with `mkfs.vfat --invariant`. Nothing resolves a
// slot by either -- the PARTLABEL and partition GUID are the real identity and
// survive an install -- so these say "factory:" and mean it.

import type { Board } from './board.ts'
import { PER_SLOT_FACTORY, SLOTS, slotOffsetBytes } from './boot-slots.ts'
import type { CheckCase } from './checks.ts'
import { fatVolumeLabel, fatVolumeSerial, readBytes, type FatSlot } from './image.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { eqCi, verdict } from './verdict.ts'

/** Every slot conclusion begins with the slot name, or with `factory: ` and it. */
const PER_SLOT = PER_SLOT_FACTORY

/** `mkfs.vfat` writes this at byte 82 of a FAT32 boot sector, and nowhere else. */
const FAT32_SIGNATURE_OFFSET = 82

/**
 * Where the layout says this slot's filesystem begins, in bytes and in MiB.
 *
 * Refused rather than defaulted when the key is absent: an offset of 0 would
 * read the image's own GPT as a FAT boot sector and report the answer as a fact
 * about the slot.
 */
function slotOffset(board: Board, image: string, layoutName: string): { slot: FatSlot, mib: number } {
  const mibBytes = board.mibBytes
  if (mibBytes === undefined || mibBytes <= 0) {
    throw new ToolOutputError(`${board.path} declares no usable MIB_BYTES.`)
  }
  const offsetBytes = slotOffsetBytes(board, layoutName)
  return { slot: { image, offsetBytes }, mib: Math.floor(offsetBytes / mibBytes) }
}

export const SLOT_CHECKS: readonly CheckCase[] = [
  {
    // Read as BYTES out of the image rather than through mtools: this is the
    // check that says there is a FAT32 here at all, and asking mtools would
    // make it depend on the thing it is establishing.
    id: 'boot-slot-fat32-signature',
    cardinality: 'many',
    instance: PER_SLOT,
    shell: {
      pass: ' has a FAT32 boot sector signature at',
      fail: ' FAT32 signature not found at offset',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const out: CheckResult[] = []
      for (const slot of SLOTS) {
        const { slot: fat, mib } = slotOffset(ctx.board, ctx.image, slot.layout)
        const sig = Buffer.from(
          readBytes(ctx.image, fat.offsetBytes + FAT32_SIGNATURE_OFFSET, 5),
        ).toString('latin1')
        const ok = sig === 'FAT32'
        out.push(verdict(
          'boot-slot-fat32-signature',
          ok,
          ok
            ? `${slot.display} has a FAT32 boot sector signature at ${mib} MiB`
            : `${slot.display} FAT32 signature not found at offset ${mib} MiB + ${FAT32_SIGNATURE_OFFSET}`,
          { instance: slot.display },
        ))
      }
      return out
    },
  },

  {
    id: 'boot-slot-fat-volume-id',
    cardinality: 'many',
    instance: PER_SLOT,
    // eq_ci's shared leading clause, with the slot name inside it -- so the
    // matcher is the part after the name and the instance regex takes the name.
    shell: { pass: ' FAT volume id is' },
    run: async (ctx) => {
      const out: CheckResult[] = []
      for (const slot of SLOTS) {
        const p = ctx.board.partition(slot.layout)
        const want = p?.fatVolumeId
        if (want === undefined || want.trim() === '') {
          throw new ToolOutputError(
            `${ctx.board.path} declares no ${slot.layout}_FAT_VOLUME_ID. A fail here would be a `
            + `statement about the image, and a missing key is one about the board definition.`,
          )
        }
        const got = await fatVolumeSerial(ctx.tools, slotOffset(ctx.board, ctx.image, slot.layout).slot)
        out.push(eqCi(
          'boot-slot-fat-volume-id',
          `factory: ${slot.display} FAT volume id`,
          got,
          want,
          { instance: slot.display },
        ))
      }
      return out
    },
  },

  {
    id: 'boot-slot-fat-label',
    cardinality: 'many',
    instance: PER_SLOT,
    shell: { pass: ' FAT volume label is' },
    run: async (ctx) => {
      const out: CheckResult[] = []
      for (const slot of SLOTS) {
        const p = ctx.board.partition(slot.layout)
        const want = p?.fatLabel
        if (want === undefined || want.trim() === '') {
          throw new ToolOutputError(
            `${ctx.board.path} declares no ${slot.layout}_FAT_LABEL.`,
          )
        }
        // Case SENSITIVE, unlike the volume id: the oracle compares with `=`
        // here and with eq_ci there, because a label is a string somebody chose
        // and a serial is hexadecimal.
        const got = await fatVolumeLabel(ctx.tools, slotOffset(ctx.board, ctx.image, slot.layout).slot)
        const ok = got === want
        out.push(verdict(
          'boot-slot-fat-label',
          ok,
          ok
            ? `factory: ${slot.display} FAT volume label is '${want}' (an updated slot legitimately reads 'BOOT')`
            : `factory: ${slot.display} FAT volume label is '${got}', expected '${want}' on a factory image`,
          { instance: slot.display },
        ))
      }
      return out
    },
  },

  // NOT PORTED: the required-file listing (os/verify-image-v2.sh:1841).
  //
  // `pass "${slot} contains ${f}"`, once per entry of BOOT_SLOT_REQUIRED_FILES
  // -- four per slot on cx3576, three on x64. Its identity is blocked by the
  // same shape as `exactly ${EXPECT_PARTS} partitions` in checks-gpt.ts, and
  // measured the same way: the only board-independent substring is ` contains `,
  // and on cx3576 that claims two more conclusions per slot --
  //
  //   BOOT-A contains no extlinux/ directory and no extlinux.conf (...)
  //   BOOT-A contains no initramfs file
  //
  // -- which are U-Boot-only and therefore M4d's. Registering ` contains ` here
  // would make those four lines `ambiguous` on cx3576 and take the run to exit
  // 1; a matcher tight enough to exclude them has to be ANCHORED (`^BOOT-[AB]
  // contains \S+$` separates them cleanly), and `ShellMatcher` takes a
  // substring.
  //
  // So these six conclusions on cx3576 and six on x64 stay unclaimed, which is
  // the state the harness exists to describe. M4d cannot register the extlinux
  // and no-initramfs checks with ` contains ` either, for the mirror-image
  // reason -- whichever of the two batches lands first, the second collides
  // with it. Both want the same instrument change, and it is M4e's.
]
