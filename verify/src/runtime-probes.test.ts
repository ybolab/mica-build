import { describe, expect, test } from 'bun:test'
import { PROBE_COMMANDS, PROBE_SCRIPTS, loadWifiCredentials } from './runtime-probes.ts'

describe('explicit runtime probes', () => {
  test('container probe uses the default bridge and leaves no persistent container', () => {
    const script = PROBE_SCRIPTS.containerNetwork
    expect(script).toContain('podman run --rm --detach')
    expect(script).not.toMatch(/podman\s+run[^\n]*--network/)
    expect(script).not.toMatch(/podman\s+run[^\n]*--cgroup-manager/)
    expect(script).toContain('podman rm --force')
    const interactive = PROBE_COMMANDS.containerInteractive
    expect(interactive).toContain('podman run --rm --interactive --tty')
    expect(interactive).not.toContain('--network')
    expect(interactive).not.toContain('--cgroup-manager')
  })

  test('Wi-Fi credentials are required rather than invented or logged', () => {
    const oldSsid = process.env['MOS_RUNTIME_WIFI_SSID']
    const oldPsk = process.env['MOS_RUNTIME_WIFI_PSK']
    delete process.env['MOS_RUNTIME_WIFI_SSID']
    delete process.env['MOS_RUNTIME_WIFI_PSK']
    try {
      expect(() => loadWifiCredentials(undefined)).toThrow('needs MOS_RUNTIME_WIFI_SSID')
      expect(() => loadWifiCredentials('/this-path-does-not-exist')).toThrow('could not be read')
    }
    finally {
      if (oldSsid === undefined) delete process.env['MOS_RUNTIME_WIFI_SSID']
      else process.env['MOS_RUNTIME_WIFI_SSID'] = oldSsid
      if (oldPsk === undefined) delete process.env['MOS_RUNTIME_WIFI_PSK']
      else process.env['MOS_RUNTIME_WIFI_PSK'] = oldPsk
    }
  })

  test('the Wi-Fi probe owns only a private temporary supplicant and does not save configuration', async () => {
    const text = await Bun.file(new URL('./runtime-probes.ts', import.meta.url)).text()
    expect(text).toContain('wpa_supplicant -Dnl80211')
    expect(text).toContain('wpa_cli')
    expect(text).toContain('update_config=0')
    expect(text).toContain('/run/mos-runtime-wifi-$$')
    expect(text).not.toContain('iw ')
    expect(text).not.toMatch(/wpa_cli[^\n]*save_config/)
    const syntax = Bun.spawnSync(['/bin/sh', '-n'], {
      stdin: new TextEncoder().encode(PROBE_SCRIPTS.wifiAssociation),
      stdout: 'pipe', stderr: 'pipe',
    })
    expect(syntax.exitCode).toBe(0)
  })
})
