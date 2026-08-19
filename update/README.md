# update

Server-side update tooling (PLAN-006 Part L). Everything here runs on a release
build host, never on a device, and its output is static content: a directory that
any HTTP server or object store can serve unchanged.

## Contents

- `sign/` — `mos-sign`, the TUF signing tool (phase 1, RFCT-016). Creates and
  maintains the static TUF repository that pins RAUC bundles.
- `lockbox/` — planned: offline update bundle builder (USB/SD "lockbox" carrying
  the same bundle plus full metadata).
- delta needs no tooling: RAUC adaptive updates work against the plain bundle
  over HTTP range requests.

## Phase-1 scope of `sign/`

`mos-sign` implements the repository half of the trust model in PLAN-006 Part A:
the four TUF top-level roles (`root`, `targets`, `snapshot`, `timestamp`), a
sign/verify roundtrip, and target metadata that pins each RAUC bundle's sha256,
length and dm-verity root hash.

Explicitly **not** phase 1, and not implemented here:

- the on-device Uptane client (metadata fetch, ECU manifest, install gating);
- the Uptane director/image repository split — this is a single image repository;
- delegated targets roles, root key rotation, and hardware-backed key stores;
- RAUC's own CMS bundle signature, which is a separate key hierarchy applied by
  `rauc bundle` at build time.

The verity root hash is passed to `mos-sign add` as an argument. The tool never
shells out to `rauc`, so it has no dependency on the image pipeline.

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
`timestamp` keys.

Generate throwaway development keys:

```sh
cargo run -p mos-sign -- gen-dev-keys          # writes update/sign/.devkeys/
```

`update/sign/.devkeys/` is gitignored and `gen-dev-keys` refuses to overwrite an
existing key. No key, certificate or seed is ever committed to this repository,
and the tests generate their own keys into a temporary directory at runtime.

## Usage

```sh
# one-time repository creation (needs the offline root key)
cargo run -p mos-sign -- init \
  --repo _out/tuf \
  --root-expires 2027-01-01T00:00:00Z \
  --targets-expires 2027-01-01T00:00:00Z \
  --snapshot-expires 2026-11-01T00:00:00Z \
  --timestamp-expires 2026-09-01T00:00:00Z

# publish a release bundle (online keys only)
cargo run -p mos-sign -- add \
  --repo _out/tuf \
  --target _out/cx3576/update-1.0.0.raucb \
  --verity-root-hash <64 hex chars from the RAUC bundle> \
  --release-version 1.0.0 \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...

# refresh timestamp/snapshot before they expire (online keys only)
cargo run -p mos-sign -- sign --repo _out/tuf \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ... [--timestamp-version N]

# offline verification against a trusted root
cargo run -p mos-sign -- verify --repo _out/tuf --root <trusted root.json> [--datastore _out/tuf-trusted]
```

All expiration instants are explicit RFC 3339 arguments. Nothing derives an
expiration from the wall clock, so a release is reproducible and tests are
deterministic. `--root-expires` exists only on `init`, because `root.json` is the
one role the online path never re-signs. `--datastore` persists the last trusted
metadata, which is what makes rollback detection work across invocations.

## Checks

`mos-sign` is a member of the `mosd/` cargo workspace, so it is covered by the
single project gate:

```sh
bash mosd/hack/check.sh
```
