// The device-side update client, and the identity it selects releases against.
//
// Two checks over the packed root. `rauc-update` and `rauc-verify` are the
// device half of pkgs/rauc-sign, packaged as `mos-rauc-update`; the file they
// read to learn what device they are running on is written by the composition
// (rootfs/compose/compose-install.sh) because board, profile and the pool
// version are facts about a BUILD and one archive is installed into images of
// several.
//
// Why the two are separate checks: "the binaries are in the image" and "the
// image states an identity they can select against" fail independently and for
// different reasons -- a producer that stopped being resolved into the set, and
// a composition argument that arrived wrong -- and folding them into one
// verdict would report the second cause under the first one's sentence.
//
// The signing tool is asserted ABSENT rather than merely not mentioned.
// `rauc-sign` is the third binary that crate declares, it loads private keys,
// and it runs on a release host; pkgs/rauc-sign/hack/build-deb.sh refuses to
// stage it and this is the same statement made about the image that shipped.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { entry, packedRoot } from './checks-root.ts'
import { readProfileContract } from './checks-system.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { verdict } from './verdict.ts'
import { ToolOutputError } from './tools.ts'

/** The two binaries `mos-rauc-update` ships, at the paths its Dockerfile installs. */
const CLIENT_BINARIES = ['/usr/bin/rauc-update', '/usr/bin/rauc-verify'] as const

/** Update consumers and the baked-meta status reader, all required ELF files. */
const ENDPOINT_BINARIES = [...CLIENT_BINARIES, '/usr/bin/mosd', '/usr/bin/apid'] as const

// These literals are identifiers/diagnostics, not connection defaults. Keep
// exceptions at exact strings, never entire hosts or a blanket localhost rule.
const NON_ENDPOINT_LITERALS = [
  'http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd',
  'https://dbus.freedesktop.org/doc/dbus-specification.html#addresses',
  'https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-bus',
  'https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-error',
  'https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-interface',
  'https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-member',
  'https://github.com/clap-rs/clap/issues',
  'https://docs.rs/getrandom#nodejs-es-module-support',
  'https://docs.rs/rustls/latest/rustls/manual/_03_howto/index.html#unexpected-eof',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/XML/1998/namespace',
  'https://base-ui.com/production-error',
  'https://react.dev/errors/',
  'https://tailwindcss.com',
  // TanStack Router's synthetic origin for relative URL parsing, scoped to
  // its expression in embedded UI code. A standalone localhost URL still fails.
  'window?.origin&&window.origin!==`null`?window.origin:`http://localhost`',
] as const

/** The release-side signing tool. No device may carry it. */
const SIGNER_BINARY = '/usr/bin/rauc-sign'

/** `DEFAULT_IDENTITY_PATH` in pkgs/rauc-sign/src/update.rs. */
const IDENTITY_PATH = '/usr/share/mos/release-identity.env'

/** The keys `DeviceIdentity::from_env_file` requires, in the order it names them. */
const IDENTITY_KEYS = ['BOARD', 'PROFILE', 'VERSION'] as const

/**
 * The fourth key the composition writes, which the update client does NOT
 * read and mosd DOES: `COMMIT_DATE_KEY` in `pkgs/mosd/mosd/src/system_info.rs`,
 * reported as `system.commitDate` by `GET /api/v1/system/info`.
 *
 * It is checked apart from `IDENTITY_KEYS` because it is required by a
 * different consumer, and folding it in would make the client's refusal
 * message name a key the client never asks for.
 *
 * Why an image must carry it: it is the ONLY date in a mos root that says
 * anything about when the source was written. Every file time is pinned to
 * `SOURCE_DATE_EPOCH`, which `build/src/geometry.ts` fixes to a constant, so
 * an image without this key can only answer "when is this from?" with
 * 2020-01-01 -- the same answer every mos image has ever given.
 */
const COMMIT_DATE_KEY = 'COMMIT_DATE'

/**
 * `git show -s --format=%cI`, which is what `rootfs/build.sh` puts in the
 * file: a strict RFC 3339 instant with an offset or `Z`. The shape is checked
 * and not just the presence, because `COMMIT_DATE=` parses as a present key
 * with an empty value and would ship a surface reporting a blank date.
 */
const COMMIT_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/

/** The image profile marker `mos-profile-<x>` ships. */
const PROFILE_FILE = '/usr/lib/mos/profile.conf'

/** The shipped bill of materials, which is where the pool version is recorded. */
const MANIFEST_PATH = '/usr/share/mos/manifest.tsv'

/**
 * The first-party package the identity's VERSION is compared against.
 *
 * `mos-system` and not `mos-rauc-update`: it is named in
 * `rootfs/packages/common.pkgs`, so it is in EVERY image whatever the build
 * declined, and it carries no `VERSION_FROM`, so its version is the pool
 * version `build-env/deb/version.sh` printed -- verbatim, without the upstream
 * prefix `mos-podman` and `mos-rauc` put in front of the shared stamp.
 * Comparing against one of those would be comparing the identity against a
 * number that says which podman is packaged.
 */
const VERSION_ANCHOR = 'mos-system'

/** A file's text, or undefined when it is not a regular file in the root. */
function fileText(root: string, path: string): string | undefined {
  const st = entry(root, path)
  if (st === undefined || !st.isFile()) return undefined
  return readFileSync(join(root, path), 'latin1')
}

/**
 * The values `KEY` takes in a `KEY=VALUE` file, in order.
 *
 * Blank lines and `#` comments are skipped and the value is trimmed, which is
 * `DeviceIdentity::from_env_file` exactly. A line that is not `KEY=VALUE` is
 * NOT skipped here -- it is what `malformedLines` reports -- because the client
 * refuses such a file outright and a reader of this check should see the same
 * line the client would have named.
 */
function valuesOf(text: string, key: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    if (line.slice(0, eq).trim() !== key) continue
    out.push(line.slice(eq + 1).trim())
  }
  return out
}

/** The content lines that are not `KEY=VALUE`; the client `bail!`s on the first. */
function malformedLines(text: string): string[] {
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#') && !l.includes('='))
}

/** The version `manifest.tsv` records for `pkg`, or undefined. */
function manifestVersion(root: string, pkg: string): string | undefined {
  const text = fileText(root, MANIFEST_PATH)
  if (text === undefined) return undefined
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const fields = line.split('\t')
    if (fields.length === 3 && fields[0] === pkg) return fields[1]
  }
  return undefined
}

export const UPDATE_CHECKS: readonly CheckCase[] = [
  {
    id: 'no-compiled-in-endpoint',
    shell: { pass: 'no update or fleet endpoint is compiled into a binary' },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      if (!entry(root, '/usr/bin')?.isDirectory()) {
        throw new ToolOutputError(`${root}/usr/bin is absent; no endpoint binary scan is possible`)
      }
      const found: string[] = []
      let scannedBytes = 0
      for (const path of ENDPOINT_BINARIES) {
        if (!entry(root, path)?.isFile()) {
          throw new ToolOutputError(`${root}${path} is not a regular file; refusing an incomplete endpoint scan`)
        }
        const bytes = readFileSync(join(root, path))
        if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
          throw new ToolOutputError(`${root}${path} is not an ELF binary; refusing to report a binary scan over other data`)
        }
        scannedBytes += bytes.length
        let text = bytes.toString('latin1')
        for (const literal of NON_ENDPOINT_LITERALS) text = text.replaceAll(literal, '')
        const urls = text.match(/(?:https?|wss?|mqtts?):\/\/(?:[a-z0-9][a-z0-9._-]*|\[[a-f0-9:]+\])(?::[0-9]+)?/gi) ?? []
        for (const url of new Set(urls)) found.push(`${path}: ${url}`)
      }
      return [verdict('no-compiled-in-endpoint', found.length === 0,
        `no update or fleet endpoint is compiled into a binary: scanned ${ENDPOINT_BINARIES.length} ELF files `
        + `[${ENDPOINT_BINARIES.join(' ')}] under ${root}, ${scannedBytes} bytes; `
        + `meta/ and operator documents are data and are outside this scan; `
        + (found.length ? `found ${found.join('; ')}` : 'no endpoint literals found after exact diagnostic/namespace exclusions'))]
    },
  },
  {
    // Both halves and the signer's absence in ONE verdict, because they are one
    // statement about one package: `mos-rauc-update` ships exactly these two
    // binaries and pkgs/rauc-sign/hack/build-deb.sh asserts it compiled no
    // third. A separate check per path would report "the producer is not in the
    // resolution" three times.
    id: 'packed-update-client',
    shell: { pass: 'the update client ships', fail: 'the update client' },
    run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const what = 'the update client ships'
      const missing = CLIENT_BINARIES.filter((p) => {
        const st = entry(root, p)
        // A regular file and not a link to one, the predicate checks-root.ts
        // spells for every other shipped binary -- and executable, because a
        // payload that lost its mode is a client the device cannot run and an
        // `-f` test would call it present.
        return st === undefined || !st.isFile() || (st.mode & 0o111) === 0
      })
      if (missing.length > 0) {
        return [verdict('packed-update-client', false,
          `the update client is incomplete: ${missing.join(' ')} ${missing.length === 1 ? 'is' : 'are'} `
          + `not an executable regular file in the packed root. mos-rauc-update ships both halves -- `
          + `rauc-verify walks the signed metadata and rauc-update carries it -- so a root with one of `
          + `them has a client that cannot complete an update`)]
      }
      if (entry(root, SIGNER_BINARY) !== undefined) {
        return [verdict('packed-update-client', false,
          `${SIGNER_BINARY} is in the packed root. That is the RELEASE-side signing tool: it loads the `
          + `private keys that sign what devices trust, and it belongs on a build host. `
          + `pkgs/rauc-sign/deb/rauc-update stages the two device binaries and refuses this one by `
          + `name, so a copy here arrived some other way`)]
      }
      return [verdict('packed-update-client', true,
        `${what}: ${CLIENT_BINARIES.join(' and ')} are executable regular files, and the release-side `
        + `${SIGNER_BINARY} is not in the root`)]
    },
  },

  {
    // The identity, checked against the image's OWN statements of the same
    // three facts rather than against the build that is being verified: the
    // board comes from the definition this verifier was pointed at, the profile
    // from the marker file mos-profile-<x> ships, and the version from the
    // shipped bill of materials. A check that read them out of the build's
    // environment would hand the comparison the same value on both sides.
    id: 'packed-release-identity',
    shell: { pass: 'the release identity states', fail: IDENTITY_PATH },
    run: async (ctx: ImageContext): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const fail = (message: string): readonly CheckResult[] =>
        [verdict('packed-release-identity', false, message)]

      const text = fileText(root, IDENTITY_PATH)
      if (text === undefined) {
        return fail(
          `${IDENTITY_PATH} is not a regular file in the packed root. It is what rauc-update reads to `
          + `learn which board, profile and version this device is, and without it every invocation `
          + `needs --board/--profile/--current-version from whoever typed the command`)
      }

      const malformed = malformedLines(text)
      if (malformed.length > 0) {
        return fail(
          `${IDENTITY_PATH} carries ${malformed.length} line(s) that are not KEY=VALUE, the first being `
          + `'${malformed[0] as string}'. DeviceIdentity::from_env_file refuses such a file outright, so `
          + `this is an image whose client cannot read its own identity at all`)
      }

      // Exactly one of each, never "the last one wins". The client's parser
      // OVERWRITES on a repeated key, so a file stating two boards selects for
      // whichever came second while reading as though it declared both.
      const values: Record<string, string[]> = {}
      for (const key of IDENTITY_KEYS) values[key] = valuesOf(text, key)
      const absent = IDENTITY_KEYS.filter(k => (values[k] as string[]).length === 0)
      if (absent.length > 0) {
        return fail(
          `${IDENTITY_PATH} does not state ${absent.join(', ')}. A device identity is not guessed: the `
          + `client refuses the file, and the three keys are what board, profile and rollback selection `
          + `are each decided on`)
      }
      const repeated = IDENTITY_KEYS.filter(k => (values[k] as string[]).length > 1)
      if (repeated.length > 0) {
        return fail(
          `${IDENTITY_PATH} states ${repeated.map(k => `${k} ${(values[k] as string[]).length} times`).join(', ')}. `
          + `The client's parser keeps the LAST value for a key, so a repeated one is an identity that `
          + `reads as two and selects as one`)
      }
      const board = (values['BOARD'] as string[])[0] as string
      const profile = (values['PROFILE'] as string[])[0] as string
      const version = (values['VERSION'] as string[])[0] as string

      if (board !== ctx.board.name) {
        return fail(
          `${IDENTITY_PATH} states BOARD=${board} and this is the ${ctx.board.name} image. The client `
          + `selects only releases whose signed board matches, so this device would take ${board}'s `
          + `bundles and never its own`)
      }

      const profileText = fileText(root, PROFILE_FILE)
      if (profileText === undefined) {
        return fail(
          `${IDENTITY_PATH} states PROFILE=${profile} and ${PROFILE_FILE} is not a regular file in the `
          + `packed root, so there is nothing in the image to check it against. That file is what `
          + `mos-profile-dev and mos-profile-prod ship and exactly one of them is installed`)
      }
      // The key comes from mosd's own source, the way checks-system.ts reads
      // it, so the two families cannot disagree about what the marker is called.
      const profileKey = readProfileContract().key || 'MOS_PROFILE'
      const shipped = valuesOf(profileText, profileKey)
      // The LAST value, which is what mosd takes; checks-system.ts is the check
      // that refuses a file declaring more than one.
      const shippedProfile = shipped.length === 0 ? '' : shipped[shipped.length - 1] as string
      if (profile !== shippedProfile) {
        return fail(
          `${IDENTITY_PATH} states PROFILE=${profile} and ${PROFILE_FILE} says ${profileKey}=`
          + `${shippedProfile || '(nothing)'}. One image cannot be two profiles: the marker decides what `
          + `mosd does and the identity decides which releases this device will take`)
      }

      const anchor = manifestVersion(root, VERSION_ANCHOR)
      if (anchor === undefined) {
        return fail(
          `${IDENTITY_PATH} states VERSION=${version} and ${MANIFEST_PATH} records no version for `
          + `${VERSION_ANCHOR}, so there is nothing in the image to check it against. That package is in `
          + `rootfs/packages/common.pkgs and is in every image; a manifest without it is not one this `
          + `repository composed`)
      }
      if (version !== anchor) {
        return fail(
          `${IDENTITY_PATH} states VERSION=${version} and ${MANIFEST_PATH} records ${VERSION_ANCHOR} at `
          + `${anchor}. The identity's version is the POOL version this image was composed from -- what `
          + `build-env/deb/version.sh printed for the tree -- so a different one means the client would `
          + `judge "newer than what is running" against a release this image is not`)
      }

      const commitDates = valuesOf(text, COMMIT_DATE_KEY)
      if (commitDates.length !== 1) {
        return fail(
          `${IDENTITY_PATH} states ${COMMIT_DATE_KEY} ${commitDates.length} times and exactly one `
          + `belongs there. It is the date of the commit VERSION's +git stamp names, written by `
          + `rootfs/compose/compose-install.sh, and it is the only date in this image that is not the `
          + `pinned SOURCE_DATE_EPOCH -- without it mosd's system-information surface can report no `
          + `date at all, and a second one would let it report whichever the parser kept`)
      }
      const commitDate = commitDates[0] as string
      if (!COMMIT_DATE_SHAPE.test(commitDate)) {
        return fail(
          `${IDENTITY_PATH} states ${COMMIT_DATE_KEY}=${commitDate || '(nothing)'}, which is not the `
          + `\`git show -s --format=%cI\` shape rootfs/build.sh writes. mosd reports this value `
          + `verbatim as system.commitDate, so anything else is a date the console would show as one`)
      }

      return [verdict('packed-release-identity', true,
        `the release identity states BOARD=${board}, PROFILE=${profile}, VERSION=${version} and `
        + `${COMMIT_DATE_KEY}=${commitDate}, matching the verified board, ${PROFILE_FILE} and `
        + `${VERSION_ANCHOR} in ${MANIFEST_PATH}`)]
    },
  },
]
