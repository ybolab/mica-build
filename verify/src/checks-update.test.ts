// The update-client family, driven from the failing side.
//
// Every check lands with the fixture that fails it: against a healthy image a
// check that works and a check that cannot fail report the same green, and only
// a mutation separates them. The baseline is asserted green FIRST in every
// case, because a fixture already failing would report the same red after an
// edit that changed nothing.
//
// The mutations are shapes the real failure takes: a package that stopped being
// resolved into the set (the binary is gone), a payload that lost its mode, the
// release-side signing tool reaching a device, and each of the four ways the
// composition can write an identity that does not describe the image it is in.

import { describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { FIXTURE_COMMIT_DATE, FIXTURE_POOL_VERSION, packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { UPDATE_CHECKS } from './checks-update.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const IDENTITY = 'usr/share/mos/release-identity.env'

function checkNamed(id: string): CheckCase {
  const found = UPDATE_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no update check is registered as '${id}'. Registered: `
      + UPDATE_CHECKS.map(c => c.id).join(', '))
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

/** Seed a fixture, assert the check is GREEN on it, run `mutate`, hand it back. */
async function mutated(id: string, mutate: (root: string) => void): Promise<RootFixture> {
  const fx = packedRootFixture(cx3576)
  expect(await verdictOf(fx, id)).toBe('pass')
  mutate(fx.root)
  return fx
}

/** Rewrite the identity file, replacing the single line beginning `<key>=`. */
function setIdentity(root: string, key: string, value: string): void {
  const path = join(root, IDENTITY)
  const next = readFileSync(path, 'utf8')
    .split('\n')
    .map(l => (l.startsWith(`${key}=`) ? `${key}=${value}` : l))
    .join('\n')
  writeFileSync(path, next)
}

describe('the packaged update client', () => {
  test('the fixture ships both binaries and no signer', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-update-client')).toBe('pass')
      expect(await messageOf(fx, 'packed-update-client')).toContain('/usr/bin/rauc-update and /usr/bin/rauc-verify')
    }
    finally {
      fx.dispose()
    }
  })

  test('a root without rauc-update fails, naming it: the producer left the resolution', async () => {
    const fx = await mutated('packed-update-client', root =>
      rmSync(join(root, 'usr/bin/rauc-update')))
    try {
      expect(await verdictOf(fx, 'packed-update-client')).toBe('fail')
      expect(await messageOf(fx, 'packed-update-client')).toContain('/usr/bin/rauc-update is')
    }
    finally {
      fx.dispose()
    }
  })

  test('a root without rauc-verify fails: half a client cannot complete an update', async () => {
    const fx = await mutated('packed-update-client', root =>
      rmSync(join(root, 'usr/bin/rauc-verify')))
    try {
      expect(await verdictOf(fx, 'packed-update-client')).toBe('fail')
      expect(await messageOf(fx, 'packed-update-client')).toContain('/usr/bin/rauc-verify is')
    }
    finally {
      fx.dispose()
    }
  })

  test('a binary that became a SYMLINK fails: the predicate is a regular file', async () => {
    const fx = await mutated('packed-update-client', (root) => {
      rmSync(join(root, 'usr/bin/rauc-update'))
      symlinkSync('/usr/bin/rauc-verify', join(root, 'usr/bin/rauc-update'))
    })
    try {
      expect(await verdictOf(fx, 'packed-update-client')).toBe('fail')
      expect(await messageOf(fx, 'packed-update-client')).toContain('not an executable regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('a payload that lost its executable bit fails, which -f would not catch', async () => {
    const fx = await mutated('packed-update-client', root =>
      chmodSync(join(root, 'usr/bin/rauc-update'), 0o644))
    try {
      expect(await verdictOf(fx, 'packed-update-client')).toBe('fail')
      expect(await messageOf(fx, 'packed-update-client')).toContain('not an executable regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('the release-side signing tool in the root fails: it loads the private keys', async () => {
    const fx = await mutated('packed-update-client', root =>
      writeFileSync(join(root, 'usr/bin/rauc-sign'), 'ELF ... rauc-sign\n'))
    try {
      expect(await verdictOf(fx, 'packed-update-client')).toBe('fail')
      expect(await messageOf(fx, 'packed-update-client')).toContain('RELEASE-side signing tool')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the release identity the client selects against', () => {
  test('the fixture identity passes, naming all four values', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('pass')
      expect(await messageOf(fx, 'packed-release-identity'))
        .toContain(`BOARD=cx3576, PROFILE=dev, VERSION=${FIXTURE_POOL_VERSION} and `
          + `COMMIT_DATE=${FIXTURE_COMMIT_DATE}`)
    }
    finally {
      fx.dispose()
    }
  })

  // COMMIT_DATE is the newest key in the file and the only one no update-client
  // code path reads, so it is also the one an image can quietly lose: nothing
  // in the boot, the install or the update refuses a root without it. What it
  // costs is a system-information surface with no date at all, or -- before
  // this key existed -- one reporting the pinned 2020-01-01 file epoch as the
  // day the image was built, on every image ever built.
  test('an identity with no COMMIT_DATE fails: the image can date itself only by the pinned epoch', async () => {
    const fx = await mutated('packed-release-identity', root =>
      writeFileSync(join(root, IDENTITY),
        `BOARD=cx3576\nPROFILE=dev\nVERSION=${FIXTURE_POOL_VERSION}\n`))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('states COMMIT_DATE 0 times')
    }
    finally {
      fx.dispose()
    }
  })

  test('a COMMIT_DATE with no value fails: a present key is not a date', async () => {
    const fx = await mutated('packed-release-identity', root => setIdentity(root, 'COMMIT_DATE', ''))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('which is not the')
    }
    finally {
      fx.dispose()
    }
  })

  test('a COMMIT_DATE that is not an RFC 3339 instant fails: mosd reports it verbatim', async () => {
    const fx = await mutated('packed-release-identity', root =>
      setIdentity(root, 'COMMIT_DATE', 'Mon Sep 1 12:34:56 2026 +0800'))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity'))
        .toContain('COMMIT_DATE=Mon Sep 1 12:34:56 2026 +0800')
    }
    finally {
      fx.dispose()
    }
  })

  test('an image without the identity file fails: every invocation would need flags', async () => {
    const fx = await mutated('packed-release-identity', root => rmSync(join(root, IDENTITY)))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('is not a regular file')
    }
    finally {
      fx.dispose()
    }
  })

  test('a line that is not KEY=VALUE fails, named: the client refuses the file whole', async () => {
    const fx = await mutated('packed-release-identity', root =>
      writeFileSync(join(root, IDENTITY),
        `BOARD cx3576\nPROFILE=dev\nVERSION=${FIXTURE_POOL_VERSION}\n`))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain("'BOARD cx3576'")
    }
    finally {
      fx.dispose()
    }
  })

  test('an identity with no VERSION fails: rollback selection has nothing to compare', async () => {
    const fx = await mutated('packed-release-identity', root =>
      writeFileSync(join(root, IDENTITY), 'BOARD=cx3576\nPROFILE=dev\n'))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('does not state VERSION')
    }
    finally {
      fx.dispose()
    }
  })

  test('a repeated key fails: the parser keeps the last, so the file reads as two', async () => {
    const fx = await mutated('packed-release-identity', root =>
      writeFileSync(join(root, IDENTITY),
        `BOARD=x64\nBOARD=cx3576\nPROFILE=dev\nVERSION=${FIXTURE_POOL_VERSION}\n`))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('BOARD 2 times')
    }
    finally {
      fx.dispose()
    }
  })

  test('a BOARD naming the other board fails: this device would take its bundles', async () => {
    const fx = await mutated('packed-release-identity', root => setIdentity(root, 'BOARD', 'x64'))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity'))
        .toContain('states BOARD=x64 and this is the cx3576 image')
    }
    finally {
      fx.dispose()
    }
  })

  test('a PROFILE the shipped marker contradicts fails: one image is not two profiles', async () => {
    const fx = await mutated('packed-release-identity', root => setIdentity(root, 'PROFILE', 'prod'))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('states PROFILE=prod')
    }
    finally {
      fx.dispose()
    }
  })

  test('a VERSION the manifest does not record fails: the pool version is the identity', async () => {
    const fx = await mutated('packed-release-identity', root =>
      setIdentity(root, 'VERSION', '0.1.0+gitffffffffffff-1'))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity'))
        .toContain(`records mos-system at ${FIXTURE_POOL_VERSION}`)
    }
    finally {
      fx.dispose()
    }
  })

  test('an image whose manifest has no mos-system row fails rather than passing vacuously', async () => {
    const fx = await mutated('packed-release-identity', root =>
      writeFileSync(join(root, 'usr/share/mos/manifest.tsv'),
        '#package\tversion\tarchitecture\nlibc6\t2.41-12\tamd64\n'))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('records no version for mos-system')
    }
    finally {
      fx.dispose()
    }
  })

  test('an image with no profile marker fails: there is nothing to check PROFILE against', async () => {
    const fx = await mutated('packed-release-identity', root =>
      rmSync(join(root, 'usr/lib/mos/profile.conf')))
    try {
      expect(await verdictOf(fx, 'packed-release-identity')).toBe('fail')
      expect(await messageOf(fx, 'packed-release-identity')).toContain('is not a regular file in the')
    }
    finally {
      fx.dispose()
    }
  })
})
