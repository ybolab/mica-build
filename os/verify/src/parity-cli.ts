// Run both verifiers against one image and diff their conclusions, per check.
//
//   bash os/verify/run.sh --parity                    both shipped boards
//   bash os/verify/run.sh --parity --board x64
//   bash os/verify/run.sh --parity --board x64 --image PATH
//   bash os/verify/run.sh --parity --all              list every unclaimed line
//   bash os/verify/run.sh --parity --probe            also drive every helper
//
// PLAN-014 M4 (RFCT-110). This is orchestration only; the diff is in parity.ts
// and the checks are in checks.ts. It runs the SAME image through the shell
// oracle and the TypeScript register, and hands both to diffParity.
//
// EXIT STATUS, IN THREE VALUES rather than two. 0 is full parity and nothing
// unclaimed; 2 is INCOMPLETE -- the state for the whole of M4b..M4d, where the
// two sides agree on everything they both decided and the oracle still says
// things nothing here claims; 1 is a real divergence, an ambiguous register, an
// orphan or a check that fired on neither side. A caller that only looked at
// "non-zero" would be unable to tell an unfinished migration from a broken one,
// and those are opposite instructions.

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { BOARDS_DIR, boardEnvPath, OS_DIR, REPO_ROOT } from './paths.ts'
import { loadBoard, type Board } from './board.ts'
import { CHECKS, checksFor, createImageContext, runChecks, type CheckCase } from './checks.ts'
import { diffParity, formatReport, parseShellRun, type ParityReport } from './parity.ts'
import { chooseRoute, createToolRuntime, missingHostTools, type ToolRoute, type ToolRuntime } from './tools.ts'
import { probeImage } from './probe.ts'

const SHELL_VERIFIER = join(OS_DIR, 'verify-image-v2.sh')
const SHIPPED_BOARDS = ['cx3576', 'x64'] as const

interface Options {
  boards: string[]
  image: string | undefined
  all: boolean
  probe: boolean
  json: string | undefined
  workRoot: string
  /** Decided once for the whole run, before the first oracle run. */
  route?: ToolRoute
}

function usage(): string {
  return [
    'usage: bash os/verify/run.sh --parity [--board NAME] [--image PATH] [--all] [--probe] [--json PATH]',
    '',
    'Runs os/verify-image-v2.sh and the os/verify check register against the same',
    'image and diffs their conclusions per check, for each board named (both shipped',
    'boards by default).',
    '',
    '  --board NAME   cx3576 or x64; repeatable',
    '  --image PATH   the image to verify. Only meaningful with a single --board;',
    '                 otherwise each board takes _out/<board>/<IMAGE_LATEST_NAME>',
    '  --all          list every unclaimed shell conclusion, not the first twelve',
    '  --probe        drive every image helper against the image and print what it read',
    '  --json PATH    write the machine-readable diff there',
    '',
    'exit: 0 full parity  2 INCOMPLETE (checks still unported)  1 divergence',
  ].join('\n')
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    boards: [],
    image: undefined,
    all: false,
    probe: false,
    json: undefined,
    workRoot: join(REPO_ROOT, '_out', 'parity'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    const next = (): string => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value. An option silently taking the next FLAG as its value `
          + `is how a run comes to verify something nobody asked for.`)
      }
      i += 1
      return value
    }
    switch (arg) {
      case '--board': options.boards.push(next()); break
      case '--image': options.image = next(); break
      case '--all': options.all = true; break
      case '--probe': options.probe = true; break
      case '--json': options.json = next(); break
      case '--work': options.workRoot = next(); break
      case '--help': case '-h': console.log(usage()); process.exit(0); break
      default:
        throw new Error(`unknown option '${arg}'.\n\n${usage()}`)
    }
  }
  if (options.boards.length === 0) options.boards = [...SHIPPED_BOARDS]
  if (options.image !== undefined && options.boards.length !== 1) {
    throw new Error(
      `--image names one file and this run covers ${options.boards.length} boards. One image cannot `
      + `be both boards' image, and verifying an x64 image against the cx3576 layout reports ~191 `
      + `failures that are all the harness's -- os/verify-image-v2.sh:174 records observing exactly `
      + `that. Name the board too.`,
    )
  }
  return options
}

function defaultImage(board: Board): string {
  const name = board.get('IMAGE_LATEST_NAME')
  if (name === undefined || name === '') {
    throw new Error(
      `${board.path} declares no IMAGE_LATEST_NAME, so this harness cannot work out which file is `
      + `${board.name}'s image. Pass --image.`,
    )
  }
  return join(REPO_ROOT, '_out', board.name, name)
}

/**
 * Run the shell oracle. Its stdout IS the input to the diff, so it is captured whole.
 *
 * `--expect-symlink` reproduces the invocation `make os-verify-<board>-v2`
 * makes. That target passes NO image, and the verifier then defaults to
 * _out/<board>/<IMAGE_LATEST_NAME> and turns the flag on itself
 * (os/verify-image-v2.sh:82), which adds one check: that the default path is
 * the -latest symlink. Naming the same file explicitly turns that check OFF,
 * and the oracle then reports 394 conclusions where the make target reports
 * 395 -- measured, and it is exactly the kind of silent difference in the
 * comparison's INPUT that would later be read as a difference between the two
 * verifiers. So the flag follows the file: on when the image is the board's
 * default path, off when a caller named another one.
 */
async function runShellVerifier(
  board: string,
  image: string,
  expectSymlink: boolean,
): Promise<{ stdout: string, code: number }> {
  if (!existsSync(SHELL_VERIFIER)) {
    throw new Error(
      `${SHELL_VERIFIER} is not there. It is the oracle this harness diffs against; without it `
      + `there is no comparison to make, and a "parity" run that quietly compared the port against `
      + `nothing would be the exact failure this file exists to prevent.`,
    )
  }
  const argv = ['bash', SHELL_VERIFIER, ...(expectSymlink ? ['--expect-symlink'] : []), image]
  const proc = Bun.spawn(argv, {
    cwd: REPO_ROOT,
    env: { ...process.env, MOS_BOARD: board },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  // A non-zero status is NOT an error here: the oracle exits 1 whenever any
  // check failed, and a failing check is a conclusion the diff needs. What
  // would be an error is no RESULT line, and parseShellRun says so by name.
  if (!stdout.includes('RESULT: ')) {
    throw new Error(
      `os/verify-image-v2.sh exited ${code} without a RESULT line.\n`
      + `  stderr: ${stderr.trim() || '(empty)'}\n`
      + `  stdout: ${stdout.trim().split('\n').slice(-6).join('\n          ') || '(empty)'}`,
    )
  }
  return { stdout, code }
}

/**
 * Load a board definition, or say which board was asked for and which exist.
 *
 * loadBoard's own failure is an ENOENT naming a path -- true, and it sends a
 * reader who typed `--board x86` to look for a file rather than to look at the
 * flag they typed.
 */
function boardOrRefuse(name: string): Board {
  const path = boardEnvPath(name)
  if (!existsSync(path)) {
    throw new Error(
      `'${name}' is not a board this tree ships. ${path} does not exist; `
      + `os/boards/ holds ${readdirSync(BOARDS_DIR).sort().join(', ')}.`,
    )
  }
  return loadBoard(path)
}

async function parityForBoard(
  boardName: string,
  image: string,
  options: Options,
  checks: readonly CheckCase[],
): Promise<{ report: ParityReport, failures: string[] }> {
  const board = boardOrRefuse(boardName)
  if (!existsSync(image)) {
    throw new Error(
      `${image} is not there. Build it, or name one with --image; a parity run needs the SAME image `
      + `on both sides and cannot substitute another.`,
    )
  }

  const isDefault = image === defaultImage(board)
  console.log(`os/verify: ${boardName} — running os/verify-image-v2.sh against ${image}`
    + `${isDefault ? ' --expect-symlink (the board default path, as make os-verify-* runs it)' : ''}`)
  const shellOut = await runShellVerifier(boardName, image, isDefault)
  const shell = parseShellRun(shellOut.stdout)

  // Made HERE and not by the runtime: the runtime's refusal is about a caller
  // that named a directory which is not there, and a runtime that created one
  // could not tell that mistake from this deliberate arrangement.
  const workDir = join(options.workRoot, boardName)
  mkdirSync(workDir, { recursive: true })
  // The image and the repository are handed to the tools from OUTSIDE, so they
  // are mounted at their own paths -- see tools.ts. The work directory lives
  // under _out/ and not /tmp, because a bind mount of /tmp on this host
  // succeeds and delivers an empty directory.
  const tools: ToolRuntime = await createToolRuntime({
    readOnly: [image, REPO_ROOT],
    workDir,
    route: options.route,
    log: line => console.log(line),
  })

  try {
    const ctx = createImageContext({ board, image, tools, workDir })
    if (options.probe) await probeImage(ctx, line => console.log(line))

    const run = await runChecks(ctx, checks)
    const report = diffParity({
      board: boardName,
      image,
      shell,
      checks: checksFor(boardName, checks),
      results: run.results,
    })
    const failures = run.failures.map(f => `${f.id}: ${f.error.message}`)
    return { report, failures }
  }
  finally {
    await tools.dispose()
  }
}

async function main(): Promise<number> {
  const options = parseArgs(Bun.argv.slice(2))

  // WHERE THE TOOLS COME FROM IS DECIDED ONCE, HERE, before the first oracle
  // run. Left to the first createToolRuntime it would be decided per board and
  // AFTER a ~30 s shell verifier run -- so `MOS_VERIFY_TOOLS=hsot` would cost
  // half a minute before saying it was a typo, and a two-board run could in
  // principle take one route for cx3576 and another for x64.
  options.route = chooseRoute(process.env['MOS_VERIFY_TOOLS'], await missingHostTools())

  const reports: ParityReport[] = []
  let worst = 0

  for (const boardName of options.boards) {
    const board = boardOrRefuse(boardName)
    const image = options.image === undefined
      ? defaultImage(board)
      : (isAbsolute(options.image) ? options.image : resolve(process.cwd(), options.image))

    const { report, failures } = await parityForBoard(boardName, image, options, CHECKS)
    reports.push(report)
    console.log('')
    console.log(formatReport(report, { maxNotPorted: options.all ? Number.MAX_SAFE_INTEGER : 12 }))
    if (failures.length > 0) {
      console.log('')
      console.log(`   ${failures.length} check(s) THREW rather than concluding:`)
      for (const f of failures) console.log(`      ${f}`)
      worst = 1
    }
    console.log('')
    worst = Math.max(worst, report.conclusion === 'PASS' ? 0 : report.conclusion === 'INCOMPLETE' ? 2 : 1)
  }

  if (options.json !== undefined) {
    // Reported as the ABSOLUTE path, always. run.sh absolutises this argument
    // before bun ever sees it -- it is the only place the caller's cwd still
    // exists, because run_bun cds into the package -- but a reader who invoked
    // this file directly is owed the same. Echoing back the relative string is
    // what made a diff written to the wrong directory invisible: the message
    // named a path, the caller could not `cat` it, and nothing said why.
    const at = resolve(process.cwd(), options.json)
    await Bun.write(at, `${JSON.stringify(reports, null, 2)}\n`)
    console.log(`os/verify: diff written to ${at}`)
  }

  // The summary a reader scrolls to. It leads with what is UNCLAIMED, because
  // "0 divergences" about a comparison that compared nothing is the most
  // misleading true sentence this harness could print.
  console.log('══ parity summary ══')
  for (const r of reports) {
    console.log(`   ${r.board.padEnd(8)} ${r.conclusion.padEnd(11)}`
      + ` compared ${r.counts.agree}, diverging ${r.counts.diverge},`
      + ` UNCLAIMED ${r.counts['not-ported']} of ${r.shellSummary.total + r.shellSummary.skipped}`
      + ` shell conclusions`)
  }
  // 1 beats 2: a divergence is a different instruction from an unfinished port.
  return worst === 1 ? 1 : worst
}

try {
  process.exit(await main())
}
catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
