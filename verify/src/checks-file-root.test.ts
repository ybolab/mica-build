import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadBoard } from './board.ts'
import { NO_TOOLS } from './checks-fixture.ts'
import { ROOT_CHECKS } from './checks-file-root.ts'
import { pathInRoot, regularFileInRoot } from './checks-root.ts'
import { boardEnvPath } from './paths.ts'

const work: string[] = []
afterEach(() => { for (const p of work.splice(0)) rmSync(p, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'file-root-check-')); work.push(root)
  mkdirSync(join(root, 'etc'))
  const file = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  const check = async (id: string) => (await ROOT_CHECKS.find(c => c.id === id)!.run({ board: loadBoard(boardEnvPath('x64')),
    image: 'fixture', tools: NO_TOOLS, workDir: root, outDir: root, unpackRoot: async () => root }))[0]!.verdict
  return { root, file, check }
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
  f.file(path, '{}')
  expect(await f.check('file-root-public-defaults')).toBe('pass')
  f.file(path, '{"trust":{}}')
  expect(await f.check('file-root-public-defaults')).toBe('fail')
  f.file(path, '{"privateKey":"forbidden"}')
  expect(await f.check('file-root-public-defaults')).toBe('fail')
  f.file(path, '{}'); f.file('/usr/share/mos/meta/updates/private.pem', 'fixture')
  expect(await f.check('file-root-public-defaults')).toBe('fail')
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
