// The host half of the release contract: which built artifacts a release is
// assembled from, where the release directory is written, and the publication
// gate as a command. src/release-manifest.ts is everything below -- the seam
// mirrors bundle-cli.ts's, and like there, the identity that varies per build
// (here the git commit and dirty flag) is resolved HERE, once, and handed
// down: nothing in the assembly reads the wall clock or the repository.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { checkVersion, requireBoardEnv } from './bundle-cli.ts'
import { loadGeometry } from './geometry.ts'
import { BUILD_ENV_DIR, REPO_ROOT } from './paths.ts'
import {
  assembleRelease,
  builderImagesFrom,
  gateReleaseDir,
  RELEASE_CHANNELS,
  requireReleaseTarget,
} from './release-manifest.ts'

/** The board a release is cut for when nothing says otherwise, as in bundle-cli. */
export const DEFAULT_BOARD = 'cx3576'

const USAGE = `usage: bash build/run.sh --release assemble [VERSION] [--board B] [options]
       bash build/run.sh --release gate [--board B] [--dir DIR] [--evidence PATH]
                                       --baked-meta DIR

assemble writes the customer-facing release directory for a board -- the
flashable image and signed RAUC bundle copied in, an SBOM, a provenance
record, a license/source-offer inventory and the release notes generated
beside them, all bound by manifest.json and SHA256SUMS -- and then runs the
publication gate over the result. gate re-checks an existing directory from
scratch and refuses the first gap by name.

  VERSION               the release version string; also MOS_RELEASE_VERSION
                        (default: 0.0.0-dev)
  --board B             the board (default: ${DEFAULT_BOARD}, or MOS_BOARD)
  --channel C           ${RELEASE_CHANNELS.join('|')} (default: development)
  --profile P           the image profile the release was built at (default: dev)
  --notes PATH          the release-notes file; REQUIRED (also MOS_RELEASE_NOTES)
  --package-manifest PATH  the image's /usr/share/mos/manifest.tsv content;
                        REQUIRED (also MOS_PACKAGE_MANIFEST)
  --baked-meta DIR      the image's /usr/share/mos/meta/ directory as
                        extracted; REQUIRED for BOTH commands (also
                        MOS_BAKED_META). It is what says whether the image was
                        built with development-grade signing material, and a
                        release carrying such an image is refused on the
                        candidate and stable channels
  --image PATH          the disk image (default: _out/<board>/<board>-mos-latest.img)
  --update-bundle PATH  the RAUC bundle (default: _out/<board>/mos-<board>-latest.raucb);
                        not --bundle, which run.sh reserves for its bundle MODE
                        and refuses anywhere but first position
  --evidence PATH       the board-evidence file (default: boards/<board>/evidence.json)
  --out-dir DIR         where the release is written (default: _out/<board>/release);
                        for gate, --dir is the directory to check (same default)
`

export interface AssembleCommand {
  readonly cmd: 'assemble'
  readonly board: string
  readonly version: string
  readonly channel: string
  readonly profile: string
  readonly notes: string | undefined
  readonly packageManifest: string | undefined
  readonly image: string | undefined
  readonly bundle: string | undefined
  readonly evidence: string | undefined
  readonly bakedMeta: string | undefined
  readonly outDir: string | undefined
}

export interface GateCommand {
  readonly cmd: 'gate'
  readonly board: string
  readonly dir: string | undefined
  readonly evidence: string | undefined
  readonly bakedMeta: string | undefined
}

export type CliCommand = AssembleCommand | GateCommand

/**
 * The arguments, in bundle-cli's shape: a positional version, flags that all
 * take a value, and a refusal for anything unknown rather than a forward --
 * an unrecognised flag swallowed silently is a request answered about
 * something else.
 */
export function parseArgs(argv: readonly string[], env: Record<string, string | undefined>): CliCommand {
  const [cmd, ...rest] = argv
  if (cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    process.exit(0)
  }
  if (cmd !== 'assemble' && cmd !== 'gate') {
    throw new Error(`the release CLI needs 'assemble' or 'gate' first, got ${JSON.stringify(cmd)}\n\n${USAGE}`)
  }
  const flags = new Map<string, string>()
  let version: string | undefined
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i] as string
    if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    if (['--board', '--channel', '--profile', '--notes', '--package-manifest',
      '--image', '--update-bundle', '--evidence', '--out-dir', '--dir', '--baked-meta'].includes(a)) {
      const next = rest[i + 1]
      if (next === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`)
      if (flags.has(a)) throw new Error(`${a} was given twice; one of the two would silently lose\n\n${USAGE}`)
      flags.set(a, next)
      i += 1
      continue
    }
    if (a.startsWith('-')) throw new Error(`unknown argument ${JSON.stringify(a)}\n\n${USAGE}`)
    if (cmd === 'gate') throw new Error(`gate takes no positional argument, got ${JSON.stringify(a)}\n\n${USAGE}`)
    if (version !== undefined) throw new Error(`two version strings were given: ${version} and ${a}\n\n${USAGE}`)
    version = a
  }
  const board = flags.get('--board') ?? env.MOS_BOARD ?? DEFAULT_BOARD
  if (cmd === 'gate') {
    return {
      cmd,
      board,
      dir: flags.get('--dir'),
      evidence: flags.get('--evidence'),
      bakedMeta: flags.get('--baked-meta') ?? env.MOS_BAKED_META,
    }
  }
  return {
    cmd,
    board,
    version: checkVersion(version ?? env.MOS_RELEASE_VERSION ?? '0.0.0-dev'),
    channel: flags.get('--channel') ?? 'development',
    profile: flags.get('--profile') ?? 'dev',
    notes: flags.get('--notes') ?? env.MOS_RELEASE_NOTES,
    packageManifest: flags.get('--package-manifest') ?? env.MOS_PACKAGE_MANIFEST,
    bakedMeta: flags.get('--baked-meta') ?? env.MOS_BAKED_META,
    image: flags.get('--image'),
    bundle: flags.get('--update-bundle'),
    evidence: flags.get('--evidence'),
    outDir: flags.get('--out-dir'),
  }
}

/**
 * The two inputs that have no built default, refused by name before any file
 * is read. Release notes are written by a person and the package manifest is
 * extracted from the image; neither has a path this CLI could invent without
 * the refusal for its absence landing on the wrong file.
 */
export function requireSupplied(value: string | undefined, flag: string, envName: string, why: string): string {
  if (value === undefined || value === '') {
    throw new Error(`no ${flag} was supplied (and ${envName} is unset); ${why}`)
  }
  return value
}

/** boards/<board>/evidence.json -- the default seam the gate consumes. */
export function defaultEvidencePath(board: string): string {
  return join(REPO_ROOT, 'boards', board, 'evidence.json')
}

/** _out/<board>/release -- where a board's release directory is assembled. */
export function defaultReleaseDir(board: string): string {
  return join(REPO_ROOT, '_out', board, 'release')
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv, process.env)
  const boardEnv = requireBoardEnv(options.board)
  // BEFORE either subcommand, and before any path is resolved: a board with
  // no release path has no release directory to assemble and none to gate,
  // and the refusal should name that rather than surface as a missing
  // evidence file three steps later.
  requireReleaseTarget(options.board, loadGeometry(options.board).board.releaseTarget, boardEnv)

  if (options.cmd === 'gate') {
    const dir = options.dir ?? defaultReleaseDir(options.board)
    const bakedMeta = requireSupplied(options.bakedMeta, '--baked-meta', 'MOS_BAKED_META',
      'the grade of an image\'s signing material is measured from its own baked /usr/share/mos/meta/, '
      + 'and a gate that read the build host instead would answer green on every host that never built one')
    const report = gateReleaseDir(dir, options.evidence ?? defaultEvidencePath(options.board), bakedMeta)
    const m = report.manifest
    console.log(`release gate: PASS ${dir}`)
    console.log(
      `  ${m.release.version} (${m.release.channel}) for ${m.board.name}/${m.board.profile}, `
      + `source ${m.source.commit}${m.source.dirty ? ' (dirty)' : ''}`,
    )
    console.log(`  boot assurance ${m.bootAssurance}, evidence: ${report.evidence.qualification}`)
    console.log(
      `  trust ${m.trust.grade}`
      + `${m.trust.developmentDomains.length > 0 ? ` (development in ${m.trust.developmentDomains.join(' ')})` : ''}`
      + `, measured from ${bakedMeta}`,
    )
    console.log(`  ${report.artifactsChecked} artifacts, ${report.bytesTotal} bytes, every digest re-measured`)
    return 0
  }

  const notes = requireSupplied(options.notes, '--notes', 'MOS_RELEASE_NOTES',
    'a release without release notes is refused by the publication gate, so it is refused here first')
  const packageManifest = requireSupplied(options.packageManifest, '--package-manifest', 'MOS_PACKAGE_MANIFEST',
    'the SBOM is derived from the image\'s /usr/share/mos/manifest.tsv and never invented')
  const bakedMeta = requireSupplied(options.bakedMeta, '--baked-meta', 'MOS_BAKED_META',
    'the release records the grade of the signing material its image was built from, and that is '
    + 'measured from the image\'s own /usr/share/mos/meta/ rather than declared')

  // The image and bundle defaults come from the board definition, the same
  // names the assemblers point their -latest symlinks at.
  const geometry = loadGeometry(options.board)
  const outBoard = join(REPO_ROOT, '_out', options.board)
  const imagePath = options.image ?? join(outBoard, geometry.naming.latestName)
  const bundlePath = options.bundle ?? join(outBoard, `mos-${geometry.require('LAYOUT_BOARD')}-latest.raucb`)

  // The source identity, resolved once. No fallback: a release manifest with
  // an invented commit is an identity a support case cannot resolve, which is
  // build-env/deb/version.sh's reasoning and it holds harder here.
  const commitR = await $`git -C ${REPO_ROOT} rev-parse HEAD`.nothrow().quiet()
  if (commitR.exitCode !== 0) {
    throw new Error(
      `git rev-parse HEAD failed in ${REPO_ROOT} (exit ${commitR.exitCode}); a release manifest `
      + `without a source commit is an identity nothing can resolve later, so there is no fallback`,
    )
  }
  const commit = commitR.stdout.toString().trim()
  const statusR = await $`git -C ${REPO_ROOT} status --porcelain`.nothrow().quiet()
  if (statusR.exitCode !== 0) {
    throw new Error(`git status --porcelain failed in ${REPO_ROOT} (exit ${statusR.exitCode})`)
  }
  const dirty = statusR.stdout.toString().trim() !== ''

  const imagesEnv = join(BUILD_ENV_DIR, 'images.env')
  const builderImages = existsSync(imagesEnv) ? builderImagesFrom(readFileSync(imagesEnv, 'utf8')) : {}

  const evidencePath = options.evidence ?? defaultEvidencePath(options.board)
  const result = assembleRelease({
    board: options.board,
    profile: options.profile,
    channel: options.channel,
    version: options.version,
    imagePath,
    bundlePath,
    packageManifestPath: packageManifest,
    bakedMetaDir: bakedMeta,
    notesPath: notes,
    evidencePath,
    outDir: options.outDir ?? defaultReleaseDir(options.board),
    commit,
    dirty,
    builderImages,
  })
  const m = result.gate.manifest
  console.log(`assembled ${result.outDir}`)
  console.log(
    `  ${m.release.version} (${m.release.channel}) for ${m.board.name}/${m.board.profile}, `
    + `source ${m.source.commit}${m.source.dirty ? ' (dirty)' : ''}`,
  )
  console.log(
    `  trust ${m.trust.grade}`
    + `${m.trust.developmentDomains.length > 0 ? ` (development in ${m.trust.developmentDomains.join(' ')})` : ''}`
    + `, measured from ${bakedMeta}`,
  )
  console.log(`  ${result.gate.artifactsChecked} artifacts, ${result.gate.bytesTotal} bytes; the publication gate re-checked the directory`)
  return 0
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)))
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
