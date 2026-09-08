import { describe, expect, test } from 'bun:test'
import { loadBoard } from './board.ts'
import { boardEnvPath } from './paths.ts'
import {
  RUNTIME_CHECK_IDS,
  checkRuntime,
  concludeRuntime,
  type ActiveProbes,
  type RuntimeCheckOptions,
  type RuntimeFact,
  type RuntimeImage,
  type RuntimeSnapshot,
} from './runtime.ts'

const board = loadBoard(boardEnvPath('s905x5m'))
const hash = 'a'.repeat(64)

function fact(value: string, status: number = 0): RuntimeFact {
  return { status, value }
}

function baseSnapshot(): RuntimeSnapshot {
  return {
    hostname: fact('mos-runtime'),
    hostname_mount: fact('/dev/mmcblk0p10[/hostname]|/etc/hostname|ext4|state'),
    root: fact('/dev/dm-0|squashfs'),
    root_slave: fact('mmcblk0p7'),
    cmdline: fact('root=/dev/dm-0 rauc.slot=A aml_media.vout=1080p60hz,disable aml_media.connector0_type=HDMI-A-A hdmitx=,444,8bit hdmimode=1080p60hz'),
    kernel_release: fact('6.12.38-m100-arm64'),
    boot_image_sha256: fact(hash),
    boot_id: fact('before-boot'),
    ntp_synchronized: fact('yes'),
    epoch: fact('1800000000'),
    fw_printenv: fact('BOOT_ORDER=A B BOOT_A_LEFT=3 BOOT_B_LEFT=3'),
    uenv_a: fact('yes'),
    uenv_b: fact('yes'),
    rauc_status: fact(JSON.stringify({
      booted: 'A',
      slots: [
        { 'rootfs.0': { class: 'rootfs', bootname: 'A', state: 'booted' } },
        { 'rootfs.1': { class: 'rootfs', bootname: 'B', state: 'inactive' } },
      ],
    })),
    mos_health: fact('success|0|inactive'),
    display_args: fact('aml_media.vout=1080p60hz,disable aml_media.connector0_type=HDMI-A-A hdmitx=,444,8bit hdmimode=1080p60hz'),
    hdmi_state: fact('connected|1080p60hz,720p60hz'),
    login_sessions: fact('1'),
    ssh_cgroup: fact('0::/user.slice/user-0.slice/session-5.scope'),
    container_enabled: fact('true'),
    quadlet_mount: fact('/dev/mmcblk0p10[/quadlet]|/etc/containers/systemd|ext4|state'),
    mqtt_enabled: fact('true'),
    mqtt_broker_active: fact('active'),
    mqtt_bridge_active: fact('active'),
    mqtt_mode: fact('read-only'),
    mqtt_subscription: fact('only-read-filter'),
    mqtt_reference: fact('selected-active'),
    wifi_enabled: fact('true'),
    wifi_interface: fact('wlan0'),
    wpa_cli: fact('/usr/sbin/wpa_cli'),
    wpa_status: fact('wpa_state=COMPLETED'),
    panel_driver: fact('bound'),
    panel_service: fact('selected-active'),
  }
}

function baseImage(): RuntimeImage {
  return { bootImageSha256: hash, kernelRelease: '6.12.38-m100-arm64' }
}

function baseProbes(): ActiveProbes {
  const after = { ...baseSnapshot(), boot_id: fact('after-boot'), epoch: fact('1800000001') }
  return {
    postReboot: after,
    containerNetwork: fact('ok'),
    containerInteractive: fact('ok'),
    quadletPersistence: fact('prefix-preserved-and-heartbeat-advanced'),
    mqttReference: { status: 0, itemCount: 9, heartbeatCount: 1, completionCount: 1, detail: 'received expected publications' },
    wifiAssociation: fact('ok'),
  }
}

function baseOptions(probes: ActiveProbes = baseProbes()): RuntimeCheckOptions {
  return {
    board,
    expectedHostname: 'mos-runtime',
    callerEpoch: 1_800_000_000,
    maxClockSkewSeconds: 60,
    expectHdmi: '1080p60hz',
    probes,
  }
}

function verdict(id: string, snapshot = baseSnapshot(), image = baseImage(), options = baseOptions()): string {
  const result = checkRuntime(snapshot, image, options).find(check => check.id === id)
  if (result === undefined) throw new Error(`test expected ${id} in register`)
  return result.verdict
}

function replace(snapshot: RuntimeSnapshot, key: keyof RuntimeSnapshot, value: RuntimeFact): RuntimeSnapshot {
  return { ...snapshot, [key]: value }
}

describe('booted-board runtime check register', () => {
  test('the constructed healthy snapshot reaches every declared check', () => {
    const results = checkRuntime(baseSnapshot(), baseImage(), baseOptions())
    expect(results.map(result => result.id)).toEqual([...RUNTIME_CHECK_IDS])
    expect(results.every(result => result.verdict === 'pass')).toBe(true)
    expect(concludeRuntime(results)).toEqual({
      exitCode: 0,
      line: `RESULT: PASS (${RUNTIME_CHECK_IDS.length}/${RUNTIME_CHECK_IDS.length} checks)`,
    })
  })

  test('every runtime assertion has a constructed failing direction', () => {
    const cases: Array<{ readonly id: string, readonly snapshot?: RuntimeSnapshot, readonly image?: RuntimeImage, readonly options?: RuntimeCheckOptions }> = [
      { id: 'identity.hostname-state', snapshot: replace(baseSnapshot(), 'hostname', fact('another-board')) },
      { id: 'boot.root-slot', snapshot: replace(baseSnapshot(), 'root_slave', fact('mmcblk0p8')) },
      { id: 'boot.deployed-kernel', image: { ...baseImage(), bootImageSha256: 'b'.repeat(64) } },
      { id: 'display.boot-arguments', snapshot: replace(baseSnapshot(), 'display_args', fact('console=ttyS0')) },
      { id: 'display.connector', snapshot: replace(baseSnapshot(), 'hdmi_state', fact('disconnected|')) },
      { id: 'time.ntp-and-clock', snapshot: replace(baseSnapshot(), 'ntp_synchronized', fact('no')) },
      { id: 'time.after-reboot', options: baseOptions({ ...baseProbes(), postReboot: { ...baseSnapshot(), boot_id: fact('before-boot') } }) },
      { id: 'ab.fw-printenv', snapshot: replace(baseSnapshot(), 'fw_printenv', fact('BOOT_ORDER=A')) },
      { id: 'ab.redundant-uenv', snapshot: replace(baseSnapshot(), 'uenv_b', fact('no')) },
      { id: 'ab.rauc-status', snapshot: replace(baseSnapshot(), 'rauc_status', fact(JSON.stringify({ booted: 'A', slots: [{ 'rootfs.0': { class: 'rootfs', bootname: 'A', state: 'booted' } }] }))) },
      { id: 'ab.mos-health', snapshot: replace(baseSnapshot(), 'mos_health', fact('success|1|inactive')) },
      { id: 'logind.ssh-session', snapshot: replace(baseSnapshot(), 'login_sessions', fact('0')) },
      { id: 'containers.quadlet-state', snapshot: replace(baseSnapshot(), 'quadlet_mount', fact('/dev/mmcblk0p11|/etc/containers/systemd|ext4|ephemeral')) },
      { id: 'containers.default-bridge', options: baseOptions({ ...baseProbes(), containerNetwork: fact('failed', 1) }) },
      { id: 'containers.interactive-default-cgroup', options: baseOptions({ ...baseProbes(), containerInteractive: fact('failed', 1) }) },
      { id: 'containers.quadlet-persistence', options: baseOptions({ ...baseProbes(), quadletPersistence: fact('prefix-lost') }) },
      { id: 'mqtt.services', snapshot: replace(baseSnapshot(), 'mqtt_broker_active', fact('inactive')) },
      { id: 'mqtt.read-only-filter', snapshot: replace(baseSnapshot(), 'mqtt_subscription', fact('unexpected-filter')) },
      { id: 'mqtt.reference-application', snapshot: replace(baseSnapshot(), 'mqtt_reference', fact('selected-inactive')) },
      { id: 'mqtt.reference-publication', options: baseOptions({ ...baseProbes(), mqttReference: { status: 0, itemCount: 8, heartbeatCount: 0, completionCount: 2, detail: 'constructed short tree' } }) },
      { id: 'wireless.wpa-cli', snapshot: replace(baseSnapshot(), 'wpa_cli', fact('', 127)) },
      { id: 'wireless.association', snapshot: replace(baseSnapshot(), 'wpa_status', fact('wpa_state=DISCONNECTED')) },
      { id: 'wireless.explicit-association', options: baseOptions({ ...baseProbes(), wifiAssociation: fact('failed', 1) }) },
      { id: 'panel.driver-bound', snapshot: replace(baseSnapshot(), 'panel_driver', fact('unbound')) },
      { id: 'panel.renderer-active', snapshot: replace(baseSnapshot(), 'panel_service', fact('selected-inactive')) },
    ]
    expect(cases.map(testCase => testCase.id)).toEqual([...RUNTIME_CHECK_IDS])
    for (const testCase of cases) {
      expect(verdict(testCase.id, testCase.snapshot, testCase.image, testCase.options)).toBe('fail')
    }
  })

  test('a missing executable remains an explicit exit-127 failure', () => {
    const snapshot = replace(baseSnapshot(), 'wpa_cli', fact('', 127))
    const result = checkRuntime(snapshot, baseImage(), baseOptions()).find(check => check.id === 'wireless.wpa-cli')
    expect(result?.verdict).toBe('fail')
    expect(result?.message).toContain('exit 127')
    expect(result?.message).toContain('empty stdout is not an observation')
  })

  test('the campaign failure modes have concrete red constructions', () => {
    expect(verdict('time.ntp-and-clock', replace(baseSnapshot(), 'epoch', fact('1700000000')))).toBe('fail')
    expect(verdict('ab.fw-printenv', replace(baseSnapshot(), 'fw_printenv', fact('cannot read environment', 243)))).toBe('fail')
    expect(verdict(
      'time.after-reboot',
      baseSnapshot(),
      baseImage(),
      baseOptions({
        ...baseProbes(),
        postReboot: { ...baseSnapshot(), boot_id: fact('after-boot'), epoch: fact('1700000000') },
        postRebootCallerEpoch: 1_800_000_001,
      }),
    )).toBe('fail')
    expect(verdict(
      'containers.default-bridge',
      baseSnapshot(),
      baseImage(),
      baseOptions({ ...baseProbes(), containerNetwork: fact('netavark: nftables FIB inet failed', 126) }),
    )).toBe('fail')
    expect(verdict(
      'containers.interactive-default-cgroup',
      baseSnapshot(),
      baseImage(),
      baseOptions({ ...baseProbes(), containerInteractive: fact('crun: systemd not supported', 126) }),
    )).toBe('fail')
  })

  test('disabled optional features are named skips, not erased checks', () => {
    let snapshot = replace(baseSnapshot(), 'mqtt_enabled', fact('false'))
    snapshot = replace(snapshot, 'wifi_enabled', fact('false'))
    const results = checkRuntime(snapshot, baseImage(), { ...baseOptions(), probes: undefined })
    expect(results.find(result => result.id === 'mqtt.services')?.verdict).toBe('skip')
    expect(results.find(result => result.id === 'wireless.association')?.verdict).toBe('skip')
    expect(concludeRuntime(results).exitCode).toBe(0)
  })

  test('an explicit private Wi-Fi association can be asserted even when mosd leaves station mode off', () => {
    const snapshot = replace(baseSnapshot(), 'wifi_enabled', fact('false'))
    const results = checkRuntime(snapshot, baseImage(), baseOptions({ ...baseProbes(), wifiAssociation: fact('ok') }))
    expect(results.find(result => result.id === 'wireless.association')?.verdict).toBe('skip')
    expect(results.find(result => result.id === 'wireless.explicit-association')?.verdict).toBe('pass')
  })

  test('a vacuous or shape-corrupted register cannot claim PASS', () => {
    expect(concludeRuntime([]).exitCode).toBe(1)
    expect(concludeRuntime(checkRuntime(baseSnapshot(), baseImage(), baseOptions()).slice(1)).exitCode).toBe(1)
  })
})
