// Batch 1c driven from the failing side.
//
// PLAN-014 M4b (RFCT-110), RFCT-096's rule. The fixture is a packed root
// carrying one file: the RAUC config each check reads. The BASELINE is the real
// rendered `system.conf` from the shipped cx3576 and x64 overlays -- read off
// disk rather than retyped, so a renderer change that these checks would newly
// fail shows up here and not three commits later in a parity run.
//
// Every mutation below is a single edit to that real text. That is the point:
// the failures these checks exist for are one wrong GUID, one wrong path, one
// missing bootname -- a hand-written "obviously broken" config would go red for
// reasons the real failure does not have.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { NO_TOOLS } from './checks-fixture.ts'
import { RAUC_CHECKS } from './checks-rauc.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { boardEnvPath, REPO_ROOT } from './paths.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

/** The rendered shape, from the board definition. Used only when nothing is staged. */
function synthesised(board: typeof cx3576): string {
  const guid = (n: string): string => (board.partition(n)?.guid ?? '').toLowerCase()
  return [
    '[system]',
    `compatible=mos-${board.name}`,
    `bootloader=${board.bootloader ?? ''}`,
    'statusfile=/mnt/meta/rauc.status',
    'bundle-formats=verity',
    '',
    '[keyring]',
    'path=/etc/rauc/keyring.pem',
    '',
    '[slot.rootfs.0]',
    `device=/dev/disk/by-partuuid/${guid('ROOTFS_A')}`,
    'type=raw',
    'bootname=A',
    '',
    '[slot.rootfs.1]',
    `device=/dev/disk/by-partuuid/${guid('ROOTFS_B')}`,
    'type=raw',
    'bootname=B',
    '',
    '[slot.boot.0]',
    `device=/dev/disk/by-partuuid/${guid('BOOT_A')}`,
    'type=vfat',
    'parent=rootfs.0',
    '',
    '[slot.boot.1]',
    `device=/dev/disk/by-partuuid/${guid('BOOT_B')}`,
    'type=vfat',
    'parent=rootfs.1',
    '',
  ].join('\n')
}

/**
 * The config the shipped overlay actually renders, for one board.
 *
 * Taken from `_out/<board>/overlay-v2/`, which the image build stages and the
 * Dockerfile copies to /etc/rauc/system.conf, so the baseline these mutations
 * are made from is the file that shipped. A checkout that has never built falls
 * back to the rendered SHAPE with the board's own GUIDs -- the mutations below
 * are all single-line edits that apply to either, and each asserts the edit
 * actually changed the text before driving the check.
 */
function shippedConf(board: typeof cx3576): string {
  const staged = join(REPO_ROOT, '_out', board.name, 'overlay-v2', 'etc', 'rauc', 'system.conf')
  return existsSync(staged) ? readFileSync(staged, 'utf8') : synthesised(board)
}

function checkNamed(id: string): CheckCase {
  const found = RAUC_CHECKS.find(c => c.id === id)
  if (found === undefined) throw new Error(`no RAUC check is registered as '${id}'`)
  return found
}

/** A context whose only readable thing is an unpacked root holding `conf`. */
function rootFixture(board: typeof cx3576, conf: string | undefined): { ctx: ImageContext, dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'mos-rauc-fixture-'))
  const root = join(dir, 'root')
  const path = join(root, 'etc', 'rauc', 'system.conf')
  if (conf === undefined) {
    mkdirSync(root, { recursive: true })
  }
  else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, conf)
  }
  const refuse = (what: string): never => {
    throw new ToolOutputError(`the RAUC fixture has no ${what}; these checks read one file.`)
  }
  const ctx: ImageContext = {
    board,
    image: join(dir, 'fixture.img'),
    tools: NO_TOOLS,
    workDir: dir,
    outDir: dir,
    gpt: async () => refuse('partition table'),
    partition: async () => refuse('partition table'),
    fatSlot: async () => refuse('FAT slot'),
    extract: async () => refuse('extracted payloads'),
    extractAt: async () => refuse('image byte ranges'),
    unpackRoot: async () => root,
  }
  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

async function drive(id: string, conf: string | undefined, board = cx3576): Promise<CheckResult> {
  const fixture = rootFixture(board, conf)
  try {
    const results = await checkNamed(id).run(fixture.ctx)
    const first = results[0]
    if (first === undefined) throw new Error(`'${id}' concluded nothing`)
    return first
  }
  finally {
    fixture.dispose()
  }
}

const CX_CONF = shippedConf(cx3576)
const X64_CONF = shippedConf(x64)

const ALL = [
  'rauc-slot-devices-are-layout-guids',
  'rauc-slot-devices-by-partuuid',
  'rauc-statusfile-not-on-var',
  'rauc-keyring-path',
  'rauc-bootloader-backend',
  'rauc-rootfs-bootnames',
] as const

describe('the shipped config satisfies every check, on both boards', () => {
  test('cx3576', async () => {
    for (const id of ALL) expect((await drive(id, CX_CONF)).verdict).toBe('pass')
  })

  test('x64 — a different backend and different GUIDs, the same six checks', async () => {
    for (const id of ALL) expect((await drive(id, X64_CONF, x64)).verdict).toBe('pass')
  })

  test('each board\'s config is RED against the OTHER board', async () => {
    // The failure this catches for real: a renderer run with one board's env
    // while the assembler ran with the other's. Both files are internally
    // consistent, so only a check that reads the layout separately finds it.
    expect((await drive('rauc-slot-devices-are-layout-guids', X64_CONF, cx3576)).verdict).toBe('fail')
    expect((await drive('rauc-bootloader-backend', X64_CONF, cx3576)).verdict).toBe('fail')
    expect((await drive('rauc-slot-devices-are-layout-guids', CX_CONF, x64)).verdict).toBe('fail')
  })
})

describe('rauc-slot-devices-are-layout-guids', () => {
  test('RED when rootfs.0 points at rootfs-b — an install over the RUNNING slot', async () => {
    const a = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const b = (cx3576.partition('ROOTFS_B')?.guid ?? '').toLowerCase()
    const conf = CX_CONF.replace(`[slot.rootfs.0]\ndevice=/dev/disk/by-partuuid/${a}`,
      `[slot.rootfs.0]\ndevice=/dev/disk/by-partuuid/${b}`)
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-slot-devices-are-layout-guids', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(new RegExp(`rootfs\\.0 -> '.*${b}' \\(expected .*${a}\\)`))
  })

  test('RED when a slot section is missing entirely', async () => {
    const conf = CX_CONF.replace('[slot.boot.1]', '[slot.boot.9]')
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-slot-devices-are-layout-guids', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/boot\.1 -> ''/)
  })

  test('a device written in UPPERCASE stays green — GUIDs are hexadecimal', async () => {
    const a = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const conf = CX_CONF.replace(`device=/dev/disk/by-partuuid/${a}`,
      `device=/dev/disk/by-partuuid/${a.toUpperCase()}`)
    expect(conf).not.toBe(CX_CONF)
    expect((await drive('rauc-slot-devices-are-layout-guids', conf)).verdict).toBe('pass')
  })

  test('a device in a LATER section does not answer for an earlier one', async () => {
    // The reader stops at the next `[`. Without that, deleting a section's
    // device line would silently be answered by the following section's, and
    // the check would pass while rootfs.0 had no device at all.
    const a = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const conf = CX_CONF.replace(`[slot.rootfs.0]\ndevice=/dev/disk/by-partuuid/${a}\n`, '[slot.rootfs.0]\n')
    expect(conf).not.toBe(CX_CONF)
    expect((await drive('rauc-slot-devices-are-layout-guids', conf)).verdict).toBe('fail')
  })
})

describe('rauc-slot-devices-by-partuuid', () => {
  test('RED on a /dev/mmcblk0pN path — the renumbering failure', async () => {
    const bootA = (cx3576.partition('BOOT_A')?.guid ?? '').toLowerCase()
    const conf = CX_CONF.replace(`device=/dev/disk/by-partuuid/${bootA}`, 'device=/dev/mmcblk0p4')
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-slot-devices-by-partuuid', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/\/dev\/mmcblk0p4 \(type=vfat, not addressed by PARTUUID\)/)
  })

  test('a type=file slot is judged by ABSOLUTENESS, not by PARTUUID', async () => {
    // x64's per-slot kernel and cmdline are `file` slots; folding the two rules
    // would fail every grub board that ever grows one.
    const conf = `${CX_CONF}\n[slot.boot.2]\ndevice=/EFI/mos/vmlinuz-a\ntype=file\nparent=rootfs.0\n`
    expect((await drive('rauc-slot-devices-by-partuuid', conf)).verdict).toBe('pass')
  })

  test('RED on a RELATIVE type=file device', async () => {
    const conf = `${CX_CONF}\n[slot.boot.2]\ndevice=EFI/mos/vmlinuz-a\ntype=file\nparent=rootfs.0\n`
    const r = await drive('rauc-slot-devices-by-partuuid', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/EFI\/mos\/vmlinuz-a \(type=file, not an absolute path\)/)
  })
})

describe('rauc-statusfile-not-on-var', () => {
  test('RED on /var — the wipe-safety contract, stated as its own failure', async () => {
    const conf = CX_CONF.replace('statusfile=/mnt/meta/rauc.status', 'statusfile=/var/lib/rauc/rauc.status')
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-statusfile-not-on-var', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/must live on META or STATE, never on the discardable \/var/)
  })

  test('STATE is accepted as well as META', async () => {
    const conf = CX_CONF.replace('statusfile=/mnt/meta/rauc.status', 'statusfile=/mnt/state/rauc.status')
    const r = await drive('rauc-statusfile-not-on-var', conf)
    expect(r.verdict).toBe('pass')
    expect(r.message).toMatch(/resolves onto STATE/)
  })

  test('the LAST assignment wins, which is the one RAUC would use', async () => {
    expect((await drive('rauc-statusfile-not-on-var', `${CX_CONF}\nstatusfile=/var/lib/rauc/rauc.status\n`)).verdict)
      .toBe('fail')
  })

  test('RED when there is no statusfile at all', async () => {
    const conf = CX_CONF.replace(/^statusfile=.*$/m, '')
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-statusfile-not-on-var', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/RAUC statusfile is ''/)
  })
})

describe('rauc-keyring-path', () => {
  test('RED when the keyring path moves', async () => {
    const conf = CX_CONF.replace('path=/etc/rauc/keyring.pem', 'path=/mnt/state/rauc/keyring.pem')
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-keyring-path', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/does not match/)
  })

  test('the match is ANCHORED — a commented path does not satisfy it', async () => {
    const conf = CX_CONF.replace('path=/etc/rauc/keyring.pem', '#path=/etc/rauc/keyring.pem')
    expect(conf).not.toBe(CX_CONF)
    expect((await drive('rauc-keyring-path', conf)).verdict).toBe('fail')
  })
})

describe('rauc-bootloader-backend', () => {
  test('RED when the backend is not the one the board declares', async () => {
    const conf = CX_CONF.replace('bootloader=uboot', 'bootloader=grub')
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-bootloader-backend', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/selects the uboot bootloader backend/)
  })

  test('the same config is green for the board that declares that backend', async () => {
    // Which is the whole reason the expectation comes from the layout: pinned
    // to either literal, this check would fail the correct configuration of the
    // other board and be read as a defect in the image.
    expect((await drive('rauc-bootloader-backend', X64_CONF, x64)).verdict).toBe('pass')
  })
})

describe('rauc-rootfs-bootnames', () => {
  test('RED when one bootname is missing — rauc then has no bootable slot group', async () => {
    const conf = CX_CONF.replace(/^bootname=B$/m, '')
    expect(conf).not.toBe(CX_CONF)
    const r = await drive('rauc-rootfs-bootnames', conf)
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/must give both rootfs slots a bootname=A \/ bootname=B/)
  })

  test('RED on a THIRD bootname, not just on a missing one', async () => {
    expect((await drive('rauc-rootfs-bootnames', `${CX_CONF}\nbootname=A\n`)).verdict).toBe('fail')
  })

  test('RED on a bootname that is not A or B', async () => {
    const conf = CX_CONF.replace(/^bootname=B$/m, 'bootname=1')
    expect(conf).not.toBe(CX_CONF)
    expect((await drive('rauc-rootfs-bootnames', conf)).verdict).toBe('fail')
  })
})

describe('a packed root with no RAUC config at all', () => {
  test('five of the six go RED, and none of them throws', async () => {
    // Absence is a fact about the image, not a broken read, so it is answered
    // with a verdict. A throw would report "the check could not run" about an
    // image that shipped with no update configuration at all.
    for (const id of ALL.filter(i => i !== 'rauc-slot-devices-by-partuuid')) {
      expect((await drive(id, undefined)).verdict).toBe('fail')
    }
  })

  test('the sixth passes VACUOUSLY, and the oracle does too', async () => {
    // FOUND, NOT INTRODUCED, and reproduced deliberately.
    //
    // `rauc-slot-devices-by-partuuid` asks "is any slot device NOT a
    // by-partuuid path" and passes when the answer is no. With no config there
    // are no slot devices, so the answer is no and the check is green about an
    // image that ships no update configuration at all.
    //
    // os/verify-image-v2.sh:2884 does exactly the same thing: its awk over a
    // missing file is redirected to /dev/null, `bad_devs` comes back empty and
    // `[ -z "${bad_devs}" ]` passes. Diverging here would be a divergence
    // introduced by the PORT, so this reproduces it -- and reports it. The
    // repair is a "found at least one slot" precondition, which is an
    // assertion the oracle does not make and therefore `orphan` until M4e.
    expect((await drive('rauc-slot-devices-by-partuuid', undefined)).verdict).toBe('pass')
    // What stops it mattering today: the four slots are asserted BY NAME by
    // the check above, which is red on the same input.
    expect((await drive('rauc-slot-devices-are-layout-guids', undefined)).verdict).toBe('fail')
  })
})

describe('a check that cannot decide THROWS', () => {
  test('a board declaring no ROOTFS_A_GUID', async () => {
    const hollow = {
      ...cx3576,
      partition: (n: string) => {
        const p = cx3576.partition(n)
        if (p === undefined || n !== 'ROOTFS_A') return p
        return { ...p, guid: undefined }
      },
    } as typeof cx3576
    await expect(drive('rauc-slot-devices-are-layout-guids', CX_CONF, hollow))
      .rejects.toThrow(/declares no ROOTFS_A_GUID/)
  })

  test('a board declaring no RAUC_BOOTLOADER', async () => {
    const hollow = { ...cx3576, bootloader: undefined } as typeof cx3576
    await expect(drive('rauc-bootloader-backend', CX_CONF, hollow))
      .rejects.toThrow(/declares no RAUC_BOOTLOADER/)
  })
})
