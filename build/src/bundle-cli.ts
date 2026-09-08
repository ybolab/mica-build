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
// material: caller-supplied CERT/KEY/KEYRING win, meta/rauc/ is the default,
// and all three are resolved and checked here so the failure names the file
// that is missing -- an unset trio with no meta/rauc/ means `make os-devkeys`,
// a caller-supplied path that does not exist is the caller's typo. An unset
// trio normally cannot fail at all, because a missing meta/ is generated first;
// the refusal stays because the generator can be bypassed, not because nobody
// runs it. And the host's architecture, not the board's: the rauc writing the
// bundle is a host binary while the image bundled for may be foreign, and both
// come from pkgs/rauc/versions.env, which makes their versions comparable.

import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { arch as osArch } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  buildBundle,
  GEN_TRUST_ROOT_SH,
  RAUC_KEY_DIR,
  RENDER_CONFIG_SH,
  ROOTFS_PRODUCER,
  SYSTEM_CONF,
} from './bundle.ts'
import { loadGeometry } from './geometry.ts'
import { boardEnvPath, REPO_ROOT } from './paths.ts'
import { shippedRaucPath } from './toolsets.ts'

/** The board a bundle is built for when nothing says otherwise, as in the shell. */
export const DEFAULT_BOARD = 'cx3576'

const USAGE = `usage: bash build/run.sh --bundle [VERSION] [--board B] [--out-dir DIR]

Builds the signed RAUC update bundle. Every input comes from _out/<board>/:
the verity image and the per-slot cmdlines the rootfs build wrote, and
_out/<board>/boot/, where that same build exported this board's kernel -- plus
its device tree and boot.cmd on a U-Boot board -- out of the packed root. There
is no --bsp-out: since PLAN-086 S2 the bundle reads no BSP artefact directly,
which is what stops it and the flashed image shipping different kernels.

  VERSION          the bundle version string; also MOS_BUNDLE_VERSION
                   (default: 0.0.0-dev)
  --board B        the board to bundle for (default: ${DEFAULT_BOARD}, or MOS_BOARD)
  --out-dir DIR    where the rootfs build's outputs are and the bundle is written
                   (default: _out/<board>)

environment:
  CERT KEY KEYRING     real signing material, instead of meta/rauc/
  MOS_BUILD_TOOLBOX    container -- the only route there is; host is refused by name
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
 * Whether this build must make sure meta/rauc/ holds a trust root.
 *
 * False only when the caller named all three paths: explicit material beats the
 * convention, and generating anyway would write an unprotected CA into the tree
 * of a build that was pointed at an HSM -- and leave meta/GENERATED behind to
 * mark every later image development-grade. A PARTIAL trio still needs
 * meta/rauc/, because the files the caller did not name come from there.
 *
 * `?? undefined` and not a truthiness test, so this agrees with
 * resolveSigningMaterial about what "supplied" means: `CERT=` reaches
 * process.env as the empty string and both treat it as the caller's answer, so
 * the refusal names an empty path -- a typo -- rather than a missing trust root.
 */
export function needsGeneratedTrustRoot(env: Record<string, string | undefined>): boolean {
  return env.CERT === undefined || env.KEY === undefined || env.KEYRING === undefined
}

/**
 * CERT/KEY/KEYRING, resolved and checked before anything runs.
 *
 * The two failures get different sentences, and the difference is the whole
 * point: a path under meta/rauc/ is missing because generation was bypassed and
 * nobody has run `make os-devkeys` either, and a path from the environment is
 * missing because the caller mistyped it. One sentence for both would send half
 * the readers to the wrong place.
 */
export function resolveSigningMaterial(
  env: Record<string, string | undefined>,
  keyDir: string = RAUC_KEY_DIR,
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
        ? `The build generates a development trust root in ${keyDir} when it finds none, so this `
          + `file is missing only if that was bypassed: run 'make os-devkeys', or put production `
          + `material in ${keyDir}, or set CERT/KEY/KEYRING to real ones (caller-supplied values `
          + `are honoured on both the host and the container path).`
        : `CERT/KEY/KEYRING were supplied from the environment but this file does not exist.`),
    )
  }
  return material
}

/**
 * The build HOST's architecture, in the spelling pkgs/rauc/ builds for.
 *
 * A parameter rather than a call to os.arch(), so the refusal is REACHABLE:
 * every machine this campaign runs on is one of the two, and a guard that can
 * only fire on hardware nobody has is a guard nobody has run.
 */
export function hostArchFor(machine: string): string {
  if (machine === 'x64' || machine === 'x86_64') return 'amd64'
  if (machine === 'arm64' || machine === 'aarch64') return 'arm64'
  throw new Error(
    `unsupported build host architecture ${machine}; pkgs/rauc/ builds amd64 and arm64`,
  )
}

/**
 * The rauc this tree built for the build host, refusing its absence by name.
 *
 * Not "rauc is missing" -- RAUC is built from source here rather than installed
 * from Debian, and pkgs/rauc/versions.env records why: the distribution
 * builds it with streaming on, which links libcurl-gnutls and drags GnuTLS,
 * p11-kit, GMP, Nettle and Kerberos into a signed image for an install path
 * this project defers.
 */
export function requireHostRauc(arch: string, exists: (p: string) => boolean = existsSync): string {
  const bin = shippedRaucPath(arch)
  if (!exists(bin)) {
    throw new Error(
      `${bin} not found. RAUC is built from source now, not installed from Debian `
      + `(pkgs/rauc/versions.env says why); build it with 'MOS_BOARD=x64 bash `
      + `pkgs/rauc/build.sh' for an amd64 host, or 'make os-rauc' for the board's own arch`,
    )
  }
  return bin
}

export interface RequiredInputs {
  /** Written by the rootfs build itself; the message names it. */
  readonly rootfsSide: readonly string[]
  /**
   * Exported by the rootfs build OUT OF the packed root; a different message.
   *
   * Since PLAN-086 S2 no boot input is read from `BSP_OUT` here. The blobs
   * reach the assembler through the board and kernel packages and out again
   * through `rootfs/scripts/pack-export-boot.sh`, so the same command produces
   * both families and the distinction is no longer "which command do I run" but
   * "which half of it did not produce this" -- a missing verity image means the
   * composition failed, and a missing `boot/Image` means the package that is
   * supposed to carry it did not.
   */
  readonly bootExport: readonly string[]
}

/**
 * Every input that must exist, split by WHERE the rootfs build put it.
 */
export function checkRequiredInputs(
  inputs: RequiredInputs,
  board: string,
  exists: (p: string) => boolean = existsSync,
): void {
  for (const input of inputs.rootfsSide) {
    if (!exists(input)) {
      throw new Error(`${input} not found; run 'MOS_BOARD=${board} bash ${ROOTFS_PRODUCER}' first`)
    }
  }
  for (const input of inputs.bootExport) {
    if (!exists(input)) {
      throw new Error(
        `${input} not found; it is exported out of the packed root by `
        + `'MOS_BOARD=${board} bash ${ROOTFS_PRODUCER}', which takes it from the installed board `
        + `and kernel packages. An export missing a file means a package did not carry it`,
      )
    }
  }
}

export interface CliOptions {
  readonly board: string
  readonly version: string
  readonly outDir: string
}

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined>): CliOptions {
  const board = env.MOS_BOARD ?? DEFAULT_BOARD
  let version: string | undefined
  let outDir: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    if (a === '--board' || a === '--out-dir') {
      if (next === undefined) throw new Error(`${a} needs a value\n\n${USAGE}`)
      if (a === '--out-dir') outDir = next
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

  // The trust root enters the build HERE, from meta/rauc/ and nowhere else. A
  // tree that has none gets a development-grade one and a loud notice rather
  // than a refusal: the build proceeds, and meta/GENERATED keeps the result
  // marked.
  // Left as a subprocess -- gen-dev-keys.sh owns that directory, and it alone
  // decides which files must be there.
  if (needsGeneratedTrustRoot(process.env)) {
    const gen = await $`bash ${GEN_TRUST_ROOT_SH} --if-absent`.nothrow()
    if (gen.exitCode !== 0) return gen.exitCode
  }
  const signing = resolveSigningMaterial(process.env)

  const outDir = options.outDir
  const rootfsVerityImg = join(outDir, 'rootfs-verity.img')
  const rootfsVerityEnv = join(outDir, 'rootfs-verity.env')
  const bootCmdlineA = join(outDir, 'boot-cmdline-a.txt')
  const bootCmdlineB = join(outDir, 'boot-cmdline-b.txt')

  // ONE BOOT EXPORT, READ BY BOTH ASSEMBLERS (PLAN-086 S2). What a board's boot
  // payload IS is still a board fact -- cx3576's is an Image plus a device tree
  // and a UEFI board's is a single vmlinuz -- but where the bundle reads it from
  // no longer is: `_out/<board>/boot/` is what rootfs/scripts/pack-export-boot.sh
  // wrote out of the packed root, and build/src/mkimage-cx3576-cli.ts reads the
  // same directory. That is what makes it impossible for the bundle and the
  // flashed image to ship different kernels for one build, and cx3576 is the
  // half that used to reach past it into BSP_OUT.
  const uboot = geometry.bootloader === 'uboot'
  const bootExport = join(outDir, 'boot')
  const kernelImage = join(bootExport, uboot ? 'Image' : 'vmlinuz')
  const dtb = uboot ? join(bootExport, 'rk3576-src.dtb') : undefined
  const bootCmd = uboot ? join(bootExport, 'boot.cmd') : undefined

  checkRequiredInputs({
    rootfsSide: uboot
      ? [rootfsVerityImg, rootfsVerityEnv, bootCmdlineA, bootCmdlineB]
      : [rootfsVerityImg, rootfsVerityEnv],
    bootExport: uboot ? [kernelImage, dtb!, bootCmd!] : [kernelImage],
  }, options.board)

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
    bootCmd,
    rootfsVerityImg,
    rootfsVerityEnv,
    rootfsReport: join(outDir, 'rootfs-report.txt'),
    raucBuildEnv: join(REPO_ROOT, 'pkgs', 'rauc', `out-${arch}`, 'RAUC_VERSION.env'),
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
