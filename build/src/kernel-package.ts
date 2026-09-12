import { spawnSync } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

/** Static PIE may have relocations, but never a loader or a needed library. */
function staticLifecycle(bytes: Buffer, role: 'startup' | 'shutdown') {
  const refuse = () => { throw new Error(`Invalid static ${role} ELF`) }
  const bounded = (value: bigint) => { if (value > BigInt(bytes.length)) refuse(); return Number(value) }
  const start = bounded(bytes.readBigUInt64LE(32)), count = bytes.readUInt16LE(56)
  if (count < 1 || count > 128 || bytes.readUInt16LE(54) !== 56 || start < 64 || start + count * 56 > bytes.length) refuse()
  let loads = 0, dynamic = false
  for (let n = 0; n < count; n++) {
    const at = start + n * 56, kind = bytes.readUInt32LE(at)
    const offset = bounded(bytes.readBigUInt64LE(at + 8)), size = bounded(bytes.readBigUInt64LE(at + 32))
    if (offset + size > bytes.length || kind === 3) refuse()
    if (kind === 1) loads++
    if (kind === 2) {
      if (dynamic || size < 16 || size > 65536 || size % 16 !== 0) refuse()
      dynamic = true
      let terminated = false
      for (let entry = offset; entry < offset + size; entry += 16) {
        const tag = bytes.readBigUInt64LE(entry)
        if (tag === 0n) { terminated = true; break }
        if (tag === 1n || tag === 15n || tag === 29n) refuse()
      }
      if (!terminated) refuse()
    }
  }
  if (loads === 0) refuse()
}

/** Required native executables are part of the authenticated kernel identity. */
export function kernelExecutables(init: string, shutdown: string, arch: 'amd64' | 'arm64') {
  const inspect = (path: string, role: 'startup' | 'shutdown') => {
    if (typeof path !== 'string' || !path) throw new Error('Missing required native lifecycle input')
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size < 64 || stat.size > 32 * 1024 * 1024 || (stat.mode & 0o7022) !== 0 || (stat.mode & 0o500) !== 0o500) throw new Error('Invalid native lifecycle file or permissions')
    const bytes = readFileSync(path)
    if (!bytes.subarray(0, 7).equals(Buffer.from([0x7f, 69, 76, 70, 2, 1, 1])) || ![2, 3].includes(bytes.readUInt16LE(16)) || bytes.readUInt32LE(20) !== 1 || bytes.readUInt16LE(52) !== 64) throw new Error('Invalid native lifecycle ELF')
    if (bytes.readUInt16LE(18) !== (arch === 'amd64' ? 62 : 183)) throw new Error('Native lifecycle architecture mismatch')
    staticLifecycle(bytes, role)
    return artifactFile(path)
  }
  return { init: inspect(init, 'startup'), shutdown: inspect(shutdown, 'shutdown') }
}

export interface KernelInputs {
  board: 'x64' | 'virt-arm64' | 'cx3576' | 's905x5m'
  kernelDirectory: string
  init: string
  shutdown: string
  publicKeys: string[]
  systemPartUuid: string
  dataPartUuid: string
  output: string
  contentSigning: ContentSigning
  bootSigning: ContentSigning
}

/** The kernel producer never opens a user-space rootfs. */
export async function packKernel(inputs: KernelInputs, tb: Toolbox): Promise<KernelComponent> {
  const { board, kernelDirectory, init, shutdown, publicKeys, systemPartUuid, dataPartUuid, output, contentSigning, bootSigning } = inputs
  const arch = board === 'x64' ? 'amd64' : 'arm64'
  const executables = kernelExecutables(init, shutdown, arch)
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
  for (const symbol of ['RD_ZSTD', 'BLK_DEV_LOOP', 'BLK_DEV_DM', 'DM_VERITY', 'DM_VERITY_VERIFY_ROOTHASH_SIG', 'SYSTEM_TRUSTED_KEYRING', 'EXT4_FS', 'SQUASHFS', 'WATCHDOG_NOWAYOUT',
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
      ...executables, publicKeys, systemPartUuid, dataPartUuid, supportId: componentId(support), cmdline,
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
    copyFileSync(shutdown, join(input, 'mos-shutdown'))
    if (canonicalJson(kernelExecutables(join(input, 'mos-init'), join(input, 'mos-shutdown'), arch)) !== canonicalJson(executables)) throw new Error('Native lifecycle inputs changed during packaging')
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
