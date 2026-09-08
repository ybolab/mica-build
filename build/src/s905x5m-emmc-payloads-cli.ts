// Host-side entry point for extracting complete s905x5m eMMC package inputs.

import { extractS905x5mEmmcPayloads } from './s905x5m-emmc-payloads.ts'

const USAGE = `usage: bash build/run.sh --extract-s905x5m-emmc-payloads --image SD_IMAGE --out-dir DIR

Extracts the exact GPT and mos-owned p3..p12 payloads from a completed
s905x5m '-sd-' image. It is a package-input operation only: it opens no block
device and does not invoke a USB burner or sdc_burn.

  --image IMAGE  completed s905x5m SD-only image from --mkimage-s905x5m-sd
  --out-dir DIR   new directory to receive gpt.bin and PARTITION payloads
`

export interface CliOptions {
  readonly image: string
  readonly outDir: string
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let image: string | undefined
  let outDir: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    if (arg === '--image' || arg === '--out-dir') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a path\n\n${USAGE}`)
      if (arg === '--image') image = value
      else outDir = value
      index += 1
      continue
    }
    throw new Error(`unknown argument ${JSON.stringify(arg)}\n\n${USAGE}`)
  }
  if (image === undefined) throw new Error(`--image is required\n\n${USAGE}`)
  if (outDir === undefined) throw new Error(`--out-dir is required\n\n${USAGE}`)
  return { image, outDir }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  const result = await extractS905x5mEmmcPayloads(options.image, options.outDir)
  console.log(
    `extracted ${result.payloads.length} partition payloads and ${result.gptBytes} GPT bytes into ${result.outDir}`,
  )
  console.log('no device, eMMC boot area, eMMC user area, USB burn, or sdc_burn operation was performed')
  return 0
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)))
  }
  catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
