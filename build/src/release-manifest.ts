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
// and the boot-assurance level comes from the committed per-board evidence
// file (boards/<board>/evidence.json). checkBoardEvidence holds that file's
// semantics -- the I1-I4 ladder's per-level evidence floor and the
// unsupported-claim wording refusal -- against the ladder defined in
// docs/design/security-model.md §5.
//
// The refusal order in the gate is stable so the first actionable problem is
// deterministic, the same rule buildBundle states for itself.

import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { checkVersion } from './bundle-cli.ts'

/**
 * The manifest schema this tree writes, and the FLOOR the validator holds.
 *
 * 2 is the schema that added the required `trust` block. It is a bump and not
 * an addition-in-place for the reason the neighbouring snapshot schema had to
 * relearn (RFCT-302): two shapes claiming one version is the one thing a
 * schema version exists to make impossible. A version-1 directory assembled
 * before that block existed is refused by the equality below, saying so --
 * rather than by a field check saying it "carries no trust block", which reads
 * like a corrupted manifest instead of an older one.
 */
export const RELEASE_SCHEMA_VERSION = 2

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

/**
 * The grade of the signing material an image was built from. Two values, and
 * the absence of a third is deliberate: "cannot tell" is a throw rather than a
 * grade, because a release nobody can grade is not a release
 * (`readBakedTrust`).
 */
export const TRUST_GRADES = ['development', 'production'] as const
export type TrustGrade = (typeof TRUST_GRADES)[number]

/**
 * The channels a development-grade image may not be published to.
 *
 * `development` is absent on purpose, and it is the whole reason this is a
 * list rather than a boolean: `docs/design/release-artifacts.md` §2 fixes the
 * meanings -- `development` carries no promise, `candidate` is under
 * qualification, `stable` is what customers deploy -- and no production
 * material exists yet, so an unconditional refusal would make the release path
 * unrunnable and ship this gate untested. A gate nobody can run is a gate
 * nobody notices breaking (`docs/plan/PLAN-077.md` §4.2).
 */
export const CUSTOMER_CHANNELS: readonly ReleaseChannel[] = ['candidate', 'stable']

/** What the baked `/usr/share/mos/meta/` of an image says about its trust. */
export interface BakedTrust {
  readonly grade: TrustGrade
  /** The domains `GENERATED` names; empty on a production image. */
  readonly developmentDomains: readonly string[]
  /** `update.source` as the baked manifest states it; null when it names none. */
  readonly updateSource: string | null
  /** How many keys `trust.signingKeys` carries. */
  readonly signingKeyCount: number
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
  /**
   * The grade of the signing material the image was built from, measured from
   * the image's own baked `meta/` and re-measured by the gate. Recorded rather
   * than only refused, so a `development` release directory says what it is
   * instead of being distinguishable only by having been let through.
   */
  readonly trust: { readonly grade: TrustGrade, readonly developmentDomains: readonly string[] }
  readonly artifacts: readonly ReleaseArtifact[]
}

/** The evidence schema this tree commits, held as an equality like the manifest's. */
export const EVIDENCE_SCHEMA_VERSION = 2

/** The I1-I4 boot-assurance ladder (docs/design/security-model.md §5). */
export const BOOT_ASSURANCE_LEVELS = ['I1', 'I2', 'I3', 'I4'] as const
export type BootAssuranceLevel = (typeof BOOT_ASSURANCE_LEVELS)[number]

/**
 * Every class an evidence ref may carry. Each ref pairs one of these with a
 * repo-verifiable reference -- a Makefile target, a tests/ suite, a verify/
 * check name, or a docs/design section -- so a claim is auditable by running
 * or reading what it cites. The set is closed: a misspelt class must not
 * silently satisfy nothing.
 */
export const EVIDENCE_CLASSES = [
  'verity-root', 'ab-fallback', 'update-negative', 'vendor-boot-capability', 'signature-negative',
] as const
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number]

/**
 * The machine-enforced evidence FLOOR per claimed level -- necessary, not
 * sufficient; the ladder's full qualification bar (on-board runs, dated
 * evidence) lives in the qualification prose and the board record. Additive
 * like the ladder itself: each level's set contains the one below.
 */
export const LEVEL_REQUIRED_CLASSES: Readonly<Record<BootAssuranceLevel, readonly EvidenceClass[]>> = {
  I1: ['verity-root'],
  I2: ['verity-root', 'ab-fallback', 'update-negative'],
  I3: ['verity-root', 'ab-fallback', 'update-negative', 'vendor-boot-capability', 'signature-negative'],
  I4: ['verity-root', 'ab-fallback', 'update-negative', 'vendor-boot-capability', 'signature-negative'],
}

/**
 * The unsupported-claim wording: "secure boot" and "tamper-proof" in any
 * case, joined, spaced, underscored or hyphenated. Deliberately DUMB -- no
 * negation analysis, so even "no secure boot" trips it below I3/I4; honest
 * prose rewords instead (docs/design/release-artifacts.md §4 states the
 * exact rule, docs/design/security-model.md §0 bans the words from prose).
 */
const UNSUPPORTED_CLAIM_WORDING = /secure[\s_-]?boot|tamper[\s_-]?proof/i

export interface EvidenceRef {
  readonly class: EvidenceClass
  readonly ref: string
}

/** The physical/debug posture, one honest sentence per port. */
export interface PhysicalBoundaries {
  readonly jtag: string
  readonly serialConsole: string
  readonly recoveryPath: string
}

export interface BoardEvidence {
  readonly board: string
  /** The board revision this record covers; "all" when one record covers every revision. */
  readonly revision: string
  readonly bootAssurance: BootAssuranceLevel
  readonly qualification: string
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly physicalBoundaries: PhysicalBoundaries
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
  const trustRaw = value.trust
  if (!isRecord(trustRaw)) {
    throw new Error(
      `${path} carries no trust block; it records the grade of the signing material the image was `
      + `built from, measured from the image's own /usr/share/mos/meta/, and a release that does `
      + `not say whether it was signed with development keys is one nobody can refuse`,
    )
  }
  const grade = trustRaw.grade
  if (typeof grade !== 'string' || !(TRUST_GRADES as readonly string[]).includes(grade)) {
    throw new Error(
      `trust.grade ${JSON.stringify(grade)} in ${path} is not one of ${TRUST_GRADES.join('/')}`,
    )
  }
  const domainsRaw = trustRaw.developmentDomains
  if (!Array.isArray(domainsRaw) || domainsRaw.some(d => typeof d !== 'string')) {
    throw new Error(
      `trust.developmentDomains in ${path} is not an array of strings; a production release `
      + `carries the empty array rather than omitting the field, so an absent one is a manifest `
      + `written by something that did not measure`,
    )
  }
  const developmentDomains = domainsRaw as string[]

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
    trust: { grade: grade as TrustGrade, developmentDomains },
    artifacts,
  }
}

/**
 * What an image's baked `/usr/share/mos/meta/` says about the trust it ships.
 *
 * `dir` is that directory as EXTRACTED from the image, handed in the way
 * `--package-manifest` already is: `docs/design/release-artifacts.md` §3
 * records the reason -- the extraction needs the verify toolset and the
 * extracted bytes are the same either way -- and the bound that comes with it,
 * that a caller who hands over the wrong directory gets an answer about the
 * wrong directory, is inherited rather than invented.
 *
 * **The vacuity guard is the manifest, and it is the point of this function.**
 * A grade read as "no GENERATED marker" out of a missing or empty directory is
 * `production` for every image ever built on a host that never extracted one.
 * `updates/manifest.json` is a REQUIRED member of the baked public set
 * (`rootfs/build.sh`'s `META_PUBLIC`), so its absence means the extraction is
 * wrong or the image provisions no anchor -- and neither of those is a release.
 * Both are a throw.
 */
export function readBakedTrust(dir: string): BakedTrust {
  const manifestPath = join(dir, 'updates', 'manifest.json')
  const st = statSync(manifestPath, { throwIfNoEntry: false })
  if (st === undefined || !st.isFile()) {
    throw new Error(
      `${manifestPath} does not exist, so ${dir} is not the /usr/share/mos/meta/ of a mos image. `
      + `That document is a required member of the baked public set, so an extraction without it `
      + `is either the wrong directory or an image that provisions no trust anchor at all -- and `
      + `reading "no development marker here" out of a directory nobody populated would report `
      + `every such image as production`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    throw new Error(`${manifestPath} is not JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${manifestPath} is not a JSON object; it is the baked update configuration`)
  }
  // Two fields, read defensively rather than a second validator: the schema is
  // PLAN-070 F5's and mosd's reader owns it. What is refused here is a value
  // this gate cannot READ, because "cannot tell" must never render as "fine".
  const update = isRecord(parsed.update) ? parsed.update : {}
  const rawSource = update.source
  if (rawSource !== null && rawSource !== undefined && typeof rawSource !== 'string') {
    throw new Error(
      `update.source in ${manifestPath} is ${JSON.stringify(rawSource)}, neither a string nor `
      + `null; this gate cannot tell whether the image names an update server`,
    )
  }
  const trust = isRecord(parsed.trust) ? parsed.trust : {}
  const keys = trust.signingKeys
  if (!Array.isArray(keys)) {
    throw new Error(
      `trust.signingKeys in ${manifestPath} is ${JSON.stringify(keys)}, not an array. It is the `
      + `image's package-trust anchor and rootfs/build.sh refuses to bake a manifest without it, `
      + `so an image carrying none was not staged by this build`,
    )
  }

  const markerPath = join(dir, BAKED_TRUST_MARKER)
  const markerStat = statSync(markerPath, { throwIfNoEntry: false })
  const marker = markerStat === undefined ? undefined : readFileSync(markerPath, 'utf8')
  return {
    grade: marker === undefined ? 'production' : 'development',
    developmentDomains: marker === undefined ? [] : markerDomains(marker),
    updateSource: typeof rawSource === 'string' ? rawSource : null,
    signingKeyCount: keys.length,
  }
}

/** The development-grade marker's name, in the image and in the tree's `meta/`. */
export const BAKED_TRUST_MARKER = 'GENERATED'

/**
 * The domains a `GENERATED` marker names, from its `DOMAINS=` line.
 *
 * The LAST such line wins, which is `pkgs/rauc/gen-dev-keys.sh`'s own rule when
 * it merges a second domain into an existing marker. A marker naming none is
 * still a marker: its presence is the claim and the line only says which half.
 */
export function markerDomains(text: string): string[] {
  const lines = text.split('\n').filter(l => l.startsWith('DOMAINS='))
  const last = lines[lines.length - 1]
  return last === undefined ? [] : last.slice('DOMAINS='.length).split(/\s+/).filter(d => d !== '')
}

/**
 * The board-evidence file: the per-board/revision claim record, held against
 * the I1-I4 ladder's semantics -- this validator and security-model.md §5 are
 * together the ONE place those semantics live.
 *
 * Beyond shape, three things are enforced: every claimed level is backed by
 * its LEVEL_REQUIRED_CLASSES floor (a missing class is a refusal naming it),
 * the physical/debug posture is stated per port, and unsupported-claim
 * wording ("secure boot"/"tamper-proof") is refused anywhere in the file's
 * prose unless the claim is an evidenced I3/I4 -- the class floor for which
 * has, by that point in this function, already been enforced.
 */
export function checkBoardEvidence(value: unknown, path: string, board: string): BoardEvidence {
  if (!isRecord(value)) {
    throw new Error(`${path} is not a JSON object`)
  }
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `${path} carries evidence schemaVersion ${JSON.stringify(value.schemaVersion)}; this reader `
      + `holds ${EVIDENCE_SCHEMA_VERSION}`,
    )
  }
  const evBoard = requireString(value.board, 'evidence board name', path)
  if (evBoard !== board) {
    throw new Error(
      `${path} is evidence for board '${evBoard}' and this release is for '${board}'; `
      + `evidence is per board and the wrong board's proves nothing here`,
    )
  }
  const revision = requireString(value.revision, 'board revision ("all" when one record covers every revision)', path)
  const bootAssurance = value.bootAssurance
  if (typeof bootAssurance !== 'string' || !(BOOT_ASSURANCE_LEVELS as readonly string[]).includes(bootAssurance)) {
    throw new Error(
      `${path} claims boot-assurance ${JSON.stringify(bootAssurance)}, not one of `
      + `${BOOT_ASSURANCE_LEVELS.join('/')} (the ladder in docs/design/security-model.md §5)`,
    )
  }
  const level = bootAssurance as BootAssuranceLevel
  const qualification = requireString(value.qualification, 'qualification statement', path)

  const refsRaw = value.evidenceRefs
  if (!Array.isArray(refsRaw) || refsRaw.length === 0) {
    throw new Error(
      `${path} lists no evidenceRefs; a boot-assurance claim with nothing behind it is exactly `
      + `what this file exists to refuse`,
    )
  }
  const evidenceRefs: EvidenceRef[] = []
  for (const r of refsRaw) {
    if (!isRecord(r)) {
      throw new Error(`${path} carries an evidenceRefs entry that is not an object`)
    }
    const cls = r.class
    if (typeof cls !== 'string' || !(EVIDENCE_CLASSES as readonly string[]).includes(cls)) {
      throw new Error(
        `${path} carries an evidenceRefs entry of class ${JSON.stringify(cls)}, not one of `
        + `${EVIDENCE_CLASSES.join('/')}; a class outside the set satisfies no level and hides a typo`,
      )
    }
    const ref = requireString(r.ref, `repo-verifiable reference on its '${cls}' evidence entry`, path)
    evidenceRefs.push({ class: cls as EvidenceClass, ref })
  }

  const pbRaw = value.physicalBoundaries
  if (!isRecord(pbRaw)) {
    throw new Error(
      `${path} carries no physicalBoundaries block; the jtag/serialConsole/recoveryPath posture `
      + `is part of the claim (docs/design/manufacturing.md §6)`,
    )
  }
  const jtag = requireString(pbRaw.jtag, 'physicalBoundaries.jtag statement', path)
  const serialConsole = requireString(pbRaw.serialConsole, 'physicalBoundaries.serialConsole statement', path)
  const recoveryPath = requireString(pbRaw.recoveryPath, 'physicalBoundaries.recoveryPath statement', path)

  const present = new Set(evidenceRefs.map(r => r.class))
  for (const cls of LEVEL_REQUIRED_CLASSES[level]) {
    if (!present.has(cls)) {
      throw new Error(
        `${path} claims boot-assurance ${level} with no evidenceRefs entry of class '${cls}'; `
        + `${level} requires every class of [${LEVEL_REQUIRED_CLASSES[level].join(', ')}], and a `
        + `claim above its evidence fails publication`,
      )
    }
  }

  if (level !== 'I3' && level !== 'I4') {
    const texts = [qualification, ...evidenceRefs.map(r => r.ref), jtag, serialConsole, recoveryPath]
    const hit = texts.find(t => UNSUPPORTED_CLAIM_WORDING.test(t))
    if (hit !== undefined) {
      const word = (UNSUPPORTED_CLAIM_WORDING.exec(hit) as RegExpExecArray)[0]
      throw new Error(
        `${path} says ${JSON.stringify(word)} while claiming boot-assurance ${level}; that wording `
        + `is refused below an evidenced I3/I4 claim, even in a negation -- reword the statement `
        + `(matching rule: docs/design/release-artifacts.md §4)`,
      )
    }
  }

  return {
    board: evBoard,
    revision,
    bootAssurance: level,
    qualification,
    evidenceRefs,
    physicalBoundaries: { jtag, serialConsole, recoveryPath },
  }
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
  /** What the image's own baked meta/ said when the gate re-measured it. */
  readonly trust: BakedTrust
}

/**
 * The gate: a release directory re-checked from scratch, refusing the first
 * gap by name. Nothing is trusted from the assembly that wrote it -- the
 * manifest is re-validated, every artifact is re-measured and re-hashed,
 * SHA256SUMS is re-derived and compared, and the board evidence is re-read --
 * so the same command answers "may this be published?" whether the directory
 * was written a minute ago or restored from an archive.
 */
export function gateReleaseDir(dir: string, evidencePath: string, bakedMetaDir: string): GateReport {
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

  // The trust refusals, LAST, because they are about publication policy and
  // everything above is about whether there is a release here at all. Telling
  // somebody their bench image may not go to stable before telling them their
  // SBOM is empty answers a question they have not reached yet.
  const trust = readBakedTrust(bakedMetaDir)
  if (trust.grade !== manifest.trust.grade
    || trust.developmentDomains.join(' ') !== manifest.trust.developmentDomains.join(' ')) {
    throw new Error(
      `${bakedMetaDir} measures trust grade '${trust.grade}'`
      + `${trust.developmentDomains.length > 0 ? ` (domains ${trust.developmentDomains.join(' ')})` : ''} `
      + `and manifest.json records '${manifest.trust.grade}'`
      + `${manifest.trust.developmentDomains.length > 0 ? ` (domains ${manifest.trust.developmentDomains.join(' ')})` : ''}; `
      + `the manifest is populated FROM the image's baked meta/, so a divergence means the two are `
      + `not from one build -- re-extract and re-assemble`,
    )
  }
  if (trust.grade === 'development' && CUSTOMER_CHANNELS.includes(manifest.release.channel)) {
    throw new Error(
      `this release is on the '${manifest.release.channel}' channel and its image carries `
      + `/usr/share/mos/meta/${BAKED_TRUST_MARKER}, which marks the signing material it was built `
      + `from DEVELOPMENT-GRADE in ${trust.developmentDomains.length > 0 ? `the ${trust.developmentDomains.join(' and ')} domain(s)` : 'a domain it does not name'}. `
      + `Every device flashed from it trusts bundles signed by a key that lives unprotected in a `
      + `working tree, or verifies packages against one. A development image may be published to `
      + `the '${RELEASE_CHANNELS[0]}' channel, which carries no promise; it may not be published `
      + `to a customer. Put production material in meta/ -- without meta/${BAKED_TRUST_MARKER} `
      + `beside it -- and rebuild (docs/design/release-signing.md §2.5)`,
    )
  }
  if (CUSTOMER_CHANNELS.includes(manifest.release.channel) && trust.signingKeyCount === 0) {
    throw new Error(
      `this release is on the '${manifest.release.channel}' channel and its image's `
      + `trust.signingKeys is empty, so it trusts no package signing key at all`
      + `${trust.updateSource === null
        ? ' and bakes no update source either'
        : ` while baking the source ${trust.updateSource}`}. `
      + `Under PLAN-070 §5.3 the source URL is operator-changeable, so "this image will never `
      + `fetch a package" stopped being a fact the build can establish: an authenticated operator `
      + `can point any device of this release at a server, and every package it then downloads is `
      + `refused as unauthentic with no remedy but a new image. An empty key list is a supported `
      + `steady state on the '${RELEASE_CHANNELS[0]}' channel, which carries no promise; a customer `
      + `release carries the key a ceremony produced (docs/design/release-signing.md §2.1)`,
    )
  }

  return { manifest, evidence, artifactsChecked: manifest.artifacts.length, bytesTotal, trust }
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
  /**
   * The image's `/usr/share/mos/meta/` directory, as extracted -- the same
   * shape as `packageManifestPath` and for the same recorded reason.
   */
  readonly bakedMetaDir: string
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
  // Measured before anything is copied: a release whose grade cannot be read
  // is refused before it exists as a directory, and readBakedTrust throws on
  // an extraction that does not carry the public set's required member.
  const trust = readBakedTrust(inputs.bakedMetaDir)
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
      { name: 'baked-meta', path: inputs.bakedMetaDir, sha256: fileSha256(join(inputs.bakedMetaDir, 'updates', 'manifest.json')) },
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
    trust: { grade: trust.grade, developmentDomains: trust.developmentDomains },
    artifacts,
  }
  const manifestPath = join(inputs.outDir, 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const gate = gateReleaseDir(inputs.outDir, inputs.evidencePath, inputs.bakedMetaDir)
  return { outDir: inputs.outDir, manifestPath, gate }
}
