// THE ONE PLACE os/build REACHES INTO os/verify.
//
// M3 built the typed board model in os/verify/src: board-env.ts
// parses `boards/<board>/board.env` as DATA -- never sourcing it, never reading
// process.env, refusing by name everything a shell would have executed -- and
// board.ts turns that into partitions, roles, bootloader and the board lists,
// keeping DECLARED-EMPTY apart from ABSENT. It was proven key-for-key against
// bash on both shipped boards (cx3576 141/141, x64 115/115).
//
// os/build needs exactly that model. There were three ways to get it and this
// file is the choice:
//
//   1. COPY IT. Refused, and not as a matter of taste. Two parsers that must
//      agree about the same bytes are the duplication PLAN-014 has spent its
//      length removing (os/health's byte-identical pair, mkimage-common.sh's
//      header on why an ARGUMENT must not be copied). The failure mode is not
//      that a copy is wrong on the day it is made: it is that it reads as
//      self-evidently correct years after one of its reasons changed.
//
//   2. A THIRD, SHARED PACKAGE. That means MOVING M3's sources out of the
//      package whose README, HARNESS and 108 tests describe them where they
//      are, three days after that gate closed and while M4 is still
//      to port the verifier on top of them. The cost is real and the benefit is
//      a directory name.
//
//   3. IMPORT THE SOURCE ACROSS THE TWO PACKAGES -- this file. One copy of the
//      parser, no move, no lockfile coupling, no workspace: bun and tsc both
//      resolve a relative specifier into a sibling package's src/ directly, and
//      os/build's tsconfig typechecks what it imports, so the two are checked
//      together on every run of either suite.
//
// WHY A RELATIVE `..` SPECIFIER IS SAFE HERE WHEN paths.ts SAYS COUNTING IS NOT.
// paths.ts refuses counted `..` for DIRECTORIES because `resolve(dir, '..')`
// always produces a path: a miscount surfaces later as a reader finding an
// empty directory rather than an absent one. A MODULE SPECIFIER has the
// opposite failure mode -- a wrong count is "Cannot find module", at import,
// before any test runs, on both bun and tsc. It is the loud kind. paths.ts
// still anchors os/verify itself, so a reader who gets that message is told
// which of the two moved.
//
// EVERYTHING os/build TAKES FROM os/verify COMES THROUGH HERE. Not for tidiness
// -- so that the coupling is one grep (`grep -rn '\.\./\.\./verify' src`) and
// one file to update if M4 or a later milestone moves those sources.
// src/verify-package.test.ts asserts that: exactly one file in this package
// names the other package, and no file in this package DEFINES a second copy of
// the parser.

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
