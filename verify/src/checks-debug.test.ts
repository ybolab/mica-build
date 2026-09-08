// PLAN-086 S2's family, driven from the failing side.
//
// Two of the three checks pass by finding NOTHING -- no debug sections in the
// packed root, no boot blobs in it -- which is the direction that goes green
// for the wrong reason. A walk that reads the wrong tree, a fixture whose root
// was never populated, and a correctly stripped image all report the same
// thing. So every case here restores exactly one of the things the pack stage
// removed, or empties one of the spaces a check searches, and requires red.
//
// The third check is the one the other two are only worth anything WITH: a root
// with the debug information taken out and no export beside it is not a smaller
// image, it is an image nobody can debug. Its mutations are the four ways a
// match can be broken while every file involved still exists -- a binary that is
// not the one that was stripped, a debug file that is not the one that came out
// of it, a missing debug file, and a manifest that names nothing.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { DEBUG_CHECKS, parseDebugManifest } from './checks-debug.ts'
import { packedRootFixture, writeSyntheticElf, type RootFixture } from './checks-fixture.ts'
import { assertRegisterWellFormed, CHECKS, type CheckCase } from './checks.ts'
import type { CheckResult, Verdict } from './parity.ts'
import { boardEnvPath } from './paths.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))

const NO_DEBUG = 'packed-no-user-debug-sections'
const MATCHES = 'debug-export-matches-shipped'
const NO_BOOT = 'packed-no-boot-blobs'

/**
 * The two binaries the fixture ships stripped, and the ids they are matched by.
 *
 * Two rather than one: a loop that ran once and a loop that ran over the first
 * row only look identical from a single-row manifest.
 */
const SHIPPED = [
  { path: '/usr/bin/mosd', id: '055a050bd5075fb166bd4fa1ba1abde66a35955c' },
  { path: '/usr/libexec/podman/netavark', id: '4764889a4dce315a880b6e0c2038ef0fda2cf589' },
] as const

/** A kernel module: ELF, carrying a symbol table, and never a stripping target. */
const MODULE = '/usr/lib/modules/6.1.115/kernel/drivers/net/dummy.ko'

function checkNamed(id: string): CheckCase {
  const found = DEBUG_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no debug check is registered as '${id}'. Registered: `
      + DEBUG_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

async function resultOf(fx: RootFixture, id: string): Promise<CheckResult> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  return got[0] as CheckResult
}

async function verdictOf(fx: RootFixture, id: string): Promise<Verdict> {
  return (await resultOf(fx, id)).verdict
}

function sha256Of(file: string): string {
  return new Bun.CryptoHasher('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * A packed-root fixture with the pack stage's two exports beside it.
 *
 * `packedRootFixture` seeds a root with no ELF in it at all and no `_out`
 * exports, which is what a board looked like before this slice. Everything this
 * family reads is added here, in the shape the build writes it: stripped
 * binaries carrying a build-id, one kernel module that must be left alone, the
 * `.build-id` debug tree, the manifest, and a boot export.
 */
function seeded(): RootFixture {
  const fx = packedRootFixture(cx3576)
  const debugDir = join(fx.ctx.outDir, 'debug')
  mkdirSync(join(fx.ctx.outDir, 'boot'), { recursive: true })
  writeFileSync(join(fx.ctx.outDir, 'boot', 'Image'), 'kernel\n')
  writeFileSync(join(fx.ctx.outDir, 'boot', 'rk3576-src.dtb'), 'dtb\n')
  writeFileSync(join(fx.ctx.outDir, 'boot', '.no-kernel-in-root'), '')

  // A module, so the "left alone" half of the scan has a subject. It carries a
  // .symtab on purpose: it is exactly what the negative would flag if the
  // module exclusion stopped working.
  writeSyntheticElf(join(fx.root, MODULE.slice(1)), {
    type: 1,
    sections: [{ name: '.symtab', content: Buffer.from('symbols') }],
  })

  const rows: string[] = ['#path\tbuild-id\tdebug\tbytes-before\tbytes-after\tsha256-after']
  for (const s of SHIPPED) {
    const shipped = join(fx.root, s.path.slice(1))
    writeSyntheticElf(shipped, {
      buildId: s.id,
      sections: [{ name: '.text', content: Buffer.from(s.path) }],
    })
    const debug = `.build-id/${s.id.slice(0, 2)}/${s.id.slice(2)}.debug`
    writeSyntheticElf(join(debugDir, debug), {
      buildId: s.id,
      sections: [{ name: '.debug_info', content: Buffer.from(`dwarf for ${s.path}`) }],
    })
    rows.push(`${s.path}\t${s.id}\t${debug}\t4096\t2048\t${sha256Of(shipped)}`)
  }
  mkdirSync(debugDir, { recursive: true })
  writeFileSync(join(debugDir, 'manifest.tsv'), `${rows.join('\n')}\n`)
  return fx
}

/** Seed, assert GREEN, mutate, hand back. A fixture already red proves nothing. */
async function mutated(id: string, mutate: (fx: RootFixture) => void): Promise<RootFixture> {
  const fx = seeded()
  expect(await verdictOf(fx, id)).toBe('pass')
  mutate(fx)
  return fx
}

function manifest(fx: RootFixture): string {
  return join(fx.ctx.outDir, 'debug', 'manifest.tsv')
}

describe('the register', () => {
  test('all three are registered, and the register stays well formed', () => {
    const ids = new Set(CHECKS.map(c => c.id))
    for (const id of [NO_DEBUG, MATCHES, NO_BOOT]) expect(ids.has(id)).toBe(true)
    expect(() => assertRegisterWellFormed()).not.toThrow()
  })

  test('every one of them applies to every board', () => {
    // Both removals are unconditional: a UEFI board's kernel lives in /boot and
    // a U-Boot board's under /usr/lib/mos/board, and both are gone. A `boards`
    // list here would be a board silently exempted from the whole slice.
    for (const c of DEBUG_CHECKS) expect(c.boards).toBeUndefined()
  })
})

describe('POSITIVE CONTROL', () => {
  test('a correctly stripped root with both exports passes all three', async () => {
    const fx = seeded()
    try {
      for (const id of [NO_DEBUG, MATCHES, NO_BOOT]) {
        const got = await resultOf(fx, id)
        expect(`${id}: ${got.verdict}`).toBe(`${id}: pass`)
      }
    } finally { fx.dispose() }
  })

  test('the kernel module keeps its symbol table and is reported as left alone', async () => {
    // The one file in the fixture that WOULD be flagged if the exclusion broke.
    const fx = seeded()
    try {
      const got = await resultOf(fx, NO_DEBUG)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('kernel module(s) and relocatable object(s) deliberately')
    } finally { fx.dispose() }
  })
})

describe('the packed root must carry no debug sections', () => {
  test('a shipped binary that got its DWARF back is named', async () => {
    const fx = await mutated(NO_DEBUG, (f) => {
      writeSyntheticElf(join(f.root, SHIPPED[0].path.slice(1)), {
        buildId: SHIPPED[0].id,
        sections: [{ name: '.debug_info', content: Buffer.from('dwarf') }],
      })
    })
    try {
      const got = await resultOf(fx, NO_DEBUG)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain(SHIPPED[0].path)
    } finally { fx.dispose() }
  })

  test('a static symbol table is caught as well as DWARF', async () => {
    // `strip` takes both and `--only-keep-debug` keeps both, so a check that
    // watched only .debug* would pass an unstripped Rust binary.
    const fx = await mutated(NO_DEBUG, (f) => {
      writeSyntheticElf(join(f.root, SHIPPED[1].path.slice(1)), {
        buildId: SHIPPED[1].id,
        sections: [{ name: '.symtab', content: Buffer.from('sym') }],
      })
    })
    try {
      expect(await verdictOf(fx, NO_DEBUG)).toBe('fail')
    } finally { fx.dispose() }
  })

  test('VACUITY: a walk that cannot see the stripped binaries is refused', async () => {
    // The failure this check exists to not have. Deleting the binaries the
    // manifest names leaves a root with nothing carrying debug sections, which
    // is what a correct one looks like.
    const fx = await mutated(NO_DEBUG, (f) => {
      for (const s of SHIPPED) rmSync(join(f.root, s.path.slice(1)))
    })
    try {
      const got = await resultOf(fx, NO_DEBUG)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('were not among them')
    } finally { fx.dispose() }
  })

  test('VACUITY: an empty manifest is refused rather than believed', async () => {
    const fx = await mutated(NO_DEBUG, (f) => {
      writeFileSync(manifest(f), '#path\tbuild-id\tdebug\tbytes-before\tbytes-after\tsha256-after\n')
    })
    try {
      const got = await resultOf(fx, NO_DEBUG)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('names no binary')
      expect(got.message).toContain('this walk has no search space')
    } finally { fx.dispose() }
  })

  test('VACUITY: a missing manifest is refused rather than skipped', async () => {
    const fx = await mutated(NO_DEBUG, (f) => rmSync(manifest(f)))
    try {
      const got = await resultOf(fx, NO_DEBUG)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('this walk has no search space')
    } finally { fx.dispose() }
  })
})

describe('every stripped binary must have a debug file that names it', () => {
  test('a debug file that is not there is named', async () => {
    const fx = await mutated(MATCHES, (f) => {
      const id = SHIPPED[1].id
      rmSync(join(f.ctx.outDir, 'debug', '.build-id', id.slice(0, 2), `${id.slice(2)}.debug`))
    })
    try {
      const got = await resultOf(fx, MATCHES)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('has no exported debug file')
    } finally { fx.dispose() }
  })

  test('a debug file for a DIFFERENT build of the binary is named', async () => {
    // The failure a file-exists check cannot see, and the one this whole
    // arrangement is for: the file is there, it is the right size, it is at the
    // right path, and it describes a build that is not what shipped.
    const fx = await mutated(MATCHES, (f) => {
      const id = SHIPPED[0].id
      writeSyntheticElf(
        join(f.ctx.outDir, 'debug', '.build-id', id.slice(0, 2), `${id.slice(2)}.debug`),
        { buildId: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', sections: [{ name: '.debug_info', content: Buffer.from('x') }] },
      )
    })
    try {
      const got = await resultOf(fx, MATCHES)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('The note is the only thing tying the')
    } finally { fx.dispose() }
  })

  test('a shipped binary whose build-id moved is named', async () => {
    const fx = await mutated(MATCHES, (f) => {
      writeSyntheticElf(join(f.root, SHIPPED[1].path.slice(1)), {
        buildId: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        sections: [{ name: '.text', content: Buffer.from(SHIPPED[1].path) }],
      })
    })
    try {
      const got = await resultOf(fx, MATCHES)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('describes a different build of it')
    } finally { fx.dispose() }
  })

  test('a shipped binary with the right build-id and the wrong bytes is named', async () => {
    // Two builds of one source at one commit share a build-id when the linker
    // is deterministic, so the id alone cannot say the IMAGE carries the file
    // that was stripped. The sha256 is what does.
    const fx = await mutated(MATCHES, (f) => {
      writeSyntheticElf(join(f.root, SHIPPED[0].path.slice(1)), {
        buildId: SHIPPED[0].id,
        sections: [{ name: '.text', content: Buffer.from('something else entirely') }],
      })
    })
    try {
      const got = await resultOf(fx, MATCHES)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('is not what was stripped')
    } finally { fx.dispose() }
  })

  test('a binary the manifest names and the image does not ship is named', async () => {
    const fx = await mutated(MATCHES, (f) => rmSync(join(f.root, SHIPPED[0].path.slice(1))))
    try {
      const got = await resultOf(fx, MATCHES)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('is not in the packed root')
    } finally { fx.dispose() }
  })

  test('an empty export is a failure, not a green over nothing', async () => {
    const fx = await mutated(MATCHES, (f) => {
      writeFileSync(manifest(f), '#path\tbuild-id\tdebug\tbytes-before\tbytes-after\tsha256-after\n')
    })
    try {
      const got = await resultOf(fx, MATCHES)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('destroyed rather than separated')
    } finally { fx.dispose() }
  })

  test('a missing manifest is a failure, not a skip', async () => {
    const fx = await mutated(MATCHES, (f) => rmSync(manifest(f)))
    try {
      const got = await resultOf(fx, MATCHES)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('the debug export manifest is missing')
    } finally { fx.dispose() }
  })
})

describe('the manifest parser refuses what it cannot read', () => {
  test('POSITIVE CONTROL: a well-formed manifest round-trips', () => {
    const rows = parseDebugManifest(
      '#path\tbuild-id\tdebug\tbytes-before\tbytes-after\tsha256-after\n'
      + `/usr/bin/mosd\t${SHIPPED[0].id}\t.build-id/05/x.debug\t10\t5\t${'a'.repeat(64)}\n`,
      'm.tsv',
    )
    expect(rows.length).toBe(1)
    expect(rows[0]?.bytesBefore).toBe(10)
  })

  test('a row with the wrong number of fields throws instead of being skipped', () => {
    // Skipping is the shape that lets a manifest shrink to nothing while every
    // check over it keeps passing.
    expect(() => parseDebugManifest('/usr/bin/mosd\tabc\n', 'm.tsv'))
      .toThrow(/has 2 tab-separated field\(s\)/)
  })

  test('a build-id that is not hex throws', () => {
    expect(() => parseDebugManifest(
      `/usr/bin/mosd\tNOT-HEX-AT-ALL\td\t1\t1\t${'a'.repeat(64)}\n`, 'm.tsv',
    )).toThrow(/is not lowercase hex/)
  })

  test('a digest that is not a sha256 throws', () => {
    expect(() => parseDebugManifest(
      `/usr/bin/mosd\t${SHIPPED[0].id}\td\t1\t1\tabc\n`, 'm.tsv',
    )).toThrow(/is not 64 hex characters/)
  })
})

describe('the packed root must carry no boot blobs', () => {
  test('a kernel put back under /boot is named', async () => {
    const fx = await mutated(NO_BOOT, (f) => {
      writeFileSync(join(f.root, 'boot', 'vmlinuz-6.1.115'), 'kernel\n')
    })
    try {
      const got = await resultOf(fx, NO_BOOT)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('/boot/vmlinuz-6.1.115')
    } finally { fx.dispose() }
  })

  test('an initramfs put back under /boot is named', async () => {
    const fx = await mutated(NO_BOOT, (f) => {
      writeFileSync(join(f.root, 'boot', 'initrd.img-6.1.115'), 'initrd\n')
    })
    try {
      expect(await verdictOf(fx, NO_BOOT)).toBe('fail')
    } finally { fx.dispose() }
  })

  test('the board staging directory put back is named, contents and all', async () => {
    const fx = await mutated(NO_BOOT, (f) => {
      mkdirSync(join(f.root, 'usr/lib/mos/board/cx3576'), { recursive: true })
      writeFileSync(join(f.root, 'usr/lib/mos/board/cx3576/Image'), 'kernel\n')
    })
    try {
      const got = await resultOf(fx, NO_BOOT)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('/usr/lib/mos/board/cx3576/Image')
    } finally { fx.dispose() }
  })

  test('the kernel CONFIG is not a boot blob and stays', async () => {
    // The one file under /boot that is deliberately kept: no bootloader reads
    // it, and checks-kernel.ts reads it out of the packed root. A rule that
    // emptied /boot would take the subject of that family with it.
    const fx = seeded()
    try {
      const got = await resultOf(fx, NO_BOOT)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('config-')
    } finally { fx.dispose() }
  })

  test('an empty boot export is a failure: the blobs were deleted, not moved', async () => {
    const fx = await mutated(NO_BOOT, (f) => {
      rmSync(join(f.ctx.outDir, 'boot'), { recursive: true, force: true })
    })
    try {
      const got = await resultOf(fx, NO_BOOT)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('the boot export holds no blob')
    } finally { fx.dispose() }
  })

  test('the no-kernel marker alone does not count as an export', async () => {
    // A board whose kernel comes from its board package leaves that marker and
    // nothing else if the board half of the export silently did nothing.
    const fx = await mutated(NO_BOOT, (f) => {
      rmSync(join(f.ctx.outDir, 'boot'), { recursive: true, force: true })
      mkdirSync(join(f.ctx.outDir, 'boot'), { recursive: true })
      writeFileSync(join(f.ctx.outDir, 'boot', '.no-kernel-in-root'), '')
    })
    try {
      const got = await resultOf(fx, NO_BOOT)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('the boot export holds no blob')
    } finally { fx.dispose() }
  })

  test('VACUITY: a root with no /boot/config-* is refused rather than believed', async () => {
    const fx = await mutated(NO_BOOT, (f) => {
      rmSync(join(f.root, 'boot'), { recursive: true, force: true })
    })
    try {
      const got = await resultOf(fx, NO_BOOT)
      expect(got.verdict).toBe('fail')
      expect(got.message).toContain('no /boot/config-*')
    } finally { fx.dispose() }
  })
})
