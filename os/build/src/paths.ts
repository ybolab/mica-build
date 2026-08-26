// Where this package sits, and the proof that it still does.
//
// The reasoning is os/verify/src/paths.ts's, and the helper IS its function --
// imported through verify-package.ts rather than copied. Counted `..`
// arithmetic over DIRECTORIES always produces a path, so a stale count fails
// later, on a directory that is empty rather than absent, so every
// ascent here is anchored on something that must be AT the destination and the
// failure names the path it computed.
//
// This package has two anchors os/verify does not:
//
//   os/verify itself. The board model os/build stands on lives there (see
//   verify-package.ts), so "os/verify is where this package thinks it is" is a
//   precondition of os/build working at all -- and asserting it here means a
//   reader is told which of the two packages moved instead of reading a bare
//   "Cannot find module" from bun.
//
//   os/build-env/from.sh. src/images.ts hands that path to bash, and a wrong
//   one surfaces as "No such file or directory" attached to an image KEY --
//   which reads as though the key were bad.

import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ascendTo } from './verify-package.ts'

/** `os/build/src` -- resolved from this module, not from the caller's cwd. */
export const SRC_DIR: string = import.meta.dir

/** `os/build`, anchored on the package manifest. */
export const PACKAGE_DIR: string = ascendTo(SRC_DIR, 1, 'package.json', 'the os/build package directory')

/** `os`, anchored on the board tree M1 created. */
export const OS_DIR: string = ascendTo(SRC_DIR, 2, 'boards', 'the os/ directory')

/** The repository root, anchored on the Makefile that routes every target. */
export const REPO_ROOT: string = ascendTo(SRC_DIR, 3, 'Makefile', 'the repository root')

/** `os/verify`, anchored on ITS manifest -- the package this one imports its model from. */
export const VERIFY_PACKAGE_DIR: string = join(
  ascendTo(SRC_DIR, 2, 'verify/package.json', 'the os/verify package that os/build takes its board model from'),
  'verify',
)

/** `os/boards`. */
export const BOARDS_DIR: string = join(OS_DIR, 'boards')

/** `os/build-env`, where every image reference and toolchain version in this tree lives. */
export const BUILD_ENV_DIR: string = join(
  ascendTo(SRC_DIR, 2, 'build-env/from.sh', 'os/build-env/from.sh, the one resolver of an images.env key'),
  'build-env',
)

/** `os/build-env/from.sh` -- the tree's only resolver of an images.env key. */
export const FROM_SH: string = join(BUILD_ENV_DIR, 'from.sh')

/** `os/boards/<board>/board.env`. */
export function boardEnvPath(board: string): string {
  return join(BOARDS_DIR, board, 'board.env')
}

/**
 * The boards this tree ships, in name order, READ OFF THE TREE.
 *
 * Discovered rather than written down. os/verify/src/lint.ts keeps the same
 * list as a literal (`SHIPPED_BOARDS = ['cx3576', 'x64']`), and the difference
 * matters for what this package does with it: every geometry assertion here
 * iterates this list, so a board added to os/boards/ and not to a literal would
 * be a board that nothing in this package ever read -- and the suite would stay
 * green by having looked at less. A directory listing cannot fall behind the
 * directory.
 *
 * A `boards/<name>/` with no `board.env` in it is not a board and is skipped:
 * the definition file IS the board, which is also why boardNameForPath in
 * os/verify takes the name from the DIRECTORY.
 *
 * The caller must still refuse an empty answer -- see requireShippedBoards.
 * The directory is a parameter so that refusal is REACHABLE from a test: a
 * guard that can only fire when os/boards/ is empty is a guard nobody has run.
 */
export function shippedBoards(dir: string = BOARDS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(dir, e.name, 'board.env')))
    .map(e => e.name)
    .sort()
}

/**
 * shippedBoards(), refusing an answer that would make its caller vacuous.
 *
 * A discovery that finds nothing hands every `for (const b of boards)` an empty
 * loop, and a suite of empty loops is green. That is the exact failure this
 * tree keeps finding in its own checkers -- the shell lint's "RESULT: PASS
 * (0/0 checks)", run.sh's `Ran 0 tests`, the bash-oracle comparison that
 * "agreed on all 0 keys" -- so a discovery used as a test's input refuses to
 * return nothing, by name, rather than letting the caller decide to notice.
 */
export function requireShippedBoards(dir: string = BOARDS_DIR): string[] {
  const boards = shippedBoards(dir)
  if (boards.length === 0) {
    throw new Error(
      `no board defines a board.env under ${dir}, so every check that iterates the shipped boards `
      + `would run over an empty list and pass by asserting nothing. Either this path is stale or `
      + `that directory holds no board.`,
    )
  }
  return boards
}

/**
 * Scratch space for anything that has to exist as a FILE on disk.
 *
 * Under the package rather than under /tmp, and that is not a preference. On
 * this host a docker bind mount of anything under /tmp SUCCEEDS AND DELIVERS AN
 * EMPTY DIRECTORY -- measured 2026-08-25, and os/verify/run.sh carries a guard
 * whose whole job is to name that failure when it happens. Every tool this
 * package drives may be running in a container, so a scratch file under /tmp
 * would be a file the tool cannot see, reported as a file that does not exist.
 * Inside the repository it is covered by the identity mount that is already
 * there. `.work/` is gitignored.
 */
export const WORK_DIR: string = join(PACKAGE_DIR, '.work')

/** A fresh scratch directory under WORK_DIR. The caller removes it. */
export function makeWorkDir(prefix: string): string {
  mkdirSync(WORK_DIR, { recursive: true })
  return mkdtempSync(join(WORK_DIR, `${prefix}-`))
}
