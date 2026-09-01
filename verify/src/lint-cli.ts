// `make os-layout-lint` — the board-definition schema lint, over real files.
//
// Thin on purpose. Every decision lives in lint.ts, which is pure and is what
// the suite exercises; this reads argv, prints, and picks an exit status. A
// checker whose logic can only be reached through its own command line can only
// be tested through its own command line; the pure implementation lets the
// current suite exercise all fourteen cases without copying a real board.
//
// It is invoked through verify/run.sh, which is the one place that decides
// how bun is run -- see HARNESS.md. Paths arrive already absolute, because
// run_bun cds into the package before invoking bun and a relative path from the
// caller's shell would resolve against the wrong directory.

import { existsSync } from 'node:fs'
import { formatRun, lintPaths, shippedBoardPaths } from './lint.ts'

const USAGE = `usage: bash verify/run.sh --lint [board.env ...]

Checks every board layout against the board-definition schema. With no
arguments it checks every board this tree ships. Exits 1 on the first FAIL, and
also on a run that made no assertions at all.`

function main(argv: readonly string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  const paths = argv.length > 0 ? [...argv] : shippedBoardPaths()

  // A named file that is not there is an error, not an empty run: the shell
  // predecessor checked this too, and without it `os-layout-lint boards/typo`
  // would report PASS by linting nothing.
  const missing = paths.filter(p => !existsSync(p))
  if (missing.length > 0) {
    for (const p of missing) console.error(`error: ${p} not found`)
    return 1
  }

  const run = lintPaths(paths)
  const { stdout, stderr } = formatRun(run)
  for (const line of stdout) console.log(line)
  for (const line of stderr) console.error(line)
  return run.ok ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
