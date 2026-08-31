// The smoke runner: execute every self-built artifact inside the root that ships
// it and require the version it reports to be the one os/pkgs/podman/versions.env,
// os/pkgs/rauc/versions.env or the crate manifest pins. Execution and version
// identity, not behaviour; the QEMU boot tests and the ldd/NEEDED checks keep
// functional coverage. Everything below takes an `Exec`, so the suite reaches
// every verdict from the failing side with fabricated output and no image,
// daemon or build. The verdicts are pass, fail, `unclaimed` -- a conclusion
// nobody reached, kept for the next artifact this tree builds and cannot yet
// ask -- and `executor-limited`, the one case where a non-zero exit is a
// statement about the emulated executor rather than about the artifact; both
// are exercised in smoke.test.ts. mosd and apid also report their build
// commit, asserted against a recorded build fact and never against
// `git rev-parse HEAD`; see `BuildCommitFact`.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ARTIFACTS, pinCoverageFaults, unclaimedFaults, type Artifact, type ExecutorLimit } from './smoke-register.ts'
import type { Pin } from './smoke-pins.ts'
import { REPO_ROOT } from './paths.ts'

/** One executed command, and everything the runner is allowed to know about it. */
export interface ExecResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
  /**
   * The budget, when the budget is what ended it.
   *
   * A process the watchdog kills answers 137 -- 128 plus SIGKILL's 9 -- and that
   * number is indistinguishable from a program that chose to exit 137, so every
   * message built from the status alone makes its reader decode a signal to
   * learn that the RUNNER ended this and not the program. It cost this campaign
   * a build: `docker load ... exited 137: Loaded image: localhost/mos-factory-root:x64`
   * is a kill reported beside docker's own success line, and the run was failed.
   * Carrying the budget out beside the status is what lets a message say `the
   * watchdog killed it after N ms` in words.
   */
  readonly timedOutAfterMs?: number
}

/**
 * Run one command inside the factory root.
 *
 * The argv is the absolute path of the binary in the image followed by its
 * arguments -- not a shell line. The factory root is `FROM scratch` with no
 * ENTRYPOINT, no CMD and no PATH, so a bare `crun` would not resolve, and the
 * installed path is the thing under test anyway.
 */
export type Exec = (argv: readonly string[]) => Promise<ExecResult>

export type Verdict = 'pass' | 'fail' | 'unclaimed' | 'executor-limited'

/**
 * Which executor ran the argv.
 *
 * `native` is `docker run` on this host's daemon; `buildkit` is the fallback
 * `smokeRun` falls back to when the daemon cannot execute the image's platform,
 * where every instruction runs under qemu-user inside the builder. The two are
 * not interchangeable -- a program that needs a syscall the emulator does not
 * implement fails on one and not on the other -- so the route is carried into
 * `judge`, which is the only place allowed to soften a verdict because of it.
 */
export type ExecRoute = 'native' | 'buildkit'

/**
 * An `Exec` that says which executor it is.
 *
 * The route travels ON the executor rather than beside it. A parallel variable
 * -- "we switched to buildkit, so also set route" -- is two statements of one
 * fact that agree until one of them is edited, and the one that would be edited
 * is the one no test can reach without an arm64 host. Tagging the function makes
 * the two inseparable: `buildkitExec` cannot be handed to the runner without its
 * route, and a suite that fabricates an executor can tag it the same way.
 */
export type RoutedExec = Exec & { readonly route?: ExecRoute }

/**
 * Which executor this is, defaulting to the strict reading.
 *
 * An untagged function is `native`: a caller that hands the runner a bare
 * `Exec` gets the route under which every non-zero exit is a failure, so the
 * softer reading is never something a caller can fall into by omission.
 */
export function execRoute(exec: Exec): ExecRoute {
  return (exec as RoutedExec).route ?? 'native'
}

export interface SmokeResult {
  readonly name: string
  readonly path: string
  readonly kind: 'version' | 'exec' | 'unclaimed'
  readonly verdict: Verdict
  readonly message: string
  /**
   * The long form, printed below the table rather than in the row.
   *
   * Only `unclaimed` carries one: the measured reason the artifact has no
   * version contract. It is separate from `message` because a paragraph inside
   * a column destroys the table's one property -- twelve conclusions read at a
   * glance -- and buries the reason a check was not run.
   */
  readonly detail?: string
}

/**
 * A pin's file, relative to the repository root.
 *
 * NOT `basename`: four of the twelve read a `Cargo.toml`, and
 * `os/pkgs/mosd/mqttd/Cargo.toml` and `os/pkgs/mosd/broker/Cargo.toml` are different files with
 * the same last component, so a row saying "in Cargo.toml" would not tell a
 * reader which one to edit. Absolute paths carry a worktree prefix that differs
 * per checkout and turns every line into noise.
 */
export function pinSource(file: string): string {
  return file.startsWith(REPO_ROOT + '/') ? file.slice(REPO_ROOT.length + 1) : file
}

/**
 * Every version-shaped token on a line, by maximal munch.
 *
 * One tokeniser, not twelve parsers: the ten artifacts that answer print ten
 * different sentences, measured in the real x64 factory root --
 *
 *   rauc 1.13            podman version 5.8.6   5.8.6
 *   crun version 1.29.1  conmon version 2.2.1   netavark 2.1.0
 *   aardvark-dns 2.1.0   tini version 0.2.1_catatonit
 *   mos-mqttd 0.1.0      mos-mqtt-broker 0.1.0
 *
 * -- and a per-artifact regex fails open when upstream reflows one: no token
 * read looks like no mismatch. A value read from the pin file can only mismatch.
 */
export function versionTokens(line: string): string[] {
  // Maximal munch is the point, not an implementation detail: greedy
  // `[0-9]+(?:\.[0-9]+)+` takes the run of digits and dots whole, so the next
  // character cannot be a digit and `1.29.10` cannot satisfy a pin of `1.29.1`.
  // A right-hand `(?![.0-9])` is therefore redundant -- removing it changed no
  // test -- and it is harmful: on `crun version 1.29.1.` it rejects the greedy
  // match, backtracking finds nothing shorter, and the line yields no token at
  // all, which this runner reports as "reports NO version at all" and turns red
  // for a binary that printed the right version and ended with a full stop. The
  // left guard is load-bearing: without it a token can start in the middle of a
  // longer run, so `11.29.1` would offer `1.29.1` and a version-skewed binary
  // would report as agreeing with its pin.
  return [...line.matchAll(/(?<![.0-9])[0-9]+(?:\.[0-9]+)+/g)].map(m => m[0])
}

/**
 * The commit half of the version contract.
 *
 * `os/pkgs/mosd/hack/build-target.sh` writes the commit it handed the compiler into
 * `_out/mosd-build.txt`, build-v2.sh copies it to `_out/<board>/mosd-build.txt`,
 * `readMosdBuildFact` reads it back and `judge` compares the two; see
 * `BuildCommitFact`. The printed-only state is a branch, not a deletion: with no
 * record -- a hand-assembled `_out/` -- the runner says so on its own first lines
 * and the row says the commit was not asserted, and the reported line is carried
 * verbatim into every version verdict (`[said: ...]`) either way. One limit:
 * `mosd 0.1.0-rc.1 (abc1234)` yields the numeric head only, so a pre-release pin
 * and output go red naming both sides. Neither crate takes a pre-release version
 * today; if one does, `versionTokens` is where to look.
 */

/**
 * Whether a `--version` line reports exactly this commit.
 *
 * mosd and apid print `<name> <version> (<commit>)`; the commit half is compared
 * here rather than by `versionTokens`, which reads dotted numbers and would never
 * see a sha. A token match, not a substring, because of `-dirty`:
 * `line.includes('00b674e9a628')` is satisfied by `(00b674e9a628-dirty)`, so a
 * binary built from a modified worktree would report as agreeing with the clean
 * sha. `-` is in both the left `(?<![A-Za-z0-9-])` and the right
 * `(?![A-Za-z0-9-])` class on purpose; that is what makes `-dirty` a different
 * token rather than a suffix. An empty expectation matches nothing: a `RegExp('')`
 * would match every line and turn this into a check that cannot fail.
 */
export function reportsCommit(line: string, commit: string): boolean {
  if (commit === '') return false
  const literal = commit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9-])${literal}(?![A-Za-z0-9-])`).test(line)
}

/** The first non-empty line of stdout -- where all ten artifacts print it. */
export function firstLine(stdout: string): string {
  for (const line of stdout.split('\n')) {
    if (line.trim() !== '') return line.trim()
  }
  return ''
}

/**
 * What the build recorded about the commit it embedded, and where that came from.
 *
 * The expectation is a build fact, never `git rev-parse HEAD`: comparing the
 * reported sha against HEAD at run time passes on any freshly built tree and
 * asserts only that somebody had just rebuilt, never that the embedding works.
 * `os/pkgs/mosd/hack/build-target.sh` writes the commit it handed the compiler into
 * `_out/mosd-build.txt`, `os/rootfs/build-v2.sh` carries it into `_out/<board>/`
 * beside the factory root, and this is what the runner reads back. `commit` is
 * optional because the fact may genuinely not be there -- a hand-assembled
 * `_out/` -- and the rule there is to print it and assert nothing rather than to
 * refuse. `source` is printed either way, so a run that asserted nothing about
 * the commit says so out loud.
 */
export interface BuildCommitFact {
  /** The commit the build recorded embedding. Absent when none was recorded. */
  readonly commit?: string
  /** Where it came from, or why there is nothing. Always printed. */
  readonly source: string
}

/**
 * What a non-zero exit means, from the status and what came back with it.
 *
 * Measured against docker 29.7.2 in exactly the shape `dockerArgv` produces --
 * no shell, because the artifact IS the container's init, so a failure to exec
 * it surfaces as a `docker run` failure rather than as a shell's 126. The
 * `docker run` convention (127 not found, 126 cannot be invoked) gets the first
 * two of these wrong:
 *
 *   wrong-arch ELF          255  `exec <path>: exec format error`
 *   missing soname          127  `<path>: error while loading shared libraries:
 *     libselinux.so.1: cannot open shared object file`
 *   present, mode 000       126  `docker: ... exec: "<path>": permission denied.`
 *   path genuinely absent   127  `docker: ... exec: "<path>": stat <path>: no
 *     such file or directory.`
 *   program ran and refused      its own status
 *
 * `preflight` records the same `status 255` with `exec format error` for the
 * arm64 wall. Pure, so every branch is reachable from the suite; a fabricated
 * `ExecResult` lets a test pick the status it then asserts the diagnosis of, so
 * `os/verify/src/smoke-negative.ts` also drives the three negative cases through
 * a real container against a real mutated root.
 */
export function diagnose(outcome: ExecResult): string {
  // First, because a killed process's status is not its answer. `--version` is
  // milliseconds and the budget is a fuse, so reaching it says the host or the
  // binary stopped making progress; either way the number beside it is SIGKILL's
  // and naming it as one is what keeps the next reader from decoding 137.
  if (outcome.timedOutAfterMs !== undefined) {
    return `the watchdog killed it after ${outcome.timedOutAfterMs} ms -- this status is the SIGKILL `
      + 'the runner sent when its budget ran out, not the program\'s own answer'
  }
  // 127 is ambiguous and is split by text, not left to the status: ld.so exits
  // 127 after printing `error while loading shared libraries`, and docker exits
  // 127 when the path is not there at all. The fallback names both possibilities
  // rather than picking one.
  const said = `${outcome.stdout}\n${outcome.stderr}`
  if (/error while loading shared libraries/i.test(said)) {
    return 'the file is there and the dynamic loader could not resolve it -- a shared library it '
      + 'NEEDs is not in this root, so the binary never reached main'
  }
  if (/exec format error/i.test(said)) {
    return 'the file could not be executed AT ALL -- the kernel refused the image with ENOEXEC. '
      + 'A wrong-architecture binary is this, and so is a host with no emulator registered for '
      + 'the image\'s platform; `preflight` rules out the second before any artifact is judged, '
      + 'so at this point it is the binary'
  }
  if (outcome.status === 127) {
    return 'the path does not exist in the factory root -- either this register names it wrongly, '
      + 'or the install script stopped putting it there'
  }
  if (outcome.status === 126) {
    return 'the path exists and could not be invoked -- measured, this is what a file with no '
      + 'executable bit produces; the pack stage normalises modes, so a mode this runner cannot '
      + 'execute is a question about 90-pack rather than about the binary'
  }
  if (outcome.status === 255) {
    return 'the container could not be started on this path at all, and not for a reason named '
      + 'above -- read the stderr; `docker run` failing to exec its init reports 255'
  }
  return 'the program ran and refused'
}

/**
 * Whether this failure is the one the entry declared the EXECUTOR cannot avoid.
 *
 * Three conjuncts, all required, and each of them is what keeps this from
 * becoming a way for a red run to go green:
 *
 *   route     Only the emulated buildkit fallback. The native route runs the
 *             binary on this host's kernel, where nothing is being emulated and
 *             a non-zero exit is the artifact's own answer; softening it there
 *             would delete the check on the only host that can really run it.
 *   declared  Only an entry that carries an `executorLimit`. There is no global
 *             pattern: an entry that declares nothing can never reach this
 *             verdict, so the category cannot spread to a binary nobody
 *             measured, and adding a member is an edit to the register.
 *   exact     The status AND the stderr, both. `includes` on stderr and not on
 *             `stdout + stderr`, because the signature was measured on stderr
 *             and a binary that PRINTS that sentence on stdout while failing
 *             some other way is a different event.
 *
 * Exported so the suite can drive each conjunct from the failing side.
 */
export function executorLimitMatch(
  artifact: Artifact,
  outcome: ExecResult,
  route: ExecRoute,
): ExecutorLimit | undefined {
  const limit = artifact.executorLimit
  if (limit === undefined || route !== 'buildkit') return undefined
  if (outcome.status !== limit.status) return undefined
  return outcome.stderr.includes(limit.stderrIncludes) ? limit : undefined
}

/**
 * Decide one artifact from what its invocation actually did.
 *
 * Pure, so every branch is reachable from the suite with a fabricated
 * `ExecResult` -- including the two that a healthy tree can never produce.
 *
 * `build` is the recorded build fact ([`BuildCommitFact`]), consulted only for
 * an artifact whose register entry says it embeds a commit.
 *
 * `route` is which executor produced `outcome`, and it defaults to `native` --
 * the strict reading. It is consulted for one thing only: an entry that declared
 * an `executorLimit` and hit it exactly, under emulation, is `executor-limited`
 * rather than `fail`. See `executorLimitMatch` for why all three conjuncts are
 * required.
 */
export function judge(
  artifact: Artifact,
  pin: Pin,
  outcome: ExecResult,
  build?: BuildCommitFact,
  route: ExecRoute = 'native',
): SmokeResult {
  const { name, path, contract } = artifact
  const base = { name, path } as const

  if (contract.kind === 'unclaimed') {
    return {
      ...base,
      kind: 'unclaimed',
      verdict: 'unclaimed',
      message:
        `NOT EXECUTED, no version asserted. ${pinSource(pin.file)} pins ${pin.key}=${pin.recorded}, `
        + `so it would have to report ${pin.expected}; nothing asked it.`,
      detail: contract.why,
    }
  }

  if (outcome.status !== 0) {
    const limit = executorLimitMatch(artifact, outcome, route)
    if (limit !== undefined) {
      return {
        ...base,
        kind: contract.kind,
        verdict: 'executor-limited',
        message:
          `EXECUTED under the ${route} executor and exited ${outcome.status} the one way this `
          + `register entry declares this executor cannot avoid: ${limit.why}. `
          + `stderr=${JSON.stringify(firstLine(outcome.stderr))}. `
          + `Nothing was asserted about the version, and this is NOT a pass: on the native route the `
          + `same outcome is a FAIL, and any other status or stderr is a FAIL here too.`,
      }
    }
    return {
      ...base,
      kind: contract.kind,
      verdict: 'fail',
      message:
        `exited ${outcome.status}, expected 0 (${diagnose(outcome)}). `
        + `stdout=${JSON.stringify(firstLine(outcome.stdout))} `
        + `stderr=${JSON.stringify(firstLine(outcome.stderr))}`,
    }
  }

  if (contract.kind === 'exec') {
    return { ...base, kind: 'exec', verdict: 'pass', message: `executed, exit 0 (exec-only; no version asserted)` }
  }

  const line = firstLine(outcome.stdout)
  const tokens = versionTokens(line)
  if (tokens.includes(pin.expected)) {
    // `[said: ...]` stays on EVERY version row rather than
    // only the two that carry a commit: a runner that asserts a thing must
    // still show what it read, and the rows that assert no commit are exactly
    // the ones where the printed line is the only record of one.
    const version =
      `exit 0, reports ${pin.expected} == ${pin.key}=${pin.recorded} in ${pinSource(pin.file)} `
      + `[said: ${JSON.stringify(line)}]`
    // The second half, for the two artifacts that carry a build commit. It is
    // asserted only against a recorded build fact, never against the working
    // tree's HEAD -- see BuildCommitFact.
    if (artifact.embedsBuildCommit !== true) {
      return { ...base, kind: 'version', verdict: 'pass', message: version }
    }
    const recorded = build?.commit
    if (recorded === undefined || recorded === '') {
      return {
        ...base,
        kind: 'version',
        verdict: 'pass',
        message:
          `${version}. Its commit was NOT asserted: `
          + `${build?.source ?? 'no build record was supplied to this run'}.`,
      }
    }
    if (reportsCommit(line, recorded)) {
      return {
        ...base,
        kind: 'version',
        verdict: 'pass',
        message: `${version}, and reports the commit ${recorded} that ${build!.source} records this build embedding`,
      }
    }
    return {
      ...base,
      kind: 'version',
      verdict: 'fail',
      message:
        `exit 0 and the pinned version, but its --version line ${JSON.stringify(line)} does not report `
        + `the commit ${recorded} that ${build!.source} records this build embedding. Either the commit `
        + `never reached the compiler -- MOS_BUILD_COMMIT not passed in, in which case the binary says `
        + `"unknown" -- or this artifact is not from the build that record describes. A "-dirty" suffix `
        + `on one side and not the other lands here too, and deliberately: a binary built from a `
        + `modified worktree is not the commit it names.`,
    }
  }
  return {
    ...base,
    kind: 'version',
    verdict: 'fail',
    message:
      `exit 0 but reports ${tokens.length === 0 ? 'NO version at all' : tokens.join(', ')}, `
      + `and ${pinSource(pin.file)} pins ${pin.key}=${pin.recorded} (expected ${pin.expected}). `
      + `Its --version line was ${JSON.stringify(line)}. `
      + `Either the pin was bumped without rebuilding the artifact, or the artifact was built `
      + `from something other than the pin.`,
  }
}

/** Run one artifact, or decline to. */
export async function checkArtifact(
  artifact: Artifact,
  exec: Exec,
  build?: BuildCommitFact,
  route: ExecRoute = 'native',
): Promise<SmokeResult> {
  const pin = artifact.pin()
  if (artifact.contract.kind === 'unclaimed') {
    // Not invoked, and that is a decision rather than an omission. mosd's only
    // invocation provisions a device and apid's never returns; running them to
    // produce a `fail` would trade a clear "nobody asked" for a 25-second hang
    // and a mutated /var, and would report the artifact as broken when what is
    // missing is the question.
    return judge(artifact, pin, { status: 0, stdout: '', stderr: '' }, build, route)
  }
  return judge(artifact, pin, await exec([artifact.path, ...artifact.contract.argv]), build, route)
}

export interface Conclusion {
  readonly conclusion: 'PASS' | 'FAIL' | 'INCOMPLETE'
  readonly exitCode: number
  readonly counts: {
    readonly pass: number
    readonly fail: number
    readonly unclaimed: number
    /** Decided, exit 0, and NOT a pass -- see `executorLimitMatch`. Printed even when zero. */
    readonly executorLimited: number
    readonly total: number
  }
  readonly line: string
}

/**
 * The run's verdict, and the vacuity guard that makes it evidence.
 *
 * `expected` is the register's size, and a run that concluded a different
 * number of things is a failure whatever those conclusions were. Without it a
 * runner that threw away half its work would print `RESULT: PASS (6/6)` and
 * look exactly like one that checked everything -- the same shape as the shell
 * lint that reported `RESULT: PASS (0/0 checks)` because its counters died in a
 * subshell, and as `os/verify/run.sh`'s own `Ran 0 tests` guard.
 */
export function conclude(results: readonly SmokeResult[], expected: number): Conclusion {
  const counts = {
    pass: results.filter(r => r.verdict === 'pass').length,
    fail: results.filter(r => r.verdict === 'fail').length,
    unclaimed: results.filter(r => r.verdict === 'unclaimed').length,
    executorLimited: results.filter(r => r.verdict === 'executor-limited').length,
    total: results.length,
  }

  // One spelling of the counts for all three conclusions, built once. Until the
  // executor-limited verdict arrived the three lines carried three copies of the
  // same four numbers with the FAIL and INCOMPLETE ones hard-coding `0 fail`
  // where they knew it; a fifth number added to two of three copies is exactly
  // how a reader ends up translating between two summaries. Every number is
  // printed on every line, zero as zero: an unstated count is a count a reader
  // assumes, and `1 executor-limited` on a green line is the whole point of the
  // verdict -- a run that softened one conclusion must say how many.
  const summary =
    `${counts.pass} pass, ${counts.executorLimited} executor-limited, ${counts.fail} fail, `
    + `${counts.unclaimed} unclaimed, of ${counts.total}`

  // The names, not just the number: "2 unclaimed" is a count a reader stops
  // seeing, and "mosd, apid" is something they can act on. This run's steady
  // state is non-zero, so the names go on the RESULT line itself and not only
  // in the table above it.
  const named = (verdict: Verdict): string =>
    results.filter(r => r.verdict === verdict).map(r => r.name).join(', ')
  // The same argument the UNCLAIMED clause makes, for the same reason: the
  // count says how much was softened, the names say what. Absent when there is
  // nothing to name, so a clean run does not carry an empty clause.
  const limited = counts.executorLimited > 0 ? ` EXECUTOR-LIMITED: ${named('executor-limited')}.` : ''
  if (expected <= 0 || counts.total !== expected) {
    return {
      conclusion: 'FAIL',
      exitCode: 1,
      counts,
      line:
        `RESULT: FAIL (${counts.total} conclusions from a register of ${expected}). `
        + `A smoke run that reached a different number of artifacts than it was asked to reach has `
        + `not measured what its counts say it measured, and ${expected <= 0 ? 'an EMPTY register concludes nothing at all while exiting 0' : 'the missing ones are invisible in a green summary'}.`,
    }
  }
  if (counts.fail > 0) {
    return {
      conclusion: 'FAIL',
      exitCode: 1,
      counts,
      line:
        `RESULT: FAIL (${summary}). `
        + `FAILED: ${named('fail')}.`
        + (counts.unclaimed > 0 ? ` UNCLAIMED: ${named('unclaimed')}.` : '')
        + limited,
    }
  }
  if (counts.unclaimed > 0) {
    return {
      conclusion: 'INCOMPLETE',
      exitCode: 1,
      counts,
      line:
        `RESULT: INCOMPLETE (${summary}).${limited} `
        + `UNCLAIMED: ${named('unclaimed')}. `
        + `Nothing failed and not everything was asked. An unclaimed artifact is not a pass and is `
        + `not a skip: the smoke contract requires a reported version from every one of them, and this run `
        + `exits non-zero so that a gate cannot be held by a summary with holes in it.`,
    }
  }
  return {
    conclusion: 'PASS',
    exitCode: 0,
    counts,
    // The same numbers FAIL and INCOMPLETE print, in the same order, from the
    // same string: a second spelling on the green line would make a reader
    // translate between it and the red one, and `0 unclaimed` and
    // `0 executor-limited` are exactly the numbers that would go unstated on the
    // line that matters most.
    line: `RESULT: PASS (${summary})${limited}`,
  }
}

// The image, and the one place that decides how a binary is executed.

/** What `_out/<board>/factory-root.txt` says the archive beside it is. */
export interface FactoryRootRecord {
  readonly ref: string
  readonly platform: string
  readonly archive: string
  readonly sha256: string
  readonly bytes: number
}

/** `_out/<board>` -- the same seam `checks.ts` draws, and for the same reason. */
export function outDir(board: string): string {
  return join(REPO_ROOT, '_out', board)
}

/**
 * Read a `key<TAB>value` record as data.
 *
 * Tab-separated, exactly as `ociRecord` in os/build/src/stages.ts writes it and
 * as `os/pkgs/mosd/hack/build-target.sh` writes `_out/mosd-build.txt`, parsed rather
 * than sourced. Comment lines are skipped by having no tab, which is why
 * `# Load it with: docker load -i ...` cannot become a key -- a reader that
 * split on whitespace would have made one. One reader for both records, because
 * two parsers for one file format agree right up until a value or a comment
 * acquires a tab; the same argument smoke-pins.ts makes about not writing a
 * second `versions.env` parser.
 */
export function parseTabRecord(text: string): Map<string, string> {
  const kv = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    kv.set(line.slice(0, tab).trim(), line.slice(tab + 1).trim())
  }
  return kv
}

export function parseFactoryRootRecord(text: string, path: string): FactoryRootRecord {
  const kv = parseTabRecord(text)
  const need = (k: string): string => {
    const v = kv.get(k)
    if (v === undefined || v === '') {
      throw new Error(
        `${path} carries no ${k}. It is written by os/build/src/stages.ts's ociRecord beside the `
        + `archive it describes; a record missing a field was produced by something else, and the `
        + `smoke run would then be executing an image nobody in this tree named.`,
      )
    }
    return v
  }
  const bytes = Number(need('bytes'))
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(`${path} says bytes=${kv.get('bytes')}, which is not a positive integer.`)
  }
  return { ref: need('ref'), platform: need('platform'), archive: need('archive'), sha256: need('sha256'), bytes }
}

/**
 * Where the two files live for a board.
 *
 * `dir` is a parameter for `shippedBoards(dir)`'s reason: the refusal below has
 * to be reachable from a test, and a guard that can only fire on a host that has
 * never built an image is green here and red there for reasons that have nothing
 * to do with the code.
 */
export function factoryRootPaths(
  board: string,
  dir: string = outDir(board),
): { readonly record: string; readonly archive: string } {
  return { record: join(dir, 'factory-root.txt'), archive: join(dir, 'factory-root.oci') }
}

/**
 * Read the record, refusing loudly when the build has not been run.
 *
 * A missing image is a refusal, not a skip. `make os-verify-cx3576-v2` on a tree
 * with no image refuses before running a single check, and that is the behaviour
 * to copy: a runner that skipped when it found nothing to smoke would report the
 * same green on a tree that had never built an image as on one whose artifacts
 * all passed.
 */
export function readFactoryRoot(
  board: string,
  dir: string = outDir(board),
): FactoryRootRecord & { readonly archivePath: string } {
  const { record, archive } = factoryRootPaths(board, dir)
  if (!existsSync(record) || !existsSync(archive)) {
    throw new Error(
      `${board}: ${existsSync(record) ? archive : record} does not exist.\n`
      + `       The smoke run executes the self-built binaries INSIDE the packed root, and that root\n`
      + `       is exported by os/rootfs/stages/90-pack.Dockerfile's \`factory-root\` target. Build it\n`
      + `       with: MOS_BOARD=${board} bash os/rootfs/build-v2.sh\n`
      + `       This refuses rather than skipping: a skip reports the same green as a pass, and an\n`
      + `       image that ships its binaries unexecuted is exactly what this check exists to end.`,
    )
  }
  const parsed = parseFactoryRootRecord(readFileSync(record, 'utf8'), record)
  return { ...parsed, archivePath: archive }
}

/** `_out/<board>/rootfs-stages.txt` -- what the driver recorded about the build. */
export const STAGE_MANIFEST_NAME = 'rootfs-stages.txt'

/** `_out/<board>/mosd-build.txt` -- the commit this board's mosd and apid carry. */
export const MOSD_BUILD_RECORD_NAME = 'mosd-build.txt'

/**
 * The commit the mosd and apid in this board's factory root were built from.
 *
 * Read out of the record `os/pkgs/mosd/hack/build-target.sh` wrote and
 * `os/rootfs/build-v2.sh` copied in beside the image -- NOT out of the working
 * tree. See [`BuildCommitFact`]. Absent is not a refusal here, unlike the
 * factory root itself: the record is younger than images that may still be
 * sitting in `_out/`, so a fact the runner cannot see is printed and asserted
 * about nothing. A root built by os/rootfs/build-v2.sh always has it, and when
 * mosd is declined that script removes it -- but then `declinedFeatures` refuses
 * the run first. A record that exists and cannot be read IS a refusal: a file
 * with no `commit` key was written by something other than build-target.sh, and
 * reading that as "nothing recorded" would switch the assertion off silently.
 */
export function readMosdBuildFact(board: string, dir: string = outDir(board)): BuildCommitFact {
  const path = join(dir, MOSD_BUILD_RECORD_NAME)
  const shown = pinSource(path)
  if (!existsSync(path)) {
    return {
      source:
        `${shown} does not exist, so no commit was recorded for this image. It is written by `
        + `os/pkgs/mosd/hack/build-target.sh on every build and copied here by os/rootfs/build-v2.sh; `
        + `rebuild the board to have the commit asserted rather than printed`,
    }
  }
  const kv = parseTabRecord(readFileSync(path, 'utf8'))
  const commit = kv.get('commit')
  if (commit === undefined) {
    throw new Error(
      `${path} carries no \`commit\` field. os/pkgs/mosd/hack/build-target.sh writes one on every build -- `
      + `empty when it could not resolve a commit -- so a record without the key was written by `
      + `something else. Reading that as "nothing was recorded" would switch off the commit half of `
      + `mosd's and apid's version check without saying so.`,
    )
  }
  if (commit === '') {
    return {
      source:
        `${shown} records an EMPTY commit: the build could not resolve one, so mosd and apid report `
        + `"unknown" and there is nothing to compare that against`,
    }
  }
  return { commit, source: shown }
}

/**
 * The feature stages the build was told to leave OUT, read off its own manifest.
 *
 * The register covers a full-featured root: twelve artifacts, of which seven
 * arrive with stages/31-feature-containers, one with 32-feature-rauc and four
 * with 33-feature-mosd. Those stages are optional -- `WITH_CONTAINERS=0` in a
 * board's containers.env, or `MOS_ROOTFS_WITHOUT`, leaves them out -- and every
 * artifact of a declined feature then answers rc=127, so the run would print
 * seven failures about binaries when what happened is one decision about one
 * stage. It refuses rather than modelling that: a fourth verdict for a declined
 * artifact would put a skip into a runner whose whole purpose is that nothing is
 * skipped. Both shipped boards decline nothing today (x64 has no containers.env;
 * cx3576's says `WITH_CONTAINERS=1`), so the guard reads the manifest.
 */
export function declinedFeatures(text: string): string[] {
  for (const line of text.split('\n')) {
    const m = /^#\s*declined:\s*(.*)$/.exec(line)
    if (m === null) continue
    const body = m[1]!.trim()
    // `# declined: (none -- every feature stage in the directory was built)`.
    // The parenthesis is the driver's way of saying "asked for, and nothing was
    // declined" as opposed to "nobody wrote it down"; stageManifest's own
    // comment says why both statements exist and why they must not look alike.
    if (body === '' || body.startsWith('(')) return []
    return body.split(/\s+/).filter(f => f !== '')
  }
  throw new Error(
    `the stage manifest carries no \`# declined:\` line. os/build/src/stages.ts's stageManifest `
    + `writes one on every build, naming the feature stages left out -- or saying in parentheses `
    + `that none were. A manifest without it was written by something else, and the smoke run `
    + `cannot tell a full-featured root from one built without its container engine.`,
  )
}

/**
 * Run one program with a budget, and hand back everything it did.
 *
 * Exported so `src/smoke-negative.ts` drives `docker build`
 * through the same seam the runner drives `docker run` through -- a second
 * spawn helper would be a second set of decisions about timeouts and about what
 * counts as output, agreeing with this one until one of them was edited.
 */
export async function capture(argv: readonly string[], timeoutMs: number): Promise<ExecResult> {
  const proc = Bun.spawn(argv as string[], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  // A budget, not a courtesy. `apid --version` starts an HTTPS server and never
  // returns -- measured, rc=124 against 25s -- so an unbounded wait here is a
  // smoke run that hangs instead of concluding. The shipped register does not
  // invoke apid, but a register entry added later could, and a harness whose
  // worst case is "forever" cannot be put in front of a build.
  let watchdogFired = false
  const timer = setTimeout(() => {
    watchdogFired = true
    proc.kill('SIGKILL')
  }, timeoutMs)
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    // Recorded only when the kill is what decided the status. The timer and the
    // process can land in the same tick, and a program that had already exited 0
    // when the signal arrived did its work -- calling that a timeout would be the
    // same false alarm this field exists to end, from the other side.
    if (watchdogFired && status !== 0) return { status, stdout, stderr, timedOutAfterMs: timeoutMs }
    return { status, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

/** How long any one invocation may take. `--version` is milliseconds; this is a fuse. */
export const EXEC_TIMEOUT_MS = 30_000

/**
 * What `docker load` gets, as a function of what it has to ingest.
 *
 * A constant is the wrong SHAPE for this budget, which is why raising the 30s
 * one would have been the same defect postponed: what a load costs is the bytes
 * it reads, and `factory-root.txt` already records how many that is. Measured on
 * this host (docker 29.7.2, containerd image store) against a 250,083,328-byte
 * OCI archive: 20.3s the first time, 4.3s once the layers are already
 * content-addressed -- 12.3 MB/s, on an idle host. The 30s constant was 1.5x
 * that idle cost, and the campaign that reads this runs three builds at once; a
 * sibling's load was killed at 30s with docker's `Loaded image:` line already in
 * its output.
 *
 * 1 MB/s is that measurement divided by twelve -- the order of magnitude a
 * loaded host actually costs -- and, being a rate, it SCALES: a root that grows
 * to 1 GB gets four times the budget instead of re-acquiring this defect on the
 * day it grows. The floor covers the part that is not bytes (daemon round
 * trips, an archive small enough that the rate alone would give it
 * milliseconds). For the shipped 250 MB root the two come to ~310s, the same
 * order as BUILDKIT_EXEC_TIMEOUT_MS: a fuse against `forever`, not a deadline
 * anyone is expected to meet.
 */
export const LOAD_TIMEOUT_FLOOR_MS = 60_000
/** One millisecond of budget per this many bytes of archive -- 1 MB/s. */
export const LOAD_TIMEOUT_BYTES_PER_MS = 1_000

export function loadTimeoutMs(bytes: number): number {
  return LOAD_TIMEOUT_FLOOR_MS + Math.ceil(bytes / LOAD_TIMEOUT_BYTES_PER_MS)
}

const OCI_MANIFEST_MEDIA_TYPE = 'application/vnd.oci.image.manifest.v1+json'

/** `linux/arm64/v8` and `linux/arm64` are one platform for this comparison. */
function platformKey(platform: string): string {
  return platform.split('/').slice(0, 2).join('/')
}

/**
 * The manifest digest the archive's own index names for this platform.
 *
 * Counted rather than searched: the message says how many manifests the index
 * carries, how many of those are images and how many of THOSE are for the
 * platform the record claims, because "found one" and "found the only one"
 * differ exactly when a producer starts attaching attestations. os/build/src/stages.ts
 * exports with `--provenance=false --sbom=false`, so today that count is 1.
 */
export function parseArchiveIndex(text: string, platform: string, path: string): string {
  const index = JSON.parse(text) as {
    manifests?: readonly { mediaType?: string; digest?: string; platform?: { os?: string; architecture?: string } }[]
  }
  const manifests = index.manifests ?? []
  const images = manifests.filter(m => m.mediaType === OCI_MANIFEST_MEDIA_TYPE)
  const wanted = images.filter(m =>
    m.platform === undefined || platformKey(`${m.platform.os}/${m.platform.architecture}`) === platformKey(platform))
  const digest = wanted.length === 1 ? wanted[0]!.digest : undefined
  if (digest === undefined || digest === '') {
    throw new Error(
      `${path} lists ${manifests.length} manifest(s), ${images.length} of them images and ${wanted.length} `
      + `of those for ${platform}; exactly one is needed to say which image this archive IS.`,
    )
  }
  return digest
}

/** The config digest the manifest names -- the other thing a daemon may call the image. */
export function parseArchiveManifest(text: string, path: string): string {
  const manifest = JSON.parse(text) as { config?: { digest?: string } }
  const digest = manifest.config?.digest
  if (digest === undefined || digest === '') {
    throw new Error(`${path} names no config digest, so the archive does not say what image it carries.`)
  }
  return digest
}

/** `sha256:abc...` -> `blobs/sha256/abc...`, the member an OCI layout tar carries it as. */
export function blobMember(digest: string): string {
  const sep = digest.indexOf(':')
  if (sep <= 0 || sep === digest.length - 1) {
    throw new Error(`'${digest}' is not an <algorithm>:<hex> digest, so no blob in the archive answers to it.`)
  }
  return `blobs/${digest.slice(0, sep)}/${digest.slice(sep + 1)}`
}

/**
 * The digests a daemon may know this archive's image by, read out of the
 * ARCHIVE and not out of the daemon.
 *
 * Two of them, because the two image stores disagree about what an image ID is:
 * with the containerd store (docker 29's default, measured here) `docker image
 * inspect --format {{.Id}}` answers the MANIFEST digest, and with the classic
 * store it answers the CONFIG digest. Both are computed from bytes this
 * worktree wrote, so neither can be made to name another worktree's root by a
 * tag moving underneath this run.
 *
 * It costs nothing next to the load it follows: tar seeks a regular file rather
 * than reading it, measured at 4 ms to pull index.json out of the end of a
 * 250 MB archive.
 */
export async function archiveImageDigests(
  record: FactoryRootRecord & { readonly archivePath: string },
  run: (argv: readonly string[], timeoutMs: number) => Promise<ExecResult> = capture,
): Promise<readonly string[]> {
  const member = async (name: string): Promise<string> => {
    const r = await run(['tar', '-xOf', record.archivePath, name], EXEC_TIMEOUT_MS)
    if (r.status !== 0) {
      throw new Error(`tar could not read ${name} out of ${record.archivePath}: exited ${r.status} ${r.stderr.trim()}`)
    }
    return r.stdout
  }
  const manifest = parseArchiveIndex(await member('index.json'), record.platform, `${record.archivePath}:index.json`)
  const config = parseArchiveManifest(await member(blobMember(manifest)), `${record.archivePath}:${manifest}`)
  return [manifest, config]
}

/** The image the run will address, and what that identity was taken from. */
export interface LoadedFactoryRoot {
  /** The name the archive carries. For messages; nothing is addressed by it. */
  readonly ref: string
  /** The image ID every `docker run` of this smoke run uses. */
  readonly id: string
  /** `content`: the daemon was asked for the archive's own digest. `tag`: it was not able to answer that. */
  readonly source: 'content' | 'tag'
}

/** The daemon's ID for a reference, or undefined if it holds no such image. */
async function inspectId(
  reference: string,
  run: (argv: readonly string[], timeoutMs: number) => Promise<ExecResult>,
): Promise<string | undefined> {
  const r = await run(['docker', 'image', 'inspect', '--format', '{{.Id}}', reference], EXEC_TIMEOUT_MS)
  const id = r.stdout.trim()
  return r.status === 0 && id !== '' ? id : undefined
}

/**
 * Load the archive, every run, and hand back the IMAGE -- not the tag.
 *
 * Load rather than trust a tag. A tag is daemon state: it says what is currently
 * loaded, and `localhost/mos-factory-root:x64` may name a root some other
 * worktree on this host built an hour ago. `os/rootfs/build-v2.sh` guards the
 * same seam from the other side -- "a stale or absent archive would be handed to
 * the smoke runner as this build's root". Loading is idempotent and costs ~2s on
 * the real 250 MB export because the layers are already content-addressed.
 *
 * Loading is not enough, though, and that is the second thing this does. The tag
 * stays daemon-global for as long as the run lasts, and this campaign has two
 * and three worktrees loading `:x64` at once; a sibling's load between this
 * function and the first `docker run` would hand the register somebody else's
 * root and produce a full page of verdicts about it. So the return value is the
 * daemon's ID for the digest the ARCHIVE names, and every later invocation
 * addresses that: an ID is content, and a tag moving cannot follow it.
 *
 * The fallback to the tag exists so this is never WORSE than what it replaced.
 * The two known image stores are covered by the two digests, and a store that
 * names images a third way would otherwise turn every smoke run on that host
 * into a refusal about the runner. It says which of the two happened, because
 * "resolved by content" and "resolved through a global tag" are different
 * statements about how much this run's verdicts can be trusted.
 *
 * `run` takes the budget per call: the load's is a function of the archive
 * (`loadTimeoutMs`), and the inspects beside it are the ordinary fuse.
 */
export async function loadFactoryRoot(
  record: FactoryRootRecord & { readonly archivePath: string },
  run: (argv: readonly string[], timeoutMs: number) => Promise<ExecResult> = capture,
  log: (line: string) => void = () => {},
): Promise<LoadedFactoryRoot> {
  const loaded = await run(['docker', 'load', '-i', record.archivePath], loadTimeoutMs(record.bytes))

  // A load that failed on its own says so and stops here, unchanged. A load the
  // WATCHDOG ended is a different claim -- it says the runner ran out of
  // patience, which is not evidence that the work was not done -- and is
  // answered below by asking the daemon what it holds.
  if (loaded.status !== 0 && loaded.timedOutAfterMs === undefined) {
    throw new Error(
      `docker load -i ${record.archivePath} exited ${loaded.status}: ${loaded.stderr.trim() || loaded.stdout.trim()}`,
    )
  }

  let digests: readonly string[] = []
  try {
    digests = await archiveImageDigests(record, run)
  } catch (e) {
    log(
      `os/verify smoke: ${record.archive} does not say which image it carries `
      + `(${String((e as Error).message ?? e)})`,
    )
  }
  let id: string | undefined
  for (const digest of digests) {
    id = await inspectId(digest, run)
    if (id !== undefined) break
  }

  if (loaded.timedOutAfterMs !== undefined) {
    // The killed-but-done case, which is the one that failed a healthy build.
    // What matters is not whether the process lived to exit 0 but whether the
    // daemon holds the image the archive describes, and that is a question about
    // content: the digest came out of this worktree's own file. Answered from
    // the tag it would be worthless -- a stale `:x64` from an hour ago answers
    // it just as well.
    if (id !== undefined) {
      log(
        `os/verify smoke: the watchdog killed \`docker load -i ${record.archivePath}\` after `
        + `${loaded.timedOutAfterMs} ms, and the daemon nevertheless holds ${id}, the image this `
        + `archive describes by digest. The kill decided nothing; continuing with that image.`,
      )
      return { ref: record.ref, id, source: 'content' }
    }
    throw new Error(
      `the watchdog killed \`docker load -i ${record.archivePath}\` after ${loaded.timedOutAfterMs} ms, `
      + `and the daemon does not hold the image the archive describes, so there is nothing to execute.\n`
      + `       It said: ${loaded.stderr.trim() || loaded.stdout.trim() || '(nothing)'}\n`
      + `       The budget is ${LOAD_TIMEOUT_FLOOR_MS} ms plus one per ${LOAD_TIMEOUT_BYTES_PER_MS} bytes `
      + `of the recorded ${record.bytes}-byte archive, so a load that exceeds it is not a big archive but `
      + `a stalled one: look at the host before re-running.`,
    )
  }

  if (id !== undefined) return { ref: record.ref, id, source: 'content' }

  const tagged = await inspectId(record.ref, run)
  if (tagged === undefined) {
    throw new Error(
      `docker load -i ${record.archivePath} exited 0 and the daemon then had no image at ${record.ref}, `
      + `nor at either digest the archive names (${digests.join(', ') || 'none could be read'}).`,
    )
  }
  log(
    `os/verify smoke: ${record.ref} resolved through the TAG to ${tagged}; this daemon answers to `
    + `neither digest the archive names, so this run cannot prove the image is the one it loaded.`,
  )
  return { ref: record.ref, id: tagged, source: 'tag' }
}

/**
 * The positive control, run before anything is concluded about any artifact.
 *
 * `/bin/true` is coreutils' and the packed root keeps coreutils by decision
 * (90-pack.Dockerfile says why). If it does not exit 0, NOTHING in this image can
 * be executed here, and all twelve would come back `fail` about the artifact --
 * twelve wrong diagnoses of one condition. This is where the arm64 wall is
 * caught: on a host with no binfmt_misc, `docker run` of an arm64 image answers
 * `exec /bin/true: exec format error` with status 255, measured on this host
 * against a pulled upstream arm64v8/busybox, so the measurement is about the host
 * and not our export. Refusing here, naming the platform and the remedy, is the
 * same shape as `os-verify-cx3576-v2` refusing on a tree with no image.
 */
export async function preflight(exec: Exec, platform: string): Promise<void> {
  const r = await exec(['/bin/true'])
  if (r.status === 0) return
  const formatError = /exec format error/i.test(r.stderr + r.stdout)
  throw new Error(
    `the factory root cannot execute anything on this host: /bin/true exited ${r.status}.\n`
    + `       ${r.stderr.trim() || r.stdout.trim()}\n`
    + (formatError
      ? `       The image declares ${platform} and this host cannot run it. Register the emulator --\n`
      + `         docker run --privileged --rm tonistiigi/binfmt --install <arch>\n`
      + `       -- and re-run. Producing this image needs no emulation (90-pack's factory-root stage\n`
      + `       is FROM scratch and executes nothing); EXECUTING what is in it does, which is the\n`
      + `       whole of what this runner does.\n`
      : '')
    + `       Refused here rather than per artifact: without this control every one of the register's\n`
    + `       entries would come back failed, and twelve failures about twelve binaries would be\n`
    + `       twelve wrong diagnoses of one condition.`,
  )
}

/**
 * The exact command one invocation becomes.
 *
 * Separated from `dockerExec` so the suite can assert the argv without a daemon:
 * `--network none` and `--rm` are decisions, and a decision that only exists
 * inside a function nothing can observe is one nobody can check has survived an
 * edit.
 */
export function dockerArgv(ref: string, argv: readonly string[]): string[] {
  return [
    'docker',
    'run',
    '--rm',
    // No network. `podman --version` needs none, and a smoke runner that could
    // reach a registry is one whose result could depend on a registry. It also
    // keeps apid-shaped binaries -- anything that binds a port -- off the host's
    // network if a later register entry runs one.
    '--network',
    'none',
    ref,
    ...argv,
  ]
}

/** The real seam: one container per invocation, inside the loaded factory root. */
export function dockerExec(ref: string, timeoutMs: number = EXEC_TIMEOUT_MS): RoutedExec {
  // Tagged `native`: this runs on the host's own kernel, so a non-zero exit is
  // the binary's answer and nothing here is emulated. See `RoutedExec`.
  return Object.assign((argv: readonly string[]) => capture(dockerArgv(ref, argv), timeoutMs), { route: 'native' as const })
}

// The buildkit executor. Same seam, same register, same judging: only the
// thing that runs the binary changes. A docker-container builder bundles its
// own emulators, so a host whose daemon cannot execute the factory root's
// platform can still execute every artifact inside it -- each run is one
// throwaway build whose RUN is the argv and whose output is the three files
// `judge` reads. It is slower than `docker run` by the cost of a build per
// artifact, which is why it is the fallback and not the default.

export interface BuildkitExecOptions {
  /** The factory root's reference, as the archive's index names it. */
  readonly ref: string
  /** The archive extracted as an OCI layout directory. */
  readonly layout: string
  /** A buildx builder that can execute `platform`. */
  readonly builder: string
  readonly platform: string
  /** Where each run's Dockerfile and output go. Default: <repo>/tmp/. */
  readonly scratch?: string
  readonly timeoutMs?: number
}

/**
 * A build imports the layout on its first run and executes under emulation on
 * every run; the docker route's thirty seconds is not the right figure.
 */
export const BUILDKIT_EXEC_TIMEOUT_MS = 300_000

function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`
}

/**
 * The throwaway Dockerfile: run the argv in the root, off the network, and
 * carry its status, stdout and stderr out as three files. The RUN's own
 * status is the `echo`'s, so a failing artifact is a file that says so and
 * not a build that failed -- a build failure is reserved for the case the
 * root cannot execute anything, which `preflight` reads as such.
 */
export function buildkitDockerfile(ref: string, argv: readonly string[]): string {
  return [
    `FROM ${ref} AS run`,
    `RUN --network=none mkdir -p /mos-smoke && ( ${argv.map(shellQuote).join(' ')} ) >/mos-smoke/stdout 2>/mos-smoke/stderr; echo $? >/mos-smoke/status`,
    'FROM scratch',
    'COPY --from=run /mos-smoke/ /',
    '',
  ].join('\n')
}

export function buildkitArgv(opts: BuildkitExecOptions, dockerfileDir: string, outDir: string): string[] {
  return [
    'docker',
    'buildx',
    'build',
    '--builder',
    opts.builder,
    '--platform',
    opts.platform,
    '--build-context',
    `${opts.ref}=oci-layout://${opts.layout}`,
    // Every run executes: a cached RUN would be a smoke test that ran once.
    '--no-cache',
    '--progress=plain',
    '--output',
    `type=local,dest=${outDir}`,
    dockerfileDir,
  ]
}

export function buildkitExec(
  opts: BuildkitExecOptions,
  run: (argv: readonly string[]) => Promise<ExecResult> = argv =>
    capture(argv, opts.timeoutMs ?? BUILDKIT_EXEC_TIMEOUT_MS),
): RoutedExec {
  const scratch = opts.scratch ?? join(REPO_ROOT, 'tmp')
  // Tagged `buildkit`: every instruction inside this builder runs under
  // qemu-user, which is the fact `judge` needs to read an artifact's declared
  // executor limitation. See `RoutedExec`.
  return Object.assign(async (argv: readonly string[]) => {
    mkdirSync(scratch, { recursive: true })
    const dir = mkdtempSync(join(scratch, 'smoke-buildkit-'))
    try {
      const dockerfileDir = join(dir, 'df')
      const outDir = join(dir, 'out')
      mkdirSync(dockerfileDir)
      await Bun.write(join(dockerfileDir, 'Dockerfile'), buildkitDockerfile(opts.ref, argv))
      const built = await run(buildkitArgv(opts, dockerfileDir, outDir))
      const statusFile = join(outDir, 'status')
      if (built.status !== 0 || !existsSync(statusFile)) {
        // The convention `diagnose` reads: 255 with the stderr is "the
        // executor could not run this at all", which for a build is the
        // truth -- the root did not get as far as the argv.
        return { status: 255, stdout: built.stdout, stderr: built.stderr }
      }
      const status = Number.parseInt(readFileSync(statusFile, 'utf8').trim(), 10)
      return {
        status: Number.isNaN(status) ? 255 : status,
        stdout: readFileSync(join(outDir, 'stdout'), 'utf8'),
        stderr: readFileSync(join(outDir, 'stderr'), 'utf8'),
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, { route: 'buildkit' as const })
}

/** `mos-<arch>` -- the container builder os/rootfs/build-v2.sh and the package builds create for a cross build. */
export function containerBuilderFor(platform: string): string {
  return `mos-${platform.split('/')[1] ?? platform}`
}

async function builderExists(name: string): Promise<boolean> {
  const r = await capture(['docker', 'buildx', 'inspect', name], EXEC_TIMEOUT_MS)
  return r.status === 0
}

/** Extract the factory-root archive (an OCI tar) into a layout directory buildx can take as a context. */
export async function extractLayout(archive: string, dir: string): Promise<string> {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const r = await capture(['tar', '-x', '-C', dir, '-f', archive], EXEC_TIMEOUT_MS)
  if (r.status !== 0 || !existsSync(join(dir, 'index.json'))) {
    throw new Error(`could not extract ${archive} into an OCI layout at ${dir}: ${r.stderr.trim() || `tar exited ${r.status}`}`)
  }
  return dir
}

export interface SmokeRunOptions {
  readonly board: string
  readonly artifacts?: readonly Artifact[]
  /**
   * Which `versions.env` files coverage is checked against.
   *
   * A parameter for the same reason `artifacts` is: a suite that drove a
   * two-artifact register against the shipped pin files would get ten coverage
   * faults about artifacts it was not testing, and the only way out would be to
   * weaken the coverage check for everybody.
   */
  readonly files?: readonly string[]
  /**
   * Which artifacts are authorised to be `unclaimed`.
   *
   * A parameter for the same reason `artifacts` and `files` are: the refusal
   * has to be reachable from a test, and a guard that can only fire when the
   * shipped register is wrong is a guard nobody has ever run.
   */
  readonly allowUnclaimed?: readonly string[]
  /** Supplied by the suite; the CLI builds a dockerExec. */
  readonly exec?: Exec
  /**
   * The recorded build commit, for the artifacts that embed one.
   *
   * A parameter for the same reason `exec` is: the suite has no `_out/<board>/`
   * to read one from, and the branch where a fact IS present has to be reachable
   * without building an image -- otherwise the only host that ever exercises the
   * commit assertion is one that has just run a full rootfs build.
   *
   * When it is omitted and the CLI is driving a real image, the fact is read
   * from `_out/<board>/mosd-build.txt`.
   */
  readonly buildCommit?: BuildCommitFact
  /** Skip `docker load`; the suite has no archive to load. */
  readonly load?: boolean
  readonly log?: (line: string) => void
  /**
   * The buildx builder to execute inside when the daemon cannot execute the
   * platform. Default: `mos-<arch>` if such a builder exists.
   */
  readonly builder?: string
  /**
   * Which executor a supplied `exec` stands for, when it carries no tag.
   *
   * Only meaningful together with `exec`, and only for a bare function: the
   * executors this file builds are `RoutedExec`s that say what they are, and
   * the runner reads the route off the one it chose. It exists so the suite can
   * reach the emulated route's verdicts from a fabricated outcome, without an
   * arm64 host, an image or a builder -- the same argument `exec` itself makes.
   * Omitted, an untagged executor is `native`, the strict reading, so a caller
   * cannot get the softer one by forgetting to say anything.
   */
  readonly route?: ExecRoute
}

/**
 * One board, end to end: coverage, image, control, twelve conclusions, verdict.
 *
 * The order is the argument. Coverage first, because a register that has fallen
 * behind its pin files makes every conclusion after it a statement about the
 * wrong set. The control second, because a host that cannot execute the image
 * turns every artifact red for one reason that has nothing to do with any of
 * them. Only then the artifacts.
 */
export async function smokeRun(opts: SmokeRunOptions): Promise<{ results: SmokeResult[]; conclusion: Conclusion }> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const artifacts = opts.artifacts ?? ARTIFACTS

  // Who may go unasked, before what may go unexecuted. Both are questions about
  // the register rather than about the image, and both are answered before a
  // container starts -- a run that executed eleven things and then discovered
  // its twelfth was silently excused has already produced the output somebody
  // would quote.
  const unclaimed = unclaimedFaults(artifacts, opts.allowUnclaimed)
  if (unclaimed.length > 0) {
    throw new Error(
      `the smoke register marks artifacts unclaimed that nothing authorised, so nothing was executed:\n`
      + unclaimed.map(f => `         ${f.file}: ${f.message}`).join('\n'),
    )
  }

  const faults = opts.files === undefined
    ? pinCoverageFaults(artifacts)
    : pinCoverageFaults(artifacts, opts.files)
  if (faults.length > 0) {
    const lines = faults.map(f => `         ${f.file}: ${f.message}`).join('\n')
    throw new Error(
      `the smoke register and the version pins disagree, so nothing was executed:\n${lines}`,
    )
  }

  let exec = opts.exec
  let build = opts.buildCommit
  if (exec === undefined) {
    const record = readFactoryRoot(opts.board)
    log(`os/verify smoke: ${opts.board} ${record.ref} (${record.platform}, ${record.bytes} bytes, sha256 ${record.sha256})`)

    // What the build left out, before anything is executed. See declinedFeatures.
    const manifest = join(outDir(opts.board), STAGE_MANIFEST_NAME)
    if (!existsSync(manifest)) {
      throw new Error(
        `${manifest} does not exist, so this run cannot tell whether the root beside it was built `
        + `with every feature stage. os/rootfs/build-v2.sh writes it on every build; an image with `
        + `no manifest was produced by something else, and the register covers a full-featured root.`,
      )
    }
    const declined = declinedFeatures(readFileSync(manifest, 'utf8'))
    if (declined.length > 0) {
      throw new Error(
        `${opts.board} was built WITHOUT the feature stage(s): ${declined.join(', ')}.\n`
        + `       The smoke register covers a full-featured root -- seven of its twelve artifacts arrive\n`
        + `       with stages/31-feature-containers, one with 32-feature-rauc and four with\n`
        + `       33-feature-mosd -- so every artifact of a declined feature would answer rc=127 and this\n`
        + `       run would print a handful of failures about binaries when what happened is one decision\n`
        + `       about one stage. Recorded at ${manifest}.\n`
        + `       This refuses rather than skipping the affected artifacts: a skip reports the same green\n`
        + `       as a pass, which is the one outcome a runner that exists to execute everything must not\n`
        + `       be able to produce.`,
      )
    }

    // The build fact, read and printed whether or not it is there. A run that
    // asserted nothing about the commit must say so on its own first lines
    // rather than look like one that did.
    if (build === undefined) build = readMosdBuildFact(opts.board)
    log(
      build.commit === undefined
        ? `os/verify smoke: build commit NOT ASSERTED -- ${build.source}`
        : `os/verify smoke: build commit ${build.commit}, from ${build.source}`,
    )

    // The image, by ID, for every invocation from here on. `record.ref` names
    // it only in messages: the tag is daemon-global and another worktree on this
    // host loading its own `:x64` mid-run would otherwise re-point what these
    // containers execute. See loadFactoryRoot.
    let image = record.ref
    if (opts.load !== false) {
      const loaded = await loadFactoryRoot(record, capture, log)
      image = loaded.id
      log(
        `os/verify smoke: executing image ${loaded.id}, identified by `
        + `${loaded.source === 'content' ? `the digest ${record.archive} carries` : `the tag ${loaded.ref}`}`,
      )
    }
    exec = dockerExec(image)
    try {
      await preflight(exec, record.platform)
    } catch (e) {
      // The daemon cannot execute this platform. That is a fact about the
      // host, not about the root, and a builder that bundles its emulator can
      // still execute every artifact; the register and the judging are the
      // same, only the executor moves. Anything other than the exec-format
      // refusal is passed through: a root that cannot run /bin/true for
      // another reason is a broken root, and a second executor would only
      // report it twice.
      const said = String((e as Error).message ?? e)
      const builder = opts.builder ?? (await builderExists(containerBuilderFor(record.platform))
        ? containerBuilderFor(record.platform)
        : undefined)
      if (!/exec format error/i.test(said) || builder === undefined) throw e
      const layout = await extractLayout(record.archivePath, join(outDir(opts.board), 'factory-root.layout'))
      log(`os/verify smoke: this host cannot execute ${record.platform}; executing inside buildkit on builder '${builder}' (${layout})`)
      exec = buildkitExec({ ref: record.ref, layout, builder, platform: record.platform })
      await preflight(exec, record.platform)
    }
  }

  // Read off the executor that was actually chosen, not tracked alongside the
  // choice. `opts.route` is only for a fabricated executor that carries no tag.
  const route = opts.route ?? execRoute(exec)

  const results: SmokeResult[] = []
  for (const artifact of artifacts) results.push(await checkArtifact(artifact, exec, build, route))
  return { results, conclusion: conclude(results, artifacts.length) }
}
