// The host half of the bundle contract: where the inputs are, which signing
// material is used, what the output is called, and the -latest symlink.
//
// The seam is structural: epoch naming and the -latest symlink happen here,
// src/bundle.ts is everything below them, and nothing re-execs -- buildBundle
// runs in-process and the toolbox decides, per toolset, whether the tools run
// here or in the pinned container. The epoch in the filename is the only
// per-build variation and is computed here, once: bundle content must not
// depend on when it was built, which is what makes the rebuild gate a hash.
//
// Two things this file resolves that the build half only uses. The signing
// material: caller-supplied CERT/KEY/KEYRING win, the dev keys are the default,
// and all three are resolved and checked here so the failure names the file
// that is missing -- an unset trio with no devkeys means `make os-devkeys`, a
// caller-supplied path that does not exist is the caller's typo. And the host's
// architecture, not the board's: the rauc writing the bundle is a host binary
// while the image bundled for may be foreign, and both come from
// os/pkgs/rauc/versions.env, which makes their versions comparable.

import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { arch as osArch } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  buildBundle,
  DEVKEY_DIR,
  RENDER_CONFIG_SH,
  ROOTFS_PRODUCER,
  SYSTEM_CONF,
} from './bundle.ts'
import { loadGeometry } from './geometry.ts'
import { boardEnvPath, OS_DIR, REPO_ROOT } from './paths.ts'
import { shippedRaucPath } from './toolsets.ts'

/** The board a bundle is built for when nothing says otherwise, as in the shell. */
export const DEFAULT_BOARD = 'cx3576'

const USAGE = `usage: bash os/build/run.sh --bundle [VERSION] [--board B] [--out-dir DIR] [--board-dir DIR]

Builds the signed RAUC update bundle. Inputs come from _out/<board>/ and
os/boards/<board>/bsp/out/.

  VERSION          the bundle version string; also MOS_BUNDLE_VERSION
                   (default: 0.0.0-dev)
  --board B        the board to bundle for (default: ${DEFAULT_BOARD}, or MOS_BOARD)
  --out-dir DIR    where the rootfs-side inputs are and the bundle is written
                   (default: _out/<board>)
  --board-dir DIR  the BSP tree (default: os/boards/<board>/bsp, or BOARD_DIR)

environment:
  CERT KEY KEYRING     real signing material, instead of os/pkgs/rauc/.devkeys
  MOS_BUILD_TOOLBOX    host|container -- force the route the tools run on
`

/**
 * A version string that is a version string.
 *
 * It reaches the manifest by substitution and the filename by concatenation,
 * so the characters it may contain are the ones that are safe in both. The
 * shell's regex, unchanged.
 */
export function checkVersion(version: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) {
    throw new Error(`version '${version}' is not a plain version string`)
  }
  return version
}

/**
 * The compatible string out of the rendered system.conf.
 *
 * `sed -n 's/^compatible=//p'` with NO `tail -n1`, so a file declaring it twice
 * yields both joined by a newline -- which then goes into the manifest and is
 * compared against what rauc reads back out of the bundle. Transcribed rather
 * than tidied for the reason raucVersionInBuildEnv gives.
 */
export function compatibleFrom(text: string): string {
  return text.split('\n').filter(l => l.startsWith('compatible=')).map(l => l.slice('compatible='.length)).join('\n')
}

/**
 * The compatible string, refusing a system.conf that declares none.
 *
 * An empty compatible would render a manifest whose `compatible=` line is
 * empty, and rauc would then refuse the bundle on the device -- after it was
 * signed. It is the bundle's whole claim about which hardware it is for.
 */
export function requireCompatible(text: string, path: string): string {
  const compatible = compatibleFrom(text)
  if (compatible === '') throw new Error(`no compatible= in ${path}`)
  return compatible
}

/**
 * The board definition, refused by name rather than by ENOENT.
 *
 * `MOS_BOARD=cx3567` is a typo away from a working invocation and the file it
 * would read is derived from it, so the sentence has to carry both -- the
 * shell's does. Left to readFileSync the reader gets "ENOENT: no such file or
 * directory, open '.../boards/cx3567/board.env'", which names the path and not
 * the mistake, and which no reader of `make os-bundle-<board>` asked a question
 * about a path.
 */
export function requireBoardEnv(board: string, exists: (p: string) => boolean = existsSync): string {
  const path = boardEnvPath(board)
  if (!exists(path)) throw new Error(`${path} not found (MOS_BOARD=${board})`)
  return path
}

export interface SigningMaterial {
  readonly cert: string
  readonly key: string
  readonly keyring: string
}

/**
 * CERT/KEY/KEYRING, resolved and checked before anything runs.
 *
 * The two failures get different sentences, and the difference is the whole
 * point: a path under the devkey directory is missing because nobody has run
 * `make os-devkeys`, and a path from the environment is missing because the
 * caller mistyped it. One sentence for both would send half the readers to the
 * wrong place.
 */
export function resolveSigningMaterial(
  env: Record<string, string | undefined>,
  keyDir: string = DEVKEY_DIR,
  exists: (p: string) => boolean = existsSync,
): SigningMaterial {
  const material: SigningMaterial = {
    cert: env.CERT ?? join(keyDir, 'signer.cert.pem'),
    key: env.KEY ?? join(keyDir, 'signer.key.pem'),
    keyring: env.KEYRING ?? join(keyDir, 'ca.cert.pem'),
  }
  for (const file of [material.cert, material.key, material.keyring]) {
    if (exists(file)) continue
    const fromKeyDir = file.startsWith(`${keyDir}/`)
    throw new Error(
      `signing material not found: ${file}\n`
      + (fromKeyDir
        ? `Generate development keys with 'make os-devkeys', or set CERT/KEY/KEYRING to real ones `
          + `(caller-supplied values are honoured on both the host and the container path).`
        : `CERT/KEY/KEYRING were supplied from the environment but this file does not exist.`),
    )
  }
  return material
}

/**
 * The build HOST's architecture, in the spelling os/pkgs/rauc/ builds for.
 *
 * A parameter rather than a call to os.arch(), so the refusal is REACHABLE:
 * every machine this campaign runs on is one of the two, and a guard that can
 * only fire on hardware nobody has is a guard nobody has run.
 */
export function hostArchFor(machine: string): string {
  if (machine === 'x64' || machine === 'x86_64') return 'amd64'
  if (machine === 'arm64' || machine === 'aarch64') return 'arm64'
  throw new Error(
    `unsupported build host architecture ${machine}; os/pkgs/rauc/ builds amd64 and arm64`,
  )
}

/**
 * The rauc this tree built for the build host, refusing its absence by name.
 *
 * Not "rauc is missing" -- RAUC is built from source here rather than installed
 * from Debian, and os/pkgs/rauc/versions.env records why: the distribution
 * builds it with streaming on, which links libcurl-gnutls and drags GnuTLS,
 * p11-kit, GMP, Nettle and Kerberos into a signed image for an install path
 * this project defers.
 */
export function requireHostRauc(arch: string, exists: (p: string) => boolean = existsSync): string {
  const bin = shippedRaucPath(arch)
  if (!exists(bin)) {
    throw new Error(
      `${bin} not found. RAUC is built from source now, not installed from Debian `
      + `(os/pkgs/rauc/versions.env says why); build it with 'MOS_BOARD=x64 bash `
      + `os/pkgs/rauc/build.sh' for an amd64 host, or 'make os-rauc' for the board's own arch`,
    )
  }
  return bin
}

export interface RequiredInputs {
  /** Produced by the rootfs build; the message names it. */
  readonly rootfsSide: readonly string[]
  /** Produced by a BSP build, or found through BOARD_DIR; a different message. */
  readonly boardSide: readonly string[]
}

/**
 * Every input that must exist, split by WHO produces it.
 *
 * The two families get different sentences in the shell and keep them here:
 * one is made by a script you can run, the other by a BSP build or a BOARD_DIR
 * pointed somewhere else.
 */
export function checkRequiredInputs(
  inputs: RequiredInputs,
  board: string,
  boardDir: string,
  exists: (p: string) => boolean = existsSync,
): void {
  for (const input of inputs.rootfsSide) {
    if (!exists(input)) {
      throw new Error(`${input} not found; run 'MOS_BOARD=${board} bash ${ROOTFS_PRODUCER}' first`)
    }
  }
  for (const input of inputs.boardSide) {
    if (!exists(input)) {
      throw new Error(`${input} not found; build the BSP or set BOARD_DIR (currently: ${boardDir})`)
    }
  }
}

export interface CliOptions {
  readonly board: string
  readonly version: string
  readonly outDir: string
  readonly boardDir: string
}

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined>): CliOptions {
  const board = env.MOS_BOARD ?? DEFAULT_BOARD
  let version: string | undefined
  let outDir: string | undefined
  let boardDir: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    if (a === '--board' || a === '--out-dir' || a === '--board-dir') {
      if (next === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`)
      if (a === '--out-dir') outDir = next
      else if (a === '--board-dir') boardDir = next
      i += 1
      continue
    }
    if (a !== undefined && a.startsWith('-')) throw new Error(`unknown argument ${JSON.stringify(a)}\n\n${USAGE}`)
    if (version !== undefined) throw new Error(`two version strings were given: ${version} and ${a}\n\n${USAGE}`)
    version = a
  }
  // MOS_BOARD is the shell's only channel for this; --board is added so a test
  // can drive the grub branch without setting a variable for the whole process.
  // An explicit flag wins over the environment, which is the usual precedence.
  const chosen = boardFromArgv(argv) ?? board
  return {
    board: chosen,
    version: checkVersion(version ?? env.MOS_BUNDLE_VERSION ?? '0.0.0-dev'),
    outDir: outDir ?? join(REPO_ROOT, '_out', chosen),
    boardDir: boardDir ?? env.BOARD_DIR ?? join(REPO_ROOT, 'os', 'boards', chosen, 'bsp'),
  }
}

function boardFromArgv(argv: readonly string[]): string | undefined {
  const i = argv.indexOf('--board')
  return i === -1 ? undefined : argv[i + 1]
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv, process.env)
  requireBoardEnv(options.board)
  const geometry = loadGeometry(options.board)

  // The shipped slot configuration must be current before anything is signed
  // against it: a stale system.conf means the bundle's compatible string or the
  // slot GUIDs do not describe the devices in the field. Left as a subprocess
  // -- render-config.sh owns that file.
  const check = await $`bash ${RENDER_CONFIG_SH} --check`
    .env({ ...process.env, MOS_BOARD: options.board })
    .nothrow()
  if (check.exitCode !== 0) return check.exitCode

  const compatible = requireCompatible(readFileSync(SYSTEM_CONF, 'utf8'), SYSTEM_CONF)
  const signing = resolveSigningMaterial(process.env)

  const outDir = options.outDir
  const rootfsVerityImg = join(outDir, 'rootfs-verity.img')
  const rootfsVerityEnv = join(outDir, 'rootfs-verity.env')
  const bootCmdlineA = join(outDir, 'boot-cmdline-a.txt')
  const bootCmdlineB = join(outDir, 'boot-cmdline-b.txt')

  // Where the kernel comes from is a BOARD FACT. A BSP board builds its own and
  // the bundle takes it from BOARD_DIR; a Debian-kernel board takes the one the
  // rootfs build already extracted into _out, which is also the one the image
  // assembler put on the ESP -- so the bundle and the flashed image cannot ship
  // different kernels for the same build.
  const uboot = geometry.bootloader === 'uboot'
  const kernelImage = uboot
    ? join(options.boardDir, 'out', 'kernel', 'Image')
    : join(outDir, 'boot', 'vmlinuz')
  const dtb = uboot ? join(options.boardDir, 'out', 'kernel', 'rk3576-src.dtb') : undefined
  const initrdImage = uboot ? undefined : join(outDir, 'boot', 'initrd.img')

  checkRequiredInputs({
    rootfsSide: uboot
      ? [rootfsVerityImg, rootfsVerityEnv, bootCmdlineA, bootCmdlineB]
      : [rootfsVerityImg, rootfsVerityEnv, kernelImage, initrdImage!],
    boardSide: uboot ? [kernelImage, dtb!] : [],
  }, options.board, options.boardDir)

  const arch = hostArchFor(osArch())
  const raucBin = requireHostRauc(arch)

  mkdirSync(outDir, { recursive: true })
  const layoutBoard = geometry.require('LAYOUT_BOARD')
  const bundleName = `mos-${layoutBoard}-${Math.floor(Date.now() / 1000)}.raucb`
  const bundleLatest = `mos-${layoutBoard}-latest.raucb`

  await buildBundle({
    board: options.board,
    kernelImage,
    dtb,
    initrdImage,
    rootfsVerityImg,
    rootfsVerityEnv,
    rootfsReport: join(outDir, 'rootfs-report-v2.txt'),
    raucBuildEnv: join(OS_DIR, 'pkgs', 'rauc', `out-${arch}`, 'RAUC_VERSION.env'),
    bootCmdlineA: uboot ? bootCmdlineA : undefined,
    bootCmdlineB: uboot ? bootCmdlineB : undefined,
    cert: signing.cert,
    key: signing.key,
    keyring: signing.keyring,
    bundleOut: join(outDir, bundleName),
    bundleVersion: options.version,
    bundleCompatible: compatible,
    raucBin,
    hostArch: arch,
  }, { geometry })

  const latest = join(outDir, bundleLatest)
  // `ln -sfn`: replace, do not follow. lstat rather than exists, because the
  // link this replaces points at the PREVIOUS bundle and a dangling one -- the
  // shape a cleaned _out/ leaves -- is invisible to a followed stat while still
  // making symlink() fail with EEXIST.
  if (lstatSync(latest, { throwIfNoEntry: false }) !== undefined) unlinkSync(latest)
  symlinkSync(bundleName, latest)
  console.log(`built ${join(outDir, bundleName)} (${bundleLatest} -> ${bundleName})`)
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
