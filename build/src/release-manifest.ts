// The release identity: one manifest.json binding a version, a channel, a
// board and every artifact a customer downloads, plus the publication gate
// that refuses a release directory the manifest does not fully describe.
//
// PLAN-043's release unit is the signed whole-system image/bundle set -- no
// on-device package manager -- so what a customer verifies is files: the
// flashable image, the RAUC bundle, and the records generated beside them
// (SBOM, provenance, license/source-offer inventory, release notes). The
// manifest binds each by role, byte size and sha256; SHA256SUMS repeats the
// digests in the one format `sha256sum -c` reads, and manifest.json then pins
// SHA256SUMS itself, so the two cannot drift without the gate noticing.
//
// Digests and versions are MEASURED, never invented: sizes and sha256 come off
// the files as staged, the package list comes out of the image's own
// /usr/share/mos/manifest.tsv (the only record of what an image is made of --
// the finalizer purges dpkg's database), the source identity comes from git,
// and the boot-assurance level comes from a board-evidence file this module
// only checks the shape of. A sibling effort populates real evidence; the
// seam here is checkBoardEvidence and nothing more.
//
// The refusal order in the gate is stable so the first actionable problem is
// deterministic, the same rule buildBundle states for itself.

import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { checkVersion } from './bundle-cli.ts'

/** The manifest schema this tree writes, and the FLOOR the validator holds. */
export const RELEASE_SCHEMA_VERSION = 1

/** The channels a release may be published to. A misspelt one is refused. */
export const RELEASE_CHANNELS = ['development', 'candidate', 'stable'] as const
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]

/** Every role an artifact may carry. */
export const ARTIFACT_ROLES = [
  'image', 'bundle', 'checksums', 'sbom', 'provenance', 'licenses', 'release-notes',
] as const
export type ArtifactRole = (typeof ARTIFACT_ROLES)[number]

/**
 * The roles a publishable release must carry at least one artifact of --
 * today, all of them. A written list rather than an alias of ARTIFACT_ROLES,
 * because the two answer different questions: adding an OPTIONAL role to the
 * schema must not silently make every existing release unpublishable.
 */
export const REQUIRED_ROLES: readonly ArtifactRole[] = [
  'image', 'bundle', 'checksums', 'sbom', 'provenance', 'licenses', 'release-notes',
]

/**
 * The written source offer, carried verbatim in the SBOM and the license
 * inventory. It cites the recorded source commit rather than a URL, because
 * the commit is the one identity this tooling can measure; where the request
 * is addressed is product documentation, not build output.
 */
export const SOURCE_OFFER =
  'Source code for the packages in this inventory, including any modifications, is available '
  + 'on request from the distributor of this image; cite the source commit recorded beside '
  + 'this statement.'

export interface ReleaseArtifact {
  readonly filename: string
  readonly role: ArtifactRole
  readonly bytes: number
  readonly sha256: string
}

export interface ReleaseManifest {
  readonly schemaVersion: number
  readonly release: { readonly version: string, readonly channel: ReleaseChannel }
  readonly board: { readonly name: string, readonly profile: string }
  readonly source: { readonly commit: string, readonly dirty: boolean }
  /** build-env/images.env's pins, transcribed. Empty when none were readable. */
  readonly build: { readonly builderImages: Readonly<Record<string, string>> }
  /** The boot-assurance level the board evidence asserts, e.g. "I1". */
  readonly bootAssurance: string
  readonly artifacts: readonly ReleaseArtifact[]
}

export interface BoardEvidence {
  readonly board: string
  readonly bootAssurance: string
  readonly qualification: string
}

/** sha256 of a file's bytes, hex. The caller has already named the file. */
export function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// The schema validator. Field by field, each refusal carrying its own
// sentence, because the gate's whole product is the sentence.

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function requireString(v: unknown, what: string, path: string): string {
  if (typeof v !== 'string' || v === '') {
    throw new Error(`${path} carries no ${what} (found ${JSON.stringify(v)})`)
  }
  return v
}

/**
 * A filename that is a filename: same character class as a version string,
 * because both are concatenated into paths and command lines. In particular
 * no `/` and no leading `.` -- an artifact entry must not be able to point
 * the gate, or a customer's `sha256sum -c`, outside the release directory.
 */
export function checkArtifactFilename(filename: string, path: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(filename)) {
    throw new Error(`${path} lists artifact filename ${JSON.stringify(filename)}, which is not a plain filename`)
  }
  if (filename === 'manifest.json') {
    throw new Error(`${path} lists manifest.json as its own artifact; the manifest cannot pin itself`)
  }
  return filename
}

/**
 * The manifest, checked shape-first so every later reader holds a typed value.
 *
 * schemaVersion is an EQUALITY against the floor, not a `>=`: a manifest
 * written by a NEWER schema may bind fields this validator has never heard
 * of, and accepting it would verify less than the writer claimed.
 */
export function checkReleaseManifest(value: unknown, path: string): ReleaseManifest {
  if (!isRecord(value)) {
    throw new Error(`${path} is not a JSON object`)
  }
  if (value.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    throw new Error(
      `${path} carries schemaVersion ${JSON.stringify(value.schemaVersion)} and this validator `
      + `holds the floor at ${RELEASE_SCHEMA_VERSION}; an unknown schema would verify less than `
      + `the writer claimed`,
    )
  }
  const release = isRecord(value.release) ? value.release : {}
  const version = checkVersion(typeof release.version === 'string' ? release.version : '')
  const channel = release.channel
  if (typeof channel !== 'string' || !(RELEASE_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(
      `release.channel ${JSON.stringify(channel)} in ${path} is not one of `
      + `${RELEASE_CHANNELS.join('/')}`,
    )
  }
  const board = isRecord(value.board) ? value.board : {}
  const boardName = requireString(board.name, 'board.name', path)
  const profile = requireString(board.profile, 'board.profile', path)
  const source = isRecord(value.source) ? value.source : {}
  const commit = typeof source.commit === 'string' ? source.commit : ''
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      `source.commit ${JSON.stringify(source.commit)} in ${path} is not a full 40-hex git commit; `
      + `an abbreviated or absent commit is an identity a support case cannot resolve years later`,
    )
  }
  if (typeof source.dirty !== 'boolean') {
    throw new Error(`source.dirty in ${path} is ${JSON.stringify(source.dirty)}, not a boolean`)
  }
  const build = isRecord(value.build) ? value.build : {}
  const builderImagesRaw = build.builderImages
  if (!isRecord(builderImagesRaw)) {
    throw new Error(`build.builderImages in ${path} is not an object`)
  }
  const builderImages: Record<string, string> = {}
  for (const [k, v] of Object.entries(builderImagesRaw)) {
    if (typeof v !== 'string') {
      throw new Error(`build.builderImages.${k} in ${path} is ${JSON.stringify(v)}, not a string`)
    }
    builderImages[k] = v
  }
  const bootAssurance = value.bootAssurance
  if (typeof bootAssurance !== 'string' || bootAssurance === '') {
    throw new Error(
      `${path} carries no bootAssurance level; it is populated from the board-evidence file `
      + `(checkBoardEvidence), and a release with none is a release nobody has qualified`,
    )
  }

  const artifactsRaw = value.artifacts
  if (!Array.isArray(artifactsRaw) || artifactsRaw.length === 0) {
    throw new Error(`${path} lists no artifacts; a release of nothing is not a release`)
  }
  const artifacts: ReleaseArtifact[] = []
  const seen = new Set<string>()
  for (const a of artifactsRaw) {
    if (!isRecord(a)) throw new Error(`${path} carries an artifact entry that is not an object`)
    const filename = checkArtifactFilename(requireString(a.filename, 'artifact filename', path), path)
    const role = a.role
    if (typeof role !== 'string' || !(ARTIFACT_ROLES as readonly string[]).includes(role)) {
      throw new Error(
        `artifact ${filename} in ${path} carries role ${JSON.stringify(role)}, not one of `
        + `${ARTIFACT_ROLES.join('/')}`,
      )
    }
    const bytes = a.bytes
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) {
      throw new Error(`artifact ${filename} in ${path} records bytes ${JSON.stringify(bytes)}, not a non-negative integer`)
    }
    const sha256 = a.sha256
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`artifact ${filename} in ${path} records sha256 ${JSON.stringify(sha256)}, not 64 hex digits`)
    }
    if (seen.has(filename)) {
      throw new Error(`${path} lists ${filename} twice; two entries under one name is not a pin`)
    }
    seen.add(filename)
    artifacts.push({ filename, role: role as ArtifactRole, bytes, sha256 })
  }
  const missing = REQUIRED_ROLES.filter(r => !artifacts.some(a => a.role === r))
  if (missing.length > 0) {
    throw new Error(
      `${path} carries no artifact with role ${missing.join(', ')}; the publication floor is one `
      + `of each of ${REQUIRED_ROLES.join(', ')}, and an incomplete release is not published`,
    )
  }
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    release: { version, channel: channel as ReleaseChannel },
    board: { name: boardName, profile },
    source: { commit, dirty: source.dirty },
    build: { builderImages },
    bootAssurance,
    artifacts,
  }
}

/**
 * The board-evidence file: the seam, checked for presence and shape only.
 *
 * What a level like "I1" MEANS, and what proof backs it, is the evidence
 * producer's contract -- deliberately not restated here, so that when real
 * evidence lands this reader does not have a second, staler copy of its
 * semantics. What IS held: the file names the board it is about (evidence for
 * the wrong board is the mix-up this field exists to catch), asserts one
 * boot-assurance level, and states a qualification.
 */
export function checkBoardEvidence(value: unknown, path: string, board: string): BoardEvidence {
  if (!isRecord(value)) {
    throw new Error(`${path} is not a JSON object`)
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`${path} carries evidence schemaVersion ${JSON.stringify(value.schemaVersion)}; this reader holds 1`)
  }
  const evBoard = requireString(value.board, 'evidence board name', path)
  if (evBoard !== board) {
    throw new Error(
      `${path} is evidence for board '${evBoard}' and this release is for '${board}'; `
      + `evidence is per board and the wrong board's proves nothing here`,
    )
  }
  const bootAssurance = requireString(value.bootAssurance, 'bootAssurance level', path)
  const qualification = requireString(value.qualification, 'qualification statement', path)
  return { board: evBoard, bootAssurance, qualification }
}

// The SBOM inputs: /usr/share/mos/manifest.tsv, the image's own bill of
// materials, in the shape rootfs/compose/90-pack.Dockerfile writes and
// verify's packed-mos-manifest check holds.

export interface PackageRow {
  readonly name: string
  readonly version: string
  readonly architecture: string
}

/**
 * The manifest.tsv rows, refused three ways before an SBOM is derived from
 * them -- the same three facts packed-mos-manifest asserts about the shipped
 * file, because an SBOM derived from a file that would fail that check is an
 * SBOM about a broken image: every row is package<TAB>version<TAB>arch, the
 * file names packages at all, and it names mos packages at all.
 */
export function packageRows(tsvText: string, path: string): PackageRow[] {
  const rows = tsvText.split('\n').filter(l => l !== '' && !l.startsWith('#'))
  const malformed = rows.filter(l => l.split('\t').length !== 3)
  if (malformed.length > 0) {
    throw new Error(
      `${path} carries ${malformed.length} of ${rows.length} row(s) that are not `
      + `package<TAB>version<TAB>architecture, the first being ${JSON.stringify(malformed[0])}`,
    )
  }
  if (rows.length === 0) {
    throw new Error(`${path} lists no packages; an SBOM derived from it would be empty and say nothing`)
  }
  const parsed = rows.map((l) => {
    const [name, version, architecture] = l.split('\t') as [string, string, string]
    return { name, version, architecture }
  })
  if (!parsed.some(r => r.name.startsWith('mos'))) {
    throw new Error(
      `${path} names no mos package, so the image it describes installed none of this `
      + `repository's packages; an SBOM over it would describe a base system, not a release`,
    )
  }
  return parsed
}

export interface SbomIdentity {
  readonly board: string
  readonly version: string
  readonly commit: string
  readonly dirty: boolean
}

/**
 * A CycloneDX 1.5 document over the rows. CycloneDX rather than SPDX for one
 * reason a release cares about: it requires no creation timestamp, so the
 * document is a pure function of its inputs and two builds of one image emit
 * identical bytes. The source offer rides in metadata rather than per
 * component, because it is one statement about the whole inventory.
 */
export function sbomFromRows(rows: readonly PackageRow[], identity: SbomIdentity): object {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'operating-system',
        name: `mos-${identity.board}`,
        version: identity.version,
      },
      properties: [
        { name: 'mos:source-commit', value: identity.commit },
        { name: 'mos:source-dirty', value: String(identity.dirty) },
        { name: 'mos:source-offer', value: SOURCE_OFFER },
      ],
    },
    components: rows.map(r => ({
      type: 'library',
      name: r.name,
      version: r.version,
      properties: [{ name: 'mos:architecture', value: r.architecture }],
    })),
  }
}

/**
 * The license/source-offer inventory: the offer statement, the identity it is
 * redeemable against, and the package list it covers. The list repeats the
 * SBOM's on purpose -- this file is the one a compliance request is answered
 * from, and an answer that says "see the other file" is not an inventory.
 */
export function licensesFromRows(rows: readonly PackageRow[], source: { commit: string, dirty: boolean }): object {
  return {
    schemaVersion: 1,
    statement: SOURCE_OFFER,
    source,
    packages: rows.map(r => ({ name: r.name, version: r.version, architecture: r.architecture })),
  }
}

/**
 * build-env/images.env's IMAGE_/LOCAL_ assignments, transcribed verbatim.
 *
 * A TRANSCRIPTION, not a resolution: build-env/from.sh stays the tree's one
 * resolver and validator of these pins (src/images.ts says why a second one
 * is a defect), and nothing here checks that a value is a digest or that a
 * registry has it. What a release manifest needs is the record of which pins
 * the tree carried when the release was cut, byte for byte as written.
 */
export function builderImagesFrom(imagesEnvText: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of imagesEnvText.split('\n')) {
    const m = /^((?:IMAGE|LOCAL)_[A-Z0-9_]+)=(.*)$/.exec(line)
    if (m !== null) out[m[1] as string] = m[2] as string
  }
  return out
}

/**
 * SHA256SUMS, in the two-space form `sha256sum -c` reads, over every artifact
 * except the checksums file itself -- a file cannot pin its own digest, which
 * is why manifest.json pins SHA256SUMS instead. Handing this function a
 * checksums-role artifact is that contradiction, so it is refused rather
 * than quietly skipped: the caller's list is wrong, not long.
 */
export function sha256SumsText(artifacts: readonly ReleaseArtifact[]): string {
  const self = artifacts.find(a => a.role === 'checksums')
  if (self !== undefined) {
    throw new Error(
      `sha256SumsText was handed ${self.filename} (role checksums); the checksums file cannot `
      + `list its own digest, and silently dropping it here would hide a wrong caller`,
    )
  }
  return artifacts.map(a => `${a.sha256}  ${a.filename}\n`).join('')
}

// The publication gate.

export interface GateReport {
  readonly manifest: ReleaseManifest
  readonly evidence: BoardEvidence
  readonly artifactsChecked: number
  readonly bytesTotal: number
}

/**
 * The gate: a release directory re-checked from scratch, refusing the first
 * gap by name. Nothing is trusted from the assembly that wrote it -- the
 * manifest is re-validated, every artifact is re-measured and re-hashed,
 * SHA256SUMS is re-derived and compared, and the board evidence is re-read --
 * so the same command answers "may this be published?" whether the directory
 * was written a minute ago or restored from an archive.
 */
export function gateReleaseDir(dir: string, evidencePath: string): GateReport {
  const manifestPath = join(dir, 'manifest.json')
  const st = statSync(manifestPath, { throwIfNoEntry: false })
  if (st === undefined || !st.isFile()) {
    throw new Error(`${manifestPath} does not exist; without the manifest there is no release to gate, only files`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    throw new Error(`${manifestPath} is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const manifest = checkReleaseManifest(parsed, manifestPath)

  let bytesTotal = 0
  for (const a of manifest.artifacts) {
    const p = join(dir, a.filename)
    const ast = statSync(p, { throwIfNoEntry: false })
    if (ast === undefined || !ast.isFile()) {
      throw new Error(
        `${a.filename} (role ${a.role}) is listed in manifest.json and missing from ${dir}; `
        + `an incomplete release is not published`,
      )
    }
    if (ast.size !== a.bytes) {
      throw new Error(
        `${a.filename} is ${ast.size} bytes and manifest.json records ${a.bytes}; `
        + `the artifact changed after it was manifested`,
      )
    }
    const got = fileSha256(p)
    if (got !== a.sha256) {
      throw new Error(
        `${a.filename} hashes to sha256 ${got} and manifest.json records ${a.sha256}; `
        + `a byte of this release changed after it was manifested`,
      )
    }
    bytesTotal += a.bytes
  }

  // The role floor guarantees exactly one pass through each of these finds
  // its artifact; `find` is over the validated list, so a miss is impossible
  // here and needs no second sentence.
  const sums = manifest.artifacts.find(a => a.role === 'checksums') as ReleaseArtifact
  const wantSums = sha256SumsText(manifest.artifacts.filter(a => a.role !== 'checksums'))
  const gotSums = readFileSync(join(dir, sums.filename), 'utf8')
  if (gotSums !== wantSums) {
    throw new Error(
      `${sums.filename} does not agree with manifest.json about the artifact digests; the two `
      + `are written from one measurement, so a divergence means the generator that wrote this `
      + `directory is broken, not that a byte rotted`,
    )
  }

  const notes = manifest.artifacts.find(a => a.role === 'release-notes') as ReleaseArtifact
  if (statSync(join(dir, notes.filename)).size === 0) {
    throw new Error(`the release notes ${notes.filename} in ${dir} are empty; a release nobody described is not published`)
  }

  const sbomEntry = manifest.artifacts.find(a => a.role === 'sbom') as ReleaseArtifact
  let sbom: unknown
  try {
    sbom = JSON.parse(readFileSync(join(dir, sbomEntry.filename), 'utf8'))
  } catch (e) {
    throw new Error(`${sbomEntry.filename} is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const components = isRecord(sbom) && Array.isArray(sbom.components) ? sbom.components : []
  if (!isRecord(sbom) || sbom.bomFormat !== 'CycloneDX' || components.length === 0) {
    throw new Error(
      `${sbomEntry.filename} is not a CycloneDX SBOM listing at least one component; an empty `
      + `SBOM verifies nothing and would pass every later audit by saying nothing`,
    )
  }

  const est = statSync(evidencePath, { throwIfNoEntry: false })
  if (est === undefined || !est.isFile()) {
    throw new Error(
      `no board evidence at ${evidencePath}; the publication gate refuses a release no evidence `
      + `qualifies. The evidence file asserts the board's boot-assurance level and qualification `
      + `state (see docs/design/release-artifacts.md)`,
    )
  }
  let evidenceRaw: unknown
  try {
    evidenceRaw = JSON.parse(readFileSync(evidencePath, 'utf8'))
  } catch (e) {
    throw new Error(`${evidencePath} is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const evidence = checkBoardEvidence(evidenceRaw, evidencePath, manifest.board.name)
  if (evidence.bootAssurance !== manifest.bootAssurance) {
    throw new Error(
      `${evidencePath} asserts boot-assurance '${evidence.bootAssurance}' and manifest.json `
      + `records '${manifest.bootAssurance}'; the manifest is populated FROM the evidence, so a `
      + `divergence means the evidence changed after the release was assembled -- re-assemble`,
    )
  }

  return { manifest, evidence, artifactsChecked: manifest.artifacts.length, bytesTotal }
}

// Assembly.

export interface AssembleInputs {
  readonly board: string
  readonly profile: string
  readonly channel: string
  readonly version: string
  readonly imagePath: string
  readonly bundlePath: string
  /** The image's /usr/share/mos/manifest.tsv content, as a file. */
  readonly packageManifestPath: string
  readonly notesPath: string
  readonly evidencePath: string
  readonly outDir: string
  readonly commit: string
  readonly dirty: boolean
  readonly builderImages: Readonly<Record<string, string>>
}

export interface AssembleResult {
  readonly outDir: string
  readonly manifestPath: string
  readonly gate: GateReport
}

/** A staged artifact entry: the file measured where it will be published. */
function measure(dir: string, filename: string, role: ArtifactRole): ReleaseArtifact {
  return { filename, role, bytes: statSync(join(dir, filename)).size, sha256: fileSha256(join(dir, filename)) }
}

function requireInputFile(path: string, what: string, hint: string): string {
  const st = statSync(path, { throwIfNoEntry: false })
  if (st === undefined || !st.isFile()) {
    throw new Error(`${path} not found; ${what}. ${hint}`)
  }
  return path
}

/**
 * Assemble a release directory: copy the built artifacts in, derive the
 * records beside them, write SHA256SUMS and manifest.json -- and then run the
 * publication gate over the result, because the one way to prove the
 * directory this wrote is publishable is to ask the same question a fresh
 * gate run asks. Every size and digest is measured off the STAGED copy, so
 * what the manifest pins is what a customer downloads, not what the build
 * tree held a moment earlier.
 *
 * The image and bundle paths may be the -latest symlinks; the published
 * filename is the real name they resolve to, because "latest" is a fact
 * about a build tree and not an identity a support case can cite.
 */
export function assembleRelease(inputs: AssembleInputs): AssembleResult {
  const version = checkVersion(inputs.version)
  if (!(RELEASE_CHANNELS as readonly string[]).includes(inputs.channel)) {
    throw new Error(
      `release channel ${JSON.stringify(inputs.channel)} is not one of ${RELEASE_CHANNELS.join('/')}; `
      + `a channel is a promise about qualification, so a misspelt one is refused rather than invented`,
    )
  }
  if (!/^[0-9a-f]{40}$/.test(inputs.commit)) {
    throw new Error(`source commit ${JSON.stringify(inputs.commit)} is not a full 40-hex git commit`)
  }

  requireInputFile(inputs.imagePath, 'it is the flashable disk image this release publishes',
    `Build it with 'make os-image-${inputs.board}' (or the board's assembler mode of build/run.sh)`)
  requireInputFile(inputs.bundlePath, 'it is the signed RAUC update bundle this release publishes',
    `Build it with 'bash build/run.sh --bundle --board ${inputs.board}'`)
  requireInputFile(inputs.packageManifestPath,
    'it is the image\'s /usr/share/mos/manifest.tsv, the bill of materials the SBOM is derived from',
    'The image ships it at that path; extract it from the built rootfs (verify reads the same file)')
  requireInputFile(inputs.notesPath, 'a release without release notes is refused by the publication gate',
    'Write the notes and pass their path')
  if (statSync(inputs.notesPath).size === 0) {
    throw new Error(`the release notes at ${inputs.notesPath} are empty; a release nobody described is not published`)
  }
  requireInputFile(inputs.evidencePath, 'the publication gate refuses a release no board evidence qualifies',
    'See the board-evidence seam in docs/design/release-artifacts.md')
  const evidence = checkBoardEvidence(
    JSON.parse(readFileSync(inputs.evidencePath, 'utf8')),
    inputs.evidencePath,
    inputs.board,
  )

  const rows = packageRows(readFileSync(inputs.packageManifestPath, 'utf8'), inputs.packageManifestPath)

  const imageReal = realpathSync(inputs.imagePath)
  const bundleReal = realpathSync(inputs.bundlePath)
  const imageName = checkArtifactFilename(basename(imageReal), imageReal)
  const bundleName = checkArtifactFilename(basename(bundleReal), bundleReal)

  mkdirSync(inputs.outDir, { recursive: true })
  copyFileSync(imageReal, join(inputs.outDir, imageName))
  copyFileSync(bundleReal, join(inputs.outDir, bundleName))
  copyFileSync(inputs.notesPath, join(inputs.outDir, 'release-notes.md'))
  const source = { commit: inputs.commit, dirty: inputs.dirty }
  writeFileSync(join(inputs.outDir, 'sbom.cdx.json'), `${JSON.stringify(
    sbomFromRows(rows, { board: inputs.board, version, commit: inputs.commit, dirty: inputs.dirty }),
    null, 2,
  )}\n`)
  writeFileSync(join(inputs.outDir, 'licenses.json'), `${JSON.stringify(licensesFromRows(rows, source), null, 2)}\n`)
  writeFileSync(join(inputs.outDir, 'provenance.json'), `${JSON.stringify({
    schemaVersion: 1,
    source,
    builderImages: inputs.builderImages,
    // The inputs as consumed, hashed at their source paths: the record of
    // what the assembly was HANDED, where the manifest records what it WROTE.
    inputs: [
      { name: 'image', path: imageReal, sha256: fileSha256(imageReal) },
      { name: 'bundle', path: bundleReal, sha256: fileSha256(bundleReal) },
      { name: 'package-manifest', path: inputs.packageManifestPath, sha256: fileSha256(inputs.packageManifestPath) },
      { name: 'board-evidence', path: inputs.evidencePath, sha256: fileSha256(inputs.evidencePath) },
    ],
  }, null, 2)}\n`)

  const content: ReleaseArtifact[] = [
    measure(inputs.outDir, imageName, 'image'),
    measure(inputs.outDir, bundleName, 'bundle'),
    measure(inputs.outDir, 'sbom.cdx.json', 'sbom'),
    measure(inputs.outDir, 'provenance.json', 'provenance'),
    measure(inputs.outDir, 'licenses.json', 'licenses'),
    measure(inputs.outDir, 'release-notes.md', 'release-notes'),
  ]
  writeFileSync(join(inputs.outDir, 'SHA256SUMS'), sha256SumsText(content))
  const artifacts = [...content, measure(inputs.outDir, 'SHA256SUMS', 'checksums')]

  const manifest: ReleaseManifest = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    release: { version, channel: inputs.channel as ReleaseChannel },
    board: { name: inputs.board, profile: inputs.profile },
    source,
    build: { builderImages: inputs.builderImages },
    bootAssurance: evidence.bootAssurance,
    artifacts,
  }
  const manifestPath = join(inputs.outDir, 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const gate = gateReleaseDir(inputs.outDir, inputs.evidencePath)
  return { outDir: inputs.outDir, manifestPath, gate }
}
