import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { SNAPSHOT_SCRIPT, parseRuntimeSnapshot, validateRuntimeHost } from './runtime-ssh.ts'

describe('runtime SSH collector protocol', () => {
  test('preserves a 127 status rather than turning it into an empty observation', () => {
    const snapshot = parseRuntimeSnapshot('wpa_cli\t127\t/bin/sh: wpa_cli: not found\n')
    expect(snapshot.wpa_cli).toEqual({ status: 127, value: '/bin/sh: wpa_cli: not found' })
  })

  test('refuses malformed, unknown, and duplicate collection records', () => {
    expect(() => parseRuntimeSnapshot('not-a-record\n')).toThrow('malformed')
    expect(() => parseRuntimeSnapshot('secret\t0\tnope\n')).toThrow('unknown')
    expect(() => parseRuntimeSnapshot('hostname\t0\tone\nhostname\t0\ttwo\n')).toThrow('twice')
  })

  test('accepts only a bare SSH transport endpoint', () => {
    expect(validateRuntimeHost('192.168.27.62')).toBe('192.168.27.62')
    expect(() => validateRuntimeHost('root@board')).toThrow('bare hostname')
    expect(() => validateRuntimeHost('-oProxyCommand=x')).toThrow('bare hostname')
  })

  test('uses wpa_cli and never invokes iw or a bootloader write path', () => {
    expect(SNAPSHOT_SCRIPT).toContain('wpa_cli')
    expect(SNAPSHOT_SCRIPT).not.toContain('iw ')
    expect(SNAPSHOT_SCRIPT).not.toContain('mmcblk0boot')
    expect(SNAPSHOT_SCRIPT).not.toContain('bootloader_a')
  })

  test('the runtime paths contain no boot-area, bootloader, or slot writer', async () => {
    const texts = await Promise.all([
      Bun.file(new URL('./runtime-ssh.ts', import.meta.url)).text(),
      Bun.file(new URL('./runtime-probes.ts', import.meta.url)).text(),
      Bun.file(new URL('./runtime-cli.ts', import.meta.url)).text(),
    ])
    const runtimeSource = texts.join('\n')
    expect(runtimeSource).not.toMatch(/\bfw_setenv\b/)
    expect(runtimeSource).not.toMatch(/\brauc\s+install\b/)
    expect(runtimeSource).not.toMatch(/\bmmcblk0boot[01]\b/)
    expect(runtimeSource).not.toMatch(/\bdd\s+if=/)
  })
})


test('runtime component selection is read from the installed inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-inventory-'))
  try {
    const inventory = join(dir, 'manifest.tsv')
    const start = SNAPSHOT_SCRIPT.indexOf('component_unit_state() {')
    const end = SNAPSHOT_SCRIPT.indexOf('mqtt_reference()', start)
    const helper = SNAPSHOT_SCRIPT.slice(start, end)
    const run = (load: string, active: string) => Bun.spawnSync(['sh', '-c',
      `systemctl() { case "$4" in LoadState) printf '%s' "$LOAD" ;; ActiveState) printf '%s' "$ACTIVE" ;; esac; }\n`
      + helper + '\ncomponent_unit_state mos-mqtt-reference mos-mqtt-reference.service "$INVENTORY"',
    ], { env: { ...process.env, LOAD: load, ACTIVE: active, INVENTORY: inventory } })
    expect(run('not-found', 'inactive').exitCode).not.toBe(0)
    writeFileSync(inventory, 'mos-board-s905x5m\t1\tarm64\n')
    expect(run('not-found', 'inactive').stdout.toString()).toBe('absent')
    expect(run('loaded', 'active').stdout.toString()).toBe('unexpected-installed')
    writeFileSync(inventory, 'mos-mqtt-reference\t1\tarm64\n')
    expect(run('not-found', 'inactive').stdout.toString()).toBe('selected-inactive')
    expect(run('loaded', 'active').stdout.toString()).toBe('selected-active')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
