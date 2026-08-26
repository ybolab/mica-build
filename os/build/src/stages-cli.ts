// Build the os/rootfs stage chain, one Dockerfile at a time.
//
//   bash os/build/run.sh --build-rootfs --board x64 --dest _out/x64 \
//        --platform linux/amd64 --arg KEY=VALUE ...
//   bash os/build/run.sh --build-rootfs --board x64 --plan   (decide, run nothing)
//
// PLAN-014 M5 (RFCT-111). os/rootfs/build-v2.sh still stages the build context
// -- it cross-builds mosd, renders the overlay, checks the repart definitions
// against the layout and computes every verity parameter -- and then calls this
// instead of running one `docker buildx build` over one Dockerfile.
//
// WHAT THIS ADDS OVER THAT ONE COMMAND, and it is only two things: it decides
// the order and the tags (src/stages.ts, a pure function with its own tests),
// and it refuses the two ways a chain fails that a single file cannot. The
// build arguments, the platform, the context and the output directory all
// arrive from the caller unchanged, because a driver that recomputed them would
// be a second answer to a question build-v2.sh already answers.

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildArgv,
  DEFAULT_TAG_REPO,
  DEFAULT_TERMINAL_TARGET,
  discoverStages,
  planChain,
  selectStages,
  stageManifest,
  StageChainError,
  STAGES_DIR,
  type StageBuild,
  type StageFile,
} from './stages.ts'
import { REPO_ROOT } from './paths.ts'

/** Written beside the artifacts: which stages ran, in which order, at what content. */
export const MANIFEST_NAME = 'rootfs-stages.txt'

interface Options {
  board: string
  dest: string | undefined
  platform: string
  context: string
  builder: string | undefined
  stagesDir: string
  terminalTarget: string
  planOnly: boolean
  noCache: boolean
  without: string[]
  args: Record<string, string>
}

function usage(): string {
  return [
    'usage: bash os/build/run.sh --build-rootfs --board NAME [--dest DIR] [--plan]',
    '                            [--platform linux/ARCH] [--context DIR]',
    '                            [--builder NAME] [--arg KEY=VALUE]...',
    '',
    'Builds os/rootfs/stages/*.Dockerfile in numeric order, each FROM the local',
    'image tag the previous one was written to. The last stage exports its',
    `\`${DEFAULT_TERMINAL_TARGET}\` target into --dest.`,
    '',
    '  --board NAME     names the tags, so two boards can be in flight at once',
    '  --dest DIR       where the terminal stage exports. Required unless --plan',
    '  --platform P     linux/amd64, linux/arm64. Default: the host architecture',
    '  --context DIR    the docker build context. Default: the repository root',
    '  --builder NAME   buildx builder. Default: whichever is current',
    '  --arg KEY=VALUE  a build argument, repeatable. Each is passed only to the',
    '                   stages that DECLARE it; one no stage declares is refused',
    '  --without NAME   leave out the <number>-feature-NAME stage, repeatable.',
    '                   This is RFCT-111\'s stage selection, and it replaced the',
    '                   WITH_* build args: a declined feature is a stage that is',
    '                   not built, not an argument every RUN inside it has to',
    '                   test. A NAME that matches no feature stage is refused --',
    '                   silently building the full image is the failure',
    '  --plan           print the chain and the exact command lines, run nothing',
    '  --no-cache       build every stage from scratch. For the determinism gate:',
    '                   a chain replayed out of cache is not a cold build',
  ].join('\n')
}

function hostPlatform(): string {
  return process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64'
}

export function parseArgs(argv: readonly string[]): Options {
  const o: Options = {
    board: '',
    dest: undefined,
    platform: hostPlatform(),
    context: REPO_ROOT,
    builder: undefined,
    stagesDir: STAGES_DIR,
    terminalTarget: DEFAULT_TERMINAL_TARGET,
    planOnly: false,
    noCache: false,
    without: [],
    args: {},
  }
  // An option whose value is the NEXT FLAG is the mistake that silently
  // verifies something nobody asked for -- `--board --plan` would take
  // '--plan' as a board name and then not plan. Refused for every option that
  // takes a value, the way parity-cli refuses it for --board.
  const value = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('--')) {
      throw new Error(
        `${flag} needs a value and the next argument is ${next === undefined ? 'nothing' : `'${next}'`}. Taken as the value it would name something nobody asked for`,
      )
    }
    return next
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') {
      console.log(usage())
      process.exit(0)
    }
    switch (a) {
      case '--board':
        o.board = value(a, argv[++i])
        break
      case '--dest':
        o.dest = value(a, argv[++i])
        break
      case '--platform':
        o.platform = value(a, argv[++i])
        break
      case '--context':
        o.context = value(a, argv[++i])
        break
      case '--builder':
        o.builder = value(a, argv[++i])
        break
      case '--stages-dir':
        o.stagesDir = value(a, argv[++i])
        break
      case '--target':
        o.terminalTarget = value(a, argv[++i])
        break
      case '--plan':
        o.planOnly = true
        break
      case '--no-cache':
        o.noCache = true
        break
      case '--without':
        o.without.push(value(a, argv[++i]))
        break
      case '--arg': {
        const kv = value(a, argv[++i])
        const eq = kv.indexOf('=')
        if (eq <= 0) {
          throw new Error(
            `--arg ${kv} is not KEY=VALUE. An argument with no '=' would be passed to docker as a name whose value comes from the environment, which is not what any caller here means`,
          )
        }
        o.args[kv.slice(0, eq)] = kv.slice(eq + 1)
        break
      }
      default:
        throw new Error(`unknown option ${a}\n\n${usage()}`)
    }
  }
  if (!o.board) throw new Error(`--board is required.\n\n${usage()}`)
  if (!o.planOnly && !o.dest) {
    throw new Error(
      `--dest is required: the terminal stage has to export somewhere. Use --plan to decide the chain without building it.\n\n${usage()}`,
    )
  }
  return o
}

/**
 * The docker CLI to run, by this package's convention.
 *
 * src/toolbox.ts reads the same variable for the same reason: on the pinned-bun
 * route the host's client is bind-mounted at its own path and named in
 * MOS_BUILD_DOCKER, and a bare `docker` there is a different question ("is
 * /usr/bin on this image's PATH?") from the one the caller asked.
 */
export function dockerBin(): string {
  return process.env.MOS_BUILD_DOCKER || 'docker'
}

/**
 * The buildx driver behind a builder name, or undefined if it cannot be read.
 *
 * `docker buildx inspect` prints `Driver: docker` / `Driver: docker-container`
 * as its second field. Parsed rather than assumed because the answer decides
 * whether this chain can be built at all.
 */
export function parseDriver(inspectOutput: string): string | undefined {
  for (const line of inspectOutput.split('\n')) {
    const m = /^Driver:\s*(\S+)/.exec(line.trim())
    if (m) return m[1]
  }
  return undefined
}

/**
 * Whether a driver can resolve `FROM <local tag>`, and what to say when it
 * cannot.
 *
 * MEASURED, NOT READ. On this host, a docker-container builder handed a tag
 * that is in the local image store answered
 *
 *   ERROR: failed to solve: mos-probe:a: failed to resolve source metadata for
 *   docker.io/library/mos-probe:a: pull access denied, repository does not
 *   exist or may require authorization
 *
 * -- a message about Docker Hub, for an image that is right there, arriving
 * after however long the stage before it took. The same two files built on the
 * default `docker` driver chained fine. So this is decided up front and refused
 * by name, because that error is not a diagnosis anyone makes quickly.
 *
 * It bites on ONE case: os/rootfs/build-v2.sh falls back to a docker-container
 * builder precisely when the current builder cannot reach the target platform,
 * which is an amd64 host building cx3576's arm64 with no host binfmt_misc.
 */
export function driverCanChain(driver: string | undefined): boolean {
  return driver === 'docker'
}

function refuseUnreadable(builder: string | undefined, detail: string): string {
  return [
    `error: cannot read which driver the buildx builder ${builder ? `'${builder}'` : '(current)'} uses.`,
    `       ${detail}`,
    '       The chain needs a `docker` driver builder -- every stage after the first starts FROM',
    '       the local image tag the previous one was written to -- so this is decided before the',
    '       first stage rather than discovered mid-build.',
    '       If this is the pinned-bun container route: that image is given the docker CLI and the',
    '       daemon socket, but `docker buildx` is a CLI PLUGIN and the plugin directory is not',
    '       mounted, so buildx is absent there. Run --build-rootfs on a host with bun.',
  ].join('\n')
}

function refuseDriver(builder: string | undefined, driver: string): string {
  return [
    `error: the buildx builder ${builder ? `'${builder}'` : '(current)'} uses the '${driver}' driver, which cannot resolve a local image tag in FROM.`,
    '       Every stage after the first starts FROM the tag the previous one was written to,',
    '       and that tag is in the docker image store, not in a registry. This driver looks in',
    '       the registry and reports "pull access denied ... repository does not exist" for an',
    '       image that is present -- measured, not inferred.',
    '       Use the default `docker` driver. A cross-architecture build needs host binfmt_misc',
    '       for that (docker run --privileged --rm tonistiigi/binfmt --install <arch>), or a',
    '       local registry to hold the stage tags. os/rootfs/stages/README.md records this.',
  ].join('\n')
}

async function run(argv: string[], label: string): Promise<void> {
  const proc = Bun.spawn(argv, { stdout: 'inherit', stderr: 'inherit', stdin: 'ignore' })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`${label} exited ${code}`)
  }
}

/**
 * What `docker buildx inspect` answered, in three cases rather than two.
 *
 * "The driver is not `docker`" and "`docker buildx` could not be run at all"
 * are different problems with different fixes, and collapsing them cost a
 * measurement: on the pinned-bun route this reported the driver as `unknown`,
 * which reads as a builder misconfiguration and is not one.
 */
type DriverProbe =
  | { readonly kind: 'driver'; readonly name: string }
  | { readonly kind: 'unreadable'; readonly detail: string }

async function inspectDriver(builder: string | undefined): Promise<DriverProbe> {
  const argv = [dockerBin(), 'buildx', 'inspect']
  if (builder) argv.push(builder)
  let out: string
  let err: string
  let code: number
  try {
    const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    ;[out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
  } catch (e) {
    return { kind: 'unreadable', detail: `${argv[0]} could not be started: ${String(e)}` }
  }
  const name = parseDriver(out)
  if (name) return { kind: 'driver', name }
  return {
    kind: 'unreadable',
    detail: `\`${argv.join(' ')}\` exited ${code} and printed no 'Driver:' line${err.trim() ? `: ${err.trim().split('\n')[0]}` : ''}`,
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let opts: Options
  try {
    opts = parseArgs(argv)
  } catch (e) {
    console.error(`error: ${(e as Error).message}`)
    return 1
  }

  const all = discoverStages(opts.stagesDir)
  let stages: StageFile[]
  let builds: StageBuild[]
  try {
    stages = selectStages(all, opts.without)
    builds = planChain(stages, {
      board: opts.board,
      supplied: opts.args,
      terminalTarget: opts.terminalTarget,
    })
  } catch (e) {
    if (e instanceof StageChainError) {
      console.error('error: os/rootfs/stages is not a chain that can be built:')
      for (const f of e.faults) console.error(`  ${f.path}\n    ${f.message}`)
      return 1
    }
    throw e
  }

  if (opts.without.length > 0) {
    // Said out loud, every run, because a stage that is not built leaves no
    // trace in the image to distinguish it from a stage that did nothing.
    console.log(
      `os/rootfs: leaving out ${opts.without.map((w) => `${w} (feature)`).join(', ')} -- `
      + `${all.length - stages.length} of ${all.length} stage(s) declined`,
    )
  }
  const lines = builds.map(
    (b, i) =>
      `  ${String(i + 1).padStart(2)}. ${b.name.padEnd(16)} ${b.terminal ? `-> ${opts.dest ?? '(no --dest)'}` : `-> ${b.tag}`}`,
  )
  console.log(`os/rootfs: ${builds.length} stages for ${opts.board} (${opts.platform})`)
  console.log(lines.join('\n'))

  if (opts.planOnly) {
    for (const b of builds) {
      console.log(
        `\n# ${b.name}\ndocker ${buildArgv(b, {
          context: opts.context,
          platform: opts.platform,
          builder: opts.builder,
          dest: opts.dest ?? '<dest>',
          terminalTarget: opts.terminalTarget,
          noCache: opts.noCache,
        }).join(' ')}`,
      )
    }
    return 0
  }

  const probe = await inspectDriver(opts.builder)
  if (probe.kind === 'unreadable') {
    console.error(refuseUnreadable(opts.builder, probe.detail))
    return 1
  }
  if (!driverCanChain(probe.name)) {
    console.error(refuseDriver(opts.builder, probe.name))
    return 1
  }

  if (!existsSync(opts.context)) {
    console.error(
      `error: the build context ${opts.context} does not exist. Every stage is built against it and docker would report the miss once per stage`,
    )
    return 1
  }

  for (const b of builds) {
    console.log(`\n=== os/rootfs stage ${b.name} ===`)
    await run(
      [
        'docker',
        ...buildArgv(b, {
          context: opts.context,
          platform: opts.platform,
          builder: opts.builder,
          dest: opts.dest,
          terminalTarget: opts.terminalTarget,
          noCache: opts.noCache,
        }),
      ],
      `stage ${b.name}`,
    )
  }

  // The record, written only after every stage succeeded: a manifest listing
  // stages that did not all build would be a list of intentions.
  const manifest = join(opts.dest!, MANIFEST_NAME)
  writeFileSync(manifest, stageManifest(builds, stages, opts.without))
  console.log(`\nos/rootfs: ${builds.length} stages built; chain recorded in ${manifest}`)
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
