// rauc, against a real rauc, driven from the failing side.
//
// WHICH rauc, AND WHY IT MATTERS THAT THIS SAYS SO. The rauc that ships is
// built from pinned source by pkgs/rauc/build.sh, and in a clean checkout
// it does not exist yet. So the wrapper is exercised here against the base
// image's PACKAGED rauc -- a real rauc, which answers --version and reads a
// bundle truthfully -- and that toolset is marked `provenance: 'distro'`.
//
// The mark is not documentation. Commit 9a43a59: a bundle built by rauc 1.8
// was refused by the device's 1.13, "found by failure rather than by a check",
// and "a format difference would not have announced itself so kindly". So
// bundle() refuses a distro toolset outright, and that refusal is the first
// thing driven below.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeWorkDir, REPO_ROOT } from '../paths.ts'
import { OPEN_TIMEOUT_MS, TOOL_TIMEOUT_MS } from '../testing.ts'
import { Toolbox, ToolError, type Toolset } from '../toolbox.ts'
import { bundleToolset, shippedRaucPath } from '../toolsets.ts'
import { bundle, bundleArgs, info, infoArgs, version } from './rauc.ts'

/**
 * The distro toolset, plus what it takes to MAKE a bundle for `info` to read.
 *
 * squashfs-tools because rauc drives mksquashfs itself, and openssl because a
 * bundle is signed and the signing material is gitignored dev output.
 */
const RAUC_TEST: Toolset = {
  key: 'rauc-distro-test',
  imageKey: 'IMAGE_DEBIAN_TRIXIE',
  manager: 'apt',
  packages: ['rauc', 'squashfs-tools', 'openssl'],
  tools: ['rauc', 'mksquashfs', 'openssl'],
  provenance: 'distro',
}

let tb: Toolbox
let work = ''
let bundlePath = ''
let keyring = ''

beforeAll(async () => {
  work = makeWorkDir('rauc')
  tb = await Toolbox.open(RAUC_TEST, { mounts: [REPO_ROOT], cwd: work })

  // A self-signed pair and a one-image bundle, built ONCE so that info() has
  // something real to read. pkgs/rauc/gen-dev-keys.sh does the same for
  // the shipping path; nothing here touches that material.
  const cert = join(work, 'signer.cert.pem')
  const key = join(work, 'signer.key.pem')
  keyring = cert
  await tb.must(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
    '-subj', '/CN=os-build-test', '-keyout', key, '-out', cert])

  const stage = join(work, 'stage')
  mkdirSync(stage, { recursive: true })
  // Deterministic but INCOMPRESSIBLE: rauc drives mksquashfs and refuses a
  // payload that compresses to its own block size ("squashfs size (4096) must
  // be larger than 4096 bytes"), which a buffer of one repeated byte does. A
  // fixed LCG keeps the bundle the same on every run without being a constant.
  const payload = Buffer.alloc(1048576)
  let seed = 0x2545f491
  for (let i = 0; i < payload.length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    payload[i] = (seed >>> 16) & 0xff
  }
  writeFileSync(join(stage, 'rootfs.img'), payload)
  writeFileSync(join(stage, 'manifest.raucm'), [
    '[update]', 'compatible=mos-test', 'version=0.0.0-test', '',
    '[bundle]', 'format=verity', '',
    '[image.rootfs]', 'filename=rootfs.img', '',
  ].join('\n'))

  bundlePath = join(work, 'test.raucb')
  // bundleArgs directly, NOT bundle(): this toolset's rauc is a distro one and
  // bundle() refuses it, which is the behaviour under test three describes
  // below. What is wanted here is a bundle for info() to read.
  await tb.must(bundleArgs({ stageDir: stage, output: bundlePath, cert, key }))
}, OPEN_TIMEOUT_MS)

afterAll(async () => {
  await tb?.close()
  if (work !== '') rmSync(work, { recursive: true, force: true })
}, OPEN_TIMEOUT_MS)

describe('the argv shapes', () => {
  test('--conf comes BEFORE the subcommand, because rauc reads it as a global option', () => {
    expect(infoArgs({ bundle: 'b.raucb', conf: '/etc/rauc/system.conf', keyring: '/k.pem' }))
      .toEqual(['rauc', '--conf=/etc/rauc/system.conf', 'info', '--output-format=json', '--keyring=/k.pem', 'b.raucb'])
  })

  test('the mksquashfs arguments the bundle contract pins are carried verbatim', () => {
    // Without them rauc stamps the payload with the wall clock, the build
    // container's uid map and a thread count.
    const args = '-all-root -no-xattrs -noappend -processors 1 -mkfs-time 1577836800 -all-time 1577836800'
    expect(bundleArgs({ stageDir: 's', output: 'o.raucb', cert: 'c', key: 'k', mksquashfsArgs: args }))
      .toEqual(['rauc', 'bundle', `--mksquashfs-args=${args}`, '--cert=c', '--key=k', 's', 'o.raucb'])
  })
})

describe('a bundle is only written by the rauc this tree built', () => {
  test('a distro toolset is REFUSED, by name, before anything is written', async () => {
    const out = join(work, 'refused.raucb')
    await expect(bundle(tb, { stageDir: join(work, 'stage'), output: out, cert: 'c', key: 'k' }))
      .rejects.toThrow(/rauc-distro-test toolset, whose rauc is the base image's distro package/)
    await expect(bundle(tb, { stageDir: join(work, 'stage'), output: out, cert: 'c', key: 'k' }))
      .rejects.toThrow(/9a43a59/)
    // And nothing was written -- the refusal is before the tool, not after it.
    expect(existsSync(out)).toBe(false)
  })

  test('a toolset that records NO provenance is refused too: unrecorded is not a pass', async () => {
    const anonymous: Toolset = { ...RAUC_TEST, key: 'anonymous', provenance: undefined }
    const fake = Object.create(Object.getPrototypeOf(tb) as object, {
      toolset: { value: anonymous },
    }) as Toolbox
    await expect(bundle(fake, { stageDir: 's', output: 'o.raucb', cert: 'c', key: 'k' }))
      .rejects.toThrow(/of unrecorded origin/)
  })

  test('the shipping toolset refuses to open when the self-built binary is not there', () => {
    // In a clean checkout it is not: `make os-rauc` produces it. The refusal
    // names that command rather than letting "rauc: not found" surface from
    // inside a container, which reads like a missing package.
    const shipped = shippedRaucPath('amd64')
    if (existsSync(shipped)) {
      // On a tree that HAS built it, the toolset is the shipped one -- which is
      // the other half of the same assertion.
      expect(bundleToolset({ arch: 'amd64' }).provenance).toBe('shipped')
      expect(bundleToolset({ arch: 'amd64' }).carry?.[0]?.from).toBe(shipped)
    } else {
      expect(() => bundleToolset({ arch: 'amd64' })).toThrow(/make os-rauc/)
      expect(() => bundleToolset({ arch: 'amd64' })).toThrow(/9a43a59/)
    }
  })

  test('a raucBin that is named and absent is refused with the same sentence', () => {
    expect(() => bundleToolset({ raucBin: join(work, 'no-rauc-here') })).toThrow(/does not exist/)
  })
})

describe('against the real rauc', () => {
  test('--version answers, and it is the debian trixie rauc the image pins', async () => {
    const v = await version(tb)
    expect(v).toMatch(/^rauc [0-9]+\.[0-9]+/)
  }, TOOL_TIMEOUT_MS)

  test('info reads a real bundle back as JSON, with the fields the bundle builder checks', async () => {
    const parsed = await info(tb, { bundle: bundlePath, keyring })
    expect(parsed.compatible).toBe('mos-test')
    expect(parsed.version).toBe('0.0.0-test')
  }, TOOL_TIMEOUT_MS)

  test('info WITHOUT a keyring is REFUSED by rauc -- measured, and the opposite of what was assumed', async () => {
    // This wrapper's --keyring started out optional on the assumption that rauc
    // would read a bundle unverified without one. It does not: `rauc info`
    // exits 1 with "No keyring file or directory provided". That is the safer
    // behaviour and it is recorded here rather than in a comment, because M6d
    // will thread a keyring through the bundle contract's verify_bundle and
    // should not have to discover it by failure.
    let err: ToolError | undefined
    try { await info(tb, { bundle: bundlePath }) } catch (e) { err = e as ToolError }
    expect(err).toBeInstanceOf(ToolError)
    expect(err!.stderr).toContain('No keyring')
  }, TOOL_TIMEOUT_MS)

  test('a file that is not a bundle is a ToolError carrying rauc\'s words', async () => {
    const notABundle = join(work, 'not-a-bundle.raucb')
    writeFileSync(notABundle, 'this is not a rauc bundle\n')
    let err: ToolError | undefined
    try { await info(tb, { bundle: notABundle, keyring }) } catch (e) { err = e as ToolError }
    expect(err).toBeInstanceOf(ToolError)
    expect(err!.message).toContain('not-a-bundle.raucb')
    expect(err!.exitCode).not.toBe(0)
  }, TOOL_TIMEOUT_MS)

  test('a bundle that is not there is a ToolError, not an empty object', async () => {
    // `jq -r '.compatible'` over nothing yields null, which compares unequal to
    // everything and reports the wrong thing.
    await expect(info(tb, { bundle: join(work, 'absent.raucb'), keyring }))
      .rejects.toThrow(/could not read/)
  }, TOOL_TIMEOUT_MS)

  test('a wrong keyring is refused rather than reported as a bundle with no fields', async () => {
    const otherCert = join(work, 'other.cert.pem')
    await tb.must(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=someone-else', '-keyout', join(work, 'other.key.pem'), '-out', otherCert])
    await expect(info(tb, { bundle: bundlePath, keyring: otherCert })).rejects.toThrow(/could not read/)
  }, TOOL_TIMEOUT_MS)
})
