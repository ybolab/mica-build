// Batch 4b: the kernel command line, dm-verity, and the ESP's GRUB boot chain.
//
// Every assertion here is true of both boards -- the verity table exists and is
// read-only, dm-mod.waitfor is present, the root hash matches the locally built
// rootfs, the payload verifies, and the boot path names its slot -- and only the
// source differs. Skipping these checks on a grub board
// would drop real coverage of verity, of the read-only flag and of rauc.slot= on
// the board this project verifies first. So the extraction is board-aware and
// the assertions are not.
//
// On U-Boot the command line is the per-slot verity env file out of the slot's
// own FAT, which boot.scr sources: one file, one line. On GRUB it is composed
// the way the bootloader composes it -- the ESP's grub.cfg holds
// the board constants, each slot's PARTUUID and the fixed arguments, and the
// slot's own boot partition holds the values that change with the build in a
// `set MOS_*=` fragment. Composing it rather than asserting the halves
// separately is the point, because everything downstream verifies the root hash
// the kernel will be given against the payload actually in that slot: a check
// reading the fragment alone would pass on a grub.cfg that never referenced it,
// and one reading grub.cfg alone would pass on a slot whose cmdline.cfg was
// never installed. Anything the fragment does not define is left unexpanded, so
// a missing fact shows up as a literal `${MOS_ROOT_HASH}` rather than a silently
// empty field, which makes the verity table unparseable rather than wrong.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import { boardsWhere, isUBoot } from './board-scope.ts'
import { SLOTS, slotOffsetBytes, type BootSlot } from './boot-slots.ts'
import { verityEnvText } from './checks-bootchain.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { imageLayout } from './image-layout.ts'
import { fatCopyOut, fatList, readBytes, verityVerify, type FatSlot } from './image.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { eqCi, skipped, verdict } from './verdict.ts'

const NOT_UBOOT = boardsWhere(b => !isUBoot(b))

/** Where a grub board keeps the configuration the firmware reads. */
const GRUB_CFG = 'EFI/mos/grub.cfg'

function espSlot(ctx: ImageContext): FatSlot {
  return { image: ctx.image, offsetBytes: slotOffsetBytes(ctx.board, 'ESP') }
}

function bootSlot(ctx: ImageContext, slot: BootSlot): FatSlot {
  return { image: ctx.image, offsetBytes: slotOffsetBytes(ctx.board, slot.layout) }
}

/** One file out of a FAT, as text, or undefined when it is not there. */
async function fatText(
  ctx: ImageContext,
  fat: FatSlot,
  path: string,
  name: string,
): Promise<string | undefined> {
  const dest = join(ctx.workDir, name)
  if (!existsSync(dest) && !(await fatCopyOut(ctx.tools, fat, path, dest))) return undefined
  return Buffer.from(readBytes(dest, 0, statSync(dest).size)).toString('latin1')
}

/**
 * `board_cmdline SLOT` -- the effective kernel command line for a slot.
 *
 * Empty string when there is none, which is the oracle's `|| true` and its
 * `[ -n "${line}" ] || return 0`. Everything downstream tests for it.
 */
export async function boardCmdline(ctx: ImageContext, slot: BootSlot): Promise<string> {
  if (isUBoot(ctx.board)) return verityEnvText(ctx, slot)

  const fragName = ctx.board.get('SLOT_CMDLINE_NAME')
  if (fragName === undefined || fragName.trim() === '') {
    throw new ToolOutputError(
      `${ctx.board.path} declares no SLOT_CMDLINE_NAME, so this harness cannot find the per-slot `
      + `fragment GRUB sources. Treated as absent it would leave every ${'${MOS_*}'} unexpanded and `
      + `report the result as a defect in the image.`,
    )
  }
  const frag = await fatText(ctx, bootSlot(ctx, slot), fragName.trim(),
    `slot-cmdline-${slot.letter}.cfg`) ?? ''
  const cfg = await fatText(ctx, espSlot(ctx), GRUB_CFG, `esp-grub-for-${slot.letter}.cfg`) ?? ''
  // `grep -E "^[[:space:]]*linux .*slot_${slot_lc}_root" | first_line`
  const line = cfg.split('\n')
    .find(l => new RegExp(`^[ \t]*linux .*slot_${slot.letter}_root`).test(l))
  if (line === undefined) return ''
  // `set NAME=value` from the fragment, substituted into `${NAME}`.
  let out = line
  for (const m of frag.matchAll(/^set (MOS_[A-Z_]+)=(.*)$/gm)) {
    out = out.split(`\${${m[1] as string}}`).join(m[2] as string)
  }
  return out
}

/** The dm-verity table `dm-mod.create="..."` carries, or '' when there is none. */
function verityTable(cmdline: string): string {
  return /dm-mod\.create="([^"]*)"/.exec(cmdline)?.[1] ?? ''
}

interface VerityFields {
  readonly table: string
  readonly rootHash: string
  readonly salt: string
  readonly hashOffset: number
  readonly hashAlgo: string
  readonly dataBlockSize: number
  readonly hashBlockSize: number
  readonly dataBlocks: number
}

/**
 * `VERITY_SIGNATURE` out of cryptsetup's lib/verity/verity.c -- the eight bytes
 * a verity superblock starts with.
 *
 * There is no superblock in a `dm-mod.create=` table, so finding this AT
 * hash_start_block is finding metadata where the kernel expects the tree's top
 * level. See `verity-hash-start-no-superblock` below.
 */
const VERITY_SUPERBLOCK_MAGIC = 'verity\0\0'

/**
 * The fields the oracle awks out of the table.
 *
 *   rootfs,,,ro,0 <sectors> verity 1 <data> <hash> <dbs> <hbs> <blocks> <hash_start> <algo> <root> <salt>
 *
 * `$(NF-1)` and `$NF` for the hash and the salt -- positions from the end, so a
 * table with an extra trailing field silently yields the wrong two. Reproduced;
 * a reader that indexed from the front would disagree with the oracle on
 * exactly the malformed tables this is about.
 */
function verityFields(cmdline: string): VerityFields {
  const table = verityTable(cmdline)
  const none = {
    table, rootHash: '', salt: '', hashOffset: 0,
    hashAlgo: '', dataBlockSize: 0, hashBlockSize: 0, dataBlocks: 0,
  }
  if (table === '') return none
  const f = table.trim().split(/\s+/)
  // Indexed from the FRONT for the five the target itself takes -- data block
  // size, hash block size, data-block count, hash_start_block, algorithm -- and
  // from the back for the hash and the salt, which is the split the oracle made.
  const num = (at: number): number => (/^\d+$/.test(f[at] ?? '') ? Number(f[at]) : 0)
  const dataBlockSize = num(6)
  const hashBlockSize = num(7)
  const dataBlocks = num(8)
  const hashStartBlock = num(9)
  return {
    table,
    rootHash: f[f.length - 2] ?? '',
    salt: f[f.length - 1] ?? '',
    // 0 is the sentinel every caller tests for: `num` maps an unparseable field
    // to it, and hash_start_block is never legitimately 0 -- the tree follows
    // the data it covers.
    hashOffset: hashStartBlock * hashBlockSize,
    hashAlgo: f[10] ?? '',
    dataBlockSize,
    hashBlockSize,
    dataBlocks,
  }
}

/** BOOT-A's effective command line and the verity fields in it, once per run. */
async function slotAFields(ctx: ImageContext): Promise<VerityFields & { cmdline: string }> {
  const cmdline = await boardCmdline(ctx, SLOTS[0] as BootSlot)
  return { cmdline, ...verityFields(cmdline) }
}

/** `${TMP}/rootfs-a.img` -- the slot payload, extracted at the LAYOUT's offset. */
async function rootfsA(ctx: ImageContext): Promise<{ file: string, slotMib: number }> {
  const layout = await imageLayout(ctx)
  if (layout.slotMib <= 0) {
    // `: >"${ROOTFS_A_IMG}"` -- an EMPTY file, not a refusal, because the check
    // below then fails describing the verification rather than the extract.
    return { file: await ctx.extractAt('rootfs-a.img', 0, 0), slotMib: 0 }
  }
  return {
    file: await ctx.extractAt(
      'rootfs-a.img',
      layout.startMib('ROOTFS_A') * layout.mibBytes,
      layout.slotMib * layout.mibBytes,
    ),
    slotMib: layout.slotMib,
  }
}

function envFileGet(text: string, name: string): string {
  // `sed -n "s/^KEY=//p" | tail -n1` -- the LAST occurrence, not the first.
  const hits = [...text.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))].map(m => m[1] ?? '')
  return hits[hits.length - 1] ?? ''
}

export const CMDLINE_CHECKS: readonly CheckCase[] = [
  {
    // The end-to-end assertion: the root hash the device will be given, against
    // the bytes actually in the slot. `veritysetup verify` walks the hash tree
    // in userspace -- no device-mapper target, no losetup, no mount.
    id: 'verity-payload-verifies',
    shell: {
      pass: `ROOTFS-A payload verifies against the root hash in BOOT-A's cmdline`,
      fail: [
        'ROOTFS-A payload FAILED dm-verity verification',
        'could not read a dm-mod.create= verity table out of BOOT-A',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'verity-payload-verifies'
      const t = await slotAFields(ctx)
      // Every field the walk needs comes from the TABLE, and a table missing any
      // one of them is unreadable rather than half-read: with --no-superblock
      // there is nothing on the media to fall back to, so a defaulted field
      // would silently describe a different tree.
      if (t.rootHash === '' || t.hashOffset === 0 || t.hashAlgo === '' || t.salt === ''
        || t.dataBlockSize === 0 || t.hashBlockSize === 0 || t.dataBlocks === 0) {
        return [verdict(id, false,
          `could not read a dm-mod.create= verity table out of BOOT-A, so the ROOTFS-A payload `
          + `cannot be verified`)]
      }
      const { file } = await rootfsA(ctx)
      const answer = await verityVerify(ctx.tools, {
        dataFile: file,
        hashFile: file,
        rootHash: t.rootHash,
        hashOffset: t.hashOffset,
        hashAlgo: t.hashAlgo,
        dataBlockSize: t.dataBlockSize,
        hashBlockSize: t.hashBlockSize,
        dataBlocks: t.dataBlocks,
        salt: t.salt,
      })
      return [verdict(id, answer === 'verified',
        answer === 'verified'
          ? `ROOTFS-A payload verifies against the root hash in BOOT-A's cmdline (${t.rootHash})`
          : `ROOTFS-A payload FAILED dm-verity verification against BOOT-A's root hash ${t.rootHash}`)]
    },
  },

  {
    // The guard the family above did not have, and the reason no mos image ever
    // booted: `veritysetup format` without --no-superblock writes a verity
    // SUPERBLOCK at --hash-offset and starts the tree one hash block later,
    // while `dm-mod.create=`'s verity v1 target has no superblock concept and
    // reads the block at hash_start_block as the tree's top level. Every boot
    // then died on "device-mapper: verity: metadata block <n> is corrupted".
    //
    // `verity-payload-verifies` could not see it: veritysetup wrote the
    // superblock and veritysetup read it back, so the gate and the artifact
    // agreed with each other and both disagreed with the kernel. This check
    // asks the one question neither of them asked -- what is AT the offset the
    // cmdline names -- and it is deliberately a byte comparison rather than a
    // second call to the tool that has the convention.
    id: 'verity-hash-start-no-superblock',
    shell: {
      pass: 'hash_start_block points at hash tree',
      fail: [
        'hash_start_block points at a verity SUPERBLOCK',
        'could not read a dm-mod.create= verity table out of BOOT-A',
        'ends before the hash_start_block',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'verity-hash-start-no-superblock'
      const { hashOffset } = await slotAFields(ctx)
      if (hashOffset === 0) {
        return [verdict(id, false,
          `could not read a dm-mod.create= verity table out of BOOT-A, so there is no `
          + `hash_start_block to look at`)]
      }
      const { file } = await rootfsA(ctx)
      const need = VERITY_SUPERBLOCK_MAGIC.length
      if (statSync(file).size < hashOffset + need) {
        return [verdict(id, false,
          `the ROOTFS-A payload ends before the hash_start_block byte ${hashOffset} the cmdline `
          + `names, so the kernel would read the hash tree off the end of the slot`)]
      }
      const head = Buffer.from(readBytes(file, hashOffset, need))
      const ok = head.toString('latin1') !== VERITY_SUPERBLOCK_MAGIC
      return [verdict(id, ok,
        ok
          ? `hash_start_block points at hash tree, not at metadata about it: byte ${hashOffset} `
            + `starts ${head.toString('hex')}, not the verity superblock magic `
            + `${Buffer.from(VERITY_SUPERBLOCK_MAGIC, 'latin1').toString('hex')}`
          : `hash_start_block points at a verity SUPERBLOCK: byte ${hashOffset} starts `
            + `${head.toString('hex')} ('verity\\0\\0'). dm-init's verity v1 target has no `
            + `superblock concept -- it reads this block as the tree's top level -- so the kernel `
            + `would refuse the root with "device-mapper: verity: metadata block ... is corrupted" `
            + `and the device would not boot. Format with veritysetup --no-superblock`)]
    },
  },

  {
    // Factory only: after an update ROOTFS-A may hold a different release than
    // the rootfs-verity.env sitting in the local _out/ tree.
    id: 'verity-hash-vs-built',
    shell: {
      pass: `root hash in BOOT-A's cmdline vs the locally built rootfs-verity.env is`,
      fail: [
        `root hash in BOOT-A's cmdline vs the locally built rootfs-verity.env is`,
        'verity parameter file not found:',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'verity-hash-vs-built'
      const path = join(ctx.outDir, 'rootfs-verity.env')
      if (!existsSync(path)) {
        return [verdict(id, false,
          `verity parameter file not found: ${path} (produce it with rootfs/build.sh)`)]
      }
      const { rootHash } = await slotAFields(ctx)
      return [eqCi(id,
        `factory: root hash in BOOT-A's cmdline vs the locally built rootfs-verity.env`,
        rootHash,
        envFileGet(readFileSync(path, 'utf8'), 'VERITY_ROOT_HASH'))]
    },
  },

  {
    id: 'verity-salt-on-cmdline',
    shell: { pass: 'verity salt on the cmdline is' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const want = ctx.board.get('VERITY_SALT')
      if (want === undefined || want.trim() === '') {
        throw new ToolOutputError(
          `${ctx.board.path} declares no VERITY_SALT. A fail here would be a statement about the `
          + `image, and a missing key is one about the board definition.`,
        )
      }
      const { salt } = await slotAFields(ctx)
      return [eqCi('verity-salt-on-cmdline', 'verity salt on the cmdline', salt, want.trim())]
    },
  },

  {
    // dm_init_init() runs at late_initcall and its wait_for_device_probe() does
    // not cover eMMC card discovery, so without this the verity table is
    // assembled before the partitions exist -- and the boot then fails
    // INTERMITTENTLY rather than cleanly.
    id: 'cmdline-waitfor',
    shell: { pass: 'the kernel cmdline carries ' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { cmdline } = await slotAFields(ctx)
      const waitfor = /(dm-mod\.waitfor=[^ ]*)/.exec(cmdline)?.[1] ?? ''
      return [verdict('cmdline-waitfor', waitfor !== '',
        waitfor !== ''
          ? `the kernel cmdline carries ${waitfor} (required on the BSP kernel this board ships: `
            + `dm-init runs at late_initcall and does not wait for eMMC discovery)`
          : `the kernel cmdline carries NO dm-mod.waitfor=. It is REQUIRED, not optional: `
            + `dm_init_init() runs at late_initcall and wait_for_device_probe() does not cover eMMC `
            + `card discovery, so verity assembly races the eMMC probe and boot becomes flaky `
            + `rather than broken`)]
    },
  },

  {
    id: 'rootfs-a-squashfs-magic',
    shell: { pass: `the squashfs magic 'hsqs'` },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { file } = await rootfsA(ctx)
      // `dd bs=1 count=4 | tr -d '\0'` -- NULs are stripped, so a payload of
      // zeros reads as '' rather than as four NUL bytes.
      const magic = statSync(file).size >= 4
        ? Buffer.from(readBytes(file, 0, 4)).toString('latin1').replace(/\0/g, '')
        : ''
      const ok = magic === 'hsqs'
      return [verdict('rootfs-a-squashfs-magic', ok,
        ok
          ? `ROOTFS-A starts with the squashfs magic 'hsqs'`
          : `ROOTFS-A does not start with the squashfs magic 'hsqs' (got '${magic}')`)]
    },
  },

  {
    id: 'rootfs-a-compressor',
    shell: { pass: 'ROOTFS-A squashfs compressor id is' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { file } = await rootfsA(ctx)
      // `od -An -tu2 -j20 -N2` -- an UNSIGNED 2-byte decimal at offset 20, in
      // the host's byte order, which on both build hosts and both targets is
      // little-endian. The squashfs superblock's compression id.
      const id = statSync(file).size >= 22
        ? String(Buffer.from(readBytes(file, 20, 2)).readUInt16LE(0))
        : ''
      const ok = id === '6'
      return [verdict('rootfs-a-compressor', ok,
        ok
          ? `ROOTFS-A squashfs compressor id is 6 (zstd)`
          : `ROOTFS-A squashfs compressor id is '${id}', expected 6 (zstd)`)]
    },
  },

  {
    // An ext4 superblock here would mean a WRITABLE root got packed into the
    // slot -- which boots, and then accepts writes that no update preserves.
    id: 'rootfs-a-no-ext4',
    shell: {
      pass: 'ROOTFS-A carries no ext4 superblock',
      fail: 'ROOTFS-A carries an ext4 superblock',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { file } = await rootfsA(ctx)
      // `od -An -tx2 -j$((1024 + 56)) -N2` -- the ext4 magic's own offset, and
      // `-tx2` is a 2-byte hex word in host order, so 0xEF53 prints as `ef53`.
      const magic = statSync(file).size >= 1024 + 58
        ? Buffer.from(readBytes(file, 1024 + 56, 2)).readUInt16LE(0).toString(16).padStart(4, '0')
        : ''
      const ok = magic !== 'ef53'
      return [verdict('rootfs-a-no-ext4', ok,
        ok
          ? `ROOTFS-A carries no ext4 superblock (magic at 1024+56 is 0x${magic || '????'}, not 0xef53)`
          : `ROOTFS-A carries an ext4 superblock; the mos root must be a read-only squashfs, not a `
            + `writable filesystem`)]
    },
  },

  {
    // Read-only by design, asserted in two independent places: the dm table's
    // own flag here, and the root arguments boot.scr builds around it (which is
    // `boot-scr-root-args` in checks-bootchain.ts).
    id: 'verity-table-read-only',
    shell: {
      pass: 'the dm-verity table is created read-only',
      fail: 'the dm-verity table is not marked read-only',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { table } = await slotAFields(ctx)
      const ok = table !== '' && /^rootfs,,,ro,/m.test(table)
      return [verdict('verity-table-read-only', ok,
        ok
          ? `the dm-verity table is created read-only (rootfs,,,ro,...), so the root cannot be `
            + `written by design`
          : `the dm-verity table is not marked read-only; expected a table beginning 'rootfs,,,ro,' `
            + `(got '${table}')`)]
    },
  },

  {
    // rauc 1.8 get_cmdline_bootname() takes the FIRST of `rauc.external`,
    // `rauc.slot=<x>`, barebox bootstate, then `root=<x>`. A mos image boots
    // `root=/dev/dm-0`, which is not a bootname, not a slot name and not the
    // realpath of any slot device -- so the root= fallback CANNOT work and
    // `rauc.slot=` is required. This is a property of the boot path, not of RAUC.
    id: 'rauc-slot-on-boot-path',
    cardinality: 'many',
    instance: /^slot ([AB]):/,
    shell: {
      pass: [
        ': the boot path sets rauc.slot=',
        `: root= names the slot's own PARTUUID`,
      ],
      fail: ': the boot path sets neither rauc.slot= nor a root= naming the slot device',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const out: CheckResult[] = []
      for (const slot of SLOTS) {
        // U-Boot assembles the line from boot.scr's own rootargs PLUS the
        // per-slot verity env, so EITHER may legitimately carry rauc.slot=;
        // the oracle concatenates the two rather than composing.
        const source = isUBoot(ctx.board)
          ? `${await bootScriptText(ctx)}\n${await verityEnvText(ctx, slot)}`
          : await boardCmdline(ctx, slot)
        const stripped = source.replace(/\0/g, '')
        const guid = ctx.board.partition(`ROOTFS_${slot.upper}`)?.guid ?? ''
        const rootArg = /root=[^ "]*/.exec(stripped)?.[0] ?? ''
        if (new RegExp(`rauc\\.slot=(\\$\\{bootslot\\}|${slot.upper})`).test(stripped)) {
          out.push(verdict('rauc-slot-on-boot-path', true,
            `slot ${slot.upper}: the boot path sets rauc.slot=, so rauc can identify the booted slot`,
            { instance: slot.upper }))
        }
        else if (rootArg.toLowerCase() === `root=partuuid=${guid.toLowerCase()}`) {
          out.push(verdict('rauc-slot-on-boot-path', true,
            `slot ${slot.upper}: root= names the slot's own PARTUUID, so rauc's root= fallback `
            + `identifies the booted slot`,
            { instance: slot.upper }))
        }
        else {
          out.push(verdict('rauc-slot-on-boot-path', false,
            `slot ${slot.upper}: the boot path sets neither rauc.slot= nor a root= naming the slot `
            + `device (found '${rootArg || 'none'}'). rauc 1.8 derives the booted slot from `
            + `rauc.slot= or root= and matches it against bootname / slot name / realpath(device), `
            + `so \`rauc status\` fails with "Did not find booted slot"`,
            { instance: slot.upper }))
        }
      }
      return out
    },
  },
]

/** `${TMP}/scr-A` as text, for the U-Boot half of the rauc.slot= source. */
async function bootScriptText(ctx: ImageContext): Promise<string> {
  const name = ctx.board.get('BOOT_SCRIPT_NAME')
  if (name === undefined || name.trim() === '') return ''
  const dest = join(ctx.workDir, `boot-a-${name.trim()}`)
  const fat = bootSlot(ctx, SLOTS[0] as BootSlot)
  if (!existsSync(dest) && !(await fatCopyOut(ctx.tools, fat, name.trim(), dest))) return ''
  return Buffer.from(readBytes(dest, 0, statSync(dest).size)).toString('latin1')
}

// the ESP: static, in no slot group, and holding NOTHING per-slot

const ESP_CHECKS: readonly CheckCase[] = [
  {
    // Owns the U-Boot board's SKIP for all three ESP assertions, so it applies
    // to every board; the other two are the grub boards' alone.
    id: 'esp-boot-chain',
    shell: {
      pass: 'the ESP carries the whole static boot chain (',
      fail: ['the ESP is missing:', ' is unreadable; the firmware would find no EFI binary'],
      skip: 'the ESP assertions (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'esp-boot-chain'
      if (isUBoot(ctx.board)) {
        return [skipped(id,
          `the ESP assertions (bootloader=${ctx.board.bootloader}): U-Boot is firmware, so this `
          + `board has no EFI system partition and its boot pair is the whole boot chain`)]
      }
      const listing = await espListing(ctx)
      if (listing.length === 0) {
        const mib = Math.floor(slotOffsetBytes(ctx.board, 'ESP') / (ctx.board.mibBytes ?? 1048576))
        return [verdict(id, false,
          `the ESP at ${mib} MiB is unreadable; the firmware would find no EFI binary and the `
          + `machine would not boot at all`)]
      }
      const required = ctx.board.espRequiredFiles ?? []
      const missing = required.filter(f => !listing.includes(`::/${f}`))
      return [verdict(id, missing.length === 0,
        missing.length === 0
          ? `the ESP carries the whole static boot chain (${required.join(' ')} )`
          : `the ESP is missing:${missing.map(f => ` ${f}`).join('')}`)]
    },
  },

  {
    // The per-slot rule, from the other side. A per-slot file on
    // the ESP is one that no install can replace: the ESP is in no slot group,
    // so it would be frozen at whatever was flashed while the rootfs it
    // describes moved on.
    id: 'esp-no-per-slot-file',
    boards: NOT_UBOOT,
    shell: {
      pass: 'the ESP carries no per-slot file (',
      fail: 'the ESP carries per-slot file(s):',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'esp-no-per-slot-file'
      // BOOT_SLOT_REQUIRED_FILES and not a list of SLOT_*_NAME keys spelled
      // here. The board's own statement of what a slot carries is the same
      // fact, and a key list in this file was a second copy of it: it named
      // SLOT_INITRD_NAME, and when the board stopped declaring one -- x64's
      // kernel gained CONFIG_DM_INIT and the slot payload lost its initrd --
      // this check threw on a correct image rather than following the board.
      const names = ctx.board.bootSlotRequiredFiles ?? []
      if (names.length === 0 || names.some(n => n.trim() === '')) {
        throw new ToolOutputError(
          `${ctx.board.path} declares no usable BOOT_SLOT_REQUIRED_FILES, so this check does not `
          + `know which names are per-slot and would pass by looking for none.`,
        )
      }
      const listing = await espListing(ctx)
      const stray = names.filter(n => listing.includes(`::/${n}`))
      return [verdict(id, stray.length === 0,
        stray.length === 0
          ? `the ESP carries no per-slot file (no ${names.join(', ')}); everything an update `
            + `replaces lives on the slot's own boot partition`
          : `the ESP carries per-slot file(s):${stray.map(n => ` ${n}`).join('')}. The ESP is in no `
            + `RAUC slot group, so nothing would ever replace them -- the boot chain would keep `
            + `naming the rootfs that shipped with the image`)]
    },
  },

  {
    // grub.cfg on the ESP must not carry a root hash: it is the one file no
    // install rewrites, so a hash baked in here would survive an update and
    // the next boot would verify the new rootfs against the old root hash.
    id: 'esp-grub-cfg-no-hash',
    boards: NOT_UBOOT,
    shell: {
      pass: `the ESP's grub.cfg carries no literal hash`,
      fail: `the ESP's grub.cfg bakes a literal hash into a linux line`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'esp-grub-cfg-no-hash'
      const cfg = await fatText(ctx, espSlot(ctx), GRUB_CFG, 'esp-grub.cfg') ?? ''
      // `grep -E '^[[:space:]]*linux[[:space:]]' | grep -cE '[0-9a-f]{32,}'` --
      // only the `linux` lines, and only a run of 32+ lowercase hex digits.
      const baked = cfg.split('\n')
        .filter(l => /^[ \t]*linux[ \t]/.test(l))
        .some(l => /[0-9a-f]{32,}/.test(l))
      return [verdict(id, !baked,
        baked
          ? `the ESP's grub.cfg bakes a literal hash into a linux line. It changes with every build `
            + `and nothing installs this file, so the next update would boot the new rootfs against `
            + `the old root hash`
          : `the ESP's grub.cfg carries no literal hash; the dm-verity values come from the slot's `
            + `own cmdline.cfg, which RAUC installs`)]
    },
  },
]

/** `mdir -/ -b` over the ESP, once per run. An empty listing is an ANSWER. */
async function espListing(ctx: ImageContext): Promise<string[]> {
  return fatList(ctx.tools, espSlot(ctx))
}

// RAUC's slot devices versus the ESP

function raucConf(root: string): string {
  const path = join(root, 'etc/rauc/system.conf')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** `device=` inside `[slot.<name>]`, as the former verifier's awk reads it. */
function raucSlotDevice(conf: string, slot: string): string {
  let inSection = false
  for (const line of conf.split('\n')) {
    if (line === `[slot.${slot}]`) {
      inSection = true
      continue
    }
    if (line.startsWith('[')) inSection = false
    if (inSection && line.startsWith('device=')) return line.slice('device='.length)
  }
  return ''
}

const RAUC_ESP_CHECKS: readonly CheckCase[] = [
  {
    // The x64 image declared [slot.boot.0] and [slot.boot.1] on its two ESPs.
    // Every other check passed: the GUIDs were the layout's, the devices were
    // by-partuuid paths, the slots were parented correctly. What none of them
    // asked was whether the firmware could ever boot the one being installed
    // into -- UEFI picks an ESP and nothing on the device gets a say.
    id: 'rauc-no-slot-on-esp',
    shell: {
      pass: 'no RAUC slot points at the ESP;',
      fail: 'a RAUC slot points at the ESP (',
      skip: 'the ESP-versus-boot-slot assertion (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'rauc-no-slot-on-esp'
      if (isUBoot(ctx.board)) {
        return [skipped(id,
          `the ESP-versus-boot-slot assertion (bootloader=${ctx.board.bootloader}): U-Boot is `
          + `firmware and this board has no ESP, so there is no partition the boot slots could `
          + `wrongly be`)]
      }
      const espGuid = (ctx.board.partition('ESP')?.guid ?? '').toLowerCase()
      if (espGuid === '') throw new ToolOutputError(`${ctx.board.path} declares no ESP_GUID.`)
      const conf = raucConf(await ctx.unpackRoot())
      // `grep '^device=' | grep -qi "${esp_guid_lc}"` -- across ALL slots, not
      // just the boot pair, because any slot group pointing there is the fault.
      const devices = conf.split('\n').filter(l => l.startsWith('device='))
      const hit = devices.some(d => d.toLowerCase().includes(espGuid))
      return [verdict(id, !hit,
        hit
          ? `a RAUC slot points at the ESP (${espGuid}). The ESP is what the FIRMWARE boots; putting `
            + `it in a slot group means an install rewrites the EFI binary and the grubenv that `
            + `records which slot is good`
          : `no RAUC slot points at the ESP; the partition the firmware boots is in no slot group, `
            + `so no install can rewrite the EFI binary or the grubenv beside it`)]
    },
  },

  {
    id: 'rauc-boot-slots-are-boot-partitions',
    boards: NOT_UBOOT,
    shell: {
      pass: 'the boot slots are the per-slot boot PARTITIONS (',
      fail: `the boot slots are not the layout's boot partitions:`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'rauc-boot-slots-are-boot-partitions'
      const conf = raucConf(await ctx.unpackRoot())
      const want = SLOTS.map(s => (ctx.board.partition(s.layout)?.guid ?? '').toLowerCase())
      if (want.some(g => g === '')) {
        throw new ToolOutputError(`${ctx.board.path} declares no BOOT_A_GUID/BOOT_B_GUID.`)
      }
      const got = ['boot.0', 'boot.1'].map(s => raucSlotDevice(conf, s))
      const ok = got.every((d, i) => d.toLowerCase() === `/dev/disk/by-partuuid/${want[i]}`)
      return [verdict(id, ok,
        ok
          ? `the boot slots are the per-slot boot PARTITIONS (${want.join(' / ')}), which the `
            + `first-stage GRUB selects from grubenv and can therefore actually read`
          : `the boot slots are not the layout's boot partitions: boot.0='${got[0]}', `
            + `boot.1='${got[1]}'`)]
    },
  },
]

export const CMDLINE_CHECKS_ALL: readonly CheckCase[] = [
  ...CMDLINE_CHECKS,
  ...ESP_CHECKS,
  ...RAUC_ESP_CHECKS,
]
