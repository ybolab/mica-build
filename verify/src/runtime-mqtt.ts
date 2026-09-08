// A deliberately small MQTT 3.1.1 observer for the explicit runtime probe.
//
// The board ships no mosquitto client binaries.  Instead of installing one or
// exposing the broker on the LAN, this opens `ssh -W 127.0.0.1:1883` through the
// caller's configured SSH transport, subscribes, sends one non-retained
// keepalive, and observes only topic headers.  Payloads and broker credentials
// never enter output or the acceptance record.

import { validateRuntimeHost } from './runtime-ssh.ts'
import type { MqttProbe } from './runtime.ts'

export interface MqttPublish {
  readonly topic: string
  readonly retain: boolean
}

interface Packet {
  readonly header: number
  readonly body: Uint8Array
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function remainingLength(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 268_435_455) throw new Error(`invalid MQTT remaining length ${value}`)
  const bytes: number[] = []
  let rest = value
  do {
    let digit = rest % 128
    rest = Math.floor(rest / 128)
    if (rest > 0) digit |= 0x80
    bytes.push(digit)
  } while (rest > 0)
  return Uint8Array.from(bytes)
}

function text(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength > 0xffff) throw new Error('MQTT text field exceeds 65535 bytes')
  return concat([Uint8Array.of(encoded.byteLength >>> 8, encoded.byteLength & 0xff), encoded])
}

function packet(header: number, body: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(header), remainingLength(body.byteLength), body])
}

export function connectPacket(clientId: string): Uint8Array {
  const variable = concat([
    text('MQTT'),
    Uint8Array.of(4, 0x02, 0, 30), // MQTT 3.1.1, clean session, 30 s keepalive
    text(clientId),
  ])
  return packet(0x10, variable)
}

export function subscribePacket(topic: string, id: number = 1): Uint8Array {
  if (!Number.isSafeInteger(id) || id < 1 || id > 0xffff) throw new Error('MQTT packet ID must be 1..65535')
  return packet(0x82, concat([Uint8Array.of(id >>> 8, id & 0xff), text(topic), Uint8Array.of(0)]))
}

export function publishPacket(topic: string): Uint8Array {
  return packet(0x30, text(topic)) // QoS 0, non-retained, empty payload
}

export function disconnectPacket(): Uint8Array {
  return Uint8Array.of(0xe0, 0)
}

/** Incremental packet framing; payload is held only long enough to find a topic. */
export class MqttDecoder {
  #pending = new Uint8Array()

  push(chunk: Uint8Array): Packet[] {
    this.#pending = concat([this.#pending, chunk])
    const packets: Packet[] = []
    let offset = 0
    while (offset < this.#pending.byteLength) {
      if (offset + 2 > this.#pending.byteLength) break
      let multiplier = 1
      let remaining = 0
      let cursor = offset + 1
      let digits = 0
      for (;;) {
        if (cursor >= this.#pending.byteLength) {
          this.#pending = this.#pending.slice(offset)
          return packets
        }
        const digit = this.#pending[cursor] as number
        cursor += 1
        remaining += (digit & 0x7f) * multiplier
        multiplier *= 128
        digits += 1
        if ((digit & 0x80) === 0) break
        if (digits === 4) throw new Error('MQTT remaining length uses more than four bytes')
      }
      if (cursor + remaining > this.#pending.byteLength) break
      packets.push({ header: this.#pending[offset] as number, body: this.#pending.slice(cursor, cursor + remaining) })
      offset = cursor + remaining
    }
    this.#pending = this.#pending.slice(offset)
    return packets
  }
}

export function parsePublish(packetValue: Packet): MqttPublish | undefined {
  if ((packetValue.header >> 4) !== 3 || packetValue.body.byteLength < 2) return undefined
  const topicLength = ((packetValue.body[0] as number) << 8) | (packetValue.body[1] as number)
  let cursor = 2
  if (cursor + topicLength > packetValue.body.byteLength) return undefined
  const topic = new TextDecoder().decode(packetValue.body.slice(cursor, cursor + topicLength))
  cursor += topicLength
  const qos = (packetValue.header >> 1) & 0x03
  if (qos > 2 || (qos > 0 && cursor + 2 > packetValue.body.byteLength)) return undefined
  return { topic, retain: (packetValue.header & 1) === 1 }
}

function expectedReferenceTopics(deviceId: string): Set<string> {
  return new Set([
    'Mgmt/ProcessName',
    'Mgmt/ProcessVersion',
    'Mgmt/Connection',
    'DeviceInstance',
    'ProductId',
    'ProductName',
    'Connected',
    'Example/ReadOnly',
    'Example/Setpoint',
  ].map(path => `N/${deviceId}/mqttsample/1/${path}`))
}

/** Pure verdict of a synthetic or live observation; every branch is fixtureable. */
export function judgeMqttObservation(publishes: readonly MqttPublish[], deviceId: string, connected: boolean, subscribed: boolean): MqttProbe {
  if (!connected) return { status: 1, itemCount: 0, heartbeatCount: 0, completionCount: 0, detail: 'broker did not accept MQTT CONNECT' }
  if (!subscribed) return { status: 1, itemCount: 0, heartbeatCount: 0, completionCount: 0, detail: 'broker did not acknowledge N/<deviceId>/# subscription' }
  const expected = expectedReferenceTopics(deviceId)
  const items = new Set(publishes.filter(publish => expected.has(publish.topic)).map(publish => publish.topic))
  const heartbeat = publishes.filter(publish => publish.topic === `N/${deviceId}/heartbeat`)
  const completion = publishes.filter(publish => publish.topic === `N/${deviceId}/full_publish_completed`)
  if (heartbeat.some(publish => publish.retain) || completion.some(publish => publish.retain)) {
    return { status: 1, itemCount: items.size, heartbeatCount: heartbeat.length, completionCount: completion.length, detail: 'device-wide heartbeat or completion was retained' }
  }
  if (items.size !== expected.size) {
    return { status: 1, itemCount: items.size, heartbeatCount: heartbeat.length, completionCount: completion.length, detail: 'reference Item1 tree was incomplete after keepalive' }
  }
  if (heartbeat.length < 1) {
    return { status: 1, itemCount: items.size, heartbeatCount: 0, completionCount: completion.length, detail: 'no device-wide heartbeat arrived after keepalive' }
  }
  if (completion.length !== 1) {
    return { status: 1, itemCount: items.size, heartbeatCount: heartbeat.length, completionCount: completion.length, detail: 'device-wide completion did not appear exactly once' }
  }
  return { status: 0, itemCount: items.size, heartbeatCount: heartbeat.length, completionCount: completion.length, detail: 'expected topic headers observed' }
}

function clientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `mos-runtime-${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function validDeviceId(deviceId: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(deviceId)) throw new Error('MQTT device ID is not a safe topic segment')
  return deviceId
}

/**
 * Observe the local broker through an SSH stdio forwarding channel.  No MQTT
 * payload is logged: the verdict sees only topic headers and retain bits.
 */
export async function probeMqttReference(hostInput: string, deviceInput: string, observeMs: number = 8_000): Promise<MqttProbe> {
  const host = validateRuntimeHost(hostInput)
  const deviceId = validDeviceId(deviceInput)
  const ssh = process.env['SSH_BIN'] ?? 'ssh'
  const proc = Bun.spawn([
    ssh, '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
    '-W', '127.0.0.1:1883', `root@${host}`,
  ], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const decoder = new MqttDecoder()
  const publishes: MqttPublish[] = []
  let connected = false
  let subscribed = false
  let decoderError: string | undefined
  const reader = proc.stdout.getReader()
  const readerTask = (async (): Promise<void> => {
    try {
      for (;;) {
        const read = await reader.read()
        if (read.done) return
        for (const received of decoder.push(read.value)) {
          const type = received.header >> 4
          if (type === 2 && received.body.byteLength >= 2 && received.body[1] === 0) connected = true
          if (type === 9 && received.body.byteLength >= 3 && received.body[2] === 0) subscribed = true
          const publication = parsePublish(received)
          if (publication !== undefined) publishes.push(publication)
        }
      }
    }
    catch (error) {
      decoderError = error instanceof Error ? error.message : 'invalid MQTT packet'
    }
  })()

  try {
    proc.stdin.write(concat([
      connectPacket(clientId()),
      subscribePacket(`N/${deviceId}/#`),
      publishPacket(`R/${deviceId}/keepalive`),
    ]))
    await Bun.sleep(observeMs)
    try { proc.stdin.write(disconnectPacket()); proc.stdin.end() } catch { /* tunnel already closed */ }
    const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(1_000).then(() => false)])
    if (!exited) proc.kill()
    await readerTask
  }
  finally {
    try { proc.stdin.end() } catch { /* already ended */ }
    try { reader.releaseLock() } catch { /* reader already closed */ }
  }

  if (decoderError !== undefined) {
    return { status: 1, itemCount: 0, heartbeatCount: 0, completionCount: 0, detail: `MQTT decode error: ${decoderError}` }
  }
  const transportStatus = await proc.exited
  if (transportStatus !== 0 && !connected) {
    return { status: 1, itemCount: 0, heartbeatCount: 0, completionCount: 0, detail: `SSH local-broker tunnel exited ${transportStatus} before MQTT CONNECT` }
  }
  return judgeMqttObservation(publishes, deviceId, connected, subscribed)
}

/** Read only the safe device-ID field; it is not printed by this helper. */
export async function mqttDeviceId(hostInput: string): Promise<string> {
  const host = validateRuntimeHost(hostInput)
  const result = await Bun.spawn([
    process.env['SSH_BIN'] ?? 'ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
    `root@${host}`,
    "exec /bin/sh -c 'while IFS= read -r line; do case \"$line\" in MOS_MQTT_DEVICE_ID=*) value=${line#MOS_MQTT_DEVICE_ID=}; case \"$value\" in \"\"|*[!A-Za-z0-9._:-]*) exit 1;; esac; printf %s \"$value\"; exit 0;; esac; done < /run/mos/mqttd-device.env; exit 1'",
  ], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, status] = await Promise.all([new Response(result.stdout).text(), result.exited])
  if (status !== 0) throw new Error('could not read a safe MQTT device ID from the board')
  return validDeviceId(stdout.trim())
}
