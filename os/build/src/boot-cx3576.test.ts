// Every boot.cmd and verity-cmdline guard, driven from the failing side.
//
// These are the refusals whose absence does not announce itself. A stale
// `bootpart` makes U-Boot persist the boot-attempt decrement and THEN fail to
// find Image; a lost `rauc.slot=` makes every update roll back while the device
// reports healthy; a boot-attempts value of 10 means ten to U-Boot and sixteen
// to RAUC. None of them fail a build that does not check, so the check is the
// entire defence: a refusal that has only ever been observed working is not
// evidence that it still can.
//
// THE POSITIVE CONTROL IS BESIDE EVERY NEGATIVE. The tree's real boot.cmd and
// the tree's real cmdline shape must PASS every function here. Without that, a
// guard that refused everything would satisfy each negative case below.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bootAttemptValues,
  bootCmdSetting,
  checkBootAttempts,
  checkBootCmd,
  checkBootCmdTokens,
  checkPartitionNumbers,
  verityEnvBase,
  verityEnvFor,
} from './boot-cx3576.ts'
import { loadGeometry, loadGeometryFromPath } from './geometry.ts'
import { BOARDS_DIR, makeWorkDir } from './paths.ts'
import { readFileSync as read, rmSync, writeFileSync } from 'node:fs'

const g = loadGeometry('cx3576')
const BOOT_CMD_PATH = join(BOARDS_DIR, 'cx3576', 'boot.cmd')
const BOOT_CMD = readFileSync(BOOT_CMD_PATH, 'utf8')
const P = '<boot.cmd>'

function mutatedBoard(appended: string): { path: string, cleanup: () => void } {
  const dir = makeWorkDir('boot-cx3576')
  const path = join(dir, 'board.env')
  writeFileSync(path, `${read(join(BOARDS_DIR, 'cx3576', 'board.env'), 'utf8')}\n${appended}\n`)
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('the fixture is the tree\'s own file, and it passes everything', () => {
  test('the real boot.cmd satisfies every guard', () => {
    // The positive control for the whole file. A guard that threw on all input
    // would pass every negative below and fail only here.
    expect(() => checkBootCmd(g, BOOT_CMD, BOOT_CMD_PATH)).not.toThrow()
  })

  test('and it is a real file with the assignments these tests doctor', () => {
    expect(BOOT_CMD).toContain('setenv bootslot A')
    expect(BOOT_CMD).toContain('setenv bootpart 4')
    expect(BOOT_CMD.length).toBeGreaterThan(500)
  })
})

describe('boot-attempts must be readable in BOTH radices', () => {
  test('the shipped file installs 3, in all four places it spells one', () => {
    // Four, not two: the defaults block sets each slot's credit and the
    // exhausted-both-slots recovery block resets both. The shell greps the
    // whole file for the same reason -- a credit is a credit wherever it is
    // written, and the recovery block is the one a device actually reaches.
    expect(bootAttemptValues(BOOT_CMD)).toEqual([3n, 3n, 3n, 3n])
  })

  test('a credit above BOOT_ATTEMPTS_MAX is refused, naming the range', () => {
    // RAUC writes this counter with "%x" and reads it base 16; U-Boot's
    // `test -gt` parses decimal. 10 is "10" to one and 16 to the other.
    const bad = BOOT_CMD.replace('setenv BOOT_A_LEFT 3', 'setenv BOOT_A_LEFT 10')
    expect(bad).not.toBe(BOOT_CMD)
    expect(() => checkBootAttempts(g, bad, P))
      .toThrow(/sets a boot-attempts value of 10; RAUC writes this counter in hex and U-Boot compares it in decimal, so it must stay in 1\.\.9/)
  })

  test('a credit of 0 is below BOOT_ATTEMPTS_MIN and is refused too', () => {
    const bad = BOOT_CMD.replace('setenv BOOT_B_LEFT 3', 'setenv BOOT_B_LEFT 0')
    expect(bad).not.toBe(BOOT_CMD)
    expect(() => checkBootAttempts(g, bad, P)).toThrow(/value of 0;/)
  })

  test('the boundaries themselves are accepted', () => {
    for (const n of ['1', '9']) {
      expect(() => checkBootAttempts(g, `setenv BOOT_A_LEFT ${n}`, P)).not.toThrow()
    }
    expect(() => checkBootAttempts(g, 'setenv BOOT_A_LEFT 10', P)).toThrow()
    expect(() => checkBootAttempts(g, 'setenv BOOT_A_LEFT 0', P)).toThrow()
  })

  test('the range comes from the BOARD, not from a literal here', () => {
    const m = mutatedBoard('BOOT_ATTEMPTS_MAX=5')
    try {
      expect(() => checkBootAttempts(loadGeometryFromPath(m.path), 'setenv BOOT_A_LEFT 7', P))
        .toThrow(/must stay in 1\.\.5/)
    } finally { m.cleanup() }
  })

  test('the scan is not anchored to setenv', () => {
    // The shell greps for `BOOT_[AB]_LEFT [0-9]+` anywhere, so a credit written
    // in a `test` or an `echo` is checked as well.
    expect(bootAttemptValues('if test ${BOOT_A_LEFT} -gt 0; then setenv BOOT_A_LEFT 42; fi'))
      .toEqual([42n])
  })
})

describe('the verity env filenames are one derivation, not three copies', () => {
  test('the shipped board derives cleanly', () => {
    expect(verityEnvBase(g)).toBe('mos-verity')
  })

  test('a slot name that is not <base>-<slot>.env is refused', () => {
    // The per-slot names, the pattern boot.scr builds at runtime and the pattern
    // the bundle contract writes must all be the same derivation; any of the
    // three drifting means an updated slot silently fails to boot.
    const m = mutatedBoard('BOOT_VERITY_ENV_A_NAME=mos-verity-slot-a.env')
    try {
      expect(() => verityEnvBase(loadGeometryFromPath(m.path)))
        .toThrow(/must be 'mos-verity-a\.env'\/'mos-verity-b\.env' to match what the bundle contract writes/)
    } finally { m.cleanup() }
  })

  test('and the B side is checked too, not just A', () => {
    const m = mutatedBoard('BOOT_VERITY_ENV_B_NAME=mos-verity-B.env')
    try {
      expect(() => verityEnvBase(loadGeometryFromPath(m.path))).toThrow(/must be 'mos-verity-a\.env'/)
    } finally { m.cleanup() }
  })

  test('changing the BASE moves both, and stays consistent', () => {
    const m = mutatedBoard('BOOT_VERITY_ENV_NAME=v.env\nBOOT_VERITY_ENV_A_NAME=v-a.env\nBOOT_VERITY_ENV_B_NAME=v-b.env')
    try {
      expect(verityEnvBase(loadGeometryFromPath(m.path))).toBe('v')
    } finally { m.cleanup() }
  })
})

describe('the two tokens boot.cmd must carry', () => {
  test('rauc.slot=${bootslot} missing -- every update rolls back silently', () => {
    // rauc matches only bootname / slot name / realpath(device), and the verity
    // root is /dev/dm-0. Without this token `rauc status` fails, the health gate
    // never runs `rauc status mark-good`, and every installed slot is rolled
    // back while the device looks healthy.
    // replaceAll: the token appears in a COMMENT as well as in the code, and a
    // replace that changed only the comment would leave the guard nothing to
    // catch -- a negative test that is not negative.
    const bad = BOOT_CMD.replaceAll('rauc.slot=${bootslot}', 'rauc.slot=A')
    expect(bad).not.toBe(BOOT_CMD)
    expect(() => checkBootCmdTokens(g, bad, P))
      .toThrow(/does not set rauc\.slot=\$\{bootslot\} on the kernel cmdline/)
  })

  test('the per-slot verity env load missing -- an unsuffixed load rolls updates back', () => {
    // A RAUC-installed slot carries ONLY the slot-suffixed files.
    const bad = BOOT_CMD.replaceAll('mos-verity-${slotsuffix}.env', 'mos-verity.env')
    expect(bad).not.toBe(BOOT_CMD)
    expect(() => checkBootCmdTokens(g, bad, P))
      .toThrow(/does not load the per-slot verity env 'mos-verity-\$\{slotsuffix\}\.env'/)
  })

  test('the pattern it looks for is derived from the board', () => {
    const m = mutatedBoard('BOOT_VERITY_ENV_NAME=v.env\nBOOT_VERITY_ENV_A_NAME=v-a.env\nBOOT_VERITY_ENV_B_NAME=v-b.env')
    try {
      // The tree's boot.cmd loads mos-verity-${slotsuffix}.env, so a board that
      // renamed the base must refuse it -- naming the name it wanted.
      expect(() => checkBootCmdTokens(loadGeometryFromPath(m.path), BOOT_CMD, P))
        .toThrow(/does not load the per-slot verity env 'v-\$\{slotsuffix\}\.env'/)
    } finally { m.cleanup() }
  })
})

describe('THE RENUMBERING GUARD', () => {
  test('the shipped boot.cmd agrees with the shipped layout, all four', () => {
    expect([
      bootCmdSetting(BOOT_CMD, 'A', 'bootpart'),
      bootCmdSetting(BOOT_CMD, 'B', 'bootpart'),
      bootCmdSetting(BOOT_CMD, 'A', 'rootpart'),
      bootCmdSetting(BOOT_CMD, 'B', 'rootpart'),
    ]).toEqual(['4', '5', '6', '7'])
    expect(() => checkPartitionNumbers(g, BOOT_CMD, P)).not.toThrow()
  })

  // Each of the four, doctored to the number one PAST the right one -- the shape
  // "someone inserted a partition ahead of the boot slots and did not renumber".
  const stale: [string, string, string, string][] = [
    ['A', 'bootpart', '4', '5'],
    ['B', 'bootpart', '5', '6'],
    ['A', 'rootpart', '6', '7'],
    ['B', 'rootpart', '7', '8'],
  ]
  for (const [slot, name, real, wrong] of stale) {
    test(`a stale ${name} (${wrong}) for slot ${slot}`, () => {
      const bad = BOOT_CMD.replace(`setenv ${name} ${real}`, `setenv ${name} ${wrong}`)
      expect(bad).not.toBe(BOOT_CMD)
      expect(() => checkPartitionNumbers(g, bad, P))
        .toThrow(new RegExp(`sets '${name}' to '${wrong}' for slot ${slot}, but the layout puts that partition at p${real}`))
    })
  }

  test('the refusal explains that the decrement is already persisted', () => {
    const bad = BOOT_CMD.replace('setenv bootpart 4', 'setenv bootpart 9')
    try {
      checkPartitionNumbers(g, bad, P)
      throw new Error('unreachable')
    } catch (e) {
      expect(String(e)).toContain('AFTER it has already persisted the boot-attempt decrement')
      expect(String(e)).toContain(g.path)
    }
  })

  test('a boot.cmd that sets the variable NOWHERE says so, rather than comparing undefined', () => {
    // `got:-nothing` in the shell. Left alone, `undefined !== '4'` is a failure
    // that names the wrong thing.
    const bad = BOOT_CMD.replaceAll('setenv bootpart', 'setenv notbootpart')
    expect(() => checkPartitionNumbers(g, bad, P)).toThrow(/sets 'bootpart' to 'nothing' for slot A/)
  })

  test('the expected numbers come from the LAYOUT, so moving a partition moves them', () => {
    const m = mutatedBoard('BOOT_A_PARTNUM=99')
    try {
      expect(() => checkPartitionNumbers(loadGeometryFromPath(m.path), BOOT_CMD, P))
        .toThrow(/sets 'bootpart' to '4' for slot A, but the layout puts that partition at p99/)
    } finally { m.cleanup() }
  })

  test('the scan latches on `setenv bootslot <slot>` and takes the FIRST following assignment', () => {
    // The awk this replaces never unlatches, so slot B's block must come after
    // slot A's for slot A's answer to be slot A's. Transcribed rather than
    // tidied: a scan that read a different line would agree with the shell on
    // today's file and disagree on the next one.
    const script = [
      'setenv bootpart 1',           // before any bootslot: not seen
      'setenv bootslot A',
      'setenv bootpart 4',           // slot A's
      'setenv bootpart 44',          // later, ignored: first wins
      'setenv bootslot B',
      'setenv bootpart 5',
    ].join('\n')
    expect(bootCmdSetting(script, 'A', 'bootpart')).toBe('4')
    expect(bootCmdSetting(script, 'B', 'bootpart')).toBe('5')
    expect(bootCmdSetting(script, 'C', 'bootpart')).toBeUndefined()
  })

  test('leading whitespace is not significant, as in awk', () => {
    expect(bootCmdSetting('   setenv bootslot A\n\t setenv bootpart 4\n', 'A', 'bootpart')).toBe('4')
  })
})

// --- the per-slot verity env -------------------------------------------------

const GUID_A = g.requirePartition('ROOTFS_A').require('GUID')
const HASH = '776ffaf3c23c995829e39e443ef46e0b2ea5dd40d8a0ba9aa8849dfb9335f49f'

/** A cmdline in the shape os/rootfs/build-v2.sh emits, at whatever case is asked for. */
function cmdline(guid: string, hash: string): string {
  return `dm-mod.create="rootfs,,,ro,0 190064 verity 1 PARTUUID=${guid} PARTUUID=${guid} 4096 4096 `
    + `23758 23758 sha256 ${hash} ${g.veritySalt}" dm-mod.waitfor=PARTUUID=${guid} root=/dev/dm-0 `
    + `rootfstype=squashfs ro rootwait console=ttyFIQ0,1500000\n`
}

const base = {
  cmdlinePath: '<cmdline>',
  slot: 'A',
  rootfsGuid: GUID_A,
  rootHash: HASH,
  producer: 'os/rootfs/build-v2.sh',
}

describe('the per-slot verity env, lifted out of the cmdline rather than re-derived', () => {
  test('the real shape produces the file the slot carries', () => {
    const v = verityEnvFor({ ...base, cmdline: cmdline(GUID_A.toLowerCase(), HASH) })
    expect(v.text).toStartWith('verity_args=dm-mod.create="rootfs,,,ro,0 190064 verity 1 PARTUUID=')
    expect(v.text).toEndWith(` dm-mod.waitfor=PARTUUID=${GUID_A.toLowerCase()}\n`)
    expect(v.text.split('\n').length).toBe(2)
  })

  test('THE CASE RULE: a lowercase cmdline against an uppercase layout is accepted', () => {
    // udev and libblkid spell by-partuuid names lowercase, which is what the
    // real producer emits; board.env spells them uppercase, which is what sgdisk
    // emits. A literal comparison between the two once refused a correct build.
    expect(() => verityEnvFor({ ...base, cmdline: cmdline(GUID_A.toLowerCase(), HASH) })).not.toThrow()
    expect(() => verityEnvFor({ ...base, cmdline: cmdline(GUID_A.toUpperCase(), HASH) })).not.toThrow()
    expect(() => verityEnvFor({ ...base, cmdline: cmdline(GUID_A.toLowerCase(), HASH.toUpperCase()) }))
      .not.toThrow()
  })

  test('no dm-mod.create= at all', () => {
    expect(() => verityEnvFor({ ...base, cmdline: 'root=/dev/dm-0 ro rootwait\n' }))
      .toThrow(/carries no dm-mod\.create= verity table; fix os\/rootfs\/build-v2\.sh/)
  })

  test('no dm-mod.waitfor= -- required on kernel 6.1, not decorative', () => {
    // dm_init_init() runs at late_initcall and wait_for_device_probe() does not
    // cover eMMC card discovery, so the verity table would be built before the
    // partitions exist.
    const bad = cmdline(GUID_A.toLowerCase(), HASH).replace(/ dm-mod\.waitfor=\S+/, '')
    expect(() => verityEnvFor({ ...base, cmdline: bad }))
      .toThrow(/carries no dm-mod\.waitfor=; it is required on kernel 6\.1/)
  })

  test('the verity table points at the OTHER slot\'s rootfs', () => {
    // Slot B's cmdline built over rootfs-a: the shape that boots one slot's
    // kernel against the other slot's root.
    const guidB = g.requirePartition('ROOTFS_B').require('GUID')
    expect(() => verityEnvFor({
      ...base, slot: 'B', rootfsGuid: guidB, cmdline: cmdline(GUID_A.toLowerCase(), HASH),
    })).toThrow(/the slot-B verity table in <cmdline> does not reference PARTUUID/)
  })

  test('the waitfor names a different partition from the table', () => {
    const guidB = g.requirePartition('ROOTFS_B').require('GUID').toLowerCase()
    const bad = cmdline(GUID_A.toLowerCase(), HASH).replace(/dm-mod\.waitfor=PARTUUID=\S+/, `dm-mod.waitfor=PARTUUID=${guidB}`)
    expect(() => verityEnvFor({ ...base, cmdline: bad }))
      .toThrow(/dm-mod\.waitfor= in <cmdline> does not reference PARTUUID .*; the wait must name the same partition/)
  })

  test('the table carries a root hash that is not the one the producer reported', () => {
    // The hash in rootfs-verity.env and the hash in the cmdline are two
    // statements about the same tree; a slot built from a table that disagrees
    // fails verity at boot, after the handshake has already committed.
    const other = HASH.replace(/^7/, '8')
    expect(() => verityEnvFor({ ...base, cmdline: cmdline(GUID_A.toLowerCase(), other) }))
      .toThrow(new RegExp(`does not carry the root hash ${HASH}`))
  })

  test('every refusal names the producer to fix', () => {
    for (const bad of [
      'root=/dev/dm-0\n',
      cmdline(GUID_A.toLowerCase(), HASH).replace(/ dm-mod\.waitfor=\S+/, ''),
      cmdline(GUID_A.toLowerCase(), HASH.replace(/^7/, '8')),
    ]) {
      expect(() => verityEnvFor({ ...base, cmdline: bad })).toThrow(/os\/rootfs\/build-v2\.sh/)
    }
  })

  test('the LAST match on a line wins, as sed\'s greedy leading wildcard does', () => {
    // A cmdline carrying two tables is not a shape the producer emits, and it is
    // exactly the shape where "whatever the first regex match happens to be" is
    // not an answer. Kept identical to the shell so the two cannot diverge here.
    const guidB = g.requirePartition('ROOTFS_B').require('GUID').toLowerCase()
    const two = `dm-mod.create="first ${guidB}" dm-mod.create="second PARTUUID=${GUID_A.toLowerCase()} ${HASH}" `
      + `dm-mod.waitfor=PARTUUID=${GUID_A.toLowerCase()}\n`
    expect(verityEnvFor({ ...base, cmdline: two }).create).toContain('second')
  })
})
