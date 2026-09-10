import type { Artifact } from './components.ts'
import { authenticatePayload, canonicalJson, componentId } from './components.ts'

export interface Firmware {
  schema: 'mos/firmware/v1'
  id: string
  board: 'x64' | 'virt-arm64' | 'cx3576' | 's905x5m'
  arch: 'amd64' | 'arm64'
  generation: number
  version: string
  artifact: Artifact
  target: { format: 'efi', partition: 1, path: string }
    | { format: 'rockchip-loader', diskOffset: 32768, maxBytes: 16744448 }
    | { format: 'amlogic-boot0', payloadOffset: 512, maxBytes: 4193792 }
}

function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Invalid firmware contract: ${message}`)
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected object')
  const record = value as Record<string, unknown>
  requireValue(Object.keys(record).sort().join() === fields.sort().join(), 'unknown or missing fields')
  return record
}

export function parseFirmware(payload: string): Firmware {
  requireValue(Buffer.byteLength(payload) <= 4096, 'manifest exceeds limit')
  const value: unknown = JSON.parse(payload)
  requireValue(canonicalJson(value) === payload, 'noncanonical or duplicate fields')
  const firmware = object(value, ['schema', 'id', 'board', 'arch', 'generation', 'version', 'artifact', 'target'])
  requireValue(firmware.schema === 'mos/firmware/v1', 'unsupported schema')
  requireValue(['x64', 'virt-arm64', 'cx3576', 's905x5m'].includes(firmware.board as string)
    && firmware.arch === (firmware.board === 'x64' ? 'amd64' : 'arm64'), 'board/architecture mismatch')
  requireValue(Number.isSafeInteger(firmware.generation) && (firmware.generation as number) > 0, 'invalid generation')
  requireValue(typeof firmware.version === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(firmware.version), 'invalid version')
  requireValue(typeof firmware.id === 'string' && /^[0-9a-f]{64}$/.test(firmware.id)
    && componentId(firmware) === firmware.id, 'identity mismatch')
  const artifact = object(firmware.artifact, ['bytes', 'sha256'])
  requireValue(typeof artifact.sha256 === 'string' && /^[0-9a-f]{64}$/.test(artifact.sha256), 'invalid digest')
  requireValue(Number.isSafeInteger(artifact.bytes) && (artifact.bytes as number) > 0
    && (artifact.bytes as number) <= (firmware.board === 'cx3576' ? 16744448 : 4 * 1048576), 'invalid length')
  if (firmware.board === 'cx3576') {
    const target = object(firmware.target, ['format', 'diskOffset', 'maxBytes'])
    requireValue(target.format === 'rockchip-loader' && target.diskOffset === 32768 && target.maxBytes === 16744448, 'invalid loader write range')
  } else if (firmware.board === 's905x5m') {
    const target = object(firmware.target, ['format', 'payloadOffset', 'maxBytes'])
    requireValue(target.format === 'amlogic-boot0' && target.payloadOffset === 512 && target.maxBytes === 4193792
      && (artifact.bytes as number) <= 4193792, 'invalid Amlogic boot0 payload')
  } else {
    const target = object(firmware.target, ['format', 'partition', 'path'])
    const filename = firmware.board === 'x64' ? 'BOOTX64.EFI' : 'BOOTAA64.EFI'
    requireValue(target.format === 'efi' && target.partition === 1 && target.path === `EFI/BOOT/${filename}`, 'invalid EFI destination')
  }
  return value as Firmware
}

export function authenticateFirmware(bytes: string, publicKeys: readonly string[]): Firmware {
  return parseFirmware(authenticatePayload(bytes, publicKeys))
}
