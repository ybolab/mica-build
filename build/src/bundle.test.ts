// The bundle builder, driven from the failing side.
//
// Every refusal in src/bundle.ts has a case here, and every case has a positive
// control beside it: without the control, a guard that refused everything would
// satisfy the whole table, because "this input is refused" is worth nothing
// until "this input is accepted" has been asserted about the same function.
// Every mutation is checked to be a mutation too -- `mutate` below throws when
// a replacement matched nothing, because a negative test whose input was never
// broken passes for the wrong reason.
//
// The fixtures are derived, not written down. The cmdlines are built out of
// boards/cx3576/board.env's own ROOTFS_A_GUID/ROOTFS_B_GUID and VERITY_SALT,
// the boot.cmd mutated below is the shipped one, and the manifest template is
// pkgs/rauc/manifest.raucm.in itself. A fixture restating a value the tree
// already declares is a second copy to drift, and these guards exist to catch
// drift.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertRaucMatchesImage,
  BOOT_IMAGES_BLOCK,
  BUNDLE_BOOT_FAT_LABEL,
  BUNDLE_SLOT_IMAGES,
  buildBundle,
  bundleMountsFor,
  bundleVerityEnvText,
  checkBundleInfo,
  checkRenderedManifest,
  envFileGet,
  GRUB_CMDLINE_PAIRS,
  grubCmdlineFragment,
  imageFilenameForSlot,
  MANIFEST_IN,
  openBundleToolbox,
  payloadReport,
  raucVersionInBuildEnv,
  raucVersionInReport,
  renderManifest,
  requireBootAttempts,
  ROOTFS_PRODUCER,
  spliceBootImages,
  verityFacts,
} from './bundle.ts'
import { loadGeometry, type Geometry } from './geometry.ts'
import { BOARDS_DIR, makeWorkDir, REPO_ROOT } from './paths.ts'
import { OPEN_TIMEOUT_MS } from './testing.ts'
import { Toolbox, type Toolset } from './toolbox.ts'
import { bundleToolset, shippedRaucPath } from './toolsets.ts'

const cx3576: Geometry = loadGeometry('cx3576')
const x64: Geometry = loadGeometry('x64')

/**
 * One edit, refused unless it edits something.
 *
 * The whole negative half of this file runs through here. A `replace` that
 * matched nothing returns its input unchanged and every assertion below it
 * then tests the UNBROKEN fixture -- green, and about nothing.
 */
function mutate(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to)
  if (out === text) {
    throw new Error(
      `the mutation ${String(from)} -> ${JSON.stringify(to)} changed nothing, so the case below `
      + `would run against the UNBROKEN fixture and pass by asserting the guard stayed quiet`,
    )
  }
  return out
}

// Fixtures, derived from the tree.

const ROOT_HASH = '776ffaf3c23c995829e39e443ef46e0b2ea5dd40d8a0ba9aa8849dfb9335f49f'
const SALT = cx3576.veritySalt

/** A slot's kernel cmdline in the shape rootfs/build.sh emits it. */
function cmdlineFor(geometry: Geometry, guidKey: string): string {
  const guid = geometry.require(guidKey).toLowerCase()
  return `dm-mod.create="rootfs,,,ro,0 190064 verity 1 PARTUUID=${guid} PARTUUID=${guid} `
    + `4096 4096 23758 23758 sha256 ${ROOT_HASH} ${SALT}" dm-mod.waitfor=PARTUUID=${guid} `
    + `root=/dev/dm-0 rootfstype=squashfs ro rootwait\n`
}

const CMDLINE_A = cmdlineFor(cx3576, 'ROOTFS_A_GUID')
const CMDLINE_B = cmdlineFor(cx3576, 'ROOTFS_B_GUID')

/** rootfs-verity.env as the rootfs build writes it. */
const VERITY_ENV = [
  `VERITY_ROOT_HASH=${ROOT_HASH}`,
  `VERITY_SALT=${SALT}`,
  'VERITY_HASH_ALGO=sha256',
  'VERITY_DATA_BLOCK_SIZE=4096',
  'VERITY_HASH_BLOCK_SIZE=4096',
  'VERITY_DATA_BLOCKS=23758',
  'VERITY_HASH_START_BLOCK=23758',
  'VERITY_DATA_SECTORS=190064',
  '',
].join('\n')

const BOOT_CMD = readFileSync(join(BOARDS_DIR, 'cx3576', 'boot.cmd'), 'utf8')
const MANIFEST_TEMPLATE = readFileSync(MANIFEST_IN, 'utf8')

function verityEnvArgs(overrides: Partial<Parameters<typeof bundleVerityEnvText>[0]> = {}) {
  return {
    cmdline: CMDLINE_A,
    cmdlinePath: '/out/boot-cmdline-a.txt',
    slot: 'A',
    rootfsGuid: cx3576.require('ROOTFS_A_GUID'),
    rootHash: ROOT_HASH,
    salt: SALT,
    verityEnvPath: '/out/rootfs-verity.env',
    ...overrides,
  }
}

// The readers.

describe('the env-file readers answer the way the shell\'s sed answers', () => {
  test('envFileGet takes the LAST assignment, as `| tail -n1` does', () => {
    expect(envFileGet('K=first\nOTHER=x\nK=second\n', 'K')).toBe('second')
  })

  test('a key that is not there is the EMPTY STRING, not an absence', () => {
    // Every caller compares against '' explicitly. An `undefined` would compare
    // its own way in JavaScript and the refusals would read differently.
    expect(envFileGet('OTHER=x\n', 'K')).toBe('')
  })

  test('a key that is a PREFIX of another is not read as that other', () => {
    expect(envFileGet('VERITY_SALT_EXTRA=no\nVERITY_SALT=yes\n', 'VERITY_SALT')).toBe('yes')
    expect(envFileGet('VERITY_SALT_EXTRA=no\n', 'VERITY_SALT')).toBe('')
  })

  test('the report is SPACE-separated and the build env is =-separated', () => {
    // Two files with two shapes. Reading either with the other separator finds
    // nothing, which is exactly the failure the comparison exists to prevent.
    expect(raucVersionInReport('bash\t7359\nRAUC_VERSION v1.13\n')).toBe('v1.13')
    expect(raucVersionInReport('RAUC_VERSION=v1.13\n')).toBe('')
    expect(raucVersionInBuildEnv('RAUC_VERSION=v1.13\nRAUC_SHA256=abc\n')).toBe('v1.13')
    expect(raucVersionInBuildEnv('RAUC_VERSION v1.13\n')).toBe('')
  })

  test('a build env assigning the version TWICE yields both, and cannot then agree', () => {
    // `sed -n 's/^RAUC_VERSION=//p'` with no `tail -n1`. Quietly taking the last
    // one would turn a malformed build env into a pass.
    expect(raucVersionInBuildEnv('RAUC_VERSION=v1.13\nRAUC_VERSION=v1.8\n')).toBe('v1.13\nv1.8')
  })
})

// G2..G5: the rauc version comparison.

describe('THE RAUC THAT BUILDS A BUNDLE MUST BE THE RAUC THAT INSTALLS IT', () => {
  const ok = {
    reportPath: '/out/rootfs-report.txt',
    reportText: 'coreutils\t21046\nRAUC_VERSION v1.13\n',
    buildEnvPath: '/pkgs/rauc/out-amd64/RAUC_VERSION.env',
    buildEnvText: 'RAUC_VERSION=v1.13\nRAUC_SHA256=372828c2\n',
  }

  test('POSITIVE CONTROL: two halves that agree pass, and say which version', () => {
    expect(assertRaucMatchesImage(ok)).toBe('rauc v1.13 here, v1.13 in the image')
  })

  test('a MISSING report is refused -- the image\'s version is unknown', () => {
    expect(() => assertRaucMatchesImage({ ...ok, reportText: undefined }))
      .toThrow(/rootfs-report\.txt not found; the image's RAUC version is unknown/)
  })

  test('a report that records NO version is refused: the comparison would find nothing', () => {
    const broken = mutate(ok.reportText, 'RAUC_VERSION v1.13\n', '')
    expect(() => assertRaucMatchesImage({ ...ok, reportText: broken }))
      .toThrow(/records no RAUC_VERSION.*pass by finding nothing/s)
  })

  test('a build env that records NO version is refused, and names the path it read', () => {
    expect(() => assertRaucMatchesImage({ ...ok, buildEnvText: 'RAUC_SHA256=372828c2\n' }))
      .toThrow(/no RAUC_VERSION from \/pkgs\/rauc\/out-amd64\/RAUC_VERSION\.env/)
  })

  test('an ABSENT build env is the same refusal, with <unset> when there is no path either', () => {
    expect(() => assertRaucMatchesImage({ ...ok, buildEnvPath: undefined, buildEnvText: undefined }))
      .toThrow(/no RAUC_VERSION from <unset>/)
  })

  test('a MISMATCH is refused, and it is the case commit 9a43a59 found by failure', () => {
    const older = mutate(ok.buildEnvText, 'v1.13', 'v1.8')
    expect(() => assertRaucMatchesImage({ ...ok, buildEnvText: older }))
      .toThrow(/this rauc is v1\.8, the image ships v1\.13/)
  })

  test('the version is compared as a STRING, so v1.13 and v1.8 are not numbers', () => {
    // The one comparison where a numeric reading would say 1.8 > 1.13.
    expect(() => assertRaucMatchesImage({ ...ok, buildEnvText: 'RAUC_VERSION=v1.130\n' }))
      .toThrow(/this rauc is v1\.130/)
  })
})

// G6, G6b: the boot-attempt credits.

describe('the boot-attempts range guard, and the empty read that made it vacuous', () => {
  test('POSITIVE CONTROL: the SHIPPED boot.cmd passes, and the guard SAW credits', () => {
    // Not "the target exited 0". The count is what distinguishes a guard that
    // compared four values from one that compared none.
    const seen = requireBootAttempts(cx3576, BOOT_CMD, 'boards/cx3576/boot.cmd')
    expect(seen.length).toBe(4)
    expect(seen).toEqual([3n, 3n, 3n, 3n])
  })

  test('a credit ABOVE the range is refused, naming both bounds', () => {
    const broken = mutate(BOOT_CMD, 'setenv BOOT_A_LEFT 3', 'setenv BOOT_A_LEFT 10')
    expect(() => requireBootAttempts(cx3576, broken, 'boot.cmd'))
      .toThrow(/boot-attempts value of 10;.*must stay in 1\.\.9/s)
  })

  test('a credit BELOW the range is refused too, which is the other half of a range', () => {
    const broken = mutate(BOOT_CMD, /BOOT_A_LEFT 3/, 'BOOT_A_LEFT 0')
    expect(() => requireBootAttempts(cx3576, broken, 'boot.cmd')).toThrow(/boot-attempts value of 0/)
  })

  test('THE EMPTY READ IS REFUSED, which is the shell\'s hole', () => {
    // the bundle contract: `done < <(grep -oE ... | awk ...)`. With no match the
    // loop body never runs and the guard passes having compared nothing --
    // before mkimage dies on the same path, which is how os-bundle-cx3576
    // stayed broken through two merges earlier in this campaign.
    const noCredits = BOOT_CMD.replaceAll(/BOOT_[AB]_LEFT [0-9]+/g, 'BOOT_LEFT_UNSET')
    expect(noCredits).not.toBe(BOOT_CMD)
    expect(() => requireBootAttempts(cx3576, noCredits, 'boot.cmd'))
      .toThrow(/sets no BOOT_A_LEFT\/BOOT_B_LEFT credit at all.*pass by finding nothing/s)
  })

  test('an EMPTY boot.cmd is refused for the same reason, not accepted as "nothing wrong"', () => {
    expect(() => requireBootAttempts(cx3576, '', 'boot.cmd')).toThrow(/sets no BOOT_A_LEFT/)
  })

  test('the shell\'s own extraction is reproduced: a credit anywhere counts, not just after setenv', () => {
    // `grep -oE 'BOOT_[AB]_LEFT [0-9]+'` is deliberately not anchored to setenv.
    expect(requireBootAttempts(cx3576, '# a comment mentioning BOOT_A_LEFT 4\n', 'x')).toEqual([4n])
  })
})

// G7, G8: the verity facts.

describe('the root hash and salt are READ, and the salt is checked against the pin', () => {
  test('POSITIVE CONTROL: a well-formed rootfs-verity.env yields both', () => {
    expect(verityFacts(VERITY_ENV, '/out/rootfs-verity.env', SALT))
      .toEqual({ rootHash: ROOT_HASH, salt: SALT })
  })

  test('a missing VERITY_ROOT_HASH is refused, naming the producer', () => {
    const broken = mutate(VERITY_ENV, `VERITY_ROOT_HASH=${ROOT_HASH}\n`, '')
    expect(() => verityFacts(broken, '/out/rootfs-verity.env', SALT))
      .toThrow(new RegExp(`VERITY_ROOT_HASH missing from /out/rootfs-verity\\.env; fix ${ROOTFS_PRODUCER}`))
  })

  test('a salt that is not the PINNED one is refused: a random salt is not reproducible', () => {
    const broken = mutate(VERITY_ENV, `VERITY_SALT=${SALT}`, `VERITY_SALT=${'f'.repeat(64)}`)
    expect(() => verityFacts(broken, '/out/rootfs-verity.env', SALT))
      .toThrow(/does not match the pinned VERITY_SALT/)
  })

  test('an ABSENT salt is refused too -- it does not compare equal to the pin', () => {
    const broken = mutate(VERITY_ENV, `VERITY_SALT=${SALT}\n`, '')
    expect(() => verityFacts(broken, '/out/rootfs-verity.env', SALT)).toThrow(/salt '' does not match/)
  })

  test('the salt comparison folds CASE, because GPT tooling and the kernel disagree about it', () => {
    // NOT demonstrated by upper-casing the SHIPPED salt: cx3576 pins
    // 0000...0001, which has no letters in it, so `toUpperCase` is the identity
    // and the case below would have run against an unmutated fixture. The
    // mutate() guard caught exactly that. So the fold is driven against a salt
    // that HAS letters, on both sides of the comparison.
    const hex = 'abcdef0123456789'.repeat(4)
    const env = mutate(VERITY_ENV, `VERITY_SALT=${SALT}`, `VERITY_SALT=${hex}`)
    expect(verityFacts(env, '/x', hex.toUpperCase()).salt).toBe(hex)
    expect(() => verityFacts(env, '/x', `${hex.slice(0, -1)}0`)).toThrow(/does not match the pinned/)
  })
})

// G9..G13: one slot's verity env.

describe('a slot\'s mos-verity-<slot>.env, and the five cmdlines it refuses', () => {
  test('POSITIVE CONTROL: a correct slot-A cmdline yields the verity_args line', () => {
    const text = bundleVerityEnvText(verityEnvArgs())
    expect(text).toStartWith('verity_args=dm-mod.create="')
    expect(text).toContain('dm-mod.waitfor=PARTUUID=')
    expect(text).toEndWith('\n')
    expect(text.split('\n').filter(l => l !== '').length).toBe(1)
  })

  test('POSITIVE CONTROL: slot B is accepted against slot B\'s own GUID', () => {
    expect(bundleVerityEnvText(verityEnvArgs({
      cmdline: CMDLINE_B, slot: 'B', rootfsGuid: cx3576.require('ROOTFS_B_GUID'),
    }))).toContain(cx3576.require('ROOTFS_B_GUID').toLowerCase())
  })

  test('no dm-mod.create= is refused in ONE sentence shared with waitfor', () => {
    const broken = mutate(CMDLINE_A, /dm-mod\.create="[^"]*"/, 'root=/dev/mmcblk0p5')
    expect(() => bundleVerityEnvText(verityEnvArgs({ cmdline: broken })))
      .toThrow(/carries no dm-mod\.create=\/dm-mod\.waitfor= verity table for slot A/)
  })

  test('no dm-mod.waitfor= is refused with the SAME sentence', () => {
    // The cx3576 assembler gives the two failures their own sentences; the
    // bundle builder deliberately reports the shared missing-table contract.
    const broken = mutate(CMDLINE_A, /dm-mod\.waitfor=[^ ]*/, 'rootwait')
    expect(() => bundleVerityEnvText(verityEnvArgs({ cmdline: broken })))
      .toThrow(/carries no dm-mod\.create=\/dm-mod\.waitfor= verity table for slot A/)
  })

  test('SLOT B\'S CMDLINE UNDER SLOT A\'S GUID is refused: each slot points at its own rootfs', () => {
    // The mutation that matters most here is not a malformed file: it is a
    // CORRECT file for the other slot. Both boot; one boots the wrong rootfs.
    expect(() => bundleVerityEnvText(verityEnvArgs({ cmdline: CMDLINE_B })))
      .toThrow(/slot-A verity table.*does not reference PARTUUID/s)
  })

  test('a waitfor naming a DIFFERENT partition than the table is refused', () => {
    const guidB = cx3576.require('ROOTFS_B_GUID').toLowerCase()
    const broken = mutate(CMDLINE_A, /dm-mod\.waitfor=PARTUUID=[0-9a-f-]+/, `dm-mod.waitfor=PARTUUID=${guidB}`)
    expect(() => bundleVerityEnvText(verityEnvArgs({ cmdline: broken })))
      .toThrow(/slot-A dm-mod\.waitfor=.*must name the same partition the verity table uses/s)
  })

  test('a table carrying SOME OTHER BUILD\'S root hash is refused', () => {
    const broken = mutate(CMDLINE_A, ROOT_HASH, 'b'.repeat(64))
    expect(() => bundleVerityEnvText(verityEnvArgs({ cmdline: broken })))
      .toThrow(/does not carry the root hash/)
  })

  test('a table carrying the wrong SALT is refused -- the check the cx3576 assembly contract does NOT have', () => {
    // The assembler compares the salt only against the pin. The bundle builder
    // additionally requires it to appear in the table it is about to SIGN.
    const broken = mutate(CMDLINE_A, ` ${SALT}"`, ` ${'e'.repeat(64)}"`)
    expect(() => bundleVerityEnvText(verityEnvArgs({ cmdline: broken })))
      .toThrow(/does not carry the salt/)
  })

  test('every identifier comparison folds CASE, as the cx3576 assembly contract\'s lc() does', () => {
    const upper = CMDLINE_A.replaceAll(cx3576.require('ROOTFS_A_GUID').toLowerCase(), cx3576.require('ROOTFS_A_GUID'))
    expect(upper).not.toBe(CMDLINE_A)
    expect(() => bundleVerityEnvText(verityEnvArgs({ cmdline: upper }))).not.toThrow()
  })

  test('a cmdline with TWO tables yields the LAST per line, which is what sed yields', () => {
    // sed's leading wildcard is greedy. Reproduced because it decides what a
    // doctored cmdline produces, and "whatever the first match happens to be"
    // is not an answer.
    const guid = cx3576.require('ROOTFS_A_GUID').toLowerCase()
    const two = `dm-mod.create="first ${guid} ${ROOT_HASH} ${SALT}" `
      + `dm-mod.create="second ${guid} ${ROOT_HASH} ${SALT}" dm-mod.waitfor=PARTUUID=${guid}\n`
    expect(bundleVerityEnvText(verityEnvArgs({ cmdline: two }))).toContain('"second ')
  })
})

// G14, G15: the grub cmdline fragment.

describe('a grub board\'s slot cmdline fragment', () => {
  test('POSITIVE CONTROL: every pair is rendered, in order, as `set NAME=value`', () => {
    const out = grubCmdlineFragment(VERITY_ENV, '/out/rootfs-verity.env')
    expect(out.split('\n').filter(l => l !== '')).toEqual(
      GRUB_CMDLINE_PAIRS.map(([g, e]) => `set ${g}=${envFileGet(VERITY_ENV, e)}`),
    )
    expect(out).toEndWith('\n')
  })

  test('the pair list is not empty, or the loop below asserts nothing', () => {
    expect(GRUB_CMDLINE_PAIRS.length).toBe(8)
  })

  test('EVERY missing VERITY_* key is refused, one case per key', () => {
    // One case per key rather than one for the family: a loop that reads seven
    // of eight names correctly is exactly the drift this is here to catch.
    for (const [, envName] of GRUB_CMDLINE_PAIRS) {
      const broken = mutate(VERITY_ENV, new RegExp(`^${envName}=.*\\n`, 'm'), '')
      expect(() => grubCmdlineFragment(broken, '/out/rootfs-verity.env'))
        .toThrow(new RegExp(`${envName} missing from /out/rootfs-verity\\.env`))
    }
  })

  test('a root hash that is PRESENT and not a hash is refused by the closing check', () => {
    // Not redundant with the per-key check above: this one is about a value
    // that exists. A truncated or re-encoded hash reaches the device as a table
    // GRUB cannot use, and every slot installed from that bundle refuses to boot.
    const broken = mutate(VERITY_ENV, `VERITY_ROOT_HASH=${ROOT_HASH}`, 'VERITY_ROOT_HASH=deadbeef')
    expect(() => grubCmdlineFragment(broken, '/x')).toThrow(/carries no root hash/)
  })

  test('an UPPERCASE root hash is refused too, because GRUB\'s reader is the lowercase one', () => {
    const broken = mutate(VERITY_ENV, ROOT_HASH, ROOT_HASH.toUpperCase())
    expect(() => grubCmdlineFragment(broken, '/x')).toThrow(/carries no root hash/)
  })

  test('the x64 board really is the grub board this branch is for', () => {
    expect(x64.bootloader).toBe('grub')
    expect(cx3576.bootloader).toBe('uboot')
  })
})

// G16, G17: the manifest.

describe('the manifest is spliced by LINE, then substituted', () => {
  test('POSITIVE CONTROL: the SHIPPED template renders and passes both checks', () => {
    const rendered = renderManifest({ template: MANIFEST_TEMPLATE, compatible: 'mos-cx3576', version: '1.2.3' })
    expect(() => checkRenderedManifest(rendered, MANIFEST_IN)).not.toThrow()
    expect(rendered).toContain('compatible=mos-cx3576')
    expect(rendered).toContain('version=1.2.3')
    expect(rendered).toContain('[image.boot]\nfilename=boot.vfat\n')
    expect(rendered).toContain('[image.rootfs]')
  })

  // The $-expansion class, driven from the failing side.
  //
  // the bundle contract substituted with `sed`, where an `&` in the
  // replacement expands to the whole match; BUNDLE_COMPATIBLE has no guard
  // against one (BUNDLE_VERSION does). The first version of this port fixed `&`
  // and reintroduced the SAME CLASS under `$`, because a string replacement in
  // JavaScript is not literal either -- it expands $&, $`, $' , $$ and $n.
  //
  // Every one of these five was measured expanding before the fix. They are
  // cases rather than a loop so a failure names the sequence that broke.
  test.each([
    ['&  -- what sed expanded, and the reason this guard exists', 'mos-a&b'],
    ['$& -- the whole match', 'mos-a$&b'],
    ['$` -- everything before the match', 'mos-a$`b'],
    ["$' -- everything after the match", "mos-a$'b"],
    ['$$ -- an escaped dollar', 'mos-a$$b'],
    ['$1 -- a capture group that does not exist', 'mos-a$1b'],
  ])('a compatible carrying %s lands byte for byte', (_name, compatible) => {
    const rendered = renderManifest({ template: MANIFEST_TEMPLATE, compatible, version: '1.2.3' })
    expect(rendered).toContain(`compatible=${compatible}`)
    // The failing side is specific: the placeholder must not come BACK. That is
    // what $& did -- it re-inserted '@COMPATIBLE@' into the value.
    expect(rendered).not.toContain('@COMPATIBLE@')
  })

  test('and the VERSION side too, though its own guard already refuses these', () => {
    // renderManifest does not enforce the version regex -- readVersion does, one
    // layer up -- so this function must be safe on its own terms.
    const rendered = renderManifest({ template: MANIFEST_TEMPLATE, compatible: 'mos-cx3576', version: '1.2.3$&x' })
    expect(rendered).toContain('version=1.2.3$&x')
    expect(rendered).not.toContain('@VERSION@')
  })

  test('POSITIVE CONTROL: an ordinary mos-<board> is untouched by the fix', () => {
    // Without this, a renderManifest that returned its input unchanged would
    // satisfy every case above.
    const rendered = renderManifest({ template: MANIFEST_TEMPLATE, compatible: 'mos-x64', version: '0.0.0-dev' })
    expect(rendered).toContain('compatible=mos-x64')
    expect(rendered).toContain('version=0.0.0-dev')
    expect(rendered).not.toContain('@COMPATIBLE@')
    expect(rendered).not.toContain('@VERSION@')
  })

  test('the boot block is spliced where @BOOT_IMAGES@ was, and the placeholder is gone', () => {
    expect(MANIFEST_TEMPLATE).toContain('@BOOT_IMAGES@')
    const rendered = renderManifest({ template: MANIFEST_TEMPLATE, compatible: 'c', version: 'v' })
    expect(rendered).not.toContain('@BOOT_IMAGES@')
  })

  test('awk\'s record rules are reproduced: no trailing blank line, and a final partial line prints', () => {
    expect(spliceBootImages('a\nb\n', '')).toBe('a\nb\n')
    expect(spliceBootImages('a\nb', '')).toBe('a\nb\n')
    expect(spliceBootImages('', '')).toBe('')
    expect(spliceBootImages('a\n@BOOT_IMAGES@\nz\n', 'x\ny\n')).toBe('a\nx\ny\nz\n')
  })

  test('a line that merely CONTAINS the placeholder is not a splice point, as `$0 ==` is not a match', () => {
    expect(spliceBootImages('# see @BOOT_IMAGES@ below\n', 'x\n')).toBe('# see @BOOT_IMAGES@ below\n')
  })

  test('an UNRENDERED placeholder in a VALUE is refused, and the offender is listed', () => {
    const broken = mutate(MANIFEST_TEMPLATE, 'compatible=@COMPATIBLE@', 'compatible=@COMPAT@')
    const rendered = renderManifest({ template: broken, compatible: 'mos-cx3576', version: '1.2.3' })
    let message = ''
    try { checkRenderedManifest(rendered, MANIFEST_IN) } catch (e) { message = (e as Error).message }
    expect(message).toContain('unrendered placeholder left in a manifest VALUE')
    expect(message).toContain('compatible=@COMPAT@')
  })

  test('A COMMENT NAMING THE OTHER TEMPLATE\'S PLACEHOLDER IS NOT AN OFFENCE', () => {
    // The shipped template documents @SLOTS@ by name, and a check over the raw
    // bytes once rejected a correct manifest for saying what it does.
    expect(MANIFEST_TEMPLATE).toMatch(/^#.*@SLOTS@/m)
    const rendered = renderManifest({ template: MANIFEST_TEMPLATE, compatible: 'c', version: 'v' })
    expect(rendered).toContain('@SLOTS@')
    expect(() => checkRenderedManifest(rendered, MANIFEST_IN)).not.toThrow()
  })

  test('an INDENTED comment is excluded too, which is what [[:space:]]* buys', () => {
    const rendered = '[update]\ncompatible=c\n   # about @SLOTS@\nformat=verity\n'
    expect(() => checkRenderedManifest(rendered, MANIFEST_IN)).not.toThrow()
  })

  test('losing format=verity is refused: rauc 1.8 has no --bundle-format flag', () => {
    const broken = mutate(MANIFEST_TEMPLATE, /^format=verity$/m, 'format=plain')
    const rendered = renderManifest({ template: broken, compatible: 'c', version: 'v' })
    expect(() => checkRenderedManifest(rendered, MANIFEST_IN))
      .toThrow(/does not declare '\[bundle\] format=verity'/)
  })

  test('a COMMENTED-OUT format=verity does not satisfy the check', () => {
    const broken = mutate(MANIFEST_TEMPLATE, /^format=verity$/m, '#format=verity')
    const rendered = renderManifest({ template: broken, compatible: 'c', version: 'v' })
    expect(() => checkRenderedManifest(rendered, MANIFEST_IN)).toThrow(/format=verity/)
  })

  test('the boot block is the one string both branches produce', () => {
    expect(BOOT_IMAGES_BLOCK).toBe('[image.boot]\nfilename=boot.vfat\n')
  })
})

// G18..G20: reading the bundle back.

describe('the bundle read back through rauc, compared against what was asked for', () => {
  const info = {
    compatible: 'mos-cx3576',
    version: '0.0.0-dev',
    images: [
      { rootfs: { filename: 'rootfs.img', checksum: 'aa' } },
      { boot: { filename: 'boot.vfat', checksum: 'bb' } },
    ],
  }
  const expected = { compatible: 'mos-cx3576', version: '0.0.0-dev' }

  test('POSITIVE CONTROL: the shape a real rauc prints is accepted', () => {
    expect(() => checkBundleInfo(info, expected)).not.toThrow()
  })

  test('the slot list is not empty, or the loop asserts nothing', () => {
    expect(BUNDLE_SLOT_IMAGES.map(([c, f]) => `${c}:${f}`)).toEqual(['rootfs:rootfs.img', 'boot:boot.vfat'])
  })

  test('a compatible that is not the one asked for is refused', () => {
    expect(() => checkBundleInfo({ ...info, compatible: 'mos-x64' }, expected))
      .toThrow(/bundle compatible is 'mos-x64', expected 'mos-cx3576'/)
  })

  test('an ABSENT compatible reads as the four characters `null`, as `jq -r` prints it', () => {
    const { compatible: _drop, ...rest } = info
    expect(() => checkBundleInfo(rest, expected)).toThrow(/bundle compatible is 'null'/)
  })

  test('a version that is not the one asked for is refused', () => {
    expect(() => checkBundleInfo({ ...info, version: '9.9.9' }, expected))
      .toThrow(/bundle version is '9\.9\.9', expected '0\.0\.0-dev'/)
  })

  test('EACH slot class is checked, and a wrong filename in either is refused', () => {
    for (const [slotClass, filename] of BUNDLE_SLOT_IMAGES) {
      const wrong = {
        ...info,
        images: info.images.map(e => (slotClass in e
          ? { [slotClass]: { filename: 'wrong.img' } }
          : e)),
      }
      expect(() => checkBundleInfo(wrong, expected))
        .toThrow(new RegExp(`slot class '${slotClass}' is 'wrong\\.img', expected '${filename.replace('.', '\\.')}'`))
    }
  })

  test('A MISSING SLOT IMAGE reads as the EMPTY STRING, which is what `jq | select` prints', () => {
    // The one answer that is not a value. A port that turned it into undefined
    // would report a different sentence for the same broken bundle.
    expect(imageFilenameForSlot({ images: [{ rootfs: { filename: 'r.img' } }] }, 'boot')).toBe('')
    expect(() => checkBundleInfo({ ...info, images: [info.images[0]!] }, expected))
      .toThrow(/slot class 'boot' is '', expected 'boot\.vfat'/)
  })

  test('an images key that is not an array does not throw its own way', () => {
    expect(imageFilenameForSlot({ images: 'nope' }, 'boot')).toBe('')
    expect(imageFilenameForSlot({}, 'boot')).toBe('')
  })
})

// G21: the payload digest.

describe('the payload digest, the bundle\'s identity', () => {
  let work = ''
  beforeAll(() => { work = makeWorkDir('payload') })
  afterAll(() => { if (work !== '') rmSync(work, { recursive: true, force: true }) })

  /** A file with a squashfs superblock's magic and a bytes_used at offset 40. */
  function fakeBundle(name: string, magic: string, used: number, total: number): string {
    const buf = Buffer.alloc(total)
    buf.write(magic, 0, 'latin1')
    buf.writeBigUInt64LE(BigInt(used), 40)
    for (let i = 48; i < total; i += 1) buf[i] = i & 0xff
    const path = join(work, name)
    writeFileSync(path, buf)
    return path
  }

  test('POSITIVE CONTROL: bytes_used is read at offset 40 and rounded up to 4096', () => {
    const path = fakeBundle('ok.raucb', 'hsqs', 5000, 16384)
    const r = payloadReport(path)
    expect(r.payloadBytes).toBe(8192)
    expect(r.bundleBytes).toBe(16384)
    expect(r.payloadSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  test('a bytes_used that is ALREADY a multiple of 4096 is not rounded up again', () => {
    expect(payloadReport(fakeBundle('exact.raucb', 'hsqs', 8192, 16384)).payloadBytes).toBe(8192)
  })

  test('THE DIGEST COVERS THE HEAD ONLY, so a changed TAIL does not move it', () => {
    // This is the whole reason the gate is the payload and not the file: rauc
    // salts the bundle's own verity hash tree at random and the CMS signature
    // carries a signingTime, so two correct builds differ after the payload.
    const a = fakeBundle('tail-a.raucb', 'hsqs', 4096, 16384)
    const b = fakeBundle('tail-b.raucb', 'hsqs', 4096, 16384)
    const buf = readFileSync(b)
    buf[12000] = (buf[12000]! ^ 0xff) & 0xff
    writeFileSync(b, buf)
    expect(payloadReport(a).payloadSha256).toBe(payloadReport(b).payloadSha256)
  })

  test('AND IT MOVES WHEN THE HEAD DOES -- the control for the assertion above', () => {
    const a = fakeBundle('head-a.raucb', 'hsqs', 8192, 16384)
    const b = fakeBundle('head-b.raucb', 'hsqs', 8192, 16384)
    const buf = readFileSync(b)
    buf[100] = (buf[100]! ^ 0xff) & 0xff
    writeFileSync(b, buf)
    expect(payloadReport(a).payloadSha256).not.toBe(payloadReport(b).payloadSha256)
  })

  test('a file that does not start with a squashfs superblock is refused', () => {
    expect(() => payloadReport(fakeBundle('bad.raucb', 'ELF\0', 4096, 16384)))
      .toThrow(/does not start with a squashfs superblock/)
  })

  test('the magic is checked BEFORE bytes_used, because a wrong one yields a number too', () => {
    // `head -c <huge>` is "the whole file", not an error -- so a bytes_used read
    // out of something that is not a superblock would hash the whole thing and
    // report a digest for it.
    const path = fakeBundle('huge.raucb', 'nope', 2 ** 40, 16384)
    expect(() => payloadReport(path)).toThrow(/squashfs superblock/)
  })
})

// --- G22: the route that cannot honour the provenance claim ------------------

describe('the bundle toolbox refuses a route that cannot carry the shipped rauc', () => {
  test('the HOST route is refused outright, so `provenance: shipped` cannot be a claim about PATH', async () => {
    // `carry` is a `docker cp`; on a host route there is nowhere to carry the
    // binary to, so the toolset's `provenance: 'shipped'` claim would be made
    // about whatever `rauc` PATH resolved to first. The refusal is the policy's
    // (docs/design/build.md section 0) and it fires before a container starts,
    // which is why this case needs no rauc to have been built.
    const shipped = shippedRaucPath('amd64')
    if (!existsSync(shipped)) {
      expect(() => bundleToolset({ arch: 'amd64' })).toThrow(/make os-rauc/)
      return
    }
    await expect(openBundleToolbox({ raucBin: shipped, mounts: [REPO_ROOT], route: 'host' }))
      .rejects.toThrow(/docs\/design\/build\.md section 0/)
  }, OPEN_TIMEOUT_MS)

  test('a raucBin that is not there is refused before a container is started', () => {
    expect(() => bundleToolset({ raucBin: '/nowhere/rauc' })).toThrow(/does not exist/)
    expect(() => bundleToolset({ raucBin: '/nowhere/rauc' })).toThrow(/9a43a59/)
  })
})

describe('the mount set is derived from the inputs, and nests nothing', () => {
  const inputs = {
    board: 'cx3576',
    kernelImage: '/elsewhere/bsp/out/kernel/Image',
    dtb: '/elsewhere/bsp/out/kernel/rk3576-src.dtb',
    rootfsVerityImg: join(REPO_ROOT, '_out/cx3576/rootfs-verity.img'),
    rootfsVerityEnv: join(REPO_ROOT, '_out/cx3576/rootfs-verity.env'),
    rootfsReport: join(REPO_ROOT, '_out/cx3576/rootfs-report.txt'),
    raucBuildEnv: join(REPO_ROOT, 'pkgs/rauc/out-amd64/RAUC_VERSION.env'),
    cert: '/secrets/signer.cert.pem',
    key: '/secrets/signer.key.pem',
    keyring: '/secrets/ca.cert.pem',
    bundleOut: join(REPO_ROOT, '_out/cx3576/mos-cx3576-1.raucb'),
    bundleVersion: '1', bundleCompatible: 'mos-cx3576',
  }

  test('a BSP and a key directory outside the tree are both mounted', () => {
    // The shell bind-mounts BOARD_DIR and each of the three key files; real
    // signing material lives outside the repository and must keep working.
    const mounts = bundleMountsFor(inputs, join(REPO_ROOT, 'build/.work/bundle-x'))
    expect(mounts).toContain('/elsewhere/bsp/out/kernel')
    expect(mounts).toContain('/secrets')
    expect(mounts).toContain(REPO_ROOT)
  })

  test('a directory already covered by another mount is dropped', () => {
    // docker accepts nested -v flags; the inner one shadows writes made through
    // the outer, which is a failure that looks like a file that never appeared.
    const mounts = bundleMountsFor(inputs, join(REPO_ROOT, 'build/.work/bundle-x'))
    for (const m of mounts) {
      expect(mounts.filter(o => o !== m && m.startsWith(`${o}/`))).toEqual([])
    }
    expect(mounts.filter(m => m.startsWith(`${REPO_ROOT}/`))).toEqual([])
  })
})

// The whole path, against a real rauc.

/**
 * The toolset the end-to-end case below runs in. Its `provenance` mark is a declaration this test makes about its own
 * container, and it is 'shipped' so that the assembly can be driven in a clean
 * checkout where pkgs/rauc/out-amd64/rauc has not been built. That is the
 * same freedom rauc.test.ts takes in the other direction, where it declares its
 * container's packaged rauc 'distro'. Nothing about a fixture bundle ships.
 *
 * What is being tested here is the assembly, not the provenance: that rule --
 * a bundle is written only by the rauc this tree built -- is asserted three
 * times elsewhere, none using this toolset (rauc.test.ts against a 'distro'
 * toolset and one marked with nothing, and above where openBundleToolbox
 * refuses the host route).
 */
const BUNDLE_E2E: Toolset = {
  key: 'bundle-e2e',
  imageKey: 'IMAGE_DEBIAN_TRIXIE',
  manager: 'apt',
  packages: [
    'rauc', 'squashfs-tools', 'dosfstools', 'mtools', 'u-boot-tools', 'jq', 'openssl',
  ],
  tools: [
    'rauc', 'mksquashfs', 'mcopy', 'mkimage', 'jq', 'mkfs.vfat', 'truncate', 'cp', 'find', 'touch',
    // Beyond bundleToolset's list: openssl to make a signing pair, and
    // unsquashfs plus mdir to read the finished bundle's boot payload back.
    'openssl', 'unsquashfs', 'mdir', 'minfo',
  ],
  provenance: 'shipped',
}

describe('buildBundle end to end, against a real rauc', () => {
  let tb: Toolbox
  let work = ''
  let inputs: Parameters<typeof buildBundle>[0]

  beforeAll(async () => {
    work = makeWorkDir('bundle-e2e')
    tb = await Toolbox.open(BUNDLE_E2E, { mounts: [REPO_ROOT], cwd: work })

    const cert = join(work, 'signer.cert.pem')
    const key = join(work, 'signer.key.pem')
    await tb.must(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-subj', '/CN=os-build-bundle-test', '-keyout', key, '-out', cert])

    // Deterministic but INCOMPRESSIBLE, for the reason rauc.test.ts records:
    // rauc refuses a payload that compresses below its own block size.
    const noise = (bytes: number, seedIn: number): Buffer => {
      const b = Buffer.alloc(bytes)
      let seed = seedIn
      for (let i = 0; i < bytes; i += 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        b[i] = (seed >>> 16) & 0xff
      }
      return b
    }
    const rootfsImg = join(work, 'rootfs-verity.img')
    writeFileSync(rootfsImg, noise(1 << 20, 0x2545f491))
    const kernel = join(work, 'Image')
    writeFileSync(kernel, noise(1 << 18, 0x1234567))
    const dtb = join(work, 'rk3576-src.dtb')
    writeFileSync(dtb, noise(1 << 14, 0x89abcdef))
    const verityEnv = join(work, 'rootfs-verity.env')
    writeFileSync(verityEnv, VERITY_ENV)
    const cmdlineA = join(work, 'boot-cmdline-a.txt')
    const cmdlineB = join(work, 'boot-cmdline-b.txt')
    writeFileSync(cmdlineA, CMDLINE_A)
    writeFileSync(cmdlineB, CMDLINE_B)
    const report = join(work, 'rootfs-report.txt')
    writeFileSync(report, 'coreutils\t21046\nRAUC_VERSION v9.9\n')
    const buildEnv = join(work, 'RAUC_VERSION.env')
    writeFileSync(buildEnv, 'RAUC_VERSION=v9.9\n')

    // The system.conf is RENDERED and gitignored, so a checkout that has never
    // run the rootfs build has none. rauc needs one to answer `info --conf`, and
    // what this case is about is the assembly rather than that file's contents,
    // so a minimal one is written here.
    const conf = join(work, 'system.conf')
    writeFileSync(conf, [
      '[system]', 'compatible=mos-e2e', 'bootloader=uboot', 'statusfile=/tmp/rauc.status', '',
      '[keyring]', 'path=/keyring.pem', '',
      '[slot.rootfs.0]', 'device=/dev/null', 'type=raw', 'bootname=A', '',
    ].join('\n'))

    inputs = {
      board: 'cx3576',
      kernelImage: kernel,
      dtb,
      rootfsVerityImg: rootfsImg,
      rootfsVerityEnv: verityEnv,
      rootfsReport: report,
      raucBuildEnv: buildEnv,
      bootCmdlineA: cmdlineA,
      bootCmdlineB: cmdlineB,
      cert,
      key,
      keyring: cert,
      bundleOut: join(work, 'e2e.raucb'),
      bundleVersion: '0.0.0-e2e',
      bundleCompatible: 'mos-e2e',
      systemConf: conf,
    }
  }, OPEN_TIMEOUT_MS)

  afterAll(async () => {
    await tb?.close()
    if (work !== '') rmSync(work, { recursive: true, force: true })
  }, OPEN_TIMEOUT_MS)

  test('a bundle is built, signed, read back, and the credit guard saw REAL credits', async () => {
    const r = await buildBundle(inputs, { toolbox: tb, log: () => {} })
    expect(r.bootAttemptsSeen).toBe(4)
    expect(existsSync(r.bundleOut)).toBe(true)
    expect(r.info.compatible).toBe('mos-e2e')
    expect(r.info.version).toBe('0.0.0-e2e')
    expect(r.payload.payloadSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(r.payload.bundleBytes).toBeGreaterThan(r.payload.payloadBytes)
  }, OPEN_TIMEOUT_MS)

  test('THE PAYLOAD IS A PURE FUNCTION OF THE INPUTS: a second build hashes the same', async () => {
    // Asserted by the suite rather than by comparing two builds by hand, so a
    // change that puts a clock back into the staging path is a red test rather
    // than a hash somebody has to notice.
    const first = await buildBundle({ ...inputs, bundleOut: join(work, 'det-1.raucb') }, { toolbox: tb, log: () => {} })
    const second = await buildBundle({ ...inputs, bundleOut: join(work, 'det-2.raucb') }, { toolbox: tb, log: () => {} })
    expect(second.payload.payloadSha256).toBe(first.payload.payloadSha256)
    expect(second.payload.payloadBytes).toBe(first.payload.payloadBytes)
  }, OPEN_TIMEOUT_MS)

  test('AND IT MOVES WHEN AN INPUT DOES -- the control for the test above', async () => {
    // Without this, a payloadReport that returned a constant would satisfy the
    // determinism assertion perfectly.
    const base = await buildBundle({ ...inputs, bundleOut: join(work, 'ctl-base.raucb') }, { toolbox: tb, log: () => {} })
    const other = await buildBundle(
      { ...inputs, bundleVersion: '0.0.1-e2e', bundleOut: join(work, 'ctl-other.raucb') },
      { toolbox: tb, log: () => {} },
    )
    expect(other.payload.payloadSha256).not.toBe(base.payload.payloadSha256)
  }, OPEN_TIMEOUT_MS)

  test('the staged boot payload carries exactly the five files, under a NEUTRAL label', async () => {
    // One image, two possible destinations: a bundle's boot payload must not
    // carry a slot's FAT identity. And the file LIST is the contract a
    // RAUC-installed slot boots from -- the unsuffixed mos-verity.env is
    // deliberately absent, because a factory slot carries none either.
    const out = join(work, 'peek.raucb')
    await buildBundle({ ...inputs, bundleOut: out }, { toolbox: tb, log: () => {} })
    // unsquashfs rather than `rauc extract`: rauc 1.13's extract loop-MOUNTS
    // the payload to verify it ("cannot check bundle payload without exclusive
    // access: unable to find mounted device for bundle", measured) and an
    // unprivileged container has no loop device. The squashfs sits at offset 0
    // of the bundle and unsquashfs ignores what follows it, so this reads the
    // shipped artefact rather than the staging tree -- which is the stronger
    // thing to read, and the staging tree is gone by now anyway.
    const extracted = join(work, 'extracted')
    await tb.must(['unsquashfs', '-n', '-d', extracted, out, 'boot.vfat'])
    const listed = await tb.must(['mdir', '-/', '-b', '-i', join(extracted, 'boot.vfat'), '::/'])
    expect(listed.stdout.split('\n').map(l => l.trim()).filter(l => l !== '').sort())
      .toEqual(['::/Image', '::/boot.scr', '::/mos-verity-a.env', '::/mos-verity-b.env', '::/rk3576-src.dtb'])
    const vol = await tb.must(['minfo', '-i', join(extracted, 'boot.vfat')])
    expect(vol.stdout).toContain(BUNDLE_BOOT_FAT_LABEL)
  }, OPEN_TIMEOUT_MS)

  test('the version mismatch refusal fires on the REAL path, before anything is written', async () => {
    // The pure case above proves the sentence; this proves the sentence is on
    // the path a build actually takes, and that nothing was written first.
    const out = join(work, 'never-written.raucb')
    const badEnv = join(work, 'RAUC_VERSION-bad.env')
    writeFileSync(badEnv, 'RAUC_VERSION=v1.8\n')
    await expect(buildBundle({ ...inputs, raucBuildEnv: badEnv, bundleOut: out }, { toolbox: tb, log: () => {} }))
      .rejects.toThrow(/this rauc is v1\.8, the image ships v9\.9/)
    expect(existsSync(out)).toBe(false)
  }, OPEN_TIMEOUT_MS)

  test('a boot.cmd with no credits stops the REAL path, which is the shell\'s vacuous pass', async () => {
    const noCredits = join(work, 'boot-no-credits.cmd')
    writeFileSync(noCredits, BOOT_CMD.replaceAll(/BOOT_[AB]_LEFT [0-9]+/g, 'BOOT_LEFT_UNSET'))
    const out = join(work, 'no-credits.raucb')
    await expect(buildBundle({ ...inputs, bootCmd: noCredits, bundleOut: out }, { toolbox: tb, log: () => {} }))
      .rejects.toThrow(/sets no BOOT_A_LEFT\/BOOT_B_LEFT credit at all/)
    expect(existsSync(out)).toBe(false)
  }, OPEN_TIMEOUT_MS)
})
