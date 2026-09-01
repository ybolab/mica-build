// The ten small root-side families, driven from the failing side.
//
// Green first, one edit, red, and the message
// names the thing. The edits are the shapes these failures took:
//
//   - a host-architecture binary staged into a device image. Every other check
//     passes; the device panics at exec.
//   - fw_setenv shipped as a regular file on bookworm and as a symlink on
//     trixie. Asserting either spelling alone fails a correct image, which is
//     why the check has two PASS sentences.
//   - MOS_PROFILE=DEV. mosd's match is case-sensitive and it FAILS CLOSED, so
//     the image self-provisions to prod and disables its own sshd with every
//     other check still green.
//   - ssh.service losing ExecReload=. The reconciler's reload then fails and the
//     rendered sshd configuration silently never applies to the running listener.
//   - a libcrypt that does not implement the format mosd writes. pam_unix
//     rejects every password while the shadow file, the reconciler and every
//     other check look healthy.
//
// And ONE DEFECT IN THE CODE UNDER TEST, asserted rather than repaired: the
// two-line "0\n0" device-line count. See `checks-system.ts`'s header.

import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { boardsWhere, isUBoot, SHIPPED } from './board-scope.ts'
import { healthyGpt, packedRootFixture, type RootFixture } from './checks-fixture.ts'
import {
  cryptPrefixes,
  devLineCount,
  readProfileContract,
  SYSTEM_CHECKS,
} from './checks-system.ts'
import { extractCommands, resolvesInRoot } from './script-commands.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

/** The same slot size the GPT suite uses; the linux-generic COUNT does not depend on it. */
const SLOT = 524288

const FW_ENV = '/etc/fw_env.config'
const SSHD_DROPIN = '/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf'
const ETC_SSH_MOUNT = '/etc/systemd/system/etc-ssh.mount'
const PROFILE = '/usr/lib/mos/profile.conf'
const SSH_UNIT = '/usr/lib/systemd/system/ssh.service'
const MOS_HEALTH = '/usr/lib/mos/mos-health'

function checkNamed(id: string): CheckCase {
  const found = SYSTEM_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no system check is registered as '${id}'. Registered: `
      + SYSTEM_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

/** The packed-root fixture, plus the board's own healthy GPT for the repart count. */
function withGpt(fx: RootFixture, board: Board): ImageContext {
  const table = healthyGpt(board, SLOT)
  return { ...fx.ctx, gpt: async () => table }
}

async function only(fx: RootFixture, id: string, board: Board = cx3576): Promise<CheckResult> {
  const got = await checkNamed(id).run(withGpt(fx, board))
  expect(got.length).toBe(1)
  return got[0] as CheckResult
}

async function verdictOf(fx: RootFixture, id: string, board: Board = cx3576): Promise<Verdict> {
  return (await only(fx, id, board)).verdict
}

async function messageOf(fx: RootFixture, id: string, board: Board = cx3576): Promise<string> {
  return (await only(fx, id, board)).message
}

async function mutated(id: string, mutate: (root: string) => void, board: Board = cx3576): Promise<RootFixture> {
  const fx = packedRootFixture(board)
  expect(await verdictOf(fx, id, board)).toBe('pass')
  mutate(fx.root)
  return fx
}

function rewrite(root: string, path: string, edit: (text: string) => string): void {
  writeFileSync(join(root, path), edit(readFileSync(join(root, path), 'utf8')))
}

function write(root: string, path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}

describe('the healthy image', () => {
  test('every applicable check concludes on both boards, and only the bootloader pair skips', async () => {
    for (const board of [cx3576, x64]) {
      const fx = packedRootFixture(board)
      try {
        for (const c of SYSTEM_CHECKS) {
          if (c.boards !== undefined && !c.boards.includes(board.name)) continue
          const got = await c.run(withGpt(fx, board))
          const want = c.id.endsWith('-skipped') ? 'skip' : 'pass'
          expect(`${board.name}/${c.id}: ${got.map(r => r.verdict).join(',')}`)
            .toBe(`${board.name}/${c.id}: ${want}`)
        }
      }
      finally {
        fx.dispose()
      }
    }
  })

  test('the bootloader scopes are derived, and the U-Boot pair are complements', () => {
    const uboot = boardsWhere(isUBoot)
    const notUboot = boardsWhere(b => !isUBoot(b))
    for (const id of ['bootenv-fw-printenv', 'bootenv-fw-setenv', 'bootenv-fw-env-config',
      'bootenv-fw-env-two-lines', 'bootenv-fw-env-addresses']) {
      expect(`${id}: ${[...(checkNamed(id).boards ?? [])].sort()}`).toBe(`${id}: ${[...uboot].sort()}`)
    }
    for (const id of ['bootenv-fw-tools-skipped', 'bootenv-fw-env-skipped']) {
      expect(`${id}: ${[...(checkNamed(id).boards ?? [])].sort()}`).toBe(`${id}: ${[...notUboot].sort()}`)
    }
    expect([...uboot, ...notUboot].sort()).toEqual(SHIPPED.map(b => b.name).sort())
  })

  test('the ELF entries are generated PER BOARD from that board\'s own MOS_ARCH', () => {
    // `<path> is a ` alone claims `<path> is a regular file`, which batch 2a
    // owns, and it cannot be lengthened without naming an architecture. Naming
    // it per board is not writing it down -- `board.arch` IS the declaration.
    for (const board of SHIPPED) {
      for (const p of ['/usr/bin/mosd', '/usr/bin/apid']) {
        const c = checkNamed(`elf-arch-${board.name}${p}`)
        expect(c.boards).toEqual([board.name])
        expect(c.shell.pass).toBe(`${p} is a ${board.arch} ELF`)
      }
    }
  })
})

describe('systemd-networkd is enabled', () => {
  test('with neither the wants entry nor the alias it fails', async () => {
    const fx = await mutated('networkd-enabled',
      root => rmSync(join(root, '/etc/systemd/system/multi-user.target.wants/systemd-networkd.service')))
    try {
      expect(await verdictOf(fx, 'networkd-enabled')).toBe('fail')
      expect(await messageOf(fx, 'networkd-enabled')).toBe('systemd-networkd enablement symlink missing')
    }
    finally {
      fx.dispose()
    }
  })

  test('the dbus ALIAS alone is enough -- it enables the unit with no wants entry', async () => {
    // Debian's networkd ships this alias, and a unit enabled only through it has
    // no *.wants entry anywhere. A check that looked only for the symlink would
    // fail a correctly enabled image.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, '/etc/systemd/system/multi-user.target.wants/systemd-networkd.service'))
      expect(await verdictOf(fx, 'networkd-enabled')).toBe('fail')
      write(fx.root, '/usr/lib/systemd/system/systemd-networkd.service', '[Unit]\n')
      symlinkSync('../../../usr/lib/systemd/system/systemd-networkd.service',
        join(fx.root, '/etc/systemd/system/dbus-org.freedesktop.network1.service'))
      expect(await verdictOf(fx, 'networkd-enabled')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('a DANGLING alias reads as ABSENT, because `[ -e ]` follows the link', async () => {
    // Reproduced, not tightened. `-e` resolves the target, and inside the
    // oracle's container an ABSOLUTE target resolves against the container's
    // root rather than against ${ROOT} -- so an alias pointing at a unit the
    // image does not ship is absent to the oracle, and is absent here too.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, '/etc/systemd/system/multi-user.target.wants/systemd-networkd.service'))
      symlinkSync('/usr/lib/systemd/system/definitely-not-a-unit.service',
        join(fx.root, '/etc/systemd/system/dbus-org.freedesktop.network1.service'))
      expect(await verdictOf(fx, 'networkd-enabled')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the daemons are this board\'s architecture', () => {
  test('the OTHER board\'s e_machine fails, and the header is printed', async () => {
    // The failure that costs a device its boot and is invisible everywhere else:
    // a host-arch artefact staged into the image passes every file check.
    const fx = await mutated('elf-arch-cx3576/usr/bin/mosd', (root) => {
      const body = readFileSync(join(root, '/usr/bin/mosd'))
      body.writeUInt16LE(0x3E, 18)
      writeFileSync(join(root, '/usr/bin/mosd'), body)
    })
    try {
      expect(await verdictOf(fx, 'elf-arch-cx3576/usr/bin/mosd')).toBe('fail')
      expect(await messageOf(fx, 'elf-arch-cx3576/usr/bin/mosd'))
        .toContain("/usr/bin/mosd is not a arm64 ELF (header: '7f454c46")
    }
    finally {
      fx.dispose()
    }
  })

  test('a file that is not an ELF at all fails', async () => {
    const fx = await mutated('elf-arch-cx3576/usr/bin/apid',
      root => write(root, '/usr/bin/apid', '#!/bin/sh\necho hello\n'))
    try {
      expect(await verdictOf(fx, 'elf-arch-cx3576/usr/bin/apid')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the x64 fixture carries amd64 headers, so its own entries pass', async () => {
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx, 'elf-arch-x64/usr/bin/mosd', x64)).toBe('pass')
      expect(await messageOf(fx, 'elf-arch-x64/usr/bin/mosd', x64)).toBe('/usr/bin/mosd is a amd64 ELF')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the bootloader environment tools', () => {
  test('fw_printenv missing fails', async () => {
    const fx = await mutated('bootenv-fw-printenv', root => rmSync(join(root, '/usr/bin/fw_printenv')))
    try {
      expect(await verdictOf(fx, 'bootenv-fw-printenv')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('fw_setenv as a REGULAR file passes with the other sentence', async () => {
    // Bookworm shipped two regular files; trixie ships one multi-call binary and
    // a symlink. Asserting either spelling alone fails a correct image.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await messageOf(fx, 'bootenv-fw-setenv'))
        .toBe('/usr/bin/fw_setenv resolves to a regular file (symlink -> fw_printenv)')
      rmSync(join(fx.root, '/usr/bin/fw_setenv'))
      write(fx.root, '/usr/bin/fw_setenv', 'x\n')
      expect(await messageOf(fx, 'bootenv-fw-setenv')).toBe('/usr/bin/fw_setenv is a regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('a DANGLING fw_setenv fails: the assertion is that the path RESOLVES', async () => {
    const fx = await mutated('bootenv-fw-setenv', (root) => {
      rmSync(join(root, '/usr/bin/fw_setenv'))
      symlinkSync('fw_printenv-gone', join(root, '/usr/bin/fw_setenv'))
    })
    try {
      expect(await verdictOf(fx, 'bootenv-fw-setenv')).toBe('fail')
      expect(await messageOf(fx, 'bootenv-fw-setenv'))
        .toContain('RAUC writes the boot slot through it and the A/B handover fails on the device')
    }
    finally {
      fx.dispose()
    }
  })

  test('one device line fails, and the count is named', async () => {
    const fx = await mutated('bootenv-fw-env-two-lines',
      root => rewrite(root, FW_ENV, t => t.split('\n')[0] as string))
    try {
      expect(await verdictOf(fx, 'bootenv-fw-env-two-lines')).toBe('fail')
      expect(await messageOf(fx, 'bootenv-fw-env-two-lines'))
        .toContain('has 1 device lines, expected 2; with only one side configured')
    }
    finally {
      fx.dispose()
    }
  })

  test('A DEFECT IN THE CODE UNDER TEST: a file with no /dev/ line counts "0\\n0"', async () => {
    // `grep -cE '^/dev/' FILE 2>/dev/null || echo 0` -- grep prints `0` AND
    // exits 1, so the `|| echo 0` fires too and the count becomes a TWO-LINE
    // string, which the oracle then interpolates into a conclusion. The second
    // half of that message is a stdout line with no PASS/FAIL/SKIP prefix, and
    // `parseShellRun`'s self-consistency guard would refuse the whole run.
    //
    // Reproduced, not repaired. Neither shipped image reaches it -- both have
    // two device lines -- and a port that emitted `0` would agree with the
    // oracle everywhere except the one image where the difference is the point.
    // Reported for M4e.
    const fx = await mutated('bootenv-fw-env-two-lines',
      root => write(root, FW_ENV, '# no device lines at all\n'))
    try {
      expect(devLineCount(fx.root, FW_ENV)).toBe('0\n0')
      expect(await messageOf(fx, 'bootenv-fw-env-two-lines'))
        .toContain('/etc/fw_env.config has 0\n0 device lines, expected 2;')
    }
    finally {
      fx.dispose()
    }
  })

  test('...and a MISSING file counts a single "0", which is the other half of the same idiom', () => {
    // grep exits 2 and prints nothing, so only the `|| echo 0` runs. The two
    // cases differ, and only one of them is malformed.
    const fx = packedRootFixture(cx3576)
    try {
      expect(devLineCount(fx.root, '/etc/nothing-here')).toBe('0')
    }
    finally {
      fx.dispose()
    }
  })

  test('a wrong environment SIZE fails, naming the partition it could not find', async () => {
    const fx = await mutated('bootenv-fw-env-addresses',
      root => rewrite(root, FW_ENV, t => t.replaceAll('0x10000', '0x20000')))
    try {
      expect(await verdictOf(fx, 'bootenv-fw-env-addresses')).toBe('fail')
      expect(await messageOf(fx, 'bootenv-fw-env-addresses'))
        .toContain("/etc/fw_env.config has no '/dev/disk/by-partuuid/")
    }
    finally {
      fx.dispose()
    }
  })

  test('addressing ONE side twice fails: the redundancy would be a comment', async () => {
    const fx = await mutated('bootenv-fw-env-addresses', (root) => {
      const first = readFileSync(join(root, FW_ENV), 'utf8').split('\n')[0] as string
      write(root, FW_ENV, `${first}\n${first}\n`)
    })
    try {
      expect(await verdictOf(fx, 'bootenv-fw-env-addresses')).toBe('fail')
      const guidB = (cx3576.partition('UENV_B')?.guid ?? '').toLowerCase()
      expect(await messageOf(fx, 'bootenv-fw-env-addresses')).toContain(guidB)
    }
    finally {
      fx.dispose()
    }
  })

  test('on a grub board the two U-Boot groups SKIP, and name the bootloader', async () => {
    const fx = packedRootFixture(x64)
    try {
      const tools = await only(fx, 'bootenv-fw-tools-skipped', x64)
      const env = await only(fx, 'bootenv-fw-env-skipped', x64)
      expect(tools.verdict).toBe('skip')
      expect(env.verdict).toBe('skip')
      expect(tools.message).toContain('fw_printenv/fw_setenv (bootloader=grub)')
      expect(env.message).toContain('there is no U-Boot environment on this board')
    }
    finally {
      fx.dispose()
    }
  })

  test('grub-editenv missing fails BOTH grub conclusions', async () => {
    // Two conclusions about one file, and the second is not a duplicate: a
    // missing helper does not stop rauc.service -- the unit starts and then
    // cannot answer anything, which reads as a RAUC problem.
    const fx = packedRootFixture(x64)
    try {
      expect(await verdictOf(fx, 'bootenv-grub-editenv-regular', x64)).toBe('pass')
      rmSync(join(fx.root, '/usr/bin/grub-editenv'))
      expect(await verdictOf(fx, 'bootenv-grub-editenv-regular', x64)).toBe('fail')
      expect(await verdictOf(fx, 'bootenv-grub-editenv-present', x64)).toBe('fail')
      expect(await messageOf(fx, 'bootenv-grub-editenv-present', x64))
        .toContain('the A/B boot order can be neither read nor written')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the health gate\'s root-side pair', () => {
  test('a gate parsing the phantom variable fails, and the consequence is named', async () => {
    const fx = await mutated('health-gate-no-phantom-rauc-var',
      root => rewrite(root, MOS_HEALTH, t => `${t}slot="$(echo "$out" | grep RAUC_SYSTEM_BOOTED_SLOT)"\n`))
    try {
      expect(await verdictOf(fx, 'health-gate-no-phantom-rauc-var')).toBe('fail')
      expect(await messageOf(fx, 'health-gate-no-phantom-rauc-var'))
        .toContain('never reaches `rauc status mark-good`, so every update rolls back')
    }
    finally {
      fx.dispose()
    }
  })

  test('the gate absent fails on its own branch', async () => {
    const fx = await mutated('health-gate-no-phantom-rauc-var', root => rmSync(join(root, MOS_HEALTH)))
    try {
      expect(await messageOf(fx, 'health-gate-no-phantom-rauc-var'))
        .toBe('/usr/lib/mos/mos-health missing, so its RAUC status parsing cannot be checked')
    }
    finally {
      fx.dispose()
    }
  })

  test('no HTTP client fails: probe c degrades to a SKIP nobody sees', async () => {
    const fx = await mutated('health-gate-http-client', root => rmSync(join(root, '/usr/bin/curl')))
    try {
      expect(await verdictOf(fx, 'health-gate-http-client')).toBe('fail')
      expect(await messageOf(fx, 'health-gate-http-client'))
        .toContain('apid is never actually probed by the health gate')
    }
    finally {
      fx.dispose()
    }
  })

  test('wget alone is enough, and the message names WHICH client it found', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, '/usr/bin/curl'))
      write(fx.root, '/usr/bin/wget', 'x\n')
      const got = await only(fx, 'health-gate-http-client')
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('/usr/bin/wget is in the image')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the repart definitions', () => {
  test('one definition too few fails, and BOTH counts are printed', async () => {
    // repart pairs definitions with partitions by type UUID in DISK ORDER, so a
    // miscount silently attaches growth to the wrong partition.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'repart-definition-count')).toBe('pass')
      const first = readdirSync(join(fx.root, '/etc/repart.d'))
        .filter(f => f !== '80-data.conf').sort()[0] as string
      rmSync(join(fx.root, '/etc/repart.d', first))
      expect(await verdictOf(fx, 'repart-definition-count')).toBe('fail')
      expect(await messageOf(fx, 'repart-definition-count'))
        .toContain('definitions but the GPT carries')
    }
    finally {
      fx.dispose()
    }
  })

  test('the expected count comes from the IMAGE\'S GPT, not from the definitions', async () => {
    // The two sides are read independently; a check that resolved the count
    // through the definitions would hand itself the same number twice.
    const fx = packedRootFixture(cx3576)
    try {
      const table = healthyGpt(cx3576, SLOT)
      const generic = table.partitions
        .filter(p => p.typeGuid.toLowerCase() === '0fc63daf-8483-4772-8e79-3d69d8477de4').length
      expect(await messageOf(fx, 'repart-definition-count'))
        .toContain(`/etc/repart.d has exactly ${generic} definitions`)
    }
    finally {
      fx.dispose()
    }
  })

  test('a SECOND growing definition fails, and both are listed', async () => {
    const fx = await mutated('repart-one-growing-definition',
      root => rewrite(root, '/etc/repart.d/80-data.conf', t => t))
    try {
      const other = readdirSync(join(fx.root, '/etc/repart.d'))
        .filter(f => f !== '80-data.conf').sort()[0] as string
      rewrite(fx.root, `/etc/repart.d/${other}`, t => `${t}Weight=1000\n`)
      expect(await verdictOf(fx, 'repart-one-growing-definition')).toBe('fail')
      expect(await messageOf(fx, 'repart-one-growing-definition')).toContain('found 2:')
    }
    finally {
      fx.dispose()
    }
  })

  test('growth on the EPHEMERAL definition instead of DATA fails', async () => {
    const fx = await mutated('repart-one-growing-definition', (root) => {
      const other = readdirSync(join(root, '/etc/repart.d'))
        .filter(f => f !== '80-data.conf').sort()[0] as string
      rewrite(root, '/etc/repart.d/80-data.conf', t => t.replace('Weight=1000\n', ''))
      rewrite(root, `/etc/repart.d/${other}`, t => `${t}Weight=1000\n`)
    })
    try {
      expect(await verdictOf(fx, 'repart-one-growing-definition')).toBe('fail')
      expect(await messageOf(fx, 'repart-one-growing-definition'))
        .toContain('expected exactly one growing repart definition, 80-data.conf; found 1:')
    }
    finally {
      fx.dispose()
    }
  })

  test('a --discard=no drop-in fails, and the file is named', async () => {
    const fx = await mutated('repart-no-discard-override',
      root => write(root, '/etc/systemd/system/systemd-repart.service.d/10-nodiscard.conf',
        '[Service]\nExecStart=\nExecStart=/usr/lib/systemd/systemd-repart --discard=no\n'))
    try {
      expect(await verdictOf(fx, 'repart-no-discard-override')).toBe('fail')
      const message = await messageOf(fx, 'repart-no-discard-override')
      expect(message).toContain('10-nodiscard.conf')
      expect(message).toContain('loader protection must come from the partition entry')
    }
    finally {
      fx.dispose()
    }
  })

  test('/usr/local/lib/systemd is NOT searched -- reproduced, not widened', async () => {
    // The oracle greps /etc/systemd and /usr/lib/systemd only. Widening the
    // search here would make the port stricter than the verifier it replaces,
    // and the divergence would be the port's.
    const fx = packedRootFixture(cx3576)
    try {
      write(fx.root, '/usr/local/lib/systemd/system/nodiscard.conf', '--discard=no\n')
      expect(await verdictOf(fx, 'repart-no-discard-override')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the AuthorizedKeysFile drop-in', () => {
  test('a retargeted value fails, naming where mosd actually writes', async () => {
    const fx = await mutated('sshd-authorized-keys-value',
      root => write(root, SSHD_DROPIN, 'AuthorizedKeysFile .ssh/authorized_keys\n'))
    try {
      expect(await verdictOf(fx, 'sshd-authorized-keys-value')).toBe('fail')
      expect(await messageOf(fx, 'sshd-authorized-keys-value'))
        .toContain('no installed key would ever grant access')
    }
    finally {
      fx.dispose()
    }
  })

  test('the drop-in absent fails, and the message says <nothing>', async () => {
    const fx = await mutated('sshd-authorized-keys-value', root => rmSync(join(root, SSHD_DROPIN)))
    try {
      expect(await messageOf(fx, 'sshd-authorized-keys-value'))
        .toContain("sets AuthorizedKeysFile to '<nothing>'")
    }
    finally {
      fx.dispose()
    }
  })

  test('etc-ssh.mount absent fails: the keys have no STATE-backed home', async () => {
    const fx = await mutated('sshd-authorized-keys-on-state', root => rmSync(join(root, ETC_SSH_MOUNT)))
    try {
      expect(await messageOf(fx, 'sshd-authorized-keys-on-state'))
        .toContain('would be lost by every update')
    }
    finally {
      fx.dispose()
    }
  })

  test('a keys path OUTSIDE the bind fails, though both files are correct', async () => {
    const fx = await mutated('sshd-authorized-keys-on-state',
      root => write(root, SSHD_DROPIN, 'AuthorizedKeysFile /var/lib/mos/keys/%u\n'))
    try {
      expect(await verdictOf(fx, 'sshd-authorized-keys-on-state')).toBe('fail')
      expect(await messageOf(fx, 'sshd-authorized-keys-on-state'))
        .toContain("is not inside '/etc/ssh'")
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind that is not on STATE fails', async () => {
    const fx = await mutated('sshd-authorized-keys-on-state',
      root => rewrite(root, ETC_SSH_MOUNT, t => t.replace('What=/mnt/state/ssh', 'What=/srv/ssh')))
    try {
      expect(await messageOf(fx, 'sshd-authorized-keys-on-state'))
        .toContain('which is not under /mnt/state')
    }
    finally {
      fx.dispose()
    }
  })

  test('a SECOND emitter fails, and both files are listed in lexical order', async () => {
    // sshd keeps the FIRST value it reads and reads sshd_config.d in lexical
    // order, so a second file makes the winner depend on filenames.
    const fx = await mutated('sshd-single-authorized-keys-emitter',
      root => write(root, '/etc/ssh/sshd_config.d/01-operator.conf',
        'AuthorizedKeysFile /root/.ssh/authorized_keys\n'))
    try {
      expect(await verdictOf(fx, 'sshd-single-authorized-keys-emitter')).toBe('fail')
      expect(await messageOf(fx, 'sshd-single-authorized-keys-emitter'))
        .toContain('2 shipped sshd config files emit AuthorizedKeysFile '
          + '(/etc/ssh/sshd_config.d/01-operator.conf /etc/ssh/sshd_config.d/05-mos-authorized-keys.conf)')
    }
    finally {
      fx.dispose()
    }
  })

  test('sshd_config ITSELF emitting the keyword fails too', async () => {
    const fx = await mutated('sshd-single-authorized-keys-emitter',
      root => rewrite(root, '/etc/ssh/sshd_config', t => `${t}AuthorizedKeysFile .ssh/authorized_keys\n`))
    try {
      expect(await verdictOf(fx, 'sshd-single-authorized-keys-emitter')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the image profile, and the SSH default it selects', () => {
  test('the key and the path are READ out of mosd, not restated', () => {
    const { key, defaultPath } = readProfileContract()
    expect(defaultPath).toBe('/usr/lib/mos/profile.conf')
    expect(key).toBe('MOS_PROFILE')
  })

  test('a writable profile fails, and the mode is printed', async () => {
    const fx = await mutated('profile-mode-0444', root => chmodSync(join(root, PROFILE), 0o644))
    try {
      expect(await messageOf(fx, 'profile-mode-0444'))
        .toBe('/usr/lib/mos/profile.conf is mode 644, expected 444')
    }
    finally {
      fx.dispose()
    }
  })

  test('an UPPERCASE value fails: mosd\'s match is case-sensitive and fails closed', async () => {
    const fx = await mutated('profile-value-recognised',
      root => rewrite(root, PROFILE, t => t.replace('=dev', '=DEV')))
    try {
      expect(await verdictOf(fx, 'profile-value-recognised')).toBe('fail')
      expect(await messageOf(fx, 'profile-value-recognised'))
        .toContain('this image would self-provision to prod and disable its own sshd')
    }
    finally {
      fx.dispose()
    }
  })

  test('TWO profile lines fail: mosd takes the last, so line order becomes meaning', async () => {
    const fx = await mutated('profile-value-recognised',
      root => rewrite(root, PROFILE, t => `${t}MOS_PROFILE=prod\n`))
    try {
      expect(await messageOf(fx, 'profile-value-recognised'))
        .toContain('carries 2 MOS_PROFILE= lines; mosd takes the LAST one')
    }
    finally {
      fx.dispose()
    }
  })

  test('an EMPTY assignment is not a value: it resolves to nothing and fails', async () => {
    // `grep -c .` counts non-empty lines, so `MOS_PROFILE=` on its own leaves
    // the value unset and the image self-provisions to prod.
    const fx = await mutated('profile-value-recognised',
      root => write(root, PROFILE, 'MOS_PROFILE=\n'))
    try {
      expect(await verdictOf(fx, 'profile-value-recognised')).toBe('fail')
      expect(await messageOf(fx, 'profile-value-recognised')).toContain("resolves to ''")
    }
    finally {
      fx.dispose()
    }
  })

  test('ssh.service ENABLED fails on either profile, and names the symlink', async () => {
    // This assertion used to point the other way and dev shipped sshd enabled.
    // mosd now seeds access.ssh.enabled false for both profiles, so an enabled
    // unit is listening from early boot until the first reconcile stops it.
    const fx = await mutated('profile-ssh-not-enabled', (root) => {
      mkdirSync(join(root, '/etc/systemd/system/multi-user.target.wants'), { recursive: true })
      symlinkSync(SSH_UNIT, join(root, '/etc/systemd/system/multi-user.target.wants/ssh.service'))
    })
    try {
      expect(await verdictOf(fx, 'profile-ssh-not-enabled')).toBe('fail')
      expect(await messageOf(fx, 'profile-ssh-not-enabled'))
        .toContain('/etc/systemd/system/multi-user.target.wants/ssh.service')
    }
    finally {
      fx.dispose()
    }
  })

  test('sshd.service counts too -- the unit has two names across distributions', async () => {
    const fx = await mutated('profile-ssh-not-enabled', (root) => {
      mkdirSync(join(root, '/usr/lib/systemd/system/multi-user.target.wants'), { recursive: true })
      symlinkSync(SSH_UNIT, join(root, '/usr/lib/systemd/system/multi-user.target.wants/sshd.service'))
    })
    try {
      expect(await verdictOf(fx, 'profile-ssh-not-enabled')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('with an unrecognised profile the SSH check refuses to judge', async () => {
    const fx = await mutated('profile-ssh-not-enabled',
      root => rewrite(root, PROFILE, t => t.replace('=dev', '=staging')))
    try {
      expect(await messageOf(fx, 'profile-ssh-not-enabled'))
        .toBe('ssh.service enablement cannot be judged: the image profile did not resolve to dev or prod')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('ssh.service\'s inherited properties', () => {
  test('KillMode=control-group fails, and what was found is printed', async () => {
    const fx = await mutated('ssh-killmode-process',
      root => rewrite(root, SSH_UNIT, t => t.replace('KillMode=process', 'KillMode=control-group')))
    try {
      expect(await verdictOf(fx, 'ssh-killmode-process')).toBe('fail')
      const message = await messageOf(fx, 'ssh-killmode-process')
      expect(message).toContain("does NOT set KillMode=process (found 'control-group'")
      expect(message).toContain('so do not treat this as cosmetic')
    }
    finally {
      fx.dispose()
    }
  })

  test('ExecReload removed fails, and the message says the reload silently never applies', async () => {
    const fx = await mutated('ssh-execreload-present',
      root => rewrite(root, SSH_UNIT, t => t.replace(/^ExecReload=.*$/m, '')))
    try {
      expect(await verdictOf(fx, 'ssh-execreload-present')).toBe('fail')
      expect(await messageOf(fx, 'ssh-execreload-present'))
        .toContain('silently never applies to the running listener')
    }
    finally {
      fx.dispose()
    }
  })

  test('the unit absent fails BOTH, each naming its own property', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, SSH_UNIT))
      expect(await messageOf(fx, 'ssh-killmode-process'))
        .toContain('no claim can be made about KillMode')
      expect(await messageOf(fx, 'ssh-execreload-present'))
        .toContain('no claim can be made about ExecReload')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('libcrypt, and the crypt(3) format mosd writes', () => {
  test('exactly one prefix is pinned, and it is read out of transient.rs', () => {
    expect(cryptPrefixes()).toEqual(['$2b$'])
  })

  test('the SONAME link removed fails, naming pam_unix', async () => {
    const fx = await mutated('libcrypt-resolves',
      root => rmSync(join(root, `/usr/lib/aarch64-linux-gnu/libcrypt.so.1`)))
    try {
      expect(await verdictOf(fx, 'libcrypt-resolves')).toBe('fail')
      expect(await messageOf(fx, 'libcrypt-resolves'))
        .toContain('without it pam_unix cannot verify any password at all')
    }
    finally {
      fx.dispose()
    }
  })

  test('a library that does not carry the format fails, and lists what it does carry', async () => {
    // The failure no Rust test can reach: the test host is x86 and the library
    // is an arm64 object inside the image.
    const fx = await mutated('libcrypt-implements-prefix',
      root => write(root, '/usr/lib/aarch64-linux-gnu/libcrypt.so.1.1.0',
        '\x7fELF...$6$...$1$...\n'))
    try {
      expect(await verdictOf(fx, 'libcrypt-implements-prefix')).toBe('fail')
      const message = await messageOf(fx, 'libcrypt-implements-prefix')
      expect(message).toContain('does NOT implement $2b$')
      expect(message).toContain('pam_unix would reject every password')
    }
    finally {
      fx.dispose()
    }
  })

  test('with no library at all it says it CANNOT CHECK rather than that the format is absent', async () => {
    // Two different statements with two different repairs, and the oracle keeps
    // them apart.
    const fx = await mutated('libcrypt-implements-prefix',
      root => rmSync(join(root, '/usr/lib/aarch64-linux-gnu/libcrypt.so.1.1.0')))
    try {
      expect(await messageOf(fx, 'libcrypt-implements-prefix'))
        .toContain("cannot check the crypt(3) format against the image's libcrypt:")
    }
    finally {
      fx.dispose()
    }
  })

  test('the multiarch directory FOLLOWS the board -- x64 looks in x86_64-linux-gnu', async () => {
    // Pinning aarch64 is what made this check report that libcrypt "does not
    // resolve to a regular file" on x64: true of a path that board never had,
    // and a statement about the wrong directory.
    const fx = packedRootFixture(x64)
    try {
      const got = await only(fx, 'libcrypt-resolves', x64)
      expect(got.verdict).toBe('pass')
      expect(got.message).toContain('/usr/lib/x86_64-linux-gnu/libcrypt.so.1 resolves to')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the boot scripts\' external commands', () => {
  test('a command the scripts invoke but the image lacks fails, and it is named', async () => {
    const fx = await mutated('boot-scripts-commands-resolve', root => rmSync(join(root, '/usr/bin/od')))
    try {
      expect(await verdictOf(fx, 'boot-scripts-commands-resolve')).toBe('fail')
      const message = await messageOf(fx, 'boot-scripts-commands-resolve')
      expect(message).toContain('NOT in the packed rootfs: od.')
      expect(message).toContain('in the code that reconciles root\'s credentials')
    }
    finally {
      fx.dispose()
    }
  })

  test('a DANGLING /etc/alternatives-shaped symlink fails rather than resolving', async () => {
    // sq_resolves_cmd re-roots an ABSOLUTE link target at ROOT, which is the one
    // place this harness does not let the shell's own resolution stand: a
    // dangling alternative would otherwise resolve against the host's /usr/bin
    // and pass on an image that has nothing there.
    const fx = await mutated('boot-scripts-commands-resolve', (root) => {
      rmSync(join(root, '/usr/bin/sed'))
      symlinkSync('/etc/alternatives/sed', join(root, '/usr/bin/sed'))
    })
    try {
      expect(await verdictOf(fx, 'boot-scripts-commands-resolve')).toBe('fail')
      expect(await messageOf(fx, 'boot-scripts-commands-resolve')).toContain(' sed.')
    }
    finally {
      fx.dispose()
    }
  })

  test('...and the same symlink RESOLVES when its target is in the image', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, '/usr/bin/sed'))
      write(fx.root, '/etc/alternatives/sed', 'x\n')
      symlinkSync('/etc/alternatives/sed', join(fx.root, '/usr/bin/sed'))
      expect(await verdictOf(fx, 'boot-scripts-commands-resolve')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('an extractor that stops seeing commands fails as VACUOUS, not as clean', async () => {
    // The guard is half the check: an empty set makes every presence test pass
    // while proving nothing at all.
    const fx = await mutated('boot-scripts-commands-resolve',
      root => write(root, MOS_HEALTH, '#!/bin/sh\nexit 0\n'))
    try {
      expect(await verdictOf(fx, 'boot-scripts-commands-resolve')).toBe('fail')
      expect(await messageOf(fx, 'boot-scripts-commands-resolve'))
        .toContain('the extractor is not reading them, so the binary-presence check would pass vacuously')
    }
    finally {
      fx.dispose()
    }
  })

  test('a file with no shebang is not read at all', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      write(fx.root, '/usr/lib/mos/notes.txt', 'nosuchcommand --now\n')
      expect(await messageOf(fx, 'boot-scripts-commands-resolve')).not.toContain('nosuchcommand')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the extractor itself, stage by stage', () => {
  test('a WRAPPER call is not extracted -- `have curl` marks curl optional', () => {
    // The oracle is explicit that busctl, rauc, systemctl, curl and wget must
    // NOT be in this set: mos-health uses `have X ||` to mark them optional, and
    // asserting they exist would be asserting the wrong thing.
    const got = extractCommands('#!/bin/sh\nhave() { command -v "$1"; }\nhave curl || exit 0\n')
    expect(got).not.toContain('curl')
    expect(got).not.toContain('have')
  })

  test('a `case` PATTERN is not a command', () => {
    const got = extractCommands('#!/bin/sh\ncase "$1" in\nstart)\n  mkdir /x\n  ;;\nesac\n')
    expect(got).toContain('mkdir')
    expect(got).not.toContain('start')
  })

  test('a command SUBSTITUTION inside a double-quoted string is still extracted', () => {
    // The split on `$(` happens BEFORE quoted spans are removed, which is why.
    expect(extractCommands('#!/bin/sh\nx="$(mktemp -d)"\n')).toContain('mktemp')
  })

  test('an ESCAPED # is not a comment opener', () => {
    expect(extractCommands('#!/bin/sh\nprintf \'%s\' "a \\# b"\nmkdir /x\n')).toContain('mkdir')
  })

  test('a LINE CONTINUATION joins, so the second half is not a fresh command position', () => {
    const got = extractCommands('#!/bin/sh\nsleep 0 \\\n    && sync\n')
    expect(got).toContain('sync')
    expect(got).not.toContain('0')
  })

  test('an assignment, an option and an expansion are all skipped', () => {
    const got = extractCommands('#!/bin/sh\nFOO=bar\n-x\n$CMD arg\n')
    expect(got).toEqual([])
  })

  test('a defined FUNCTION is not an external command', () => {
    expect(extractCommands('#!/bin/sh\nprobe() {\n  mkdir /x\n}\nprobe\n')).toEqual(['mkdir'])
  })

  test('a name outside the command alphabet is skipped', () => {
    expect(extractCommands('#!/bin/sh\nfoo@bar\n')).toEqual([])
  })
})

describe('sq_resolves_cmd, in its own right', () => {
  test('a symlink CHAIN inside the image resolves', () => {
    const fx = packedRootFixture(cx3576)
    try {
      write(fx.root, '/usr/bin/real-tool', 'x\n')
      symlinkSync('/usr/bin/real-tool', join(fx.root, '/usr/bin/hop1'))
      symlinkSync('hop1', join(fx.root, '/usr/bin/tool'))
      expect(resolvesInRoot(fx.root, 'tool')).toBe(true)
    }
    finally {
      fx.dispose()
    }
  })

  test('a name in NO command directory does not resolve', () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(resolvesInRoot(fx.root, 'definitely-not-here')).toBe(false)
    }
    finally {
      fx.dispose()
    }
  })

  test('an ABSOLUTE command name is looked up inside the root, not on the host', () => {
    const fx = packedRootFixture(cx3576)
    try {
      // /bin/sh exists on every host running this suite and NOT in the fixture,
      // so a lookup that fell through to the host would answer yes.
      expect(resolvesInRoot(fx.root, '/bin/sh')).toBe(false)
      write(fx.root, '/bin/sh', 'x\n')
      expect(resolvesInRoot(fx.root, '/bin/sh')).toBe(true)
    }
    finally {
      fx.dispose()
    }
  })
})
