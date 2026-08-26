// The seam: how an external tool is run, and the only place in os/build that
// decides.
//
// os/verify has one of these for bun (os/verify/run.sh's run_bun: two routes,
// one function, callers that cannot tell which answered). This is the same
// shape one level down, for the toolset the assemblers drive -- sgdisk, mtools,
// dd, mkimage, veritysetup, e2fsprogs and rauc.
//
// Nothing here swallows a failure. run() returns the exit status, stdout and
// stderr, and decides nothing; must() throws a ToolError carrying all of it
// plus the argv and the route. A tool whose failure signal is NOT its exit
// status -- debugfs exits 0 and writes to stderr -- is handled by its own
// wrapper in src/tools/, which is why this layer refuses to interpret.

import { $ } from 'bun'
import { randomUUID } from 'node:crypto'
import { resolveImage } from './images.ts'

// The container is the normal route, not a degraded one. Both shell assemblers
// have a route already: os/mkimage-v2.sh probes the host with
// host_can_assemble() and falls back to an alpine container; os/mkimage-x64.sh
// does not even probe -- "no sgdisk, no mtools and no grub-mkstandalone, and
// requiring them would make [the build] a host-configuration problem". This
// host has none of sgdisk, mcopy, mkimage or veritysetup, and its e2fsprogs is
// 1.46.5, too old for `-O ^orphan_file`, which is why pin_seeded_times runs
// container-side. The host route is the optimisation.
//
// The route is chosen per toolset, never per tool. Mixing would mean an image
// assembled by the host's mke2fs and sgdisk but the container's mcopy, and
// "which tool wrote these bytes" would stop having an answer -- the property
// the byte-identity gates rest on. host_can_assemble() is an && chain across
// seven binaries plus a capability probe for the same reason.
//
// A toolbox is opened once -- image resolved, container started, packages
// installed, every tool asserted present -- and each call is a `docker exec`
// into it. Measured on this host, 2026-08-25: `docker run --rm <alpine> true`
// is ~320 ms and `docker exec <running> true` ~40 ms, with the apk that
// provides the toolset ~1.3 s on top of every run. An assembler makes tens of
// calls, so a container per call would spend more time starting containers than
// writing filesystems and would reinstall the toolset from the network each
// time. It also makes container-side steps ordinary: pin_seeded_times' dumpe2fs
// and debugfs are two more calls into the same session.

export type RouteKind = 'host' | 'container'

/** How a toolset's packages are installed, which differs by base image family. */
export type PackageManager = 'apk' | 'apt'

/** A host binary carried into the container, the way os/update/bundle.sh installs its rauc. */
export interface CarriedFile {
  readonly from: string
  readonly to: string
  readonly mode: string
}

export interface Toolset {
  /** Short name, used in the announce line and in container names. */
  readonly key: string
  /** The os/build-env/images.env key naming the base image. Never a literal reference. */
  readonly imageKey: string
  readonly manager: PackageManager
  /** Exactly the packages the shell installs today. See each toolset's note in src/toolsets.ts. */
  readonly packages: readonly string[]
  /** Every binary this toolset must provide, asserted on BOTH routes after open(). */
  readonly tools: readonly string[]
  /** Host binaries copied in, e.g. the self-built rauc. Container route only. */
  readonly carry?: readonly CarriedFile[]
  /** Environment every call in this toolset gets, e.g. E2FSPROGS_FAKE_TIME. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Where this toolset's tools came from, when that decides what it may DO.
   *
   * One tool uses it: rauc. A bundle is written by one rauc and installed by
   * another on the device, and they are not compatible by accident -- so
   * src/tools/rauc.ts refuses a bundle-writing
   * call unless this says 'shipped'. It lives on the toolset rather than being
   * inferred from `carry`, because "this binary is the one this tree built" is
   * a claim the toolset makes, not something a file path can prove.
   */
  readonly provenance?: 'shipped' | 'distro'
  /**
   * A host capability the tools' presence does not imply.
   *
   * mke2fs 1.46.5 is on this host's PATH and cannot switch orphan_file off, so
   * `command -v mke2fs` is true and the host still cannot assemble. Returns the
   * reason it failed, which the announce line carries.
   */
  readonly hostProbe?: () => Promise<{ readonly ok: boolean, readonly why: string }>
}

export interface ToolResult {
  readonly argv: readonly string[]
  readonly route: RouteKind
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly ok: boolean
}

/** A tool that failed, with everything needed to see why -- and nothing dropped. */
export class ToolError extends Error {
  readonly argv: readonly string[]
  readonly route: RouteKind
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string

  constructor(result: ToolResult, note?: string) {
    const head = note ?? `${result.argv[0] ?? '(no argv)'} failed with exit ${result.exitCode}`
    super(
      `${head}\n`
      + `  route:  ${result.route}\n`
      + `  argv:   ${result.argv.map(quoteForMessage).join(' ')}\n`
      + `  stderr: ${indent(result.stderr) || '(empty)'}\n`
      + `  stdout: ${indent(result.stdout) || '(empty)'}`,
    )
    this.name = 'ToolError'
    this.argv = result.argv
    this.route = result.route
    this.exitCode = result.exitCode
    this.stdout = result.stdout
    this.stderr = result.stderr
  }
}

function indent(s: string): string {
  const t = s.trimEnd()
  return t === '' ? '' : t.split('\n').join('\n          ')
}

/** For the MESSAGE only. Nothing built here is ever handed to a shell. */
function quoteForMessage(a: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`
}

export interface OpenOptions {
  /**
   * Host directories the container must see, each mounted at its own path.
   *
   * Identity mounts, not /w or /work. os/verify/run.sh:189 states the rule --
   * short names for containers that run a script and build their paths inside,
   * identity for containers handed paths from outside -- and every tool here is
   * the second kind: the caller passes absolute host paths and reads absolute
   * host paths back out. It matters twice over when bun is itself in a
   * container: a sibling container's -v is resolved by the daemon against the
   * host filesystem, so a translated path would name the wrong thing, and a
   * bind mount of a path the daemon cannot see succeeds and delivers an empty
   * directory.
   */
  readonly mounts?: readonly string[]
  /** Force a route instead of measuring the host. Set by MOS_BUILD_TOOLBOX too. */
  readonly route?: RouteKind
  /** Where each call runs unless it says otherwise. */
  readonly cwd?: string
  /** Called once with the announce line, so a run is never ambiguous about which tools answered. */
  readonly announce?: (line: string) => void
}

export interface RunOptions {
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

// NO STDIN. Every tool in this toolset takes its input as a FILE and says so on
// its command line -- dd's if=, mkimage's -d, debugfs's -f, mcopy's source,
// rauc's bundle directory. Offering a stdin here would add a second way to hand
// a tool its input, and the one place it looks tempting (debugfs, which reads a
// command script) is exactly where the shell writes a file too: pin_seeded_times
// builds "${img}.times" and passes `-f`. A path is also the only form that
// survives the container boundary unchanged.

/** The docker client. run.sh passes the one it checked; a bare `docker` otherwise. */
function dockerBin(): string {
  return process.env.MOS_BUILD_DOCKER || 'docker'
}

async function onHostPath(tool: string): Promise<boolean> {
  const r = await $`sh -c ${`command -v -- "$1" >/dev/null 2>&1`} sh ${tool}`.nothrow().quiet()
  return r.exitCode === 0
}

export class Toolbox {
  readonly toolset: Toolset
  readonly route: RouteKind
  readonly image: string
  readonly announceLine: string
  private readonly container: string
  private readonly defaultCwd: string | undefined
  private closed = false

  private constructor(init: {
    toolset: Toolset
    route: RouteKind
    image: string
    container: string
    defaultCwd: string | undefined
    announceLine: string
  }) {
    this.toolset = init.toolset
    this.route = init.route
    this.image = init.image
    this.container = init.container
    this.defaultCwd = init.defaultCwd
    this.announceLine = init.announceLine
  }

  /**
   * Choose a route, make the tools available on it, and prove they are there.
   *
   * @throws Error naming the toolset and the missing tool. A toolbox that
   *   opened without its tools would hand every later failure a "command not
   *   found" attributed to the step that happened to run first.
   */
  static async open(toolset: Toolset, options: OpenOptions = {}): Promise<Toolbox> {
    const forced = options.route ?? forcedRoute()
    let route: RouteKind
    let why: string

    if (forced !== undefined) {
      route = forced
      why = options.route !== undefined ? 'asked for' : 'MOS_BUILD_TOOLBOX'
    } else {
      const missing: string[] = []
      for (const t of toolset.tools) {
        if (!(await onHostPath(t))) missing.push(t)
      }
      if (missing.length > 0) {
        route = 'container'
        why = `not on this host: ${missing.join(', ')}`
      } else if (toolset.hostProbe !== undefined) {
        const probe = await toolset.hostProbe()
        route = probe.ok ? 'host' : 'container'
        why = probe.ok ? 'the whole toolset is on this host' : probe.why
      } else {
        route = 'host'
        why = 'the whole toolset is on this host'
      }
    }

    if (route === 'host') {
      // Asserted even on the route that was chosen BY measuring, because a
      // forced host route did no measuring at all -- and MOS_BUILD_TOOLBOX=host
      // on a machine without sgdisk must say so here rather than in whichever
      // wrapper is called first.
      const missing: string[] = []
      for (const t of toolset.tools) {
        if (!(await onHostPath(t))) missing.push(t)
      }
      if (missing.length > 0) {
        throw new Error(
          `the ${toolset.key} toolset was run on the host route, and this host does not have: `
          + `${missing.join(', ')}. Unset MOS_BUILD_TOOLBOX to let the route be measured, or install `
          + `them -- a toolset is taken whole or not at all, because an image half-written by host `
          + `tools and half by container tools has no answer to which tool wrote which bytes.`,
        )
      }
      const line = `os/build: ${toolset.key} on the host (${why})`
      options.announce?.(line)
      return new Toolbox({
        toolset, route, image: '(host)', container: '', defaultCwd: options.cwd, announceLine: line,
      })
    }

    const image = await resolveImage(toolset.imageKey)
    const docker = dockerBin()
    const container = `mos-build-${toolset.key}-${randomUUID().slice(0, 8)}`

    const mountArgs: string[] = []
    for (const m of options.mounts ?? []) mountArgs.push('-v', `${m}:${m}`)

    // --rm with -d so a container this process never gets to close is removed
    // when its sleep ends; the sleep is BOUNDED for the same reason. `sleep
    // infinity` would outlive a SIGKILLed session forever, and this campaign's
    // sessions are killed by account limits often enough to have a rule about
    // committing in stages.
    const start = await $`${docker} run -d --rm --name ${container} ${mountArgs} --entrypoint sleep ${image} 3600`
      .nothrow().quiet()
    if (start.exitCode !== 0) {
      throw new Error(
        `could not start the ${toolset.key} toolbox container from ${image} (exit ${start.exitCode}):\n`
        + `${start.stderr.toString().trimEnd()}`,
      )
    }

    try {
      if (toolset.packages.length > 0) {
        const install = toolset.manager === 'apk'
          ? ['sh', '-c', `apk add --no-cache -q ${toolset.packages.join(' ')}`]
          : [
              'sh',
              '-c',
              'apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq '
              + `--no-install-recommends ${toolset.packages.join(' ')} >/dev/null`,
            ]

        // Retried, because the index is fetched over the network and apk lies
        // about losing it. Measured on this host, 2026-08-25: of 40 consecutive
        // `apk add --no-cache -q e2fsprogs e2fsprogs-extra` runs in the pinned
        // alpine, 3 failed, reading
        //
        //     ERROR: unable to select packages:
        //       e2fsprogs (no such package):
        //
        // about a package that is unquestionably in that image, because the
        // index fetch failed and apk describes an empty index as an empty
        // repository. A fourth shape appeared once: exit 6 naming a
        // half-resolved e2fsprogs-libs, the same fetch failing further along.
        // At ~7% per install and eight toolbox opens in a suite run, that is a
        // red run every other time for a reason unrelated to what is under
        // test. Three attempts, not one: a package that genuinely does not
        // exist fails identically three times, so this hides no real failure,
        // and the refusal says how many attempts were made.
        const attempts = 3
        let installed: ToolResult | undefined
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const r = await $`${docker} exec ${container} ${install}`.nothrow().quiet()
          if (r.exitCode === 0) { installed = undefined; break }
          installed = {
            argv: install, route: 'container', exitCode: r.exitCode,
            stdout: r.stdout.toString(), stderr: r.stderr.toString(), ok: false,
          }
          if (attempt < attempts) await Bun.sleep(1000 * attempt)
        }
        if (installed !== undefined) {
          throw new Error(
            `the ${toolset.key} toolset could not be installed in ${image}, in ${attempts} attempts `
            + `(last exit ${installed.exitCode}):\n`
            + `  packages: ${toolset.packages.join(' ')}\n`
            + `  stderr:   ${installed.stderr.trimEnd() || '(empty)'}\n`
            + `  stdout:   ${installed.stdout.trimEnd() || '(empty)'}\n`
            + `  note:     apk reports a failed index FETCH as "no such package", so that sentence is `
            + `not evidence the package is absent -- three attempts are.`,
          )
        }
      }

      for (const file of toolset.carry ?? []) {
        // docker cp rather than a bind mount: the file is an INPUT that has to
        // be on PATH inside, which a mount cannot arrange, and os/update/
        // bundle.sh installs its rauc into /usr/local/bin for the same reason.
        // It also needs no mount, so a binary anywhere on the host works.
        const cp = await $`${docker} cp ${file.from} ${`${container}:${file.to}`}`.nothrow().quiet()
        if (cp.exitCode !== 0) {
          throw new Error(
            `the ${toolset.key} toolset could not carry ${file.from} into the container as ${file.to} `
            + `(exit ${cp.exitCode}):\n${cp.stderr.toString().trimEnd()}`,
          )
        }
        const chmod = await $`${docker} exec ${container} chmod ${file.mode} ${file.to}`.nothrow().quiet()
        if (chmod.exitCode !== 0) {
          throw new Error(
            `${file.to} was carried into the ${toolset.key} toolbox but could not be made ${file.mode} `
            + `(exit ${chmod.exitCode}):\n${chmod.stderr.toString().trimEnd()}`,
          )
        }
      }

      // Every tool, asserted. An apk or apt that reports success and provides
      // one binary fewer than asked is not hypothetical -- alpine splits
      // debugfs and dumpe2fs into e2fsprogs-extra, so `apk add e2fsprogs` alone
      // installs an e2fsprogs with no debugfs in it and says nothing. Without
      // this the gap surfaces as "debugfs: not found" from pin_seeded_times,
      // forty steps into an assembly.
      const probe = [
        'sh', '-c',
        'for t in "$@"; do command -v -- "$t" >/dev/null 2>&1 || printf "missing:%s\\n" "$t"; done',
        'sh',
        ...toolset.tools,
      ]
      const seen = await $`${docker} exec ${container} ${probe}`.nothrow().quiet()
      const missing = seen.stdout.toString().split('\n')
        .filter(l => l.startsWith('missing:')).map(l => l.slice('missing:'.length))
      if (seen.exitCode !== 0 || missing.length > 0) {
        throw new Error(
          `the ${toolset.key} toolbox came up without every tool it declares.\n`
          + `  image:    ${image}\n`
          + `  packages: ${toolset.packages.join(' ') || '(none)'}\n`
          + `  missing:  ${missing.join(', ') || '(the probe itself failed)'}\n`
          + `  stderr:   ${seen.stderr.toString().trimEnd() || '(empty)'}`,
        )
      }
    } catch (e) {
      await $`${docker} rm -f ${container}`.nothrow().quiet()
      throw e
    }

    const line = `os/build: ${toolset.key} in ${image} (${why})`
    options.announce?.(line)
    return new Toolbox({
      toolset, route, image, container, defaultCwd: options.cwd, announceLine: line,
    })
  }

  /**
   * Run one argv. Returns what happened; decides nothing.
   *
   * The first element is the binary. Nothing is passed through a shell on
   * either route: Bun.$ interpolates an array as separate arguments, and
   * `docker exec` takes an argv. A partition label containing a space, or a
   * board that ever declares one containing `;`, is an argument and not a
   * command -- which is the same property os/verify's parser exists to give
   * these files at rest.
   */
  async run(argv: readonly string[], options: RunOptions = {}): Promise<ToolResult> {
    this.refuseIfClosed(argv)
    if (argv.length === 0) {
      // An empty argv is not a tool call. On the host route Bun.$ would run
      // nothing and report success; through docker exec it is a usage error
      // several sentences from the cause.
      throw new Error(`the ${this.toolset.key} toolbox was asked to run an empty argv, which is not a tool call`)
    }

    const env = { ...this.toolset.env, ...options.env }
    const cwd = options.cwd ?? this.defaultCwd

    let result
    if (this.route === 'host') {
      let cmd = $`${argv}`.nothrow().quiet()
      if (cwd !== undefined) cmd = cmd.cwd(cwd)
      if (Object.keys(env).length > 0) cmd = cmd.env({ ...process.env, ...env })
      result = await cmd
    } else {
      const docker = dockerBin()
      const flags: string[] = []
      if (cwd !== undefined) flags.push('-w', cwd)
      for (const [k, v] of Object.entries(env)) flags.push('-e', `${k}=${v}`)
      result = await $`${docker} exec ${flags} ${this.container} ${argv}`.nothrow().quiet()
    }

    return {
      argv,
      route: this.route,
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      ok: result.exitCode === 0,
    }
  }

  /**
   * run(), and a nonzero exit is a ToolError rather than a value to ignore.
   *
   * Most tools here fail this way. The ones that do not -- debugfs exits 0 and
   * writes its failures to stderr; veritysetup format's answer is on stdout and
   * an unparseable one is a failure with exit 0 -- are handled in their own
   * wrapper, which calls run() and reads the result. That is the split: this
   * layer knows what "the process failed" means and nothing else.
   */
  async must(argv: readonly string[], options: RunOptions & { note?: string } = {}): Promise<ToolResult> {
    const r = await this.run(argv, options)
    if (!r.ok) throw new ToolError(r, options.note)
    return r
  }

  /** Tear the session down. Safe to call twice; a host toolbox has nothing to tear down. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.route !== 'container') return
    await $`${dockerBin()} rm -f ${this.container}`.nothrow().quiet()
  }

  /** The container's name, for a test that needs to look at it from outside. */
  get containerName(): string {
    return this.container
  }

  private refuseIfClosed(argv: readonly string[]): void {
    if (!this.closed) return
    // Left to docker this is "No such container", which names a random UUID
    // and not the mistake.
    throw new Error(
      `the ${this.toolset.key} toolbox was closed, and ${argv[0] ?? '(empty argv)'} was run through it `
      + `afterwards. A closed toolbox has no tools; reopen one.`,
    )
  }
}

function forcedRoute(): RouteKind | undefined {
  const v = process.env.MOS_BUILD_TOOLBOX
  if (v === undefined || v === '') return undefined
  if (v === 'host' || v === 'container') return v
  throw new Error(`MOS_BUILD_TOOLBOX=${v} is neither 'host' nor 'container'`)
}
