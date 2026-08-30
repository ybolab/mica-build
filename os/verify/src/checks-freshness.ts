// Is this image the one the tree in front of you would build?
//
// Nothing else in the register asks that. Every other check reads the image and
// compares it against the board definition or against itself, and all of them
// pass just as happily on an image built six hours and four commits ago -- so a
// green run is a statement about SOME image, in the present tense, and the run
// says nothing about which.
//
// That is not hypothetical. The verifier was once one command away
// from checking a six-hour-old image built from the distribution's podman and
// reading PASS as a description of the self-built one -- "the verifier could
// have checked the wrong image". The guard added then
// lived in the shell verifier's PROLOGUE -- it printed `error:` on stderr and
// exited 1 before the first check ran -- which is why the per-check parity gate
// that governed the port to this package never carried it: the harness paired
// conclusions, and a preflight publishes none. It was lost without a diverging
// row, and that was the finding.
//
// Rebuilt here as a CHECK, so it is a named result in the register's own output
// and its absence would now show up as one.
//
// BOARD-DERIVED, which is the other half of the finding. The original
// implementation had a defect: its two inputs were written down as the literals
// `_out/cx3576/rootfs-verity.img` and `os/pkgs/podman/out-arm64/podman`, so an x64
// run's freshness was decided by arm64 artefacts -- it passed on a stale x64
// image and refused a fresh one whenever the arm64 tree happened to be newer.
// The milestone asked for the guard to be generalised. Both inputs below are
// derived from the board under test: the root from `ctx.outDir`, which is
// `_out/<board>`, and the engine from that board's own `MOS_ARCH`. A
// board-agnostic comparison is the defect, not the fix.
//
// mtime, not a hash, as the original had it: the inputs are a squashfs and a
// directory of binaries, and what is being caught is "you forgot to re-run the
// build", which mtime answers exactly.

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { OS_DIR, REPO_ROOT } from './paths.ts'
import { ToolOutputError } from './tools.ts'
import { skipped, verdict } from './verdict.ts'

const ID = 'image-fresher-than-build-inputs'

/**
 * `os/pkgs` -- where the engine build leaves the binary this check dates.
 *
 * The environment variable has exactly one reader, `checks-freshness.test.ts`,
 * and it exists because the reported cross-board case can only be
 * PLANTED: proving that an x64 run ignores `out-arm64/podman` needs an
 * `out-arm64/podman` whose mtime the test chose, and writing one into the real
 * `os/pkgs/` would mutate the checkout the suite is run from. The same seam
 * `checks-bootchain.ts` takes for `${BOARD_DIR}`, for the same reason.
 */
function pkgsDir(): string {
  const fromEnv = process.env['MOS_VERIFY_PKGS_DIR']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return join(OS_DIR, 'pkgs')
}

/** One build input, and the sentence naming it in a conclusion. */
export interface FreshnessInput {
  /** What it is, in the message. */
  readonly what: string
  readonly path: string
}

/** Repository-relative where that is shorter, absolute where the path is elsewhere. */
function rel(path: string): string {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path
}

/**
 * The inputs whose mtime dates THIS board's image.
 *
 * Both derived, neither written down. A third board dropped into `os/boards/`
 * gets its own `_out/<board>` and its own `out-<MOS_ARCH>` with nothing here
 * edited -- and, more to the point, cannot be dated by another board's tree.
 */
export function freshnessInputs(board: Board, outDir: string): readonly FreshnessInput[] {
  const arch = (board.arch ?? '').trim()
  if (arch === '') {
    // A statement about the board definition, not about the image, so it throws
    // rather than failing: `${board.path}` declares no MOS_ARCH and there is no
    // architecture to resolve the engine's output directory against.
    throw new ToolOutputError(
      `${board.path} declares no MOS_ARCH, so this check cannot work out which os/pkgs/podman/out-* `
      + `directory holds ${board.name}'s container engine. A fail here would be a statement about `
      + `the image, and a missing key is one about the board definition.`,
    )
  }
  return [
    { what: 'the packed read-only root', path: join(outDir, 'rootfs-verity.img') },
    { what: 'the container engine', path: join(pkgsDir(), 'podman', `out-${arch}`, 'podman') },
  ]
}

/** What one input turned out to be, relative to the image. */
type State = 'absent' | 'newer' | 'not newer'

function stateOf(input: FreshnessInput, imageMtimeNs: bigint): State {
  if (!existsSync(input.path)) return 'absent'
  return statSync(input.path, { bigint: true }).mtimeNs > imageMtimeNs ? 'newer' : 'not newer'
}

/**
 * The conclusion, from an image and the inputs that date it.
 *
 * Every input is named in every direction, including the absent ones. A message
 * that listed only what it compared would read identically whether it compared
 * two inputs or one, and "the engine was never built here" is the difference
 * between a green that means something and a green that means nothing.
 */
export function decideFreshness(image: string, inputs: readonly FreshnessInput[]): CheckResult {
  const imageMtimeNs = statSync(image, { bigint: true }).mtimeNs
  const states = inputs.map(i => ({ ...i, state: stateOf(i, imageMtimeNs) }))
  const detail = states.map(s => `${rel(s.path)} [${s.state}]`).join(', ')
  const newer = states.filter(s => s.state === 'newer')
  const present = states.filter(s => s.state !== 'absent')

  if (present.length === 0) {
    // NOT a pass. Zero comparisons made is the shape a green takes when it
    // asserted nothing, and this package exists to make that visible.
    return skipped(
      ID,
      `no build input is present here, so nothing dates ${rel(image)}: ${detail}`,
    )
  }
  if (newer.length > 0) {
    return verdict(
      ID,
      false,
      `${rel(image)} is OLDER than ${newer.map(n => `${n.what} (${rel(n.path)})`).join(' and ')}. `
      + `Verifying it reports on an image the current tree did not produce; re-build it, or set `
      + `MOS_VERIFY_ALLOW_STALE=1 when checking a downloaded release image whose source is not this `
      + `tree. Inputs: ${detail}`,
    )
  }
  return verdict(ID, true, `${rel(image)} is newer than every build input present here: ${detail}`)
}

export const FRESHNESS_CHECKS: readonly CheckCase[] = [
  {
    id: ID,
    shell: {
      pass: 'is newer than every build input present here',
      fail: 'Verifying it reports on an image the current tree did not produce',
      skip: ['no build input is present here, so nothing dates', 'MOS_VERIFY_ALLOW_STALE=1:'],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      // The one escape the original offered, carried across rather than dropped:
      // a downloaded release image has no source in this tree, so there is
      // nothing here that could date it. A SKIP and not a silent pass -- the
      // verifier counts skips separately and names each one, so a run made this
      // way cannot be read as one that checked.
      if (process.env['MOS_VERIFY_ALLOW_STALE'] === '1') {
        return [skipped(
          ID,
          `MOS_VERIFY_ALLOW_STALE=1: ${rel(ctx.image)} is not dated against the ${ctx.board.name} tree`,
        )]
      }
      return [decideFreshness(ctx.image, freshnessInputs(ctx.board, ctx.outDir))]
    },
  },
]
