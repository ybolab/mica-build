// The rootfs stage chain, as data.
//
// os/rootfs/stages/ holds one Dockerfile per stage. They are built in numeric
// order, each FROM the local image tag the previous one was written to. This
// module turns that directory into a PLAN -- which file, which tag, which build
// arguments, which one exports the artifact -- and refuses a directory that
// cannot be a chain. It runs nothing: src/stages-cli.ts is the only file that
// invokes docker, so everything decided here is decided by a pure function and
// tested without a daemon.
//
// THE STAGE LIST IS THE DIRECTORY. There is no list of stages anywhere else,
// deliberately: a stage added to the tree but not to a list would be a stage
// that silently never runs, and nothing would look at it. os/build-env's
// frontend check and os/tests/shell-pipefail-lint.sh derive their file sets the
// same way and say so for the same reason. Adding a stage is adding a file.
//
// WHY IT IS IN os/build AND NOT os/rootfs. RFCT-112 (M6) puts build
// orchestration here, and this is orchestration. It landed in os/verify first,
// because when RFCT-111 M5b needed it os/build did not exist in that branch yet
// and a driver nobody can typecheck or test is not a deliverable; the move was
// an import rewrite, exactly as its header there predicted, because both
// packages' paths.ts export OS_DIR by the same name.
//
// It duplicates nothing of M6a's. The board model stays the single copy in
// os/verify/src/board.ts, and nothing here needs Bun.$ or the toolbox: the only
// external program this chain runs is docker, and only src/stages-cli.ts runs
// it.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { OS_DIR } from './paths.ts'

export const STAGES_DIR: string = join(OS_DIR, 'rootfs', 'stages')

/** The argument every stage but the first declares, and the driver supplies. */
export const PREV_ARG = 'MOS_STAGE_PREV'

/** What a stage file is, once read. */
export interface StageFile {
  /** The numeric prefix: 10, 20, 90. Orders the chain. */
  readonly order: number
  /** The whole stem: `10-base`, `90-pack`. Names the tag and the report line. */
  readonly name: string
  readonly path: string
  /** Every ARG the file declares, except PREV_ARG, in first-seen order. */
  readonly declaredArgs: readonly string[]
  /** Does it declare `ARG MOS_STAGE_PREV`? */
  readonly declaresPrev: boolean
  /** Does it open a stage `FROM ${MOS_STAGE_PREV}`? */
  readonly fromsPrev: boolean
  /** The named build targets it defines: `FROM x AS certs` -> `certs`. */
  readonly targets: readonly string[]
  /** sha256 of the file, so the manifest records WHICH stage was built. */
  readonly sha256: string
}

export interface StageFault {
  readonly path: string
  readonly message: string
}

export class StageChainError extends Error {
  readonly faults: readonly StageFault[]
  constructor(faults: readonly StageFault[]) {
    super(faults.map((f) => `${f.path}: ${f.message}`).join('\n'))
    this.name = 'StageChainError'
    this.faults = faults
  }
}

// `10-base.Dockerfile` -> order 10, name `10-base`. The number is what orders
// the chain, so a file whose name does not carry one is not a stage and is
// refused rather than sorted alphabetically among the ones that do.
const STAGE_NAME = /^(\d+)-([A-Za-z0-9][A-Za-z0-9-]*)\.Dockerfile$/

// `ARG NAME`, `ARG NAME=value`, leading space tolerated. Docker's own parser is
// case-insensitive on the instruction; a lowercase `arg` would be a real
// declaration and invisible to a case-sensitive pattern.
const ARG_LINE = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)/i
// `FROM ${MOS_STAGE_PREV}` / `FROM ${MOS_STAGE_PREV} AS closed`. The brace form
// only: `FROM $MOS_STAGE_PREV` also expands, but one spelling in one place is
// the difference between a check and a guess about which spellings exist.
const FROM_PREV = new RegExp(`^\\s*FROM\\s+(?:--\\S+\\s+)*\\$\\{${PREV_ARG}\\}(?:\\s|$)`, 'i')
// `FROM x AS y`, with the flags where docker actually puts them -- BEFORE the
// image, not after. The first version of this pattern allowed them only after,
// so `FROM --platform=$BUILDPLATFORM ${IMAGE} AS pack` matched nothing and the
// pack target went unseen. It was caught by attributing the 34 scripts to their
// stages with the same expression and getting `closed` for every pack-*.sh.
const FROM_AS = /^\s*FROM\s+(?:--\S+\s+)*\S+(?:\s+AS\s+([A-Za-z0-9._-]+))?\s*$/i

/**
 * Read one stage file. Parsing only -- what makes a chain valid is auditChain.
 */
export function readStageFile(path: string, text: string): StageFile {
  const file = basename(path)
  const m = STAGE_NAME.exec(file)
  if (!m) {
    throw new StageChainError([
      {
        path,
        message: `is not named <number>-<name>.Dockerfile, so nothing puts it in order. The chain is built in numeric order and a file with no number would be sorted among the ones that have them by accident`,
      },
    ])
  }
  const declaredArgs: string[] = []
  const targets: string[] = []
  let declaresPrev = false
  let fromsPrev = false
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue
    const arg = ARG_LINE.exec(line)
    if (arg) {
      const name = arg[1]!
      if (name === PREV_ARG) declaresPrev = true
      else if (!declaredArgs.includes(name)) declaredArgs.push(name)
      continue
    }
    if (FROM_PREV.test(line)) fromsPrev = true
    const as = FROM_AS.exec(line)
    if (as?.[1]) targets.push(as[1])
  }
  return {
    order: Number(m[1]),
    name: `${m[1]}-${m[2]}`,
    path,
    declaredArgs,
    declaresPrev,
    fromsPrev,
    targets,
    sha256: new Bun.CryptoHasher('sha256').update(text).digest('hex'),
  }
}

/** Read every stage file in a directory, in chain order. */
export function discoverStages(dir: string = STAGES_DIR): StageFile[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (cause) {
    throw new StageChainError([
      { path: dir, message: `cannot be read, so the chain has no stages: ${String(cause)}` },
    ])
  }
  const stages = entries
    .filter((e) => e.endsWith('.Dockerfile'))
    .filter((e) => statSync(join(dir, e)).isFile())
    .map((e) => readStageFile(join(dir, e), readFileSync(join(dir, e), 'utf8')))
  stages.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return stages
}

// `31-feature-containers` -> `containers`. A stage whose name matches this is
// one a build may DECLINE; every other stage is the floor, the read-only-root
// wiring, the board or the pack, and declining any of those is not a smaller
// image, it is a broken one.
const FEATURE_NAME = /^\d+-feature-([A-Za-z0-9][A-Za-z0-9-]*)$/

/** The feature a stage names, or undefined if it is not a feature stage. */
export function featureOf(stage: StageFile): string | undefined {
  return FEATURE_NAME.exec(stage.name)?.[1]
}

/**
 * The chain with named features left out -- RFCT-111's "stage selection".
 *
 * This is what replaced `--build-arg WITH_CONTAINERS=0`. The difference is not
 * spelling. A WITH_* argument reached the build, and every RUN and script that
 * cared had to test it: five copies for the container engine, four for mosd,
 * each an independent chance to disagree with the others and build an image
 * with the engine installed and its assertions skipped. Here the decision is
 * made once, before docker is started, and a declined feature is a file that is
 * not built -- so there is nothing left inside the stage that can be wrong
 * about which way the switch went.
 *
 * IT REFUSES A NAME IT CANNOT FIND, and that is the point of the function
 * rather than a nicety. `--without contaners` that silently matched nothing
 * would build the FULL image and report success, which is the exact shape of
 * green PLAN-014 keeps finding: a switch observed only in the position that
 * changes nothing. It also refuses to drop a non-feature stage, because
 * `--without base` is a request for an image with no operator account and no
 * trust anchors, and the caller who typed it did not mean that.
 */
export function selectStages(
  stages: readonly StageFile[],
  without: readonly string[],
): StageFile[] {
  const faults: StageFault[] = []
  const features = new Map<string, StageFile>()
  for (const s of stages) {
    const f = featureOf(s)
    if (f) features.set(f, s)
  }
  const known = [...features.keys()].sort()
  const drop = new Set<string>()
  for (const name of without) {
    const hit = features.get(name)
    if (hit) {
      drop.add(hit.name)
      continue
    }
    const other = stages.find((s) => s.name === name || s.name.endsWith(`-${name}`))
    faults.push({
      path: STAGES_DIR,
      message: other
        ? `was asked to leave out '${name}', which is ${basename(other.path)} -- not a feature stage. Only <number>-feature-<name> stages may be declined; the rest are the floor, the read-only-root wiring, the board and the pack, and a chain missing one of those does not build a smaller image, it builds a broken one`
        : `was asked to leave out the feature '${name}' and no stage here is named <number>-feature-${name}. The features are: ${known.length > 0 ? known.join(', ') : '(none)'}. A name that matched nothing would build the FULL image and exit 0, so it is refused instead`,
    })
  }
  if (faults.length > 0) throw new StageChainError(faults)
  return stages.filter((s) => !drop.has(s.name))
}

/**
 * Everything that makes an ordered list of files a buildable chain.
 *
 * Each of these has a failure it exists for, and none of them is a style rule:
 * a duplicate number makes the build order depend on readdir, a missing
 * MOS_STAGE_PREV makes a stage build against whatever FROM was typed instead of
 * against its predecessor, and a first stage that declares one would be a stage
 * expecting a predecessor it can never have.
 */
export function auditChain(stages: readonly StageFile[], terminalTarget: string): StageFault[] {
  const faults: StageFault[] = []
  if (stages.length === 0) {
    return [
      {
        path: STAGES_DIR,
        message:
          'holds no *.Dockerfile at all. An empty chain builds nothing and exits 0, which is the shape of green this tree keeps finding; it is a failure here',
      },
    ]
  }
  if (stages.length === 1) {
    faults.push({
      path: stages[0]!.path,
      message:
        'is the only stage in the directory. A chain of one is a single-file build wearing the chain\'s clothes -- if that is genuinely what this is now, delete the driver rather than leaving it looking like it sequences something',
    })
  }
  const byOrder = new Map<number, StageFile[]>()
  for (const s of stages) {
    const seen = byOrder.get(s.order)
    if (seen) seen.push(s)
    else byOrder.set(s.order, [s])
  }
  for (const [order, group] of byOrder) {
    if (group.length > 1) {
      faults.push({
        path: group.map((g) => basename(g.path)).join(', '),
        message: `share the number ${order}, so which of them runs first is whatever order the directory happened to be read in. Give them distinct numbers`,
      })
    }
  }
  stages.forEach((s, i) => {
    const first = i === 0
    if (first && s.declaresPrev) {
      faults.push({
        path: s.path,
        message: `is the first stage and declares ARG ${PREV_ARG}. There is no previous stage to name, so the build would resolve it to the empty string and fail at FROM with a message about an invalid image reference`,
      })
    }
    if (!first && !s.declaresPrev) {
      faults.push({
        path: s.path,
        message: `does not declare ARG ${PREV_ARG}. Without it the driver has no way to hand this stage its predecessor, and the file would be built against whatever base its own FROM names -- a stage chain in which one link is not linked`,
      })
    }
    if (!first && !s.fromsPrev) {
      faults.push({
        path: s.path,
        message: `declares ARG ${PREV_ARG} but no stage in it opens \`FROM \${${PREV_ARG}}\`. The argument would be passed, accepted and ignored, and the stage would build on something else entirely while the chain reported it as linked`,
      })
    }
  })
  const last = stages[stages.length - 1]!
  if (!last.targets.includes(terminalTarget)) {
    faults.push({
      path: last.path,
      message: `is the last stage and defines no \`AS ${terminalTarget}\` target. That target is what the driver exports to the output directory; without it the build would export the last stage's whole filesystem instead of the artifact surface`,
    })
  }
  return faults
}

/** One stage's build, fully decided. */
export interface StageBuild {
  readonly name: string
  readonly path: string
  /** The local image tag this stage is written to, and the next one starts FROM. */
  readonly tag: string
  /** The tag of the previous stage, or undefined for the first. */
  readonly prevTag?: string
  /** Only the arguments this file declares, and only those the caller supplied. */
  readonly buildArgs: Readonly<Record<string, string>>
  /** The last stage exports instead of tagging. */
  readonly terminal: boolean
}

export interface ChainOptions {
  readonly board: string
  readonly supplied: Readonly<Record<string, string>>
  readonly tagRepo?: string
  readonly terminalTarget?: string
}

export const DEFAULT_TAG_REPO = 'mos-rootfs-stage'
export const DEFAULT_TERMINAL_TARGET = 'artifact'

/**
 * A supplied argument no stage declares.
 *
 * This is refused rather than passed. Docker accepts an unused --build-arg with
 * a warning, and the warning scrolls past in a build that prints thousands of
 * lines -- so a VERITY_SALT the pack stage stopped declaring would reach the
 * image as veritysetup's random default, and the first sign would be an image
 * that differs on every build for a reason nobody could name.
 */
export function unusedArgs(
  stages: readonly StageFile[],
  supplied: Readonly<Record<string, string>>,
): string[] {
  const declared = new Set<string>()
  for (const s of stages) for (const a of s.declaredArgs) declared.add(a)
  return Object.keys(supplied)
    .filter((k) => !declared.has(k))
    .sort()
}

export function planChain(stages: readonly StageFile[], opts: ChainOptions): StageBuild[] {
  const repo = opts.tagRepo ?? DEFAULT_TAG_REPO
  const target = opts.terminalTarget ?? DEFAULT_TERMINAL_TARGET
  const faults = auditChain(stages, target)
  if (faults.length > 0) throw new StageChainError(faults)
  const stray = unusedArgs(stages, opts.supplied)
  if (stray.length > 0) {
    throw new StageChainError([
      {
        path: STAGES_DIR,
        message: `was handed ${stray.join(', ')}, which no stage declares. docker would accept each as an unused --build-arg and warn, and that warning scrolls past in a build this size -- so the value would simply not reach the image`,
      },
    ])
  }
  return stages.map((s, i) => ({
    name: s.name,
    path: s.path,
    tag: `${repo}:${opts.board}-${s.name}`,
    prevTag: i === 0 ? undefined : `${repo}:${opts.board}-${stages[i - 1]!.name}`,
    buildArgs: Object.fromEntries(
      s.declaredArgs.filter((a) => a in opts.supplied).map((a) => [a, opts.supplied[a]!]),
    ),
    terminal: i === stages.length - 1,
  }))
}

/**
 * The argv for one stage's `docker buildx build`, everything after the
 * subcommand. Built here rather than in the CLI so the exact command line is a
 * value a test can read -- the flags that decide where the image goes are the
 * ones a chain gets wrong.
 */
export function buildArgv(
  build: StageBuild,
  opts: {
    readonly context: string
    readonly platform: string
    readonly builder?: string
    readonly dest?: string
    readonly terminalTarget?: string
    /**
     * Build every stage from scratch, reading no layer cache.
     *
     * This exists for the GATE, not for convenience. os/rootfs/README.md's
     * determinism gate compares a chain build against a control of two COLD
     * builds -- and a chain whose stages came out of cache is not a cold build,
     * it is a replay of whichever run filled the cache. Without a flag the only
     * way to be cold is to prune the daemon's cache, which on a shared machine
     * takes every other build's cache with it.
     */
    readonly noCache?: boolean
  },
): string[] {
  const argv = ['buildx', 'build']
  if (opts.noCache) argv.push('--no-cache')
  if (opts.builder) argv.push('--builder', opts.builder)
  argv.push('--platform', opts.platform, '-f', build.path)
  if (build.prevTag) argv.push('--build-arg', `${PREV_ARG}=${build.prevTag}`)
  for (const [k, v] of Object.entries(build.buildArgs)) argv.push('--build-arg', `${k}=${v}`)
  if (build.terminal) {
    if (!opts.dest) {
      throw new StageChainError([
        {
          path: build.path,
          message:
            'is the terminal stage and no output directory was given. It would build and be thrown away',
        },
      ])
    }
    argv.push('--target', opts.terminalTarget ?? DEFAULT_TERMINAL_TARGET)
    argv.push('--output', `type=local,dest=${opts.dest}`)
  } else {
    // --load, and not merely -t. With the docker driver -t already loads; with
    // any other it does not, and the next stage's FROM would resolve a tag that
    // is not in the image store. Asking for it explicitly costs nothing on the
    // driver that does it anyway and is the whole chain on one that does not.
    argv.push('-t', build.tag, '--load')
  }
  argv.push(opts.context)
  return argv
}

/**
 * The record of what was built, written beside the artifacts.
 *
 * RFCT-111 asks the driver to record the stage list per build. Which stages ran
 * is not derivable from the output afterwards -- an image built without a
 * feature stage looks like an image whose feature stage did nothing -- so it is
 * written down at the time.
 *
 * THE DECLINED FEATURES ARE RECORDED TOO, and that half is the one M5c's stage
 * selection made necessary. A `# declined:` line naming nothing is not the same
 * statement as no line at all: the first says the build was asked for every
 * feature, the second says nobody wrote it down. Both are printed, always, so
 * an image with no container engine says why on its own manifest rather than
 * leaving a reader to notice a missing binary and guess.
 */
export function stageManifest(
  builds: readonly StageBuild[],
  stages: readonly StageFile[],
  declined: readonly string[] = [],
): string {
  const lines = [
    '# os/rootfs stage chain, as built. One line per stage, in build order.',
    `# declined: ${declined.length > 0 ? [...declined].sort().join(' ') : '(none -- every feature stage in the directory was built)'}`,
    '# name\tcontent-hash\ttag',
  ]
  builds.forEach((b, i) => {
    lines.push(`${b.name}\t${stages[i]!.sha256}\t${b.terminal ? '(exported)' : b.tag}`)
  })
  return `${lines.join('\n')}\n`
}
