// dd: raw placement.
//
// FAILURE SIGNAL. Its exit status -- and dd is the tool that shows why this
// layer refuses to guess: on SUCCESS, dd writes its summary to STDERR. A
// wrapper that read "stderr is not empty" as failure would fail every correct
// run of it, and a wrapper that read "stderr is empty" as success would pass
// every failed run of debugfs (which is the opposite case, in e2fsprogs.ts).
// Each tool's signal is its own, which is why toolbox.run() interprets nothing.
//
// `status=none` silences that summary, and both assemblers pass it. It is a
// parameter here rather than a default: a silenced dd is harder to debug, and
// the default should not be the quiet one.
//
// WHAT IS NOT HERE: reading bytes back out of an image. os/mkimage-v2.sh does
// `dd ... | od -An -tx1 -N4` to check the loader magic, and there is no reason
// to spend a container on that -- the image is a FILE ON THE HOST, so a caller
// reads it with node:fs, exactly. Routing binary through `docker exec` would
// also mean routing it through a text stream, which is a corruption waiting for
// the first byte that is not valid UTF-8.

import type { Toolbox, ToolResult } from '../toolbox.ts'

export interface DdSpec {
  readonly input: string
  readonly output: string
  /** `bs=`. The assemblers use `512` (cx3576's loader) and `1M` (everything else). */
  readonly blockSize: string
  /** `seek=`, in blocks of blockSize. */
  readonly seekBlocks?: bigint
  /** `skip=`, in blocks of blockSize. */
  readonly skipBlocks?: bigint
  /** `count=`, in blocks of blockSize. */
  readonly countBlocks?: bigint
  /**
   * `conv=`. NOT defaulted, and not normalised across callers: os/mkimage-v2.sh
   * uses `notrunc,sparse` and os/mkimage-x64.sh uses `notrunc`. They agree on
   * the bytes for a target that is already zero -- v2's comment says so -- but
   * which one a call passes is that call's decision, taken where the reason is.
   */
  readonly conv?: readonly string[]
  /** `status=none`. False leaves dd's summary on stderr, which is where it belongs. */
  readonly quiet?: boolean
}

export function ddArgs(spec: DdSpec): string[] {
  if (spec.blockSize === '') throw new Error('dd was given an empty bs=, which it reads as zero')
  if (spec.seekBlocks !== undefined && spec.seekBlocks < 0n) {
    throw new Error(`dd was asked to seek to block ${spec.seekBlocks} of ${spec.output}`)
  }
  if (spec.skipBlocks !== undefined && spec.skipBlocks < 0n) {
    throw new Error(`dd was asked to skip to block ${spec.skipBlocks} of ${spec.input}`)
  }
  if (spec.countBlocks !== undefined && spec.countBlocks <= 0n) {
    // `count=0` copies nothing and exits 0. A caller that computed a zero
    // length has already made its mistake; this is where it stops being silent.
    throw new Error(
      `dd was asked to copy ${spec.countBlocks} blocks from ${spec.input}. It would copy nothing and `
      + `exit 0, which is indistinguishable from having copied what was wanted.`,
    )
  }
  const argv = ['dd', `if=${spec.input}`, `of=${spec.output}`, `bs=${spec.blockSize}`]
  if (spec.skipBlocks !== undefined) argv.push(`skip=${spec.skipBlocks}`)
  if (spec.seekBlocks !== undefined) argv.push(`seek=${spec.seekBlocks}`)
  if (spec.countBlocks !== undefined) argv.push(`count=${spec.countBlocks}`)
  if (spec.conv !== undefined && spec.conv.length > 0) argv.push(`conv=${spec.conv.join(',')}`)
  if (spec.quiet === true) argv.push('status=none')
  return argv
}

/** Place a file into an image at an offset. Throws a ToolError carrying dd's words. */
export async function dd(tb: Toolbox, spec: DdSpec): Promise<ToolResult> {
  return tb.must(ddArgs(spec), { note: `dd could not write ${spec.input} into ${spec.output}` })
}

/**
 * `truncate -s <size>` -- how both assemblers create the file dd writes into.
 *
 * Here rather than in a file of its own because it is the same coreutils
 * toolset and the same one-line shape, and because a sparse file of the right
 * length is half of what "place a partition at an offset" means.
 */
export async function truncate(tb: Toolbox, path: string, size: string): Promise<ToolResult> {
  if (size === '' || size === '0') {
    throw new Error(`truncate was asked to make ${path} ${size || 'an empty'} bytes, which is not an image`)
  }
  return tb.must(['truncate', '-s', size, path], { note: `truncate could not size ${path} to ${size}` })
}
