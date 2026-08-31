// The extraction workspace one verify run reads the image into.
//
// `_out/verify/<board>` holds everything a run pulls out of the image: the
// partition payloads, the files copied out of the boot FATs, the unpacked
// read-only root. It OUTLIVES the run, and several of its readers short-circuit
// on the destination already being there -- `slotCopy` in checks-bootchain.ts
// hands back the copy it finds without running mcopy at all, and `fatText` and
// `bootScriptText` in checks-cmdline.ts do the same. Those names are the SLOT's
// (`slot-cmdline-a.cfg`, `boot-a-<dtb>`), not the content's, so nothing about
// them changes when the image does.
//
// That is sound within a run and false across one. Build an image, verify it,
// rebuild it, verify again at the same --work: the second run re-reads the GPT
// and re-extracts every partition -- extractRange always reopens its
// destination with 'w' -- and then reads the FIRST image's cmdline fragment,
// because the file is already at the name it would have written. The verdict is
// about an image the run never looked at, and it is a FAIL rather than a
// silence: `verity-hash-vs-built` compares the root hash on BOOT-A's command
// line against `_out/<board>/rootfs-verity.env`, which the rebuild DID update,
// so the run reports the new image's boot chain as carrying the old release's
// root hash. workspace.test.ts drives exactly that.
//
// Fixed by re-extracting unconditionally -- the directory is emptied here,
// before anything reads the image -- and not by recording the workspace's
// provenance and refusing one older than the image. Re-extraction is not
// expensive enough to justify a refusal an operator then has to act on: the
// partition payloads are re-extracted on every run already, so what emptying
// this directory adds to a REPEAT run of the same image is one unsquashfs of a
// zstd archive, beside the several hundred MiB of extraction that run does
// regardless. Keeping the reuse and hoping is what produced the false FAIL.
//
// Emptied, not deleted-and-forgotten, and scoped to `<workRoot>/<board>`: that
// subdirectory is one this tool creates and names, whereas `--work` itself is a
// path a caller chose and may keep other boards' workspaces -- or other things
// entirely -- in.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** `<workRoot>/<board>`, empty: where one verify run extracts the image into. */
export function prepareWorkDir(workRoot: string, board: string): string {
  const workDir = join(workRoot, board)
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  return workDir
}
