import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckCase } from './checks.ts'
import { entry, packedRoot } from './checks-root.ts'
import { installedPackages } from './installed-packages.ts'
import { verdict } from './verdict.ts'

export const S905X5M_CHECKS: readonly CheckCase[] = [{
  id: 's905x5m-packaged-hardware',
  boards: ['s905x5m'],
  shell: { pass: 's905x5m packaged hardware agrees:', fail: 's905x5m packaged hardware disagrees:' },
  run: async ctx => {
    const root = await packedRoot(ctx)
    const packages = installedPackages(root)
    const faults: string[] = []
    const need = (ok: boolean, why: string) => { if (!ok) faults.push(why) }
    const regular = (path: string) => entry(root, path)?.isFile() === true
    const read = (path: string) => regular(path) ? readFileSync(join(root, path), 'utf8') : ''
    const radio = packages.has('mos-s905x5m-radio')
    const bt = packages.has('mos-s905x5m-bluetooth')
    need(packages.has('mos-board-s905x5m'), 'board package absent')
    need(!bt || (radio && packages.has('mos-bluetooth')), 'Bluetooth dependency closure incomplete')
    for (const [name, selected] of [['audio', true], ['wireless', radio], ['bluetooth', bt]] as const) {
      for (const path of [`/etc/mos/${name}.conf`, `/usr/lib/mos/hwinit-${name}`,
        `/usr/lib/systemd/system/mos-${name}.service`]) {
        need(selected ? regular(path) : entry(root, path) === undefined, `${path}: selected=${selected}`)
      }
    }
    if (radio) {
      const conf = read('/etc/mos/wireless.conf')
      for (const module of (ctx.board.get('BOARD_RADIO_MODULES') ?? '').split(/\s+/).filter(Boolean)) {
        need(conf.split(/[\s"'=]+/).includes(module), `wireless configuration omits ${module}`)
      }
    }
    for (const path of (ctx.board.get('BOARD_USERLAND_FILES') ?? '').split(/\s+/).filter(Boolean)) {
      need(bt ? regular(path) : entry(root, path) === undefined, `${path}: Bluetooth selected=${bt}`)
    }
    const bluez = '/usr/lib/mos/s905x5m-bluez.conf'
    const dropin = '/etc/systemd/system/bluetooth.service.d/20-s905x5m.conf'
    if (bt) {
      const config = read(bluez)
      need(config.split('\n').includes(`Class = ${ctx.board.get('BOARD_BLUEZ_CLASS')}`), 'Bluetooth class is absent or wrong')
      need(!/^\s*Name\s*=/m.test(config), 'Bluetooth name overrides the hostname plugin')
      need(read(dropin).includes(`--configfile=${bluez}`), 'BlueZ does not consume its board configuration')
      need(read('/etc/mos/bluetooth.conf').includes('address-file=/var/lib/bluetooth/bdaddr'), 'Bluetooth address is not persisted on STATE')
    } else {
      need(entry(root, bluez) === undefined && entry(root, dropin) === undefined, 'declined Bluetooth leaves configuration behind')
    }
    for (const [pkg, binary, unit] of [
      ['mos-mqtt-reference', '/usr/bin/mos-mqtt-reference', 'mos-mqtt-reference.service'],
      ['mos-bm201-front-panel', '/usr/sbin/bm201-front-panel', 'bm201-front-panel.service'],
    ]) {
      const selected = packages.has(pkg!)
      need(selected ? regular(binary!) : entry(root, binary!) === undefined, `${binary}: selected=${selected}`)
      need(selected ? regular(`/usr/lib/systemd/system/${unit}`) : entry(root, `/usr/lib/systemd/system/${unit}`) === undefined,
        `${unit}: selected=${selected}`)
    }
    return [verdict('s905x5m-packaged-hardware', faults.length === 0,
      faults.length === 0 ? 's905x5m packaged hardware agrees: inventory, radio selection and board configuration'
        : `s905x5m packaged hardware disagrees: ${faults.join('; ')}`)]
  },
}]
