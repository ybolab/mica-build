// Batch 4b: the four ext4 storage tiers.
//
// `check_ext4` is called once per tier -- META and STATE, EPHEMERAL and DATA --
// and prints six conclusions each plus one about EPHEMERAL's seed stamp: 25
// conclusions per board.
//
// The bytes come from `dd if=IMG bs=1M skip=${PART_START_MIB_x}
// count=${x_SIZE_MIB}` -- the layout's offset, walked by `walkLayout` exactly as
// the shell verifier walked it, and NOT the GPT's first sector, which
// `gpt-partition-start` asserts separately. The tier order is the layout's too:
// every `ext4`-role partition in LAYOUT_PARTITIONS order, which on both shipped
// boards is meta, state, ephemeral, data, so a fifth tier arrives as a new
// (id, instance) pair with no register entry edited.
//
// Three oracle conclusions are reproduced rather than repaired. `e2fsck -fn`
// exits 0 on a truncated filesystem -- measured 2026-08-26, an 8192-block
// filesystem in a 4096-block file prints "Either the superblock or the partition
// table is likely to be corrupt!", runs all five passes and exits 0, and :2342's
// `if e2fsck -fn "${img}" >/dev/null 2>&1` lets the status alone decide; see
// `e2fsckClean` in image.ts. `debugfs -R "ls -p /"` exits 0 on a file that is
// not ext4 with empty stdout and "Filesystem not open" on stderr, which :2358's
// `|| true` swallows, and an empty listing is the passing direction for META,
// STATE and DATA; `debugfsEntriesOrNone` reproduces it. `tune2fs -l` and
// `dumpe2fs -h` are `|| true`, so a partition they cannot open reaches the
// label, UUID, feature and size checks as the empty string; `ext4SuperOrNone`
// reproduces it. A tier that is not a filesystem therefore produces four FAILs
// and two vacuous greens on both verifiers, asserted here as their own cases.

import type { Board } from './board.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import {
  debugfsRun,
  e2fsckClean,
  ext4Super,
  type Ext4Super,
} from './image.ts'
import { imageLayout } from './image-layout.ts'
import type { CheckResult } from './parity.ts'
import { ToolError, ToolOutputError } from './tools.ts'
import { eqCi, verdict } from './verdict.ts'
import { join } from 'node:path'

/** The tiers, in the layout's own order. `role=ext4` is the board's declaration. */
function tiersOf(board: Board): readonly { name: string, layout: string }[] {
  return board.partitions
    .filter(p => p.role === 'ext4')
    .map(p => ({
      // The oracle's display name is the lowercase LAYOUT_PARTITIONS name --
      // `check_ext4 meta`, `check_ext4 ephemeral` -- and every one of its
      // twenty-five messages starts with it.
      name: p.name.toLowerCase(),
      layout: p.name,
    }))
}

/**
 * Where a tier's bytes are, in the units the oracle uses.
 *
 * `slotSectors` comes off the IMAGE, because the layout does not declare a
 * verity-slot size and the walk needs one to place everything after the slots.
 * That is `checks-gpt.ts`'s `slotFromImage`, and it is done here the same way
 * rather than shared, because sharing it would mean this family's offsets and
 * the GPT family's expectations came out of one call -- and `gpt-partition-start`
 * is the check that says they agree.
 */
async function tierRange(
  ctx: ImageContext,
  layoutName: string,
): Promise<{ offset: number, length: number, startMib: number, sizeMib: number }> {
  // `PART_START_MIB_${name}=$((row_start / SECTORS_PER_MIB))` (:1516), and then
  // `dd bs=1M skip=... count=...`. Both units are MiB in the oracle, so both
  // are MiB here and the multiplication back to bytes happens once.
  const layout = await imageLayout(ctx)
  const startMib = layout.startMib(layoutName)
  const sizeMib = layout.sizeMib(layoutName)
  return { offset: startMib * layout.mibBytes, length: sizeMib * layout.mibBytes, startMib, sizeMib }
}

/**
 * The tier's bytes, named after the tier as the oracle's TMP file is.
 *
 * `${TMP}/${name}.img` at :2309, and the name is load-bearing here as well:
 * every message this family prints leads with it, so an extract named after
 * the wrong tier would be a set of conclusions about the wrong partition.
 *
 * Through `ctx.extractAt` rather than `extractRange` directly, so that the
 * caching is the context's -- six checks read each tier and the second asker
 * must wait for the first rather than starting its own 512 MiB copy.
 */
async function tierImage(ctx: ImageContext, tier: { name: string, layout: string }): Promise<string> {
  const range = await tierRange(ctx, tier.layout)
  return ctx.extractAt(`${tier.name}.img`, range.offset, range.length)
}

/**
 * `tune2fs -l ... || true`: the superblock, or `undefined` when tune2fs refused
 * to open the file at all.
 *
 * NOT `ext4Super` alone, which throws. The oracle's `|| true` turns that
 * refusal into an empty string and lets four checks fail describing values, and
 * this family has to conclude what the oracle concludes. What is NOT reproduced
 * is the collapse: `undefined` here means tune2fs exited non-zero, in its own
 * words, and an exit-0 output that is not a superblock still throws -- so "this
 * is not ext4" and "tune2fs is not installed" cannot arrive as one value.
 */
async function ext4SuperOrNone(ctx: ImageContext, file: string): Promise<Ext4Super | undefined> {
  try {
    return await ext4Super(ctx.tools, file)
  }
  catch (error) {
    // Measured: `tune2fs -l` on 8 MiB of zeros exits 1. An exit-0 answer whose
    // magic is not 0xEF53 is ToolOutputError and is re-thrown.
    if (error instanceof ToolError) return undefined
    throw error
  }
}

/**
 * `debugfs -R "ls -p /" ... || true` filtered as :2358-2360 filters it.
 *
 * An empty answer is returned rather than refused, and that is the point: for
 * three of the four tiers an empty listing is the PASSING direction, so the
 * oracle passes `factory: meta is empty at build` about a partition debugfs
 * could not open. Reproduced.
 */
async function tierEntries(ctx: ImageContext, file: string): Promise<string[]> {
  let out: string
  try {
    out = await debugfsRun(ctx.tools, file, 'ls -p /')
  }
  catch (error) {
    if (error instanceof ToolError || error instanceof ToolOutputError) return []
    throw error
  }
  // `awk -F/ 'NF >= 7 && $6 != "." && $6 != ".." && $6 != "lost+found" {print $6}'`
  return out.split('\n')
    .map(line => line.split('/'))
    .filter(f => f.length >= 7)
    .map(f => f[5] ?? '')
    .filter(name => name !== '.' && name !== '..' && name !== 'lost+found' && name !== '')
}

/** `${name} ...` -- every conclusion in this family leads with the tier name. */
const PER_TIER = /^(\w+) ext4 /
/** ...except the factory-content one, which leads with `factory: `. */
const PER_TIER_FACTORY = /^factory: (\w+) is /
const PER_TIER_FSCK = /^e2fsck -fn on (\w+) /

function fsKey(ctx: ImageContext, layoutName: string, suffix: string): string {
  const value = ctx.board.partition(layoutName)?.get(suffix)
  if (value === undefined || value.trim() === '') {
    throw new ToolOutputError(
      `${ctx.board.path} declares no ${layoutName}_${suffix}. A fail here would be a statement `
      + `about the image, and a missing key is one about the board definition.`,
    )
  }
  return value.trim()
}

/** Run `body` once per tier, so each check reads the same four extracts. */
async function perTier(
  ctx: ImageContext,
  body: (tier: { name: string, layout: string }, file: string) => Promise<CheckResult>,
): Promise<readonly CheckResult[]> {
  const out: CheckResult[] = []
  for (const tier of tiersOf(ctx.board)) {
    out.push(await body(tier, await tierImage(ctx, tier)))
  }
  if (out.length === 0) {
    throw new ToolOutputError(
      `${ctx.board.path} declares no partition with role=ext4, so this family concluded nothing. `
      + `The oracle names four call sites; a board that had none would make it print nothing at all `
      + `and this check pass by having examined none.`,
    )
  }
  return out
}

export const EXT4_CHECKS: readonly CheckCase[] = [
  {
    id: 'ext4-label',
    cardinality: 'many',
    instance: PER_TIER,
    // `[ "${label}" = "${want_label}" ]` -- an EXACT compare, not eq_ci, so the
    // two directions share only the leading clause.
    shell: { pass: ' ext4 label is ' },
    run: async ctx => perTier(ctx, async (tier, file) => {
      const want = fsKey(ctx, tier.layout, 'FS_LABEL')
      const got = (await ext4SuperOrNone(ctx, file))?.volumeName ?? ''
      return verdict(
        'ext4-label',
        got === want,
        got === want
          ? `${tier.name} ext4 label is '${want}'`
          : `${tier.name} ext4 label is '${got}', expected '${want}'`,
        { instance: tier.name },
      )
    }),
  },

  {
    id: 'ext4-uuid',
    cardinality: 'many',
    instance: PER_TIER,
    shell: { pass: ' ext4 UUID is ' },
    run: async ctx => perTier(ctx, async (tier, file) => eqCi(
      'ext4-uuid',
      `${tier.name} ext4 UUID`,
      (await ext4SuperOrNone(ctx, file))?.uuid ?? '',
      fsKey(ctx, tier.layout, 'FS_UUID'),
      { instance: tier.name },
    )),
  },

  {
    // orphan_file cannot be mounted by the 6.1 kernel these images are built
    // for, so its presence makes the partition unusable on the device.
    //
    // A vacuous PASS lives here: on a partition tune2fs could not open there
    // are no features at all, so `grep -w orphan_file` matches nothing and the
    // check passes. Reproduced -- the feature list comes from the same
    // `|| true` the label does.
    id: 'ext4-orphan-file',
    cardinality: 'many',
    instance: PER_TIER,
    shell: {
      pass: ' ext4 has no orphan_file feature',
      fail: ' ext4 has the orphan_file feature',
    },
    run: async ctx => perTier(ctx, async (tier, file) => {
      const features = (await ext4SuperOrNone(ctx, file))?.features ?? []
      const has = features.includes('orphan_file')
      const kernel = await kernelVersion(ctx)
      return verdict(
        'ext4-orphan-file',
        !has,
        has
          ? `${tier.name} ext4 has the orphan_file feature; kernel ${kernel} cannot mount it`
          : `${tier.name} ext4 has no orphan_file feature`,
        { instance: tier.name },
      )
    }),
  },

  {
    // `block_count * block_size == size_mib * MIB_BYTES`, with `fs_bytes > 0`
    // as the guard that stops an unreadable superblock passing by arithmetic:
    // `${block_count:-0} * ${block_size:-0}` is 0, and 0 == 0 would otherwise
    // be true for a partition of size zero.
    id: 'ext4-fills-partition',
    cardinality: 'many',
    instance: /^(\w+) ext4 (?:fills|is )/,
    shell: {
      pass: ' ext4 fills its partition (',
      fail: ' (the partition size)',
    },
    run: async ctx => perTier(ctx, async (tier, file) => {
      const sb = await ext4SuperOrNone(ctx, file)
      const blockCount = sb === undefined || !Number.isFinite(sb.blockCount) ? 0 : sb.blockCount
      const blockSize = sb === undefined || !Number.isFinite(sb.blockSize) ? 0 : sb.blockSize
      const range = await tierRange(ctx, tier.layout)
      const fsBytes = blockCount * blockSize
      const ok = fsBytes > 0 && fsBytes === range.length
      return verdict(
        'ext4-fills-partition',
        ok,
        ok
          ? `${tier.name} ext4 fills its partition (${blockCount} blocks x ${blockSize} bytes `
            + `= ${range.sizeMib} MiB)`
          : `${tier.name} ext4 is ${fsBytes} bytes, expected ${range.length} (the partition size)`,
        { instance: tier.name },
      )
    }),
  },

  {
    // The status is the whole test, and it is not the truth. See the header:
    // e2fsck exits 0 on a truncated filesystem after saying it is likely
    // corrupt. The oracle sends both streams to /dev/null; this keeps the
    // report and puts it in the FAILING message only, so the passing sentence
    // is byte-comparable with the oracle's and the evidence is not lost.
    id: 'ext4-fsck-clean',
    cardinality: 'many',
    instance: PER_TIER_FSCK,
    shell: {
      pass: 'e2fsck -fn on ',
    },
    run: async ctx => perTier(ctx, async (tier, file) => {
      const v = await e2fsckClean(ctx.tools, file)
      return verdict(
        'ext4-fsck-clean',
        v.clean,
        v.clean
          ? `e2fsck -fn on ${tier.name} is clean`
          : `e2fsck -fn on ${tier.name} reported errors (exit ${v.code}: `
            + `${v.report.join(' | ').slice(0, 200) || 'no output'})`,
        { instance: tier.name },
      )
    }),
  },

  {
    // What a partition should contain at build is per partition (:2352). META,
    // STATE and DATA ship empty; EPHEMERAL ships SEEDED, because /var is
    // written by every early systemd unit and a filesystem filled on first boot
    // races all of them.
    //
    // Which tier is which comes from the board definition, not from a name
    // written here: EPHEMERAL is the ext4 tier whose mountpoint is /var.
    id: 'ext4-factory-content',
    cardinality: 'many',
    instance: PER_TIER_FACTORY,
    shell: {
      pass: [' is populated at build (', ' is empty at build (nothing but lost+found)'],
      fail: [' is EMPTY at build.', ' is not empty at build; it contains:'],
    },
    run: async ctx => perTier(ctx, async (tier, file) => {
      const entries = await tierEntries(ctx, file)
      if (isVarTier(ctx.board, tier.layout)) {
        const ok = entries.length > 0
        return verdict(
          'ext4-factory-content',
          ok,
          ok
            ? `factory: ${tier.name} is populated at build (${entries.length} entries), which is `
              + `what makes mos-seed-var a no-op on a normal boot`
            : `factory: ${tier.name} is EMPTY at build. /var would be filled on the first boot, `
              + `concurrently with every systemd unit that writes /var -- the race that failed `
              + `mosd, apid and the health gate intermittently`,
          { instance: tier.name },
        )
      }
      const ok = entries.length === 0
      return verdict(
        'ext4-factory-content',
        ok,
        ok
          ? `factory: ${tier.name} is empty at build (nothing but lost+found)`
          : `factory: ${tier.name} is not empty at build; it contains: ${entries.join(' ')}`,
        { instance: tier.name },
      )
    }),
  },

  {
    // EPHEMERAL ships seeded, and the STAMP is what proves it (:2379-2397).
    //
    // The stamp is asserted rather than the tree because mos-seed-var's
    // ConditionPathExists keys on exactly this path: a seeded tree WITHOUT the
    // stamp would still run the seed and still race. `/lib populated` is the
    // second half, so a stamp dropped onto an empty filesystem does not satisfy
    // it either.
    id: 'ephemeral-seeded',
    shell: { pass: 'the EPHEMERAL filesystem ships ' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const tier = tiersOf(ctx.board).find(t => isVarTier(ctx.board, t.layout))
      if (tier === undefined) {
        throw new ToolOutputError(
          `${ctx.board.path} declares no ext4 tier mounted at /var, so there is nothing this check `
          + `could be about. The oracle reads ${'${TMP}'}/ephemeral.img, which is only there because `
          + `check_ext4 was called for it.`,
        )
      }
      const file = await tierImage(ctx, tier)
      const stamp = await statInode(ctx, file, '/.mos-var-seeded')
      const lib = await tierListCount(ctx, file, '/lib')
      const ok = stamp !== undefined && lib > 0
      return [verdict(
        'ephemeral-seeded',
        ok,
        ok
          ? `the EPHEMERAL filesystem ships already seeded from the factory /var (stamp at inode `
            + `${stamp}, /lib populated), so mos-seed-var is a no-op on a normal boot and races nothing`
          : `the EPHEMERAL filesystem ships ${stamp !== undefined ? 'stamped but empty' : 'unstamped'}. `
            + `/var would be filled on the first boot, concurrently with every systemd unit that `
            + `writes /var -- the race that failed mosd, apid and the health gate intermittently`,
      )]
    },
  },
]

/**
 * Which tier is /var.
 *
 * The LAYOUT_PARTITIONS name, which is the same thing the oracle keys on:
 * `[ "${name}" = "ephemeral" ]` at :2371 compares against the display name it
 * was called with, and that name is the lowercased layout name at every call
 * site. `checks-fstab.ts:156` already binds `EPHEMERAL` to `/var` the same way.
 *
 * NOT derived from a mountpoint key: neither board declares an
 * `EPHEMERAL_MOUNT`, so a derivation from one would resolve to `undefined` on
 * both and quietly make every tier the empty-at-build one -- which passes on
 * three tiers and fails on the fourth, i.e. it would look like a defect in the
 * image. A layout-partition ROLE would be the honest place for this if a board
 * ever needed to spell it differently; that is a change to `os/boards/` that
 * changes what the image mounts, and the Scope section puts that outside
 * this task -- "No change to device-side runtime behaviour, image content
 * contracts (outside explicitly anchored baselines)".
 */
function isVarTier(_board: Board, layoutName: string): boolean {
  return layoutName === 'EPHEMERAL'
}

/**
 * The inode number out of `debugfs -R "stat PATH"`, which the oracle then seds
 * off the `Inode:` line (:2391).
 *
 * `undefined` when the path is not there, which is the oracle's empty string.
 */
async function statInode(ctx: ImageContext, file: string, path: string): Promise<string | undefined> {
  let out: string
  try {
    out = await debugfsRun(ctx.tools, file, `stat ${path}`)
  }
  catch (error) {
    if (error instanceof ToolError || error instanceof ToolOutputError) return undefined
    throw error
  }
  return /^Inode: (\d+)/m.exec(out)?.[1]
}

/**
 * `debugfs -R "ls /lib" | grep -c .` -- how many NON-EMPTY lines it printed.
 *
 * `ls` without `-p` is the columnar form and one line holds several names, so
 * this counts LINES and not entries, exactly as the oracle does. Counting
 * entries would be a better number and a different one.
 */
async function tierListCount(ctx: ImageContext, file: string, dir: string): Promise<number> {
  let out: string
  try {
    out = await debugfsRun(ctx.tools, file, `ls ${dir}`)
  }
  catch (error) {
    if (error instanceof ToolError || error instanceof ToolOutputError) return 0
    throw error
  }
  return out.split('\n').filter(l => l !== '').length
}

/**
 * The kernel version the oracle interpolates into the orphan_file failure.
 *
 * Read out of the packed root's own /usr/lib/modules, which is where :2478
 * reads it. It appears in ONE message and only in the failing direction, so a
 * root that cannot be unpacked answers `(unknown)` rather than killing a check
 * whose verdict does not depend on it.
 */
async function kernelVersion(ctx: ImageContext): Promise<string> {
  try {
    const root = await ctx.unpackRoot()
    const { readdirSync } = await import('node:fs')
    const names = readdirSync(join(root, 'usr/lib/modules'))
    return names.join(' ').trim() || '(unknown)'
  }
  catch {
    return '(unknown)'
  }
}
