// The one place os/build reaches into os/verify. os/build imports os/verify's
// typed board model rather than copying it -- one parser for
// `boards/<board>/board.env` -- and os/build's tsconfig typechecks what it
// imports, so both packages are checked on every run of either suite.
//
// A relative `..` specifier is safe here although paths.ts refuses counted `..`
// for directories: `resolve(dir, '..')` always produces a path, so a miscount
// surfaces later as an empty directory, while a wrong module specifier is
// "Cannot find module" at import, before any test runs, on both bun and tsc.
//
// Everything os/build takes from os/verify comes through here, so the coupling
// is one grep (`grep -rn '\.\./\.\./verify' src`) and one file -- asserted by
// src/verify-package.test.ts: exactly one file names the other package, and no
// file here defines a second copy of the parser.

export {
  boardNameForPath,
  isKnownRole,
  KNOWN_ROLES,
  loadBoard,
  loadBoards,
  modelBoard,
} from '../../verify/src/board.ts'

export type { Board, BoardFault, KnownRole, Partition } from '../../verify/src/board.ts'

export { BoardEnvError, parseBoardEnv } from '../../verify/src/board-env.ts'
export type { Assignment, BoardEnvFile, DuplicateAssignment } from '../../verify/src/board-env.ts'

// The anchored-ascent helper, taken rather than copied for the reason above:
// a twelve-line function whose entire purpose is to stop path arithmetic from
// drifting silently is the last function in this tree that should exist twice.
export { ascendTo } from '../../verify/src/paths.ts'
