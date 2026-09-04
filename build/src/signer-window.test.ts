// The declared signer window, the certificate reader, and the refusal --
// driven from the failing side, plus the one assertion that keeps the number
// from having two copies.
//
// THE FIXTURES ARE REAL CERTIFICATES, minted with openssl and pasted here with
// the dates openssl reported. Inline rather than committed as files: nothing
// under a `*.cert.pem` name may enter the index (tests/trust-domain-hygiene-test.sh),
// and a fixture regenerated at test time would need openssl on whatever host
// runs the suite -- which the pinned bun container is not.
//
// THE CLOCK IS INJECTED, never `new Date()`. A test that minted a certificate
// "30 days from now" and then asserted a refusal would be asserting against a
// value it chose twice; worse, a fixture whose validity is relative to the run
// goes green or red depending on the day. Here the certificate's notAfter is a
// fixed fact and `now` is the variable, which is the direction the production
// code also reads them in.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'
import {
  certNotAfter,
  KEY_VALIDITY_ENV,
  RAUC_EXPIRY_WARNING_DAYS,
  readSignerPolicy,
  signerRefusal,
  type SignerPolicy,
} from './signer-window.ts'

/** notAfter = 2026-12-13T21:27:54Z, encoded as a UTCTime. v3. */
const UTC_CERT = `-----BEGIN CERTIFICATE-----
MIIBnTCCAUOgAwIBAgIUZaYqlhK6J88hy8k9qCUuSwENNw0wCgYIKoZIzj0EAwIw
JDEUMBIGA1UECgwLbW9zIGZpeHR1cmUxDDAKBgNVBAMMA3V0YzAeFw0yNjA5MDQy
MTI3NTRaFw0yNjEyMTMyMTI3NTRaMCQxFDASBgNVBAoMC21vcyBmaXh0dXJlMQww
CgYDVQQDDAN1dGMwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAS6qpMlVvPflkgq
eeIAvDqd2TNYvCdxi/5n8M3KDHDo+EHjz9a/6GTCH1JNwDRK9E+1QYWfljsMa2ep
WWf/sjCxo1MwUTAdBgNVHQ4EFgQUwXb4iqjxNf0q+PbzWbD29BsiMcIwHwYDVR0j
BBgwFoAUwXb4iqjxNf0q+PbzWbD29BsiMcIwDwYDVR0TAQH/BAUwAwEB/zAKBggq
hkjOPQQDAgNIADBFAiEAmX69nSl/dWENrQ+c4TpbBt0G+2tbXPYU72XfCeN+gpcC
IDN1xolWq6tRkLWamGLFKKmYGnDqq+yIcDVsl2BzcMey
-----END CERTIFICATE-----`

/**
 * notAfter = 2054-01-20T21:27:54Z. Past 2049, so RFC 5280 requires a
 * GeneralizedTime and openssl emits one -- a different ASN.1 tag and a
 * four-digit year. The 15-year CA of release-signing.md §2.1 is minted into
 * exactly this range, so a reader that only understood UTCTime would throw on
 * the one certificate whose expiry bricks the whole fleet.
 */
const GENERALIZED_CERT = `-----BEGIN CERTIFICATE-----
MIIBnzCCAUWgAwIBAgIUa9OTBAja20OW5h56MXyIxtMqZMUwCgYIKoZIzj0EAwIw
JDEUMBIGA1UECgwLbW9zIGZpeHR1cmUxDDAKBgNVBAMMA2dlbjAgFw0yNjA5MDQy
MTI3NTRaGA8yMDU0MDEyMDIxMjc1NFowJDEUMBIGA1UECgwLbW9zIGZpeHR1cmUx
DDAKBgNVBAMMA2dlbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABBRxCZUxJYck
ZAq708oMz1v6nP9xMSfXHuLiIi5XawapSAPXJmEW2A+Kx/eE8RVw0UPRyyyrujyB
fuvbp12Zf7+jUzBRMB0GA1UdDgQWBBQxkNiSIKJSBWTSSsR6Cf47N8qdbTAfBgNV
HSMEGDAWgBQxkNiSIKJSBWTSSsR6Cf47N8qdbTAPBgNVHRMBAf8EBTADAQH/MAoG
CCqGSM49BAMCA0gAMEUCIFvPN71JZFUaWw6tk1DHT0wjIcRcZPaIGDgsblZjh2Ah
AiEA4pVQ26bB7tXgUP73JBXiNmTtr23h3/YG98HHh9eR1FM=
-----END CERTIFICATE-----`

/**
 * notAfter = 2026-10-24T21:27:54Z, on a v1 certificate: tbsCertificate has NO
 * `[0] EXPLICIT version` field, so every field after it sits one position
 * earlier. A walk with a constant offset reads the issuer as the validity here.
 */
const V1_CERT = `-----BEGIN CERTIFICATE-----
MIIBQTCB6AIUDcDrm8gp5EwsuWisbF/4LEibY+gwCgYIKoZIzj0EAwIwJDEUMBIG
A1UECgwLbW9zIGZpeHR1cmUxDDAKBgNVBAMMA3V0YzAeFw0yNjA5MDQyMTI3NTRa
Fw0yNjEwMjQyMTI3NTRaMCMxFDASBgNVBAoMC21vcyBmaXh0dXJlMQswCQYDVQQD
DAJ2MTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABBIpJ705TKZmtUNRgLCY4uTj
ZPW7/N+AwB2oq61aJl9/qC3xF8A1MhxTm2AvcrPtKy6dRmsGDykdglDpiyQJC3ow
CgYIKoZIzj0EAwIDSAAwRQIgGvWtrR1MK+8f8BjAxodLGzty23eedP7vFPieej7n
9ucCIQCQCKRBjktpzYtFaZGcks0g0OvBJ/0iRvcYwAXKIFn18w==
-----END CERTIFICATE-----`

const NOT_AFTER_UTC = Date.parse('2026-12-13T21:27:54Z')

function withEnvFile(body: string, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mos-signer-window-'))
  const path = join(dir, 'key-validity.env')
  writeFileSync(path, body)
  try {
    run(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const POLICY: SignerPolicy = { validityDays: 45, reissueThresholdDays: 7, path: '/fixture/key-validity.env' }

describe('certNotAfter reads the date the certificate carries', () => {
  test('a UTCTime notAfter, on a v3 certificate', () => {
    expect(certNotAfter(UTC_CERT, 'utc.pem').toISOString()).toBe('2026-12-13T21:27:54.000Z')
  })

  test('a GeneralizedTime notAfter — the encoding every certificate past 2049 uses', () => {
    expect(certNotAfter(GENERALIZED_CERT, 'gen.pem').toISOString()).toBe('2054-01-20T21:27:54.000Z')
  })

  test('a v1 certificate, whose tbsCertificate has no version field', () => {
    expect(certNotAfter(V1_CERT, 'v1.pem').toISOString()).toBe('2026-10-24T21:27:54.000Z')
  })

  test('the FIRST certificate answers for a file holding a chain', () => {
    // `rauc bundle --cert` takes the signer, and a file that also carries the
    // issuer leads with the signer. Reading the last one would report the CA's
    // 15-year horizon and never refuse anything.
    expect(certNotAfter(`${UTC_CERT}\n${GENERALIZED_CERT}\n`, 'chain.pem').toISOString())
      .toBe('2026-12-13T21:27:54.000Z')
  })

  test('a file with no CERTIFICATE block is refused by name, not read as one', () => {
    // The realistic slip is signer.key.pem where signer.cert.pem was meant.
    expect(() => certNotAfter('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', 'signer.key.pem'))
      .toThrow(/signer\.key\.pem contains no PEM CERTIFICATE block/)
  })

  test('a truncated certificate throws rather than answering with a date', () => {
    const cut = UTC_CERT.replace(/(-----BEGIN CERTIFICATE-----\n)([\s\S]{40})[\s\S]*(\n-----END)/, '$1$2$3')
    expect(() => certNotAfter(cut, 'cut.pem')).toThrow(/cut\.pem/)
  })
})

describe('signerRefusal: RED inside the threshold, green outside it', () => {
  const at = (iso: string): string | undefined =>
    signerRefusal({ certPath: '/m/signer.cert.pem', notAfter: new Date(NOT_AFTER_UTC), now: new Date(iso), policy: POLICY })

  test('green with the full window left', () => {
    expect(at('2026-11-01T00:00:00Z')).toBeUndefined()
  })

  test('green EXACTLY at the threshold — the boundary is inclusive on the safe side', () => {
    expect(at('2026-12-06T21:27:54Z')).toBeUndefined()
  })

  test('RED one second inside the threshold', () => {
    expect(at('2026-12-06T21:27:55Z')).toBeDefined()
  })

  test('RED with a signer that has already expired', () => {
    const r = at('2027-01-13T21:27:54Z')
    expect(r).toBeDefined()
    expect(r).toMatch(/expired 31\.0 days ago/)
  })

  test('the refusal NAMES the notAfter it read, the threshold and the file that declares it', () => {
    // "Your signer is expiring" against a date the operator cannot see is a
    // sentence they have to go and verify before they can act on it, and the
    // date is the whole content of the decision.
    const r = at('2026-12-10T00:00:00Z') as string
    expect(r).toContain('2026-12-13T21:27:54Z')
    expect(r).toContain('7-day reissue threshold')
    expect(r).toContain('/fixture/key-validity.env')
    expect(r).toContain('/m/signer.cert.pem')
    expect(r).toMatch(/gen-dev-keys\.sh --force/)
    expect(r).toMatch(/release-signing\.md §2\.2/)
  })

  test('it REFUSES rather than warns — there is no verdict between the two', () => {
    // versions.env's precedent, and §4a's reason: under monthly root access a
    // missed reissue needs a ceremony convened at short notice, so a message
    // that lets the build continue is a message that discovers the outage.
    expect(typeof at('2026-12-12T00:00:00Z')).toBe('string')
  })
})

describe('readSignerPolicy refuses a declaration that would mean nothing', () => {
  const good = 'MOS_RAUC_SIGNER_VALIDITY_DAYS=45\nMOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=7\n'

  test('POSITIVE CONTROL: the two rows parse', () => {
    withEnvFile(good, (p) => {
      const policy = readSignerPolicy(p)
      expect(policy.validityDays).toBe(45)
      expect(policy.reissueThresholdDays).toBe(7)
      expect(policy.path).toBe(p)
    })
  })

  test('the LAST assignment wins, as the shell that sources this file reads it', () => {
    withEnvFile(`${good}MOS_RAUC_SIGNER_VALIDITY_DAYS=60\n`, (p) => {
      expect(readSignerPolicy(p).validityDays).toBe(60)
    })
  })

  test('a missing row is not a default', () => {
    withEnvFile('MOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=7\n', (p) => {
      expect(() => readSignerPolicy(p)).toThrow(/declares no MOS_RAUC_SIGNER_VALIDITY_DAYS/)
    })
  })

  test('a non-number is refused, naming what openssl would do with it', () => {
    withEnvFile('MOS_RAUC_SIGNER_VALIDITY_DAYS=45d\nMOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=7\n', (p) => {
      expect(() => readSignerPolicy(p)).toThrow(/not a whole number of days/)
    })
  })

  test('a zero window is refused: the signer would be expired when minted', () => {
    withEnvFile('MOS_RAUC_SIGNER_VALIDITY_DAYS=0\nMOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=7\n', (p) => {
      expect(() => readSignerPolicy(p)).toThrow(/expired the moment it is minted/)
    })
  })

  test('a zero threshold is refused: it would report the outage rather than precede it', () => {
    withEnvFile('MOS_RAUC_SIGNER_VALIDITY_DAYS=45\nMOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=0\n', (p) => {
      expect(() => readSignerPolicy(p)).toThrow(/report the outage rather than precede it/)
    })
  })

  test('a threshold at or above the window is refused: nothing could ever be signed', () => {
    withEnvFile('MOS_RAUC_SIGNER_VALIDITY_DAYS=6\nMOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=6\n', (p) => {
      expect(() => readSignerPolicy(p)).toThrow(/refused from the\s+moment it was minted/)
    })
  })

  test(`a threshold at rauc's own ${RAUC_EXPIRY_WARNING_DAYS}-day warning band is refused`, () => {
    // S2 and S3 are a pair. The warning exists to give a ceremony runway; a
    // refusal that fires as early as the warning deletes it, and the two
    // mechanisms collapse into one.
    withEnvFile(`MOS_RAUC_SIGNER_VALIDITY_DAYS=45\nMOS_RAUC_SIGNER_REISSUE_THRESHOLD_DAYS=${RAUC_EXPIRY_WARNING_DAYS}\n`, (p) => {
      expect(() => readSignerPolicy(p)).toThrow(/every warned build would already be a refused one/)
    })
  })

  test('an absent file is refused by name', () => {
    expect(() => readSignerPolicy('/nonexistent/key-validity.env')).toThrow(/does not exist/)
  })
})

// --- S5: one declared number, not two that agree today ----------------------

describe('the window has ONE declaration, and every reader of it agrees', () => {
  const SHIPPED = readSignerPolicy()
  const generator = readFileSync(join(REPO_ROOT, 'pkgs', 'rauc', 'gen-dev-keys.sh'), 'utf8')
  const ceremony = readFileSync(join(REPO_ROOT, 'docs', 'design', 'release-signing.md'), 'utf8')

  test('the shipped declaration parses, so nothing below is asserted against a throw', () => {
    expect(SHIPPED.validityDays).toBeGreaterThan(0)
    expect(SHIPPED.path).toBe(KEY_VALIDITY_ENV)
  })

  test('the generator MINTS from it rather than carrying a literal', () => {
    // The mint must read the declaration. A literal here is the exact defect
    // this arrangement removes: it would go on looking correct after the
    // declaration moved.
    expect(generator).toContain('-days "${MOS_RAUC_SIGNER_VALIDITY_DAYS}"')
    expect(generator).toContain('. "${VALIDITY_ENV}"')
  })

  test("release-signing.md §2.1's signer step carries the SAME number", () => {
    // §2.1 is a shell block a human copies onto an offline machine that may
    // hold no checkout, so it cannot source the declaration -- which is exactly
    // why it needs a gate rather than a promise. Changing the declared value
    // and not this line turns the ceremony into a document that mints a
    // different window from the one the tree committed to.
    const signerStep = /openssl x509 -req -in signer\.csr[\s\S]*?-days (\d+)/.exec(ceremony)
    expect(signerStep).not.toBeNull()
    expect(Number((signerStep as RegExpExecArray)[1])).toBe(SHIPPED.validityDays)
  })

  test("release-signing.md names the declaration file, so a reader can find the reason", () => {
    expect(ceremony).toContain('pkgs/rauc/key-validity.env')
  })

  test('the CA horizon is NOT this number — the two windows are different facts', () => {
    // The CA must outlive the fleet (§2.1: an expired baked keyring bricks
    // updates on every device at once); the signer must not. A gate that
    // matched the first `-days` in the block would have bound the CA to the
    // signer's window and shortened the keyring to 45 days.
    const caStep = /openssl req -x509 -newkey rsa:4096[\s\S]*?-days (\d+)/.exec(ceremony)
    expect(caStep).not.toBeNull()
    expect(Number((caStep as RegExpExecArray)[1])).toBeGreaterThan(SHIPPED.validityDays * 10)
  })
})
