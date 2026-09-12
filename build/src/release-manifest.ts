import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, writeFileSync } from 'node:fs'
import { basename, join, posix } from 'node:path'
import { authenticateDeployment, canonicalJson, componentId, type VerityImage } from './components.ts'
import { authenticateFirmware } from './firmware.ts'
import { isFactoryImageFilename } from './image-name.ts'

const FILES = {
  'update.mosupd': 'update', 'firmware.json': 'firmware-manifest',
  'firmware.bin': 'firmware', 'package-manifest.tsv': 'packages', 'baked-meta.json': 'meta',
  'development-marker.txt': 'development-marker', 'board-evidence.json': 'evidence',
  'rootfs-report.runtime.json': 'runtime-report', 'builder-images.json': 'build-inputs', 'sbom.cdx.json': 'sbom', 'licenses.json': 'licenses',
  'provenance.json': 'provenance', 'release-notes.md': 'notes', 'SHA256SUMS': 'checksums',
} as const
function releaseFiles(image: string): Record<string, string> {
  return { [image]: 'image', ...FILES }
}
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
  runtimeReport: string, notes: string, evidence: string, keys: string[],
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
function measure(dir: string, filename: string, role: string): Artifact {
  const path = join(dir, filename)
  return { filename, role, bytes: regular(path).size, sha256: fileSha256(path) }
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
  requireValue(Array.isArray(m.artifacts) && m.artifacts.length === Object.keys(FILES).length + 1, 'artifact count')
  const seen = new Set<string>()
  const roles = new Set<string>()
  for (const value of m.artifacts) {
    const a = object(value, ['filename', 'role', 'bytes', 'sha256'])
    requireValue(typeof a.filename === 'string' && typeof a.role === 'string'
      && (a.role === 'image' ? isFactoryImageFilename(a.filename, m.board as string)
        : Object.hasOwn(FILES, a.filename) && FILES[a.filename as keyof typeof FILES] === a.role)
      && !seen.has(a.filename) && !roles.has(a.role), 'artifact filename or role')
    seen.add(a.filename)
    roles.add(a.role)
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
type NativePackage = {
  package: string, version: string, architecture: string, archive_sha256: string,
  archive: string, source: { package: string, version: string },
}
const RUNTIME_RECORD_LIMIT = 128 * 1048576
function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'runtime object required')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  requireValue(Array.isArray(value), 'runtime array required')
  return value
}
function digest(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'runtime digest')
}
function natural(value: unknown): asserts value is number {
  requireValue(Number.isSafeInteger(value) && (value as number) >= 0, 'runtime non-negative integer')
}
function runtimePath(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && value.startsWith('/') && posix.normalize(value) === value
    && (value === '/' || !value.endsWith('/')) && !/[\x00-\x1f\x7f]/.test(value), 'runtime canonical path')
}
function same(actual: unknown, expected: unknown, label: string) {
  requireValue(canonicalJson(actual) === canonicalJson(expected), `runtime ${label} differs`)
}
function runtimeNode(value: unknown, extra: string[] = [], hardlinks = true) {
  const n = record(value)
  requireValue(['file', 'directory', 'symlink'].includes(n.type as string), 'runtime node type')
  object(n, ['type', 'mode', 'uid', 'gid', 'mtime_ns', 'xattrs', ...extra,
    ...(n.type === 'file' ? ['size', 'sha256', ...(hardlinks ? ['hardlink'] : [])] : []),
    ...(n.type === 'symlink' ? ['target'] : []), ...(Object.hasOwn(n, 'runtime_link') ? ['runtime_link'] : [])])
  for (const k of ['mode', 'uid', 'gid']) natural(n[k])
  requireValue((n.mode as number) <= 0o7777, 'runtime mode')
  requireValue(typeof n.mtime_ns === 'string' && /^-?\d+$/.test(n.mtime_ns), 'runtime nanosecond timestamp')
  for (const [name, v] of Object.entries(record(n.xattrs))) requireValue(name && typeof v === 'string' && /^(?:[a-f0-9]{2})*$/.test(v), 'runtime xattr')
  if (n.type === 'file') { natural(n.size); digest(n.sha256); if (hardlinks) runtimePath(n.hardlink) }
  if (n.type === 'symlink') requireValue(typeof n.target === 'string' && n.target && !/[\x00-\x1f\x7f]/.test(n.target), 'runtime symlink target')
  if (Object.hasOwn(n, 'runtime_link')) {
    const link = object(n.runtime_link, ['path', 'target', 'generator', 'ordering', 'test', 'requires'])
    requireValue(n.type === 'symlink' && n.target === link.target && n.path === link.path, 'runtime link contract')
    for (const k of ['generator', 'ordering', 'test']) requireValue(typeof link[k] === 'string' && link[k], 'runtime link producer')
    for (const path of array(link.requires)) runtimePath(path)
  }
  return n
}
function runtimePackage(value: unknown, arch: string): NativePackage {
  const p = object(value, ['package', 'version', 'architecture', 'archive_sha256', 'archive', 'source'])
  requireValue(typeof p.package === 'string' && /^[a-z0-9][a-z0-9+.-]*$/.test(p.package)
    && typeof p.version === 'string' && p.version && !/[\x00-\x20]/.test(p.version)
    && [arch, 'all'].includes(p.architecture as string), 'runtime native package identity')
  digest(p.archive_sha256)
  requireValue(typeof p.archive === 'string' && p.archive && !/[\x00-\x20]/.test(p.archive), 'runtime archive reference')
  const source = object(p.source, ['package', 'version'])
  requireValue(Object.values(source).every(v => typeof v === 'string' && v && !/[\x00-\x20]/.test(v)), 'runtime source identity')
  return p as NativePackage
}
function readRuntime(path: string): Record<string, unknown> {
  requireValue(typeof path === 'string' && path, 'runtime report is required')
  requireValue(regular(path).size <= RUNTIME_RECORD_LIMIT, 'runtime report exceeds bounded record')
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path))
  // Preserve nanoseconds exactly; copying the original report preserves its raw
  // bytes. JSON numbers otherwise round configured timestamps in JavaScript.
  const value: unknown = JSON.parse(text, (key, v: unknown, context?: { source: string }) => {
    if (key !== 'mtime_ns') return v
    requireValue(typeof v === 'number' && context && /^-?\d+$/.test(context.source), 'runtime timestamp encoding')
    return context.source
  })
  const stack: { keys: Set<string> | null, next: boolean }[] = []
  for (const token of text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g) ?? []) {
    const parent = stack.at(-1)
    if (token === '{' || token === '[') stack.push({ keys: token === '{' ? new Set() : null, next: true })
    else if (token === '}' || token === ']') stack.pop()
    else if (token === ',' && parent) parent.next = true
    else if (token.startsWith('"') && parent?.keys && parent.next) {
      const key = JSON.parse(token) as string
      requireValue(!parent.keys.has(key), 'runtime duplicate JSON key')
      parent.keys.add(key); parent.next = false
    }
  }
  return object(value, ['architecture', 'consumers', 'inputs', 'files', 'external_inputs', 'provenance', 'measurements'])
}
const JOIN_ORIGINAL = { commit: 'e176876b733d675d1e20b40b42628cd4e18b197d', tree: '7e8e8bc62b52f3d78263d717e186a07f0d3430a1', epoch: 1789097968, version: '0.1.0+gite176876b733d-1' }
const JOIN_REBUILT = { commit: 'fb6c4597bb902f69d528bcdc3c8372f310c322b1', tree: 'cbf2fa8ff2c8fc03534b218c952a511b6a6ba392', epoch: 1789157855, version: '0.1.0+gitfb6c4597bb90-1' }
const JOIN_LEGACY_COMPOSITION = { commit: 'fdf8a480057b64073c9b9e15e399fca1b38d607d', tree: '7eed91c48aa9a00fc75d8661260aac78a004c00e', epoch: 1789162665 }
const JOIN_RECEIPTS = { original: 'fc79903fcd6dc8bf40191c5f4cdf4979d664dfd0315a53521d57af821f80d166', native: '175f2dbe31b08bde91f8cf5a15680c9ec7fb38d6c2e0bda46edff5f24e558d09', deploy: '267dff5433d4bc2b2a409a06e3019fd0f680f449c4866d60f8b3353b237a4683' }
const JOIN_NATIVE = { 'mos-init': { bytes: 1673848, sha256: '738391aa650a58fb3819f52831f6affd57ddd17e357c2a161faaf39d800ec642' }, 'mos-shutdown': { bytes: 2047144, sha256: 'd2c5c9a6e2473c0125670031c79014c6ee946b834e2e26f32a65f38939e68b35' } }
const STARTUP_SOURCE = '438c9551ec751fcb346881541752a7596f10cb15'
const STARTUP_NATIVE = {
  'mos-init': { bytes: 2403504, sha256: '57c865ed0b58740faaba642cc417a0b0a3a487f3b6718a1e2fcc7e1355bdea97' },
  'mos-shutdown': { bytes: 2047144, sha256: '77bf04b463ece3b0aaba03fa0f91fe0939faa87c5b9b81937b24636b3e2ef1ea' },
}
const JOIN_CONSUMERS = new Set(['rootfs/runtime/consumers.json', 'rootfs/runtime/source-lineage.py', 'rootfs/build.sh', 'build/src/release-manifest.ts', 'tests/deb-package-gate.sh', 'tests/rootfs-runtime/source_lineage_test.py', 'tests/rootfs-runtime/composition_test.py', 'build/src/release-manifest.test.ts', 'docs/task/20260911-0145-b7-fresh-lifecycle-acceptance.md', 'docs/plan/20260911-0145-b7-fresh-lifecycle-acceptance.md'])
const canonicalSha = (value: unknown) => createHash('sha256').update(canonicalJson(value) + '\n').digest('hex')
// The fixed proof retains all 15 complete maps, including unqualified ARM maps.
// Its hash is independent of the later deploy and boot-tools output witnesses.
export function validateStartupInputContract(value: unknown, selectedPackages: string[]) {
  const proof = object(value, ['schema', 'original_source', 'rebuilt_source', 'selected_packages', 'producers', 'makefile_read_contract'])
  same(canonicalSha(proof), '93902df4c3351b3d3e2c3ca3977f6b4bbd07fb2361c2f0aedc1f0c1c3d1b87ba', 'startup reviewed complete input contract')
  same([...selectedPackages].sort(), proof.selected_packages, 'startup selected x64 package membership')
  return proof
}

const STARTUP_REBUILT = { commit: STARTUP_SOURCE, tree: '775874cfdce2ef40b7f51ae3090c6c6706a5deae', epoch: 1789167215, version: '0.1.0+git438c9551ec75-1' }
const STARTUP_RECEIPTS = { original: JOIN_RECEIPTS.original, native: 'e66650563f340e0ce8f722a7812f36bba8012ee98e3e220aa2bbea5d1864afc0', deploy: '224cac3207ca49a128e6881552cdd20d8b4972d22c579f3ee41bc5c4524845b0', boot_tools: '76b65b10a72537194d08f6b18dd997067a8d06920ede0e48607fe1c35387a47d' }
const STARTUP_TRACKING = new Set(['docs/task/20260911-1925-boot-artifact-size.md', 'docs/plan/20260911-1927-boot-artifact-size.md'])
const STARTUP_UNSELECTED_PACKAGES = new Set(['mos-board-cx3576', 'mos-bm201-front-panel', 'mos-board-s905x5m', 'mos-s905x5m-wifi', 'mos-s905x5m-wireless', 'mos-s905x5m-bluetooth', 'mos-board-virt-arm64'])
function startupProducerJoin(value: unknown, pool: Record<string, unknown>, source: unknown, arch: string) {
  const j = object(value, ['schema', 'rebuilt_source', 'approved_delta', 'producer_inputs', 'original_pool', 'witnesses', 'mapping', 'native', 'production'])
  requireValue(j.schema === 'mos/producer-join/startup-v1' && arch === 'amd64', 'startup join schema/architecture')
  same(source, JOIN_ORIGINAL, 'startup original source'); same(j.rebuilt_source, STARTUP_REBUILT, 'startup rebuilt source')
  same(j.witnesses, STARTUP_RECEIPTS, 'startup producer witnesses'); same(j.native, STARTUP_NATIVE, 'startup native outputs')
  same(canonicalSha(j.production), '1d0a377f86fe3045de74c0bf327e2a61f63d7295330c1169c58e01651d14587e', 'startup producer recipe/tool/flags/outputs')
  same(canonicalSha(j.approved_delta), '3ae7dd3f732d6c9a8dc3ca8f7abb73cac3bd20f677e3480af3c1ad0919c629d7', 'startup approved delta legs')
  same(canonicalSha(j.original_pool), 'de26c7fd9d4e5b76ae10aa166659e2d047ede56088a79fd46024fb419a5b4087', 'startup original pool')
  same(canonicalSha(pool), 'ad3b92fa4cc51026e4f78e423a5d75865c1e6a6b83944875742df7db261ab9a3', 'startup joined pool/index/control')
  const packages = array(pool.packages).map(p => record(p).package as string)
  validateStartupInputContract(j.producer_inputs, packages)
  same(j.mapping, Object.fromEntries(packages.map(n => [n, n === 'mos-deploy' ? STARTUP_SOURCE : JOIN_ORIGINAL.commit])), 'startup source attribution')
  return record(record(j.production).boot_tools).image as string
}

const GPT_SOURCE = 'd2e352d0a4226f10b8b2587cd7c1bc5040b8d234'
const GPT_REBUILT = { commit: GPT_SOURCE, tree: '190ffef0ba12ad24625456f508c5179e517ffc74', epoch: 1789196122, version: '0.1.0+gitd2e352d0a422-1' }
const GPT_NATIVE = {
  'mos-init': { bytes: 2403504, sha256: '9d1b164b3af709cc382e6bdbc29e222225ac76e0f8c6e9d4a948f425d7548682' },
  'mos-shutdown': { bytes: 2043048, sha256: '28ccd8655a02d54b4229f9674e297fa7925881cf89450febe436704bfdab3f0d' },
}
const GPT_RECEIPTS = { original: STARTUP_RECEIPTS.original, boot_tools: STARTUP_RECEIPTS.boot_tools,
  native: '65a4dae876b4e4c58bc4c029679998081b5d543b80668e2129a861f4a1f9370f', deploy: 'aaa082345b66961bab3b327314841226f31e19157ffde626198084759ae60d88' }
function gptProducerJoin(value: unknown, pool: Record<string, unknown>, source: unknown, arch: string) {
  const j = object(value, ['schema', 'rebuilt_source', 'approved_delta', 'producer_inputs', 'original_pool', 'witnesses', 'mapping', 'native', 'production'])
  requireValue(j.schema === 'mos/producer-join/gpt-v1' && arch === 'amd64', 'GPT join schema/architecture')
  same(source, JOIN_ORIGINAL, 'GPT original source'); same(j.rebuilt_source, GPT_REBUILT, 'GPT rebuilt source')
  same(j.witnesses, GPT_RECEIPTS, 'GPT producer witnesses'); same(j.native, GPT_NATIVE, 'GPT native outputs')
  same(canonicalSha(j.production), 'c1cf815d29028f92abed870925b0d2f1368d240164e67fe012b8c7b10b10b9f7', 'GPT production source/tool/flags/output roles')
  same(canonicalSha(j.approved_delta), 'bc669939c224d936e72bda629e8e2828f18e95f44002bbb0da7bfc7950086bbd', 'GPT reviewed source delta legs')
  same(canonicalSha(j.producer_inputs), '3a76ae8130a1107da3eaf36a950b3589352d2ec970d9b9ae3ff88adaeb0a7c65', 'GPT complete producer/PREPARE inputs')
  same(canonicalSha(j.original_pool), 'de26c7fd9d4e5b76ae10aa166659e2d047ede56088a79fd46024fb419a5b4087', 'GPT original pool')
  same(canonicalSha(pool), '565c0f0bf614299ad6d3a49a6d6127e2f6fc70f240a8361318a7b46b4b15c62c', 'GPT joined pool/index/control')
  const packages = array(pool.packages).map(p => record(p).package as string)
  same(j.mapping, Object.fromEntries(packages.map(n => [n, n === 'mos-deploy' ? GPT_SOURCE : JOIN_ORIGINAL.commit])), 'GPT package source attribution')
  return record(record(j.production).boot_tools).image as string
}

const BOOT_RECEIPT_SHA = 'af5bc012346a99d360612a1340df58de35265b9a7cc638d2286401b2a3ab7112'
const BOOT_ROLE_SHA = 'a893b517c2a249afed8d34d323e6f5148aa55ec353c9956f5e422766d516b664'
function bootToolsRole(value: unknown) {
  const role = object(value, ['schema', 'source', 'approved_delta', 'inputs', 'unchanged_producers_sha256', 'source_readiness_sha256', 'receipt_sha256', 'production'])
  same(canonicalSha(role), BOOT_ROLE_SHA, 'boot-tools reviewed producer/source/input/output witness')
  const production = record(role.production), payload = record(production.payload)
  const busybox = record(payload['usr/lib/mos/boot-busybox/x64/busybox'])
  return { manifest: production.manifest as string, busybox: { bytes: busybox.bytes as number, sha256: busybox.sha256 as string } }
}
function joinedBootTool(value: unknown) {
  const lineage = record(value)
  if (lineage.schema !== 'mos/source-lineage/join-v1') return null
  const join = record(lineage.producer_join)
  return join.schema === 'mos/producer-join/boot-tools-v1' ? bootToolsRole(join.boot_tools) : null
}
function producerJoin(value: unknown, packages: Record<string, unknown>[], source: unknown, arch: string) {
  const boot = record(value).schema === 'mos/producer-join/boot-tools-v1'
  const j = object(value, ['schema', 'rebuilt_source', 'approved_delta', 'producer_inputs', 'original_pool', 'witnesses', 'mapping', 'native', 'production', ...(boot ? ['boot_tools'] : [])])
  if (boot) bootToolsRole(j.boot_tools)
  requireValue(['mos/producer-join/v1', 'mos/producer-join/boot-tools-v1'].includes(j.schema as string) && arch === 'amd64', 'producer join schema/architecture')
  same(source, JOIN_ORIGINAL, 'producer join original source'); same(j.rebuilt_source, JOIN_REBUILT, 'producer join rebuilt source')
  same(canonicalSha(j.production), '3f1fe46df0aa7d686616288b655119baeccba12589951e121321388aa45f3f58', 'producer join tool/recipe/target/flags')
  same(j.witnesses, JOIN_RECEIPTS, 'producer join witnesses'); same(j.native, JOIN_NATIVE, 'producer join native')
  same(canonicalSha(j.approved_delta), '25a8aa2051a6c6cc968554828a50a875781f9d5076f48127e2d295ab2110cbf1', 'producer join approved delta')
  same(canonicalSha(j.producer_inputs), '3fa9b2060d685c5e4f0beeed48ef4045621ccf1fb94344f800aab0e2ea4cae3e', 'producer join PREPARE/input attribution')
  same(canonicalSha(j.original_pool), 'de26c7fd9d4e5b76ae10aa166659e2d047ede56088a79fd46024fb419a5b4087', 'producer join original pool')
  const original = object(j.original_pool, ['files', 'packages'])
  const old = new Map(array(original.packages).map(value => { const row = record(value); return [row.package, row] }))
  same(packages.map(p => p.package).sort(), [...old.keys()].sort(), 'producer join package membership')
  const mapping = Object.fromEntries(packages.map(p => [p.package as string, p.package === 'mos-deploy' ? JOIN_REBUILT.commit : JOIN_ORIGINAL.commit]))
  same(j.mapping, mapping, 'producer join unique source mapping')
  for (const p of packages) {
    if (p.package !== 'mos-deploy') same(p, old.get(p.package), 'producer join reused archive/control bytes')
    else same(p, { package: 'mos-deploy', architecture: 'amd64', version: JOIN_REBUILT.version,
      archive: 'pool/mos-deploy_' + JOIN_REBUILT.version + '_amd64.deb',
      sha256: '5c86a35df5ce3a495fdd8390f40a6e3d099fac4f10346e53783481ccda281168',
      control_sha256: '43440d0b43a9e2ab31b1a9940dc072d5f83cc088bd5e0675089e61dd141f84b2' }, 'producer join deploy archive/control bytes')
  }
}

export function sourceLineage(value: unknown, source: Source, arch: string, capture: Record<string, unknown>) {
  const joined = record(value).schema === 'mos/source-lineage/join-v1'
  const startup = joined && record(record(value).producer_join).schema === 'mos/producer-join/startup-v1'
  const gpt = joined && record(record(value).producer_join).schema === 'mos/producer-join/gpt-v1'
  const rebuilt = gpt ? GPT_REBUILT : startup ? STARTUP_REBUILT : JOIN_REBUILT
  const consumers = new Set([...JOIN_CONSUMERS, ...(startup || gpt ? STARTUP_TRACKING : [])])
  let bootToolsImage: string | undefined
  const l = object(value, ['schema', 'package_source', 'composition_source', 'architecture', 'root_epoch', 'pool', 'receipt_sha256', 'delta', ...(joined ? ['producer_join'] : [])])
  requireValue(['mos/source-lineage/v1', 'mos/source-lineage/join-v1'].includes(l.schema as string) && l.architecture === arch, 'runtime lineage schema/architecture')
  const p = object(l.package_source, ['commit', 'tree', 'epoch', 'version'])
  const c = object(l.composition_source, ['commit', 'tree', 'epoch'])
  for (const identity of [p, c]) {
    for (const key of ['commit', 'tree']) requireValue(typeof identity[key] === 'string' && /^[a-f0-9]{40}$/.test(identity[key] as string), 'runtime lineage Git identity')
    natural(identity.epoch); requireValue((identity.epoch as number) <= 0xffffffff, 'runtime lineage source epoch')
  }
  natural(l.root_epoch); requireValue((l.root_epoch as number) <= 0xffffffff, 'runtime lineage root epoch')
  requireValue(c.commit === source.commit && !source.dirty, 'runtime lineage composition source')
  requireValue(typeof p.version === 'string' && new RegExp('^[0-9][A-Za-z0-9.~-]*\\+git' + (p.commit as string).slice(0, 12) + '-[1-9][0-9]*$').test(p.version), 'runtime lineage package version/source')
  requireValue(Array.isArray(l.receipt_sha256) && new Set(l.receipt_sha256).size === l.receipt_sha256.length, 'runtime lineage receipt set')
  for (const sha of l.receipt_sha256) digest(sha)
  requireValue(p.commit === c.commit || l.receipt_sha256.length > 0, 'runtime lineage missing frozen receipt')
  const allowed = new Set([
    'rootfs/build.sh', 'rootfs/runtime/source-lineage.py', 'rootfs/runtime/compose.py', 'rootfs/compose/90-pack.Dockerfile',
    'rootfs/compose/compose-capture.sh', 'rootfs/compose/compose-install.sh',
    'build/src/release-manifest.ts', 'build/src/release-manifest.test.ts',
    'tests/rootfs-runtime/source_lineage_test.py', 'tests/rootfs-runtime/composition_test.py',
    'tests/deb-package-gate.sh',
    'rootfs/runtime/select.py', 'tests/rootfs-runtime/selection_test.py',
    'rootfs/runtime/consumers.json',
    'rootfs/debian/packages/dmsetup.json', 'rootfs/debian/packages/libdevmapper1.02.1.json',
    'docs/task/20260911-0145-b7-fresh-lifecycle-acceptance.md', 'docs/plan/20260911-0145-b7-fresh-lifecycle-acceptance.md',
  ])
  requireValue(Array.isArray(l.delta), 'runtime lineage delta')
  const paths: string[] = []
  for (const value of l.delta) {
    const row = object(value, ['path', 'before', 'after'])
    requireValue(typeof row.path === 'string' && (startup || gpt ? consumers : allowed).has(row.path), 'runtime lineage package-relevant delta')
    paths.push(row.path)
    for (const value of [row.before, row.after]) if (value !== null) {
      const entry = object(value, ['mode', 'blob'])
      requireValue(['100644', '100755', '120000'].includes(entry.mode as string)
        && typeof entry.blob === 'string' && /^[a-f0-9]{40}$/.test(entry.blob), 'runtime lineage delta identity')
    }
    requireValue(row.after !== null, 'runtime lineage deleted consumer')
    const after = row.after as Record<string, unknown>, before = row.before as Record<string, unknown> | null
    requireValue(['100644', '100755'].includes(after.mode as string) && (before === null || before.mode === after.mode), 'runtime lineage consumer type/mode')
    requireValue(canonicalJson(row.before) !== canonicalJson(row.after), 'runtime lineage empty delta')
  }
  same(paths, [...new Set(paths)].sort(), 'runtime lineage delta order/set')
  if (p.commit === c.commit) requireValue(p.tree === c.tree && p.epoch === c.epoch && paths.length === 0, 'runtime lineage same-source mismatch')
  const pool = object(l.pool, ['files', 'packages']), files = record(pool.files)
  for (const [name, sha] of Object.entries(files)) {
    requireValue(['Packages', 'SHA256SUMS', 'manifest.txt'].includes(name) || /^pool\/[^/]+\.deb$/.test(name), 'runtime lineage pool path')
    digest(sha)
  }
  const expected = new Set(['Packages', 'SHA256SUMS', 'manifest.txt']), names = new Set<string>()
  requireValue(Array.isArray(pool.packages) && pool.packages.length > 0, 'runtime lineage empty pool')
  const packages = pool.packages.map(value => {
    const row = object(value, ['package', 'version', 'architecture', 'archive', 'sha256', 'control_sha256'])
    requireValue(typeof row.package === 'string' && /^[a-z0-9][a-z0-9+.-]+$/.test(row.package) && !names.has(row.package), 'runtime lineage package name/set')
    names.add(row.package)
    requireValue([arch, 'all'].includes(row.architecture as string) && typeof row.version === 'string'
      && row.version.split('+').at(-1) === (joined && row.package === 'mos-deploy' ? rebuilt.version : p.version as string).split('+').at(-1), 'runtime lineage package stamp/architecture')
    requireValue(typeof row.archive === 'string' && /^pool\/[^/]+\.deb$/.test(row.archive) && !expected.has(row.archive), 'runtime lineage archive')
    expected.add(row.archive); digest(row.sha256); digest(row.control_sha256)
    same(files[row.archive], row.sha256, 'runtime lineage archive digest')
    return row
  })
  same(Object.keys(files).sort(), [...expected].sort(), 'runtime lineage pool membership')
  if (joined) {
    const boot = record(l.producer_join).schema === 'mos/producer-join/boot-tools-v1'
    if (!boot && !startup && !gpt) same(c, JOIN_LEGACY_COMPOSITION, 'boot-tools witness omitted or downgraded')
    same(l.receipt_sha256, [...Object.values(gpt ? GPT_RECEIPTS : startup ? STARTUP_RECEIPTS : JOIN_RECEIPTS), ...(boot ? [BOOT_RECEIPT_SHA] : [])].sort(), 'producer join receipt set')
    requireValue(l.root_epoch === 1577836800 && paths.every(p => consumers.has(p)), 'producer join consumer delta/epoch')
    if (gpt) bootToolsImage = gptProducerJoin(l.producer_join, pool, p, arch)
    else if (startup) bootToolsImage = startupProducerJoin(l.producer_join, pool, p, arch)
    else producerJoin(l.producer_join, packages, p, arch)
  }
  for (const name of ['Packages', 'SHA256SUMS', 'manifest.txt']) same(capture[name], files[name], 'runtime lineage pool capture')
  same(capture['source-lineage.json'], createHash('sha256').update(canonicalJson(value) + '\n').digest('hex'), 'runtime lineage capture bytes')
  return { record: value, packages, rootEpoch: l.root_epoch as number, bootToolsImage }
}
function shippedRuntime(path: string, inventory: string, arch: string, root: VerityImage, meta: string, marker: string, source: Source) {
  const report = readRuntime(path)
  requireValue(report.architecture === arch, 'runtime architecture differs')
  const p = object(report.provenance, ['build_packages', 'shipped_packages', 'files', 'configured_sha256', 'capture_sha256', 'source_lineage'])
  const buildPackages = array(p.build_packages).map(v => runtimePackage(v, arch))
  const byPackage = new Map(buildPackages.map(v => [v.package, v]))
  requireValue(byPackage.size === buildPackages.length && byPackage.size > 0, 'runtime duplicate or empty build packages')
  const consumers = array(report.consumers)
  requireValue(consumers.length > 0 && new Set(consumers).size === consumers.length
    && consumers.every(c => typeof c === 'string' && byPackage.has(c)), 'runtime selected consumers')
  const selected = object(report.inputs, ['inventory_sha256', 'selection_sha256', 'rules_sha256', 'ownership_sha256'])
  const capture = record(p.capture_sha256)
  for (const [name, sha] of Object.entries(capture)) {
    requireValue(name && !name.startsWith('/') && posix.normalize(name) === name
      && !name.split('/').some(part => part === '.' || part === '..' || !part) && !/[\x00-\x1f\x7f]/.test(name), 'runtime capture path')
    digest(sha)
  }
  digest(p.configured_sha256)
  same(capture['configured.json'], p.configured_sha256, 'configured capture')
  for (const [name, field] of [['manifest.tsv', 'inventory_sha256'], ['selected.pkgs', 'selection_sha256'], ['runtime-rules.json', 'rules_sha256']] as const) {
    digest(selected[field]); same(capture[name], selected[field], `${name} capture`)
  }
  for (const name of ['sources.tsv', 'upstream.tsv', 'Packages']) digest(capture[name])
  const lineage = sourceLineage(p.source_lineage, source, arch, capture)
  if (lineage.bootToolsImage) requireValue(buildPackages.every(p => !STARTUP_UNSELECTED_PACKAGES.has(p.package)), 'startup unqualified ARM package installed')
  for (const row of buildPackages) {
    const match = lineage.packages.find(p => p.package === row.package)
    if (match || row.archive.startsWith('pool/')) {
      requireValue(match, 'runtime lineage missing installed package')
      for (const key of ['version', 'architecture', 'archive'] as const) same(row[key], match[key], 'runtime lineage installed package')
      same(row.archive_sha256, match.sha256, 'runtime lineage installed archive')
      if (record(lineage.record).schema === 'mos/source-lineage/join-v1') same(row.source, { package: match.package, version: match.version }, 'producer join installed control source')
    }
  }
  requireValue((report.consumers as string[]).every(name => lineage.packages.some(p => p.package === name)), 'runtime lineage selected package missing')
  const ownership = record(selected.ownership_sha256)
  for (const [name, sha] of Object.entries(ownership)) { digest(sha); same(capture[`info/${name}`], sha, 'native ownership capture') }
  for (const name of byPackage.keys()) requireValue(Object.keys(ownership).filter(f => f === `${name}.list` || f === `${name}:${arch}.list` || f === `${name}:all.list`).length === 1, 'runtime unique native ownership')
  const files = new Map<string, Record<string, unknown>>()
  const origins = new Set<string>()
  const provenance = record(p.files)
  for (const value of array(report.files)) {
    const n = runtimeNode(value, ['path', 'origins', 'reasons'])
    runtimePath(n.path); requireValue(!files.has(n.path), 'runtime duplicate file path')
    files.set(n.path, n)
    requireValue(array(n.reasons).length > 0 && array(n.reasons).every(r => typeof r === 'string' && r), 'runtime file selection reason')
    const owners: NativePackage[] = [], generators: string[] = []
    for (const value of array(n.origins)) {
      const origin = record(value)
      if (Object.hasOwn(origin, 'generated')) {
        object(origin, ['generated']); requireValue(typeof origin.generated === 'string' && origin.generated, 'runtime generated origin')
        generators.push(origin.generated)
      } else {
        object(origin, ['package', 'version', 'architecture'])
        const owner = byPackage.get(origin.package as string)
        requireValue(owner, 'runtime unknown file owner')
        same(origin, { package: owner.package, version: owner.version, architecture: owner.architecture }, 'file owner')
        owners.push(owner); if (n.type !== 'directory') origins.add(owner.package)
      }
    }
    requireValue(owners.length + generators.length > 0 && (n.type === 'directory' || owners.length <= 1)
      && new Set(owners).size === owners.length && new Set(generators).size === generators.length, 'runtime ambiguous or missing file origin')
    const f = record(provenance[n.path])
    object(f, ['configured', 'final', 'archives', 'generators', ...(Object.hasOwn(f, 'debug') ? ['debug'] : [])])
    const { origins: _origins, reasons: _reasons, ...final } = n
    same(f.final, final, 'final file metadata')
    same(f.archives, owners, 'file archive/source provenance'); same(f.generators, generators, 'generated provenance')
    if (f.configured !== null) runtimeNode(f.configured)
    else requireValue(generators.length > 0, 'runtime uncaptured file has no producer')
    if (Object.hasOwn(f, 'debug')) {
      const debug = runtimeNode(f.debug, ['build_id', 'path', 'bytes_before'], false)
      requireValue(n.type === 'file' && debug.type === 'file' && typeof debug.build_id === 'string'
        && /^[a-f0-9]{3,}$/.test(debug.build_id) && debug.path === `.build-id/${debug.build_id.slice(0, 2)}/${debug.build_id.slice(2)}.debug`, 'runtime debug counterpart mapping')
      natural(debug.bytes_before); requireValue(debug.bytes_before >= (n.size as number) && (debug.size as number) > 0, 'runtime debug counterpart sizes')
    }
  }
  same([...Object.keys(provenance)].sort(), [...files.keys()].sort(), 'per-file provenance set')
  requireValue(files.get('/')?.type === 'directory', 'runtime root directory')
  const groups = new Map<string, Record<string, unknown>>()
  for (const [path, n] of files) {
    requireValue(path === '/' || files.get(posix.dirname(path))?.type === 'directory', 'runtime parent directory')
    if (n.type === 'file') {
      const primary = files.get(n.hardlink as string)
      requireValue(primary?.type === 'file' && primary.hardlink === n.hardlink, 'runtime hardlink group')
      for (const field of ['sha256', 'size', 'mode', 'uid', 'gid', 'mtime_ns', 'xattrs']) same(n[field], primary[field], 'hardlink metadata')
      groups.set(n.hardlink as string, n)
    }
  }
  const shippedPackages = array(p.shipped_packages).map(v => runtimePackage(v, arch))
  same(shippedPackages.map(v => v.package).sort(), [...origins].sort(), 'shipped contributor set')
  for (const pkg of shippedPackages) same(pkg, byPackage.get(pkg.package), 'shipped archive/source identity')
  same(packages(inventory), shippedPackages.map(p => ({ name: p.package, version: p.version, architecture: p.architecture }))
    .sort((a, b) => `${a.name}:${a.architecture}`.localeCompare(`${b.name}:${b.architecture}`)), 'shipped inventory')
  const retainedFile = (path: string) => {
    for (let links = 0; links < 40; links++) {
      const parts = path.split('/').filter(Boolean)
      let prefix = '', changed = false
      for (let i = 0; i < parts.length; i++) {
        prefix += '/' + parts[i]
        const n = files.get(prefix)
        requireValue(n, `runtime missing resource: ${prefix}`)
        if (n.type === 'symlink') {
          path = posix.resolve(posix.dirname(prefix), n.target as string, ...parts.slice(i + 1)); changed = true; break
        }
      }
      if (!changed) { const n = files.get(path)!; requireValue(n.type === 'file', 'runtime resource is not a file'); return n }
    }
    throw new Error('Invalid release: runtime resource symlink cycle')
  }
  for (const [path, bytes] of [['/usr/share/mos/manifest.tsv', inventory], ['/usr/share/mos/meta/updates/manifest.json', meta]] as const) {
    const n = retainedFile(path)
    same(n.sha256, createHash('sha256').update(bytes).digest('hex'), path.includes('/meta/') ? 'public metadata' : 'inventory bytes')
  }
  const markerPath = '/usr/share/mos/meta/GENERATED'
  if (marker) same(retainedFile(markerPath).sha256, createHash('sha256').update(marker).digest('hex'), 'public metadata marker')
  else requireValue(!files.has(markerPath), 'runtime unexpected public metadata marker')
  const licenses = shippedPackages.map(p => {
    const resource = retainedFile(`/usr/share/doc/${p.package}/copyright`)
    requireValue((resource.size as number) > 0, 'runtime empty copyright resource')
    return { name: p.package, version: p.version, architecture: p.architecture, source: p.source,
      archiveSha256: p.archive_sha256, resources: [{ path: resource.path, sha256: resource.sha256 }] }
  })
  const measurements = object(report.measurements, ['apparent_file_bytes', 'unique_file_bytes', 'allocated_file_bytes',
    'unique_file_inodes', 'directories', 'symlinks', 'runtime_allocation', 'rss', 'fresh_image_comparison', 'squashfs', 'verity_image', 'boot_payload'])
  same([measurements.runtime_allocation, measurements.rss, measurements.fresh_image_comparison, measurements.boot_payload],
    ['pending B7 guest evidence', 'pending B7 guest evidence', 'pending B7 granted image builds',
      'independent signed kernel component; pending B7 matching artifact inputs'], 'measurement evidence')
  const values = [...files.values()]
  for (const [key, expected] of Object.entries({ apparent_file_bytes: values.reduce((sum, n) => sum + (n.type === 'file' ? n.size as number : 0), 0),
    unique_file_bytes: [...groups.values()].reduce((sum, n) => sum + (n.size as number), 0), unique_file_inodes: groups.size,
    directories: values.filter(n => n.type === 'directory').length, symlinks: values.filter(n => n.type === 'symlink').length })) same(measurements[key], expected, 'measurement')
  natural(measurements.allocated_file_bytes)
  const image = object(measurements.verity_image, ['bytes', 'sha256', 'geometry'])
  same({ bytes: image.bytes, sha256: image.sha256 }, root.image, 'signed root image')
  const sq = object(measurements.squashfs, ['bytes', 'sha256']); digest(sq.sha256)
  same(sq.bytes, root.verity.hashOffset, 'SquashFS extent')
  same(image.geometry, { VERITY_ROOT_HASH: root.rootHash, VERITY_SALT: root.verity.salt, VERITY_HASH_ALGO: root.verity.algorithm,
    VERITY_DATA_BLOCK_SIZE: String(root.verity.dataBlockSize), VERITY_HASH_BLOCK_SIZE: String(root.verity.hashBlockSize),
    VERITY_DATA_BLOCKS: String(root.verity.dataBlocks), VERITY_HASH_START_BLOCK: String(root.verity.hashOffset / root.verity.hashBlockSize),
    VERITY_DATA_SECTORS: String(root.verity.hashOffset / 512), SQUASHFS_BYTES: String(root.verity.hashOffset), IMAGE_BYTES: String(root.image.bytes) }, 'signed verity geometry')
  array(report.external_inputs)
  for (const row of files.values()) same(row.mtime_ns, String(BigInt(lineage.rootEpoch) * 1000000000n), 'runtime lineage root epoch')
  return { buildPackages, shippedPackages, sourceLineage: lineage.record, bootToolsImage: lineage.bootToolsImage, files: provenance, measurements, licenses }
}

function derived(dir: string, m: Omit<ReleaseManifest, 'artifacts'>, image: string, root: VerityImage) {
  const files = releaseFiles(image)
  const inventory = read(join(dir, 'package-manifest.tsv'))
  const rows = packages(inventory)
  const runtime = shippedRuntime(join(dir, 'rootfs-report.runtime.json'), inventory, m.board === 'x64' ? 'amd64' : 'arm64', root, read(join(dir, 'baked-meta.json')), read(join(dir, 'development-marker.txt')), m.source)
  const images: unknown = JSON.parse(read(join(dir, 'builder-images.json')))
  requireValue(images !== null && typeof images === 'object' && !Array.isArray(images)
    && Object.keys(images).length > 0 && Object.entries(images).every(([k, v]) => /^(IMAGE|LOCAL)_[A-Z0-9_]+$/.test(k) && typeof v === 'string' && v), 'builder image records')
  if (runtime.bootToolsImage) same(record(images).LOCAL_BOOT_TOOLS_X64, runtime.bootToolsImage, 'startup release boot-tools image')
  const bootTool = joinedBootTool(runtime.sourceLineage)
  if (bootTool) same(record(images).LOCAL_BOOT_TOOLS_X64, bootTool.manifest, 'joined release boot-tools image')
  return {
    'sbom.cdx.json': { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
      metadata: { component: { type: 'operating-system', name: `mos-${m.board}`, version: m.version },
        properties: [{ name: 'mos:source-commit', value: m.source.commit }, { name: 'mos:source-dirty', value: String(m.source.dirty) }, { name: 'mos:source-offer', value: OFFER }] },
      components: rows.map(r => ({ type: 'library', name: r.name, version: r.version, properties: [{ name: 'mos:architecture', value: r.architecture }, { name: 'mos:archive-sha256', value: runtime.shippedPackages.find(p => p.package === r.name)!.archive_sha256 }] })) },
    'licenses.json': { schemaVersion: 1, statement: OFFER, source: m.source, packages: runtime.licenses },
    'provenance.json': { schema: 'mos/provenance/v1', source: m.source, board: m.board, version: m.version, profile: m.profile, builderImages: images, runtime: { sourceLineage: runtime.sourceLineage, buildPackages: runtime.buildPackages, shippedPackages: runtime.shippedPackages, files: runtime.files, measurements: runtime.measurements },
      inputs: [image, 'update.mosupd', 'firmware.json', 'firmware.bin', 'package-manifest.tsv', 'rootfs-report.runtime.json', 'baked-meta.json', 'development-marker.txt', 'board-evidence.json', 'builder-images.json', 'release-notes.md'].map(filename => measure(dir, filename, files[filename]!)) },
  }
}
const INITRD_LIMIT = 64 * 1048576
/** Validate RFC 8878 framing before invoking the pinned Bun runtime's decoder. */
function decodeStartupFrame(packed: Buffer): Buffer {
  requireValue(packed.length >= 10 && packed.length <= INITRD_LIMIT && packed.readUInt32LE(0) === 0xfd2fb528, 'joined zstd frame')
  const descriptor = packed[4]!, single = (descriptor & 32) !== 0, sizeFlag = descriptor >>> 6
  // The file producer emits a content size, a checksum and no dictionary.
  requireValue((descriptor & 31) === 4 && (single || sizeFlag !== 0), 'joined zstd canonical descriptor')
  let at = 5, window = 0
  if (!single) {
    const w = packed[at++]!, base = 2 ** (10 + (w >>> 3))
    window = base + (base / 8) * (w & 7)
  }
  const sizeBytes = sizeFlag === 0 ? 1 : 2 ** sizeFlag
  requireValue(at + sizeBytes <= packed.length, 'joined zstd size bounds')
  const expanded = sizeBytes === 8 ? packed.readBigUInt64LE(at) : BigInt(packed.readUIntLE(at, sizeBytes) + (sizeBytes === 2 ? 256 : 0))
  requireValue(expanded > 0n && expanded <= BigInt(INITRD_LIMIT), 'joined zstd expanded bound')
  if (single) window = Number(expanded)
  requireValue(window > 0 && window <= INITRD_LIMIT, 'joined zstd window bound')
  at += sizeBytes
  let last = false, blocks = 0
  while (!last) {
    requireValue(++blocks <= 65536, 'joined zstd block count')
    requireValue(at + 3 <= packed.length, 'joined zstd truncated block')
    const header = packed.readUIntLE(at, 3), kind = (header >>> 1) & 3, size = header >>> 3
    last = (header & 1) !== 0
    requireValue(kind !== 3 && size <= Math.min(window, 128 * 1024), 'joined zstd block bound')
    at += 3 + (kind === 1 ? 1 : size)
    requireValue(at <= packed.length, 'joined zstd truncated payload')
  }
  requireValue(at + 4 === packed.length, 'joined zstd single frame/checksum extent')
  // Use this project's pinned Bun, including its zstd library, in a bounded
  // child. The decoder enforces output/window caps while decoding; the parent
  // independently caps its pipe and kills a stuck decoder after ten seconds.
  const result = spawnSync(process.execPath, ['--eval', `
    const {zstdDecompressSync, constants} = require('node:zlib');
    const {readFileSync, writeFileSync} = require('node:fs');
    writeFileSync(1, zstdDecompressSync(readFileSync(0), {
      maxOutputLength: ${INITRD_LIMIT},
      params: {[constants.ZSTD_d_windowLogMax]: 26}
    }));
  `], { input: packed, maxBuffer: INITRD_LIMIT, timeout: 10000, killSignal: 'SIGKILL' })
  requireValue(!result.error && result.status === 0 && result.signal === null && result.stdout.length === Number(expanded), 'joined zstd bounded decode/checksum')
  return result.stdout
}

function verifyStartupCpio(cpio: Buffer, expected: Record<string, { bytes: number, sha256: string }>) {
  const directories = new Set(['.', 'dev', 'etc', 'etc/mos', 'exitrd', 'newroot', 'proc', 'run', 'sbin', 'support', 'sys', 'system'])
  const native: Record<string, string> = { init: 'mos-init', 'exitrd/shutdown': 'mos-shutdown' }
  const text: Record<string, string> = { 'startup.files': 'init\n', 'exitrd.files': 'shutdown\n', 'sbin/mos-shutdown': '/exitrd/shutdown' }
  const allowed = new Set([...directories, ...Object.keys(native), ...Object.keys(text), 'etc/mos/boot.json'])
  const names = new Set<string>(), align = (n: number, size = 4) => Math.ceil(n / size) * size
  let at = 0, previous = ''
  for (let count = 0; count <= allowed.size; count++) {
    requireValue(at + 110 <= cpio.length && cpio.toString('ascii', at, at + 6) === '070701', 'joined startup cpio header')
    const field = (i: number) => {
      const text = cpio.toString('ascii', at + 6 + i * 8, at + 14 + i * 8)
      requireValue(/^[0-9a-fA-F]{8}$/.test(text), 'joined startup cpio field'); return Number.parseInt(text, 16)
    }
    const mode = field(1), uid = field(2), gid = field(3), links = field(4), mtime = field(5), size = field(6), nameSize = field(11)
    requireValue(nameSize >= 2 && nameSize <= 128 && at + 110 + nameSize <= cpio.length, 'joined startup cpio name bounds')
    const namedEnd = at + 110 + nameSize, rawName = cpio.subarray(at + 110, namedEnd)
    requireValue(rawName.at(-1) === 0 && !rawName.subarray(0, -1).includes(0), 'joined startup cpio name terminator')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName.subarray(0, -1))
    const data = align(namedEnd), end = data + size, next = align(end)
    requireValue(next <= cpio.length && cpio.subarray(namedEnd, data).every(b => b === 0)
      && cpio.subarray(end, next).every(b => b === 0), 'joined startup cpio padding/bounds')
    requireValue(uid === 0 && gid === 0 && [7, 8, 9, 10, 12].every(i => field(i) === 0), 'joined startup cpio owner/device/check')
    at = next
    if (name === 'TRAILER!!!') {
      requireValue(size === 0 && mode === 0 && links === 1 && mtime === 0 && cpio.length === align(at, 512)
        && cpio.subarray(at).every(b => b === 0), 'joined startup cpio trailer extent')
      requireValue(names.size === allowed.size, 'joined startup missing native/manifest/directory')
      return
    }
    requireValue(allowed.has(name) && !names.has(name) && name > previous, 'joined startup unexpected/duplicate/unsafe path')
    names.add(name); previous = name
    const directory = directories.has(name), symlink = name === 'sbin/mos-shutdown'
    const wantedMode = directory ? 0o40755 : symlink ? 0o120777 : Object.hasOwn(native, name) ? 0o100755 : 0o100644
    requireValue(mode === wantedMode && links === (directory ? 2 : 1) && mtime === 1577836800, 'joined startup cpio mode/link/time')
    const bytes = cpio.subarray(data, end)
    if (directory) requireValue(size === 0, 'joined startup directory data')
    else if (Object.hasOwn(native, name)) {
      const witness = expected[native[name]!]
      requireValue(witness && size === witness.bytes && createHash('sha256').update(bytes).digest('hex') === witness.sha256, 'joined authenticated native bytes/mode')
    } else if (Object.hasOwn(text, name)) requireValue(bytes.equals(Buffer.from(text[name]!)), 'joined startup manifest/observer target')
    else requireValue(size > 0 && size <= 4096, 'joined startup boot config size')
  }
  requireValue(false, 'joined startup missing trailer')
}

/** Bind the authenticated x64 UKI's actual native bytes to the joined witness. */
export function verifyJoinedNativePayload(boot: Buffer, expected: Record<string, { bytes: number, sha256: string }>, source = JOIN_REBUILT.commit, busybox?: { bytes: number, sha256: string }) {
  requireValue(source === JOIN_REBUILT.commit || source === STARTUP_SOURCE || source === GPT_SOURCE, 'joined native source role')
  const startup = source === STARTUP_SOURCE || source === GPT_SOURCE
  requireValue(!startup || !busybox, 'startup does not accept a legacy BusyBox witness')
  requireValue(boot.length >= 64 && boot.length <= 256 * 1048576 && boot.toString('ascii', 0, 2) === 'MZ', 'joined UKI header')
  const pe = boot.readUInt32LE(60)
  requireValue(pe >= 64 && pe + 24 <= boot.length && boot.toString('ascii', pe, pe + 4) === 'PE\0\0'
    && boot.readUInt16LE(pe + 4) === 0x8664, 'joined UKI architecture')
  const count = boot.readUInt16LE(pe + 6), optional = boot.readUInt16LE(pe + 20), start = pe + 24 + optional
  requireValue(count > 0 && count <= 96 && optional >= 2 && start + count * 40 <= boot.length
    && boot.readUInt16LE(pe + 24) === 0x20b, 'joined UKI sections')
  const initrds: Buffer[] = []
  const ranges: { offset: number, size: number, address: number, bytes: number }[] = []
  const alignment = optional >= 64 ? boot.readUInt32LE(pe + 24 + 36) : 0
  const imageSize = optional >= 64 ? boot.readUInt32LE(pe + 24 + 56) : 0
  if (startup) requireValue(alignment >= 512 && alignment <= 65536 && (alignment & (alignment - 1)) === 0, 'joined PE file alignment')
  for (let i = 0; i < count; i++) {
    const at = start + i * 40, name = boot.toString('ascii', at, at + 8).replace(/\0.*$/, '')
    const bytes = boot.readUInt32LE(at + 8), size = boot.readUInt32LE(at + 16), offset = boot.readUInt32LE(at + 20)
    if (startup && (size > 0 || bytes > 0)) {
      const address = boot.readUInt32LE(at + 12)
      const loaded = Math.max(bytes, size)
      requireValue((size === 0 || (offset >= start + count * 40 && offset % alignment === 0 && size % alignment === 0 && offset + size <= boot.length))
        && address + loaded <= imageSize, 'joined PE section bounds')
      requireValue(ranges.every(r => (size === 0 || r.size === 0 || offset + size <= r.offset || r.offset + r.size <= offset)
        && (address + loaded <= r.address || r.address + r.bytes <= address)), 'joined PE overlapping section')
      ranges.push({ offset, size, address, bytes: loaded })
    }
    if (name === '.initrd') {
      requireValue(bytes > 0 && size >= bytes && offset >= start + count * 40 && offset + size <= boot.length, 'joined initrd bounds')
      if (startup) requireValue(bytes <= INITRD_LIMIT && size === Math.ceil(bytes / alignment) * alignment
        && boot.subarray(offset + bytes, offset + size).every(b => b === 0), 'joined compressed initrd load/padding bound')
      initrds.push(boot.subarray(offset, offset + bytes))
    }
  }
  requireValue(initrds.length === 1, 'joined unique initrd')
  if (startup) return verifyStartupCpio(decodeStartupFrame(initrds[0]!), expected)
  const cpio = initrds[0]!, names = new Set<string>(), matched = new Set<string>()
  requireValue(cpio.length <= INITRD_LIMIT, 'joined raw initrd bound')
  const wanted: Record<string, string> = { init: 'mos-init', 'sbin/mos-shutdown': 'mos-shutdown', 'exitrd/shutdown': 'mos-shutdown' }
  if (busybox) wanted['bin/busybox'] = 'boot-busybox'
  let at = 0, trailer = false
  const align = (value: number) => Math.ceil(value / 4) * 4
  for (let count = 0; count < 10000 && at < cpio.length; count++) {
    requireValue(at + 110 <= cpio.length && cpio.toString('ascii', at, at + 6) === '070701', 'joined cpio header')
    const field = (index: number) => {
      const text = cpio.toString('ascii', at + 6 + index * 8, at + 14 + index * 8)
      requireValue(/^[0-9a-fA-F]{8}$/.test(text), 'joined cpio field'); return Number.parseInt(text, 16)
    }
    const mode = field(1), uid = field(2), gid = field(3), size = field(6), nameSize = field(11)
    requireValue(nameSize > 0 && nameSize <= 4096 && at + 110 + nameSize <= cpio.length, 'joined cpio name bounds')
    const rawName = cpio.subarray(at + 110, at + 110 + nameSize)
    requireValue(rawName.at(-1) === 0 && !rawName.subarray(0, -1).includes(0), 'joined cpio name terminator')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName.subarray(0, -1)).replace(/^\.\//, '')
    const data = align(at + 110 + nameSize), end = data + size
    requireValue(end <= cpio.length, 'joined cpio data bounds')
    at = align(end)
    if (name === 'TRAILER!!!') { requireValue(size === 0 && cpio.subarray(at).every(b => b === 0), 'joined cpio trailer'); trailer = true; break }
    requireValue(!/[\x00-\x1f\x7f]/.test(name) && (name === '.' || (!name.startsWith('/') && name.split('/').every(p => p && p !== '.' && p !== '..'))), 'joined cpio path')
    requireValue(!names.has(name), 'joined duplicate cpio path'); names.add(name)
    if (Object.hasOwn(wanted, name)) {
      const witness = wanted[name] === 'boot-busybox' ? busybox : expected[wanted[name]!]
      requireValue(witness && mode === 0o100755 && uid === 0 && gid === 0 && size === witness.bytes
        && createHash('sha256').update(cpio.subarray(data, end)).digest('hex') === witness.sha256, 'joined authenticated native bytes/mode')
      matched.add(name)
    }
  }
  requireValue(trailer && matched.size === Object.keys(wanted).length, 'joined missing native/tool payload')
}

/** Authenticate every MOSUPD01 object using bounded reads, without unpacking it. */
export function verifyArchive(path: string, keys: readonly string[], joinedNative: boolean | typeof STARTUP_SOURCE | typeof GPT_SOURCE = false, busybox?: { bytes: number, sha256: string }) {
  requireValue(joinedNative === false || joinedNative === true || joinedNative === STARTUP_SOURCE || joinedNative === GPT_SOURCE, 'joined native source role')
  requireValue(!busybox || joinedNative === true, 'boot-tools require legacy joined native provenance')
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
      const hash = createHash('sha256'), nativeBoot = joinedNative && sha === deployment.kernel.boot.artifact.sha256
      if (nativeBoot) requireValue(deployment.board === 'x64' && deployment.kernel.boot.format === 'uki' && bytes <= 256 * 1048576, 'joined kernel artifact')
      const chunks: Buffer[] = []
      for (let remaining = bytes; remaining > 0;) { const count = Math.min(65536, remaining), chunk = exact(count); hash.update(chunk); if (nativeBoot) chunks.push(chunk); remaining -= count }
      requireValue(hash.digest('hex') === sha, 'update object digest')
      if (nativeBoot) verifyJoinedNativePayload(Buffer.concat(chunks), joinedNative === GPT_SOURCE ? GPT_NATIVE : joinedNative === STARTUP_SOURCE ? STARTUP_NATIVE : JOIN_NATIVE,
        typeof joinedNative === 'string' ? joinedNative : JOIN_REBUILT.commit, busybox)
    }
    requireValue(readSync(fd, Buffer.alloc(1)) === 0, 'trailing update archive bytes')
    return deployment
  } finally { closeSync(fd) }
}
export function gateRelease(dir: string, keys: readonly string[]) {
  const m = manifest(JSON.parse(read(join(dir, 'manifest.json'))))
  const image = m.artifacts.find(a => a.role === 'image')!.filename
  requireValue(readdirSync(dir).sort().join() === ['manifest.json', ...Object.keys(releaseFiles(image))].sort().join(), 'release file set differs')
  for (const a of m.artifacts) {
    const measured = measure(dir, a.filename, a.role)
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
  const runtime = record(readRuntime(join(dir, 'rootfs-report.runtime.json')).provenance)
  const lineage = record(runtime.source_lineage)
  let joined: boolean | typeof STARTUP_SOURCE | typeof GPT_SOURCE = false
  if (lineage.schema === 'mos/source-lineage/join-v1') {
    sourceLineage(lineage, m.source, m.board === 'x64' ? 'amd64' : 'arm64', record(runtime.capture_sha256))
    const producer = record(record(lineage.producer_join).rebuilt_source).commit
    joined = producer === GPT_SOURCE ? GPT_SOURCE : producer === STARTUP_SOURCE ? STARTUP_SOURCE : true
  }
  const bootTool = joinedBootTool(lineage)
  const deployment = verifyArchive(join(dir, 'update.mosupd'), keys, joined, bootTool?.busybox)
  requireValue(deployment.board === m.board && deployment.version === m.version, 'update board or version differs')
  const firmware = authenticateFirmware(read(join(dir, 'firmware.json'), 16384), keys)
  requireValue(firmware.board === m.board, 'firmware board differs')
  requireValue(regular(join(dir, 'firmware.bin')).size === firmware.artifact.bytes
    && fileSha256(join(dir, 'firmware.bin')) === firmware.artifact.sha256, 'firmware digest or length')
  for (const [name, expected] of Object.entries(derived(dir, m, image, deployment.rootfs.content))) {
    requireValue(canonicalJson(JSON.parse(read(join(dir, name), name === 'provenance.json' ? RUNTIME_RECORD_LIMIT : undefined))) === canonicalJson(expected), `derived record differs: ${name}`)
  }
  return { manifest: m, deploymentId: componentId(deployment), firmwareId: firmware.id, artifactsChecked: m.artifacts.length }
}
export function assembleRelease(inputs: ReleaseInputs) {
  requireValue(!existsSync(inputs.out), 'output exists')
  const image = basename(inputs.image)
  requireValue(isFactoryImageFilename(image, inputs.board), 'factory image filename must contain the board and UTC build time')
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
  const runtime = shippedRuntime(inputs.runtimeReport, read(inputs.packages), inputs.board === 'x64' ? 'amd64' : 'arm64', deployment.rootfs.content, read(join(inputs.meta, 'updates/manifest.json')), marker, inputs.source)
  const m: ReleaseManifest = { schema: 'mos/release/v1', board: inputs.board, version: inputs.version, channel: inputs.channel,
    profile: inputs.profile, source: inputs.source, bootAssurance, developmentDomains, artifacts: [] }
  const files = { [image]: inputs.image, 'update.mosupd': inputs.update, 'firmware.json': join(inputs.firmware, 'firmware.json'),
    'firmware.bin': join(inputs.firmware, inputs.board === 'cx3576' ? 'u-boot-rockchip.bin' : inputs.board === 'x64' ? 'BOOTX64.EFI' : 'BOOTAA64.EFI'), 'package-manifest.tsv': inputs.packages,
    'rootfs-report.runtime.json': inputs.runtimeReport, 'baked-meta.json': join(inputs.meta, 'updates/manifest.json'), 'board-evidence.json': inputs.evidence, 'release-notes.md': inputs.notes }
  for (const path of Object.values(files)) regular(path)
  mkdirSync(inputs.out)
  for (const [name, path] of Object.entries(files)) copyFileSync(path, join(inputs.out, name))
  // Retain the installed marker bytes; domains() still enforces channel policy.
  writeFileSync(join(inputs.out, 'development-marker.txt'), marker)
  const bootImage = runtime.bootToolsImage ?? joinedBootTool(runtime.sourceLineage)?.manifest
  const builderImages = { ...inputs.builderImages }
  if (bootImage) {
    if (Object.hasOwn(builderImages, 'LOCAL_BOOT_TOOLS_X64')) same(builderImages.LOCAL_BOOT_TOOLS_X64, bootImage, 'joined caller boot-tools image')
    builderImages.LOCAL_BOOT_TOOLS_X64 = bootImage
  }
  json(inputs.out, 'builder-images.json', builderImages)
  for (const [name, value] of Object.entries(derived(inputs.out, m, image, deployment.rootfs.content))) json(inputs.out, name, value)
  m.artifacts = Object.entries(releaseFiles(image)).filter(([name]) => name !== 'SHA256SUMS').map(([name, role]) => measure(inputs.out, name, role))
  writeFileSync(join(inputs.out, 'SHA256SUMS'), sums(m.artifacts))
  m.artifacts.push(measure(inputs.out, 'SHA256SUMS', 'checksums'))
  json(inputs.out, 'manifest.json', m)
  return gateRelease(inputs.out, inputs.keys)
}
