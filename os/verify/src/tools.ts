// The seam that decides HOW an image-inspection tool is invoked, and the only
// place that decides it.
//
// PLAN-014 M4 (RFCT-110), the M4a half. os/verify-image-v2.sh reads a disk
// image with sgdisk, mtools at an offset, debugfs/tune2fs over a dd-extracted
// partition, unsquashfs and a userspace `veritysetup verify` -- and NOTHING
// ELSE: no loop mounts, no losetup, no device-mapper, no mount(8). The port
// keeps that toolset exactly, so this file is about where the tools come from
// rather than which ones they are.
//
// TWO ROUTES, ONE SEAM -- the same shape os/verify/run.sh gave bun in M3, and
// for the same reason. A caller passes an argv and reads an exit status and
// cannot tell which route answered, which is what makes a host without
// gptfdisk a SUPPORTED host rather than a documented limitation. The container
// is the pinned IMAGE_ALPINE_3_21 -- the same key os/mkimage-v2.sh assembles
// from and the same one the shell verifier re-execs into, resolved through the
// one resolver, os/build-env/from.sh --ref. That is the point of a key rather
// than a literal at both ends: this reads back a GPT, a FAT slot and a
// squashfs that the assembler wrote, with tools out of the same base. Two
// floating tags could drift apart between the write and the read.
//
// ONE CONTAINER PER RUNTIME, NOT ONE PER CALL. `docker run` costs ~200 ms and
// `apk add` costs seconds; the shell verifier pays both once because it
// re-execs its WHOLE self inside. A port that made one container per tool call
// would pay them per call, and M4b..M4d will make hundreds. So the container is
// created once, prepared once, and every call is a `docker exec` into it.
// dispose() removes it, and so does an exit handler, because a leaked container
// holding a read-only mount of the repository is a mess a later run inherits.
//
// A TOOL THAT FAILS IS NOT AN EMPTY STRING. The shell verifier ends nearly
// every capture in `|| true`, so a tool that could not run at all arrives at the
// check as "", and the check then fails describing the VALUE rather than the
// tool. That is survivable there because the check still goes red. It is not a
// contract to reproduce: here a non-zero exit throws ToolError naming the tool,
// the argv, the status and the stderr, and a caller that means to tolerate a
// status says so with `allow`. The check decides what a failure means; the
// helper never decides it by silence.

import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { REPO_ROOT } from './paths.ts'

/** The image key every route below resolves through os/build-env/from.sh. */
export const TOOL_IMAGE_KEY = 'IMAGE_ALPINE_3_21'

/**
 * The tools this package drives, and the ones the host route must all have.
 *
 * The same set os/verify-image-v2.sh:121 requires, minus the ones no helper
 * here calls yet. It is stated rather than read out of that script on purpose:
 * the script is deleted at M4e, and a derivation whose source is scheduled for
 * deletion is a dependency with a fuse in it.
 */
export const REQUIRED_TOOLS = [
  'sgdisk',
  'mdir',
  'mcopy',
  'mlabel',
  // minfo reads the FAT volume SERIAL, which mlabel does not report. It ships
  // in the same `mtools` package as the other three, so the container route
  // already had it -- but a tool the port drives and does not declare is a tool
  // the HOST route would run without checking it is there, which is the one
  // failure this list exists to stop.
  'minfo',
  'debugfs',
  'tune2fs',
  'dumpe2fs',
  'unsquashfs',
  'veritysetup',
  'getcap',
] as const

/**
 * The Alpine packages that carry them.
 *
 * Byte-for-byte the list at os/verify-image-v2.sh:187, for the same reason the
 * image key is shared: the container the port reads an image in must be the
 * container the oracle read it in, or a parity divergence could be a package
 * difference rather than a check difference.
 */
export const TOOL_PACKAGES = [
  'bash', 'coreutils', 'diffutils', 'gptfdisk', 'sgdisk', 'dosfstools', 'mtools',
  'e2fsprogs', 'e2fsprogs-extra', 'squashfs-tools', 'cryptsetup', 'libcap',
  'libcap-setcap', 'dtc',
] as const

export type ToolRoute = 'host' | 'container'

export interface ToolResult {
  readonly argv: readonly string[]
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** A tool that ran and failed, or could not be run at all. */
export class ToolError extends Error {
  readonly argv: readonly string[]
  readonly code: number
  readonly stdout: string
  readonly stderr: string

  constructor(result: ToolResult, context: string) {
    super(
      `${context}: \`${result.argv.join(' ')}\` exited ${result.code}\n`
      + `  stderr: ${result.stderr.trim() || '(empty)'}\n`
      + `  stdout: ${result.stdout.trim().slice(0, 400) || '(empty)'}`,
    )
    this.name = 'ToolError'
    this.argv = result.argv
    this.code = result.code
    this.stdout = result.stdout
    this.stderr = result.stderr
  }
}

/** Output that ran fine and does not mean what the caller needs it to mean. */
export class ToolOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolOutputError'
  }
}

export interface RunOptions {
  /**
   * Exit statuses to hand back instead of throwing.
   *
   * `veritysetup verify` answers a QUESTION with its status -- 0 for a hash
   * tree that walks and 1 for one that does not -- so a helper that treated 1
   * as "the tool broke" could not express the failing direction at all.
   */
  readonly allow?: readonly number[]
  /** What to say the call was for, when it throws. */
  readonly context?: string
}

export interface ToolRuntime {
  readonly route: ToolRoute
  /** One line naming the route and, on the container route, the pinned image. */
  readonly announce: string
  run: (argv: readonly string[], options?: RunOptions) => Promise<ToolResult>
  dispose: () => Promise<void>
}

export interface RuntimeRequest {
  /**
   * Host paths the tools must be able to READ. Mounted at their own path.
   *
   * Not `/w`, not `/work`. The two image assemblers mount a short name because
   * they RUN A SCRIPT and construct their paths inside it; this runtime is a
   * TOOL handed paths from outside -- the image path comes from a caller's
   * argv or from paths.ts climbing import.meta.dir, and both are HOST absolute
   * paths. Under a short mount they would name nothing inside the container,
   * and the repair would be a prefix rewrite: a second path arithmetic, on the
   * one input whose identity the verdict is about. os/verify/run.sh:189 draws
   * the same line for the same reason, and os/tests/mkimage-v2-selftest.sh:292
   * had it first.
   */
  readonly readOnly?: readonly string[]
  /** One host directory the tools may WRITE to. Mounted at its own path. */
  readonly workDir: string
  /** `host`, `container`, or undefined to choose by what the host has. */
  readonly route?: ToolRoute
  /** Where the announce line goes. Defaults to console.error. */
  readonly log?: (line: string) => void
}

async function capture(argv: readonly string[], stdin?: string): Promise<ToolResult> {
  const proc = Bun.spawn(argv as string[], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { argv, code, stdout, stderr }
}

async function onPath(tool: string): Promise<boolean> {
  const r = await capture(['sh', '-c', `command -v ${tool} >/dev/null 2>&1`])
  return r.code === 0
}

/** The tools of REQUIRED_TOOLS this host does not have, in declaration order. */
export async function missingHostTools(): Promise<string[]> {
  const missing: string[] = []
  for (const tool of REQUIRED_TOOLS) {
    if (!(await onPath(tool))) missing.push(tool)
  }
  return missing
}

/**
 * Resolve the pinned tool image through the tree's own resolver.
 *
 * from.sh validates that the key exists, is a digest and not a tag, and is well
 * formed, and it says so naming the key and the file -- so none of that is
 * restated here.
 */
export async function toolImageRef(): Promise<string> {
  const r = await capture(['bash', `${REPO_ROOT}/os/build-env/from.sh`, '--ref', TOOL_IMAGE_KEY])
  if (r.code !== 0) throw new ToolError(r, `resolving ${TOOL_IMAGE_KEY}`)
  const ref = r.stdout.trim()
  if (ref === '') {
    throw new ToolOutputError(
      `os/build-env/from.sh --ref ${TOOL_IMAGE_KEY} exited 0 and printed nothing. `
      + `An empty reference would become \`docker run "" ...\`, which fails with a message `
      + `about an image name rather than about the key that produced it.`,
    )
  }
  return ref
}

/**
 * Which route to take, as a pure decision -- so it can be driven offline.
 *
 * Extracted from createToolRuntime for exactly that reason: the interesting
 * part is the decision, and a test that could only reach it by having (or not
 * having) sgdisk on the host would be a test that skipped on one machine and
 * ran on another. A skip reports the same green as a pass.
 */
export function chooseRoute(forced: string | undefined, missing: readonly string[]): ToolRoute {
  if (forced !== undefined && forced !== 'host' && forced !== 'container') {
    throw new ToolOutputError(
      `MOS_VERIFY_TOOLS is '${forced}'; it takes 'host' or 'container'. A value that is `
      + `neither would otherwise be read as "not set" and silently choose a route.`,
    )
  }
  if (forced === 'host' && missing.length > 0) {
    throw new ToolOutputError(
      `MOS_VERIFY_TOOLS=host, but this host has no ${missing.join(', ')}. `
      + `Unset it to take the pinned ${TOOL_IMAGE_KEY} container, or install them.`,
    )
  }
  if (forced !== undefined) return forced
  return missing.length === 0 ? 'host' : 'container'
}

/**
 * Why the container route was taken, in the words the caller would recognise.
 *
 * Separate from chooseRoute because the ROUTE and the REASON have different
 * inputs, and conflating them cost a message: once parity-cli started deciding
 * the route up front and passing it in, createToolRuntime stopped computing the
 * missing list at all and announced "(no  on this host)" -- a sentence with the
 * subject removed. The announce line is the only thing that says which tools
 * produced a verdict, so an empty one is not cosmetic.
 */
export function routeReason(forced: string | undefined, missing: readonly string[]): string {
  if (missing.length > 0) return `no ${missing.join(', ')} on this host`
  if (forced === 'container') return 'MOS_VERIFY_TOOLS=container'
  return 'asked for'
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

/**
 * The distinct directories to mount so that every one of `paths` is readable.
 *
 * A path that IS a directory is mounted itself; a path that is a file has its
 * directory mounted, because a file bind-mount cannot be replaced under the
 * container and gives nothing a sibling read would need. A path that does not
 * exist gets its parent, so the tool reports the missing FILE rather than the
 * runtime reporting a missing mount -- those are different edits.
 */
export function mountDirs(paths: readonly string[]): string[] {
  const dirs = new Set<string>()
  for (const p of paths) {
    const abs = resolve(p)
    dirs.add(isDir(abs) ? abs : dirname(abs))
  }
  return [...dirs].sort()
}

/**
 * The preflight's verdict, as a pure function so both branches can be driven.
 *
 * The `unseen` branch is the one this host produces -- a bind mount under /tmp
 * delivers an empty directory and the sentinel FILE is not in it. The
 * `echoed` branch covers the subtler shape: a mount that carries something
 * other than what the host has at that path. It cannot be produced on this
 * host, so it is driven in the suite instead of being left as a branch nobody
 * has ever seen take.
 */
export function mountFault(input: {
  unseen: readonly string[]
  echoed: string | undefined
  sentinel: string
  workDir: string
}): string | undefined {
  if (input.unseen.length > 0) {
    return `the pinned tool container cannot see paths that this host can:\n`
      + input.unseen.map(u => `         ${u}`).join('\n')
      + `\n       The mount succeeded and delivered nothing, which is how a bind mount of /tmp`
      + `\n       behaves on this host. The file IS there; it is the mount that is empty. Put it`
      + `\n       somewhere the docker daemon can actually share (inside the repository, or under`
      + `\n       _out/ or /srv).`
  }
  if (input.echoed !== input.sentinel) {
    const got = input.echoed === undefined || input.echoed === '' ? '(nothing)' : `'${input.echoed}'`
    return `the work directory ${input.workDir} is mounted into the tool container and does not\n`
      + `       carry its contents. A sentinel written there reads back as ${got} inside the\n`
      + `       container, where it should read '${input.sentinel}'.\n`
      + `       The DIRECTORY being visible proves nothing -- an empty bind mount preserves that\n`
      + `       much, which is why this is a content probe and not an existence one. Every\n`
      + `       partition extracted into it would be written on one side of the mount and read on\n`
      + `       the other. Put the work directory under the repository, _out/ or /srv.`
  }
  return undefined
}

const liveContainers = new Set<string>()
/** Distinguishes concurrent runtimes in one process; the pid alone would not. */
let runtimeSeq = 0
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  const reap = (): void => {
    for (const id of liveContainers) {
      // Synchronous on purpose: an exit handler that awaits is an exit handler
      // that does not finish, and the container outlives the process that made
      // it -- holding a read-only mount of the repository open.
      Bun.spawnSync(['docker', 'rm', '-f', id], { stdout: 'ignore', stderr: 'ignore' })
    }
    liveContainers.clear()
  }
  process.on('exit', reap)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      reap()
      process.exit(1)
    })
  }
}

/**
 * Pick a route, prepare it, and hand back the one function that runs a tool.
 *
 * MOS_VERIFY_TOOLS=host|container overrides the choice, which is how the two
 * routes are compared on one host.
 */
export async function createToolRuntime(request: RuntimeRequest): Promise<ToolRuntime> {
  const log = request.log ?? ((line: string) => console.error(line))
  const forced = request.route ?? process.env['MOS_VERIFY_TOOLS']

  // Computed even when the route is already decided: it is the REASON, not the
  // decision, and the announce line is the only thing that says which tools
  // produced a verdict.
  const missing = await missingHostTools()
  const route = chooseRoute(forced, missing)

  if (route === 'host') {
    log(`os/verify: image tools on this host (${REQUIRED_TOOLS.length} of ${REQUIRED_TOOLS.length} present)`)
    return {
      route,
      announce: 'os/verify: image tools on this host',
      run: (argv, options) => runChecked(capture, argv, options),
      dispose: async () => {},
    }
  }

  return await createContainerRuntime(request, missing, log)
}

/**
 * Turn a raw exec into the throwing contract every helper is written against.
 *
 * Exported so the stub runtime in src/image.test.ts shares it rather than
 * approximating it. A stub that decided for itself when to throw would be the
 * thing the suite tests, and the difference between "the helper refused" and
 * "the stub refused" is invisible from a green test.
 */
export async function runChecked(
  exec: (argv: readonly string[]) => Promise<ToolResult>,
  argv: readonly string[],
  options: RunOptions | undefined,
): Promise<ToolResult> {
  const result = await exec(argv)
  const allowed = options?.allow ?? []
  if (result.code !== 0 && !allowed.includes(result.code)) {
    throw new ToolError(result, options?.context ?? 'image tool')
  }
  return result
}

async function createContainerRuntime(
  request: RuntimeRequest,
  missing: readonly string[],
  log: (line: string) => void,
): Promise<ToolRuntime> {
  if (!(await onPath('docker'))) {
    throw new ToolOutputError(
      `this host has no ${missing.join(', ')} and no docker to run the pinned ones in.\n`
      + `       os/verify's image helpers need one of the two: install them, or install docker --\n`
      + `       the base they are read out of is recorded as ${TOOL_IMAGE_KEY} in\n`
      + `       os/build-env/images.env and needs a container runtime to be it.`,
    )
  }

  const image = await toolImageRef()

  // A digest that is well formed and WRONG is the one failure from.sh cannot
  // see: it checks the SHAPE of a reference, not that a registry has it. Left
  // to `docker run`, it arrives as exit 125 -- indistinguishable at this seam
  // from a tool exiting 125. So the image is obtained once, here, where the
  // failure can still be attributed to the key that carries it. Same reasoning,
  // same words, as os/verify/run.sh:158.
  const have = await capture(['docker', 'image', 'inspect', image])
  if (have.code !== 0) {
    log(`os/verify: ${image} is not in the local image store; pulling it`)
    const pull = await capture(['docker', 'pull', '-q', image])
    if (pull.code !== 0) {
      throw new ToolError(
        pull,
        `${TOOL_IMAGE_KEY}=${image} could not be obtained. That key in os/build-env/images.env is `
        + `this tree's record of which base it reads an image with. The reference is well formed -- `
        + `from.sh just checked that -- so what failed is the lookup`,
      )
    }
  }

  const workDir = resolve(request.workDir)
  if (!isDir(workDir)) {
    throw new ToolOutputError(
      `the tool runtime's work directory ${workDir} is not a directory. Every helper that `
      + `extracts a partition writes there; a path that is not there would surface later as a `
      + `tool failing on an output file, which sends the reader to the wrong edit.`,
    )
  }

  const mounts: string[] = []
  const seen = new Set<string>()
  for (const dir of mountDirs(request.readOnly ?? [])) {
    if (dir === workDir || seen.has(dir)) continue
    // A read-only mount NESTED inside the work directory would shadow it, so
    // the outer rw mount is the one that carries it and this one is dropped.
    if (dir.startsWith(`${workDir}/`)) continue
    seen.add(dir)
    mounts.push('-v', `${dir}:${dir}:ro`)
  }
  mounts.push('-v', `${workDir}:${workDir}`)

  const name = `mos-verify-tools-${process.pid}-${runtimeSeq++}`
  installExitHook()
  const started = await capture([
    'docker', 'run', '-d', '--rm', '--name', name, '--label', 'mos-verify=tools',
    ...mounts, '-w', workDir, image, 'tail', '-f', '/dev/null',
  ])
  if (started.code !== 0) throw new ToolError(started, 'starting the pinned tool container')
  liveContainers.add(name)

  const exec = async (argv: readonly string[]): Promise<ToolResult> => {
    const r = await capture(['docker', 'exec', name, ...argv])
    // The argv the CALLER passed, not the docker wrapper: a ToolError naming
    // `docker exec mos-verify-tools-1234 sgdisk -p img` sends the reader to the
    // seam, and the thing that failed is sgdisk.
    return { ...r, argv }
  }

  // THE MOUNT THAT SUCCEEDS AND CARRIES NOTHING. On this host a bind mount of
  // anything under /tmp propagates as an EMPTY DIRECTORY rather than failing --
  // measured 2026-08-25 and recorded at os/verify/run.sh:217. Without a guard, a
  // helper would report "sgdisk: cannot open image.img" about a file the host
  // reads fine, and send the reader to look for a path they can `cat`.
  //
  // EVERY PROBE HERE IS A PROBE FOR CONTENT, NOT FOR A PATH, and that
  // distinction was found by driving it rather than reasoned about. The first
  // version asked `[ -e "$dir" ]` of each mounted directory -- and an empty
  // mount SATISFIES that: the directory is there inside the container, it just
  // carries nothing. Run with --work under /tmp it reported no problem at all.
  // A directory's existence is exactly the fact a broken bind mount preserves.
  //
  // So: a read-only directory is proved by a WITNESS ENTRY taken from the host
  // listing, and the work directory -- which is written, and where every
  // extracted partition lands -- by a sentinel written here and read back
  // inside, compared byte for byte.
  const witnesses: string[] = []
  for (const p of request.readOnly ?? []) {
    const abs = resolve(p)
    if (!isDir(abs)) {
      witnesses.push(abs)
      continue
    }
    const entries = readdirSync(abs)
    // Nothing to witness with, and nothing to lose: an empty directory carries
    // the same nothing whether or not the mount works.
    if (entries[0] !== undefined) witnesses.push(join(abs, entries[0]))
  }

  const sentinelName = `.mos-verify-mount-probe-${process.pid}-${runtimeSeq}`
  const sentinelPath = join(workDir, sentinelName)
  const sentinel = `mos-verify ${process.pid} ${runtimeSeq} ${name}`
  writeFileSync(sentinelPath, sentinel)

  const refuseWith = async (message: string): Promise<never> => {
    rmSync(sentinelPath, { force: true })
    await capture(['docker', 'rm', '-f', name])
    liveContainers.delete(name)
    throw new ToolOutputError(message)
  }

  const probe = await exec(['sh', '-c',
    'for f in "$@"; do [ -e "$f" ] || printf "unseen:%s\\n" "$f"; done; '
    + 'printf "sentinel:"; cat "$1" 2>/dev/null; printf "\\n"',
    'sh', sentinelPath, ...witnesses])
  const unseen = probe.stdout.split('\n').filter(l => l.startsWith('unseen:')).map(l => l.slice(7))
  const echoed = probe.stdout.split('\n').find(l => l.startsWith('sentinel:'))?.slice('sentinel:'.length)

  const fault = mountFault({ unseen, echoed, sentinel, workDir })
  if (fault !== undefined) await refuseWith(fault)
  rmSync(sentinelPath, { force: true })

  const add = await exec(['apk', 'add', '--no-cache', '-q', ...TOOL_PACKAGES])
  if (add.code !== 0) {
    await capture(['docker', 'rm', '-f', name])
    liveContainers.delete(name)
    throw new ToolError(add, `installing the image tools into ${image}`)
  }

  // A tool the packages were supposed to carry and do not is the failure this
  // whole route exists to prevent, and it must not first appear as a check
  // going red. Asserted by NAME, in the container, before anything is read.
  const which = await exec(['sh', '-c',
    'for t in "$@"; do command -v "$t" >/dev/null 2>&1 || printf "absent:%s\\n" "$t"; done',
    'sh', ...REQUIRED_TOOLS])
  const absent = which.stdout.split('\n').filter(l => l.startsWith('absent:')).map(l => l.slice(7))
  if (absent.length > 0) {
    await capture(['docker', 'rm', '-f', name])
    liveContainers.delete(name)
    throw new ToolOutputError(
      `${image} plus [${TOOL_PACKAGES.join(' ')}] does not provide ${absent.join(', ')}. `
      + `Every helper below assumes the whole set; a missing one would surface as a check `
      + `failing about an image that is fine.`,
    )
  }

  const announce = `os/verify: image tools in ${image} (${routeReason(request.route ?? process.env['MOS_VERIFY_TOOLS'], missing)})`
  log(announce)

  return {
    route: 'container',
    announce,
    run: (argv, options) => runChecked(exec, argv, options),
    dispose: async () => {
      if (!liveContainers.has(name)) return
      liveContainers.delete(name)
      await capture(['docker', 'rm', '-f', name])
    },
  }
}
