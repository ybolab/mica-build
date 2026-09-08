// Runtime acceptance decisions for a booted board.
//
// This module deliberately knows no SSH, process, or MQTT wire details.  Its
// inputs are a finite, typed snapshot and finite active-probe results, which
// makes the failing side of every decision constructible in runtime.test.ts.
// The live transport belongs in runtime-ssh.ts; it must preserve a command's
// exit status rather than turning a missing program into an empty string.

import type { Board } from './board.ts'

export type RuntimeVerdict = 'pass' | 'fail' | 'skip'

export interface RuntimeResult {
  readonly id: string
  readonly verdict: RuntimeVerdict
  readonly message: string
}

/** One command's answer. `127` is data, never an empty value. */
export interface RuntimeFact {
  readonly status: number
  readonly value: string
}

/**
 * The deliberately small, non-secret fact vocabulary emitted by the board.
 *
 * No field is a settings document, environment, Wi-Fi configuration, token,
 * PSK, broker credential, or shell transcript.  Values are either booleans,
 * statuses, device paths, or the one protocol value required to make a
 * decision.  This lets the acceptance record say what was asserted without
 * becoming a copy of board state.
 */
export const RUNTIME_FACTS = [
  'hostname',
  'hostname_mount',
  'root',
  'root_slave',
  'cmdline',
  'kernel_release',
  'boot_image_sha256',
  'boot_id',
  'ntp_synchronized',
  'epoch',
  'fw_printenv',
  'uenv_a',
  'uenv_b',
  'rauc_status',
  'mos_health',
  'display_args',
  'hdmi_state',
  'login_sessions',
  'ssh_cgroup',
  'container_enabled',
  'quadlet_mount',
  'mqtt_enabled',
  'mqtt_broker_active',
  'mqtt_bridge_active',
  'mqtt_mode',
  'mqtt_subscription',
  'mqtt_reference',
  'wifi_enabled',
  'wifi_interface',
  'wpa_cli',
  'wpa_status',
  'panel_driver',
  'panel_service',
] as const

export type RuntimeFactName = typeof RUNTIME_FACTS[number]
export type RuntimeSnapshot = Readonly<Partial<Record<RuntimeFactName, RuntimeFact>>>

/** The local, named image facts used to identify the deployed kernel. */
export interface RuntimeImage {
  readonly bootImageSha256: string
  readonly kernelRelease: string | undefined
  /** Image-reader failure rendered as the image check rather than a hidden throw. */
  readonly diagnostic?: string
}

/** Results from operations explicitly allowed by the caller. */
export interface ActiveProbes {
  /** The post-reboot snapshot. Present only after an explicitly announced reboot. */
  readonly postReboot?: RuntimeSnapshot
  /** Pre-reboot boot ID retained when the base snapshot is replaced after reconnect. */
  readonly preRebootBootId?: string
  /** Caller clock sampled after reconnect, rather than before a long reboot. */
  readonly postRebootCallerEpoch?: number
  /** Transient default-bridge probe; no named persistent container is kept. */
  readonly containerNetwork?: RuntimeFact
  /** TTY-bearing default Podman invocation, without a cgroup-manager override. */
  readonly containerInteractive?: RuntimeFact
  /** Reuses the existing emmc-probe volume and checks its pre-reboot prefix. */
  readonly quadletPersistence?: RuntimeFact
  /** Wire-level local-broker MQTT observation after one non-retained keepalive. */
  readonly mqttReference?: MqttProbe
  /** A temporary wpa_supplicant network was associated and removed. */
  readonly wifiAssociation?: RuntimeFact
}

export interface MqttProbe {
  readonly status: number
  /** Number of distinct reference Item1 notification paths after keepalive. */
  readonly itemCount: number
  /** Number of device-wide heartbeat publications observed after keepalive. */
  readonly heartbeatCount: number
  /** Number of device-wide completion publications observed after keepalive. */
  readonly completionCount: number
  /** Human-safe diagnosis; it must not contain broker credentials or payloads. */
  readonly detail: string
}

export interface RuntimeCheckOptions {
  readonly board: Board
  readonly expectedHostname: string
  /** Caller clock at the moment the snapshot is requested, in Unix seconds. */
  readonly callerEpoch: number
  readonly maxClockSkewSeconds: number
  /** Require a physically connected connector and optionally one named mode. */
  readonly expectHdmi?: string
  readonly probes?: ActiveProbes
}

const MIN_SANE_EPOCH = 1_704_067_200 // 2024-01-01T00:00:00Z

function pass(id: string, message: string): RuntimeResult {
  return { id, verdict: 'pass', message }
}

function fail(id: string, message: string): RuntimeResult {
  return { id, verdict: 'fail', message }
}

function skip(id: string, message: string): RuntimeResult {
  return { id, verdict: 'skip', message }
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * Require a collected command result.  Every check goes through this seam,
 * which is how exit 127 stays a named failure instead of becoming a blank
 * observation.  The value is deliberately shortened: command stderr is useful
 * context, but a verifier must not turn a board transcript into its record.
 */
function fact(snapshot: RuntimeSnapshot, name: RuntimeFactName, check: string): RuntimeFact | RuntimeResult {
  const result = snapshot[name]
  if (result === undefined) {
    return fail(check, `${name}: the runtime collector returned no fact; a missing command answer is not a pass`)
  }
  if (result.status !== 0) {
    const suffix = result.status === 127
      ? ' (exit 127: required program is absent; its empty stdout is not an observation)'
      : ''
    const said = compact(result.value)
    return fail(
      check,
      `${name}: collector command exited ${result.status}${suffix}${said === '' ? '' : `; ${said.slice(0, 180)}`}`,
    )
  }
  return result
}

function isFact(value: RuntimeFact | RuntimeResult): value is RuntimeFact {
  return 'status' in value
}

function yes(value: string): boolean {
  return value.trim().toLowerCase() === 'yes'
}

function bool(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return undefined
}

function partnum(board: Board, key: string): number | undefined {
  const raw = board.get(key)
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return undefined
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function checkHostname(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'identity.hostname-state'
  const hostname = fact(snapshot, 'hostname', id)
  if (!isFact(hostname)) return hostname
  if (hostname.value.trim() !== options.expectedHostname) {
    return fail(id, `hostname=${JSON.stringify(hostname.value.trim())}, expected ${JSON.stringify(options.expectedHostname)}; transport address is not board identity`)
  }

  const mount = fact(snapshot, 'hostname_mount', id)
  if (!isFact(mount)) return mount
  const statePart = partnum(options.board, 'STATE_PARTNUM')
  if (statePart === undefined) return fail(id, `${options.board.path} declares no usable STATE_PARTNUM`)
  const [source = '', target = '', , label = ''] = mount.value.split('|').map(compact)
  if (!source.includes(`mmcblk0p${statePart}`) || target !== '/etc/hostname' || label !== 'state') {
    return fail(
      id,
      `/etc/hostname mount is ${JSON.stringify(mount.value)}, expected a STATE-backed /dev/mmcblk0p${statePart} bind; hostname alone may be a different board`,
    )
  }
  return pass(id, `hostname=${options.expectedHostname} and /etc/hostname is STATE-backed; no IP address was used as identity`)
}

function checkRootSlot(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'boot.root-slot'
  const root = fact(snapshot, 'root', id)
  if (!isFact(root)) return root
  const slave = fact(snapshot, 'root_slave', id)
  if (!isFact(slave)) return slave
  const cmdline = fact(snapshot, 'cmdline', id)
  if (!isFact(cmdline)) return cmdline

  const slot = /(?:^|\s)rauc\.slot=([AB])(?:\s|$)/.exec(cmdline.value)?.[1]
  if (slot !== 'A' && slot !== 'B') return fail(id, 'kernel command line carries no usable rauc.slot=A|B')
  const expected = partnum(options.board, `ROOTFS_${slot}_PARTNUM`)
  if (expected === undefined) return fail(id, `${options.board.path} declares no usable ROOTFS_${slot}_PARTNUM`)
  const [source = '', fstype = ''] = root.value.split('|').map(compact)
  const expectedSlave = `mmcblk0p${expected}`
  if (source !== '/dev/dm-0' || fstype !== 'squashfs' || compact(slave.value) !== expectedSlave) {
    return fail(
      id,
      `rauc.slot=${slot}, but root=${JSON.stringify(root.value)} and dm-0 backing=${JSON.stringify(compact(slave.value))}; expected /dev/dm-0 squashfs over ${expectedSlave}`,
    )
  }
  return pass(id, `rauc.slot=${slot}; /dev/dm-0 squashfs is backed by ${expectedSlave}`)
}

function checkImageKernel(snapshot: RuntimeSnapshot, image: RuntimeImage): RuntimeResult {
  const id = 'boot.deployed-kernel'
  if (image.diagnostic !== undefined) return fail(id, `named deployed image could not be inspected: ${image.diagnostic}`)
  const liveHash = fact(snapshot, 'boot_image_sha256', id)
  if (!isFact(liveHash)) return liveHash
  const liveRelease = fact(snapshot, 'kernel_release', id)
  if (!isFact(liveRelease)) return liveRelease
  const expectedHash = image.bootImageSha256.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return fail(id, 'named image yielded no valid SHA-256 for its active boot Image')
  if (compact(liveHash.value).toLowerCase() !== expectedHash) {
    return fail(id, 'the active boot Image hash differs from the explicitly named deployed image; no local latest image was substituted')
  }
  if (image.kernelRelease === undefined || image.kernelRelease === '') {
    return fail(id, 'the named image Image contains no readable Linux version marker, so kernel-release identity was not asserted')
  }
  if (compact(liveRelease.value) !== image.kernelRelease) {
    return fail(id, `uname -r=${JSON.stringify(compact(liveRelease.value))}, named image kernel=${JSON.stringify(image.kernelRelease)}`)
  }
  return pass(id, `active boot Image hash and uname -r=${image.kernelRelease} match the named deployed image`)
}

function checkDisplayArguments(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'display.boot-arguments'
  if (options.board.name !== 's905x5m') return skip(id, `${options.board.name} has no s905x5m HDMI boot-argument contract`)
  const args = fact(snapshot, 'display_args', id)
  if (!isFact(args)) return args
  const required = ['aml_media.vout=', 'aml_media.connector0_type=HDMI-A-A', 'hdmitx=', 'hdmimode=']
  const missing = required.filter(token => !args.value.includes(token))
  if (missing.length > 0) return fail(id, `booted command line lacks display setup: ${missing.join(', ')}`)
  return pass(id, 'booted command line carries Amlogic vout, HDMI-A-A connector, hdmitx, and hdmimode setup')
}

function checkHdmiState(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'display.connector'
  if (options.expectHdmi === undefined) return skip(id, 'physical HDMI assertion not requested; pass --expect-hdmi [MODE] with a connected display')
  const state = fact(snapshot, 'hdmi_state', id)
  if (!isFact(state)) return state
  const [connected = '', modes = ''] = state.value.split('|').map(compact)
  if (connected !== 'connected') return fail(id, `DRM HDMI connector is ${JSON.stringify(connected || 'missing')}, expected connected`)
  if (options.expectHdmi !== '' && !modes.split(',').map(compact).includes(options.expectHdmi)) {
    return fail(id, `DRM HDMI connector is connected but does not advertise ${JSON.stringify(options.expectHdmi)}`)
  }
  return pass(id, `DRM HDMI connector is connected${options.expectHdmi === '' ? '' : ` and advertises ${options.expectHdmi}`}`)
}

function readEpoch(value: string): number | undefined {
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function clockCheck(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions, id: string, label: string): RuntimeResult {
  const ntp = fact(snapshot, 'ntp_synchronized', id)
  if (!isFact(ntp)) return ntp
  const epoch = fact(snapshot, 'epoch', id)
  if (!isFact(epoch)) return epoch
  const observed = readEpoch(epoch.value)
  if (!yes(ntp.value)) return fail(id, `NTPSynchronized=${JSON.stringify(compact(ntp.value) || 'missing')}, expected yes`)
  if (observed === undefined) return fail(id, `clock epoch=${JSON.stringify(compact(epoch.value))} is not a Unix second count`)
  if (observed < MIN_SANE_EPOCH) return fail(id, `clock=${new Date(observed * 1000).toISOString()} is before 2024-01-01 and looks like a fixed build-date reset`)
  const skew = Math.abs(observed - options.callerEpoch)
  if (skew > options.maxClockSkewSeconds) {
    return fail(id, `clock differs from caller by ${skew}s (limit ${options.maxClockSkewSeconds}s); a correct-looking NTP flag is not enough`)
  }
  return pass(id, `${label}: NTPSynchronized=yes; clock skew=${skew}s (limit ${options.maxClockSkewSeconds}s)`)
}

function checkTime(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  return clockCheck(snapshot, options, 'time.ntp-and-clock', 'current boot')
}

function checkRebootTime(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'time.after-reboot'
  const after = options.probes?.postReboot
  if (after === undefined) return skip(id, 'not run: a correct clock in one boot does not prove it survives reboot; pass --reboot to make that assertion')
  const beforeId = fact(snapshot, 'boot_id', id)
  if (!isFact(beforeId)) return beforeId
  const afterId = fact(after, 'boot_id', id)
  if (!isFact(afterId)) return afterId
  const prior = options.probes?.preRebootBootId ?? compact(beforeId.value)
  if (prior === '' || prior === compact(afterId.value)) {
    return fail(id, 'post-reboot boot ID did not change; the reconnect did not prove a new boot')
  }
  const checked = clockCheck(after, { ...options, callerEpoch: options.probes?.postRebootCallerEpoch ?? options.callerEpoch }, id, 'post-reboot')
  if (checked.verdict !== 'pass') return checked
  return pass(id, `${checked.message}; boot ID changed, so this is a reboot-persistence observation`)
}

function checkFwEnv(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'ab.fw-printenv'
  const env = fact(snapshot, 'fw_printenv', id)
  if (!isFact(env)) return env
  const value = compact(env.value)
  const order = /(?:^|\s)BOOT_ORDER=([AB](?:\s+[AB])*)(?=\s+BOOT_A_LEFT=|$)/.exec(value)?.[1]
  const leftA = /(?:^|\s)BOOT_A_LEFT=([0-9]+)/.exec(value)?.[1]
  const leftB = /(?:^|\s)BOOT_B_LEFT=([0-9]+)/.exec(value)?.[1]
  if (order === undefined || !order.split(/\s+/).join('').includes('A') || !order.includes('B') || leftA === undefined || leftB === undefined) {
    return fail(id, 'fw_printenv answered but lacks BOOT_ORDER and both BOOT_A_LEFT / BOOT_B_LEFT values')
  }
  return pass(id, `fw_printenv answered; BOOT_ORDER=${order}, BOOT_A_LEFT=${leftA}, BOOT_B_LEFT=${leftB}`)
}

function checkUenv(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'ab.redundant-uenv'
  const a = fact(snapshot, 'uenv_a', id)
  if (!isFact(a)) return a
  const b = fact(snapshot, 'uenv_b', id)
  if (!isFact(b)) return b
  if (!yes(a.value) || !yes(b.value)) return fail(id, `uenv partitions must both be non-zero (A=${JSON.stringify(compact(a.value))}, B=${JSON.stringify(compact(b.value))})`)
  return pass(id, 'both redundant U-Boot environment partitions contain non-zero bytes')
}

interface RaucSlot {
  readonly class?: string
  readonly bootname?: string
  readonly state?: string
}

function checkRauc(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'ab.rauc-status'
  const status = fact(snapshot, 'rauc_status', id)
  if (!isFact(status)) return status
  let parsed: { booted?: unknown, slots?: Record<string, RaucSlot> | Array<Record<string, RaucSlot>> }
  try {
    parsed = JSON.parse(status.value) as { booted?: unknown, slots?: Record<string, RaucSlot> | Array<Record<string, RaucSlot>> }
  }
  catch {
    return fail(id, 'rauc status exited 0 but did not return JSON')
  }
  const slots = Array.isArray(parsed.slots)
    ? parsed.slots.flatMap(row => Object.values(row))
    : Object.values(parsed.slots ?? {})
  const roots = slots.filter(slot => slot.class === 'rootfs')
  const bootnames = new Set(roots.map(slot => slot.bootname).filter((value): value is string => value !== undefined))
  const activated = roots.filter(slot => slot.state === 'booted' || slot.state === 'active')
  if (parsed.booted !== 'A' && parsed.booted !== 'B') return fail(id, `rauc JSON booted=${JSON.stringify(parsed.booted)}, expected A or B`)
  if (!bootnames.has('A') || !bootnames.has('B') || activated.length !== 1) {
    return fail(id, `rauc JSON must list rootfs A and B with exactly one activated/booted rootfs (roots=${roots.length}, active=${activated.length})`)
  }
  const active = activated[0]
  if (active?.bootname !== parsed.booted) return fail(id, `rauc booted=${parsed.booted} disagrees with activated rootfs ${active?.bootname ?? 'missing'}`)
  return pass(id, `rauc lists rootfs A and B; exactly one is booted (${parsed.booted})`)
}

function checkMosHealth(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'ab.mos-health'
  const health = fact(snapshot, 'mos_health', id)
  if (!isFact(health)) return health
  const [result = '', code = '', active = ''] = health.value.split('|').map(compact)
  if (result !== 'success' || code !== '0' || active !== 'inactive') {
    return fail(id, `mos-health is ${JSON.stringify(health.value)}, expected completed oneshot Result=success, ExecMainStatus=0, ActiveState=inactive`)
  }
  return pass(id, 'mos-health completed successfully as its expected oneshot')
}

function checkLogind(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'logind.ssh-session'
  const sessions = fact(snapshot, 'login_sessions', id)
  if (!isFact(sessions)) return sessions
  const cgroup = fact(snapshot, 'ssh_cgroup', id)
  if (!isFact(cgroup)) return cgroup
  const count = Number(sessions.value.trim())
  if (!Number.isSafeInteger(count) || count <= 0) return fail(id, `loginctl reports ${JSON.stringify(compact(sessions.value) || 'no')} sessions, expected at least the SSH login`)
  if (!/\/user\.slice\/user-0\.slice\/session-[^/]+\.scope/.test(cgroup.value)) {
    return fail(id, `SSH process cgroup is ${JSON.stringify(compact(cgroup.value))}, not a logind root session scope`)
  }
  return pass(id, `loginctl reports ${count} session(s); this SSH process is in a root session scope`)
}

function enabled(snapshot: RuntimeSnapshot, name: 'container_enabled' | 'mqtt_enabled' | 'wifi_enabled', check: string): boolean | RuntimeResult {
  const value = fact(snapshot, name, check)
  if (!isFact(value)) return value
  const parsed = bool(value.value)
  if (parsed === undefined) return fail(check, `${name}=${JSON.stringify(compact(value.value))}, expected true or false from mosd`)
  return parsed
}

function checkQuadlet(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'containers.quadlet-state'
  const isEnabled = enabled(snapshot, 'container_enabled', id)
  if (typeof isEnabled !== 'boolean') return isEnabled
  if (!isEnabled) return pass(id, 'container.enabled=false; no enabled-container mount assertion is claimed')
  const mount = fact(snapshot, 'quadlet_mount', id)
  if (!isFact(mount)) return mount
  const statePart = partnum(options.board, 'STATE_PARTNUM')
  if (statePart === undefined) return fail(id, `${options.board.path} declares no usable STATE_PARTNUM`)
  const [source = '', target = '', , label = ''] = mount.value.split('|').map(compact)
  if (!source.includes(`mmcblk0p${statePart}`) || target !== '/etc/containers/systemd' || label !== 'state') {
    return fail(id, `container.enabled=true but Quadlet mount is ${JSON.stringify(mount.value)}, not STATE-backed /etc/containers/systemd`)
  }
  return pass(id, 'container.enabled=true and Quadlet source is the STATE-backed /etc/containers/systemd mount')
}

function activeFact(id: string, label: string, probe: RuntimeFact | undefined, missing: string, expected: string = 'ok'): RuntimeResult {
  if (probe === undefined) return skip(id, missing)
  if (probe.status !== 0) {
    const detail = compact(probe.value)
    return fail(
      id,
      `${label} exited ${probe.status}${probe.status === 127 ? ' (exit 127: required program is absent; empty stdout is not an observation)' : ''}${detail === '' ? '' : `; ${detail.slice(0, 180)}`}`,
    )
  }
  if (compact(probe.value) !== expected) return fail(id, `${label} reported ${JSON.stringify(compact(probe.value) || 'empty')}, expected ${expected}`)
  return pass(id, label)
}

function checkContainerNetwork(options: RuntimeCheckOptions): RuntimeResult {
  return activeFact(
    'containers.default-bridge',
    'default bridge container received an address and completed TCP egress without a network override',
    options.probes?.containerNetwork,
    'not run: --allow-container-probes is required because this creates a transient container',
  )
}

function checkContainerInteractive(options: RuntimeCheckOptions): RuntimeResult {
  return activeFact(
    'containers.interactive-default-cgroup',
    'interactive podman run succeeded with its default cgroup manager (no cgroupfs override)',
    options.probes?.containerInteractive,
    'not run: --allow-container-probes is required because this starts a transient interactive container',
  )
}

function checkQuadletPersistence(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'containers.quadlet-persistence'
  const isEnabled = enabled(snapshot, 'container_enabled', id)
  if (typeof isEnabled !== 'boolean') return isEnabled
  if (!isEnabled) return skip(id, 'container.enabled=false; no Quadlet persistence probe is applicable')
  return activeFact(
    id,
    'emmc-probe survived the explicitly requested reboot and retained its pre-reboot volume prefix',
    options.probes?.quadletPersistence,
    'not run: --reboot --quadlet-persistence emmc-probe is required; this suite never creates, removes, or rewrites that probe',
    'prefix-preserved-and-heartbeat-advanced',
  )
}

function checkMqttServices(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'mqtt.services'
  const isEnabled = enabled(snapshot, 'mqtt_enabled', id)
  if (typeof isEnabled !== 'boolean') return isEnabled
  if (!isEnabled) return skip(id, 'mqtt.enabled=false; broker and bridge are intentionally not asserted active')
  const broker = fact(snapshot, 'mqtt_broker_active', id)
  if (!isFact(broker)) return broker
  const bridge = fact(snapshot, 'mqtt_bridge_active', id)
  if (!isFact(bridge)) return bridge
  if (compact(broker.value) !== 'active' || compact(bridge.value) !== 'active') {
    return fail(id, `mqtt.enabled=true but broker=${JSON.stringify(compact(broker.value))}, bridge=${JSON.stringify(compact(bridge.value))}; both must be active`)
  }
  return pass(id, 'mqtt.enabled=true; mos-mqtt-broker and mos-mqttd are active')
}

function checkMqttSubscription(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'mqtt.read-only-filter'
  const isEnabled = enabled(snapshot, 'mqtt_enabled', id)
  if (typeof isEnabled !== 'boolean') return isEnabled
  if (!isEnabled) return skip(id, 'mqtt.enabled=false; no bridge subscription is expected')
  const mode = fact(snapshot, 'mqtt_mode', id)
  if (!isFact(mode)) return mode
  const subscription = fact(snapshot, 'mqtt_subscription', id)
  if (!isFact(subscription)) return subscription
  if (compact(mode.value) !== 'read-only' || compact(subscription.value) !== 'only-read-filter') {
    return fail(id, 'bridge is not demonstrably read-only with exactly R/<deviceId>/# as its subscription filter')
  }
  return pass(id, 'bridge is read-only and records only R/<deviceId>/#; no device ID was printed')
}

function checkMqttReference(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'mqtt.reference-application'
  const isEnabled = enabled(snapshot, 'mqtt_enabled', id)
  if (typeof isEnabled !== 'boolean') return isEnabled
  if (!isEnabled) return skip(id, 'mqtt.enabled=false; reference component is not asserted')
  const reference = fact(snapshot, 'mqtt_reference', id)
  if (!isFact(reference)) return reference
  if (compact(reference.value) === 'absent') return skip(id, 'mqtt reference component is not selected in this image')
  if (compact(reference.value) !== 'selected-active') return fail(id, `mqtt reference component is selected but state=${JSON.stringify(compact(reference.value))}`)
  return pass(id, 'selected mqtt reference application is active')
}

function checkMqttPublication(snapshot: RuntimeSnapshot, options: RuntimeCheckOptions): RuntimeResult {
  const id = 'mqtt.reference-publication'
  const isEnabled = enabled(snapshot, 'mqtt_enabled', id)
  if (typeof isEnabled !== 'boolean') return isEnabled
  if (!isEnabled) return skip(id, 'mqtt.enabled=false; no keepalive publication is expected')
  const reference = fact(snapshot, 'mqtt_reference', id)
  if (!isFact(reference)) return reference
  if (compact(reference.value) === 'absent') return skip(id, 'mqtt reference component is not selected in this image')
  if (compact(reference.value) !== 'selected-active') return fail(id, 'mqtt reference component is not active, so its Item1 tree cannot be accepted')
  const probe = options.probes?.mqttReference
  if (probe === undefined) return skip(id, 'not run: --allow-mqtt-probe opens an SSH local-broker tunnel and sends one non-retained keepalive')
  if (probe.status !== 0) return fail(id, `MQTT keepalive probe exited ${probe.status}: ${probe.detail}`)
  if (probe.itemCount < 9) return fail(id, `MQTT keepalive published ${probe.itemCount} distinct reference item paths, expected the complete 9-item tree`)
  if (probe.heartbeatCount < 1) return fail(id, 'MQTT keepalive produced no device-wide heartbeat')
  if (probe.completionCount !== 1) return fail(id, `MQTT keepalive produced ${probe.completionCount} device-wide completion markers, expected exactly one per device`)
  return pass(id, 'one keepalive published the 9-item reference tree, a device-wide heartbeat, and exactly one device-wide completion marker')
}

function checkWpaCli(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'wireless.wpa-cli'
  const cli = fact(snapshot, 'wpa_cli', id)
  if (!isFact(cli)) return cli
  if (compact(cli.value) === '') return fail(id, 'wpa_cli exited 0 but printed no executable path')
  return pass(id, 'wpa_cli is available; this suite intentionally never uses iw')
}

function checkWifiAssociation(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'wireless.association'
  const isEnabled = enabled(snapshot, 'wifi_enabled', id)
  if (typeof isEnabled !== 'boolean') return isEnabled
  if (!isEnabled) return skip(id, 'wifi.client.enabled=false; no station association is expected')
  const iface = fact(snapshot, 'wifi_interface', id)
  if (!isFact(iface)) return iface
  const status = fact(snapshot, 'wpa_status', id)
  if (!isFact(status)) return status
  if (!/(?:^|\s)wpa_state=COMPLETED(?:\s|$)/.test(status.value)) {
    return fail(id, `wpa_supplicant on ${JSON.stringify(compact(iface.value))} is not associated (wpa_state=COMPLETED absent)`)
  }
  return pass(id, `wpa_supplicant reports wpa_state=COMPLETED on ${compact(iface.value)}; no iw result was interpreted`)
}

function checkPanelDriver(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'panel.driver-bound'
  const driver = fact(snapshot, 'panel_driver', id)
  if (!isFact(driver)) return driver
  const state = compact(driver.value)
  if (state === 'no-device') {
    return skip(id, 'no skykirin_led platform device: this board or device tree declares no BM201 front panel')
  }
  if (state !== 'bound') {
    return fail(id, `the skykirin_led device is present but the driver did not claim it (state=${JSON.stringify(state)})`)
  }
  // Binding and the control surface are all this can reach. Whether the
  // segments physically light is not observable over SSH and is not claimed.
  return pass(id, 'skykirin-ht1628 is bound to skykirin_led and exposes its text and enabled controls; this does not assert the segments are lit')
}

function checkPanelService(snapshot: RuntimeSnapshot): RuntimeResult {
  const id = 'panel.renderer-active'
  const service = fact(snapshot, 'panel_service', id)
  if (!isFact(service)) return service
  const state = compact(service.value)
  if (state === 'absent') {
    return skip(id, 'bm201-front-panel is not selected in this image; the driver may still be bound and the panel blank')
  }
  if (state !== 'selected-active') {
    return fail(id, `bm201-front-panel is selected but state=${JSON.stringify(state)}`)
  }
  return pass(id, 'selected bm201-front-panel renderer is active')
}

function checkExplicitWifi(options: RuntimeCheckOptions): RuntimeResult {
  const id = 'wireless.explicit-association'
  return activeFact(
    id,
    'temporary SSID/PSK association completed through a private wpa_supplicant and its /run-only state was removed',
    options.probes?.wifiAssociation,
    'not run: --allow-wifi-association, --wifi-interface, and credentials from the documented environment or mode-0600 file are required',
  )
}

/**
 * The runtime register.  It is a constant-shaped list even when feature flags
 * are false: unavailable assertions are visible as SKIP rather than silently
 * absent, and the summary can reject an empty register.
 */
export function checkRuntime(snapshot: RuntimeSnapshot, image: RuntimeImage, options: RuntimeCheckOptions): RuntimeResult[] {
  return [
    checkHostname(snapshot, options),
    checkRootSlot(snapshot, options),
    checkImageKernel(snapshot, image),
    checkDisplayArguments(snapshot, options),
    checkHdmiState(snapshot, options),
    checkTime(snapshot, options),
    checkRebootTime(snapshot, options),
    checkFwEnv(snapshot),
    checkUenv(snapshot),
    checkRauc(snapshot),
    checkMosHealth(snapshot),
    checkLogind(snapshot),
    checkQuadlet(snapshot, options),
    checkContainerNetwork(options),
    checkContainerInteractive(options),
    checkQuadletPersistence(snapshot, options),
    checkMqttServices(snapshot),
    checkMqttSubscription(snapshot),
    checkMqttReference(snapshot),
    checkMqttPublication(snapshot, options),
    checkWpaCli(snapshot),
    checkWifiAssociation(snapshot),
    checkExplicitWifi(options),
    checkPanelDriver(snapshot),
    checkPanelService(snapshot),
  ]
}

export const RUNTIME_CHECK_IDS = [
  'identity.hostname-state',
  'boot.root-slot',
  'boot.deployed-kernel',
  'display.boot-arguments',
  'display.connector',
  'time.ntp-and-clock',
  'time.after-reboot',
  'ab.fw-printenv',
  'ab.redundant-uenv',
  'ab.rauc-status',
  'ab.mos-health',
  'logind.ssh-session',
  'containers.quadlet-state',
  'containers.default-bridge',
  'containers.interactive-default-cgroup',
  'containers.quadlet-persistence',
  'mqtt.services',
  'mqtt.read-only-filter',
  'mqtt.reference-application',
  'mqtt.reference-publication',
  'wireless.wpa-cli',
  'wireless.association',
  'wireless.explicit-association',
  'panel.driver-bound',
  'panel.renderer-active',
] as const

export interface RuntimeConclusion {
  readonly exitCode: number
  readonly line: string
}

/** Same PASS/FAIL/SKIP and non-vacuous RESULT convention as verify-cli.ts. */
export function concludeRuntime(results: readonly RuntimeResult[]): RuntimeConclusion {
  const ids = new Set(results.map(result => result.id))
  const expected = new Set<string>(RUNTIME_CHECK_IDS)
  const wrongShape = results.length !== RUNTIME_CHECK_IDS.length
    || ids.size !== results.length
    || [...expected].some(id => !ids.has(id))
  const passed = results.filter(result => result.verdict === 'pass').length
  const failed = results.filter(result => result.verdict === 'fail').length
  const skipped = results.filter(result => result.verdict === 'skip').length
  const total = passed + failed
  const skipSuffix = skipped === 0 ? '' : `, ${skipped} skipped (each named above)`
  if (wrongShape || total === 0) {
    return {
      exitCode: 1,
      line: `RESULT: FAIL (${passed}/${total} checks${skipSuffix}); runtime register was ${wrongShape ? 'not complete' : 'vacuous'}`,
    }
  }
  return {
    exitCode: failed === 0 ? 0 : 1,
    line: `RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${total} checks${skipSuffix})`,
  }
}
