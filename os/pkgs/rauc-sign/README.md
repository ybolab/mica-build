# rauc-sign

Update trust tooling (PLAN-006 Part A/L). This one crate carries both
halves of the TUF trust model because they share one metadata format:

- the **release side** (`rauc-sign`, phase 1): runs on a build host, never on a
  device, and its output is static content — a directory that any HTTP server
  or object store can serve unchanged;
- the **device side** (`rauc-verify`, phase 2, first half): verifies a
  LOCAL copy of that directory from a pinned trusted root, with persistent
  rollback protection. It exists and is exercised offline by the test suite;
  nothing ships it to a device yet (see the provisioning section below).

## Contents

Two binaries, both from cargo's auto-discovery — there is no `[[bin]]` section,
so each binary's name is the thing that declares it:

- `rauc-sign` — the TUF signing tool (phase 1, RFCT-016). Creates and
  maintains the static TUF repository that pins RAUC bundles. Named by the
  package, with `src/main.rs`.
- `rauc-verify` — the device-side metadata and target verifier
  (phase 2 first half, RFCT-088). Walks the metadata from a pinned root and
  prints a verified local target path for an installer to consume. Named by
  its own filename, `src/bin/rauc-verify.rs`.

Two neighbours that are deliberately not here:

- an offline update bundle builder (the USB/SD "lockbox" carrying the same
  bundle plus full metadata) is planned and unwritten;
- delta needs no tooling: RAUC adaptive updates work against the plain bundle
  over HTTP range requests.

## Phase-1 scope of `rauc-sign`

`rauc-sign` implements the repository half of the trust model in PLAN-006 Part
A: the four TUF top-level roles (`root`, `targets`, `snapshot`, `timestamp`),
a sign/verify roundtrip, and target metadata that pins each RAUC bundle's
sha256, length and dm-verity root hash.

Explicitly out of scope for the whole crate, still:

- the Uptane director/image repository split — this is a single image
  repository;
- delegated targets roles, root key rotation, and hardware-backed key stores
  (the client inherits tough's root-chain walk, but the signer cannot yet
  produce a rotation, so the chain is depth one in practice);
- transport: nothing here fetches metadata over a network, on either side;
- mosd's install orchestration (RAUC install/confirm) — named as roadmap by
  RFCT-083;
- RAUC's own CMS bundle signature, which is a separate key hierarchy applied
  by `rauc bundle` at build time.

The verity root hash is passed to `rauc-sign add` as an argument. The tool never
shells out to `rauc`, so it has no dependency on the image pipeline.

## Phase 2, first half: the device-side verifier

`rauc-verify` is the client the phase-1 attacker tests were modelled
against. It performs the TUF client walk over a local repository directory —
root chain from the pinned trusted root, then timestamp → snapshot → targets —
enforcing per-role signature thresholds, expiries, version pins, and metadata
hash/length pins, and refusing shapes the signer never produces (a root
missing one of the four roles, targets metadata with delegated roles).

On top of the walk it keeps the device's memory: a JSON state file recording
the highest verified version per role, written atomically (temp file, fsync,
rename, directory fsync). A validly signed but **older** repository is
rejected against that state, so rollback protection survives restarts. The
state file must live on persistent writable storage; a rejection never
advances it, and a corrupt state file is an error rather than a silent reset.

The interface is deliberately boring and scriptable — exit 0 means verified,
any other exit means not verified with a one-line reason on stderr:

```sh
# verify the metadata walk; records/enforces per-role versions in the state file
rauc-verify --repo <dir> --root <pinned root.json> --state <state.json>
# OK root v1 targets v2 snapshot v2 timestamp v2

# additionally verify one target's bytes (sha256 + length) and print its
# verified local path, ready to hand to an installer
rauc-verify --repo <dir> --root <pinned root.json> --state <state.json> \
  --target update-1.0.0.raucb
# <dir>/targets/<sha256>.update-1.0.0.raucb
```

What the second half of phase 2 still owes: transport (fetching the repository
onto the device), the mosd orchestration that calls this verifier and RAUC,
and the provisioning below.

## Trust anchor provisioning

The honest state: **the verifier exists and is exercised offline; no shipped
mechanism delivers the pinned `root.json` to a device.** Verification is only
as trustworthy as the channel that delivered the root, so this is a decision
to be made deliberately, not defaulted. Candidate paths, none implemented:

- **Image-baked** `/usr/share/mos/uptane/root.json` **[not implemented]** —
  the root ships inside the (dm-verity protected, RAUC-signed) OS image.
  Simplest and the strongest binding: the root is exactly as trustworthy as
  the image that carries it, and a root rotation rides an ordinary OS update.
  Tradeoff: rotating the TUF root *requires* shipping an image through the
  RAUC channel, so the TUF hierarchy cannot outlive a compromise of the image
  signing path — the two hierarchies stand or fall together.
- **Provisioning file** on STATE/META, written at factory or first-boot
  provisioning **[not implemented]** — decouples the trust anchor from the
  image, allowing per-fleet or per-customer roots. Tradeoff: the provisioning
  flow becomes security-critical, the anchor lives on mutable storage (so it
  needs its own integrity story, e.g. only ever replaced via a root chain the
  verifier already walks), and a device that loses STATE loses its anchor.
- **Signed USB import** **[not implemented]** — an operator carries
  `root.json` (or a full lockbox) on removable media; the device accepts a new
  root only if it chains from the currently pinned one (the TUF root rotation
  rule), or on explicit physical-presence action for first provisioning.
  Fits the offline "lockbox" story; tradeoff: first-time trust still has to
  come from somewhere (factory default or physical ceremony), and the import
  path is an attack surface that must enforce the chain rule strictly.

Until one of these is chosen and built, `rauc-verify` is a tool a test
(or a person with a shell) points at a directory — that is the whole truth of
its deployment status.

## Repository layout produced

```text
<repo>/metadata/root.json         bootstrap copy of the highest <n>.root.json
<repo>/metadata/targets.json      alias of the highest <n>.targets.json
<repo>/metadata/snapshot.json     alias of the highest <n>.snapshot.json
<repo>/metadata/timestamp.json
<repo>/metadata/<n>.root.json     consistent-snapshot metadata
<repo>/metadata/<n>.targets.json
<repo>/metadata/<n>.snapshot.json
<repo>/targets/<sha256>.<name>    hash-prefixed target files
```

Consistent snapshots are on, so target files carry their sha256 as a filename
prefix, as TUF requires. The unversioned metadata aliases exist so a client can
be pointed at fixed URLs and so `root.json` can be shipped as the trusted root.

## Keys

Four ed25519 keys, one per role, stored as raw PKCS#8 documents named
`<role>.pk8`.

`root` is an **offline** key. It signs `root.json` at `init` time and is not
needed afterwards: `add` and `sign` only load the `targets`, `snapshot` and
`timestamp` keys. The device side handles public material only: it reads
metadata and a pinned root, never a `.pk8`.

Generate throwaway development keys:

```sh
cargo run -p rauc-sign -- gen-dev-keys          # writes os/pkgs/rauc-sign/.devkeys/
```

`os/pkgs/rauc-sign/.devkeys/` is gitignored and `gen-dev-keys` refuses to overwrite an
existing key. No key, certificate or seed is ever committed to this repository,
and the tests generate their own keys into a temporary directory at runtime.

## Usage

```sh
# one-time repository creation (needs the offline root key)
cargo run -p rauc-sign -- init \
  --repo _out/tuf \
  --root-expires 2027-01-01T00:00:00Z \
  --targets-expires 2027-01-01T00:00:00Z \
  --snapshot-expires 2026-11-01T00:00:00Z \
  --timestamp-expires 2026-09-01T00:00:00Z

# publish a release bundle (online keys only)
cargo run -p rauc-sign -- add \
  --repo _out/tuf \
  --target _out/cx3576/update-1.0.0.raucb \
  --verity-root-hash <64 hex chars from the RAUC bundle> \
  --release-version 1.0.0 \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...

# refresh timestamp/snapshot before they expire (online keys only)
cargo run -p rauc-sign -- sign --repo _out/tuf \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ... [--timestamp-version N]

# release-side offline verification against a trusted root
cargo run -p rauc-sign -- verify --repo _out/tuf --root <trusted root.json> [--datastore _out/tuf-trusted]

# device-side verification (pinned root + persistent version state)
cargo run -p rauc-sign --bin rauc-verify -- \
  --repo _out/tuf --root <pinned root.json> --state _out/uptane-state.json \
  [--target update-1.0.0.raucb]
```

All expiration instants are explicit RFC 3339 arguments. Nothing derives an
expiration from the wall clock, so a release is reproducible and tests are
deterministic. `--root-expires` exists only on `init`, because `root.json` is the
one role the online path never re-signs. `rauc-sign verify --datastore` persists
the last trusted metadata for the release side; the device side's equivalent is
the mandatory `--state` file.

## Checks

This crate is **its own cargo workspace**, so `mosd/hack/check.sh` does not
cover it — that script's `--workspace` flags stop at the mosd members. The gate
for this code is its twin, next to the crate:

```sh
bash os/pkgs/rauc-sign/hack/check.sh
```

Same five checks in the same order, against this workspace's own `Cargo.lock`
and `deny.toml`. `.github/workflows/check.yml` runs both scripts, and the
second one is the only thing on that job that checks this code.

The device-side client is tested against the same in-repo fixture the signer
tests use (`os/pkgs/rauc-sign/tests/`): the honest publish sequence verifies, and a
published rollback, a tampered target, a tampered-metadata edit, expired
metadata, and an unmet root threshold are each rejected.
