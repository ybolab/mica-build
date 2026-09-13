// Where a self-built artifact's recorded version is read from, and nothing else.
//
// The version loop is closed here -- bumping a `versions.env` pin without
// rebuilding the artifact turns the smoke run red -- and a loop is only closed
// if the two ends are the same file. So every function reads a pin out of the
// file that owns it, at run time, and there is deliberately no literal version
// string anywhere in verify/.
//
// The second list is the failure mode this file exists to avoid: `TOOL_PACKAGES`
// pinned from a copy of an `apk add` line, a hardcoded hwinit list that drifted
// and cost the image its stable MAC, a `SHIPPED_BOARDS = ['cx3576', 'x64']`
// literal that made a third board invisible to a lint reporting 26/26 PASS.
// Every one was green while being wrong, because a copy agrees with itself.
//
// No parser is written here either. `versions.env` is `KEY=value` with comments,
// exactly what `board-env.ts` already reads as data rather than by sourcing it,
// and that parser refuses command substitution, backticks, parameter expansion
// and unquoted metacharacters by name. A second `sed -n 's/^KEY=//p'` would be a
// second set of semantics for one file format, agreeing right up until a value
// acquired a quote.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBoardEnv } from './board-env.ts'
import { REPO_ROOT } from './paths.ts'

/**
 * The container engine's pins -- podman, quadlet, crun, conmon, netavark,
 * aardvark-dns, catatonit. The engine is built by ybolab/mica-podman and
 * imported through deps/packages/mica-podman.json; this file is the copy of
 * the archive's /usr/share/mica-podman/versions.env that tools/podman-pool.sh
 * writes beside the pin and `make os-pool` holds equal to it.
 */
export const PODMAN_VERSIONS_ENV: string = join(REPO_ROOT, 'deps', 'packages', 'mica-podman.versions.env')


/** Every `versions.env` a pin is read out of, so coverage can be asserted over all of them. */
export const VERSIONS_ENV_FILES: readonly string[] = [PODMAN_VERSIONS_ENV]

/**
 * The suffix that makes a key a version pin.
 *
 * Both files carry `*_VERSION` and `*_SHA256` in pairs, and only the first half
 * is a version. Stated as a constant because `pinKeys` and its test both need
 * to mean the same thing by "is a pin".
 */
export const VERSION_KEY_SUFFIX = '_VERSION'

/** A recorded version, and the file and key it was read out of. */
export interface Pin {
  /** Exactly as the file writes it -- `v5.8.6`, `1.29.1`, `0.1.0`. */
  readonly recorded: string
  /** What a binary is expected to REPORT: `recorded` with a leading `v` removed. */
  readonly expected: string
  /** Absolute path of the file that owns it. */
  readonly file: string
  /** `PODMAN_VERSION`, or `package.version` for a crate. */
  readonly key: string
}

/**
 * Strip the `v` that a git TAG carries and a `--version` output does not.
 *
 * Measured, not assumed, and the two spellings live side by side in ONE file:
 * `mica-podman:versions.env` writes `PODMAN_VERSION=v5.8.6` and
 * `CRUN_VERSION=1.29.1`, because the pins are upstream TAG names and upstream
 * does not agree with itself about the prefix. The binaries agree with each
 * other instead -- `podman version 5.8.6` and `crun version 1.29.1` both print
 * the bare number. So the normalisation is on the PIN side, once, rather than a
 * per-artifact rule that would have to be written down twice.
 *
 * Only a leading `v` immediately followed by a digit is removed. `version`,
 * `v2-something` and a value that merely starts with a letter are left alone --
 * a blanket `replace(/^v/, '')` would silently rewrite a pin that never had the
 * prefix, and this is a comparison whose whole job is to be exact.
 */
export function expectedFromRecorded(recorded: string): string {
  return /^v[0-9]/.test(recorded) ? recorded.slice(1) : recorded
}

/**
 * Read a `versions.env` as data.
 *
 * @throws BoardEnvError, from the shared parser, on anything it cannot read
 *   faithfully -- and it says which file and which line.
 */
export function readVersionsEnv(file: string): ReadonlyMap<string, string> {
  return parseBoardEnv(readFileSync(file, 'utf8'), file).values
}

/**
 * Every version pin a `versions.env` declares, in file order.
 *
 * This is the direction that catches a new artifact. The register in
 * `smoke-register.ts` names the artifacts; this names the pins
 * the tree actually carries, and `smoke-register.test.ts` requires the second
 * set to be covered by the first. Without it, adding an eighth binary to
 * `mica-podman:` -- with its pin, its hash and its install line -- would leave the
 * smoke runner reporting a full green over seven, and a run that got greener by
 * looking at less is the exact defect this package exists to make visible in
 * other people's checkers.
 */
export function pinKeys(file: string): string[] {
  return [...readVersionsEnv(file).keys()].filter(k => k.endsWith(VERSION_KEY_SUFFIX))
}

/**
 * One pin, by key, out of one file.
 *
 * @throws Error naming the file, the key and the keys that ARE there. A missing
 *   pin must not read as an empty expectation: `expected === ''` would compare
 *   unequal to every real version and go red for a reason nobody could act on,
 *   so missing and empty pins are both rejected before comparison.
 */
export function readPin(file: string, key: string): Pin {
  const values = readVersionsEnv(file)
  const recorded = values.get(key)
  if (recorded === undefined || recorded === '') {
    const present = [...values.keys()].filter(k => k.endsWith(VERSION_KEY_SUFFIX)).join(', ')
    throw new Error(
      `${file} declares no non-empty ${key}. The smoke runner reads the version a binary must `
      + `report out of this file and this key; with neither there is nothing to compare against, `
      + `and an empty expectation is not a weaker check but a different one. `
      + `The version pins it does declare are: ${present || '(none at all)'}.`,
    )
  }
  return { recorded, expected: expectedFromRecorded(recorded), file, key }
}

/** `pkgs/micad/<crate>/Cargo.toml` -- the four device binaries this repository writes. */
export function cratePath(crate: string): string {
  return join(REPO_ROOT, 'pkgs', 'micad', crate, 'Cargo.toml')
}

/**
 * The `version` of a Cargo manifest's `[package]` table, and only that one.
 *
 * Why this is not a one-line regex. `version = "..."` appears many times in a
 * manifest and only the first table's is the crate's own: `pkgs/micad/apid/Cargo.toml`
 * has a `[dependencies]` section under it, and a workspace member inherits
 * `[workspace.package]` keys. A `/^version = "(.*)"/m` over the whole file finds
 * whichever came first in the byte order, which is the crate's today and a
 * dependency's the day someone reorders the file -- a comparison that silently
 * starts asserting a dependency's version against a binary's.
 *
 * So the table is tracked. Lines are scanned until `[package]` opens, values are
 * taken until the next `[`-header closes it, and a `version` outside that window
 * is not this crate's.
 *
 * @throws Error naming the file when there is no `[package]` table or no
 *   `version` in it -- never a default, for `readPin`'s reason.
 */
export function readCratePackageVersion(file: string): Pin {
  let inPackage = false
  let lineNo = 0
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    lineNo += 1
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') continue
    if (line.startsWith('[')) {
      // `[package]` and nothing else opens the window; every other header,
      // `[dependencies]` and `[lints]` included, closes it.
      inPackage = line === '[package]'
      continue
    }
    if (!inPackage) continue
    const m = /^version\s*=\s*"([^"]*)"\s*$/.exec(line)
    if (m === null) continue
    const recorded = m[1]!
    if (recorded === '') {
      throw new Error(
        `${file}:${lineNo} declares an EMPTY [package] version. The smoke runner compares what a `
        + `binary reports against this value; an empty one is an expectation nothing can meet and `
        + `nothing can fail against for a readable reason.`,
      )
    }
    return { recorded, expected: expectedFromRecorded(recorded), file, key: 'package.version' }
  }
  throw new Error(
    `${file} has no \`version = "..."\` inside a [package] table. That value is what the binary `
    + `this crate builds is required to report, so the smoke runner has nothing to compare `
    + `against. A workspace-inherited \`version.workspace = true\` would land here too, and it is `
    + `refused rather than resolved: this reader would then be following a second file without `
    + `saying so.`,
  )
}
