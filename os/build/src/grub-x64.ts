// The x64 boot contract, as text: the grub.cfg the ESP carries and the per-slot
// fragment RAUC replaces on every install.
//
// THE DIVIDING LINE IS THE WHOLE POINT (RFCT-106), and it is a correctness rule
// rather than a style: grub.cfg lives on the ESP, which no install ever rewrites,
// so it may hold ONLY board constants -- each slot's PARTUUID and the fixed
// kernel arguments. Everything that changes with a build -- the sector count, the
// block sizes, the root hash, the salt -- goes into cmdline.cfg on the SLOT'S OWN
// boot partition, because "a bundle carries one image per slot CLASS, so the
// fragment's bytes have to be correct for whichever slot the install targets, and
// anything slot-specific in it would make one of the two wrong".
//
// The x64 image previously had two ESPs and no separate boot pair: RAUC installed
// the payload into the inactive ESP, which boot.mount never mounted and the
// embedded GRUB config never searched. Every update wrote the new kernel and the
// new root hash where nothing reads them, left the read copy naming the old hash,
// and rolled back on the next boot. It failed safe and could not succeed.
//
// SO THE THREE GUARDS BELOW ARE ONE ARGUMENT IN THREE PARTS, and each is useless
// without the others:
//
//   renderTemplate + unrenderedPlaceholders   a placeholder that was not
//       substituted leaves the literal `@ROOTFS_A_PARTUUID@` in a kernel command
//       line, which GRUB passes to the kernel verbatim.
//   literalHashOnLinuxLine                    a per-install fact in the one file
//       RAUC never rewrites.
//   unusedFragmentVars                        ...and without this one the check
//       above is "clean" because the linux line says nothing at all. A grub.cfg
//       that referenced no ${MOS_*} would pass the hash check perfectly and boot
//       with an empty dm-verity table.
//
// THIS FILE IS PURE. It reads no disk and runs no tool, which is what makes all
// three drivable from the failing side in milliseconds -- and every one of them
// guards a failure that announces itself only as a machine that will not boot.

import type { Geometry } from './geometry.ts'

/** The verity facts a build produces, read out of `_out/<board>/rootfs-verity.env`. */
export interface VerityFacts {
  readonly dataSectors: string
  readonly dataBlockSize: string
  readonly hashBlockSize: string
  readonly dataBlocks: string
  readonly hashStartBlock: string
  readonly hashAlgo: string
  readonly rootHash: string
  readonly salt: string
}

/**
 * The keys `cmdline_facts()` reads, in the order it prints them.
 *
 * A list rather than eight fields spelled twice: the fragment's LINE ORDER is
 * part of its bytes, and the bytes are under a byte-identity gate.
 */
export const VERITY_KEYS: readonly (readonly [keyof VerityFacts, string, string])[] = [
  ['dataSectors', 'VERITY_DATA_SECTORS', 'MOS_SECTORS'],
  ['dataBlockSize', 'VERITY_DATA_BLOCK_SIZE', 'MOS_DATA_BLOCK_SIZE'],
  ['hashBlockSize', 'VERITY_HASH_BLOCK_SIZE', 'MOS_HASH_BLOCK_SIZE'],
  ['dataBlocks', 'VERITY_DATA_BLOCKS', 'MOS_DATA_BLOCKS'],
  ['hashStartBlock', 'VERITY_HASH_START_BLOCK', 'MOS_HASH_START_BLOCK'],
  ['hashAlgo', 'VERITY_HASH_ALGO', 'MOS_HASH_ALGO'],
  ['rootHash', 'VERITY_ROOT_HASH', 'MOS_ROOT_HASH'],
  ['salt', 'VERITY_SALT', 'MOS_SALT'],
]

/**
 * The five variables a linux line must actually consume.
 *
 * os/mkimage-x64.sh:196 spells this list; it is a SUBSET of VERITY_KEYS on
 * purpose and the subset is transcribed rather than widened to all eight. The
 * three it leaves out (MOS_DATA_BLOCK_SIZE, MOS_HASH_BLOCK_SIZE, MOS_HASH_ALGO)
 * are the ones whose values are constant across every build this tree produces,
 * so a grub.cfg that hardcoded them would still boot -- wrongly, but the check
 * this list drives is about the fragment being READ AT ALL, and five variables
 * establish that as well as eight. Widening it would be a new refusal introduced
 * by a port.
 */
export const REQUIRED_FRAGMENT_VARS: readonly string[] = [
  'MOS_SECTORS', 'MOS_DATA_BLOCKS', 'MOS_HASH_START_BLOCK', 'MOS_ROOT_HASH', 'MOS_SALT',
]

/**
 * Read the verity facts out of an env-style file's text, refusing an absent key.
 *
 * The shell SOURCES this file and then reads `${VERITY_DATA_SECTORS}` under
 * `set -u`, so a missing key is already fatal there -- as "VERITY_DATA_SECTORS:
 * unbound variable", which names the key and not the file. This names both.
 *
 * A key present and EMPTY is refused too, and that is the case worth stating: an
 * empty MOS_ROOT_HASH renders as `set MOS_ROOT_HASH=` in the fragment, which
 * os/boards/x64/grub.cfg reads as "no usable cmdline.cfg" and refuses the slot --
 * so an empty value produces an image that assembles, verifies, and boots
 * neither slot.
 */
export function verityFactsFrom(text: string, path: string): VerityFacts {
  const values = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (m === null || m[1] === undefined || m[2] === undefined) continue
    values.set(m[1], m[2])
  }
  const out: Record<string, string> = {}
  for (const [field, key] of VERITY_KEYS) {
    const v = values.get(key)
    if (v === undefined || v === '') {
      throw new Error(
        `${key} is ${v === undefined ? 'missing from' : 'empty in'} ${path}, and it is one of the eight `
        + `facts the per-slot cmdline.cfg carries. GRUB reads that fragment and passes what it finds to `
        + `the kernel as a dm-verity table; a table with a hole in it does not fail at build time.`,
      )
    }
    out[field] = v
  }
  return out as unknown as VerityFacts
}

/**
 * The per-slot fragment: `cmdline_facts()` in os/mkimage-x64.sh, byte for byte.
 *
 * Identical for both slots today -- both ship the same rootfs image -- and each
 * replaced independently by an install, which is why it is written once and
 * copied to both boot partitions rather than being rendered per slot.
 */
export function cmdlineFacts(facts: VerityFacts): string {
  return `${VERITY_KEYS.map(([field, , grubVar]) => `set ${grubVar}=${facts[field]}`).join('\n')}\n`
}

/** The `@NAME@` substitutions os/mkimage-x64.sh:167-172 makes into grub.cfg. */
export function grubSubstitutions(geometry: Geometry): Record<string, string> {
  return {
    // `lower()` in the shell. The PARTUUIDs the kernel matches are lowercase;
    // the board file spells its GUIDs uppercase, and the two must be the same
    // string or dm-mod.waitfor waits for a partition that never appears.
    ROOTFS_A_PARTUUID: geometry.requirePartition('ROOTFS_A').require('GUID').toLowerCase(),
    ROOTFS_B_PARTUUID: geometry.requirePartition('ROOTFS_B').require('GUID').toLowerCase(),
    BOOT_A_PARTNUM: String(geometry.requirePartition('BOOT_A').requireInt('PARTNUM')),
    BOOT_B_PARTNUM: String(geometry.requirePartition('BOOT_B').requireInt('PARTNUM')),
    BOARD_CMDLINE_ARGS: geometry.require('BOARD_CMDLINE_ARGS'),
  }
}

/**
 * Substitute every `@NAME@` this assembler knows.
 *
 * `replaceAll` on a LITERAL `@NAME@`, not a regular expression built from the
 * value: the values here include a command line full of `.` and `=` and one of
 * them (`console=ttyS0,115200 net.ifnames=0`) would be a live pattern.
 *
 * AND THE REPLACEMENT IS A FUNCTION, for the other half of the same problem.
 * An earlier version of this comment said the right-hand side "has no
 * right-hand-side syntax at all", and that was WRONG: a *string* replacement in
 * JavaScript expands `$&`, `` $` ``, `$'`, `$$` and `$n`. `BOARD_CMDLINE_ARGS`
 * is free-form board text -- freer than the board name that carries the same
 * hazard in `bundle.ts`'s manifest -- so a kernel argument containing `$&`
 * would have been silently rewritten into the grub.cfg that boots the machine.
 * A replacer function is never scanned for those sequences.
 *
 * No board carries one today, so this moves no bytes and the x64 image gate
 * proves it: `bdf340e9…` before and after.
 */
export function renderTemplate(template: string, substitutions: Record<string, string>): string {
  let out = template
  for (const [name, value] of Object.entries(substitutions)) out = out.replaceAll(`@${name}@`, () => value)
  return out
}

/**
 * Every `@NAME@` left in a rendered file, with its 1-based line number.
 *
 * `grep -q '@[A-Z_]\+@'` in the shell, which prints the offending lines to
 * stderr; the line numbers are carried here for the same reason.
 */
export function unrenderedPlaceholders(rendered: string): { line: number, text: string }[] {
  const out: { line: number, text: string }[] = []
  rendered.split('\n').forEach((text, i) => {
    if (/@[A-Z_]+@/.test(text)) out.push({ line: i + 1, text })
  })
  return out
}

/** Every `linux` line in a GRUB config, with its 1-based line number. */
export function linuxLines(rendered: string): { line: number, text: string }[] {
  const out: { line: number, text: string }[] = []
  rendered.split('\n').forEach((text, i) => {
    if (/^[ \t]*linux[ \t]/.test(text)) out.push({ line: i + 1, text })
  })
  return out
}

/**
 * A literal hash on a `linux` line -- ASSERTED BY SHAPE, NEVER BY THE WORD.
 *
 * A run of 32 or more hex characters. os/mkimage-x64.sh records that two earlier
 * drafts of this check grepped for the word "verity" and rejected the CORRECT
 * file, "once for a comment and once for the console message printed when a
 * fragment is missing" -- so the shape is what is tested, and it is tested
 * against the RENDERED text, because the placeholders that carry the board's
 * PARTUUIDs are substituted before this runs and a PARTUUID is not a hash.
 *
 * (A GUID has 32 hex digits, but they arrive in five dash-separated groups; the
 * longest unbroken run is 12. That is why this is `{32,}` and not `{12,}`, and
 * it is asserted from both sides in grub-x64.test.ts.)
 */
export function literalHashLines(rendered: string): { line: number, text: string }[] {
  return linuxLines(rendered).filter(l => /[0-9a-f]{32,}/.test(l.text))
}

/**
 * Which of the fragment's variables no `linux` line references.
 *
 * The other half of the check above: without it, a grub.cfg whose linux line
 * carried no variables at all would be "clean" of literal hashes because it says
 * nothing -- and RAUC would install the fragment onto every slot forever while
 * GRUB read none of it.
 */
export function unusedFragmentVars(
  rendered: string,
  required: readonly string[] = REQUIRED_FRAGMENT_VARS,
): string[] {
  const lines = linuxLines(rendered)
  return required.filter(v => !lines.some(l => l.text.includes(`\${${v}}`)))
}

export interface RenderedGrubCfg {
  readonly text: string
  readonly sourcePath: string
}

/**
 * Render grub.cfg and refuse it three ways, in os/mkimage-x64.sh's order.
 *
 * The order is kept so a reader running the same broken file through both gets
 * the same sentence first.
 */
export function renderGrubCfg(geometry: Geometry, template: string, sourcePath: string): RenderedGrubCfg {
  const text = renderTemplate(template, grubSubstitutions(geometry))

  const left = unrenderedPlaceholders(text)
  if (left.length > 0) {
    throw new Error(
      `unrendered placeholder left in grub.cfg\n`
      + left.map(l => `  ${sourcePath}:${l.line}: ${l.text.trim()}`).join('\n'),
    )
  }

  const literal = literalHashLines(text)
  if (literal.length > 0) {
    throw new Error(
      `a linux line in ${sourcePath} carries a literal hash. The dm-verity root hash changes with every `
      + `build, so it belongs in the per-slot fragment RAUC installs, not in the file it must never `
      + `rewrite\n`
      + literal.map(l => `  ${l.line}: ${l.text.trim()}`).join('\n'),
    )
  }

  const unused = unusedFragmentVars(text)
  if (unused.length > 0) {
    // One sentence per variable, the shell's own, because it loops and exits on
    // the first: a reader who fixes the one they were shown should not discover
    // the next one an assembly later.
    throw new Error(
      unused
        .map(v => `no linux line in ${sourcePath} uses \${${v}}; the per-slot fragment would be installed and never read`)
        .join('\n'),
    )
  }

  return { text, sourcePath }
}

/**
 * The GRUB modules embedded in BOOTX64.EFI, and the early config that finds the
 * real one.
 *
 * `regexp` is in the list because grub.cfg uses it to take the disk out of $root
 * and address each slot's boot partition on the SAME disk. Without it the command
 * silently does nothing, mos_disk stays empty, and every menuentry looks for its
 * kernel on a device spelled ",gpt2".
 */
export const GRUB_MODULES: readonly string[] = [
  'part_gpt', 'fat', 'search', 'search_label', 'configfile', 'linux', 'normal', 'echo', 'test',
  'loadenv', 'regexp',
]

/**
 * The memdisk config grub-mkstandalone embeds.
 *
 * grub-install writes into a MOUNTED ESP and this assembler never mounts
 * anything -- a loop mount needs privileges a build should not want. So GRUB
 * arrives as one self-contained EFI binary and this three-line config is the
 * only thing it needs to find the real one.
 */
export function earlyCfg(espFatLabel: string): string {
  return `search --no-floppy --label ${espFatLabel} --set root\n`
    + `set prefix=($root)/EFI/mos\n`
    + `configfile ($root)/EFI/mos/grub.cfg\n`
}
