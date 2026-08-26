// Verify one assembled image against the image contract. THE image verifier.
//
//   bash os/verify/run.sh --verify --board cx3576
//   bash os/verify/run.sh --verify --board x64 --image PATH
//   bash os/verify/run.sh --verify --board x64 --probe
//
// This is what `make os-verify-cx3576-v2` runs: the only entry point that
// verifies an assembled image against the contract.
//
// Orchestration only. The checks are in checks.ts and the sixteen modules it
// composes; the tools are in tools.ts; nothing here decides anything about an
// image. It reads the register, runs it, and prints.
//
// The output format is a contract, not a presentation choice. One
// `PASS:`/`FAIL:`/`SKIP:` line per conclusion and a final `RESULT:` line:
// test/apid-api's own harness describes its output as "the shape os/verify
// prints", and docs/task/RFCT-039 and RFCT-054 quote `RESULT: PASS (n/n)`
// lines as evidence. Changing how a verdict READS makes every one of those
// records unreadable.
//
// A SKIP is not a PASS, and it must not be able to look like one: an
// assertion that describes a bootloader only one board has is not a failure and
// not a success, and the only wrong thing to do with it is to run it silently
// or not at all. Both wrong outcomes produce the same green as a real pass.
//
// Zero conclusions is a failure. `RESULT: PASS (0/0 checks)` is what the shell
// lint this package replaced printed when its counters died in a subshell, and
// it is invariant under a run in which nothing executed. So an empty run is
// turned red here, by count, the same way run.sh does it for `bun test`.

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { CHECKS, createImageContext, runChecks } from './checks.ts'
import { BOARDS_DIR, boardEnvPath, REPO_ROOT } from './paths.ts'
import { probeImage } from './probe.ts'
import { chooseRoute, createToolRuntime, missingHostTools, type ToolRuntime } from './tools.ts'

interface Options {
  board: string
  image: string | undefined
  probe: boolean
  workRoot: string
}

function usage(): string {
  return [
    'usage: bash os/verify/run.sh --verify [--board NAME] [--image PATH] [--work PATH] [--probe]',
    '',
    'Runs the os/verify check register against one assembled image and reports one',
    'PASS/FAIL/SKIP line per conclusion, then a RESULT line.',
    '',
    '  --board NAME   which board this image is. Defaults to $MOS_BOARD.',
    '  --image PATH   the image to verify. Defaults to',
    '                 _out/<board>/<IMAGE_LATEST_NAME> -- the path make os-image-* writes',
    '  --work PATH    where extracted partitions are cached (default _out/verify/<board>)',
    '  --probe        also drive every image helper and print what it read',
    '',
    'exit: 0 every check passed  1 a check failed, threw, or nothing ran',
  ].join('\n')
}

/**
 * The board, or a message naming what this tree actually ships.
 *
 * No default board. `MOS_BOARD` is honoured because the oracle's callers set it
 * and because `make os-verify-<board>-v2` is per board, but a bare run refuses
 * rather than falling back to cx3576. That fallback is the exact defect this
 * campaign has been removing: os/verify-image-v2.sh:28 defaulted BOARD_DIR to
 * `board/cx3576` in an otherwise board-derived script, and the container
 * re-exec's missing `-e MOS_BOARD` once checked an x64 image against cx3576's
 * eleven-partition GPT and reported 191 failures that were all the harness's.
 */
function boardOrRefuse(name: string): Board {
  const shipped = readdirSync(BOARDS_DIR).sort().join(', ')
  if (name === '') {
    throw new Error(
      `--verify needs to know which board this image is; pass --board, or set MOS_BOARD. `
      + `os/boards/ holds ${shipped}. Guessing one would verify an image against another `
      + `board's layout and report failures that are all the harness's.`,
    )
  }
  const path = boardEnvPath(name)
  if (!existsSync(path)) {
    throw new Error(
      `'${name}' is not a board this tree ships. ${path} does not exist; `
      + `os/boards/ holds ${shipped}.`,
    )
  }
  return loadBoard(path)
}

/**
 * `_out/<board>/<IMAGE_LATEST_NAME>` -- read off the board, never written here.
 *
 * The same derivation the parity harness used, and the same one `make
 * os-image-<board>-v2` writes to, so the default path of a verify run and the
 * output path of an assembly run cannot drift apart without the board file
 * saying so.
 */
function defaultImage(board: Board): string {
  const name = board.get('IMAGE_LATEST_NAME')
  if (name === undefined || name === '') {
    throw new Error(
      `${board.path} declares no IMAGE_LATEST_NAME, so this verifier cannot work out which file `
      + `is ${board.name}'s image. Pass --image.`,
    )
  }
  return join(REPO_ROOT, '_out', board.name, name)
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    board: process.env['MOS_BOARD'] ?? '',
    image: undefined,
    probe: false,
    workRoot: join(REPO_ROOT, '_out', 'verify'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    // A value read from the next element, refusing to swallow the next FLAG.
    // `--board --probe` would otherwise verify a board called "--probe" and the
    // message would be about a missing board file rather than a missing value.
    const next = (): string => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value; it was given ${value === undefined ? 'nothing' : `'${value}'`}.`)
      }
      i += 1
      return value
    }
    switch (arg) {
      case '--help':
      case '-h':
        console.log(usage())
        process.exit(0)
        break
      case '--board': options.board = next(); break
      case '--image': options.image = next(); break
      case '--work': options.workRoot = next(); break
      case '--probe': options.probe = true; break
      default:
        throw new Error(`unknown option '${arg}'.\n\n${usage()}`)
    }
  }
  return options
}

async function main(): Promise<number> {
  const options = parseArgs(Bun.argv.slice(2))
  const board = boardOrRefuse(options.board)
  const image = options.image === undefined
    ? defaultImage(board)
    : (isAbsolute(options.image) ? options.image : resolve(process.cwd(), options.image))

  if (!existsSync(image)) {
    throw new Error(
      `${image} is not there. Build it with 'make os-image-${board.name}-v2', or name one with `
      + `--image. A verifier that carried on would report on nothing.`,
    )
  }

  // Decided ONCE, up front, before any work: a typo in MOS_VERIFY_TOOLS should
  // cost nothing, and a run must not be able to take one route for one part of
  // an image and another route for the rest.
  const route = chooseRoute(process.env['MOS_VERIFY_TOOLS'], await missingHostTools())

  const workDir = join(options.workRoot, board.name)
  mkdirSync(workDir, { recursive: true })
  // Identity mounts, and _out/ rather than /tmp -- see tools.ts. The image and
  // the repository are handed to the tools from OUTSIDE, and a bind mount of
  // /tmp on this host succeeds and delivers an empty directory.
  const tools: ToolRuntime = await createToolRuntime({
    readOnly: [image, REPO_ROOT],
    workDir,
    route,
    log: line => console.log(line),
  })

  try {
    const ctx = createImageContext({ board, image, tools, workDir })
    if (options.probe) await probeImage(ctx, line => console.log(line))

    console.log(`os/verify: ${board.name} — ${image}`)
    const run = await runChecks(ctx, CHECKS)

    let passed = 0
    let failed = 0
    let skipped = 0
    for (const r of run.results) {
      if (r.verdict === 'pass') { passed += 1; console.log(`PASS: ${r.message}`) }
      else if (r.verdict === 'fail') { failed += 1; console.log(`FAIL: ${r.message}`) }
      else { skipped += 1; console.log(`SKIP: ${r.message}`) }
    }

    // A check that THREW is not a failed check and is never folded into one.
    // It concluded nothing about the image, and reporting it as a FAIL would
    // put a harness fault into the image's record. It is fatal all the same.
    for (const f of run.failures) {
      console.error(`error: check '${f.id}' threw rather than concluding: ${f.error.message}`)
    }

    const total = passed + failed
    const skips = skipped > 0
      ? `, ${skipped} skipped (${board.name}/${board.bootloader}; each named above)`
      : ''

    if (total === 0) {
      console.log(`RESULT: FAIL (0/0 checks${skips})`)
      console.error(
        `error: the register concluded nothing about ${image}. 'RESULT: PASS (0/0 checks)' is `
        + `invariant under a run in which nothing executed, so it is refused rather than printed.`,
      )
      return 1
    }

    console.log(`RESULT: ${failed === 0 && run.failures.length === 0 ? 'PASS' : 'FAIL'} (${passed}/${total} checks${skips})`)
    return failed === 0 && run.failures.length === 0 ? 0 : 1
  }
  finally {
    await tools.dispose()
  }
}

try {
  process.exit(await main())
}
catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
