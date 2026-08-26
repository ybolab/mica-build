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
// The case rule, stated once here as os/mkimage-v2.sh states it once there: GPT
// tooling -- sgdisk, and therefore os/boards/cx3576/board.env -- writes GUIDs
// uppercase, while udev and libblkid write the /dev/disk/by-partuuid/ names
// lowercase, which is the form a kernel cmdline has to use. Both spellings
// denote the same GUID, so every identifier comparison folds case first: the
// rootfs producer emits lowercase and the layout is uppercase, and a literal
// comparison between them refuses a correct build.

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
 * os/update/bundle.sh writes are three copies of one string; any of them
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
      + `what os/update/bundle.sh writes into a RAUC boot payload`,
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

/** Every boot.cmd guard, in the order os/mkimage-v2.sh applies them. */
export function checkBootCmd(geometry: Geometry, bootCmd: string, path: string): void {
  checkBootAttempts(geometry, bootCmd, path)
  checkBootCmdTokens(geometry, bootCmd, path)
  checkPartitionNumbers(geometry, bootCmd, path)
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
 * The two verity tokens a slot's kernel cmdline carries, as the shell's two
 * `sed -n` substitutions yield them.
 *
 * Separate from the guards that read them, because two scripts read the same
 * two tokens out of the same two files and must agree about what they say:
 * os/mkimage-v2.sh's mkverityenv() and os/update/bundle.sh's
 * write_verity_env(). They refuse differently -- the assembler gives
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
 * rootfs producer already emits, so exactly one place computes it. What this
 * does instead is refuse a cmdline that does not describe THIS slot -- five
 * ways, each producing a slot that boots the wrong rootfs or does not boot at
 * all, and none of which the assembler could synthesise its way out of.
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
