// The persistent homes, the mos account and the STATE binds, driven from the
// failing side.
//
// PLAN-014 M4f (RFCT-110), RFCT-096. Each case is green first, then ONE edit.
// The edits are the shapes these failures take on a device rather than in a
// diff:
//
//   - a bind pointed at STATE instead of DATA. It reads as a tidy-up -- both are
//     persistent -- and it puts a directory of unbounded size on the 64 MiB
//     partition that holds the settings tree and the sshd host keys.
//   - a mount unit installed and never ENABLED. M4 shipped exactly that; the
//     target stays inside the read-only squashfs for ever and every check that
//     only looked for the file still passes.
//   - `mos` resolving to a different uid. The account is there, the shell is
//     right, and every file already on DATA belongs to nobody.
//   - a seed script that writes under /root. It runs BEFORE root.mount, so /root
//     there is still the verity squashfs and the write fails -- on the device
//     and nowhere else.

import { describe, expect, test } from 'bun:test'
import { chmodSync, chownSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { boardsWhere, hasRadio, SHIPPED } from './board-scope.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { dataMountpoint, HOME_CHECKS, writesUnderRoot } from './checks-home.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

const HOME_MOUNT = '/etc/systemd/system/home.mount'
const ROOT_MOUNT = '/etc/systemd/system/root.mount'
const SEED_HOME_UNIT = '/etc/systemd/system/mos-seed-home.service'
const SEED_ROOT_UNIT = '/etc/systemd/system/mos-seed-root.service'
const SEED_HOME = '/usr/lib/mos/mos-seed-home'
const SEED_ROOT = '/usr/lib/mos/mos-seed-root'
const VAR_LIB_MOS = '/etc/systemd/system/var-lib-mos.mount'
const EXT_MOUNT = '/etc/systemd/system/usr-local-lib-systemd-system.mount'
const WANTS = '/etc/systemd/system/local-fs.target.wants'

function checkNamed(id: string): CheckCase {
  const found = HOME_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no home check is registered as '${id}'. Registered: `
      + HOME_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

async function only(fx: RootFixture, id: string): Promise<CheckResult> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  return got[0] as CheckResult
}

async function verdictOf(fx: RootFixture, id: string): Promise<Verdict> {
  return (await only(fx, id)).verdict
}

async function messageOf(fx: RootFixture, id: string): Promise<string> {
  return (await only(fx, id)).message
}

async function mutated(id: string, mutate: (root: string) => void, board: Board = cx3576): Promise<RootFixture> {
  const fx = packedRootFixture(board)
  expect(await verdictOf(fx, id)).toBe('pass')
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
  test('every check concludes on both boards, and only the Bluetooth bind splits them', async () => {
    // Fourteen conclusions on each shipped board. The Bluetooth STATE bind is
    // the only board-conditional member: cx3576 asserts the pair, x64 SKIPS it,
    // and the two entries are scoped to complements of one derived predicate.
    for (const board of [cx3576, x64]) {
      const fx = packedRootFixture(board)
      try {
        for (const c of HOME_CHECKS) {
          if (c.boards !== undefined && !c.boards.includes(board.name)) continue
          const got = await c.run(fx.ctx)
          const want = c.id === 'precious-bind-bluetooth-skipped' ? 'skip' : 'pass'
          expect(`${board.name}/${c.id}: ${got.map(r => r.verdict).join(',')}`)
            .toBe(`${board.name}/${c.id}: ${want}`)
        }
      }
      finally {
        fx.dispose()
      }
    }
  })

  test('the Bluetooth scopes are COMPLEMENTS, derived from the shipped definitions', () => {
    // Not two board literals that happen to be disjoint today. A third board
    // dropped into os/boards/ lands in exactly one of these lists, whichever its
    // own BOARD_RADIOS selects, with nothing here edited.
    const withRadio = boardsWhere(b => hasRadio(b, 'bluetooth'))
    const without = boardsWhere(b => !hasRadio(b, 'bluetooth'))
    const pair = checkNamed('precious-bind-var-lib-bluetooth').boards ?? []
    const skip = checkNamed('precious-bind-bluetooth-skipped').boards ?? []
    expect([...pair].sort()).toEqual([...withRadio].sort())
    expect([...skip].sort()).toEqual([...without].sort())
    expect([...pair, ...skip].sort()).toEqual(SHIPPED.map(b => b.name).sort())
    expect(pair.filter(b => skip.includes(b))).toEqual([])
  })

  test('the DATA mountpoint is READ from the fstab row, not spelled here', () => {
    // Both boards, from their own definitions. A check comparing against the
    // literal `/srv` would pass an image whose fstab had moved DATA.
    for (const board of [cx3576, x64]) {
      const fx = packedRootFixture(board)
      try {
        expect(dataMountpoint(fx.root, board)).toBe('/srv')
      }
      finally {
        fx.dispose()
      }
    }
  })
})

describe('/home is bound from DATA', () => {
  test('the unit absent fails, and the message says nothing survives a reboot', async () => {
    const fx = await mutated('home-mount-on-data', root => rmSync(join(root, HOME_MOUNT)))
    try {
      expect(await verdictOf(fx, 'home-mount-on-data')).toBe('fail')
      expect(await messageOf(fx, 'home-mount-on-data'))
        .toContain('home.mount is not in the image, so /home stays inside the read-only verity squashfs')
    }
    finally {
      fx.dispose()
    }
  })

  test('a RETARGETED Where= fails, and the wrong target is printed', async () => {
    const fx = await mutated('home-mount-on-data',
      root => rewrite(root, HOME_MOUNT, t => t.replace('Where=/home', 'Where=/home/mos')))
    try {
      expect(await messageOf(fx, 'home-mount-on-data')).toContain("home.mount mounts '/home/mos', not /home")
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind on STATE fails on the TIER, not on a spelling', async () => {
    // /mnt/state is persistent too, so nothing about the string is wrong. What
    // is wrong is the partition: 64 MiB of precious identity under a directory
    // of unbounded size.
    const fx = await mutated('home-mount-on-data',
      root => rewrite(root, HOME_MOUNT, t => t.replace('What=/srv/home', 'What=/mnt/state/home')))
    try {
      expect(await verdictOf(fx, 'home-mount-on-data')).toBe('fail')
      const message = await messageOf(fx, 'home-mount-on-data')
      expect(message).toContain("binds /home from '/mnt/state/home', which is not under /srv")
      expect(message).toContain('DATA is also the only partition repart grows')
    }
    finally {
      fx.dispose()
    }
  })

  test('a unit present and NOT ENABLED fails: the target stays read-only for ever', async () => {
    const fx = await mutated('home-mount-on-data', root => rmSync(join(root, WANTS, 'home.mount')))
    try {
      expect(await verdictOf(fx, 'home-mount-on-data')).toBe('fail')
      expect(await messageOf(fx, 'home-mount-on-data'))
        .toContain('home.mount exists but is not enabled')
    }
    finally {
      fx.dispose()
    }
  })

  test('with no DATA row in fstab, home.mount and root.mount fail with DIFFERENT sentences', async () => {
    // They differ by one word, and that word is the whole reason each check can
    // claim its own line: a matcher taken from the front of the shared clause
    // would claim both and the run would report `ambiguous` rather than two
    // failures.
    const fx = packedRootFixture(cx3576)
    try {
      const guid = (cx3576.partition('DATA')?.guid ?? '').toLowerCase()
      rewrite(fx.root, '/etc/fstab', t => t.split('\n')
        .filter(l => !l.toLowerCase().includes(guid)).join('\n'))
      const home = await only(fx, 'home-mount-on-data')
      const rootMount = await only(fx, 'root-mount-on-data')
      expect(home.verdict).toBe('fail')
      expect(rootMount.verdict).toBe('fail')
      expect(home.message).toContain("so home.mount's backing tier cannot be established")
      expect(rootMount.message).toContain("so root.mount's backing tier cannot be established")
      expect(home.message).not.toBe(rootMount.message)
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the /home seed runs before the bind', () => {
  test('the seed unit absent fails, naming what mount(8) will not do', async () => {
    const fx = await mutated('mos-seed-home-service', root => rmSync(join(root, SEED_HOME_UNIT)))
    try {
      expect(await messageOf(fx, 'mos-seed-home-service'))
        .toContain('mount(8) never creates the SOURCE of a bind')
    }
    finally {
      fx.dispose()
    }
  })

  test('a seed with NO Before= fails: the ordering is what sequences the mount job', async () => {
    const fx = await mutated('mos-seed-home-service',
      root => rewrite(root, SEED_HOME_UNIT, t => t.replace('Before=home.mount\n', '')))
    try {
      expect(await messageOf(fx, 'mos-seed-home-service'))
        .toContain('has no Before= naming home.mount')
    }
    finally {
      fx.dispose()
    }
  })

  test('a NEAR-MISS unit name in Before= fails: the match is exact, not a substring', async () => {
    // `grep -Fx home.mount`, not `grep home.mount`. `Before=home.mount.d` would
    // satisfy a loose reader and orders nothing.
    const fx = await mutated('mos-seed-home-service',
      root => rewrite(root, SEED_HOME_UNIT, t => t.replace('Before=home.mount', 'Before=home.mount.d')))
    try {
      expect(await verdictOf(fx, 'mos-seed-home-service')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('a Before= listing SEVERAL units still finds ours', async () => {
    // The oracle splits the value on spaces and looks for an exact element, so
    // a unit ordered before three things is still ordered before this one.
    const fx = packedRootFixture(cx3576)
    try {
      rewrite(fx.root, SEED_HOME_UNIT, t =>
        t.replace('Before=home.mount', 'Before=srv.mount home.mount root.mount'))
      expect(await verdictOf(fx, 'mos-seed-home-service')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('a seed unit that is not ENABLED fails', async () => {
    const fx = await mutated('mos-seed-home-service',
      root => rmSync(join(root, WANTS, 'mos-seed-home.service')))
    try {
      expect(await messageOf(fx, 'mos-seed-home-service'))
        .toContain('the home.mount source is never created and the bind fails on every boot')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('what the /home seed writes, read statically', () => {
  test('a uid the seed pins differently from /etc/passwd fails, by NUMBER', async () => {
    const fx = await mutated('mos-seed-home-writes-data',
      root => rewrite(root, SEED_HOME, t => t.replace('MOS_UID=1000', 'MOS_UID=1001')))
    try {
      expect(await messageOf(fx, 'mos-seed-home-writes-data'))
        .toContain("mos-seed-home pins uid '1001' gid '1000', not 1000:1000")
    }
    finally {
      fx.dispose()
    }
  })

  test('a seed that creates nothing fails, naming the read-only view of /home', async () => {
    const fx = await mutated('mos-seed-home-writes-data',
      root => rewrite(root, SEED_HOME, t => t.replace('mkdir /srv/home/mos\n', '')))
    try {
      expect(await messageOf(fx, 'mos-seed-home-writes-data'))
        .toContain('/home in the unbound view is inside the read-only verity squashfs')
    }
    finally {
      fx.dispose()
    }
  })

  test('a home left group-readable fails', async () => {
    const fx = await mutated('mos-seed-home-writes-data',
      root => rewrite(root, SEED_HOME, t => t.replace('chmod 0700', 'chmod 0750')))
    try {
      expect(await messageOf(fx, 'mos-seed-home-writes-data'))
        .toContain('a home directory readable by every local uid is not a private home')
    }
    finally {
      fx.dispose()
    }
  })

  test('a chown resolving the NAME at runtime fails, though it looks equivalent', async () => {
    // `chown mos:mos` makes the owner whatever the running image says today; the
    // directory outlives the rootfs, so the pair has to be the pinned numbers.
    const fx = await mutated('mos-seed-home-writes-data',
      root => rewrite(root, SEED_HOME, t =>
        t.replace('chown "${MOS_UID}:${MOS_GID}" /srv/home/mos', 'chown mos:mos /srv/home/mos')))
    try {
      expect(await messageOf(fx, 'mos-seed-home-writes-data'))
        .toContain('resolving the name at runtime would make the owner whatever the running image says today')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the mos account, by number', () => {
  test('no account at all fails', async () => {
    const fx = await mutated('mos-account-by-number',
      root => rewrite(root, '/etc/passwd', t => t.split('\n').filter(l => !l.startsWith('mos:')).join('\n')))
    try {
      expect(await messageOf(fx, 'mos-account-by-number'))
        .toContain('the persistent home would have no owner')
    }
    finally {
      fx.dispose()
    }
  })

  test('a different uid fails, and the message says every file belongs to nobody', async () => {
    const fx = await mutated('mos-account-by-number',
      root => rewrite(root, '/etc/passwd', t => t.replace('mos:x:1000:1000', 'mos:x:1001:1000')))
    try {
      expect(await verdictOf(fx, 'mos-account-by-number')).toBe('fail')
      expect(await messageOf(fx, 'mos-account-by-number'))
        .toContain('owned by a uid that no longer exists, and nothing reports an error')
    }
    finally {
      fx.dispose()
    }
  })

  test('a GROUP gid that disagrees with the passwd row fails on its own branch', async () => {
    const fx = await mutated('mos-account-by-number',
      root => rewrite(root, '/etc/group', t => t.replace('mos:x:1000:', 'mos:x:1002:')))
    try {
      expect(await messageOf(fx, 'mos-account-by-number'))
        .toContain("the 'mos' group is gid '1002' in the packed /etc/group, expected 1000")
    }
    finally {
      fx.dispose()
    }
  })

  test('a group ABSENT from /etc/group fails and says so', async () => {
    const fx = await mutated('mos-account-by-number',
      root => rewrite(root, '/etc/group', t => t.split('\n').filter(l => !l.startsWith('mos:')).join('\n')))
    try {
      expect(await messageOf(fx, 'mos-account-by-number')).toContain("group is gid 'absent'")
    }
    finally {
      fx.dispose()
    }
  })

  test('a login shell the image does not ship fails, and both facts are printed', async () => {
    const fx = await mutated('mos-account-by-number', root => rmSync(join(root, '/bin/bash')))
    try {
      expect(await messageOf(fx, 'mos-account-by-number'))
        .toContain("'mos' has shell '/bin/bash' and /bin/bash is ABSENT in the packed root")
    }
    finally {
      fx.dispose()
    }
  })

  test('a shell that is not /bin/bash fails even when that binary ships', async () => {
    const fx = await mutated('mos-account-by-number',
      root => rewrite(root, '/etc/passwd', t => t.replace('/home/mos:/bin/bash', '/home/mos:/usr/sbin/nologin')))
    try {
      expect(await messageOf(fx, 'mos-account-by-number')).toContain("has shell '/usr/sbin/nologin'")
    }
    finally {
      fx.dispose()
    }
  })

  test('a home outside /home/mos fails', async () => {
    const fx = await mutated('mos-account-by-number',
      root => rewrite(root, '/etc/passwd', t => t.replace(':/home/mos:', ':/var/home/mos:')))
    try {
      expect(await messageOf(fx, 'mos-account-by-number'))
        .toContain("'mos' has home '/var/home/mos', expected /home/mos")
    }
    finally {
      fx.dispose()
    }
  })
})

describe('mos is not a privilege tier', () => {
  test('a supplementary group grant fails, and the group is named', async () => {
    const fx = await mutated('mos-account-no-privilege-path',
      root => rewrite(root, '/etc/group', t => `${t}adm:x:4:mos\n`))
    try {
      expect(await verdictOf(fx, 'mos-account-no-privilege-path')).toBe('fail')
      expect(await messageOf(fx, 'mos-account-no-privilege-path'))
        .toContain("'mos' is a member of supplementary group(s): adm.")
    }
    finally {
      fx.dispose()
    }
  })

  test('a grant in the MIDDLE of a member list is found', async () => {
    const fx = await mutated('mos-account-no-privilege-path',
      root => rewrite(root, '/etc/group', t => `${t}shadow2:x:43:alice,mos,bob\n`))
    try {
      expect(await messageOf(fx, 'mos-account-no-privilege-path')).toContain('shadow2')
    }
    finally {
      fx.dispose()
    }
  })

  test('a group whose member merely STARTS with mos is not a grant', async () => {
    // `mosquitto` is not `mos`. The oracle anchors on comma boundaries and so
    // does this; a substring match would report a grant that is not there, and
    // the obvious repair for a false positive is to loosen the check.
    const fx = packedRootFixture(cx3576)
    try {
      rewrite(fx.root, '/etc/group', t => `${t}mqtt:x:970:mosquitto\n`)
      expect(await verdictOf(fx, 'mos-account-no-privilege-path')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('sudo shipping in the image fails even with no group grant', async () => {
    // A group grant needs a binary to mean anything, and vice versa -- so both
    // halves are asserted, in one check, because either alone is the deferral
    // being undone.
    const fx = await mutated('mos-account-no-privilege-path',
      root => write(root, '/usr/bin/sudo', 'x\n'))
    try {
      expect(await messageOf(fx, 'mos-account-no-privilege-path'))
        .toContain('phase 1 deliberately gives \'mos\' no privilege-escalation path')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the account home is inside what the bind covers', () => {
  test('a home outside the bind fails, and the consequence is named', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'mos-home-inside-the-bind')).toBe('pass')
      rewrite(fx.root, '/etc/passwd', t => t.replace(':/home/mos:', ':/opt/mos:'))
      expect(await verdictOf(fx, 'mos-home-inside-the-bind')).toBe('fail')
      expect(await messageOf(fx, 'mos-home-inside-the-bind'))
        .toContain('gone on the next A/B update')
    }
    finally {
      fx.dispose()
    }
  })

  test('with no Where= to compare against it refuses rather than guessing', async () => {
    const fx = await mutated('mos-home-inside-the-bind',
      root => rewrite(root, HOME_MOUNT, t => t.replace('Where=/home\n', '')))
    try {
      expect(await messageOf(fx, 'mos-home-inside-the-bind'))
        .toContain("cannot compare 'mos' home '/home/mos' against home.mount Where='<none>'")
    }
    finally {
      fx.dispose()
    }
  })
})

describe('/root, its mode, and its seed', () => {
  test('a group-readable /root fails, and the mode is printed', async () => {
    const fx = await mutated('root-mountpoint-mode', root => chmodSync(join(root, '/root'), 0o755))
    try {
      expect(await verdictOf(fx, 'root-mountpoint-mode')).toBe('fail')
      expect(await messageOf(fx, 'root-mountpoint-mode'))
        .toContain('/root in the packed root is mode 755 owned 0:0, expected 700 and 0:0')
    }
    finally {
      fx.dispose()
    }
  })

  test('a /root owned by anyone else fails', async () => {
    const fx = await mutated('root-mountpoint-mode', root => chownSync(join(root, '/root'), 1000, 1000))
    try {
      expect(await messageOf(fx, 'root-mountpoint-mode')).toContain('owned 1000:1000')
    }
    finally {
      fx.dispose()
    }
  })

  test('root.mount on STATE fails on the tier, as /home\'s twin does', async () => {
    const fx = await mutated('root-mount-on-data',
      root => rewrite(root, ROOT_MOUNT, t => t.replace('What=/srv/root', 'What=/mnt/state/root')))
    try {
      expect(await messageOf(fx, 'root-mount-on-data'))
        .toContain("binds /root from '/mnt/state/root', which is not under /srv")
    }
    finally {
      fx.dispose()
    }
  })

  test('a NON-EXECUTABLE seed script fails, naming 203/EXEC', async () => {
    // Nothing else in the image asserts this bit: mos-seed-root is not in the
    // regular-file list the way mos-seed-home is, so if this branch did not
    // exist the mode would be unasserted anywhere.
    const fx = await mutated('mos-seed-root-service', root => chmodSync(join(root, SEED_ROOT), 0o644))
    try {
      expect(await verdictOf(fx, 'mos-seed-root-service')).toBe('fail')
      expect(await messageOf(fx, 'mos-seed-root-service'))
        .toContain('is mode 644, not executable; ExecStart= would fail with 203/EXEC')
    }
    finally {
      fx.dispose()
    }
  })

  test('a seed script reachable only through a SYMLINK fails', async () => {
    // `[ ! -f ] || [ -L ]` -- a link to a regular file passes `-f` and is
    // refused anyway, because the next pack stage can move its target without
    // anything noticing.
    const fx = await mutated('mos-seed-root-service', (root) => {
      const body = readFileSync(join(root, SEED_ROOT), 'utf8')
      rmSync(join(root, SEED_ROOT))
      write(root, '/usr/lib/mos/seed-root-impl', body)
      chmodSync(join(root, '/usr/lib/mos/seed-root-impl'), 0o755)
      symlinkSync('/usr/lib/mos/seed-root-impl', join(root, SEED_ROOT))
    })
    try {
      expect(await messageOf(fx, 'mos-seed-root-service'))
        .toContain('/usr/lib/mos/mos-seed-root is missing or not a regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('the seed unit not ordered Before=root.mount fails', async () => {
    const fx = await mutated('mos-seed-root-service',
      root => rewrite(root, SEED_ROOT_UNIT, t => t.replace('Before=root.mount', 'After=root.mount')))
    try {
      expect(await messageOf(fx, 'mos-seed-root-service'))
        .toContain('has no Before= naming root.mount')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('what the /root seed writes', () => {
  test('a write UNDER /root fails, and the line is quoted with its number', async () => {
    // It runs before root.mount, so /root is still the verity squashfs there.
    const fx = await mutated('mos-seed-root-writes-data',
      root => rewrite(root, SEED_ROOT, t => `${t}mkdir /root/.ssh\n`))
    try {
      expect(await verdictOf(fx, 'mos-seed-root-writes-data')).toBe('fail')
      expect(await messageOf(fx, 'mos-seed-root-writes-data'))
        .toContain('mos-seed-root writes under /root: 7:mkdir /root/.ssh')
    }
    finally {
      fx.dispose()
    }
  })

  test('a write under /root with arguments before the path is still caught', async () => {
    const fx = await mutated('mos-seed-root-writes-data',
      root => rewrite(root, SEED_ROOT, t => `${t}cp -a /usr/share/skel/.bashrc /root/.bashrc\n`))
    try {
      expect(await verdictOf(fx, 'mos-seed-root-writes-data')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('a chown by NAME fails: the owner is part of the on-disk contract', async () => {
    const fx = await mutated('mos-seed-root-writes-data',
      root => rewrite(root, SEED_ROOT, t => t.replace('chown 0:0 /srv/root', 'chown root:root /srv/root')))
    try {
      expect(await messageOf(fx, 'mos-seed-root-writes-data'))
        .toContain('must not be resolved out of the running image\'s /etc/passwd')
    }
    finally {
      fx.dispose()
    }
  })

  test('a seed that creates nothing fails', async () => {
    const fx = await mutated('mos-seed-root-writes-data',
      root => rewrite(root, SEED_ROOT, t => t.replace('mkdir /srv/root\n', '')))
    try {
      expect(await messageOf(fx, 'mos-seed-root-writes-data'))
        .toContain('mos-seed-root does not create /srv/root.')
    }
    finally {
      fx.dispose()
    }
  })

  test('the write pattern does NOT fire on a comment or on /root inside a longer path', () => {
    // Read directly, because both of these are how a false positive would arise
    // and the repair for a false positive is to loosen the check.
    expect(writesUnderRoot('# mkdir /root/.ssh\n')).toBeUndefined()
    expect(writesUnderRoot('mkdir /srv/rootfs\n')).toBeUndefined()
    expect(writesUnderRoot('mkdir /rootcause\n')).toBeUndefined()
    expect(writesUnderRoot('mkdir /root\n')).toBe('1:mkdir /root')
    expect(writesUnderRoot('  chown 0:0 "/root"\n')).toBe('1:  chown 0:0 "/root"')
  })
})

describe('nothing precious is reachable only from /var', () => {
  test('the identity bind absent fails, naming the discardable partition', async () => {
    const fx = await mutated('precious-bind-var-lib-mos', root => rmSync(join(root, VAR_LIB_MOS)))
    try {
      expect(await messageOf(fx, 'precious-bind-var-lib-mos'))
        .toContain('/var/lib/mos holds precious state but var-lib-mos.mount does not exist')
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind not backed by STATE fails', async () => {
    const fx = await mutated('precious-bind-var-lib-mos',
      root => rewrite(root, VAR_LIB_MOS, t => t.replace('What=/mnt/state/mos', 'What=/srv/mos')))
    try {
      expect(await messageOf(fx, 'precious-bind-var-lib-mos'))
        .toContain('var-lib-mos.mount is not backed by STATE (What= must be under /mnt/state)')
    }
    finally {
      fx.dispose()
    }
  })

  test('a Where= with TRAILING WHITESPACE fails: the match is the whole line', async () => {
    // `grep -qx`, not `grep -q`. A unit whose Where= has a stray space mounts
    // a path with a space in it, and a prefix match would call that correct.
    const fx = await mutated('precious-bind-var-lib-mos',
      root => rewrite(root, VAR_LIB_MOS, t => t.replace('Where=/var/lib/mos\n', 'Where=/var/lib/mos \n')))
    try {
      expect(await messageOf(fx, 'precious-bind-var-lib-mos'))
        .toContain('var-lib-mos.mount does not mount /var/lib/mos')
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind present and not enabled fails', async () => {
    const fx = await mutated('precious-bind-var-lib-mos',
      root => rmSync(join(root, WANTS, 'var-lib-mos.mount')))
    try {
      expect(await messageOf(fx, 'precious-bind-var-lib-mos'))
        .toContain('would stay on the discardable /var')
    }
    finally {
      fx.dispose()
    }
  })

  test('the Bluetooth pairing bind fails on the board that HAS a controller', async () => {
    const fx = await mutated('precious-bind-var-lib-bluetooth',
      root => rmSync(join(root, '/etc/systemd/system/var-lib-bluetooth.mount')))
    try {
      expect(await verdictOf(fx, 'precious-bind-var-lib-bluetooth')).toBe('fail')
      expect(await messageOf(fx, 'precious-bind-var-lib-bluetooth'))
        .toContain('/var/lib/bluetooth holds precious state')
    }
    finally {
      fx.dispose()
    }
  })

  test('on a board with no controller the SKIP fires and names the board', async () => {
    const fx = packedRootFixture(x64)
    try {
      const got = await only(fx, 'precious-bind-bluetooth-skipped')
      expect(got.verdict).toBe('skip')
      expect(got.message).toContain('x64 declares no bluetooth in BOARD_RADIOS')
      expect(got.message).toContain('no pairings to keep across an A/B update')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the writable, persistent system unit directory', () => {
  test('the bind absent fails, naming PLAN-011 D5\'s extension model', async () => {
    const fx = await mutated('ext-unit-dir-state-bind', root => rmSync(join(root, EXT_MOUNT)))
    try {
      expect(await messageOf(fx, 'ext-unit-dir-state-bind'))
        .toContain("PLAN-011 D5's whole extension model does not work on the device")
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind not on STATE fails: units would be lost by the next A/B update', async () => {
    const fx = await mutated('ext-unit-dir-state-bind',
      root => rewrite(root, EXT_MOUNT, t => t.replace('What=/mnt/state/systemd-units', 'What=/srv/units')))
    try {
      expect(await messageOf(fx, 'ext-unit-dir-state-bind'))
        .toContain('would be lost by the next A/B update or factory reset')
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind installed and not enabled fails', async () => {
    const fx = await mutated('ext-unit-dir-state-bind',
      root => rmSync(join(root, WANTS, 'usr-local-lib-systemd-system.mount')))
    try {
      expect(await messageOf(fx, 'ext-unit-dir-state-bind'))
        .toContain('installing a unit appears to work and stops working at the next boot')
    }
    finally {
      fx.dispose()
    }
  })

  test('re-pointing the bind at /etc/systemd/system fails BOTH checks', async () => {
    // The change that reads like restoring PLAN-011 D5's original sentence and
    // actually reintroduces the hazard it was corrected for. It has to fail the
    // negative half too, because that is the half nothing else in the image can
    // tell apart from a legitimate change.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'no-bind-over-etc-systemd-system')).toBe('pass')
      rewrite(fx.root, EXT_MOUNT, t =>
        t.replace('Where=/usr/local/lib/systemd/system', 'Where=/etc/systemd/system'))
      expect(await verdictOf(fx, 'ext-unit-dir-state-bind')).toBe('fail')
      expect(await verdictOf(fx, 'no-bind-over-etc-systemd-system')).toBe('fail')
      expect(await messageOf(fx, 'no-bind-over-etc-systemd-system'))
        .toContain('it was rejected on 2026-08-22')
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind over /etc/systemd/system from the WRITABLE unit directory is found', async () => {
    // /usr/local/lib/systemd/system is the one unit directory an operator can
    // write to on a running device, so a unit dropped there is exactly where
    // this would come from, and it is in the searched set for that reason.
    const fx = await mutated('no-bind-over-etc-systemd-system',
      root => write(root, '/usr/local/lib/systemd/system/units.mount',
        '[Mount]\nWhat=/mnt/state/x\nWhere=/etc/systemd/system\n'))
    try {
      expect(await verdictOf(fx, 'no-bind-over-etc-systemd-system')).toBe('fail')
      expect(await messageOf(fx, 'no-bind-over-etc-systemd-system'))
        .toContain('/usr/local/lib/systemd/system/units.mount')
    }
    finally {
      fx.dispose()
    }
  })

  test('a bind over a SUBDIRECTORY of /etc/systemd/system is found too', async () => {
    // `^Where=/etc/systemd/system(/|$)` -- a bind over
    // /etc/systemd/system/multi-user.target.wants hides the enablement of every
    // unit in it, which is the same defect one level down.
    const fx = await mutated('no-bind-over-etc-systemd-system',
      root => write(root, '/etc/systemd/system/wants.mount',
        '[Mount]\nWhat=/mnt/state/w\nWhere=/etc/systemd/system/multi-user.target.wants\n'))
    try {
      expect(await verdictOf(fx, 'no-bind-over-etc-systemd-system')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('a unit whose Where= merely STARTS with the directory name is not a bind over it', async () => {
    // `/etc/systemd/systemd-units` is a different path. The anchor is what
    // separates them, and a false positive here would be repaired by loosening.
    const fx = packedRootFixture(cx3576)
    try {
      write(fx.root, '/etc/systemd/system/other.mount',
        '[Mount]\nWhat=/mnt/state/o\nWhere=/etc/systemd/systemd-units\n')
      expect(await verdictOf(fx, 'no-bind-over-etc-systemd-system')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('the walk does not follow a *.wants SYMLINK into another tree', async () => {
    // `grep -r` follows a link named on the command line and not one found
    // during the walk. A walk that followed would read the same unit twice and
    // report the enablement's path rather than the unit's.
    const fx = packedRootFixture(cx3576)
    try {
      expect(lstatSync(join(fx.root, WANTS, 'home.mount')).isSymbolicLink()).toBe(true)
      expect(await verdictOf(fx, 'no-bind-over-etc-systemd-system')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})
