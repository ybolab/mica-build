// The host half of the bundle builder, driven from the failing side.
//
// Every refusal in src/bundle-cli.ts has a case, and every case has a positive
// control beside it -- see src/bundle.test.ts's header for why a table of
// refusals without controls is satisfied by a function that refuses everything.
//
// Every guard here is reachable without breaking the tree. The three that read
// the filesystem -- the board definition, the signing material, the required
// inputs -- take their `exists` as a parameter for that reason: a guard that can
// only fire when os/update/rauc/.devkeys has been deleted is a guard nobody has
// run.

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkRequiredInputs,
  checkVersion,
  compatibleFrom,
  DEFAULT_BOARD,
  hostArchFor,
  parseArgs,
  requireBoardEnv,
  requireCompatible,
  requireHostRauc,
  resolveSigningMaterial,
} from './bundle-cli.ts'
import { ROOTFS_PRODUCER, SYSTEM_CONF } from './bundle.ts'
import { boardEnvPath, REPO_ROOT, requireShippedBoards } from './paths.ts'
import { shippedRaucPath } from './toolsets.ts'

const KEYDIR = '/keys'
const CERT = join(KEYDIR, 'signer.cert.pem')
const KEY = join(KEYDIR, 'signer.key.pem')
const KEYRING = join(KEYDIR, 'ca.cert.pem')

/** A filesystem that has exactly these paths and nothing else. */
function only(...paths: string[]): (p: string) => boolean {
  const set = new Set(paths)
  return p => set.has(p)
}

// G1: the board definition.

describe('the board definition is refused by NAME, not by ENOENT', () => {
  test('POSITIVE CONTROL: every board this tree ships is accepted', () => {
    const boards = requireShippedBoards()
    expect(boards.length).toBeGreaterThan(1)
    for (const b of boards) expect(requireBoardEnv(b)).toBe(boardEnvPath(b))
  })

  test('a board that does not exist names the file AND the MOS_BOARD that produced it', () => {
    // `MOS_BOARD=cx3567` is one transposition away from working. Left to
    // readFileSync the reader gets an ENOENT naming a path, which is a fact
    // about the filesystem and not about the mistake.
    expect(() => requireBoardEnv('cx3567')).toThrow(/boards\/cx3567\/board\.env not found \(MOS_BOARD=cx3567\)/)
  })

  test('the default board is one this tree actually ships', () => {
    expect(requireShippedBoards()).toContain(DEFAULT_BOARD)
  })
})

// G23: the version string.

describe('the version string reaches a filename and a manifest, so it is checked', () => {
  test('POSITIVE CONTROL: the shapes a release actually uses are accepted', () => {
    for (const v of ['0.0.0-dev', '1.2.3', '2026.08.26', '1.0.0+build.7', 'v1', '0']) {
      expect(checkVersion(v)).toBe(v)
    }
  })

  test('a leading punctuation character is refused -- the regex anchors on alphanumeric', () => {
    expect(() => checkVersion('-1.2.3')).toThrow(/version '-1\.2\.3' is not a plain version string/)
    expect(() => checkVersion('.1')).toThrow(/not a plain version string/)
  })

  test('the EMPTY version is refused, and it is the one a mistyped variable produces', () => {
    expect(() => checkVersion('')).toThrow(/version '' is not a plain version string/)
  })

  test('a version carrying a PATH SEPARATOR is refused: it is concatenated into a filename', () => {
    expect(() => checkVersion('1.2.3/../../etc')).toThrow(/not a plain version string/)
  })

  test('a version carrying whitespace or a shell metacharacter is refused', () => {
    for (const v of ['1.2.3 4', '1.2.3;rm', '1.2.3$(x)', '1.2.3\n4']) {
      expect(() => checkVersion(v)).toThrow(/not a plain version string/)
    }
  })

  test('a version carrying `&` is refused, which is what keeps the literal render honest', () => {
    // src/bundle.ts substitutes literally where sed would expand `&` to the
    // whole match. This is why that difference cannot be reached from a
    // VERSION -- the COMPATIBLE string has no such guard, and bundle.ts says so.
    expect(() => checkVersion('1.2&3')).toThrow(/not a plain version string/)
  })
})

// G24: the compatible string.

describe('the compatible string, read out of the rendered system.conf', () => {
  test('POSITIVE CONTROL: the shipped system.conf yields one, when it is rendered', () => {
    // It is generated rather than committed, so a checkout that has never run
    // the rootfs build has none. Both halves assert something: the file's own
    // value when it is there, the reader's answer to an absent one when it is
    // not -- and neither is a skip.
    if (existsSync(SYSTEM_CONF)) {
      const got = requireCompatible(readFileSync(SYSTEM_CONF, 'utf8'), SYSTEM_CONF)
      expect(got).toMatch(/^mos-[a-z0-9]+$/)
    } else {
      expect(() => requireCompatible('', SYSTEM_CONF)).toThrow(/no compatible= in/)
    }
  })

  test('a system.conf declaring none is refused: it is the bundle\'s whole hardware claim', () => {
    expect(() => requireCompatible('[system]\nbootloader=uboot\n', '/etc/rauc/system.conf'))
      .toThrow(/no compatible= in \/etc\/rauc\/system\.conf/)
  })

  test('an EMPTY compatible= is refused too -- declared-empty is not a value here', () => {
    expect(() => requireCompatible('compatible=\n', '/x')).toThrow(/no compatible= in/)
  })

  test('a key that merely CONTAINS `compatible=` is not read as one', () => {
    expect(compatibleFrom('# compatible=mos-x64 is what x64 uses\n')).toBe('')
  })

  test('a file declaring it TWICE yields both joined, as `sed -n` with no tail does', () => {
    // Which then compares unequal to whatever rauc reads back out of the bundle,
    // so the malformed file is refused rather than silently half-read.
    expect(compatibleFrom('compatible=mos-a\ncompatible=mos-b\n')).toBe('mos-a\nmos-b')
  })
})

// G25, G26: the signing material.

describe('CERT/KEY/KEYRING are resolved and checked before anything runs', () => {
  test('POSITIVE CONTROL: with no environment, the three devkey paths are the defaults', () => {
    const m = resolveSigningMaterial({}, KEYDIR, only(CERT, KEY, KEYRING))
    expect(m).toEqual({ cert: CERT, key: KEY, keyring: KEYRING })
  })

  test('POSITIVE CONTROL: caller-supplied paths WIN and are not overridden', () => {
    // Both of the shell's branches used to reassign these; that is the defect
    // the resolve-once shape exists to remove. Real signing material lives
    // outside the tree and must survive the container path too.
    const m = resolveSigningMaterial(
      { CERT: '/hsm/c.pem', KEY: '/hsm/k.pem', KEYRING: '/hsm/ca.pem' },
      KEYDIR,
      only('/hsm/c.pem', '/hsm/k.pem', '/hsm/ca.pem'),
    )
    expect(m).toEqual({ cert: '/hsm/c.pem', key: '/hsm/k.pem', keyring: '/hsm/ca.pem' })
  })

  test('a MIXED trio is honoured per file, not all-or-nothing', () => {
    const m = resolveSigningMaterial({ KEYRING: '/hsm/ca.pem' }, KEYDIR, only(CERT, KEY, '/hsm/ca.pem'))
    expect(m).toEqual({ cert: CERT, key: KEY, keyring: '/hsm/ca.pem' })
  })

  test('EACH of the three, missing from the DEVKEY directory, says `make os-devkeys`', () => {
    for (const absent of [CERT, KEY, KEYRING]) {
      const present = [CERT, KEY, KEYRING].filter(p => p !== absent)
      let message = ''
      try { resolveSigningMaterial({}, KEYDIR, only(...present)) } catch (e) { message = (e as Error).message }
      expect(message).toContain(`signing material not found: ${absent}`)
      expect(message).toContain('make os-devkeys')
    }
  })

  test('a CALLER-SUPPLIED path that is missing gets the OTHER sentence -- it is a typo', () => {
    let message = ''
    try {
      resolveSigningMaterial({ CERT: '/hsm/typo.pem' }, KEYDIR, only(KEY, KEYRING))
    } catch (e) { message = (e as Error).message }
    expect(message).toContain('signing material not found: /hsm/typo.pem')
    expect(message).toContain('supplied from the environment')
    expect(message).not.toContain('make os-devkeys')
  })

  test('a path that merely BEGINS like the keydir is not treated as one of its files', () => {
    // `case "${keyfile}" in "${KEYDIR}"/*)` -- the slash matters. `/keys-backup`
    // is not under `/keys`, and telling its owner to run `make os-devkeys` would
    // send them to regenerate a file that is not the one they named.
    let message = ''
    try {
      resolveSigningMaterial({ CERT: '/keys-backup/c.pem' }, KEYDIR, only(KEY, KEYRING))
    } catch (e) { message = (e as Error).message }
    expect(message).toContain('/keys-backup/c.pem')
    expect(message).toContain('supplied from the environment')
  })
})

// G27, G28: the inputs.

describe('the two families of missing input get different sentences', () => {
  const rootfsSide = ['/out/rootfs-verity.img', '/out/rootfs-verity.env']
  const boardSide = ['/bsp/out/kernel/Image', '/bsp/out/kernel/rk3576-src.dtb']

  test('POSITIVE CONTROL: with every input present, nothing is refused', () => {
    expect(() => checkRequiredInputs({ rootfsSide, boardSide }, 'cx3576', '/bsp', only(...rootfsSide, ...boardSide)))
      .not.toThrow()
  })

  test('EACH rootfs-side input names the producer you can run', () => {
    for (const absent of rootfsSide) {
      const present = [...rootfsSide, ...boardSide].filter(p => p !== absent)
      expect(() => checkRequiredInputs({ rootfsSide, boardSide }, 'cx3576', '/bsp', only(...present)))
        .toThrow(new RegExp(`${absent} not found; run 'MOS_BOARD=cx3576 bash ${ROOTFS_PRODUCER}' first`))
    }
  })

  test('EACH board-side input names BOARD_DIR and its current value instead', () => {
    // A different action: build the BSP, or point BOARD_DIR somewhere else.
    // Rolling the two into one sentence sends half the readers to the wrong
    // script.
    for (const absent of boardSide) {
      const present = [...rootfsSide, ...boardSide].filter(p => p !== absent)
      expect(() => checkRequiredInputs({ rootfsSide, boardSide }, 'cx3576', '/bsp', only(...present)))
        .toThrow(new RegExp(`${absent} not found; build the BSP or set BOARD_DIR \\(currently: /bsp\\)`))
    }
  })

  test('the rootfs side is checked FIRST, as the shell checks it first', () => {
    // Same order, so a tree missing both gets the same first sentence out of
    // either implementation.
    expect(() => checkRequiredInputs({ rootfsSide, boardSide }, 'cx3576', '/bsp', only()))
      .toThrow(new RegExp(`${ROOTFS_PRODUCER}' first`))
  })

  test('an EMPTY board-side list is a grub board, not an unchecked one', () => {
    // x64 has no BSP: its kernel comes from _out, so it is a ROOTFS-side input
    // and the board-side list is genuinely empty. The distinction matters
    // because an empty loop is exactly what a vacuous guard looks like.
    expect(() => checkRequiredInputs({ rootfsSide, boardSide: [] }, 'x64', '/bsp', only(...rootfsSide)))
      .not.toThrow()
  })
})

// G29: the build host's architecture.

describe('the HOST\'s architecture, not the board\'s', () => {
  test('POSITIVE CONTROL: both spellings of both architectures are accepted', () => {
    // `uname -m` says x86_64/aarch64 and node's os.arch() says x64/arm64. Both
    // reach this function depending on who calls it, so both are answered.
    expect(hostArchFor('x86_64')).toBe('amd64')
    expect(hostArchFor('x64')).toBe('amd64')
    expect(hostArchFor('aarch64')).toBe('arm64')
    expect(hostArchFor('arm64')).toBe('arm64')
  })

  test('anything else is refused, naming what os/update/rauc/ actually builds', () => {
    for (const m of ['riscv64', 'armv7l', 'ppc64le', '']) {
      expect(() => hostArchFor(m)).toThrow(/os\/update\/rauc\/ builds amd64 and arm64/)
    }
  })

  test('the BOARD\'s architecture is not accepted as the host\'s by accident', () => {
    // cx3576 is an arm64 board bundled on an amd64 host in this campaign. The
    // two are different questions and the rauc that WRITES a bundle is the
    // host's, which is what makes the version comparison meaningful.
    expect(hostArchFor('x86_64')).toBe('amd64')
  })
})

// G30: the rauc this tree built.

describe('the rauc that writes the bundle is the one this tree built', () => {
  test('POSITIVE CONTROL: a binary that is there is returned, with its path', () => {
    expect(requireHostRauc('amd64', only(shippedRaucPath('amd64')))).toBe(shippedRaucPath('amd64'))
  })

  test('its absence names the build, not "rauc is missing"', () => {
    // RAUC is built from source here rather than installed from Debian, and
    // os/update/rauc/versions.env records why -- the distribution build links
    // libcurl-gnutls and drags GnuTLS, p11-kit, GMP, Nettle and Kerberos into a
    // signed image for an install path this project defers.
    expect(() => requireHostRauc('amd64', only())).toThrow(/out-amd64\/rauc not found/)
    expect(() => requireHostRauc('amd64', only())).toThrow(/built from source now, not installed from Debian/)
  })

  test('the path is per-architecture, so an arm64 host is not handed the amd64 binary', () => {
    expect(shippedRaucPath('arm64')).not.toBe(shippedRaucPath('amd64'))
    expect(() => requireHostRauc('arm64', only(shippedRaucPath('amd64')))).toThrow(/out-arm64\/rauc not found/)
  })
})

// The argument parser.

describe('the arguments, and the defaults they fall back to', () => {
  test('POSITIVE CONTROL: no arguments and no environment is the shipping invocation', () => {
    expect(parseArgs([], {})).toEqual({
      board: DEFAULT_BOARD,
      version: '0.0.0-dev',
      outDir: join(REPO_ROOT, '_out', DEFAULT_BOARD),
      boardDir: join(REPO_ROOT, 'os', 'boards', DEFAULT_BOARD, 'bsp'),
    })
  })

  test('a positional VERSION is taken, exactly as `bash os/update/bundle.sh 1.2.3` took one', () => {
    expect(parseArgs(['1.2.3'], {}).version).toBe('1.2.3')
  })

  test('MOS_BUNDLE_VERSION is the fallback, and the positional beats it', () => {
    expect(parseArgs([], { MOS_BUNDLE_VERSION: '2.0.0' }).version).toBe('2.0.0')
    expect(parseArgs(['3.0.0'], { MOS_BUNDLE_VERSION: '2.0.0' }).version).toBe('3.0.0')
  })

  test('a bad version is refused BY THE PARSER, before any file is read', () => {
    expect(() => parseArgs(['-not-a-version'], {})).toThrow(/unknown argument/)
    expect(() => parseArgs(['1 2'], {})).toThrow(/not a plain version string/)
  })

  test('MOS_BOARD selects the board, and every default follows it', () => {
    const o = parseArgs([], { MOS_BOARD: 'x64' })
    expect(o.board).toBe('x64')
    expect(o.outDir).toBe(join(REPO_ROOT, '_out', 'x64'))
    expect(o.boardDir).toBe(join(REPO_ROOT, 'os', 'boards', 'x64', 'bsp'))
  })

  test('--board beats MOS_BOARD, and is not read as a version', () => {
    const o = parseArgs(['--board', 'x64'], { MOS_BOARD: 'cx3576' })
    expect(o.board).toBe('x64')
    expect(o.version).toBe('0.0.0-dev')
  })

  test('BOARD_DIR is honoured, because a BSP outside the tree is a normal thing to have', () => {
    expect(parseArgs([], { BOARD_DIR: '/elsewhere/bsp' }).boardDir).toBe('/elsewhere/bsp')
    expect(parseArgs(['--board-dir', '/other'], { BOARD_DIR: '/elsewhere/bsp' }).boardDir).toBe('/other')
  })

  test('--out-dir moves both the inputs and the output, together', () => {
    expect(parseArgs(['--out-dir', '/scratch'], {}).outDir).toBe('/scratch')
  })

  test('a flag with no value is refused rather than swallowing the next argument', () => {
    for (const flag of ['--board', '--out-dir', '--board-dir']) {
      expect(() => parseArgs([flag], {})).toThrow(new RegExp(`${flag} needs a value`))
    }
  })

  test('two positional versions are refused rather than one silently winning', () => {
    expect(() => parseArgs(['1.0.0', '2.0.0'], {})).toThrow(/two version strings were given/)
  })

  test('an unknown flag is refused, not forwarded', () => {
    expect(() => parseArgs(['--mkimage-v2'], {})).toThrow(/unknown argument "--mkimage-v2"/)
  })
})
