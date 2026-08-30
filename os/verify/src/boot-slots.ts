// The two boot slots, and where the layout says each one's filesystem begins.
//
// One table, imported by `checks-slots.ts`, `checks-board.ts` and the ext4
// family. A second spelling of "the slots are BOOT-A and BOOT-B and their
// offsets come from the layout" beside the first is drift waiting to happen,
// which is the same reason the board predicates live in `board-scope.ts`.
//
// `check_boot_slot BOOT-A ... BOOT-B ...` at the verification contract is
// unconditional on both boards: a grub board's ESP is a THIRD filesystem
// checked separately, not one of these two. So the display name is
// `BOOT-<letter>` on every board, and it is the instance every per-slot check
// fires under.

import type { Board } from './board.ts'
import { ToolOutputError } from './tools.ts'

export interface BootSlot {
  /** What every message says: `BOOT-A`. */
  readonly display: string
  /** The LAYOUT_PARTITIONS name: `BOOT_A`. */
  readonly layout: string
  /** The lowercase trailing letter, which `@SLOT@` expands to. */
  readonly letter: string
  /** The uppercase letter, which the verity-env and cmdline families use. */
  readonly upper: string
}

export const SLOTS: readonly BootSlot[] = [
  { display: 'BOOT-A', layout: 'BOOT_A', letter: 'a', upper: 'A' },
  { display: 'BOOT-B', layout: 'BOOT_B', letter: 'b', upper: 'B' },
]

/** `^BOOT-[AB]`, for a `many` check whose instance is the slot. */
export const PER_SLOT = /^(BOOT-[AB])/
/** The same, for the families whose messages lead with `factory: `. */
export const PER_SLOT_FACTORY = /^(?:factory: )?(BOOT-[AB])\b/

/**
 * Where the layout says this slot's filesystem begins, in bytes.
 *
 * Refused rather than defaulted when the key is absent: an offset of 0 would
 * read the image's own GPT as a FAT boot sector and report the answer as a fact
 * about the slot.
 */
export function slotOffsetBytes(board: Board, layoutName: string): number {
  const raw = board.partition(layoutName)?.get('OFFSET_BYTES')
  if (raw === undefined || !/^\d+$/.test(raw.trim())) {
    throw new ToolOutputError(
      `${board.path} declares no usable ${layoutName}_OFFSET_BYTES (got '${raw ?? ''}'). Defaulted to `
      + `0 this would read the image's own GPT as a FAT filesystem.`,
    )
  }
  return Number(raw.trim())
}
