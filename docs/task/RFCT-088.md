# RFCT-088 Uptane phase 2, first half: the device-side metadata verifier and the trust anchor provisioning story

- **status**: completed — the device-side TUF verifier and mos-update-verify, 8 client tests, 15/15 green
- **completedAt**: 2026-08-23 04:55
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-21 10:25
- **claimedAt**: 2026-08-21 10:25

Base `db57f2c` (RFCT-083 commit); finished against `5cf74d1` (PLAN-011 did not
touch `update/`). One of the five roadmap workstreams the RFCT-083 audit named
and deferred: RFCT-016 built the release-side signer and a test suite whose
attacker scenarios — publish a rollback with `--allow-rollback` "so the CLIENT
side can be shown to reject it" — modelled a client that did not exist. This
task builds that client.

## What was built

All inside the existing `mos-sign` crate (`update/sign/`), because the two
halves share one metadata format; no new crate, no image changes.

- **`src/client.rs`** — the device-side verifier. Delegates the TUF client
  walk to `tough` (the same engine the signer verifies with) over a LOCAL
  repository directory from a pinned trusted `root.json`, then adds what a
  device needs on top: model enforcement and persistent rollback state.
- **`src/bin/mos-update-verify.rs`** — second binary (cargo `src/bin/`
  auto-discovery; the crate declares no explicit `[[bin]]`). Scriptable
  contract: exit 0 verified; nonzero with a one-line reason on stderr. Stdout
  carries `OK root vN targets vN snapshot vN timestamp vN`, or with
  `--target NAME` the verified local path of the target file, ready for an
  installer.
- **`tests/common/mod.rs` + `tests/client.rs`** — the signer suite's fixture
  (repo + throwaway keys + out-of-band trusted root, all in a `TempDir`)
  extracted into a shared module and an eight-test client suite added against
  it. Consecutive `client::*` calls load the state file fresh from disk, so
  the suite models restarts, not one long-lived process.
- **`update/README.md`** — the phase-2 stub replaced with the honest state
  (see provisioning below).

## The enforcement checklist

Via tough's client walk (root chain from the pinned root — depth one in
practice, since the signer only ever writes `1.root.json` — then timestamp →
snapshot → targets):

- per-role signature thresholds against the keys the root delegates;
- expiry of every role (client-side default `ExpirationEnforcement::Safe`;
  only the signer's editor path uses `Unsafe`, because an expired repo is
  exactly the one that needs re-signing);
- within-walk version pins (snapshot's targets pin, timestamp's snapshot pin)
  and metadata hash/length pins;
- unsigned edits rejected (snapshot pins the sha256 of targets.json, so a
  doctored targets file dies before its broken signature is even checked).

Added by `client.rs` on top:

- a trusted root that fails to delegate any of the four top-level roles is
  refused up front, by name;
- targets metadata with a non-empty delegations block is refused — the signer
  writes an empty one, and half-verifying roles this client has no keys or
  policy for would be worse than refusing;
- **persistent rollback protection**: a JSON state file of the highest
  verified version per role (root, targets, snapshot, timestamp), checked
  before any write and written atomically (sibling temp file, fsync, rename,
  parent-directory fsync — the transient.rs ordering lesson from RFCT-083). A
  rejection never advances it; a missing file is the honest first run; a
  corrupt file is an error, not a silent reset that would erase the
  protection;
- **target verification**: name → bytes read back through the metadata
  (sha256 via tough's digest check, length pinned explicitly) → the verified
  hash-prefixed local path under `targets/` returned/printed.

The client handles public material only: metadata and the pinned root, never
a `.pk8`.

## Tests: the scenarios the signer suite promised

`tests/repository.rs` was 7 tests before; the crate is now 7 + 8. The client
suite closes the loop the signer tests opened:

| client test | proves |
| --- | --- |
| `honest_publish_sequence_verifies` | init+add then re-sign verify; state file records and follows versions; same-version re-verify is not a rollback |
| `target_verification_reports_local_path` | verified path is inside `targets/` and holds the published bundle's bytes |
| `unknown_target_is_rejected` | unlisted name fails with "not listed" |
| `rollback_is_rejected_across_restarts` | the `--allow-rollback` publish from the signer suite, rejected by a FRESH client call naming role and remembered version; state not advanced by the rejection |
| `tampered_target_is_rejected` | flipped byte in the published target file fails, naming the target |
| `unsigned_metadata_edit_is_rejected` | unsigned targets.json edit dies on snapshot's hash pin |
| `expired_metadata_is_rejected` | injected past expiry (no wall-clock reads) fails with "expired" |
| `unmet_root_threshold_is_rejected` | a pinned root demanding two root signatures while carrying one is refused at the start of the walk (built with tough's signing path directly, because the signer correctly refuses to produce an unsatisfiable threshold) |

Signer-suite deltas: fixture moved to `tests/common/mod.rs` unchanged in
substance (plus a `scratch()` helper), and `Fixture::verify` became a free
`verify(&fx)` in `repository.rs` — it is release-side, and the shared module
is compiled per test binary, so anything only one suite uses would be dead
code in the other.

## Trust anchor provisioning: the honest state

The verifier exists and is exercised offline. **No shipped mechanism delivers
the pinned `root.json` to a device**, and `update/README.md` now says so
rather than implying otherwise, enumerating the candidate paths with
tradeoffs, each marked [not implemented]: image-baked
`/usr/share/mos/uptane/root.json` (strongest binding; ties TUF root rotation
to the image channel), a provisioning file on STATE/META (per-fleet roots;
mutable-storage anchor needs its own integrity story), and signed USB import
(fits the lockbox story; first-time trust still needs a ceremony). Choosing
one is a deliberate decision left open, not defaulted here.

## Deliberately not done

- Transport, and mosd's install orchestration (RAUC install/confirm) — the
  second half of phase 2, named as roadmap by RFCT-083.
- Root rotation beyond depth one: the client inherits tough's chain walk, but
  the signer has no rotation command yet, so rotation is unexercisable and
  untested beyond the trivial chain.
- Delegated targets: rejected, not supported — no test manufactures a
  delegated repo because the signer cannot produce one.
- Any image change (`os/` untouched): nothing bakes the root or the binary
  into the image.

## Verification

In `update/sign/`: `cargo fmt --check`, `cargo clippy --all-targets --locked
-- -D warnings`, `cargo test --locked` all green — 15/15 integration tests
(7 signer + 8 client). `make docs-verify` green. The binary contract
smoke-tested end to end: exit 0 with the version line, exit 0 printing the
verified target path, exit 1 with a one-line rollback reason after an
`--allow-rollback` publish, state file as documented.
