// The model, read against the two board definitions that actually ship.
//
// A model exercised only on fixtures its author wrote is a model of its
// author's expectations. These two boards differ in the ways that matter:
// cx3576 is a U-Boot board with 11 partitions, a raw loader blob, a redundant
// U-Boot environment, radios and hardware-init confs; x64 is a GRUB board with
// 9, no loader at all, and BOARD_FIRMWARE_FILES / BOARD_HWINIT_CONFS declared
// EMPTY on purpose. Anything that passes on cx3576 alone is half tested.
//
// The values below are checked against the files. Where a value is derived --
// `$((...))` geometry, a `${...}` alias -- the assertion states the resolved
// number, because a model that carried the expression through as text would
// satisfy any assertion phrased as "the same string the file has".

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BoardEnvError } from './board-env.ts'
import { isKnownRole, KNOWN_ROLES, loadBoard, loadBoards } from './board.ts'
import { boardEnvPath, BOARDS_DIR } from './paths.ts'

/**
 * Write a mutated copy of a real board definition and hand it to `fn`.
 *
 * The copy is deliberately NOT called board.env: a message about it should say
 * "candidate", not name a real board it is not. The same correction
 * verify/src/lint.test.ts carries the same correction.
 */
function withMutatedBoard<T>(board: string, edit: (text: string) => string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mos-board-'))
  try {
    const p = join(dir, 'candidate.env')
    writeFileSync(p, edit(readFileSync(boardEnvPath(board), 'utf8')))
    return fn(p)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

describe('cx3576 — the U-Boot board', () => {
  test('identifies itself, and its identity is its directory', () => {
    expect(cx3576.name).toBe('cx3576')
    expect(cx3576.layoutBoard).toBe('cx3576')
    expect(cx3576.layoutVersion).toBe(2)
    expect(cx3576.arch).toBe('arm64')
    expect(cx3576.sectorSize).toBe(512)
    expect(cx3576.mibBytes).toBe(1048576)
  })

  test('declares 11 partitions, in order, numbered 1..11', () => {
    expect(cx3576.partitions.map(p => p.name)).toEqual([
      'LOADER', 'UENV_A', 'UENV_B', 'BOOT_A', 'BOOT_B',
      'ROOTFS_A', 'ROOTFS_B', 'META', 'STATE', 'EPHEMERAL', 'DATA',
    ])
    expect(cx3576.partitions.map(p => p.partnum)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(cx3576.partitions.map(p => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  test('the raw loader blob, which x64 does not have', () => {
    const loader = cx3576.partition('LOADER')!
    expect(loader.role).toBe('raw-blob')
    expect(loader.startSector).toBe(64)
    expect(loader.sizeSectors).toBe(32704)
    expect(loader.magicHex).toBe('524b4e53')
    expect(loader.guid).toBe('5AC35760-0002-4000-8000-000000000011')
    // A raw blob has no filesystem, and the absence is what its role means.
    expect(loader.fsLabel).toBeUndefined()
    expect(loader.fatLabel).toBeUndefined()
    expect(loader.declared('FS_UUID')).toBe(false)
  })

  test('the redundant U-Boot environment, sized through a ${} alias', () => {
    const a = cx3576.partition('UENV_A')!
    const b = cx3576.partition('UENV_B')!
    expect(a.role).toBe('uboot-env')
    expect(a.offsetBytes).toBe(16777216)
    expect(b.offsetBytes).toBe(17825792)
    // UENV_A_SIZE_SECTORS="${UENV_SIZE_SECTORS}" -- resolved, not carried.
    expect(a.sizeSectors).toBe(128)
    expect(b.sizeSectors).toBe(128)
    expect(cx3576.get('UENV_SIZE_BYTES')).toBe('65536')
  })

  test('the boot pair: three spellings of one start, and a ${} size', () => {
    const boot = cx3576.partition('BOOT_A')!
    expect(boot.role).toBe('esp')
    expect(boot.startMib).toBe(18)
    expect(boot.startSector).toBe(36864)
    expect(boot.offsetBytes).toBe(18874368)
    expect(boot.sizeMib).toBe(64) // BOOT_A_SIZE_MIB="${BOOT_SIZE_MIB}"
    expect(boot.fatLabel).toBe('BOOT-A')
    expect(boot.fatVolumeId).toBe('C3576003')
  })

  test('the read-write filesystems, and /var sized through MOS_VAR_MIB', () => {
    const eph = cx3576.partition('EPHEMERAL')!
    expect(eph.role).toBe('ext4')
    expect(eph.fsLabel).toBe('ephemeral')
    expect(eph.fsUuid).toBe('5ac35760-0002-4000-8000-000000000109')
    expect(eph.sizeMib).toBe(512) // EPHEMERAL_SIZE_MIB="${MOS_VAR_MIB}"
    expect(cx3576.get('MOS_VAR_MIB')).toBe('512')
  })

  test('U-Boot counts boot attempts, and there is no grubenv', () => {
    expect(cx3576.bootloader).toBe('uboot')
    expect(cx3576.bootAttemptsDefault).toBe(3)
    expect(cx3576.grubenv).toBeUndefined()
    expect(cx3576.declared('RAUC_GRUBENV')).toBe(false)
  })

  test('the board lists: radios, hardware-init confs and radio firmware', () => {
    expect(cx3576.radios).toEqual(['wifi', 'bluetooth'])
    expect(cx3576.hwinitConfs).toEqual(['otg', 'can', 'bt', 'mac', 'gadget', 'modules'])
    expect(cx3576.firmwareFiles!.length).toBe(5)
    expect(cx3576.firmwareFiles![0]).toBe('/usr/lib/firmware/aic_userconfig_8800d80.txt')
    // Interpolated mid-list, with @SLOT@ left alone for the installer.
    expect(cx3576.bootSlotRequiredFiles)
      .toEqual(['Image', 'rk3576-src.dtb', 'boot.scr', 'mos-verity-@SLOT@.env', 'mos-boot-digest.env'])
    // A U-Boot board has no ESP contents list; absent, not empty.
    expect(cx3576.espRequiredFiles).toBeUndefined()
  })

  test('has a status indicator, and a smaller size budget', () => {
    expect(cx3576.hasStatusLed).toBe('1')
    expect(cx3576.sizeBudgetMb).toBe(400)
    expect(cx3576.cmdlineArgs).toBe('console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 net.ifnames=0')
  })

  test('reads clean: no faults, no duplicated keys, 144 assignments', () => {
    expect(cx3576.faults).toEqual([])
    expect(cx3576.env.duplicates).toEqual([])
    // If this number moves, the board definition gained or lost a key. That is
    // a deliberate act; update it deliberately.
    expect(cx3576.env.assignments.length).toBe(144)
    expect(cx3576.env.values.size).toBe(144)
  })
})

describe('x64 — the GRUB board', () => {
  test('identifies itself', () => {
    expect(x64.name).toBe('x64')
    expect(x64.layoutBoard).toBe('x64')
    expect(x64.layoutVersion).toBe(2)
    expect(x64.arch).toBe('amd64')
  })

  test('declares 9 partitions, numbered 1..9, and no loader at all', () => {
    expect(x64.partitions.map(p => p.name)).toEqual([
      'ESP', 'BOOT_A', 'BOOT_B', 'ROOTFS_A', 'ROOTFS_B',
      'META', 'STATE', 'EPHEMERAL', 'DATA',
    ])
    expect(x64.partitions.map(p => p.partnum)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(x64.partition('LOADER')).toBeUndefined()
    expect(x64.partition('UENV_A')).toBeUndefined()
  })

  test('the ESP geometry is DERIVED, and the model resolves the arithmetic', () => {
    const esp = x64.partition('ESP')!
    expect(esp.role).toBe('esp')
    expect(esp.startMib).toBe(1)
    // ESP_START_SECTOR=$((ESP_START_MIB * MIB_BYTES / SECTOR_SIZE))
    expect(esp.startSector).toBe(2048)
    expect(esp.offsetBytes).toBe(1048576)
    expect(esp.sizeMib).toBe(64)
    expect(esp.fatLabel).toBe('MOS-ESP')
    expect(esp.fatVolumeId).toBe('C3576100')
    expect(esp.get('MOUNT')).toBe('/boot')
  })

  test('the boot pair, both spellings derived from one MiB start', () => {
    const a = x64.partition('BOOT_A')!
    const b = x64.partition('BOOT_B')!
    expect(a.startMib).toBe(65)
    expect(a.startSector).toBe(133120)
    expect(a.offsetBytes).toBe(68157440)
    expect(a.sizeMib).toBe(96) // BOOT_A_SIZE_MIB="${BOOT_SIZE_MIB}"
    expect(b.startMib).toBe(161)
    expect(b.startSector).toBe(329728)
    expect(b.offsetBytes).toBe(168820736)
    // Microsoft basic data, deliberately not the ESP type code: firmware would
    // otherwise try to boot a partition that carries no EFI binary.
    expect(a.typecode).toBe('EBD0A0A2-B9E5-4433-87C0-68B6B72699C7')
    expect(x64.partition('ESP')!.typecode).toBe('C12A7328-F81F-11D2-BA4B-00A0C93EC93B')
  })

  test('GRUB keeps an env file and CANNOT count boot attempts', () => {
    expect(x64.bootloader).toBe('grub')
    expect(x64.grubenv).toBe('/boot/EFI/mos/grubenv')
    // The absence is the correction RAUC forced: with bootloader=grub it
    // refuses a configuration that sets boot attempts and exits 1.
    expect(x64.declared('BOOT_ATTEMPTS_DEFAULT')).toBe(false)
    expect(x64.bootAttemptsDefault).toBeUndefined()
  })

  test('DECLARED EMPTY is not ABSENT, which is the distinction a shell reader loses', () => {
    // x64 says, on purpose, that a QEMU machine has no radio firmware and no
    // hardware-init confs. Under `${X:-}` that reads identically to a board
    // that simply forgot them.
    expect(x64.firmwareFiles).toEqual([])
    expect(x64.declared('BOARD_FIRMWARE_FILES')).toBe(true)
    expect(x64.hwinitConfs).toEqual([])
    expect(x64.declared('BOARD_HWINIT_CONFS')).toBe(true)
    expect(x64.radios).toEqual([])
    expect(x64.declared('BOARD_RADIOS')).toBe(true)
    // and the other side of the distinction, on the same board:
    expect(x64.declared('BOARD_HWINIT_CONFS_THAT_DO_NOT_EXIST')).toBe(false)
    expect(x64.get('BOARD_HWINIT_CONFS_THAT_DO_NOT_EXIST')).toBeUndefined()
  })

  test('the two file lists a slot and the ESP must carry', () => {
    expect(x64.bootSlotRequiredFiles).toEqual(['vmlinuz', 'cmdline.cfg'])
    expect(x64.espRequiredFiles).toEqual(['EFI/BOOT/BOOTX64.EFI', 'EFI/mos/grub.cfg', 'EFI/mos/grubenv'])
  })

  test('no status indicator, and a bigger size budget for the generic kernel', () => {
    expect(x64.hasStatusLed).toBe('0')
    expect(x64.sizeBudgetMb).toBe(520)
    expect(x64.cmdlineArgs).toBe('console=tty0 console=ttyS0,115200 net.ifnames=0')
  })

  test('reads clean: no faults, no duplicated keys, 116 assignments', () => {
    expect(x64.faults).toEqual([])
    expect(x64.env.duplicates).toEqual([])
    expect(x64.env.assignments.length).toBe(116)
    expect(x64.env.values.size).toBe(116)
  })
})

describe('both boards at once', () => {
  const boards = [cx3576, x64]

  test('every declared role is one the model knows', () => {
    for (const b of boards) {
      for (const p of b.partitions) {
        expect({ board: b.name, part: p.name, role: p.role, known: isKnownRole(p.role) })
          .toEqual({ board: b.name, part: p.name, role: p.role, known: true })
      }
    }
    expect([...KNOWN_ROLES]).toEqual(['raw-blob', 'uboot-env', 'esp', 'verity-slot', 'ext4'])
  })

  test('every partition carries the common core, whatever its role', () => {
    for (const b of boards) {
      for (const p of b.partitions) {
        for (const [what, v] of [['partnum', p.partnum], ['label', p.label], ['guid', p.guid], ['typecode', p.typecode]] as const) {
          expect(`${b.name}.${p.name}.${what}=${v === undefined ? 'ABSENT' : 'present'}`)
            .toBe(`${b.name}.${p.name}.${what}=present`)
        }
      }
    }
  })

  test('one start, spelled in up to three units, and the three agree', () => {
    // cx3576 writes MiB, sector and byte offset as three independent literals;
    // x64 derives the latter two. The model carries enough to check both, which
    // is what makes this a property of the data rather than of the spelling.
    let compared = 0
    for (const b of boards) {
      const mib = b.mibBytes!
      const sector = b.sectorSize!
      for (const p of b.partitions) {
        if (p.startMib === undefined) continue
        if (p.startSector !== undefined) {
          expect(`${b.name}.${p.name} sector`).toBe(`${b.name}.${p.name} sector`)
          expect(p.startSector).toBe(p.startMib * mib / sector)
          compared++
        }
        if (p.offsetBytes !== undefined) {
          expect(p.offsetBytes).toBe(p.startMib * mib)
          compared++
        }
      }
    }
    // A loop that compared nothing reports the same green as one that passed.
    expect(compared).toBe(16)
  })

  test('the two boards really are different, so a green run means something', () => {
    expect(cx3576.partitions.length).toBe(11)
    expect(x64.partitions.length).toBe(9)
    expect(cx3576.bootloader).not.toBe(x64.bootloader)
    expect(cx3576.arch).not.toBe(x64.arch)
    expect(cx3576.radios!.length).toBeGreaterThan(0)
    expect(x64.radios!.length).toBe(0)
  })
})

describe('the model reports, and the parser refuses', () => {
  test('a key typed as a number whose value is not becomes a fault, not an exception', () => {
    withMutatedBoard('x64', t => t.replace('STATE_PARTNUM=7', 'STATE_PARTNUM=seven'), p => {
      const board = loadBoard(p)
      // Read to the end -- the other eight partitions still model.
      expect(board.partitions.length).toBe(9)
      expect(board.partition('STATE')!.partnum).toBeUndefined()
      expect(board.faults.map(f => f.key)).toEqual(['STATE_PARTNUM'])
      expect(board.faults[0]!.value).toBe('seven')
      expect(board.faults[0]!.reason).toContain('is read as a number here, and it is not one')
    })
  })

  test('a real board definition with a command substitution injected is REFUSED, by name', () => {
    // The whole point, end to end: a board definition is data, and the day one
    // of them acquires a `$(...)` the reader must say so rather than run it.
    withMutatedBoard('x64', t => t.replace('MOS_ARCH=amd64', 'MOS_ARCH=$(uname -m)'), p => {
      let err: unknown
      try {
        loadBoard(p)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(BoardEnvError)
      const e = err as BoardEnvError
      expect(e.message).toContain('command substitution `$(...)`')
      expect(e.path).toBe(p)
      expect(e.sourceLine).toBe('MOS_ARCH=$(uname -m)')
      expect(e.line).toBeGreaterThan(0)
    })
  })
})

describe('loading every board at once, which is what a lint does', () => {
  test('loadBoards reads them in the order it is given, each with its own identity', () => {
    const both = loadBoards(BOARDS_DIR, ['cx3576', 'virt-arm64', 'x64'])
    expect(both.map(b => b.name)).toEqual(['cx3576', 'virt-arm64', 'x64'])
    // 11 for the U-Boot board (loader + the uenv pair), 9 for each UEFI one.
    expect(both.map(b => b.partitions.length)).toEqual([11, 9, 9])
    // Separate models, not one environment that let the first board's keys
    // satisfy the second's -- which is why the retired shell lint sourced each
    // one in its own subshell, and why loadBoard() shares no state between files.
    expect(both[1]!.declared('LOADER_PARTNUM')).toBe(false)
    expect(both[0]!.declared('LOADER_PARTNUM')).toBe(true)
  })

  test('a board that is not there fails as a missing file, naming it', () => {
    expect(() => loadBoards(BOARDS_DIR, ['no-such-board'])).toThrow(/no-such-board/)
  })
})

describe('the path arithmetic that found these files', () => {
  test('both board definitions are where the package computed they would be', () => {
    expect(boardEnvPath('cx3576')).toBe(join(BOARDS_DIR, 'cx3576', 'board.env'))
    expect(readFileSync(boardEnvPath('cx3576'), 'utf8')).toContain('LAYOUT_BOARD=cx3576')
    expect(readFileSync(boardEnvPath('x64'), 'utf8')).toContain('LAYOUT_BOARD=x64')
  })
})

describe('a number too large to read exactly is a FAULT, not a rounded value', () => {
  // board-env.ts:431-434 evaluates `$(( ))` in BigInt and says why: "a size that
  // is silently one byte out is the class of defect this whole package exists
  // to make visible". `int()` did not hold up its end -- it handed back
  // `Number(t)` regardless, so a value past 2^53 came back rounded with
  // `faults` EMPTY. Inexact, and silent about it, in the one place whose job is
  // to be neither.

  /**
   * Retype STATE_SIZE_MIB, and REFUSE an edit that changed nothing.
   *
   * Written after a first draft of this file mutated a key x64 does not declare
   * (`ROOTFS_A_SIZE_SECTORS`): the replace matched no text, the board modelled
   * cleanly, and four tests failed for a reason that had nothing to do with
   * what they were testing. A mutation that does not reach the thing under test
   * is a test reporting on a run that never happened.
   */
  function withSize<T>(value: string, fn: (board: ReturnType<typeof loadBoard>) => T): T {
    return withMutatedBoard('x64', (t) => {
      const out = t.replace(/^STATE_SIZE_MIB=.*$/m, `STATE_SIZE_MIB=${value}`)
      if (out === t) throw new Error('the STATE_SIZE_MIB mutation matched nothing in x64/board.env')
      return out
    }, p => fn(loadBoard(p)))
  }

  test('2^53 + 1 is refused, and the fault says what it WOULD have come back as', () => {
    withSize('9007199254740993', (board) => {
      // Not rounded to ...992 and passed off as the declared value.
      expect(board.partition('STATE')!.sizeMib).toBeUndefined()
      expect(board.faults.map(f => f.key)).toEqual(['STATE_SIZE_MIB'])
      expect(board.faults[0]!.value).toBe('9007199254740993')
      expect(board.faults[0]!.reason).toContain('too large to read exactly as a double')
      // The rounded value is NAMED, because "too large" without it leaves a
      // reader unable to see how far off the silent answer would have been.
      expect(board.faults[0]!.reason).toContain('9007199254740992')
    })
  })

  test('the boundary is exact: 2^53 - 1 models, 2^53 does not', () => {
    withSize('9007199254740991', (board) => {
      expect(board.partition('STATE')!.sizeMib).toBe(9007199254740991)
      expect(board.faults).toEqual([])
    })
    withSize('9007199254740992', (board) => {
      // Refused although it round-trips. Its NEIGHBOURS do not, and a board one
      // increment away from silent inexactness is not one to be quiet about.
      expect(board.partition('STATE')!.sizeMib).toBeUndefined()
      expect(board.faults.length).toBe(1)
    })
  })

  test('the NEGATIVE side of the range is refused too', () => {
    withSize('-9007199254740993', (board) => {
      expect(board.partition('STATE')!.sizeMib).toBeUndefined()
      expect(board.faults[0]!.reason).toContain('-9007199254740992')
    })
  })

  test('the fault is DISTINGUISHABLE from "that is not a number at all"', () => {
    // Two different mistakes with two different repairs: one is a typo in the
    // value, the other is a value the reader cannot carry. A shared message
    // would send a reader hunting for a typo in a digit string that has none.
    withSize('9007199254740993', (board) => {
      expect(board.faults[0]!.reason).not.toContain('is read as a number here, and it is not one')
    })
    withSize('sixty-four', (board) => {
      expect(board.faults[0]!.reason).toContain('is read as a number here, and it is not one')
      expect(board.faults[0]!.reason).not.toContain('too large to read exactly')
    })
  })

  test('the model reads to the END -- one unusable value does not stop the other eight', () => {
    withSize('9007199254740993', (board) => {
      expect(board.partitions.length).toBe(9)
      expect(board.partition('DATA')!.sizeMib).toBe(64)
    })
  })

  test('and the shipped boards carry no such value, so this changes nothing for them', () => {
    // The defect was silence, not a live wrong number: real sizes are ~10^2 and
    // real sector counts ~10^6, well inside the range. Asserted so a future
    // board.env that DID cross the line is caught here first.
    for (const b of [cx3576, x64]) {
      expect(b.faults).toEqual([])
      for (const part of b.partitions) {
        for (const v of [part.sizeSectors, part.startSector, part.offsetBytes, part.sizeMib]) {
          if (v !== undefined) expect(Number.isSafeInteger(v)).toBe(true)
        }
      }
    }
  })
})
