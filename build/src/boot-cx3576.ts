// What goes into a cx3576 boot slot, and the refusals that stand between a
// well-formed boot slot and a bricked board.
//
// Everything here is pure: text in, refusal or text out. Every guard below
// exists because the failure it catches does not announce itself on hardware --
// U-Boot loads a kernel from a partition that now holds something else, after
// it has already persisted the boot-attempt decrement -- so the guard is the
// entire defence, and one only ever observed working is not evidence that it
// still can. Pure, each is driven from the failing side against doctored text.
//
// The case rule is stated once here: GPT tooling -- sgdisk, and therefore
// boards/cx3576/board.env -- writes GUIDs
// uppercase, while udev and libblkid write the /dev/disk/by-partuuid/ names
// lowercase, the form a kernel cmdline has to use. Both denote the same GUID,
// so every identifier comparison folds case first: the rootfs producer emits
// lowercase, the layout is uppercase, and a literal comparison refuses a
// correct build.

import { crc32 } from 'node:zlib'
import type { Geometry } from './geometry.ts'

function lc(s: string): string {
  return s.toLowerCase()
}

/**
 * Every `BOOT_A_LEFT`/`BOOT_B_LEFT` credit boot.cmd installs, in the order it
 * spells them.
 *
 * `grep -oE 'BOOT_[AB]_LEFT [0-9]+'` in the shell -- deliberately not anchored
 * to `setenv`, so a credit written anywhere in the script is checked.
 */
export function bootAttemptValues(bootCmd: string): bigint[] {
  return [...bootCmd.matchAll(/BOOT_[AB]_LEFT ([0-9]+)/g)].map(m => BigInt(m[1] ?? '0'))
}

/**
 * The credits a virgin environment is given must be readable by BOTH radices.
 *
 * RAUC writes this counter with "%x" and reads it base 16; U-Boot's `test -gt`
 * parses decimal. The two agree only for 0-9, so a value outside
 * BOOT_ATTEMPTS_MIN..BOOT_ATTEMPTS_MAX is a slot whose credit count means one
 * thing to the updater and another to the bootloader.
 */
export function checkBootAttempts(geometry: Geometry, bootCmd: string, path: string): void {
  const min = geometry.requireInt('BOOT_ATTEMPTS_MIN')
  const max = geometry.requireInt('BOOT_ATTEMPTS_MAX')
  for (const credits of bootAttemptValues(bootCmd)) {
    if (credits < min || credits > max) {
      throw new Error(
        `${path} sets a boot-attempts value of ${credits}; RAUC writes this counter in hex and U-Boot `
        + `compares it in decimal, so it must stay in ${min}..${max}`,
      )
    }
  }
}

/**
 * The three names that must be the same derivation of one base.
 *
 * The per-slot names, the pattern boot.scr builds at runtime and the pattern
 * build/src/bundle.ts writes are three copies of one string; any of them
 * drifting means an updated slot silently fails to boot. Tied together here
 * rather than trusted three times.
 */
export function verityEnvBase(geometry: Geometry): string {
  const name = geometry.require('BOOT_VERITY_ENV_NAME')
  const base = name.endsWith('.env') ? name.slice(0, -'.env'.length) : name
  const a = geometry.require('BOOT_VERITY_ENV_A_NAME')
  const b = geometry.require('BOOT_VERITY_ENV_B_NAME')
  if (a !== `${base}-a.env` || b !== `${base}-b.env`) {
    throw new Error(
      `BOOT_VERITY_ENV_A_NAME/BOOT_VERITY_ENV_B_NAME must be '${base}-a.env'/'${base}-b.env' to match `
      + `what the bundle contract writes into a RAUC boot payload`,
    )
  }
  return base
}

/**
 * boot.cmd must put rauc.slot= on the kernel cmdline, and must load the
 * slot-suffixed verity env.
 *
 * rauc identifies the booted slot from `rauc.slot=` on the cmdline; it cannot
 * use root=, because the verity root is /dev/dm-0 and rauc matches only
 * bootname / slot name / realpath(device). Losing that token makes every update
 * roll back while the device looks healthy -- so it is a build failure, not
 * something to find on a verifier run.
 *
 * And a RAUC-installed slot carries only the slot-suffixed files, so an
 * unsuffixed load would roll every update back.
 */
export function checkBootCmdTokens(geometry: Geometry, bootCmd: string, path: string): void {
  const base = verityEnvBase(geometry)
  if (!bootCmd.includes('rauc.slot=${bootslot}')) {
    throw new Error(
      `${path} does not set rauc.slot=\${bootslot} on the kernel cmdline; rauc cannot identify the `
      + `booted slot from root=/dev/dm-0, so 'rauc status' fails, the health gate never runs 'rauc `
      + `status mark-good' and every installed slot is rolled back`,
    )
  }
  if (!bootCmd.includes(`${base}-\${slotsuffix}.env`)) {
    throw new Error(
      `${path} does not load the per-slot verity env '${base}-\${slotsuffix}.env'; a RAUC-installed `
      + `slot carries only the slot-suffixed files, so an unsuffixed load would roll every update back`,
    )
  }
}

/**
 * The value boot.cmd assigns to `var` inside the block that also sets
 * `setenv bootslot <slot>`.
 *
 * The awk this replaces latches on the `setenv bootslot <slot>` line and then
 * takes the first following assignment of the variable -- and never unlatches,
 * which is why slot B's block must come after slot A's for slot A's answer to
 * be slot A's. Kept identical rather than tidied: a scan that read a different
 * line would agree with the shell on today's file and disagree on the next one.
 */
export function bootCmdSetting(bootCmd: string, slot: string, name: string): string | undefined {
  let inSlot = false
  for (const line of bootCmd.split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f[0] === 'setenv' && f[1] === 'bootslot' && f[2] === slot) {
      inSlot = true
      continue
    }
    if (f[0] === 'setenv' && f[1] === name && inSlot) return f[2]
  }
  return undefined
}

/**
 * The renumbering guard.
 *
 * boot.cmd addresses its slot as `mmc 0:${bootpart}`, a literal GPT partition
 * number, because hush cannot read a layout file. So the numbers are written out
 * in boot.cmd and checked here against the layout instead: inserting or removing
 * any partition ahead of the boot slots shifts them, and a stale number does not
 * announce itself -- U-Boot just fails to find Image in a partition that now
 * holds something else, after the environment has already been written. That is
 * a brick discovered on hardware, so it is a build failure here.
 */
export function checkPartitionNumbers(geometry: Geometry, bootCmd: string, path: string): void {
  const wanted: { name: string, slot: string, partition: string }[] = [
    { name: 'bootpart', slot: 'A', partition: 'BOOT_A' },
    { name: 'bootpart', slot: 'B', partition: 'BOOT_B' },
    { name: 'rootpart', slot: 'A', partition: 'ROOTFS_A' },
    { name: 'rootpart', slot: 'B', partition: 'ROOTFS_B' },
  ]
  for (const w of wanted) {
    const num = geometry.requirePartition(w.partition).requireInt('PARTNUM')
    const got = bootCmdSetting(bootCmd, w.slot, w.name)
    if (got !== String(num)) {
      throw new Error(
        `${path} sets '${w.name}' to '${got ?? 'nothing'}' for slot ${w.slot}, but the layout puts `
        + `that partition at p${num}.\n`
        + `boot.scr addresses partitions by number (mmc 0:\${bootpart}); a stale number means U-Boot `
        + `loads the kernel from the wrong partition, or from none, AFTER it has already persisted `
        + `the boot-attempt decrement. Update ${path} to match ${geometry.path}.`,
      )
    }
  }
}

/** The shared RAUC A/B guards, independent of a board's payload digest protocol. */
export function checkAbBootCmd(geometry: Geometry, bootCmd: string, path: string): void {
  checkBootAttempts(geometry, bootCmd, path)
  checkBootCmdTokens(geometry, bootCmd, path)
  checkPartitionNumbers(geometry, bootCmd, path)
}

/** Every boot.cmd guard, in the order the cx3576 assembly contract applies them. */
export function checkBootCmd(geometry: Geometry, bootCmd: string, path: string): void {
  checkAbBootCmd(geometry, bootCmd, path)
  checkBootDigestGuards(geometry, bootCmd, path)
}

/**
 * What the shell's `sed -n` substitution yields: the LAST match on each line,
 * joined by newlines.
 *
 * sed's leading wildcard is greedy, so the capture is the last occurrence on the
 * line, and `-n` with a `p` flag prints once per matching line. Both are
 * reproduced because both decide what a cmdline carrying two verity tables
 * yields, and "whatever JavaScript's first match happens to be" is not an answer.
 */
function lastPerLine(text: string, pattern: RegExp): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const all = [...line.matchAll(pattern)]
    const last = all[all.length - 1]
    if (last?.[0] !== undefined) out.push(last[0])
  }
  return out.join('\n')
}

export interface VerityEnv {
  readonly create: string
  readonly waitfor: string
  /** The file's whole content, newline included. */
  readonly text: string
}

/**
 * The two verity tokens a slot's kernel cmdline carries, extracted one line at
 * a time with last-match-wins behavior.
 *
 * Separate from the guards that read them, because the image assembler and
 * bundle builder read the same two tokens from the same two files and must
 * agree about what they say. They refuse differently -- the assembler gives
 * dm-mod.create= and dm-mod.waitfor= a sentence each, the bundle builder rolls
 * them into one and additionally requires the pinned salt -- so the refusals
 * stay two functions. The extraction is one, so a cmdline carrying two tables
 * cannot mean one thing to the image and another to the bundle installed onto it.
 */
export function verityCmdlineFields(cmdline: string): { create: string, waitfor: string } {
  return {
    create: lastPerLine(cmdline, /dm-mod\.create="[^"]*"/g),
    waitfor: lastPerLine(cmdline, /dm-mod\.waitfor=[^ \n]*/g),
  }
}

/**
 * One slot's mos-verity-<slot>.env, lifted out of that slot's kernel cmdline.
 *
 * The verity table is NOT re-derived here: it is taken from the cmdline the
 * rootfs producer already emits, so there is exactly one place that computes it.
 * What this does instead is refuse a cmdline that does not describe THIS slot --
 * five ways, each of which produces a slot that boots the wrong rootfs or does
 * not boot at all, and none of which the assembler could synthesise its way out
 * of.
 */
export function verityEnvFor(options: {
  cmdline: string
  cmdlinePath: string
  slot: string
  rootfsGuid: string
  rootHash: string
  producer: string
}): VerityEnv {
  const { create, waitfor } = verityCmdlineFields(options.cmdline)

  if (create === '') {
    throw new Error(`${options.cmdlinePath} carries no dm-mod.create= verity table; fix ${options.producer}`)
  }
  if (waitfor === '') {
    // dm_init_init() runs at late_initcall and wait_for_device_probe() does not
    // cover eMMC card discovery, so the wait is required, not decorative.
    throw new Error(
      `${options.cmdlinePath} carries no dm-mod.waitfor=; it is required on kernel 6.1 because the `
      + `verity table would otherwise be built before the eMMC partitions exist.\n`
      + `This is a cross-task mismatch with ${options.producer}, not something this assembler can `
      + `synthesise: the cmdline files must carry dm-mod.waitfor=PARTUUID=<slot rootfs GUID>.`,
    )
  }

  const guid = lc(options.rootfsGuid)
  if (!lc(create).includes(guid)) {
    throw new Error(
      `the slot-${options.slot} verity table in ${options.cmdlinePath} does not reference PARTUUID `
      + `${options.rootfsGuid} (compared case-insensitively); each slot must point dm-verity at its `
      + `own rootfs partition.\n  found: ${create}\nFix ${options.producer}.`,
    )
  }
  if (!lc(waitfor).includes(guid)) {
    throw new Error(
      `the slot-${options.slot} dm-mod.waitfor= in ${options.cmdlinePath} does not reference PARTUUID `
      + `${options.rootfsGuid} (compared case-insensitively); the wait must name the same partition `
      + `the verity table uses.\n  found: ${waitfor}\nFix ${options.producer}.`,
    )
  }
  if (!lc(create).includes(lc(options.rootHash))) {
    throw new Error(
      `the slot-${options.slot} verity table in ${options.cmdlinePath} does not carry the root hash `
      + `${options.rootHash} (compared case-insensitively).\n  found: ${create}\nFix ${options.producer}.`,
    )
  }

  return { create, waitfor, text: `verity_args=${create} ${waitfor}\n` }
}

/**
 * The two files boot.cmd loads into DRAM, and the env-key prefix it reads each
 * one's recorded size and checksum from.
 *
 * The FILENAMES are the ones this assembler stages -- `Image` and
 * `rk3576-src.dtb`, the same two literals `makeBootSlot` copies in and the same
 * two `boards/cx3576/board.env` lists in BOOT_SLOT_REQUIRED_FILES. The KEYS are
 * boot.cmd's own vocabulary: it loads them at `${kernel_addr_r}` and
 * `${fdt_addr_r}`, so `kernel_bytes`/`kernel_crc` and `fdt_bytes`/`fdt_crc` read
 * beside the addresses they describe. Nothing derives one from the other -- a
 * filename does not imply a load address -- so the pairing lives here once and
 * `checkBootDigestGuards` holds the script to it.
 */
export const BOOT_DIGEST_ARTEFACTS = [
  { file: 'Image', key: 'kernel', addr: 'kernel_addr_r' },
  { file: 'rk3576-src.dtb', key: 'fdt', addr: 'fdt_addr_r' },
] as const

export interface BootDigestArtefact {
  /** The name in the boot partition's FAT root. */
  readonly file: string
  /** The env-key prefix: `<key>_bytes` and `<key>_crc`. */
  readonly key: string
  /** The bytes that will be written into the slot, not the ones on the way in. */
  readonly bytes: Uint8Array
}

/**
 * The byte count in the radix `load` reports `${filesize}` in.
 *
 * `do_load` publishes it with `env_set_hex`, which is `sprintf(str, "%lx", ...)`
 * -- lowercase hex, no `0x`, no leading zeros. boot.cmd compares the two as
 * STRINGS, because hush has no arithmetic without `setexpr`, so the spelling is
 * the contract and not a presentation choice.
 */
export function filesizeHex(bytes: number): string {
  return bytes.toString(16)
}

/**
 * CRC-32 as the eight lowercase hex digits `crc32 -v` compares against.
 *
 * Zero-padded to eight, and that is load-bearing in both directions.
 * `parse_verify_sum` (u-boot common/hash.c) treats an argument whose length is
 * exactly twice the digest size as a hex literal and ANYTHING ELSE as the name
 * of an environment variable to look up: a checksum with a zero top byte
 * written as six digits would not be compared against the image, it would be
 * looked up as a variable, not found, and refuse a slot that was fine.
 */
export function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, '0')
}

/**
 * The `mos-boot-digest.env` written beside the kernel and the dtb.
 *
 * `load` returning success means the FAT directory had an entry and the read
 * call did not error. It does not mean the bytes in DRAM are the bytes on the
 * card: a cx3576 board booted a MIXTURE of two kernel builds -- current-build
 * code executing over old-build bytes at `swapper_pg_dir` -- and died in
 * `paging_init`, with the console reporting the full 44493312 bytes read while
 * it happened (RFCT-351, RFCT-352). This file is what lets the boot script tell
 * those two apart.
 *
 * A ZERO-LENGTH artefact is refused rather than digested. `load` of an empty
 * file sets `${filesize}` to `0` and `crc32` over zero bytes is `00000000`, so
 * an empty Image would satisfy both assertions exactly: the guard would pass on
 * the one input that makes it meaningless, and the refusal would arrive as a
 * board that does not boot instead of a build that does not finish.
 */
export function bootDigestEnv(artefacts: readonly BootDigestArtefact[], path: string): string {
  if (artefacts.length === 0) {
    throw new Error(
      `${path} would record no artefact at all, and boot.scr reads a size and a checksum out of it `
      + `for every file it loads; an empty digest file makes every one of those comparisons a `
      + `comparison against nothing`,
    )
  }
  const lines: string[] = []
  for (const a of artefacts) {
    if (a.bytes.length === 0) {
      throw new Error(
        `${a.file} is zero bytes, so ${path} would record 'bytes=0' and 'crc=00000000' -- which an `
        + `empty file loaded into DRAM satisfies exactly. Fix the producer; do not digest it.`,
      )
    }
    lines.push(`${a.key}_bytes=${filesizeHex(a.bytes.length)}`)
    lines.push(`${a.key}_crc=${crc32Hex(a.bytes)}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * boot.cmd must actually CHECK what it loads, artefact by artefact.
 *
 * The assembler writes mos-boot-digest.env into every slot whatever the script
 * does with it, so a boot.cmd that stopped reading it would leave a boot
 * partition that looks exactly like a guarded one. The file's presence is not
 * evidence that anything compares it, which is why this asserts the comparison
 * and not the filename alone: per artefact, the `${filesize}` string compare
 * against `<key>_bytes` and the `crc32 -v` against `<key>_crc`.
 */
export function checkBootDigestGuards(geometry: Geometry, bootCmd: string, path: string): void {
  const digestName = geometry.require('BOOT_DIGEST_ENV_NAME')
  if (!bootCmd.includes(digestName)) {
    throw new Error(
      `${path} never loads '${digestName}', so nothing tells it what the Image and the dtb in the `
      + `boot partition are supposed to be. 'load' succeeds on a partial or stale read -- a board `
      + `booted a mixture of two kernel builds while the console reported the full byte count -- so `
      + `an unchecked load is the whole defect RFCT-352 exists to close.`,
    )
  }
  for (const a of BOOT_DIGEST_ARTEFACTS) {
    if (!bootCmd.includes(`"\${filesize}" != "\${${a.key}_bytes}"`)) {
      throw new Error(
        `${path} does not compare \${filesize} against \${${a.key}_bytes} after loading ${a.file}; `
        + `'load' reports success on a short read and ${digestName} is what says how long the file `
        + `should have been`,
      )
    }
    if (!bootCmd.includes(`crc32 -v \${${a.addr}} \${filesize} \${${a.key}_crc}`)) {
      throw new Error(
        `${path} does not run 'crc32 -v' over the loaded ${a.file} against \${${a.key}_crc}; the byte `
        + `count alone catches a short read and NOT a full-length read that left stale bytes in the `
        + `middle, which is the failure that was actually measured on hardware`,
      )
    }
  }
}
