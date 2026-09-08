// `verify/run.sh --runtime HOST`: acceptance checks against one booted board.
//
// The command's transport host is deliberately not its identity.  A caller may
// use today's IP address, DNS name, or SSH alias only as the route to a board;
// runtime.ts requires the returned hostname and STATE-backed hostname bind.

import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { BOARDS_DIR, boardEnvPath } from './paths.ts'
import { inspectRuntimeImage } from './runtime-image.ts'
import { mqttDeviceId, probeMqttReference } from './runtime-mqtt.ts'
import {
  capturePersistenceBefore,
  loadWifiCredentials,
  probeContainerInteractive,
  probeContainerNetwork,
  probeWifiAssociation,
  reconnectAfterReboot,
  requestReboot,
  verifyPersistenceAfter,
} from './runtime-probes.ts'
import { collectRuntimeSnapshot, validateRuntimeHost } from './runtime-ssh.ts'
import {
  checkRuntime,
  concludeRuntime,
  type ActiveProbes,
  type RuntimeFact,
  type RuntimeImage,
  type RuntimeSnapshot,
} from './runtime.ts'

interface Options {
  host: string
  board: string
  hostname: string
  image: string
  maxClockSkewSeconds: number
  expectHdmi: string | undefined
  allowContainerProbes: boolean
  allowMqttProbe: boolean
  allowWifiAssociation: boolean
  wifiInterface: string | undefined
  wifiCredentialsFile: string | undefined
  reboot: boolean
  quadletPersistence: boolean
  reconnectHosts: string[]
  rebootTimeoutSeconds: number
}

function usage(): string {
  return [
    'usage: bash verify/run.sh --runtime HOST --board NAME --expect-hostname NAME --image PATH [options]',
    '',
    'Runs read-only acceptance checks over the caller\'s SSH configuration. HOST is transport only;',
    'the returned hostname and STATE-backed hostname bind establish board identity.',
    '',
    'required:',
    '  --board NAME                 board layout (no default)',
    '  --expect-hostname NAME       persistent hostname expected from STATE',
    '  --image PATH                 exact deployed image; never defaults to local latest',
    '',
    'read-only options:',
    '  --max-clock-skew SECONDS     caller/board clock limit (default 300)',
    '  --expect-hdmi [MODE]         require connected HDMI, optionally named DRM mode',
    '',
    'explicit active actions:',
    '  --allow-container-probes     create/remove a transient default-network Podman probe',
    '  --allow-mqtt-probe           tunnel to board-local MQTT and send one non-retained keepalive',
    '  --allow-wifi-association     temporarily associate via a private wpa_supplicant, then remove it',
    '  --wifi-interface IFACE       required with --allow-wifi-association; interface used only by that temporary probe',
    '  --wifi-credentials-file PATH local mode-0600 SSID=/PSK= file; otherwise use MOS_RUNTIME_WIFI_SSID/PSK',
    '  --reboot                     request a normal system reboot, then require a new boot ID and sane clock',
    '  --quadlet-persistence emmc-probe  only with --reboot; reuse the existing probe and verify its volume prefix',
    '  --reconnect HOST             retry endpoint after reboot (repeatable; expected hostname is also tried)',
    '  --reboot-timeout SECONDS     reconnect deadline, 30..900 (default 240)',
    '',
    'This suite never writes eMMC hardware boot areas, bootloader_a, or a RAUC slot.',
  ].join('\n')
}

function integer(value: string, option: string, min: number, max: number): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${option} needs a whole number, got ${JSON.stringify(value)}`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${option} must be ${min}..${max}, got ${value}`)
  return parsed
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    host: '', board: '', hostname: '', image: '', maxClockSkewSeconds: 300,
    expectHdmi: undefined, allowContainerProbes: false, allowMqttProbe: false,
    allowWifiAssociation: false, wifiInterface: undefined, wifiCredentialsFile: undefined, reboot: false,
    quadletPersistence: false, reconnectHosts: [], rebootTimeoutSeconds: 240,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    const next = (): string => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      index += 1
      return value
    }
    switch (arg) {
      case '--help': case '-h': console.log(usage()); process.exit(0); break
      case '--host': options.host = next(); break
      case '--board': options.board = next(); break
      case '--expect-hostname': options.hostname = next(); break
      case '--image': options.image = next(); break
      case '--max-clock-skew': options.maxClockSkewSeconds = integer(next(), arg, 1, 86_400); break
      case '--expect-hdmi': {
        const possibleMode = argv[index + 1]
        if (possibleMode !== undefined && !possibleMode.startsWith('--')) { options.expectHdmi = possibleMode; index += 1 }
        else options.expectHdmi = ''
        break
      }
      case '--allow-container-probes': options.allowContainerProbes = true; break
      case '--allow-mqtt-probe': options.allowMqttProbe = true; break
      case '--allow-wifi-association': options.allowWifiAssociation = true; break
      case '--wifi-interface': options.wifiInterface = next(); break
      case '--wifi-credentials-file': options.wifiCredentialsFile = next(); break
      case '--reboot': options.reboot = true; break
      case '--quadlet-persistence': {
        const value = next()
        if (value !== 'emmc-probe') throw new Error('--quadlet-persistence accepts only the owner-installed emmc-probe')
        options.quadletPersistence = true
        break
      }
      case '--reconnect': options.reconnectHosts.push(next()); break
      case '--reboot-timeout': options.rebootTimeoutSeconds = integer(next(), arg, 30, 900); break
      default: throw new Error(`unknown option ${JSON.stringify(arg)}\n\n${usage()}`)
    }
  }
  if (options.host === '' || options.board === '' || options.hostname === '' || options.image === '') {
    throw new Error(`--runtime requires host, --board, --expect-hostname, and --image\n\n${usage()}`)
  }
  validateRuntimeHost(options.host)
  for (const host of options.reconnectHosts) validateRuntimeHost(host)
  if (options.quadletPersistence && !options.reboot) throw new Error('--quadlet-persistence emmc-probe requires --reboot')
  if (options.wifiCredentialsFile !== undefined && !options.allowWifiAssociation) {
    throw new Error('--wifi-credentials-file is meaningful only with --allow-wifi-association; it was not read')
  }
  if (options.wifiInterface !== undefined && !options.allowWifiAssociation) {
    throw new Error('--wifi-interface is meaningful only with --allow-wifi-association')
  }
  if (options.allowWifiAssociation && options.wifiInterface === undefined) {
    throw new Error('--allow-wifi-association requires --wifi-interface IFACE; it was not guessed from a board setting')
  }
  return options
}

function boardOrRefuse(name: string): Board {
  const shipped = readdirSync(BOARDS_DIR).sort().join(', ')
  const path = boardEnvPath(name)
  if (!existsSync(path)) throw new Error(`${JSON.stringify(name)} is not a shipped board; boards/ contains ${shipped}`)
  return loadBoard(path)
}

function bool(snapshot: RuntimeSnapshot, name: 'container_enabled' | 'mqtt_enabled' | 'wifi_enabled'): boolean {
  const value = snapshot[name]
  return value?.status === 0 && value.value.trim() === 'true'
}

function slot(snapshot: RuntimeSnapshot): 'A' | 'B' | undefined {
  const cmdline = snapshot.cmdline
  const found = cmdline?.status === 0 ? /(?:^|\s)rauc\.slot=([AB])(?:\s|$)/.exec(cmdline.value)?.[1] : undefined
  return found === 'A' || found === 'B' ? found : undefined
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 300) : 'unexpected probe failure'
}

async function asFact(work: () => Promise<RuntimeFact>): Promise<RuntimeFact> {
  try { return await work() }
  catch (error) { return { status: 1, value: safeError(error) } }
}

function printAction(text: string): void {
  console.log(`ACTION: ${text}`)
}

function transportFailure(error: unknown): number {
  console.log(`FAIL: runtime transport: ${safeError(error)}`)
  console.log('RESULT: FAIL (1/1 transport check; runtime facts unavailable)')
  return 1
}

async function main(): Promise<number> {
  const options = parseArgs(Bun.argv.slice(2))
  const board = boardOrRefuse(options.board)
  if (board.name !== 's905x5m') {
    throw new Error(`--runtime currently supports the campaign's s905x5m U-Boot A/B layout only, not ${board.name}`)
  }
  const imagePath = isAbsolute(options.image) ? options.image : resolve(process.cwd(), options.image)
  if (!existsSync(imagePath)) throw new Error(`named deployed image ${imagePath} does not exist`)

  console.log(`verify runtime: transport=${options.host}; expected hostname=${options.hostname}; board=${board.name}`)
  let snapshot: RuntimeSnapshot
  let callerEpoch = Math.floor(Date.now() / 1000)
  try { snapshot = await collectRuntimeSnapshot(options.host) }
  catch (error) { return transportFailure(error) }

  let image: RuntimeImage
  const activeSlot = slot(snapshot)
  if (activeSlot === undefined) image = { bootImageSha256: '', kernelRelease: undefined, diagnostic: 'running command line has no usable rauc.slot=A|B' }
  else {
    try { image = await inspectRuntimeImage(board, imagePath, activeSlot) }
    catch (error) { image = { bootImageSha256: '', kernelRelease: undefined, diagnostic: safeError(error) } }
  }

  let probes: ActiveProbes = {}
  if (options.allowContainerProbes && bool(snapshot, 'container_enabled')) {
    printAction('creating one transient default-bridge Podman container, checking address/TCP egress, then removing it; no fallback and no cgroup-manager override')
    probes = { ...probes, containerNetwork: await asFact(() => probeContainerNetwork(options.host)) }
    printAction('starting one transient interactive Podman container with default arguments; it is removed on exit')
    probes = { ...probes, containerInteractive: await asFact(() => probeContainerInteractive(options.host)) }
  }

  if (options.allowMqttProbe && bool(snapshot, 'mqtt_enabled') && snapshot.mqtt_reference?.value.trim() === 'selected-active') {
    printAction('opening an SSH tunnel to the board-local broker and sending one non-retained MQTT keepalive; payloads and credentials are not recorded')
    try {
      const deviceId = await mqttDeviceId(options.host)
      probes = { ...probes, mqttReference: await probeMqttReference(options.host, deviceId) }
    }
    catch (error) {
      probes = { ...probes, mqttReference: { status: 1, itemCount: 0, heartbeatCount: 0, completionCount: 0, detail: safeError(error) } }
    }
  }

  if (options.allowWifiAssociation) {
    printAction(`starting a private temporary wpa_supplicant on ${options.wifiInterface!}, associating with supplied SSID/PSK, then removing its process and /run-only files; this can briefly interrupt Wi-Fi and never saves credentials`)
    probes = {
      ...probes,
      wifiAssociation: await asFact(async () => probeWifiAssociation(options.host, options.wifiInterface!, loadWifiCredentials(options.wifiCredentialsFile))),
    }
  }

  if (options.reboot) {
    let persistence
    if (options.quadletPersistence) {
      printAction('capturing the existing emmc-probe volume prefix for post-reboot comparison; it will not be created, removed, or rewritten')
      try { persistence = await capturePersistenceBefore(options.host) }
      catch (error) { probes = { ...probes, quadletPersistence: { status: 1, value: safeError(error) } } }
    }
    printAction('requesting one normal system reboot; this does not change a RAUC slot and never writes eMMC boot areas or bootloader_a')
    try {
      const beforeBootId = snapshot.boot_id?.status === 0 ? snapshot.boot_id.value.trim() : ''
      if (beforeBootId === '') throw new Error('cannot prove reboot because pre-reboot boot ID is unavailable')
      await requestReboot(options.host)
      const reconnect = await reconnectAfterReboot(
        [...options.reconnectHosts, options.hostname, options.host],
        beforeBootId,
        options.rebootTimeoutSeconds,
      )
      snapshot = reconnect.snapshot
      callerEpoch = Math.floor(Date.now() / 1000)
      probes = {
        ...probes,
        postReboot: snapshot,
        preRebootBootId: beforeBootId,
        postRebootCallerEpoch: callerEpoch,
      }
      console.log(`verify runtime: reconnected through transport=${reconnect.host}; hostname/STATE identity is rechecked below`)
      if (persistence !== undefined) {
        printAction('checking that the reused emmc-probe volume retained its pre-reboot prefix and resumed writing')
        probes = { ...probes, quadletPersistence: await verifyPersistenceAfter(reconnect.host, persistence) }
      }
    }
    catch (error) {
      // Feed a constructed unchanged boot ID to the ordinary reboot assertion,
      // so a requested reboot that failed cannot degrade into a SKIP.
      probes = {
        ...probes,
        preRebootBootId: snapshot.boot_id?.value ?? '',
        postReboot: { ...snapshot, boot_id: { status: 0, value: snapshot.boot_id?.value ?? '' } },
      }
      if (options.quadletPersistence && probes.quadletPersistence === undefined) {
        probes = { ...probes, quadletPersistence: { status: 1, value: safeError(error) } }
      }
      console.log(`FAIL: reboot action: ${safeError(error)}`)
    }
  }

  const results = checkRuntime(snapshot, image, {
    board,
    expectedHostname: options.hostname,
    callerEpoch,
    maxClockSkewSeconds: options.maxClockSkewSeconds,
    expectHdmi: options.expectHdmi,
    probes,
  })
  for (const result of results) {
    const prefix = result.verdict === 'pass' ? 'PASS' : result.verdict === 'fail' ? 'FAIL' : 'SKIP'
    console.log(`${prefix}: ${result.message}`)
  }
  const conclusion = concludeRuntime(results)
  console.log(conclusion.line)
  return conclusion.exitCode
}

try {
  process.exit(await main())
}
catch (error) {
  console.error(`error: ${safeError(error)}`)
  process.exit(1)
}
