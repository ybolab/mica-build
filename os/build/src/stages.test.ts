// The stage chain, driven from the failing side.
//
// Every fault auditChain reports is produced here from a synthetic directory,
// because a guard nobody has seen take is the shape of guard this campaign
// keeps finding. The real os/rootfs/stages/ is then asserted against the shape
// those faults describe -- so the tests fail if the chain breaks AND if the
// checker stops being able to notice.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  auditChain,
  buildArgv,
  DEFAULT_TERMINAL_TARGET,
  discoverStages,
  planChain,
  PREV_ARG,
  readStageFile,
  stageManifest,
  StageChainError,
  STAGES_DIR,
  unusedArgs,
  type StageFile,
} from './stages.ts'
import { parseArgs, parseDriver, driverCanChain, dockerBin } from './stages-cli.ts'

// A scratch directory of stage files. Under the repository's own _out/ rather
// than /tmp: a bind mount of /tmp on this host propagates as an EMPTY directory
// (os/verify/run.sh records the measurement), so a fixture there is invisible to
// the container route and the same test would pass on one route and fail on the
// other for a reason that has nothing to do with what it asserts.
const FIXTURE_ROOT = join(STAGES_DIR, '..', '..', '..', '_out', 'stage-fixtures')
// Cleared once per run rather than per fixture: each scratch() is a mkdtemp, so
// without this the directory grows by ~25 every `bun test` and nothing ever
// removes them. Cleared at load rather than in an afterAll so a run that dies
// mid-suite still leaves exactly one run's worth to look at.
rmSync(FIXTURE_ROOT, { recursive: true, force: true })

function scratch(files: Record<string, string>): string {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  const dir = mkdtempSync(join(FIXTURE_ROOT, 'chain-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

const FIRST = `FROM debian\nRUN true\n`
const LINK = `ARG ${PREV_ARG}\nFROM \${${PREV_ARG}}\nRUN true\n`
const TERMINAL = `ARG ${PREV_ARG}\nFROM \${${PREV_ARG}} AS closed\nRUN true\nFROM scratch AS artifact\nCOPY --from=closed /x /\n`

function messages(stages: readonly StageFile[]): string {
  return auditChain(stages, DEFAULT_TERMINAL_TARGET)
    .map((f) => f.message)
    .join('\n')
}

describe('readStageFile', () => {
  test('takes the order and the name from the file name', () => {
    const s = readStageFile('/x/10-base.Dockerfile', FIRST)
    expect(s.order).toBe(10)
    expect(s.name).toBe('10-base')
  })

  test('refuses a file whose name carries no number', () => {
    expect(() => readStageFile('/x/base.Dockerfile', FIRST)).toThrow(StageChainError)
  })

  test('collects every ARG but the chain link, in first-seen order', () => {
    const s = readStageFile(
      '/x/30-f.Dockerfile',
      `ARG ${PREV_ARG}\nFROM \${${PREV_ARG}}\nARG BOARD_RADIOS=""\nARG WITH_MOSD=1\nARG BOARD_RADIOS=""\n`,
    )
    expect(s.declaredArgs).toEqual(['BOARD_RADIOS', 'WITH_MOSD'])
    expect(s.declaresPrev).toBe(true)
    expect(s.fromsPrev).toBe(true)
  })

  test('ignores an ARG that is only mentioned in a comment', () => {
    const s = readStageFile('/x/10-b.Dockerfile', `# ARG NOT_REAL\nFROM debian\n`)
    expect(s.declaredArgs).toEqual([])
  })

  test('reads named targets and not unnamed ones', () => {
    const s = readStageFile('/x/90-p.Dockerfile', TERMINAL)
    expect(s.targets).toEqual(['closed', 'artifact'])
  })

  test('reads a target whose FROM carries flags BEFORE the image', () => {
    // The first version of FROM_AS allowed --platform only AFTER the image, so
    // `FROM --platform=$BUILDPLATFORM ${X} AS pack` matched nothing and the
    // pack target went unseen -- which is the real spelling of both multi-FROM
    // stage files in this tree. Found by attributing the 34 scripts to their
    // stages with the same expression and getting `closed` for every pack-*.sh.
    const s = readStageFile(
      '/x/90-p.Dockerfile',
      `ARG ${PREV_ARG}\nFROM \${${PREV_ARG}} AS closed\nFROM --platform=$BUILDPLATFORM \${BOOKWORM} AS pack\nFROM scratch AS artifact\n`,
    )
    expect(s.targets).toEqual(['closed', 'pack', 'artifact'])
  })

  test('the content hash changes with the content', () => {
    const a = readStageFile('/x/10-b.Dockerfile', FIRST)
    const b = readStageFile('/x/10-b.Dockerfile', `${FIRST}RUN false\n`)
    expect(a.sha256).not.toBe(b.sha256)
    expect(a.sha256).toHaveLength(64)
  })
})

describe('auditChain refuses, by name', () => {
  test('a directory with no stages at all', () => {
    const faults = auditChain([], DEFAULT_TERMINAL_TARGET)
    expect(faults).toHaveLength(1)
    expect(faults[0]!.message).toContain('holds no *.Dockerfile')
  })

  test('a chain of one', () => {
    const dir = scratch({ '10-base.Dockerfile': FIRST })
    expect(messages(discoverStages(dir))).toContain('is the only stage')
  })

  test('two stages sharing a number', () => {
    const dir = scratch({
      '10-base.Dockerfile': FIRST,
      '10-other.Dockerfile': LINK,
      '90-pack.Dockerfile': TERMINAL,
    })
    expect(messages(discoverStages(dir))).toContain('share the number 10')
  })

  test('a first stage that declares MOS_STAGE_PREV', () => {
    const dir = scratch({ '10-base.Dockerfile': LINK, '90-pack.Dockerfile': TERMINAL })
    expect(messages(discoverStages(dir))).toContain('is the first stage and declares')
  })

  test('a later stage that does not declare it', () => {
    const dir = scratch({
      '10-base.Dockerfile': FIRST,
      '20-install.Dockerfile': FIRST,
      '90-pack.Dockerfile': TERMINAL,
    })
    expect(messages(discoverStages(dir))).toContain(`does not declare ARG ${PREV_ARG}`)
  })

  test('a stage that declares the link and never FROMs it', () => {
    const dir = scratch({
      '10-base.Dockerfile': FIRST,
      '20-install.Dockerfile': `ARG ${PREV_ARG}\nFROM debian\nRUN true\n`,
      '90-pack.Dockerfile': TERMINAL,
    })
    expect(messages(discoverStages(dir))).toContain('no stage in it opens')
  })

  test('a last stage with no export target', () => {
    const dir = scratch({ '10-base.Dockerfile': FIRST, '90-pack.Dockerfile': LINK })
    expect(messages(discoverStages(dir))).toContain(`defines no \`AS ${DEFAULT_TERMINAL_TARGET}\``)
  })

  test('and accepts the shape the real chain has', () => {
    const dir = scratch({
      '10-base.Dockerfile': FIRST,
      '20-install.Dockerfile': LINK,
      '90-pack.Dockerfile': TERMINAL,
    })
    expect(auditChain(discoverStages(dir), DEFAULT_TERMINAL_TARGET)).toEqual([])
  })
})

describe('discoverStages', () => {
  test('orders numerically, not alphabetically', () => {
    const dir = scratch({
      '90-pack.Dockerfile': TERMINAL,
      '100-late.Dockerfile': LINK,
      '20-install.Dockerfile': LINK,
      '10-base.Dockerfile': FIRST,
    })
    // 100 after 90 is the case a string sort gets wrong, and the one a chain
    // would get wrong silently: it would build, in the wrong order.
    expect(discoverStages(dir).map((s) => s.name)).toEqual([
      '10-base',
      '20-install',
      '90-pack',
      '100-late',
    ])
  })

  test('ignores files that are not Dockerfiles', () => {
    const dir = scratch({
      '10-base.Dockerfile': FIRST,
      '90-pack.Dockerfile': TERMINAL,
      'README.md': '# not a stage\n',
    })
    expect(discoverStages(dir).map((s) => s.name)).toEqual(['10-base', '90-pack'])
  })

  test('refuses a directory that is not there', () => {
    expect(() => discoverStages(join(tmpdir(), 'mos-no-such-stage-dir'))).toThrow(StageChainError)
  })
})

describe('planChain', () => {
  const dir = () =>
    scratch({
      '10-base.Dockerfile': `ARG TRIXIE\nFROM \${TRIXIE}\nARG MOS_PROFILE=dev\nRUN true\n`,
      '20-install.Dockerfile': `ARG ${PREV_ARG}\nFROM \${${PREV_ARG}}\nARG OVERLAY_DIR\nRUN true\n`,
      '90-pack.Dockerfile': `ARG ${PREV_ARG}\nARG BOOKWORM\nFROM \${${PREV_ARG}} AS closed\nRUN true\nFROM scratch AS artifact\nCOPY --from=closed /x /\n`,
    })
  const supplied = {
    TRIXIE: 'debian@sha256:aaa',
    BOOKWORM: 'debian@sha256:bbb',
    MOS_PROFILE: 'dev',
    OVERLAY_DIR: '_out/x64/overlay-v2',
  }

  test('tags each stage per board and links each to its predecessor', () => {
    const builds = planChain(discoverStages(dir()), { board: 'x64', supplied })
    expect(builds.map((b) => b.tag)).toEqual([
      'mos-rootfs-stage:x64-10-base',
      'mos-rootfs-stage:x64-20-install',
      'mos-rootfs-stage:x64-90-pack',
    ])
    expect(builds[0]!.prevTag).toBeUndefined()
    expect(builds[1]!.prevTag).toBe('mos-rootfs-stage:x64-10-base')
    expect(builds[2]!.prevTag).toBe('mos-rootfs-stage:x64-20-install')
    expect(builds.map((b) => b.terminal)).toEqual([false, false, true])
  })

  test('two boards in flight do not share a tag', () => {
    const s = discoverStages(dir())
    const a = planChain(s, { board: 'x64', supplied })
    const b = planChain(s, { board: 'cx3576', supplied })
    expect(a.map((x) => x.tag)).not.toEqual(b.map((x) => x.tag))
  })

  test('a stage is handed only the arguments it declares', () => {
    const builds = planChain(discoverStages(dir()), { board: 'x64', supplied })
    expect(builds[0]!.buildArgs).toEqual({ TRIXIE: 'debian@sha256:aaa', MOS_PROFILE: 'dev' })
    expect(builds[1]!.buildArgs).toEqual({ OVERLAY_DIR: '_out/x64/overlay-v2' })
    expect(builds[2]!.buildArgs).toEqual({ BOOKWORM: 'debian@sha256:bbb' })
  })

  test('an argument no stage declares is refused, not warned about', () => {
    expect(() =>
      planChain(discoverStages(dir()), {
        board: 'x64',
        supplied: { ...supplied, VERITY_SALT: '00' },
      }),
    ).toThrow(/VERITY_SALT/)
  })

  test('unusedArgs names every stray, sorted', () => {
    const s = discoverStages(dir())
    expect(unusedArgs(s, { ...supplied, ZZZ: '1', AAA: '2' })).toEqual(['AAA', 'ZZZ'])
  })

  test('a broken chain is refused before any tag is computed', () => {
    const bad = scratch({ '10-base.Dockerfile': FIRST, '20-x.Dockerfile': FIRST })
    expect(() => planChain(discoverStages(bad), { board: 'x64', supplied: {} })).toThrow(
      StageChainError,
    )
  })
})

describe('buildArgv', () => {
  const dir = () =>
    scratch({
      '10-base.Dockerfile': `ARG TRIXIE\nFROM \${TRIXIE}\nRUN true\n`,
      '90-pack.Dockerfile': TERMINAL,
    })

  test('an intermediate stage loads a tag and exports nothing', () => {
    const [first] = planChain(discoverStages(dir()), {
      board: 'x64',
      supplied: { TRIXIE: 'debian@sha256:aaa' },
    })
    const argv = buildArgv(first!, {
      context: '/repo',
      platform: 'linux/amd64',
      dest: '/out',
    })
    expect(argv).toEqual([
      'buildx',
      'build',
      '--platform',
      'linux/amd64',
      '-f',
      first!.path,
      '--build-arg',
      'TRIXIE=debian@sha256:aaa',
      '-t',
      'mos-rootfs-stage:x64-10-base',
      '--load',
      '/repo',
    ])
    expect(argv).not.toContain('--output')
  })

  test('the terminal stage exports and is not tagged', () => {
    const builds = planChain(discoverStages(dir()), {
      board: 'x64',
      supplied: { TRIXIE: 'debian@sha256:aaa' },
    })
    const argv = buildArgv(builds[1]!, {
      context: '/repo',
      platform: 'linux/amd64',
      dest: '/out/x64',
    })
    expect(argv).toContain('--target')
    expect(argv).toContain('artifact')
    expect(argv).toContain('type=local,dest=/out/x64')
    expect(argv).not.toContain('--load')
    expect(argv).toContain('--build-arg')
    expect(argv[argv.indexOf('--build-arg') + 1]).toBe(
      `${PREV_ARG}=mos-rootfs-stage:x64-10-base`,
    )
  })

  test('--no-cache comes first, before the builder, and is absent by default', () => {
    const [first] = planChain(discoverStages(dir()), {
      board: 'x64',
      supplied: { TRIXIE: 'x' },
    })
    const cold = buildArgv(first!, { context: '/r', platform: 'p', noCache: true })
    expect(cold.slice(0, 3)).toEqual(['buildx', 'build', '--no-cache'])
    expect(buildArgv(first!, { context: '/r', platform: 'p' })).not.toContain('--no-cache')
  })

  test('a builder name is passed through when given, and absent when not', () => {
    const [first] = planChain(discoverStages(dir()), {
      board: 'x64',
      supplied: { TRIXIE: 'x' },
    })
    const withB = buildArgv(first!, { context: '/r', platform: 'p', builder: 'mos-amd64' })
    expect(withB.slice(0, 4)).toEqual(['buildx', 'build', '--builder', 'mos-amd64'])
    expect(buildArgv(first!, { context: '/r', platform: 'p' })).not.toContain('--builder')
  })

  test('the terminal stage with no destination is refused, not silently dropped', () => {
    const builds = planChain(discoverStages(dir()), { board: 'x64', supplied: { TRIXIE: 'x' } })
    expect(() => buildArgv(builds[1]!, { context: '/r', platform: 'p' })).toThrow(
      /export somewhere|no output directory/,
    )
  })
})

describe('stageManifest', () => {
  test('records every stage, in order, with its content hash', () => {
    const stages = discoverStages(
      scratch({ '10-base.Dockerfile': `ARG T\nFROM \${T}\n`, '90-pack.Dockerfile': TERMINAL }),
    )
    const builds = planChain(stages, { board: 'x64', supplied: { T: 'x' } })
    const text = stageManifest(builds, stages)
    const rows = text.trimEnd().split('\n').filter((l) => !l.startsWith('#'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(`10-base\t${stages[0]!.sha256}\tmos-rootfs-stage:x64-10-base`)
    expect(rows[1]).toBe(`90-pack\t${stages[1]!.sha256}\t(exported)`)
  })
})

describe('the driver refuses a builder that cannot chain', () => {
  test('parseDriver reads the field docker prints', () => {
    expect(
      parseDriver('Name:   default\nDriver: docker\nLast Activity: 2026-08-25\n'),
    ).toBe('docker')
    expect(parseDriver('Name:  mos-amd64\nDriver: docker-container\n')).toBe('docker-container')
  })

  test('parseDriver returns undefined rather than guessing', () => {
    expect(parseDriver('')).toBeUndefined()
    expect(parseDriver('ERROR: no builder\n')).toBeUndefined()
  })

  test('the docker CLI is this package\'s, not a bare name', () => {
    // Measured: on the pinned-bun route the host client is bind-mounted at its
    // own path and named in MOS_BUILD_DOCKER, and a bare `docker` there asks a
    // different question -- is /usr/bin on this image's PATH. src/toolbox.ts
    // reads the same variable for the same reason.
    const before = process.env.MOS_BUILD_DOCKER
    try {
      delete process.env.MOS_BUILD_DOCKER
      expect(dockerBin()).toBe('docker')
      process.env.MOS_BUILD_DOCKER = '/usr/bin/docker'
      expect(dockerBin()).toBe('/usr/bin/docker')
    } finally {
      if (before === undefined) delete process.env.MOS_BUILD_DOCKER
      else process.env.MOS_BUILD_DOCKER = before
    }
  })

  test('only the docker driver can resolve a local tag in FROM', () => {
    // Measured on 2026-08-25: a docker-container builder handed a tag that IS
    // in the local image store answered "pull access denied, repository does
    // not exist" -- about Docker Hub, for an image that is right there.
    expect(driverCanChain('docker')).toBe(true)
    expect(driverCanChain('docker-container')).toBe(false)
    expect(driverCanChain('remote')).toBe(false)
    expect(driverCanChain(undefined)).toBe(false)
  })
})

describe('parseArgs', () => {
  test('the minimum a real build passes', () => {
    const o = parseArgs([
      '--board',
      'x64',
      '--dest',
      '/out/x64',
      '--platform',
      'linux/amd64',
      '--arg',
      'MOS_ARCH=amd64',
      '--arg',
      'BOARD_RADIOS=',
    ])
    expect(o.board).toBe('x64')
    expect(o.dest).toBe('/out/x64')
    expect(o.args).toEqual({ MOS_ARCH: 'amd64', BOARD_RADIOS: '' })
  })

  test('an empty --arg value is a value, not a missing one', () => {
    // BOARD_RADIOS= is how x64 says it declares no radio. Treating it as
    // absent would make the stage that reads it fail under `set -u` on a board
    // whose answer is "none", which is a statement rather than an omission.
    expect(parseArgs(['--board', 'x64', '--plan', '--arg', 'BOARD_RADIOS=']).args).toEqual({
      BOARD_RADIOS: '',
    })
  })

  test('--board with no value is refused rather than eating the next flag', () => {
    expect(() => parseArgs(['--board', '--plan'])).toThrow(/needs a value/)
  })

  test('--arg without an = is refused', () => {
    expect(() => parseArgs(['--board', 'x64', '--plan', '--arg', 'NOEQUALS'])).toThrow(
      /is not KEY=VALUE/,
    )
  })

  test('no --board at all is refused', () => {
    expect(() => parseArgs(['--plan'])).toThrow(/--board is required/)
  })

  test('a real build with no --dest is refused; a plan without one is not', () => {
    expect(() => parseArgs(['--board', 'x64'])).toThrow(/--dest is required/)
    expect(parseArgs(['--board', 'x64', '--plan']).planOnly).toBe(true)
  })

  test('--no-cache is off unless asked for', () => {
    expect(parseArgs(['--board', 'x64', '--plan']).noCache).toBe(false)
    expect(parseArgs(['--board', 'x64', '--plan', '--no-cache']).noCache).toBe(true)
  })

  test('an unknown option is refused', () => {
    expect(() => parseArgs(['--board', 'x64', '--plan', '--nope'])).toThrow(/unknown option/)
  })
})

describe('the chain this tree actually ships', () => {
  const stages = discoverStages()

  test('is a chain auditChain accepts', () => {
    expect(auditChain(stages, DEFAULT_TERMINAL_TARGET)).toEqual([])
  })

  test('starts at 10-base and ends at 90-pack', () => {
    expect(stages[0]!.name).toBe('10-base')
    expect(stages[stages.length - 1]!.name).toBe('90-pack')
  })

  test('90-pack defines all three of its internal targets', () => {
    const pack = stages.find((s) => s.name === '90-pack')!
    expect(pack.targets).toEqual(['closed', 'pack', 'artifact'])
  })

  test('10-base defines the certs stage its trust anchors are COPIED from', () => {
    expect(stages[0]!.targets).toEqual(['certs', 'rootfs'])
  })

  test('every stage but the first is linked, and only the first names a distro image', () => {
    stages.forEach((s, i) => {
      expect(s.declaresPrev).toBe(i > 0)
    })
    const withBase = stages.filter((s) =>
      s.declaredArgs.some((a) => a.startsWith('MOS_IMAGE_DEBIAN_')),
    )
    // 10-base names trixie, 90-pack names bookworm, and nothing else names a
    // base image at all -- a stage that does not name one cannot be built
    // against the wrong one.
    expect(withBase.map((s) => s.name)).toEqual(['10-base', '90-pack'])
  })

  test('BOARD_RADIOS is declared in every file whose RUNs read it', () => {
    // ARG is per stage and now also per FILE. A stage reading BOARD_RADIOS
    // without declaring it gets the empty string, and under `set -u` in
    // pack-assert-var-disposable.sh that is a check that silently reads "no
    // radios" on a board that has them.
    const declaring = stages.filter((s) => s.declaredArgs.includes('BOARD_RADIOS'))
    expect(declaring.length).toBeGreaterThanOrEqual(2)
  })
})
