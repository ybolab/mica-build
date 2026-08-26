// The register, and the two directions that keep it from falling behind.
//
// RFCT-113 M7b. `pinCoverageFaults` is the guard, and a guard is only worth the
// run it can refuse -- so every case below drives it RED first and keeps the
// green one beside it. The shipped register passing is the positive control and
// on its own it proves nothing: a coverage check that never fires and a
// coverage check that cannot fire report the same thing.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'
import { ARTIFACTS, pinCoverageFaults, type Artifact } from './smoke-register.ts'
import { PODMAN_VERSIONS_ENV, RAUC_VERSIONS_ENV, pinKeys, VERSIONS_ENV_FILES } from './smoke-pins.ts'

let SCRATCH = ''
beforeAll(() => {
  mkdirSync(join(REPO_ROOT, '_out'), { recursive: true })
  SCRATCH = mkdtempSync(join(REPO_ROOT, '_out', 'verify-smoke-register-'))
})
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

function fixture(name: string, body: string): string {
  if (SCRATCH === '') throw new Error('the scratch directory was read before beforeAll created it')
  const path = join(SCRATCH, name)
  writeFileSync(path, body)
  return path
}

/**
 * RFCT-113's Scope, transcribed once, HERE and not in the register.
 *
 * This is the one place a list of names is written down on purpose, and it is
 * written in the TEST rather than in the code so that it is an independent
 * statement of the requirement rather than a restatement of the
 * implementation. A register that quietly dropped an artifact would still
 * satisfy every property `pinCoverageFaults` checks -- the pin would just go
 * unclaimed if it had one, and mosd, apid, mos-mqttd and mos-mqtt-broker have
 * no `versions.env` pin at all, so three of the four could vanish without any
 * coverage direction noticing. This is what notices.
 *
 * Scope: "for mosd, apid, mos-mqttd, mos-mqtt-broker, rauc, podman, quadlet,
 * crun, conmon, netavark, aardvark-dns -- minimal invocation inside that image
 * ... catatonit (static, no --version contract) gets an exec-only check."
 */
const SCOPE_ARTIFACTS = [
  'mosd',
  'apid',
  'mos-mqttd',
  'mos-mqtt-broker',
  'rauc',
  'podman',
  'quadlet',
  'crun',
  'conmon',
  'netavark',
  'aardvark-dns',
  'catatonit',
] as const

describe('the register names what RFCT-113 names', () => {
  test('every artifact in Scope is in the register, and nothing else is', () => {
    expect([...ARTIFACTS].map(a => a.name).sort()).toEqual([...SCOPE_ARTIFACTS].sort())
  })

  test('each installed path is absolute and each name appears once', () => {
    const names = new Set<string>()
    for (const a of ARTIFACTS) {
      expect(a.path.startsWith('/')).toBe(true)
      expect(names.has(a.name)).toBe(false)
      names.add(a.name)
    }
    expect(names.size).toBe(SCOPE_ARTIFACTS.length)
  })

  test('every entry can read its own pin, and none of them is empty', () => {
    for (const a of ARTIFACTS) {
      const pin = a.pin()
      expect(pin.recorded).not.toBe('')
      expect(pin.expected).not.toBe('')
    }
  })

  // WHAT THIS ASSERTION USED TO SAY, and why the change is the milestone.
  //
  // Until RFCT-113 M7d it read `expect(unclaimed.sort()).toEqual(['apid',
  // 'mosd'])`, with the comment "asserted so that the day someone adds
  // --version to mosd, this test fails and points at the register entry that
  // should stop saying otherwise". That day was 2026-08-26: the user lifted
  // PLAN-014's exclusion on `mosd/` Rust sources for exactly a `--version`
  // handler, both binaries got one, and this test went RED exactly as M7b built
  // it to. This is the edit it was pointing at.
  test('every artifact is asked for a version, and none is unclaimed', () => {
    expect(ARTIFACTS.filter(a => a.contract.kind === 'unclaimed').map(a => a.name)).toEqual([])
    for (const a of ARTIFACTS) {
      expect(a.contract.kind).toBe('version')
      // `kind` is narrowed by the line above for the reader, not for tsc.
      expect(a.contract.kind === 'version' ? a.contract.argv : null).toEqual(['--version'])
    }
    // The vacuity control on the loop: `[]` is what an empty register would
    // give too, and a register with nothing in it satisfies "none is unclaimed"
    // perfectly.
    expect(ARTIFACTS.length).toBe(SCOPE_ARTIFACTS.length)
  })

  // THE COMMIT HALF, and the set is stated here rather than derived from the
  // register for the reason the whole SCOPE_ARTIFACTS list is: this is an
  // independent statement of what the scope amendment authorised. The user
  // lifted the exclusion for mosd/mosd/src/main.rs and mosd/apid/src/main.rs.
  // mos-mqttd and mos-mqtt-broker are built by the same script from the same
  // workspace and were NOT named, so they do not embed a commit -- and if a
  // later change gives them one, this test is where that has to be argued for.
  test('exactly the two files the amendment named embed a build commit', () => {
    const embedding = ARTIFACTS.filter(a => a.embedsBuildCommit === true).map(a => a.name)
    expect(embedding.sort()).toEqual(['apid', 'mosd'])

    // ...and the other ten say nothing rather than `false`, which is the same
    // thing to the runner. Asserted so a future entry cannot claim a commit by
    // accident and go red against a record that says nothing about it.
    const silent = ARTIFACTS.filter(a => a.embedsBuildCommit !== true)
    expect(silent.length).toBe(ARTIFACTS.length - 2)
    expect(silent.map(a => a.name)).not.toContain('mosd')
  })
})

describe('pinCoverageFaults -- forward, and driven red', () => {
  test('the shipped register agrees with the shipped pin files', () => {
    expect(pinCoverageFaults()).toEqual([])
  })

  // THE VACUITY CONTROL FOR THE LINE ABOVE. `[]` is what an empty search space
  // returns too, so the green is only evidence if the sets it compared were
  // populated. Measured here rather than assumed: this repository has shipped a
  // lint reporting 26/26 PASS while a whole board was invisible to it.
  test('the green above is over a populated search space', () => {
    expect(ARTIFACTS.length).toBeGreaterThan(0)
    expect(VERSIONS_ENV_FILES.length).toBeGreaterThan(0)
    let pins = 0
    for (const f of VERSIONS_ENV_FILES) pins += pinKeys(f).length
    expect(pins).toBeGreaterThan(1)
  })

  test('an entry whose pin cannot be read is a fault naming the artifact', () => {
    const broken: Artifact = {
      name: 'ghost',
      path: '/usr/bin/ghost',
      pin: () => {
        throw new Error('GHOST_VERSION is not in any file')
      },
      contract: { kind: 'version', argv: ['--version'] },
    }
    const faults = pinCoverageFaults([...ARTIFACTS, broken])
    expect(faults.some(f => f.message.includes('ghost') && f.message.includes('GHOST_VERSION'))).toBe(true)
  })
})

describe('pinCoverageFaults -- reverse, the direction that catches a NEW artifact', () => {
  // This is the whole point of the pairing. Drop the entry that claims
  // CRUN_VERSION and the forward direction is still perfectly happy: every
  // remaining entry reads a key that exists. Only the reverse direction
  // notices that a binary this tree builds and ships is no longer executed.
  test('a pin no artifact reads is a fault, naming the key and both explanations', () => {
    const withoutCrun = ARTIFACTS.filter(a => a.name !== 'crun')
    // The mutation is a mutation: crun was there to be removed.
    expect(withoutCrun.length).toBe(ARTIFACTS.length - 1)

    const faults = pinCoverageFaults(withoutCrun)
    expect(faults.length).toBe(1)
    expect(faults[0]!.file).toBe(PODMAN_VERSIONS_ENV)
    expect(faults[0]!.message).toContain('CRUN_VERSION')
    expect(faults[0]!.message).toMatch(/would have reported a full green while never executing it/)
  })

  test('two artifacts may share one pin -- quadlet and podman do, and that is not a fault', () => {
    const readers = ARTIFACTS.filter(a => a.pin().key === 'PODMAN_VERSION').map(a => a.name)
    expect(readers.sort()).toEqual(['podman', 'quadlet'])
    expect(pinCoverageFaults()).toEqual([])
  })

  test('dropping ONE of two readers of a shared pin is not a fault, and dropping both is', () => {
    // The half-measure: podman goes, quadlet still claims the key.
    const withoutPodman = ARTIFACTS.filter(a => a.name !== 'podman')
    expect(withoutPodman.length).toBe(ARTIFACTS.length - 1)
    expect(pinCoverageFaults(withoutPodman)).toEqual([])

    // And with both gone the key is orphaned.
    const withoutBoth = ARTIFACTS.filter(a => a.name !== 'podman' && a.name !== 'quadlet')
    expect(withoutBoth.length).toBe(ARTIFACTS.length - 2)
    const faults = pinCoverageFaults(withoutBoth)
    expect(faults.length).toBe(1)
    expect(faults[0]!.message).toContain('PODMAN_VERSION')
  })

  test('a versions.env with no version pins at all is a fault, not a vacuous pass', () => {
    // A "this set is empty" check over a file that has been emptied, moved or
    // renamed passes forever. It is the failure this repository has already
    // paid for elsewhere, so it is named here rather than tolerated.
    const empty = fixture('emptied.env', '# every pin was moved out of this file\n')
    const faults = pinCoverageFaults(ARTIFACTS, [empty])
    expect(faults.length).toBe(1)
    expect(faults[0]!.message).toContain('declares no *_VERSION at all')
  })

  test('an unrelated pin file with an unclaimed key is a fault', () => {
    const extra = fixture('newthing.env', 'NEWTHING_VERSION=v0.1.0\nNEWTHING_SHA256=abc\n')
    const faults = pinCoverageFaults(ARTIFACTS, [...VERSIONS_ENV_FILES, extra])
    expect(faults.length).toBe(1)
    expect(faults[0]!.file).toBe(extra)
    expect(faults[0]!.message).toContain('NEWTHING_VERSION')
    // ...and the SHA256 half is not reported, because it is not a version.
    expect(faults[0]!.message).not.toContain('NEWTHING_SHA256')
  })

  test('the rauc pin is read from its own file, not from the podman one', () => {
    const rauc = ARTIFACTS.find(a => a.name === 'rauc')!
    expect(rauc.pin().file).toBe(RAUC_VERSIONS_ENV)
    expect(rauc.pin().key).toBe('RAUC_VERSION')
  })
})
