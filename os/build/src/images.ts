// An os/build-env/images.env key -> the image reference it names.
//
// THIS FILE PARSES NOTHING. os/build-env/from.sh is the tree's one resolver:
// it reads images.env, refuses a key that is missing, a value still PENDING, a
// value that is a TAG rather than a digest, and a reference that is not well
// formed -- each with a sentence naming the key and the file. R6 removed the
// last floating tag from the shipping path by routing eighteen call sites
// through it, and a second reader of that file here would be the nineteenth
// place for the pin to be wrong.
//
// So this is a subprocess, not a parser. What it adds over the bare call is
// the two failures a caller of `docker run` would otherwise absorb silently:
// an empty answer, and a from.sh that could not be found at all.

import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { FROM_SH } from './paths.ts'

/** Resolved references, by key. from.sh is a bash process; a toolbox opens more than once. */
const cache = new Map<string, string>()

/**
 * The image reference `key` names in os/build-env/images.env.
 *
 * @throws Error carrying from.sh's own refusal, which names the key and the file.
 */
export async function resolveImage(key: string): Promise<string> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  // Checked rather than left to bash. `bash /gone/from.sh --ref IMAGE_BUN_1`
  // fails with "No such file or directory" and the only proper noun in that
  // sentence is the path -- which a reader who asked for an image KEY reads as
  // a statement about the key.
  if (!existsSync(FROM_SH)) {
    throw new Error(
      `${FROM_SH} does not exist, so no images.env key can be resolved -- including ${key}. `
      + `src/paths.ts anchors this path; either os/build-env/ moved or that anchor did.`,
    )
  }

  const r = await $`bash ${FROM_SH} --ref ${key}`.nothrow().quiet()
  if (r.exitCode !== 0) {
    throw new Error(
      `os/build-env/from.sh refused ${key} (exit ${r.exitCode}):\n${r.stderr.toString().trimEnd()}`,
    )
  }

  const ref = r.stdout.toString().trim()
  // AN EMPTY ANSWER IS THE ONE FAILURE THAT DOES NOT LOOK LIKE ONE. `docker run
  // ${ref} sh -c ...` with an empty ref does not report a missing image: it
  // reads `sh` as the image name and `-c` as the command, and fails several
  // sentences away from the cause. from.sh has its own guards against printing
  // nothing; this is the caller refusing to build a command line out of it.
  if (ref === '') {
    throw new Error(
      `os/build-env/from.sh exited 0 for ${key} and printed nothing. An empty reference substituted `
      + `into a docker command line is not a missing image -- docker reads the next word as the `
      + `image name -- so it is refused here, where the key is still in hand.`,
    )
  }

  cache.set(key, ref)
  return ref
}

/** Drop the memo. Only a test that mutates images.env has any reason to. */
export function forgetResolvedImages(): void {
  cache.clear()
}
