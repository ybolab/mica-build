// Batch 4b: the image's shape, and the packed root's file capabilities.
//
// Four conclusions per board -- the default path being the `-latest` symlink,
// the partition count, and the capability pair.
//
// `exactly ${EXPECT_PARTS} partitions` is one entry per board. A single entry
// cannot carry it: ` partitions` claims three conclusions on cx3576 and three on
// x64, `exactly ` claims thirteen and eight, and the only distinguishing token
// left is the count, a per-board number. So each board gets its own entry
// generated from its own declaration, the way the ELF architecture does:
// `exactly 11 partitions` and `exactly 9 partitions` are derivations from
// `LAYOUT_PARTITIONS`, the same list the oracle counts, in the sense that
// `BOOT-A contains Image` is a derivation from BOOT_SLOT_REQUIRED_FILES. A third
// board in os/boards/ gets its own entry with its own count, unedited here.
//
// The capability pair carries a vacuous pass. The oracle establishes that the
// environment can observe a capability before it compares any inventory, because
// an empty capability set and a container that silently drops security.* xattrs
// are the same observation; that probe is honest and is ported as it
// stands. What it does not cover is that `getcap -r DIR` on a directory that is
// not there exits 0 and prints `DIR (No such file or directory)` on stderr,
// measured 2026-08-26 in the pinned alpine. The former verifier's `2>/dev/null` discards it,
// so the packed inventory comes out empty, and on these two images the source
// inventory is empty too, so the comparison passes about a root nothing read.
// Reproduced here -- the getcap binding returns stdout and nothing else -- and
// recorded for M4e; both shipped rootfs trees genuinely carry no file
// capabilities, which the oracle's own message says out loud.

import { existsSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import { SHIPPED } from './board-scope.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { verdict } from './verdict.ts'

/**
 * `readlink IMG`, with the leading `./` the oracle strips already stripped.
 *
 * `undefined` when the path is not a symlink at all, which is `readlink`'s own
 * non-zero exit and the oracle's `|| true` -- a failed check naming what it
 * found, not a dead run.
 */
function linkTarget(image: string): string | undefined {
  try {
    return readlinkSync(image).replace(/^\.\//, '')
  }
  catch {
    return undefined
  }
}

function key(board: Board, name: string): string {
  const v = board.get(name)
  if (v === undefined || v.trim() === '') {
    throw new ToolOutputError(
      `${board.path} declares no ${name}. A fail here would be a statement about the image, and a `
      + `missing key is one about the board definition.`,
    )
  }
  return v.trim()
}

const SHAPE_CHECKS: readonly CheckCase[] = [
  {
    // `check 0`, and it runs ONLY under --expect-symlink -- which the
    // parity harness passes exactly when the image is the board's default path,
    // because that is how `make os-verify-<board>-v2` invokes the oracle. An
    // image named explicitly on the command line prints no such conclusion, and
    // this check would then be `unfired` rather than wrong.
    id: 'image-default-path-symlink',
    shell: {
      pass: 'default path is a symlink to ',
      fail: 'default path must be a symlink to ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'image-default-path-symlink'
      const prefix = key(ctx.board, 'IMAGE_NAME_PREFIX')
      const suffix = key(ctx.board, 'IMAGE_NAME_SUFFIX')
      const target = linkTarget(ctx.image)
      // `[ -L "${IMG}" ] && [[ "${link_target}" =~ ^${PREFIX}[0-9]+\.img$ ]]`
      // -- the suffix is a LITERAL `.img` in the oracle's pattern while the
      // prefix is interpolated. Reproduced from the board's own keys, which
      // spell the same two halves.
      const shape = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9]+`
        + `${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
      const ok = target !== undefined && shape.test(target)
      return [verdict(id, ok,
        ok
          ? `default path is a symlink to ${target as string}`
          : `default path must be a symlink to ${prefix}<epoch>${suffix} in the same directory `
            + `(got: ${target ?? 'not a symlink'})`)]
    },
  },

  {
    // The environment probe, and it comes FIRST for a reason: an empty
    // capability set and a container that silently drops security.* xattrs are
    // the same observation, so the comparison below would pass for the wrong
    // reason if this had not been established.
    id: 'capability-observable',
    shell: {
      pass: 'the verification environment can set and read security.capability',
      fail: 'the verification environment cannot round-trip a security.capability xattr',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'capability-observable'
      const ok = await capabilityRoundTrips(ctx)
      return [verdict(id, ok,
        ok
          ? `the verification environment can set and read security.capability, so a capability `
            + `inventory taken here is trustworthy`
          : `the verification environment cannot round-trip a security.capability xattr, so no `
            + `claim about capability preservation can be made here`)]
    },
  },

  {
    // CONFIG_SQUASHFS_XATTR was enabled on the kernel side so a squashfs root
    // does not silently drop file capabilities. What can be proven from the
    // Packed image is that the capability set survived packing intact.
    id: 'capabilities-preserved',
    shell: {
      pass: [
        'packed file-capability set matches the source inventory',
        ' file capabilities survived packing into the squashfs',
      ],
      fail: [
        'file capabilities changed during packing',
        'capability inventory not found:',
        'file-capability preservation not evaluated',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'capabilities-preserved'
      if (!(await capabilityRoundTrips(ctx))) {
        return [verdict(id, false,
          `file-capability preservation not evaluated (the environment cannot observe capabilities)`)]
      }
      const report = join(ctx.outDir, 'rootfs-report-v2.txt')
      if (!existsSync(report)) {
        return [verdict(id, false,
          `capability inventory not found: ${report} (produce it with os/rootfs/build-v2.sh)`)]
      }
      const source = capsFromReport(readFileSync(report, 'utf8'))
      const packed = await capsFromRoot(ctx)
      const same = source.length === packed.length && source.every((l, i) => l === packed[i])
      if (!same) {
        return [verdict(id, false,
          `file capabilities changed during packing; the squashfs must preserve `
          + `security.capability: source ${source.join(' ') || '(none)'} vs packed `
          + `${packed.join(' ') || '(none)'}`)]
      }
      if (source.length === 0) {
        // Reported honestly rather than dressed up as a preservation proof:
        // this rootfs's package set installs no file capabilities at all, so
        // there is nothing whose survival could be demonstrated. The check is a
        // tripwire for the day a cap-carrying package lands.
        return [verdict(id, true,
          `packed file-capability set matches the source inventory (both EMPTY: this rootfs carries `
          + `no file capabilities, so xattr survival is NOT demonstrated by this image — see `)]
      }
      return [verdict(id, true,
        `all ${source.length} file capabilities survived packing into the squashfs `
        + `(security.capability xattrs preserved)`)]
    },
  },
]

/**
 * `setcap cap_net_raw+ep FILE && getcap FILE | grep cap_net_raw`.
 *
 * Run once per context and remembered, because both entries above ask it and
 * asking twice would let the two disagree.
 */
const probed = new WeakMap<ImageContext, Promise<boolean>>()

async function capabilityRoundTrips(ctx: ImageContext): Promise<boolean> {
  const existing = probed.get(ctx)
  if (existing !== undefined) return existing
  const started = (async () => {
    const probe = join(ctx.workDir, 'cap-probe')
    // `: >"${TMP}/cap-probe"` -- an empty file, created through the same
    // runtime the tools run in, so the round trip is measured where the
    // inventory will be taken and not on the host beside it.
    const made = await ctx.tools.run(['sh', '-c', `: > ${probe}`], { allow: [1, 2, 127] })
    if (made.code !== 0) return false
    const set = await ctx.tools.run(['setcap', 'cap_net_raw+ep', probe], { allow: [1, 2, 127] })
    if (set.code !== 0) return false
    const got = await ctx.tools.run(['getcap', probe], { allow: [1, 2, 127] })
    return got.code === 0 && got.stdout.includes('cap_net_raw')
  })()
  probed.set(ctx, started)
  return started
}

/**
 * The `== file capabilities ==` section of the build's own report.
 *
 * `sed -n '/^== file capabilities ==$/,/^== /p' | grep -vE '^(==|$)' |
 *  sed 's/[[:space:]]*$//' | sort` -- the range ends at the NEXT `== ` line,
 * both delimiters are dropped, trailing whitespace goes, and the result is
 * SORTED, because `getcap -r` walks in readdir order and two walks of the same
 * tree need not agree about it.
 */
export function capsFromReport(text: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l === '== file capabilities ==')
  if (start < 0) return []
  const out: string[] = []
  // The sed range runs from the header to the NEXT `^== ` line inclusive, and
  // the grep then drops both delimiters and every blank. So: start after the
  // header, stop at the next section, keep everything else.
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('== ')) break
    if (line.startsWith('==') || line === '') continue
    out.push(line.replace(/[ \t]+$/, ''))
  }
  return out.sort()
}

/** `getcap -r "${ROOT}" | sed "s|^${ROOT}||"` -- paths relative to the root, sorted. */
async function capsFromRoot(ctx: ImageContext): Promise<string[]> {
  const root = await ctx.unpackRoot()
  // getcap exits 0 whatever happens, including for a directory that is not
  // there -- it puts `DIR (No such file or directory)` on STDERR, which the
  // oracle discards. Its STDOUT is the whole answer, and an empty one is
  // returned rather than refused because that is what the oracle compares.
  const r = await ctx.tools.run(['getcap', '-r', root], { allow: [1, 2, 127] })
  return r.stdout.split('\n')
    .filter(l => l !== '')
    .map(l => l.startsWith(root) ? l.slice(root.length) : l)
    .map(l => l.replace(/[ \t]+$/, ''))
    .sort()
}

/**
 * `exactly ${EXPECT_PARTS} partitions`, as one entry per board.
 *
 * The count is `LAYOUT_PARTITIONS`' length, which is exactly what
 * counts, and it is the same list every other layout-derived check in this
 * package walks. `part_count` on the other side is the number of rows sgdisk
 * printed, read off the IMAGE -- so the two sides of this comparison come from
 * two places, which is the whole point of a check.
 */
function partitionCountChecks(board: Board): CheckCase[] {
  const declared = board.layoutPartitions ?? []
  if (declared.length === 0) {
    throw new ToolOutputError(
      `${board.path} declares no LAYOUT_PARTITIONS, so this check has nothing to count. `
      + `The verification contract refuses the same state, and for the same reason: a count of `
      + `zero would be satisfied by an image with no partition table at all.`,
    )
  }
  const want = declared.length
  const id = `gpt-partition-count-${board.name}`
  return [{
    id,
    boards: [board.name],
    shell: {
      pass: `exactly ${want} partitions`,
      fail: ` partitions, expected ${want}`,
    },
    run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
      const got = (await ctx.gpt()).partitions.length
      return [verdict(id, got === want,
        got === want
          ? `exactly ${want} partitions`
          : `found ${got} partitions, expected ${want}`)]
    },
  }]
}

export const SHAPE_CHECKS_ALL: readonly CheckCase[] = [
  ...SHAPE_CHECKS,
  ...SHIPPED.flatMap(partitionCountChecks),
]
