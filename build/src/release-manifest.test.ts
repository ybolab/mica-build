// The release identity, driven from the failing side.
//
// Every refusal in src/release-manifest.ts has a case here, and every family
// of refusals has a positive control beside it -- a table of refusals without
// controls is satisfied by a function that refuses everything. The gate cases
// run over a REAL release directory assembled from fixture files under
// build/.work, mutated per case: delete an artifact, flip a byte, empty the
// notes, drop the evidence. Deeper refusals -- the ones a plain file mutation
// cannot reach because the per-artifact digest check fires first -- are
// reached by RESEALING: the mutation is applied and the manifest's digests
// are recomputed to match, so the gate walks past the digest check and the
// guard under test is the one that must fire. Removing any of these guards
// reddens its case, which is what makes the table evidence.

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeWorkDir } from './paths.ts'
import {
  ARTIFACT_ROLES,
  assembleRelease,
  builderImagesFrom,
  checkBoardEvidence,
  checkReleaseManifest,
  fileSha256,
  gateReleaseDir,
  licensesFromRows,
  packageRows,
  RELEASE_CHANNELS,
  RELEASE_SCHEMA_VERSION,
  REQUIRED_ROLES,
  sbomFromRows,
  sha256SumsText,
  SOURCE_OFFER,
  type AssembleInputs,
  type ReleaseArtifact,
} from './release-manifest.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const SHA = 'a'.repeat(64)

const TSV = '#package\tversion\tarchitecture\n'
  + 'libc6\t2.41-12\tarm64\n'
  + 'mos-system\t0.1.0+git0123456789ab-1\tarm64\n'
  + 'mosd\t0.1.0+git0123456789ab-1\tarm64\n'

const EVIDENCE = {
  schemaVersion: 1,
  board: 'cx3576',
  bootAssurance: 'I1',
  qualification: 'dev-fixture: test material, no hardware evidence',
}

const WORK = makeWorkDir('release-test')
afterAll(() => { rmSync(WORK, { recursive: true, force: true }) })

let caseN = 0

/** Fixture inputs under an own directory, one per call so mutations cannot bleed. */
function fixture(overrides: Partial<AssembleInputs> = {}): AssembleInputs {
  caseN += 1
  const dir = join(WORK, `case-${caseN}`)
  mkdirSync(join(dir, 'in'), { recursive: true })
  writeFileSync(join(dir, 'in', 'cx3576-mos-1000.img'), 'fixture disk image bytes\n')
  writeFileSync(join(dir, 'in', 'mos-cx3576-1000.raucb'), 'fixture bundle bytes\n')
  writeFileSync(join(dir, 'in', 'manifest.tsv'), TSV)
  writeFileSync(join(dir, 'in', 'NOTES.md'), '# fixture release\n\nnothing shipped; test material.\n')
  writeFileSync(join(dir, 'in', 'evidence.json'), `${JSON.stringify(EVIDENCE, null, 2)}\n`)
  return {
    board: 'cx3576',
    profile: 'dev',
    channel: 'development',
    version: '1.2.3',
    imagePath: join(dir, 'in', 'cx3576-mos-1000.img'),
    bundlePath: join(dir, 'in', 'mos-cx3576-1000.raucb'),
    packageManifestPath: join(dir, 'in', 'manifest.tsv'),
    notesPath: join(dir, 'in', 'NOTES.md'),
    evidencePath: join(dir, 'in', 'evidence.json'),
    outDir: join(dir, 'release'),
    commit: COMMIT,
    dirty: false,
    builderImages: { IMAGE_BUN_1: 'oven/bun:1@sha256:deadbeef' },
    ...overrides,
  }
}

/** A valid manifest OBJECT for the schema table, no filesystem involved. */
function validManifest(): Record<string, unknown> {
  const artifacts = REQUIRED_ROLES.map((role, i) => ({
    filename: `artifact-${i}.${role}`, role, bytes: i + 1, sha256: SHA,
  }))
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    release: { version: '1.2.3', channel: 'stable' },
    board: { name: 'cx3576', profile: 'prod' },
    source: { commit: COMMIT, dirty: false },
    build: { builderImages: {} },
    bootAssurance: 'I1',
    artifacts,
  }
}

// Resealing: recompute every content artifact's size and digest, rewrite
// SHA256SUMS from them, and re-pin it in the manifest. What it deliberately
// does NOT do is validate anything -- it exists to carry a mutation PAST the
// digest checks so the deeper guard is the one under test.
function reseal(dir: string): void {
  const path = join(dir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { artifacts: ReleaseArtifact[] }
  const content = manifest.artifacts.filter(a => a.role !== 'checksums').map(a => ({
    ...a, bytes: statSync(join(dir, a.filename)).size, sha256: fileSha256(join(dir, a.filename)),
  }))
  const sumsName = (manifest.artifacts.find(a => a.role === 'checksums') as ReleaseArtifact).filename
  writeFileSync(join(dir, sumsName), sha256SumsText(content))
  manifest.artifacts = [...content, {
    filename: sumsName, role: 'checksums',
    bytes: statSync(join(dir, sumsName)).size, sha256: fileSha256(join(dir, sumsName)),
  }]
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Re-pin ONE file's size+digest in the manifest without touching SHA256SUMS. */
function repinOne(dir: string, filename: string): void {
  const path = join(dir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { artifacts: ReleaseArtifact[] }
  manifest.artifacts = manifest.artifacts.map(a => a.filename === filename
    ? { ...a, bytes: statSync(join(dir, filename)).size, sha256: fileSha256(join(dir, filename)) }
    : a)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

// The schema validator.

describe('checkReleaseManifest holds the schema, field by field', () => {
  test('POSITIVE CONTROL: a manifest carrying every field is accepted and returned typed', () => {
    const m = checkReleaseManifest(validManifest(), '/r/manifest.json')
    expect(m.release.channel).toBe('stable')
    expect(m.artifacts.length).toBe(REQUIRED_ROLES.length)
  })

  const cases: [string, (m: Record<string, unknown>) => unknown, RegExp][] = [
    ['not an object', () => 'nope', /is not a JSON object/],
    ['a FUTURE schemaVersion: the floor is an equality', m => ({ ...m, schemaVersion: 2 }),
      /holds the floor at 1/],
    ['a channel outside the enum', m => ({ ...m, release: { version: '1.2.3', channel: 'nightly' } }),
      /release\.channel "nightly" .* is not one of development\/candidate\/stable/],
    ['a version that is not a plain version string', m => ({ ...m, release: { version: '1 2', channel: 'stable' } }),
      /not a plain version string/],
    ['an empty board name', m => ({ ...m, board: { name: '', profile: 'prod' } }), /carries no board\.name/],
    ['an empty profile', m => ({ ...m, board: { name: 'cx3576', profile: '' } }), /carries no board\.profile/],
    ['an abbreviated commit', m => ({ ...m, source: { commit: COMMIT.slice(0, 12), dirty: false } }),
      /not a full 40-hex git commit/],
    ['a stringly dirty flag', m => ({ ...m, source: { commit: COMMIT, dirty: 'yes' } }), /not a boolean/],
    ['builderImages that is not an object', m => ({ ...m, build: { builderImages: 'IMAGE_BUN_1' } }),
      /build\.builderImages .* is not an object/],
    ['a non-string builder image', m => ({ ...m, build: { builderImages: { IMAGE_BUN_1: 7 } } }),
      /build\.builderImages\.IMAGE_BUN_1/],
    ['an empty bootAssurance', m => ({ ...m, bootAssurance: '' }), /carries no bootAssurance level/],
    ['no artifacts at all', m => ({ ...m, artifacts: [] }), /lists no artifacts/],
  ]
  for (const [label, mutate, want] of cases) {
    test(`refused: ${label}`, () => {
      expect(() => checkReleaseManifest(mutate(validManifest()), '/r/manifest.json')).toThrow(want)
    })
  }

  test('an artifact filename carrying a path separator is refused: it could point outside the directory', () => {
    const m = validManifest()
    ;(m.artifacts as Record<string, unknown>[])[0]!.filename = '../escape'
    expect(() => checkReleaseManifest(m, '/r/manifest.json')).toThrow(/not a plain filename/)
  })

  test('an artifact named manifest.json is refused: the manifest cannot pin itself', () => {
    const m = validManifest()
    ;(m.artifacts as Record<string, unknown>[])[0]!.filename = 'manifest.json'
    expect(() => checkReleaseManifest(m, '/r/manifest.json')).toThrow(/cannot pin itself/)
  })

  test('an unknown role, non-integer bytes and a short digest each get their own sentence', () => {
    for (const [field, value, want] of [
      ['role', 'installer', /role "installer", not one of/],
      ['bytes', 1.5, /not a non-negative integer/],
      ['bytes', -1, /not a non-negative integer/],
      ['sha256', 'abc123', /not 64 hex digits/],
    ] as const) {
      const m = validManifest()
      ;(m.artifacts as Record<string, unknown>[])[0]![field] = value
      expect(() => checkReleaseManifest(m, '/r/manifest.json')).toThrow(want)
    }
  })

  test('two entries under one filename are refused', () => {
    const m = validManifest()
    const arts = m.artifacts as Record<string, unknown>[]
    arts[1]!.filename = arts[0]!.filename
    expect(() => checkReleaseManifest(m, '/r/manifest.json')).toThrow(/twice; two entries under one name/)
  })

  test('EACH required role, dropped, is named in the floor refusal', () => {
    for (const role of REQUIRED_ROLES) {
      const m = validManifest()
      m.artifacts = (m.artifacts as { role: string }[]).filter(a => a.role !== role)
      expect(() => checkReleaseManifest(m, '/r/manifest.json'))
        .toThrow(new RegExp(`no artifact with role ${role}`))
    }
  })

  test('the role and channel enums this file drives are the shipped ones', () => {
    // A test table over a stale copy of the enums would keep passing after
    // the schema moved; assert the sets themselves.
    expect(RELEASE_CHANNELS).toEqual(['development', 'candidate', 'stable'])
    expect([...ARTIFACT_ROLES].sort()).toEqual([...REQUIRED_ROLES].sort())
  })
})

// The board-evidence seam.

describe('checkBoardEvidence holds presence and shape, and nothing more', () => {
  test('POSITIVE CONTROL: the dev fixture shape is accepted', () => {
    const e = checkBoardEvidence(EVIDENCE, '/b/evidence.json', 'cx3576')
    expect(e.bootAssurance).toBe('I1')
    expect(e.qualification).toContain('dev-fixture')
  })

  test('evidence for the WRONG board is refused: it proves nothing here', () => {
    expect(() => checkBoardEvidence(EVIDENCE, '/b/evidence.json', 'x64'))
      .toThrow(/evidence for board 'cx3576' and this release is for 'x64'/)
  })

  test('a missing schemaVersion, level or qualification each get their own sentence', () => {
    expect(() => checkBoardEvidence({ ...EVIDENCE, schemaVersion: 2 }, '/e', 'cx3576'))
      .toThrow(/evidence schemaVersion 2/)
    expect(() => checkBoardEvidence({ ...EVIDENCE, bootAssurance: '' }, '/e', 'cx3576'))
      .toThrow(/carries no bootAssurance level/)
    expect(() => checkBoardEvidence({ ...EVIDENCE, qualification: undefined }, '/e', 'cx3576'))
      .toThrow(/carries no qualification statement/)
    expect(() => checkBoardEvidence([], '/e', 'cx3576')).toThrow(/is not a JSON object/)
  })
})

// The SBOM inputs and derivations.

describe('packageRows reads manifest.tsv the way the shipped file is written', () => {
  test('POSITIVE CONTROL: the fixture parses to its three rows, comments skipped', () => {
    const rows = packageRows(TSV, '/m.tsv')
    expect(rows.length).toBe(3)
    expect(rows[0]).toEqual({ name: 'libc6', version: '2.41-12', architecture: 'arm64' })
  })

  test('a malformed row is refused, counted and quoted', () => {
    expect(() => packageRows('a\tb\n', '/m.tsv')).toThrow(/1 of 1 row\(s\) that are not package<TAB>version<TAB>architecture/)
  })

  test('an EMPTY manifest is refused: an SBOM over it would say nothing', () => {
    expect(() => packageRows('#package\tversion\tarchitecture\n', '/m.tsv')).toThrow(/lists no packages/)
  })

  test('a manifest naming no mos package is refused, as packed-mos-manifest refuses the image', () => {
    expect(() => packageRows('libc6\t2.41-12\tarm64\n', '/m.tsv')).toThrow(/names no mos package/)
  })
})

describe('the SBOM and the license inventory are pure functions of their inputs', () => {
  const rows = packageRows(TSV, '/m.tsv')
  const identity = { board: 'cx3576', version: '1.2.3', commit: COMMIT, dirty: false }

  test('two derivations over one input are byte-identical: no wall clock anywhere', () => {
    expect(JSON.stringify(sbomFromRows(rows, identity))).toBe(JSON.stringify(sbomFromRows(rows, identity)))
  })

  test('the SBOM carries one component per row and the source offer + commit in metadata', () => {
    const sbom = sbomFromRows(rows, identity) as {
      components: { name: string }[]
      metadata: { properties: { name: string, value: string }[] }
    }
    expect(sbom.components.length).toBe(rows.length)
    const props = Object.fromEntries(sbom.metadata.properties.map(p => [p.name, p.value]))
    expect(props['mos:source-offer']).toBe(SOURCE_OFFER)
    expect(props['mos:source-commit']).toBe(COMMIT)
  })

  test('the license inventory repeats the package list and the offer, deliberately', () => {
    const inv = licensesFromRows(rows, { commit: COMMIT, dirty: true }) as {
      statement: string, packages: unknown[], source: { dirty: boolean }
    }
    expect(inv.statement).toBe(SOURCE_OFFER)
    expect(inv.packages.length).toBe(rows.length)
    expect(inv.source.dirty).toBe(true)
  })
})

describe('builderImagesFrom transcribes and does not resolve', () => {
  test('IMAGE_ and LOCAL_ assignments are taken verbatim; comments and other keys are not', () => {
    const out = builderImagesFrom(
      '# a comment\nIMAGE_BUN_1=oven/bun:1.4.0@sha256:abc\nLOCAL_MOS_BUILD_C=localhost/mos-build-c\nTOOL_GO=1.22\n',
    )
    expect(out).toEqual({ IMAGE_BUN_1: 'oven/bun:1.4.0@sha256:abc', LOCAL_MOS_BUILD_C: 'localhost/mos-build-c' })
  })

  test('a value that is a bare tag is NOT refused here: from.sh is the one validator of the pin', () => {
    expect(builderImagesFrom('IMAGE_X=debian:trixie\n')).toEqual({ IMAGE_X: 'debian:trixie' })
  })
})

describe('SHA256SUMS is the sha256sum -c form, and cannot list itself', () => {
  test('two spaces between digest and name, one line per artifact, manifest order', () => {
    const arts: ReleaseArtifact[] = [
      { filename: 'a.img', role: 'image', bytes: 1, sha256: SHA },
      { filename: 'b.raucb', role: 'bundle', bytes: 2, sha256: SHA },
    ]
    expect(sha256SumsText(arts)).toBe(`${SHA}  a.img\n${SHA}  b.raucb\n`)
  })

  test('a checksums-role artifact in the list is a wrong caller, refused rather than skipped', () => {
    expect(() => sha256SumsText([{ filename: 'SHA256SUMS', role: 'checksums', bytes: 1, sha256: SHA }]))
      .toThrow(/cannot list its own digest/)
  })
})

// Assembly.

describe('assembleRelease writes a directory the gate passes, from measured facts only', () => {
  test('POSITIVE CONTROL: the fixture assembles, and the gate re-checked seven artifacts', () => {
    const inputs = fixture()
    const result = assembleRelease(inputs)
    expect(result.gate.artifactsChecked).toBe(7)
    const manifest = checkReleaseManifest(
      JSON.parse(readFileSync(result.manifestPath, 'utf8')), result.manifestPath,
    )
    expect(manifest.release).toEqual({ version: '1.2.3', channel: 'development' })
    expect(manifest.bootAssurance).toBe('I1')
    expect(manifest.source).toEqual({ commit: COMMIT, dirty: false })
    expect(manifest.build.builderImages).toEqual({ IMAGE_BUN_1: 'oven/bun:1@sha256:deadbeef' })
    const roles = manifest.artifacts.map(a => a.role).sort()
    expect(roles).toEqual([...REQUIRED_ROLES].sort())
    // The digests are measured off the staged copies.
    const img = manifest.artifacts.find(a => a.role === 'image') as ReleaseArtifact
    expect(img.sha256).toBe(fileSha256(join(result.outDir, img.filename)))
  })

  test('a -latest symlink is published under the REAL name it resolves to', () => {
    const inputs = fixture()
    const latest = join(inputs.imagePath, '..', 'cx3576-mos-latest.img')
    symlinkSync('cx3576-mos-1000.img', latest)
    const result = assembleRelease({ ...inputs, imagePath: latest })
    const img = result.gate.manifest.artifacts.find(a => a.role === 'image') as ReleaseArtifact
    expect(img.filename).toBe('cx3576-mos-1000.img')
  })

  test('EACH missing input is refused with a sentence naming what produces it', () => {
    for (const [key, want] of [
      ['imagePath', /make os-image-cx3576/],
      ['bundlePath', /--bundle --board cx3576/],
      ['packageManifestPath', /\/usr\/share\/mos\/manifest\.tsv/],
      ['notesPath', /refused by the publication gate/],
      ['evidencePath', /no board evidence qualifies/],
    ] as const) {
      const inputs = fixture()
      expect(() => assembleRelease({ ...inputs, [key]: join(WORK, 'absent') })).toThrow(want)
    }
  })

  test('EMPTY release notes are refused at assembly, before anything is written', () => {
    const inputs = fixture()
    writeFileSync(inputs.notesPath, '')
    expect(() => assembleRelease(inputs)).toThrow(/release notes at .* are empty/)
  })

  test('a channel outside the enum is refused rather than invented', () => {
    expect(() => assembleRelease(fixture({ channel: 'nightly' })))
      .toThrow(/channel "nightly" is not one of development\/candidate\/stable/)
  })

  test('an abbreviated commit is refused: the identity must resolve years later', () => {
    expect(() => assembleRelease(fixture({ commit: 'abc123' }))).toThrow(/not a full 40-hex git commit/)
  })

  test('evidence for another board is refused at assembly too', () => {
    const inputs = fixture()
    writeFileSync(inputs.evidencePath, JSON.stringify({ ...EVIDENCE, board: 'x64' }))
    expect(() => assembleRelease(inputs)).toThrow(/evidence for board 'x64'/)
  })
})

// The publication gate, mutation by mutation.

describe('the gate refuses each gap by name, proven RED against an assembled fixture', () => {
  function assembled(): { dir: string, evidence: string } {
    const inputs = fixture()
    const result = assembleRelease(inputs)
    return { dir: result.outDir, evidence: inputs.evidencePath }
  }

  test('POSITIVE CONTROL: the pristine directory passes, with its counts', () => {
    const { dir, evidence } = assembled()
    const report = gateReleaseDir(dir, evidence)
    expect(report.artifactsChecked).toBe(7)
    expect(report.bytesTotal).toBeGreaterThan(0)
  })

  test('a DELETED artifact is named with its role', () => {
    const { dir, evidence } = assembled()
    rmSync(join(dir, 'mos-cx3576-1000.raucb'))
    expect(() => gateReleaseDir(dir, evidence))
      .toThrow(/mos-cx3576-1000\.raucb \(role bundle\) is listed in manifest\.json and missing/)
  })

  test('a FLIPPED BYTE (size unchanged) is a digest mismatch naming both digests', () => {
    const { dir, evidence } = assembled()
    writeFileSync(join(dir, 'cx3576-mos-1000.img'), 'fixture disk image bytEs\n')
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/cx3576-mos-1000\.img hashes to sha256/)
  })

  test('a SIZE change is its own sentence, before any hash is computed', () => {
    const { dir, evidence } = assembled()
    writeFileSync(join(dir, 'cx3576-mos-1000.img'), 'short\n')
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/bytes and manifest\.json records/)
  })

  test('DELETED release notes are the missing-artifact refusal, naming release-notes.md', () => {
    const { dir, evidence } = assembled()
    rmSync(join(dir, 'release-notes.md'))
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/release-notes\.md \(role release-notes\)/)
  })

  test('a missing manifest.json means there is no release, only files', () => {
    const { dir, evidence } = assembled()
    rmSync(join(dir, 'manifest.json'))
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/manifest\.json does not exist/)
  })

  test('a manifest that is not JSON is refused as such', () => {
    const { dir, evidence } = assembled()
    writeFileSync(join(dir, 'manifest.json'), '{half a manifest')
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/is not JSON/)
  })

  test('ABSENT board evidence refuses publication, naming the seam', () => {
    const { dir } = assembled()
    expect(() => gateReleaseDir(dir, join(WORK, 'no-evidence.json')))
      .toThrow(/no board evidence at .*no-evidence\.json/)
  })

  test('evidence that DIVERGED from the manifest after assembly is refused', () => {
    const { dir, evidence } = assembled()
    writeFileSync(evidence, JSON.stringify({ ...EVIDENCE, bootAssurance: 'I9' }))
    expect(() => gateReleaseDir(dir, evidence))
      .toThrow(/asserts boot-assurance 'I9' and manifest\.json records 'I1'/)
  })

  test('a channel edited in the manifest is caught by the schema re-validation', () => {
    const { dir, evidence } = assembled()
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { release: { channel: string } }
    m.release.channel = 'nightly'
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/not one of development\/candidate\/stable/)
  })

  // The resealed cases: the digest checks are deliberately carried past so
  // the deeper guard is the one that fires -- without resealing, every one of
  // these would be reported as a digest mismatch and the guard under test
  // could be deleted without reddening anything.

  test('RESEALED empty notes reach the emptiness guard', () => {
    const { dir, evidence } = assembled()
    writeFileSync(join(dir, 'release-notes.md'), '')
    reseal(dir)
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/release notes release-notes\.md .* are empty/)
  })

  test('a RESEALED component-less SBOM reaches the vacuity guard', () => {
    const { dir, evidence } = assembled()
    writeFileSync(join(dir, 'sbom.cdx.json'), JSON.stringify({ bomFormat: 'CycloneDX', components: [] }))
    reseal(dir)
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/listing at least one component/)
  })

  test('a RESEALED non-JSON SBOM is refused as such', () => {
    const { dir, evidence } = assembled()
    writeFileSync(join(dir, 'sbom.cdx.json'), 'not json')
    reseal(dir)
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/sbom\.cdx\.json is not JSON/)
  })

  test('SHA256SUMS drifting from the manifest is the generator-is-broken refusal', () => {
    const { dir, evidence } = assembled()
    // Corrupt the content, then re-pin ONLY its own digest so the artifact
    // loop passes and the agreement check is the guard that must fire.
    writeFileSync(join(dir, 'SHA256SUMS'), `${SHA}  something-else\n`)
    repinOne(dir, 'SHA256SUMS')
    expect(() => gateReleaseDir(dir, evidence)).toThrow(/does not agree with manifest\.json/)
  })
})
