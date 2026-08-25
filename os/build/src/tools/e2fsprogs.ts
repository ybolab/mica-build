// mke2fs, dumpe2fs and debugfs: the ext4 filesystems, and the timestamps in them.
//
// FAILURE SIGNALS, and they are not the same one:
//
//   mke2fs    exit status.
//   dumpe2fs  exit status, plus a header this parser must actually understand
//             -- a field it cannot read is refused rather than defaulted.
//   debugfs   ITS STDERR. debugfs EXITS 0 even when an individual command
//             inside it failed, so its exit status says nothing. This is the
//             single most important line in os/mkimage-common.sh's header:
//             "Silencing the stream instead would let a rename of `sif` turn
//             this into a no-op that still reports success."
//
// That is three tools in one toolset with three different answers to "did it
// work", which is why toolbox.run() interprets none of them.
//
// WHY THIS IS THE CONTAINER-SIDE CASE. The layouts ask for `-O ^orphan_file`,
// which needs e2fsprogs >= 1.47; this campaign's host carries 1.46.5. So
// everything in this file runs in the toolbox's container on this machine, and
// os/mkimage-x64.sh's header says the same of its own host: "It runs INSIDE the
// container, because the host cannot: mke2fs 1.46.5, no sgdisk, no mcopy." The
// toolbox measures that with a probe rather than assuming it either way.
//
// WHAT IS DELIBERATELY NOT HERE: pin_seeded_times(). That function is not a
// utility, it is an ARGUMENT -- which of an inode's four timestamps are the
// producer's data and which are the assembler's noise, why the inode set must
// come from the bitmap rather than from a walk of the source tree, and why
// debugfs's stderr rather than its exit status is the failure signal. It lives
// in os/mkimage-common.sh so that its two callers cannot drift, and it ports
// WITH those callers in M6b and M6c, not separately and not early. What this
// file provides is the three primitives it is built out of, each with its own
// signal handled correctly, so that the port is a translation rather than a
// rediscovery.

import type { Toolbox, ToolResult } from '../toolbox.ts'
import { ToolError } from '../toolbox.ts'

export interface Mke2fsSpec {
  readonly image: string
  /** `-L`. */
  readonly label: string
  /** `-U`. The pinned filesystem UUID from the board definition. */
  readonly uuid: string
  /** `-b`. EXT4_BLOCK_SIZE. */
  readonly blockSize: bigint
  /** `-O`. EXT4_FEATURES, e.g. `^orphan_file,^metadata_csum_seed`. */
  readonly features: string
  /**
   * `-d`. Seeds the filesystem from a directory tree.
   *
   * A seeded filesystem is the one that needs the timestamp pass afterwards:
   * mke2fs -d copies the SOURCE inode's atime, mtime and ctime in, and two of
   * those three are the assembler's own noise.
   */
  readonly seedDir?: string
  /**
   * E2FSPROGS_FAKE_TIME. mke2fs reads it out of the ENVIRONMENT, like mkimage's
   * SOURCE_DATE_EPOCH; it pins the times mke2fs INVENTS and reaches none of the
   * times copied in by -d.
   */
  readonly fakeTime: string
  /** `-n`: lay the superblock out and write nothing. For probing a host's mke2fs. */
  readonly dryRun?: boolean
}

export function mke2fsArgs(spec: Mke2fsSpec): string[] {
  if (spec.blockSize <= 0n) throw new Error(`mke2fs was given -b ${spec.blockSize} for ${spec.image}`)
  if (spec.features.trim() === '') {
    // An empty -O is not "the defaults": it is `-O ''`, which mke2fs may take
    // as a request to clear the feature set. The layouts always name one.
    throw new Error(
      `mke2fs was given an empty -O for ${spec.image}. EXT4_FEATURES is what makes an ext4 in this `
      + `image reproducible, and an empty feature list is a different filesystem, not a default one.`,
    )
  }
  const argv = ['mke2fs', '-q']
  if (spec.dryRun === true) argv.push('-n')
  argv.push(
    '-t', 'ext4',
    '-b', String(spec.blockSize),
    '-L', spec.label,
    '-U', spec.uuid,
    '-O', spec.features,
    // hash_seed pinned to the filesystem's OWN uuid: left to itself mke2fs
    // draws it at random and writes it into the superblock, and root_owner
    // keeps the container's uid map out of the image.
    '-E', `root_owner=0:0,hash_seed=${spec.uuid}`,
  )
  if (spec.seedDir !== undefined) argv.push('-d', spec.seedDir)
  argv.push(spec.image)
  return argv
}

/** Format one ext4 filesystem into a standalone image file. */
export async function mke2fs(tb: Toolbox, spec: Mke2fsSpec): Promise<ToolResult> {
  if (!/^[0-9]+$/.test(spec.fakeTime)) {
    throw new Error(
      `mke2fs was given E2FSPROGS_FAKE_TIME="${spec.fakeTime}" for ${spec.image}, which is not an `
      + `epoch. Unset, mke2fs stamps every time it invents with the wall clock and says nothing -- so `
      + `the failure is an image that differs on every build, visible only to a byte comparison.`,
    )
  }
  return tb.must(mke2fsArgs(spec), {
    env: { E2FSPROGS_FAKE_TIME: spec.fakeTime },
    note: `mke2fs could not format ${spec.image}`,
  })
}

export interface Ext4Header {
  readonly inodeCount: bigint
  readonly freeInodes: bigint
  readonly firstInode: bigint
  readonly blockCount: bigint
  readonly blockSize: bigint
  readonly uuid: string
  readonly label: string
  /** Every `Name: value` line, for a caller that wants a field this shape does not name. */
  readonly fields: ReadonlyMap<string, string>
}

/**
 * `dumpe2fs -h`, parsed -- and refusing a header it cannot read.
 *
 * The refusal is the point. pin_seeded_times computes how many inodes it
 * expects to rewrite as `count - free - (first - 1)`, and os/mkimage-common.sh
 * checks each of those three is a number before using it, because "a future
 * dumpe2fs [that] changes how it prints ranges" would otherwise silently pin
 * nothing "and hand the byte-identity check a fake pass". A parser that
 * returned 0 for a field it could not find would arrive at exactly that.
 */
export async function dumpe2fsHeader(tb: Toolbox, image: string): Promise<Ext4Header> {
  // dumpe2fs writes its version banner to stderr on every run, so stderr is
  // NOT this tool's failure signal either -- the exit status is.
  const r = await tb.must(['dumpe2fs', '-h', image], {
    note: `dumpe2fs could not read the superblock of ${image}`,
  })

  const fields = new Map<string, string>()
  for (const line of r.stdout.split('\n')) {
    const m = /^([A-Za-z][^:]*):\s+(.*)$/.exec(line)
    if (m !== null && m[1] !== undefined && m[2] !== undefined) fields.set(m[1], m[2].trim())
  }
  if (fields.size === 0) {
    throw new ToolError(r, `dumpe2fs -h ${image} printed no "Name: value" line at all`)
  }

  const num = (name: string): bigint => {
    const v = fields.get(name)
    if (v === undefined || !/^[0-9]+$/.test(v)) {
      throw new ToolError(
        r,
        `dumpe2fs -h ${image} gave "${name}" as ${v === undefined ? '(absent)' : JSON.stringify(v)}, `
        + `not a number. Every count taken off this header feeds arithmetic whose wrong answer is a `
        + `filesystem that differs between builds, so an unreadable field is refused rather than `
        + `defaulted to zero`,
      )
    }
    return BigInt(v)
  }

  return {
    inodeCount: num('Inode count'),
    freeInodes: num('Free inodes'),
    firstInode: num('First inode'),
    blockCount: num('Block count'),
    blockSize: num('Block size'),
    uuid: fields.get('Filesystem UUID') ?? '',
    label: fields.get('Filesystem volume name') ?? '',
    fields,
  }
}

/** `dumpe2fs` in full, for a caller that needs the group listing (the free-inode ranges). */
export async function dumpe2fsFull(tb: Toolbox, image: string): Promise<string> {
  const r = await tb.must(['dumpe2fs', image], { note: `dumpe2fs could not read ${image}` })
  return r.stdout
}

/**
 * Run a debugfs command script against a filesystem, in place.
 *
 * THE STDERR IS THE VERDICT. debugfs exits 0 even when an individual command
 * inside it failed, so its exit status cannot be the signal; everything on
 * stderr but the version banner is an error. os/mkimage-common.sh:
 *
 *     errs="$(debugfs -w -f "${cmds}" "${img}" 2>&1 >/dev/null | grep -v '^debugfs [0-9]' || true)"
 *
 * and its comment on why the stream is read rather than silenced: "Silencing
 * the stream instead would let a rename of `sif` turn this into a no-op that
 * still reports success."
 *
 * @param commandsFile a path -- debugfs's `-f`, which is how the shell hands it
 *   a script too. Both sides of the container boundary see the same path.
 */
export async function debugfsApply(tb: Toolbox, image: string, commandsFile: string): Promise<ToolResult> {
  const r = await tb.run(['debugfs', '-w', '-f', commandsFile, image])
  // The exit status still matters when it is nonzero -- debugfs failing to OPEN
  // the filesystem does say so that way. It is just not sufficient.
  if (!r.ok) throw new ToolError(r, `debugfs could not open ${image}`)

  const errs = r.stderr.split('\n')
    .filter(l => l.trim() !== '')
    .filter(l => !/^debugfs [0-9]/.test(l))
  if (errs.length > 0) {
    throw new ToolError(
      r,
      `debugfs exited 0 and reported errors on stderr while applying ${commandsFile} to ${image}. `
      + `Its exit status is not its verdict -- an individual command inside it can fail while the run `
      + `succeeds -- so these lines are the failure:\n          ${errs.join('\n          ')}`,
    )
  }
  return r
}
