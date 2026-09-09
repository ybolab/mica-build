import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { authenticateDeployment, canonicalJson, componentId } from './components.ts'
import { authenticateFirmware } from './firmware.ts'

const FILES = {
  'image.img': 'image', 'update.mosupd': 'update', 'firmware.json': 'firmware-manifest',
  'firmware.bin': 'firmware', 'package-manifest.tsv': 'packages', 'baked-meta.json': 'meta',
  'development-marker.txt': 'development-marker', 'board-evidence.json': 'evidence',
  'builder-images.json': 'build-inputs', 'sbom.cdx.json': 'sbom', 'licenses.json': 'licenses',
  'provenance.json': 'provenance', 'release-notes.md': 'notes', 'SHA256SUMS': 'checksums',
} as const
const CHANNELS = ['development', 'candidate', 'stable'] as const
export type ReleaseChannel = typeof CHANNELS[number]
type Source = { commit: string, dirty: boolean }
type Artifact = { filename: string, role: string, bytes: number, sha256: string }
export interface ReleaseManifest {
  schema: 'mos/release/v1'
  board: 'x64' | 'virt-arm64' | 'cx3576'
  version: string
  channel: ReleaseChannel
  profile: 'dev' | 'prod'
  source: Source
  bootAssurance: string
  developmentDomains: string[]
  artifacts: Artifact[]
}
export interface ReleaseInputs {
  out: string, board: ReleaseManifest['board'], version: string, channel: ReleaseChannel,
  profile: ReleaseManifest['profile'], source: Source, builderImages: Record<string, string>,
  image: string, update: string, firmware: string, packages: string, meta: string,
  notes: string, evidence: string, keys: string[],
}
const OFFER = 'Source code for the packages in this inventory, including any modifications, is available on request from the distributor of this image; cite the source commit recorded beside this statement.'
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Invalid release: ${message}`)
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected object')
  const record = value as Record<string, unknown>
  requireValue(Object.keys(record).sort().join() === [...fields].sort().join(), 'unknown or missing fields')
  return record
}
function regular(path: string) {
  const stat = lstatSync(path)
  requireValue(stat.isFile(), `regular file required: ${path}`)
  return stat
}
function read(path: string, limit = 16 * 1048576): string {
  requireValue(regular(path).size <= limit, `bounded record exceeded: ${path}`)
  return readFileSync(path, 'utf8')
}
export function fileSha256(path: string): string {
  regular(path)
  const fd = openSync(path, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1048576)
  try {
    for (;;) { const n = readSync(fd, buffer); if (!n) break; hash.update(buffer.subarray(0, n)) }
    return hash.digest('hex')
  } finally { closeSync(fd) }
}
function measure(dir: string, filename: string): Artifact {
  const path = join(dir, filename)
  return { filename, role: FILES[filename as keyof typeof FILES], bytes: regular(path).size, sha256: fileSha256(path) }
}
function json(dir: string, filename: string, value: unknown) {
  writeFileSync(join(dir, filename), `${JSON.stringify(value, null, 2)}\n`)
}
function sums(artifacts: Artifact[]): string {
  return artifacts.filter(a => a.role !== 'checksums').map(a => `${a.sha256}  ${a.filename}\n`).join('')
}
function manifest(value: unknown): ReleaseManifest {
  const m = object(value, ['schema', 'board', 'version', 'channel', 'profile', 'source', 'bootAssurance', 'developmentDomains', 'artifacts'])
  requireValue(m.schema === 'mos/release/v1', 'unsupported schema')
  requireValue(['x64', 'virt-arm64', 'cx3576'].includes(m.board as string), 'unsupported board')
  requireValue(typeof m.version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(m.version), 'invalid version')
  requireValue(CHANNELS.includes(m.channel as ReleaseChannel) && ['dev', 'prod'].includes(m.profile as string), 'channel or profile')
  const source = object(m.source, ['commit', 'dirty'])
  requireValue(typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit) && typeof source.dirty === 'boolean', 'source identity')
  requireValue(['I1', 'I2', 'I3', 'I4'].includes(m.bootAssurance as string), 'boot assurance')
  requireValue(Array.isArray(m.developmentDomains) && m.developmentDomains.every(d => ['boot', 'verity', 'updates'].includes(d))
    && new Set(m.developmentDomains).size === m.developmentDomains.length, 'development domains')
  requireValue(Array.isArray(m.artifacts) && m.artifacts.length === Object.keys(FILES).length, 'artifact count')
  const seen = new Set<string>()
  for (const value of m.artifacts) {
    const a = object(value, ['filename', 'role', 'bytes', 'sha256'])
    requireValue(typeof a.filename === 'string' && Object.hasOwn(FILES, a.filename)
      && FILES[a.filename as keyof typeof FILES] === a.role && !seen.has(a.filename), 'artifact filename or role')
    seen.add(a.filename)
    requireValue(Number.isSafeInteger(a.bytes) && (a.bytes as number) >= 0
      && typeof a.sha256 === 'string' && /^[a-f0-9]{64}$/.test(a.sha256), 'artifact digest or length')
  }
  return value as ReleaseManifest
}
function domains(marker: string): string[] {
  if (marker === '') return []
  const match = /^DEVELOPMENT-GRADE\nDOMAINS=((?:boot|verity|updates)(?: (?:boot|verity|updates))*)\n$/.exec(marker)
  requireValue(match, 'malformed development marker')
  const result = match[1]!.split(' ')
  requireValue(new Set(result).size === result.length, 'duplicate development marker domain')
  return result.sort()
}
function evidence(value: unknown, board: string): string {
  const e = object(value, ['schemaVersion', 'board', 'revision', 'bootAssurance', 'qualification', 'evidenceRefs', 'physicalBoundaries'])
  requireValue(e.schemaVersion === 2 && e.board === board, 'evidence board or schema')
  for (const field of ['revision', 'qualification']) requireValue(typeof e[field] === 'string' && (e[field] as string).trim(), `evidence ${field}`)
  const levels: Record<string, string[]> = {
    I1: ['verity-root'], I2: ['verity-root', 'ab-fallback', 'update-negative'],
    I3: ['verity-root', 'ab-fallback', 'update-negative', 'vendor-boot-capability', 'signature-negative'],
    I4: ['verity-root', 'ab-fallback', 'update-negative', 'vendor-boot-capability', 'signature-negative'],
  }
  requireValue(typeof e.bootAssurance === 'string' && Object.hasOwn(levels, e.bootAssurance), 'evidence assurance')
  requireValue(Array.isArray(e.evidenceRefs) && e.evidenceRefs.length > 0, 'evidence references')
  const classes = new Set<string>()
  for (const value of e.evidenceRefs) {
    const ref = object(value, ['class', 'ref'])
    requireValue(typeof ref.class === 'string' && levels.I4!.includes(ref.class)
      && typeof ref.ref === 'string' && ref.ref.trim(), 'evidence reference')
    classes.add(ref.class)
  }
  requireValue(levels[e.bootAssurance]!.every(c => classes.has(c)), 'evidence below claimed assurance')
  const boundary = object(e.physicalBoundaries, ['jtag', 'serialConsole', 'recoveryPath'])
  requireValue(Object.values(boundary).every(v => typeof v === 'string' && v.trim()), 'evidence physical boundaries')
  return e.bootAssurance
}
function packages(text: string) {
  const seen = new Set<string>()
  const rows = text.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
    const fields = line.split('\t')
    requireValue(fields.length === 3 && fields.every(f => f && !/[\x00-\x20]/.test(f)), 'package inventory row')
    const [name, version, architecture] = fields as [string, string, string]
    const identity = `${name}:${architecture}`
    requireValue(!seen.has(identity), 'duplicate package'); seen.add(identity)
    return { name, version, architecture }
  })
  requireValue(rows.some(r => r.name.startsWith('mos')), 'empty MOS package inventory')
  return rows.sort((a, b) => `${a.name}:${a.architecture}`.localeCompare(`${b.name}:${b.architecture}`))
}
function derived(dir: string, m: Omit<ReleaseManifest, 'artifacts'>) {
  const rows = packages(read(join(dir, 'package-manifest.tsv')))
  const images: unknown = JSON.parse(read(join(dir, 'builder-images.json')))
  requireValue(images !== null && typeof images === 'object' && !Array.isArray(images)
    && Object.keys(images).length > 0 && Object.entries(images).every(([k, v]) => /^(IMAGE|LOCAL)_[A-Z0-9_]+$/.test(k) && typeof v === 'string' && v), 'builder image records')
  return {
    'sbom.cdx.json': { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
      metadata: { component: { type: 'operating-system', name: `mos-${m.board}`, version: m.version },
        properties: [{ name: 'mos:source-commit', value: m.source.commit }, { name: 'mos:source-dirty', value: String(m.source.dirty) }, { name: 'mos:source-offer', value: OFFER }] },
      components: rows.map(r => ({ type: 'library', name: r.name, version: r.version, properties: [{ name: 'mos:architecture', value: r.architecture }] })) },
    'licenses.json': { schemaVersion: 1, statement: OFFER, source: m.source, packages: rows },
    'provenance.json': { schema: 'mos/provenance/v1', source: m.source, board: m.board, version: m.version, profile: m.profile, builderImages: images,
      inputs: ['image.img', 'update.mosupd', 'firmware.json', 'firmware.bin', 'package-manifest.tsv', 'baked-meta.json', 'development-marker.txt', 'board-evidence.json', 'builder-images.json', 'release-notes.md'].map(filename => measure(dir, filename)) },
  }
}
/** Authenticate every MOSUPD01 object using bounded reads, without unpacking it. */
export function verifyArchive(path: string, keys: readonly string[]) {
  regular(path)
  const fd = openSync(path, 'r')
  const exact = (length: number) => {
    const bytes = Buffer.alloc(length)
    let offset = 0
    while (offset < length) { const n = readSync(fd, bytes, offset, length - offset, null); requireValue(n > 0, 'truncated update archive'); offset += n }
    return bytes
  }
  try {
    requireValue(exact(8).toString() === 'MOSUPD01', 'update archive format')
    const size = exact(4).readUInt32BE(); requireValue(size > 0 && size <= 16384, 'update envelope length')
    const deployment = authenticateDeployment(exact(size).toString('utf8'), keys)
    const objects = new Map<string, number>()
    for (const a of [deployment.kernel.boot.artifact, deployment.kernel.support.image, deployment.kernel.support.signature, deployment.rootfs.content.image, deployment.rootfs.content.signature]) {
      requireValue(!objects.has(a.sha256) || objects.get(a.sha256) === a.bytes, 'conflicting object lengths')
      objects.set(a.sha256, a.bytes)
    }
    requireValue(exact(4).readUInt32BE() === objects.size, 'update object count')
    for (const [sha, bytes] of [...objects].sort(([a], [b]) => a.localeCompare(b))) {
      requireValue(exact(64).toString() === sha && exact(8).readBigUInt64BE() === BigInt(bytes), 'update object header')
      const hash = createHash('sha256')
      for (let remaining = bytes; remaining > 0;) { const count = Math.min(65536, remaining); hash.update(exact(count)); remaining -= count }
      requireValue(hash.digest('hex') === sha, 'update object digest')
    }
    requireValue(readSync(fd, Buffer.alloc(1)) === 0, 'trailing update archive bytes')
    return deployment
  } finally { closeSync(fd) }
}
export function gateRelease(dir: string, keys: readonly string[]) {
  const m = manifest(JSON.parse(read(join(dir, 'manifest.json'))))
  requireValue(readdirSync(dir).sort().join() === ['manifest.json', ...Object.keys(FILES)].sort().join(), 'release file set differs')
  for (const a of m.artifacts) {
    const measured = measure(dir, a.filename)
    requireValue(measured.bytes === a.bytes && measured.sha256 === a.sha256, `artifact digest or length: ${a.filename}`)
  }
  requireValue(read(join(dir, 'SHA256SUMS')) === sums(m.artifacts), 'checksum list differs')
  requireValue(read(join(dir, 'release-notes.md')).trim(), 'empty release notes')
  const meta = JSON.parse(read(join(dir, 'baked-meta.json'))) as Record<string, unknown>
  requireValue(meta.schema === 'mos/meta/v1' && !Object.hasOwn(meta, 'trust'), 'current baked defaults required')
  const developmentDomains = domains(read(join(dir, 'development-marker.txt')))
  requireValue(canonicalJson(developmentDomains) === canonicalJson(m.developmentDomains), 'development marker differs')
  requireValue(m.channel === 'development' || developmentDomains.length === 0, 'development keys cannot use customer channels')
  requireValue(evidence(JSON.parse(read(join(dir, 'board-evidence.json'))), m.board) === m.bootAssurance, 'evidence assurance differs')
  const deployment = verifyArchive(join(dir, 'update.mosupd'), keys)
  requireValue(deployment.board === m.board && deployment.version === m.version, 'update board or version differs')
  const firmware = authenticateFirmware(read(join(dir, 'firmware.json'), 16384), keys)
  requireValue(firmware.board === m.board, 'firmware board differs')
  requireValue(regular(join(dir, 'firmware.bin')).size === firmware.artifact.bytes
    && fileSha256(join(dir, 'firmware.bin')) === firmware.artifact.sha256, 'firmware digest or length')
  for (const [name, expected] of Object.entries(derived(dir, m))) {
    requireValue(canonicalJson(JSON.parse(read(join(dir, name)))) === canonicalJson(expected), `derived record differs: ${name}`)
  }
  return { manifest: m, deploymentId: componentId(deployment), firmwareId: firmware.id, artifactsChecked: m.artifacts.length }
}
export function assembleRelease(inputs: ReleaseInputs) {
  requireValue(!existsSync(inputs.out), 'output exists')
  requireValue(read(inputs.notes).trim(), 'empty release notes')
  packages(read(inputs.packages))
  const hasMarker = lstatSync(join(inputs.meta, 'GENERATED'), { throwIfNoEntry: false }) !== undefined
  const marker = hasMarker ? read(join(inputs.meta, 'GENERATED')) : ''
  requireValue(!hasMarker || marker.length > 0, 'empty development marker')
  const developmentDomains = domains(marker)
  requireValue(inputs.channel === 'development' || developmentDomains.length === 0, 'development keys cannot use customer channels')
  const bootAssurance = evidence(JSON.parse(read(inputs.evidence)), inputs.board)
  const deployment = verifyArchive(inputs.update, inputs.keys)
  requireValue(deployment.board === inputs.board && deployment.version === inputs.version, 'update board or version differs')
  const m: ReleaseManifest = { schema: 'mos/release/v1', board: inputs.board, version: inputs.version, channel: inputs.channel,
    profile: inputs.profile, source: inputs.source, bootAssurance, developmentDomains, artifacts: [] }
  const files = { 'image.img': inputs.image, 'update.mosupd': inputs.update, 'firmware.json': join(inputs.firmware, 'firmware.json'),
    'firmware.bin': join(inputs.firmware, inputs.board === 'cx3576' ? 'u-boot-rockchip.bin' : inputs.board === 'x64' ? 'BOOTX64.EFI' : 'BOOTAA64.EFI'), 'package-manifest.tsv': inputs.packages,
    'baked-meta.json': join(inputs.meta, 'updates/manifest.json'), 'board-evidence.json': inputs.evidence, 'release-notes.md': inputs.notes }
  for (const path of Object.values(files)) regular(path)
  mkdirSync(inputs.out)
  for (const [name, path] of Object.entries(files)) copyFileSync(path, join(inputs.out, name))
  writeFileSync(join(inputs.out, 'development-marker.txt'), developmentDomains.length ? `DEVELOPMENT-GRADE\nDOMAINS=${developmentDomains.join(' ')}\n` : '')
  json(inputs.out, 'builder-images.json', inputs.builderImages)
  for (const [name, value] of Object.entries(derived(inputs.out, m))) json(inputs.out, name, value)
  m.artifacts = Object.keys(FILES).filter(name => name !== 'SHA256SUMS').map(name => measure(inputs.out, name))
  writeFileSync(join(inputs.out, 'SHA256SUMS'), sums(m.artifacts))
  m.artifacts.push(measure(inputs.out, 'SHA256SUMS'))
  json(inputs.out, 'manifest.json', m)
  return gateRelease(inputs.out, inputs.keys)
}
