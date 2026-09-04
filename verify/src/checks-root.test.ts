// The packed-root families, driven from the failing side.
//
// Every check lands with the fixture that fails it, because the parity harness
// cannot tell a check that PASSES from one that CANNOT FAIL: both report
// "agrees with the oracle" against a healthy image, and only a mutation
// separates them.
//
// The fixture is a real directory tree -- `packedRootFixture` -- seeded into
// the state that makes every check here green, and every case below is ONE edit
// to it. The baseline is asserted green FIRST in every case, because a fixture
// that fails a check it did not mutate proves nothing about the mutation.
//
// The mutations are not "obviously broken". Each is a shape the real failure
// takes: a file that
// became a SYMLINK when a package moved it, a config line that grew a suffix so
// an anchored pattern stops matching, an enablement symlink that landed in the
// wrong tree, a second kernel's modules shipped beside the live one. A
// hand-written wreck would go red for reasons the real failure does not have.

import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { BAKED_MANIFEST_PATH, FIXTURE_BUILTIN_MARKUP, FIXTURE_CA_CERT, packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { BUILTIN_MARKUP, ROOT_CHECKS } from './checks-root.ts'
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
  if (typeof m !== 'string') {
    throw new Error(
      `'${id}' registers no single-string pass matcher. Since M4d a matcher may be absent -- for a `
      + `check that owns a SKIP line and nothing else -- or a LIST of alternative spellings. This `
      + `check is compared against one PASS line and should register one substring.`,
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
    expect(ids.length).toBe(25)
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
    // Why the constant is markup and not "/_ui/assets/": the bare asset prefix
    // would still be in the binary (the asset route registers it) after
    // index.html moved out to an asset tree, which is the one change this
    // check exists to catch.
    const fx = await mutated('packed-builtin-in-binary', root =>
      writeFileSync(join(root, 'usr/bin/apid'), 'ELF ... /_ui/assets/ ... trailer\n'))
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

  test('the two surviving copies of the markup cannot drift apart', () => {
    // There is no third source for this markup, so the two copies keep each
    // other honest: checks-fixture.ts seeds apid from its own literal and
    // checks-root.ts greps for its own, and if either is edited alone the check
    // goes red against a correct image.
    expect(FIXTURE_BUILTIN_MARKUP).toBe(BUILTIN_MARKUP)
    // ...and the value itself, transcribed once more here, so that an edit
    // which moved BOTH copies together still has to face a third statement of
    // what the built-in UI's embedded index.html actually says.
    expect(BUILTIN_MARKUP).toBe('<script type="module" crossorigin src="/_ui/assets/index-')
  })
})

describe('the shipped bill of materials', () => {
  test('the fixture manifest passes, counting both totals', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-mos-manifest')).toBe('pass')
      expect(await messageOf(fx, 'packed-mos-manifest')).toContain('6 package(s), 3 of them mos')
    }
    finally {
      fx.dispose()
    }
  })

  test('an image without the manifest fails: the purge leaves no other record', async () => {
    const fx = await mutated('packed-mos-manifest', root =>
      rmSync(join(root, 'usr/share/mos/manifest.tsv')))
    try {
      expect(await verdictOf(fx, 'packed-mos-manifest')).toBe('fail')
      expect(await messageOf(fx, 'packed-mos-manifest')).toContain('is not a regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('two git stamps among the mos rows fail: a half-rebuilt pool composed this image', async () => {
    const fx = await mutated('packed-mos-manifest', root =>
      appendFileSync(join(root, 'usr/share/mos/manifest.tsv'),
        'mos-rauc\t1.13+gitffffffffffff-1\tamd64\n'))
    try {
      expect(await verdictOf(fx, 'packed-mos-manifest')).toBe('fail')
      expect(await messageOf(fx, 'packed-mos-manifest')).toContain('2 git stamp(s)')
    }
    finally {
      fx.dispose()
    }
  })

  test('a manifest of only Debian rows fails: the mos set is what composition installs', async () => {
    const fx = await mutated('packed-mos-manifest', root =>
      writeFileSync(join(root, 'usr/share/mos/manifest.tsv'),
        '#package\tversion\tarchitecture\nlibc6\t2.41-12\tamd64\n'))
    try {
      expect(await verdictOf(fx, 'packed-mos-manifest')).toBe('fail')
      expect(await messageOf(fx, 'packed-mos-manifest')).toContain('0 of them are mos')
    }
    finally {
      fx.dispose()
    }
  })

  test('a row that is not three tab-separated fields fails, named', async () => {
    const fx = await mutated('packed-mos-manifest', root =>
      appendFileSync(join(root, 'usr/share/mos/manifest.tsv'), 'mos-broken 1.0 amd64\n'))
    try {
      expect(await verdictOf(fx, 'packed-mos-manifest')).toBe('fail')
      expect(await messageOf(fx, 'packed-mos-manifest')).toContain('mos-broken 1.0 amd64')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the shipped keyring, which must be the one from meta/', () => {
  // The fixture is PRODUCTION-shaped: its meta/ holds the material and no
  // GENERATED marker, and the packed root ships a byte-equal copy. That is the
  // released state -- an image trusting the CA its bundles are signed with --
  // so it is the baseline every mutation below departs from.

  test('POSITIVE CONTROL: production material and matching bytes: pass', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-keyring-from-meta')).toBe('pass')
      expect(await messageOf(fx, 'packed-keyring-from-meta')).toContain('no GENERATED marker')
    }
    finally {
      fx.dispose()
    }
  })

  test('a keyring whose BYTES are not meta/rauc/ca.cert.pem is refused', async () => {
    // The shape this catches: a CA that reached the image some other way -- left
    // in the overlay, written by a stage, edited after the build. It is still a
    // trusted signer on every device flashed with the image, and nobody chose it.
    const fx = await mutated('packed-keyring-from-meta', root =>
      writeFileSync(join(root, 'etc/rauc/keyring.pem'), '-----BEGIN CERTIFICATE-----\nsomebody else\n'))
    try {
      expect(await verdictOf(fx, 'packed-keyring-from-meta')).toBe('fail')
      expect(await messageOf(fx, 'packed-keyring-from-meta')).toContain('the bytes differ')
    }
    finally {
      fx.dispose()
    }
  })

  test('a keyring that is not shipped AT ALL is refused', async () => {
    // The direction that inverted: absence used to be the shipped state. Every
    // image stages one from meta/ now, so an image without one verifies nothing
    // and `rauc install` fails closed on it forever.
    const fx = await mutated('packed-keyring-from-meta', root =>
      rmSync(join(root, 'etc/rauc/keyring.pem')))
    try {
      expect(await verdictOf(fx, 'packed-keyring-from-meta')).toBe('fail')
      expect(await messageOf(fx, 'packed-keyring-from-meta')).toContain('ships no /etc/rauc/keyring.pem at all')
    }
    finally {
      fx.dispose()
    }
  })

  test('a DANGLING keyring symlink is shipped-but-unreadable, and gets its own sentence', async () => {
    // A link with nothing at the other end is still a keyring path in the
    // signed root, so it is not the absence case; it also cannot be compared,
    // so it is not the byte case. The two facts get different sentences because
    // the fixes differ.
    const fx = await mutated('packed-keyring-from-meta', (root) => {
      rmSync(join(root, 'etc/rauc/keyring.pem'))
      symlinkSync('/nowhere/keyring.pem', join(root, 'etc/rauc/keyring.pem'))
    })
    try {
      expect(await verdictOf(fx, 'packed-keyring-from-meta')).toBe('fail')
      expect(await messageOf(fx, 'packed-keyring-from-meta')).toContain('dangling symlink')
    }
    finally {
      fx.dispose()
    }
  })

  test('meta/GENERATED names the SAME bytes development-grade, and says so instead of refusing', async () => {
    // Nothing about the image changes here -- the keyring is byte-identical to
    // the production case above. What changes is the marker beside the trust
    // root: it says the CA whose bundles this image will install has an
    // unprotected key in a working tree, and it keeps saying it on every later
    // build.
    //
    // Both readings PASS, and the message is the whole difference. Dev and
    // production reach the image by one path through meta/, and which material is
    // there is chosen before the build; a verifier that refused one of them
    // would be a build-time switch wearing a verifier's clothes. What this
    // asserts is that the verdict cannot be read as production when it is not.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-keyring-from-meta')).toBe('pass')
      expect(await messageOf(fx, 'packed-keyring-from-meta')).not.toContain('DEVELOPMENT-GRADE')

      writeFileSync(join(fx.ctx.metaDir, 'GENERATED'), 'auto-generated development trust root\n')
      expect(await verdictOf(fx, 'packed-keyring-from-meta')).toBe('pass')
      const marked = await messageOf(fx, 'packed-keyring-from-meta')
      expect(marked).toContain('DEVELOPMENT-GRADE')
      expect(marked).not.toContain('no GENERATED marker')
    }
    finally {
      fx.dispose()
    }
  })

  test('a development marker does NOT excuse a keyring that came from somewhere else', async () => {
    // The marker says which material meta/ holds. It says nothing about whether
    // the image ships that material, and the byte comparison is the one
    // property this check exists for: it must survive the marker being there.
    const fx = packedRootFixture(cx3576)
    try {
      writeFileSync(join(fx.ctx.metaDir, 'GENERATED'), 'auto-generated development trust root\n')
      writeFileSync(join(fx.root, 'etc/rauc/keyring.pem'), '-----BEGIN CERTIFICATE-----\nsomebody else\n')
      expect(await verdictOf(fx, 'packed-keyring-from-meta')).toBe('fail')
      expect(await messageOf(fx, 'packed-keyring-from-meta')).toContain('the bytes differ')
    }
    finally {
      fx.dispose()
    }
  })

  test('a tree with NO meta/rauc/ca.cert.pem is REFUSED, not answered', async () => {
    // The vacuity trap on the other input. With nothing to compare against, a
    // `pass` would be green about an image nobody checked -- on every host that
    // has not built one. It is a THROW because "this tree has no trust root" is
    // a statement about the RUN, not about the image.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.ctx.metaDir, 'rauc', 'ca.cert.pem'))
      await expect(checkNamed('packed-keyring-from-meta').run(fx.ctx))
        .rejects.toThrow(/nothing to compare/)
    }
    finally {
      fx.dispose()
    }
  })

  test('the fixture root and the fixture meta/ carry the SAME bytes', async () => {
    // The baseline is a pass because two files agree, so the test suite asserts
    // they do rather than trusting the seeder. A fixture that seeded two
    // different strings would make every case above red for a reason none of
    // them is about.
    const fx = packedRootFixture(cx3576)
    try {
      expect(readFileSync(join(fx.root, 'etc/rauc/keyring.pem'), 'utf8')).toBe(FIXTURE_CA_CERT)
      expect(readFileSync(join(fx.ctx.metaDir, 'rauc', 'ca.cert.pem'), 'utf8')).toBe(FIXTURE_CA_CERT)
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the baked public set, which must be exactly the two files the build staged', () => {
  // The hazard this stands against, stated once: if meta/ were baked verbatim
  // every shipped device would carry meta/rauc/ca.key.pem and
  // meta/updates/root.key -- the private keys behind both gates its updates
  // pass -- so anyone who bought one unit could sign an update the whole fleet
  // installs. rootfs/build.sh refuses to STAGE one; these two checks refuse an
  // IMAGE that has one, however it got there.

  test('POSITIVE CONTROL: the fixture ships exactly the set, byte-equal, and says how many', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-meta-is-the-public-set')).toBe('pass')
      expect(await messageOf(fx, 'packed-meta-is-the-public-set'))
        .toContain('holds exactly 1 file(s) [updates/manifest.json]')
    }
    finally {
      fx.dispose()
    }
  })

  test('an ADDED file under the baked directory is refused and named', async () => {
    // The shape this catches: a later slice that copies a directory instead of
    // naming its files, and takes a note-for-the-release-host along with it.
    const fx = await mutated('packed-meta-is-the-public-set', root =>
      writeFileSync(join(root, BAKED_MANIFEST_PATH, '../notes-for-the-release-host.txt'), 'ask ops\n'))
    try {
      expect(await verdictOf(fx, 'packed-meta-is-the-public-set')).toBe('fail')
      expect(await messageOf(fx, 'packed-meta-is-the-public-set'))
        .toContain('updates/notes-for-the-release-host.txt')
    }
    finally {
      fx.dispose()
    }
  })

  test('a REMOVED file is refused and named', async () => {
    const fx = await mutated('packed-meta-is-the-public-set', root =>
      rmSync(join(root, BAKED_MANIFEST_PATH)))
    try {
      expect(await verdictOf(fx, 'packed-meta-is-the-public-set')).toBe('fail')
      expect(await messageOf(fx, 'packed-meta-is-the-public-set')).toContain('is missing updates/manifest.json')
    }
    finally {
      fx.dispose()
    }
  })

  test('an ALTERED file is refused: a baked document must be its source, byte for byte', async () => {
    // A configuration edited after the build is inside the signature every
    // device trusts and was reviewed by nobody -- an update.source pointed
    // somewhere else is the whole compromise.
    const fx = await mutated('packed-meta-is-the-public-set', root =>
      writeFileSync(join(root, BAKED_MANIFEST_PATH), '{ "schema": "mos/meta/v1", "update": { "source": "https://elsewhere" } }\n'))
    try {
      expect(await verdictOf(fx, 'packed-meta-is-the-public-set')).toBe('fail')
      expect(await messageOf(fx, 'packed-meta-is-the-public-set')).toContain('is not the byte-for-byte copy')
    }
    finally {
      fx.dispose()
    }
  })

  test('a tree with NO meta/ to compare against is REFUSED, not answered', async () => {
    // The vacuity trap this repository keeps being bitten by: a verdict of
    // "nothing wrong found" over a directory that does not exist. It is a THROW
    // because "this tree has no public set" is a statement about the RUN.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.ctx.metaDir, 'updates', 'manifest.json'))
      await expect(checkNamed('packed-meta-is-the-public-set').run(fx.ctx))
        .rejects.toThrow(/nothing to compare/)
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the private-key detector over the baked paths', () => {
  test('POSITIVE CONTROL: the healthy fixture is clean AND says what it scanned', async () => {
    // The count is the assertion. A green line that does not say what it looked
    // at cannot be distinguished from a green line that looked at nothing.
    //
    // The expected number is READ OFF THE TREE and not written down: a literal
    // here would go red the day the fixture grows a file under /etc/rauc, for a
    // reason that is not about the detector.
    const fx = packedRootFixture(cx3576)
    try {
      const scanned = ['/usr/share/mos/meta', '/etc/rauc']
        .flatMap(d => readdirSync(join(fx.root, d), { recursive: true, withFileTypes: true }))
        .filter(e => !e.isDirectory()).length
      expect(scanned).toBeGreaterThan(1)
      expect(await verdictOf(fx, 'no-private-key-in-baked-meta')).toBe('pass')
      expect(await messageOf(fx, 'no-private-key-in-baked-meta')).toContain(`scanned ${scanned} file(s)`)
    }
    finally {
      fx.dispose()
    }
  })

  test('PEM armour under the baked meta directory is caught', async () => {
    const fx = await mutated('no-private-key-in-baked-meta', root =>
      writeFileSync(join(root, BAKED_MANIFEST_PATH, '../signer.pem'),
        '-----BEGIN EC PRIVATE KEY-----\nnope\n-----END EC PRIVATE KEY-----\n'))
    try {
      expect(await verdictOf(fx, 'no-private-key-in-baked-meta')).toBe('fail')
      expect(await messageOf(fx, 'no-private-key-in-baked-meta')).toContain('PEM private-key armour')
    }
    finally {
      fx.dispose()
    }
  })

  test('a raw PKCS#8 DER key is caught, which an armour grep would have missed', async () => {
    // meta/updates/root.key is raw PKCS#8 DER -- the one file the hazard is
    // named after -- so this is the test that makes the detector a detector
    // rather than a name for one file format. The bytes are a real ed25519
    // PrivateKeyInfo header: SEQUENCE, INTEGER 0, then the ed25519 OID.
    const der = Buffer.from('302e020100300506032b657004220420' + '00'.repeat(32), 'hex')
    const fx = await mutated('no-private-key-in-baked-meta', root =>
      writeFileSync(join(root, BAKED_MANIFEST_PATH, '../root-material'), der))
    try {
      expect(await verdictOf(fx, 'no-private-key-in-baked-meta')).toBe('fail')
      expect(await messageOf(fx, 'no-private-key-in-baked-meta')).toContain('DER PKCS#8 PrivateKeyInfo header')
    }
    finally {
      fx.dispose()
    }
  })

  test('a key-container FILENAME is caught even when the bytes say nothing', async () => {
    // The third test is not redundant with the first two: a `.p12` is neither
    // PEM armour nor a PKCS#8 SEQUENCE, and a file nobody can read is still a
    // key-shaped path in the signed root.
    const fx = await mutated('no-private-key-in-baked-meta', root =>
      writeFileSync(join(root, BAKED_MANIFEST_PATH, '../bundle.p12'), 'not really a keystore\n'))
    try {
      expect(await verdictOf(fx, 'no-private-key-in-baked-meta')).toBe('fail')
      expect(await messageOf(fx, 'no-private-key-in-baked-meta')).toContain('key-container filename extension')
    }
    finally {
      fx.dispose()
    }
  })

  test('the OTHER scoped path, /etc/rauc, is scanned too', async () => {
    // The keyring's directory is the seam's second baked path: a CA key copied
    // in beside the certificate it belongs to is the realistic accident, and it
    // does not go under /usr/share/mos.
    const fx = await mutated('no-private-key-in-baked-meta', root =>
      writeFileSync(join(root, '/etc/rauc/ca.key.pem'),
        '-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n'))
    try {
      expect(await verdictOf(fx, 'no-private-key-in-baked-meta')).toBe('fail')
      expect(await messageOf(fx, 'no-private-key-in-baked-meta')).toContain('/etc/rauc/ca.key.pem')
    }
    finally {
      fx.dispose()
    }
  })

  test('a scan that read NOTHING is red, not green', async () => {
    // The failure this whole check is exposed to: both scoped directories gone
    // means no file trips a detector, which is the same evidence a clean image
    // produces. An empty search space is refused rather than reported.
    const fx = await mutated('no-private-key-in-baked-meta', (root) => {
      rmSync(join(root, '/usr/share/mos/meta'), { recursive: true })
      rmSync(join(root, '/etc/rauc'), { recursive: true })
    })
    try {
      expect(await verdictOf(fx, 'no-private-key-in-baked-meta')).toBe('fail')
      expect(await messageOf(fx, 'no-private-key-in-baked-meta')).toContain('nothing was scanned')
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
      // EVERY top-level entry, read off the tree. It used to be a written-down
      // list of seven names, and M4f's fixture grew a /bin -- so the tree was
      // not empty, the guard did not fire, and the test failed for a reason
      // that had nothing to do with the guard. A list restated beside the
      // fixture is the drift this campaign keeps finding.
      for (const e of readdirSync(fx.root)) {
        rmSync(join(fx.root, e), { recursive: true, force: true })
      }
      await expect(checkNamed('packed-builtin-no-on-disk-half').run(fx.ctx))
        .rejects.toThrow(/is empty/)
      await expect(checkNamed('packed-keyring-from-meta').run(fx.ctx))
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
