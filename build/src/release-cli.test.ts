// The host half of the release contract: the argument parser and the two
// defaults that are worth a sentence. The assembly and the gate themselves
// are driven in src/release-manifest.test.ts; what is proven here is that a
// request reaches them as the request that was made -- an unknown flag is
// refused rather than forwarded, and the two inputs with no built default
// are refused by name.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'
import {
  DEFAULT_BOARD,
  defaultEvidencePath,
  defaultReleaseDir,
  parseArgs,
  requireSupplied,
  type AssembleCommand,
  type GateCommand,
} from './release-cli.ts'

describe('the subcommand comes first, and is one of two', () => {
  test('POSITIVE CONTROL: assemble with nothing else is the shipping default request', () => {
    const c = parseArgs(['assemble'], {}) as AssembleCommand
    expect(c.cmd).toBe('assemble')
    expect(c.board).toBe(DEFAULT_BOARD)
    expect(c.version).toBe('0.0.0-dev')
    expect(c.channel).toBe('development')
    expect(c.profile).toBe('dev')
    expect(c.notes).toBeUndefined()
  })

  test('anything else in first position is refused, not guessed at', () => {
    expect(() => parseArgs([], {})).toThrow(/needs 'assemble' or 'gate' first/)
    expect(() => parseArgs(['verify'], {})).toThrow(/needs 'assemble' or 'gate' first, got "verify"/)
  })
})

describe('the assemble arguments and their fallbacks', () => {
  test('a positional VERSION is accepted, MOS_RELEASE_VERSION is the fallback, positional wins', () => {
    expect((parseArgs(['assemble', '1.2.3'], {}) as AssembleCommand).version).toBe('1.2.3')
    expect((parseArgs(['assemble'], { MOS_RELEASE_VERSION: '2.0.0' }) as AssembleCommand).version).toBe('2.0.0')
    expect((parseArgs(['assemble', '3.0.0'], { MOS_RELEASE_VERSION: '2.0.0' }) as AssembleCommand).version).toBe('3.0.0')
  })

  test('a bad version is refused by the parser, before any file is read', () => {
    expect(() => parseArgs(['assemble', '1 2'], {})).toThrow(/not a plain version string/)
  })

  test('two positional versions are refused rather than one silently winning', () => {
    expect(() => parseArgs(['assemble', '1.0.0', '2.0.0'], {})).toThrow(/two version strings were given/)
  })

  test('MOS_BOARD selects the board and --board beats it', () => {
    expect((parseArgs(['assemble'], { MOS_BOARD: 'x64' }) as AssembleCommand).board).toBe('x64')
    expect((parseArgs(['assemble', '--board', 'x64'], { MOS_BOARD: 'cx3576' }) as AssembleCommand).board).toBe('x64')
  })

  test('notes and package manifest fall back to their environment names', () => {
    const c = parseArgs(['assemble'], {
      MOS_RELEASE_NOTES: '/n.md', MOS_PACKAGE_MANIFEST: '/m.tsv',
    }) as AssembleCommand
    expect(c.notes).toBe('/n.md')
    expect(c.packageManifest).toBe('/m.tsv')
    const flagged = parseArgs(['assemble', '--notes', '/other.md'], { MOS_RELEASE_NOTES: '/n.md' }) as AssembleCommand
    expect(flagged.notes).toBe('/other.md')
  })

  test('a flag with no value is refused rather than swallowing the next argument', () => {
    for (const flag of ['--board', '--channel', '--notes', '--package-manifest', '--out-dir']) {
      expect(() => parseArgs(['assemble', flag], {})).toThrow(new RegExp(`${flag} needs a value`))
    }
  })

  test('a repeated flag is refused: one of the two values would silently lose', () => {
    expect(() => parseArgs(['assemble', '--notes', '/a', '--notes', '/b'], {})).toThrow(/--notes was given twice/)
  })

  test('an unknown flag is refused, not forwarded', () => {
    expect(() => parseArgs(['assemble', '--bundle-version', '1'], {})).toThrow(/unknown argument "--bundle-version"/)
  })

  test('--bundle is NOT a flag here, deliberately: run.sh reserves it for its bundle mode', () => {
    // run.sh refuses --bundle anywhere but first position, so a release flag
    // spelt --bundle could never be reached through the shipped entry point;
    // the flag is --update-bundle, and the near-miss is refused loudly.
    expect(() => parseArgs(['assemble', '--bundle', '/b.raucb'], {})).toThrow(/unknown argument "--bundle"/)
    expect((parseArgs(['assemble', '--update-bundle', '/b.raucb'], {}) as AssembleCommand).bundle).toBe('/b.raucb')
  })
})

describe('the gate arguments', () => {
  test('POSITIVE CONTROL: gate with a directory and an evidence path', () => {
    const c = parseArgs(['gate', '--dir', '/r', '--evidence', '/e.json'], {})
    expect(c).toEqual({
      cmd: 'gate', board: DEFAULT_BOARD, dir: '/r', evidence: '/e.json', bakedMeta: undefined,
    })
  })

  test('gate takes no positional argument: a stray word is not a directory', () => {
    expect(() => parseArgs(['gate', '/some/dir'], {})).toThrow(/gate takes no positional argument/)
  })
})

describe('the two inputs with no built default are refused by name', () => {
  test('POSITIVE CONTROL: a supplied value is returned as given', () => {
    expect(requireSupplied('/n.md', '--notes', 'MOS_RELEASE_NOTES', 'why')).toBe('/n.md')
  })

  test('undefined and the empty string are both "not supplied" -- an empty env var is a typo', () => {
    for (const v of [undefined, '']) {
      expect(() => requireSupplied(v, '--notes', 'MOS_RELEASE_NOTES', 'a release without notes is refused'))
        .toThrow(/no --notes was supplied \(and MOS_RELEASE_NOTES is unset\); a release without notes is refused/)
    }
  })
})

describe('the defaults name the seam the documentation names', () => {
  test('evidence lives at boards/<board>/evidence.json unless pointed elsewhere', () => {
    expect(defaultEvidencePath('cx3576')).toBe(join(REPO_ROOT, 'boards', 'cx3576', 'evidence.json'))
  })

  test('the release directory is _out/<board>/release', () => {
    expect(defaultReleaseDir('x64')).toBe(join(REPO_ROOT, '_out', 'x64', 'release'))
  })
})

describe('--baked-meta: the input that says what the image trusts', () => {
  test('it is parsed on BOTH subcommands, and MOS_BAKED_META is its fallback', () => {
    // Both, because the gate re-measures rather than trusting the manifest,
    // and a gate that could not be handed the image's meta/ would have to.
    expect((parseArgs(['assemble', '--baked-meta', '/x/meta'], {}) as AssembleCommand).bakedMeta)
      .toBe('/x/meta')
    expect((parseArgs(['gate', '--baked-meta', '/x/meta'], {}) as GateCommand).bakedMeta)
      .toBe('/x/meta')
    expect((parseArgs(['assemble'], { MOS_BAKED_META: '/e/meta' }) as AssembleCommand).bakedMeta)
      .toBe('/e/meta')
    expect((parseArgs(['gate'], { MOS_BAKED_META: '/e/meta' }) as GateCommand).bakedMeta)
      .toBe('/e/meta')
    expect((parseArgs(['gate', '--baked-meta', '/f/meta'], { MOS_BAKED_META: '/e/meta' }) as GateCommand).bakedMeta)
      .toBe('/f/meta')
  })

  test('given twice it is refused, like every other flag that takes a value', () => {
    expect(() => parseArgs(['gate', '--baked-meta', '/a', '--baked-meta', '/b'], {}))
      .toThrow(/--baked-meta was given twice/)
  })

  test('absent, it is refused BY NAME rather than defaulted to a path this CLI invents', () => {
    // There is no default: meta/ is gitignored build-host material and the
    // baked copy lives inside the image, so any path invented here would be a
    // guess whose failure lands on the wrong file.
    expect(() => requireSupplied(undefined, '--baked-meta', 'MOS_BAKED_META', 'because'))
      .toThrow(/no --baked-meta was supplied \(and MOS_BAKED_META is unset\)/)
  })
})
