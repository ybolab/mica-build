// The check register: one entry per image-contract check, carrying BOTH the
// TypeScript that decides it and the shell conclusion it replaces.
//
// The matcher lives on the check rather than in a separate id table. A check
// and its identity drift when maintained in two places, and that drift is
// invisible: a matcher that stopped matching reports the same "no divergence"
// as a check that agrees. Here the two cannot separate: a CheckCase with no
// `shell` matcher does not typecheck, and a matcher with no check is not a
// CheckCase.
//
// Each entry carries an `id`, a `shell` matcher (`{ pass: 'disk GUID is' }` for
// an `eq_ci` that prints "X is Y" one way and "X is 'Z', expected Y" the other),
// and a `run` that returns the port's conclusions -- and, in the same change,
// its negative test. The harness cannot tell a check that passes from a check
// that cannot fail; only a fixture that drives it red can.

import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'
import type { Board } from './board.ts'
import {
  extractRange,
  readGpt,
  squashfsExtract,
  type FatSlot,
  type GptPartition,
  type GptTable,
} from './image.ts'
import { BOARD_CHECKS } from './checks-board.ts'
import { BOOTCHAIN_CHECKS } from './checks-bootchain.ts'
import { BUSYBOX_CHECKS } from './checks-busybox.ts'
import { CMDLINE_CHECKS_ALL } from './checks-cmdline.ts'
import { SHAPE_CHECKS_ALL } from './checks-shape.ts'
import { CONND_CHECKS } from './checks-connd.ts'
import { DBUS_CHECKS } from './checks-dbus.ts'
import { ENGINE_CHECKS_ALL } from './checks-engine.ts'
import { EXT4_CHECKS } from './checks-ext4.ts'
import { HOME_CHECKS } from './checks-home.ts'
import { IPTABLES_CHECKS } from './checks-iptables.ts'
import { KERNEL_CHECKS } from './checks-kernel.ts'
import { FRESHNESS_CHECKS } from './checks-freshness.ts'
import { FSTAB_CHECKS } from './checks-fstab.ts'
import { GPT_CHECKS } from './checks-gpt.ts'
import { MQTT_CHECKS } from './checks-mqtt.ts'
import { RAUC_CHECKS } from './checks-rauc.ts'
import { RAUC_UNIT_CHECKS } from './checks-rauc-units.ts'
import { ROOT_CHECKS } from './checks-root.ts'
import { SHADOW_CHECKS } from './checks-shadow.ts'
import { SLOT_CHECKS } from './checks-slots.ts'
import { SYSTEM_CHECKS } from './checks-system.ts'
import { TIME_CHECKS } from './checks-time.ts'
import { UPDATE_CHECKS } from './checks-update.ts'
import { ToolOutputError, type ToolRuntime } from './tools.ts'
import { matcherAlternatives, type CheckResult, type RegisteredCheck, type Verdict } from './parity.ts'

export type { CheckResult, Verdict }

/**
 * What a check is handed. Everything here reads the image; nothing writes to it.
 *
 * The geometry comes from the GPT the image actually carries, not from the
 * board definition. That is deliberate: a check comparing the image to the
 * board definition must read the two independently, and a context that resolved
 * partitions through the board definition would hand a check the same number on
 * both sides of its own comparison.
 */
export interface ImageContext {
  readonly board: Board
  readonly image: string
  readonly tools: ToolRuntime
  /** A directory the helpers may write extracts into. Never the image's own. */
  readonly workDir: string
  /**
   * Where this board's build outputs are -- `_out/<board>`.
   *
   * Two checks read a file the build produced beside the image rather than a
   * byte of the image itself: the verity parameter file and the rootfs report.
   * The oracle spells both `${REPO_ROOT}/_out/${MOS_BOARD}/...`, and so does
   * `createImageContext` -- this is a seam, not a second convention. It exists
   * because a suite that read the real `_out/` would pass on a host that had
   * built an image and fail on one that had not, and a skip reports the same
   * green as a pass.
   */
  readonly outDir: string
  /**
   * The tree's trust root -- the repository-root `ca/`.
   *
   * A seam for the same reason `outDir` is one, and not a second convention:
   * `ca/` is where rootfs/build.sh takes the keyring it stages into every
   * image, so the check that asks "did the shipped keyring come from there?"
   * has to read it. Reading the real `ca/` from a test would make the suite
   * pass on a host that had built once and fail on one that had not, and would
   * make the answer depend on whether that host's trust root happened to carry
   * `ca/GENERATED` -- so the fixture supplies its own.
   */
  readonly caDir: string
  /** The partition table, read once. */
  gpt: () => Promise<GptTable>
  /** A partition by GPT name (`boot-a`) or number. Throws when there is none. */
  partition: (nameOrNumber: string | number) => Promise<GptPartition>
  /** The FAT at that partition's offset -- mtools reads it in place. */
  fatSlot: (nameOrNumber: string | number) => Promise<FatSlot>
  /** That partition's bytes, extracted once into workDir. */
  extract: (nameOrNumber: string | number) => Promise<string>
  /**
   * An arbitrary byte range, extracted once into `workDir/<name>`.
   *
   * The seam the LAYOUT-addressed families need. `extract` above resolves a
   * partition through the GPT, which is right for everything that reads a
   * partition and wrong for the four ext4 tiers: the verification contract
   * `dd`s them at `PART_START_MIB_x`, the offset the board definition walks to,
   * and a check that read them through the GPT would agree with a partition
   * that had moved. `gpt-partition-start` is the check that says the two agree.
   */
  extractAt: (name: string, offset: number, length: number) => Promise<string>
  /** The read-only root, unpacked once out of the named verity slot. */
  unpackRoot: (slot?: string) => Promise<string>
}

export interface CheckCase extends RegisteredCheck {
  /**
   * Decide the check, and hand back one result per firing.
   *
   * A check that cannot decide THROWS. It does not return a `fail`: a fail is a
   * statement about the image, and "sgdisk would not run" is not one. The
   * harness turns a throw into a named error against this id, which is
   * distinguishable from both directions of the check.
   */
  readonly run: (ctx: ImageContext) => Promise<readonly CheckResult[]>
}

/**
 * Every ported check, in no particular order.
 *
 * One module per batch, concatenated here. The batches are separate files and
 * not sections of this one because each carries its own reading of the image --
 * the GPT walk, the FAT slots, the packed root -- and because a batch can be
 * added to the register without touching another batch's file.
 *
 * Batch 1 is GPT geometry, the boot slots' filesystems and the RAUC contract;
 * batch 2 the packed root's content, /etc/fstab and where the custom UI root
 * lands; batch 3 the board-conditional families, the MQTT pair and the shadow
 * contract. What is
 * still unclaimed stays `not-ported` rather than being rounded off to agreement.
 */
export const CHECKS: readonly CheckCase[] = [
  ...GPT_CHECKS,
  ...SLOT_CHECKS,
  ...RAUC_CHECKS,
  ...RAUC_UNIT_CHECKS,
  ...ROOT_CHECKS,
  ...BUSYBOX_CHECKS,
  ...IPTABLES_CHECKS,
  ...FSTAB_CHECKS,
  ...BOARD_CHECKS,
  ...MQTT_CHECKS,
  ...SHADOW_CHECKS,
  ...DBUS_CHECKS,
  ...ENGINE_CHECKS_ALL,
  ...HOME_CHECKS,
  ...CONND_CHECKS,
  ...SYSTEM_CHECKS,
  ...UPDATE_CHECKS,
  ...EXT4_CHECKS,
  ...BOOTCHAIN_CHECKS,
  ...CMDLINE_CHECKS_ALL,
  ...SHAPE_CHECKS_ALL,
  ...KERNEL_CHECKS,
  ...FRESHNESS_CHECKS,
  ...TIME_CHECKS,
]

/**
 * Refuse a register that cannot be diffed, before anything runs against it.
 *
 * diffParity refuses a duplicate id and a `many` with no instance pattern, but
 * only once it has a shell run in hand -- and a register fault should be found
 * by `bun test`, on a host with no image, rather than three minutes into a
 * parity run. The two overlap on purpose: the same fault stops the harness
 * whichever door it comes in by.
 */
export function assertRegisterWellFormed(checks: readonly CheckCase[] = CHECKS): void {
  const seen = new Set<string>()
  for (const c of checks) {
    if (c.id.trim() === '') {
      throw new ToolOutputError('a check is registered with an empty id; the id IS its identity.')
    }
    if (seen.has(c.id)) {
      throw new ToolOutputError(`two checks are registered as '${c.id}'.`)
    }
    seen.add(c.id)
    const alternatives = [c.shell.pass, c.shell.fail, c.shell.skip].flatMap(m => matcherAlternatives(m))
    if (alternatives.some(m => m.trim() === '')) {
      throw new ToolOutputError(
        `check '${c.id}' registers an EMPTY matcher. An empty substring is contained in every line, `
        + `so it would claim the FIRST shell conclusion of the run and compare this check's verdict `
        + `against something unrelated.`,
      )
    }
    // The other half of making `pass` optional (M4d): a check that registers NO
    // matcher at all claims no line on any board, comes out `unfired`, and reads
    // exactly like a check whose matcher stopped matching. `pass` may be omitted
    // only by an entry that owns a SKIP instead -- never by one that owns nothing.
    // An empty list is the same fault wearing a different shape, which is why
    // this counts alternatives rather than asking whether the fields are set.
    if (alternatives.length === 0) {
      throw new ToolOutputError(
        `check '${c.id}' registers no matcher at all -- no pass, no fail, no skip. It could never `
        + `claim a shell conclusion, so it would report 'unfired' on every board, which is the same `
        + `row a check whose matcher went stale produces.`,
      )
    }
    if (c.cardinality === 'many' && c.instance === undefined) {
      throw new ToolOutputError(
        `check '${c.id}' fires many times and registers no \`instance\` pattern, so its firings `
        + `could only be compared by count.`,
      )
    }
    if (c.boards !== undefined && c.boards.length === 0) {
      throw new ToolOutputError(
        `check '${c.id}' declares \`boards: []\`, so it applies to no board and can never run. `
        + `Omit the field to mean every board; an empty list is the shape a filtered-down list `
        + `takes when the filter was wrong.`,
      )
    }
  }
}

/** The checks that apply to a board, which is what the diff is scoped to. */
export function checksFor(board: string, checks: readonly CheckCase[] = CHECKS): CheckCase[] {
  return checks.filter(c => c.boards === undefined || c.boards.includes(board))
}

export interface CheckFailure {
  readonly id: string
  readonly error: Error
}

export interface CheckRun {
  readonly results: readonly CheckResult[]
  /** Checks that threw. Never folded into a `fail`; see CheckCase.run. */
  readonly failures: readonly CheckFailure[]
}

/**
 * Run the register against one image.
 *
 * Sequential, not concurrent. Several checks extract multi-hundred-megabyte
 * partitions through one container, and the cache below only helps if the
 * second asker waits for the first rather than starting its own extract.
 */
export async function runChecks(ctx: ImageContext, checks: readonly CheckCase[] = CHECKS): Promise<CheckRun> {
  const results: CheckResult[] = []
  const failures: CheckFailure[] = []
  for (const check of checksFor(ctx.board.name, checks)) {
    try {
      const got = await check.run(ctx)
      for (const r of got) {
        if (r.id !== check.id) {
          throw new ToolOutputError(
            `check '${check.id}' produced a result labelled '${r.id}'. The id is the identity the `
            + `parity diff pairs on; a mislabelled result would be compared against another check's `
            + `shell conclusion.`,
          )
        }
        results.push(r)
      }
      if (got.length === 0) {
        throw new ToolOutputError(
          `check '${check.id}' ran and concluded nothing. A check that returns no result is `
          + `invisible in a pass/fail count and reports the same absence of failure as one that `
          + `passed -- so it is an error here, not a quiet zero.`,
        )
      }
    }
    catch (error) {
      failures.push({ id: check.id, error: error instanceof Error ? error : new Error(String(error)) })
    }
  }
  return { results, failures }
}

// building the context

export interface ContextRequest {
  readonly board: Board
  readonly image: string
  readonly tools: ToolRuntime
  readonly workDir: string
  /** Defaults to `_out/<board>`, which is where the oracle looks. */
  readonly outDir?: string
  /** Defaults to the repository-root `ca/`, the one place a trust root enters a build. */
  readonly caDir?: string
}

/**
 * A short content digest of a file, for naming a cache entry after what is IN it.
 *
 * Streamed in 4 MiB chunks rather than read whole: the payloads this names are
 * whole partitions -- 256 MiB on cx3576, 512 MiB on x64 -- and reading one into
 * a Buffer to hash it would cost more memory than every other thing this
 * harness does put together.
 *
 * Sixteen hex characters, not all sixty-four. This is a cache key inside one
 * work directory and not a signature: it names a directory a human reads in
 * `ls`, the population it distinguishes is the handful of images one host
 * builds, and 64 bits of SHA-256 is far past the point where two of them
 * collide. Nothing here is a security claim -- an attacker who could choose the
 * payload could also choose the image.
 */
function digestOf(file: string): string {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const chunk = new Uint8Array(4 * 1024 * 1024)
    let position = 0
    for (;;) {
      const got = readSync(fd, chunk, 0, chunk.length, position)
      if (got === 0) break
      hash.update(chunk.subarray(0, got))
      position += got
    }
  }
  finally {
    closeSync(fd)
  }
  return hash.digest('hex').slice(0, 16)
}

export function createImageContext(request: ContextRequest): ImageContext {
  const { board, image, tools, workDir } = request
  const outDir = request.outDir ?? join(REPO_ROOT, '_out', board.name)
  const caDir = request.caDir ?? join(REPO_ROOT, 'ca')
  mkdirSync(workDir, { recursive: true })

  let gptOnce: Promise<GptTable> | undefined
  const extracts = new Map<number, Promise<string>>()
  const roots = new Map<string, Promise<string>>()

  const gpt = (): Promise<GptTable> => {
    gptOnce ??= readGpt(tools, image)
    return gptOnce
  }

  const partition = async (nameOrNumber: string | number): Promise<GptPartition> => {
    const table = await gpt()
    const found = typeof nameOrNumber === 'number'
      ? table.partition(nameOrNumber)
      : table.partitions.find(p => p.name.toLowerCase() === nameOrNumber.toLowerCase())
    if (found === undefined) {
      throw new ToolOutputError(
        `${image} has no partition '${nameOrNumber}'. It carries `
        + `${table.partitions.map(p => `${p.number}:${p.name}`).join(', ')}.\n`
        + `  Answered as a throw rather than as a failed check: which partitions exist is itself `
        + `asserted by a check, and a helper that answered "absent" here would let that check's `
        + `verdict be produced twice, in two places, with no guarantee they agree.`,
      )
    }
    return found
  }

  const fatSlot = async (nameOrNumber: string | number): Promise<FatSlot> => {
    const p = await partition(nameOrNumber)
    const table = await gpt()
    return { image, offsetBytes: p.firstSector * table.sectorSize }
  }

  const ranges = new Map<string, Promise<string>>()
  const extractAt = async (name: string, offset: number, length: number): Promise<string> => {
    const existing = ranges.get(name)
    if (existing !== undefined) return existing
    const started = Promise.resolve(extractRange(image, offset, length, join(workDir, name)))
    ranges.set(name, started)
    return started
  }

  const extract = async (nameOrNumber: string | number): Promise<string> => {
    const p = await partition(nameOrNumber)
    const existing = extracts.get(p.number)
    if (existing !== undefined) return existing
    const started = (async () => {
      const table = await gpt()
      const dest = join(workDir, `p${p.number}-${p.name || 'unnamed'}.img`)
      return extractRange(image, p.firstSector * table.sectorSize, p.sizeSectors * table.sectorSize, dest)
    })()
    extracts.set(p.number, started)
    return started
  }

  // The cache is keyed on the payload's content, and that is the whole point.
  // Keyed on the slot's name -- `root-rootfs-a` -- and short-circuited on
  // `existsSync(dest)` it would be wrong, because `extract` beside it always
  // reopens its destination with 'w': a second run at the same `--work` against
  // a different image re-extracts the partition and then hands back the previous
  // image's unpacked root, so every packed-root check reads a tree unrelated to
  // the image named on the command line and reports agreement about it. A cache
  // whose correctness depends on the caller remembering to delete it is not a
  // cache. Dropping the short-circuit instead does stop the silent wrong answer
  // -- `squashfsExtract` refuses a `dest` that exists, by name -- but converts
  // every re-run at one `--work` into a hard refusal. Keying on content keeps
  // the reuse and makes it sound: the same bytes resolve to the same directory,
  // different bytes cannot, and the key cannot go stale because it IS the
  // content.
  //
  // Why it is published by rename. A run killed mid-unsquashfs leaves a PARTIAL
  // tree, and a partial tree at the right name is indistinguishable from a
  // complete one -- `existsSync` says yes to both, and "is X absent from the
  // image?" then passes for every path unsquashfs had not reached yet. That is
  // the same defect one layer down, and this campaign has had two L3s SIGKILLed
  // mid-run. So the unpack lands in a staging directory and is moved into place
  // only once it has finished; a kill leaves `.unpack-*`, which is a name
  // nothing reads.
  const unpackRoot = async (slot = 'rootfs-a'): Promise<string> => {
    const existing = roots.get(slot)
    if (existing !== undefined) return existing
    const started = (async () => {
      const payload = await extract(slot)
      const dest = join(workDir, `root-${slot}-${digestOf(payload)}`)
      if (existsSync(dest)) return dest
      const staging = mkdtempSync(join(workDir, `.unpack-${slot}-`))
      try {
        await squashfsExtract(tools, payload, join(staging, 'root'))
        try {
          renameSync(join(staging, 'root'), dest)
        }
        catch (error) {
          // Another unpack of the SAME payload won the race and published first.
          // Its tree is this tree -- same content hash, same archive -- so the
          // published one is taken rather than the rename being retried.
          if (!existsSync(dest)) throw error
        }
      }
      finally {
        rmSync(staging, { recursive: true, force: true })
      }
      return dest
    })()
    roots.set(slot, started)
    return started
  }

  return { board, image, tools, workDir, outDir, caDir, gpt, partition, fatSlot, extract, extractAt, unpackRoot }
}
