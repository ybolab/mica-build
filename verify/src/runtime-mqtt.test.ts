import { describe, expect, test } from 'bun:test'
import {
  MqttDecoder,
  connectPacket,
  disconnectPacket,
  judgeMqttObservation,
  parsePublish,
  publishPacket,
  subscribePacket,
  type MqttPublish,
} from './runtime-mqtt.ts'

const device = 'fixture-device'
const tree = [
  'Mgmt/ProcessName', 'Mgmt/ProcessVersion', 'Mgmt/Connection', 'DeviceInstance', 'ProductId',
  'ProductName', 'Connected', 'Example/ReadOnly', 'Example/Setpoint',
].map(path => ({ topic: `N/${device}/mqttsample/1/${path}`, retain: false }))

function brokerPublish(topic: string, retain: boolean = false): Uint8Array {
  const body = new TextEncoder().encode(topic)
  const packet = new Uint8Array(1 + 1 + 2 + body.byteLength)
  packet[0] = retain ? 0x31 : 0x30
  packet[1] = body.byteLength + 2
  packet[2] = body.byteLength >>> 8
  packet[3] = body.byteLength & 0xff
  packet.set(body, 4)
  return packet
}

describe('runtime MQTT observer', () => {
  test('encodes only clean-session connect, topic subscription, non-retained keepalive, and disconnect', () => {
    expect(connectPacket('client')[0]).toBe(0x10)
    expect(subscribePacket('N/device/#')[0]).toBe(0x82)
    expect(publishPacket('R/device/keepalive')[0]).toBe(0x30)
    expect(disconnectPacket()).toEqual(Uint8Array.of(0xe0, 0))
  })

  test('frames a split broker PUBLISH and does not inspect payload content', () => {
    const encoded = brokerPublish(`N/${device}/heartbeat`)
    const decoder = new MqttDecoder()
    expect(decoder.push(encoded.slice(0, 3))).toEqual([])
    const packets = decoder.push(encoded.slice(3))
    expect(packets).toHaveLength(1)
    expect(parsePublish(packets[0]!)?.topic).toBe(`N/${device}/heartbeat`)
  })

  test('requires the full Item1 tree, a non-retained heartbeat, and exactly one completion', () => {
    const good: MqttPublish[] = [
      ...tree,
      { topic: `N/${device}/heartbeat`, retain: false },
      { topic: `N/${device}/full_publish_completed`, retain: false },
    ]
    expect(judgeMqttObservation(good, device, true, true).status).toBe(0)
    expect(judgeMqttObservation(good.slice(1), device, true, true).detail).toContain('incomplete')
    expect(judgeMqttObservation([...tree, { topic: `N/${device}/full_publish_completed`, retain: false }], device, true, true).detail).toContain('heartbeat')
    expect(judgeMqttObservation([...tree, { topic: `N/${device}/heartbeat`, retain: false }], device, true, true).detail).toContain('exactly once')
    expect(judgeMqttObservation([...good, { topic: `N/${device}/full_publish_completed`, retain: false }], device, true, true).detail).toContain('exactly once')
    expect(judgeMqttObservation([...tree, { topic: `N/${device}/heartbeat`, retain: true }, { topic: `N/${device}/full_publish_completed`, retain: false }], device, true, true).detail).toContain('retained')
  })
})
