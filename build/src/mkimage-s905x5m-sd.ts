// SD-only s905x5m layout-v2 image assembler.
//
// The board still starts the vendor U-Boot from the eMMC hardware boot area.
// Its strict `cfgload sd` path is fixed to mmc 0:1 and refuses to execute a
// boot.ini unless that filesystem also contains a non-empty /Image. The mos
// boot slot is p5, so an otherwise normal layout-v2 image is invisible to that
// path. This assembler formats p1 only in the explicitly SD-only image and puts
// a cfgload bridge there: the real kernel as /Image for the vendor probe, plus
// boot.ini, which loads the kernel and DTB from p5. p5/p6 remain the real mos
// boot slots and their contract is not renumbered or redefined.
//
// This image must never be written to eMMC. On eMMC p1 is the vendor-owned
// 36..100 MiB reserved range and must remain untouched; the dedicated output
// name and CLI make that medium restriction visible at every invocation.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { checkAbBootCmd, verityEnvFor } from './boot-cx3576.ts'
import { loadGeometry, type Geometry } from './geometry.ts'
import {
  decideSlot,
  deriveLayout,
  gptSpecFor,
  type DerivedLayout,
  type SlotDecision,
} from './layout-cx3576.ts'
import { envFileGet } from './mkimage-cx3576.ts'
import { makeWorkDir, REPO_ROOT } from './paths.ts'
import { pinSeededTimes } from './pin-seeded-times.ts'
import { Toolbox } from './toolbox.ts'
import { CX3576_ASSEMBLY } from './toolsets.ts'
import { dd, truncate } from './tools/dd.ts'
import { mke2fs } from './tools/e2fsprogs.ts'
import { listFat, mcopy, mkfsVfat, readFatClusters, FAT32_MIN_CLUSTERS } from './tools/mtools.ts'
import { makeBootScript } from './tools/mkimage.ts'
import { verifyGpt, writeGpt } from './tools/sgdisk.ts'

export const BOARD = 's905x5m'
export const ROOTFS_PRODUCER = 'rootfs/build.sh'
export const SD_BOOT_TEMPLATE = 'boards/s905x5m/boot-sd.ini.in'
export const SD_IMAGE_MARKER = '-sd-'

const CFGLOAD_PARTITION = 'RESERVED'
const CFGLOAD_FAT_LABEL = 'MOS-CFG'
const CFGLOAD_FAT_VOLUME_ID = '59050001'
const CFGLOAD_FILES = ['Image', 'boot.ini'] as const
const BOOT_DTB = 's7d_s905x5m_m100.dtb'

export interface SdAssemblyInputs {
  readonly kernelImage: string
  readonly dtb: string
  readonly rootfsVerityImg: string
  readonly rootfsVerityEnv: string
  readonly bootCmdlineA: string
  readonly bootCmdlineB: string
  readonly factoryVar: string
  readonly bootIniTemplate: string
  /** Optional test seam; normal assembly resolves BOARD_CMD_SOURCE. */
  readonly bootCmd?: string
  readonly imgOut: string
}

export interface SdAssembleOptions {
  readonly toolbox?: Toolbox
  readonly slotPin?: string | undefined
  readonly geometry?: Geometry
  readonly log?: (line: string) => void
}

export interface SdAssembleResult {
  readonly image: string
  readonly slot: SlotDecision
  readonly layout: DerivedLayout
  readonly rootHash: string
  readonly cfgloadFiles: readonly string[]
}

function requireFile(path: string, what: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${path} not found; ${what}`)
}

function boardBootCmdPath(geometry: Geometry): string {
  const source = geometry.require('BOOT_CMD_SOURCE')
  const path = resolve(REPO_ROOT, source)
  if (path === REPO_ROOT || !path.startsWith(`${REPO_ROOT}/`)) {
    throw new Error(`${geometry.path} sets BOOT_CMD_SOURCE=${JSON.stringify(source)} outside the repository`)
  }
  return path
}

function bootCmdPath(inputs: SdAssemblyInputs, geometry: Geometry): string {
  return inputs.bootCmd === undefined ? boardBootCmdPath(geometry) : resolve(inputs.bootCmd)
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/** Escape one generated kernel command line inside a U-Boot double-quoted word. */
export function escapeUbootDoubleQuoted(value: string): string {
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error('the kernel command line for boot.ini must be exactly one non-NUL line')
  }
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`')
}

/** Render one slot-specific cfgload script from the committed SD template. */
export function renderBootIni(options: {
  readonly template: string
  readonly cmdline: string
  readonly bootPartnum: bigint
  readonly slot: 'A' | 'B'
}): string {
  const magic = 'ODROIDC5-UBOOT-CONFIG\n'
  if (!options.template.startsWith(magic)) {
    throw new Error(`${SD_BOOT_TEMPLATE} does not start with ${magic.trim()}; vendor cfgload would refuse it`)
  }
  if (options.bootPartnum <= 0n) throw new Error(`boot.ini was given partition ${options.bootPartnum}`)

  const tokens = ['@MOS_BOOTARGS@', '@MOS_BOOT_PARTNUM@', '@MOS_SLOT@'] as const
  for (const token of tokens) {
    const seen = count(options.template, token)
    if (seen !== 1) {
      throw new Error(`${SD_BOOT_TEMPLATE} contains ${seen} ${token} tokens; it must contain exactly one`)
    }
  }

  const cmdline = options.cmdline.trim()
  if (cmdline === '') throw new Error('the kernel command line for boot.ini is empty')
  let rendered = options.template
    .replace('@MOS_BOOTARGS@', escapeUbootDoubleQuoted(cmdline))
    .replace('@MOS_BOOT_PARTNUM@', String(options.bootPartnum))
    .replace('@MOS_SLOT@', options.slot)
  if (!rendered.endsWith('\n')) rendered += '\n'
  if (Buffer.byteLength(rendered) > 64 * 1024) {
    throw new Error(`rendered boot.ini is ${Buffer.byteLength(rendered)} bytes; vendor cfgload caps it at 65536`)
  }
  for (const token of tokens) {
    if (rendered.includes(token)) throw new Error(`rendered boot.ini still contains ${token}`)
  }
  return rendered
}

/** Identity mounts for every host path the assembly toolbox may touch. */
export function mountsForSd(inputs: SdAssemblyInputs, workDir: string): string[] {
  const dirs = new Set<string>([REPO_ROOT, workDir, dirname(resolve(inputs.imgOut))])
  for (const path of [
    inputs.kernelImage,
    inputs.dtb,
    inputs.rootfsVerityImg,
    inputs.rootfsVerityEnv,
    inputs.bootCmdlineA,
    inputs.bootCmdlineB,
    inputs.factoryVar,
    inputs.bootIniTemplate,
    ...(inputs.bootCmd === undefined ? [] : [inputs.bootCmd]),
  ]) dirs.add(dirname(resolve(path)))
  const all = [...dirs].sort()
  return all.filter(d => !all.some(other => other !== d && d.startsWith(`${other}/`)))
}

/** Build the explicitly SD-only image. */
export async function assembleS905x5mSd(
  inputs: SdAssemblyInputs,
  options: SdAssembleOptions = {},
): Promise<SdAssembleResult> {
  const log = options.log ?? ((line: string) => console.log(line))
  const geometry = options.geometry ?? loadGeometry(BOARD)
  if (geometry.faults.length > 0) {
    throw new Error(
      `${geometry.path} has ${geometry.faults.length} unusable value(s):\n`
      + geometry.faults.map(f => `  ${f.key}=${JSON.stringify(f.value)} ${f.reason}`).join('\n'),
    )
  }
  if (!basename(inputs.imgOut).includes(SD_IMAGE_MARKER)) {
    throw new Error(
      `${inputs.imgOut} has no '${SD_IMAGE_MARKER}' marker. This assembler formats the vendor-reserved `
      + `p1 as a cfgload bridge and its output name must say that it is SD-only.`,
    )
  }

  const bootCmd = bootCmdPath(inputs, geometry)
  requireFile(bootCmd, `it is the committed ${BOARD} production boot command`)
  checkAbBootCmd(geometry, readFileSync(bootCmd, 'utf8'), bootCmd)
  const bootScriptName = geometry.require('BOOT_SCRIPT_NAME')
  if (basename(bootScriptName) !== bootScriptName) {
    throw new Error(`${geometry.path} sets BOOT_SCRIPT_NAME=${JSON.stringify(bootScriptName)}, not a file name`)
  }

  const workDir = makeWorkDir(`mkimage-${BOARD}-sd`)
  const ownToolbox = options.toolbox === undefined
  const tb = options.toolbox ?? await Toolbox.open(CX3576_ASSEMBLY, {
    mounts: mountsForSd(inputs, workDir),
    announce: log,
  })

  try {
    if (!existsSync(inputs.factoryVar) || !statSync(inputs.factoryVar).isDirectory()) {
      throw new Error(
        `FACTORY_VAR=${inputs.factoryVar || '<unset>'} is not a directory. Run `
        + `'MOS_BOARD=${BOARD} bash ${ROOTFS_PRODUCER}' first`,
      )
    }
    for (const input of [inputs.kernelImage, inputs.dtb]) requireFile(input, 'it is a BSP artifact')
    for (const input of [
      inputs.rootfsVerityImg,
      inputs.rootfsVerityEnv,
      inputs.bootCmdlineA,
      inputs.bootCmdlineB,
    ]) requireFile(input, `produce it with 'MOS_BOARD=${BOARD} bash ${ROOTFS_PRODUCER}'`)
    requireFile(inputs.bootIniTemplate, `it is the committed ${BOARD} SD cfgload template`)

    const bootScr = join(workDir, bootScriptName)
    await makeBootScript(tb, {
      input: bootCmd,
      output: bootScr,
      name: 'mos boot',
      sourceDateEpoch: geometry.ext4.sourceDateEpoch,
    })

    const factoryVarStage = join(workDir, 'factory-var')
    mkdirSync(factoryVarStage, { recursive: true })
    await tb.must(['cp', '-a', `${inputs.factoryVar}/.`, `${factoryVarStage}/`], {
      note: `could not stage the factory /var tree from ${inputs.factoryVar}`,
    })

    const verityBytes = BigInt(statSync(inputs.rootfsVerityImg).size)
    if (verityBytes === 0n || verityBytes % geometry.mibBytes !== 0n) {
      throw new Error(
        `${inputs.rootfsVerityImg} is ${verityBytes} bytes, not a non-zero whole-MiB multiple; `
        + `fix ${ROOTFS_PRODUCER}`,
      )
    }
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

    const slot = decideSlot(
      geometry,
      verityBytes / geometry.mibBytes,
      options.slotPin,
      inputs.rootfsVerityImg,
    )
    const layout = deriveLayout(geometry, slot.slotMib)
    log(slot.summary)
    log('SD-only: vendor U-Boot stays in eMMC boot0; no bootloader or eMMC partition is in this image')
    log(`verity root hash ${rootHash}`)

    const template = readFileSync(inputs.bootIniTemplate, 'utf8')
    const bootIniA = renderBootIni({
      template,
      cmdline: readFileSync(inputs.bootCmdlineA, 'utf8'),
      bootPartnum: geometry.requirePartition('BOOT_A').requireInt('PARTNUM'),
      slot: 'A',
    })
    const bootA = join(workDir, 'boot-a.img')
    const bootB = join(workDir, 'boot-b.img')
    await makeBootSlot(tb, geometry, {
      workDir,
      image: bootA,
      partition: 'BOOT_A',
      slot: 'A',
      cmdlinePath: inputs.bootCmdlineA,
      rootfs: 'ROOTFS_A',
      verityEnvKey: 'BOOT_VERITY_ENV_A_NAME',
      kernelImage: inputs.kernelImage,
      dtb: inputs.dtb,
      rootHash,
      bootScript: bootScr,
      bootScriptName,
    })
    await makeBootSlot(tb, geometry, {
      workDir,
      image: bootB,
      partition: 'BOOT_B',
      slot: 'B',
      cmdlinePath: inputs.bootCmdlineB,
      rootfs: 'ROOTFS_B',
      verityEnvKey: 'BOOT_VERITY_ENV_B_NAME',
      kernelImage: inputs.kernelImage,
      dtb: inputs.dtb,
      rootHash,
      bootScript: bootScr,
      bootScriptName,
    })

    // mmc 0:1 is not the mos boot slot. This bridge exists only because the
    // vendor command validates that exact partition before executing boot.ini.
    // The full kernel is copied rather than a fake byte: /Image remains an
    // honest kernel image even though the script deliberately loads p5's copy.
    const cfgload = join(workDir, 'cfgload-p1.img')
    await makeCfgloadBridge(tb, geometry, {
      workDir,
      image: cfgload,
      kernelImage: inputs.kernelImage,
      bootIni: bootIniA,
    })

    const metaImg = join(workDir, 'meta.img')
    const stateImg = join(workDir, 'state.img')
    const ephemeralImg = join(workDir, 'ephemeral.img')
    const dataImg = join(workDir, 'data.img')
    await makeExt4(tb, geometry, metaImg, geometry.requireInt('META_SIZE_MIB'), 'META')
    await makeExt4(tb, geometry, stateImg, geometry.requireInt('STATE_SIZE_MIB'), 'STATE')

    const stamp = join(factoryVarStage, '.mos-var-seeded')
    writeFileSync(stamp, '')
    await tb.must(['touch', '-h', '-d', geometry.ext4.fileMtime, stamp], {
      note: `could not pin the mtime of ${stamp}`,
    })
    if (!existsSync(join(factoryVarStage, 'lib'))) {
      throw new Error(
        'the staged factory /var has no lib/; EPHEMERAL would have no dpkg database or mosd state',
      )
    }
    await makeExt4(
      tb,
      geometry,
      ephemeralImg,
      geometry.requireInt('MOS_VAR_MIB'),
      'EPHEMERAL',
      factoryVarStage,
    )
    await makeExt4(tb, geometry, dataImg, geometry.requireInt('DATA_SIZE_MIB'), 'DATA')

    const imgTmp = `${inputs.imgOut}.tmp`
    rmSync(imgTmp, { force: true })
    await truncate(tb, imgTmp, `${layout.totalSizeMib}M`)
    await writeGpt(tb, imgTmp, gptSpecFor(geometry, layout))

    // ENV, uenv-a/uenv-b and rootfs-b stay holes. No byte in this path targets
    // eMMC: these are offsets inside the regular file that will later be
    // written to a separately identified SD card.
    const conv = ['notrunc', 'sparse']
    const placements: [string, bigint][] = [
      [cfgload, requireStartMib(geometry, CFGLOAD_PARTITION)],
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
    log(await verifyGpt(tb, imgTmp))
    renameSync(imgTmp, inputs.imgOut)
    return { image: inputs.imgOut, slot, layout, rootHash, cfgloadFiles: CFGLOAD_FILES }
  }
  finally {
    if (ownToolbox) await tb.close()
    rmSync(workDir, { recursive: true, force: true })
  }
}

interface BootSlotSpec {
  readonly workDir: string
  readonly image: string
  readonly partition: 'BOOT_A' | 'BOOT_B'
  readonly slot: 'A' | 'B'
  readonly cmdlinePath: string
  readonly rootfs: 'ROOTFS_A' | 'ROOTFS_B'
  readonly verityEnvKey: 'BOOT_VERITY_ENV_A_NAME' | 'BOOT_VERITY_ENV_B_NAME'
  readonly kernelImage: string
  readonly dtb: string
  readonly rootHash: string
  readonly bootScript: string
  readonly bootScriptName: string
}

async function makeBootSlot(tb: Toolbox, geometry: Geometry, spec: BootSlotSpec): Promise<void> {
  const p = geometry.requirePartition(spec.partition)
  const stage = join(spec.workDir, `stage-${p.require('FAT_VOLUME_ID')}`)
  mkdirSync(stage, { recursive: true })
  copyFileSync(spec.kernelImage, join(stage, 'Image'))
  copyFileSync(spec.dtb, join(stage, BOOT_DTB))
  copyFileSync(spec.bootScript, join(stage, spec.bootScriptName))

  const verityEnvName = geometry.require(spec.verityEnvKey)
  const verity = verityEnvFor({
    cmdline: readFileSync(spec.cmdlinePath, 'utf8'),
    cmdlinePath: spec.cmdlinePath,
    slot: spec.slot,
    rootfsGuid: geometry.requirePartition(spec.rootfs).require('GUID'),
    rootHash: spec.rootHash,
    producer: ROOTFS_PRODUCER,
  })
  writeFileSync(join(stage, verityEnvName), verity.text)
  await makeFat(tb, geometry, {
    stage,
    image: spec.image,
    sizeMib: geometry.requireInt('BOOT_SIZE_MIB'),
    label: p.require('FAT_LABEL'),
    volumeId: p.require('FAT_VOLUME_ID'),
  })
}

async function makeCfgloadBridge(
  tb: Toolbox,
  geometry: Geometry,
  spec: { workDir: string, image: string, kernelImage: string, bootIni: string },
): Promise<void> {
  const p = geometry.requirePartition(CFGLOAD_PARTITION)
  const size = p.size?.mib
  if (size === undefined) throw new Error(`${geometry.path} gives ${CFGLOAD_PARTITION} no whole-MiB size`)
  const stage = join(spec.workDir, 'stage-cfgload-p1')
  mkdirSync(stage, { recursive: true })
  copyFileSync(spec.kernelImage, join(stage, 'Image'))
  writeFileSync(join(stage, 'boot.ini'), spec.bootIni)
  await makeFat(tb, geometry, {
    stage,
    image: spec.image,
    sizeMib: size,
    label: CFGLOAD_FAT_LABEL,
    volumeId: CFGLOAD_FAT_VOLUME_ID,
  })
  const got = (await listFat(tb, spec.image)).map(path => basename(path)).sort()
  if (got.join('\n') !== [...CFGLOAD_FILES].sort().join('\n')) {
    throw new Error(`cfgload p1 contains ${got.join(', ') || 'nothing'}, expected ${CFGLOAD_FILES.join(', ')}`)
  }
}

async function makeFat(
  tb: Toolbox,
  geometry: Geometry,
  spec: { stage: string, image: string, sizeMib: bigint, label: string, volumeId: string },
): Promise<void> {
  await tb.must(['find', spec.stage, '-exec', 'touch', '-h', '-d', geometry.ext4.fileMtime, '{}', '+'], {
    note: `could not pin the files staged for ${spec.image}`,
  })
  await truncate(tb, spec.image, `${spec.sizeMib}M`)
  await mkfsVfat(tb, { image: spec.image, label: spec.label, volumeId: spec.volumeId })
  const clusters = await readFatClusters(tb, spec.image)
  if (clusters < FAT32_MIN_CLUSTERS) {
    throw new Error(
      `${spec.image} has ${clusters} free clusters, below the FAT32 floor ${FAT32_MIN_CLUSTERS}`,
    )
  }
  const files = readdirSync(spec.stage)
    .map(name => join(spec.stage, name))
    .sort((a, b) => basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0)
  await mcopy(tb, { image: spec.image, sources: files, destination: '::/', recursive: true })
}

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

function requireStartMib(geometry: Geometry, name: string): bigint {
  const start = geometry.requirePartition(name).start
  if (start?.mib === undefined) {
    throw new Error(`${geometry.path} does not place ${name} on a whole-MiB boundary`)
  }
  return start.mib
}
