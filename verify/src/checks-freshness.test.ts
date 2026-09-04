// The freshness guard, driven from the failing side and from the cross-board
// side -- which is the reported case and the reason this check
// was rebuilt rather than transcribed.
//
// Every fixture sets its mtimes with `utimesSync` rather than by writing files
// in an order. Two writes in one tick get the SAME nanosecond timestamp on this
// host (measured on bun 1.4.0, ext4), so a test that leaned on write order
// would compare equal, take the `not newer` branch and pass for a reason it did
// not mean.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { CHECKS, type CheckCase, type ImageContext } from './checks.ts'
import { freshnessInputs } from './checks-freshness.ts'
import type { CheckResult } from './parity.ts'
import { boardEnvPath } from './paths.ts'
import { ToolOutputError, type ToolRuntime } from './tools.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

const ID = 'image-fresher-than-build-inputs'

/** Three instants, far enough apart that no filesystem granularity can tie them. */
const OLD = new Date(1_700_000_000_000)
const IMAGE = new Date(1_700_000_060_000)
const NEW = new Date(1_700_000_120_000)

let SCRATCH = ''
let seq = 0
beforeAll(() => { SCRATCH = mkdtempSync(join(tmpdir(), 'mos-freshness-')) })
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

function scratch(): string {
  if (SCRATCH === '') throw new Error('the scratch directory was read before beforeAll created it')
  return SCRATCH
}

/** A file with a chosen mtime. The content is never read; only the timestamp is. */
function plant(path: string, when: Date): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'x')
  utimesSync(path, when, when)
}

interface World {
  /** `_out/<board>/rootfs-verity.img`, per board. Absent boards get no file. */
  readonly roots?: Readonly<Record<string, Date>>
  /** `pkgs/podman/out-<arch>/podman`, per architecture. */
  readonly engines?: Readonly<Record<string, Date>>
  /** The image's own mtime. Defaults to IMAGE. */
  readonly image?: Date
}

interface Fixture {
  readonly ctx: ImageContext
  readonly pkgs: string
}

/**
 * A tree carrying whichever boards' and architectures' artefacts the case names.
 *
 * The image lives under `_out/<board>` like the real one, and `outDir` points at
 * that same directory -- so a case can plant another board's root beside it and
 * the check has to ignore it for a reason rather than because it was not there.
 */
function world(board = x64, w: World = {}): Fixture {
  seq += 1
  const root = join(scratch(), `w${seq}`)
  const out = join(root, '_out')
  const pkgs = join(root, 'pkgs')

  const image = join(out, board.name, `${board.name}-mos-latest.img`)
  plant(image, w.image ?? IMAGE)
  for (const [name, when] of Object.entries(w.roots ?? {})) {
    plant(join(out, name, 'rootfs-verity.img'), when)
  }
  for (const [arch, when] of Object.entries(w.engines ?? {})) {
    plant(join(pkgs, 'podman', `out-${arch}`, 'podman'), when)
  }

  const refuse = (what: string): never => {
    throw new ToolOutputError(`the freshness fixture reads mtimes and has no ${what}.`)
  }
  const tools: ToolRuntime = {
    route: 'host',
    announce: 'the freshness check runs no tool',
    run: async () => refuse('tool runtime'),
    dispose: async () => {},
  }
  const ctx: ImageContext = {
    board,
    image,
    tools,
    workDir: root,
    outDir: join(out, board.name),
    metaDir: join(out, 'meta'),
    gpt: async () => refuse('partition table'),
    partition: async () => refuse('partition lookup'),
    fatSlot: async () => refuse('FAT slot'),
    extract: async () => refuse('extracted payload'),
    extractAt: async () => refuse('image byte range'),
    unpackRoot: async () => refuse('unpacked root'),
  }
  return { ctx, pkgs }
}

function checkNamed(id: string): CheckCase {
  const found = CHECKS.find(c => c.id === id)
  if (found === undefined) throw new Error(`no check is registered as '${id}'`)
  return found
}

/** Run the REGISTERED check, with `pkgs` pointed at this world's tree. */
async function drive(fx: Fixture, env: Record<string, string> = {}): Promise<CheckResult> {
  const saved = new Map<string, string | undefined>()
  const set = (k: string, v: string | undefined): void => {
    saved.set(k, process.env[k])
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  set('MOS_VERIFY_PKGS_DIR', fx.pkgs)
  set('MOS_VERIFY_ALLOW_STALE', env['MOS_VERIFY_ALLOW_STALE'])
  try {
    const got = await checkNamed(ID).run(fx.ctx)
    const first = got[0]
    if (first === undefined || got.length !== 1) {
      throw new Error(`the check concluded ${got.length} times; it is a 'one' entry`)
    }
    return first
  }
  finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('the inputs are derived from the board under test', () => {
  test('each board resolves its OWN _out directory and its OWN architecture', () => {
    const forX64 = freshnessInputs(x64, '/o/x64').map(i => i.path)
    const forCx = freshnessInputs(cx3576, '/o/cx3576').map(i => i.path)
    expect(forX64[0]).toBe('/o/x64/rootfs-verity.img')
    expect(forCx[0]).toBe('/o/cx3576/rootfs-verity.img')
    expect(forX64[1]).toEndWith('/podman/out-amd64/podman')
    expect(forCx[1]).toEndWith('/podman/out-arm64/podman')
    // The literals M1.1 reported: neither board's list may name the other's.
    expect(forX64.join(' ')).not.toContain('arm64')
    expect(forX64.join(' ')).not.toContain('cx3576')
    expect(forCx.join(' ')).not.toContain('amd64')
    expect(forCx.join(' ')).not.toContain('x64')
  })

  test('a board declaring no MOS_ARCH THROWS rather than failing the image', () => {
    const archless = { ...x64, arch: undefined } as typeof x64
    expect(() => freshnessInputs(archless, '/o/x64')).toThrow(/declares no MOS_ARCH/)
  })
})

describe('image-fresher-than-build-inputs', () => {
  test('green when the image is newer than both of its own inputs', async () => {
    const r = await drive(world(x64, { roots: { x64: OLD }, engines: { amd64: OLD } }))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('is newer than every build input present here')
    expect(r.message).toContain('rootfs-verity.img [not newer]')
    expect(r.message).toContain('out-amd64/podman [not newer]')
  })

  test('RED when the packed root is newer than the image', async () => {
    // The negative fixture: "you forgot to re-run the build". The root was
    // repacked and the image was not reassembled from it, so every other check
    // in the register would go on describing the previous build.
    const r = await drive(world(x64, { roots: { x64: NEW }, engines: { amd64: OLD } }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('is OLDER than the packed read-only root')
    expect(r.message).toContain('rootfs-verity.img [newer]')
  })

  test('RED when the container engine is newer than the image', async () => {
    // The incident this guard was built for: the six-hour-old image,
    // built from the distribution's podman while the self-built one sat beside
    // it, newer and unshipped.
    const r = await drive(world(x64, { roots: { x64: OLD }, engines: { amd64: NEW } }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('is OLDER than the container engine')
    expect(r.message).toContain('out-amd64/podman [newer]')
  })

  test('RED naming BOTH when both are newer', async () => {
    const r = await drive(world(x64, { roots: { x64: NEW }, engines: { amd64: NEW } }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('the packed read-only root')
    expect(r.message).toContain('the container engine')
  })

  test('an input at the SAME instant is not newer', async () => {
    // `-nt` is strictly newer, and so is this. An image and the root it was
    // assembled from can share a timestamp on a fast build, and refusing that
    // would refuse the freshest image there is.
    const r = await drive(world(x64, { roots: { x64: IMAGE }, engines: { amd64: IMAGE } }))
    expect(r.verdict).toBe('pass')
  })

  test('SKIP, not pass, when neither input is present', async () => {
    // Zero comparisons made. A pass here would be the vacuous green this
    // package exists to make visible, and the verifier counts skips apart.
    const r = await drive(world(x64))
    expect(r.verdict).toBe('skip')
    expect(r.message).toContain('no build input is present here')
    expect(r.message).toContain('rootfs-verity.img [absent]')
    expect(r.message).toContain('out-amd64/podman [absent]')
  })

  test('one input present and one absent still concludes, and says which was absent', async () => {
    const r = await drive(world(x64, { roots: { x64: NEW } }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('out-amd64/podman [absent]')
  })

  test('MOS_VERIFY_ALLOW_STALE=1 SKIPS, and says so, rather than passing', async () => {
    const fx = world(x64, { roots: { x64: NEW }, engines: { amd64: NEW } })
    const r = await drive(fx, { MOS_VERIFY_ALLOW_STALE: '1' })
    expect(r.verdict).toBe('skip')
    expect(r.message).toContain('MOS_VERIFY_ALLOW_STALE=1')
    // The control: the same tree without the variable is RED, so the skip is the
    // variable's doing and not an empty fixture's.
    expect((await drive(fx)).verdict).toBe('fail')
  })
})

describe('one board’s run is not decided by another board’s artefacts', () => {
  /**
   * The tree the original defect needed: x64's own inputs old, cx3576's newer.
   *
   * The shell guard named `_out/cx3576/rootfs-verity.img` and
   * `pkgs/podman/out-arm64/podman` as literals, so this tree made an x64 run
   * refuse a fresh x64 image. Both directions are asserted, because a check that
   * simply never looked at arm64 would pass the first case for the wrong reason.
   */
  const crossBoard = (board = x64): Fixture => world(board, {
    roots: { x64: OLD, cx3576: NEW },
    engines: { amd64: OLD, arm64: NEW },
  })

  test('the x64 run PASSES though cx3576/arm64 artefacts are newer than the image', async () => {
    const r = await drive(crossBoard(x64))
    expect(r.verdict).toBe('pass')
    expect(r.message).not.toContain('cx3576')
    expect(r.message).not.toContain('arm64')
  })

  test('the control: the SAME tree fails a cx3576 run, so those artefacts really are newer',
    async () => {
      const r = await drive(crossBoard(cx3576))
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('cx3576/rootfs-verity.img [newer]')
      expect(r.message).toContain('out-arm64/podman [newer]')
    })
})
