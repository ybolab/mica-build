// The iptables family, driven from the failing side.
//
// Both checks pass by finding something, which is the easier half to get right,
// and both can be made green by a check that never followed a symlink -- so the
// mutations here are all mutations of the CHAIN. Each takes a fixture asserted
// green first and then makes one edit to it.
//
// The mutations are the real shapes: a package that stopped being installed
// (nothing on PATH), an alternatives group left half-installed (a link that
// dangles), a payload edit that lost the execute bit, and
// `update-alternatives --set iptables /usr/sbin/iptables-legacy`, which is one
// command an operator or a postinst can run and which leaves an image with a
// perfectly good iptables that writes to a rule store nothing else here can
// see. The half-set case is separate because the group has slaves.
//
// One case carries no mutation of the image and is still the most important
// test in this file: the HOST-LEAK case. It re-points the alternatives link at
// an absolute path that exists on the machine running the suite and NOT in the
// packed root, and requires red. A resolution that handed an image-absolute
// link target to statSync would go green there, and the verdict would be about
// the verifier host rather than about the image.

import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { IPTABLES_CHECKS } from './checks-iptables.ts'
import { assertRegisterWellFormed, CHECKS, type CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))

/** The host path the leak test points at: on this machine, not in the fixture. */
const HOST_ONLY = '/usr/bin/env'

function checkNamed(id: string): CheckCase {
  const found = IPTABLES_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no iptables check is registered as '${id}'. Registered: `
      + IPTABLES_CHECKS.map(c => c.id).join(', '))
  }
  return found
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

describe('the iptables family is in the register and can be diffed', () => {
  test('every check is registered in CHECKS, and the register is well formed', () => {
    const registered = new Set(CHECKS.map(c => c.id))
    for (const c of IPTABLES_CHECKS) expect(registered.has(c.id)).toBe(true)
    // Not a tautology over an empty list: the family has to have members.
    expect(IPTABLES_CHECKS.length).toBeGreaterThan(0)
    assertRegisterWellFormed()
  })

  test('no other check claims one of these matchers, in either direction', () => {
    // Not "no other matcher says iptables" -- container-engine-nft's conclusion
    // legitimately does, because netavark 2.x dropping the iptables driver is
    // the reason nft is in the image at all. What must not happen is a matcher
    // CONTAINING another, which is how one check claims a second's line.
    const mine = new Set(IPTABLES_CHECKS.map(c => c.id))
    const alternatives = (c: CheckCase): string[] =>
      [c.shell.pass, c.shell.fail, c.shell.skip]
        .flatMap(m => (typeof m === 'string' ? [m] : Array.isArray(m) ? m as string[] : []))
    const ours = IPTABLES_CHECKS.flatMap(alternatives)
    expect(ours.length).toBeGreaterThan(0)
    for (const c of CHECKS.filter(c => !mine.has(c.id))) {
      for (const theirs of alternatives(c)) {
        for (const own of ours) {
          expect(`${c.id}:${theirs.includes(own)}`).toBe(`${c.id}:false`)
          expect(`${c.id}:${own.includes(theirs)}`).toBe(`${c.id}:false`)
        }
      }
    }
  })

  test('the whole family is green on the healthy fixture', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      for (const c of IPTABLES_CHECKS) {
        const got = await c.run(fx.ctx)
        expect(got.length).toBe(1)
        expect(`${c.id}:${(got[0] as CheckResult).verdict}`).toBe(`${c.id}:pass`)
      }
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the tool is in the packed root and can be run', () => {
  test('the fixture ships it, and the verdict names the whole chain', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-iptables-present')).toBe('pass')
      const message = await messageOf(fx, 'packed-iptables-present')
      // The chain, not just the endpoint: a message naming only the last hop
      // would read the same over a root with no alternatives group at all.
      expect(message).toContain('/usr/sbin/iptables -> /etc/alternatives/iptables '
        + '-> /usr/sbin/iptables-nft -> /usr/sbin/xtables-nft-multi')
      expect(message).toContain('mode 0755')
    }
    finally {
      fx.dispose()
    }
  })

  test('a root where the dependency stopped being installed fails', async () => {
    // The whole group gone, which is what dropping `iptables` from mos-system's
    // Depends produces -- and the profiles that decline containers then have no
    // firewall tool at all.
    const fx = await mutated('packed-iptables-present', (root) => {
      for (const name of ['iptables', 'iptables-save', 'iptables-restore',
        'iptables-nft', 'iptables-nft-save', 'iptables-nft-restore', 'xtables-nft-multi']) {
        rmSync(join(root, 'usr/sbin', name))
      }
    })
    try {
      expect(await verdictOf(fx, 'packed-iptables-present')).toBe('fail')
      expect(await messageOf(fx, 'packed-iptables-present'))
        .toContain('no entry called iptables is in any of')
    }
    finally {
      fx.dispose()
    }
  })

  test('a half-installed alternatives group fails: the chain dangles', async () => {
    const fx = await mutated('packed-iptables-present', root =>
      rmSync(join(root, 'usr/sbin/xtables-nft-multi')))
    try {
      expect(await verdictOf(fx, 'packed-iptables-present')).toBe('fail')
      expect(await messageOf(fx, 'packed-iptables-present'))
        .toContain('resolves to nothing inside the root')
    }
    finally {
      fx.dispose()
    }
  })

  test('a dangling link does NOT resolve against the verifier host', async () => {
    // The one failure a check like this reports as a green: an image-absolute
    // link target handed to the host's own filesystem. The target below exists
    // on the machine running this suite, and the assertion that it is absent
    // from the root is part of the test -- without it the case would pass on a
    // host where the path happened to be missing, for the wrong reason.
    const fx = await mutated('packed-iptables-present', (root) => {
      expect(existsSync(HOST_ONLY)).toBe(true)
      expect(existsSync(join(root, HOST_ONLY))).toBe(false)
      unlinkSync(join(root, 'etc/alternatives/iptables'))
      symlinkSync(HOST_ONLY, join(root, 'etc/alternatives/iptables'))
    })
    try {
      expect(await verdictOf(fx, 'packed-iptables-present')).toBe('fail')
      expect(await messageOf(fx, 'packed-iptables-present'))
        .toContain('resolves to nothing inside the root')
    }
    finally {
      fx.dispose()
    }
  })

  test('a binary that lost its execute bit fails, and says so separately', async () => {
    // Not the same failure as absence: the package installed, and the operator
    // still cannot run it.
    const fx = await mutated('packed-iptables-present', root =>
      chmodSync(join(root, 'usr/sbin/xtables-nft-multi'), 0o644))
    try {
      expect(await verdictOf(fx, 'packed-iptables-present')).toBe('fail')
      expect(await messageOf(fx, 'packed-iptables-present')).toContain('mode 0644')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('which of the two front-ends the group selects', () => {
  test('the fixture selects nft, over a root that HAS the legacy binary', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-iptables-nft-backend')).toBe('pass')
      const message = await messageOf(fx, 'packed-iptables-nft-backend')
      expect(message).toContain('all of iptables, iptables-save, iptables-restore')
      // The legacy binary IS there and nothing resolves to it. A green produced
      // by an image that simply lacks it would be a weaker fact.
      expect(message).toContain('/usr/sbin/xtables-legacy-multi ships beside it')
    }
    finally {
      fx.dispose()
    }
  })

  test('a usr-merged root names the legacy binary ONCE, not once per path', async () => {
    // The shipped root has /sbin as a symlink to usr/sbin, so /usr/sbin/... and
    // /sbin/... are two names for one file. A sweep that reported both read as
    // two legacy binaries in an image that has one, which is the wrong number
    // in a verdict about which front-ends are present.
    const fx = packedRootFixture(cx3576)
    try {
      symlinkSync('usr/sbin', join(fx.root, 'sbin'))
      expect(await verdictOf(fx, 'packed-iptables-nft-backend')).toBe('pass')
      const message = await messageOf(fx, 'packed-iptables-nft-backend')
      expect(message.split('xtables-legacy-multi').length - 1).toBe(1)
      expect(message).toContain('/usr/sbin/xtables-legacy-multi ships beside it')
    }
    finally {
      fx.dispose()
    }
  })

  test('a group set to legacy fails, naming what it ends at', async () => {
    // `update-alternatives --set iptables /usr/sbin/iptables-legacy`, which
    // leaves an executable iptables in the image writing to the old xtables
    // store -- rules `nft list ruleset` cannot show and netavark never sees.
    const fx = await mutated('packed-iptables-nft-backend', (root) => {
      for (const [name, variant] of [
        ['iptables', 'iptables-legacy'],
        ['iptables-save', 'iptables-legacy-save'],
        ['iptables-restore', 'iptables-legacy-restore'],
      ] as const) {
        unlinkSync(join(root, 'etc/alternatives', name))
        symlinkSync(`/usr/sbin/${variant}`, join(root, 'etc/alternatives', name))
      }
    })
    try {
      expect(await verdictOf(fx, 'packed-iptables-nft-backend')).toBe('fail')
      const message = await messageOf(fx, 'packed-iptables-nft-backend')
      expect(message).toContain('iptables ends at xtables-legacy-multi')
      expect(message).toContain('iptables-save ends at xtables-legacy-multi')
    }
    finally {
      fx.dispose()
    }
  })

  test('a HALF-set group fails: the slaves are the point of checking three', async () => {
    // The master still speaks nf_tables and `iptables-save` dumps the legacy
    // store, so an operator cannot see the rules they just wrote. A check over
    // the master alone would call this image correct.
    const fx = await mutated('packed-iptables-nft-backend', (root) => {
      unlinkSync(join(root, 'etc/alternatives/iptables-save'))
      symlinkSync('/usr/sbin/iptables-legacy-save', join(root, 'etc/alternatives/iptables-save'))
    })
    try {
      expect(await verdictOf(fx, 'packed-iptables-nft-backend')).toBe('fail')
      const message = await messageOf(fx, 'packed-iptables-nft-backend')
      expect(message).toContain('iptables-save ends at xtables-legacy-multi')
      expect(message).not.toContain('iptables ends at')
    }
    finally {
      fx.dispose()
    }
  })

  test('a root with no iptables at all fails rather than reporting nothing wrong', async () => {
    // Vacuity. "Nothing selects the legacy front-end" is TRUE of an image that
    // ships neither front-end, of a root that failed to unpack, and of a
    // directory that was never a root -- so it has to be red here, not green.
    const fx = await mutated('packed-iptables-nft-backend', (root) => {
      for (const name of ['iptables', 'iptables-save', 'iptables-restore']) {
        rmSync(join(root, 'usr/sbin', name))
      }
    })
    try {
      expect(await verdictOf(fx, 'packed-iptables-nft-backend')).toBe('fail')
      expect(await messageOf(fx, 'packed-iptables-nft-backend'))
        .toContain('iptables is not on PATH')
    }
    finally {
      fx.dispose()
    }
  })
})
