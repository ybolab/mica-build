// The runner, driven from the failing side without a daemon, an image or a build.
//
// RFCT-113 M7b, RFCT-096's rule. Everything here is reachable because the
// runner takes an `Exec` -- a function from argv to (status, stdout, stderr) --
// so the suite fabricates outcomes a healthy tree can never produce: a
// wrong-architecture refusal, a binary that is not where the register says, a
// version that does not match its pin. A harness that could only be exercised
// against a correct image would have no way to show that its RED branches work,
// and a check whose red branch has never run is a check nobody has run.
//
// THE VERSION LOOP IS TESTED AS A LOOP, not as a comparison. RFCT-113's third
// acceptance clause is "bumping a `versions.env` pin without rebuilding the
// artifact turns the smoke run red", and the case below does exactly that: one
// fixture file, one unchanged binary output, one edit to the pin, and the
// verdict flips. Asserting `judge` on two literals would test the comparison
// and say nothing about whether the pin is re-read from the file it lives in.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'
import { readPin, type Pin } from './smoke-pins.ts'
import { ARTIFACTS, type Artifact } from './smoke-register.ts'
import {
  conclude,
  checkArtifact,
  dockerArgv,
  factoryRootPaths,
  firstLine,
  judge,
  parseFactoryRootRecord,
  pinSource,
  preflight,
  readFactoryRoot,
  readMosdBuildFact,
  reportsCommit,
  smokeRun,
  declinedFeatures,
  versionTokens,
  MOSD_BUILD_RECORD_NAME,
  type BuildCommitFact,
  type Exec,
  type ExecResult,
  type SmokeResult,
} from './smoke.ts'

let SCRATCH = ''
beforeAll(() => {
  mkdirSync(join(REPO_ROOT, '_out'), { recursive: true })
  SCRATCH = mkdtempSync(join(REPO_ROOT, '_out', 'verify-smoke-'))
})
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

function scratch(): string {
  if (SCRATCH === '') throw new Error('the scratch directory was read before beforeAll created it')
  return SCRATCH
}

/** A textual mutation that refuses to be a no-op -- see checks-bootchain.test.ts. */
function mutate(text: string, from: string | RegExp, to: string): string {
  const after = text.replace(from as never, to)
  if (after === text) {
    throw new Error(
      `the mutation ${String(from)} -> '${to}' changed nothing; the fixture is unmutated and any `
      + `RED this case reports is about something else`,
    )
  }
  return after
}

const ok = (stdout: string): ExecResult => ({ status: 0, stdout, stderr: '' })
const pin = (recorded: string, expected = recorded): Pin =>
  ({ recorded, expected, file: '/x/versions.env', key: 'THING_VERSION' })

function versionArtifact(name = 'thing', path = '/usr/bin/thing', p: () => Pin = () => pin('v1.2.3', '1.2.3')): Artifact {
  return { name, path, pin: p, contract: { kind: 'version', argv: ['--version'] } }
}

// ─── the tokeniser ──────────────────────────────────────────────────────────

describe('versionTokens -- one reader for ten different sentences', () => {
  // THE TEN REAL OUTPUTS, captured 2026-08-26 by running each binary inside the
  // x64 factory root built from this tree. These are the positive controls, and
  // they are measurements rather than guesses -- five of them are not in
  // /usr/bin, which is how the shapes came to be read off the real thing.
  const MEASURED: ReadonlyArray<readonly [string, string]> = [
    ['rauc 1.13', '1.13'],
    ['podman version 5.8.6', '5.8.6'],
    ['5.8.6', '5.8.6'],
    ['crun version 1.29.1', '1.29.1'],
    ['conmon version 2.2.1', '2.2.1'],
    ['netavark 2.1.0', '2.1.0'],
    ['aardvark-dns 2.1.0', '2.1.0'],
    ['tini version 0.2.1_catatonit', '0.2.1'],
    ['mos-mqttd 0.1.0', '0.1.0'],
    ['mos-mqtt-broker 0.1.0', '0.1.0'],
  ]

  test('every measured --version line yields its version', () => {
    // The search space, stated: ten lines, not an empty table that would make
    // the loop below vacuous.
    expect(MEASURED.length).toBe(10)
    for (const [line, want] of MEASURED) {
      expect(versionTokens(line)).toContain(want)
    }
  })

  // MAXIMAL MUNCH IS THE POINT. A `contains` over a substring would let a
  // 1.29.10 binary satisfy a 1.29.1 pin, which is a version skew reported as
  // agreement -- the exact failure RFCT-113 exists to catch.
  test('a longer version does not satisfy a shorter pin', () => {
    expect(versionTokens('crun version 1.29.10')).toEqual(['1.29.10'])
    expect(versionTokens('crun version 1.29.10')).not.toContain('1.29.1')
  })

  test('a prefixed version does not satisfy a shorter pin either', () => {
    expect(versionTokens('thing 11.29.1')).toEqual(['11.29.1'])
    expect(versionTokens('thing 11.29.1')).not.toContain('1.29.1')
  })

  test('a leading v is read through, because some tools print one', () => {
    expect(versionTokens('thing v1.2.3')).toEqual(['1.2.3'])
  })

  // THE CASE A RIGHT-HAND GUARD BROKE. The first version of versionTokens
  // carried `(?![.0-9])`, which greed already made redundant -- and which
  // rejected a version at the end of a sentence, yielding no token at all and
  // turning a correct binary red. Locked in here so the guard cannot come back.
  test('a version followed by a full stop is still a version', () => {
    expect(versionTokens('Built from crun version 1.29.1.')).toEqual(['1.29.1'])
    expect(versionTokens('thing 1.2.3, and more')).toEqual(['1.2.3'])
  })

  test('the LEFT guard is load-bearing: a token may not start inside a longer run', () => {
    // Without it, `11.29.1` offers `1.29.1` and a skewed binary reads as agreeing.
    expect(versionTokens('thing 11.29.1')).not.toContain('1.29.1')
    // ...and it blocks a dotted prefix too, e.g. a shared-object name.
    expect(versionTokens('libcrun.so.1.2.3')).toEqual([])
  })

  test('a hex commit hash is not mistaken for a version', () => {
    expect(versionTokens('commit: f0d911de5587342cfeb16473bf32ecdfeaf25957')).toEqual([])
  })

  test('a line with no dotted number yields nothing, rather than something wrong', () => {
    expect(versionTokens('conmon version')).toEqual([])
    expect(versionTokens('')).toEqual([])
    // RECORDED BEHAVIOUR, not an accident: a single-component version is not a
    // token. No pin in this tree is one; if one ever is, this run goes red with
    // "reports NO version at all" rather than passing by accident.
    expect(versionTokens('thing 5')).toEqual([])
  })

  test('several versions on one line are all offered', () => {
    expect(versionTokens('client 1.2.3, server 4.5.6')).toEqual(['1.2.3', '4.5.6'])
  })

  // ═══ THE SHAPE M7d WILL EMIT — MEASURED, NOT REASONED ABOUT ═══
  //
  // M7d's mosd/apid `--version` handlers report the git commit alongside the
  // crate version: `mosd <version> (<short-sha>)`, `-dirty` when the worktree
  // was, `unknown` when the value is absent. Nothing here hard-codes a
  // `name X.Y.Z` shape, so the parser should already take it -- but "should
  // already" is exactly the reasoning that put a redundant right-hand guard in
  // this function, so these are run rather than argued.
  test('a version line carrying a git short-sha yields the version and not the sha', () => {
    expect(versionTokens('mosd 0.1.0 (abc1234)')).toEqual(['0.1.0'])
    expect(versionTokens('mosd 0.1.0-dirty (abc1234-dirty)')).toEqual(['0.1.0'])
    expect(versionTokens('apid 0.1.0 (unknown)')).toEqual(['0.1.0'])
  })

  test('an ALL-DIGIT short sha is still not a version token', () => {
    // The case that would break a looser reader: a sha can be seven digits.
    // It has no dot, so it cannot form a token, and the version is unambiguous.
    expect(versionTokens('mosd 0.1.0 (0123456)')).toEqual(['0.1.0'])
    expect(versionTokens('mosd 0.1.0 (1234567-dirty)')).toEqual(['0.1.0'])
  })

  test('two-digit components survive the sha suffix', () => {
    expect(versionTokens('mosd 0.10.0 (abc1234)')).toEqual(['0.10.0'])
  })

  // A MEASURED LIMIT, recorded rather than discovered later. If a crate ever
  // takes a pre-release version the pin and the output would BOTH carry the
  // suffix, the token would be the numeric head only, and this run would go
  // RED naming both sides -- visible, not a silent pass. Stated so M7d knows
  // the boundary without having to find it.
  test('a pre-release suffix is NOT part of the token, and that is a red not a pass', () => {
    expect(versionTokens('mosd 0.1.0-rc.1 (abc1234)')).toEqual(['0.1.0'])
    const r = judge(versionArtifact(), pin('0.1.0-rc.1'), ok('mosd 0.1.0-rc.1 (abc1234)'))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('expected 0.1.0-rc.1')
  })

  // M7b wrote this when the commit half was printed and never asserted. M7d
  // made it asserted -- see `BuildCommitFact` in smoke.ts for the recorded fact
  // that made that possible, and for why comparing against `git rev-parse HEAD`
  // would still be vacuous. The case KEEPS ITS SUBJECT: the reported line is
  // carried verbatim into every version PASS message, including the ten rows
  // that assert no commit, where the printed line is the only record of one.
  test('the reported line is carried into the PASS message, whether or not a commit is asserted', () => {
    const r = judge(versionArtifact(), pin('0.1.0'), ok('mosd 0.1.0 (abc1234)'))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('mosd 0.1.0 (abc1234)')
    // This artifact embeds no commit, so nothing was asserted about the sha --
    // and the row does not pretend otherwise.
    expect(r.message).not.toContain('reports the commit')
  })
})

// ─── the commit half ────────────────────────────────────────────────────────

describe('reportsCommit -- a token match, and the -dirty confusion it exists for', () => {
  const CLEAN = 'mosd 0.1.0 (00b674e9a628)'
  const DIRTY = 'mosd 0.1.0 (00b674e9a628-dirty)'

  test('the commit the build recorded is found in the line the binary printed', () => {
    expect(reportsCommit(CLEAN, '00b674e9a628')).toBe(true)
    expect(reportsCommit(DIRTY, '00b674e9a628-dirty')).toBe(true)
  })

  // THE CASE THE GUARDS EXIST FOR, and the one a `String.includes` gets wrong.
  // A binary built from a MODIFIED worktree must not report as agreeing with
  // the clean sha -- that is the entire purpose of the dirty marker, and a
  // substring test hands it straight back.
  test('a dirty binary does not satisfy a clean commit', () => {
    expect(DIRTY.includes('00b674e9a628')).toBe(true) // the positive control on the trap
    expect(reportsCommit(DIRTY, '00b674e9a628')).toBe(false)
  })

  test('a clean binary does not satisfy a dirty record either', () => {
    expect(reportsCommit(CLEAN, '00b674e9a628-dirty')).toBe(false)
  })

  test('a token may not start or end inside a longer run', () => {
    expect(reportsCommit('mosd 0.1.0 (00b674e9a6280)', '00b674e9a628')).toBe(false)
    expect(reportsCommit('mosd 0.1.0 (a00b674e9a628)', '00b674e9a628')).toBe(false)
  })

  test('a binary that reports unknown satisfies no recorded commit', () => {
    expect(reportsCommit('mosd 0.1.0 (unknown)', '00b674e9a628')).toBe(false)
  })

  // AN EMPTY EXPECTATION MATCHES NOTHING, rather than everything. Without the
  // guard, `new RegExp('')` matches every line and this becomes a check that
  // cannot fail -- the failure `readPin` refuses one level down in its own
  // words ("an empty value would make the comparison pass by finding nothing").
  test('an empty commit is not satisfied by any line at all', () => {
    expect(reportsCommit(CLEAN, '')).toBe(false)
    expect(reportsCommit('', '')).toBe(false)
  })

  // Regex metacharacters in the expectation are literal. A commit sha has none,
  // but `-dirty` is appended by a shell and the value is not this code's to
  // trust: an unescaped `.` would match any character and quietly widen the
  // comparison.
  test('the expectation is a literal, not a pattern', () => {
    expect(reportsCommit('mosd 0.1.0 (aXb)', 'a.b')).toBe(false)
    expect(reportsCommit('mosd 0.1.0 (a.b)', 'a.b')).toBe(true)
  })
})

describe('judge -- the build commit, asserted only against a recorded fact', () => {
  const mosd: Artifact = { ...versionArtifact('mosd', '/usr/bin/mosd', () => pin('0.1.0')), embedsBuildCommit: true }
  const fact = (commit?: string): BuildCommitFact => ({ commit, source: '_out/x64/mosd-build.txt' })

  test('the reported commit agreeing with the recorded one passes, and names both', () => {
    const r = judge(mosd, pin('0.1.0'), ok('mosd 0.1.0 (00b674e9a628)'), fact('00b674e9a628'))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('reports the commit 00b674e9a628')
    expect(r.message).toContain('_out/x64/mosd-build.txt')
  })

  test('the reported commit disagreeing FAILS, even though the version is right', () => {
    const r = judge(mosd, pin('0.1.0'), ok('mosd 0.1.0 (deadbeefcafe)'), fact('00b674e9a628'))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('00b674e9a628')
    expect(r.message).toContain('deadbeefcafe')
    expect(r.message).toMatch(/not from the build that record describes/)
  })

  test('a binary reporting unknown against a recorded commit FAILS, and says why', () => {
    const r = judge(mosd, pin('0.1.0'), ok('mosd 0.1.0 (unknown)'), fact('00b674e9a628'))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/MOS_BUILD_COMMIT not passed in/)
  })

  // RFCT-113 M7d's instruction for an unavailable fact: print it, assert
  // nothing. The distinction that matters is that the row does not read like a
  // commit that was checked and agreed.
  test('no recorded commit means the row PASSES and says the commit was not asserted', () => {
    for (const f of [undefined, fact(undefined), fact('')]) {
      const r = judge(mosd, pin('0.1.0'), ok('mosd 0.1.0 (00b674e9a628)'), f)
      expect(r.verdict).toBe('pass')
      expect(r.message).toContain('commit was NOT asserted')
      expect(r.message).not.toContain('reports the commit')
    }
  })

  test('an artifact that embeds no commit is not asked about one, whatever the fact says', () => {
    const crun = versionArtifact('crun', '/usr/bin/crun', () => pin('1.29.1'))
    const r = judge(crun, pin('1.29.1'), ok('crun version 1.29.1'), fact('00b674e9a628'))
    expect(r.verdict).toBe('pass')
    expect(r.message).not.toContain('commit')
  })

  // The commit half is reached only AFTER the version half. A binary with the
  // wrong version and the right commit is still a failure about the version,
  // and the message must not be about the commit instead.
  test('a wrong version still fails as a version failure, commit or no commit', () => {
    const r = judge(mosd, pin('0.1.0'), ok('mosd 9.9.9 (00b674e9a628)'), fact('00b674e9a628'))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/pin was bumped without rebuilding the artifact/)
  })
})

describe('readMosdBuildFact -- what the build recorded, never what HEAD says', () => {
  test('an absent record is printed, not refused: no commit, and a source that says why', () => {
    const dir = join(scratch(), 'no-mosd-record')
    mkdirSync(dir, { recursive: true })
    const f = readMosdBuildFact('x64', dir)
    expect(f.commit).toBeUndefined()
    expect(f.source).toMatch(/does not exist/)
    expect(f.source).toMatch(/build-target\.sh/)
  })

  test('a record with a commit is read, and the commit is the value the build embedded', () => {
    const dir = join(scratch(), 'mosd-record')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, MOSD_BUILD_RECORD_NAME),
      '# a comment with no tab, which must not become a key\n'
      + 'target\tx86_64-unknown-linux-gnu\nelf-arch\tx86-64\ncommit\t00b674e9a628\n',
    )
    const f = readMosdBuildFact('x64', dir)
    expect(f.commit).toBe('00b674e9a628')
  })

  test('a dirty commit is read verbatim, marker and all', () => {
    const dir = join(scratch(), 'mosd-record-dirty')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, MOSD_BUILD_RECORD_NAME), 'commit\t00b674e9a628-dirty\n')
    expect(readMosdBuildFact('x64', dir).commit).toBe('00b674e9a628-dirty')
  })

  // AN EMPTY COMMIT IS "the build could not resolve one", which is a different
  // statement from "no record was written", and the two must not look alike:
  // one is an image built outside a checkout, the other is an image built
  // before this record existed.
  test('an empty commit is not a commit, and says something different from an absent record', () => {
    const dir = join(scratch(), 'mosd-record-empty')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, MOSD_BUILD_RECORD_NAME), 'target\tx86_64-unknown-linux-gnu\ncommit\t\n')
    const f = readMosdBuildFact('x64', dir)
    expect(f.commit).toBeUndefined()
    expect(f.source).toMatch(/records an EMPTY commit/)
    expect(f.source).not.toMatch(/does not exist/)
  })

  // A RECORD THAT EXISTS AND CANNOT BE READ IS A REFUSAL. Treating it as
  // "nothing recorded" would let a malformed file switch the assertion off.
  test('a record with no commit field is refused, naming the file and the writer', () => {
    const dir = join(scratch(), 'mosd-record-broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, MOSD_BUILD_RECORD_NAME), 'target\tx86_64-unknown-linux-gnu\n')
    expect(() => readMosdBuildFact('x64', dir)).toThrow(/carries no `commit` field/)
    expect(() => readMosdBuildFact('x64', dir)).toThrow(/build-target\.sh writes one on every build/)
  })
})

describe('firstLine', () => {
  test('takes the first non-empty line, trimmed', () => {
    expect(firstLine('\n\n  rauc 1.13  \nsecond\n')).toBe('rauc 1.13')
  })
  test('is empty for output that has none', () => {
    expect(firstLine('   \n\n')).toBe('')
  })
})

describe('pinSource', () => {
  test('is repo-relative, so four Cargo.toml rows are four different files', () => {
    expect(pinSource(join(REPO_ROOT, 'mosd', 'mqttd', 'Cargo.toml'))).toBe('mosd/mqttd/Cargo.toml')
    expect(pinSource(join(REPO_ROOT, 'mosd', 'broker', 'Cargo.toml'))).toBe('mosd/broker/Cargo.toml')
  })
  test('leaves a path outside the repository alone rather than mangling it', () => {
    expect(pinSource('/elsewhere/versions.env')).toBe('/elsewhere/versions.env')
  })
})

// ─── judge ──────────────────────────────────────────────────────────────────

describe('judge -- the version contract', () => {
  test('exit 0 and the pinned version passes, and says where the pin came from', () => {
    const r = judge(versionArtifact(), pin('v1.2.3', '1.2.3'), ok('thing 1.2.3'))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('THING_VERSION=v1.2.3')
  })

  test('exit 0 and the WRONG version fails, naming both sides', () => {
    const r = judge(versionArtifact(), pin('v1.2.3', '1.2.3'), ok('thing 1.2.4'))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('1.2.4')
    expect(r.message).toContain('expected 1.2.3')
    expect(r.message).toMatch(/pin was bumped without rebuilding the artifact/)
  })

  test('exit 0 and NO version at all fails, and says so in those words', () => {
    const r = judge(versionArtifact(), pin('v1.2.3', '1.2.3'), ok('thing: no idea'))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('NO version at all')
  })

  // EVERY DIAGNOSIS, AGAINST THE STATUS AND TEXT THAT WERE MEASURED PRODUCING IT.
  //
  // RFCT-113 M7c. These cases used to assert the OLD map -- 126 for wrong-arch
  // and for an unresolvable loader, 127 for a missing path -- and they passed,
  // because a fabricated `ExecResult` lets the test choose the status whose
  // diagnosis it then asserts. Two of the three were wrong about the real
  // world; `diagnose`'s comment carries the measurement, and
  // src/smoke-negative.ts drives all three through a real container so that
  // this table can never again agree with itself and with nothing else.
  //
  // The literals below are the MEASURED first lines, verbatim, not paraphrases.
  const WRONG_ARCH = { status: 255, stdout: '', stderr: 'exec /usr/bin/crun: exec format error\n' }
  const MISSING_SONAME = {
    status: 127,
    stdout: '',
    stderr: '/usr/bin/rauc: error while loading shared libraries: libjson-glib-1.0.so.0: '
      + 'cannot open shared object file: No such file or directory\n',
  }
  const ABSENT_PATH = {
    status: 127,
    stdout: '',
    stderr: 'docker: Error response from daemon: ... exec: "/usr/bin/nope": stat /usr/bin/nope: '
      + 'no such file or directory.\n',
  }
  const NOT_EXECUTABLE = {
    status: 126,
    stdout: '',
    stderr: 'docker: Error response from daemon: ... exec: "/usr/bin/crun": permission denied.\n',
  }

  test('a wrong-arch binary is ENOEXEC at 255, and is NOT reported as the program refusing', () => {
    const r = judge(versionArtifact(), pin('1.2.3'), WRONG_ARCH)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/could not be executed AT ALL/)
    expect(r.message).toMatch(/ENOEXEC/)
    // The regression this replaced: 255 fell through to the catch-all.
    expect(r.message).not.toMatch(/the program ran and refused/)
  })

  test('a missing soname is 127 and is NOT reported as a missing path', () => {
    const r = judge(versionArtifact(), pin('1.2.3'), MISSING_SONAME)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/dynamic loader could not resolve it/)
    // The regression this replaced: it shares 127 with the case below, and the
    // old map sent it to that one -- a reader was told to go and look at the
    // register or the install script for a path that is present.
    expect(r.message).not.toMatch(/path does not exist/)
  })

  test('an absent path is also 127, and the two 127s are told apart by what came back', () => {
    // THE POSITIVE CONTROL FOR THE CASE ABOVE. Same status, opposite diagnosis;
    // if `diagnose` keyed on the status alone this pair could not both pass.
    const r = judge(versionArtifact(), pin('1.2.3'), ABSENT_PATH)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/path does not exist in the factory root/)
    expect(r.message).not.toMatch(/dynamic loader/)
  })

  test('126 is a mode bit, and says so rather than naming an architecture', () => {
    const r = judge(versionArtifact(), pin('1.2.3'), NOT_EXECUTABLE)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/no\s+executable bit/)
    expect(r.message).toMatch(/90-pack/)
    expect(r.message).not.toMatch(/wrong-architecture/)
  })

  test('any other non-zero status is the program refusing, and is not confused with the rest', () => {
    const r = judge(versionArtifact(), pin('1.2.3'), { status: 1, stdout: '', stderr: 'nope' })
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/the program ran and refused/)
    expect(r.message).not.toMatch(/wrong-architecture|dynamic loader|executable bit/)
  })

  test('255 with no recognised text says so rather than inventing a cause', () => {
    const r = judge(versionArtifact(), pin('1.2.3'), { status: 255, stdout: '', stderr: 'docker: something else' })
    expect(r.message).toMatch(/could not be started on this path at all/)
    expect(r.message).toMatch(/read the stderr/)
  })

  test('the text outranks the status, in both directions', () => {
    // ld.so's sentence is what identifies a missing soname, not 127: the same
    // sentence arriving with any other status must reach the same conclusion,
    // because a runner that believed the number over the message would go back
    // to being right only about the cases somebody happened to fabricate.
    expect(judge(versionArtifact(), pin('1.2.3'), { ...MISSING_SONAME, status: 1 }).message)
      .toMatch(/dynamic loader could not resolve it/)
    expect(judge(versionArtifact(), pin('1.2.3'), { ...WRONG_ARCH, status: 126 }).message)
      .toMatch(/ENOEXEC/)
  })

  test('a non-zero status is a failure even when the output DOES carry the right version', () => {
    // The exit-status half of the Scope sentence, on its own. A binary that
    // prints the right version and dies is not a binary that runs.
    const r = judge(versionArtifact(), pin('1.2.3'), { status: 3, stdout: 'thing 1.2.3', stderr: '' })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('exited 3, expected 0')
  })
})

describe('judge -- the exec-only and unclaimed contracts', () => {
  const execArtifact: Artifact = {
    name: 'static-thing',
    path: '/usr/bin/static-thing',
    pin: () => pin('v0.2.1', '0.2.1'),
    contract: { kind: 'exec', argv: [] },
  }

  test('exec-only passes on exit 0 and says no version was asserted', () => {
    const r = judge(execArtifact, pin('v0.2.1', '0.2.1'), ok('usage: static-thing ...'))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('no version asserted')
  })

  test('exec-only still fails on a non-zero exit', () => {
    expect(judge(execArtifact, pin('v0.2.1', '0.2.1'), { status: 1, stdout: '', stderr: 'x' }).verdict).toBe('fail')
  })

  test('exec-only does NOT go red on output that carries the wrong version', () => {
    // Stated so the difference between the two contracts is a decision on
    // record rather than an accident of which branch ran first.
    expect(judge(execArtifact, pin('v0.2.1', '0.2.1'), ok('static-thing 9.9.9')).verdict).toBe('pass')
  })

  const unclaimedArtifact: Artifact = {
    name: 'daemon',
    path: '/usr/bin/daemon',
    pin: () => pin('0.1.0'),
    contract: { kind: 'unclaimed', why: 'it parses no argv and starts a server instead of printing a version' },
  }

  test('unclaimed is its own verdict -- not a pass, not a fail, and it carries the reason', () => {
    const r = judge(unclaimedArtifact, pin('0.1.0'), ok(''))
    expect(r.verdict).toBe('unclaimed')
    expect(r.kind).toBe('unclaimed')
    expect(r.message).toContain('NOT EXECUTED')
    expect(r.message).toContain('would have to report 0.1.0')
    expect(r.detail).toContain('starts a server')
  })

  test('an unclaimed artifact is never invoked, whatever the exec would have said', async () => {
    let calls = 0
    const exec: Exec = async () => {
      calls += 1
      return ok('daemon 0.1.0')
    }
    const r = await checkArtifact(unclaimedArtifact, exec)
    expect(calls).toBe(0)
    expect(r.verdict).toBe('unclaimed')
  })

  test('a claimed artifact IS invoked, with its installed path and its argv', async () => {
    // The positive control for the line above: `calls` can move.
    const seen: string[][] = []
    const exec: Exec = async argv => {
      seen.push([...argv])
      return ok('thing 1.2.3')
    }
    const r = await checkArtifact(versionArtifact('thing', '/usr/libexec/podman/thing'), exec)
    expect(seen).toEqual([['/usr/libexec/podman/thing', '--version']])
    expect(r.verdict).toBe('pass')
  })
})

// ─── catatonit: the normalisation, driven from the failing side ─────────────

describe('catatonit -- two normalisations, and a loose includes() would pass on anything', () => {
  // The exact string measured in the x64 factory root, and the exact shipped
  // pin. Both halves are real; neither is a plausible-looking stand-in.
  const SAID = 'tini version 0.2.1_catatonit'
  const catatonit = ARTIFACTS.find(a => a.name === 'catatonit')!

  test('the shipped pin and the real output agree, through both normalisations', () => {
    const p = catatonit.pin()
    // PIN SIDE: the git tag prefix comes off.
    expect(p.recorded).toBe('v0.2.1')
    expect(p.expected).toBe('0.2.1')
    // OUTPUT SIDE: `_catatonit` terminates the token, it is not trimmed by a
    // rule written for this one artifact.
    expect(versionTokens(SAID)).toEqual(['0.2.1'])
    expect(judge(catatonit, p, ok(SAID)).verdict).toBe('pass')
  })

  // THE FAILING SIDE, which is what makes the line above evidence.
  test('a wrong pin turns it RED -- so this is not a check that cannot fail', () => {
    const r = judge(catatonit, { ...catatonit.pin(), recorded: 'v0.2.2', expected: '0.2.2' }, ok(SAID))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('expected 0.2.2')
    expect(r.message).toContain('0.2.1')
  })

  // WHY IT IS EQUALITY AGAINST AN EXTRACTED TOKEN AND NOT A SUBSTRING TEST.
  // Every one of these `includes` is TRUE on the real output, so a runner built
  // that way would accept four different wrong pins and one right one, and
  // would look identical doing it.
  test('a loose includes() on the raw line would accept pins that are wrong', () => {
    for (const wrong of ['0.2', '2.1', '0.2.1_cat', 'version 0.2.1']) {
      expect(SAID.includes(wrong)).toBe(true)          // the loose test passes...
      const r = judge(catatonit, { ...catatonit.pin(), recorded: wrong, expected: wrong }, ok(SAID))
      expect(r.verdict).toBe('fail')                    // ...and this one does not
    }
  })

  test('and the skew in the other direction is caught too', () => {
    // A 0.2.1 binary must not satisfy a 0.2.10 pin. Maximal munch is what makes
    // this work; a substring test would get it backwards.
    const r = judge(catatonit, { ...catatonit.pin(), recorded: 'v0.2.10', expected: '0.2.10' }, ok(SAID))
    expect(r.verdict).toBe('fail')
  })

  test('exit 0 is still asserted, which is the exec-only conjunct Scope asks for', () => {
    const r = judge(catatonit, catatonit.pin(), { status: 1, stdout: SAID, stderr: '' })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('exited 1, expected 0')
  })
})

// ─── THE VERSION LOOP, as a loop ────────────────────────────────────────────

describe('the version loop closes: bump the pin, do not rebuild, run goes red', () => {
  test('one fixture file, one unchanged binary, one edit -- and the verdict flips', async () => {
    const file = join(scratch(), 'loop-versions.env')
    const original = 'THING_VERSION=v1.2.3\nTHING_SHA256=deadbeef\n'
    writeFileSync(file, original)

    // The binary is built ONCE and never rebuilt: this output is a constant for
    // the whole test, exactly as a binary in an already-built image is.
    const exec: Exec = async () => ok('thing 1.2.3')
    const artifact: Artifact = {
      name: 'thing',
      path: '/usr/bin/thing',
      pin: () => readPin(file, 'THING_VERSION'),
      contract: { kind: 'version', argv: ['--version'] },
    }

    // Green, against the pin as recorded.
    const before = await checkArtifact(artifact, exec)
    expect(before.verdict).toBe('pass')

    // Now bump the pin and nothing else. The mutation refuses to be a no-op.
    writeFileSync(file, mutate(readFileSync(file, 'utf8'), 'THING_VERSION=v1.2.3', 'THING_VERSION=v1.2.4'))

    const after = await checkArtifact(artifact, exec)
    expect(after.verdict).toBe('fail')
    expect(after.message).toContain('expected 1.2.4')
    expect(after.message).toContain('reports 1.2.3')

    // And back again, so the red is about the edit rather than about the file
    // having been touched at all.
    writeFileSync(file, original)
    expect((await checkArtifact(artifact, exec)).verdict).toBe('pass')
  })

  test('the whole run goes red, not just the one artifact', async () => {
    const file = join(scratch(), 'loop-run-versions.env')
    writeFileSync(file, 'THING_VERSION=v1.2.3\n')
    const artifacts: Artifact[] = [
      { name: 'a', path: '/usr/bin/a', pin: () => readPin(file, 'THING_VERSION'), contract: { kind: 'version', argv: ['--version'] } },
      { name: 'b', path: '/usr/bin/b', pin: () => readPin(file, 'THING_VERSION'), contract: { kind: 'version', argv: ['--version'] } },
    ]
    const exec: Exec = async () => ok('x 1.2.3')

    // `allowUnclaimed: []` because this synthetic register has no unclaimed
    // entries and the shipped authorisation list names two. That the guard
    // fires here at all is the point of it: a register other than the shipped
    // one has to say what it authorises, rather than inheriting an answer.
    const green = await smokeRun({ board: 'x64', artifacts, exec, files: [file], allowUnclaimed: [] })
    expect(green.conclusion.conclusion).toBe('PASS')
    expect(green.conclusion.exitCode).toBe(0)

    writeFileSync(file, mutate(readFileSync(file, 'utf8'), 'v1.2.3', 'v9.9.9'))
    const red = await smokeRun({ board: 'x64', artifacts, exec, files: [file], allowUnclaimed: [] })
    expect(red.conclusion.conclusion).toBe('FAIL')
    expect(red.conclusion.exitCode).toBe(1)
    expect(red.conclusion.counts.fail).toBe(2)
  })
})

// ─── conclude, and the vacuity guard ────────────────────────────────────────

describe('conclude', () => {
  const r = (verdict: SmokeResult['verdict']): SmokeResult =>
    ({ name: 'x', path: '/usr/bin/x', kind: 'version', verdict, message: '' })

  test('all pass, and the count is the register size -- PASS, exit 0', () => {
    const c = conclude([r('pass'), r('pass')], 2)
    expect(c.conclusion).toBe('PASS')
    expect(c.exitCode).toBe(0)
    // THE SAME FOUR NUMBERS THE OTHER TWO CONCLUSIONS PRINT, in the same order.
    // Until M7d this line read `(2/2 artifacts executed, version identity
    // asserted)` -- a second format for one summary, which left `0 unclaimed`
    // unstated on the only line most readers look at.
    expect(c.line).toBe('RESULT: PASS (2 pass, 0 fail, 0 unclaimed, of 2)')
  })

  test('one fail outranks everything else', () => {
    const c = conclude([r('pass'), r('fail'), r('unclaimed')], 3)
    expect(c.conclusion).toBe('FAIL')
    expect(c.exitCode).toBe(1)
  })

  test('no fails but an unclaimed is INCOMPLETE, and INCOMPLETE exits non-zero', () => {
    const c = conclude([r('pass'), r('unclaimed')], 2)
    expect(c.conclusion).toBe('INCOMPLETE')
    expect(c.exitCode).toBe(1)
    expect(c.line).toMatch(/not a pass and is not a skip/)
  })

  // THE VACUITY GUARDS. `RESULT: PASS (6/6)` is invariant under a run that
  // threw half its work away, which is exactly how the shell lint this package
  // replaced reported PASS over zero checks.
  test('fewer conclusions than the register is a FAIL whatever the conclusions were', () => {
    const c = conclude([r('pass'), r('pass')], 12)
    expect(c.conclusion).toBe('FAIL')
    expect(c.exitCode).toBe(1)
    expect(c.line).toMatch(/2 conclusions from a register of 12/)
  })

  test('more conclusions than the register is a FAIL too', () => {
    expect(conclude([r('pass'), r('pass'), r('pass')], 2).conclusion).toBe('FAIL')
  })

  test('an EMPTY register concludes nothing and must not exit 0', () => {
    const c = conclude([], 0)
    expect(c.conclusion).toBe('FAIL')
    expect(c.exitCode).toBe(1)
    expect(c.line).toMatch(/EMPTY register/)
  })
})

// ─── the image record ───────────────────────────────────────────────────────

describe('parseFactoryRootRecord', () => {
  const GOOD = [
    '# The x64 factory root, exported as an OCI image.',
    '# Load it with: docker load -i /x/factory-root.oci',
    'ref\tlocalhost/mos-factory-root:x64',
    'platform\tlinux/amd64',
    'target\tfactory-root',
    'archive\tfactory-root.oci',
    'bytes\t250209280',
    'sha256\t6e036711ce306cd2',
    'source-date-epoch\t1577836800',
    '',
  ].join('\n')

  test('reads the shape os/build/src/stages.ts writes', () => {
    const rec = parseFactoryRootRecord(GOOD, '/x/factory-root.txt')
    expect(rec.ref).toBe('localhost/mos-factory-root:x64')
    expect(rec.platform).toBe('linux/amd64')
    expect(rec.bytes).toBe(250209280)
    expect(rec.sha256).toBe('6e036711ce306cd2')
  })

  test('the comment lines are skipped rather than read as fields', () => {
    // `# Load it with: docker load -i ...` has no tab, so it cannot become a
    // key -- but a reader that split on whitespace would make one.
    expect(parseFactoryRootRecord(GOOD, '/x').archive).toBe('factory-root.oci')
  })

  test('a missing field is refused, naming it', () => {
    const withoutRef = mutate(GOOD, /^ref\t.*\n/m, '')
    expect(() => parseFactoryRootRecord(withoutRef, '/x/factory-root.txt')).toThrow(/carries no ref/)
  })

  test('a bytes that is not a positive integer is refused', () => {
    expect(() => parseFactoryRootRecord(mutate(GOOD, 'bytes\t250209280', 'bytes\tlots'), '/x')).toThrow(/not a positive integer/)
    expect(() => parseFactoryRootRecord(mutate(GOOD, 'bytes\t250209280', 'bytes\t0'), '/x')).toThrow(/not a positive integer/)
  })

  // THERE IS DELIBERATELY NO CASE HERE THAT READS THE REAL
  // `_out/x64/factory-root.txt`. It would pass on a host that had built an
  // image and take a silent no-op branch on one that had not -- and this suite
  // must run green with `_out/` absent, so the no-op branch is the one CI takes
  // every time. checks.ts draws the same line in the same words: "a suite that
  // read the real `_out/` would pass on a host that had built an image and fail
  // on one that had not, and a skip reports the same green as a pass."
  //
  // The real record IS parsed, by the real CLI, in `run.sh --smoke` -- which is
  // an integration run against a built image and reports what it read on its
  // first line.
})

describe('readFactoryRoot -- a missing image REFUSES rather than skipping', () => {
  test('names the file and the command that would build it', () => {
    const empty = join(scratch(), 'no-such-out')
    mkdirSync(empty, { recursive: true })
    expect(() => readFactoryRoot('x64', empty)).toThrow(/factory-root\.txt does not exist/)
    expect(() => readFactoryRoot('x64', empty)).toThrow(/MOS_BOARD=x64 bash os\/rootfs\/build-v2\.sh/)
    expect(() => readFactoryRoot('x64', empty)).toThrow(/a skip reports the same green as a pass/)
  })

  test('and the positive control: a directory with both files is read', () => {
    const dir = join(scratch(), 'fake-out')
    mkdirSync(dir, { recursive: true })
    const { record, archive } = factoryRootPaths('x64', dir)
    writeFileSync(archive, 'not really an oci archive')
    writeFileSync(record, 'ref\tlocalhost/x:1\nplatform\tlinux/amd64\narchive\tfactory-root.oci\nbytes\t7\nsha256\tabc\n')
    const rec = readFactoryRoot('x64', dir)
    expect(rec.ref).toBe('localhost/x:1')
    expect(rec.archivePath).toBe(archive)
  })

  test('a record present with no archive beside it is refused too', () => {
    const dir = join(scratch(), 'record-only')
    mkdirSync(dir, { recursive: true })
    writeFileSync(factoryRootPaths('x64', dir).record, 'ref\tx\n')
    expect(() => readFactoryRoot('x64', dir)).toThrow(/factory-root\.oci does not exist/)
  })
})

// ─── the declined-feature guard ─────────────────────────────────────────────

describe('declinedFeatures -- reading what the build left out, off its own manifest', () => {
  // The exact line os/build/src/stages.ts writes when nothing was declined,
  // captured from the real _out/x64/rootfs-stages.txt this tree produced.
  const NONE = '# os/rootfs stage chain, as built. One line per stage, in build order.\n'
    + '# declined: (none -- every feature stage in the directory was built)\n'
    + '# name\tcontent-hash\ttag\n10-base\tabc\tmos-rootfs-stage:x64-10-base\n'

  test('the parenthesised form means nothing was declined', () => {
    expect(declinedFeatures(NONE)).toEqual([])
  })

  test('a real declined list is read, in the order it was written', () => {
    const some = mutate(NONE, '# declined: (none -- every feature stage in the directory was built)', '# declined: containers mqtt')
    expect(declinedFeatures(some)).toEqual(['containers', 'mqtt'])
  })

  // "A `# declined:` line naming nothing is not the same statement as no line
  // at all" -- stageManifest's own words. The two must not look alike here
  // either, so a manifest with no line is refused rather than read as "none".
  test('a manifest with NO declined line is refused, not read as nothing declined', () => {
    const missing = mutate(NONE, /^# declined:.*\n/m, '')
    expect(() => declinedFeatures(missing)).toThrow(/carries no `# declined:` line/)
  })
})

// ─── the preflight, and the arm64 wall ──────────────────────────────────────

describe('preflight -- the positive control that runs before any conclusion', () => {
  test('a root that can execute /bin/true is accepted', async () => {
    const seen: string[][] = []
    const exec: Exec = async argv => {
      seen.push([...argv])
      return ok('')
    }
    await preflight(exec, 'linux/amd64')
    expect(seen).toEqual([['/bin/true']])
  })

  // THE arm64 WALL, reachable without an arm64 image. This is the exact status
  // and message measured on this host: `docker run --platform linux/arm64
  // arm64v8/busybox /bin/true` exits 255 with `exec /bin/true: exec format
  // error`, with binfmt_misc not mounted.
  test('an exec format error is refused with the platform and the remedy', async () => {
    const exec: Exec = async () => ({ status: 255, stdout: '', stderr: 'exec /bin/true: exec format error' })
    await expect(preflight(exec, 'linux/arm64')).rejects.toThrow(/linux\/arm64 and this host cannot run it/)
    await expect(preflight(exec, 'linux/arm64')).rejects.toThrow(/tonistiigi\/binfmt --install/)
  })

  test('the refusal explains why it is not twelve separate failures', async () => {
    const exec: Exec = async () => ({ status: 255, stdout: '', stderr: 'exec format error' })
    await expect(preflight(exec, 'linux/arm64')).rejects.toThrow(/twelve wrong diagnoses of one condition/)
  })

  test('a non-zero exit that is NOT a format error does not claim an emulation problem', async () => {
    const exec: Exec = async () => ({ status: 1, stdout: '', stderr: 'permission denied' })
    await expect(preflight(exec, 'linux/amd64')).rejects.toThrow(/cannot execute anything on this host/)
    await expect(preflight(exec, 'linux/amd64')).rejects.not.toThrow(/tonistiigi/)
  })
})

// ─── the argv the seam actually builds ──────────────────────────────────────

describe('dockerArgv', () => {
  test('runs the absolute path in the loaded ref, with no network and no leftover container', () => {
    expect(dockerArgv('localhost/mos-factory-root:x64', ['/usr/bin/crun', '--version'])).toEqual([
      'docker', 'run', '--rm', '--network', 'none',
      'localhost/mos-factory-root:x64', '/usr/bin/crun', '--version',
    ])
  })
})

// ─── the whole run, over the SHIPPED register, with a fabricated image ──────

describe('smokeRun over the real register', () => {
  /** Answer every artifact with the version its own pin records. */
  const honest: Exec = async argv => {
    const path = argv[0]!
    const artifact = ARTIFACTS.find(a => a.path === path)
    if (artifact === undefined) return { status: 127, stdout: '', stderr: 'no such file or directory' }
    return ok(`${artifact.name} ${artifact.pin().expected}`)
  }

  // UNTIL M7d THIS CASE READ "ten pass, two unclaimed, and that is INCOMPLETE",
  // because mosd and apid had no `--version` to ask for. The user lifted
  // PLAN-014's exclusion on `mosd/` Rust sources on 2026-08-26, both got one,
  // and the register stopped calling them unclaimed. This is the same assertion
  // over the new answer, not a weakened one: the count is still the register's
  // full size and the conclusion is still driven from what every entry did.
  test('the twelve shipped artifacts all answer, and that is PASS', async () => {
    const run = await smokeRun({ board: 'x64', exec: honest })
    expect(run.results.length).toBe(ARTIFACTS.length)
    expect(run.conclusion.counts.pass).toBe(12)
    expect(run.conclusion.counts.fail).toBe(0)
    expect(run.conclusion.counts.unclaimed).toBe(0)
    expect(run.conclusion.conclusion).toBe('PASS')
    expect(run.conclusion.exitCode).toBe(0)
  })

  // `honest` prints no commit, and no build fact was supplied, so the commit
  // half of mosd's and apid's contract asserted NOTHING -- and the row says so
  // rather than reading as a commit that was checked and agreed.
  test('with no build record supplied, the commit is not asserted and the row says so', async () => {
    const run = await smokeRun({ board: 'x64', exec: honest })
    for (const name of ['mosd', 'apid']) {
      const r = run.results.find(x => x.name === name)!
      expect(r.verdict).toBe('pass')
      expect(r.message).toContain('commit was NOT asserted')
    }
    // ...and the ten that embed no commit say nothing about one either way.
    expect(run.results.find(r => r.name === 'crun')!.message).not.toContain('commit')
  })

  // THE COMMIT HALF DRIVING THE WHOLE RUN RED. The binaries are unchanged; only
  // the recorded build fact moves, which is the shape of the failure this
  // check exists for -- an image whose mosd is not from the build beside it.
  test('a build record naming a different commit takes the run to FAIL', async () => {
    const stamped: Exec = async argv => {
      const artifact = ARTIFACTS.find(a => a.path === argv[0])
      if (artifact === undefined) return { status: 127, stdout: '', stderr: 'no such file or directory' }
      const suffix = artifact.embedsBuildCommit === true ? ' (aaaaaaaaaaaa)' : ''
      return ok(`${artifact.name} ${artifact.pin().expected}${suffix}`)
    }

    const agreeing = await smokeRun({
      board: 'x64',
      exec: stamped,
      buildCommit: { commit: 'aaaaaaaaaaaa', source: '_out/x64/mosd-build.txt' },
    })
    expect(agreeing.conclusion.conclusion).toBe('PASS')
    expect(agreeing.results.find(r => r.name === 'mosd')!.message).toContain('reports the commit aaaaaaaaaaaa')

    const disagreeing = await smokeRun({
      board: 'x64',
      exec: stamped,
      buildCommit: { commit: 'bbbbbbbbbbbb', source: '_out/x64/mosd-build.txt' },
    })
    expect(disagreeing.conclusion.conclusion).toBe('FAIL')
    // Exactly the two that embed one, not twelve.
    expect(disagreeing.conclusion.counts.fail).toBe(2)
    expect(disagreeing.results.filter(r => r.verdict === 'fail').map(r => r.name).sort())
      .toEqual(['apid', 'mosd'])
  })

  test('one binary at the wrong path takes the run to FAIL', async () => {
    const moved = ARTIFACTS.map(a => (a.name === 'crun' ? { ...a, path: '/usr/bin/crun-moved' } : a))
    // The mutation is a mutation: exactly one path changed.
    expect(moved.filter((a, i) => a.path !== ARTIFACTS[i]!.path).length).toBe(1)

    const run = await smokeRun({ board: 'x64', artifacts: moved, exec: honest })
    expect(run.conclusion.conclusion).toBe('FAIL')
    const crun = run.results.find(r => r.name === 'crun')!
    expect(crun.verdict).toBe('fail')
    expect(crun.message).toMatch(/path does not exist in the factory root/)
  })

  // THE GUARD HAS TO BE CALLED, not merely to exist. Found by mutation: with
  // `unclaimedFaults` still correct but no longer consulted by `smokeRun`, the
  // whole suite stayed green -- every case was testing the function and none
  // was testing that the runner asks it. A guard nothing calls is a guard
  // nobody has run, which is the same defect one level up from a guard nothing
  // can drive red.
  test('an unauthorised unclaimed artifact refuses the RUN, and executes nothing', async () => {
    let calls = 0
    const counting: Exec = async argv => {
      calls += 1
      return honest(argv)
    }
    const withRogue = ARTIFACTS.map(a =>
      a.name === 'conmon'
        ? { ...a, contract: { kind: 'unclaimed' as const, why: 'MEASURED: fabricated for this case' } }
        : a)
    // The mutation is a mutation.
    expect(ARTIFACTS.find(a => a.name === 'conmon')!.contract.kind).toBe('version')

    await expect(smokeRun({ board: 'x64', artifacts: withRogue, exec: counting })).rejects.toThrow(
      /marks artifacts unclaimed that nothing authorised, so nothing was executed/,
    )
    expect(calls).toBe(0)

    // Positive control on the same counter: the shipped register runs.
    await smokeRun({ board: 'x64', artifacts: ARTIFACTS, exec: counting })
    expect(calls).toBeGreaterThan(0)
  })

  // M7b wrote this against a register whose steady state was two unclaimed
  // artifacts. M7d emptied that set, so the shipped run has no names to print
  // -- and asserting "the names appear" over a run with no unclaimed artifacts
  // is a test that cannot fail. The subject moves to a register that HAS one:
  // the property under test is that `conclude` names members rather than only
  // counting them, and that property has to be exercised where there are
  // members.
  test('the RESULT line NAMES the unclaimed artifacts, not just their count', async () => {
    const withUnclaimed = ARTIFACTS.map(a =>
      a.name === 'conmon'
        ? { ...a, contract: { kind: 'unclaimed' as const, why: 'MEASURED: fabricated for this case' } }
        : a)
    // The mutation is a mutation.
    expect(ARTIFACTS.find(a => a.name === 'conmon')!.contract.kind).toBe('version')

    const run = await smokeRun({
      board: 'x64', artifacts: withUnclaimed, exec: honest, allowUnclaimed: ['conmon'],
    })
    // Register order, not sorted: the table above prints the same order, and a
    // summary that reordered its own rows would be one more thing to reconcile.
    expect(run.conclusion.line).toContain('UNCLAIMED: conmon')
    // A count alone would satisfy a reader and nobody else.
    expect(run.conclusion.line).toContain('1 unclaimed')
    expect(run.conclusion.conclusion).toBe('INCOMPLETE')

    // AND THE SHIPPED REGISTER HAS NONE TO NAME, which is the state M7d put it
    // in and is asserted here rather than left implicit.
    const shipped = await smokeRun({ board: 'x64', exec: honest })
    expect(shipped.conclusion.line).toContain('0 unclaimed')
    expect(shipped.conclusion.line).not.toContain('UNCLAIMED:')
  })

  test('a FAIL line names what failed AND what stayed unclaimed', () => {
    const results = [
      { name: 'crun', path: '/usr/bin/crun', kind: 'version' as const, verdict: 'fail' as const, message: '' },
      { name: 'mosd', path: '/usr/bin/mosd', kind: 'unclaimed' as const, verdict: 'unclaimed' as const, message: '' },
      { name: 'rauc', path: '/usr/bin/rauc', kind: 'version' as const, verdict: 'pass' as const, message: '' },
    ]
    const c = conclude(results, 3)
    expect(c.conclusion).toBe('FAIL')
    expect(c.line).toContain('FAILED: crun')
    expect(c.line).toContain('UNCLAIMED: mosd')
  })

  test('a register that disagrees with the pin files executes NOTHING', async () => {
    let calls = 0
    const counting: Exec = async argv => {
      calls += 1
      return honest(argv)
    }
    const withoutCrun = ARTIFACTS.filter(a => a.name !== 'crun')
    expect(withoutCrun.length).toBe(ARTIFACTS.length - 1)

    await expect(smokeRun({ board: 'x64', artifacts: withoutCrun, exec: counting })).rejects.toThrow(
      /register and the version pins disagree, so nothing was executed/,
    )
    expect(calls).toBe(0)

    // Positive control on the same counter: with the register intact it moves.
    await smokeRun({ board: 'x64', artifacts: ARTIFACTS, exec: counting })
    expect(calls).toBeGreaterThan(0)
  })
})
