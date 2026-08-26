// `bash os/verify/run.sh --smoke-negative [--board NAME]` -- the entry point for
// the three negative tests.
//
// Same argv discipline as `src/smoke-cli.ts`, and for the same
// reason it gives: an unknown option that is accepted and ignored turns a
// request for one thing into a green about another. There is no `--opt=value`
// form here either.
//
// SEPARATE FROM `--smoke` RATHER THAN A FLAG ON IT. The smoke run is what the
// build path executes on every rootfs build; this BREAKS the root three times
// over and is a check on the checker. Folding them together would put three
// image builds and three deliberate defects into every build of every image,
// and would make "the smoke run passed" mean two different things depending on
// a flag.

import { shippedBoards } from './paths.ts'
import { CASES, negativeRun } from './smoke-negative.ts'

const USAGE = `usage: bun run src/smoke-negative-cli.ts [--board NAME]

RFCT-113's three negative tests. Each one really makes its defect -- a
wrong-arch binary, a missing soname, a version-skewed binary -- in a real image
built from that board's real factory root, and requires the smoke run to go red
naming the right cause.

  --board NAME   which board's _out/<board>/factory-root.oci to break.
                 Defaults to MOS_BOARD, then to x64.
  --help         this.

Needs docker. It refuses rather than skipping when the image is absent and when
this host cannot execute it, exactly as the smoke runner does.
`

function parse(argv: readonly string[]): { board?: string; help: boolean } {
  let board: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--board') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`--board needs a board name after it; got ${value === undefined ? 'nothing' : `'${value}'`}.`)
      }
      board = value
      i += 1
      continue
    }
    throw new Error(
      `unknown option '${arg}'. Accepting and ignoring it would turn this into a green run about `
      + `something other than what was asked for.`,
    )
  }
  return { board, help: false }
}

async function main(): Promise<number> {
  let opts: { board?: string; help: boolean }
  try {
    opts = parse(process.argv.slice(2))
  } catch (e) {
    console.error(`error: ${(e as Error).message}`)
    console.error(USAGE)
    return 2
  }
  if (opts.help) {
    console.log(USAGE)
    return 0
  }

  const board = opts.board ?? process.env['MOS_BOARD'] ?? 'x64'
  const known = shippedBoards()
  if (!known.includes(board)) {
    console.error(`error: '${board}' is not a board in os/boards/. This tree ships: ${known.join(', ')}.`)
    return 2
  }

  let run
  try {
    run = await negativeRun({ board })
  } catch (e) {
    console.error(`error: ${(e as Error).message}`)
    return 1
  }

  console.log('')
  console.log(
    `os/verify negative: ${run.outcomes.length} cases (${CASES.length} declared), board ${board}`,
  )
  console.log(run.line)
  return run.exitCode
}

process.exit(await main())
