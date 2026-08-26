// Batch 2a driven from the failing side.
//
// PLAN-014 M4c (RFCT-110), RFCT-096's rule: a ported check lands with the
// fixture that fails it, because the parity harness cannot tell a check that
// PASSES from one that CANNOT FAIL. Both report "agrees with the oracle"
// against a healthy image and only a mutation separates them.
//
// The fixture is a real directory tree -- `packedRootFixture` -- seeded into
// the state that makes every check here green, and every case below is ONE edit
// to it. The baseline is asserted green FIRST in every case, because a fixture
// that fails a check it did not mutate proves nothing about the mutation.
//
// ═══ WHAT THE MUTATIONS ARE CHOSEN TO CATCH ═══
//
// Not "obviously broken". Each is a shape the real failure takes: a file that
// became a SYMLINK when a package moved it, a config line that grew a suffix so
// an anchored pattern stops matching, an enablement symlink that landed in the
// wrong tree, a second kernel's modules shipped beside the live one. A
// hand-written wreck would go red for reasons the real failure does not have.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { ROOT_CHECKS } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))

function checkNamed(id: string): CheckCase {
  const found = ROOT_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no batch-2a check is registered as '${id}'. Registered: `
      + ROOT_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

/**
 * The pass matcher, refused when absent.
 *
 * `ShellMatcher.pass` became optional in M4d for the entries that own a
 * family's SKIP and nothing else. None of the checks this file names is one, so
 * an absent matcher here is a register fault and not a case to tolerate.
 */
function passMatcher(id: string): string {
  const m = checkNamed(id).shell.pass
  if (m === undefined) {
    throw new Error(
      `'${id}' registers no pass matcher. Since M4d that is legal only for a check that owns a SKIP `
      + `line and nothing else, and this one is compared against a PASS line.`,
    )
  }
  return m
}

async function verdictOf(fx: RootFixture, id: string): Promise<Verdict> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  return (got[0] as CheckResult).verdict
}

async function messageOf(fx: RootFixture, id: string): Promise<string> {
  const got = await checkNamed(id).run(fx.ctx)
  return (got[0] as CheckResult).message
}

/**
 * Seed a fixture, assert the check is GREEN on it, run `mutate`, hand it back.
 *
 * The green assertion is the half that makes the red one mean something: a
 * fixture that was already failing would report the same red after any edit at
 * all, including one that changed nothing.
 */
async function mutated(id: string, mutate: (root: string) => void): Promise<RootFixture> {
  const fx = packedRootFixture(cx3576)
  expect(await verdictOf(fx, id)).toBe('pass')
  mutate(fx.root)
  return fx
}

/** The whole register's verdicts against one tree, by id. */
async function allVerdicts(fx: RootFixture): Promise<Map<string, Verdict[]>> {
  const out = new Map<string, Verdict[]>()
  for (const c of ROOT_CHECKS) {
    const got = await c.run(fx.ctx)
    out.set(c.id, got.map(r => r.verdict))
  }
  return out
}

describe('the healthy packed root', () => {
  test('every batch-2a check PASSES on the unmutated fixture', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const verdicts = await allVerdicts(fx)
      const red = [...verdicts].filter(([, v]) => v.some(x => x !== 'pass')).map(([id]) => id)
      expect(red).toEqual([])
      // Not a count: the register's own size, so a check deleted from
      // ROOT_CHECKS cannot make this pass by having nothing left to run.
      expect(verdicts.size).toBe(ROOT_CHECKS.length)
      expect(verdicts.size).toBeGreaterThan(40)
    }
    finally {
      fx.dispose()
    }
  })

  test('each check concludes EXACTLY ONCE -- none of batch 2a is `many`', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      for (const c of ROOT_CHECKS) {
        expect({ id: c.id, n: (await c.run(fx.ctx)).length }).toEqual({ id: c.id, n: 1 })
        expect(c.cardinality ?? 'one').toBe('one')
      }
    }
    finally {
      fx.dispose()
    }
  })
})

describe('sq_regular -- a path is a regular file, and not a link to one', () => {
  test('the file is GONE', async () => {
    const fx = await mutated('packed-regular/usr/bin/rauc', root => rmSync(join(root, 'usr/bin/rauc')))
    try {
      expect(await verdictOf(fx, 'packed-regular/usr/bin/rauc')).toBe('fail')
      expect(await messageOf(fx, 'packed-regular/usr/bin/rauc'))
        .toBe('/usr/bin/rauc missing or not a regular file')
      // ONE check, not the family: /usr/bin/mosd beside it is untouched.
      expect(await verdictOf(fx, 'packed-regular/usr/bin/mosd')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('the file became a SYMLINK to a regular file -- `-f` alone would pass this', async () => {
    // The half of `[ -f X ] && [ ! -L X ]` that a naive port drops. This is
    // what a package moving a binary and leaving a compatibility link looks
    // like, and the whole point of the assertion is that the packed root ships
    // the file rather than a pointer at one.
    const fx = await mutated('packed-regular/usr/bin/rauc', (root) => {
      writeFileSync(join(root, 'usr/bin/rauc.real'), 'x\n')
      rmSync(join(root, 'usr/bin/rauc'))
      symlinkSync('rauc.real', join(root, 'usr/bin/rauc'))
    })
    try {
      expect(await verdictOf(fx, 'packed-regular/usr/bin/rauc')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the path became a DIRECTORY', async () => {
    const fx = await mutated('packed-regular/etc/rauc/system.conf', (root) => {
      rmSync(join(root, 'etc/rauc/system.conf'))
      mkdirSync(join(root, 'etc/rauc/system.conf'))
    })
    try {
      expect(await verdictOf(fx, 'packed-regular/etc/rauc/system.conf')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('a DANGLING symlink -- present to readdir, absent to every reader', async () => {
    const fx = await mutated('packed-regular/usr/lib/mos/mos-health', (root) => {
      rmSync(join(root, 'usr/lib/mos/mos-health'))
      symlinkSync('/nowhere/mos-health', join(root, 'usr/lib/mos/mos-health'))
    })
    try {
      expect(await verdictOf(fx, 'packed-regular/usr/lib/mos/mos-health')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('every path in the family is registered under its own id, and no two share one', () => {
    const ids = ROOT_CHECKS.filter(c => c.id.startsWith('packed-regular')).map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(26)
    // The matcher CARRIES THE PATH, which is what keeps this family from
    // colliding with M4d's board-conditional sq_regular calls: a `many` check
    // claiming ' is a regular file' would claim the radio firmware and hostapd
    // too, and M4d could not repair that by landing later.
    for (const id of ids) {
      const c = checkNamed(id)
      expect(c.shell.pass).toContain(id.slice('packed-regular'.length))
      expect(c.shell.pass).not.toBe(' is a regular file')
    }
  })
})

describe('sq_grep -- a file in the packed root matches a pattern', () => {
  test('the matching line is GONE', async () => {
    const fx = await mutated('packed-grep-dhcp', root =>
      writeFileSync(join(root, 'etc/systemd/network/80-dhcp.network'), '[Network]\n'))
    try {
      expect(await verdictOf(fx, 'packed-grep-dhcp')).toBe('fail')
      expect(await messageOf(fx, 'packed-grep-dhcp')).toContain('missing or does not match')
      // The fail line CARRIES the pass matcher, which is why no separate fail
      // matcher is registered -- assert it rather than trusting it.
      expect(await messageOf(fx, 'packed-grep-dhcp'))
        .toContain(passMatcher('packed-grep-dhcp'))
    }
    finally {
      fx.dispose()
    }
  })

  test('the file is GONE entirely', async () => {
    const fx = await mutated('packed-grep-tmpfiles-var-tmp', root =>
      rmSync(join(root, 'etc/tmpfiles.d/mos-var.conf')))
    try {
      expect(await verdictOf(fx, 'packed-grep-tmpfiles-var-tmp')).toBe('fail')
      // Both assertions over that one file go red, and only those two.
      expect(await verdictOf(fx, 'packed-grep-tmpfiles-var-cache')).toBe('fail')
      expect(await verdictOf(fx, 'packed-grep-dhcp')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('an ANCHORED pattern stops matching when the line grows a suffix', async () => {
    // `^Storage=volatile$`. A journald.conf.d drop-in that said
    // `Storage=volatile-something` would satisfy an unanchored search and put
    // the journal back on the fixed-size /var. Line-wise, not whole-text: the
    // difference is invisible on a healthy file and decisive on this one.
    const fx = await mutated('packed-grep-journald-volatile', root =>
      writeFileSync(join(root, 'etc/systemd/journald.conf.d/00-volatile.conf'),
        '[Journal]\nStorage=volatile-but-not-really\n'))
    try {
      expect(await verdictOf(fx, 'packed-grep-journald-volatile')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('an anchored pattern is not satisfied by a longer LINE containing it', async () => {
    // The same anchor from the other side: `# Storage=volatile` is a comment,
    // and a whole-text regex with `m` off would match it.
    const fx = await mutated('packed-grep-shadow-reconcile-exec', root =>
      writeFileSync(join(root, 'etc/systemd/system/mos-shadow-reconcile.service'),
        '[Service]\n# ExecStart=/usr/lib/mos/mos-shadow-reconcile\nExecStart=/bin/true\n'))
    try {
      expect(await verdictOf(fx, 'packed-grep-shadow-reconcile-exec')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('two checks over ONE file go red independently', async () => {
    // apid.service carries both After= and StateDirectory=. Dropping one must
    // not take the other with it, or the two assertions are really one.
    const fx = await mutated('packed-grep-apid-after-mosd', root =>
      writeFileSync(join(root, 'usr/lib/systemd/system/apid.service'),
        '[Unit]\n[Service]\nStateDirectory=mos/apid\n'))
    try {
      expect(await verdictOf(fx, 'packed-grep-apid-after-mosd')).toBe('fail')
      expect(await verdictOf(fx, 'packed-grep-apid-statedir')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('the mosd D-Bus policy that grants nothing -- as good as no policy at all', async () => {
    // A policy file that does not grant `own` is INERT: the daemon starts,
    // fails to take its name, and every client call errors.
    const fx = await mutated('packed-grep-mosd-policy-own', root =>
      writeFileSync(join(root, 'usr/share/dbus-1/system.d/com.mos.mosd.conf'),
        '<busconfig>\n<policy user="root">\n<allow send_destination="com.mos.mosd"/>\n'
        + '</policy>\n</busconfig>\n'))
    try {
      expect(await verdictOf(fx, 'packed-grep-mosd-policy-own')).toBe('fail')
      // The file is still a regular file, so THAT assertion stays green: the
      // two questions about one path are asked separately on purpose.
      expect(await verdictOf(fx, 'packed-regular/usr/share/dbus-1/system.d/com.mos.mosd.conf'))
        .toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('sq_enabled -- a unit is enabled by a *.wants symlink', () => {
  test('the enablement symlink is GONE', async () => {
    const fx = await mutated('packed-enabled-mosd.service', root =>
      rmSync(join(root, 'etc/systemd/system/multi-user.target.wants/mosd.service')))
    try {
      expect(await verdictOf(fx, 'packed-enabled-mosd.service')).toBe('fail')
      expect(await messageOf(fx, 'packed-enabled-mosd.service'))
        .toContain('mosd.service enablement symlink missing')
      expect(await verdictOf(fx, 'packed-enabled-apid.service')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('the unit file is there but NOT under a *.wants directory', async () => {
    // `-path '*.wants/*'` is the half that matters: /etc/systemd/system/foo.service
    // is a unit OVERRIDE, not an enablement, and a search that dropped the path
    // filter would call an overridden-but-disabled unit enabled.
    const fx = await mutated('packed-enabled-fstrim.timer', (root) => {
      rmSync(join(root, 'etc/systemd/system/timers.target.wants/fstrim.timer'))
      writeFileSync(join(root, 'etc/systemd/system/fstrim.timer'), 'x\n')
    })
    try {
      expect(await verdictOf(fx, 'packed-enabled-fstrim.timer')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('sq_enabled does NOT accept a vendor-tree enablement', async () => {
    // The distinction between the two helpers, driven. mosd is a mos unit and
    // is enabled under /etc; moving its link into the vendor tree must go red,
    // or sq_enabled and sq_enabled_any are the same function.
    const fx = await mutated('packed-enabled-mosd.service', (root) => {
      rmSync(join(root, 'etc/systemd/system/multi-user.target.wants/mosd.service'))
      const dir = join(root, 'usr/lib/systemd/system/multi-user.target.wants')
      mkdirSync(dir, { recursive: true })
      symlinkSync('/usr/lib/systemd/system/mosd.service', join(dir, 'mosd.service'))
    })
    try {
      expect(await verdictOf(fx, 'packed-enabled-mosd.service')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('sq_enabled_any DOES accept one, and still refuses none', async () => {
    // The other direction, and the reason the second helper exists: repart is a
    // DISTRO unit, statically enabled by a symlink the vendor ships. The
    // baseline has it under /usr/lib only -- so the green above already proves
    // acceptance -- and removing it must still go red.
    const fx = await mutated('packed-enabled-systemd-repart.service', root =>
      rmSync(join(root, 'usr/lib/systemd/system/initrd-root-fs.target.wants/systemd-repart.service')))
    try {
      expect(await verdictOf(fx, 'packed-enabled-systemd-repart.service')).toBe('fail')
      expect(await messageOf(fx, 'packed-enabled-systemd-repart.service'))
        .toContain('/etc or /usr/lib systemd trees')
    }
    finally {
      fx.dispose()
    }
  })

  test('the PATH the oracle prints is the path that was found', async () => {
    // The message is not decoration: it is how a reader learns which target
    // pulls the unit in. A port that printed a path it did not find would agree
    // with the oracle on the verdict and lie in the sentence beside it.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await messageOf(fx, 'packed-enabled-mosd.service'))
        .toBe('mosd.service is enabled (/etc/systemd/system/multi-user.target.wants/mosd.service)')
      expect(await messageOf(fx, 'packed-enabled-systemd-tmpfiles-clean.timer'))
        .toContain('/usr/lib/systemd/system/timers.target.wants/')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the kernel modules', () => {
  test('a SECOND kernel shipped beside the live one', async () => {
    // The property is "exactly one", not a version. Two entries means a stale
    // set shipped beside the live one -- which is how a kernel bump half-lands.
    const fx = await mutated('packed-modules-exactly-one', root =>
      mkdirSync(join(root, 'usr/lib/modules/6.1.116'), { recursive: true }))
    try {
      expect(await verdictOf(fx, 'packed-modules-exactly-one')).toBe('fail')
      expect(await messageOf(fx, 'packed-modules-exactly-one')).toContain('expected exactly one')
    }
    finally {
      fx.dispose()
    }
  })

  test('NO modules at all -- and the check does not read that as "exactly one"', async () => {
    const fx = await mutated('packed-modules-exactly-one', root =>
      rmSync(join(root, 'usr/lib/modules'), { recursive: true }))
    try {
      expect(await verdictOf(fx, 'packed-modules-exactly-one')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the version is READ from the tree, so modules.dep follows a kernel bump', async () => {
    // Not a literal. The oracle pinned 6.1.115 once and the x64 image -- on
    // Debian's 6.12.101+deb13-amd64, which is correct for it -- failed for
    // saying so. Renaming the directory must keep BOTH checks green.
    const fx = packedRootFixture(cx3576)
    try {
      renameSync(join(fx.root, 'usr/lib/modules/6.1.115'),
        join(fx.root, 'usr/lib/modules/6.12.101+deb13-amd64'))
      expect(await verdictOf(fx, 'packed-modules-exactly-one')).toBe('pass')
      expect(await verdictOf(fx, 'packed-modules-dep')).toBe('pass')
      expect(await messageOf(fx, 'packed-modules-dep'))
        .toBe('/usr/lib/modules/6.12.101+deb13-amd64/modules.dep is a regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('modules.dep missing from the one kernel that IS there', async () => {
    const fx = await mutated('packed-modules-dep', root =>
      rmSync(join(root, 'usr/lib/modules/6.1.115/modules.dep')))
    try {
      expect(await verdictOf(fx, 'packed-modules-dep')).toBe('fail')
      // The count check is about a different fact and stays green.
      expect(await verdictOf(fx, 'packed-modules-exactly-one')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('the matcher is NOT ` contains `, which claims fourteen lines on cx3576', () => {
    // M4b measured the collision and left it; this is the batch that has to not
    // step in it. The registered matcher names one line.
    const pass = passMatcher('packed-modules-exactly-one')
    expect(pass).toBe("/usr/lib/modules contains exactly one kernel's modules")
    expect(pass.length).toBeGreaterThan(' contains '.length)
    expect('BOOT-A contains Image').not.toContain(pass)
    expect('BOOT-A contains no initramfs file').not.toContain(pass)
  })
})

describe('sq_symlink -- /etc/resolv.conf points at the stub', () => {
  test('it is a REGULAR FILE, not a symlink at all', async () => {
    const fx = await mutated('packed-resolv-conf-symlink', (root) => {
      rmSync(join(root, 'etc/resolv.conf'))
      writeFileSync(join(root, 'etc/resolv.conf'), 'nameserver 1.1.1.1\n')
    })
    try {
      expect(await verdictOf(fx, 'packed-resolv-conf-symlink')).toBe('fail')
      expect(await messageOf(fx, 'packed-resolv-conf-symlink'))
        .toBe('/etc/resolv.conf missing or not a symlink')
    }
    finally {
      fx.dispose()
    }
  })

  test('it is a symlink to the WRONG target', async () => {
    const fx = await mutated('packed-resolv-conf-symlink', (root) => {
      rmSync(join(root, 'etc/resolv.conf'))
      symlinkSync('../run/systemd/resolve/resolv.conf', join(root, 'etc/resolv.conf'))
    })
    try {
      expect(await verdictOf(fx, 'packed-resolv-conf-symlink')).toBe('fail')
      expect(await messageOf(fx, 'packed-resolv-conf-symlink')).toContain('expected stub-resolv.conf')
    }
    finally {
      fx.dispose()
    }
  })

  test('a BARE basename target is accepted, as the oracle accepts it', async () => {
    // `case "${dest}" in "${target}" | */"${target}")`. Two forms, both valid;
    // a port that only accepted the path form would fail a correct image.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, 'etc/resolv.conf'))
      symlinkSync('stub-resolv.conf', join(fx.root, 'etc/resolv.conf'))
      expect(await verdictOf(fx, 'packed-resolv-conf-symlink')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('a target ENDING in the basename but not at a path boundary is refused', async () => {
    // `*/stub-resolv.conf`, not `*stub-resolv.conf`. `my-stub-resolv.conf` is a
    // different file and an `endsWith` without the slash would take it.
    const fx = await mutated('packed-resolv-conf-symlink', (root) => {
      rmSync(join(root, 'etc/resolv.conf'))
      symlinkSync('../run/systemd/resolve/my-stub-resolv.conf', join(root, 'etc/resolv.conf'))
    })
    try {
      expect(await verdictOf(fx, 'packed-resolv-conf-symlink')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('BOTH failure messages are claimed by the registered fail matcher', () => {
    // The two directions of the failure share only the path, so the path IS the
    // fail matcher. Asserted here because a matcher that claimed one message
    // and not the other would leave the other `not-ported` at the exact moment
    // the check went red.
    const c = checkNamed('packed-resolv-conf-symlink')
    const fail = c.shell.fail as string
    expect("/etc/resolv.conf is a symlink to 'x', expected stub-resolv.conf").toContain(fail)
    expect('/etc/resolv.conf missing or not a symlink').toContain(fail)
  })
})

describe('the mountpoints a verity root cannot create at runtime', () => {
  test('one directory is MISSING', async () => {
    const fx = await mutated('packed-mountpoints-exist', root =>
      rmSync(join(root, 'srv'), { recursive: true }))
    try {
      expect(await verdictOf(fx, 'packed-mountpoints-exist')).toBe('fail')
      expect(await messageOf(fx, 'packed-mountpoints-exist')).toContain('/srv')
    }
    finally {
      fx.dispose()
    }
  })

  test('a mountpoint exists but is a FILE', async () => {
    // `[ -d ]`, not `[ -e ]`. A file at the mountpoint fails the mount just as
    // an absence does, and the two are indistinguishable in an existence test.
    const fx = await mutated('packed-mountpoints-exist', (root) => {
      rmSync(join(root, 'etc/containers/systemd'), { recursive: true })
      writeFileSync(join(root, 'etc/containers/systemd'), '')
    })
    try {
      expect(await verdictOf(fx, 'packed-mountpoints-exist')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the message NAMES every missing one, not just the first', async () => {
    const fx = await mutated('packed-mountpoints-exist', (root) => {
      rmSync(join(root, 'home'), { recursive: true })
      rmSync(join(root, 'root'), { recursive: true })
    })
    try {
      const msg = await messageOf(fx, 'packed-mountpoints-exist')
      expect(msg).toContain('/home')
      expect(msg).toContain('/root')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the built-in escape, as an on-image fact', () => {
  test('the reserved prefix has grown an on-disk half', async () => {
    const fx = await mutated('packed-builtin-no-on-disk-half', (root) => {
      mkdirSync(join(root, 'builtin'), { recursive: true })
      writeFileSync(join(root, 'builtin/index.html'), '<html>\n')
    })
    try {
      expect(await verdictOf(fx, 'packed-builtin-no-on-disk-half')).toBe('fail')
      expect(await messageOf(fx, 'packed-builtin-no-on-disk-half')).toContain('/builtin/index.html')
    }
    finally {
      fx.dispose()
    }
  })

  test('an EMPTY /builtin directory is still a second artifact', async () => {
    // The oracle's `[ -n "${shipped}" ] || shipped="${BUILTIN_PREFIX} "` -- the
    // directory itself counts even when find lists nothing under it. A port
    // that reported only its CONTENTS would pass an empty one.
    const fx = await mutated('packed-builtin-no-on-disk-half', root =>
      mkdirSync(join(root, 'builtin')))
    try {
      expect(await verdictOf(fx, 'packed-builtin-no-on-disk-half')).toBe('fail')
      expect(await messageOf(fx, 'packed-builtin-no-on-disk-half')).toContain('/builtin')
    }
    finally {
      fx.dispose()
    }
  })

  test('a SYMLINK at the reserved prefix', async () => {
    // `[ -e ] || [ -L ]`: a dangling link fails -e and is caught by -L. It is
    // still a namesake in the tree.
    const fx = await mutated('packed-builtin-no-on-disk-half', root =>
      symlinkSync('/nowhere', join(root, 'builtin')))
    try {
      expect(await verdictOf(fx, 'packed-builtin-no-on-disk-half')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the page has LEFT the binary', async () => {
    // The image-side reading of "no include_str!, no include_bytes!, no asset
    // directory": the outcome is asserted, not the mechanism.
    const fx = await mutated('packed-builtin-in-binary', root =>
      writeFileSync(join(root, 'usr/bin/apid'), 'ELF ... nothing rendered here ...\n'))
    try {
      expect(await verdictOf(fx, 'packed-builtin-in-binary')).toBe('fail')
      expect(await messageOf(fx, 'packed-builtin-in-binary')).toContain('does NOT carry')
    }
    finally {
      fx.dispose()
    }
  })

  test('the ROUTE CONSTANT alone is not the markup', async () => {
    // Why the constant is markup and not "/builtin/deactivate": the bare route
    // would still be in the binary after the pages moved out to an asset tree,
    // which is the one change this check exists to catch.
    const fx = await mutated('packed-builtin-in-binary', root =>
      writeFileSync(join(root, 'usr/bin/apid'), 'ELF ... /builtin/deactivate ... trailer\n'))
    try {
      expect(await verdictOf(fx, 'packed-builtin-in-binary')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('apid is GONE -- reported as "nothing could serve it", not as missing markup', async () => {
    const fx = await mutated('packed-builtin-in-binary', root =>
      rmSync(join(root, 'usr/bin/apid')))
    try {
      expect(await verdictOf(fx, 'packed-builtin-in-binary')).toBe('fail')
      expect(await messageOf(fx, 'packed-builtin-in-binary'))
        .toContain('is not a regular file in the packed root')
    }
    finally {
      fx.dispose()
    }
  })

  test('the markup is read out of the ORACLE, so the two cannot drift', () => {
    // The fixture seeds apid with a constant taken from os/verify-image-v2.sh
    // rather than retyped here. If the oracle's BUILTIN_MARKUP changed and this
    // file's copy did not, the check would go red against a correct image --
    // and the failure would point at the image rather than at the constant.
    const oracle = readFileSync(join(dirname(boardEnvPath('cx3576')), '..', '..', 'verify-image-v2.sh'), 'utf8')
    expect(oracle).toContain("BUILTIN_MARKUP='<form method=\"post\" action=\"/builtin/deactivate\">'")
  })
})

describe('the development keyring, which must not be baked in', () => {
  test('a keyring IS shipped', async () => {
    // A keyring inside the signed read-only root is a trusted signer on every
    // device flashed with this image.
    const fx = await mutated('packed-no-dev-keyring', root =>
      writeFileSync(join(root, 'etc/rauc/keyring.pem'), '-----BEGIN CERTIFICATE-----\n'))
    try {
      expect(await verdictOf(fx, 'packed-no-dev-keyring')).toBe('fail')
      expect(await messageOf(fx, 'packed-no-dev-keyring')).toContain('the packed root ships')
    }
    finally {
      fx.dispose()
    }
  })

  test('MOS_EXPECT_DEV_KEYRING=1 waves it through, exactly as the oracle does', async () => {
    // The escape is PORTED and not dropped. Leaving it out would make this port
    // stricter than the oracle on precisely the images somebody sets it for --
    // a divergence introduced by the port, which is the thing a port may not do.
    const fx = packedRootFixture(cx3576)
    const before = process.env['MOS_EXPECT_DEV_KEYRING']
    try {
      writeFileSync(join(fx.root, 'etc/rauc/keyring.pem'), '-----BEGIN CERTIFICATE-----\n')
      expect(await verdictOf(fx, 'packed-no-dev-keyring')).toBe('fail')
      process.env['MOS_EXPECT_DEV_KEYRING'] = '1'
      expect(await verdictOf(fx, 'packed-no-dev-keyring')).toBe('pass')
      expect(await messageOf(fx, 'packed-no-dev-keyring')).toContain('explicitly expected')
      // ...and only the exact value 1, not any truthy string.
      process.env['MOS_EXPECT_DEV_KEYRING'] = 'yes'
      expect(await verdictOf(fx, 'packed-no-dev-keyring')).toBe('fail')
    }
    finally {
      if (before === undefined) delete process.env['MOS_EXPECT_DEV_KEYRING']
      else process.env['MOS_EXPECT_DEV_KEYRING'] = before
      fx.dispose()
    }
  })

  test('a DANGLING keyring symlink still counts as shipped', async () => {
    // `[ ! -e ] && [ ! -L ]`: absence has to fail both. A link with nothing at
    // the other end is still a keyring path in the signed root.
    const fx = await mutated('packed-no-dev-keyring', root =>
      symlinkSync('/nowhere/keyring.pem', join(root, 'etc/rauc/keyring.pem')))
    try {
      expect(await verdictOf(fx, 'packed-no-dev-keyring')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the vacuity traps', () => {
  test('an EMPTY unpacked root is REFUSED, not answered', async () => {
    // A listing of nothing makes every "is X absent?" check pass -- and three
    // of the checks above are exactly that shape. M4a's squashfsList and
    // ext4List already refuse an empty listing; this is the same guard at the
    // directory the checks read. It is a THROW because "unsquashfs produced an
    // empty tree" is a statement about the RUN, not about the image.
    const fx = packedRootFixture(cx3576)
    try {
      for (const e of ['etc', 'usr', 'mnt', 'srv', 'var', 'home', 'root']) {
        rmSync(join(fx.root, e), { recursive: true, force: true })
      }
      await expect(checkNamed('packed-builtin-no-on-disk-half').run(fx.ctx))
        .rejects.toThrow(/is empty/)
      await expect(checkNamed('packed-no-dev-keyring').run(fx.ctx))
        .rejects.toThrow(/is empty/)
      await expect(checkNamed('packed-mountpoints-exist').run(fx.ctx))
        .rejects.toThrow(/is empty/)
    }
    finally {
      fx.dispose()
    }
  })

  test('an unpack that THROWS is the one place a throw becomes a fail', async () => {
    // Everywhere else a check that cannot decide throws, because "unsquashfs
    // would not run" is not a statement about the image. Here it is exactly
    // that statement, and the oracle spells it as a FAIL.
    const fx = packedRootFixture(cx3576)
    try {
      const broken = {
        ...fx.ctx,
        unpackRoot: async (): Promise<string> => {
          throw new Error('unsquashfs: this is not a squashfs')
        },
      }
      const got = await checkNamed('packed-root-unpacks').run(broken)
      expect(got.length).toBe(1)
      expect((got[0] as CheckResult).verdict).toBe('fail')
      expect((got[0] as CheckResult).message).toContain('ROOTFS-A squashfs failed to unpack')
    }
    finally {
      fx.dispose()
    }
  })
})
