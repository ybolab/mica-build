// os/mkimage-x64.sh, ported: the x64 (amd64 industrial PC, UEFI) A/B GPT disk
// image -- layout v2, nine partitions.
//
// One static ESP that GRUB is loaded from, a FAT32 boot partition per slot, two
// raw squashfs+dm-verity rootfs slots and the meta/state/ephemeral/data ext4
// partitions. Every layout constant comes from os/boards/x64/board.env through
// os/verify's typed model and this package's geometry; nothing is duplicated here
// and nothing re-reads that file.
//
// WHY THIS IS NOT src/mkimage-v2.ts WITH A BOARD PARAMETER, which is the same
// question os/mkimage-x64.sh answers about os/mkimage-v2.sh. That assembler is
// U-Boot: a loader partition at a fixed sector, a redundant environment pair, a
// compiled boot.scr and geometry assertions about all three. None of it exists on
// a UEFI machine. Threading conditionals through it would put a second board's
// boot chain inside the first board's assertions, where a mistake in either is a
// mistake in both. What the two DO share is shared as files and as modules --
// os/boards/*/board.env, src/geometry.ts, src/pin-seeded-times.ts,
// src/tools/ -- and not as a `case`.
//
// EVERY DECISION THAT REACHES THE OUTPUT BYTES IS FIXED. Two assemblies from
// identical inputs must be byte-identical:
//
//   * the same pinned debian (IMAGE_DEBIAN_TRIXIE) out of the same apt package
//     list -- BOOTX64.EFI is only as reproducible as the grub-efi-amd64-bin in
//     that image, which is the header note os/mkimage-x64.sh opens with;
//   * grub-mkstandalone and grub-editenv run with the WORK DIRECTORY AS CWD and
//     relative filenames, exactly as the shell's `cd /w` gives them. An absolute
//     path handed to grub-mkstandalone is a string this assembler would be
//     inventing, and the work directory is the one path that differs between the
//     shell (_out/x64/.mkimage-work) and this (os/build/.work/mkimage-x64-*);
//   * the boot slots take THREE separate `mcopy -m` calls each, in the order
//     vmlinuz, initrd.img, cmdline.cfg, because that is the order the entries
//     land in the FAT directory. The ESP takes ONE `mcopy -s -m` of a staged
//     tree, because `mmd` has no source to take a time from and stamps ::/EFI
//     with the wall clock -- measured at 18 moving bytes in the shell's own
//     header;
//   * `cp -a` of the factory /var runs ON THE HOST, where os/mkimage-x64.sh:161
//     runs it. THIS IS THE OPPOSITE OF src/mkimage-v2.ts and it is deliberate:
//     that script stages inside its container and this one does not, `cp -a` is
//     `--preserve=all` (which includes xattrs), mke2fs -d copies xattrs into the
//     image, and this campaign's host runs SELinux while neither container does.
//     Each port stages where its own shell stages, because the only thing that
//     would report a mismatch is the byte-identity gate -- as a diff in the
//     middle of a 512 MiB filesystem.
//
// SIZES GO TO sgdisk IN SECTORS, with `-a 2048` passed explicitly. `+131072S`
// and `+64M` are byte-identical at 512-byte sectors, and the alignment is
// x64's own GPT_ALIGN_SECTORS and the same number sgdisk defaults to, which
// src/mkimage-x64.test.ts re-measures against a real sgdisk rather than
// asserting in prose. See gptSpecFor.
//
// DETERMINISM. The controls are board.env's -- fixed GPT GUIDs, fixed FAT volume
// ids, fixed ext4 fs UUIDs, `mkfs.vfat --invariant`, every FAT entry staged with
// its mtime touched to FILE_MTIME and copied with `mcopy -m`,
// E2FSPROGS_FAKE_TIME in the assembly's environment, and `-E hash_seed` pinned to
// each filesystem's own UUID -- plus the one that none of those reach:
// pinSeededTimes over EPHEMERAL, because `mke2fs -d` copies the SOURCE inode's
// atime and ctime and no control over mke2fs touches them. Before those landed,
// two assemblies of this image four minutes apart differed in NINE MiB.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { $ } from 'bun'
import { loadGeometry, type Geometry } from './geometry.ts'
import { cmdlineFacts, earlyCfg, GRUB_MODULES, renderGrubCfg, verityFactsFrom, type VerityFacts } from './grub-x64.ts'
import { decideSlot, deriveLayout, gptSpecFor, placementMib, type DerivedLayout, type SlotDecision } from './layout-x64.ts'
import { BOARDS_DIR, makeWorkDir, REPO_ROOT } from './paths.ts'
import { pinSeededTimes } from './pin-seeded-times.ts'
import { Toolbox } from './toolbox.ts'
import { X64_ASSEMBLY } from './toolsets.ts'
import { dd, truncate } from './tools/dd.ts'
import { mke2fs } from './tools/e2fsprogs.ts'
import { FAT32_MIN_CLUSTERS, listFat, mcopy, mkfsVfat, readFatClusters } from './tools/mtools.ts'
import { readPartition, verifyGpt, writeGpt, type GptPartitionInfo, type GptSpec } from './tools/sgdisk.ts'

/** The board this assembler is for. One board, like the script it replaces. */
export const BOARD = 'x64'

/**
 * The producer of the rootfs-side inputs, named in every message about one.
 *
 * The BOARD IS A LITERAL in that sentence, not `${MOS_BOARD}`. Interpolating a
 * variable no board.env sets makes the one case with an actionable message die
 * on the unbound variable instead of printing it -- and a `${MOS_BOARD:-x64}`
 * default is wrong too, because a cx3576 left in the environment would name
 * the wrong board to build.
 */
export const ROOTFS_PRODUCER = `MOS_BOARD=${BOARD} bash os/rootfs/build-v2.sh`

/** The stamp that keeps mos-seed-var from racing every other unit that writes /var. */
export const SEED_STAMP = '.mos-var-seeded'

export interface AssemblyInputs {
  readonly rootfsVerityImg: string
  readonly rootfsVerityEnv: string
  readonly kernel: string
  readonly initrd: string
  readonly factoryVar: string
  readonly imgOut: string
  /** Defaults to the tree's own os/boards/x64/grub.cfg. */
  readonly grubCfgIn?: string
}

export interface AssembleOptions {
  /** An already-open toolbox. One is opened and closed here otherwise. */
  readonly toolbox?: Toolbox
  readonly geometry?: Geometry
  readonly log?: (line: string) => void
  /** Kept after a failure, for a test that needs to look at what was staged. */
  readonly keepWorkDir?: boolean
}

export interface AssembleResult {
  readonly image: string
  readonly slot: SlotDecision
  readonly layout: DerivedLayout
  readonly verity: VerityFacts
  /** The cluster count the finished ESP reported, before anything was copied in. */
  readonly espClusters: bigint
  readonly grubenvBytes: bigint
  readonly partitions: readonly GptPartitionInfo[]
}

/**
 * Every path handed to a tool is a HOST path and the toolbox mounts by identity,
 * so nothing is translated across the boundary.
 */
export function mountsFor(inputs: AssemblyInputs, workDir: string): string[] {
  const dirs = new Set<string>([REPO_ROOT, workDir, dirname(resolve(inputs.imgOut))])
  for (const p of [
    inputs.rootfsVerityImg, inputs.rootfsVerityEnv, inputs.kernel, inputs.initrd, inputs.factoryVar,
    inputs.grubCfgIn,
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
 * The five inputs os/mkimage-x64.sh:81 requires before it does anything.
 *
 * One sentence, five files, in the shell's order -- and the sentence names the
 * script that MAKES them, because "rootfs-verity.img not found" is only
 * actionable once you know what produces it.
 */
export function requiredInputs(inputs: AssemblyInputs, grubCfgIn: string): string[] {
  return [inputs.rootfsVerityImg, inputs.rootfsVerityEnv, inputs.kernel, inputs.initrd, grubCfgIn]
}

/**
 * Stage the factory /var tree ON THE HOST, with `cp -a`.
 *
 * Its own function so the ONE step this assembler deliberately runs outside its
 * container is visible as such rather than buried in a hundred-line assembly, and
 * so the reason travels with it. See this file's header: os/mkimage-x64.sh:161
 * runs this on the host, `cp -a` is `--preserve=all`, and mke2fs -d copies xattrs
 * into EPHEMERAL. Staging it in the container instead would be a change to the
 * shipped bytes made in the milestone whose job is to prove there is none.
 *
 * `cp -a`, not node's cpSync: node preserves neither ownership nor xattrs and
 * would produce a different filesystem while reporting success.
 */
export async function stageFactoryVarOnHost(source: string, destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true })
  // `${source}/.` -- the CONTENTS, not the directory. `cp -a src dst/` where dst
  // exists nests it, and the seed would become factory-var/factory-var/.
  const r = await $`cp -a ${`${source}/.`} ${`${destination}/`}`.nothrow().quiet()
  if (r.exitCode !== 0) {
    throw new Error(
      `could not stage the factory /var tree from ${source} with 'cp -a' (exit ${r.exitCode}):\n`
      + `${r.stderr.toString().trimEnd() || '(no output)'}\n`
      + `This step runs on the HOST because os/mkimage-x64.sh runs it there, and 'cp -a' is what `
      + `carries the tree's ownership and extended attributes into the filesystem mke2fs seeds.`,
    )
  }
}

/**
 * THE ESP IS A REAL FAT32 -- BY CLUSTER COUNT, AT THE POINT THE SHELL ASKS.
 *
 * READ THIS BEFORE MOVING THE CALL. os/mkimage-x64.sh:263 parses FREE clusters
 * out of minfo's FSInfo sector, where the FAT specification defines the type by
 * TOTAL clusters. On a filesystem nothing has been copied into, free is total
 * minus the root directory's one cluster, so the comparison is conservative by
 * exactly one and correct WHERE IT STANDS -- and only there. Measured on a 64 MiB
 * ESP (src/mkimage-x64.test.ts re-measures it): free 129021 and total 129022
 * immediately after mkfs.vfat, and free 117119 once the ESP tree is staged.
 *
 * So moving this after the mcopy -- the natural tidy-up during a port -- silently
 * turns a FAT-TYPE check into a FREE-SPACE check. It would refuse a valid FAT32
 * for being full, while printing a message about the FAT specification, and it
 * would stop refusing the case it exists for as soon as the payload grew. The
 * caller below calls it exactly where the shell does, and this is the note that
 * says why the position is not cosmetic.
 *
 * WHY THE CHECK IS A CLUSTER COUNT AND NOT A TYPE. `mkfs.vfat -F 32` does not
 * enforce FAT32: given a 32 MiB partition it writes a FAT32 boot sector over
 * 64495 clusters and exits 0, and minfo -- which reads the type out of the BPB --
 * calls it FAT32. OVMF computes the type the way the specification says, finds a
 * FAT32 BPB describing a FAT16 cluster count, and refuses the filesystem: the ESP
 * was simply absent from the firmware's device list and the machine dropped to
 * the UEFI shell. The FIRST version of this check asked minfo for the type and
 * passed on that exact image.
 */
export async function checkEspIsFat32(tb: Toolbox, image: string, espSizeMib: bigint): Promise<bigint> {
  const clusters = await readFatClusters(tb, image)
  if (clusters < FAT32_MIN_CLUSTERS) {
    throw new Error(
      `the ESP has ${clusters} clusters, below the ${FAT32_MIN_CLUSTERS} the FAT specification requires `
      + `for FAT32. mkfs.vfat wrote a FAT32 boot sector over it anyway and every tool that trusts the `
      + `boot sector will agree it is FAT32 -- the firmware will not, and firmware that cannot mount the `
      + `ESP reports nothing at all. Raise ESP_SIZE_MIB (33 MiB is the measured floor); it is currently `
      + `${espSizeMib}.`,
    )
  }
  return clusters
}

/**
 * grubenv IS EXACTLY 1024 BYTES, and a file of any other size is not a grubenv.
 *
 * grub-editenv creates it that way and RAUC rewrites it in place with the same
 * tool. GRUB ignores one of the wrong size SILENTLY -- which looks exactly like
 * an A/B order that never changes, which is the one symptom this whole boot chain
 * exists to make impossible.
 *
 * A separate function for the reason src/mkimage-v2.ts gives for
 * checkLoaderLanded: nothing a caller can pass to the assembly makes a real
 * grub-editenv produce a file of another size, so inline it could only ever be
 * observed NOT firing.
 */
export const GRUBENV_BYTES = 1024n

export function checkGrubenvSize(path: string, bytes: bigint): void {
  if (bytes === GRUBENV_BYTES) return
  throw new Error(
    `grubenv is ${bytes} bytes, not ${GRUBENV_BYTES}; GRUB would ignore it and the A/B order would `
    + `silently never change (${path}).`,
  )
}

/**
 * NOTHING PER-SLOT ON THE ESP -- asserted against the finished filesystem.
 *
 * A kernel or a cmdline that reappeared here would be read by GRUB in preference
 * to nothing -- there is no "nothing" to prefer -- and would then be a per-install
 * file on the one partition RAUC never installs into.
 *
 * The names come from the BOARD (SLOT_KERNEL_NAME and friends), not from three
 * literals: os/mkimage-x64.sh spells `vmlinuz initrd.img cmdline.cfg`, which is
 * a second copy of the same three keys, and a board that renamed one would have
 * the stray check quietly stop covering it.
 */
export function strayEspEntries(entries: readonly string[], slotFileNames: readonly string[]): string[] {
  return slotFileNames.filter(n => entries.includes(`::/${n}`))
}

/**
 * THE TWO BOOT SLOTS DIFFER ONLY IN THEIR FILESYSTEM IDENTITY.
 *
 * Both start life with the same contents: an image whose B side was empty would
 * have nothing to fall back TO on the first bad update, so "B is populated" is a
 * property of the shipped image and not of the first install.
 *
 * A separate function because nothing a caller can pass to the assembly makes the
 * two listings differ -- both slots are written by the same three mcopy calls
 * from the same three files -- so inline this could only ever be observed NOT
 * firing, which is the shape this tree has shipped twice and found by mutation.
 * Given the two listings it is drivable in microseconds, from both sides.
 */
export function bootSlotFault(aList: readonly string[], bList: readonly string[]): string | undefined {
  if (aList.join('\n') === bList.join('\n')) return undefined
  return `the two boot slots do not carry the same files\n`
    + `  boot-a: ${aList.join(' ') || '(nothing)'}\n`
    + `  boot-b: ${bList.join(' ') || '(nothing)'}`
}

/**
 * THE PARTITIONS LANDED WHERE THEY WERE ASKED TO -- read back out of the
 * ASSEMBLED TABLE, not compared against the request.
 *
 * x64 has no loader partition and every start it declares is a whole MiB, which
 * is 2048 sectors, so no start is relocatable by the alignment this assembler
 * PASSES. That is a statement about the board file and the flag. This is a
 * statement about the table sgdisk actually wrote, and the two are not the same
 * claim -- which is exactly the lesson src/mkimage-v2.ts records for cx3576,
 * where asking sgdisk for a layout proved nothing about the layout.
 *
 * AND ON THIS BOARD A WRONG ALIGNMENT DOES NOT ANNOUNCE ITSELF. Measured
 * (src/mkimage-x64.test.ts): `-a 4096` over the real x64 geometry moves the ESP
 * from sector 2048 to 4096, prints "Information: Moved requested sector", and
 * EXITS 0. On cx3576 the same flag makes sgdisk refuse the table with exit 4 --
 * the relocation there would push uenv-b into boot-a and there is no room. The
 * shape depends on the geometry rather than on the flag,
 * and on x64 this read-back is the only thing that would report it.
 *
 * It earns its keep for one more reason: this assembler passes `-a 2048` where
 * os/mkimage-x64.sh passes no alignment at all. That difference is measured to be
 * no difference, and this keeps it measured on every run rather than on the day
 * it was measured.
 *
 * Every mismatch is collected rather than thrown at the first: nine drifting
 * partitions should produce nine lines.
 */
export function partitionFaults(spec: GptSpec, got: readonly GptPartitionInfo[]): string[] {
  const faults: string[] = []
  const byNum = new Map(got.map(p => [p.partnum, p]))
  for (const want of spec.partitions) {
    const have = byNum.get(want.partnum)
    if (have === undefined) {
      faults.push(`p${want.partnum} (${want.label ?? '?'}) is not in the assembled table at all`)
      continue
    }
    if (have.firstSector !== want.startSector || have.sizeSectors !== want.sizeSectors) {
      faults.push(
        `the assembled ${want.label ?? `p${want.partnum}`} is ${have.sizeSectors} sectors at `
        + `${have.firstSector}, expected ${want.sizeSectors} at ${want.startSector}. sgdisk relocates a `
        + `start that is not a multiple of its alignment, silently and with a success exit.`,
      )
    }
  }
  return faults
}

function requireFile(path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${path} not found. Build the root first: ${ROOTFS_PRODUCER}`)
  }
}

/**
 * Assemble the image.
 *
 * The order of the refusals is os/mkimage-x64.sh's, and it is kept: a reader
 * comparing the two should be able to run the same broken input through both and
 * get the same sentence first.
 */
export async function assembleX64(
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
  const grubCfgIn = inputs.grubCfgIn ?? join(BOARDS_DIR, BOARD, 'grub.cfg')

  // --- the five inputs, before anything is created.
  for (const f of requiredInputs(inputs, grubCfgIn)) requireFile(f)

  const verity = verityFactsFrom(readFileSync(inputs.rootfsVerityEnv, 'utf8'), inputs.rootfsVerityEnv)
  if (verity.salt.toLowerCase() !== geometry.veritySalt.toLowerCase()) {
    // Not one of os/mkimage-x64.sh's refusals -- that script reads VERITY_SALT
    // out of the env file and never compares it to the board's. It is here
    // because os/mkimage-v2.sh DOES make this comparison for cx3576 and the
    // reason is board-independent: a hash tree built with a salt other than the
    // pinned one is not reproducible, and the fragment would carry the built
    // salt while board.env claimed another. Named as an addition rather than
    // presented as a port, and it cannot change the gate: the shipped inputs
    // carry the pinned salt, so on every input the shell accepts this is silent.
    throw new Error(
      `${inputs.rootfsVerityEnv} salt '${verity.salt}' does not match the pinned VERITY_SALT `
      + `'${geometry.veritySalt}' in ${geometry.path}; fix ${ROOTFS_PRODUCER}`,
    )
  }

  // --- geometry, from the payload's BYTE count. See src/layout-x64.ts on why
  // this is not a MiB count.
  const payloadBytes = BigInt(statSync(inputs.rootfsVerityImg).size)
  const slot = decideSlot(geometry, payloadBytes)
  const layout = deriveLayout(geometry, slot.slotMib)
  const starts = placementMib(geometry, layout)

  const workDir = makeWorkDir(`mkimage-${BOARD}`)
  const ownToolbox = options.toolbox === undefined
  let tb: Toolbox | undefined
  try {
    // --- the factory /var, staged BEFORE the toolbox opens, because it is a host
    // step and its absence is the first thing a caller should be told about.
    if (!existsSync(inputs.factoryVar) || !statSync(inputs.factoryVar).isDirectory()) {
      throw new Error(
        `${inputs.factoryVar || '<unset>'} not found. The rootfs build exports it; run `
        + `'${ROOTFS_PRODUCER}' first`,
      )
    }
    const factoryVarStage = join(workDir, 'factory-var')
    await stageFactoryVarOnHost(inputs.factoryVar, factoryVarStage)

    // --- the two per-slot payload files, copied so their mtimes can be pinned
    // without writing into _out. The rootfs image is NOT copied: it is only ever
    // dd'd, and dd reads the same bytes from either path.
    const kernel = join(workDir, 'vmlinuz')
    const initrd = join(workDir, 'initrd.img')
    copyFileSync(inputs.kernel, kernel)
    copyFileSync(inputs.initrd, initrd)

    // --- grub.cfg: the BOARD constants and nothing that changes with a build,
    // with all three of its guards. Rendered on the host, where the shell's sed
    // runs.
    const grubCfg = join(workDir, 'grub.cfg')
    const rendered = renderGrubCfg(geometry, readFileSync(grubCfgIn, 'utf8'), grubCfgIn)
    writeFileSync(grubCfg, rendered.text)

    // --- the per-slot fragment. Identical bytes for both slots today; each
    // replaced independently by an install.
    const cmdlineCfg = join(workDir, 'cmdline.cfg')
    writeFileSync(cmdlineCfg, cmdlineFacts(verity))

    // E2FSPROGS_FAKE_TIME IS ON THE TOOLSET, NOT ON THE ONE CALL THAT READS IT.
    // mke2fs takes it out of the ENVIRONMENT, and sourcing a file SETS without
    // EXPORTING -- the pin sat in board.env doing nothing at all until
    // os/mkimage-x64.sh:232 exported it, "a documented layout key doing nothing,
    // which is worse than an absent one because it reads as covered". That
    // `export` covers the WHOLE inner script, so every e2fsprogs tool in the
    // assembly sees it; this puts it in the same place, on the session, rather
    // than deciding which tools care. src/tools/e2fsprogs.ts also passes it per
    // mke2fs call, and the two agree because both read geometry.ext4.fakeTime.
    tb = options.toolbox ?? await Toolbox.open(
      { ...X64_ASSEMBLY, env: { E2FSPROGS_FAKE_TIME: geometry.ext4.fakeTime } },
      { mounts: mountsFor(inputs, workDir), cwd: workDir, announce: log },
    )

    const fileMtime = geometry.ext4.fileMtime
    const esp = geometry.requirePartition('ESP')
    const espSizeMib = esp.requireInt('SIZE_MIB')
    const espFatLabel = esp.require('FAT_LABEL')

    // --- the ESP: static, in no slot group.
    const espImg = join(workDir, 'esp.img')
    await truncate(tb, espImg, String(geometry.mibToBytes(espSizeMib)))
    await mkfsVfat(tb, { image: espImg, label: espFatLabel, volumeId: esp.require('FAT_VOLUME_ID') })
    // HERE, and not after the mcopy below. See checkEspIsFat32.
    const espClusters = await checkEspIsFat32(tb, espImg, espSizeMib)
    log(`esp: ${espClusters} free clusters at ${espSizeMib} MiB (FAT32 needs ${FAT32_MIN_CLUSTERS})`)

    // --- GRUB, with every module it needs embedded. Relative names and cwd =
    // workDir, as the shell's `cd /w` gives it; see this file's header.
    writeFileSync(join(workDir, 'early.cfg'), earlyCfg(espFatLabel))
    await tb.must([
      'grub-mkstandalone',
      '--format=x86_64-efi',
      '--output=BOOTX64.EFI',
      `--modules=${GRUB_MODULES.join(' ')}`,
      'boot/grub/grub.cfg=early.cfg',
    ], { cwd: workDir, note: 'grub-mkstandalone could not build BOOTX64.EFI' })

    await tb.must(['grub-editenv', 'grubenv', 'create'], { cwd: workDir, note: 'grub-editenv could not create grubenv' })
    await tb.must(['grub-editenv', 'grubenv', 'set', 'ORDER=A B'], { cwd: workDir, note: 'grub-editenv could not set ORDER' })
    await tb.must(['grub-editenv', 'grubenv', 'set', 'A_OK=0', 'A_TRY=0', 'B_OK=0', 'B_TRY=0'], {
      cwd: workDir, note: 'grub-editenv could not set the A/B counters',
    })
    const grubenv = join(workDir, 'grubenv')
    const grubenvBytes = BigInt(statSync(grubenv).size)
    checkGrubenvSize(grubenv, grubenvBytes)

    // --- staged and copied as a TREE. `mcopy -m` takes each entry's timestamp
    // from its source, so a `touch` pins it -- but the ESP needs three
    // DIRECTORIES and `mmd` has no source to take a time from: it stamps ::/EFI,
    // ::/EFI/BOOT and ::/EFI/mos with the real clock and -m cannot reach them.
    // Measured in the shell's header: mmd plus per-file `mcopy -m` still moved 18
    // bytes across two assemblies 3 seconds apart; this moves none.
    const espStage = join(workDir, 'esp-stage')
    mkdirSync(join(espStage, 'EFI', 'BOOT'), { recursive: true })
    mkdirSync(join(espStage, 'EFI', 'mos'), { recursive: true })
    await tb.must(['cp', join(workDir, 'BOOTX64.EFI'), join(espStage, 'EFI', 'BOOT', 'BOOTX64.EFI')], {
      note: 'could not stage BOOTX64.EFI',
    })
    await tb.must(['cp', grubCfg, join(espStage, 'EFI', 'mos', 'grub.cfg')], { note: 'could not stage grub.cfg' })
    await tb.must(['cp', grubenv, join(espStage, 'EFI', 'mos', 'grubenv')], { note: 'could not stage grubenv' })
    await tb.must(['find', espStage, '-exec', 'touch', '-h', '-d', fileMtime, '{}', '+'], {
      note: `could not pin the staged ESP tree to ${fileMtime}`,
    })
    await mcopy(tb, {
      image: espImg,
      sources: [join(espStage, 'EFI')],
      destination: '::/',
      recursive: true,
    })

    // --- nothing per-slot on the ESP.
    const kernelName = geometry.require('SLOT_KERNEL_NAME')
    const initrdName = geometry.require('SLOT_INITRD_NAME')
    const cmdlineName = geometry.require('SLOT_CMDLINE_NAME')
    const slotFileNames = [kernelName, initrdName, cmdlineName]
    const strays = strayEspEntries(await listFat(tb, espImg), slotFileNames)
    if (strays.length > 0) {
      throw new Error(
        strays
          .map(s => `${s} is on the ESP. The per-slot payload belongs on the slot's own boot partition; `
            + `on the ESP no install would ever replace it`)
          .join('\n'),
      )
    }

    // --- the per-slot boot partitions. Both start life with the same contents:
    // an image whose B side was empty would have nothing to fall back TO on the
    // first bad update. Each gets its OWN filesystem identity, though -- `cp`
    // plus `mlabel` changes the label and leaves the volume id as A's, and mlabel
    // cannot set a volume id, so each is MADE rather than copied.
    //
    // Pinned before the loop, not inside it: both slots copy the same three
    // files, and touching them twice would only make the second slot's timestamps
    // depend on the first slot's having already happened.
    await tb.must(['touch', '-h', '-d', fileMtime, kernel, initrd, cmdlineCfg], {
      note: `could not pin the per-slot payload files to ${fileMtime}`,
    })
    const bootSizeMib = geometry.requireInt('BOOT_SIZE_MIB')
    const makeBootSlot = async (box: Toolbox, partition: string): Promise<string> => {
      const p = geometry.requirePartition(partition)
      const image = join(workDir, `${p.require('LABEL')}.img`)
      await truncate(box, image, String(geometry.mibToBytes(bootSizeMib)))
      await mkfsVfat(box, { image, label: p.require('FAT_LABEL'), volumeId: p.require('FAT_VOLUME_ID') })
      // THREE calls, in this order: it is the order the entries land in the FAT
      // directory, and the directory's byte layout is what the gate compares.
      for (const [source, name] of [[kernel, kernelName], [initrd, initrdName], [cmdlineCfg, cmdlineName]] as const) {
        await mcopy(box, { image, sources: [source], destination: `::/${name}` })
      }
      return image
    }
    const bootA = await makeBootSlot(tb, 'BOOT_A')
    const bootB = await makeBootSlot(tb, 'BOOT_B')

    // --- the two slots must differ ONLY in their filesystem identity.
    const slotFault = bootSlotFault(await listFat(tb, bootA), await listFat(tb, bootB))
    if (slotFault !== undefined) throw new Error(slotFault)

    // --- EPHEMERAL SHIPS ALREADY SEEDED. /var is a mount of this
    // filesystem and mounting an EMPTY one over the image's /var hides the tree
    // the installed packages expect. Copying that tree out on the first boot
    // instead would run at the same moment as every other unit that writes
    // /var: Debian 13's systemd-networkd-persistent-storage.service creates
    // /var/lib/systemd/network as soon as /var appears, the two race, and a
    // failed seed fails var-lib-mos.mount, which fails mosd, apid and the
    // health gate. Seeding here removes the race rather than ordering against
    // one member of it. The stamp goes in too, so
    // mos-seed-var's ConditionPathExists keeps it from running at all on a normal
    // boot; it stays for the path where EPHEMERAL has been wiped.
    //
    // CREATED AND THEN PINNED, IN TWO CALLS, where the shell writes `: >file`
    // and then `touch -h -d`. It is two calls because `touch -h` DOES NOT CREATE
    // -- measured here, not assumed: `-h` makes touch operate on the link rather
    // than its target, so on a path that does not exist it fails with
    //
    //     touch: setting times of '.../.mos-var-seeded': No such file or directory
    //
    // rather than creating an empty file. A first draft of this port collapsed
    // the two into one call and got exactly that, forty steps into an assembly.
    //
    // BOTH RUN IN THE CONTAINER, which is the half that matters: this is the one
    // file in the seed this assembler authors, and it is written into the tree
    // mke2fs reads. pinSeededTimes handles its atime and ctime along with every
    // other seeded inode's; it deliberately does not touch mtime, which is the
    // producer's data everywhere else in the tree and here has no producer but
    // these two lines.
    const stamp = join(factoryVarStage, SEED_STAMP)
    await tb.must(['touch', stamp], { note: `could not create ${stamp}` })
    await tb.must(['touch', '-h', '-d', fileMtime, stamp], { note: `could not pin the mtime of ${stamp}` })
    if (!existsSync(join(factoryVarStage, 'lib'))) {
      throw new Error(
        'the staged factory /var has no lib/; seeding EPHEMERAL from it would produce a /var with no '
        + 'dpkg database and no mosd state directory',
      )
    }

    const ext4 = {
      META: join(workDir, 'meta.img'),
      STATE: join(workDir, 'state.img'),
      EPHEMERAL: join(workDir, 'ephemeral.img'),
      DATA: join(workDir, 'data.img'),
    }
    await makeExt4(tb, geometry, ext4.META, geometry.requireInt('META_SIZE_MIB'), 'META')
    await makeExt4(tb, geometry, ext4.STATE, geometry.requireInt('STATE_SIZE_MIB'), 'STATE')
    await makeExt4(tb, geometry, ext4.EPHEMERAL, geometry.requireInt('MOS_VAR_MIB'), 'EPHEMERAL', factoryVarStage)
    await makeExt4(tb, geometry, ext4.DATA, geometry.requireInt('DATA_SIZE_MIB'), 'DATA')

    // --- the disk.
    const imgTmp = `${inputs.imgOut}.tmp`
    rmSync(imgTmp, { force: true })
    await truncate(tb, imgTmp, String(geometry.mibToBytes(layout.totalSizeMib)))
    const spec = gptSpecFor(geometry, layout)
    await writeGpt(tb, imgTmp, spec)

    // conv=notrunc and NOT sparse, which is os/mkimage-x64.sh's spelling.
    // src/tools/dd.ts declines to normalise the two assemblers here: they agree
    // on the bytes for a target that is already zero, and which one a call passes
    // is that call's decision.
    const conv = ['notrunc']
    const placements: [string, string][] = [
      [espImg, 'ESP'],
      [bootA, 'BOOT_A'],
      [bootB, 'BOOT_B'],
      // The rootfs image is placed TWICE. Unlike cx3576, whose B slot is left a
      // hole, x64 ships both slots populated -- see the boot-slot note above for
      // the same argument about the FAT pair.
      [inputs.rootfsVerityImg, 'ROOTFS_A'],
      [inputs.rootfsVerityImg, 'ROOTFS_B'],
      [ext4.META, 'META'],
      [ext4.STATE, 'STATE'],
      [ext4.EPHEMERAL, 'EPHEMERAL'],
      [ext4.DATA, 'DATA'],
    ]
    for (const [input, partition] of placements) {
      const seekBlocks = starts[partition]
      if (seekBlocks === undefined) throw new Error(`no placement was computed for ${partition}`)
      await dd(tb, { input, output: imgTmp, blockSize: '1M', seekBlocks, conv, quiet: true })
    }

    // BOTH failure shapes -- a nonzero exit AND problem text with exit 0 -- reach
    // the same refusal; src/tools/sgdisk.ts carries the pairing.
    await verifyGpt(tb, imgTmp)

    // --- READ THE TABLE BACK OUT OF THE ASSEMBLED IMAGE. See partitionFaults.
    const got: GptPartitionInfo[] = []
    for (const p of spec.partitions) got.push(await readPartition(tb, imgTmp, p.partnum))
    const faults = partitionFaults(spec, got)
    if (faults.length > 0) throw new Error(faults.join('\n'))

    renameSync(imgTmp, inputs.imgOut)
    log(`assembled ${layout.totalSizeMib} MiB, ${slot.slotMib} MiB per rootfs slot`)
    return {
      image: inputs.imgOut,
      slot,
      layout,
      verity,
      espClusters,
      grubenvBytes,
      partitions: got,
    }
  } finally {
    if (ownToolbox && tb !== undefined) await tb.close()
    if (options.keepWorkDir !== true) rmSync(workDir, { recursive: true, force: true })
  }
}

/**
 * Format one partition's ext4 filesystem into a standalone image file.
 *
 * A seeded filesystem gets the timestamp pass afterwards -- EVERY seeded one, not
 * just today's only one: an unseeded mke2fs invents all four times and
 * E2FSPROGS_FAKE_TIME pins them, but the moment a tree is copied in, two of them
 * come from the host clock.
 *
 * hash_seed is pinned to the filesystem's OWN uuid, so it is derived rather than
 * a fourteenth constant to keep in step. Left to itself mke2fs draws it at random
 * and writes it to sb+0xEC, which moves the superblock on every assembly.
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
  await truncate(tb, image, String(geometry.mibToBytes(sizeMib)))
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
