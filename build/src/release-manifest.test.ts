import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Signer } from '../../shared/update-envelope.ts'
import { canonicalJson, componentId } from './components.ts'
import { packArchive } from './component-archive.ts'
import { assembleRelease, gateRelease, type ReleaseInputs } from './release-manifest.ts'
import { sourceIdentity } from './release-cli.ts'
import { Toolbox } from './toolbox.ts'
import { OPEN_TIMEOUT_MS } from './testing.ts'

const IMAGE = 'mos-x64-20260909-164233.img'
let work: string
let inputs: ReleaseInputs
let keys: string[]
const read = (name: string) => JSON.parse(readFileSync(join(work, 'release', name), 'utf8'))
const write = (name: string, value: unknown) => writeFileSync(join(work, 'release', name), `${JSON.stringify(value, null, 2)}\n`)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function repin(name: string) {
  const manifest = read('manifest.json')
  for (const filename of [name, 'SHA256SUMS']) {
    if (filename === 'SHA256SUMS') writeFileSync(join(work, 'release/SHA256SUMS'), manifest.artifacts.filter((a: { filename: string }) => a.filename !== 'SHA256SUMS').map((a: { filename: string, sha256: string }) => `${a.sha256}  ${a.filename}\n`).join(''))
    const a = manifest.artifacts.find((a: { filename: string }) => a.filename === filename)
    const bytes = readFileSync(join(work, 'release', filename))
    a.bytes = bytes.length; a.sha256 = hash(bytes)
  }
  write('manifest.json', manifest)
}
beforeEach(() => {
  const scratch = new URL('../../.tmp/', import.meta.url).pathname
  mkdirSync(scratch, { recursive: true })
  work = mkdtempSync(join(scratch, 'release-test-'))
  for (const dir of ['kernel', 'root', 'firmware', 'meta/updates']) mkdirSync(join(work, dir), { recursive: true })
  const signer = new Signer(generateKeyPairSync('ed25519').privateKey, true)
  keys = [signer.publicKey]
  const bytes = Buffer.alloc(12288, 42)
  const artifact = { bytes: bytes.length, sha256: hash(bytes) }
  const d = JSON.parse(readFileSync(new URL('../../tests/component-contracts/deployment.json', import.meta.url), 'utf8'))
  d.kernel.boot.artifact = d.kernel.support.image = d.kernel.support.signature = d.rootfs.content.image = d.rootfs.content.signature = artifact
  d.kernel.id = componentId(d.kernel); d.rootfs.id = componentId(d.rootfs)
  writeFileSync(join(work, 'kernel/boot.efi'), bytes)
  packArchive(JSON.stringify(signer.sign(JSON.parse(canonicalJson(d)))), join(work, 'kernel'), join(work, 'root'), keys, join(work, 'update.mosupd'))
  const f = { schema: 'mos/firmware/v1', id: '', board: 'x64', arch: 'amd64', generation: 1, version: 'one', artifact, target: { format: 'efi', partition: 1, path: 'EFI/BOOT/BOOTX64.EFI' } }
  f.id = componentId(f)
  writeFileSync(join(work, 'firmware/firmware.json'), JSON.stringify(signer.sign(JSON.parse(canonicalJson(f)))))
  writeFileSync(join(work, 'firmware/BOOTX64.EFI'), bytes)
  writeFileSync(join(work, IMAGE), 'fixture image; image boot acceptance is separate\n')
  writeFileSync(join(work, 'packages.tsv'), '#package\tversion\tarchitecture\nmos-system\t1\tall\nlibc6\t2.41\tamd64\n')
  writeFileSync(join(work, 'meta/updates/manifest.json'), readFileSync(new URL('../../meta.example/updates/manifest.json', import.meta.url)))
  writeFileSync(join(work, 'meta/GENERATED'), 'DEVELOPMENT-GRADE\nDOMAINS=boot verity updates\n')
  writeFileSync(join(work, 'notes.md'), '# Current release\n\nDevelopment evidence only.\n')
  inputs = { out: join(work, 'release'), board: 'x64', version: d.version, channel: 'development', profile: 'dev',
    source: { commit: 'a'.repeat(40), dirty: true }, builderImages: { IMAGE_TEST: 'example@sha256:' + 'a'.repeat(64) },
    image: join(work, IMAGE), update: join(work, 'update.mosupd'), firmware: join(work, 'firmware'),
    packages: join(work, 'packages.tsv'), meta: join(work, 'meta'), notes: join(work, 'notes.md'),
    evidence: new URL('../../boards/x64/evidence.json', import.meta.url).pathname, keys }
})
afterEach(() => rmSync(work, { recursive: true, force: true }))

test('release preserves the build timestamp in the factory image name', () => {
  const filename = 'mos-x64-20260910-010203.img'
  const image = join(work, filename)
  renameSync(inputs.image, image)
  assembleRelease({ ...inputs, image })
  expect(read('manifest.json').artifacts.find((a: { role: string }) => a.role === 'image').filename).toBe(filename)
  expect(read('provenance.json').inputs.find((a: { role: string }) => a.role === 'image').filename).toBe(filename)
  expect(readFileSync(join(inputs.out, 'SHA256SUMS'), 'utf8')).toContain(`  ${filename}\n`)
})

test.each(['disk.img', 'image.img', 'mos-cx3576-20260909-164233.img', 'mos-x64-20260230-164233.img'])(
  'release refuses invalid factory image name %s', filename => {
    const image = join(work, filename)
    renameSync(inputs.image, image)
    expect(() => assembleRelease({ ...inputs, image })).toThrow('factory image filename')
  },
)

test('release gate refuses generic image names and duplicate image roles', () => {
  assembleRelease(inputs)
  const m = read('manifest.json')
  const image = m.artifacts.find((a: { role: string }) => a.role === 'image')
  image.filename = 'image.img'
  write('manifest.json', m)
  expect(() => gateRelease(inputs.out, keys)).toThrow('artifact filename or role')
  image.filename = IMAGE
  m.artifacts[1] = { ...image, filename: 'mos-x64-20260910-010203.img' }
  write('manifest.json', m)
  expect(() => gateRelease(inputs.out, keys)).toThrow('artifact filename or role')
})

test('current release binds independent artifacts and derives inventory and provenance', () => {
  assembleRelease(inputs)
  const report = gateRelease(inputs.out, keys)
  expect(report.manifest.schema).toBe('mos/release/v1')
  expect(report.manifest.board).toBe('x64')
  expect(read('sbom.cdx.json').components.map((c: { name: string }) => c.name)).toEqual(['libc6', 'mos-system'])
  expect(read('provenance.json').source).toEqual(inputs.source)
  expect(() => assembleRelease(inputs)).toThrow('exists')
})
test('missing, changed and unlisted release files are refused', () => {
  assembleRelease(inputs)
  writeFileSync(join(inputs.out, 'unlisted'), 'extra')
  expect(() => gateRelease(inputs.out, keys)).toThrow('file set')
  rmSync(join(inputs.out, 'unlisted'))
  writeFileSync(join(inputs.out, IMAGE), 'changed')
  expect(() => gateRelease(inputs.out, keys)).toThrow('digest or length')
  rmSync(join(inputs.out, IMAGE))
  expect(() => gateRelease(inputs.out, keys)).toThrow('file set')
})
test('symlink artifacts and parent traversal never satisfy the gate', () => {
  assembleRelease(inputs)
  rmSync(join(inputs.out, IMAGE)); symlinkSync(join(work, IMAGE), join(inputs.out, IMAGE))
  expect(() => gateRelease(inputs.out, keys)).toThrow('regular file')
  const m = read('manifest.json'); m.artifacts[0].filename = '../image.img'; write('manifest.json', m)
  expect(() => gateRelease(inputs.out, keys)).toThrow('artifact')
})
test('unknown release schema, fields and duplicate roles are refused', () => {
  assembleRelease(inputs)
  const m = read('manifest.json')
  write('manifest.json', { ...m, schema: 'mos/release/v0' }); expect(() => gateRelease(inputs.out, keys)).toThrow('schema')
  write('manifest.json', { ...m, trust: {} }); expect(() => gateRelease(inputs.out, keys)).toThrow('fields')
  m.artifacts[0].role = m.artifacts[1].role; write('manifest.json', m)
  expect(() => gateRelease(inputs.out, keys)).toThrow('artifact')
})
test('development markers refuse customer channels and malformed domain declarations', () => {
  expect(() => assembleRelease({ ...inputs, channel: 'stable' })).toThrow('development')
  writeFileSync(join(work, 'meta/GENERATED'), 'DEVELOPMENT-GRADE\nDOMAINS=boot\nDOMAINS=boot verity updates\n')
  expect(() => assembleRelease(inputs)).toThrow('development marker')
})
test('empty notes and duplicate package inventory are refused before output', () => {
  writeFileSync(inputs.notes, ' \n')
  expect(() => assembleRelease(inputs)).toThrow('notes')
  writeFileSync(inputs.notes, '# Notes')
  writeFileSync(inputs.packages, 'mos-system\t1\tall\nmos-system\t2\tall\n')
  expect(() => assembleRelease(inputs)).toThrow('duplicate package')
})
test('signed artifacts refuse unknown metadata keys and forged archive bytes even when repinned', () => {
  assembleRelease(inputs)
  const stranger = new Signer(generateKeyPairSync('ed25519').privateKey, true)
  expect(() => gateRelease(inputs.out, [stranger.publicKey])).toThrow()
  const path = join(inputs.out, 'update.mosupd'); const bytes = readFileSync(path); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; writeFileSync(path, bytes); repin('update.mosupd')
  expect(() => gateRelease(inputs.out, keys)).toThrow('object digest')
})
test('archive truncation and trailing data are refused even when repinned', () => {
  assembleRelease(inputs)
  const path = join(inputs.out, 'update.mosupd'); const bytes = readFileSync(path)
  writeFileSync(path, Buffer.concat([bytes, Buffer.from('extra')])); repin('update.mosupd')
  expect(() => gateRelease(inputs.out, keys)).toThrow('trailing')
  writeFileSync(path, bytes.subarray(0, -1)); repin('update.mosupd')
  expect(() => gateRelease(inputs.out, keys)).toThrow('truncated')
})
test('derived records cannot diverge from their measured inputs', () => {
  assembleRelease(inputs)
  const sbom = read('sbom.cdx.json'); sbom.components = []; write('sbom.cdx.json', sbom); repin('sbom.cdx.json')
  expect(() => gateRelease(inputs.out, keys)).toThrow('derived record')
})
test('firmware and evidence must match the release board', () => {
  expect(() => assembleRelease({ ...inputs, board: 'cx3576' })).toThrow('board')
  const ev = JSON.parse(readFileSync(inputs.evidence, 'utf8')); ev.bootAssurance = 'I4'; ev.evidenceRefs = [{ class: 'verity-root', ref: 'test' }]
  writeFileSync(join(work, 'evidence.json'), JSON.stringify(ev))
  expect(() => assembleRelease({ ...inputs, evidence: join(work, 'evidence.json') })).toThrow('evidence')
})

test.each(['ordinary', 'linked'])('shipped release CLI and documented verification commands execute (%s checkout)', async (kind) => {
  const repo = new URL('../../', import.meta.url).pathname
  const ordinary = join(work, 'checkout')
  const linked = join(work, 'linked')
  const fixtureGit = await Toolbox.open({ key: 'release-git-fixture', imageKey: 'IMAGE_ALPINE_3_21', manager: 'apk', packages: ['git'], tools: ['git'] }, { mounts: [work] })
  let commit: string
  const checkout = kind === 'ordinary' ? ordinary : linked
  try {
    const git = async (...args: string[]) => (await fixtureGit.must(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
      env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    })).stdout.trim()
    await git('init', '--initial-branch=fixture', ordinary)
    writeFileSync(join(ordinary, 'tracked.txt'), 'initial fixture\n')
    await git('-C', ordinary, 'add', 'tracked.txt')
    await git('-C', ordinary, 'commit', '--no-gpg-sign', '-m', 'Create isolated source fixture')
    const commonHead = await git('-C', ordinary, 'rev-parse', 'HEAD')
    await git('-C', ordinary, 'worktree', 'add', '--detach', linked, 'HEAD')
    if (kind === 'linked') {
      writeFileSync(join(linked, 'tracked.txt'), 'linked fixture baseline\n')
      await git('-C', linked, 'commit', '-am', 'Advance isolated linked fixture', '--no-gpg-sign')
    }
    commit = await git('-C', checkout, 'rev-parse', 'HEAD')
    if (kind === 'linked') expect(commit).not.toBe(commonHead)
    expect(await sourceIdentity(checkout)).toEqual({ commit, dirty: false })
    writeFileSync(join(checkout, 'tracked.txt'), 'modified fixture\n')
    expect(await sourceIdentity(checkout)).toEqual({ commit, dirty: true })
    if (kind === 'linked') {
      writeFileSync(join(linked, '.git'), 'gitdir: ../checkout/.git/worktrees/linked\n')
      expect(await sourceIdentity(checkout)).toEqual({ commit, dirty: true })
    }
    console.log(`source identity ${kind} checkout HEAD/clean/dirty control passed`)
  } finally { await fixtureGit.close() }

  // Observe the real sourceIdentity toolbox, not a stand-in mount declaration.
  // All attempted writes target this test's Git metadata, never the user's.
  const open = Toolbox.open.bind(Toolbox)
  const observed = spyOn(Toolbox, 'open').mockImplementation(async (toolset, options) => {
    const tb = await open(toolset, options)
    try {
      const metadata = join(ordinary, '.git')
      const paths = kind === 'ordinary' ? [metadata] : [metadata, join(metadata, 'worktrees/linked')]
      for (const path of paths) {
        const result = await tb.run(['sh', '-c', 'printf probe > "$1/write-probe"', 'sh', path])
        expect(result.exitCode, result.stderr).not.toBe(0)
        expect(result.stderr).toMatch(/Read-only file system/i)
      }
      if (kind === 'linked') {
        const result = await tb.run(['sh', '-c', 'printf probe > "$1/.git"', 'sh', linked])
        expect(result.exitCode, result.stderr).not.toBe(0)
        expect(result.stderr).toMatch(/Read-only file system/i)
      }
      return tb
    } catch (error) { await tb.close(); throw error }
  })
  try {
    expect(await sourceIdentity(checkout)).toEqual({ commit, dirty: true })
  } finally { observed.mockRestore() }

  const publicKey = join(work, 'metadata.pub'); writeFileSync(publicKey, keys[0]!)
  const args = ['run', 'src/release-cli.ts', 'assemble', '--board', inputs.board, '--version', inputs.version,
    '--image', inputs.image, '--update', inputs.update, '--firmware', inputs.firmware,
    '--package-manifest', inputs.packages, '--baked-meta', inputs.meta, '--notes', inputs.notes,
    '--out', inputs.out, '--public-key', publicKey]
  const result = spawnSync(process.execPath, args, { cwd: join(repo, 'build'), encoding: 'utf8' })
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)
  expect(result.stdout).toContain('RELEASE_GATE_PASS')
  const doc = readFileSync(join(repo, 'docs/design/release-artifacts.md'), 'utf8')
  const section = doc.split('<!-- release-verify-test:start -->')[1]!.split('<!-- release-verify-test:end -->')[0]!
  const commands = section.match(/```bash\n([\s\S]*?)```/)![1]!
  expect(commands).toContain('sha256sum -c SHA256SUMS')
  expect(commands).toContain('--release gate')
  const env = { ...process.env, REPO: repo, RELEASE: inputs.out, METADATA_PUBLIC_KEY: publicKey }
  const checked = spawnSync('bash', ['-euo', 'pipefail', '-c', commands], { env, encoding: 'utf8' })
  expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0)
  expect(checked.stdout).toContain('RELEASE_GATE_PASS')
  writeFileSync(join(inputs.out, IMAGE), 'tampered')
  expect(spawnSync('bash', ['-euo', 'pipefail', '-c', commands], { env, stdio: 'ignore' }).status).not.toBe(0)
}, OPEN_TIMEOUT_MS)

test('an empty marker file cannot promote development inputs to candidate', () => {
  writeFileSync(join(work, 'meta/GENERATED'), '')
  expect(() => assembleRelease({ ...inputs, channel: 'candidate' })).toThrow('development marker')
})
test('unmarked inputs still require signed objects and complete records on candidate', () => {
  rmSync(join(work, 'meta/GENERATED'))
  assembleRelease({ ...inputs, channel: 'candidate' })
  expect(gateRelease(inputs.out, keys).manifest.developmentDomains).toEqual([])
  const bytes = readFileSync(join(inputs.out, 'firmware.bin')); bytes[0] = bytes[0]! ^ 1
  writeFileSync(join(inputs.out, 'firmware.bin'), bytes); repin('firmware.bin')
  expect(() => gateRelease(inputs.out, keys)).toThrow('firmware digest')
})

test('a dangling development marker is refused as a nonregular input', () => {
  rmSync(join(work, 'meta/GENERATED'))
  symlinkSync(join(work, 'missing-marker'), join(work, 'meta/GENERATED'))
  expect(() => assembleRelease({ ...inputs, channel: 'candidate' })).toThrow('regular file')
})
