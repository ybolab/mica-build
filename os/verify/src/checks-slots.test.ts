// The boot-slot filesystem checks, driven from the failing side.
//
// Every check lands with the mutation that fails it. These three read a
// filesystem rather than a table,
// so the fixture is a real FAT32 boot sector written into a real sparse file at
// the offset the layout declares, plus a stubbed mtools answering what the two
// mtools readers ask.
//
// The boot sector is written HERE rather than copied out of a shipped image on
// purpose: the mutations below are single-field edits to it (the signature, the
// serial, the label), and a fixture cut from a real image could only be mutated
// by editing bytes whose meaning this file would then have to restate anyway.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, truncateSync, writeFileSync, writeSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { healthyGpt, NO_TOOLS } from './checks-fixture.ts'
import { SLOT_CHECKS } from './checks-slots.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult } from './parity.ts'
import type { ToolResult, ToolRuntime } from './tools.ts'
import { ToolOutputError } from './tools.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))
const SLOT_SECTORS = 524288

const BOOT_A_OFFSET = 18874368
const BOOT_B_OFFSET = 85983232
const FAT32_SIGNATURE_OFFSET = 82

function checkNamed(id: string): CheckCase {
  const found = SLOT_CHECKS.find(c => c.id === id)
  if (found === undefined) throw new Error(`no slot check is registered as '${id}'`)
  return found
}

interface SlotState {
  /** The five bytes at offset+82. `FAT32` is what mkfs.vfat writes. */
  readonly signature?: string
  /** What minfo reports as `serial number:`. */
  readonly serial?: string
  /** What mlabel reports as `Volume label is`. */
  readonly label?: string
}

/**
 * mtools, answering for two slots and refusing anything it was not set up for.
 *
 * Keyed on the OFFSET in the `image@@offset` argument, because that is the
 * only thing distinguishing one slot's call from the other's -- which is also
 * how a check that read both slots at one offset would go undetected without
 * this.
 */
function mtoolsFor(slots: ReadonlyMap<number, SlotState>): ToolRuntime {
  return {
    ...NO_TOOLS,
    run: async (argv): Promise<ToolResult> => {
      const line = argv.join(' ')
      const at = /@@(\d+)/.exec(line)
      const state = at === null ? undefined : slots.get(Number(at[1]))
      if (state === undefined) {
        throw new ToolOutputError(`the fixture set up no slot at ${at?.[1] ?? '(no offset)'}: ${line}`)
      }
      if (line.includes('minfo')) {
        const serial = state.serial
        return {
          argv,
          code: 0,
          stdout: serial === undefined
            ? 'mtools version 4.0.43\n'
            : `Volume has no label\nserial number: ${serial}\n`,
          stderr: '',
        }
      }
      if (line.includes('mlabel')) {
        const label = state.label
        return {
          argv,
          code: 0,
          stdout: label === undefined ? ' Volume has no label\n' : ` Volume label is ${label}   \n`,
          stderr: '',
        }
      }
      return NO_TOOLS.run(argv)
    },
  }
}

interface SlotFixture {
  readonly ctx: ImageContext
  readonly dispose: () => void
}

/** A sparse image with a FAT32 signature written at each slot's declared offset. */
function slotFixture(
  board: typeof cx3576,
  slots: ReadonlyMap<number, SlotState>,
): SlotFixture {
  const dir = mkdtempSync(join(tmpdir(), 'mos-slot-fixture-'))
  const image = join(dir, 'fixture.img')
  writeFileSync(image, '')
  const last = Math.max(...[...slots.keys()])
  truncateSync(image, last + 1024)
  const fd = openSync(image, 'r+')
  try {
    for (const [offset, state] of slots) {
      const sig = state.signature
      if (sig === undefined) continue
      writeSync(fd, Buffer.from(sig, 'latin1'), 0, sig.length, offset + FAT32_SIGNATURE_OFFSET)
    }
  }
  finally {
    closeSync(fd)
  }
  const gpt = healthyGpt(board, SLOT_SECTORS)
  const refuse = (what: string): never => {
    throw new ToolOutputError(`the slot fixture has no ${what}.`)
  }
  const ctx: ImageContext = {
    board,
    image,
    tools: mtoolsFor(slots),
    workDir: dir,
    outDir: dir,
    gpt: async () => gpt,
    partition: async () => refuse('partition lookup'),
    fatSlot: async () => refuse('GPT-derived FAT slot -- these checks take the offset from the layout'),
    extractAt: async () => refuse('image byte ranges'),
    extract: async () => refuse('extracted payloads'),
    unpackRoot: async () => refuse('unpacked root'),
  }
  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

const HEALTHY_CX: ReadonlyMap<number, SlotState> = new Map([
  [BOOT_A_OFFSET, { signature: 'FAT32', serial: 'C3576003', label: 'BOOT-A' }],
  [BOOT_B_OFFSET, { signature: 'FAT32', serial: 'C3576004', label: 'BOOT-B' }],
])

async function drive(
  id: string,
  slots: ReadonlyMap<number, SlotState> = HEALTHY_CX,
  board = cx3576,
): Promise<readonly CheckResult[]> {
  const fixture = slotFixture(board, slots)
  try {
    return await checkNamed(id).run(fixture.ctx)
  }
  finally {
    fixture.dispose()
  }
}

function firing(results: readonly CheckResult[], instance: string): CheckResult {
  const found = results.find(r => r.instance === instance)
  if (found === undefined) throw new Error(`no firing for ${instance}`)
  return found
}

function mutate(over: ReadonlyMap<number, SlotState>, offset: number, state: SlotState): Map<number, SlotState> {
  const next = new Map(over)
  next.set(offset, { ...(over.get(offset) as SlotState), ...state })
  return next
}

describe('all three fire once per slot, and green on a healthy pair', () => {
  test('two firings each, named BOOT-A and BOOT-B', async () => {
    for (const id of ['boot-slot-fat32-signature', 'boot-slot-fat-volume-id', 'boot-slot-fat-label']) {
      const results = await drive(id)
      expect(results.map(r => r.instance)).toEqual(['BOOT-A', 'BOOT-B'])
      for (const r of results) expect(r.verdict).toBe('pass')
    }
  })
})

describe('boot-slot-fat32-signature', () => {
  test('RED on the slot whose signature is missing, and only that slot', async () => {
    // The failure: an assembler that wrote the slot's files without ever
    // running mkfs.vfat, or wrote them at the wrong offset. U-Boot finds no
    // filesystem and the board does not boot.
    const results = await drive('boot-slot-fat32-signature', mutate(HEALTHY_CX, BOOT_B_OFFSET, { signature: undefined }))
    expect(firing(results, 'BOOT-A').verdict).toBe('pass')
    const b = firing(results, 'BOOT-B')
    expect(b.verdict).toBe('fail')
    expect(b.message).toMatch(/BOOT-B FAT32 signature not found at offset 82 MiB \+ 82/)
  })

  test('RED on a FAT16 slot -- the right filesystem family, the wrong one', async () => {
    const results = await drive('boot-slot-fat32-signature', mutate(HEALTHY_CX, BOOT_A_OFFSET, { signature: 'FAT16' }))
    expect(firing(results, 'BOOT-A').verdict).toBe('fail')
    expect(firing(results, 'BOOT-B').verdict).toBe('pass')
  })

  test('the MiB in the message is the slot\'s own offset, not the other\'s', async () => {
    const results = await drive('boot-slot-fat32-signature')
    expect(firing(results, 'BOOT-A').message).toMatch(/at 18 MiB/)
    expect(firing(results, 'BOOT-B').message).toMatch(/at 82 MiB/)
  })
})

describe('boot-slot-fat-volume-id', () => {
  test('RED when the slots\' serials are SWAPPED', async () => {
    // Both serials are still ones the layout knows, and both slots still have a
    // filesystem: only the pairing is wrong. A check comparing the SET of
    // serials would pass here.
    let slots = mutate(HEALTHY_CX, BOOT_A_OFFSET, { serial: 'C3576004' })
    slots = mutate(slots, BOOT_B_OFFSET, { serial: 'C3576003' })
    const results = await drive('boot-slot-fat-volume-id', slots)
    expect(results.map(r => r.verdict)).toEqual(['fail', 'fail'])
    expect(firing(results, 'BOOT-A').message).toMatch(/FAT volume id is 'C3576004', expected C3576003/)
  })

  test('a serial that differs only in CASE stays green -- it is hexadecimal', async () => {
    const results = await drive('boot-slot-fat-volume-id', mutate(HEALTHY_CX, BOOT_A_OFFSET, { serial: 'c3576003' }))
    expect(firing(results, 'BOOT-A').verdict).toBe('pass')
  })

  test('the RAUC-installed default is RED here, which is what "factory:" means', async () => {
    // 1234ABCD is what `mkfs.vfat --invariant` writes into a bundle's
    // boot.vfat, so an updated slot legitimately reads it -- and a FACTORY
    // image that does is one assembled from a bundle.
    const results = await drive('boot-slot-fat-volume-id', mutate(HEALTHY_CX, BOOT_A_OFFSET, { serial: '1234ABCD' }))
    expect(firing(results, 'BOOT-A').verdict).toBe('fail')
  })

  test('minfo printing no serial at all THROWS rather than failing the check', async () => {
    // "there is no serial" is not a statement about the image's volume id: it
    // means minfo read something that is not a FAT, and reporting that as a
    // wrong volume id would send a reader to the assembler.
    await expect(drive('boot-slot-fat-volume-id', mutate(HEALTHY_CX, BOOT_A_OFFSET, { serial: undefined })))
      .rejects.toThrow(/printed no "serial number:" line/)
  })
})

describe('boot-slot-fat-label', () => {
  test('RED on the neutral post-update label, which is the point of "factory:"', async () => {
    const results = await drive('boot-slot-fat-label', mutate(HEALTHY_CX, BOOT_B_OFFSET, { label: 'BOOT' }))
    expect(firing(results, 'BOOT-A').verdict).toBe('pass')
    const b = firing(results, 'BOOT-B')
    expect(b.verdict).toBe('fail')
    expect(b.message).toMatch(/FAT volume label is 'BOOT', expected 'BOOT-B' on a factory image/)
  })

  test('the label comparison is case SENSITIVE, unlike the serial', async () => {
    const results = await drive('boot-slot-fat-label', mutate(HEALTHY_CX, BOOT_A_OFFSET, { label: 'boot-a' }))
    expect(firing(results, 'BOOT-A').verdict).toBe('fail')
  })

  test('an unlabelled slot is RED, not a throw -- "no label" is a real answer', async () => {
    const results = await drive('boot-slot-fat-label', mutate(HEALTHY_CX, BOOT_A_OFFSET, { label: undefined }))
    expect(firing(results, 'BOOT-A').verdict).toBe('fail')
    expect(firing(results, 'BOOT-A').message).toMatch(/label is '', expected 'BOOT-A'/)
  })
})

describe('the offset comes from the LAYOUT, and a missing one is refused', () => {
  test('x64 resolves its own offsets, not cx3576\'s', async () => {
    // 65 MiB and 161 MiB, from x64's board.env. A check that had baked
    // cx3576's 18/82 in would read a hole in this fixture and go red.
    const slots = new Map<number, SlotState>([
      [65 * 1048576, { signature: 'FAT32', serial: 'C3576103', label: 'BOOT-A' }],
      [161 * 1048576, { signature: 'FAT32', serial: 'C3576104', label: 'BOOT-B' }],
    ])
    const results = await drive('boot-slot-fat32-signature', slots, x64)
    expect(results.map(r => r.verdict)).toEqual(['pass', 'pass'])
    expect(firing(results, 'BOOT-A').message).toMatch(/at 65 MiB/)
  })

  test('a board declaring no BOOT_B_OFFSET_BYTES is refused BY NAME', async () => {
    const hollow = {
      ...cx3576,
      partition: (n: string) => {
        const p = cx3576.partition(n)
        if (p === undefined || n !== 'BOOT_B') return p
        return { ...p, get: (s: string) => (s === 'OFFSET_BYTES' ? undefined : p.get(s)) }
      },
    } as typeof cx3576
    await expect(drive('boot-slot-fat32-signature', HEALTHY_CX, hollow))
      .rejects.toThrow(/declares no usable BOOT_B_OFFSET_BYTES/)
  })
})
