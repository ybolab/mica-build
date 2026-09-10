import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { NO_TOOLS } from './checks-fixture.ts'
import { ROOT_CHECKS } from './checks-file-root.ts'
import { pathInRoot, regularFileInRoot } from './checks-root.ts'
import { boardEnvPath, REPO_ROOT } from './paths.ts'

type JsonObject = Record<string, unknown>

const CURRENT_MANIFEST = await Bun.file(join(REPO_ROOT, 'meta.example/updates/manifest.json')).text()
const MARKER = 'DEVELOPMENT-GRADE\nDOMAINS=boot verity updates\n'

const work: string[] = []
afterEach(() => { for (const p of work.splice(0)) rmSync(p, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'file-root-check-')); work.push(root)
  mkdirSync(join(root, 'etc'))
  const file = (path: string, text: string | Uint8Array) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  const checkResult = async (id: string) => (await ROOT_CHECKS.find(c => c.id === id)!.run({ board: loadBoard(boardEnvPath('x64')),
    image: 'fixture', tools: NO_TOOLS, workDir: root, outDir: root, unpackRoot: async () => root }))[0]!
  const check = async (id: string) => (await checkResult(id)).verdict
  return { root, file, check, checkResult }
}

function manifest(): JsonObject {
  return JSON.parse(CURRENT_MANIFEST) as JsonObject
}

function objectAt(value: JsonObject, key: string): JsonObject {
  return value[key] as JsonObject
}

function publicDefaults(f: ReturnType<typeof fixture>, marker?: string): void {
  f.file('/usr/share/mos/meta/updates/manifest.json', CURRENT_MANIFEST)
  if (marker !== undefined) f.file('/usr/share/mos/meta/GENERATED', marker)
}

function writeManifest(f: ReturnType<typeof fixture>, value: unknown): void {
  f.file('/usr/share/mos/meta/updates/manifest.json', `${JSON.stringify(value, null, 2)}\n`)
}

async function expectPublicRefusal(f: ReturnType<typeof fixture>, expected: string): Promise<string> {
  const result = await f.checkResult('file-root-public-defaults')
  expect(result.verdict, result.message).toBe('fail')
  expect(result.message).toContain(expected)
  return result.message
}

test('root component rejects kernel payload and retired updater binaries', async () => {
  const f = fixture()
  expect(await f.check('file-root-is-component')).toBe('pass')
  f.file('/usr/lib/modules/6.12/modules.dep', '')
  expect(await f.check('file-root-is-component')).toBe('fail')
  rmSync(join(f.root, 'usr/lib/modules'), { recursive: true })
  f.file('/usr/bin/rauc', 'obsolete')
  expect(await f.check('file-root-is-component')).toBe('fail')
})

test('public defaults refuse baked anchors, private material and extra files', async () => {
  const f = fixture(), path = '/usr/share/mos/meta/updates/manifest.json'
  f.file(path, CURRENT_MANIFEST)
  expect(await f.check('file-root-public-defaults')).toBe('pass')
  const trusted = manifest(); trusted.trust = {}
  writeManifest(f, trusted)
  expect(await f.check('file-root-public-defaults')).toBe('fail')
  const privateValue = manifest(); privateValue.privateKey = 'forbidden'
  writeManifest(f, privateValue)
  expect(await f.check('file-root-public-defaults')).toBe('fail')
  f.file(path, CURRENT_MANIFEST); f.file('/usr/share/mos/meta/updates/private.pem', 'fixture')
  expect(await f.check('file-root-public-defaults')).toBe('fail')
})

test.each([undefined, MARKER, ''])('public defaults accept the current fixture with marker=%s and report non-vacuous evidence', async (marker) => {
  const f = fixture()
  publicDefaults(f, marker)
  const result = await f.checkResult('file-root-public-defaults')
  expect(result.verdict, result.message).toBe('pass')
  expect(result.message).toContain(`scannedFiles=${marker === undefined ? 1 : 2}`)
  expect(result.message).toMatch(/scannedBytes=[1-9][0-9]*/)
  expect(result.message).toContain('/usr/share/mos/meta/updates/manifest.json')
  if (marker !== undefined) expect(result.message).toContain('/usr/share/mos/meta/GENERATED')
})

test.each([
  ['updates/manifest.json', '-----BEGIN PRIVATE KEY-----\nDO_NOT_ECHO_PRIVATE_BYTES\n'],
  ['updates/manifest.json', '{"privateKey":"DO_NOT_ECHO_PRIVATE_BYTES"}'],
  ['updates/manifest.json', '{"private_key":"DO_NOT_ECHO_PRIVATE_BYTES"}'],
  ['GENERATED', '-----BEGIN OPENSSH PRIVATE KEY-----\nDO_NOT_ECHO_PRIVATE_BYTES\n'],
  ['GENERATED', '{"privateKey":"DO_NOT_ECHO_PRIVATE_BYTES"}'],
  ['GENERATED', '{"private_key":"DO_NOT_ECHO_PRIVATE_BYTES"}'],
])('private material detector refuses %s without leaking its bytes', async (relative, content) => {
  const f = fixture(); publicDefaults(f)
  f.file(`/usr/share/mos/meta/${relative}`, content)
  const message = await expectPublicRefusal(f, `/usr/share/mos/meta/${relative}`)
  expect(message).toContain('private key material')
  expect(message).not.toContain('DO_NOT_ECHO_PRIVATE_BYTES')
})

test.each([
  ['manifest', (value: JsonObject) => { value.unexpected = 'DO_NOT_ECHO_UNKNOWN' }],
  ['product', (value: JsonObject) => { objectAt(value, 'product').unexpected = 'DO_NOT_ECHO_UNKNOWN' }],
  ['update', (value: JsonObject) => { objectAt(value, 'update').unexpected = 'DO_NOT_ECHO_UNKNOWN' }],
  ['http', (value: JsonObject) => { objectAt(value, 'http').unexpected = 'DO_NOT_ECHO_UNKNOWN' }],
  ['fleet', (value: JsonObject) => { objectAt(value, 'fleet').unexpected = 'DO_NOT_ECHO_UNKNOWN' }],
])('unknown %s member is refused without leaking its value', async (path, mutate) => {
  const f = fixture(), value = manifest()
  mutate(value); writeManifest(f, value)
  const message = await expectPublicRefusal(f, `${path}.unexpected`)
  expect(message).not.toContain('DO_NOT_ECHO_UNKNOWN')
})

test.each([
  ['schema', (value: JsonObject) => { delete value.schema }],
  ['product.vendor', (value: JsonObject) => { delete objectAt(value, 'product').vendor }],
  ['update.source', (value: JsonObject) => { delete objectAt(value, 'update').source }],
  ['http.credentialHosts', (value: JsonObject) => { delete objectAt(value, 'http').credentialHosts }],
  ['fleet.url', (value: JsonObject) => { delete objectAt(value, 'fleet').url }],
])('missing required member %s is refused', async (path, mutate) => {
  const f = fixture(), value = manifest()
  mutate(value); writeManifest(f, value)
  await expectPublicRefusal(f, path)
})

test.each([
  ['schema', (value: JsonObject) => { value.schema = 'mos/meta/v0' }],
  ['product', (value: JsonObject) => { value.product = [] }],
  ['product.vendor', (value: JsonObject) => { objectAt(value, 'product').vendor = false }],
  ['product.model', (value: JsonObject) => { objectAt(value, 'product').model = 1 }],
  ['update.source', (value: JsonObject) => { objectAt(value, 'update').source = false }],
  ['update.channel', (value: JsonObject) => { objectAt(value, 'update').channel = '  ' }],
  ['update.policy', (value: JsonObject) => { objectAt(value, 'update').policy = 'download' }],
  ['http.credentialHosts', (value: JsonObject) => { objectAt(value, 'http').credentialHosts = [false] }],
  ['fleet.enabled', (value: JsonObject) => { objectAt(value, 'fleet').enabled = 'false' }],
  ['fleet.url', (value: JsonObject) => { objectAt(value, 'fleet').url = false }],
])('type or current value violation at %s is refused', async (path, mutate) => {
  const f = fixture(), value = manifest()
  mutate(value); writeManifest(f, value)
  await expectPublicRefusal(f, path)
})

test.each(['off', 'check', 'auto'])('current update policy %s is accepted', async (policy) => {
  const f = fixture(), value = manifest()
  objectAt(value, 'update').policy = policy; writeManifest(f, value)
  expect(await f.check('file-root-public-defaults')).toBe('pass')
})

test.each(['0', '18446744073709551615'])('checkIntervalMinutes=%s is inside the full u64 range', async (literal) => {
  const f = fixture()
  f.file('/usr/share/mos/meta/updates/manifest.json', CURRENT_MANIFEST.replace('1440', literal))
  expect(await f.check('file-root-public-defaults')).toBe('pass')
})

test.each([
  ['-1', 'non-negative integer'],
  ['1.5', 'non-negative integer'],
  ['1e3', 'non-negative integer'],
  ['18446744073709551616', 'unsigned 64-bit range'],
])('checkIntervalMinutes=%s is outside the current u64 contract', async (literal, reason) => {
  const f = fixture()
  f.file('/usr/share/mos/meta/updates/manifest.json', CURRENT_MANIFEST.replace('1440', literal))
  const message = await expectPublicRefusal(f, 'update.checkIntervalMinutes')
  expect(message).toContain(reason)
})

test.each([
  ['schema', '"schema":', '"schema":"DO_NOT_ECHO_DUPLICATE",'],
  ['schema', '"schema":', '"\\u0073chema":"DO_NOT_ECHO_DUPLICATE",'],
  ['product.vendor', '"vendor":', '"vendor":"DO_NOT_ECHO_DUPLICATE",'],
  ['update.policy', '"policy":', '"\\u0070olicy":"DO_NOT_ECHO_DUPLICATE",'],
])('duplicate decoded member at %s is refused', async (path, key, duplicate) => {
  const f = fixture()
  f.file('/usr/share/mos/meta/updates/manifest.json', JSON.stringify(manifest()).replace(key, `${duplicate}${key}`))
  const message = await expectPublicRefusal(f, path)
  expect(message).toContain('duplicate key')
  expect(message).not.toContain('DO_NOT_ECHO_DUPLICATE')
})

test('malformed UTF-8 is refused without substitution or a byte dump', async () => {
  const f = fixture(), parts = CURRENT_MANIFEST.split('example')
  expect(parts).toHaveLength(2)
  f.file('/usr/share/mos/meta/updates/manifest.json', Buffer.concat([
    Buffer.from(parts[0]!), Buffer.from([0xff]), Buffer.from('DO_NOT_ECHO_BINARY'), Buffer.from(parts[1]!),
  ]))
  const message = await expectPublicRefusal(f, '/usr/share/mos/meta/updates/manifest.json')
  expect(message).toContain('invalid UTF-8')
  expect(message).not.toContain('DO_NOT_ECHO_BINARY')
})

test('malformed JSON is refused without dumping its bytes', async () => {
  const f = fixture()
  f.file('/usr/share/mos/meta/updates/manifest.json', '{"schema":"DO_NOT_ECHO_JSON"')
  const message = await expectPublicRefusal(f, 'invalid JSON')
  expect(message).not.toContain('DO_NOT_ECHO_JSON')
})

test.each([
  ['missing updates directory', (f: ReturnType<typeof fixture>) => {}, 'updates'],
  ['missing manifest', (f: ReturnType<typeof fixture>) => { mkdirSync(join(f.root, 'usr/share/mos/meta/updates'), { recursive: true }) }, 'manifest.json'],
  ['empty manifest', (f: ReturnType<typeof fixture>) => { f.file('/usr/share/mos/meta/updates/manifest.json', '') }, 'empty'],
])('%s is refused', async (_name, arrange, expected) => {
  const f = fixture()
  mkdirSync(join(f.root, 'usr/share/mos/meta'), { recursive: true })
  arrange(f)
  await expectPublicRefusal(f, expected)
})

test('an absent public metadata directory throws instead of reporting a vacuous pass', async () => {
  const f = fixture()
  await expect(f.checkResult('file-root-public-defaults')).rejects.toThrow('/usr/share/mos/meta is missing')
})

test('a non-directory public metadata entry is refused before scanning', async () => {
  const f = fixture(); f.file('/usr/share/mos/meta', 'not a directory\n')
  await expectPublicRefusal(f, '/usr/share/mos/meta')
})

test.each([
  ['root extra file', '/usr/share/mos/meta/extra.json'],
  ['nested extra file', '/usr/share/mos/meta/updates/extra.json'],
])('%s is refused by path', async (_name, path) => {
  const f = fixture(); publicDefaults(f); f.file(path, 'extra\n')
  await expectPublicRefusal(f, path)
})

test('a permitted name with a special file type is refused before it is read', async () => {
  const f = fixture(); publicDefaults(f)
  const special = join(f.root, 'usr/share/mos/meta/GENERATED')
  const made = spawnSync('mkfifo', [special], { encoding: 'utf8' })
  expect(made.status, `${made.stdout}${made.stderr}`).toBe(0)
  await expectPublicRefusal(f, '/usr/share/mos/meta/GENERATED')
})

test.each(['updates/manifest.json', 'GENERATED'])('%s cannot be a symlink', async (relative) => {
  const f = fixture(); publicDefaults(f)
  const target = join(f.root, 'safe-target')
  writeFileSync(target, relative === 'GENERATED' ? MARKER : CURRENT_MANIFEST)
  rmSync(join(f.root, 'usr/share/mos/meta', relative), { force: true })
  symlinkSync(target, join(f.root, 'usr/share/mos/meta', relative))
  await expectPublicRefusal(f, `/usr/share/mos/meta/${relative}`)
})

test.each(['meta', 'updates'])('required %s directory cannot be a symlink', async (name) => {
  const f = fixture()
  const target = mkdtempSync(join(tmpdir(), `file-root-${name}-target-`)); work.push(target)
  const targetMeta = name === 'meta' ? target : join(target, 'meta')
  mkdirSync(join(targetMeta, 'updates'), { recursive: true })
  writeFileSync(join(targetMeta, 'updates/manifest.json'), CURRENT_MANIFEST)
  if (name === 'meta') {
    mkdirSync(join(f.root, 'usr/share/mos'), { recursive: true })
    symlinkSync(targetMeta, join(f.root, 'usr/share/mos/meta'))
  }
  else {
    mkdirSync(join(f.root, 'usr/share/mos/meta'), { recursive: true })
    symlinkSync(join(targetMeta, 'updates'), join(f.root, 'usr/share/mos/meta/updates'))
  }
  await expectPublicRefusal(f, name === 'meta' ? '/usr/share/mos/meta' : '/usr/share/mos/meta/updates')
})

test('a planted image path component cannot escape to a valid host tree', async () => {
  const f = fixture()
  const host = mkdtempSync(join(tmpdir(), 'file-root-host-meta-')); work.push(host)
  mkdirSync(join(host, 'meta/updates'), { recursive: true })
  writeFileSync(join(host, 'meta/updates/manifest.json'), CURRENT_MANIFEST)
  writeFileSync(join(host, 'meta/GENERATED'), '-----BEGIN PRIVATE KEY-----\nHOST_SECRET_SENTINEL\n')
  mkdirSync(join(f.root, 'usr/share'), { recursive: true })
  symlinkSync(host, join(f.root, 'usr/share/mos'))
  await expect(f.checkResult('file-root-public-defaults')).rejects.toThrow('/usr/share/mos/meta')
})

test('identity accepts the shipped relative D-Bus link and refuses a baked machine ID', async () => {
  const f = fixture()
  f.file('/etc/machine-id', '')
  mkdirSync(join(f.root, 'var/lib/dbus'), { recursive: true })
  mkdirSync(join(f.root, 'var/lib/systemd'), { recursive: true })
  symlinkSync('../../../etc/machine-id', join(f.root, 'var/lib/dbus/machine-id'))
  symlinkSync('/mnt/data/state/random-seed', join(f.root, 'var/lib/systemd/random-seed'))
  expect(await f.check('file-root-identity')).toBe('pass')
  f.file('/etc/machine-id', 'a'.repeat(32))
  expect(await f.check('file-root-identity')).toBe('fail')
})

test('DATA policy requires a whole var bind and rejects per-systemd-leaf mounts', async () => {
  const f = fixture()
  const board = loadBoard(boardEnvPath('x64'))
  f.file('/etc/fstab', `PARTUUID=${board.get('DATA_GUID')!.toLowerCase()} /mnt/data ext4 noatime,prjquota,x-systemd.growfs 0 2\ntmpfs /tmp tmpfs size=128M,nr_inodes=32768 0 0\n`)
  for (const name of ['var-lib-mos', 'etc-ssh', 'usr-local-lib-systemd-system', 'etc-containers-systemd']) {
    f.file(`/etc/systemd/system/${name}.mount`, '[Mount]\nWhat=/mnt/data/state/example\n')
  }
  f.file('/etc/systemd/system/var.mount', '[Mount]\nWhat=/mnt/data/var\nWhere=/var\nOptions=bind,private,nosuid,nodev\n')
  f.file('/etc/systemd/system/mos-seed-var.service', '[Service]\nExecStart=/usr/lib/mos/mos-seed-var\n')
  expect(await f.check('file-root-data-policy')).toBe('pass')
  f.file('/etc/systemd/system/var-lib-systemd-timesync.mount', '[Mount]\nWhat=/mnt/data/state/timesync\n')
  expect(await f.check('file-root-data-policy')).toBe('fail')
  rmSync(join(f.root, 'etc/systemd/system/var-lib-systemd-timesync.mount'))
  f.file('/etc/systemd/system/var.mount', '[Mount]\nWhat=/mnt/system/var\nWhere=/var\nOptions=bind\n')
  expect(await f.check('file-root-data-policy')).toBe('fail')
})

test('image symlinks resolve inside the image, including absolute and parent links', () => {
  const f = fixture()
  f.file('/usr/share/value', 'image')
  symlinkSync('/usr/share', join(f.root, 'etc/absolute'))
  symlinkSync('../usr/share', join(f.root, 'relative'))
  expect(pathInRoot(f.root, '/etc/absolute/value')).toBe(join(f.root, 'usr/share/value'))
  expect(regularFileInRoot(f.root, '/relative/value')).toBe(true)
  symlinkSync('/proc/version', join(f.root, 'etc/host'))
  expect(regularFileInRoot(f.root, '/etc/host')).toBe(false)
  symlinkSync('/etc/cycle', join(f.root, 'etc/cycle'))
  expect(regularFileInRoot(f.root, '/etc/cycle')).toBe(false)
})

test('container storage requires its own enabled bind outside var', async () => {
  const f = fixture()
  expect(await f.check('file-root-container-policy')).toBe('fail')
  f.file('/etc/systemd/system/mos-containers.mount', '[Unit]\nRequires=mos-data-layout.service mos.mount\nAfter=mos-data-layout.service mos.mount\n[Mount]\nWhat=/mnt/data/containers\nWhere=/mos/containers\nOptions=bind,private,nosuid,nodev\n')
  f.file('/etc/systemd/system/mos.mount', '[Mount]\nOptions=bind,private\n')
  f.file('/etc/systemd/system/etc-containers-systemd.mount', '[Unit]\nRequiresMountsFor=/mnt/data/state /mos/containers\n')
  f.file('/etc/containers/storage.conf', '[storage]\ngraphroot = "/mos/containers/storage"\nrunroot = "/run/containers/storage"\n')
  f.file('/etc/containers/containers.conf', '[engine]\nimage_copy_tmp_dir = "/mos/containers/tmp"\n[network]\nnetwork_config_dir = "/mos/containers/networks"\n')
  mkdirSync(join(f.root, 'etc/systemd/system/local-fs.target.wants'), { recursive: true })
  symlinkSync('/etc/systemd/system/mos-containers.mount', join(f.root, 'etc/systemd/system/local-fs.target.wants/mos-containers.mount'))
  expect(await f.check('file-root-container-policy')).toBe('pass')
  f.file('/etc/systemd/system/mos.mount', '[Mount]\nOptions=bind\n')
  expect(await f.check('file-root-container-policy')).toBe('fail')
  f.file('/etc/systemd/system/mos.mount', '[Mount]\nOptions=bind,private\n')
  f.file('/etc/systemd/system/etc-containers-systemd.mount', '[Unit]\nRequiresMountsFor=/mnt/data/state\n')
  expect(await f.check('file-root-container-policy')).toBe('fail')
  f.file('/etc/systemd/system/etc-containers-systemd.mount', '[Unit]\nRequiresMountsFor=/mnt/data/state /mos/containers\n')
  f.file('/etc/systemd/system/mos-containers.mount', '[Mount]\nWhat=/mnt/data/var/containers\nWhere=/mos/containers\nOptions=bind,private,nosuid,nodev\n')
  expect(await f.check('file-root-container-policy')).toBe('fail')
})
