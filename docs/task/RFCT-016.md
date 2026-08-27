# RFCT-016 update/sign: TUF (tough) signing skeleton

- **status**: completed — implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: 2026-08-18 04:15

## Description

PLAN-006 phase 1 of the Uptane trust layer (Parts A and L): a server-side TUF
repository layout plus a sign/verify roundtrip, delivered as `update/sign`
(`mos-sign`). The full Uptane director/image split, the on-device client,
rollback/freeze protection on device and root key rotation are later phases and
are out of scope here. The task is independent of the image pipeline: the RAUC
bundle's dm-verity root hash is taken as an argument, never discovered by
shelling out to `rauc`.

Scope / deliverables:

1. `update/sign` crate (`mos-sign`, binary + library) as a member of the
   existing `mosd/` cargo workspace.
2. CLI: `gen-dev-keys`, `init`, `add`, `sign`, `verify`.
3. Static repository layout: `metadata/{root,timestamp,snapshot,targets}.json`
   plus consistent-snapshot `<n>.<role>.json`, and `targets/<sha256>.<name>`.
4. ed25519 keys, root offline, dev key material gitignored.
5. Tests: roundtrip, two tamper cases, rollback, expiry.
6. `update/README.md` rewritten; this task record.

Work checklist:

- [x] Workspace decision + crate skeleton
- [x] Dependency audit of the `tough` family (see Key decisions)
- [x] `init` / `add` / `sign` / `verify` / `gen-dev-keys`
- [x] Test suite (5 tests, all in `TempDir`, no host state, no network)
- [x] `.gitignore` for `update/sign/.devkeys/`
- [x] Docs

## Key decisions

### Workspace: extend `mosd/`, do not stand up a second one

`update/sign` is a path member of the existing `mosd/` workspace
(`members = [..., "../update/sign"]`). One lockfile, one `deny.toml`, one
`hack/check.sh` gate, no second CI surface. Because the crate directory is
outside the workspace root directory, cargo cannot auto-discover the workspace
root by walking up, so `update/sign/Cargo.toml` names it explicitly with
`workspace = "../../mosd"`. That is the only cost of keeping the crate at the
campaign-mandated path; `cargo fmt --all`, `cargo clippy --workspace`,
`cargo nextest run --workspace` and `cargo deny` all pick it up unchanged.

### `tough` version: pinned to `=0.18.0` (ring), not 0.24

`tough` 0.19 and later hard-depend on `aws-lc-rs`, which pulls `aws-lc-sys` —
the AWS-LC C library, built from source with cmake and a C toolchain. That
violates the pma-rust pure-Rust baseline and would add a new C build dependency
to the project. The dependency edge is not optional and cannot be feature-gated:

```text
tough 0.24.0
└── aws-lc-rs 1.18.0
    └── aws-lc-sys 0.44.0        (C: AWS-LC / BoringSSL fork, cmake + cc)
```

`tough` 0.18.0 is the last release whose crypto backend is `ring`, which the
workspace already depends on at exactly the same version (`ring 0.17.14`, pulled
in by `rustls`/`rcgen` for webd). So this choice adds **no** new native
dependency to the project at all. New transitive crates are all pure Rust:
`chrono`, `snafu`, `olpc-cjson`, `typed-path`, `globset`, `walkdir`, `url`,
`pem`, `serde_plain` and the `icu_*` set.

`cargo deny check licenses bans advisories` is green with no new exceptions
added; `deny.toml` is unchanged.

The pin is exact (`=0.18.0`) so a future `cargo update` cannot silently pull the
aws-lc-rs line back in. Moving to 0.19+ is a deliberate decision that requires
either accepting a C dependency or a different TUF crate; it is recorded here so
the next person does not rediscover it.

### Consistent snapshots on, with unversioned aliases

The repository is created with `consistent_snapshot = true`, which is what makes
target filenames hash-prefixed (`<sha256>.<name>`) as required. tough then names
metadata `<n>.root.json` / `<n>.targets.json` / `<n>.snapshot.json`. The tool
additionally publishes unversioned copies (`root.json`, `targets.json`,
`snapshot.json`; `timestamp.json` is unversioned by spec) so the repository can
be served at fixed URLs and `root.json` can be shipped as the trusted root.

### Key hierarchy

Four ed25519 keys, one per role, raw PKCS#8 (`<role>.pk8`) — the encoding
`tough::sign::parse_keypair` accepts for ed25519. `root` is offline: it signs
`root.json` during `init` and is never loaded again. `add` and `sign` load only
`targets`, `snapshot` and `timestamp`, so the timestamp/snapshot refresh path
runs without the offline key, as required.

`targets` is an online key in phase 1. tough's `RepositoryEditor::sign()`
re-signs the targets role on every operation, so a snapshot/timestamp-only
refresh that does not touch the targets key is not expressible with this API.
Moving `targets` offline is a phase-2 concern that arrives with the Uptane
director/image split, where the image repo's targets role is signed separately
from the director's.

### Expiration is always an argument

No code path derives an expiration from the wall clock. Every signing subcommand
takes `--targets-expires`, `--snapshot-expires` and `--timestamp-expires` as
RFC 3339 instants, and `init` additionally takes `--root-expires` (it is the only
subcommand that signs the root role, so the flag is absent elsewhere rather than
being accepted and ignored). A release is therefore reproducible, and the expiry
test injects a fixed past instant (`2020-01-01T00:00:00Z`) rather than computing
one.

### Rollback protection needs a datastore

TUF rollback detection compares the incoming timestamp version against the last
trusted one, which only exists if it was persisted. `verify --datastore <dir>`
enables that; without it, `verify` is a pure single-shot signature/hash check.
The on-device client (later phase) will always run with a datastore on the
`state` partition.

## Known limitations

- Metadata JSON is not byte-reproducible across runs. tough serializes the
  `targets` map with `serde_json::to_vec_pretty` over a `std::collections::HashMap`,
  whose iteration order is randomized per process. Signatures are computed over
  canonical (sorted) JSON, so verification is unaffected and every run produces
  valid metadata; only the on-disk key ordering of a multi-target `targets.json`
  can differ between two `sign` invocations. This is inherited from `tough` and
  is not worth forking the crate over at phase 1. Repository artifacts under
  `_out/` are not part of the image determinism contract.
- Single image repository only. There is no director repo, no ECU manifest, no
  delegated targets, and no root rotation command.

## Verification (2026-08-18)

- `bash mosd/hack/check.sh` — ALL CHECKS PASSED. Covers the new crate: `cargo
  fmt --all --check`, `cargo clippy --workspace --all-targets --locked -D
  warnings`, `cargo nextest run --workspace --locked` (5 new `mos-sign` tests),
  `cargo deny check licenses bans advisories` (advisories ok, bans ok, licenses
  ok; no new exceptions).
- Tests, all inside a `tempfile::TempDir`, no host mutation, no network:
  - `roundtrip_init_add_sign_verify` — init -> add -> verify -> sign -> verify,
    asserting the hash-prefixed target filename, the pinned sha256/length and the
    `verityRootHash` custom block;
  - `tampered_target_file_is_rejected` — one flipped byte in the target file;
  - `tampered_targets_metadata_is_rejected` — `targets.json` edited without
    re-signing (caught by snapshot's hash pin before the broken signature);
  - `rolled_back_timestamp_is_rejected` — timestamp v5 trusted into a datastore,
    then v2 republished and refused;
  - `expired_timestamp_is_rejected` — injected past expiry.
- `git ls-files` contains no key, certificate, `.pem`, `.der`, `.pk8` or seed
  file; `update/sign/.devkeys/` is gitignored and `gen-dev-keys` refuses to
  overwrite existing key material.
- `make os-image-cx3576` + `make os-verify-cx3576` — v1 regression, unchanged by
  this task (nothing in the image path was touched).

## ActiveForm

Standing up the server-side TUF signing skeleton under `update/sign`.

## Dependencies

- **blocked by**: -
- **blocks**: on-device Uptane client (PLAN-006 later phase)
