// Signed RAUC update-bundle builder.
//
// One bundle carries one image per slot class of the RAUC slot group --
// `rootfs.img`, the raw squashfs+dm-verity slot image, and `boot.vfat`, the
// filesystem written raw into whichever boot slot is inactive -- rendered
// against pkgs/rauc/manifest.raucm.in and signed with the development key
// unless CERT/KEY/KEYRING name real material.
//
// The epoch is in the filename only. Bundle content is a function of the inputs
// and the version string, never of the wall clock, which is what makes the
// rebuild gate a hash: payloadReport measures it over the payload -- the
// squashfs at the head -- because the bytes after it are deliberately not
// stable, rauc salting the bundle's own verity hash tree at random and the CMS
// signature carrying a signingTime attribute.

import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BOOT_DIGEST_ARTEFACTS, bootDigestEnv, checkBootAttempts, verityCmdlineFields, verityEnvBase } from './boot-cx3576.ts'
import { loadGeometry, type Geometry } from './geometry.ts'
import { BOARDS_DIR, makeWorkDir, REPO_ROOT } from './paths.ts'
import { Toolbox } from './toolbox.ts'
import { bundleToolset, shippedRaucPath } from './toolsets.ts'
import { truncate } from './tools/dd.ts'
import { makeBootScript } from './tools/mkimage.ts'
import { mcopy, mkfsVfat } from './tools/mtools.ts'
import { bundle as raucBundle, info as raucInfo } from './tools/rauc.ts'

// Reproducibility and payload invariants:
//
//   * The mcopy order. `Image rk3576-src.dtb boot.scr mos-boot-digest.env
//     mos-verity-a.env mos-verity-b.env` is the order the shell hands them over
//     and therefore the order they land in the FAT directory. It is a
//     written-out list in both places, not a glob, so it is transcribed as a
//     list.
//   * No `-i` on mkfs.vfat and no slot label: "one image, two possible
//     destinations", so a bundle's boot payload, installed into whichever slot
//     is inactive, must not carry that slot's FAT identity.
//     BUNDLE_BOOT_FAT_LABEL is the neutral `BOOT` and `--invariant` keeps the
//     volume id off the wall clock.
//   * Every staged file touched to FILE_MTIME before mcopy, because `mcopy -m`
//     takes each entry's mtime from its source.
//   * rauc's `--mksquashfs-args`, verbatim. rauc drives mksquashfs itself and
//     without them stamps the payload with the wall clock, the build
//     container's uid map and a thread count.
//
// One deliberate extra refusal protects against a vacuous pass. The earlier
// implementation read the boot-attempt credits through
//
//     done < <(grep -oE 'BOOT_[AB]_LEFT [0-9]+' "${BOOT_CMD}" | awk '{print $2}')
//
// so with the file missing, or carrying no credit at all, grep produces no
// stdout, the loop body never runs and the range guard passes by finding
// nothing. requireBootAttempts refuses an empty read by name. It can only turn
// a vacuous pass into a refusal, and today's boards/cx3576/boot.cmd declares
// four credits, so it changes nothing about the bytes. In the cx3576 assembler,
// the same guard is covered by accident -- checkBootCmdTokens runs next and
// refuses a boot.cmd with no `rauc.slot=` in it -- while the bundle path has no such
// second guard, so it is the one path where the hole is reachable.

/**
 * The producer of the rootfs-side inputs, named in every message about one.
 *
 * "rootfs-verity.env carries no VERITY_ROOT_HASH" is only actionable once you
 * know what writes it.
 */
export const ROOTFS_PRODUCER = 'rootfs/build.sh'

/**
 * The FAT label a bundle's boot payload carries, and why it is not a slot's.
 *
 * The payload is written into whichever boot slot is inactive, so it cannot
 * carry that slot's identity: one image, two possible destinations. A neutral
 * label is correct rather than sloppy -- nothing reads it. boot.scr addresses
 * its slot as `mmc 0:${bootpart}`, a GPT partition number out of BOOT_ORDER,
 * and no fstab entry mounts a boot slot.
 */
export const BUNDLE_BOOT_FAT_LABEL = 'BOOT'

/** pkgs/rauc/manifest.raucm.in. */
export const MANIFEST_IN: string = join(REPO_ROOT, 'pkgs', 'rauc', 'manifest.raucm.in')

/** The system.conf the image actually ships -- rendered, not committed. */
export const SYSTEM_CONF: string = join(REPO_ROOT, 'rootfs', 'overlay', 'etc', 'rauc', 'system.conf')

/**
 * `meta/rauc/` -- the one place a trust root enters a build.
 *
 * Gitignored, and holding either production material an operator put there or
 * a development-grade one pkgs/rauc/gen-dev-keys.sh generated. Which of the
 * two it is is not guessed from the bytes: the generator leaves meta/GENERATED
 * beside them and that marker is what every later reader keys off.
 *
 * It is a subdirectory of `meta/` and not a directory beside it, because
 * `meta/` is now gitignored, generated when absent and full of private keys --
 * so a second directory with those same properties would have no rule saying
 * which one a file goes in.
 */
export const RAUC_KEY_DIR: string = join(REPO_ROOT, 'meta', 'rauc')

/** pkgs/rauc/gen-dev-keys.sh, which owns what RAUC_KEY_DIR contains. */
export const GEN_TRUST_ROOT_SH: string = join(REPO_ROOT, 'pkgs', 'rauc', 'gen-dev-keys.sh')

/** pkgs/rauc/render-config.sh, which owns the shipped slot configuration. */
export const RENDER_CONFIG_SH: string = join(REPO_ROOT, 'pkgs', 'rauc', 'render-config.sh')

// The readers, each exactly as blunt as the shell's.

/**
 * One KEY=value out of a plain env-style file, without executing it.
 *
 * `sed -n "s/^KEY=//p" file | tail -n1` -- the last assignment wins, and a key
 * that is not there yields the empty string rather than an absence. Both
 * matter: a file that assigns a key twice is answered the way the shell
 * answers it, and every caller here refuses the empty string explicitly rather
 * than letting `undefined` compare its own way.
 */
export function envFileGet(text: string, key: string): string {
  const hits = text.split('\n').filter(l => l.startsWith(`${key}=`)).map(l => l.slice(key.length + 1))
  return hits[hits.length - 1] ?? ''
}

/**
 * The RAUC version rootfs/build.sh recorded in the rootfs report.
 *
 * `sed -n 's/^RAUC_VERSION //p' | tail -n1` -- space-separated there, because
 * the report is a two-column list and not an env file. The `=` form belongs to
 * the build env; they are different files with different shapes and reading
 * either with the other's separator finds nothing, which is exactly the
 * failure mode this comparison exists to make impossible.
 */
export function raucVersionInReport(text: string): string {
  const hits = text.split('\n').filter(l => l.startsWith('RAUC_VERSION ')).map(l => l.slice('RAUC_VERSION '.length))
  return hits[hits.length - 1] ?? ''
}

/**
 * The RAUC version pkgs/rauc/build.sh recorded beside the binary.
 *
 * `sed -n 's/^RAUC_VERSION=//p'` with NO `tail -n1`, so a file assigning it
 * twice yields both lines joined -- which then compares unequal to the report
 * and refuses. Transcribed rather than tidied: quietly taking the last one
 * would turn a malformed build env into a pass.
 */
export function raucVersionInBuildEnv(text: string): string {
  return text.split('\n').filter(l => l.startsWith('RAUC_VERSION=')).map(l => l.slice('RAUC_VERSION='.length)).join('\n')
}

export interface RaucMatchInputs {
  /** The rootfs report path, for the message. */
  readonly reportPath: string
  /** Its content, or undefined when the file is not there. */
  readonly reportText: string | undefined
  /** RAUC_BUILD_ENV's path, or undefined when the caller was given none. */
  readonly buildEnvPath: string | undefined
  /** Its content, or undefined when the file is not there or could not be read. */
  readonly buildEnvText: string | undefined
}

/**
 * The rauc that builds a bundle MUST be the rauc that installs it. A bundle
 * built in a bookworm container (rauc 1.8) and installed by an image's Debian
 * 13 rauc (1.13) fails: 1.8 refuses the x64 slot model outright the first time
 * it is asked to read it. Both halves come from pkgs/rauc/, so agreeing is
 * normal -- but they are built at different times, and an image flashed before
 * a version bump with a bundle built after it is the case nothing else notices.
 * Three of the four refusals are about the comparison itself rather than a
 * mismatch: a missing report, a report with no version in it and a build env
 * with no version in it would each make it pass by finding nothing, which is
 * the same green as agreement.
 *
 * @returns the line the shell echoes on success, so a caller can print it.
 */
export function assertRaucMatchesImage(inputs: RaucMatchInputs): string {
  if (inputs.reportText === undefined) {
    throw new Error(
      `${inputs.reportPath} not found; the image's RAUC version is unknown and a bundle built by an `
      + `unknown-matching rauc is not one this can vouch for. Run the rootfs build first`,
    )
  }
  const want = raucVersionInReport(inputs.reportText)
  const have = raucVersionInBuildEnv(inputs.buildEnvText ?? '')
  if (want === '') {
    throw new Error(
      `${inputs.reportPath} records no RAUC_VERSION. It predates the check, or the rootfs build `
      + `stopped emitting it -- either way the comparison would pass by finding nothing`,
    )
  }
  if (have === '') {
    throw new Error(
      `no RAUC_VERSION from ${inputs.buildEnvPath ?? '<unset>'}; this half of the comparison is `
      + `missing and the check would pass by finding nothing. Build rauc with 'make os-rauc'`,
    )
  }
  if (want !== have) {
    throw new Error(
      `this rauc is ${have}, the image ships ${want}. A bundle written by one version and installed `
      + `by another is a format and slot-model contract nobody checked. Both come from `
      + `pkgs/rauc/versions.env now, so this means the image predates a version bump: rebuild `
      + `the rootfs`,
    )
  }
  return `rauc ${have} here, ${want} in the image`
}

/**
 * The boot-attempt credits boot.cmd installs, refusing a read that found none.
 *
 * The empty read is the whole point of this function -- see the file header.
 * The shell's `while read` over an empty pipe runs its body zero times and
 * falls out of the loop having compared nothing, and a guard that reports the
 * same green for "every credit is in range" and "there were no credits" is not
 * a guard. The range check itself is checkBootAttempts, shared with the
 * assembler so that the two cannot drift about what 1..9 means.
 *
 * @returns the credits it actually saw, so a caller can say how many.
 */
export function requireBootAttempts(geometry: Geometry, bootCmd: string, path: string): bigint[] {
  const credits = [...bootCmd.matchAll(/BOOT_[AB]_LEFT ([0-9]+)/g)].map(m => BigInt(m[1] ?? '0'))
  if (credits.length === 0) {
    throw new Error(
      `${path} sets no BOOT_A_LEFT/BOOT_B_LEFT credit at all, so the range check against `
      + `${geometry.requireInt('BOOT_ATTEMPTS_MIN')}..${geometry.requireInt('BOOT_ATTEMPTS_MAX')} `
      + `would pass by finding nothing. A boot script that installs no credits on a virgin `
      + `environment leaves RAUC's counter unset, and U-Boot's \`test -gt\` on an unset variable is `
      + `not a comparison -- so the A/B handshake decides nothing on the first boot after a flash. `
      + `Either this path is stale or that file stopped declaring them.`,
    )
  }
  checkBootAttempts(geometry, bootCmd, path)
  return credits
}

export interface VerityFacts {
  readonly rootHash: string
  readonly salt: string
}

/**
 * The root hash and salt the rootfs build recorded, checked against the pin.
 *
 * Neither is recomputed. The dm-verity table is computed in one place -- the
 * rootfs producer -- and a second computation of the same hash is a second
 * thing to get wrong. What is checked is that the salt the producer used is
 * the salt the board pins, because a hash tree built with a random salt is not
 * reproducible and nothing downstream of here would report it.
 */
export function verityFacts(text: string, path: string, pinnedSalt: string): VerityFacts {
  const rootHash = envFileGet(text, 'VERITY_ROOT_HASH')
  const salt = envFileGet(text, 'VERITY_SALT')
  if (rootHash === '') {
    throw new Error(`VERITY_ROOT_HASH missing from ${path}; fix ${ROOTFS_PRODUCER}`)
  }
  if (salt.toLowerCase() !== pinnedSalt.toLowerCase()) {
    throw new Error(
      `${path} salt '${salt}' does not match the pinned VERITY_SALT '${pinnedSalt}'; `
      + `fix ${ROOTFS_PRODUCER}`,
    )
  }
  return { rootHash, salt }
}

export interface BundleVerityEnvInputs {
  readonly cmdline: string
  readonly cmdlinePath: string
  readonly slot: string
  readonly rootfsGuid: string
  readonly rootHash: string
  readonly salt: string
  readonly verityEnvPath: string
}

/**
 * One slot's mos-verity-<slot>.env, and the five ways a cmdline is refused.
 *
 * Both slots' files ship in one bundle, under slot-suffixed names, because a
 * single boot payload can land in either slot and the table names that slot's
 * own rootfs partition. The unsuffixed name is deliberately not written: a
 * factory slot carries none either, and shipping one here would make an
 * updated slot's layout differ from the flashed one.
 *
 * These checks are not a duplicate of the assembler's, and the shell says why:
 * a bundle can be built without ever assembling an image, and these env files
 * are the only tie between the shipped mos-verity-{a,b}.env and the shipped
 * rootfs.img. A cmdline pointing at the wrong slot's partition, or carrying
 * some other build's root hash, would otherwise land in a signed bundle and
 * fail on hardware after the slot was already written.
 *
 * Two details intentionally differ from the image assembler: an absent
 * dm-mod.create= and an absent dm-mod.waitfor= share one
 * sentence here, and the salt is additionally required to appear in the table --
 * the assembler checks the salt only against the pin, not against the table it
 * is about to ship.
 */
export function bundleVerityEnvText(inputs: BundleVerityEnvInputs): string {
  const { create, waitfor } = verityCmdlineFields(inputs.cmdline)
  if (create === '' || waitfor === '') {
    throw new Error(
      `${inputs.cmdlinePath} carries no dm-mod.create=/dm-mod.waitfor= verity table for slot `
      + `${inputs.slot}; fix ${ROOTFS_PRODUCER}`,
    )
  }
  const createLc = create.toLowerCase()
  const waitforLc = waitfor.toLowerCase()
  const guidLc = inputs.rootfsGuid.toLowerCase()
  if (!createLc.includes(guidLc)) {
    throw new Error(
      `the slot-${inputs.slot} verity table in ${inputs.cmdlinePath} does not reference PARTUUID `
      + `${inputs.rootfsGuid} (compared case-insensitively); each slot must point dm-verity at its `
      + `own rootfs partition.\n  found: ${create}\nFix ${ROOTFS_PRODUCER}.`,
    )
  }
  if (!waitforLc.includes(guidLc)) {
    throw new Error(
      `the slot-${inputs.slot} dm-mod.waitfor= in ${inputs.cmdlinePath} does not reference PARTUUID `
      + `${inputs.rootfsGuid} (compared case-insensitively); the wait must name the same partition `
      + `the verity table uses.\n  found: ${waitfor}\nFix ${ROOTFS_PRODUCER}.`,
    )
  }
  if (!createLc.includes(inputs.rootHash.toLowerCase())) {
    throw new Error(
      `the slot-${inputs.slot} verity table in ${inputs.cmdlinePath} does not carry the root hash `
      + `${inputs.rootHash} from ${inputs.verityEnvPath} (compared case-insensitively).\n`
      + `  found: ${create}\nFix ${ROOTFS_PRODUCER}.`,
    )
  }
  if (!createLc.includes(inputs.salt.toLowerCase())) {
    throw new Error(
      `the slot-${inputs.slot} verity table in ${inputs.cmdlinePath} does not carry the salt `
      + `${inputs.salt} from ${inputs.verityEnvPath} (compared case-insensitively).\n`
      + `  found: ${create}\nFix ${ROOTFS_PRODUCER}.`,
    )
  }
  return `verity_args=${create} ${waitfor}\n`
}

/**
 * The grub cmdline fragment's variables, in the order the shell writes them.
 *
 * `set <GRUB NAME>=<value read from VERITY_* in the rootfs build's own env>`.
 * READ, never recomputed, for the reason bundleVerityEnvText gives: one place
 * computes the table. Ordered, because the file this builds is compared byte
 * for byte against the shell's.
 */
export const GRUB_CMDLINE_PAIRS: readonly (readonly [string, string])[] = [
  ['MOS_SECTORS', 'VERITY_DATA_SECTORS'],
  ['MOS_DATA_BLOCK_SIZE', 'VERITY_DATA_BLOCK_SIZE'],
  ['MOS_HASH_BLOCK_SIZE', 'VERITY_HASH_BLOCK_SIZE'],
  ['MOS_DATA_BLOCKS', 'VERITY_DATA_BLOCKS'],
  ['MOS_HASH_START_BLOCK', 'VERITY_HASH_START_BLOCK'],
  ['MOS_HASH_ALGO', 'VERITY_HASH_ALGO'],
  ['MOS_ROOT_HASH', 'VERITY_ROOT_HASH'],
  ['MOS_SALT', 'VERITY_SALT'],
]

/**
 * A grub board's slot cmdline fragment.
 *
 * The same bytes work in either slot, deliberately: the rootfs PARTUUIDs live
 * in the ESP's grub.cfg, which no install rewrites, so nothing in here is
 * slot-specific -- and a bundle carries one image per slot class with RAUC
 * choosing the target, so anything slot-specific would be wrong half the time.
 *
 * The closing check is not redundant with the per-key one above it. The
 * per-key check refuses a missing value; this one refuses a value that is
 * present and not a hash -- a truncated or re-encoded root hash reaches the
 * device as a dm-verity table GRUB cannot use, and every slot installed from
 * that bundle refuses to boot.
 */
export function grubCmdlineFragment(text: string, path: string): string {
  let out = ''
  for (const [grubName, envName] of GRUB_CMDLINE_PAIRS) {
    const value = envFileGet(text, envName)
    if (value === '') {
      throw new Error(
        `${envName} missing from ${path}; the installed slot would get an incomplete dm-verity table `
        + `and GRUB would refuse to boot it. Fix ${ROOTFS_PRODUCER}`,
      )
    }
    out += `set ${grubName}=${value}\n`
  }
  if (!/^set MOS_ROOT_HASH=[0-9a-f]{32,}$/m.test(out)) {
    throw new Error(
      `the cmdline fragment carries no root hash; every slot installed from this bundle would `
      + `refuse to boot`,
    )
  }
  return out
}

// The manifest.

/**
 * The boot half of the image set, one line pair per payload file.
 *
 * BOTH bootloaders produce one `boot.vfat`: a U-Boot board's is a filesystem
 * written raw into the inactive boot slot and a grub board's holds the kernel,
 * the initrd and that slot's verity facts, but the slot CLASS and the file
 * name are the same, so this block is not per-board.
 */
export const BOOT_IMAGES_BLOCK = '[image.boot]\nfilename=boot.vfat\n'

/**
 * awk's records for one file: split on newline, and no empty record at the end.
 *
 * awk yields a final partial record for a file that does not end in a newline
 * and yields none at all for an empty file, and both cases decide what the
 * rendered manifest looks like. `''.split('\n')` is `['']` in JavaScript,
 * which would be a blank line awk never emitted.
 */
function awkRecords(text: string): string[] {
  const records = text.split('\n')
  if (records[records.length - 1] === '') records.pop()
  return records
}

/**
 * `@BOOT_IMAGES@` replaced by the block, spliced by line.
 *
 * The shell splices with awk rather than sed and its comment says why: sed
 * cannot put a newline into a replacement, and this block has several. awk's
 * `print` supplies the output record separator, so every record -- including
 * the last -- is followed by a newline whether or not the template ended with
 * one.
 */
export function spliceBootImages(template: string, bootImages: string): string {
  const out: string[] = []
  for (const record of awkRecords(template)) {
    if (record === '@BOOT_IMAGES@') {
      out.push(...awkRecords(bootImages))
      continue
    }
    out.push(record)
  }
  return out.map(l => `${l}\n`).join('')
}

/**
 * The rendered manifest: the boot block spliced in, then the two substitutions.
 *
 * The replacements are functions, and that is the whole point: a string
 * replacement is NOT literal in JavaScript -- `replaceAll` expands `$&`,
 * `` $` ``, `$'`, `$$` and `$n` inside it -- while a replacer function is never
 * scanned for those, so the value lands byte for byte whatever it contains.
 * The earlier implementation carried the same defect under a different
 * character: substituting with `sed` lets an `&` in the replacement expand
 * to the whole match. Measured without the fix: `mos-a$&b` renders as
 * `compatible=mos-a@COMPATIBLE@b`, a manifest nobody wrote, which
 * `readBundleInfo`'s cross-check then refuses against the uncorrupted value it
 * was given.
 *
 * Neither value can carry a trigger today -- BUNDLE_VERSION is refused unless
 * it matches `^[A-Za-z0-9][A-Za-z0-9._+-]*$`, and BUNDLE_COMPATIBLE is
 * `mos-<board>` out of the rendered system.conf -- so this moves no bytes for
 * any board that exists, and the payload gate proves it. It is done anyway,
 * because "unreachable today" is a property of the board files and not of this
 * function.
 */
export function renderManifest(options: {
  template: string
  bootImages?: string
  compatible: string
  version: string
}): string {
  const spliced = spliceBootImages(options.template, options.bootImages ?? BOOT_IMAGES_BLOCK)
  return spliced
    .replaceAll('@COMPATIBLE@', () => options.compatible)
    .replaceAll('@VERSION@', () => options.version)
}

/**
 * The two things a rendered manifest is refused for.
 *
 * Comment lines are excluded from the placeholder scan, for the shell's
 * reason: manifest.raucm.in documents the other template's placeholder by name
 * ("See @SLOTS@ in pkgs/rauc/system.conf.in for why"), and a check over
 * the raw bytes rejects a correct manifest for saying what it does. The listing
 * of offenders applies the same exclusion the same blunt way, over the `N:line`
 * form grep -n produces, so a reader comparing the two implementations sees the
 * same lines named. `format=verity` is asserted because rauc 1.8 has no
 * --bundle-format flag: the format is declared in the manifest, so a template
 * edit could otherwise quietly downgrade every bundle to the "plain" format
 * that system.conf refuses to install.
 */
export function checkRenderedManifest(rendered: string, manifestInPath: string): void {
  const lines = rendered.split('\n')
  const isComment = (l: string): boolean => /^[ \t\v\f\r]*#/.test(l)
  if (lines.some(l => !isComment(l) && /@[A-Z_]+@/.test(l))) {
    const offenders = lines
      .map((l, i) => `${i + 1}:${l}`)
      .filter(numbered => /@[A-Z_]+@/.test(numbered))
      .filter(numbered => !/:[ \t\v\f\r]*#/.test(numbered))
    throw new Error(`unrendered placeholder left in a manifest VALUE:\n${offenders.join('\n')}`)
  }
  if (!lines.includes('format=verity')) {
    throw new Error(`${manifestInPath} does not declare '[bundle] format=verity'`)
  }
}

// Reading the bundle back.

/**
 * What `jq -r` prints for a field, including the two answers that are not values.
 *
 * A key that is absent prints the four characters `null`, and a `select` that
 * matched nothing prints nothing -- so the shell compares `''` and `'null'`
 * against the expected string and reports them in its message. Both are
 * reproduced: a port that turned either into `undefined` would compare its own
 * way and report a different sentence for the same broken bundle.
 */
function jqRaw(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** The filename `rauc info` reports for one slot class, `''` when no image has it. */
export function imageFilenameForSlot(info: Record<string, unknown>, slotClass: string): string {
  const images = info.images
  if (!Array.isArray(images)) return ''
  const hit = images.find(e => e !== null && typeof e === 'object' && slotClass in (e as Record<string, unknown>))
  if (hit === undefined) return ''
  const entry = (hit as Record<string, unknown>)[slotClass]
  if (entry === null || typeof entry !== 'object') return jqRaw(entry)
  return jqRaw((entry as Record<string, unknown>).filename)
}

/** The slot class -> filename pairs a bundle must carry, in the shell's order. */
export const BUNDLE_SLOT_IMAGES: readonly (readonly [string, string])[] = [
  ['rootfs', 'rootfs.img'],
  ['boot', 'boot.vfat'],
]

/**
 * The bundle read back through rauc, compared against what was asked for.
 *
 * This is the only way to prove a bundle is installable that does not write to
 * a real block device: `rauc info` with signature verification on, through the
 * system.conf the image actually ships -- which is also the one place that
 * file is parsed by rauc at build time, so a slot definition rauc cannot read
 * fails the bundle build instead of failing on a device.
 */
export function checkBundleInfo(
  info: Record<string, unknown>,
  expected: { compatible: string, version: string },
): void {
  const compatible = jqRaw(info.compatible)
  if (compatible !== expected.compatible) {
    throw new Error(`bundle compatible is '${compatible}', expected '${expected.compatible}'`)
  }
  const version = jqRaw(info.version)
  if (version !== expected.version) {
    throw new Error(`bundle version is '${version}', expected '${expected.version}'`)
  }
  for (const [slotClass, filename] of BUNDLE_SLOT_IMAGES) {
    const got = imageFilenameForSlot(info, slotClass)
    if (got !== filename) {
      throw new Error(`bundle image for slot class '${slotClass}' is '${got}', expected '${filename}'`)
    }
  }
}

export interface PayloadReport {
  readonly payloadBytes: number
  readonly payloadSha256: string
  readonly bundleBytes: number
}

/**
 * Determinism, stated as a measurable value rather than a claim.
 *
 * The squashfs payload at the head of the bundle is a pure function of the
 * inputs; the bytes after it are not. rauc salts the bundle's own dm-verity
 * hash tree at random and the CMS signature carries a signingTime attribute, so
 * two builds of the same version differ in the tail and MUST NOT in the head,
 * which makes this digest the bundle's rebuild gate. `bytes_used` sits at
 * offset 40 of the squashfs superblock as a little-endian u64 -- `od -An -tu8
 * -j40 -N8` in the shell -- rounded up to the 4096 rauc pads to. The magic is
 * checked first because a `bytes_used` read out of something that is not a
 * superblock is a number, and a number that large turns `head -c` into "the
 * whole file" rather than into an error.
 */
export function payloadReport(path: string): PayloadReport {
  const bundleBytes = statSync(path).size
  const fd = openSync(path, 'r')
  let head: Buffer
  try {
    head = Buffer.alloc(48)
    readSync(fd, head, 0, 48, 0)
  } finally {
    closeSync(fd)
  }
  const magic = head.subarray(0, 4).toString('latin1')
  if (magic !== 'hsqs') {
    throw new Error(`${path} does not start with a squashfs superblock`)
  }
  const used = head.readBigUInt64LE(40)
  const padded = ((used + 4095n) / 4096n) * 4096n
  // `head -c N` stops at end of file rather than failing, so a padded length
  // past the end hashes what is there. Reproduced rather than refused: the
  // refusal that matters is the magic above, and inventing a second one here
  // would make the two implementations disagree about a broken bundle.
  const hashed = Number(padded < BigInt(bundleBytes) ? padded : BigInt(bundleBytes))
  const buf = readFileSync(path)
  const payloadSha256 = createHash('sha256').update(buf.subarray(0, hashed)).digest('hex')
  return { payloadBytes: Number(padded), payloadSha256, bundleBytes }
}

// Building.

export interface BundleInputs {
  readonly board: string
  readonly kernelImage: string
  /** U-Boot boards only. */
  readonly dtb?: string
  readonly rootfsVerityImg: string
  readonly rootfsVerityEnv: string
  readonly rootfsReport: string
  /** pkgs/rauc/out-<arch>/RAUC_VERSION.env -- the other half of the version check. */
  readonly raucBuildEnv: string
  /** U-Boot boards only. */
  readonly bootCmdlineA?: string
  readonly bootCmdlineB?: string
  readonly cert: string
  readonly key: string
  readonly keyring: string
  readonly bundleOut: string
  readonly bundleVersion: string
  readonly bundleCompatible: string
  /** Defaults to the tree's own boards/<board>/boot.cmd. */
  readonly bootCmd?: string
  readonly manifestIn?: string
  readonly systemConf?: string
  /** The rauc binary the toolset carries in. Defaults to the shipped one for `arch`. */
  readonly raucBin?: string
  /** The build HOST's architecture, not the board's. See hostArchFor in bundle-cli.ts. */
  readonly hostArch?: string
}

export interface BuildBundleOptions {
  readonly geometry?: Geometry
  readonly toolbox?: Toolbox
  readonly log?: (line: string) => void
}

export interface BuildBundleResult {
  readonly bundleOut: string
  readonly payload: PayloadReport
  readonly info: Record<string, unknown>
  /** How many boot-attempt credits the range guard actually compared. */
  readonly bootAttemptsSeen: number
}

/**
 * Every directory a tool has to see, derived from the inputs.
 *
 * The signing material is in the set because CERT/KEY/KEYRING are overridable
 * and real material lives outside the tree -- the shell bind-mounts each of
 * the three files read-only for exactly that reason. Here they arrive as
 * directories because the toolbox mounts directories at their own path, and a
 * directory already covered by another mount is dropped: docker accepts nested
 * -v flags, but the inner one shadows writes made through the outer.
 */
export function bundleMountsFor(inputs: BundleInputs, workDir: string): string[] {
  const dirs = new Set<string>([REPO_ROOT, workDir, dirname(resolve(inputs.bundleOut))])
  for (const p of [
    inputs.kernelImage, inputs.dtb,
    inputs.rootfsVerityImg, inputs.rootfsVerityEnv, inputs.rootfsReport, inputs.raucBuildEnv,
    inputs.bootCmdlineA, inputs.bootCmdlineB,
    inputs.cert, inputs.key, inputs.keyring,
  ]) {
    if (p !== undefined && p !== '') dirs.add(dirname(resolve(p)))
  }
  const all = [...dirs].sort()
  return all.filter(d => !all.some(other => other !== d && d.startsWith(`${other}/`)))
}

/**
 * Open the toolbox a bundle is built in, refusing a route that cannot honour
 * the toolset's claim about which rauc answers.
 *
 * The host route has no way to carry a binary in. `carry` is a `docker cp`, so
 * on the host route the toolbox runs whatever `rauc` is first on PATH -- while
 * the toolset still declares `provenance: 'shipped'`, which is what
 * src/tools/rauc.ts checks before it will write a bundle. A distro rauc on PATH
 * would therefore sign a bundle under a provenance claim made about a different
 * binary, the one failure the provenance machinery exists to prevent. So the
 * route is measured and the mismatch refused, by name, before anything is
 * written.
 *
 * The refusal is here rather than in src/toolbox.ts because provenance is not
 * a property of a toolset in general -- rauc is the only tool that has one --
 * and a blanket "a toolset with `carry` may not take the host route" would be
 * a rule about something the toolbox does not model.
 */
export async function openBundleToolbox(options: {
  raucBin: string
  mounts: readonly string[]
  log?: (line: string) => void
  route?: 'host' | 'container'
}): Promise<Toolbox> {
  const toolset = bundleToolset({ raucBin: options.raucBin })
  const tb = await Toolbox.open(toolset, {
    mounts: [...options.mounts],
    announce: options.log,
    ...(options.route === undefined ? {} : { route: options.route }),
  })
  // There used to be a check here for the host route, where `carry` cannot put
  // the shipped rauc anywhere and the toolset's `provenance: 'shipped'` claim
  // would have been about whatever `rauc` PATH resolved to first. Toolbox.open
  // refuses that route outright now (docs/design/build.md section 0), so the
  // check is unreachable and the claim is structural: the only rauc in this
  // container is the one `carry` copied in.
  return tb
}

/**
 * Build and sign the bundle.
 *
 * The refusal order is stable so the first actionable problem is deterministic.
 */
export async function buildBundle(
  inputs: BundleInputs,
  options: BuildBundleOptions = {},
): Promise<BuildBundleResult> {
  const log = options.log ?? ((line: string) => console.log(line))
  const geometry = options.geometry ?? loadGeometry(inputs.board)
  if (geometry.faults.length > 0) {
    throw new Error(
      `${geometry.path} has ${geometry.faults.length} unusable value(s), and a bundle builder cannot `
      + `pick one of two contradictory numbers:\n`
      + geometry.faults.map(f => `  ${f.key}=${JSON.stringify(f.value)} ${f.reason}`).join('\n'),
    )
  }

  const manifestIn = inputs.manifestIn ?? MANIFEST_IN
  const systemConf = inputs.systemConf ?? SYSTEM_CONF
  const bootCmdPath = inputs.bootCmd ?? join(BOARDS_DIR, inputs.board, 'boot.cmd')
  const raucBin = inputs.raucBin ?? shippedRaucPath(inputs.hostArch ?? 'amd64')

  // `mktemp -d` in the shell; under build/.work here, for the reason
  // src/paths.ts gives -- on this host a docker bind mount of anything under
  // /tmp succeeds and delivers an EMPTY DIRECTORY, and every tool below may be
  // running in a container.
  const workDir = makeWorkDir(`bundle-${inputs.board}`)
  const stage = join(workDir, 'input')

  const ownToolbox = options.toolbox === undefined
  const tb = options.toolbox ?? await openBundleToolbox({
    raucBin,
    mounts: bundleMountsFor(inputs, workDir),
    log,
  })

  try {
    // On the host, not through the toolbox: the staging directory is under
    // build/.work, which the container sees at the same path through the
    // identity mount, so there is nothing a container-side mkdir would add
    // except a sixth binary the toolset would have to assert.
    mkdirSync(stage, { recursive: true })

    log(assertRaucMatchesImage({
      reportPath: inputs.rootfsReport,
      reportText: existsSync(inputs.rootfsReport) ? readFileSync(inputs.rootfsReport, 'utf8') : undefined,
      buildEnvPath: inputs.raucBuildEnv,
      buildEnvText: existsSync(inputs.raucBuildEnv) ? readFileSync(inputs.raucBuildEnv, 'utf8') : undefined,
    }))

    const verityEnvText = readFileSync(inputs.rootfsVerityEnv, 'utf8')
    let bootAttemptsSeen = 0

    // The boot half, the one thing that genuinely differs between the two
    // bootloaders.
    if (geometry.bootloader === 'uboot') {
      const bootCmdText = readFileSync(bootCmdPath, 'utf8')
      bootAttemptsSeen = requireBootAttempts(geometry, bootCmdText, bootCmdPath).length

      const bootScriptName = geometry.require('BOOT_SCRIPT_NAME')
      await makeBootScript(tb, {
        input: bootCmdPath,
        output: join(workDir, bootScriptName),
        name: 'mos boot',
        sourceDateEpoch: geometry.ext4.sourceDateEpoch,
      })

      const facts = verityFacts(verityEnvText, inputs.rootfsVerityEnv, geometry.veritySalt)
      const base = verityEnvBase(geometry)
      for (const slot of [
        { letter: 'A', cmdline: inputs.bootCmdlineA, guid: 'ROOTFS_A_GUID', suffix: 'a' },
        { letter: 'B', cmdline: inputs.bootCmdlineB, guid: 'ROOTFS_B_GUID', suffix: 'b' },
      ]) {
        if (slot.cmdline === undefined || slot.cmdline === '') {
          throw new Error(
            `no slot-${slot.letter} kernel cmdline was supplied, and a bundle's boot payload carries `
            + `BOTH slots' verity env files; ${ROOTFS_PRODUCER} writes them into _out/${inputs.board}/`,
          )
        }
        writeFileSync(join(workDir, `${base}-${slot.suffix}.env`), bundleVerityEnvText({
          cmdline: readFileSync(slot.cmdline, 'utf8'),
          cmdlinePath: slot.cmdline,
          slot: slot.letter,
          rootfsGuid: geometry.require(slot.guid),
          rootHash: facts.rootHash,
          salt: facts.salt,
          verityEnvPath: inputs.rootfsVerityEnv,
        }))
      }

      await tb.must(['cp', inputs.kernelImage, join(workDir, 'Image')], {
        note: `could not stage the kernel from ${inputs.kernelImage}`,
      })
      if (inputs.dtb === undefined || inputs.dtb === '') {
        throw new Error(`no DTB was supplied, and a U-Boot board's boot payload carries one`)
      }
      await tb.must(['cp', inputs.dtb, join(workDir, 'rk3576-src.dtb')], {
        note: `could not stage the device tree from ${inputs.dtb}`,
      })

      // The digests boot.scr checks the payload's own kernel and dtb against,
      // taken from the staged copies for the same reason the image assembler
      // does: these are the bytes mcopy is about to write. Slot-NEUTRAL, unlike
      // the two verity envs above -- a boot payload carries one Image whichever
      // slot it lands in, so a suffixed digest would be two names for one fact.
      const digestName = geometry.require('BOOT_DIGEST_ENV_NAME')
      writeFileSync(join(workDir, digestName), bootDigestEnv(
        BOOT_DIGEST_ARTEFACTS.map(a => ({ ...a, bytes: readFileSync(join(workDir, a.file)) })),
        join(workDir, digestName),
      ))

      await tb.must(
        ['find', workDir, '-maxdepth', '1', '-type', 'f', '-exec', 'touch', '-h', '-d', geometry.ext4.fileMtime, '{}', '+'],
        { note: `could not pin the staged boot files in ${workDir} to ${geometry.ext4.fileMtime}` },
      )

      const bootVfat = join(stage, 'boot.vfat')
      await truncate(tb, bootVfat, `${geometry.requireInt('BOOT_SIZE_MIB')}M`)
      await mkfsVfat(tb, { image: bootVfat, label: BUNDLE_BOOT_FAT_LABEL })
      // The order is the FAT directory order. Written out, as the shell writes
      // it out; nothing here globs.
      await mcopy(tb, {
        image: bootVfat,
        recursive: true,
        sources: [
          join(workDir, 'Image'),
          join(workDir, 'rk3576-src.dtb'),
          join(workDir, bootScriptName),
          join(workDir, digestName),
          join(workDir, `${base}-a.env`),
          join(workDir, `${base}-b.env`),
        ],
        destination: '::/',
      })
    } else {
      const cmdlineName = geometry.require('SLOT_CMDLINE_NAME')
      const kernelName = geometry.require('SLOT_KERNEL_NAME')
      writeFileSync(join(workDir, cmdlineName), grubCmdlineFragment(verityEnvText, inputs.rootfsVerityEnv))

      // A kernel and a cmdline, and no initrd: a grub board's slot payload
      // stopped carrying one when its kernel gained CONFIG_DM_INIT and started
      // reading the dm-mod.create= table on that cmdline itself.
      await tb.must(['cp', inputs.kernelImage, join(workDir, kernelName)], {
        note: `could not stage the kernel from ${inputs.kernelImage}`,
      })
      await tb.must(
        ['find', workDir, '-maxdepth', '1', '-type', 'f', '-exec', 'touch', '-h', '-d', geometry.ext4.fileMtime, '{}', '+'],
        { note: `could not pin the staged boot files in ${workDir} to ${geometry.ext4.fileMtime}` },
      )

      const bootVfat = join(stage, 'boot.vfat')
      await truncate(tb, bootVfat, `${geometry.requireInt('BOOT_SIZE_MIB')}M`)
      await mkfsVfat(tb, { image: bootVfat, label: BUNDLE_BOOT_FAT_LABEL })
      await mcopy(tb, {
        image: bootVfat,
        recursive: true,
        sources: [join(workDir, kernelName), join(workDir, cmdlineName)],
        destination: '::/',
      })
    }

    await tb.must(['cp', inputs.rootfsVerityImg, join(stage, 'rootfs.img')], {
      note: `could not stage the rootfs slot image from ${inputs.rootfsVerityImg}`,
    })

    const rendered = renderManifest({
      template: readFileSync(manifestIn, 'utf8'),
      compatible: inputs.bundleCompatible,
      version: inputs.bundleVersion,
    })
    writeFileSync(join(stage, 'manifest.raucm'), rendered)
    checkRenderedManifest(rendered, manifestIn)

    await tb.must(
      ['find', stage, '-type', 'f', '-exec', 'touch', '-h', '-d', geometry.ext4.fileMtime, '{}', '+'],
      { note: `could not pin the staged bundle inputs in ${stage} to ${geometry.ext4.fileMtime}` },
    )

    // rauc drives mksquashfs itself; without these it stamps the payload with
    // the wall clock, the build container's uid map and a thread count.
    const epoch = geometry.ext4.sourceDateEpoch
    // The keyring goes in at SIGNING time as well as at read-back: it is what
    // makes rauc verify what it just wrote and print its imminent-expiry
    // warning, which this build never saw while `bundleArgs` passed no
    // `--keyring` (PLAN-078 §M0). raucBundle additionally refuses outright when
    // the signer is inside the declared reissue threshold, before any bytes
    // exist.
    await raucBundle(tb, {
      stageDir: stage,
      output: inputs.bundleOut,
      cert: inputs.cert,
      key: inputs.key,
      keyring: inputs.keyring,
      mksquashfsArgs: `-all-root -no-xattrs -noappend -processors 1 -mkfs-time ${epoch} -all-time ${epoch}`,
    })

    // Validated the only way that proves it is installable: read back through
    // rauc with signature verification on. No `rauc install` anywhere -- that
    // writes to real block devices.
    const info = await raucInfo(tb, {
      bundle: inputs.bundleOut,
      keyring: inputs.keyring,
      conf: systemConf,
    })
    checkBundleInfo(info, { compatible: inputs.bundleCompatible, version: inputs.bundleVersion })
    log('=== rauc info ===')
    log(JSON.stringify(info))

    const payload = payloadReport(inputs.bundleOut)
    log(`payload: ${payload.payloadBytes} bytes, sha256 ${payload.payloadSha256}`)
    log(
      `bundle:  ${payload.bundleBytes} bytes (tail after the payload is not byte-stable: `
      + `random verity salt + CMS signingTime)`,
    )

    return { bundleOut: inputs.bundleOut, payload, info, bootAttemptsSeen }
  } finally {
    if (ownToolbox) await tb.close()
    // `trap 'rm -rf "${workdir:-}"' EXIT` in the shell, and not housekeeping:
    // the staging tree holds a COPY of the rootfs slot image and of the kernel,
    // which is ~140 MiB for cx3576. Left behind, a suite that builds a handful
    // of bundles fills build/.work with them -- measured at 557 MiB after
    // seven runs before this line existed. Removed in the `finally`, so a build
    // that threw leaves nothing either.
    rmSync(workDir, { recursive: true, force: true })
  }
}
