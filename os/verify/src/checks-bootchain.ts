// Batch 4b: the U-Boot boot chain -- the raw blob, the BSP byte-compares, the
// status-LED device tree, the compiled boot script, the verity env pair, and
// the regions that must ship zero-filled.
//
// Six families in one module, because every one reads either `board/<board>/out/`
// or a file mcopy'd out of a boot slot, and three share the five SKIP lines a
// grub board prints in their place.
//
// The skips are the reason they are together. A shell line has exactly one
// owner, and the oracle wraps whole groups in
// `if is_uboot_board ... else skip "..."`, so one skip conclusion stands for as
// many as nine checks: :1750 the raw pre-GPT loader area (four), :2096 the
// boot.scr assertions (nine, script plus verity env), :2277 the boot.scr
// root-argument pair (two), :2299 the zero-filled U-Boot env pair (two), :1951
// the status-LED device tree (six, once per slot). So in each group one entry
// applies to every board and owns the skip, and the rest are scoped by
// `boardsWhere(isUBoot)` or `hasLed` and do not exist on a board that prints
// none of their lines.
//
// The BSP compare is a decision, not an oversight. `board/cx3576/out/` is not
// populated in a checkout, so the oracle's own run is `RESULT FAIL (387/395)`
// with eight conclusions reading `... compare source not found`. PLAN-014's
// Scope section puts `board/` BSP builds outside this campaign -- "No change to
// ... `board/` BSP builds (digest pins only)" -- and populating the tree would
// turn eight of the oracle's FAILs into passes, changing the measurement rather
// than porting it. So the port expresses the absence exactly as the oracle does:
// same paths, same sentence when the compare source is not there. Both
// directions have a fixture -- byte-identical source, differing source, no
// source -- so the passing direction is driven even though no shipped tree
// reaches it.
//
// One cx3576 literal in the oracle is recorded rather than copied.
// `BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"` (:28) and
// `DTB_SRC="${BOARD_DIR}/out/kernel/rk3576-src.dtb"` (:1758) are board names in
// an otherwise board-derived script. On the one U-Boot board this tree ships the
// two agree, so this port derives both -- the directory from the board's own
// name, the artefact names from that board's BOOT_SLOT_REQUIRED_FILES -- and a
// second U-Boot board would be compared against its own BSP here and against
// cx3576's there. That divergence is the oracle's, reported for M4e rather than
// reproduced.

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import { boardsWhere, hasLed, isUBoot, SHIPPED } from './board-scope.ts'
import { PER_SLOT, SLOTS, slotOffsetBytes, type BootSlot } from './boot-slots.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { imageLayout } from './image-layout.ts'
import {
  fatCopyOut,
  fdtGet,
  fdtGetCells,
  readBytes,
  uImageMagic,
  uImageText,
  UIMAGE_MAGIC,
  type FatSlot,
} from './image.ts'
import type { CheckResult } from './parity.ts'
import { REPO_ROOT } from './paths.ts'
import { ToolOutputError } from './tools.ts'
import { skipped, verdict } from './verdict.ts'

const UBOOT = boardsWhere(isUBoot)
const NOT_UBOOT = boardsWhere(b => !isUBoot(b))
const LED = boardsWhere(hasLed)
const NOT_LED = boardsWhere(b => !hasLed(b))

/**
 * `${BOARD_DIR}` -- where this board's BSP build puts its artefacts.
 *
 * The environment variable first, because that is how the oracle's own
 * container re-exec supplies it (`-e BOARD_DIR=/board`, :185) and a run made
 * that way must read the same tree. Otherwise `board/<board>/`, derived from
 * the board's name; see the header for the literal the oracle defaults to.
 */
function boardDir(board: Board): string {
  const fromEnv = process.env['BOARD_DIR']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return join(REPO_ROOT, 'board', board.name)
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

function intKey(board: Board, name: string): number {
  const raw = key(board, name)
  if (!/^\d+$/.test(raw)) {
    throw new ToolOutputError(`${board.path} declares ${name}='${raw}', which is read as a number here.`)
  }
  return Number(raw)
}

// 1. the raw pre-GPT area, and the two BSP compares over it (:1690-1750)

/**
 * The uboot-mos blob's size on disk, and 0 when its compare source is absent.
 *
 * `uboot_size=0` in the not-found branch (:1705) is what the two containment
 * checks below then read, so they conclude about a blob of zero bytes rather
 * than about the image. Shared here rather than recomputed per check, because
 * the oracle shares one variable and a second derivation could disagree with
 * the first about which branch was taken.
 */
function ubootSourceSize(board: Board): { src: string, size: number } {
  const src = join(boardDir(board), 'out', key(board, 'UBOOT_VARIANT_DIR'), key(board, 'UBOOT_BIN_NAME'))
  return { src, size: existsSync(src) ? statSync(src).size : 0 }
}

function bytesEqual(image: string, offset: number, file: string): boolean {
  const size = statSync(file).size
  if (size === 0) return false
  // `dd ... count=${size} | cmp -s - ${src}` -- the FIRST `size` bytes of the
  // image at that offset against the whole source, so a source shorter than the
  // region still compares equal if the leading bytes match. Reproduced.
  const want = readBytes(file, 0, size)
  const got = readBytes(image, offset, size)
  return Buffer.from(got).equals(Buffer.from(want))
}

/**
 * One `one` check per board for each of the four raw-blob conclusions.
 *
 * GENERATED, and this family is the reason. The obvious matcher for the first
 * one is ` matches the `, and that substring is also in
 * `packed file-capability set matches the source inventory` -- measured against
 * both boards' real output, which is the only way a collision like that is ever
 * found. Every other candidate that leaves out the sector number collides with
 * the PAIRING GUARD's own sentence, which is the same clause negated. So the
 * matchers carry the board's own UBOOT_SEEK_SECTOR and UBOOT_VARIANT_DIR, which
 * makes them derivations rather than literals -- the shape M4d used for the
 * per-slot files and M4f for the ELF architecture.
 */
function rawBlobChecks(board: Board): CheckCase[] {
  if (!isUBoot(board)) return []
  const sector = intKey(board, 'UBOOT_SEEK_SECTOR')
  const offset = sector * intKey(board, 'SECTOR_SIZE')
  const variant = key(board, 'UBOOT_VARIANT_DIR')
  const debugDir = key(board, 'UBOOT_DEBUG_VARIANT_DIR')
  const only = [board.name]

  const matchesId = `uboot-blob-matches-variant-${board.name}`
  const notDebugId = `uboot-blob-not-debug-${board.name}`
  const belowId = `uboot-blob-below-uenv-${board.name}`
  const fitsId = `uboot-blob-fits-loader-${board.name}`

  return [
    {
      id: matchesId,
      boards: only,
      shell: {
        pass: `u-boot at sector ${sector} matches the ${variant} variant (`,
        fail: [
          'u-boot compare source not found',
          `; a v2 image may only carry the ${variant} variant`,
        ],
      },
      run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
        const { src, size } = ubootSourceSize(ctx.board)
        if (size === 0) {
          return [verdict(matchesId, false,
            `u-boot compare source not found: ${src} (build it with `
            + `'make -C board/${ctx.board.name} ${variant}')`)]
        }
        const ok = bytesEqual(ctx.image, offset, src)
        return [verdict(matchesId, ok,
          ok
            ? `u-boot at sector ${sector} matches the ${variant} variant (${src})`
            : `u-boot at sector ${sector} differs from ${src}; a v2 image may only carry the `
              + `${variant} variant`)]
      },
    },

    {
      // The pairing guard, and its passing direction is an INEQUALITY. The debug
      // variant boots and looks healthy, has CONFIG_ENV_IS_NOWHERE and no pinned
      // bootmeth order, and would make the A/B handshake silently never run.
      id: notDebugId,
      boards: only,
      shell: {
        pass: `u-boot at sector ${sector} differs from the debug variant (${debugDir})`,
        fail: [
          'u-boot debug-variant compare source not found',
          `the blob at sector ${sector} is byte-identical to the DEBUG u-boot (`,
        ],
      },
      run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
        const src = join(boardDir(ctx.board), 'out', debugDir, key(ctx.board, 'UBOOT_BIN_NAME'))
        if (!existsSync(src)) {
          return [verdict(notDebugId, false,
            `u-boot debug-variant compare source not found: ${src}; the ${variant}/${debugDir} `
            + `pairing guard cannot be evaluated`)]
        }
        const same = bytesEqual(ctx.image, offset, src)
        return [verdict(notDebugId, !same,
          same
            ? `the blob at sector ${sector} is byte-identical to the DEBUG u-boot (${src}). A v2 `
              + `image carrying it would boot, look healthy and never run the RAUC A/B handshake: `
              + `no BOOT_ORDER, no attempt counters, no rollback`
            : `u-boot at sector ${sector} differs from the debug variant (${debugDir}), so the A/B `
              + `variant is paired correctly`)]
      },
    },

    {
      id: belowId,
      boards: only,
      shell: { pass: 'u-boot ends at ', fail: ') reaches into ' },
      run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
        const { size } = ubootSourceSize(ctx.board)
        const uenv = ctx.board.partition('UENV_A')
        const uenvOffset = Number(uenv?.get('OFFSET_BYTES') ?? Number.NaN)
        const uenvLabel = uenv?.label ?? ''
        const uenvStartMib = uenv?.startMib ?? Number.NaN
        const max = intKey(ctx.board, 'UBOOT_MAX_BYTES')
        const ok = size > 0 && offset + size <= uenvOffset && size <= max
        return [verdict(belowId, ok,
          ok
            ? `u-boot ends at ${offset + size} bytes, below ${uenvLabel} at ${uenvStartMib} MiB`
            : `u-boot (${size} bytes at offset ${offset}) reaches into ${uenvLabel} at `
              + `${uenvOffset} bytes / ${uenvStartMib} MiB`)]
      },
    },

    {
      // Containment in the loader partition with room to spare. "Ends before
      // uenv-a" above is the byte-offset form of the same statement; this one is
      // expressed against the partition ENTRY, which is what actually protects
      // the bytes from systemd-repart's discard.
      id: fitsId,
      boards: only,
      shell: {
        pass: 'is fully contained in p',
        fail: '; the blob must fit inside its own partition with room left',
      },
      run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
        const { size } = ubootSourceSize(ctx.board)
        const loader = ctx.board.partition('LOADER')
        const partnum = loader?.partnum ?? Number.NaN
        const loaderBytes = Number(loader?.sizeSectors ?? Number.NaN) * intKey(ctx.board, 'SECTOR_SIZE')
        const ok = size > 0 && size < loaderBytes
        return [verdict(fitsId, ok,
          ok
            ? `u-boot (${size} bytes) is fully contained in p${partnum} (${loaderBytes} bytes) with `
              + `${loaderBytes - size} bytes to spare`
            : `u-boot is ${size} bytes and p${partnum} is ${loaderBytes} bytes; the blob must fit `
              + `inside its own partition with room left`)]
      },
    },
  ]
}

/** The ONE conclusion a grub board prints in place of all four. */
const RAW_BLOB_SKIP: readonly CheckCase[] = [
  {
    id: 'uboot-blob-skipped',
    boards: NOT_UBOOT,
    shell: { skip: 'the raw pre-GPT loader area (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped('uboot-blob-skipped',
      `the raw pre-GPT loader area (bootloader=${ctx.board.bootloader}): there is no idbloader at `
      + `sector 64 on a board whose firmware lives in flash, so there is nothing to compare against `
      + `the BSP build`)],
  },
]

// 2. the BSP kernel artefacts each slot must match (:1893-1907)

/**
 * The boot-slot files that come out of the BSP build rather than the assembler.
 *
 * Derived, not named: every entry of this board's own BOOT_SLOT_REQUIRED_FILES
 * that is neither the compiled boot script nor a per-slot verity env is a BSP
 * artefact, and lives at `${BOARD_DIR}/out/kernel/<name>`. On cx3576 that is
 * exactly `Image` and `rk3576-src.dtb`, which is the pair the oracle names at
 * :1893 as a literal list.
 */
export function bspArtefacts(board: Board): string[] {
  const script = board.get('BOOT_SCRIPT_NAME')
  return (board.bootSlotRequiredFiles ?? []).filter(f =>
    f !== script && !f.includes('@SLOT@') && !/^mos-verity-[ab]\.env$/.test(f))
}

/** The device tree among them, which the status-LED family reads. */
export function bootSlotDtb(board: Board): string | undefined {
  return bspArtefacts(board).find(f => f.endsWith('.dtb'))
}

function bspSource(board: Board, file: string): string {
  return join(boardDir(board), 'out', 'kernel', file)
}

/** `${TMP}/boot-${letter}-${f}` -- one copy per slot per file, as the oracle names it. */
async function slotCopy(
  ctx: ImageContext,
  slot: BootSlot,
  file: string,
): Promise<string | undefined> {
  const fat: FatSlot = { image: ctx.image, offsetBytes: slotOffsetBytes(ctx.board, slot.layout) }
  const dest = join(ctx.workDir, `boot-${slot.letter}-${file}`)
  if (existsSync(dest)) return dest
  return (await fatCopyOut(ctx.tools, fat, file, dest)) ? dest : undefined
}

/** One `one` check per (board, slot, BSP artefact). */
function bspCompareChecks(board: Board): CheckCase[] {
  if (!isUBoot(board)) return []
  return SLOTS.flatMap(slot => bspArtefacts(board).map((file) => {
    const id = `bsp-compare-${board.name}-${slot.display}-${file}`
    return {
      id,
      boards: [board.name],
      shell: {
        pass: `factory: ${slot.display} ${file} matches the local BSP artifact`,
        fail: [
          `${slot.display} ${file} missing or unreadable`,
          `${slot.display} ${file} compare source not found:`,
          `factory: ${slot.display} ${file} differs from the local BSP artifact`,
        ],
      },
      run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
        const copied = await slotCopy(ctx, slot, file)
        if (copied === undefined) {
          return [verdict(id, false, `${slot.display} ${file} missing or unreadable`)]
        }
        const src = bspSource(ctx.board, file)
        if (!existsSync(src)) {
          return [verdict(id, false, `${slot.display} ${file} compare source not found: ${src}`)]
        }
        const same = statSync(copied).size === statSync(src).size
          && Buffer.from(readBytes(copied, 0, statSync(copied).size))
            .equals(Buffer.from(readBytes(src, 0, statSync(src).size)))
        return [verdict(id, same,
          same
            ? `factory: ${slot.display} ${file} matches the local BSP artifact ${src}`
            : `factory: ${slot.display} ${file} differs from the local BSP artifact ${src}`)]
      },
    } satisfies CheckCase
  }))
}

// 3. the status-LED device tree (:1918-1953)

/**
 * The indicator contract, as the oracle states it at :1922.
 *
 * TRANSCRIBED, not derived, and the reason is that there is nowhere board-side
 * to derive it from: `os/boards/cx3576/board.env` declares
 * `BOARD_HAS_STATUS_LED=1` and nothing about polarity. The same three facts per
 * LED are asserted in three places in this tree -- here, at
 * `board/cx3576/kernel/Dockerfile:134-139`, and in the .dts the kernel build
 * compiles -- and the last two are `board/` BSP files that PLAN-014's Scope
 * section puts outside this campaign ("No change to ... `board/` BSP builds
 * (digest pins only)"), so reading them would be a dependency on a tree this
 * port must not require.
 *
 * The SCOPE is derived: `boardsWhere(hasLed)`, never a board name.
 *
 * The GPIO flags cell is the load-bearing one. `default-state` alone reads green
 * while a red LED behaves backwards: status-red hangs off an active-low line
 * and status-blue off an active-high one, so a single inverted cell turns "lit
 * at boot" into "dark at boot" with every label and every default-state still
 * spelling exactly right.
 */
const LEDS = [
  { name: 'status-red', state: 'on', flags: '1', polarity: 'active-low' },
  { name: 'status-blue', state: 'off', flags: '0', polarity: 'active-high' },
] as const

/** The cell `read -r -a gpio_cells` then indexes at [2]: <phandle pin FLAGS>. */
const GPIO_FLAGS_CELL = 2

function ledChecks(board: Board): CheckCase[] {
  if (!hasLed(board)) return []
  const dtb = bootSlotDtb(board)
  if (dtb === undefined) {
    throw new ToolOutputError(
      `${board.path} declares BOARD_HAS_STATUS_LED=1 and lists no .dtb in BOOT_SLOT_REQUIRED_FILES, `
      + `so there is no device tree in the boot slot for these assertions to read. The oracle reads `
      + `${'${TMP}'}/boot-<letter>-rk3576-src.dtb, which exists only because the BSP compare above `
      + `copied it out.`,
    )
  }
  return SLOTS.flatMap(slot => LEDS.flatMap((led) => {
    const head = `${slot.display} ${dtb}: /leds/${led.name}`
    const dtbFor = async (ctx: ImageContext): Promise<string | undefined> => slotCopy(ctx, slot, dtb)
    return [
      {
        id: `led-label-${board.name}-${slot.display}-${led.name}`,
        boards: [board.name],
        shell: { pass: `${head} label is ` },
        run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
          const id = `led-label-${board.name}-${slot.display}-${led.name}`
          const file = await dtbFor(ctx)
          const got = file === undefined ? undefined : await fdtGet(ctx.tools, file, `/leds/${led.name}`, 'label')
          return [verdict(id, got === led.name,
            got === led.name
              ? `${head} label is '${led.name}'`
              : `${head} label is '${got ?? 'missing'}', expected '${led.name}'`)]
        },
      },
      {
        id: `led-state-${board.name}-${slot.display}-${led.name}`,
        boards: [board.name],
        shell: { pass: `${head} default-state is ` },
        run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
          const id = `led-state-${board.name}-${slot.display}-${led.name}`
          const file = await dtbFor(ctx)
          const got = file === undefined
            ? undefined
            : await fdtGet(ctx.tools, file, `/leds/${led.name}`, 'default-state')
          return [verdict(id, got === led.state,
            got === led.state
              ? `${head} default-state is '${led.state}'`
              : `${head} default-state is '${got ?? 'missing'}', expected '${led.state}'`)]
        },
      },
      {
        id: `led-gpio-${board.name}-${slot.display}-${led.name}`,
        boards: [board.name],
        shell: { pass: `${head} GPIO flags cell is ` },
        run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
          const id = `led-gpio-${board.name}-${slot.display}-${led.name}`
          const file = await dtbFor(ctx)
          const cells = file === undefined
            ? []
            : await fdtGetCells(ctx.tools, file, `/leds/${led.name}`, 'gpios')
          const got = cells[GPIO_FLAGS_CELL]
          return [verdict(id, got === led.flags,
            got === led.flags
              ? `${head} GPIO flags cell is ${led.flags} (${led.polarity})`
              : `${head} GPIO flags cell is '${got ?? 'missing'}', expected ${led.flags} `
                + `(${led.polarity}); the wrong polarity drives this LED backwards while its label `
                + `and default-state still read correctly`)]
        },
      },
    ] satisfies CheckCase[]
  }))
}

const LED_SKIP: readonly CheckCase[] = [
  {
    // The SIX conclusions per slot collapse to ONE skip on a board with no
    // indicator, and it is printed once per slot -- so this is `many` over the
    // slots and not one line.
    id: 'led-dtb-skipped',
    boards: NOT_LED,
    cardinality: 'many',
    instance: PER_SLOT,
    shell: { skip: ': the status-LED device-tree assertions (' },
    run: async (ctx): Promise<readonly CheckResult[]> => SLOTS.map(slot => skipped(
      'led-dtb-skipped',
      `${slot.display}: the status-LED device-tree assertions (${ctx.board.name} declares `
      + `BOARD_HAS_STATUS_LED=0): there is no indicator on this board, so there are no /leds nodes `
      + `and no GPIO polarity to get backwards`,
      { instance: slot.display },
    )),
  },
]

// 4. boot.scr -- the compiled boot script (:2014-2052, :2258-2276)

/** The compiled script out of a slot, or undefined when it is not there. */
async function bootScript(ctx: ImageContext, slot: BootSlot): Promise<string | undefined> {
  const name = ctx.board.get('BOOT_SCRIPT_NAME')
  if (name === undefined || name.trim() === '') {
    throw new ToolOutputError(
      `${ctx.board.path} declares no BOOT_SCRIPT_NAME, so this family does not know which file in `
      + `the slot is the compiled boot script.`,
    )
  }
  return slotCopy(ctx, slot, name.trim())
}

/**
 * `setenv <var> <value>` inside the `setenv bootslot <SLOT>` stanza.
 *
 * awk over the NUL-stripped whole file, which is what :2039-2044 does: the
 * uImage header's own bytes survive the strip and never look like `setenv`, so
 * the parse works and a reader that started at the payload offset would be a
 * better reader and a different one.
 */
function scriptVar(text: string, slot: string, name: string): string | undefined {
  let inSlot = false
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f[0] === 'setenv' && f[1] === 'bootslot' && f[2] === slot) {
      inSlot = true
      continue
    }
    if (f[0] === 'setenv' && f[1] === name && inSlot) return f[2]
  }
  return undefined
}

/** One `one` check per (board, variable, slot), generated from that board's own partnums. */
function bootScriptNumberChecks(board: Board): CheckCase[] {
  if (!isUBoot(board)) return []
  const script = key(board, 'BOOT_SCRIPT_NAME')
  const wanted = SLOTS.flatMap(slot => [
    { variable: 'bootpart', slot, layout: slot.layout },
    { variable: 'rootpart', slot, layout: `ROOTFS_${slot.upper}` },
  ])
  return wanted.map(({ variable, slot, layout }) => {
    const num = board.partition(layout)?.partnum
    if (num === undefined) {
      throw new ToolOutputError(`${board.path} declares no ${layout}_PARTNUM.`)
    }
    const id = `boot-scr-${variable}-${slot.upper}-${board.name}`
    return {
      id,
      boards: [board.name],
      shell: {
        pass: `${script} sets ${variable}=${num} for slot ${slot.upper}, matching the layout`,
        fail: ` for slot ${slot.upper}, but the layout puts that partition at p${num};`,
      },
      run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
        const file = await bootScript(ctx, SLOTS[0] as BootSlot)
        const got = file === undefined ? undefined : scriptVar(uImageText(file), slot.upper, variable)
        return [verdict(id, got === String(num),
          got === String(num)
            ? `${script} sets ${variable}=${num} for slot ${slot.upper}, matching the layout`
            : `${script} sets ${variable}='${got ?? 'nothing'}' for slot ${slot.upper}, but the `
              + `layout puts that partition at p${num}; U-Boot would load from the wrong partition `
              + `after already persisting the attempt decrement`)]
      },
    } satisfies CheckCase
  })
}

const BOOT_SCRIPT_CHECKS: readonly CheckCase[] = [
  {
    id: 'boot-scr-identical',
    boards: UBOOT,
    shell: {
      pass: ' is byte-identical in BOOT-A and BOOT-B',
      fail: ' differs between BOOT-A and BOOT-B',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const script = key(ctx.board, 'BOOT_SCRIPT_NAME')
      const a = await bootScript(ctx, SLOTS[0] as BootSlot)
      const b = await bootScript(ctx, SLOTS[1] as BootSlot)
      const same = a !== undefined && b !== undefined
        && statSync(a).size === statSync(b).size
        && Buffer.from(readBytes(a, 0, statSync(a).size)).equals(Buffer.from(readBytes(b, 0, statSync(b).size)))
      return [verdict('boot-scr-identical', same,
        same
          ? `factory: ${script} is byte-identical in BOOT-A and BOOT-B`
          : `factory: ${script} differs between BOOT-A and BOOT-B (or is missing); the same script `
            + `must be able to boot either slot`)]
    },
  },

  {
    id: 'boot-scr-uimage-magic',
    boards: UBOOT,
    shell: { pass: ' carries the legacy uImage magic ', fail: ' magic is ' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const script = key(ctx.board, 'BOOT_SCRIPT_NAME')
      const file = await bootScript(ctx, SLOTS[0] as BootSlot)
      // `od -An -tx1 -N4 "${TMP}/scr-A" 2>/dev/null | tr -d ' \n' || true` -- an
      // absent file is '' and a failed check, not a dead run.
      const magic = file === undefined ? '' : uImageMagic(file)
      return [verdict('boot-scr-uimage-magic', magic === UIMAGE_MAGIC,
        magic === UIMAGE_MAGIC
          ? `${script} carries the legacy uImage magic ${UIMAGE_MAGIC}`
          : `${script} magic is '${magic}', expected ${UIMAGE_MAGIC} (mkimage -T script output)`)]
    },
  },

  {
    id: 'boot-scr-root-args',
    boards: UBOOT,
    shell: {
      pass: ' boots root=/dev/dm-0 rootfstype=squashfs ro (read-only squashfs root)',
      fail: `does not set 'root=/dev/dm-0 rootfstype=squashfs ro'`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const script = key(ctx.board, 'BOOT_SCRIPT_NAME')
      const file = await bootScript(ctx, SLOTS[0] as BootSlot)
      // `grep -a` on the RAW file, not on the NUL-stripped text: the oracle
      // greps the bytes and the three patterns are all ASCII.
      const raw = file === undefined
        ? ''
        : Buffer.from(readBytes(file, 0, statSync(file).size)).toString('latin1')
      const ok = file !== undefined
        && raw.includes('root=/dev/dm-0')
        && raw.includes('rootfstype=squashfs')
        && /rootfstype=squashfs ro( |$)/m.test(raw)
      return [verdict('boot-scr-root-args', ok,
        ok
          ? `${script} boots root=/dev/dm-0 rootfstype=squashfs ro (read-only squashfs root)`
          : `${script} does not set 'root=/dev/dm-0 rootfstype=squashfs ro'; the v2 root must be `
            + `mounted read-only from the verity device`)]
    },
  },
]

/**
 * The TWO conclusions a grub board prints in place of the whole boot.scr group.
 *
 * The first stands for NINE checks -- byte-identity, the uImage magic, the four
 * partition numbers and the three verity-env ones -- and the second for two.
 * A shell line has exactly one owner, so each gets an entry that exists only on
 * the boards that print it, and the checks it stands for are scoped to the
 * boards that print theirs. Neither side ever produces an unclaimed line or an
 * orphan.
 */
const BOOT_SCRIPT_SKIPS: readonly CheckCase[] = [
  {
    id: 'boot-scr-skipped',
    boards: NOT_UBOOT,
    shell: { skip: 'the boot.scr assertions (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped('boot-scr-skipped',
      `the boot.scr assertions (bootloader=${ctx.board.bootloader}): there is no compiled boot `
      + `script in a slot GRUB boots, no uImage magic to check, and no baked-in partition number to `
      + `catch drifting -- GRUB addresses slots by PARTUUID on the kernel command line, which the `
      + `cmdline assertions below cover instead`)],
  },
  {
    id: 'boot-scr-root-args-skipped',
    boards: NOT_UBOOT,
    shell: { skip: 'the boot.scr root-argument assertions (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped('boot-scr-root-args-skipped',
      `the boot.scr root-argument assertions (bootloader=${ctx.board.bootloader}): there is no `
      + `compiled boot script on this board; GRUB assembles the same arguments onto the kernel `
      + `command line, which the cmdline assertions above check from the image`)],
  },
]

// 5. the per-slot verity environment pair (:2056-2094)

/** `${BOOT_VERITY_ENV_<X>_NAME}` out of the slot, as text. */
export async function verityEnvText(ctx: ImageContext, slot: BootSlot): Promise<string> {
  const name = ctx.board.get(`BOOT_VERITY_ENV_${slot.upper}_NAME`)
  if (name === undefined || name.trim() === '') return ''
  const file = await slotCopy(ctx, slot, name.trim())
  if (file === undefined) return ''
  return Buffer.from(readBytes(file, 0, statSync(file).size)).toString('latin1')
}

function guidOf(board: Board, layout: string): string {
  const g = board.partition(layout)?.guid
  if (g === undefined || g.trim() === '') {
    throw new ToolOutputError(`${board.path} declares no ${layout}_GUID.`)
  }
  return g.trim()
}

const VERITY_ENV_CHECKS: readonly CheckCase[] = [
  {
    // Each slot's verity env must point dm-verity at its OWN rootfs partition;
    // swapping them would make an update verify the slot it just replaced.
    id: 'verity-env-own-partuuid',
    boards: UBOOT,
    cardinality: 'many',
    instance: /^([AB]) /,
    shell: {
      pass: ' verity env references its own rootfs PARTUUID ',
      fail: [' verity env must reference PARTUUID ', '.env is missing or empty'],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const out: CheckResult[] = []
      const base = (ctx.board.get('BOOT_VERITY_ENV_NAME') ?? '').replace(/\.env$/, '')
      for (const slot of SLOTS) {
        const own = guidOf(ctx.board, `ROOTFS_${slot.upper}`)
        const other = guidOf(ctx.board, `ROOTFS_${slot.upper === 'A' ? 'B' : 'A'}`)
        const body = (await verityEnvText(ctx, slot)).toLowerCase()
        if (body === '') {
          out.push(verdict('verity-env-own-partuuid', false,
            `${slot.upper} ${base}-${slot.letter}.env is missing or empty`,
            { instance: slot.upper }))
          continue
        }
        const ok = body.includes(own.toLowerCase()) && !body.includes(other.toLowerCase())
        out.push(verdict('verity-env-own-partuuid', ok,
          ok
            ? `${slot.upper} verity env references its own rootfs PARTUUID ${own} and not the other slot's`
            : `${slot.upper} verity env must reference PARTUUID ${own} (its own rootfs slot) and must `
              + `not mention ${other}`,
          { instance: slot.upper }))
      }
      return out
    },
  },

  {
    // The two files are the same table over different partitions: rewriting A's
    // PARTUUID to B's must reproduce B's file exactly.
    //
    // The precondition is the oracle's. `verity_env_ok` is set by the check
    // above, and when it is 0 this one prints "could not be made" WITHOUT
    // comparing anything -- so the two entries are coupled, and this one
    // re-derives the same precondition rather than inventing its own.
    id: 'verity-env-ab-differ-only-by-partuuid',
    boards: UBOOT,
    shell: {
      pass: 'the A and B verity env files differ only in the rootfs PARTUUID',
      fail: [
        'the A and B verity env files differ by more than the rootfs PARTUUID',
        'the A/B verity env comparison could not be made',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'verity-env-ab-differ-only-by-partuuid'
      const a = await verityEnvText(ctx, SLOTS[0] as BootSlot)
      const b = await verityEnvText(ctx, SLOTS[1] as BootSlot)
      const guidA = guidOf(ctx.board, 'ROOTFS_A')
      const guidB = guidOf(ctx.board, 'ROOTFS_B')
      const ok = [
        [a, guidA, guidB] as const,
        [b, guidB, guidA] as const,
      ].every(([body, own, other]) => body !== ''
        && body.toLowerCase().includes(own.toLowerCase())
        && !body.toLowerCase().includes(other.toLowerCase()))
      if (!ok) {
        return [verdict(id, false,
          `the A/B verity env comparison could not be made (a slot's verity env is missing or wrong)`)]
      }
      // `sed "s/$(lc A)/$(lc B)/g"` -- a case-sensitive substitution of the
      // LOWERCASED guid, over a file that carries it lowercased. Reproduced
      // exactly: folding case here would repair a file the oracle rejects.
      const rewritten = a.split(guidA.toLowerCase()).join(guidB.toLowerCase())
      const same = rewritten === b
      return [verdict(id, same,
        same
          ? `the A and B verity env files differ only in the rootfs PARTUUID`
          : `the A and B verity env files differ by more than the rootfs PARTUUID`)]
    },
  },
]

// 6. the regions that must ship zero-filled (:2264-2298)

/**
 * How many NON-ZERO bytes a range holds -- `tr -d '\0' | wc -c`.
 *
 * The memcmp against a zero page is not an optimisation for its own sake: the
 * ranges here are a 256 MiB rootfs slot on cx3576 and a 512 MiB one on x64, and
 * a per-byte loop over that in JavaScript costs seconds on the PASSING path,
 * which is the path every healthy image takes. Counting only happens on a chunk
 * that is already known to differ, so the number in the failure message is the
 * same number.
 */
function nonZeroBytes(image: string, offset: number, length: number): number {
  if (length <= 0) return 0
  const CHUNK = 4 * 1024 * 1024
  const zero = Buffer.alloc(CHUNK)
  let count = 0
  for (let done = 0; done < length; done += CHUNK) {
    const want = Math.min(CHUNK, length - done)
    const bytes = Buffer.from(readBytes(image, offset + done, want))
    if (bytes.equals(zero.subarray(0, want))) continue
    for (const b of bytes) if (b !== 0) count += 1
  }
  return count
}

const ZERO_FILL_CHECKS: readonly CheckCase[] = [
  {
    id: 'rootfs-b-zero',
    boards: UBOOT,
    shell: { pass: 'factory: ROOTFS-B is entirely zero (', fail: 'factory: ROOTFS-B contains ' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const layout = await imageLayout(ctx)
      const slotMib = layout.slotMib
      // `[ "${SLOT_MIB}" -gt 0 ] && [ "${rootfs_b_nonzero}" = "0" ]`: a slot
      // size the GPT could not give makes this FAIL rather than pass over a
      // zero-length read.
      const nonZero = slotMib > 0
        ? nonZeroBytes(ctx.image, layout.startMib('ROOTFS_B') * layout.mibBytes, slotMib * layout.mibBytes)
        : -1
      const ok = slotMib > 0 && nonZero === 0
      return [verdict('rootfs-b-zero', ok,
        ok
          ? `factory: ROOTFS-B is entirely zero (${slotMib} MiB; the first update fills it)`
          : `factory: ROOTFS-B contains ${nonZero} non-zero bytes, expected none`)]
    },
  },

  {
    id: 'uenv-zero',
    boards: UBOOT,
    cardinality: 'many',
    instance: /^factory: (UENV-[AB])/,
    shell: { pass: 'factory: UENV-' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const size = intKey(ctx.board, 'UENV_SIZE_BYTES')
      return SLOTS.map((slot) => {
        const layoutName = `UENV_${slot.upper}`
        const offset = Number(ctx.board.partition(layoutName)?.get('OFFSET_BYTES') ?? Number.NaN)
        if (!Number.isSafeInteger(offset)) {
          throw new ToolOutputError(`${ctx.board.path} declares no usable ${layoutName}_OFFSET_BYTES.`)
        }
        const nonZero = nonZeroBytes(ctx.image, offset, size)
        return verdict('uenv-zero', nonZero === 0,
          nonZero === 0
            ? `factory: UENV-${slot.upper} is entirely zero (${size / 1024} KiB at ${offset} bytes; `
              + `U-Boot populates it on first boot)`
            : `factory: UENV-${slot.upper} contains ${nonZero} non-zero bytes, expected none`,
          { instance: `UENV-${slot.upper}` })
      })
    },
  },

  {
    id: 'uenv-zero-skipped',
    boards: NOT_UBOOT,
    shell: { skip: 'the zero-filled U-Boot environment pair (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped('uenv-zero-skipped',
      `the zero-filled U-Boot environment pair (bootloader=${ctx.board.bootloader}): this board has `
      + `no uenv partitions, so there is nothing that must ship blank for the bootloader to populate`)],
  },
]


/** Every per-board generated entry, from each shipped board's own definition. */
function generatedFor(boards: readonly Board[]): CheckCase[] {
  return boards.flatMap(b => [
    ...rawBlobChecks(b),
    ...bspCompareChecks(b),
    ...ledChecks(b),
    ...bootScriptNumberChecks(b),
  ])
}

export function bootChainChecks(boards: readonly Board[]): readonly CheckCase[] {
  return [
    ...generatedFor(boards),
    ...RAW_BLOB_SKIP,
    ...LED_SKIP,
    ...BOOT_SCRIPT_CHECKS,
    ...BOOT_SCRIPT_SKIPS,
    ...VERITY_ENV_CHECKS,
    ...ZERO_FILL_CHECKS,
  ]
}

/** The register's entries, built at module load from every board os/boards/ ships. */
export const BOOTCHAIN_CHECKS: readonly CheckCase[] = bootChainChecks(SHIPPED)
