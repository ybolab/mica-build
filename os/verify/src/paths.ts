// Where this package sits, and the proof that it still does.
//
// Path arithmetic counted in `..` is right until a file moves, and then it is
// wrong SILENTLY: `resolve(dir, '..', '..')` always produces a path, and the
// first thing to notice is a reader failing on a directory that is empty
// rather than absent. PLAN-014 M1 has just moved most of os/ once and M5/M6
// will move more, so every ascent here is anchored on something that must be
// AT the destination, and the failure names the path it computed, the marker
// it wanted and the number of levels it climbed.

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Climb `levels` directories from `from` and require `marker` to be there.
 *
 * @throws Error naming the computed path when the marker is missing -- which
 *   is the only way a miscount here becomes visible at the moment it is made.
 */
export function ascendTo(from: string, levels: number, marker: string, what: string): string {
  const dir = resolve(from, ...Array.from({ length: levels }, () => '..'))
  if (!existsSync(join(dir, marker))) {
    throw new Error(
      `${what} was computed as ${dir} by climbing ${levels} level${levels === 1 ? '' : 's'} from ${from}, `
      + `but ${join(dir, marker)} does not exist. Either this package moved and the count is stale, `
      + `or ${marker} did.`,
    )
  }
  return dir
}

/** `os/verify/src` -- resolved from this module, not from the caller's cwd. */
export const SRC_DIR: string = import.meta.dir

/** `os/verify`, anchored on the package manifest. */
export const PACKAGE_DIR: string = ascendTo(SRC_DIR, 1, 'package.json', 'the os/verify package directory')

/** `os`, anchored on the board tree M1 created. */
export const OS_DIR: string = ascendTo(SRC_DIR, 2, 'boards', 'the os/ directory')

/** The repository root, anchored on the Makefile that routes every target. */
export const REPO_ROOT: string = ascendTo(SRC_DIR, 3, 'Makefile', 'the repository root')

/** `os/boards`. */
export const BOARDS_DIR: string = join(OS_DIR, 'boards')

/** `os/boards/<board>/board.env`. */
export function boardEnvPath(board: string): string {
  return join(BOARDS_DIR, board, 'board.env')
}
