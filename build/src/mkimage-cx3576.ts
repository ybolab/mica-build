// Flashable cx3576 (Rockchip RK3576, eMMC /dev/mmcblk0) A/B GPT disk-image
// assembler: the A/B layout, eleven partitions.
//
// The raw Rockchip loader area, a redundant U-Boot env pair, two FAT32 boot
// slots, two raw squashfs+dm-verity rootfs slots and the meta/state/ephemeral/
// data ext4 partitions. Every layout constant comes from
// boards/cx3576/board.env, through verify's typed model and this
// package's geometry; nothing is duplicated here and nothing re-reads that file.
//
// Each boot slot holds Image, rk3576-src.dtb, the shared boot.scr compiled from
// boards/cx3576/boot.cmd, and a per-slot mos-verity.env. It holds NO
// extlinux/extlinux.conf: U-Boot tries extlinux before boot.scr in both boot
// frameworks, so an extlinux config here would silently bypass the RAUC A/B
// handshake (docs/design/uboot-ab-handshake.md sections 5.4-5.5).

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { checkBootCmd, verityEnvFor } from './boot-cx3576.ts'
import { loadGeometry, type Geometry } from './geometry.ts'
import { decideSlot, deriveLayout, gptSpecFor, loaderIdentityFaults, slotPinFromEnv, type DerivedLayout, type SlotDecision } from './layout-cx3576.ts'
import { BOARDS_DIR, makeWorkDir, REPO_ROOT } from './paths.ts'
import { pinSeededTimes } from './pin-seeded-times.ts'
import { Toolbox } from './toolbox.ts'

// The output filename carries the assembly-time epoch; the content does not
// vary. Fixed GPT GUIDs, fixed FAT volume ids, fixed ext4 fs UUIDs and hash
// seeds, E2FSPROGS_FAKE_TIME, all staged boot files touched to FILE_MTIME, and
// -- for the one filesystem seeded from a source tree, EPHEMERAL -- every
// in-use inode's atime and ctime rewritten afterwards, because `touch` reaches
// neither of them through mke2fs -d (src/pin-seeded-times.ts).
//
// Two assemblies from identical inputs must be byte-identical, so every
// decision that reaches the output bytes is fixed:
//
//   * every external tool runs in the same pinned alpine, out of the same apk
//     package list, because which mtools wrote the FAT decides its bytes;
//   * `cp -a` and `find ... -exec touch` run inside that container, where the
//     shell runs them. `cp -a` is `--preserve=all`, mke2fs -d copies xattrs
//     into the image, and this host runs SELinux while alpine does not, so
//     staging on the host would write security labels into EPHEMERAL that the
//     shell's image does not carry;
//   * mcopy is handed the staged files in the order a C-locale glob produces
//     them, because that is the order they land in the FAT directory;
//   * sizes go to sgdisk in sectors throughout, where the shell mixes `+NS` and
//     `+NM`. That one is a change of spelling and the only one: `+131072S` and
//     `+64M` at 512-byte sectors are measured byte-identical, and the suite
//     re-runs that comparison rather than trusting this sentence.
//
// And the one that is not cosmetic: `-a ${GPT_ALIGN_SECTORS}`. sgdisk silently
// relocates a start that is not a multiple of the alignment -- measured, exit 0
// -- and cx3576's loader starts at sector 64. An assembler that omitted or
// mis-set the alignment would produce an image that passes every structural
// check, boots on a bench, and comes up in maskrom on a board after
// systemd-repart trims the region no partition covers. So the loader is read
// back out of the finished table and its start and length asserted; asking
// sgdisk for a layout proves nothing about the layout.
import { CX3576_ASSEMBLY } from './toolsets.ts'
import { dd, truncate } from './tools/dd.ts'
import { mke2fs } from './tools/e2fsprogs.ts'
import { makeBootScript } from './tools/mkimage.ts'
import { mcopy, mkfsVfat } from './tools/mtools.ts'
import { readPartition, verifyGpt, writeGpt, type GptPartitionInfo } from './tools/sgdisk.ts'

/** The board this assembler is for. One board, like the script it replaces. */
export const BOARD = 'cx3576'

/**
 * The producer of the four rootfs-side inputs.
 *
 * Named in every error message about one of them, because "rootfs-verity.img not
 * found" is only actionable once you know what makes it.
 */
export const ROOTFS_PRODUCER = 'rootfs/build.sh'

export interface AssemblyInputs {
  readonly kernelImage: string
  readonly dtb: string
  readonly uboot: string
  /** Optional, and used ONLY by the pairing guard. Its absence disables nothing else. */
  readonly ubootDebug?: string
  readonly rootfsVerityImg: string
  readonly rootfsVerityEnv: string
  readonly bootCmdlineA: string
  readonly bootCmdlineB: string
  readonly factoryVar: string
  readonly imgOut: string
  /** Defaults to the tree's own boards/cx3576/boot.cmd. */
  readonly bootCmd?: string
}

export interface AssembleOptions {
  /** An already-open toolbox. One is opened and closed here otherwise. */
  readonly toolbox?: Toolbox
  /**
   * The rootfs slot pin, as supplied from the environment -- undefined meaning
   * not supplied at all, which is what selects the floor mode.
   *
   * Read from process.env by the CLI. A parameter here so both modes are
   * reachable from a test without mutating the environment of a running suite.
   */
  readonly slotPin?: string | undefined
  readonly geometry?: Geometry
  readonly log?: (line: string) => void
}

export interface AssembleResult {
  readonly image: string
  readonly slot: SlotDecision
  readonly layout: DerivedLayout
  readonly rootHash: string
  readonly loaderStartSector: bigint
  readonly loaderSizeSectors: bigint
  readonly ubootBytes: bigint
}

/** Reads one KEY=value out of a plain env-style file without executing it. */
export function envFileGet(path: string, key: string): string {
  const lines = readFileSync(path, 'utf8').split('\n')
  let last = ''
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) last = line.slice(key.length + 1)
  }
  return last
}

/**
 * The refusal for a missing uboot-mos blob, stated once because the wrapper and
 * the assembly both need to say it.
 *
 * The v1 blob is not a substitute and the sentence says why at length: it is the
 * debug variant -- CONFIG_ENV_IS_NOWHERE, no persistent environment at all, and
 * no pinned bootmeth order -- so a mos image built with it would boot, look
 * healthy, and silently never run the RAUC A/B handshake.
 */
export function ubootMissingError(path: string, debugVariantDir: string): Error {
  return new Error(
    `${path} not found; build it with 'make -C boards/${BOARD}/bsp uboot-mos'.\n`
    + `Since PLAN-086 S2 that blob reaches the assembler through the mos-board-${BOARD} package `
    + `and the boot export the rootfs build takes out of the packed root, so a BSP build has to be `
    + `followed by 'make os-deb-board-${BOARD}' and 'MOS_BOARD=${BOARD} bash ${ROOTFS_PRODUCER}'.\n`
    + `The v1 blob under out/${debugVariantDir}/ is NOT a substitute. It is the debug variant: `
    + `CONFIG_ENV_IS_NOWHERE (no persistent environment at all) and no pinned bootmeth order, so a v2 `
    + `image built with it would boot, look healthy, and silently never run the RAUC A/B handshake -- `
    + `no BOOT_ORDER, no attempt counters, no rollback.`,
  )
}

function requireFile(path: string, what: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${path} not found; ${what}`)
}

/**
 * A few bytes read out of a file at an offset, as lowercase hex.
 *
 * This is `dd if=... bs=... skip=... count=1 | od -An -tx1 -N4 | tr -d ' \n'` in
 * the shell, and it is deliberately NOT a tool call here. src/tools/dd.ts says
 * why: the image is a file on the host, so there is no reason to spend a
 * container on reading four bytes of it -- and routing binary through `docker
 * exec` means routing it through a text stream, which is a corruption waiting
 * for the first byte that is not valid UTF-8. It reads exactly `bytes`, not the
 * file: the image this is asked about is 1.3 GiB.
 */
export function magicHexAt(path: string, offsetBytes: bigint, bytes = 4): string {
  const buf = Buffer.alloc(bytes)
  const fd = openSync(path, 'r')
  try {
    const n = readSync(fd, buf, 0, bytes, Number(offsetBytes))
    if (n < bytes) {
      throw new Error(
        `${path} has only ${n} byte(s) at offset ${offsetBytes}, and ${bytes} were read to compare `
        + `against a magic number. A short read compares as a DIFFERENT magic rather than as a `
        + `missing one, which names the wrong fault.`,
      )
    }
  } finally {
    closeSync(fd)
  }
  return buf.toString('hex')
}

/** The first four bytes of a file. */
export function magicHex(path: string, bytes = 4): string {
  return magicHexAt(path, 0n, bytes)
}

/**
 * Everything the assembler needs from the toolbox, once, in one place.
 *
 * Every path handed to a tool is a HOST path and the toolbox mounts by identity,
 * so nothing is translated across the boundary. The mount set is derived from
 * the inputs rather than fixed at the repository root: BSP_OUT is overridable
 * and a BSP outside the tree is a normal thing to have.
 */
export function mountsFor(inputs: AssemblyInputs, workDir: string): string[] {
  const dirs = new Set<string>([REPO_ROOT, workDir, dirname(resolve(inputs.imgOut))])
  for (const p of [
    inputs.kernelImage, inputs.dtb, inputs.uboot, inputs.ubootDebug,
    inputs.rootfsVerityImg, inputs.rootfsVerityEnv, inputs.bootCmdlineA, inputs.bootCmdlineB,
    inputs.factoryVar,
  ]) {
    if (p !== undefined) dirs.add(dirname(resolve(p)))
  }
  // A directory already covered by another mount is dropped: docker accepts
  // nested -v flags but the result is two mounts of the same bytes, and the
  // inner one shadows writes made through the outer.
  const all = [...dirs].sort()
  return all.filter(d => !all.some(other => other !== d && d.startsWith(`${other}/`)))
}

/**
 * Assemble the image.
 *
 * The refusal order is stable so the first actionable problem is deterministic.
 */
export async function assembleCx3576(
  inputs: AssemblyInputs,
  options: AssembleOptions = {},
): Promise<AssembleResult> {
  const log = options.log ?? ((line: string) => console.log(line))
  const geometry = options.geometry ?? loadGeometry(BOARD)
  if (geometry.faults.length > 0) {
    throw new Error(
      `${geometry.path} has ${geometry.faults.length} unusable value(s), and an assembler cannot pick `
      + `one of two contradictory numbers:\n`
      + geometry.faults.map(f => `  ${f.key}=${JSON.stringify(f.value)} ${f.reason}`).join('\n'),
    )
  }

  const bootCmd = inputs.bootCmd ?? join(BOARDS_DIR, BOARD, 'boot.cmd')
  const workDir = makeWorkDir(`mkimage-${BOARD}`)
  const ownToolbox = options.toolbox === undefined
  const tb = options.toolbox ?? await Toolbox.open(CX3576_ASSEMBLY, {
    mounts: mountsFor(inputs, workDir),
    announce: log,
  })

  try {
    // --- the factory /var, staged so the stamp can be added without writing
    // into _out. First, exactly as in the shell: FACTORY_VAR arrives through the
    // same channel as every other input and its absence is the first thing a
    // caller should be told about.
    if (!existsSync(inputs.factoryVar) || !statSync(inputs.factoryVar).isDirectory()) {
      throw new Error(
        `FACTORY_VAR=${inputs.factoryVar || '<unset>'} is not a directory. The rootfs build exports `
        + `the factory /var tree; run 'MOS_BOARD=${BOARD} bash ${ROOTFS_PRODUCER}' first`,
      )
    }
    const factoryVarStage = join(workDir, 'factory-var')
    mkdirSync(factoryVarStage, { recursive: true })
    // In the container, where the shell runs it. See this file's header.
    await tb.must(['cp', '-a', `${inputs.factoryVar}/.`, `${factoryVarStage}/`], {
      note: `could not stage the factory /var tree from ${inputs.factoryVar}`,
    })

    for (const input of [inputs.kernelImage, inputs.dtb]) requireFile(input, 'it is a BSP artifact')
    if (!existsSync(inputs.uboot)) {
      throw ubootMissingError(inputs.uboot, geometry.require('UBOOT_DEBUG_VARIANT_DIR'))
    }
    // The pairing guard: catches the whole family of "someone copied or
    // symlinked the debug build into uboot-mos because the real build was
    // inconvenient".
    if (inputs.ubootDebug !== undefined && existsSync(inputs.ubootDebug)
      && sameBytes(inputs.uboot, inputs.ubootDebug)) {
      throw new Error(
        `the U-Boot blob at ${inputs.uboot} is byte-identical to the debug build at ${inputs.ubootDebug}.\n`
        + `A mos image must carry the uboot-mos variant: redundant environment at `
        + `${geometry.requirePartition('UENV_A').require('OFFSET_BYTES')}/`
        + `${geometry.requirePartition('UENV_B').require('OFFSET_BYTES')}, setexpr, bootmeth order `
        + `pinned to script. The debug build has none of that and the A/B handshake would silently `
        + `never run.\n`
        + `Rebuild it with 'make -C boards/${BOARD}/bsp uboot-mos'; do not copy or symlink the other `
        + `variant into place.`,
      )
    }
    for (const input of [
      inputs.rootfsVerityImg, inputs.rootfsVerityEnv, inputs.bootCmdlineA, inputs.bootCmdlineB,
    ]) {
      requireFile(input, `produce it with '${ROOTFS_PRODUCER}'`)
    }

    // --- LOADER geometry. board.env cannot compute, so the identities it
    // documents are asserted here.
    const faults = loaderIdentityFaults(geometry)
    if (faults.length > 0) throw new Error(faults.join('\n'))

    const loader = geometry.requirePartition('LOADER')
    const loaderLabel = loader.require('LABEL')
    const loaderPartnum = loader.requireInt('PARTNUM')
    const loaderMagic = loader.require('MAGIC_HEX')
    const seekSector = geometry.requireInt('UBOOT_SEEK_SECTOR')
    const maxBytes = geometry.requireInt('UBOOT_MAX_BYTES')

    const ubootBytes = BigInt(statSync(inputs.uboot).size)
    if (ubootBytes > maxBytes) {
      throw new Error(
        `${inputs.uboot} does not fit between sector ${seekSector} and `
        + `${geometry.requirePartition('UENV_A').require('LABEL')} at `
        + `${geometry.requirePartition('UENV_A').require('START_MIB')} MiB`,
      )
    }
    // The loader partition is only worth having if it actually contains a
    // loader. 'RKNS' is the first field of a Rockchip idbloader; a blob without
    // it is not something the BootROM will load, and shipping it would produce
    // an image that passes every structural check and does not boot.
    // As many bytes as the board's magic spells, not four written down here: a
    // board that declared a longer one would otherwise be compared against a
    // truncated read and always disagree.
    const ubootMagic = magicHex(inputs.uboot, loaderMagic.length / 2)
    if (ubootMagic !== loaderMagic) {
      throw new Error(
        `${inputs.uboot} starts with '${ubootMagic}', not the Rockchip idbloader magic `
        + `'${loaderMagic}' ('RKNS'); the RK3576 BootROM would not recognise it at sector ${seekSector}`,
      )
    }

    // --- the verity payload. Written raw into a slot, so it must land on a
    // whole MiB boundary exactly as the v1 rootfs does.
    const verityBytes = BigInt(statSync(inputs.rootfsVerityImg).size)
    if (verityBytes === 0n || verityBytes % geometry.mibBytes !== 0n) {
      throw new Error(
        `${inputs.rootfsVerityImg} is ${verityBytes} bytes, not a non-zero whole-MiB multiple; `
        + `fix ${ROOTFS_PRODUCER}`,
      )
    }
    const verityMib = verityBytes / geometry.mibBytes

    const rootHash = envFileGet(inputs.rootfsVerityEnv, 'VERITY_ROOT_HASH')
    const veritySalt = envFileGet(inputs.rootfsVerityEnv, 'VERITY_SALT')
    if (rootHash === '') {
      throw new Error(`VERITY_ROOT_HASH missing from ${inputs.rootfsVerityEnv}; fix ${ROOTFS_PRODUCER}`)
    }
    if (veritySalt.toLowerCase() !== geometry.veritySalt.toLowerCase()) {
      throw new Error(
        `${inputs.rootfsVerityEnv} salt '${veritySalt}' does not match the pinned VERITY_SALT `
        + `'${geometry.veritySalt}'; fix ${ROOTFS_PRODUCER}`,
      )
    }

    // --- slot sizing and the chain that hangs off it.
    const slot = decideSlot(geometry, verityMib, options.slotPin, inputs.rootfsVerityImg)
    const layout = deriveLayout(geometry, slot.slotMib)
    log(slot.summary)
    log('data is the last partition and the only growth target; systemd-repart extends it to the end of the disk on first boot')
    log(`verity root hash ${rootHash}`)

    // --- the shared boot script, and every guard boot.cmd has to pass.
    requireFile(bootCmd, 'it is the source of the boot script both slots share')
    checkBootCmd(geometry, readFileSync(bootCmd, 'utf8'), bootCmd)
    const bootScriptName = geometry.require('BOOT_SCRIPT_NAME')
    const bootScr = join(workDir, bootScriptName)
    await makeBootScript(tb, {
      input: bootCmd,
      output: bootScr,
      name: 'mos boot',
      sourceDateEpoch: geometry.ext4.sourceDateEpoch,
    })

    // --- the two boot slots.
    const bootSizeMib = geometry.requireInt('BOOT_SIZE_MIB')
    const bootA = join(workDir, 'boot-a.img')
    const bootB = join(workDir, 'boot-b.img')
    await makeBootSlot(tb, geometry, {
      workDir, bootScr, bootScriptName, image: bootA, sizeMib: bootSizeMib,
      partition: 'BOOT_A', slot: 'A', cmdline: inputs.bootCmdlineA,
      rootfs: 'ROOTFS_A', verityEnvKey: 'BOOT_VERITY_ENV_A_NAME',
      kernelImage: inputs.kernelImage, dtb: inputs.dtb, rootHash,
    })
    await makeBootSlot(tb, geometry, {
      workDir, bootScr, bootScriptName, image: bootB, sizeMib: bootSizeMib,
      partition: 'BOOT_B', slot: 'B', cmdline: inputs.bootCmdlineB,
      rootfs: 'ROOTFS_B', verityEnvKey: 'BOOT_VERITY_ENV_B_NAME',
      kernelImage: inputs.kernelImage, dtb: inputs.dtb, rootHash,
    })

    // --- the ext4 partitions.
    const metaImg = join(workDir, 'meta.img')
    const stateImg = join(workDir, 'state.img')
    const ephemeralImg = join(workDir, 'ephemeral.img')
    const dataImg = join(workDir, 'data.img')
    await makeExt4(tb, geometry, metaImg, geometry.requireInt('META_SIZE_MIB'), 'META')
    await makeExt4(tb, geometry, stateImg, geometry.requireInt('STATE_SIZE_MIB'), 'STATE')

    // EPHEMERAL ships already seeded. /var is a mount of this filesystem, and
    // an empty one hides the tree the installed packages expect. Copying that
    // tree out on the first boot instead would run at the same moment as every
    // other unit that writes /var, and Debian 13's
    // systemd-networkd-persistent-storage.service creates
    // /var/lib/systemd/network as soon as /var appears: the two race, and a
    // lost race fails the seed, which fails var-lib-mos.mount, which fails
    // mosd, apid and the health gate. Seeding here removes the race instead of
    // ordering against one member of it. The stamp goes in too, so
    // mos-seed-var's ConditionPathExists keeps it from running on a normal
    // boot; it stays for the path where EPHEMERAL has been wiped.
    const stamp = join(factoryVarStage, '.mos-var-seeded')
    writeFileSync(stamp, '')
    // The one file in the seed this assembler authors, so the one whose mtime is
    // its to pin; pinSeededTimes handles its atime and ctime along with every
    // other seeded inode's.
    await tb.must(['touch', '-h', '-d', geometry.ext4.fileMtime, stamp], {
      note: `could not pin the mtime of ${stamp}`,
    })
    if (!existsSync(join(factoryVarStage, 'lib'))) {
      throw new Error(
        'the staged factory /var has no lib/; seeding EPHEMERAL from it would produce a /var with no '
        + 'dpkg database and no mosd state directory',
      )
    }
    await makeExt4(tb, geometry, ephemeralImg, geometry.requireInt('MOS_VAR_MIB'), 'EPHEMERAL', factoryVarStage)
    await makeExt4(tb, geometry, dataImg, geometry.requireInt('DATA_SIZE_MIB'), 'DATA')

    // --- the disk.
    const imgTmp = `${inputs.imgOut}.tmp`
    rmSync(imgTmp, { force: true })
    await truncate(tb, imgTmp, `${layout.totalSizeMib}M`)

    // Every start is given explicitly in sectors: the layout is pinned, not
    // negotiated with sgdisk's allocator. `-a GPT_ALIGN_SECTORS` because the
    // loader starts at sector 64, which is NOT 2048-aligned -- see the header.
    await writeGpt(tb, imgTmp, gptSpecFor(geometry, layout));

    // uenv-a/uenv-b and rootfs-b stay holes: nothing is written into them.
    // conv=sparse on the payloads keeps the rest of the image sparse too: the
    // FAT and ext4 images are mostly zeros, and the destination is a freshly
    // truncated hole, so seeking over a zero block leaves exactly the same bytes
    // as writing it. Content is unaffected; only allocation is.
    const conv = ['notrunc', 'sparse']
    await dd(tb, {
      input: inputs.uboot, output: imgTmp, blockSize: String(geometry.sectorSize),
      seekBlocks: seekSector, conv, quiet: true,
    })
    const placements: [string, bigint][] = [
      [bootA, requireStartMib(geometry, 'BOOT_A')],
      [bootB, requireStartMib(geometry, 'BOOT_B')],
      [inputs.rootfsVerityImg, requireStartMib(geometry, 'ROOTFS_A')],
      [metaImg, layout.metaStartMib],
      [stateImg, layout.stateStartMib],
      [ephemeralImg, layout.ephemeralStartMib],
      [dataImg, layout.dataStartMib],
    ]
    for (const [input, seekMib] of placements) {
      await dd(tb, { input, output: imgTmp, blockSize: '1M', seekBlocks: seekMib, conv, quiet: true })
    }

    // BOTH failure shapes -- a nonzero exit AND problem text with exit 0 --
    // reach the same refusal; src/tools/sgdisk.ts carries the pairing.
    log(await verifyGpt(tb, imgTmp));

    // Read the loader back out of the assembled image: sgdisk is free to move
    // a requested start sector, so asserting what we asked for proves nothing;
    // this asserts what is actually there.
    const got = await readPartition(tb, imgTmp, loaderPartnum);
    checkLoaderLanded(geometry, got)
    const gotMagic = checkLoaderMagic(geometry, imgTmp, got.firstSector)
    const loaderBytes = geometry.sectorsToBytes(got.sizeSectors)
    log(
      `${loaderLabel} p${loaderPartnum}: sectors ${got.firstSector}..${got.firstSector + got.sizeSectors - 1n}, `
      + `${ubootBytes} of ${loaderBytes} bytes used (${loaderBytes - ubootBytes} spare); `
      + `first bytes ${gotMagic} ('RKNS')`,
    )

    renameSync(imgTmp, inputs.imgOut)
    return {
      image: inputs.imgOut,
      slot,
      layout,
      rootHash,
      loaderStartSector: got.firstSector,
      loaderSizeSectors: got.sizeSectors,
      ubootBytes,
    }
  } finally {
    if (ownToolbox) await tb.close()
    rmSync(workDir, { recursive: true, force: true })
  }
}

/**
 * The first bytes of the loader PARTITION are a loader -- read out of the image.
 *
 * The blob was already checked before it was written, so this is the second half
 * of the same question asked of a different thing: not "is the file a loader"
 * but "is a loader at the sector the table points at". Those come apart if the
 * partition moved, if the dd went to the wrong offset, or if anything written
 * afterwards landed on top of it, and none of those announce themselves -- the
 * image assembles, verifies and flashes.
 *
 * Its own function for the same reason checkLoaderLanded is: an inline check
 * that nothing a caller can pass makes fail is a check that has only ever been
 * observed not firing.
 */
export function checkLoaderMagic(geometry: Geometry, image: string, startSector: bigint): string {
  const loader = geometry.requirePartition('LOADER')
  const want = loader.require('MAGIC_HEX')
  const got = magicHexAt(image, geometry.sectorsToBytes(startSector), want.length / 2)
  if (got === want) return got
  throw new Error(
    `the first bytes of the ${loader.require('LABEL')} partition are '${got}', not the idbloader `
    + `magic '${want}'`,
  )
}

/**
 * The loader landed where it was asked to -- checked against the assembled
 * table, not against the request. `-a 1` is not cosmetic where a partition start is sector 64: without it
 * sgdisk relocates that start to sector 2048, silently, and exits 0. A
 * relocated loader partition does not cover the bootloader, and
 * boards/cx3576/board.env spells out what happens next -- systemd-repart
 * "discards every region of the disk that no partition entry covers", on the
 * first boot while growing DATA, so "the device boots once and comes up in
 * maskrom on the next power-on". An image in that state passes every structural
 * check there is and boots on a test bench. So this compares what sgdisk wrote
 * rather than what it was told, drivable from the failing side against a real
 * table written with the alignment left out.
 */
export function checkLoaderLanded(geometry: Geometry, got: GptPartitionInfo): void {
  const loader = geometry.requirePartition('LOADER')
  const wantStart = loader.requireInt('START_SECTOR')
  const wantSize = loader.requireInt('SIZE_SECTORS')
  if (got.firstSector === wantStart && got.sizeSectors === wantSize) return
  throw new Error(
    `the assembled ${loader.require('LABEL')} partition is ${got.sizeSectors} sectors at `
    + `${got.firstSector}, expected ${wantSize} at ${wantStart}. sgdisk relocates a non-2048-aligned `
    + `start unless -a ${geometry.disk.alignSectors} is passed, and a relocated loader partition no `
    + `longer covers the bootloader.`,
  )
}

function requireStartMib(geometry: Geometry, name: string): bigint {
  const start = geometry.requirePartition(name).start
  if (start?.mib === undefined) {
    throw new Error(
      `${geometry.path} does not place ${name} on a whole MiB, and dd seeks this image in MiB blocks.`,
    )
  }
  return start.mib
}

/** Two files, compared byte for byte -- `cmp -s`. */
export function sameBytes(a: string, b: string): boolean {
  const sa = statSync(a)
  const sb = statSync(b)
  if (sa.size !== sb.size) return false
  return readFileSync(a).equals(readFileSync(b))
}

interface BootSlotSpec {
  workDir: string
  bootScr: string
  bootScriptName: string
  image: string
  sizeMib: bigint
  partition: string
  slot: string
  cmdline: string
  rootfs: string
  verityEnvKey: string
  kernelImage: string
  dtb: string
  rootHash: string
}

/**
 * Stage and format one boot slot's FAT32 filesystem.
 *
 * The slots hold the same kernel, dtb and boot.scr; only the slot-suffixed
 * mos-verity-<slot>.env differs, and it is what points the shared script at this
 * slot's rootfs. The unsuffixed name is deliberately not written: a
 * RAUC-installed slot only ever carries the suffixed files, so writing it here
 * would make a factory slot and an updated slot differ in layout and leave the
 * suffixed path untested until the first update. Deliberately no
 * extlinux/extlinux.conf either -- both U-Boot boot frameworks try extlinux
 * before boot.scr, so one here would silently bypass the A/B handshake.
 */
async function makeBootSlot(tb: Toolbox, geometry: Geometry, spec: BootSlotSpec): Promise<void> {
  const p = geometry.requirePartition(spec.partition)
  const volumeId = p.require('FAT_VOLUME_ID')
  const stage = join(spec.workDir, `stage-${volumeId}`)
  mkdirSync(stage, { recursive: true })
  copyFileSync(spec.kernelImage, join(stage, 'Image'))
  copyFileSync(spec.dtb, join(stage, 'rk3576-src.dtb'))
  copyFileSync(spec.bootScr, join(stage, spec.bootScriptName))

  const verityEnvName = geometry.require(spec.verityEnvKey)
  const verity = verityEnvFor({
    cmdline: readFileSync(spec.cmdline, 'utf8'),
    cmdlinePath: spec.cmdline,
    slot: spec.slot,
    rootfsGuid: geometry.requirePartition(spec.rootfs).require('GUID'),
    rootHash: spec.rootHash,
    producer: ROOTFS_PRODUCER,
  })
  writeFileSync(join(stage, verityEnvName), verity.text)

  // `find <stage> -exec touch -h -d FILE_MTIME {} +` -- the directory too, and
  // in the container, where the shell does it.
  await tb.must(['find', stage, '-exec', 'touch', '-h', '-d', geometry.ext4.fileMtime, '{}', '+'], {
    note: `could not pin the staged ${spec.partition} files to ${geometry.ext4.fileMtime}`,
  })

  await truncate(tb, spec.image, `${spec.sizeMib}M`)
  await mkfsVfat(tb, { image: spec.image, label: p.require('FAT_LABEL'), volumeId })
  // ONE mcopy, with the sources in the order a C-locale glob produces them --
  // which is the order `"${stage}"/*` expands to in the shell, and the order the
  // entries land in the FAT directory. Sorted by BYTE here (`Image` before
  // `boot.scr`, uppercase first) rather than by whatever the running locale
  // would say, because the container has no locale set and the image must not
  // depend on the one the host happens to carry.
  const files = [`${stage}/Image`, `${stage}/${spec.bootScriptName}`, `${stage}/${verityEnvName}`, `${stage}/rk3576-src.dtb`]
    .sort((a, b) => (basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0))
  await mcopy(tb, { image: spec.image, sources: files, destination: '::/', recursive: true })
}

/**
 * Format one partition slot's ext4 filesystem into a standalone image file.
 *
 * A seeded filesystem gets the timestamp pass afterwards -- EVERY seeded one,
 * not just today's only one: an unseeded mke2fs invents all four times and
 * E2FSPROGS_FAKE_TIME pins them, but the moment a tree is copied in, two of them
 * come from the host clock.
 */
async function makeExt4(
  tb: Toolbox,
  geometry: Geometry,
  image: string,
  sizeMib: bigint,
  partition: string,
  seedDir?: string,
): Promise<void> {
  const p = geometry.requirePartition(partition)
  await truncate(tb, image, `${sizeMib}M`)
  await mke2fs(tb, {
    image,
    label: p.require('FS_LABEL'),
    uuid: p.require('FS_UUID'),
    blockSize: geometry.ext4.blockSize,
    features: geometry.ext4.features,
    fakeTime: geometry.ext4.fakeTime,
    seedDir,
  })
  if (seedDir !== undefined) await pinSeededTimes(tb, image, geometry.ext4.fileMtime)
}
