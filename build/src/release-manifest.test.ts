import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Signer } from '../../shared/update-envelope.ts'
import { canonicalJson, componentId } from './components.ts'
import { packArchive } from './component-archive.ts'
import { assembleRelease, gateRelease, type ReleaseInputs } from './release-manifest.ts'
import { sourceIdentity } from './release-cli.ts'
import { acceptProvenance } from '../../tests/file-ab-x64/provenance-acceptance.ts'
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
// Produce the input through the real selector/composition entry, using only a
// small installed fixture. Its measured byte image is not a SquashFS/boot claim.
function runtimeFixture(arch = 'amd64'): void {
  const result = spawnSync('python3', ['-c', `
import hashlib, json, os, pathlib, shutil, struct, sys
sys.dont_write_bytecode = True
repo, work = map(pathlib.Path, sys.argv[1:3])
arch = sys.argv[3]
sys.path.insert(0, str(repo / 'tests/rootfs-runtime'))
from composition_test import CompositionTest
from selection_test import CAP
case = CompositionTest()
case.setUp()
try:
    marker = work / 'meta/GENERATED'
    case.public_metadata(marker.read_bytes() if marker.exists() else None)
    case.f.write('/usr/share/mos/meta/updates/manifest.json', (work / 'meta/updates/manifest.json').read_bytes())
    if arch == 'arm64':
        for path in case.f.root.rglob('*'):
            if not path.is_symlink() and path.is_file() and path.read_bytes().startswith(b'\\x7fELF'):
                data = bytearray(path.read_bytes()); struct.pack_into('<H', data, 18, 183); path.write_bytes(data)
        os.setxattr(case.f.root / 'usr/bin/captool', 'security.capability', bytes.fromhex(CAP))
        for path in [case.f.manifest, case.inputs / 'manifest.tsv', case.inputs / 'upstream.tsv', case.f.root / 'usr/share/mos/manifest.tsv']:
            path.write_text(path.read_text().replace('amd64', 'arm64'))
        for directory in [case.f.db, case.inputs / 'info']:
            (directory / 'libfixture:amd64.list').rename(directory / 'libfixture:arm64.list')
    case.lineage(arch)
    case.capture()
    app = case.f.root / 'usr/bin/app'
    data = bytearray(app.read_bytes()); data[-1] = 44; app.write_bytes(data)
    counterpart = case.debug / '.build-id/ab/cd.debug'
    counterpart.parent.mkdir(parents=True); counterpart.write_bytes(b'fixture debug counterpart')
    (case.debug / 'manifest.tsv').write_text('/usr/bin/app\\tabcd\\t.build-id/ab/cd.debug\\t2048\\t2048\\t' + hashlib.sha256(data).hexdigest() + '\\n')
    result = case.command('compose', root=case.f.root, output=case.f.out, inputs=case.inputs, rules=case.f.rules_path, arch=arch, epoch=1000000000, debug=case.debug, report=case.f.report)
    assert result.returncode == 0, result.stderr
    (case.f.base / 'rootfs-verity.img').write_bytes(bytes([42]) * 12288)
    (case.f.base / 'rootfs-verity.env').write_text('SQUASHFS_BYTES=8192\\nIMAGE_BYTES=12288\\nVERITY_ROOT_HASH=' + 'a' * 64 + '\\nVERITY_SALT=' + 'c' * 64 + '\\nVERITY_HASH_ALGO=sha256\\nVERITY_DATA_BLOCK_SIZE=4096\\nVERITY_HASH_BLOCK_SIZE=4096\\nVERITY_DATA_BLOCKS=2\\nVERITY_HASH_START_BLOCK=2\\nVERITY_DATA_SECTORS=16\\n')
    result = case.command('measure-packed', root=case.f.out, out=case.f.base)
    assert result.returncode == 0, result.stderr
    shutil.copyfile(case.f.report, work / 'runtime-report.json')
    shutil.copyfile(case.f.out / 'usr/share/mos/manifest.tsv', work / 'packages.tsv')
finally:
    case.doCleanups()
`, new URL('../../', import.meta.url).pathname, work, arch], { encoding: 'utf8', timeout: 15000 })
  expect(result.status, result.stderr).toBe(0)
}
function runtime() {
  return JSON.parse(readFileSync(inputs.runtimeReport, 'utf8'))
}
function writeRuntime(value: unknown): void {
  writeFileSync(inputs.runtimeReport, JSON.stringify(value))
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
  runtimeFixture()
  inputs = { runtimeReport: join(work, 'runtime-report.json'), out: join(work, 'release'), board: 'x64', version: d.version, channel: 'development', profile: 'dev',
    source: { commit: 'a'.repeat(40), dirty: false }, builderImages: { IMAGE_TEST: 'example@sha256:' + 'a'.repeat(64) },
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
  expect(read('sbom.cdx.json').components.map((c: { name: string }) => c.name)).toEqual(['libfixture', 'mos-system'])
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

// Freeze the actual CLI and its relative imports in the fixture checkout. A
// dirty developer checkout cannot stand in for a clean composition source.
function copyReleaseCli(root: string, destination: string) {
  const copied = new Set<string>(), parser = new Bun.Transpiler({ loader: 'ts' })
  const copy = (name: string) => {
    if (copied.has(name)) return
    copied.add(name)
    const bytes = readFileSync(join(root, name))
    mkdirSync(dirname(join(destination, name)), { recursive: true })
    writeFileSync(join(destination, name), bytes)
    if (name.endsWith('.ts')) for (const imported of parser.scanImports(bytes)) {
      if (imported.path.startsWith('.')) copy(join(dirname(name), imported.path))
    }
  }
  for (const name of ['build/src/release-cli.ts', 'Makefile', 'build/package.json', 'verify/package.json',
    'build-env/from.sh', 'build-env/images.env', 'boards/x64/board.env', 'boards/x64/evidence.json']) copy(name)
}

test.each(['ordinary', 'linked'])('shipped release CLI and documented verification commands execute (%s checkout)', async (kind) => {
  const repo = new URL('../../', import.meta.url).pathname
  const ordinary = join(work, 'checkout')
  const linked = join(work, 'linked')
  const fixtureGit = await Toolbox.open({ key: 'release-git-fixture', imageKey: 'IMAGE_ALPINE_3_21', manager: 'apk', packages: ['git'], tools: ['git'] }, { mounts: [work] })
  let commit: string, compositionTree = '', compositionEpoch = 0
  const checkout = kind === 'ordinary' ? ordinary : linked
  try {
    const git = async (...args: string[]) => (await fixtureGit.must(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
      env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    })).stdout.trim()
    await git('init', '--initial-branch=fixture', ordinary)
    writeFileSync(join(ordinary, 'tracked.txt'), 'initial fixture\n')
    copyReleaseCli(repo, ordinary)
    await git('-C', ordinary, 'add', '.')
    await git('-C', ordinary, 'commit', '--no-gpg-sign', '-m', 'Create isolated source fixture')
    const commonHead = await git('-C', ordinary, 'rev-parse', 'HEAD')
    await git('-C', ordinary, 'worktree', 'add', '--detach', linked, 'HEAD')
    if (kind === 'linked') {
      writeFileSync(join(linked, 'tracked.txt'), 'linked fixture baseline\n')
      await git('-C', linked, 'commit', '-am', 'Advance isolated linked fixture', '--no-gpg-sign')
    }
    commit = await git('-C', checkout, 'rev-parse', 'HEAD')
    compositionTree = await git('-C', checkout, 'rev-parse', 'HEAD^{tree}')
    compositionEpoch = Number(await git('-C', checkout, 'show', '-s', '--format=%ct', 'HEAD'))
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
  writeFileSync(join(checkout, 'tracked.txt'), kind === 'ordinary' ? 'initial fixture\n' : 'linked fixture baseline\n')
  expect(await sourceIdentity(checkout)).toEqual({ commit, dirty: false })
  const report = runtime(), lineage = report.provenance.source_lineage
  lineage.composition_source = { commit, tree: compositionTree, epoch: compositionEpoch }
  lineage.receipt_sha256 = ['e'.repeat(64)]
  report.provenance.capture_sha256['source-lineage.json'] = hash(Buffer.from(canonicalJson(lineage) + '\n'))
  writeRuntime(report)

  const publicKey = join(work, 'metadata.pub'); writeFileSync(publicKey, keys[0]!)
  const args = ['run', 'src/release-cli.ts', 'assemble', '--board', inputs.board, '--version', inputs.version,
    '--image', inputs.image, '--update', inputs.update, '--firmware', inputs.firmware,
    '--package-manifest', inputs.packages, '--runtime-report', inputs.runtimeReport, '--baked-meta', inputs.meta, '--notes', inputs.notes,
    '--out', inputs.out, '--public-key', publicKey]
  const result = spawnSync(process.execPath, args, { cwd: join(checkout, 'build'), encoding: 'utf8' })
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
  runtimeFixture()
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


test('runtime report is mandatory and missing input never creates a release', () => {
  const { runtimeReport: _report, ...missing } = inputs
  expect(() => assembleRelease(missing as ReleaseInputs)).toThrow('runtime report')
  expect(existsSync(inputs.out)).toBe(false)
})


test('runtime report joins actual file owners, sources, licenses and build-only packages', () => {
  assembleRelease(inputs)
  expect(read('manifest.json').artifacts.find((a: { role: string }) => a.role === 'runtime-report').filename).toBe('rootfs-report.runtime.json')
  const provenance = read('provenance.json').runtime
  expect(provenance.buildPackages.map((p: { package: string }) => p.package)).toContain('unused')
  expect(provenance.shippedPackages.map((p: { package: string }) => p.package)).not.toContain('unused')
  expect(provenance.files['/usr/bin/app'].archives[0].source).toEqual({ package: 'mos-system', version: '0.1.0+git' + 'a'.repeat(12) + '-1' })
  expect(read('licenses.json').packages.find((p: { name: string }) => p.name === 'libfixture').resources[0].sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(provenance.files['/usr/bin/app'].debug.path).toBe('.build-id/ab/cd.debug')
  expect(provenance.files['/usr/bin/app'].configured.sha256).not.toBe(provenance.files['/usr/bin/app'].final.sha256)
  expect(readFileSync(join(inputs.out, 'development-marker.txt'))).toEqual(readFileSync(join(inputs.meta, 'GENERATED')))
  expect(read('provenance.json').inputs.some((a: { role: string }) => a.role === 'runtime-report')).toBe(true)
})

test.each([
  ['architecture', (r: ReturnType<typeof runtime>) => { r.architecture = 'arm64' }],
  ['package identity', (r: ReturnType<typeof runtime>) => { r.provenance.shipped_packages[0].version = 'wrong' }],
  ['archive identity', (r: ReturnType<typeof runtime>) => { r.provenance.files['/usr/bin/app'].archives[0].archive_sha256 = '0'.repeat(64) }],
  ['file digest', (r: ReturnType<typeof runtime>) => { r.provenance.files['/usr/bin/app'].final.sha256 = '0'.repeat(64) }],
  ['missing file', (r: ReturnType<typeof runtime>) => { delete r.provenance.files['/usr/bin/app'] }],
  ['duplicate path', (r: ReturnType<typeof runtime>) => { r.files.push(r.files[0]) }],
  ['traversal path', (r: ReturnType<typeof runtime>) => { r.files[0].path = '/../outside' }],
  ['missing owner', (r: ReturnType<typeof runtime>) => { r.files.find((f: { path: string }) => f.path === '/usr/bin/app').origins = [] }],
  ['capture digest', (r: ReturnType<typeof runtime>) => { r.provenance.capture_sha256['manifest.tsv'] = '0'.repeat(64) }],
  ['signed root', (r: ReturnType<typeof runtime>) => { r.measurements.verity_image.sha256 = '0'.repeat(64) }],
  ['verity geometry', (r: ReturnType<typeof runtime>) => { r.measurements.verity_image.geometry.VERITY_ROOT_HASH = '0'.repeat(64) }],
  ['missing packed measurement', (r: ReturnType<typeof runtime>) => { delete r.measurements.verity_image }],
  ['incorrect measurement', (r: ReturnType<typeof runtime>) => { r.measurements.unique_file_bytes += 1 }],
  ['debug mapping', (r: ReturnType<typeof runtime>) => { r.provenance.files['/usr/bin/app'].debug = { build_id: 'abcd', path: '.build-id/wrong.debug' } }],
])('runtime report refuses %s before output', (_name, mutate) => {
  const report = runtime(); (mutate as (r: ReturnType<typeof runtime>) => void)(report); writeRuntime(report)
  expect(() => assembleRelease(inputs)).toThrow()
  expect(existsSync(inputs.out)).toBe(false)
})

test('runtime report rejects a different public manifest', () => {
  writeFileSync(join(inputs.meta, 'updates/manifest.json'), '{}')
  expect(() => assembleRelease(inputs)).toThrow('public metadata')
  expect(existsSync(inputs.out)).toBe(false)
})

test('runtime report tampering still refuses after outer artifact digests are repinned', () => {
  assembleRelease(inputs)
  const report = read('rootfs-report.runtime.json')
  report.provenance.files['/usr/bin/app'].generators.push('forged origin')
  write('rootfs-report.runtime.json', report); repin('rootfs-report.runtime.json')
  expect(() => gateRelease(inputs.out, keys)).toThrow('runtime')
})


test('runtime report rejects a different shipped package inventory before output', () => {
  writeFileSync(inputs.packages, 'mos-system\twrong\tall\n')
  expect(() => assembleRelease(inputs)).toThrow('runtime shipped inventory')
  expect(existsSync(inputs.out)).toBe(false)
})

test.each(['absent', 'malformed', 'duplicate-key', 'invalid-utf8', 'symlink'])(
  'runtime report refuses %s input before output', kind => {
    if (kind === 'absent') rmSync(inputs.runtimeReport)
    if (kind === 'malformed') writeFileSync(inputs.runtimeReport, '{')
    if (kind === 'duplicate-key') {
      const text = readFileSync(inputs.runtimeReport, 'utf8')
      writeFileSync(inputs.runtimeReport, text.replace('{', '{"architecture":"amd64",'))
    }
    if (kind === 'invalid-utf8') writeFileSync(inputs.runtimeReport, Buffer.from([0xff]))
    if (kind === 'symlink') { renameSync(inputs.runtimeReport, inputs.runtimeReport + '.real'); symlinkSync(inputs.runtimeReport + '.real', inputs.runtimeReport) }
    expect(() => assembleRelease(inputs)).toThrow()
    expect(existsSync(inputs.out)).toBe(false)
  },
)

test('runtime report CLI requires the new argument without opening source identity', () => {
  const publicKey = join(work, 'public.key'); writeFileSync(publicKey, keys[0]!)
  const result = spawnSync(process.execPath, ['run', 'src/release-cli.ts', 'assemble', '--board', 'x64', '--public-key', publicKey], {
    cwd: new URL('../', import.meta.url).pathname, encoding: 'utf8', timeout: 15000,
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Missing --runtime-report')
  expect(existsSync(inputs.out)).toBe(false)
})

test('runtime report keeps runtime measurement claims pending their separate evidence', () => {
  const report = runtime(); report.measurements.rss = 'PASS'; writeRuntime(report)
  expect(() => assembleRelease(inputs)).toThrow('runtime measurement evidence')
  expect(existsSync(inputs.out)).toBe(false)
})

test('runtime report preserves epoch nanoseconds and refuses one-nanosecond divergence', () => {
  const text = readFileSync(inputs.runtimeReport, 'utf8')
  expect(text).toContain('"mtime_ns": 1000000000000000000')
  assembleRelease(inputs)
  expect(read('provenance.json').runtime.files['/usr/bin/app'].final.mtime_ns).toBe('1000000000000000000')
  const path = join(inputs.out, 'rootfs-report.runtime.json')
  const exported = readFileSync(path, 'utf8')
  const filesAt = exported.indexOf('"files": [')
  expect(filesAt).toBeGreaterThan(0)
  writeFileSync(path, exported.slice(0, filesAt) + exported.slice(filesAt).replace('"mtime_ns": 1000000000000000000', '"mtime_ns": 1000000000000000001'))
  repin('rootfs-report.runtime.json')
  expect(() => gateRelease(inputs.out, keys)).toThrow('runtime final file metadata')
})

// These signed byte fixtures exercise artifact/provenance checks, not guest boot.
async function virtAcceptanceFixture() {
  const repo = new URL('../../', import.meta.url).pathname
  const checkout = join(work, 'frozen-checkout')
  mkdirSync(join(checkout, 'boards/virt-arm64'), { recursive: true })
  mkdirSync(join(checkout, 'build-env'))
  for (const path of ['boards/virt-arm64/board.env', 'boards/virt-arm64/evidence.json', 'build-env/images.env']) {
    writeFileSync(join(checkout, path), readFileSync(join(repo, path)))
  }
  let compositionTree = '', compositionEpoch = 0
  const tb = await Toolbox.open({ key: 'release-git-fixture', imageKey: 'IMAGE_ALPINE_3_21', manager: 'apk', packages: ['git'], tools: ['git'] }, { mounts: [checkout] })
  try {
    const git = (...args: string[]) => tb.must(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', checkout, ...args], {
      env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    })
    await git('init', '--initial-branch=fixture')
    await git('add', '.')
    await git('commit', '--no-gpg-sign', '-m', 'Freeze isolated acceptance fixture')
    compositionTree = (await git('rev-parse', 'HEAD^{tree}')).stdout.trim()
    compositionEpoch = Number((await git('show', '-s', '--format=%ct', 'HEAD')).stdout.trim())
  } finally { await tb.close() }
  inputs.source = await sourceIdentity(checkout)
  inputs.builderImages = Object.fromEntries(readFileSync(join(checkout, 'build-env/images.env'), 'utf8').split('\n')
    .flatMap(line => { const match = /^((?:IMAGE|LOCAL)_[A-Z0-9_]+)=(.+)$/.exec(line); return match ? [[match[1]!, match[2]!]] : [] }))
  const signer = new Signer(generateKeyPairSync('ed25519').privateKey, true)
  keys = inputs.keys = [signer.publicKey]
  const bytes = readFileSync(join(work, 'kernel/boot.efi'))
  const artifact = { bytes: bytes.length, sha256: hash(bytes) }
  const d = JSON.parse(readFileSync(join(repo, 'tests/component-contracts/deployment.json'), 'utf8'))
  d.board = d.kernel.board = 'virt-arm64'
  d.arch = d.kernel.arch = d.rootfs.arch = 'arm64'
  d.kernel.boot.artifact = d.kernel.support.image = d.kernel.support.signature = d.rootfs.content.image = d.rootfs.content.signature = artifact
  d.kernel.id = componentId(d.kernel); d.rootfs.id = componentId(d.rootfs)
  rmSync(inputs.update)
  packArchive(JSON.stringify(signer.sign(JSON.parse(canonicalJson(d)))), join(work, 'kernel'), join(work, 'root'), keys, inputs.update)
  const f = { schema: 'mos/firmware/v1', id: '', board: 'virt-arm64', arch: 'arm64', generation: 1, version: 'one', artifact, target: { format: 'efi', partition: 1, path: 'EFI/BOOT/BOOTAA64.EFI' } }
  f.id = componentId(f)
  writeFileSync(join(inputs.firmware, 'firmware.json'), JSON.stringify(signer.sign(JSON.parse(canonicalJson(f)))))
  renameSync(join(inputs.firmware, 'BOOTX64.EFI'), join(inputs.firmware, 'BOOTAA64.EFI'))
  const image = join(work, 'mos-virt-arm64-20260911-020000.img')
  renameSync(inputs.image, image)
  Object.assign(inputs, { board: 'virt-arm64', image, evidence: join(checkout, 'boards/virt-arm64/evidence.json') })
  runtimeFixture('arm64')
  const report = runtime(), lineage = report.provenance.source_lineage
  const commit = inputs.source.commit
  lineage.composition_source = { commit, tree: compositionTree, epoch: compositionEpoch }
  lineage.receipt_sha256 = ['e'.repeat(64)]
  report.provenance.capture_sha256['source-lineage.json'] = hash(Buffer.from(canonicalJson(lineage) + '\n'))
  writeRuntime(report)
  return checkout
}

test('non-publication acceptance uses the same valid candidate that both normal CLI modes refuse', async () => {
  const checkout = await virtAcceptanceFixture()
  // Independently establish that the low-level candidate is otherwise valid.
  const valid = assembleRelease({ ...inputs, out: join(work, 'control') })
  expect(valid.manifest.board).toBe('virt-arm64')
  const repo = new URL('../../', import.meta.url).pathname
  const publicKey = join(work, 'metadata.pub'); writeFileSync(publicKey, keys[0]!)
  const assemble = spawnSync(process.execPath, [join(repo, 'build/src/release-cli.ts'), 'assemble', '--board', inputs.board, '--version', inputs.version,
    '--image', inputs.image, '--update', inputs.update, '--firmware', inputs.firmware,
    '--package-manifest', inputs.packages, '--runtime-report', inputs.runtimeReport, '--baked-meta', inputs.meta,
    '--notes', inputs.notes, '--out', inputs.out, '--channel', inputs.channel, '--profile', inputs.profile, '--public-key', publicKey], { encoding: 'utf8', timeout: 30000 })
  expect(assemble.status).not.toBe(0)
  expect(assemble.stderr).toContain('Board virt-arm64 has no release publication target')
  expect(existsSync(inputs.out)).toBe(false)
  const printed = spyOn(console, 'log')
  try {
    await acceptProvenance(inputs, checkout)
    expect(printed.mock.calls.flat().join(' ')).toContain('NON_PUBLICATION_ARTIFACT_ACCEPTANCE')
    expect(printed.mock.calls.flat().join(' ')).not.toContain('RELEASE_GATE_PASS')
  } finally { printed.mockRestore() }
  const record = JSON.parse(readFileSync(`${inputs.out}.acceptance.json`, 'utf8'))
  expect(record.publicationEligible).toBe(false)
  expect(record.source).toEqual(inputs.source)
  expect(record.manifestSha256).toBe(hash(readFileSync(join(inputs.out, 'manifest.json'))))
  expect(record.artifacts).toEqual(read('manifest.json').artifacts)
  expect(read('manifest.json').artifacts).toEqual(valid.manifest.artifacts)
  const gate = spawnSync(process.execPath, [join(repo, 'build/src/release-cli.ts'), 'gate', '--dir', inputs.out, '--public-key', publicKey], { encoding: 'utf8', timeout: 30000 })
  expect(gate.status).not.toBe(0)
  expect(gate.stderr).toContain('Board virt-arm64 has no release publication target')
  expect(gate.stdout).not.toContain('RELEASE_GATE_PASS')
  expect(readFileSync(join(repo, 'boards/virt-arm64/board.env'), 'utf8')).toMatch(/^BOARD_RELEASE_TARGET=0$/m)
}, OPEN_TIMEOUT_MS)

test('non-publication acceptance refuses false source, dirty checkout, policy widening and reused evidence', async () => {
  const checkout = await virtAcceptanceFixture()
  await expect(acceptProvenance({ ...inputs, source: { commit: '0'.repeat(40), dirty: false } }, checkout)).rejects.toThrow('frozen source')
  for (const change of [{ board: 'x64' }, { channel: 'candidate' }, { profile: 'prod' }]) {
    await expect(acceptProvenance({ ...inputs, ...change } as ReleaseInputs, checkout)).rejects.toThrow('virt-arm64/development/dev')
  }
  await expect(acceptProvenance({ ...inputs, builderImages: { IMAGE_TEST: 'wrong' } }, checkout)).rejects.toThrow('builder image')
  const evidence = join(work, 'changed-evidence.json')
  writeFileSync(evidence, readFileSync(inputs.evidence, 'utf8') + '\n')
  await expect(acceptProvenance({ ...inputs, evidence }, checkout)).rejects.toThrow('committed board evidence')
  const dirty = join(checkout, 'untracked')
  writeFileSync(dirty, 'uncommitted')
  await expect(acceptProvenance(inputs, checkout)).rejects.toThrow('frozen source')
  rmSync(dirty)
  writeFileSync(`${inputs.out}.acceptance.json`, 'existing evidence')
  await expect(acceptProvenance(inputs, checkout)).rejects.toThrow('exists')
  expect(existsSync(inputs.out)).toBe(false)
}, OPEN_TIMEOUT_MS)

test('non-publication acceptance retains runtime and repinned artifact tamper refusals', async () => {
  const checkout = await virtAcceptanceFixture()
  const original = runtime()
  writeRuntime({ ...original, architecture: 'amd64' })
  await expect(acceptProvenance(inputs, checkout)).rejects.toThrow('architecture')
  expect(existsSync(inputs.out)).toBe(false)
  writeRuntime(original)
  await acceptProvenance(inputs, checkout)
  for (const name of ['rootfs-report.runtime.json', 'provenance.json', 'firmware.json', 'board-evidence.json']) {
    const bytes = readFileSync(join(inputs.out, name))
    const record = read(name)
    if (name === 'rootfs-report.runtime.json') record.measurements.verity_image.sha256 = '0'.repeat(64)
    if (name === 'provenance.json') record.source.commit = '0'.repeat(40)
    if (name === 'firmware.json') record.signature = 'tampered'
    if (name === 'board-evidence.json') record.board = 'x64'
    write(name, record); repin(name)
    expect(() => gateRelease(inputs.out, keys)).toThrow()
    writeFileSync(join(inputs.out, name), bytes); repin(name)
    expect(() => gateRelease(inputs.out, keys)).not.toThrow()
  }
  for (const name of ['update.mosupd', 'firmware.bin']) {
    const bytes = readFileSync(join(inputs.out, name)); const changed = Buffer.from(bytes)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    writeFileSync(join(inputs.out, name), changed); repin(name)
    expect(() => gateRelease(inputs.out, keys)).toThrow()
    writeFileSync(join(inputs.out, name), bytes); repin(name)
    expect(() => gateRelease(inputs.out, keys)).not.toThrow()
  }
  writeFileSync(join(inputs.out, 'mos-virt-arm64-20260911-020000.img'), 'tampered image')
  expect(() => gateRelease(inputs.out, keys)).toThrow('digest or length')
}, OPEN_TIMEOUT_MS)


test('runtime source lineage preserves package identity and derives composition provenance', () => {
  const r = runtime(), lineage = r.provenance.source_lineage
  lineage.composition_source = { commit: 'b'.repeat(40), tree: 'c'.repeat(40), epoch: 1000000001 }
  lineage.receipt_sha256 = ['d'.repeat(64)]
  lineage.delta = [{ path: 'rootfs/runtime/compose.py', before: { mode: '100644', blob: 'a'.repeat(40) }, after: { mode: '100644', blob: 'b'.repeat(40) } }]
  r.provenance.capture_sha256['source-lineage.json'] = hash(Buffer.from(canonicalJson(lineage) + '\n'))
  inputs.source = { commit: 'b'.repeat(40), dirty: false }; writeRuntime(r)
  assembleRelease(inputs); gateRelease(inputs.out, keys)
  expect(read('provenance.json').runtime.sourceLineage).toEqual(lineage)
  expect(lineage.package_source.commit).toBe('a'.repeat(40))
})

test.each(['missing', 'unknown', 'source', 'receipt', 'pool', 'stamp', 'epoch', 'delta', 'mode', 'capture', 'dirty'])('runtime source lineage refuses %s even with a recomputed report hash', mutation => {
  const r = runtime(), lineage = r.provenance.source_lineage
  if (mutation === 'missing') delete r.provenance.source_lineage
  if (mutation === 'unknown') lineage.waiver = true
  if (mutation === 'source') lineage.composition_source.commit = 'b'.repeat(40)
  if (mutation === 'receipt') { lineage.composition_source.commit = 'b'.repeat(40); inputs.source.commit = 'b'.repeat(40) }
  if (mutation === 'pool') lineage.pool.files.Packages = 'b'.repeat(64)
  if (mutation === 'stamp') lineage.package_source.version = '0.1.0+git' + 'b'.repeat(12) + '-1'
  if (mutation === 'epoch') lineage.root_epoch++
  if (mutation === 'delta') lineage.delta = [{ path: 'pkgs/mosd/Cargo.lock', before: null, after: { mode: '100644', blob: 'b'.repeat(40) } }]
  if (mutation === 'mode') lineage.delta = [{ path: 'rootfs/runtime/compose.py', before: { mode: '100644', blob: 'a'.repeat(40) }, after: { mode: '120000', blob: 'b'.repeat(40) } }]
  if (mutation === 'capture') r.provenance.capture_sha256['source-lineage.json'] = '0'.repeat(64)
  else if (mutation !== 'missing') r.provenance.capture_sha256['source-lineage.json'] = hash(Buffer.from(canonicalJson(lineage) + '\n'))
  if (mutation === 'dirty') inputs.source.dirty = true
  writeRuntime(r)
  expect(() => assembleRelease(inputs)).toThrow()
})
