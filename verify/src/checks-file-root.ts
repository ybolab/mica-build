import { readFileSync, readdirSync } from 'node:fs'
import type { CheckCase } from './checks.ts'
import { ANY_UNITS, entry, linkTargetInRoot, packedRoot, pathInRoot, regularFileInRoot, wantsLink } from './checks-root.ts'
import { verdict } from './verdict.ts'

const required = ['/usr/lib/systemd/systemd', '/usr/bin/mosd', '/usr/bin/apid', '/usr/bin/mos-deploy',
  '/usr/lib/mos/mos-health', '/usr/lib/mos/mos-boot-failure', '/usr/lib/mos/mos-data-layout',
  '/usr/lib/mos/mos-seed-state', '/usr/lib/mos/mos-seed-var', '/usr/share/mos/manifest.tsv', '/usr/share/mos/release-identity.env']

export const ROOT_CHECKS: readonly CheckCase[] = [
  ...required.map(path => ({ id: `file-root-required:${path}`, shell: { pass: `required ${path}` },
    run: async ctx => [verdict(`file-root-required:${path}`, regularFileInRoot(await packedRoot(ctx), path), `required ${path}`)] } satisfies CheckCase)),
  {
    id: 'file-root-is-component', shell: { pass: 'root owns only user space' },
    run: async ctx => {
      const root = await packedRoot(ctx)
      const forbidden = ['/usr/bin/rauc', '/usr/bin/rauc-update', '/usr/bin/rauc-verify', '/etc/rauc', '/usr/bin/grub-editenv', '/usr/bin/fw_printenv', '/usr/bin/fw_setenv', '/etc/fw_env.config']
      const empty = ['/usr/lib/modules', '/usr/lib/firmware', '/boot'].every(path => {
        const st = entry(root, path)
        return st === undefined || (st.isDirectory() && readdirSync(pathInRoot(root, path)).length === 0)
      })
      return [verdict('file-root-is-component', empty && forbidden.every(p => entry(root, p) === undefined), 'root owns only user space')]
    },
  },
  {
    id: 'file-root-data-policy', shell: { pass: 'DATA owns bounded writable var and protected state' },
    run: async ctx => {
      const root = await packedRoot(ctx), read = (p: string) => readFileSync(pathInRoot(root, p), 'utf8')
      const lines = read('/etc/fstab').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/))
      const obsolete = ['var-lib', 'var-cache', 'var-log', 'var-tmp', 'var-lib-systemd-timesync',
        'var-lib-systemd-network', 'var-lib-systemd-timers', 'var-lib-systemd-linger']
        .some(name => entry(root, `/etc/systemd/system/${name}.mount`) !== undefined)
      const binds = ['var-lib-mos', 'etc-ssh', 'usr-local-lib-systemd-system', 'etc-containers-systemd']
      const varUnit = entry(root, '/etc/systemd/system/var.mount')?.isFile()
        ? read('/etc/systemd/system/var.mount') : ''
      const ok = lines.length === 2 && lines.some(l => l.join(' ') === `PARTUUID=${ctx.board.get('DATA_GUID')?.toLowerCase()} /mnt/data ext4 noatime,prjquota,x-systemd.growfs 0 2`)
        && lines.some(l => l[0] === 'tmpfs' && l[1] === '/tmp' && l[3]?.includes('size=128M') && l[3]?.includes('nr_inodes=32768'))
        && !obsolete && /^What=\/mnt\/data\/var$/m.test(varUnit) && /^Where=\/var$/m.test(varUnit)
        && /^Options=bind,private,nosuid,nodev$/m.test(varUnit)
        && regularFileInRoot(root, '/etc/systemd/system/mos-seed-var.service')
        && binds.every(name => /^What=\/mnt\/data\/state\//m.test(read(`/etc/systemd/system/${name}.mount`)))
      return [verdict('file-root-data-policy', ok, 'DATA owns bounded writable var and protected state')]
    },
  },
  {
    id: 'file-root-container-policy', shell: { pass: 'container storage uses an independent DATA bind' },
    run: async ctx => {
      const root = await packedRoot(ctx)
      const read = (p: string) => regularFileInRoot(root, p) ? readFileSync(pathInRoot(root, p), 'utf8') : ''
      const unit = read('/etc/systemd/system/mos-containers.mount')
      const parent = read('/etc/systemd/system/mos.mount')
      const storage = read('/etc/containers/storage.conf')
      const network = read('/etc/containers/containers.conf')
      const quadlet = read('/etc/systemd/system/etc-containers-systemd.mount')
      const ok = /^What=\/mnt\/data\/containers$/m.test(unit) && /^Where=\/mos\/containers$/m.test(unit)
        && /^Options=bind,private,nosuid,nodev$/m.test(unit)
        && /^Options=bind,private$/m.test(parent)
        && /^Requires=.*\bmos-data-layout\.service\b.*\bmos\.mount$/m.test(unit)
        && /^After=.*\bmos-data-layout\.service\b.*\bmos\.mount$/m.test(unit)
        && wantsLink(root, ANY_UNITS, 'mos-containers.mount') !== undefined
        && /^RequiresMountsFor=.*\/mos\/containers(?: |$)/m.test(quadlet)
        && /^graphroot = "\/mos\/containers\/storage"$/m.test(storage)
        && /^runroot = "\/run\/containers\/storage"$/m.test(storage)
        && /^image_copy_tmp_dir = "\/mos\/containers\/tmp"$/m.test(network)
        && /^network_config_dir = "\/mos\/containers\/networks"$/m.test(network)
      return [verdict('file-root-container-policy', ok, 'container storage uses an independent DATA bind')]
    },
  },
  {
    id: 'file-root-identity', shell: { pass: 'machine identity is created on DATA before services' },
    run: async ctx => {
      const root = await packedRoot(ctx)
      const id = entry(root, '/etc/machine-id')
      return [verdict('file-root-identity', id?.isFile() === true && id.size === 0
        && pathInRoot(root, '/var/lib/dbus/machine-id') === pathInRoot(root, '/etc/machine-id')
        && linkTargetInRoot(root, '/var/lib/systemd/random-seed') === '/mnt/data/state/random-seed'
        && entry(root, '/usr/lib/systemd/system/mos-machine-id.service') === undefined, 'machine identity is created on DATA before services')]
    },
  },
  {
    id: 'file-root-health', shell: { pass: 'native health confirmation and failure handling are enabled' },
    run: async ctx => {
      const root = await packedRoot(ctx), read = (p: string) => readFileSync(pathInRoot(root, p), 'utf8')
      const service = read('/usr/lib/systemd/system/mos-health.service')
      return [verdict('file-root-health', wantsLink(root, ANY_UNITS, 'mos-health.service') !== undefined
        && service.includes('OnFailure=mos-boot-failure.service')
        && read('/usr/lib/mos/mos-health').includes('mos-deploy confirm')
        && read('/usr/lib/mos/mos-boot-failure').includes('mos-deploy fail-boot'), 'native health confirmation and failure handling are enabled')]
    },
  },
  {
    id: 'file-root-public-defaults', shell: { pass: 'baked defaults contain no metadata anchors or private keys' },
    run: async ctx => {
      const root = await packedRoot(ctx), directory = pathInRoot(root, '/usr/share/mos/meta')
      const manifest = JSON.parse(readFileSync(`${directory}/updates/manifest.json`, 'utf8')) as Record<string, unknown>
      const files = readdirSync(directory).sort()
      const ok = !Object.hasOwn(manifest, 'trust') && files.every(n => n === 'updates' || n === 'GENERATED')
        && readdirSync(`${directory}/updates`).join() === 'manifest.json'
        && !/BEGIN .*PRIVATE KEY|"privateKey"|"private_key"/.test(readFileSync(`${directory}/updates/manifest.json`, 'utf8'))
      return [verdict('file-root-public-defaults', ok, 'baked defaults contain no metadata anchors or private keys')]
    },
  },
]
