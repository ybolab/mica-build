// Batch 3: the checks that only some boards run at all.
//
// Every family here is guarded in the oracle by a condition read out of the
// board definition -- `is_uboot_board`, `board_has_radio`, `board_has_hwinit`,
// `BOARD_HAS_STATUS_LED`, `BOARD_FIRMWARE_FILES` -- so on one board it concludes
// and on the other it SKIPS. Three consequences.
//
// A skip is a third verdict: `parity.ts` never defaults `shell.skip` to
// `shell.pass` and nothing here supplies one that would. Measured on both
// boards' real output 2026-08-26: 3 SKIP conclusions on cx3576, 22 on x64. A
// family that skips carries an explicit `skip` matcher and answers `skipped()`.
//
// The board lists are derived, never written down: `uBootBoards()` is every
// board whose `RAUC_BOOTLOADER` is uboot, `ledBoards()` every board declaring
// `BOARD_HAS_STATUS_LED=1`, computed at module load, so a third board in
// `boards/` is covered with nothing here edited.
//
// One `one` check per path, never a `many` over a loose substring: the radio
// firmware set, the hwinit confs, `btattach` and the status-LED files are all
// `sq_regular` calls, so a `many` over ` is a regular file` would also claim
// batch 2a's twenty-six board-invariant paths. Likewise ` contains ` names
// fourteen lines on cx3576 where `BOOT-A contains Image` names one. So each path
// gets its own check with the path in its matcher, and the boot-slot listing is
// generated per (board, slot, file) out of `BOOT_SLOT_REQUIRED_FILES` with
// `@SLOT@` substituted as the oracle substitutes it.
//
// Where a group skips as one line the skip gets a dedicated `<family>-skipped`
// entry, scoped by `boards:` to where the group skips while the per-item checks
// are scoped to where it runs -- two complements of one derived predicate, so
// they cannot drift apart or overlap, and one shell line keeps exactly one owner
// (two claimants is `ambiguous` and exit 1). A `-skipped` check has no failing
// direction against an image; what it asserts is the derivation, which is what
// its tests drive.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installedPackages } from './installed-packages.ts'
import type { Board } from './board.ts'
import { PER_SLOT, SLOTS, slotOffsetBytes } from './boot-slots.ts'
import { boardsWhere, hasFirmware, hasHwinit, hasLed, hasRadio, hasRawBlob, isUBoot, SHIPPED } from './board-scope.ts'
import { entry, ETC_UNITS, packedRoot, wantsLink } from './checks-root.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { fatList, readBytes } from './image.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { skipped, verdict } from './verdict.ts'

// the shipped boards, and the predicates the families are scoped by

// The predicates and the derived board lists live in `board-scope.ts`: the
// bootloader-environment and Wi-Fi families need the same three, and a second
// spelling of `is_uboot_board` beside this one is drift waiting to happen.

// the three shapes a board-conditional conclusion takes

/**
 * `sq_regular` for a path the board itself declares.
 *
 * The id carries the BOARD as well as the path. Two boards may legitimately
 * declare the same path -- `/etc/mos/bt.conf` would be right for any board with
 * a controller -- and two register entries with one id is a fault
 * `assertRegisterWellFormed` refuses, so the board is part of the identity
 * wherever the check is generated per board.
 */
function boardRegularFile(idPrefix: string, board: string, path: string): CheckCase {
  const id = `${idPrefix}-${board}${path}`
  return {
    id,
    boards: [board],
    shell: { pass: `${path} is a regular file`, fail: `${path} missing or not a regular file` },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), path)
      const ok = st !== undefined && st.isFile()
      return [verdict(id, ok, ok ? `${path} is a regular file` : `${path} missing or not a regular file`)]
    },
  }
}

/**
 * The register entry that owns a family's SKIP line, and nothing else.
 *
 * `boards` is the complement of the family's own predicate, so this entry is
 * applicable exactly where the oracle takes its `else` branch. It answers with
 * the oracle's own sentence: the message is what a reader sees beside the
 * shell's in a divergence, and a paraphrase there reads as a difference.
 */
function skipOwner(id: string, boards: readonly string[], matcher: string, message: (board: Board) => string): CheckCase {
  return {
    id,
    boards,
    shell: { skip: matcher },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped(id, message(ctx.board))],
  }
}

/** `sq_grep`: the `what` clause is the identity and both directions carry it. */
function packedGrep(input: {
  id: string
  boards?: readonly string[]
  path: string
  pattern: RegExp
  what: string
}): CheckCase {
  const { id, path, pattern, what } = input
  return {
    id,
    ...(input.boards === undefined ? {} : { boards: input.boards }),
    shell: { pass: what },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const st = entry(root, path)
      const ok = st !== undefined
        && readFileSync(join(root, path), 'utf8').split('\n').some(l => pattern.test(l))
      return [verdict(id, ok, ok ? what : `${what} — ${path} missing or does not match /${pattern.source}/`)]
    },
  }
}

// the loader partition

/**
 * A board key that must be a whole number, or a THROW naming it.
 *
 * Not a fail: "the definition does not say how big the loader is" is a
 * statement about `board.env`, and answering it as a failed check would put a
 * verdict about the board into a report about the image.
 */
function requireNumber(board: Board, key: string, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new ToolOutputError(
      `${board.path} declares no usable ${key}. The loader assertions compare the GPT against the `
      + `board's own numbers; a missing one would make this check a statement about the definition `
      + `rather than about the image.`,
    )
  }
  return value
}

const LOADER = 'LOADER'
const UENV_A = 'UENV_A'

const LOADER_CHECKS: readonly CheckCase[] = [
  {
    // Abutment, and the entry that owns the group's SKIP on a grub board.
    //
    // Why this one owns it. The skip's own sentence is "there is no raw region
    // for systemd-repart to discard and no GPT entry to assert", and this is
    // the assertion about exactly that: a gap between the loader partition and
    // uenv-a is an uncovered region, and repart discards uncovered regions on
    // first boot. The other three are scoped to the U-Boot boards, so on a grub
    // board they produce no row at all rather than a second claim on this line.
    id: 'loader-abuts-uenv-a',
    shell: {
      pass: '; no untracked gap is left between them',
      fail: 'anything not covered by a partition entry is discarded by systemd-repart',
      skip: 'the loader-partition protections (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { board } = ctx
      if (!hasRawBlob(board)) {
        return [skipped('loader-abuts-uenv-a', loaderSkipMessage(board))]
      }
      const table = await ctx.gpt()
      const partnum = requireNumber(board, 'LOADER_PARTNUM', board.partition(LOADER)?.partnum)
      const label = board.partition(LOADER)?.label ?? ''
      const uenvLabel = board.partition(UENV_A)?.label ?? ''
      const uenvStart = requireNumber(board, 'UENV_A_START_SECTOR', board.partition(UENV_A)?.startSector)
      const p = table.partition(partnum)
      const first = p?.firstSector
      const size = p?.sizeSectors
      const ok = first !== undefined && size !== undefined && first + size === uenvStart
      return [verdict(
        'loader-abuts-uenv-a',
        ok,
        ok
          ? `p${partnum} (${label}) ends exactly where ${uenvLabel} begins (sector ${uenvStart}); `
            + `no untracked gap is left between them`
          : `p${partnum} (${label}) covers sectors ${first ?? ''}..${(first ?? 0) + (size ?? 0) - 1} but `
            + `${uenvLabel} starts at ${uenvStart}; anything not covered by a partition entry is `
            + `discarded by systemd-repart`,
      )]
    },
  },

  {
    // The layout's two spellings of the same number. LOADER_SIZE_SECTORS *
    // SECTOR_SIZE is what the GPT entry covers; UBOOT_MAX_BYTES is what the
    // U-Boot fit check enforces. A blob that passes the fit check and overruns
    // the partition is what these disagreeing produces.
    //
    // Read from the DEFINITION on both sides, exactly as the oracle does
    //: this is the one loader assertion that is about the board file
    // rather than about the image, and reading one side out of the GPT would
    // change what it says.
    id: 'loader-size-matches-uboot-max',
    boards: boardsWhere(hasRawBlob),
    shell: {
      pass: ', exactly the limit the U-Boot fit check enforces',
      fail: ' but UBOOT_MAX_BYTES is ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { board } = ctx
      const partnum = requireNumber(board, 'LOADER_PARTNUM', board.partition(LOADER)?.partnum)
      const sectors = requireNumber(board, 'LOADER_SIZE_SECTORS', board.partition(LOADER)?.sizeSectors)
      const sectorSize = requireNumber(board, 'SECTOR_SIZE', board.sectorSize)
      const maxRaw = board.get('UBOOT_MAX_BYTES')
      const max = maxRaw === undefined ? undefined : Number(maxRaw)
      const want = requireNumber(board, 'UBOOT_MAX_BYTES', max)
      const got = sectors * sectorSize
      const ok = got === want
      return [verdict(
        'loader-size-matches-uboot-max',
        ok,
        ok
          ? `p${partnum} is ${want} bytes, exactly the limit the U-Boot fit check enforces`
          : `p${partnum} is ${got} bytes but UBOOT_MAX_BYTES is ${want}; a blob that passes the fit `
            + `check could still overrun the partition`,
      )]
    },
  },

  {
    // The first four bytes at the loader's start sector. An entry over the
    // wrong bytes protects the wrong bytes, and the device reaches maskrom on
    // the boot after the first growth run rather than at flash time.
    id: 'loader-idbloader-magic',
    boards: boardsWhere(hasRawBlob),
    shell: {
      pass: ' starts with the Rockchip idbloader magic ',
      fail: ', expected the idbloader magic ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { board } = ctx
      const partnum = requireNumber(board, 'LOADER_PARTNUM', board.partition(LOADER)?.partnum)
      const start = requireNumber(board, 'LOADER_START_SECTOR', board.partition(LOADER)?.startSector)
      const sectorSize = requireNumber(board, 'SECTOR_SIZE', board.sectorSize)
      const want = (board.partition(LOADER)?.magicHex ?? '').toLowerCase()
      if (want === '') {
        throw new ToolOutputError(`${board.path} declares no LOADER_MAGIC_HEX.`)
      }
      // `dd ... | od -An -tx1 -N4`: the first FOUR bytes at the start sector,
      // in the order they are on the medium. Not a 32-bit read -- the oracle
      // prints bytes, and a word read would print them reversed on this host.
      const got = Buffer.from(readBytes(ctx.image, start * sectorSize, 4)).toString('hex')
      const ok = got === want
      return [verdict(
        'loader-idbloader-magic',
        ok,
        ok
          ? `p${partnum} starts with the Rockchip idbloader magic ${want} ('RKNS')`
          : `p${partnum} starts with '${got}', expected the idbloader magic ${want} ('RKNS'); the `
            + `partition does not cover a bootloader`,
      )]
    },
  },

  {
    // The type is the protection. systemd-repart pairs a definition with a
    // partition by type, so a loader carrying linux-generic or the ESP type is
    // a loader some /etc/repart.d file can be made to grow into. Unique, and
    // distinct from both, or the entry protects nothing.
    id: 'loader-typecode-unique',
    boards: boardsWhere(hasRawBlob),
    shell: {
      pass: ' partition, and that type is neither linux-generic nor the ESP type',
      fail: 'the loader type must be unique and distinct from linux-generic/ESP',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { board } = ctx
      const partnum = requireNumber(board, 'LOADER_PARTNUM', board.partition(LOADER)?.partnum)
      const declared = board.partition(LOADER)?.typecode ?? ''
      const linux = (board.get('TYPECODE_LINUX') ?? '').toLowerCase()
      const esp = (board.get('TYPECODE_ESP') ?? '').toLowerCase()
      if (declared === '' || linux === '' || esp === '') {
        throw new ToolOutputError(
          `${board.path} declares no LOADER_TYPECODE, TYPECODE_LINUX or TYPECODE_ESP, so "unique and `
          + `distinct from both" has nothing to be asserted against.`,
        )
      }
      const table = await ctx.gpt()
      const want = declared.toLowerCase()
      const got = (table.partition(partnum)?.typeGuid ?? '').toLowerCase()
      // Counted over the GPT the image carries, not over the layout: what is
      // being asserted is that the ASSEMBLED table has exactly one.
      const carrying = table.partitions.filter(p => p.typeGuid.toLowerCase() === want).length
      const ok = got === want && want !== linux && want !== esp && carrying === 1
      return [verdict(
        'loader-typecode-unique',
        ok,
        ok
          ? `p${partnum} is the only ${declared} partition, and that type is neither linux-generic `
            + `nor the ESP type, so no /etc/repart.d definition can pair with it`
          : `the loader type must be unique and distinct from linux-generic/ESP; p${partnum} type is `
            + `'${table.partition(partnum)?.typeGuid ?? ''}' and ${carrying} partition(s) carry ${declared}`,
      )]
    },
  },
]

/** The negative-branch sentence, rebuilt from the same values. */
function loaderSkipMessage(board: Board): string {
  const parts = (board.layoutPartitions ?? []).length
  return `the loader-partition protections (${parts}-partition ${board.name} layout has no loader): `
    + `this board keeps its firmware outside the user-area GPT, so there is no raw region for `
    + `systemd-repart to discard and no GPT entry to assert. cx3576 needs these; `
    + `tests/handshake-test/ remains the only cover for the U-Boot A/B handshake either way`
}

// what a boot slot must contain


/**
 * One `one` check per (board, slot, required file).
 *
 * `@SLOT@` is substituted with the lowercase trailing letter of the slot NAME,
 * which is how the oracle spells it -- so cx3576's
 * `mos-verity-@SLOT@.env` becomes `mos-verity-a.env` in BOOT-A and
 * `mos-verity-b.env` in BOOT-B, and x64's list, which contains no `@SLOT@`,
 * comes through unchanged in both.
 *
 * The matcher is `${slot} contains ${file}`, which names exactly one line.
 * ` contains ` alone names fourteen on cx3576 -- the kernel-modules conclusion
 * batch 2a claims, the two `contains no ...` conclusions per slot below, and the
 * container-engine one -- which is why neither M4b nor M4c could register this
 * family at all.
 */
function bootSlotFileChecks(board: Board): CheckCase[] {
  const required = board.bootSlotRequiredFiles ?? []
  return SLOTS.flatMap(slot => required.map((raw) => {
    const file = raw.replaceAll('@SLOT@', slot.letter)
    const id = `boot-slot-file-${board.name}-${slot.display}-${file}`
    return {
      id,
      boards: [board.name],
      shell: {
        pass: `${slot.display} contains ${file}`,
        fail: `${slot.display} is missing ${file}`,
      },
      run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
        const listing = await fatList(ctx.tools, {
          image: ctx.image,
          offsetBytes: slotOffsetBytes(ctx.board, slot.layout),
        })
        // `grep -qxF "::/${f}"` -- an EXACT line, so a file in a subdirectory
        // of the same name does not satisfy the top-level requirement.
        const ok = listing.includes(`::/${file}`)
        return [verdict(
          id,
          ok,
          ok ? `${slot.display} contains ${file}` : `${slot.display} is missing ${file}`,
        )]
      },
    } satisfies CheckCase
  }))
}

const SLOT_LISTING_CHECKS: readonly CheckCase[] = [
  {
    // THE assertion that keeps the A/B handshake reachable, and the entry that
    // owns the grub board's SKIP for the whole U-Boot-only group.
    //
    // That skip line -- `BOOT-A: the extlinux and Image/dtb assertions
    // (bootloader=grub)` -- is ONE conclusion covering two families. The
    // no-initramfs check below USED to be a third: it was scoped to the U-Boot
    // boards because a grub slot legitimately carried an initrd. It does not
    // any more -- x64's own kernel reads the dm-mod.create= table itself -- so
    // that check is unconditional now and this skip has stopped covering it.
    // The Image/dtb byte-compare against the local BSP tree is NOT ported (see
    // the inventory in the M4d report); it is left unclaimed rather than folded
    // in here, because a check that reads `_out/boards/<board>/` is a
    // different kind of check from one that reads the image.
    id: 'boot-slot-no-extlinux',
    cardinality: 'many',
    instance: PER_SLOT,
    shell: {
      pass: 'contains no extlinux/ directory and no extlinux.conf',
      fail: 'Both U-Boot boot frameworks try extlinux BEFORE boot.scr',
      skip: ': the extlinux and Image/dtb assertions',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const out: CheckResult[] = []
      for (const slot of SLOTS) {
        if (!isUBoot(ctx.board)) {
          out.push(skipped('boot-slot-no-extlinux', uBootSlotSkipMessage(ctx.board, slot.display), {
            instance: slot.display,
          }))
          continue
        }
        const listing = await fatList(ctx.tools, {
          image: ctx.image,
          offsetBytes: slotOffsetBytes(ctx.board, slot.layout),
        })
        // `grep -qi extlinux` over the whole recursive listing: a directory
        // named extlinux and a file named extlinux.conf are both fatal, and
        // both appear in `mdir -/ -b`'s output.
        const hits = listing.filter(l => /extlinux/i.test(l))
        const scriptName = ctx.board.get('BOOT_SCRIPT_NAME') ?? ''
        out.push(verdict(
          'boot-slot-no-extlinux',
          hits.length === 0,
          hits.length === 0
            ? `${slot.display} contains no extlinux/ directory and no extlinux.conf (a mos slot must `
              + `boot via ${scriptName})`
            : `${slot.display} contains extlinux (${hits.join(' ')} ). Both U-Boot boot frameworks `
              + `try extlinux BEFORE boot.scr, so this silently bypasses the whole RAUC A/B `
              + `handshake: BOOT_ORDER is never honoured, boot attempts are never counted and `
              + `rollback never happens, with no error anywhere. Remove it.`,
          { instance: slot.display },
        ))
      }
      return out
    },
  },

  {
    // EVERY BOARD, and it was U-Boot-only until PLAN-074. The exemption was
    // real while it lasted: x64 ran Debian's generic kernel, which has no
    // CONFIG_DM_INIT and ignored the dm-mod.create= verity table, so a grub
    // slot HAD to carry an initrd whose local-top script assembled the root
    // instead -- and the rule was inverted there rather than absent.
    //
    // mos-kernel-x64 has that symbol, so both boards now boot the one contract
    // the same way and neither slot carries an initrd. Unscoping this is the
    // point rather than a tidy-up: an initrd reappearing in an x64 slot is
    // exactly how a reintroduced distribution kernel would show up in the
    // image, and while this check was gated it was the one place that could
    // not say so.
    id: 'boot-slot-no-initramfs',
    cardinality: 'many',
    instance: PER_SLOT,
    shell: {
      pass: 'contains no initramfs file',
      fail: 'contains an initramfs/initrd file',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const out: CheckResult[] = []
      for (const slot of SLOTS) {
        const listing = await fatList(ctx.tools, {
          image: ctx.image,
          offsetBytes: slotOffsetBytes(ctx.board, slot.layout),
        })
        const hits = listing.filter(l => /initr/i.test(l))
        out.push(verdict(
          'boot-slot-no-initramfs',
          hits.length === 0,
          hits.length === 0
            ? `${slot.display} contains no initramfs file`
            : `${slot.display} contains an initramfs/initrd file: ${hits.join(' ')} `,
          { instance: slot.display },
        ))
      }
      return out
    },
  },
]

/** The negative-branch sentence for boards that do not use U-Boot. */
function uBootSlotSkipMessage(board: Board, slot: string): string {
  return `${slot}: the extlinux and Image/dtb assertions `
    + `(bootloader=${board.get('RAUC_BOOTLOADER') ?? ''}). extlinux is a U-Boot boot framework, and `
    + `Image/rk3576-src.dtb are that BSP's artefact names. The no-initramfs rule is NOT skipped `
    + `here: it applies to every board now that both build a kernel that assembles the verity root `
    + `from the command line`
}

// the radio -- firmware set and module list

function radioFirmwareChecks(board: Board): CheckCase[] {
  return (board.firmwareFiles ?? []).map(fw => boardRegularFile('board-firmware', board.name, fw))
}

const RADIO_CHECKS: readonly CheckCase[] = [
  skipOwner(
    'board-radio-firmware-set-skipped',
    boardsWhere(b => !hasFirmware(b)),
    'the board radio-firmware set (',
    board => `the board radio-firmware set (${board.name} declares BOARD_FIRMWARE_FILES empty): there `
      + `is no radio on this board, so there is no runtime firmware it must carry`,
  ),

  {
    // Single SKU: bcmdhd was dropped with the AIC-only fleet decision and must
    // not creep back. Comment lines are excluded, because the file may
    // legitimately EXPLAIN the drop.
    id: 'radio-modules-no-bcmdhd',
    boards: boardsWhere(b => hasHwinit(b, 'modules')),
    shell: {
      pass: '/etc/mos/modules.conf loads no bcmdhd module (single-SKU AIC8800)',
      fail: '/etc/mos/modules.conf missing or still loads bcmdhd',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const path = '/etc/mos/modules.conf'
      const st = entry(root, path)
      const live = st === undefined
        ? []
        : readFileSync(join(root, path), 'utf8').split('\n').filter(l => !/^[ \t]*#/.test(l))
      const ok = st !== undefined && !live.some(l => l.includes('bcmdhd'))
      return [verdict(
        'radio-modules-no-bcmdhd',
        ok,
        ok
          ? '/etc/mos/modules.conf loads no bcmdhd module (single-SKU AIC8800)'
          : '/etc/mos/modules.conf missing or still loads bcmdhd (single-SKU AIC8800 board)',
      )]
    },
  },

  packedGrep({
    id: 'radio-modules-aic-fdrv',
    boards: boardsWhere(b => hasHwinit(b, 'modules')),
    path: '/etc/mos/modules.conf',
    pattern: /aic8800_fdrv/,
    what: '/etc/mos/modules.conf lists aic8800_fdrv',
  }),

  packedGrep({
    id: 'radio-modules-aic-btlpm',
    boards: boardsWhere(b => hasHwinit(b, 'modules')),
    path: '/etc/mos/modules.conf',
    pattern: /^aic8800_btlpm$/,
    what: '/etc/mos/modules.conf lists aic8800_btlpm (BT core of the combo chip)',
  }),

  skipOwner(
    'radio-module-list-skipped',
    boardsWhere(b => !hasHwinit(b, 'modules')),
    'the radio module-list assertions (',
    board => `the radio module-list assertions (${board.name} declares no modules hwinit): `
      + `this board does not use the AIC8800 module-list contract`,
  ),
]

// the hwinit facts

function hwinitConfChecks(board: Board): CheckCase[] {
  return (board.hwinitConfs ?? []).map(c => {
    const check = boardRegularFile('hwinit-conf', board.name, `/etc/mos/${c}.conf`)
    const pkg = c === 'wireless' ? 'mos-s905x5m-radio' : c === 'bluetooth' ? 'mos-s905x5m-bluetooth' : undefined
    return pkg === undefined ? check : forS905Package(check, pkg)
  })
}

/** `health` is shared by every board and asserted unconditionally (batch 2a). */
const SHARED_ETC_MOS_CONF = 'health'

const HWINIT_CHECKS: readonly CheckCase[] = [
  skipOwner(
    'hwinit-confs-skipped',
    boardsWhere(b => (b.hwinitConfs ?? []).length === 0),
    'the per-board hwinit facts under /etc/mos (',
    board => `the per-board hwinit facts under /etc/mos (${board.name} declares BOARD_HWINIT_CONFS `
      + `empty): this board has no CAN bus, USB gadget controller, Bluetooth radio or burned MAC for `
      + `an hwinit unit to read`,
  ),

  {
    // The other direction, which the per-conf loop cannot see: a conf that
    // ships WITHOUT being declared. The layout is what the build reasons from
    // -- the Dockerfile installs an hwinit script only for a declared fact --
    // so an undeclared conf means the layout understates the board.
    id: 'hwinit-no-undeclared-conf',
    shell: {
      pass: "'s BOARD_HWINIT_CONFS; the layout is not understating what this board carries",
      fail: 'ship in /etc/mos but are NOT declared in BOARD_HWINIT_CONFS',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const declared = ctx.board.hwinitConfs ?? []
      const shipped = etcMosConfs(root)
      const undeclared = shipped.filter(c => c !== SHARED_ETC_MOS_CONF && !declared.includes(c))
      return [verdict(
        'hwinit-no-undeclared-conf',
        undeclared.length === 0,
        undeclared.length === 0
          ? `every /etc/mos/*.conf in the image is declared in ${ctx.board.name}'s BOARD_HWINIT_CONFS; `
            + `the layout is not understating what this board carries`
          : `these board facts ship in /etc/mos but are NOT declared in BOARD_HWINIT_CONFS: `
            + `${undeclared.join(' ')}. The layout is what the build reasons from, so an undeclared `
            + `fact is one no check here covers`,
      )]
    },
  },

  {
    // The unit set is ENUMERATED, never hardcoded: it grows, and mos-mac and
    // mos-gadget were added and silently shipped disabled once already.
    id: 'hwinit-units-present',
    shell: {
      pass: 'mos-*.service unit(s) in the image: ',
      fail: 'no mos-*.service units found in /usr/lib/systemd/system',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const units = mosUnits(await packedRoot(ctx))
      return [verdict(
        'hwinit-units-present',
        units.length > 0,
        units.length > 0
          ? `found ${units.length} mos-*.service unit(s) in the image: ${units.join(' ')} `
          : 'no mos-*.service units found in /usr/lib/systemd/system',
      )]
    },
  },

  {
    // A SKIP on both boards, which is why it is registered at all. The two
    // reconciler-owned units are deliberately NOT enabled -- mosd starts them
    // from `mqtt.enabled` -- so the enumeration above steps over them and says
    // so. An unregistered SKIP is an unclaimed conclusion; a skip matcher that
    // fell back to `pass` would be worse.
    //
    // The matcher keeps the trailing ` for`: `the enabled-at-boot assertion (`
    // is a DIFFERENT skip, the one a board whose every mos-*.service is
    // reconciler-owned emits, and the two are told apart by nothing else.
    id: 'hwinit-reconciler-owned-skipped',
    shell: { skip: 'the enabled-at-boot assertion for' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const owned = mosUnits(await packedRoot(ctx)).filter(u => RECONCILER_OWNED.includes(u))
      if (owned.length === 0) {
        throw new ToolOutputError(
          `no reconciler-owned unit (${RECONCILER_OWNED.join(', ')}) is in this image, so the oracle `
          + `prints no skip for them and this check has nothing to compare. That is a change in what `
          + `the image ships, not a verdict about it.`,
        )
      }
      return [skipped(
        'hwinit-reconciler-owned-skipped',
        `the enabled-at-boot assertion for ${owned.join(' ')}: these are started by mosd from the `
        + `settings tree, not by the image, and their own checks assert the image does NOT enable them`,
      )]
    },
  },

  {
    // How many units the enumeration actually JUDGED. Without the count, a
    // board whose every mos-*.service is reconciler-owned gets "every one is
    // enabled" from a loop that examined none -- so zero judged is a SKIP.
    id: 'hwinit-units-enabled',
    shell: {
      pass: 'mos-*.service unit(s) present in the image is also enabled',
      fail: 'these mos-*.service units are installed but NOT enabled:',
      skip: 'the enabled-at-boot assertion (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const judged = mosUnits(root).filter(u => !RECONCILER_OWNED.includes(u))
      if (judged.length === 0) {
        return [skipped(
          'hwinit-units-enabled',
          `the enabled-at-boot assertion (${ctx.board.name} ships no hwinit unit: every mos-*.service `
          + `in the image is reconciler-owned): there is no unit here whose enablement could be right `
          + `or wrong`,
        )]
      }
      const notEnabled = judged.filter(u => wantsLink(root, ETC_UNITS, u) === undefined)
      return [verdict(
        'hwinit-units-enabled',
        notEnabled.length === 0,
        notEnabled.length === 0
          ? `every one of the ${judged.length} hwinit mos-*.service unit(s) present in the image is `
            + `also enabled`
          : `these mos-*.service units are installed but NOT enabled: ${notEnabled.join(' ')}`,
      )]
    },
  },

  {
    // The helper scripts, counted against what the board DECLARES. "At least
    // one is present" cannot tell a board that legitimately has none from one
    // whose install step dropped all of them, and it fails a QEMU machine for
    // having no CAN bus. The count is the assertion.
    id: 'hwinit-helpers-match-declaration',
    shell: {
      pass: 'hwinit helper(s) ',
      fail: 'hwinit fact(s) (',
      skip: 'the hwinit helper scripts (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const helpers = listDir(root, '/usr/lib/mos').filter(n => n.startsWith('hwinit-')).sort()
      if (ctx.board.name === 's905x5m') {
        const packages = installedPackages(root)
        const expected = ['hwinit-audio']
        if (packages.has('mos-s905x5m-radio')) expected.push('hwinit-wireless')
        if (packages.has('mos-s905x5m-bluetooth')) expected.push('hwinit-bluetooth', 'hwinit-bt')
        expected.sort()
        const ok = helpers.join(' ') === expected.join(' ')
        return [verdict('hwinit-helpers-match-declaration', ok,
          ok ? `all ${expected.length} hwinit helper(s) selected by the package inventory are present`
            : `selected hwinit fact(s) (${expected.join(' ')}) disagree with helpers (${helpers.join(' ')})`)]
      }
      const declared = (ctx.board.hwinitConfs ?? []).length
      if (helpers.length === declared && declared !== 0) {
        return [verdict(
          'hwinit-helpers-match-declaration',
          true,
          `all ${declared} hwinit helper(s) ${ctx.board.name} declares are in /usr/lib/mos: `
          + `${helpers.join(' ')} `,
        )]
      }
      if (declared === 0 && helpers.length === 0) {
        return [skipped(
          'hwinit-helpers-match-declaration',
          `the hwinit helper scripts (${ctx.board.name} declares BOARD_HWINIT_CONFS empty): the image `
          + `ships none, which is asserted here as an equality rather than assumed -- a helper present `
          + `without a board fact to read would fail this`,
        )]
      }
      return [verdict(
        'hwinit-helpers-match-declaration',
        false,
        `${ctx.board.name} declares ${declared} hwinit fact(s) `
        + `(${(ctx.board.hwinitConfs ?? []).join(' ') || 'none'}) but /usr/lib/mos holds `
        + `${helpers.length} helper(s): ${helpers.join(' ')} . A helper with no fact can never run; a `
        + `fact with no helper is never applied`,
      )]
    },
  },

  boardRegularFileForFeature(
    'gadget-udev-rule',
    boardsWhere(b => hasHwinit(b, 'gadget')),
    '/usr/lib/udev/rules.d/60-mos-gadget-getty.rules',
  ),

  packedGrep({
    id: 'gadget-udev-rule-pulls-getty',
    boards: boardsWhere(b => hasHwinit(b, 'gadget')),
    path: '/usr/lib/udev/rules.d/60-mos-gadget-getty.rules',
    pattern: /serial-getty@ttyGS0\.service/,
    what: 'the udev rule pulls in serial-getty@ttyGS0 when the gadget enumerates',
  }),

  skipOwner(
    'gadget-udev-rule-skipped',
    boardsWhere(b => !hasHwinit(b, 'gadget')),
    'the USB-gadget getty udev rule (',
    board => `the USB-gadget getty udev rule (${board.name} declares no gadget in `
      + `BOARD_HWINIT_CONFS): there is no gadget controller to enumerate a ttyGS0 for, and the rule `
      + `ships only with the hwinit script that configures it`,
  ),

  // The stable-MAC assignment ships as THREE files, and the reason all three are
  // asserted is that any one of them missing turns the other two into a no-op
  // nothing reports. mos-mac.service is a one-shot pass over /sys/class/net/eth*
  // and cannot reach a port that registers later; the udev rule is what reaches
  // it; and the .link file is what stops systemd assigning an address of its own
  // first, after which hwinit-mac reads NET_ADDR_SET and stands down.

  boardRegularFileForFeature(
    'mac-udev-rule',
    boardsWhere(b => hasHwinit(b, 'mac')),
    '/usr/lib/udev/rules.d/60-mos-mac-stable.rules',
  ),

  packedGrep({
    id: 'mac-udev-rule-runs-hwinit',
    boards: boardsWhere(b => hasHwinit(b, 'mac')),
    path: '/usr/lib/udev/rules.d/60-mos-mac-stable.rules',
    pattern: /RUN\+="\/usr\/lib\/mos\/hwinit-mac %k"/,
    what: 'the udev rule assigns a stable MAC to an Ethernet port when it appears',
  }),

  {
    // THE ORDERING IS THE ASSERTION, not the file's presence. systemd matches
    // .link files in lexical order and the FIRST match wins, and the shipped
    // 99-default.link carries MACAddressPolicy=persistent -- which is not inert
    // on a board whose NICs have no address in hardware: link-config.c generates
    // one for a NET_ADDR_RANDOM port out of the machine ID and either an
    // ID_NET_NAME_* property or the interface's own name. The kernel then
    // records NET_ADDR_SET, hwinit-mac reads that as "somebody else owns this",
    // and the eMMC-CID-rooted address it exists to apply is never applied. So
    // this compares NAMES against every other .link that assigns an address; a
    // file renamed above one of them is the failure, and it is silent on the
    // device.
    id: 'mac-link-precedes-default-policy',
    boards: boardsWhere(b => hasHwinit(b, 'mac')),
    shell: {
      pass: 'sorts before every .link file that would assign one',
      fail: 'would be consulted before it and assigns a MAC address',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'mac-link-precedes-default-policy'
      const ours = '60-mos-mac-stable.link'
      const body = linkFile(root, ours)
      if (body === undefined || !/^MACAddressPolicy=none$/m.test(body)) {
        return [verdict(id, false, `${NETWORK_DIR}/${ours} is missing or does not set `
          + `MACAddressPolicy=none, so systemd's own persistent policy decides this board's MAC `
          + `addresses and hwinit-mac never gets to`)]
      }
      const earlier = listDir(root, NETWORK_DIR)
        .filter(n => n.endsWith('.link') && n < ours)
        .filter(n => /^MACAddressPolicy=(?!none$)/m.test(linkFile(root, n) ?? ''))
        .sort()
      return [verdict(
        id,
        earlier.length === 0,
        earlier.length === 0
          ? `${ours} sets MACAddressPolicy=none and sorts before every .link file that would assign `
            + `one, so hwinit-mac is the only writer of this board's MAC addresses`
          : `${earlier.join(' ')} sorts before ${ours} and would be consulted before it and assigns a `
            + `MAC address; systemd would paint a machine-id-derived address over the port and `
            + `hwinit-mac would then read NET_ADDR_SET and leave it`,
      )]
    },
  },

  {
    // A matched .link file REPLACES the default wholesale rather than layering
    // over it, so the two naming policies had to be copied into ours for the
    // board not to lose its alternative interface names as a side effect of a
    // change about MAC addresses. A copy is only correct while it matches, and a
    // systemd upgrade is exactly what moves the original.
    id: 'mac-link-keeps-default-name-policies',
    boards: boardsWhere(b => hasHwinit(b, 'mac')),
    shell: {
      pass: 'carries 99-default.link\'s naming policies verbatim',
      fail: 'differs from 99-default.link on ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'mac-link-keeps-default-name-policies'
      const ours = '60-mos-mac-stable.link'
      const dflt = linkFile(root, '99-default.link')
      if (dflt === undefined) {
        throw new ToolOutputError(
          `${NETWORK_DIR}/99-default.link is not in this image, so there is no default for `
          + `${ours} to be compared against. That is a change in what systemd ships, not a verdict `
          + `about the board.`,
        )
      }
      const body = linkFile(root, ours) ?? ''
      const differ = NAME_POLICY_KEYS.filter(k => policyLine(body, k) !== policyLine(dflt, k))
      return [verdict(
        id,
        differ.length === 0,
        differ.length === 0
          ? `${ours} carries 99-default.link's naming policies verbatim, so replacing the default for `
            + `eth* changes nothing but the MAC policy it was written for`
          : `${ours} differs from 99-default.link on ${differ.join(' and ')}; a matched .link file `
            + `replaces the default rather than layering over it, so the board silently loses `
            + `whatever the default would have given it`,
      )]
    },
  },

  skipOwner(
    'mac-stable-assignment-skipped',
    boardsWhere(b => !hasHwinit(b, 'mac')),
    'the stable-MAC udev rule and link policy (',
    board => `the stable-MAC udev rule and link policy (${board.name} declares no mac in `
      + `BOARD_HWINIT_CONFS): its NICs carry an address in hardware, so the kernel never invents one `
      + `and there is nothing here to make stable`,
  ),
]

const NETWORK_DIR = '/usr/lib/systemd/network'

/** The two keys ours copies out of 99-default.link, and must keep matching. */
const NAME_POLICY_KEYS: readonly string[] = ['NamePolicy', 'AlternativeNamesPolicy']

function linkFile(root: string, name: string): string | undefined {
  const path = `${NETWORK_DIR}/${name}`
  return entry(root, path)?.isFile() === true ? readFileSync(join(root, path), 'utf8') : undefined
}

/** One `Key=value` line's value, or undefined -- so absent on both sides agrees. */
function policyLine(body: string, key: string): string | undefined {
  return body.split('\n').find(l => l.startsWith(`${key}=`))
}

const RECONCILER_OWNED: readonly string[] = ['mos-mqttd.service', 'mos-mqtt-broker.service']

// the Bluetooth userland -- the verification contract, and wifi.conf

const BLUETOOTH_CHECKS: readonly CheckCase[] = [
  boardRegularFileForFeature(
    'bt-btattach',
    boardsWhere(b => hasRadio(b, 'bluetooth')),
    '/usr/bin/btattach',
  ),

  {
    // INVERTED against the usual shape: a `Name =` line in bluez's main.conf is
    // the FAILURE, because pinning it blocks the hostname plugin and every
    // device in the fleet advertises the same name.
    id: 'bt-main-conf-leaves-name',
    boards: boardsWhere(b => hasRadio(b, 'bluetooth')),
    shell: {
      pass: '/etc/bluetooth/main.conf leaves Name to the hostname plugin',
      fail: '/etc/bluetooth/main.conf pins Name (blocks the hostname plugin)',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const path = '/etc/bluetooth/main.conf'
      const st = entry(root, path)
      const pinned = st !== undefined
        && readFileSync(join(root, path), 'utf8').split('\n').some(l => /^[ \t]*Name[ \t]*=/.test(l))
      return [verdict(
        'bt-main-conf-leaves-name',
        !pinned,
        pinned
          ? '/etc/bluetooth/main.conf pins Name (blocks the hostname plugin)'
          : '/etc/bluetooth/main.conf leaves Name to the hostname plugin',
      )]
    },
  },

  {
    id: 'bt-service-enabled',
    boards: boardsWhere(b => hasRadio(b, 'bluetooth')),
    shell: {
      pass: 'bluetooth.service is enabled (',
      fail: 'bluetooth.service enablement symlink missing',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const link = wantsLink(await packedRoot(ctx), ETC_UNITS, 'bluetooth.service')
      return [verdict(
        'bt-service-enabled',
        link !== undefined,
        link !== undefined
          ? `bluetooth.service is enabled (${link})`
          : 'bluetooth.service enablement symlink missing (no *.wants entry under /etc/systemd/system)',
      )]
    },
  },

  skipOwner(
    'bt-userland-skipped',
    boardsWhere(b => !hasRadio(b, 'bluetooth')),
    'the Bluetooth userland (',
    board => `the Bluetooth userland (btattach, bluez's main.conf and the bluetooth.service `
      + `enablement symlink): ${board.name} declares no bluetooth in BOARD_RADIOS, so the image ships `
      + `no controller stack to configure or enable`,
  ),

  {
    // Board-UNCONDITIONAL, and it belongs here rather than in batch 2a only
    // because it is the other half of the radio story: mos-modules supersedes
    // that file as the way Wi-Fi modules are loaded. A board
    // with no radio must not carry it either, which is why there is no gate.
    id: 'radio-no-legacy-wifi-modules-conf',
    shell: {
      pass: '/etc/modules-load.d/wifi.conf is gone (superseded by mos-modules)',
      fail: '/etc/modules-load.d/wifi.conf still present (superseded by mos-modules)',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      // `[ -e ... ]`, so it FOLLOWS a link and a dangling symlink at that path
      // reads as absent. Reproduced rather than improved on: a port that
      // answered "present" for a broken link would go red on an image the
      // oracle passes, and the divergence would be the port's own.
      const root = await packedRoot(ctx)
      const exists = existsSync(join(root, '/etc/modules-load.d/wifi.conf'))
      return [verdict(
        'radio-no-legacy-wifi-modules-conf',
        !exists,
        exists
          ? '/etc/modules-load.d/wifi.conf still present (superseded by mos-modules)'
          : '/etc/modules-load.d/wifi.conf is gone (superseded by mos-modules)',
      )]
    },
  },
]

// the status indicator -- check_status_led and the overlay set

const LED_SCRIPT = '/usr/lib/mos/mos-status-led'
const LED_UNIT = '/usr/lib/systemd/system/mos-status-led.service'

const LED_CHECKS: readonly CheckCase[] = [
  {
    // check_status_led's BOARD_HAS_STATUS_LED=0 branch, and the only check in
    // this file whose PASS is an absence.
    //
    // A board that declares no indicator must not carry the unit: it reads
    // /sys/class/leds/status-{red,blue}/brightness, which do not exist there,
    // so it fails on EVERY boot -- a permanently-failed unit on a shipped
    // image, indistinguishable to an operator from a real fault.
    //
    // Its failing direction is only reachable from a fixture: on x64's real
    // image the branch passes, so checks-board.test.ts drives it red against an
    // x64-shaped packed-root fixture carrying mos-status-led files.
    id: 'status-led-absent',
    boards: boardsWhere(b => !hasLed(b)),
    shell: {
      pass: 'declares no status indicator and ships no mos-status-led files',
      fail: 'but the image carries:',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const left = ledFilesLeft(root)
      return [verdict(
        'status-led-absent',
        left.length === 0,
        left.length === 0
          ? `${ctx.board.name} declares no status indicator and ships no mos-status-led files, so `
            + `nothing fails every boot reading /sys/class/leds on a board that has none`
          : `${ctx.board.name} declares BOARD_HAS_STATUS_LED=0 but the image carries:${left.map(f => ` ${f}`).join('')} . `
            + `The unit reads /sys/class/leds/status-*/brightness, which this board does not have, so `
            + `it fails on every boot`,
      )]
    },
  },

  {
    // check_status_led's BOARD_HAS_STATUS_LED=1 branch: TWO conclusions when
    // the unit is present, and ONE -- naming neither clause -- when it is not,
    // because the function returns early.
    //
    // That is `check_ui_location`'s shape, and it is modelled the same way: a
    // single `many` check whose instance is the assertion's own clause, with
    // the early return as ONE firing rather than two absences. Two independent
    // `one` checks could not model it -- on the early-return path the oracle
    // prints one line neither of them matches, and the harness would report one
    // unclaimed conclusion and two orphans for an image that is simply missing
    // the unit.
    //
    // The FAIL matcher is a LIST, and this check is why `Matcher` grew one:
    // the three failure sentences share no substring that is not also in some
    // other check's line. `mos-status-led.service ` is in the overlay family's
    // failures too, `indicator` is in two SKIPs, and anything shorter reaches
    // further still. Three exact spellings claim exactly these three lines.
    id: 'status-led-ordering',
    boards: boardsWhere(hasLed),
    cardinality: 'many',
    instance: /(reports ready before the slot is confirmed|turns blue on a slot whose health gate failed|is not in the image)/,
    shell: {
      pass: 'catches an indicator that ',
      fail: [
        "catches an indicator that reports ready before the slot is confirmed: mos-status-led.service has no 'After=",
        "catches an indicator that turns blue on a slot whose health gate failed: mos-status-led.service has no 'Requires=",
        'declares BOARD_HAS_STATUS_LED=1 but',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const st = entry(root, LED_UNIT)
      if (st === undefined || !st.isFile()) {
        return [verdict(
          'status-led-ordering',
          false,
          `${ctx.board.name} declares BOARD_HAS_STATUS_LED=1 but ${LED_UNIT} is not in the image; the `
          + `indicator the operator reads to know the device is up would never run`,
          { instance: 'is not in the image' },
        )]
      }
      const lines = readFileSync(join(root, LED_UNIT), 'utf8').split('\n')
      const after = lines.some(l => /^After=mos-health\.service$/.test(l))
      const requires = lines.some(l => /^Requires=mos-health\.service$/.test(l))
      return [
        verdict(
          'status-led-ordering',
          after,
          after
            ? 'catches an indicator that reports ready before the slot is confirmed: '
              + 'mos-status-led.service is ordered after mos-health.service'
            : `catches an indicator that reports ready before the slot is confirmed: `
              + `mos-status-led.service has no 'After=mos-health.service'. mos-health is what runs `
              + `'rauc status mark-good', so without this the board turns blue while the booted slot `
              + `is still unconfirmed`,
          { instance: 'reports ready before the slot is confirmed' },
        ),
        verdict(
          'status-led-ordering',
          requires,
          requires
            ? 'catches an indicator that turns blue on a slot whose health gate failed: '
              + 'mos-status-led.service requires mos-health.service'
            : `catches an indicator that turns blue on a slot whose health gate failed: `
              + `mos-status-led.service has no 'Requires=mos-health.service'. Ordering alone still `
              + `starts the unit after a FAILED gate, so the board would read ready while U-Boot's `
              + `BOOT_x_LEFT counter is about to roll it back`,
          { instance: 'turns blue on a slot whose health gate failed' },
        ),
      ]
    },
  },

  boardRegularFileForFeature('led-script', boardsWhere(hasLed), LED_SCRIPT),

  {
    id: 'led-script-executable',
    boards: boardsWhere(hasLed),
    shell: {
      pass: '/usr/lib/mos/mos-status-led is executable (mode 0',
      fail: '/usr/lib/mos/mos-status-led is mode ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const st = entry(root, LED_SCRIPT)
      const mode = st === undefined ? 'none' : (st.mode & 0o7777).toString(8)
      // `[ -x ] && [ ! -L ]`: executable by SOMEBODY, and not a link. lstat's
      // mode carries all three x bits, which is what -x tests for root.
      const ok = st !== undefined && !st.isSymbolicLink() && (st.mode & 0o111) !== 0
      return [verdict(
        'led-script-executable',
        ok,
        ok
          ? `${LED_SCRIPT} is executable (mode 0${mode})`
          : `${LED_SCRIPT} is mode ${mode}, not executable; ExecStart= would fail with 203/EXEC and `
            + `the board would stay on the kernel's boot red for the whole session`,
      )]
    },
  },

  boardRegularFileForFeature('led-unit', boardsWhere(hasLed), LED_UNIT),

  {
    id: 'led-unit-enabled',
    boards: boardsWhere(hasLed),
    shell: {
      pass: 'mos-status-led.service is enabled (',
      fail: 'mos-status-led.service enablement symlink missing',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const link = wantsLink(await packedRoot(ctx), ETC_UNITS, 'mos-status-led.service')
      return [verdict(
        'led-unit-enabled',
        link !== undefined,
        link !== undefined
          ? `mos-status-led.service is enabled (${link})`
          : 'mos-status-led.service enablement symlink missing (no *.wants entry under /etc/systemd/system)',
      )]
    },
  },

  packedGrep({
    id: 'led-unit-execstart',
    boards: boardsWhere(hasLed),
    path: LED_UNIT,
    pattern: /^ExecStart=\/usr\/lib\/mos\/mos-status-led start$/,
    what: 'mos-status-led.service runs /usr/lib/mos/mos-status-led start',
  }),

  packedGrep({
    id: 'led-unit-execstop',
    boards: boardsWhere(hasLed),
    path: LED_UNIT,
    pattern: /^ExecStop=\/usr\/lib\/mos\/mos-status-led stop$/,
    what: 'mos-status-led.service restores red on stop (ExecStop=)',
  }),

  packedGrep({
    id: 'led-unit-remain-after-exit',
    boards: boardsWhere(hasLed),
    path: LED_UNIT,
    pattern: /^RemainAfterExit=yes$/,
    what: 'mos-status-led.service sets RemainAfterExit=yes, so ExecStop runs at shutdown and not '
      + 'straight after ExecStart',
  }),

  packedGrep({
    id: 'led-unit-after-multi-user',
    boards: boardsWhere(hasLed),
    path: LED_UNIT,
    pattern: /^After=multi-user\.target$/,
    what: 'mos-status-led.service is ordered After=multi-user.target, so nothing in boot blocks on '
      + 'the indicator',
  }),

  ledTransitionCheck('start', 'led_on.*BLUE', 'led_off.*RED',
    'blue is switched ON before red is switched off, so the boot->ready transition never goes dark'),
  ledTransitionCheck('stop', 'led_on.*RED', 'led_off.*BLUE',
    'red is switched ON before blue is switched off, so the ready->shutdown transition never goes dark'),

  skipOwner(
    'led-overlay-skipped',
    boardsWhere(b => !hasLed(b)),
    'the status-indicator unit and script assertions (',
    board => `the status-indicator unit and script assertions (${board.name} declares `
      + `BOARD_HAS_STATUS_LED=0): the files live in the board overlay and this board has none; `
      + `check_status_led asserts they are absent rather than assuming it`,
  ),
]

/**
 * The no-dark ordering, asserted in the shipped script and per branch.
 *
 * Turning the destination colour on before extinguishing the source is the
 * whole reason the transition is safe: with the two writes swapped there is an
 * instant where both LEDs are off and the board reads as dead. Nothing else can
 * catch that -- either order is valid shell and passes every syntax check.
 *
 * Region-scoped by line, exactly as the oracle's awk is: the
 * branch label opens the region and the next bare `;;` closes it, so a write in
 * the other branch cannot satisfy this one.
 */
function ledTransitionCheck(branch: string, first: string, second: string, what: string): CheckCase {
  const id = `led-no-dark-${branch}`
  const message = `mos-status-led ${branch}: ${what}`
  const a = new RegExp(first)
  const z = new RegExp(second)
  return {
    id,
    boards: boardsWhere(hasLed),
    shell: { pass: message },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const st = entry(root, LED_SCRIPT)
      let ok = false
      if (st !== undefined) {
        const lines = readFileSync(join(root, LED_SCRIPT), 'utf8').split('\n')
        let inBranch = false
        let na = 0
        let nz = 0
        for (const [index, line] of lines.entries()) {
          if (line === `${branch})`) { inBranch = true; continue }
          if (inBranch && /^[ \t]*;;[ \t]*$/.test(line)) { inBranch = false; continue }
          if (!inBranch) continue
          if (na === 0 && a.test(line)) na = index + 1
          if (nz === 0 && z.test(line)) nz = index + 1
        }
        ok = na > 0 && nz > 0 && na < nz
      }
      return [verdict(
        id,
        ok,
        ok
          ? message
          : `${message} — ${LED_SCRIPT} is missing, or its ${branch}) branch does not write `
            + `/${first}/ before /${second}/`,
      )]
    },
  }
}

/** `find /usr/lib/systemd/system /etc/systemd/system /usr/lib/mos -name 'mos-status-led*'`. */
function ledFilesLeft(root: string): string[] {
  const out: string[] = []
  for (const dir of ['/usr/lib/systemd/system', '/etc/systemd/system', '/usr/lib/mos']) {
    for (const name of listDir(root, dir)) {
      if (name.startsWith('mos-status-led')) out.push(`${dir}/${name}`)
    }
  }
  return out
}

// shared readers

/**
 * A directory listing, or nothing.
 *
 * An absent directory is an EMPTY listing here and not an error: every caller
 * below is asking "what does the image ship at this path", and on a board that
 * ships nothing there the honest answer is none. The checks that must not
 * accept an empty answer say so themselves -- `hwinit-units-present` fails on
 * zero units, and `packedRoot` refuses an empty tree before any of this runs.
 */
function listDir(root: string, dir: string): string[] {
  try {
    return readdirSync(join(root, dir))
  }
  catch {
    return []
  }
}

/** `ls /etc/mos/*.conf`, as basenames without the suffix -- the oracle's `c`. */
function etcMosConfs(root: string): string[] {
  return listDir(root, '/etc/mos')
    .filter(n => n.endsWith('.conf') && entry(root, `/etc/mos/${n}`)?.isFile() === true)
    .map(n => n.slice(0, -'.conf'.length))
    .sort()
}

/** `ls /usr/lib/systemd/system/mos-*.service`. */
function mosUnits(root: string): string[] {
  return listDir(root, '/usr/lib/systemd/system')
    .filter(n => n.startsWith('mos-') && n.endsWith('.service'))
    .sort()
}

/** `sq_regular` for a fixed path a FEATURE selects, rather than the board. */
function boardRegularFileForFeature(id: string, boards: readonly string[], path: string): CheckCase {
  return {
    id,
    boards,
    shell: { pass: `${path} is a regular file`, fail: `${path} missing or not a regular file` },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), path)
      const ok = st !== undefined && st.isFile()
      return [verdict(id, ok, ok ? `${path} is a regular file` : `${path} missing or not a regular file`)]
    },
  }
}

/** Optional radio checks use the packed inventory, never a missing file as a decline. */
function forS905Package(check: CheckCase, pkg: string): CheckCase {
  const message = `${check.id}: ${pkg} was not selected for s905x5m`
  const prior = check.shell.skip
  const skip = prior === undefined ? [message] : typeof prior === 'string' ? [prior, message] : [...prior, message]
  return {
    ...check,
    shell: { ...check.shell, skip },
    run: async ctx => {
      if (ctx.board.name === 's905x5m' && !installedPackages(await packedRoot(ctx)).has(pkg)) {
        return [skipped(check.id, message)]
      }
      return check.run(ctx)
    },
  }
}

export const BOARD_CHECKS: readonly CheckCase[] = [
  ...LOADER_CHECKS,
  ...SHIPPED.flatMap(bootSlotFileChecks),
  ...SLOT_LISTING_CHECKS,
  ...SHIPPED.flatMap(radioFirmwareChecks),
  ...RADIO_CHECKS,
  ...SHIPPED.flatMap(hwinitConfChecks),
  ...HWINIT_CHECKS,
  ...BLUETOOTH_CHECKS.map(c => forS905Package(c, 'mos-s905x5m-bluetooth')),
  ...LED_CHECKS,
]
