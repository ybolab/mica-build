// The pin readers, driven from the failing side.
//
// Every case here that matters is a case where
// the reader must REFUSE, because the failure mode this file guards is a reader
// that returns something plausible instead: an empty expectation that nothing
// can meet, or -- worse -- a dependency's version silently standing in for a
// crate's. Both would produce a smoke run that is red or green for a reason
// nobody could act on.
//
// The positive controls are the shipped files. Every negative case below is a
// fabricated fixture, and a suite of nothing but fabricated fixtures proves
// only that the reader handles files nobody has. So each group also reads the
// REAL mica-podman:versions.env and crate manifests,
// and asserts the search space is non-empty before concluding anything about
// what is in it.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'
import {
  cratePath,
  expectedFromRecorded,
  PODMAN_VERSIONS_ENV,
  readCratePackageVersion,
  readPin,
  readVersionsEnv,
  pinKeys,
  VERSIONS_ENV_FILES,
  VERSION_KEY_SUFFIX,
} from './smoke-pins.ts'

// Created and removed by the same condition -- see checks-cmdline.test.ts for
// why a module-scope mkdtemp and a hook-scope rm are not symmetric under a
// `-t` filter.
let SCRATCH = ''
beforeAll(() => {
  mkdirSync(join(REPO_ROOT, '_out'), { recursive: true })
  SCRATCH = mkdtempSync(join(REPO_ROOT, '_out', 'verify-smoke-pins-'))
})
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/** A fixture file, refusing to be written before `beforeAll` made the directory. */
function fixture(name: string, body: string): string {
  if (SCRATCH === '') throw new Error('the scratch directory was read before beforeAll created it')
  const path = join(SCRATCH, name)
  writeFileSync(path, body)
  return path
}

describe('expectedFromRecorded -- the one normalisation, and its limits', () => {
  // Both spellings are in one shipped file, which is why this exists at all.
  test('strips the git tag v from a pin that has one', () => {
    expect(expectedFromRecorded('v5.8.6')).toBe('5.8.6')
    expect(expectedFromRecorded('v1.13')).toBe('1.13')
  })

  test('leaves a pin that never had one alone', () => {
    expect(expectedFromRecorded('1.29.1')).toBe('1.29.1')
    expect(expectedFromRecorded('0.1.0')).toBe('0.1.0')
  })

  // The failing side of the normalisation itself. A blanket /^v/ would rewrite
  // these, and a pin whose first character happened to be `v` would silently
  // become a different string -- in a comparison whose whole job is exactness.
  test('does not strip a v that is not a version prefix', () => {
    expect(expectedFromRecorded('version')).toBe('version')
    expect(expectedFromRecorded('vendor-1.0')).toBe('vendor-1.0')
    expect(expectedFromRecorded('v')).toBe('v')
  })

  test('the shipped pins really do use both spellings, so this is not a hypothetical', () => {
    const podman = readVersionsEnv(PODMAN_VERSIONS_ENV)
    const withV = [...podman.entries()].filter(([k, v]) => k.endsWith(VERSION_KEY_SUFFIX) && v.startsWith('v'))
    const withoutV = [...podman.entries()].filter(([k, v]) => k.endsWith(VERSION_KEY_SUFFIX) && !v.startsWith('v'))
    expect(withV.length).toBeGreaterThan(0)
    expect(withoutV.length).toBeGreaterThan(0)
  })
})

describe('readVersionsEnv and pinKeys, over the files this tree ships', () => {
  test('every versions.env the register reads is readable and non-empty', () => {
    // The vacuity control, first. Everything below is a statement about a set,
    // and a statement about an empty set is true for free.
    expect(VERSIONS_ENV_FILES.length).toBeGreaterThan(0)
    for (const file of VERSIONS_ENV_FILES) {
      expect(readVersionsEnv(file).size).toBeGreaterThan(0)
    }
  })

  test('pinKeys returns only version keys, and the files really carry some', () => {
    let total = 0
    for (const file of VERSIONS_ENV_FILES) {
      const keys = pinKeys(file)
      expect(keys.length).toBeGreaterThan(0)
      for (const k of keys) expect(k.endsWith(VERSION_KEY_SUFFIX)).toBe(true)
      total += keys.length
    }
    // Deliberately a floor and not an equality: an exact count here would be a
    // Second list of the pins, and would have to be edited every time one was
    // added -- which is the drift smoke-register.ts's coverage check exists to
    // catch rather than to reproduce.
    expect(total).toBeGreaterThan(1)
  })

  test('the SHA256 half of every pair is excluded', () => {
    const all = [...readVersionsEnv(PODMAN_VERSIONS_ENV).keys()]
    const hashes = all.filter(k => k.endsWith('_SHA256'))
    // Positive control: the file really does carry hash keys, so "none of them
    // are in pinKeys" is a statement about a populated set.
    expect(hashes.length).toBeGreaterThan(0)
    for (const h of hashes) expect(pinKeys(PODMAN_VERSIONS_ENV)).not.toContain(h)
  })
})

describe('readPin', () => {
  test('reads a real pin out of the real file', () => {
    const pin = readPin(PODMAN_VERSIONS_ENV, 'PODMAN_VERSION')
    expect(pin.file).toBe(PODMAN_VERSIONS_ENV)
    expect(pin.key).toBe('PODMAN_VERSION')
    expect(pin.recorded).not.toBe('')
    expect(pin.expected).toBe(expectedFromRecorded(pin.recorded))
  })

  // Failing side: a key that is not there. The message has to name the keys
  // that ARE, because the likeliest cause is a rename and the reader needs the
  // new name rather than confirmation of the old one.
  test('refuses a key the file does not declare, and names the ones it does', () => {
    expect(() => readPin(PODMAN_VERSIONS_ENV, 'NOT_A_REAL_VERSION')).toThrow(/declares no non-empty NOT_A_REAL_VERSION/)
    expect(() => readPin(PODMAN_VERSIONS_ENV, 'NOT_A_REAL_VERSION')).toThrow(/PODMAN_VERSION/)
  })

  // Failing side: the key is there and EMPTY. This is the dangerous one -- an
  // empty expectation is not a weaker check, it is a different one, and
  // the reader must reject it before comparing any binary output.
  test('refuses a declared-empty pin rather than treating it as no expectation', () => {
    const path = fixture('empty.env', 'THING_VERSION=""\nOTHER_VERSION=v1.2.3\n')
    expect(() => readPin(path, 'THING_VERSION')).toThrow(/declares no non-empty THING_VERSION/)
    // Positive control on the same file: the reader is not simply broken.
    expect(readPin(path, 'OTHER_VERSION').expected).toBe('1.2.3')
  })

  test('a file with no version pins at all says so rather than listing nothing silently', () => {
    const path = fixture('nopins.env', '# only a comment\nSOMETHING_ELSE=1\n')
    expect(() => readPin(path, 'THING_VERSION')).toThrow(/\(none at all\)/)
  })
})

describe('readCratePackageVersion -- and why it tracks the TOML table', () => {
  test('reads the four shipped crates', () => {
    // The search space, first: all four manifests exist and answer.
    for (const crate of ['micad', 'apid', 'mqttd', 'broker']) {
      const pin = readCratePackageVersion(cratePath(crate))
      expect(pin.key).toBe('package.version')
      expect(pin.recorded).toMatch(/^[0-9]/)
      expect(pin.file).toContain(join('pkgs', 'micad', crate))
    }
  })

  // The case a one-line regex gets wrong, and the reason this reader is not
  // one. `/^version = "(.*)"/m` over this file finds 9.9.9 and hands it back as
  // the crate's own -- a comparison that has silently started asserting a
  // dependency's version against a binary's, and passes or fails for a reason
  // that has nothing to do with either.
  test('a version in another table is NOT the crate version', () => {
    const path = fixture(
      'deps-only.toml',
      '[package]\nname = "thing"\nedition = "2024"\n\n[dependencies]\nversion = "9.9.9"\nserde = "1"\n',
    )
    expect(() => readCratePackageVersion(path)).toThrow(/no `version = "\.\.\."` inside a \[package\] table/)
  })

  test('a [package] version after another table is still found', () => {
    const path = fixture(
      'reordered.toml',
      '[dependencies]\nversion = "9.9.9"\n\n[package]\nname = "thing"\nversion = "3.2.1"\n',
    )
    expect(readCratePackageVersion(path).recorded).toBe('3.2.1')
  })

  test('a workspace-inherited version is refused rather than resolved', () => {
    const path = fixture('inherited.toml', '[package]\nname = "thing"\nversion.workspace = true\n')
    expect(() => readCratePackageVersion(path)).toThrow(/no `version = "\.\.\."` inside a \[package\] table/)
  })

  test('an empty [package] version is refused, not returned', () => {
    const path = fixture('emptyver.toml', '[package]\nname = "thing"\nversion = ""\n')
    expect(() => readCratePackageVersion(path)).toThrow(/EMPTY \[package\] version/)
  })

  test('a manifest with no [package] table at all is refused', () => {
    const path = fixture('workspace.toml', '[workspace]\nmembers = ["a"]\n')
    expect(() => readCratePackageVersion(path)).toThrow(/no `version = "\.\.\."` inside a \[package\] table/)
  })

  test('comments and whitespace do not hide the value', () => {
    const path = fixture(
      'commented.toml',
      '# a header\n[package]  # the crate\nname = "thing"\n  version   =   "7.7.7"   # pinned\n',
    )
    expect(readCratePackageVersion(path).recorded).toBe('7.7.7')
  })
})
