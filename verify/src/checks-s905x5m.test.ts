import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadBoard } from './board.ts'
import { boardEnvPath, REPO_ROOT } from './paths.ts'
import type { ImageContext } from './checks.ts'
import { BOARD_CHECKS } from './checks-board.ts'
import { S905X5M_CHECKS } from './checks-s905x5m.ts'
import { parsePackageInventory } from './installed-packages.ts'
import { artifactsForPackages } from './smoke-register.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(bluetooth: boolean, wireless = bluetooth) {
  const root = mkdtempSync(join(tmpdir(), 's905-packages-'))
  roots.push(root)
  const file = (path: string, content = 'fixture\n') => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const packages = ['mos-board-s905x5m']
  if (wireless) packages.push('mos-s905x5m-radio')
  if (bluetooth) packages.push('mos-s905x5m-bluetooth', 'mos-bluetooth')
  file('/usr/share/mos/manifest.tsv', '#package\tversion\tarchitecture\n' + packages.map(p => `${p}\t1\tarm64\n`).join(''))
  const board = loadBoard(boardEnvPath('s905x5m'))
  for (const name of ['audio', ...(wireless ? ['wireless'] : []), ...(bluetooth ? ['bluetooth'] : [])]) {
    file(`/etc/mos/${name}.conf`, readFileSync(join(REPO_ROOT, `boards/s905x5m/bsp/init/${name}.conf`), 'utf8'))
    file(`/usr/lib/mos/hwinit-${name}`)
    file(`/usr/lib/systemd/system/mos-${name}.service`)
  }
  if (bluetooth) {
    file('/usr/lib/mos/hwinit-bt')
    for (const path of board.get('BOARD_USERLAND_FILES')!.split(' ')) file(path)
    file('/usr/lib/mos/s905x5m-bluez.conf', `[General]\nClass = ${board.get('BOARD_BLUEZ_CLASS')}\n`)
    file('/etc/systemd/system/bluetooth.service.d/20-s905x5m.conf', 'ExecStart=/usr/libexec/bluetooth/bluetoothd --configfile=/usr/lib/mos/s905x5m-bluez.conf\n')
  }
  const ctx = { board, unpackRoot: async () => root } as ImageContext
  return { root, ctx, file }
}
async function result(ctx: ImageContext) { return (await S905X5M_CHECKS[0]!.run(ctx))[0]! }

describe('s905x5m package inventory', () => {
  for (const [bt, wifi] of [[true, true], [false, true], [false, false]]) {
    test(`hardware contract: Bluetooth=${bt}, radio=${wifi}`, async () => {
      const fx = fixture(bt!, wifi!)
      expect((await result(fx.ctx)).verdict).toBe('pass')
      const check = BOARD_CHECKS.find(c => c.id === 'hwinit-helpers-match-declaration')!
      expect((await check.run(fx.ctx))[0]!.verdict).toBe('pass')
    })
  }
  test('selected userland missing is a failure', async () => {
    const fx = fixture(true)
    rmSync(join(fx.root, 'usr/sbin/skw_vhci_bridge'))
    expect((await result(fx.ctx)).verdict).toBe('fail')
  })
  test('declined radio cannot leave an initializer behind', async () => {
    const fx = fixture(false)
    fx.file('/usr/lib/mos/hwinit-wireless')
    expect((await result(fx.ctx)).verdict).toBe('fail')
  })
  test('a missing inventory cannot excuse missing hardware', async () => {
    const fx = fixture(false)
    rmSync(join(fx.root, 'usr/share/mos/manifest.tsv'))
    await expect(result(fx.ctx)).rejects.toThrow()
  })
  test('BlueZ cannot override the per-device name', async () => {
    const fx = fixture(true)
    fx.file('/usr/lib/mos/s905x5m-bluez.conf', '[General]\nClass = 0x240404\nName = fixed\n')
    expect((await result(fx.ctx)).verdict).toBe('fail')
  })
  test('an optional application selected but absent fails', async () => {
    const fx = fixture(false)
    fx.file('/usr/share/mos/manifest.tsv', 'mos-board-s905x5m\t1\tarm64\nmos-mqtt-reference\t1\tarm64\n')
    expect((await result(fx.ctx)).verdict).toBe('fail')
  })
  for (const [pkg, unit, binaries] of [
    ['mos-bm201-front-panel', 'bm201-front-panel.service', ['/usr/sbin/bm201-front-panel', '/usr/lib/mos/bm201-front-panel-stop']],
    ['mos-mqtt-reference', 'mos-mqtt-reference.service', ['/usr/bin/mos-mqtt-reference']],
  ] as const) {
    test(`${pkg}: selected executables pass; each missing or non-executable entry point fails`, async () => {
      const fx = fixture(false)
      fx.file('/usr/share/mos/manifest.tsv', `mos-board-s905x5m\t1\tarm64\n${pkg}\t1\tarm64\n`)
      fx.file(`/usr/lib/systemd/system/${unit}`)
      for (const path of binaries) {
        fx.file(path)
        chmodSync(join(fx.root, path), 0o755)
      }
      expect((await result(fx.ctx)).verdict).toBe('pass')
      for (const path of binaries) {
        chmodSync(join(fx.root, path), 0o644)
        const broken = await result(fx.ctx)
        expect(broken.verdict).toBe('fail')
        expect(broken.message).toContain(path)
        rmSync(join(fx.root, path))
        expect((await result(fx.ctx)).verdict).toBe('fail')
        fx.file(path)
        chmodSync(join(fx.root, path), 0o755)
        expect((await result(fx.ctx)).verdict).toBe('pass')
      }
    })
  }
  test('declining the front panel cannot leave its stop helper behind', async () => {
    const fx = fixture(false)
    fx.file('/usr/lib/mos/bm201-front-panel-stop')
    chmodSync(join(fx.root, '/usr/lib/mos/bm201-front-panel-stop'), 0o755)
    expect((await result(fx.ctx)).verdict).toBe('fail')
  })
  test('duplicate, malformed and empty package inventories are refused', () => {
    for (const text of ['', '#package\tversion\tarchitecture\n', 'bad row', 'mosd\t1\tarm64\nmosd\t1\tarm64\n']) {
      expect(() => parsePackageInventory(text)).toThrow()
    }
  })
  test('optional smoke probes follow the selected packages', () => {
    const base = artifactsForPackages(new Set()).map(a => a.name)
    expect(base).not.toContain('skw_vhci_bridge')
    expect(base).not.toContain('mos-mqtt-reference')
    const selected = artifactsForPackages(new Set(['mos-mqtt-reference', 'mos-s905x5m-bluetooth']))
    expect(selected.map(a => a.name)).toEqual([...base, 'mos-mqtt-reference', 'skw_vhci_bridge'])
    for (const a of selected.slice(-2)) expect(a.pin().expected).toBe('0.1.0')
  })
})
