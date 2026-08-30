// rauc: the update bundle.
//
// Failure signal: the exit status, plus one refusal that comes before rauc runs
// at all. The rauc that builds a bundle MUST be the rauc that installs it: a
// bundle built in a bookworm container (rauc 1.8) for an image running Debian
// 13's 1.13 fails -- "1.8 refused the x64 slot model outright the first time it
// was asked to read it. A format difference would not have announced itself so
// kindly." Both halves come from os/pkgs/rauc/, built from a pinned source,
// and the bundle contract compares the version it runs against the one the
// rootfs report recorded before writing anything. So bundle() refuses a toolset
// whose rauc came from a distribution package, by name, before any bytes exist;
// info() is allowed on either, which is how this wrapper is exercised where no
// self-built binary exists. The manifest, staging tree, placeholder rendering
// and version cross-check are the bundle contract's, not this file's.

import type { Toolbox, ToolResult } from '../toolbox.ts'
import { ToolError } from '../toolbox.ts'
import type { RaucProvenance } from '../toolsets.ts'

/**
 * Any toolbox. The provenance is read off its toolset, and a toolset that
 * declares none is refused for writing -- an unrecorded origin is not a pass.
 */
export type RaucToolbox = Toolbox

function provenanceOf(tb: RaucToolbox): RaucProvenance | undefined {
  return tb.toolset.provenance
}

/** `rauc --version`, as one line. */
export async function version(tb: RaucToolbox): Promise<string> {
  const r = await tb.must(['rauc', '--version'], { note: 'rauc could not report its version' })
  const line = `${r.stdout}${r.stderr}`.split('\n').map(l => l.trim()).find(l => l !== '')
  if (line === undefined) {
    throw new ToolError(
      r,
      `rauc --version exited 0 and printed nothing. The version is one half of the comparison that `
      + `keeps a bundle installable by the rauc on the device (commit 9a43a59), and a comparison `
      + `against an empty string passes by finding nothing`,
    )
  }
  return line
}

export interface BundleSpec {
  /** The staged directory: manifest.raucm plus the images it names. */
  readonly stageDir: string
  readonly output: string
  readonly cert: string
  readonly key: string
  /**
   * `--mksquashfs-args`. rauc drives mksquashfs itself, and without these it
   * stamps the payload with the wall clock, the build container's uid map and a
   * thread count. The bundle contract passes exactly this shape.
   */
  readonly mksquashfsArgs?: string
}

export function bundleArgs(spec: BundleSpec): string[] {
  const argv = ['rauc', 'bundle']
  if (spec.mksquashfsArgs !== undefined) argv.push(`--mksquashfs-args=${spec.mksquashfsArgs}`)
  argv.push(`--cert=${spec.cert}`, `--key=${spec.key}`, spec.stageDir, spec.output)
  return argv
}

/**
 * Write a signed bundle.
 *
 * @throws Error, before running anything, when the toolbox's rauc is not one
 *   this tree built. See the header.
 */
export async function bundle(tb: RaucToolbox, spec: BundleSpec): Promise<ToolResult> {
  const provenance = provenanceOf(tb)
  if (provenance !== 'shipped') {
    throw new Error(
      `${spec.output} would be written by the ${tb.toolset.key} toolset, whose rauc is `
      + `${provenance === undefined ? 'of unrecorded origin' : `the base image's ${provenance} package`}. `
      + `A bundle is written by one rauc and installed by another on the device, and nothing about the `
      + `format makes them compatible by accident: commit 9a43a59 records a bundle built by rauc 1.8 `
      + `that the device's 1.13 refused, found by failure rather than by a check. The bundle toolset `
      + `carries the binary os/pkgs/rauc/build.sh produced from the version pinned in `
      + `os/pkgs/rauc/versions.env; build it with \`make os-rauc\`.`,
    )
  }
  return tb.must(bundleArgs(spec), { note: `rauc could not build the bundle ${spec.output}` })
}

export interface InfoSpec {
  readonly bundle: string
  /**
   * `--keyring`.
   *
   * Optional in this type and NOT optional to rauc: measured against rauc 1.13,
   * `rauc info` with no keyring exits 1 with "No keyring file or directory
   * provided" rather than reading the bundle unverified. It stays optional here
   * only so that behaviour can be demonstrated from a test; every real caller
   * passes one, and the bundle contract's verify_bundle does.
   */
  readonly keyring?: string
  /** `--conf`. The bundle contract loads the system.conf the image ships. */
  readonly conf?: string
}

export function infoArgs(spec: InfoSpec): string[] {
  const argv = ['rauc']
  // --conf is a GLOBAL option and has to precede the subcommand; after it, rauc
  // reads it as an argument to `info` and fails in a way that names the bundle.
  if (spec.conf !== undefined) argv.push(`--conf=${spec.conf}`)
  argv.push('info', '--output-format=json')
  if (spec.keyring !== undefined) argv.push(`--keyring=${spec.keyring}`)
  argv.push(spec.bundle)
  return argv
}

/**
 * Read a bundle back, as parsed JSON.
 *
 * Allowed on any provenance: this reads, it does not produce. Reading a bundle
 * back through rauc with signature verification on is how the bundle contract
 * proves what it wrote is installable.
 */
export async function info(tb: RaucToolbox, spec: InfoSpec): Promise<Record<string, unknown>> {
  const r = await tb.must(infoArgs(spec), { note: `rauc could not read ${spec.bundle}` })
  try {
    const parsed: unknown = JSON.parse(r.stdout)
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch (e) {
    throw new ToolError(
      r,
      `rauc info --output-format=json exited 0 over ${spec.bundle} and did not print JSON `
      + `(${(e as Error).message}). Every field the bundle contract checks -- compatible, version -- `
      + `is read out of this, and jq over unparseable input yields null, which compares unequal to `
      + `everything and reports the wrong thing`,
    )
  }
}
