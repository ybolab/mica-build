// mtools and mkfs.vfat: the FAT filesystems, which the firmware reads.
//
// FAILURE SIGNAL. Exit status for mcopy, mmd and mdir. NOT for mkfs.vfat, and
// that is the point of this file.
//
// mkfs.vfat -F 32 DOES NOT ENFORCE FAT32. Given a partition too small to hold
// 65525 clusters it writes a FAT32 boot sector over a filesystem that is not
// FAT32, exits 0, and every tool that trusts the boot sector agrees with it.
// os/mkimage-x64.sh records what that cost: OVMF computes the type the way the
// specification says, refuses the filesystem, and "the ESP was simply absent
// from the firmware's device list and the machine dropped to the UEFI shell".
// It also records that the FIRST version of that check asked minfo for the TYPE
// and passed on the exact image that would not boot. So the check that works is
// a CLUSTER COUNT, and readFatClusters below is it -- with an unreadable count
// refused rather than compared, because `[ "" -lt 65525 ]` is a shell error and
// `undefined < 65525` is false.
//
// REPRODUCIBILITY. `--invariant` on mkfs.vfat (without it the volume-label
// directory entry carries the wall clock) and `-m` on mcopy (each entry keeps
// its source's mtime, which the caller has pinned). Both are required fields
// rather than defaults for the same reason SOURCE_DATE_EPOCH is in mkimage.ts:
// the failure they prevent is an image that differs between builds and nothing
// that reports it.

import type { Toolbox, ToolResult } from '../toolbox.ts'
import { ToolError } from '../toolbox.ts'

/** The FAT specification's floor. Below it, a FAT32 boot sector is a lie. */
export const FAT32_MIN_CLUSTERS = 65525n

export interface FatSpec {
  readonly image: string
  /** `-n`. BOOT_A_FAT_LABEL and friends. */
  readonly label: string
  /**
   * `-i`. The volume ID, hex, pinned in the board definition.
   *
   * OPTIONAL, AND ITS ABSENCE IS A DECISION ONE CALLER MAKES. Both assemblers
   * pin it, because a slot's filesystem is that slot's: BOOT_A carries
   * C3576003 and BOOT_B C3576004, and an image whose volume id came out
   * different from the pinned one is a reproducibility failure only a byte
   * comparison would see. os/update/bundle.sh pins NEITHER label nor volume
   * id, and says why: "one image, two possible destinations" -- a bundle's
   * boot payload is installed into whichever boot slot is inactive, so it
   * cannot carry that slot's FAT identity. `--invariant` is what keeps the
   * volume id off the wall clock in that case, and it is passed either way.
   */
  readonly volumeId?: string
}

export function mkfsVfatArgs(spec: FatSpec): string[] {
  if (spec.volumeId === undefined) {
    // No -i. --invariant still applies: without it mkfs.vfat derives the
    // volume id from the current time and the filesystem differs per build.
    return ['mkfs.vfat', '--invariant', '-F', '32', '-n', spec.label, spec.image]
  }
  if (!/^[0-9A-Fa-f]{8}$/.test(spec.volumeId)) {
    // mkfs.vfat takes -i as hex and a malformed one is not always refused;
    // a volume ID that came out different from the one pinned would be a
    // reproducibility failure that only a byte comparison could see.
    throw new Error(
      `mkfs.vfat was given -i "${spec.volumeId}" for ${spec.image}, which is not eight hex digits. `
      + `The board definitions pin these (BOOT_A_FAT_VOLUME_ID=C3576003) precisely so the filesystem `
      + `rebuilds identically.`,
    )
  }
  return ['mkfs.vfat', '--invariant', '-F', '32', '-n', spec.label, '-i', spec.volumeId, spec.image]
}

/**
 * Format a FAT32 filesystem.
 *
 * This does NOT check that what it made is FAT32 -- see readFatClusters, and
 * see the header for why the check is a cluster count and not a type. Keeping
 * them apart is deliberate: the size that makes a FAT32 possible is a property
 * of the LAYOUT, so refusing it belongs where the layout is decided (M6c),
 * not inside a call that formats whatever it is handed.
 */
export async function mkfsVfat(tb: Toolbox, spec: FatSpec): Promise<ToolResult> {
  return tb.must(mkfsVfatArgs(spec), { note: `mkfs.vfat could not format ${spec.image}` })
}

/**
 * The cluster count minfo reports, refusing an answer it could not read.
 *
 * `[ -z "${esp_clusters}" ]` is the shell's version of this refusal and it is
 * the half that matters: without it, an unreadable count compares as smaller
 * than everything, or as nothing at all, depending on the language.
 */
export async function readFatClusters(tb: Toolbox, image: string): Promise<bigint> {
  const r = await tb.must(['minfo', '-i', image], { note: `minfo could not read ${image}` })
  const text = `${r.stdout}${r.stderr}`
  const m = /^free clusters=([0-9]+)$/m.exec(text)
  if (m === null || m[1] === undefined) {
    throw new ToolError(
      r,
      `minfo printed no "free clusters=" line for ${image}, so its cluster count cannot be compared `
      + `against the ${FAT32_MIN_CLUSTERS} the FAT specification requires for FAT32. An unread count `
      + `is not a small count and must not compare as one`,
    )
  }
  return BigInt(m[1])
}

export interface McopySpec {
  readonly image: string
  /** Host paths. A trailing `/*` is the caller's business; nothing globs here. */
  readonly sources: readonly string[]
  /** The destination inside the filesystem, e.g. `::/` or `::/vmlinuz`. */
  readonly destination: string
  /** `-s`, for copying a directory tree. */
  readonly recursive?: boolean
}

export function mcopyArgs(spec: McopySpec): string[] {
  if (spec.sources.length === 0) {
    // `mcopy -i img ::/` with no source is a usage error on some mtools and a
    // no-op on others. Neither is "the files were copied".
    throw new Error(`mcopy was asked to copy nothing into ${spec.image}${spec.destination}`)
  }
  if (!spec.destination.startsWith('::')) {
    // A destination that is not `::`-prefixed is a HOST path, and mcopy would
    // copy OUT of the image instead of into it -- succeeding, in the wrong
    // direction.
    throw new Error(
      `mcopy's destination "${spec.destination}" does not start with "::", so mtools reads it as a `
      + `path on the host and the copy runs OUT of ${spec.image} rather than into it -- successfully.`,
    )
  }
  const argv = ['mcopy']
  if (spec.recursive === true) argv.push('-s')
  // -m: keep each entry's mtime, which the caller pinned with `touch -d`.
  argv.push('-m', '-i', spec.image, ...spec.sources, spec.destination)
  return argv
}

/** Copy into a FAT filesystem, keeping the source's mtime. */
export async function mcopy(tb: Toolbox, spec: McopySpec): Promise<ToolResult> {
  return tb.must(mcopyArgs(spec), {
    note: `mcopy could not copy ${spec.sources.join(' ')} into ${spec.image}${spec.destination}`,
  })
}

/**
 * `mmd` -- make a directory inside a FAT filesystem.
 *
 * os/mkimage-x64.sh measured that mmd plus per-file `mcopy -m` still moves
 * bytes between builds, because mmd has no source to take a time from and
 * stamps the directory entry with the wall clock; it stages a TREE and copies
 * it with `mcopy -s -m` instead. This is here because the tool is in the
 * toolset, with that reason attached to it.
 */
export async function mmd(tb: Toolbox, image: string, path: string): Promise<ToolResult> {
  if (!path.startsWith('::')) throw new Error(`mmd's path "${path}" does not start with "::"`)
  return tb.must(['mmd', '-i', image, path], { note: `mmd could not create ${path} in ${image}` })
}

/**
 * Every path in a FAT filesystem, one per line, sorted.
 *
 * `mdir -/ -b` is the flat recursive listing both assemblers compare slots
 * with. An empty listing is refused: a filesystem with no files in it is what
 * a failed copy leaves behind, and "the two slots contain the same files" is
 * satisfied by two empty slots.
 */
export async function listFat(tb: Toolbox, image: string, path = '::/'): Promise<string[]> {
  const r = await tb.must(['mdir', '-/', '-b', '-i', image, path], {
    note: `mdir could not list ${path} in ${image}`,
  })
  const entries = r.stdout.split('\n').map(l => l.trim()).filter(l => l !== '').sort()
  if (entries.length === 0) {
    throw new ToolError(
      r,
      `mdir listed nothing under ${path} in ${image}. An empty filesystem is what a failed copy leaves `
      + `behind, and every comparison built on this listing -- "both slots carry the same files", "no `
      + `stray entry at the root" -- is satisfied by two empty ones`,
    )
  }
  return entries
}
