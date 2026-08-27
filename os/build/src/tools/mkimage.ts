// mkimage (u-boot-tools): the boot script cx3576 loads.
//
// FAILURE SIGNAL. Its exit status.
//
// SOURCE_DATE_EPOCH IS NOT OPTIONAL and it is not a flag -- mkimage reads it
// out of the ENVIRONMENT. os/mkimage-v2.sh's (deleted: PLAN-014) comment: "without it mkimage
// stamps the legacy image header with the current time, which would break the
// byte-identical rebuild contract." So it is a required field here rather than
// something a caller may forget, and the empty string is refused as loudly as
// its absence: `SOURCE_DATE_EPOCH=` is a variable that is set, and mkimage
// treats it as unset.

import type { Toolbox, ToolResult } from '../toolbox.ts'

export interface BootScriptSpec {
  readonly input: string
  readonly output: string
  /** `-n`. os/mkimage-v2.sh (deleted: PLAN-014) passes "mos boot"; it lands in the legacy header. */
  readonly name: string
  /** The bare epoch -- FILE_MTIME without its leading `@`. Geometry.ext4.sourceDateEpoch is it. */
  readonly sourceDateEpoch: string
}

export function bootScriptArgs(spec: BootScriptSpec): string[] {
  // -T script -C none: os/mkimage-v2.sh's (deleted: PLAN-014) shape, and no -A. A boot script is
  // architecture-independent; passing one would put a claim in the header that
  // U-Boot then checks.
  return ['mkimage', '-T', 'script', '-C', 'none', '-n', spec.name, '-d', spec.input, spec.output]
}

/** Compile boot.cmd into boot.scr, reproducibly. */
export async function makeBootScript(tb: Toolbox, spec: BootScriptSpec): Promise<ToolResult> {
  if (!/^[0-9]+$/.test(spec.sourceDateEpoch)) {
    throw new Error(
      `mkimage was given SOURCE_DATE_EPOCH="${spec.sourceDateEpoch}" for ${spec.output}, which is not `
      + `an epoch. mkimage reads that variable out of the environment and falls back to the WALL CLOCK `
      + `when it cannot -- so the failure would be a boot script that rebuilds differently every time, `
      + `and nothing would report it. The board definitions spell it as FILE_MTIME="@<epoch>"; the `
      + `value wanted here is that without the '@'.`,
    )
  }
  return tb.must(bootScriptArgs(spec), {
    env: { SOURCE_DATE_EPOCH: spec.sourceDateEpoch },
    note: `mkimage could not compile ${spec.input} into ${spec.output}`,
  })
}

/** `mkimage -l` -- read the header back, which is how the stamp is checked. */
export async function readImageHeader(tb: Toolbox, path: string): Promise<string> {
  const r = await tb.must(['mkimage', '-l', path], { note: `mkimage could not read the header of ${path}` })
  return `${r.stdout}${r.stderr}`
}
