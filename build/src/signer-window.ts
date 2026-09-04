// The RAUC signer's validity window: the declared number, and reading the date
// off the certificate that is about to sign.
//
// WHY THIS IS A MODULE AND NOT A LITERAL (PLAN-078 §3a, §S3, §S5). There is no
// CRL path from this project to a device, so a stolen bundle signer is not
// revoked, it is OUT-WAITED -- and how long that takes is exactly the signer
// certificate's remaining validity. That makes the window a security parameter
// and an operational commitment at once: short enough that out-waiting a
// compromise is a support event measured in weeks, long enough that a monthly
// root ceremony that slips a week does not stop the release line.
//
// The number therefore lives in ONE committed place with its reason beside it
// -- pkgs/rauc/key-validity.env, on pkgs/rauc/key-algorithms.env's precedent --
// and everything that needs it reads it: the generator's mint, the refusal
// below, and (through signer-window.test.ts) the ceremony block in
// docs/design/release-signing.md §2.1. Two copies that agree today are the
// defect this arrangement exists to prevent.
//
// WHY THE CERTIFICATE IS PARSED HERE rather than handed to openssl. The
// refusal has to happen BEFORE `rauc bundle` runs, on the host, and the bundle
// toolset's container carries rauc rather than the openssl CLI. Adding a
// package to that toolset to read one field would widen the container the
// bundle is built in for a check that runs outside it. The walk below is the
// four fields of tbsCertificate that precede `validity` and nothing else; it
// refuses anything it does not recognise rather than guessing, because a
// lenient date parser produces a window nobody chose.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'

/** `pkgs/rauc/key-validity.env` -- the one declaration of the window. */
export const KEY_VALIDITY_ENV: string = join(REPO_ROOT, 'pkgs', 'rauc', 'key-validity.env')

/**
 * rauc's own imminent-expiry warning band, which is upstream's and is not
 * configurable: `rauc bundle --keyring` prints "will expire in less than a
 * month!" inside it (PLAN-078 §F7, measured). The declared refusal threshold
 * is checked against this, so the two cannot be set to the same number --
 * which would make every warned build a refused build and leave no runway at
 * all between "a ceremony is due" and "nothing ships".
 */
export const RAUC_EXPIRY_WARNING_DAYS = 30

export interface SignerPolicy {
  /** `-days` of the signer mint, and of §2.1's ceremony block. */
  readonly validityDays: number
  /** The build refuses to sign inside this many days of `notAfter`. */
  readonly reissueThresholdDays: number
  /** Where both were read from, so a refusal can name the file to edit. */
  readonly path: string
}

class SignerWindowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignerWindowError'
  }
}

/**
 * One `KEY=value` out of an env file, LAST assignment winning.
 *
 * The shell's own rule (`sed -n "s/^KEY=//p" file | tail -n1`), because
 * gen-dev-keys.sh reads the same file by sourcing it and a reader that took
 * the first match would disagree with the generator about a file that assigns
 * a key twice.
 */
function envGet(text: string, key: string): string | undefined {
  const hits = text.split('\n').filter(l => l.startsWith(`${key}=`)).map(l => l.slice(key.length + 1).trim())
  return hits.length === 0 ? undefined : hits[hits.length - 1]
}

function wholeDays(text: string, key: string, path: string): number {
  const raw = envGet(text, key)
  if (raw === undefined || raw === '') {
    throw new SignerWindowError(
      `${path} declares no ${key}. An absent row is not a default -- a window nobody declared is a `
      + `window nobody chose, and the reason for the number is what that file exists to carry.`,
    )
  }
  if (!/^\d+$/.test(raw)) {
    throw new SignerWindowError(
      `${path} declares ${key}='${raw}', which is not a whole number of days. openssl reads a `
      + `non-number after \`-days\` as the start of the next option, so a value like this mints a `
      + `certificate whose validity nobody chose.`,
    )
  }
  return Number(raw)
}

/**
 * The declared window and threshold, with the relationships between them
 * checked rather than described.
 *
 * @throws SignerWindowError when a row is missing, is not a whole number, or
 *   is a value that would make one of the two mechanisms meaningless.
 */
export function readSignerPolicy(path: string = KEY_VALIDITY_ENV): SignerPolicy {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new SignerWindowError(
      `${path} does not exist. It is where the RAUC signer's validity window is declared; without `
      + `it the build would fall back to a literal compiled into itself, which is the choice that `
      + `file exists to remove.`,
    )
  }
  const validityDays = wholeDays(text, 'MOS_RAUC_SIGNER_VALIDITY_DAYS', path)
  const reissueThresholdDays = wholeDays(text, 'MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS', path)
  if (validityDays <= 0) {
    throw new SignerWindowError(
      `${path} declares MOS_RAUC_SIGNER_VALIDITY_DAYS=${validityDays}. A signer valid for zero days `
      + `is expired the moment it is minted, and no bundle signed with it verifies anywhere.`,
    )
  }
  if (reissueThresholdDays <= 0) {
    throw new SignerWindowError(
      `${path} declares MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=${reissueThresholdDays}. A threshold `
      + `of zero fires only once the signer has already expired, which is after the point where `
      + `anything could still be published -- it would report the outage rather than precede it.`,
    )
  }
  if (reissueThresholdDays >= validityDays) {
    throw new SignerWindowError(
      `${path} declares MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=${reissueThresholdDays} against a `
      + `MOS_RAUC_SIGNER_VALIDITY_DAYS=${validityDays} window, so a signer would be refused from the `
      + `moment it was minted and no reissue could ever produce a usable one.`,
    )
  }
  if (reissueThresholdDays >= RAUC_EXPIRY_WARNING_DAYS) {
    throw new SignerWindowError(
      `${path} declares MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=${reissueThresholdDays}, at or above `
      + `rauc's own ${RAUC_EXPIRY_WARNING_DAYS}-day warning band. The warning and the refusal are a `
      + `pair: the warning exists to give a ceremony runway, and a refusal that fires as early as `
      + `the warning deletes that runway -- every warned build would already be a refused one.`,
    )
  }
  return { validityDays, reissueThresholdDays, path }
}

// --- the certificate's own answer -------------------------------------------

interface Tlv {
  readonly tag: number
  /** First content byte. */
  readonly start: number
  /** One past the last content byte, and the first byte of the next TLV. */
  readonly end: number
}

const SEQUENCE = 0x30
const UTC_TIME = 0x17
const GENERALIZED_TIME = 0x18
/** `[0] EXPLICIT Version`, the optional first field of tbsCertificate. */
const CONTEXT_0 = 0xa0

function readTlv(der: Uint8Array, at: number, what: string, path: string): Tlv {
  if (at + 1 >= der.length) {
    throw new SignerWindowError(`${path}: ${what} runs off the end of the certificate.`)
  }
  const tag = der[at] as number
  let length = der[at + 1] as number
  let start = at + 2
  if ((length & 0x80) !== 0) {
    const bytes = length & 0x7f
    // A 4-byte length caps this at 4 GiB, and an indefinite length (0) is not
    // legal DER. Refusing both is cheaper than a parser that would accept a
    // shape no certificate has and then answer with a date from somewhere.
    if (bytes === 0 || bytes > 4) {
      throw new SignerWindowError(
        `${path}: ${what} has a ${bytes === 0 ? 'DER-illegal indefinite' : `${bytes}-byte`} length. `
        + `This reader handles definite lengths up to four bytes, which is every X.509 certificate.`,
      )
    }
    length = 0
    for (let i = 0; i < bytes; i += 1) length = length * 256 + (der[start + i] as number)
    start += bytes
  }
  const end = start + length
  if (end > der.length) {
    throw new SignerWindowError(`${path}: ${what} claims ${length} bytes past the end of the certificate.`)
  }
  return { tag, start, end }
}

function parseAsn1Time(bytes: Uint8Array, tag: number, path: string): Date {
  const text = new TextDecoder().decode(bytes)
  // RFC 5280 pins both encodings to UTC with seconds present, so there is
  // exactly one shape per tag. Anything else is refused rather than guessed at:
  // a parser that filled in a missing field would answer with a date the
  // certificate does not carry, and this date decides whether a release ships.
  const utc = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  const gen = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  let parts: RegExpExecArray | null = null
  let year = 0
  if (tag === UTC_TIME && utc !== null) {
    parts = utc
    // RFC 5280: 50..99 is 19xx, 00..49 is 20xx.
    const yy = Number(utc[1])
    year = yy >= 50 ? 1900 + yy : 2000 + yy
  } else if (tag === GENERALIZED_TIME && gen !== null) {
    parts = gen
    year = Number(gen[1])
  }
  if (parts === null) {
    throw new SignerWindowError(
      `${path}: notAfter is tag 0x${tag.toString(16)} '${text}', which is neither an RFC 5280 `
      + `UTCTime (YYMMDDHHMMSSZ) nor a GeneralizedTime (YYYYMMDDHHMMSSZ).`,
    )
  }
  return new Date(Date.UTC(
    year,
    Number(parts[2]) - 1,
    Number(parts[3]),
    Number(parts[4]),
    Number(parts[5]),
    Number(parts[6]),
  ))
}

/**
 * `notAfter` of the FIRST certificate in a PEM file.
 *
 * First, because `rauc bundle --cert` takes the signer and a file holding a
 * chain leads with it. The walk is: Certificate SEQUENCE -> tbsCertificate
 * SEQUENCE -> skip the optional `[0] version`, serialNumber, signature and
 * issuer -> validity SEQUENCE -> its second Time.
 *
 * @throws SignerWindowError naming the file, for a file with no certificate in
 *   it (a key path passed where a certificate was meant is the likely case) and
 *   for any shape this walk does not recognise.
 */
export function certNotAfter(pem: string, path: string): Date {
  const armoured = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)
  if (armoured === null) {
    throw new SignerWindowError(
      `${path} contains no PEM CERTIFICATE block, so there is no validity window to read off it. `
      + `A private key file passed where the signing CERTIFICATE was meant looks exactly like this.`,
    )
  }
  const der = Uint8Array.from(Buffer.from((armoured[1] as string).replace(/\s+/g, ''), 'base64'))
  const certificate = readTlv(der, 0, 'the outer Certificate', path)
  if (certificate.tag !== SEQUENCE) {
    throw new SignerWindowError(`${path}: the outer Certificate is tag 0x${certificate.tag.toString(16)}, not a SEQUENCE.`)
  }
  const tbs = readTlv(der, certificate.start, 'tbsCertificate', path)
  if (tbs.tag !== SEQUENCE) {
    throw new SignerWindowError(`${path}: tbsCertificate is tag 0x${tbs.tag.toString(16)}, not a SEQUENCE.`)
  }
  let at = tbs.start
  const first = readTlv(der, at, 'the first field of tbsCertificate', path)
  // `version` is OPTIONAL and absent on a v1 certificate; every field after it
  // shifts by one when it is, which is why this is a test and not a constant
  // offset.
  if (first.tag === CONTEXT_0) at = first.end
  for (const field of ['serialNumber', 'signature', 'issuer']) {
    at = readTlv(der, at, field, path).end
  }
  const validity = readTlv(der, at, 'validity', path)
  if (validity.tag !== SEQUENCE) {
    throw new SignerWindowError(
      `${path}: validity is tag 0x${validity.tag.toString(16)}, not a SEQUENCE. The field walk `
      + `landed somewhere other than the validity, and a date read from there would be a number, `
      + `not a fact.`,
    )
  }
  const notBefore = readTlv(der, validity.start, 'notBefore', path)
  const notAfter = readTlv(der, notBefore.end, 'notAfter', path)
  return parseAsn1Time(der.subarray(notAfter.start, notAfter.end), notAfter.tag, path)
}

const MS_PER_DAY = 86_400_000

export interface SignerRefusalInput {
  readonly certPath: string
  readonly notAfter: Date
  readonly now: Date
  readonly policy: SignerPolicy
}

/**
 * The refusal text, or `undefined` when the signer has runway left.
 *
 * REFUSES rather than warns, on pkgs/rauc/versions.env's precedent: recording
 * a hash is an act, and so is reissuing a signer. Under PLAN-078 §4a the user
 * chose monthly ROOT access, so a missed reissue is not repaired by a quick
 * mint from an intermediate -- it needs a root ceremony convened at short
 * notice, and until one is, nothing ships. A warning nobody acts on is what
 * turns that into a discovery rather than a schedule.
 *
 * The message NAMES the notAfter it read. "Your signer is expiring" against a
 * date the operator cannot see is a sentence they have to go and verify before
 * they can act on it, and the date is the whole content of the decision.
 */
export function signerRefusal(input: SignerRefusalInput): string | undefined {
  const daysLeft = (input.notAfter.getTime() - input.now.getTime()) / MS_PER_DAY
  if (daysLeft >= input.policy.reissueThresholdDays) return undefined
  const stamp = input.notAfter.toISOString().replace('.000Z', 'Z')
  const state = daysLeft < 0
    ? `expired ${Math.abs(daysLeft).toFixed(1)} days ago`
    : `expires in ${daysLeft.toFixed(1)} days`
  return `${input.certPath} ${state}: notAfter is ${stamp}, inside the `
    + `${input.policy.reissueThresholdDays}-day reissue threshold declared in ${input.policy.path}. `
    + `The build refuses to sign rather than warning, because there is no CRL path to devices: what `
    + `a signer's remaining validity bounds is how long a STOLEN one stays usable, and a bundle `
    + `signed now with a signer that dies inside the week is a release the fleet stops being able to `
    + `install almost immediately. Reissue it -- docs/design/release-signing.md §2.2 for production `
    + `material, \`bash pkgs/rauc/gen-dev-keys.sh --force\` for a development tree -- and build again.`
}
