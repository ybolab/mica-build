import { spawnSync } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { artifactFile, packSupport, type ContentSigning } from './component-build.ts'
import { canonicalJson, componentId, type BootIdentity, type KernelComponent } from './components.ts'
import type { Toolbox } from './toolbox.ts'
import { REPO_ROOT } from './paths.ts'
import { parseBoardEnv } from './verify-package.ts'
import { parseFirmware, type Firmware } from './firmware.ts'
import { Signer } from '../../shared/update-envelope.ts'
import { FIT_BOARDS, fitBoard, validateFitKernel } from './fit-board.ts'

const BOOT_TOOLS = 'ai-agent/mos-boot-tools-amd64'
const FIT_TOOLS = 'ai-agent/mos-fit-tools-amd64'
export const X64_CMDLINE = 'console=ttyS0,115200n8 net.ifnames=0 i6300esb.heartbeat=120 ro dm_verity.require_signatures=1 panic=5 rdinit=/init'
export const CX3576_CMDLINE = FIT_BOARDS.cx3576.cmdline

function docker(args: string[]) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 })
  if (result.status !== 0) throw new Error(`Boot packaging failed: ${result.stderr}`)
  return result.stdout.trim()
}

function packageBoot(mode: 'kernel' | 'firmware' | 'fit', input: string, output: string, signing: ContentSigning, efiArch: 'x64' | 'aa64') {
  docker(['run', '--rm', '--label', 'ai-agent=true', '--network', 'traefik',
    '-v', `${resolve(input)}:/input:ro`, '-v', `${resolve(output)}:/output`,
    '-v', `${resolve(signing.key)}:/signing/key.pem:ro`, '-v', `${resolve(signing.certificate)}:/signing/cert.pem:ro`,
    mode === 'fit' ? FIT_TOOLS : BOOT_TOOLS, 'bash', ...(mode === 'fit' ? ['/tools/fit.sh'] : ['/tools/kernel.sh', mode, efiArch])])
}

export interface KernelInputs {
  board: 'x64' | 'virt-arm64' | 'cx3576' | 's905x5m'
  kernelDirectory: string
  init: string
  publicKeys: string[]
  systemPartUuid: string
  dataPartUuid: string
  output: string
  contentSigning: ContentSigning
  bootSigning: ContentSigning
}

/** The kernel producer never opens a user-space rootfs. */
export async function packKernel(inputs: KernelInputs, tb: Toolbox): Promise<KernelComponent> {
  const { board, kernelDirectory, init, publicKeys, systemPartUuid, dataPartUuid, output, contentSigning, bootSigning } = inputs
  const arch = board === 'x64' ? 'amd64' : 'arm64'
  const efiArch = board === 'x64' ? 'x64' : 'aa64'
  const kernelName = board === 'x64' ? 'bzImage' : 'Image'
  const fit = fitBoard(board)
  const bootFile = fit ? 'boot.itb' : 'boot.efi'
  const cmdline = fit ? fit.cmdline : board === 'x64' ? X64_CMDLINE : X64_CMDLINE.replace('ttyS0', 'ttyAMA0')
  if (existsSync(output)) throw new Error(`Kernel output exists: ${output}`)
  if (publicKeys.length < 1 || publicKeys.length > 8 || publicKeys.some(key => Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key)) throw new Error('Invalid metadata trust set')
  for (const uuid of [systemPartUuid, dataPartUuid]) if (!/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(uuid)) throw new Error('Invalid storage partition UUID')
  const release = readFileSync(join(kernelDirectory, 'kernel.release'), 'utf8').trim()
  const config = readFileSync(join(kernelDirectory, 'config'), 'utf8')
  for (const symbol of ['BLK_DEV_LOOP', 'BLK_DEV_DM', 'DM_VERITY', 'DM_VERITY_VERIFY_ROOTHASH_SIG', 'SYSTEM_TRUSTED_KEYRING', 'EXT4_FS', 'SQUASHFS', 'WATCHDOG_NOWAYOUT',
    ...(fit ? [fit.watchdog, 'CMDLINE_FORCE'] : ['EFI_STUB', 'I6300ESB_WDT'])]) {
    if (!config.split('\n').includes(`CONFIG_${symbol}=y`)) throw new Error(`Kernel is missing built-in ${symbol}`)
  }
  if (!/^CONFIG_SYSTEM_TRUSTED_KEYS="[^"\n]+"$/m.test(config)) throw new Error('Kernel has no embedded content anchor')
  if (fit && !config.split('\n').includes(`CONFIG_CMDLINE="${fit.cmdline}"`)) throw new Error('FIT kernel command policy differs from authenticated packaging')
  if (board === 'cx3576' || board === 's905x5m') {
    const image = readFileSync(join(kernelDirectory, kernelName))
    validateFitKernel(board, image.subarray(0, 64), image.length, artifactFile(join(kernelDirectory, FIT_BOARDS[board].dtb)).bytes)
  }
  mkdirSync(dirname(output), { recursive: true })
  const work = `${output}.building`
  mkdirSync(work)
  try {
    const firmware = fit ? join(work, 'firmware') : undefined
    if (firmware) {
      mkdirSync(firmware)
      const boardEnv = parseBoardEnv(readFileSync(join(REPO_ROOT, 'boards', board, 'board.env'), 'utf8'), 'board.env')
      const files = boardEnv.values.get('BOARD_FIRMWARE_FILES')!.split(' ')
      for (const file of files) {
        if (!/^\/usr\/lib\/firmware\/[a-zA-Z0-9_.-]+$/.test(file)) throw new Error('Invalid board firmware path')
        const name = file.slice('/usr/lib/firmware/'.length)
        const source = join(REPO_ROOT, 'boards', board, 'bsp/rootfs/firmware', name)
        artifactFile(source)
        copyFileSync(source, join(firmware, name))
      }
      const regulatoryTrust = join(kernelDirectory, 'regdb-certs.pem')
      artifactFile(regulatoryTrust)
      docker(['run', '--rm', '--label', 'ai-agent=true', '--network', 'traefik',
        '-v', `${resolve(firmware)}:/output`, '-v', `${resolve(regulatoryTrust)}:/regdb-certs.pem:ro`,
        FIT_TOOLS, 'sh', '/tools/regdb.sh', '/regdb-certs.pem', '/output'])
      copyFileSync(join(REPO_ROOT, 'boards', board, 'bsp/component-copyright'), join(firmware, 'mos-component-copyright'))
    }
    const support = await packSupport(join(kernelDirectory, 'modules.tar'), release, firmware, join(work, 'support'), contentSigning, tb)
    if (firmware) rmSync(firmware, { recursive: true })
    const input = join(work, 'input')
    const boot = join(work, 'boot')
    mkdirSync(input)
    mkdirSync(boot)
    const buildId = componentId({
      board, arch, kernel: artifactFile(join(kernelDirectory, kernelName)), config: artifactFile(join(kernelDirectory, 'config')),
      ...(fit ? { dtb: artifactFile(join(kernelDirectory, fit.dtb)), addresses: fit.addresses } : {}),
      init: artifactFile(init), publicKeys, systemPartUuid, dataPartUuid, supportId: componentId(support), cmdline,
      packager: docker(['image', 'inspect', '--format', '{{.Id}}', fit ? FIT_TOOLS : BOOT_TOOLS]),
      bootCertificate: artifactFile(bootSigning.certificate),
    })
    const identity: BootIdentity = { board, arch, kernelBuildId: buildId, kernelRelease: release, supportId: componentId(support) }
    writeFileSync(join(input, 'boot.json'), canonicalJson({ identity, publicKeys, systemPartUuid, dataPartUuid }))
    writeFileSync(join(input, 'cmdline'), cmdline)
    writeFileSync(join(input, 'os-release'), 'ID=mos\nPRETTY_NAME="MOS"\n')
    copyFileSync(join(kernelDirectory, kernelName), join(input, 'kernel'))
    if (fit) {
      copyFileSync(join(kernelDirectory, fit.dtb), join(input, 'board.dtb'))
      writeFileSync(join(input, 'fit-addresses'), `${fit.addresses.join(' ')}\n`)
    }
    copyFileSync(join(kernelDirectory, 'kernel.release'), join(input, 'kernel.release'))
    copyFileSync(init, join(input, 'mos-init'))
    packageBoot(fit ? 'fit' : 'kernel', input, boot, bootSigning, efiArch)
    const component: KernelComponent = { schema: 'mos/kernel/v1', id: '', board, arch,
      buildId, release, boot: { format: fit ? 'fit' : 'uki', artifact: artifactFile(join(boot, bootFile)) }, support }
    component.id = componentId(component)
    for (const name of readdirSync(join(work, 'support'))) renameSync(join(work, 'support', name), join(work, name))
    for (const name of readdirSync(boot)) renameSync(join(boot, name), join(work, name))
    copyFileSync(join(input, 'boot.json'), join(work, 'boot.json'))
    copyFileSync(join(kernelDirectory, 'config'), join(work, 'config'))
    rmSync(input, { recursive: true })
    rmSync(boot, { recursive: true })
    rmSync(join(work, 'support'), { recursive: true })
    writeFileSync(join(work, 'kernel.json'), canonicalJson(component))
    renameSync(work, output)
    return component
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export type FirmwareInputs = {
  output: string, metadataKey: string, generation: number, version: string
} & ({ board: 'x64' | 'virt-arm64', bootSigning: ContentSigning } | { board: 'cx3576' | 's905x5m', input: string })

/** Firmware maintenance has its own signed artifact, independent of deployments. */
export function packBootFirmware(inputs: FirmwareInputs): Firmware {
  const { output, board } = inputs
  if (existsSync(output)) throw new Error(`Firmware output exists: ${output}`)
  mkdirSync(dirname(output), { recursive: true })
  const work = `${output}.building`
  mkdirSync(work)
  try {
    const filename = board === 's905x5m' ? 'u-boot.bin.signed' : board === 'cx3576' ? 'u-boot-rockchip.bin' : board === 'x64' ? 'BOOTX64.EFI' : 'BOOTAA64.EFI'
    if ('input' in inputs) {
      const artifact = artifactFile(inputs.input)
      if (inputs.board === 'cx3576' && (artifact.bytes > 16744448 || readFileSync(inputs.input).subarray(0, 4).toString('ascii') !== 'RKNS')) throw new Error('Invalid bounded Rockchip loader')
      if (inputs.board === 's905x5m' && (artifact.bytes < 1703936 || artifact.bytes > 4193792)) throw new Error('Invalid bounded Amlogic boot0 payload')
      copyFileSync(inputs.input, join(work, filename))
    } else {
      packageBoot('firmware', work, work, inputs.bootSigning, inputs.board === 'x64' ? 'x64' : 'aa64')
    }
    const value = { schema: 'mos/firmware/v1', id: '', board, arch: board === 'x64' ? 'amd64' : 'arm64',
      generation: inputs.generation, version: inputs.version, artifact: artifactFile(join(work, filename)),
      target: board === 's905x5m' ? { format: 'amlogic-boot0', payloadOffset: 512, maxBytes: 4193792 }
        : board === 'cx3576' ? { format: 'rockchip-loader', diskOffset: 32768, maxBytes: 16744448 }
        : { format: 'efi', partition: 1, path: `EFI/BOOT/${filename}` } }
    value.id = componentId(value)
    const component = parseFirmware(canonicalJson(value))
    const signer = new Signer(createPrivateKey(readFileSync(inputs.metadataKey)), false)
    writeFileSync(join(work, 'firmware.json'), JSON.stringify(signer.sign(JSON.parse(canonicalJson(component)))))
    renameSync(work, output)
    return component
  } finally { rmSync(work, { recursive: true, force: true }) }
}
