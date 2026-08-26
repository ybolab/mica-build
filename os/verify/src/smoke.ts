// The smoke runner: execute every self-built artifact inside the root that
// ships it, and require the version it reports to be the version this
// repository decided.
//
// RFCT-113 M7b. EXPLICITLY A SMOKE TEST -- execution and version identity, not
// behaviour. The QEMU boot tests keep functional coverage and the ldd/NEEDED
// checks stay where they are; nothing here asserts what a binary DOES.
//
// ═══ WHAT THIS CLOSES ═══
//
// Before M7 the last thing done to any of the twelve was to LINK it. A
// wrong-architecture binary, a missing soname and a version that does not match
// its pin all survive to first boot, and all three look identical from a build
// log: green. Three claims were being read as one --
//
//   "it linked"          the build did not fail
//   "it runs"            the loader resolves it and it reaches main
//   "it is the version   what ran is what os/podman/versions.env,
//    we decided"          os/update/rauc/versions.env or the crate manifest says
//
// -- and only the first was ever checked.
//
// ═══ THE SEAM, AND WHY THE WHOLE RUNNER IS TESTABLE WITHOUT DOCKER ═══
//
// Everything below takes an `Exec`: a function from argv to (status, stdout,
// stderr). `dockerExec` is the one that runs a container; the suite passes one
// that returns fabricated output, which is what makes every verdict here
// reachable FROM THE FAILING SIDE without an image, a daemon or a build. A
// check whose red branch has never executed is a check nobody has run.
//
// ═══ THE THREE VERDICTS, AND WHY THERE ARE THREE ═══
//
// `pass` and `fail` are the obvious two. `unclaimed` is the third, and it is
// the M4a check register's word for the same idea: a conclusion nobody reached
// must not report as one that was reached and held.
//
// NOTHING IN THE SHIPPED REGISTER IS UNCLAIMED ANY MORE, and the verdict stays.
// M7b measured mosd and apid as having no `--version` at all -- both ignored
// argv, started the daemon and MUTATED the machine -- and recorded that as
// `unclaimed` rather than as a pass or a skip, because closing it meant editing
// `mosd/` Rust sources, which PLAN-014 excluded. The user lifted that exclusion
// on 2026-08-26 for exactly a `--version` handler, M7d landed one in each, and
// the two entries became `version` like the other ten. What that leaves behind
// is a verdict with no current claimant, kept for the next artifact this
// repository builds and cannot yet ask -- deleting it would mean the only way
// to add such an artifact is to report it as passing or to leave it out, and
// this campaign has removed several checks that got greener by looking at less.
// It is exercised from the failing side in smoke.test.ts, which is where a
// verdict nobody currently produces has to be exercised.
//
// ═══ THE SECOND HALF OF THE VERSION CONTRACT: THE BUILD COMMIT ═══
//
// RFCT-113 M7d. mosd and apid also report the commit they were built from, and
// the runner asserts it -- against a RECORDED BUILD FACT and never against
// `git rev-parse HEAD`. See `BuildCommitFact` for why that distinction is the
// entire value of the check.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ARTIFACTS, pinCoverageFaults, unclaimedFaults, type Artifact } from './smoke-register.ts'
import type { Pin } from './smoke-pins.ts'
import { REPO_ROOT } from './paths.ts'

/** One executed command, and everything the runner is allowed to know about it. */
export interface ExecResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run one command inside the factory root.
 *
 * The argv is the ABSOLUTE PATH of the binary in the image followed by its
 * arguments -- not a shell line. The factory root is `FROM scratch` with no
 * ENTRYPOINT, no CMD and no PATH, so a bare `crun` would not resolve, and the
 * installed path is the thing under test anyway.
 */
export type Exec = (argv: readonly string[]) => Promise<ExecResult>

export type Verdict = 'pass' | 'fail' | 'unclaimed'

export interface SmokeResult {
  readonly name: string
  readonly path: string
  readonly kind: 'version' | 'exec' | 'unclaimed'
  readonly verdict: Verdict
  readonly message: string
  /**
   * The long form, printed BELOW the table rather than in the row.
   *
   * Only `unclaimed` carries one, and it is the measured reason the artifact
   * has no version contract. It is separated from `message` because a
   * paragraph inside a column destroys the one property a per-artifact table
   * has -- that twelve conclusions can be read at a glance -- and the reason a
   * check was not run is exactly the thing a reader skims past when it is
   * buried in a wall of text.
   */
  readonly detail?: string
}

/**
 * A pin's file, relative to the repository root.
 *
 * NOT `basename`. Four of the twelve read a `Cargo.toml`, and four rows all
 * saying "in Cargo.toml" name nothing: `mosd/mqttd/Cargo.toml` and
 * `mosd/broker/Cargo.toml` are different files with the same last component,
 * and the whole point of printing the source is that a reader can go and edit
 * the right one. Absolute paths are worse in the other direction -- they carry
 * a worktree prefix that differs per checkout and turns every line into noise.
 */
export function pinSource(file: string): string {
  return file.startsWith(REPO_ROOT + '/') ? file.slice(REPO_ROOT.length + 1) : file
}

/**
 * Every version-shaped token on a line, by maximal munch.
 *
 * WHY A TOKENISER AND NOT TWELVE PARSERS. The ten artifacts that answer print
 * ten different sentences -- measured in the real x64 factory root:
 *
 *   rauc 1.13                      podman version 5.8.6        5.8.6
 *   crun version 1.29.1            conmon version 2.2.1        netavark 2.1.0
 *   aardvark-dns 2.1.0             tini version 0.2.1_catatonit
 *   mos-mqttd 0.1.0                mos-mqtt-broker 0.1.0
 *
 * A per-artifact regex would be twelve more things to keep current, each of
 * which fails OPEN when upstream reflows its banner: a regex that stops
 * matching yields no version, and "no version" is easy to mistake for "no
 * mismatch". Reading the numbers out of whatever is printed has no such
 * failure mode, because the comparison is against a value read from the pin
 * file and a missing token can only ever be a mismatch.
 *
 * MAXIMAL MUNCH IS THE POINT, not an implementation detail. `1.29.10` must not
 * satisfy a pin of `1.29.1`, so the run of digits and dots is taken whole and
 * compared whole. That property comes from the GREEDY quantifier, not from a
 * guard: after `[0-9]+(?:\.[0-9]+)+` has matched, the next character cannot be
 * a digit, because it would already have been consumed.
 *
 * THERE IS DELIBERATELY NO RIGHT-HAND GUARD, and the first version of this
 * function had one. `(?![.0-9])` was written to stop `1.29.10` satisfying
 * `1.29.1` -- which greed already does -- and it was found to be redundant by
 * mutation: removing it changed no test. What it DID change was a trailing dot.
 * On `crun version 1.29.1.` the guard rejects the greedy match, backtracking
 * finds nothing shorter that satisfies it either, and the line yields NO TOKEN
 * -- which this runner reports as "reports NO version at all" and turns RED for
 * a binary that printed exactly the right version and ended its sentence with a
 * full stop. A guard that cannot fire on the case it was written for and can
 * fire on a case nobody considered is worse than no guard.
 *
 * The LEFT guard stays, and it is load-bearing: without it a token can start in
 * the middle of a longer run, so `11.29.1` would offer `1.29.1` and a
 * version-skewed binary would report as agreeing with its pin.
 */
export function versionTokens(line: string): string[] {
  return [...line.matchAll(/(?<![.0-9])[0-9]+(?:\.[0-9]+)+/g)].map(m => m[0])
}

/**
 * THE COMMIT HALF: PRINTED BY M7b, ASSERTED SINCE M7d — and what had to be
 * built in between.
 *
 * M7b measured that there was nothing to assert against, with a positive
 * control on the search. `_out/<board>/factory-root.txt` carried ref, platform,
 * target, archive, bytes, sha256 and source-date-epoch; `rootfs-stages.txt`
 * per-stage content hashes; `rootfs-verity.env` verity parameters. A grep for
 * `rev-parse|git describe|GIT_COMMIT|VCS_REF|SOURCE_COMMIT` across
 * `os/rootfs/build-v2.sh` and all of `os/build/src/*.ts` -- 39 files --
 * returned nothing, while the same grep shape hit `docs/plan/PLAN-014.md`
 * twice, so the search worked and the absence was real. With no recorded build
 * fact, M7b printed the reported line verbatim and asserted nothing about it.
 * That was the correct half of the requirement to implement at the time.
 *
 * M7b ALSO REFUSED THE ALTERNATIVE BY NAME, and that refusal still stands:
 * comparing the reported sha against `git rev-parse HEAD` at run time is
 * trivially green on any freshly built tree. It asserts that somebody just
 * built, not that the embedding works.
 *
 * M7d CLOSED THE GAP BY BUILDING THE MISSING FACT, not by weakening the
 * comparison -- `os/rootfs/build-v2.sh` is not `mosd/` and was never excluded.
 * `mosd/hack/build-target.sh` writes the commit it handed the compiler into
 * `_out/mosd-build.txt`, build-v2.sh copies it to `_out/<board>/mosd-build.txt`
 * beside the factory root, `readMosdBuildFact` reads it back and `judge`
 * compares the two. See `BuildCommitFact`.
 *
 * THE PRINTED-ONLY STATE IS KEPT AS A BRANCH rather than deleted: when the
 * record is absent -- a hand-assembled `_out/`, an image from before M7d -- the
 * runner says so on its own first lines and the row says `commit was NOT
 * asserted`. And the reported line is still carried verbatim into every version
 * verdict (`[said: ...]`), because a commit the runner cannot check is still one
 * a reader must be able to see.
 *
 * ONE MEASURED LIMIT, from M7b and unchanged: `mosd 0.1.0-rc.1 (abc1234)`
 * yields the numeric head only, so a pre-release pin and output would go RED
 * naming both sides -- visible rather than a silent pass. Neither crate takes a
 * pre-release version today; if one does, `versionTokens` is where to look.
 */

/**
 * Whether a `--version` line reports EXACTLY this commit.
 *
 * RFCT-113 M7d. mosd and apid print `<name> <version> (<commit>)`, and the
 * commit half is compared here rather than by `versionTokens`, which reads
 * dotted numbers and would never see a sha at all.
 *
 * A TOKEN MATCH, NOT A SUBSTRING, and the whole reason is `-dirty`.
 * `line.includes('00b674e9a628')` is satisfied by `(00b674e9a628-dirty)`, so a
 * binary built from a MODIFIED worktree would report as agreeing with the clean
 * sha -- which is the one confusion the dirty marker exists to prevent. The
 * guards are the same shape this campaign uses for path arithmetic: a left
 * `(?<![A-Za-z0-9-])` so a token may not start inside a longer run, and a right
 * `(?![A-Za-z0-9-])` so it may not end inside one. `-` is in BOTH classes on
 * purpose; that is what makes `-dirty` a different token rather than a suffix.
 *
 * An empty expectation matches nothing. `readMosdBuildFact` never returns one,
 * and if it ever did, a `RegExp('')` here would match every line and turn this
 * into a check that cannot fail -- the failure mode `readPin` refuses one level
 * down in the same words.
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
 * What the BUILD recorded about the commit it embedded, and where that came from.
 *
 * RFCT-113 M7d, and the shape of this type is the whole defence against a
 * vacuous check. The commit half of mosd's and apid's `--version` could be
 * "asserted" against `git rev-parse HEAD` at run time, and that would pass on
 * any freshly built tree while asserting only that somebody had just rebuilt --
 * never that the embedding works. So the expectation is a BUILD FACT:
 * `mosd/hack/build-target.sh` writes the commit it handed the compiler into
 * `_out/mosd-build.txt`, `os/rootfs/build-v2.sh` carries it into `_out/<board>/`
 * beside the factory root, and this is what the runner reads back.
 *
 * `commit` is optional because the fact may genuinely not be there -- a
 * hand-assembled `_out/`, an image from before M7d -- and RFCT-113 M7d's
 * instruction for that case is to PRINT it and assert nothing rather than to
 * refuse. `source` is printed either way, so a run that asserted nothing about
 * the commit says so out loud instead of looking like one that did.
 */
export interface BuildCommitFact {
  /** The commit the build recorded embedding. Absent when none was recorded. */
  readonly commit?: string
  /** Where it came from, or why there is nothing. Always printed. */
  readonly source: string
}

/**
 * What a non-zero exit MEANS, from the status and what came back with it.
 *
 * RFCT-113 M7c, and this replaced a map that had never been measured. M7b wrote
 * the three-way split from the documented `docker run` convention -- 127 not
 * found, 126 cannot be invoked -- and both of the shapes RFCT-113's first
 * acceptance clause names land somewhere else. Measured on 2026-08-26, docker
 * 29.7.2, in EXACTLY the shape `dockerArgv` produces (no shell: the artifact IS
 * the container's init, so a failure to exec it surfaces as a `docker run`
 * failure rather than as a shell's 126):
 *
 *   wrong-arch ELF            255  `exec <path>: exec format error`
 *   missing soname            127  `<path>: error while loading shared libraries:
 *                                   libselinux.so.1: cannot open shared object file`
 *   present, mode 000         126  `docker: ... exec: "<path>": permission denied.`
 *   path genuinely absent     127  `docker: ... exec: "<path>": stat <path>: no such
 *                                   file or directory.`
 *   program ran and refused   its own status
 *
 * So the old map was wrong twice over, and wrong on both of the cases the clause
 * exists for: a wrong-arch binary was diagnosed as "the program ran and refused"
 * (it never ran), and a missing soname as "the path does not exist in the factory
 * root" (it is there). 126, which the old map gave to both of them, is produced
 * by neither -- it is a mode bit, a case nobody had considered.
 *
 * THE SAME FILE ALREADY KNEW. `preflight`'s comment records `status 255` with
 * `exec format error` for the arm64 wall, measured against a pulled upstream
 * arm64v8 image. One half of this module had the measurement and the other half
 * had the convention, and nothing compared them -- because both `judge` branches
 * were reachable in the suite only from a FABRICATED `ExecResult`, where the
 * test chose the status it then asserted the diagnosis of. That is why the three
 * negative tests this milestone owes are driven through a real container against
 * a real mutated root: `os/verify/src/smoke-negative.ts`.
 *
 * 127 IS AMBIGUOUS AND IS SPLIT BY TEXT, not left to the status. ld.so exits 127
 * after printing `error while loading shared libraries`, and docker exits 127
 * when the path is not there at all; reporting either as the other sends a
 * reader to the wrong file. The status alone cannot separate them, so this reads
 * the output -- and falls back to naming BOTH possibilities rather than picking
 * one, because a confident wrong diagnosis is worse than an honest pair.
 *
 * Pure, so every branch is reachable from the suite as well as from the
 * container.
 */
export function diagnose(outcome: ExecResult): string {
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
 * Decide one artifact from what its invocation actually did.
 *
 * Pure, so every branch is reachable from the suite with a fabricated
 * `ExecResult` -- including the two that a healthy tree can never produce.
 *
 * `build` is the recorded build fact ([`BuildCommitFact`]), consulted only for
 * an artifact whose register entry says it embeds a commit.
 */
export function judge(artifact: Artifact, pin: Pin, outcome: ExecResult, build?: BuildCommitFact): SmokeResult {
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
    // `[said: ...]` is M7b's, and it stays on EVERY version row rather than
    // only the two that carry a commit: a runner that asserts a thing must
    // still show what it read, and the rows that assert no commit are exactly
    // the ones where the printed line is the only record of one.
    const version =
      `exit 0, reports ${pin.expected} == ${pin.key}=${pin.recorded} in ${pinSource(pin.file)} `
      + `[said: ${JSON.stringify(line)}]`
    // THE SECOND HALF, for the two artifacts that carry a build commit. It is
    // asserted only against a RECORDED build fact, never against the working
    // tree's HEAD -- see BuildCommitFact for why that distinction is the whole
    // value of this check.
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
export async function checkArtifact(artifact: Artifact, exec: Exec, build?: BuildCommitFact): Promise<SmokeResult> {
  const pin = artifact.pin()
  if (artifact.contract.kind === 'unclaimed') {
    // NOT INVOKED, and that is a decision rather than an omission. mosd's only
    // invocation provisions a device and apid's never returns; running them to
    // produce a `fail` would trade a clear "nobody asked" for a 25-second hang
    // and a mutated /var, and would report the artifact as broken when what is
    // missing is the question.
    return judge(artifact, pin, { status: 0, stdout: '', stderr: '' }, build)
  }
  return judge(artifact, pin, await exec([artifact.path, ...artifact.contract.argv]), build)
}

export interface Conclusion {
  readonly conclusion: 'PASS' | 'FAIL' | 'INCOMPLETE'
  readonly exitCode: number
  readonly counts: { readonly pass: number; readonly fail: number; readonly unclaimed: number; readonly total: number }
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
    total: results.length,
  }

  // THE NAMES, NOT JUST THE NUMBER. A category with a count and no members
  // decays into background noise: "2 unclaimed" is a thing a reader stops
  // seeing after the third run, and "mosd, apid" is a thing they can act on.
  // It matters more than usual here because this run's steady state is
  // non-zero -- the number is the part that will be habituated to, so the
  // names go on the RESULT line itself and not only in the table above it.
  const named = (verdict: Verdict): string =>
    results.filter(r => r.verdict === verdict).map(r => r.name).join(', ')
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
        `RESULT: FAIL (${counts.pass} pass, ${counts.fail} fail, ${counts.unclaimed} unclaimed, of ${counts.total}). `
        + `FAILED: ${named('fail')}.`
        + (counts.unclaimed > 0 ? ` UNCLAIMED: ${named('unclaimed')}.` : ''),
    }
  }
  if (counts.unclaimed > 0) {
    return {
      conclusion: 'INCOMPLETE',
      exitCode: 1,
      counts,
      line:
        `RESULT: INCOMPLETE (${counts.pass} pass, 0 fail, ${counts.unclaimed} unclaimed, of ${counts.total}). `
        + `UNCLAIMED: ${named('unclaimed')}. `
        + `Nothing failed and not everything was asked. An unclaimed artifact is not a pass and is `
        + `not a skip: RFCT-113 requires a reported version from every one of them, and this run `
        + `exits non-zero so that a gate cannot be held by a summary with holes in it.`,
    }
  }
  return {
    conclusion: 'PASS',
    exitCode: 0,
    counts,
    // The same four numbers FAIL and INCOMPLETE print, in the same order.
    // The PASS line used to read `(12/12 artifacts executed, ...)`, which is a
    // second format for one summary: a reader comparing a green run against a
    // red one had to translate between them, and `0 unclaimed` -- the thing
    // this milestone changed -- was not stated at all on the line that
    // mattered most.
    line: `RESULT: PASS (${counts.pass} pass, ${counts.fail} fail, ${counts.unclaimed} unclaimed, of ${counts.total})`,
  }
}

// ─── The image, and the one place that decides how a binary is executed ──────

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
 * TAB-SEPARATED, exactly as `ociRecord` in os/build/src/stages.ts writes it and
 * as `mosd/hack/build-target.sh` writes `_out/mosd-build.txt`, parsed rather
 * than sourced. Comment lines are skipped by having no tab, which is why
 * `# Load it with: docker load -i ...` cannot become a key -- a reader that
 * split on whitespace would have made one.
 *
 * ONE READER FOR BOTH RECORDS, because two parsers for one file format agree
 * right up until a value acquires a tab or a comment acquires one. The same
 * argument smoke-pins.ts makes about not writing a second `versions.env`
 * parser.
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
 * to be REACHABLE from a test, and a guard that can only fire on a host that
 * has never built an image is a guard whose behaviour depends on the host it
 * runs on -- green here, red there, for reasons that are nothing to do with the
 * code.
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
 * A MISSING IMAGE IS A REFUSAL, NOT A SKIP. `make os-verify-cx3576-v2` on a
 * tree with no image refuses before running a single check, and that is the
 * behaviour to copy: a smoke runner that skipped when it found nothing to smoke
 * would report the same green on a tree that had never built an image as on one
 * whose artifacts all passed.
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
      + `       image that ships its binaries unexecuted is exactly what RFCT-113 exists to end.`,
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
 * Read out of the record `mosd/hack/build-target.sh` wrote and
 * `os/rootfs/build-v2.sh` copied in beside the image -- NOT out of the working
 * tree. See [`BuildCommitFact`].
 *
 * ABSENT IS NOT A REFUSAL HERE, unlike the factory root itself. RFCT-113 M7d's
 * instruction for a build fact the runner cannot see is to print it and assert
 * nothing, and the reason a refusal would be wrong is that this file is younger
 * than the images that may still be sitting in `_out/`: refusing would turn
 * "this image predates the commit stamp" into "this tree is broken". On a root
 * built by os/rootfs/build-v2.sh the record is always written, and when mosd is
 * DECLINED the same script removes it -- and then mosd and apid are not in the
 * image at all and `declinedFeatures` refuses the run before it reaches here.
 * So the absent branch is not the normal path; it is the one for an `_out/`
 * assembled by hand or left over from an older build.
 *
 * A RECORD THAT EXISTS AND CANNOT BE READ IS A REFUSAL, though. A file with no
 * `commit` key was written by something other than build-target.sh, and reading
 * that as "nothing recorded" would let a malformed record silently switch the
 * assertion off.
 */
export function readMosdBuildFact(board: string, dir: string = outDir(board)): BuildCommitFact {
  const path = join(dir, MOSD_BUILD_RECORD_NAME)
  const shown = pinSource(path)
  if (!existsSync(path)) {
    return {
      source:
        `${shown} does not exist, so no commit was recorded for this image. It is written by `
        + `mosd/hack/build-target.sh on every build and copied here by os/rootfs/build-v2.sh; `
        + `rebuild the board to have the commit asserted rather than printed`,
    }
  }
  const kv = parseTabRecord(readFileSync(path, 'utf8'))
  const commit = kv.get('commit')
  if (commit === undefined) {
    throw new Error(
      `${path} carries no \`commit\` field. mosd/hack/build-target.sh writes one on every build -- `
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
 * WHY THIS IS ASKED AT ALL. The register covers a FULL-FEATURED root: twelve
 * artifacts, of which seven arrive with stages/31-feature-containers, one with
 * 32-feature-rauc and four with 33-feature-mosd. Those stages are optional --
 * `WITH_CONTAINERS=0` in a board's containers.env, or `MOS_ROOTFS_WITHOUT`,
 * leaves them out, and os/rootfs/build-v2.sh supports both. Against such a root
 * every artifact of a declined feature answers rc=127, and the run would print
 * seven failures about seven binaries when what happened is one decision about
 * one stage. That is the same defect `preflight` exists to prevent one level up.
 *
 * IT REFUSES RATHER THAN MODELLING IT. Teaching the register which feature owns
 * which artifact, and reporting a declined one as some fourth verdict, would put
 * a SKIP into a runner whose whole purpose is that nothing is skipped -- and a
 * skip reports the same green as a pass. Refusing costs a board that declines a
 * feature the ability to smoke-run at all, which is a smaller and much more
 * visible cost than a green with a hole in it, and it is a decision for whoever
 * ships such a board to make deliberately.
 *
 * Both shipped boards decline nothing today -- x64 has no containers.env at all
 * and cx3576's says `WITH_CONTAINERS=1` -- so this guard is written from the
 * manifest's own record rather than from a board file, and it fires on a
 * configuration neither board is in.
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

async function capture(argv: readonly string[], timeoutMs: number): Promise<ExecResult> {
  const proc = Bun.spawn(argv as string[], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  // A BUDGET, NOT A COURTESY. `apid --version` starts an HTTPS server and never
  // returns -- measured, rc=124 against 25s -- so an unbounded wait here is a
  // smoke run that hangs instead of concluding. The shipped register does not
  // invoke apid, but a register entry added later could, and a harness whose
  // worst case is "forever" cannot be put in front of a build.
  const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs)
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { status, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

/** How long any one invocation may take. `--version` is milliseconds; this is a fuse. */
export const EXEC_TIMEOUT_MS = 30_000

/**
 * Load the archive, every run, and hand back the ref it loaded.
 *
 * WHY LOAD RATHER THAN TRUST A TAG. A tag is daemon state: it says what is
 * currently loaded, and `localhost/mos-factory-root:x64` may name a root some
 * other worktree on this host built an hour ago. `os/rootfs/build-v2.sh` guards
 * the same seam from the other side and says why -- "a stale or absent archive
 * would be handed to the smoke runner as this build's root". Loading is
 * idempotent and costs ~2s on the real 250 MB export because the layers are
 * already content-addressed; that is a cheap price for the tag pointing at the
 * bytes this record describes.
 */
export async function loadFactoryRoot(
  record: FactoryRootRecord & { readonly archivePath: string },
  run: (argv: readonly string[]) => Promise<ExecResult> = argv => capture(argv, EXEC_TIMEOUT_MS),
): Promise<void> {
  const r = await run(['docker', 'load', '-i', record.archivePath])
  if (r.status !== 0) {
    throw new Error(
      `docker load -i ${record.archivePath} exited ${r.status}: ${r.stderr.trim() || r.stdout.trim()}`,
    )
  }
}

/**
 * The positive control, run before anything is concluded about any artifact.
 *
 * `/bin/true` is coreutils' and the packed root keeps coreutils by decision
 * (90-pack.Dockerfile says why). If it does not exit 0, NOTHING in this image
 * can be executed on this host, and every one of the twelve would come back
 * `fail` with a message about the artifact -- which would be twelve wrong
 * diagnoses of one condition.
 *
 * THIS IS WHERE THE arm64 WALL IS CAUGHT. On a host with no binfmt_misc,
 * `docker run` of an arm64 image answers `exec /bin/true: exec format error`
 * with status 255 -- measured on this host against a pulled upstream
 * arm64v8/busybox, so the measurement is about the host and not about our
 * export. Refusing here, naming the platform and the remedy, is the same shape
 * as `os-verify-cx3576-v2` refusing on a tree with no image.
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
 * Separated from `dockerExec` so the suite can assert the argv WITHOUT a
 * daemon: `--network none` and `--rm` are decisions, and a decision that only
 * exists inside a function nothing can observe is a decision nobody can check
 * has survived an edit.
 */
export function dockerArgv(ref: string, argv: readonly string[]): string[] {
  return [
    'docker',
    'run',
    '--rm',
    // NO NETWORK. `podman --version` needs none, and a smoke runner that could
    // reach a registry is a smoke runner whose result could depend on one. It
    // also keeps apid-shaped binaries -- anything that binds a port -- from
    // reaching the host's network if a later register entry runs one.
    '--network',
    'none',
    ref,
    ...argv,
  ]
}

/** The real seam: one container per invocation, inside the loaded factory root. */
export function dockerExec(ref: string, timeoutMs: number = EXEC_TIMEOUT_MS): Exec {
  return argv => capture(dockerArgv(ref, argv), timeoutMs)
}

export interface SmokeRunOptions {
  readonly board: string
  readonly artifacts?: readonly Artifact[]
  /**
   * Which `versions.env` files coverage is checked against.
   *
   * A parameter for the same reason `artifacts` is: a suite that drove a
   * two-artifact register against the SHIPPED pin files would get ten coverage
   * faults about artifacts it was not testing, and the only way out of that
   * would be to weaken the coverage check for everybody.
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
   * to read one from, and the branch where a fact IS present has to be
   * reachable without building an image -- otherwise the only host that ever
   * exercises the commit assertion is one that has just run a full rootfs
   * build, and a check that runs nowhere else is a check nobody runs.
   *
   * When it is omitted and the CLI is driving a real image, the fact is read
   * from `_out/<board>/mosd-build.txt`.
   */
  readonly buildCommit?: BuildCommitFact
  /** Skip `docker load`; the suite has no archive to load. */
  readonly load?: boolean
  readonly log?: (line: string) => void
}

/**
 * One board, end to end: coverage, image, control, twelve conclusions, verdict.
 *
 * The ORDER is the argument. Coverage first, because a register that has fallen
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

    // The build fact, READ AND PRINTED whether or not it is there. A run that
    // asserted nothing about the commit must say so on its own first lines
    // rather than look like one that did.
    if (build === undefined) build = readMosdBuildFact(opts.board)
    log(
      build.commit === undefined
        ? `os/verify smoke: build commit NOT ASSERTED -- ${build.source}`
        : `os/verify smoke: build commit ${build.commit}, from ${build.source}`,
    )

    if (opts.load !== false) await loadFactoryRoot(record)
    exec = dockerExec(record.ref)
    await preflight(exec, record.platform)
  }

  const results: SmokeResult[] = []
  for (const artifact of artifacts) results.push(await checkArtifact(artifact, exec, build))
  return { results, conclusion: conclude(results, artifacts.length) }
}
