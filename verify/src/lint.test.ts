// Prove the board-definition schema lint rejects a broken board definition.
//
// A linter that has only ever been observed passing is not evidence: a lint
// whose counters live in a subshell reports "RESULT: PASS (0/0 checks)" after
// printing FAIL lines, and a forbidden-key check can be defeated by writing the
// forbidden key as empty.
//
// Each case mutates a COPY of a real layout in one specific way and asserts
// that the lint (a) fails and (b) says something that names the actual problem.
// The second half matters: a verdict alone would be satisfied by a lint that
// rejects everything, and the message is what an engineer reads.
//
// The copy is deliberately not called board.env: a rejection message should say
// "candidate", not name a real board it is not.
//
// The cases marked `shellPassed` are the four holes the `${NAME:-}` idiom
// leaves -- it cannot tell declared empty from not declared -- and they are why
// this lint is stricter than the shell predecessor rather than a translation of
// it. See the header of lint.ts.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isKnownRole, KNOWN_ROLES } from './board.ts'
import {
  formatRun,
  lintFile,
  lintPaths,
  RECOVERY_ACTION_KEYS,
  RECOVERY_TIERS,
  REQUIRED_BOARD_KEYS,
  requireAssertions,
  ROLE_SCHEMA,
  shippedBoardPaths,
} from './lint.ts'
import { boardEnvPath, requireShippedBoards } from './paths.ts'

/** Write a mutated copy of a real board definition and hand its path to `fn`. */
function withMutatedBoard<T>(board: string, edit: (text: string) => string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mos-lint-'))
  try {
    const p = join(dir, 'candidate.env')
    writeFileSync(p, edit(readFileSync(boardEnvPath(board), 'utf8')))
    return fn(p)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Replace the whole of the line that declares `key`. */
function setKey(key: string, spelling: string) {
  return (text: string): string =>
    text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${spelling}`)
}

/** Delete the line that declares `key`. */
function dropKey(key: string) {
  return (text: string): string =>
    text.replace(new RegExp(`^${key}=.*\n`, 'm'), '')
}

/** Append a declaration the board did not have. */
function addLine(line: string) {
  return (text: string): string => `${text}\n${line}\n`
}

interface RejectCase {
  readonly name: string
  readonly board: string
  readonly edit: (text: string) => string
  /** A substring the rejection must contain: the message has to name the fault. */
  readonly says: string
  /** A substring the rejection must NOT contain -- a message that misdirects. */
  readonly neverSays?: string
  /** Measured: the predecessor shell linter accepted this mutation on 2026-08-25. */
  readonly shellPassed?: true
  readonly why?: string
}

// --- the fourteen cases ported from the predecessor shell suite --------------

const PORTED: readonly RejectCase[] = [
  // The case this linter was written for. x64 carried BOOT_ATTEMPTS_DEFAULT=3
  // under a comment claiming grub's contract matches U-Boot's. It does not,
  // RAUC refuses the rendered configuration, and rauc.service exits 1.
  {
    name: 'boot-attempts-on-grub',
    board: 'x64',
    edit: addLine('BOOT_ATTEMPTS_DEFAULT=3'),
    says: 'RAUC refuses a grub configuration that sets boot attempts',
  },
  {
    name: 'grub-without-grubenv',
    board: 'x64',
    edit: dropKey('RAUC_GRUBENV'),
    says: 'no RAUC_GRUBENV',
  },
  {
    name: 'uboot-without-attempts',
    board: 'cx3576',
    edit: dropKey('BOOT_ATTEMPTS_DEFAULT'),
    says: 'no BOOT_ATTEMPTS_DEFAULT is declared',
  },
  {
    name: 'no-partition-set',
    board: 'x64',
    edit: dropKey('LAYOUT_PARTITIONS'),
    says: 'declares no LAYOUT_PARTITIONS',
  },
  {
    name: 'missing-role-key',
    board: 'x64',
    edit: dropKey('ESP_FAT_VOLUME_ID'),
    says: 'declares no ESP_FAT_VOLUME_ID',
  },
  {
    name: 'forbidden-role-key',
    board: 'x64',
    edit: addLine('ROOTFS_A_FS_UUID=00000000-0000-4000-8000-000000000000'),
    says: 'which that role cannot honour',
  },
  {
    name: 'unknown-role',
    board: 'x64',
    edit: setKey('STATE_ROLE', 'btrfs'),
    says: 'is not one of',
  },
  {
    name: 'missing-common-key',
    board: 'x64',
    edit: dropKey('META_GUID'),
    says: 'declares no META_GUID',
  },
  {
    name: 'partition-number-gap',
    board: 'x64',
    edit: setKey('DATA_PARTNUM', '10'),
    says: 'these numbers are absent',
  },
  {
    name: 'duplicate-partition-number',
    board: 'x64',
    edit: setKey('STATE_PARTNUM', '6'),
    says: 'is declared twice',
  },
  // One fact in three units. cx3576 spells a start as MiB, as a sector AND as
  // a byte offset, as three independent literals; three literals can drift
  // apart one edit at a time.
  {
    name: 'start-units-disagree',
    board: 'cx3576',
    edit: setKey('BOOT_A_START_SECTOR', '36865'),
    says: 'disagree',
  },
  {
    name: 'offset-units-disagree',
    board: 'cx3576',
    edit: setKey('BOOT_A_OFFSET_BYTES', '18874369'),
    says: 'disagree',
  },
  {
    name: 'no-arch',
    board: 'x64',
    edit: dropKey('MOS_ARCH'),
    says: 'declares no MOS_ARCH',
  },
  {
    name: 'bad-status-led',
    board: 'x64',
    edit: setKey('BOARD_HAS_STATUS_LED', 'no'),
    says: 'it must be 0 or 1',
  },
]

// the axis the shell pair never tested: declared empty
//
// `${NAME:-}` gives the same answer for a key that is absent and a key that is
// declared empty, so every check the shell built on it has a spelling that
// walks straight through. lint-test.sh's forbidden-role-key case only ever
// appended a NON-EMPTY value, so nothing was ever looking.

const EMPTY_DECLARATION: readonly RejectCase[] = [
  {
    name: 'forbidden-role-key-empty',
    board: 'x64',
    edit: addLine('ROOTFS_A_FS_UUID=""'),
    says: 'which that role cannot honour',
    shellPassed: true,
    why: 'the same forbidden key on the same forbidden role that the non-empty case rejects',
  },
  {
    name: 'boot-attempts-on-grub-empty',
    board: 'x64',
    edit: addLine('BOOT_ATTEMPTS_DEFAULT=""'),
    says: 'RAUC refuses a grub configuration that sets boot attempts',
    shellPassed: true,
    why: 'the check this linter was written for, defeated by blanking the value',
  },
  {
    name: 'partition-set-whitespace',
    board: 'x64',
    edit: setKey('LAYOUT_PARTITIONS', '" "'),
    says: 'with no partition names in it',
    shellPassed: true,
    why: 'the shell found the string non-empty, iterated nothing, and reported "0 partitions, numbered 1..0"',
  },
  {
    name: 'partition-set-empty',
    board: 'x64',
    edit: setKey('LAYOUT_PARTITIONS', '""'),
    says: 'declares LAYOUT_PARTITIONS as empty',
    neverSays: 'declares no LAYOUT_PARTITIONS',
  },
  {
    name: 'missing-role-key-empty',
    board: 'x64',
    edit: setKey('ESP_FAT_VOLUME_ID', '""'),
    says: 'declares ESP_FAT_VOLUME_ID as empty',
    neverSays: 'declares no ESP_FAT_VOLUME_ID',
  },
  {
    name: 'missing-common-key-empty',
    board: 'x64',
    edit: setKey('META_GUID', '""'),
    says: 'declares META_GUID as empty',
    neverSays: 'declares no META_GUID',
  },
  {
    name: 'role-empty',
    board: 'x64',
    edit: setKey('STATE_ROLE', '""'),
    says: 'declares STATE_ROLE as empty',
    neverSays: 'declares no STATE_ROLE',
  },
  {
    name: 'no-arch-empty',
    board: 'x64',
    edit: setKey('MOS_ARCH', '""'),
    says: 'declares MOS_ARCH as empty',
    neverSays: 'declares no MOS_ARCH',
  },
  {
    name: 'bootloader-empty',
    board: 'x64',
    edit: setKey('RAUC_BOOTLOADER', '""'),
    says: 'declares RAUC_BOOTLOADER as empty',
    neverSays: 'declares no RAUC_BOOTLOADER',
  },
  {
    name: 'grubenv-empty',
    board: 'x64',
    edit: setKey('RAUC_GRUBENV', '""'),
    says: 'declares RAUC_GRUBENV as empty',
    neverSays: 'no RAUC_GRUBENV;',
  },
  {
    name: 'uboot-attempts-empty',
    board: 'cx3576',
    edit: setKey('BOOT_ATTEMPTS_DEFAULT', '""'),
    says: 'declares BOOT_ATTEMPTS_DEFAULT as empty',
    neverSays: 'no BOOT_ATTEMPTS_DEFAULT is declared',
  },
]

// --- what the shell could not see at all, because it ran the file ------------

const NOT_DATA: readonly RejectCase[] = [
  {
    name: 'command-substitution',
    board: 'x64',
    edit: setKey('MOS_ARCH', '$(uname -m)'),
    says: 'command substitution',
    shellPassed: true,
    why: 'the shell RAN it; on this host `uname -m` returned a non-empty string and the key looked declared',
  },
  {
    name: 'unset-reference',
    board: 'x64',
    edit: setKey('MOS_ARCH', '"${NO_SUCH_KEY}"'),
    says: 'NO_SUCH_KEY',
    neverSays: 'made no assertions at all',
  },
  {
    name: 'non-numeric-partnum',
    board: 'x64',
    edit: setKey('STATE_PARTNUM', 'seven'),
    says: 'is read as a number',
  },
]

// --- the physical recovery actions a board declares --------------------------
//
// docs/design/recovery.md §4: a physical action is a BOARD fact, and the
// system layer maps an intent through this declaration and nothing else. Both
// shipped boards declare NONE, so every case below is a MUTATION that gives a
// board an action -- there is no shipped non-empty declaration to break, and a
// schema nothing is ever held to is a schema that stops being true quietly.
//
// The runtime reader (`mosd_settings`'s `Declaration`) refuses the same set at
// boot. These cases are why a board cannot ship a declaration the device would
// then fail closed on with the image already built.

/** Give a board one declared action, then mutate one of its keys. */
function declaringOneAction(edit: (text: string) => string = t => t) {
  return (text: string): string => edit(
    setKey('BOARD_RECOVERY_ACTIONS', '"BOOT_MENU"')(text)
    + '\nRECOVERY_BOOT_MENU_INTENT=recovery'
    + '\nRECOVERY_BOOT_MENU_MECHANISM=boot-menu'
    + '\nRECOVERY_BOOT_MENU_CHANNEL=/dev/tty0'
    + '\nRECOVERY_BOOT_MENU_TIER=none\n',
  )
}

const RECOVERY: readonly RejectCase[] = [
  {
    name: 'no-recovery-declaration',
    board: 'x64',
    edit: dropKey('BOARD_RECOVERY_ACTIONS'),
    says: 'declares no BOARD_RECOVERY_ACTIONS',
    why: 'silence is not the same claim as "this board has no physical recovery action"',
  },
  {
    name: 'recovery-action-name-is-not-a-name',
    board: 'x64',
    edit: setKey('BOARD_RECOVERY_ACTIONS', '"boot menu"'),
    says: 'cannot be an action name',
  },
  {
    name: 'recovery-action-missing-key',
    board: 'x64',
    edit: declaringOneAction(dropKey('RECOVERY_BOOT_MENU_CHANNEL')),
    says: 'declares no RECOVERY_BOOT_MENU_CHANNEL',
  },
  {
    name: 'recovery-action-key-empty',
    board: 'x64',
    edit: declaringOneAction(setKey('RECOVERY_BOOT_MENU_MECHANISM', '""')),
    says: 'declares RECOVERY_BOOT_MENU_MECHANISM as empty',
    neverSays: 'declares no RECOVERY_BOOT_MENU_MECHANISM',
  },
  {
    name: 'recovery-intent-is-not-a-cmdline-token',
    board: 'x64',
    edit: declaringOneAction(setKey('RECOVERY_BOOT_MENU_INTENT', 'Recover_Now')),
    says: 'is not a kernel command-line token',
  },
  {
    name: 'recovery-mechanism-is-not-a-mechanism',
    board: 'x64',
    edit: declaringOneAction(setKey('RECOVERY_BOOT_MENU_MECHANISM', 'BOOT_MENU')),
    says: 'is not a mechanism name',
  },
  {
    name: 'recovery-channel-is-not-a-device',
    board: 'x64',
    edit: declaringOneAction(setKey('RECOVERY_BOOT_MENU_CHANNEL', '/var/lib/mos/console')),
    says: 'a channel is a device under /dev',
    why: 'the shipped publisher refuses a regular file, so this board would ship an action that always aborts',
  },
  {
    name: 'recovery-tier-is-not-a-tier',
    board: 'x64',
    edit: declaringOneAction(setKey('RECOVERY_BOOT_MENU_TIER', 'secure-wipe')),
    says: 'There is no fourth reset tier',
  },
  {
    name: 'two-actions-share-an-intent',
    board: 'x64',
    edit: text => declaringOneAction()(text)
      .replace('BOARD_RECOVERY_ACTIONS="BOOT_MENU"', 'BOARD_RECOVERY_ACTIONS="BOOT_MENU BUTTON"')
      + 'RECOVERY_BUTTON_INTENT=recovery\nRECOVERY_BUTTON_MECHANISM=button\n'
      + 'RECOVERY_BUTTON_CHANNEL=/dev/tty0\nRECOVERY_BUTTON_TIER=none\n',
    says: "both declare the intent 'recovery'",
  },
  {
    name: 'two-actions-share-a-mechanism',
    board: 'x64',
    edit: text => declaringOneAction()(text)
      .replace('BOARD_RECOVERY_ACTIONS="BOOT_MENU"', 'BOARD_RECOVERY_ACTIONS="BOOT_MENU BUTTON"')
      + 'RECOVERY_BUTTON_INTENT=factory\nRECOVERY_BUTTON_MECHANISM=boot-menu\n'
      + 'RECOVERY_BUTTON_CHANNEL=/dev/tty0\nRECOVERY_BUTTON_TIER=none\n',
    says: "both declare the mechanism 'boot-menu'",
  },
]

const CASES: readonly RejectCase[] = [...PORTED, ...EMPTY_DECLARATION, ...NOT_DATA, ...RECOVERY]

function messagesFor(c: RejectCase): string[] {
  return withMutatedBoard(c.board, c.edit, (p) => {
    const run = lintPaths([p])
    expect(run.ok, `${c.name}: the lint ACCEPTED a layout it must reject`).toBe(false)
    return run.checks.filter(k => !k.ok).map(k => k.message)
  })
}

describe('the fourteen cases ported from lint-test.sh', () => {
  for (const c of PORTED) {
    test(`${c.name}: rejected, and the message names it`, () => {
      const said = messagesFor(c)
      expect(said.join('\n')).toContain(c.says)
    })
  }
})

describe('declared empty is not absent — the axis the shell pair never tested', () => {
  for (const c of EMPTY_DECLARATION) {
    test(`${c.name}: rejected, and the message names it`, () => {
      const said = messagesFor(c)
      expect(said.join('\n')).toContain(c.says)
      if (c.neverSays !== undefined) {
        // The correction, not decoration: "declares no ESP_FAT_VOLUME_ID"
        // about a file containing `ESP_FAT_VOLUME_ID=""` sends a reader looking
        // for a line that is already there.
        expect(said.join('\n')).not.toContain(c.neverSays)
      }
    })
  }
})

describe('a board definition that is not data', () => {
  for (const c of NOT_DATA) {
    test(`${c.name}: rejected, and the message names it`, () => {
      const said = messagesFor(c)
      expect(said.join('\n')).toContain(c.says)
      if (c.neverSays !== undefined) expect(said.join('\n')).not.toContain(c.neverSays)
    })
  }
})

// --- the other direction, without which a lint that rejects everything passes -

describe('the shipped layouts', () => {
  for (const board of requireShippedBoards()) {
    test(`accepts-${board}: the shipped layout passes`, () => {
      const one = lintFile(boardEnvPath(board))
      const failures = one.checks.filter(c => !c.ok).map(c => c.message)
      expect(failures).toEqual([])
      expect(one.checks.length).toBeGreaterThan(0)
      expect(one.board).toBe(board)
    })
  }

  test('both together, through the run the Makefile target uses', () => {
    const run = lintPaths(shippedBoardPaths())
    expect(run.ok).toBe(true)
    expect(run.failed).toBe(0)
    // EVERY board contributed. A run whose second file died mid-parse would
    // still report PASS on a total that is merely non-zero -- which is exactly
    // what the shell predecessor did when x64 referenced a renamed key. Named
    // rather than counted, because a count of the wrong boards is still the
    // right count.
    expect(run.boards.map(b => b.board)).toEqual(['cx3576', 's905x5m', 'virt-arm64', 'x64'])
    for (const b of run.boards) expect(b.checks.length).toBeGreaterThan(0)
    expect(run.passed).toBe(run.checks.length)
  })

  // The positive control for the whole strictness axis. x64 declares three
  // lists EMPTY on purpose -- a QEMU machine has no radio firmware, no MAC to
  // burn and no radios -- and the emptiness IS the statement. A port that
  // closed the empty-declaration hole by failing every empty declaration would
  // reject the board it is supposed to accept.
  test('an empty declaration the schema does not forbid is a statement, not a fault', () => {
    const x64 = lintFile(boardEnvPath('x64'))
    expect(x64.checks.filter(c => !c.ok)).toEqual([])
    const text = readFileSync(boardEnvPath('x64'), 'utf8')
    for (const key of ['BOARD_FIRMWARE_FILES', 'BOARD_HWINIT_CONFS', 'BOARD_RADIOS']) {
      expect(text).toContain(`${key}=""`)
    }
  })
})

// --- the guards the shell pair carried, which do not survive by themselves ---

describe('the run itself', () => {
  // "12 passed" and "9 passed, 3 never ran" are the same number to a reader,
  // and a suite cut short does not fail loudly -- it tests fewer cases and
  // reports green on the ones it reached. lint-test.sh declared its case set by
  // identity and diffed it against what ran; this is that guard.
  test('the cases that ran are exactly the cases declared', () => {
    expect([...CASES].map(c => c.name).sort()).toEqual([
      'bad-status-led',
      'boot-attempts-on-grub',
      'boot-attempts-on-grub-empty',
      'bootloader-empty',
      'command-substitution',
      'duplicate-partition-number',
      'forbidden-role-key',
      'forbidden-role-key-empty',
      'grub-without-grubenv',
      'grubenv-empty',
      'missing-common-key',
      'missing-common-key-empty',
      'missing-role-key',
      'missing-role-key-empty',
      'no-arch',
      'no-arch-empty',
      'no-partition-set',
      'no-recovery-declaration',
      'non-numeric-partnum',
      'offset-units-disagree',
      'partition-number-gap',
      'partition-set-empty',
      'partition-set-whitespace',
      'recovery-action-key-empty',
      'recovery-action-missing-key',
      'recovery-action-name-is-not-a-name',
      'recovery-channel-is-not-a-device',
      'recovery-intent-is-not-a-cmdline-token',
      'recovery-mechanism-is-not-a-mechanism',
      'recovery-tier-is-not-a-tier',
      'role-empty',
      'start-units-disagree',
      'two-actions-share-a-mechanism',
      'two-actions-share-an-intent',
      'uboot-attempts-empty',
      'uboot-without-attempts',
      'unknown-role',
      'unset-reference',
    ])
    expect(new Set(CASES.map(c => c.name)).size).toBe(CASES.length)
    // Every case ported from the shell pair is still here, by name.
    expect(PORTED.length).toBe(14)
  })

  // The four holes, recorded by identity so that removing the strictness that
  // closes one would have to remove the record of it too.
  test('four cases in this suite were measured passing the shell predecessor', () => {
    expect(CASES.filter(c => c.shellPassed === true).map(c => c.name).sort()).toEqual([
      'boot-attempts-on-grub-empty',
      'command-substitution',
      'forbidden-role-key-empty',
      'partition-set-whitespace',
    ])
    for (const c of CASES) {
      if (c.shellPassed === true) expect(typeof c.why).toBe('string')
    }
  })

  // A file that contributed no assertions is a failure, not a quiet success.
  // The shell predecessor learned this when `set -u` killed the subshell
  // sourcing x64 at line 1: the board contributed ZERO checks and the run
  // reported "RESULT: PASS (1/1 checks)" from cx3576 alone.
  //
  // requireAssertions is called with a hand-made zero-check result rather than
  // reached through a file, because NO file can reach it -- see its comment.
  // Testing it through lintPaths left the branch uncovered: a mutation that
  // deleted it entirely kept the suite green, which is how this test came to
  // exist in this shape.
  test('a file that asserts nothing is a failure', () => {
    const nothing = requireAssertions({
      path: '/nowhere/candidate.env',
      board: 'candidate.env',
      checks: [],
      unreadable: false,
    })
    expect(nothing.checks.length).toBe(1)
    expect(nothing.checks[0]?.ok).toBe(false)
    expect(nothing.checks[0]?.message).toContain('made no assertions at all')
    // And it leaves a file that DID assert something alone.
    const real = lintFile(boardEnvPath('x64'))
    expect(requireAssertions(real)).toBe(real)
  })

  // The invariant that guard backstops: however broken a file is, it produces
  // at least one check. A run's per-file count is only evidence while this
  // holds, and the failure it protects against -- one board contributing
  // nothing while the total stayed non-zero -- is what the shell predecessor
  // shipped for as long as it existed.
  test('every file produces at least one check, however degenerate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mos-lint-'))
    try {
      const degenerate: Record<string, string> = {
        'empty.env': '',
        'comment.env': '# a comment, and no assignments at all\n',
        'one-key.env': 'LAYOUT_VERSION=2\n',
        'not-a-board.env': 'HELLO=world\n',
        'refused.env': 'MOS_ARCH=$(uname -m)\n',
      }
      for (const [name, text] of Object.entries(degenerate)) {
        const p = join(dir, name)
        writeFileSync(p, text)
        const one = lintFile(p)
        expect(one.checks.length, `${name} produced no checks at all`).toBeGreaterThan(0)
        expect(one.checks.some(c => !c.ok), `${name} produced no failure`).toBe(true)
      }
      // And through the run, beside a board that passes: the total is not zero,
      // so only the per-file view can see the broken one.
      const run = lintPaths([boardEnvPath('cx3576'), join(dir, 'comment.env')])
      expect(run.ok).toBe(false)
      expect(run.passed).toBeGreaterThan(0)
      expect(run.boards.find(b => b.board === 'comment.env')?.checks.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The process environment is not consulted, at any layer. A board that
  // declares no MOS_ARCH PASSED the shell predecessor when the caller exported
  // MOS_ARCH, because `source` reads the environment and `${MOS_ARCH:-}` cannot
  // tell where a value came from. Measured on 2026-08-25.
  test('an exported key does not rescue a board that does not declare it', () => {
    const previous = process.env['MOS_ARCH']
    process.env['MOS_ARCH'] = 'amd64'
    try {
      const said = messagesFor({
        name: 'no-arch-but-exported',
        board: 'x64',
        edit: dropKey('MOS_ARCH'),
        says: 'declares no MOS_ARCH',
      })
      expect(said.join('\n')).toContain('declares no MOS_ARCH')
    } finally {
      if (previous === undefined) delete process.env['MOS_ARCH']
      else process.env['MOS_ARCH'] = previous
    }
  })

  test('a file that is not there is an error, not an empty run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mos-lint-'))
    try {
      const run = lintPaths([join(dir, 'no-such-board.env')])
      expect(run.ok).toBe(false)
      expect(run.boards[0]?.unreadable).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the formatted run reads the way the shell predecessor did', () => {
    const good = formatRun(lintPaths(shippedBoardPaths()))
    expect(good.stderr).toEqual([])
    expect(good.stdout.at(-1)).toBe(`RESULT: PASS (${good.stdout.length - 1}/${good.stdout.length - 1} checks)`)
    expect(good.stdout[0]).toStartWith('PASS: cx3576: ')

    const bad = withMutatedBoard('x64', addLine('ROOTFS_A_FS_UUID=""'), p => formatRun(lintPaths([p])))
    expect(bad.stderr.at(-1)).toStartWith('RESULT: FAIL (')
    expect(bad.stderr.some(l => l.startsWith('FAIL: candidate.env: '))).toBe(true)
  })
})

// --- the schema tables, which are two lists that have to agree ---------------

describe('the role schema', () => {
  test('knows a key list for exactly the roles the model knows', () => {
    expect(Object.keys(ROLE_SCHEMA).sort()).toEqual([...KNOWN_ROLES].sort())
    for (const role of KNOWN_ROLES) expect(isKnownRole(role)).toBe(true)
  })

  // A key in both lists would be required and forbidden at once, and every
  // board carrying that role would fail whatever it did.
  test('no role requires a key it also forbids', () => {
    for (const [role, schema] of Object.entries(ROLE_SCHEMA)) {
      const both = schema.required.filter(k => schema.forbidden.includes(k))
      expect(both, `${role} both requires and forbids ${both.join(' ')}`).toEqual([])
    }
  })

  test('the board-level required keys are the four the shell pair checked, plus the release flag', () => {
    // BOARD_RELEASE_TARGET is the one this pair did not have. It was added
    // when a board arrived that has NO release path (virt-arm64): before it,
    // whether a board was releasable was a fact only prose carried, and the
    // release gate would assemble for any board with a board.env.
    expect([...REQUIRED_BOARD_KEYS]).toEqual([
      'BOARD_CMDLINE_ARGS', 'BOARD_SIZE_BUDGET_MB', 'BOARD_HAS_STATUS_LED',
      'BOARD_RELEASE_TARGET', 'MOS_ARCH',
    ])
  })
})

// --- the recovery declaration, on the boards that actually ship --------------

describe('the physical recovery declaration', () => {
  // The honest state, asserted rather than assumed: neither board has an
  // implemented physical action, so neither declares one, and the flows refuse
  // on both. A board that quietly grew one would change what a fielded device
  // can be made to do from the outside, and this is where that shows up.
  test('both shipped boards declare the key, and declare it empty', () => {
    for (const board of requireShippedBoards()) {
      const run = lintPaths([boardEnvPath(board)])
      expect(run.ok, `${board} does not lint`).toBe(true)
      expect(
        run.checks.some(c => c.ok && c.message.includes('no physical recovery action')),
        `${board} must declare BOARD_RECOVERY_ACTIONS empty`,
      ).toBe(true)
    }
  })

  test('an action carries four keys, and the tiers are the three that exist plus none', () => {
    expect([...RECOVERY_ACTION_KEYS]).toEqual(['INTENT', 'MECHANISM', 'CHANNEL', 'TIER'])
    expect([...RECOVERY_TIERS]).toEqual(['none', 'configuration', 'application-data', 'full-factory'])
  })

  // A board that declares a well-formed action PASSES. Without this the
  // rejection cases above would be satisfied by a lint that refuses every
  // non-empty declaration, which would make the schema unimplementable.
  test('a well-formed declaration is accepted and says what it accepted', () => {
    const run = withMutatedBoard('x64', declaringOneAction(), p => lintPaths([p]))
    expect(run.ok, run.checks.filter(c => !c.ok).map(c => c.message).join('\n')).toBe(true)
    expect(
      run.checks.some(c => c.ok && c.message.includes('declares 1 physical recovery action')),
    ).toBe(true)
  })
})
