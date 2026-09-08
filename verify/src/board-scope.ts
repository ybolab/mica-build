// The shipped boards, and the predicates a board-conditional check is scoped by.
//
// They live here rather than in any one check module because several families
// need the same three -- `isUBoot` for the bootloader environment tools,
// `hasRadio` for the Wi-Fi userland and bluez's policy -- and a SECOND
// spelling of "this board has a U-Boot environment" beside the first is drift
// waiting to happen. One definition, imported.
//
// THE LISTS ARE DERIVED, NEVER WRITTEN DOWN.
//
// `boards:` on a CheckCase takes literal names, and every list handed to it in
// this tree is computed here from the shipped definitions themselves. A third
// board dropped into `boards/` is covered by whichever families its own
// definition selects and by none of the others, with no register entry edited.
//
// `requireShippedBoards` refuses an empty answer, which here would mean a
// register that generated no board-conditional check at all and then reported no
// divergence about any of them.

import { loadBoard, type Board } from './board.ts'
import { boardEnvPath, requireShippedBoards } from './paths.ts'

/** Every board under `boards/`, modelled once at module load. */
export const SHIPPED: readonly Board[] = requireShippedBoards().map(name => loadBoard(boardEnvPath(name)))

/** The names of the shipped boards satisfying `predicate`, for a `boards:` list. */
export function boardsWhere(predicate: (board: Board) => boolean): string[] {
  return SHIPPED.filter(predicate).map(b => b.name)
}

/** `is_uboot_board`, asked of a definition. */
export const isUBoot = (board: Board): boolean => board.bootloader === 'uboot'

/** `board_has_radio`. */
export const hasRadio = (board: Board, kind: string): boolean => (board.radios ?? []).includes(kind)

/** `board_has_hwinit`. */
export const hasHwinit = (board: Board, fact: string): boolean => (board.hwinitConfs ?? []).includes(fact)

/** `[ -n "${BOARD_FIRMWARE_FILES}" ]`. Declared-empty is not absent. */
export const hasFirmware = (board: Board): boolean => (board.firmwareFiles ?? []).length > 0

/** `[ "${BOARD_HAS_STATUS_LED}" = "1" ]`. A string compare, as the oracle spells it. */
export const hasLed = (board: Board): boolean => board.hasStatusLed === '1'

/** A GPT loader region, independent of the firmware interface. */
export const hasRawBlob = (board: Board): boolean => board.partitions.some(p => p.role === 'raw-blob')
