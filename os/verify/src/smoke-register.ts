// The twelve artifacts this repository BUILDS, where each one lands in the
// factory root, and how each one is asked what version it is.
//
// RFCT-113 M7b. The task's Scope names eleven -- mosd, apid, mos-mqttd,
// mos-mqtt-broker, rauc, podman, quadlet, crun, conmon, netavark, aardvark-dns
// -- plus catatonit, and until M7 the last thing done to any of them was to
// LINK them. "It linked", "it runs" and "it is the version we decided" are
// three different claims, and only the first was ever checked before an image
// shipped.
//
// ═══ WHY THIS LIST IS NOT THE "SECOND LIST" THE CAMPAIGN KEEPS DELETING ═══
//
// It carries no version STRING. Every `pin` below is a function that reads the
// value out of the file that owns it, at run time -- see smoke-pins.ts. What is
// written down here is identity (which artifact, which installed path, which
// key) and never a value, which is the distinction between a register and a
// copy. `TOOL_PACKAGES` copied from an `apk add` line was a copy; so was the
// hwinit list that drifted and cost the image its stable MAC.
//
// The set itself is checked in BOTH DIRECTIONS by `pinCoverageFaults` below,
// which is run by the smoke runner rather than only by its tests: every
// `*_VERSION` in every `versions.env` must be claimed by an entry here, and
// every entry's key must exist in the file it names. Without the first
// direction, adding an eighth binary to `os/podman/` -- with its pin, its hash
// and its install line -- would leave this register reporting a full green over
// seven of eight, and a check that gets greener by looking at less is the
// failure this package exists to make visible.
//
// ═══ THE INSTALLED PATHS ARE MEASURED, NOT ASSUMED ═══
//
// Five of the seven container binaries are NOT in /usr/bin.
// `os/rootfs/scripts/podman-install.sh` puts podman and crun there and the
// other five under /usr/libexec/podman/, and it writes the five with
// `install -m0755 "/tmp/podman/${b}" "/usr/libexec/podman/${b}"` -- a
// ${VAR}-assembled destination, so the literal path appears nowhere in the
// script and no grep of it could confirm these. They were found by running the
// wrong path and reading rc=127 back out of the real image, and a wrong path
// here fails the same loud way rather than passing quietly.
//
// ═══ THE TWO THAT CANNOT ANSWER ═══
//
// mosd and apid have no `--version` contract, and that is not an oversight
// here -- it is a property of the binaries, measured inside the real x64
// factory root and recorded on each entry. They are UNCLAIMED, which is a third
// verdict rather than a pass or a skip, for the reason the M4a check register
// gave when it was empty: a conclusion nobody reached must not report as one
// that was reached and held.

import { cratePath, readCratePackageVersion, readPin, pinKeys, type Pin } from './smoke-pins.ts'
import { PODMAN_VERSIONS_ENV, RAUC_VERSIONS_ENV, VERSIONS_ENV_FILES } from './smoke-pins.ts'

/**
 * How an artifact is asked what it is.
 *
 * `version` asserts BOTH halves of the Scope sentence -- exit 0 AND reported
 * version == the recorded pin -- so it is strictly stronger than `exec`, which
 * asserts only the first. `unclaimed` asserts neither and is never invoked at
 * all; it exists so that "we did not check this" is a thing the output can say.
 */
export type Contract =
  | { readonly kind: 'version'; readonly argv: readonly string[] }
  | { readonly kind: 'exec'; readonly argv: readonly string[] }
  | { readonly kind: 'unclaimed'; readonly why: string }

export interface Artifact {
  /** The binary's name, as Scope spells it. */
  readonly name: string
  /** Its installed path INSIDE the factory root. Not a host path. */
  readonly path: string
  /**
   * The recorded version, read from its own file when the runner asks.
   *
   * A function and not a value: a `Pin` computed at module load would be read
   * once per process, and the negative test that proves the version loop closes
   * edits a `versions.env` and re-reads it. More importantly it would put the
   * read at import time, where a malformed file becomes an import error in
   * every test in the package rather than a failure of the one thing that reads
   * it.
   */
  readonly pin: () => Pin
  readonly contract: Contract
}

/** The container engine's shared pin file, named once per entry rather than per line. */
const podman = (key: string) => () => readPin(PODMAN_VERSIONS_ENV, key)
const crate = (name: string) => () => readCratePackageVersion(cratePath(name))

export const ARTIFACTS: readonly Artifact[] = [
  // ─── The four this repository writes in Rust ──────────────────────────────
  //
  // Their recorded version is the `[package] version` of the crate that builds
  // them, which is the only place this tree records one for them: there is no
  // `mosd/versions.env`, because a pin file exists to fix an UPSTREAM version
  // and these have no upstream.
  {
    name: 'mosd',
    path: '/usr/bin/mosd',
    pin: crate('mosd'),
    contract: {
      kind: 'unclaimed',
      why:
        'mosd parses no argv and has no --version. MEASURED in the x64 factory root: '
        + '`/usr/bin/mosd --version` IGNORES the flag and starts the daemon -- it ran first-boot '
        + 'provisioning (hostname=mos-<id>, seeded_generation=1, state_dir=/var/lib/mos) and then '
        + 'exited 1 on the absent system bus. So all three halves of the Scope sentence fail at '
        + 'once: no version is reported, the exit status is not 0, and the invocation is not '
        + 'minimal -- it MUTATES. Confirmed at the source, driven from the failing side: '
        + 'grep for args()/args_os/env::args/CARGO_PKG_VERSION/clap over mosd/mosd/src/ returns 0 '
        + 'hits across 21 .rs files, while the same grep shape for `async fn` hits 17 of them and '
        + 'mosd/mqttd/Cargo.toml declares clap. Closing this means editing mosd/mosd/src/main.rs, '
        + 'which is `mosd/` Rust sources -- excluded by PLAN-014 Scope:243 and reaffirmed at :256. '
        + 'FINDING IS IN SCOPE, ACTING IS NOT.',
    },
  },
  {
    name: 'apid',
    path: '/usr/bin/apid',
    pin: crate('apid'),
    contract: {
      kind: 'unclaimed',
      why:
        'apid parses no argv and has no --version. MEASURED in the x64 factory root: '
        + '`/usr/bin/apid --version` IGNORES the flag, generates a self-signed certificate and a '
        + 'session signing key into /var/lib/mos/apid, binds 0.0.0.0:443 and 0.0.0.0:80, prints '
        + 'APID_LISTENING and NEVER EXITS -- rc=124 against a 25s budget. It is the same three '
        + 'failures as mosd and one worse: a smoke run that invoked it would hang rather than go '
        + 'red. Confirmed at the source the same way: 0 hits across 19 .rs files. Closing it means '
        + 'editing mosd/apid/src/main.rs, excluded by PLAN-014 Scope:243 and :256.',
    },
  },
  {
    name: 'mos-mqttd',
    path: '/usr/bin/mos-mqttd',
    pin: crate('mqttd'),
    // The two crates that CAN answer are the two that declare clap and carry
    // `#[command(name = ..., version)]`, which emits CARGO_PKG_VERSION -- so
    // the value compared is literally the manifest's, one file, two readers.
    contract: { kind: 'version', argv: ['--version'] },
  },
  {
    name: 'mos-mqtt-broker',
    path: '/usr/bin/mos-mqtt-broker',
    pin: crate('broker'),
    contract: { kind: 'version', argv: ['--version'] },
  },

  // ─── RAUC, built from source by os/update/rauc/ ───────────────────────────
  {
    name: 'rauc',
    path: '/usr/bin/rauc',
    pin: () => readPin(RAUC_VERSIONS_ENV, 'RAUC_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },

  // ─── The container engine, built from source by os/podman/ ────────────────
  {
    name: 'podman',
    path: '/usr/bin/podman',
    pin: podman('PODMAN_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },
  {
    // Quadlet ships OUT OF THE PODMAN TREE and carries podman's version, which
    // is why two entries read one key. That is the shape `pinCoverageFaults`
    // requires "at least one claimant" rather than "exactly one" for: a pin with
    // two readers is correct here, a pin with none is the drift being guarded.
    //
    // It is also the only artifact whose --version output is the bare number,
    // `5.8.6`, with no program name in front of it. Nothing here depends on the
    // shape -- `versionTokens` reads the numbers out of whatever is printed --
    // which is exactly why no per-artifact output parser is written down.
    name: 'quadlet',
    path: '/usr/libexec/podman/quadlet',
    pin: podman('PODMAN_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },
  {
    name: 'crun',
    path: '/usr/bin/crun',
    pin: podman('CRUN_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },
  {
    name: 'conmon',
    path: '/usr/libexec/podman/conmon',
    pin: podman('CONMON_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },
  {
    name: 'netavark',
    path: '/usr/libexec/podman/netavark',
    pin: podman('NETAVARK_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },
  {
    name: 'aardvark-dns',
    path: '/usr/libexec/podman/aardvark-dns',
    pin: podman('AARDVARK_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },
  {
    // CATATONIT IS A `version` ENTRY AND SCOPE SAYS "exec-only". Ruled by the
    // user on L2's recommendation: BOTH checks, Scope's PREMISE recorded as
    // measured-false, and the clause text left exactly as written.
    //
    // WHAT IS WRONG WITH SCOPE IS ITS PREMISE, NOT ITS INSTRUCTION, and the
    // distinction is the whole reason this is a correction a gate may make
    // rather than an amendment it may not. Scope's parenthesis reads "catatonit
    // (static, no --version contract)". MEASURED in the x64 factory root on
    // 2026-08-26: `/usr/libexec/podman/catatonit --version` exits 0 and prints
    // `tini version 0.2.1_catatonit` -- catatonit is a fork of tini and keeps
    // its banner. The contract exists. Recording that a stated fact is false is
    // a measurement; rewriting the sentence built on it would be an amendment,
    // and nothing here does the second.
    //
    // And the Acceptance clause points the other way from the Scope bullet.
    // "The version loop is closed: bumping a `versions.env` pin without
    // rebuilding the artifact turns the smoke run red" is FALSE for
    // CATATONIT_VERSION if nothing here reads it -- the pin would be a value
    // with no reader, which is the same defect class as a check that cannot
    // fail.
    //
    // The exec-only conjunct is DISCHARGED, not dropped: a `version` contract
    // asserts exit 0 exactly as an `exec` one does, and asserts the output on
    // top. Scope says catatonit "gets an exec-only check", not "gets only an
    // exec-only check".
    //
    // ═══ THE NORMALISATION, STATED, BECAUSE THIS IS WHERE IT COULD GO SOFT ═══
    //
    // The pin is `CATATONIT_VERSION=v0.2.1` and the binary says
    // `tini version 0.2.1_catatonit`. Neither string contains the other, so the
    // comparison needs two deliberate steps and it gets exactly two:
    //
    //   PIN SIDE     `expectedFromRecorded` strips a leading `v` that is
    //                immediately followed by a digit: `v0.2.1` -> `0.2.1`.
    //                It is the git TAG prefix and no `--version` output in this
    //                image carries it.
    //   OUTPUT SIDE  `versionTokens` takes MAXIMAL runs of digits-and-dots out
    //                of the reported line: `tini version 0.2.1_catatonit` ->
    //                exactly `["0.2.1"]`. The `_catatonit` suffix is upstream's
    //                fork marker, it is not part of the version number, and it
    //                terminates the token rather than being trimmed by a rule
    //                written for this one artifact.
    //
    // Then `"0.2.1" === "0.2.1"` -- EQUALITY against an extracted token, never
    // a substring test. A LOOSE `includes()` ON THE RAW LINE WOULD PASS ON
    // ALMOST ANYTHING: `"tini version 0.2.1_catatonit".includes("0.2.1")` is
    // true, and so is `.includes("0.2")`, and so is `.includes("2.1")`, and a
    // pin of `0.2.10` would be satisfied by a `0.2.1` binary in the other
    // direction. That is a version check that cannot fail, and
    // `smoke.test.ts` drives THIS artifact from the failing side with a wrong
    // pin rather than trusting the shape.
    //
    // If upstream ever removes the banner this entry goes red with a message
    // naming the output it got -- a one-line register change and a visible one,
    // rather than a pin nobody would notice had stopped being checked.
    name: 'catatonit',
    path: '/usr/libexec/podman/catatonit',
    pin: podman('CATATONIT_VERSION'),
    contract: { kind: 'version', argv: ['--version'] },
  },
]

/**
 * THE ONLY ARTIFACTS ALLOWED TO BE `unclaimed`, and the record of who allowed it.
 *
 * A SECOND PLACE TO EDIT, ON PURPOSE, and the one deliberate duplication in
 * this file. Everything else here is written once precisely so it cannot drift;
 * this is written twice precisely so it cannot MOVE without somebody deciding
 * that it should.
 *
 * WHAT IT DEFENDS. `unclaimed` is the verdict that lets the run stay
 * non-green without failing, and a category like that decays in one direction
 * only: something loses its `--version`, somebody marks it unclaimed to get the
 * pipeline moving, and the gate quietly stops asking. Nothing about the
 * resulting run looks different -- the summary already says INCOMPLETE, it just
 * says it about three things instead of two. So the set is DECLARED, and
 * `pinCoverageFaults` refuses any run whose register disagrees with this list.
 * Adding a third means editing the entry AND this constant AND the lock in
 * smoke-register.test.ts: three edits, in one diff, that a reviewer reads.
 *
 * IT IS NEVER INFERRED. There is deliberately no code path that computes
 * "this binary did not answer, so call it unclaimed" -- that is the runtime
 * inference the classification exists to prevent, and it would turn a REGRESSION
 * (a binary that lost its `--version`) into a category membership nobody chose.
 * A binary that is asked for a version and does not give one is a FAIL.
 *
 * WHY THESE TWO, AND FOR HOW LONG. mosd and apid parse no argv at all; each
 * entry above carries the measurement. The user LIFTED PLAN-014's `mosd/`
 * exclusion on 2026-08-26 for exactly one change -- a `--version` handler in
 * `mosd/mosd/src/main.rs` and `mosd/apid/src/main.rs` that reports the crate
 * version and exits 0 BEFORE any daemon initialisation, provisioning, bus
 * connection or key generation. That ordering is the point: what was measured
 * is not merely that the two cannot answer, but that asking MUTATES -- mosd
 * wrote a hostname and a seeded generation into /var/lib/mos, apid generated a
 * TLS keypair and a session signing key.
 *
 * M7d writes those handlers. When they land, both names move from UNCLAIMED to
 * PASS and this constant becomes empty -- which is the proof the fix landed,
 * and the reason this classification is a mechanism rather than a placeholder.
 */
export const EXPECTED_UNCLAIMED: readonly string[] = ['apid', 'mosd']

/** A register/pin-file disagreement, in the words the runner refuses with. */
export interface CoverageFault {
  readonly file: string
  readonly message: string
}

/**
 * The register's `unclaimed` set against the list that authorises it.
 *
 * Separate from `pinCoverageFaults` because it is a different question -- that
 * one asks whether the register and the pin files agree about which artifacts
 * exist, this one asks whether anybody decided that an artifact may go
 * unasked. Both are called by `smokeRun` before anything is executed.
 */
export function unclaimedFaults(
  artifacts: readonly Artifact[] = ARTIFACTS,
  allowed: readonly string[] = EXPECTED_UNCLAIMED,
): CoverageFault[] {
  const actual = artifacts.filter(a => a.contract.kind === 'unclaimed').map(a => a.name).sort()
  const want = [...allowed].sort()
  if (actual.join(' ') === want.join(' ')) return []

  const added = actual.filter(n => !want.includes(n))
  const removed = want.filter(n => !actual.includes(n))
  const parts: string[] = []
  if (added.length > 0) {
    parts.push(
      `${added.join(', ')} ${added.length === 1 ? 'is' : 'are'} marked unclaimed and NOT in `
      + `EXPECTED_UNCLAIMED. An artifact may only go unasked if somebody decided it should: an `
      + `unclaimed entry is the one verdict that keeps a run non-green without failing it, so a `
      + `set that can grow on its own is a gate that can stop asking on its own. If this is `
      + `deliberate, add the name to EXPECTED_UNCLAIMED and to the lock in `
      + `smoke-register.test.ts, and record who decided. If it is a binary that LOST its `
      + `--version, it is a FAIL, not a category.`,
    )
  }
  if (removed.length > 0) {
    parts.push(
      `${removed.join(', ')} ${removed.length === 1 ? 'is' : 'are'} in EXPECTED_UNCLAIMED and no `
      + `longer marked unclaimed. That is the GOOD direction -- it is what landing a --version `
      + `handler looks like -- and it still fails here, because the constant is the record of what `
      + `is outstanding and a stale record understates the gap. Remove the name and say so.`,
    )
  }
  return [{ file: 'os/verify/src/smoke-register.ts', message: parts.join(' ') }]
}

/**
 * Both directions between the register and the `versions.env` files.
 *
 * FORWARD -- every entry's key exists in the file it names. Catches a typo, and
 * a key that a `versions.env` rename left behind.
 *
 * REVERSE -- every `*_VERSION` in every `versions.env` is claimed by at least
 * one entry. This is the direction that matters and the one a forward-only
 * check passes happily without: it is what makes a NEW self-built artifact
 * unable to arrive unchecked. `docs/verify-index.sh` earned this pairing the
 * hard way -- its forward half was a `grep -q`, equally satisfied by one
 * occurrence or five, and the tree carried a duplicated index row through a
 * reported 162/162 PASS.
 *
 * Run by `smokeRun`, not only by tests: a register that has fallen behind must
 * refuse a real run, not merely fail a suite somebody might not be running.
 *
 * `artifacts` and `files` are parameters so both directions are REACHABLE from
 * a test. A guard that can only fire when the shipped tree is broken is a guard
 * nobody has ever run.
 */
export function pinCoverageFaults(
  artifacts: readonly Artifact[] = ARTIFACTS,
  files: readonly string[] = VERSIONS_ENV_FILES,
): CoverageFault[] {
  const faults: CoverageFault[] = []

  // Forward. Reading the pin is the check: readPin throws, naming the file, the
  // key and the keys that are there.
  const claimed = new Map<string, Set<string>>()
  for (const a of artifacts) {
    let pin: Pin
    try {
      pin = a.pin()
    } catch (e) {
      faults.push({
        file: '(unresolved)',
        message: `${a.name}'s recorded version could not be read: ${(e as Error).message}`,
      })
      continue
    }
    const keys = claimed.get(pin.file) ?? new Set<string>()
    keys.add(pin.key)
    claimed.set(pin.file, keys)
  }

  // Reverse. Only over the versions.env files -- a crate manifest is not one of
  // these and has exactly one version key by construction.
  for (const file of files) {
    const keys = pinKeys(file)
    if (keys.length === 0) {
      faults.push({
        file,
        message:
          `declares no *_VERSION at all. That is not an empty set to be satisfied vacuously: this `
          + `file exists to pin versions, so zero of them means it was moved, renamed or emptied, `
          + `and a coverage check over nothing passes forever.`,
      })
      continue
    }
    const seen = claimed.get(file) ?? new Set<string>()
    for (const key of keys) {
      if (seen.has(key)) continue
      faults.push({
        file,
        message:
          `${key} is pinned here and no artifact in the smoke register reads it. Either a new `
          + `self-built binary arrived without being added to os/verify/src/smoke-register.ts -- in `
          + `which case the smoke run would have reported a full green while never executing it -- `
          + `or the pin outlived the artifact and should go. Both are edits; neither is a pass.`,
      })
    }
  }
  return faults
}
